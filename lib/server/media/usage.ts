import type {
  AuthorizedMembership,
  D1DatabaseLike,
  D1PreparedStatementLike,
} from "../auth";
import {
  parseBoundedString,
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  validationIssue,
} from "../../validation";
import { protectedLegalClaimSql } from "../../validation/protected-legal-claims";
import { publicOrganizerEmailExposureSql } from "../../validation/public-organizer-email";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  MEDIA_VARIANT_KINDS,
  type MediaVariantKind,
} from "./storage";
import { currentPublishedMediaUsageTargetSql } from "./public-usage-contract";

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

export const MEDIA_USAGE_ENTITY_TYPES = [
  "page",
  "club_public_profile",
  "program_public_profile",
  "organizer_event",
  "organizer_profile",
  "site_logo",
  "site_og",
  "footer",
  "community_link",
] as const;
export type MediaUsageEntityType =
  (typeof MEDIA_USAGE_ENTITY_TYPES)[number];

export type MediaUsageReferenceInput = Readonly<{
  assetId: string;
  usageKind: string;
}>;

export type PublicReadyMediaAsset = Readonly<{
  altText: string | null;
  assetId: string;
  caption: string | null;
  credit: string;
  focalPoint: Readonly<{ x: number; y: number }>;
}>;

export type PublishedMediaAssetDto = PublicReadyMediaAsset &
  Readonly<{
    height: number;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    url: string;
    width: number;
  }>;

export type ResponsiveMediaAssetDto = PublicReadyMediaAsset &
  Readonly<{
    variants: Readonly<{
      webp1600: Readonly<{ height: number; url: string; width: number }>;
      webp480: Readonly<{ height: number; url: string; width: number }>;
      webp960: Readonly<{ height: number; url: string; width: number }>;
    }>;
  }>;

export const PUBLISHED_MEDIA_RENDER_ENTITY_TYPES = [
  "page",
  "club_public_profile",
  "program_public_profile",
  "organizer_event",
  "organizer_profile",
  "site_logo",
  "site_og",
] as const;
export type PublishedMediaRenderUsage = Readonly<{
  assetId: string;
  entityKey: string;
  entityType: (typeof PUBLISHED_MEDIA_RENDER_ENTITY_TYPES)[number];
  usageKind: string;
}>;

