import { readPublicCss } from "../helpers/public-css.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomePageRenderer } from "../../app/_components/HomePageRenderer.tsx";

test("Home leads with one featured poster and three later chronological gatherings", () => {
  const events = upcomingEvents(6);
  const markup = renderHome(events);
  const hero = sectionMarkup(markup, "home-hero");
  const next = sectionMarkup(markup, "home-events");

  assert.deepEqual(
    uniqueEventSlugs(hero),
    [events[0].slug],
    "the hero must feature one event rather than a thumbnail collage",
  );
  assert.deepEqual(
    uniqueEventSlugs(next),
    events.slice(1, 4).map(({ slug }) => slug),
    "the gathering rail must continue chronologically after the hero",
  );
  assert.deepEqual(eventTitles(hero), [events[0].title]);
  assert.deepEqual(eventTitles(next), events.slice(1, 4).map(({ title }) => title));
  assert.deepEqual(
    intersection(uniqueEventSlugs(hero), uniqueEventSlugs(next)),
    [],
    "the featured event must not be repeated in the gathering rail",
  );
});

test("Home scans the durable reserve for unique slugs and artwork URLs", () => {
  const hero = eventCard(1);
  const duplicateArtwork = eventCard(2, { artwork: hero.artwork });
  const duplicateSlug = eventCard(3, { slug: hero.slug });
  const posterless = eventCard(4, { artwork: null });
  const reserve = Object.freeze([
    hero,
    duplicateArtwork,
    duplicateSlug,
    posterless,
    eventCard(5),
    eventCard(6),
    eventCard(7),
  ]);
  const markup = renderHome(reserve);

  assert.deepEqual(
    uniqueEventSlugs(sectionMarkup(markup, "home-hero")),
    [hero.slug],
  );
  assert.deepEqual(
    uniqueEventSlugs(sectionMarkup(markup, "home-events")),
    reserve.slice(4).map(({ slug }) => slug),
    "duplicate identities, duplicate posters, and posterless reserve entries must be skipped",
  );
});

test("Home keeps a useful chronological rail as one-to-four events become available", () => {
  for (const count of [1, 2, 3, 4]) {
    const events = upcomingEvents(count);
    const markup = renderHome(events);
    const hero = sectionMarkup(markup, "home-hero");
    const next = sectionMarkup(markup, "home-events");

    assert.deepEqual(uniqueEventSlugs(hero), [events[0].slug]);
    assert.deepEqual(
      uniqueEventSlugs(next),
      events.slice(1, 4).map(({ slug }) => slug),
    );
    assert.equal(countEventCards(next), Math.min(3, count - 1));
    if (count === 1) {
      assert.match(next, /class="public-empty-state"/u);
      assert.match(next, /Those are the next gatherings\./u);
      assert.match(next, /<a href="\/events">Open events<\/a>/u);
    } else {
      assert.doesNotMatch(next, /class="public-empty-state"/u);
    }
  }
});

test("Home has a useful zero-event state and no empty poster group", () => {
  const markup = renderHome(Object.freeze([]));
  const hero = sectionMarkup(markup, "home-hero");
  const next = sectionMarkup(markup, "home-events");

  assert.doesNotMatch(hero, /home-hero__featured-poster/u);
  assert.deepEqual(uniqueEventSlugs(hero), []);
  assert.deepEqual(uniqueEventSlugs(next), []);
  assert.match(next, /<h2 id="home-events-title">More ways to join in<\/h2>/u);
  assert.match(next, /No upcoming event yet\./u);
  assert.match(next, /<a href="\/events">Open events<\/a>/u);
});

test("a posterless event selected for the hero remains linked to its detail page", () => {
  const events = Object.freeze([
    eventCard(1, { artwork: null }),
  ]);
  const hero = sectionMarkup(renderHome(events), "home-hero");

  assert.match(hero, /class="home-hero__poster home-hero__poster--fallback"/u);
  assert.match(
    hero,
    /<a[^>]*href="\/events\/chronological-event-1"[^>]*>Chronological event 1<\/a>/u,
  );
});

