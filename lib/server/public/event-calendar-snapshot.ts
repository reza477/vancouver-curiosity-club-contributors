import {
  assertOnlyKeys,
  parseBoundedString,
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  parseObject,
  parseOptionalBoundedString,
} from "@/lib/validation";
import type {
  D1DatabaseLike,
  D1ResultLike,
} from "@/lib/server/auth";
import {
  PUBLIC_EVENT_ATTENDANCE_MODES,
  type PublicEventArtworkDto,
  type PublicEventCardDto,
} from "@/lib/server/public/events";
import type { PublicEventsPageData } from "@/lib/server/public/events-page";
import { parseOfficialMeetupEventUrl } from "@/lib/server/meetup/url";
import { resolvePublicCalendarMonth } from "@/lib/public-calendar";
import { parsePublicEventLaneSlug } from "@/lib/public-event-lanes";
import {
  isValidIanaTimeZone,
  parseCalendarDate,
} from "@/lib/time";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const PUBLIC_EVENTS_SNAPSHOT_TTL_MS = 10 * 60 * 1_000;
export const PUBLIC_EVENTS_SNAPSHOT_MAX_BYTES = 1_000_000;
const PUBLIC_EVENTS_SNAPSHOT_SCHEMA_VERSION = 3;
const PUBLIC_EVENTS_MAX_CALENDAR_EVENTS = 96;
const PUBLIC_EVENTS_MAX_MATERIALIZED_EVENTS =
  PUBLIC_EVENTS_MAX_CALENDAR_EVENTS * 27;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/u;

export type PublicEventsSnapshotDatabase = Pick<
  D1DatabaseLike,
  "prepare"
> &
  Partial<Pick<D1DatabaseLike, "batch">>;

export type PublicEventsSnapshotEdgeCache = Readonly<{
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}>;

export type PublicEventsSnapshotContext = Readonly<{
  cacheOrigin?: string | null;
  laneSlug?: unknown;
  nowUtcMs: number;
  organizationId: string;
  rawMonth: unknown;
  sourceRevision?: string;
  todayDate: string;
}>;

export type PublicEventsSnapshotServices = Readonly<{
  edgeCache?: PublicEventsSnapshotEdgeCache | null;
}>;

type SnapshotEnvelope = Readonly<{
  cacheKey: string;
  data: PublicEventsPageData;
  expiresAtUtcMs: number;
  schemaVersion: number;
}>;

const READ_SNAPSHOT_SQL = String.raw`
SELECT snapshot_json
FROM public_event_calendar_snapshots
WHERE cache_key = ?
  AND organization_id = ?
  AND expires_at > ?
LIMIT 1`;

const UPSERT_SNAPSHOT_SQL = String.raw`
INSERT INTO public_event_calendar_snapshots (
  cache_key,
  organization_id,
  snapshot_json,
  expires_at,
  created_at,
  updated_at
)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(cache_key) DO UPDATE SET
  organization_id = excluded.organization_id,
  snapshot_json = excluded.snapshot_json,
  expires_at = excluded.expires_at,
  updated_at = excluded.updated_at`;

const DELETE_EXPIRED_SNAPSHOTS_SQL = String.raw`
DELETE FROM public_event_calendar_snapshots
WHERE organization_id = ?
  AND expires_at <= ?`;

export function publicEventsSnapshotCacheKey(
  context: PublicEventsSnapshotContext,
): string {
  const organizationId = parseIdentifier(
    context.organizationId,
    "publicEventsSnapshot.organizationId",
  );
  const todayDate = parseBoundedString(context.todayDate, {
    path: "publicEventsSnapshot.todayDate",
    maxLength: 10,
  });
  parseCalendarDate(todayDate, "publicEventsSnapshot.todayDate");
  const resolvedMonth = resolvePublicCalendarMonth(
    context.rawMonth,
    todayDate,
  );
  const sourceRevision = parseBoundedString(
    context.sourceRevision ?? runtimeSourceRevision(),
    {
      path: "publicEventsSnapshot.sourceRevision",
      maxLength: 64,
    },
  );
  const laneSlug = parsePublicEventLaneSlug(context.laneSlug);
  return JSON.stringify([
    PUBLIC_EVENTS_SNAPSHOT_SCHEMA_VERSION,
    sourceRevision,
    organizationId,
    todayDate,
    context.rawMonth === undefined ? "landing" : "month",
    resolvedMonth.month,
    resolvedMonth.invalid ? "invalid" : "valid",
    laneSlug ?? "all",
  ]);
}

