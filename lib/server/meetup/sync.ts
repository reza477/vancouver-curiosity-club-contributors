import {
  authorizeMembership,
  revalidateAuthorizedMembership,
} from "../auth";
import type {
  AuthorizedMembership,
  D1DatabaseLike,
  D1ResultLike,
  TrustedServerIdentity,
} from "../auth";
import {
  parseFiniteInteger,
  parseIdentifier,
  validationIssue,
} from "../../validation";
import {
  calendarDateInTimeZone,
  DEFAULT_TIME_ZONE,
} from "../../time";
import { MeetupSyncError, MEETUP_SYNC_ERROR_CODES } from "./errors";
import type { MeetupSyncErrorCode } from "./errors";
import { fetchMeetupCalendar } from "./fetch";
import { fetchMeetupGroupEvents } from "./group-events";
import type { ParsedMeetupCalendar, ParsedMeetupEvent } from "./ics";
import { parseMeetupIcs } from "./ics";
import type {
  MeetupConnectionState,
  MeetupRefreshCounts,
  MeetupRefreshResult,
} from "./types";
import { parseMeetupGroupCalendarFeedUrl } from "./url";
import {
  MEETUP_EVENT_ALIASES,
  MEETUP_EVENT_ALIAS_POLICY_VERSION,
  meetupEventAliasForUrl,
} from "./event-aliases";
import { assertMeetupProgramClubMapping } from "./clubs";
import { classifyMeetupEventLane } from "./event-lane-classifier";
import {
  externalReservationSemanticFingerprint,
  externalReservationStateFingerprint,
  normalizeAllDayConflictInterval,
  normalizeConflictInterval,
} from "../organizer/conflict-domain";

const SOURCE_TYPE = "meetup_ics";
const MEETUP_IMPORT_POLICY_VERSION = "meetup_group_page_import_v4";
const ALIAS_SOURCE_GROUP_SLUGS = Object.freeze(
  new Set(
    MEETUP_EVENT_ALIASES.map(
      (entry) => new URL(entry.aliasUrl).pathname.split("/")[1] ?? "",
    ),
  ),
);
/**
 * The mutable `events` row is only the stable content/relationship anchor for
 * a Meetup record. Source-native planning state is owned by the immutable
 * generation snapshot and its normalized reservation sidecar. Keeping this
 * anchor non-reserving prevents the legacy Phase 1 proof triggers from
 * becoming a second source-activation path (and lets all-day source records
 * remain calendar dates rather than fake timed reservations).
 */
const SOURCE_CANONICAL_EVENT_STATUS = "draft";
const REFRESH_INTERVAL_MS = 15 * 60_000;
const STALE_AFTER_MS = 30 * 60_000;
const LEASE_DURATION_MS = 2 * 60_000;
const CONFIGURE_ACTOR_GUARD_SQL = `EXISTS (
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
    AND actor_membership.role = ?
    AND actor_membership.status = 'active'
    AND actor_membership.deleted_at IS NULL
    AND actor_profile.status = 'active'
    AND actor_profile.deleted_at IS NULL
)`;
// The manual API route also pays the runtime invariant preflight and its
// server-side identity envelope. Two rows keep the complete Worker invocation
// below D1's 50-statement ceiling even on the densest successful row shape.
export const MAX_MEETUP_ROWS_PER_REFRESH = 2;
const MAX_MEETUP_ROWS_PER_SCHEDULED_REFRESH = 2;

type SourceRecord = Readonly<{
  clubId: string;
  enabled: boolean;
  etag: string | null;
  httpLastModified: string | null;
  id: string;
  lastAttemptAt: number | null;
  lastErrorAt: number | null;
  lastErrorCode: MeetupSyncErrorCode | null;
  lastSuccessAt: number | null;
  leaseExpiresAt: number | null;
  leaseToken: string | null;
  nextRefreshAt: number | null;
  organizationId: string;
  activeGenerationId: string | null;
  pendingCursor: number | null;
  pendingGenerationId: string | null;
  pendingSnapshotHash: string | null;
  sourceUrl: string;
  updatedByProfileId: string;
}>;

type SourceMapping = Readonly<{
  allDayEndDateExclusive: string | null;
  allDayStartDate: string | null;
  endsAtUtc: number | null;
  eventId: string | null;
  externalUrl: string | null;
  fingerprint: string | null;
  linkId: string;
  organizerScope: readonly string[];
  organizerScopeJson: string;
  primaryOrganizerProfileId: string | null;
  scheduleVersion: number | null;
  sourceLastModifiedAt: number | null;
  sourceSequence: number | null;
  syncSourceId: string | null;
  startsAtUtc: number | null;
  status: string | null;
  timeKind: string | null;
  timeZone: string | null;
  title: string | null;
  venueId: string | null;
}>;

type AliasCanonicalTarget = Readonly<{
  eventId: string;
  resourceMapping: SourceMapping;
}>;

type RefreshMode = "if_due" | "manual";
type RefreshTriggerMode = "manual" | "scheduled";
type ManualRefreshAuthority = Readonly<{
  identity: TrustedServerIdentity;
  membership: AuthorizedMembership;
}>;
const EXACT_MANUAL_ACTOR_GUARD_SQL = `EXISTS (
  SELECT 1
  FROM organization_memberships AS manual_actor_membership
  JOIN profiles AS manual_actor_profile
    ON manual_actor_profile.id = manual_actor_membership.profile_id
   AND manual_actor_profile.normalized_email = ?
   AND manual_actor_profile.status = 'active'
   AND manual_actor_profile.deleted_at IS NULL
  JOIN organizations AS manual_actor_organization
    ON manual_actor_organization.id =
       manual_actor_membership.organization_id
   AND manual_actor_organization.deleted_at IS NULL
  WHERE manual_actor_membership.id = ?
    AND manual_actor_membership.organization_id = ?
    AND manual_actor_membership.profile_id = ?
    AND manual_actor_membership.normalized_email = ?
    AND manual_actor_membership.role = ?
    AND manual_actor_membership.role IN ('owner', 'administrator')
    AND manual_actor_membership.status = 'active'
    AND manual_actor_membership.deleted_at IS NULL
)`;

function manualActorBindings(
  authority: ManualRefreshAuthority,
): readonly string[] {
  return Object.freeze([
    authority.identity.email,
    authority.membership.membershipId,
    authority.membership.organizationId,
    authority.membership.profileId,
    authority.identity.email,
    authority.membership.role,
  ]);
}

function manualActorWhereClause(
  authority: ManualRefreshAuthority | null,
): Readonly<{ bindings: readonly string[]; sql: string }> {
  if (!authority) {
    return Object.freeze({
      bindings: Object.freeze([]),
      sql: "",
    });
  }
  return Object.freeze({
    bindings: manualActorBindings(authority),
    sql: `AND ${EXACT_MANUAL_ACTOR_GUARD_SQL}`,
  });
}

type PendingGeneration = Readonly<{
  cursor: number;
  id: string;
  snapshotHash: string;
}>;

type CalendarWorkItem =
  | Readonly<{
      componentIndex: number;
      errorCode: string;
      kind: "rejected";
    }>
  | Readonly<{
      duplicate: boolean;
      event: ParsedMeetupEvent;
      kind: "event";
    }>;

const EMPTY_COUNTS: MeetupRefreshCounts = Object.freeze({
  cancelled: 0,
  created: 0,
  rejected: 0,
  removed: 0,
  updated: 0,
});

export async function configureMeetupCalendarSource(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  input: Readonly<{ clubId: unknown; feedUrl: unknown }>,
  nowUtcMs = Date.now(),
): Promise<MeetupConnectionState> {
  const requestedClubId = parseIdentifier(input.clubId, "clubId");
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
    clubId: requestedClubId,
  });
  const parsedSource = parseMeetupGroupCalendarFeedUrl(input.feedUrl);
  const clubId = await assertMeetupProgramClubMapping(database, actor, {
    clubId: requestedClubId,
    meetupGroupSlug: parsedSource.groupSlug,
  });
  const sourceUrl = parsedSource.url;
  const now = parseNow(nowUtcMs);
  const exactSource = await database
    .prepare(
      `SELECT id, club_id
       FROM sync_sources
       WHERE organization_id = ?
         AND source_type = ?
         AND source_url = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(actor.organizationId, SOURCE_TYPE, sourceUrl)
    .first<Record<string, unknown>>();
  if (exactSource) {
    if (readOptionalString(exactSource, "club_id") !== clubId) {
      await revalidateAuthorizedMembership(database, identity, actor, {
        allowedRoles: ["owner", "administrator"],
        clubId,
      });
      throw validationIssue(
        "feedUrl",
        "meetup_feed_already_connected",
        "This official Meetup feed is already assigned to another program.",
      );
    }
    return connectionStateForAuthorizedActor(
      database,
      identity,
      actor,
      now,
    );
  }
  const existingSource = await database
    .prepare(
      `SELECT id, source_url
       FROM sync_sources
       WHERE organization_id = ?
         AND club_id = ?
         AND source_type = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(actor.organizationId, clubId, SOURCE_TYPE)
    .first<Record<string, unknown>>();
  if (
    existingSource &&
    readOptionalString(existingSource, "source_url") === sourceUrl
  ) {
    return connectionStateForAuthorizedActor(
      database,
      identity,
      actor,
      now,
    );
  }
  if (existingSource) {
    await revalidateAuthorizedMembership(database, identity, actor, {
      allowedRoles: ["owner", "administrator"],
      clubId,
    });
    throw validationIssue(
      "clubId",
      "meetup_program_already_connected",
      "The selected program already has an official Meetup feed.",
    );
  }
  const sourceId = crypto.randomUUID();

  let results: readonly D1ResultLike[];
  try {
    results = await database.batch([
      database
        .prepare(
          `INSERT INTO sync_sources (
           id, organization_id, club_id, source_type, source_url, enabled,
           refresh_interval_minutes, next_refresh_at, lease_token,
            lease_expires_at, last_attempt_at, last_success_at, last_error_at,
            last_error_code, etag, http_last_modified,
            active_generation_id, pending_generation_id,
            pending_snapshot_hash, pending_cursor,
            created_by_profile_id, updated_by_profile_id,
            created_at, updated_at, deleted_at
           )
           SELECT
             ?, ?, selected_club.id, ?, ?, 1, 15, ?,
             NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
             NULL, NULL, NULL, NULL, ?, ?, ?, ?, NULL
           FROM clubs AS selected_club
           WHERE selected_club.id = ?
             AND selected_club.organization_id = ?
             AND selected_club.deleted_at IS NULL
             AND ${CONFIGURE_ACTOR_GUARD_SQL}`,
        )
        .bind(
          sourceId,
          actor.organizationId,
          SOURCE_TYPE,
          sourceUrl,
          now,
          actor.profileId,
          actor.profileId,
          now,
          now,
          clubId,
          actor.organizationId,
          actor.membershipId,
          actor.organizationId,
          actor.profileId,
          identity.email,
          actor.role,
        ),
      database
        .prepare(
          `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         ) VALUES (
           ?, ?, ?,
           CASE WHEN EXISTS (
             SELECT 1
             FROM sync_sources AS source
             JOIN clubs AS source_club
               ON source_club.id = source.club_id
              AND source_club.organization_id = source.organization_id
              AND source_club.deleted_at IS NULL
             WHERE source.id = ?
               AND source.organization_id = ?
               AND source.club_id = ?
               AND source.deleted_at IS NULL
           ) AND ${CONFIGURE_ACTOR_GUARD_SQL}
           THEN 'meetup.connection_configured' ELSE NULL END,
           'sync_source', ?, ?, ?
         )`,
        )
        .bind(
          crypto.randomUUID(),
          actor.organizationId,
          actor.profileId,
          sourceId,
          actor.organizationId,
          clubId,
          actor.membershipId,
          actor.organizationId,
          actor.profileId,
          identity.email,
          actor.role,
          sourceId,
          JSON.stringify({
            sourceType: SOURCE_TYPE,
          }),
          now,
        ),
    ]);
  } catch (error) {
    if (isConfigureAuditSentinelFailure(error)) {
      await revalidateAuthorizedMembership(database, identity, actor, {
        allowedRoles: ["owner", "administrator"],
        clubId,
      });
      throw validationIssue(
        "clubId",
        "meetup_connection_changed",
        "The selected Meetup connection changed before it could be saved.",
      );
    }
    throw error;
  }
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    await revalidateAuthorizedMembership(database, identity, actor, {
      allowedRoles: ["owner", "administrator"],
      clubId,
    });
    throw validationIssue(
      "clubId",
      "meetup_connection_changed",
      "The selected Meetup connection changed before it could be saved.",
    );
  }
  return connectionStateForAuthorizedActor(
    database,
    identity,
    actor,
    now,
  );
}

export async function getMeetupConnectionState(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  nowUtcMs = Date.now(),
): Promise<MeetupConnectionState> {
  const actor = await authorizeMembership(database, identity);
  const state = await connectionStateForOrganization(
    database,
    actor.organizationId,
    parseNow(nowUtcMs),
  );
  await revalidateAuthorizedMembership(database, identity, actor);
  return state;
}

export async function refreshMeetupCalendarSource(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  options: Readonly<{
    clubId?: unknown;
    clock?: () => number;
    fetcher?: typeof fetch;
    groupPageFetcher?: typeof fetch;
    nowUtcMs?: number;
  }> = {},
): Promise<MeetupRefreshResult> {
  const clubId =
    options.clubId === undefined
      ? null
      : parseIdentifier(options.clubId, "clubId");
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
    clubId: clubId ?? undefined,
  });
  const sources = await readSourcesForOrganization(
    database,
    actor.organizationId,
    clubId,
  );
  return refreshSources(
    database,
    sources,
    "manual",
    options.fetcher,
    options.groupPageFetcher,
    parseNow(options.nowUtcMs ?? Date.now()),
    Object.freeze({
      identity,
      membership: actor,
    }),
    options.clock ??
      (() => parseNow(options.nowUtcMs ?? Date.now())),
  );
}

/**
 * Explicit, due-gated server refresh path for trusted maintenance jobs. It
 * derives the actor from the configured source and never accepts client
 * identity, role, or actor fields.
 */
export async function refreshMeetupCalendarSourceIfDue(
  database: D1DatabaseLike,
  options: Readonly<{
    fetcher?: typeof fetch;
    groupPageFetcher?: typeof fetch;
    clock?: () => number;
    nowUtcMs?: number;
    organizationId?: string;
  }> = {},
): Promise<MeetupRefreshResult> {
  const now = parseNow(options.nowUtcMs ?? Date.now());
  const sources = options.organizationId
    ? await readSourcesForOrganization(
        database,
        parseIdentifier(options.organizationId, "organizationId"),
        null,
      )
    : await readAllConfiguredSources(database);
  if (sources.length === 0) {
    return Object.freeze({
      counts: EMPTY_COUNTS,
      outcome: "not_connected" as const,
      state: notConnectedState(),
    });
  }
  return refreshSources(
    database,
    sources,
    "if_due",
    options.fetcher,
    options.groupPageFetcher,
    now,
    null,
    options.clock ??
      (() => parseNow(options.nowUtcMs ?? Date.now())),
  );
}

async function refreshSources(
  database: D1DatabaseLike,
  sources: readonly SourceRecord[],
  mode: RefreshMode,
  fetcher: typeof fetch | undefined,
  groupPageFetcher: typeof fetch | undefined,
  now: number,
  manualAuthority: ManualRefreshAuthority | null,
  clock: () => number,
): Promise<MeetupRefreshResult> {
  if (sources.length === 0) {
    await sealManualRefreshAuthority(database, manualAuthority);
    return result("not_connected", notConnectedState());
  }
  const enabled = sources.filter((source) => source.enabled);
  if (enabled.length === 0) {
    await sealManualRefreshAuthority(database, manualAuthority);
    return result("disabled", aggregateConnectionState(sources, now));
  }

  const ordered = [...enabled].sort((left, right) => {
    // Canonical/independent groups must be publishable before an alias-bearing
    // group can safely resume or begin. Pending work still wins within the
    // same dependency class, but cannot starve its canonical prerequisite.
    const leftDependency = meetupSourceDependencyPriority(left);
    const rightDependency = meetupSourceDependencyPriority(right);
    if (leftDependency !== rightDependency) {
      return leftDependency - rightDependency;
    }
    const leftPending = left.pendingGenerationId === null ? 1 : 0;
    const rightPending = right.pendingGenerationId === null ? 1 : 0;
    if (leftPending !== rightPending) return leftPending - rightPending;
    const leftAttempt = left.lastAttemptAt ?? -1;
    const rightAttempt = right.lastAttemptAt ?? -1;
    if (leftAttempt !== rightAttempt) return leftAttempt - rightAttempt;
    return left.id.localeCompare(right.id);
  });
  const eligible =
    mode === "manual"
      ? ordered
      : ordered.filter(
          (source) =>
            (source.nextRefreshAt === null ||
              source.nextRefreshAt <= now) &&
            (source.leaseExpiresAt === null ||
              source.leaseExpiresAt <= now),
        );
  const source = eligible[0];
  if (!source) {
    const busy = enabled.some(
      (item) =>
        item.leaseExpiresAt !== null && item.leaseExpiresAt > now,
    );
    await sealManualRefreshAuthority(database, manualAuthority);
    return result(
      busy ? "busy" : "not_due",
      aggregateConnectionState(sources, now),
    );
  }

  // One source per invocation is intentional. Together with the bounded row
  // slice below this stays below D1's documented Free Worker query ceiling.
  return refreshOrganizationSource(database, {
    actorProfileId:
      manualAuthority?.membership.profileId ?? source.updatedByProfileId,
    fetcher,
    groupPageFetcher,
    mode,
    now,
    organizationId: source.organizationId,
    manualAuthority,
    source,
    clock,
  });
}

