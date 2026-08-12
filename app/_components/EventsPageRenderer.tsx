import Link from "next/link";
import { PublicMonthCalendar } from "./PublicMonthCalendar";
import type { PublicEventLaneSlug } from "@/lib/public-event-lanes";
import { PUBLIC_CATALOG_LANES } from "@/lib/server/public/catalog-definitions";
import type { PublicPageDto } from "@/lib/server/public/catalog";
import type { PublicMonthCalendarData } from "@/lib/server/public/month-calendar";

export function EventsPageRenderer({
  activeLaneSlug = null,
  calendar,
  calendarAvailable = true,
  invalidLane = false,
  nowUtcMs,
  pageContent,
  siteOrigin,
  todayDate,
}: Readonly<{
  activeLaneSlug?: PublicEventLaneSlug | null;
  calendar: PublicMonthCalendarData;
  calendarAvailable?: boolean;
  invalidLane?: boolean;
  nowUtcMs: number;
  pageContent: PublicPageDto | null;
  siteOrigin: string | null;
  todayDate: string;
}>) {
  const intro = pageContent
    ? pageContent.sections.find((section) => {
        const type = section.type.replaceAll("_", "-");
        return type === "intro" || type === "hero";
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
        aria-label="Filter events by activity lane"
        className="events-page__lane-filters"
      >
        <span>Show</span>
        <Link
          aria-current={activeLaneSlug === null ? "page" : undefined}
          href={eventsLaneHref(null)}
          prefetch={false}
        >
          All
        </Link>
        {PUBLIC_CATALOG_LANES.map((lane) => (
          <Link
            aria-current={activeLaneSlug === lane.slug ? "page" : undefined}
            data-event-lane={lane.slug}
            href={eventsLaneHref(lane.slug as PublicEventLaneSlug)}
            key={lane.slug}
            prefetch={false}
          >
            {lane.name}
          </Link>
        ))}
      </nav>

      <div className="events-page__calendar public-calendar-page">
        {invalidLane ? (
          <div className="calendar-notice" role="alert">
            That activity filter is not available. Showing all events.
          </div>
        ) : null}
        {!calendarAvailable ? (
          <div className="calendar-notice" role="status">
            Calendar dates are temporarily unavailable. Please try again in a
            moment.
          </div>
        ) : null}
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
          calendarRoute="/events"
          complete={!calendar.hasMore}
          events={calendar.events}
          headingLevel={2}
          key={`${calendar.resolvedMonth.month}:${activeLaneSlug ?? "all"}`}
          laneSlug={activeLaneSlug}
          maxMonth={calendar.resolvedMonth.maxMonth}
          minMonth={calendar.resolvedMonth.minMonth}
          month={calendar.resolvedMonth.month}
          nowUtcMs={nowUtcMs}
          siteOrigin={siteOrigin}
          todayDate={todayDate}
        />
      </div>
    </main>
  );
}

function eventsLaneHref(
  laneSlug: PublicEventLaneSlug | null,
): string {
  return laneSlug
    ? `/events?lane=${encodeURIComponent(laneSlug)}`
    : "/events";
}
