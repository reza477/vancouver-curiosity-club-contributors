import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

test("For Organizations presents the institutional partnership story in a clear order", async () => {
  const page = await source("app/for-organizations/page.tsx");

  assert.match(
    page,
    /<h1 id="organizations-title">\s*Build thoughtful public programs with us\s*<\/h1>/u,
  );
  assert.match(
    page,
    /className="page-masthead page-masthead--compact organizations-hero"[\s\S]*?href="\/contact\?topic=partnerships#contact-form"[\s\S]*?Discuss a partnership[\s\S]*?href="\/events"[\s\S]*?View public events[\s\S]*?className="organizations-collaboration"/u,
  );
  assert.match(
    page,
    /className="organizations-hero__heading"[\s\S]*?<h1 id="organizations-title">[\s\S]*?className="organizations-hero__introduction"[\s\S]*?className="page-masthead__deck"/u,
  );
  assert.match(page, /className="organizations-hero__proof"/u);
  assert.match(
    page,
    /<\/header>\s*<ul\s+className="organizations-hero__facts"[\s\S]*?<\/ul>\s*<section\s+className="organizations-collaboration"/u,
    "the concise public-scope band must sit directly below the artwork-led hero",
  );
  assert.match(page, /featuredEvent\s*\?\s*"See a current public program\."/u);
  assert.match(page, /"Review the public program structure\."/u);
  assert.match(
    page,
    /className="organizations-collaboration"[\s\S]*?className="organizations-standards"[\s\S]*?className="organizations-contact"/u,
  );
  for (const phrase of ["Discuss a partnership"]) {
    assert.ok(page.includes(phrase), phrase);
  }
  assert.doesNotMatch(
    page,
    /Verified public information|What is available now|claims? about existing partnerships/iu,
  );
  assert.doesNotMatch(
    page,
    /organizations-(?:introduction|footprint|conversation)/u,
  );
  assert.doesNotMatch(
    page,
    /organizations-evidence|Current public activity|Public work partners can review\.|Review public work|id="public-work"/u,
  );
});

test("For Organizations uses one bounded current activity with truthful states and poster fallbacks", async () => {
  const page = await source("app/for-organizations/page.tsx");

  assert.match(page, /readPublicHomeEventMaterialization/u);
  assert.match(page, /getRequestPublicOrganization/u);
  assert.match(page, /maximum:\s*1/u);
  assert.match(page, /events\?\.find\(\(event\) => event\.artwork !== null\)/u);
  assert.match(page, /featuredEvent/u);
  assert.match(page, /events === null/u);
  assert.doesNotMatch(page, /additionalEvents/u);
  assert.match(page, /<EventPosterImage/u);
  assert.match(page, /<EventArtworkFallback/u);
  assert.match(page, /responsiveImageSrcSet/u);
  assert.match(page, /institutionalEventTitle\(event\)/u);
  assert.match(page, /loading=\{prominent \? "eager" : "lazy"\}/u);
  assert.match(page, /fetchPriority=\{prominent \? "high" : undefined\}/u);
  assert.doesNotMatch(
    page,
    /file:\s*"meetup-[0-9]+"|ORGANIZATION_POSTERS/u,
    "current activity must come from the materialized event view, not an attractive historical poster list",
  );
});

test("For Organizations keeps claims evidence-safe and exposes the review and contact paths", async () => {
  const page = await source("app/for-organizations/page.tsx");

  assert.doesNotMatch(
    page,
    /\b(?:registered nonprofit|nonprofit organization|registered charity|charitable organization|tax[- ]deductible|tax receipt)\b/iu,
  );
  assert.doesNotMatch(
    page,
    /\btestimonial(?:s)?\b|<blockquote\b|members? (?:say|report)/iu,
  );
  for (const href of [
    "/about",
    "/events",
    "/conduct",
    "/privacy",
    "/contact?topic=partnerships#contact-form",
  ]) {
    assert.match(page, new RegExp(`href="${escapeRegex(href)}"`, "u"));
  }
  assert.doesNotMatch(page, /href="\/accessibility"/u);
  assert.match(page, /selectCanonicalPublicCommunities\(catalog\.clubs\)/u);
  assert.match(page, /collaborationOptions\.map/u);
  assert.doesNotMatch(page, /FIRST_CONVERSATION_TOPICS/u);
});