export async function resolveMediaAssetsForRendering(
  database: Pick<D1DatabaseLike, "prepare">,
  input: Readonly<{
    assetIds?: readonly unknown[];
    organizationId: unknown;
    publicationScope: "draft" | "published";
    usages?: readonly Readonly<{
      assetId: unknown;
      entityKey: unknown;
      entityType: unknown;
      usageKind: unknown;
    }>[];
  }>,
): Promise<readonly ResponsiveMediaAssetDto[]> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  const publicationScope = parseEnum(
    input.publicationScope,
    ["draft", "published"] as const,
    "publicationScope",
  );
  const publishedUsages =
    publicationScope === "published"
      ? parsePublishedMediaRenderUsages(input.usages)
      : Object.freeze([]);
  const rawAssetIds =
    publicationScope === "published"
      ? publishedUsages.map(({ assetId }) => assetId)
      : input.assetIds;
  if (!Array.isArray(rawAssetIds) || rawAssetIds.length > 25) {
    throw validationIssue(
      "assetIds",
      "too_many_items",
      "At most 25 media assets may be rendered together.",
    );
  }
  const seen = new Set<string>();
  const assetIds = rawAssetIds.flatMap((value, index) => {
    const assetId = parseIdentifier(value, `assetIds.${index}`);
    if (seen.has(assetId)) return [];
    seen.add(assetId);
    return [assetId];
  });
  if (assetIds.length === 0) return Object.freeze([]);
  const publishedUsageJson = JSON.stringify(publishedUsages);
  const publishedUsageJoin =
    publicationScope === "published"
      ? `JOIN json_each(?) AS requested_usage
           ON json_extract(requested_usage.value, '$.assetId') = asset.id`
      : "";
  const usageAuthorization =
    publicationScope === "published"
      ? `EXISTS (
           SELECT 1
           FROM media_usage_references AS usage
           WHERE usage.organization_id = asset.organization_id
             AND usage.asset_id = asset.id
             AND usage.publication_scope = 'published'
             AND usage.deleted_at IS NULL
             AND usage.entity_type =
                 json_extract(requested_usage.value, '$.entityType')
             AND usage.usage_kind =
                 json_extract(requested_usage.value, '$.usageKind')
             AND ${currentPublishedMediaUsageTargetSql("usage")}
             AND (
               (
                 usage.entity_type = 'page'
                 AND EXISTS (
                   SELECT 1
                   FROM pages AS requested_page
                   WHERE requested_page.id = usage.entity_id
                     AND requested_page.organization_id =
                         usage.organization_id
                     AND requested_page.slug =
                         json_extract(
                           requested_usage.value,
                           '$.entityKey'
                         )
                 )
               )
               OR (
                 usage.entity_type = 'club_public_profile'
                 AND EXISTS (
                   SELECT 1
                   FROM clubs AS requested_club
                   WHERE requested_club.id = usage.entity_id
                     AND requested_club.organization_id =
                         usage.organization_id
                     AND requested_club.slug =
                         json_extract(
                           requested_usage.value,
                           '$.entityKey'
                         )
                 )
               )
               OR (
                 usage.entity_type = 'program_public_profile'
                 AND EXISTS (
                   SELECT 1
                   FROM program_public_profile_details AS requested_program
                   WHERE requested_program.program_id = usage.entity_id
                     AND requested_program.organization_id =
                         usage.organization_id
                     AND requested_program.public_slug =
                         json_extract(
                           requested_usage.value,
                           '$.entityKey'
                         )
                 )
               )
               OR (
                 usage.entity_type = 'organizer_event'
                 AND EXISTS (
                   SELECT 1
                   FROM organizer_events AS requested_event
                   WHERE requested_event.id = usage.entity_id
                     AND requested_event.organization_id =
                         usage.organization_id
                     AND requested_event.slug =
                         json_extract(
                           requested_usage.value,
                           '$.entityKey'
                         )
                 )
               )
               OR (
                 usage.entity_type = 'organizer_profile'
                 AND usage.entity_id =
                     json_extract(
                       requested_usage.value,
                       '$.entityKey'
                     )
               )
               OR (
                 usage.entity_type IN ('site_logo', 'site_og')
                 AND usage.entity_id = usage.organization_id
                 AND usage.entity_id =
                     json_extract(
                       requested_usage.value,
                       '$.entityKey'
                     )
               )
             )
         )`
      : `EXISTS (
           SELECT 1
           FROM media_usage_references AS usage
           WHERE usage.organization_id = asset.organization_id
             AND usage.asset_id = asset.id
             AND usage.publication_scope = 'draft'
             AND usage.deleted_at IS NULL
         )`;
  const usageCompleteness =
    publicationScope === "published"
      ? `AND COUNT(DISTINCT requested_usage.key) = (
           SELECT count(*)
           FROM json_each(?) AS expected_usage
           WHERE json_extract(expected_usage.value, '$.assetId') =
                 asset.id
         )`
      : "";
  const rows = await database
    .prepare(
      `SELECT asset.id, asset.alt_text, asset.credit,
              detail.caption, detail.focal_point_x, detail.focal_point_y,
              MAX(CASE WHEN variant.variant_kind = 'webp_480'
                       THEN variant.width END) AS width_480,
              MAX(CASE WHEN variant.variant_kind = 'webp_480'
                       THEN variant.height END) AS height_480,
              MAX(CASE WHEN variant.variant_kind = 'webp_960'
                       THEN variant.width END) AS width_960,
              MAX(CASE WHEN variant.variant_kind = 'webp_960'
                       THEN variant.height END) AS height_960,
              MAX(CASE WHEN variant.variant_kind = 'webp_1600'
                       THEN variant.width END) AS width_1600,
              MAX(CASE WHEN variant.variant_kind = 'webp_1600'
                       THEN variant.height END) AS height_1600
       FROM media_assets AS asset
       JOIN media_asset_details AS detail
         ON detail.asset_id = asset.id
        AND detail.organization_id = asset.organization_id
        AND detail.upload_state = 'ready'
       JOIN media_asset_variants AS variant
         ON variant.asset_id = asset.id
        AND variant.organization_id = asset.organization_id
        AND variant.variant_kind IN ('webp_480', 'webp_960', 'webp_1600')
        AND variant.state = 'ready'
       ${publishedUsageJoin}
       WHERE asset.organization_id = ?
         AND asset.id IN (${assetIds.map(() => "?").join(", ")})
         AND asset.deleted_at IS NULL
         AND asset.rights_status = 'approved'
         AND asset.participant_consent_status IN (
           'not_applicable', 'confirmed'
         )
         AND length(trim(COALESCE(asset.credit, ''))) > 0
         AND (
           detail.informative = 0
           OR length(trim(COALESCE(asset.alt_text, ''))) > 0
         )
         AND ${MEDIA_PUBLIC_CONTENT_SAFE_SQL}
         AND ${usageAuthorization}
       GROUP BY asset.id, asset.alt_text, asset.credit, detail.caption,
                detail.focal_point_x, detail.focal_point_y
       HAVING COUNT(DISTINCT variant.variant_kind) = 3
          ${usageCompleteness}`,
    )
    .bind(
      ...(publicationScope === "published" ? [publishedUsageJson] : []),
      organizationId,
      ...assetIds,
      ...(publicationScope === "published" ? [publishedUsageJson] : []),
    )
    .all<Record<string, unknown>>();
  const privatePrefix =
    publicationScope === "draft" ? "/api/organizer" : "";
  const byId = new Map(
    (rows.results ?? []).map((row) => {
      const assetId = requiredString(row.id);
      const variantUrl = (kind: "webp_1600" | "webp_480" | "webp_960") =>
        `${privatePrefix}/media/${encodeURIComponent(assetId)}/${
          publicationScope === "draft" ? "variants/" : ""
        }${kind}`;
      return [
        assetId,
        Object.freeze({
          altText: optionalString(row.alt_text),
          assetId,
          caption: optionalString(row.caption),
          credit: requiredString(row.credit),
          focalPoint: Object.freeze({
            x: requiredNumber(row.focal_point_x),
            y: requiredNumber(row.focal_point_y),
          }),
          variants: Object.freeze({
            webp1600: Object.freeze({
              height: requiredNumber(row.height_1600),
              url: variantUrl("webp_1600"),
              width: requiredNumber(row.width_1600),
            }),
            webp480: Object.freeze({
              height: requiredNumber(row.height_480),
              url: variantUrl("webp_480"),
              width: requiredNumber(row.width_480),
            }),
            webp960: Object.freeze({
              height: requiredNumber(row.height_960),
              url: variantUrl("webp_960"),
              width: requiredNumber(row.width_960),
            }),
          }),
        }),
      ] as const;
    }),
  );
  return Object.freeze(
    assetIds.flatMap((assetId) => {
      const asset = byId.get(assetId);
      return asset ? [asset] : [];
    }),
  );
}

