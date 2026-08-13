import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";
import {
  PUBLIC_EVENTS_SNAPSHOT_MAX_BYTES,
  PUBLIC_EVENTS_SNAPSHOT_TTL_MS,
  publicEventsSnapshotCacheKey,
} from "../../lib/server/public/event-calendar-snapshot.ts";

const NOW_UTC_MS = Date.parse("2026-08-11T19:00:00.000Z");
const TEN_MINUTES_MS = 10 * 60 * 1_000;
const ORGANIZATION_ID = "org_events_snapshot_cache";
const OTHER_ORGANIZATION_ID = "org_events_snapshot_cache_other";
const SOURCE_REVISION = "a".repeat(40);
const OTHER_SOURCE_REVISION = "b".repeat(40);
const TODAY_DATE = "2026-08-11";
const projectRoot = new URL("../../", import.meta.url);

test("generated migrations provide the durable normalized Events snapshot cache", async (t) => {
  const database = new SqliteD1TestDatabase(await generatedMigrationSql());
  t.after(() => database.close());

  const table = database.sqlite
    .prepare(
      `SELECT name, sql
       FROM sqlite_schema
       WHERE type = 'table'
         AND name = 'public_event_calendar_snapshots'`,
    )
    .get();
  assert.ok(
    table,
    "a generated migration must create public_event_calendar_snapshots",
  );

  const columns = database.sqlite
    .prepare("PRAGMA table_info(public_event_calendar_snapshots)")
    .all();
  assert.deepEqual(
    columns.map((column) => column.name),
    [
      "cache_key",
      "organization_id",
      "snapshot_json",
      "expires_at",
      "created_at",
      "updated_at",
    ],
  );
  assert.deepEqual(
    columns
      .filter((column) => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map((column) => column.name),
    ["cache_key"],
    "the normalized cache key must be backed by a primary-key lookup",
  );

  const indexes = database.sqlite
    .prepare("PRAGMA index_list(public_event_calendar_snapshots)")
    .all();
  assert.ok(
    indexes.some(
      (index) =>
        index.name ===
        "public_event_calendar_snapshots_org_expiry_idx",
    ),
    "expired durable snapshots need an indexed cleanup path",
  );
  const expiryIndexColumns = database.sqlite
    .prepare(
      "PRAGMA index_info(public_event_calendar_snapshots_org_expiry_idx)",
    )
    .all()
    .map((column) => column.name);
  assert.deepEqual(expiryIndexColumns, ["organization_id", "expires_at"]);
  assert.equal(PUBLIC_EVENTS_SNAPSHOT_TTL_MS, TEN_MINUTES_MS);
});

test("a second identical Events request reads the durable snapshot without repeating the unified projection", async (t) => {
  const { database } = await behaviorDatabase(t);
  const counter = countUnifiedPublicEventProjections(database);
  const { loadPublicEventsPageData } = await import(
    "../../lib/server/public/events-page.ts"
  );

  const first = await loadPublicEventsPageData(counter.database, loaderInput());
  assert.equal(counter.count(), 1, "the cold request should project once");
  const second = await loadPublicEventsPageData(
    counter.database,
    loaderInput({ nowUtcMs: NOW_UTC_MS + 1_000 }),
  );

  assert.deepEqual(second, first);
  assert.equal(
    counter.count(),
    1,
    "the warm request may perform an indexed snapshot read but must not rebuild public_events",
  );
  assert.equal(snapshotCount(database), 1);
});

test("snapshot keys separate build, organization, normalized month, Vancouver date, and request mode", async (t) => {
  const { database } = await behaviorDatabase(t);
  const counter = countUnifiedPublicEventProjections(database);
  const { loadPublicEventsPageData } = await import(
    "../../lib/server/public/events-page.ts"
  );
  const keyContexts = [
    loaderInput({ sourceRevision: SOURCE_REVISION }),
    loaderInput({ sourceRevision: OTHER_SOURCE_REVISION }),
    loaderInput({
      organizationId: OTHER_ORGANIZATION_ID,
      sourceRevision: SOURCE_REVISION,
    }),
    loaderInput({ rawMonth: "2026-09", sourceRevision: SOURCE_REVISION }),
    loaderInput({ todayDate: "2026-08-12", sourceRevision: SOURCE_REVISION }),
    loaderInput({ rawMonth: undefined, sourceRevision: SOURCE_REVISION }),
    loaderInput({
      laneSlug: "reset-and-make",
      sourceRevision: SOURCE_REVISION,
    }),
  ];
  const keys = keyContexts.map(publicEventsSnapshotCacheKey);
  assert.equal(
    new Set(keys).size,
    keyContexts.length,
    "build, organization, normalized month, Vancouver date, and landing mode must all separate durable keys",
  );
  for (const key of keys) {
    const parsed = JSON.parse(key);
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.includes(SOURCE_REVISION) || parsed.includes(OTHER_SOURCE_REVISION));
  }

  const distinctRequests = [
    loaderInput(),
    loaderInput({ organizationId: OTHER_ORGANIZATION_ID }),
    loaderInput({ rawMonth: "2026-09" }),
    loaderInput({ todayDate: "2026-08-12" }),
    loaderInput({ rawMonth: undefined }),
    loaderInput({ laneSlug: "reset-and-make" }),
  ];

  for (const input of distinctRequests) {
    await loadPublicEventsPageData(counter.database, input);
  }
  assert.equal(
    counter.count(),
    distinctRequests.length,
    "each normalized key dimension must produce an independent cold snapshot",
  );

  for (const input of distinctRequests) {
    await loadPublicEventsPageData(counter.database, {
      ...input,
      nowUtcMs: input.nowUtcMs + 60_000,
    });
  }
  assert.equal(
    counter.count(),
    distinctRequests.length,
    "the exact wall-clock millisecond must not fragment a ten-minute snapshot key",
  );
  assert.equal(snapshotCount(database), distinctRequests.length);
});

