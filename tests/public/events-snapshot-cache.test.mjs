import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const NOW_UTC_MS = Date.parse("2026-08-11T19:00:00.000Z");
const ORGANIZATION_ID = "org_events_snapshot_cache";
const TODAY_DATE = "2026-08-11";
const projectRoot = new URL("../../", import.meta.url);

test("generated migrations retain the indexed durable Events materialization store", async (t) => {
  const database = new SqliteD1TestDatabase(await generatedMigrationSql());
  t.after(() => database.close());

  const table = database.sqlite
    .prepare(
      `SELECT name
       FROM sqlite_schema
       WHERE type = 'table'
         AND name = 'public_event_calendar_snapshots'`,
    )
    .get();
  assert.ok(table);
  assert.deepEqual(
    database.sqlite
      .prepare("PRAGMA table_info(public_event_calendar_snapshots)")
      .all()
      .map((column) => column.name),
    [
      "cache_key",
      "organization_id",
      "snapshot_json",
      "expires_at",
      "created_at",
      "updated_at",
    ],
  );
  assert.ok(
    database.sqlite
      .prepare("PRAGMA index_list(public_event_calendar_snapshots)")
      .all()
      .some(
        (index) =>
          index.name ===
          "public_event_calendar_snapshots_org_expiry_idx",
      ),
  );
});

test("the updater atomically prebuilds DTO-only Home and Events materializations that visitors only read", async (t) => {
  const database = await materializationDatabase(t);
  const {
    readPublicHomeEventMaterialization,
    refreshPublicEventMaterializations,
  } = await import("../../lib/server/public/event-materializations.ts");
  const { loadPublicEventsPageData } = await import(
    "../../lib/server/public/events-page.ts"
  );
  const bundleCalls = [];

  const refreshed = await refreshPublicEventMaterializations(
    database,
    materializationInput(),
    {
      async projectBundle(receivedDatabase, input) {
        bundleCalls.push({ database: receivedDatabase, input });
        return publicBundle("daily-v1");
      },
    },
  );

  assert.equal(bundleCalls.length, 1);
  assert.equal(bundleCalls[0].database, database);
  assert.equal(refreshed.eventDetailCount, 8);
  assert.equal(refreshed.eventsSnapshotCount, 1);
  assert.equal(refreshed.homeEventCount, 8);
  assert.equal(snapshotCount(database), 3);
  assert.ok(
    snapshotRows(database).every(
      (row) => row.expires_at === 8_640_000_000_000_000,
    ),
    "updater-owned materializations must not expire into visitor rebuilds",
  );

  const publicRead = readOnlyVisitorDatabase(database);
  const loaded = await loadPublicEventsPageData(
    publicRead.database,
    loaderInput(),
  );
  assert.equal(publicRead.readCount(), 1);
  assert.equal(publicRead.writeCount(), 0);
  assert.equal(loaded.calendarAvailable, true);
  assert.deepEqual(
    loaded.upcoming.events.map((event) => event.slug),
    ["daily-v1-explore-poster", "daily-v1-think", "daily-v1-september"],
  );
  assert.deepEqual(loaded.clubOptions, [
    { name: "Cache Test Club", slug: "cache-test-club" },
  ]);
  assert.deepEqual(
    loaded.calendar.events.map((event) => event.slug),
    ["daily-v1-explore-poster", "daily-v1-think"],
  );
  const posterEvent = loaded.calendar.events[0];
  assert.deepEqual(posterEvent.artwork, synchronizedArtwork());
  assert.deepEqual(posterEvent.lane, {
    name: "Explore",
    slug: "explore",
  });
  assert.equal(posterEvent.venue?.name.length, 250);
  assert.equal(posterEvent.venue?.address?.length, 544);
  assert.deepEqual(
    { floor: posterEvent.venue?.floor, room: posterEvent.venue?.room },
    { floor: "Level 4", room: "Room 492 South" },
  );
  assert.doesNotMatch(
    JSON.stringify(loaded),
    /private-cache-sentinel|privateOrganizerEmail|secure\.meetupstatic\.com/iu,
  );

  const laneRead = readOnlyVisitorDatabase(database);
  const explore = await loadPublicEventsPageData(
    laneRead.database,
    loaderInput({ laneSlug: "explore" }),
  );
  assert.equal(laneRead.readCount(), 1);
  assert.equal(laneRead.writeCount(), 0);
  assert.deepEqual(
    explore.calendar.events.map((event) => event.slug),
    ["daily-v1-explore-poster"],
  );
  assert.deepEqual(
    explore.upcoming.events.map((event) => event.slug),
    ["daily-v1-explore-poster", "daily-v1-september"],
  );

  const homeRead = readOnlyVisitorDatabase(database);
  const home = await readPublicHomeEventMaterialization(
    homeRead.database,
    {
      nowUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      todayDate: TODAY_DATE,
    },
  );
  assert.equal(homeRead.readCount(), 1);
  assert.equal(homeRead.writeCount(), 0);
  assert.equal(home?.length, 6);
  assert.equal(home?.[0]?.slug, "daily-v1-explore-poster");
});