function meetupSourceDependencyPriority(source: SourceRecord): number {
  const { groupSlug } = parseMeetupGroupCalendarFeedUrl(source.sourceUrl);
  return ALIAS_SOURCE_GROUP_SLUGS.has(groupSlug) ? 1 : 0;
}

async function refreshOrganizationSource(
  database: D1DatabaseLike,
  input: Readonly<{
    actorProfileId: string;
    fetcher?: typeof fetch;
    groupPageFetcher?: typeof fetch;
    mode: RefreshMode;
    now: number;
    organizationId: string;
    manualAuthority: ManualRefreshAuthority | null;
    source: SourceRecord;
    clock: () => number;
  }>,
): Promise<MeetupRefreshResult> {
  const triggerMode: RefreshTriggerMode =
    input.mode === "manual" ? "manual" : "scheduled";
  const initialSource = input.source;
  const manualActorWhere = manualActorWhereClause(
    input.manualAuthority,
  );

  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = input.now + LEASE_DURATION_MS;
  const acquiredSourceRow = await database
    .prepare(
      `UPDATE sync_sources
       SET lease_token = ?,
           lease_expires_at = ?,
           last_attempt_at = ?,
           updated_by_profile_id = ?,
           updated_at = ?
       WHERE id = ?
         AND organization_id = ?
         AND enabled = 1
         AND deleted_at IS NULL
         AND (
           lease_token IS NULL
           OR lease_expires_at IS NULL
           OR lease_expires_at <= ?
         )
         AND (
           ? = 'manual'
           OR next_refresh_at IS NULL
           OR next_refresh_at <= ?
         )
         ${manualActorWhere.sql}
       RETURNING id, organization_id, club_id, source_url, enabled,
                 next_refresh_at, lease_token, lease_expires_at,
                 last_attempt_at, last_success_at, last_error_at,
                 last_error_code, etag, http_last_modified,
                 active_generation_id, pending_generation_id,
                 pending_snapshot_hash, pending_cursor,
                 updated_by_profile_id`,
    )
    .bind(
      leaseToken,
      leaseExpiresAt,
      input.now,
      input.actorProfileId,
      input.now,
      initialSource.id,
      input.organizationId,
      input.now,
      input.mode,
      input.now,
      ...manualActorWhere.bindings,
    )
    .first<Record<string, unknown>>();
  if (!acquiredSourceRow) {
    const current = await readSourceById(database, initialSource.id);
    if (!current) {
      await sealManualRefreshAuthority(
        database,
        input.manualAuthority,
      );
      return result("not_connected", notConnectedState());
    }
    if (!current.enabled) {
      await sealManualRefreshAuthority(
        database,
        input.manualAuthority,
      );
      return result(
        "disabled",
        stateFromSource(current, input.now),
      );
    }
    const outcome =
      current.leaseToken &&
      current.leaseExpiresAt !== null &&
      current.leaseExpiresAt > input.now
        ? "busy"
        : "not_due";
    await sealManualRefreshAuthority(
      database,
      input.manualAuthority,
    );
    return result(outcome, stateFromSource(current, input.now));
  }

  const source = sourceRecord(acquiredSourceRow);
  if (source.leaseToken !== leaseToken) {
    throw new MeetupSyncError("lease_lost");
  }

  let calendar: ParsedMeetupCalendar;
  let responseEtag: string | null = null;
  let responseHttpLastModified: string | null = null;
  try {
    if (input.groupPageFetcher !== undefined || input.fetcher === undefined) {
      const { groupSlug } = parseMeetupGroupCalendarFeedUrl(source.sourceUrl);
      calendar = await fetchMeetupGroupEvents(groupSlug, {
        fetcher: input.groupPageFetcher,
      });
    } else {
      // The explicit legacy fetcher hook keeps the mature iCalendar importer
      // deterministic in its existing unit/integration suite. Production
      // calls do not pass it and use the complete public group-page snapshot
      // above, because Meetup's calendar export truncates the main group.
      const fetched = await fetchMeetupCalendar(source.sourceUrl, {
        // A partial generation must be fetched again so the cursor can resume
        // against the same bounded snapshot; a conditional 304 would not carry
        // the calendar body needed for the remaining slice.
        etag: source.pendingGenerationId ? null : source.etag,
        fetcher: input.fetcher,
        httpLastModified: source.pendingGenerationId
          ? null
          : source.httpLastModified,
      });
      if (fetched.status === "not_modified") {
        if (source.pendingGenerationId !== null) {
          return finalizeFailedRefresh(
            database,
            source,
            leaseToken,
            input.actorProfileId,
            "calendar_invalid",
            input.now,
            null,
            triggerMode,
            input.manualAuthority,
          );
        }
        await finalizeNotModified(
          database,
          source,
          leaseToken,
          input.actorProfileId,
          input.now,
          fetched.etag,
          fetched.httpLastModified,
          triggerMode,
          input.manualAuthority,
        );
        const state = await connectionStateForOrganization(
          database,
          input.organizationId,
          input.now,
        );
        await sealManualRefreshAuthority(
          database,
          input.manualAuthority,
        );
        return result("not_modified", state);
      }
      calendar = parseMeetupIcs(fetched.calendarText);
      responseEtag = fetched.etag;
      responseHttpLastModified = fetched.httpLastModified;
    }
  } catch (error) {
    return finalizeFailedRefresh(
      database,
      source,
      leaseToken,
      input.actorProfileId,
      safeSyncErrorCode(error),
      input.now,
      null,
      triggerMode,
      input.manualAuthority,
    );
  }

  const workItems = buildCalendarWorkItems(calendar);
  const snapshotHash = await calendarSnapshotHash(calendar.method, workItems);
  let generation: PendingGeneration;
  try {
    generation = await ensurePendingGeneration(database, {
      actorProfileId: input.actorProfileId,
      expectedItemCount: workItems.length,
      leaseToken,
      now: parseNow(input.clock()),
      snapshotHash,
      source,
      manualAuthority: input.manualAuthority,
    });
  } catch (error) {
    return finalizeFailedRefresh(
      database,
      source,
      leaseToken,
      input.actorProfileId,
      safeSyncErrorCode(error),
      parseNow(input.clock()),
      null,
      triggerMode,
      input.manualAuthority,
    );
  }
  const cursor = generation.cursor;
  const maxRows =
    input.mode === "manual"
      ? MAX_MEETUP_ROWS_PER_REFRESH
      : MAX_MEETUP_ROWS_PER_SCHEDULED_REFRESH;
  const workSlice = workItems.slice(
    cursor,
    cursor + maxRows,
  );
  const nextCursor = cursor + workSlice.length;
  const hasMore = nextCursor < workItems.length;

  const importBatchId = crypto.randomUUID();
  const batchNow = parseNow(input.clock());
  const importBatchActorWhere = manualActorWhereClause(
    input.manualAuthority,
  );
  const batchCreated = await database
    .prepare(
      `INSERT INTO import_batches (
         id, organization_id, source_type, source_label, status,
         created_by_profile_id, created_at, completed_at
       )
       SELECT ?, organization_id, ?, ?, 'processing', ?, ?, NULL
       FROM sync_sources
       WHERE id = ?
         AND lease_token = ?
         AND lease_expires_at > ?
         AND deleted_at IS NULL
         ${importBatchActorWhere.sql}`,
    )
    .bind(
      importBatchId,
      SOURCE_TYPE,
      "Meetup calendar",
      input.actorProfileId,
      batchNow,
      source.id,
      leaseToken,
      batchNow,
      ...importBatchActorWhere.bindings,
    )
    .run();
  if (changes(batchCreated) !== 1) {
    await sealManualRefreshAuthority(
      database,
      input.manualAuthority,
      Object.freeze({
        leaseToken,
        organizationId: source.organizationId,
        sourceId: source.id,
      }),
    );
    throw new MeetupSyncError("lease_lost");
  }

  const mutableCounts = {
    cancelled: 0,
    created: 0,
    rejected: 0,
    removed: 0,
    updated: 0,
  };
  try {
    for (const item of workSlice) {
      const rowNow = parseNow(input.clock());
      if (item.kind === "rejected") {
        await recordRejectedRow(database, {
          actorProfileId: input.actorProfileId,
          errorCode: item.errorCode,
          importBatchId,
          leaseToken,
          now: rowNow,
          organizationId: source.organizationId,
          rowNumber: item.componentIndex + 1,
          sourceId: source.id,
          sourcePayload: {
            componentIndex: item.componentIndex,
          },
          manualAuthority: input.manualAuthority,
        });
        mutableCounts.rejected += 1;
        continue;
      }

      const event = item.event;
      const identityHash = await sourceIdentityHash(source.id, event);
      if (item.duplicate) {
        await recordRejectedRow(database, {
          actorProfileId: input.actorProfileId,
          errorCode: "duplicate_source_identity",
          importBatchId,
          leaseToken,
          now: rowNow,
          organizationId: source.organizationId,
          rowNumber: event.componentIndex + 1,
          sourceId: source.id,
          sourcePayload: sanitizedSourceFacts(event, identityHash),
          manualAuthority: input.manualAuthority,
        });
        mutableCounts.rejected += 1;
        continue;
      }

      try {
        const rowResult = await importEventRow(database, {
          actorProfileId: input.actorProfileId,
          clubId: source.clubId,
          event,
          generationId: generation.id,
          identityHash,
          importBatchId,
          leaseToken,
          now: rowNow,
          organizationId: source.organizationId,
          sourceId: source.id,
          manualAuthority: input.manualAuthority,
        });
        if (rowResult === "created") mutableCounts.created += 1;
        if (rowResult === "updated") mutableCounts.updated += 1;
        if (event.status === "cancelled" && rowResult !== "skipped") {
          mutableCounts.cancelled += 1;
        }
      } catch (error) {
        if (!isConflictRejection(error)) throw error;
        await recordRejectedRow(database, {
          actorProfileId: input.actorProfileId,
          errorCode: "conflict_rejected",
          importBatchId,
          leaseToken,
          now: rowNow,
          organizationId: source.organizationId,
          rowNumber: event.componentIndex + 1,
          sourceId: source.id,
          sourcePayload: sanitizedSourceFacts(event, identityHash),
          manualAuthority: input.manualAuthority,
        });
        mutableCounts.rejected += 1;
      }
    }

    const counts = Object.freeze({ ...mutableCounts });
    const finishNow = parseNow(input.clock());
    if (hasMore) {
      await finalizePartialRefresh(database, {
        actorProfileId: input.actorProfileId,
        counts,
        importBatchId,
        leaseToken,
        nextCursor,
        now: finishNow,
        snapshotHash,
        generationId: generation.id,
        processedItemCount: workSlice.length,
        source,
        triggerMode,
        manualAuthority: input.manualAuthority,
      });
    } else {
      const removed = await finalizeCompletedRefresh(database, {
        actorProfileId: input.actorProfileId,
        counts,
        etag: responseEtag,
        generationId: generation.id,
        httpLastModified: responseHttpLastModified,
        importBatchId,
        leaseToken,
        now: finishNow,
        processedItemCount: workSlice.length,
        snapshotHash,
        source,
        triggerMode,
        manualAuthority: input.manualAuthority,
      });
      mutableCounts.removed = removed;
    }
    const finalCounts = Object.freeze({ ...mutableCounts });
    const state = await connectionStateForOrganization(
      database,
      input.organizationId,
      finishNow,
    );
    await sealManualRefreshAuthority(
      database,
      input.manualAuthority,
    );
    return Object.freeze({
      counts: finalCounts,
      outcome: hasMore ? ("partial" as const) : ("completed" as const),
      state,
    });
  } catch (error) {
    return finalizeFailedRefresh(
      database,
      source,
      leaseToken,
      input.actorProfileId,
      safeSyncErrorCode(error),
      parseNow(input.clock()),
      importBatchId,
      triggerMode,
      input.manualAuthority,
    );
  }
}

async function importEventRow(
  database: D1DatabaseLike,
  input: Readonly<{
    actorProfileId: string;
    clubId: string;
    event: ParsedMeetupEvent;
    generationId: string;
    identityHash: string;
    importBatchId: string;
    leaseToken: string;
    now: number;
    organizationId: string;
    sourceId: string;
    manualAuthority: ManualRefreshAuthority | null;
  }>,
): Promise<"created" | "skipped" | "updated"> {
  const fingerprint = await eventFingerprint(input.event);
  const eventAlias = meetupEventAliasForUrl(input.event.eventUrl);
  if (eventAlias) {
    await importAliasedEventRow(database, {
      ...input,
      canonicalAliasUrl: eventAlias.canonicalUrl,
      fingerprint,
      maxTimedEndDriftMs: eventAlias.maxTimedEndDriftMs ?? 0,
    });
    return "skipped";
  }
  const mapping = await readSourceMapping(
    database,
    input.organizationId,
    input.sourceId,
    input.identityHash,
  );
  if (mapping && isStaleSourceRevision(mapping, input.event, input.sourceId)) {
    await recordSkippedRow(database, {
      ...input,
      existingMapping: mapping,
      eventId: mapping.eventId ?? mapping.linkId,
      fingerprint: mapping.fingerprint ?? fingerprint,
      linkId: mapping.linkId,
      staleRevision: true,
    });
    return "skipped";
  }
  if (
    mapping?.eventId &&
    mapping.fingerprint === fingerprint &&
    mappingMatchesEvent(mapping, input.event)
  ) {
    await recordSkippedRow(database, {
      ...input,
      existingMapping: mapping,
      eventId: mapping.eventId,
      fingerprint,
      linkId: mapping.linkId,
      staleRevision: false,
    });
    return "skipped";
  }

  if (mapping?.eventId && mapping.scheduleVersion !== null) {
    await updateMappedEvent(database, {
      ...input,
      eventId: mapping.eventId,
      existingMapping: mapping,
      expectedScheduleVersion: mapping.scheduleVersion,
      fingerprint,
      linkId: mapping.linkId,
      scheduleChanged: !mappingScheduleMatchesEvent(mapping, input.event),
    });
    return "updated";
  }

  if (
    input.event.status !== "cancelled" &&
    (await hasAuthoritativeReservationCollision(
      database,
      input.organizationId,
      input.event,
      input.now,
    ))
  ) {
    throw new MeetupSyncError("conflict_rejected");
  }

  const eventId = crypto.randomUUID();
  await createMappedEvent(database, {
    ...input,
    eventId,
    fingerprint,
    linkId: mapping?.linkId ?? crypto.randomUUID(),
    replaceExistingLink: mapping !== null,
  });
  return "created";
}

async function importAliasedEventRow(
  database: D1DatabaseLike,
  input: Readonly<{
    actorProfileId: string;
    canonicalAliasUrl: string;
    clubId: string;
    event: ParsedMeetupEvent;
    fingerprint: string;
    generationId: string;
    identityHash: string;
    importBatchId: string;
    leaseToken: string;
    maxTimedEndDriftMs: number;
    now: number;
    organizationId: string;
    sourceId: string;
    manualAuthority: ManualRefreshAuthority | null;
  }>,
): Promise<void> {
  const canonicalTarget = await readAliasCanonicalTarget(
    database,
    input.organizationId,
    input.sourceId,
    input.canonicalAliasUrl,
  );
  if (
    !canonicalTarget ||
    !mappingOwnerReviewedAliasScheduleMatchesEvent(
      canonicalTarget.resourceMapping,
      input.event,
      input.maxTimedEndDriftMs,
    ) ||
    canonicalTarget.resourceMapping.scheduleVersion === null
  ) {
    throw new MeetupSyncError("calendar_invalid");
  }

  const mapping = await readSourceMapping(
    database,
    input.organizationId,
    input.sourceId,
    input.identityHash,
  );
  const displacedEventId =
    mapping?.eventId && mapping.eventId !== canonicalTarget.eventId
      ? mapping.eventId
      : null;
  if (
    (mapping && isStaleSourceRevision(mapping, input.event, input.sourceId)) ||
    (displacedEventId !== null &&
      (mapping === null ||
        mapping.externalUrl !== input.event.eventUrl ||
        mapping.scheduleVersion === null ||
        mapping.primaryOrganizerProfileId !== null ||
        mapping.organizerScope.length !== 0 ||
        !mappingScheduleMatchesEvent(mapping, input.event)))
  ) {
    throw new MeetupSyncError("calendar_invalid");
  }

  const linkId = mapping?.linkId ?? crypto.randomUUID();
  const tombstone =
    displacedEventId === null
      ? null
      : Object.freeze({
          externalId: await legacyAliasTombstoneExternalId(
            input.sourceId,
            input.identityHash,
            displacedEventId,
          ),
          id: crypto.randomUUID(),
          oldEventId: displacedEventId,
        });
  const externalReservationStatements =
    await stageExternalReservationStatements(database, {
      ...input,
      eventId: canonicalTarget.eventId,
      resourceMapping: canonicalTarget.resourceMapping,
      scheduleVersion: canonicalTarget.resourceMapping.scheduleVersion,
      stagedMapping: null,
    });
  await database.batch([
    importRowStatement(database, {
      eventId: canonicalTarget.eventId,
      event: input.event,
      identityHash: input.identityHash,
      importBatchId: input.importBatchId,
      now: input.now,
      organizationId: input.organizationId,
      rowNumber: input.event.componentIndex + 1,
      status: "accepted",
    }),
    extendLeaseStatement(database, input),
    ...(tombstone
      ? [
          insertLegacyAliasTombstoneStatement(database, {
            ...input,
            linkId,
            tombstone,
          }),
        ]
      : []),
    mapping
      ? tombstone
        ? rebindLegacyAliasSourceLinkStatement(database, {
            ...input,
            eventId: canonicalTarget.eventId,
            linkId,
            tombstone,
          })
        : updateSourceLinkStatement(database, {
            ...input,
            eventId: canonicalTarget.eventId,
            linkId,
          })
      : insertSourceLinkStatement(database, {
          ...input,
          eventId: canonicalTarget.eventId,
          linkId,
        }),
    auditAfterChangedStatement(database, {
      action: "meetup.source_alias_linked",
      actorProfileId: input.actorProfileId,
      entityId: linkId,
      entityType: "external_source_link",
      metadata: {
        aliasModel: MEETUP_EVENT_ALIAS_POLICY_VERSION,
        sourceType: SOURCE_TYPE,
      },
      now: input.now,
      organizationId: input.organizationId,
      manualAuthority: input.manualAuthority,
    }),
    stageEventSnapshotStatement(database, {
      ...input,
      eventId: canonicalTarget.eventId,
    }),
    ...stageEventPublicContentStatements(database, {
      ...input,
    }),
    ...externalReservationStatements,
  ]);
}

