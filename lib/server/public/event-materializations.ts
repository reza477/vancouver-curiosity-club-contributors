import {
  eventOccursOnCalendarDate,
  isPublicCalendarEventUpcoming,
  publicCalendarMonthBounds,
  publicEventCalendarStartDate,
  resolvePublicCalendarLandingMonth,
  resolvePublicCalendarMonth,
  shiftPublicCalendarMonth,
} from "../../public-calendar";
import {
  PUBLIC_EVENT_LANE_SLUGS,
  parsePublicEventLaneSlug,
  type PublicEventLaneSlug,
} from "../../public-event-lanes";
import type {
  D1DatabaseLike,
  D1ResultLike,
} from "../auth";
import {
  queryPublicEventMaterializationBundle,
  type PublicEventCardDto,
  type PublicEventDetailDto,
  type PublicEventPageDto,
} from "./events";
import type {
  PublicEventsClubOption,
  PublicEventsPageData,
} from "./events-page";
import {
  parsePublicEventCardList,
  parsePublicEventDetailList,
} from "./event-calendar-snapshot";
import { resolvePublicOrganization } from "./catalog";
import { vancouverCalendarDate } from "./date";
import {
  assertOnlyKeys,
  parseBoundedString,
  parseFiniteInteger,
  parseIdentifier,
  parseObject,
} from "../../validation";
import { parseCalendarDate } from "../../time";

// Adding a new physical surface is backward-compatible with the existing
// Home/Events envelopes. Keeping their version stable lets an already-warm
// deployment continue serving those rows while the protected updater creates
// the first detail row.
const MATERIALIZATION_SCHEMA_VERSION = 1;
const MATERIALIZATION_KEY_PREFIX = "public-event-materializations";
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const MAX_MATERIALIZATION_BYTES = 1_000_000;
const MAX_EVENTS_PER_MONTH = 96;
const MAX_HOME_EVENTS = 48;
const MAX_DETAIL_EVENTS = 512;
const DEFAULT_HOME_EVENT_READ_LIMIT = 6;
const MATERIALIZED_MONTH_BUFFER = 1;
const PUBLIC_MONTH_COUNT = 25;
const MATERIALIZED_MONTH_COUNT =
  PUBLIC_MONTH_COUNT + MATERIALIZED_MONTH_BUFFER * 2;
const MAX_MATERIALIZED_EVENTS =
  MAX_EVENTS_PER_MONTH * MATERIALIZED_MONTH_COUNT;
export const PUBLIC_EVENTS_PAGE_SIZE = 12;

type EventMaterializationDatabase = Pick<
  D1DatabaseLike,
  "batch" | "prepare"
>;

export type RefreshPublicEventMaterializationsInput = Readonly<{
  nowUtcMs: number;
  organizationId?: string;
  todayDate?: string;
}>;

export type RefreshPublicEventMaterializationsResult = Readonly<{
  eventDetailCount: number;
  eventsSnapshotCount: number;
  homeEventCount: number;
}>;

export type PublicEventMaterializationServices = Readonly<{
  projectBundle?: typeof queryPublicEventMaterializationBundle;
}>;

type EventMaterializationEnvelope = Readonly<{
  calendarEvents: readonly PublicEventCardDto[];
  generatedAtUtcMs: number;
  maxMaterializedMonth: string;
  minMaterializedMonth: string;
  schemaVersion: number;
  todayDate: string;
}>;

type HomeEventMaterializationEnvelope = Readonly<{
  generatedAtUtcMs: number;
  schemaVersion: number;
  upcomingEvents: readonly PublicEventCardDto[];
}>;

type EventDetailMaterializationEnvelope = Readonly<{
  eventDetails: readonly PublicEventDetailDto[];
  generatedAtUtcMs: number;
  schemaVersion: number;
}>;

export type PublicEventDetailMaterializedView =
  | Readonly<{
      event: PublicEventDetailDto;
      kind: "available";
      related: readonly PublicEventCardDto[];
    }>
  | Readonly<{ kind: "missing" }>;

export type PublicClubEventMaterializedView = Readonly<{
  past: PublicEventPageDto;
  upcoming: PublicEventPageDto;
}>;

const READ_MATERIALIZATION_SQL = String.raw`
SELECT snapshot_json
FROM public_event_calendar_snapshots
WHERE cache_key = ?
  AND organization_id = ?
LIMIT 1`;

const READ_DETAIL_MATERIALIZATION_SQL = String.raw`
SELECT snapshot_json, updated_at
FROM public_event_calendar_snapshots
WHERE cache_key = ?
  AND organization_id = ?
  AND expires_at > ?
LIMIT 1`;