export async function readPublicEventsSnapshot(
  database: PublicEventsSnapshotDatabase,
  context: PublicEventsSnapshotContext,
  services: PublicEventsSnapshotServices = {},
): Promise<PublicEventsPageData | null> {
  const cacheKey = publicEventsSnapshotCacheKey(context);
  const edgeCache = await resolveEdgeCache(context, services);
  const edgeRequest = edgeCache
    ? publicEventsSnapshotRequest(context.cacheOrigin, cacheKey)
    : null;

  if (edgeCache && edgeRequest) {
    try {
      const response = await edgeCache.match(edgeRequest);
      const parsed = response
        ? await parseSnapshotResponse(response, cacheKey, context.nowUtcMs)
        : null;
      if (parsed) return parsed;
    } catch {
      writeSnapshotCacheWarning("read_public_events_edge_snapshot");
    }
  }

  let row: Record<string, unknown> | null = null;
  try {
    row = await database
      .prepare(READ_SNAPSHOT_SQL)
      .bind(cacheKey, context.organizationId, context.nowUtcMs)
      .first<Record<string, unknown>>();
  } catch {
    writeSnapshotCacheWarning("read_public_events_d1_snapshot");
    return null;
  }
  if (!row || typeof row.snapshot_json !== "string") return null;
  const parsed = parseSnapshotJson(
    row.snapshot_json,
    cacheKey,
    context.nowUtcMs,
  );
  if (!parsed) return null;

  if (edgeCache && edgeRequest) {
    await writeEdgeSnapshot(edgeCache, edgeRequest, row.snapshot_json);
  }
  return parsed;
}

export async function writePublicEventsSnapshot(
  database: PublicEventsSnapshotDatabase,
  context: PublicEventsSnapshotContext,
  data: PublicEventsPageData,
  services: PublicEventsSnapshotServices = {},
): Promise<void> {
  const cacheKey = publicEventsSnapshotCacheKey(context);
  const expiresAtUtcMs = context.nowUtcMs + PUBLIC_EVENTS_SNAPSHOT_TTL_MS;
  const snapshotJson = JSON.stringify({
    cacheKey,
    data,
    expiresAtUtcMs,
    schemaVersion: PUBLIC_EVENTS_SNAPSHOT_SCHEMA_VERSION,
  } satisfies SnapshotEnvelope);
  if (
    new TextEncoder().encode(snapshotJson).byteLength >
    PUBLIC_EVENTS_SNAPSHOT_MAX_BYTES
  ) {
    writeSnapshotCacheWarning("bound_public_events_snapshot");
    return;
  }

  const writes: Promise<unknown>[] = [
    writeD1Snapshot(
      database,
      context,
      cacheKey,
      snapshotJson,
      expiresAtUtcMs,
    ),
  ];
  const edgeCache = await resolveEdgeCache(context, services);
  const edgeRequest = edgeCache
    ? publicEventsSnapshotRequest(context.cacheOrigin, cacheKey)
    : null;
  if (edgeCache && edgeRequest) {
    writes.push(writeEdgeSnapshot(edgeCache, edgeRequest, snapshotJson));
  }
  await Promise.allSettled(writes);
}

async function writeD1Snapshot(
  database: PublicEventsSnapshotDatabase,
  context: PublicEventsSnapshotContext,
  cacheKey: string,
  snapshotJson: string,
  expiresAtUtcMs: number,
): Promise<void> {
  const upsert = database
    .prepare(UPSERT_SNAPSHOT_SQL)
    .bind(
      cacheKey,
      context.organizationId,
      snapshotJson,
      expiresAtUtcMs,
      context.nowUtcMs,
      context.nowUtcMs,
    );
  try {
    if (database.batch) {
      const removeExpired = database
        .prepare(DELETE_EXPIRED_SNAPSHOTS_SQL)
        .bind(context.organizationId, context.nowUtcMs);
      const results = await database.batch([removeExpired, upsert]);
      assertSuccessfulWrites(results);
    } else {
      const result = await upsert.run();
      assertSuccessfulWrites([result]);
    }
  } catch {
    writeSnapshotCacheWarning("write_public_events_d1_snapshot");
  }
}

