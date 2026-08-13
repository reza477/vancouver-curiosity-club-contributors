import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { ClubDirectory } from "../../app/_components/ClubDirectory.tsx";
import { clubCoverArtworkForSlug } from "../../lib/club-cover-art.ts";

const projectRoot = new URL("../../", import.meta.url);
const COVER_SLUGS = Object.freeze([
  "vancouver-curiosity-club",
  "vancouver-literature-and-film",
  "vancouver-fantasy-scifi-group",
]);
const COVER_WIDTHS = Object.freeze([480, 960, 1600]);

test("the club directory owns exactly three distinct responsive illustration sets", async () => {
  const coverDirectory = new URL("public/club-covers/", projectRoot);
  const files = (await readdir(coverDirectory)).sort();
  assert.deepEqual(
    files,
    COVER_SLUGS.flatMap((slug) =>
      COVER_WIDTHS.map((width) => `${slug}-${width}.jpeg`),
    ).sort(),
  );

  const largestVariantHashes = new Set();
  for (const slug of COVER_SLUGS) {
    for (const width of COVER_WIDTHS) {
      const path = new URL(`${slug}-${width}.jpeg`, coverDirectory);
      const bytes = await readFile(path);
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.format, "jpeg", `${slug} ${width} format`);
      assert.equal(metadata.width, width, `${slug} ${width} width`);
      assert.equal(metadata.height, Math.round(width * 9 / 16), `${slug} ${width} height`);
      if (width === 1600) {
        largestVariantHashes.add(
          createHash("sha256").update(bytes).digest("hex"),
        );
      }
    }
  }
  assert.equal(
    largestVariantHashes.size,
    3,
    "each club needs genuinely distinct art direction",
  );

  for (const slug of COVER_SLUGS) {
    const artwork = clubCoverArtworkForSlug(slug);
    assert.ok(artwork, `${slug} must have owned cover art`);
    assert.equal(artwork.src, `/club-covers/${slug}-960.jpeg`);
    assert.equal(
      artwork.srcSet,
      COVER_WIDTHS.map(
        (width) => `/club-covers/${slug}-${width}.jpeg ${width}w`,
      ).join(", "),
    );
    assert.ok(artwork.altText.trim().length > 0, `${slug} needs useful alt text`);
    assert.ok(artwork.credit.trim().length > 0, `${slug} needs a truthful credit`);
    for (const candidate of [
      artwork.src,
      ...artwork.srcSet.split(", ").map((entry) => entry.split(" ")[0]),
    ]) {
      assert.ok(candidate.startsWith("/club-covers/"));
      assert.equal(
        new URL(candidate, "https://clubs.example").origin,
        "https://clubs.example",
        `${candidate} must stay same-origin`,
      );
    }
  }
  assert.equal(clubCoverArtworkForSlug("not-a-published-club"), null);

  const registry = await source("lib/club-cover-art.ts");
  assert.doesNotMatch(
    registry,
    /https?:\/\//u,
    "the owned fallback-art registry must never fetch remote Meetup media",
  );
});

