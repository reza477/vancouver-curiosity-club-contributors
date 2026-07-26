import {
  OrganizerAccessDeniedError,
  authorizeMembership,
  type D1DatabaseLike,
  type OrganizationRole,
  type TrustedServerIdentity,
} from "../auth";
import {
  assertOnlyKeys,
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  parseObject,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  CALENDAR_COLOR_TOKENS,
  type CalendarColorToken,
} from "./profiles";
import { prepareNotificationInsert } from "./notifications";

export type TeamMemberStatus = "active" | "revoked" | "suspended";

export type TeamMemberDto = Readonly<{
  calendarColor: CalendarColorToken;
  clubs: readonly Readonly<{ id: string; name: string }>[];
  displayName: string;
  email?: string;
  initials: string;
  membershipId: string;
  profileId: string;
  role: OrganizationRole;
  status: TeamMemberStatus;
}>;

export type TeamMutationBlocker = Readonly<{
  clubId: string;
  eventId: string;
  source: "legacy_read_only" | "manual";
  title: string;
}>;

export class TeamMutationBlockedError extends SafeApplicationError {
  readonly blockers: readonly TeamMutationBlocker[];

  constructor(blockers: readonly TeamMutationBlocker[]) {
    super(
      "conflict",
      409,
      "Reassign the listed events before changing this member.",
    );
    this.name = "TeamMutationBlockedError";
    this.blockers = Object.freeze([...blockers]);
  }
}

export async function listTeamMembers(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
): Promise<readonly TeamMemberDto[]> {
  const actor = await authorizeMembership(database, identity);
  const members = await database
    .prepare(
      `SELECT membership.id AS membership_id,
              membership.profile_id,
              membership.normalized_email,
              membership.role,
              membership.status,
              COALESCE(
                preference.workspace_display_name,
                profile.display_name
              ) AS display_name,
              preference.initials,
              preference.calendar_color
       FROM organization_memberships AS membership
       JOIN profiles AS profile
         ON profile.id = membership.profile_id
       LEFT JOIN organizer_profile_preferences AS preference
         ON preference.profile_id = membership.profile_id
        AND preference.organization_id = membership.organization_id
       WHERE membership.organization_id = ?
         AND membership.deleted_at IS NULL
         AND profile.deleted_at IS NULL
       ORDER BY
         CASE membership.role
           WHEN 'owner' THEN 1
           WHEN 'administrator' THEN 2
           ELSE 3
         END,
         COALESCE(
           preference.workspace_display_name,
           profile.display_name,
           membership.normalized_email
         )
           COLLATE NOCASE ASC,
         membership.id ASC
       LIMIT 250`,
    )
    .bind(actor.organizationId)
    .all<Record<string, unknown>>();
  const assignments = await database
    .prepare(
      `SELECT assignment.profile_id, club.id, club.name
       FROM club_memberships AS assignment
       JOIN clubs AS club
         ON club.id = assignment.club_id
        AND club.organization_id = assignment.organization_id
        AND club.deleted_at IS NULL
       WHERE assignment.organization_id = ?
         AND assignment.status = 'active'
         AND assignment.deleted_at IS NULL
       ORDER BY club.name COLLATE NOCASE ASC, club.id ASC
       LIMIT 2000`,
    )
    .bind(actor.organizationId)
    .all<Record<string, unknown>>();

  const clubsByProfile = new Map<
    string,
    Array<Readonly<{ id: string; name: string }>>
  >();
  for (const row of assignments.results ?? []) {
    const profileId = readString(row.profile_id);
    const id = readString(row.id);
    const name = readString(row.name);
    if (!profileId || !id || !name) continue;
    const clubs = clubsByProfile.get(profileId) ?? [];
    clubs.push(Object.freeze({ id, name }));
    clubsByProfile.set(profileId, clubs);
  }

  const canSeeEmails =
    actor.role === "owner" || actor.role === "administrator";
  return Object.freeze(
    (members.results ?? [])
      .map((row) =>
        teamMemberFromRow(
          row,
          clubsByProfile.get(readString(row.profile_id) ?? "") ?? [],
          canSeeEmails,
        ),
      )
      .filter((member): member is TeamMemberDto => member !== null),
  );
}

