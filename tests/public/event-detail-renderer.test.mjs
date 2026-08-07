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
  assert.doesNotMatch(markup, /dangerouslySetInnerHTML/u);
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
  assert.ok(artworkIndex > leadIndex);
  assert.ok(summaryIndex > artworkIndex);
  assert.match(markup, /data-event-lane="explore"/u);
  assert.match(markup, /<strong>Explore<\/strong>/u);
  assert.match(markup, /Gathering in the Explore lane/u);
  assert.match(markup, /Explore · City culture/u);
  assert.equal(
    (markup.match(new RegExp(`href="${rsvpUrl}"`, "gu")) ?? []).length,
    2,
  );
  assert.match(markup, /class="event-detail__mobile-rsvp"/u);
  assert.match(
    markup,
    /aria-label="RSVP for Timezone event on Meetup"/u,
  );
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
  const factsIndex = markup.indexOf('class="event-detail__facts"');
  const primaryRsvpIndex = markup.indexOf(
    'class="primary-action"',
    factsIndex,
  );
  const storyIndex = markup.indexOf('class="event-detail__story"');

  assert.ok(leadIndex >= 0);
  assert.ok(posterIndex > leadIndex, "the poster leads the event-detail flow");
  assert.ok(summaryIndex > posterIndex, "the summary follows the poster");
  assert.ok(headingIndex > summaryIndex, "the title begins the summary");
  assert.ok(factsIndex > headingIndex, "date and location follow the title");
  assert.ok(primaryRsvpIndex > factsIndex, "the primary RSVP stays with facts");
  assert.ok(storyIndex > primaryRsvpIndex, "long-form copy follows essentials");
  assert.match(markup, /<dt>When<\/dt>/u);
  assert.match(markup, /<dt>Location<\/dt>/u);
  assert.match(markup, /VIFF Centre/u);
  assert.equal(
    (markup.match(new RegExp(`href="${rsvpUrl}"`, "gu")) ?? []).length,
    2,
  );

  const css = await readFile(new URL("app/globals.css", projectRoot), "utf8");
  const mobileStart = css.lastIndexOf("@media (max-width: 38rem)");
  const mobileEnd = css.indexOf(
    "@media (prefers-reduced-motion: reduce)",
    mobileStart,
  );
  const tabletStart = css.lastIndexOf(
    "@media (max-width: 52rem)",
    mobileStart,
  );
  const tabletStyles = css.slice(tabletStart, mobileStart);
  const mobileStyles = css.slice(mobileStart, mobileEnd);

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
    /\.event-detail__lead\s*>\s*\.event-detail__artwork\s*\{[^}]*width:\s*min\(100%,\s*34rem\);/su,
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
  assert.match(
    mobileStyles,
    /\.event-detail__mobile-rsvp\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*max\(0\.75rem,\s*env\(safe-area-inset-bottom\)\);[^}]*display:\s*flex;[^}]*min-height:\s*3\.25rem;/su,
    "the 390px RSVP action must be sticky and at least 44px tall",
  );
  assert.match(
    css,
    /\.event-detail__facts \.primary-action\s*\{[^}]*min-height:\s*2\.75rem;/su,
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
  assert.match(eventPage, /<Link href="\/events">All events<\/Link>/u);
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
  assert.doesNotMatch(markup, /event-detail__mobile-rsvp/u);
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
