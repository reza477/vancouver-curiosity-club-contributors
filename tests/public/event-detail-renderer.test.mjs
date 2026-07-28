import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatEventSchedule } from "../../app/_components/EventCard.tsx";
import { PublicEventDetailRenderer } from "../../app/_components/PublicEventDetailRenderer.tsx";

const projectRoot = new URL("../../", import.meta.url);

const TORONTO_EVENT = Object.freeze({
  arrivalInstructions: null,
  attendanceMode: "in-person",
  availabilityState: "open",
  capacity: null,
  category: null,
  club: Object.freeze({ name: "Timezone Club", slug: "timezone-club" }),
  costText: null,
  description: "A public renderer fixture.",
  externalMapUrl: null,
  isCancelled: false,
  lane: null,
  organizers: Object.freeze([]),
  preparationInformation: null,
  publicAccessNote: null,
  publicOnlineUrl: null,
  rsvpMode: "coming_soon",
  rsvpUrl: null,
  schedule: Object.freeze({
    kind: "timed",
    startsAtUtc: "2026-07-27T18:00:00.000Z",
    endsAtUtc: "2026-07-27T19:00:00.000Z",
    timeZone: "America/Toronto",
  }),
  slug: "timezone-event",
  status: "confirmed",
  summary: "The event uses its own IANA timezone.",
  title: "Timezone event",
  venue: null,
  verifiedAccessibilityNotes: null,
  weatherNote: null,
  whatToBring: null,
});

test("public schedule formatting uses the event's IANA timezone", () => {
  const schedule = formatEventSchedule(TORONTO_EVENT);

  assert.match(schedule.label, /2:00 p\.m\./u);
  assert.match(schedule.label, /3:00 p\.m\. EDT/u);
  assert.doesNotMatch(schedule.label, /11:00 a\.m\.|PDT/u);
});

test("the shared detail renderer supports a preview-safe discovery mode", async () => {
  const previewMarkup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: null,
      event: TORONTO_EVENT,
      showShareControls: false,
    }),
  );
  assert.match(previewMarkup, /Times shown in America\/Toronto\./u);
  assert.match(previewMarkup, /The event uses its own IANA timezone\./u);
  assert.match(previewMarkup, /RSVP information coming soon\./u);
  assert.doesNotMatch(previewMarkup, /RSVP on Meetup/u);
  assert.doesNotMatch(previewMarkup, /Share this event|Email link/u);

  const liveMarkup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: "https://preview.example/events/timezone-event",
      event: TORONTO_EVENT,
    }),
  );
  assert.match(liveMarkup, /aria-label="Share this event"/u);
  assert.match(liveMarkup, /Email link/u);

  const eventPage = await readFile(
    new URL("app/events/[slug]/page.tsx", projectRoot),
    "utf8",
  );
  assert.match(eventPage, /<PublicEventDetailRenderer/u);
  assert.doesNotMatch(eventPage, /<article className="event-detail">/u);
  assert.doesNotMatch(eventPage, /<ShareControls/u);
});

test("public event artwork renders only allowlisted media presentation fields", () => {
  const event = Object.freeze({
    ...TORONTO_EVENT,
    artwork: Object.freeze({
      altText: "Abstract field-note shapes.",
      caption: "Private registered charity evidence.",
      credit: "Vancouver Curiosity Club",
      dimensions: Object.freeze({
        large: Object.freeze({ height: 900, width: 1600 }),
        medium: Object.freeze({ height: 540, width: 960 }),
        small: Object.freeze({ height: 270, width: 480 }),
      }),
      focalPoint: Object.freeze({ x: 5000, y: 5000 }),
      privateParticipantConsentNote:
        "Private society registration number.",
      privateRightsSourceNote: "Private CRA charity documentation.",
      srcSet: Object.freeze({
        large: "/media/asset-safe/webp_1600",
        medium: "/media/asset-safe/webp_960",
        small: "/media/asset-safe/webp_480",
      }),
      url: "/media/asset-safe/webp_1600",
    }),
  });
  const markup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: "https://preview.example/events/timezone-event",
      event,
    }),
  );
  assert.match(markup, /alt="Abstract field-note shapes\."/u);
  assert.match(markup, /Artwork: Vancouver Curiosity Club/u);
  assert.match(markup, /height="900".*width="1600"/u);
  assert.doesNotMatch(
    markup,
    /registered charity evidence|society registration|CRA charity/iu,
  );
});

test("public organizer attribution renders rich allowlisted details and suppresses revoked or private fields", () => {
  const richOrganizer = Object.freeze({
    authSubject: "PRIVATE-AUTH-SUBJECT-SENTINEL",
    biography: "A confirmed biography for public event attribution.",
    displayName: "Public Host",
    draftBiography: "PRIVATE-DRAFT-BIOGRAPHY-SENTINEL",
    email: "PRIVATE-ORGANIZER-EMAIL-SENTINEL@example.invalid",
    photo: Object.freeze({
      altText: "Abstract cobalt and forest profile artwork.",
      credit: "Vancouver Curiosity Club",
      height: 320,
      objectKey: "PRIVATE-R2-OBJECT-KEY-SENTINEL",
      privateConsentNote: "PRIVATE-CONSENT-NOTE-SENTINEL",
      privateRightsNote: "PRIVATE-RIGHTS-NOTE-SENTINEL",
      url: "/media/asset-public-host/webp_480",
      width: 480,
    }),
    role: "PRIVATE-ROLE-SENTINEL",
  });
  const duplicateDisplayName = Object.freeze({
    biography: "A second confirmed public biography.",
    displayName: "Public Host",
  });
  const event = Object.freeze({
    ...TORONTO_EVENT,
    organizers: Object.freeze([richOrganizer, duplicateDisplayName]),
  });
  const markup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: "https://preview.example/events/timezone-event",
      event,
    }),
  );

  assert.match(markup, /Your organizers/u);
  assert.equal((markup.match(/<strong>Public Host<\/strong>/gu) ?? []).length, 2);
  assert.match(
    markup,
    /A confirmed biography for public event attribution\./u,
  );
  assert.match(markup, /A second confirmed public biography\./u);
  assert.match(
    markup,
    /src="\/media\/asset-public-host\/webp_480"/u,
  );
  assert.match(
    markup,
    /alt="Abstract cobalt and forest profile artwork\."/u,
  );
  assert.match(markup, /height="320".*width="480"/u);
  assert.match(markup, /Photo: Vancouver Curiosity Club/u);
  for (const sentinel of [
    "PRIVATE-AUTH-SUBJECT-SENTINEL",
    "PRIVATE-DRAFT-BIOGRAPHY-SENTINEL",
    "PRIVATE-ORGANIZER-EMAIL-SENTINEL",
    "PRIVATE-R2-OBJECT-KEY-SENTINEL",
    "PRIVATE-CONSENT-NOTE-SENTINEL",
    "PRIVATE-RIGHTS-NOTE-SENTINEL",
    "PRIVATE-ROLE-SENTINEL",
  ]) {
    assert.doesNotMatch(markup, new RegExp(sentinel, "u"));
  }

  const revokedMarkup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: "https://preview.example/events/timezone-event",
      event: Object.freeze({
        ...event,
        organizers: Object.freeze([]),
      }),
    }),
  );
  assert.doesNotMatch(revokedMarkup, /Your organizer|Public Host/u);
  assert.doesNotMatch(
    revokedMarkup,
    /A confirmed biography for public event attribution/u,
  );
  assert.doesNotMatch(
    revokedMarkup,
    /\/media\/asset-public-host\/webp_480/u,
  );
});
