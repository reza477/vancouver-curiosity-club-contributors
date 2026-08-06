import {
  CURATED_MEETUP_EVENT_ENRICHMENTS,
  curatedMeetupEventForEventUrl,
} from "./meetup-event-enrichment";

export type CuratedMeetupEventPoster = Readonly<{
  altText: string;
  credit: string;
  eventId: string;
  height: number;
  localPath: string;
  mediumHeight: number;
  mediumPath: string;
  mediumWidth: number;
  smallHeight: number;
  smallPath: string;
  smallWidth: number;
  sourceUrl: string;
  width: number;
}>;

/**
 * Rights-approved copies of the poster images published on the club's own
 * Meetup event listings. Rendering always uses the bundled local copy; the
 * Meetup URL is retained only as provenance and is never hotlinked.
 *
 * Meetup's official iCalendar feed has no image field. New Meetup events keep
 * the existing category-art fallback until an Owner adds their poster here or
 * a future approved Meetup photo API is available.
 */
export const CURATED_MEETUP_EVENT_POSTERS = Object.freeze(
  Object.fromEntries(
    Object.values(CURATED_MEETUP_EVENT_ENRICHMENTS).map((event) => [
      event.eventId,
      Object.freeze({
        altText: event.poster.altText,
        credit: event.poster.credit,
        eventId: event.eventId,
        height: event.poster.variants.large.height,
        localPath: event.poster.variants.large.localPath,
        mediumHeight: event.poster.variants.medium.height,
        mediumPath: event.poster.variants.medium.localPath,
        mediumWidth: event.poster.variants.medium.width,
        smallHeight: event.poster.variants.small.height,
        smallPath: event.poster.variants.small.localPath,
        smallWidth: event.poster.variants.small.width,
        sourceUrl: event.poster.sourceUrl,
        width: event.poster.variants.large.width,
      }),
    ]),
  ),
) as Readonly<Record<string, CuratedMeetupEventPoster>>;

export function curatedMeetupPosterForEventUrl(
  eventUrl: string | null,
): CuratedMeetupEventPoster | null {
  const event = curatedMeetupEventForEventUrl(eventUrl);
  return event
    ? CURATED_MEETUP_EVENT_POSTERS[event.eventId] ?? null
    : null;
}