const UPSERT_MATERIALIZATION_SQL = String.raw`
INSERT INTO public_event_calendar_snapshots (
  cache_key,
  organization_id,
  snapshot_json,
  expires_at,
  created_at,
  updated_at
)
SELECT ?, ?, ?, ?, ?, ?
WHERE NOT EXISTS (
  SELECT 1
  FROM public_event_calendar_snapshots AS newer_materialization
  WHERE newer_materialization.organization_id = ?
    AND newer_materialization.cache_key IN (?, ?, ?)
    AND newer_materialization.updated_at > ?
)
ON CONFLICT(cache_key) DO UPDATE SET
  organization_id = excluded.organization_id,
  snapshot_json = excluded.snapshot_json,
  expires_at = excluded.expires_at,
  updated_at = excluded.updated_at
WHERE NOT EXISTS (
  SELECT 1
  FROM public_event_calendar_snapshots AS newer_materialization
  WHERE newer_materialization.organization_id = excluded.organization_id
    AND newer_materialization.cache_key IN (?, ?, ?)
    AND newer_materialization.updated_at > excluded.updated_at
)`;

/**
 * Projects one bounded public-event dataset, validates every derived public
 * month/lane surface in memory, then atomically promotes the complete result.
 * No visitor route calls this function.
 */
export async function refreshPublicEventMaterializations(
  database: EventMaterializationDatabase,
  input: RefreshPublicEventMaterializationsInput,
  services: PublicEventMaterializationServices = {},
): Promise<RefreshPublicEventMaterializationsResult> {
  const nowUtcMs = parseFiniteInteger(input.nowUtcMs, {
    path: "eventMaterializations.nowUtcMs",
    minimum: 0,
    maximum: MAX_TIMESTAMP - 1,
  });
  const organizationId = input.organizationId
    ? parseIdentifier(
        input.organizationId,
        "eventMaterializations.organizationId",
      )
    : (await resolvePublicOrganization(database))?.id ?? null;
  if (!organizationId) {
    throw new Error("The public organization is unavailable.");
  }
  const todayDate = parseMaterializationDate(
    input.todayDate ?? vancouverCalendarDate(nowUtcMs),
  );
  const supported = resolvePublicCalendarMonth(undefined, todayDate);
  const minMaterializedMonth = shiftPublicCalendarMonth(
    supported.minMonth,
    -MATERIALIZED_MONTH_BUFFER,
  );
  const maxMaterializedMonth = shiftPublicCalendarMonth(
    supported.maxMonth,
    MATERIALIZED_MONTH_BUFFER,
  );
  const bounds = {
    startDate: publicCalendarMonthBounds(minMaterializedMonth).startDate,
    endDate: publicCalendarMonthBounds(maxMaterializedMonth).endDate,
  };
  const projected = await (services.projectBundle ??
    queryPublicEventMaterializationBundle)(database, {
    calendar: {
      fromDate: bounds.startDate,
      nowUtcMs,
      organizationId,
      todayDate,
      toDate: bounds.endDate,
    },
  });
  const normalizedUpcoming = [...projected.upcomingEvents].sort(
    comparePublicEventStart,
  );
  const envelope = validatedEnvelope({
    calendarEvents: projected.calendarEvents,
    generatedAtUtcMs: nowUtcMs,
    maxMaterializedMonth,
    minMaterializedMonth,
    schemaVersion: MATERIALIZATION_SCHEMA_VERSION,
    todayDate,
  });
  const homeEnvelope = validatedHomeEnvelope({
    generatedAtUtcMs: nowUtcMs,
    schemaVersion: MATERIALIZATION_SCHEMA_VERSION,
    upcomingEvents: normalizedUpcoming.slice(0, MAX_HOME_EVENTS),
  });
  if (!Array.isArray(projected.eventDetails)) {
    throw new Error(
      "The public event-detail projection was not supplied safely.",
    );
  }
  const detailEnvelope = validatedDetailEnvelope({
    eventDetails: projected.eventDetails,
    generatedAtUtcMs: nowUtcMs,
    schemaVersion: MATERIALIZATION_SCHEMA_VERSION,
  });
  assertCardSurfacesHaveMatchingDetails(
    [...envelope.calendarEvents, ...homeEnvelope.upcomingEvents],
    detailEnvelope.eventDetails,
  );
  assertEveryDerivedSurfaceIsBounded(envelope);
  const snapshotJson = JSON.stringify(envelope);
  const homeSnapshotJson = JSON.stringify(homeEnvelope);
  const detailSnapshotJson = JSON.stringify(detailEnvelope);
  if (
    new TextEncoder().encode(snapshotJson).byteLength >
    MAX_MATERIALIZATION_BYTES ||
    new TextEncoder().encode(homeSnapshotJson).byteLength >
      MAX_MATERIALIZATION_BYTES ||
    new TextEncoder().encode(detailSnapshotJson).byteLength >
      MAX_MATERIALIZATION_BYTES
  ) {
    throw new Error("The public event materialization is too large.");
  }

  const cacheKey = materializationKey(organizationId, "events");
  const homeCacheKey = materializationKey(organizationId, "home");
  const detailCacheKey = materializationKey(organizationId, "details");
  const materializationKeys = [cacheKey, homeCacheKey, detailCacheKey] as const;
  const results = await database.batch(
    [
      [cacheKey, snapshotJson],
      [homeCacheKey, homeSnapshotJson],
      [detailCacheKey, detailSnapshotJson],
    ].map(([surfaceCacheKey, surfaceJson]) =>
      database
        .prepare(UPSERT_MATERIALIZATION_SQL)
        .bind(
          surfaceCacheKey,
          organizationId,
          surfaceJson,
          MAX_TIMESTAMP,
          nowUtcMs,
          nowUtcMs,
          organizationId,
          ...materializationKeys,
          nowUtcMs,
          ...materializationKeys,
        ),
    ),
  );
  const promotion = assertSuccessfulWrites(results);
  if (promotion === "superseded") {
    const [activeEvents, activeHome, activeDetails] = await Promise.all([
      readEnvelope(database, organizationId),
      readHomeEnvelope(database, organizationId),
      readDetailEnvelope(database, organizationId, nowUtcMs),
    ]);
    if (!activeEvents || !activeHome || !activeDetails) {
      throw new Error(
        "The newer public event materialization could not be verified.",
      );
    }
    if (
      new Set([
        activeEvents.generatedAtUtcMs,
        activeHome.generatedAtUtcMs,
        activeDetails.generatedAtUtcMs,
      ]).size !== 1
    ) {
      throw new Error(
        "The newer public event materialization was not coherent.",
      );
    }
    return Object.freeze({
      eventDetailCount: activeDetails.eventDetails.length,
      eventsSnapshotCount: 1,
      homeEventCount: activeHome.upcomingEvents.length,
    });
  }

  return Object.freeze({
    eventDetailCount: detailEnvelope.eventDetails.length,
    eventsSnapshotCount: 1,
    homeEventCount: homeEnvelope.upcomingEvents.length,
  });
}