export async function updateTeamMember(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  membershipIdValue: unknown,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<TeamMemberDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const membershipId = parseIdentifier(
    membershipIdValue,
    "membershipId",
  );
  const input = parseObject(inputValue);
  assertOnlyKeys(input, ["clubIds", "role", "status"]);
  const requestedNow = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });

  const target = await readTeamMemberRecord(
    database,
    actor.organizationId,
    membershipId,
  );
  if (!target) throw teamMemberNotFound();
  const now = Math.max(requestedNow, target.updatedAt + 1);
  if (target.role === "owner") {
    throw new OrganizerAccessDeniedError("role_not_allowed");
  }
  if (
    actor.role === "administrator" &&
    target.role !== "organizer"
  ) {
    throw new OrganizerAccessDeniedError("role_not_allowed");
  }

  const role =
    input.role === undefined
      ? target.role
      : parseEnum(
          input.role,
          ["administrator", "organizer"] as const,
          "role",
        );
  const status =
    input.status === undefined
      ? target.status
      : parseEnum(
          input.status,
          ["active", "suspended", "revoked"] as const,
          "status",
        );
  if (actor.role === "administrator" && role !== "organizer") {
    throw new OrganizerAccessDeniedError("role_not_allowed");
  }
  const existingClubIds = await activeClubIdsForProfile(
    database,
    actor.organizationId,
    target.profileId,
  );
  const clubIds =
    input.clubIds === undefined
      ? role === "organizer"
        ? existingClubIds
        : []
      : parseClubIds(input.clubIds);
  if (role === "organizer" && status === "active" && clubIds.length === 0) {
    throw validationError();
  }
  await validateClubs(
    database,
    actor.organizationId,
    clubIds,
  );

  const removedClubIds = existingClubIds.filter(
    (clubId) => !clubIds.includes(clubId),
  );
  const assignmentRemovalBlockers =
    role === "organizer" ? removedClubIds : [];
  if (
    status !== "active" ||
    assignmentRemovalBlockers.length > 0
  ) {
    const blockers = await findMembershipChangeBlockers(
      database,
      actor.organizationId,
      target.profileId,
      status === "active" ? assignmentRemovalBlockers : null,
    );
    if (blockers.length > 0) {
      throw new TeamMutationBlockedError(blockers);
    }
  }

  const blockerScopeClubIds =
    status === "active" && role === "organizer" ? clubIds : null;
  const membershipBlockerGuard = blockerScopeClubIds === null
    ? status === "active"
      ? ""
      : membershipChangeBlockerGuardSql()
    : membershipChangeBlockerGuardSql(blockerScopeClubIds);
  const membershipBlockerBindings =
    membershipBlockerGuard.length === 0
      ? []
      : membershipChangeBlockerBindings(
          target.profileId,
          blockerScopeClubIds,
        );
  const clubRevocationScope =
    status === "active" && role === "organizer"
      ? `AND club_id NOT IN (${clubIds.map(() => "?").join(", ")})`
      : "";
  const clubRevocationBindings =
    status === "active" && role === "organizer" ? clubIds : [];

  const batch = [
    database
      .prepare(
        `UPDATE organization_memberships
         SET role = ?, status = ?, updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND role <> 'owner'
           AND role = ?
           AND status = ?
           AND updated_at = ?
           AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM organization_memberships AS actor_membership
             JOIN profiles AS actor_profile
               ON actor_profile.id = actor_membership.profile_id
             WHERE actor_membership.id = ?
               AND actor_membership.organization_id =
                   organization_memberships.organization_id
               AND actor_membership.profile_id = ?
               AND actor_membership.role IN ('owner', 'administrator')
               AND actor_membership.status = 'active'
               AND actor_membership.deleted_at IS NULL
               AND actor_profile.status = 'active'
               AND actor_profile.deleted_at IS NULL
               AND (
                 actor_membership.role = 'owner'
                 OR organization_memberships.role = 'organizer'
               )
           )
           ${membershipBlockerGuard}`,
      )
      .bind(
        role,
        status,
        now,
        membershipId,
        actor.organizationId,
        target.role,
        target.status,
        target.updatedAt,
        actor.membershipId,
        actor.profileId,
        ...membershipBlockerBindings,
      ),
    database
      .prepare(
        `UPDATE club_memberships
         SET status = 'revoked', updated_at = ?
         WHERE organization_id = ?
           AND organization_membership_id = ?
           AND profile_id = ?
           AND deleted_at IS NULL
           ${clubRevocationScope}`,
      )
      .bind(
        now,
        actor.organizationId,
        membershipId,
        target.profileId,
        ...clubRevocationBindings,
      ),
  ];
  if (role === "organizer" && status === "active") {
    for (const clubId of clubIds) {
      batch.push(
        database
          .prepare(
            `INSERT INTO club_memberships (
               id, organization_id, club_id,
               organization_membership_id, profile_id,
               role, status, created_by_profile_id,
               created_at, updated_at, deleted_at
             )
             SELECT ?, ?, club.id, ?, ?, 'organizer', 'active',
                    ?, ?, ?, NULL
             FROM clubs AS club
             WHERE club.id = ?
               AND club.organization_id = ?
               AND club.deleted_at IS NULL
             ON CONFLICT(club_id, profile_id) DO UPDATE SET
               organization_id = excluded.organization_id,
               organization_membership_id =
                 excluded.organization_membership_id,
               role = 'organizer',
               status = 'active',
               created_by_profile_id = excluded.created_by_profile_id,
               updated_at = excluded.updated_at,
               deleted_at = NULL`,
          )
          .bind(
            crypto.randomUUID(),
            actor.organizationId,
            membershipId,
            target.profileId,
            actor.profileId,
            now,
            now,
            clubId,
            actor.organizationId,
          ),
      );
    }
  }
  if (target.profileId !== actor.profileId) {
    batch.push(
      prepareNotificationInsert(database, {
        organizationId: actor.organizationId,
        recipientProfileId: target.profileId,
        createdAt: now,
        payload: {
          type: "membership_changed",
          membershipId,
          displayName: target.displayName,
          change:
            role !== target.role
              ? "role"
              : status !== target.status
                ? "status"
                : "clubs",
        },
      }),
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
           CASE WHEN (
             EXISTS (
               SELECT 1
               FROM organization_memberships
               WHERE id = ?
                 AND organization_id = ?
                 AND role = ?
                 AND status = ?
                 AND updated_at = ?
                 AND deleted_at IS NULL
             )
             AND (
               ? <> 'organizer'
               OR ? <> 'active'
               OR (
                 SELECT COUNT(*)
                 FROM club_memberships
                 WHERE organization_id = ?
                   AND organization_membership_id = ?
                   AND profile_id = ?
                   AND status = 'active'
                   AND deleted_at IS NULL
               ) = ?
             )
           ) THEN 'membership.updated' ELSE NULL END,
           'membership', ?, ?, ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        membershipId,
        actor.organizationId,
        role,
        status,
        now,
        role,
        status,
        actor.organizationId,
        membershipId,
        target.profileId,
        clubIds.length,
        membershipId,
        JSON.stringify({
          clubCount: clubIds.length,
          fields: ["clubs", "role", "status"],
          role,
          status,
        }),
        now,
      ),
  );
  let results: readonly unknown[];
  try {
    results = await database.batch(batch);
  } catch (error) {
    if (
      String(error).includes(
        "NOT NULL constraint failed: audit_logs.action",
      )
    ) {
      throw new SafeApplicationError(
        "conflict",
        409,
        "The team member changed before this update could be applied.",
      );
    }
    throw error;
  }
  if (
    changes(results[0]) !== 1 ||
    changes(results[auditIndex]) !== 1
  ) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "The team member changed before this update could be applied.",
    );
  }
  const updated = await getTeamMemberById(
    database,
    identity,
    membershipId,
  );
  if (!updated) throw teamMemberNotFound();
  return updated;
}

