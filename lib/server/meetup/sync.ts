import { authorizeMembership } from "../auth";
import type {
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
import type { ParsedMeetupEvent } from "./ics";
import { parseMeetupIcs } from "./ics";
import type {
  MeetupConnectionState,
  MeetupRefreshCounts,
  MeetupRefreshResult,
} from "./types";
import { parseMeetupGroupCalendarFeedUrl } from "./url";
import { assertMeetupProgramClubMapping } from "./clubs";

const SOURCE_TYPE = "meetup_ics";
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
    AND actor_membership.role IN ('owner', 'administrator')
    AND actor_membership.status = 'active'
    AND actor_membership.deleted_at IS NULL
    AND actor_profile.status = 'active'
    AND actor_profile.deleted_at IS NULL
)`;
// Keeps the worst-case D1 query count below the documented 50-query Free
// Worker invocation ceiling, including a conflict rollback plus rejection
// record for every component in this slice.
export const MAX_MEETUP_ROWS_PER_REFRESH = 3;

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
  scheduleVersion: number | null;
  sourceLastModifiedAt: number | null;
  sourceSequence: number | null;
  syncSourceId: string | null;
  startsAtUtc: number | null;
  status: string | null;
  timeKind: string | null;
  timeZone: string | null;
  title: string | null;
}>;

type RefreshMode = "if_due" | "manual";
type RefreshTriggerMode = "manual" | "refresh_on_view";

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
      throw validationIssue(
        "feedUrl",
        "meetup_feed_already_connected",
        "This official Meetup feed is already assigned to another program.",
      );
    }
    return connectionStateForOrganization(
      database,
      actor.organizationId,
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
    return connectionStateForOrganization(
      database,
      actor.organizationId,
      now,
    );
  }
  if (existingSource) {
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
          sourceId,
          JSON.stringify({
            sourceType: SOURCE_TYPE,
          }),
          now,
        ),
    ]);
  } catch (error) {
    if (isConfigureAuditSentinelFailure(error)) {
      await authorizeMembership(database, identity, {
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
    await authorizeMembership(database, identity, {
      allowedRoles: ["owner", "administrator"],
      clubId,
    });
    throw validationIssue(
      "clubId",
      "meetup_connection_changed",
      "The selected Meetup connection changed before it could be saved.",
    );
  }
  return connectionStateForOrganization(
    database,
    actor.organizationId,
    now,
  );
}

export async function getMeetupConnectionState(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  nowUtcMs = Date.now(),
): Promise<MeetupConnectionState> {
  const actor = await authorizeMembership(database, identity);
  return connectionStateForOrganization(
    database,
    actor.organizationId,
    parseNow(nowUtcMs),
  );
}

export async function refreshMeetupCalendarSource(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  options: Readonly<{
    clubId?: unknown;
    clock?: () => number;
    fetcher?: typeof fetch;
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
    parseNow(options.nowUtcMs ?? Date.now()),
    actor.profileId,
    options.clock ??
      (() => parseNow(options.nowUtcMs ?? Date.now())),
  );
}

/**
 * Server-only refresh-on-view path. It derives the actor from the configured
 * source and never accepts client identity, role, or actor fields.
 */
export async function refreshMeetupCalendarSourceIfDue(
  database: D1DatabaseLike,
  options: Readonly<{
    fetcher?: typeof fetch;
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
  now: number,
  manualActorProfileId: string | null,
  clock: () => number,
): Promise<MeetupRefreshResult> {
  if (sources.length === 0) return result("not_connected", notConnectedState());
  const enabled = sources.filter((source) => source.enabled);
  if (enabled.length === 0) {
    return result("disabled", aggregateConnectionState(sources, now));
  }

  const ordered = [...enabled].sort((left, right) => {
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
    return result(
      busy ? "busy" : "not_due",
      aggregateConnectionState(sources, now),
    );
  }

  // One source per invocation is intentional. Together with the bounded row
  // slice below this stays below D1's documented Free Worker query ceiling.
  return refreshOrganizationSource(database, {
    actorProfileId:
      manualActorProfileId ?? source.updatedByProfileId,
    fetcher,
    mode,
    now,
    organizationId: source.organizationId,
    sourceId: source.id,
    clock,
  });
}

async function refreshOrganizationSource(
  database: D1DatabaseLike,
  input: Readonly<{
    actorProfileId: string;
    fetcher?: typeof fetch;
    mode: RefreshMode;
    now: number;
    organizationId: string;
    sourceId: string;
    clock: () => number;
  }>,
): Promise<MeetupRefreshResult> {
  const triggerMode: RefreshTriggerMode =
    input.mode === "manual" ? "manual" : "refresh_on_view";
  const initialSource = await readSourceById(database, input.sourceId);
  if (!initialSource) {
    return result("not_connected", notConnectedState());
  }
  if (!initialSource.enabled) {
    return result(
      "disabled",
      stateFromSource(initialSource, input.now),
    );
  }

  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = input.now + LEASE_DURATION_MS;
  const acquired = await database
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
         )`,
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
    )
    .run();
  if (changes(acquired) !== 1) {
    const current =
      (await readSourceById(database, initialSource.id)) ?? initialSource;
    const outcome =
      current.leaseToken &&
      current.leaseExpiresAt !== null &&
      current.leaseExpiresAt > input.now
        ? "busy"
        : "not_due";
    return result(outcome, stateFromSource(current, input.now));
  }

  const source = await readSourceByLease(
    database,
    initialSource.id,
    leaseToken,
  );
  if (!source) throw new MeetupSyncError("lease_lost");

  let fetched;
  try {
    fetched = await fetchMeetupCalendar(source.sourceUrl, {
      // A partial generation must be fetched again so the cursor can resume
      // against the same bounded snapshot; a conditional 304 would not carry
      // the calendar body needed for the remaining slice.
      etag: source.pendingGenerationId ? null : source.etag,
      fetcher: input.fetcher,
      httpLastModified: source.pendingGenerationId
        ? null
        : source.httpLastModified,
    });
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
    );
  }

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
    );
    return result(
      "not_modified",
      await connectionStateForOrganization(
        database,
        input.organizationId,
        input.now,
      ),
    );
  }

  let calendar;
  try {
    calendar = parseMeetupIcs(fetched.calendarText);
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
    );
  }
  const cursor = generation.cursor;
  const workSlice = workItems.slice(
    cursor,
    cursor + MAX_MEETUP_ROWS_PER_REFRESH,
  );
  const nextCursor = cursor + workSlice.length;
  const hasMore = nextCursor < workItems.length;

  const importBatchId = crypto.randomUUID();
  const batchNow = parseNow(input.clock());
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
         AND deleted_at IS NULL`,
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
    )
    .run();
  if (changes(batchCreated) !== 1) {
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
        });
        mutableCounts.rejected += 1;
        continue;
      }

      if (
        event.schedule.kind === "all_day" &&
        event.status !== "cancelled"
      ) {
        await recordRejectedRow(database, {
          actorProfileId: input.actorProfileId,
          errorCode: "unsupported_all_day_reservation",
          importBatchId,
          leaseToken,
          now: rowNow,
          organizationId: source.organizationId,
          rowNumber: event.componentIndex + 1,
          sourceId: source.id,
          sourcePayload: sanitizedSourceFacts(event, identityHash),
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
      });
    } else {
      const removed = await finalizeCompletedRefresh(database, {
        actorProfileId: input.actorProfileId,
        counts,
        etag: fetched.etag,
        generationId: generation.id,
        httpLastModified: fetched.httpLastModified,
        importBatchId,
        leaseToken,
        now: finishNow,
        processedItemCount: workSlice.length,
        snapshotHash,
        source,
        triggerMode,
      });
      mutableCounts.removed = removed;
    }
    const finalCounts = Object.freeze({ ...mutableCounts });
    return Object.freeze({
      counts: finalCounts,
      outcome: hasMore ? ("partial" as const) : ("completed" as const),
      state: await connectionStateForOrganization(
        database,
        input.organizationId,
        finishNow,
      ),
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
  }>,
): Promise<"created" | "skipped" | "updated"> {
  const fingerprint = await eventFingerprint(input.event);
  const mapping = await readSourceMapping(
    database,
    input.organizationId,
    input.sourceId,
    input.identityHash,
  );
  if (mapping && isStaleSourceRevision(mapping, input.event, input.sourceId)) {
    await recordSkippedRow(database, {
      ...input,
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
      expectedScheduleVersion: mapping.scheduleVersion,
      fingerprint,
      linkId: mapping.linkId,
    });
    return "updated";
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
  }>,
): Promise<void> {
  const scheduleVersion = 1;
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
    }),
    stageEventSnapshotStatement(database, input),
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
  }>,
): Promise<void> {
  const scheduleVersion = input.expectedScheduleVersion + 1;
  await database.batch([
    updateEventStatement(database, input),
    database
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
        "Meetup calendar update",
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
    updateSourceLinkStatement(database, input),
    auditAfterChangedStatement(database, {
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
    }),
    stageEventSnapshotStatement(database, input),
  ]);
}

async function recordSkippedRow(
  database: D1DatabaseLike,
  input: Readonly<{
    actorProfileId: string;
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
  }>,
): Promise<void> {
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
    }),
    input.staleRevision
      ? stageExistingSnapshotStatement(database, input)
      : stageEventSnapshotStatement(database, input),
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
           id, organization_id, club_id, primary_organizer_profile_id,
           title, slug, summary, description, status, visibility, time_kind,
           starts_at_utc, ends_at_utc, timezone, all_day_start_date,
           all_day_end_date_exclusive, buffer_before_minutes,
           buffer_after_minutes, organizer_scope_json, schedule_version,
           schedule_review_state, hold_expires_at, private_notes,
           private_meeting_details, published_at, created_by_profile_id,
           updated_by_profile_id, created_at, updated_at, deleted_at
         ) VALUES (
           ?, ?, ?, NULL, ?, ?, NULL, NULL, ?, 'public', 'timed',
           ?, ?, ?, NULL, NULL, 0, 0, '[]', 1, 'unreviewed', NULL,
           NULL, NULL, ?, ?, ?, ?, ?, NULL
         )`,
      )
      .bind(
        input.eventId,
        input.organizationId,
        input.clubId,
        input.event.title,
        slug,
        input.event.status,
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
         id, organization_id, club_id, primary_organizer_profile_id,
         title, slug, summary, description, status, visibility, time_kind,
         starts_at_utc, ends_at_utc, timezone, all_day_start_date,
         all_day_end_date_exclusive, buffer_before_minutes,
         buffer_after_minutes, organizer_scope_json, schedule_version,
         schedule_review_state, hold_expires_at, private_notes,
         private_meeting_details, published_at, created_by_profile_id,
         updated_by_profile_id, created_at, updated_at, deleted_at
       ) VALUES (
         ?, ?, ?, NULL, ?, ?, NULL, NULL, ?, 'public', 'all_day',
         NULL, NULL, ?, ?, ?, 0, 0, '[]', 1, 'unreviewed', NULL,
         NULL, NULL, ?, ?, ?, ?, ?, NULL
       )`,
    )
    .bind(
      input.eventId,
      input.organizationId,
      input.clubId,
      input.event.title,
      slug,
      input.event.status,
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
  }>,
) {
  if (input.event.schedule.kind === "timed") {
    return database
      .prepare(
        `UPDATE events
         SET club_id = ?,
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
             schedule_version = schedule_version + 1,
             schedule_review_state = 'unreviewed',
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
        input.event.title,
        input.event.status,
        input.event.schedule.startsAtUtcMs,
        input.event.schedule.endsAtUtcMs,
        input.event.schedule.timeZone,
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
           schedule_version = schedule_version + 1,
           schedule_review_state = 'unreviewed',
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
      input.event.title,
      input.event.status,
      input.event.schedule.timeZone,
      input.event.schedule.startDate,
      input.event.schedule.endDateExclusive,
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
      crypto.randomUUID(),
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
      crypto.randomUUID(),
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

