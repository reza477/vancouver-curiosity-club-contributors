import type {
  AuthorizedMembership,
  D1DatabaseLike,
} from "../auth";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  PUBLIC_CATALOG_CLUBS,
  PUBLIC_COMMUNITY_LINKS,
  PUBLIC_ORGANIZATION_SLUG,
} from "../public/catalog-definitions";
import {
  canonicalJson,
  contentHash,
  parseClubProfileSnapshot,
  parseCommunityLinkSnapshot,
  parseLegalStatusSnapshot,
  parseNavigationSnapshot,
  parsePageSnapshot,
  parseProgramProfileSnapshot,
  parseSiteIdentitySnapshot,
  type CmsEntityType,
} from "./cms-validation";

export const CMS_ADOPTION_VERSION = 1;
const MAX_ADOPTED_ENTITIES = 200;
const MAX_ADOPTION_PAYLOAD_BYTES = 1024 * 1024;
const MAX_ADOPTED_PAGE_SECTIONS = MAX_ADOPTED_ENTITIES * 24;
const VERIFIED_LEGACY_COMMUNITY_URLS = new Set(
  PUBLIC_COMMUNITY_LINKS.map(({ url }) => url),
);
const STARTER_PROGRAM_CLUB_SLUGS = Object.freeze(
  PUBLIC_CATALOG_CLUBS.map(({ slug }) => slug),
);
const STARTER_PROGRAMS_BY_SLUG = new Map(
  PUBLIC_CATALOG_CLUBS.map((club) => [club.slug, club] as const),
);

type AdoptionWorkflowStatus =
  | "archived"
  | "draft"
  | "published"
  | "unpublished";

type AdoptionCandidate = Readonly<{
  actorProfileId: string;
  adoptedAt: number;
  contentHash: string;
  contentVersion: number;
  currentDraftRevisionId: string;
  entityKey: string;
  entityType: CmsEntityType;
  legacyPageRevisionId: string | null;
  organizationId: string;
  publishedAt: number | null;
  publishedRevisionId: string | null;
  projectionJson: string;
  revisionId: string;
  revisionNumber: number;
  snapshotJson: string;
  sourceCount: number;
  sourceMaxUpdatedAt: number;
  sourceUpdatedAt: number;
  stateId: string;
  unpublishedAt: number | null;
  workflowStatus: AdoptionWorkflowStatus;
}>;

export class CmsAdoptionError extends SafeApplicationError {
  constructor() {
    super(
      "service_unavailable",
      503,
      "The private content workspace is not ready yet.",
    );
    this.name = "CmsAdoptionError";
  }
}

/**
 * Atomically adopts the current materialized public projection into immutable
 * private revision 1 records. The existing public rows are read and guarded,
 * never rewritten. A durable marker is written only when every expected state
 * and revision exists with the exact source fingerprint.
 */
export async function ensureCmsAdoption(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  nowUtcMs = Date.now(),
): Promise<"adopted" | "ready"> {
  if (actor.role !== "owner" && actor.role !== "administrator") {
    throw new CmsAdoptionError();
  }
  const ready = await readAdoptionMarker(database, actor.organizationId);
  if (ready?.adoptionVersion === CMS_ADOPTION_VERSION) return "ready";

  const now = safeTimestamp(nowUtcMs);
  let candidates: readonly AdoptionCandidate[];
  try {
    candidates = await buildAdoptionCandidates(database, actor, now);
  } catch (error) {
    throw error instanceof CmsAdoptionError
      ? error
      : new CmsAdoptionError();
  }
  if (
    candidates.length === 0 ||
    candidates.length > MAX_ADOPTED_ENTITIES
  ) {
    throw new CmsAdoptionError();
  }
  const payload = canonicalJson(candidates);
  if (new TextEncoder().encode(payload).byteLength > MAX_ADOPTION_PAYLOAD_BYTES) {
    throw new CmsAdoptionError();
  }
  const sourceFingerprint = await contentHash(
    candidates.map((candidate) => ({
      contentHash: candidate.contentHash,
      contentVersion: candidate.contentVersion,
      entityKey: candidate.entityKey,
      entityType: candidate.entityType,
      projectionJson: candidate.projectionJson,
      publishedAt: candidate.publishedAt,
      sourceCount: candidate.sourceCount,
      sourceMaxUpdatedAt: candidate.sourceMaxUpdatedAt,
      sourceUpdatedAt: candidate.sourceUpdatedAt,
      workflowStatus: candidate.workflowStatus,
    })),
  );

  const expectedCommunityDetailCount = candidates.filter(
    (candidate) =>
      candidate.entityType === "community_link" &&
      candidate.workflowStatus === "published",
  ).length;
  const expectedProgramInsertCount = candidates.filter(
    (candidate) =>
      candidate.entityType === "program_public_profile" &&
      candidate.sourceCount === 0,
  ).length;
  const expectedProgramDetailCount = candidates.filter(
    (candidate) =>
      candidate.entityType === "program_public_profile",
  ).length;
  const expectedPageMetadataCount = candidates.filter(
    (candidate) =>
      candidate.entityType === "page" &&
      candidate.workflowStatus === "published",
  ).length;
  const expectedSiteIdentityCount = candidates.filter(
    (candidate) =>
      candidate.entityType === "site_identity" &&
      candidate.workflowStatus === "published",
  ).length;
  const expectedReceiptCount = candidates.filter(
    (candidate) => candidate.publishedRevisionId !== null,
  ).length;
  let results: Awaited<ReturnType<D1DatabaseLike["batch"]>>;
  try {
    results = await database.batch([
      database
        .prepare(CMS_ADOPTION_PROGRAM_INSERT_SQL)
        .bind(payload, actor.organizationId, actor.profileId),
      database
        .prepare(CMS_ADOPTION_STATE_INSERT_SQL)
        .bind(payload, actor.organizationId, actor.profileId),
      database
        .prepare(CMS_ADOPTION_REVISION_INSERT_SQL)
        .bind(payload, actor.organizationId, actor.profileId),
      database
        .prepare(CMS_ADOPTION_STATE_FINALIZE_SQL)
        .bind(payload, actor.organizationId, actor.profileId),
      database
        .prepare(CMS_ADOPTION_MATERIALIZATION_RECEIPT_INSERT_SQL)
        .bind(payload, actor.organizationId, actor.profileId),
      database
        .prepare(CMS_ADOPTION_SITE_IDENTITY_UPDATE_SQL)
        .bind(
          payload,
          actor.profileId,
          actor.organizationId,
          actor.profileId,
        ),
      database
        .prepare(CMS_ADOPTION_PAGE_METADATA_INSERT_SQL)
        .bind(payload, actor.organizationId, actor.profileId),
      database
        .prepare(CMS_ADOPTION_PROGRAM_DETAILS_INSERT_SQL)
        .bind(payload, actor.organizationId, actor.profileId),
      database
        .prepare(CMS_ADOPTION_COMMUNITY_DETAILS_INSERT_SQL)
        .bind(payload, actor.organizationId, actor.profileId),
      database
        .prepare(CMS_ADOPTION_MARKER_INSERT_SQL)
        .bind(
          payload,
          actor.organizationId,
          CMS_ADOPTION_VERSION,
          sourceFingerprint,
          now,
          now,
          candidates.length,
          candidates.length,
          actor.organizationId,
        ),
      database
        .prepare(CMS_ADOPTION_COMPLETION_SENTINEL_SQL)
        .bind(
          actor.organizationId,
          actor.organizationId,
          CMS_ADOPTION_VERSION,
          sourceFingerprint,
        ),
    ]);
  } catch {
    const concurrent = await readAdoptionMarker(
      database,
      actor.organizationId,
    );
    if (
      concurrent?.adoptionVersion === CMS_ADOPTION_VERSION &&
      concurrent.sourceFingerprint === sourceFingerprint
    ) {
      return "ready";
    }
    throw new CmsAdoptionError();
  }
  if (
    results.length !== 11 ||
    results.some((result) => result.success === false)
  ) {
    throw new CmsAdoptionError();
  }
  const changes = results.map((result) => result.meta?.changes ?? 0);
  if (
    changes[0] === expectedProgramInsertCount &&
    changes[1] === candidates.length &&
    changes[2] === candidates.length &&
    changes[3] === candidates.length &&
    changes[4] === expectedReceiptCount &&
    changes[5] === expectedSiteIdentityCount &&
    changes[6] === expectedPageMetadataCount &&
    changes[7] === expectedProgramDetailCount &&
    changes[8] === expectedCommunityDetailCount &&
    changes[9] === 1 &&
    changes[10] === 0
  ) {
    return "adopted";
  }

  // A concurrent identical adoption may have committed first. Only its exact
  // marker is accepted; divergent or partial state remains fail closed.
  const concurrent = await readAdoptionMarker(database, actor.organizationId);
  if (
    concurrent?.adoptionVersion === CMS_ADOPTION_VERSION &&
    concurrent.sourceFingerprint === sourceFingerprint
  ) {
    return "ready";
  }
  throw new CmsAdoptionError();
}

