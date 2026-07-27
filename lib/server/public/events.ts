import {
  parseBoundedString,
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  parseOptionalBoundedString,
  validationIssue,
} from "../../validation";
import {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  localDateTimeToUtcMs,
  parseCalendarDate,
} from "../../time";
import { SafeApplicationError } from "../../validation/server-observability";
import { parseOfficialMeetupEventUrl } from "../meetup/url";
import type {
  D1DatabaseLike,
  D1ResultLike,
  D1Value,
} from "../auth";

export type PublicEventDto = Readonly<{
  category: Readonly<{
    colorToken: string | null;
    name: string;
    slug: string;
  }> | null;
  description: string | null;
  isCancelled: boolean;
  organizers: readonly Readonly<{ displayName: string }>[];
  rsvpUrl: string | null;
  schedule:
    | Readonly<{
        endDateExclusive: string;
        kind: "all_day";
        startDate: string;
      }>
    | Readonly<{
        endsAtUtc: string;
        kind: "timed";
        startsAtUtc: string;
        timeZone: string;
      }>;
  slug: string;
  summary: string | null;
  title: string;
  venue: Readonly<{
    address: string | null;
    name: string;
  }> | null;
}>;

export type ListPublicEventsInput = Readonly<{
  fromUtcMs: unknown;
  limit?: unknown;
  organizationId: unknown;
  todayDate: unknown;
}>;

/**
 * Manual/public event projection. Any canonical row with Meetup source-link
 * history is excluded here and may publish only through the source's completed
 * active-generation projection below. Never replace this allowlist with
 * `event.*`, a private domain record, or post-query CSS hiding.
 */
export const PUBLIC_EVENT_SELECT_SQL = `
  SELECT event.slug AS slug,
         event.title AS title,
         event.summary AS summary,
         event.description AS description,
         event.status AS event_status,
         NULL AS rsvp_url,
         event.time_kind AS time_kind,
         event.starts_at_utc AS starts_at_utc,
         event.ends_at_utc AS ends_at_utc,
         event.timezone AS timezone,
         event.all_day_start_date AS all_day_start_date,
         event.all_day_end_date_exclusive AS all_day_end_date_exclusive,
         category.slug AS category_slug,
         category.name AS category_name,
         category.color_token AS category_color_token,
         CASE WHEN venue.is_public = 1
              THEN venue.public_location_name
              ELSE NULL
         END AS venue_public_name,
         CASE WHEN venue.is_public = 1
              THEN venue.public_address
              ELSE NULL
         END AS venue_public_address,
         COALESCE((
           SELECT json_group_array(profile.display_name)
           FROM event_organizers AS public_organizer
           JOIN profiles AS profile
             ON profile.id = public_organizer.profile_id
           WHERE public_organizer.organization_id = event.organization_id
             AND public_organizer.event_id = event.id
             AND public_organizer.is_publicly_listed = 1
             AND public_organizer.deleted_at IS NULL
             AND profile.status = 'active'
             AND profile.deleted_at IS NULL
             AND profile.public_attribution_consent = 1
             AND profile.display_name IS NOT NULL
             AND length(trim(profile.display_name)) > 0
             AND instr(profile.display_name, '@') = 0
             AND lower(trim(profile.display_name)) <>
                 lower(profile.normalized_email)
         ), '[]') AS organizer_names_json
  FROM events AS event
  LEFT JOIN categories AS category
    ON category.id = event.category_id
   AND category.organization_id = event.organization_id
   AND category.deleted_at IS NULL
  LEFT JOIN venues AS venue
    ON venue.id = event.venue_id
   AND venue.organization_id = event.organization_id
   AND venue.deleted_at IS NULL
  WHERE event.organization_id = ?
    AND event.visibility = 'public'
    AND event.status = 'confirmed'
    AND event.published_at IS NOT NULL
    AND event.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM external_source_links AS meetup_source_link
      WHERE meetup_source_link.organization_id = event.organization_id
        AND meetup_source_link.entity_type = 'event'
        AND meetup_source_link.entity_id = event.id
        AND meetup_source_link.source_type = 'meetup_ics'
    )
    AND (
      (event.time_kind = 'timed'
        AND event.ends_at_utc > ?)
      OR
      (event.time_kind = 'all_day'
        AND event.all_day_end_date_exclusive > ?)
    )
  ORDER BY CASE event.time_kind
             WHEN 'timed' THEN event.starts_at_utc
             ELSE 0
           END ASC,
           event.all_day_start_date ASC,
           event.title COLLATE NOCASE ASC
  LIMIT ?
`;

export async function listUpcomingPublicEvents(
  database: Pick<D1DatabaseLike, "prepare">,
  input: ListPublicEventsInput,
): Promise<readonly PublicEventDto[]> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  const fromUtcMs = parseFiniteInteger(input.fromUtcMs, {
    path: "fromUtcMs",
    minimum: 0,
  });
  const todayDate = parseCalendarDate(input.todayDate, "todayDate");
  const limit =
    input.limit === undefined
      ? 50
      : parseFiniteInteger(input.limit, {
          path: "limit",
          minimum: 1,
          maximum: 100,
        });

  const result = await database
    .prepare(PUBLIC_EVENT_SELECT_SQL)
    .bind(organizationId, fromUtcMs, todayDate, limit)
    .all<Record<string, unknown>>();
  assertSuccessfulResult(result);
  return Object.freeze(
    (result.results ?? []).map((row) => toPublicEventDto(row)),
  );
}

/**
 * Meetup Upcoming projection. Explicit cancellations remain durable in D1
 * with provenance but leave this list, matching the public calendar contract.
 */
export const PUBLIC_MEETUP_EVENT_SELECT_SQL = `
  SELECT snapshot.event_slug AS slug,
         snapshot.title AS title,
         event.summary AS summary,
         event.description AS description,
         snapshot.status AS event_status,
         snapshot.event_url AS rsvp_url,
         snapshot.time_kind AS time_kind,
         snapshot.starts_at_utc AS starts_at_utc,
         snapshot.ends_at_utc AS ends_at_utc,
         snapshot.timezone AS timezone,
         snapshot.all_day_start_date AS all_day_start_date,
         snapshot.all_day_end_date_exclusive AS all_day_end_date_exclusive,
         category.slug AS category_slug,
         category.name AS category_name,
         category.color_token AS category_color_token,
         CASE WHEN venue.is_public = 1
              THEN venue.public_location_name
              ELSE NULL
         END AS venue_public_name,
         CASE WHEN venue.is_public = 1
              THEN venue.public_address
              ELSE NULL
         END AS venue_public_address,
         COALESCE((
           SELECT json_group_array(profile.display_name)
           FROM event_organizers AS public_organizer
           JOIN profiles AS profile
             ON profile.id = public_organizer.profile_id
           WHERE public_organizer.organization_id = event.organization_id
             AND public_organizer.event_id = event.id
             AND public_organizer.is_publicly_listed = 1
             AND public_organizer.deleted_at IS NULL
             AND profile.status = 'active'
             AND profile.deleted_at IS NULL
             AND profile.public_attribution_consent = 1
             AND profile.display_name IS NOT NULL
             AND length(trim(profile.display_name)) > 0
             AND instr(profile.display_name, '@') = 0
             AND lower(trim(profile.display_name)) <>
                 lower(profile.normalized_email)
         ), '[]') AS organizer_names_json
  FROM sync_sources AS source
  JOIN meetup_event_snapshots AS snapshot
    ON snapshot.organization_id = source.organization_id
   AND snapshot.sync_source_id = source.id
   AND snapshot.generation_id = source.active_generation_id
  JOIN meetup_sync_generations AS generation
    ON generation.id = source.active_generation_id
   AND generation.organization_id = source.organization_id
   AND generation.sync_source_id = source.id
   AND generation.state = 'published'
   AND generation.published_at IS NOT NULL
   AND generation.processed_item_count = generation.expected_item_count
  JOIN events AS event
    ON event.id = snapshot.event_id
   AND event.organization_id = snapshot.organization_id
  LEFT JOIN categories AS category
    ON category.id = event.category_id
   AND category.organization_id = event.organization_id
   AND category.deleted_at IS NULL
  LEFT JOIN venues AS venue
    ON venue.id = event.venue_id
   AND venue.organization_id = event.organization_id
   AND venue.deleted_at IS NULL
  WHERE source.organization_id = ?
    AND source.source_type = 'meetup_ics'
    AND source.enabled = 1
    AND source.active_generation_id IS NOT NULL
    AND source.last_success_at IS NOT NULL
    AND source.deleted_at IS NULL
    AND event.visibility = 'public'
    AND snapshot.status = 'confirmed'
    AND event.published_at IS NOT NULL
    AND event.deleted_at IS NULL
    AND (
      (snapshot.time_kind = 'timed'
        AND snapshot.ends_at_utc > ?)
      OR
      (snapshot.time_kind = 'all_day'
        AND snapshot.all_day_end_date_exclusive > ?)
    )
  ORDER BY CASE snapshot.time_kind
             WHEN 'timed' THEN snapshot.starts_at_utc
             ELSE 0
           END ASC,
           snapshot.all_day_start_date ASC,
           snapshot.title COLLATE NOCASE ASC
  LIMIT ?
`;