/** One indexed read supplies both the detail DTO and its bounded related rail. */
export async function readPublicEventDetailViewMaterialization(
  database: Pick<D1DatabaseLike, "prepare">,
  input: Readonly<{
    limit?: number;
    nowUtcMs: number;
    organizationId: string;
    slug: string;
    todayDate: string;
  }>,
): Promise<PublicEventDetailMaterializedView | null> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "eventMaterializations.organizationId",
  );
  const slug = parseIdentifier(input.slug, "eventMaterializations.slug");
  const nowUtcMs = parseFiniteInteger(input.nowUtcMs, {
    path: "eventMaterializations.nowUtcMs",
    minimum: 0,
    maximum: MAX_TIMESTAMP - 1,
  });
  const todayDate = parseMaterializationDate(input.todayDate);
  const limit = parseFiniteInteger(input.limit ?? 3, {
    path: "eventMaterializations.related.limit",
    minimum: 1,
    maximum: 6,
  });
  const envelope = await readDetailEnvelope(
    database,
    organizationId,
    nowUtcMs,
  );
  if (!envelope) return null;
  const event = envelope.eventDetails.find(
    (candidate) => candidate.slug === slug,
  );
  if (!event) return Object.freeze({ kind: "missing" as const });
  const related = event.isCancelled
    ? []
    : envelope.eventDetails
        .filter(
          (candidate) =>
            candidate.slug !== event.slug &&
            (candidate.status === "confirmed" ||
              candidate.status === "tentative") &&
            isPublicCalendarEventUpcoming(candidate, nowUtcMs, todayDate) &&
            (candidate.club.slug === event.club.slug ||
              (event.category !== null &&
                candidate.category?.slug === event.category.slug)),
        )
        .sort((left, right) => {
          const clubOrder =
            Number(right.club.slug === event.club.slug) -
            Number(left.club.slug === event.club.slug);
          return clubOrder || comparePublicEventStart(left, right);
        })
        .slice(0, limit);
  return Object.freeze({
    event,
    kind: "available" as const,
    related: Object.freeze(related),
  });
}