async function hasAuthoritativeReservationCollision(
  database: D1DatabaseLike,
  organizationId: string,
  event: ParsedMeetupEvent,
  now: number,
): Promise<boolean> {
  const interval = externalScheduleFacts(event, null);
  const row = await database
    .prepare(
      `SELECT 1 AS has_conflict
       WHERE EXISTS (
         SELECT 1
         FROM organizer_reservation_states AS reservation
         JOIN organizer_events AS reserved_event
           ON reserved_event.id = reservation.organizer_event_id
          AND reserved_event.organization_id = reservation.organization_id
          AND reserved_event.deleted_at IS NULL
         WHERE reservation.organization_id = ?
           AND reservation.expanded_start_utc < ?
           AND reservation.expanded_end_utc > ?
           AND (
             reservation.planning_status = 'confirmed'
             OR (
               reservation.planning_status = 'tentative_hold'
               AND reservation.hold_expires_at > ?
             )
           )
       )
       OR EXISTS (
         SELECT 1
         FROM organizer_external_reservation_intervals AS external
         WHERE external.organization_id = ?
           AND external.expanded_start_utc < ?
           AND external.expanded_end_utc > ?
           AND external.planning_status IN (
             'hold', 'tentative', 'tentative_hold', 'confirmed'
           )
           AND (
             external.planning_status NOT IN ('hold', 'tentative_hold')
             OR external.hold_expires_at > ?
           )
           AND external.source_kind = 'legacy'
       )
       OR EXISTS (
         SELECT 1
         FROM events AS legacy
         WHERE legacy.organization_id = ?
           AND legacy.deleted_at IS NULL
           AND legacy.time_kind = 'timed'
           AND legacy.starts_at_utc < ?
           AND legacy.ends_at_utc > ?
           AND legacy.status IN ('hold', 'tentative', 'confirmed')
           AND (
             legacy.status <> 'hold'
             OR legacy.hold_expires_at > ?
           )
           AND NOT EXISTS (
             SELECT 1
             FROM organizer_events AS adopted
             WHERE adopted.id = legacy.id
               AND adopted.organization_id = legacy.organization_id
           )
           AND NOT EXISTS (
             SELECT 1
             FROM external_source_links AS source_link
             WHERE source_link.organization_id = legacy.organization_id
               AND source_link.entity_type = 'event'
               AND source_link.entity_id = legacy.id
               AND source_link.source_type = 'meetup_ics'
               AND source_link.deleted_at IS NULL
           )
       )
       LIMIT 1`,
    )
    .bind(
      organizationId,
      interval.expandedEndUtc,
      interval.expandedStartUtc,
      now,
      organizationId,
      interval.expandedEndUtc,
      interval.expandedStartUtc,
      now,
      organizationId,
      interval.expandedEndUtc,
      interval.expandedStartUtc,
      now,
    )
    .first<Record<string, unknown>>();
  return row?.has_conflict === 1;
}

async function createMappedEvent(
  database: D1DatabaseLike,
  input: Readonly<{
    actorProfileId: string;
    clubId: string;
    event: ParsedMeetupEvent;
    eventId: string;
    fingerprint: string;
    generationId: string;
    identityHash: string;
    importBatchId: string;
    leaseToken: string;
    linkId: string;
    now: number;
    organizationId: string;
    replaceExistingLink: boolean;
    sourceId: string;
    manualAuthority: ManualRefreshAuthority | null;
  }>,
): Promise<void> {
  const scheduleVersion = 1;
  const externalReservationStatements =
    await stageExternalReservationStatements(
      database,
    {
      ...input,
      resourceMapping: null,
      scheduleVersion,
      stagedMapping: null,
    },
  );
  const statements = [
    insertEventStatement(database, {
      ...input,
    }),
    database
      .prepare(
        `INSERT INTO event_revisions (
           id, organization_id, event_id, schedule_version, snapshot_json,
           reason, actor_profile_id, created_at
         ) VALUES (
           ?, ?, CASE WHEN changes() = 1 THEN ? ELSE NULL END,
           1, ?, ?, ?, ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        input.organizationId,
        input.eventId,
        revisionSnapshot(input.eventId, input.event, scheduleVersion),
        "Meetup calendar import",
        input.actorProfileId,
        input.now,
      ),
    importRowStatement(database, {
      eventId: input.eventId,
      event: input.event,
      identityHash: input.identityHash,
      importBatchId: input.importBatchId,
      now: input.now,
      organizationId: input.organizationId,
      rowNumber: input.event.componentIndex + 1,
      status: "accepted",
    }),
    extendLeaseStatement(database, input),
    input.replaceExistingLink
      ? updateSourceLinkStatement(database, input)
      : insertSourceLinkStatement(database, input),
    auditAfterChangedStatement(database, {
      action:
        input.event.status === "cancelled"
          ? "meetup.event_cancelled"
          : "meetup.event_created",
      actorProfileId: input.actorProfileId,
      entityId: input.eventId,
      entityType: "event",
      metadata: {
        sourceType: SOURCE_TYPE,
        status: input.event.status,
      },
      now: input.now,
      organizationId: input.organizationId,
      manualAuthority: input.manualAuthority,
    }),
    stageEventSnapshotStatement(database, input),
    ...stageEventPublicContentStatements(database, input),
    ...externalReservationStatements,
  ];
  await database.batch(statements);
}

async function updateMappedEvent(
  database: D1DatabaseLike,
  input: Readonly<{
    actorProfileId: string;
    clubId: string;
    event: ParsedMeetupEvent;
    eventId: string;
    existingMapping: SourceMapping;
    expectedScheduleVersion: number;
    fingerprint: string;
    generationId: string;
    identityHash: string;
    importBatchId: string;
    leaseToken: string;
    linkId: string;
    now: number;
    organizationId: string;
    sourceId: string;
    scheduleChanged: boolean;
    manualAuthority: ManualRefreshAuthority | null;
  }>,
): Promise<void> {
  const scheduleVersion =
    input.expectedScheduleVersion + (input.scheduleChanged ? 1 : 0);
  const externalReservationStatements =
    await stageExternalReservationStatements(
    database,
    {
      ...input,
      resourceMapping: input.existingMapping,
      scheduleVersion,
      stagedMapping: null,
    },
  );
  const mutationAudit = auditAfterChangedStatement(database, {
    action:
      input.event.status === "cancelled"
        ? "meetup.event_cancelled"
        : "meetup.event_updated",
    actorProfileId: input.actorProfileId,
    entityId: input.eventId,
    entityType: "event",
    metadata: {
      scheduleVersion,
      sourceType: SOURCE_TYPE,
      status: input.event.status,
    },
    now: input.now,
    organizationId: input.organizationId,
    manualAuthority: input.manualAuthority,
  });
  const revisionStatement = database
    .prepare(
      `INSERT INTO event_revisions (
         id, organization_id, event_id, schedule_version, snapshot_json,
         reason, actor_profile_id, created_at
       ) VALUES (
         ?, ?, CASE WHEN changes() = 1 THEN ? ELSE NULL END,
         ?, ?, ?, ?, ?
       )`,
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      input.eventId,
      scheduleVersion,
      revisionSnapshot(input.eventId, input.event, scheduleVersion),
      "Meetup calendar schedule update",
      input.actorProfileId,
      input.now,
    );
  await database.batch([
    updateEventStatement(database, input),
    mutationAudit,
    ...(input.scheduleChanged ? [revisionStatement] : []),
    importRowStatement(database, {
      eventId: input.eventId,
      event: input.event,
      identityHash: input.identityHash,
      importBatchId: input.importBatchId,
      now: input.now,
      organizationId: input.organizationId,
      rowNumber: input.event.componentIndex + 1,
      status: "accepted",
    }),
    extendLeaseStatement(database, input),
    updateSourceLinkStatement(database, input),
    auditAfterChangedStatement(database, {
      action: "meetup.source_link_updated",
      actorProfileId: input.actorProfileId,
      entityId: input.linkId,
      entityType: "external_source_link",
      metadata: { sourceType: SOURCE_TYPE },
      now: input.now,
      organizationId: input.organizationId,
      manualAuthority: input.manualAuthority,
    }),
    stageEventSnapshotStatement(database, input),
    ...stageEventPublicContentStatements(database, input),
    ...externalReservationStatements,
  ]);
}

async function recordSkippedRow(
  database: D1DatabaseLike,
  input: Readonly<{
    actorProfileId: string;
    clubId: string;
    event: ParsedMeetupEvent;
    eventId: string;
    fingerprint: string;
    generationId: string;
    identityHash: string;
    importBatchId: string;
    leaseToken: string;
    linkId: string;
    now: number;
    organizationId: string;
    sourceId: string;
    staleRevision: boolean;
    existingMapping: SourceMapping;
    manualAuthority: ManualRefreshAuthority | null;
  }>,
): Promise<void> {
  const externalReservationStatements =
    await stageExternalReservationStatements(
    database,
    {
      ...input,
      resourceMapping: input.existingMapping,
      scheduleVersion:
        input.existingMapping.scheduleVersion ?? 1,
      stagedMapping: input.staleRevision ? input.existingMapping : null,
    },
  );
  await database.batch([
    importRowStatement(database, {
      eventId: input.eventId,
      event: input.event,
      identityHash: input.identityHash,
      importBatchId: input.importBatchId,
      now: input.now,
      organizationId: input.organizationId,
      rowNumber: input.event.componentIndex + 1,
      status: "skipped",
      errorCode: input.staleRevision
        ? "stale_source_revision"
        : null,
    }),
    extendLeaseStatement(database, input),
    input.staleRevision
      ? touchSourceLinkStatement(database, input, false)
      : touchSourceLinkStatement(database, input, true),
    auditAfterChangedStatement(database, {
      action: "meetup.event_seen",
      actorProfileId: input.actorProfileId,
      entityId: input.eventId,
      entityType: "event",
      metadata: { sourceType: SOURCE_TYPE },
      now: input.now,
      organizationId: input.organizationId,
      manualAuthority: input.manualAuthority,
    }),
    input.staleRevision
      ? stageExistingSnapshotStatement(database, input)
      : stageEventSnapshotStatement(database, input),
    ...(input.staleRevision
      ? [stageExistingSnapshotPublicContentStatement(database, input)]
      : stageEventPublicContentStatements(database, input)),
    ...externalReservationStatements,
  ]);
}

async function recordRejectedRow(
  database: D1DatabaseLike,
  input: Readonly<{
    actorProfileId: string;
    errorCode: string;
    importBatchId: string;
    leaseToken: string;
    now: number;
    organizationId: string;
    rowNumber: number;
    sourceId: string;
    sourcePayload: Record<string, unknown>;
    manualAuthority: ManualRefreshAuthority | null;
  }>,
): Promise<void> {
  await database.batch([
    database
      .prepare(
        `INSERT INTO import_rows (
           id, organization_id, import_batch_id, row_number,
           source_payload_json, normalized_payload_json, status, error_code,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, 'rejected', ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.organizationId,
        input.importBatchId,
        input.rowNumber,
        JSON.stringify(input.sourcePayload),
        input.errorCode,
        input.now,
        input.now,
      ),
    extendLeaseStatement(database, input),
    auditAfterChangedStatement(database, {
      action: "meetup.import_row_rejected",
      actorProfileId: input.actorProfileId,
      entityId: input.importBatchId,
      entityType: "import_batch",
      metadata: {
        errorCode: input.errorCode,
        rowNumber: input.rowNumber,
        sourceType: SOURCE_TYPE,
      },
      now: input.now,
      organizationId: input.organizationId,
      manualAuthority: input.manualAuthority,
    }),
  ]);
}

function insertEventStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    actorProfileId: string;
    clubId: string;
    event: ParsedMeetupEvent;
    eventId: string;
    identityHash: string;
    now: number;
    organizationId: string;
  }>,
) {
  const slug = eventSlug(
    input.event.title,
    input.identityHash,
    input.eventId,
  );
  if (input.event.schedule.kind === "timed") {
    return database
      .prepare(
        `INSERT INTO events (
           id, organization_id, club_id, event_lane_id,
           primary_organizer_profile_id,
           title, slug, summary, description, status, visibility, time_kind,
           starts_at_utc, ends_at_utc, timezone, all_day_start_date,
           all_day_end_date_exclusive, buffer_before_minutes,
           buffer_after_minutes, organizer_scope_json, schedule_version,
           schedule_review_state, hold_expires_at, private_notes,
           private_meeting_details, published_at, created_by_profile_id,
           updated_by_profile_id, created_at, updated_at, deleted_at
         ) VALUES (
           ?, ?, ?, (
             SELECT lane.id
             FROM event_lanes AS lane
             WHERE lane.organization_id = ?
               AND lane.slug = ?
               AND lane.deleted_at IS NULL
             LIMIT 1
           ), NULL, ?, ?, NULL, NULL, ?, 'public', 'timed',
           ?, ?, ?, NULL, NULL, 0, 0, '[]', 1, 'unreviewed', NULL,
           NULL, NULL, ?, ?, ?, ?, ?, NULL
         )`,
      )
      .bind(
        input.eventId,
        input.organizationId,
        input.clubId,
        input.organizationId,
        classifyMeetupEventLane(input.event),
        input.event.title,
        slug,
        SOURCE_CANONICAL_EVENT_STATUS,
        input.event.schedule.startsAtUtcMs,
        input.event.schedule.endsAtUtcMs,
        input.event.schedule.timeZone,
        input.now,
        input.actorProfileId,
        input.actorProfileId,
        input.now,
        input.now,
      );
  }
  return database
    .prepare(
      `INSERT INTO events (
         id, organization_id, club_id, event_lane_id,
         primary_organizer_profile_id,
         title, slug, summary, description, status, visibility, time_kind,
         starts_at_utc, ends_at_utc, timezone, all_day_start_date,
         all_day_end_date_exclusive, buffer_before_minutes,
         buffer_after_minutes, organizer_scope_json, schedule_version,
         schedule_review_state, hold_expires_at, private_notes,
         private_meeting_details, published_at, created_by_profile_id,
         updated_by_profile_id, created_at, updated_at, deleted_at
       ) VALUES (
         ?, ?, ?, (
           SELECT lane.id
           FROM event_lanes AS lane
           WHERE lane.organization_id = ?
             AND lane.slug = ?
             AND lane.deleted_at IS NULL
           LIMIT 1
         ), NULL, ?, ?, NULL, NULL, ?, 'public', 'all_day',
         NULL, NULL, ?, ?, ?, 0, 0, '[]', 1, 'unreviewed', NULL,
         NULL, NULL, ?, ?, ?, ?, ?, NULL
       )`,
    )
    .bind(
      input.eventId,
      input.organizationId,
      input.clubId,
      input.organizationId,
      classifyMeetupEventLane(input.event),
      input.event.title,
      slug,
      SOURCE_CANONICAL_EVENT_STATUS,
      input.event.schedule.timeZone,
      input.event.schedule.startDate,
      input.event.schedule.endDateExclusive,
      input.now,
      input.actorProfileId,
      input.actorProfileId,
      input.now,
      input.now,
    );
}

function updateEventStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    actorProfileId: string;
    clubId: string;
    event: ParsedMeetupEvent;
    eventId: string;
    expectedScheduleVersion: number;
    now: number;
    organizationId: string;
    scheduleChanged: boolean;
  }>,
) {
  if (input.event.schedule.kind === "timed") {
    return database
      .prepare(
        `UPDATE events
         SET club_id = ?,
             event_lane_id = COALESCE(
               event_lane_id,
               (
                 SELECT lane.id
                 FROM event_lanes AS lane
                 WHERE lane.organization_id = ?
                   AND lane.slug = ?
                   AND lane.deleted_at IS NULL
                 LIMIT 1
               )
             ),
             title = ?,
             status = ?,
             time_kind = 'timed',
             starts_at_utc = ?,
             ends_at_utc = ?,
             timezone = ?,
             all_day_start_date = NULL,
             all_day_end_date_exclusive = NULL,
             buffer_before_minutes = 0,
             buffer_after_minutes = 0,
             organizer_scope_json = '[]',
              schedule_version = schedule_version + ?,
              schedule_review_state = CASE
                WHEN ? = 1 THEN 'unreviewed'
                ELSE schedule_review_state
              END,
             hold_expires_at = NULL,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND schedule_version = ?
           AND deleted_at IS NULL`,
      )
      .bind(
        input.clubId,
        input.organizationId,
        classifyMeetupEventLane(input.event),
        input.event.title,
        SOURCE_CANONICAL_EVENT_STATUS,
        input.event.schedule.startsAtUtcMs,
        input.event.schedule.endsAtUtcMs,
        input.event.schedule.timeZone,
        input.scheduleChanged ? 1 : 0,
        input.scheduleChanged ? 1 : 0,
        input.actorProfileId,
        input.now,
        input.eventId,
        input.organizationId,
        input.expectedScheduleVersion,
      );
  }
  return database
    .prepare(
      `UPDATE events
       SET club_id = ?,
           event_lane_id = COALESCE(
             event_lane_id,
             (
               SELECT lane.id
               FROM event_lanes AS lane
               WHERE lane.organization_id = ?
                 AND lane.slug = ?
                 AND lane.deleted_at IS NULL
               LIMIT 1
             )
           ),
           title = ?,
           status = ?,
           time_kind = 'all_day',
           starts_at_utc = NULL,
           ends_at_utc = NULL,
           timezone = ?,
           all_day_start_date = ?,
           all_day_end_date_exclusive = ?,
           buffer_before_minutes = 0,
           buffer_after_minutes = 0,
           organizer_scope_json = '[]',
            schedule_version = schedule_version + ?,
            schedule_review_state = CASE
              WHEN ? = 1 THEN 'unreviewed'
              ELSE schedule_review_state
            END,
           hold_expires_at = NULL,
           updated_by_profile_id = ?,
           updated_at = ?
       WHERE id = ?
         AND organization_id = ?
         AND schedule_version = ?
         AND deleted_at IS NULL`,
    )
    .bind(
      input.clubId,
      input.organizationId,
      classifyMeetupEventLane(input.event),
      input.event.title,
      SOURCE_CANONICAL_EVENT_STATUS,
      input.event.schedule.timeZone,
      input.event.schedule.startDate,
      input.event.schedule.endDateExclusive,
      input.scheduleChanged ? 1 : 0,
      input.scheduleChanged ? 1 : 0,
      input.actorProfileId,
      input.now,
      input.eventId,
      input.organizationId,
      input.expectedScheduleVersion,
    );
}

function importRowStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    event: ParsedMeetupEvent;
    eventId: string;
    identityHash: string;
    importBatchId: string;
    now: number;
    organizationId: string;
    rowNumber: number;
    status: "accepted" | "skipped";
    errorCode?: string | null;
  }>,
) {
  return database
    .prepare(
      `INSERT INTO import_rows (
         id, organization_id, import_batch_id, row_number,
         source_payload_json, normalized_payload_json, status, error_code,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      input.importBatchId,
      input.rowNumber,
      JSON.stringify(sanitizedSourceFacts(input.event, input.identityHash)),
      JSON.stringify({
        eventId: input.eventId,
        eventUrl: input.event.eventUrl,
        schedule: input.event.schedule,
        status: input.event.status,
        title: input.event.title,
      }),
      input.status,
      input.errorCode ?? null,
      input.now,
      input.now,
    );
}

async function stageExternalReservationStatements(
  database: D1DatabaseLike,
  input: Readonly<{
    clubId: string;
    event: ParsedMeetupEvent;
    eventId: string;
    fingerprint: string;
    generationId: string;
    identityHash: string;
    now: number;
    organizationId: string;
    resourceMapping: SourceMapping | null;
    scheduleVersion: number;
    sourceId: string;
    stagedMapping: SourceMapping | null;
  }>,
) {
  const snapshotId = meetupSnapshotRecordId(
    input.sourceId,
    input.generationId,
    input.identityHash,
  );
  const schedule = externalScheduleFacts(input.event, input.stagedMapping);
  const status =
    input.stagedMapping?.status ?? input.event.status;
  const title =
    input.stagedMapping?.title ?? input.event.title;
  const sourceFingerprint =
    input.stagedMapping?.fingerprint ?? input.fingerprint;
  if (status === "cancelled") {
    return Object.freeze([]);
  }
  if (status !== "confirmed" && status !== "tentative") {
    throw new MeetupSyncError("calendar_invalid");
  }
  const organizerScope =
    input.resourceMapping?.organizerScope ?? Object.freeze([]);
  const organizerScopeJson =
    input.resourceMapping?.organizerScopeJson ?? "[]";
  const primaryOrganizerProfileId =
    input.resourceMapping?.primaryOrganizerProfileId ?? null;
  const venueId = input.resourceMapping?.venueId ?? null;
  const fingerprintInput = Object.freeze({
    allDayEndDateExclusive: schedule.allDayEndDateExclusive,
    allDayStartDate: schedule.allDayStartDate,
    bufferAfterMinutes: 0,
    bufferBeforeMinutes: 0,
    clubId: input.clubId,
    eventId: input.eventId,
    generationId: input.generationId,
    holdExpiresAt: null,
    interval: Object.freeze({
      actualEndUtc: schedule.actualEndUtc,
      actualStartUtc: schedule.actualStartUtc,
      expandedEndUtc: schedule.expandedEndUtc,
      expandedStartUtc: schedule.expandedStartUtc,
    }),
    organizerScope,
    organizationId: input.organizationId,
    planningStatus: status,
    primaryOrganizerProfileId,
    scheduleShape: schedule.scheduleShape,
    scheduleVersion: input.scheduleVersion,
    sourceFingerprint,
    sourceKind: "meetup",
    sourceRecordId: snapshotId,
    syncSourceId: input.sourceId,
    timeZone: schedule.timeZone,
    venueId,
  } as const);
  const normalizedStateFingerprint =
    await externalReservationStateFingerprint(fingerprintInput);
  const reservationSemanticFingerprint =
    await externalReservationSemanticFingerprint(fingerprintInput);
  const normalizationId = `meetup-normalization:${snapshotId}`;
  const normalizationStatement = database
    .prepare(
      `INSERT INTO meetup_snapshot_reservation_normalizations (
         id, organization_id, sync_source_id, generation_id, snapshot_id,
         event_id, club_id, planning_status, schedule_shape,
         actual_start_utc, actual_end_utc, expanded_start_utc,
         expanded_end_utc, timezone, all_day_start_date,
         all_day_end_date_exclusive, buffer_before_minutes,
         buffer_after_minutes, venue_id, primary_organizer_profile_id,
         organizer_scope_json, schedule_version, hold_expires_at,
         source_fingerprint, normalized_state_fingerprint,
         reservation_semantic_fingerprint, created_at, updated_at
       )
       SELECT ?, snapshot.organization_id, snapshot.sync_source_id,
              snapshot.generation_id, snapshot.id, snapshot.event_id,
              source.club_id, snapshot.status, snapshot.time_kind,
              ?, ?, ?, ?, snapshot.timezone,
              snapshot.all_day_start_date,
              snapshot.all_day_end_date_exclusive,
              0, 0, event.venue_id, event.primary_organizer_profile_id,
              event.organizer_scope_json, event.schedule_version, NULL,
              snapshot.source_fingerprint, ?, ?, ?, ?
       FROM meetup_event_snapshots AS snapshot
       JOIN sync_sources AS source
         ON source.id = snapshot.sync_source_id
        AND source.organization_id = snapshot.organization_id
        AND source.pending_generation_id = snapshot.generation_id
        AND source.enabled = 1
        AND source.deleted_at IS NULL
       JOIN meetup_sync_generations AS generation
         ON generation.id = snapshot.generation_id
        AND generation.sync_source_id = source.id
        AND generation.organization_id = source.organization_id
        AND generation.state = 'staging'
       JOIN events AS event
         ON event.id = snapshot.event_id
        AND event.organization_id = snapshot.organization_id
        AND event.deleted_at IS NULL
       WHERE snapshot.id = ?
         AND snapshot.organization_id = ?
         AND snapshot.sync_source_id = ?
         AND snapshot.generation_id = ?
         AND snapshot.event_id = ?
         AND snapshot.status IN ('confirmed', 'tentative')
         AND snapshot.source_fingerprint = ?
         AND source.club_id = ?
         AND event.venue_id IS ?
         AND event.primary_organizer_profile_id IS ?
         AND event.organizer_scope_json = ?
         AND event.schedule_version = ?
       ON CONFLICT(sync_source_id, generation_id, snapshot_id, event_id)
       DO UPDATE SET
         club_id = excluded.club_id,
         planning_status = excluded.planning_status,
         schedule_shape = excluded.schedule_shape,
         actual_start_utc = excluded.actual_start_utc,
         actual_end_utc = excluded.actual_end_utc,
         expanded_start_utc = excluded.expanded_start_utc,
         expanded_end_utc = excluded.expanded_end_utc,
         timezone = excluded.timezone,
         all_day_start_date = excluded.all_day_start_date,
         all_day_end_date_exclusive =
           excluded.all_day_end_date_exclusive,
         buffer_before_minutes = excluded.buffer_before_minutes,
         buffer_after_minutes = excluded.buffer_after_minutes,
         venue_id = excluded.venue_id,
         primary_organizer_profile_id =
           excluded.primary_organizer_profile_id,
         organizer_scope_json = excluded.organizer_scope_json,
         schedule_version = excluded.schedule_version,
         hold_expires_at = excluded.hold_expires_at,
         source_fingerprint = excluded.source_fingerprint,
         normalized_state_fingerprint =
           excluded.normalized_state_fingerprint,
         reservation_semantic_fingerprint =
           excluded.reservation_semantic_fingerprint,
         updated_at = excluded.updated_at`,
    )
    .bind(
      normalizationId,
      schedule.actualStartUtc,
      schedule.actualEndUtc,
      schedule.expandedStartUtc,
      schedule.expandedEndUtc,
      normalizedStateFingerprint,
      reservationSemanticFingerprint,
      input.now,
      input.now,
      snapshotId,
      input.organizationId,
      input.sourceId,
      input.generationId,
      input.eventId,
      sourceFingerprint,
      input.clubId,
      venueId,
      primaryOrganizerProfileId,
      organizerScopeJson,
      input.scheduleVersion,
    );
  const externalReservationStatement = database
    .prepare(
      `INSERT INTO organizer_external_reservation_intervals (
         id, organization_id, source_kind, source_record_id, sync_source_id,
         generation_id, event_id, club_id, planning_status,
         schedule_shape, actual_start_utc, actual_end_utc,
         expanded_start_utc, expanded_end_utc, timezone,
         all_day_start_date, all_day_end_date_exclusive,
          buffer_before_minutes, buffer_after_minutes, venue_id,
          primary_organizer_profile_id, organizer_scope_json,
          source_fingerprint, normalized_state_fingerprint,
          reservation_semantic_fingerprint, schedule_version,
          hold_expires_at, title, created_at, updated_at
       )
       VALUES (
         ?, ?, 'meetup', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         0, 0, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?
       )
       ON CONFLICT(source_kind, source_record_id) DO UPDATE SET
         event_id = excluded.event_id,
         club_id = excluded.club_id,
         planning_status = excluded.planning_status,
         schedule_shape = excluded.schedule_shape,
         actual_start_utc = excluded.actual_start_utc,
         actual_end_utc = excluded.actual_end_utc,
         expanded_start_utc = excluded.expanded_start_utc,
         expanded_end_utc = excluded.expanded_end_utc,
         timezone = excluded.timezone,
         all_day_start_date = excluded.all_day_start_date,
         all_day_end_date_exclusive =
           excluded.all_day_end_date_exclusive,
         buffer_before_minutes = excluded.buffer_before_minutes,
         buffer_after_minutes = excluded.buffer_after_minutes,
         venue_id = excluded.venue_id,
         primary_organizer_profile_id =
           excluded.primary_organizer_profile_id,
         organizer_scope_json = excluded.organizer_scope_json,
         source_fingerprint = excluded.source_fingerprint,
         normalized_state_fingerprint =
           excluded.normalized_state_fingerprint,
         reservation_semantic_fingerprint =
           excluded.reservation_semantic_fingerprint,
         schedule_version = excluded.schedule_version,
         hold_expires_at = NULL,
         title = excluded.title,
         updated_at = excluded.updated_at`,
    )
    .bind(
      `meetup-interval:${snapshotId}`,
      input.organizationId,
      snapshotId,
      input.sourceId,
      input.generationId,
      input.eventId,
      input.clubId,
      status,
      schedule.scheduleShape,
      schedule.actualStartUtc,
      schedule.actualEndUtc,
      schedule.expandedStartUtc,
      schedule.expandedEndUtc,
      schedule.timeZone,
      schedule.allDayStartDate,
      schedule.allDayEndDateExclusive,
      venueId,
      primaryOrganizerProfileId,
      organizerScopeJson,
      sourceFingerprint,
      normalizedStateFingerprint,
      reservationSemanticFingerprint,
      input.scheduleVersion,
      title,
      input.now,
      input.now,
    );
  return Object.freeze([
    normalizationStatement,
    externalReservationStatement,
  ]);
}

function externalScheduleFacts(
  event: ParsedMeetupEvent,
  mapping: SourceMapping | null,
): Readonly<
  NormalizedMeetupInterval & { timeZone: string }
> {
  if (mapping) {
    const timeZone = mapping.timeZone ?? DEFAULT_TIME_ZONE;
    if (
      mapping.timeKind === "timed" &&
      mapping.startsAtUtc !== null &&
      mapping.endsAtUtc !== null
    ) {
      return Object.freeze({
        ...normalizeConflictInterval({
          startUtc: mapping.startsAtUtc,
          endUtc: mapping.endsAtUtc,
        }),
        allDayEndDateExclusive: null,
        allDayStartDate: null,
        scheduleShape: "timed" as const,
        timeZone,
      });
    }
    if (
      mapping.timeKind === "all_day" &&
      mapping.allDayStartDate !== null &&
      mapping.allDayEndDateExclusive !== null
    ) {
      return Object.freeze({
        ...normalizeAllDayConflictInterval({
          startDate: mapping.allDayStartDate,
          endDateExclusive: mapping.allDayEndDateExclusive,
          timeZone,
        }),
        allDayEndDateExclusive: mapping.allDayEndDateExclusive,
        allDayStartDate: mapping.allDayStartDate,
        scheduleShape: "all_day" as const,
        timeZone,
      });
    }
    throw new MeetupSyncError("calendar_invalid");
  }
  if (event.schedule.kind === "timed") {
    return Object.freeze({
      ...normalizeConflictInterval({
        startUtc: event.schedule.startsAtUtcMs,
        endUtc: event.schedule.endsAtUtcMs,
      }),
      allDayEndDateExclusive: null,
      allDayStartDate: null,
      scheduleShape: "timed" as const,
      timeZone: event.schedule.timeZone,
    });
  }
  return Object.freeze({
    ...normalizeAllDayConflictInterval({
      startDate: event.schedule.startDate,
      endDateExclusive: event.schedule.endDateExclusive,
      timeZone: event.schedule.timeZone,
    }),
    allDayEndDateExclusive: event.schedule.endDateExclusive,
    allDayStartDate: event.schedule.startDate,
    scheduleShape: "all_day" as const,
    timeZone: event.schedule.timeZone,
  });
}

type NormalizedMeetupInterval = Readonly<{
  actualEndUtc: number;
  actualStartUtc: number;
  allDayEndDateExclusive: string | null;
  allDayStartDate: string | null;
  expandedEndUtc: number;
  expandedStartUtc: number;
  scheduleShape: "all_day" | "timed";
}>;

function meetupSnapshotRecordId(
  sourceId: string,
  generationId: string,
  identityHash: string,
): string {
  return `meetup-snapshot:${sourceId}:${generationId}:${identityHash}`;
}

function extendLeaseStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    leaseToken: string;
    now: number;
    sourceId: string;
  }>,
) {
  return database
    .prepare(
      `UPDATE sync_sources
       SET lease_expires_at = ?,
           updated_at = ?
       WHERE id = ?
         AND lease_token = ?
         AND lease_expires_at > ?
         AND deleted_at IS NULL`,
    )
    .bind(
      input.now + LEASE_DURATION_MS,
      input.now,
      input.sourceId,
      input.leaseToken,
      input.now,
    );
}

function insertSourceLinkStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    event: ParsedMeetupEvent;
    eventId: string;
    fingerprint: string;
    identityHash: string;
    leaseToken: string;
    linkId: string;
    now: number;
    organizationId: string;
    sourceId: string;
  }>,
) {
  return database
    .prepare(
      `INSERT INTO external_source_links (
         id, organization_id, entity_type, entity_id, source_type,
         sync_source_id, external_id, external_url, source_fingerprint,
         source_sequence,
         source_last_modified_at, last_imported_at, created_at, updated_at,
         deleted_at
       )
       SELECT ?, ?, 'event', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
       FROM sync_sources
       WHERE id = ?
         AND organization_id = ?
         AND lease_token = ?
         AND lease_expires_at > ?
         AND deleted_at IS NULL`,
    )
    .bind(
      input.linkId,
      input.organizationId,
      input.eventId,
      SOURCE_TYPE,
      input.sourceId,
      input.identityHash,
      input.event.eventUrl,
      input.fingerprint,
      input.event.sequence,
      input.event.lastModifiedUtcMs,
      input.now,
      input.now,
      input.now,
      input.sourceId,
      input.organizationId,
      input.leaseToken,
      input.now,
    );
}

function insertLegacyAliasTombstoneStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    event: ParsedMeetupEvent;
    identityHash: string;
    leaseToken: string;
    linkId: string;
    now: number;
    organizationId: string;
    sourceId: string;
    tombstone: Readonly<{
      externalId: string;
      id: string;
      oldEventId: string;
    }>;
  }>,
) {
  return database
    .prepare(
      `INSERT INTO external_source_links (
         id, organization_id, entity_type, entity_id, source_type,
         sync_source_id, external_id, external_url, source_fingerprint,
         source_sequence, source_last_modified_at, last_imported_at,
         created_at, updated_at, deleted_at
       )
       SELECT ?, live.organization_id, 'event', live.entity_id,
              live.source_type, live.sync_source_id, ?, live.external_url,
              live.source_fingerprint, live.source_sequence,
              live.source_last_modified_at, live.last_imported_at,
              ?, ?, ?
       FROM external_source_links AS live
       JOIN sync_sources AS source
         ON source.id = live.sync_source_id
        AND source.organization_id = live.organization_id
        AND source.lease_token = ?
        AND source.lease_expires_at > ?
        AND source.deleted_at IS NULL
       WHERE live.id = ?
         AND live.organization_id = ?
         AND live.entity_type = 'event'
         AND live.entity_id = ?
         AND live.source_type = ?
         AND live.sync_source_id = ?
         AND live.external_id = ?
         AND live.external_url = ?
         AND live.deleted_at IS NULL`,
    )
    .bind(
      input.tombstone.id,
      input.tombstone.externalId,
      input.now,
      input.now,
      input.now,
      input.leaseToken,
      input.now,
      input.linkId,
      input.organizationId,
      input.tombstone.oldEventId,
      SOURCE_TYPE,
      input.sourceId,
      input.identityHash,
      input.event.eventUrl,
    );
}

function rebindLegacyAliasSourceLinkStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    event: ParsedMeetupEvent;
    eventId: string;
    fingerprint: string;
    identityHash: string;
    leaseToken: string;
    linkId: string;
    now: number;
    organizationId: string;
    sourceId: string;
    tombstone: Readonly<{
      externalId: string;
      id: string;
      oldEventId: string;
    }>;
  }>,
) {
  return database
    .prepare(
      `UPDATE external_source_links
       SET entity_id = ?,
           source_fingerprint = ?,
           source_sequence = ?,
           source_last_modified_at = ?,
           last_imported_at = ?,
           updated_at = ?
       WHERE id = ?
         AND organization_id = ?
         AND entity_type = 'event'
         AND entity_id = ?
         AND source_type = ?
         AND sync_source_id = ?
         AND external_id = ?
         AND external_url = ?
         AND deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM organizer_events AS adopted
           WHERE adopted.id = external_source_links.entity_id
             AND adopted.organization_id =
                 external_source_links.organization_id
             AND adopted.deleted_at IS NULL
         )
         AND EXISTS (
           SELECT 1
           FROM external_source_links AS tombstone
           WHERE tombstone.id = ?
             AND tombstone.organization_id = external_source_links.organization_id
             AND tombstone.entity_type = 'event'
             AND tombstone.entity_id = ?
             AND tombstone.source_type = external_source_links.source_type
             AND tombstone.sync_source_id = external_source_links.sync_source_id
             AND tombstone.external_id = ?
             AND tombstone.deleted_at = ?
         )
         AND EXISTS (
           SELECT 1
           FROM sync_sources AS source
           WHERE source.id = external_source_links.sync_source_id
             AND source.organization_id = external_source_links.organization_id
             AND source.lease_token = ?
             AND source.lease_expires_at > ?
             AND source.deleted_at IS NULL
         )`,
    )
    .bind(
      input.eventId,
      input.fingerprint,
      input.event.sequence,
      input.event.lastModifiedUtcMs,
      input.now,
      input.now,
      input.linkId,
      input.organizationId,
      input.tombstone.oldEventId,
      SOURCE_TYPE,
      input.sourceId,
      input.identityHash,
      input.event.eventUrl,
      input.tombstone.id,
      input.tombstone.oldEventId,
      input.tombstone.externalId,
      input.now,
      input.leaseToken,
      input.now,
    );
}

function updateSourceLinkStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    event: ParsedMeetupEvent;
    eventId: string;
    fingerprint: string;
    leaseToken: string;
    linkId: string;
    now: number;
    organizationId: string;
    sourceId: string;
  }>,
) {
  return database
    .prepare(
      `UPDATE external_source_links
       SET entity_id = ?,
           sync_source_id = ?,
           external_url = ?,
           source_fingerprint = ?,
           source_sequence = ?,
           source_last_modified_at = ?,
           last_imported_at = ?,
           updated_at = ?,
           deleted_at = NULL
       WHERE id = ?
         AND organization_id = ?
         AND source_type = ?
         AND EXISTS (
           SELECT 1
           FROM sync_sources
           WHERE id = ?
             AND organization_id = external_source_links.organization_id
             AND lease_token = ?
             AND lease_expires_at > ?
             AND deleted_at IS NULL
         )`,
    )
    .bind(
      input.eventId,
      input.sourceId,
      input.event.eventUrl,
      input.fingerprint,
      input.event.sequence,
      input.event.lastModifiedUtcMs,
      input.now,
      input.now,
      input.linkId,
      input.organizationId,
      SOURCE_TYPE,
      input.sourceId,
      input.leaseToken,
      input.now,
    );
}

function touchSourceLinkStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    event: ParsedMeetupEvent;
    fingerprint: string;
    leaseToken: string;
    linkId: string;
    now: number;
    organizationId: string;
    sourceId: string;
  }>,
  updateSourceRevision: boolean,
) {
  return database
    .prepare(
      `UPDATE external_source_links
       SET sync_source_id = ?,
           source_fingerprint = CASE
             WHEN ? = 1 THEN ?
             ELSE source_fingerprint
           END,
           source_sequence = CASE
             WHEN ? = 1 THEN ?
             ELSE source_sequence
           END,
           source_last_modified_at = CASE
             WHEN ? = 1 THEN ?
             ELSE source_last_modified_at
           END,
           last_imported_at = ?,
           updated_at = ?,
           deleted_at = NULL
       WHERE id = ?
         AND organization_id = ?
         AND source_type = ?
         AND EXISTS (
           SELECT 1
           FROM sync_sources
           WHERE id = ?
             AND organization_id = external_source_links.organization_id
             AND lease_token = ?
             AND lease_expires_at > ?
             AND deleted_at IS NULL
         )`,
    )
    .bind(
      input.sourceId,
      updateSourceRevision ? 1 : 0,
      input.fingerprint,
      updateSourceRevision ? 1 : 0,
      input.event.sequence,
      updateSourceRevision ? 1 : 0,
      input.event.lastModifiedUtcMs,
      input.now,
      input.now,
      input.linkId,
      input.organizationId,
      SOURCE_TYPE,
      input.sourceId,
      input.leaseToken,
      input.now,
    );
}

function stageEventSnapshotStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    event: ParsedMeetupEvent;
    eventId: string;
    fingerprint: string;
    generationId: string;
    identityHash: string;
    leaseToken: string;
    now: number;
    organizationId: string;
    sourceId: string;
  }>,
) {
  const timed =
    input.event.schedule.kind === "timed" ? input.event.schedule : null;
  const allDay =
    input.event.schedule.kind === "all_day" ? input.event.schedule : null;
  return database
    .prepare(
      `INSERT INTO meetup_event_snapshots (
         id, organization_id, sync_source_id, generation_id, external_id,
         event_id, ordinal, event_slug, title, event_url, status, time_kind,
         starts_at_utc, ends_at_utc, timezone, all_day_start_date,
         all_day_end_date_exclusive, source_fingerprint, source_sequence,
         source_last_modified_at, created_at, updated_at
       )
        SELECT ?, ?, ?, ?, ?, staged_event.id, ?, staged_event.slug, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM sync_sources AS source
       JOIN meetup_sync_generations AS generation
         ON generation.id = source.pending_generation_id
        AND generation.sync_source_id = source.id
        AND generation.organization_id = source.organization_id
        AND generation.state = 'staging'
       JOIN events AS staged_event
         ON staged_event.id = ?
        AND staged_event.organization_id = source.organization_id
        AND staged_event.deleted_at IS NULL
       WHERE source.id = ?
         AND source.organization_id = ?
         AND source.pending_generation_id = ?
         AND source.lease_token = ?
         AND source.lease_expires_at > ?
         AND source.deleted_at IS NULL
       ON CONFLICT(sync_source_id, generation_id, external_id) DO UPDATE SET
         event_id = excluded.event_id,
         ordinal = excluded.ordinal,
         event_slug = excluded.event_slug,
         title = excluded.title,
         event_url = excluded.event_url,
         status = excluded.status,
         time_kind = excluded.time_kind,
         starts_at_utc = excluded.starts_at_utc,
         ends_at_utc = excluded.ends_at_utc,
         timezone = excluded.timezone,
         all_day_start_date = excluded.all_day_start_date,
         all_day_end_date_exclusive = excluded.all_day_end_date_exclusive,
         source_fingerprint = excluded.source_fingerprint,
         source_sequence = excluded.source_sequence,
         source_last_modified_at = excluded.source_last_modified_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      meetupSnapshotRecordId(
        input.sourceId,
        input.generationId,
        input.identityHash,
      ),
      input.organizationId,
      input.sourceId,
      input.generationId,
      input.identityHash,
      input.event.componentIndex,
      input.event.title,
      input.event.eventUrl,
      input.event.status,
      input.event.schedule.kind,
      timed?.startsAtUtcMs ?? null,
      timed?.endsAtUtcMs ?? null,
      input.event.schedule.timeZone,
      allDay?.startDate ?? null,
      allDay?.endDateExclusive ?? null,
      input.fingerprint,
      input.event.sequence,
      input.event.lastModifiedUtcMs,
      input.now,
      input.now,
      input.eventId,
      input.sourceId,
      input.organizationId,
      input.generationId,
      input.leaseToken,
      input.now,
    );
}

function stageExistingSnapshotStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    eventId: string;
    generationId: string;
    identityHash: string;
    leaseToken: string;
    now: number;
    organizationId: string;
    sourceId: string;
  }>,
) {
  return database
    .prepare(
      `INSERT INTO meetup_event_snapshots (
         id, organization_id, sync_source_id, generation_id, external_id,
         event_id, ordinal, event_slug, title, event_url, status, time_kind,
         starts_at_utc, ends_at_utc, timezone, all_day_start_date,
         all_day_end_date_exclusive, source_fingerprint, source_sequence,
         source_last_modified_at, created_at, updated_at
       )
       SELECT ?, previous.organization_id, previous.sync_source_id, ?,
               previous.external_id, previous.event_id, previous.ordinal,
               previous.event_slug, previous.title, previous.event_url,
               previous.status, previous.time_kind, previous.starts_at_utc,
              previous.ends_at_utc, previous.timezone,
              previous.all_day_start_date,
              previous.all_day_end_date_exclusive,
              previous.source_fingerprint, previous.source_sequence,
              previous.source_last_modified_at, ?, ?
       FROM sync_sources AS source
       JOIN meetup_sync_generations AS generation
         ON generation.id = source.pending_generation_id
        AND generation.sync_source_id = source.id
        AND generation.state = 'staging'
       JOIN meetup_event_snapshots AS previous
         ON previous.sync_source_id = source.id
        AND previous.generation_id = source.active_generation_id
        AND previous.external_id = ?
        AND previous.event_id = ?
       WHERE source.id = ?
         AND source.organization_id = ?
         AND source.pending_generation_id = ?
         AND source.lease_token = ?
         AND source.lease_expires_at > ?
         AND source.deleted_at IS NULL
       ON CONFLICT(sync_source_id, generation_id, external_id) DO UPDATE SET
         event_id = excluded.event_id,
         ordinal = excluded.ordinal,
         event_slug = excluded.event_slug,
         title = excluded.title,
         event_url = excluded.event_url,
         status = excluded.status,
         time_kind = excluded.time_kind,
         starts_at_utc = excluded.starts_at_utc,
         ends_at_utc = excluded.ends_at_utc,
         timezone = excluded.timezone,
         all_day_start_date = excluded.all_day_start_date,
         all_day_end_date_exclusive = excluded.all_day_end_date_exclusive,
         source_fingerprint = excluded.source_fingerprint,
         source_sequence = excluded.source_sequence,
         source_last_modified_at = excluded.source_last_modified_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      meetupSnapshotRecordId(
        input.sourceId,
        input.generationId,
        input.identityHash,
      ),
      input.generationId,
      input.now,
      input.now,
      input.identityHash,
      input.eventId,
      input.sourceId,
      input.organizationId,
      input.generationId,
      input.leaseToken,
      input.now,
    );
}

function stageEventPublicContentStatements(
  database: D1DatabaseLike,
  input: Readonly<{
    event: ParsedMeetupEvent;
    generationId: string;
    identityHash: string;
    leaseToken: string;
    now: number;
    organizationId: string;
    sourceId: string;
  }>,
): readonly ReturnType<D1DatabaseLike["prepare"]>[] {
  const content = input.event.publicContent;
  if (content === null) return Object.freeze([]);
  const snapshotId = meetupSnapshotRecordId(
    input.sourceId,
    input.generationId,
    input.identityHash,
  );
  return Object.freeze([
    database
      .prepare(
         `INSERT INTO meetup_event_snapshot_public_contents (
           snapshot_id, public_summary, public_description,
           public_description_blocks_json, public_venue_name,
           public_venue_address, public_floor, public_room, capacity,
           cost_text, age_policy_text, waitlist_available,
           availability_state, arrival_instructions, poster_source_url,
           poster_alt_text, poster_credit, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM sync_sources AS source
         JOIN meetup_sync_generations AS generation
           ON generation.id = source.pending_generation_id
          AND generation.sync_source_id = source.id
          AND generation.organization_id = source.organization_id
          AND generation.state = 'staging'
         JOIN meetup_event_snapshots AS snapshot
           ON snapshot.id = ?
          AND snapshot.organization_id = source.organization_id
          AND snapshot.sync_source_id = source.id
          AND snapshot.generation_id = generation.id
         WHERE source.id = ?
           AND source.organization_id = ?
           AND source.pending_generation_id = ?
           AND source.lease_token = ?
           AND source.lease_expires_at > ?
           AND source.deleted_at IS NULL
         ON CONFLICT(snapshot_id) DO UPDATE SET
           public_summary = excluded.public_summary,
           public_description = excluded.public_description,
           public_description_blocks_json =
             excluded.public_description_blocks_json,
           public_venue_name = excluded.public_venue_name,
           public_venue_address = excluded.public_venue_address,
           public_floor = excluded.public_floor,
           public_room = excluded.public_room,
           capacity = excluded.capacity,
           cost_text = excluded.cost_text,
           age_policy_text = excluded.age_policy_text,
           waitlist_available = excluded.waitlist_available,
           availability_state = excluded.availability_state,
           arrival_instructions = excluded.arrival_instructions,
           poster_source_url = excluded.poster_source_url,
           poster_alt_text = excluded.poster_alt_text,
           poster_credit = excluded.poster_credit,
           updated_at = excluded.updated_at`,
      )
      .bind(
        snapshotId,
        content.summary,
        content.description,
        JSON.stringify(content.descriptionBlocks),
        content.venue?.name ?? null,
        content.venue?.address ?? null,
        content.publicFloor,
        content.publicRoom,
        content.capacity,
        content.costText,
        content.agePolicyText,
        content.waitlistAvailable === null
          ? null
          : Number(content.waitlistAvailable),
        content.availabilityState,
        content.arrivalInstructions,
        content.poster?.sourceUrl ?? null,
        content.poster?.altText ?? null,
        content.poster?.credit ?? null,
        input.now,
        input.now,
        snapshotId,
        input.sourceId,
        input.organizationId,
        input.generationId,
        input.leaseToken,
        input.now,
      ),
  ]);
}

function stageExistingSnapshotPublicContentStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    eventId: string;
    generationId: string;
    identityHash: string;
    leaseToken: string;
    now: number;
    organizationId: string;
    sourceId: string;
  }>,
) {
  return database
    .prepare(
      `INSERT INTO meetup_event_snapshot_public_contents (
         snapshot_id, public_summary, public_description,
         public_description_blocks_json, public_venue_name,
         public_venue_address, public_floor, public_room, capacity,
         cost_text, age_policy_text, waitlist_available,
         availability_state, arrival_instructions, poster_source_url,
         poster_alt_text, poster_credit, created_at, updated_at
       )
       SELECT ?, content.public_summary, content.public_description,
              content.public_description_blocks_json,
              content.public_venue_name, content.public_venue_address,
              content.public_floor, content.public_room, content.capacity,
              content.cost_text, content.age_policy_text,
              content.waitlist_available, content.availability_state,
              content.arrival_instructions,
              content.poster_source_url, content.poster_alt_text,
              content.poster_credit, ?, ?
       FROM sync_sources AS source
       JOIN meetup_event_snapshots AS previous
         ON previous.sync_source_id = source.id
        AND previous.generation_id = source.active_generation_id
        AND previous.external_id = ?
        AND previous.event_id = ?
       JOIN meetup_event_snapshot_public_contents AS content
         ON content.snapshot_id = previous.id
       WHERE source.id = ?
         AND source.organization_id = ?
         AND source.pending_generation_id = ?
         AND source.lease_token = ?
         AND source.lease_expires_at > ?
         AND source.deleted_at IS NULL
       ON CONFLICT(snapshot_id) DO UPDATE SET
         public_summary = excluded.public_summary,
         public_description = excluded.public_description,
         public_description_blocks_json =
           excluded.public_description_blocks_json,
         public_venue_name = excluded.public_venue_name,
         public_venue_address = excluded.public_venue_address,
         public_floor = excluded.public_floor,
         public_room = excluded.public_room,
         capacity = excluded.capacity,
         cost_text = excluded.cost_text,
         age_policy_text = excluded.age_policy_text,
         waitlist_available = excluded.waitlist_available,
         availability_state = excluded.availability_state,
         arrival_instructions = excluded.arrival_instructions,
         poster_source_url = excluded.poster_source_url,
         poster_alt_text = excluded.poster_alt_text,
         poster_credit = excluded.poster_credit,
         updated_at = excluded.updated_at`,
    )
    .bind(
      meetupSnapshotRecordId(
        input.sourceId,
        input.generationId,
        input.identityHash,
      ),
      input.now,
      input.now,
      input.identityHash,
      input.eventId,
      input.sourceId,
      input.organizationId,
      input.generationId,
      input.leaseToken,
      input.now,
    );
}

async function ensurePendingGeneration(
  database: D1DatabaseLike,
  input: Readonly<{
    actorProfileId: string;
    expectedItemCount: number;
    leaseToken: string;
    now: number;
    snapshotHash: string;
    source: SourceRecord;
    manualAuthority: ManualRefreshAuthority | null;
  }>,
): Promise<PendingGeneration> {
  if (
    input.source.pendingGenerationId !== null &&
    input.source.pendingSnapshotHash === input.snapshotHash
  ) {
    const cursor = input.source.pendingCursor ?? 0;
    if (cursor < 0 || cursor > input.expectedItemCount) {
      throw new MeetupSyncError("calendar_invalid");
    }
    const existing = await database
      .prepare(
        `SELECT id
         FROM meetup_sync_generations
         WHERE id = ?
           AND organization_id = ?
           AND sync_source_id = ?
           AND snapshot_hash = ?
           AND expected_item_count = ?
           AND state = 'staging'
         LIMIT 1`,
      )
      .bind(
        input.source.pendingGenerationId,
        input.source.organizationId,
        input.source.id,
        input.snapshotHash,
        input.expectedItemCount,
      )
      .first<Record<string, unknown>>();
    if (!existing) throw new MeetupSyncError("calendar_invalid");
    return Object.freeze({
      cursor,
      id: input.source.pendingGenerationId,
      snapshotHash: input.snapshotHash,
    });
  }

  const generationId = crypto.randomUUID();
  const manualActorWhere = manualActorWhereClause(
    input.manualAuthority,
  );
  const results = await database.batch([
    database
      .prepare(
        `UPDATE sync_sources
         SET pending_generation_id = ?,
             pending_snapshot_hash = ?,
             pending_cursor = 0,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND lease_token = ?
           AND lease_expires_at > ?
           ${manualActorWhere.sql}
           AND deleted_at IS NULL`,
      )
      .bind(
        generationId,
        input.snapshotHash,
        input.actorProfileId,
        input.now,
        input.source.id,
        input.source.organizationId,
        input.leaseToken,
        input.now,
        ...manualActorWhere.bindings,
      ),
    database
      .prepare(
        `INSERT INTO meetup_sync_generations (
           id, organization_id, sync_source_id, previous_generation_id,
           snapshot_hash, expected_item_count, processed_item_count,
           rejected_item_count, state, removed_count, created_at, updated_at,
           published_at, failed_at
         )
         SELECT ?, organization_id, id, active_generation_id, ?, ?, 0, 0,
                'staging', 0, ?, ?, NULL, NULL
         FROM sync_sources
         WHERE id = ?
           AND organization_id = ?
           AND pending_generation_id = ?
           AND pending_snapshot_hash = ?
           AND lease_token = ?
           AND lease_expires_at > ?
           AND deleted_at IS NULL`,
      )
      .bind(
        generationId,
        input.snapshotHash,
        input.expectedItemCount,
        input.now,
        input.now,
        input.source.id,
        input.source.organizationId,
        generationId,
        input.snapshotHash,
        input.leaseToken,
        input.now,
      ),
  ]);
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    throw new MeetupSyncError("lease_lost");
  }
  return Object.freeze({
    cursor: 0,
    id: generationId,
    snapshotHash: input.snapshotHash,
  });
}

function auditAfterChangedStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    action: string;
    actorProfileId: string;
    entityId: string;
    entityType: string;
    metadata: Record<string, unknown>;
    now: number;
    organizationId: string;
    manualAuthority: ManualRefreshAuthority | null;
  }>,
) {
  const actorGuard = input.manualAuthority
    ? `AND ${EXACT_MANUAL_ACTOR_GUARD_SQL}`
    : "";
  const actorBindings = input.manualAuthority
    ? manualActorBindings(input.manualAuthority)
    : [];
  return database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action,
         entity_type, entity_id, metadata_json, created_at
       ) VALUES (
         ?, ?, ?, ?, ?,
         CASE
           WHEN changes() = 1 ${actorGuard}
           THEN ?
           ELSE NULL
         END,
         ?, ?
       )`,
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      input.actorProfileId,
      input.action,
      input.entityType,
      ...actorBindings,
      input.entityId,
      JSON.stringify(input.metadata),
      input.now,
    );
}

function completionAuditStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    actorProfileId: string;
    counts: MeetupRefreshCounts;
    generationId: string;
    importBatchId: string;
    now: number;
    source: SourceRecord;
    triggerMode: RefreshTriggerMode;
    manualAuthority: ManualRefreshAuthority | null;
  }>,
) {
  const actorGuard = input.manualAuthority
    ? `AND ${EXACT_MANUAL_ACTOR_GUARD_SQL}`
    : "";
  const actorBindings = input.manualAuthority
    ? manualActorBindings(input.manualAuthority)
    : [];
  return database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action,
         entity_type, entity_id, metadata_json, created_at
       ) VALUES (
         ?, ?, ?, 'meetup.sync_completed', 'import_batch',
         CASE
           WHEN changes() = 1 ${actorGuard}
           THEN ?
           ELSE NULL
         END,
         (
           SELECT json_object(
             'counts', json_object(
               'cancelled', ?,
               'created', ?,
               'rejected', ?,
               'removed', generation.removed_count,
               'updated', ?
             ),
             'sourceType', ?,
             'triggerMode', ?
           )
           FROM meetup_sync_generations AS generation
           WHERE generation.id = ?
             AND generation.organization_id = ?
             AND generation.sync_source_id = ?
             AND generation.state = 'published'
         ),
         ?
       )`,
    )
    .bind(
      crypto.randomUUID(),
      input.source.organizationId,
      input.actorProfileId,
      ...actorBindings,
      input.importBatchId,
      input.counts.cancelled,
      input.counts.created,
      input.counts.rejected,
      input.counts.updated,
      SOURCE_TYPE,
      input.triggerMode,
      input.generationId,
      input.source.organizationId,
      input.source.id,
      input.now,
    );
}

async function finalizeNotModified(
  database: D1DatabaseLike,
  source: SourceRecord,
  leaseToken: string,
  actorProfileId: string,
  now: number,
  etag: string | null,
  httpLastModified: string | null,
  triggerMode: RefreshTriggerMode,
  manualAuthority: ManualRefreshAuthority | null,
): Promise<void> {
  try {
    await database.batch([
      database
        .prepare(
          `UPDATE sync_sources
         SET lease_token = NULL,
             lease_expires_at = NULL,
             next_refresh_at = ?,
             last_success_at = ?,
             last_error_at = NULL,
             last_error_code = NULL,
             etag = ?,
             http_last_modified = ?,
             pending_snapshot_hash = NULL,
             pending_cursor = NULL,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE id = ?
           AND lease_token = ?
           AND pending_generation_id IS NULL
           AND deleted_at IS NULL`,
        )
        .bind(
          now + REFRESH_INTERVAL_MS,
          now,
          etag,
          httpLastModified,
          actorProfileId,
          now,
          source.id,
          leaseToken,
        ),
      auditAfterChangedStatement(database, {
        action: "meetup.sync_not_modified",
        actorProfileId,
        entityId: source.id,
        entityType: "sync_source",
        metadata: { sourceType: SOURCE_TYPE, triggerMode },
        now,
        organizationId: source.organizationId,
        manualAuthority,
      }),
    ]);
  } catch {
    await sealManualRefreshAuthority(
      database,
      manualAuthority,
      Object.freeze({
        leaseToken,
        organizationId: source.organizationId,
        sourceId: source.id,
      }),
    );
    throw new MeetupSyncError("lease_lost");
  }
}

async function finalizePartialRefresh(
  database: D1DatabaseLike,
  input: Readonly<{
    actorProfileId: string;
    counts: MeetupRefreshCounts;
    generationId: string;
    importBatchId: string;
    leaseToken: string;
    nextCursor: number;
    now: number;
    processedItemCount: number;
    snapshotHash: string;
    source: SourceRecord;
    triggerMode: RefreshTriggerMode;
    manualAuthority: ManualRefreshAuthority | null;
  }>,
): Promise<void> {
  await database.batch([
    database
      .prepare(
        `UPDATE meetup_sync_generations
         SET processed_item_count = processed_item_count + ?,
             rejected_item_count = rejected_item_count + ?,
             updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND sync_source_id = ?
           AND snapshot_hash = ?
           AND state = 'staging'
           AND processed_item_count = ?
           AND processed_item_count + ? <= expected_item_count
           AND EXISTS (
             SELECT 1
             FROM sync_sources
             WHERE id = ?
               AND organization_id = ?
               AND pending_generation_id = ?
               AND pending_snapshot_hash = ?
               AND lease_token = ?
               AND lease_expires_at > ?
               AND deleted_at IS NULL
           )`,
      )
      .bind(
        input.processedItemCount,
        input.counts.rejected,
        input.now,
        input.generationId,
        input.source.organizationId,
        input.source.id,
        input.snapshotHash,
        input.nextCursor - input.processedItemCount,
        input.processedItemCount,
        input.source.id,
        input.source.organizationId,
        input.generationId,
        input.snapshotHash,
        input.leaseToken,
        input.now,
      ),
    database
      .prepare(
        `UPDATE sync_sources
         SET lease_token = NULL,
             lease_expires_at = NULL,
             next_refresh_at = ?,
             last_error_at = NULL,
             last_error_code = NULL,
             pending_snapshot_hash = ?,
             pending_cursor = ?,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE id = ?
           AND lease_token = ?
           AND pending_generation_id = ?
           AND pending_snapshot_hash = ?
           AND changes() = 1
           AND deleted_at IS NULL`,
      )
      .bind(
        input.now,
        input.snapshotHash,
        input.nextCursor,
        input.actorProfileId,
        input.now,
        input.source.id,
        input.leaseToken,
        input.generationId,
        input.snapshotHash,
      ),
    database
      .prepare(
        `UPDATE import_batches
         SET status = 'completed',
             completed_at = ?
         WHERE id = CASE WHEN changes() = 1 THEN ? ELSE NULL END
           AND organization_id = ?
           AND status = 'processing'`,
      )
      .bind(
        input.now,
        input.importBatchId,
        input.source.organizationId,
      ),
    auditAfterChangedStatement(database, {
      action: "meetup.sync_partial",
      actorProfileId: input.actorProfileId,
      entityId: input.importBatchId,
      entityType: "import_batch",
      metadata: {
        counts: input.counts,
        nextCursor: input.nextCursor,
        sourceType: SOURCE_TYPE,
        triggerMode: input.triggerMode,
      },
      now: input.now,
      organizationId: input.source.organizationId,
      manualAuthority: input.manualAuthority,
    }),
  ]);
}

async function finalizeCompletedRefresh(
  database: D1DatabaseLike,
  input: Readonly<{
    actorProfileId: string;
    counts: MeetupRefreshCounts;
    etag: string | null;
    generationId: string;
    httpLastModified: string | null;
    importBatchId: string;
    leaseToken: string;
    now: number;
    processedItemCount: number;
    snapshotHash: string;
    source: SourceRecord;
    triggerMode: RefreshTriggerMode;
    manualAuthority: ManualRefreshAuthority | null;
  }>,
): Promise<number> {
  const todayDate = calendarDateInTimeZone(
    input.now,
    DEFAULT_TIME_ZONE,
  );
  const results = await database.batch([
    database
      .prepare(
        `UPDATE meetup_sync_generations
         SET processed_item_count = processed_item_count + ?,
             rejected_item_count = rejected_item_count + ?,
             updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND sync_source_id = ?
           AND snapshot_hash = ?
           AND state = 'staging'
           AND processed_item_count + ? = expected_item_count
           AND EXISTS (
             SELECT 1
             FROM sync_sources
             WHERE id = ?
               AND organization_id = ?
               AND pending_generation_id = ?
               AND pending_snapshot_hash = ?
               AND lease_token = ?
               AND lease_expires_at > ?
               AND deleted_at IS NULL
           )`,
      )
      .bind(
        input.processedItemCount,
        input.counts.rejected,
        input.now,
        input.generationId,
        input.source.organizationId,
        input.source.id,
        input.snapshotHash,
        input.processedItemCount,
        input.source.id,
        input.source.organizationId,
        input.generationId,
        input.snapshotHash,
        input.leaseToken,
        input.now,
      ),
    database
      .prepare(
        `UPDATE sync_sources
         SET active_generation_id = ?,
             pending_generation_id = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             next_refresh_at = ?,
             last_success_at = ?,
             last_error_at = NULL,
             last_error_code = NULL,
             etag = ?,
             http_last_modified = ?,
             pending_snapshot_hash = NULL,
             pending_cursor = NULL,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND lease_token = ?
           AND pending_generation_id = ?
           AND pending_snapshot_hash = ?
           AND changes() = 1
           AND EXISTS (
             SELECT 1
             FROM meetup_sync_generations AS generation
             WHERE generation.id = ?
               AND generation.organization_id = sync_sources.organization_id
               AND generation.sync_source_id = sync_sources.id
               AND generation.snapshot_hash = ?
               AND generation.state = 'staging'
               AND generation.processed_item_count =
                   generation.expected_item_count
               AND (
                 generation.rejected_item_count = 0
                 OR generation.previous_generation_id IS NULL
               )
               AND (
                 SELECT count(*)
                 FROM meetup_event_snapshots AS staged
                 WHERE staged.sync_source_id = sync_sources.id
                   AND staged.generation_id = generation.id
               ) = (
                 generation.processed_item_count -
                 generation.rejected_item_count
               )
           )
           AND deleted_at IS NULL`,
      )
      .bind(
        input.generationId,
        input.now + REFRESH_INTERVAL_MS,
        input.now,
        input.etag,
        input.httpLastModified,
        input.actorProfileId,
        input.now,
        input.source.id,
        input.source.organizationId,
        input.leaseToken,
        input.generationId,
        input.snapshotHash,
        input.generationId,
        input.snapshotHash,
      ),
    database
      .prepare(
        `INSERT INTO event_revisions (
           id, organization_id, event_id, schedule_version, snapshot_json,
           reason, actor_profile_id, created_at
         )
         SELECT lower(hex(randomblob(16))), event.organization_id, event.id,
                event.schedule_version + 1,
                json_object(
                  'eventId', event.id,
                  'status', 'cancelled',
                  'timeKind', event.time_kind,
                  'startsAtUtcMs', event.starts_at_utc,
                  'endsAtUtcMs', event.ends_at_utc,
                  'timeZone', event.timezone,
                  'allDayStartDate', event.all_day_start_date,
                  'allDayEndDateExclusive',
                    event.all_day_end_date_exclusive,
                  'scheduleVersion', event.schedule_version + 1
                ),
                'Meetup event absent from completed source snapshot',
                ?, ?
         FROM events AS event
         WHERE event.organization_id = ?
           AND event.deleted_at IS NULL
           AND event.status IN ('draft', 'confirmed', 'tentative')
           AND (
             (event.time_kind = 'timed' AND event.ends_at_utc > ?)
             OR
             (event.time_kind = 'all_day'
               AND event.all_day_end_date_exclusive > ?)
           )
           AND EXISTS (
             SELECT 1
             FROM external_source_links AS source_link
             WHERE source_link.organization_id = event.organization_id
               AND source_link.entity_type = 'event'
               AND source_link.entity_id = event.id
               AND source_link.source_type = ?
               AND source_link.sync_source_id = ?
               AND source_link.deleted_at IS NULL
               AND NOT EXISTS (
                 SELECT 1
                 FROM meetup_event_snapshots AS current_snapshot
                 WHERE current_snapshot.sync_source_id =
                       source_link.sync_source_id
                   AND current_snapshot.generation_id = ?
                   AND current_snapshot.external_id =
                       source_link.external_id
               )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM meetup_event_snapshots AS other_snapshot
             JOIN sync_sources AS other_source
               ON other_source.id = other_snapshot.sync_source_id
              AND other_source.active_generation_id =
                  other_snapshot.generation_id
              AND other_source.deleted_at IS NULL
             WHERE other_snapshot.organization_id = event.organization_id
               AND other_snapshot.event_id = event.id
               AND other_snapshot.sync_source_id <> ?
               AND other_snapshot.status IN ('confirmed', 'tentative')
           )
           AND EXISTS (
             SELECT 1
             FROM sync_sources AS current_source
             JOIN meetup_sync_generations AS generation
               ON generation.id = current_source.active_generation_id
              AND generation.sync_source_id = current_source.id
              AND generation.rejected_item_count = 0
             WHERE current_source.id = ?
               AND current_source.organization_id = event.organization_id
               AND current_source.active_generation_id = ?
               AND current_source.deleted_at IS NULL
           )`,
      )
      .bind(
        input.actorProfileId,
        input.now,
        input.source.organizationId,
        input.now,
        todayDate,
        SOURCE_TYPE,
        input.source.id,
        input.generationId,
        input.source.id,
        input.source.id,
        input.generationId,
      ),
    database
      .prepare(
        `UPDATE events
         SET status = 'draft',
             visibility = 'private',
             published_at = NULL,
             schedule_version = schedule_version + 1,
             schedule_review_state = 'unreviewed',
             updated_by_profile_id = ?,
             updated_at = ?,
             deleted_at = ?
         WHERE organization_id = ?
           AND deleted_at IS NULL
           AND status IN ('draft', 'confirmed', 'tentative')
           AND (
             (time_kind = 'timed' AND ends_at_utc > ?)
             OR
             (time_kind = 'all_day'
               AND all_day_end_date_exclusive > ?)
           )
           AND EXISTS (
             SELECT 1
             FROM external_source_links AS source_link
             WHERE source_link.organization_id = events.organization_id
               AND source_link.entity_type = 'event'
               AND source_link.entity_id = events.id
               AND source_link.source_type = ?
               AND source_link.sync_source_id = ?
               AND source_link.deleted_at IS NULL
               AND NOT EXISTS (
                 SELECT 1
                 FROM meetup_event_snapshots AS current_snapshot
                 WHERE current_snapshot.sync_source_id =
                       source_link.sync_source_id
                   AND current_snapshot.generation_id = ?
                   AND current_snapshot.external_id =
                       source_link.external_id
               )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM meetup_event_snapshots AS other_snapshot
             JOIN sync_sources AS other_source
               ON other_source.id = other_snapshot.sync_source_id
              AND other_source.active_generation_id =
                  other_snapshot.generation_id
              AND other_source.deleted_at IS NULL
             WHERE other_snapshot.organization_id = events.organization_id
               AND other_snapshot.event_id = events.id
               AND other_snapshot.sync_source_id <> ?
               AND other_snapshot.status IN ('confirmed', 'tentative')
           )
           AND EXISTS (
             SELECT 1
             FROM sync_sources AS current_source
             JOIN meetup_sync_generations AS generation
               ON generation.id = current_source.active_generation_id
              AND generation.sync_source_id = current_source.id
              AND generation.rejected_item_count = 0
             WHERE current_source.id = ?
               AND current_source.organization_id = events.organization_id
               AND current_source.active_generation_id = ?
               AND current_source.deleted_at IS NULL
           )`,
      )
      .bind(
        input.actorProfileId,
        input.now,
        input.now,
        input.source.organizationId,
        input.now,
        todayDate,
        SOURCE_TYPE,
        input.source.id,
        input.generationId,
        input.source.id,
        input.source.id,
        input.generationId,
      ),
    database
      .prepare(
        `UPDATE meetup_sync_generations
         SET state = 'published',
             removed_count = changes(),
             published_at = ?,
             updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND sync_source_id = ?
           AND state = 'staging'
           AND EXISTS (
             SELECT 1
             FROM sync_sources
             WHERE id = ?
               AND organization_id =
                   meetup_sync_generations.organization_id
               AND active_generation_id =
                   meetup_sync_generations.id
               AND deleted_at IS NULL
           )`,
      )
      .bind(
        input.now,
        input.now,
        input.generationId,
        input.source.organizationId,
        input.source.id,
        input.source.id,
      ),
    database
      .prepare(
        `UPDATE import_batches
         SET status = 'completed',
             completed_at = ?
         WHERE id = CASE WHEN changes() = 1 THEN ? ELSE NULL END
           AND organization_id = ?
           AND status = 'processing'`,
      )
      .bind(
        input.now,
        input.importBatchId,
        input.source.organizationId,
      ),
    completionAuditStatement(database, input),
  ]);
  const removed = changes(results[3]);
  if (
    changes(results[0]) !== 1 ||
    changes(results[1]) !== 1 ||
    changes(results[4]) !== 1 ||
    changes(results[5]) !== 1 ||
    changes(results[6]) !== 1
  ) {
    throw new MeetupSyncError("lease_lost");
  }
  return removed;
}

async function finalizeFailedRefresh(
  database: D1DatabaseLike,
  source: SourceRecord,
  leaseToken: string,
  actorProfileId: string,
  errorCode: MeetupSyncErrorCode,
  now: number,
  importBatchId: string | null,
  triggerMode: RefreshTriggerMode,
  manualAuthority: ManualRefreshAuthority | null,
): Promise<MeetupRefreshResult> {
  const statements = [
    database
      .prepare(
        `UPDATE sync_sources
         SET lease_token = NULL,
             lease_expires_at = NULL,
             next_refresh_at = ?,
             last_error_at = ?,
             last_error_code = ?,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE id = ?
           AND lease_token = ?
           AND deleted_at IS NULL`,
      )
      .bind(
        now + REFRESH_INTERVAL_MS,
        now,
        errorCode,
        actorProfileId,
        now,
        source.id,
        leaseToken,
      ),
  ];
  if (importBatchId) {
    statements.push(
      database
        .prepare(
          `UPDATE import_batches
           SET status = 'failed',
               completed_at = ?
           WHERE id = CASE WHEN changes() = 1 THEN ? ELSE NULL END
             AND organization_id = ?
             AND status = 'processing'`,
        )
        .bind(now, importBatchId, source.organizationId),
    );
  }
  statements.push(
    auditAfterChangedStatement(database, {
      action: "meetup.sync_failed",
      actorProfileId,
      entityId: importBatchId ?? source.id,
      entityType: importBatchId ? "import_batch" : "sync_source",
      metadata: {
        errorCode,
        sourceType: SOURCE_TYPE,
        triggerMode,
      },
      now,
      organizationId: source.organizationId,
      manualAuthority,
    }),
  );
  try {
    await database.batch(statements);
  } catch {
    // A lost lease must not be overwritten by the stale worker.
  }
  const state = await connectionStateForOrganization(
    database,
    source.organizationId,
    now,
  );
  await sealManualRefreshAuthority(
    database,
    manualAuthority,
    Object.freeze({
      leaseToken,
      organizationId: source.organizationId,
      sourceId: source.id,
    }),
  );
  return Object.freeze({
    counts: EMPTY_COUNTS,
    outcome: "failed" as const,
    state,
  });
}

async function connectionStateForOrganization(
  database: D1DatabaseLike,
  organizationId: string,
  now: number,
): Promise<MeetupConnectionState> {
  const sources = await readSourcesForOrganization(
    database,
    organizationId,
    null,
  );
  return aggregateConnectionState(sources, now);
}

async function connectionStateForAuthorizedActor(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  actor: AuthorizedMembership,
  now: number,
): Promise<MeetupConnectionState> {
  const state = await connectionStateForOrganization(
    database,
    actor.organizationId,
    now,
  );
  await revalidateAuthorizedMembership(database, identity, actor, {
    allowedRoles: ["owner", "administrator"],
  });
  return state;
}

async function sealManualRefreshAuthority(
  database: D1DatabaseLike,
  authority: ManualRefreshAuthority | null,
  lease: Readonly<{
    leaseToken: string;
    organizationId: string;
    sourceId: string;
  }> | null = null,
): Promise<void> {
  if (!authority) return;
  try {
    await revalidateAuthorizedMembership(
      database,
      authority.identity,
      authority.membership,
      {
        allowedRoles: ["owner", "administrator"],
      },
    );
  } catch (error) {
    if (lease) {
      await database
        .prepare(
          `UPDATE sync_sources
           SET lease_token = NULL,
               lease_expires_at = NULL
           WHERE id = ?
             AND organization_id = ?
             AND lease_token = ?
             AND deleted_at IS NULL`,
        )
        .bind(
          lease.sourceId,
          lease.organizationId,
          lease.leaseToken,
        )
        .run();
    }
    throw error;
  }
}

async function readSourcesForOrganization(
  database: D1DatabaseLike,
  organizationId: string,
  clubId: string | null,
): Promise<readonly SourceRecord[]> {
  const result = await database
    .prepare(
      `SELECT id, organization_id, club_id, source_url, enabled,
              next_refresh_at, lease_token, lease_expires_at,
               last_attempt_at, last_success_at, last_error_at,
               last_error_code, etag, http_last_modified,
               active_generation_id, pending_generation_id,
               pending_snapshot_hash, pending_cursor,
              updated_by_profile_id
       FROM sync_sources
       WHERE organization_id = ?
         AND (? IS NULL OR club_id = ?)
         AND source_type = ?
         AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`,
    )
    .bind(organizationId, clubId, clubId, SOURCE_TYPE)
    .all<Record<string, unknown>>();
  return Object.freeze((result.results ?? []).map(sourceRecord));
}

async function readAllConfiguredSources(
  database: D1DatabaseLike,
): Promise<readonly SourceRecord[]> {
  const result = await database
    .prepare(
      `SELECT id, organization_id, club_id, source_url, enabled,
              next_refresh_at, lease_token, lease_expires_at,
               last_attempt_at, last_success_at, last_error_at,
               last_error_code, etag, http_last_modified,
               active_generation_id, pending_generation_id,
               pending_snapshot_hash, pending_cursor,
              updated_by_profile_id
       FROM sync_sources
       WHERE source_type = ?
         AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC
       `,
    )
    .bind(SOURCE_TYPE)
    .all<Record<string, unknown>>();
  const rows = result.results ?? [];
  return Object.freeze(rows.map(sourceRecord));
}

async function readSourceById(
  database: D1DatabaseLike,
  sourceId: string,
): Promise<SourceRecord | null> {
  const row = await database
    .prepare(
      `SELECT id, organization_id, club_id, source_url, enabled,
              next_refresh_at, lease_token, lease_expires_at,
               last_attempt_at, last_success_at, last_error_at,
               last_error_code, etag, http_last_modified,
               active_generation_id, pending_generation_id,
               pending_snapshot_hash, pending_cursor,
              updated_by_profile_id
       FROM sync_sources
       WHERE id = ?
         AND source_type = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(sourceId, SOURCE_TYPE)
    .first<Record<string, unknown>>();
  return row ? sourceRecord(row) : null;
}

