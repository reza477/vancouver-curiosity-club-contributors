export type ReservingEventStatus = "hold" | "tentative" | "confirmed";
export type D1Value = ArrayBuffer | null | number | string;

export interface D1ResultLike<Row = Record<string, unknown>> {
  results?: readonly Row[];
  success?: boolean;
  meta?: {
    changes?: number;
    [key: string]: unknown;
  };
}

export interface D1PreparedStatementLike {
  bind(...values: D1Value[]): D1PreparedStatementLike;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<Row = Record<string, unknown>>(
    statements: D1PreparedStatementLike[],
  ): Promise<D1ResultLike<Row>[]>;
}

export interface TimedReservationInput {
  id: string;
  organizationId: string;
  clubId: string;
  programId?: string | null;
  eventLaneId?: string | null;
  categoryId?: string | null;
  venueId?: string | null;
  primaryOrganizerProfileId: string;
  coOrganizerProfileIds?: readonly string[];
  title: string;
  slug: string;
  summary?: string | null;
  description?: string | null;
  status: ReservingEventStatus;
  visibility?: "public" | "members" | "private";
  startsAtUtc: number;
  endsAtUtc: number;
  timezone: string;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  privateNotes?: string | null;
  privateMeetingDetails?: string | null;
  publishedAt?: number | null;
  holdExpiresAt?: number | null;
  actorProfileId: string;
}

export interface UpdateTimedReservationInput extends TimedReservationInput {
  expectedScheduleVersion: number;
}

export class ReservationWriteRejectedError extends Error {
  readonly code: "conflict_or_stale";

  constructor(message = "The schedule changed or conflicts with a reservation.") {
    super(message);
    this.name = "ReservationWriteRejectedError";
    this.code = "conflict_or_stale";
  }
}

interface CanonicalReservation extends TimedReservationInput {
  visibility: "public" | "members" | "private";
  coOrganizerProfileIds: readonly string[];
  organizerScope: readonly string[];
  organizerScopeJson: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  holdExpiresAt: number | null;
}

const INSERT_EVENT_SQL = `
INSERT INTO events (
  id,
  organization_id,
  club_id,
  program_id,
  event_lane_id,
  category_id,
  venue_id,
  primary_organizer_profile_id,
  title,
  slug,
  summary,
  description,
  status,
  visibility,
  time_kind,
  starts_at_utc,
  ends_at_utc,
  timezone,
  all_day_start_date,
  all_day_end_date_exclusive,
  buffer_before_minutes,
  buffer_after_minutes,
  organizer_scope_json,
  schedule_version,
  schedule_review_state,
  hold_expires_at,
  private_notes,
  private_meeting_details,
  published_at,
  created_by_profile_id,
  updated_by_profile_id
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'timed', ?, ?, ?, NULL, NULL,
  ?, ?, ?, 1, 'unreviewed', ?, ?, ?, ?, ?, ?
)
`;

const UPDATE_EVENT_SQL = `
UPDATE events
SET
  club_id = ?,
  program_id = ?,
  event_lane_id = ?,
  category_id = ?,
  venue_id = ?,
  primary_organizer_profile_id = ?,
  title = ?,
  slug = ?,
  summary = ?,
  description = ?,
  status = ?,
  visibility = ?,
  time_kind = 'timed',
  starts_at_utc = ?,
  ends_at_utc = ?,
  timezone = ?,
  all_day_start_date = NULL,
  all_day_end_date_exclusive = NULL,
  buffer_before_minutes = ?,
  buffer_after_minutes = ?,
  organizer_scope_json = ?,
  schedule_version = schedule_version + 1,
  schedule_review_state = 'unreviewed',
  hold_expires_at = ?,
  private_notes = ?,
  private_meeting_details = ?,
  published_at = ?,
  updated_by_profile_id = ?,
  updated_at = (unixepoch() * 1000)
WHERE id = ?
  AND organization_id = ?
  AND schedule_version = ?
  AND deleted_at IS NULL
`;

