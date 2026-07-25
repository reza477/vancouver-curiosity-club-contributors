import {
  authorizeMembership,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import { parseFiniteInteger } from "../../validation";
import {
  PUBLIC_CATALOG_CLUBS,
  PUBLIC_CATALOG_LANES,
  PUBLIC_CATALOG_PAGES,
  PUBLIC_COMMUNITY_LINKS,
  PUBLIC_ORGANIZATION_SLUG,
  PUBLIC_SITE_IDENTITY,
} from "./catalog-definitions";

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
  locationLabel: string;
  mission: string;
  tagline: string;
}>;

export type PublicLaneDto = Readonly<{
  description: string | null;
  name: string;
  slug: string;
}>;

export type PublicClubDto = Readonly<{
  description: string | null;
  featured: boolean;
  lane: Readonly<{
    name: string;
    slug: string;
  }>;
  name: string;
  publicGroupUrl: string | null;
  slug: string;
}>;

export type PublicCommunityLinkDto = Readonly<{
  label: string;
  url: string;
}>;

export type PublicPageSectionDto = Readonly<{
  content: Readonly<{
    eyebrow?: string;
    heading?: string;
    paragraphs?: readonly string[];
    text?: string;
  }>;
  key: string;
  type: string;
}>;

export type PublicPageDto = Readonly<{
  sections: readonly PublicPageSectionDto[];
  slug: string;
  title: string;
}>;

export type PublicCatalogDto = Readonly<{
  clubs: readonly PublicClubDto[];
  communityLinks: readonly PublicCommunityLinkDto[];
  lanes: readonly PublicLaneDto[];
  site: PublicSiteContextDto;
}>;

