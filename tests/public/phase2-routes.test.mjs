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

  const [header, footer, layout, community, home, homeRenderer] =
    await Promise.all([
      readFile(new URL("app/_components/SiteHeader.tsx", projectRoot), "utf8"),
      readFile(new URL("app/_components/SiteFooter.tsx", projectRoot), "utf8"),
      readFile(new URL("app/layout.tsx", projectRoot), "utf8"),
      readFile(new URL("app/community/page.tsx", projectRoot), "utf8"),
      readFile(new URL("app/page.tsx", projectRoot), "utf8"),
      readFile(
        new URL("app/_components/HomePageRenderer.tsx", projectRoot),
        "utf8",
      ),
    ]);
  const primaryDestinations = [
    ["/events", "Events"],
    ["/clubs", "Clubs"],
    ["/about", "About"],
    ["/host-an-event", "Host an Event"],
  ];
  let priorDestinationIndex = -1;
  for (const [href, label] of primaryDestinations) {
    const destinationIndex = header.indexOf(
      `{ href: "${href}", label: "${label}" }`,
    );
    assert.ok(destinationIndex > priorDestinationIndex, `${label} order`);
    priorDestinationIndex = destinationIndex;
  }
  assert.equal(
    (header.match(/\{ href: "\/[^"]+", label: "[^"]+" \}/gu) ?? [])
      .length,
    4,
  );
  assert.match(
    header,
    /href === "\/events"[\s\S]*?pathname === "\/events"[\s\S]*?pathname\.startsWith\("\/events\/"\)[\s\S]*?pathname === "\/calendar"/u,
  );
  assert.match(header, /pathname === href/u);
  assert.match(header, /pathname\.startsWith\(`\$\{href\}\/`\)/u);
  for (const href of [
    "/calendar",
    "/clubs",
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
  assert.doesNotMatch(header, /\{ href: "\/community", label: "Community" \}/u);
  assert.doesNotMatch(footer, /\{ href: "\/community", label: "Community" \}/u);
  assert.match(footer, /item\.href === "\/community"/u);
  assert.match(community, /permanentRedirect\("\/get-involved"\)/u);
  assert.doesNotMatch(community, /loadEditorialPage|loadCommunityDestinations/u);
  assert.match(home, /loadPublicHomeData/u);
  assert.match(home, /<HomePageRenderer/u);
  assert.doesNotMatch(home, /CalendarPage|PublicMonthCalendar/u);
  for (const copy of [
    "Books, films, ideas, walks & creative nights in Vancouver",
    "Come curious. Leave knowing people.",
    "Vancouver Curiosity Club is for people who miss conversations that go somewhere. Pick a gathering that pulls you in, show up as you are, and meet thoughtful people through books, films, big questions, city walks, creative practice, food, and play.",
    "See upcoming gatherings",
    "New here? Start here",
  ]) {
    assert.ok(homeRenderer.includes(copy), copy);
  }
  const homepageSections = [
    "home-hero",
    "home-events",
    "home-newcomer attending-note",
    "home-community-feel attending-note",
    "lane-index",
    "home-clubs",
    "home-proof home-community",
    "home-closing home-invitation",
  ];
  assert.equal((homeRenderer.match(/<section\b/gu) ?? []).length, 8);
  let priorSectionIndex = -1;
  for (const className of homepageSections) {
    const sectionIndex = homeRenderer.indexOf(`className="${className}"`);
    assert.ok(sectionIndex > priorSectionIndex, className);
    priorSectionIndex = sectionIndex;
  }
  assert.doesNotMatch(
    homeRenderer,
    /PublicMonthCalendar|public-calendar__grid|calendar-view-switcher/u,
  );
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

test("Events combines a full calendar with upcoming and past lists while Calendar remains canonical", async () => {
  const [calendar, events, renderer, maintenance, worker] = await Promise.all([
    readFile(new URL("app/calendar/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/events/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/_components/EventsPageRenderer.tsx", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("lib/server/database/request-maintenance.ts", projectRoot),
      "utf8",
    ),
    readFile(new URL("worker/index.ts", projectRoot), "utf8"),
  ]);

  assert.match(calendar, /path:\s*"\/calendar"/u);
  assert.match(calendar, /PublicMonthCalendar/u);
  assert.match(calendar, /Object\.keys\(params\)\.length === 0/u);
  assert.doesNotMatch(calendar, /permanentRedirect/u);
  assert.match(
    calendar,
    /<Link href="\/events">List<\/Link>[\s\S]*?aria-current="page" href="\/calendar"/u,
  );
  assert.doesNotMatch(
    calendar,
    /home-hero|home-newcomer|Come curious\. Leave knowing people\.|calendar-home-introduction/u,
  );

  assert.match(events, /EventsPageRenderer/u);
  assert.match(events, /eventListValues\(raw\)/u);
  assert.match(events, /queryPublicEvents/u);
  assert.match(events, /loadPublicMonthCalendar/u);
  assert.match(events, /view:\s*values\.state/u);
  assert.doesNotMatch(events, /from "\.\.\/calendar\/page"/u);
  assert.match(`${events}\n${renderer}`, /PublicMonthCalendar/u);
  assert.match(
    renderer,
    /state:\s*params\.state === "past" \? "past" : "upcoming"/u,
  );
  assert.match(renderer, />\s*Upcoming\s*</u);
  assert.match(renderer, />\s*Past\s*</u);
  assert.doesNotMatch(renderer, /<EventFilters\b/u);
  assert.doesNotMatch(
    renderer,
    /public-export-actions|Download this public view|exportHref\(/u,
  );
  assert.ok(
    renderer.indexOf("<PublicMonthCalendar") <
      renderer.indexOf("<EventCollection"),
    "the full month calendar must appear before the event list",
  );
  assert.match(renderer, /<EventCollection/u);
  assert.match(calendar, /Download upcoming events/u);
  assert.match(calendar, /href="\/events\/calendar\.ics"/u);
  assert.match(calendar, /href="\/events\/events\.csv"/u);
  assert.doesNotMatch(
    `${calendar}\n${events}\n${renderer}`,
    /readPublicMeetupSyncState|CalendarSourceStatus|SourceStatus|data-source-status|latest Meetup check|Meetup refresh|last complete calendar|Last completed snapshot|not on a guaranteed schedule/u,
  );
  assert.doesNotMatch(events, /refreshMeetupCalendarSourceIfDue/u);
  assert.match(maintenance, /refreshMeetupCalendarSourceIfDue/u);
  assert.match(maintenance, /schedulePublicMeetupRefresh/u);
  assert.match(worker, /maintenanceRedirect/u);
  assert.match(
    worker,
    /const response = await handler\.fetch[\s\S]*?const securedResponse = secureResponse[\s\S]*?schedulePublicMeetupRefresh\([\s\S]*?ctx\.waitUntil\(task\)[\s\S]*?return securedResponse/u,
  );
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
