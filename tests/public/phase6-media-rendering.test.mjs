import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventCard } from "../../app/_components/EventCard.tsx";
import {
  focalPointObjectPosition,
  focalPointPercent,
  responsiveImageSrcSet,
} from "../../lib/media/presentation.ts";

test("page and club media render the persisted 0..10000 focal scale as CSS percentages", () => {
  assert.equal(focalPointPercent(0), 0);
  assert.equal(focalPointPercent(5_000), 50);
  assert.equal(focalPointPercent(10_000), 100);
  assert.equal(
    focalPointObjectPosition({ x: 0, y: 10_000 }),
    "0% 100%",
  );
  assert.equal(
    focalPointObjectPosition({ x: 5_000, y: 5_000 }),
    "50% 50%",
  );

  for (const relativePath of [
    "app/_components/EditorialPage.tsx",
    "app/_components/ClubDetailRenderer.tsx",
  ]) {
    const source = readFileSync(join(process.cwd(), relativePath), "utf8");
    assert.match(source, /focalPointObjectPosition/u);
    assert.doesNotMatch(source, /focalPoint\.[xy]\s*\*\s*100/u);
  }
  const editorialSource = readFileSync(
    join(process.cwd(), "app/_components/EditorialPage.tsx"),
    "utf8",
  );
  assert.doesNotMatch(
    editorialSource,
    /\?\?\s*page\.sections\[0\]/u,
    "an arbitrary first block must remain a normal section, not become the intro",
  );
});

test("responsive source sets advertise only the dimensions that actually exist", () => {
  assert.equal(
    responsiveImageSrcSet([
      { url: "/small-480", width: 320 },
      { url: "/small-960", width: 320 },
      { url: "/small-1600", width: 320 },
    ]),
    "/small-1600 320w",
  );
  assert.equal(
    responsiveImageSrcSet([
      { url: "/medium-480", width: 480 },
      { url: "/medium-960", width: 640 },
      { url: "/medium-1600", width: 640 },
    ]),
    "/medium-480 480w, /medium-1600 640w",
  );
  for (const relativePath of [
    "app/_components/ClubDirectory.tsx",
    "app/_components/ClubDetailRenderer.tsx",
    "app/_components/EditorialPage.tsx",
    "app/_components/EventCard.tsx",
    "app/_components/PublicEventDetailRenderer.tsx",
  ]) {
    assert.match(
      readFileSync(join(process.cwd(), relativePath), "utf8"),
      /responsiveImageSrcSet/u,
      `${relativePath} must use the shared exact-width helper`,
    );
  }
});

test("event-card fallback artwork maps every canonical seeded lane slug to its intended tone", () => {
  const lanes = Object.freeze([
    Object.freeze({ name: "Think", slug: "think", tone: "think" }),
    Object.freeze({
      name: "Reset & Make",
      slug: "reset-and-make",
      tone: "reset-make",
    }),
    Object.freeze({ name: "Explore", slug: "explore", tone: "explore" }),
    Object.freeze({
      name: "Eat & Play",
      slug: "eat-and-play",
      tone: "eat-play",
    }),
  ]);

  for (const lane of lanes) {
    const markup = renderToStaticMarkup(
      createElement(EventCard, {
        event: eventCardForLane(lane.name, lane.slug),
      }),
    );
    assert.match(
      markup,
      new RegExp(`field-artwork--${lane.tone}(?:&quot;|")`, "u"),
      `${lane.slug} must render the ${lane.tone} fallback artwork`,
    );
    assert.equal(
      (markup.match(/field-artwork--(?:think|reset-make|explore|eat-play)/gu) ??
        []).length,
      1,
      `${lane.slug} must resolve to one canonical fallback tone`,
    );
  }
});

function eventCardForLane(name, slug) {
  return Object.freeze({
    attendanceMode: "location_undecided",
    artwork: null,
    category: null,
    club: Object.freeze({
      name: "Vancouver Curiosity Club",
      slug: "vancouver-curiosity-club",
    }),
    isCancelled: false,
    lane: Object.freeze({ name, slug }),
    program: null,
    rsvpMode: "coming_soon",
    rsvpUrl: null,
    schedule: Object.freeze({
      endDateExclusive: "2030-06-16",
      kind: "all_day",
      startDate: "2030-06-15",
    }),
    slug: `lane-${slug}`,
    status: "confirmed",
    summary: "A lane-specific event.",
    title: `${name} event`,
    venue: null,
  });
}
