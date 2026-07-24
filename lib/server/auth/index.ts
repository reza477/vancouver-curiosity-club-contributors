import {
  normalizeEmail,
  parseBoundedString,
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  parseOptionalBoundedString,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";

export const ORGANIZATION_ROLES = [
  "owner",
  "administrator",
  "organizer",
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

const INITIAL_ORGANIZATION_NAME =
  "Vancouver Curiosity and Education Society";
const INITIAL_ORGANIZATION_SLUG =
  "vancouver-curiosity-and-education-society";
const INITIAL_ORGANIZATION_TIME_ZONE = "America/Vancouver";

export type D1Value = ArrayBuffer | null | number | string;

export type D1ResultLike<T = Record<string, unknown>> = Readonly<{
  meta?: Readonly<{ changes?: number }>;
  results?: readonly T[];
  success?: boolean;
}>;

export interface D1PreparedStatementLike {
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  bind(...values: D1Value[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(
    columnName?: string,
  ): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
}

export interface D1DatabaseLike {
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatementLike[],
  ): Promise<D1ResultLike<T>[]>;
  prepare(sql: string): D1PreparedStatementLike;
}

export type TrustedServerIdentity = Readonly<{
  displayName: string;
  email: string;
  source: "sites-siwc";
}>;

export type AuthorizedMembership = Readonly<{
  membershipId: string;
  organizationId: string;
  profileId: string;
  role: OrganizationRole;
}>;

export type AuthorizationRequirement = Readonly<{
  allowedRoles?: readonly OrganizationRole[];
  clubId?: string;
  organizationId?: string;
}>;

export class OrganizerAccessDeniedError extends SafeApplicationError {
  readonly reason:
    | "club_assignment_required"
    | "inactive_membership"
    | "role_not_allowed";

  constructor(
    reason:
      | "club_assignment_required"
      | "inactive_membership"
      | "role_not_allowed" = "inactive_membership",
  ) {
    super(
      "authorization_denied",
      403,
      "This ChatGPT identity does not have access to the organizer portal.",
    );
    this.name = "OrganizerAccessDeniedError";
    this.reason = reason;
  }
}

export class AuthConfigurationError extends SafeApplicationError {
  constructor() {
    super(
      "service_unavailable",
      503,
      "Organizer access is not configured yet.",
    );
    this.name = "AuthConfigurationError";
  }
}

/**
 * This factory is intentionally server-only. Its input must come from
 * `getChatGPTUser()`, never from a request body, query parameter, cookie, or
 * caller-provided identity header.
 */
export function trustedIdentityFromSites(
  input: Readonly<{ displayName?: unknown; email: unknown }>,
): TrustedServerIdentity {
  const email = normalizeEmail(input.email, "authenticatedEmail");
  const displayName =
    parseOptionalBoundedString(input.displayName, {
      path: "authenticatedDisplayName",
      maxLength: 120,
    }) ?? email;
  return Object.freeze({
    displayName,
    email,
    source: "sites-siwc" as const,
  });
}

export async function authorizeMembership(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  requirement: AuthorizationRequirement = {},
): Promise<AuthorizedMembership> {
  const organizationId = requirement.organizationId
    ? parseIdentifier(requirement.organizationId, "organizationId")
    : null;
  const membership = await findActiveMembership(
    database,
    identity.email,
    organizationId,
  );
  if (!membership) throw new OrganizerAccessDeniedError();

  const allowedRoles = requirement.allowedRoles ?? ORGANIZATION_ROLES;
  if (!allowedRoles.some((role) => role === membership.role)) {
    throw new OrganizerAccessDeniedError("role_not_allowed");
  }

  if (requirement.clubId !== undefined) {
    const clubId = parseIdentifier(requirement.clubId, "clubId");
    const organizationClub = await database
      .prepare(
        `SELECT club.id
         FROM clubs AS club
         WHERE club.id = ?
           AND club.organization_id = ?
           AND club.deleted_at IS NULL
         LIMIT 1`,
      )
      .bind(clubId, membership.organizationId)
      .first<Record<string, unknown>>();
    if (!organizationClub) {
      throw new OrganizerAccessDeniedError("club_assignment_required");
    }

    if (membership.role !== "organizer") return membership;

    const clubAssignment = await database
      .prepare(
        `SELECT club_membership.id
         FROM club_memberships AS club_membership
         JOIN clubs AS club
           ON club.id = club_membership.club_id
          AND club.organization_id = club_membership.organization_id
          AND club.deleted_at IS NULL
         WHERE club_membership.organization_id = ?
           AND club_membership.club_id = ?
           AND club_membership.organization_membership_id = ?
           AND club_membership.profile_id = ?
           AND club_membership.role = 'organizer'
           AND club_membership.status = 'active'
           AND club_membership.deleted_at IS NULL
         LIMIT 1`,
      )
      .bind(
        membership.organizationId,
        clubId,
        membership.membershipId,
        membership.profileId,
      )
      .first<Record<string, unknown>>();
    if (!clubAssignment) {
      throw new OrganizerAccessDeniedError("club_assignment_required");
    }
  }

  return membership;
}

export async function authorizeOrganizerAccess(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  options: Readonly<{ initialOwnerEmail?: string | null }> = {},
): Promise<AuthorizedMembership> {
  const existing = await findActiveMembership(database, identity.email, null);
  if (existing) return existing;

  const initialOwnerEmail = options.initialOwnerEmail
    ? normalizeEmail(options.initialOwnerEmail, "INITIAL_OWNER_EMAIL")
    : null;
  if (initialOwnerEmail && initialOwnerEmail === identity.email) {
    const claimed = await bootstrapInitialOwner(
      database,
      identity,
      initialOwnerEmail,
    );
    if (claimed) {
      const membership = await findActiveMembership(
        database,
        identity.email,
        null,
      );
      if (membership) return membership;
    }
  }

  throw new OrganizerAccessDeniedError();
}

/**
 * Claims the single open organization. The membership insert and bootstrap
 * closure execute in one D1 `batch()`, which D1 commits atomically. Both
 * mutations are guarded inside SQL so concurrent claims cannot create a
 * second owner.
 */
export async function bootstrapInitialOwner(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  configuredInitialOwnerEmail: string,
  nowUtcMs = Date.now(),
): Promise<boolean> {
  const expectedEmail = normalizeEmail(
    configuredInitialOwnerEmail,
    "INITIAL_OWNER_EMAIL",
  );
  if (identity.email !== expectedEmail) return false;
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });

  const candidates = await database
    .prepare(
      `SELECT o.id
       FROM organizations AS o
       WHERE o.owner_bootstrap_closed_at IS NULL
         AND o.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM organization_memberships AS existing_owner
           WHERE existing_owner.organization_id = o.id
             AND existing_owner.role = 'owner'
             AND existing_owner.deleted_at IS NULL
         )
       ORDER BY o.created_at ASC, o.id ASC
       LIMIT 2`,
    )
    .all<Record<string, unknown>>();

  const organizationIds = (candidates.results ?? [])
    .map((row) => readString(row, "id"))
    .filter((value): value is string => value !== null);
  if (organizationIds.length > 1) throw new AuthConfigurationError();

  const shouldCreateOrganization = organizationIds.length === 0;
  const organizationId = organizationIds[0] ?? crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const identityKey = identityKeyForEmail(identity.email);

  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO organizations (
           id, name, slug, timezone, owner_bootstrap_closed_at,
           owner_bootstrap_claimed_by_profile_id, created_by_profile_id,
           created_at, updated_at, deleted_at
         )
         SELECT ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL
         WHERE ? = 1
           AND NOT EXISTS (
             SELECT 1
             FROM organizations
             WHERE deleted_at IS NULL
           )
           AND NOT EXISTS (
             SELECT 1
             FROM profiles
             WHERE normalized_email = ?
               AND (status <> 'active' OR deleted_at IS NOT NULL)
           )
         ON CONFLICT(slug) DO NOTHING`,
      )
      .bind(
        organizationId,
        INITIAL_ORGANIZATION_NAME,
        INITIAL_ORGANIZATION_SLUG,
        INITIAL_ORGANIZATION_TIME_ZONE,
        now,
        now,
        shouldCreateOrganization ? 1 : 0,
        identity.email,
      ),
    database
      .prepare(
        `INSERT INTO profiles (
           id, siwc_subject, normalized_email, display_name, status,
           created_at, updated_at, deleted_at
         )
         SELECT ?, ?, ?, ?, 'active', ?, ?, NULL
         WHERE EXISTS (
           SELECT 1
           FROM organizations AS organization
           WHERE organization.id = ?
             AND organization.owner_bootstrap_closed_at IS NULL
             AND organization.deleted_at IS NULL
             AND NOT EXISTS (
               SELECT 1
               FROM organization_memberships AS existing_owner
               WHERE existing_owner.organization_id = organization.id
                 AND existing_owner.role = 'owner'
                 AND existing_owner.deleted_at IS NULL
             )
         )
         ON CONFLICT(normalized_email) DO NOTHING`,
      )
      .bind(
        profileId,
        identityKey,
        identity.email,
        identity.displayName,
        now,
        now,
        organizationId,
      ),
    database
      .prepare(
        `INSERT INTO organization_memberships (
           id, organization_id, profile_id, normalized_email, role, status,
           created_by_profile_id, created_at, updated_at, deleted_at
         )
         SELECT ?, organization.id, profile.id, profile.normalized_email,
                'owner', 'active', profile.id, ?, ?, NULL
         FROM organizations AS organization
         JOIN profiles AS profile ON profile.normalized_email = ?
         WHERE organization.id = ?
           AND organization.owner_bootstrap_closed_at IS NULL
           AND organization.deleted_at IS NULL
           AND profile.status = 'active'
           AND profile.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM organization_memberships AS existing_owner
             WHERE existing_owner.organization_id = organization.id
               AND existing_owner.role = 'owner'
               AND existing_owner.deleted_at IS NULL
           )`,
      )
      .bind(membershipId, now, now, identity.email, organizationId),
    database
      .prepare(
        `UPDATE organizations
         SET owner_bootstrap_closed_at = ?,
             owner_bootstrap_claimed_by_profile_id = (
               SELECT profile_id
               FROM organization_memberships
               WHERE id = ?
             ),
             created_by_profile_id = COALESCE(
               created_by_profile_id,
               (
                 SELECT profile_id
                 FROM organization_memberships
                 WHERE id = ?
               )
             ),
             updated_at = ?
         WHERE id = ?
           AND owner_bootstrap_closed_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM organization_memberships
             WHERE id = ?
               AND organization_id = organizations.id
               AND role = 'owner'
               AND status = 'active'
               AND deleted_at IS NULL
           )`,
      )
      .bind(
        now,
        membershipId,
        membershipId,
        now,
        organizationId,
        membershipId,
      ),
  ]);

  return changes(results[2]) === 1 && changes(results[3]) === 1;
}

export type CreateInvitationInput = Readonly<{
  clubId?: unknown;
  expiresAtUtcMs: unknown;
  intendedRole: unknown;
  targetEmail: unknown;
}>;

export type CreatedInvitation = Readonly<{
  copyablePath: string;
  expiresAtUtcMs: number;
  intendedRole: Exclude<OrganizationRole, "owner">;
  invitationId: string;
  targetEmail: string;
  token: string;
}>;

/**
 * Creates a copyable invitation. No delivery is attempted or claimed.
 * Organization and creator are derived from the revalidated actor membership.
 */
export async function createInvitation(
  database: D1DatabaseLike,
  actorIdentity: TrustedServerIdentity,
  input: CreateInvitationInput,
  nowUtcMs = Date.now(),
): Promise<CreatedInvitation> {
  const actor = await authorizeMembership(database, actorIdentity, {
    allowedRoles: ["owner", "administrator"],
  });
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
  const expiresAtUtcMs = parseFiniteInteger(input.expiresAtUtcMs, {
    path: "expiresAtUtcMs",
    minimum: now + 5 * 60_000,
    maximum: now + 30 * 24 * 60 * 60_000,
  });
  const clubId =
    input.clubId === undefined || input.clubId === null
      ? null
      : parseIdentifier(input.clubId, "clubId");

  if (
    (intendedRole === "organizer" && clubId === null) ||
    (intendedRole === "administrator" && clubId !== null)
  ) {
    throw new OrganizerAccessDeniedError("club_assignment_required");
  }

  const token = generateInvitationToken();
  const tokenHash = await hashInvitationToken(token);
  const invitationId = crypto.randomUUID();
  const statement =
    intendedRole === "organizer"
      ? database
          .prepare(
            `INSERT INTO invitations (
               id, organization_id, club_id, token_hash,
               target_normalized_email, intended_role, created_by_profile_id,
               expires_at, revoked_at, used_at, used_by_profile_id,
               created_at, updated_at
             )
             SELECT ?, ?, club.id, ?, ?, 'organizer', ?, ?,
                    NULL, NULL, NULL, ?, ?
             FROM clubs AS club
             WHERE club.id = ?
               AND club.organization_id = ?
               AND club.deleted_at IS NULL`,
          )
          .bind(
            invitationId,
            actor.organizationId,
            tokenHash,
            targetEmail,
            actor.profileId,
            expiresAtUtcMs,
            now,
            now,
            clubId,
            actor.organizationId,
          )
      : database
          .prepare(
            `INSERT INTO invitations (
               id, organization_id, club_id, token_hash,
               target_normalized_email, intended_role, created_by_profile_id,
               expires_at, revoked_at, used_at, used_by_profile_id,
               created_at, updated_at
             )
             VALUES (?, ?, NULL, ?, ?, 'administrator', ?, ?,
                     NULL, NULL, NULL, ?, ?)`,
          )
          .bind(
            invitationId,
            actor.organizationId,
            tokenHash,
            targetEmail,
            actor.profileId,
            expiresAtUtcMs,
            now,
            now,
          );
  const result = await statement.run();
  if (changes(result) !== 1) {
    if (intendedRole === "organizer") {
      throw new OrganizerAccessDeniedError("club_assignment_required");
    }
    throw new SafeApplicationError(
      "internal_error",
      500,
      "The invitation could not be created.",
    );
  }

  return Object.freeze({
    copyablePath: `/accept-invitation?token=${encodeURIComponent(token)}`,
    expiresAtUtcMs,
    intendedRole,
    invitationId,
    targetEmail,
    token,
  });
}

export async function revokeInvitation(
  database: D1DatabaseLike,
  actorIdentity: TrustedServerIdentity,
  invitationIdInput: unknown,
  nowUtcMs = Date.now(),
): Promise<boolean> {
  const actor = await authorizeMembership(database, actorIdentity, {
    allowedRoles: ["owner", "administrator"],
  });
  const invitationId = parseIdentifier(invitationIdInput, "invitationId");
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const result = await database
    .prepare(
      `UPDATE invitations
       SET revoked_at = ?, updated_at = ?
       WHERE id = ?
         AND organization_id = ?
         AND revoked_at IS NULL
         AND used_at IS NULL`,
    )
    .bind(now, now, invitationId, actor.organizationId)
    .run();
  return changes(result) === 1;
}

/**
 * Invitation acceptance is a later UI flow, but its security contract is
 * proven here. The token is consumed and membership (plus an Organizer club
 * assignment) is created in one atomic D1 batch. No client identity or
 * organization claim participates in the authorization decision.
 */
export async function acceptInvitation(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  rawToken: unknown,
  nowUtcMs = Date.now(),
): Promise<AuthorizedMembership> {
  const token = parseBoundedString(rawToken, {
    path: "token",
    minLength: 43,
    maxLength: 43,
  });
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
    throw new OrganizerAccessDeniedError();
  }
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const tokenHash = await hashInvitationToken(token);
  const profileId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const clubMembershipId = crypto.randomUUID();

  const results = await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO profiles (
           id, siwc_subject, normalized_email, display_name, status,
           created_at, updated_at, deleted_at
         )
         SELECT ?, ?, ?, ?, 'active', ?, ?, NULL
         FROM invitations AS invitation
         WHERE invitation.token_hash = ?
           AND invitation.target_normalized_email = ?
           AND invitation.expires_at > ?
           AND invitation.revoked_at IS NULL
           AND invitation.used_at IS NULL
           AND (
             (invitation.intended_role = 'administrator'
               AND invitation.club_id IS NULL)
             OR
             (invitation.intended_role = 'organizer'
               AND invitation.club_id IS NOT NULL)
               AND EXISTS (
                 SELECT 1
                 FROM clubs AS club
                 WHERE club.id = invitation.club_id
                   AND club.organization_id = invitation.organization_id
                   AND club.deleted_at IS NULL
               )
           )
         LIMIT 1`,
      )
      .bind(
        profileId,
        identityKeyForEmail(identity.email),
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
        `UPDATE invitations AS invitation
         SET used_at = ?,
             used_by_profile_id = (
               SELECT profile.id
               FROM profiles AS profile
               WHERE profile.normalized_email = ?
                 AND profile.status = 'active'
                 AND profile.deleted_at IS NULL
             ),
             updated_at = ?
         WHERE invitation.token_hash = ?
           AND invitation.target_normalized_email = ?
           AND invitation.expires_at > ?
           AND invitation.revoked_at IS NULL
           AND invitation.used_at IS NULL
           AND invitation.intended_role IN ('administrator', 'organizer')
           AND (
             (invitation.intended_role = 'administrator'
               AND invitation.club_id IS NULL)
             OR
             (invitation.intended_role = 'organizer'
               AND invitation.club_id IS NOT NULL)
               AND EXISTS (
                 SELECT 1
                 FROM clubs AS club
                 WHERE club.id = invitation.club_id
                   AND club.organization_id = invitation.organization_id
                   AND club.deleted_at IS NULL
               )
           )
           AND EXISTS (
             SELECT 1
             FROM profiles AS profile
             WHERE profile.normalized_email = invitation.target_normalized_email
               AND profile.status = 'active'
               AND profile.deleted_at IS NULL
           )
           AND NOT EXISTS (
             SELECT 1
             FROM organization_memberships AS existing_membership
             JOIN profiles AS existing_profile
               ON existing_profile.id = existing_membership.profile_id
             WHERE existing_membership.organization_id =
                   invitation.organization_id
               AND existing_profile.normalized_email = ?
               AND existing_membership.deleted_at IS NULL
           )`,
      )
      .bind(
        now,
        identity.email,
        now,
        tokenHash,
        identity.email,
        now,
        identity.email,
      ),
    database
      .prepare(
        `INSERT INTO organization_memberships (
           id, organization_id, profile_id, normalized_email, role, status,
           created_by_profile_id, created_at, updated_at, deleted_at
         )
         SELECT ?, invitation.organization_id, profile.id,
                profile.normalized_email, invitation.intended_role, 'active',
                invitation.created_by_profile_id, ?, ?, NULL
         FROM invitations AS invitation
         JOIN profiles AS profile
           ON profile.id = invitation.used_by_profile_id
         WHERE invitation.token_hash = ?
           AND invitation.used_at = ?
           AND invitation.target_normalized_email = ?
           AND (
             invitation.intended_role = 'administrator'
             OR (
               invitation.intended_role = 'organizer'
               AND EXISTS (
                 SELECT 1
                 FROM clubs AS club
                 WHERE club.id = invitation.club_id
                   AND club.organization_id = invitation.organization_id
                   AND club.deleted_at IS NULL
               )
             )
           )`,
      )
      .bind(membershipId, now, now, tokenHash, now, identity.email),
    database
      .prepare(
        `INSERT INTO club_memberships (
           id, organization_id, club_id, organization_membership_id,
           profile_id, role, status, created_by_profile_id,
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
         JOIN clubs AS club
           ON club.id = invitation.club_id
          AND club.organization_id = invitation.organization_id
          AND club.deleted_at IS NULL
         WHERE invitation.token_hash = ?
           AND invitation.used_at = ?
           AND invitation.target_normalized_email = ?
           AND invitation.intended_role = 'organizer'
           AND invitation.club_id IS NOT NULL`,
      )
      .bind(
        clubMembershipId,
        now,
        now,
        membershipId,
        tokenHash,
        now,
        identity.email,
      ),
  ]);

  const invitationConsumed = changes(results[1]) === 1;
  const membershipCreated = changes(results[2]) === 1;
  const organizerClubCreated = changes(results[3]) === 1;
  const createdRole = await intendedRoleForMembership(database, membershipId);
  if (
    !invitationConsumed ||
    !membershipCreated ||
    createdRole === null ||
    (createdRole === "organizer" && !organizerClubCreated)
  ) {
    throw new OrganizerAccessDeniedError();
  }

  const membership = await findActiveMembershipById(
    database,
    membershipId,
    identity.email,
  );
  if (!membership) throw new OrganizerAccessDeniedError();
  return membership;
}