test("three published clubs render distinct responsive art and prominent CMS promises without a redundant uniform lane", async () => {
  const clubs = clubFixtures();
  const markup = renderToStaticMarkup(
    createElement(ClubDirectory, {
      clubs,
      mediaById: new Map(),
      nextEventsByClubSlug: new Map(),
      nextEventsState: "available",
    }),
  );
  const cards = clubCards(markup);
  assert.equal(cards.length, 3);

  for (const [index, club] of clubs.entries()) {
    const card = cards[index];
    assert.match(card, new RegExp(escapeRegex(htmlEscape(club.name)), "u"));
    assert.match(card, /class="club-directory__promise"/u);
    assert.match(
      card,
      new RegExp(`<p>${escapeRegex(club.description)}</p>`, "u"),
      `${club.name} must foreground its published CMS description verbatim`,
    );
    assert.doesNotMatch(card, /class="club-directory__lane"/u);
    assert.doesNotMatch(card, /Activity lane:/u);
    assert.match(
      card,
      new RegExp(
        `srcSet="/club-covers/${club.slug}-480\\.jpeg 480w, /club-covers/${club.slug}-960\\.jpeg 960w, /club-covers/${club.slug}-1600\\.jpeg 1600w"`,
        "u",
      ),
      `${club.name} must render all three owned responsive variants`,
    );
    assert.match(
      card,
      new RegExp(`src="/club-covers/${club.slug}-960\\.jpeg"`, "u"),
    );
    assert.doesNotMatch(card, /https?:\/\/[^" ]+\.(?:jpe?g|png|webp)/iu);
  }

  assert.equal(
    (markup.match(/class="club-directory__lane"/gu) ?? []).length,
    0,
  );
  assert.doesNotMatch(markup, /Activity lane:/u);

  const css = await source("app/globals.css");
  const promiseRule = cssRule(
    css,
    ".club-directory__promise > p:last-child",
  );
  assert.match(promiseRule, /font-size:\s*(?:clamp\(|1\.[1-9]\d*rem)/u);
  assert.match(promiseRule, /font-weight:\s*(?:6\d\d|[7-9]\d\d)/u);
  const laneRules = [
    cssRule(css, ".club-directory__number,\n.club-directory__lane"),
    cssRule(css, ".club-directory--clubs .club-directory__lane"),
  ].join("\n");
  assert.match(laneRules, /font-size:\s*0\.75rem/u);
  assert.match(laneRules, /color:\s*var\(--ink-soft\)/u);
});

test("lane labels appear once for a single club and truthfully on every mixed-lane card", () => {
  const uniformClubs = clubFixtures();
  const singleClub = uniformClubs[0];
  const singleMarkup = renderToStaticMarkup(
    createElement(ClubDirectory, {
      clubs: Object.freeze([singleClub]),
      mediaById: new Map(),
      nextEventsByClubSlug: new Map(),
      nextEventsState: "available",
    }),
  );
  const singleCards = clubCards(singleMarkup);
  assert.equal(singleCards.length, 1);
  assert.equal(
    (singleMarkup.match(/class="club-directory__lane"/gu) ?? []).length,
    1,
  );
  assert.match(
    singleCards[0],
    /<p class="club-directory__lane"><span class="sr-only">Activity lane: <\/span>Think<\/p>/u,
  );

  const mixedClubs = Object.freeze(
    uniformClubs.map((club, index) =>
      Object.freeze({
        ...club,
        lane: Object.freeze([
          { name: "Think", slug: "think" },
          { name: "Explore", slug: "explore" },
          { name: "Reset & Make", slug: "reset-and-make" },
        ][index]),
      }),
    ),
  );
  const mixedMarkup = renderToStaticMarkup(
    createElement(ClubDirectory, {
      clubs: mixedClubs,
      mediaById: new Map(),
      nextEventsByClubSlug: new Map(),
      nextEventsState: "available",
    }),
  );
  const mixedCards = clubCards(mixedMarkup);
  assert.equal(mixedCards.length, 3);
  assert.equal(
    (mixedMarkup.match(/class="club-directory__lane"/gu) ?? []).length,
    3,
  );
  for (const [index, club] of mixedClubs.entries()) {
    assert.match(
      mixedCards[index],
      new RegExp(
        `<p class="club-directory__lane"><span class="sr-only">Activity lane: <\\/span>${escapeRegex(htmlEscape(club.lane.name))}<\\/p>`,
        "u",
      ),
      `${club.name} must expose its own ${club.lane.name} activity lane`,
    );
  }
});

test("published CMS media wins in thumbnail, cover, then owned-art order", () => {
  const clubs = clubFixtures().map((club, index) => Object.freeze({
    ...club,
    coverAssetId: index < 2 ? `cover-${index}` : null,
    thumbnailAssetId: index === 0 ? "thumbnail-0" : null,
  }));
  const mediaById = new Map([
    ["thumbnail-0", mediaFixture("thumbnail-0")],
    ["cover-0", mediaFixture("cover-0")],
    ["cover-1", mediaFixture("cover-1")],
  ]);
  const cards = clubCards(renderToStaticMarkup(
    createElement(ClubDirectory, { clubs, mediaById }),
  ));

  assert.match(cards[0], /src="\/media\/thumbnail-0\/webp_960"/u);
  assert.doesNotMatch(cards[0], /\/media\/cover-0\/|\/club-covers\//u);
  assert.match(cards[1], /src="\/media\/cover-1\/webp_960"/u);
  assert.doesNotMatch(cards[1], /\/club-covers\//u);
  assert.match(
    cards[2],
    /src="\/club-covers\/vancouver-fantasy-scifi-group-960\.jpeg"/u,
  );
});

test("club cards distinguish a next event, an honest empty state, unavailable data, and omitted preview data", () => {
  const clubs = clubFixtures();
  const nextEvent = eventFixture(clubs[0]);
  const availableMarkup = renderToStaticMarkup(
    createElement(ClubDirectory, {
      clubs,
      mediaById: new Map(),
      nextEventsByClubSlug: new Map([[clubs[0].slug, nextEvent]]),
      nextEventsState: "available",
    }),
  );
  const availableCards = clubCards(availableMarkup);
  assert.match(availableCards[0], /class="club-directory__next"/u);
  assert.match(availableCards[0], />Next gathering</u);
  assert.match(
    availableCards[0],
    new RegExp(`href="/events/${nextEvent.slug}"[^>]*>${escapeRegex(nextEvent.title)}</a>`, "u"),
  );
  for (const card of availableCards.slice(1)) {
    assert.match(card, />Next gathering</u);
    assert.match(
      card,
      /No upcoming gathering yet\./u,
    );
    assert.doesNotMatch(card, /coming soon|check back soon/iu);
  }

  const unavailableMarkup = renderToStaticMarkup(
    createElement(ClubDirectory, {
      clubs,
      mediaById: new Map(),
      nextEventsByClubSlug: new Map(),
      nextEventsState: "unavailable",
    }),
  );
  for (const card of clubCards(unavailableMarkup)) {
    assert.match(card, />Next gathering</u);
    assert.match(card, /(?:Calendar details|Next gathering) (?:are|is) temporarily unavailable\./u);
    assert.doesNotMatch(card, /No upcoming gathering/u);
  }

  const omittedMarkup = renderToStaticMarkup(
    createElement(ClubDirectory, {
      clubs,
      mediaById: new Map(),
      nextEventsByClubSlug: new Map(),
      nextEventsState: "omitted",
    }),
  );
  assert.doesNotMatch(
    omittedMarkup,
    /Next gathering|No upcoming gathering|temporarily unavailable/u,
    "private preview must not invent a live event-data state",
  );
});

test("every card has exact Explore club copy and a unique accessible name", () => {
  const clubs = clubFixtures();
  const markup = renderToStaticMarkup(
    createElement(ClubDirectory, {
      clubs,
      mediaById: new Map(),
      nextEventsByClubSlug: new Map(),
      nextEventsState: "available",
    }),
  );
  const cards = clubCards(markup);
  assert.equal((markup.match(/>Explore club<\/a>/gu) ?? []).length, 3);
  assert.doesNotMatch(markup, /Read the club note/u);
  for (const [index, club] of clubs.entries()) {
    assert.match(
      cards[index],
      new RegExp(
        `aria-label="Explore club: ${escapeRegex(htmlEscape(club.name))}"[^>]*>Explore club</a>`,
        "u",
      ),
    );
  }
  const labels = [...markup.matchAll(
    /aria-label="(Explore club: [^"]+)"[^>]*>Explore club<\/a>/gu,
  )].map((match) => match[1]);
  assert.equal(labels.length, 3);
  assert.equal(new Set(labels).size, 3);
});

test("the Clubs route uses one grouped D1 loader with no per-card or remote query", async () => {
  const [page, loader, directory, routeBody] = await Promise.all([
    source("app/clubs/page.tsx"),
    source("lib/server/public/events.ts"),
    source("app/_components/ClubDirectory.tsx"),
    source("app/_components/EditorialRouteBodies.tsx"),
  ]);

  assert.match(page, /listNextPublicEventsByClub/u);
  assert.equal(
    (page.match(/\blistNextPublicEventsByClub\s*\(/gu) ?? []).length,
    1,
    "the route must call one grouped next-event loader",
  );
  assert.match(page, /nextEventsByClubSlug/u);
  assert.match(page, /nextEventsState/u);
  assert.match(routeBody, /nextEventsByClubSlug/u);
  assert.match(routeBody, /nextEventsState/u);
  assert.match(
    routeBody,
    /nextEventsState\s*=\s*"omitted"/u,
    "private preview must omit a live-event claim",
  );
  assert.match(loader, /export async function listNextPublicEventsByClub/u);
  const groupedLoader = exportedFunctionSource(
    loader,
    "listNextPublicEventsByClub",
  );
  assert.match(groupedLoader, /UNIFIED_PUBLIC_EVENT_CTE_SQL/u);
  assert.match(groupedLoader, /PARTITION BY[\s\S]{0,100}club/iu);
  assert.match(groupedLoader, /row_number\(\)\s+OVER/iu);
  assert.equal(
    (groupedLoader.match(/\.prepare\s*\(/gu) ?? []).length,
    1,
    "the grouped loader must prepare one ranked event query",
  );
  assert.doesNotMatch(
    `${page}\n${loader}\n${directory}`,
    /\.map\(\s*async[\s\S]{0,600}(?:queryPublicEvents|queryPublicEventSlice|prepare\()/u,
    "the directory must never execute one query per card",
  );
  assert.doesNotMatch(
    `${page}\n${loader}\n${directory}`,
    /fetch\s*\(|https?:\/\/[^"']*meetup\.com/iu,
    "the public request path must not fetch Meetup",
  );
});

test("club-card layout rules are Clubs-scoped and mobile-safe", async () => {
  const [directory, css] = await Promise.all([
    source("app/_components/ClubDirectory.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(
    directory,
    /className="club-directory club-directory--clubs"/u,
  );
  assert.match(
    cssRule(css, ".club-directory--clubs .club-directory__card"),
    /grid-template-columns:\s*3rem\s+minmax\(/u,
    "desktop layout changes must stay scoped to the Clubs directory",
  );
  const imageRule = cssRule(css, ".club-directory__artwork img");
  assert.match(imageRule, /width:\s*100%/u);
  assert.match(imageRule, /aspect-ratio:\s*16\s*\/\s*9/u);
  assert.match(imageRule, /object-fit:\s*cover/u);
  const tabletCss = mediaRule(css, "52rem");
  assert.match(
    cssRule(tabletCss, ".club-directory--clubs .club-directory__card"),
    /grid-template-columns:[^;]*minmax\(0,\s*1fr\)/u,
  );
  const phoneClubCss = mediaRules(css, "38rem").find((rule) =>
    rule.includes(".club-directory--clubs"),
  );
  assert.ok(phoneClubCss, "missing Clubs-scoped phone media query");
  const phoneDirectoryRule = cssRule(phoneClubCss, ".club-directory--clubs");
  assert.match(phoneDirectoryRule, /safe-area-inset-left/u);
  assert.match(phoneDirectoryRule, /safe-area-inset-right/u);
  assert.match(
    cssRule(css, ".club-directory__promise,\n.club-directory__next"),
    /min-width:\s*0/u,
    "variable CMS and event copy must be allowed to shrink on phones",
  );
  assert.doesNotMatch(
    phoneClubCss,
    /min-width:\s*[4-9]\drem|width:\s*[4-9]\drem/u,
    "club cards must not impose a desktop fixed width on phones",
  );
});

function clubFixtures() {
  return Object.freeze([
    clubFixture(
      "Vancouver Curiosity Club",
      "vancouver-curiosity-club",
      "Talks, discussions, and shared learning across subjects.",
    ),
    clubFixture(
      "Vancouver Literature and Film",
      "vancouver-literature-and-film",
      "Read, watch, and discuss literature and film together.",
    ),
    clubFixture(
      "Vancouver Fantasy & Sci-Fi Group",
      "vancouver-fantasy-scifi-group",
      "Explore fantasy and science fiction through thoughtful conversation.",
    ),
  ]);
}

function clubFixture(name, slug, description) {
  return Object.freeze({
    archived: false,
    coverAssetId: null,
    description,
    featured: true,
    fullDescription: null,
    imageAltText: null,
    lane: Object.freeze({ name: "Think", slug: "think" }),
    metaDescription: null,
    name,
    openGraphAssetId: null,
    participantExpectations: null,
    preparationInformation: null,
    programType: null,
    publicGroupUrl: null,
    relatedResources: Object.freeze([]),
    seoTitle: null,
    slug,
    socialLinks: Object.freeze([]),
    themeColor: null,
    thumbnailAssetId: null,
    typicalFormat: null,
  });
}

function eventFixture(club) {
  return Object.freeze({
    attendanceMode: "in-person",
    artwork: null,
    category: null,
    club: Object.freeze({ name: club.name, slug: club.slug }),
    isCancelled: false,
    lane: club.lane,
    program: null,
    rsvpMode: "meetup",
    rsvpUrl: "https://www.meetup.com/example/events/123456789/",
    schedule: Object.freeze({
      endsAtUtc: "2026-09-11T04:00:00.000Z",
      kind: "timed",
      startsAtUtc: "2026-09-11T02:00:00.000Z",
      timeZone: "America/Vancouver",
    }),
    slug: "next-curiosity-gathering",
    status: "confirmed",
    summary: "A published next gathering.",
    title: "The next curiosity gathering",
    venue: null,
  });
}

function mediaFixture(assetId) {
  return Object.freeze({
    altText: `Published art for ${assetId}`,
    assetId,
    caption: null,
    credit: "Published CMS art",
    focalPoint: Object.freeze({ x: 5_000, y: 5_000 }),
    variants: Object.freeze({
      webp480: Object.freeze({
        height: 270,
        url: `/media/${assetId}/webp_480`,
        width: 480,
      }),
      webp960: Object.freeze({
        height: 540,
        url: `/media/${assetId}/webp_960`,
        width: 960,
      }),
      webp1600: Object.freeze({
        height: 900,
        url: `/media/${assetId}/webp_1600`,
        width: 1_600,
      }),
    }),
  });
}

function clubCards(markup) {
  return markup.match(
    /<article(?=[^>]*class="club-directory__card")[^>]*>[\s\S]*?<\/article>/gu,
  ) ?? [];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function htmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function source(pathname) {
  return readFile(new URL(pathname, projectRoot), "utf8");
}

function cssRule(css, selector) {
  const escaped = escapeRegex(selector).replace(/\\\s/gu, "\\s+");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u"));
  assert.ok(match, `missing CSS rule: ${selector}`);
  return match[1];
}

function mediaRule(css, width) {
  const startPattern = new RegExp(`@media\\s*\\(max-width:\\s*${escapeRegex(width)}\\)\\s*\\{`, "u");
  const startMatch = startPattern.exec(css);
  assert.ok(startMatch, `missing max-width ${width} media query`);
  const contentStart = startMatch.index + startMatch[0].length;
  let depth = 1;
  for (let index = contentStart; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(contentStart, index);
  }
  assert.fail(`unterminated max-width ${width} media query`);
}

function mediaRules(css, width) {
  const rules = [];
  const startPattern = new RegExp(
    `@media\\s*\\(max-width:\\s*${escapeRegex(width)}\\)\\s*\\{`,
    "gu",
  );
  for (const match of css.matchAll(startPattern)) {
    const contentStart = match.index + match[0].length;
    let depth = 1;
    for (let index = contentStart; index < css.length; index += 1) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") depth -= 1;
      if (depth === 0) {
        rules.push(css.slice(contentStart, index));
        break;
      }
    }
  }
  return rules;
}

function exportedFunctionSource(moduleSource, functionName) {
  const start = moduleSource.indexOf(`export async function ${functionName}`);
  assert.notEqual(start, -1, `missing exported function ${functionName}`);
  const nextExport = moduleSource.indexOf("\nexport ", start + 1);
  return moduleSource.slice(start, nextExport === -1 ? undefined : nextExport);
}