test("Events snapshots expire after exactly ten minutes", async (t) => {
  const { database } = await behaviorDatabase(t);
  const counter = countUnifiedPublicEventProjections(database);
  const { loadPublicEventsPageData } = await import(
    "../../lib/server/public/events-page.ts"
  );

  await loadPublicEventsPageData(counter.database, loaderInput());
  await loadPublicEventsPageData(
    counter.database,
    loaderInput({ nowUtcMs: NOW_UTC_MS + TEN_MINUTES_MS - 1 }),
  );
  assert.equal(counter.count(), 1, "a snapshot is fresh before its TTL");

  await loadPublicEventsPageData(
    counter.database,
    loaderInput({ nowUtcMs: NOW_UTC_MS + TEN_MINUTES_MS }),
  );
  assert.equal(
    counter.count(),
    2,
    "the request at the expiry boundary must rebuild the projection",
  );
  const stored = readSnapshot(database, loaderInput());
  assert.equal(
    stored.expires_at - stored.updated_at,
    TEN_MINUTES_MS,
  );
});

test("a valid edge snapshot bypasses D1 and is returned without a rewrite", async () => {
  const input = loaderInput();
  const cacheKey = publicEventsSnapshotCacheKey(input);
  const edge = seededEdgeCache(
    JSON.stringify(
      emptySnapshotEnvelope(cacheKey, {
        events: [publicEventCard(), publicEventCardWithoutVenueDetails()],
      }),
    ),
  );
  const { loadPublicEventsPageData } = await import(
    "../../lib/server/public/events-page.ts"
  );

  const loaded = await loadPublicEventsPageData(
    d1ForbiddenDatabase(),
    input,
    { edgeCache: edge.cache },
  );

  assert.equal(loaded.calendar.events.length, 2);
  assert.equal(loaded.calendar.events[0].slug, "cached-public-event");
  assert.equal(loaded.calendar.events[0].title, "Cached public event");
  assert.deepEqual(
    loaded.calendar.events[0].artwork?.focalPoint,
    { x: 5_000, y: 5_000 },
    "real poster focal points use the public 0..10,000 coordinate scale",
  );
  assert.equal(
    loaded.calendar.events[0].venue?.name.length,
    250,
    "the cache preserves the full public venue-name boundary",
  );
  assert.equal(
    loaded.calendar.events[0].venue?.address?.length,
    544,
    "the cache preserves a curated Meetup address with city and state",
  );
  assert.deepEqual(
    {
      floor: loaded.calendar.events[0].venue?.floor,
      room: loaded.calendar.events[0].venue?.room,
    },
    { floor: "Level 4", room: "Room 492 South" },
    "the cache preserves optional structured floor and room facts",
  );
  assert.deepEqual(
    Object.keys(loaded.calendar.events[1].venue ?? {}).sort(),
    ["address", "floor", "name", "room"],
    "the cache preserves the stable nullable venue shape",
  );
  assert.deepEqual(
    {
      floor: loaded.calendar.events[1].venue?.floor,
      room: loaded.calendar.events[1].venue?.room,
    },
    { floor: null, room: null },
    "a venue without structured details keeps explicit null facts",
  );
  assert.doesNotMatch(JSON.stringify(loaded), /private|sentinel/iu);
  assert.equal(
    edge.puts.length,
    0,
    "a validated edge hit must not touch D1 or rewrite the snapshot",
  );
});