export async function listUpcomingPublicMeetupEvents(
  database: Pick<D1DatabaseLike, "prepare">,
  input: ListPublicEventsInput,
): Promise<readonly PublicEventDto[]> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  const fromUtcMs = parseFiniteInteger(input.fromUtcMs, {
    path: "fromUtcMs",
    minimum: 0,
  });
  const todayDate = parseCalendarDate(input.todayDate, "todayDate");
  const limit =
    input.limit === undefined
      ? 50
      : parseFiniteInteger(input.limit, {
          path: "limit",
          minimum: 1,
          maximum: 100,
        });
  const result = await database
    .prepare(PUBLIC_MEETUP_EVENT_SELECT_SQL)
    .bind(organizationId, fromUtcMs, todayDate, limit)
    .all<Record<string, unknown>>();
  assertSuccessfulResult(result);
  return Object.freeze(
    (result.results ?? []).map((row) => toPublicEventDto(row)),
  );
}

/**
 * Maps only allowlisted fields. Extra/private source properties are ignored,
 * making accidental object-spread leakage impossible.
 */
export function toPublicEventDto(
  row: Record<string, unknown>,
): PublicEventDto {
  const slug = parseIdentifier(row.slug, "event.slug");
  const title = parseBoundedString(row.title, {
    path: "event.title",
    maxLength: 200,
  });
  const summary = parseOptionalBoundedString(row.summary, {
    path: "event.summary",
    maxLength: 500,
  });
  const description = parseOptionalBoundedString(row.description, {
    path: "event.description",
    maxLength: 20_000,
  });
  if (row.event_status !== "confirmed" && row.event_status !== "cancelled") {
    return invalidProjection();
  }
  const isCancelled = row.event_status === "cancelled";
  const rsvpUrl =
    row.rsvp_url === null || row.rsvp_url === undefined
      ? null
      : parseOfficialMeetupEventUrl(row.rsvp_url, "event.rsvpUrl");

  const schedule =
    row.time_kind === "timed"
      ? timedSchedule(row)
      : row.time_kind === "all_day"
        ? allDaySchedule(row)
        : invalidProjection();

  const categoryName = parseOptionalBoundedString(row.category_name, {
    path: "event.category.name",
    maxLength: 120,
  });
  const categorySlug =
    row.category_slug === null || row.category_slug === undefined
      ? null
      : parseIdentifier(row.category_slug, "event.category.slug");
  const category =
    categoryName && categorySlug
      ? Object.freeze({
          colorToken: safeColorToken(row.category_color_token),
          name: categoryName,
          slug: categorySlug,
        })
      : null;

  const venueName = parseOptionalBoundedString(row.venue_public_name, {
    path: "event.venue.name",
    maxLength: 200,
  });
  const venue = venueName
    ? Object.freeze({
        name: venueName,
        address: parseOptionalBoundedString(row.venue_public_address, {
          path: "event.venue.address",
          maxLength: 500,
        }),
      })
    : null;

  return Object.freeze({
    slug,
    title,
    summary,
    description,
    isCancelled,
    rsvpUrl,
    schedule,
    category,
    venue,
    organizers: parsePublicOrganizerNames(row.organizer_names_json),
  });
}

function timedSchedule(
  row: Record<string, unknown>,
): PublicEventDto["schedule"] {
  const startsAtUtcMs = parseFiniteInteger(row.starts_at_utc, {
    path: "event.startsAtUtc",
    minimum: 0,
  });
  const endsAtUtcMs = parseFiniteInteger(row.ends_at_utc, {
    path: "event.endsAtUtc",
    minimum: 0,
  });
  if (endsAtUtcMs <= startsAtUtcMs || !isValidIanaTimeZone(row.timezone)) {
    return invalidProjection();
  }
  return Object.freeze({
    kind: "timed" as const,
    startsAtUtc: new Date(startsAtUtcMs).toISOString(),
    endsAtUtc: new Date(endsAtUtcMs).toISOString(),
    timeZone: row.timezone,
  });
}

function allDaySchedule(
  row: Record<string, unknown>,
): PublicEventDto["schedule"] {
  const startDate = parseCalendarDate(
    row.all_day_start_date,
    "event.startDate",
  );
  const endDateExclusive = parseCalendarDate(
    row.all_day_end_date_exclusive,
    "event.endDateExclusive",
  );
  if (endDateExclusive <= startDate) return invalidProjection();
  return Object.freeze({
    kind: "all_day" as const,
    startDate,
    endDateExclusive,
  });
}

function parsePublicOrganizerNames(
  value: unknown,
): readonly Readonly<{ displayName: string }>[] {
  if (typeof value !== "string" || value.length > 8_192) {
    return invalidProjection();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return invalidProjection();
  }
  if (!Array.isArray(parsed) || parsed.length > 24) {
    return invalidProjection();
  }
  return Object.freeze(
    parsed.map((name, index) =>
      Object.freeze({
        displayName: parseBoundedString(name, {
          path: `event.organizers.${index}.displayName`,
          maxLength: 120,
        }),
      }),
    ),
  );
}

function safeColorToken(value: unknown): string | null {
  const token = parseOptionalBoundedString(value, {
    path: "event.category.colorToken",
    maxLength: 48,
  });
  return token && /^[a-z][a-z0-9-]*$/u.test(token) ? token : null;
}

function invalidProjection(): never {
  throw new SafeApplicationError(
    "internal_error",
    500,
    "Public event data could not be prepared safely.",
  );
}

function assertSinglePublicSlug(row: Record<string, unknown>): void {
  const publicSlugCount = parseFiniteInteger(row.public_slug_count, {
    path: "event.publicSlugCount",
    minimum: 1,
  });
  if (publicSlugCount !== 1) invalidProjection();
}

function optionalPublicText(
  value: unknown,
  path: string,
  maxLength: number,
): string | null {
  return parseOptionalBoundedString(value, { path, maxLength });
}

function optionalPublicHttpsUrl(value: unknown, path: string): string | null {
  const input = parseOptionalBoundedString(value, {
    path,
    maxLength: 2_048,
  });
  if (input === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return invalidProjection();
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return invalidProjection();
  }
  return parsed.toString();
}

function assertSuccessfulResult(
  result: D1ResultLike<Record<string, unknown>>,
): void {
  if (result.success === false) invalidProjection();
}

export const PUBLIC_EVENT_LIST_VIEWS = ["upcoming", "past"] as const;
export const PUBLIC_EVENT_ATTENDANCE_MODES = [
  "in-person",
  "online",
  "hybrid",
  "location-undecided",
] as const;

export type PublicEventListView =
  (typeof PUBLIC_EVENT_LIST_VIEWS)[number];
export type PublicEventAttendanceMode =
  (typeof PUBLIC_EVENT_ATTENDANCE_MODES)[number];
export type PublicEventStatus =
  | "cancelled"
  | "completed"
  | "confirmed"
  | "tentative";
export type PublicEventRsvpMode = "coming_soon" | "meetup" | null;

export type PublicEventCardDto = Readonly<{
  attendanceMode: PublicEventAttendanceMode;
  category: Readonly<{
    colorToken: string | null;
    name: string;
    slug: string;
  }> | null;
  club: Readonly<{
    name: string;
    slug: string;
  }>;
  isCancelled: boolean;
  lane: Readonly<{
    name: string;
    slug: string;
  }> | null;
  rsvpMode: PublicEventRsvpMode;
  rsvpUrl: string | null;
  schedule: PublicEventDto["schedule"];
  slug: string;
  status: PublicEventStatus;
  summary: string | null;
  title: string;
  venue: Readonly<{
    address: string | null;
    name: string;
  }> | null;
}>;

