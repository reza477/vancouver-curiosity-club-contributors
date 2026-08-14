import {
  parseBoundedString,
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  parseOptionalBoundedString,
  validationIssue,
} from "../../validation";
import { protectedLegalClaimSql } from "../../validation/protected-legal-claims";
import { publicOrganizerEmailExposureSql } from "../../validation/public-organizer-email";
import {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  localDateTimeToUtcMs,
  parseCalendarDate,
} from "../../time";
import { SafeApplicationError } from "../../validation/server-observability";
import { parseOfficialMeetupEventUrl } from "../meetup/url";
import { MEETUP_EVENT_ALIAS_URLS } from "../meetup/event-aliases";
import { SYNCHRONIZED_MEETUP_POSTER_VARIANTS } from "../meetup/posters";
import type {
  D1DatabaseLike,
  D1ResultLike,
  D1Value,
} from "../auth";
import {
  publicClubProjectionParityD1Sql,
  publicProgramProjectionParityD1Sql,
} from "./cms-projection-contract";
import { currentPublishedOrganizerProfilePhotoUsageTargetSql } from "../media/public-usage-contract";
import {
  curatedMeetupPosterForEventUrl,
  curatedMeetupPosterForSourceUrl,
} from "../../meetup-event-posters";
import {
  curatedMeetupEventForEventUrl,
  meetupDescriptionBlocksToPlainText,
  type CuratedMeetupDescriptionBlock,
  type CuratedMeetupEventEnrichment,
  validateMeetupDescriptionBlocks,
} from "../../meetup-event-enrichment";
import { PUBLIC_EVENT_LANE_SLUGS } from "../../public-event-lanes";

export type PublicEventDto = Readonly<{
  category: Readonly<{
    colorToken: string | null;
    name: string;
    slug: string;
  }> | null;
  description: string | null;
  isCancelled: boolean;
  organizers: readonly PublicEventOrganizerDto[];
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

export type PublicEventOrganizerDto = Readonly<{
  biography?: string | null;
  displayName: string;
  photo?: Readonly<{
    altText: string;
    credit: string;
    height: number;
    url: string;
    width: number;
  }> | null;
}>;

const MAX_PUBLIC_ORGANIZERS = 24;
const MAX_PUBLIC_ORGANIZER_NAME_LENGTH = 120;
const PUBLIC_MEETUP_ALIAS_EXCLUSION_SQL = `snapshot.event_url NOT IN (${MEETUP_EVENT_ALIAS_URLS.map(
  (eventUrl) => `'${eventUrl.replaceAll("'", "''")}'`,
).join(", ")})`;
const MAX_PUBLIC_ORGANIZER_BIOGRAPHY_LENGTH = 800;
const MAX_PUBLIC_ORGANIZER_MEDIA_ID_LENGTH = 128;
const MAX_PUBLIC_ORGANIZER_ALT_LENGTH = 300;
const MAX_PUBLIC_ORGANIZER_CREDIT_LENGTH = 300;
const JSON_WORST_CASE_ESCAPE_FACTOR = 6;
const PUBLIC_ORGANIZER_JSON_FIELD_OVERHEAD = 320;
export const MAX_PUBLIC_ORGANIZERS_JSON_BYTES =
  2 +
  MAX_PUBLIC_ORGANIZERS *
    (
      JSON_WORST_CASE_ESCAPE_FACTOR *
        (
          MAX_PUBLIC_ORGANIZER_NAME_LENGTH +
          MAX_PUBLIC_ORGANIZER_BIOGRAPHY_LENGTH +
          MAX_PUBLIC_ORGANIZER_MEDIA_ID_LENGTH +
          MAX_PUBLIC_ORGANIZER_ALT_LENGTH +
          MAX_PUBLIC_ORGANIZER_CREDIT_LENGTH
        ) +
      PUBLIC_ORGANIZER_JSON_FIELD_OVERHEAD +
      1
    );

export type ListPublicEventsInput = Readonly<{
  fromUtcMs: unknown;
  limit?: unknown;
  organizationId: unknown;
  todayDate: unknown;
}>;

function legacyPublicOrganizersSql(
  organizationIdSql: string,
  eventIdSql: string,
): string {
  return `COALESCE((
    SELECT organizer_names_json
    FROM (
      SELECT json_group_array(json(organizer_json))
             AS organizer_names_json
      FROM (
        SELECT json_object(
               'displayName', receipt.display_name,
               'biography', receipt.biography,
               'photoAssetId',
                 CASE
                   WHEN profile_photo_usage.id IS NOT NULL
                    AND profile_photo_detail.asset_id IS NOT NULL
                    AND profile_photo_variant.id IS NOT NULL
                   THEN profile_photo_asset.id
                   ELSE NULL
                 END,
               'photoAltText',
                 CASE
                   WHEN profile_photo_usage.id IS NOT NULL
                    AND profile_photo_detail.asset_id IS NOT NULL
                    AND profile_photo_variant.id IS NOT NULL
                   THEN profile_photo_asset.alt_text
                   ELSE NULL
                 END,
               'photoCredit',
                 CASE
                   WHEN profile_photo_usage.id IS NOT NULL
                    AND profile_photo_detail.asset_id IS NOT NULL
                    AND profile_photo_variant.id IS NOT NULL
                   THEN profile_photo_asset.credit
                   ELSE NULL
                 END,
               'photoWidth',
                 CASE
                   WHEN profile_photo_usage.id IS NOT NULL
                    AND profile_photo_detail.asset_id IS NOT NULL
                    AND profile_photo_variant.id IS NOT NULL
                   THEN profile_photo_variant.width
                   ELSE NULL
                 END,
               'photoHeight',
                 CASE
                   WHEN profile_photo_usage.id IS NOT NULL
                    AND profile_photo_detail.asset_id IS NOT NULL
                    AND profile_photo_variant.id IS NOT NULL
                   THEN profile_photo_variant.height
                   ELSE NULL
                 END
               ) AS organizer_json
        FROM event_organizers AS public_organizer
      JOIN profiles AS profile
        ON profile.id = public_organizer.profile_id
      JOIN organizer_public_attribution_states AS attribution
        ON attribution.profile_id = profile.id
       AND attribution.organization_id =
           public_organizer.organization_id
       AND attribution.workflow_status = 'confirmed'
      JOIN organizer_public_attribution_receipts AS receipt
        ON receipt.id = attribution.current_receipt_id
       AND receipt.organization_id = attribution.organization_id
       AND receipt.profile_id = attribution.profile_id
       AND receipt.action IN ('adopted', 'confirmed')
       AND receipt.attribution_version =
           attribution.published_attribution_version
       AND receipt.consent = 1
       AND receipt.display_name = attribution.public_display_name
       AND receipt.biography IS attribution.public_biography
       AND receipt.photo_media_asset_id IS
           attribution.public_photo_media_asset_id
       AND receipt.actor_profile_id = attribution.profile_id
      JOIN organizer_public_attribution_write_intents AS intent
        ON intent.id = receipt.write_intent_id
       AND intent.organization_id = attribution.organization_id
       AND intent.profile_id = attribution.profile_id
       AND intent.actor_profile_id = attribution.profile_id
       AND intent.operation = receipt.action
       AND intent.proposed_published_version =
           receipt.attribution_version
       AND intent.snapshot_hash = receipt.snapshot_hash
       AND intent.completed_at IS NOT NULL
      JOIN organization_memberships AS host_membership
        ON host_membership.organization_id =
           attribution.organization_id
       AND host_membership.profile_id = attribution.profile_id
       AND host_membership.status = 'active'
       AND host_membership.deleted_at IS NULL
      LEFT JOIN media_usage_references AS profile_photo_usage
        ON profile_photo_usage.organization_id =
           attribution.organization_id
       AND profile_photo_usage.asset_id =
           receipt.photo_media_asset_id
       AND profile_photo_usage.entity_type = 'organizer_profile'
       AND profile_photo_usage.entity_id = attribution.profile_id
       AND profile_photo_usage.revision_id = receipt.id
       AND profile_photo_usage.usage_kind = 'profile_photo'
       AND profile_photo_usage.publication_scope = 'published'
       AND profile_photo_usage.deleted_at IS NULL
       AND ${currentPublishedOrganizerProfilePhotoUsageTargetSql(
         "profile_photo_usage",
       )}
      LEFT JOIN media_assets AS profile_photo_asset
        ON profile_photo_asset.id = profile_photo_usage.asset_id
       AND profile_photo_asset.organization_id =
           profile_photo_usage.organization_id
       AND profile_photo_asset.deleted_at IS NULL
       AND profile_photo_asset.rights_status = 'approved'
       AND profile_photo_asset.participant_consent_status
           IN ('not_applicable', 'confirmed')
       AND length(trim(COALESCE(profile_photo_asset.alt_text, '')))
           BETWEEN 1 AND 300
       AND length(trim(COALESCE(profile_photo_asset.credit, '')))
           BETWEEN 1 AND 300
      LEFT JOIN media_asset_details AS profile_photo_detail
        ON profile_photo_detail.asset_id = profile_photo_asset.id
       AND profile_photo_detail.organization_id =
           profile_photo_asset.organization_id
       AND profile_photo_detail.upload_state = 'ready'
       AND NOT (${protectedLegalClaimSql([
         "profile_photo_asset.alt_text",
         "profile_photo_asset.credit",
         "profile_photo_detail.caption",
       ])})
       AND NOT (${publicOrganizerEmailExposureSql(
         [
           "profile_photo_asset.alt_text",
           "profile_photo_asset.credit",
           "profile_photo_detail.caption",
         ],
         "profile_photo_asset.organization_id",
       )})
      LEFT JOIN media_asset_variants AS profile_photo_variant
        ON profile_photo_variant.asset_id = profile_photo_asset.id
       AND profile_photo_variant.organization_id =
           profile_photo_asset.organization_id
       AND profile_photo_variant.variant_kind = 'webp_480'
       AND profile_photo_variant.state = 'ready'
      WHERE public_organizer.organization_id = ${organizationIdSql}
        AND public_organizer.event_id = ${eventIdSql}
        AND public_organizer.is_publicly_listed = 1
        AND public_organizer.deleted_at IS NULL
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
        AND profile.public_attribution_consent = 1
        AND profile.display_name = attribution.public_display_name
        AND length(trim(attribution.public_display_name)) > 0
        AND instr(attribution.public_display_name, '@') = 0
        AND lower(trim(attribution.public_display_name)) <>
            lower(profile.normalized_email)
        AND NOT (${protectedLegalClaimSql([
          "attribution.public_display_name",
          "attribution.public_biography",
        ])})
        AND NOT (${publicOrganizerEmailExposureSql(
          ["attribution.public_display_name", "attribution.public_biography"],
          "attribution.organization_id",
        )})
      ORDER BY
        CASE public_organizer.role WHEN 'primary' THEN 0 ELSE 1 END,
        receipt.display_name COLLATE NOCASE,
        receipt.profile_id
        LIMIT ${MAX_PUBLIC_ORGANIZERS}
      )
    )
    WHERE length(CAST(organizer_names_json AS BLOB)) <=
          ${MAX_PUBLIC_ORGANIZERS_JSON_BYTES}
  ), '[]')`;
}

/**
 * Manual/public event projection. Any canonical row with Meetup source-link
 * history is excluded here and may publish only through the source's completed
 * active-generation projection below. Never replace this allowlist with
 * `event.*`, a private domain record, or post-query CSS hiding.
 */
export const PUBLIC_EVENT_SELECT_SQL = `
  SELECT event.slug AS slug,
         'legacy:' || event.id AS public_source_identity_key,
         event.updated_at AS public_source_version,
         COALESCE(
           ${cmsProjectionVersionTokenSql(
             "event.organization_id",
             "club_public_profile",
             "event.club_id",
           )},
           json_array(
             'legacy',
             public_club.name,
             public_club.slug,
             public_club.updated_at,
             public_club_profile.updated_at,
             public_club_detail.updated_at
           )
         ) AS public_club_projection_token,
         CASE
           WHEN public_program.publication_status IN (
                  'published', 'archived'
                )
            AND public_program.published_at IS NOT NULL
            AND public_program.deleted_at IS NULL
           THEN COALESCE(
             ${cmsProjectionVersionTokenSql(
               "event.organization_id",
               "program_public_profile",
               "event.program_id",
             )},
             json_array(
               'legacy',
               program.name,
               program.slug,
               program.updated_at,
               public_program.public_display_name,
               public_program.public_slug,
               public_program.updated_at
             )
           )
           ELSE NULL
         END AS public_program_projection_token,
         event.id AS artwork_event_id,
         1 AS public_slug_count,
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
         '[]' AS organizer_names_json
  FROM events AS event
  JOIN clubs AS public_club
    ON public_club.id = event.club_id
   AND public_club.organization_id = event.organization_id
   AND public_club.deleted_at IS NULL
  JOIN club_public_profiles AS public_club_profile
    ON public_club_profile.club_id = event.club_id
   AND public_club_profile.organization_id = event.organization_id
  LEFT JOIN club_public_profile_details AS public_club_detail
    ON public_club_detail.club_id = event.club_id
   AND public_club_detail.organization_id = event.organization_id
  LEFT JOIN programs AS program
    ON program.id = event.program_id
   AND program.organization_id = event.organization_id
   AND program.deleted_at IS NULL
  LEFT JOIN program_public_profile_details AS public_program
    ON public_program.program_id = event.program_id
   AND public_program.organization_id = event.organization_id
   AND public_program.club_id = event.club_id
  LEFT JOIN categories AS category
    ON category.id = event.category_id
   AND category.organization_id = event.organization_id
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
  const enrichedRows = await enrichCompatibilityPublicEventRows(
    database,
    organizationId,
    result.results ?? [],
  );
  return Object.freeze(enrichedRows.map((row) => toPublicEventDto(row)));
}

/**
 * Meetup Upcoming projection. Explicit cancellations remain durable in D1
 * with provenance but leave this list, matching the public calendar contract.
 */
