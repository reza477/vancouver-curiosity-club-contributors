import {
  authorizeMembership,
  type AuthorizedMembership,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  parseOptionalBoundedString,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  parseCalendarDate,
  parseIanaTimeZone,
} from "../../time";
import {
  EVENT_PLANNING_STATUSES,
  EVENT_PUBLICATION_STATUSES,
  mapLegacyPlanningStatus,
  mapLegacyPublicationStatus,
  type CanonicalEventSchedule,
  type EventPlanningStatus,
  type EventPublicationStatus,
} from "./lifecycle";
import { organizerScheduleOverlapsUtcRange } from "./schedule-state";
import { reconcileOrganizerHoldNotices } from "./hold-reconciliation";

const CALENDAR_QUERY_PAGE_SIZE = 250;
const CALENDAR_CANDIDATE_SCAN_LIMIT = 5_000;

export const ORGANIZER_EVENT_SOURCES = ["manual", "meetup", "legacy"] as const;
export type OrganizerEventSource = (typeof ORGANIZER_EVENT_SOURCES)[number];

export type OrganizerCalendarEventDto = Readonly<{
  id: string;
  source: OrganizerEventSource;
  sourceLabel: "Manual" | "Meetup" | "Existing event";
  readOnly: boolean;
  clubId: string;
  clubName: string;
  eventLaneId: string | null;
  categoryId: string | null;
  title: string;
  planningStatus: EventPlanningStatus;
  publicationStatus: EventPublicationStatus;
  schedule: CanonicalEventSchedule;
  primaryOrganizerProfileId: string | null;
  coOrganizerProfileIds: readonly string[];
  primaryOrganizerDisplayName: string | null;
  meetupEventUrl: string | null;
  contentVersion: number | null;
  conflictCount: number;
  conflictState:
    | "approved"
    | "none"
    | "open"
    | "pending"
    | "warning";
  holdExpiresAt: number | null;
  holdState: "active" | "expired" | "nearing_expiry" | null;
  scheduleVersion: number;
  updatedAt: number;
}>;

export type OrganizerCalendarFilters = Readonly<{
  search?: unknown;
  clubId?: unknown;
  organizerProfileId?: unknown;
  planningStatus?: unknown;
  publicationStatus?: unknown;
  eventLaneId?: unknown;
  categoryId?: unknown;
  source?: unknown;
  fromUtc?: unknown;
  toUtc?: unknown;
  limit?: unknown;
}>;

export type OrganizerCalendarResult = Readonly<{
  events: readonly OrganizerCalendarEventDto[];
  scheduled: readonly OrganizerCalendarEventDto[];
  ideas: readonly OrganizerCalendarEventDto[];
  hasMore: boolean;
  loadedCount: number;
  nextLimit: number | null;
  resultCount: number;
}>;

export async function listOrganizerCalendarEvents(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  rawFilters: OrganizerCalendarFilters = {},
): Promise<OrganizerCalendarResult> {
  await reconcileOrganizerHoldNotices(database, identity);
  const actor = await authorizeMembership(database, identity);
  const filters = parseFilters(rawFilters);
  const candidates = await loadCalendarCandidates(database, actor, null);
  const events = candidates.filter((event) => eventMatches(event, filters));
  const bounded = Object.freeze(events.slice(0, filters.limit));
  return Object.freeze({
    events: bounded,
    scheduled: Object.freeze(
      bounded.filter((event) => event.schedule.shape !== "unscheduled"),
    ),
    ideas: Object.freeze(
      bounded.filter((event) => event.schedule.shape === "unscheduled"),
    ),
    hasMore: bounded.length < events.length,
    loadedCount: bounded.length,
    nextLimit:
      bounded.length < events.length
        ? Math.min(
            events.length,
            bounded.length + 500,
            CALENDAR_CANDIDATE_SCAN_LIMIT,
          )
        : null,
    resultCount: events.length,
  });
}

export async function getOrganizerCalendarEvent(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  eventIdValue: unknown,
): Promise<OrganizerCalendarEventDto> {
  const eventId = parseIdentifier(eventIdValue, "eventId");
  await reconcileOrganizerHoldNotices(database, identity);
  const actor = await authorizeMembership(database, identity);
  const events = await loadCalendarCandidates(database, actor, eventId);
  const event = events[0];
  if (!event) {
    throw new SafeApplicationError(
      "not_found",
      404,
      "The event could not be found.",
    );
  }
  return event;
}