test("malformed, oversized, and extra-private-field snapshots are rejected and overwritten", async (t) => {
  const baseInput = loaderInput();
  const cacheKey = publicEventsSnapshotCacheKey(baseInput);
  const cases = [
    {
      name: "malformed JSON",
      payload: "{",
      privateNeedle: null,
    },
    {
      name: "oversized JSON",
      payload: `${JSON.stringify(emptySnapshotEnvelope(cacheKey))}${" ".repeat(
        PUBLIC_EVENTS_SNAPSHOT_MAX_BYTES,
      )}`,
      privateNeedle: null,
    },
    {
      name: "an extra private field nested in an otherwise public event",
      payload: JSON.stringify(
        emptySnapshotEnvelope(cacheKey, {
          events: [privateEventCard()],
        }),
      ),
      privateNeedle: "private-cache-sentinel@example.test",
    },
  ];

  for (const cacheCase of cases) {
    await t.test(cacheCase.name, async (t) => {
      const { database } = await behaviorDatabase(t);
      const edge = seededEdgeCache(cacheCase.payload);
      const counter = countUnifiedPublicEventProjections(database);
      const { loadPublicEventsPageData } = await import(
        "../../lib/server/public/events-page.ts"
      );

      const loaded = await loadPublicEventsPageData(
        counter.database,
        loaderInput(),
        { edgeCache: edge.cache },
      );
      assert.equal(
        counter.count(),
        1,
        "an invalid stored payload must be treated as a cache miss",
      );
      assert.doesNotMatch(
        JSON.stringify(loaded),
        /private-cache-sentinel|privateOrganizerEmail/iu,
      );

      assert.equal(edge.puts.length, 1);
      const replacementJson = edge.puts[0].body;
      assert.notEqual(
        replacementJson,
        cacheCase.payload,
        "the invalid edge row must be replaced with a validated public payload",
      );
      assert.doesNotThrow(() => JSON.parse(replacementJson));
      assert.ok(
        new TextEncoder().encode(replacementJson).byteLength <=
          PUBLIC_EVENTS_SNAPSHOT_MAX_BYTES,
      );
      if (cacheCase.privateNeedle) {
        assert.doesNotMatch(
          replacementJson,
          new RegExp(cacheCase.privateNeedle, "u"),
        );
      }
      const stored = readSnapshot(database, loaderInput());
      assert.doesNotMatch(
        stored.snapshot_json,
        /private-cache-sentinel|privateOrganizerEmail/iu,
      );
      assert.equal(
        stored.expires_at - stored.updated_at,
        TEN_MINUTES_MS,
      );
    });
  }
});

test("failed Events projections never create or poison a durable snapshot", async (t) => {
  const { database } = await behaviorDatabase(t);
  const { loadPublicEventsPageData } = await import(
    "../../lib/server/public/events-page.ts"
  );

  await assert.rejects(
    loadPublicEventsPageData(
      failUnifiedPublicEventProjections(database),
      loaderInput(),
    ),
    /calendar is unavailable|temporarily unavailable/iu,
  );
  assert.equal(snapshotCount(database), 0);

  const counter = countUnifiedPublicEventProjections(database);
  const recovered = await loadPublicEventsPageData(
    counter.database,
    loaderInput({ nowUtcMs: NOW_UTC_MS + 1_000 }),
  );
  assert.equal(counter.count(), 1);
  assert.equal(snapshotCount(database), 1);

  const warm = await loadPublicEventsPageData(
    counter.database,
    loaderInput({ nowUtcMs: NOW_UTC_MS + 2_000 }),
  );
  assert.deepEqual(warm, recovered);
  assert.equal(
    counter.count(),
    1,
    "the first successful retry becomes cacheable; the prior failure never does",
  );
});

