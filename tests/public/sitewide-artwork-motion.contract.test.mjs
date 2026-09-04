import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, projectRoot), "utf8");

test("sitewide artwork motion reuses the shared one-shot foundation", async () => {
  const [
    controller,
    eventCard,
    clubDirectory,
    about,
    organizations,
    clubDetail,
  ] = await Promise.all([
    source("app/_components/PublicArtworkMotion.tsx"),
    source("app/_components/EventCard.tsx"),
    source("app/_components/ClubDirectory.tsx"),
    source("app/about/page.tsx"),
    source("app/for-organizations/page.tsx"),
    source("app/_components/ClubDetailRenderer.tsx"),
  ]);

  assert.equal(
    occurrences(controller, "new IntersectionObserver("),
    2,
    "new route treatments must share the existing generic observer",
  );
  assert.match(eventCard, /data-artwork-reveal="event-card"/u);
  assert.match(eventCard, /data-artwork-reveal-mode="children"/u);
  assert.match(eventCard, /href="\/styles\/event-card-motion\.css"/u);
  assert.match(clubDirectory, /data-club-showcase="true"/u);
  assert.match(clubDirectory, /href="\/styles\/clubs\.css"/u);
  assert.match(
    clubDirectory,
    /data-artwork-reveal="club-directory-card"/u,
  );
  assert.equal(
    occurrences(about, 'data-artwork-reveal="about-artwork-strip-poster"'),
    1,
    "About artwork must wait for its actual scroll-entry zone",
  );
  assert.doesNotMatch(
    about,
    /data-artwork-load-reveal/u,
    "lazy About posters must not be decoded eagerly by a second motion path",
  );
  assert.match(organizations, /data-artwork-reveal="organization-facts"/u);
  assert.match(
    organizations,
    /data-artwork-reveal="organization-pathways"/u,
  );
  assert.match(
    organizations,
    /data-artwork-reveal="organization-facts"[\s\S]*?data-artwork-reveal-mode="children"/u,
  );
  assert.match(
    organizations,
    /data-artwork-reveal="organization-pathways"[\s\S]*?data-artwork-reveal-mode="children"/u,
  );
  assert.match(clubDetail, /data-artwork-reveal="club-program-card"/u);
  assert.match(clubDetail, /href="\/styles\/clubs\.css"/u);
  assert.match(
    clubDetail,
    /data-artwork-reveal="club-program-card"[\s\S]*?data-artwork-reveal-mode="children"/u,
  );

  assert.doesNotMatch(
    `${about}\n${organizations}`,
    /tabIndex=|role="button"|onClick=/u,
    "informational artwork and collaboration pathways must not pretend to be links",
  );
});

test("sitewide motion CSS keeps hover and keyboard focus in parity", async () => {
  const [
    aboutCss,
    catalogCss,
    clubsCss,
    eventCardMotionCss,
    organizationsCss,
    motionCss,
  ] = await Promise.all([
    source("public/styles/about.css"),
    source("app/styles/components/catalog.css"),
    source("public/styles/clubs.css"),
    source("public/styles/event-card-motion.css"),
    source("public/styles/organizations.css"),
    source("app/styles/motion.css"),
  ]);

  assert.match(
    clubsCss,
    /\.club-directory__card:is\(:hover, :focus-within\)\s*\{[^}]*background:[^}]*transform:\s*none;/u,
    "the showcase should respond without double-moving the whole card",
  );
  assert.doesNotMatch(
    clubsCss,
    /\[data-club-showcase="true"\][^{}]*:has\(|flex-grow:\s*1\.48|transition:[^;}]*flex-grow/u,
    "showcase interaction must not reflow the page",
  );
  assert.match(
    clubsCss,
    /\.club-directory__card:is\(:hover, :focus-within\)::before\s*\{[^}]*transform:\s*scaleX\(1\);/u,
  );
  assert.match(
    catalogCss,
    /\.club-directory__artwork img\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9;[^}]*height:\s*auto;/u,
    "showcase artwork must retain its natural 16:9 proportion at every width",
  );
  assert.match(
    organizationsCss,
    /\.organizations-standards nav a:is\(:hover, :focus-visible\)/u,
  );
  assert.match(
    `${aboutCss}\n${clubsCss}\n${eventCardMotionCss}\n${organizationsCss}\n${motionCss}`,
    /@media \(prefers-reduced-motion: reduce\)/u,
  );
  assert.match(
    motionCss,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\[data-artwork-reveal-state\][\s\S]*?clip-path:\s*none !important;[\s\S]*?transform:\s*none !important;/u,
    "reduced-motion mode must fully neutralize positional and clipping reveals",
  );
  assert.doesNotMatch(
    `${aboutCss}\n${clubsCss}\n${eventCardMotionCss}\n${organizationsCss}\n${motionCss}`,
    /\[data-artwork-(?:reveal-state|load-reveal)[^\n]*\]\s*\*/u,
    "reduced-motion resets must not erase static descendant transforms or clip focus rings",
  );
  assert.doesNotMatch(
    `${eventCardMotionCss}\n${clubsCss}\n${motionCss}`,
    /\.event-card\[data-artwork-reveal-state\][^{]*\{[^}]*transition:\s*none/u,
    "child reveals must preserve bounded card hover and focus transitions",
  );
});

function occurrences(value, fragment) {
  return value.split(fragment).length - 1;
}
