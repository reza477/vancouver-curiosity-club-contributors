import type { D1DatabaseLike } from "../auth";
import {
  cmsPageLiveProjectionMatchesReceiptSql,
  cmsReceiptEnvelopeMatchesRevisionSql,
} from "./cms-materialization-contract";

const MAX_PAGE_SITEMAP_ENTRIES = 100;
const MAX_CLUB_SITEMAP_ENTRIES = 100;
const MAX_PROGRAM_SITEMAP_ENTRIES = 500;

export type PublicCatalogSitemapEntry = Readonly<{
  lastModified: number;
  slug: string;
}>;

export type PublicProgramSitemapEntry = Readonly<{
  clubSlug: string;
  lastModified: number;
  programSlug: string;
}>;

export type PublicCatalogSitemapEntries = Readonly<{
  clubs: readonly PublicCatalogSitemapEntry[];
  pages: readonly PublicCatalogSitemapEntry[];
  programs: readonly PublicProgramSitemapEntry[];
}>;

/**
 * Reads only exact current receipt-backed route identities. The immutable
 * receipt envelope is the trust root; each mutable route slug must still
 * equal its entity's materialized receipt before it may enter the sitemap.
 */
export async function listPublicCatalogSitemapEntries(
  database: D1DatabaseLike,
  organizationIdValue: unknown,
): Promise<PublicCatalogSitemapEntries> {
  const organizationId = publicIdentifier(organizationIdValue);
  if (!organizationId) {
    return Object.freeze({
      clubs: Object.freeze([]),
      pages: Object.freeze([]),
      programs: Object.freeze([]),
    });
  }
  const statements = [
    database
      .prepare(
        `SELECT page.slug, page.updated_at
         FROM pages AS page
         JOIN cms_entity_publication_states AS state
           ON state.organization_id = page.organization_id
          AND state.entity_type = 'page'
          AND state.entity_key = page.id
          AND state.workflow_status = 'published'
          AND state.published_revision_id IS NOT NULL
         JOIN cms_entity_revisions AS revision
           ON revision.id = state.published_revision_id
          AND revision.organization_id = state.organization_id
          AND revision.publication_state_id = state.id
          AND revision.entity_type = state.entity_type
          AND revision.entity_key = state.entity_key
         JOIN cms_public_materialization_receipts AS receipt
           ON receipt.organization_id = state.organization_id
          AND receipt.publication_state_id = state.id
          AND receipt.entity_type = state.entity_type
          AND receipt.entity_key = state.entity_key
          AND receipt.revision_id = revision.id
          AND receipt.revision_hash = revision.content_hash
          AND ${cmsReceiptEnvelopeMatchesRevisionSql(
            "receipt",
            "revision",
          )}
         WHERE page.organization_id = ?
           AND page.status = 'published'
           AND page.visibility = 'public'
           AND page.published_at IS NOT NULL
           AND page.deleted_at IS NULL
           AND ${cmsPageLiveProjectionMatchesReceiptSql(
             "page",
             "receipt",
           )}
         ORDER BY page.slug ASC
         LIMIT ${MAX_PAGE_SITEMAP_ENTRIES}`,
      )
      .bind(organizationId),
    database
      .prepare(
        `SELECT club.slug, profile.updated_at
         FROM club_public_profiles AS profile
         JOIN clubs AS club
           ON club.id = profile.club_id
          AND club.organization_id = profile.organization_id
          AND club.deleted_at IS NULL
         JOIN cms_entity_publication_states AS state
           ON state.organization_id = profile.organization_id
          AND state.entity_type = 'club_public_profile'
          AND state.entity_key = profile.club_id
          AND state.workflow_status = 'published'
          AND state.published_revision_id IS NOT NULL
         JOIN cms_entity_revisions AS revision
           ON revision.id = state.published_revision_id
          AND revision.organization_id = state.organization_id
          AND revision.publication_state_id = state.id
          AND revision.entity_type = state.entity_type
          AND revision.entity_key = state.entity_key
         JOIN cms_public_materialization_receipts AS receipt
           ON receipt.organization_id = state.organization_id
          AND receipt.publication_state_id = state.id
          AND receipt.entity_type = state.entity_type
          AND receipt.entity_key = state.entity_key
          AND receipt.revision_id = revision.id
          AND receipt.revision_hash = revision.content_hash
          AND ${cmsReceiptEnvelopeMatchesRevisionSql(
            "receipt",
            "revision",
          )}
         WHERE profile.organization_id = ?
           AND profile.publication_status = 'published'
           AND profile.published_at IS NOT NULL
           AND profile.deleted_at IS NULL
           AND json_type(receipt.projection_json, '$.club') = 'object'
           AND json_type(receipt.projection_json, '$.profile') = 'object'
           AND club.name =
               json_extract(receipt.projection_json, '$.club.name')
           AND club.slug =
               json_extract(receipt.projection_json, '$.club.slug')
           AND profile.primary_event_lane_id =
               json_extract(receipt.projection_json, '$.profile.laneId')
           AND profile.publication_status = state.workflow_status
         ORDER BY club.slug ASC
         LIMIT ${MAX_CLUB_SITEMAP_ENTRIES}`,
      )
      .bind(organizationId),
    database
      .prepare(
        `SELECT parent.slug AS club_slug,
                detail.public_slug AS program_slug,
                detail.updated_at
         FROM program_public_profile_details AS detail
         JOIN programs AS program
           ON program.id = detail.program_id
          AND program.organization_id = detail.organization_id
          AND program.club_id = detail.club_id
          AND program.deleted_at IS NULL
         JOIN clubs AS parent
           ON parent.id = program.club_id
          AND parent.organization_id = program.organization_id
          AND parent.deleted_at IS NULL
         JOIN club_public_profiles AS parent_profile
           ON parent_profile.club_id = parent.id
          AND parent_profile.organization_id = parent.organization_id
          AND parent_profile.publication_status = 'published'
          AND parent_profile.published_at IS NOT NULL
          AND parent_profile.deleted_at IS NULL
         JOIN cms_entity_publication_states AS parent_state
           ON parent_state.organization_id = parent_profile.organization_id
          AND parent_state.entity_type = 'club_public_profile'
          AND parent_state.entity_key = parent_profile.club_id
          AND parent_state.workflow_status = 'published'
          AND parent_state.published_revision_id IS NOT NULL
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
          AND ${cmsReceiptEnvelopeMatchesRevisionSql(
            "parent_receipt",
            "parent_revision",
          )}
         JOIN cms_entity_publication_states AS state
           ON state.organization_id = detail.organization_id
          AND state.entity_type = 'program_public_profile'
          AND state.entity_key = detail.program_id
          AND state.workflow_status = 'published'
          AND state.published_revision_id IS NOT NULL
         JOIN cms_entity_revisions AS revision
           ON revision.id = state.published_revision_id
          AND revision.organization_id = state.organization_id
          AND revision.publication_state_id = state.id
          AND revision.entity_type = state.entity_type
          AND revision.entity_key = state.entity_key
         JOIN cms_public_materialization_receipts AS receipt
           ON receipt.organization_id = state.organization_id
          AND receipt.publication_state_id = state.id
          AND receipt.entity_type = state.entity_type
          AND receipt.entity_key = state.entity_key
          AND receipt.revision_id = revision.id
          AND receipt.revision_hash = revision.content_hash
          AND ${cmsReceiptEnvelopeMatchesRevisionSql(
            "receipt",
            "revision",
          )}
         WHERE detail.organization_id = ?
           AND detail.publication_status = 'published'
           AND detail.published_at IS NOT NULL
           AND detail.deleted_at IS NULL
           AND detail.publication_status = state.workflow_status
           AND json_type(receipt.projection_json, '$.details') = 'object'
           AND detail.club_id =
               json_extract(receipt.projection_json, '$.details.clubId')
           AND detail.public_slug =
               json_extract(receipt.projection_json, '$.details.slug')
           AND json_type(parent_receipt.projection_json, '$.club') = 'object'
           AND parent.name =
               json_extract(parent_receipt.projection_json, '$.club.name')
           AND parent.slug =
               json_extract(parent_receipt.projection_json, '$.club.slug')
         ORDER BY parent.slug ASC, detail.public_slug ASC
         LIMIT ${MAX_PROGRAM_SITEMAP_ENTRIES}`,
      )
      .bind(organizationId),
  ];
  const pageResult = await statements[0].all<Record<string, unknown>>();
  const clubResult = await statements[1].all<Record<string, unknown>>();
  const programResult =
    await statements[2].all<Record<string, unknown>>();
  return Object.freeze({
    clubs: toRouteEntries(clubResult.results),
    pages: toRouteEntries(pageResult.results),
    programs: toProgramEntries(programResult.results),
  });
}