function parsePublishedMediaRenderUsages(
  value: unknown,
): readonly PublishedMediaRenderUsage[] {
  if (!Array.isArray(value) || value.length > 25) {
    throw validationIssue(
      "usages",
      "invalid_length",
      "Published media requires at most 25 exact usage proofs.",
    );
  }
  return Object.freeze(
    value.map((usage, index) => {
      if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
        throw validationIssue(
          `usages.${index}`,
          "invalid_type",
          "Published media usage proof must be an object.",
        );
      }
      const record = usage as Record<string, unknown>;
      return Object.freeze({
        assetId: parseIdentifier(
          record.assetId,
          `usages.${index}.assetId`,
        ),
        entityKey: parseIdentifier(
          record.entityKey,
          `usages.${index}.entityKey`,
        ),
        entityType: parseEnum(
          record.entityType,
          PUBLISHED_MEDIA_RENDER_ENTITY_TYPES,
          `usages.${index}.entityType`,
        ),
        usageKind: parseBoundedString(record.usageKind, {
          path: `usages.${index}.usageKind`,
          minLength: 1,
          maxLength: 64,
        }),
      });
    }),
  );
}

/**
 * Resolves media for one authenticated historical CMS page revision. Retired
 * usage rows are accepted only when they prove that the exact immutable
 * revision referenced the asset. The live Owner/Administrator membership and
 * every mutable public-readiness fact are revalidated in the same bounded
 * query, so deleted or revoked media disappears from a no-store preview.
 */
