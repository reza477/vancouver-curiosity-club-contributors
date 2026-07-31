import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseTrustedRequestPathname,
  parseTrustedRequestOrigin,
  publicUrl,
} from "../../lib/server/public/origin.ts";

const projectRoot = new URL("../../", import.meta.url);
const requiredPublicRoutes = [
  "app/page.tsx",
  "app/calendar/page.tsx",
  "app/events/page.tsx",
  "app/events/[slug]/page.tsx",
  "app/clubs/page.tsx",
  "app/clubs/[slug]/page.tsx",
  "app/community/page.tsx",
  "app/about/page.tsx",
  "app/get-involved/page.tsx",
  "app/host-an-event/page.tsx",
  "app/contact/page.tsx",
  "app/conduct/page.tsx",
  "app/accessibility/page.tsx",
  "app/privacy/page.tsx",
  "app/not-found.tsx",
  "app/robots.ts",
  "app/sitemap.ts",
];

test("Phase 2 exposes the complete public route contract", async () => {
  await Promise.all(
    requiredPublicRoutes.map((path) => access(new URL(path, projectRoot))),
  );

  const [header, footer, layout] = await Promise.all([
    readFile(new URL("app/_components/SiteHeader.tsx", projectRoot), "utf8"),
    readFile(new URL("app/_components/SiteFooter.tsx", projectRoot), "utf8"),
    readFile(new URL("app/layout.tsx", projectRoot), "utf8"),
  ]);
  for (const [href, label] of [
    ["/calendar", "Calendar"],
    ["/community", "Community"],
    ["/about", "About"],
  ]) {
    assert.match(header, new RegExp(`href[:=]\\s*["']${href}["']|href:\\s*["']${href}["']`));
    assert.match(header, new RegExp(label));
  }
  for (const href of [
    "/calendar",
    "/clubs",
    "/community",
    "/about",
    "/get-involved",
    "/contact",
    "/conduct",
    "/accessibility",
    "/privacy",
    "/organizer",
  ]) {
    assert.match(
      footer,
      new RegExp(`href[:=]\\s*["']${href}["']|href:\\s*["']${href}["']`),
    );
  }
  assert.match(layout, /<SiteHeader[\s\S]*brandName=\{shell\?\.brandName\}/u);
  assert.match(layout, /<SiteFooter/u);
  assert.match(layout, /Skip to main content/u);
  assert.match(layout, /const isUnknownPath = !isKnownApplicationPath/u);
  assert.match(layout, /robots:\s*isUnknownPath/u);
  assert.match(layout, /index:\s*false/u);
  assert.match(layout, /follow:\s*false/u);
  assert.match(layout, /noarchive:\s*true/u);
  assert.match(layout, /:\s*undefined/u);
  assert.doesNotMatch(layout, /(?:^|\n)\s*index:\s*true/mu);
  assert.doesNotMatch(layout, /follow:\s*true/u);
  assert.doesNotMatch(layout, /http:\/\/localhost/u);
});

test("Calendar is the single simple month-at-a-glance experience", async () => {
  const [calendar, events, filters] = await Promise.all([
    readFile(new URL("app/calendar/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/events/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/_components/EventFilters.tsx", projectRoot),
      "utf8",
    ),
  ]);

  assert.match(calendar, /path:\s*"\/calendar"/u);
  assert.match(calendar, /PublicMonthCalendar/u);
  assert.match(calendar, /Object\.keys\(params\)\.length === 0/u);
  assert.doesNotMatch(calendar, /permanentRedirect/u);
  assert.match(
    events,
    /export \{ default, dynamic, generateMetadata \} from "\.\.\/calendar\/page"/u,
  );
  assert.doesNotMatch(events, /EventsPageRenderer|EventFilters/u);
  assert.match(filters, /method="get"/u);
  assert.match(filters, /key=\{filterFormKey\(values\)\}/u);
  assert.match(filters, /href=\{`\/events\?state=\$\{values\.state\}`\}/u);
  assert.match(filters, /Clear Filters/u);
  for (const name of [
    "q",
    "from",
    "to",
    "club",
    "lane",
    "category",
    "format",
  ]) {
    assert.match(filters, new RegExp(`name="${name}"`));
  }
});

