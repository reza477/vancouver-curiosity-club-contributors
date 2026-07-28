import {
  authorizeMembership,
  type AuthorizedMembership,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  assertOnlyKeys,
  parseBoundedString,
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  parseObject,
  parseOptionalBoundedString,
  validationIssue,
} from "../../validation";
import {
  assertNoProtectedLegalClaim,
  protectedLegalClaimSql,
} from "../../validation/protected-legal-claims";
import { publicOrganizerEmailExposureSql } from "../../validation/public-organizer-email";
import { SafeApplicationError } from "../../validation/server-observability";
import { consumeOrganizerRateLimit } from "../organizer/rate-limit";
import { PUBLIC_ORGANIZATION_SLUG } from "../public/catalog-definitions";
import { assertNoHistoricalOrganizerEmail } from "../public-content-safety";
import {
  MEDIA_VARIANT_WIDTHS,
  validateMediaUploadBundle,
  type MediaImageDecodeProbe,
  type MediaImageMimeType,
  type MediaUploadBundle,
} from "./image-validation";
import {
  currentPublishedMediaUsageTargetSql,
  mediaUsageRequiresUsefulAltSql,
} from "./public-usage-contract";

export const MEDIA_VARIANT_KINDS = [
  "original",
  "webp_480",
  "webp_960",
  "webp_1600",
] as const;
export type MediaVariantKind = (typeof MEDIA_VARIANT_KINDS)[number];
export const PUBLIC_MEDIA_VARIANT_KINDS = [
  "webp_480",
  "webp_960",
  "webp_1600",
] as const;

const MEDIA_PUBLIC_CONTENT_SAFE_SQL = `
  NOT (${protectedLegalClaimSql([
    "asset.alt_text",
    "asset.credit",
    "detail.caption",
  ])})
  AND NOT (${publicOrganizerEmailExposureSql(
    ["asset.alt_text", "asset.credit", "detail.caption"],
    "asset.organization_id",
  )})`;

export const MEDIA_RIGHTS_STATUSES = [
  "unconfirmed",
  "approved",
  "restricted",
] as const;
export type MediaRightsStatus = (typeof MEDIA_RIGHTS_STATUSES)[number];

export const MEDIA_CONSENT_STATUSES = [
  "not_applicable",
  "unconfirmed",
  "confirmed",
] as const;
export type MediaConsentStatus = (typeof MEDIA_CONSENT_STATUSES)[number];

export type R2ObjectBodyLike = Readonly<{
  arrayBuffer(): Promise<ArrayBuffer>;
  body: ReadableStream<Uint8Array> | null;
  etag?: string;
  httpEtag?: string;
  size?: number;
}>;

export interface R2BucketLike {
  delete(keys: string | string[]): Promise<void>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: Readonly<{
      httpMetadata?: Readonly<{ contentType?: string }>;
    }>,
  ): Promise<unknown>;
}

export type MediaAssetDto = Readonly<{
  altText: string | null;
  byteSize: number;
  caption: string | null;
  consentStatus: MediaConsentStatus;
  contentVersion: number;
  createdAt: number;
  credit: string | null;
  failureCode: string | null;
  fileName: string;
  finalizedAt: number | null;
  focalPoint: Readonly<{ x: number; y: number }>;
  height: number | null;
  id: string;
  informative: boolean;
  mimeType: MediaImageMimeType;
  participantConsentNote: string | null;
  rightsSourceNote: string | null;
  rightsStatus: MediaRightsStatus;
  sha256: string | null;
  uploadState: "pending" | "ready" | "failed" | "deleting";
  updatedAt: number;
  variants: readonly MediaVariantDto[];
  width: number | null;
}>;

export type MediaVariantDto = Readonly<{
  byteSize: number;
  height: number;
  kind: MediaVariantKind;
  mimeType: MediaImageMimeType;
  sha256: string;
  width: number;
}>;

export type MediaUsageBlockerDto = Readonly<{
  entityId: string;
  entityType: string;
  publicationScope: "draft" | "published";
  usageKind: string;
}>;

export type MediaCleanupPendingDto = Readonly<{
  assetId: string;
  cleanupVersion: number;
  fileName: string;
  updatedAt: number;
}>;

export type MediaDeleteResult =
  | Readonly<{
      blockers: readonly MediaUsageBlockerDto[];
      deleted: false;
      hasMoreBlockers: boolean;
    }>
  | Readonly<{
      cleanupPending: boolean;
      cleanupVersion: number;
      deleted: true;
    }>;

export class MediaAssetPublishedUseError extends SafeApplicationError {
  readonly blockers: readonly MediaUsageBlockerDto[];
  readonly hasMoreBlockers: boolean;

  constructor(
    blockers: readonly MediaUsageBlockerDto[],
    hasMoreBlockers: boolean,
  ) {
    super(
      "conflict",
      409,
      "Published content is using this asset. Remove that usage before making the asset ineligible.",
    );
    this.name = "MediaAssetPublishedUseError";
    this.blockers = blockers;
    this.hasMoreBlockers = hasMoreBlockers;
  }
}

export type MediaUploadInput = Readonly<{
  metadata: unknown;
  original: Readonly<{
    bytes: ArrayBuffer | Uint8Array;
    declaredMimeType: unknown;
    fileName: unknown;
  }>;
  variants: Readonly<{
    webp_480: Readonly<{
      bytes: ArrayBuffer | Uint8Array;
      declaredMimeType: unknown;
      fileName: unknown;
    }>;
    webp_960: Readonly<{
      bytes: ArrayBuffer | Uint8Array;
      declaredMimeType: unknown;
      fileName: unknown;
    }>;
    webp_1600: Readonly<{
      bytes: ArrayBuffer | Uint8Array;
      declaredMimeType: unknown;
      fileName: unknown;
    }>;
  }>;
}>;

type ParsedMediaMetadata = Readonly<{
  altText: string | null;
  caption: string | null;
  consentStatus: MediaConsentStatus;
  credit: string | null;
  focalPointX: number;
  focalPointY: number;
  informative: boolean;
  participantConsentNote: string | null;
  rightsSourceNote: string | null;
  rightsStatus: MediaRightsStatus;
}>;

type StoredMediaVariant = Readonly<{
  byteSize: number;
  height: number;
  kind: MediaVariantKind;
  mimeType: MediaImageMimeType;
  objectKey: string;
  sha256: string;
  width: number;
}>;

export class MediaAssetNotFoundError extends SafeApplicationError {
  constructor() {
    super("not_found", 404, "The media asset could not be found.");
    this.name = "MediaAssetNotFoundError";
  }
}

export class MediaAssetStaleEditError extends SafeApplicationError {
  constructor() {
    super(
      "stale_edit",
      409,
      "This media asset changed in another session. Refresh and try again.",
    );
    this.name = "MediaAssetStaleEditError";
  }
}