export type PublicOrganizationContext = Readonly<{
  id: string;
  timeZone: string;
}>;

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
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const existingVersion = await database
    .prepare(
      `SELECT value_json
       FROM site_settings
       WHERE organization_id = ?
         AND key = 'public_catalog_version'
       LIMIT 1`,
    )
    .bind(actor.organizationId)
    .first<Record<string, unknown>>();
  if (existingVersion?.value_json === JSON.stringify(PUBLIC_CATALOG_VERSION)) {
    return;
  }

  const identityStatements = [
    ...PUBLIC_CATALOG_LANES.map((lane) =>
      database
        .prepare(
          `INSERT INTO event_lanes (
             id, organization_id, name, slug, description, sort_order,
             created_by_profile_id, created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT(organization_id, slug) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          actor.organizationId,
          lane.name,
          lane.slug,
          lane.description,
          lane.sortOrder,
          actor.profileId,
          now,
          now,
        ),
    ),
    ...PUBLIC_CATALOG_CLUBS.map((club) =>
      database
        .prepare(
          `INSERT INTO clubs (
             id, organization_id, name, slug, description,
             created_by_profile_id, created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT(organization_id, slug) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          actor.organizationId,
          club.name,
          club.slug,
          club.description,
          actor.profileId,
          now,
          now,
        ),
    ),
    ...PUBLIC_CATALOG_PAGES.map((page) =>
      database
        .prepare(
          `INSERT INTO pages (
             id, organization_id, title, slug, status, visibility,
             current_revision, published_at, created_by_profile_id,
             updated_by_profile_id, created_at, updated_at, deleted_at
           ) VALUES (
             ?, ?, ?, ?, 'published', 'public', 1, ?, ?, ?, ?, ?, NULL
           )
           ON CONFLICT(organization_id, slug) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          actor.organizationId,
          page.title,
          page.slug,
          now,
          actor.profileId,
          actor.profileId,
          now,
          now,
      ),
    ),
  ];
  const contentStatements = [
    ...PUBLIC_CATALOG_CLUBS.map((club) =>
      database
        .prepare(
          `INSERT INTO club_public_profiles (
             club_id, organization_id, primary_event_lane_id,
             publication_status, is_featured, description, public_group_url,
             published_at, created_at, updated_at, deleted_at
           )
           SELECT club.id, club.organization_id, lane.id, ?, ?, ?, ?, ?, ?, ?,
                  NULL
           FROM clubs AS club
           JOIN event_lanes AS lane
             ON lane.organization_id = club.organization_id
            AND lane.slug = ?
           WHERE club.organization_id = ?
             AND club.slug = ?
           ON CONFLICT(club_id) DO NOTHING`,
        )
        .bind(
          club.publicationStatus,
          club.featured ? 1 : 0,
          club.description,
          club.publicGroupUrl,
          club.publicationStatus === "published" ? now : null,
          now,
          now,
          club.laneSlug,
          actor.organizationId,
          club.slug,
        ),
    ),
    ...PUBLIC_CATALOG_PAGES.flatMap((page) =>
      page.sections.map((section) =>
        database
          .prepare(
            `INSERT INTO page_sections (
               id, organization_id, page_id, section_key, section_type,
               content_json, sort_order, created_at, updated_at, deleted_at
             )
             SELECT ?, page.organization_id, page.id, ?, ?, ?, ?, ?, ?, NULL
             FROM pages AS page
             WHERE page.organization_id = ?
               AND page.slug = ?
             ON CONFLICT(page_id, section_key) DO NOTHING`,
          )
          .bind(
            crypto.randomUUID(),
            section.key,
            section.type,
            JSON.stringify(section.content),
            section.sortOrder,
            now,
            now,
            actor.organizationId,
            page.slug,
          ),
      ),
    ),
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
    ...PUBLIC_COMMUNITY_LINKS.map((link) =>
      database
        .prepare(
          `INSERT INTO community_links (
             id, organization_id, label, url, link_type, is_published,
             sort_order, created_by_profile_id, created_at, updated_at,
             deleted_at
           ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)
           ON CONFLICT(organization_id, url) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          actor.organizationId,
          link.label,
          link.url,
          link.linkType,
          link.sortOrder,
          actor.profileId,
          now,
          now,
      ),
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
      `SELECT setting.value_json
       FROM organizations AS organization
       JOIN site_settings AS setting
         ON setting.organization_id = organization.id
        AND setting.key = 'public_identity'
        AND setting.is_public = 1
       WHERE organization.slug = ?
         AND organization.deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(PUBLIC_ORGANIZATION_SLUG)
    .first<Record<string, unknown>>();
  const value = parseJsonRecord(row?.value_json);
  if (!value) return null;
  const brandName = publicText(value.brandName);
  const locationLabel = publicText(value.locationLabel);
  const mission = publicText(value.mission);
  const tagline = publicText(value.tagline);
  if (!brandName || !locationLabel || !mission || !tagline) return null;
  return Object.freeze({ brandName, locationLabel, mission, tagline });
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
    .prepare(`${PUBLIC_CLUB_SELECT_SQL} ORDER BY profile.is_featured DESC, club.name ASC`)
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

export async function listPublicCommunityLinks(
  database: Pick<D1DatabaseLike, "prepare">,
): Promise<readonly PublicCommunityLinkDto[]> {
  const result = await database
    .prepare(
      `SELECT link.label, link.url
       FROM community_links AS link
       JOIN organizations AS organization
         ON organization.id = link.organization_id
       WHERE organization.slug = ?
         AND organization.deleted_at IS NULL
         AND link.is_published = 1
         AND link.link_type = 'meetup_group'
         AND link.deleted_at IS NULL
       ORDER BY link.sort_order ASC, link.label ASC`,
    )
    .bind(PUBLIC_ORGANIZATION_SLUG)
    .all<Record<string, unknown>>();
  return Object.freeze(
    (result.results ?? []).flatMap((row) => {
      const label = publicText(row.label);
      const url = cleanMeetupGroupUrl(row.url);
      return label && url ? [Object.freeze({ label, url })] : [];
    }),
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
              section.section_type, section.content_json
       FROM pages AS page
       JOIN organizations AS organization
         ON organization.id = page.organization_id
       LEFT JOIN page_sections AS section
         ON section.page_id = page.id
        AND section.organization_id = page.organization_id
        AND section.deleted_at IS NULL
       WHERE organization.slug = ?
         AND organization.deleted_at IS NULL
         AND page.slug = ?
         AND page.status = 'published'
         AND page.visibility = 'public'
         AND page.published_at IS NOT NULL
         AND page.deleted_at IS NULL
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
    const type = publicSlug(row.section_type);
    const content = publicSectionContent(row.content_json);
    return key && type && content
      ? [Object.freeze({ content, key, type })]
      : [];
  });
  return Object.freeze({
    sections: Object.freeze(sections),
    slug: pageSlug,
    title,
  });
}

export async function loadPublicCatalog(
  database: Pick<D1DatabaseLike, "prepare">,
): Promise<PublicCatalogDto | null> {
  const [site, lanes, clubs, communityLinks] = await Promise.all([
    getPublicSiteContext(database),
    listPublicLanes(database),
    listPublicClubs(database),
    listPublicCommunityLinks(database),
  ]);
  return site
    ? Object.freeze({ clubs, communityLinks, lanes, site })
    : null;
}

const PUBLIC_CLUB_SELECT_SQL = `
  SELECT club.name, club.slug, profile.description,
         profile.is_featured, profile.public_group_url,
         lane.name AS lane_name, lane.slug AS lane_slug
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
  WHERE organization.slug = ?
    AND organization.deleted_at IS NULL
    AND profile.publication_status = 'published'
    AND profile.published_at IS NOT NULL
    AND profile.deleted_at IS NULL`;

function toPublicClub(row: Record<string, unknown>): readonly PublicClubDto[] {
  const name = publicText(row.name);
  const slug = publicSlug(row.slug);
  const laneName = publicText(row.lane_name);
  const laneSlug = publicSlug(row.lane_slug);
  if (!name || !slug || !laneName || !laneSlug) return [];
  return [
    Object.freeze({
      description: publicOptionalText(row.description),
      featured: row.is_featured === 1 || row.is_featured === true,
      lane: Object.freeze({ name: laneName, slug: laneSlug }),
      name,
      publicGroupUrl: cleanMeetupGroupUrl(row.public_group_url),
      slug,
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
): PublicPageSectionDto["content"] | null {
  const parsed = parseJsonRecord(value);
  if (!parsed) return null;
  const content: {
    eyebrow?: string;
    heading?: string;
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

function publicSlug(value: unknown): string | null {
  return typeof value === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value) &&
    value.length <= 128
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