export async function transferWorkspaceOwnership(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  targetMembershipIdValue: unknown,
  nowUtcMs = Date.now(),
): Promise<Readonly<{ transferred: true }>> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner"],
  });
  const targetMembershipId = parseIdentifier(
    targetMembershipIdValue,
    "membershipId",
  );
  if (targetMembershipId === actor.membershipId) throw validationError();
  const target = await readTeamMemberRecord(
    database,
    actor.organizationId,
    targetMembershipId,
  );
  if (
    !target ||
    target.status !== "active" ||
    target.role === "owner"
  ) {
    if (!target) throw teamMemberNotFound();
    throw new SafeApplicationError(
      "conflict",
      409,
      "Ownership can be transferred only to an active non-owner member.",
    );
  }
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO ownership_transfer_locks (
           organization_id, actor_profile_id,
           target_membership_id, created_at
         )
         SELECT ?, ?, target.id, ?
         FROM organization_memberships AS target
         JOIN profiles AS target_profile
           ON target_profile.id = target.profile_id
         WHERE target.id = ?
           AND target.organization_id = ?
           AND target.role IN ('administrator', 'organizer')
           AND target.status = 'active'
           AND target.deleted_at IS NULL
           AND target_profile.status = 'active'
           AND target_profile.deleted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM organization_memberships AS actor_membership
             JOIN profiles AS actor_profile
               ON actor_profile.id = actor_membership.profile_id
             WHERE actor_membership.id = ?
               AND actor_membership.organization_id = ?
               AND actor_membership.profile_id = ?
               AND actor_membership.role = 'owner'
               AND actor_membership.status = 'active'
               AND actor_membership.deleted_at IS NULL
               AND actor_profile.status = 'active'
               AND actor_profile.deleted_at IS NULL
           )
           AND (
             SELECT COUNT(*)
             FROM organization_memberships AS current_owner
             WHERE current_owner.organization_id = ?
               AND current_owner.role = 'owner'
               AND current_owner.status = 'active'
               AND current_owner.deleted_at IS NULL
           ) = 1`,
      )
      .bind(
        actor.organizationId,
        actor.profileId,
        now,
        targetMembershipId,
        actor.organizationId,
        actor.membershipId,
        actor.organizationId,
        actor.profileId,
        actor.organizationId,
      ),
    database
      .prepare(
        `UPDATE organization_memberships
         SET role = 'administrator', updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND role = 'owner'
           AND status = 'active'
           AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM ownership_transfer_locks
             WHERE organization_id = ?
               AND actor_profile_id = ?
               AND target_membership_id = ?
           )`,
      )
      .bind(
        now,
        actor.membershipId,
        actor.organizationId,
        actor.organizationId,
        actor.profileId,
        targetMembershipId,
      ),
    database
      .prepare(
        `UPDATE organization_memberships
         SET role = 'owner', updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND role IN ('administrator', 'organizer')
           AND status = 'active'
           AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM ownership_transfer_locks
             WHERE organization_id = ?
               AND actor_profile_id = ?
               AND target_membership_id =
                   organization_memberships.id
           )`,
      )
      .bind(
        now,
        targetMembershipId,
        actor.organizationId,
        actor.organizationId,
        actor.profileId,
      ),
    prepareNotificationInsert(database, {
      organizationId: actor.organizationId,
      recipientProfileId: target.profileId,
      createdAt: now,
      payload: {
        type: "ownership_transferred",
        membershipId: targetMembershipId,
        displayName: target.displayName,
      },
    }),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         )
         VALUES (
           ?, ?, ?,
           CASE WHEN (
             EXISTS (
               SELECT 1
               FROM ownership_transfer_locks
               WHERE organization_id = ?
                 AND actor_profile_id = ?
                 AND target_membership_id = ?
             )
             AND EXISTS (
               SELECT 1
               FROM organization_memberships
               WHERE id = ?
                 AND organization_id = ?
                 AND role = 'administrator'
                 AND status = 'active'
                 AND deleted_at IS NULL
             )
             AND EXISTS (
               SELECT 1
               FROM organization_memberships
               WHERE id = ?
                 AND organization_id = ?
                 AND role = 'owner'
                 AND status = 'active'
                 AND deleted_at IS NULL
             )
           ) THEN 'membership.ownership_transferred' ELSE NULL END,
           'membership', ?, '{}', ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        actor.organizationId,
        actor.profileId,
        targetMembershipId,
        actor.membershipId,
        actor.organizationId,
        targetMembershipId,
        actor.organizationId,
        targetMembershipId,
        now,
      ),
    database
      .prepare(
        `DELETE FROM ownership_transfer_locks
         WHERE organization_id = ?
           AND actor_profile_id = ?
           AND target_membership_id = ?`,
      )
      .bind(
        actor.organizationId,
        actor.profileId,
        targetMembershipId,
      ),
  ]);
  if (
    changes(results[0]) !== 1 ||
    changes(results[1]) !== 1 ||
    changes(results[2]) !== 1 ||
    changes(results[4]) !== 1 ||
    changes(results[5]) !== 1
  ) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "Ownership changed before the transfer could be completed.",
    );
  }
  return Object.freeze({ transferred: true as const });
}

export async function getTeamMemberById(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  membershipIdValue: unknown,
): Promise<TeamMemberDto | null> {
  const actor = await authorizeMembership(database, identity);
  const membershipId = parseIdentifier(
    membershipIdValue,
    "membershipId",
  );
  const row = await readTeamMemberRecord(
    database,
    actor.organizationId,
    membershipId,
  );
  if (!row) return null;
  const clubs = await activeClubsForProfile(
    database,
    actor.organizationId,
    row.profileId,
  );
  return Object.freeze({
    membershipId: row.membershipId,
    profileId: row.profileId,
    displayName: row.displayName,
    initials: row.initials,
    calendarColor: row.calendarColor,
    role: row.role,
    status: row.status,
    clubs: Object.freeze(clubs),
    ...(actor.role === "owner" || actor.role === "administrator"
      ? { email: row.email }
      : {}),
  });
}

async function readTeamMemberRecord(
  database: D1DatabaseLike,
  organizationId: string,
  membershipId: string,
): Promise<
  | Readonly<{
      calendarColor: CalendarColorToken;
      displayName: string;
      email: string;
      initials: string;
      membershipId: string;
      profileId: string;
      role: OrganizationRole;
      status: TeamMemberStatus;
      updatedAt: number;
    }>
  | null
> {
  const row = await database
    .prepare(
      `SELECT membership.id AS membership_id,
              membership.profile_id,
              membership.normalized_email,
              membership.role,
              membership.status,
              membership.updated_at,
              COALESCE(
                preference.workspace_display_name,
                profile.display_name
              ) AS display_name,
              preference.initials,
              preference.calendar_color
       FROM organization_memberships AS membership
       JOIN profiles AS profile
         ON profile.id = membership.profile_id
       LEFT JOIN organizer_profile_preferences AS preference
         ON preference.profile_id = membership.profile_id
        AND preference.organization_id = membership.organization_id
       WHERE membership.id = ?
         AND membership.organization_id = ?
         AND membership.deleted_at IS NULL
         AND profile.deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(membershipId, organizationId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const dto = teamMemberFromRow(row, [], true);
  const updatedAt = readNonnegativeInteger(row.updated_at);
  if (!dto?.email || updatedAt === null) return null;
  return Object.freeze({
    membershipId: dto.membershipId,
    profileId: dto.profileId,
    email: dto.email,
    displayName: dto.displayName,
    initials: dto.initials,
    calendarColor: dto.calendarColor,
    role: dto.role,
    status: dto.status,
    updatedAt,
  });
}

