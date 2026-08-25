import { readPublicCss } from "../helpers/public-css.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EventCard,
  formatEventSchedule,
} from "../../app/_components/EventCard.tsx";
import { PublicEventDetailRenderer } from "../../app/_components/PublicEventDetailRenderer.tsx";
import {
  CURATED_MEETUP_EVENT_ENRICHMENTS,
  meetupDescriptionBlocksForDisplay,
} from "../../lib/meetup-event-enrichment.ts";

const projectRoot = new URL("../../", import.meta.url);

const TORONTO_EVENT = Object.freeze({
  arrivalInstructions: null,
  attendanceMode: "in-person",
  availabilityState: "open",
  capacity: null,
  category: null,
  club: Object.freeze({ name: "Timezone Club", slug: "timezone-club" }),
  costText: null,
  description: "A public renderer fixture.",
  descriptionBlocks: null,
  externalMapUrl: null,
  isCancelled: false,
  lane: null,
  organizers: Object.freeze([]),
  preparationInformation: null,
  publicAccessNote: null,
  publicOnlineUrl: null,
  rsvpMode: "coming_soon",
  rsvpUrl: null,
  schedule: Object.freeze({
    kind: "timed",
    startsAtUtc: "2026-07-27T18:00:00.000Z",
    endsAtUtc: "2026-07-27T19:00:00.000Z",
    timeZone: "America/Toronto",
  }),
  slug: "timezone-event",
  status: "confirmed",
  summary: "The event uses its own IANA timezone.",
  title: "Timezone event",
  venue: null,
  verifiedAccessibilityNotes: null,
  weatherNote: null,
  whatToBring: null,
});

function wednesdayResetEvent() {
  return Object.freeze({
    ...TORONTO_EVENT,
    arrivalInstructions: "Please arrive on time so we can begin together.",
    attendanceMode: "in-person",
    availabilityState: null,
    capacity: 12,
    club: Object.freeze({
      name: "Vancouver Curiosity Club",
      slug: "vancouver-curiosity-club",
    }),
    title: "Wednesday Night Reset",
    venue: Object.freeze({
      address: "350 West Georgia Street, Vancouver, BC",
      floor: "Level 4",
      name: "Vancouver Central Library",
      room: "Room 492 South",
    }),
    waitlistAvailable: true,
  });
}

function renderImportedMeetupDescription(eventId) {
  const imported = CURATED_MEETUP_EVENT_ENRICHMENTS[eventId];
  assert.ok(imported, `Missing curated Meetup event ${eventId}`);
  return renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: `https://preview.example/events/meetup-${eventId}`,
      event: Object.freeze({
        ...TORONTO_EVENT,
        description: imported.description,
        descriptionBlocks: imported.descriptionBlocks,
        summary: imported.summary,
        title: `Imported Meetup event ${eventId}`,
      }),
      showCalendarDownload: false,
      showShareControls: false,
    }),
  );
}

function paragraphContaining(markup, text) {
  return (markup.match(/<p(?: [^>]*)?>[\s\S]*?<\/p>/gu) ?? []).find(
    (paragraph) => paragraph.includes(text),
  );
}

test("curated Meetup descriptions render semantic headings, lists, and links", () => {
  const markup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: "https://preview.example/events/rich-event",
      event: Object.freeze({
        ...TORONTO_EVENT,
        description: "Ticket note\n\nBuy your VIFF ticket here: Open viff.org",
        descriptionBlocks: Object.freeze([
          Object.freeze({
            content: Object.freeze([
              Object.freeze({ text: "Ticket note", type: "text" }),
            ]),
            level: 3,
            type: "heading",
          }),
          Object.freeze({
            items: Object.freeze([
              Object.freeze([
                Object.freeze({
                  text: "Meet outside the cinema.",
                  type: "text",
                }),
              ]),
              Object.freeze([
                Object.freeze({
                  text: "Bring one question.",
                  type: "strong",
                }),
              ]),
            ]),
            type: "unordered-list",
          }),
          Object.freeze({
            content: Object.freeze([
              Object.freeze({
                text: "Buy your VIFF ticket here: ",
                type: "text",
              }),
              Object.freeze({
                href: "https://viff.org/whats-on/example/book/abc",
                text: "Open viff.org",
                type: "link",
              }),
            ]),
            type: "paragraph",
          }),
        ]),
      }),
    }),
  );

  assert.match(markup, /<h3><span>Ticket note<\/span><\/h3>/u);
  assert.match(markup, /<ul><li>.*Meet outside the cinema\..*<\/li>/u);
  assert.match(markup, /<strong>Bring one question\.<\/strong>/u);
  assert.match(
    markup,
    /href="https:\/\/viff\.org\/whats-on\/example\/book\/abc"/u,
  );
  assert.match(markup, /rel="noreferrer noopener"/u);
  assert.match(markup, /class="event-detail__rich-description"/u);
  assert.match(markup, />Event information<\/p>/u);
  assert.doesNotMatch(markup, />Field notes?<\/p>/iu);
  assert.doesNotMatch(markup, /dangerouslySetInnerHTML/u);
});