/** One indexed read derives the bounded Upcoming/Past rails for a club page. */
export async function readPublicClubEventViewMaterialization(
  database: Pick<D1DatabaseLike, "prepare">,
  input: Readonly<{
    clubSlug: string;
    nowUtcMs: number;
    organizationId: string;
    pageSize?: number;
    programSlug?: string;
    todayDate: string;
  }>,
): Promise<PublicClubEventMaterializedView | null> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "eventMaterializations.organizationId",
  );
  const clubSlug = parseIdentifier(
    input.clubSlug,
    "eventMaterializations.clubSlug",
  );
  const programSlug = input.programSlug
    ? parseIdentifier(
        input.programSlug,
        "eventMaterializations.programSlug",
      )
    : null;
  const nowUtcMs = parseFiniteInteger(input.nowUtcMs, {
    path: "eventMaterializations.nowUtcMs",
    minimum: 0,
    maximum: MAX_TIMESTAMP - 1,
  });
  const todayDate = parseMaterializationDate(input.todayDate);
  const pageSize = parseFiniteInteger(input.pageSize ?? 6, {
    path: "eventMaterializations.club.pageSize",
    minimum: 1,
    maximum: 12,
  });
  const detailEnvelope = await readDetailEnvelope(
    database,
    organizationId,
    nowUtcMs,
  );
  let events: readonly PublicEventCardDto[];
  if (detailEnvelope) {
    events = detailEnvelope.eventDetails;
  } else {
    // Backward-compatible first-deploy seam: the existing Events row remains
    // usable until the protected updater creates the new detail row.
    const envelope = await readEnvelope(database, organizationId);
    if (!envelope) return null;
    const currentMonth = resolvePublicCalendarMonth(undefined, todayDate).month;
    if (!materializedMonthAvailable(envelope, currentMonth)) return null;
    events = envelope.calendarEvents;
  }
  const matching = events.filter(
    (event) =>
      event.club.slug === clubSlug &&
      (programSlug === null || event.program?.slug === programSlug),
  );
  const upcoming = matching
    .filter(
      (event) =>
        (event.status === "confirmed" || event.status === "tentative") &&
        isPublicCalendarEventUpcoming(event, nowUtcMs, todayDate),
    )
    .sort(comparePublicEventStart);
  const past = matching
    .filter(
      (event) =>
        (event.status === "confirmed" ||
          event.status === "tentative" ||
          event.status === "completed") &&
        !isPublicCalendarEventUpcoming(event, nowUtcMs, todayDate),
    )
    .sort((left, right) => comparePublicEventStart(right, left));
  return Object.freeze({
    past: materializedEventPage(past, "past", pageSize),
    upcoming: materializedEventPage(upcoming, "upcoming", pageSize),
  });
}

/** Read-only Home seam. A missing generation is an empty event rail. */
export async function readPublicHomeEventMaterialization(
  database: Pick<D1DatabaseLike, "prepare">,
  input: Readonly<{
    maximum?: number;
    nowUtcMs?: number;
    organizationId: string;
    todayDate?: string;
  }>,
): Promise<readonly PublicEventCardDto[] | null> {
  const maximum = parseFiniteInteger(
    input.maximum ?? DEFAULT_HOME_EVENT_READ_LIMIT,
    {
      path: "eventMaterializations.home.maximum",
      minimum: 1,
      maximum: MAX_HOME_EVENTS,
    },
  );
  const envelope = await readHomeEnvelope(database, input.organizationId);
  if (!envelope) return null;
  const nowUtcMs = parseFiniteInteger(input.nowUtcMs ?? Date.now(), {
    path: "eventMaterializations.nowUtcMs",
    minimum: 0,
    maximum: MAX_TIMESTAMP - 1,
  });
  const todayDate = parseMaterializationDate(
    input.todayDate ?? vancouverCalendarDate(nowUtcMs),
  );
  return Object.freeze(
    envelope.upcomingEvents
      .filter((event) =>
        isPublicCalendarEventUpcoming(event, nowUtcMs, todayDate),
      )
      .slice(0, maximum),
  );
}

/**
 * Read-only Events seam. Month and lane selection are derived from the one
 * active durable dataset; a visitor can never project or write event data.
 */
