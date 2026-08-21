import {
  authorizeMembership,
  OrganizerAccessDeniedError,
  type AuthorizedMembership,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import { parseFiniteInteger } from "../../validation";
import {
  PAGE_BLOCK_TYPES,
  type CmsPageSnapshot,
  type PageBlockType,
} from "../organizer/cms-validation";
import { protectedLegalClaimSql } from "../../validation/protected-legal-claims";
import { publicOrganizerEmailExposureSql } from "../../validation/public-organizer-email";
import {
  PUBLIC_CATALOG_CLUBS,
  PUBLIC_CATALOG_LANES,
  PUBLIC_CATALOG_PAGES,
  PUBLIC_COMMUNITY_LINKS,
  PUBLIC_ORGANIZATION_SLUG,
  PUBLIC_SITE_IDENTITY,
} from "./catalog-definitions";
import {
  publicClubProjectionParityD1Sql as publicClubProjectionParitySql,
  publicProgramProjectionParityD1Sql as publicProgramProjectionParitySql,
} from "./cms-projection-contract";
import {
  cmsPageLiveProjectionMatchesReceiptSql,
  cmsReceiptEnvelopeMatchesRevisionSql,
} from "./cms-materialization-contract";
import { isCompatibilityProgramAlias } from "./program-identity";

const MAX_SEED_BATCH_STATEMENTS = 49;
const PUBLIC_CATALOG_VERSION = 1;
const PUBLIC_SECTION_KEYS = [
  "eyebrow",
  "heading",
  "paragraphs",
  "text",
] as const;

export type PublicSiteContextDto = Readonly<{
  brandName: string;
  footerMission: string;
  institutionalFacts: Readonly<{
    attendanceTotal: number | null;
    attendanceTotalAsOf: string | null;
    foundedYear: number | null;
    memberTotal: number | null;
    memberTotalAsOf: string | null;
  }>;
  legalFooter: string | null;
  legalName: string | null;
  locationLabel: string;
  logoAssetId: string | null;
  metaDescription: string | null;
  mission: string;
  openGraphAssetId: string | null;
  palette: Readonly<{
    accent: string;
    background: string;
    foreground: string;
    secondary: string;
  }> | null;
  seoTitle: string | null;
  tagline: string;
  typography: "editorial" | "humanist" | "system";
}>;

export type PublicLaneDto = Readonly<{
  description: string | null;
  name: string;
  slug: string;
}>;

export type PublicClubDto = Readonly<{
  archived: boolean;
  coverAssetId: string | null;
  description: string | null;
  featured: boolean;
  fullDescription: string | null;
  imageAltText: string | null;
  lane: Readonly<{
    name: string;
    slug: string;
  }>;
  name: string;
  metaDescription: string | null;
  openGraphAssetId: string | null;
  participantExpectations: string | null;
  preparationInformation: string | null;
  programType: string | null;
  publicGroupUrl: string | null;
  relatedResources: readonly Readonly<{
    label: string;
    url: string;
  }>[];
  socialLinks: readonly Readonly<{
    label: string;
    url: string;
  }>[];
  seoTitle: string | null;
  slug: string;
  themeColor: string | null;
  thumbnailAssetId: string | null;
  typicalFormat: string | null;
}>;

export type PublicProgramDto = Readonly<{
  archived: boolean;
  coverAssetId: string | null;
  description: string | null;
  featured: boolean;
  fullDescription: string | null;
  lane: Readonly<{
    name: string;
    slug: string;
  }>;
  metaDescription: string | null;
  name: string;
  openGraphAssetId: string | null;
  parentClub: Readonly<{
    name: string;
    slug: string;
  }>;
  participantExpectations: string | null;
  preparationInformation: string | null;
  programType: "circle" | "other" | "program" | "series";
  publicGroupUrl: string | null;
  relatedResources: readonly Readonly<{
    label: string;
    url: string;
  }>[];
  seoTitle: string | null;
  slug: string;
  socialLinks: readonly Readonly<{
    label: string;
    url: string;
  }>[];
  themeColor: string | null;
  thumbnailAssetId: string | null;
  typicalFormat: string | null;
}>;

export type PublicCommunityLinkDto = Readonly<{
  description: string | null;
  label: string;
  linkType: string;
  url: string;
}>;

export type PublicNavigationItemDto = Readonly<{
  href: string;
  label: string;
}>;

export type PublicPageSectionDto = Readonly<{
  content: Readonly<{
    altText?: string;
    assetId?: string;
    caption?: string;
    clubSlugs?: readonly string[];
    eventSlugs?: readonly string[];
    eyebrow?: string;
    heading?: string;
    limit?: number;
    links?: readonly Readonly<{
      description?: string;
      label: string;
      url: string;
    }>[];
    paragraphs?: readonly string[];
    text?: string;
  }>;
  key: string;
  type: string;
}>;

export type PublicPageDto = Readonly<{
  metaDescription: string | null;
  openGraphAssetId: string | null;
  sections: readonly PublicPageSectionDto[];
  seoTitle: string | null;
  slug: string;
  title: string;
}>;

export type PublicCatalogDto = Readonly<{
  clubs: readonly PublicClubDto[];
  communityLinks: readonly PublicCommunityLinkDto[];
  lanes: readonly PublicLaneDto[];
  navigation: Readonly<{
    footer: readonly PublicNavigationItemDto[];
    header: readonly PublicNavigationItemDto[];
  }>;
  site: PublicSiteContextDto;
}>;

export type PublicOrganizationContext = Readonly<{
  id: string;
  timeZone: string;
}>;

export function buildPublicPagePreviewDto(
  snapshot: CmsPageSnapshot,
): PublicPageDto {
  return Object.freeze({
    metaDescription: publicBoundedText(snapshot.metaDescription, 160),
    openGraphAssetId: publicIdentifier(snapshot.openGraphAssetId),
    sections: Object.freeze(
      snapshot.blocks.flatMap((block, index) => {
        const content = publicSectionContent(
          JSON.stringify(block.config),
          block.type,
        );
        return content
          ? [
              Object.freeze({
                content,
                key: `${block.type}-${index + 1}`,
                type: block.type,
              }),
            ]
          : [];
      }),
    ),
    seoTitle: publicBoundedText(snapshot.seoTitle, 60),
    slug: snapshot.slug,
    title: snapshot.title,
  });
}

/**
 * Creates the owner-approved public catalog from an authenticated server path.
 * Inserts are deliberately one-time or fill-only, so a later CMS edit is not
 * reverted when an Owner or Administrator revisits the organizer portal.
 */
export async function ensurePublicCatalog(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  nowUtcMs = Date.now(),
): Promise<void> {
  await ensurePublicCatalogAndAuthorize(database, identity, nowUtcMs);
}

/**
 * Server-internal authorization envelope for callers that need the exact live
 * actor after catalog initialization. No actor object can enter from a request:
 * this function always resolves it from the trusted Sites identity itself.
 */
export async function ensurePublicCatalogAndAuthorize(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  nowUtcMs = Date.now(),
): Promise<AuthorizedMembership> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  await ensurePublicCatalogForAuthorizedActor(database, actor, nowUtcMs);
  return actor;
}

/**
 * Private continuation reachable only after this module's live authorization
 * envelope. The role assertion remains as defense in depth.
 */
async function ensurePublicCatalogForAuthorizedActor(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  nowUtcMs = Date.now(),
): Promise<void> {
  if (actor.role !== "owner" && actor.role !== "administrator") {
    throw new OrganizerAccessDeniedError("role_not_allowed");
  }
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const catalogState = await database
    .prepare(
      `SELECT (
         SELECT setting.value_json
         FROM site_settings AS setting
         WHERE setting.organization_id = ?
           AND setting.key = 'public_catalog_version'
         LIMIT 1
       ) AS value_json,
       COALESCE((
         SELECT json_group_array(lane.slug)
         FROM event_lanes AS lane
         WHERE lane.organization_id = ?
           AND lane.slug IN (?, ?, ?, ?)
       ), '[]') AS lane_slugs_json`,
    )
    .bind(
      actor.organizationId,
      actor.organizationId,
      ...PUBLIC_CATALOG_LANES.map((lane) => lane.slug),
    )
    .first<Record<string, unknown>>();
  if (catalogState?.value_json === JSON.stringify(PUBLIC_CATALOG_VERSION)) {
    return;
  }
  const existingLaneSlugs = new Set(
    publicStringArray(catalogState?.lane_slugs_json),
  );
  const missingLanes = PUBLIC_CATALOG_LANES.filter(
    (lane) => !existingLaneSlugs.has(lane.slug),
  );
  if (missingLanes.length > 0) {
    await createPublicCatalogLanesWithTaxonomyProtocol(
      database,
      actor,
      missingLanes,
      now,
    );
  }

  const clubIdentityPayload = JSON.stringify(
    PUBLIC_CATALOG_CLUBS.map((club) => ({
      description: club.description,
      id: crypto.randomUUID(),
      name: club.name,
      slug: club.slug,
    })),
  );
  const pageIdentityPayload = JSON.stringify(
    PUBLIC_CATALOG_PAGES.map((page) => ({
      id: crypto.randomUUID(),
      slug: page.slug,
      title: page.title,
    })),
  );
  const clubProfilePayload = JSON.stringify(
    PUBLIC_CATALOG_CLUBS.map((club) => ({
      description: club.description,
      featured: club.featured ? 1 : 0,
      laneSlug: club.laneSlug,
      publicGroupUrl: club.publicGroupUrl,
      publicationStatus: club.publicationStatus,
      publishedAt: club.publicationStatus === "published" ? now : null,
      slug: club.slug,
    })),
  );
  const pageSectionPayload = JSON.stringify(
    PUBLIC_CATALOG_PAGES.flatMap((page) =>
      page.sections.map((section) => ({
        contentJson: JSON.stringify(section.content),
        id: crypto.randomUUID(),
        pageSlug: page.slug,
        sectionKey: section.key,
        sectionType: section.type,
        sortOrder: section.sortOrder,
      })),
    ),
  );
  const communityLinkPayload = JSON.stringify(
    PUBLIC_COMMUNITY_LINKS.map((link) => ({
      id: crypto.randomUUID(),
      label: link.label,
      linkType: link.linkType,
      sortOrder: link.sortOrder,
      url: link.url,
    })),
  );
  const identityStatements = [
    database
      .prepare(
        `INSERT INTO clubs (
           id, organization_id, name, slug, description,
           created_by_profile_id, created_at, updated_at, deleted_at
         )
         SELECT json_extract(item.value, '$.id'), ?,
                json_extract(item.value, '$.name'),
                json_extract(item.value, '$.slug'),
                json_extract(item.value, '$.description'),
                ?, ?, ?, NULL
         FROM json_each(?) AS item
         WHERE 1
         ON CONFLICT(organization_id, slug) DO NOTHING`,
      )
      .bind(
        actor.organizationId,
        actor.profileId,
        now,
        now,
        clubIdentityPayload,
      ),
    database
      .prepare(
        `INSERT INTO pages (
           id, organization_id, title, slug, status, visibility,
           current_revision, published_at, created_by_profile_id,
           updated_by_profile_id, created_at, updated_at, deleted_at
         )
         SELECT json_extract(item.value, '$.id'), ?,
                json_extract(item.value, '$.title'),
                json_extract(item.value, '$.slug'),
                'published', 'public', 1, ?, ?, ?, ?, ?, NULL
         FROM json_each(?) AS item
         WHERE 1
         ON CONFLICT(organization_id, slug) DO NOTHING`,
      )
      .bind(
        actor.organizationId,
        now,
        actor.profileId,
        actor.profileId,
        now,
        now,
        pageIdentityPayload,
      ),
  ];
  const contentStatements = [
    database
      .prepare(
        `INSERT INTO club_public_profiles (
           club_id, organization_id, primary_event_lane_id,
           publication_status, is_featured, description, public_group_url,
           published_at, created_at, updated_at, deleted_at
         )
         SELECT club.id, club.organization_id, lane.id,
                json_extract(item.value, '$.publicationStatus'),
                CAST(json_extract(item.value, '$.featured') AS INTEGER),
                json_extract(item.value, '$.description'),
                json_extract(item.value, '$.publicGroupUrl'),
                json_extract(item.value, '$.publishedAt'), ?, ?, NULL
         FROM json_each(?) AS item
         JOIN clubs AS club
           ON club.organization_id = ?
          AND club.slug = json_extract(item.value, '$.slug')
         JOIN event_lanes AS lane
           ON lane.organization_id = club.organization_id
          AND lane.slug = json_extract(item.value, '$.laneSlug')
         WHERE 1
         ON CONFLICT(club_id) DO NOTHING`,
      )
      .bind(now, now, clubProfilePayload, actor.organizationId),
    database
      .prepare(
        `INSERT INTO page_sections (
           id, organization_id, page_id, section_key, section_type,
           content_json, sort_order, created_at, updated_at, deleted_at
         )
         SELECT json_extract(item.value, '$.id'), page.organization_id, page.id,
                json_extract(item.value, '$.sectionKey'),
                json_extract(item.value, '$.sectionType'),
                json_extract(item.value, '$.contentJson'),
                CAST(json_extract(item.value, '$.sortOrder') AS INTEGER),
                ?, ?, NULL
         FROM json_each(?) AS item
         JOIN pages AS page
           ON page.organization_id = ?
          AND page.slug = json_extract(item.value, '$.pageSlug')
         WHERE 1
         ON CONFLICT(page_id, section_key) DO NOTHING`,
      )
      .bind(now, now, pageSectionPayload, actor.organizationId),
    database
      .prepare(
        `INSERT INTO site_settings (
           id, organization_id, key, value_json, is_public,
           updated_by_profile_id, created_at, updated_at
         ) VALUES (?, ?, 'public_identity', ?, 1, ?, ?, ?)
         ON CONFLICT(organization_id, key) DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        JSON.stringify(PUBLIC_SITE_IDENTITY),
        actor.profileId,
        now,
        now,
      ),
    database
      .prepare(
        `INSERT INTO community_links (
           id, organization_id, label, url, link_type, is_published,
           sort_order, created_by_profile_id, created_at, updated_at,
           deleted_at
         )
         SELECT json_extract(item.value, '$.id'), ?,
                json_extract(item.value, '$.label'),
                json_extract(item.value, '$.url'),
                json_extract(item.value, '$.linkType'), 1,
                CAST(json_extract(item.value, '$.sortOrder') AS INTEGER),
                ?, ?, ?, NULL
         FROM json_each(?) AS item
         WHERE 1
         ON CONFLICT(organization_id, url) DO NOTHING`,
      )
      .bind(
        actor.organizationId,
        actor.profileId,
        now,
        now,
        communityLinkPayload,
      ),
    database
      .prepare(
        `INSERT INTO site_settings (
           id, organization_id, key, value_json, is_public,
           updated_by_profile_id, created_at, updated_at
         ) VALUES (?, ?, 'public_catalog_version', ?, 0, ?, ?, ?)
         ON CONFLICT(organization_id, key) DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        JSON.stringify(PUBLIC_CATALOG_VERSION),
        actor.profileId,
        now,
        now,
      ),
  ];
  await runBoundedBatch(database, [
    ...identityStatements,
    ...contentStatements,
  ]);
}

