import Link from "next/link";
import type { PublicEventCardDto } from "@/lib/server/public/events";

const DISPLAY_TIME_ZONE = "America/Vancouver";

export function EventCard({
  event,
  compact = false,
}: Readonly<{
  event: PublicEventCardDto;
  compact?: boolean;
}>) {
  const schedule = formatEventSchedule(event);
  const location =
    event.attendanceMode === "online"
      ? "Online"
      : event.attendanceMode === "hybrid"
        ? event.venue?.name
          ? `${event.venue.name} + online`
          : "Hybrid · location details not published"
        : event.attendanceMode === "in-person"
          ? event.venue?.name ?? "Location details not published"
          : "Location undecided";

  return (
    <article
      className={`event-card${compact ? " event-card--compact" : ""}`}
      data-event-status={event.status}
    >
      <div className="event-card__date" aria-hidden="true">
        <span>{schedule.month}</span>
        <strong>{schedule.day}</strong>
      </div>
      <div className="event-card__body">
        <div className="event-card__meta">
          <span>{event.club.name}</span>
          {event.lane ? <span>{event.lane.name}</span> : null}
          {event.status === "tentative" ? (
            <span className="status-chip status-chip--tentative">
              Tentative
            </span>
          ) : null}
        </div>
        <h3>
          <Link href={`/events/${event.slug}`}>{event.title}</Link>
        </h3>
        {event.summary && !compact ? <p>{event.summary}</p> : null}
        <dl className="event-card__facts">
          <div>
            <dt className="visually-hidden">When</dt>
            <dd>{schedule.label}</dd>
          </div>
          <div>
            <dt className="visually-hidden">Where</dt>
            <dd>{location}</dd>
          </div>
        </dl>
      </div>
      <span className="event-card__arrow" aria-hidden="true">
        →
      </span>
    </article>
  );
}

export function formatEventSchedule(event: PublicEventCardDto): Readonly<{
  day: string;
  label: string;
  month: string;
}> {
  if (event.schedule.kind === "all_day") {
    const start = calendarDateAtNoon(event.schedule.startDate);
    const endInclusive = calendarDateAtNoon(
      addCalendarDays(event.schedule.endDateExclusive, -1),
    );
    const dateLabel =
      event.schedule.startDate ===
      addCalendarDays(event.schedule.endDateExclusive, -1)
        ? new Intl.DateTimeFormat("en-CA", {
            dateStyle: "long",
            timeZone: "UTC",
          }).format(start)
        : `${new Intl.DateTimeFormat("en-CA", {
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          }).format(start)}–${new Intl.DateTimeFormat("en-CA", {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          }).format(endInclusive)}`;
    return Object.freeze({
      month: new Intl.DateTimeFormat("en-CA", {
        month: "short",
        timeZone: "UTC",
      })
        .format(start)
        .toUpperCase(),
      day: new Intl.DateTimeFormat("en-CA", {
        day: "2-digit",
        timeZone: "UTC",
      }).format(start),
      label: `${dateLabel} · All day`,
    });
  }

  const start = new Date(event.schedule.startsAtUtc);
  const end = new Date(event.schedule.endsAtUtc);
  const localDate = new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(start);
  const startTime = new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(start);
  const endTime = new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
    timeZoneName: "short",
  }).format(end);
  return Object.freeze({
    month: new Intl.DateTimeFormat("en-CA", {
      month: "short",
      timeZone: DISPLAY_TIME_ZONE,
    })
      .format(start)
      .toUpperCase(),
    day: new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      timeZone: DISPLAY_TIME_ZONE,
    }).format(start),
    label: `${localDate} · ${startTime}–${endTime}`,
  });
}

function calendarDateAtNoon(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

function addCalendarDays(value: string, days: number): string {
  const date = calendarDateAtNoon(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
