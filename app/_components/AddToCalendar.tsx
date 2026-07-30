import { googleCalendarEventUrl } from "@/lib/public-calendar";
import type { PublicEventCardDto } from "@/lib/server/public/events";

export function AddToCalendar({
  canonicalUrl = null,
  event,
}: Readonly<{
  canonicalUrl?: string | null;
  event: PublicEventCardDto;
}>) {
  return (
    <details className="add-to-calendar">
      <summary>
        <span aria-hidden="true" className="add-to-calendar__icon" />
        Add to calendar
      </summary>
      <div className="add-to-calendar__choices">
        {!event.isCancelled ? (
          <a
            href={googleCalendarEventUrl(event, canonicalUrl)}
            rel="noreferrer noopener"
            target="_blank"
          >
            Google Calendar
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
        <a href={`/events/${event.slug}/calendar.ics`}>
          {event.isCancelled
            ? "Download cancellation (.ics)"
            : "Apple Calendar / download .ics"}
        </a>
      </div>
    </details>
  );
}