async function createPublicCatalogLanesWithTaxonomyProtocol(
  database: D1DatabaseLike,
  actor: Readonly<{
    organizationId: string;
    profileId: string;
  }>,
  lanes: typeof PUBLIC_CATALOG_LANES,
  now: number,
): Promise<void> {
  const payload = JSON.stringify(
    lanes.map((lane) => ({
      auditId: crypto.randomUUID(),
      id: crypto.randomUUID(),
      intentId: crypto.randomUUID(),
      ...lane,
    })),
  );
  const statements = [
    database
      .prepare(
        `INSERT INTO taxonomy_write_intents (
           id, organization_id, entity_type, entity_id, operation,
           expected_content_version, proposed_content_version,
           proposed_name, proposed_slug, proposed_description,
           proposed_color_token, proposed_sort_order,
           proposed_deleted_at, mutation_group_id, mutation_group_size,
           actor_profile_id, created_at, completed_at
         )
         SELECT json_extract(item.value, '$.intentId'),
                ?, 'lane', json_extract(item.value, '$.id'), 'create',
                0, 1, json_extract(item.value, '$.name'),
                json_extract(item.value, '$.slug'),
                json_extract(item.value, '$.description'), NULL,
                CAST(json_extract(item.value, '$.sortOrder') AS INTEGER),
                NULL, NULL, NULL, ?, ?, NULL
         FROM json_each(?) AS item`,
      )
      .bind(actor.organizationId, actor.profileId, now, payload),
    database
      .prepare(
        `INSERT INTO event_lanes (
           id, organization_id, name, slug, description, sort_order,
           created_by_profile_id, created_at, updated_at, deleted_at
         )
         SELECT json_extract(item.value, '$.id'), ?,
                json_extract(item.value, '$.name'),
                json_extract(item.value, '$.slug'),
                json_extract(item.value, '$.description'),
                CAST(json_extract(item.value, '$.sortOrder') AS INTEGER),
                ?, ?, ?, NULL
         FROM json_each(?) AS item`,
      )
      .bind(actor.organizationId, actor.profileId, now, now, payload),
    database
      .prepare(
        `INSERT INTO event_lane_taxonomy_states (
           lane_id, organization_id, content_version,
           active_intent_id, last_completed_intent_id,
           updated_by_profile_id, created_at, updated_at
         )
         SELECT json_extract(item.value, '$.id'), ?, 1,
                json_extract(item.value, '$.intentId'), NULL, ?, ?, ?
         FROM json_each(?) AS item`,
      )
      .bind(actor.organizationId, actor.profileId, now, now, payload),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         )
         SELECT json_extract(item.value, '$.auditId'), ?, ?,
                'taxonomy.lane_created', 'event_lane',
                json_extract(item.value, '$.id'),
                json_object(
                  'source', 'public_catalog_fill_only',
                  'writeIntentId',
                  json_extract(item.value, '$.intentId')
                ),
                ?
         FROM json_each(?) AS item`,
      )
      .bind(actor.organizationId, actor.profileId, now, payload),
    database
      .prepare(
        `UPDATE event_lane_taxonomy_states
         SET active_intent_id = NULL,
             last_completed_intent_id = (
               SELECT json_extract(item.value, '$.intentId')
               FROM json_each(?) AS item
               WHERE json_extract(item.value, '$.id') =
                     event_lane_taxonomy_states.lane_id
             ),
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE organization_id = ?
           AND EXISTS (
             SELECT 1
             FROM json_each(?) AS item
             WHERE json_extract(item.value, '$.id') =
                   event_lane_taxonomy_states.lane_id
               AND json_extract(item.value, '$.intentId') =
                   event_lane_taxonomy_states.active_intent_id
           )`,
      )
      .bind(
        payload,
        actor.profileId,
        now,
        actor.organizationId,
        payload,
      ),
    database
      .prepare(
        `UPDATE taxonomy_write_intents
         SET completed_at = ?
         WHERE organization_id = ?
           AND entity_type = 'lane'
           AND operation = 'create'
           AND completed_at IS NULL
           AND id IN (
             SELECT json_extract(item.value, '$.intentId')
             FROM json_each(?) AS item
           )`,
      )
      .bind(now, actor.organizationId, payload),
  ];
  let results: Awaited<ReturnType<D1DatabaseLike["batch"]>>;
  try {
    results = await database.batch(statements);
  } catch (error) {
    if (
      await hasCompletedPublicCatalogLaneSeed(
        database,
        actor.organizationId,
        lanes,
      )
    ) {
      return;
    }
    throw error;
  }
  const [intentResult, ...remainingResults] = results;
  const intentChanges = intentResult
    ? readCatalogStatementChanges(intentResult)
    : -1;
  if (
    results.some((result) => result.success === false) ||
    (
      intentChanges !== lanes.length &&
      intentChanges !== lanes.length + 1
    ) ||
    remainingResults.some(
      (result) => readCatalogStatementChanges(result) !== lanes.length,
    ) ||
    !(await hasCompletedPublicCatalogLaneSeed(
      database,
      actor.organizationId,
      lanes,
    ))
  ) {
    throw new Error("D1 rejected the public catalog taxonomy seed.");
  }
}

async function hasCompletedPublicCatalogLaneSeed(
  database: Pick<D1DatabaseLike, "prepare">,
  organizationId: string,
  lanes: typeof PUBLIC_CATALOG_LANES,
): Promise<boolean> {
  const laneDefinitionsJson = JSON.stringify(lanes);
  const row = await database
    .prepare(
      `SELECT count(*) AS exact_count
       FROM json_each(?) AS expected_lane
       JOIN event_lanes AS lane
         ON lane.organization_id = ?
        AND lane.name = json_extract(expected_lane.value, '$.name')
        AND lane.slug = json_extract(expected_lane.value, '$.slug')
        AND lane.description =
            json_extract(expected_lane.value, '$.description')
        AND lane.sort_order =
            CAST(json_extract(expected_lane.value, '$.sortOrder') AS INTEGER)
        AND lane.deleted_at IS NULL
       JOIN event_lane_taxonomy_states AS state
         ON state.lane_id = lane.id
        AND state.organization_id = lane.organization_id
        AND state.content_version = 1
        AND state.active_intent_id IS NULL
        AND state.last_completed_intent_id IS NOT NULL
       JOIN taxonomy_write_intents AS intent
         ON intent.id = state.last_completed_intent_id
        AND intent.organization_id = lane.organization_id
        AND intent.entity_type = 'lane'
        AND intent.entity_id = lane.id
        AND intent.operation = 'create'
        AND intent.expected_content_version = 0
        AND intent.proposed_content_version = 1
        AND intent.proposed_name = lane.name
        AND intent.proposed_slug = lane.slug
        AND intent.proposed_description IS lane.description
        AND intent.proposed_color_token IS NULL
        AND intent.proposed_sort_order = lane.sort_order
        AND intent.proposed_deleted_at IS NULL
        AND intent.mutation_group_id IS NULL
        AND intent.mutation_group_size IS NULL
        AND intent.completed_at IS NOT NULL
       WHERE (
         SELECT count(*)
         FROM audit_logs AS audit
         WHERE audit.organization_id = lane.organization_id
           AND audit.action = 'taxonomy.lane_created'
           AND audit.entity_type = 'event_lane'
           AND audit.entity_id = lane.id
           AND audit.actor_profile_id = intent.actor_profile_id
           AND json_extract(
                 audit.metadata_json,
                 '$.source'
               ) = 'public_catalog_fill_only'
           AND json_extract(
                 audit.metadata_json,
                 '$.writeIntentId'
               ) = intent.id
       ) = 1
         AND NOT EXISTS (
           SELECT 1
           FROM taxonomy_write_intents AS open_intent
           WHERE open_intent.organization_id = lane.organization_id
             AND open_intent.entity_type = 'lane'
             AND open_intent.entity_id = lane.id
             AND open_intent.completed_at IS NULL
         )`,
    )
    .bind(laneDefinitionsJson, organizationId)
    .first<Record<string, unknown>>();
  return row?.exact_count === lanes.length;
}

export async function resolvePublicOrganization(
  database: Pick<D1DatabaseLike, "prepare">,
): Promise<PublicOrganizationContext | null> {
  const row = await database
    .prepare(
      `SELECT id, timezone
       FROM organizations
       WHERE slug = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(PUBLIC_ORGANIZATION_SLUG)
    .first<Record<string, unknown>>();
  const id = publicIdentifier(row?.id);
  const timeZone = publicText(row?.timezone);
  return id && timeZone
    ? Object.freeze({ id, timeZone })
    : null;
}

