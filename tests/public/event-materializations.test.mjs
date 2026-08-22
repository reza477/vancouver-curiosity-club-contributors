import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const NOW_UTC_MS = Date.parse("2026-08-11T19:00:00.000Z");
const ORGANIZATION_ID = "org_event_materializations";
const TODAY_DATE = "2026-08-11";
const projectRoot = new URL("../../", import.meta.url);

test("one updater-owned dataset serves Home, arbitrary months, lanes, and date rollover", async (t) => {
  const materializations = await import(
    "../../lib/server/public/event-materializations.ts"
  );
  const database = await materializationDatabase(t);
  let bundleCalls = 0;
  const bundle = materializationBundle("daily-v1", 8);
  const refreshed = await materializations.refreshPublicEventMaterializations(
    database,
    materializationInput(),
    {
      async projectBundle() {
        bundleCalls += 1;
        return bundle;
      },
    },
  );

  assert.equal(bundleCalls, 1, "production projection must run once");
  assert.deepEqual(refreshed, {
    eventDetailCount: 14,
    eventsSnapshotCount: 1,
    homeEventCount: 9,
  });
  const home = await materializations.readPublicHomeEventMaterialization(
    database,
    materializationInput(),
  );
  assert.equal(home?.length, 6);
  assert.ok(home?.every((event) => event.title.startsWith("daily-v1")));
  const homeReserve =
    await materializations.readPublicHomeEventMaterialization(database, {
      ...materializationInput(),
      maximum: 48,
    });
  assert.equal(homeReserve?.length, 9);
  await assert.rejects(
    materializations.readPublicHomeEventMaterialization(database, {
      ...materializationInput(),
      maximum: 49,
    }),
    (error) =>
      error?.issues?.some(
        (issue) =>
          issue.path === "eventMaterializations.home.maximum" &&
          issue.code === "invalid_integer",
      ),
  );

  for (const [month, expected] of [
    ["2025-08", "daily-v1 old-bound"],
    ["2026-08", "daily-v1 current-all"],
    ["2027-08", "daily-v1 future-bound"],
  ]) {
    const loaded = await materializations.readPublicEventsPageMaterialization(
      database,
      {
        organizationId: ORGANIZATION_ID,
        rawMonth: month,
        todayDate: TODAY_DATE,
      },
    );
    assert.equal(loaded?.calendar.events[0]?.title, expected);
  }
  const explore = await materializations.readPublicEventsPageMaterialization(
    database,
    {
      laneSlug: "explore",
      organizationId: ORGANIZATION_ID,
      rawMonth: "2026-08",
      todayDate: TODAY_DATE,
    },
  );
  assert.deepEqual(
    explore?.calendar.events.map((event) => event.title),
    ["daily-v1 current-explore"],
  );

  const nextMonthLanding =
    await materializations.readPublicEventsPageMaterialization(database, {
      nowUtcMs: Date.parse("2026-09-01T19:00:00.000Z"),
      organizationId: ORGANIZATION_ID,
      rawMonth: undefined,
      todayDate: "2026-09-01",
    });
  assert.equal(nextMonthLanding?.calendar.resolvedMonth.month, "2026-09");
  assert.equal(
    nextMonthLanding?.calendar.events[0]?.title,
    "daily-v1 next-month",
  );

  const laterHome = await materializations.readPublicHomeEventMaterialization(
    database,
    {
      nowUtcMs: Date.parse("2026-08-20T22:00:00.000Z"),
      organizationId: ORGANIZATION_ID,
      todayDate: "2026-08-20",
    },
  );
  assert.equal(laterHome?.length, 1);
  assert.equal(laterHome?.[0]?.title, "daily-v1 reserve-later");
});

