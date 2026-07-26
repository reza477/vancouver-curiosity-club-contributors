import {
  assertOnlyKeys,
  parseBoundedString,
  parseEnum,
  parseFiniteInteger,
  parseHttpsUrl,
  parseIdentifier,
  parseObject,
  parseOptionalBoundedString,
  validationIssue,
} from "../../validation";
import {
  DEFAULT_TIME_ZONE,
  normalizeAllDayEventRange,
  normalizeTimedEventRange,
  parseIanaTimeZone,
  type CalendarDate,
} from "../../time";

export const EVENT_PLANNING_STATUSES = [
  "idea",
  "draft",
  "tentative_hold",
  "confirmed",
  "cancelled",
  "completed",
  "archived",
] as const;

export const EVENT_PUBLICATION_STATUSES = [
  "private",
  "scheduled",
  "published",
  "unpublished",
] as const;

export const EVENT_SCHEDULE_SHAPES = [
  "unscheduled",
  "timed",
  "all_day",
] as const;

export const PHASE3_WRITABLE_PLANNING_STATUSES = ["idea", "draft"] as const;

export type EventPlanningStatus = (typeof EVENT_PLANNING_STATUSES)[number];
export type EventPublicationStatus =
  (typeof EVENT_PUBLICATION_STATUSES)[number];
export type EventScheduleShape = (typeof EVENT_SCHEDULE_SHAPES)[number];
export type Phase3WritablePlanningStatus =
  (typeof PHASE3_WRITABLE_PLANNING_STATUSES)[number];

export type CanonicalEventSchedule =
  | Readonly<{
      shape: "unscheduled";
      timeZone: string;
      startsAtUtc: null;
      endsAtUtc: null;
      allDayStartDate: null;
      allDayEndDateExclusive: null;
    }>
  | Readonly<{
      shape: "timed";
      timeZone: string;
      startsAtUtc: number;
      endsAtUtc: number;
      allDayStartDate: null;
      allDayEndDateExclusive: null;
    }>
  | Readonly<{
      shape: "all_day";
      timeZone: string;
      startsAtUtc: null;
      endsAtUtc: null;
      allDayStartDate: CalendarDate;
      allDayEndDateExclusive: CalendarDate;
    }>;

export type Phase3ManualEventInput = Readonly<{
  title: string;
  clubId: string;
  programId: string | null;
  eventLaneId: string | null;
  categoryId: string | null;
  venueId: string | null;
  primaryOrganizerProfileId: string;
  coOrganizerProfileIds: readonly string[];
  planningStatus: Phase3WritablePlanningStatus;
  publicationStatus: "private";
  schedule: CanonicalEventSchedule;
  summary: string | null;
  description: string | null;
  privateNotes: string | null;
  privateMeetingDetails: string | null;
  meetupEventUrl: string | null;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}>;

const INPUT_KEYS = [
  "title",
  "clubId",
  "programId",
  "eventLaneId",
  "categoryId",
  "venueId",
  "primaryOrganizerProfileId",
  "coOrganizerProfileIds",
  "planningStatus",
  "publicationStatus",
  "scheduleShape",
  "timeZone",
  "startLocal",
  "endLocal",
  "allDayStartDate",
  "allDayEndDateExclusive",
  "summary",
  "description",
  "privateNotes",
  "privateMeetingDetails",
  "meetupEventUrl",
  "bufferBeforeMinutes",
  "bufferAfterMinutes",
] as const;

/**
 * Canonical Phase 3 write-boundary parser. It intentionally does not accept
 * lifecycle values that later phases own, even though the persistent enum is
 * future-ready.
 */
export function parsePhase3ManualEventInput(
  value: unknown,
): Phase3ManualEventInput {
  const input = parseObject(value);
  assertOnlyKeys(input, INPUT_KEYS);

  const planningStatus = parseEnum(
    input.planningStatus,
    PHASE3_WRITABLE_PLANNING_STATUSES,
    "planningStatus",
  );
  const publicationStatus = parseEnum(
    input.publicationStatus ?? "private",
    ["private"] as const,
    "publicationStatus",
  );
  const scheduleShape = parseEnum(
    input.scheduleShape,
    EVENT_SCHEDULE_SHAPES,
    "scheduleShape",
  );
  if (planningStatus === "draft" && scheduleShape === "unscheduled") {
    throw validationIssue(
      "scheduleShape",
      "draft_requires_schedule",
      "A Draft must have a timed or all-day schedule.",
    );
  }

  const timeZone = parseIanaTimeZone(
    input.timeZone ?? DEFAULT_TIME_ZONE,
    "timeZone",
  );
  const schedule = parseSchedule(input, scheduleShape, timeZone);
  const coOrganizerProfileIds = parseIdentifierList(
    input.coOrganizerProfileIds ?? [],
    "coOrganizerProfileIds",
  );

  return Object.freeze({
    title: parseBoundedString(input.title, {
      path: "title",
      maxLength: 180,
    }),
    clubId: parseIdentifier(input.clubId, "clubId"),
    programId: parseOptionalIdentifier(input.programId, "programId"),
    eventLaneId: parseOptionalIdentifier(input.eventLaneId, "eventLaneId"),
    categoryId: parseOptionalIdentifier(input.categoryId, "categoryId"),
    venueId: parseOptionalIdentifier(input.venueId, "venueId"),
    primaryOrganizerProfileId: parseIdentifier(
      input.primaryOrganizerProfileId,
      "primaryOrganizerProfileId",
    ),
    coOrganizerProfileIds: Object.freeze(coOrganizerProfileIds),
    planningStatus,
    publicationStatus,
    schedule,
    summary: parseOptionalBoundedString(input.summary, {
      path: "summary",
      maxLength: 500,
    }),
    description: parseOptionalBoundedString(input.description, {
      path: "description",
      maxLength: 20_000,
    }),
    privateNotes: parseOptionalBoundedString(input.privateNotes, {
      path: "privateNotes",
      maxLength: 20_000,
    }),
    privateMeetingDetails: parseOptionalBoundedString(
      input.privateMeetingDetails,
      {
        path: "privateMeetingDetails",
        maxLength: 4_000,
      },
    ),
    meetupEventUrl: parseOptionalMeetupEventUrl(input.meetupEventUrl),
    bufferBeforeMinutes: parseFiniteInteger(
      input.bufferBeforeMinutes ?? 0,
      {
        path: "bufferBeforeMinutes",
        minimum: 0,
        maximum: 24 * 60,
      },
    ),
    bufferAfterMinutes: parseFiniteInteger(input.bufferAfterMinutes ?? 0, {
      path: "bufferAfterMinutes",
      minimum: 0,
      maximum: 24 * 60,
    }),
  });
}