export const PUBLIC_MEETUP_EVENT_SELECT_SQL = `
  SELECT snapshot.event_slug AS slug,
         'meetup:' || source.id || ':' || snapshot.external_id
           AS public_source_identity_key,
         max(snapshot.updated_at, generation.published_at)
           AS public_source_version,
         COALESCE(
           ${cmsProjectionVersionTokenSql(
             "event.organization_id",
             "club_public_profile",
             "event.club_id",
           )},
           json_array(
             'legacy',
             public_club.name,
             public_club.slug,
             public_club.updated_at,
             public_club_profile.updated_at,
             public_club_detail.updated_at
           )
         ) AS public_club_projection_token,
         CASE
           WHEN public_program.publication_status IN (
                  'published', 'archived'
                )
            AND public_program.published_at IS NOT NULL
            AND public_program.deleted_at IS NULL
           THEN COALESCE(
             ${cmsProjectionVersionTokenSql(
               "event.organization_id",
               "program_public_profile",
               "event.program_id",
             )},
             json_array(
               'legacy',
               program.name,
               program.slug,
               program.updated_at,
               public_program.public_display_name,
               public_program.public_slug,
               public_program.updated_at
             )
           )
           ELSE NULL
         END AS public_program_projection_token,
         event.id AS artwork_event_id,
         1 AS public_slug_count,
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
         '[]' AS organizer_names_json
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
  JOIN clubs AS public_club
    ON public_club.id = event.club_id
   AND public_club.organization_id = event.organization_id
   AND public_club.deleted_at IS NULL
  JOIN club_public_profiles AS public_club_profile
    ON public_club_profile.club_id = event.club_id
   AND public_club_profile.organization_id = event.organization_id
  LEFT JOIN club_public_profile_details AS public_club_detail
    ON public_club_detail.club_id = event.club_id
   AND public_club_detail.organization_id = event.organization_id
  LEFT JOIN programs AS program
    ON program.id = event.program_id
   AND program.organization_id = event.organization_id
   AND program.deleted_at IS NULL
  LEFT JOIN program_public_profile_details AS public_program
    ON public_program.program_id = event.program_id
   AND public_program.organization_id = event.organization_id
   AND public_program.club_id = event.club_id
  LEFT JOIN categories AS category
    ON category.id = event.category_id
   AND category.organization_id = event.organization_id
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
    AND (${PUBLIC_MEETUP_ALIAS_EXCLUSION_SQL})
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
  const enrichedRows = await enrichCompatibilityPublicEventRows(
    database,
    organizationId,
    result.results ?? [],
  );
  return Object.freeze(enrichedRows.map((row) => toPublicEventDto(row)));
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
): readonly PublicEventOrganizerDto[] {
  if (
    typeof value !== "string" ||
    new TextEncoder().encode(value).byteLength >
      MAX_PUBLIC_ORGANIZERS_JSON_BYTES
  ) {
    return invalidProjection();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return invalidProjection();
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_PUBLIC_ORGANIZERS) {
    return invalidProjection();
  }
  return Object.freeze(
    parsed.map((candidate, index) => {
      if (typeof candidate === "string") {
        return Object.freeze({
          displayName: parseBoundedString(candidate, {
            path: `event.organizers.${index}.displayName`,
            maxLength: 120,
          }),
        });
      }
      if (
        candidate === null ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      ) {
        return invalidProjection();
      }
      const organizer = candidate as Record<string, unknown>;
      const displayName = parseBoundedString(organizer.displayName, {
        path: `event.organizers.${index}.displayName`,
        maxLength: 120,
      });
      const biography = parseOptionalBoundedString(organizer.biography, {
        path: `event.organizers.${index}.biography`,
        maxLength: 800,
      });
      const photoValues = [
        organizer.photoAssetId,
        organizer.photoAltText,
        organizer.photoCredit,
        organizer.photoWidth,
        organizer.photoHeight,
      ];
      const hasPhotoValue = photoValues.some(
        (photoValue) => photoValue !== null && photoValue !== undefined,
      );
      if (!hasPhotoValue) {
        return Object.freeze({
          ...(biography === null ? {} : { biography }),
          displayName,
        });
      }
      if (
        photoValues.some(
          (photoValue) => photoValue === null || photoValue === undefined,
        )
      ) {
        return invalidProjection();
      }
      const assetId = parseIdentifier(
        organizer.photoAssetId,
        `event.organizers.${index}.photoAssetId`,
      );
      return Object.freeze({
        ...(biography === null ? {} : { biography }),
        displayName,
        photo: Object.freeze({
          altText: parseBoundedString(organizer.photoAltText, {
            path: `event.organizers.${index}.photoAltText`,
            maxLength: 300,
          }),
          credit: parseBoundedString(organizer.photoCredit, {
            path: `event.organizers.${index}.photoCredit`,
            maxLength: 300,
          }),
          height: parseFiniteInteger(organizer.photoHeight, {
            path: `event.organizers.${index}.photoHeight`,
            minimum: 1,
            maximum: 8_000,
          }),
          url: `/media/${encodeURIComponent(assetId)}/webp_480`,
          width: parseFiniteInteger(organizer.photoWidth, {
            path: `event.organizers.${index}.photoWidth`,
            minimum: 1,
            maximum: 8_000,
          }),
        }),
      });
    }),
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

export type PublicEventArtworkDto = Readonly<{
  altText: string | null;
  credit: string;
  dimensions: Readonly<{
    large: Readonly<{ height: number; width: number }>;
    medium: Readonly<{ height: number; width: number }>;
    small: Readonly<{ height: number; width: number }>;
  }>;
  focalPoint: Readonly<{ x: number; y: number }>;
  srcSet: Readonly<{
    large: string;
    medium: string;
    small: string;
  }>;
  url: string;
}>;

export type PublicEventCardDto = Readonly<{
  agePolicyText: string | null;
  arrivalInstructions: string | null;
  attendanceMode: PublicEventAttendanceMode;
  artwork: PublicEventArtworkDto | null;
  availabilityState: "full" | "open" | "waitlist" | null;
  capacity: number | null;
  category: Readonly<{
    colorToken: string | null;
    name: string;
    slug: string;
  }> | null;
  club: Readonly<{
    name: string;
    slug: string;
  }>;
  costText: string | null;
  isCancelled: boolean;
  lane: Readonly<{
    name: string;
    slug: string;
  }> | null;
  program: Readonly<{
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
    addressCountry?: string | null;
    addressLocality?: string | null;
    addressRegion?: string | null;
    floor: string | null;
    name: string;
    postalCode?: string | null;
    room: string | null;
  }> | null;
  waitlistAvailable: boolean | null;
}>;

export type PublicEventDetailDto = PublicEventCardDto &
  Readonly<{
    description: string | null;
    descriptionBlocks: readonly CuratedMeetupDescriptionBlock[] | null;
    externalMapUrl: string | null;
    metaDescription: string | null;
    organizers: readonly PublicEventOrganizerDto[];
    preparationInformation: string | null;
    publicAccessNote: string | null;
    publicOnlineUrl: string | null;
    seoTitle: string | null;
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
  programSlug?: unknown;
  nowUtcMs: unknown;
  organizationId: unknown;
  page?: unknown;
  pageSize?: unknown;
  todayDate: unknown;
  toDate?: unknown;
  view?: unknown;
}>;

export type ListNextPublicEventsByClubInput = Readonly<{
  clubSlugs: readonly unknown[];
  nowUtcMs: unknown;
  organizationId: unknown;
  todayDate: unknown;
}>;

export type QueryPublicEventExportsInput = Omit<
  QueryPublicEventsInput,
  "page" | "pageSize"
> &
  Readonly<{
    maxEvents: unknown;
  }>;

export type PublicEventExportDto = Readonly<{
  agePolicyText: string | null;
  arrivalInstructions: string | null;
  attendanceMode: PublicEventAttendanceMode;
  availabilityState: "full" | "open" | "waitlist" | null;
  category: PublicEventCardDto["category"];
  club: PublicEventCardDto["club"];
  capacity: number | null;
  costText: string | null;
  description: string | null;
  isCancelled: boolean;
  lane: PublicEventCardDto["lane"];
  program: PublicEventCardDto["program"];
  rsvpUrl: string | null;
  schedule: PublicEventCardDto["schedule"];
  slug: string;
  status: PublicEventStatus;
  summary: string | null;
  title: string;
  venue: PublicEventCardDto["venue"];
  waitlistAvailable: boolean | null;
}>;

export type PublicEventExportRecord = Readonly<{
  clubProjectionToken: string;
  event: PublicEventExportDto;
  programProjectionToken: string | null;
  sourceIdentity: string;
  sourceVersion: number;
}>;

export type PublicEventPageDto = Readonly<{
  events: readonly PublicEventCardDto[];
  hasMore: boolean;
  page: number;
  pageSize: number;
  totalCount: number;
  view: PublicEventListView;
}>;

export type PublicEventSliceDto = Readonly<{
  events: readonly PublicEventCardDto[];
  hasMore: boolean;
  page: number;
  pageSize: number;
  view: PublicEventListView;
}>;

export type QueryPublicCalendarMonthInput = Readonly<{
  fromDate: unknown;
  laneSlug?: unknown;
  nowUtcMs: unknown;
  organizationId: unknown;
  todayDate: unknown;
  toDate: unknown;
}>;

export type PublicCalendarMonthDto = Readonly<{
  events: readonly PublicEventCardDto[];
  hasMore: boolean;
}>;

export type QueryPublicCalendarLandingBundleInput = Readonly<{
  calendar: QueryPublicCalendarMonthInput;
  includeLandingEvent?: boolean;
}>;

export type PublicCalendarLandingBundleDto = Readonly<{
  calendar: PublicCalendarMonthDto;
  landingEvent: PublicEventCardDto | null;
}>;

export type QueryPublicEventMaterializationBundleInput = Readonly<{
  calendar: QueryPublicCalendarMonthInput;
}>;

export type PublicEventMaterializationBundleDto = Readonly<{
  calendarEvents: readonly PublicEventCardDto[];
  eventDetails: readonly PublicEventDetailDto[];
  upcomingEvents: readonly PublicEventCardDto[];
}>;

export type GetPublicEventInput = Readonly<{
  organizationId: unknown;
  slug: unknown;
}>;

export type GetAuthorizedOrganizerEventPublicPreviewInput = Readonly<{
  membershipId: unknown;
  organizationId: unknown;
  organizerEventId: unknown;
  profileId: unknown;
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

/**
 * Collision-safe identifier used only by the private structured-content
 * editor. The identifier is the unified projection's source identity
 * (`legacy:...`, `meetup:...`, or `organizer:...`); public materialized
 * content keeps only the resolved slug and title.
 */
export type PublishedEventSelection = Readonly<{
  id: string;
  slug: string;
  title: string;
}>;

export type PublishedEventSelectionProof = PublishedEventSelection &
  Readonly<{
    sourceIdentity: string;
    sourceVersion: string;
  }>;

export type EditorialPublicEvents = Readonly<{
  defaultUpcoming: readonly PublicEventCardDto[];
  selected: readonly PublicEventCardDto[];
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
  programSlug: string | null;
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

type ParsedPublicCalendarMonthQuery = ParsedPublicEventQuery &
  Readonly<{
    fromDate: string;
    fromUtcMs: number;
    toDate: string;
    toDateExclusive: string;
    toUtcMsExclusive: number;
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
           json_object(
             'displayName',
             CASE
               WHEN attribution_intent.id IS NOT NULL
               THEN attribution_receipt.display_name
               ELSE NULL
             END,
             'biography',
             CASE
               WHEN attribution_intent.id IS NOT NULL
               THEN attribution_receipt.biography
               ELSE NULL
             END,
             'photoAssetId',
             CASE
               WHEN attribution_intent.id IS NOT NULL
                AND profile_photo_usage.id IS NOT NULL
                AND profile_photo_detail.asset_id IS NOT NULL
                AND profile_photo_variant.id IS NOT NULL
               THEN profile_photo_asset.id
               ELSE NULL
             END,
             'photoAltText',
             CASE
               WHEN attribution_intent.id IS NOT NULL
                AND profile_photo_usage.id IS NOT NULL
                AND profile_photo_detail.asset_id IS NOT NULL
                AND profile_photo_variant.id IS NOT NULL
               THEN profile_photo_asset.alt_text
               ELSE NULL
             END,
             'photoCredit',
             CASE
               WHEN attribution_intent.id IS NOT NULL
                AND profile_photo_usage.id IS NOT NULL
                AND profile_photo_detail.asset_id IS NOT NULL
                AND profile_photo_variant.id IS NOT NULL
               THEN profile_photo_asset.credit
               ELSE NULL
             END,
             'photoWidth',
             CASE
               WHEN attribution_intent.id IS NOT NULL
                AND profile_photo_usage.id IS NOT NULL
                AND profile_photo_detail.asset_id IS NOT NULL
                AND profile_photo_variant.id IS NOT NULL
               THEN profile_photo_variant.width
               ELSE NULL
             END,
             'photoHeight',
             CASE
               WHEN attribution_intent.id IS NOT NULL
                AND profile_photo_usage.id IS NOT NULL
                AND profile_photo_detail.asset_id IS NOT NULL
                AND profile_photo_variant.id IS NOT NULL
               THEN profile_photo_variant.height
               ELSE NULL
             END
           ) AS organizer_json,
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
    LEFT JOIN organizer_public_attribution_states AS attribution
      ON attribution.profile_id = public_host.profile_id
     AND attribution.organization_id = public_host.organization_id
     AND attribution.workflow_status = 'confirmed'
     AND attribution.public_display_name = profile.display_name
    LEFT JOIN organizer_public_attribution_receipts
      AS attribution_receipt
      ON attribution_receipt.id = attribution.current_receipt_id
     AND attribution_receipt.organization_id =
         attribution.organization_id
     AND attribution_receipt.profile_id = attribution.profile_id
     AND attribution_receipt.action IN ('adopted', 'confirmed')
     AND attribution_receipt.attribution_version =
         attribution.published_attribution_version
     AND attribution_receipt.actor_profile_id =
         attribution.profile_id
     AND attribution_receipt.consent = 1
     AND attribution_receipt.display_name =
         attribution.public_display_name
     AND attribution_receipt.biography IS
         attribution.public_biography
     AND attribution_receipt.photo_media_asset_id IS
         attribution.public_photo_media_asset_id
     AND NOT (${protectedLegalClaimSql([
       "attribution.public_display_name",
       "attribution.public_biography",
     ])})
     AND NOT (${publicOrganizerEmailExposureSql(
       ["attribution.public_display_name", "attribution.public_biography"],
       "attribution.organization_id",
     )})
    LEFT JOIN organizer_public_attribution_write_intents
      AS attribution_intent
      ON attribution_intent.id =
         attribution_receipt.write_intent_id
     AND attribution_intent.organization_id =
         attribution.organization_id
     AND attribution_intent.profile_id = attribution.profile_id
     AND attribution_intent.actor_profile_id =
         attribution.profile_id
     AND attribution_intent.operation =
         attribution_receipt.action
     AND attribution_intent.proposed_published_version =
         attribution_receipt.attribution_version
     AND attribution_intent.snapshot_hash =
         attribution_receipt.snapshot_hash
     AND attribution_intent.completed_at IS NOT NULL
    LEFT JOIN media_usage_references AS profile_photo_usage
      ON profile_photo_usage.organization_id =
         attribution.organization_id
     AND profile_photo_usage.asset_id =
         attribution.public_photo_media_asset_id
     AND profile_photo_usage.entity_type = 'organizer_profile'
     AND profile_photo_usage.entity_id = attribution.profile_id
     AND profile_photo_usage.revision_id =
         attribution.current_receipt_id
     AND profile_photo_usage.usage_kind = 'profile_photo'
     AND profile_photo_usage.publication_scope = 'published'
     AND profile_photo_usage.deleted_at IS NULL
     AND ${currentPublishedOrganizerProfilePhotoUsageTargetSql(
       "profile_photo_usage",
     )}
    LEFT JOIN media_assets AS profile_photo_asset
      ON profile_photo_asset.id = profile_photo_usage.asset_id
     AND profile_photo_asset.organization_id =
         profile_photo_usage.organization_id
     AND profile_photo_asset.deleted_at IS NULL
     AND profile_photo_asset.rights_status = 'approved'
     AND profile_photo_asset.participant_consent_status
         IN ('not_applicable', 'confirmed')
     AND length(
           trim(COALESCE(profile_photo_asset.alt_text, ''))
         ) BETWEEN 1 AND 300
     AND length(
           trim(COALESCE(profile_photo_asset.credit, ''))
         ) BETWEEN 1 AND 300
    LEFT JOIN media_asset_details AS profile_photo_detail
      ON profile_photo_detail.asset_id = profile_photo_asset.id
     AND profile_photo_detail.organization_id =
         profile_photo_asset.organization_id
     AND profile_photo_detail.upload_state = 'ready'
     AND NOT (${protectedLegalClaimSql([
       "profile_photo_asset.alt_text",
       "profile_photo_asset.credit",
       "profile_photo_detail.caption",
     ])})
     AND NOT (${publicOrganizerEmailExposureSql(
       [
         "profile_photo_asset.alt_text",
         "profile_photo_asset.credit",
         "profile_photo_detail.caption",
       ],
       "profile_photo_asset.organization_id",
     )})
    LEFT JOIN media_asset_variants AS profile_photo_variant
      ON profile_photo_variant.asset_id = profile_photo_asset.id
     AND profile_photo_variant.organization_id =
         profile_photo_asset.organization_id
     AND profile_photo_variant.variant_kind = 'webp_480'
     AND profile_photo_variant.state = 'ready'
    WHERE profile.status = 'active'
      AND profile.deleted_at IS NULL
      AND profile.public_attribution_consent = 1
      AND profile.display_name IS NOT NULL
      AND length(trim(profile.display_name)) > 0
      AND instr(profile.display_name, '@') = 0
      AND lower(trim(profile.display_name)) <>
          lower(profile.normalized_email)
      AND NOT (${protectedLegalClaimSql(["profile.display_name"])})
      AND attribution_intent.id IS NOT NULL
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
             json_group_array(json(organizer_json)) OVER (
               PARTITION BY organization_id, organizer_event_id
               ORDER BY organizer_rank
               ROWS BETWEEN UNBOUNDED PRECEDING
                        AND UNBOUNDED FOLLOWING
             ) AS organizer_names_json
      FROM organizer_public_host_candidates
      WHERE organizer_rank <= ${MAX_PUBLIC_ORGANIZERS}
    )
    WHERE organizer_rank = 1
      AND length(CAST(organizer_names_json AS BLOB)) <=
          ${MAX_PUBLIC_ORGANIZERS_JSON_BYTES}
  ),
  organizer_event_artwork_candidates AS (
    SELECT usage.organization_id,
           usage.entity_id AS organizer_event_id,
           usage.publication_scope,
           asset.id AS artwork_asset_id,
           asset.alt_text AS artwork_alt_text,
           asset.credit AS artwork_credit,
           detail.focal_point_x AS artwork_focal_point_x,
           detail.focal_point_y AS artwork_focal_point_y,
           (
             SELECT variant.width
             FROM media_asset_variants AS variant
             WHERE variant.organization_id = asset.organization_id
               AND variant.asset_id = asset.id
               AND variant.variant_kind = 'webp_480'
               AND variant.state = 'ready'
             LIMIT 1
           ) AS artwork_small_width,
           (
             SELECT variant.height
             FROM media_asset_variants AS variant
             WHERE variant.organization_id = asset.organization_id
               AND variant.asset_id = asset.id
               AND variant.variant_kind = 'webp_480'
               AND variant.state = 'ready'
             LIMIT 1
           ) AS artwork_small_height,
           (
             SELECT variant.width
             FROM media_asset_variants AS variant
             WHERE variant.organization_id = asset.organization_id
               AND variant.asset_id = asset.id
               AND variant.variant_kind = 'webp_960'
               AND variant.state = 'ready'
             LIMIT 1
           ) AS artwork_medium_width,
           (
             SELECT variant.height
             FROM media_asset_variants AS variant
             WHERE variant.organization_id = asset.organization_id
               AND variant.asset_id = asset.id
               AND variant.variant_kind = 'webp_960'
               AND variant.state = 'ready'
             LIMIT 1
           ) AS artwork_medium_height,
           (
             SELECT variant.width
             FROM media_asset_variants AS variant
             WHERE variant.organization_id = asset.organization_id
               AND variant.asset_id = asset.id
               AND variant.variant_kind = 'webp_1600'
               AND variant.state = 'ready'
             LIMIT 1
           ) AS artwork_large_width,
           (
             SELECT variant.height
             FROM media_asset_variants AS variant
             WHERE variant.organization_id = asset.organization_id
               AND variant.asset_id = asset.id
               AND variant.variant_kind = 'webp_1600'
               AND variant.state = 'ready'
             LIMIT 1
           ) AS artwork_large_height,
           row_number() OVER (
             PARTITION BY usage.organization_id,
                          usage.entity_id,
                          usage.publication_scope
             ORDER BY usage.created_at DESC, usage.id DESC
           ) AS artwork_rank,
           count(*) OVER (
             PARTITION BY usage.organization_id,
                          usage.entity_id,
                          usage.publication_scope
           ) AS artwork_usage_count
    FROM media_usage_references AS usage
    JOIN media_assets AS asset
      ON asset.id = usage.asset_id
     AND asset.organization_id = usage.organization_id
     AND asset.deleted_at IS NULL
     AND asset.rights_status = 'approved'
     AND asset.participant_consent_status
         IN ('not_applicable', 'confirmed')
     AND length(trim(COALESCE(asset.credit, ''))) BETWEEN 1 AND 300
    JOIN media_asset_details AS detail
      ON detail.asset_id = asset.id
     AND detail.organization_id = asset.organization_id
     AND detail.upload_state = 'ready'
     AND (
       detail.informative = 0
       OR length(trim(COALESCE(asset.alt_text, ''))) BETWEEN 1 AND 300
     )
     AND NOT (${protectedLegalClaimSql([
       "asset.alt_text",
       "asset.credit",
       "detail.caption",
     ])})
    WHERE usage.entity_type = 'organizer_event'
      AND usage.usage_kind = 'event_artwork'
      AND usage.publication_scope IN ('draft', 'published')
      AND usage.deleted_at IS NULL
      AND (
        SELECT count(*)
        FROM media_asset_variants AS variant
        WHERE variant.organization_id = asset.organization_id
          AND variant.asset_id = asset.id
          AND variant.state = 'ready'
          AND variant.variant_kind IN (
            'original', 'webp_480', 'webp_960', 'webp_1600'
          )
      ) = 4
  )
`;

function historicalPublishedEventSql(
  alias: "event" | "organizer_event",
  scheduleColumn: "schedule_shape" | "time_kind",
  statusColumn: "planning_status" | "status",
): string {
  const terminalStatuses =
    statusColumn === "planning_status"
      ? "'cancelled', 'completed'"
      : "'cancelled'";
  return `(
    ${alias}.${statusColumn} IN (${terminalStatuses})
    OR (
      ${alias}.${scheduleColumn} = 'timed'
      AND ${alias}.ends_at_utc <= CAST(unixepoch() * 1000 AS INTEGER)
    )
    OR (
      ${alias}.${scheduleColumn} = 'all_day'
      AND ${alias}.all_day_end_date_exclusive <=
          strftime('%Y-%m-%d', unixepoch(), 'unixepoch')
    )
  )`;
}

function publishedProgramProjectionResolvesSql(
  eventAlias: "event" | "organizer_event",
  publicProgramAlias: "program_public" | "public_program",
): string {
  return `(
    ${eventAlias}.program_id IS NULL
    OR ${publicProgramAlias}.program_id IS NOT NULL
    OR NOT EXISTS (
      SELECT 1
      FROM program_public_profile_details AS configured_program
      WHERE configured_program.organization_id =
            ${eventAlias}.organization_id
        AND configured_program.program_id = ${eventAlias}.program_id
        AND configured_program.club_id = ${eventAlias}.club_id
        AND configured_program.publication_status IN (
          'published', 'archived'
        )
        AND configured_program.published_at IS NOT NULL
        AND configured_program.deleted_at IS NULL
    )
  )`;
}

function cmsProjectionVersionTokenSql(
  organizationExpression: string,
  entityType: "club_public_profile" | "program_public_profile",
  entityKeyExpression: string,
): string {
  return `(
    SELECT json_array(
             parent_state.id,
             parent_state.content_version,
             parent_revision.id,
             parent_revision.content_hash,
             parent_receipt.id
           )
    FROM cms_entity_publication_states AS parent_state
    JOIN cms_entity_revisions AS parent_revision
      ON parent_revision.id = parent_state.published_revision_id
     AND parent_revision.organization_id = parent_state.organization_id
     AND parent_revision.publication_state_id = parent_state.id
     AND parent_revision.entity_type = parent_state.entity_type
     AND parent_revision.entity_key = parent_state.entity_key
    JOIN cms_public_materialization_receipts AS parent_receipt
      ON parent_receipt.organization_id = parent_state.organization_id
     AND parent_receipt.publication_state_id = parent_state.id
     AND parent_receipt.entity_type = parent_state.entity_type
     AND parent_receipt.entity_key = parent_state.entity_key
     AND parent_receipt.revision_id = parent_revision.id
     AND parent_receipt.revision_hash = parent_revision.content_hash
    WHERE parent_state.organization_id = ${organizationExpression}
      AND parent_state.entity_type = '${entityType}'
      AND parent_state.entity_key = ${entityKeyExpression}
      AND parent_state.workflow_status IN ('published', 'archived')
      AND parent_state.published_revision_id IS NOT NULL
    LIMIT 1
  )`;
}

/**
 * Collision-safe public identity projection used by CMS receipt guards and
 * private structured-content selectors.
 *
 * Keep this intentionally narrower than the card/detail projection: D1 must
 * be able to compile it inside a trigger. It nevertheless retains every fact
 * that can suppress a public event (source generation, publication state,
 * club/program publication parity, cancellation history, and public-content
 * safety). Rich host, artwork, venue, and detail DTOs are loaded only by the
 * public card/detail queries.
 */