test("Events derives club intersections and bounded pages from one durable dataset", async (t) => {
  const materializations = await import(
    "../../lib/server/public/event-materializations.ts"
  );
  const database = await materializationDatabase(t);
  const alphaEvents = Array.from({ length: 13 }, (_unused, index) =>
    eventCard(`Alpha gathering ${index + 1}`, {
      clubName: "Alpha Club",
      clubSlug: "alpha-club",
      day: 12 + index,
      ordinal: 100 + index,
    }),
  );
  const betaExplore = eventCard("Beta Explore gathering", {
    clubName: "Beta Club",
    clubSlug: "beta-club",
    day: 25,
    laneSlug: "explore",
    ordinal: 200,
  });
  const betaUnlaned = eventCard("Beta general gathering", {
    clubName: "Beta Club",
    clubSlug: "beta-club",
    day: 26,
    ordinal: 201,
  });
  const events = [...alphaEvents, betaExplore, betaUnlaned];

  await materializations.refreshPublicEventMaterializations(
    database,
    materializationInput(),
    {
      async projectBundle() {
        return {
          calendarEvents: events,
          eventDetails: events.map(eventDetailFromCard),
          upcomingEvents: events,
        };
      },
    },
  );

  const firstPage = await materializations.readPublicEventsPageMaterialization(
    database,
    {
      nowUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      rawMonth: "2026-08",
      todayDate: TODAY_DATE,
    },
  );
  assert.deepEqual(firstPage?.clubOptions, [
    { name: "Alpha Club", slug: "alpha-club" },
    { name: "Beta Club", slug: "beta-club" },
  ]);
  assert.deepEqual(
    {
      invalidPage: firstPage?.upcoming.invalidPage,
      page: firstPage?.upcoming.page,
      pageSize: firstPage?.upcoming.pageSize,
      resultCount: firstPage?.upcoming.events.length,
      totalCount: firstPage?.upcoming.totalCount,
      totalPages: firstPage?.upcoming.totalPages,
    },
    {
      invalidPage: false,
      page: 1,
      pageSize: 12,
      resultCount: 12,
      totalCount: 15,
      totalPages: 2,
    },
  );

  const secondPage =
    await materializations.readPublicEventsPageMaterialization(database, {
      nowUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      rawMonth: "2026-08",
      rawPage: "2",
      todayDate: TODAY_DATE,
    });
  assert.equal(secondPage?.upcoming.invalidPage, false);
  assert.equal(secondPage?.upcoming.page, 2);
  assert.equal(secondPage?.upcoming.events.length, 3);

  for (const rawPage of ["0", "3", "not-a-page", ["2"]]) {
    const invalidPage =
      await materializations.readPublicEventsPageMaterialization(database, {
        nowUtcMs: NOW_UTC_MS,
        organizationId: ORGANIZATION_ID,
        rawMonth: "2026-08",
        rawPage,
        todayDate: TODAY_DATE,
      });
    assert.equal(invalidPage?.upcoming.invalidPage, true, String(rawPage));
    assert.equal(invalidPage?.upcoming.page, 1, String(rawPage));
    assert.equal(invalidPage?.upcoming.events.length, 12, String(rawPage));
  }

  const beta = await materializations.readPublicEventsPageMaterialization(
    database,
    {
      clubSlug: "beta-club",
      nowUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      rawMonth: "2026-08",
      todayDate: TODAY_DATE,
    },
  );
  assert.equal(beta?.activeClubSlug, "beta-club");
  assert.equal(beta?.invalidClub, false);
  assert.deepEqual(
    beta?.upcoming.events.map((event) => event.title),
    ["Beta Explore gathering", "Beta general gathering"],
  );

  const betaExploreOnly =
    await materializations.readPublicEventsPageMaterialization(database, {
      clubSlug: "beta-club",
      laneSlug: "explore",
      nowUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      rawMonth: "2026-08",
      todayDate: TODAY_DATE,
    });
  assert.deepEqual(
    betaExploreOnly?.upcoming.events.map((event) => event.title),
    ["Beta Explore gathering"],
  );
  assert.deepEqual(
    betaExploreOnly?.calendar.events.map((event) => event.title),
    ["Beta Explore gathering"],
  );

  const emptyIntersection =
    await materializations.readPublicEventsPageMaterialization(database, {
      clubSlug: "alpha-club",
      laneSlug: "explore",
      nowUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      rawMonth: "2026-08",
      todayDate: TODAY_DATE,
    });
  assert.equal(emptyIntersection?.activeClubSlug, "alpha-club");
  assert.equal(emptyIntersection?.invalidClub, false);
  assert.deepEqual(emptyIntersection?.upcoming.events, []);
  assert.equal(emptyIntersection?.upcoming.totalCount, 0);
  assert.equal(emptyIntersection?.upcoming.totalPages, 1);
  assert.deepEqual(emptyIntersection?.calendar.events, []);

  const invalidClub =
    await materializations.readPublicEventsPageMaterialization(database, {
      clubSlug: "missing-club",
      nowUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      rawMonth: "2026-08",
      todayDate: TODAY_DATE,
    });
  assert.equal(invalidClub?.activeClubSlug, null);
  assert.equal(invalidClub?.invalidClub, true);
  assert.equal(invalidClub?.upcoming.totalCount, 15);
  assert.equal(invalidClub?.calendar.events.length, 15);
});

