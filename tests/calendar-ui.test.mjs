import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseJsonBody,
  readBoundedUtf8Body,
  requireSameOriginMutation,
} from "../app/api/organizer/meetup/_mutation.ts";

const projectRoot = new URL("../", import.meta.url);

test("homepage is the bounded month calendar before every secondary section", async () => {
  const [page, calendar, month, header, catalog, homeRenderer, styles] =
    await Promise.all([
      readFile(new URL("app/page.tsx", projectRoot), "utf8"),
      readFile(new URL("app/calendar/page.tsx", projectRoot), "utf8"),
      readFile(
        new URL("app/_components/PublicMonthCalendar.tsx", projectRoot),
        "utf8",
      ),
      readFile(
        new URL("app/_components/SiteHeader.tsx", projectRoot),
        "utf8",
      ),
      readFile(
        new URL("lib/server/public/catalog-definitions.ts", projectRoot),
        "utf8",
      ),
      readFile(
        new URL("app/_components/HomePageRenderer.tsx", projectRoot),
        "utf8",
      ),
      readFile(new URL("app/globals.css", projectRoot), "utf8"),
    ]);

  assert.match(
    page,
    /import CalendarPage from "@\/app\/calendar\/page"/u,
  );
  assert.match(page, /CalendarPage\(\{ searchParams \}\)/u);
  assert.match(page, /path:\s*"\/"/u);
  assert.match(page, /slug:\s*"home"/u);
  assert.match(page, /<StructuredData/u);
  assert.doesNotMatch(page, /loadCommunityDestinations|sameAs/u);
  assert.match(calendar, /<PublicMonthCalendar/u);
  assert.doesNotMatch(calendar, /<h1>Calendar<\/h1>/u);
  assert.doesNotMatch(calendar, /className="public-calendar-intro"/u);
  assert.match(month, /<h1 id="public-calendar-title">/u);
  assert.match(calendar, /Curiosity is better in company\./u);
  assert.ok(
    calendar.indexOf("<PublicMonthCalendar") <
      calendar.indexOf('className="calendar-view-switcher"'),
  );
  assert.ok(
    calendar.indexOf('className="calendar-view-switcher"') <
      calendar.indexOf('className="calendar-home-introduction"'),
  );
  assert.match(
    header,
    /href === "\/calendar"[\s\S]*?pathname === "\/"[\s\S]*?pathname === "\/events"[\s\S]*?pathname\.startsWith\("\/events\/"\)/u,
  );
  assert.match(styles, /\.calendar-home-introduction\s*\{/u);
  assert.match(
    styles,
    /@media \(max-width:\s*52rem\)[\s\S]*?\.calendar-home-introduction,[\s\S]*?grid-template-columns:\s*1fr/u,
  );
  assert.match(catalog, /A social calendar with a brain\./);
  assert.doesNotMatch(
    catalog,
    /section\("(?:attending|invitation|community)"/u,
  );
  assert.match(
    homeRenderer,
    /REMOVED_HOME_SECTION_KEYS = new Set\(\[\s*"attending",\s*"invitation",\s*"community",\s*\]\)/u,
  );
  assert.doesNotMatch(
    homeRenderer,
    /What attending feels like|Make the calendar with us|Follow the club elsewhere|Find the community/u,
  );
  assert.doesNotMatch(
    `${page}\n${calendar}`,
    /sampleEvents|fictional examples/i,
  );
});

test("event titles use a clean color change instead of a hover underline", async () => {
  const styles = await readFile(
    new URL("app/globals.css", projectRoot),
    "utf8",
  );

  assert.match(
    styles,
    /\.event-card h3 a:hover,\s*\.event-card h3 a:focus-visible\s*\{[^}]*color:\s*var\(--forest\);[^}]*text-decoration:\s*none;/su,
  );
  assert.doesNotMatch(
    styles,
    /\.event-card h3 a:hover\s*\{[^}]*text-decoration:\s*underline;/su,
  );
  assert.match(
    styles,
    /\.public-calendar-event__copy h4 a:hover,[\s\S]*?text-decoration:\s*none;/u,
  );
});

test("About explains the club inside the existing editorial main", async () => {
  const [about, editorialPage, catalog, styles] = await Promise.all([
    readFile(new URL("app/about/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/_components/EditorialPage.tsx", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("lib/server/public/catalog-definitions.ts", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
  ]);

  assert.match(about, /<EditorialPage[\s\S]*?<section className="about-club"/u);
  assert.doesNotMatch(about, /<main/u);
  assert.match(editorialPage, /<main className="editorial-page">[\s\S]*?\{children\}/u);
  for (const phrase of [
    "Curiosity is better in company.",
    "You do not need to arrive as an expert.",
    "Think",
    "Reset &amp; Make",
    "Explore",
    "Eat &amp; Play",
    "Public visitors do not need an account.",
  ]) {
    assert.ok(about.includes(phrase), phrase);
  }
  assert.match(catalog, /heading:\s*"Curiosity is better in company\."/u);
  assert.match(styles, /\.about-club__lane-grid\s*\{/u);
});

test("Events uses the same calendar-first experience instead of the legacy search form", async () => {
  const [page, renderer, calendar, filters, projection, worker, maintenance] =
    await Promise.all([
    readFile(new URL("app/events/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/_components/EventsPageRenderer.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/calendar/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/_components/EventFilters.tsx", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("lib/server/public/events.ts", projectRoot),
      "utf8",
    ),
    readFile(new URL("worker/index.ts", projectRoot), "utf8"),
    readFile(
      new URL(
        "lib/server/database/request-maintenance.ts",
        projectRoot,
      ),
      "utf8",
    ),
  ]);

  for (const status of [
    "not_connected",
    "pending",
    "partial",
    "current",
    "stale",
    "disabled",
    "error",
  ]) {
    assert.match(renderer, new RegExp(`${status}:`));
  }
  assert.match(
    page,
    /export \{ default, dynamic, generateMetadata \} from "\.\.\/calendar\/page"/u,
  );
  assert.doesNotMatch(page, /EventsPageRenderer|EventFilters|queryPublicEvents/u);
  assert.doesNotMatch(page, /refreshMeetupCalendarSourceIfDue/);
  assert.match(maintenance, /refreshMeetupCalendarSourceIfDue/);
  assert.match(maintenance, /attemptedMeetupRefresh/);
  assert.match(worker, /maintenanceRedirect/);
  assert.match(renderer, /The last completed snapshot remains visible/);
  assert.match(renderer, /not on a guaranteed schedule/);
  assert.match(calendar, /queryPublicEvents/);
  assert.match(calendar, /readPublicMeetupSyncState/);
  assert.match(filters, /method="get"/);
  assert.match(filters, /Clear Filters/);
  assert.match(calendar, /PublicMonthCalendar/);
  assert.doesNotMatch(calendar, />List and filters</u);
  assert.match(calendar, /path:\s*"\/calendar"/);
  assert.match(calendar, /queryPublicEvents/);
  assert.doesNotMatch(calendar, /permanentRedirect/);
  assert.match(projection, /UNIFIED_PUBLIC_EVENT_CTE_SQL/);
  assert.match(projection, /generation\.state = 'published'/);
  assert.match(
    projection,
    /generation\.processed_item_count = generation\.expected_item_count/,
  );
  assert.match(
    projection,
    /snapshot\.title AS title[\s\S]*snapshot\.status AS event_status/,
  );
  assert.doesNotMatch(
    projection,
    /SELECT[\s\S]{0,240}source\.source_url AS/u,
  );
  assert.doesNotThrow(() =>
    new Intl.DateTimeFormat("en-CA", {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      timeZone: "America/Vancouver",
      timeZoneName: "short",
      year: "numeric",
    }).format(new Date("2026-07-24T01:00:00.000Z")),
  );
});

test("organizer connection UI is noindex, server-authorized, and read-only for Organizer", async () => {
  const [portal, layout, shell, page, controls, model] = await Promise.all([
    readFile(new URL("app/organizer/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/organizer/layout.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/_organizer/WorkspaceShell.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/organizer/meetup/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/organizer/meetup/MeetupControls.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/organizer/meetup/model.ts", projectRoot), "utf8"),
  ]);

  assert.match(shell, /href:\s*"\/organizer\/meetup"/);
  assert.match(shell, /Meetup connection/);
  assert.match(
    portal,
    /holds, confirmed schedules, conflicts[\s\S]*Eligible confirmed events include website publication controls[\s\S]*Website content and Media are available from More/u,
  );
  assert.doesNotMatch(portal, /Website publication remains unavailable/u);
  assert.doesNotMatch(portal, /private Phase 1 surface/i);
  assert.match(page, /loadOrganizerPageContext\("\/organizer\/meetup"\)/);
  assert.match(layout, /loadOrganizerPageContext\(returnTo\)/);
  assert.match(layout, /index:\s*false/);
  assert.match(layout, /follow:\s*false/);
  assert.match(
    page,
    /loaded\.context\.membership\.role === "owner"[\s\S]*loaded\.context\.membership\.role === "administrator"/,
  );
  assert.match(
    page,
    /ensureMeetupProgramClubs\([\s\S]*loaded\.context\.database,[\s\S]*loaded\.context\.identity/,
  );
  assert.match(page, /clubOptions=\{data\.clubs\}/);
  assert.doesNotMatch(page, /sourceUrl|source_url|feedUrl/);
  assert.match(controls, /canConfigure\s*\?\s*\(/);
  assert.match(controls, /Organizer access is read-only/);
  assert.match(controls, /only an Owner or Administrator can refresh/);
  assert.match(
    controls,
    /Saved source[\s\S]*addresses are never shown back/,
  );
  assert.match(controls, /does not claim that a[\s\S]*refresh or import succeeded/);
  assert.match(
    controls,
    /<label htmlFor="meetup-program-club">[\s\S]*Program[\s\S]*<\/label>/,
  );
  assert.match(
    controls,
    /<select[\s\S]*id="meetup-program-club"[\s\S]*name="clubId"[\s\S]*aria-describedby="meetup-program-help"[\s\S]*required/,
  );
  assert.match(
    controls,
    /clubOptions\.map\(\(club\) => \([\s\S]*value=\{club\.id\}[\s\S]*\{club\.name\}/,
  );
  assert.match(
    controls,
    /body:\s*JSON\.stringify\(\{\s*clubId,\s*feedUrl\s*\}\)/,
  );
  assert.match(
    controls,
    /clubId\.length === 0[\s\S]*feedUrl\.length === 0/,
  );
  assert.doesNotMatch(controls, /primary Meetup feed/u);
  assert.doesNotMatch(
    model,
    /^\s*(feedUrl|lastErrorCode|organizationId)\s*:/mu,
  );
  assert.match(
    model,
    /scheduleConflict:\s*state\.lastErrorCode === "conflict_rejected"/u,
  );
  assert.match(model, /Explicitly strips organization identifiers/);
});

test("manual Meetup APIs derive authority server-side and restrict every mutation", async () => {
  const [shared, connect, refresh, model, worker, requestPathname] =
    await Promise.all([
    readFile(
      new URL("app/api/organizer/meetup/_shared.ts", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("app/api/organizer/meetup/connect/route.ts", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("app/api/organizer/meetup/refresh/route.ts", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/organizer/meetup/model.ts", projectRoot), "utf8"),
    readFile(new URL("worker/index.ts", projectRoot), "utf8"),
    readFile(new URL("lib/request-pathname.ts", projectRoot), "utf8"),
  ]);

  assert.match(shared, /getChatGPTUser\(\)/);
  assert.match(shared, /trustedIdentityFromSites\(user\)/);
  assert.match(shared, /authorizeOrganizerAccess\(database, identity/);

  for (const route of [connect, refresh]) {
    assert.match(route, /requireSameOriginMutation\(request\)/);
    assert.match(route, /readBoundedUtf8Body\(request,/);
    assert.match(route, /privateJsonHeaders\(\)/);
    assert.match(route, /safeErrorResponse/);
    assert.match(route, /"owner"/);
    assert.match(route, /"administrator"/);
    assert.doesNotMatch(route, /"organizer"/);
    assert.doesNotMatch(route, /organizationId|actorId|membershipRole/);
  }

  assert.match(
    connect,
    /assertOnlyKeys\(payload,\s*\["clubId", "feedUrl"\]\)/,
  );
  assert.match(
    connect,
    /parseIdentifier\(payload\.clubId,\s*"clubId"\)/,
  );
  assert.match(connect, /ensureMeetupProgramClubs\(database, identity\)/);
  assert.match(
    connect,
    /configureMeetupCalendarSource\(database, identity,\s*\{\s*clubId,\s*feedUrl,\s*\}\)/,
  );
  assert.doesNotMatch(connect, /sourceUrl|source_url/);
  assert.doesNotMatch(
    model,
    /^\s*(feedUrl|lastErrorCode|organizationId)\s*:/mu,
  );
  assert.doesNotMatch(model, /state\.(feedUrl|organizationId)/u);
  assert.match(
    model,
    /scheduleConflict:\s*state\.lastErrorCode === "conflict_rejected"/u,
  );
  assert.match(worker, /isPrivateOrIdentityPath\(requestPathname\)/);
  assert.match(requestPathname, /"\/organizer"/);
  assert.match(requestPathname, /"\/api"/);
  assert.match(
    requestPathname,
    /pathname\.startsWith\(`\$\{path\}\/`\)/,
  );
});

test("same-origin mutation guard rejects missing, malformed, and cross-site origins", () => {
  const accepted = new Request("https://club.example/api/organizer/meetup", {
    method: "POST",
    headers: { Origin: "https://club.example" },
  });
  assert.doesNotThrow(() => requireSameOriginMutation(accepted));

  for (const request of [
    new Request("https://club.example/api/organizer/meetup", {
      method: "POST",
    }),
    new Request("https://club.example/api/organizer/meetup", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    }),
    new Request("https://club.example/api/organizer/meetup", {
      method: "POST",
      headers: { Origin: "not an origin" },
    }),
    new Request("https://club.example/api/organizer/meetup", {
      method: "POST",
      headers: { Origin: "https://club.example/path" },
    }),
  ]) {
    assert.throws(
      () => requireSameOriginMutation(request),
      (error) =>
        error?.code === "validation_failed" &&
        error?.publicMessage === "The request could not be validated.",
    );
  }
});

test("bounded body reader enforces streamed bytes without trusting Content-Length", async () => {
  const exampleFeedUrl = new URL(
    ["events", "ical", ""].join("/"),
    "https://www.meetup.com/example/",
  ).href;
  const valid = new Request("https://club.example/api/organizer/meetup", {
    method: "POST",
    body: JSON.stringify({ feedUrl: exampleFeedUrl }),
  });
  const validBody = await readBoundedUtf8Body(valid, 256);
  assert.equal(parseJsonBody(validBody).feedUrl.includes("meetup.com"), true);

  const oversizedWithoutLength = new Request(
    "https://club.example/api/organizer/meetup",
    {
      method: "POST",
      body: "x".repeat(65),
    },
  );
  await assert.rejects(
    readBoundedUtf8Body(oversizedWithoutLength, 64),
    (error) => error?.code === "validation_failed",
  );

  const dishonestLength = new Request(
    "https://club.example/api/organizer/meetup",
    {
      method: "POST",
      headers: { "Content-Length": "1" },
      body: "x".repeat(65),
    },
  );
  await assert.rejects(
    readBoundedUtf8Body(dishonestLength, 64),
    (error) => error?.code === "validation_failed",
  );

  const declaredOversize = new Request(
    "https://club.example/api/organizer/meetup",
    {
      method: "POST",
      headers: { "Content-Length": "999" },
      body: "{}",
    },
  );
  await assert.rejects(
    readBoundedUtf8Body(declaredOversize, 64),
    (error) => error?.code === "validation_failed",
  );
});

test("wordmark uses the local brand icon and remains visible on narrow screens", async () => {
  const [header, css] = await Promise.all([
    readFile(
      new URL("app/_components/SiteHeader.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
  ]);

  assert.match(
    header,
    /<span className="wordmark-mark" aria-hidden="true" \/>/,
  );
  assert.match(css, /\.wordmark-mark\s*\{[\s\S]*url\("\/icon\.png"\)/);
  assert.match(
    css,
    /@media \(max-width: 38rem\)[\s\S]*\.wordmark-mark\s*\{[\s\S]*display:\s*block/,
  );
});

test("the three public destinations stay visible and Community is absent from shared navigation", async () => {
  const [header, footer, css] = await Promise.all([
    readFile(
      new URL("app/_components/SiteHeader.tsx", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("app/_components/SiteFooter.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
  ]);

  for (const [href, label] of [
    ["/calendar", "Calendar"],
    ["/about", "About"],
    ["/get-involved", "Contribute"],
  ]) {
    assert.match(
      header,
      new RegExp(`\\{ href: "${href}", label: "${label}" \\}`, "u"),
    );
  }
  assert.doesNotMatch(header, /\{ href: "\/community", label: "Community" \}/u);
  assert.doesNotMatch(footer, /\{ href: "\/community", label: "Community" \}/u);
  assert.match(footer, /item\.href === "\/community"/u);
  assert.doesNotMatch(header, /\{ href: "\/events", label: "Events" \}/u);
  assert.doesNotMatch(
    header,
    /\{ href: "\/organizer", label: "Organizer Login" \}/u,
  );
  assert.match(footer, /<Link href="\/organizer" prefetch=\{false\}>/u);
  assert.match(footer, /Organizer Login/u);
  assert.match(header, /className="primary-nav"/u);
  assert.match(header, /className="primary-nav__link"/u);
  assert.doesNotMatch(header, /<details|<summary|site-navigation/u);
  assert.match(header, /return Object\.freeze\(requiredNavigation\)/u);
  assert.match(
    css,
    /\.primary-nav\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/su,
  );
  assert.match(
    css,
    /\.primary-nav a\s*\{[^}]*min-height:\s*3rem;/su,
  );
  assert.match(css, /@media \(max-width: 70rem\)/u);
  assert.match(
    css,
    /@media \(max-width: 70rem\)[\s\S]*?\.primary-nav\s*\{[^}]*width:\s*100%;/u,
  );
});

test("small metadata labels keep a readable 0.75rem floor", async () => {
  const css = await readFile(
    new URL("app/globals.css", projectRoot),
    "utf8",
  );
  const subFloorRemSizes = [...css.matchAll(/font-size:\s*0\.(\d+)rem/g)]
    .map((match) => Number(`0.${match[1]}`))
    .filter((size) => size < 0.75);

  assert.deepEqual(subFloorRemSizes, []);
});
