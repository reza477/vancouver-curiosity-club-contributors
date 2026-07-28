import type { PublicEventDetailDto } from "./events";

export function buildPublicEventJsonLd(
  event: PublicEventDetailDto,
  canonicalUrl: string,
  siteName: string | null,
): Readonly<Record<string, unknown>> {
  const schedule =
    event.schedule.kind === "timed"
      ? {
          startDate: event.schedule.startsAtUtc,
          endDate: event.schedule.endsAtUtc,
        }
      : {
          startDate: event.schedule.startDate,
          endDate: inclusiveCalendarEnd(
            event.schedule.endDateExclusive,
          ),
        };
  const attendanceMode =
    event.attendanceMode === "online"
      ? "https://schema.org/OnlineEventAttendanceMode"
      : event.attendanceMode === "hybrid"
        ? "https://schema.org/MixedEventAttendanceMode"
        : event.attendanceMode === "in-person"
          ? "https://schema.org/OfflineEventAttendanceMode"
          : undefined;
  const organizers = [
    ...(siteName
      ? [
          {
            "@type": "Organization",
            name: siteName,
            url: new URL("/", canonicalUrl).toString(),
          },
        ]
      : []),
    ...event.organizers.map((organizer) => ({
      "@type": "Person",
      name: organizer.displayName,
    })),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: event.summary ?? event.description ?? undefined,
    url: canonicalUrl,
    ...schedule,
    eventStatus: event.isCancelled
      ? "https://schema.org/EventCancelled"
      : event.status === "confirmed"
        ? "https://schema.org/EventScheduled"
        : undefined,
    eventAttendanceMode: attendanceMode,
    location: eventLocation(event),
    organizer: organizers.length > 0 ? organizers : undefined,
    sameAs: event.rsvpUrl ?? undefined,
  };
}

function eventLocation(
  event: PublicEventDetailDto,
):
  | readonly Readonly<Record<string, unknown>>[]
  | Readonly<Record<string, unknown>>
  | undefined {
  const place = event.venue
    ? {
        "@type": "Place",
        name: event.venue.name,
        address: event.venue.address ?? undefined,
      }
    : undefined;
  const virtualLocation = event.publicOnlineUrl
    ? {
        "@type": "VirtualLocation",
        url: event.publicOnlineUrl,
      }
    : undefined;
  if (event.attendanceMode === "online") return virtualLocation;
  if (event.attendanceMode === "in-person") return place;
  if (event.attendanceMode === "hybrid") {
    const locations: Readonly<Record<string, unknown>>[] = [];
    if (place) locations.push(place);
    if (virtualLocation) locations.push(virtualLocation);
    return locations.length > 0 ? locations : undefined;
  }
  return undefined;
}

function inclusiveCalendarEnd(endDateExclusive: string): string {
  const date = new Date(`${endDateExclusive}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
