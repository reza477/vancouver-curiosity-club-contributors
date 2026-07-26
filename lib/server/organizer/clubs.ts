import {
  OrganizerAccessDeniedError,
  authorizeMembership,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  assertOnlyKeys,
  parseBoundedString,
  parseFiniteInteger,
  parseIdentifier,
  parseObject,
  parseOptionalBoundedString,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";

const CLUB_SETTINGS_PREFIX = "organizer_club:";
const COMMIT_ACTOR_GUARD_SQL = `EXISTS (
  SELECT 1
  FROM organization_memberships AS actor_membership
  JOIN profiles AS actor_profile
    ON actor_profile.id = actor_membership.profile_id
  JOIN organizations AS actor_organization
    ON actor_organization.id = actor_membership.organization_id
   AND actor_organization.deleted_at IS NULL
  WHERE actor_membership.id = ?
    AND actor_membership.organization_id = ?
    AND actor_membership.profile_id = ?
    AND actor_membership.normalized_email = ?
    AND actor_membership.normalized_email =
        actor_profile.normalized_email
    AND actor_membership.role IN ('owner', 'administrator')
    AND actor_membership.status = 'active'
    AND actor_membership.deleted_at IS NULL
    AND actor_profile.status = 'active'
    AND actor_profile.deleted_at IS NULL
)`;

export type OrganizerClubDto = Readonly<{
  description: string | null;
  id: string;
  identityEditable: boolean;
  name: string;
  planningNotes: string | null;
  publicGroupUrl: string | null;
  publicationState: "archived" | "draft" | "private" | "published";
  slug: string;
}>;

export type ClubArchiveBlocker = Readonly<{
  eventId: string;
  source: "legacy_read_only" | "manual";
  title: string;
}>;

export class ClubArchiveBlockedError extends SafeApplicationError {
  readonly eventCount: number;
  readonly events: readonly ClubArchiveBlocker[];
  readonly invitationCount: number;
  readonly memberCount: number;
  readonly programCount: number;
  readonly sourceCount: number;

  constructor(
    memberCount: number,
    events: readonly ClubArchiveBlocker[],
    counts: Readonly<{
      eventCount: number;
      invitationCount: number;
      programCount: number;
      sourceCount: number;
    }>,
  ) {
    super(
      "conflict",
      409,
      "Resolve this club's members and connected records before archiving it.",
    );
    this.name = "ClubArchiveBlockedError";
    this.memberCount = memberCount;
    this.eventCount = counts.eventCount;
    this.events = Object.freeze([...events]);
    this.invitationCount = counts.invitationCount;
    this.programCount = counts.programCount;
    this.sourceCount = counts.sourceCount;
  }
}

export async function listOrganizerClubs(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
): Promise<readonly OrganizerClubDto[]> {
  const actor = await authorizeMembership(database, identity);
  const organizerScope =
    actor.role === "organizer"
      ? `AND EXISTS (
           SELECT 1
           FROM club_memberships AS assignment
           WHERE assignment.organization_id = club.organization_id
             AND assignment.club_id = club.id
             AND assignment.organization_membership_id = ?
             AND assignment.profile_id = ?
             AND assignment.status = 'active'
             AND assignment.deleted_at IS NULL
         )`
      : "";
  const statement = database.prepare(
    `SELECT club.id,
            club.name,
            club.slug,
            club.description,
            public_profile.publication_status,
            public_profile.public_group_url,
            private_setting.value_json AS private_setting_json
     FROM clubs AS club
     LEFT JOIN club_public_profiles AS public_profile
       ON public_profile.club_id = club.id
      AND public_profile.organization_id = club.organization_id
     LEFT JOIN site_settings AS private_setting
       ON private_setting.organization_id = club.organization_id
      AND private_setting.key = (? || club.id)
      AND private_setting.is_public = 0
     WHERE club.organization_id = ?
       AND club.deleted_at IS NULL
       ${organizerScope}
     ORDER BY club.name COLLATE NOCASE ASC, club.id ASC
     LIMIT 250`,
  );
  const result =
    actor.role === "organizer"
      ? await statement
          .bind(
            CLUB_SETTINGS_PREFIX,
            actor.organizationId,
            actor.membershipId,
            actor.profileId,
          )
          .all<Record<string, unknown>>()
      : await statement
          .bind(CLUB_SETTINGS_PREFIX, actor.organizationId)
          .all<Record<string, unknown>>();
  return Object.freeze(
    (result.results ?? [])
      .map(clubFromRow)
      .filter((club): club is OrganizerClubDto => club !== null),
  );
}

export async function createPrivateOrganizerClub(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<OrganizerClubDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const input = parseObject(inputValue);
  assertOnlyKeys(input, [
    "description",
    "name",
    "planningNotes",
    "slug",
  ]);
  const name = parseBoundedString(input.name, {
    path: "name",
    minLength: 1,
    maxLength: 120,
  });
  const slug = parseSlug(input.slug);
  const description = parseOptionalBoundedString(input.description, {
    path: "description",
    maxLength: 800,
  });
  const planningNotes = parseOptionalBoundedString(input.planningNotes, {
    path: "planningNotes",
    maxLength: 2_000,
  });
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const clubId = crypto.randomUUID();
  const batch = [
    database
      .prepare(
        `INSERT INTO clubs (
           id, organization_id, name, slug, description,
           created_by_profile_id, created_at, updated_at, deleted_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL
         WHERE ${COMMIT_ACTOR_GUARD_SQL}`,
      )
      .bind(
        clubId,
        actor.organizationId,
        name,
        slug,
        description,
        actor.profileId,
        now,
        now,
        actor.membershipId,
        actor.organizationId,
        actor.profileId,
        identity.email,
      ),
  ];
  if (planningNotes) {
    batch.push(
      privateClubSettingsStatement(
        database,
        actor.organizationId,
        actor.membershipId,
        actor.profileId,
        identity.email,
        clubId,
        planningNotes,
        now,
      ),
    );
  }
  const auditIndex = batch.length;
  batch.push(
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
             FROM clubs
             WHERE id = ?
               AND organization_id = ?
               AND deleted_at IS NULL
           ) AND NOT EXISTS (
             SELECT 1
             FROM club_public_profiles
             WHERE club_id = ?
           ) AND ${COMMIT_ACTOR_GUARD_SQL}
           THEN 'club.created_private' ELSE NULL END,
           'club', ?, '{"publicationState":"private"}', ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        clubId,
        actor.organizationId,
        clubId,
        actor.membershipId,
        actor.organizationId,
        actor.profileId,
        identity.email,
        clubId,
        now,
      ),
  );
  const results = await database.batch(batch);
  if (
    changes(results[0]) !== 1 ||
    changes(results[auditIndex]) !== 1
  ) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "The private club could not be created.",
    );
  }
  const created = await getOrganizerClubById(
    database,
    identity,
    clubId,
  );
  if (!created) throw clubNotFound();
  return created;
}

