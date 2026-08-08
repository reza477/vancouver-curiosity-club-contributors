import Link from "next/link";
import { EditorialSection, loadEditorialRenderContext } from "./EditorialPage";
import { EventCollection } from "./EventCollection";
import { PublicMonthCalendar } from "./PublicMonthCalendar";
import type {
  PublicCommunityLinkDto,
  PublicPageDto,
} from "@/lib/server/public/catalog";
import type { PublicEventPageDto } from "@/lib/server/public/events";
import type { PublicMonthCalendarData } from "@/lib/server/public/month-calendar";
import type { ResponsiveMediaAssetDto } from "@/lib/server/media/usage";

export type EventListValues = Readonly<{
  month: string;
  page: number;
  state: "past" | "upcoming";
}>;

export async function EventsPageRenderer({
  calendar,
  eventPage,
  nowUtcMs,
  pageContent,
  previewCommunityLinks,
  previewMediaAssets,
  privatePreview = false,
  siteOrigin,
  todayDate,
  values,
}: Readonly<{
  calendar: PublicMonthCalendarData;
  eventPage: PublicEventPageDto;
  nowUtcMs: number;
  pageContent: PublicPageDto | null;
  previewCommunityLinks?: readonly PublicCommunityLinkDto[];
  previewMediaAssets?: readonly ResponsiveMediaAssetDto[];
  privatePreview?: boolean;
  siteOrigin: string | null;
  todayDate: string;
  values: EventListValues;
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
  const listTitle =
    values.state === "past" ? "Past gatherings" : "Upcoming gatherings";

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

      <div className="events-page__calendar public-calendar-page">
        {calendar.resolvedMonth.invalid ? (
          <div className="calendar-notice" role="alert">
            That month is outside the available calendar window. The current
            month is shown instead.
          </div>
        ) : null}
        {calendar.shiftedToUpcoming ? (
          <div className="calendar-notice" role="status">
            Showing the nearest month with a published upcoming event. Choose
            Today to return to the current month.
          </div>
        ) : null}
        {calendar.hasMore ? (
          <div className="calendar-notice" role="status">
            This month contains more published events than one calendar page
            can safely load.
          </div>
        ) : null}
        <PublicMonthCalendar
          calendarRoute={calendarRoute(values)}
          complete={!calendar.hasMore}
          events={calendar.events}
          headingLevel={2}
          key={calendar.resolvedMonth.month}
          maxMonth={calendar.resolvedMonth.maxMonth}
          minMonth={calendar.resolvedMonth.minMonth}
          month={calendar.resolvedMonth.month}
          nowUtcMs={nowUtcMs}
          siteOrigin={siteOrigin}
          todayDate={todayDate}
        />
      </div>

      <section
        aria-labelledby="events-list-title"
        className="events-page__list"
      >
        <div className="events-page__list-header">
          <div>
            <p className="section-kicker">All public listings</p>
            <h2 id="events-list-title">{listTitle}</h2>
            <p aria-live="polite">
              {eventPage.totalCount}{" "}
              {eventPage.totalCount === 1 ? "gathering" : "gatherings"}
            </p>
          </div>
          <nav
            aria-label="Event timeframe"
            className="event-view-tabs events-page__timeframe"
          >
            <Link
              aria-current={
                values.state === "upcoming" ? "page" : undefined
              }
              href={stateHref(values, "upcoming")}
            >
              Upcoming
            </Link>
            <Link
              aria-current={values.state === "past" ? "page" : undefined}
              href={stateHref(values, "past")}
            >
              Past
            </Link>
          </nav>
        </div>
        <EventCollection
          events={eventPage.events}
          emptyMessage={
            values.state === "past"
              ? "No past events are currently available in the public catalog."
              : "When a real event is published, it will appear here."
          }
        />
        <Pagination page={eventPage} values={values} />
      </section>

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
    </main>
  );
}

function Pagination({
  page,
  values,
}: Readonly<{
  page: PublicEventPageDto;
  values: EventListValues;
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

export function eventListValues(
  params: Record<string, string | string[] | undefined>,
): EventListValues {
  const month = typeof params.month === "string" ? params.month : "";
  const rawPage = typeof params.page === "string" ? params.page : "";
  const parsedPage = /^\d{1,4}$/u.test(rawPage) ? Number(rawPage) : 1;
  return Object.freeze({
    month,
    page:
      Number.isSafeInteger(parsedPage) && parsedPage >= 1 && parsedPage <= 1_000
        ? parsedPage
        : 1,
    state: params.state === "past" ? "past" : "upcoming",
  });
}

export function emptyEventPage(
  view: EventListValues["state"],
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

function calendarRoute(values: EventListValues): string {
  return values.state === "past" ? "/events?state=past" : "/events";
}

function stateHref(
  values: EventListValues,
  state: EventListValues["state"],
): string {
  const params = new URLSearchParams({ state });
  if (values.month) params.set("month", values.month);
  return `/events?${params.toString()}`;
}

function pageHref(values: EventListValues, page: number): string {
  const params = new URLSearchParams({
    page: String(page),
    state: values.state,
  });
  if (values.month) params.set("month", values.month);
  return `/events?${params.toString()}`;
}