export const PUBLIC_EVENT_IDENTITY_CTE_SQL = `
  WITH identity_public_clubs AS (
    SELECT club_public.*,
           COALESCE(
             ${cmsProjectionVersionTokenSql(
               "club_public.organization_id",
               "club_public_profile",
               "club_public.club_id",
             )},
             json_array(
               'legacy',
               club.name,
               club.slug,
               club.updated_at,
               club_public.updated_at,
               club_detail.updated_at
             )
           ) AS public_projection_token
    FROM club_public_profiles AS club_public
    JOIN clubs AS club
      ON club.id = club_public.club_id
     AND club.organization_id = club_public.organization_id
     AND club.deleted_at IS NULL
    LEFT JOIN club_public_profile_details AS club_detail
      ON club_detail.club_id = club_public.club_id
     AND club_detail.organization_id = club_public.organization_id
    WHERE club_public.published_at IS NOT NULL
      AND club_public.deleted_at IS NULL
      AND (${publicClubProjectionParityD1Sql("club_public")})
  ),
  identity_public_programs AS (
    SELECT program_public.*,
           COALESCE(
             ${cmsProjectionVersionTokenSql(
               "program_public.organization_id",
               "program_public_profile",
               "program_public.program_id",
             )},
             json_array(
               'legacy',
               program.name,
               program.slug,
               program.updated_at,
               program_public.public_display_name,
               program_public.public_slug,
               program_public.updated_at
             )
           ) AS public_projection_token
    FROM program_public_profile_details AS program_public
    JOIN programs AS program
      ON program.id = program_public.program_id
     AND program.organization_id = program_public.organization_id
     AND program.deleted_at IS NULL
    WHERE program_public.published_at IS NOT NULL
      AND program_public.deleted_at IS NULL
      AND (${publicProgramProjectionParityD1Sql("program_public")})
  ),
  identity_manual_candidates AS (
    SELECT event.id AS event_id,
           event.organization_id,
           event.club_id AS public_club_id,
           event.slug,
           event.title,
           event.status AS event_status,
           event.time_kind,
           event.starts_at_utc,
           event.all_day_start_date,
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
        FROM external_source_links AS source_link
        WHERE source_link.organization_id = event.organization_id
          AND source_link.entity_type = 'event'
          AND source_link.entity_id = event.id
          AND source_link.source_type = 'meetup_ics'
      )
  ),
  identity_meetup_candidates AS (
    SELECT event.id AS event_id,
           event.organization_id,
           source.club_id AS public_club_id,
           snapshot.event_slug AS slug,
           snapshot.title AS title,
           snapshot.status AS event_status,
           snapshot.time_kind,
           snapshot.starts_at_utc,
           snapshot.all_day_start_date,
           max(snapshot.updated_at, generation.published_at)
             AS public_updated_at,
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
      AND (${PUBLIC_MEETUP_ALIAS_EXCLUSION_SQL})
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
          WHERE previous_snapshot.organization_id =
                snapshot.organization_id
            AND previous_snapshot.sync_source_id =
                snapshot.sync_source_id
            AND previous_snapshot.external_id = snapshot.external_id
            AND previous_snapshot.generation_id <> snapshot.generation_id
            AND previous_snapshot.status IN ('confirmed', 'tentative')
        )
      )
  ),
  identity_legacy_candidates AS (
    SELECT candidate.*,
           club_public.public_projection_token
             AS club_projection_token,
           program_public.public_projection_token
             AS program_projection_token,
           event.summary,
           event.description,
           NULL AS seo_title,
           NULL AS meta_description,
           club.name AS club_name,
           program_public.public_display_name AS program_name,
           lane.name AS lane_name,
           category.name AS category_name,
           CASE WHEN venue.is_public = 1
                THEN venue.public_location_name ELSE NULL END
             AS venue_public_name,
           CASE WHEN venue.is_public = 1
                THEN venue.public_address ELSE NULL END
             AS venue_public_address,
           NULL AS public_access_note,
           NULL AS cost_text,
           NULL AS preparation_information,
           NULL AS what_to_bring,
           NULL AS arrival_instructions,
           NULL AS weather_note,
           NULL AS verified_accessibility_notes
    FROM (
      SELECT * FROM identity_manual_candidates
      UNION ALL
      SELECT * FROM identity_meetup_candidates
    ) AS candidate
    JOIN events AS event
      ON event.id = candidate.event_id
     AND event.organization_id = candidate.organization_id
     AND event.deleted_at IS NULL
    JOIN clubs AS club
      ON club.id = candidate.public_club_id
     AND club.organization_id = candidate.organization_id
     AND club.deleted_at IS NULL
    JOIN identity_public_clubs AS club_public
      ON club_public.organization_id = candidate.organization_id
     AND club_public.club_id = candidate.public_club_id
     AND (
       club_public.publication_status = 'published'
       OR (
         club_public.publication_status = 'archived'
         AND ${historicalPublishedEventSql(
           "event",
           "time_kind",
           "status",
         )}
       )
     )
    LEFT JOIN identity_public_programs AS program_public
      ON program_public.organization_id = candidate.organization_id
     AND program_public.program_id = event.program_id
     AND program_public.club_id = candidate.public_club_id
     AND (
       program_public.publication_status = 'published'
       OR (
         program_public.publication_status = 'archived'
         AND ${historicalPublishedEventSql(
           "event",
           "time_kind",
           "status",
         )}
       )
     )
    LEFT JOIN event_lanes AS lane
      ON lane.organization_id = candidate.organization_id
     AND lane.id = COALESCE(
       event.event_lane_id,
       club_public.primary_event_lane_id
     )
    LEFT JOIN categories AS category
      ON category.organization_id = candidate.organization_id
     AND category.id = event.category_id
    LEFT JOIN venues AS venue
      ON venue.organization_id = candidate.organization_id
     AND venue.id = event.venue_id
     AND venue.deleted_at IS NULL
    WHERE ${publishedProgramProjectionResolvesSql(
      "event",
      "program_public",
    )}
  ),
  identity_organizer_candidates AS (
    SELECT organizer_event.id AS event_id,
           organizer_event.organization_id,
           organizer_event.club_id AS public_club_id,
           organizer_event.slug,
           organizer_event.title,
           organizer_event.planning_status AS event_status,
           organizer_event.schedule_shape AS time_kind,
           organizer_event.starts_at_utc,
           organizer_event.all_day_start_date,
           max(
             organizer_event.updated_at,
             public_detail.updated_at,
             publication_state.updated_at
           ) AS public_updated_at,
           2 AS source_rank,
           '' AS source_key,
           'organizer:' || organizer_event.id AS source_identity_key,
           club_public.public_projection_token
             AS club_projection_token,
           program_public.public_projection_token
             AS program_projection_token,
           organizer_event.summary,
           organizer_event.description,
           public_metadata.seo_title,
           public_metadata.meta_description,
           club.name AS club_name,
           program_public.public_display_name AS program_name,
           lane.name AS lane_name,
           category.name AS category_name,
           public_detail.public_location_name AS venue_public_name,
           public_detail.public_address AS venue_public_address,
           public_detail.public_access_note,
           public_detail.cost_text,
           public_detail.preparation_information,
           public_detail.what_to_bring,
           public_detail.arrival_instructions,
           public_detail.weather_note,
           public_detail.verified_accessibility_notes
    FROM organizer_events AS organizer_event
    JOIN organizer_event_public_details AS public_detail
      ON public_detail.organization_id = organizer_event.organization_id
     AND public_detail.organizer_event_id = organizer_event.id
    LEFT JOIN organizer_event_public_metadata AS public_metadata
      ON public_metadata.organization_id = organizer_event.organization_id
     AND public_metadata.organizer_event_id = organizer_event.id
    JOIN organizer_event_publication_state AS publication_state
      ON publication_state.organization_id =
         organizer_event.organization_id
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
    JOIN identity_public_clubs AS club_public
      ON club_public.organization_id = organizer_event.organization_id
     AND club_public.club_id = organizer_event.club_id
     AND (
       club_public.publication_status = 'published'
       OR (
         club_public.publication_status = 'archived'
         AND ${historicalPublishedEventSql(
           "organizer_event",
           "schedule_shape",
           "planning_status",
         )}
         AND EXISTS (
           SELECT 1
           FROM cms_entity_publication_states AS archived_club_state
           WHERE archived_club_state.organization_id =
                 organizer_event.organization_id
             AND archived_club_state.entity_type =
                 'club_public_profile'
             AND archived_club_state.entity_key =
                 organizer_event.club_id
             AND archived_club_state.workflow_status = 'archived'
             AND archived_club_state.published_revision_id IS NOT NULL
         )
       )
     )
    LEFT JOIN identity_public_programs AS program_public
      ON program_public.organization_id = organizer_event.organization_id
     AND program_public.program_id = organizer_event.program_id
     AND program_public.club_id = organizer_event.club_id
     AND (
       program_public.publication_status = 'published'
       OR (
         program_public.publication_status = 'archived'
         AND ${historicalPublishedEventSql(
           "organizer_event",
           "schedule_shape",
           "planning_status",
         )}
       )
     )
    LEFT JOIN event_lanes AS lane
      ON lane.organization_id = organizer_event.organization_id
     AND lane.id = COALESCE(
       organizer_event.event_lane_id,
       club_public.primary_event_lane_id
     )
    LEFT JOIN categories AS category
      ON category.organization_id = organizer_event.organization_id
     AND category.id = organizer_event.category_id
    WHERE organizer_event.organization_id = ?
      AND organizer_event.publication_status = 'published'
      AND organizer_event.planning_status IN (
        'confirmed', 'cancelled', 'completed'
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
      AND ${publishedProgramProjectionResolvesSql(
        "organizer_event",
        "program_public",
      )}
  ),
  identity_enriched_candidates AS (
    SELECT * FROM identity_legacy_candidates
    UNION ALL
    SELECT * FROM identity_organizer_candidates
  ),
  identity_ranked_events AS (
    SELECT candidate.*,
           row_number() OVER (
             PARTITION BY candidate.organization_id,
                          candidate.source_identity_key
             ORDER BY
               CASE candidate.event_status
                 WHEN 'confirmed' THEN 0
                 WHEN 'tentative' THEN 1
                 WHEN 'completed' THEN 2
                 ELSE 3
               END,
               candidate.source_rank,
               candidate.source_key
           ) AS duplicate_rank
    FROM identity_enriched_candidates AS candidate
    WHERE NOT (${protectedLegalClaimSql([
      "candidate.title",
      "candidate.summary",
      "candidate.description",
      "candidate.club_name",
      "candidate.lane_name",
      "candidate.category_name",
      "candidate.venue_public_name",
      "candidate.venue_public_address",
      "candidate.public_access_note",
      "candidate.cost_text",
      "candidate.preparation_information",
      "candidate.what_to_bring",
      "candidate.arrival_instructions",
      "candidate.weather_note",
      "candidate.verified_accessibility_notes",
      "candidate.seo_title",
      "candidate.meta_description",
    ])})
      AND NOT (${publicOrganizerEmailExposureSql(
        [
          "candidate.title",
          "candidate.summary",
          "candidate.description",
          "candidate.club_name",
          "candidate.lane_name",
          "candidate.category_name",
          "candidate.venue_public_name",
          "candidate.venue_public_address",
          "candidate.public_access_note",
          "candidate.cost_text",
          "candidate.preparation_information",
          "candidate.what_to_bring",
          "candidate.arrival_instructions",
          "candidate.weather_note",
          "candidate.verified_accessibility_notes",
          "candidate.seo_title",
          "candidate.meta_description",
        ],
        "candidate.organization_id",
      )})
  ),
  public_events AS (
    SELECT ranked.*,
           count(*) OVER (
             PARTITION BY ranked.organization_id, ranked.slug
           ) AS public_slug_count
    FROM identity_ranked_events AS ranked
    WHERE ranked.duplicate_rank = 1
  )
`;

export function publicEventIdentityCteSqlForOrganization(
  organizationExpression: string,
): string {
  return PUBLIC_EVENT_IDENTITY_CTE_SQL.replace(
    /\?/gu,
    organizationExpression,
  );
}

/**
 * Compact current-public proof for CMS featured-event receipt guards.
 *
 * The complete public DTO query deliberately proves every materialized club
 * and program field. That proof is too large to embed in a SQLite trigger
 * body. Phase 6's invariant initializer separately verifies those
 * materializations, so this trigger-local proof can consume their guarded
 * publication state while still rechecking every event/source/publication
 * fact, public-content safety, source-identity deduplication, and global slug
 * collision that can suppress a selected event.
 */
export const PUBLIC_EVENT_SELECTION_PROOF_CTE_SQL = `
  WITH selection_public_clubs AS (
    SELECT public_profile.organization_id,
           public_profile.club_id,
           public_profile.publication_status,
           public_profile.primary_event_lane_id,
           COALESCE(
             ${cmsProjectionVersionTokenSql(
               "public_profile.organization_id",
               "club_public_profile",
               "public_profile.club_id",
             )},
             json_array(
               'legacy',
               club.name,
               club.slug,
               club.updated_at,
               public_profile.updated_at,
               club_detail.updated_at
             )
           ) AS public_projection_token
    FROM club_public_profiles AS public_profile
    JOIN clubs AS club
      ON club.id = public_profile.club_id
     AND club.organization_id = public_profile.organization_id
     AND club.deleted_at IS NULL
    LEFT JOIN club_public_profile_details AS club_detail
      ON club_detail.club_id = public_profile.club_id
     AND club_detail.organization_id = public_profile.organization_id
    WHERE public_profile.organization_id = ?
      AND public_profile.publication_status IN ('published', 'archived')
      AND public_profile.published_at IS NOT NULL
      AND public_profile.deleted_at IS NULL
  ),
  selection_public_programs AS (
    SELECT public_program.organization_id,
           public_program.program_id,
           public_program.club_id,
           public_program.publication_status,
           public_program.public_display_name,
           COALESCE(
             ${cmsProjectionVersionTokenSql(
               "public_program.organization_id",
               "program_public_profile",
               "public_program.program_id",
             )},
             json_array(
               'legacy',
               program.name,
               program.slug,
               program.updated_at,
               public_program.public_display_name,
               public_program.public_slug,
               public_program.updated_at
             )
           ) AS public_projection_token
    FROM program_public_profile_details AS public_program
    JOIN programs AS program
      ON program.id = public_program.program_id
     AND program.organization_id = public_program.organization_id
     AND program.club_id = public_program.club_id
    WHERE public_program.organization_id = ?
      AND public_program.publication_status IN ('published', 'archived')
      AND public_program.published_at IS NOT NULL
      AND public_program.deleted_at IS NULL
  ),
  selection_manual_candidates AS (
    SELECT event.id AS event_id,
           event.organization_id,
           event.club_id AS public_club_id,
           event.slug,
           event.title,
           event.status AS event_status,
           event.time_kind,
           event.starts_at_utc,
           event.ends_at_utc,
           event.all_day_start_date,
           event.all_day_end_date_exclusive,
           event.updated_at AS public_updated_at,
           'legacy:' || event.updated_at || ':' || event.schedule_version
             AS public_source_version,
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
        FROM external_source_links AS source_link
        WHERE source_link.organization_id = event.organization_id
          AND source_link.entity_type = 'event'
          AND source_link.entity_id = event.id
          AND source_link.source_type = 'meetup_ics'
      )
  ),
  selection_meetup_candidates AS (
    SELECT event.id AS event_id,
           event.organization_id,
           source.club_id AS public_club_id,
           snapshot.event_slug AS slug,
           snapshot.title,
           snapshot.status AS event_status,
           snapshot.time_kind,
           snapshot.starts_at_utc,
           snapshot.ends_at_utc,
           snapshot.all_day_start_date,
           snapshot.all_day_end_date_exclusive,
           max(snapshot.updated_at, generation.published_at)
             AS public_updated_at,
           'meetup:' || generation.id || ':' ||
             snapshot.source_fingerprint
             AS public_source_version,
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
      AND (${PUBLIC_MEETUP_ALIAS_EXCLUSION_SQL})
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
          WHERE previous_snapshot.organization_id =
                snapshot.organization_id
            AND previous_snapshot.sync_source_id =
                snapshot.sync_source_id
            AND previous_snapshot.external_id = snapshot.external_id
            AND previous_snapshot.generation_id <> snapshot.generation_id
            AND previous_snapshot.status IN ('confirmed', 'tentative')
        )
      )
  ),
  selection_legacy_candidates AS (
    SELECT candidate.*,
           public_club.public_projection_token
             AS club_projection_token,
           public_program.public_projection_token
             AS program_projection_token,
           event.summary,
           event.description,
           NULL AS seo_title,
           NULL AS meta_description,
           club.name AS club_name,
           public_program.public_display_name AS program_name,
           lane.name AS lane_name,
           category.name AS category_name,
           CASE WHEN venue.is_public = 1
                THEN venue.public_location_name ELSE NULL END
             AS venue_public_name,
           CASE WHEN venue.is_public = 1
                THEN venue.public_address ELSE NULL END
             AS venue_public_address,
           NULL AS public_access_note,
           NULL AS cost_text,
           NULL AS preparation_information,
           NULL AS what_to_bring,
           NULL AS arrival_instructions,
           NULL AS weather_note,
           NULL AS verified_accessibility_notes
    FROM (
      SELECT * FROM selection_manual_candidates
      UNION ALL
      SELECT * FROM selection_meetup_candidates
    ) AS candidate
    JOIN events AS event
      ON event.id = candidate.event_id
     AND event.organization_id = candidate.organization_id
     AND event.deleted_at IS NULL
    JOIN clubs AS club
      ON club.id = candidate.public_club_id
     AND club.organization_id = candidate.organization_id
     AND club.deleted_at IS NULL
    JOIN selection_public_clubs AS public_club
      ON public_club.organization_id = candidate.organization_id
     AND public_club.club_id = candidate.public_club_id
     AND (
       public_club.publication_status = 'published'
       OR (
         public_club.publication_status = 'archived'
         AND ${historicalPublishedEventSql(
           "event",
           "time_kind",
           "status",
         )}
       )
     )
    LEFT JOIN selection_public_programs AS public_program
      ON public_program.organization_id = candidate.organization_id
     AND public_program.program_id = event.program_id
     AND public_program.club_id = candidate.public_club_id
     AND (
       public_program.publication_status = 'published'
       OR (
         public_program.publication_status = 'archived'
         AND ${historicalPublishedEventSql(
           "event",
           "time_kind",
           "status",
         )}
       )
     )
    LEFT JOIN event_lanes AS lane
      ON lane.organization_id = candidate.organization_id
     AND lane.id = COALESCE(
       event.event_lane_id,
       public_club.primary_event_lane_id
     )
    LEFT JOIN categories AS category
      ON category.organization_id = candidate.organization_id
     AND category.id = event.category_id
    LEFT JOIN venues AS venue
      ON venue.organization_id = candidate.organization_id
     AND venue.id = event.venue_id
     AND venue.deleted_at IS NULL
    WHERE ${publishedProgramProjectionResolvesSql(
      "event",
      "public_program",
    )}
  ),
  selection_organizer_candidates AS (
    SELECT organizer_event.id AS event_id,
           organizer_event.organization_id,
           organizer_event.club_id AS public_club_id,
           organizer_event.slug,
           organizer_event.title,
           organizer_event.planning_status AS event_status,
           organizer_event.schedule_shape AS time_kind,
           organizer_event.starts_at_utc,
           organizer_event.ends_at_utc,
           organizer_event.all_day_start_date,
           organizer_event.all_day_end_date_exclusive,
           max(
             organizer_event.updated_at,
             public_detail.updated_at,
             publication_state.updated_at
           ) AS public_updated_at,
           'organizer:' || organizer_event.content_version || ':' ||
             organizer_event.schedule_version
             AS public_source_version,
           2 AS source_rank,
           '' AS source_key,
           'organizer:' || organizer_event.id AS source_identity_key,
           public_club.public_projection_token
             AS club_projection_token,
           public_program.public_projection_token
             AS program_projection_token,
           organizer_event.summary,
           organizer_event.description,
           public_metadata.seo_title,
           public_metadata.meta_description,
           club.name AS club_name,
           public_program.public_display_name AS program_name,
           lane.name AS lane_name,
           category.name AS category_name,
           public_detail.public_location_name AS venue_public_name,
           public_detail.public_address AS venue_public_address,
           public_detail.public_access_note,
           public_detail.cost_text,
           public_detail.preparation_information,
           public_detail.what_to_bring,
           public_detail.arrival_instructions,
           public_detail.weather_note,
           public_detail.verified_accessibility_notes
    FROM organizer_events AS organizer_event
    JOIN organizer_event_public_details AS public_detail
      ON public_detail.organization_id = organizer_event.organization_id
     AND public_detail.organizer_event_id = organizer_event.id
    LEFT JOIN organizer_event_public_metadata AS public_metadata
      ON public_metadata.organization_id = organizer_event.organization_id
     AND public_metadata.organizer_event_id = organizer_event.id
    JOIN organizer_event_publication_state AS publication_state
      ON publication_state.organization_id =
         organizer_event.organization_id
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
    JOIN selection_public_clubs AS public_club
      ON public_club.organization_id = organizer_event.organization_id
     AND public_club.club_id = organizer_event.club_id
     AND (
       public_club.publication_status = 'published'
       OR (
         public_club.publication_status = 'archived'
         AND ${historicalPublishedEventSql(
           "organizer_event",
           "schedule_shape",
           "planning_status",
         )}
         AND EXISTS (
           SELECT 1
           FROM cms_entity_publication_states AS archived_club_state
           WHERE archived_club_state.organization_id =
                 organizer_event.organization_id
             AND archived_club_state.entity_type =
                 'club_public_profile'
             AND archived_club_state.entity_key =
                 organizer_event.club_id
             AND archived_club_state.workflow_status = 'archived'
             AND archived_club_state.published_revision_id IS NOT NULL
         )
       )
     )
    LEFT JOIN selection_public_programs AS public_program
      ON public_program.organization_id = organizer_event.organization_id
     AND public_program.program_id = organizer_event.program_id
     AND public_program.club_id = organizer_event.club_id
     AND (
       public_program.publication_status = 'published'
       OR (
         public_program.publication_status = 'archived'
         AND ${historicalPublishedEventSql(
           "organizer_event",
           "schedule_shape",
           "planning_status",
         )}
       )
     )
    LEFT JOIN event_lanes AS lane
      ON lane.organization_id = organizer_event.organization_id
     AND lane.id = COALESCE(
       organizer_event.event_lane_id,
       public_club.primary_event_lane_id
     )
    LEFT JOIN categories AS category
      ON category.organization_id = organizer_event.organization_id
     AND category.id = organizer_event.category_id
    WHERE organizer_event.organization_id = ?
      AND organizer_event.publication_status = 'published'
      AND organizer_event.planning_status IN (
        'confirmed', 'cancelled', 'completed'
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
      AND ${publishedProgramProjectionResolvesSql(
        "organizer_event",
        "public_program",
      )}
  ),
  selection_candidates AS (
    SELECT * FROM selection_legacy_candidates
    UNION ALL
    SELECT * FROM selection_organizer_candidates
  ),
  selection_ranked AS (
    SELECT candidate.*,
           row_number() OVER (
             PARTITION BY candidate.organization_id,
                          candidate.source_identity_key
             ORDER BY
               CASE candidate.event_status
                 WHEN 'confirmed' THEN 0
                 WHEN 'tentative' THEN 1
                 WHEN 'completed' THEN 2
                 ELSE 3
               END,
               candidate.source_rank,
               candidate.source_key
           ) AS duplicate_rank
    FROM selection_candidates AS candidate
    WHERE NOT (${protectedLegalClaimSql([
      "candidate.title",
      "candidate.summary",
      "candidate.description",
      "candidate.club_name",
      "candidate.lane_name",
      "candidate.category_name",
      "candidate.venue_public_name",
      "candidate.venue_public_address",
      "candidate.public_access_note",
      "candidate.cost_text",
      "candidate.preparation_information",
      "candidate.what_to_bring",
      "candidate.arrival_instructions",
      "candidate.weather_note",
      "candidate.verified_accessibility_notes",
      "candidate.seo_title",
      "candidate.meta_description",
    ])})
      AND NOT (${publicOrganizerEmailExposureSql(
        [
          "candidate.title",
          "candidate.summary",
          "candidate.description",
          "candidate.club_name",
          "candidate.lane_name",
          "candidate.category_name",
          "candidate.venue_public_name",
          "candidate.venue_public_address",
          "candidate.public_access_note",
          "candidate.cost_text",
          "candidate.preparation_information",
          "candidate.what_to_bring",
          "candidate.arrival_instructions",
          "candidate.weather_note",
          "candidate.verified_accessibility_notes",
          "candidate.seo_title",
          "candidate.meta_description",
        ],
        "candidate.organization_id",
      )})
  ),
  public_events AS (
    SELECT ranked.source_identity_key,
           ranked.slug,
           ranked.title,
           ranked.public_updated_at,
           ranked.public_source_version ||
             '|club:' || ranked.club_projection_token ||
             '|program:' ||
             COALESCE(ranked.program_projection_token, 'none')
             AS public_source_version,
           ranked.club_projection_token,
           ranked.program_projection_token,
           count(*) OVER (
             PARTITION BY ranked.organization_id, ranked.slug
           ) AS public_slug_count
    FROM selection_ranked AS ranked
    WHERE ranked.duplicate_rank = 1
  )
`;