export async function getPublicSiteContext(
  database: Pick<D1DatabaseLike, "prepare">,
): Promise<PublicSiteContextDto | null> {
  const row = await database
    .prepare(
      `SELECT identity_setting.value_json AS identity_json,
              CASE
                WHEN legal_setting.id IS NOT NULL
                 AND EXISTS (
                   SELECT 1
                   FROM cms_entity_publication_states AS legal_state
                   JOIN cms_entity_revisions AS legal_revision
                     ON legal_revision.id =
                        legal_state.published_revision_id
                    AND legal_revision.organization_id =
                        legal_state.organization_id
                    AND legal_revision.publication_state_id =
                        legal_state.id
                   JOIN legal_status_confirmation_receipts AS confirmation
                     ON confirmation.organization_id =
                        legal_state.organization_id
                    AND confirmation.revision_id = legal_revision.id
                   AND confirmation.revision_hash =
                        legal_revision.content_hash
                   AND confirmation.action = 'confirmed'
                  JOIN cms_public_materialization_receipts AS legal_receipt
                    ON legal_receipt.organization_id =
                       legal_state.organization_id
                   AND legal_receipt.publication_state_id = legal_state.id
                   AND legal_receipt.entity_type = 'legal_status'
                   AND legal_receipt.entity_key = 'legal_status'
                   AND legal_receipt.revision_id = legal_revision.id
                   AND legal_receipt.revision_hash =
                       legal_revision.content_hash
                   AND ${cmsReceiptEnvelopeMatchesRevisionSql(
                     "legal_receipt",
                     "legal_revision",
                   )}
                   AND json_extract(
                         legal_receipt.projection_json,
                         '$.setting.key'
                       ) = 'public_legal_status'
                   AND json_extract(
                         legal_receipt.projection_json,
                         '$.setting.valueJson'
                       ) = legal_setting.value_json
                   WHERE legal_state.organization_id = organization.id
                     AND legal_state.entity_type = 'legal_status'
                     AND legal_state.entity_key = 'legal_status'
                     AND legal_state.workflow_status = 'published'
                     AND legal_revision.entity_type = 'legal_status'
                     AND legal_revision.entity_key = 'legal_status'
                     AND legal_setting.value_json =
                         legal_revision.snapshot_json
                     AND NOT EXISTS (
                       SELECT 1
                       FROM legal_status_confirmation_receipts AS revocation
                       WHERE revocation.organization_id =
                             confirmation.organization_id
                         AND revocation.action = 'revoked'
                         AND revocation.revokes_receipt_id = confirmation.id
                     )
                 )
                THEN legal_setting.value_json
                ELSE NULL
              END AS legal_json
       FROM organizations AS organization
       JOIN site_settings AS identity_setting
         ON identity_setting.organization_id = organization.id
        AND identity_setting.key = 'public_identity'
        AND identity_setting.is_public = 1
       JOIN cms_entity_publication_states AS identity_state
         ON identity_state.organization_id = organization.id
        AND identity_state.entity_type = 'site_identity'
        AND identity_state.entity_key = 'site_identity'
        AND identity_state.workflow_status = 'published'
        AND identity_state.published_revision_id IS NOT NULL
       JOIN cms_entity_revisions AS identity_revision
         ON identity_revision.id = identity_state.published_revision_id
        AND identity_revision.organization_id =
            identity_state.organization_id
        AND identity_revision.publication_state_id = identity_state.id
        AND identity_revision.entity_type = 'site_identity'
        AND identity_revision.entity_key = 'site_identity'
       JOIN cms_public_materialization_receipts AS identity_receipt
         ON identity_receipt.organization_id = organization.id
        AND identity_receipt.publication_state_id = identity_state.id
        AND identity_receipt.entity_type = 'site_identity'
        AND identity_receipt.entity_key = 'site_identity'
        AND identity_receipt.revision_id = identity_revision.id
        AND identity_receipt.revision_hash = identity_revision.content_hash
        AND ${cmsReceiptEnvelopeMatchesRevisionSql(
          "identity_receipt",
          "identity_revision",
        )}
        AND json_extract(
              identity_receipt.projection_json,
              '$.setting.key'
            ) = 'public_identity'
        AND json_extract(
              identity_receipt.projection_json,
              '$.setting.valueJson'
            ) = identity_setting.value_json
        AND identity_setting.value_json = identity_revision.snapshot_json
        AND json_valid(identity_setting.value_json)
       LEFT JOIN site_settings AS legal_setting
         ON legal_setting.organization_id = organization.id
        AND legal_setting.key = 'public_legal_status'
        AND legal_setting.is_public = 1
       WHERE organization.slug = ?
         AND organization.deleted_at IS NULL
         AND NOT (${protectedLegalClaimSql([
           "identity_receipt.projection_json",
         ])})
         AND NOT (${publicOrganizerEmailExposureSql(
           ["identity_receipt.projection_json"],
           "organization.id",
         )})
       LIMIT 1`,
    )
    .bind(PUBLIC_ORGANIZATION_SLUG)
    .first<Record<string, unknown>>();
  const value = parseJsonRecord(row?.identity_json);
  if (!value) return null;
  const legalValue = parseJsonRecord(row?.legal_json);
  const brandName = publicText(value.brandName);
  const locationLabel = publicText(value.locationLabel);
  const mission = publicText(value.mission);
  const tagline = publicText(value.tagline);
  if (!brandName || !locationLabel || !mission || !tagline) return null;
  const footerMission =
    publicBoundedText(value.footerMission, 1_000) ?? mission;
  const institutionalFacts = publicInstitutionalFacts(
    value.institutionalFacts,
  );
  const legalFooter = publicBoundedText(legalValue?.footerWording, 500);
  const legalName = publicBoundedText(legalValue?.legalName, 240);
  const seoTitle = publicBoundedText(value.seoTitle, 60);
  const metaDescription = publicBoundedText(value.metaDescription, 160);
  const logoAssetId = publicIdentifier(value.logoAssetId);
  const openGraphAssetId = publicIdentifier(value.openGraphAssetId);
  const typography =
    value.typography === "humanist" || value.typography === "system"
      ? value.typography
      : "editorial";
  const palette = publicPalette(value.palette);
  return Object.freeze({
    brandName,
    footerMission,
    institutionalFacts,
    legalFooter,
    legalName,
    locationLabel,
    logoAssetId,
    metaDescription,
    mission,
    openGraphAssetId,
    palette,
    seoTitle,
    tagline,
    typography,
  });
}

function publicInstitutionalFacts(
  value: unknown,
): PublicSiteContextDto["institutionalFacts"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return Object.freeze({
      attendanceTotal: null,
      attendanceTotalAsOf: null,
      foundedYear: null,
      memberTotal: null,
      memberTotalAsOf: null,
    });
  }
  const facts = value as Record<string, unknown>;
  const attendanceTotal =
    facts.attendanceTotalConfirmed === true
      ? publicWholeNumber(facts.attendanceTotal, 100_000_000)
      : null;
  const attendanceTotalAsOf =
    attendanceTotal !== null
      ? publicCalendarDate(facts.attendanceTotalAsOf)
      : null;
  const foundedYear =
    facts.foundedYearConfirmed === true
      ? publicWholeNumber(facts.foundedYear, 9_999, 1_800)
      : null;
  const memberTotal =
    facts.memberTotalConfirmed === true
      ? publicWholeNumber(facts.memberTotal, 100_000_000)
      : null;
  const memberTotalAsOf =
    memberTotal !== null ? publicCalendarDate(facts.memberTotalAsOf) : null;
  return Object.freeze({
    attendanceTotal:
      attendanceTotalAsOf === null ? null : attendanceTotal,
    attendanceTotalAsOf,
    foundedYear,
    memberTotal: memberTotalAsOf === null ? null : memberTotal,
    memberTotalAsOf,
  });
}

function publicWholeNumber(
  value: unknown,
  maximum: number,
  minimum = 0,
): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

function publicCalendarDate(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value)
  ) {
    return null;
  }
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

export async function listPublicLanes(
  database: Pick<D1DatabaseLike, "prepare">,
): Promise<readonly PublicLaneDto[]> {
  const result = await database
    .prepare(
      `SELECT lane.name, lane.slug, lane.description
       FROM event_lanes AS lane
       JOIN organizations AS organization
         ON organization.id = lane.organization_id
       WHERE organization.slug = ?
         AND organization.deleted_at IS NULL
         AND lane.deleted_at IS NULL
         AND lane.slug IN (?, ?, ?, ?)
       ORDER BY lane.sort_order ASC, lane.name ASC`,
    )
    .bind(
      PUBLIC_ORGANIZATION_SLUG,
      ...PUBLIC_CATALOG_LANES.map((lane) => lane.slug),
    )
    .all<Record<string, unknown>>();
  return Object.freeze(
    (result.results ?? []).flatMap((row) => {
      const name = publicText(row.name);
      const slug = publicSlug(row.slug);
      if (!name || !slug) return [];
      return [
        Object.freeze({
          description: publicOptionalText(row.description),
          name,
          slug,
        }),
      ];
    }),
  );
}

export async function listPublicClubs(
  database: Pick<D1DatabaseLike, "prepare">,
): Promise<readonly PublicClubDto[]> {
  const result = await database
    .prepare(
      `${PUBLIC_CLUB_SELECT_SQL}
       AND profile.publication_status = 'published'
       ORDER BY profile.is_featured DESC,
                display_order ASC,
                club.name COLLATE NOCASE ASC,
                club.id ASC`,
    )
    .bind(PUBLIC_ORGANIZATION_SLUG)
    .all<Record<string, unknown>>();
  return Object.freeze((result.results ?? []).flatMap(toPublicClub));
}

export async function getPublicClubBySlug(
  database: Pick<D1DatabaseLike, "prepare">,
  slug: string,
): Promise<PublicClubDto | null> {
  const parsedSlug = publicSlug(slug);
  if (!parsedSlug) return null;
  const row = await database
    .prepare(`${PUBLIC_CLUB_SELECT_SQL} AND club.slug = ? LIMIT 1`)
    .bind(PUBLIC_ORGANIZATION_SLUG, parsedSlug)
    .first<Record<string, unknown>>();
  return row ? (toPublicClub(row)[0] ?? null) : null;
}