test("display policy removes ticket and RSVP calls to action without a vetted href", () => {
  const blocks = Object.freeze([
    Object.freeze({
      content: Object.freeze([
        Object.freeze({ text: "A useful public event note.", type: "text" }),
      ]),
      type: "paragraph",
    }),
    Object.freeze({
      content: Object.freeze([
        Object.freeze({ text: "Buy your ticket here:", type: "text" }),
      ]),
      type: "paragraph",
    }),
    Object.freeze({
      content: Object.freeze([
        Object.freeze({ text: "RSVP here: ", type: "text" }),
        Object.freeze({
          href: "https://tickets.example.invalid/buy",
          text: "Register now",
          type: "link",
        }),
      ]),
      type: "paragraph",
    }),
  ]);
  const display = meetupDescriptionBlocksForDisplay(blocks);
  assert.deepEqual(display, [blocks[0]]);
  assert.doesNotMatch(JSON.stringify(display), /buy your ticket|rsvp|register/iu);
});

test("affected Meetup imports keep structure and attach every source link to its call to action", async (t) => {
  const viffTicketEvents = Object.freeze([
    Object.freeze({
      eventId: "315508432",
      name: "Princess Mononoke literature listing",
      ticketUrl:
        "https://viff.org/whats-on/princess-mononoke/book/Vaejexo2jS",
    }),
    Object.freeze({
      eventId: "315508537",
      name: "Titanic literature listing",
      ticketUrl: "https://viff.org/whats-on/titanic/book/F8fYoDZ6RC",
    }),
    Object.freeze({
      eventId: "315510842",
      name: "Matrix literature listing",
      ticketUrl: "https://viff.org/whats-on/the-matrix/book/wKDENUM0oc",
    }),
    Object.freeze({
      eventId: "315511475",
      name: "Princess Mononoke main-group listing",
      ticketUrl:
        "https://viff.org/whats-on/princess-mononoke/book/Vaejexo2jS",
    }),
    Object.freeze({
      eventId: "315511480",
      name: "Titanic main-group listing",
      ticketUrl: "https://viff.org/whats-on/titanic/book/F8fYoDZ6RC",
    }),
    Object.freeze({
      eventId: "315511485",
      name: "Matrix main-group listing",
      ticketUrl: "https://viff.org/whats-on/the-matrix/book/wKDENUM0oc",
    }),
  ]);

  for (const { eventId, name, ticketUrl } of viffTicketEvents) {
    await t.test(name, () => {
      const markup = renderImportedMeetupDescription(eventId);
      assert.match(markup, /<h3>/u);
      assert.match(markup, /<p>/u);
      assert.match(markup, /<ul>/u);
      const ticketParagraph = paragraphContaining(
        markup,
        "Buy your VIFF ticket here",
      );
      assert.ok(ticketParagraph, `${eventId} lost its ticket call to action`);
      assert.ok(
        ticketParagraph.includes(
          `<a href="${ticketUrl}" rel="noreferrer noopener">Buy your VIFF ticket here</a>`,
        ),
        `${eventId} rendered its ticket call to action without its VIFF link`,
      );
      assert.doesNotMatch(markup, /Open viff\.org/u);
      assert.doesNotMatch(
        markup,
        /<span>Buy your VIFF ticket here:?\s*<\/span>/u,
      );
    });
  }

  const magnificaMarkup = renderImportedMeetupDescription("315592402");
  await t.test("Magnifica Humanitas preserves structure and its official source", () => {
    assert.match(magnificaMarkup, /<h3>/u);
    assert.match(magnificaMarkup, /<p>/u);
    assert.match(magnificaMarkup, /<ul>/u);
    const officialTextParagraph = paragraphContaining(
      magnificaMarkup,
      "Official Vatican text",
    );
    assert.ok(
      officialTextParagraph,
      "Magnifica Humanitas lost its official source CTA",
    );
    assert.ok(
      officialTextParagraph.includes(
        '<a href="https://www.vatican.va/content/leo-xiv/en/encyclicals/documents/20260515-magnifica-humanitas.html" rel="noreferrer noopener">Official Vatican text</a>',
      ),
      "Magnifica Humanitas rendered its official source CTA without the Vatican link",
    );
    assert.doesNotMatch(magnificaMarkup, /Open vatican\.va/u);
    assert.doesNotMatch(
      magnificaMarkup,
      /<span>Official Vatican text:?\s*<\/span>/u,
    );
  });

  await t.test("Magnifica Humanitas attaches its reading link to the CTA", () => {
    const readingParagraph = paragraphContaining(
      magnificaMarkup,
      "Reading Magnifica Humanitas - my summary of it",
    );
    assert.ok(readingParagraph, "Magnifica Humanitas lost its reading CTA");
    assert.ok(
      readingParagraph.includes(
        '<a href="https://drive.google.com/file/d/14_5C0FIh6IEZdnK_HUFgTL0iA4jvtTkV/view" rel="noreferrer noopener">Reading Magnifica Humanitas - my summary of it</a>',
      ),
      "Magnifica Humanitas rendered its reading CTA without the Drive link",
    );
    assert.doesNotMatch(magnificaMarkup, /Open drive\.google\.com/u);
    assert.doesNotMatch(
      magnificaMarkup,
      /<span>Reading Magnifica Humanitas - my summary of it\s*:?\s*<\/span>/u,
    );
  });
});