async function loadCalendarCandidates(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string | null,
): Promise<OrganizerCalendarEventDto[]> {
  const [manual, legacy, meetup] = await Promise.all([
    loadManualEvents(database, actor, eventId),
    loadLegacyEvents(database, actor, eventId),
    loadMeetupEvents(database, actor, eventId),
  ]);
  const candidates = [...manual, ...legacy, ...meetup];
  if (eventId === null && candidates.length > CALENDAR_CANDIDATE_SCAN_LIMIT) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The organizer calendar is too large to load safely.",
    );
  }
  return candidates.sort(compareCalendarEvents);
}

async function loadManualEvents(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string | null,
): Promise<OrganizerCalendarEventDto[]> {
  const statement = database.prepare(
      `SELECT event.id,
              event.club_id,
              club.name AS club_name,
              event.event_lane_id,
              event.category_id,
              event.title,
              event.planning_status,
              event.publication_status,
              event.schedule_shape,
              event.starts_at_utc,
              event.ends_at_utc,
              event.timezone,
              event.all_day_start_date,
              event.all_day_end_date_exclusive,
              event.primary_organizer_profile_id,
              COALESCE((
                SELECT json_group_array(co_organizer.profile_id)
                FROM organizer_event_organizers AS co_organizer
                WHERE co_organizer.organization_id = event.organization_id
                  AND co_organizer.organizer_event_id = event.id
                  AND co_organizer.deleted_at IS NULL
              ), '[]') AS co_organizer_profile_ids,
              COALESCE(
                profile_preference.workspace_display_name,
                profile.display_name
              ) AS organizer_display_name,
              event.meetup_event_url,
              event.content_version,
              event.schedule_version,
              reservation.hold_expires_at,
              CASE
                WHEN event.planning_status <> 'tentative_hold'
                  OR reservation.hold_expires_at IS NULL
                THEN NULL
                WHEN reservation.hold_expires_at <=
                     CAST(unixepoch('subsec') * 1000 AS INTEGER)
                THEN 'expired'
                WHEN reservation.hold_expires_at <=
                     CAST(unixepoch('subsec') * 1000 AS INTEGER) +
                     (COALESCE(policy.nearing_expiry_hours, 24) * 3600000)
                THEN 'nearing_expiry'
                ELSE 'active'
              END AS hold_state,
              (
                SELECT count(*)
                FROM organizer_conflict_incidents AS incident
                WHERE incident.organization_id = event.organization_id
                  AND (
                    incident.organizer_event_id = event.id
                    OR (
                      incident.conflicting_source_kind = 'manual'
                      AND incident.conflicting_event_id = event.id
                    )
                  )
                  AND incident.state IN (
                    'open', 'pending_approval', 'approved', 'informational'
                  )
              ) AS conflict_count,
              COALESCE((
                SELECT CASE incident.state
                  WHEN 'pending_approval' THEN 'pending'
                  WHEN 'informational' THEN 'warning'
                  ELSE incident.state
                END
                FROM organizer_conflict_incidents AS incident
                WHERE incident.organization_id = event.organization_id
                  AND (
                    incident.organizer_event_id = event.id
                    OR (
                      incident.conflicting_source_kind = 'manual'
                      AND incident.conflicting_event_id = event.id
                    )
                  )
                  AND incident.state IN (
                    'open', 'pending_approval', 'approved', 'informational'
                  )
                ORDER BY CASE incident.state
                  WHEN 'pending_approval' THEN 1
                  WHEN 'open' THEN 2
                  WHEN 'approved' THEN 3
                  ELSE 4
                END, incident.id
                LIMIT 1
              ), 'none') AS conflict_state,
              event.updated_at,
              CASE
                WHEN ? <> 'organizer'
                  OR event.primary_organizer_profile_id = ?
                  OR EXISTS (
                    SELECT 1
                    FROM organizer_event_organizers AS actor_association
                    WHERE actor_association.organization_id =
                          event.organization_id
                      AND actor_association.organizer_event_id = event.id
                      AND actor_association.profile_id = ?
                      AND actor_association.deleted_at IS NULL
                  )
                THEN 0 ELSE 1
              END AS read_only
       FROM organizer_events AS event
       JOIN clubs AS club
         ON club.id = event.club_id
        AND club.organization_id = event.organization_id
        AND club.deleted_at IS NULL
       LEFT JOIN profiles AS profile
         ON profile.id = event.primary_organizer_profile_id
       LEFT JOIN organizer_profile_preferences AS profile_preference
         ON profile_preference.profile_id = profile.id
        AND profile_preference.organization_id = event.organization_id
       LEFT JOIN organizer_reservation_states AS reservation
         ON reservation.organizer_event_id = event.id
        AND reservation.organization_id = event.organization_id
       LEFT JOIN organizer_conflict_policies AS policy
         ON policy.organization_id = event.organization_id
       WHERE event.organization_id = ?
         AND event.deleted_at IS NULL
         AND (? IS NULL OR event.id = ?)
       ORDER BY event.updated_at DESC, event.id ASC
       LIMIT ? OFFSET ?`,
    );
  const rows = await loadCandidatePages(
    database,
    statement,
    [
      actor.role,
      actor.profileId,
      actor.profileId,
      actor.organizationId,
      eventId,
      eventId,
    ],
    eventId,
  );
  return rows.map((row) => readCalendarRow(row, "manual"));
}