async function writeEdgeSnapshot(
  edgeCache: PublicEventsSnapshotEdgeCache,
  request: Request,
  snapshotJson: string,
): Promise<void> {
  try {
    await edgeCache.put(
      request,
      new Response(snapshotJson, {
        headers: {
          "Cache-Control": `public, max-age=${Math.floor(
            PUBLIC_EVENTS_SNAPSHOT_TTL_MS / 1_000,
          )}`,
          "Content-Type": "application/json; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
        status: 200,
      }),
    );
  } catch {
    writeSnapshotCacheWarning("write_public_events_edge_snapshot");
  }
}

async function resolveEdgeCache(
  _context: PublicEventsSnapshotContext,
  services: PublicEventsSnapshotServices,
): Promise<PublicEventsSnapshotEdgeCache | null> {
  return services.edgeCache ?? null;
}

function publicEventsSnapshotRequest(
  cacheOrigin: string | null | undefined,
  cacheKey: string,
): Request | null {
  const origin = safeCacheOrigin(cacheOrigin);
  if (!origin) return null;
  const url = new URL("/.__vcc-cache/public-events", origin);
  url.searchParams.set("key", cacheKey);
  return new Request(url, { method: "GET" });
}

function safeCacheOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

async function parseSnapshotResponse(
  response: Response,
  cacheKey: string,
  nowUtcMs: number,
): Promise<PublicEventsPageData | null> {
  if (response.status !== 200) return null;
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) ||
      Number(contentLength) > PUBLIC_EVENTS_SNAPSHOT_MAX_BYTES)
  ) {
    return null;
  }
  return parseSnapshotJson(await response.text(), cacheKey, nowUtcMs);
}

function parseSnapshotJson(
  snapshotJson: string,
  cacheKey: string,
  nowUtcMs: number,
): PublicEventsPageData | null {
  if (
    new TextEncoder().encode(snapshotJson).byteLength >
    PUBLIC_EVENTS_SNAPSHOT_MAX_BYTES
  ) {
    return null;
  }
  try {
    const envelope = parseObject(JSON.parse(snapshotJson), "snapshot");
    assertOnlyKeys(
      envelope,
      ["cacheKey", "data", "expiresAtUtcMs", "schemaVersion"],
      "snapshot",
    );
    if (
      envelope.cacheKey !== cacheKey ||
      envelope.schemaVersion !== PUBLIC_EVENTS_SNAPSHOT_SCHEMA_VERSION
    ) {
      return null;
    }
    const expiresAtUtcMs = parseFiniteInteger(envelope.expiresAtUtcMs, {
      path: "snapshot.expiresAtUtcMs",
      minimum: 0,
      maximum: MAX_TIMESTAMP,
    });
    if (expiresAtUtcMs <= nowUtcMs) return null;
    return parsePublicEventsPageData(envelope.data);
  } catch {
    return null;
  }
}

export function parsePublicEventsPageData(
  value: unknown,
): PublicEventsPageData {
  const data = parseObject(value, "snapshot.data");
  assertOnlyKeys(data, ["calendar", "calendarAvailable"], "snapshot.data");
  if (data.calendarAvailable !== true) {
    throw new Error("Only available public calendars may be cached.");
  }
  const calendar = parseObject(data.calendar, "snapshot.data.calendar");
  assertOnlyKeys(
    calendar,
    ["events", "hasMore", "resolvedMonth", "shiftedToUpcoming"],
    "snapshot.data.calendar",
  );
  if (
    !Array.isArray(calendar.events) ||
    calendar.events.length > PUBLIC_EVENTS_MAX_CALENDAR_EVENTS ||
    typeof calendar.hasMore !== "boolean" ||
    typeof calendar.shiftedToUpcoming !== "boolean"
  ) {
    throw new Error("The cached public calendar has an invalid shape.");
  }
  const resolvedMonth = parseObject(
    calendar.resolvedMonth,
    "snapshot.data.calendar.resolvedMonth",
  );
  assertOnlyKeys(
    resolvedMonth,
    ["invalid", "maxMonth", "minMonth", "month"],
    "snapshot.data.calendar.resolvedMonth",
  );
  const month = parseMonth(resolvedMonth.month, "month");
  const minMonth = parseMonth(resolvedMonth.minMonth, "minMonth");
  const maxMonth = parseMonth(resolvedMonth.maxMonth, "maxMonth");
  if (
    typeof resolvedMonth.invalid !== "boolean" ||
    minMonth > month ||
    month > maxMonth
  ) {
    throw new Error("The cached calendar month is invalid.");
  }
  return Object.freeze({
    calendar: Object.freeze({
      events: parsePublicEventCardList(calendar.events, {
        maximum: PUBLIC_EVENTS_MAX_CALENDAR_EVENTS,
        path: "snapshot.data.calendar.events",
      }),
      hasMore: calendar.hasMore,
      resolvedMonth: Object.freeze({
        invalid: resolvedMonth.invalid,
        maxMonth,
        minMonth,
        month,
      }),
      shiftedToUpcoming: calendar.shiftedToUpcoming,
    }),
    calendarAvailable: true,
  });
}

