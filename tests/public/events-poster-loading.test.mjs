import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventCard } from "../../app/_components/EventCard.tsx";
import { EventsPageRenderer } from "../../app/_components/EventsPageRenderer.tsx";

test("Upcoming eagerly loads the first two real posters and only prioritizes the first", () => {
  const events = Object.freeze([
    eventCard(1, { artwork: null }),
    eventCard(2),
    eventCard(3),
    eventCard(4),
    eventCard(5),
  ]);
  const markup = renderToStaticMarkup(
    createElement(EventsPageRenderer, {
      activeView: "upcoming",
      data: Object.freeze({
        activeClubSlug: null,
        calendar: Object.freeze({
          events: Object.freeze([]),
          hasMore: false,
          resolvedMonth: Object.freeze({
            invalid: false,
            maxMonth: "2027-08",
            minMonth: "2025-08",
            month: "2026-08",
          }),
          shiftedToUpcoming: false,
        }),
        calendarAvailable: true,
        clubOptions: Object.freeze([]),
        invalidClub: false,
        upcoming: Object.freeze({
          events,
          invalidPage: false,
          page: 1,
          pageSize: 12,
          totalCount: events.length,
          totalPages: 1,
        }),
      }),
      nowUtcMs: Date.parse("2026-08-21T19:00:00.000Z"),
      pageContent: null,
      siteOrigin: "https://club.example",
      todayDate: "2026-08-21",
    }),
  );
  const images = [...markup.matchAll(/<img\b[^>]*>/gu)].map(
    (match) => match[0],
  );

  assert.equal(images.length, 4, "the posterless event must not consume an eager slot");
  assert.match(images[0], /fetchPriority="high"/u);
  assert.match(images[0], /loading="eager"/u);
  assert.match(images[1], /fetchPriority="auto"/u);
  assert.match(images[1], /loading="eager"/u);
  for (const image of images.slice(2)) {
    assert.match(image, /fetchPriority="auto"/u);
    assert.match(image, /loading="lazy"/u);
  }
  for (const image of images) {
    assert.match(image, /sizes="\(max-width: 672px\) 92vw/u);
    assert.match(image, /src="\/event-posters\/poster-[2-5]-960\.jpeg"/u);
  }
});

test("event loading frames use a zero-request branded placeholder", async () => {
  const styles = await readFile(
    new URL("../../app/styles/components/editorial.css", import.meta.url),
    "utf8",
  );
  const frameRule = styles.match(
    /\.event-card__artwork-frame,\s*\.event-detail__artwork-frame\s*\{([^}]*)\}/u,
  )?.[1];

  assert.ok(frameRule, "the shared event-poster frame rule must exist");
  assert.match(frameRule, /background-image:\s*linear-gradient\(/u);
  assert.doesNotMatch(frameRule, /background:\s*var\(--ink\)|url\(/u);
  assert.match(
    styles,
    /\.event-card__artwork-frame picture,\s*\.event-detail__artwork-frame picture\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*display:\s*block;/su,
  );
});

test("event-title presentation protects separators and scales only leading emoji", () => {
  const sourceTitle = "🖨️💼 Office Space - work is fake";
  const event = eventCard(9, { title: sourceTitle });
  const markup = renderToStaticMarkup(
    createElement(EventCard, { compact: true, event }),
  );

  assert.match(
    markup,
    /<span class="event-title__emoji">🖨️💼<\/span>/u,
  );
  assert.ok(markup.includes("Office Space\u00a0- work is fake"));
  assert.match(markup, /aria-label="🖨️💼 Office Space - work is fake"/u);
  assert.equal(event.title, sourceTitle);
});

function eventCard(position, overrides = {}) {
  const slug = `poster-${position}`;
  return Object.freeze({
    agePolicyText: null,
    arrivalInstructions: null,
    attendanceMode: "in-person",
    artwork: Object.freeze({
      altText: `Poster ${position}.`,
      credit: "Vancouver Curiosity Club event poster via Meetup",
      dimensions: Object.freeze({
        large: Object.freeze({ height: 900, width: 1600 }),
        medium: Object.freeze({ height: 540, width: 960 }),
        small: Object.freeze({ height: 270, width: 480 }),
      }),
      focalPoint: Object.freeze({ x: 5000, y: 5000 }),
      srcSet: Object.freeze({
        large: `/event-posters/${slug}-1600.jpeg`,
        medium: `/event-posters/${slug}-960.jpeg`,
        small: `/event-posters/${slug}-480.jpeg`,
      }),
      url: `/event-posters/${slug}-1600.jpeg`,
    }),
    availabilityState: "open",
    capacity: 20,
    category: null,
    club: Object.freeze({
      name: "Vancouver Curiosity Club",
      slug: "vancouver-curiosity-club",
    }),
    costText: null,
    isCancelled: false,
    lane: Object.freeze({ name: "Think", slug: "think" }),
    program: null,
    rsvpMode: "meetup",
    rsvpUrl: `https://www.meetup.com/example/events/${position}/`,
    schedule: Object.freeze({
      endsAtUtc: `2026-08-2${position}T04:00:00.000Z`,
      kind: "timed",
      startsAtUtc: `2026-08-2${position}T02:00:00.000Z`,
      timeZone: "America/Vancouver",
    }),
    slug,
    status: "confirmed",
    summary: `Summary ${position}.`,
    title: `Event ${position}`,
    venue: Object.freeze({
      address: "350 West Georgia Street, Vancouver, BC",
      floor: null,
      name: "Vancouver Central Library",
      room: null,
    }),
    waitlistAvailable: false,
    ...overrides,
  });
}