async function loadLegacyEvents(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string | null,
): Promise<OrganizerCalendarEventDto[]> {
  const statement = database.prepare(
      `SELECT event.id,
              event.club_id,
              club.name AS club_name,
              event.event_lane_id,
              event.category_id,
              event.title,
              event.status AS planning_status,
              event.visibility,
              event.published_at,
              event.time_kind AS schedule_shape,
              event.starts_at_utc,
              event.ends_at_utc,
              event.timezone,
              event.all_day_start_date,
              event.all_day_end_date_exclusive,
              event.primary_organizer_profile_id,
              COALESCE((
                SELECT json_group_array(co_organizer.profile_id)
                FROM event_organizers AS co_organizer
                WHERE co_organizer.organization_id = event.organization_id
                  AND co_organizer.event_id = event.id
                  AND co_organizer.role = 'co_organizer'
                  AND co_organizer.deleted_at IS NULL
              ), '[]') AS co_organizer_profile_ids,
              COALESCE(
                profile_preference.workspace_display_name,
                profile.display_name
              ) AS organizer_display_name,
              NULL AS meetup_event_url,
              event.schedule_version,
              event.updated_at
       FROM events AS event
       JOIN clubs AS club
         ON club.id = event.club_id
        AND club.organization_id = event.organization_id
        AND club.deleted_at IS NULL
       LEFT JOIN profiles AS profile
         ON profile.id = event.primary_organizer_profile_id
       LEFT JOIN organizer_profile_preferences AS profile_preference
         ON profile_preference.profile_id = profile.id
        AND profile_preference.organization_id = event.organization_id
       WHERE event.organization_id = ?
         AND event.deleted_at IS NULL
         AND (? IS NULL OR event.id = ?)
         AND NOT EXISTS (
           SELECT 1
           FROM external_source_links AS source_link
           WHERE source_link.organization_id = event.organization_id
             AND source_link.entity_type = 'event'
             AND source_link.entity_id = event.id
             AND source_link.source_type = 'meetup_ics'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM organizer_events AS adopted_event
           WHERE adopted_event.id = event.id
             AND adopted_event.organization_id = event.organization_id
         )
       ORDER BY event.updated_at DESC, event.id ASC
       LIMIT ? OFFSET ?`,
    );
  const rows = await loadCandidatePages(
    database,
    statement,
    [actor.organizationId, eventId, eventId],
    eventId,
  );
  return rows.map((row) => readCalendarRow(row, "legacy"));
}

/**
 * Every mutable source fact comes from the published active snapshot. The
 * pending canonical event row is used only for immutable linkage and the
 * existing published_at compatibility mapping.
 */