test("the published Banking import renders a clean heading and human-readable duration", () => {
  const markup = renderImportedMeetupDescription("315936856");

  assert.match(markup, /<h3><span>IMPORTANT<\/span><\/h3>/u);
  assert.match(markup, /The session is designed to take ~30 minutes/u);
  assert.doesNotMatch(markup, /\*\*\s*IMPORTANT\s*\*\*|\\~30 minutes/u);
});

test("the published paddleboarding snapshot restores its vetted lesson link", () => {
  const markup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: "https://preview.example/events/paddleboarding",
      event: Object.freeze({
        ...TORONTO_EVENT,
        description: "External resource",
        descriptionBlocks: Object.freeze([
          Object.freeze({
            content: Object.freeze([
              Object.freeze({ text: "External resource", type: "text" }),
            ]),
            type: "paragraph",
          }),
        ]),
        rsvpMode: "meetup",
        rsvpUrl:
          "https://www.meetup.com/vancouver-meetup-group/events/316069135/",
        title: "Finding Your People: Last-Minute Paddleboarding at Deep Cove",
      }),
      showCalendarDownload: false,
      showShareControls: false,
    }),
  );

  assert.match(
    markup,
    /<a href="https:\/\/deepcovekayak\.com\/lesson\/intro-to-sup\/" rel="noreferrer noopener">Open deepcovekayak\.com<\/a>/u,
  );
  assert.doesNotMatch(markup, /<span>External resource<\/span>/u);
});

test("the paddleboarding compatibility repair is exact, narrow, and idempotent", () => {
  const eventUrl =
    "https://www.meetup.com/vancouver-meetup-group/events/316069135/";
  const standalone = Object.freeze([
    Object.freeze({
      content: Object.freeze([
        Object.freeze({ text: "External resource", type: "text" }),
      ]),
      type: "paragraph",
    }),
  ]);
  const repaired = meetupDescriptionBlocksForDisplay(standalone, eventUrl);
  assert.equal(repaired[0].content[0].type, "link");
  assert.deepEqual(
    meetupDescriptionBlocksForDisplay(repaired, eventUrl),
    repaired,
  );
  assert.deepEqual(
    meetupDescriptionBlocksForDisplay(
      standalone,
      "https://www.meetup.com/vancouver-meetup-group/events/316069136/",
    ),
    standalone,
  );

  const mixed = Object.freeze([
    Object.freeze({
      content: Object.freeze([
        Object.freeze({ text: "External resource", type: "text" }),
        Object.freeze({ text: " remains contextual.", type: "text" }),
      ]),
      type: "paragraph",
    }),
  ]);
  assert.deepEqual(
    meetupDescriptionBlocksForDisplay(mixed, eventUrl),
    mixed,
  );
});