export async function listPublicProgramsForClub(
  database: Pick<D1DatabaseLike, "prepare">,
  clubSlug: string,
): Promise<readonly PublicProgramDto[]> {
  const parsedClubSlug = publicSlug(clubSlug);
  if (!parsedClubSlug) return Object.freeze([]);
  const result = await database
    .prepare(
      `${PUBLIC_PROGRAM_SELECT_SQL}
       AND parent_club.slug = ?
       AND parent_profile.publication_status = 'published'
       AND details.publication_status = 'published'
       ORDER BY details.is_featured DESC,
                details.display_order ASC,
                details.public_display_name COLLATE NOCASE ASC,
                details.program_id ASC`,
    )
    .bind(PUBLIC_ORGANIZATION_SLUG, parsedClubSlug)
    .all<Record<string, unknown>>();
  return Object.freeze(
    (result.results ?? [])
      .flatMap(toPublicProgram)
      .filter((program) => !isCompatibilityProgramAlias(program)),
  );
}

export async function listPublicProgramsForClubs(
  database: Pick<D1DatabaseLike, "prepare">,
  clubSlugs: readonly string[],
): Promise<readonly PublicProgramDto[]> {
  const parsedClubSlugs = [
    ...new Set(
      clubSlugs.flatMap((slug) => {
        const parsed = publicSlug(slug);
        return parsed ? [parsed] : [];
      }),
    ),
  ].slice(0, 12);
  if (parsedClubSlugs.length === 0) return Object.freeze([]);
  const result = await database
    .prepare(
      `${PUBLIC_PROGRAM_SELECT_SQL}
       AND parent_club.slug IN (${parsedClubSlugs.map(() => "?").join(", ")})
       AND parent_profile.publication_status = 'published'
       AND details.publication_status = 'published'
       ORDER BY parent_club.name COLLATE NOCASE ASC,
                details.is_featured DESC,
                details.display_order ASC,
                details.public_display_name COLLATE NOCASE ASC,
                details.program_id ASC`,
    )
    .bind(PUBLIC_ORGANIZATION_SLUG, ...parsedClubSlugs)
    .all<Record<string, unknown>>();
  return Object.freeze(
    (result.results ?? [])
      .flatMap(toPublicProgram)
      .filter((program) => !isCompatibilityProgramAlias(program)),
  );
}

export async function getPublicProgramBySlugs(
  database: Pick<D1DatabaseLike, "prepare">,
  clubSlug: string,
  programSlug: string,
): Promise<PublicProgramDto | null> {
  const parsedClubSlug = publicSlug(clubSlug);
  const parsedProgramSlug = publicSlug(programSlug);
  if (!parsedClubSlug || !parsedProgramSlug) return null;
  const row = await database
    .prepare(
      `${PUBLIC_PROGRAM_SELECT_SQL}
       AND parent_club.slug = ?
       AND details.public_slug = ?
       LIMIT 1`,
    )
    .bind(
      PUBLIC_ORGANIZATION_SLUG,
      parsedClubSlug,
      parsedProgramSlug,
    )
    .first<Record<string, unknown>>();
  return row ? (toPublicProgram(row)[0] ?? null) : null;
}

export async function getPublicSlugRedirect(
  database: Pick<D1DatabaseLike, "prepare">,
  input: Readonly<{
    entityType: "club_public_profile" | "page" | "program_public_profile";
    fromSlug: string;
  }>,
): Promise<string | null> {
  const fromSlug = publicSlug(input.fromSlug);
  if (!fromSlug) return null;
  const row = await database
    .prepare(
      `SELECT redirect.to_slug
       FROM public_slug_redirects AS redirect
       JOIN organizations AS organization
         ON organization.id = redirect.organization_id
       WHERE organization.slug = ?
         AND organization.deleted_at IS NULL
         AND redirect.entity_type = ?
         AND redirect.from_slug = ?
         AND redirect.state = 'active'
         AND (
           (
             redirect.entity_type = 'page'
             AND EXISTS (
               SELECT 1
               FROM pages AS target_page
               JOIN cms_entity_publication_states AS target_state
                 ON target_state.organization_id =
                    target_page.organization_id
                AND target_state.entity_type = 'page'
                AND target_state.entity_key = target_page.id
                AND target_state.workflow_status = 'published'
                AND target_state.published_revision_id IS NOT NULL
               JOIN cms_entity_revisions AS target_revision
                 ON target_revision.id =
                    target_state.published_revision_id
                AND target_revision.organization_id =
                    target_state.organization_id
                AND target_revision.publication_state_id = target_state.id
                AND target_revision.entity_type = 'page'
                AND target_revision.entity_key = target_page.id
               JOIN cms_public_materialization_receipts
                 AS target_receipt
                 ON target_receipt.organization_id =
                    target_state.organization_id
                AND target_receipt.publication_state_id = target_state.id
                AND target_receipt.entity_type = 'page'
                AND target_receipt.entity_key = target_page.id
                AND target_receipt.revision_id = target_revision.id
                AND target_receipt.revision_hash =
                    target_revision.content_hash
                AND ${cmsReceiptEnvelopeMatchesRevisionSql(
                  "target_receipt",
                  "target_revision",
                )}
               WHERE target_page.organization_id =
                     redirect.organization_id
                 AND target_page.id = redirect.entity_id
                 AND target_page.slug = redirect.to_slug
                 AND target_page.status = 'published'
                 AND target_page.visibility = 'public'
                 AND target_page.published_at IS NOT NULL
                 AND target_page.deleted_at IS NULL
                 AND ${cmsPageLiveProjectionMatchesReceiptSql(
                   "target_page",
                   "target_receipt",
                 )}
             )
           )
           OR (
             redirect.entity_type = 'club_public_profile'
             AND EXISTS (
               SELECT 1
               FROM clubs AS target_club
               JOIN club_public_profiles AS target_profile
                 ON target_profile.club_id = target_club.id
                AND target_profile.organization_id =
                    target_club.organization_id
                AND target_profile.publication_status = 'published'
                AND target_profile.published_at IS NOT NULL
                AND target_profile.deleted_at IS NULL
               JOIN cms_entity_publication_states AS target_state
                 ON target_state.organization_id =
                    target_club.organization_id
                AND target_state.entity_type = 'club_public_profile'
                AND target_state.entity_key = target_club.id
                AND target_state.workflow_status = 'published'
                AND target_state.published_revision_id IS NOT NULL
               WHERE target_club.organization_id =
                     redirect.organization_id
                 AND target_club.id = redirect.entity_id
                 AND target_club.slug = redirect.to_slug
                 AND target_club.deleted_at IS NULL
                 AND ${publicClubProjectionParitySql("target_profile")}
             )
           )
           OR (
             redirect.entity_type = 'program_public_profile'
             AND EXISTS (
               SELECT 1
               FROM program_public_profile_details AS target_program
               JOIN programs AS program
                 ON program.id = target_program.program_id
                AND program.organization_id =
                    target_program.organization_id
                AND program.club_id = target_program.club_id
                AND program.deleted_at IS NULL
               JOIN club_public_profiles AS target_club_profile
                 ON target_club_profile.club_id = program.club_id
                AND target_club_profile.organization_id =
                    program.organization_id
                AND target_club_profile.publication_status = 'published'
                AND target_club_profile.published_at IS NOT NULL
                AND target_club_profile.deleted_at IS NULL
               JOIN cms_entity_publication_states AS target_state
                 ON target_state.organization_id =
                    target_program.organization_id
                AND target_state.entity_type = 'program_public_profile'
                AND target_state.entity_key = target_program.program_id
                AND target_state.workflow_status = 'published'
                AND target_state.published_revision_id IS NOT NULL
               WHERE target_program.organization_id =
                     redirect.organization_id
                 AND target_program.program_id = redirect.entity_id
                 AND target_program.public_slug = redirect.to_slug
                 AND target_program.publication_status = 'published'
                 AND target_program.published_at IS NOT NULL
                 AND target_program.deleted_at IS NULL
                 AND ${publicProgramProjectionParitySql("target_program")}
             )
           )
         )
       LIMIT 1`,
    )
    .bind(PUBLIC_ORGANIZATION_SLUG, input.entityType, fromSlug)
    .first<Record<string, unknown>>();
  return publicSlug(row?.to_slug);
}

export async function listPublicCommunityLinks(
  database: Pick<D1DatabaseLike, "prepare">,
): Promise<readonly PublicCommunityLinkDto[]> {
  const result = await database
    .prepare(
      `SELECT link.label, link.url, link.link_type,
              details.description,
              details.destination_type
       FROM community_links AS link
       JOIN organizations AS organization
         ON organization.id = link.organization_id
       JOIN community_link_public_details AS details
         ON details.community_link_id = link.id
        AND details.organization_id = link.organization_id
        AND details.confirmed_at > 0
       JOIN cms_entity_publication_states AS state
         ON state.organization_id = link.organization_id
        AND state.entity_type = 'community_link'
        AND state.entity_key = link.id
        AND state.workflow_status = 'published'
        AND state.published_revision_id IS NOT NULL
       JOIN cms_entity_revisions AS revision
         ON revision.id = state.published_revision_id
        AND revision.organization_id = state.organization_id
        AND revision.publication_state_id = state.id
        AND revision.entity_type = state.entity_type
        AND revision.entity_key = state.entity_key
       JOIN cms_public_materialization_receipts AS materialization
         ON materialization.organization_id = state.organization_id
        AND materialization.publication_state_id = state.id
        AND materialization.entity_type = state.entity_type
        AND materialization.entity_key = state.entity_key
        AND materialization.revision_id = revision.id
        AND materialization.revision_hash = revision.content_hash
        AND ${cmsReceiptEnvelopeMatchesRevisionSql(
          "materialization",
          "revision",
        )}
       WHERE organization.slug = ?
         AND organization.deleted_at IS NULL
         AND link.is_published = 1
         AND link.link_type IN (
           'meetup_group', 'meetup_discussion', 'social_profile',
           'community_platform', 'resource', 'other'
         )
         AND link.deleted_at IS NULL
         AND json_valid(revision.snapshot_json)
         AND json_extract(revision.snapshot_json, '$.confirmed') = 1
         AND json_extract(revision.snapshot_json, '$.label') = link.label
         AND json_extract(revision.snapshot_json, '$.url') = link.url
         AND json_extract(
               revision.snapshot_json,
               '$.destinationType'
             ) = details.destination_type
         AND json_extract(
               revision.snapshot_json,
               '$.description'
             ) = details.description
         AND json_extract(
               revision.snapshot_json,
               '$.sortOrder'
             ) = link.sort_order
         AND link.label =
             json_extract(
               materialization.projection_json,
               '$.link.label'
             )
         AND link.url =
             json_extract(
               materialization.projection_json,
               '$.link.url'
             )
         AND link.link_type =
             json_extract(
               materialization.projection_json,
               '$.link.linkType'
             )
         AND link.sort_order =
             json_extract(
               materialization.projection_json,
               '$.link.sortOrder'
             )
         AND details.description =
             json_extract(
               materialization.projection_json,
               '$.details.description'
             )
         AND details.destination_type =
             json_extract(
               materialization.projection_json,
               '$.details.destinationType'
             )
         AND NOT (${protectedLegalClaimSql([
           "materialization.projection_json",
         ])})
         AND NOT (${publicOrganizerEmailExposureSql(
           ["materialization.projection_json"],
           "link.organization_id",
         )})
       ORDER BY link.sort_order ASC, link.label ASC`,
    )
    .bind(PUBLIC_ORGANIZATION_SLUG)
    .all<Record<string, unknown>>();
  return Object.freeze(
    (result.results ?? []).flatMap((row) => {
      const label = publicText(row.label);
      const linkType =
        publicLinkType(row.destination_type) ?? publicLinkType(row.link_type);
      const url =
        linkType === "meetup_group"
          ? cleanMeetupGroupUrl(row.url)
          : linkType === "meetup_discussion"
            ? cleanMeetupDiscussionUrl(row.url)
          : cleanConfirmedHttpsUrl(row.url);
      return label && linkType && url
        ? [
            Object.freeze({
              description: publicBoundedText(row.description, 240),
              label,
              linkType,
              url,
            }),
          ]
        : [];
    }),
  );
}