export async function readPublicEventsPageMaterialization(
  database: Pick<D1DatabaseLike, "prepare">,
  input: Readonly<{
    clubSlug?: unknown;
    laneSlug?: unknown;
    nowUtcMs?: number;
    organizationId: string;
    rawMonth: unknown;
    rawPage?: unknown;
    todayDate: string;
  }>,
): Promise<PublicEventsPageData | null> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "eventMaterializations.organizationId",
  );
  const todayDate = parseMaterializationDate(input.todayDate);
  const nowUtcMs = parseFiniteInteger(input.nowUtcMs ?? Date.now(), {
    path: "eventMaterializations.nowUtcMs",
    minimum: 0,
    maximum: MAX_TIMESTAMP - 1,
  });
  const envelope = await readEnvelope(database, organizationId);
  if (!envelope) return null;
  const laneSlug = parsePublicEventLaneSlug(input.laneSlug);
  const clubOptions = materializedClubOptions(envelope.calendarEvents);
  const clubSelection = resolveMaterializedClubSelection(
    input.clubSlug,
    clubOptions,
  );
  const clubSlug = clubSelection.activeClubSlug;
  const requestedPage = parseRequestedEventsPage(input.rawPage);
  const matchingUpcoming = envelope.calendarEvents
    .filter(
      (event) =>
        eventMatchesLane(event, laneSlug) &&
        eventMatchesClub(event, clubSlug) &&
        isPublicCalendarEventUpcoming(event, nowUtcMs, todayDate),
    )
    .sort(comparePublicEventStart);
  const totalCount = matchingUpcoming.length;
  const totalPages = Math.max(
    1,
    Math.ceil(totalCount / PUBLIC_EVENTS_PAGE_SIZE),
  );
  const invalidPage =
    requestedPage.invalid || requestedPage.page > totalPages;
  const page = invalidPage ? 1 : requestedPage.page;
  const pageStart = (page - 1) * PUBLIC_EVENTS_PAGE_SIZE;
  let resolvedMonth = resolvePublicCalendarMonth(
    input.rawMonth,
    todayDate,
  );
  if (!materializedMonthAvailable(envelope, resolvedMonth.month)) {
    return null;
  }
  let events = eventsForMonthAndLane(
    envelope.calendarEvents,
    resolvedMonth.month,
    laneSlug,
  ).filter((event) => eventMatchesClub(event, clubSlug));
  let shiftedToUpcoming = false;

  if (input.rawMonth === undefined) {
    const currentUpcoming = events.find((event) =>
      isPublicCalendarEventUpcoming(event, nowUtcMs, todayDate),
    );
    const landingEvent =
      currentUpcoming ??
      envelope.calendarEvents.find(
        (event) =>
          eventMatchesLane(event, laneSlug) &&
          eventMatchesClub(event, clubSlug) &&
          isPublicCalendarEventUpcoming(event, nowUtcMs, todayDate),
      ) ??
      null;
    const landingMonth = resolvePublicCalendarLandingMonth(
      undefined,
      todayDate,
      landingEvent ? publicEventCalendarStartDate(landingEvent) : null,
    );
    if (
      landingMonth.month !== resolvedMonth.month &&
      materializedMonthAvailable(envelope, landingMonth.month)
    ) {
      resolvedMonth = landingMonth;
      events = eventsForMonthAndLane(
        envelope.calendarEvents,
        resolvedMonth.month,
        laneSlug,
      ).filter((event) => eventMatchesClub(event, clubSlug));
      shiftedToUpcoming = true;
    }
  }

  return Object.freeze({
    activeClubSlug: clubSlug,
    calendar: Object.freeze({
      events: Object.freeze(events),
      hasMore: false,
      resolvedMonth,
      shiftedToUpcoming,
    }),
    calendarAvailable: true,
    clubOptions,
    invalidClub: clubSelection.invalid,
    upcoming: Object.freeze({
      events: Object.freeze(
        matchingUpcoming.slice(pageStart, pageStart + PUBLIC_EVENTS_PAGE_SIZE),
      ),
      invalidPage,
      page,
      pageSize: PUBLIC_EVENTS_PAGE_SIZE,
      totalCount,
      totalPages,
    }),
  });
}

async function readEnvelope(
  database: Pick<D1DatabaseLike, "prepare">,
  rawOrganizationId: string,
): Promise<EventMaterializationEnvelope | null> {
  const organizationId = parseIdentifier(
    rawOrganizationId,
    "eventMaterializations.organizationId",
  );
  let row: Record<string, unknown> | null;
  try {
    row = await database
      .prepare(READ_MATERIALIZATION_SQL)
      .bind(materializationKey(organizationId, "events"), organizationId)
      .first<Record<string, unknown>>();
  } catch {
    return null;
  }
  if (!row || typeof row.snapshot_json !== "string") return null;
  if (
    new TextEncoder().encode(row.snapshot_json).byteLength >
    MAX_MATERIALIZATION_BYTES
  ) {
    return null;
  }
  try {
    return validatedEnvelope(JSON.parse(row.snapshot_json));
  } catch {
    return null;
  }
}

