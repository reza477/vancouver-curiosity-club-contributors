import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

const scopedFiles = [
  "app/_components/HomePageRenderer.tsx",
  "app/about/page.tsx",
  "app/for-organizations/page.tsx",
  "app/_components/ClubDirectory.tsx",
  "app/_components/EditorialRouteBodies.tsx",
  "app/styles/pages/home.css",
  "public/styles/about.css",
  "public/styles/organizations.css",
  "app/styles/components/catalog.css",
  "app/styles/components/forms.css",
];

const decorativeMarkerClasses = [
  "home-glance__number",
  "home-program__number",
  "home-principle__number",
  "home-community__number",
  "about-model__number",
  "about-community__number",
  "organization-path__number",
  "club-directory__number",
  "contribution-card__number",
];

test("institutional routes do not render or reserve decorative sequence markers", async () => {
  const sources = await Promise.all(
    scopedFiles.map((file) => readFile(new URL(file, projectRoot), "utf8")),
  );
  const combinedSource = sources.join("\n");

  for (const className of decorativeMarkerClasses) {
    assert.doesNotMatch(combinedSource, new RegExp(className, "u"));
  }

  assert.doesNotMatch(combinedSource, /padStart\(2,\s*["']0["']\)/u);
});

test("real public counts and count-bearing headings remain intact", async () => {
  const [homeSource, aboutSource, organizationsSource] = await Promise.all([
    readFile(
      new URL("app/_components/HomePageRenderer.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/about/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/for-organizations/page.tsx", projectRoot), "utf8"),
  ]);

  assert.match(homeSource, /\$\{lanes\.length\} program/u);
  assert.match(homeSource, /\$\{publicClubs\.length\} public/u);
  assert.match(homeSource, /Four ways into community life\./u);
  assert.match(homeSource, /One organization, three public communities/u);
  assert.match(aboutSource, /Three public communities/u);
  assert.match(organizationsSource, /<strong>\{lanes\.length\}<\/strong>/u);
  assert.match(organizationsSource, /<strong>\{clubs\.length\}<\/strong>/u);
});