async function loadMeetupEvents(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string | null,
): Promise<OrganizerCalendarEventDto[]> {
  const statement = database.prepare(
      `SELECT snapshot.event_id AS id,
              source.club_id,
              club.name AS club_name,
              event.event_lane_id,
              event.category_id,
              snapshot.title,
              snapshot.status AS planning_status,
              event.visibility,
              event.published_at,
              snapshot.time_kind AS schedule_shape,
              snapshot.starts_at_utc,
              snapshot.ends_at_utc,
              snapshot.timezone,
              snapshot.all_day_start_date,
              snapshot.all_day_end_date_exclusive,
              event.primary_organizer_profile_id,
              COALESCE((
                SELECT json_group_array(co_organizer.profile_id)
                FROM event_organizers AS co_organizer
                WHERE co_organizer.organization_id = event.organization_id
                  AND co_organizer.event_id = event.id
                  AND co_organizer.role = 'co_organizer'
                  AND co_organizer.deleted_at IS NULL
              ), '[]') AS co_organizer_profile_ids,
              COALESCE(
                profile_preference.workspace_display_name,
                profile.display_name
              ) AS organizer_display_name,
              snapshot.event_url AS meetup_event_url,
              event.schedule_version,
              snapshot.updated_at
       FROM sync_sources AS source
       JOIN meetup_sync_generations AS generation
         ON generation.id = source.active_generation_id
        AND generation.organization_id = source.organization_id
        AND generation.sync_source_id = source.id
        AND generation.state = 'published'
       JOIN meetup_event_snapshots AS snapshot
         ON snapshot.organization_id = source.organization_id
        AND snapshot.sync_source_id = source.id
        AND snapshot.generation_id = source.active_generation_id
       JOIN events AS event
         ON event.id = snapshot.event_id
        AND event.organization_id = source.organization_id
       JOIN clubs AS club
         ON club.id = source.club_id
        AND club.organization_id = source.organization_id
        AND club.deleted_at IS NULL
       LEFT JOIN profiles AS profile
         ON profile.id = event.primary_organizer_profile_id
       LEFT JOIN organizer_profile_preferences AS profile_preference
         ON profile_preference.profile_id = profile.id
        AND profile_preference.organization_id = event.organization_id
       WHERE source.organization_id = ?
         AND source.source_type = 'meetup_ics'
         AND source.enabled = 1
         AND source.active_generation_id IS NOT NULL
         AND source.enabled = 1
         AND source.deleted_at IS NULL
         AND (? IS NULL OR snapshot.event_id = ?)
       ORDER BY snapshot.updated_at DESC, snapshot.event_id ASC
       LIMIT ? OFFSET ?`,
    );
  const rows = await loadCandidatePages(
    database,
    statement,
    [actor.organizationId, eventId, eventId],
    eventId,
  );
  return rows.map((row) => readCalendarRow(row, "meetup"));
}

function readCalendarRow(
  row: Record<string, unknown>,
  source: OrganizerEventSource,
): OrganizerCalendarEventDto {
  const planningStatus =
    source === "manual"
      ? readManualPlanningStatus(row.planning_status)
      : source === "meetup"
        ? mapMeetupPlanningStatus(row.planning_status)
        : mapLegacyPlanningStatus(row.planning_status);
  const publicationStatus =
    source === "manual"
      ? readManualPublicationStatus(row.publication_status)
      : mapLegacyPublicationStatus(row.visibility, row.published_at);
  return Object.freeze({
    id: requiredString(row.id),
    source,
    sourceLabel:
      source === "manual"
        ? ("Manual" as const)
        : source === "meetup"
          ? ("Meetup" as const)
          : ("Existing event" as const),
    readOnly:
      source === "manual" ? requiredInteger(row.read_only) === 1 : true,
    clubId: requiredString(row.club_id),
    clubName: requiredString(row.club_name),
    eventLaneId: optionalString(row.event_lane_id),
    categoryId: optionalString(row.category_id),
    title: requiredString(row.title),
    planningStatus,
    publicationStatus,
    schedule: readSchedule(row),
    primaryOrganizerProfileId: optionalString(
      row.primary_organizer_profile_id,
    ),
    coOrganizerProfileIds: readStringArray(row.co_organizer_profile_ids),
    primaryOrganizerDisplayName: optionalString(
      row.organizer_display_name,
    ),
    meetupEventUrl: optionalString(row.meetup_event_url),
    contentVersion:
      source === "manual" ? requiredInteger(row.content_version) : null,
    conflictCount:
      source === "manual" ? requiredInteger(row.conflict_count) : 0,
    conflictState:
      source === "manual"
        ? readConflictState(row.conflict_state)
        : "none",
    holdExpiresAt:
      source === "manual" ? optionalInteger(row.hold_expires_at) : null,
    holdState:
      source === "manual" ? readHoldState(row.hold_state) : null,
    scheduleVersion: requiredInteger(row.schedule_version),
    updatedAt: requiredInteger(row.updated_at),
  });
}