export async function updateOrganizerClub(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  clubIdValue: unknown,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<OrganizerClubDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const clubId = parseIdentifier(clubIdValue, "clubId");
  const current = await getOrganizerClubById(
    database,
    identity,
    clubId,
  );
  if (!current) throw clubNotFound();
  const input = parseObject(inputValue);
  assertOnlyKeys(input, [
    "description",
    "name",
    "planningNotes",
    "slug",
  ]);
  const identityFieldsPresent = [
    "description",
    "name",
    "slug",
  ].some((key) => Object.hasOwn(input, key));
  if (!current.identityEditable && identityFieldsPresent) {
    throw new OrganizerAccessDeniedError("role_not_allowed");
  }
  const name =
    input.name === undefined
      ? current.name
      : parseBoundedString(input.name, {
          path: "name",
          minLength: 1,
          maxLength: 120,
        });
  const slug =
    input.slug === undefined ? current.slug : parseSlug(input.slug);
  const description =
    input.description === undefined
      ? current.description
      : parseOptionalBoundedString(input.description, {
          path: "description",
          maxLength: 800,
        });
  const planningNotes =
    input.planningNotes === undefined
      ? current.planningNotes
      : parseOptionalBoundedString(input.planningNotes, {
          path: "planningNotes",
          maxLength: 2_000,
        });
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const batch = [];
  if (current.identityEditable) {
    batch.push(
      database
        .prepare(
          `UPDATE clubs
           SET name = ?, slug = ?, description = ?, updated_at = ?
           WHERE id = ?
             AND organization_id = ?
             AND deleted_at IS NULL
             AND NOT EXISTS (
               SELECT 1
               FROM club_public_profiles
               WHERE club_id = clubs.id
             )
             AND ${COMMIT_ACTOR_GUARD_SQL}`,
        )
        .bind(
          name,
          slug,
          description,
          now,
          clubId,
          actor.organizationId,
          actor.membershipId,
          actor.organizationId,
          actor.profileId,
          identity.email,
        ),
    );
  }
  const settingsIndex = batch.length;
  batch.push(
    privateClubSettingsStatement(
      database,
      actor.organizationId,
      actor.membershipId,
      actor.profileId,
      identity.email,
      clubId,
      planningNotes,
      now,
    ),
  );
  const auditIndex = batch.length;
  const planningSettingsKey = `${CLUB_SETTINGS_PREFIX}${clubId}`;
  const planningSettingsJson = JSON.stringify({ planningNotes });
  batch.push(
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
             FROM clubs
             WHERE id = ?
               AND organization_id = ?
               AND deleted_at IS NULL
               ${
                 current.identityEditable
                   ? `AND name = ?
               AND slug = ?
               AND description IS ?
               AND updated_at = ?
               AND NOT EXISTS (
                 SELECT 1
                 FROM club_public_profiles
                 WHERE club_id = clubs.id
               )`
                   : ""
               }
           ) AND EXISTS (
             SELECT 1
             FROM site_settings
             WHERE organization_id = ?
               AND key = ?
               AND value_json = ?
               AND is_public = 0
               AND updated_by_profile_id = ?
               AND updated_at = ?
           ) AND ${COMMIT_ACTOR_GUARD_SQL}
           THEN 'club.private_settings_updated' ELSE NULL END,
           'club', ?, ?, ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        clubId,
        actor.organizationId,
        ...(current.identityEditable
          ? [name, slug, description, now]
          : []),
        actor.organizationId,
        planningSettingsKey,
        planningSettingsJson,
        actor.profileId,
        now,
        actor.membershipId,
        actor.organizationId,
        actor.profileId,
        identity.email,
        clubId,
        JSON.stringify({
          fields: current.identityEditable
            ? ["description", "name", "planning_notes", "slug"]
            : ["planning_notes"],
        }),
        now,
      ),
  );
  let results: readonly unknown[];
  try {
    results = await database.batch(batch);
  } catch (error) {
    if (isAuditSentinelFailure(error)) {
      await authorizeMembership(database, identity, {
        allowedRoles: ["owner", "administrator"],
      });
      throw new SafeApplicationError(
        "conflict",
        409,
        "The club changed before this update could be applied.",
      );
    }
    throw error;
  }
  if (
    (current.identityEditable && changes(results[0]) !== 1) ||
    changes(results[settingsIndex]) !== 1 ||
    changes(results[auditIndex]) !== 1
  ) {
    await authorizeMembership(database, identity, {
      allowedRoles: ["owner", "administrator"],
    });
    throw new SafeApplicationError(
      "conflict",
      409,
      "The club changed before this update could be applied.",
    );
  }
  const updated = await getOrganizerClubById(
    database,
    identity,
    clubId,
  );
  if (!updated) throw clubNotFound();
  return updated;
}

