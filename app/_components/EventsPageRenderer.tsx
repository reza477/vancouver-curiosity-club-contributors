import { PublicMonthCalendar } from "./PublicMonthCalendar";
import type { PublicPageDto } from "@/lib/server/public/catalog";
import type { PublicMonthCalendarData } from "@/lib/server/public/month-calendar";

export function EventsPageRenderer({
  calendar,
  calendarAvailable = true,
  nowUtcMs,
  pageContent,
  siteOrigin,
  todayDate,
}: Readonly<{
  calendar: PublicMonthCalendarData;
  calendarAvailable?: boolean;
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
          key={calendar.resolvedMonth.month}
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
