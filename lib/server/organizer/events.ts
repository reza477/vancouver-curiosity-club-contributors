import {
  authorizeMembership,
  type AuthorizedMembership,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  parseOptionalBoundedString,
  validationIssue,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  parseCalendarDate,
  parseIanaTimeZone,
} from "../../time";
import {
  parsePhase3ManualEventInput,
  type CanonicalEventSchedule,
  type Phase3ManualEventInput,
  type Phase3WritablePlanningStatus,
} from "./lifecycle";
import { prepareNotificationInsert } from "./notifications";
import {
  getOrganizerCalendarEvent,
  type OrganizerCalendarEventDto,
} from "./calendar";

export type OrganizerEventDto = Readonly<{
  id: string;
  source: "manual";
  readOnly: false;
  organizationId: string;
  clubId: string;
  programId: string | null;
  eventLaneId: string | null;
  categoryId: string | null;
  venueId: string | null;
  primaryOrganizerProfileId: string;
  coOrganizerProfileIds: readonly string[];
  title: string;
  slug: string;
  summary: string | null;
  description: string | null;
  privateNotes: string | null;
  privateMeetingDetails: string | null;
  meetupEventUrl: string | null;
  planningStatus: Phase3WritablePlanningStatus;
  publicationStatus: "private";
  schedule: CanonicalEventSchedule;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  contentVersion: number;
  scheduleVersion: number;
  createdByProfileId: string;
  updatedByProfileId: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}>;

export type OrganizerEventRevisionDto = Readonly<{
  id: string;
  eventId: string;
  contentVersion: number;
  scheduleVersion: number;
  action: "created" | "updated" | "duplicated" | "deleted" | "restored";
  snapshot: Readonly<Record<string, unknown>>;
  actorProfileId: string;
  createdAt: number;
}>;

export type OrganizerEventRecordDto =
  | OrganizerEventDto
  | OrganizerCalendarEventDto;

export type OrganizerEventListOptions = Readonly<{
  includeDeleted?: boolean;
  limit?: number;
}>;

export const ORGANIZER_EVENT_INDEX_STATUSES = [
  "active",
  "idea",
  "draft",
  "deleted",
] as const;

export type OrganizerEventIndexStatus =
  (typeof ORGANIZER_EVENT_INDEX_STATUSES)[number];

export type OrganizerEventIndexQuery = Readonly<{
  page?: unknown;
  search?: unknown;
  status?: unknown;
}>;

export type OrganizerEventIndexPageDto = Readonly<{
  events: readonly OrganizerEventDto[];
  firstResult: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  lastResult: number;
  page: number;
  pageSize: number;
  search: string;
  status: OrganizerEventIndexStatus;
  totalCount: number;
}>;

const ORGANIZER_EVENT_INDEX_PAGE_SIZE = 200;
const ORGANIZER_EVENT_INDEX_MAX_PAGE = 10_000;

export class OrganizerEventNotFoundError extends SafeApplicationError {
  constructor() {
    super("not_found", 404, "The event could not be found.");
    this.name = "OrganizerEventNotFoundError";
  }
}

export class StaleOrganizerEventEditError extends SafeApplicationError {
  constructor() {
    super(
      "stale_edit",
      409,
      "This event changed in another session. Your changes were not applied.",
    );
    this.name = "StaleOrganizerEventEditError";
  }
}

const MANUAL_EVENT_SELECT_SQL = `
SELECT event.id,
       event.organization_id,
       event.club_id,
       event.program_id,
       event.event_lane_id,
       event.category_id,
       event.venue_id,
       event.primary_organizer_profile_id,
       event.title,
       event.slug,
       event.summary,
       event.description,
       event.private_notes,
       event.private_meeting_details,
       event.meetup_event_url,
       event.planning_status,
       event.publication_status,
       event.schedule_shape,
       event.starts_at_utc,
       event.ends_at_utc,
       event.timezone,
       event.all_day_start_date,
       event.all_day_end_date_exclusive,
       event.buffer_before_minutes,
       event.buffer_after_minutes,
       event.content_version,
       event.schedule_version,
       event.created_by_profile_id,
       event.updated_by_profile_id,
       event.created_at,
       event.updated_at,
       event.deleted_at,
       COALESCE((
         SELECT json_group_array(ordered.profile_id)
         FROM (
           SELECT association.profile_id
           FROM organizer_event_organizers AS association
           WHERE association.organization_id = event.organization_id
             AND association.organizer_event_id = event.id
             AND association.deleted_at IS NULL
           ORDER BY association.profile_id
         ) AS ordered
       ), '[]') AS co_organizer_profile_ids_json
FROM organizer_events AS event`;

const ORGANIZER_EVENT_INDEX_WHERE_SQL = `
  event.organization_id = ?
  AND (
    (? = 'deleted' AND event.deleted_at IS NOT NULL)
    OR (? = 'active' AND event.deleted_at IS NULL)
    OR (
      ? IN ('idea', 'draft')
      AND event.deleted_at IS NULL
      AND event.planning_status = ?
    )
  )
  AND (
    ? <> 'organizer'
    OR event.primary_organizer_profile_id = ?
    OR EXISTS (
      SELECT 1
      FROM organizer_event_organizers AS permitted_association
      WHERE permitted_association.organization_id = event.organization_id
        AND permitted_association.organizer_event_id = event.id
        AND permitted_association.profile_id = ?
        AND permitted_association.deleted_at IS NULL
    )
  )
  AND (
    ? IS NULL
    OR instr(lower(event.title), ?) > 0
    OR EXISTS (
      SELECT 1
      FROM clubs AS search_club
      WHERE search_club.id = event.club_id
        AND search_club.organization_id = event.organization_id
        AND instr(lower(search_club.name), ?) > 0
    )
  )`;

const INSERT_EVENT_SQL = `
INSERT INTO organizer_events (
  id, organization_id, club_id, program_id, event_lane_id, category_id,
  venue_id, primary_organizer_profile_id, title, slug, summary, description,
  private_notes, private_meeting_details, meetup_event_url, planning_status,
  publication_status, schedule_shape, starts_at_utc, ends_at_utc, timezone,
  all_day_start_date, all_day_end_date_exclusive, buffer_before_minutes,
  buffer_after_minutes, content_version, schedule_version,
  created_by_profile_id, updated_by_profile_id, created_at, updated_at
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private', ?, ?, ?, ?, ?,
  ?, ?, ?, 1, 1, ?, ?, ?, ?
)`;