export function publicEventSelectionProofCteSqlForOrganization(
  organizationExpression: string,
): string {
  return PUBLIC_EVENT_SELECTION_PROOF_CTE_SQL.replace(
    /\?/gu,
    organizationExpression,
  );
}

export const UNIFIED_PUBLIC_EVENT_CTE_SQL = `
  WITH public_clubs AS (
    SELECT club_public.*,
           COALESCE(
             ${cmsProjectionVersionTokenSql(
               "club_public.organization_id",
               "club_public_profile",
               "club_public.club_id",
             )},
             json_array(
               'legacy',
               club.name,
               club.slug,
               club.updated_at,
               club_public.updated_at,
               club_detail.updated_at
             )
           ) AS public_projection_token
    FROM club_public_profiles AS club_public
    JOIN clubs AS club
      ON club.id = club_public.club_id
     AND club.organization_id = club_public.organization_id
     AND club.deleted_at IS NULL
    LEFT JOIN club_public_profile_details AS club_detail
      ON club_detail.club_id = club_public.club_id
     AND club_detail.organization_id = club_public.organization_id
    WHERE club_public.published_at IS NOT NULL
      AND club_public.deleted_at IS NULL
      AND (${publicClubProjectionParityD1Sql("club_public")})
  ),
  public_programs AS (
    SELECT program_public.*,
           COALESCE(
             ${cmsProjectionVersionTokenSql(
               "program_public.organization_id",
               "program_public_profile",
               "program_public.program_id",
             )},
             json_array(
               'legacy',
               program.name,
               program.slug,
               program.updated_at,
               program_public.public_display_name,
               program_public.public_slug,
               program_public.updated_at
             )
           ) AS public_projection_token
    FROM program_public_profile_details AS program_public
    JOIN programs AS program
      ON program.id = program_public.program_id
     AND program.organization_id = program_public.organization_id
     AND program.deleted_at IS NULL
    WHERE program_public.published_at IS NOT NULL
      AND program_public.deleted_at IS NULL
      AND (${publicProgramProjectionParityD1Sql("program_public")})
  ),
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
           'legacy:' || event.id AS source_identity_key,
           NULL AS source_public_summary,
           NULL AS source_public_description,
           NULL AS source_public_description_blocks_json,
           NULL AS source_public_venue_name,
           NULL AS source_public_venue_address,
           NULL AS source_public_floor,
           NULL AS source_public_room,
           NULL AS source_capacity,
           NULL AS source_cost_text,
           NULL AS source_age_policy_text,
           NULL AS source_waitlist_available,
           NULL AS source_availability_state,
           NULL AS source_arrival_instructions,
           NULL AS source_poster_source_url,
           NULL AS source_poster_alt_text,
           NULL AS source_poster_credit
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
             AS source_identity_key,
           snapshot_content.public_summary AS source_public_summary,
           snapshot_content.public_description AS source_public_description,
           snapshot_content.public_description_blocks_json
             AS source_public_description_blocks_json,
           snapshot_content.public_venue_name AS source_public_venue_name,
           snapshot_content.public_venue_address AS source_public_venue_address,
           snapshot_content.public_floor AS source_public_floor,
           snapshot_content.public_room AS source_public_room,
           snapshot_content.capacity AS source_capacity,
           snapshot_content.cost_text AS source_cost_text,
           snapshot_content.age_policy_text AS source_age_policy_text,
           snapshot_content.waitlist_available AS source_waitlist_available,
           snapshot_content.availability_state AS source_availability_state,
           snapshot_content.arrival_instructions AS source_arrival_instructions,
           snapshot_content.poster_source_url AS source_poster_source_url,
           snapshot_content.poster_alt_text AS source_poster_alt_text,
           snapshot_content.poster_credit AS source_poster_credit
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
    LEFT JOIN meetup_event_snapshot_public_contents AS snapshot_content
      ON snapshot_content.snapshot_id = snapshot.id
    JOIN events AS event
      ON event.id = snapshot.event_id
     AND event.organization_id = snapshot.organization_id
    WHERE source.organization_id = ?
      AND source.source_type = 'meetup_ics'
      AND source.enabled = 1
      AND source.active_generation_id IS NOT NULL
      AND source.deleted_at IS NULL
      AND (${PUBLIC_MEETUP_ALIAS_EXCLUSION_SQL})
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
    SELECT candidate.event_id AS event_id,
           candidate.organization_id AS organization_id,
           candidate.public_club_id AS public_club_id,
           candidate.slug AS slug,
           candidate.title AS title,
           candidate.event_status AS event_status,
           candidate.rsvp_url AS rsvp_url,
           candidate.rsvp_mode AS rsvp_mode,
           candidate.time_kind AS time_kind,
           candidate.starts_at_utc AS starts_at_utc,
           candidate.ends_at_utc AS ends_at_utc,
           candidate.timezone AS timezone,
           candidate.all_day_start_date AS all_day_start_date,
           candidate.all_day_end_date_exclusive
             AS all_day_end_date_exclusive,
           candidate.public_updated_at AS public_updated_at,
           candidate.source_rank AS source_rank,
           candidate.source_key AS source_key,
           candidate.source_identity_key AS source_identity_key,
           club_public.public_projection_token
             AS club_projection_token,
           program_public.public_projection_token
             AS program_projection_token,
           COALESCE(event.summary, candidate.source_public_summary)
             AS summary,
           COALESCE(event.description, candidate.source_public_description)
             AS description,
           CASE
             WHEN event.description IS NULL
             THEN candidate.source_public_description_blocks_json
             ELSE NULL
           END AS description_blocks_json,
           candidate.source_poster_source_url AS meetup_poster_source_url,
           candidate.source_poster_alt_text AS meetup_poster_alt_text,
           candidate.source_poster_credit AS meetup_poster_credit,
           NULL AS seo_title,
           NULL AS meta_description,
           COALESCE(
             public_detail.attendance_mode,
             'location_undecided'
           ) AS attendance_mode,
           club.slug AS club_slug,
           club.name AS club_name,
           program_public.public_slug AS program_slug,
           program_public.public_display_name AS program_name,
           lane.slug AS lane_slug,
           lane.name AS lane_name,
           category.slug AS category_slug,
           category.name AS category_name,
           category.color_token AS category_color_token,
           CASE
             WHEN event.venue_id IS NULL
             THEN candidate.source_public_venue_name
             WHEN venue.is_public = 1
             THEN venue.public_location_name
             ELSE NULL
           END AS venue_public_name,
           CASE
             WHEN event.venue_id IS NULL
             THEN candidate.source_public_venue_address
             WHEN venue.is_public = 1
             THEN venue.public_address
             ELSE NULL
           END AS venue_public_address,
           CASE
             WHEN event.venue_id IS NULL
             THEN candidate.source_public_floor
             ELSE NULL
           END AS venue_public_floor,
           CASE
             WHEN event.venue_id IS NULL
             THEN candidate.source_public_room
             ELSE NULL
           END AS venue_public_room,
           '[]' AS organizer_names_json,
           NULL AS public_access_note,
           NULL AS public_online_url,
           NULL AS external_map_url,
           candidate.source_cost_text AS cost_text,
           candidate.source_capacity AS capacity,
           candidate.source_age_policy_text AS age_policy_text,
           candidate.source_waitlist_available AS waitlist_available,
           candidate.source_availability_state AS availability_state,
           NULL AS preparation_information,
           NULL AS what_to_bring,
           candidate.source_arrival_instructions AS arrival_instructions,
           NULL AS weather_note,
           NULL AS verified_accessibility_notes,
           NULL AS artwork_asset_id,
           NULL AS artwork_alt_text,
           NULL AS artwork_credit,
           NULL AS artwork_focal_point_x,
           NULL AS artwork_focal_point_y,
           NULL AS artwork_small_width,
           NULL AS artwork_small_height,
           NULL AS artwork_medium_width,
           NULL AS artwork_medium_height,
           NULL AS artwork_large_width,
           NULL AS artwork_large_height,
           0 AS artwork_usage_count,
           0 AS artwork_private_preview
    FROM public_candidates AS candidate
    JOIN events AS event
      ON event.id = candidate.event_id
     AND event.organization_id = candidate.organization_id
     AND event.deleted_at IS NULL
    JOIN clubs AS club
      ON club.id = candidate.public_club_id
     AND club.organization_id = candidate.organization_id
     AND club.deleted_at IS NULL
    JOIN public_clubs AS club_public
      ON club_public.organization_id = candidate.organization_id
     AND club_public.club_id = candidate.public_club_id
     AND (
       club_public.publication_status = 'published'
       OR (
         club_public.publication_status = 'archived'
         AND ${historicalPublishedEventSql(
           "event",
           "time_kind",
           "status",
         )}
       )
     )
    LEFT JOIN event_public_details AS public_detail
      ON public_detail.organization_id = candidate.organization_id
     AND public_detail.event_id = candidate.event_id
    LEFT JOIN public_programs AS program_public
      ON program_public.organization_id = candidate.organization_id
     AND program_public.program_id = event.program_id
     AND program_public.club_id = candidate.public_club_id
     AND (
       program_public.publication_status = 'published'
       OR (
         program_public.publication_status = 'archived'
         AND ${historicalPublishedEventSql(
           "event",
           "time_kind",
           "status",
         )}
       )
     )
    LEFT JOIN event_lanes AS lane
      ON lane.organization_id = candidate.organization_id
     AND lane.id = COALESCE(
       event.event_lane_id,
       club_public.primary_event_lane_id
     )
    LEFT JOIN categories AS category
      ON category.organization_id = candidate.organization_id
     AND category.id = event.category_id
    LEFT JOIN venues AS venue
      ON venue.organization_id = candidate.organization_id
     AND venue.id = event.venue_id
     AND venue.deleted_at IS NULL
    WHERE ${publishedProgramProjectionResolvesSql(
      "event",
      "program_public",
    )}
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
           club_public.public_projection_token
             AS club_projection_token,
           program_public.public_projection_token
             AS program_projection_token,
           organizer_event.summary AS summary,
           organizer_event.description AS description,
           NULL AS description_blocks_json,
           NULL AS meetup_poster_source_url,
           NULL AS meetup_poster_alt_text,
           NULL AS meetup_poster_credit,
           public_metadata.seo_title AS seo_title,
           public_metadata.meta_description AS meta_description,
           public_detail.attendance_mode AS attendance_mode,
           club.slug AS club_slug,
           club.name AS club_name,
           program_public.public_slug AS program_slug,
           program_public.public_display_name AS program_name,
           lane.slug AS lane_slug,
           lane.name AS lane_name,
           category.slug AS category_slug,
           category.name AS category_name,
           category.color_token AS category_color_token,
           public_detail.public_location_name AS venue_public_name,
           public_detail.public_address AS venue_public_address,
           NULL AS venue_public_floor,
           NULL AS venue_public_room,
           '[]' AS organizer_names_json,
           public_detail.public_access_note AS public_access_note,
           public_detail.public_online_url AS public_online_url,
           public_detail.external_map_url AS external_map_url,
           public_detail.cost_text AS cost_text,
           public_detail.capacity AS capacity,
           NULL AS age_policy_text,
           NULL AS waitlist_available,
           public_detail.availability_state AS availability_state,
           public_detail.preparation_information AS preparation_information,
           public_detail.what_to_bring AS what_to_bring,
           public_detail.arrival_instructions AS arrival_instructions,
           public_detail.weather_note AS weather_note,
           public_detail.verified_accessibility_notes
             AS verified_accessibility_notes,
           NULL AS artwork_asset_id,
           NULL AS artwork_alt_text,
           NULL AS artwork_credit,
           NULL AS artwork_focal_point_x,
           NULL AS artwork_focal_point_y,
           NULL AS artwork_small_width,
           NULL AS artwork_small_height,
           NULL AS artwork_medium_width,
           NULL AS artwork_medium_height,
           NULL AS artwork_large_width,
           NULL AS artwork_large_height,
           0 AS artwork_usage_count,
           0 AS artwork_private_preview
    FROM organizer_events AS organizer_event
    JOIN organizer_event_public_details AS public_detail
      ON public_detail.organization_id = organizer_event.organization_id
     AND public_detail.organizer_event_id = organizer_event.id
    LEFT JOIN organizer_event_public_metadata AS public_metadata
      ON public_metadata.organization_id = organizer_event.organization_id
     AND public_metadata.organizer_event_id = organizer_event.id
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
    JOIN public_clubs AS club_public
      ON club_public.organization_id = organizer_event.organization_id
     AND club_public.club_id = organizer_event.club_id
     AND (
       club_public.publication_status = 'published'
       OR (
         club_public.publication_status = 'archived'
         AND ${historicalPublishedEventSql(
           "organizer_event",
           "schedule_shape",
           "planning_status",
         )}
         AND EXISTS (
           SELECT 1
           FROM cms_entity_publication_states AS archived_club_state
           WHERE archived_club_state.organization_id =
                 organizer_event.organization_id
             AND archived_club_state.entity_type =
                 'club_public_profile'
             AND archived_club_state.entity_key =
                 organizer_event.club_id
             AND archived_club_state.workflow_status = 'archived'
             AND archived_club_state.published_revision_id IS NOT NULL
         )
       )
     )
    LEFT JOIN public_programs AS program_public
      ON program_public.organization_id = organizer_event.organization_id
     AND program_public.program_id = organizer_event.program_id
     AND program_public.club_id = organizer_event.club_id
     AND (
       program_public.publication_status = 'published'
       OR (
         program_public.publication_status = 'archived'
         AND ${historicalPublishedEventSql(
           "organizer_event",
           "schedule_shape",
           "planning_status",
         )}
       )
     )
    LEFT JOIN event_lanes AS lane
      ON lane.organization_id = organizer_event.organization_id
     AND lane.id = COALESCE(
       organizer_event.event_lane_id,
       club_public.primary_event_lane_id
     )
    LEFT JOIN categories AS category
      ON category.organization_id = organizer_event.organization_id
     AND category.id = organizer_event.category_id
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
      AND ${publishedProgramProjectionResolvesSql(
        "organizer_event",
        "program_public",
      )}
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
    WHERE NOT (${protectedLegalClaimSql([
      "enriched.title",
      "enriched.summary",
      "enriched.description",
      "enriched.club_name",
      "enriched.lane_name",
      "enriched.category_name",
      "enriched.venue_public_name",
      "enriched.venue_public_address",
      "enriched.public_access_note",
      "enriched.cost_text",
      "enriched.preparation_information",
      "enriched.what_to_bring",
      "enriched.arrival_instructions",
      "enriched.weather_note",
      "enriched.verified_accessibility_notes",
      "enriched.seo_title",
      "enriched.meta_description",
    ])})
      AND NOT (${publicOrganizerEmailExposureSql(
        [
          "enriched.title",
          "enriched.summary",
          "enriched.description",
          "enriched.club_name",
          "enriched.lane_name",
          "enriched.category_name",
          "enriched.venue_public_name",
          "enriched.venue_public_address",
          "enriched.public_access_note",
          "enriched.cost_text",
          "enriched.preparation_information",
          "enriched.what_to_bring",
          "enriched.arrival_instructions",
          "enriched.weather_note",
          "enriched.verified_accessibility_notes",
          "enriched.seo_title",
          "enriched.meta_description",
        ],
        "enriched.organization_id",
      )})
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
`.replace(
  /\n[ \t]+/gu,
  "\n",
);

/**
 * Correlated variant used by the CMS receipt guard. The unified projection has
 * exactly three organization placeholders; replacing only those internal
 * placeholders keeps the receipt's dynamic-event proof identical to the
 * public event service without introducing a second event-eligibility model.
 */
export function unifiedPublicEventCteSqlForOrganization(
  organizationExpression: string,
): string {
  return UNIFIED_PUBLIC_EVENT_CTE_SQL.replace(
    /\?/gu,
    organizationExpression,
  );
}

const PUBLIC_EVENT_CARD_COLUMNS_SQL = `
  public_event.source_identity_key AS public_source_identity_key,
  public_event.public_updated_at AS public_source_version,
  public_event.club_projection_token AS public_club_projection_token,
  public_event.program_projection_token AS public_program_projection_token,
  public_event.slug AS slug,
  public_event.title AS title,
  public_event.summary AS summary,
  public_event.meetup_poster_source_url AS meetup_poster_source_url,
  public_event.meetup_poster_alt_text AS meetup_poster_alt_text,
  public_event.meetup_poster_credit AS meetup_poster_credit,
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
  public_event.program_slug AS program_slug,
  public_event.program_name AS program_name,
  public_event.lane_slug AS lane_slug,
  public_event.lane_name AS lane_name,
  public_event.category_slug AS category_slug,
  public_event.category_name AS category_name,
  public_event.category_color_token AS category_color_token,
  public_event.venue_public_name AS venue_public_name,
  public_event.venue_public_address AS venue_public_address,
  public_event.venue_public_floor AS venue_public_floor,
  public_event.venue_public_room AS venue_public_room,
  public_event.capacity AS capacity,
  public_event.cost_text AS cost_text,
  public_event.age_policy_text AS age_policy_text,
  public_event.waitlist_available AS waitlist_available,
  public_event.availability_state AS availability_state,
  public_event.arrival_instructions AS arrival_instructions,
  public_event.artwork_asset_id AS artwork_asset_id,
  public_event.artwork_alt_text AS artwork_alt_text,
  public_event.artwork_credit AS artwork_credit,
  public_event.artwork_focal_point_x AS artwork_focal_point_x,
  public_event.artwork_focal_point_y AS artwork_focal_point_y,
  public_event.artwork_small_width AS artwork_small_width,
  public_event.artwork_small_height AS artwork_small_height,
  public_event.artwork_medium_width AS artwork_medium_width,
  public_event.artwork_medium_height AS artwork_medium_height,
  public_event.artwork_large_width AS artwork_large_width,
  public_event.artwork_large_height AS artwork_large_height,
  public_event.artwork_usage_count AS artwork_usage_count,
  public_event.artwork_private_preview AS artwork_private_preview,
  public_event.event_id AS artwork_event_id,
  public_event.public_slug_count AS public_slug_count
`;

const PUBLIC_EVENT_EXPORT_COLUMNS_SQL = `
  public_event.source_identity_key AS public_source_identity_key,
  public_event.public_updated_at AS public_source_version,
  public_event.club_projection_token AS public_club_projection_token,
  public_event.program_projection_token AS public_program_projection_token,
  public_event.slug AS slug,
  public_event.title AS title,
  public_event.summary AS summary,
  public_event.description AS description,
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
  public_event.program_slug AS program_slug,
  public_event.program_name AS program_name,
  public_event.lane_slug AS lane_slug,
  public_event.lane_name AS lane_name,
  public_event.category_slug AS category_slug,
  public_event.category_name AS category_name,
  public_event.category_color_token AS category_color_token,
  public_event.venue_public_name AS venue_public_name,
  public_event.venue_public_address AS venue_public_address,
  public_event.venue_public_floor AS venue_public_floor,
  public_event.venue_public_room AS venue_public_room,
  public_event.capacity AS capacity,
  public_event.cost_text AS cost_text,
  public_event.age_policy_text AS age_policy_text,
  public_event.waitlist_available AS waitlist_available,
  public_event.availability_state AS availability_state,
  public_event.arrival_instructions AS arrival_instructions,
  public_event.event_id AS artwork_event_id,
  public_event.public_slug_count AS public_slug_count
`;

export const LEGACY_PUBLIC_EVENT_ORGANIZER_ENRICHMENT_SQL = `
  SELECT event.id AS artwork_event_id,
         ${legacyPublicOrganizersSql(
           "event.organization_id",
           "event.id",
         )} AS organizer_names_json
  FROM json_each(?) AS requested_event
  JOIN events AS event
    ON event.id = CAST(requested_event.value AS TEXT)
  WHERE event.organization_id = ?
    AND event.deleted_at IS NULL
`;