export async function archivePrivateOrganizerClub(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  clubIdValue: unknown,
  nowUtcMs = Date.now(),
): Promise<Readonly<{ archived: true }>> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const clubId = parseIdentifier(clubIdValue, "clubId");
  const current = await getOrganizerClubById(
    database,
    identity,
    clubId,
  );
  if (!current) throw clubNotFound();
  if (!current.identityEditable) {
    throw new OrganizerAccessDeniedError("role_not_allowed");
  }
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const blockers = await loadClubArchiveBlockers(
    database,
    actor.organizationId,
    clubId,
    now,
  );
  if (hasClubArchiveBlockers(blockers)) {
    throw clubArchiveBlocked(blockers);
  }
  let results: readonly unknown[];
  try {
    results = await database.batch([
      database
        .prepare(
          `UPDATE clubs
           SET deleted_at = ?, updated_at = ?
           WHERE id = ?
             AND organization_id = ?
             AND deleted_at IS NULL
             AND NOT EXISTS (
               SELECT 1
               FROM club_public_profiles
               WHERE club_id = clubs.id
             )
             AND NOT EXISTS (
               SELECT 1
               FROM club_memberships
               WHERE organization_id = clubs.organization_id
                 AND club_id = clubs.id
                 AND status = 'active'
                 AND deleted_at IS NULL
             )
             AND NOT EXISTS (
               SELECT 1
               FROM organizer_events
               WHERE organization_id = clubs.organization_id
                 AND club_id = clubs.id
             )
             AND NOT EXISTS (
               SELECT 1
               FROM events
               WHERE organization_id = clubs.organization_id
                 AND club_id = clubs.id
                 AND deleted_at IS NULL
             )
             AND NOT EXISTS (
               SELECT 1
               FROM sync_sources
               WHERE organization_id = clubs.organization_id
                 AND club_id = clubs.id
                 AND (
                   deleted_at IS NULL
                   OR active_generation_id IS NOT NULL
                   OR pending_generation_id IS NOT NULL
                 )
             )
             AND NOT EXISTS (
               SELECT 1
               FROM programs
               WHERE organization_id = clubs.organization_id
                 AND club_id = clubs.id
                 AND deleted_at IS NULL
             )
             AND NOT EXISTS (
               SELECT 1
               FROM invitations
               WHERE organization_id = clubs.organization_id
                 AND club_id = clubs.id
                 AND revoked_at IS NULL
                 AND used_at IS NULL
                 AND expires_at > ?
             )
             AND ${COMMIT_ACTOR_GUARD_SQL}`,
        )
        .bind(
          now,
          now,
          clubId,
          actor.organizationId,
          now,
          actor.membershipId,
          actor.organizationId,
          actor.profileId,
          identity.email,
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
               FROM clubs
               WHERE id = ?
                 AND organization_id = ?
                 AND deleted_at = ?
             ) AND NOT EXISTS (
               SELECT 1
               FROM audit_logs AS existing_audit
               WHERE existing_audit.organization_id = ?
                 AND existing_audit.action = 'club.archived_private'
                 AND existing_audit.entity_type = 'club'
                 AND existing_audit.entity_id = ?
             ) AND ${COMMIT_ACTOR_GUARD_SQL}
             THEN 'club.archived_private' ELSE NULL END,
             'club', ?, '{}', ?
           )`,
        )
        .bind(
          crypto.randomUUID(),
          actor.organizationId,
          actor.profileId,
          clubId,
          actor.organizationId,
          now,
          actor.organizationId,
          clubId,
          actor.membershipId,
          actor.organizationId,
          actor.profileId,
          identity.email,
          clubId,
          now,
        ),
    ]);
  } catch (error) {
    if (isAuditSentinelFailure(error)) {
      await throwArchiveMutationConflict(
        database,
        identity,
        actor.organizationId,
        clubId,
        now,
      );
    }
    throw error;
  }
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    await throwArchiveMutationConflict(
      database,
      identity,
      actor.organizationId,
      clubId,
      now,
    );
  }
  return Object.freeze({ archived: true as const });
}

type ClubArchiveBlockerState = Readonly<{
  eventCount: number;
  events: readonly ClubArchiveBlocker[];
  invitationCount: number;
  memberCount: number;
  programCount: number;
  sourceCount: number;
}>;

async function loadClubArchiveBlockers(
  database: D1DatabaseLike,
  organizationId: string,
  clubId: string,
  nowUtcMs: number,
): Promise<ClubArchiveBlockerState> {
  const [countsRow, eventRows] = await Promise.all([
    database
      .prepare(
         `SELECT
           (
             SELECT count(*)
             FROM club_memberships
             WHERE organization_id = ?
               AND club_id = ?
               AND status = 'active'
               AND deleted_at IS NULL
           ) AS member_count,
           (
             SELECT count(*)
             FROM sync_sources
             WHERE organization_id = ?
               AND club_id = ?
               AND (
                 deleted_at IS NULL
                 OR active_generation_id IS NOT NULL
                 OR pending_generation_id IS NOT NULL
               )
           ) AS source_count,
           (
             SELECT count(*)
             FROM programs
             WHERE organization_id = ?
               AND club_id = ?
               AND deleted_at IS NULL
           ) AS program_count,
           (
             SELECT count(*)
             FROM invitations
             WHERE organization_id = ?
               AND club_id = ?
               AND revoked_at IS NULL
                AND used_at IS NULL
                AND expires_at > ?
           ) AS invitation_count,
           (
             SELECT count(*)
             FROM organizer_events
             WHERE organization_id = ?
               AND club_id = ?
           ) + (
             SELECT count(*)
             FROM events
             WHERE organization_id = ?
               AND club_id = ?
               AND deleted_at IS NULL
           ) AS event_count`,
      )
      .bind(
        organizationId,
        clubId,
        organizationId,
        clubId,
        organizationId,
        clubId,
        organizationId,
        clubId,
        nowUtcMs,
        organizationId,
        clubId,
        organizationId,
        clubId,
      )
      .first<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT id, title, source
         FROM (
           SELECT id, title, 'manual' AS source, updated_at
           FROM organizer_events
           WHERE organization_id = ?
             AND club_id = ?
           UNION ALL
           SELECT id, title, 'legacy_read_only' AS source, updated_at
           FROM events
           WHERE organization_id = ?
             AND club_id = ?
             AND deleted_at IS NULL
         )
         ORDER BY updated_at DESC, id ASC
         LIMIT 50`,
      )
      .bind(organizationId, clubId, organizationId, clubId)
      .all<Record<string, unknown>>(),
  ]);
  const events = (eventRows.results ?? [])
    .map((row) => {
      const eventId = readString(row.id);
      const title = readString(row.title);
      const source =
        row.source === "manual" || row.source === "legacy_read_only"
          ? row.source
          : null;
      return eventId && title && source
        ? Object.freeze({ eventId, source, title })
        : null;
    })
    .filter((event): event is ClubArchiveBlocker => event !== null);
  return Object.freeze({
    eventCount: readCount(countsRow?.event_count),
    events: Object.freeze(events),
    invitationCount: readCount(countsRow?.invitation_count),
    memberCount: readCount(countsRow?.member_count),
    programCount: readCount(countsRow?.program_count),
    sourceCount: readCount(countsRow?.source_count),
  });
}