const INSERT_DUPLICATED_EVENT_SQL = `
INSERT INTO organizer_events (
  id, organization_id, club_id, program_id, event_lane_id, category_id,
  venue_id, primary_organizer_profile_id, title, slug, summary, description,
  private_notes, private_meeting_details, meetup_event_url, planning_status,
  publication_status, schedule_shape, starts_at_utc, ends_at_utc, timezone,
  all_day_start_date, all_day_end_date_exclusive, buffer_before_minutes,
  buffer_after_minutes, content_version, schedule_version,
  created_by_profile_id, updated_by_profile_id, created_at, updated_at
)
SELECT
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private', ?, ?, ?, ?, ?,
  ?, ?, ?, 1, 1, ?, ?, ?, ?
FROM organizer_events AS source
WHERE source.id = ?
  AND source.organization_id = ?
  AND source.content_version = ?
  AND source.planning_status IN ('idea', 'draft')
  AND source.publication_status = 'private'
  AND source.deleted_at IS ?`;

const UPDATE_EVENT_SQL = `
UPDATE organizer_events
SET club_id = ?,
    program_id = ?,
    event_lane_id = ?,
    category_id = ?,
    venue_id = ?,
    primary_organizer_profile_id = ?,
    title = ?,
    summary = ?,
    description = ?,
    private_notes = ?,
    private_meeting_details = ?,
    meetup_event_url = ?,
    planning_status = ?,
    publication_status = 'private',
    schedule_shape = ?,
    starts_at_utc = ?,
    ends_at_utc = ?,
    timezone = ?,
    all_day_start_date = ?,
    all_day_end_date_exclusive = ?,
    buffer_before_minutes = ?,
    buffer_after_minutes = ?,
    content_version = content_version + 1,
    schedule_version = schedule_version + ?,
    updated_by_profile_id = ?,
    updated_at = ?
WHERE id = ?
  AND organization_id = ?
  AND content_version = ?
  AND planning_status IN ('idea', 'draft')
  AND publication_status = 'private'
  AND deleted_at IS NULL`;

const INSERT_REVISION_SQL = `
INSERT INTO organizer_event_revisions (
  id, organization_id, organizer_event_id, content_version, schedule_version,
  action, snapshot_json, actor_profile_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_GUARDED_REVISION_SQL = `