export type PublicEventDetailDto = PublicEventCardDto &
  Readonly<{
    arrivalInstructions: string | null;
    availabilityState: "full" | "open" | "waitlist" | null;
    capacity: number | null;
    costText: string | null;
    description: string | null;
    externalMapUrl: string | null;
    organizers: readonly Readonly<{ displayName: string }>[];
    preparationInformation: string | null;
    publicAccessNote: string | null;
    publicOnlineUrl: string | null;
    verifiedAccessibilityNotes: string | null;
    weatherNote: string | null;
    whatToBring: string | null;
  }>;

export type QueryPublicEventsInput = Readonly<{
  attendanceMode?: unknown;
  categorySlug?: unknown;
  clubSlug?: unknown;
  excludeSlug?: unknown;
  fromDate?: unknown;
  keyword?: unknown;
  laneSlug?: unknown;
  nowUtcMs: unknown;
  organizationId: unknown;
  page?: unknown;
  pageSize?: unknown;
  todayDate: unknown;
  toDate?: unknown;
  view?: unknown;
}>;

export type PublicEventPageDto = Readonly<{
  events: readonly PublicEventCardDto[];
  hasMore: boolean;
  page: number;
  pageSize: number;
  totalCount: number;
  view: PublicEventListView;
}>;

export type GetPublicEventInput = Readonly<{
  organizationId: unknown;
  slug: unknown;
}>;

export type GetAuthorizedOrganizerEventPublicPreviewInput = Readonly<{
  organizationId: unknown;
  organizerEventId: unknown;
}>;

export type ListRelatedPublicEventsInput = GetPublicEventInput &
  Readonly<{
    limit?: unknown;
    nowUtcMs: unknown;
    todayDate: unknown;
  }>;

export type PublicEventSitemapEntry = Readonly<{
  lastModified: string;
  slug: string;
}>;

export type PublicEventCategoryOption = Readonly<{
  name: string;
  slug: string;
}>;

export type ListPublicEventSitemapInput = Readonly<{
  limit?: unknown;
  organizationId: unknown;
}>;

type ParsedPublicEventQuery = Readonly<{
  attendanceMode: PublicEventAttendanceMode | null;
  attendanceModeDatabaseValue: string | null;
  categorySlug: string | null;
  clubSlug: string | null;
  excludeSlug: string | null;
  fromDate: string | null;
  fromUtcMs: number | null;
  keyword: string | null;
  laneSlug: string | null;
  nowUtcMs: number;
  organizationId: string;
  page: number;
  pageSize: number;
  todayDate: string;
  toDate: string | null;
  toDateExclusive: string | null;
  toUtcMsExclusive: number | null;
  view: PublicEventListView;
}>;

/**
 * Shared production projection for every public event surface.
 *
 * The legacy-manual branch permanently excludes canonical rows that have
 * Meetup source-link history. The Meetup branch takes every mutable source
 * fact from a fully published active snapshot, uses `sync_sources.club_id`
 * rather than a pending import's mutable canonical club, and never selects the
 * private feed URL. Its enrichment remains limited to owner-managed facts that
 * the importer does not mutate.
 *
 * The organizer branch reads the one canonical `organizer_events` row directly
 * and joins only Phase 5 public sidecars, a valid publication-state row, and a
 * published club. Source-qualified identities are deduplicated before slug
 * collisions are counted; a collision fails public DTO construction rather
 * than silently ranking one unrelated source above another.
 */
const ORGANIZER_PUBLIC_HOSTS_CTE_SQL = `
  organizer_public_host_candidates AS (
    SELECT public_host.organization_id AS organization_id,
           public_host.organizer_event_id AS organizer_event_id,
           profile.display_name AS organizer_name,
           row_number() OVER (
             PARTITION BY public_host.organization_id,
                          public_host.organizer_event_id
             ORDER BY
               CASE
                 WHEN public_host.profile_id =
                      host_event.primary_organizer_profile_id
                 THEN 0
                 ELSE 1
               END,
               profile.display_name COLLATE NOCASE,
               profile.id
           ) AS organizer_rank
    FROM organizer_event_public_hosts AS public_host
    JOIN organizer_events AS host_event
      ON host_event.organization_id = public_host.organization_id
     AND host_event.id = public_host.organizer_event_id
    JOIN profiles AS profile
      ON profile.id = public_host.profile_id
    JOIN organization_memberships AS membership
      ON membership.organization_id = public_host.organization_id
     AND membership.profile_id = public_host.profile_id
     AND membership.status = 'active'
     AND membership.deleted_at IS NULL
    WHERE profile.status = 'active'
      AND profile.deleted_at IS NULL
      AND profile.public_attribution_consent = 1
      AND profile.display_name IS NOT NULL
      AND length(trim(profile.display_name)) > 0
      AND instr(profile.display_name, '@') = 0
      AND lower(trim(profile.display_name)) <>
          lower(profile.normalized_email)
      AND (
        public_host.profile_id =
          host_event.primary_organizer_profile_id
        OR EXISTS (
          SELECT 1
          FROM organizer_event_organizers AS co_organizer
          WHERE co_organizer.organization_id =
                public_host.organization_id
            AND co_organizer.organizer_event_id =
                public_host.organizer_event_id
            AND co_organizer.profile_id = public_host.profile_id
            AND co_organizer.deleted_at IS NULL
        )
      )
  ),
  organizer_public_host_names AS (
    SELECT organization_id,
           organizer_event_id,
           organizer_names_json
    FROM (
      SELECT organization_id,
             organizer_event_id,
             organizer_rank,
             json_group_array(organizer_name) OVER (
               PARTITION BY organization_id, organizer_event_id
               ORDER BY organizer_rank
               ROWS BETWEEN UNBOUNDED PRECEDING
                        AND UNBOUNDED FOLLOWING
             ) AS organizer_names_json
      FROM organizer_public_host_candidates
      WHERE organizer_rank <= 24
    )
    WHERE organizer_rank = 1
  )
`;

