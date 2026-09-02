import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EventCard } from "../../app/_components/EventCard.tsx";
import {
  PUBLIC_PROGRAM_STREAM_NEUTRAL_VISUAL,
  PUBLIC_PROGRAM_STREAM_VISUAL_MAP,
  publicProgramStreamVisualForLaneSlug,
} from "../../lib/public-program-stream-visuals.ts";

const projectRoot = new URL("../../", import.meta.url);

const expectedStreams = Object.freeze([
  Object.freeze({
    accentToken: "--teal",
    canonicalLaneSlug: "think",
    id: "think",
    label: "Think",
  }),
  Object.freeze({
    accentToken: "--coral-strong",
    canonicalLaneSlug: "reset-and-make",
    id: "reset-make",
    label: "Reset & Make",
  }),
  Object.freeze({
    accentToken: "--amber-strong",
    canonicalLaneSlug: "explore",
    id: "explore",
    label: "Explore",
  }),
  Object.freeze({
    accentToken: "--accent",
    canonicalLaneSlug: "eat-and-play",
    id: "eat-play",
    label: "Eat & Play",
  }),
]);

test("the centralized stream map uses stable visual IDs and canonical lane slugs", () => {
  assert.deepEqual(Object.keys(PUBLIC_PROGRAM_STREAM_VISUAL_MAP), [
    "think",
    "reset-make",
    "explore",
    "eat-play",
  ]);

  for (const expected of expectedStreams) {
    const visual = PUBLIC_PROGRAM_STREAM_VISUAL_MAP[expected.id];
    assert.equal(visual.id, expected.id);
    assert.equal(visual.label, expected.label);
    assert.equal(visual.canonicalLaneSlug, expected.canonicalLaneSlug);
    assert.equal(visual.accentToken, expected.accentToken);
    assert.equal(
      publicProgramStreamVisualForLaneSlug(expected.canonicalLaneSlug),
      visual,
    );
    assert.ok(Object.isFrozen(visual));
    assert.ok(Object.isFrozen(visual.style));
  }
  assert.ok(Object.isFrozen(PUBLIC_PROGRAM_STREAM_VISUAL_MAP));
});

test("missing, mixed, legacy, and visual-only values use the neutral navy fallback", () => {
  for (const value of [
    null,
    undefined,
    "",
    "mixed",
    "legacy",
    "reset-make",
    "eat-play",
    "Think",
    " think ",
    42,
  ]) {
    assert.equal(
      publicProgramStreamVisualForLaneSlug(value),
      PUBLIC_PROGRAM_STREAM_NEUTRAL_VISUAL,
      String(value),
    );
  }
  assert.equal(PUBLIC_PROGRAM_STREAM_NEUTRAL_VISUAL.id, "neutral");
  assert.equal(PUBLIC_PROGRAM_STREAM_NEUTRAL_VISUAL.accentToken, "--ink");
  assert.deepEqual(PUBLIC_PROGRAM_STREAM_NEUTRAL_VISUAL.style, {
    "--program-stream-accent": "var(--ink)",
  });
});

test("Events cards opt in to canonical stream accents without mutating event data", () => {
  for (const expected of expectedStreams) {
    const event = eventFixture({
      lane: Object.freeze({
        name: expected.label,
        slug: expected.canonicalLaneSlug,
      }),
      title: "🎨 Misleading title that must not select a stream",
    });
    const before = structuredClone(event);
    const markup = renderToStaticMarkup(
      createElement(EventCard, { event, programStreamAccents: true }),
    );

    assert.match(markup, /event-card--program-stream-accent/u);
    assert.match(
      markup,
      new RegExp(`data-program-stream="${expected.id}"`, "u"),
    );
    assert.match(
      markup,
      new RegExp(
        `style="--program-stream-accent:${escapeRegex(PUBLIC_PROGRAM_STREAM_VISUAL_MAP[expected.id].accentCssValue)}"`,
        "u",
      ),
    );
    assert.match(
      markup,
      new RegExp(
        `<span class="event-card__stream-name">${escapeRegex(escapeHtml(expected.label))}</span>`,
        "u",
      ),
    );
    assert.deepEqual(event, before);
  }

  const misleadingUnknown = eventFixture({
    lane: Object.freeze({ name: "Think", slug: "reset-make" }),
  });
  const unknownMarkup = renderToStaticMarkup(
    createElement(EventCard, {
      event: misleadingUnknown,
      programStreamAccents: true,
    }),
  );
  assert.match(unknownMarkup, /data-program-stream="neutral"/u);
  assert.match(
    unknownMarkup,
    /style="--program-stream-accent:var\(--ink\)"/u,
  );
  assert.match(
    unknownMarkup,
    /<span class="event-card__stream-name">Think<\/span>/u,
  );

  const missingMarkup = renderToStaticMarkup(
    createElement(EventCard, {
      event: eventFixture({ lane: null }),
      programStreamAccents: true,
    }),
  );
  assert.match(missingMarkup, /data-program-stream="neutral"/u);
  assert.doesNotMatch(missingMarkup, /event-card__stream-name/u);
});