const CMS_ADOPTION_SOURCE_GUARD_SQL = String.raw`
(
  (
    candidate.entity_type = 'page'
    AND EXISTS (
      SELECT 1
      FROM pages AS page
      WHERE page.id = candidate.entity_key
        AND page.organization_id = candidate.organization_id
        AND max(
          page.updated_at,
          COALESCE((
            SELECT metadata.updated_at
            FROM page_public_metadata AS metadata
            WHERE metadata.page_id = page.id
              AND metadata.organization_id = page.organization_id
            LIMIT 1
          ), -1)
        ) = candidate.source_updated_at
        AND (
          SELECT count(*)
          FROM page_sections AS section
          WHERE section.organization_id = page.organization_id
            AND section.page_id = page.id
            AND section.deleted_at IS NULL
        ) = candidate.source_count
        AND COALESCE((
          SELECT max(section.updated_at)
          FROM page_sections AS section
          WHERE section.organization_id = page.organization_id
            AND section.page_id = page.id
            AND section.deleted_at IS NULL
        ), -1) = candidate.source_max_updated_at
    )
  )
  OR (
    candidate.entity_type = 'club_public_profile'
    AND EXISTS (
      SELECT 1
      FROM club_public_profiles AS public_profile
      JOIN clubs AS club
        ON club.id = public_profile.club_id
       AND club.organization_id = public_profile.organization_id
      JOIN event_lanes AS lane
        ON lane.id = public_profile.primary_event_lane_id
       AND lane.organization_id = public_profile.organization_id
      WHERE public_profile.club_id = candidate.entity_key
        AND public_profile.organization_id = candidate.organization_id
        AND max(public_profile.updated_at, club.updated_at, lane.updated_at) =
            candidate.source_updated_at
    )
  )
  OR (
    candidate.entity_type = 'program_public_profile'
    AND EXISTS (
      SELECT 1
      FROM programs AS program
      JOIN clubs AS club
        ON club.id = program.club_id
       AND club.organization_id = program.organization_id
       AND club.deleted_at IS NULL
      JOIN organizations AS organization
        ON organization.id = program.organization_id
       AND organization.deleted_at IS NULL
      JOIN club_public_profiles AS profile
        ON profile.club_id = club.id
       AND profile.organization_id = club.organization_id
       AND profile.deleted_at IS NULL
      WHERE program.id = candidate.entity_key
        AND program.organization_id = candidate.organization_id
        AND program.deleted_at IS NULL
        AND program.club_id =
            json_extract(candidate.snapshot_json, '$.clubId')
        AND program.name =
            json_extract(candidate.snapshot_json, '$.name')
        AND program.slug =
            json_extract(candidate.snapshot_json, '$.slug')
        AND profile.primary_event_lane_id =
            json_extract(candidate.snapshot_json, '$.laneId')
        AND max(
              program.updated_at,
              club.updated_at,
              profile.updated_at,
              organization.updated_at
            ) = candidate.source_updated_at
    )
  )
  OR (
    candidate.entity_type = 'community_link'
    AND EXISTS (
      SELECT 1
      FROM community_links AS link
      WHERE link.id = candidate.entity_key
        AND link.organization_id = candidate.organization_id
        AND link.updated_at = candidate.source_updated_at
    )
  )
  OR (
    candidate.entity_type = 'navigation'
    AND candidate.entity_key = 'navigation'
    AND (
      SELECT count(*)
      FROM navigation_items AS item
      WHERE item.organization_id = candidate.organization_id
        AND item.is_published = 1
        AND item.deleted_at IS NULL
    ) = candidate.source_count
    AND COALESCE((
      SELECT max(item.updated_at)
      FROM navigation_items AS item
      WHERE item.organization_id = candidate.organization_id
        AND item.is_published = 1
        AND item.deleted_at IS NULL
    ), -1) = candidate.source_max_updated_at
  )
  OR (
    candidate.entity_type = 'site_identity'
    AND candidate.entity_key = 'site_identity'
    AND (
      (
        candidate.source_count = 0
        AND NOT EXISTS (
          SELECT 1
          FROM site_settings AS setting
          WHERE setting.organization_id = candidate.organization_id
            AND setting.key = 'public_identity'
        )
      )
      OR EXISTS (
        SELECT 1
        FROM site_settings AS setting
        WHERE setting.organization_id = candidate.organization_id
          AND setting.key = 'public_identity'
          AND setting.updated_at = candidate.source_updated_at
      )
    )
  )
  OR (
    candidate.entity_type = 'legal_status'
    AND candidate.entity_key = 'legal_status'
    AND candidate.source_count = 0
  )
)`;

const CMS_ADOPTION_CANDIDATE_CTE = String.raw`
WITH candidate AS (
  SELECT json_extract(value, '$.actorProfileId') AS actor_profile_id,
         json_extract(value, '$.adoptedAt') AS adopted_at,
         json_extract(value, '$.contentHash') AS content_hash,
         json_extract(value, '$.contentVersion') AS content_version,
         json_extract(value, '$.currentDraftRevisionId')
           AS current_draft_revision_id,
         json_extract(value, '$.entityKey') AS entity_key,
         json_extract(value, '$.entityType') AS entity_type,
         json_extract(value, '$.legacyPageRevisionId')
           AS legacy_page_revision_id,
         json_extract(value, '$.organizationId') AS organization_id,
         json_extract(value, '$.publishedAt') AS published_at,
         json_extract(value, '$.publishedRevisionId')
           AS published_revision_id,
         json_extract(value, '$.projectionJson') AS projection_json,
         json_extract(value, '$.revisionId') AS revision_id,
         json_extract(value, '$.revisionNumber') AS revision_number,
         json_extract(value, '$.snapshotJson') AS snapshot_json,
         json_extract(value, '$.sourceCount') AS source_count,
         json_extract(value, '$.sourceMaxUpdatedAt')
           AS source_max_updated_at,
         json_extract(value, '$.sourceUpdatedAt') AS source_updated_at,
         json_extract(value, '$.stateId') AS state_id,
         json_extract(value, '$.unpublishedAt') AS unpublished_at,
         json_extract(value, '$.workflowStatus') AS workflow_status
  FROM json_each(?)
)`;

const CMS_ADOPTION_STATE_INSERT_SQL = String.raw`
${CMS_ADOPTION_CANDIDATE_CTE}
INSERT INTO cms_entity_publication_states (
  id, organization_id, entity_type, entity_key, workflow_status,
  content_version, current_draft_revision_id, published_revision_id,
  last_editor_profile_id, draft_updated_at, published_at, unpublished_at,
  adopted_at, created_at, updated_at
)
SELECT candidate.state_id, candidate.organization_id,
       candidate.entity_type, candidate.entity_key, 'archived',
       candidate.content_version, NULL, NULL, candidate.actor_profile_id,
       NULL, NULL, NULL, candidate.adopted_at, candidate.adopted_at,
       candidate.adopted_at
FROM candidate
WHERE candidate.organization_id = ?
  AND candidate.actor_profile_id = ?
  AND ${CMS_ADOPTION_SOURCE_GUARD_SQL}
  AND NOT EXISTS (
    SELECT 1
    FROM cms_entity_publication_states AS existing
    WHERE existing.organization_id = candidate.organization_id
      AND existing.entity_type = candidate.entity_type
      AND existing.entity_key = candidate.entity_key
  )`;

const CMS_ADOPTION_PROGRAM_INSERT_SQL = String.raw`
${CMS_ADOPTION_CANDIDATE_CTE}
INSERT INTO programs (
  id, organization_id, club_id, name, slug, description,
  created_by_profile_id, created_at, updated_at, deleted_at
)
SELECT candidate.entity_key, candidate.organization_id,
       json_extract(candidate.snapshot_json, '$.clubId'),
       json_extract(candidate.snapshot_json, '$.name'),
       json_extract(candidate.snapshot_json, '$.slug'),
       NULLIF(json_extract(candidate.snapshot_json, '$.summary'), ''),
       candidate.actor_profile_id, candidate.adopted_at,
       candidate.source_updated_at, NULL
FROM candidate
WHERE candidate.organization_id = ?
  AND candidate.actor_profile_id = ?
  AND candidate.entity_type = 'program_public_profile'
  AND candidate.source_count = 0
  AND NOT EXISTS (
    SELECT 1
    FROM programs AS existing
    WHERE existing.id = candidate.entity_key
      AND existing.organization_id = candidate.organization_id
  )
  AND EXISTS (
    SELECT 1
    FROM organization_memberships AS membership
    JOIN profiles AS actor
      ON actor.id = membership.profile_id
     AND actor.status = 'active'
     AND actor.deleted_at IS NULL
    JOIN clubs AS club
      ON club.organization_id = membership.organization_id
     AND club.id = json_extract(candidate.snapshot_json, '$.clubId')
     AND club.deleted_at IS NULL
    WHERE membership.organization_id = candidate.organization_id
      AND membership.profile_id = candidate.actor_profile_id
      AND membership.role IN ('owner', 'administrator')
      AND membership.status = 'active'
      AND membership.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM programs AS existing
    WHERE existing.organization_id = candidate.organization_id
      AND (
        existing.id = candidate.entity_key
        OR existing.slug =
           json_extract(candidate.snapshot_json, '$.slug')
      )
  )`;