export function mapLegacyPlanningStatus(value: unknown): EventPlanningStatus {
  switch (value) {
    case "idea":
      return "idea";
    case "draft":
      return "draft";
    case "hold":
    case "tentative":
      return "tentative_hold";
    case "confirmed":
      return "confirmed";
    case "cancelled":
      return "cancelled";
    case "archived":
      return "archived";
    default:
      throw validationIssue(
        "legacyEvent.status",
        "invalid_choice",
        "The legacy event has an unsupported planning status.",
      );
  }
}

export function mapLegacyPublicationStatus(
  visibility: unknown,
  publishedAt: unknown,
): EventPublicationStatus {
  return visibility === "public" &&
    typeof publishedAt === "number" &&
    Number.isSafeInteger(publishedAt)
    ? "published"
    : "private";
}

function parseSchedule(
  input: Record<string, unknown>,
  scheduleShape: EventScheduleShape,
  timeZone: string,
): CanonicalEventSchedule {
  if (scheduleShape === "unscheduled") {
    assertAbsentScheduleValues(input);
    return Object.freeze({
      shape: "unscheduled" as const,
      timeZone,
      startsAtUtc: null,
      endsAtUtc: null,
      allDayStartDate: null,
      allDayEndDateExclusive: null,
    });
  }
  if (scheduleShape === "timed") {
    if (
      input.allDayStartDate !== undefined ||
      input.allDayEndDateExclusive !== undefined
    ) {
      throw validationIssue(
        "schedule",
        "invalid_schedule_shape",
        "Timed events cannot include all-day dates.",
      );
    }
    const range = normalizeTimedEventRange({
      startLocal: input.startLocal,
      endLocal: input.endLocal,
      timeZone,
    });
    return Object.freeze({
      shape: "timed" as const,
      timeZone: range.originalTimeZone,
      startsAtUtc: range.startsAtUtcMs,
      endsAtUtc: range.endsAtUtcMs,
      allDayStartDate: null,
      allDayEndDateExclusive: null,
    });
  }
  if (input.startLocal !== undefined || input.endLocal !== undefined) {
    throw validationIssue(
      "schedule",
      "invalid_schedule_shape",
      "All-day events cannot include timed values.",
    );
  }
  const range = normalizeAllDayEventRange({
    startDate: input.allDayStartDate,
    endDateExclusive: input.allDayEndDateExclusive,
  });
  return Object.freeze({
    shape: "all_day" as const,
    timeZone,
    startsAtUtc: null,
    endsAtUtc: null,
    allDayStartDate: range.startDate,
    allDayEndDateExclusive: range.endDateExclusive,
  });
}

function assertAbsentScheduleValues(input: Record<string, unknown>): void {
  if (
    input.startLocal !== undefined ||
    input.endLocal !== undefined ||
    input.allDayStartDate !== undefined ||
    input.allDayEndDateExclusive !== undefined
  ) {
    throw validationIssue(
      "schedule",
      "invalid_schedule_shape",
      "An unscheduled Idea cannot include date or time values.",
    );
  }
}

function parseOptionalIdentifier(value: unknown, path: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return parseIdentifier(value, path);
}

function parseIdentifierList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > 12) {
    throw validationIssue(
      path,
      "invalid_type",
      "Expected a bounded list of identifiers.",
    );
  }
  const values = value.map((item, index) =>
    parseIdentifier(item, `${path}.${index}`),
  );
  return [...new Set(values)].sort();
}

function parseOptionalMeetupEventUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new URL(parseHttpsUrl(value, "meetupEventUrl"));
  if (
    parsed.hostname.toLowerCase() !== "www.meetup.com" ||
    !/^\/[A-Za-z0-9_-]+\/events\/[A-Za-z0-9_-]+\/?$/u.test(parsed.pathname)
  ) {
    throw validationIssue(
      "meetupEventUrl",
      "invalid_meetup_event_url",
      "Expected a public Meetup event URL.",
    );
  }
  parsed.search = "";
  parsed.hash = "";
  if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
  return parsed.toString();
}
