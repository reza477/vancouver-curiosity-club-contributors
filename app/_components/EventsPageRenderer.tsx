import Link from "next/link";
import { EditorialSection, loadEditorialRenderContext } from "./EditorialPage";
import { EventCollection } from "./EventCollection";
import { EventFilters, type EventFilterValues } from "./EventFilters";
import type {
  PublicClubDto,
  PublicCommunityLinkDto,
  PublicLaneDto,
  PublicPageDto,
} from "@/lib/server/public/catalog";
import type {
  PublicEventCategoryOption,
  PublicEventPageDto,
} from "@/lib/server/public/events";
import type { ResponsiveMediaAssetDto } from "@/lib/server/media/usage";

export async function EventsPageRenderer({
  categories,
  clubs,
  eventPage,
  invalidFilters,
  lanes,
  pageContent,
  previewCommunityLinks,
  previewMediaAssets,
  privatePreview = false,
  values,
}: Readonly<{
  categories: readonly PublicEventCategoryOption[];
  clubs: readonly PublicClubDto[];
  eventPage: PublicEventPageDto;
  invalidFilters: boolean;
  lanes: readonly PublicLaneDto[];
  pageContent: PublicPageDto | null;
  previewCommunityLinks?: readonly PublicCommunityLinkDto[];
  previewMediaAssets?: readonly ResponsiveMediaAssetDto[];
  privatePreview?: boolean;
  /** Compatibility input for the organizer-only CMS preview. Never rendered. */
  sync?: unknown;
  values: EventFilterValues;
}>) {
  const intro = pageContent
    ? pageContent.sections.find((section) => {
        const type = section.type.replaceAll("_", "-");
        return type === "intro" || type === "hero";
      })
    : null;
  const sections = pageContent
    ? pageContent.sections.filter((section) => section !== intro)
    : [];
  const renderContext = pageContent
      ? await loadEditorialRenderContext({
          page: pageContent,
          previewCommunityLinks,
          previewMediaAssets,
        privatePreview,
      })
    : null;

  return (
    <main className="public-page events-page">
      <header
        aria-labelledby="events-page-title"
        className="events-page-masthead"
      >
        <p className="section-kicker">Vancouver gatherings</p>
        <h1 id="events-page-title">
          {intro?.content.heading ?? pageContent?.title ?? "Events"}
        </h1>
        <p>
          {intro?.content.text ??
            "Browse upcoming books, films, ideas, walks, and creative nights."}
        </p>
      </header>

      <nav
        aria-label="Event views"
        className="calendar-view-switcher event-view-switcher"
      >
        <Link aria-current="page" href="/events">
          List
        </Link>
        <Link href="/calendar">Month</Link>
      </nav>

      {sections.length > 0 && renderContext ? (
        <div className="editorial-sections">
          {sections.map((section) => (
            <EditorialSection
              key={section.key}
              renderContext={renderContext}
              section={section}
            />
          ))}
        </div>
      ) : null}

      {invalidFilters ? (
        <section className="public-error-state" role="alert">
          <p className="section-kicker">Filters not applied</p>
          <h2>One or more filters could not be validated.</h2>
          <p>
            Use shorter keywords, real calendar dates, and the available filter
            choices.
          </p>
          <Link href="/events">Clear Filters</Link>
        </section>
      ) : null}

      <EventFilters
        categories={categories}
        clubs={clubs}
        lanes={lanes}
        resultCount={eventPage.totalCount}
        values={values}
      />
      {!privatePreview && !invalidFilters ? (
        <nav
          aria-label="Download filtered public events"
          className="public-export-actions"
        >
          <span>Download this public view</span>
          <Link href={exportHref("/events/calendar.ics", values)}>
            iCalendar (.ics)
          </Link>
          <Link href={exportHref("/events/events.csv", values)}>
            Spreadsheet (.csv)
          </Link>
        </nav>
      ) : null}
      {!invalidFilters ? (
        <>
          <EventCollection
            events={eventPage.events}
            emptyMessage={
              hasActiveFilters(values)
                ? "No published event matches this combination. Clear the filters to widen the search."
                : values.state === "past"
                  ? "No past events are currently available in the public catalog."
                  : "When a real event is published, it will appear here."
            }
          />
          <Pagination page={eventPage} values={values} />
        </>
      ) : null}
    </main>
  );
}

function Pagination({
  page,
  values,
}: Readonly<{
  page: PublicEventPageDto;
  values: EventFilterValues;
}>) {
  if (page.page === 1 && !page.hasMore) return null;
  return (
    <nav className="pagination" aria-label="Event results pages">
      {page.page > 1 ? (
        <Link href={pageHref(values, page.page - 1)}>← Previous</Link>
      ) : (
        <span />
      )}
      <span>
        Page {page.page}
        {page.totalCount > 0
          ? ` of ${Math.ceil(page.totalCount / page.pageSize)}`
          : ""}
      </span>
      {page.hasMore ? (
        <Link href={pageHref(values, page.page + 1)}>Next →</Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

export function eventFilterValues(
  params: Record<string, string | string[] | undefined>,
): EventFilterValues {
  const value = (key: string) =>
    typeof params[key] === "string" ? params[key] : "";
  return {
    q: value("q"),
    from: value("from"),
    to: value("to"),
    club: value("club"),
    lane: value("lane"),
    category: value("category"),
    format: value("format"),
    page: value("page"),
    state: value("state") === "past" ? "past" : "upcoming",
  };
}

export function emptyEventPage(
  view: EventFilterValues["state"],
): PublicEventPageDto {
  return Object.freeze({
    events: Object.freeze([]),
    hasMore: false,
    page: 1,
    pageSize: 12,
    totalCount: 0,
    view,
  });
}

function hasActiveFilters(values: EventFilterValues): boolean {
  return Boolean(
    values.q ||
      values.from ||
      values.to ||
      values.club ||
      values.lane ||
      values.category ||
      values.format,
  );
}

function pageHref(values: EventFilterValues, page: number): string {
  const params = new URLSearchParams();
  params.set("state", values.state);
  for (const [key, value] of [
    ["q", values.q],
    ["from", values.from],
    ["to", values.to],
    ["club", values.club],
    ["lane", values.lane],
    ["category", values.category],
    ["format", values.format],
  ] as const) {
    if (value) params.set(key, value);
  }
  params.set("page", String(page));
  return `/events?${params.toString()}`;
}

function exportHref(
  pathname: "/events/calendar.ics" | "/events/events.csv",
  values: EventFilterValues,
): string {
  const params = new URLSearchParams();
  params.set("state", values.state);
  for (const [key, value] of [
    ["q", values.q],
    ["from", values.from],
    ["to", values.to],
    ["club", values.club],
    ["lane", values.lane],
    ["category", values.category],
    ["format", values.format],
  ] as const) {
    if (value) params.set(key, value);
  }
  return `${pathname}?${params.toString()}`;
}
