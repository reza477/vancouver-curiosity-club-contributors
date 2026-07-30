import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseJsonBody,
  readBoundedUtf8Body,
  requireSameOriginMutation,
} from "../app/api/organizer/meetup/_mutation.ts";

const projectRoot = new URL("../", import.meta.url);

test("homepage puts the bounded public calendar path before secondary content", async () => {
  const [page, homeData, renderer, catalog, styles] = await Promise.all([
    readFile(new URL("app/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("lib/server/public/home.ts", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("app/_components/HomePageRenderer.tsx", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("lib/server/public/catalog-definitions.ts", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
  ]);

  assert.match(page, /loadPublicHomeData/);
  assert.match(
    page,
    /loadPublicHomeData\(database,\s*\{\s*nowUtcMs,\s*organizationId:\s*organization\.id/,
  );
  assert.match(homeData, /const catalog = await loadPublicCatalog\(database\)/);
  assert.match(
    homeData,
    /Promise\.all\(\[\s*getPublicPageContent\(database,\s*"home"\),\s*queryPublicEvents/,
  );
  assert.match(homeData, /pageSize:\s*6/);
  assert.match(renderer, /href="\/calendar"/);
  assert.match(renderer, /View the calendar/);
  assert.match(renderer, /events\.slice\(0,\s*4\)/);
  assert.ok(
    renderer.indexOf('className="home-events"') <
      renderer.indexOf('className="lane-index"'),
  );
  assert.match(renderer, /No upcoming event is published here yet\./);
  assert.match(renderer, /As soon as an event is ready for everyone to see/u);
  assert.match(styles, /\.home-hero\s*\{[\s\S]*?min-height:\s*min\(30rem/u);
  assert.match(
    styles,
    /@media \(max-width:\s*52rem\)[\s\S]*?\.home-hero > \.field-artwork\s*\{[\s\S]*?display:\s*none/u,
  );
  assert.match(catalog, /A social calendar with a brain\./);
  assert.doesNotMatch(
    `${page}\n${renderer}`,
    /sampleEvents|fictional examples/i,
  );
});

test("Events renders honest source states through the safe unified projection", async () => {
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
  assert.doesNotMatch(page, /refreshMeetupCalendarSourceIfDue/);
  assert.match(maintenance, /refreshMeetupCalendarSourceIfDue/);
  assert.match(maintenance, /attemptedMeetupRefresh/);
  assert.match(worker, /maintenanceRedirect/);
  assert.match(renderer, /The last completed snapshot remains visible/);
  assert.match(renderer, /not on a guaranteed schedule/);
  assert.match(page, /queryPublicEvents/);
  assert.match(page, /readPublicMeetupSyncState/);
  assert.match(filters, /method="get"/);
  assert.match(filters, /Clear Filters/);
  assert.match(calendar, /PublicMonthCalendar/);
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

test("manual Meetup APIs derive authority server-side and restrict both mutations", async () => {
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

test("narrow navigation preserves every primary destination and organizer login", async () => {
  const [header, css] = await Promise.all([
    readFile(
      new URL("app/_components/SiteHeader.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
  ]);

  for (const destination of [
    "/calendar",
    "/events",
    "/clubs",
    "/community",
    "/about",
    "/get-involved",
    "/organizer",
  ]) {
    assert.match(
      header,
      new RegExp(`href:\\s*"${destination}"|href="${destination}"`),
    );
  }
  assert.match(header, /className="site-navigation"/);
  assert.match(header, /<summary>/);
  assert.match(header, /onKeyDown=\{closeMobileMenuWithEscape\}/);
  assert.match(header, /mobileMenu\.current\.open = false/);
  assert.match(header, /querySelector\("summary"\)\?\.focus\(\)/);
  assert.match(header, /onClick=\{onNavigate\}/);
  assert.match(
    header,
    /\.slice\(0, 1\)/u,
  );
  assert.match(css, /@media \(max-width: 70rem\)/u);
  assert.match(css, /\.site-navigation > \.primary-nav\s*\{/);
  assert.match(
    css,
    /\.site-navigation > \.primary-nav \.portal-link\s*\{[\s\S]*?grid-column:\s*1 \/ -1/,
  );
  assert.doesNotMatch(
    css,
    /\.portal-link\s*\{[^}]*display:\s*none/u,
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
