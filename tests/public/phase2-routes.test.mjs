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
  "app/calendar/route.ts",
  "app/events/page.tsx",
  "app/events/[slug]/page.tsx",
  "app/clubs/page.tsx",
  "app/clubs/[slug]/page.tsx",
  "app/community/page.tsx",
  "app/about/page.tsx",
  "app/for-organizations/page.tsx",
  "app/get-involved/page.tsx",
  "app/host-an-event/page.tsx",
  "app/contact/page.tsx",
  "app/conduct/page.tsx",
  "app/privacy/page.tsx",
  "app/not-found.tsx",
  "app/robots.ts",
  "app/sitemap.ts",
];

test("Phase 2 exposes the complete public route contract", async () => {
  await Promise.all(
    requiredPublicRoutes.map((path) => access(new URL(path, projectRoot))),
  );

  const [header, footer, layout, community, home, homeRenderer, missionCopy] =
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
      readFile(new URL("lib/public-mission-copy.ts", projectRoot), "utf8"),
    ]);
  const homePositioning = `${homeRenderer}\n${missionCopy}`;
  const primaryDestinations = [
    ["/events", "Events"],
    ["/clubs", "Clubs"],
    ["/about", "About"],
    ["/for-organizations", "For Organizations"],
    ["/contact", "Contact"],
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
    5,
  );
  assert.match(
    header,
    /href === "\/events"[\s\S]*?pathname === "\/events"[\s\S]*?pathname\.startsWith\("\/events\/"\)[\s\S]*?pathname === "\/calendar"/u,
  );
  assert.match(header, /pathname === href/u);
  assert.match(header, /pathname\.startsWith\(`\$\{href\}\/`\)/u);
  for (const href of [
    "/events",
    "/clubs",
    "/about",
    "/for-organizations",
    "/get-involved",
    "/contact",
    "/conduct",
    "/privacy",
    "/organizer",
  ]) {
    assert.match(
      footer,
      new RegExp(`href[:=]\\s*["']${href}["']|href:\\s*["']${href}["']`),
    );
  }
  assert.doesNotMatch(footer, /href[:=]\s*["']\/accessibility["']/u);
  assert.doesNotMatch(header, /\{ href: "\/community", label: "Community" \}/u);
  assert.doesNotMatch(footer, /\{ href: "\/community", label: "Community" \}/u);
  assert.match(footer, /item\.href === "\/community"/u);
  assert.match(community, /permanentRedirect\("\/get-involved"\)/u);
  assert.doesNotMatch(community, /loadEditorialPage|loadCommunityDestinations/u);
  assert.match(home, /loadPublicHomeData/u);
  assert.match(home, /<HomePageRenderer/u);
  assert.match(
    home,
    /descriptionOverride:\s*PUBLIC_HOME_MISSION_COPY\.metadataDescription/u,
  );
  assert.doesNotMatch(home, /CalendarPage|PublicMonthCalendar/u);
  for (const copy of [
    "Our mission",
    "Building community through curiosity.",
    "Vancouver Curiosity and Education Society makes meaningful lifelong learning accessible after people leave school or university.",
    "free, facilitated, in-person discussions and learning events",
    "At a time when much of social life takes place through screens",
    "Our purpose is to strengthen curiosity, critical thinking, mutual understanding and meaningful community connection.",
    "Explore our work",
    "Four ways into community life.",
    "Upcoming public programs.",
    "Shared curiosity makes connection easier to begin.",
    "Discuss a partnership",
    "Explore upcoming events",
  ]) {
    assert.ok(homePositioning.includes(copy), copy);
  }
  const homepageSections = [
    "hero",
    "at-a-glance",
    "programs",
    "work-in-action",
    "why-it-matters",
    "partnerships",
    "communities",
    "public-invitation",
  ];
  assert.equal((homeRenderer.match(/<section\b/gu) ?? []).length, 8);
  let priorSectionIndex = -1;
  for (const sectionName of homepageSections) {
    const sectionIndex = homeRenderer.indexOf(
      `data-home-section="${sectionName}"`,
    );
    assert.ok(sectionIndex > priorSectionIndex, sectionName);
    priorSectionIndex = sectionIndex;
  }
  assert.match(
    homeRenderer,
    /href="\/contact\?topic=partnerships#contact-form"/u,
  );
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

test("Events renders explicit Upcoming and Calendar views while /calendar forwards", async () => {
  const [calendar, events, renderer, maintenance, worker] = await Promise.all([
    readFile(new URL("app/calendar/route.ts", projectRoot), "utf8"),
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

  assert.match(calendar, /new URL\(request\.url\)/u);
  assert.match(
    calendar,
    /new URL\(\s*["']\/events["'],\s*await getPublicRequestOrigin\(source\),?\s*\)/u,
  );
  assert.match(calendar, /source\.searchParams\.getAll\(["']month["']\)/u);
  assert.match(
    calendar,
    /destination\.searchParams\.set\(["']month["'], month\)/u,
  );
  assert.match(
    calendar,
    /destination\.searchParams\.set\(["']view["'], ["']calendar["']\)/u,
  );
  assert.match(calendar, /Response\.redirect\(destination, 308\)/u);
  assert.doesNotMatch(calendar, /<PublicMonthCalendar|calendar-view-switcher/u);
  assert.doesNotMatch(
    calendar,
    /home-hero|home-newcomer|Come curious\. Leave knowing people\.|calendar-home-introduction/u,
  );

  assert.match(events, /EventsPageRenderer/u);
  assert.doesNotMatch(events, /eventListValues\(raw\)/u);
  assert.match(events, /loadPublicEventsPageData/u);
  assert.doesNotMatch(
    events,
    /\bqueryPublicEventSlice\b|\bloadPublicMonthCalendar\b/u,
  );
  assert.doesNotMatch(events, /values\.state|values\.page/u);
  assert.doesNotMatch(events, /from "\.\.\/calendar\/page"/u);
  assert.match(`${events}\n${renderer}`, /PublicMonthCalendar/u);
  assert.match(renderer, /aria-label="Event views"[\s\S]*Upcoming[\s\S]*Calendar/u);
  assert.doesNotMatch(renderer, /Event timeframe|>\s*Past\s*</u);
  assert.doesNotMatch(renderer, /<EventFilters\b/u);
  assert.doesNotMatch(
    renderer,
    /public-export-actions|Download this public view|exportHref\(/u,
  );
  assert.doesNotMatch(renderer, /calendar-view-switcher/u);
  assert.match(renderer, /<PublicMonthCalendar/u);
  assert.match(
    renderer,
    /<EventCard[\s\S]{0,160}?\bcompact[\s\S]{0,80}?event=\{event\}/u,
  );
  assert.doesNotMatch(renderer, /EditorialSection|editorial-sections/u);
  assert.doesNotMatch(calendar, /Download upcoming events/u);
  assert.doesNotMatch(
    `${calendar}\n${events}\n${renderer}`,
    /readPublicMeetupSyncState|CalendarSourceStatus|SourceStatus|data-source-status|latest Meetup check|Meetup refresh|last complete calendar|Last completed snapshot|not on a guaranteed schedule/u,
  );
  assert.doesNotMatch(events, /refreshMeetupCalendarSourceIfDue/u);
  assert.doesNotMatch(
    maintenance,
    /refreshMeetupCalendarSourceIfDue|schedulePublicMeetupRefresh/u,
  );
  assert.match(
    worker,
    /await ensureDatabaseInvariantsForRequest\(env\.DB,[\s\S]*?const response = await handler\.fetch\([\s\S]*?\(request\.method === "GET" \|\| request\.method === "HEAD"\)[\s\S]*?!isPrivateOrIdentityPath\(requestPathname\)[\s\S]*?schedulePublicRequestMaintenance\(ctx, env\.DB/u,
  );
  const publicSchedulerStart = worker.indexOf(
    "function schedulePublicRequestMaintenance(",
  );
  const publicSchedulerEnd = worker.indexOf(
    "function contentSecurityPolicy(",
    publicSchedulerStart,
  );
  assert.ok(publicSchedulerStart >= 0);
  assert.ok(publicSchedulerEnd > publicSchedulerStart);
  const publicScheduler = worker.slice(
    publicSchedulerStart,
    publicSchedulerEnd,
  );
  assert.match(publicScheduler, /runRequestMaintenance\(database, request\)/u);
  assert.match(
    publicScheduler,
    /nowUtcMs < publicRequestMaintenanceNextEligibleAtUtcMs/u,
  );
  assert.match(publicScheduler, /context\.waitUntil\(maintenance\)/u);
  assert.doesNotMatch(
    publicScheduler,
    /maintenanceRedirect|maintenanceUnavailableResponse|secureResponse/u,
    "visitor maintenance must stay background-only and never return 303 or 503",
  );
  assert.doesNotMatch(
    worker,
    /schedulePublicMeetupRefresh|public_meetup_refresh_/u,
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
  assert.match(joined, /getRequestPublicClubBySlug/u);
  assert.match(joined, /getRequestPublicClubEventViewMaterialization/u);
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
