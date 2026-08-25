import { readPublicCss } from "../helpers/public-css.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClubEventList } from "../../app/_components/ClubEventList.tsx";
import { EventCard } from "../../app/_components/EventCard.tsx";
import { PublicEventDetailRenderer } from "../../app/_components/PublicEventDetailRenderer.tsx";
import { PublicMonthCalendar } from "../../app/_components/PublicMonthCalendar.tsx";
import { CURATED_MEETUP_EVENT_ENRICHMENTS } from "../../lib/meetup-event-enrichment.ts";

const IMPORTED_EVENT_ID = "315560589";
const importedEvent = CURATED_MEETUP_EVENT_ENRICHMENTS[IMPORTED_EVENT_ID];

assert.ok(importedEvent, `Missing curated Meetup event ${IMPORTED_EVENT_ID}`);

test("a discovery card visually excerpts an imported summary without truncating its accessible DOM text", () => {
  const markup = renderToStaticMarkup(
    createElement(EventCard, {
      event: eventCard(importedEvent.summary),
    }),
  );
  const summary = markup.match(
    /<p class="event-discovery-summary">([^<]*)<\/p>/u,
  );

  assert.ok(summary, "the discovery summary needs its own presentation hook");
  assert.equal(
    summary[1],
    importedEvent.summary,
    "visual clamping must leave the complete imported summary in the DOM",
  );
  assert.doesNotMatch(
    summary[0],
    /\b(?:aria-hidden|hidden|inert)=/u,
    "the visual excerpt must remain available to assistive technology",
  );
});

test("owner-authored card copy also remains complete instead of being destructively shortened", () => {
  const ownerSummary =
    "Owner-authored context stays editable and complete in the public markup, even when the discovery card presents it as a short visual excerpt. ".repeat(
      3,
    );
  const markup = renderToStaticMarkup(
    createElement(EventCard, { event: eventCard(ownerSummary) }),
  );

  assert.match(
    markup,
    new RegExp(
      `<p class="event-discovery-summary">${escapeRegex(ownerSummary)}</p>`,
      "u",
    ),
  );
});

test("the shared discovery treatment covers calendar and club event cards without shortening their DOM copy", () => {
  const event = eventCard(importedEvent.summary);
  const clubMarkup = renderToStaticMarkup(
    createElement(ClubEventList, {
      emptyCopy: "No events.",
      events: Object.freeze([event]),
      heading: "Upcoming",
      id: "upcoming-events",
    }),
  );
  const calendarMarkup = renderToStaticMarkup(
    createElement(PublicMonthCalendar, {
      complete: true,
      events: Object.freeze([event]),
      maxMonth: "2027-08",
      minMonth: "2025-08",
      month: "2026-08",
      nowUtcMs: Date.parse("2026-08-15T19:00:00.000Z"),
      siteOrigin: "https://club.example",
      todayDate: "2026-08-15",
    }),
  );

  for (const markup of [clubMarkup, calendarMarkup]) {
    assert.match(markup, /<p class="event-discovery-summary">/u);
    assert.ok(
      markup.includes(importedEvent.summary),
      "each discovery surface must keep the complete imported summary in the DOM",
    );
  }
});

test("the imported long-form description remains complete on the event detail page", () => {
  const markup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: "https://club.example/events/imported-event",
      event: eventDetail(),
      showCalendarDownload: false,
      showShareControls: false,
    }),
  );
  const firstParagraph = importedEvent.description.split(/\n{2,}/u)[0];
  const finalParagraph = importedEvent.description.split(/\n{2,}/u).at(-1);

  assert.ok(firstParagraph);
  assert.ok(finalParagraph);
  assert.ok(markup.includes(firstParagraph));
  assert.ok(markup.includes(finalParagraph));
  assert.doesNotMatch(
    markup,
    /event-detail__deck/u,
    "the event detail must start its narrative in About this event instead of a duplicate teaser",
  );
  assert.doesNotMatch(
    markup,
    /event-discovery-summary/u,
    "the discovery clamp hook must not leak onto the detail page",
  );
});

test("discovery summaries use an accessible two-or-three-line CSS clamp at desktop and mobile widths", async () => {
  const styles = await readPublicCss();

  for (const viewportWidth of [390, 768, 1440]) {
    assert.equal(
      lastDeclarationAtViewport(
        styles,
        ".event-discovery-summary",
        "display",
        viewportWidth,
      ),
      "-webkit-box",
      `the summary needs a line-clamp formatting context at ${viewportWidth}px`,
    );
    assert.equal(
      lastDeclarationAtViewport(
        styles,
        ".event-discovery-summary",
        "-webkit-box-orient",
        viewportWidth,
      ),
      "vertical",
      `the summary clamp needs a vertical orientation at ${viewportWidth}px`,
    );
    assert.equal(
      lastDeclarationAtViewport(
        styles,
        ".event-discovery-summary",
        "overflow",
        viewportWidth,
      ),
      "hidden",
      `the visual excerpt must not spill outside three lines at ${viewportWidth}px`,
    );
    assert.match(
      lastDeclarationAtViewport(
        styles,
        ".event-discovery-summary",
        "-webkit-line-clamp",
        viewportWidth,
      ) ?? "",
      /^[23]$/u,
      `the discovery summary must use two or three lines at ${viewportWidth}px`,
    );
  }

  assert.notEqual(
    lastDeclarationAtViewport(
      styles,
      ".event-card__body > p",
      "display",
      390,
    ),
    "none",
    "mobile discovery must show a short excerpt instead of hiding it",
  );

  for (const selector of selectorsDeclaring(styles, "-webkit-line-clamp")) {
    assert.doesNotMatch(
      selector,
      /\.event-detail/u,
      "event-detail summaries and descriptions must not inherit the card clamp",
    );
  }
});