async function enrichCompatibilityPublicEventRows(
  database: Pick<D1DatabaseLike, "prepare">,
  organizationId: string,
  sourceRows: readonly Record<string, unknown>[],
): Promise<readonly Record<string, unknown>[]> {
  if (sourceRows.length === 0) return Object.freeze([]);
  const rows = sourceRows.map((row) => ({ ...row }));
  const eventIds = rows.map((row) =>
    parseIdentifier(row.artwork_event_id, "publicEvent.eventId"),
  );
  const enrichment = await database
    .prepare(LEGACY_PUBLIC_EVENT_ORGANIZER_ENRICHMENT_SQL)
    .bind(JSON.stringify(eventIds), organizationId)
    .all<Record<string, unknown>>();
  assertSuccessfulResult(enrichment);
  const organizerJsonByEventId = new Map(
    (enrichment.results ?? []).map((row) => [
      parseIdentifier(row.artwork_event_id, "publicEvent.eventId"),
      row.organizer_names_json,
    ]),
  );
  const currentRows = await revalidatePublicEventIdentityRows(
    database,
    organizationId,
    rows,
  );
  const currentProofs = new Set(
    currentRows.map((row) =>
      [
        parseIdentifier(
          row.public_source_identity_key,
          "publicEvent.sourceIdentity",
        ),
        parseIdentifier(row.slug, "publicEvent.slug"),
        parseFiniteInteger(row.public_source_version, {
          path: "publicEvent.sourceVersion",
          minimum: 0,
        }),
        parseBoundedString(row.public_club_projection_token, {
          path: "publicEvent.clubProjectionToken",
          minLength: 2,
          maxLength: 1_024,
        }),
        parseOptionalBoundedString(
          row.public_program_projection_token,
          {
            path: "publicEvent.programProjectionToken",
            maxLength: 1_024,
          },
        ) ?? "",
      ].join("\u0000"),
    ),
  );
  return Object.freeze(
    rows.flatMap((row) => {
      const eventId = parseIdentifier(
        row.artwork_event_id,
        "publicEvent.eventId",
      );
      const proof = [
        parseIdentifier(
          row.public_source_identity_key,
          "publicEvent.sourceIdentity",
        ),
        parseIdentifier(row.slug, "publicEvent.slug"),
        parseFiniteInteger(row.public_source_version, {
          path: "publicEvent.sourceVersion",
          minimum: 0,
        }),
        parseBoundedString(row.public_club_projection_token, {
          path: "publicEvent.clubProjectionToken",
          minLength: 2,
          maxLength: 1_024,
        }),
        parseOptionalBoundedString(
          row.public_program_projection_token,
          {
            path: "publicEvent.programProjectionToken",
            maxLength: 1_024,
          },
        ) ?? "",
      ].join("\u0000");
      const organizerNames = organizerJsonByEventId.get(eventId);
      return currentProofs.has(proof) && organizerNames !== undefined
        ? [Object.freeze({ ...row, organizer_names_json: organizerNames })]
        : [];
    }),
  );
}

const ORGANIZER_PUBLIC_EVENT_ENRICHMENT_SQL = `
  WITH ${ORGANIZER_PUBLIC_HOSTS_CTE_SQL}
  SELECT organizer_event.id AS artwork_event_id,
         CASE
           WHEN public_detail.public_hosts_enabled = 1
           THEN COALESCE(host_names.organizer_names_json, '[]')
           ELSE '[]'
         END AS organizer_names_json,
         artwork.artwork_asset_id,
         artwork.artwork_alt_text,
         artwork.artwork_credit,
         artwork.artwork_focal_point_x,
         artwork.artwork_focal_point_y,
         artwork.artwork_small_width,
         artwork.artwork_small_height,
         artwork.artwork_medium_width,
         artwork.artwork_medium_height,
         artwork.artwork_large_width,
         artwork.artwork_large_height,
         COALESCE(artwork.artwork_usage_count, 0) AS artwork_usage_count
  FROM json_each(?) AS requested_event
  JOIN organizer_events AS organizer_event
    ON organizer_event.id = CAST(requested_event.value AS TEXT)
  JOIN organizer_event_public_details AS public_detail
    ON public_detail.organization_id = organizer_event.organization_id
   AND public_detail.organizer_event_id = organizer_event.id
  LEFT JOIN organizer_public_host_names AS host_names
    ON host_names.organization_id = organizer_event.organization_id
   AND host_names.organizer_event_id = organizer_event.id
  LEFT JOIN organizer_event_artwork_candidates AS artwork
    ON artwork.organization_id = organizer_event.organization_id
   AND artwork.organizer_event_id = organizer_event.id
   AND artwork.publication_scope = 'published'
   AND artwork.artwork_rank = 1
  WHERE organizer_event.organization_id = ?
    AND organizer_event.publication_status = 'published'
    AND organizer_event.deleted_at IS NULL
`;

const PUBLIC_EVENT_ENRICHMENT_REVALIDATION_SQL = `
  ${PUBLIC_EVENT_IDENTITY_CTE_SQL},
  requested_public_event AS (
    SELECT json_extract(value, '$.sourceIdentity') AS source_identity_key,
           json_extract(value, '$.slug') AS slug,
           CAST(json_extract(value, '$.version') AS INTEGER)
             AS public_updated_at,
           json_extract(value, '$.clubProjectionToken')
             AS club_projection_token,
           json_extract(value, '$.programProjectionToken')
             AS program_projection_token
    FROM json_each(?)
  )
  SELECT public_event.source_identity_key,
         public_event.slug,
         public_event.public_updated_at,
         public_event.club_projection_token,
         public_event.program_projection_token
  FROM requested_public_event AS requested
  JOIN public_events AS public_event
    ON public_event.source_identity_key = requested.source_identity_key
   AND public_event.slug = requested.slug
   AND public_event.public_updated_at = requested.public_updated_at
   AND public_event.club_projection_token =
       requested.club_projection_token
   AND public_event.program_projection_token IS
       requested.program_projection_token
   AND public_event.public_slug_count = 1
`;

async function revalidatePublicEventIdentityRows(
  database: Pick<D1DatabaseLike, "prepare">,
  organizationId: string,
  rows: readonly Record<string, unknown>[],
): Promise<readonly Record<string, unknown>[]> {
  if (rows.length === 0) return Object.freeze([]);
  const requestedProofs = rows.map((row) =>
    Object.freeze({
      slug: parseIdentifier(row.slug, "publicEvent.slug"),
      sourceIdentity: parseIdentifier(
        row.public_source_identity_key,
        "publicEvent.sourceIdentity",
      ),
      version: parseFiniteInteger(
        row.public_source_version,
        {
          path: "publicEvent.sourceVersion",
          minimum: 0,
        },
      ),
      clubProjectionToken: parseBoundedString(
        row.public_club_projection_token,
        {
          path: "publicEvent.clubProjectionToken",
          minLength: 2,
          maxLength: 1_024,
        },
      ),
      programProjectionToken: parseOptionalBoundedString(
        row.public_program_projection_token,
        {
          path: "publicEvent.programProjectionToken",
          maxLength: 1_024,
        },
      ),
    }),
  );
  const revalidation = await database
    .prepare(PUBLIC_EVENT_ENRICHMENT_REVALIDATION_SQL)
    .bind(
      organizationId,
      organizationId,
      organizationId,
      JSON.stringify(requestedProofs),
    )
    .all<Record<string, unknown>>();
  assertSuccessfulResult(revalidation);
  const currentProofs = new Set(
    (revalidation.results ?? []).map((row) =>
      [
        parseIdentifier(
          row.source_identity_key,
          "publicEvent.sourceIdentity",
        ),
        parseIdentifier(row.slug, "publicEvent.slug"),
        parseFiniteInteger(row.public_updated_at, {
          path: "publicEvent.sourceVersion",
          minimum: 0,
        }),
        parseBoundedString(row.club_projection_token, {
          path: "publicEvent.clubProjectionToken",
          minLength: 2,
          maxLength: 1_024,
        }),
        parseOptionalBoundedString(row.program_projection_token, {
          path: "publicEvent.programProjectionToken",
          maxLength: 1_024,
        }) ?? "",
      ].join("\u0000"),
    ),
  );
  return Object.freeze(
    rows.filter((row) =>
      currentProofs.has(
        [
          parseIdentifier(
            row.public_source_identity_key,
            "publicEvent.sourceIdentity",
          ),
          parseIdentifier(row.slug, "publicEvent.slug"),
          parseFiniteInteger(row.public_source_version, {
            path: "publicEvent.sourceVersion",
            minimum: 0,
          }),
          parseBoundedString(row.public_club_projection_token, {
            path: "publicEvent.clubProjectionToken",
            minLength: 2,
            maxLength: 1_024,
          }),
          parseOptionalBoundedString(
            row.public_program_projection_token,
            {
              path: "publicEvent.programProjectionToken",
              maxLength: 1_024,
            },
          ) ?? "",
        ].join("\u0000"),
      ),
    ),
  );
}

async function enrichPublicEventRows(
  database: Pick<D1DatabaseLike, "prepare">,
  organizationId: string,
  sourceRows: readonly Record<string, unknown>[],
): Promise<readonly Record<string, unknown>[]> {
  if (sourceRows.length === 0) return Object.freeze([]);
  const rows = sourceRows.map((row) => ({ ...row }));
  for (const row of rows) assertSinglePublicSlug(row);
  const legacyEventIds = new Set<string>();
  const organizerEventIds = new Set<string>();
  for (const row of rows) {
    const sourceIdentity = parseIdentifier(
      row.public_source_identity_key,
      "publicEvent.sourceIdentity",
    );
    const eventId = parseIdentifier(
      row.artwork_event_id,
      "publicEvent.eventId",
    );
    (sourceIdentity.startsWith("organizer:")
      ? organizerEventIds
      : legacyEventIds
    ).add(eventId);
  }
  const enrichmentBySourceEvent = new Map<string, Record<string, unknown>>();
  if (legacyEventIds.size > 0) {
    const result = await database
      .prepare(LEGACY_PUBLIC_EVENT_ORGANIZER_ENRICHMENT_SQL)
      .bind(JSON.stringify([...legacyEventIds]), organizationId)
      .all<Record<string, unknown>>();
    assertSuccessfulResult(result);
    for (const row of result.results ?? []) {
      enrichmentBySourceEvent.set(
        `legacy:${parseIdentifier(
          row.artwork_event_id,
          "publicEvent.eventId",
        )}`,
        row,
      );
    }
  }
  if (organizerEventIds.size > 0) {
    const result = await database
      .prepare(ORGANIZER_PUBLIC_EVENT_ENRICHMENT_SQL)
      .bind(JSON.stringify([...organizerEventIds]), organizationId)
      .all<Record<string, unknown>>();
    assertSuccessfulResult(result);
    for (const row of result.results ?? []) {
      enrichmentBySourceEvent.set(
        `organizer:${parseIdentifier(
          row.artwork_event_id,
          "publicEvent.eventId",
        )}`,
        row,
      );
    }
  }
  const currentRows = await revalidatePublicEventIdentityRows(
    database,
    organizationId,
    rows,
  );
  const currentProofs = new Set(
    currentRows.map((row) =>
      [
        parseIdentifier(
          row.public_source_identity_key,
          "publicEvent.sourceIdentity",
        ),
        parseIdentifier(row.slug, "publicEvent.slug"),
        parseFiniteInteger(row.public_source_version, {
          path: "publicEvent.sourceVersion",
          minimum: 0,
        }),
        parseBoundedString(row.public_club_projection_token, {
          path: "publicEvent.clubProjectionToken",
          minLength: 2,
          maxLength: 1_024,
        }),
        parseOptionalBoundedString(
          row.public_program_projection_token,
          {
            path: "publicEvent.programProjectionToken",
            maxLength: 1_024,
          },
        ) ?? "",
      ].join("\u0000"),
    ),
  );
  return Object.freeze(
    rows.flatMap((row) => {
      const eventId = parseIdentifier(
        row.artwork_event_id,
        "publicEvent.eventId",
      );
      const sourceIdentity = parseIdentifier(
        row.public_source_identity_key,
        "publicEvent.sourceIdentity",
      );
      const enrichment = enrichmentBySourceEvent.get(
        `${sourceIdentity.startsWith("organizer:") ? "organizer" : "legacy"}:${eventId}`,
      );
      const proofKey = [
        sourceIdentity,
        parseIdentifier(row.slug, "publicEvent.slug"),
        parseFiniteInteger(row.public_source_version, {
          path: "publicEvent.sourceVersion",
          minimum: 0,
        }),
        parseBoundedString(row.public_club_projection_token, {
          path: "publicEvent.clubProjectionToken",
          minLength: 2,
          maxLength: 1_024,
        }),
        parseOptionalBoundedString(
          row.public_program_projection_token,
          {
            path: "publicEvent.programProjectionToken",
            maxLength: 1_024,
          },
        ) ?? "",
      ].join("\u0000");
      return enrichment && currentProofs.has(proofKey)
        ? [Object.freeze({ ...row, ...enrichment })]
        : [];
    }),
  );
}

const PUBLIC_EVENT_DETAIL_COLUMNS_SQL = `
  public_event.description AS description,
  public_event.description_blocks_json AS description_blocks_json,
  public_event.seo_title AS seo_title,
  public_event.meta_description AS meta_description,
  public_event.organizer_names_json AS organizer_names_json,
  public_event.public_access_note AS public_access_note,
  public_event.public_online_url AS public_online_url,
  public_event.external_map_url AS external_map_url,
  public_event.preparation_information AS preparation_information,
  public_event.what_to_bring AS what_to_bring,
  public_event.weather_note AS weather_note,
  public_event.verified_accessibility_notes AS verified_accessibility_notes
`;

const PUBLIC_EVENT_EMPTY_DETAIL_COLUMNS_SQL = `
  NULL AS description,
  NULL AS description_blocks_json,
  NULL AS seo_title,
  NULL AS meta_description,
  NULL AS organizer_names_json,
  NULL AS public_access_note,
  NULL AS public_online_url,
  NULL AS external_map_url,
  NULL AS preparation_information,
  NULL AS what_to_bring,
  NULL AS weather_note,
  NULL AS verified_accessibility_notes
`;

/**
 * This query is deliberately allowlisted and organization/id scoped. The
 * caller must still complete trusted SIWC membership and event authorization
 * before invoking it; the returned shape contains only facts that the live
 * public detail renderer is permitted to receive.
 */
export const AUTHORIZED_ORGANIZER_EVENT_PUBLIC_PREVIEW_SQL = `
  WITH public_event AS (
    SELECT organizer_event.id AS event_id,
           'organizer:' || organizer_event.id AS source_identity_key,
           organizer_event.updated_at AS public_updated_at,
           ${cmsProjectionVersionTokenSql(
             "organizer_event.organization_id",
             "club_public_profile",
             "organizer_event.club_id",
           )} AS club_projection_token,
           ${cmsProjectionVersionTokenSql(
             "organizer_event.organization_id",
             "program_public_profile",
             "organizer_event.program_id",
           )} AS program_projection_token,
           organizer_event.slug AS slug,
           organizer_event.title AS title,
           organizer_event.summary AS summary,
           organizer_event.description AS description,
           NULL AS description_blocks_json,
           NULL AS meetup_poster_source_url,
           NULL AS meetup_poster_alt_text,
           NULL AS meetup_poster_credit,
           public_metadata.seo_title AS seo_title,
           public_metadata.meta_description AS meta_description,
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
           program_public.public_slug AS program_slug,
           program_public.public_display_name AS program_name,
           lane.slug AS lane_slug,
           lane.name AS lane_name,
           category.slug AS category_slug,
           category.name AS category_name,
           category.color_token AS category_color_token,
           public_detail.public_location_name AS venue_public_name,
           public_detail.public_address AS venue_public_address,
           NULL AS venue_public_floor,
           NULL AS venue_public_room,
           1 AS public_slug_count,
           '[]' AS organizer_names_json,
           public_detail.public_access_note AS public_access_note,
           public_detail.public_online_url AS public_online_url,
           public_detail.external_map_url AS external_map_url,
           public_detail.cost_text AS cost_text,
           public_detail.capacity AS capacity,
           NULL AS age_policy_text,
           NULL AS waitlist_available,
           public_detail.availability_state AS availability_state,
           public_detail.preparation_information AS preparation_information,
           public_detail.what_to_bring AS what_to_bring,
           public_detail.arrival_instructions AS arrival_instructions,
           public_detail.weather_note AS weather_note,
           public_detail.verified_accessibility_notes
             AS verified_accessibility_notes,
           NULL AS artwork_asset_id,
           NULL AS artwork_alt_text,
           NULL AS artwork_credit,
           NULL AS artwork_focal_point_x,
           NULL AS artwork_focal_point_y,
           NULL AS artwork_small_width,
           NULL AS artwork_small_height,
           NULL AS artwork_medium_width,
           NULL AS artwork_medium_height,
           NULL AS artwork_large_width,
           NULL AS artwork_large_height,
           0 AS artwork_usage_count,
           1 AS artwork_private_preview,
           public_detail.public_hosts_enabled
             AS preview_public_hosts_enabled
    FROM organizer_events AS organizer_event
    JOIN organization_memberships AS preview_membership
      ON preview_membership.id = ?
     AND preview_membership.organization_id =
         organizer_event.organization_id
     AND preview_membership.profile_id = ?
     AND preview_membership.status = 'active'
     AND preview_membership.deleted_at IS NULL
    JOIN profiles AS preview_profile
      ON preview_profile.id = preview_membership.profile_id
     AND preview_profile.status = 'active'
     AND preview_profile.deleted_at IS NULL
    JOIN organizer_event_public_details AS public_detail
      ON public_detail.organization_id = organizer_event.organization_id
     AND public_detail.organizer_event_id = organizer_event.id
    LEFT JOIN organizer_event_public_metadata AS public_metadata
      ON public_metadata.organization_id = organizer_event.organization_id
     AND public_metadata.organizer_event_id = organizer_event.id
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
     AND (${publicClubProjectionParityD1Sql("club_public")})
    LEFT JOIN program_public_profile_details AS program_public
      ON program_public.organization_id = organizer_event.organization_id
     AND program_public.program_id = organizer_event.program_id
     AND program_public.club_id = organizer_event.club_id
     AND program_public.publication_status = 'published'
     AND program_public.published_at IS NOT NULL
     AND program_public.deleted_at IS NULL
     AND (${publicProgramProjectionParityD1Sql("program_public")})
    LEFT JOIN event_lanes AS lane
      ON lane.organization_id = organizer_event.organization_id
     AND lane.id = COALESCE(
       organizer_event.event_lane_id,
       club_public.primary_event_lane_id
     )
    LEFT JOIN categories AS category
      ON category.organization_id = organizer_event.organization_id
     AND category.id = organizer_event.category_id
    WHERE organizer_event.organization_id = ?
      AND organizer_event.id = ?
      AND organizer_event.planning_status IN (
        'confirmed',
        'cancelled',
        'completed'
      )
      AND organizer_event.schedule_shape IN ('timed', 'all_day')
      AND organizer_event.deleted_at IS NULL
      AND (
        preview_membership.role IN ('owner', 'administrator')
        OR (
          preview_membership.role = 'organizer'
          AND (
            organizer_event.primary_organizer_profile_id =
                preview_membership.profile_id
            OR EXISTS (
              SELECT 1
              FROM organizer_event_organizers AS association
              WHERE association.organization_id =
                      organizer_event.organization_id
                AND association.organizer_event_id = organizer_event.id
                AND association.profile_id =
                      preview_membership.profile_id
                AND association.deleted_at IS NULL
            )
          )
          AND EXISTS (
            SELECT 1
            FROM club_memberships AS assignment
            WHERE assignment.organization_id =
                    organizer_event.organization_id
              AND assignment.club_id = organizer_event.club_id
              AND assignment.organization_membership_id =
                    preview_membership.id
              AND assignment.profile_id =
                    preview_membership.profile_id
              AND assignment.role = 'organizer'
              AND assignment.status = 'active'
              AND assignment.deleted_at IS NULL
          )
        )
      )
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

export const AUTHORIZED_ORGANIZER_EVENT_PUBLIC_PREVIEW_ENRICHMENT_SQL = `
  WITH ${ORGANIZER_PUBLIC_HOSTS_CTE_SQL}
  SELECT organizer_event.id AS artwork_event_id,
         CASE
           WHEN public_detail.public_hosts_enabled = 1
           THEN COALESCE(host_names.organizer_names_json, '[]')
           ELSE '[]'
         END AS organizer_names_json,
         artwork.artwork_asset_id,
         artwork.artwork_alt_text,
         artwork.artwork_credit,
         artwork.artwork_focal_point_x,
         artwork.artwork_focal_point_y,
         artwork.artwork_small_width,
         artwork.artwork_small_height,
         artwork.artwork_medium_width,
         artwork.artwork_medium_height,
         artwork.artwork_large_width,
         artwork.artwork_large_height,
         COALESCE(artwork.artwork_usage_count, 0) AS artwork_usage_count
  FROM organizer_events AS organizer_event
  JOIN organization_memberships AS preview_membership
    ON preview_membership.id = ?
   AND preview_membership.organization_id =
       organizer_event.organization_id
   AND preview_membership.profile_id = ?
   AND preview_membership.status = 'active'
   AND preview_membership.deleted_at IS NULL
  JOIN profiles AS preview_profile
    ON preview_profile.id = preview_membership.profile_id
   AND preview_profile.status = 'active'
   AND preview_profile.deleted_at IS NULL
  JOIN organizer_event_public_details AS public_detail
    ON public_detail.organization_id = organizer_event.organization_id
   AND public_detail.organizer_event_id = organizer_event.id
  LEFT JOIN organizer_public_host_names AS host_names
    ON host_names.organization_id = organizer_event.organization_id
   AND host_names.organizer_event_id = organizer_event.id
  LEFT JOIN organizer_event_artwork_candidates AS artwork
    ON artwork.organization_id = organizer_event.organization_id
   AND artwork.organizer_event_id = organizer_event.id
   AND artwork.publication_scope = 'draft'
   AND artwork.artwork_rank = 1
  WHERE organizer_event.organization_id = ?
    AND organizer_event.id = ?
    AND organizer_event.deleted_at IS NULL
    AND (
      preview_membership.role IN ('owner', 'administrator')
      OR (
        preview_membership.role = 'organizer'
        AND (
          organizer_event.primary_organizer_profile_id =
              preview_membership.profile_id
          OR EXISTS (
            SELECT 1
            FROM organizer_event_organizers AS association
            WHERE association.organization_id =
                    organizer_event.organization_id
              AND association.organizer_event_id = organizer_event.id
              AND association.profile_id =
                    preview_membership.profile_id
              AND association.deleted_at IS NULL
          )
        )
        AND EXISTS (
          SELECT 1
          FROM club_memberships AS assignment
          WHERE assignment.organization_id =
                  organizer_event.organization_id
            AND assignment.club_id = organizer_event.club_id
            AND assignment.organization_membership_id =
                  preview_membership.id
            AND assignment.profile_id =
                  preview_membership.profile_id
            AND assignment.role = 'organizer'
            AND assignment.status = 'active'
            AND assignment.deleted_at IS NULL
        )
      )
    )
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
  const programSlug = optionalIdentifier(input.programSlug, "programSlug");
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
    programSlug,
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