async function ensurePendingGeneration(
  database: D1DatabaseLike,
  input: Readonly<{
    actorProfileId: string;
    expectedItemCount: number;
    leaseToken: string;
    now: number;
    snapshotHash: string;
    source: SourceRecord;
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
  }>,
) {
  return database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action,
         entity_type, entity_id, metadata_json, created_at
       ) VALUES (
         ?, ?, ?, ?, ?,
         CASE WHEN changes() = 1 THEN ? ELSE NULL END,
         ?, ?
       )`,
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      input.actorProfileId,
      input.action,
      input.entityType,
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
  }>,
) {
  return database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action,
         entity_type, entity_id, metadata_json, created_at
       ) VALUES (
         ?, ?, ?, 'meetup.sync_completed', 'import_batch',
         CASE WHEN changes() = 1 THEN ? ELSE NULL END,
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
): Promise<void> {
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
    }),
  ]);
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
           AND event.status IN ('confirmed', 'tentative')
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
         SET status = 'cancelled',
             visibility = 'private',
             published_at = NULL,
             schedule_version = schedule_version + 1,
             schedule_review_state = 'unreviewed',
             updated_by_profile_id = ?,
             updated_at = ?,
             deleted_at = ?
         WHERE organization_id = ?
           AND deleted_at IS NULL
           AND status IN ('confirmed', 'tentative')
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
    }),
  );
  try {
    await database.batch(statements);
  } catch {
    // A lost lease must not be overwritten by the stale worker.
  }
  return Object.freeze({
    counts: EMPTY_COUNTS,
    outcome: "failed" as const,
    state: await connectionStateForOrganization(
      database,
      source.organizationId,
      now,
    ),
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

async function readSourceByLease(
  database: D1DatabaseLike,
  sourceId: string,
  leaseToken: string,
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
         AND lease_token = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(sourceId, leaseToken)
    .first<Record<string, unknown>>();
  return row ? sourceRecord(row) : null;
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
              event.status AS status,
              event.time_kind AS time_kind,
              event.starts_at_utc AS starts_at_utc,
              event.ends_at_utc AS ends_at_utc,
              event.timezone AS timezone,
              event.all_day_start_date AS all_day_start_date,
              event.all_day_end_date_exclusive AS all_day_end_date_exclusive,
              event.schedule_version AS schedule_version
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
  });
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

function isStaleSourceRevision(
  mapping: SourceMapping,
  event: ParsedMeetupEvent,
  sourceId: string,
): boolean {
  if (!mapping.eventId || mapping.syncSourceId !== sourceId) return false;
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
  calendar: ReturnType<typeof parseMeetupIcs>,
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
 * Meetup may change transport/calendar metadata between otherwise identical
 * exports. Generation identity therefore covers only validated facts that can
 * affect import, ordering, reconciliation, or publication. Ignored raw
 * descriptions, locations, and calendar decoration cannot strand a cursor.
 */
async function calendarSnapshotHash(
  method: ReturnType<typeof parseMeetupIcs>["method"],
  workItems: readonly CalendarWorkItem[],
): Promise<string> {
  return sha256Hex(
    JSON.stringify({
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
  return (
    error instanceof Error &&
    /conflict_guard_|event_revisions\.event_id|audit_logs\.entity_id/iu.test(
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
