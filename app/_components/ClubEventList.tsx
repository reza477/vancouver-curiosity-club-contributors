import Link from "next/link";
import type { PublicEventCardDto } from "@/lib/server/public/events";

export function ClubEventList({
  emptyCopy,
  events,
  heading,
  id,
}: Readonly<{
  emptyCopy: string;
  events: readonly PublicEventCardDto[];
  heading: string;
  id: string;
}>) {
  return (
    <section className="club-event-list" aria-labelledby={id}>
      <header>
        <p className="section-kicker">From the published calendar</p>
        <h2 id={id}>{heading}</h2>
      </header>
      {events.length > 0 ? (
        <ol>
          {events.map((event) => (
            <li key={event.slug}>
              <article>
                <p className="club-event-list__schedule">
                  {eventSchedule(event)}
                </p>
                <h3>
                  <Link href={`/events/${event.slug}`} prefetch={false}>
                    {event.title}
                  </Link>
                </h3>
                {event.summary ? <p>{event.summary}</p> : null}
                <div className="club-event-list__facts">
                  {event.status === "tentative" ? (
                    <span>Tentative</span>
                  ) : null}
                  <span>{attendanceLabel(event.attendanceMode)}</span>
                  {event.venue ? <span>{event.venue.name}</span> : null}
                </div>
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <p className="public-empty-note">{emptyCopy}</p>
      )}
    </section>
  );
}

function eventSchedule(event: PublicEventCardDto) {
  if (event.schedule.kind === "all_day") {
    const date = new Date(`${event.schedule.startDate}T12:00:00.000Z`);
    return (
      <time dateTime={event.schedule.startDate}>
        All day ·{" "}
        {new Intl.DateTimeFormat("en-CA", {
          day: "numeric",
          month: "long",
          timeZone: "UTC",
          year: "numeric",
        }).format(date)}
      </time>
    );
  }

  const starts = new Date(event.schedule.startsAtUtc);
  const displayTimeZone = event.schedule.timeZone;
  return (
    <time dateTime={event.schedule.startsAtUtc}>
      {new Intl.DateTimeFormat("en-CA", {
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        month: "long",
        timeZone: displayTimeZone,
        timeZoneName: "short",
        weekday: "long",
        year: "numeric",
      }).format(starts)}
    </time>
  );
}

function attendanceLabel(mode: PublicEventCardDto["attendanceMode"]) {
  if (mode === "in-person") return "In person";
  if (mode === "online") return "Online";
  if (mode === "hybrid") return "Hybrid";
  return "Location undecided";
}