export function parsePublicEventCardList(
  value: unknown,
  options: Readonly<{ maximum: number; path: string }>,
): readonly PublicEventCardDto[] {
  const maximum = parseFiniteInteger(options.maximum, {
    path: `${options.path}.maximum`,
    minimum: 0,
    maximum: PUBLIC_EVENTS_MAX_MATERIALIZED_EVENTS,
  });
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`The cached public events at ${options.path} are invalid.`);
  }
  return Object.freeze(
    value.map((event, index) =>
      parseEventCard(event, index, options.path),
    ),
  );
}

function parseEventCard(
  value: unknown,
  index: number,
  basePath = "snapshot.data.calendar.events",
): PublicEventCardDto {
  const path = `${basePath}.${index}`;
  const event = parseObject(value, path);
  assertOnlyKeys(
    event,
    [
      "agePolicyText",
      "arrivalInstructions",
      "attendanceMode",
      "artwork",
      "availabilityState",
      "capacity",
      "category",
      "club",
      "costText",
      "isCancelled",
      "lane",
      "program",
      "rsvpMode",
      "rsvpUrl",
      "schedule",
      "slug",
      "status",
      "summary",
      "title",
      "venue",
      "waitlistAvailable",
    ],
    path,
  );
  if (typeof event.isCancelled !== "boolean") {
    throw new Error("The cached event cancellation state is invalid.");
  }
  const rsvpMode =
    event.rsvpMode === null
      ? null
      : parseEnum(
          event.rsvpMode,
          ["coming_soon", "meetup"] as const,
          `${path}.rsvpMode`,
        );
  const rsvpUrl =
    event.rsvpUrl === null
      ? null
      : parseOfficialMeetupEventUrl(event.rsvpUrl, `${path}.rsvpUrl`);
  if (
    (rsvpMode === "meetup" && rsvpUrl === null) ||
    (rsvpMode !== "meetup" && rsvpUrl !== null)
  ) {
    throw new Error("The cached event RSVP state is invalid.");
  }
  const club = parseNamedEntity(event.club, `${path}.club`, false);
  if (!club) {
    throw new Error("The cached event club is invalid.");
  }
  const status = parseEnum(
    event.status,
    ["cancelled", "completed", "confirmed", "tentative"] as const,
    `${path}.status`,
  );
  if (event.isCancelled !== (status === "cancelled")) {
    throw new Error("The cached event status is inconsistent.");
  }
  return Object.freeze({
    agePolicyText: parseOptionalBoundedString(event.agePolicyText, {
      path: `${path}.agePolicyText`,
      maxLength: 500,
    }),
    arrivalInstructions: parseOptionalBoundedString(
      event.arrivalInstructions,
      { path: `${path}.arrivalInstructions`, maxLength: 4_000 },
    ),
    attendanceMode: parseEnum(
      event.attendanceMode,
      PUBLIC_EVENT_ATTENDANCE_MODES,
      `${path}.attendanceMode`,
    ),
    artwork: parseArtwork(event.artwork, `${path}.artwork`),
    availabilityState:
      event.availabilityState === null
        ? null
        : parseEnum(
            event.availabilityState,
            ["full", "open", "waitlist"] as const,
            `${path}.availabilityState`,
          ),
    capacity:
      event.capacity === null
        ? null
        : parseFiniteInteger(event.capacity, {
            path: `${path}.capacity`,
            minimum: 1,
            maximum: 1_000_000,
          }),
    category: parseNamedEntity(
      event.category,
      `${path}.category`,
      true,
    ),
    club,
    costText: parseOptionalBoundedString(event.costText, {
      path: `${path}.costText`,
      maxLength: 500,
    }),
    isCancelled: event.isCancelled,
    lane: parseNamedEntity(event.lane, `${path}.lane`, false),
    program: parseNamedEntity(event.program, `${path}.program`, false),
    rsvpMode,
    rsvpUrl,
    schedule: parseSchedule(event.schedule, `${path}.schedule`),
    slug: parseIdentifier(event.slug, `${path}.slug`),
    status,
    summary: parseOptionalBoundedString(event.summary, {
      path: `${path}.summary`,
      maxLength: 500,
    }),
    title: parseBoundedString(event.title, {
      path: `${path}.title`,
      maxLength: 200,
    }),
    venue: parseVenue(event.venue, `${path}.venue`),
    waitlistAvailable: parseOptionalBoolean(
      event.waitlistAvailable,
      `${path}.waitlistAvailable`,
    ),
  });
}

