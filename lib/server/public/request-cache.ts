import { cacheForRequest } from "vinext/cache";
import type { D1DatabaseLike } from "../auth";
import {
  getPublicClubBySlug,
  getPublicPageContent,
  getPublicProgramBySlugs,
  getPublicSiteContext,
  getPublicSlugRedirect,
  listPublicClubs,
  listPublicCommunityLinks,
  listPublicLanes,
  listPublicNavigation,
  resolvePublicOrganization,
  type PublicCatalogDto,
} from "./catalog";
import { getPublicEventBySlug } from "./events";
import {
  readPublicClubEventViewMaterialization,
  readPublicEventDetailViewMaterialization,
} from "./event-materializations";

type PublicDatabase = Pick<D1DatabaseLike, "prepare">;

type PublicRequestCache = Readonly<{
  catalog: Map<string, Promise<PublicCatalogDto | null>>;
  clubDetails: Map<string, ReturnType<typeof getPublicClubBySlug>>;
  clubEventViews: Map<
    string,
    ReturnType<typeof readPublicClubEventViewMaterialization>
  >;
  clubs: Map<string, ReturnType<typeof listPublicClubs>>;
  communityLinks: Map<string, ReturnType<typeof listPublicCommunityLinks>>;
  lanes: Map<string, ReturnType<typeof listPublicLanes>>;
  navigation: Map<string, ReturnType<typeof listPublicNavigation>>;
  organization: Map<string, ReturnType<typeof resolvePublicOrganization>>;
  pages: Map<string, ReturnType<typeof getPublicPageContent>>;
  programDetails: Map<string, ReturnType<typeof getPublicProgramBySlugs>>;
  siteContext: Map<string, ReturnType<typeof getPublicSiteContext>>;
  eventDetails: Map<string, ReturnType<typeof getPublicEventBySlug>>;
  eventMaterializedViews: Map<
    string,
    ReturnType<typeof readPublicEventDetailViewMaterialization>
  >;
  slugRedirects: Map<string, ReturnType<typeof getPublicSlugRedirect>>;
}>;

const requestDatabaseCaches = cacheForRequest(
  () => new WeakMap<PublicDatabase, PublicRequestCache>(),
);

function requestDatabaseCache(database: PublicDatabase): PublicRequestCache {
  const caches = requestDatabaseCaches();
  const existing = caches.get(database);
  if (existing) return existing;
  const created = Object.freeze({
    catalog: new Map<string, Promise<PublicCatalogDto | null>>(),
    clubDetails:
      new Map<string, ReturnType<typeof getPublicClubBySlug>>(),
    clubEventViews: new Map<
      string,
      ReturnType<typeof readPublicClubEventViewMaterialization>
    >(),
    clubs: new Map<string, ReturnType<typeof listPublicClubs>>(),
    communityLinks:
      new Map<string, ReturnType<typeof listPublicCommunityLinks>>(),
    lanes: new Map<string, ReturnType<typeof listPublicLanes>>(),
    navigation: new Map<string, ReturnType<typeof listPublicNavigation>>(),
    organization:
      new Map<string, ReturnType<typeof resolvePublicOrganization>>(),
    pages: new Map<string, ReturnType<typeof getPublicPageContent>>(),
    programDetails:
      new Map<string, ReturnType<typeof getPublicProgramBySlugs>>(),
    siteContext:
      new Map<string, ReturnType<typeof getPublicSiteContext>>(),
    eventDetails:
      new Map<string, ReturnType<typeof getPublicEventBySlug>>(),
    eventMaterializedViews: new Map<
      string,
      ReturnType<typeof readPublicEventDetailViewMaterialization>
    >(),
    slugRedirects:
      new Map<string, ReturnType<typeof getPublicSlugRedirect>>(),
  });
  caches.set(database, created);
  return created;
}

function remember<T>(
  values: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const existing = values.get(key);
  if (existing) return existing;
  const loaded = load();
  values.set(key, loaded);
  void loaded.catch(() => {
    if (values.get(key) === loaded) values.delete(key);
  });
  return loaded;
}

/**
 * Vinext's unified request cache spans metadata resolution, its pre-render
 * layout probe, RSC generation, and HTML rendering. Keeping the exact D1
 * Promise for that one request prevents those phases from repeating the same
 * public reads. A new request always receives a new WeakMap, so newly
 * published CMS state remains visible without invalidation.
 */
export function getRequestPublicOrganization(database: PublicDatabase) {
  return remember(
    requestDatabaseCache(database).organization,
    "organization",
    () => resolvePublicOrganization(database),
  );
}

