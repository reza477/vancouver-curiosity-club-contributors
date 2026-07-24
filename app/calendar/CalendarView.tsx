import Link from "next/link";
import type { PublicEventDto } from "@/lib/server/public/events";

const DISPLAY_TIME_ZONE = "America/Vancouver";

type CalendarEvent = PublicEventDto &
  Readonly<{
    isCancelled: boolean;
    rsvpUrl: string | null;
  }>;

export type PublicCalendarSnapshot = Readonly<{
  sync: Readonly<{
    lastSuccessAt: string | null;
    status:
      | "current"
      | "disabled"
      | "error"
      | "not_connected"
      | "partial"
      | "pending"
      | "stale";
  }>;
  events: readonly CalendarEvent[];
}>;

export function CalendarView({
  calendar,
}: Readonly<{ calendar: PublicCalendarSnapshot }>) {
  const upcomingEvents = calendar.events.filter(
    (event) => !event.isCancelled,
  );
  const groups = groupEvents(upcomingEvents);
  const state = syncStateCopy(calendar, upcomingEvents.length);

  return (
    <>
      <a className="skip-link" href="#calendar-main">
        Skip to calendar
      </a>

      <header className="site-header">
        <Link
          className="wordmark"
          href="/"
          aria-label="Vancouver Curiosity Club home"
        >
          <span className="wordmark-mark" aria-hidden="true" />
          <span>Vancouver Curiosity Club</span>
        </Link>
        <nav className="primary-nav" aria-label="Primary navigation">
          <Link aria-current="page" href="/calendar">
            Calendar
          </Link>
          <Link className="portal-link" href="/organizer">
            Organizer portal
            <span aria-hidden="true"> ↗</span>
          </Link>
        </nav>
      </header>

      <main className="calendar-page" id="calendar-main">
        <header className="calendar-masthead">
          <div>
            <p className="eyebrow">
              <span aria-hidden="true">02</span>
              Public agenda
            </p>
            <h1>Calendar</h1>
          </div>
          <p>
            Source-backed gatherings, arranged for a quick read on a small
            screen and a lingering look on a large one.
          </p>
        </header>

        <section
          className={`sync-panel sync-panel-${state.tone}`}
          aria-labelledby="sync-heading"
          data-sync-state={calendar.sync.status}
        >
          <div>
            <p className="sync-label">{state.label}</p>
            <h2 id="sync-heading">{state.heading}</h2>
            <p>{state.detail}</p>
          </div>
          {calendar.sync.lastSuccessAt ? (
            <p className="sync-time">
              <span>Last successful refresh</span>
              <time dateTime={calendar.sync.lastSuccessAt}>
                {formatRefreshTime(calendar.sync.lastSuccessAt)}
              </time>
            </p>
          ) : null}
        </section>

        <aside className="refresh-note" aria-label="How calendar refresh works">
          <p>
            <strong>Refresh-on-view is opportunistic.</strong> This page may
            check one connected official feed when viewed. A completed feed
            waits at least 15 minutes; an unfinished snapshot resumes in a
            bounded chunk on a later view. No scheduled or background sync
            runs.
          </p>
        </aside>

        {groups.length > 0 ? (
          <section className="agenda" aria-labelledby="agenda-heading">
            <header className="agenda-heading">
              <p className="section-kicker">Upcoming listings</p>
              <h2 id="agenda-heading">The next curious thing.</h2>
              {calendar.sync.status === "error" ? (
                <p>
                  The latest refresh did not complete. These are source-backed
                  rows committed by successful row transactions.
                </p>
              ) : calendar.sync.status === "partial" ? (
                <p>
                  The current official-feed snapshot is still being processed
                  in bounded chunks. Listings shown are committed source rows.
                </p>
              ) : calendar.sync.status === "stale" ? (
                <p>These are last-known source records.</p>
              ) : (
                <p>Details below come from the connected source.</p>
              )}
            </header>

            <div className="agenda-groups">
              {groups.map((group) => (
                <section
                  className="agenda-day"
                  key={group.key}
                  aria-labelledby={`day-${group.key}`}
                >
                  <header>
                    <p>{group.weekday}</p>
                    <h3 id={`day-${group.key}`}>{group.date}</h3>
                  </header>
                  <ol>
                    {group.events.map((event) => (
                      <li key={event.slug}>
                        <EventCard event={event} />
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          </section>
        ) : (
          <section className="calendar-empty" aria-labelledby="empty-heading">
            <p className="section-kicker">{state.label}</p>
            <h2 id="empty-heading">{emptyHeading(calendar.sync.status)}</h2>
            <p>{emptyDetail(calendar.sync.status)}</p>
          </section>
        )}
      </main>

      <footer className="site-footer">
        <div>
          <p className="footer-wordmark">Vancouver Curiosity Club</p>
          <p>A social calendar with a brain.</p>
        </div>
        <div className="footer-meta">
          <p>Vancouver, British Columbia</p>
          <Link href="/">Return home</Link>
        </div>
      </footer>
    </>
  );
}

function EventCard({ event }: Readonly<{ event: CalendarEvent }>) {
  const schedule = scheduleCopy(event);

  return (
    <article
      className={`agenda-card${event.isCancelled ? " is-cancelled" : ""}`}
    >
      <div className="agenda-card-meta">
        <p>
          <span className="source-mark" aria-hidden="true" />
          Meetup source
        </p>
        {event.isCancelled ? (
          <p className="cancelled-badge">Cancelled</p>
        ) : null}
      </div>

      <div className="agenda-card-copy">
        <p className="agenda-time">
          <span>{schedule.time}</span>
          <span>{schedule.timezone}</span>
        </p>
        <h4>{event.title}</h4>
        {event.summary ? <p>{event.summary}</p> : null}
      </div>

      <dl className="agenda-facts">
        <div>
          <dt>Location</dt>
          <dd>
            {event.venue ? (
              <>
                <span>{event.venue.name}</span>
                {event.venue.address ? (
                  <span>{event.venue.address}</span>
                ) : null}
              </>
            ) : (
              "Location details not published"
            )}
          </dd>
        </div>
        {event.category ? (
          <div>
            <dt>Category</dt>
            <dd>{event.category.name}</dd>
          </div>
        ) : null}
        {event.organizers.length > 0 ? (
          <div>
            <dt>Organized by</dt>
            <dd>
              {event.organizers
                .map((organizer) => organizer.displayName)
                .join(", ")}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="agenda-card-action">
        {event.rsvpUrl ? (
          <a
            href={event.rsvpUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {event.isCancelled ? "View on Meetup" : "RSVP on Meetup"}
            <span aria-hidden="true"> ↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <p>Meetup RSVP link unavailable.</p>
        )}
      </div>
    </article>
  );
}

function groupEvents(events: readonly CalendarEvent[]) {
  const groups = new Map<
    string,
    {
      date: string;
      events: CalendarEvent[];
      key: string;
      weekday: string;
    }
  >();

  for (const event of events) {
    const date = eventDate(event);
    const existing = groups.get(date.key);
    if (existing) {
      existing.events.push(event);
    } else {
      groups.set(date.key, {
        ...date,
        events: [event],
      });
    }
  }

  return [...groups.values()];
}

function eventDate(event: CalendarEvent) {
  if (event.schedule.kind === "all_day") {
    const date = dateFromCalendarDate(event.schedule.startDate);
    return {
      key: event.schedule.startDate,
      weekday: new Intl.DateTimeFormat("en-CA", {
        timeZone: "UTC",
        weekday: "long",
      }).format(date),
      date: new Intl.DateTimeFormat("en-CA", {
        day: "numeric",
        month: "long",
        timeZone: "UTC",
        year: "numeric",
      }).format(date),
    };
  }

  const date = new Date(event.schedule.startsAtUtc);
  return {
    key: calendarDateKey(date, DISPLAY_TIME_ZONE),
    weekday: new Intl.DateTimeFormat("en-CA", {
      timeZone: DISPLAY_TIME_ZONE,
      weekday: "long",
    }).format(date),
    date: new Intl.DateTimeFormat("en-CA", {
      day: "numeric",
      month: "long",
      timeZone: DISPLAY_TIME_ZONE,
      year: "numeric",
    }).format(date),
  };
}

function scheduleCopy(event: CalendarEvent) {
  if (event.schedule.kind === "all_day") {
    const starts = dateFromCalendarDate(event.schedule.startDate);
    const endExclusive = dateFromCalendarDate(
      event.schedule.endDateExclusive,
    );
    const inclusiveEnd = new Date(endExclusive);
    inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() - 1);
    const isMultiDay =
      Number.isFinite(starts.getTime()) &&
      Number.isFinite(inclusiveEnd.getTime()) &&
      inclusiveEnd.getTime() > starts.getTime();
    return {
      time: isMultiDay
        ? `All day · through ${new Intl.DateTimeFormat("en-CA", {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          }).format(inclusiveEnd)}`
        : "All day",
      timezone: "Calendar date",
    };
  }

  const starts = new Date(event.schedule.startsAtUtc);
  const ends = new Date(event.schedule.endsAtUtc);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  });
  const endCopy =
    calendarDateKey(starts, DISPLAY_TIME_ZONE) ===
    calendarDateKey(ends, DISPLAY_TIME_ZONE)
      ? formatter.format(ends)
      : new Intl.DateTimeFormat("en-CA", {
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          month: "short",
          timeZone: DISPLAY_TIME_ZONE,
        }).format(ends);
  return {
    time: `${formatter.format(starts)}–${endCopy}`,
    timezone: `${DISPLAY_TIME_ZONE} · ${vancouverZoneAbbreviation(starts)}`,
  };
}

function vancouverZoneAbbreviation(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
    timeZoneName: "short",
  }).formatToParts(date);
  return (
    parts.find((part) => part.type === "timeZoneName")?.value ??
    "Pacific time"
  );
}

function syncStateCopy(
  calendar: PublicCalendarSnapshot,
  visibleEventCount: number,
) {
  const hasSourceBackedRows =
    calendar.sync.lastSuccessAt !== null && visibleEventCount > 0;

  switch (calendar.sync.status) {
    case "not_connected":
      return {
        label: "Not connected",
        heading: "No official calendar feed is connected yet.",
        detail:
          "There are no source-backed listings to publish. An owner or administrator can add an official group feed.",
        tone: "quiet",
      };
    case "disabled":
      return {
        label: "Connection paused",
        heading: "Calendar publishing is currently disabled.",
        detail:
          "No source refresh is attempted while the connection is disabled.",
        tone: "quiet",
      };
    case "pending":
      return {
        label: "Never synced",
        heading: "At least one feed has not completed its first refresh.",
        detail:
          "A newly connected feed contributes no public listings until its first complete refresh succeeds.",
        tone: "waiting",
      };
    case "partial":
      return {
        label: "Import in progress",
        heading: "The latest feed snapshot is being processed in chunks.",
        detail: hasSourceBackedRows
          ? "Showing committed source-backed listings while another view or manual refresh continues the same snapshot."
          : "No listings are published from this source until a complete first refresh succeeds.",
        tone: "waiting",
      };
    case "current":
      return {
        label: "Fresh",
        heading: "Connected feed data was refreshed recently.",
        detail:
          "Published listings below reflect the most recent successful source refresh.",
        tone: "fresh",
      };
    case "stale":
      return {
        label: "Stale",
        heading: "A newer source check is due.",
        detail: hasSourceBackedRows
          ? "Showing last-known listings while a newer successful refresh is unavailable."
          : "No last-known upcoming listings are available.",
        tone: "waiting",
      };
    case "error":
      return {
        label: "Source error",
        heading: "The latest refresh did not complete.",
        detail: hasSourceBackedRows
          ? "Listings shown are source-backed rows committed by successful row transactions; they are not claimed as one exact prior snapshot."
          : "No source-backed upcoming listings are available. Try this page again later.",
        tone: "error",
      };
  }
}

function emptyHeading(status: PublicCalendarSnapshot["sync"]["status"]) {
  if (status === "not_connected") return "No source is connected.";
  if (status === "pending") return "Waiting for the first successful refresh.";
  if (status === "partial") return "The feed import is still in progress.";
  if (status === "error") return "No source-backed listings are available.";
  if (status === "disabled") return "Calendar publishing is paused.";
  return "No upcoming source listings.";
}

function emptyDetail(status: PublicCalendarSnapshot["sync"]["status"]) {
  if (status === "not_connected") {
    return "The calendar will remain empty until an owner or administrator connects the official group feed.";
  }
  if (status === "pending") {
    return "A connection alone does not publish events. The feed must refresh successfully first.";
  }
  if (status === "partial") {
    return "Another calendar view or manual refresh will continue the same official-feed snapshot in a bounded chunk.";
  }
  if (status === "error") {
    return "The latest refresh did not complete, and there are no successfully committed source rows to show.";
  }
  if (status === "disabled") {
    return "No refresh is attempted while the source connection is disabled.";
  }
  return "The connected source currently provides no upcoming events for this view.";
}

function formatRefreshTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-CA", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: DISPLAY_TIME_ZONE,
    timeZoneName: "short",
    year: "numeric",
  }).format(date);
}

function calendarDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function dateFromCalendarDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}