export const UNIFIED_PUBLIC_EVENT_CTE_SQL = `
  WITH ${ORGANIZER_PUBLIC_HOSTS_CTE_SQL},
  manual_public_candidates AS (
    SELECT event.id AS event_id,
           event.organization_id AS organization_id,
           event.club_id AS public_club_id,
           event.slug AS slug,
           event.title AS title,
           event.status AS event_status,
           NULL AS rsvp_url,
           NULL AS rsvp_mode,
           event.time_kind AS time_kind,
           event.starts_at_utc AS starts_at_utc,
           event.ends_at_utc AS ends_at_utc,
           event.timezone AS timezone,
           event.all_day_start_date AS all_day_start_date,
           event.all_day_end_date_exclusive AS all_day_end_date_exclusive,
           event.updated_at AS public_updated_at,
           0 AS source_rank,
           '' AS source_key,
           'legacy:' || event.id AS source_identity_key
    FROM events AS event
    WHERE event.organization_id = ?
      AND event.visibility = 'public'
      AND event.status IN ('confirmed', 'tentative', 'cancelled')
      AND event.published_at IS NOT NULL
      AND event.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM external_source_links AS meetup_source_link
        WHERE meetup_source_link.organization_id = event.organization_id
          AND meetup_source_link.entity_type = 'event'
          AND meetup_source_link.entity_id = event.id
          AND meetup_source_link.source_type = 'meetup_ics'
      )
  ),
  meetup_public_candidates AS (
    SELECT event.id AS event_id,
           event.organization_id AS organization_id,
           source.club_id AS public_club_id,
           snapshot.event_slug AS slug,
           snapshot.title AS title,
           snapshot.status AS event_status,
           snapshot.event_url AS rsvp_url,
           'meetup' AS rsvp_mode,
           snapshot.time_kind AS time_kind,
           snapshot.starts_at_utc AS starts_at_utc,
           snapshot.ends_at_utc AS ends_at_utc,
           snapshot.timezone AS timezone,
           snapshot.all_day_start_date AS all_day_start_date,
           snapshot.all_day_end_date_exclusive AS all_day_end_date_exclusive,
           max(
             snapshot.updated_at,
             generation.published_at
           ) AS public_updated_at,
           1 AS source_rank,
           source.id AS source_key,
           'meetup:' || source.id || ':' || snapshot.external_id
             AS source_identity_key
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
    JOIN events AS event
      ON event.id = snapshot.event_id
     AND event.organization_id = snapshot.organization_id
    WHERE source.organization_id = ?
      AND source.source_type = 'meetup_ics'
      AND source.enabled = 1
      AND source.active_generation_id IS NOT NULL
      AND source.deleted_at IS NULL
      AND event.visibility = 'public'
      AND event.published_at IS NOT NULL
      AND event.deleted_at IS NULL
      AND snapshot.status IN ('confirmed', 'tentative', 'cancelled')
      AND (
        snapshot.status <> 'cancelled'
        OR EXISTS (
          SELECT 1
          FROM meetup_event_snapshots AS previous_snapshot
          JOIN meetup_sync_generations AS previous_generation
            ON previous_generation.id = previous_snapshot.generation_id
           AND previous_generation.organization_id =
               previous_snapshot.organization_id
           AND previous_generation.sync_source_id =
               previous_snapshot.sync_source_id
           AND previous_generation.state = 'published'
           AND previous_generation.published_at IS NOT NULL
           AND previous_generation.processed_item_count =
               previous_generation.expected_item_count
          WHERE previous_snapshot.organization_id = snapshot.organization_id
            AND previous_snapshot.sync_source_id = snapshot.sync_source_id
            AND previous_snapshot.external_id = snapshot.external_id
            AND previous_snapshot.generation_id <> snapshot.generation_id
            AND previous_snapshot.status IN ('confirmed', 'tentative')
        )
      )
  ),
  public_candidates AS (
    SELECT * FROM manual_public_candidates
    UNION ALL
    SELECT * FROM meetup_public_candidates
  ),
  legacy_enriched_public_candidates AS (
    SELECT candidate.*,
           event.summary AS summary,
           event.description AS description,
           COALESCE(
             public_detail.attendance_mode,
             'location_undecided'
           ) AS attendance_mode,
           club.slug AS club_slug,
           club.name AS club_name,
           lane.slug AS lane_slug,
           lane.name AS lane_name,
           category.slug AS category_slug,
           category.name AS category_name,
           category.color_token AS category_color_token,
           CASE WHEN venue.is_public = 1
                THEN venue.public_location_name
                ELSE NULL
           END AS venue_public_name,
           CASE WHEN venue.is_public = 1
                 THEN venue.public_address
                 ELSE NULL
           END AS venue_public_address,
           COALESCE((
             SELECT json_group_array(organizer_name)
             FROM (
               SELECT profile.display_name AS organizer_name
               FROM event_organizers AS public_organizer
               JOIN profiles AS profile
                 ON profile.id = public_organizer.profile_id
               WHERE public_organizer.organization_id =
                     candidate.organization_id
                 AND public_organizer.event_id = candidate.event_id
                 AND public_organizer.is_publicly_listed = 1
                 AND public_organizer.deleted_at IS NULL
                 AND profile.status = 'active'
                 AND profile.deleted_at IS NULL
                 AND profile.public_attribution_consent = 1
                 AND profile.display_name IS NOT NULL
                 AND length(trim(profile.display_name)) > 0
                 AND instr(profile.display_name, '@') = 0
                 AND lower(trim(profile.display_name)) <>
                     lower(profile.normalized_email)
               ORDER BY
                 CASE public_organizer.role
                   WHEN 'primary' THEN 0
                   ELSE 1
                 END,
                 profile.display_name COLLATE NOCASE,
                 profile.id
               LIMIT 24
             )
           ), '[]') AS organizer_names_json,
           NULL AS public_access_note,
           NULL AS public_online_url,
           NULL AS external_map_url,
           NULL AS cost_text,
           NULL AS capacity,
           NULL AS availability_state,
           NULL AS preparation_information,
           NULL AS what_to_bring,
           NULL AS arrival_instructions,
           NULL AS weather_note,
           NULL AS verified_accessibility_notes
    FROM public_candidates AS candidate
    JOIN events AS event
      ON event.id = candidate.event_id
     AND event.organization_id = candidate.organization_id
     AND event.deleted_at IS NULL
    JOIN clubs AS club
      ON club.id = candidate.public_club_id
     AND club.organization_id = candidate.organization_id
     AND club.deleted_at IS NULL
    JOIN club_public_profiles AS club_public
      ON club_public.organization_id = candidate.organization_id
     AND club_public.club_id = candidate.public_club_id
     AND club_public.publication_status = 'published'
     AND club_public.published_at IS NOT NULL
     AND club_public.deleted_at IS NULL
    LEFT JOIN event_public_details AS public_detail
      ON public_detail.organization_id = candidate.organization_id
     AND public_detail.event_id = candidate.event_id
    LEFT JOIN event_lanes AS lane
      ON lane.organization_id = candidate.organization_id
     AND lane.id = COALESCE(
       event.event_lane_id,
       club_public.primary_event_lane_id
     )
     AND lane.deleted_at IS NULL
    LEFT JOIN categories AS category
      ON category.organization_id = candidate.organization_id
     AND category.id = event.category_id
     AND category.deleted_at IS NULL
    LEFT JOIN venues AS venue
      ON venue.organization_id = candidate.organization_id
     AND venue.id = event.venue_id
     AND venue.deleted_at IS NULL
  ),
  organizer_enriched_public_candidates AS (
    SELECT organizer_event.id AS event_id,
           organizer_event.organization_id AS organization_id,
           organizer_event.club_id AS public_club_id,
           organizer_event.slug AS slug,
           organizer_event.title AS title,
           organizer_event.planning_status AS event_status,
           CASE
             WHEN public_detail.rsvp_mode = 'meetup'
              AND public_detail.confirmed_meetup_event_url =
                  organizer_event.meetup_event_url
             THEN public_detail.confirmed_meetup_event_url
             ELSE NULL
           END AS rsvp_url,
           public_detail.rsvp_mode AS rsvp_mode,
           organizer_event.schedule_shape AS time_kind,
           organizer_event.starts_at_utc AS starts_at_utc,
           organizer_event.ends_at_utc AS ends_at_utc,
           organizer_event.timezone AS timezone,
           organizer_event.all_day_start_date AS all_day_start_date,
           organizer_event.all_day_end_date_exclusive
             AS all_day_end_date_exclusive,
           max(
             organizer_event.updated_at,
             public_detail.updated_at,
             publication_state.updated_at
           ) AS public_updated_at,
           2 AS source_rank,
           '' AS source_key,
           'organizer:' || organizer_event.id AS source_identity_key,
           organizer_event.summary AS summary,
           organizer_event.description AS description,
           public_detail.attendance_mode AS attendance_mode,
           club.slug AS club_slug,
           club.name AS club_name,
           lane.slug AS lane_slug,
           lane.name AS lane_name,
           category.slug AS category_slug,
           category.name AS category_name,
           category.color_token AS category_color_token,
           public_detail.public_location_name AS venue_public_name,
           public_detail.public_address AS venue_public_address,
           CASE
             WHEN public_detail.public_hosts_enabled = 1
             THEN COALESCE(host_names.organizer_names_json, '[]')
             ELSE '[]'
           END AS organizer_names_json,
           public_detail.public_access_note AS public_access_note,
           public_detail.public_online_url AS public_online_url,
           public_detail.external_map_url AS external_map_url,
           public_detail.cost_text AS cost_text,
           public_detail.capacity AS capacity,
           public_detail.availability_state AS availability_state,
           public_detail.preparation_information AS preparation_information,
           public_detail.what_to_bring AS what_to_bring,
           public_detail.arrival_instructions AS arrival_instructions,
           public_detail.weather_note AS weather_note,
           public_detail.verified_accessibility_notes
             AS verified_accessibility_notes
    FROM organizer_events AS organizer_event
    JOIN organizer_event_public_details AS public_detail
      ON public_detail.organization_id = organizer_event.organization_id
     AND public_detail.organizer_event_id = organizer_event.id
    JOIN organizer_event_publication_state AS publication_state
      ON publication_state.organization_id = organizer_event.organization_id
     AND publication_state.organizer_event_id = organizer_event.id
     AND publication_state.first_published_at IS NOT NULL
     AND publication_state.most_recent_published_at IS NOT NULL
     AND (
       publication_state.most_recent_unpublished_at IS NULL
       OR publication_state.most_recent_published_at >=
          publication_state.most_recent_unpublished_at
     )
    JOIN clubs AS club
      ON club.id = organizer_event.club_id
     AND club.organization_id = organizer_event.organization_id
     AND club.deleted_at IS NULL
    JOIN club_public_profiles AS club_public
      ON club_public.organization_id = organizer_event.organization_id
     AND club_public.club_id = organizer_event.club_id
     AND club_public.publication_status = 'published'
     AND club_public.published_at IS NOT NULL
     AND club_public.deleted_at IS NULL
    LEFT JOIN event_lanes AS lane
      ON lane.organization_id = organizer_event.organization_id
     AND lane.id = COALESCE(
       organizer_event.event_lane_id,
       club_public.primary_event_lane_id
     )
     AND lane.deleted_at IS NULL
    LEFT JOIN categories AS category
      ON category.organization_id = organizer_event.organization_id
     AND category.id = organizer_event.category_id
     AND category.deleted_at IS NULL
    LEFT JOIN organizer_public_host_names AS host_names
      ON host_names.organization_id = organizer_event.organization_id
     AND host_names.organizer_event_id = organizer_event.id
    WHERE organizer_event.organization_id = ?
      AND organizer_event.publication_status = 'published'
      AND organizer_event.planning_status IN (
        'confirmed',
        'cancelled',
        'completed'
      )
      AND organizer_event.schedule_shape IN ('timed', 'all_day')
      AND organizer_event.deleted_at IS NULL
      AND length(trim(organizer_event.title)) > 0
      AND length(trim(organizer_event.slug)) > 0
      AND length(trim(organizer_event.summary)) > 0
      AND length(trim(organizer_event.description)) > 0
      AND (
        organizer_event.planning_status <> 'cancelled'
        OR publication_state.public_cancellation_at IS NOT NULL
      )
      AND (
        public_detail.rsvp_mode = 'coming_soon'
        OR (
          public_detail.rsvp_mode = 'meetup'
          AND public_detail.confirmed_meetup_event_url =
              organizer_event.meetup_event_url
        )
      )
  ),
  enriched_public_candidates AS (
    SELECT * FROM legacy_enriched_public_candidates
    UNION ALL
    SELECT * FROM organizer_enriched_public_candidates
  ),
  ranked_public_events AS (
    SELECT enriched.*,
           row_number() OVER (
              PARTITION BY enriched.organization_id,
                           enriched.source_identity_key
              ORDER BY
                CASE enriched.event_status
                  WHEN 'confirmed' THEN 0
                  WHEN 'tentative' THEN 1
                  WHEN 'completed' THEN 2
                  ELSE 3
                END,
                enriched.source_rank,
                enriched.source_key
            ) AS duplicate_rank
    FROM enriched_public_candidates AS enriched
  ),
  deduplicated_public_events AS (
    SELECT *
    FROM ranked_public_events
    WHERE duplicate_rank = 1
  ),
  public_events AS (
    SELECT deduplicated.*,
           count(*) OVER (
             PARTITION BY deduplicated.organization_id, deduplicated.slug
           ) AS public_slug_count
    FROM deduplicated_public_events AS deduplicated
  )
`;