function toRouteEntries(
  rows: readonly Record<string, unknown>[] | undefined,
): readonly PublicCatalogSitemapEntry[] {
  return Object.freeze(
    (rows ?? []).flatMap((row) => {
      const slug = publicSlug(row.slug);
      const lastModified = publicTimestamp(row.updated_at);
      return slug && lastModified !== null
        ? [Object.freeze({ lastModified, slug })]
        : [];
    }),
  );
}

function toProgramEntries(
  rows: readonly Record<string, unknown>[] | undefined,
): readonly PublicProgramSitemapEntry[] {
  return Object.freeze(
    (rows ?? []).flatMap((row) => {
      const clubSlug = publicSlug(row.club_slug);
      const programSlug = publicSlug(row.program_slug);
      const lastModified = publicTimestamp(row.updated_at);
      return clubSlug && programSlug && lastModified !== null
        ? [Object.freeze({ clubSlug, lastModified, programSlug })]
        : [];
    }),
  );
}

function publicIdentifier(value: unknown): string | null {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9:_-]*$/u.test(value) &&
    value.length <= 128
    ? value
    : null;
}

function publicSlug(value: unknown): string | null {
  return typeof value === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value) &&
    value.length <= 128
    ? value
    : null;
}

function publicTimestamp(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}
