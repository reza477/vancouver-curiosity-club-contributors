import type { D1DatabaseLike } from "../auth";
import { vancouverCalendarDate } from "../public/date";
import {
  resolvePublicOrganization,
  type PublicOrganizationContext,
} from "../public/catalog";
import {
  getPublicEventExportRecordBySlug,
  queryPublicEventsForExport,
  type PublicEventExportDto,
  type PublicEventExportRecord,
  type PublicEventListView,
} from "../public/events";
import {
  parseCalendarDate,
  parseIanaTimeZone,
} from "../../time";
import {
  parseEnum,
  parseIdentifier,
  parseOptionalBoundedString,
  validationIssue,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  buildCsv,
  buildIcalendar,
  PUBLIC_CSV_EVENT_LIMIT,
  PUBLIC_EXPORT_MAX_RANGE_DAYS,
  PUBLIC_ICS_EVENT_LIMIT,
  sanitizeDownloadFilename,
  type CalendarComponentFacts,
} from "./export-format";
import {
  reconcileCalendarComponentRevisions,
} from "./calendar-component-revisions";

const PUBLIC_EXPORT_FILTER_KEYS = Object.freeze([
  "category",
  "club",
  "format",
  "from",
  "lane",
  "program",
  "q",
  "state",
  "to",
] as const);

export type PublicDownload = Readonly<{
  body: string;
  contentType: string;
  fileName: string;
}>;

export async function createOneEventIcsDownload(
  database: D1DatabaseLike,
  input: Readonly<{
    generatedAt: number;
    origin: string;
    slug: unknown;
  }>,
): Promise<PublicDownload | null> {
  const organization = await resolvePublicOrganization(database);
  if (!organization) return null;
  const slug = parseIdentifier(input.slug, "slug");
  const record = await getPublicEventExportRecordBySlug(database, {
    organizationId: organization.id,
    slug,
  });
  if (!record) return null;
  const origin = parseRequestOrigin(input.origin);
  const component = await toCalendarComponent(
    record,
    organization,
    origin,
  );
  const [calendarEvent] = await reconcileCalendarComponentRevisions(
    database,
    {
      candidates: [
        Object.freeze({
          event: component,
          eventKey: record.sourceIdentity,
        }),
      ],
      organizationId: organization.id,
      scope: "public",
    },
  );
  return Object.freeze({
    body: buildIcalendar([calendarEvent], {
      calendarName: `${record.event.title} · Vancouver Curiosity Club`,
      generatedAt: input.generatedAt,
    }),
    contentType: "text/calendar; charset=utf-8",
    fileName: sanitizeDownloadFilename(
      `${record.event.slug}.ics`,
      "event.ics",
    ),
  });
}

export async function createFilteredPublicIcsDownload(
  database: D1DatabaseLike,
  input: Readonly<{
    generatedAt: number;
    origin: string;
    searchParams: URLSearchParams;
  }>,
): Promise<PublicDownload> {
  const loaded = await loadFilteredPublicEvents(
    database,
    input.searchParams,
    input.generatedAt,
    PUBLIC_ICS_EVENT_LIMIT,
  );
  const origin = parseRequestOrigin(input.origin);
  const components = await Promise.all(
    loaded.records.map((record) =>
      toCalendarComponent(record, loaded.organization, origin),
    ),
  );
  const events = await reconcileCalendarComponentRevisions(database, {
    candidates: loaded.records.map((record, index) =>
      Object.freeze({
        event: components[index],
        eventKey: record.sourceIdentity,
      }),
    ),
    organizationId: loaded.organization.id,
    scope: "public",
  });
  return Object.freeze({
    body: buildIcalendar(events, {
      calendarName: "Vancouver Curiosity Club events",
      generatedAt: input.generatedAt,
    }),
    contentType: "text/calendar; charset=utf-8",
    fileName: "vancouver-curiosity-club-events.ics",
  });
}

export async function createFilteredPublicCsvDownload(
  database: D1DatabaseLike,
  input: Readonly<{
    generatedAt: number;
    origin: string;
    searchParams: URLSearchParams;
  }>,
): Promise<PublicDownload> {
  const loaded = await loadFilteredPublicEvents(
    database,
    input.searchParams,
    input.generatedAt,
    PUBLIC_CSV_EVENT_LIMIT,
  );
  const origin = parseRequestOrigin(input.origin);
  const rows = loaded.records.map(({ event }) => {
    const schedule = publicScheduleFields(event, loaded.organization.timeZone);
    return [
      event.title,
      new URL(`/events/${encodeURIComponent(event.slug)}`, origin).toString(),
      event.club.name,
      event.program?.name ?? null,
      event.lane?.name ?? null,
      event.category?.name ?? null,
      schedule.startDate,
      schedule.startTime,
      schedule.endDate,
      schedule.endTime,
      schedule.timeZone,
      event.attendanceMode,
      publicVenueLabel(event),
      event.availabilityState,
      event.costText,
      event.rsvpUrl,
      event.isCancelled ? "cancelled" : event.status,
    ];
  });
  return Object.freeze({
    body: buildCsv(
      [
        "title",
        "public_url",
        "club",
        "program",
        "lane",
        "category",
        "start_date",
        "start_time",
        "end_date",
        "end_time",
        "timezone",
        "attendance_mode",
        "public_venue",
        "availability",
        "cost",
        "public_rsvp_url",
        "status",
      ],
      rows,
    ),
    contentType: "text/csv; charset=utf-8",
    fileName: "vancouver-curiosity-club-events.csv",
  });
}