function parsePublicCalendarMonthQuery(
  input: QueryPublicCalendarMonthInput,
): ParsedPublicCalendarMonthQuery {
  const parsed = parsePublicEventQuery({
    ...input,
    page: 1,
    pageSize: 48,
    view: "upcoming",
  });
  if (
    parsed.fromDate === null ||
    parsed.fromUtcMs === null ||
    parsed.toDate === null ||
    parsed.toDateExclusive === null ||
    parsed.toUtcMsExclusive === null
  ) {
    throw validationIssue(
      "fromDate",
      "invalid_date_range",
      "Calendar month bounds are required.",
    );
  }
  return parsed as ParsedPublicCalendarMonthQuery;
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
  const enrichedRows = await enrichPublicEventRows(
    database,
    parsed.organizationId,
    result.results ?? [],
  );
  const events = Object.freeze(
    enrichedRows.map((row) => toPublicEventCardDto(row)),
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

/**
 * Reads one bounded card slice without running a second full-projection count.
 * Use this for surfaces such as Home and Calendar that never display an exact
 * result total. A limit-plus-one row proves whether another page exists, while
 * every row that could be exposed still passes the public-slug collision and
 * source/Club/Program revalidation boundary.
 */
export async function queryPublicEventSlice(
  database: Pick<D1DatabaseLike, "prepare">,
  input: QueryPublicEventsInput,
): Promise<PublicEventSliceDto> {
  const parsed = parsePublicEventQuery(input);
  const filter = buildPublicEventFilter(parsed);
  const commonBindings: D1Value[] = [
    parsed.organizationId,
    parsed.organizationId,
    parsed.organizationId,
    ...filter.bindings,
  ];
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
    .bind(...commonBindings, parsed.pageSize + 1, offset)
    .all<Record<string, unknown>>();
  assertSuccessfulResult(result);
  const rows = result.results ?? [];
  for (const row of rows) assertSinglePublicSlug(row);
  const hasMore = rows.length > parsed.pageSize;
  const enrichedRows = await enrichPublicEventRows(
    database,
    parsed.organizationId,
    rows.slice(0, parsed.pageSize),
  );
  return Object.freeze({
    events: Object.freeze(
      enrichedRows.map((row) => toPublicEventCardDto(row)),
    ),
    hasMore,
    page: parsed.page,
    pageSize: parsed.pageSize,
    view: parsed.view,
  });
}

const MAX_NEXT_PUBLIC_EVENT_CLUBS = 12;

/**
 * Reads the nearest upcoming published event for each requested public Club.
 *
 * The requested slugs are normalized and deduplicated before one unified
 * projection is ranked by Club. Selected rows still pass the same enrichment
 * and current-publication revalidation boundary as every other public card
 * surface, so this directory-oriented read cannot turn into an N+1 query or
 * expose a stale projection.
 */
export async function listNextPublicEventsByClub(
  database: Pick<D1DatabaseLike, "prepare">,
  input: ListNextPublicEventsByClubInput,
): Promise<readonly PublicEventCardDto[]> {
  const parsed = parsePublicEventQuery({
    nowUtcMs: input.nowUtcMs,
    organizationId: input.organizationId,
    page: 1,
    pageSize: MAX_NEXT_PUBLIC_EVENT_CLUBS,
    todayDate: input.todayDate,
    view: "upcoming",
  });
  const clubSlugs = parseNextPublicEventClubSlugs(input.clubSlugs);
  if (clubSlugs.length === 0) return Object.freeze([]);

  const filter = buildPublicEventFilter(parsed);
  const result = await database
    .prepare(
      `${UNIFIED_PUBLIC_EVENT_CTE_SQL},
       requested_club AS (
         SELECT CAST(key AS INTEGER) AS requested_order,
                CAST(value AS TEXT) AS club_slug
         FROM json_each(?)
       ),
       ranked_club_event AS (
         SELECT public_event.*,
                requested_club.requested_order,
                row_number() OVER (
                  PARTITION BY public_event.club_slug
                  ORDER BY ${publicEventOrderExpression("upcoming")}
                ) AS club_event_ordinal
         FROM public_events AS public_event
         JOIN requested_club
           ON requested_club.club_slug = public_event.club_slug
         WHERE ${filter.sql}
       )
       SELECT ${PUBLIC_EVENT_CARD_COLUMNS_SQL},
              public_event.requested_order
       FROM ranked_club_event AS public_event
       WHERE public_event.club_event_ordinal = 1
       ORDER BY public_event.requested_order`,
    )
    .bind(
      parsed.organizationId,
      parsed.organizationId,
      parsed.organizationId,
      JSON.stringify(clubSlugs),
      ...filter.bindings,
    )
    .all<Record<string, unknown>>();
  assertSuccessfulResult(result);
  const rows = result.results ?? [];
  for (const row of rows) assertSinglePublicSlug(row);
  const enrichedRows = await enrichPublicEventRows(
    database,
    parsed.organizationId,
    rows,
  );
  return Object.freeze(
    enrichedRows.map((row) => toPublicEventCardDto(row)),
  );
}

const PUBLIC_CALENDAR_MONTH_EVENT_LIMIT = 96;
const PUBLIC_EVENT_MATERIALIZATION_UPCOMING_LIMIT = 48;
const PUBLIC_EVENT_MATERIALIZATION_DETAIL_LIMIT = 512;
const PUBLIC_EVENT_MATERIALIZATION_CALENDAR_LIMIT =
  PUBLIC_CALENDAR_MONTH_EVENT_LIMIT * 27;

/**
 * Updater-only projection for durable Home and Events materializations.
 *
 * One materialized public-event CTE reads the complete supported calendar
 * window, the bounded Home reserve, and every bounded public detail DTO. The
 * returned rows pass the same enrichment and current publication revalidation
 * boundary as every other public surface. The hard calendar cap retains 96
 * rows in each UI-reachable month, while the independent detail cap rejects a
 * growing catalog instead of silently dropping public routes. The
 * materializer applies the stricter per-month and payload-size bounds before
 * atomically publishing all three rows.
 */
export async function queryPublicEventMaterializationBundle(
  database: Pick<D1DatabaseLike, "prepare">,
  input: QueryPublicEventMaterializationBundleInput,
): Promise<PublicEventMaterializationBundleDto> {
  const calendar = parsePublicCalendarMonthQuery(input.calendar);
  const upcoming = parsePublicEventQuery({
    nowUtcMs: calendar.nowUtcMs,
    organizationId: calendar.organizationId,
    page: 1,
    pageSize: PUBLIC_EVENT_MATERIALIZATION_UPCOMING_LIMIT,
    todayDate: calendar.todayDate,
    view: "upcoming",
  });
  const calendarFilter = buildPublicCalendarMonthFilter(calendar);
  const upcomingFilter = buildPublicEventFilter(upcoming);
  const upcomingOrder = publicEventOrderExpression("upcoming");
  const laneBindings = [...PUBLIC_EVENT_LANE_SLUGS];
  const result = await database
    .prepare(
      `${UNIFIED_PUBLIC_EVENT_CTE_SQL},
       materialization_public_events AS MATERIALIZED (
         SELECT *
         FROM public_events
       ),
       materialization_calendar AS (
         SELECT public_event.*,
                row_number() OVER (
                  ORDER BY ${upcomingOrder}
                ) AS public_result_ordinal
         FROM materialization_public_events AS public_event
         WHERE ${calendarFilter.sql}
         ORDER BY ${upcomingOrder}
         LIMIT ?
       ),
       materialization_upcoming_ranked AS (
         SELECT public_event.*,
                row_number() OVER (
                  ORDER BY ${upcomingOrder}
                ) AS public_result_ordinal,
                row_number() OVER (
                  PARTITION BY public_event.lane_slug
                  ORDER BY ${upcomingOrder}
                ) AS public_lane_ordinal
         FROM materialization_public_events AS public_event
         WHERE ${upcomingFilter.sql}
       ),
       materialization_upcoming AS (
         SELECT *
         FROM materialization_upcoming_ranked
         WHERE public_result_ordinal <= ${PUBLIC_EVENT_MATERIALIZATION_UPCOMING_LIMIT}
            OR (
              public_lane_ordinal = 1
              AND lane_slug IN (?, ?, ?, ?)
            )
       ),
       materialization_details AS (
         SELECT public_event.*,
                row_number() OVER (
                  ORDER BY ${upcomingOrder}
                ) AS public_result_ordinal
         FROM materialization_public_events AS public_event
         ORDER BY ${upcomingOrder}
         LIMIT ?
       )
       SELECT 'calendar' AS public_result_kind,
              public_event.public_result_ordinal,
              ${PUBLIC_EVENT_CARD_COLUMNS_SQL},
              ${PUBLIC_EVENT_EMPTY_DETAIL_COLUMNS_SQL}
       FROM materialization_calendar AS public_event
       UNION ALL
       SELECT 'upcoming' AS public_result_kind,
              public_event.public_result_ordinal,
              ${PUBLIC_EVENT_CARD_COLUMNS_SQL},
              ${PUBLIC_EVENT_EMPTY_DETAIL_COLUMNS_SQL}
       FROM materialization_upcoming AS public_event
       UNION ALL
       SELECT 'detail' AS public_result_kind,
              public_event.public_result_ordinal,
              ${PUBLIC_EVENT_CARD_COLUMNS_SQL},
              ${PUBLIC_EVENT_DETAIL_COLUMNS_SQL}
       FROM materialization_details AS public_event
       ORDER BY public_result_kind, public_result_ordinal`,
    )
    .bind(
      calendar.organizationId,
      calendar.organizationId,
      calendar.organizationId,
      ...calendarFilter.bindings,
      PUBLIC_EVENT_MATERIALIZATION_CALENDAR_LIMIT + 1,
      ...upcomingFilter.bindings,
      ...laneBindings,
      PUBLIC_EVENT_MATERIALIZATION_DETAIL_LIMIT + 1,
    )
    .all<Record<string, unknown>>();
  assertSuccessfulResult(result);
  const rows = result.results ?? [];
  for (const row of rows) assertSinglePublicSlug(row);
  const calendarRows = rows.filter(
    (row) => row.public_result_kind === "calendar",
  );
  if (calendarRows.length > PUBLIC_EVENT_MATERIALIZATION_CALENDAR_LIMIT) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The public event materialization exceeds its safe row limit.",
    );
  }
  const upcomingRows = rows.filter(
    (row) => row.public_result_kind === "upcoming",
  );
  const detailRows = rows.filter(
    (row) => row.public_result_kind === "detail",
  );
  if (detailRows.length > PUBLIC_EVENT_MATERIALIZATION_DETAIL_LIMIT) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The public event-detail materialization exceeds its safe row limit.",
    );
  }
  const uniqueRows = new Map<string, Record<string, unknown>>();
  for (const row of [...calendarRows, ...upcomingRows, ...detailRows]) {
    uniqueRows.set(publicEventResultIdentity(row), row);
  }
  const enrichedRows = await enrichPublicEventRows(
    database,
    calendar.organizationId,
    [...uniqueRows.values()],
  );
  const enrichedRowByIdentity = new Map(
    enrichedRows.map((row) => [publicEventResultIdentity(row), row]),
  );
  if (
    enrichedRows.length !== uniqueRows.size ||
    enrichedRowByIdentity.size !== uniqueRows.size ||
    [...uniqueRows.keys()].some(
      (identity) => !enrichedRowByIdentity.has(identity),
    )
  ) {
    invalidProjection();
  }
  const eventByIdentity = new Map(
    enrichedRows.map((row) => [
      publicEventResultIdentity(row),
      toPublicEventCardDto(row),
    ]),
  );
  const eventsFor = (
    sourceRows: readonly Record<string, unknown>[],
  ): readonly PublicEventCardDto[] =>
    Object.freeze(
      sourceRows.map((row) => {
        const event = eventByIdentity.get(publicEventResultIdentity(row));
        if (!event) return invalidProjection();
        return event;
      }),
    );
  return Object.freeze({
    calendarEvents: eventsFor(calendarRows),
    eventDetails: Object.freeze(
      detailRows.map((row) => {
        const enriched = enrichedRowByIdentity.get(
          publicEventResultIdentity(row),
        );
        if (!enriched) return invalidProjection();
        return toPublicEventDetailDto(enriched);
      }),
    ),
    upcomingEvents: eventsFor(upcomingRows),
  });
}

/**
 * Reads one calendar month and (when needed) the nearest upcoming event from
 * one materialized public-event projection. The two bounded result groups are
 * labelled in SQL, enriched once, then rebuilt into the same DTOs used by the
 * standalone public queries.
 */
export async function queryPublicCalendarLandingBundle(
  database: Pick<D1DatabaseLike, "prepare">,
  input: QueryPublicCalendarLandingBundleInput,
): Promise<PublicCalendarLandingBundleDto> {
  const calendar = parsePublicCalendarMonthQuery(input.calendar);
  const landing = parsePublicEventQuery({
    laneSlug: calendar.laneSlug,
    nowUtcMs: calendar.nowUtcMs,
    organizationId: calendar.organizationId,
    page: 1,
    pageSize: 1,
    todayDate: calendar.todayDate,
    view: "upcoming",
  });
  const calendarFilter = buildPublicCalendarMonthFilter(calendar);
  const landingFilter = buildPublicEventFilter(landing);
  const upcomingOrder = publicEventOrderExpression("upcoming");
  const result = await database
    .prepare(
      `${UNIFIED_PUBLIC_EVENT_CTE_SQL},
       events_page_public_events AS MATERIALIZED (
         SELECT *
         FROM public_events
       ),
       events_page_calendar AS (
         SELECT public_event.*,
                row_number() OVER (
                  ORDER BY ${upcomingOrder}
                ) AS public_result_ordinal
         FROM events_page_public_events AS public_event
         WHERE ${calendarFilter.sql}
         ORDER BY ${upcomingOrder}
         LIMIT ?
       ),
       events_page_landing AS (
         SELECT public_event.*,
                row_number() OVER (
                  ORDER BY ${upcomingOrder}
                ) AS public_result_ordinal
         FROM events_page_public_events AS public_event
         WHERE ? = 1
           AND ${landingFilter.sql}
         ORDER BY ${upcomingOrder}
         LIMIT 1
       )
       SELECT 'calendar' AS public_result_kind,
              public_event.public_result_ordinal,
              ${PUBLIC_EVENT_CARD_COLUMNS_SQL}
       FROM events_page_calendar AS public_event
       UNION ALL
       SELECT 'landing' AS public_result_kind,
              public_event.public_result_ordinal,
              ${PUBLIC_EVENT_CARD_COLUMNS_SQL}
       FROM events_page_landing AS public_event
       ORDER BY public_result_kind, public_result_ordinal`,
    )
    .bind(
      calendar.organizationId,
      calendar.organizationId,
      calendar.organizationId,
      ...calendarFilter.bindings,
      PUBLIC_CALENDAR_MONTH_EVENT_LIMIT + 1,
      input.includeLandingEvent === true ? 1 : 0,
      ...landingFilter.bindings,
    )
    .all<Record<string, unknown>>();
  assertSuccessfulResult(result);
  const rows = result.results ?? [];
  for (const row of rows) assertSinglePublicSlug(row);
  const calendarRows = rows.filter(
    (row) => row.public_result_kind === "calendar",
  );
  const landingRows = rows.filter(
    (row) => row.public_result_kind === "landing",
  );
  const rowsToRender = [
    ...calendarRows.slice(0, PUBLIC_CALENDAR_MONTH_EVENT_LIMIT),
    ...landingRows.slice(0, 1),
  ];
  const uniqueRows = new Map<string, Record<string, unknown>>();
  for (const row of rowsToRender) {
    uniqueRows.set(publicEventResultIdentity(row), row);
  }
  const enrichedRows = await enrichPublicEventRows(
    database,
    calendar.organizationId,
    [...uniqueRows.values()],
  );
  const eventByIdentity = new Map(
    enrichedRows.map((row) => [
      publicEventResultIdentity(row),
      toPublicEventCardDto(row),
    ]),
  );
  const eventsFor = (
    sourceRows: readonly Record<string, unknown>[],
  ): readonly PublicEventCardDto[] =>
    Object.freeze(
      sourceRows.flatMap((row) => {
        const event = eventByIdentity.get(publicEventResultIdentity(row));
        return event ? [event] : [];
      }),
    );
  const renderedCalendarRows = calendarRows.slice(
    0,
    PUBLIC_CALENDAR_MONTH_EVENT_LIMIT,
  );
  return Object.freeze({
    calendar: Object.freeze({
      events: eventsFor(renderedCalendarRows),
      hasMore:
        calendarRows.length > PUBLIC_CALENDAR_MONTH_EVENT_LIMIT,
    }),
    landingEvent: eventsFor(landingRows.slice(0, 1))[0] ?? null,
  });
}

/**
 * Reads the calendar's complete past/upcoming union with one unified public
 * projection. Confirmed and tentative events remain visible on either side of
 * now; completed events are included only after they end, exactly matching the
 * two list-query union that the month view previously assembled.
 */
export async function queryPublicCalendarMonth(
  database: Pick<D1DatabaseLike, "prepare">,
  input: QueryPublicCalendarMonthInput,
): Promise<PublicCalendarMonthDto> {
  const parsed = parsePublicCalendarMonthQuery(input);
  const filter = buildPublicCalendarMonthFilter(parsed);
  const result = await database
    .prepare(
      `${UNIFIED_PUBLIC_EVENT_CTE_SQL}
       SELECT ${PUBLIC_EVENT_CARD_COLUMNS_SQL}
       FROM public_events AS public_event
       WHERE ${filter.sql}
       ${publicEventOrderSql("upcoming")}
       LIMIT ?`,
    )
    .bind(
      parsed.organizationId,
      parsed.organizationId,
      parsed.organizationId,
      ...filter.bindings,
      PUBLIC_CALENDAR_MONTH_EVENT_LIMIT + 1,
    )
    .all<Record<string, unknown>>();
  assertSuccessfulResult(result);
  const rows = result.results ?? [];
  for (const row of rows) assertSinglePublicSlug(row);
  const enrichedRows = await enrichPublicEventRows(
    database,
    parsed.organizationId,
    rows.slice(0, PUBLIC_CALENDAR_MONTH_EVENT_LIMIT),
  );
  return Object.freeze({
    events: Object.freeze(
      enrichedRows.map((row) => toPublicEventCardDto(row)),
    ),
    hasMore: rows.length > PUBLIC_CALENDAR_MONTH_EVENT_LIMIT,
  });
}

/**
 * Bounded export projection.
 *
 * This deliberately reuses the exact unified public-event projection,
 * collision proof and source/Club/Program revalidation used by the rendered
 * event routes. The export-specific select excludes artwork and rich host
 * joins because neither is part of an event-file allowlist. A limit-plus-one
 * read rejects oversized exports instead of truncating or paging into D1's
 * per-invocation statement ceiling.
 */
export async function queryPublicEventsForExport(
  database: Pick<D1DatabaseLike, "prepare">,
  input: QueryPublicEventExportsInput,
): Promise<readonly PublicEventExportRecord[]> {
  const maxEvents = parseFiniteInteger(input.maxEvents, {
    path: "maxEvents",
    minimum: 1,
    maximum: 2_000,
  });
  const parsed = parsePublicEventQuery({
    ...input,
    page: 1,
    pageSize: 1,
  });
  const filter = buildPublicEventFilter(parsed, {
    includeCancelled: true,
  });
  const commonBindings: D1Value[] = [
    parsed.organizationId,
    parsed.organizationId,
    parsed.organizationId,
    ...filter.bindings,
  ];
  const result = await database
    .prepare(
      `${UNIFIED_PUBLIC_EVENT_CTE_SQL}
       SELECT ${PUBLIC_EVENT_EXPORT_COLUMNS_SQL}
       FROM public_events AS public_event
       WHERE ${filter.sql}
       ${publicEventOrderSql(parsed.view)}
       LIMIT ?`,
    )
    .bind(...commonBindings, maxEvents + 1)
    .all<Record<string, unknown>>();
  assertSuccessfulResult(result);
  const sourceRows = result.results ?? [];
  if (sourceRows.length > maxEvents) {
    throw validationIssue(
      "filters",
      "result_limit_exceeded",
      "Narrow the filters before downloading this export.",
    );
  }
  if (
    sourceRows.some((row) =>
      parseFiniteInteger(row.public_slug_count, {
        path: "publicEventExport.publicSlugCount",
        minimum: 0,
      }) !== 1
    )
  ) {
    invalidProjection();
  }
  const currentRows = await revalidatePublicEventIdentityRows(
    database,
    parsed.organizationId,
    sourceRows,
  );
  if (currentRows.length !== sourceRows.length) invalidProjection();
  return Object.freeze(
    currentRows.map(publicEventExportRecord),
  );
}

