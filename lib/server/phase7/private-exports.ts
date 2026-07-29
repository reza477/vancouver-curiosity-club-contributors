import {
  authorizeMembership,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type D1ResultLike,
  type TrustedServerIdentity,
} from "../auth";
import type {
  R2BucketLike,
  R2ObjectBodyLike,
} from "../media/storage";
import {
  parseBoundedString,
  parseFiniteInteger,
  parseIdentifier,
  parseOptionalBoundedString,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import { parseOfficialMeetupEventUrl } from "../meetup/url";
import {
  buildCsv,
  OPERATIONAL_CSV_EVENT_LIMIT,
  sanitizeDownloadFilename,
} from "./export-format";

const MEDIA_MANIFEST_LIMIT = 5_000;
// At the schema maxima, one usage object is under 2,500 UTF-8 bytes even when
// every bounded character needs six-byte JSON escaping. The max-plus-one slice
// therefore stays below 1.1 MB, leaving wide headroom under D1's 2 MB value cap.
export const MEDIA_MANIFEST_USAGE_LIMIT = 400;
const MEDIA_MANIFEST_USAGE_JSON_MAX_BYTES = 1_100_000;

export type PrivateDownload = Readonly<{
  body: string;
  contentType: string;
  fileName: string;
}>;

export type MediaManifestEntry = Readonly<{
  altText: string | null;
  byteSize: number;
  caption: string | null;
  consentStatus: string;
  createdAt: number;
  credit: string | null;
  fileName: string;
  height: number | null;
  id: string;
  informative: boolean;
  mimeType: string;
  participantConsentNote: string | null;
  publicClassification: "private" | "public";
  rightsSourceNote: string | null;
  rightsStatus: string;
  sha256: string | null;
  updatedAt: number;
  usages: readonly Readonly<{
    entityId: string;
    entityType: string;
    publicationScope: "draft" | "published";
    revisionId: string;
    usageKind: string;
  }>[];
  width: number | null;
}>;

export type OwnerMediaDownload = Readonly<{
  body: R2ObjectBodyLike;
  byteSize: number;
  etag: string;
  fileName: string;
  mimeType: string;
}>;

export async function createOperationalEventCsv(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  nowUtcMs = Date.now(),
): Promise<PrivateDownload> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const result = await database
    .prepare(OPERATIONAL_EVENT_EXPORT_SQL)
    .bind(
      actor.organizationId,
      actor.organizationId,
      actor.organizationId,
      OPERATIONAL_CSV_EVENT_LIMIT + 1,
    )
    .all<Record<string, unknown>>();
  assertResult(result.success);
  const sourceRows = result.results ?? [];
  if (sourceRows.length > OPERATIONAL_CSV_EVENT_LIMIT) {
    throw new SafeApplicationError(
      "validation_failed",
      422,
      "Narrow the operational event set before exporting.",
    );
  }
  const rows = sourceRows.map(operationalCsvRow);
  await writeExportAudit(database, actor, {
    action: "event_export.operational_csv",
    entityId: `operational-events:${now}`,
    exportType: "operational_event_csv",
    now,
    requiredRole: "manager",
    rowCount: rows.length,
  });
  return Object.freeze({
    body: buildCsv(
      [
        "event_reference",
        "source",
        "title",
        "club",
        "program",
        "lane",
        "category",
        "schedule_type",
        "starts_at_utc",
        "ends_at_utc",
        "all_day_start_date",
        "all_day_end_date_exclusive",
        "timezone",
        "planning_status",
        "publication_status",
        "attendance_mode",
        "venue",
        "meetup_url",
        "buffer_before_minutes",
        "buffer_after_minutes",
      ],
      rows,
    ),
    contentType: "text/csv; charset=utf-8",
    fileName: "vcc-operational-events.csv",
  });
}

