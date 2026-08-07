import { cache } from "react";
import type { D1DatabaseLike } from "../auth";
import {
  getPublicPageContent,
  getPublicSiteContext,
  loadPublicCatalog,
  resolvePublicOrganization,
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

export const getRequestPublicCatalog = cache(
  (database: PublicDatabase) => loadPublicCatalog(database),
);

export const getRequestPublicPageContent = cache(
  (database: PublicDatabase, slug: string) =>
    getPublicPageContent(database, slug),
);
