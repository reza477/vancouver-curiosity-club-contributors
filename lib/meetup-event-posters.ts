export type CuratedMeetupEventPoster = Readonly<{
  altText: string;
  credit: string;
  eventId: string;
  height: number;
  localPath: string;
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
export const CURATED_MEETUP_EVENT_POSTERS = Object.freeze({
  "315294572": Object.freeze({
    altText: "The Two Towers book-club event poster.",
    credit: "Vancouver Curiosity Club event poster via Meetup",
    eventId: "315294572",
    height: 338,
    localPath: "/event-posters/meetup-315294572.jpeg",
    sourceUrl:
      "https://secure.meetupstatic.com/photos/event/1/b/f/7/600_534787159.jpeg",
    width: 600,
  }),
  "315823229": Object.freeze({
    altText: "Rendezvous with Rama book-club event poster.",
    credit: "Vancouver Curiosity Club event poster via Meetup",
    eventId: "315823229",
    height: 337,
    localPath: "/event-posters/meetup-315823229.jpeg",
    sourceUrl:
      "https://secure.meetupstatic.com/photos/event/6/4/f/c/600_535345852.jpeg",
    width: 600,
  }),
  "315508432": Object.freeze({
    altText: "Princess Mononoke film-discussion event poster.",
    credit: "Vancouver Curiosity Club event poster via Meetup",
    eventId: "315508432",
    height: 337,
    localPath: "/event-posters/meetup-315508432.jpeg",
    sourceUrl:
      "https://secure.meetupstatic.com/photos/event/e/3/d/9/600_535018329.jpeg",
    width: 600,
  }),
  "315508537": Object.freeze({
    altText: "Titanic film-discussion event poster.",
    credit: "Vancouver Curiosity Club event poster via Meetup",
    eventId: "315508537",
    height: 337,
    localPath: "/event-posters/meetup-315508537.jpeg",
    sourceUrl:
      "https://secure.meetupstatic.com/photos/event/e/3/f/b/600_535018363.jpeg",
    width: 600,
  }),
  "315510842": Object.freeze({
    altText: "The Matrix film-discussion event poster.",
    credit: "Vancouver Curiosity Club event poster via Meetup",
    eventId: "315510842",
    height: 337,
    localPath: "/event-posters/meetup-315510842.jpeg",
    sourceUrl:
      "https://secure.meetupstatic.com/photos/event/3/b/f/600_535020959.jpeg",
    width: 600,
  }),
  "315675534": Object.freeze({
    altText: "Silent Reading Party and book-chat event poster.",
    credit: "Vancouver Curiosity Club event poster via Meetup",
    eventId: "315675534",
    height: 338,
    localPath: "/event-posters/meetup-315675534.jpeg",
    sourceUrl:
      "https://secure.meetupstatic.com/photos/event/a/c/c/3/600_532844227.jpeg",
    width: 600,
  }),
  "315772444": Object.freeze({
    altText: "Won't You Be My Neighbor film-discussion event poster.",
    credit: "Vancouver Curiosity Club event poster via Meetup",
    eventId: "315772444",
    height: 337,
    localPath: "/event-posters/meetup-315772444.jpeg",
    sourceUrl:
      "https://secure.meetupstatic.com/photos/event/a/6/0/d/600_535302509.jpeg",
    width: 600,
  }),
  "315772533": Object.freeze({
    altText:
      "Cicero on Friendship event poster, with two classical busts facing one another.",
    credit: "Vancouver Curiosity Club event poster via Meetup",
    eventId: "315772533",
    height: 337,
    localPath: "/event-posters/meetup-315772533.jpeg",
    sourceUrl:
      "https://secure.meetupstatic.com/photos/event/a/6/7/f/600_535302623.jpeg",
    width: 600,
  }),
  "315772658": Object.freeze({
    altText: "The Story of a White Blackbird discussion event poster.",
    credit: "Vancouver Curiosity Club event poster via Meetup",
    eventId: "315772658",
    height: 337,
    localPath: "/event-posters/meetup-315772658.jpeg",
    sourceUrl:
      "https://secure.meetupstatic.com/photos/event/a/7/1/2/600_535302770.jpeg",
    width: 600,
  }),
  "315772811": Object.freeze({
    altText: "Poetry Night V event poster.",
    credit: "Vancouver Curiosity Club event poster via Meetup",
    eventId: "315772811",
    height: 337,
    localPath: "/event-posters/meetup-315772811.jpeg",
    sourceUrl:
      "https://secure.meetupstatic.com/photos/event/a/8/4/6/600_535303078.jpeg",
    width: 600,
  }),
  "315777434": Object.freeze({
    altText: "Steve Jobs biography-discussion event poster.",
    credit: "Vancouver Curiosity Club event poster via Meetup",
    eventId: "315777434",
    height: 337,
    localPath: "/event-posters/meetup-315777434.jpeg",
    sourceUrl:
      "https://secure.meetupstatic.com/photos/event/b/8/1/0/600_535307120.jpeg",
    width: 600,
  }),
} satisfies Readonly<Record<string, CuratedMeetupEventPoster>>);

export function curatedMeetupPosterForEventUrl(
  eventUrl: string | null,
): CuratedMeetupEventPoster | null {
  if (eventUrl === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(eventUrl);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "www.meetup.com" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== ""
  ) {
    return null;
  }
  const match = /^\/[^/]+\/events\/([0-9]+)\/?$/u.exec(parsed.pathname);
  if (!match) return null;
  return CURATED_MEETUP_EVENT_POSTERS[
    match[1] as keyof typeof CURATED_MEETUP_EVENT_POSTERS
  ] ?? null;
}