const PUBLIC_EVENT_CARD_COLUMNS_SQL = `
  public_event.slug AS slug,
  public_event.title AS title,
  public_event.summary AS summary,
  public_event.event_status AS event_status,
  public_event.rsvp_url AS rsvp_url,
  public_event.rsvp_mode AS rsvp_mode,
  public_event.time_kind AS time_kind,
  public_event.starts_at_utc AS starts_at_utc,
  public_event.ends_at_utc AS ends_at_utc,
  public_event.timezone AS timezone,
  public_event.all_day_start_date AS all_day_start_date,
  public_event.all_day_end_date_exclusive AS all_day_end_date_exclusive,
  public_event.attendance_mode AS attendance_mode,
  public_event.club_slug AS club_slug,
  public_event.club_name AS club_name,
  public_event.lane_slug AS lane_slug,
  public_event.lane_name AS lane_name,
  public_event.category_slug AS category_slug,
  public_event.category_name AS category_name,
  public_event.category_color_token AS category_color_token,
  public_event.venue_public_name AS venue_public_name,
  public_event.venue_public_address AS venue_public_address,
  public_event.public_slug_count AS public_slug_count
`;

const PUBLIC_EVENT_DETAIL_COLUMNS_SQL = `
  public_event.description AS description,
  public_event.organizer_names_json AS organizer_names_json,
  public_event.public_access_note AS public_access_note,
  public_event.public_online_url AS public_online_url,
  public_event.external_map_url AS external_map_url,
  public_event.cost_text AS cost_text,
  public_event.capacity AS capacity,
  public_event.availability_state AS availability_state,
  public_event.preparation_information AS preparation_information,
  public_event.what_to_bring AS what_to_bring,
  public_event.arrival_instructions AS arrival_instructions,
  public_event.weather_note AS weather_note,
  public_event.verified_accessibility_notes AS verified_accessibility_notes
`;

/**
 * This query is deliberately allowlisted and organization/id scoped. The
 * caller must still complete trusted SIWC membership and event authorization
 * before invoking it; the returned shape contains only facts that the live
 * public detail renderer is permitted to receive.
 */
export const AUTHORIZED_ORGANIZER_EVENT_PUBLIC_PREVIEW_SQL = `
  WITH ${ORGANIZER_PUBLIC_HOSTS_CTE_SQL},
  public_event AS (
    SELECT organizer_event.slug AS slug,
           organizer_event.title AS title,
           organizer_event.summary AS summary,
           organizer_event.description AS description,
           organizer_event.planning_status AS event_status,
           CASE
             WHEN public_detail.rsvp_mode = 'meetup'
              AND public_detail.confirmed_meetup_event_url =
                  organizer_event.meetup_event_url
             THEN public_detail.confirmed_meetup_event_url
             ELSE NULL
           END AS rsvp_url,
           public_detail.rsvp_mode AS rsvp_mode,
           organizer_event.schedule_shape AS time_kind,
           organizer_event.starts_at_utc AS starts_at_utc,
           organizer_event.ends_at_utc AS ends_at_utc,
           organizer_event.timezone AS timezone,
           organizer_event.all_day_start_date AS all_day_start_date,
           organizer_event.all_day_end_date_exclusive
             AS all_day_end_date_exclusive,
           public_detail.attendance_mode AS attendance_mode,
           club.slug AS club_slug,
           club.name AS club_name,
           lane.slug AS lane_slug,
           lane.name AS lane_name,
           category.slug AS category_slug,
           category.name AS category_name,
           category.color_token AS category_color_token,
           public_detail.public_location_name AS venue_public_name,
           public_detail.public_address AS venue_public_address,
           1 AS public_slug_count,
           CASE
             WHEN public_detail.public_hosts_enabled = 1
             THEN COALESCE(host_names.organizer_names_json, '[]')
             ELSE '[]'
           END AS organizer_names_json,
           public_detail.public_access_note AS public_access_note,
           public_detail.public_online_url AS public_online_url,
           public_detail.external_map_url AS external_map_url,
           public_detail.cost_text AS cost_text,
           public_detail.capacity AS capacity,
           public_detail.availability_state AS availability_state,
           public_detail.preparation_information AS preparation_information,
           public_detail.what_to_bring AS what_to_bring,
           public_detail.arrival_instructions AS arrival_instructions,
           public_detail.weather_note AS weather_note,
           public_detail.verified_accessibility_notes
             AS verified_accessibility_notes,
           public_detail.public_hosts_enabled
             AS preview_public_hosts_enabled
    FROM organizer_events AS organizer_event
    JOIN organizer_event_public_details AS public_detail
      ON public_detail.organization_id = organizer_event.organization_id
     AND public_detail.organizer_event_id = organizer_event.id
    JOIN clubs AS club
      ON club.id = organizer_event.club_id
     AND club.organization_id = organizer_event.organization_id
     AND club.deleted_at IS NULL
    JOIN club_public_profiles AS club_public
      ON club_public.organization_id = organizer_event.organization_id
     AND club_public.club_id = organizer_event.club_id
     AND club_public.publication_status = 'published'
     AND club_public.published_at IS NOT NULL
     AND club_public.deleted_at IS NULL
    LEFT JOIN event_lanes AS lane
      ON lane.organization_id = organizer_event.organization_id
     AND lane.id = COALESCE(
       organizer_event.event_lane_id,
       club_public.primary_event_lane_id
     )
     AND lane.deleted_at IS NULL
    LEFT JOIN categories AS category
      ON category.organization_id = organizer_event.organization_id
     AND category.id = organizer_event.category_id
     AND category.deleted_at IS NULL
    LEFT JOIN organizer_public_host_names AS host_names
      ON host_names.organization_id = organizer_event.organization_id
     AND host_names.organizer_event_id = organizer_event.id
    WHERE organizer_event.organization_id = ?
      AND organizer_event.id = ?
      AND organizer_event.planning_status IN (
        'confirmed',
        'cancelled',
        'completed'
      )
      AND organizer_event.schedule_shape IN ('timed', 'all_day')
      AND organizer_event.deleted_at IS NULL
      AND length(trim(organizer_event.title)) > 0
      AND length(trim(organizer_event.slug)) > 0
      AND length(trim(organizer_event.summary)) > 0
      AND length(trim(organizer_event.description)) > 0
      AND (
        public_detail.attendance_mode = 'location_undecided'
        OR (
          public_detail.attendance_mode = 'in_person'
          AND length(trim(public_detail.public_location_name)) > 0
        )
        OR (
          public_detail.attendance_mode = 'online'
          AND length(trim(public_detail.public_online_url)) > 0
        )
        OR (
          public_detail.attendance_mode = 'hybrid'
          AND length(trim(public_detail.public_location_name)) > 0
          AND length(trim(public_detail.public_online_url)) > 0
        )
      )
      AND (
        public_detail.rsvp_mode = 'coming_soon'
        OR (
          public_detail.rsvp_mode = 'meetup'
          AND public_detail.confirmed_meetup_event_url =
              organizer_event.meetup_event_url
        )
      )
  )
  SELECT ${PUBLIC_EVENT_CARD_COLUMNS_SQL},
         ${PUBLIC_EVENT_DETAIL_COLUMNS_SQL}
  FROM public_event
  LIMIT 1
`;

