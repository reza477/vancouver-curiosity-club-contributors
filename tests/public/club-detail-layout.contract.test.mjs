import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClubDetailRenderer } from "../../app/_components/ClubDetailRenderer.tsx";

const projectRoot = new URL("../../", import.meta.url);

test("an empty Past rail lets Upcoming use the full club-detail width", async () => {
  const club = clubFixture();
  const markup = renderClub(club, {
    past: eventPage("past", []),
    upcoming: eventPage("upcoming", [eventFixture(club, "next-gathering")]),
  });

  assert.equal(
    (markup.match(/class="club-event-list"/gu) ?? []).length,
    1,
  );
  assert.match(markup, /id="club-upcoming"[^>]*>Upcoming<\/h2>/u);
  assert.doesNotMatch(markup, /id="club-past"|No past events are listed/u);

  const css = await readFile(
    new URL("app/styles/components/catalog.css", projectRoot),
    "utf8",
  );
  const eventListRule = css.match(/\.club-event-list\s*\{([^}]*)\}/u)?.[1];
  assert.ok(eventListRule, "missing club event-list layout rule");
  assert.match(
    eventListRule,
    /flex:\s*1\s+1\s+32rem/u,
    "the sole Upcoming rail must expand across the available row",
  );
});

test("a populated Past rail remains available beside Upcoming", () => {
  const club = clubFixture();
  const markup = renderClub(club, {
    past: eventPage("past", [eventFixture(club, "past-gathering")]),
    upcoming: eventPage("upcoming", [eventFixture(club, "next-gathering")]),
  });

  assert.equal(
    (markup.match(/class="club-event-list"/gu) ?? []).length,
    2,
  );
  assert.match(markup, /id="club-upcoming"[^>]*>Upcoming<\/h2>/u);
  assert.match(markup, /id="club-past"[^>]*>Past<\/h2>/u);
});

test("the umbrella club is labelled as multi-stream without changing real lane taxonomy", () => {
  const umbrellaMarkup = renderClub(clubFixture(), {
    past: eventPage("past", []),
    upcoming: eventPage("upcoming", []),
  });
  assert.match(
    umbrellaMarkup,
    /<p class="eyebrow">Multiple program streams<\/p>/u,
  );
  assert.doesNotMatch(umbrellaMarkup, /<p class="eyebrow">Think<\/p>/u);

  const focusedClub = clubFixture({
    name: "Vancouver Literature and Film",
    slug: "vancouver-literature-and-film",
  });
  const focusedMarkup = renderClub(focusedClub, {
    past: eventPage("past", []),
    upcoming: eventPage("upcoming", []),
  });
  assert.match(focusedMarkup, /<p class="eyebrow">Think<\/p>/u);
});

function renderClub(club, { past, upcoming }) {
  return renderToStaticMarkup(
    createElement(ClubDetailRenderer, {
      club,
      coverMedia: null,
      events: Object.freeze({
        kind: "available",
        past,
        upcoming,
      }),
    }),
  );
}

function clubFixture(overrides = {}) {
  return Object.freeze({
    archived: false,
    coverAssetId: null,
    description: "Talks, discussions, and shared learning across subjects.",
    featured: true,
    fullDescription: null,
    imageAltText: null,
    lane: Object.freeze({ name: "Think", slug: "think" }),
    metaDescription: null,
    name: "Vancouver Curiosity Club",
    openGraphAssetId: null,
    participantExpectations: null,
    preparationInformation: null,
    programType: null,
    publicGroupUrl: null,
    relatedResources: Object.freeze([]),
    seoTitle: null,
    slug: "vancouver-curiosity-club",
    socialLinks: Object.freeze([]),
    themeColor: null,
    thumbnailAssetId: null,
    typicalFormat: null,
    ...overrides,
  });
}

function eventPage(view, events) {
  return Object.freeze({
    events: Object.freeze(events),
    hasMore: false,
    page: 1,
    pageSize: 6,
    totalCount: events.length,
    view,
  });
}

function eventFixture(club, slug) {
  return Object.freeze({
    attendanceMode: "in-person",
    club: Object.freeze({ name: club.name, slug: club.slug }),
    isCancelled: false,
    lane: club.lane,
    rsvpMode: "meetup",
    rsvpUrl: `https://www.meetup.com/example/events/${slug}/`,
    schedule: Object.freeze({
      endsAtUtc: "2026-09-11T04:00:00.000Z",
      kind: "timed",
      startsAtUtc: "2026-09-11T02:00:00.000Z",
      timeZone: "America/Vancouver",
    }),
    slug,
    status: "confirmed",
    summary: "A published gathering.",
    title: slug === "past-gathering" ? "Past gathering" : "Next gathering",
    venue: null,
  });
}