/**
 * Final, bounded public-export proof used after calendar revision
 * reconciliation. The source identity/version prevents an event edit from
 * racing the emitted component, while the opaque Club/Program projection
 * tokens retain exact current receipt/revision/live parity without repeating
 * the large public DTO query.
 */
export async function revalidatePublicEventExportRecords(
  database: Pick<D1DatabaseLike, "prepare">,
  input: Readonly<{
    organizationId: unknown;
    records: readonly PublicEventExportRecord[];
  }>,
): Promise<boolean> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  if (!Array.isArray(input.records) || input.records.length > 500) {
    throw validationIssue(
      "records",
      "invalid_length",
      "At most 500 public event export records may be revalidated at once.",
    );
  }
  if (input.records.length === 0) return true;

  const sourceIdentities = new Set<string>();
  const slugs = new Set<string>();
  const rows = input.records.map((record, index) => {
    const sourceIdentity = parseIdentifier(
      record.sourceIdentity,
      `records.${index}.sourceIdentity`,
    );
    const slug = parseIdentifier(record.event.slug, `records.${index}.slug`);
    if (sourceIdentities.has(sourceIdentity) || slugs.has(slug)) {
      return invalidProjection();
    }
    sourceIdentities.add(sourceIdentity);
    slugs.add(slug);
    return Object.freeze({
      public_club_projection_token: parseBoundedString(
        record.clubProjectionToken,
        {
          path: `records.${index}.clubProjectionToken`,
          minLength: 2,
          maxLength: 1_024,
        },
      ),
      public_program_projection_token: parseOptionalBoundedString(
        record.programProjectionToken,
        {
          path: `records.${index}.programProjectionToken`,
          maxLength: 1_024,
        },
      ),
      public_source_identity_key: sourceIdentity,
      public_source_version: parseFiniteInteger(record.sourceVersion, {
        path: `records.${index}.sourceVersion`,
        minimum: 0,
      }),
      slug,
    });
  });
  const currentRows = await revalidatePublicEventIdentityRows(
    database,
    organizationId,
    rows,
  );
  return currentRows.length === rows.length;
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
  if (!row) return null;
  const [enrichedRow] = await enrichPublicEventRows(
    database,
    organizationId,
    [row],
  );
  return enrichedRow ? toPublicEventDetailDto(enrichedRow) : null;
}

export async function getPublicEventExportRecordBySlug(
  database: Pick<D1DatabaseLike, "prepare">,
  input: GetPublicEventInput,
): Promise<PublicEventExportRecord | null> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  const slug = parseIdentifier(input.slug, "slug");
  const row = await database
    .prepare(
      `${UNIFIED_PUBLIC_EVENT_CTE_SQL}
       SELECT ${PUBLIC_EVENT_EXPORT_COLUMNS_SQL}
       FROM public_events AS public_event
       WHERE public_event.slug = ?
       LIMIT 1`,
    )
    .bind(organizationId, organizationId, organizationId, slug)
    .first<Record<string, unknown>>();
  if (!row) return null;
  if (
    parseFiniteInteger(row.public_slug_count, {
      path: "publicEventExport.publicSlugCount",
      minimum: 0,
    }) !== 1
  ) {
    invalidProjection();
  }
  const [currentRow] = await revalidatePublicEventIdentityRows(
    database,
    organizationId,
    [row],
  );
  return currentRow ? publicEventExportRecord(currentRow) : null;
}

export async function getPublicEventsBySlugs(
  database: Pick<D1DatabaseLike, "prepare">,
  input: Readonly<{
    organizationId: string;
    slugs: readonly string[];
  }>,
): Promise<readonly PublicEventCardDto[]> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  if (!Array.isArray(input.slugs) || input.slugs.length > 12) {
    throw validationIssue(
      "slugs",
      "invalid_length",
      "At most 12 published event slugs may be selected.",
    );
  }
  const seen = new Set<string>();
  const slugs = input.slugs.flatMap((value, index) => {
    const slug = parseIdentifier(value, `slugs.${index}`);
    if (seen.has(slug)) return [];
    seen.add(slug);
    return [slug];
  });
  if (slugs.length === 0) return Object.freeze([]);
  const result = await database
    .prepare(
      `${UNIFIED_PUBLIC_EVENT_CTE_SQL},
       requested_slug AS (
         SELECT CAST(key AS INTEGER) AS requested_order,
                value AS slug
         FROM json_each(?)
       )
       SELECT ${PUBLIC_EVENT_CARD_COLUMNS_SQL}
       FROM requested_slug
       JOIN public_events AS public_event
         ON public_event.slug = requested_slug.slug
        AND public_event.public_slug_count = 1
       ORDER BY requested_slug.requested_order ASC
       LIMIT 12`,
    )
    .bind(
      organizationId,
      organizationId,
      organizationId,
      JSON.stringify(slugs),
    )
    .all<Record<string, unknown>>();
  const enrichedRows = await enrichPublicEventRows(
    database,
    organizationId,
    result.results ?? [],
  );
  return Object.freeze(
    enrichedRows.map((row) => toPublicEventCardDto(row)),
  );
}

/**
 * Returns one bounded private-editor choice list from the exact unified
 * public projection. Pending/failed Meetup generations and every other
 * nonpublic source are therefore excluded by construction.
 */
export async function listPublishedEventSelections(
  database: Pick<D1DatabaseLike, "prepare">,
  input: Readonly<{
    limit?: unknown;
    organizationId: unknown;
  }>,
): Promise<readonly PublishedEventSelection[]> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  const limit = parseFiniteInteger(input.limit ?? 100, {
    path: "limit",
    minimum: 1,
    maximum: 100,
  });
  const result = await database
    .prepare(
      `${UNIFIED_PUBLIC_EVENT_CTE_SQL}
       SELECT public_event.source_identity_key AS selection_id,
              public_event.source_identity_key
                AS public_source_identity_key,
              public_event.public_updated_at AS public_source_version,
              public_event.club_projection_token
                AS public_club_projection_token,
              public_event.program_projection_token
                AS public_program_projection_token,
              public_event.slug,
              public_event.title
       FROM public_events AS public_event
       WHERE public_event.public_slug_count = 1
       ORDER BY
         CASE public_event.event_status
           WHEN 'confirmed' THEN 0
           WHEN 'tentative' THEN 1
           WHEN 'completed' THEN 2
           ELSE 3
         END,
         COALESCE(
           public_event.starts_at_utc,
           CAST(strftime('%s', public_event.all_day_start_date) AS INTEGER)
             * 1000,
           9223372036854775807
         ),
         public_event.title COLLATE NOCASE,
         public_event.source_identity_key
       LIMIT ?`,
    )
    .bind(organizationId, organizationId, organizationId, limit)
    .all<Record<string, unknown>>();
  const currentRows = await revalidatePublicEventIdentityRows(
    database,
    organizationId,
    result.results ?? [],
  );
  return Object.freeze(
    currentRows.map((row) =>
      toPublishedEventSelection(row, "selection_id"),
    ),
  );
}

/**
 * Resolves a configured selection in one query and preserves its exact
 * requested order. Raw organizer-event IDs remain accepted as a narrow
 * compatibility adapter for Phase 6 drafts created before the private editor
 * adopted collision-safe source identities.
 */
export async function resolvePublishedEventSelections(
  database: Pick<D1DatabaseLike, "prepare">,
  input: Readonly<{
    organizationId: unknown;
    selectionIds: readonly unknown[];
  }>,
): Promise<readonly PublishedEventSelection[]> {
  return resolvePublishedEventSelectionsBounded(database, input, 12);
}

/**
 * Publication-time resolver for the maximum 24 structured blocks. Every
 * configured ID is resolved in one statement; the public editor helper above
 * intentionally retains its tighter per-control cap.
 */
export async function resolveEditorialPublishedEventSelections(
  database: Pick<D1DatabaseLike, "prepare">,
  input: Readonly<{
    organizationId: unknown;
    selectionIds: readonly unknown[];
  }>,
): Promise<readonly PublishedEventSelection[]> {
  return resolvePublishedEventSelectionsBounded(database, input, 288);
}

export async function resolveEditorialPublishedEventSelectionProofs(
  database: Pick<D1DatabaseLike, "prepare">,
  input: Readonly<{
    organizationId: unknown;
    selectionIds: readonly unknown[];
  }>,
): Promise<readonly PublishedEventSelectionProof[]> {
  return resolvePublishedEventSelectionProofsBounded(database, input, 288);
}

async function resolvePublishedEventSelectionsBounded(
  database: Pick<D1DatabaseLike, "prepare">,
  input: Readonly<{
    organizationId: unknown;
    selectionIds: readonly unknown[];
  }>,
  maximum: 12 | 288,
): Promise<readonly PublishedEventSelection[]> {
  const proofs = await resolvePublishedEventSelectionProofsBounded(
    database,
    input,
    maximum,
  );
  return Object.freeze(
    proofs.map(({ id, slug, title }) =>
      Object.freeze({ id, slug, title }),
    ),
  );
}

async function resolvePublishedEventSelectionProofsBounded(
  database: Pick<D1DatabaseLike, "prepare">,
  input: Readonly<{
    organizationId: unknown;
    selectionIds: readonly unknown[];
  }>,
  maximum: 12 | 288,
): Promise<readonly PublishedEventSelectionProof[]> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  if (
    !Array.isArray(input.selectionIds) ||
    input.selectionIds.length > maximum
  ) {
    throw validationIssue(
      "selectionIds",
      "invalid_length",
      `At most ${maximum} published events may be selected.`,
    );
  }
  const seen = new Set<string>();
  const selectionIds = input.selectionIds.flatMap((value, index) => {
    const selectionId = parseIdentifier(value, `selectionIds.${index}`);
    if (seen.has(selectionId)) return [];
    seen.add(selectionId);
    return [selectionId];
  });
  if (selectionIds.length === 0) return Object.freeze([]);
  const result = await database
    .prepare(
      `${PUBLIC_EVENT_SELECTION_PROOF_CTE_SQL},
       requested_selection AS (
         SELECT CAST(key AS INTEGER) AS requested_order,
                CAST(value AS TEXT) AS selection_id
         FROM json_each(?)
       )
       SELECT requested.selection_id,
              public_event.source_identity_key,
              public_event.source_identity_key
                AS public_source_identity_key,
              public_event.public_updated_at
                AS public_identity_version,
              public_event.public_source_version,
              public_event.club_projection_token
                AS public_club_projection_token,
              public_event.program_projection_token
                AS public_program_projection_token,
              public_event.slug,
              public_event.title
       FROM requested_selection AS requested
       JOIN public_events AS public_event
         ON (
           public_event.source_identity_key = requested.selection_id
           OR (
             instr(requested.selection_id, ':') = 0
             AND public_event.source_identity_key =
                 'organizer:' || requested.selection_id
           )
       )
        AND public_event.public_slug_count = 1
       ORDER BY requested.requested_order ASC
       LIMIT ?`,
    )
    .bind(
      organizationId,
      organizationId,
      organizationId,
      organizationId,
      organizationId,
      JSON.stringify(selectionIds),
      maximum,
    )
    .all<Record<string, unknown>>();
  const proofRows = result.results ?? [];
  const currentRows = await revalidatePublicEventIdentityRows(
    database,
    organizationId,
    proofRows.map((row) =>
      Object.freeze({
        ...row,
        public_source_version: row.public_identity_version,
      }),
    ),
  );
  const currentKeys = new Set(
    currentRows.map((row) =>
      [
        parseIdentifier(
          row.public_source_identity_key,
          "publicEvent.sourceIdentity",
        ),
        parseIdentifier(row.slug, "publicEvent.slug"),
        parseFiniteInteger(row.public_identity_version, {
          path: "publicEvent.sourceVersion",
          minimum: 0,
        }),
      ].join("\u0000"),
    ),
  );
  return Object.freeze(
    proofRows.flatMap((row) =>
      currentKeys.has(
        [
          parseIdentifier(
            row.public_source_identity_key,
            "publicEvent.sourceIdentity",
          ),
          parseIdentifier(row.slug, "publicEvent.slug"),
          parseFiniteInteger(row.public_identity_version, {
            path: "publicEvent.sourceVersion",
            minimum: 0,
          }),
        ].join("\u0000"),
      )
        ? [toPublishedEventSelectionProof(row, "selection_id")]
        : [],
    ),
  );
}

/**
 * One-query renderer seam for the maximum 24-block structured page. It
 * resolves every explicit selection in configured order and also returns the
 * bounded default Upcoming set used by unselected blocks, without an N+1
 * public-event query per block.
 */
export async function getEditorialPublicEvents(
  database: Pick<D1DatabaseLike, "prepare">,
  input: Readonly<{
    nowUtcMs: unknown;
    organizationId: unknown;
    requestedSlugs: readonly unknown[];
    todayDate: unknown;
  }>,
): Promise<EditorialPublicEvents> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  if (
    !Array.isArray(input.requestedSlugs) ||
    input.requestedSlugs.length > 288
  ) {
    throw validationIssue(
      "requestedSlugs",
      "invalid_length",
      "At most 288 editorial event selections may be resolved.",
    );
  }
  const requestedSlugs = input.requestedSlugs.map((value, index) =>
    parseIdentifier(value, `requestedSlugs.${index}`),
  );
  const nowUtcMs = parseFiniteInteger(input.nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const todayDate = parseCalendarDate(
    parseBoundedString(input.todayDate, {
      path: "todayDate",
      minLength: 10,
      maxLength: 10,
    }),
  );
  const result = await database
    .prepare(
      `${UNIFIED_PUBLIC_EVENT_CTE_SQL},
       requested_slug AS (
         SELECT CAST(key AS INTEGER) AS requested_order,
                CAST(value AS TEXT) AS slug
         FROM json_each(?)
       ),
       default_upcoming AS (
         SELECT *
         FROM public_events AS public_event
         WHERE public_event.public_slug_count = 1
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
           ${publicEventSortExpression("public_event")} ASC,
           public_event.title COLLATE NOCASE ASC,
           public_event.slug ASC
         LIMIT 12
       ),
       editorial_public_events AS (
         SELECT 0 AS result_group,
                requested.requested_order,
                public_event.*
         FROM requested_slug AS requested
         JOIN public_events AS public_event
           ON public_event.slug = requested.slug
          AND public_event.public_slug_count = 1
         UNION ALL
         SELECT 1 AS result_group,
                row_number() OVER (
                  ORDER BY
                    ${publicEventSortExpression("public_event")} ASC,
                    public_event.title COLLATE NOCASE ASC,
                    public_event.slug ASC
                ) - 1 AS requested_order,
                public_event.*
         FROM default_upcoming AS public_event
       )
       SELECT ${PUBLIC_EVENT_CARD_COLUMNS_SQL},
              public_event.result_group,
              public_event.requested_order
       FROM editorial_public_events AS public_event
       ORDER BY public_event.result_group, public_event.requested_order`,
    )
    .bind(
      organizationId,
      organizationId,
      organizationId,
      JSON.stringify(requestedSlugs),
      nowUtcMs,
      todayDate,
    )
    .all<Record<string, unknown>>();
  const enrichedRows = await enrichPublicEventRows(
    database,
    organizationId,
    result.results ?? [],
  );
  const selected: PublicEventCardDto[] = [];
  const defaultUpcoming: PublicEventCardDto[] = [];
  for (const row of enrichedRows) {
    const group = parseFiniteInteger(row.result_group, {
      path: "editorialEvent.resultGroup",
      minimum: 0,
      maximum: 1,
    });
    (group === 0 ? selected : defaultUpcoming).push(
      toPublicEventCardDto(row),
    );
  }
  return Object.freeze({
    defaultUpcoming: Object.freeze(defaultUpcoming),
    selected: Object.freeze(selected),
  });
}

export async function getAuthorizedOrganizerEventPublicPreview(
  database: Pick<D1DatabaseLike, "prepare">,
  input: GetAuthorizedOrganizerEventPublicPreviewInput,
): Promise<PublicEventDetailDto | null> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  const membershipId = parseIdentifier(input.membershipId, "membershipId");
  const organizerEventId = parseIdentifier(
    input.organizerEventId,
    "organizerEventId",
  );
  const profileId = parseIdentifier(input.profileId, "profileId");
  const row = await database
    .prepare(AUTHORIZED_ORGANIZER_EVENT_PUBLIC_PREVIEW_SQL)
    .bind(membershipId, profileId, organizationId, organizerEventId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const enrichment = await database
    .prepare(AUTHORIZED_ORGANIZER_EVENT_PUBLIC_PREVIEW_ENRICHMENT_SQL)
    .bind(membershipId, profileId, organizationId, organizerEventId)
    .first<Record<string, unknown>>();
  if (!enrichment) return null;
  return toPublicEventDetailDto({ ...row, ...enrichment });
}

function toPublishedEventSelection(
  row: Record<string, unknown>,
  idColumn: string,
): PublishedEventSelection {
  return Object.freeze({
    id: parseIdentifier(row[idColumn], `publishedEvent.${idColumn}`),
    slug: parseIdentifier(row.slug, "publishedEvent.slug"),
    title: parseBoundedString(row.title, {
      path: "publishedEvent.title",
      minLength: 1,
      maxLength: 160,
    }),
  });
}

function toPublishedEventSelectionProof(
  row: Record<string, unknown>,
  idColumn: string,
): PublishedEventSelectionProof {
  return Object.freeze({
    ...toPublishedEventSelection(row, idColumn),
    sourceIdentity: parseIdentifier(
      row.source_identity_key,
      "publishedEvent.sourceIdentity",
    ),
    sourceVersion: parseBoundedString(row.public_source_version, {
      path: "publishedEvent.sourceVersion",
      minLength: 3,
      maxLength: 2_048,
    }),
  });
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
  const enrichedRows = await enrichPublicEventRows(
    database,
    organizationId,
    result.results ?? [],
  );
  return Object.freeze(
    enrichedRows.map((row) => toPublicEventCardDto(row)),
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
              public_event.source_identity_key
                AS public_source_identity_key,
              public_event.public_updated_at AS public_source_version,
              public_event.club_projection_token
                AS public_club_projection_token,
              public_event.program_projection_token
                AS public_program_projection_token,
               public_event.public_updated_at AS public_updated_at,
               public_event.public_slug_count AS public_slug_count
       FROM public_events AS public_event
       ORDER BY public_event.slug ASC
       LIMIT ?`,
    )
    .bind(organizationId, organizationId, organizationId, limit)
    .all<Record<string, unknown>>();
  assertSuccessfulResult(result);
  for (const row of result.results ?? []) assertSinglePublicSlug(row);
  const currentRows = await revalidatePublicEventIdentityRows(
    database,
    organizationId,
    result.results ?? [],
  );
  return Object.freeze(
    currentRows.map((row) => {
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
       SELECT category.slug AS slug,
              category.name AS name,
              COALESCE(taxonomy_state.sort_order, 100000)
                AS taxonomy_sort_order
       FROM public_events AS public_event
       JOIN categories AS category
         ON category.organization_id = ?
        AND category.slug = public_event.category_slug
       LEFT JOIN category_taxonomy_states AS taxonomy_state
         ON taxonomy_state.category_id = category.id
        AND taxonomy_state.organization_id = category.organization_id
       WHERE public_event.event_status IN ('confirmed', 'tentative')
         AND public_event.category_slug IS NOT NULL
         AND public_event.category_name IS NOT NULL
       GROUP BY category.id, category.slug, category.name,
                taxonomy_state.sort_order
       ORDER BY taxonomy_sort_order ASC,
                category.name COLLATE NOCASE ASC,
                category.slug ASC
       LIMIT 100`,
    )
    .bind(
      organizationId,
      organizationId,
      organizationId,
      organizationId,
    )
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
  const approvedArtwork = publicArtwork(row);
  const curatedMeetupEvent = curatedMeetupEventForEventUrl(rsvpUrl);
  const curatedMeetupPoster =
    approvedArtwork === null
      ? curatedMeetupPosterForEventUrl(rsvpUrl) ??
        curatedMeetupPosterForSourceUrl(row.meetup_poster_source_url)
      : null;
  const synchronizedMeetupPoster =
    approvedArtwork === null && curatedMeetupPoster === null
      ? synchronizedMeetupPosterDto(row, rsvpUrl)
      : null;
  const resolvedVenue = withPublicEventVenueFacts(
    mergePublicEventVenue(
      venue,
      curatedMeetupVenueDto(curatedMeetupEvent?.venue ?? null),
    ),
    row,
    curatedMeetupEvent,
  );
  return Object.freeze({
    agePolicyText: publicEventAgePolicyText(row, curatedMeetupEvent),
    arrivalInstructions: publicEventArrivalInstructions(
      row,
      curatedMeetupEvent,
    ),
    availabilityState: publicEventAvailabilityState(
      row,
      curatedMeetupEvent,
    ),
    artwork:
      approvedArtwork ??
      (curatedMeetupPoster
        ? Object.freeze({
            altText: curatedMeetupPoster.altText,
            credit: curatedMeetupPoster.credit,
            dimensions: Object.freeze({
              large: Object.freeze({
                height: curatedMeetupPoster.height,
                width: curatedMeetupPoster.width,
              }),
              medium: Object.freeze({
                height: curatedMeetupPoster.mediumHeight,
                width: curatedMeetupPoster.mediumWidth,
              }),
              small: Object.freeze({
                height: curatedMeetupPoster.smallHeight,
                width: curatedMeetupPoster.smallWidth,
              }),
            }),
            focalPoint: Object.freeze({ x: 5_000, y: 5_000 }),
            srcSet: Object.freeze({
              large: curatedMeetupPoster.localPath,
              medium: curatedMeetupPoster.mediumPath,
              small: curatedMeetupPoster.smallPath,
            }),
            url: curatedMeetupPoster.localPath,
          })
        : synchronizedMeetupPoster),
    capacity: publicEventCapacity(row, curatedMeetupEvent),
    costText: publicEventCostText(row, curatedMeetupEvent),
    slug: parseIdentifier(row.slug, "event.slug"),
    title: parseBoundedString(row.title, {
      path: "event.title",
      maxLength: 200,
    }),
    summary:
      parseOptionalBoundedString(row.summary, {
        path: "event.summary",
        maxLength: 500,
      }) ?? curatedMeetupEvent?.summary ?? null,
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
    attendanceMode: publicAttendanceModeWithVenue(
      attendanceMode,
      resolvedVenue,
    ),
    club: Object.freeze({
      slug: parseIdentifier(row.club_slug, "event.club.slug"),
      name: parseBoundedString(row.club_name, {
        path: "event.club.name",
        maxLength: 160,
      }),
    }),
    program: publicProgram(row),
    lane: publicLane(row),
    category,
    venue: resolvedVenue,
    waitlistAvailable: publicEventWaitlistAvailable(
      row,
      curatedMeetupEvent,
    ),
  });
}