function eventCard(summary) {
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
    rsvpUrl: `https://www.meetup.com/example/events/${IMPORTED_EVENT_ID}/`,
    schedule: Object.freeze({
      endsAtUtc: "2026-08-16T23:00:00.000Z",
      kind: "timed",
      startsAtUtc: "2026-08-16T21:00:00.000Z",
      timeZone: "America/Vancouver",
    }),
    slug: "imported-event",
    status: "confirmed",
    summary,
    title: "Imported event",
    venue: Object.freeze({
      address: "350 West Georgia Street, Vancouver, BC",
      floor: null,
      name: "Vancouver Central Library",
      room: null,
    }),
    waitlistAvailable: false,
  });
}

function eventDetail() {
  return Object.freeze({
    ...eventCard(importedEvent.summary),
    description: importedEvent.description,
    descriptionBlocks: null,
    externalMapUrl: null,
    metaDescription: null,
    organizers: Object.freeze([]),
    preparationInformation: null,
    publicAccessNote: null,
    publicOnlineUrl: null,
    seoTitle: null,
    verifiedAccessibilityNotes: null,
    weatherNote: null,
    whatToBring: null,
  });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function findClosingBrace(styles, openIndex) {
  let depth = 1;
  for (let index = openIndex + 1; index < styles.length; index += 1) {
    if (styles[index] === "{") depth += 1;
    if (styles[index] === "}") depth -= 1;
    if (depth === 0) return index;
  }
  return styles.length;
}

function mediaBlocks(styles) {
  const blocks = [];
  for (const match of styles.matchAll(/@media\s*([^\{]+)\{/gu)) {
    const openIndex = match.index + match[0].length - 1;
    blocks.push({
      end: findClosingBrace(styles, openIndex),
      query: match[1],
      start: openIndex + 1,
    });
  }
  return blocks;
}

function mediaApplies(query, viewportWidth) {
  const maxWidth = query.match(/max-width:\s*([\d.]+)(px|rem)/u);
  if (
    maxWidth &&
    viewportWidth >
      Number(maxWidth[1]) * (maxWidth[2] === "rem" ? 16 : 1)
  ) {
    return false;
  }
  const minWidth = query.match(/min-width:\s*([\d.]+)(px|rem)/u);
  if (
    minWidth &&
    viewportWidth <
      Number(minWidth[1]) * (minWidth[2] === "rem" ? 16 : 1)
  ) {
    return false;
  }
  return true;
}

function declarationsForPropertyAtViewport(
  styles,
  selector,
  property,
  viewportWidth,
) {
  const declaration = new RegExp(
    `(?:^|;)\\s*${escapeRegex(property)}\\s*:\\s*([^;]+)`,
    "gu",
  );
  const media = mediaBlocks(styles);
  const leafRule = /([^{}]+)\{([^{}]*)\}/gu;
  const declarations = [];

  for (const match of styles.matchAll(leafRule)) {
    const selectors = match[1]
      .split(",")
      .map((candidate) => candidate.trim())
      .filter(Boolean);
    if (!selectors.includes(selector)) continue;

    const enclosingMedia = media.filter(
      (block) => match.index > block.start && match.index < block.end,
    );
    if (
      enclosingMedia.some(
        (block) => !mediaApplies(block.query, viewportWidth),
      )
    ) {
      continue;
    }
    declarations.push(
      ...[...match[2].matchAll(declaration)].map((item) => item[1].trim()),
    );
  }

  return declarations;
}

function lastDeclarationAtViewport(styles, selector, property, viewportWidth) {
  return (
    declarationsForPropertyAtViewport(
      styles,
      selector,
      property,
      viewportWidth,
    ).at(-1) ?? null
  );
}

function selectorsDeclaring(styles, property) {
  const selectors = [];
  const declaration = new RegExp(
    `(?:^|;)\\s*${escapeRegex(property)}\\s*:`,
    "u",
  );
  for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    if (!declaration.test(match[2])) continue;
    selectors.push(
      ...match[1]
        .split(",")
        .map((selector) => selector.trim())
        .filter(Boolean),
    );
  }
  return selectors;
}