/**
 * Validates all public filter inputs before any SQL is assembled. SQL is
 * assembled only from fixed fragments; client values are always bindings.
 */
export function parsePublicEventQuery(
  input: QueryPublicEventsInput,
): ParsedPublicEventQuery {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  const nowUtcMs = parseFiniteInteger(input.nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const todayDate = parseCalendarDate(input.todayDate, "todayDate");
  const view = parseEnum(
    input.view ?? "upcoming",
    PUBLIC_EVENT_LIST_VIEWS,
    "view",
  );
  const page =
    input.page === undefined
      ? 1
      : parseQueryInteger(input.page, {
          path: "page",
          minimum: 1,
          maximum: 1_000,
        });
  const pageSize =
    input.pageSize === undefined
      ? 12
      : parseQueryInteger(input.pageSize, {
          path: "pageSize",
          minimum: 1,
          maximum: 48,
        });
  const keyword = parseOptionalBoundedString(input.keyword, {
    path: "keyword",
    maxLength: 100,
  });
  const clubSlug = optionalIdentifier(input.clubSlug, "clubSlug");
  const laneSlug = optionalIdentifier(input.laneSlug, "laneSlug");
  const categorySlug = optionalIdentifier(input.categorySlug, "categorySlug");
  const excludeSlug = optionalIdentifier(input.excludeSlug, "excludeSlug");
  const attendanceMode =
    input.attendanceMode === undefined ||
    input.attendanceMode === null ||
    input.attendanceMode === ""
      ? null
      : parseEnum(
          input.attendanceMode,
          PUBLIC_EVENT_ATTENDANCE_MODES,
          "attendanceMode",
        );
  const fromDate =
    input.fromDate === undefined ||
    input.fromDate === null ||
    input.fromDate === ""
      ? null
      : parseCalendarDate(input.fromDate, "fromDate");
  const toDate =
    input.toDate === undefined ||
    input.toDate === null ||
    input.toDate === ""
      ? null
      : parseCalendarDate(input.toDate, "toDate");
  if (fromDate && toDate && toDate < fromDate) {
    throw validationIssue(
      "toDate",
      "invalid_date_range",
      "The end date must not be before the start date.",
    );
  }
  const toDateExclusive = toDate ? addCalendarDays(toDate, 1) : null;

  return Object.freeze({
    organizationId,
    nowUtcMs,
    todayDate,
    view,
    page,
    pageSize,
    keyword: keyword?.toLocaleLowerCase("en-CA") ?? null,
    clubSlug,
    laneSlug,
    categorySlug,
    excludeSlug,
    attendanceMode,
    attendanceModeDatabaseValue:
      attendanceMode === null
        ? null
        : attendanceMode.replaceAll("-", "_"),
    fromDate,
    fromUtcMs:
      fromDate === null
        ? null
        : localDateTimeToUtcMs(
            `${fromDate}T00:00`,
            DEFAULT_TIME_ZONE,
            "earlier",
          ),
    toDate,
    toDateExclusive,
    toUtcMsExclusive:
      toDateExclusive === null
        ? null
        : localDateTimeToUtcMs(
            `${toDateExclusive}T00:00`,
            DEFAULT_TIME_ZONE,
            "earlier",
          ),
  });
}

export async function queryPublicEvents(
  database: Pick<D1DatabaseLike, "prepare">,
  input: QueryPublicEventsInput,
): Promise<PublicEventPageDto> {
  const parsed = parsePublicEventQuery(input);
  const filter = buildPublicEventFilter(parsed);
  const commonBindings: D1Value[] = [
    parsed.organizationId,
    parsed.organizationId,
    parsed.organizationId,
    ...filter.bindings,
  ];
  const countRow = await database
    .prepare(
      `${UNIFIED_PUBLIC_EVENT_CTE_SQL}
       SELECT count(*) AS total_count,
              sum(
                CASE WHEN public_event.public_slug_count > 1 THEN 1 ELSE 0 END
              ) AS public_slug_collision_count
       FROM public_events AS public_event
       WHERE ${filter.sql}`,
    )
    .bind(...commonBindings)
    .first<Record<string, unknown>>();
  const totalCount = parseFiniteInteger(countRow?.total_count ?? 0, {
    path: "publicEvents.totalCount",
    minimum: 0,
  });
  const publicSlugCollisionCount = parseFiniteInteger(
    countRow?.public_slug_collision_count ?? 0,
    {
      path: "publicEvents.publicSlugCollisionCount",
      minimum: 0,
    },
  );
  if (publicSlugCollisionCount > 0) invalidProjection();
  const offset = (parsed.page - 1) * parsed.pageSize;
  const result = await database
    .prepare(
      `${UNIFIED_PUBLIC_EVENT_CTE_SQL}
       SELECT ${PUBLIC_EVENT_CARD_COLUMNS_SQL}
       FROM public_events AS public_event
       WHERE ${filter.sql}
       ${publicEventOrderSql(parsed.view)}
       LIMIT ? OFFSET ?`,
    )
    .bind(
      ...commonBindings,
      parsed.pageSize,
      offset,
    )
    .all<Record<string, unknown>>();
  assertSuccessfulResult(result);
  const events = Object.freeze(
    (result.results ?? []).map((row) => toPublicEventCardDto(row)),
  );
  return Object.freeze({
    events,
    totalCount,
    page: parsed.page,
    pageSize: parsed.pageSize,
    hasMore: offset + events.length < totalCount,
    view: parsed.view,
  });
}

export async function getPublicEventBySlug(
  database: Pick<D1DatabaseLike, "prepare">,
  input: GetPublicEventInput,
): Promise<PublicEventDetailDto | null> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  const slug = parseIdentifier(input.slug, "slug");
  const row = await database
    .prepare(
      `${UNIFIED_PUBLIC_EVENT_CTE_SQL}
       SELECT ${PUBLIC_EVENT_CARD_COLUMNS_SQL},
              ${PUBLIC_EVENT_DETAIL_COLUMNS_SQL}
       FROM public_events AS public_event
       WHERE public_event.slug = ?
       LIMIT 1`,
    )
    .bind(organizationId, organizationId, organizationId, slug)
    .first<Record<string, unknown>>();
  return row ? toPublicEventDetailDto(row) : null;
}