function hasClubArchiveBlockers(
  blockers: ClubArchiveBlockerState,
): boolean {
  return (
    blockers.eventCount > 0 ||
    blockers.invitationCount > 0 ||
    blockers.memberCount > 0 ||
    blockers.programCount > 0 ||
    blockers.sourceCount > 0
  );
}

function clubArchiveBlocked(
  blockers: ClubArchiveBlockerState,
): ClubArchiveBlockedError {
  return new ClubArchiveBlockedError(
    blockers.memberCount,
    blockers.events,
    {
      eventCount: blockers.eventCount,
      invitationCount: blockers.invitationCount,
      programCount: blockers.programCount,
      sourceCount: blockers.sourceCount,
    },
  );
}

async function throwArchiveMutationConflict(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  organizationId: string,
  clubId: string,
  nowUtcMs: number,
): Promise<never> {
  await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const blockers = await loadClubArchiveBlockers(
    database,
    organizationId,
    clubId,
    nowUtcMs,
  );
  if (hasClubArchiveBlockers(blockers)) throw clubArchiveBlocked(blockers);
  throw new SafeApplicationError(
    "conflict",
    409,
    "The club changed before it could be archived.",
  );
}

async function getOrganizerClubById(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  clubId: string,
): Promise<OrganizerClubDto | null> {
  const actor = await authorizeMembership(database, identity);
  const row = await database
    .prepare(
      `SELECT club.id,
              club.name,
              club.slug,
              club.description,
              public_profile.publication_status,
              public_profile.public_group_url,
              private_setting.value_json AS private_setting_json
       FROM clubs AS club
       LEFT JOIN club_public_profiles AS public_profile
         ON public_profile.club_id = club.id
        AND public_profile.organization_id = club.organization_id
       LEFT JOIN site_settings AS private_setting
         ON private_setting.organization_id = club.organization_id
        AND private_setting.key = (? || club.id)
        AND private_setting.is_public = 0
       WHERE club.id = ?
         AND club.organization_id = ?
         AND club.deleted_at IS NULL
         AND (
           ? <> 'organizer'
           OR EXISTS (
             SELECT 1
             FROM club_memberships AS assignment
             WHERE assignment.organization_id = club.organization_id
               AND assignment.club_id = club.id
               AND assignment.organization_membership_id = ?
               AND assignment.profile_id = ?
               AND assignment.status = 'active'
               AND assignment.deleted_at IS NULL
           )
         )
       LIMIT 1`,
    )
    .bind(
      CLUB_SETTINGS_PREFIX,
      clubId,
      actor.organizationId,
      actor.role,
      actor.membershipId,
      actor.profileId,
    )
    .first<Record<string, unknown>>();
  return row ? clubFromRow(row) : null;
}