function parseFilters(raw: OrganizerCalendarFilters) {
  const fromUtc =
    raw.fromUtc === undefined
      ? null
      : parseFiniteInteger(raw.fromUtc, {
          path: "fromUtc",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        });
  const toUtc =
    raw.toUtc === undefined
      ? null
      : parseFiniteInteger(raw.toUtc, {
          path: "toUtc",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        });
  if (fromUtc !== null && toUtc !== null && toUtc <= fromUtc) {
    throw new SafeApplicationError(
      "validation_failed",
      422,
      "The calendar date range is invalid.",
    );
  }
  return Object.freeze({
    search:
      parseOptionalBoundedString(raw.search, {
        path: "search",
        maxLength: 120,
      })?.toLocaleLowerCase("en-CA") ?? null,
    clubId: parseOptionalIdentifier(raw.clubId, "clubId"),
    organizerProfileId: parseOptionalIdentifier(
      raw.organizerProfileId,
      "organizerProfileId",
    ),
    planningStatus:
      raw.planningStatus === undefined
        ? null
        : parseEnum(
            raw.planningStatus,
            EVENT_PLANNING_STATUSES,
            "planningStatus",
          ),
    publicationStatus:
      raw.publicationStatus === undefined
        ? null
        : parseEnum(
            raw.publicationStatus,
            EVENT_PUBLICATION_STATUSES,
            "publicationStatus",
          ),
    eventLaneId: parseOptionalIdentifier(raw.eventLaneId, "eventLaneId"),
    categoryId: parseOptionalIdentifier(raw.categoryId, "categoryId"),
    source:
      raw.source === undefined
        ? null
        : parseEnum(raw.source, ORGANIZER_EVENT_SOURCES, "source"),
    fromUtc,
    toUtc,
    limit: parseFiniteInteger(raw.limit ?? 500, {
      path: "limit",
      minimum: 1,
      maximum: CALENDAR_CANDIDATE_SCAN_LIMIT,
    }),
  });
}

function eventMatches(
  event: OrganizerCalendarEventDto,
  filters: ReturnType<typeof parseFilters>,
): boolean {
  if (
    filters.search !== null &&
    !`${event.title} ${event.clubName}`
      .toLocaleLowerCase("en-CA")
      .includes(filters.search)
  ) {
    return false;
  }
  if (filters.clubId !== null && event.clubId !== filters.clubId) return false;
  if (
    filters.organizerProfileId !== null &&
    event.primaryOrganizerProfileId !== filters.organizerProfileId &&
    !event.coOrganizerProfileIds.includes(filters.organizerProfileId)
  ) {
    return false;
  }
  if (
    filters.planningStatus !== null &&
    event.planningStatus !== filters.planningStatus
  ) {
    return false;
  }
  if (
    filters.publicationStatus !== null &&
    event.publicationStatus !== filters.publicationStatus
  ) {
    return false;
  }
  if (
    filters.eventLaneId !== null &&
    event.eventLaneId !== filters.eventLaneId
  ) {
    return false;
  }
  if (
    filters.categoryId !== null &&
    event.categoryId !== filters.categoryId
  ) {
    return false;
  }
  if (filters.source !== null && event.source !== filters.source) return false;
  if (
    (filters.fromUtc !== null || filters.toUtc !== null) &&
    !organizerScheduleOverlapsUtcRange(
      event.schedule,
      filters.fromUtc,
      filters.toUtc,
    )
  ) {
    return false;
  }
  return true;
}

async function loadCandidatePages(
  database: D1DatabaseLike,
  statement: ReturnType<D1DatabaseLike["prepare"]>,
  bindings: readonly (null | number | string)[],
  eventId: string | null,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const maximum = eventId === null ? CALENDAR_CANDIDATE_SCAN_LIMIT + 1 : 1;
  while (rows.length < maximum) {
    const pageSize = Math.min(
      CALENDAR_QUERY_PAGE_SIZE,
      maximum - rows.length,
    );
    const page = await statement
      .bind(...bindings, pageSize, rows.length)
      .all<Record<string, unknown>>();
    const next = [...(page.results ?? [])];
    rows.push(...next);
    if (next.length < pageSize) break;
  }
  return rows;
}

