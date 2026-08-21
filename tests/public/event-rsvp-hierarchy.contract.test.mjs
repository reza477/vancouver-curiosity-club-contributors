import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicEventDetailRenderer } from "../../app/_components/PublicEventDetailRenderer.tsx";

const projectRoot = new URL("../../", import.meta.url);
const RSVP_URL =
  "https://www.meetup.com/vancouver-curiosity-club/events/315508432/";

const EVENT = Object.freeze({
  arrivalInstructions: null,
  attendanceMode: "in-person",
  availabilityState: "open",
  capacity: null,
  category: null,
  club: Object.freeze({
    name: "Vancouver Curiosity Club",
    slug: "vancouver-curiosity-club",
  }),
  costText: null,
  description: "A public event description long enough to sit below the lead.",
  descriptionBlocks: null,
  externalMapUrl: null,
  isCancelled: false,
  lane: Object.freeze({ name: "Think", slug: "think" }),
  organizers: Object.freeze([]),
  preparationInformation: null,
  publicAccessNote: null,
  publicOnlineUrl: null,
  rsvpMode: "meetup",
  rsvpUrl: RSVP_URL,
  schedule: Object.freeze({
    endsAtUtc: "2026-08-20T03:00:00.000Z",
    kind: "timed",
    startsAtUtc: "2026-08-20T01:00:00.000Z",
    timeZone: "America/Vancouver",
  }),
  slug: "canadian-banking-investing-101",
  status: "confirmed",
  summary: "A practical introduction to Canadian banking and investing.",
  title: "Canadian Banking & Investing 101",
  venue: Object.freeze({
    address: "350 West Georgia Street, Vancouver, BC",
    name: "Vancouver Central Library",
  }),
  verifiedAccessibilityNotes: null,
  weatherNote: null,
  whatToBring: null,
});

test("desktop event details place the primary RSVP and essentials beside the poster", () => {
  const markup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl:
        "https://preview.example/events/canadian-banking-investing-101",
      event: EVENT,
      showCalendarDownload: false,
      showShareControls: false,
    }),
  );

  const summaryIndex = markup.indexOf('class="event-detail__summary"');
  const titleIndex = markup.indexOf("<h1>", summaryIndex);
  const deckIndex = markup.indexOf('class="event-detail__deck"', titleIndex);
  const primaryRsvpIndex = markup.indexOf('class="primary-action"');
  const essentialsIndex = markup.indexOf(
    'class="event-detail__facts event-detail__facts--primary"',
  );
  const storyIndex = markup.indexOf('class="event-detail__story"');

  assert.ok(summaryIndex >= 0, "the lead summary must render");
  assert.ok(titleIndex > summaryIndex, "the event title must lead the summary");
  assert.ok(
    primaryRsvpIndex > titleIndex,
    "the desktop RSVP must immediately follow the title",
  );
  assert.ok(
    primaryRsvpIndex < essentialsIndex,
    "the desktop RSVP must appear before the potentially tall essentials section",
  );
  assert.ok(
    essentialsIndex < storyIndex,
    "essentials must remain above the long-form event story",
  );
  assert.ok(
    deckIndex > essentialsIndex && deckIndex < storyIndex,
    "the short summary must fill the poster column before the long-form story",
  );
  assert.equal(
    (markup.match(/class="primary-action"/gu) ?? []).length,
    1,
    "the document must expose one clear in-flow primary action",
  );
});

test("the near-title RSVP becomes the mobile sticky action without a duplicate", async () => {
  const [markup, css, calendarSource] = await Promise.all([
    Promise.resolve(
      renderToStaticMarkup(
        createElement(PublicEventDetailRenderer, {
          canonicalUrl:
            "https://preview.example/events/canadian-banking-investing-101",
          event: EVENT,
          showCalendarDownload: false,
          showShareControls: false,
        }),
      ),
    ),
    readFile(new URL("app/styles/pages/event-detail.css", projectRoot), "utf8"),
    readFile(
      new URL("app/_components/PublicMonthCalendar.tsx", projectRoot),
      "utf8",
    ),
  ]);

  assert.equal(
    (markup.match(new RegExp(`href="${RSVP_URL}"`, "gu")) ?? []).length,
    1,
    "one early-focus RSVP must serve both desktop and mobile",
  );
  assert.match(
    markup,
    /<a(?=[^>]*\baria-label="RSVP for Canadian Banking &amp; Investing 101 on Meetup \(opens in a new tab\)")(?=[^>]*\bclass="primary-action")(?=[^>]*\bhref="https:\/\/www\.meetup\.com\/vancouver-curiosity-club\/events\/315508432\/")(?=[^>]*\brel="noreferrer noopener")(?=[^>]*\btarget="_blank")[^>]*>/u,
    "the arrow-marked event-detail RSVP must explicitly open in a new tab",
  );
  assert.match(
    calendarSource,
    /aria-label="RSVP on Meetup \(opens in a new tab\)"[\s\S]*?rel="noreferrer noopener"[\s\S]*?target="_blank"/u,
    "calendar and event-detail RSVP behavior must stay consistent",
  );
  assert.doesNotMatch(markup, /event-detail__mobile-rsvp/u);

  const mobileStart = css.lastIndexOf("@media (max-width: 38rem)");
  const mobileEnd = css.length;
  const mobileStyles = css.slice(mobileStart, mobileEnd);
  const stickyRule = mobileStyles.match(
    /\.event-detail__summary\s*>\s*\.primary-action\s*\{([^}]*)\}/su,
  )?.[1] ?? "";
  assert.match(stickyRule, /position:\s*fixed;/u);
  assert.match(stickyRule, /display:\s*flex;/u);
  assert.match(stickyRule, /min-height:\s*3\.25rem;/u, "the same early-focus RSVP must become sticky and comfortably tappable");
});