function privateClubSettingsStatement(
  database: D1DatabaseLike,
  organizationId: string,
  actorMembershipId: string,
  actorProfileId: string,
  actorEmail: string,
  clubId: string,
  planningNotes: string | null,
  nowUtcMs: number,
) {
  const valueJson = JSON.stringify({ planningNotes });
  return database
    .prepare(
      `INSERT INTO site_settings (
         id, organization_id, key, value_json, is_public,
         updated_by_profile_id, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, 0, ?, ?, ?
       FROM clubs
       WHERE id = ?
         AND organization_id = ?
         AND deleted_at IS NULL
         AND ${COMMIT_ACTOR_GUARD_SQL}
       ON CONFLICT(organization_id, key) DO UPDATE SET
         value_json = excluded.value_json,
         is_public = 0,
         updated_by_profile_id = excluded.updated_by_profile_id,
         updated_at = excluded.updated_at
       WHERE site_settings.is_public = 0`,
    )
    .bind(
      crypto.randomUUID(),
      organizationId,
      `${CLUB_SETTINGS_PREFIX}${clubId}`,
      valueJson,
      actorProfileId,
      nowUtcMs,
      nowUtcMs,
      clubId,
      organizationId,
      actorMembershipId,
      organizationId,
      actorProfileId,
      actorEmail,
    );
}

