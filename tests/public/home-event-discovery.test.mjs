import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomePageRenderer } from "../../app/_components/HomePageRenderer.tsx";

test("Home assigns six upcoming events to disjoint chronological discovery regions", () => {
  const events = upcomingEvents(6);
  const markup = renderHome(events);
  const hero = sectionMarkup(markup, "home-hero");
  const next = sectionMarkup(markup, "home-events");

  assert.deepEqual(
    uniqueEventSlugs(hero),
    events.slice(0, 3).map(({ slug }) => slug),
    "the hero collage must retain the first three events in input chronology",
  );
  assert.deepEqual(
    uniqueEventSlugs(next),
    events.slice(3, 6).map(({ slug }) => slug),
    "the next section must continue with the following three events",
  );
  assert.deepEqual(
    eventTitles(hero),
    events.slice(0, 3).map(({ title }) => title),
  );
  assert.deepEqual(
    eventTitles(next),
    events.slice(3, 6).map(({ title }) => title),
  );
  assert.deepEqual(
    intersection(uniqueEventSlugs(hero), uniqueEventSlugs(next)),
    [],
    "an event must not be selected for both discovery regions when six are available",
  );
});

test("Home keeps a fixed chronological split as four or five events become available", () => {
  for (const count of [4, 5]) {
    const events = upcomingEvents(count);
    const markup = renderHome(events);
    const heroSlugs = uniqueEventSlugs(sectionMarkup(markup, "home-hero"));
    const nextSlugs = uniqueEventSlugs(sectionMarkup(markup, "home-events"));

    assert.deepEqual(
      heroSlugs,
      events.slice(0, 3).map(({ slug }) => slug),
      "the hero must keep the first three events in input chronology",
    );
    assert.deepEqual(
      nextSlugs,
      events.slice(3, 6).map(({ slug }) => slug),
      "the card section must continue with every remaining loaded event",
    );
    assert.deepEqual(
      intersection(heroSlugs, nextSlugs),
      [],
      `${count} events provide a non-repeating continuation for the next section`,
    );
  }
});

test("Home keeps one-to-three events in the hero and follows with an honest continuation state", () => {
  for (const count of [1, 2, 3]) {
    const events = upcomingEvents(count);
    const markup = renderHome(events);
    const expectedSlugs = events.map(({ slug }) => slug);
    const expectedTitles = events.map(({ title }) => title);
    const hero = sectionMarkup(markup, "home-hero");
    const next = sectionMarkup(markup, "home-events");

    assert.deepEqual(uniqueEventSlugs(hero), expectedSlugs);
    assert.deepEqual(uniqueEventSlugs(next), []);
    assert.deepEqual(eventTitles(hero), expectedTitles);
    assert.deepEqual(eventTitles(next), []);
    assert.match(
      hero,
      /home-hero__poster-collage/u,
      "the short chronological list remains useful as a poster group",
    );
    assert.match(
      next,
      /<h2 id="home-events-title">More ways to join in<\/h2>/u,
    );
    assert.equal(
      countEventCards(next),
      0,
      "the short list must not be repeated as cards",
    );
    assert.match(next, /class="public-empty-state"/u);
    assert.match(next, /Those are the next gatherings\./u);
    assert.match(next, /<a href="\/events">Open events<\/a>/u);
  }
});

test("Home has a useful zero-event state and no empty poster group", () => {
  const markup = renderHome(Object.freeze([]));
  const hero = sectionMarkup(markup, "home-hero");
  const next = sectionMarkup(markup, "home-events");

  assert.doesNotMatch(hero, /home-hero__poster-collage/u);
  assert.deepEqual(uniqueEventSlugs(hero), []);
  assert.deepEqual(uniqueEventSlugs(next), []);
  assert.match(next, /<h2 id="home-events-title">More ways to join in<\/h2>/u);
  assert.match(next, /No upcoming event yet\./u);
  assert.match(next, /<a href="\/events">Open events<\/a>/u);
});