const INSERT_REVISION_AFTER_INSERT_SQL = `
INSERT INTO event_revisions (
  id,
  organization_id,
  event_id,
  schedule_version,
  snapshot_json,
  reason,
  actor_profile_id
) VALUES (?, ?, CASE WHEN changes() = 1 THEN ? ELSE NULL END, 1, ?, ?, ?)
`;

const INSERT_REVISION_AFTER_UPDATE_SQL = `
INSERT INTO event_revisions (
  id,
  organization_id,
  event_id,
  schedule_version,
  snapshot_json,
  reason,
  actor_profile_id
) VALUES (
  ?,
  ?,
  CASE WHEN changes() = 1 THEN ? ELSE NULL END,
  ?,
  ?,
  ?,
  ?
)
`;

const DELETE_EVENT_ORGANIZERS_SQL = `
DELETE FROM event_organizers
WHERE organization_id = ? AND event_id = ?
`;

const INSERT_EVENT_ORGANIZER_SQL = `
INSERT INTO event_organizers (
  id,
  organization_id,
  event_id,
  profile_id,
  role,
  is_publicly_listed,
  created_by_profile_id
) VALUES (?, ?, ?, ?, ?, ?, ?)
`;

const INSERT_AUDIT_WITH_ASSOCIATION_ASSERTION_SQL = `
INSERT INTO audit_logs (
  id,
  organization_id,
  actor_profile_id,
  action,
  entity_type,
  entity_id,
  metadata_json
) VALUES (
  ?,
  ?,
  ?,
  ?,
  'event',
  CASE
    WHEN (
      SELECT count(*)
      FROM event_organizers AS association
      WHERE association.organization_id = ?
        AND association.event_id = ?
        AND association.deleted_at IS NULL
    ) = json_array_length(?)
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(?) AS expected
      WHERE NOT EXISTS (
        SELECT 1
        FROM event_organizers AS association
        WHERE association.organization_id = ?
          AND association.event_id = ?
          AND association.profile_id = expected.value
          AND association.deleted_at IS NULL
      )
    )
    THEN ?
    ELSE NULL
  END,
  ?
)
`;

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${field} must not be empty.`);
  }
}

function assertFiniteInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${field} must be a safe integer.`);
  }
}

function canonicalize(input: TimedReservationInput): CanonicalReservation {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.organizationId, "organizationId");
  assertNonEmpty(input.clubId, "clubId");
  assertNonEmpty(input.primaryOrganizerProfileId, "primaryOrganizerProfileId");
  assertNonEmpty(input.title, "title");
  assertNonEmpty(input.slug, "slug");
  assertNonEmpty(input.timezone, "timezone");
  assertNonEmpty(input.actorProfileId, "actorProfileId");
  assertFiniteInteger(input.startsAtUtc, "startsAtUtc");
  assertFiniteInteger(input.endsAtUtc, "endsAtUtc");

  if (input.endsAtUtc <= input.startsAtUtc) {
    throw new RangeError("endsAtUtc must be later than startsAtUtc.");
  }

  const bufferBeforeMinutes = input.bufferBeforeMinutes ?? 0;
  const bufferAfterMinutes = input.bufferAfterMinutes ?? 0;
  assertFiniteInteger(bufferBeforeMinutes, "bufferBeforeMinutes");
  assertFiniteInteger(bufferAfterMinutes, "bufferAfterMinutes");

  if (bufferBeforeMinutes < 0 || bufferAfterMinutes < 0) {
    throw new RangeError("Schedule buffers cannot be negative.");
  }

  let holdExpiresAt: number | null = null;
  if (input.status === "hold") {
    if (input.holdExpiresAt === null || input.holdExpiresAt === undefined) {
      throw new TypeError("holdExpiresAt is required for hold reservations.");
    }
    assertFiniteInteger(input.holdExpiresAt, "holdExpiresAt");
    if (input.holdExpiresAt <= Date.now()) {
      throw new RangeError("holdExpiresAt must be in the future.");
    }
    holdExpiresAt = input.holdExpiresAt;
  } else if (input.holdExpiresAt !== null && input.holdExpiresAt !== undefined) {
    throw new RangeError("holdExpiresAt is only valid for hold reservations.");
  }

  const coOrganizerProfileIds = [
    ...new Set(input.coOrganizerProfileIds ?? []),
  ]
    .map((id) => {
      assertNonEmpty(id, "coOrganizerProfileIds[]");
      return id;
    })
    .filter((id) => id !== input.primaryOrganizerProfileId)
    .sort();
  const organizerScope = [
    input.primaryOrganizerProfileId,
    ...coOrganizerProfileIds,
  ].sort();

  return {
    ...input,
    visibility: input.visibility ?? "private",
    coOrganizerProfileIds,
    organizerScope,
    organizerScopeJson: JSON.stringify(organizerScope),
    bufferBeforeMinutes,
    bufferAfterMinutes,
    holdExpiresAt,
  };
}