async function readHomeEnvelope(
  database: Pick<D1DatabaseLike, "prepare">,
  rawOrganizationId: string,
): Promise<HomeEventMaterializationEnvelope | null> {
  const organizationId = parseIdentifier(
    rawOrganizationId,
    "eventMaterializations.organizationId",
  );
  let row: Record<string, unknown> | null;
  try {
    row = await database
      .prepare(READ_MATERIALIZATION_SQL)
      .bind(materializationKey(organizationId, "home"), organizationId)
      .first<Record<string, unknown>>();
  } catch {
    return null;
  }
  if (!row || typeof row.snapshot_json !== "string") return null;
  if (
    new TextEncoder().encode(row.snapshot_json).byteLength >
    MAX_MATERIALIZATION_BYTES
  ) {
    return null;
  }
  try {
    return validatedHomeEnvelope(JSON.parse(row.snapshot_json));
  } catch {
    return null;
  }
}

async function readDetailEnvelope(
  database: Pick<D1DatabaseLike, "prepare">,
  rawOrganizationId: string,
  nowUtcMs: number,
): Promise<EventDetailMaterializationEnvelope | null> {
  const organizationId = parseIdentifier(
    rawOrganizationId,
    "eventMaterializations.organizationId",
  );
  let row: Record<string, unknown> | null;
  try {
    row = await database
      .prepare(READ_DETAIL_MATERIALIZATION_SQL)
      .bind(
        materializationKey(organizationId, "details"),
        organizationId,
        nowUtcMs,
      )
      .first<Record<string, unknown>>();
  } catch {
    return null;
  }
  if (!row || typeof row.snapshot_json !== "string") return null;
  if (
    new TextEncoder().encode(row.snapshot_json).byteLength >
    MAX_MATERIALIZATION_BYTES
  ) {
    return null;
  }
  try {
    const envelope = validatedDetailEnvelope(JSON.parse(row.snapshot_json));
    return row.updated_at === envelope.generatedAtUtcMs ? envelope : null;
  } catch {
    return null;
  }
}

function validatedEnvelope(value: unknown): EventMaterializationEnvelope {
  const envelope = parseObject(value, "eventMaterialization");
  assertOnlyKeys(
    envelope,
    [
      "calendarEvents",
      "generatedAtUtcMs",
      "maxMaterializedMonth",
      "minMaterializedMonth",
      "schemaVersion",
      "todayDate",
    ],
    "eventMaterialization",
  );
  const schemaVersion = parseFiniteInteger(envelope.schemaVersion, {
    path: "eventMaterialization.schemaVersion",
    minimum: MATERIALIZATION_SCHEMA_VERSION,
    maximum: MATERIALIZATION_SCHEMA_VERSION,
  });
  const generatedAtUtcMs = parseFiniteInteger(envelope.generatedAtUtcMs, {
    path: "eventMaterialization.generatedAtUtcMs",
    minimum: 0,
    maximum: MAX_TIMESTAMP - 1,
  });
  const todayDate = parseMaterializationDate(envelope.todayDate);
  const minMaterializedMonth = parseMaterializationMonth(
    envelope.minMaterializedMonth,
    "minMaterializedMonth",
  );
  const maxMaterializedMonth = parseMaterializationMonth(
    envelope.maxMaterializedMonth,
    "maxMaterializedMonth",
  );
  if (
    minMaterializedMonth > maxMaterializedMonth ||
    countMonths(minMaterializedMonth, maxMaterializedMonth) !==
      MATERIALIZED_MONTH_COUNT
  ) {
    throw new Error("The public event materialization range is invalid.");
  }
  return Object.freeze({
    calendarEvents: parsePublicEventCardList(envelope.calendarEvents, {
      maximum: MAX_MATERIALIZED_EVENTS,
      path: "eventMaterialization.calendarEvents",
    }),
    generatedAtUtcMs,
    maxMaterializedMonth,
    minMaterializedMonth,
    schemaVersion,
    todayDate,
  });
}

function validatedHomeEnvelope(
  value: unknown,
): HomeEventMaterializationEnvelope {
  const envelope = parseObject(value, "homeEventMaterialization");
  assertOnlyKeys(
    envelope,
    ["generatedAtUtcMs", "schemaVersion", "upcomingEvents"],
    "homeEventMaterialization",
  );
  return Object.freeze({
    generatedAtUtcMs: parseFiniteInteger(envelope.generatedAtUtcMs, {
      path: "homeEventMaterialization.generatedAtUtcMs",
      minimum: 0,
      maximum: MAX_TIMESTAMP - 1,
    }),
    schemaVersion: parseFiniteInteger(envelope.schemaVersion, {
      path: "homeEventMaterialization.schemaVersion",
      minimum: MATERIALIZATION_SCHEMA_VERSION,
      maximum: MATERIALIZATION_SCHEMA_VERSION,
    }),
    upcomingEvents: parsePublicEventCardList(envelope.upcomingEvents, {
      maximum: MAX_HOME_EVENTS,
      path: "homeEventMaterialization.upcomingEvents",
    }),
  });
}