async function loadFilteredPublicEvents(
  database: D1DatabaseLike,
  searchParams: URLSearchParams,
  nowUtcMs: number,
  maxEvents: number,
): Promise<Readonly<{
  organization: PublicOrganizationContext;
  records: readonly PublicEventExportRecord[];
}>> {
  const organization = await resolvePublicOrganization(database);
  if (!organization) {
    throw new SafeApplicationError(
      "not_found",
      404,
      "The requested export is unavailable.",
    );
  }
  const filters = parsePublicExportFilters(searchParams, nowUtcMs);
  const records = await queryPublicEventsForExport(database, {
    attendanceMode: filters.attendanceMode,
    categorySlug: filters.categorySlug,
    clubSlug: filters.clubSlug,
    fromDate: filters.fromDate,
    keyword: filters.keyword,
    laneSlug: filters.laneSlug,
    maxEvents,
    nowUtcMs,
    organizationId: organization.id,
    programSlug: filters.programSlug,
    todayDate: vancouverCalendarDate(nowUtcMs),
    toDate: filters.toDate,
    view: filters.view,
  });
  return Object.freeze({ organization, records });
}

export function parsePublicExportFilters(
  searchParams: URLSearchParams,
  nowUtcMs: number,
) {
  for (const key of new Set(searchParams.keys())) {
    if (
      !PUBLIC_EXPORT_FILTER_KEYS.includes(
        key as (typeof PUBLIC_EXPORT_FILTER_KEYS)[number],
      ) ||
      searchParams.getAll(key).length !== 1
    ) {
      throw validationIssue(
        "filters",
        "invalid_filter",
        "One or more export filters could not be validated.",
      );
    }
  }
  const today = vancouverCalendarDate(nowUtcMs);
  const fromDate = parseCalendarDate(
    searchParams.get("from") || today,
    "from",
  );
  const toDate = parseCalendarDate(
    searchParams.get("to") || addCalendarDays(fromDate, 179),
    "to",
  );
  const inclusiveDays = calendarDayDifference(fromDate, toDate) + 1;
  if (
    inclusiveDays < 1 ||
    inclusiveDays > PUBLIC_EXPORT_MAX_RANGE_DAYS
  ) {
    throw validationIssue(
      "to",
      "invalid_date_range",
      "Public exports must cover between 1 and 366 days.",
    );
  }
  return Object.freeze({
    attendanceMode: searchParams.get("format") || undefined,
    categorySlug: searchParams.get("category") || undefined,
    clubSlug: searchParams.get("club") || undefined,
    fromDate,
    keyword:
      parseOptionalBoundedString(searchParams.get("q"), {
        path: "q",
        maxLength: 100,
      }) ?? undefined,
    laneSlug: searchParams.get("lane") || undefined,
    programSlug: searchParams.get("program") || undefined,
    toDate,
    view: parseEnum(
      searchParams.get("state") || "upcoming",
      ["upcoming", "past"] as const,
      "state",
    ) satisfies PublicEventListView,
  });
}

async function toCalendarComponent(
  record: PublicEventExportRecord,
  organization: PublicOrganizationContext,
  origin: URL,
): Promise<CalendarComponentFacts> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${organization.id}\u0000${record.sourceIdentity}`,
    ),
  );
  const uid = `${hex(digest).slice(0, 40)}@calendar.vancouver-curiosity-club`;
  return Object.freeze({
    description: record.event.description ?? record.event.summary,
    location: publicVenueLabel(record.event),
    schedule: record.event.schedule,
    status: record.event.status,
    summary: record.event.title,
    timeZone:
      record.event.schedule.kind === "timed"
        ? record.event.schedule.timeZone
        : organization.timeZone,
    uid,
    url: new URL(
      `/events/${encodeURIComponent(record.event.slug)}`,
      origin,
    ).toString(),
  });
}

function publicVenueLabel(event: PublicEventExportDto): string | null {
  if (!event.venue) return null;
  return [event.venue.name, event.venue.address]
    .filter((value): value is string => Boolean(value))
    .join(" — ");
}

function publicScheduleFields(
  event: PublicEventExportDto,
  allDayTimeZone: string,
) {
  if (event.schedule.kind === "all_day") {
    return Object.freeze({
      startDate: event.schedule.startDate,
      startTime: null,
      endDate: event.schedule.endDateExclusive,
      endTime: null,
      timeZone: allDayTimeZone,
    });
  }
  const timeZone = parseIanaTimeZone(event.schedule.timeZone, "timezone");
  const start = zonedDateTimeParts(event.schedule.startsAtUtc, timeZone);
  const end = zonedDateTimeParts(event.schedule.endsAtUtc, timeZone);
  return Object.freeze({
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    timeZone,
  });
}

function zonedDateTimeParts(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return Object.freeze({
    date: `${read("year")}-${read("month")}-${read("day")}`,
    time: `${read("hour")}:${read("minute")}`,
  });
}

function parseRequestOrigin(value: string): URL {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new SafeApplicationError(
      "validation_failed",
      400,
      "The request origin could not be validated.",
    );
  }
  if (
    origin.origin !== value ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]", "::1"].includes(origin.hostname)
      ))
  ) {
    throw new SafeApplicationError(
      "validation_failed",
      400,
      "The request origin could not be validated.",
    );
  }
  return origin;
}

function addCalendarDays(value: string, days: number): string {
  const instant = Date.parse(`${value}T00:00:00.000Z`);
  return new Date(instant + days * 86_400_000).toISOString().slice(0, 10);
}

function calendarDayDifference(from: string, to: string): number {
  return (
    (Date.parse(`${to}T00:00:00.000Z`) -
      Date.parse(`${from}T00:00:00.000Z`)) /
    86_400_000
  );
}

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