function clubFromRow(
  row: Record<string, unknown>,
): OrganizerClubDto | null {
  const id = readString(row.id);
  const name = readString(row.name);
  const slug = readString(row.slug);
  if (!id || !name || !slug) return null;
  const publicationStatus =
    row.publication_status === "published" ||
    row.publication_status === "draft" ||
    row.publication_status === "archived"
      ? row.publication_status
      : null;
  return Object.freeze({
    id,
    name,
    slug,
    description: readNullableString(row.description),
    planningNotes: parsePlanningNotes(row.private_setting_json),
    publicGroupUrl: readNullableString(row.public_group_url),
    publicationState: publicationStatus ?? "private",
    identityEditable: publicationStatus === null,
  });
}

function parsePlanningNotes(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    return readNullableString(Reflect.get(parsed, "planningNotes"));
  } catch {
    return null;
  }
}

function parseSlug(value: unknown): string {
  const slug = parseBoundedString(value, {
    path: "slug",
    minLength: 2,
    maxLength: 100,
  }).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
    throw validationError();
  }
  return slug;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readCount(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : 0;
}

function changes(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  const meta = Reflect.get(result, "meta");
  if (typeof meta !== "object" || meta === null) return 0;
  const value = Reflect.get(meta, "changes");
  return typeof value === "number" ? value : 0;
}

function isAuditSentinelFailure(error: unknown): boolean {
  return /NOT NULL constraint failed: audit_logs\.action/iu.test(
    String(error),
  );
}

function clubNotFound(): SafeApplicationError {
  return new SafeApplicationError(
    "not_found",
    404,
    "The requested club is not available.",
  );
}

function validationError(): SafeApplicationError {
  return new SafeApplicationError(
    "validation_failed",
    422,
    "The request could not be validated.",
  );
}