test("Upcoming pagination is chronological, filterable, and derived by one visitor read", async (t) => {
  const database = await materializationDatabase(t);
  const { refreshPublicEventMaterializations } = await import(
    "../../lib/server/public/event-materializations.ts"
  );
  const { loadPublicEventsPageData } = await import(
    "../../lib/server/public/events-page.ts"
  );
  const calendarEvents = Array.from({ length: 14 }, (_unused, index) =>
    publicEventCard(`paged-${String(index + 1).padStart(2, "0")}`, {
      lane: { name: "Explore", slug: "explore" },
      startsAtUtc: `2026-08-${String(index + 12).padStart(2, "0")}T19:00:00.000Z`,
    }),
  );
  await refreshPublicEventMaterializations(
    database,
    materializationInput(),
    {
      async projectBundle() {
        return {
          calendarEvents,
          eventDetails: calendarEvents.map(publicEventDetailFromCard),
          upcomingEvents: calendarEvents,
        };
      },
    },
  );

  const visitor = readOnlyVisitorDatabase(database);
  const loaded = await loadPublicEventsPageData(
    visitor.database,
    loaderInput({
      clubSlug: "cache-test-club",
      laneSlug: "explore",
      rawPage: "2",
    }),
  );

  assert.equal(visitor.readCount(), 1);
  assert.equal(visitor.writeCount(), 0);
  assert.deepEqual(
    {
      invalidPage: loaded.upcoming.invalidPage,
      page: loaded.upcoming.page,
      pageSize: loaded.upcoming.pageSize,
      totalCount: loaded.upcoming.totalCount,
      totalPages: loaded.upcoming.totalPages,
    },
    {
      invalidPage: false,
      page: 2,
      pageSize: 12,
      totalCount: 14,
      totalPages: 2,
    },
  );
  assert.deepEqual(
    loaded.upcoming.events.map((event) => event.slug),
    ["paged-13", "paged-14"],
  );
  assert.equal(loaded.activeClubSlug, "cache-test-club");
  assert.equal(loaded.invalidClub, false);
});

test("visitors never cold-project or write when a materialization is absent or invalid", async (t) => {
  const database = await materializationDatabase(t);
  const { loadPublicEventsPageData } = await import(
    "../../lib/server/public/events-page.ts"
  );
  const visitor = readOnlyVisitorDatabase(database);

  const missing = await loadPublicEventsPageData(
    visitor.database,
    loaderInput(),
  );
  assert.equal(missing.calendarAvailable, false);
  assert.deepEqual(missing.calendar.events, []);
  assert.equal(visitor.readCount(), 1);
  assert.equal(visitor.writeCount(), 0);
  assert.equal(snapshotCount(database), 0);

  database.sqlite
    .prepare(
      `INSERT INTO public_event_calendar_snapshots (
         cache_key, organization_id, snapshot_json, expires_at,
         created_at, updated_at
       ) VALUES (?, ?, '{}', 8640000000000000, ?, ?)`,
    )
    .run(materializationKey("events"), ORGANIZATION_ID, NOW_UTC_MS, NOW_UTC_MS);

  const invalidVisitor = readOnlyVisitorDatabase(database);
  const invalid = await loadPublicEventsPageData(
    invalidVisitor.database,
    loaderInput(),
  );
  assert.equal(invalid.calendarAvailable, false);
  assert.deepEqual(invalid.calendar.events, []);
  assert.equal(invalidVisitor.readCount(), 1);
  assert.equal(invalidVisitor.writeCount(), 0);
  assert.equal(snapshotCount(database), 1);
});