export function generateInvitationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function hashInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function isD1DatabaseLike(value: unknown): value is D1DatabaseLike {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "prepare") === "function" &&
    typeof Reflect.get(value, "batch") === "function"
  );
}

async function findActiveMembership(
  database: D1DatabaseLike,
  normalizedEmail: string,
  organizationId: string | null,
): Promise<AuthorizedMembership | null> {
  const organizationFilter = organizationId
    ? "AND membership.organization_id = ?"
    : "";
  const statement = database
    .prepare(
      `SELECT membership.id AS membership_id,
              membership.organization_id,
              membership.profile_id,
              membership.role
       FROM organization_memberships AS membership
       JOIN profiles AS profile ON profile.id = membership.profile_id
       JOIN organizations AS organization
         ON organization.id = membership.organization_id
       WHERE membership.normalized_email = ?
         AND profile.normalized_email = ?
         AND membership.status = 'active'
         AND profile.status = 'active'
         AND membership.deleted_at IS NULL
         AND profile.deleted_at IS NULL
         AND organization.deleted_at IS NULL
         ${organizationFilter}
       ORDER BY CASE membership.role
         WHEN 'owner' THEN 1
         WHEN 'administrator' THEN 2
         WHEN 'organizer' THEN 3
         ELSE 4
       END,
       membership.created_at ASC
       LIMIT 1`,
    );
  const row = organizationId
    ? await statement
        .bind(normalizedEmail, normalizedEmail, organizationId)
        .first<Record<string, unknown>>()
    : await statement
        .bind(normalizedEmail, normalizedEmail)
        .first<Record<string, unknown>>();
  return row ? membershipFromRow(row) : null;
}

