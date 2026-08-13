import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventsPageRenderer } from "../../app/_components/EventsPageRenderer.tsx";
import { PublicMonthCalendar } from "../../app/_components/PublicMonthCalendar.tsx";

function event(overrides = {}) {
  return Object.freeze({
    attendanceMode: "in-person",
    artwork: null,
    category: null,
    club: Object.freeze({
      name: "Vancouver Curiosity Club",
      slug: "vancouver-curiosity-club",
    }),
    isCancelled: false,
    lane: Object.freeze({ name: "Reset & Make", slug: "reset-and-make" }),
    program: null,
    rsvpMode: "meetup",
    rsvpUrl: "https://www.meetup.com/example/events/123456789/",
    schedule: Object.freeze({
      endsAtUtc: "2026-08-13T03:00:00.000Z",
      kind: "timed",
      startsAtUtc: "2026-08-13T01:00:00.000Z",
      timeZone: "America/Vancouver",
    }),
    slug: "wednesday-night-reset",
    status: "confirmed",
    summary: "A gentle midweek reset.",
    title: "Wednesday Night Reset",
    venue: Object.freeze({
      address: "350 West Georgia Street, Vancouver, BC",
      name: "Vancouver Central Library",
    }),
    ...overrides,
  });
}

function calendarData(events = Object.freeze([event()])) {
  return Object.freeze({
    events,
    hasMore: false,
    resolvedMonth: Object.freeze({
      invalid: false,
      maxMonth: "2027-08",
      minMonth: "2025-08",
      month: "2026-08",
    }),
    shiftedToUpcoming: false,
  });
}

function calendarProps(overrides = {}) {
  return {
    complete: true,
    events: Object.freeze([event()]),
    laneSlug: "reset-and-make",
    maxMonth: "2027-08",
    minMonth: "2025-08",
    month: "2026-08",
    nowUtcMs: Date.parse("2026-08-11T19:00:00.000Z"),
    siteOrigin: "https://club.example",
    todayDate: "2026-08-11",
    ...overrides,
  };
}

function anchorAttributesForLabel(markup, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = markup.match(
    new RegExp(`<a\\b([^>]*)>${escapedLabel}<\\/a>`, "u"),
  );
  assert.ok(match, `expected a visible ${label} lane link`);
  return match[1];
}

function anchorHrefForLabel(markup, label) {
  const attributes = anchorAttributesForLabel(markup, label);
  const href = attributes.match(/\bhref="([^"]+)"/u)?.[1];
  assert.ok(href, `expected ${label} to have an href`);
  return href.replaceAll("&amp;", "&");
}

