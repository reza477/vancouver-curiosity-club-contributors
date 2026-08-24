import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HomePageRenderer,
  selectHomeDiscoveryEvents,
} from "../../app/_components/HomePageRenderer.tsx";

const requiredSections = [
  "hero",
  "at-a-glance",
  "programs",
  "work-in-action",
  "why-it-matters",
  "partnerships",
  "communities",
  "public-invitation",
];

test("Home renders the approved institutional story in the exact section order", () => {
  const markup = renderHome(upcomingEvents(6));

  assert.deepEqual(
    [...markup.matchAll(/data-home-section="([^"]+)"/gu)].map(
      (match) => match[1],
    ),
    requiredSections,
  );
  assert.equal((markup.match(/<h1\b/gu) ?? []).length, 1);
  assert.match(markup, />Our mission</u);
  assert.match(markup, />Building community through curiosity\.<\/h1>/u);
  assert.match(
    markup,
    /Vancouver Curiosity and Education Society makes meaningful lifelong learning accessible after people leave school or university\. Through Vancouver Curiosity Club, we organize free, facilitated public discussions and learning events involving literature, film, philosophy, ethics, psychology, history, culture and contemporary life\. Our purpose is to encourage curiosity, thoughtful dialogue and meaningful community connection\./u,
  );
  assert.match(markup, /href="#our-work"[^>]*>Explore our work<\/a>/u);
  assert.match(markup, /href="\/for-organizations"[^>]*>Partner with us<\/a>/u);
  assert.doesNotMatch(markup, /home-hero__events-link|>View upcoming events<\/a>/u);
  assert.match(
    markup,
    /href="\/events"[^>]*>View the public event calendar<\/a>/u,
  );
  assert.match(markup, /href="\/events"[^>]*>Explore upcoming events<\/a>/u);
  assert.doesNotMatch(markup, /home-section-heading--split/u);
});

test("Home features one real poster and three distinct later event posters", () => {
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
    eventCard(8),
  ]);
  const selection = selectHomeDiscoveryEvents(reserve);
  const markup = renderHome(reserve);
  const heroSection = homeSection(markup, "hero");
  const workSection = homeSection(markup, "work-in-action");

  assert.equal(selection.heroEvent?.slug, hero.slug);
  assert.deepEqual(
    selection.upcomingEvents.map((event) => event.slug),
    reserve.slice(4, 7).map((event) => event.slug),
  );
  assert.deepEqual(uniqueEventSlugs(heroSection), [hero.slug]);
  assert.deepEqual(
    [...workSection.matchAll(/data-home-event-slug="([^"]+)"/gu)].map(
      (match) => match[1],
    ),
    reserve.slice(4, 7).map((event) => event.slug),
  );
  assert.deepEqual(
    intersection(uniqueEventSlugs(heroSection), uniqueEventSlugs(workSection)),
    [],
  );
  assert.equal((workSection.match(/class="home-work-card"/gu) ?? []).length, 3);
});

test("Home fails closed without artwork instead of showing a blank or fake poster", () => {
  const markup = renderHome(
    Object.freeze([eventCard(1, { artwork: null }), eventCard(2, { artwork: null })]),
  );
  const hero = homeSection(markup, "hero");
  const work = homeSection(markup, "work-in-action");

  assert.match(hero, /class="home-hero home-hero--text-only"/u);
  assert.doesNotMatch(hero, /<figure|<img|home-artwork-fallback/u);
  assert.doesNotMatch(work, /home-work-card/u);
  assert.match(work, /The next public listings are being prepared\./u);
  assert.match(work, /href="\/events"[^>]*>View the public event calendar<\/a>/u);
});