export async function getAuthorizedOrganizerEventPublicPreview(
  database: Pick<D1DatabaseLike, "prepare">,
  input: GetAuthorizedOrganizerEventPublicPreviewInput,
): Promise<PublicEventDetailDto | null> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  const organizerEventId = parseIdentifier(
    input.organizerEventId,
    "organizerEventId",
  );
  const row = await database
    .prepare(AUTHORIZED_ORGANIZER_EVENT_PUBLIC_PREVIEW_SQL)
    .bind(organizationId, organizerEventId)
    .first<Record<string, unknown>>();
  return row ? toPublicEventDetailDto(row) : null;
}

/**
 * Uses the exact protected projection and mapper rather than maintaining a
 * looser UI-only approximation. A true result therefore guarantees that the
 * protected preview read can produce the allowlisted DTO for the same scoped
 * organization/event pair at this database state.
 */
export async function hasAuthorizedOrganizerEventPublicPreview(
  database: Pick<D1DatabaseLike, "prepare">,
  input: GetAuthorizedOrganizerEventPublicPreviewInput,
): Promise<boolean> {
  return (
    (await getAuthorizedOrganizerEventPublicPreview(database, input)) !== null
  );
}

export async function listRelatedPublicEvents(
  database: Pick<D1DatabaseLike, "prepare">,
  input: ListRelatedPublicEventsInput,
): Promise<readonly PublicEventCardDto[]> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  const slug = parseIdentifier(input.slug, "slug");
  const nowUtcMs = parseFiniteInteger(input.nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const todayDate = parseCalendarDate(input.todayDate, "todayDate");
  const limit =
    input.limit === undefined
      ? 3
      : parseFiniteInteger(input.limit, {
          path: "limit",
          minimum: 1,
          maximum: 6,
        });
  const result = await database
    .prepare(
      `${UNIFIED_PUBLIC_EVENT_CTE_SQL},
       target_event AS (
         SELECT club_slug, category_slug
         FROM public_events
         WHERE slug = ?
         LIMIT 1
       )
       SELECT ${PUBLIC_EVENT_CARD_COLUMNS_SQL}
       FROM public_events AS public_event
       JOIN target_event
         ON (
           public_event.club_slug = target_event.club_slug
           OR (
             target_event.category_slug IS NOT NULL
             AND public_event.category_slug = target_event.category_slug
           )
         )
       WHERE public_event.slug <> ?
         AND public_event.event_status IN ('confirmed', 'tentative')
         AND (
           (
             public_event.time_kind = 'timed'
             AND public_event.ends_at_utc > ?
           )
           OR (
             public_event.time_kind = 'all_day'
             AND public_event.all_day_end_date_exclusive > ?
           )
         )
       ORDER BY
         CASE WHEN public_event.club_slug = target_event.club_slug
              THEN 0 ELSE 1 END,
         ${publicEventSortExpression("public_event")} ASC,
         public_event.title COLLATE NOCASE ASC,
         public_event.slug ASC
       LIMIT ?`,
    )
    .bind(
      organizationId,
      organizationId,
      organizationId,
      slug,
      slug,
      nowUtcMs,
      todayDate,
      limit,
    )
    .all<Record<string, unknown>>();
  assertSuccessfulResult(result);
  return Object.freeze(
    (result.results ?? []).map((row) => toPublicEventCardDto(row)),
  );
}

export async function listPublicEventSitemapEntries(
  database: Pick<D1DatabaseLike, "prepare">,
  input: ListPublicEventSitemapInput,
): Promise<readonly PublicEventSitemapEntry[]> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  const limit =
    input.limit === undefined
      ? 5_000
      : parseFiniteInteger(input.limit, {
          path: "limit",
          minimum: 1,
          maximum: 5_000,
        });
  const result = await database
    .prepare(
      `${UNIFIED_PUBLIC_EVENT_CTE_SQL}
       SELECT public_event.slug AS slug,
               public_event.public_updated_at AS public_updated_at,
               public_event.public_slug_count AS public_slug_count
       FROM public_events AS public_event
       ORDER BY public_event.slug ASC
       LIMIT ?`,
    )
    .bind(organizationId, organizationId, organizationId, limit)
    .all<Record<string, unknown>>();
  assertSuccessfulResult(result);
  return Object.freeze(
    (result.results ?? []).map((row) => {
      assertSinglePublicSlug(row);
      const updatedAt = parseFiniteInteger(row.public_updated_at, {
        path: "publicEvent.updatedAt",
        minimum: 0,
      });
      return Object.freeze({
        slug: parseIdentifier(row.slug, "publicEvent.slug"),
        lastModified: new Date(updatedAt).toISOString(),
      });
    }),
  );
}

export async function listPublicEventSitemapSlugs(
  database: Pick<D1DatabaseLike, "prepare">,
  input: ListPublicEventSitemapInput,
): Promise<readonly string[]> {
  const entries = await listPublicEventSitemapEntries(database, input);
  return Object.freeze(entries.map((entry) => entry.slug));
}

export async function listPublicEventCategoryOptions(
  database: Pick<D1DatabaseLike, "prepare">,
  organizationIdInput: unknown,
): Promise<readonly PublicEventCategoryOption[]> {
  const organizationId = parseIdentifier(
    organizationIdInput,
    "organizationId",
  );
  const result = await database
    .prepare(
      `${UNIFIED_PUBLIC_EVENT_CTE_SQL}
       SELECT DISTINCT public_event.category_slug AS slug,
                       public_event.category_name AS name
       FROM public_events AS public_event
       WHERE public_event.event_status IN ('confirmed', 'tentative')
         AND public_event.category_slug IS NOT NULL
         AND public_event.category_name IS NOT NULL
       ORDER BY public_event.category_name COLLATE NOCASE ASC,
                public_event.category_slug ASC
       LIMIT 100`,
    )
    .bind(organizationId, organizationId, organizationId)
    .all<Record<string, unknown>>();
  assertSuccessfulResult(result);
  return Object.freeze(
    (result.results ?? []).map((row) =>
      Object.freeze({
        name: parseBoundedString(row.name, {
          path: "publicEventCategory.name",
          maxLength: 120,
        }),
        slug: parseIdentifier(row.slug, "publicEventCategory.slug"),
      }),
    ),
  );
}

export function toPublicEventCardDto(
  row: Record<string, unknown>,
): PublicEventCardDto {
  assertSinglePublicSlug(row);
  const status = parseEnum(
    row.event_status,
    ["confirmed", "tentative", "cancelled", "completed"] as const,
    "event.status",
  );
  const attendanceMode = publicAttendanceMode(row.attendance_mode);
  const category = publicCategory(row);
  const venue = publicVenue(row);
  const rsvpMode =
    row.rsvp_mode === null || row.rsvp_mode === undefined
      ? null
      : parseEnum(
          row.rsvp_mode,
          ["meetup", "coming_soon"] as const,
          "event.rsvpMode",
        );
  const rsvpUrl =
    row.rsvp_url === null || row.rsvp_url === undefined
      ? null
      : parseOfficialMeetupEventUrl(row.rsvp_url, "event.rsvpUrl");
  if (
    (rsvpMode === "meetup" && rsvpUrl === null) ||
    (rsvpMode !== "meetup" && rsvpUrl !== null)
  ) {
    return invalidProjection();
  }
  return Object.freeze({
    slug: parseIdentifier(row.slug, "event.slug"),
    title: parseBoundedString(row.title, {
      path: "event.title",
      maxLength: 200,
    }),
    summary: parseOptionalBoundedString(row.summary, {
      path: "event.summary",
      maxLength: 500,
    }),
    status,
    isCancelled: status === "cancelled",
    rsvpMode,
    rsvpUrl,
    schedule:
      row.time_kind === "timed"
        ? timedSchedule(row)
        : row.time_kind === "all_day"
          ? allDaySchedule(row)
          : invalidProjection(),
    attendanceMode,
    club: Object.freeze({
      slug: parseIdentifier(row.club_slug, "event.club.slug"),
      name: parseBoundedString(row.club_name, {
        path: "event.club.name",
        maxLength: 160,
      }),
    }),
    lane: publicLane(row),
    category,
    venue,
  });
}