function validatedDetailEnvelope(
  value: unknown,
): EventDetailMaterializationEnvelope {
  const envelope = parseObject(value, "eventDetailMaterialization");
  assertOnlyKeys(
    envelope,
    ["eventDetails", "generatedAtUtcMs", "schemaVersion"],
    "eventDetailMaterialization",
  );
  const eventDetails = parsePublicEventDetailList(envelope.eventDetails, {
    maximum: MAX_DETAIL_EVENTS,
    path: "eventDetailMaterialization.eventDetails",
  });
  const slugs = new Set(eventDetails.map((event) => event.slug));
  if (slugs.size !== eventDetails.length) {
    throw new Error("The public event-detail materialization is ambiguous.");
  }
  return Object.freeze({
    eventDetails,
    generatedAtUtcMs: parseFiniteInteger(envelope.generatedAtUtcMs, {
      path: "eventDetailMaterialization.generatedAtUtcMs",
      minimum: 0,
      maximum: MAX_TIMESTAMP - 1,
    }),
    schemaVersion: parseFiniteInteger(envelope.schemaVersion, {
      path: "eventDetailMaterialization.schemaVersion",
      minimum: MATERIALIZATION_SCHEMA_VERSION,
      maximum: MATERIALIZATION_SCHEMA_VERSION,
    }),
  });
}

function assertCardSurfacesHaveMatchingDetails(
  cards: readonly PublicEventCardDto[],
  details: readonly PublicEventDetailDto[],
): void {
  const detailBySlug = new Map(
    details.map((event) => [event.slug, publicEventCardProjection(event)]),
  );
  for (const card of cards) {
    const detailCard = detailBySlug.get(card.slug);
    if (
      !detailCard ||
      JSON.stringify(detailCard) !==
        JSON.stringify(publicEventCardProjection(card))
    ) {
      throw new Error(
        "The public event-detail projection did not match its card surface.",
      );
    }
  }
}

function publicEventCardProjection(
  event: PublicEventCardDto,
): PublicEventCardDto {
  return Object.freeze({
    agePolicyText: event.agePolicyText,
    arrivalInstructions: event.arrivalInstructions,
    attendanceMode: event.attendanceMode,
    artwork: event.artwork,
    availabilityState: event.availabilityState,
    capacity: event.capacity,
    category: event.category,
    club: event.club,
    costText: event.costText,
    isCancelled: event.isCancelled,
    lane: event.lane,
    program: event.program,
    rsvpMode: event.rsvpMode,
    rsvpUrl: event.rsvpUrl,
    schedule: event.schedule,
    slug: event.slug,
    status: event.status,
    summary: event.summary,
    title: event.title,
    venue: event.venue,
    waitlistAvailable: event.waitlistAvailable,
  });
}

function assertEveryDerivedSurfaceIsBounded(
  envelope: EventMaterializationEnvelope,
): void {
  for (
    let month = envelope.minMaterializedMonth;
    month <= envelope.maxMaterializedMonth;
    month = shiftPublicCalendarMonth(month, 1)
  ) {
    for (const laneSlug of [null, ...PUBLIC_EVENT_LANE_SLUGS] as const) {
      const count = eventsForMonthAndLane(
        envelope.calendarEvents,
        month,
        laneSlug,
      ).length;
      if (count > MAX_EVENTS_PER_MONTH) {
        throw new Error(
          `The ${month} ${laneSlug ?? "all"} event materialization exceeds its safe row limit.`,
        );
      }
    }
  }
}

function eventsForMonthAndLane(
  events: readonly PublicEventCardDto[],
  month: string,
  laneSlug: PublicEventLaneSlug | null,
): readonly PublicEventCardDto[] {
  const bounds = publicCalendarMonthBounds(month);
  return Object.freeze(
    events.filter(
      (event) => {
        if (!eventMatchesLane(event, laneSlug)) return false;
        const startDate = publicEventCalendarStartDate(event);
        return (
          startDate <= bounds.endDate &&
          (startDate >= bounds.startDate ||
            eventOccursOnCalendarDate(event, bounds.startDate))
        );
      },
    ),
  );
}

function eventMatchesLane(
  event: PublicEventCardDto,
  laneSlug: PublicEventLaneSlug | null,
): boolean {
  return laneSlug === null || event.lane?.slug === laneSlug;
}

function eventMatchesClub(
  event: PublicEventCardDto,
  clubSlug: string | null,
): boolean {
  return clubSlug === null || event.club.slug === clubSlug;
}

