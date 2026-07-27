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