async function activeClubIdsForProfile(
  database: D1DatabaseLike,
  organizationId: string,
  profileId: string,
): Promise<string[]> {
  const clubs = await activeClubsForProfile(
    database,
    organizationId,
    profileId,
  );
  return clubs.map((club) => club.id);
}

async function activeClubsForProfile(
  database: D1DatabaseLike,
  organizationId: string,
  profileId: string,
): Promise<Array<Readonly<{ id: string; name: string }>>> {
  const result = await database
    .prepare(
      `SELECT club.id, club.name
       FROM club_memberships AS assignment
       JOIN clubs AS club
         ON club.id = assignment.club_id
        AND club.organization_id = assignment.organization_id
        AND club.deleted_at IS NULL
       WHERE assignment.organization_id = ?
         AND assignment.profile_id = ?
         AND assignment.status = 'active'
         AND assignment.deleted_at IS NULL
       ORDER BY club.name COLLATE NOCASE ASC, club.id ASC
       LIMIT 100`,
    )
    .bind(organizationId, profileId)
    .all<Record<string, unknown>>();
  return (result.results ?? [])
    .map((row) => {
      const id = readString(row.id);
      const name = readString(row.name);
      return id && name ? Object.freeze({ id, name }) : null;
    })
    .filter(
      (
        club,
      ): club is Readonly<{
        id: string;
        name: string;
      }> => club !== null,
    );
}