function readSchedule(row: Record<string, unknown>): CanonicalEventSchedule {
  const shape = requiredString(row.schedule_shape);
  let timeZone: string;
  try {
    timeZone = parseIanaTimeZone(row.timezone);
  } catch {
    throw dataUnavailable();
  }
  if (shape === "unscheduled") {
    if (
      row.starts_at_utc !== null ||
      row.ends_at_utc !== null ||
      row.all_day_start_date !== null ||
      row.all_day_end_date_exclusive !== null
    ) {
      throw dataUnavailable();
    }
    return Object.freeze({
      shape,
      timeZone,
      startsAtUtc: null,
      endsAtUtc: null,
      allDayStartDate: null,
      allDayEndDateExclusive: null,
    });
  }
  if (shape === "timed") {
    const startsAtUtc = requiredInteger(row.starts_at_utc);
    const endsAtUtc = requiredInteger(row.ends_at_utc);
    if (endsAtUtc <= startsAtUtc) throw dataUnavailable();
    return Object.freeze({
      shape,
      timeZone,
      startsAtUtc,
      endsAtUtc,
      allDayStartDate: null,
      allDayEndDateExclusive: null,
    });
  }
  if (shape === "all_day") {
    let allDayStartDate: `${number}-${number}-${number}`;
    let allDayEndDateExclusive: `${number}-${number}-${number}`;
    try {
      allDayStartDate = parseCalendarDate(row.all_day_start_date);
      allDayEndDateExclusive = parseCalendarDate(
        row.all_day_end_date_exclusive,
      );
    } catch {
      throw dataUnavailable();
    }
    if (allDayEndDateExclusive <= allDayStartDate) {
      throw dataUnavailable();
    }
    return Object.freeze({
      shape,
      timeZone,
      startsAtUtc: null,
      endsAtUtc: null,
      allDayStartDate,
      allDayEndDateExclusive,
    });
  }
  throw dataUnavailable();
}

function readManualPlanningStatus(value: unknown): EventPlanningStatus {
  if (EVENT_PLANNING_STATUSES.some((status) => status === value)) {
    return value as EventPlanningStatus;
  }
  throw dataUnavailable();
}

function readConflictState(
  value: unknown,
): OrganizerCalendarEventDto["conflictState"] {
  if (
    value === "approved" ||
    value === "none" ||
    value === "open" ||
    value === "pending" ||
    value === "warning"
  ) {
    return value;
  }
  throw dataUnavailable();
}

function readHoldState(
  value: unknown,
): OrganizerCalendarEventDto["holdState"] {
  if (
    value === null ||
    value === "active" ||
    value === "expired" ||
    value === "nearing_expiry"
  ) {
    return value;
  }
  throw dataUnavailable();
}

function readManualPublicationStatus(
  value: unknown,
): EventPublicationStatus {
  if (value === "private") return value;
  throw dataUnavailable();
}

function mapMeetupPlanningStatus(value: unknown): EventPlanningStatus {
  if (value === "confirmed") return "confirmed";
  if (value === "tentative") return "tentative_hold";
  if (value === "cancelled") return "cancelled";
  throw dataUnavailable();
}

function compareCalendarEvents(
  left: OrganizerCalendarEventDto,
  right: OrganizerCalendarEventDto,
): number {
  const leftKey =
    left.schedule.shape === "timed"
      ? left.schedule.startsAtUtc
      : left.schedule.shape === "all_day"
        ? Date.parse(`${left.schedule.allDayStartDate}T00:00:00Z`)
        : Number.MAX_SAFE_INTEGER;
  const rightKey =
    right.schedule.shape === "timed"
      ? right.schedule.startsAtUtc
      : right.schedule.shape === "all_day"
        ? Date.parse(`${right.schedule.allDayStartDate}T00:00:00Z`)
        : Number.MAX_SAFE_INTEGER;
  return leftKey - rightKey || left.title.localeCompare(right.title);
}

function parseOptionalIdentifier(value: unknown, path: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return parseIdentifier(value, path);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw dataUnavailable();
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

function readStringArray(value: unknown): readonly string[] {
  if (typeof value !== "string") throw dataUnavailable();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw dataUnavailable();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== "string")
  ) {
    throw dataUnavailable();
  }
  return Object.freeze([...new Set(parsed)]);
}

function requiredInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw dataUnavailable();
  }
  return value;
}

function optionalInteger(value: unknown): number | null {
  if (value === null) return null;
  return requiredInteger(value);
}

function dataUnavailable(): SafeApplicationError {
  return new SafeApplicationError(
    "service_unavailable",
    503,
    "The organizer calendar data is unavailable.",
  );
}