test("legacy late-arrival prose regains its heading without changing unrelated paragraphs", () => {
  const legacy = Object.freeze([
    Object.freeze({
      content: Object.freeze([
        Object.freeze({
          text: "Please arrive early. Important note about being late Because the room settles together, late arrivals may not be admitted.",
          type: "text",
        }),
      ]),
      type: "paragraph",
    }),
  ]);
  const repaired = meetupDescriptionBlocksForDisplay(legacy);
  assert.deepEqual(repaired, [
    {
      content: [{ text: "Please arrive early.", type: "text" }],
      type: "paragraph",
    },
    {
      content: [{ text: "Important note about being late", type: "text" }],
      level: 3,
      type: "heading",
    },
    {
      content: [
        {
          text: "Because the room settles together, late arrivals may not be admitted.",
          type: "text",
        },
      ],
      type: "paragraph",
    },
  ]);
  assert.deepEqual(meetupDescriptionBlocksForDisplay(repaired), repaired);

  const unrelated = Object.freeze([
    Object.freeze({
      content: Object.freeze([
        Object.freeze({ text: "Because this is unrelated.", type: "text" }),
      ]),
      type: "paragraph",
    }),
  ]);
  assert.deepEqual(meetupDescriptionBlocksForDisplay(unrelated), unrelated);
});

test("legacy Autism and summer-cinema placeholders regain only their vetted links", () => {
  const autismBlocks = Object.freeze([
    Object.freeze({
      items: Object.freeze([
        Object.freeze([
          Object.freeze({ text: "External resource", type: "text" }),
        ]),
      ]),
      type: "unordered-list",
    }),
    Object.freeze({
      content: Object.freeze([
        Object.freeze({
          text: "90| Autism: The Big Picture – A Conversation With Sir Simon Baron\\-Cohen",
          type: "text",
        }),
      ]),
      level: 3,
      type: "heading",
    }),
  ]);
  const autism = meetupDescriptionBlocksForDisplay(
    autismBlocks,
    "https://www.meetup.com/vancouver-meetup-group/events/315969091/",
  );
  assert.deepEqual(autism[0].items[0][0], {
    href: "https://cambridgecognition.com/autism-spectrum-disorder/",
    text: "Open cambridgecognition.com",
    type: "link",
  });
  assert.equal(autism[1].content[0].text.includes("Baron-Cohen"), true);

  const cinemaBlocks = Object.freeze([
    Object.freeze({
      content: Object.freeze([
        Object.freeze({
          text: "Official Evo Summer Cinema details: External resource",
          type: "text",
        }),
      ]),
      type: "paragraph",
    }),
  ]);
  const cinema = meetupDescriptionBlocksForDisplay(
    cinemaBlocks,
    "https://www.meetup.com/vancouver-meetup-group/events/316069183/",
  );
  assert.deepEqual(cinema[0].content[0], {
    href: "https://summercinema.ca/",
    text: "Official Evo Summer Cinema details",
    type: "link",
  });
  assert.deepEqual(
    meetupDescriptionBlocksForDisplay(
      cinemaBlocks,
      "https://www.meetup.com/vancouver-meetup-group/events/316069184/",
    ),
    cinemaBlocks,
  );
});