async function readAliasCanonicalTarget(
  database: D1DatabaseLike,
  organizationId: string,
  aliasSourceId: string,
  canonicalUrl: string,
): Promise<AliasCanonicalTarget | null> {
  const result = await database
    .prepare(
      `SELECT link.id AS link_id,
              event.id AS event_id,
              link.external_url AS external_url,
              source.id AS sync_source_id,
              snapshot.source_fingerprint AS source_fingerprint,
              snapshot.source_sequence AS source_sequence,
              snapshot.source_last_modified_at AS source_last_modified_at,
              snapshot.title AS title,
              snapshot.status AS status,
              snapshot.time_kind AS time_kind,
              snapshot.starts_at_utc AS starts_at_utc,
              snapshot.ends_at_utc AS ends_at_utc,
              snapshot.timezone AS timezone,
              snapshot.all_day_start_date AS all_day_start_date,
              snapshot.all_day_end_date_exclusive AS
                all_day_end_date_exclusive,
              event.schedule_version AS schedule_version,
              event.venue_id AS venue_id,
              event.primary_organizer_profile_id AS
                primary_organizer_profile_id,
              event.organizer_scope_json AS organizer_scope_json
       FROM sync_sources AS source
       JOIN meetup_sync_generations AS generation
         ON generation.id = source.active_generation_id
        AND generation.organization_id = source.organization_id
        AND generation.sync_source_id = source.id
        AND generation.state = 'published'
        AND generation.published_at IS NOT NULL
        AND generation.processed_item_count = generation.expected_item_count
       JOIN meetup_event_snapshots AS snapshot
         ON snapshot.organization_id = source.organization_id
        AND snapshot.sync_source_id = source.id
        AND snapshot.generation_id = generation.id
        AND snapshot.event_url = ?
       JOIN events AS event
         ON event.id = snapshot.event_id
        AND event.organization_id = snapshot.organization_id
        AND event.deleted_at IS NULL
       JOIN external_source_links AS link
         ON link.organization_id = snapshot.organization_id
        AND link.entity_type = 'event'
        AND link.entity_id = snapshot.event_id
        AND link.source_type = ?
        AND link.sync_source_id = snapshot.sync_source_id
        AND link.external_id = snapshot.external_id
        AND link.external_url = snapshot.event_url
        AND link.deleted_at IS NULL
       WHERE source.organization_id = ?
         AND source.id <> ?
         AND source.source_type = ?
         AND source.enabled = 1
         AND source.deleted_at IS NULL
         AND link.external_url = ?
       ORDER BY source.id ASC, snapshot.id ASC
       LIMIT 2`,
    )
    .bind(
      canonicalUrl,
      SOURCE_TYPE,
      organizationId,
      aliasSourceId,
      SOURCE_TYPE,
      canonicalUrl,
    )
    .all<Record<string, unknown>>();
  assertSuccessfulD1Result(result);
  const rows = result.results ?? [];
  if (rows.length !== 1) return null;
  const row = rows[0];
  const organizerScope = readSourceOrganizerScope(row);
  const eventId = requiredRowString(row, "event_id");
  return Object.freeze({
    eventId,
    resourceMapping: Object.freeze({
      allDayEndDateExclusive: readOptionalString(
        row,
        "all_day_end_date_exclusive",
      ),
      allDayStartDate: readOptionalString(row, "all_day_start_date"),
      endsAtUtc: readOptionalInteger(row, "ends_at_utc"),
      eventId,
      externalUrl: readOptionalString(row, "external_url"),
      fingerprint: readOptionalString(row, "source_fingerprint"),
      linkId: requiredRowString(row, "link_id"),
      organizerScope,
      organizerScopeJson: JSON.stringify(organizerScope),
      primaryOrganizerProfileId: readOptionalString(
        row,
        "primary_organizer_profile_id",
      ),
      scheduleVersion: readOptionalInteger(row, "schedule_version"),
      sourceLastModifiedAt: readOptionalInteger(
        row,
        "source_last_modified_at",
      ),
      sourceSequence: readOptionalInteger(row, "source_sequence"),
      startsAtUtc: readOptionalInteger(row, "starts_at_utc"),
      status: readOptionalString(row, "status"),
      syncSourceId: readOptionalString(row, "sync_source_id"),
      timeKind: readOptionalString(row, "time_kind"),
      timeZone: readOptionalString(row, "timezone"),
      title: readOptionalString(row, "title"),
      venueId: readOptionalString(row, "venue_id"),
    }),
  });
}