const CMS_ADOPTION_REVISION_INSERT_SQL = String.raw`
${CMS_ADOPTION_CANDIDATE_CTE}
INSERT INTO cms_entity_revisions (
  id, organization_id, publication_state_id, entity_type, entity_key,
  revision_number, snapshot_json, content_hash, canonical_byte_size,
  restored_from_revision_id, legacy_page_revision_id, actor_profile_id,
  created_at
)
SELECT candidate.revision_id, candidate.organization_id, candidate.state_id,
       candidate.entity_type, candidate.entity_key,
       candidate.revision_number, candidate.snapshot_json,
       candidate.content_hash,
       length(CAST(candidate.snapshot_json AS BLOB)),
       NULL, candidate.legacy_page_revision_id, candidate.actor_profile_id,
       candidate.adopted_at
FROM candidate
JOIN cms_entity_publication_states AS state
  ON state.id = candidate.state_id
 AND state.organization_id = candidate.organization_id
 AND state.entity_type = candidate.entity_type
 AND state.entity_key = candidate.entity_key
WHERE candidate.organization_id = ?
  AND candidate.actor_profile_id = ?
  AND state.workflow_status = 'archived'
  AND state.current_draft_revision_id IS NULL
  AND state.published_revision_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM cms_entity_revisions AS existing
    WHERE existing.id = candidate.revision_id
  )`;

const CMS_ADOPTION_STATE_FINALIZE_SQL = String.raw`
${CMS_ADOPTION_CANDIDATE_CTE}
UPDATE cms_entity_publication_states
SET workflow_status = (
      SELECT candidate.workflow_status
      FROM candidate
      WHERE candidate.state_id = cms_entity_publication_states.id
    ),
    current_draft_revision_id = (
      SELECT candidate.current_draft_revision_id
      FROM candidate
      WHERE candidate.state_id = cms_entity_publication_states.id
    ),
    published_revision_id = (
      SELECT candidate.published_revision_id
      FROM candidate
      WHERE candidate.state_id = cms_entity_publication_states.id
    ),
    last_editor_profile_id = (
      SELECT candidate.actor_profile_id
      FROM candidate
      WHERE candidate.state_id = cms_entity_publication_states.id
    ),
    draft_updated_at = (
      SELECT candidate.adopted_at
      FROM candidate
      WHERE candidate.state_id = cms_entity_publication_states.id
    ),
    published_at = (
      SELECT candidate.published_at
      FROM candidate
      WHERE candidate.state_id = cms_entity_publication_states.id
    ),
    unpublished_at = (
      SELECT candidate.unpublished_at
      FROM candidate
      WHERE candidate.state_id = cms_entity_publication_states.id
    ),
    adopted_at = (
      SELECT candidate.adopted_at
      FROM candidate
      WHERE candidate.state_id = cms_entity_publication_states.id
    ),
    updated_at = (
      SELECT candidate.adopted_at
      FROM candidate
      WHERE candidate.state_id = cms_entity_publication_states.id
    )
WHERE organization_id = ?
  AND last_editor_profile_id = ?
  AND workflow_status = 'archived'
  AND current_draft_revision_id IS NULL
  AND published_revision_id IS NULL
  AND id IN (SELECT state_id FROM candidate)
  AND EXISTS (
    SELECT 1
    FROM candidate
    JOIN cms_entity_revisions AS revision
      ON revision.id = candidate.revision_id
     AND revision.organization_id = candidate.organization_id
     AND revision.publication_state_id = candidate.state_id
     AND revision.entity_type = candidate.entity_type
     AND revision.entity_key = candidate.entity_key
     AND revision.content_hash = candidate.content_hash
    WHERE candidate.state_id = cms_entity_publication_states.id
  )`;

const CMS_ADOPTION_PAGE_METADATA_INSERT_SQL = String.raw`
${CMS_ADOPTION_CANDIDATE_CTE}
INSERT INTO page_public_metadata (
  page_id, organization_id, seo_title, meta_description,
  og_media_asset_id, updated_by_profile_id, created_at, updated_at
)
SELECT candidate.entity_key, candidate.organization_id,
       json_extract(candidate.snapshot_json, '$.seoTitle'),
       json_extract(candidate.snapshot_json, '$.metaDescription'),
       json_extract(candidate.snapshot_json, '$.openGraphAssetId'),
       candidate.actor_profile_id, candidate.source_updated_at,
       candidate.source_updated_at
FROM candidate
JOIN cms_entity_publication_states AS state
  ON state.id = candidate.state_id
 AND state.organization_id = candidate.organization_id
 AND state.entity_type = 'page'
 AND state.entity_key = candidate.entity_key
 AND state.workflow_status = 'published'
 AND state.published_revision_id = candidate.revision_id
JOIN cms_public_materialization_receipts AS receipt
  ON receipt.publication_state_id = candidate.state_id
 AND receipt.organization_id = candidate.organization_id
 AND receipt.entity_type = 'page'
 AND receipt.entity_key = candidate.entity_key
 AND receipt.revision_id = candidate.revision_id
 AND receipt.revision_hash = candidate.content_hash
 AND receipt.projection_json = candidate.projection_json
WHERE candidate.organization_id = ?
  AND candidate.actor_profile_id = ?
  AND candidate.entity_type = 'page'
  AND candidate.workflow_status = 'published'
ON CONFLICT(page_id) DO UPDATE SET
  seo_title = excluded.seo_title,
  meta_description = excluded.meta_description,
  og_media_asset_id = excluded.og_media_asset_id,
  updated_by_profile_id = excluded.updated_by_profile_id
WHERE page_public_metadata.organization_id = excluded.organization_id`;

const CMS_ADOPTION_SITE_IDENTITY_UPDATE_SQL = String.raw`
${CMS_ADOPTION_CANDIDATE_CTE}
UPDATE site_settings
SET value_json = (
      SELECT json_extract(
               candidate.projection_json,
               '$.setting.valueJson'
             )
      FROM candidate
      WHERE candidate.organization_id = site_settings.organization_id
        AND candidate.entity_type = 'site_identity'
        AND candidate.entity_key = 'site_identity'
    ),
    is_public = 1,
    updated_by_profile_id = ?
WHERE organization_id = ?
  AND key = 'public_identity'
  AND is_public = 1
  AND EXISTS (
    SELECT 1
    FROM candidate
    JOIN cms_entity_publication_states AS state
      ON state.id = candidate.state_id
     AND state.organization_id = candidate.organization_id
     AND state.entity_type = 'site_identity'
     AND state.entity_key = 'site_identity'
     AND state.workflow_status = 'published'
     AND state.published_revision_id = candidate.revision_id
    JOIN cms_entity_revisions AS revision
      ON revision.id = candidate.revision_id
     AND revision.organization_id = candidate.organization_id
     AND revision.publication_state_id = candidate.state_id
     AND revision.entity_type = candidate.entity_type
     AND revision.entity_key = candidate.entity_key
     AND revision.content_hash = candidate.content_hash
    JOIN cms_public_materialization_receipts AS receipt
      ON receipt.organization_id = candidate.organization_id
     AND receipt.publication_state_id = candidate.state_id
     AND receipt.entity_type = candidate.entity_type
     AND receipt.entity_key = candidate.entity_key
     AND receipt.revision_id = candidate.revision_id
     AND receipt.revision_hash = candidate.content_hash
     AND receipt.projection_json = candidate.projection_json
    WHERE candidate.organization_id = site_settings.organization_id
      AND candidate.actor_profile_id = ?
      AND candidate.entity_type = 'site_identity'
      AND candidate.entity_key = 'site_identity'
      AND candidate.workflow_status = 'published'
      AND json_extract(candidate.projection_json, '$.setting.key') =
          'public_identity'
      AND json_extract(
            candidate.projection_json,
            '$.setting.valueJson'
          ) = candidate.snapshot_json
  )`;