export async function resolveCmsRevisionMediaAssets(
  database: Pick<D1DatabaseLike, "prepare">,
  actor: AuthorizedMembership,
  input: Readonly<{
    assetIds: readonly unknown[];
    revisionId: unknown;
  }>,
): Promise<readonly ResponsiveMediaAssetDto[]> {
  if (!Array.isArray(input.assetIds) || input.assetIds.length > 25) {
    throw validationIssue(
      "assetIds",
      "too_many_items",
      "At most 25 media assets may be rendered together.",
    );
  }
  const revisionId = parseIdentifier(input.revisionId, "revisionId");
  const seen = new Set<string>();
  const assetIds = input.assetIds.flatMap((value, index) => {
    const assetId = parseIdentifier(value, `assetIds.${index}`);
    if (seen.has(assetId)) return [];
    seen.add(assetId);
    return [assetId];
  });
  if (assetIds.length === 0) return Object.freeze([]);
  const rows = await database
    .prepare(
      `SELECT asset.id, asset.alt_text, asset.credit,
              detail.caption, detail.focal_point_x, detail.focal_point_y,
              MAX(CASE WHEN variant.variant_kind = 'webp_480'
                       THEN variant.width END) AS width_480,
              MAX(CASE WHEN variant.variant_kind = 'webp_480'
                       THEN variant.height END) AS height_480,
              MAX(CASE WHEN variant.variant_kind = 'webp_960'
                       THEN variant.width END) AS width_960,
              MAX(CASE WHEN variant.variant_kind = 'webp_960'
                       THEN variant.height END) AS height_960,
              MAX(CASE WHEN variant.variant_kind = 'webp_1600'
                       THEN variant.width END) AS width_1600,
              MAX(CASE WHEN variant.variant_kind = 'webp_1600'
                       THEN variant.height END) AS height_1600
       FROM cms_entity_revisions AS revision
       JOIN organization_memberships AS current_membership
         ON current_membership.id = ?
        AND current_membership.organization_id = revision.organization_id
        AND current_membership.profile_id = ?
        AND current_membership.role IN ('owner', 'administrator')
        AND current_membership.status = 'active'
        AND current_membership.deleted_at IS NULL
       JOIN profiles AS current_profile
         ON current_profile.id = current_membership.profile_id
        AND current_profile.status = 'active'
        AND current_profile.deleted_at IS NULL
       JOIN media_usage_references AS usage
         ON usage.organization_id = revision.organization_id
        AND usage.revision_id = revision.id
        AND (
          (
            revision.entity_type IN (
              'page', 'club_public_profile', 'community_link'
            )
            AND usage.entity_type = revision.entity_type
            AND usage.entity_id = revision.entity_key
          )
          OR (
            revision.entity_type = 'site_identity'
            AND usage.entity_type IN ('site_logo', 'site_og', 'footer')
            AND usage.entity_id = revision.organization_id
          )
        )
       JOIN media_assets AS asset
         ON asset.id = usage.asset_id
        AND asset.organization_id = usage.organization_id
       JOIN media_asset_details AS detail
         ON detail.asset_id = asset.id
        AND detail.organization_id = asset.organization_id
        AND detail.upload_state = 'ready'
       JOIN media_asset_variants AS variant
         ON variant.asset_id = asset.id
        AND variant.organization_id = asset.organization_id
        AND variant.variant_kind IN ('webp_480', 'webp_960', 'webp_1600')
        AND variant.state = 'ready'
       WHERE revision.id = ?
         AND revision.organization_id = ?
         AND revision.entity_type IN (
           'page', 'club_public_profile', 'community_link', 'site_identity'
         )
         AND asset.id IN (${assetIds.map(() => "?").join(", ")})
         AND asset.deleted_at IS NULL
         AND asset.rights_status = 'approved'
         AND asset.participant_consent_status IN (
           'not_applicable', 'confirmed'
         )
         AND length(trim(COALESCE(asset.credit, ''))) > 0
         AND (
           detail.informative = 0
           OR length(trim(COALESCE(asset.alt_text, ''))) > 0
         )
         AND ${MEDIA_PUBLIC_CONTENT_SAFE_SQL}
       GROUP BY asset.id, asset.alt_text, asset.credit, detail.caption,
                detail.focal_point_x, detail.focal_point_y
       HAVING COUNT(DISTINCT variant.variant_kind) = 3`,
    )
    .bind(
      actor.membershipId,
      actor.profileId,
      revisionId,
      actor.organizationId,
      ...assetIds,
    )
    .all<Record<string, unknown>>();
  const byId = new Map(
    (rows.results ?? []).map((row) => {
      const assetId = requiredString(row.id);
      const variantUrl = (
        kind: "webp_1600" | "webp_480" | "webp_960",
      ) =>
        `/api/organizer/media/${encodeURIComponent(
          assetId,
        )}/variants/${kind}`;
      return [
        assetId,
        Object.freeze({
          altText: optionalString(row.alt_text),
          assetId,
          caption: optionalString(row.caption),
          credit: requiredString(row.credit),
          focalPoint: Object.freeze({
            x: requiredNumber(row.focal_point_x),
            y: requiredNumber(row.focal_point_y),
          }),
          variants: Object.freeze({
            webp1600: Object.freeze({
              height: requiredNumber(row.height_1600),
              url: variantUrl("webp_1600"),
              width: requiredNumber(row.width_1600),
            }),
            webp480: Object.freeze({
              height: requiredNumber(row.height_480),
              url: variantUrl("webp_480"),
              width: requiredNumber(row.width_480),
            }),
            webp960: Object.freeze({
              height: requiredNumber(row.height_960),
              url: variantUrl("webp_960"),
              width: requiredNumber(row.width_960),
            }),
          }),
        }),
      ] as const;
    }),
  );
  return Object.freeze(
    assetIds.flatMap((assetId) => {
      const asset = byId.get(assetId);
      return asset ? [asset] : [];
    }),
  );
}

