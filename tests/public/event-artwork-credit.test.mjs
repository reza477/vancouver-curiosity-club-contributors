import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventCard } from "../../app/_components/EventCard.tsx";
import { HomePageRenderer } from "../../app/_components/HomePageRenderer.tsx";
import { PublicEventDetailRenderer } from "../../app/_components/PublicEventDetailRenderer.tsx";
import { PublicMonthCalendar } from "../../app/_components/PublicMonthCalendar.tsx";
import { discoveryArtworkCredit } from "../../lib/media/presentation.ts";

const MEETUP_POSTER_CREDIT =
  "Vancouver Curiosity Club event poster via Meetup";
const CUSTOM_CREDIT = "Illustration by A. Neighbour";

test("discovery credit suppression is exact and keeps provenance data intact", () => {
  assert.equal(discoveryArtworkCredit(MEETUP_POSTER_CREDIT), null);
  assert.equal(discoveryArtworkCredit(CUSTOM_CREDIT), CUSTOM_CREDIT);
  assert.equal(
    discoveryArtworkCredit(`${MEETUP_POSTER_CREDIT}.`),
    `${MEETUP_POSTER_CREDIT}.`,
    "nearby custom wording must not be broadly suppressed",
  );
  assert.equal(
    meetupArtwork().credit,
    MEETUP_POSTER_CREDIT,
    "the source DTO must retain its truthful Meetup provenance",
  );
});

test("event-card discovery hides the Meetup boilerplate but keeps its image semantics and links", () => {
  const markup = renderToStaticMarkup(
    createElement(EventCard, { event: eventCard(MEETUP_POSTER_CREDIT) }),
  );

  assert.doesNotMatch(markup, new RegExp(MEETUP_POSTER_CREDIT, "u"));
  assert.match(markup, /src="\/event-posters\/fixture-1600\.jpeg"/u);
  assert.match(markup, /alt="A vivid event poster with blue circles\."/u);
  assert.match(markup, /href="\/events\/fixture-event"/u);
  assert.match(markup, /View details for Fixture event/u);
});

test("event-card discovery continues to show a distinct custom artwork credit", () => {
  const markup = renderToStaticMarkup(
    createElement(EventCard, { event: eventCard(CUSTOM_CREDIT) }),
  );

  assert.match(markup, /Artwork: Illustration by A\. Neighbour/u);
});

test("selected-day calendar discovery hides only the Meetup boilerplate", () => {
  const meetupMarkup = renderToStaticMarkup(
    createElement(PublicMonthCalendar, calendarProps(MEETUP_POSTER_CREDIT)),
  );
  assert.doesNotMatch(
    meetupMarkup,
    new RegExp(MEETUP_POSTER_CREDIT, "u"),
  );
  assert.match(meetupMarkup, /alt="A vivid event poster with blue circles\."/u);
  assert.match(meetupMarkup, /href="\/events\/fixture-event"/u);
  assert.match(meetupMarkup, />Fixture event<\/a>/u);

  const customMarkup = renderToStaticMarkup(
    createElement(PublicMonthCalendar, calendarProps(CUSTOM_CREDIT)),
  );
  assert.match(customMarkup, /Artwork: Illustration by A\. Neighbour/u);
});

test("homepage discovery hides the repeated Meetup credit in both hero and cards", () => {
  const meetupMarkup = renderToStaticMarkup(
    createElement(HomePageRenderer, homeProps(MEETUP_POSTER_CREDIT)),
  );
  assert.doesNotMatch(
    meetupMarkup,
    new RegExp(MEETUP_POSTER_CREDIT, "u"),
  );
  assert.match(meetupMarkup, /alt="A vivid event poster with blue circles\."/u);
  assert.ok(
    (meetupMarkup.match(/href="\/events\/fixture-event"/gu) ?? []).length >=
      2,
    "hero and event card must keep their event-detail links",
  );

  const customMarkup = renderToStaticMarkup(
    createElement(HomePageRenderer, homeProps(CUSTOM_CREDIT)),
  );
  assert.ok(
    (customMarkup.match(/Artwork: Illustration by A\. Neighbour/gu) ?? [])
      .length >= 2,
    "a distinct custom credit remains useful in both discovery surfaces",
  );
});