function parseNamedEntity(
  value: unknown,
  path: string,
  includeColorToken: boolean,
): Readonly<{
  colorToken: string | null;
  name: string;
  slug: string;
}> | null;
function parseNamedEntity(
  value: unknown,
  path: string,
  includeColorToken: false,
): Readonly<{ name: string; slug: string }> | null;
function parseNamedEntity(
  value: unknown,
  path: string,
  includeColorToken: boolean,
): Readonly<{
  colorToken?: string | null;
  name: string;
  slug: string;
}> | null {
  if (value === null) return null;
  const entity = parseObject(value, path);
  assertOnlyKeys(
    entity,
    includeColorToken ? ["colorToken", "name", "slug"] : ["name", "slug"],
    path,
  );
  return Object.freeze({
    ...(includeColorToken
      ? {
          colorToken: parseOptionalBoundedString(entity.colorToken, {
            path: `${path}.colorToken`,
            maxLength: 64,
          }),
        }
      : {}),
    name: parseBoundedString(entity.name, {
      path: `${path}.name`,
      maxLength: 200,
    }),
    slug: parseIdentifier(entity.slug, `${path}.slug`),
  });
}

function parseVenue(
  value: unknown,
  path: string,
): PublicEventCardDto["venue"] {
  if (value === null) return null;
  const venue = parseObject(value, path);
  assertOnlyKeys(venue, ["address", "floor", "name", "room"], path);
  const floor = parseOptionalBoundedString(venue.floor, {
    path: `${path}.floor`,
    maxLength: 120,
  });
  const room = parseOptionalBoundedString(venue.room, {
    path: `${path}.room`,
    maxLength: 160,
  });
  return Object.freeze({
    address: parseOptionalBoundedString(venue.address, {
      path: `${path}.address`,
      maxLength: 544,
    }),
    floor,
    name: parseBoundedString(venue.name, {
      path: `${path}.name`,
      maxLength: 250,
    }),
    room,
  });
}

function parseOptionalBoolean(value: unknown, path: string): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") {
    throw new Error(`The cached value at ${path} is invalid.`);
  }
  return value;
}

function parseSchedule(
  value: unknown,
  path: string,
): PublicEventCardDto["schedule"] {
  const schedule = parseObject(value, path);
  if (schedule.kind === "timed") {
    assertOnlyKeys(
      schedule,
      ["endsAtUtc", "kind", "startsAtUtc", "timeZone"],
      path,
    );
    const startsAtUtc = parseIsoDateTime(
      schedule.startsAtUtc,
      `${path}.startsAtUtc`,
    );
    const endsAtUtc = parseIsoDateTime(
      schedule.endsAtUtc,
      `${path}.endsAtUtc`,
    );
    if (endsAtUtc <= startsAtUtc) {
      throw new Error("The cached event schedule is invalid.");
    }
    const timeZone = parseBoundedString(schedule.timeZone, {
      path: `${path}.timeZone`,
      maxLength: 100,
    });
    if (!isValidIanaTimeZone(timeZone)) {
      throw new Error("The cached event time zone is invalid.");
    }
    return Object.freeze({
      endsAtUtc,
      kind: "timed" as const,
      startsAtUtc,
      timeZone,
    });
  }
  assertOnlyKeys(
    schedule,
    ["endDateExclusive", "kind", "startDate"],
    path,
  );
  if (schedule.kind !== "all_day") {
    throw new Error("The cached event schedule is invalid.");
  }
  const startDate = parseDate(schedule.startDate, `${path}.startDate`);
  const endDateExclusive = parseDate(
    schedule.endDateExclusive,
    `${path}.endDateExclusive`,
  );
  if (endDateExclusive <= startDate) {
    throw new Error("The cached all-day schedule is invalid.");
  }
  return Object.freeze({
    endDateExclusive,
    kind: "all_day" as const,
    startDate,
  });
}

