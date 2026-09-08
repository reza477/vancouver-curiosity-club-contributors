import type { D1DatabaseLike } from "../auth";
import {
  type PublicCatalogDto,
  type PublicPageDto,
} from "./catalog";
import type { PublicEventCardDto } from "./events";
import {
  getRequestPublicCatalog,
  getRequestPublicHomeEventMaterialization,
  getRequestPublicPageContent,
} from "./request-cache";

const HOME_EVENT_SELECTION_RESERVE = 48;

export type PublicHomeData = Readonly<{
  catalog: PublicCatalogDto;
  events: readonly PublicEventCardDto[];
  page: PublicPageDto;
}>;

/**
 * Keeps the five-read catalog fan-out separate from page/event rendering.
 * This bounds Home's peak D1 concurrency at five instead of composing seven
 * simultaneous reads in one Worker invocation.
 */
export async function loadPublicHomeData(
  database: Pick<D1DatabaseLike, "prepare">,
  input: Readonly<{
    nowUtcMs: number;
    organizationId: string;
  }>,
): Promise<PublicHomeData | null> {
  const catalog = await getRequestPublicCatalog(database);
  if (!catalog) return null;

  const [page, events] = await Promise.all([
    getRequestPublicPageContent(database, "home"),
    getRequestPublicHomeEventMaterialization(database, {
      maximum: HOME_EVENT_SELECTION_RESERVE,
      nowUtcMs: input.nowUtcMs,
      organizationId: input.organizationId,
    }),
  ]);

  return page
    ? Object.freeze({
        catalog,
        events: events ?? [],
        page,
      })
    : null;
}
