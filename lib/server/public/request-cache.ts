import { cache } from "react";
import type { D1DatabaseLike } from "../auth";
import {
  getPublicPageContent,
  getPublicSiteContext,
  listPublicClubs,
  listPublicCommunityLinks,
  listPublicLanes,
  listPublicNavigation,
  resolvePublicOrganization,
  type PublicCatalogDto,
} from "./catalog";

type PublicDatabase = Pick<D1DatabaseLike, "prepare">;

/**
 * React request caches keep metadata, the public shell, and the active route
 * from repeating the same D1 reads during one render. They deliberately do
 * not persist between requests, so a newly published CMS revision is visible
 * on the next navigation without a manual cache purge.
 */
export const getRequestPublicOrganization = cache(
  (database: PublicDatabase) => resolvePublicOrganization(database),
);

export const getRequestPublicSiteContext = cache(
  (database: PublicDatabase) => getPublicSiteContext(database),
);

export const getRequestPublicLanes = cache(
  (database: PublicDatabase) => listPublicLanes(database),
);

export const getRequestPublicClubs = cache(
  (database: PublicDatabase) => listPublicClubs(database),
);

export const getRequestPublicCommunityLinks = cache(
  (database: PublicDatabase) => listPublicCommunityLinks(database),
);

export const getRequestPublicNavigation = cache(
  (database: PublicDatabase) => listPublicNavigation(database),
);

// Home needs the complete catalog, while the shared shell needs only Site and
// Navigation. Composing from the same leaf caches keeps both surfaces truthful
// without making either one repeat the other's reads during a render.
export const getRequestPublicCatalog = cache(
  async (database: PublicDatabase): Promise<PublicCatalogDto | null> => {
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

export const getRequestPublicPageContent = cache(
  (database: PublicDatabase, slug: string) =>
    getPublicPageContent(database, slug),
);
