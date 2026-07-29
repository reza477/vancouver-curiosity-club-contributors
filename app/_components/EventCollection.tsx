import { EventCard } from "@/app/_components/EventCard";
import type { PublicEventCardDto } from "@/lib/server/public/events";

export function EventCollection({
  events,
  emptyMessage,
}: Readonly<{
  events: readonly PublicEventCardDto[];
  emptyMessage: string;
}>) {
  if (events.length === 0) {
    return (
      <section className="public-empty-state" aria-live="polite">
        <p className="section-kicker">No published listings</p>
        <h2>Nothing is being invented to fill the space.</h2>
        <p>{emptyMessage}</p>
      </section>
    );
  }

  return (
    <div className="event-list">
      {events.map((event, index) => (
        <EventCard event={event} key={event.slug} priority={index === 0} />
      ))}
    </div>
  );
}