test("Home scans past a posterless first event to keep the hero poster-led", () => {
  const events = Object.freeze([
    eventCard(1, { artwork: null }),
    eventCard(2),
    eventCard(3),
    eventCard(4),
    eventCard(5),
  ]);
  const markup = renderHome(events);

  assert.deepEqual(
    uniqueEventSlugs(sectionMarkup(markup, "home-hero")),
    [events[1].slug],
  );
  assert.deepEqual(
    uniqueEventSlugs(sectionMarkup(markup, "home-events")),
    events.slice(2, 5).map(({ slug }) => slug),
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
    /class="home-hero__featured-poster" aria-label="Featured upcoming gathering" role="group"/u,
  );
  assert.match(next, /aria-labelledby="home-events-title"/u);
  assert.match(next, /<h2 id="home-events-title">More ways to join in<\/h2>/u);
  assert.equal(countEventCards(next), 3);
  for (const event of upcomingEvents(6).slice(1, 4)) {
    assert.match(
      next,
      new RegExp(`aria-label="View details for ${event.title}"`, "u"),
    );
  }
});

test("Home merges newcomer guidance, keeps its mission, and hides empty proof", () => {
  const markup = renderHome(Object.freeze([]));

  assert.equal((markup.match(/class="home-newcomer attending-note"/gu) ?? []).length, 1);
  assert.doesNotMatch(markup, /home-community-feel/u);
  assert.match(markup, /You can come on your own\./u);
  assert.match(markup, /How a gathering begins depends on the event\./u);
  assert.match(markup, /The point is not to perform expertise/u);
  assert.match(markup, /class="home-mission home-community"/u);
  assert.match(markup, /A note from Reza/u);
  assert.doesNotMatch(markup, /class="home-proof home-community"/u);

  const withOfficialLink = renderHome(Object.freeze([]), [
    Object.freeze({
      description: "Official Meetup group",
      label: "Meetup",
      linkType: "meetup_group",
      url: "https://www.meetup.com/vancouver-curiosity-club/",
    }),
  ]);
  assert.match(withOfficialLink, /class="home-proof home-community"/u);
  assert.match(withOfficialLink, /Official community links/u);
});

test("Home gives eager high-priority loading only to the featured poster", () => {
  const markup = renderHome(upcomingEvents(6));
  const images = [...markup.matchAll(/<img\b[^>]*>/gu)].map(
    (match) => match[0],
  );

  assert.equal(images.length, 4);
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

test("Home alternates section treatments and keeps motion preference-safe", async () => {
  const styles = await readPublicCss();

  assert.match(styles, /\.home-newcomer\s*\{[^}]*background:\s*var\(--blue-surface\);/su);
  assert.match(styles, /\.lane-index\s*\{[^}]*background:\s*var\(--paper-deep\);/su);
  const clubCardRules = [
    ...styles.matchAll(/\.home-clubs__grid article\s*\{([^}]*)\}/gsu),
  ].map((match) => match[1]);
  assert.ok(
    clubCardRules.some(
      (rule) =>
        /align-self:\s*start;/u.test(rule) &&
        /background:\s*var\(--paper\);/u.test(rule),
    ),
  );
  assert.match(styles, /\.home-mission\s*\{[^}]*background:\s*var\(--amber-surface\);/su);
  assert.match(styles, /\.home-proof\s*\{[^}]*background:\s*var\(--paper-deep\);/su);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\.home-page > section\s*\{[^}]*animation:\s*[^;]*home-section-enter[^;]*;/su,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.home-page > section\s*\{[^}]*animation:\s*none;/su,
  );
});

function renderHome(events, communityLinks = Object.freeze([])) {
  return renderToStaticMarkup(
    createElement(HomePageRenderer, {
      catalog: Object.freeze({
        clubs: Object.freeze([]),
        communityLinks: Object.freeze(communityLinks),
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