export async function listPublicNavigation(
  database: Pick<D1DatabaseLike, "prepare">,
): Promise<Readonly<{
  footer: readonly PublicNavigationItemDto[];
  header: readonly PublicNavigationItemDto[];
}>> {
  const result = await database
    .prepare(
      `SELECT item.label, item.placement, item.external_url,
              page.slug AS page_slug
       FROM navigation_items AS item
       JOIN organizations AS organization
         ON organization.id = item.organization_id
       JOIN cms_entity_publication_states AS publication_state
         ON publication_state.organization_id = item.organization_id
        AND publication_state.entity_type = 'navigation'
        AND publication_state.entity_key = 'navigation'
        AND publication_state.workflow_status = 'published'
        AND publication_state.published_revision_id IS NOT NULL
       JOIN cms_entity_revisions AS publication_revision
         ON publication_revision.id =
            publication_state.published_revision_id
        AND publication_revision.organization_id =
            publication_state.organization_id
        AND publication_revision.publication_state_id =
            publication_state.id
        AND publication_revision.entity_type = 'navigation'
        AND publication_revision.entity_key = 'navigation'
       JOIN cms_public_materialization_receipts AS materialization
         ON materialization.organization_id = item.organization_id
        AND materialization.publication_state_id = publication_state.id
        AND materialization.entity_type = 'navigation'
        AND materialization.entity_key = 'navigation'
        AND materialization.revision_id = publication_revision.id
        AND materialization.revision_hash =
            publication_revision.content_hash
        AND ${cmsReceiptEnvelopeMatchesRevisionSql(
          "materialization",
          "publication_revision",
        )}
       JOIN json_each(
         materialization.projection_json,
         '$.items'
       ) AS expected_item
         ON json_extract(expected_item.value, '$.id') = item.id
       LEFT JOIN pages AS page
         ON page.id = item.page_id
        AND page.organization_id = item.organization_id
        AND page.status = 'published'
        AND page.visibility = 'public'
        AND page.published_at IS NOT NULL
        AND page.deleted_at IS NULL
       LEFT JOIN cms_entity_publication_states AS target_page_state
         ON target_page_state.organization_id = page.organization_id
        AND target_page_state.entity_type = 'page'
        AND target_page_state.entity_key = page.id
        AND target_page_state.workflow_status = 'published'
        AND target_page_state.published_revision_id IS NOT NULL
       LEFT JOIN cms_entity_revisions AS target_page_revision
         ON target_page_revision.id =
            target_page_state.published_revision_id
        AND target_page_revision.organization_id =
            target_page_state.organization_id
        AND target_page_revision.publication_state_id =
            target_page_state.id
        AND target_page_revision.entity_type = 'page'
        AND target_page_revision.entity_key = page.id
       LEFT JOIN cms_public_materialization_receipts
         AS target_page_receipt
         ON target_page_receipt.organization_id =
            target_page_state.organization_id
        AND target_page_receipt.publication_state_id =
            target_page_state.id
        AND target_page_receipt.entity_type = 'page'
        AND target_page_receipt.entity_key = page.id
        AND target_page_receipt.revision_id = target_page_revision.id
        AND target_page_receipt.revision_hash =
            target_page_revision.content_hash
        AND ${cmsReceiptEnvelopeMatchesRevisionSql(
          "target_page_receipt",
          "target_page_revision",
        )}
       WHERE organization.slug = ?
         AND organization.deleted_at IS NULL
         AND item.is_published = 1
         AND item.deleted_at IS NULL
         AND item.label =
             json_extract(expected_item.value, '$.label')
         AND item.placement =
             json_extract(expected_item.value, '$.placement')
         AND item.sort_order =
             json_extract(expected_item.value, '$.sortOrder')
         AND (
           (
             item.page_id IS NOT NULL
             AND page.id IS NOT NULL
             AND target_page_receipt.id IS NOT NULL
             AND ${cmsPageLiveProjectionMatchesReceiptSql(
               "page",
               "target_page_receipt",
             )}
           )
           OR item.external_url IS NOT NULL
         )
         AND CASE
           WHEN item.external_url IS NOT NULL THEN item.external_url
           WHEN page.slug = 'home' THEN '/'
           WHEN page.slug IS NOT NULL THEN '/' || page.slug
           ELSE NULL
         END = json_extract(expected_item.value, '$.target')
         AND (
           SELECT count(*)
           FROM navigation_items AS current_item
           WHERE current_item.organization_id = item.organization_id
             AND current_item.is_published = 1
             AND current_item.deleted_at IS NULL
         ) = json_array_length(
               materialization.projection_json,
               '$.items'
             )
         AND NOT (${protectedLegalClaimSql([
           "materialization.projection_json",
         ])})
         AND NOT (${publicOrganizerEmailExposureSql(
           ["materialization.projection_json"],
           "item.organization_id",
         )})
       ORDER BY item.placement ASC, item.sort_order ASC, item.label ASC
       LIMIT 80`,
    )
    .bind(PUBLIC_ORGANIZATION_SLUG)
    .all<Record<string, unknown>>();
  const header: PublicNavigationItemDto[] = [];
  const footer: PublicNavigationItemDto[] = [];
  for (const row of result.results ?? []) {
    const label = publicBoundedText(row.label, 80);
    const placement =
      row.placement === "header" || row.placement === "footer"
        ? row.placement
        : null;
    const pageSlug = publicSlug(row.page_slug);
    const href = pageSlug
      ? publicPagePath(pageSlug)
      : cleanPublicNavigationHref(row.external_url);
    if (
      !label ||
      !placement ||
      !href ||
      (href !== "/organizer" && isProtectedNavigationHref(href))
    ) {
      continue;
    }
    const item = Object.freeze({ href, label });
    (placement === "header" ? header : footer).push(item);
  }
  const requiredHeaderTargets = new Set<string>([
    "/events",
    "/clubs",
    "/about",
    "/for-organizations",
    "/contact",
  ]);
  const requiredFooterTargets = new Set<string>([
    "/events",
    "/clubs",
    "/about",
    "/for-organizations",
    "/get-involved",
    "/host-an-event",
    "/contact",
    "/accessibility",
    "/conduct",
    "/privacy",
  ]);
  return Object.freeze({
    footer: boundedPublicNavigation(
      footer,
      requiredFooterTargets,
      24,
    ),
    header: boundedPublicNavigation(
      header,
      requiredHeaderTargets,
      12,
    ),
  });
}

function boundedPublicNavigation(
  items: readonly PublicNavigationItemDto[],
  requiredTargets: ReadonlySet<string>,
  maximum: number,
): readonly PublicNavigationItemDto[] {
  const requiredCount = items.filter((item) =>
    requiredTargets.has(item.href),
  ).length;
  const optionalTargets = new Set(
    items
      .filter((item) => !requiredTargets.has(item.href))
      .slice(0, Math.max(0, maximum - requiredCount))
      .map((item) => item.href),
  );
  return Object.freeze(
    items.filter(
      (item) =>
        requiredTargets.has(item.href) || optionalTargets.has(item.href),
    ),
  );
}

export async function getPublicPageContent(
  database: Pick<D1DatabaseLike, "prepare">,
  slug: string,
): Promise<PublicPageDto | null> {
  const parsedSlug = publicSlug(slug);
  if (!parsedSlug) return null;
  const result = await database
    .prepare(
      `SELECT page.title, page.slug, section.section_key,
              section.section_type, section.content_json,
              metadata.seo_title, metadata.meta_description,
              metadata.og_media_asset_id
       FROM pages AS page
       JOIN organizations AS organization
         ON organization.id = page.organization_id
       JOIN cms_entity_publication_states AS publication_state
         ON publication_state.organization_id = page.organization_id
        AND publication_state.entity_type = 'page'
        AND publication_state.entity_key = page.id
        AND publication_state.workflow_status = 'published'
        AND publication_state.published_revision_id IS NOT NULL
       JOIN cms_entity_revisions AS publication_revision
         ON publication_revision.id =
            publication_state.published_revision_id
        AND publication_revision.organization_id =
            publication_state.organization_id
        AND publication_revision.publication_state_id =
            publication_state.id
        AND publication_revision.entity_type = 'page'
        AND publication_revision.entity_key = page.id
       JOIN cms_public_materialization_receipts AS materialization
         ON materialization.organization_id = page.organization_id
        AND materialization.publication_state_id = publication_state.id
        AND materialization.entity_type = 'page'
        AND materialization.entity_key = page.id
        AND materialization.revision_id = publication_revision.id
        AND materialization.revision_hash =
            publication_revision.content_hash
        AND ${cmsReceiptEnvelopeMatchesRevisionSql(
          "materialization",
          "publication_revision",
        )}
       LEFT JOIN page_sections AS section
         ON section.page_id = page.id
        AND section.organization_id = page.organization_id
        AND section.deleted_at IS NULL
       LEFT JOIN page_public_metadata AS metadata
         ON metadata.page_id = page.id
        AND metadata.organization_id = page.organization_id
       WHERE organization.slug = ?
         AND organization.deleted_at IS NULL
         AND page.slug = ?
         AND page.status = 'published'
         AND page.visibility = 'public'
         AND page.published_at IS NOT NULL
         AND page.deleted_at IS NULL
         AND page.title =
             json_extract(materialization.projection_json, '$.page.title')
         AND page.slug =
             json_extract(materialization.projection_json, '$.page.slug')
         AND page.current_revision =
             json_extract(
               materialization.projection_json,
               '$.page.currentRevision'
             )
         AND metadata.seo_title IS
             json_extract(
               materialization.projection_json,
               '$.metadata.seoTitle'
             )
         AND metadata.meta_description IS
             json_extract(
               materialization.projection_json,
               '$.metadata.metaDescription'
             )
         AND metadata.og_media_asset_id IS
             json_extract(
               materialization.projection_json,
               '$.metadata.openGraphAssetId'
             )
         AND (
           SELECT count(*)
           FROM page_sections AS current_section
           WHERE current_section.organization_id = page.organization_id
             AND current_section.page_id = page.id
             AND current_section.deleted_at IS NULL
         ) = json_array_length(
               materialization.projection_json,
               '$.sections'
             )
         AND NOT EXISTS (
           SELECT 1
           FROM json_each(
             materialization.projection_json,
             '$.sections'
           ) AS expected_section
           WHERE NOT EXISTS (
             SELECT 1
             FROM page_sections AS current_section
             WHERE current_section.organization_id = page.organization_id
               AND current_section.page_id = page.id
               AND current_section.section_key =
                   json_extract(
                     expected_section.value,
                     '$.sectionKey'
                   )
               AND current_section.section_type =
                   json_extract(
                     expected_section.value,
                     '$.sectionType'
                   )
               AND current_section.content_json =
                   json_extract(
                     expected_section.value,
                     '$.contentJson'
                   )
               AND current_section.sort_order =
                   json_extract(
                     expected_section.value,
                     '$.sortOrder'
                   )
               AND current_section.deleted_at IS NULL
           )
         )
         AND NOT (${protectedLegalClaimSql([
           "materialization.projection_json",
         ])})
         AND NOT (${publicOrganizerEmailExposureSql(
           ["materialization.projection_json"],
           "page.organization_id",
         )})
       ORDER BY section.sort_order ASC, section.section_key ASC`,
    )
    .bind(PUBLIC_ORGANIZATION_SLUG, parsedSlug)
    .all<Record<string, unknown>>();
  const rows = result.results ?? [];
  const first = rows[0];
  const title = publicText(first?.title);
  const pageSlug = publicSlug(first?.slug);
  if (!first || !title || !pageSlug) return null;
  const sections = rows.flatMap((row) => {
    const key = publicSlug(row.section_key);
    const type = publicSectionType(row.section_type);
    const content = type ? publicSectionContent(row.content_json, type) : null;
    return key && type && content
      ? [Object.freeze({ content, key, type })]
      : [];
  });
  return Object.freeze({
    metaDescription: publicBoundedText(first.meta_description, 160),
    openGraphAssetId: publicIdentifier(first.og_media_asset_id),
    sections: Object.freeze(sections),
    seoTitle: publicBoundedText(first.seo_title, 60),
    slug: pageSlug,
    title,
  });
}

