import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

test("the retired Accessibility page cannot be rendered, linked, or indexed", async () => {
  await assert.rejects(
    access(new URL("app/accessibility/page.tsx", projectRoot)),
    (error) => error?.code === "ENOENT",
  );

  const [
    dynamicRoute,
    layout,
    sitemap,
    footer,
    about,
    organizations,
    catalog,
  ] = await Promise.all([
    source("app/[slug]/page.tsx"),
    source("app/layout.tsx"),
    source("app/sitemap.ts"),
    source("app/_components/SiteFooter.tsx"),
    source("app/about/page.tsx"),
    source("app/for-organizations/page.tsx"),
    source("lib/server/public/catalog.ts"),
  ]);

  assert.match(dynamicRoute, /retiredPublicPageSlugs = new Set\(\["accessibility"\]\)/u);
  assert.equal(
    (dynamicRoute.match(/retiredPublicPageSlugs\.has\(slug\)\) notFound\(\)/gu) ?? [])
      .length,
    2,
    "metadata and page rendering must both stop before reading the retired CMS page",
  );
  assert.match(
    dynamicRoute,
    /redirect\.kind === "available"[\s\S]*retiredPublicPageSlugs\.has\(redirect\.slug\)\) notFound\(\)/u,
    "legacy CMS redirects must not restore the retired page",
  );
  assert.doesNotMatch(layout, /^\s*"\/accessibility",?$/mu);
  assert.doesNotMatch(sitemap, /\["accessibility", "\/accessibility"\]/u);
  assert.doesNotMatch(about, /href="\/accessibility"/u);
  assert.doesNotMatch(organizations, /href="\/accessibility"/u);
  assert.doesNotMatch(
    footer.slice(footer.indexOf("function normalizedFooterNavigation")),
    /\{ href: "\/accessibility", label: "Accessibility" \}/u,
  );
  assert.match(footer, /item\.href === "\/accessibility"/u);

  const publicPagePath = sourceSection(
    catalog,
    "function publicPagePath",
    "function isProtectedNavigationHref",
  );
  assert.doesNotMatch(publicPagePath, /"accessibility"/u);
  assert.match(
    sourceSection(
      catalog,
      "function cleanPublicContentUrl",
      "function publicPagePath",
    ),
    /parsed\.pathname === "\/accessibility"\) return null/u,
  );
});

test("retiring the standalone page preserves event-specific accessibility information", async () => {
  const eventDetail = await source(
    "app/_components/PublicEventDetailRenderer.tsx",
  );
  assert.match(eventDetail, /event\.verifiedAccessibilityNotes/u);
  assert.match(eventDetail, /heading="Accessibility information"/u);
});

function sourceSection(sourceText, startMarker, endMarker) {
  const start = sourceText.indexOf(startMarker);
  const end = sourceText.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} must exist`);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return sourceText.slice(start, end);
}

function source(path) {
  return readFile(new URL(path, projectRoot), "utf8");
}