function materializedClubOptions(
  events: readonly PublicEventCardDto[],
): readonly PublicEventsClubOption[] {
  const clubs = new Map<string, string>();
  for (const event of events) {
    if (!clubs.has(event.club.slug)) {
      clubs.set(event.club.slug, event.club.name);
    }
  }
  return Object.freeze(
    [...clubs.entries()]
      .map(([slug, name]) => Object.freeze({ name, slug }))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name, "en") ||
          left.slug.localeCompare(right.slug),
      ),
  );
}

function resolveMaterializedClubSelection(
  value: unknown,
  clubOptions: readonly PublicEventsClubOption[],
): Readonly<{
  activeClubSlug: string | null;
  invalid: boolean;
}> {
  if (value === undefined || value === "") {
    return Object.freeze({ activeClubSlug: null, invalid: false });
  }
  if (
    typeof value !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,159}$/u.test(value) ||
    !clubOptions.some((club) => club.slug === value)
  ) {
    return Object.freeze({ activeClubSlug: null, invalid: true });
  }
  return Object.freeze({ activeClubSlug: value, invalid: false });
}

function parseRequestedEventsPage(value: unknown): Readonly<{
  invalid: boolean;
  page: number;
}> {
  if (value === undefined || value === "") {
    return Object.freeze({ invalid: false, page: 1 });
  }
  if (typeof value !== "string" || !/^[1-9]\d{0,4}$/u.test(value)) {
    return Object.freeze({ invalid: true, page: 1 });
  }
  return Object.freeze({ invalid: false, page: Number(value) });
}

function comparePublicEventStart(
  left: PublicEventCardDto,
  right: PublicEventCardDto,
): number {
  const startOrder = publicEventStartSortValue(left) -
    publicEventStartSortValue(right);
  if (startOrder !== 0) return startOrder;
  const titleOrder = compareSqliteNoCase(left.title, right.title);
  return titleOrder || compareBinaryText(left.slug, right.slug);
}

function publicEventStartSortValue(event: PublicEventCardDto): number {
  return event.schedule.kind === "timed"
    ? Date.parse(event.schedule.startsAtUtc)
    : Date.parse(`${event.schedule.startDate}T12:00:00.000Z`);
}

// SQLite's built-in NOCASE collation folds ASCII only, then uses binary text
// order. Match that deterministic tie-break without locale-dependent browser
// or Worker collation.
function compareSqliteNoCase(left: string, right: string): number {
  return compareBinaryText(asciiLower(left), asciiLower(right));
}

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/gu, (character) => character.toLowerCase());
}

function compareBinaryText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function materializedEventPage(
  events: readonly PublicEventCardDto[],
  view: "past" | "upcoming",
  pageSize: number,
): PublicEventPageDto {
  return Object.freeze({
    events: Object.freeze(events.slice(0, pageSize)),
    hasMore: events.length > pageSize,
    page: 1,
    pageSize,
    totalCount: events.length,
    view,
  });
}

function materializedMonthAvailable(
  envelope: EventMaterializationEnvelope,
  month: string,
): boolean {
  return (
    month >= envelope.minMaterializedMonth &&
    month <= envelope.maxMaterializedMonth
  );
}

function materializationKey(
  organizationId: string,
  surface: "details" | "events" | "home",
): string {
  return JSON.stringify([
    MATERIALIZATION_KEY_PREFIX,
    MATERIALIZATION_SCHEMA_VERSION,
    organizationId,
    surface,
  ]);
}

function parseMaterializationDate(value: unknown): string {
  const date = parseBoundedString(value, {
    path: "eventMaterialization.todayDate",
    maxLength: 10,
  });
  return parseCalendarDate(date, "eventMaterialization.todayDate");
}

function parseMaterializationMonth(value: unknown, field: string): string {
  const month = parseBoundedString(value, {
    path: `eventMaterialization.${field}`,
    maxLength: 7,
  });
  const resolved = resolvePublicCalendarMonth(
    month,
    `${month}-15`,
  );
  if (resolved.month !== month || resolved.invalid) {
    throw new Error("The public event materialization month is invalid.");
  }
  return month;
}

function countMonths(fromMonth: string, toMonth: string): number {
  let count = 1;
  for (let month = fromMonth; month < toMonth; ) {
    month = shiftPublicCalendarMonth(month, 1);
    count += 1;
    if (count > MATERIALIZED_MONTH_COUNT) break;
  }
  return count;
}

function assertSuccessfulWrites(
  results: readonly D1ResultLike[] | undefined,
): "promoted" | "superseded" {
  if (!results || results.length !== 3) {
    throw new Error("The public event materialization could not be promoted.");
  }
  const changes = results.map((result) =>
    result.success === false ? -1 : result.meta?.changes,
  );
  if (changes.every((change) => change === 1)) return "promoted";
  if (changes.every((change) => change === 0)) return "superseded";
  throw new Error("The public event materialization could not be promoted.");
}