export async function loadPublicCatalog(
  database: Pick<D1DatabaseLike, "prepare">,
): Promise<PublicCatalogDto | null> {
  const [site, lanes, clubs, communityLinks, navigation] = await Promise.all([
    getPublicSiteContext(database),
    listPublicLanes(database),
    listPublicClubs(database),
    listPublicCommunityLinks(database),
    listPublicNavigation(database),
  ]);
  return site
    ? Object.freeze({ clubs, communityLinks, lanes, navigation, site })
    : null;
}

const PUBLIC_CLUB_SELECT_SQL = `
  SELECT COALESCE(details.public_display_name, club.name) AS name,
         club.slug,
         profile.publication_status,
         COALESCE(details.short_summary, profile.description) AS description,
         profile.is_featured, profile.public_group_url,
         lane.name AS lane_name, lane.slug AS lane_slug,
         details.full_description, details.program_type,
         details.cover_media_asset_id, details.thumbnail_media_asset_id,
         details.image_alt_text, details.theme_color, details.seo_title,
         details.meta_description, details.og_media_asset_id,
         details.participant_expectations,
         details.preparation_information, details.typical_format,
         details.confirmed_social_links_json,
         CASE
           WHEN json_type(revision.snapshot_json, '$.displayOrder') =
                'integer'
           THEN min(
             100000,
             max(
               0,
               CAST(
                 json_extract(
                   revision.snapshot_json,
                   '$.displayOrder'
                 ) AS INTEGER
               )
             )
           )
           ELSE 1000
         END AS display_order,
         COALESCE(
           (
             SELECT json_group_array(json(resource.resource_json))
             FROM (
               SELECT related.value AS resource_json
               FROM json_each(
                 CASE
                   WHEN json_valid(details.related_resources_json)
                   THEN details.related_resources_json
                   ELSE '[]'
                 END
               ) AS related
               JOIN pages AS resource_page
                 ON resource_page.organization_id = profile.organization_id
                AND '/' || resource_page.slug =
                    json_extract(related.value, '$.url')
                AND resource_page.status = 'published'
                AND resource_page.visibility = 'public'
                AND resource_page.published_at IS NOT NULL
                AND resource_page.deleted_at IS NULL
               JOIN cms_entity_publication_states AS resource_state
                 ON resource_state.organization_id =
                    resource_page.organization_id
                AND resource_state.entity_type = 'page'
                AND resource_state.entity_key = resource_page.id
                AND resource_state.workflow_status = 'published'
                AND resource_state.published_revision_id IS NOT NULL
               JOIN cms_entity_revisions AS resource_revision
                 ON resource_revision.id =
                    resource_state.published_revision_id
                AND resource_revision.organization_id =
                    resource_state.organization_id
                AND resource_revision.publication_state_id =
                    resource_state.id
                AND resource_revision.entity_type = 'page'
                AND resource_revision.entity_key = resource_page.id
                AND resource_revision.revision_number =
                    resource_page.current_revision
               JOIN cms_public_materialization_receipts
                 AS resource_receipt
                 ON resource_receipt.organization_id =
                    resource_state.organization_id
                AND resource_receipt.publication_state_id =
                    resource_state.id
                AND resource_receipt.entity_type = 'page'
                AND resource_receipt.entity_key = resource_page.id
                AND resource_receipt.revision_id = resource_revision.id
                AND resource_receipt.revision_hash =
                    resource_revision.content_hash
                AND ${cmsReceiptEnvelopeMatchesRevisionSql(
                  "resource_receipt",
                  "resource_revision",
                )}
               WHERE json_type(related.value) = 'object'
                 AND ${cmsPageLiveProjectionMatchesReceiptSql(
                   "resource_page",
                   "resource_receipt",
                 )}
               ORDER BY CAST(related.key AS INTEGER)
             ) AS resource
           ),
           '[]'
         ) AS related_resources_json
  FROM club_public_profiles AS profile
  JOIN clubs AS club
    ON club.id = profile.club_id
   AND club.organization_id = profile.organization_id
   AND club.deleted_at IS NULL
  JOIN event_lanes AS lane
    ON lane.id = profile.primary_event_lane_id
   AND lane.organization_id = profile.organization_id
   AND lane.deleted_at IS NULL
  JOIN organizations AS organization
    ON organization.id = profile.organization_id
  JOIN cms_entity_publication_states AS state
    ON state.organization_id = profile.organization_id
   AND state.entity_type = 'club_public_profile'
   AND state.entity_key = profile.club_id
   AND state.workflow_status IN ('published', 'archived')
   AND state.published_revision_id IS NOT NULL
  JOIN cms_entity_revisions AS revision
    ON revision.id = state.published_revision_id
   AND revision.organization_id = state.organization_id
   AND revision.publication_state_id = state.id
   AND revision.entity_type = 'club_public_profile'
   AND revision.entity_key = profile.club_id
   AND json_valid(revision.snapshot_json)
  JOIN cms_public_materialization_receipts AS materialization
    ON materialization.organization_id = state.organization_id
   AND materialization.publication_state_id = state.id
   AND materialization.entity_type = state.entity_type
   AND materialization.entity_key = state.entity_key
   AND materialization.revision_id = revision.id
   AND materialization.revision_hash = revision.content_hash
   AND ${cmsReceiptEnvelopeMatchesRevisionSql("materialization", "revision")}
  LEFT JOIN club_public_profile_details AS details
    ON details.club_id = profile.club_id
   AND details.organization_id = profile.organization_id
  WHERE organization.slug = ?
    AND organization.deleted_at IS NULL
    AND profile.publication_status IN ('published', 'archived')
    AND profile.published_at IS NOT NULL
    AND profile.deleted_at IS NULL
    AND (
      profile.publication_status = 'published'
      OR (
        profile.publication_status = 'archived'
        AND state.workflow_status = 'archived'
        AND state.published_revision_id IS NOT NULL
      )
    )
    AND club.name =
        json_extract(materialization.projection_json, '$.club.name')
    AND club.slug =
        json_extract(materialization.projection_json, '$.club.slug')
    AND club.description =
        json_extract(
          materialization.projection_json,
          '$.club.description'
        )
    AND profile.primary_event_lane_id =
        json_extract(
          materialization.projection_json,
          '$.profile.laneId'
        )
    AND profile.is_featured =
        json_extract(
          materialization.projection_json,
          '$.profile.featured'
        )
    AND profile.description =
        json_extract(
          materialization.projection_json,
          '$.profile.summary'
        )
    AND profile.public_group_url IS
        json_extract(
          materialization.projection_json,
          '$.profile.meetupGroupUrl'
        )
    AND (
      (
        json_type(materialization.projection_json, '$.details') = 'null'
        AND details.club_id IS NULL
      )
      OR (
        json_type(materialization.projection_json, '$.details') = 'object'
        AND details.public_display_name =
            json_extract(
              materialization.projection_json,
              '$.details.publicDisplayName'
            )
        AND details.short_summary =
            json_extract(
              materialization.projection_json,
              '$.details.shortSummary'
            )
        AND details.full_description =
            json_extract(
              materialization.projection_json,
              '$.details.fullDescription'
            )
        AND details.program_type =
            json_extract(
              materialization.projection_json,
              '$.details.programType'
            )
        AND details.cover_media_asset_id IS
            json_extract(
              materialization.projection_json,
              '$.details.coverAssetId'
            )
        AND details.thumbnail_media_asset_id IS
            json_extract(
              materialization.projection_json,
              '$.details.thumbnailAssetId'
            )
        AND details.image_alt_text IS
            json_extract(
              materialization.projection_json,
              '$.details.imageAltText'
            )
        AND details.theme_color =
            json_extract(
              materialization.projection_json,
              '$.details.themeColor'
            )
        AND details.participant_expectations IS
            json_extract(
              materialization.projection_json,
              '$.details.participantExpectations'
            )
        AND details.preparation_information IS
            json_extract(
              materialization.projection_json,
              '$.details.preparationInformation'
            )
        AND details.typical_format IS
            json_extract(
              materialization.projection_json,
              '$.details.typicalFormat'
            )
        AND details.confirmed_social_links_json =
            json(
              json_extract(
                materialization.projection_json,
                '$.details.confirmedSocialLinks'
              )
            )
        AND details.related_resources_json =
            json(
              json_extract(
                materialization.projection_json,
                '$.details.relatedResources'
              )
            )
        AND details.seo_title =
            json_extract(
              materialization.projection_json,
              '$.details.seoTitle'
            )
        AND details.meta_description =
            json_extract(
              materialization.projection_json,
              '$.details.metaDescription'
            )
        AND details.og_media_asset_id IS
            json_extract(
              materialization.projection_json,
              '$.details.openGraphAssetId'
            )
      )
    )
    AND NOT (${protectedLegalClaimSql([
      "materialization.projection_json",
    ])})
    AND NOT (${publicOrganizerEmailExposureSql(
      ["materialization.projection_json"],
      "profile.organization_id",
    )})`;