const CMS_ADOPTION_COMMUNITY_DETAILS_INSERT_SQL = String.raw`
${CMS_ADOPTION_CANDIDATE_CTE}
INSERT INTO community_link_public_details (
  community_link_id, organization_id, description, destination_type,
  confirmed_by_profile_id, confirmed_at, created_at, updated_at
)
SELECT candidate.entity_key, candidate.organization_id,
       json_extract(candidate.snapshot_json, '$.description'),
       json_extract(candidate.snapshot_json, '$.destinationType'),
       candidate.actor_profile_id, candidate.adopted_at,
       candidate.adopted_at, candidate.adopted_at
FROM candidate
WHERE candidate.organization_id = ?
  AND candidate.actor_profile_id = ?
  AND candidate.entity_type = 'community_link'
  AND candidate.workflow_status = 'published'
  AND json_extract(candidate.snapshot_json, '$.confirmed') = 1
  AND NOT EXISTS (
    SELECT 1
    FROM community_link_public_details AS existing
    WHERE existing.community_link_id = candidate.entity_key
  )`;

const CMS_ADOPTION_PROGRAM_DETAILS_INSERT_SQL = String.raw`
${CMS_ADOPTION_CANDIDATE_CTE}
INSERT INTO program_public_profile_details (
  program_id, organization_id, club_id, primary_event_lane_id,
  publication_status, is_featured, display_order, public_display_name,
  public_slug, short_summary, full_description, program_type,
  public_group_url, cover_media_asset_id, thumbnail_media_asset_id,
  theme_color, participant_expectations, preparation_information,
  typical_format, confirmed_social_links_json, related_resources_json,
  seo_title, meta_description, og_media_asset_id, updated_by_profile_id,
  published_at, created_at, updated_at, deleted_at
)
SELECT candidate.entity_key, candidate.organization_id,
       json_extract(candidate.snapshot_json, '$.clubId'),
       json_extract(candidate.snapshot_json, '$.laneId'),
       CASE candidate.workflow_status
         WHEN 'published' THEN 'published'
         ELSE 'draft'
       END,
       CASE json_extract(candidate.snapshot_json, '$.featured')
         WHEN 1 THEN 1 ELSE 0
       END,
       json_extract(candidate.snapshot_json, '$.displayOrder'),
       json_extract(candidate.snapshot_json, '$.name'),
       json_extract(candidate.snapshot_json, '$.slug'),
       json_extract(candidate.snapshot_json, '$.summary'),
       json_extract(candidate.snapshot_json, '$.description'),
       json_extract(candidate.snapshot_json, '$.programType'),
       json_extract(candidate.snapshot_json, '$.meetupGroupUrl'),
       json_extract(candidate.snapshot_json, '$.coverAssetId'),
       json_extract(candidate.snapshot_json, '$.thumbnailAssetId'),
       json_extract(candidate.snapshot_json, '$.themeColor'),
       json_extract(candidate.snapshot_json, '$.whatToExpect'),
       json_extract(candidate.snapshot_json, '$.preparation'),
       json_extract(candidate.snapshot_json, '$.typicalFormat'),
       json(
         json_extract(
           candidate.projection_json,
           '$.details.confirmedSocialLinks'
         )
       ),
       json(
         json_extract(
           candidate.projection_json,
           '$.details.relatedResources'
         )
       ),
       NULLIF(json_extract(candidate.snapshot_json, '$.seoTitle'), ''),
       NULLIF(json_extract(candidate.snapshot_json, '$.metaDescription'), ''),
       json_extract(candidate.snapshot_json, '$.openGraphAssetId'),
       candidate.actor_profile_id, candidate.published_at,
       candidate.adopted_at, candidate.adopted_at, NULL
FROM candidate
JOIN cms_entity_publication_states AS state
  ON state.id = candidate.state_id
 AND state.organization_id = candidate.organization_id
 AND state.entity_type = candidate.entity_type
 AND state.entity_key = candidate.entity_key
 AND state.workflow_status = candidate.workflow_status
 AND state.current_draft_revision_id = candidate.revision_id
 AND state.published_revision_id IS candidate.published_revision_id
JOIN cms_entity_revisions AS revision
  ON revision.id = candidate.revision_id
 AND revision.organization_id = candidate.organization_id
 AND revision.publication_state_id = candidate.state_id
 AND revision.content_hash = candidate.content_hash
WHERE candidate.organization_id = ?
  AND candidate.actor_profile_id = ?
  AND candidate.entity_type = 'program_public_profile'
  AND candidate.workflow_status IN ('draft', 'published')
  AND (
    candidate.workflow_status = 'draft'
    OR EXISTS (
      SELECT 1
      FROM cms_public_materialization_receipts AS receipt
      WHERE receipt.organization_id = candidate.organization_id
        AND receipt.publication_state_id = candidate.state_id
        AND receipt.entity_type = candidate.entity_type
        AND receipt.entity_key = candidate.entity_key
        AND receipt.revision_id = candidate.revision_id
        AND receipt.revision_hash = candidate.content_hash
        AND receipt.projection_json = candidate.projection_json
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM program_public_profile_details AS existing
    WHERE existing.program_id = candidate.entity_key
  )`;

const CMS_ADOPTION_MATERIALIZATION_RECEIPT_INSERT_SQL = String.raw`
${CMS_ADOPTION_CANDIDATE_CTE}
INSERT INTO cms_public_materialization_receipts (
  id, organization_id, publication_state_id, entity_type, entity_key,
  revision_id, revision_hash, projection_json, canonical_byte_size,
  actor_profile_id, created_at
)
SELECT 'cms-materialization-' || candidate.revision_id,
       candidate.organization_id, candidate.state_id,
       candidate.entity_type, candidate.entity_key, candidate.revision_id,
       candidate.content_hash, candidate.projection_json,
       length(CAST(candidate.projection_json AS BLOB)),
       candidate.actor_profile_id, candidate.adopted_at
FROM candidate
JOIN cms_entity_publication_states AS state
  ON state.id = candidate.state_id
 AND state.organization_id = candidate.organization_id
 AND state.entity_type = candidate.entity_type
 AND state.entity_key = candidate.entity_key
 AND state.workflow_status = 'published'
 AND state.published_revision_id = candidate.revision_id
JOIN cms_entity_revisions AS revision
  ON revision.id = candidate.revision_id
 AND revision.organization_id = candidate.organization_id
 AND revision.publication_state_id = candidate.state_id
 AND revision.content_hash = candidate.content_hash
WHERE candidate.organization_id = ?
  AND candidate.actor_profile_id = ?
  AND candidate.published_revision_id = candidate.revision_id
  AND NOT EXISTS (
    SELECT 1
    FROM cms_public_materialization_receipts AS existing
    WHERE existing.publication_state_id = candidate.state_id
      AND existing.revision_id = candidate.revision_id
  )`;

const CMS_ADOPTION_MARKER_INSERT_SQL = String.raw`
${CMS_ADOPTION_CANDIDATE_CTE}
INSERT INTO cms_adoption_states (
  organization_id, adoption_version, source_fingerprint,
  adopted_at, verified_at
)
SELECT ?, ?, ?, ?, ?
WHERE (SELECT count(*) FROM candidate) = ?
  AND (
    SELECT count(*)
    FROM candidate
    JOIN cms_entity_publication_states AS state
      ON state.id = candidate.state_id
     AND state.organization_id = candidate.organization_id
     AND state.entity_type = candidate.entity_type
     AND state.entity_key = candidate.entity_key
     AND state.workflow_status = candidate.workflow_status
     AND state.content_version = candidate.content_version
     AND state.current_draft_revision_id =
         candidate.current_draft_revision_id
     AND state.published_revision_id IS candidate.published_revision_id
    JOIN cms_entity_revisions AS revision
      ON revision.id = candidate.revision_id
     AND revision.organization_id = candidate.organization_id
      AND revision.publication_state_id = candidate.state_id
      AND revision.content_hash = candidate.content_hash
    LEFT JOIN cms_public_materialization_receipts AS receipt
      ON receipt.publication_state_id = candidate.state_id
     AND receipt.organization_id = candidate.organization_id
     AND receipt.entity_type = candidate.entity_type
     AND receipt.entity_key = candidate.entity_key
     AND receipt.revision_id = candidate.published_revision_id
     AND receipt.revision_hash = candidate.content_hash
     AND receipt.projection_json = candidate.projection_json
    WHERE (
      candidate.published_revision_id IS NULL
      OR receipt.id IS NOT NULL
    )
  ) = ?
  AND NOT EXISTS (
    SELECT 1
    FROM candidate
    WHERE candidate.entity_type = 'page'
      AND candidate.workflow_status = 'published'
      AND NOT EXISTS (
        SELECT 1
        FROM page_public_metadata AS metadata
        WHERE metadata.page_id = candidate.entity_key
          AND metadata.organization_id = candidate.organization_id
          AND metadata.seo_title IS
              json_extract(candidate.snapshot_json, '$.seoTitle')
          AND metadata.meta_description IS
              json_extract(candidate.snapshot_json, '$.metaDescription')
          AND metadata.og_media_asset_id IS
              json_extract(candidate.snapshot_json, '$.openGraphAssetId')
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM candidate
    WHERE candidate.entity_type = 'community_link'
      AND candidate.workflow_status = 'published'
      AND NOT EXISTS (
        SELECT 1
        FROM community_link_public_details AS detail
        WHERE detail.community_link_id = candidate.entity_key
          AND detail.organization_id = candidate.organization_id
          AND detail.description =
              json_extract(candidate.snapshot_json, '$.description')
          AND detail.destination_type =
              json_extract(candidate.snapshot_json, '$.destinationType')
          AND detail.confirmed_by_profile_id = candidate.actor_profile_id
          AND detail.confirmed_at = candidate.adopted_at
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM candidate
    WHERE NOT (${CMS_ADOPTION_SOURCE_GUARD_SQL})
  )
  AND NOT EXISTS (
    SELECT 1
    FROM cms_adoption_states AS existing
    WHERE existing.organization_id = ?
  )`;

