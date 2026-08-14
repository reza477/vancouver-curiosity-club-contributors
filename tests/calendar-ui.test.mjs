import { readPublicCss } from "./helpers/public-css.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseJsonBody,
  readBoundedUtf8Body,
  requireSameOriginMutation,
} from "../app/api/organizer/meetup/_mutation.ts";
import {
  MAX_AUTOMATIC_MEETUP_REFRESH_REQUESTS,
  runMeetupRefreshAndMaterialize,
  runMeetupRefreshSelection,
} from "../app/organizer/meetup/MeetupControls.tsx";

const projectRoot = new URL("../", import.meta.url);

function getMaxWidthMediaBlocks(styles) {
  const blocks = [];
  const mediaStart = /@media\s*\(max-width:\s*([\d.]+)rem\)\s*\{/gu;

  for (const match of styles.matchAll(mediaStart)) {
    let depth = 1;
    let cursor = match.index + match[0].length;

    while (cursor < styles.length && depth > 0) {
      if (styles[cursor] === "{") depth += 1;
      if (styles[cursor] === "}") depth -= 1;
      cursor += 1;
    }

    blocks.push({
      body: styles.slice(match.index + match[0].length, cursor - 1),
      maxWidthRem: Number(match[1]),
    });
  }

  return blocks;
}

test("Meetup refresh selection runs canonical clubs first, finishes partial clubs, aggregates counts, and stops at a hard limit", async () => {
  const calls = [];
  const remainingOutcomes = new Map([
    ["club_a", ["partial", "partial", "completed"]],
    ["club_b", ["not_modified"]],
    ["club_c", ["completed"]],
  ]);
  const clubs = Object.freeze([
    Object.freeze({ id: "club_a", name: "Vancouver Curiosity Club" }),
    Object.freeze({ id: "club_b", name: "Vancouver Literature and Film" }),
    Object.freeze({ id: "club_c", name: "Vancouver Fantasy & Sci-Fi Group" }),
    Object.freeze({ id: "club_a", name: "Vancouver Curiosity Club" }),
  ]);
  const state = Object.freeze({
    enabled: true,
    lastAttemptAt: "2026-08-06T12:00:00.000Z",
    lastSuccessAt: "2026-08-06T12:00:00.000Z",
    nextRefreshAt: "2026-08-06T12:15:00.000Z",
    scheduleConflict: false,
    status: "current",
  });
  const run = await runMeetupRefreshSelection(
    clubs,
    async (clubId) => {
      calls.push(clubId);
      const outcome = remainingOutcomes.get(clubId)?.shift();
      assert.ok(outcome);
      return {
        counts: {
          cancelled: 0,
          created: outcome === "partial" ? 2 : 0,
          rejected: 0,
          removed: 0,
          updated: outcome === "completed" ? 1 : 0,
        },
        outcome,
        state,
      };
    },
  );
  assert.deepEqual(
    calls,
    ["club_b", "club_c", "club_a", "club_a", "club_a"],
  );
  assert.deepEqual(
    clubs.map((club) => club.id),
    ["club_a", "club_b", "club_c", "club_a"],
    "the external catalog order remains unchanged",
  );
  assert.deepEqual(run.counts, {
    cancelled: 0,
    created: 4,
    rejected: 0,
    removed: 0,
    updated: 2,
  });
  assert.equal(run.requestCount, 5);
  assert.equal(run.stoppedAtLimit, false);
  assert.equal(run.error, null);

  let limitedCalls = 0;
  const limited = await runMeetupRefreshSelection(
    [{ id: "club_a", name: "Vancouver Curiosity Club" }],
    async () => {
      limitedCalls += 1;
      return {
        counts: {
          cancelled: 0,
          created: 1,
          rejected: 0,
          removed: 0,
          updated: 0,
        },
        outcome: "partial",
        state: { ...state, status: "partial" },
      };
    },
  );
  assert.equal(limitedCalls, MAX_AUTOMATIC_MEETUP_REFRESH_REQUESTS);
  assert.equal(limited.requestCount, MAX_AUTOMATIC_MEETUP_REFRESH_REQUESTS);
  assert.equal(limited.counts.created, MAX_AUTOMATIC_MEETUP_REFRESH_REQUESTS);
  assert.equal(limited.stoppedAtLimit, true);
});

test("manual Meetup refresh rebuilds public materializations only after every selected club finishes", async (t) => {
  const state = Object.freeze({
    enabled: true,
    lastAttemptAt: "2026-08-06T12:00:00.000Z",
    lastSuccessAt: "2026-08-06T12:00:00.000Z",
    nextRefreshAt: "2026-08-06T12:15:00.000Z",
    scheduleConflict: false,
    status: "current",
  });
  const counts = Object.freeze({
    cancelled: 0,
    created: 1,
    rejected: 0,
    removed: 0,
    updated: 0,
  });

  await t.test("all programs reach terminal completion first", async () => {
    const order = [];
    const outcomes = new Map([
      ["club_a", ["partial", "completed"]],
      ["club_b", ["not_modified"]],
    ]);
    const run = await runMeetupRefreshAndMaterialize(
      [
        { id: "club_a", name: "Vancouver Curiosity Club" },
        { id: "club_b", name: "Vancouver Literature and Film" },
      ],
      async (clubId) => {
        const outcome = outcomes.get(clubId)?.shift();
        assert.ok(outcome);
        order.push(`refresh:${clubId}:${outcome}`);
        return { counts, outcome, state };
      },
      async () => {
        order.push("materialize");
        return Object.freeze({
          eventsSnapshotCount: 1,
          homeEventCount: 6,
        });
      },
    );

    assert.deepEqual(order, [
      "refresh:club_b:not_modified",
      "refresh:club_a:partial",
      "refresh:club_a:completed",
      "materialize",
    ]);
    assert.deepEqual(run.materialization, {
      eventsSnapshotCount: 1,
      homeEventCount: 6,
    });
    assert.equal(run.materializationError, null);
  });

  for (const outcome of [
    "busy",
    "disabled",
    "failed",
    "not_connected",
    "not_due",
  ]) {
    await t.test(`${outcome} never replaces the public snapshots`, async () => {
      let materializationCalls = 0;
      const run = await runMeetupRefreshAndMaterialize(
        [{ id: "club_a", name: "Vancouver Curiosity Club" }],
        async () => ({ counts, outcome, state }),
        async () => {
          materializationCalls += 1;
          return { eventsSnapshotCount: 1, homeEventCount: 6 };
        },
      );

      assert.equal(materializationCalls, 0);
      assert.equal(run.materialization, null);
      assert.equal(run.materializationError, null);
    });
  }

  await t.test("the bounded safety limit never publishes a partial run", async () => {
    let refreshCalls = 0;
    let materializationCalls = 0;
    const run = await runMeetupRefreshAndMaterialize(
      [{ id: "club_a", name: "Vancouver Curiosity Club" }],
      async () => {
        refreshCalls += 1;
        return {
          counts,
          outcome: "partial",
          state: { ...state, status: "partial" },
        };
      },
      async () => {
        materializationCalls += 1;
        return { eventsSnapshotCount: 1, homeEventCount: 6 };
      },
    );

    assert.equal(refreshCalls, MAX_AUTOMATIC_MEETUP_REFRESH_REQUESTS);
    assert.equal(run.stoppedAtLimit, true);
    assert.equal(materializationCalls, 0);
  });

  await t.test("a public rebuild failure stays distinct from source success", async () => {
    const materializationFailure = new Error("private failure detail");
    const run = await runMeetupRefreshAndMaterialize(
      [{ id: "club_a", name: "Vancouver Curiosity Club" }],
      async () => ({ counts, outcome: "not_modified", state }),
      async () => {
        throw materializationFailure;
      },
    );

    assert.equal(run.error, null);
    assert.equal(run.materialization, null);
    assert.equal(run.materializationError, materializationFailure);
  });
});

test("Meetup snapshot identity includes versioned aliases, editorial policy, and public content", async () => {
  const [sync, aliases, editorialPolicy] = await Promise.all([
    readFile(new URL("lib/server/meetup/sync.ts", projectRoot), "utf8"),
    readFile(
      new URL("lib/server/meetup/event-aliases.ts", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("lib/meetup-publication-policy.js", projectRoot),
      "utf8",
    ),
  ]);
  assert.match(sync, /MEETUP_IMPORT_POLICY_VERSION\s*=\s*"[^"]+"/u);
  assert.match(
    sync,
    /importPolicy:\s*\{[\s\S]*aliasPolicyVersion:\s*MEETUP_EVENT_ALIAS_POLICY_VERSION[\s\S]*aliases:\s*MEETUP_EVENT_ALIASES[\s\S]*editorialOverridePolicyVersion:\s*MEETUP_EDITORIAL_OVERRIDE_POLICY_VERSION[\s\S]*version:\s*MEETUP_IMPORT_POLICY_VERSION/u,
  );
  assert.match(sync, /publicContent:\s*item\.event\.publicContent/u);
  assert.match(
    aliases,
    /MEETUP_EVENT_ALIAS_POLICY_VERSION\s*=\s*"[^"]+"/u,
  );
  assert.match(
    editorialPolicy,
    /MEETUP_EDITORIAL_OVERRIDE_POLICY_VERSION\s*=\s*\n?\s*"[^"]+"/u,
  );
  assert.match(editorialPolicy, /315823022/u);
  assert.match(editorialPolicy, /315823081/u);
});

test("homepage leads with the club purpose and eight distinct sections", async () => {
  const [page, calendar, month, homeRenderer, homeData] =
    await Promise.all([
      readFile(new URL("app/page.tsx", projectRoot), "utf8"),
      readFile(new URL("app/calendar/route.ts", projectRoot), "utf8"),
      readFile(
        new URL("app/_components/PublicMonthCalendar.tsx", projectRoot),
        "utf8",
      ),
      readFile(
        new URL("app/_components/HomePageRenderer.tsx", projectRoot),
        "utf8",
      ),
      readFile(new URL("lib/server/public/home.ts", projectRoot), "utf8"),
    ]);

  assert.match(page, /import \{ HomePageRenderer \}/u);
  assert.match(page, /loadPublicHomeData/u);
  assert.match(page, /<HomePageRenderer/u);
  assert.match(page, /path:\s*"\/"/u);
  assert.match(page, /slug:\s*"home"/u);
  assert.doesNotMatch(page, /CalendarPage|PublicMonthCalendar/u);

  for (const copy of [
    "Books, films, ideas, walks & creative nights in Vancouver",
    "Come curious. Leave knowing people.",
    "Vancouver Curiosity Club is for people who miss conversations that go somewhere. Pick a gathering that pulls you in, show up as you are, and meet thoughtful people through books, films, big questions, city walks, creative practice, food, and play.",
    "See upcoming gatherings",
    "New here? Start here",
  ]) {
    assert.ok(homeRenderer.includes(copy), copy);
  }

  const sectionClasses = [
    "home-hero",
    "home-events",
    "home-newcomer attending-note",
    "lane-index",
    "home-clubs",
    "home-mission home-community",
    "home-proof home-community",
    "home-closing home-invitation",
  ];
  assert.equal((homeRenderer.match(/<section\b/gu) ?? []).length, 8);
  let priorSectionIndex = -1;
  for (const className of sectionClasses) {
    const sectionIndex = homeRenderer.indexOf(`className="${className}"`);
    assert.ok(sectionIndex > priorSectionIndex, className);
    priorSectionIndex = sectionIndex;
  }
  assert.match(homeData, /readPublicHomeEventMaterialization/u);
  assert.match(homeData, /maximum: HOME_EVENT_SELECTION_RESERVE/u);
  assert.doesNotMatch(
    homeData,
    /queryPublicEventSlice|queryPublicEventMaterializationBundle|refreshPublicEventMaterializations/u,
    "ordinary Home requests must read the durable event materialization without projecting or refreshing it",
  );
  assert.doesNotMatch(
    `${page}\n${homeRenderer}`,
    /PublicMonthCalendar|public-calendar__grid|calendar-view-switcher/u,
  );

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
  assert.match(calendar, /Response\.redirect\(destination, 308\)/u);
  assert.doesNotMatch(calendar, /<PublicMonthCalendar|calendar-view-switcher/u);
  assert.match(month, /headingLevel = 1/u);
  assert.match(
    month,
    /const MonthHeading = headingLevel === 2 \? "h2" : "h1"/u,
  );
  assert.match(
    month,
    /<MonthHeading[\s\S]*?id="public-calendar-title"/u,
  );
  assert.doesNotMatch(
    calendar,
    /home-hero|home-newcomer|Come curious\. Leave knowing people\.|calendar-home-introduction/u,
  );
  assert.doesNotMatch(
    `${page}\n${calendar}`,
    /sampleEvents|fictional examples/i,
  );
});

test("event titles use a clean color change instead of a hover underline", async () => {
  const styles = await readPublicCss();

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

test("the public cultural identity is poster-led, lane-aware, and motion-safe", async () => {
  const [calendar, cards, masthead, about, contribute, styles] =
    await Promise.all([
      readFile(
        new URL("app/_components/PublicMonthCalendar.tsx", projectRoot),
        "utf8",
      ),
      readFile(
        new URL("app/_components/EventCard.tsx", projectRoot),
        "utf8",
      ),
      readFile(
        new URL("app/_components/PageMasthead.tsx", projectRoot),
        "utf8",
      ),
      readFile(new URL("app/about/page.tsx", projectRoot), "utf8"),
      readFile(
        new URL("app/_components/EditorialRouteBodies.tsx", projectRoot),
        "utf8",
      ),
      readPublicCss(),
    ]);

  assert.match(calendar, /data-event-lane=\{item\.lane\?\.slug\}/u);
  assert.match(calendar, /data-event-lane=\{event\.lane\?\.slug\}/u);
  assert.match(calendar, /className="public-calendar__mobile-agenda"/u);
  assert.match(calendar, /todayHasEvents/u);
  assert.match(cards, /data-event-lane=\{event\.lane\?\.slug\}/u);
  assert.match(cards, /event-artwork-fallback/u);
  assert.doesNotMatch(cards, /import .*FieldArtwork/u);
  assert.doesNotMatch(masthead, /FieldArtwork/u);
  assert.match(about, /className="about-closing"/u);
  assert.doesNotMatch(about, /className="about-(?:facts|events)"/u);
  for (const path of ["volunteer", "host", "partner"]) {
    assert.match(
      contribute,
      new RegExp(`data-contribution-path="${path}"`, "u"),
    );
  }
  assert.match(styles, /\.event-artwork-fallback\[data-event-lane="explore"\]/u);
  assert.match(styles, /@media \(prefers-reduced-motion: no-preference\)/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.event-card,[\s\S]*?transform:\s*none\s*!important;/u,
  );
  assert.match(styles, /\.public-calendar__mobile-agenda\s*\{\s*display:\s*none;/u);
});

test("the calendar switches to its named-event agenda at 768px", async () => {
  const styles = await readPublicCss();
  const rulesApplicableAt768 = getMaxWidthMediaBlocks(styles)
    .filter(({ maxWidthRem }) => maxWidthRem >= 48)
    .map(({ body }) => body)
    .join("\n");
  assert.match(
    rulesApplicableAt768,
    /\.public-calendar__layout\s*\{[^}]*grid-template-columns:\s*1fr;/u,
    "the calendar must collapse to one column at an exact 768px viewport",
  );
  assert.match(
    rulesApplicableAt768,
    /\.public-calendar__day-panel\s*\{[^}]*position:\s*static;/u,
    "the selected-day panel must stop being sticky at an exact 768px viewport",
  );
  assert.match(
    rulesApplicableAt768,
    /\.public-calendar__mobile-agenda\s*\{[^}]*display:\s*block;/u,
    "the named-event agenda must be visible at an exact 768px viewport",
  );
});

test("About is concise, reassuring, and quick to navigate", async () => {
  const [about, styles] = await Promise.all([
    readFile(new URL("app/about/page.tsx", projectRoot), "utf8"),
    readPublicCss(),
  ]);

  assert.match(about, /<main className="about-page"/u);
  assert.match(
    about,
    /className="about-hero"[\s\S]*?className="about-feel"[\s\S]*?className="about-audience"[\s\S]*?className="about-solo"[\s\S]*?className="about-closing"/u,
  );
  for (const phrase of [
    "Curiosity is better in company.",
    "What the community feels like",
    "Who it is for",
    "Your first event can be simple.",
    "Follow the question that catches you.",
    "See upcoming gatherings",
  ]) {
    assert.ok(about.includes(phrase), phrase);
  }
  assert.doesNotMatch(
    about,
    /\bOrganizerNote\b|about-founder-note(?:-title)?/u,
    "the About page must not retain any part of the removed organizer-note block",
  );
  assert.match(about, /await\s+loadEditorialPage\(slug, route\)/u);
  assert.doesNotMatch(
    about,
    /\bloadAboutData\b|\bloadPublicCatalog\b|\bqueryPublicEvents\b|\bEventCard\b|className="about-(?:facts|events)"/u,
  );
  assert.match(about, /href="\/events">/u);
  assert.doesNotMatch(about, /prefetch=\{false\}/u);
  assert.doesNotMatch(
    about,
    /FieldArtwork|PageMasthead|Meetup refresh|Last completed|sync failed/ui,
  );
  assert.match(styles, /\.about-feel,/u);
});

test("Events defaults to Upcoming, keeps Calendar, and exposes no public diagnostics", async () => {
  const [
    page,
    renderer,
    calendar,
    monthCalendar,
    projection,
    worker,
    maintenance,
  ] =
    await Promise.all([
    readFile(new URL("app/events/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/_components/EventsPageRenderer.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/calendar/route.ts", projectRoot), "utf8"),
    readFile(
      new URL("lib/server/public/month-calendar.ts", projectRoot),
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

  assert.match(page, /EventsPageRenderer/u);
  assert.doesNotMatch(page, /eventListValues\(raw\)/u);
  assert.match(page, /loadPublicEventsPageData/u);
  assert.doesNotMatch(
    page,
    /\bqueryPublicEventSlice\b|\bloadPublicMonthCalendar\b/u,
  );
  assert.doesNotMatch(page, /values\.state|values\.page/u);
  assert.doesNotMatch(page, /from "\.\.\/calendar\/page"/u);
  assert.match(`${page}\n${renderer}`, /PublicMonthCalendar/u);
  assert.doesNotMatch(page, /refreshMeetupCalendarSourceIfDue/);
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
  assert.match(renderer, /aria-label="Event views"[\s\S]*Upcoming[\s\S]*Calendar/u);
  assert.doesNotMatch(renderer, /Event timeframe|>\s*Past\s*</u);
  assert.doesNotMatch(renderer, /<EventFilters\b/u);
  assert.doesNotMatch(
    renderer,
    /public-export-actions|Download this public view|exportHref\(/u,
  );
  assert.match(renderer, /<PublicMonthCalendar/u);
  assert.match(renderer, /<EventCard compact event=\{event\}/u);
  assert.doesNotMatch(renderer, /EditorialSection|editorial-sections/u);
  assert.doesNotMatch(
    `${page}\n${renderer}`,
    /readPublicMeetupSyncState|CalendarSourceStatus|SourceStatus|data-source-status|latest Meetup check|Meetup refresh|last complete calendar|Last completed snapshot|not on a guaranteed schedule/u,
  );
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
  assert.match(calendar, /Response\.redirect\(destination, 308\)/u);
  assert.doesNotMatch(calendar, /readPublicMeetupSyncState/);
  assert.doesNotMatch(calendar, /CalendarSourceStatus|data-source-status/);
  assert.doesNotMatch(
    calendar,
    /latest Meetup check|Meetup refresh|last complete calendar|Last completed/u,
  );
  assert.doesNotMatch(calendar, /<PublicMonthCalendar|calendar-view-switcher/u);
  assert.doesNotMatch(renderer, /calendar-view-switcher/u);
  assert.match(monthCalendar, /queryPublicEventSlice/);
  assert.doesNotMatch(calendar, /Download upcoming events/);
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
    /id="meetup-refresh-program"[\s\S]*All Meetup programs[\s\S]*clubOptions\.map/u,
  );
  assert.match(
    controls,
    /runMeetupRefreshAndMaterialize\([\s\S]*selectedClubs[\s\S]*requestMeetupRefresh[\s\S]*requestMeetupMaterialization/u,
  );
  assert.match(
    controls,
    /fetch\("\/api\/organizer\/meetup\/materialize"[\s\S]*body:\s*JSON\.stringify\(\{\}\)/u,
  );
  assert.match(
    controls,
    /body:\s*JSON\.stringify\(\{\s*clubId:\s*targetClubId\s*\}\)/u,
  );
  assert.match(
    controls,
    /MAX_AUTOMATIC_MEETUP_REFRESH_REQUESTS\s*=\s*64/u,
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
  const [
    shared,
    connect,
    refresh,
    materialize,
    model,
    worker,
    requestPathname,
  ] =
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
    readFile(
      new URL(
        "app/api/organizer/meetup/materialize/route.ts",
        projectRoot,
      ),
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
  assert.match(
    refresh,
    /assertOnlyKeys\(payload,\s*\["clubId"\]\)/u,
  );
  assert.match(
    refresh,
    /parseIdentifier\(payload\.clubId,\s*"clubId"\)/u,
  );
  assert.match(
    refresh,
    /refreshMeetupCalendarSource\(database, identity,\s*\{\s*clubId,\s*\}\)/u,
  );
  assert.match(materialize, /requireSameOriginMutation\(request\)/u);
  assert.match(materialize, /readBoundedUtf8Body\(request,\s*16\)/u);
  assert.match(
    materialize,
    /requireMeetupApiActor\(\[\s*"owner",\s*"administrator",?\s*\]\)/u,
  );
  assert.match(materialize, /assertOnlyKeys\(payload,\s*\[\]\)/u);
  assert.match(
    materialize,
    /refreshPublicEventMaterializations\([\s\S]*database,[\s\S]*organizationId:\s*membership\.organizationId/u,
  );
  assert.match(materialize, /privateJsonHeaders\(\)/u);
  assert.match(materialize, /safeErrorResponse/u);
  assert.doesNotMatch(
    materialize,
    /payload\.(?:organizationId|actorId|membershipRole)/u,
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
    readPublicCss(),
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

test("the exact four primary destinations stay ordered and map related routes active", async () => {
  const [header, footer, css] = await Promise.all([
    readFile(
      new URL("app/_components/SiteHeader.tsx", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("app/_components/SiteFooter.tsx", projectRoot),
      "utf8",
    ),
    readPublicCss(),
  ]);

  const destinations = [
    ["/events", "Events"],
    ["/clubs", "Clubs"],
    ["/about", "About"],
    ["/contact", "Feedback"],
  ];
  let priorDestinationIndex = -1;
  for (const [href, label] of destinations) {
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
  assert.doesNotMatch(header, /\{ href: "\/community", label: "Community" \}/u);
  assert.doesNotMatch(
    header,
    /\{ href: "\/host-an-event", label: "Host an Event" \}/u,
    "the primary header must no longer contain Host an Event",
  );
  assert.doesNotMatch(footer, /\{ href: "\/community", label: "Community" \}/u);
  assert.match(footer, /item\.href === "\/community"/u);
  assert.doesNotMatch(header, /\{ href: "\/calendar", label: "Calendar" \}/u);
  assert.doesNotMatch(header, /\{ href: "\/get-involved", label: "Contribute" \}/u);
  assert.doesNotMatch(
    header,
    /\{ href: "\/organizer", label: "Organizer Login" \}/u,
  );
  assert.match(footer, /<Link href="\/organizer" prefetch=\{false\}>/u);
  assert.match(footer, /Organizer Login/u);
  assert.match(header, /className="primary-nav"/u);
  assert.match(header, /className="primary-nav__link"/u);
  assert.doesNotMatch(header, /<details|<summary|site-navigation/u);
  assert.match(header, /normalizedPrimaryNavigation\(navigation\)/u);
  assert.match(header, /for \(const sourceItem of configured\)/u);
  assert.match(header, /requiredByHref\.get\(normalizedHref\)/u);
  assert.match(header, /primary\.push\(required\)/u);
  assert.match(
    header,
    /href === "\/events"[\s\S]*?pathname === "\/events"[\s\S]*?pathname\.startsWith\("\/events\/"\)[\s\S]*?pathname === "\/calendar"/u,
  );
  assert.match(header, /pathname === href/u);
  assert.match(header, /pathname\.startsWith\(`\$\{href\}\/`\)/u);
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
  const css = await readPublicCss();
  const subFloorRemSizes = [...css.matchAll(/font-size:\s*0\.(\d+)rem/g)]
    .map((match) => Number(`0.${match[1]}`))
    .filter((size) => size < 0.75);

  assert.deepEqual(subFloorRemSizes, []);
});