export async function uploadMediaAsset(
  database: D1DatabaseLike,
  bucket: R2BucketLike,
  identity: TrustedServerIdentity,
  rawInput: MediaUploadInput,
  options: Readonly<{
    decodeProbe: MediaImageDecodeProbe;
    nowUtcMs?: number;
  }>,
): Promise<MediaAssetDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  await consumeOrganizerRateLimit(database, {
    action: "media_upload",
    actor,
    limit: 10,
    nowUtcMs: options.nowUtcMs,
    scopeMaterial: `${actor.organizationId}:${actor.profileId}`,
    windowMs: 60 * 60_000,
  });

  const metadata = parseMediaMetadata(rawInput.metadata);
  await assertNoHistoricalOrganizerEmail(
    database,
    actor.organizationId,
    [metadata.altText, metadata.caption, metadata.credit],
    "metadata",
  );
  const bundle = await validateMediaUploadBundle(
    rawInput,
    options.decodeProbe,
  );
  const originalFileName = parseBoundedString(rawInput.original.fileName, {
    path: "original.fileName",
    maxLength: 255,
  });
  const now = options.nowUtcMs ?? Date.now();
  const assetId = crypto.randomUUID();
  const storedVariants = storedVariantsForBundle(bundle);
  const original = storedVariants.find(
    (variant) => variant.kind === "original",
  );
  if (!original) {
    throw new SafeApplicationError(
      "internal_error",
      500,
      "The media upload could not be prepared.",
    );
  }

  const pending = await database.batch([
    database
      .prepare(
        `INSERT INTO media_assets (
           id, organization_id, object_key, file_name, mime_type, byte_size,
           alt_text, credit, rights_status, participant_consent_status,
           is_public, uploaded_by_profile_id, created_at, updated_at, deleted_at
         )
         SELECT ?, membership.organization_id, ?, ?, ?, ?, ?, ?, ?, ?,
                0, membership.profile_id, ?, ?, NULL
         FROM organization_memberships AS membership
         JOIN profiles AS profile
           ON profile.id = membership.profile_id
         JOIN organizations AS organization
           ON organization.id = membership.organization_id
         WHERE membership.id = ?
           AND membership.organization_id = ?
           AND membership.profile_id = ?
           AND membership.role IN ('owner', 'administrator')
           AND membership.status = 'active'
           AND membership.deleted_at IS NULL
           AND profile.status = 'active'
           AND profile.deleted_at IS NULL
           AND organization.deleted_at IS NULL`,
      )
      .bind(
        assetId,
        original.objectKey,
        originalFileName,
        original.mimeType,
        original.byteSize,
        metadata.altText,
        metadata.credit,
        metadata.rightsStatus,
        metadata.consentStatus,
        now,
        now,
        actor.membershipId,
        actor.organizationId,
        actor.profileId,
      ),
    database
      .prepare(
        `INSERT INTO media_asset_details (
           asset_id, organization_id, upload_state, caption,
           private_rights_source_note, private_participant_consent_note,
           focal_point_x, focal_point_y, informative, content_version,
           original_sha256, width, height, pixel_count, failure_code,
           finalized_at, updated_by_profile_id, created_at, updated_at
         )
         SELECT asset.id, asset.organization_id, 'pending', ?, ?, ?, ?, ?, ?,
                1, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?
         FROM media_assets AS asset
         WHERE asset.id = ?
           AND asset.organization_id = ?
           AND asset.uploaded_by_profile_id = ?
           AND asset.deleted_at IS NULL`,
      )
      .bind(
        metadata.caption,
        metadata.rightsSourceNote,
        metadata.participantConsentNote,
        metadata.focalPointX,
        metadata.focalPointY,
        metadata.informative ? 1 : 0,
        actor.profileId,
        now,
        now,
        assetId,
        actor.organizationId,
        actor.profileId,
      ),
    ...storedVariants.map((variant) =>
      database
        .prepare(
          `INSERT INTO media_asset_variants (
             id, organization_id, asset_id, variant_kind, object_key,
             mime_type, byte_size, width, height, pixel_count, sha256,
             state, failure_code, created_at, finalized_at
           )
           SELECT ?, detail.organization_id, detail.asset_id, ?, ?, ?, ?,
                  ?, ?, ?, ?, 'pending', NULL, ?, NULL
           FROM media_asset_details AS detail
           JOIN media_assets AS asset
             ON asset.id = detail.asset_id
            AND asset.organization_id = detail.organization_id
            AND asset.deleted_at IS NULL
           WHERE detail.asset_id = ?
             AND detail.organization_id = ?
             AND detail.upload_state = 'pending'
             AND detail.content_version = 1`,
        )
        .bind(
          crypto.randomUUID(),
          variant.kind,
          variant.objectKey,
          variant.mimeType,
          variant.byteSize,
          variant.width,
          variant.height,
          variant.width * variant.height,
          variant.sha256,
          now,
          assetId,
          actor.organizationId,
        ),
    ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action, entity_type,
           entity_id, metadata_json, created_at
         )
         SELECT ?, asset.organization_id, ?, 'media.upload_started',
                'media_asset', asset.id, '{}', ?
         FROM media_assets AS asset
         JOIN media_asset_details AS detail
           ON detail.asset_id = asset.id
          AND detail.organization_id = asset.organization_id
         WHERE asset.id = ?
           AND asset.organization_id = ?
           AND detail.upload_state = 'pending'`,
      )
      .bind(
        crypto.randomUUID(),
        actor.profileId,
        now,
        assetId,
        actor.organizationId,
      ),
  ]);
  if (
    pending.length !== 7 ||
    pending.some((result) => changes(result) !== 1)
  ) {
    throw new MediaAssetStaleEditError();
  }

  const putResults = await Promise.allSettled(
    storedVariants.map((variant) =>
        bucket.put(variant.objectKey, bundleBytes(bundle, variant.kind), {
          httpMetadata: { contentType: variant.mimeType },
        }),
      ),
  );
  if (putResults.some((result) => result.status === "rejected")) {
    const cleanupSucceeded = await bestEffortDelete(
      bucket,
      storedVariants.flatMap((item, index) =>
        putResults[index]?.status === "fulfilled" ? [item.objectKey] : [],
      ),
    );
    await markUploadFailed(
      database,
      actor,
      assetId,
      cleanupSucceeded ? "r2_put_failed" : "r2_cleanup_pending",
      now,
    );
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The media upload could not be stored. Please try again.",
    );
  }

  try {
    const results = await database.batch([
      ...storedVariants.map((variant) =>
        database
          .prepare(
            `UPDATE media_asset_variants
             SET state = 'ready',
                 failure_code = NULL,
                 finalized_at = ?
             WHERE asset_id = ?
               AND organization_id = ?
               AND variant_kind = ?
               AND object_key = ?
               AND sha256 = ?
               AND state = 'pending'
               AND finalized_at IS NULL
               AND EXISTS (
                 SELECT 1
                 FROM media_asset_details AS detail
                 WHERE detail.asset_id = media_asset_variants.asset_id
                   AND detail.organization_id =
                       media_asset_variants.organization_id
                   AND detail.upload_state = 'pending'
                   AND detail.content_version = 1
               )
               AND EXISTS (
                 SELECT 1
                 FROM organization_memberships AS membership
                 JOIN profiles AS profile
                   ON profile.id = membership.profile_id
                 WHERE membership.id = ?
                   AND membership.organization_id =
                       media_asset_variants.organization_id
                   AND membership.profile_id = ?
                   AND membership.role IN ('owner', 'administrator')
                   AND membership.status = 'active'
                   AND membership.deleted_at IS NULL
                   AND profile.status = 'active'
                   AND profile.deleted_at IS NULL
               )`,
          )
          .bind(
            now,
            assetId,
            actor.organizationId,
            variant.kind,
            variant.objectKey,
            variant.sha256,
            actor.membershipId,
            actor.profileId,
          ),
      ),
      database
        .prepare(
          `UPDATE media_asset_details
           SET upload_state = 'ready',
               original_sha256 = ?,
               width = ?,
               height = ?,
               pixel_count = ?,
               finalized_at = ?,
               failure_code = NULL,
               updated_at = ?,
               updated_by_profile_id = ?
           WHERE asset_id = ?
             AND organization_id = ?
             AND upload_state = 'pending'
             AND content_version = 1
             AND (
               SELECT COUNT(*)
               FROM media_asset_variants AS variant
               WHERE variant.asset_id = media_asset_details.asset_id
                 AND variant.organization_id =
                     media_asset_details.organization_id
                 AND variant.state = 'ready'
             ) = 4
             AND EXISTS (
               SELECT 1
               FROM organization_memberships AS membership
               JOIN profiles AS profile
                 ON profile.id = membership.profile_id
               WHERE membership.id = ?
                 AND membership.organization_id =
                     media_asset_details.organization_id
                 AND membership.profile_id = ?
                 AND membership.role IN ('owner', 'administrator')
                 AND membership.status = 'active'
                 AND membership.deleted_at IS NULL
                 AND profile.status = 'active'
                 AND profile.deleted_at IS NULL
             )`,
        )
        .bind(
          bundle.original.sha256,
          bundle.original.displayWidth,
          bundle.original.displayHeight,
          bundle.original.displayWidth * bundle.original.displayHeight,
          now,
          now,
          actor.profileId,
          assetId,
          actor.organizationId,
          actor.membershipId,
          actor.profileId,
        ),
      database
        .prepare(
          `INSERT INTO audit_logs (
             id, organization_id, actor_profile_id, action, entity_type,
             entity_id, metadata_json, created_at
           )
           VALUES (
             ?, ?, ?,
             CASE
               WHEN EXISTS (
                 SELECT 1
                 FROM media_assets AS asset
                 JOIN media_asset_details AS detail
                   ON detail.asset_id = asset.id
                  AND detail.organization_id = asset.organization_id
                 JOIN organization_memberships AS membership
                   ON membership.id = ?
                  AND membership.organization_id = asset.organization_id
                  AND membership.profile_id = ?
                  AND membership.role IN ('owner', 'administrator')
                  AND membership.status = 'active'
                  AND membership.deleted_at IS NULL
                 JOIN profiles AS profile
                   ON profile.id = membership.profile_id
                  AND profile.status = 'active'
                  AND profile.deleted_at IS NULL
                 WHERE asset.id = ?
                   AND asset.organization_id = ?
                   AND asset.deleted_at IS NULL
                   AND detail.upload_state = 'ready'
                   AND detail.content_version = 1
                   AND detail.finalized_at = ?
                   AND detail.updated_by_profile_id = ?
                   AND (
                     SELECT count(*)
                     FROM media_asset_variants AS variant
                     WHERE variant.asset_id = asset.id
                       AND variant.organization_id = asset.organization_id
                       AND variant.state = 'ready'
                       AND variant.finalized_at = ?
                   ) = 4
               )
               THEN 'media.upload_finalized'
               ELSE NULL
             END,
             'media_asset', ?, '{}', ?
           )`,
        )
        .bind(
          crypto.randomUUID(),
          actor.organizationId,
          actor.profileId,
          actor.membershipId,
          actor.profileId,
          assetId,
          actor.organizationId,
          now,
          actor.profileId,
          now,
          assetId,
          now,
        ),
    ]);
    if (
      results.length !== 6 ||
      results.some((result) => changes(result) !== 1)
    ) {
      throw new MediaAssetStaleEditError();
    }
  } catch (error) {
    const state = await readUploadState(database, assetId, actor.organizationId);
    if (state !== "ready") {
      const cleanupSucceeded = await bestEffortDelete(
        bucket,
        storedVariants.map((item) => item.objectKey),
      );
      await markUploadFailed(
        database,
        actor,
        assetId,
        cleanupSucceeded ? "finalization_failed" : "r2_cleanup_pending",
        now,
      );
      throw error;
    }
  }

  return readMediaAsset(database, identity, assetId);
}

export async function listMediaAssets(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  options: Readonly<{ limit?: number }> = {},
): Promise<readonly MediaAssetDto[]> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const limit = parseFiniteInteger(options.limit ?? 50, {
    path: "limit",
    minimum: 1,
    maximum: 100,
  });
  const rows = await database
    .prepare(`${PRIVATE_MEDIA_ASSET_SELECT_SQL}
      WHERE asset.organization_id = ?
        AND asset.deleted_at IS NULL
      ORDER BY asset.created_at DESC, asset.id ASC
      LIMIT ?`)
    .bind(actor.organizationId, limit)
    .all<Record<string, unknown>>();
  return Object.freeze((rows.results ?? []).map(privateMediaDto));
}

export async function listPendingMediaCleanups(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  options: Readonly<{ limit?: number; nowUtcMs?: number }> = {},
): Promise<readonly MediaCleanupPendingDto[]> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const limit = parseFiniteInteger(options.limit ?? 25, {
    path: "limit",
    minimum: 1,
    maximum: 50,
  });
  const abandonedBefore = (options.nowUtcMs ?? Date.now()) - 15 * 60_000;
  const rows = await database
    .prepare(
      `SELECT asset.id AS asset_id,
              asset.file_name,
              detail.content_version AS cleanup_version,
              detail.updated_at
       FROM media_assets AS asset
       JOIN media_asset_details AS detail
         ON detail.asset_id = asset.id
        AND detail.organization_id = asset.organization_id
       WHERE asset.organization_id = ?
         AND (
           (
             asset.deleted_at IS NOT NULL
             AND detail.upload_state = 'deleting'
           )
           OR (
             asset.deleted_at IS NULL
             AND detail.upload_state = 'failed'
             AND detail.failure_code = 'r2_cleanup_pending'
           )
           OR (
             asset.deleted_at IS NULL
             AND detail.upload_state = 'pending'
             AND detail.updated_at <= ?
           )
         )
         AND EXISTS (
           SELECT 1
           FROM media_asset_variants AS variant
           WHERE variant.organization_id = asset.organization_id
             AND variant.asset_id = asset.id
         )
       ORDER BY detail.updated_at ASC, asset.id ASC
       LIMIT ?`,
    )
    .bind(actor.organizationId, abandonedBefore, limit)
    .all<Record<string, unknown>>();
  return Object.freeze(
    (rows.results ?? []).map((row) =>
      Object.freeze({
        assetId: requiredString(row.asset_id),
        cleanupVersion: requiredNumber(row.cleanup_version),
        fileName: requiredString(row.file_name),
        updatedAt: requiredNumber(row.updated_at),
      }),
    ),
  );
}

export async function readMediaAsset(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  rawAssetId: unknown,
): Promise<MediaAssetDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const assetId = parseIdentifier(rawAssetId, "assetId");
  const row = await database
    .prepare(`${PRIVATE_MEDIA_ASSET_SELECT_SQL}
      WHERE asset.id = ?
        AND asset.organization_id = ?
        AND asset.deleted_at IS NULL
      LIMIT 1`)
    .bind(assetId, actor.organizationId)
    .first<Record<string, unknown>>();
  if (!row) throw new MediaAssetNotFoundError();
  return privateMediaDto(row);
}

export async function updateMediaAssetMetadata(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  rawAssetId: unknown,
  rawExpectedVersion: unknown,
  rawMetadata: unknown,
  options: Readonly<{ nowUtcMs?: number }> = {},
): Promise<MediaAssetDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const assetId = parseIdentifier(rawAssetId, "assetId");
  const expectedVersion = parseFiniteInteger(rawExpectedVersion, {
    path: "expectedVersion",
    minimum: 1,
  });
  const metadata = parseMediaMetadata(rawMetadata);
  await assertNoHistoricalOrganizerEmail(
    database,
    actor.organizationId,
    [metadata.altText, metadata.caption, metadata.credit],
    "metadata",
  );
  const remainsPublicReady = metadataIsPublicReady(metadata);
  const lacksUsefulAlt = !metadata.altText?.trim();
  if (!remainsPublicReady || lacksUsefulAlt) {
    const currentUsages = await readActiveMediaUsageBlockers(
      database,
      actor.organizationId,
      assetId,
      "published",
    );
    const blockingUsages = remainsPublicReady
      ? currentUsages.filter((usage) =>
          mediaUsageRequiresUsefulAlt(usage),
        )
      : currentUsages;
    if (blockingUsages.length > 0) {
      throw new MediaAssetPublishedUseError(
        Object.freeze(blockingUsages.slice(0, 50)),
        blockingUsages.length > 50,
      );
    }
  }
  const now = options.nowUtcMs ?? Date.now();
  const results = await database.batch([
    database
      .prepare(
        `UPDATE media_assets
         SET alt_text = ?,
             credit = ?,
             rights_status = ?,
             participant_consent_status = ?,
             updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND deleted_at IS NULL
           AND (
             ? = 1
             OR NOT EXISTS (
               SELECT 1
               FROM media_usage_references AS usage
               WHERE usage.organization_id = media_assets.organization_id
                 AND usage.asset_id = media_assets.id
                 AND usage.publication_scope = 'published'
                 AND usage.deleted_at IS NULL
             )
           )
           AND EXISTS (
             SELECT 1
             FROM media_asset_details AS detail
             WHERE detail.asset_id = media_assets.id
               AND detail.organization_id = media_assets.organization_id
               AND detail.content_version = ?
               AND detail.upload_state IN ('pending', 'ready', 'failed')
           )
           AND EXISTS (
             SELECT 1
             FROM organization_memberships AS membership
             JOIN profiles AS profile
               ON profile.id = membership.profile_id
             WHERE membership.id = ?
               AND membership.organization_id = media_assets.organization_id
               AND membership.profile_id = ?
               AND membership.role IN ('owner', 'administrator')
               AND membership.status = 'active'
               AND membership.deleted_at IS NULL
               AND profile.status = 'active'
               AND profile.deleted_at IS NULL
           )`,
      )
      .bind(
        metadata.altText,
        metadata.credit,
        metadata.rightsStatus,
        metadata.consentStatus,
        now,
        assetId,
        actor.organizationId,
        remainsPublicReady ? 1 : 0,
        expectedVersion,
        actor.membershipId,
        actor.profileId,
      ),
    database
      .prepare(
        `UPDATE media_asset_details
         SET caption = ?,
             private_rights_source_note = ?,
             private_participant_consent_note = ?,
             focal_point_x = ?,
             focal_point_y = ?,
             informative = ?,
             content_version = content_version + 1,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE asset_id = ?
           AND organization_id = ?
           AND content_version = ?
           AND upload_state IN ('pending', 'ready', 'failed')
           AND changes() = 1`,
      )
      .bind(
        metadata.caption,
        metadata.rightsSourceNote,
        metadata.participantConsentNote,
        metadata.focalPointX,
        metadata.focalPointY,
        metadata.informative ? 1 : 0,
        actor.profileId,
        now,
        assetId,
        actor.organizationId,
        expectedVersion,
      ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action, entity_type,
           entity_id, metadata_json, created_at
         )
         SELECT ?, detail.organization_id, ?, 'media.metadata_updated',
                'media_asset', detail.asset_id, '{}', ?
         FROM media_asset_details AS detail
         WHERE detail.asset_id = ?
           AND detail.organization_id = ?
           AND detail.content_version = ?
           AND changes() = 1`,
      )
      .bind(
        crypto.randomUUID(),
        actor.profileId,
        now,
        assetId,
        actor.organizationId,
        expectedVersion + 1,
      ),
  ]);
  if (results.some((result) => changes(result) !== 1)) {
    if (!remainsPublicReady) {
      const currentUsages = await readActiveMediaUsageBlockers(
        database,
        actor.organizationId,
        assetId,
        "published",
      );
      if (currentUsages.length > 0) {
        throw new MediaAssetPublishedUseError(
          Object.freeze(currentUsages.slice(0, 50)),
          currentUsages.length > 50,
        );
      }
    }
    throw new MediaAssetStaleEditError();
  }
  return readMediaAsset(database, identity, assetId);
}

