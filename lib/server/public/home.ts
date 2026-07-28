import type { D1DatabaseLike } from "../auth";
import {
  getPublicPageContent,
  loadPublicCatalog,
  type PublicCatalogDto,
  type PublicPageDto,
} from "./catalog";
import { vancouverCalendarDate } from "./date";
import {
  queryPublicEvents,
  type PublicEventCardDto,
} from "./events";

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
  const catalog = await loadPublicCatalog(database);
  if (!catalog) return null;

  const [page, eventPage] = await Promise.all([
    getPublicPageContent(database, "home"),
    queryPublicEvents(database, {
      organizationId: input.organizationId,
      nowUtcMs: input.nowUtcMs,
      todayDate: vancouverCalendarDate(input.nowUtcMs),
      view: "upcoming",
      page: 1,
      pageSize: 6,
    }),
  ]);

  return page
    ? Object.freeze({
        catalog,
        events: eventPage.events,
        page,
      })
    : null;
}