export async function validateMediaAssetsForUsage(
  database: D1DatabaseLike,
  input: Readonly<{
    assetIds: readonly unknown[];
    maximumAssetCount?: 24 | 25;
    organizationId: unknown;
    publicationScope: "draft" | "published";
    requireUsefulAltAssetIds?: readonly unknown[];
  }>,
): Promise<readonly PublicReadyMediaAsset[]> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  const publicationScope = parseEnum(
    input.publicationScope,
    ["draft", "published"] as const,
    "publicationScope",
  );
  const maximumAssetCount = input.maximumAssetCount ?? 24;
  if (input.assetIds.length > maximumAssetCount) {
    throw validationIssue(
      "assetIds",
      "too_many_items",
      "Too many media assets were selected.",
    );
  }
  const assetIds = [
    ...new Set(
      input.assetIds.map((assetId, index) =>
        parseIdentifier(assetId, `assetIds.${index}`),
      ),
    ),
  ].sort();
  if (assetIds.length === 0) return Object.freeze([]);
  const requiredAltAssetIds = new Set(
    (input.requireUsefulAltAssetIds ?? []).map((assetId, index) =>
      parseIdentifier(assetId, `requireUsefulAltAssetIds.${index}`),
    ),
  );
  if (
    [...requiredAltAssetIds].some(
      (assetId) => !assetIds.includes(assetId),
    )
  ) {
    throw validationIssue(
      "requireUsefulAltAssetIds",
      "unknown_media_asset",
      "Alt-text requirements must refer to selected media assets.",
    );
  }

  const placeholders = assetIds.map(() => "?").join(", ");
  const requiredAltJson = JSON.stringify([...requiredAltAssetIds].sort());
  const rows = await database
    .prepare(
      `SELECT asset.id,
              asset.alt_text,
              asset.credit,
              detail.caption,
              detail.focal_point_x,
              detail.focal_point_y
       FROM media_assets AS asset
       JOIN media_asset_details AS detail
         ON detail.asset_id = asset.id
        AND detail.organization_id = asset.organization_id
       WHERE asset.organization_id = ?
         AND asset.id IN (${placeholders})
         AND asset.deleted_at IS NULL
         AND detail.upload_state = 'ready'
         AND ${MEDIA_PUBLIC_CONTENT_SAFE_SQL}
         AND (
           asset.id NOT IN (
             SELECT CAST(value AS TEXT) FROM json_each(?)
           )
           OR length(trim(COALESCE(asset.alt_text, ''))) BETWEEN 1 AND 300
         )
         AND (
           ? = 'draft'
           OR (
             asset.rights_status = 'approved'
             AND asset.participant_consent_status
                 IN ('not_applicable', 'confirmed')
             AND length(trim(COALESCE(asset.credit, ''))) > 0
             AND (
               detail.informative = 0
               OR length(trim(COALESCE(asset.alt_text, ''))) > 0
             )
           )
         )
       ORDER BY asset.id ASC`,
    )
    .bind(
      organizationId,
      ...assetIds,
      requiredAltJson,
      publicationScope,
    )
    .all<Record<string, unknown>>();
  if ((rows.results ?? []).length !== assetIds.length) {
    throw validationIssue(
      "assetIds",
      "media_not_eligible",
      "One or more selected media assets are not eligible.",
    );
  }
  return Object.freeze(
    (rows.results ?? []).map((row) =>
      Object.freeze({
        altText: optionalString(row.alt_text),
        assetId: requiredString(row.id),
        caption: optionalString(row.caption),
        credit: optionalString(row.credit) ?? "",
        focalPoint: Object.freeze({
          x: requiredNumber(row.focal_point_x),
          y: requiredNumber(row.focal_point_y),
        }),
      }),
    ),
  );
}

