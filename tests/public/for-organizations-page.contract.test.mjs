import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

test("For Organizations presents the institutional partnership story in a clear order", async () => {
  const page = await source("app/for-organizations/page.tsx");

  assert.match(
    page,
    /title="Build thoughtful public programs with us"/u,
  );
  assert.match(
    page,
    /className="organizations-introduction"[\s\S]*?className="organizations-evidence"[\s\S]*?className="organizations-footprint"[\s\S]*?className="organizations-collaboration"[\s\S]*?className="organizations-conversation"[\s\S]*?className="organizations-standards"[\s\S]*?className="organizations-contact"/u,
  );
  for (const phrase of [
    "Mission and public need",
    "Current public activity",
    "A program partners can review.",
    "Program footprint",
    "Collaboration pathways",
    "A useful first conversation",
    "Public operating standards",
    "Discuss a partnership",
  ]) {
    assert.ok(page.includes(phrase), phrase);
  }
  assert.doesNotMatch(
    page,
    /Verified public information|What is available now|claims? about existing partnerships/iu,
  );
});

test("For Organizations uses bounded current activity with truthful states and poster fallbacks", async () => {
  const page = await source("app/for-organizations/page.tsx");

  assert.match(page, /readPublicHomeEventMaterialization/u);
  assert.match(page, /getRequestPublicOrganization/u);
  assert.match(page, /maximum:\s*3/u);
  assert.match(page, /events === null/u);
  assert.match(page, /events\.length > 0/u);
  assert.match(page, /events\.map\(\(event\)/u);
  assert.match(page, /<EventPosterImage/u);
  assert.match(page, /<EventArtworkFallback/u);
  assert.match(page, /responsiveImageSrcSet/u);
  assert.match(page, /institutionalEventTitle\(event\)/u);
  assert.match(page, /loading="lazy"/u);
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
    "/accessibility",
    "/privacy",
    "/contact?topic=partnerships#contact-form",
  ]) {
    assert.match(page, new RegExp(`href="${escapeRegex(href)}"`, "u"));
  }
  assert.match(page, /selectCanonicalPublicCommunities\(catalog\.clubs\)/u);
  assert.match(page, /collaborationOptions\.map/u);
  assert.match(page, /FIRST_CONVERSATION_TOPICS\.map/u);
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
    /\.organizations-evidence__gallery\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/su,
  );
  assert.match(css, /\.organizations-activity-card__artwork-frame/u);
  assert.match(css, /@media \(max-width: 42rem\)/u);
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