/**
 * A conditional marker insert that changed zero rows is not enough to roll
 * back the preceding adoption statements. This final statement deliberately
 * violates the marker checks whenever the exact durable marker is absent, so
 * D1 rolls the whole batch back instead of committing partial editorial state.
 */
const CMS_ADOPTION_COMPLETION_SENTINEL_SQL = String.raw`
INSERT INTO cms_adoption_states (
  organization_id, adoption_version, source_fingerprint,
  adopted_at, verified_at
)
SELECT ?, 0, '', 0, 0
WHERE NOT EXISTS (
  SELECT 1
  FROM cms_adoption_states AS marker
  WHERE marker.organization_id = ?
    AND marker.adoption_version = ?
    AND marker.source_fingerprint = ?
)`;

async function buildAdoptionCandidates(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  now: number,
): Promise<readonly AdoptionCandidate[]> {
  const [pages, clubs, programs, links, navigation, identity] =
    await Promise.all([
    readPageCandidates(database, actor, now),
    readClubCandidates(database, actor, now),
    readProgramCandidates(database, actor, now),
    readCommunityCandidates(database, actor, now),
    readNavigationCandidate(database, actor, now),
    readIdentityCandidate(database, actor, now),
    ]);
  const legal = await adoptionCandidate({
    actor,
    contentVersion: 1,
    entityKey: "legal_status",
    entityType: "legal_status",
    legacyPageRevisionId: null,
    now,
    publishedAt: null,
    revisionNumber: 1,
    snapshot: parseLegalStatusSnapshot({
      charityNumber: null,
      charityStatus: "unconfirmed",
      effectiveDate: null,
      footerWording: null,
      jurisdiction: null,
      legalFormWording: null,
      legalName: null,
      registrationNumber: null,
    }),
    sourceCount: 0,
    sourceMaxUpdatedAt: -1,
    sourceUpdatedAt: -1,
    workflowStatus: "draft",
  });
  return Object.freeze([
    ...pages,
    ...clubs,
    ...programs,
    ...links,
    navigation,
    identity,
    legal,
  ]);
}

async function readPageCandidates(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  now: number,
): Promise<readonly AdoptionCandidate[]> {
  const [pageResult, sectionResult, legacyRevisionResult] = await Promise.all([
    database
      .prepare(
        `SELECT page.id, page.title, page.slug, page.status, page.visibility,
                page.current_revision, page.published_at, page.updated_at,
                metadata.seo_title, metadata.meta_description,
                metadata.og_media_asset_id,
                metadata.updated_at AS metadata_updated_at,
                count(section.id) AS section_count,
                COALESCE(max(section.updated_at), -1)
                  AS section_max_updated_at
         FROM pages AS page
         LEFT JOIN page_sections AS section
           ON section.page_id = page.id
          AND section.organization_id = page.organization_id
          AND section.deleted_at IS NULL
         LEFT JOIN page_public_metadata AS metadata
           ON metadata.page_id = page.id
          AND metadata.organization_id = page.organization_id
         WHERE page.organization_id = ?
           AND page.deleted_at IS NULL
         GROUP BY page.id
         ORDER BY page.id
         LIMIT ?`,
      )
      .bind(actor.organizationId, MAX_ADOPTED_ENTITIES + 1)
      .all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT section.page_id, section.section_key, section.section_type,
                section.content_json, section.sort_order
         FROM page_sections AS section
         JOIN pages AS page
           ON page.id = section.page_id
          AND page.organization_id = section.organization_id
          AND page.deleted_at IS NULL
         WHERE section.organization_id = ?
           AND section.deleted_at IS NULL
         ORDER BY section.page_id, section.sort_order, section.section_key
         LIMIT ?`,
      )
      .bind(actor.organizationId, MAX_ADOPTED_PAGE_SECTIONS + 1)
      .all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT revision.page_id, revision.id
         FROM page_revisions AS revision
         JOIN pages AS page
           ON page.id = revision.page_id
          AND page.organization_id = revision.organization_id
          AND page.current_revision = revision.revision_number
          AND page.deleted_at IS NULL
         WHERE revision.organization_id = ?
           AND NOT EXISTS (
             SELECT 1
             FROM page_revisions AS newer
             WHERE newer.organization_id = revision.organization_id
               AND newer.page_id = revision.page_id
               AND newer.revision_number = revision.revision_number
               AND (
                 newer.created_at > revision.created_at
                 OR (
                   newer.created_at = revision.created_at
                   AND newer.id > revision.id
                 )
               )
           )
         ORDER BY revision.page_id
         LIMIT ?`,
      )
      .bind(actor.organizationId, MAX_ADOPTED_ENTITIES + 1)
      .all<Record<string, unknown>>(),
  ]);
  const rows = pageResult.results ?? [];
  if (rows.length > MAX_ADOPTED_ENTITIES) throw new CmsAdoptionError();
  const sectionRows = sectionResult.results ?? [];
  if (sectionRows.length > MAX_ADOPTED_PAGE_SECTIONS) {
    throw new CmsAdoptionError();
  }
  const legacyRevisionRows = legacyRevisionResult.results ?? [];
  if (legacyRevisionRows.length > MAX_ADOPTED_ENTITIES) {
    throw new CmsAdoptionError();
  }
  const sectionsByPage = new Map<string, Record<string, unknown>[]>();
  for (const section of sectionRows) {
    const pageId = requiredString(section.page_id);
    const existing = sectionsByPage.get(pageId) ?? [];
    existing.push(section);
    sectionsByPage.set(pageId, existing);
  }
  const legacyRevisionByPage = new Map(
    legacyRevisionRows.map((row) => [
      requiredString(row.page_id),
      requiredString(row.id),
    ]),
  );
  const candidates: AdoptionCandidate[] = [];
  for (const row of rows) {
    const pageId = requiredString(row.id);
    const pageSections = sectionsByPage.get(pageId) ?? [];
    if (
      pageSections.length > 24 ||
      pageSections.length !== nonnegativeInteger(row.section_count)
    ) {
      throw new CmsAdoptionError();
    }
    const blocks = pageSections.map((section) => {
      let config: unknown;
      try {
        config = JSON.parse(requiredString(section.content_json));
      } catch {
        throw new CmsAdoptionError();
      }
      return {
        config,
        id: requiredString(section.section_key),
        type: requiredString(section.section_type),
      };
    });
    const title = requiredString(row.title);
    const summary = firstPageSummary(blocks) ?? title;
    const snapshot = parsePageSnapshot({
      blocks,
      metaDescription:
        optionalString(row.meta_description) ??
        summary.slice(0, 160),
      openGraphAssetId: optionalString(row.og_media_asset_id),
      seoTitle:
        optionalString(row.seo_title) ??
        title.slice(0, 60),
      slug: requiredString(row.slug),
      title,
    });
    const isPublished =
      row.status === "published" &&
      row.visibility === "public" &&
      optionalInteger(row.published_at) !== null;
    candidates.push(
      await adoptionCandidate({
        actor,
        contentVersion: positiveInteger(row.current_revision),
        entityKey: pageId,
        entityType: "page",
        legacyPageRevisionId: legacyRevisionByPage.get(pageId) ?? null,
        now,
        publishedAt: isPublished
          ? optionalInteger(row.published_at)
          : null,
          projection: {
            eventSelectionProofs: [],
            metadata: {
              metaDescription: snapshot.metaDescription,
              openGraphAssetId: optionalString(row.og_media_asset_id),
              seoTitle: snapshot.seoTitle,
          },
          page: {
            currentRevision: positiveInteger(row.current_revision),
            slug: requiredString(row.slug),
            title,
          },
          sections: pageSections.map((section) => ({
            contentJson: requiredString(section.content_json),
            sectionKey: requiredString(section.section_key),
            sectionType: requiredString(section.section_type),
            sortOrder: nonnegativeInteger(section.sort_order),
          })),
        },
        revisionNumber: positiveInteger(row.current_revision),
        snapshot,
        sourceCount: nonnegativeInteger(row.section_count),
        sourceMaxUpdatedAt: integer(row.section_max_updated_at),
        sourceUpdatedAt: Math.max(
          nonnegativeInteger(row.updated_at),
          optionalInteger(row.metadata_updated_at) ?? -1,
        ),
        workflowStatus: isPublished
          ? "published"
          : row.status === "archived"
            ? "archived"
            : "draft",
      }),
    );
  }
  return Object.freeze(candidates);
}

