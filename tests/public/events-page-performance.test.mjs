import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const NOW_UTC_MS = Date.parse("2026-08-11T19:00:00.000Z");
const ORGANIZATION_ID = "org_events_page_performance";
const TODAY_DATE = "2026-08-11";
const projectRoot = new URL("../../", import.meta.url);

test("Events delegates its calendar to one indexed materialization loader", async () => {
  const [source, loader, materializations] = await Promise.all([
    readFile(new URL("app/events/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("lib/server/public/events-page.ts", projectRoot),
      "utf8",
    ),
    readFile(
      new URL(
        "lib/server/public/event-materializations.ts",
        projectRoot,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    source,
    /from ["']@\/lib\/server\/public\/events-page["']/u,
    "/events must use the shared page-data boundary",
  );
  assert.equal(
    (source.match(/await\s+loadPublicEventsPageData\s*\(/gu) ?? []).length,
    1,
    "/events must make one calendar page-data request",
  );
  assert.doesNotMatch(
    source,
    /\bqueryPublicEventSlice\b|\bloadPublicMonthCalendar\b/u,
    "/events must not fan out through independent expensive loaders",
  );
  assert.match(loader, /readPublicEventsPageMaterialization/u);
  assert.doesNotMatch(
    loader,
    /queryPublicEventMaterializationBundle|queryPublicCalendarLandingBundle|queryPublicCalendarMonth|queryPublicEventSlice|writePublicEventsSnapshot|refreshPublicEventMaterializations|database\.batch/u,
    "the visitor loader must not project, write, refresh, or fall back",
  );
  assert.match(
    materializations,
    /FROM public_event_calendar_snapshots[\s\S]*WHERE cache_key = \?[\s\S]*AND organization_id = \?[\s\S]*LIMIT 1/u,
    "the visitor seam must use the cache-key primary lookup with an organization seal",
  );
});

test("public event discovery disables speculative work and shows a pending state", async () => {
  const pathsWithDirectEventLinks = [
    "app/page.tsx",
    "app/about/page.tsx",
    "app/_components/ClubDirectory.tsx",
    "app/_components/ClubEventList.tsx",
    "app/_components/EventCard.tsx",
    "app/_components/HomePageRenderer.tsx",
    "app/events/[slug]/page.tsx",
    "app/not-found.tsx",
  ];
  const directSources = await Promise.all(
    pathsWithDirectEventLinks.map(async (path) => ({
      path,
      source: await readFile(new URL(path, projectRoot), "utf8"),
    })),
  );
  for (const { path, source } of directSources) {
    assert.match(
      source,
      /import \{ PublicRouteLink as Link \} from ["']@\/app\/_components\/PublicRouteLink["'];/u,
      `${path} must apply the selective public-route prefetch policy`,
    );
    const eventLinks = (source.match(/<Link\b[\s\S]*?>/gu) ?? []).filter(
      (link) => /\/events/u.test(link),
    );
    assert.ok(eventLinks.length > 0, `${path} must expose an Events link`);
  }

  const [header, footer, calendar, breadcrumbs, loading] =
    await Promise.all([
      readFile(
        new URL("app/_components/SiteHeader.tsx", projectRoot),
        "utf8",
      ),
      readFile(
        new URL("app/_components/SiteFooter.tsx", projectRoot),
        "utf8",
      ),
      readFile(
        new URL("app/_components/PublicMonthCalendar.tsx", projectRoot),
        "utf8",
      ),
      readFile(
        new URL("app/_components/Breadcrumbs.tsx", projectRoot),
        "utf8",
      ),
      readFile(new URL("app/events/loading.tsx", projectRoot), "utf8"),
    ]);
  assert.match(
    header,
    /PublicRouteLink as Link[\s\S]*?prefetchInternalLinks = true[\s\S]*?prefetch=\{prefetchInternalLinks\}/u,
  );
  assert.match(
    footer,
    /PublicRouteLink as Link[\s\S]*?prefetchInternalLinks = true[\s\S]*?prefetch=\{prefetchInternalLinks\}/u,
  );
  assert.match(
    calendar,
    /PublicRouteLink as Link/u,
    "month and selected-event links must use the expensive-route policy",
  );
  assert.match(
    breadcrumbs,
    /PublicRouteLink as Link/u,
    "event breadcrumbs must use the expensive-route policy",
  );
  assert.match(loading, /aria-busy="true"/u);
  assert.match(loading, /role="status"/u);
  assert.match(loading, /Loading events/u);
});

test("a missing Events materialization returns one bounded unavailable calendar read", async (t) => {
  const { loadPublicEventsPageData } = await import(
    "../../lib/server/public/events-page.ts"
  );
  const database = new SqliteD1TestDatabase(await generatedMigrationSql());
  t.after(() => database.close());
  seedSnapshotOrganization(database);
  const counter = inspectD1Statements(database);

  const loaded = await loadPublicEventsPageData(counter.database, {
    nowUtcMs: NOW_UTC_MS,
    organizationId: ORGANIZATION_ID,
    rawMonth: "2026-08",
    todayDate: TODAY_DATE,
  });

  assert.deepEqual(loaded.calendar, {
    events: [],
    hasMore: false,
    resolvedMonth: {
      invalid: false,
      maxMonth: "2027-08",
      minMonth: "2025-08",
      month: "2026-08",
    },
    shiftedToUpcoming: false,
  });
  assert.equal(loaded.calendarAvailable, false);
  assert.equal(
    counter.count(),
    1,
    "a visitor miss performs only one indexed durable read",
  );
  assert.equal(counter.projectionCount(), 0);
  assert.equal(counter.writeCount(), 0);

  const warm = await loadPublicEventsPageData(counter.database, {
    nowUtcMs: NOW_UTC_MS + 1_000,
    organizationId: ORGANIZATION_ID,
    rawMonth: "2026-08",
    todayDate: TODAY_DATE,
  });
  assert.deepEqual(warm, loaded);
  assert.equal(
    counter.count(),
    2,
    "a second visitor request adds only its own indexed read",
  );
  assert.equal(
    counter.projectionCount(),
    0,
    "missing materializations must never trigger a visitor projection",
  );
  assert.equal(counter.writeCount(), 0);
});

test("the unqualified Events landing remains unavailable without a durable generation", async (t) => {
  const { loadPublicEventsPageData } = await import(
    "../../lib/server/public/events-page.ts"
  );
  const database = new SqliteD1TestDatabase(await generatedMigrationSql());
  t.after(() => database.close());
  seedSnapshotOrganization(database);
  const counter = inspectD1Statements(database);

  const loaded = await loadPublicEventsPageData(counter.database, {
    nowUtcMs: NOW_UTC_MS,
    organizationId: ORGANIZATION_ID,
    rawMonth: undefined,
    todayDate: TODAY_DATE,
  });

  assert.equal(loaded.calendarAvailable, false);
  assert.deepEqual(loaded.calendar.events, []);
  assert.equal(loaded.calendar.resolvedMonth.month, "2026-08");
  assert.equal(loaded.calendar.shiftedToUpcoming, false);
  assert.equal(counter.count(), 1);
  assert.equal(
    counter.projectionCount(),
    0,
    "the default landing must not run an event projection after a materialization miss",
  );
  assert.equal(counter.writeCount(), 0);

  const warm = await loadPublicEventsPageData(counter.database, {
    nowUtcMs: NOW_UTC_MS + 1_000,
    organizationId: ORGANIZATION_ID,
    rawMonth: undefined,
    todayDate: TODAY_DATE,
  });
  assert.deepEqual(warm, loaded);
  assert.equal(counter.count(), 2);
  assert.equal(
    counter.projectionCount(),
    0,
    "the identical landing request must remain a read-only miss",
  );
  assert.equal(counter.writeCount(), 0);
});

test("a corrupt Events materialization returns a safe unavailable empty calendar without fallback", async (t) => {
  const { loadPublicEventsPageData } = await import(
    "../../lib/server/public/events-page.ts"
  );
  const database = new SqliteD1TestDatabase(await generatedMigrationSql());
  t.after(() => database.close());
  seedSnapshotOrganization(database);
  seedCorruptMaterialization(database);
  const counter = inspectD1Statements(database);

  const loaded = await loadPublicEventsPageData(
    counter.database,
    loaderInput(),
  );

  assert.equal(loaded.calendarAvailable, false);
  assert.deepEqual(loaded.calendar, {
    events: [],
    hasMore: false,
    resolvedMonth: {
      invalid: false,
      maxMonth: "2027-08",
      minMonth: "2025-08",
      month: "2026-08",
    },
    shiftedToUpcoming: false,
  });
  assert.equal(counter.count(), 1);
  assert.equal(counter.projectionCount(), 0);
  assert.equal(counter.writeCount(), 0);
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM public_event_calendar_snapshots
         WHERE organization_id = ?`,
      )
      .bind(ORGANIZATION_ID)
      .first("count"),
    1,
    "a corrupt visitor read must not delete or replace the last stored generation",
  );
});

function loaderInput() {
  return {
    nowUtcMs: NOW_UTC_MS,
    organizationId: ORGANIZATION_ID,
    rawMonth: "2026-08",
    todayDate: TODAY_DATE,
  };
}

async function generatedMigrationSql() {
  const migrationDirectory = join(process.cwd(), "drizzle");
  const migrationNames = (await readdir(migrationDirectory))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort();
  assert.ok(migrationNames.length > 0, "generated migrations must exist");
  return (
    await Promise.all(
      migrationNames.map((name) =>
        readFile(join(migrationDirectory, name), "utf8"),
      ),
    )
  ).join("\n");
}

function seedSnapshotOrganization(database) {
  database.exec(`
    INSERT INTO organizations (id, name, slug, timezone)
    VALUES (
      '${ORGANIZATION_ID}',
      'Events page performance',
      'events-page-performance',
      'America/Vancouver'
    );
  `);
}

function seedCorruptMaterialization(database) {
  const cacheKey = JSON.stringify([
    "public-event-materializations",
    1,
    ORGANIZATION_ID,
    "events",
  ]).replaceAll("'", "''");
  database.exec(`
    INSERT INTO public_event_calendar_snapshots (
      cache_key, organization_id, snapshot_json,
      expires_at, created_at, updated_at
    ) VALUES (
      '${cacheKey}', '${ORGANIZATION_ID}', '{}',
      8640000000000000, ${NOW_UTC_MS}, ${NOW_UTC_MS}
    );
  `);
}

function inspectD1Statements(database) {
  const innerStatements = new WeakMap();
  const statementSql = new WeakMap();
  let statementCount = 0;
  let projectionCount = 0;
  let writeCount = 0;

  const inspected = {
    batch(statements) {
      const inner = statements.map((statement) => {
        const unwrapped = innerStatements.get(statement);
        const sql = statementSql.get(statement);
        assert.ok(unwrapped, "the batch contains an uninspected statement");
        assert.equal(typeof sql, "string");
        record(sql);
        return unwrapped;
      });
      return database.batch(inner);
    },
    prepare(sql) {
      return wrap(database.prepare(sql), sql);
    },
  };

  return Object.freeze({
    count: () => statementCount,
    database: inspected,
    projectionCount: () => projectionCount,
    writeCount: () => writeCount,
  });

  function wrap(statement, sql) {
    const wrapped = {
      bind(...values) {
        return wrap(statement.bind(...values), sql);
      },
      first(...args) {
        record(sql);
        return statement.first(...args);
      },
      all(...args) {
        record(sql);
        return statement.all(...args);
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
    statementCount += 1;
    if (/\bpublic_events\s+AS\s*\(/u.test(sql)) projectionCount += 1;
    if (/^\s*(?:DELETE|INSERT|REPLACE|UPDATE)\b/iu.test(sql)) {
      writeCount += 1;
    }
  }
}