test("materialized ordering matches timed, all-day noon, title NOCASE, and slug SQL ties", async (t) => {
  const materializations = await import(
    "../../lib/server/public/event-materializations.ts"
  );
  const events = [
    eventCard("Timed 1 p.m.", { ordinal: 430, startHour: 13 }),
    eventCard("All day at noon", { allDay: true, ordinal: 431 }),
    eventCard("Timed 11 a.m.", { ordinal: 432, startHour: 11 }),
    eventCard("beta tie", { ordinal: 433 }),
    eventCard("Alpha tie", { ordinal: 434 }),
  ];
  const database = await materializationDatabase(t);
  await materializations.refreshPublicEventMaterializations(
    database,
    materializationInput(),
    {
      async projectBundle() {
        return {
          calendarEvents: events,
          eventDetails: events.map(eventDetailFromCard),
          upcomingEvents: events,
        };
      },
    },
  );

  const loaded = await materializations.readPublicEventsPageMaterialization(
    database,
    {
      nowUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      rawMonth: "2026-08",
      todayDate: TODAY_DATE,
    },
  );
  assert.deepEqual(
    loaded?.upcoming.events.map((event) => event.title),
    [
      "Timed 11 a.m.",
      "All day at noon",
      "Timed 1 p.m.",
      "Alpha tie",
      "beta tie",
    ],
  );
});