async function readSourceMapping(
  database: D1DatabaseLike,
  organizationId: string,
  sourceId: string,
  identityHash: string,
): Promise<SourceMapping | null> {
  const row = await database
    .prepare(
      `SELECT link.id AS link_id,
              link.entity_id AS linked_event_id,
              link.external_url AS external_url,
              link.sync_source_id AS sync_source_id,
              link.source_fingerprint AS source_fingerprint,
              link.source_sequence AS source_sequence,
              link.source_last_modified_at AS source_last_modified_at,
              event.id AS event_id,
              event.title AS title,
              COALESCE((
                SELECT snapshot.status
                FROM sync_sources AS mapped_source
                JOIN meetup_event_snapshots AS snapshot
                  ON snapshot.organization_id =
                     mapped_source.organization_id
                 AND snapshot.sync_source_id = mapped_source.id
                 AND snapshot.event_id = event.id
                 AND (
                   snapshot.generation_id =
                     mapped_source.pending_generation_id
                   OR snapshot.generation_id =
                     mapped_source.active_generation_id
                 )
                WHERE mapped_source.id = link.sync_source_id
                  AND mapped_source.organization_id =
                      link.organization_id
                ORDER BY
                  CASE
                    WHEN snapshot.generation_id =
                         mapped_source.pending_generation_id
                    THEN 0
                    ELSE 1
                  END,
                  snapshot.updated_at DESC,
                  snapshot.id ASC
                LIMIT 1
              ), event.status) AS status,
              event.time_kind AS time_kind,
              event.starts_at_utc AS starts_at_utc,
              event.ends_at_utc AS ends_at_utc,
              event.timezone AS timezone,
              event.all_day_start_date AS all_day_start_date,
              event.all_day_end_date_exclusive AS all_day_end_date_exclusive,
              event.schedule_version AS schedule_version,
              event.venue_id AS venue_id,
              event.primary_organizer_profile_id AS
                primary_organizer_profile_id,
              event.organizer_scope_json AS organizer_scope_json
       FROM external_source_links AS link
       LEFT JOIN events AS event
         ON event.id = link.entity_id
        AND event.organization_id = link.organization_id
        AND event.deleted_at IS NULL
       WHERE link.organization_id = ?
         AND link.source_type = ?
         AND link.sync_source_id = ?
         AND link.external_id = ?
         AND link.entity_type = 'event'
         AND link.deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(organizationId, SOURCE_TYPE, sourceId, identityHash)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const organizerScope = readSourceOrganizerScope(row);
  return Object.freeze({
    linkId: requiredRowString(row, "link_id"),
    eventId: readOptionalString(row, "event_id"),
    externalUrl: readOptionalString(row, "external_url"),
    fingerprint: readOptionalString(row, "source_fingerprint"),
    sourceSequence: readOptionalInteger(row, "source_sequence"),
    sourceLastModifiedAt: readOptionalInteger(
      row,
      "source_last_modified_at",
    ),
    syncSourceId: readOptionalString(row, "sync_source_id"),
    title: readOptionalString(row, "title"),
    status: readOptionalString(row, "status"),
    timeKind: readOptionalString(row, "time_kind"),
    startsAtUtc: readOptionalInteger(row, "starts_at_utc"),
    endsAtUtc: readOptionalInteger(row, "ends_at_utc"),
    timeZone: readOptionalString(row, "timezone"),
    allDayStartDate: readOptionalString(row, "all_day_start_date"),
    allDayEndDateExclusive: readOptionalString(
      row,
      "all_day_end_date_exclusive",
    ),
    scheduleVersion: readOptionalInteger(row, "schedule_version"),
    venueId: readOptionalString(row, "venue_id"),
    primaryOrganizerProfileId: readOptionalString(
      row,
      "primary_organizer_profile_id",
    ),
    organizerScope,
    organizerScopeJson: JSON.stringify(organizerScope),
  });
}

function readSourceOrganizerScope(
  row: Record<string, unknown>,
): readonly string[] {
  const raw = readOptionalString(row, "organizer_scope_json");
  if (raw === null) return Object.freeze([]);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (value) =>
          typeof value === "string" &&
          value.length >= 1 &&
          value.length <= 128,
      )
    ) {
      throw new TypeError("invalid organizer scope");
    }
    const canonical = [...new Set(parsed)].sort();
    if (
      canonical.length !== parsed.length ||
      JSON.stringify(canonical) !== raw
    ) {
      throw new TypeError("noncanonical organizer scope");
    }
    return Object.freeze(canonical);
  } catch {
    throw new MeetupSyncError("internal_error");
  }
}

function sourceRecord(row: Record<string, unknown>): SourceRecord {
  const rawErrorCode = readOptionalString(row, "last_error_code");
  const lastErrorCode =
    rawErrorCode &&
    MEETUP_SYNC_ERROR_CODES.some((code) => code === rawErrorCode)
      ? (rawErrorCode as MeetupSyncErrorCode)
      : null;
  return Object.freeze({
    id: requiredRowString(row, "id"),
    organizationId: requiredRowString(row, "organization_id"),
    clubId: requiredRowString(row, "club_id"),
    sourceUrl: requiredRowString(row, "source_url"),
    enabled: row.enabled === 1 || row.enabled === true,
    nextRefreshAt: readOptionalInteger(row, "next_refresh_at"),
    activeGenerationId: readOptionalString(row, "active_generation_id"),
    pendingGenerationId: readOptionalString(row, "pending_generation_id"),
    pendingSnapshotHash: readOptionalString(row, "pending_snapshot_hash"),
    pendingCursor: readOptionalInteger(row, "pending_cursor"),
    leaseToken: readOptionalString(row, "lease_token"),
    leaseExpiresAt: readOptionalInteger(row, "lease_expires_at"),
    lastAttemptAt: readOptionalInteger(row, "last_attempt_at"),
    lastSuccessAt: readOptionalInteger(row, "last_success_at"),
    lastErrorAt: readOptionalInteger(row, "last_error_at"),
    lastErrorCode,
    etag: readOptionalString(row, "etag"),
    httpLastModified: readOptionalString(row, "http_last_modified"),
    updatedByProfileId: requiredRowString(row, "updated_by_profile_id"),
  });
}

function aggregateConnectionState(
  sources: readonly SourceRecord[],
  now: number,
): MeetupConnectionState {
  if (sources.length === 0) return notConnectedState();
  const states = sources.map((source) => stateFromSource(source, now));
  const enabledSources = sources.filter((source) => source.enabled);
  const priority: readonly MeetupConnectionState["status"][] = [
    "refreshing",
    "error",
    "partial",
    "pending",
    "stale",
    "current",
    "disabled",
  ];
  const status =
    priority.find((candidate) =>
      states.some((state) => state.status === candidate),
    ) ?? "disabled";
  const lastAttempts = enabledSources
    .map((source) => source.lastAttemptAt)
    .filter((value): value is number => value !== null);
  const lastSuccesses = enabledSources
    .map((source) => source.lastSuccessAt)
    .filter((value): value is number => value !== null);
  const nextRefreshes = enabledSources
    .map((source) => source.nextRefreshAt)
    .filter((value): value is number => value !== null);
  const errorSource = enabledSources.find(
    (source) => stateFromSource(source, now).status === "error",
  );
  return Object.freeze({
    status,
    enabled: enabledSources.length > 0,
    clubId: sources.length === 1 ? sources[0].clubId : null,
    lastAttemptAt: isoOrNull(
      lastAttempts.length > 0 ? Math.max(...lastAttempts) : null,
    ),
    // The oldest successful source is the conservative aggregate freshness
    // time; it never makes a multi-feed calendar look fresher than it is.
    lastSuccessAt: isoOrNull(
      enabledSources.length > 0 &&
        lastSuccesses.length === enabledSources.length
        ? Math.min(...lastSuccesses)
        : null,
    ),
    nextRefreshAt: isoOrNull(
      nextRefreshes.length > 0 ? Math.min(...nextRefreshes) : null,
    ),
    lastErrorCode: errorSource?.lastErrorCode ?? null,
  });
}

function stateFromSource(
  source: SourceRecord,
  now: number,
): MeetupConnectionState {
  let status: MeetupConnectionState["status"];
  if (!source.enabled) {
    status = "disabled";
  } else if (
    source.leaseToken &&
    source.leaseExpiresAt !== null &&
    source.leaseExpiresAt > now
  ) {
    status = "refreshing";
  } else if (
    source.lastErrorAt !== null &&
    (source.lastSuccessAt === null ||
      source.lastErrorAt >= source.lastSuccessAt)
  ) {
    status = "error";
  } else if (source.pendingSnapshotHash !== null) {
    status = "partial";
  } else if (source.lastSuccessAt === null) {
    status = "pending";
  } else if (now - source.lastSuccessAt > STALE_AFTER_MS) {
    status = "stale";
  } else {
    status = "current";
  }
  return Object.freeze({
    status,
    enabled: source.enabled,
    clubId: source.clubId,
    lastAttemptAt: isoOrNull(source.lastAttemptAt),
    lastSuccessAt: isoOrNull(source.lastSuccessAt),
    nextRefreshAt: isoOrNull(source.nextRefreshAt),
    lastErrorCode: source.lastErrorCode,
  });
}

function notConnectedState(): MeetupConnectionState {
  return Object.freeze({
    status: "not_connected" as const,
    enabled: false,
    clubId: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextRefreshAt: null,
    lastErrorCode: null,
  });
}

function result(
  outcome: MeetupRefreshResult["outcome"],
  state: MeetupConnectionState,
): MeetupRefreshResult {
  return Object.freeze({
    counts: EMPTY_COUNTS,
    outcome,
    state,
  });
}

function mappingMatchesEvent(
  mapping: SourceMapping,
  event: ParsedMeetupEvent,
): boolean {
  if (
    mapping.title !== event.title ||
    mapping.status !== event.status ||
    mapping.externalUrl !== event.eventUrl ||
    mapping.timeKind !== event.schedule.kind ||
    mapping.timeZone !== event.schedule.timeZone
  ) {
    return false;
  }
  return event.schedule.kind === "timed"
    ? mapping.startsAtUtc === event.schedule.startsAtUtcMs &&
        mapping.endsAtUtc === event.schedule.endsAtUtcMs
    : mapping.allDayStartDate === event.schedule.startDate &&
        mapping.allDayEndDateExclusive ===
          event.schedule.endDateExclusive;
}

function mappingScheduleMatchesEvent(
  mapping: SourceMapping,
  event: ParsedMeetupEvent,
): boolean {
  return (
    mapping.status === event.status &&
    mappingScheduleIdentityMatchesEvent(mapping, event)
  );
}

function mappingScheduleIdentityMatchesEvent(
  mapping: SourceMapping,
  event: ParsedMeetupEvent,
): boolean {
  if (
    mapping.timeKind !== event.schedule.kind ||
    mapping.timeZone !== event.schedule.timeZone
  ) {
    return false;
  }
  return event.schedule.kind === "timed"
    ? mapping.startsAtUtc === event.schedule.startsAtUtcMs &&
        mapping.endsAtUtc === event.schedule.endsAtUtcMs
    : mapping.allDayStartDate === event.schedule.startDate &&
        mapping.allDayEndDateExclusive ===
          event.schedule.endDateExclusive;
}

function mappingOwnerReviewedAliasScheduleMatchesEvent(
  mapping: SourceMapping,
  event: ParsedMeetupEvent,
  maxTimedEndDriftMs: number,
): boolean {
  if (
    mapping.timeKind !== event.schedule.kind ||
    mapping.timeZone !== event.schedule.timeZone
  ) {
    return false;
  }
  if (event.schedule.kind === "all_day") {
    return (
      mapping.allDayStartDate === event.schedule.startDate &&
      mapping.allDayEndDateExclusive === event.schedule.endDateExclusive
    );
  }
  return (
    mapping.startsAtUtc === event.schedule.startsAtUtcMs &&
    mapping.endsAtUtc !== null &&
    Math.abs(mapping.endsAtUtc - event.schedule.endsAtUtcMs) <=
      maxTimedEndDriftMs
  );
}

function isStaleSourceRevision(
  mapping: SourceMapping,
  event: ParsedMeetupEvent,
  sourceId: string,
): boolean {
  if (!mapping.eventId || mapping.syncSourceId !== sourceId) return false;
  // The current public group page is an authoritative no-store snapshot but
  // does not expose iCalendar SEQUENCE/LAST-MODIFIED metadata. Do not compare
  // its synthetic parser sequence with an older calendar-import sequence;
  // generation hashing and exact source facts still make the update atomic.
  if (event.publicContent !== null && event.lastModifiedUtcMs === null) {
    return false;
  }
  if (mapping.sourceSequence !== null) {
    if (event.sequence < mapping.sourceSequence) return true;
    if (event.sequence > mapping.sourceSequence) return false;
  }
  return (
    mapping.sourceLastModifiedAt !== null &&
    event.lastModifiedUtcMs !== null &&
    event.lastModifiedUtcMs < mapping.sourceLastModifiedAt
  );
}

function revisionSnapshot(
  eventId: string,
  event: ParsedMeetupEvent,
  scheduleVersion: number,
): string {
  return JSON.stringify({
    id: eventId,
    officialEventUrl: event.eventUrl,
    schedule: event.schedule,
    scheduleReviewState: "unreviewed",
    scheduleVersion,
    sourceType: SOURCE_TYPE,
    status: event.status,
    title: event.title,
    visibility: "public",
  });
}

function sanitizedSourceFacts(
  event: ParsedMeetupEvent,
  identityHash: string,
): Record<string, unknown> {
  return {
    hasRecurrenceId: event.recurrenceId !== null,
    identityHash,
    lastModifiedAt: isoOrNull(event.lastModifiedUtcMs),
    sequence: event.sequence,
    status: event.status,
  };
}

function buildCalendarWorkItems(
  calendar: ParsedMeetupCalendar,
): readonly CalendarWorkItem[] {
  const items: CalendarWorkItem[] = calendar.rejectedEvents.map(
    (rejected) =>
      Object.freeze({
        componentIndex: rejected.componentIndex,
        errorCode: rejected.errorCode,
        kind: "rejected" as const,
      }),
  );
  const seen = new Set<string>();
  for (const event of calendar.events) {
    const duplicate = seen.has(event.sourceKey);
    seen.add(event.sourceKey);
    items.push(
      Object.freeze({
        duplicate,
        event,
        kind: "event" as const,
      }),
    );
  }
  return Object.freeze(
    items.sort((left, right) => {
      const leftIndex =
        left.kind === "event"
          ? left.event.componentIndex
          : left.componentIndex;
      const rightIndex =
        right.kind === "event"
          ? right.event.componentIndex
          : right.componentIndex;
      return leftIndex - rightIndex;
    }),
  );
}

/**
 * Meetup may change transport decoration between otherwise identical source
 * snapshots. Generation identity therefore covers every validated fact that
 * can affect import, ordering, reconciliation, public copy, venue output, or
 * poster provenance, while ignoring irrelevant raw page/calendar bytes.
 */
async function calendarSnapshotHash(
  method: ParsedMeetupCalendar["method"],
  workItems: readonly CalendarWorkItem[],
): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      importPolicy: {
        aliasPolicyVersion: MEETUP_EVENT_ALIAS_POLICY_VERSION,
        aliases: MEETUP_EVENT_ALIASES,
        version: MEETUP_IMPORT_POLICY_VERSION,
      },
      method,
      items: workItems.map((item) =>
        item.kind === "rejected"
          ? {
              componentIndex: item.componentIndex,
              errorCode: item.errorCode,
              kind: item.kind,
            }
          : {
              componentIndex: item.event.componentIndex,
              duplicate: item.duplicate,
              eventUrl: item.event.eventUrl,
              kind: item.kind,
              lastModifiedUtcMs: item.event.lastModifiedUtcMs,
              publicContent: item.event.publicContent,
              schedule: item.event.schedule,
              sequence: item.event.sequence,
              sourceKey: item.event.sourceKey,
              status: item.event.status,
              title: item.event.title,
            },
      ),
    }),
  );
}

async function sourceIdentityHash(
  sourceId: string,
  event: ParsedMeetupEvent,
): Promise<string> {
  return sha256Hex(
    `${SOURCE_TYPE}\u0000${sourceId}\u0000${event.sourceKey}`,
  );
}

async function legacyAliasTombstoneExternalId(
  sourceId: string,
  identityHash: string,
  oldEventId: string,
): Promise<string> {
  return sha256Hex(
    `meetup-alias-tombstone\u0000${sourceId}\u0000${identityHash}\u0000${oldEventId}`,
  );
}

async function eventFingerprint(event: ParsedMeetupEvent): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      eventUrl: event.eventUrl,
      schedule: event.schedule,
      status: event.status,
      title: event.title,
    }),
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function eventSlug(
  title: string,
  identityHash: string,
  eventId: string,
): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 52)
    .replace(/-+$/u, "");
  return `${base || "meetup-event"}-${identityHash.slice(0, 12)}-${eventId.slice(0, 8)}`;
}

function isConflictRejection(error: unknown): boolean {
  if (
    error instanceof MeetupSyncError &&
    error.code === "conflict_rejected"
  ) {
    return true;
  }
  return (
    error instanceof Error &&
    /conflict_guard_|phase4_source_activation_conflict|phase4_source_activation_mismatch|event_revisions\.event_id|audit_logs\.entity_id/iu.test(
      `${error.message} ${
        (error as Error & { cause?: unknown }).cause ?? ""
      }`,
    )
  );
}

function safeSyncErrorCode(error: unknown): MeetupSyncErrorCode {
  if (error instanceof MeetupSyncError) return error.code;
  if (isConflictRejection(error)) return "conflict_rejected";
  return "internal_error";
}

function parseNow(value: number): number {
  return parseFiniteInteger(value, {
    path: "nowUtcMs",
    minimum: 0,
  });
}

function isoOrNull(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function changes(result: D1ResultLike): number {
  return Number(result.meta?.changes ?? 0);
}

function assertSuccessfulD1Result(
  result: D1ResultLike<Record<string, unknown>>,
): void {
  if (result.success === false) {
    throw new MeetupSyncError("internal_error");
  }
}

function isConfigureAuditSentinelFailure(error: unknown): boolean {
  return /NOT NULL constraint failed: audit_logs\.action/iu.test(
    String(error),
  );
}

function requiredRowString(
  row: Record<string, unknown>,
  key: string,
): string {
  const value = readOptionalString(row, key);
  if (value === null) throw new MeetupSyncError("internal_error");
  return value;
}

function readOptionalString(
  row: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!row) return null;
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readOptionalInteger(
  row: Record<string, unknown>,
  key: string,
): number | null {
  const value = row[key];
  return Number.isSafeInteger(value) ? (value as number) : null;
}
