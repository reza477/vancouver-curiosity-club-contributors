import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const NOW_UTC_MS = Date.parse("2026-08-11T19:00:00.000Z");
const ORGANIZATION_ID = "org_events_page_performance";
const TODAY_DATE = "2026-08-11";
const projectRoot = new URL("../../", import.meta.url);

test("Events delegates its calendar to one bounded landing loader", async () => {
  const [source, projection] = await Promise.all([
    readFile(new URL("app/events/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("lib/server/public/events.ts", projectRoot),
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
  assert.match(
    projection,
    /events_page_public_events AS MATERIALIZED\s*\(\s*SELECT \*\s*FROM public_events\s*\)/u,
    "the calendar and landing reads must share one materialized public-event projection",
  );
  for (const resultGroup of ["calendar", "landing"]) {
    assert.match(
      projection,
      new RegExp(
        `events_page_${resultGroup} AS \\([\\s\\S]*?FROM events_page_public_events AS public_event`,
        "u",
      ),
      `${resultGroup} must read the materialized Events projection`,
    );
  }
  assert.doesNotMatch(projection, /events_page_list|SELECT 'list'/u);
});

test("public event discovery avoids automatic RSC fan-out and shows a pending state", async () => {
  const pathsWithDirectEventLinks = [
    "app/page.tsx",
    "app/about/page.tsx",
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
    const eventLinks = (source.match(/<Link\b[\s\S]*?>/gu) ?? []).filter(
      (link) => /\/events/u.test(link),
    );
    assert.ok(eventLinks.length > 0, `${path} must expose an Events link`);
    for (const link of eventLinks) {
      assert.match(
        link,
        /prefetch=\{false\}/u,
        `${path} must not preload a dynamic Events route`,
      );
    }
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
    /prefetchInternalLinks = false[\s\S]*?prefetch=\{\s*prefetchInternalLinks && item\.href !== "\/events"\s*\}/u,
  );
  assert.match(
    footer,
    /prefetchInternalLinks && item\.href !== "\/events"/u,
  );
  assert.ok(
    (calendar.match(/prefetch=\{false\}/gu) ?? []).length >= 5,
    "month and selected-event links must not preload more Events renders",
  );
  assert.match(
    breadcrumbs,
    /prefetch=\{!item\.href\.startsWith\("\/events"\)\}/u,
  );
  assert.match(loading, /aria-busy="true"/u);
  assert.match(loading, /role="status"/u);
  assert.match(loading, /Loading events/u);
});

test("the combined Events loader preserves a bounded empty calendar", async (t) => {
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
  assert.equal(loaded.calendarAvailable, true);
  assert.equal(
    counter.count(),
    4,
    "the cold load performs one indexed miss, one unified projection, and one bounded cleanup/upsert batch",
  );
  assert.equal(counter.projectionCount(), 1);

  const warm = await loadPublicEventsPageData(counter.database, {
    nowUtcMs: NOW_UTC_MS + 1_000,
    organizationId: ORGANIZATION_ID,
    rawMonth: "2026-08",
    todayDate: TODAY_DATE,
  });
  assert.deepEqual(warm, loaded);
  assert.equal(
    counter.count(),
    5,
    "the warm load adds only one indexed cache read",
  );
  assert.equal(
    counter.projectionCount(),
    1,
    "the warm load must not repeat the unified public-event projection",
  );
});

test("the unqualified Events landing reuses its empty landing result", async (t) => {
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

  assert.equal(loaded.calendarAvailable, true);
  assert.deepEqual(loaded.calendar.events, []);
  assert.equal(loaded.calendar.resolvedMonth.month, "2026-08");
  assert.equal(loaded.calendar.shiftedToUpcoming, false);
  assert.equal(counter.count(), 4);
  assert.equal(
    counter.projectionCount(),
    1,
    "the default landing must not run a separate nearest-event projection after the bundled landing result already proved there is no target",
  );

  const warm = await loadPublicEventsPageData(counter.database, {
    nowUtcMs: NOW_UTC_MS + 1_000,
    organizationId: ORGANIZATION_ID,
    rawMonth: undefined,
    todayDate: TODAY_DATE,
  });
  assert.deepEqual(warm, loaded);
  assert.equal(counter.count(), 5);
  assert.equal(
    counter.projectionCount(),
    1,
    "the identical landing request must be served without another unified projection",
  );
});

test("the Events fallback preserves a successfully read current month", async (t) => {
  const { loadPublicEventsPageData } = await import(
    "../../lib/server/public/events-page.ts"
  );

  await t.test("a failed landing lookup does not discard the calendar", async (t) => {
    const database = new SqliteD1TestDatabase(await generatedMigrationSql());
    t.after(() => database.close());
    const loaded = await loadPublicEventsPageData(
      failBundleThenStandalone(
        database,
        (sql) => /LIMIT\s+\?\s+OFFSET\s+\?/u.test(sql),
      ),
      { ...loaderInput(), rawMonth: undefined },
    );

    assert.equal(loaded.calendarAvailable, true);
    assert.deepEqual(loaded.calendar.events, []);
    assert.equal(loaded.calendar.resolvedMonth.month, "2026-08");
    assert.equal(loaded.calendar.shiftedToUpcoming, false);
  });

  await t.test("an explicit month falls back to its standalone calendar read", async (t) => {
    const database = new SqliteD1TestDatabase(await generatedMigrationSql());
    t.after(() => database.close());
    const loaded = await loadPublicEventsPageData(
      failBundleThenStandalone(database, () => false),
      loaderInput(),
    );

    assert.equal(loaded.calendarAvailable, true);
    assert.deepEqual(loaded.calendar.events, []);
  });
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

function inspectD1Statements(database) {
  const innerStatements = new WeakMap();
  const statementSql = new WeakMap();
  let statementCount = 0;
  let projectionCount = 0;

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
  }
}

function failBundleThenStandalone(database, shouldFailStandalone) {
  let bundleFailed = false;

  return {
    prepare(sql) {
      return wrap(database.prepare(sql), sql);
    },
  };

  function wrap(statement, sql) {
    return {
      bind(...values) {
        return wrap(statement.bind(...values), sql);
      },
      first(...args) {
        return execute("first", args);
      },
      all(...args) {
        return execute("all", args);
      },
      run(...args) {
        return execute("run", args);
      },
    };

    function execute(method, args) {
      if (!bundleFailed && /events_page_public_events/u.test(sql)) {
        bundleFailed = true;
        throw new Error("Synthetic bundled Events projection failure");
      }
      if (bundleFailed && shouldFailStandalone(sql)) {
        throw new Error("Synthetic standalone Events projection failure");
      }
      return statement[method](...args);
    }
  }
}