test("one bounded detail row serves event, related, club, and program views without visitor writes", async (t) => {
  const materializations = await import(
    "../../lib/server/public/event-materializations.ts"
  );
  const database = await materializationDatabase(t);
  const target = eventDetail("Target gathering", {
    category: { name: "Ideas", slug: "ideas" },
    clubName: "Alpha Club",
    clubSlug: "alpha-club",
    day: 20,
    ordinal: 300,
    program: { name: "Alpha Series", slug: "alpha-series" },
  });
  const sameClub = eventDetail("Same club gathering", {
    clubName: "Alpha Club",
    clubSlug: "alpha-club",
    day: 21,
    ordinal: 301,
    program: { name: "Alpha Series", slug: "alpha-series" },
  });
  const sameCategory = eventDetail("Same category gathering", {
    category: { name: "Ideas", slug: "ideas" },
    clubName: "Beta Club",
    clubSlug: "beta-club",
    day: 22,
    ordinal: 302,
  });
  const unrelated = eventDetail("Unrelated gathering", {
    clubName: "Beta Club",
    clubSlug: "beta-club",
    day: 23,
    ordinal: 303,
  });
  const pastProgram = eventDetail("Past program gathering", {
    clubName: "Alpha Club",
    clubSlug: "alpha-club",
    day: 2,
    ordinal: 304,
    program: { name: "Alpha Series", slug: "alpha-series" },
  });
  const oldPastProgram = eventDetail("Older program gathering", {
    clubName: "Alpha Club",
    clubSlug: "alpha-club",
    day: 2,
    month: "2024-01",
    ordinal: 305,
    program: { name: "Alpha Series", slug: "alpha-series" },
  });
  const all = [
    target,
    sameClub,
    sameCategory,
    unrelated,
    pastProgram,
    oldPastProgram,
  ];
  const cards = all.slice(0, -1).map(eventCardFromDetail);

  const refreshed = await materializations.refreshPublicEventMaterializations(
    database,
    materializationInput(),
    {
      async projectBundle() {
        return {
          calendarEvents: cards,
          eventDetails: all,
          upcomingEvents: cards.slice(0, 4),
        };
      },
    },
  );
  assert.equal(refreshed.eventDetailCount, 6);

  const counter = countDatabaseStatements(database);
  const detail =
    await materializations.readPublicEventDetailViewMaterialization(
      counter.database,
      {
        nowUtcMs: NOW_UTC_MS,
        organizationId: ORGANIZATION_ID,
        slug: target.slug,
        todayDate: TODAY_DATE,
      },
    );
  assert.equal(detail?.kind, "available");
  assert.equal(detail?.event.title, "Target gathering");
  assert.deepEqual(
    detail?.related.map((event) => event.title),
    ["Same club gathering", "Same category gathering"],
  );
  assert.deepEqual(counter.counts(), {
    batch: 0,
    executions: 1,
    first: 1,
    run: 0,
  });
  assert.equal(
    counter.sql().filter((sql) =>
      sql.includes("FROM public_event_calendar_snapshots"),
    ).length,
    1,
  );
  assert.ok(
    counter.sql().every((sql) => !sql.includes("WITH public_clubs AS")),
    "detail visitors must never execute the unified public-event projection",
  );

  counter.reset();
  const missing =
    await materializations.readPublicEventDetailViewMaterialization(
      counter.database,
      {
        nowUtcMs: NOW_UTC_MS,
        organizationId: ORGANIZATION_ID,
        slug: "missing-event",
        todayDate: TODAY_DATE,
      },
    );
  assert.deepEqual(missing, { kind: "missing" });
  assert.deepEqual(counter.counts(), {
    batch: 0,
    executions: 1,
    first: 1,
    run: 0,
  });

  counter.reset();
  const club = await materializations.readPublicClubEventViewMaterialization(
    counter.database,
    {
      clubSlug: "alpha-club",
      nowUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      pageSize: 6,
      todayDate: TODAY_DATE,
    },
  );
  assert.deepEqual(
    club?.upcoming.events.map((event) => event.title),
    ["Target gathering", "Same club gathering"],
  );
  assert.deepEqual(
    club?.past.events.map((event) => event.title),
    ["Past program gathering", "Older program gathering"],
  );
  assert.deepEqual(counter.counts(), {
    batch: 0,
    executions: 1,
    first: 1,
    run: 0,
  });

  counter.reset();
  const directory =
    await materializations.readPublicNextEventsByClubMaterialization(
      counter.database,
      {
        clubSlugs: ["alpha-club", "beta-club", "alpha-club"],
        nowUtcMs: NOW_UTC_MS,
        organizationId: ORGANIZATION_ID,
        todayDate: TODAY_DATE,
      },
    );
  assert.deepEqual(
    directory?.map((event) => event.title),
    ["Target gathering", "Same category gathering"],
  );
  assert.equal("descriptionHtml" in directory[0], false);
  assert.deepEqual(counter.counts(), {
    batch: 0,
    executions: 1,
    first: 1,
    run: 0,
  });
  assert.ok(
    counter.sql().every((sql) => !sql.includes("WITH public_clubs AS")),
    "the directory must never execute the unified public-event projection",
  );

  counter.reset();
  assert.deepEqual(
    await materializations.readPublicNextEventsByClubMaterialization(
      counter.database,
      {
        clubSlugs: [],
        nowUtcMs: NOW_UTC_MS,
        organizationId: ORGANIZATION_ID,
        todayDate: TODAY_DATE,
      },
    ),
    [],
  );
  assert.deepEqual(counter.counts(), {
    batch: 0,
    executions: 0,
    first: 0,
    run: 0,
  });
  await assert.rejects(
    materializations.readPublicNextEventsByClubMaterialization(
      counter.database,
      {
        clubSlugs: Array.from({ length: 13 }, (_unused, index) =>
          `club-${index + 1}`
        ),
        nowUtcMs: NOW_UTC_MS,
        organizationId: ORGANIZATION_ID,
        todayDate: TODAY_DATE,
      },
    ),
    (error) =>
      error?.issues?.some(
        (issue) =>
          issue.path === "eventMaterializations.clubSlugs" &&
          issue.code === "invalid_length",
      ),
  );

  counter.reset();
  const program =
    await materializations.readPublicClubEventViewMaterialization(
      counter.database,
      {
        clubSlug: "alpha-club",
        nowUtcMs: NOW_UTC_MS,
        organizationId: ORGANIZATION_ID,
        pageSize: 6,
        programSlug: "alpha-series",
        todayDate: TODAY_DATE,
      },
    );
  assert.deepEqual(
    program?.upcoming.events.map((event) => event.title),
    ["Target gathering", "Same club gathering"],
  );
  assert.deepEqual(
    program?.past.events.map((event) => event.title),
    ["Past program gathering", "Older program gathering"],
  );
  assert.deepEqual(counter.counts(), {
    batch: 0,
    executions: 1,
    first: 1,
    run: 0,
  });

  const detailCacheKey = JSON.stringify([
    "public-event-materializations",
    1,
    ORGANIZATION_ID,
    "details",
  ]);
  const savedDetailRow = database.sqlite
    .prepare(
      `SELECT snapshot_json, expires_at, updated_at
       FROM public_event_calendar_snapshots
       WHERE cache_key = ? AND organization_id = ?`,
    )
    .get(detailCacheKey, ORGANIZATION_ID);
  assert.ok(savedDetailRow);

  database.sqlite
    .prepare(
      `UPDATE public_event_calendar_snapshots
       SET snapshot_json = ?
       WHERE cache_key = ? AND organization_id = ?`,
    )
    .run("{}", detailCacheKey, ORGANIZATION_ID);
  counter.reset();
  assert.equal(
    await materializations.readPublicEventDetailViewMaterialization(
      counter.database,
      {
        nowUtcMs: NOW_UTC_MS,
        organizationId: ORGANIZATION_ID,
        slug: target.slug,
        todayDate: TODAY_DATE,
      },
    ),
    null,
  );
  assert.equal(
    await materializations.readPublicNextEventsByClubMaterialization(
      counter.database,
      {
        clubSlugs: ["alpha-club"],
        nowUtcMs: NOW_UTC_MS,
        organizationId: ORGANIZATION_ID,
        todayDate: TODAY_DATE,
      },
    ),
    null,
  );
  assert.deepEqual(counter.counts(), {
    batch: 0,
    executions: 2,
    first: 2,
    run: 0,
  });

  database.sqlite
    .prepare(
      `UPDATE public_event_calendar_snapshots
       SET snapshot_json = ?, expires_at = ?, updated_at = ?
       WHERE cache_key = ? AND organization_id = ?`,
    )
    .run(
      savedDetailRow.snapshot_json,
      savedDetailRow.expires_at,
      Number(savedDetailRow.updated_at) + 1,
      detailCacheKey,
      ORGANIZATION_ID,
    );
  counter.reset();
  assert.equal(
    await materializations.readPublicEventDetailViewMaterialization(
      counter.database,
      {
        nowUtcMs: NOW_UTC_MS,
        organizationId: ORGANIZATION_ID,
        slug: target.slug,
        todayDate: TODAY_DATE,
      },
    ),
    null,
  );
  assert.deepEqual(counter.counts(), {
    batch: 0,
    executions: 1,
    first: 1,
    run: 0,
  });

  database.sqlite
    .prepare(
      `UPDATE public_event_calendar_snapshots
       SET snapshot_json = ?, expires_at = ?, updated_at = ?
       WHERE cache_key = ? AND organization_id = ?`,
    )
    .run(
      savedDetailRow.snapshot_json,
      NOW_UTC_MS + 1,
      savedDetailRow.updated_at,
      detailCacheKey,
      ORGANIZATION_ID,
    );
  counter.reset();
  assert.equal(
    await materializations.readPublicEventDetailViewMaterialization(
      counter.database,
      {
        nowUtcMs: NOW_UTC_MS + 1,
        organizationId: ORGANIZATION_ID,
        slug: target.slug,
        todayDate: TODAY_DATE,
      },
    ),
    null,
  );
  assert.deepEqual(counter.counts(), {
    batch: 0,
    executions: 1,
    first: 1,
    run: 0,
  });
});

