import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PUBLIC_ARTWORK_MOTION,
  PUBLIC_ARTWORK_MOTION_ENABLED,
} from "../../lib/public-artwork-motion.ts";

const projectRoot = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, projectRoot), "utf8");

test("artwork motion uses one bounded, switchable foundation", async () => {
  const [controller, motionCss, globals, layout] = await Promise.all([
    source("app/_components/PublicArtworkMotion.tsx"),
    source("app/styles/motion.css"),
    source("app/globals.css"),
    source("app/layout.tsx"),
  ]);

  assert.equal(PUBLIC_ARTWORK_MOTION_ENABLED, true);
  assert.ok(
    PUBLIC_ARTWORK_MOTION.interactionDurationMs >= 160 &&
      PUBLIC_ARTWORK_MOTION.interactionDurationMs <= 220,
  );
  assert.ok(
    PUBLIC_ARTWORK_MOTION.artworkDurationMs >= 420 &&
      PUBLIC_ARTWORK_MOTION.artworkDurationMs <= 650,
  );
  assert.ok(PUBLIC_ARTWORK_MOTION.staggerMs >= 45);
  assert.ok(PUBLIC_ARTWORK_MOTION.staggerMs <= 80);
  assert.ok(PUBLIC_ARTWORK_MOTION.maximumDesktopDistancePx <= 24);
  assert.ok(PUBLIC_ARTWORK_MOTION.maximumMobileDistancePx <= 14);
  assert.equal(
    PUBLIC_ARTWORK_MOTION.easing,
    "cubic-bezier(.22, 1, .36, 1)",
  );
  assert.equal(
    PUBLIC_ARTWORK_MOTION.stageMediaQuery,
    "(min-width: 64rem) and (min-height: 42rem) and (prefers-reduced-motion: no-preference)",
  );

  for (const [token, value] of [
    ["--artwork-motion-interaction", "190ms"],
    ["--artwork-motion-artwork", "560ms"],
    ["--artwork-motion-hero", "860ms"],
    ["--artwork-motion-stagger", "60ms"],
    ["--artwork-motion-distance", "24px"],
    ["--artwork-motion-distance-mobile", "14px"],
    ["--artwork-motion-easing", "cubic-bezier(.22, 1, .36, 1)"],
  ]) {
    assert.match(
      motionCss,
      new RegExp(`${escapeRegex(token)}:\\s*${escapeRegex(value)};`, "u"),
      `${token} must stay centralized in the shared motion stylesheet`,
    );
  }

  assert.match(
    globals,
    /@import "\.\/styles\/motion\.css" layer\(components\);/u,
  );
  assert.match(layout, /PUBLIC_ARTWORK_MOTION_ENABLED/u);
  assert.match(
    layout,
    /data-artwork-motion-config=\{[\s\S]*?"enabled"[\s\S]*?"disabled"/u,
  );
  assert.equal(occurrences(layout, "<PublicArtworkMotion />"), 1);
  assert.match(
    layout,
    /\{isPrivatePath \? null : <PublicArtworkMotion \/>\}/u,
    "the public motion controller must not hydrate organizer routes",
  );

  assert.equal(
    occurrences(controller, "new IntersectionObserver("),
    2,
    "one shared reveal observer and one specialized stage observer are sufficient",
  );
  assert.match(controller, /const revealObserver = new IntersectionObserver/u);
  assert.match(controller, /const stageObserver = new IntersectionObserver/u);
});

test("the poster stage decodes before activation and never hijacks scrolling", async () => {
  const [controller, home, homeCss, baseCss, motionCss] = await Promise.all([
    source("app/_components/PublicArtworkMotion.tsx"),
    source("app/_components/HomePageRenderer.tsx"),
    source("app/styles/pages/home.css"),
    source("app/styles/base.css"),
    source("app/styles/motion.css"),
  ]);

  const activate = sourceSection(
    controller,
    "const processQueuedActivation = async",
    "const focusHandlers",
  );
  const decodeIndex = activate.indexOf("await decodeImage(image)");
  const transitionIndex = activate.indexOf("transitioning = true");
  const activationIndex = activate.indexOf(
    "setStageState(articles, outgoingIndex, requestedIndex)",
  );
  assert.ok(transitionIndex >= 0, "activation must enter a serialized state");
  assert.ok(
    decodeIndex > transitionIndex,
    "activation must lock before decode so concurrent requests are queued",
  );
  assert.ok(activationIndex > decodeIndex, "decode must precede poster activation");
  assert.match(controller, /activationGeneration/u);
  assert.match(controller, /disposed \|\| operationGeneration !== activationGeneration/u);
  assert.match(controller, /queuedIndex = requestedIndex/u);
  assert.match(controller, /await decodeDescendantImages\(element\)/u);
  assert.match(controller, /poster\.dataset\.artworkImageReady = "true"/u);

  assert.match(controller, /addEventListener\("focusin", handler\)/u);
  assert.match(controller, /addEventListener\("pointerenter", handler\)/u);
  assert.match(
    controller,
    /const stageObserver = new IntersectionObserver\([\s\S]*?void activate\(index\)/u,
  );
  assert.doesNotMatch(
    controller,
    /addEventListener\(["'](?:scroll|wheel|touchmove)["']|onscroll\s*=|setInterval\s*\(/u,
  );

  assert.match(home, /className="home-work__grid" data-living-poster-stage/u);
  assert.match(home, /data-stage-event-index=\{index\}/u);
  assert.match(home, /data-stage-poster/u);
  assert.match(home, /data-stage-summary/u);
  assert.match(home, /role="article"/u);

  const publicMotionSources = `${controller}\n${home}\n${homeCss}\n${motionCss}`;
  assert.doesNotMatch(publicMotionSources, /\bautoplay\b|scroll-snap|transition\s*:\s*all\b/iu);
  assert.doesNotMatch(`${homeCss}\n${baseCss}`, /home-section-enter/u);
});

test("the stage has a static default and bounded wide-screen enhancement", async () => {
  const [controller, homeCss, motionCss] = await Promise.all([
    source("app/_components/PublicArtworkMotion.tsx"),
    source("app/styles/pages/home.css"),
    source("app/styles/motion.css"),
  ]);

  assert.match(
    homeCss,
    /\.home-work-card\s*\{[^}]*display:\s*grid;/su,
    "without the wide-screen enhancement, posters and summaries stay in normal document flow",
  );
  assert.match(
    motionCss,
    /@media \(scripting: enabled\) and \(min-width: 64rem\) and \(min-height: 42rem\) and \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\.home-work__grid\s*\{[^}]*grid-template-columns:[^}]*grid-template-rows:\s*repeat\(3,[^}]*position:\s*relative;/u,
  );
  assert.match(
    motionCss,
    /@media \(scripting: enabled\)[\s\S]*?@scope \(html\[data-artwork-motion-ready="true"\]\)[\s\S]*?\.home-work__grid/u,
    "the sticky enhancement must not hide event artwork when JavaScript is unavailable",
  );
  assert.match(
    motionCss,
    /@media \(scripting: enabled\)[\s\S]*?\.home-work-card\s*\{[^}]*display:\s*contents;/u,
  );
  assert.match(
    motionCss,
    /@media \(scripting: enabled\)[\s\S]*?\.home-work-card__poster-link\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1 \/ 4;[^}]*position:\s*sticky;/u,
  );
  assert.match(
    motionCss,
    /\.home-work-card\[data-stage-state\]:not\(\[data-stage-state="idle"\]\) \.home-work-card__poster-link\s*\{[^}]*visibility:\s*visible;/u,
    "the active, incoming, and outgoing posters must remain visible during transitions",
  );

  assert.doesNotMatch(
    motionCss,
    /\[data-artwork-reveal-state="pending"\][^{}]*\{[^}]*opacity:\s*0\b/su,
    "pending enhancements must not make essential content invisible",
  );
  assert.match(
    controller,
    /if \(!stageMedia\.matches \|\| reducedMotion\.matches\)\s*\{[\s\S]*?resetStage\(stage\)/u,
  );
  assert.match(
    motionCss,
    /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?home-hero-line-reveal/u,
  );
});

test("the community artwork triptych has pointer and keyboard parity", async () => {
  const [home, homeCss] = await Promise.all([
    source("app/_components/HomePageRenderer.tsx"),
    source("app/styles/pages/home.css"),
  ]);

  assert.match(home, /className="home-communities__list" data-community-triptych/u);
  assert.match(home, /data-community-slug=\{club\.slug\}[\s\S]*?tabIndex=\{0\}/u);
  assert.match(
    homeCss,
    /@media \(min-width: 56\.001rem\)[\s\S]*?\.home-communities__list\s*\{[^}]*height:\s*clamp\([^}]*display:\s*flex;/u,
  );
  assert.match(homeCss, /\.home-community:first-child\s*\{[^}]*flex-grow:\s*1\.9;/su);
  assert.match(homeCss, /\.home-community:focus-visible\s*\{[^}]*outline:/su);
  assert.match(
    homeCss,
    /@media \(min-width: 56\.001rem\)[\s\S]*?\.home-community__artwork img\s*\{[^}]*object-fit:\s*contain;/u,
  );
  assert.match(
    homeCss,
    /\.home-community:is\(:hover, :focus-within\)\s*\{[^}]*flex-grow:\s*2\.35;/su,
  );
  assert.match(
    homeCss,
    /\.home-community:is\(:hover, :focus-within\) \.home-community__details\s*\{[^}]*grid-template-rows:\s*1fr;/su,
  );
  assert.match(
    homeCss,
    /\.home-community:is\(:hover, :focus-within\) \.home-community__artwork img\s*\{[^}]*transform:\s*scale\(1\.015\);/su,
  );
  assert.match(
    homeCss,
    /@media \(max-width: 56rem\)[\s\S]*?\.home-community,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/u,
    "mobile and tablet layouts must return to normal vertical artwork panels",
  );
});

test("About moves real artwork forward and uses editorial rosters and rows", async () => {
  const [about, aboutCss] = await Promise.all([
    source("app/about/page.tsx"),
    source("public/styles/about.css"),
  ]);

  assert.match(
    about,
    /<header className="about-hero"[\s\S]*?<\/header>\s*<div[\s\S]*?className="about-artwork-strip"[\s\S]*?<\/div>\s*<section className="about-board"/u,
    "the existing community artwork must immediately follow the mission introduction",
  );
  assert.equal(occurrences(about, "file: \"meetup-"), 3);
  assert.doesNotMatch(about, /about-board__badge|director\.emoji|emoji:/u);
  assert.match(
    aboutCss,
    /\.about-artwork-strip\s*\{[^}]*background:\s*var\(--ink\);[^}]*grid-template-columns:\s*minmax\(0, 1\.32fr\) minmax\(0, 0\.86fr\) minmax\(0, 1fr\);/su,
  );
  assert.match(
    aboutCss,
    /\.about-board__member\s*\{[^}]*grid-template-columns:\s*minmax\(10rem, 0\.68fr\) minmax\(0, 1\.32fr\);/su,
  );
  assert.doesNotMatch(
    aboutCss,
    /\.about-board__list\s*\{[^}]*grid-template-columns:\s*repeat\(2,/su,
  );
  assert.match(aboutCss, /\.about-model__steps > li:nth-child\(2\)\s*\{[^}]*width:\s*88%;/su);
  assert.match(aboutCss, /\.about-model__steps > li:nth-child\(3\)\s*\{[^}]*width:\s*94%;/su);
  assert.match(
    aboutCss,
    /\.about-program-streams li::before\s*\{[^}]*background:\s*var\(--program-stream-accent\);/su,
  );
  assert.match(
    aboutCss,
    /\.about-program-streams li:nth-child\(even\)\s*\{[^}]*width:\s*90%;[^}]*margin-left:\s*auto;/su,
  );
  assert.match(
    aboutCss,
    /@media \(max-width: 44rem\)[\s\S]*?\.about-artwork-strip\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/u,
  );
});

test("For Organizations leads with artwork, a facts band, and asymmetric pathways", async () => {
  const [organizations, organizationsCss] = await Promise.all([
    source("app/for-organizations/page.tsx"),
    source("public/styles/organizations.css"),
  ]);

  assert.match(
    organizations,
    /<header[\s\S]*?className="page-masthead page-masthead--compact organizations-hero"[\s\S]*?className="[^"]*organizations-hero__copy[^"]*"[\s\S]*?<aside[\s\S]*?className="organizations-hero__proof"[\s\S]*?<OrganizationActivityCard event=\{featuredEvent\} prominent \/>[\s\S]*?<\/header>\s*<ul[\s\S]*?className="organizations-hero__facts"[\s\S]*?<section[\s\S]*?className="organizations-collaboration"/u,
  );
  assert.match(
    organizationsCss,
    /\.for-organizations-page > \.organizations-hero\s*\{[^}]*grid-template-columns:\s*minmax\(0, 5fr\) minmax\(28rem, 7fr\);/su,
  );
  assert.match(
    organizationsCss,
    /\.organizations-hero__facts\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*background:\s*var\(--ink\);[^}]*color:\s*var\(--paper\);/su,
  );
  assert.match(
    organizationsCss,
    /\.organizations-collaboration\s*\{[^}]*grid-template-columns:\s*minmax\(15rem, 0\.72fr\) minmax\(0, 1\.28fr\);/su,
  );
  assert.match(
    organizationsCss,
    /\.organizations-collaboration article\s*\{[^}]*grid-template-columns:\s*minmax\(11rem, 0\.82fr\) minmax\(0, 1\.18fr\);/su,
  );
  assert.match(
    organizationsCss,
    /\.organizations-collaboration article:nth-child\(even\)\s*\{[^}]*width:\s*90%;[^}]*margin-left:\s*auto;/su,
  );
  assert.match(
    organizationsCss,
    /\.organizations-activity-card__artwork img\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;[^}]*object-fit:\s*contain;/su,
  );
  assert.match(
    organizationsCss,
    /@media \(max-width: 62rem\)[\s\S]*?\.for-organizations-page > \.organizations-hero,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/u,
  );
  assert.match(
    organizationsCss,
    /@media \(max-width: 42rem\)[\s\S]*?\.organizations-collaboration article\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*width:\s*100%;[^}]*margin-left:\s*0;/u,
  );
});

function sourceSection(value, startMarker, endMarker) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} must exist`);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return value.slice(start, end);
}

function occurrences(value, fragment) {
  return value.split(fragment).length - 1;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