test("Prompt 4 remains limited to Four Ways, Home event cards, and Events listings", async () => {
  const [homeSource, eventCardSource, eventsSource, homeCss, eventsCss, sharedCardCss] =
    await Promise.all([
      readFile(
        new URL("app/_components/HomePageRenderer.tsx", projectRoot),
        "utf8",
      ),
      readFile(new URL("app/_components/EventCard.tsx", projectRoot), "utf8"),
      readFile(
        new URL("app/_components/EventsPageRenderer.tsx", projectRoot),
        "utf8",
      ),
      readFile(new URL("app/styles/pages/home.css", projectRoot), "utf8"),
      readFile(new URL("public/styles/events.css", projectRoot), "utf8"),
      readFile(
        new URL("app/styles/components/event-card.css", projectRoot),
        "utf8",
      ),
    ]);

  assert.equal(
    occurrences(homeSource, "publicProgramStreamVisualForLaneSlug("),
    2,
  );
  assert.match(eventsSource, /programStreamAccents/u);
  assert.match(eventCardSource, /programStreamAccents \? streamVisual\.style/u);
  assert.doesNotMatch(
    homeSource.slice(
      homeSource.indexOf("function HomeHeroPoster"),
      homeSource.indexOf("function HomeWorkEvent"),
    ),
    /data-program-stream|program-stream-accent/u,
  );

  assert.match(
    homeCss,
    /\.home-program::before\s*\{[^}]*background:\s*var\(--program-stream-accent\);[^}]*width:\s*0\.4rem;/su,
  );
  assert.match(
    homeCss,
    /\.home-program h3\s*\{[^}]*text-decoration-color:\s*var\(--program-stream-accent\);/su,
  );
  assert.match(
    homeCss,
    /\.home-work-card figure\s*\{[^}]*border-top:\s*0\.4rem solid var\(--program-stream-accent, var\(--ink\)\);/su,
  );
  assert.match(
    homeCss,
    /\.home-work-card__stream-name\s*\{[^}]*text-decoration-color:\s*var\(--program-stream-accent, var\(--ink\)\);/su,
  );
  assert.doesNotMatch(
    homeCss,
    /\.home-program\[data-event-lane=[^}]+background:/su,
  );
  assert.doesNotMatch(
    homeCss,
    /\.home-program\s*\{[^}]*background(?:-color)?:[^;]*var\(--program-stream-accent/su,
  );
  assert.doesNotMatch(
    homeCss,
    /\.home-work-card\s*\{[^}]*background(?:-color)?:[^;]*var\(--program-stream-accent/su,
  );

  assert.match(
    eventsCss,
    /\.events-upcoming__list \.event-card--program-stream-accent\s*\{\s*--event-accent:\s*var\(--ink\);/su,
  );
  assert.match(
    eventsCss,
    /\.event-card__date\s*\{\s*border-bottom-color:\s*var\(--program-stream-accent, var\(--ink\)\);/su,
  );
  assert.match(
    eventsCss,
    /\.event-card__stream-name\s*\{[^}]*text-decoration-color:\s*var\(--program-stream-accent, var\(--ink\)\);/su,
  );
  assert.equal(
    occurrences(eventsCss, "var(--program-stream-accent"),
    2,
  );
  assert.doesNotMatch(
    eventsCss,
    /(?:background|background-color|box-shadow|filter):[^;]*var\(--program-stream-accent/su,
  );
  const scopedEventsAccents = eventsCss.slice(
    eventsCss.indexOf(
      ".events-upcoming__list .event-card--program-stream-accent",
    ),
    eventsCss.indexOf(".events-upcoming__list .event-card h3"),
  );
  assert.doesNotMatch(
    scopedEventsAccents,
    /event-detail|event-list--related|editorial-section|club-detail|public-calendar/iu,
  );
  assert.doesNotMatch(sharedCardCss, /program-stream-accent/u);
  assert.doesNotMatch(`${homeCss}\n${eventsCss}`, /forced-color-adjust:\s*none/iu);
  assert.match(homeCss, /@media \(forced-colors: active\)/u);
  assert.match(eventsCss, /@media \(forced-colors: active\)/u);
});

test("all selected accent tokens meet WCAG AA contrast on the cream surface", async () => {
  const tokens = await readFile(
    new URL("app/styles/tokens.css", projectRoot),
    "utf8",
  );
  const paper = tokenHex(tokens, "--paper");

  for (const visual of [
    ...Object.values(PUBLIC_PROGRAM_STREAM_VISUAL_MAP),
    PUBLIC_PROGRAM_STREAM_NEUTRAL_VISUAL,
  ]) {
    const ratio = contrastRatio(
      tokenHex(tokens, visual.accentToken),
      paper,
    );
    assert.ok(
      ratio >= 4.5,
      `${visual.id} ${visual.accentToken} contrast was ${ratio.toFixed(2)}:1`,
    );
    assert.notEqual(visual.accentToken, "--amber");
    assert.notEqual(visual.accentToken, "--coral");
  }
});

function eventFixture(overrides = {}) {
  return Object.freeze({
    agePolicyText: null,
    arrivalInstructions: null,
    attendanceMode: "in-person",
    artwork: null,
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
    rsvpUrl: "https://www.meetup.com/example/events/1/",
    schedule: Object.freeze({
      endsAtUtc: "2026-09-02T03:00:00.000Z",
      kind: "timed",
      startsAtUtc: "2026-09-02T01:00:00.000Z",
      timeZone: "America/Vancouver",
    }),
    slug: "stream-test-event",
    status: "confirmed",
    summary: "A canonical-data stream test.",
    title: "Canonical stream test",
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

function occurrences(value, fragment) {
  return value.split(fragment).length - 1;
}

function tokenHex(source, name) {
  const match = source.match(
    new RegExp(`${escapeRegex(name)}:\\s*([^;]+);`, "iu"),
  );
  assert.ok(match, `missing ${name}`);
  const value = match[1].trim();
  if (/^#[0-9a-f]{6}$/iu.test(value)) return value;
  const alias = value.match(/^var\((--[\w-]+)\)$/u);
  assert.ok(alias, `unsupported ${name} token value: ${value}`);
  return tokenHex(source, alias[1]);
}

function contrastRatio(left, right) {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16) / 255,
  );
  return channels.reduce(
    (sum, channel, index) =>
      sum +
      (channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4) *
        [0.2126, 0.7152, 0.0722][index],
    0,
  );
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;");
}