const PUBLIC_PROGRAM_SELECT_SQL = `
  SELECT details.public_display_name AS name,
         details.public_slug AS slug,
         details.publication_status,
         details.short_summary AS description,
         details.is_featured,
         details.display_order,
         details.full_description,
         details.program_type,
         details.public_group_url,
         details.cover_media_asset_id,
         details.thumbnail_media_asset_id,
         details.theme_color,
         details.seo_title,
         details.meta_description,
         details.og_media_asset_id,
         details.participant_expectations,
         details.preparation_information,
         details.typical_format,
         details.confirmed_social_links_json,
         parent_club.name AS parent_club_name,
         parent_club.slug AS parent_club_slug,
         lane.name AS lane_name,
         lane.slug AS lane_slug,
         COALESCE(
           (
             SELECT json_group_array(json(resource.resource_json))
             FROM (
               SELECT related.value AS resource_json
               FROM json_each(
                 CASE
                   WHEN json_valid(details.related_resources_json)
                   THEN details.related_resources_json
                   ELSE '[]'
                 END
               ) AS related
               JOIN pages AS resource_page
                 ON resource_page.organization_id = details.organization_id
                AND '/' || resource_page.slug =
                    json_extract(related.value, '$.url')
                AND resource_page.status = 'published'
                AND resource_page.visibility = 'public'
                AND resource_page.published_at IS NOT NULL
                AND resource_page.deleted_at IS NULL
               JOIN cms_entity_publication_states AS resource_state
                 ON resource_state.organization_id =
                    resource_page.organization_id
                AND resource_state.entity_type = 'page'
                AND resource_state.entity_key = resource_page.id
                AND resource_state.workflow_status = 'published'
                AND resource_state.published_revision_id IS NOT NULL
               JOIN cms_entity_revisions AS resource_revision
                 ON resource_revision.id =
                    resource_state.published_revision_id
                AND resource_revision.organization_id =
                    resource_state.organization_id
                AND resource_revision.publication_state_id =
                    resource_state.id
                AND resource_revision.entity_type = 'page'
                AND resource_revision.entity_key = resource_page.id
                AND resource_revision.revision_number =
                    resource_page.current_revision
               JOIN cms_public_materialization_receipts
                 AS resource_receipt
                 ON resource_receipt.organization_id =
                    resource_state.organization_id
                AND resource_receipt.publication_state_id =
                    resource_state.id
                AND resource_receipt.entity_type = 'page'
                AND resource_receipt.entity_key = resource_page.id
                AND resource_receipt.revision_id = resource_revision.id
                AND resource_receipt.revision_hash =
                    resource_revision.content_hash
                AND ${cmsReceiptEnvelopeMatchesRevisionSql(
                  "resource_receipt",
                  "resource_revision",
                )}
               WHERE json_type(related.value) = 'object'
                 AND ${cmsPageLiveProjectionMatchesReceiptSql(
                   "resource_page",
                   "resource_receipt",
                 )}
               ORDER BY CAST(related.key AS INTEGER)
             ) AS resource
           ),
           '[]'
         ) AS related_resources_json
  FROM program_public_profile_details AS details
  JOIN programs AS program
    ON program.id = details.program_id
   AND program.organization_id = details.organization_id
   AND program.club_id = details.club_id
   AND program.deleted_at IS NULL
  JOIN clubs AS parent_club
    ON parent_club.id = program.club_id
   AND parent_club.organization_id = program.organization_id
   AND parent_club.deleted_at IS NULL
  JOIN club_public_profiles AS parent_profile
    ON parent_profile.club_id = parent_club.id
   AND parent_profile.organization_id = parent_club.organization_id
   AND parent_profile.publication_status IN ('published', 'archived')
   AND parent_profile.published_at IS NOT NULL
   AND parent_profile.deleted_at IS NULL
  JOIN cms_entity_publication_states AS parent_state
    ON parent_state.organization_id = parent_profile.organization_id
   AND parent_state.entity_type = 'club_public_profile'
   AND parent_state.entity_key = parent_profile.club_id
   AND parent_state.workflow_status IN ('published', 'archived')
   AND parent_state.published_revision_id IS NOT NULL
  JOIN cms_entity_revisions AS parent_revision
    ON parent_revision.id = parent_state.published_revision_id
   AND parent_revision.organization_id = parent_state.organization_id
   AND parent_revision.publication_state_id = parent_state.id
   AND parent_revision.entity_type = 'club_public_profile'
   AND parent_revision.entity_key = parent_profile.club_id
  JOIN cms_public_materialization_receipts AS parent_materialization
    ON parent_materialization.organization_id =
       parent_state.organization_id
   AND parent_materialization.publication_state_id = parent_state.id
   AND parent_materialization.entity_type = parent_state.entity_type
   AND parent_materialization.entity_key = parent_state.entity_key
   AND parent_materialization.revision_id = parent_revision.id
   AND parent_materialization.revision_hash =
       parent_revision.content_hash
   AND ${cmsReceiptEnvelopeMatchesRevisionSql(
     "parent_materialization",
     "parent_revision",
   )}
  JOIN event_lanes AS lane
    ON lane.id = details.primary_event_lane_id
   AND lane.organization_id = details.organization_id
   AND lane.deleted_at IS NULL
  JOIN organizations AS organization
    ON organization.id = details.organization_id
   AND organization.deleted_at IS NULL
  JOIN cms_entity_publication_states AS state
    ON state.organization_id = details.organization_id
   AND state.entity_type = 'program_public_profile'
   AND state.entity_key = details.program_id
   AND state.workflow_status IN ('published', 'archived')
   AND state.published_revision_id IS NOT NULL
  JOIN cms_entity_revisions AS revision
    ON revision.id = state.published_revision_id
   AND revision.organization_id = state.organization_id
   AND revision.publication_state_id = state.id
   AND revision.entity_type = 'program_public_profile'
   AND revision.entity_key = details.program_id
   AND json_valid(revision.snapshot_json)
  JOIN cms_public_materialization_receipts AS materialization
    ON materialization.organization_id = state.organization_id
   AND materialization.publication_state_id = state.id
   AND materialization.entity_type = state.entity_type
   AND materialization.entity_key = state.entity_key
   AND materialization.revision_id = revision.id
   AND materialization.revision_hash = revision.content_hash
   AND ${cmsReceiptEnvelopeMatchesRevisionSql(
     "materialization",
     "revision",
   )}
  WHERE organization.slug = ?
    AND details.publication_status IN ('published', 'archived')
    AND details.published_at IS NOT NULL
    AND details.deleted_at IS NULL
    AND (
      (
        details.publication_status = 'published'
        AND state.workflow_status = 'published'
        AND parent_profile.publication_status = 'published'
      )
      OR (
        details.publication_status = 'archived'
        AND state.workflow_status = 'archived'
      )
    )
    AND details.club_id =
        json_extract(revision.snapshot_json, '$.clubId')
    AND details.primary_event_lane_id =
        json_extract(revision.snapshot_json, '$.laneId')
    AND details.public_display_name =
        json_extract(revision.snapshot_json, '$.name')
    AND details.public_slug =
        json_extract(revision.snapshot_json, '$.slug')
    AND details.short_summary =
        json_extract(revision.snapshot_json, '$.summary')
    AND details.full_description =
        json_extract(revision.snapshot_json, '$.description')
    AND details.program_type =
        json_extract(revision.snapshot_json, '$.programType')
    AND details.is_featured =
        CASE json_extract(revision.snapshot_json, '$.featured')
          WHEN 1 THEN 1 ELSE 0 END
    AND details.display_order =
        json_extract(revision.snapshot_json, '$.displayOrder')
    AND details.seo_title =
        json_extract(revision.snapshot_json, '$.seoTitle')
    AND details.meta_description =
        json_extract(revision.snapshot_json, '$.metaDescription')
    AND parent_club.name =
        json_extract(parent_materialization.projection_json, '$.club.name')
    AND parent_club.slug =
        json_extract(parent_materialization.projection_json, '$.club.slug')
    AND parent_profile.primary_event_lane_id =
        json_extract(
          parent_materialization.projection_json,
          '$.profile.laneId'
        )
    AND parent_profile.publication_status =
        CASE parent_state.workflow_status
          WHEN 'archived' THEN 'archived'
          ELSE 'published'
        END
    AND json_type(materialization.projection_json, '$.details') = 'object'
    AND details.club_id =
        json_extract(materialization.projection_json, '$.details.clubId')
    AND details.primary_event_lane_id =
        json_extract(materialization.projection_json, '$.details.laneId')
    AND details.public_display_name =
        json_extract(materialization.projection_json, '$.details.name')
    AND details.public_slug =
        json_extract(materialization.projection_json, '$.details.slug')
    AND details.short_summary =
        json_extract(materialization.projection_json, '$.details.summary')
    AND details.full_description =
        json_extract(
          materialization.projection_json,
          '$.details.fullDescription'
        )
    AND details.program_type =
        json_extract(
          materialization.projection_json,
          '$.details.programType'
        )
    AND details.public_group_url IS
        json_extract(
          materialization.projection_json,
          '$.details.meetupGroupUrl'
        )
    AND details.cover_media_asset_id IS
        json_extract(
          materialization.projection_json,
          '$.details.coverAssetId'
        )
    AND details.thumbnail_media_asset_id IS
        json_extract(
          materialization.projection_json,
          '$.details.thumbnailAssetId'
        )
    AND details.theme_color IS
        json_extract(
          materialization.projection_json,
          '$.details.themeColor'
        )
    AND details.participant_expectations IS
        json_extract(
          materialization.projection_json,
          '$.details.participantExpectations'
        )
    AND details.preparation_information IS
        json_extract(
          materialization.projection_json,
          '$.details.preparationInformation'
        )
    AND details.typical_format IS
        json_extract(
          materialization.projection_json,
          '$.details.typicalFormat'
        )
    AND details.is_featured =
        json_extract(
          materialization.projection_json,
          '$.details.featured'
        )
    AND details.display_order =
        json_extract(
          materialization.projection_json,
          '$.details.displayOrder'
        )
    AND details.confirmed_social_links_json =
        json(
          json_extract(
            materialization.projection_json,
            '$.details.confirmedSocialLinks'
          )
        )
    AND details.related_resources_json =
        json(
          json_extract(
            materialization.projection_json,
            '$.details.relatedResources'
          )
        )
    AND details.seo_title IS
        json_extract(
          materialization.projection_json,
          '$.details.seoTitle'
        )
    AND details.meta_description IS
        json_extract(
          materialization.projection_json,
          '$.details.metaDescription'
        )
    AND details.og_media_asset_id IS
        json_extract(
          materialization.projection_json,
          '$.details.openGraphAssetId'
        )
    AND NOT (${protectedLegalClaimSql([
      "materialization.projection_json",
      "parent_materialization.projection_json",
    ])})
    AND NOT (${publicOrganizerEmailExposureSql(
      [
        "materialization.projection_json",
        "parent_materialization.projection_json",
      ],
      "details.organization_id",
    )})`;

function toPublicClub(row: Record<string, unknown>): readonly PublicClubDto[] {
  const name = publicText(row.name);
  const slug = publicSlug(row.slug);
  const laneName = publicText(row.lane_name);
  const laneSlug = publicSlug(row.lane_slug);
  if (!name || !slug || !laneName || !laneSlug) return [];
  return [
    Object.freeze({
      archived: row.publication_status === "archived",
      coverAssetId: publicIdentifier(row.cover_media_asset_id),
      description: publicOptionalText(row.description),
      featured: row.is_featured === 1 || row.is_featured === true,
      fullDescription: publicOptionalText(row.full_description),
      imageAltText: publicBoundedText(row.image_alt_text, 300),
      lane: Object.freeze({ name: laneName, slug: laneSlug }),
      metaDescription: publicBoundedText(row.meta_description, 160),
      name,
      openGraphAssetId: publicIdentifier(row.og_media_asset_id),
      participantExpectations: publicOptionalText(row.participant_expectations),
      preparationInformation: publicOptionalText(row.preparation_information),
      programType: publicBoundedText(row.program_type, 120),
      publicGroupUrl: cleanMeetupGroupUrl(row.public_group_url),
      relatedResources: publicLinkArray(row.related_resources_json),
      socialLinks: publicLinkArray(row.confirmed_social_links_json),
      seoTitle: publicBoundedText(row.seo_title, 60),
      slug,
      themeColor: publicHexColor(row.theme_color),
      thumbnailAssetId: publicIdentifier(row.thumbnail_media_asset_id),
      typicalFormat: publicOptionalText(row.typical_format),
    }),
  ];
}