INSERT INTO organizer_event_revisions (
  id, organization_id, organizer_event_id, content_version, schedule_version,
  action, snapshot_json, actor_profile_id
) VALUES (
  ?, ?,
  CASE WHEN changes() = 1 THEN ? ELSE NULL END,
  ?, ?, ?, ?, ?
)`;

const INSERT_AUDIT_SQL = `
INSERT INTO audit_logs (
  id, organization_id, actor_profile_id, action, entity_type, entity_id,
  metadata_json
) VALUES (?, ?, ?, ?, 'organizer_event', ?, ?)`;

export async function createOrganizerEvent(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  rawInput: unknown,
): Promise<OrganizerEventDto> {
  const input = parsePhase3ManualEventInput(rawInput);
  const actor = await authorizeMembership(database, identity, {
    clubId: input.clubId,
  });
  await validateEventReferences(database, actor, input, null);

  const now = Date.now();
  const id = createId("organizer-event");
  const slug = createStableSlug(input.title, id);
  const snapshot = eventSnapshot({
    id,
    organizationId: actor.organizationId,
    slug,
    input,
    contentVersion: 1,
    scheduleVersion: 1,
    createdByProfileId: actor.profileId,
    updatedByProfileId: actor.profileId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  const statements: D1PreparedStatementLike[] = [
    database.prepare(INSERT_EVENT_SQL).bind(
      id,
      actor.organizationId,
      input.clubId,
      input.programId,
      input.eventLaneId,
      input.categoryId,
      input.venueId,
      input.primaryOrganizerProfileId,
      input.title,
      slug,
      input.summary,
      input.description,
      input.privateNotes,
      input.privateMeetingDetails,
      input.meetupEventUrl,
      input.planningStatus,
      input.schedule.shape,
      input.schedule.startsAtUtc,
      input.schedule.endsAtUtc,
      input.schedule.timeZone,
      input.schedule.allDayStartDate,
      input.schedule.allDayEndDateExclusive,
      input.bufferBeforeMinutes,
      input.bufferAfterMinutes,
      actor.profileId,
      actor.profileId,
      now,
      now,
    ),
    ...coOrganizerInsertStatements(database, actor, id, input),
    database.prepare(INSERT_REVISION_SQL).bind(
      createId("organizer-event-revision"),
      actor.organizationId,
      id,
      1,
      1,
      "created",
      JSON.stringify(snapshot),
      actor.profileId,
    ),
    auditStatement(database, actor, id, "organizer_event.created", {
      contentVersion: 1,
      planningStatus: input.planningStatus,
      publicationStatus: "private",
      scheduleVersion: 1,
    }),
    ...assignmentNotificationStatements(
      database,
      actor,
      id,
      input.title,
      [],
      organizerScope(input),
      false,
      now,
    ),
  ];
  const results = await database.batch(statements);
  if (results[0]?.meta?.changes !== 1) throw new StaleOrganizerEventEditError();
  return requireManualEvent(database, actor, id, true);
}

export async function updateOrganizerEvent(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  eventIdValue: unknown,
  expectedContentVersionValue: unknown,
  rawInput: unknown,
): Promise<OrganizerEventDto> {
  const eventId = parseIdentifier(eventIdValue, "eventId");
  const expectedContentVersion = parseExpectedVersion(
    expectedContentVersionValue,
  );
  const requestedInput = parsePhase3ManualEventInput(rawInput);
  const actor = await authorizeMembership(database, identity);
  const existing = await requireManualEvent(database, actor, eventId, true);
  assertEditable(existing);
  await authorizeEventEdit(database, actor, existing);
  const input = Object.freeze({
    ...requestedInput,
    // Phase 3 does not expose venue or private-meeting editing. Keep adopted
    // values server-side even when an older open form submits null.
    privateMeetingDetails: existing.privateMeetingDetails,
    venueId: existing.venueId,
  });
  await authorizeMembership(database, identity, { clubId: input.clubId });
  await validateEventReferences(database, actor, input, existing);

  const scheduleChanged = scheduleAffectingFieldsChanged(existing, input);
  const nextContentVersion = expectedContentVersion + 1;
  const nextScheduleVersion =
    existing.scheduleVersion + (scheduleChanged ? 1 : 0);
  const now = Date.now();
  const snapshot = eventSnapshot({
    id: existing.id,
    organizationId: existing.organizationId,
    slug: existing.slug,
    input,
    contentVersion: nextContentVersion,
    scheduleVersion: nextScheduleVersion,
    createdByProfileId: existing.createdByProfileId,
    updatedByProfileId: actor.profileId,
    createdAt: existing.createdAt,
    updatedAt: now,
    deletedAt: null,
  });
  const statements: D1PreparedStatementLike[] = [
    database
      .prepare(
        `DELETE FROM organizer_event_organizers
         WHERE organization_id = ? AND organizer_event_id = ?`,
      )
      .bind(actor.organizationId, eventId),
    database.prepare(UPDATE_EVENT_SQL).bind(
      input.clubId,
      input.programId,
      input.eventLaneId,
      input.categoryId,
      input.venueId,
      input.primaryOrganizerProfileId,
      input.title,
      input.summary,
      input.description,
      input.privateNotes,
      input.privateMeetingDetails,
      input.meetupEventUrl,
      input.planningStatus,
      input.schedule.shape,
      input.schedule.startsAtUtc,
      input.schedule.endsAtUtc,
      input.schedule.timeZone,
      input.schedule.allDayStartDate,
      input.schedule.allDayEndDateExclusive,
      input.bufferBeforeMinutes,
      input.bufferAfterMinutes,
      scheduleChanged ? 1 : 0,
      actor.profileId,
      now,
      eventId,
      actor.organizationId,
      expectedContentVersion,
    ),
    database.prepare(INSERT_GUARDED_REVISION_SQL).bind(
      createId("organizer-event-revision"),
      actor.organizationId,
      eventId,
      nextContentVersion,
      nextScheduleVersion,
      "updated",
      JSON.stringify(snapshot),
      actor.profileId,
    ),
    ...coOrganizerInsertStatements(database, actor, eventId, input),
    auditStatement(database, actor, eventId, "organizer_event.updated", {
      contentVersion: nextContentVersion,
      planningStatus: input.planningStatus,
      publicationStatus: "private",
      scheduleVersion: nextScheduleVersion,
    }),
    ...assignmentNotificationStatements(
      database,
      actor,
      eventId,
      input.title,
      organizerScopeFromDto(existing),
      organizerScope(input),
      scheduleChanged,
      now,
    ),
  ];

  await runStaleGuardedBatch(database, statements, 1);
  return requireManualEvent(database, actor, eventId, true);
}

export async function duplicateOrganizerEvent(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  sourceEventIdValue: unknown,
  expectedContentVersionValue: unknown,
): Promise<OrganizerEventDto> {
  const sourceEventId = parseIdentifier(sourceEventIdValue, "eventId");
  const expectedVersion = parseExpectedVersion(expectedContentVersionValue);
  const actor = await authorizeMembership(database, identity);
  const source = await requireManualEvent(database, actor, sourceEventId, true);
  assertEditable(source);
  await authorizeEventEdit(database, actor, source);
  if (source.contentVersion !== expectedVersion) {
    throw new StaleOrganizerEventEditError();
  }

  const input = manualDtoToInput(source, actor);
  const id = createId("organizer-event");
  const title = `Copy of ${source.title}`.slice(0, 180);
  const copiedInput = Object.freeze({ ...input, title });
  await validateEventReferences(database, actor, copiedInput, null);
  const slug = createStableSlug(title, id);
  const now = Date.now();
  const snapshot = eventSnapshot({
    id,
    organizationId: actor.organizationId,
    slug,
    input: copiedInput,
    contentVersion: 1,
    scheduleVersion: 1,
    createdByProfileId: actor.profileId,
    updatedByProfileId: actor.profileId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  const statements: D1PreparedStatementLike[] = [
    database.prepare(INSERT_DUPLICATED_EVENT_SQL).bind(
      id,
      actor.organizationId,
      copiedInput.clubId,
      copiedInput.programId,
      copiedInput.eventLaneId,
      copiedInput.categoryId,
      copiedInput.venueId,
      copiedInput.primaryOrganizerProfileId,
      copiedInput.title,
      slug,
      copiedInput.summary,
      copiedInput.description,
      copiedInput.privateNotes,
      copiedInput.privateMeetingDetails,
      // A duplicate never copies an external identity or URL.
      null,
      copiedInput.planningStatus,
      copiedInput.schedule.shape,
      copiedInput.schedule.startsAtUtc,
      copiedInput.schedule.endsAtUtc,
      copiedInput.schedule.timeZone,
      copiedInput.schedule.allDayStartDate,
      copiedInput.schedule.allDayEndDateExclusive,
      copiedInput.bufferBeforeMinutes,
      copiedInput.bufferAfterMinutes,
      actor.profileId,
      actor.profileId,
      now,
      now,
      sourceEventId,
      actor.organizationId,
      expectedVersion,
      source.deletedAt,
    ),
    database.prepare(INSERT_GUARDED_REVISION_SQL).bind(
      createId("organizer-event-revision"),
      actor.organizationId,
      id,
      1,
      1,
      "duplicated",
      JSON.stringify({ ...snapshot, meetupEventUrl: null }),
      actor.profileId,
    ),
    ...coOrganizerInsertStatements(database, actor, id, copiedInput),
    auditStatement(database, actor, id, "organizer_event.duplicated", {
      contentVersion: 1,
      planningStatus: copiedInput.planningStatus,
      publicationStatus: "private",
      scheduleVersion: 1,
      sourceEventId,
    }),
    ...assignmentNotificationStatements(
      database,
      actor,
      id,
      title,
      [],
      organizerScope(copiedInput),
      false,
      now,
    ),
  ];
  await runStaleGuardedBatch(database, statements);
  return requireManualEvent(database, actor, id, true);
}

export async function softDeleteOrganizerEvent(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  eventIdValue: unknown,
  expectedContentVersionValue: unknown,
): Promise<OrganizerEventDto> {
  return setOrganizerEventDeletedState(
    database,
    identity,
    eventIdValue,
    expectedContentVersionValue,
    true,
  );
}

export async function restoreOrganizerEvent(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  eventIdValue: unknown,
  expectedContentVersionValue: unknown,
): Promise<OrganizerEventDto> {
  return setOrganizerEventDeletedState(
    database,
    identity,
    eventIdValue,
    expectedContentVersionValue,
    false,
  );
}

export async function getOrganizerEvent(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  eventIdValue: unknown,
): Promise<OrganizerEventDto> {
  const eventId = parseIdentifier(eventIdValue, "eventId");
  const actor = await authorizeMembership(database, identity);
  const event = await requireManualEvent(database, actor, eventId, true);
  await authorizeEventEdit(database, actor, event);
  return event;
}

/**
 * One organizer-facing event contract: editable manual records return their
 * authorized private DTO, while legacy/Meetup or unrelated schedule entries
 * return the read-only calendar DTO.
 */
export async function getOrganizerEventRecord(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  eventIdValue: unknown,
): Promise<OrganizerEventRecordDto> {
  try {
    return await getOrganizerEvent(database, identity, eventIdValue);
  } catch (error) {
    if (!(error instanceof OrganizerEventNotFoundError)) throw error;
    return getOrganizerCalendarEvent(database, identity, eventIdValue);
  }
}

export async function listOrganizerEvents(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  options: OrganizerEventListOptions = {},
): Promise<readonly OrganizerEventDto[]> {
  const actor = await authorizeMembership(database, identity);
  const limit = parseFiniteInteger(options.limit ?? 100, {
    path: "limit",
    minimum: 1,
    maximum: 200,
  });
  const result = await database
    .prepare(
      `${MANUAL_EVENT_SELECT_SQL}
       WHERE event.organization_id = ?
         AND (? = 1 OR event.deleted_at IS NULL)
         AND (
           ? <> 'organizer'
           OR event.primary_organizer_profile_id = ?
           OR EXISTS (
             SELECT 1
             FROM organizer_event_organizers AS permitted_association
             WHERE permitted_association.organization_id =
                   event.organization_id
               AND permitted_association.organizer_event_id = event.id
               AND permitted_association.profile_id = ?
               AND permitted_association.deleted_at IS NULL
           )
         )
       ORDER BY event.updated_at DESC, event.id
       LIMIT ?`,
    )
    .bind(
      actor.organizationId,
      options.includeDeleted ? 1 : 0,
      actor.role,
      actor.profileId,
      actor.profileId,
      limit,
    )
    .all<Record<string, unknown>>();
  return Object.freeze((result.results ?? []).map(readManualEventRow));
}

/**
 * Bounded, organization-scoped organizer event index query. Search and status
 * are applied before pagination so older and soft-deleted records remain
 * directly reachable instead of being filtered from a truncated client slice.
 */
export async function queryOrganizerEventIndex(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  rawQuery: OrganizerEventIndexQuery = {},
): Promise<OrganizerEventIndexPageDto> {
  const actor = await authorizeMembership(database, identity);
  const query = parseOrganizerEventIndexQuery(rawQuery);
  const search = query.search.length > 0
    ? query.search.toLocaleLowerCase("en-CA")
    : null;
  const commonBindings = organizerEventIndexBindings(actor, query.status, search);
  const countRow = await database
    .prepare(
      `SELECT COUNT(*) AS result_count
       FROM organizer_events AS event
       WHERE ${ORGANIZER_EVENT_INDEX_WHERE_SQL}`,
    )
    .bind(...commonBindings)
    .first<Record<string, unknown>>();
  const totalCount = requiredInteger(countRow?.result_count);
  const offset = (query.page - 1) * ORGANIZER_EVENT_INDEX_PAGE_SIZE;
  const result = await database
    .prepare(
      `${MANUAL_EVENT_SELECT_SQL}
       WHERE ${ORGANIZER_EVENT_INDEX_WHERE_SQL}
       ORDER BY event.updated_at DESC, event.id ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(
      ...commonBindings,
      ORGANIZER_EVENT_INDEX_PAGE_SIZE,
      offset,
    )
    .all<Record<string, unknown>>();
  const events = Object.freeze(
    (result.results ?? []).map(readManualEventRow),
  );
  const firstResult = events.length === 0 ? 0 : offset + 1;
  const lastResult = offset + events.length;
  return Object.freeze({
    events,
    firstResult,
    hasNextPage: lastResult < totalCount,
    hasPreviousPage: query.page > 1,
    lastResult,
    page: query.page,
    pageSize: ORGANIZER_EVENT_INDEX_PAGE_SIZE,
    search: query.search,
    status: query.status,
    totalCount,
  });
}