async function findActiveMembershipById(
  database: D1DatabaseLike,
  membershipId: string,
  normalizedEmail: string,
): Promise<AuthorizedMembership | null> {
  const row = await database
    .prepare(
      `SELECT membership.id AS membership_id,
              membership.organization_id,
              membership.profile_id,
              membership.role
       FROM organization_memberships AS membership
       JOIN profiles AS profile ON profile.id = membership.profile_id
       JOIN organizations AS organization
         ON organization.id = membership.organization_id
       WHERE membership.id = ?
         AND membership.normalized_email = ?
         AND profile.normalized_email = ?
         AND membership.status = 'active'
         AND profile.status = 'active'
         AND membership.deleted_at IS NULL
         AND profile.deleted_at IS NULL
         AND organization.deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(membershipId, normalizedEmail, normalizedEmail)
    .first<Record<string, unknown>>();
  return row ? membershipFromRow(row) : null;
}

async function intendedRoleForMembership(
  database: D1DatabaseLike,
  membershipId: string,
): Promise<OrganizationRole | null> {
  const row = await database
    .prepare(
      `SELECT role
       FROM organization_memberships
       WHERE id = ?
         AND status = 'active'
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(membershipId)
    .first<Record<string, unknown>>();
  return row ? readRole(row.role) : null;
}

function membershipFromRow(
  row: Record<string, unknown>,
): AuthorizedMembership {
  const membershipId = readString(row, "membership_id");
  const organizationId = readString(row, "organization_id");
  const profileId = readString(row, "profile_id");
  const role = readRole(row.role);
  if (!membershipId || !organizationId || !profileId || !role) {
    throw new SafeApplicationError(
      "internal_error",
      500,
      "Organizer access could not be verified.",
    );
  }
  return Object.freeze({
    membershipId,
    organizationId,
    profileId,
    role,
  });
}

function readRole(value: unknown): OrganizationRole | null {
  return ORGANIZATION_ROLES.find((role) => role === value) ?? null;
}

function readString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function changes(result: D1ResultLike | undefined): number {
  return typeof result?.meta?.changes === "number"
    ? result.meta.changes
    : 0;
}

function identityKeyForEmail(normalizedEmail: string): string {
  return `email:${normalizedEmail}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}