function synchronizedMeetupPosterDto(
  row: Record<string, unknown>,
  eventUrl: string | null,
): PublicEventCardDto["artwork"] {
  if (
    eventUrl === null ||
    row.meetup_poster_source_url === null ||
    row.meetup_poster_source_url === undefined
  ) {
    return null;
  }
  const posterSourceUrl = parseSynchronizedMeetupPosterSource(
    row.meetup_poster_source_url,
  );
  if (posterSourceUrl === null) return null;

  const event = new URL(eventUrl);
  const segments = event.pathname.split("/").filter(Boolean);
  if (segments.length !== 3 || segments[1] !== "events") {
    return invalidProjection();
  }
  const groupSlug = parseIdentifier(segments[0], "event.meetupGroupSlug");
  const eventId = parseIdentifier(segments[2], "event.meetupEventId");
  const route = `/meetup-posters/${encodeURIComponent(groupSlug)}/${encodeURIComponent(eventId)}`;
  const altText = parseBoundedString(row.meetup_poster_alt_text, {
    path: "event.posterAltText",
    maxLength: 300,
  });
  const credit = parseBoundedString(row.meetup_poster_credit, {
    path: "event.posterCredit",
    maxLength: 300,
  });

  // The source URL is intentionally validated here but never returned to the
  // browser. The public poster route revalidates the active immutable snapshot
  // before serving an R2-cached, resized copy.
  void posterSourceUrl;
  return Object.freeze({
    altText,
    credit,
    dimensions: SYNCHRONIZED_MEETUP_POSTER_VARIANTS,
    focalPoint: Object.freeze({ x: 5_000, y: 5_000 }),
    srcSet: Object.freeze({
      large: `${route}/large`,
      medium: `${route}/medium`,
      small: `${route}/small`,
    }),
    url: `${route}/large`,
  });
}

function parseSynchronizedMeetupPosterSource(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "secure.meetupstatic.com" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/photos\/event\/[0-9a-f/]+\/highres_[0-9]+\.jpe?g$/iu.test(
      parsed.pathname,
    )
  ) {
    return null;
  }
  return parsed.href;
}

function publicEventExportRecord(
  row: Record<string, unknown>,
): PublicEventExportRecord {
  return Object.freeze({
    clubProjectionToken: parseBoundedString(
      row.public_club_projection_token,
      {
        path: "publicEventExport.clubProjectionToken",
        minLength: 2,
        maxLength: 1_024,
      },
    ),
    event: toPublicEventExportDto(row),
    programProjectionToken:
      parseOptionalBoundedString(row.public_program_projection_token, {
        path: "publicEventExport.programProjectionToken",
        maxLength: 1_024,
      }),
    sourceIdentity: parseIdentifier(
      row.public_source_identity_key,
      "publicEventExport.sourceIdentity",
    ),
    sourceVersion: parseFiniteInteger(row.public_source_version, {
      path: "publicEventExport.sourceVersion",
      minimum: 0,
    }),
  });
}

function toPublicEventExportDto(
  row: Record<string, unknown>,
): PublicEventExportDto {
  assertSinglePublicSlug(row);
  const status = parseEnum(
    row.event_status,
    ["confirmed", "tentative", "cancelled", "completed"] as const,
    "event.status",
  );
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
  const curatedMeetupEvent = curatedMeetupEventForEventUrl(rsvpUrl);
  const venue = withPublicEventVenueFacts(
    mergePublicEventVenue(
      publicVenue(row),
      curatedMeetupVenueDto(curatedMeetupEvent?.venue ?? null),
    ),
    row,
    curatedMeetupEvent,
  );
  return Object.freeze({
    agePolicyText: publicEventAgePolicyText(row, curatedMeetupEvent),
    arrivalInstructions: publicEventArrivalInstructions(
      row,
      curatedMeetupEvent,
    ),
    attendanceMode: publicAttendanceModeWithVenue(
      publicAttendanceMode(row.attendance_mode),
      venue,
    ),
    availabilityState: publicEventAvailabilityState(
      row,
      curatedMeetupEvent,
    ),
    capacity: publicEventCapacity(row, curatedMeetupEvent),
    category: publicCategory(row),
    club: Object.freeze({
      slug: parseIdentifier(row.club_slug, "event.club.slug"),
      name: parseBoundedString(row.club_name, {
        path: "event.club.name",
        maxLength: 160,
      }),
    }),
    costText: publicEventCostText(row, curatedMeetupEvent),
    description:
      parseOptionalBoundedString(row.description, {
        path: "event.description",
        maxLength: 20_000,
      }) ?? curatedMeetupEvent?.description ?? null,
    isCancelled: status === "cancelled",
    lane: publicLane(row),
    program: publicProgram(row),
    rsvpUrl,
    schedule:
      row.time_kind === "timed"
        ? timedSchedule(row)
        : row.time_kind === "all_day"
          ? allDaySchedule(row)
          : invalidProjection(),
    slug: parseIdentifier(row.slug, "event.slug"),
    status,
    summary:
      parseOptionalBoundedString(row.summary, {
        path: "event.summary",
        maxLength: 500,
      }) ?? curatedMeetupEvent?.summary ?? null,
    title: parseBoundedString(row.title, {
      path: "event.title",
      maxLength: 200,
    }),
    venue,
    waitlistAvailable: publicEventWaitlistAvailable(
      row,
      curatedMeetupEvent,
    ),
  });
}

function publicProgram(
  row: Record<string, unknown>,
): PublicEventCardDto["program"] {
  if (
    (row.program_slug === null || row.program_slug === undefined) &&
    (row.program_name === null || row.program_name === undefined)
  ) {
    return null;
  }
  if (
    typeof row.program_slug !== "string" ||
    typeof row.program_name !== "string"
  ) {
    return invalidProjection();
  }
  return Object.freeze({
    name: parseBoundedString(row.program_name, {
      path: "event.program.name",
      maxLength: 120,
    }),
    slug: parseIdentifier(row.program_slug, "event.program.slug"),
  });
}

export function toPublicEventDetailDto(
  row: Record<string, unknown>,
): PublicEventDetailDto {
  const card = toPublicEventCardDto(row);
  const curatedMeetupEvent = curatedMeetupEventForEventUrl(card.rsvpUrl);
  const ownerDescription = parseOptionalBoundedString(row.description, {
    path: "event.description",
    maxLength: 20_000,
  });
  const synchronizedDescriptionBlocks =
    synchronizedMeetupDescriptionBlocks(row, ownerDescription);
  return Object.freeze({
    ...card,
    description: ownerDescription ?? curatedMeetupEvent?.description ?? null,
    descriptionBlocks:
      synchronizedDescriptionBlocks ??
      (ownerDescription === null
        ? curatedMeetupEvent?.descriptionBlocks ?? null
        : null),
    seoTitle: parseOptionalBoundedString(row.seo_title, {
      path: "event.seoTitle",
      maxLength: 60,
    }),
    metaDescription: parseOptionalBoundedString(row.meta_description, {
      path: "event.metaDescription",
      maxLength: 160,
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

function synchronizedMeetupDescriptionBlocks(
  row: Record<string, unknown>,
  description: string | null,
): readonly CuratedMeetupDescriptionBlock[] | null {
  if (
    description === null ||
    row.description_blocks_json === null ||
    row.description_blocks_json === undefined
  ) {
    return null;
  }
  const json = parseBoundedString(row.description_blocks_json, {
    path: "event.descriptionBlocks",
    maxLength: 120_000,
  });
  let candidate: unknown;
  try {
    candidate = JSON.parse(json);
  } catch {
    return invalidProjection();
  }
  const blocks = validateMeetupDescriptionBlocks(candidate);
  if (meetupDescriptionBlocksToPlainText(blocks) !== description) {
    return invalidProjection();
  }
  return blocks;
}

function curatedMeetupVenueDto(
  venue: CuratedMeetupEventEnrichment["venue"],
): PublicEventCardDto["venue"] {
  if (venue === null) return null;
  const addressParts = [venue.address, venue.city, venue.state].filter(
    (value): value is string => value !== null,
  );
  return Object.freeze({
    address: addressParts.length > 0 ? addressParts.join(", ") : null,
    floor: null,
    name: venue.name,
    room: null,
  });
}

function publicEventArrivalInstructions(
  row: Record<string, unknown>,
  curated: CuratedMeetupEventEnrichment | null,
): string | null {
  const explicit = optionalPublicText(
    row.arrival_instructions,
    "event.arrivalInstructions",
    4_000,
  );
  if (explicit !== null) return explicit;
  const rowVenueName = parseOptionalBoundedString(row.venue_public_name, {
    path: "event.venue.name",
    maxLength: 250,
  });
  return rowVenueName === null || rowVenueName === curated?.venue?.name
    ? curated?.arrivalInstructions ?? null
    : null;
}

function publicEventAgePolicyText(
  row: Record<string, unknown>,
  curated: CuratedMeetupEventEnrichment | null,
): string | null {
  return (
    optionalPublicText(row.age_policy_text, "event.agePolicyText", 500) ??
    curated?.agePolicyText ??
    null
  );
}

function publicEventAvailabilityState(
  row: Record<string, unknown>,
  curated: CuratedMeetupEventEnrichment | null,
): PublicEventCardDto["availabilityState"] {
  if (row.availability_state !== null && row.availability_state !== undefined) {
    return parseEnum(
      row.availability_state,
      ["open", "full", "waitlist"] as const,
      "event.availabilityState",
    );
  }
  return (
    curated?.availabilityState ?? null
  );
}

function publicEventCapacity(
  row: Record<string, unknown>,
  curated: CuratedMeetupEventEnrichment | null,
): number | null {
  if (row.capacity !== null && row.capacity !== undefined) {
    return parseFiniteInteger(row.capacity, {
      path: "event.capacity",
      minimum: 1,
      maximum: 1_000_000,
    });
  }
  return curated?.capacity ?? null;
}

function publicEventCostText(
  row: Record<string, unknown>,
  curated: CuratedMeetupEventEnrichment | null,
): string | null {
  return (
    optionalPublicText(row.cost_text, "event.costText", 500) ??
    curated?.costText ??
    null
  );
}

function publicEventWaitlistAvailable(
  row: Record<string, unknown>,
  curated: CuratedMeetupEventEnrichment | null,
): boolean | null {
  if (row.waitlist_available !== null && row.waitlist_available !== undefined) {
    if (row.waitlist_available === true || row.waitlist_available === 1) {
      return true;
    }
    if (row.waitlist_available === false || row.waitlist_available === 0) {
      return false;
    }
    return invalidProjection();
  }
  return (
    curated?.waitlistAvailable ?? null
  );
}

function mergePublicEventVenue(
  primary: PublicEventCardDto["venue"],
  fallback: PublicEventCardDto["venue"],
): PublicEventCardDto["venue"] {
  if (primary === null) return fallback;
  if (fallback === null || primary.name !== fallback.name) return primary;
  return Object.freeze({
    ...primary,
    floor: primary.floor ?? fallback.floor,
    room: primary.room ?? fallback.room,
  });
}

function withPublicEventVenueFacts(
  venue: PublicEventCardDto["venue"],
  row: Record<string, unknown>,
  curated: CuratedMeetupEventEnrichment | null,
): PublicEventCardDto["venue"] {
  if (venue === null) return null;
  const curatedVenueMatches = curated?.venue?.name === venue.name;
  const floor =
    parseOptionalBoundedString(row.venue_public_floor, {
      path: "event.venue.floor",
      maxLength: 120,
    }) ??
    (curatedVenueMatches ? curated.publicFloor : null) ??
    venue.floor ??
    null;
  const room =
    parseOptionalBoundedString(row.venue_public_room, {
      path: "event.venue.room",
      maxLength: 160,
    }) ??
    (curatedVenueMatches ? curated.publicRoom : null) ??
    venue.room ??
    null;
  return Object.freeze({
    ...venue,
    floor,
    room,
  });
}

function buildPublicEventFilter(
  input: ParsedPublicEventQuery,
  options: Readonly<{ includeCancelled?: boolean }> = {},
): Readonly<{ bindings: readonly D1Value[]; sql: string }> {
  const upcomingStatuses = options.includeCancelled
    ? "('confirmed', 'tentative', 'cancelled')"
    : "('confirmed', 'tentative')";
  const pastStatuses = options.includeCancelled
    ? "('confirmed', 'tentative', 'completed', 'cancelled')"
    : "('confirmed', 'tentative', 'completed')";
  const clauses: string[] = [
    input.view === "upcoming"
      ? `public_event.event_status IN ${upcomingStatuses}`
      : `public_event.event_status IN ${pastStatuses}`,
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
    "program_slug",
    input.programSlug,
  );
  addEqualityFilter(
    clauses,
    bindings,
    "category_slug",
    input.categorySlug,
  );
  if (input.attendanceModeDatabaseValue !== null) {
    // Meetup snapshots can gain a confirmed public venue before their legacy
    // planning row is reclassified from location_undecided. Public DTOs already
    // normalize that combination to in-person; apply the same effective mode to
    // filtering so a venue-backed event cannot appear under the contradictory
    // "Location undecided" filter or disappear from "In person".
    clauses.push(`(
      CASE
        WHEN public_event.attendance_mode = 'location_undecided'
         AND length(trim(COALESCE(public_event.venue_public_name, ''))) > 0
        THEN 'in_person'
        ELSE public_event.attendance_mode
      END
    ) = ?`);
    bindings.push(input.attendanceModeDatabaseValue);
  }
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

function buildPublicCalendarMonthFilter(
  input: ParsedPublicCalendarMonthQuery,
): Readonly<{ bindings: readonly D1Value[]; sql: string }> {
  const bindings: D1Value[] = [
    input.nowUtcMs,
    input.todayDate,
    input.fromUtcMs,
    input.fromDate,
    input.toUtcMsExclusive,
    input.toDateExclusive,
  ];
  const clauses = [`(
      public_event.event_status IN ('confirmed', 'tentative')
      OR (
        public_event.event_status = 'completed'
        AND (
          (
            public_event.time_kind = 'timed'
            AND public_event.ends_at_utc <= ?
          )
          OR (
            public_event.time_kind = 'all_day'
            AND public_event.all_day_end_date_exclusive <= ?
          )
        )
      )
    )
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
    AND (
      (
        public_event.time_kind = 'timed'
        AND public_event.starts_at_utc < ?
      )
      OR (
        public_event.time_kind = 'all_day'
        AND public_event.all_day_start_date < ?
      )
    )`];
  addEqualityFilter(clauses, bindings, "lane_slug", input.laneSlug);
  return Object.freeze({
    bindings: Object.freeze(bindings),
    sql: clauses.join("\nAND "),
  });
}

function addEqualityFilter(
  clauses: string[],
  bindings: D1Value[],
  column:
    | "attendance_mode"
    | "category_slug"
    | "club_slug"
    | "lane_slug"
    | "program_slug",
  value: string | null,
): void {
  if (value === null) return;
  clauses.push(`public_event.${column} = ?`);
  bindings.push(value);
}

function publicEventOrderSql(view: PublicEventListView): string {
  return `ORDER BY ${publicEventOrderExpression(view)}`;
}

function publicEventOrderExpression(view: PublicEventListView): string {
  const direction = view === "upcoming" ? "ASC" : "DESC";
  return `${publicEventSortExpression("public_event")} ${direction},
    public_event.title COLLATE NOCASE ${direction},
    public_event.slug ${direction}`;
}

function publicEventResultIdentity(row: Record<string, unknown>): string {
  return [
    parseIdentifier(
      row.public_source_identity_key,
      "publicEvent.sourceIdentity",
    ),
    parseIdentifier(row.slug, "publicEvent.slug"),
    parseFiniteInteger(row.public_source_version, {
      path: "publicEvent.sourceVersion",
      minimum: 0,
    }),
  ].join("\u0000");
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

function parseNextPublicEventClubSlugs(
  value: unknown,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_NEXT_PUBLIC_EVENT_CLUBS
  ) {
    throw validationIssue(
      "clubSlugs",
      "invalid_length",
      `At most ${MAX_NEXT_PUBLIC_EVENT_CLUBS} public Club slugs may be requested.`,
    );
  }
  const seen = new Set<string>();
  const slugs: string[] = [];
  for (const [index, candidate] of value.entries()) {
    const slug = parseIdentifier(candidate, `clubSlugs.${index}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
      throw validationIssue(
        `clubSlugs.${index}`,
        "invalid_identifier",
        "Expected a normalized public Club slug.",
      );
    }
    if (seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  return Object.freeze(slugs);
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

function publicAttendanceModeWithVenue(
  attendanceMode: PublicEventAttendanceMode,
  venue: PublicEventCardDto["venue"],
): PublicEventAttendanceMode {
  return attendanceMode === "location-undecided" && venue !== null
    ? "in-person"
    : attendanceMode;
}

function publicArtwork(
  row: Record<string, unknown>,
): PublicEventCardDto["artwork"] {
  const usageCount = parseFiniteInteger(row.artwork_usage_count ?? 0, {
    path: "event.artwork.usageCount",
    minimum: 0,
    maximum: 2,
  });
  if (usageCount === 0) return null;
  if (usageCount !== 1) return invalidProjection();
  const assetId = parseIdentifier(
    row.artwork_asset_id,
    "event.artwork.assetId",
  );
  const privatePreview = row.artwork_private_preview === 1;
  const eventId = privatePreview
    ? parseIdentifier(row.artwork_event_id, "event.artwork.eventId")
    : null;
  const variantUrl = (variant: "webp_480" | "webp_960" | "webp_1600") =>
    privatePreview
      ? `/api/organizer/media/${encodeURIComponent(assetId)}/variants/${variant}?eventId=${encodeURIComponent(eventId ?? "")}`
      : `/media/${encodeURIComponent(assetId)}/${variant}`;
  return Object.freeze({
    altText: parseOptionalBoundedString(row.artwork_alt_text, {
      path: "event.artwork.altText",
      maxLength: 300,
    }),
    credit: parseBoundedString(row.artwork_credit, {
      path: "event.artwork.credit",
      maxLength: 300,
    }),
    dimensions: Object.freeze({
      large: artworkDimensions(row, "large"),
      medium: artworkDimensions(row, "medium"),
      small: artworkDimensions(row, "small"),
    }),
    focalPoint: Object.freeze({
      x: parseFiniteInteger(row.artwork_focal_point_x, {
        path: "event.artwork.focalPoint.x",
        minimum: 0,
        maximum: 10_000,
      }),
      y: parseFiniteInteger(row.artwork_focal_point_y, {
        path: "event.artwork.focalPoint.y",
        minimum: 0,
        maximum: 10_000,
      }),
    }),
    srcSet: Object.freeze({
      large: variantUrl("webp_1600"),
      medium: variantUrl("webp_960"),
      small: variantUrl("webp_480"),
    }),
    url: variantUrl("webp_1600"),
  });
}

function artworkDimensions(
  row: Record<string, unknown>,
  size: "large" | "medium" | "small",
): Readonly<{ height: number; width: number }> {
  return Object.freeze({
    height: parseFiniteInteger(row[`artwork_${size}_height`], {
      path: `event.artwork.dimensions.${size}.height`,
      minimum: 1,
      maximum: 8_000,
    }),
    width: parseFiniteInteger(row[`artwork_${size}_width`], {
      path: `event.artwork.dimensions.${size}.width`,
      minimum: 1,
      maximum: 8_000,
    }),
  });
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
  if (name === null) return null;
  const floor = parseOptionalBoundedString(row.venue_public_floor, {
    path: "event.venue.floor",
    maxLength: 120,
  });
  const room = parseOptionalBoundedString(row.venue_public_room, {
    path: "event.venue.room",
    maxLength: 160,
  });
  return Object.freeze({
    name,
    address: parseOptionalBoundedString(row.venue_public_address, {
      path: "event.venue.address",
      maxLength: 544,
    }),
    floor,
    room,
  });
}