function snapshotJson(
  event: CanonicalReservation,
  scheduleVersion: number,
): string {
  return JSON.stringify({
    id: event.id,
    organizationId: event.organizationId,
    clubId: event.clubId,
    programId: event.programId ?? null,
    eventLaneId: event.eventLaneId ?? null,
    categoryId: event.categoryId ?? null,
    venueId: event.venueId ?? null,
    primaryOrganizerProfileId: event.primaryOrganizerProfileId,
    coOrganizerProfileIds: event.coOrganizerProfileIds,
    title: event.title,
    slug: event.slug,
    summary: event.summary ?? null,
    description: event.description ?? null,
    status: event.status,
    visibility: event.visibility,
    timeKind: "timed",
    startsAtUtc: event.startsAtUtc,
    endsAtUtc: event.endsAtUtc,
    timezone: event.timezone,
    bufferBeforeMinutes: event.bufferBeforeMinutes,
    bufferAfterMinutes: event.bufferAfterMinutes,
    privateNotes: event.privateNotes ?? null,
    privateMeetingDetails: event.privateMeetingDetails ?? null,
    publishedAt: event.publishedAt ?? null,
    scheduleVersion,
    scheduleReviewState: "unreviewed",
    holdExpiresAt: event.holdExpiresAt,
  });
}

function organizerStatements(
  database: D1DatabaseLike,
  event: CanonicalReservation,
): D1PreparedStatementLike[] {
  return event.organizerScope.map((profileId) =>
    database.prepare(INSERT_EVENT_ORGANIZER_SQL).bind(
      crypto.randomUUID(),
      event.organizationId,
      event.id,
      profileId,
      profileId === event.primaryOrganizerProfileId
        ? "primary"
        : "co_organizer",
      0,
      event.actorProfileId,
    ),
  );
}

function auditStatement(
  database: D1DatabaseLike,
  event: CanonicalReservation,
  action: "event.schedule_reserved" | "event.schedule_updated",
  scheduleVersion: number,
): D1PreparedStatementLike {
  const metadata = JSON.stringify({
    status: event.status,
    scheduleVersion,
  });

  return database
    .prepare(INSERT_AUDIT_WITH_ASSOCIATION_ASSERTION_SQL)
    .bind(
      crypto.randomUUID(),
      event.organizationId,
      event.actorProfileId,
      action,
      event.organizationId,
      event.id,
      event.organizerScopeJson,
      event.organizerScopeJson,
      event.organizationId,
      event.id,
      event.id,
      metadata,
    );
}

function isRejectedWrite(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /conflict_guard_|event_revisions\.event_id|audit_logs\.entity_id/i.test(
    `${error.message} ${(error as Error & { cause?: unknown }).cause ?? ""}`,
  );
}

function assertOneChanged(
  results: D1ResultLike[],
  operation: "insert" | "update",
): void {
  if (results[0]?.meta?.changes !== 1) {
    throw new ReservationWriteRejectedError(
      `${operation} affected zero rows; the reservation conflicted or was stale.`,
    );
  }
}

/**
 * Reserves a timed event and writes its normalized organizer associations,
 * immutable revision, and content-free audit record in one atomic D1 batch.
 */