test("event detail keeps one primary Meetup credit while a related discovery card omits it", () => {
  const primary = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: "https://club.example/events/fixture-event",
      event: eventDetail(MEETUP_POSTER_CREDIT),
      showCalendarDownload: false,
      showShareControls: false,
    }),
  );
  const related = renderToStaticMarkup(
    createElement(EventCard, {
      compact: true,
      event: eventCard(MEETUP_POSTER_CREDIT, {
        slug: "related-event",
        title: "Related event",
      }),
    }),
  );
  const composedSurface = `${primary}${related}`;

  assert.equal(
    (composedSurface.match(new RegExp(MEETUP_POSTER_CREDIT, "gu")) ?? [])
      .length,
    1,
  );
  assert.match(primary, new RegExp(`Artwork: ${MEETUP_POSTER_CREDIT}`, "u"));
  assert.doesNotMatch(related, new RegExp(MEETUP_POSTER_CREDIT, "u"));
  assert.match(related, /href="\/events\/related-event"/u);
});

function meetupArtwork(credit = MEETUP_POSTER_CREDIT) {
  return Object.freeze({
    altText: "A vivid event poster with blue circles.",
    credit,
    dimensions: Object.freeze({
      large: Object.freeze({ height: 900, width: 1600 }),
      medium: Object.freeze({ height: 540, width: 960 }),
      small: Object.freeze({ height: 270, width: 480 }),
    }),
    focalPoint: Object.freeze({ x: 5000, y: 5000 }),
    srcSet: Object.freeze({
      large: "/event-posters/fixture-1600.jpeg",
      medium: "/event-posters/fixture-960.jpeg",
      small: "/event-posters/fixture-480.jpeg",
    }),
    url: "/event-posters/fixture-1600.jpeg",
  });
}

function eventCard(credit, overrides = {}) {
  return Object.freeze({
    agePolicyText: null,
    arrivalInstructions: null,
    attendanceMode: "in-person",
    availabilityState: "open",
    capacity: 20,
    category: null,
    club: Object.freeze({
      name: "Vancouver Curiosity Club",
      slug: "vancouver-curiosity-club",
    }),
    costText: null,
    artwork: meetupArtwork(credit),
    isCancelled: false,
    lane: Object.freeze({ name: "Explore", slug: "explore" }),
    program: null,
    rsvpMode: "meetup",
    rsvpUrl: "https://www.meetup.com/example/events/123456789/",
    schedule: Object.freeze({
      endsAtUtc: "2026-08-13T04:00:00.000Z",
      kind: "timed",
      startsAtUtc: "2026-08-13T02:00:00.000Z",
      timeZone: "America/Vancouver",
    }),
    slug: "fixture-event",
    status: "confirmed",
    summary: "A concise event summary.",
    title: "Fixture event",
    venue: Object.freeze({
      address: "350 West Georgia Street, Vancouver, BC",
      name: "Vancouver Central Library",
    }),
    waitlistAvailable: false,
    ...overrides,
  });
}

function eventDetail(credit) {
  return Object.freeze({
    ...eventCard(credit),
    description: "A detailed event description.",
    descriptionBlocks: null,
    externalMapUrl: null,
    organizers: Object.freeze([]),
    preparationInformation: null,
    publicAccessNote: null,
    publicOnlineUrl: null,
    verifiedAccessibilityNotes: null,
    weatherNote: null,
    whatToBring: null,
  });
}

function calendarProps(credit) {
  return Object.freeze({
    complete: true,
    events: Object.freeze([eventCard(credit)]),
    maxMonth: "2027-08",
    minMonth: "2025-08",
    month: "2026-08",
    nowUtcMs: Date.parse("2026-08-12T07:00:00.000Z"),
    siteOrigin: "https://club.example",
    todayDate: "2026-08-12",
  });
}

function homeProps(credit) {
  return Object.freeze({
    catalog: Object.freeze({
      clubs: Object.freeze([]),
      communityLinks: Object.freeze([]),
      lanes: Object.freeze([]),
      site: Object.freeze({
        brandName: "Vancouver Curiosity Club",
        legalName: null,
        mission: "A thoughtful Vancouver community.",
      }),
    }),
    events: Object.freeze([eventCard(credit)]),
    origin: null,
    page: Object.freeze({ slug: "home" }),
  });
}