export async function createOwnerMediaManifest(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  nowUtcMs = Date.now(),
): Promise<PrivateDownload> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner"],
  });
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const entries = await loadMediaManifestEntries(
    database,
    actor.organizationId,
  );
  await writeExportAudit(database, actor, {
    action: "media_export.manifest",
    entityId: `media-manifest:${now}`,
    exportType: "media_manifest",
    now,
    requiredRole: "owner",
    rowCount: entries.length,
  });
  return Object.freeze({
    body: `${JSON.stringify(
      {
        schemaVersion: "vcc-media-manifest-v1",
        generatedAt: new Date(now).toISOString(),
        assetCount: entries.length,
        assets: entries,
        excludes: [
          "r2_object_keys",
          "permanent_signed_urls",
          "authentication_and_runtime_values",
        ],
      },
      null,
      2,
    )}\n`,
    contentType: "application/json; charset=utf-8",
    fileName: "vcc-media-manifest.json",
  });
}

export async function getOwnerMediaOriginal(
  database: D1DatabaseLike,
  bucket: R2BucketLike,
  identity: TrustedServerIdentity,
  assetIdValue: unknown,
  nowUtcMs = Date.now(),
): Promise<OwnerMediaDownload> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner"],
  });
  const assetId = parseIdentifier(assetIdValue, "assetId");
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const row = await database
    .prepare(
      `SELECT asset.file_name,
              variant.object_key,
              variant.mime_type,
              variant.byte_size,
              variant.sha256
       FROM media_assets AS asset
       JOIN media_asset_details AS detail
         ON detail.asset_id = asset.id
        AND detail.organization_id = asset.organization_id
        AND detail.upload_state = 'ready'
       JOIN media_asset_variants AS variant
         ON variant.asset_id = asset.id
        AND variant.organization_id = asset.organization_id
        AND variant.variant_kind = 'original'
        AND variant.state = 'ready'
       WHERE asset.id = ?
         AND asset.organization_id = ?
         AND asset.deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(assetId, actor.organizationId)
    .first<Record<string, unknown>>();
  if (!row) return privateNotFound();
  const objectKey = parseBoundedString(row.object_key, {
    path: "media.objectKey",
    maxLength: 1_024,
  });
  const body = await bucket.get(objectKey);
  if (!body) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The stored media file is temporarily unavailable.",
    );
  }
  const byteSize = parseFiniteInteger(row.byte_size, {
    path: "media.byteSize",
    minimum: 1,
    maximum: 8 * 1024 * 1024,
  });
  if (body.size !== undefined && body.size !== byteSize) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The stored media file could not be verified.",
    );
  }
  await writeExportAudit(database, actor, {
    action: "media_export.original_downloaded",
    entityId: assetId,
    exportType: "media_original",
    now,
    requiredRole: "owner",
    rowCount: 1,
  });
  return Object.freeze({
    body,
    byteSize,
    etag: parseBoundedString(row.sha256, {
      path: "media.sha256",
      minLength: 64,
      maxLength: 64,
    }),
    fileName: sanitizeDownloadFilename(
      parseBoundedString(row.file_name, {
        path: "media.fileName",
        maxLength: 255,
      }),
      "media-download",
    ),
    mimeType: parseBoundedString(row.mime_type, {
      path: "media.mimeType",
      maxLength: 100,
    }),
  });
}

export async function loadMediaManifestEntries(
  database: Pick<D1DatabaseLike, "prepare">,
  organizationId: string,
): Promise<readonly MediaManifestEntry[]> {
  const result =
    await prepareMediaManifestStatement(database, organizationId).all<
      Record<string, unknown>
    >();
  return readMediaManifestEntriesResult(result);
}

export function prepareMediaManifestStatement(
  database: Pick<D1DatabaseLike, "prepare">,
  organizationId: string,
): D1PreparedStatementLike {
  return database
    .prepare(MEDIA_MANIFEST_SQL)
    .bind(
      MEDIA_MANIFEST_USAGE_LIMIT + 1,
      organizationId,
      MEDIA_MANIFEST_LIMIT + 1,
    );
}

export function readMediaManifestEntriesResult(
  result: D1ResultLike<Record<string, unknown>>,
): readonly MediaManifestEntry[] {
  assertResult(result.success);
  const rows = result.results ?? [];
  if (rows.length > MEDIA_MANIFEST_LIMIT) {
    throw new SafeApplicationError(
      "validation_failed",
      422,
      "The media library is too large for one manifest.",
    );
  }
  return Object.freeze(rows.map(readMediaManifestEntry));
}

const MEDIA_MANIFEST_SQL = `SELECT asset.id,
       asset.file_name,
       asset.mime_type,
       asset.byte_size,
       asset.alt_text,
       asset.credit,
       asset.rights_status,
       asset.participant_consent_status,
       asset.is_public,
       asset.created_at,
       asset.updated_at,
       detail.caption,
       detail.private_rights_source_note,
       detail.private_participant_consent_note,
       detail.informative,
       detail.original_sha256,
       detail.width,
       detail.height,
       (
         SELECT count(*)
         FROM media_usage_references AS usage
         WHERE usage.organization_id = asset.organization_id
           AND usage.asset_id = asset.id
           AND usage.deleted_at IS NULL
       ) AS usage_count,
       COALESCE((
         SELECT json_group_array(json_object(
           'entityType', bounded_usage.entity_type,
           'entityId', bounded_usage.entity_id,
           'revisionId', bounded_usage.revision_id,
           'usageKind', bounded_usage.usage_kind,
           'publicationScope', bounded_usage.publication_scope
         ))
         FROM (
           SELECT usage.entity_type,
                  usage.entity_id,
                  usage.revision_id,
                  usage.usage_kind,
                  usage.publication_scope
           FROM media_usage_references AS usage
           WHERE usage.organization_id = asset.organization_id
             AND usage.asset_id = asset.id
             AND usage.deleted_at IS NULL
           ORDER BY usage.entity_type ASC,
                    usage.entity_id ASC,
                    usage.revision_id ASC,
                    usage.usage_kind ASC,
                    usage.publication_scope ASC,
                    usage.id ASC
           LIMIT ?
         ) AS bounded_usage
       ), '[]') AS usages_json
FROM media_assets AS asset
JOIN media_asset_details AS detail
  ON detail.asset_id = asset.id
 AND detail.organization_id = asset.organization_id
WHERE asset.organization_id = ?
  AND asset.deleted_at IS NULL
ORDER BY asset.created_at ASC, asset.id ASC
LIMIT ?`;

const OPERATIONAL_EVENT_EXPORT_SQL = `
WITH operational_events AS (
  SELECT 'manual' AS source_kind,
         event.id,
         event.title,
         club.name AS club_name,
         program.name AS program_name,
         lane.name AS lane_name,
         category.name AS category_name,
         event.schedule_shape,
         event.starts_at_utc,
         event.ends_at_utc,
         event.all_day_start_date,
         event.all_day_end_date_exclusive,
         event.timezone,
         event.planning_status,
         event.publication_status,
         public_detail.attendance_mode,
         venue.name AS venue_name,
         event.meetup_event_url,
         event.buffer_before_minutes,
         event.buffer_after_minutes,
         event.updated_at
  FROM organizer_events AS event
  JOIN clubs AS club
    ON club.id = event.club_id
   AND club.organization_id = event.organization_id
  LEFT JOIN programs AS program
    ON program.id = event.program_id
   AND program.organization_id = event.organization_id
  LEFT JOIN event_lanes AS lane
    ON lane.id = event.event_lane_id
   AND lane.organization_id = event.organization_id
  LEFT JOIN categories AS category
    ON category.id = event.category_id
   AND category.organization_id = event.organization_id
  LEFT JOIN venues AS venue
    ON venue.id = event.venue_id
   AND venue.organization_id = event.organization_id
  LEFT JOIN organizer_event_public_details AS public_detail
    ON public_detail.organizer_event_id = event.id
   AND public_detail.organization_id = event.organization_id
  WHERE event.organization_id = ?
    AND event.deleted_at IS NULL

  UNION ALL

  SELECT 'legacy' AS source_kind,
         event.id,
         event.title,
         club.name AS club_name,
         program.name AS program_name,
         lane.name AS lane_name,
         category.name AS category_name,
         event.time_kind AS schedule_shape,
         event.starts_at_utc,
         event.ends_at_utc,
         event.all_day_start_date,
         event.all_day_end_date_exclusive,
         event.timezone,
         event.status AS planning_status,
         CASE
           WHEN event.visibility = 'public'
            AND event.published_at IS NOT NULL
           THEN 'published'
           ELSE 'private'
         END AS publication_status,
         public_detail.attendance_mode,
         venue.name AS venue_name,
         NULL AS meetup_event_url,
         event.buffer_before_minutes,
         event.buffer_after_minutes,
         event.updated_at
  FROM events AS event
  JOIN clubs AS club
    ON club.id = event.club_id
   AND club.organization_id = event.organization_id
  LEFT JOIN programs AS program
    ON program.id = event.program_id
   AND program.organization_id = event.organization_id
  LEFT JOIN event_lanes AS lane
    ON lane.id = event.event_lane_id
   AND lane.organization_id = event.organization_id
  LEFT JOIN categories AS category
    ON category.id = event.category_id
   AND category.organization_id = event.organization_id
  LEFT JOIN venues AS venue
    ON venue.id = event.venue_id
   AND venue.organization_id = event.organization_id
  LEFT JOIN event_public_details AS public_detail
    ON public_detail.event_id = event.id
   AND public_detail.organization_id = event.organization_id
  WHERE event.organization_id = ?
    AND event.deleted_at IS NULL
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
      WHERE adopted_event.organization_id = event.organization_id
        AND adopted_event.id = event.id
    )

  UNION ALL

  SELECT 'meetup' AS source_kind,
         snapshot.event_id AS id,
         snapshot.title,
         club.name AS club_name,
         program.name AS program_name,
         lane.name AS lane_name,
         category.name AS category_name,
         snapshot.time_kind AS schedule_shape,
         snapshot.starts_at_utc,
         snapshot.ends_at_utc,
         snapshot.all_day_start_date,
         snapshot.all_day_end_date_exclusive,
         snapshot.timezone,
         snapshot.status AS planning_status,
         CASE
           WHEN event.visibility = 'public'
            AND event.published_at IS NOT NULL
           THEN 'published'
           ELSE 'private'
         END AS publication_status,
         public_detail.attendance_mode,
         venue.name AS venue_name,
         snapshot.event_url AS meetup_event_url,
         event.buffer_before_minutes,
         event.buffer_after_minutes,
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
  LEFT JOIN programs AS program
    ON program.id = event.program_id
   AND program.organization_id = event.organization_id
  LEFT JOIN event_lanes AS lane
    ON lane.id = event.event_lane_id
   AND lane.organization_id = event.organization_id
  LEFT JOIN categories AS category
    ON category.id = event.category_id
   AND category.organization_id = event.organization_id
  LEFT JOIN venues AS venue
    ON venue.id = event.venue_id
   AND venue.organization_id = event.organization_id
  LEFT JOIN event_public_details AS public_detail
    ON public_detail.event_id = event.id
   AND public_detail.organization_id = event.organization_id
  WHERE source.organization_id = ?
    AND source.source_type = 'meetup_ics'
    AND source.enabled = 1
    AND source.active_generation_id IS NOT NULL
    AND source.deleted_at IS NULL
)
SELECT *
FROM operational_events
ORDER BY updated_at DESC, source_kind ASC, id ASC
LIMIT ?
`;

function operationalCsvRow(
  row: Record<string, unknown>,
): readonly (null | number | string)[] {
  const meetupUrl =
    row.meetup_event_url === null || row.meetup_event_url === undefined
      ? null
      : parseOfficialMeetupEventUrl(
          row.meetup_event_url,
          "operationalEvent.meetupUrl",
        );
  return [
    parseIdentifier(row.id, "operationalEvent.id"),
    parseBoundedString(row.source_kind, {
      path: "operationalEvent.source",
      maxLength: 20,
    }),
    parseBoundedString(row.title, {
      path: "operationalEvent.title",
      maxLength: 200,
    }),
    parseBoundedString(row.club_name, {
      path: "operationalEvent.club",
      maxLength: 160,
    }),
    optionalText(row.program_name, 160),
    optionalText(row.lane_name, 120),
    optionalText(row.category_name, 120),
    parseBoundedString(row.schedule_shape, {
      path: "operationalEvent.scheduleType",
      maxLength: 20,
    }),
    optionalInstant(row.starts_at_utc),
    optionalInstant(row.ends_at_utc),
    optionalText(row.all_day_start_date, 10),
    optionalText(row.all_day_end_date_exclusive, 10),
    parseBoundedString(row.timezone, {
      path: "operationalEvent.timezone",
      maxLength: 100,
    }),
    parseBoundedString(row.planning_status, {
      path: "operationalEvent.planningStatus",
      maxLength: 40,
    }),
    parseBoundedString(row.publication_status, {
      path: "operationalEvent.publicationStatus",
      maxLength: 40,
    }),
    optionalText(row.attendance_mode, 40),
    optionalText(row.venue_name, 200),
    meetupUrl,
    parseFiniteInteger(row.buffer_before_minutes, {
      path: "operationalEvent.bufferBefore",
      minimum: 0,
    }),
    parseFiniteInteger(row.buffer_after_minutes, {
      path: "operationalEvent.bufferAfter",
      minimum: 0,
    }),
  ];
}

function readMediaManifestEntry(
  row: Record<string, unknown>,
): MediaManifestEntry {
  const usageCount = parseFiniteInteger(row.usage_count, {
    path: "mediaManifest.usageCount",
    minimum: 0,
  });
  if (usageCount > MEDIA_MANIFEST_USAGE_LIMIT) {
    throw new SafeApplicationError(
      "validation_failed",
      422,
      "A media asset has too many active usages for one manifest.",
    );
  }
  return Object.freeze({
    altText: optionalText(row.alt_text, 300),
    byteSize: parseFiniteInteger(row.byte_size, {
      path: "mediaManifest.byteSize",
      minimum: 0,
    }),
    caption: optionalText(row.caption, 1_000),
    consentStatus: parseBoundedString(row.participant_consent_status, {
      path: "mediaManifest.consentStatus",
      maxLength: 40,
    }),
    createdAt: parseFiniteInteger(row.created_at, {
      path: "mediaManifest.createdAt",
      minimum: 0,
    }),
    credit: optionalText(row.credit, 300),
    fileName: parseBoundedString(row.file_name, {
      path: "mediaManifest.fileName",
      maxLength: 255,
    }),
    height: optionalInteger(row.height),
    id: parseIdentifier(row.id, "mediaManifest.id"),
    informative: row.informative === 1,
    mimeType: parseBoundedString(row.mime_type, {
      path: "mediaManifest.mimeType",
      maxLength: 100,
    }),
    participantConsentNote: optionalText(
      row.private_participant_consent_note,
      1_000,
    ),
    publicClassification: row.is_public === 1 ? "public" : "private",
    rightsSourceNote: optionalText(
      row.private_rights_source_note,
      1_000,
    ),
    rightsStatus: parseBoundedString(row.rights_status, {
      path: "mediaManifest.rightsStatus",
      maxLength: 40,
    }),
    sha256: optionalText(row.original_sha256, 64),
    updatedAt: parseFiniteInteger(row.updated_at, {
      path: "mediaManifest.updatedAt",
      minimum: 0,
    }),
    usages: readMediaUsages(row.usages_json, usageCount),
    width: optionalInteger(row.width),
  });
}

function readMediaUsages(
  value: unknown,
  expectedCount: number,
): MediaManifestEntry["usages"] {
  if (
    typeof value !== "string" ||
    new TextEncoder().encode(value).byteLength >
      MEDIA_MANIFEST_USAGE_JSON_MAX_BYTES
  ) {
    return invalidManifest();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return invalidManifest();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== expectedCount ||
    parsed.length > MEDIA_MANIFEST_USAGE_LIMIT
  ) {
    return invalidManifest();
  }
  return Object.freeze(
    parsed.map((value, index) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return invalidManifest();
      }
      const row = value as Record<string, unknown>;
      return Object.freeze({
        entityId: parseIdentifier(
          row.entityId,
          `mediaManifest.usages.${index}.entityId`,
        ),
        entityType: parseBoundedString(row.entityType, {
          path: `mediaManifest.usages.${index}.entityType`,
          maxLength: 64,
        }),
        publicationScope:
          row.publicationScope === "draft" ||
          row.publicationScope === "published"
            ? row.publicationScope
            : invalidManifest(),
        revisionId: parseIdentifier(
          row.revisionId,
          `mediaManifest.usages.${index}.revisionId`,
        ),
        usageKind: parseBoundedString(row.usageKind, {
          path: `mediaManifest.usages.${index}.usageKind`,
          maxLength: 64,
        }),
      });
    }),
  );
}

async function writeExportAudit(
  database: D1DatabaseLike,
  actor: Readonly<{
    membershipId: string;
    organizationId: string;
    profileId: string;
  }>,
  input: Readonly<{
    action: string;
    entityId: string;
    exportType: string;
    now: number;
    requiredRole: "manager" | "owner";
    rowCount: number;
  }>,
): Promise<void> {
  const result = await database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action,
         entity_type, entity_id, metadata_json, created_at
       )
       SELECT ?, membership.organization_id, membership.profile_id,
              ?, 'data_export', ?, ?, ?
       FROM organization_memberships AS membership
       JOIN profiles AS profile
         ON profile.id = membership.profile_id
       WHERE membership.id = ?
         AND membership.organization_id = ?
         AND membership.profile_id = ?
         AND (
           (? = 'owner' AND membership.role = 'owner')
           OR (
             ? = 'manager'
             AND membership.role IN ('owner', 'administrator')
           )
         )
         AND membership.status = 'active'
         AND membership.deleted_at IS NULL
         AND profile.status = 'active'
         AND profile.deleted_at IS NULL`,
    )
    .bind(
      `audit:${crypto.randomUUID()}`,
      input.action,
      input.entityId,
      JSON.stringify({
        exportType: input.exportType,
        rowCount: input.rowCount,
        schemaVersion: 1,
      }),
      input.now,
      actor.membershipId,
      actor.organizationId,
      actor.profileId,
      input.requiredRole,
      input.requiredRole,
    )
    .run();
  if (changes(result) !== 1) {
    throw new SafeApplicationError(
      "authorization_denied",
      403,
      "Your current role cannot generate this export.",
    );
  }
}

function optionalText(value: unknown, maxLength: number): string | null {
  return (
    parseOptionalBoundedString(value, {
      path: "export.optionalText",
      maxLength,
    }) ?? null
  );
}

function optionalInteger(value: unknown): number | null {
  return value === null || value === undefined
    ? null
    : parseFiniteInteger(value, {
        path: "export.optionalInteger",
        minimum: 0,
      });
}

function optionalInstant(value: unknown): string | null {
  const instant = optionalInteger(value);
  return instant === null ? null : new Date(instant).toISOString();
}

function assertResult(success: unknown): void {
  if (success === false) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The export could not be read safely.",
    );
  }
}

function changes(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  const meta = Reflect.get(result, "meta");
  if (typeof meta !== "object" || meta === null) return 0;
  const value = Reflect.get(meta, "changes");
  return typeof value === "number" ? value : 0;
}

function invalidManifest(): never {
  throw new SafeApplicationError(
    "service_unavailable",
    503,
    "The media manifest could not be verified.",
  );
}

function privateNotFound(): never {
  throw new SafeApplicationError(
    "not_found",
    404,
    "The media file could not be found.",
  );
}
