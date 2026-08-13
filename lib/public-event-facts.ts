import type { PublicEventCardDto } from "@/lib/server/public/events";

/**
 * Builds one visitor-facing location from the same verified event facts used by
 * cards, detail pages, and downloads. Event-specific floor/room information is
 * deliberately kept separate from the shared venue record.
 */
export function publicEventLocationParts(
  event: Pick<PublicEventCardDto, "venue">,
): readonly string[] {
  if (!event.venue) return Object.freeze([]);
  return Object.freeze(
    [
      event.venue.name,
      event.venue.address,
      event.venue.floor,
      event.venue.room,
    ].filter(
      (value): value is string => Boolean(value),
    ),
  );
}

export function publicEventLocationLabel(
  event: Pick<PublicEventCardDto, "venue">,
  separator = ", ",
): string | null {
  const parts = publicEventLocationParts(event);
  return parts.length > 0 ? parts.join(separator) : null;
}

export function publicEventCapacityLabel(
  event: Pick<PublicEventCardDto, "capacity" | "waitlistAvailable">,
): string | null {
  if (event.capacity === null || event.capacity === undefined) {
    return event.waitlistAvailable ? "Waitlist available" : null;
  }
  const capacity = event.capacity.toLocaleString("en-CA");
  return event.waitlistAvailable ? `${capacity} + waitlist` : capacity;
}

export function publicEventAvailabilityLabel(
  event: Pick<PublicEventCardDto, "availabilityState">,
): string | null {
  if (event.availabilityState === "full") return "Full";
  if (event.availabilityState === "waitlist") return "Waitlist";
  if (event.availabilityState === "open") return "Open";
  return null;
}