export function getRequestPublicSiteContext(database: PublicDatabase) {
  return remember(
    requestDatabaseCache(database).siteContext,
    "site-context",
    () => getPublicSiteContext(database),
  );
}

export function getRequestPublicLanes(database: PublicDatabase) {
  return remember(requestDatabaseCache(database).lanes, "lanes", () =>
    listPublicLanes(database),
  );
}

export function getRequestPublicClubs(database: PublicDatabase) {
  return remember(requestDatabaseCache(database).clubs, "clubs", () =>
    listPublicClubs(database),
  );
}

export function getRequestPublicCommunityLinks(database: PublicDatabase) {
  return remember(
    requestDatabaseCache(database).communityLinks,
    "community-links",
    () => listPublicCommunityLinks(database),
  );
}

export function getRequestPublicNavigation(database: PublicDatabase) {
  return remember(
    requestDatabaseCache(database).navigation,
    "navigation",
    () => listPublicNavigation(database),
  );
}

// Home needs the complete catalog, while the shared shell needs only Site and
// Navigation. Composing from the same leaf caches keeps both surfaces truthful
// without making either one repeat the other's reads during a render.
export function getRequestPublicCatalog(
  database: PublicDatabase,
): Promise<PublicCatalogDto | null> {
  return remember(
    requestDatabaseCache(database).catalog,
    "catalog",
    async () => {
      const [site, lanes, clubs, communityLinks, navigation] =
        await Promise.all([
          getRequestPublicSiteContext(database),
          getRequestPublicLanes(database),
          getRequestPublicClubs(database),
          getRequestPublicCommunityLinks(database),
          getRequestPublicNavigation(database),
        ]);
      return site
        ? Object.freeze({ clubs, communityLinks, lanes, navigation, site })
        : null;
    },
  );
}

export function getRequestPublicPageContent(
  database: PublicDatabase,
  slug: string,
) {
  return remember(requestDatabaseCache(database).pages, slug, () =>
    getPublicPageContent(database, slug),
  );
}

export function getRequestPublicEventBySlug(
  database: PublicDatabase,
  input: Readonly<{ organizationId: string; slug: string }>,
) {
  const key = JSON.stringify([input.organizationId, input.slug]);
  return remember(requestDatabaseCache(database).eventDetails, key, () =>
    getPublicEventBySlug(database, input),
  );
}

export function getRequestPublicEventDetailViewMaterialization(
  database: PublicDatabase,
  input: Readonly<{
    limit?: number;
    nowUtcMs: number;
    organizationId: string;
    slug: string;
    todayDate: string;
  }>,
) {
  // `nowUtcMs` intentionally is not part of this request-local key. Metadata
  // and the page renderer can sample the clock a few milliseconds apart, but
  // must share the same immutable snapshot read and related-event decision.
  const key = JSON.stringify([
    input.organizationId,
    input.slug,
    input.todayDate,
    input.limit ?? 3,
  ]);
  return remember(
    requestDatabaseCache(database).eventMaterializedViews,
    key,
    () => readPublicEventDetailViewMaterialization(database, input),
  );
}

export function getRequestPublicClubEventViewMaterialization(
  database: PublicDatabase,
  input: Readonly<{
    clubSlug: string;
    nowUtcMs: number;
    organizationId: string;
    pageSize?: number;
    programSlug?: string;
    todayDate: string;
  }>,
) {
  const key = JSON.stringify([
    input.organizationId,
    input.clubSlug,
    input.programSlug ?? null,
    input.todayDate,
    input.pageSize ?? 6,
  ]);
  return remember(requestDatabaseCache(database).clubEventViews, key, () =>
    readPublicClubEventViewMaterialization(database, input),
  );
}

export function getRequestPublicClubBySlug(
  database: PublicDatabase,
  slug: string,
) {
  return remember(requestDatabaseCache(database).clubDetails, slug, () =>
    getPublicClubBySlug(database, slug),
  );
}

export function getRequestPublicProgramBySlugs(
  database: PublicDatabase,
  clubSlug: string,
  programSlug: string,
) {
  const key = JSON.stringify([clubSlug, programSlug]);
  return remember(requestDatabaseCache(database).programDetails, key, () =>
    getPublicProgramBySlugs(database, clubSlug, programSlug),
  );
}

export function getRequestPublicSlugRedirect(
  database: PublicDatabase,
  input: Readonly<{
    entityType: "club_public_profile" | "page" | "program_public_profile";
    fromSlug: string;
  }>,
) {
  const key = JSON.stringify([input.entityType, input.fromSlug]);
  return remember(requestDatabaseCache(database).slugRedirects, key, () =>
    getPublicSlugRedirect(database, input),
  );
}