test("the durable Events cache remains DTO-only while responses stay dynamic and nonce-protected", async () => {
  const [page, loader, loading, worker, publicServerEntries] =
    await Promise.all([
      readFile(new URL("app/events/page.tsx", projectRoot), "utf8"),
      readFile(
        new URL("lib/server/public/events-page.ts", projectRoot),
        "utf8",
      ),
      readFile(new URL("app/events/loading.tsx", projectRoot), "utf8"),
      readFile(new URL("worker/index.ts", projectRoot), "utf8"),
      readdir(new URL("lib/server/public/", projectRoot)),
    ]);
  const publicServerSources = await Promise.all(
    publicServerEntries
      .filter((name) => /\.tsx?$/u.test(name))
      .map(async (name) => ({
        name,
        source: await readFile(
          new URL(`lib/server/public/${name}`, projectRoot),
          "utf8",
        ),
      })),
  );
  const snapshotSources = publicServerSources.filter(({ source }) =>
    source.includes("public_event_calendar_snapshots"),
  );

  assert.match(page, /export const dynamic = "force-dynamic"/u);
  assert.ok(
    snapshotSources.length > 0,
    "a public DTO cache implementation must own the snapshot table",
  );
  for (const { name, source } of snapshotSources) {
    assert.doesNotMatch(
      source,
      /\.rsc\b|text\/html|handler\.fetch/iu,
      `${name} must cache PublicEventsPageData, never an HTML/RSC response`,
    );
  }
  const snapshotSource = snapshotSources
    .map(({ source }) => source)
    .join("\n");
  assert.match(
    snapshotSource,
    /context\.sourceRevision \?\? runtimeSourceRevision\(\)/u,
    "the cache key must accept an explicit build revision and default to the compiled revision",
  );
  assert.match(snapshotSource, /__VCC_SOURCE_REVISION__/u);
  assert.match(snapshotSource, /PublicEventsPageData/u);
  assert.match(
    snapshotSource,
    /"Content-Type": "application\/json; charset=utf-8"/u,
    "an injected Cache API accelerator may cache only the validated JSON snapshot",
  );
  assert.doesNotMatch(
    snapshotSource,
    /Reflect\.get\(globalThis, "caches"\)|\bcaches\.default\b/u,
    "the durable DTO module must not probe an unavailable response Cache API",
  );
  assert.doesNotMatch(
    loader,
    /normalized_email|privateOrganizerEmail|organizer_notes|invitation_token/iu,
  );

  assert.match(
    worker,
    /const nonce = isLocalRequest\(url\) \? null : createCspNonce\(\)/u,
  );
  assert.match(worker, /requestWithSecurityContext\(/u);
  assert.match(worker, /secureResponse\(/u);
  assert.doesNotMatch(
    worker,
    /\bcaches\.default\b|PublicEventsResponseCache|publicEventsResponseCacheContext|readPublicEventsResponseCache|writePublicEventsResponseCache|preparePublicEventsResponse|rehydratePublicEventsCachedResponse|PUBLIC_EVENTS_RESPONSE_NONCE_PLACEHOLDER/u,
    "Sites rejects Cache API reads and writes, so the Worker must use the durable D1 DTO cache without per-request failed probes",
  );
  assert.match(
    worker,
    /requestWithSecurityContext\(\s*request,\s*policy,\s*nonce,/u,
    "each render must use the request's fresh nonce and matching policy directly",
  );

  assert.match(loading, /aria-busy="true"/u);
  assert.match(loading, /aria-labelledby="events-loading-status"/u);
  assert.match(loading, /aria-live="polite"/u);
  assert.match(loading, /role="status"/u);
});

function loaderInput(overrides = {}) {
  return {
    cacheOrigin: "https://preview.example",
    nowUtcMs: NOW_UTC_MS,
    organizationId: ORGANIZATION_ID,
    rawMonth: "2026-08",
    todayDate: TODAY_DATE,
    ...overrides,
  };
}

function emptySnapshotPayload({ events = [] } = {}) {
  return {
    calendar: {
      events,
      hasMore: false,
      resolvedMonth: {
        invalid: false,
        maxMonth: "2027-08",
        minMonth: "2025-08",
        month: "2026-08",
      },
      shiftedToUpcoming: false,
    },
    calendarAvailable: true,
  };
}

function emptySnapshotEnvelope(cacheKey, options = {}) {
  return {
    cacheKey,
    data: emptySnapshotPayload(options),
    expiresAtUtcMs: NOW_UTC_MS + TEN_MINUTES_MS,
    schemaVersion: 3,
  };
}

function privateEventCard() {
  return {
    ...publicEventCard(),
    privateOrganizerEmail: "private-cache-sentinel@example.test",
    slug: "cached-private-sentinel",
    title: "Cached private sentinel",
  };
}

function publicEventCard() {
  return {
    agePolicyText: null,
    arrivalInstructions: null,
    attendanceMode: "in-person",
    artwork: {
      altText: "A horizontal event poster",
      credit: "Vancouver Curiosity Club",
      dimensions: {
        large: { height: 900, width: 1_600 },
        medium: { height: 540, width: 960 },
        small: { height: 270, width: 480 },
      },
      focalPoint: { x: 5_000, y: 5_000 },
      srcSet: {
        large: "/event-posters/cache-test.jpeg",
        medium: "/event-posters/cache-test-medium.jpeg",
        small: "/event-posters/cache-test-small.jpeg",
      },
      url: "/event-posters/cache-test.jpeg",
    },
    category: null,
    availabilityState: null,
    capacity: null,
    club: { name: "Cache Test Club", slug: "cache-test-club" },
    costText: null,
    isCancelled: false,
    lane: null,
    program: null,
    rsvpMode: null,
    rsvpUrl: null,
    schedule: {
      endsAtUtc: "2026-08-20T21:00:00.000Z",
      kind: "timed",
      startsAtUtc: "2026-08-20T19:00:00.000Z",
      timeZone: "America/Vancouver",
    },
    slug: "cached-public-event",
    status: "confirmed",
    summary: null,
    title: "Cached public event",
    venue: {
      address: "A".repeat(544),
      floor: "Level 4",
      name: "V".repeat(250),
      room: "Room 492 South",
    },
    waitlistAvailable: null,
  };
}

function publicEventCardWithoutVenueDetails() {
  return {
    ...publicEventCard(),
    slug: "cached-public-event-without-venue-details",
    title: "Cached public event without venue details",
    venue: {
      address: "100 Public Street",
      floor: null,
      name: "Public room",
      room: null,
    },
  };
}

function seededEdgeCache(initialBody) {
  const puts = [];
  return {
    cache: {
      async match() {
        return new Response(initialBody, {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      },
      async put(request, response) {
        puts.push({
          body: await response.text(),
          contentType: response.headers.get("content-type"),
          url: request.url,
        });
      },
    },
    puts,
  };
}

function d1ForbiddenDatabase() {
  return {
    prepare() {
      throw new Error("A valid edge snapshot must bypass D1 entirely.");
    },
  };
}

async function behaviorDatabase(t) {
  const database = new SqliteD1TestDatabase(await generatedMigrationSql());
  t.after(() => database.close());
  for (const [id, slug] of [
    [ORGANIZATION_ID, "events-snapshot-cache"],
    [OTHER_ORGANIZATION_ID, "events-snapshot-cache-other"],
  ]) {
    database.sqlite
      .prepare(
        `INSERT OR IGNORE INTO organizations (id, name, slug, timezone)
         VALUES (?, ?, ?, 'America/Vancouver')`,
      )
      .run(id, `Events snapshot ${slug}`, slug);
  }
  return { database };
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

function countUnifiedPublicEventProjections(database) {
  let projectionCount = 0;
  return Object.freeze({
    count: () => projectionCount,
    database: {
      prepare(sql) {
        return wrap(database.prepare(sql), sql, () => {
          projectionCount += 1;
        });
      },
    },
  });
}

function failUnifiedPublicEventProjections(database) {
  return {
    prepare(sql) {
      return wrap(database.prepare(sql), sql, () => {
        throw new Error("Synthetic unified public-event projection failure");
      });
    },
  };
}

function wrap(statement, sql, onUnifiedProjection) {
  return {
    bind(...values) {
      return wrap(statement.bind(...values), sql, onUnifiedProjection);
    },
    first(...args) {
      beforeExecution();
      return statement.first(...args);
    },
    all(...args) {
      beforeExecution();
      return statement.all(...args);
    },
    run(...args) {
      beforeExecution();
      return statement.run(...args);
    },
  };

  function beforeExecution() {
    if (/\bpublic_events\s+AS\s*\(/u.test(sql)) {
      onUnifiedProjection();
    }
  }
}

function snapshotCount(database) {
  return Number(
    database.sqlite
      .prepare("SELECT count(*) AS count FROM public_event_calendar_snapshots")
      .get().count,
  );
}

function readSnapshot(database, input) {
  const key = publicEventsSnapshotCacheKey(input);
  const row = database.sqlite
    .prepare(
      `SELECT snapshot_json, expires_at, created_at, updated_at
       FROM public_event_calendar_snapshots
       WHERE cache_key = ?
         AND organization_id = ?`,
    )
    .get(
      key,
      input.organizationId,
    );
  assert.ok(row, "the normalized snapshot row must exist");
  return row;
}