export function prepareMediaUsageReconciliation(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  input: Readonly<{
    entityId: unknown;
    entityType: MediaUsageEntityType;
    nowUtcMs: unknown;
    maximumUsageCount?: 24 | 25;
    publicationScope: "draft" | "published";
    revisionId: unknown;
    usages: readonly MediaUsageReferenceInput[];
  }>,
): Readonly<{
  insertStatementCount: number;
  insertStatementIndex: number;
  statements: readonly D1PreparedStatementLike[];
}> {
  const entityType = parseEnum(
    input.entityType,
    MEDIA_USAGE_ENTITY_TYPES,
    "entityType",
  );
  const entityId = parseBoundedString(input.entityId, {
    path: "entityId",
    maxLength: 160,
  });
  const revisionId =
    typeof input.revisionId === "string" && input.revisionId.length === 0
      ? ""
      : parseBoundedString(input.revisionId, {
          path: "revisionId",
          maxLength: 160,
        });
  const publicationScope = parseEnum(
    input.publicationScope,
    ["draft", "published"] as const,
    "publicationScope",
  );
  const now = parseFiniteInteger(input.nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const maximumUsageCount = input.maximumUsageCount ?? 24;
  if (input.usages.length > maximumUsageCount) {
    throw validationIssue(
      "usages",
      "too_many_items",
      "Too many media usages were supplied.",
    );
  }
  const seenKinds = new Set<string>();
  const usages = input.usages.map((usage, index) => {
    const usageKind = parseBoundedString(usage.usageKind, {
      path: `usages.${index}.usageKind`,
      maxLength: 64,
    });
    if (seenKinds.has(usageKind)) {
      throw validationIssue(
        `usages.${index}.usageKind`,
        "duplicate_usage",
        "Each media usage must be unique.",
      );
    }
    seenKinds.add(usageKind);
    return Object.freeze({
      assetId: parseIdentifier(usage.assetId, `usages.${index}.assetId`),
      id: crypto.randomUUID(),
      usageKind,
    });
  });
  const usagePayload = JSON.stringify(usages);
  const statements: D1PreparedStatementLike[] = [
    database
      .prepare(
        `UPDATE media_usage_references
         SET deleted_at = ?
         WHERE organization_id = ?
           AND entity_type = ?
           AND entity_id = ?
           AND publication_scope = ?
           AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM organization_memberships AS membership
             JOIN profiles AS profile
               ON profile.id = membership.profile_id
             WHERE membership.id = ?
               AND membership.organization_id =
                   media_usage_references.organization_id
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
        actor.organizationId,
        entityType,
        entityId,
        publicationScope,
        actor.membershipId,
        actor.profileId,
      ),
    database
      .prepare(
        `WITH requested AS (
           SELECT json_extract(entry.value, '$.id') AS id,
                  json_extract(entry.value, '$.assetId') AS asset_id,
                  json_extract(entry.value, '$.usageKind') AS usage_kind
           FROM json_each(?) AS entry
         )
         INSERT INTO media_usage_references (
           id, organization_id, asset_id, entity_type, entity_id,
           revision_id, usage_kind, publication_scope,
           created_by_profile_id, created_at, deleted_at
         )
         SELECT requested.id, asset.organization_id, asset.id, ?, ?, ?,
                requested.usage_kind, ?, ?, ?, NULL
         FROM requested
         JOIN media_assets AS asset
           ON asset.id = requested.asset_id
          AND asset.organization_id = ?
          AND asset.deleted_at IS NULL
         JOIN media_asset_details AS detail
           ON detail.asset_id = asset.id
          AND detail.organization_id = asset.organization_id
          AND detail.upload_state = 'ready'
         WHERE (
           ? = 'draft'
           OR (
             asset.rights_status = 'approved'
             AND asset.participant_consent_status
                 IN ('not_applicable', 'confirmed')
             AND length(trim(COALESCE(asset.credit, ''))) > 0
             AND (
               detail.informative = 0
               OR length(trim(COALESCE(asset.alt_text, ''))) > 0
             )
           )
         )
         AND ${MEDIA_PUBLIC_CONTENT_SAFE_SQL}
         AND EXISTS (
           SELECT 1
           FROM organization_memberships AS membership
           JOIN profiles AS profile
             ON profile.id = membership.profile_id
           WHERE membership.id = ?
             AND membership.organization_id = asset.organization_id
             AND membership.profile_id = ?
             AND membership.role IN ('owner', 'administrator')
             AND membership.status = 'active'
             AND membership.deleted_at IS NULL
             AND profile.status = 'active'
             AND profile.deleted_at IS NULL
         )
         ORDER BY requested.usage_kind ASC`,
      )
      .bind(
        usagePayload,
        entityType,
        entityId,
        revisionId,
        publicationScope,
        actor.profileId,
        now,
        actor.organizationId,
        publicationScope,
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
           (
             SELECT CASE
               WHEN EXISTS (
                 SELECT 1
                 FROM organization_memberships AS membership
                 JOIN profiles AS profile
                   ON profile.id = membership.profile_id
                 WHERE membership.id = ?
                   AND membership.organization_id = ?
                   AND membership.profile_id = ?
                   AND membership.role IN ('owner', 'administrator')
                   AND membership.status = 'active'
                   AND membership.deleted_at IS NULL
                   AND profile.status = 'active'
                   AND profile.deleted_at IS NULL
               )
               AND (
                 SELECT COUNT(*)
                 FROM media_usage_references AS usage
                 WHERE usage.organization_id = ?
                   AND usage.entity_type = ?
                   AND usage.entity_id = ?
                   AND usage.revision_id = ?
                   AND usage.publication_scope = ?
                   AND usage.deleted_at IS NULL
               ) = ?
               THEN 'media.usage_reconciled'
               ELSE NULL
             END
           ),
           'media_usage_set', ?, '{}', ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        actor.membershipId,
        actor.organizationId,
        actor.profileId,
        actor.organizationId,
        entityType,
        entityId,
        revisionId,
        publicationScope,
        usages.length,
        `${entityType}:${entityId}:${publicationScope}`,
        now,
      ),
  ];
  return Object.freeze({
    insertStatementCount: usages.length,
    insertStatementIndex: 1,
    statements: Object.freeze(statements),
  });
}

export async function resolvePublishedMediaAsset(
  database: D1DatabaseLike,
  input: Readonly<{
    assetId: unknown;
    entityId?: unknown;
    entityType?: unknown;
    organizationId: unknown;
    usageKind?: unknown;
    variant?: MediaVariantKind;
  }>,
): Promise<PublishedMediaAssetDto | null> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  const assetId = parseIdentifier(input.assetId, "assetId");
  const variant = parseEnum(
    input.variant ?? "webp_1600",
    MEDIA_VARIANT_KINDS,
    "variant",
  );
  const usageKind =
    input.usageKind === undefined
      ? null
      : parseBoundedString(input.usageKind, {
          path: "usageKind",
          maxLength: 64,
        });
  if (
    (input.entityId === undefined) !==
    (input.entityType === undefined)
  ) {
    throw validationIssue(
      "entityType",
      "invalid_usage_scope",
      "A published media usage scope requires both entity type and entity ID.",
    );
  }
  const entityType =
    input.entityType === undefined
      ? null
      : parseEnum(
          input.entityType,
          MEDIA_USAGE_ENTITY_TYPES,
          "entityType",
        );
  const entityId =
    input.entityId === undefined
      ? null
      : parseIdentifier(input.entityId, "entityId");
  const row = await database
    .prepare(
      `SELECT asset.id,
              asset.alt_text,
              asset.credit,
              detail.caption,
              detail.focal_point_x,
              detail.focal_point_y,
              variant.mime_type,
              variant.width,
              variant.height
       FROM media_assets AS asset
       JOIN media_asset_details AS detail
         ON detail.asset_id = asset.id
        AND detail.organization_id = asset.organization_id
       JOIN media_asset_variants AS variant
         ON variant.asset_id = asset.id
        AND variant.organization_id = asset.organization_id
        AND variant.variant_kind = ?
        AND variant.state = 'ready'
       WHERE asset.id = ?
         AND asset.organization_id = ?
         AND asset.deleted_at IS NULL
         AND detail.upload_state = 'ready'
         AND asset.rights_status = 'approved'
         AND asset.participant_consent_status IN ('not_applicable', 'confirmed')
         AND length(trim(COALESCE(asset.credit, ''))) > 0
         AND (
           detail.informative = 0
           OR length(trim(COALESCE(asset.alt_text, ''))) > 0
         )
         AND ${MEDIA_PUBLIC_CONTENT_SAFE_SQL}
         AND EXISTS (
           SELECT 1
           FROM media_usage_references AS usage
           WHERE usage.organization_id = asset.organization_id
             AND usage.asset_id = asset.id
             AND usage.publication_scope = 'published'
             AND usage.deleted_at IS NULL
             AND (? IS NULL OR usage.usage_kind = ?)
             AND (? IS NULL OR usage.entity_type = ?)
             AND (? IS NULL OR usage.entity_id = ?)
         )
       LIMIT 1`,
    )
    .bind(
      variant,
      assetId,
      organizationId,
      usageKind,
      usageKind,
      entityType,
      entityType,
      entityId,
      entityId,
    )
    .first<Record<string, unknown>>();
  if (!row) return null;
  const mimeType = requiredString(row.mime_type);
  if (
    mimeType !== "image/jpeg" &&
    mimeType !== "image/png" &&
    mimeType !== "image/webp"
  ) {
    throw internalReadError();
  }
  return Object.freeze({
    altText: optionalString(row.alt_text),
    assetId: requiredString(row.id),
    caption: optionalString(row.caption),
    credit: requiredString(row.credit),
    focalPoint: Object.freeze({
      x: requiredNumber(row.focal_point_x),
      y: requiredNumber(row.focal_point_y),
    }),
    height: requiredNumber(row.height),
    mimeType,
    url: `/media/${encodeURIComponent(assetId)}/${variant}`,
    width: requiredNumber(row.width),
  });
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw internalReadError();
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return value === null || value === undefined ? null : requiredString(value);
}

function requiredNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw internalReadError();
  }
  return value;
}

function internalReadError(): SafeApplicationError {
  return new SafeApplicationError(
    "internal_error",
    500,
    "The media record could not be read.",
  );
}