test("a posterless event selected for the hero remains linked to its detail page", () => {
  const events = Object.freeze([
    eventCard(1, { artwork: null }),
    eventCard(2),
    eventCard(3),
    eventCard(4),
  ]);
  const hero = sectionMarkup(renderHome(events), "home-hero");

  assert.match(hero, /class="home-hero__poster home-hero__poster--fallback"/u);
  assert.match(
    hero,
    /<a[^>]*href="\/events\/chronological-event-1"[^>]*>Chronological event 1<\/a>/u,
  );
});

test("Home event discovery keeps its accessible section and link architecture", () => {
  const markup = renderHome(upcomingEvents(6));
  const hero = sectionMarkup(markup, "home-hero");
  const next = sectionMarkup(markup, "home-events");

  assert.match(hero, /aria-labelledby="home-title"/u);
  assert.match(hero, /id="home-title"/u);
  assert.match(
    hero,
    /class="home-hero__poster-collage" aria-label="Posters for the next upcoming gatherings" role="group"/u,
  );
  assert.match(next, /aria-labelledby="home-events-title"/u);
  assert.match(next, /<h2 id="home-events-title">More ways to join in<\/h2>/u);
  assert.equal(countEventCards(next), 3);
  for (const event of upcomingEvents(6).slice(3, 6)) {
    assert.match(
      next,
      new RegExp(`aria-label="View details for ${event.title}"`, "u"),
    );
  }
});

test("Home gives eager high-priority loading only to the first hero poster", () => {
  const markup = renderHome(upcomingEvents(6));
  const images = [...markup.matchAll(/<img\b[^>]*>/gu)].map(
    (match) => match[0],
  );

  assert.equal(images.length, 6);
  assert.match(images[0], /fetchPriority="high"/u);
  assert.match(images[0], /loading="eager"/u);
  assert.match(
    images[0],
    /src="\/event-posters\/chronological-event-1-1600\.jpeg"/u,
  );
  for (const image of images.slice(1)) {
    assert.match(image, /fetchPriority="auto"/u);
    assert.match(image, /loading="lazy"/u);
    assert.doesNotMatch(image, /fetchPriority="high"|loading="eager"/u);
  }
});

function renderHome(events) {
  return renderToStaticMarkup(
    createElement(HomePageRenderer, {
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
      events,
      origin: null,
      page: Object.freeze({ slug: "home" }),
    }),
  );
}

function upcomingEvents(count) {
  return Object.freeze(
    Array.from({ length: count }, (_, index) => eventCard(index + 1)),
  );
}

function eventCard(position, overrides = {}) {
  const day = String(12 + position).padStart(2, "0");
  const slug = `chronological-event-${position}`;
  return Object.freeze({
    agePolicyText: null,
    arrivalInstructions: null,
    attendanceMode: "in-person",
    artwork: Object.freeze({
      altText: `Poster for Chronological event ${position}.`,
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
      endsAtUtc: `2026-08-${day}T04:00:00.000Z`,
      kind: "timed",
      startsAtUtc: `2026-08-${day}T02:00:00.000Z`,
      timeZone: "America/Vancouver",
    }),
    slug,
    status: "confirmed",
    summary: `Summary for chronological event ${position}.`,
    title: `Chronological event ${position}`,
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

function sectionMarkup(markup, className) {
  const start = markup.indexOf(`<section class="${className}"`);
  assert.notEqual(start, -1, `${className} section must render`);
  const end = markup.indexOf("<section", start + 1);
  return markup.slice(start, end === -1 ? markup.length : end);
}

function uniqueEventSlugs(markup) {
  return [
    ...new Set(
      [...markup.matchAll(/href="\/events\/([^"?#/]+)"/gu)].map(
        (match) => match[1],
      ),
    ),
  ];
}

function eventTitles(markup) {
  return [
    ...markup.matchAll(
      /<a\b[^>]*href="\/events\/[^"?#/]+"[^>]*>([^<]+)<\/a>/gu,
    ),
  ].map((match) => match[1]);
}

function countEventCards(markup) {
  return (markup.match(/<article class="event-card(?: [^"]+)?"/gu) ?? [])
    .length;
}

function intersection(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}