test("event cards lead with a poster and expose verified associations and location facts", () => {
  const markup = renderToStaticMarkup(
    createElement(EventCard, {
      compact: true,
      event: Object.freeze({
        ...TORONTO_EVENT,
        attendanceMode: "location-undecided",
        artwork: Object.freeze({
          altText: "A confirmed event poster.",
          credit: "Vancouver Curiosity Club",
          dimensions: Object.freeze({
            large: Object.freeze({ height: 900, width: 600 }),
            medium: Object.freeze({ height: 720, width: 480 }),
            small: Object.freeze({ height: 360, width: 240 }),
          }),
          focalPoint: Object.freeze({ x: 5000, y: 5000 }),
          srcSet: Object.freeze({
            large: "/media/poster/webp_1600",
            medium: "/media/poster/webp_960",
            small: "/media/poster/webp_480",
          }),
          url: "/media/poster/webp_1600",
        }),
        category: Object.freeze({
          colorToken: "cobalt",
          name: "City culture",
          slug: "city-culture",
        }),
        lane: Object.freeze({ name: "Explore", slug: "explore" }),
        venue: Object.freeze({
          address: "350 W Georgia Street, Vancouver",
          name: "Vancouver Public Library",
        }),
      }),
    }),
  );

  const posterIndex = markup.indexOf('class="event-card__artwork"');
  const bodyIndex = markup.indexOf('class="event-card__body"');
  assert.ok(posterIndex >= 0);
  assert.ok(bodyIndex > posterIndex);
  assert.match(markup, /alt="A confirmed event poster."/u);
  assert.match(markup, />Timezone Club<\/a>/u);
  assert.match(markup, />Explore<\/span>/u);
  assert.match(markup, />City culture<\/span>/u);
  assert.match(markup, /Vancouver Public Library/u);
  assert.match(markup, /350 W Georgia Street, Vancouver/u);
  assert.doesNotMatch(markup, /Location undecided/u);
});

test("Wednesday Night Reset surfaces its room and waitlist capacity on event cards", () => {
  const cardMarkup = renderToStaticMarkup(
    createElement(EventCard, { compact: true, event: wednesdayResetEvent() }),
  );
  assert.match(cardMarkup, /Level 4/u);
  assert.match(cardMarkup, /Room 492 South/u);
  assert.match(
    cardMarkup.replace(/<[^>]+>/gu, " "),
    /12\s+\+\s+waitlist/iu,
  );
});

test("Wednesday Night Reset surfaces its room and waitlist capacity in detail facts", () => {
  const detailMarkup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: "https://preview.example/events/wednesday-night-reset",
      event: wednesdayResetEvent(),
      showCalendarDownload: true,
      showShareControls: false,
    }),
  );
  assert.match(detailMarkup, /Level 4/u);
  assert.match(detailMarkup, /Room 492 South/u);
  assert.match(
    detailMarkup.replace(/<[^>]+>/gu, " "),
    /Capacity\s+12\s+\+\s+waitlist/iu,
    "capacity and waitlist status must appear as one useful planning fact",
  );
});

test("event leads keep RSVP and lane-specific poster fallback near the title", () => {
  const rsvpUrl =
    "https://www.meetup.com/vancouver-curiosity-club/events/123456789/";
  const markup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: "https://preview.example/events/timezone-event",
      event: Object.freeze({
        ...TORONTO_EVENT,
        category: Object.freeze({
          colorToken: null,
          name: "City culture",
          slug: "city-culture",
        }),
        lane: Object.freeze({ name: "Explore", slug: "explore" }),
        rsvpMode: "external",
        rsvpUrl,
      }),
    }),
  );

  const leadIndex = markup.indexOf('class="event-detail__lead"');
  const artworkIndex = markup.indexOf('class="event-detail__artwork');
  const summaryIndex = markup.indexOf('class="event-detail__summary"');
  assert.ok(leadIndex >= 0);
  assert.ok(summaryIndex > leadIndex);
  assert.ok(artworkIndex > summaryIndex);
  assert.match(markup, /data-event-lane="explore"/u);
  assert.match(markup, /<strong>Explore<\/strong>/u);
  assert.match(markup, /Gathering in the Explore lane/u);
  assert.match(markup, /Explore · City culture/u);
  assert.equal(
    (markup.match(new RegExp(`href="${rsvpUrl}"`, "gu")) ?? []).length,
    1,
  );
  assert.match(
    markup,
    /aria-label="RSVP for Timezone event on Meetup \(opens in a new tab\)"/u,
  );
  assert.match(markup, /class="primary-action"[^>]*target="_blank"/u);
  assert.doesNotMatch(markup, /FieldArtwork|Field Notes category artwork/u);
});