test("failed projection and failed atomic promotion preserve all prior rows", async (t) => {
  const materializations = await import(
    "../../lib/server/public/event-materializations.ts"
  );
  const database = await materializationDatabase(t);
  await materializations.refreshPublicEventMaterializations(
    database,
    materializationInput(),
    bundleService("stable-v1"),
  );
  const before = snapshots(database);

  await assert.rejects(
    materializations.refreshPublicEventMaterializations(
      database,
      materializationInput({ nowUtcMs: NOW_UTC_MS + 60_000 }),
      {
        async projectBundle() {
          throw new Error("Synthetic projection failure");
        },
      },
    ),
    /Synthetic projection failure/u,
  );
  assert.deepEqual(snapshots(database), before);

  const missingDetails = materializationBundle("missing-details-v2", 8);
  delete missingDetails.eventDetails;
  await assert.rejects(
    materializations.refreshPublicEventMaterializations(
      database,
      materializationInput({ nowUtcMs: NOW_UTC_MS + 90_000 }),
      { async projectBundle() { return missingDetails; } },
    ),
    /event-detail projection was not supplied safely/iu,
  );
  assert.deepEqual(snapshots(database), before);

  const emptyDetails = materializationBundle("empty-details-v2", 8);
  emptyDetails.eventDetails = [];
  await assert.rejects(
    materializations.refreshPublicEventMaterializations(
      database,
      materializationInput({ nowUtcMs: NOW_UTC_MS + 95_000 }),
      { async projectBundle() { return emptyDetails; } },
    ),
    /event-detail projection did not match/iu,
  );
  assert.deepEqual(snapshots(database), before);

  const mismatchedDetails = materializationBundle(
    "mismatched-details-v2",
    8,
  );
  mismatchedDetails.eventDetails[0] = {
    ...mismatchedDetails.eventDetails[0],
    title: "Mismatched detail title",
  };
  await assert.rejects(
    materializations.refreshPublicEventMaterializations(
      database,
      materializationInput({ nowUtcMs: NOW_UTC_MS + 100_000 }),
      { async projectBundle() { return mismatchedDetails; } },
    ),
    /event-detail projection did not match/iu,
  );
  assert.deepEqual(snapshots(database), before);

  database.exec(`
    CREATE TRIGGER reject_atomic_materialization
    BEFORE UPDATE ON public_event_calendar_snapshots
    WHEN NEW.snapshot_json LIKE '%atomic-failure-sentinel%'
    BEGIN
      SELECT RAISE(ABORT, 'synthetic atomic promotion failure');
    END;
  `);
  await assert.rejects(
    materializations.refreshPublicEventMaterializations(
      database,
      materializationInput({ nowUtcMs: NOW_UTC_MS + 120_000 }),
      bundleService("atomic-failure-sentinel"),
    ),
    /synthetic atomic promotion failure/iu,
  );
  assert.deepEqual(
    snapshots(database),
    before,
    "Home, Events, and detail views must roll back together",
  );

  database.exec("DROP TRIGGER reject_atomic_materialization;");
  const noOpDatabase = {
    prepare: database.prepare.bind(database),
    async batch() {
      return [
        { meta: { changes: 1 }, success: true },
        { meta: { changes: 0 }, success: true },
        { meta: { changes: 1 }, success: true },
      ];
    },
  };
  await assert.rejects(
    materializations.refreshPublicEventMaterializations(
      noOpDatabase,
      materializationInput({ nowUtcMs: NOW_UTC_MS + 180_000 }),
      bundleService("silent-noop-v2"),
    ),
    /could not be promoted/iu,
  );
  assert.deepEqual(snapshots(database), before);

  const newest = await materializations.refreshPublicEventMaterializations(
    database,
    materializationInput({ nowUtcMs: NOW_UTC_MS + 300_000 }),
    bundleService("newest-v3"),
  );
  const newestRows = snapshots(database);
  const superseded =
    await materializations.refreshPublicEventMaterializations(
      database,
      materializationInput({ nowUtcMs: NOW_UTC_MS + 240_000 }),
      bundleService("delayed-older-v2"),
    );
  assert.deepEqual(
    superseded,
    newest,
    "a superseded refresh reports the active generation counts",
  );
  assert.deepEqual(
    snapshots(database),
    newestRows,
    "a delayed older projection must not overwrite any active row",
  );
});

