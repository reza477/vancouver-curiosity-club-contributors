import {
  OrganizerAccessDeniedError,
  authorizeMembership,
  generateInvitationToken,
  hashInvitationToken,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  assertOnlyKeys,
  normalizeEmail,
  parseBoundedString,
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  parseObject,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import { prepareNotificationInsert } from "./notifications";
import { consumeOrganizerRateLimit } from "./rate-limit";

export type InvitationRole = "administrator" | "organizer";
export type InvitationState =
  | "expired"
  | "pending"
  | "revoked"
  | "used";

export type InvitationDto = Readonly<{
  club: Readonly<{ id: string; name: string }> | null;
  createdAt: number;
  createdByDisplayName: string;
  expiresAt: number;
  id: string;
  intendedRole: InvitationRole;
  state: InvitationState;
  targetEmail: string;
}>;

export type CreatedInvitationDto = Readonly<{
  copyablePath: string;
  invitation: InvitationDto;
}>;

export async function listOrganizerInvitations(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  nowUtcMs = Date.now(),
): Promise<readonly InvitationDto[]> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const result = await database
    .prepare(
      `SELECT invitation.id,
              invitation.target_normalized_email,
              invitation.intended_role,
              invitation.expires_at,
              invitation.revoked_at,
              invitation.used_at,
              invitation.created_at,
              COALESCE(
                creator_preference.workspace_display_name,
                creator.display_name
              ) AS creator_display_name,
              club.id AS club_id,
              club.name AS club_name
       FROM invitations AS invitation
       LEFT JOIN profiles AS creator
         ON creator.id = invitation.created_by_profile_id
       LEFT JOIN organizer_profile_preferences AS creator_preference
         ON creator_preference.profile_id = creator.id
        AND creator_preference.organization_id =
            invitation.organization_id
       LEFT JOIN clubs AS club
         ON club.id = invitation.club_id
        AND club.organization_id = invitation.organization_id
       WHERE invitation.organization_id = ?
       ORDER BY invitation.created_at DESC, invitation.id DESC
       LIMIT 250`,
    )
    .bind(actor.organizationId)
    .all<Record<string, unknown>>();
  return Object.freeze(
    (result.results ?? [])
      .map((row) => invitationFromRow(row, now))
      .filter((value): value is InvitationDto => value !== null),
  );
}