test("failed projections, private DTO drift, and failed promotion preserve the complete last-known-good set", async (t) => {
  const database = await materializationDatabase(t);
  const {
    readPublicHomeEventMaterialization,
    refreshPublicEventMaterializations,
  } = await import("../../lib/server/public/event-materializations.ts");
  const { loadPublicEventsPageData } = await import(
    "../../lib/server/public/events-page.ts"
  );

  await refreshPublicEventMaterializations(
    database,
    materializationInput(),
    { projectBundle: async () => publicBundle("stable-v1") },
  );
  const beforeRows = snapshotRows(database);
  const beforeEvents = await loadPublicEventsPageData(database, loaderInput());
  const beforeHome = await readPublicHomeEventMaterialization(database, {
    nowUtcMs: NOW_UTC_MS,
    organizationId: ORGANIZATION_ID,
    todayDate: TODAY_DATE,
  });

  await assert.rejects(
    refreshPublicEventMaterializations(
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
  assert.deepEqual(snapshotRows(database), beforeRows);

  const privateBundle = publicBundle("private-v2");
  privateBundle.calendarEvents[0].privateOrganizerEmail =
    "private-cache-sentinel@example.test";
  await assert.rejects(
    refreshPublicEventMaterializations(
      database,
      materializationInput({ nowUtcMs: NOW_UTC_MS + 120_000 }),
      { projectBundle: async () => privateBundle },
    ),
  );
  assert.deepEqual(snapshotRows(database), beforeRows);

  database.exec(`
    CREATE TRIGGER reject_materialization_pair_update
    BEFORE UPDATE ON public_event_calendar_snapshots
    WHEN NEW.snapshot_json LIKE '%atomic-failure-sentinel%'
    BEGIN
      SELECT RAISE(ABORT, 'synthetic atomic promotion failure');
    END;
  `);
  await assert.rejects(
    refreshPublicEventMaterializations(
      database,
      materializationInput({ nowUtcMs: NOW_UTC_MS + 180_000 }),
      {
        projectBundle: async () =>
          publicBundle("atomic-failure-sentinel"),
      },
    ),
    /synthetic atomic promotion failure/iu,
  );
  assert.deepEqual(snapshotRows(database), beforeRows);
  assert.deepEqual(
    await loadPublicEventsPageData(database, loaderInput()),
    beforeEvents,
  );
  assert.deepEqual(
    await readPublicHomeEventMaterialization(database, {
      nowUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      todayDate: TODAY_DATE,
    }),
    beforeHome,
  );
});

test("the production materializer uses one bounded unified projection and three atomic writes", async (t) => {
  const database = await materializationDatabase(t);
  const counter = countStatements(database);
  const { refreshPublicEventMaterializations } = await import(
    "../../lib/server/public/event-materializations.ts"
  );

  await refreshPublicEventMaterializations(
    counter.database,
    materializationInput(),
  );

  assert.equal(counter.materializationProjectionCount(), 1);
  assert.equal(counter.batchStatementCount(), 3);
  assert.ok(
    counter.executedStatementCount() < 50,
    `the updater used ${counter.executedStatementCount()} D1 statements`,
  );
  assert.equal(snapshotCount(database), 3);
});

test("the durable DTO boundary stays separate from dynamic HTML and nonce handling", async () => {
  const [page, loader, home, materializations, loading, worker] =
    await Promise.all([
      readFile(new URL("app/events/page.tsx", projectRoot), "utf8"),
      readFile(
        new URL("lib/server/public/events-page.ts", projectRoot),
        "utf8",
      ),
      readFile(new URL("lib/server/public/home.ts", projectRoot), "utf8"),
      readFile(
        new URL(
          "lib/server/public/event-materializations.ts",
          projectRoot,
        ),
        "utf8",
      ),
      readFile(new URL("app/events/loading.tsx", projectRoot), "utf8"),
      readFile(new URL("worker/index.ts", projectRoot), "utf8"),
    ]);

  assert.match(page, /export const dynamic = "force-dynamic"/u);
  assert.match(loader, /readPublicEventsPageMaterialization/u);
  assert.match(home, /readPublicHomeEventMaterialization/u);
  assert.doesNotMatch(
    `${loader}\n${home}`,
    /queryPublicEvent|writePublicEventsSnapshot|refreshMeetup|fetchMeetup|database\.batch/iu,
  );
  assert.match(materializations, /queryPublicEventMaterializationBundle/u);
  assert.match(materializations, /database\.batch\(/u);
  assert.doesNotMatch(
    materializations,
    /\.rsc\b|text\/html|handler\.fetch/iu,
  );
  assert.match(
    worker,
    /const nonce = isLocalRequest\(url\) \? null : createCspNonce\(\)/u,
  );
  assert.match(worker, /requestWithSecurityContext\(/u);
  assert.match(worker, /secureResponse\(/u);
  assert.match(loading, /aria-busy="true"/u);
  assert.match(loading, /aria-live="polite"/u);
  assert.match(loading, /role="status"/u);
});

function materializationInput(overrides = {}) {
  return {
    nowUtcMs: NOW_UTC_MS,
    organizationId: ORGANIZATION_ID,
    todayDate: TODAY_DATE,
    ...overrides,
  };
}

function loaderInput(overrides = {}) {
  return {
    cacheOrigin: null,
    laneSlug: null,
    nowUtcMs: NOW_UTC_MS,
    organizationId: ORGANIZATION_ID,
    rawMonth: "2026-08",
    todayDate: TODAY_DATE,
    ...overrides,
  };
}

function publicBundle(version) {
  const calendarEvents = [
    publicEventCard(`${version}-explore-poster`, {
      artwork: synchronizedArtwork(),
      lane: { name: "Explore", slug: "explore" },
      startsAtUtc: "2026-08-20T19:00:00.000Z",
    }),
    publicEventCard(`${version}-think`, {
      lane: { name: "Think", slug: "think" },
      startsAtUtc: "2026-08-21T19:00:00.000Z",
    }),
    publicEventCard(`${version}-september`, {
      lane: { name: "Explore", slug: "explore" },
      startsAtUtc: "2026-09-05T19:00:00.000Z",
    }),
  ];
  const upcomingEvents = Array.from({ length: 8 }, (_unused, index) =>
    index < calendarEvents.length
      ? calendarEvents[index]
      : publicEventCard(`${version}-reserve-${index + 1}`, {
          lane: { name: "Think", slug: "think" },
          startsAtUtc: `2026-09-${String(index + 10).padStart(2, "0")}T19:00:00.000Z`,
        }),
  );
  return {
    calendarEvents,
    eventDetails: upcomingEvents.map(publicEventDetailFromCard),
    upcomingEvents,
  };
}

function publicEventDetailFromCard(card) {
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

function publicEventCard(slug, overrides = {}) {
  const startsAtUtc =
    overrides.startsAtUtc ?? "2026-08-20T19:00:00.000Z";
  return {
    agePolicyText: null,
    arrivalInstructions: null,
    attendanceMode: "in-person",
    artwork: overrides.artwork ?? null,
    availabilityState: "open",
    capacity: 30,
    category: null,
    club: { name: "Cache Test Club", slug: "cache-test-club" },
    costText: null,
    isCancelled: false,
    lane: overrides.lane ?? null,
    program: null,
    rsvpMode: "meetup",
    rsvpUrl: `https://www.meetup.com/vancouver-meetup-group/events/${eventNumber(slug)}/`,
    schedule: {
      endsAtUtc: new Date(Date.parse(startsAtUtc) + 2 * 60 * 60_000).toISOString(),
      kind: "timed",
      startsAtUtc,
      timeZone: "America/Vancouver",
    },
    slug,
    status: "confirmed",
    summary: "A validated public materialization event.",
    title: slug,
    venue: {
      address: "A".repeat(544),
      floor: "Level 4",
      name: "V".repeat(250),
      room: "Room 492 South",
    },
    waitlistAvailable: false,
  };
}

function synchronizedArtwork() {
  return {
    altText: "A horizontal synchronized event poster",
    credit: "Vancouver Curiosity Club via Meetup",
    dimensions: {
      large: { height: 900, width: 1_600 },
      medium: { height: 540, width: 960 },
      small: { height: 270, width: 480 },
    },
    focalPoint: { x: 5_000, y: 5_000 },
    srcSet: {
      large: "/meetup-posters/vancouver-meetup-group/900000001/large",
      medium: "/meetup-posters/vancouver-meetup-group/900000001/medium",
      small: "/meetup-posters/vancouver-meetup-group/900000001/small",
    },
    url: "/meetup-posters/vancouver-meetup-group/900000001/large",
  };
}

function eventNumber(value) {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)) % 90_000_000;
  }
  return String(900_000_000 + hash);
}

function materializationKey(surface) {
  return JSON.stringify([
    "public-event-materializations",
    1,
    ORGANIZATION_ID,
    surface,
  ]);
}

function snapshotCount(database) {
  return database.sqlite
    .prepare(
      `SELECT count(*) AS count
       FROM public_event_calendar_snapshots
       WHERE organization_id = ?`,
    )
    .get(ORGANIZATION_ID).count;
}

function snapshotRows(database) {
  return database.sqlite
    .prepare(
      `SELECT cache_key, snapshot_json, expires_at, created_at, updated_at
       FROM public_event_calendar_snapshots
       WHERE organization_id = ?
       ORDER BY cache_key`,
    )
    .all(ORGANIZATION_ID);
}

function readOnlyVisitorDatabase(database) {
  let reads = 0;
  let writes = 0;
  return {
    database: {
      batch() {
        writes += 1;
        throw new Error("A visitor must not batch or write snapshots.");
      },
      prepare(sql) {
        assert.match(sql, /^\s*SELECT snapshot_json\s+FROM public_event_calendar_snapshots/u);
        const statement = database.prepare(sql);
        return {
          bind(...values) {
            const bound = statement.bind(...values);
            return {
              all() {
                throw new Error("A visitor snapshot read must use first().");
              },
              first(...args) {
                reads += 1;
                return bound.first(...args);
              },
              run() {
                writes += 1;
                throw new Error("A visitor must not write snapshots.");
              },
            };
          },
        };
      },
    },
    readCount: () => reads,
    writeCount: () => writes,
  };
}

function countStatements(database) {
  const innerStatements = new WeakMap();
  const statementSql = new WeakMap();
  let executedStatements = 0;
  let batchStatements = 0;
  let materializationProjections = 0;

  const countedDatabase = {
    batch(statements) {
      const inner = statements.map((statement) => {
        const unwrapped = innerStatements.get(statement);
        assert.ok(unwrapped);
        record(statementSql.get(statement));
        batchStatements += 1;
        return unwrapped;
      });
      return database.batch(inner);
    },
    prepare(sql) {
      return wrap(database.prepare(sql), sql);
    },
  };

  return {
    batchStatementCount: () => batchStatements,
    database: countedDatabase,
    executedStatementCount: () => executedStatements,
    materializationProjectionCount: () => materializationProjections,
  };

  function wrap(statement, sql) {
    const wrapped = {
      bind(...values) {
        return wrap(statement.bind(...values), sql);
      },
      all(...args) {
        record(sql);
        return statement.all(...args);
      },
      first(...args) {
        record(sql);
        return statement.first(...args);
      },
      run(...args) {
        record(sql);
        return statement.run(...args);
      },
    };
    innerStatements.set(wrapped, statement);
    statementSql.set(wrapped, sql);
    return wrapped;
  }

  function record(sql) {
    executedStatements += 1;
    if (/\bmaterialization_public_events\s+AS\s+MATERIALIZED\b/u.test(sql)) {
      materializationProjections += 1;
    }
  }
}

async function materializationDatabase(t) {
  const database = new SqliteD1TestDatabase(await generatedMigrationSql());
  t.after(() => database.close());
  database.sqlite
    .prepare(
      `INSERT INTO organizations (id, name, slug, timezone)
       VALUES (?, 'Events snapshot cache', 'events-snapshot-cache',
               'America/Vancouver')`,
    )
    .run(ORGANIZATION_ID);
  return database;
}

async function generatedMigrationSql() {
  const migrationDirectory = join(process.cwd(), "drizzle");
  const migrationNames = (await readdir(migrationDirectory))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort();
  assert.ok(migrationNames.length > 0);
  return (
    await Promise.all(
      migrationNames.map((name) =>
        readFile(join(migrationDirectory, name), "utf8"),
      ),
    )
  ).join("\n");
}