test("Only the featured poster receives eager high-priority loading", () => {
  const markup = renderHome(upcomingEvents(6));
  const images = [...markup.matchAll(/<img\b[^>]*>/gu)].map(
    (match) => match[0],
  );

  assert.equal(images.length, 4);
  assert.match(images[0], /fetchPriority="high"/u);
  assert.match(images[0], /loading="eager"/u);
  for (const image of images.slice(1)) {
    assert.match(image, /loading="lazy"/u);
    assert.doesNotMatch(image, /fetchPriority="high"|loading="eager"/u);
  }
});

test("Home uses a reviewed institutional title without mutating the Meetup title", () => {
  const officeSpace = eventCard(1, {
    rsvpUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/316159440/",
    title:
      "🖨️💼 Office Space at VIFF - work is fake and the printer deserved it",
  });
  const canonicalTitle = officeSpace.title;
  const hero = homeSection(
    renderHome(Object.freeze([officeSpace, ...upcomingEvents(4)])),
    "hero",
  );

  assert.match(hero, />Office Space — Movie Outing at VIFF<\/a>/u);
  assert.doesNotMatch(hero, /printer deserved it/u);
  assert.equal(officeSpace.title, canonicalTitle);
});

test("Home uses evidence-safe impact and partnership language", () => {
  const markup = renderHome(upcomingEvents(4));
  const impact = homeSection(markup, "why-it-matters");
  const partnerships = homeSection(markup, "partnerships");

  assert.match(impact, /Arrive without an existing circle/u);
  assert.match(impact, /Start with something shared/u);
  assert.match(impact, /Have a reason to return/u);
  assert.match(impact, /Find more than one way in/u);
  assert.equal((partnerships.match(/<li>/gu) ?? []).length, 6);
  assert.match(
    partnerships,
    /href="\/contact\?topic=partnerships#contact-form"[^>]*>Discuss a partnership<\/a>/u,
  );
  assert.doesNotMatch(
    `${impact}\n${partnerships}`,
    /registered nonprofit|registered charity|tax[- ]deductible|members? (?:say|report)|attendees? (?:say|report)/iu,
  );
});

function renderHome(events) {
  return renderToStaticMarkup(
    createElement(HomePageRenderer, {
      catalog: catalogFixture(),
      events,
      origin: null,
      page: Object.freeze({ slug: "home" }),
    }),
  );
}

function catalogFixture() {
  const lanes = ["Think", "Reset & Make", "Explore", "Eat & Play"].map(
    (name) =>
      Object.freeze({
        description: `${name} public programs.`,
        name,
        slug: name.toLowerCase().replaceAll(/[^a-z]+/gu, "-").replace(/^-|-$/gu, ""),
      }),
  );
  const clubs = [
    ["Vancouver Curiosity Club", "vancouver-curiosity-club"],
    ["Vancouver Fantasy & Sci-Fi Group", "vancouver-fantasy-scifi-group"],
    ["Vancouver Literature and Film", "vancouver-literature-and-film"],
  ].map(([name, slug]) =>
    Object.freeze({
      archived: false,
      description: `${name} public community.`,
      name,
      publicGroupUrl: `https://www.meetup.com/${slug}/`,
      slug,
    }),
  );
  return Object.freeze({
    clubs: Object.freeze(clubs),
    communityLinks: Object.freeze([]),
    lanes: Object.freeze(lanes),
    site: Object.freeze({
      brandName: "Vancouver Curiosity Club",
      institutionalFacts: Object.freeze({
        attendanceTotal: null,
        attendanceTotalAsOf: null,
        foundedYear: null,
        memberTotal: null,
        memberTotalAsOf: null,
      }),
      legalName: null,
      mission: "A thoughtful Vancouver community.",
    }),
  });
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

function homeSection(markup, name) {
  const start = markup.indexOf(`data-home-section="${name}"`);
  assert.notEqual(start, -1, `${name} section must render`);
  const sectionStart = markup.lastIndexOf("<section", start);
  const sectionEnd = markup.indexOf("</section>", start);
  assert.ok(sectionStart >= 0 && sectionEnd > start);
  return markup.slice(sectionStart, sectionEnd + "</section>".length);
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

function intersection(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}