export function toPublicEventDetailDto(
  row: Record<string, unknown>,
): PublicEventDetailDto {
  const card = toPublicEventCardDto(row);
  return Object.freeze({
    ...card,
    description: parseOptionalBoundedString(row.description, {
      path: "event.description",
      maxLength: 20_000,
    }),
    organizers: parsePublicOrganizerNames(row.organizer_names_json),
    publicAccessNote: optionalPublicText(
      row.public_access_note,
      "event.publicAccessNote",
      2_000,
    ),
    publicOnlineUrl: optionalPublicHttpsUrl(
      row.public_online_url,
      "event.publicOnlineUrl",
    ),
    externalMapUrl: optionalPublicHttpsUrl(
      row.external_map_url,
      "event.externalMapUrl",
    ),
    costText: optionalPublicText(row.cost_text, "event.costText", 500),
    capacity:
      row.capacity === null || row.capacity === undefined
        ? null
        : parseFiniteInteger(row.capacity, {
            path: "event.capacity",
            minimum: 1,
            maximum: 1_000_000,
          }),
    availabilityState:
      row.availability_state === null ||
      row.availability_state === undefined
        ? null
        : parseEnum(
            row.availability_state,
            ["open", "full", "waitlist"] as const,
            "event.availabilityState",
          ),
    preparationInformation: optionalPublicText(
      row.preparation_information,
      "event.preparationInformation",
      4_000,
    ),
    whatToBring: optionalPublicText(
      row.what_to_bring,
      "event.whatToBring",
      4_000,
    ),
    arrivalInstructions: optionalPublicText(
      row.arrival_instructions,
      "event.arrivalInstructions",
      4_000,
    ),
    weatherNote: optionalPublicText(
      row.weather_note,
      "event.weatherNote",
      2_000,
    ),
    verifiedAccessibilityNotes: optionalPublicText(
      row.verified_accessibility_notes,
      "event.verifiedAccessibilityNotes",
      4_000,
    ),
  });
}

function buildPublicEventFilter(
  input: ParsedPublicEventQuery,
): Readonly<{ bindings: readonly D1Value[]; sql: string }> {
  const clauses: string[] = [
    input.view === "upcoming"
      ? "public_event.event_status IN ('confirmed', 'tentative')"
      : "public_event.event_status IN ('confirmed', 'tentative', 'completed')",
  ];
  const bindings: D1Value[] = [];

  if (input.view === "upcoming") {
    clauses.push(`(
      (
        public_event.time_kind = 'timed'
        AND public_event.ends_at_utc > ?
      )
      OR (
        public_event.time_kind = 'all_day'
        AND public_event.all_day_end_date_exclusive > ?
      )
    )`);
    bindings.push(input.nowUtcMs, input.todayDate);
  } else {
    clauses.push(`(
      (
        public_event.time_kind = 'timed'
        AND public_event.ends_at_utc <= ?
      )
      OR (
        public_event.time_kind = 'all_day'
        AND public_event.all_day_end_date_exclusive <= ?
      )
    )`);
    bindings.push(input.nowUtcMs, input.todayDate);
  }

  if (input.keyword !== null) {
    clauses.push(`(
      instr(lower(public_event.title), ?) > 0
      OR instr(lower(COALESCE(public_event.summary, '')), ?) > 0
      OR instr(lower(COALESCE(public_event.description, '')), ?) > 0
      OR instr(lower(public_event.club_name), ?) > 0
    )`);
    bindings.push(
      input.keyword,
      input.keyword,
      input.keyword,
      input.keyword,
    );
  }
  addEqualityFilter(clauses, bindings, "club_slug", input.clubSlug);
  addEqualityFilter(clauses, bindings, "lane_slug", input.laneSlug);
  addEqualityFilter(
    clauses,
    bindings,
    "category_slug",
    input.categorySlug,
  );
  addEqualityFilter(
    clauses,
    bindings,
    "attendance_mode",
    input.attendanceModeDatabaseValue,
  );
  if (input.excludeSlug !== null) {
    clauses.push("public_event.slug <> ?");
    bindings.push(input.excludeSlug);
  }
  if (input.fromDate !== null && input.fromUtcMs !== null) {
    clauses.push(`(
      (
        public_event.time_kind = 'timed'
        AND public_event.ends_at_utc > ?
      )
      OR (
        public_event.time_kind = 'all_day'
        AND public_event.all_day_end_date_exclusive > ?
      )
    )`);
    bindings.push(input.fromUtcMs, input.fromDate);
  }
  if (
    input.toDateExclusive !== null &&
    input.toUtcMsExclusive !== null
  ) {
    clauses.push(`(
      (
        public_event.time_kind = 'timed'
        AND public_event.starts_at_utc < ?
      )
      OR (
        public_event.time_kind = 'all_day'
        AND public_event.all_day_start_date < ?
      )
    )`);
    bindings.push(input.toUtcMsExclusive, input.toDateExclusive);
  }
  return Object.freeze({
    bindings: Object.freeze(bindings),
    sql: clauses.join("\nAND "),
  });
}

function addEqualityFilter(
  clauses: string[],
  bindings: D1Value[],
  column: "attendance_mode" | "category_slug" | "club_slug" | "lane_slug",
  value: string | null,
): void {
  if (value === null) return;
  clauses.push(`public_event.${column} = ?`);
  bindings.push(value);
}

function publicEventOrderSql(view: PublicEventListView): string {
  const direction = view === "upcoming" ? "ASC" : "DESC";
  return `ORDER BY
    ${publicEventSortExpression("public_event")} ${direction},
    public_event.title COLLATE NOCASE ${direction},
    public_event.slug ${direction}`;
}

function publicEventSortExpression(alias: string): string {
  return `CASE ${alias}.time_kind
    WHEN 'timed' THEN ${alias}.starts_at_utc
    ELSE (
      CAST(strftime(
        '%s',
        ${alias}.all_day_start_date || 'T12:00:00Z'
      ) AS INTEGER) * 1000
    )
  END`;
}

function optionalIdentifier(value: unknown, path: string): string | null {
  return value === undefined || value === null || value === ""
    ? null
    : parseIdentifier(value, path);
}

function parseQueryInteger(
  value: unknown,
  options: Readonly<{
    maximum: number;
    minimum: number;
    path: string;
  }>,
): number {
  const candidate =
    typeof value === "string" && /^[0-9]+$/u.test(value)
      ? Number(value)
      : value;
  return parseFiniteInteger(candidate, options);
}

function addCalendarDays(value: string, days: number): string {
  const parsed = parseCalendarDate(value);
  const date = new Date(`${parsed}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function publicAttendanceMode(value: unknown): PublicEventAttendanceMode {
  const databaseValue = parseEnum(
    value,
    ["in_person", "online", "hybrid", "location_undecided"] as const,
    "event.attendanceMode",
  );
  return databaseValue.replaceAll("_", "-") as PublicEventAttendanceMode;
}

function publicCategory(
  row: Record<string, unknown>,
): PublicEventCardDto["category"] {
  const name = parseOptionalBoundedString(row.category_name, {
    path: "event.category.name",
    maxLength: 120,
  });
  const slug =
    row.category_slug === null || row.category_slug === undefined
      ? null
      : parseIdentifier(row.category_slug, "event.category.slug");
  return name && slug
    ? Object.freeze({
        name,
        slug,
        colorToken: safeColorToken(row.category_color_token),
      })
    : null;
}

function publicLane(
  row: Record<string, unknown>,
): PublicEventCardDto["lane"] {
  const name = parseOptionalBoundedString(row.lane_name, {
    path: "event.lane.name",
    maxLength: 120,
  });
  const slug =
    row.lane_slug === null || row.lane_slug === undefined
      ? null
      : parseIdentifier(row.lane_slug, "event.lane.slug");
  return name && slug ? Object.freeze({ name, slug }) : null;
}

function publicVenue(
  row: Record<string, unknown>,
): PublicEventCardDto["venue"] {
  const name = parseOptionalBoundedString(row.venue_public_name, {
    path: "event.venue.name",
    maxLength: 250,
  });
  return name
    ? Object.freeze({
        name,
        address: parseOptionalBoundedString(row.venue_public_address, {
          path: "event.venue.address",
          maxLength: 500,
        }),
      })
    : null;
}