async function readClubCandidates(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  now: number,
): Promise<readonly AdoptionCandidate[]> {
  const result = await database
    .prepare(
      `SELECT club.id, club.name, club.slug, club.updated_at AS club_updated_at,
              profile.publication_status, profile.is_featured,
              profile.description, profile.public_group_url,
              profile.published_at,
              profile.updated_at AS profile_updated_at,
              lane.id AS lane_id, lane.updated_at AS lane_updated_at,
              detail.public_display_name, detail.short_summary,
              detail.full_description, detail.program_type,
              detail.cover_media_asset_id, detail.thumbnail_media_asset_id,
              detail.image_alt_text, detail.theme_color,
              detail.participant_expectations,
              detail.preparation_information, detail.typical_format,
              detail.confirmed_social_links_json,
              detail.related_resources_json, detail.seo_title,
              detail.meta_description, detail.og_media_asset_id,
              detail.updated_at AS detail_updated_at
       FROM club_public_profiles AS profile
       JOIN clubs AS club
         ON club.id = profile.club_id
        AND club.organization_id = profile.organization_id
        AND club.deleted_at IS NULL
       JOIN event_lanes AS lane
         ON lane.id = profile.primary_event_lane_id
        AND lane.organization_id = profile.organization_id
        AND lane.deleted_at IS NULL
       LEFT JOIN club_public_profile_details AS detail
         ON detail.club_id = profile.club_id
        AND detail.organization_id = profile.organization_id
       WHERE profile.organization_id = ?
         AND profile.deleted_at IS NULL
       ORDER BY club.id
       LIMIT ?`,
    )
    .bind(actor.organizationId, MAX_ADOPTED_ENTITIES + 1)
    .all<Record<string, unknown>>();
  const rows = result.results ?? [];
  if (rows.length > MAX_ADOPTED_ENTITIES) throw new CmsAdoptionError();
  return Object.freeze(
    await Promise.all(
      rows.map(async (row) => {
        const description = requiredString(row.description);
        const hasDetails =
          row.detail_updated_at !== null &&
          row.detail_updated_at !== undefined;
        const isPublished =
          row.publication_status === "published" &&
          optionalInteger(row.published_at) !== null;
        return adoptionCandidate({
          actor,
          contentVersion: 1,
          entityKey: requiredString(row.id),
          entityType: "club_public_profile",
          legacyPageRevisionId: null,
          now,
          publishedAt: isPublished
            ? optionalInteger(row.published_at)
            : null,
          projection: {
            club: {
              description,
              name: requiredString(row.name),
              slug: requiredString(row.slug),
            },
            details: hasDetails
              ? {
                  confirmedSocialLinks: JSON.parse(
                    requiredString(row.confirmed_social_links_json),
                  ),
                  coverAssetId: optionalString(row.cover_media_asset_id),
                  fullDescription: requiredString(row.full_description),
                  imageAltText: optionalString(row.image_alt_text),
                  metaDescription: requiredString(row.meta_description),
                  openGraphAssetId: optionalString(row.og_media_asset_id),
                  participantExpectations: optionalString(
                    row.participant_expectations,
                  ),
                  preparationInformation: optionalString(
                    row.preparation_information,
                  ),
                  programType: requiredString(row.program_type),
                  publicDisplayName: requiredString(
                    row.public_display_name,
                  ),
                  relatedResources: JSON.parse(
                    requiredString(row.related_resources_json),
                  ),
                  seoTitle: requiredString(row.seo_title),
                  shortSummary: requiredString(row.short_summary),
                  themeColor: requiredString(row.theme_color),
                  thumbnailAssetId: optionalString(
                    row.thumbnail_media_asset_id,
                  ),
                  typicalFormat: optionalString(row.typical_format),
                }
              : null,
            profile: {
              featured: Boolean(row.is_featured),
              laneId: requiredString(row.lane_id),
              meetupGroupUrl: optionalString(row.public_group_url),
              summary: description,
            },
          },
          revisionNumber: 1,
          snapshot: parseClubProfileSnapshot({
            contentConfirmed: isPublished,
            coverAssetId: null,
            description,
            featured: Boolean(row.is_featured),
            imageAltText: null,
            laneId: requiredString(row.lane_id),
            meetupGroupUrl: optionalString(row.public_group_url),
            metaDescription: description.slice(0, 160),
            name: requiredString(row.name),
            openGraphAssetId: null,
            preparation: null,
            programType: "club",
            relatedResourceIds: [],
            seoTitle: requiredString(row.name).slice(0, 60),
            slug: requiredString(row.slug),
            socialUrls: [],
            summary: description.slice(0, 500),
            themeColor: hasDetails
              ? requiredString(row.theme_color)
              : "#2457D6",
            thumbnailAssetId: null,
            typicalFormat: null,
            whatToExpect: null,
          }),
          sourceCount: 1,
          sourceMaxUpdatedAt: -1,
          sourceUpdatedAt: Math.max(
            nonnegativeInteger(row.club_updated_at),
            nonnegativeInteger(row.profile_updated_at),
            nonnegativeInteger(row.lane_updated_at),
            optionalInteger(row.detail_updated_at) ?? -1,
          ),
          workflowStatus: isPublished
            ? "published"
            : row.publication_status === "archived"
              ? "archived"
              : "draft",
        });
      }),
    ),
  );
}