export async function createUnreviewedTimedReservation(
  database: D1DatabaseLike,
  input: TimedReservationInput,
): Promise<{ id: string; scheduleVersion: 1 }> {
  const event = canonicalize(input);
  const revisionId = crypto.randomUUID();
  const statements = [
    database.prepare(INSERT_EVENT_SQL).bind(
      event.id,
      event.organizationId,
      event.clubId,
      event.programId ?? null,
      event.eventLaneId ?? null,
      event.categoryId ?? null,
      event.venueId ?? null,
      event.primaryOrganizerProfileId,
      event.title,
      event.slug,
      event.summary ?? null,
      event.description ?? null,
      event.status,
      event.visibility,
      event.startsAtUtc,
      event.endsAtUtc,
      event.timezone,
      event.bufferBeforeMinutes,
      event.bufferAfterMinutes,
      event.organizerScopeJson,
      event.holdExpiresAt,
      event.privateNotes ?? null,
      event.privateMeetingDetails ?? null,
      event.publishedAt ?? null,
      event.actorProfileId,
      event.actorProfileId,
    ),
    database.prepare(INSERT_REVISION_AFTER_INSERT_SQL).bind(
      revisionId,
      event.organizationId,
      event.id,
      snapshotJson(event, 1),
      "initial schedule reservation",
      event.actorProfileId,
    ),
    ...organizerStatements(database, event),
    auditStatement(database, event, "event.schedule_reserved", 1),
  ];

  try {
    const results = await database.batch(statements);
    assertOneChanged(results, "insert");
    return { id: event.id, scheduleVersion: 1 };
  } catch (error) {
    if (
      error instanceof ReservationWriteRejectedError ||
      isRejectedWrite(error)
    ) {
      throw new ReservationWriteRejectedError();
    }
    throw error;
  }
}

/**
 * Uses both a version-qualified UPDATE and the database trigger. The revision
 * statement immediately following the UPDATE turns changes() === 0 into a
 * NOT NULL violation, forcing D1 batch rollback before associations can change.
 */
export async function updateUnreviewedTimedReservation(
  database: D1DatabaseLike,
  input: UpdateTimedReservationInput,
): Promise<{ id: string; scheduleVersion: number }> {
  assertFiniteInteger(input.expectedScheduleVersion, "expectedScheduleVersion");
  if (input.expectedScheduleVersion < 1) {
    throw new RangeError("expectedScheduleVersion must be at least 1.");
  }

  const event = canonicalize(input);
  const nextScheduleVersion = input.expectedScheduleVersion + 1;
  const statements = [
    database.prepare(UPDATE_EVENT_SQL).bind(
      event.clubId,
      event.programId ?? null,
      event.eventLaneId ?? null,
      event.categoryId ?? null,
      event.venueId ?? null,
      event.primaryOrganizerProfileId,
      event.title,
      event.slug,
      event.summary ?? null,
      event.description ?? null,
      event.status,
      event.visibility,
      event.startsAtUtc,
      event.endsAtUtc,
      event.timezone,
      event.bufferBeforeMinutes,
      event.bufferAfterMinutes,
      event.organizerScopeJson,
      event.holdExpiresAt,
      event.privateNotes ?? null,
      event.privateMeetingDetails ?? null,
      event.publishedAt ?? null,
      event.actorProfileId,
      event.id,
      event.organizationId,
      input.expectedScheduleVersion,
    ),
    database.prepare(INSERT_REVISION_AFTER_UPDATE_SQL).bind(
      crypto.randomUUID(),
      event.organizationId,
      event.id,
      nextScheduleVersion,
      snapshotJson(event, nextScheduleVersion),
      "schedule update",
      event.actorProfileId,
    ),
    database
      .prepare(DELETE_EVENT_ORGANIZERS_SQL)
      .bind(event.organizationId, event.id),
    ...organizerStatements(database, event),
    auditStatement(
      database,
      event,
      "event.schedule_updated",
      nextScheduleVersion,
    ),
  ];

  try {
    const results = await database.batch(statements);
    assertOneChanged(results, "update");
    return { id: event.id, scheduleVersion: nextScheduleVersion };
  } catch (error) {
    if (
      error instanceof ReservationWriteRejectedError ||
      isRejectedWrite(error)
    ) {
      throw new ReservationWriteRejectedError();
    }
    throw error;
  }
}
