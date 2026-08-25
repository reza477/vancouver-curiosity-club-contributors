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
    /className="page-masthead page-masthead--compact organizations-hero"[\s\S]*?href="\/contact\?topic=partnerships#contact-form"[\s\S]*?Discuss a partnership[\s\S]*?className="organizations-evidence"/u,
  );
  assert.match(
    page,
    /className="organizations-hero__heading"[\s\S]*?<h1 id="organizations-title">[\s\S]*?className="organizations-hero__introduction"[\s\S]*?className="page-masthead__deck"/u,
  );
  assert.match(page, /className="organizations-hero__proof"/u);
  assert.match(page, /featuredEvent\s*\?\s*"See a current public program\."/u);
  assert.match(page, /"Review the public program structure\."/u);
  assert.match(
    page,
    /className="organizations-evidence"[\s\S]*?className="organizations-collaboration"[\s\S]*?className="organizations-standards"[\s\S]*?className="organizations-contact"/u,
  );
  for (const phrase of [
    "Current public activity",
    "Public work partners can review.",
    "Collaboration pathways",
    "Public operating standards",
    "Discuss a partnership",
  ]) {
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
});

test("For Organizations uses bounded current activity with truthful states and poster fallbacks", async () => {
  const page = await source("app/for-organizations/page.tsx");

  assert.match(page, /readPublicHomeEventMaterialization/u);
  assert.match(page, /getRequestPublicOrganization/u);
  assert.match(page, /maximum:\s*3/u);
  assert.match(page, /events\?\.find\(\(event\) => event\.artwork !== null\)/u);
  assert.match(page, /featuredEvent/u);
  assert.match(page, /additionalEvents/u);
  assert.match(page, /events === null/u);
  assert.match(page, /additionalEvents\.length > 0/u);
  assert.match(page, /additionalEvents\.map\(\(event\)/u);
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

  assert.match(page, /catalog\.site\.legalName \?/u);
  assert.match(
    page,
    /catalog\.site\.institutionalFacts\.foundedYear !== null/u,
  );
  assert.match(
    page,
    /catalog\.site\.institutionalFacts\.attendanceTotal !== null/u,
  );
  assert.match(
    page,
    /catalog\.site\.institutionalFacts\.memberTotal !== null/u,
  );
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

test("For Organizations route styles remain bounded and stack the evidence cleanly", async () => {
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
    /\.organizations-evidence__gallery\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/su,
  );
  assert.match(
    css,
    /\.organizations-collaboration__grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/su,
  );
  assert.match(
    css,
    /\.for-organizations-page > \.organizations-hero\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/su,
  );
  assert.match(
    css,
    /\.organizations-hero__copy\s*\{[^}]*grid-template-columns:\s*minmax\(15rem, 0\.74fr\) minmax\(0, 1\.26fr\);/su,
  );
  assert.match(css, /\.organizations-activity-card__artwork-frame/u);
  assert.match(css, /\.organizations-hero__proof/u);
  assert.match(css, /\.organizations-hero__facts/u);
  assert.doesNotMatch(
    css,
    /\.organizations-(?:introduction|footprint|conversation)\b/u,
  );
  const tabletStyles = css.slice(
    css.indexOf("@media (max-width: 52rem)"),
    css.indexOf("@media (max-width: 42rem)"),
  );
  assert.doesNotMatch(
    tabletStyles,
    /\.for-organizations-page > \.organizations-hero,/u,
  );
  assert.match(css, /@media \(max-width: 42rem\)/u);
  assert.match(
    css,
    /@media \(max-width: 42rem\)[\s\S]*?\.organizations-hero__copy\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/u,
  );
  assert.match(
    css,
    /@media \(max-width: 42rem\)[\s\S]*?\.organizations-evidence__gallery,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/u,
  );
  assert.doesNotMatch(css, /font-size:\s*0\.[0-6][0-9]*rem/u);
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function source(path) {
  return readFile(new URL(path, projectRoot), "utf8");
}