async function readProgramCandidates(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  now: number,
): Promise<readonly AdoptionCandidate[]> {
  const result = await database
    .prepare(
      `WITH program_candidates AS (
         SELECT organization.slug AS organization_slug,
                club.id AS club_id, club.name AS club_name,
                club.slug AS club_slug,
                club.description AS club_description,
                profile.primary_event_lane_id AS lane_id,
                profile.publication_status AS club_publication_status,
                profile.public_group_url,
                profile.published_at AS club_published_at,
                club.updated_at AS club_updated_at,
                profile.updated_at AS profile_updated_at,
                organization.updated_at AS organization_updated_at,
                program.id AS program_id, program.name AS program_name,
                program.slug AS program_slug,
                program.description AS program_description,
                program.updated_at AS program_updated_at
         FROM programs AS program
         JOIN clubs AS club
           ON club.id = program.club_id
          AND club.organization_id = program.organization_id
          AND club.deleted_at IS NULL
         JOIN organizations AS organization
           ON organization.id = program.organization_id
          AND organization.deleted_at IS NULL
         JOIN club_public_profiles AS profile
           ON profile.club_id = club.id
          AND profile.organization_id = club.organization_id
          AND profile.deleted_at IS NULL
         WHERE program.organization_id = ?
           AND program.deleted_at IS NULL

         UNION ALL

         SELECT organization.slug AS organization_slug,
                club.id AS club_id, club.name AS club_name,
                club.slug AS club_slug,
                club.description AS club_description,
                profile.primary_event_lane_id AS lane_id,
                profile.publication_status AS club_publication_status,
                profile.public_group_url,
                profile.published_at AS club_published_at,
                club.updated_at AS club_updated_at,
                profile.updated_at AS profile_updated_at,
                organization.updated_at AS organization_updated_at,
                NULL AS program_id, NULL AS program_name,
                NULL AS program_slug, NULL AS program_description,
                NULL AS program_updated_at
         FROM organizations AS organization
         JOIN clubs AS club
           ON club.organization_id = organization.id
          AND club.deleted_at IS NULL
         JOIN club_public_profiles AS profile
           ON profile.club_id = club.id
          AND profile.organization_id = club.organization_id
          AND profile.deleted_at IS NULL
         WHERE organization.id = ?
           AND organization.slug = ?
           AND club.slug IN (?, ?, ?, ?, ?)
           AND NOT EXISTS (
             SELECT 1
             FROM programs AS existing
             WHERE existing.organization_id = organization.id
               AND existing.club_id = club.id
               AND existing.slug = club.slug
               AND existing.deleted_at IS NULL
           )
       )
       SELECT *
       FROM program_candidates
       ORDER BY club_slug, program_slug, program_id
       LIMIT ?`,
    )
    .bind(
      actor.organizationId,
      actor.organizationId,
      PUBLIC_ORGANIZATION_SLUG,
      ...STARTER_PROGRAM_CLUB_SLUGS,
      MAX_ADOPTED_ENTITIES + 1,
    )
    .all<Record<string, unknown>>();
  const rows = result.results ?? [];
  if (rows.length > MAX_ADOPTED_ENTITIES) throw new CmsAdoptionError();
  return Object.freeze(
    await Promise.all(
      rows.map(async (row) => {
        const existingId = optionalString(row.program_id);
        const organizationSlug = requiredString(row.organization_slug);
        const clubSlug = requiredString(row.club_slug);
        const starter =
          organizationSlug === PUBLIC_ORGANIZATION_SLUG
            ? STARTER_PROGRAMS_BY_SLUG.get(clubSlug) ?? null
            : null;
        const description =
          optionalString(row.program_description) ??
          optionalString(row.club_description) ??
          "";
        const name =
          optionalString(row.program_name) ??
          requiredString(row.club_name);
        const slug =
          optionalString(row.program_slug) ??
          clubSlug;
        const authorizedMeetupUrl = starter?.publicGroupUrl ?? null;
        const inheritedMeetupUrl =
          authorizedMeetupUrl &&
          optionalString(row.public_group_url) === authorizedMeetupUrl
            ? authorizedMeetupUrl
            : null;
        const isProvenPublishedStarter =
          Boolean(starter) &&
          starter?.publicationStatus === "published" &&
          row.club_publication_status === "published" &&
          optionalInteger(row.club_published_at) !== null &&
          inheritedMeetupUrl !== null &&
          description.trim().length > 0 &&
          name === starter.name &&
          slug === starter.slug;
        const sourceUpdatedAt = Math.max(
          optionalInteger(row.program_updated_at) ?? -1,
          nonnegativeInteger(row.club_updated_at),
          nonnegativeInteger(row.profile_updated_at),
          nonnegativeInteger(row.organization_updated_at),
        );
        const clubId = requiredString(row.club_id);
        const entityKey =
          existingId ??
          `program-${await deterministicId(
            `${actor.organizationId}\u0000starter-program\u0000${clubId}\u0000${slug}`,
          )}`;
        const snapshot = parseProgramProfileSnapshot({
          clubId,
          contentConfirmed: isProvenPublishedStarter,
          coverAssetId: null,
          description,
          displayOrder: 1000,
          featured: isProvenPublishedStarter,
          laneId: requiredString(row.lane_id),
          meetupGroupUrl: inheritedMeetupUrl,
          metaDescription: isProvenPublishedStarter
            ? description.slice(0, 160)
            : "",
          name,
          openGraphAssetId: null,
          preparation: null,
          programType:
            name.includes("Circle") ? "circle" : "program",
          relatedResourceIds: [],
          seoTitle: name.slice(0, 60),
          slug,
          socialUrls: [],
          summary: description.slice(0, 500),
          themeColor: "#2457D6",
          thumbnailAssetId: null,
          typicalFormat: null,
          whatToExpect: null,
        });
        return adoptionCandidate({
          actor,
          contentVersion: 1,
          entityKey,
          entityType: "program_public_profile",
          legacyPageRevisionId: null,
          now,
          publishedAt: isProvenPublishedStarter
            ? optionalInteger(row.club_published_at)
            : null,
          projection: {
            details: {
              clubId: snapshot.clubId,
              confirmedSocialLinks: [],
              coverAssetId: snapshot.coverAssetId,
              displayOrder: snapshot.displayOrder,
              featured: snapshot.featured,
              fullDescription: snapshot.description,
              laneId: snapshot.laneId,
              metaDescription: snapshot.metaDescription,
              meetupGroupUrl: snapshot.meetupGroupUrl,
              name: snapshot.name,
              openGraphAssetId: snapshot.openGraphAssetId,
              participantExpectations: snapshot.whatToExpect,
              preparationInformation: snapshot.preparation,
              programType: snapshot.programType,
              relatedResources: [],
              seoTitle: snapshot.seoTitle,
              slug: snapshot.slug,
              summary: snapshot.summary,
              themeColor: snapshot.themeColor,
              thumbnailAssetId: snapshot.thumbnailAssetId,
              typicalFormat: snapshot.typicalFormat,
            },
          },
          revisionNumber: 1,
          snapshot,
          sourceCount: existingId ? 1 : 0,
          sourceMaxUpdatedAt: -1,
          sourceUpdatedAt,
          workflowStatus: isProvenPublishedStarter
            ? "published"
            : "draft",
        });
      }),
    ),
  );
}

async function readCommunityCandidates(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  now: number,
): Promise<readonly AdoptionCandidate[]> {
  const result = await database
    .prepare(
      `SELECT id, label, url, link_type, is_published, sort_order,
              updated_at
       FROM community_links
       WHERE organization_id = ?
         AND deleted_at IS NULL
       ORDER BY id
       LIMIT ?`,
    )
    .bind(actor.organizationId, MAX_ADOPTED_ENTITIES + 1)
    .all<Record<string, unknown>>();
  const rows = result.results ?? [];
  if (rows.length > MAX_ADOPTED_ENTITIES) throw new CmsAdoptionError();
  return Object.freeze(
    await Promise.all(
      rows.map(async (row) => {
        const url = requiredString(row.url);
        const isPublished =
          Boolean(row.is_published) &&
          row.link_type === "meetup_group" &&
          VERIFIED_LEGACY_COMMUNITY_URLS.has(url);
        return adoptionCandidate({
          actor,
          contentVersion: 1,
          entityKey: requiredString(row.id),
          entityType: "community_link",
          legacyPageRevisionId: null,
          now,
          publishedAt: isPublished
            ? nonnegativeInteger(row.updated_at)
            : null,
          projection: {
            details: {
              description: requiredString(row.label).slice(0, 240),
              destinationType: communityDestination(row.link_type),
            },
            link: {
              label: requiredString(row.label),
              linkType: communityDestination(row.link_type),
              sortOrder: nonnegativeInteger(row.sort_order),
              url,
            },
          },
          revisionNumber: 1,
          snapshot: parseCommunityLinkSnapshot({
            confirmed: isPublished,
            description: requiredString(row.label).slice(0, 240),
            destinationType: communityDestination(row.link_type),
            label: requiredString(row.label),
            sortOrder: nonnegativeInteger(row.sort_order),
            url,
          }),
          sourceCount: 1,
          sourceMaxUpdatedAt: -1,
          sourceUpdatedAt: nonnegativeInteger(row.updated_at),
          workflowStatus: isPublished ? "published" : "draft",
        });
      }),
    ),
  );
}

async function readNavigationCandidate(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  now: number,
): Promise<AdoptionCandidate> {
  const result = await database
    .prepare(
      `SELECT item.id, item.label, item.placement, item.external_url,
              item.sort_order, item.updated_at, page.slug AS page_slug
       FROM navigation_items AS item
       LEFT JOIN pages AS page
         ON page.id = item.page_id
        AND page.organization_id = item.organization_id
       WHERE item.organization_id = ?
         AND item.is_published = 1
         AND item.deleted_at IS NULL
         AND (
           item.external_url IS NOT NULL
           OR (
             page.id IS NOT NULL
             AND page.status = 'published'
             AND page.visibility = 'public'
             AND page.deleted_at IS NULL
           )
         )
       ORDER BY item.placement, item.sort_order, item.id
       LIMIT 81`,
    )
    .bind(actor.organizationId)
    .all<Record<string, unknown>>();
  const rows = result.results ?? [];
  if (rows.length > 80) throw new CmsAdoptionError();
  const configured = rows.map((row) => ({
    id: requiredString(row.id),
    label: requiredString(row.label),
    placement: row.placement,
    sortOrder: nonnegativeInteger(row.sort_order),
    target: optionalString(row.page_slug)
      ? `/${requiredString(row.page_slug)}`
      : requiredString(row.external_url),
  }));
  const snapshot = parseNavigationSnapshot({
    items: adoptedNavigationItems(configured),
  });
  return adoptionCandidate({
    actor,
    contentVersion: 1,
    entityKey: "navigation",
    entityType: "navigation",
    legacyPageRevisionId: null,
    now,
    publishedAt: rows.length > 0 ? now : null,
    projection: { items: snapshot.items },
    revisionNumber: 1,
    snapshot,
    sourceCount: rows.length,
    sourceMaxUpdatedAt:
      rows.length === 0
        ? -1
        : Math.max(...rows.map((row) => nonnegativeInteger(row.updated_at))),
    sourceUpdatedAt: -1,
    workflowStatus: rows.length > 0 ? "published" : "draft",
  });
}

