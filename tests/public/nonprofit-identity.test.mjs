import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteFooter } from "../../app/_components/SiteFooter.tsx";
import {
  PUBLIC_MISSION_PARAGRAPHS,
  PUBLIC_NONPROFIT_IDENTITY,
} from "../../lib/public-mission-copy.ts";
import { containsProtectedLegalClaim } from "../../lib/validation/protected-legal-claims.ts";

const projectRoot = new URL("../../", import.meta.url);
const approvedIdentity = "Vancouver Curiosity Club is a program of Vancouver Curiosity and Education Society, a nonprofit organization.";
const approvedFooter = "Vancouver Curiosity Club is a program of Vancouver Curiosity and Education Society, a B.C. nonprofit society. Incorporation number: S0085718. This website is operated by the Society.";

test("the owner-approved identity names the nonprofit and its public program without charity or tax claims", () => {
  assert.equal(PUBLIC_NONPROFIT_IDENTITY, approvedIdentity);
  assert.doesNotMatch(approvedIdentity, /registered|charit|tax|donation|receipt/iu);
  assert.ok(PUBLIC_MISSION_PARAGRAPHS.every((paragraph) => !containsProtectedLegalClaim(paragraph)),
    "existing CMS mission seeds stay neutral; identity belongs to the reviewed institutional presentation");
  assert.equal(containsProtectedLegalClaim(approvedIdentity), true,
    "adding reviewed institutional copy must not relax organizer-authored content safeguards");
});

test("the shared footer renders nonprofit identity with no JavaScript or CMS configuration required", () => {
  const markup = renderToStaticMarkup(createElement(SiteFooter, { prefetchInternalLinks: false }));
  const legalLink = /<p class="footer-legal-name"><a\b[^>]*\bhref="\/about#legal-information"[^>]*>([^<]+)<\/a><\/p>/u.exec(markup);
  assert.equal(legalLink?.[1], approvedFooter);
  assert.equal(markup.split(approvedFooter).length - 1, 1);
  for (const label of ["Explore", "Participate", "Community information", "Contact"]) {
    assert.ok(markup.includes(label));
  }
});

test("Home, About and For Organizations display the same identity within their introductions", async () => {
  const [home, about, organizations] = await Promise.all([
    "app/_components/HomePageRenderer.tsx",
    "app/about/page.tsx",
    "app/for-organizations/page.tsx",
  ].map((path) => readFile(new URL(path, projectRoot), "utf8")));
  assert.match(home, /<p className="home-hero__deck">\{PUBLIC_NONPROFIT_IDENTITY\}<\/p>/u);
  assert.match(about, /className="about-hero__introduction">\s*<p>\{PUBLIC_NONPROFIT_IDENTITY\}<\/p>/u);
  assert.match(organizations, /className="page-masthead__deck">\s*\{PUBLIC_NONPROFIT_IDENTITY\}/u);
  assert.match(home, /our nonprofit’s thoughtful public programs/u);
});