export async function deleteMediaAsset(
  database: D1DatabaseLike,
  bucket: R2BucketLike,
  identity: TrustedServerIdentity,
  rawAssetId: unknown,
  rawExpectedVersion: unknown,
  options: Readonly<{ nowUtcMs?: number }> = {},
): Promise<MediaDeleteResult> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const assetId = parseIdentifier(rawAssetId, "assetId");
  const expectedVersion = parseFiniteInteger(rawExpectedVersion, {
    path: "expectedVersion",
    minimum: 1,
  });
  const usages = await readActiveMediaUsageBlockers(
    database,
    actor.organizationId,
    assetId,
  );
  if (usages.length > 0) {
    return Object.freeze({
      blockers: Object.freeze(usages.slice(0, 50)),
      deleted: false as const,
      hasMoreBlockers: usages.length > 50,
    });
  }

  const objectKeyRows = await database
    .prepare(
      `SELECT variant.object_key
       FROM media_asset_variants AS variant
       JOIN media_assets AS asset
         ON asset.id = variant.asset_id
        AND asset.organization_id = variant.organization_id
       JOIN media_asset_details AS detail
         ON detail.asset_id = asset.id
        AND detail.organization_id = asset.organization_id
       WHERE asset.id = ?
         AND asset.organization_id = ?
         AND asset.deleted_at IS NULL
         AND detail.content_version = ?
       ORDER BY variant.variant_kind ASC`,
    )
    .bind(assetId, actor.organizationId, expectedVersion)
    .all<Record<string, unknown>>();
  const objectKeys = (objectKeyRows.results ?? []).map((row) =>
    requiredString(row.object_key),
  );
  if (objectKeys.length !== 4) throw new MediaAssetStaleEditError();

  const now = options.nowUtcMs ?? Date.now();
  const results = await database.batch([
    database
      .prepare(
        `UPDATE media_asset_details
         SET upload_state = 'deleting',
             content_version = content_version + 1,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE asset_id = ?
           AND organization_id = ?
           AND content_version = ?
           AND upload_state = 'ready'
           AND NOT EXISTS (
             SELECT 1
             FROM media_usage_references AS usage
             WHERE usage.organization_id =
                   media_asset_details.organization_id
               AND usage.asset_id = media_asset_details.asset_id
               AND usage.deleted_at IS NULL
           )
           AND EXISTS (
             SELECT 1
             FROM organization_memberships AS membership
             JOIN profiles AS profile
               ON profile.id = membership.profile_id
             WHERE membership.id = ?
               AND membership.organization_id =
                   media_asset_details.organization_id
               AND membership.profile_id = ?
               AND membership.role IN ('owner', 'administrator')
               AND membership.status = 'active'
               AND membership.deleted_at IS NULL
               AND profile.status = 'active'
               AND profile.deleted_at IS NULL
           )`,
      )
      .bind(
        actor.profileId,
        now,
        assetId,
        actor.organizationId,
        expectedVersion,
        actor.membershipId,
        actor.profileId,
      ),
    database
      .prepare(
        `UPDATE media_assets
         SET deleted_at = ?,
             is_public = 0,
             updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM media_asset_details AS detail
             WHERE detail.asset_id = media_assets.id
               AND detail.organization_id = media_assets.organization_id
               AND detail.upload_state = 'deleting'
               AND detail.content_version = ?
           )
           AND changes() = 1`,
      )
      .bind(
        now,
        now,
        assetId,
        actor.organizationId,
        expectedVersion + 1,
      ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action, entity_type,
           entity_id, metadata_json, created_at
         )
         SELECT ?, asset.organization_id, ?, 'media.deleted', 'media_asset',
                asset.id, '{}', ?
         FROM media_assets AS asset
         WHERE asset.id = ?
           AND asset.organization_id = ?
           AND asset.deleted_at = ?
           AND changes() = 1`,
      )
      .bind(
        crypto.randomUUID(),
        actor.profileId,
        now,
        assetId,
        actor.organizationId,
        now,
      ),
  ]);
  if (results.some((result) => changes(result) !== 1)) {
    throw new MediaAssetStaleEditError();
  }

  let cleanupPending = false;
  try {
    await bucket.delete(objectKeys);
    await finalizeDeletedMediaCleanup(
      database,
      actor,
      assetId,
      expectedVersion + 1,
      now,
    );
  } catch {
    cleanupPending = true;
  }
  return Object.freeze({
    cleanupPending,
    cleanupVersion: expectedVersion + 1,
    deleted: true as const,
  });
}

export async function retryDeletedMediaCleanup(
  database: D1DatabaseLike,
  bucket: R2BucketLike,
  identity: TrustedServerIdentity,
  rawAssetId: unknown,
  rawExpectedVersion: unknown,
): Promise<Readonly<{ cleanupPending: boolean }>> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const assetId = parseIdentifier(rawAssetId, "assetId");
  const expectedVersion = parseFiniteInteger(rawExpectedVersion, {
    path: "expectedVersion",
    minimum: 1,
  });
  const state = await database
    .prepare(
      `SELECT detail.content_version,
              detail.upload_state,
              detail.failure_code,
              asset.deleted_at,
              (
                SELECT count(*)
                FROM media_asset_variants AS variant
                WHERE variant.organization_id = asset.organization_id
                  AND variant.asset_id = asset.id
              ) AS variant_count
       FROM media_assets AS asset
       JOIN media_asset_details AS detail
         ON detail.asset_id = asset.id
        AND detail.organization_id = asset.organization_id
       WHERE asset.id = ?
         AND asset.organization_id = ?
         AND (
           (
             asset.deleted_at IS NOT NULL
             AND detail.upload_state = 'deleting'
           )
           OR (
             asset.deleted_at IS NULL
             AND detail.upload_state = 'failed'
             AND detail.failure_code = 'r2_cleanup_pending'
           )
           OR (
             asset.deleted_at IS NULL
             AND detail.upload_state = 'pending'
           )
         )
       LIMIT 1`,
    )
    .bind(assetId, actor.organizationId)
    .first<Record<string, unknown>>();
  if (!state) throw new MediaAssetNotFoundError();
  if (requiredNumber(state.content_version) !== expectedVersion) {
    throw new MediaAssetStaleEditError();
  }
  const variantCount = requiredNumber(state.variant_count);
  if (variantCount === 0) {
    if (
      state.deleted_at !== null &&
      state.upload_state === "deleting"
    ) {
      return Object.freeze({ cleanupPending: false });
    }
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The stored media cleanup manifest is incomplete.",
    );
  }
  if (variantCount !== 4) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The stored media cleanup manifest is incomplete.",
    );
  }
  const rows = await database
    .prepare(
      `SELECT variant.object_key
       FROM media_asset_variants AS variant
       WHERE variant.asset_id = ?
         AND variant.organization_id = ?
       ORDER BY variant.variant_kind ASC`,
    )
    .bind(assetId, actor.organizationId)
    .all<Record<string, unknown>>();
  const keys = (rows.results ?? []).map((row) =>
    requiredString(row.object_key),
  );
  if (keys.length !== 4) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The stored media cleanup manifest is incomplete.",
    );
  }
  try {
    await bucket.delete(keys);
    if (
      state.deleted_at !== null &&
      state.upload_state === "deleting"
    ) {
      await finalizeDeletedMediaCleanup(
        database,
        actor,
        assetId,
        expectedVersion,
        Date.now(),
      );
    } else {
      await finalizeAbandonedUploadCleanup(
        database,
        actor,
        assetId,
        expectedVersion,
        Date.now(),
      );
    }
    return Object.freeze({ cleanupPending: false });
  } catch {
    return Object.freeze({ cleanupPending: true });
  }
}

export async function authorizeOrganizerEventMediaSelection(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  rawEventId: unknown,
  rawAssetId: unknown,
): Promise<Readonly<{ assetId: string; organizationId: string }>> {
  const membership = await authorizeMembership(database, identity);
  const eventId = parseIdentifier(rawEventId, "eventId");
  const assetId = parseIdentifier(rawAssetId, "assetId");
  const row = await database
    .prepare(
      `SELECT asset.id AS asset_id, asset.organization_id
       FROM media_assets AS asset
       JOIN media_asset_details AS detail
         ON detail.asset_id = asset.id
        AND detail.organization_id = asset.organization_id
       JOIN organizer_events AS event
         ON event.id = ?
        AND event.organization_id = asset.organization_id
        AND event.deleted_at IS NULL
       JOIN clubs AS club
         ON club.id = event.club_id
        AND club.organization_id = event.organization_id
        AND club.deleted_at IS NULL
       WHERE asset.id = ?
         AND asset.organization_id = ?
         AND asset.deleted_at IS NULL
         AND detail.upload_state = 'ready'
         AND asset.rights_status = 'approved'
         AND asset.participant_consent_status IN ('not_applicable', 'confirmed')
         AND length(trim(COALESCE(asset.credit, ''))) > 0
         AND length(trim(COALESCE(asset.alt_text, ''))) > 0
         AND ${MEDIA_PUBLIC_CONTENT_SAFE_SQL}
         AND (
           ? IN ('owner', 'administrator')
           OR (
             ? = 'organizer'
             AND (
               event.primary_organizer_profile_id = ?
               OR EXISTS (
                 SELECT 1
                 FROM organizer_event_organizers AS co
                 WHERE co.organization_id = event.organization_id
                   AND co.organizer_event_id = event.id
                   AND co.profile_id = ?
                   AND co.deleted_at IS NULL
               )
             )
             AND EXISTS (
               SELECT 1
               FROM club_memberships AS assignment
               WHERE assignment.organization_id = event.organization_id
                 AND assignment.club_id = event.club_id
                 AND assignment.organization_membership_id = ?
                 AND assignment.profile_id = ?
                 AND assignment.role = 'organizer'
                 AND assignment.status = 'active'
                 AND assignment.deleted_at IS NULL
             )
           )
         )
       LIMIT 1`,
    )
    .bind(
      eventId,
      assetId,
      membership.organizationId,
      membership.role,
      membership.role,
      membership.profileId,
      membership.profileId,
      membership.membershipId,
      membership.profileId,
    )
    .first<Record<string, unknown>>();
  if (!row) throw new MediaAssetNotFoundError();
  return Object.freeze({
    assetId: requiredString(row.asset_id),
    organizationId: requiredString(row.organization_id),
  });
}

export async function getPublicMediaVariant(
  database: D1DatabaseLike,
  bucket: R2BucketLike,
  rawAssetId: unknown,
  rawVariantKind: unknown,
): Promise<Readonly<{
  body: R2ObjectBodyLike;
  etag: string;
  mimeType: MediaImageMimeType;
}>> {
  const assetId = parseIdentifier(rawAssetId, "assetId");
  let variantKind: (typeof PUBLIC_MEDIA_VARIANT_KINDS)[number];
  try {
    variantKind = parseEnum(
      rawVariantKind,
      PUBLIC_MEDIA_VARIANT_KINDS,
      "variant",
    );
  } catch {
    throw new MediaAssetNotFoundError();
  }
  const row = await database
    .prepare(
      `SELECT variant.object_key, variant.mime_type, variant.sha256
       FROM media_assets AS asset
       JOIN organizations AS public_organization
         ON public_organization.id = asset.organization_id
        AND public_organization.slug = ?
        AND public_organization.deleted_at IS NULL
       JOIN media_asset_details AS detail
         ON detail.asset_id = asset.id
        AND detail.organization_id = asset.organization_id
       JOIN media_asset_variants AS variant
         ON variant.asset_id = asset.id
        AND variant.organization_id = asset.organization_id
        AND variant.variant_kind = ?
        AND variant.state = 'ready'
       WHERE asset.id = ?
         AND asset.deleted_at IS NULL
         AND detail.upload_state = 'ready'
         AND asset.rights_status = 'approved'
         AND asset.participant_consent_status IN ('not_applicable', 'confirmed')
         AND length(trim(COALESCE(asset.credit, ''))) > 0
         AND (
           length(trim(COALESCE(asset.alt_text, ''))) > 0
           OR (
             detail.informative = 0
             AND NOT EXISTS (
               SELECT 1
               FROM media_usage_references AS required_alt_usage
               WHERE required_alt_usage.organization_id =
                     public_organization.id
                 AND required_alt_usage.asset_id = asset.id
                 AND required_alt_usage.publication_scope = 'published'
                 AND required_alt_usage.deleted_at IS NULL
                 AND ${mediaUsageRequiresUsefulAltSql(
                   "required_alt_usage",
                 )}
                 AND ${currentPublishedMediaUsageTargetSql(
                   "required_alt_usage",
                 )}
             )
           )
         )
         AND ${MEDIA_PUBLIC_CONTENT_SAFE_SQL}
         AND EXISTS (
           SELECT 1
           FROM media_usage_references AS usage
           WHERE usage.organization_id = public_organization.id
             AND usage.asset_id = asset.id
             AND usage.publication_scope = 'published'
             AND usage.deleted_at IS NULL
             AND ${currentPublishedMediaUsageTargetSql("usage")}
         )
       LIMIT 1`,
    )
    .bind(PUBLIC_ORGANIZATION_SLUG, variantKind, assetId)
    .first<Record<string, unknown>>();
  if (!row) throw new MediaAssetNotFoundError();
  const body = await bucket.get(requiredString(row.object_key));
  if (!body) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The media file is temporarily unavailable.",
    );
  }
  return Object.freeze({
    body,
    etag: requiredString(row.sha256),
    mimeType: readMimeType(row.mime_type),
  });
}

export async function getPrivateMediaVariant(
  database: D1DatabaseLike,
  bucket: R2BucketLike,
  identity: TrustedServerIdentity,
  rawAssetId: unknown,
  rawVariantKind: unknown,
  options: Readonly<{ eventId?: unknown }> = {},
): Promise<Readonly<{
  body: R2ObjectBodyLike;
  etag: string;
  mimeType: MediaImageMimeType;
}>> {
  const membership = await authorizeMembership(database, identity);
  const assetId = parseIdentifier(rawAssetId, "assetId");
  const organizerEventId =
    options.eventId === undefined
      ? null
      : parseIdentifier(options.eventId, "eventId");
  const variantKind = parseEnum(
    rawVariantKind,
    MEDIA_VARIANT_KINDS,
    "variant",
  );
  const row = await database
    .prepare(
      `SELECT variant.object_key, variant.mime_type, variant.sha256
       FROM media_assets AS asset
       JOIN media_asset_details AS detail
         ON detail.asset_id = asset.id
        AND detail.organization_id = asset.organization_id
       JOIN media_asset_variants AS variant
         ON variant.asset_id = asset.id
        AND variant.organization_id = asset.organization_id
        AND variant.variant_kind = ?
        AND variant.state = 'ready'
       JOIN organization_memberships AS current_membership
         ON current_membership.id = ?
        AND current_membership.organization_id = asset.organization_id
        AND current_membership.profile_id = ?
        AND current_membership.status = 'active'
        AND current_membership.deleted_at IS NULL
       JOIN profiles AS current_profile
         ON current_profile.id = current_membership.profile_id
        AND current_profile.status = 'active'
        AND current_profile.deleted_at IS NULL
       WHERE asset.id = ?
         AND asset.organization_id = ?
         AND asset.deleted_at IS NULL
         AND detail.upload_state = 'ready'
         AND (
           current_membership.role IN ('owner', 'administrator')
           OR (
           current_membership.role = 'organizer'
             AND variant.variant_kind IN (
               'webp_480', 'webp_960', 'webp_1600'
             )
             AND asset.rights_status = 'approved'
             AND asset.participant_consent_status
                 IN ('not_applicable', 'confirmed')
             AND length(trim(COALESCE(asset.credit, ''))) > 0
             AND (
               detail.informative = 0
               OR length(trim(COALESCE(asset.alt_text, ''))) > 0
             )
             AND ${MEDIA_PUBLIC_CONTENT_SAFE_SQL}
             AND (
               SELECT count(*)
               FROM media_asset_variants AS ready_variant
               WHERE ready_variant.organization_id = asset.organization_id
                 AND ready_variant.asset_id = asset.id
                 AND ready_variant.state = 'ready'
                 AND ready_variant.variant_kind IN (
                   'original', 'webp_480', 'webp_960', 'webp_1600'
                 )
             ) = 4
             AND ? IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM organizer_events AS event
               JOIN club_memberships AS assignment
                 ON assignment.organization_id = event.organization_id
                AND assignment.club_id = event.club_id
                AND assignment.organization_membership_id =
                    current_membership.id
                AND assignment.profile_id =
                    current_membership.profile_id
                AND assignment.role = 'organizer'
                AND assignment.status = 'active'
                AND assignment.deleted_at IS NULL
               WHERE event.id = ?
                 AND event.organization_id = asset.organization_id
                 AND event.deleted_at IS NULL
                 AND (
                   event.primary_organizer_profile_id =
                       current_membership.profile_id
                   OR EXISTS (
                     SELECT 1
                     FROM organizer_event_organizers AS co
                     WHERE co.organization_id = event.organization_id
                       AND co.organizer_event_id = event.id
                       AND co.profile_id = current_membership.profile_id
                       AND co.deleted_at IS NULL
                   )
                 )
             )
           )
         )
       LIMIT 1`,
    )
    .bind(
      variantKind,
      membership.membershipId,
      membership.profileId,
      assetId,
      membership.organizationId,
      organizerEventId,
      organizerEventId,
    )
    .first<Record<string, unknown>>();
  if (!row) throw new MediaAssetNotFoundError();
  const body = await bucket.get(requiredString(row.object_key));
  if (!body) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The media file is temporarily unavailable.",
    );
  }
  return Object.freeze({
    body,
    etag: requiredString(row.sha256),
    mimeType: readMimeType(row.mime_type),
  });
}

function parseMediaMetadata(value: unknown): ParsedMediaMetadata {
  const input = parseObject(value, "metadata");
  assertOnlyKeys(
    input,
    [
      "altText",
      "caption",
      "consentStatus",
      "credit",
      "focalPointX",
      "focalPointY",
      "informative",
      "participantConsentNote",
      "rightsSourceNote",
      "rightsStatus",
    ],
    "metadata",
  );
  if (typeof input.informative !== "boolean") {
    throw validationIssue(
      "metadata.informative",
      "invalid_type",
      "Expected a true or false value.",
    );
  }
  return Object.freeze({
    altText: parsePublicMediaText(
      input.altText,
      "metadata.altText",
      300,
    ),
    caption: parsePublicMediaText(
      input.caption,
      "metadata.caption",
      1_000,
    ),
    consentStatus: parseEnum(
      input.consentStatus,
      MEDIA_CONSENT_STATUSES,
      "metadata.consentStatus",
    ),
    credit: parsePublicMediaText(
      input.credit,
      "metadata.credit",
      300,
    ),
    focalPointX: parseFiniteInteger(input.focalPointX, {
      path: "metadata.focalPointX",
      minimum: 0,
      maximum: 10_000,
    }),
    focalPointY: parseFiniteInteger(input.focalPointY, {
      path: "metadata.focalPointY",
      minimum: 0,
      maximum: 10_000,
    }),
    informative: input.informative,
    participantConsentNote: parseOptionalBoundedString(
      input.participantConsentNote,
      {
        path: "metadata.participantConsentNote",
        maxLength: 1_000,
      },
    ),
    rightsSourceNote: parseOptionalBoundedString(input.rightsSourceNote, {
      path: "metadata.rightsSourceNote",
      maxLength: 1_000,
    }),
    rightsStatus: parseEnum(
      input.rightsStatus,
      MEDIA_RIGHTS_STATUSES,
      "metadata.rightsStatus",
    ),
  });
}

function parsePublicMediaText(
  value: unknown,
  path: string,
  maxLength: number,
): string | null {
  const parsed = parseOptionalBoundedString(value, {
    path,
    maxLength,
  });
  return parsed === null
    ? null
    : assertNoProtectedLegalClaim(parsed, path);
}

function storedVariantsForBundle(
  bundle: MediaUploadBundle,
): readonly StoredMediaVariant[] {
  const objectKeys = MEDIA_VARIANT_KINDS.map(
    () => `media/${crypto.randomUUID()}/${crypto.randomUUID()}`,
  );
  return Object.freeze([
    {
      byteSize: bundle.original.bytes.byteLength,
      height: bundle.original.displayHeight,
      kind: "original",
      mimeType: bundle.original.mimeType,
      objectKey: objectKeys[0] ?? "",
      sha256: bundle.original.sha256,
      width: bundle.original.displayWidth,
    },
    ...MEDIA_VARIANT_WIDTHS.map((width, index) => {
      const kind = `webp_${width}` as
        | "webp_480"
        | "webp_960"
        | "webp_1600";
      const variant = bundle.variants[kind];
      return {
        byteSize: variant.bytes.byteLength,
        height: variant.height,
        kind,
        mimeType: variant.mimeType,
        objectKey: objectKeys[index + 1] ?? "",
        sha256: variant.sha256,
        width: variant.width,
      };
    }),
  ]);
}

function bundleBytes(
  bundle: MediaUploadBundle,
  kind: MediaVariantKind,
): Uint8Array {
  return kind === "original" ? bundle.original.bytes : bundle.variants[kind].bytes;
}

async function markUploadFailed(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  assetId: string,
  failureCode:
    | "finalization_failed"
    | "r2_cleanup_pending"
    | "r2_put_failed",
  now: number,
): Promise<void> {
  try {
    await database.batch([
      database
        .prepare(
          `UPDATE media_asset_variants
           SET state = 'failed',
               failure_code = ?,
               finalized_at = NULL
           WHERE asset_id = ?
             AND organization_id = ?
             AND state = 'pending'
             AND EXISTS (
               SELECT 1
               FROM media_asset_details AS detail
               JOIN organization_memberships AS membership
                 ON membership.id = ?
                AND membership.organization_id = detail.organization_id
                AND membership.profile_id = ?
                AND membership.role IN ('owner', 'administrator')
                AND membership.status = 'active'
                AND membership.deleted_at IS NULL
               JOIN profiles AS profile
                 ON profile.id = membership.profile_id
                AND profile.status = 'active'
                AND profile.deleted_at IS NULL
               WHERE detail.asset_id = media_asset_variants.asset_id
                 AND detail.organization_id =
                     media_asset_variants.organization_id
                 AND detail.upload_state = 'pending'
                 AND detail.content_version = 1
             )`,
        )
        .bind(
          failureCode,
          assetId,
          actor.organizationId,
          actor.membershipId,
          actor.profileId,
        ),
      database
        .prepare(
          `UPDATE media_asset_details
           SET upload_state = 'failed',
               failure_code = ?,
               original_sha256 = NULL,
               width = NULL,
               height = NULL,
               pixel_count = NULL,
               finalized_at = NULL,
               updated_by_profile_id = ?,
               updated_at = ?
           WHERE asset_id = ?
             AND organization_id = ?
             AND upload_state = 'pending'
             AND content_version = 1
             AND changes() = 4`,
        )
        .bind(
          failureCode,
          actor.profileId,
          now,
          assetId,
          actor.organizationId,
        ),
      database
        .prepare(
          `INSERT INTO audit_logs (
             id, organization_id, actor_profile_id, action, entity_type,
             entity_id, metadata_json, created_at
           )
           VALUES (
             ?, ?, ?,
             CASE
               WHEN changes() = 1
                AND EXISTS (
                  SELECT 1
                  FROM media_asset_details AS detail
                  WHERE detail.asset_id = ?
                    AND detail.organization_id = ?
                    AND detail.upload_state = 'failed'
                    AND detail.failure_code = ?
                    AND detail.content_version = 1
                )
               THEN 'media.upload_failed'
               ELSE NULL
             END,
             'media_asset', ?, json_object('failure_code', ?), ?
           )`,
        )
        .bind(
          crypto.randomUUID(),
          actor.organizationId,
          actor.profileId,
          assetId,
          actor.organizationId,
          failureCode,
          assetId,
          failureCode,
          now,
        ),
    ]);
  } catch {
    // The asset is not public while pending. A later authorized cleanup can
    // deterministically remove the opaque keys; no values are logged here.
  }
}

async function readUploadState(
  database: D1DatabaseLike,
  assetId: string,
  organizationId: string,
): Promise<string | null> {
  const row = await database
    .prepare(
      `SELECT upload_state
       FROM media_asset_details
       WHERE asset_id = ?
         AND organization_id = ?
       LIMIT 1`,
    )
    .bind(assetId, organizationId)
    .first<Record<string, unknown>>();
  return typeof row?.upload_state === "string" ? row.upload_state : null;
}

async function bestEffortDelete(
  bucket: R2BucketLike,
  objectKeys: readonly string[],
): Promise<boolean> {
  try {
    await bucket.delete([...objectKeys]);
    return true;
  } catch {
    // Object keys remain private and unreferenced by a ready asset. Cleanup is
    // safe to retry through the authorized media maintenance path.
    return false;
  }
}

async function readActiveMediaUsageBlockers(
  database: D1DatabaseLike,
  organizationId: string,
  assetId: string,
  publicationScope?: "draft" | "published",
): Promise<readonly MediaUsageBlockerDto[]> {
  const rows = await database
    .prepare(
      `SELECT entity_type, entity_id, usage_kind, publication_scope
       FROM media_usage_references
       WHERE organization_id = ?
         AND asset_id = ?
         AND deleted_at IS NULL
         AND (? IS NULL OR publication_scope = ?)
       ORDER BY publication_scope DESC, entity_type ASC, entity_id ASC
       LIMIT 51`,
    )
    .bind(
      organizationId,
      assetId,
      publicationScope ?? null,
      publicationScope ?? null,
    )
    .all<Record<string, unknown>>();
  return Object.freeze((rows.results ?? []).map(readUsageBlocker));
}

function metadataIsPublicReady(metadata: ParsedMediaMetadata): boolean {
  return (
    metadata.rightsStatus === "approved" &&
    (metadata.consentStatus === "confirmed" ||
      metadata.consentStatus === "not_applicable") &&
    Boolean(metadata.credit?.trim()) &&
    (!metadata.informative || Boolean(metadata.altText?.trim()))
  );
}

async function finalizeAbandonedUploadCleanup(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  assetId: string,
  expectedVersion: number,
  now: number,
): Promise<void> {
  const results = await database.batch([
    database
      .prepare(
        `DELETE FROM media_asset_variants
         WHERE asset_id = ?
           AND organization_id = ?
           AND EXISTS (
             SELECT 1
             FROM media_assets AS asset
             JOIN media_asset_details AS detail
               ON detail.asset_id = asset.id
              AND detail.organization_id = asset.organization_id
             JOIN organization_memberships AS membership
               ON membership.id = ?
              AND membership.organization_id = asset.organization_id
              AND membership.profile_id = ?
              AND membership.role IN ('owner', 'administrator')
              AND membership.status = 'active'
              AND membership.deleted_at IS NULL
             JOIN profiles AS profile
               ON profile.id = membership.profile_id
              AND profile.status = 'active'
              AND profile.deleted_at IS NULL
             WHERE asset.id = media_asset_variants.asset_id
               AND asset.organization_id =
                   media_asset_variants.organization_id
               AND asset.deleted_at IS NULL
               AND detail.content_version = ?
               AND (
                 detail.upload_state = 'pending'
                 OR (
                   detail.upload_state = 'failed'
                   AND detail.failure_code = 'r2_cleanup_pending'
                 )
               )
           )`,
      )
      .bind(
        assetId,
        actor.organizationId,
        actor.membershipId,
        actor.profileId,
        expectedVersion,
      ),
    database
      .prepare(
        `UPDATE media_asset_details
         SET upload_state = 'failed',
             failure_code = 'cleanup_completed',
             original_sha256 = NULL,
             width = NULL,
             height = NULL,
             pixel_count = NULL,
             finalized_at = NULL,
             content_version = content_version + 1,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE asset_id = ?
           AND organization_id = ?
           AND content_version = ?
           AND (
             upload_state = 'pending'
             OR (
               upload_state = 'failed'
               AND failure_code = 'r2_cleanup_pending'
             )
           )
           AND changes() = 4`,
      )
      .bind(
        actor.profileId,
        now,
        assetId,
        actor.organizationId,
        expectedVersion,
      ),
    database
      .prepare(
        `UPDATE media_assets
         SET deleted_at = ?,
             is_public = 0,
             updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM media_asset_details AS detail
             WHERE detail.asset_id = media_assets.id
               AND detail.organization_id = media_assets.organization_id
               AND detail.upload_state = 'failed'
               AND detail.failure_code = 'cleanup_completed'
               AND detail.content_version = ?
           )
           AND changes() = 1`,
      )
      .bind(
        now,
        now,
        assetId,
        actor.organizationId,
        expectedVersion + 1,
      ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action, entity_type,
           entity_id, metadata_json, created_at
         )
         VALUES (
           ?, ?, ?,
           CASE
             WHEN changes() = 1
              AND EXISTS (
                SELECT 1
                FROM media_assets AS asset
                JOIN media_asset_details AS detail
                  ON detail.asset_id = asset.id
                 AND detail.organization_id = asset.organization_id
                WHERE asset.id = ?
                  AND asset.organization_id = ?
                  AND asset.deleted_at = ?
                  AND detail.upload_state = 'failed'
                  AND detail.failure_code = 'cleanup_completed'
                  AND detail.content_version = ?
                  AND NOT EXISTS (
                    SELECT 1
                    FROM media_asset_variants AS variant
                    WHERE variant.asset_id = asset.id
                      AND variant.organization_id = asset.organization_id
                  )
              )
             THEN 'media.cleanup_completed'
             ELSE NULL
           END,
           'media_asset', ?, '{}', ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        assetId,
        actor.organizationId,
        now,
        expectedVersion + 1,
        assetId,
        now,
      ),
  ]);
  if (
    changes(results[0] ?? {}) === 4 &&
    changes(results[1] ?? {}) === 1 &&
    changes(results[2] ?? {}) === 1 &&
    changes(results[3] ?? {}) === 1
  ) {
    return;
  }
  throw new SafeApplicationError(
    "service_unavailable",
    503,
    "The stored media cleanup could not be finalized.",
  );
}

async function finalizeDeletedMediaCleanup(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  assetId: string,
  expectedVersion: number,
  now: number,
): Promise<void> {
  const results = await database.batch([
    database
      .prepare(
        `DELETE FROM media_asset_variants
         WHERE asset_id = ?
           AND organization_id = ?
           AND EXISTS (
             SELECT 1
             FROM media_assets AS asset
             JOIN media_asset_details AS detail
               ON detail.asset_id = asset.id
              AND detail.organization_id = asset.organization_id
             JOIN organization_memberships AS membership
               ON membership.organization_id = asset.organization_id
              AND membership.id = ?
              AND membership.profile_id = ?
              AND membership.role IN ('owner', 'administrator')
              AND membership.status = 'active'
              AND membership.deleted_at IS NULL
             JOIN profiles AS profile
               ON profile.id = membership.profile_id
              AND profile.status = 'active'
              AND profile.deleted_at IS NULL
             WHERE asset.id = media_asset_variants.asset_id
               AND asset.organization_id =
                   media_asset_variants.organization_id
               AND asset.deleted_at IS NOT NULL
               AND detail.upload_state = 'deleting'
               AND detail.content_version = ?
           )`,
      )
      .bind(
        assetId,
        actor.organizationId,
        actor.membershipId,
        actor.profileId,
        expectedVersion,
      ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action, entity_type,
           entity_id, metadata_json, created_at
         )
         SELECT ?, asset.organization_id, ?, 'media.cleanup_completed',
                'media_asset', asset.id, '{}', ?
         FROM media_assets AS asset
         JOIN media_asset_details AS detail
           ON detail.asset_id = asset.id
          AND detail.organization_id = asset.organization_id
         WHERE asset.id = ?
           AND asset.organization_id = ?
           AND asset.deleted_at IS NOT NULL
           AND detail.upload_state = 'deleting'
           AND detail.content_version = ?
           AND changes() = 4
           AND NOT EXISTS (
             SELECT 1
             FROM media_asset_variants AS variant
             WHERE variant.organization_id = asset.organization_id
               AND variant.asset_id = asset.id
           )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.profileId,
        now,
        assetId,
        actor.organizationId,
        expectedVersion,
      ),
  ]);
  if (changes(results[0] ?? {}) === 4 && changes(results[1] ?? {}) === 1) {
    return;
  }
  const remaining = await database
    .prepare(
      `SELECT count(*) AS variant_count
       FROM media_assets AS asset
       JOIN media_asset_details AS detail
         ON detail.asset_id = asset.id
        AND detail.organization_id = asset.organization_id
       LEFT JOIN media_asset_variants AS variant
         ON variant.asset_id = asset.id
        AND variant.organization_id = asset.organization_id
       WHERE asset.id = ?
         AND asset.organization_id = ?
         AND asset.deleted_at IS NOT NULL
         AND detail.upload_state = 'deleting'
         AND detail.content_version = ?`,
    )
    .bind(assetId, actor.organizationId, expectedVersion)
    .first<Record<string, unknown>>();
  if (remaining && requiredNumber(remaining.variant_count) === 0) return;
  throw new SafeApplicationError(
    "service_unavailable",
    503,
    "The stored media cleanup could not be finalized.",
  );
}

const PRIVATE_MEDIA_ASSET_SELECT_SQL = `
  SELECT asset.id,
         asset.file_name,
         asset.mime_type,
         asset.byte_size,
         asset.alt_text,
         asset.credit,
         asset.rights_status,
         asset.participant_consent_status,
         asset.created_at,
         asset.updated_at,
         detail.upload_state,
         detail.caption,
         detail.private_rights_source_note,
         detail.private_participant_consent_note,
         detail.focal_point_x,
         detail.focal_point_y,
         detail.informative,
         detail.content_version,
         detail.original_sha256,
         detail.width,
         detail.height,
         detail.failure_code,
         detail.finalized_at,
         COALESCE((
           SELECT json_group_array(json_object(
             'kind', ordered_variant.variant_kind,
             'mimeType', ordered_variant.mime_type,
             'byteSize', ordered_variant.byte_size,
             'width', ordered_variant.width,
             'height', ordered_variant.height,
             'sha256', ordered_variant.sha256
           ))
           FROM (
             SELECT variant_kind, mime_type, byte_size, width, height, sha256
             FROM media_asset_variants AS variant
             WHERE variant.organization_id = asset.organization_id
               AND variant.asset_id = asset.id
               AND variant.state = 'ready'
             ORDER BY CASE variant_kind
               WHEN 'original' THEN 1
               WHEN 'webp_480' THEN 2
               WHEN 'webp_960' THEN 3
               WHEN 'webp_1600' THEN 4
               ELSE 5
             END
           ) AS ordered_variant
         ), '[]') AS variants_json
  FROM media_assets AS asset
  JOIN media_asset_details AS detail
    ON detail.asset_id = asset.id
   AND detail.organization_id = asset.organization_id`;

function privateMediaDto(
  row: Record<string, unknown>,
): MediaAssetDto {
  const assetId = requiredString(row.id);
  const variants = parseVariantJson(row.variants_json);
  return Object.freeze({
    altText: optionalString(row.alt_text),
    byteSize: requiredNumber(row.byte_size),
    caption: optionalString(row.caption),
    consentStatus: readConsentStatus(row.participant_consent_status),
    contentVersion: requiredNumber(row.content_version),
    createdAt: requiredNumber(row.created_at),
    credit: optionalString(row.credit),
    failureCode: optionalString(row.failure_code),
    fileName: requiredString(row.file_name),
    finalizedAt: optionalNumber(row.finalized_at),
    focalPoint: Object.freeze({
      x: requiredNumber(row.focal_point_x),
      y: requiredNumber(row.focal_point_y),
    }),
    height: optionalNumber(row.height),
    id: assetId,
    informative: requiredNumber(row.informative) === 1,
    mimeType: readMimeType(row.mime_type),
    participantConsentNote: optionalString(
      row.private_participant_consent_note,
    ),
    rightsSourceNote: optionalString(row.private_rights_source_note),
    rightsStatus: readRightsStatus(row.rights_status),
    sha256: optionalString(row.original_sha256),
    uploadState: readUploadStateValue(row.upload_state),
    updatedAt: requiredNumber(row.updated_at),
    variants: Object.freeze(
      variants.map((variant) =>
        Object.freeze({
          byteSize: requiredNumber(variant.byteSize),
          height: requiredNumber(variant.height),
          kind: readVariantKind(variant.kind),
          mimeType: readMimeType(variant.mimeType),
          sha256: requiredString(variant.sha256),
          width: requiredNumber(variant.width),
        }),
      ),
    ),
    width: optionalNumber(row.width),
  });
}

function readUsageBlocker(
  row: Record<string, unknown>,
): MediaUsageBlockerDto {
  const publicationScope = requiredString(row.publication_scope);
  if (publicationScope !== "draft" && publicationScope !== "published") {
    throw new SafeApplicationError(
      "internal_error",
      500,
      "The media usage could not be read.",
    );
  }
  return Object.freeze({
    entityId: requiredString(row.entity_id),
    entityType: requiredString(row.entity_type),
    publicationScope,
    usageKind: requiredString(row.usage_kind),
  });
}

function mediaUsageRequiresUsefulAlt(
  usage: MediaUsageBlockerDto,
): boolean {
  return (
    usage.usageKind === "event_artwork" ||
    usage.usageKind === "open_graph" ||
    usage.usageKind === "cover" ||
    usage.usageKind === "thumbnail"
  );
}

function parseVariantJson(value: unknown): readonly Record<string, unknown>[] {
  if (typeof value !== "string") {
    throw new SafeApplicationError(
      "internal_error",
      500,
      "The media record could not be read.",
    );
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length > 4 ||
      parsed.some(
        (item) =>
          typeof item !== "object" ||
          item === null ||
          Array.isArray(item),
      )
    ) {
      throw new TypeError("invalid_variant_json");
    }
    return parsed as Record<string, unknown>[];
  } catch {
    throw new SafeApplicationError(
      "internal_error",
      500,
      "The media record could not be read.",
    );
  }
}

function changes(result: Readonly<{ meta?: Readonly<{ changes?: number }> }>) {
  return result.meta?.changes ?? 0;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SafeApplicationError(
      "internal_error",
      500,
      "The media record could not be read.",
    );
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return value === null || value === undefined ? null : requiredString(value);
}

function requiredNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new SafeApplicationError(
      "internal_error",
      500,
      "The media record could not be read.",
    );
  }
  return value;
}

function optionalNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : requiredNumber(value);
}

function readMimeType(value: unknown): MediaImageMimeType {
  const mimeType = requiredString(value);
  if (
    mimeType !== "image/jpeg" &&
    mimeType !== "image/png" &&
    mimeType !== "image/webp"
  ) {
    throw new SafeApplicationError(
      "internal_error",
      500,
      "The media record could not be read.",
    );
  }
  return mimeType;
}

function readVariantKind(value: unknown): MediaVariantKind {
  const kind = requiredString(value);
  if (!MEDIA_VARIANT_KINDS.some((allowed) => allowed === kind)) {
    throw new SafeApplicationError(
      "internal_error",
      500,
      "The media record could not be read.",
    );
  }
  return kind as MediaVariantKind;
}

function readRightsStatus(value: unknown): MediaRightsStatus {
  const status = requiredString(value);
  if (!MEDIA_RIGHTS_STATUSES.some((allowed) => allowed === status)) {
    throw new SafeApplicationError(
      "internal_error",
      500,
      "The media record could not be read.",
    );
  }
  return status as MediaRightsStatus;
}

function readConsentStatus(value: unknown): MediaConsentStatus {
  const status = requiredString(value);
  if (!MEDIA_CONSENT_STATUSES.some((allowed) => allowed === status)) {
    throw new SafeApplicationError(
      "internal_error",
      500,
      "The media record could not be read.",
    );
  }
  return status as MediaConsentStatus;
}

function readUploadStateValue(
  value: unknown,
): MediaAssetDto["uploadState"] {
  const state = requiredString(value);
  if (
    state !== "pending" &&
    state !== "ready" &&
    state !== "failed" &&
    state !== "deleting"
  ) {
    throw new SafeApplicationError(
      "internal_error",
      500,
      "The media record could not be read.",
    );
  }
  return state;
}