async function validateClubs(
  database: D1DatabaseLike,
  organizationId: string,
  clubIds: readonly string[],
): Promise<void> {
  if (clubIds.length === 0) return;
  const placeholders = clubIds.map(() => "?").join(", ");
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS club_count
       FROM clubs
       WHERE organization_id = ?
         AND id IN (${placeholders})
         AND deleted_at IS NULL`,
    )
    .bind(organizationId, ...clubIds)
    .first<Record<string, unknown>>();
  if (row?.club_count !== clubIds.length) throw teamMemberNotFound();
}

function membershipChangeBlockerGuardSql(
  allowedClubIds: readonly string[] | null = null,
): string {
  const clubClause =
    allowedClubIds === null
      ? ""
      : `AND (
             event.club_id IS NULL
             OR event.club_id NOT IN (${allowedClubIds
               .map(() => "?")
               .join(", ")})
           )`;
  return `AND NOT EXISTS (
           SELECT 1
           FROM organizer_events AS event
           LEFT JOIN organizer_event_organizers AS co_organizer
             ON co_organizer.organizer_event_id = event.id
            AND co_organizer.organization_id = event.organization_id
            AND co_organizer.deleted_at IS NULL
           WHERE event.organization_id =
                 organization_memberships.organization_id
             AND (
               event.primary_organizer_profile_id = ?
               OR co_organizer.profile_id = ?
             )
             AND event.planning_status IN ('idea', 'draft')
             AND event.publication_status = 'private'
             ${clubClause}
         )
         AND NOT EXISTS (
           SELECT 1
           FROM events AS event
           LEFT JOIN event_organizers AS organizer
             ON organizer.event_id = event.id
            AND organizer.organization_id = event.organization_id
            AND organizer.deleted_at IS NULL
           WHERE event.organization_id =
                 organization_memberships.organization_id
             AND (
               event.primary_organizer_profile_id = ?
               OR organizer.profile_id = ?
             )
             AND event.deleted_at IS NULL
             AND (
               event.status IN ('hold', 'tentative', 'confirmed')
               OR event.published_at IS NOT NULL
               OR EXISTS (
                 SELECT 1
                 FROM external_source_links AS source_link
                 WHERE source_link.organization_id = event.organization_id
                   AND source_link.entity_type = 'event'
                   AND source_link.entity_id = event.id
                   AND source_link.deleted_at IS NULL
               )
             )
             ${clubClause}
         )`;
}

function membershipChangeBlockerBindings(
  profileId: string,
  allowedClubIds: readonly string[] | null,
): readonly string[] {
  const clubIds = allowedClubIds ?? [];
  return [
    profileId,
    profileId,
    ...clubIds,
    profileId,
    profileId,
    ...clubIds,
  ];
}

async function findMembershipChangeBlockers(
  database: D1DatabaseLike,
  organizationId: string,
  profileId: string,
  removedClubIds: readonly string[] | null,
): Promise<readonly TeamMutationBlocker[]> {
  const clubClause =
    removedClubIds === null
      ? ""
      : removedClubIds.length === 0
        ? "AND 0 = 1"
        : `AND event.club_id IN (${removedClubIds
            .map(() => "?")
            .join(", ")})`;
  const manualStatement = database.prepare(
    `SELECT DISTINCT event.id, event.club_id, event.title
     FROM organizer_events AS event
     LEFT JOIN organizer_event_organizers AS co_organizer
       ON co_organizer.organizer_event_id = event.id
      AND co_organizer.organization_id = event.organization_id
      AND co_organizer.deleted_at IS NULL
     WHERE event.organization_id = ?
       AND (
         event.primary_organizer_profile_id = ?
         OR co_organizer.profile_id = ?
       )
       AND event.planning_status IN ('idea', 'draft')
       AND event.publication_status = 'private'
       ${clubClause}
     ORDER BY event.updated_at DESC, event.id ASC
     LIMIT 50`,
  );
  const manual = removedClubIds
    ? await manualStatement
        .bind(
          organizationId,
          profileId,
          profileId,
          ...removedClubIds,
        )
        .all<Record<string, unknown>>()
    : await manualStatement
        .bind(organizationId, profileId, profileId)
        .all<Record<string, unknown>>();
  const legacyStatement = database.prepare(
    `SELECT DISTINCT event.id, event.club_id, event.title
     FROM events AS event
     LEFT JOIN event_organizers AS organizer
       ON organizer.event_id = event.id
      AND organizer.organization_id = event.organization_id
      AND organizer.deleted_at IS NULL
     WHERE event.organization_id = ?
       AND (
         event.primary_organizer_profile_id = ?
         OR organizer.profile_id = ?
       )
       AND event.deleted_at IS NULL
       AND (
         event.status IN ('hold', 'tentative', 'confirmed')
         OR event.published_at IS NOT NULL
         OR EXISTS (
           SELECT 1
           FROM external_source_links AS source_link
           WHERE source_link.organization_id = event.organization_id
             AND source_link.entity_type = 'event'
             AND source_link.entity_id = event.id
             AND source_link.deleted_at IS NULL
         )
       )
       ${clubClause}
     ORDER BY event.updated_at DESC, event.id ASC
     LIMIT 50`,
  );
  const legacy = removedClubIds
    ? await legacyStatement
        .bind(
          organizationId,
          profileId,
          profileId,
          ...removedClubIds,
        )
        .all<Record<string, unknown>>()
    : await legacyStatement
        .bind(organizationId, profileId, profileId)
        .all<Record<string, unknown>>();

  return Object.freeze([
    ...(manual.results ?? [])
      .map((row) => blockerFromRow(row, "manual"))
      .filter((value): value is TeamMutationBlocker => value !== null),
    ...(legacy.results ?? [])
      .map((row) => blockerFromRow(row, "legacy_read_only"))
      .filter((value): value is TeamMutationBlocker => value !== null),
  ].slice(0, 50));
}

function blockerFromRow(
  row: Record<string, unknown>,
  source: TeamMutationBlocker["source"],
): TeamMutationBlocker | null {
  const eventId = readString(row.id);
  const clubId = readString(row.club_id);
  const title = readString(row.title);
  return eventId && clubId && title
    ? Object.freeze({ eventId, clubId, title, source })
    : null;
}

function teamMemberFromRow(
  row: Record<string, unknown>,
  clubs: readonly Readonly<{ id: string; name: string }>[],
  includeEmail: boolean,
): TeamMemberDto | null {
  const membershipId = readString(row.membership_id);
  const profileId = readString(row.profile_id);
  const email = readString(row.normalized_email);
  const role = readRole(row.role);
  const status = readStatus(row.status);
  if (!membershipId || !profileId || !email || !role || !status) {
    return null;
  }
  const displayName = readString(row.display_name) ?? "Organizer";
  const initials =
    readInitials(row.initials) ?? deriveInitials(displayName);
  const calendarColor =
    CALENDAR_COLOR_TOKENS.find(
      (value) => value === row.calendar_color,
    ) ?? "forest";
  return Object.freeze({
    membershipId,
    profileId,
    displayName,
    initials,
    calendarColor,
    role,
    status,
    clubs: Object.freeze([...clubs]),
    ...(includeEmail ? { email } : {}),
  });
}

function parseClubIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw validationError();
  }
  const ids = value.map((clubId, index) =>
    parseIdentifier(clubId, `clubIds.${index}`),
  );
  if (new Set(ids).size !== ids.length) throw validationError();
  return ids;
}

function readRole(value: unknown): OrganizationRole | null {
  return value === "owner" ||
    value === "administrator" ||
    value === "organizer"
    ? value
    : null;
}

function readStatus(value: unknown): TeamMemberStatus | null {
  return value === "active" ||
    value === "suspended" ||
    value === "revoked"
    ? value
    : null;
}

function readInitials(value: unknown): string | null {
  return typeof value === "string" &&
    /^[\p{L}\p{N}]{1,4}$/u.test(value)
    ? value
    : null;
}

function deriveInitials(displayName: string): string {
  return (
    displayName
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("")
      .toLocaleUpperCase("en-CA")
      .slice(0, 4) || "O"
  );
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
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

function teamMemberNotFound(): SafeApplicationError {
  return new SafeApplicationError(
    "not_found",
    404,
    "The requested team member is not available.",
  );
}

function validationError(): SafeApplicationError {
  return new SafeApplicationError(
    "validation_failed",
    422,
    "The request could not be validated.",
  );
}