function parseOrganizerEventIndexQuery(
  rawQuery: OrganizerEventIndexQuery,
): Readonly<{
  page: number;
  search: string;
  status: OrganizerEventIndexStatus;
}> {
  const pageValue =
    rawQuery.page === undefined
      ? 1
      : typeof rawQuery.page === "string" &&
          /^(?:0|[1-9]\d*)$/u.test(rawQuery.page)
        ? Number(rawQuery.page)
        : rawQuery.page;
  return Object.freeze({
    page: parseFiniteInteger(pageValue, {
      path: "page",
      minimum: 1,
      maximum: ORGANIZER_EVENT_INDEX_MAX_PAGE,
    }),
    search:
      parseOptionalBoundedString(rawQuery.search, {
        path: "search",
        maxLength: 120,
      }) ?? "",
    status:
      rawQuery.status === undefined || rawQuery.status === ""
        ? "active"
        : parseEnum(
            rawQuery.status,
            ORGANIZER_EVENT_INDEX_STATUSES,
            "status",
          ),
  });
}

function organizerEventIndexBindings(
  actor: AuthorizedMembership,
  status: OrganizerEventIndexStatus,
  search: string | null,
): readonly (null | number | string)[] {
  return [
    actor.organizationId,
    status,
    status,
    status,
    status,
    actor.role,
    actor.profileId,
    actor.profileId,
    search,
    search,
    search,
  ];
}