function toPublicProgram(
  row: Record<string, unknown>,
): readonly PublicProgramDto[] {
  const name = publicText(row.name);
  const slug = publicSlug(row.slug);
  const parentName = publicText(row.parent_club_name);
  const parentSlug = publicSlug(row.parent_club_slug);
  const laneName = publicText(row.lane_name);
  const laneSlug = publicSlug(row.lane_slug);
  const programType =
    row.program_type === "program" ||
    row.program_type === "circle" ||
    row.program_type === "series" ||
    row.program_type === "other"
      ? row.program_type
      : null;
  if (
    !name ||
    !slug ||
    !parentName ||
    !parentSlug ||
    !laneName ||
    !laneSlug ||
    !programType
  ) {
    return [];
  }
  return [
    Object.freeze({
      archived: row.publication_status === "archived",
      coverAssetId: publicIdentifier(row.cover_media_asset_id),
      description: publicOptionalText(row.description),
      featured: row.is_featured === 1 || row.is_featured === true,
      fullDescription: publicOptionalText(row.full_description),
      lane: Object.freeze({ name: laneName, slug: laneSlug }),
      metaDescription: publicBoundedText(row.meta_description, 160),
      name,
      openGraphAssetId: publicIdentifier(row.og_media_asset_id),
      parentClub: Object.freeze({ name: parentName, slug: parentSlug }),
      participantExpectations: publicOptionalText(
        row.participant_expectations,
      ),
      preparationInformation: publicOptionalText(
        row.preparation_information,
      ),
      programType,
      publicGroupUrl: cleanMeetupGroupUrl(row.public_group_url),
      relatedResources: publicLinkArray(row.related_resources_json),
      seoTitle: publicBoundedText(row.seo_title, 60),
      slug,
      socialLinks: publicLinkArray(row.confirmed_social_links_json),
      themeColor: publicHexColor(row.theme_color),
      thumbnailAssetId: publicIdentifier(row.thumbnail_media_asset_id),
      typicalFormat: publicOptionalText(row.typical_format),
    }),
  ];
}

async function runBoundedBatch(
  database: D1DatabaseLike,
  statements: ReturnType<D1DatabaseLike["prepare"]>[],
): Promise<void> {
  if (statements.length > MAX_SEED_BATCH_STATEMENTS) {
    throw new Error("Public catalog seed exceeded the D1 batch bound.");
  }
  const results = await database.batch(statements);
  if (results.some((result) => result.success === false)) {
    throw new Error("D1 rejected the public catalog seed.");
  }
}

function publicSectionContent(
  value: unknown,
  type: string,
): PublicPageSectionDto["content"] | null {
  const parsed = parseJsonRecord(value);
  if (!parsed) return null;
  const content: {
    altText?: string;
    assetId?: string;
    caption?: string;
    clubSlugs?: readonly string[];
    eventSlugs?: readonly string[];
    eyebrow?: string;
    heading?: string;
    limit?: number;
    links?: readonly Readonly<{
      description?: string;
      label: string;
      url: string;
    }>[];
    paragraphs?: readonly string[];
    text?: string;
  } = {};
  for (const key of PUBLIC_SECTION_KEYS) {
    if (key === "paragraphs") {
      if (Array.isArray(parsed[key])) {
        const paragraphs = parsed[key].flatMap((entry) => {
          const text = publicText(entry);
          return text ? [text] : [];
        });
        if (paragraphs.length > 0) {
          content.paragraphs = Object.freeze(paragraphs.slice(0, 12));
        }
      }
      continue;
    }
    const text = publicText(parsed[key]);
    if (text) content[key] = text;
  }
  if (type === "media") {
    const assetId = publicIdentifier(parsed.assetId);
    const altText = publicBoundedText(parsed.altText, 300);
    const caption = publicBoundedText(parsed.caption, 1_000);
    if (assetId) {
      content.assetId = assetId;
      if (altText) content.altText = altText;
      if (caption) content.caption = caption;
    }
  }
  if (
    type === "ordered-link-list" ||
    type === "resource-list" ||
    type === "ordered_link_list" ||
    type === "resource_list" ||
    type === "community-links" ||
    type === "community_links"
  ) {
    const linkValues = Array.isArray(parsed.items)
      ? parsed.items
      : Array.isArray(parsed.links)
        ? parsed.links
        : [];
    const links = linkValues.length > 0
      ? linkValues.flatMap((entry) => {
          if (
            typeof entry !== "object" ||
            entry === null ||
            Array.isArray(entry)
          ) {
            return [];
          }
          const record = entry as Record<string, unknown>;
          const label = publicBoundedText(record.label, 120);
          const url = cleanPublicContentUrl(record.url);
          const description = publicBoundedText(record.description, 500);
          return label && url
            ? [
                Object.freeze({
                  ...(description ? { description } : {}),
                  label,
                  url,
                }),
              ]
            : [];
        })
      : [];
    if (links.length > 0) content.links = Object.freeze(links.slice(0, 24));
  }
  if (
    type === "featured-events" ||
    type === "featured-clubs" ||
    type === "community-links" ||
    type === "featured_events" ||
    type === "featured_clubs" ||
    type === "community_links"
  ) {
    const limit =
      Number.isSafeInteger(parsed.limit) &&
      (parsed.limit as number) >= 1 &&
      (parsed.limit as number) <= 12
        ? (parsed.limit as number)
        : 6;
    content.limit = limit;
  }
  if (type === "featured-clubs" || type === "featured_clubs") {
    const clubValues = Array.isArray(parsed.clubSlugs)
      ? parsed.clubSlugs
      : Array.isArray(parsed.ids)
        ? parsed.ids
        : [];
    const clubSlugs = clubValues.length > 0
      ? clubValues.flatMap((entry) => {
          const slug = publicSlug(entry);
          return slug ? [slug] : [];
        })
      : [];
    if (clubSlugs.length > 0) {
      content.clubSlugs = Object.freeze(clubSlugs.slice(0, 12));
    }
  }
  if (type === "featured-events" || type === "featured_events") {
    const eventValues = Array.isArray(parsed.eventSlugs)
      ? parsed.eventSlugs
      : Array.isArray(parsed.slugs)
        ? parsed.slugs
        : [];
    const eventSlugs = eventValues.flatMap((entry) => {
      const slug = publicSlug(entry);
      return slug ? [slug] : [];
    });
    if (eventSlugs.length > 0) {
      content.eventSlugs = Object.freeze(eventSlugs.slice(0, 12));
    }
  }
  return Object.keys(content).length > 0 ? Object.freeze(content) : null;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value.length > 32_768) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function publicStringArray(value: unknown): readonly string[] {
  if (typeof value !== "string" || value.length > 32_768) {
    return Object.freeze([]);
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? Object.freeze(
          parsed.flatMap((entry) =>
            typeof entry === "string" ? [entry] : [],
          ),
        )
      : Object.freeze([]);
  } catch {
    return Object.freeze([]);
  }
}

function readCatalogStatementChanges(
  result: Readonly<{ meta?: Readonly<{ changes?: unknown }> }>,
): number {
  return typeof result.meta?.changes === "number" &&
    Number.isSafeInteger(result.meta.changes) &&
    result.meta.changes >= 0
    ? result.meta.changes
    : -1;
}

function publicLinkArray(
  value: unknown,
): readonly Readonly<{ label: string; url: string }>[] {
  if (typeof value !== "string" || value.length > 32_768) return Object.freeze([]);
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return Object.freeze([]);
    return Object.freeze(
      parsed
        .flatMap((entry) => {
          if (
            typeof entry !== "object" ||
            entry === null ||
            Array.isArray(entry)
          ) {
            return [];
          }
          const record = entry as Record<string, unknown>;
          const label = publicBoundedText(record.label, 120);
          const url = cleanPublicContentUrl(record.url);
          return label && url ? [Object.freeze({ label, url })] : [];
        })
        .slice(0, 24),
    );
  } catch {
    return Object.freeze([]);
  }
}

function publicText(value: unknown): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 4_000
    ? value.trim()
    : null;
}

function publicOptionalText(value: unknown): string | null {
  return value === null || value === undefined ? null : publicText(value);
}

function publicBoundedText(value: unknown, maximum: number): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
    ? value.trim()
    : null;
}

function publicSlug(value: unknown): string | null {
  return typeof value === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value) &&
    value.length <= 128
    ? value
    : null;
}

function publicSectionType(value: unknown): PageBlockType | null {
  return typeof value === "string" &&
      PAGE_BLOCK_TYPES.includes(value as PageBlockType)
    ? (value as PageBlockType)
    : null;
}

function publicLinkType(value: unknown): string | null {
  return typeof value === "string" &&
    [
      "community_platform",
      "meetup_discussion",
      "meetup_group",
      "other",
      "resource",
      "social_profile",
    ].includes(value)
    ? value
    : null;
}

function publicIdentifier(value: unknown): string | null {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9:_-]*$/u.test(value) &&
    value.length <= 128
    ? value
    : null;
}

function cleanMeetupGroupUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.meetup.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      pathParts.length !== 1
    ) {
      return null;
    }
    return `https://www.meetup.com/${pathParts[0]}/`;
  } catch {
    return null;
  }
}

function cleanMeetupDiscussionUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.meetup.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      pathParts.length !== 2 ||
      pathParts[1] !== "discussions"
    ) {
      return null;
    }
    return `https://www.meetup.com/${pathParts[0]}/discussions/`;
  } catch {
    return null;
  }
}

function cleanConfirmedHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hostname.length === 0
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function cleanPublicNavigationHref(value: unknown): string | null {
  if (value === "/organizer" || value === "/for-organizations") return value;
  return cleanConfirmedHttpsUrl(value);
}

function cleanPublicContentUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  if (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !isProtectedNavigationHref(value)
  ) {
    try {
      const parsed = new URL(value, "https://public.invalid");
      if (parsed.origin !== "https://public.invalid" || parsed.hash) return null;
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return null;
    }
  }
  return cleanConfirmedHttpsUrl(value);
}

function publicPagePath(slug: string): string | null {
  if (slug === "home") return "/";
  if (
    [
      "about",
      "accessibility",
      "clubs",
      "community",
      "conduct",
      "contact",
      "events",
      "get-involved",
      "host-an-event",
      "privacy",
      "resources",
    ].includes(slug)
  ) {
    return `/${slug}`;
  }
  return null;
}

function isProtectedNavigationHref(href: string): boolean {
  if (!href.startsWith("/")) return false;
  return [
    "/accept-invitation",
    "/api",
    "/auth",
    "/organizer",
    "/preview",
    "/signin-with-chatgpt",
    "/signout-with-chatgpt",
  ].some((prefix) => href === prefix || href.startsWith(`${prefix}/`));
}

function publicPalette(value: unknown): PublicSiteContextDto["palette"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const background = publicHexColor(record.background);
  const foreground = publicHexColor(record.foreground);
  const accent = publicHexColor(record.accent);
  const secondary = publicHexColor(record.secondary);
  return background && foreground && accent && secondary
    ? Object.freeze({ accent, background, foreground, secondary })
    : null;
}

function publicHexColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/u.test(value)
    ? value.toLowerCase()
    : null;
}