function parseArtwork(
  value: unknown,
  path: string,
): PublicEventArtworkDto | null {
  if (value === null) return null;
  const artwork = parseObject(value, path);
  assertOnlyKeys(
    artwork,
    ["altText", "credit", "dimensions", "focalPoint", "srcSet", "url"],
    path,
  );
  const dimensions = parseObject(artwork.dimensions, `${path}.dimensions`);
  assertOnlyKeys(dimensions, ["large", "medium", "small"], `${path}.dimensions`);
  const focalPoint = parseObject(artwork.focalPoint, `${path}.focalPoint`);
  assertOnlyKeys(focalPoint, ["x", "y"], `${path}.focalPoint`);
  const srcSet = parseObject(artwork.srcSet, `${path}.srcSet`);
  assertOnlyKeys(srcSet, ["large", "medium", "small"], `${path}.srcSet`);
  return Object.freeze({
    altText: parseOptionalBoundedString(artwork.altText, {
      path: `${path}.altText`,
      maxLength: 300,
    }),
    credit: parseBoundedString(artwork.credit, {
      path: `${path}.credit`,
      maxLength: 300,
      minLength: 0,
      trim: false,
    }),
    dimensions: Object.freeze({
      large: parseDimensions(dimensions.large, `${path}.dimensions.large`),
      medium: parseDimensions(dimensions.medium, `${path}.dimensions.medium`),
      small: parseDimensions(dimensions.small, `${path}.dimensions.small`),
    }),
    focalPoint: Object.freeze({
      x: parseFiniteInteger(focalPoint.x, {
        path: `${path}.focalPoint.x`,
        minimum: 0,
        maximum: 10_000,
      }),
      y: parseFiniteInteger(focalPoint.y, {
        path: `${path}.focalPoint.y`,
        minimum: 0,
        maximum: 10_000,
      }),
    }),
    srcSet: Object.freeze({
      large: parseAssetUrl(srcSet.large, `${path}.srcSet.large`),
      medium: parseAssetUrl(srcSet.medium, `${path}.srcSet.medium`),
      small: parseAssetUrl(srcSet.small, `${path}.srcSet.small`),
    }),
    url: parseAssetUrl(artwork.url, `${path}.url`),
  });
}

function parseDimensions(
  value: unknown,
  path: string,
): Readonly<{ height: number; width: number }> {
  const dimensions = parseObject(value, path);
  assertOnlyKeys(dimensions, ["height", "width"], path);
  return Object.freeze({
    height: parseFiniteInteger(dimensions.height, {
      path: `${path}.height`,
      minimum: 1,
      maximum: 100_000,
    }),
    width: parseFiniteInteger(dimensions.width, {
      path: `${path}.width`,
      minimum: 1,
      maximum: 100_000,
    }),
  });
}

function parseAssetUrl(value: unknown, path: string): string {
  return parseBoundedString(value, {
    path,
    maxLength: 2_048,
    trim: false,
  });
}

function parseIsoDateTime(value: unknown, path: string): string {
  const parsed = parseBoundedString(value, { path, maxLength: 40 });
  const timestamp = Date.parse(parsed);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== parsed
  ) {
    throw new Error("The cached event timestamp is invalid.");
  }
  return parsed;
}

function parseDate(value: unknown, path: string): string {
  const parsed = parseBoundedString(value, { path, maxLength: 10 });
  return parseCalendarDate(parsed, path);
}

function parseMonth(value: unknown, field: string): string {
  const parsed = parseBoundedString(value, {
    path: `snapshot.data.calendar.resolvedMonth.${field}`,
    maxLength: 7,
  });
  if (!MONTH_PATTERN.test(parsed)) {
    throw new Error("The cached calendar month is invalid.");
  }
  return parsed;
}

function assertSuccessfulWrites(
  results: readonly D1ResultLike[] | undefined,
): void {
  if (!results || results.some((result) => result.success === false)) {
    throw new Error("The Events snapshot could not be stored.");
  }
}

function runtimeSourceRevision(): string {
  return typeof __VCC_SOURCE_REVISION__ === "string"
    ? __VCC_SOURCE_REVISION__
    : "development";
}

function writeSnapshotCacheWarning(operation: string): void {
  writeSafeLog("warn", "public_events_snapshot_cache_unavailable", {
    code: "partial_failure",
    operation,
    route: "/events",
    status: 200,
  });
}