export async function listOrganizerEventRevisions(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  eventIdValue: unknown,
  limitValue: unknown = 50,
): Promise<readonly OrganizerEventRevisionDto[]> {
  const eventId = parseIdentifier(eventIdValue, "eventId");
  const limit = parseFiniteInteger(limitValue, {
    path: "limit",
    minimum: 1,
    maximum: 100,
  });
  const actor = await authorizeMembership(database, identity);
  const event = await requireManualEvent(database, actor, eventId, true);
  await authorizeEventEdit(database, actor, event);
  const result = await database
    .prepare(
      `SELECT id, organizer_event_id, content_version, schedule_version,
              action, snapshot_json, actor_profile_id, created_at
       FROM organizer_event_revisions
       WHERE organization_id = ?
         AND organizer_event_id = ?
       ORDER BY content_version DESC
       LIMIT ?`,
    )
    .bind(actor.organizationId, eventId, limit)
    .all<Record<string, unknown>>();
  return Object.freeze((result.results ?? []).map(readRevisionRow));
}

async function setOrganizerEventDeletedState(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  eventIdValue: unknown,
  expectedContentVersionValue: unknown,
  deleted: boolean,
): Promise<OrganizerEventDto> {
  const eventId = parseIdentifier(eventIdValue, "eventId");
  const expectedVersion = parseExpectedVersion(expectedContentVersionValue);
  const actor = await authorizeMembership(database, identity);
  const existing = await requireManualEvent(database, actor, eventId, true);
  assertEditable(existing);
  await authorizeEventEdit(database, actor, existing);
  if ((existing.deletedAt !== null) === deleted) {
    throw new StaleOrganizerEventEditError();
  }
  if (!deleted) {
    try {
      await validateEventReferences(
        database,
        actor,
        existingEventInput(existing),
        existing,
      );
    } catch (error) {
      if (
        error instanceof SafeApplicationError &&
        (error.status === 404 || error.status === 422)
      ) {
        throw eventRestoreBlocked();
      }
      throw error;
    }
  }
  const now = Date.now();
  const nextContentVersion = expectedVersion + 1;
  const nextScheduleVersion = existing.scheduleVersion;
  const snapshot = {
    ...eventDtoSnapshot(existing),
    contentVersion: nextContentVersion,
    scheduleVersion: nextScheduleVersion,
    updatedByProfileId: actor.profileId,
    updatedAt: now,
    deletedAt: deleted ? now : null,
  };
  const statements = [
    database
      .prepare(
        `UPDATE organizer_events
         SET content_version = content_version + 1,
             updated_by_profile_id = ?,
             updated_at = ?,
             deleted_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND content_version = ?
           AND planning_status IN ('idea', 'draft')
           AND publication_status = 'private'
           AND ${deleted ? "deleted_at IS NULL" : "deleted_at IS NOT NULL"}`,
      )
      .bind(
        actor.profileId,
        now,
        deleted ? now : null,
        eventId,
        actor.organizationId,
        expectedVersion,
      ),
    database.prepare(INSERT_GUARDED_REVISION_SQL).bind(
      createId("organizer-event-revision"),
      actor.organizationId,
      eventId,
      nextContentVersion,
      nextScheduleVersion,
      deleted ? "deleted" : "restored",
      JSON.stringify(snapshot),
      actor.profileId,
    ),
    auditStatement(
      database,
      actor,
      eventId,
      deleted ? "organizer_event.deleted" : "organizer_event.restored",
      {
        contentVersion: nextContentVersion,
        planningStatus: existing.planningStatus,
        publicationStatus: "private",
        scheduleVersion: nextScheduleVersion,
      },
    ),
  ];
  try {
    await runStaleGuardedBatch(database, statements);
  } catch (error) {
    if (
      !deleted &&
      error instanceof Error &&
      /organizer_event_organization_mismatch/iu.test(
        `${error.message} ${(error as Error & { cause?: unknown }).cause ?? ""}`,
      )
    ) {
      throw eventRestoreBlocked();
    }
    throw error;
  }
  return requireManualEvent(database, actor, eventId, true);
}

async function requireManualEvent(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
  includeDeleted: boolean,
): Promise<OrganizerEventDto> {
  const row = await database
    .prepare(
      `${MANUAL_EVENT_SELECT_SQL}
       WHERE event.id = ?
         AND event.organization_id = ?
         AND (? = 1 OR event.deleted_at IS NULL)
       LIMIT 1`,
    )
    .bind(eventId, actor.organizationId, includeDeleted ? 1 : 0)
    .first<Record<string, unknown>>();
  if (!row) throw new OrganizerEventNotFoundError();
  return readManualEventRow(row);
}

async function authorizeEventEdit(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  event: OrganizerEventDto,
): Promise<void> {
  if (actor.role !== "organizer") return;
  const assignment = await database
    .prepare(
      `SELECT 1 AS allowed
       FROM club_memberships AS club_membership
       WHERE club_membership.organization_id = ?
         AND club_membership.club_id = ?
         AND club_membership.organization_membership_id = ?
         AND club_membership.profile_id = ?
         AND club_membership.status = 'active'
         AND club_membership.deleted_at IS NULL
         AND (
           ? = ?
           OR EXISTS (
             SELECT 1
             FROM organizer_event_organizers AS association
             WHERE association.organization_id = ?
               AND association.organizer_event_id = ?
               AND association.profile_id = ?
               AND association.deleted_at IS NULL
           )
         )
       LIMIT 1`,
    )
    .bind(
      actor.organizationId,
      event.clubId,
      actor.membershipId,
      actor.profileId,
      event.primaryOrganizerProfileId,
      actor.profileId,
      actor.organizationId,
      event.id,
      actor.profileId,
    )
    .first<Record<string, unknown>>();
  if (!assignment) throw new OrganizerEventNotFoundError();
}