test("For Organizations route styles remain bounded and stack its remaining sections cleanly", async () => {
  const stylesheetPath = new URL(
    "public/styles/organizations.css",
    projectRoot,
  );
  const [css, file] = await Promise.all([
    readFile(stylesheetPath, "utf8"),
    stat(stylesheetPath),
  ]);

  assert.ok(file.size < 30_000, "the route stylesheet must remain bounded");
  assert.match(
    css,
    /\.for-organizations-page > \.organizations-hero\s*\{[^}]*grid-template-columns:\s*minmax\(0, 5fr\) minmax\(28rem, 7fr\);[^}]*align-items:\s*center;/su,
    "the desktop hero must use the approved artwork-led 5/7 split",
  );
  assert.match(
    css,
    /\.organizations-hero__copy\s*\{[^}]*display:\s*block;/su,
    "the hero copy must read as one natural editorial column",
  );
  assert.match(css, /\.organizations-activity-card__artwork-frame/u);
  assert.match(css, /\.organizations-hero__proof/u);
  assert.match(
    css,
    /\.organizations-hero__facts\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*margin:\s*0;[^}]*background:\s*var\(--ink\);[^}]*display:\s*grid;/su,
    "verified program facts must form a compact horizontal band",
  );
  assert.match(
    css,
    /\.organizations-collaboration\s*\{[^}]*grid-template-columns:\s*minmax\(15rem, 0\.72fr\) minmax\(0, 1\.28fr\);[^}]*display:\s*grid;/su,
    "collaboration pathways must use an asymmetric section composition",
  );
  assert.match(
    css,
    /\.organizations-collaboration__grid\s*\{[^}]*border-top:\s*1px solid var\(--line\);[^}]*display:\s*grid;/su,
  );
  assert.match(
    css,
    /\.organizations-collaboration article\s*\{[^}]*grid-template-columns:\s*minmax\(11rem, 0\.82fr\) minmax\(0, 1\.18fr\);[^}]*display:\s*grid;/su,
    "each pathway must read as an editorial index row rather than an equal box",
  );
  assert.match(
    css,
    /\.organizations-collaboration article:nth-child\(even\)\s*\{[^}]*width:\s*90%;[^}]*margin-left:\s*auto;/su,
    "the index must preserve its restrained staggered widths",
  );
  assert.doesNotMatch(
    css,
    /\.organizations-(?:introduction|footprint|conversation)\b/u,
  );
  assert.doesNotMatch(css, /organizations-evidence|organizations-heading--split/u);
  assert.match(
    css,
    /@media \(max-width: 62rem\)[\s\S]*?\.for-organizations-page > \.organizations-hero,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/u,
    "the hero and collaboration composition must stack before they become cramped",
  );
  assert.match(css, /@media \(max-width: 42rem\)/u);
  assert.match(
    css,
    /@media \(max-width: 42rem\)[\s\S]*?\.organizations-hero__facts\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/u,
    "the public-scope band must preserve a natural mobile reading order",
  );
  assert.match(
    css,
    /@media \(max-width: 42rem\)[\s\S]*?\.organizations-collaboration article\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*width:\s*100%;[^}]*margin-left:\s*0;/u,
    "staggered pathway rows must reset cleanly on mobile",
  );
  assert.doesNotMatch(css, /font-size:\s*0\.[0-6][0-9]*rem/u);
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function source(path) {
  return readFile(new URL(path, projectRoot), "utf8");
}