test("390px event details keep the poster, essentials, and sticky RSVP near the top", async () => {
  const rsvpUrl =
    "https://www.meetup.com/vancouver-curiosity-club/events/315508432/";
  const markup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl:
        "https://preview.example/events/princess-mononoke-rage-gods-industry",
      event: Object.freeze({
        ...TORONTO_EVENT,
        artwork: Object.freeze({
          altText: "Princess Mononoke event poster.",
          credit: "Vancouver Curiosity Club",
          dimensions: Object.freeze({
            large: Object.freeze({ height: 1200, width: 900 }),
            medium: Object.freeze({ height: 960, width: 720 }),
            small: Object.freeze({ height: 480, width: 360 }),
          }),
          focalPoint: Object.freeze({ x: 5000, y: 5000 }),
          srcSet: Object.freeze({
            large: "/media/mononoke/webp_1600",
            medium: "/media/mononoke/webp_960",
            small: "/media/mononoke/webp_480",
          }),
          url: "/media/mononoke/webp_1600",
        }),
        rsvpMode: "external",
        rsvpUrl,
        summary: "A film conversation after the VIFF screening.",
        title:
          "Princess Mononoke - rage, gods, industry, and the cost of living together",
        venue: Object.freeze({
          address: "1181 Seymour Street, Vancouver",
          name: "VIFF Centre",
        }),
      }),
    }),
  );

  const leadIndex = markup.indexOf('class="event-detail__lead"');
  const posterIndex = markup.indexOf('class="event-detail__artwork"');
  const summaryIndex = markup.indexOf('class="event-detail__summary"');
  const headingIndex = markup.indexOf("<h1>");
  const factsIndex = markup.indexOf(
    'class="event-detail__facts event-detail__facts--primary"',
  );
  const primaryRsvpIndex = markup.indexOf('class="primary-action"');
  const deckIndex = markup.indexOf('class="event-detail__deck"');
  const storyIndex = markup.indexOf('class="event-detail__story"');

  assert.ok(leadIndex >= 0);
  assert.ok(summaryIndex > leadIndex, "the event summary leads the detail flow");
  assert.ok(headingIndex > summaryIndex, "the title begins the summary");
  assert.ok(primaryRsvpIndex > headingIndex, "the primary RSVP follows the title");
  assert.ok(factsIndex > primaryRsvpIndex, "date and location follow the RSVP");
  assert.ok(posterIndex > factsIndex, "the poster follows the early essentials");
  assert.ok(deckIndex > posterIndex, "the short deck fills the poster column");
  assert.ok(storyIndex > deckIndex, "long-form copy follows the complete lead");
  assert.match(markup, /<dt>When<\/dt>/u);
  assert.match(markup, /<dt>Location<\/dt>/u);
  assert.match(markup, /VIFF Centre/u);
  assert.equal(
    (markup.match(new RegExp(`href="${rsvpUrl}"`, "gu")) ?? []).length,
    1,
  );
  const detailPoster = markup.match(
    /<img\b[^>]*alt="Princess Mononoke event poster\."[^>]*>/u,
  )?.[0] ?? "";
  assert.match(detailPoster, /fetchPriority="high"/u);
  assert.match(detailPoster, /loading="eager"/u);

  const [css, detailStyles] = await Promise.all([
    readPublicCss(),
    readFile(new URL("app/styles/pages/event-detail.css", projectRoot), "utf8"),
  ]);
  const mobileStart = detailStyles.lastIndexOf("@media (max-width: 38rem)");
  const mobileEnd = detailStyles.length;
  const tabletStart = detailStyles.lastIndexOf(
    "@media (max-width: 64rem)",
    mobileStart,
  );
  const tabletStyles = detailStyles.slice(tabletStart, mobileStart);
  const mobileStyles = detailStyles.slice(mobileStart, mobileEnd);

  assert.match(
    css,
    /body\[data-surface="public"\]\s*\{[^}]*overflow-x:\s*clip;/su,
  );
  assert.match(
    tabletStyles,
    /\.event-detail__lead\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/su,
  );
  assert.match(
    tabletStyles,
    /\.event-detail__visual\s*>\s*\.event-detail__artwork\s*\{[^}]*width:\s*min\(100%,\s*42rem\);/su,
  );
  assert.match(
    mobileStyles,
    /\.event-detail__header h1\s*\{[^}]*font-size:\s*clamp\(3rem,\s*13vw,\s*3\.5rem\);/su,
    "a 390px title must stay within the 48-56px range",
  );
  assert.match(
    mobileStyles,
    /\.event-detail__header h1\s*\{[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;[^}]*hyphens:\s*none;/su,
    "a 390px title must not split or hyphenate words",
  );
  const stickyRule = mobileStyles.match(
    /\.event-detail__summary\s*>\s*\.primary-action\s*\{([^}]*)\}/su,
  )?.[1] ?? "";
  assert.match(stickyRule, /position:\s*fixed;/u);
  assert.match(stickyRule, /bottom:\s*max\(0\.75rem,\s*env\(safe-area-inset-bottom\)\);/u);
  assert.match(stickyRule, /display:\s*flex;/u);
  assert.match(stickyRule, /min-height:\s*3\.25rem;/u, "the 390px RSVP action must be sticky and at least 44px tall");
  assert.match(
    css,
    /\.event-detail__summary\s*>\s*\.primary-action\s*\{[^}]*min-height:\s*2\.75rem;/su,
    "the in-flow RSVP action must remain at least 44px tall",
  );
});