test("public editorial surfaces use D1 readers without dead forms or discussion claims", async () => {
  const sources = await Promise.all(
    [
      "app/community/page.tsx",
      "app/contact/page.tsx",
      "app/get-involved/page.tsx",
      "app/host-an-event/page.tsx",
      "app/clubs/page.tsx",
      "app/clubs/[slug]/page.tsx",
      "app/_components/EditorialPage.tsx",
      "app/_components/ClubDirectory.tsx",
    ].map((path) => readFile(new URL(path, projectRoot), "utf8")),
  );
  const joined = sources.join("\n");

  assert.match(joined, /getPublicPageContent|loadEditorialPage/u);
  assert.match(joined, /listPublicCommunityLinks|loadCommunityDestinations/u);
  assert.match(joined, /getPublicClubBySlug/u);
  assert.match(joined, /queryPublicEvents/u);
  assert.match(joined, /notFound\(\)/u);
  assert.doesNotMatch(joined, /<form\b/iu);
  assert.doesNotMatch(joined, /discussion(?:\s+board|\s+forum|\s+link)?/iu);
  assert.doesNotMatch(joined, /mailto:|@gmail\.|@outlook\./iu);
  assert.doesNotMatch(joined, /charit(?:y|able)|registered society/iu);
  assert.match(joined, /rel="noreferrer noopener"/u);
});

test("robots, sitemap, and structured data stay public-only", async () => {
  const [
    robots,
    sitemap,
    catalogSitemap,
    structuredData,
    eventDetail,
    eventStructuredData,
    eventRenderer,
  ] =
    await Promise.all([
    readFile(new URL("app/robots.ts", projectRoot), "utf8"),
    readFile(new URL("app/sitemap.ts", projectRoot), "utf8"),
    readFile(
      new URL("lib/server/public/sitemap.ts", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("app/_components/StructuredData.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/events/[slug]/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL(
        "lib/server/public/event-structured-data.ts",
        projectRoot,
      ),
      "utf8",
    ),
    readFile(
      new URL("app/_components/PublicEventDetailRenderer.tsx", projectRoot),
      "utf8",
    ),
  ]);

  for (const privatePath of [
    "/*?*",
    "/api/",
    "/auth",
    "/invitations",
    "/organizer",
    "/preview",
    "/signin-with-chatgpt",
  ]) {
    assert.match(robots, new RegExp(escapeRegex(privatePath)));
  }
  assert.match(sitemap, /listPublicCatalogSitemapEntries/u);
  assert.match(catalogSitemap, /page\.status = 'published'/u);
  assert.match(catalogSitemap, /page\.visibility = 'public'/u);
  assert.match(
    catalogSitemap,
    /(?:profile|detail)\.publication_status = 'published'/u,
  );
  assert.match(catalogSitemap, /cms_public_materialization_receipts/u);
  assert.doesNotMatch(
    `${sitemap}\n${catalogSitemap}`,
    /source_url|normalized_email|private_notes/iu,
  );
  assert.match(structuredData, /replaceAll\("<", "\\\\u003c"\)/u);
  assert.match(structuredData, /getTrustedCspNonce/u);
  assert.match(eventDetail, /buildPublicEventJsonLd/u);
  assert.match(eventDetail, /"@type": "BreadcrumbList"/u);
  assert.match(eventStructuredData, /location:\s*eventLocation\(event\)/u);
  assert.match(eventStructuredData, /"@type":\s*"Place"/u);
  assert.match(eventStructuredData, /"@type":\s*"VirtualLocation"/u);
  assert.match(eventStructuredData, /event\.publicOnlineUrl/u);
  assert.match(eventStructuredData, /event\.venue/u);
  assert.match(eventStructuredData, /sameAs:\s*event\.rsvpUrl/u);
  assert.match(eventStructuredData, /event\.organizers\.map/u);
  assert.match(eventStructuredData, /"@type":\s*"Person"/u);
  assert.doesNotMatch(eventStructuredData, /\bperformer\s*:/u);
  assert.doesNotMatch(eventStructuredData, /event\.club/u);
  assert.match(eventRenderer, /event\.venue\s*\?/u);
  assert.match(eventRenderer, /event\.rsvpUrl && !event\.isCancelled/u);
  assert.doesNotMatch(
    `${structuredData}\n${eventDetail}\n${eventStructuredData}\n${eventRenderer}`,
    /source_url|private_notes|private_meeting_details|normalized_email/iu,
  );
});

test("trusted origin parsing cannot be steered cross-origin", () => {
  const production = parseTrustedRequestOrigin("https://preview.example");
  assert.equal(production?.origin, "https://preview.example");
  assert.equal(
    publicUrl("/events?lane=think", production),
    "https://preview.example/events?lane=think",
  );
  assert.equal(parseTrustedRequestOrigin("http://attacker.example"), null);
  assert.equal(
    parseTrustedRequestOrigin("https://preview.example/path"),
    null,
  );
  assert.throws(
    () => publicUrl("//attacker.example/events", production),
    /same-origin/u,
  );
  assert.equal(
    parseTrustedRequestPathname("/events/a-curious-night"),
    "/events/a-curious-night",
  );
  assert.equal(parseTrustedRequestPathname("//attacker.example/events"), null);
  assert.equal(parseTrustedRequestPathname("/events?private=sentinel"), null);
  assert.equal(parseTrustedRequestPathname("events"), null);
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