async function readIdentityCandidate(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  now: number,
): Promise<AdoptionCandidate> {
  const row = await database
    .prepare(
      `SELECT value_json, updated_at
       FROM site_settings
       WHERE organization_id = ?
         AND key = 'public_identity'
         AND is_public = 1
       LIMIT 1`,
    )
    .bind(actor.organizationId)
    .first<Record<string, unknown>>();
  let existing: Record<string, unknown> = {};
  if (row) {
    try {
      const parsed = JSON.parse(requiredString(row.value_json));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new CmsAdoptionError();
      }
      existing = parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof CmsAdoptionError) throw error;
      throw new CmsAdoptionError();
    }
  }
  const brandName = existing.brandName ?? "Vancouver Curiosity Club";
  const mission =
    existing.mission ??
    "Thoughtful events for people who like learning in company.";
  const snapshot = parseSiteIdentitySnapshot({
    brandName,
    footerMission: existing.footerMission ?? mission,
    locationLabel:
      existing.locationLabel ?? "Vancouver, British Columbia",
    logoAssetId: existing.logoAssetId ?? null,
    metaDescription: existing.metaDescription ?? mission,
    mission,
    openGraphAssetId: existing.openGraphAssetId ?? null,
    palette:
      existing.palette ?? {
        accent: "#5B2CC9",
        background: "#FFF9F5",
        foreground: "#221C3D",
        secondary: "#2457D6",
      },
    seoTitle: existing.seoTitle ?? brandName,
    tagline:
      existing.tagline ?? "A social calendar with a brain.",
    typography: existing.typography ?? "editorial",
  });
  return adoptionCandidate({
    actor,
    contentVersion: 1,
    entityKey: "site_identity",
    entityType: "site_identity",
    legacyPageRevisionId: null,
    now,
    publishedAt: row ? nonnegativeInteger(row.updated_at) : now,
    projection: {
      setting: {
        key: "public_identity",
        valueJson: canonicalJson(snapshot),
      },
    },
    revisionNumber: 1,
    snapshot,
    sourceCount: row ? 1 : 0,
    sourceMaxUpdatedAt: -1,
    sourceUpdatedAt: row ? nonnegativeInteger(row.updated_at) : -1,
    workflowStatus: row ? "published" : "draft",
  });
}

async function adoptionCandidate(input: Readonly<{
  actor: AuthorizedMembership;
  contentVersion: number;
  entityKey: string;
  entityType: CmsEntityType;
  legacyPageRevisionId: string | null;
  now: number;
  publishedAt: number | null;
  projection?: unknown;
  revisionNumber: number;
  snapshot: unknown;
  sourceCount: number;
  sourceMaxUpdatedAt: number;
  sourceUpdatedAt: number;
  workflowStatus: AdoptionWorkflowStatus;
}>): Promise<AdoptionCandidate> {
  const identity = await deterministicId(
    `${input.actor.organizationId}\u0000${input.entityType}\u0000${input.entityKey}`,
  );
  const snapshotJson = canonicalJson(input.snapshot);
  const projectionJson = canonicalJson(input.projection ?? input.snapshot);
  const hash = await contentHash(input.snapshot);
  const revisionId = `cms-revision-${identity}`;
  return Object.freeze({
    actorProfileId: input.actor.profileId,
    adoptedAt: input.now,
    contentHash: hash,
    contentVersion: input.contentVersion,
    currentDraftRevisionId: revisionId,
    entityKey: input.entityKey,
    entityType: input.entityType,
    legacyPageRevisionId: input.legacyPageRevisionId,
    organizationId: input.actor.organizationId,
    publishedAt: input.publishedAt,
    publishedRevisionId:
      input.workflowStatus === "published" ? revisionId : null,
    projectionJson,
    revisionId,
    revisionNumber: input.revisionNumber,
    snapshotJson,
    sourceCount: input.sourceCount,
    sourceMaxUpdatedAt: input.sourceMaxUpdatedAt,
    sourceUpdatedAt: input.sourceUpdatedAt,
    stateId: `cms-state-${identity}`,
    unpublishedAt:
      input.workflowStatus === "unpublished" ? input.now : null,
    workflowStatus: input.workflowStatus,
  });
}

function adoptedNavigationItems(
  configured: readonly Readonly<{
    id: string;
    label: string;
    placement: unknown;
    sortOrder: number;
    target: string;
  }>[],
): readonly Readonly<{
  id: string;
  label: string;
  placement: "footer" | "header";
  sortOrder: number;
  target: string;
}>[] {
  const byTarget = new Map(configured.map((item) => [item.target, item]));
  const requiredHeader = [
    ["/events", "Events"],
    ["/clubs", "Clubs"],
    ["/community", "Community"],
    ["/about", "About"],
    ["/get-involved", "Get Involved"],
    ["/organizer", "Organizer Login"],
  ] as const;
  const requiredFooter = [
    ["/events", "Events"],
    ["/clubs", "Clubs"],
    ["/community", "Community"],
    ["/about", "About"],
    ["/get-involved", "Get Involved"],
    ["/contact", "Feedback"],
    ["/conduct", "Code of Conduct"],
    ["/accessibility", "Accessibility"],
    ["/privacy", "Privacy"],
  ] as const;
  const result: {
    id: string;
    label: string;
    placement: "footer" | "header";
    sortOrder: number;
    target: string;
  }[] = [];
  for (const [index, [target, label]] of requiredHeader.entries()) {
    const configuredItem = byTarget.get(target);
    result.push({
      id: configuredItem?.id ?? `required-header-${index}`,
      label: target === "/organizer"
        ? "Organizer Login"
        : configuredItem?.label ?? label,
      placement: "header",
      sortOrder: (index + 1) * 10,
      target,
    });
  }
  for (const [index, [target, label]] of requiredFooter.entries()) {
    const configuredItem = byTarget.get(target);
    result.push({
      id: configuredItem?.id
        ? `${configuredItem.id}-footer`
        : `required-footer-${index}`,
      label: configuredItem?.label ?? label,
      placement: "footer",
      sortOrder: (index + 1) * 10,
      target,
    });
  }
  const resources = byTarget.get("/resources");
  if (resources) {
    result.push({
      id: resources.id,
      label: resources.label,
      placement: "header",
      sortOrder: 70,
      target: "/resources",
    });
  }
  for (const item of configured) {
    if (
      item.target.startsWith("https://") &&
      !result.some((entry) => entry.target === item.target)
    ) {
      result.push({
        id: item.id,
        label: item.label,
        placement: "footer",
        sortOrder: item.sortOrder,
        target: item.target,
      });
    }
  }
  return Object.freeze(result);
}

function firstPageSummary(
  blocks: readonly Readonly<{ config: unknown }>[],
): string | null {
  for (const block of blocks) {
    if (typeof block.config !== "object" || block.config === null) continue;
    const config = block.config as Record<string, unknown>;
    for (const key of ["text", "heading"] as const) {
      const value = config[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    if (Array.isArray(config.paragraphs)) {
      const paragraph = config.paragraphs.find(
        (value) => typeof value === "string" && value.trim(),
      );
      if (typeof paragraph === "string") return paragraph.trim();
    }
  }
  return null;
}

function communityDestination(
  value: unknown,
):
  | "community_platform"
  | "meetup_discussion"
  | "meetup_group"
  | "other"
  | "resource"
  | "social_profile" {
  return value === "meetup_group" ||
    value === "meetup_discussion" ||
    value === "social_profile" ||
    value === "community_platform" ||
    value === "resource"
    ? value
    : "other";
}

async function deterministicId(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("").slice(0, 40);
}

async function readAdoptionMarker(
  database: D1DatabaseLike,
  organizationId: string,
): Promise<Readonly<{
  adoptionVersion: number;
  sourceFingerprint: string;
}> | null> {
  const row = await database
    .prepare(
      `SELECT adoption_version, source_fingerprint
       FROM cms_adoption_states
       WHERE organization_id = ?
       LIMIT 1`,
    )
    .bind(organizationId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const adoptionVersion = positiveInteger(row.adoption_version);
  const sourceFingerprint = requiredString(row.source_fingerprint);
  if (!/^[a-f0-9]{64}$/u.test(sourceFingerprint)) {
    throw new CmsAdoptionError();
  }
  return Object.freeze({ adoptionVersion, sourceFingerprint });
}

function safeTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CmsAdoptionError();
  }
  return value;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CmsAdoptionError();
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new CmsAdoptionError();
  }
  return value;
}

function nonnegativeInteger(value: unknown): number {
  const parsed = integer(value);
  if (parsed < 0) throw new CmsAdoptionError();
  return parsed;
}

function positiveInteger(value: unknown): number {
  const parsed = integer(value);
  if (parsed < 1) throw new CmsAdoptionError();
  return parsed;
}

function optionalInteger(value: unknown): number | null {
  return value === null ? null : nonnegativeInteger(value);
}
