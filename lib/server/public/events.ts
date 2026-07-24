import {
  parseBoundedString,
  parseFiniteInteger,
  parseIdentifier,
  parseOptionalBoundedString,
} from "../../validation";
import {
  isValidIanaTimeZone,
  parseCalendarDate,
} from "../../time";
import { SafeApplicationError } from "../../validation/server-observability";
import { parseOfficialMeetupEventUrl } from "../meetup/url";
import type {
  D1DatabaseLike,
  D1ResultLike,
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
 * An explicit column allowlist. Never replace this with `event.*`, a private
 * domain record, or post-query CSS hiding.
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

function assertSuccessfulResult(
  result: D1ResultLike<Record<string, unknown>>,
): void {
  if (result.success === false) invalidProjection();
}