test("public schedule formatting uses the event's IANA timezone", () => {
  const schedule = formatEventSchedule(TORONTO_EVENT);

  assert.match(schedule.label, /2:00 p\.m\./u);
  assert.match(schedule.label, /3:00 p\.m\. EDT/u);
  assert.doesNotMatch(schedule.label, /11:00 a\.m\.|PDT/u);
});

test("the shared detail renderer supports a preview-safe discovery mode", async () => {
  const previewMarkup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: null,
      event: TORONTO_EVENT,
      showShareControls: false,
    }),
  );
  assert.match(previewMarkup, /Times shown in America\/Toronto\./u);
  assert.doesNotMatch(previewMarkup, />Format<\/dt>/u);
  assert.match(previewMarkup, /The event uses its own IANA timezone\./u);
  assert.match(previewMarkup, /RSVP information coming soon\./u);
  assert.doesNotMatch(previewMarkup, /RSVP on Meetup/u);
  assert.doesNotMatch(previewMarkup, /Share this event|Email link/u);

  const liveMarkup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: "https://preview.example/events/timezone-event",
      event: TORONTO_EVENT,
    }),
  );
  assert.match(liveMarkup, /aria-label="Share this event"/u);
  assert.match(liveMarkup, /Email link/u);
  assert.match(liveMarkup, />Add to calendar<\/summary>/u);
  assert.match(liveMarkup, />Google Calendar/u);
  assert.match(liveMarkup, />Apple Calendar \/ download \.ics<\/a>/u);
  assert.match(
    liveMarkup,
    /href="\/events\/timezone-event\/calendar\.ics"/u,
  );
  assert.match(
    liveMarkup,
    /https%3A%2F%2Fpreview\.example%2Fevents%2Ftimezone-event/u,
  );

  const eventPage = await readFile(
    new URL("app/events/[slug]/page.tsx", projectRoot),
    "utf8",
  );
  assert.match(eventPage, /<PublicEventDetailRenderer/u);
  assert.match(
    eventPage,
    /<Link href="\/events">\s*All events\s*<\/Link>/u,
  );
  assert.match(eventPage, /PublicRouteLink as Link/u);
  assert.doesNotMatch(eventPage, /<article className="event-detail">/u);
  assert.doesNotMatch(eventPage, /<ShareControls/u);
});

test("cancelled event calendar actions expose only the cancellation file", () => {
  const markup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: "https://preview.example/events/timezone-event",
      event: Object.freeze({
        ...TORONTO_EVENT,
        isCancelled: true,
      }),
    }),
  );

  assert.match(markup, />Add to calendar<\/summary>/u);
  assert.match(markup, />Download cancellation \(\.ics\)<\/a>/u);
  assert.doesNotMatch(markup, />Google Calendar/u);
  assert.doesNotMatch(markup, /class="primary-action"/u);
});

