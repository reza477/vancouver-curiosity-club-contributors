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
 * First-party copies for synchronized recurring events whose Meetup photo is
 * stable across occurrence IDs. Keying by the already validated source photo
 * URL lets later occurrences reuse the same bundled poster without weakening
 * the exact event-URL checks used by the full enrichment catalog.
 */
export const CURATED_MEETUP_POSTER_SOURCE_OVERRIDES = Object.freeze({
  "https://secure.meetupstatic.com/photos/event/d/0/8/8/highres_535553384.jpeg":
    Object.freeze({
      altText: "Mangos Latin Dance Night event poster.",
      credit: "Vancouver Curiosity Club event poster via Meetup",
      eventId: "316023162",
      height: 512,
      localPath: "/event-posters/meetup-photo-535553384.jpeg",
      mediumHeight: 512,
      mediumPath: "/event-posters/meetup-photo-535553384-960.jpeg",
      mediumWidth: 910,
      smallHeight: 270,
      smallPath: "/event-posters/meetup-photo-535553384-480.jpeg",
      smallWidth: 480,
      sourceUrl:
        "https://secure.meetupstatic.com/photos/event/d/0/8/8/highres_535553384.jpeg",
      width: 910,
    }),
  "https://secure.meetupstatic.com/photos/event/e/6/e/b/highres_533159115.jpeg":
    Object.freeze({
      altText: "Meditation and Journaling Circle event poster.",
      credit: "Vancouver Curiosity Club event poster via Meetup",
      eventId: "315081514",
      height: 900,
      localPath: "/event-posters/meetup-photo-533159115.jpeg",
      mediumHeight: 540,
      mediumPath: "/event-posters/meetup-photo-533159115-960.jpeg",
      mediumWidth: 960,
      smallHeight: 270,
      smallPath: "/event-posters/meetup-photo-533159115-480.jpeg",
      smallWidth: 480,
      sourceUrl:
        "https://secure.meetupstatic.com/photos/event/e/6/e/b/highres_533159115.jpeg",
      width: 1_600,
    }),
  "https://secure.meetupstatic.com/photos/event/5/f/8/0/highres_535044448.jpeg":
    Object.freeze({
      altText: "Sketching and socializing at Riley Park event poster.",
      credit: "Vancouver Curiosity Club event poster via Meetup",
      eventId: "315785787",
      height: 673,
      localPath: "/event-posters/meetup-photo-535044448.jpeg",
      mediumHeight: 540,
      mediumPath: "/event-posters/meetup-photo-535044448-960.jpeg",
      mediumWidth: 960,
      smallHeight: 270,
      smallPath: "/event-posters/meetup-photo-535044448-480.jpeg",
      smallWidth: 480,
      sourceUrl:
        "https://secure.meetupstatic.com/photos/event/5/f/8/0/highres_535044448.jpeg",
      width: 1_196,
    }),
}) satisfies Readonly<Record<string, CuratedMeetupEventPoster>>;

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
    Object.values(CURATED_MEETUP_EVENT_ENRICHMENTS).flatMap((event) => {
      if (event.poster === null) return [];
      return [[
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
      ] as const];
    }),
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

export function curatedMeetupPosterForSourceUrl(
  sourceUrl: unknown,
): CuratedMeetupEventPoster | null {
  if (
    typeof sourceUrl !== "string" ||
    !Object.hasOwn(CURATED_MEETUP_POSTER_SOURCE_OVERRIDES, sourceUrl)
  ) {
    return null;
  }
  return CURATED_MEETUP_POSTER_SOURCE_OVERRIDES[
    sourceUrl as keyof typeof CURATED_MEETUP_POSTER_SOURCE_OVERRIDES
  ];
}