test("direct lane query values still normalize and reach the filtered Events loader", async () => {
  const { resolvePublicEventLaneSelection } = await import(
    "../../lib/server/public/event-lane-filter.ts"
  );

  assert.deepEqual(resolvePublicEventLaneSelection(undefined), {
    activeLaneSlug: null,
    invalid: false,
  });
  assert.deepEqual(resolvePublicEventLaneSelection(""), {
    activeLaneSlug: null,
    invalid: false,
  });
  for (const slug of [
    "think",
    "reset-and-make",
    "explore",
    "eat-and-play",
  ]) {
    assert.deepEqual(resolvePublicEventLaneSelection(slug), {
      activeLaneSlug: slug,
      invalid: false,
    });
  }
  for (const invalid of [
    "not-a-real-lane",
    " Reset-and-make ",
    ["reset-and-make"],
    ["think", "explore"],
    null,
  ]) {
    assert.deepEqual(
      resolvePublicEventLaneSelection(invalid),
      { activeLaneSlug: null, invalid: true },
      `unsafe lane value must normalize to All: ${JSON.stringify(invalid)}`,
    );
  }

  const loaderSource = await readFile(
    new URL("../../lib/server/public/events-page.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    loaderSource,
    /laneSlug:\s*parsePublicEventLaneSlug\(input\.laneSlug\)/u,
    "the exported loader must independently allowlist lane values before cache or SQL",
  );

  const pageSource = await readFile(
    new URL("../../app/events/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    pageSource,
    /resolvePublicEventLaneSelection\(raw\.lane\)/u,
    "the Events route must continue accepting direct ?lane= URLs",
  );
  assert.match(
    pageSource,
    /loadPublicEventsPageData\([\s\S]*laneSlug:\s*laneSelection\.activeLaneSlug/u,
    "the allowlisted direct lane selection must reach the Events data loader",
  );
});

test("Events does not render the removed activity-lane filter strip", () => {
  const markup = renderToStaticMarkup(
    createElement(EventsPageRenderer, {
      activeLaneSlug: "reset-and-make",
      calendar: calendarData(),
      calendarAvailable: true,
      invalidLane: false,
      nowUtcMs: Date.parse("2026-08-11T19:00:00.000Z"),
      pageContent: null,
      siteOrigin: "https://club.example",
      todayDate: "2026-08-11",
    }),
  );

  assert.doesNotMatch(
    markup,
    /events-page__lane-filters|aria-label="Filter events by activity lane"|href="\/events\?lane=/iu,
    "the Show / All / lane-chip strip must not be rendered",
  );
  assert.match(markup, /Wednesday Night Reset/u);
});

test("an invalid lane visibly falls back to All events", () => {
  const markup = renderToStaticMarkup(
    createElement(EventsPageRenderer, {
      activeLaneSlug: null,
      calendar: calendarData(),
      calendarAvailable: true,
      invalidLane: true,
      nowUtcMs: Date.parse("2026-08-11T19:00:00.000Z"),
      pageContent: null,
      siteOrigin: "https://club.example",
      todayDate: "2026-08-11",
    }),
  );

  assert.match(markup, /role="alert"[^>]*>[^<]*filter[^<]*all events/iu);
  assert.doesNotMatch(
    markup,
    /events-page__lane-filters|aria-label="Filter events by activity lane"|href="\/events\?lane=/iu,
  );
  assert.match(markup, /Wednesday Night Reset/u);
});

test("a lane-filtered calendar keeps the grid, selected day, and phone agenda consistent", () => {
  const markup = renderToStaticMarkup(
    createElement(PublicMonthCalendar, calendarProps()),
  );
  const gridStart = markup.indexOf('class="public-calendar__grid"');
  const selectedDayStart = markup.indexOf(
    'class="public-calendar__day-panel"',
  );
  const agendaStart = markup.indexOf(
    'class="public-calendar__mobile-agenda"',
  );
  assert.ok(gridStart >= 0 && selectedDayStart > gridStart);
  assert.ok(agendaStart > selectedDayStart);

  const grid = markup.slice(gridStart, selectedDayStart);
  const selectedDay = markup.slice(selectedDayStart, agendaStart);
  const agenda = markup.slice(agendaStart);
  for (const surface of [grid, selectedDay, agenda]) {
    assert.match(surface, /Wednesday Night Reset/u);
    assert.doesNotMatch(surface, /Think-only sentinel/u);
  }
});

test("changing a direct lane query in one month resets selection to the filtered calendar", async () => {
  const renderer = await readFile(
    new URL("../../app/_components/EventsPageRenderer.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    renderer,
    /key=\{[\s\S]{0,120}calendar\.resolvedMonth\.month[\s\S]{0,120}activeLaneSlug/u,
    "the calendar instance must reset when its lane changes in the same month",
  );
});

test("calendar month navigation preserves the selected lane", () => {
  const markup = renderToStaticMarkup(
    createElement(PublicMonthCalendar, calendarProps()),
  );

  for (const [label, month] of [
    ["Previous month", "2026-07"],
    ["Today", "2026-08"],
    ["Next month", "2026-09"],
  ]) {
    const destination = new URL(
      anchorHrefForLabel(markup, label),
      "https://club.example",
    );
    assert.equal(destination.pathname, "/events");
    assert.equal(destination.searchParams.get("month"), month);
    assert.equal(destination.searchParams.get("lane"), "reset-and-make");
  }
});

test("representative Meetup activities receive their real lane instead of Think", async () => {
  const { classifyMeetupEventLaneSlug } = await import(
    "../../lib/server/meetup/event-lane-classifier.ts"
  );
  const examples = [
    ["Contemplative Meditation + Journaling Circle", "reset-and-make"],
    ["Sketching and socializing at Riley Park", "reset-and-make"],
    ["Paddleboarding at Kits Beach", "explore"],
    ["Sunset beach walk", "explore"],
    ["Karaoke Sunday!", "eat-and-play"],
    ["Mangos Latin Dance Night", "eat-and-play"],
  ];

  for (const [title, expectedLane] of examples) {
    const actual = classifyMeetupEventLaneSlug(title);
    assert.equal(actual, expectedLane, title);
    assert.notEqual(actual, "think", title);
  }
  assert.equal(
    classifyMeetupEventLaneSlug("Princess Mononoke"),
    "think",
    "unmatched discussion events retain the Think default",
  );
  assert.equal(
    classifyMeetupEventLaneSlug(
      "Eyes Wide Shut: marriage, desire, and rich-people nightmare rituals",
    ),
    "think",
    "incidental film-title language must not turn a discussion into Reset & Make",
  );
});