export async function createOrganizerInvitation(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<CreatedInvitationDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const input = parseObject(inputValue);
  assertOnlyKeys(input, [
    "clubId",
    "expiresAt",
    "intendedRole",
    "targetEmail",
  ]);
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const targetEmail = normalizeEmail(input.targetEmail, "targetEmail");
  const intendedRole = parseEnum(
    input.intendedRole,
    ["administrator", "organizer"] as const,
    "intendedRole",
  );
  if (
    actor.role === "administrator" &&
    intendedRole !== "organizer"
  ) {
    throw new OrganizerAccessDeniedError("role_not_allowed");
  }
  const expiresAt = parseFiniteInteger(input.expiresAt, {
    path: "expiresAt",
    minimum: now + 5 * 60_000,
    maximum: now + 30 * 24 * 60 * 60_000,
  });
  const clubId =
    input.clubId === undefined ||
    input.clubId === null ||
    input.clubId === ""
      ? null
      : parseIdentifier(input.clubId, "clubId");
  if (
    (intendedRole === "organizer" && clubId === null) ||
    (intendedRole === "administrator" && clubId !== null)
  ) {
    throw validationError();
  }
  if (clubId) {
    await authorizeMembership(database, identity, {
      allowedRoles: ["owner", "administrator"],
      clubId,
      organizationId: actor.organizationId,
    });
  }

  await consumeOrganizerRateLimit(database, {
    action: "invitation_create",
    actor,
    scopeMaterial: actor.profileId,
    limit: 12,
    windowMs: 60 * 60_000,
    nowUtcMs: now,
  });

  const existing = await database
    .prepare(
      `SELECT 1 AS present
       FROM organization_memberships
       WHERE organization_id = ?
         AND normalized_email = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(actor.organizationId, targetEmail)
    .first<Record<string, unknown>>();
  if (existing) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "That ChatGPT identity is already a workspace member.",
    );
  }

  const invitationId = crypto.randomUUID();
  const token = generateInvitationToken();
  const tokenHash = await hashInvitationToken(token);
  const auditMetadata = JSON.stringify({
    clubId,
    intendedRole,
  });
  const invitationStatement =
    intendedRole === "organizer"
      ? database
          .prepare(
            `INSERT INTO invitations (
               id, organization_id, club_id, token_hash,
               target_normalized_email, intended_role,
               created_by_profile_id, expires_at,
               revoked_at, used_at, used_by_profile_id,
               created_at, updated_at
             )
             SELECT ?, ?, club.id, ?, ?, 'organizer', ?, ?,
                    NULL, NULL, NULL, ?, ?
             FROM clubs AS club
             WHERE club.id = ?
               AND club.organization_id = ?
               AND club.deleted_at IS NULL
               AND EXISTS (
                 SELECT 1
                 FROM organization_memberships AS actor_membership
                 JOIN profiles AS actor_profile
                   ON actor_profile.id = actor_membership.profile_id
                 WHERE actor_membership.id = ?
                   AND actor_membership.organization_id = ?
                   AND actor_membership.profile_id = ?
                   AND actor_membership.role IN ('owner', 'administrator')
                   AND actor_membership.status = 'active'
                   AND actor_membership.deleted_at IS NULL
                   AND actor_profile.status = 'active'
                   AND actor_profile.deleted_at IS NULL
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM organization_memberships
                 WHERE organization_id = ?
                   AND normalized_email = ?
                   AND deleted_at IS NULL
               )`,
          )
          .bind(
            invitationId,
            actor.organizationId,
            tokenHash,
            targetEmail,
            actor.profileId,
            expiresAt,
            now,
            now,
            clubId,
            actor.organizationId,
            actor.membershipId,
            actor.organizationId,
            actor.profileId,
            actor.organizationId,
            targetEmail,
          )
      : database
          .prepare(
            `INSERT INTO invitations (
               id, organization_id, club_id, token_hash,
               target_normalized_email, intended_role,
               created_by_profile_id, expires_at,
               revoked_at, used_at, used_by_profile_id,
               created_at, updated_at
             )
             SELECT ?, ?, NULL, ?, ?, 'administrator', ?, ?,
                    NULL, NULL, NULL, ?, ?
             WHERE EXISTS (
               SELECT 1
               FROM organization_memberships AS actor_membership
               JOIN profiles AS actor_profile
                 ON actor_profile.id = actor_membership.profile_id
               WHERE actor_membership.id = ?
                 AND actor_membership.organization_id = ?
                 AND actor_membership.profile_id = ?
                 AND actor_membership.role IN ('owner', 'administrator')
                 AND actor_membership.status = 'active'
                 AND actor_membership.deleted_at IS NULL
                 AND actor_profile.status = 'active'
                 AND actor_profile.deleted_at IS NULL
             )
             AND NOT EXISTS (
               SELECT 1
               FROM organization_memberships
               WHERE organization_id = ?
                 AND normalized_email = ?
                 AND deleted_at IS NULL
             )`,
          )
          .bind(
            invitationId,
            actor.organizationId,
            tokenHash,
            targetEmail,
            actor.profileId,
            expiresAt,
            now,
            now,
            actor.membershipId,
            actor.organizationId,
            actor.profileId,
            actor.organizationId,
            targetEmail,
          );

  const results = await database.batch([
    invitationStatement,
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         )
         VALUES (
           ?, ?, ?,
           CASE WHEN EXISTS (
             SELECT 1
             FROM invitations
             WHERE id = ?
               AND organization_id = ?
               AND token_hash = ?
           ) THEN 'invitation.created' ELSE NULL END,
           'invitation', ?, ?, ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        invitationId,
        actor.organizationId,
        tokenHash,
        invitationId,
        auditMetadata,
        now,
      ),
  ]);
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "The invitation could not be created.",
    );
  }

  const invitation = await getInvitationById(
    database,
    actor.organizationId,
    invitationId,
    now,
  );
  if (!invitation) {
    throw new SafeApplicationError(
      "internal_error",
      500,
      "The invitation could not be read after creation.",
    );
  }
  return Object.freeze({
    invitation,
    copyablePath: `/accept-invitation?token=${encodeURIComponent(token)}`,
  });
}

export async function revokeOrganizerInvitation(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  invitationIdValue: unknown,
  nowUtcMs = Date.now(),
): Promise<InvitationDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const invitationId = parseIdentifier(
    invitationIdValue,
    "invitationId",
  );
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const invitation = await getInvitationById(
    database,
    actor.organizationId,
    invitationId,
    now,
  );
  if (!invitation) throw invitationNotFound();
  if (
    actor.role === "administrator" &&
    invitation.intendedRole !== "organizer"
  ) {
    throw new OrganizerAccessDeniedError("role_not_allowed");
  }
  if (invitation.state !== "pending") {
    throw new SafeApplicationError(
      "conflict",
      409,
      "Only a pending invitation can be revoked.",
    );
  }

  const results = await database.batch([
    database
      .prepare(
        `UPDATE invitations
         SET revoked_at = ?, updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND revoked_at IS NULL
           AND used_at IS NULL
           AND expires_at > ?
           AND EXISTS (
             SELECT 1
             FROM organization_memberships AS actor_membership
             JOIN profiles AS actor_profile
               ON actor_profile.id = actor_membership.profile_id
             WHERE actor_membership.id = ?
               AND actor_membership.organization_id =
                   invitations.organization_id
               AND actor_membership.profile_id = ?
               AND actor_membership.role IN ('owner', 'administrator')
               AND actor_membership.status = 'active'
               AND actor_membership.deleted_at IS NULL
               AND actor_profile.status = 'active'
               AND actor_profile.deleted_at IS NULL
           )`,
      )
      .bind(
        now,
        now,
        invitationId,
        actor.organizationId,
        now,
        actor.membershipId,
        actor.profileId,
      ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         )
         VALUES (
           ?, ?, ?,
           CASE WHEN EXISTS (
             SELECT 1
             FROM invitations
             WHERE id = ?
               AND organization_id = ?
               AND revoked_at = ?
               AND used_at IS NULL
           ) THEN 'invitation.revoked' ELSE NULL END,
           'invitation', ?, '{}', ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        invitationId,
        actor.organizationId,
        now,
        invitationId,
        now,
      ),
  ]);
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "The invitation changed before it could be revoked.",
    );
  }

  const revoked = await getInvitationById(
    database,
    actor.organizationId,
    invitationId,
    now,
  );
  if (!revoked) throw invitationNotFound();
  return revoked;
}

export async function acceptOrganizerInvitation(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  rawToken: unknown,
  nowUtcMs = Date.now(),
): Promise<Readonly<{ role: InvitationRole }>> {
  const token = parseInvitationToken(rawToken);
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const tokenHash = await hashInvitationToken(token);
  await consumeOrganizerRateLimit(database, {
    action: "invitation_accept",
    scopeMaterial: `identity\u0000${identity.email}`,
    limit: 12,
    windowMs: 15 * 60_000,
    nowUtcMs: now,
  });
  await consumeOrganizerRateLimit(database, {
    action: "invitation_accept",
    scopeMaterial: `token\u0000${tokenHash}\u0000${identity.email}`,
    limit: 8,
    windowMs: 15 * 60_000,
    nowUtcMs: now,
  });

  const candidate = await database
    .prepare(
      `SELECT invitation.organization_id,
              invitation.club_id,
              invitation.intended_role,
              invitation.created_by_profile_id
       FROM invitations AS invitation
       WHERE invitation.token_hash = ?
         AND invitation.target_normalized_email = ?
         AND invitation.expires_at > ?
         AND invitation.revoked_at IS NULL
         AND invitation.used_at IS NULL
         AND invitation.intended_role IN ('administrator', 'organizer')
         AND (
           (
             invitation.intended_role = 'administrator'
             AND invitation.club_id IS NULL
           )
           OR (
             invitation.intended_role = 'organizer'
             AND invitation.club_id IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM clubs AS club
               WHERE club.id = invitation.club_id
                 AND club.organization_id = invitation.organization_id
                 AND club.deleted_at IS NULL
             )
           )
         )
       LIMIT 1`,
    )
    .bind(tokenHash, identity.email, now)
    .first<Record<string, unknown>>();
  const organizationId = readString(candidate?.organization_id);
  const clubId = readNullableString(candidate?.club_id);
  const role = readInvitationRole(candidate?.intended_role);
  const creatorProfileId = readString(
    candidate?.created_by_profile_id,
  );
  if (!organizationId || !role || !creatorProfileId) {
    throw new OrganizerAccessDeniedError();
  }

  const profileId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const clubMembershipId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const notification = prepareNotificationInsert(database, {
    organizationId,
    recipientProfileId: creatorProfileId,
    createdAt: now,
    payload: {
      type: "invitation_accepted",
      membershipId,
      displayName: identity.displayName,
      role,
    },
  });
  const results = await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO profiles (
           id, siwc_subject, normalized_email, display_name,
           public_attribution_consent, status,
           created_at, updated_at, deleted_at
         )
         SELECT ?, ?, ?, ?, 0, 'active', ?, ?, NULL
         FROM invitations AS invitation
         WHERE invitation.token_hash = ?
           AND invitation.target_normalized_email = ?
           AND invitation.expires_at > ?
           AND invitation.revoked_at IS NULL
           AND invitation.used_at IS NULL
         LIMIT 1`,
      )
      .bind(
        profileId,
        `email:${identity.email}`,
        identity.email,
        identity.displayName,
        now,
        now,
        tokenHash,
        identity.email,
        now,
      ),
    database
      .prepare(
        `UPDATE invitations
         SET used_at = ?,
             used_by_profile_id = (
               SELECT profile.id
               FROM profiles AS profile
               WHERE profile.normalized_email = ?
                 AND profile.status = 'active'
                 AND profile.deleted_at IS NULL
             ),
             updated_at = ?
         WHERE token_hash = ?
           AND organization_id = ?
           AND target_normalized_email = ?
           AND expires_at > ?
           AND revoked_at IS NULL
           AND used_at IS NULL
           AND intended_role = ?
           AND NOT EXISTS (
             SELECT 1
             FROM organization_memberships AS existing_membership
             WHERE existing_membership.organization_id =
                   invitations.organization_id
               AND existing_membership.normalized_email = ?
               AND existing_membership.deleted_at IS NULL
           )`,
      )
      .bind(
        now,
        identity.email,
        now,
        tokenHash,
        organizationId,
        identity.email,
        now,
        role,
        identity.email,
      ),
    database
      .prepare(
        `INSERT INTO organization_memberships (
           id, organization_id, profile_id, normalized_email,
           role, status, created_by_profile_id,
           created_at, updated_at, deleted_at
         )
         SELECT ?, invitation.organization_id, profile.id,
                profile.normalized_email, invitation.intended_role,
                'active', invitation.created_by_profile_id,
                ?, ?, NULL
         FROM invitations AS invitation
         JOIN profiles AS profile
           ON profile.id = invitation.used_by_profile_id
         WHERE invitation.token_hash = ?
           AND invitation.organization_id = ?
           AND invitation.used_at = ?
           AND invitation.target_normalized_email = ?
           AND invitation.intended_role = ?`,
      )
      .bind(
        membershipId,
        now,
        now,
        tokenHash,
        organizationId,
        now,
        identity.email,
        role,
      ),
    database
      .prepare(
        `INSERT INTO club_memberships (
           id, organization_id, club_id,
           organization_membership_id, profile_id,
           role, status, created_by_profile_id,
           created_at, updated_at, deleted_at
         )
         SELECT ?, invitation.organization_id, invitation.club_id,
                membership.id, profile.id, 'organizer', 'active',
                invitation.created_by_profile_id, ?, ?, NULL
         FROM invitations AS invitation
         JOIN profiles AS profile
           ON profile.id = invitation.used_by_profile_id
         JOIN organization_memberships AS membership
           ON membership.id = ?
          AND membership.organization_id = invitation.organization_id
          AND membership.profile_id = profile.id
          AND membership.role = 'organizer'
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
         JOIN clubs AS club
           ON club.id = invitation.club_id
          AND club.organization_id = invitation.organization_id
          AND club.deleted_at IS NULL
         WHERE invitation.token_hash = ?
           AND invitation.organization_id = ?
           AND invitation.used_at = ?
           AND invitation.target_normalized_email = ?
           AND invitation.intended_role = 'organizer'`,
      )
      .bind(
        clubMembershipId,
        now,
        now,
        membershipId,
        tokenHash,
        organizationId,
        now,
        identity.email,
      ),
    notification,
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         )
         VALUES (
           ?, ?, (
             SELECT profile_id
             FROM organization_memberships
             WHERE id = ?
           ),
           CASE WHEN (
             EXISTS (
               SELECT 1
               FROM organization_memberships AS membership
               WHERE membership.id = ?
                 AND membership.organization_id = ?
                 AND membership.normalized_email = ?
                 AND membership.role = ?
                 AND membership.status = 'active'
                 AND membership.deleted_at IS NULL
             )
             AND (
               ? = 'administrator'
               OR EXISTS (
                 SELECT 1
                 FROM club_memberships AS assignment
                 WHERE assignment.id = ?
                   AND assignment.organization_id = ?
                   AND assignment.club_id = ?
                   AND assignment.organization_membership_id = ?
                   AND assignment.status = 'active'
                   AND assignment.deleted_at IS NULL
               )
             )
           ) THEN 'invitation.accepted' ELSE NULL END,
           'membership', ?, ?, ?
         )`,
      )
      .bind(
        auditId,
        organizationId,
        membershipId,
        membershipId,
        organizationId,
        identity.email,
        role,
        role,
        clubMembershipId,
        organizationId,
        clubId,
        membershipId,
        membershipId,
        JSON.stringify({ clubId, role }),
        now,
      ),
  ]);

  if (
    changes(results[1]) !== 1 ||
    changes(results[2]) !== 1 ||
    (role === "organizer" && changes(results[3]) !== 1) ||
    changes(results[5]) !== 1
  ) {
    throw new OrganizerAccessDeniedError();
  }
  return Object.freeze({ role });
}

async function getInvitationById(
  database: D1DatabaseLike,
  organizationId: string,
  invitationId: string,
  nowUtcMs: number,
): Promise<InvitationDto | null> {
  const row = await database
    .prepare(
      `SELECT invitation.id,
              invitation.target_normalized_email,
              invitation.intended_role,
              invitation.expires_at,
              invitation.revoked_at,
              invitation.used_at,
              invitation.created_at,
              COALESCE(
                creator_preference.workspace_display_name,
                creator.display_name
              ) AS creator_display_name,
              club.id AS club_id,
              club.name AS club_name
       FROM invitations AS invitation
       LEFT JOIN profiles AS creator
         ON creator.id = invitation.created_by_profile_id
       LEFT JOIN organizer_profile_preferences AS creator_preference
         ON creator_preference.profile_id = creator.id
        AND creator_preference.organization_id =
            invitation.organization_id
       LEFT JOIN clubs AS club
         ON club.id = invitation.club_id
        AND club.organization_id = invitation.organization_id
       WHERE invitation.id = ?
         AND invitation.organization_id = ?
       LIMIT 1`,
    )
    .bind(invitationId, organizationId)
    .first<Record<string, unknown>>();
  return row ? invitationFromRow(row, nowUtcMs) : null;
}

function invitationFromRow(
  row: Record<string, unknown>,
  nowUtcMs: number,
): InvitationDto | null {
  const id = readString(row.id);
  const targetEmail = readString(row.target_normalized_email);
  const intendedRole = readInvitationRole(row.intended_role);
  const expiresAt = readInteger(row.expires_at);
  const createdAt = readInteger(row.created_at);
  const createdByDisplayName =
    readString(row.creator_display_name) ?? "Organizer";
  if (
    !id ||
    !targetEmail ||
    !intendedRole ||
    expiresAt === null ||
    createdAt === null
  ) {
    return null;
  }
  const clubId = readNullableString(row.club_id);
  const clubName = readNullableString(row.club_name);
  const club =
    clubId && clubName ? Object.freeze({ id: clubId, name: clubName }) : null;
  return Object.freeze({
    id,
    targetEmail,
    intendedRole,
    expiresAt,
    createdAt,
    createdByDisplayName,
    club,
    state:
      row.used_at !== null
        ? "used"
        : row.revoked_at !== null
          ? "revoked"
          : expiresAt <= nowUtcMs
            ? "expired"
            : "pending",
  });
}

function parseInvitationToken(value: unknown): string {
  const token = parseBoundedString(value, {
    path: "token",
    minLength: 43,
    maxLength: 43,
  });
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
    throw new OrganizerAccessDeniedError();
  }
  return token;
}

function readInvitationRole(value: unknown): InvitationRole | null {
  return value === "administrator" || value === "organizer"
    ? value
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function changes(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  const meta = Reflect.get(result, "meta");
  if (typeof meta !== "object" || meta === null) return 0;
  const value = Reflect.get(meta, "changes");
  return typeof value === "number" ? value : 0;
}

function invitationNotFound(): SafeApplicationError {
  return new SafeApplicationError(
    "not_found",
    404,
    "The requested invitation is not available.",
  );
}

function validationError(): SafeApplicationError {
  return new SafeApplicationError(
    "validation_failed",
    422,
    "The request could not be validated.",
  );
}