test("production materialization stays below D1 limits and visitor reads never write", async (t) => {
  const materializations = await import(
    "../../lib/server/public/event-materializations.ts"
  );
  const database = await materializationDatabase(t, true);
  const counter = countDatabaseStatements(database);

  await materializations.refreshPublicEventMaterializations(
    counter.database,
    { nowUtcMs: NOW_UTC_MS },
  );
  assert.ok(
    counter.count() < 50,
    `updater used ${counter.count()} D1 statements; expected < 50`,
  );
  assert.equal(counter.batchCount(), 1);
  assert.equal(counter.runCount(), 3, "one atomic batch promotes three rows");

  counter.reset();
  await materializations.readPublicHomeEventMaterialization(
    counter.database,
    materializationInput(),
  );
  assert.deepEqual(counter.counts(), {
    batch: 0,
    executions: 1,
    first: 1,
    run: 0,
  });

  counter.reset();
  await materializations.readPublicEventsPageMaterialization(
    counter.database,
    {
      organizationId: ORGANIZATION_ID,
      rawMonth: "2026-08",
      todayDate: TODAY_DATE,
    },
  );
  assert.deepEqual(counter.counts(), {
    batch: 0,
    executions: 1,
    first: 1,
    run: 0,
  });
});

test("ordinary Home and Events loaders contain no projection or write escape hatch", async () => {
  const [home, eventsPage, materializations] = await Promise.all([
    readFile(new URL("lib/server/public/home.ts", projectRoot), "utf8"),
    readFile(new URL("lib/server/public/events-page.ts", projectRoot), "utf8"),
    readFile(
      new URL("lib/server/public/event-materializations.ts", projectRoot),
      "utf8",
    ),
  ]);
  assert.match(home, /readPublicHomeEventMaterialization/u);
  assert.doesNotMatch(home, /queryPublicEventSlice|refreshMeetup|fetchMeetup/iu);
  assert.match(eventsPage, /readPublicEventsPageMaterialization/u);
  assert.doesNotMatch(
    eventsPage,
    /queryPublicCalendar|queryPublicEventSlice|writePublicEventsSnapshot|refreshMeetup|fetchMeetup/iu,
  );
  assert.match(materializations, /database\.batch\(/u);
  assert.doesNotMatch(materializations, /projectEventsPage|projectHomeEvents/u);
});

test("Home rejects an oversized durable row before parsing it", async () => {
  const materializations = await import(
    "../../lib/server/public/event-materializations.ts"
  );
  const oversizedJson = `${JSON.stringify({
    generatedAtUtcMs: NOW_UTC_MS,
    schemaVersion: 1,
    upcomingEvents: [],
  })}${" ".repeat(1_000_001)}`;
  const database = {
    prepare() {
      return {
        bind() { return this; },
        async first() { return { snapshot_json: oversizedJson }; },
      };
    },
  };

  assert.equal(
    await materializations.readPublicHomeEventMaterialization(
      database,
      materializationInput(),
    ),
    null,
  );
});

function materializationInput(overrides = {}) {
  return {
    nowUtcMs: NOW_UTC_MS,
    organizationId: ORGANIZATION_ID,
    todayDate: TODAY_DATE,
    ...overrides,
  };
}

function bundleService(version) {
  return { async projectBundle() { return materializationBundle(version, 8); } };
}

function materializationBundle(version, homeCount) {
  const home = Array.from({ length: homeCount }, (_unused, index) =>
    eventCard(`${version} home-${index + 1}`, {
      day: 20,
      ordinal: index + 1,
    }),
  );
  home.push(
    eventCard(`${version} reserve-later`, { day: 25, ordinal: 50 }),
  );
  const calendarEvents = [
      eventCard(`${version} old-bound`, { month: "2025-08", ordinal: 60 }),
      eventCard(`${version} current-all`, { ordinal: 61 }),
      eventCard(`${version} current-explore`, {
        laneSlug: "explore",
        ordinal: 62,
      }),
      eventCard(`${version} next-month`, { month: "2026-09", ordinal: 63 }),
      eventCard(`${version} future-bound`, { month: "2027-08", ordinal: 64 }),
    ];
  return {
    calendarEvents,
    eventDetails: [...calendarEvents, ...home].map(eventDetailFromCard),
    upcomingEvents: home,
  };
}

function eventCard(
  title,
  {
    allDay = false,
    category = null,
    clubName = "Materialization Club",
    clubSlug = "materialization-club",
    day = 20,
    laneSlug = null,
    month = "2026-08",
    ordinal = 1,
    program = null,
    startHour = 19,
  } = {},
) {
  const dayKey = String(day).padStart(2, "0");
  return {
    agePolicyText: null,
    arrivalInstructions: null,
    attendanceMode: "in-person",
    artwork: null,
    availabilityState: "open",
    capacity: 20,
    category,
    club: { name: clubName, slug: clubSlug },
    costText: null,
    isCancelled: false,
    lane: laneSlug ? { name: "Explore", slug: laneSlug } : null,
    program,
    rsvpMode: "meetup",
    rsvpUrl: `https://www.meetup.com/vancouver-meetup-group/events/${900000000 + ordinal}/`,
    schedule: allDay
      ? {
          endDateExclusive: `${month}-${String(day + 1).padStart(2, "0")}`,
          kind: "all_day",
          startDate: `${month}-${dayKey}`,
        }
      : {
          endsAtUtc: `${month}-${dayKey}T${String(startHour + 2).padStart(2, "0")}:00:00.000Z`,
          kind: "timed",
          startsAtUtc: `${month}-${dayKey}T${String(startHour).padStart(2, "0")}:00:00.000Z`,
          timeZone: "America/Vancouver",
        },
    slug: `materialized-event-${ordinal}`,
    status: "confirmed",
    summary: "A public materialized event.",
    title,
    venue: null,
    waitlistAvailable: false,
  };
}

function eventDetail(title, options = {}) {
  return {
    ...eventCard(title, options),
    description: `Details for ${title}.`,
    descriptionBlocks: [
      {
        content: [{ text: `Details for ${title}.`, type: "text" }],
        type: "paragraph",
      },
    ],
    externalMapUrl: null,
    metaDescription: null,
    organizers: [],
    preparationInformation: null,
    publicAccessNote: null,
    publicOnlineUrl: null,
    seoTitle: null,
    verifiedAccessibilityNotes: null,
    weatherNote: null,
    whatToBring: null,
  };
}

function eventDetailFromCard(card) {
  return {
    ...card,
    description: null,
    descriptionBlocks: null,
    externalMapUrl: null,
    metaDescription: null,
    organizers: [],
    preparationInformation: null,
    publicAccessNote: null,
    publicOnlineUrl: null,
    seoTitle: null,
    verifiedAccessibilityNotes: null,
    weatherNote: null,
    whatToBring: null,
  };
}

function eventCardFromDetail(detail) {
  return {
    agePolicyText: detail.agePolicyText,
    arrivalInstructions: detail.arrivalInstructions,
    attendanceMode: detail.attendanceMode,
    artwork: detail.artwork,
    availabilityState: detail.availabilityState,
    capacity: detail.capacity,
    category: detail.category,
    club: detail.club,
    costText: detail.costText,
    isCancelled: detail.isCancelled,
    lane: detail.lane,
    program: detail.program,
    rsvpMode: detail.rsvpMode,
    rsvpUrl: detail.rsvpUrl,
    schedule: detail.schedule,
    slug: detail.slug,
    status: detail.status,
    summary: detail.summary,
    title: detail.title,
    venue: detail.venue,
    waitlistAvailable: detail.waitlistAvailable,
  };
}

async function materializationDatabase(t, productionSlug = false) {
  const database = new SqliteD1TestDatabase(await generatedMigrationSql());
  t.after(() => database.close());
  database.exec(`
    INSERT INTO organizations (id, name, slug, timezone)
    VALUES (
      '${ORGANIZATION_ID}',
      'Event materializations',
      '${productionSlug ? "vancouver-curiosity-and-education-society" : "event-materializations"}',
      'America/Vancouver'
    );
  `);
  return database;
}

function snapshots(database) {
  return database.sqlite
    .prepare(
      `SELECT cache_key, snapshot_json, updated_at
       FROM public_event_calendar_snapshots
       ORDER BY cache_key`,
    )
    .all();
}

function countDatabaseStatements(database) {
  let executions = 0;
  let first = 0;
  let runs = 0;
  let batches = 0;
  let statements = [];
  const inner = new WeakMap();
  const wrapped = {
    prepare(sql) {
      statements.push(sql);
      return wrap(database.prepare(sql));
    },
    async batch(statements) {
      batches += 1;
      const results = await database.batch(statements.map((statement) => inner.get(statement)));
      runs += statements.length;
      executions += statements.length;
      return results;
    },
  };
  return {
    batchCount: () => batches,
    count: () => executions,
    counts: () => ({ batch: batches, executions, first, run: runs }),
    database: wrapped,
    reset() {
      executions = 0;
      first = 0;
      runs = 0;
      batches = 0;
      statements = [];
    },
    runCount: () => runs,
    sql: () => [...statements],
  };
  function wrap(statement) {
    const result = {
      bind(...values) { return wrap(statement.bind(...values)); },
      async all(...args) { executions += 1; return statement.all(...args); },
      async first(...args) { executions += 1; first += 1; return statement.first(...args); },
      async run(...args) { executions += 1; runs += 1; return statement.run(...args); },
    };
    inner.set(result, statement);
    return result;
  }
}

async function generatedMigrationSql() {
  const migrationDirectory = join(process.cwd(), "drizzle");
  const migrationNames = (await readdir(migrationDirectory))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort();
  return (
    await Promise.all(
      migrationNames.map((name) => readFile(join(migrationDirectory, name), "utf8")),
    )
  ).join("\n");
}