async function validateEventReferences(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  input: Phase3ManualEventInput,
  existing: OrganizerEventDto | null,
): Promise<void> {
  if (
    input.coOrganizerProfileIds.includes(input.primaryOrganizerProfileId)
  ) {
    throw validationIssue(
      "coOrganizerProfileIds",
      "duplicate_primary_organizer",
      "The primary organizer cannot also be a co-organizer.",
    );
  }
  if (actor.role === "organizer") {
    if (existing === null && input.primaryOrganizerProfileId !== actor.profileId) {
      throw new OrganizerEventNotFoundError();
    }
    if (existing !== null) {
      if (
        existing.primaryOrganizerProfileId === actor.profileId &&
        input.primaryOrganizerProfileId !== actor.profileId
      ) {
        throw new OrganizerEventNotFoundError();
      }
      if (
        existing.primaryOrganizerProfileId !== actor.profileId &&
        (input.primaryOrganizerProfileId !==
          existing.primaryOrganizerProfileId ||
          !sameStringSet(
            input.coOrganizerProfileIds,
            existing.coOrganizerProfileIds,
          ))
      ) {
        throw new OrganizerEventNotFoundError();
      }
    }
  }

  const coIds = [...input.coOrganizerProfileIds];
  const coPlaceholders = coIds.map(() => "?").join(", ");
  const row = await database
    .prepare(
      `SELECT
         EXISTS (
           SELECT 1 FROM clubs AS club
           WHERE club.id = ?
             AND club.organization_id = ?
             AND club.deleted_at IS NULL
         ) AS club_ok,
         (? IS NULL OR EXISTS (
           SELECT 1 FROM programs AS program
           WHERE program.id = ?
             AND program.organization_id = ?
             AND (program.club_id IS NULL OR program.club_id = ?)
             AND program.deleted_at IS NULL
         )) AS program_ok,
         (? IS NULL OR EXISTS (
           SELECT 1 FROM event_lanes AS lane
           WHERE lane.id = ?
             AND lane.organization_id = ?
             AND lane.deleted_at IS NULL
         )) AS lane_ok,
         (? IS NULL OR EXISTS (
           SELECT 1 FROM categories AS category
           WHERE category.id = ?
             AND category.organization_id = ?
             AND category.deleted_at IS NULL
         )) AS category_ok,
         (? IS NULL OR EXISTS (
           SELECT 1 FROM venues AS venue
           WHERE venue.id = ?
             AND venue.organization_id = ?
             AND venue.deleted_at IS NULL
         )) AS venue_ok,
         EXISTS (
           SELECT 1
           FROM profiles AS profile
           JOIN organization_memberships AS membership
             ON membership.profile_id = profile.id
            AND membership.organization_id = ?
            AND membership.status = 'active'
            AND membership.deleted_at IS NULL
           WHERE profile.id = ?
             AND profile.status = 'active'
             AND profile.deleted_at IS NULL
             AND (
               membership.role <> 'organizer'
               OR EXISTS (
                 SELECT 1
                 FROM club_memberships AS club_membership
                 WHERE club_membership.organization_id =
                       membership.organization_id
                   AND club_membership.club_id = ?
                   AND club_membership.organization_membership_id =
                       membership.id
                   AND club_membership.profile_id = membership.profile_id
                   AND club_membership.status = 'active'
                   AND club_membership.deleted_at IS NULL
               )
             )
         ) AS primary_ok,
         ${
           coIds.length === 0
             ? "1"
             : `(SELECT count(*)
                 FROM organization_memberships AS membership
                 JOIN profiles AS profile
                   ON profile.id = membership.profile_id
                  AND profile.status = 'active'
                  AND profile.deleted_at IS NULL
                 WHERE membership.organization_id = ?
                   AND membership.profile_id IN (${coPlaceholders})
                   AND membership.status = 'active'
                   AND membership.deleted_at IS NULL
                   AND (
                     membership.role <> 'organizer'
                     OR EXISTS (
                       SELECT 1
                       FROM club_memberships AS club_membership
                       WHERE club_membership.organization_id = membership.organization_id
                         AND club_membership.club_id = ?
                         AND club_membership.organization_membership_id = membership.id
                         AND club_membership.profile_id = membership.profile_id
                         AND club_membership.status = 'active'
                         AND club_membership.deleted_at IS NULL
                     )
                   )) = ?`
         } AS co_organizers_ok`,
    )
    .bind(
      input.clubId,
      actor.organizationId,
      input.programId,
      input.programId,
      actor.organizationId,
      input.clubId,
      input.eventLaneId,
      input.eventLaneId,
      actor.organizationId,
      input.categoryId,
      input.categoryId,
      actor.organizationId,
      input.venueId,
      input.venueId,
      actor.organizationId,
      actor.organizationId,
      input.primaryOrganizerProfileId,
      input.clubId,
      ...(coIds.length === 0
        ? []
        : [actor.organizationId, ...coIds, input.clubId, coIds.length]),
    )
    .first<Record<string, unknown>>();

  if (
    row?.club_ok !== 1 ||
    row.program_ok !== 1 ||
    row.lane_ok !== 1 ||
    row.category_ok !== 1 ||
    row.venue_ok !== 1 ||
    row.primary_ok !== 1 ||
    row.co_organizers_ok !== 1
  ) {
    throw new OrganizerEventNotFoundError();
  }
}

function coOrganizerInsertStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
  input: Phase3ManualEventInput,
): D1PreparedStatementLike[] {
  return input.coOrganizerProfileIds.map((profileId) =>
    database
      .prepare(
        `INSERT INTO organizer_event_organizers (
           id, organization_id, organizer_event_id, profile_id,
           created_by_profile_id
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        createId("organizer-event-organizer"),
        actor.organizationId,
        eventId,
        profileId,
        actor.profileId,
      ),
  );
}

function auditStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
  action: string,
  metadata: Readonly<Record<string, number | string>>,
): D1PreparedStatementLike {
  return database.prepare(INSERT_AUDIT_SQL).bind(
    createId("audit"),
    actor.organizationId,
    actor.profileId,
    action,
    eventId,
    JSON.stringify(metadata),
  );
}

function assignmentNotificationStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
  title: string,
  previousScope: readonly string[],
  nextScope: readonly string[],
  scheduleChanged: boolean,
  createdAt: number,
): D1PreparedStatementLike[] {
  const previous = new Set(previousScope);
  return [...new Set(nextScope)]
    .filter((profileId) => profileId !== actor.profileId)
    .filter((profileId) => !previous.has(profileId) || scheduleChanged)
    .map((profileId) => {
      const newlyAssigned = !previous.has(profileId);
      return prepareNotificationInsert(database, {
        organizationId: actor.organizationId,
        recipientProfileId: profileId,
        createdAt,
        payload: {
          type:
            newlyAssigned ? "event_assignment" : "event_schedule_changed",
          eventId,
          title,
        },
      });
    });
}

function organizerScope(
  input: Phase3ManualEventInput,
): readonly string[] {
  return Object.freeze([
    input.primaryOrganizerProfileId,
    ...input.coOrganizerProfileIds,
  ]);
}

function organizerScopeFromDto(
  event: OrganizerEventDto,
): readonly string[] {
  return Object.freeze([
    event.primaryOrganizerProfileId,
    ...event.coOrganizerProfileIds,
  ]);
}

async function runStaleGuardedBatch(
  database: D1DatabaseLike,
  statements: D1PreparedStatementLike[],
  guardedMutationIndex = 0,
): Promise<void> {
  try {
    const results = await database.batch(statements);
    if (results[guardedMutationIndex]?.meta?.changes !== 1) {
      throw new StaleOrganizerEventEditError();
    }
  } catch (error) {
    if (
      error instanceof StaleOrganizerEventEditError ||
      (error instanceof Error &&
        /organizer_event_revision_mismatch|NOT NULL constraint failed: organizer_event_revisions\.organizer_event_id/iu.test(
          `${error.message} ${(error as Error & { cause?: unknown }).cause ?? ""}`,
        ))
    ) {
      throw new StaleOrganizerEventEditError();
    }
    throw error;
  }
}

function readManualEventRow(row: Record<string, unknown>): OrganizerEventDto {
  const planningStatus = requiredString(row.planning_status);
  if (planningStatus !== "idea" && planningStatus !== "draft") {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The organizer event data is unavailable.",
    );
  }
  if (row.publication_status !== "private") {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The organizer event data is unavailable.",
    );
  }
  const schedule = readSchedule(row);
  const parsedCoOrganizers = JSON.parse(
    requiredString(row.co_organizer_profile_ids_json),
  ) as unknown;
  if (
    !Array.isArray(parsedCoOrganizers) ||
    !parsedCoOrganizers.every((value) => typeof value === "string")
  ) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The organizer event data is unavailable.",
    );
  }
  return Object.freeze({
    id: requiredString(row.id),
    source: "manual" as const,
    readOnly: false as const,
    organizationId: requiredString(row.organization_id),
    clubId: requiredString(row.club_id),
    programId: optionalString(row.program_id),
    eventLaneId: optionalString(row.event_lane_id),
    categoryId: optionalString(row.category_id),
    venueId: optionalString(row.venue_id),
    primaryOrganizerProfileId: requiredString(
      row.primary_organizer_profile_id,
    ),
    coOrganizerProfileIds: Object.freeze([...parsedCoOrganizers].sort()),
    title: requiredString(row.title),
    slug: requiredString(row.slug),
    summary: optionalString(row.summary),
    description: optionalString(row.description),
    privateNotes: optionalString(row.private_notes),
    privateMeetingDetails: optionalString(row.private_meeting_details),
    meetupEventUrl: optionalString(row.meetup_event_url),
    planningStatus,
    publicationStatus: "private" as const,
    schedule,
    bufferBeforeMinutes: requiredInteger(row.buffer_before_minutes),
    bufferAfterMinutes: requiredInteger(row.buffer_after_minutes),
    contentVersion: requiredInteger(row.content_version),
    scheduleVersion: requiredInteger(row.schedule_version),
    createdByProfileId: requiredString(row.created_by_profile_id),
    updatedByProfileId: requiredString(row.updated_by_profile_id),
    createdAt: requiredInteger(row.created_at),
    updatedAt: requiredInteger(row.updated_at),
    deletedAt: optionalInteger(row.deleted_at),
  });
}

function readRevisionRow(
  row: Record<string, unknown>,
): OrganizerEventRevisionDto {
  const action = requiredString(row.action);
  if (
    !["created", "updated", "duplicated", "deleted", "restored"].includes(
      action,
    )
  ) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The organizer event history is unavailable.",
    );
  }
  const snapshot = JSON.parse(requiredString(row.snapshot_json)) as unknown;
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    Array.isArray(snapshot)
  ) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The organizer event history is unavailable.",
    );
  }
  return Object.freeze({
    id: requiredString(row.id),
    eventId: requiredString(row.organizer_event_id),
    contentVersion: requiredInteger(row.content_version),
    scheduleVersion: requiredInteger(row.schedule_version),
    action: action as OrganizerEventRevisionDto["action"],
    snapshot: Object.freeze(snapshot as Record<string, unknown>),
    actorProfileId: requiredString(row.actor_profile_id),
    createdAt: requiredInteger(row.created_at),
  });
}

function readSchedule(row: Record<string, unknown>): CanonicalEventSchedule {
  const shape = requiredString(row.schedule_shape);
  let timeZone: string;
  try {
    timeZone = parseIanaTimeZone(row.timezone);
  } catch {
    throw organizerDataUnavailable();
  }
  if (shape === "unscheduled") {
    if (
      row.starts_at_utc !== null ||
      row.ends_at_utc !== null ||
      row.all_day_start_date !== null ||
      row.all_day_end_date_exclusive !== null
    ) {
      throw organizerDataUnavailable();
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
    if (endsAtUtc <= startsAtUtc) throw organizerDataUnavailable();
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
      throw organizerDataUnavailable();
    }
    if (allDayEndDateExclusive <= allDayStartDate) {
      throw organizerDataUnavailable();
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
  throw organizerDataUnavailable();
}

function manualDtoToInput(
  source: OrganizerEventDto,
  actor: AuthorizedMembership,
): Phase3ManualEventInput {
  const primaryOrganizerProfileId =
    actor.role === "organizer" ? actor.profileId : source.primaryOrganizerProfileId;
  const coOrganizerProfileIds =
    actor.role === "organizer"
      ? source.coOrganizerProfileIds.filter((id) => id !== actor.profileId)
      : source.coOrganizerProfileIds;
  return Object.freeze({
    title: source.title,
    clubId: source.clubId,
    programId: source.programId,
    eventLaneId: source.eventLaneId,
    categoryId: source.categoryId,
    venueId: source.venueId,
    primaryOrganizerProfileId,
    coOrganizerProfileIds,
    planningStatus: source.planningStatus,
    publicationStatus: "private" as const,
    schedule: source.schedule,
    summary: source.summary,
    description: source.description,
    privateNotes: source.privateNotes,
    privateMeetingDetails: source.privateMeetingDetails,
    meetupEventUrl: null,
    bufferBeforeMinutes: source.bufferBeforeMinutes,
    bufferAfterMinutes: source.bufferAfterMinutes,
  });
}

function existingEventInput(
  source: OrganizerEventDto,
): Phase3ManualEventInput {
  return Object.freeze({
    title: source.title,
    clubId: source.clubId,
    programId: source.programId,
    eventLaneId: source.eventLaneId,
    categoryId: source.categoryId,
    venueId: source.venueId,
    primaryOrganizerProfileId: source.primaryOrganizerProfileId,
    coOrganizerProfileIds: source.coOrganizerProfileIds,
    planningStatus: source.planningStatus,
    publicationStatus: "private" as const,
    schedule: source.schedule,
    summary: source.summary,
    description: source.description,
    privateNotes: source.privateNotes,
    privateMeetingDetails: source.privateMeetingDetails,
    meetupEventUrl: source.meetupEventUrl,
    bufferBeforeMinutes: source.bufferBeforeMinutes,
    bufferAfterMinutes: source.bufferAfterMinutes,
  });
}

function eventRestoreBlocked(): SafeApplicationError {
  return new SafeApplicationError(
    "conflict",
    409,
    "Restore is blocked until its club, organizers, and assigned planning references are active.",
  );
}

function scheduleAffectingFieldsChanged(
  existing: OrganizerEventDto,
  input: Phase3ManualEventInput,
): boolean {
  return (
    existing.clubId !== input.clubId ||
    existing.venueId !== input.venueId ||
    existing.primaryOrganizerProfileId !==
      input.primaryOrganizerProfileId ||
    !sameStringSet(
      existing.coOrganizerProfileIds,
      input.coOrganizerProfileIds,
    ) ||
    existing.bufferBeforeMinutes !== input.bufferBeforeMinutes ||
    existing.bufferAfterMinutes !== input.bufferAfterMinutes ||
    JSON.stringify(existing.schedule) !== JSON.stringify(input.schedule)
  );
}

function eventSnapshot(input: Readonly<{
  id: string;
  organizationId: string;
  slug: string;
  input: Phase3ManualEventInput;
  contentVersion: number;
  scheduleVersion: number;
  createdByProfileId: string;
  updatedByProfileId: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}>): Record<string, unknown> {
  return {
    id: input.id,
    organizationId: input.organizationId,
    clubId: input.input.clubId,
    programId: input.input.programId,
    eventLaneId: input.input.eventLaneId,
    categoryId: input.input.categoryId,
    venueId: input.input.venueId,
    primaryOrganizerProfileId: input.input.primaryOrganizerProfileId,
    coOrganizerProfileIds: input.input.coOrganizerProfileIds,
    title: input.input.title,
    slug: input.slug,
    summary: input.input.summary,
    description: input.input.description,
    privateNotes: input.input.privateNotes,
    privateMeetingDetails: input.input.privateMeetingDetails,
    meetupEventUrl: input.input.meetupEventUrl,
    planningStatus: input.input.planningStatus,
    publicationStatus: "private",
    schedule: input.input.schedule,
    bufferBeforeMinutes: input.input.bufferBeforeMinutes,
    bufferAfterMinutes: input.input.bufferAfterMinutes,
    contentVersion: input.contentVersion,
    scheduleVersion: input.scheduleVersion,
    createdByProfileId: input.createdByProfileId,
    updatedByProfileId: input.updatedByProfileId,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    deletedAt: input.deletedAt,
  };
}

function eventDtoSnapshot(event: OrganizerEventDto): Record<string, unknown> {
  return {
    id: event.id,
    organizationId: event.organizationId,
    clubId: event.clubId,
    programId: event.programId,
    eventLaneId: event.eventLaneId,
    categoryId: event.categoryId,
    venueId: event.venueId,
    primaryOrganizerProfileId: event.primaryOrganizerProfileId,
    coOrganizerProfileIds: event.coOrganizerProfileIds,
    title: event.title,
    slug: event.slug,
    summary: event.summary,
    description: event.description,
    privateNotes: event.privateNotes,
    privateMeetingDetails: event.privateMeetingDetails,
    meetupEventUrl: event.meetupEventUrl,
    planningStatus: event.planningStatus,
    publicationStatus: event.publicationStatus,
    schedule: event.schedule,
    bufferBeforeMinutes: event.bufferBeforeMinutes,
    bufferAfterMinutes: event.bufferAfterMinutes,
    contentVersion: event.contentVersion,
    scheduleVersion: event.scheduleVersion,
    createdByProfileId: event.createdByProfileId,
    updatedByProfileId: event.updatedByProfileId,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    deletedAt: event.deletedAt,
  };
}

function createId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function createStableSlug(title: string, id: string): string {
  const titlePart = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 72);
  const suffix = id.slice(-12).toLowerCase();
  return `${titlePart || "event"}-${suffix}`;
}

function parseExpectedVersion(value: unknown): number {
  return parseFiniteInteger(value, {
    path: "expectedContentVersion",
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  });
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The organizer event data is unavailable.",
    );
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

function requiredInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The organizer event data is unavailable.",
    );
  }
  return value;
}

function organizerDataUnavailable(): SafeApplicationError {
  return new SafeApplicationError(
    "service_unavailable",
    503,
    "The organizer event data is unavailable.",
  );
}

function optionalInteger(value: unknown): number | null {
  if (value === null) return null;
  return requiredInteger(value);
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return (
    leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index])
  );
}

function assertEditable(event: OrganizerEventDto): void {
  if (
    event.source !== "manual" ||
    event.readOnly ||
    !["idea", "draft"].includes(event.planningStatus) ||
    event.publicationStatus !== "private"
  ) {
    throw new OrganizerEventNotFoundError();
  }
}
