/* eslint-disable @next/next/no-css-tags -- This shared renderer owns bounded route CSS that must not inflate Home. */

import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import { EventCard } from "./EventCard";
import { PublicMonthCalendar } from "./PublicMonthCalendar";
import type { PublicEventLaneSlug } from "@/lib/public-event-lanes";
import {
  PUBLIC_EVENT_LANE_OPTIONS,
  publicEventsHref,
  type PublicEventsView,
} from "@/lib/public-events-view";
import type { PublicPageDto } from "@/lib/server/public/catalog";
import type {
  PublicEventsPageData,
  PublicUpcomingEventsData,
} from "@/lib/server/public/events-page";
import type { PublicMonthCalendarData } from "@/lib/server/public/month-calendar";

export function EventsPageRenderer({
  activeLaneSlug = null,
  activeView = "upcoming",
  calendar,
  calendarAvailable = true,
  data,
  invalidLane = false,
  invalidView = false,
  nowUtcMs,
  pageContent,
  prefetchInternalLinks = true,
  siteOrigin,
  todayDate,
}: Readonly<{
  activeLaneSlug?: PublicEventLaneSlug | null;
  activeView?: PublicEventsView;
  calendar?: PublicMonthCalendarData;
  calendarAvailable?: boolean;
  data?: PublicEventsPageData;
  invalidLane?: boolean;
  invalidView?: boolean;
  nowUtcMs: number;
  pageContent: PublicPageDto | null;
  prefetchInternalLinks?: boolean;
  siteOrigin: string | null;
  todayDate: string;
}>) {
  const intro = pageContent
    ? pageContent.sections.find((section) => {
        const type = section.type.replaceAll("_", "-");
        return type === "intro" || type === "hero";
      })
    : null;
  const eventsData = data ?? legacyCalendarData(calendar, calendarAvailable);
  const { activeClubSlug } = eventsData;
  const calendarMonth = eventsData.calendar.resolvedMonth.month;

  return (
    <main className="public-page events-page">
      <link rel="stylesheet" href="/styles/calendar.css" precedence="calendar" />
      <link rel="stylesheet" href="/styles/events.css" precedence="events" />
      <header
        aria-labelledby="events-page-title"
        className="events-page-masthead"
      >
        <h1 id="events-page-title">
          {intro?.content.heading ?? pageContent?.title ?? "Events"}
        </h1>
        <p>
          {intro?.content.text ??
            "Browse upcoming books, films, ideas, walks, and creative nights."}
        </p>
      </header>

      <section
        aria-labelledby="events-discovery-heading"
        className="events-page__discovery"
      >
        <h2 className="sr-only" id="events-discovery-heading">
          Find a gathering
        </h2>
        <div className="events-page__controls">
          <nav aria-label="Event views" className="events-view-switcher">
            <Link
              aria-current={activeView === "upcoming" ? "page" : undefined}
              href={publicEventsHref({
                clubSlug: activeClubSlug,
                laneSlug: activeLaneSlug,
                view: "upcoming",
              })}
              prefetch={prefetchInternalLinks}
            >
              Upcoming
            </Link>
            <Link
              aria-current={activeView === "calendar" ? "page" : undefined}
              href={publicEventsHref({
                clubSlug: activeClubSlug,
                laneSlug: activeLaneSlug,
                month: calendarMonth,
                view: "calendar",
              })}
              prefetch={prefetchInternalLinks}
            >
              Calendar
            </Link>
          </nav>

          <form
            action="/events"
            className="events-filter-form"
            key={`${activeView}:${activeLaneSlug ?? "all"}:${activeClubSlug ?? "all"}:${calendarMonth}`}
            method="get"
          >
            {activeView === "calendar" ? (
              <input name="view" type="hidden" value="calendar" />
            ) : null}
            <label>
              <span>Activity</span>
              <select defaultValue={activeLaneSlug ?? ""} name="lane">
                <option value="">All activities</option>
                {PUBLIC_EVENT_LANE_OPTIONS.map((lane) => (
                  <option key={lane.slug} value={lane.slug}>
                    {lane.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Club</span>
              <select defaultValue={activeClubSlug ?? ""} name="club">
                <option value="">All clubs</option>
                {eventsData.clubOptions.map((club) => (
                  <option key={club.slug} value={club.slug}>
                    {club.name}
                  </option>
                ))}
              </select>
            </label>
            {activeView === "calendar" ? (
              <input name="month" type="hidden" value={calendarMonth} />
            ) : null}
            <button type="submit">Apply filters</button>
            <Link
              href={publicEventsHref({
                month:
                  activeView === "calendar" ? calendarMonth : undefined,
                view: activeView,
              })}
              prefetch={prefetchInternalLinks}
            >
              Clear
            </Link>
          </form>
        </div>

        {invalidView ? (
          <div className="calendar-notice" role="alert">
            That view is not available. Showing upcoming events.
          </div>
        ) : null}
        {invalidLane ? (
          <div className="calendar-notice" role="alert">
            That activity filter is not available. Showing all events.
          </div>
        ) : null}
        {eventsData.invalidClub ? (
          <div className="calendar-notice" role="alert">
            That club filter is not available. Showing all clubs.
          </div>
        ) : null}

        {activeView === "upcoming" ? (
          <UpcomingEventsView
            activeClubSlug={activeClubSlug}
            activeLaneSlug={activeLaneSlug}
            available={eventsData.calendarAvailable}
            upcoming={eventsData.upcoming}
          />
        ) : (
          <CalendarEventsView
            activeClubSlug={activeClubSlug}
            activeLaneSlug={activeLaneSlug}
            calendar={eventsData.calendar}
            calendarAvailable={eventsData.calendarAvailable}
            nowUtcMs={nowUtcMs}
            prefetchInternalLinks={prefetchInternalLinks}
            siteOrigin={siteOrigin}
            todayDate={todayDate}
          />
        )}
      </section>
    </main>
  );
}

function UpcomingEventsView({
  activeClubSlug,
  activeLaneSlug,
  available,
  upcoming,
}: Readonly<{
  activeClubSlug: string | null;
  activeLaneSlug: PublicEventLaneSlug | null;
  available: boolean;
  upcoming: PublicUpcomingEventsData;
}>) {
  const firstVisible =
    upcoming.totalCount === 0
      ? 0
      : (upcoming.page - 1) * upcoming.pageSize + 1;
  const lastVisible = Math.min(
    upcoming.page * upcoming.pageSize,
    upcoming.totalCount,
  );
  const filtered = activeLaneSlug !== null || activeClubSlug !== null;
  const eagerPosterSlugs = upcoming.events
    .filter((event) => event.artwork !== null)
    .slice(0, 2)
    .map((event) => event.slug);

  return (
    <div className="events-page__upcoming">
      {!available ? (
        <div className="calendar-notice" role="status">
          Upcoming events are temporarily unavailable. Please try again in a
          moment.
        </div>
      ) : null}
      {upcoming.invalidPage ? (
        <div className="calendar-notice" role="alert">
          That results page is not available. Showing page 1 instead.
        </div>
      ) : null}
      <p aria-live="polite" className="events-upcoming__summary">
        <strong>{upcoming.totalCount}</strong>{" "}
        {upcoming.totalCount === 1
          ? "upcoming gathering"
          : "upcoming gatherings"}
        {upcoming.totalCount > upcoming.pageSize
          ? ` · showing ${firstVisible}–${lastVisible}`
          : null}
      </p>

      {upcoming.events.length > 0 ? (
        <div className="event-list events-upcoming__list">
          {upcoming.events.map((event) => {
            const eagerPosterIndex = eagerPosterSlugs.indexOf(event.slug);
            return (
              <EventCard
                compact
                event={event}
                eager={eagerPosterIndex >= 0}
                key={event.slug}
                posterSizes="(max-width: 672px) 92vw, (max-width: 832px) 30vw, (max-width: 1400px) 24vw, 352px"
                priority={eagerPosterIndex === 0}
                programStreamAccents
              />
            );
          })}
        </div>
      ) : (
        <section className="public-empty-state events-upcoming__empty">
          <p className="section-kicker">Nothing listed here yet</p>
          <h2>
            {filtered
              ? "No upcoming gatherings match these filters."
              : "No upcoming gatherings are published yet."}
          </h2>
          <p>
            {filtered
              ? "Clear a filter to see more gatherings."
              : "Please check back soon for the next Vancouver gathering."}
          </p>
        </section>
      )}

      {upcoming.totalPages > 1 ? (
        <nav
          aria-label="Upcoming events pages"
          className="pagination events-upcoming__pagination"
        >
          {upcoming.page > 1 ? (
            <Link
              href={publicEventsHref({
                clubSlug: activeClubSlug,
                laneSlug: activeLaneSlug,
                page: upcoming.page - 1,
                view: "upcoming",
              })}
            >
              Previous
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
          <span>
            Page {upcoming.page} of {upcoming.totalPages}
          </span>
          {upcoming.page < upcoming.totalPages ? (
            <Link
              href={publicEventsHref({
                clubSlug: activeClubSlug,
                laneSlug: activeLaneSlug,
                page: upcoming.page + 1,
                view: "upcoming",
              })}
            >
              Next
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
        </nav>
      ) : null}
    </div>
  );
}

function CalendarEventsView({
  activeClubSlug,
  activeLaneSlug,
  calendar,
  calendarAvailable,
  nowUtcMs,
  prefetchInternalLinks,
  siteOrigin,
  todayDate,
}: Readonly<{
  activeClubSlug: string | null;
  activeLaneSlug: PublicEventLaneSlug | null;
  calendar: PublicMonthCalendarData;
  calendarAvailable: boolean;
  nowUtcMs: number;
  prefetchInternalLinks: boolean;
  siteOrigin: string | null;
  todayDate: string;
}>) {
  return (
    <div className="events-page__calendar public-calendar-page">
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
          Showing the nearest month with an upcoming event. Choose Today to
          return to the current month.
        </div>
      ) : null}
      {calendar.hasMore ? (
        <div className="calendar-notice" role="status">
          This month contains more events than one calendar page can safely
          load.
        </div>
      ) : null}
      {calendarAvailable && calendar.events.length === 0 ? (
        <div className="calendar-notice" role="status">
          No events match these filters in this month. Try another month or
          clear a filter.
        </div>
      ) : null}
      <PublicMonthCalendar
        calendarRoute="/events"
        clubSlug={activeClubSlug}
        complete={!calendar.hasMore}
        events={calendar.events}
        headingLevel={2}
        key={`${calendar.resolvedMonth.month}:${activeLaneSlug ?? "all"}:${activeClubSlug ?? "all"}`}
        laneSlug={activeLaneSlug}
        maxMonth={calendar.resolvedMonth.maxMonth}
        minMonth={calendar.resolvedMonth.minMonth}
        month={calendar.resolvedMonth.month}
        nowUtcMs={nowUtcMs}
        prefetchInternalLinks={prefetchInternalLinks}
        siteOrigin={siteOrigin}
        todayDate={todayDate}
      />
    </div>
  );
}

function legacyCalendarData(
  calendar: PublicMonthCalendarData | undefined,
  calendarAvailable: boolean,
): PublicEventsPageData {
  if (!calendar) {
    throw new Error("EventsPageRenderer requires durable Events page data.");
  }
  return {
    activeClubSlug: null,
    calendar,
    calendarAvailable,
    clubOptions: [],
    invalidClub: false,
    upcoming: {
      events: [],
      invalidPage: false,
      page: 1,
      pageSize: 12,
      totalCount: 0,
      totalPages: 1,
    },
  };
}