test("public event artwork renders only allowlisted media presentation fields", () => {
  const event = Object.freeze({
    ...TORONTO_EVENT,
    artwork: Object.freeze({
      altText: "Abstract field-note shapes.",
      caption: "Private registered charity evidence.",
      credit: "Vancouver Curiosity Club",
      dimensions: Object.freeze({
        large: Object.freeze({ height: 900, width: 1600 }),
        medium: Object.freeze({ height: 540, width: 960 }),
        small: Object.freeze({ height: 270, width: 480 }),
      }),
      focalPoint: Object.freeze({ x: 5000, y: 5000 }),
      privateParticipantConsentNote:
        "Private society registration number.",
      privateRightsSourceNote: "Private CRA charity documentation.",
      srcSet: Object.freeze({
        large: "/media/asset-safe/webp_1600",
        medium: "/media/asset-safe/webp_960",
        small: "/media/asset-safe/webp_480",
      }),
      url: "/media/asset-safe/webp_1600",
    }),
  });
  const markup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: "https://preview.example/events/timezone-event",
      event,
    }),
  );
  assert.match(markup, /alt="Abstract field-note shapes\."/u);
  assert.match(markup, /Artwork: Vancouver Curiosity Club/u);
  assert.match(markup, /height="900".*width="1600"/u);
  assert.doesNotMatch(
    markup,
    /registered charity evidence|society registration|CRA charity/iu,
  );
});

test("public organizer attribution renders rich allowlisted details and suppresses revoked or private fields", () => {
  const richOrganizer = Object.freeze({
    authSubject: "PRIVATE-AUTH-SUBJECT-SENTINEL",
    biography: "A confirmed biography for public event attribution.",
    displayName: "Public Host",
    draftBiography: "PRIVATE-DRAFT-BIOGRAPHY-SENTINEL",
    email: "PRIVATE-ORGANIZER-EMAIL-SENTINEL@example.invalid",
    photo: Object.freeze({
      altText: "Abstract cobalt and forest profile artwork.",
      credit: "Vancouver Curiosity Club",
      height: 320,
      objectKey: "PRIVATE-R2-OBJECT-KEY-SENTINEL",
      privateConsentNote: "PRIVATE-CONSENT-NOTE-SENTINEL",
      privateRightsNote: "PRIVATE-RIGHTS-NOTE-SENTINEL",
      url: "/media/asset-public-host/webp_480",
      width: 480,
    }),
    role: "PRIVATE-ROLE-SENTINEL",
  });
  const duplicateDisplayName = Object.freeze({
    biography: "A second confirmed public biography.",
    displayName: "Public Host",
  });
  const event = Object.freeze({
    ...TORONTO_EVENT,
    organizers: Object.freeze([richOrganizer, duplicateDisplayName]),
  });
  const markup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: "https://preview.example/events/timezone-event",
      event,
    }),
  );

  assert.match(markup, /Your organizers/u);
  assert.equal((markup.match(/<strong>Public Host<\/strong>/gu) ?? []).length, 2);
  assert.match(
    markup,
    /A confirmed biography for public event attribution\./u,
  );
  assert.match(markup, /A second confirmed public biography\./u);
  assert.match(
    markup,
    /src="\/media\/asset-public-host\/webp_480"/u,
  );
  assert.match(
    markup,
    /alt="Abstract cobalt and forest profile artwork\."/u,
  );
  assert.match(markup, /height="320".*width="480"/u);
  assert.match(markup, /Photo: Vancouver Curiosity Club/u);
  for (const sentinel of [
    "PRIVATE-AUTH-SUBJECT-SENTINEL",
    "PRIVATE-DRAFT-BIOGRAPHY-SENTINEL",
    "PRIVATE-ORGANIZER-EMAIL-SENTINEL",
    "PRIVATE-R2-OBJECT-KEY-SENTINEL",
    "PRIVATE-CONSENT-NOTE-SENTINEL",
    "PRIVATE-RIGHTS-NOTE-SENTINEL",
    "PRIVATE-ROLE-SENTINEL",
  ]) {
    assert.doesNotMatch(markup, new RegExp(sentinel, "u"));
  }

  const revokedMarkup = renderToStaticMarkup(
    createElement(PublicEventDetailRenderer, {
      canonicalUrl: "https://preview.example/events/timezone-event",
      event: Object.freeze({
        ...event,
        organizers: Object.freeze([]),
      }),
    }),
  );
  assert.doesNotMatch(revokedMarkup, /Your organizer|Public Host/u);
  assert.doesNotMatch(
    revokedMarkup,
    /A confirmed biography for public event attribution/u,
  );
  assert.doesNotMatch(
    revokedMarkup,
    /\/media\/asset-public-host\/webp_480/u,
  );
});
