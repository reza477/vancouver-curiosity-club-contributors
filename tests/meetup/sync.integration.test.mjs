import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  configureMeetupCalendarSource,
  getMeetupConnectionState,
  listPublicMeetupCalendar,
  refreshMeetupCalendarSource,
} from "../../lib/server/meetup/index.ts";
import { listUpcomingPublicEvents } from "../../lib/server/public/events.ts";
import { trustedIdentityFromSites } from "../../lib/server/auth/index.ts";
import {
  safeErrorResponse,
  writeSafeLog,
} from "../../lib/validation/server-observability.ts";
import { toMeetupUiState } from "../../app/organizer/meetup/model.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const OWNER_EMAIL = "owner@example.com";
const OWNER_IDENTITY = trustedIdentityFromSites({
  email: OWNER_EMAIL,
  displayName: "Reza",
});
const ORGANIZATION_ID = "org_vcc";
const FEED_A =
  "https://www.meetup.com/vancouver-curiosity-club/events/ical/";
const FEED_B =
  "https://www.meetup.com/vancouver-ideas-club/events/ical/";

function loadGeneratedMigrations() {
  const migrationDirectory = join(process.cwd(), "drizzle");
  const migrations = readdirSync(migrationDirectory)
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort();
  assert.ok(migrations.length > 0, "generated migrations must exist");
  return migrations
    .map((name) => readFileSync(join(migrationDirectory, name), "utf8"))
    .join("\n");
}

function loadGeneratedMigration(name) {
  return readFileSync(join(process.cwd(), "drizzle", name), "utf8");
}

function createDatabase({ clubs = ["club_a"] } = {}) {
  const database = new SqliteD1TestDatabase(loadGeneratedMigrations());
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile_owner', 'email:${OWNER_EMAIL}', '${OWNER_EMAIL}', 'Reza',
      'active', 1, 1
    );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      owner_bootstrap_claimed_by_profile_id, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      '${ORGANIZATION_ID}', 'Vancouver Curiosity and Education Society',
      'vancouver-curiosity-and-education-society', 'America/Vancouver', 1,
      'profile_owner', 'profile_owner', 1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership_owner', '${ORGANIZATION_ID}', 'profile_owner',
      '${OWNER_EMAIL}', 'owner', 'active', 'profile_owner', 1, 1
    );
    ${clubs
      .map(
        (clubId, index) => `
          INSERT INTO clubs (
            id, organization_id, name, slug, created_by_profile_id,
            created_at, updated_at
          ) VALUES (
            '${clubId}', '${ORGANIZATION_ID}', 'Club ${index + 1}',
            'club-${index + 1}', 'profile_owner', 1, 1
          );
        `,
      )
      .join("\n")}
  `);
  return database;
}

function meetupEvent({
  description = "PRIVATE_DESCRIPTION_SENTINEL",
  end = "20280311T050000Z",
  eventId = "1001",
  groupSlug = "vancouver-curiosity-club",
  lastModified = "20260724T020000Z",
  location = "PRIVATE_LOCATION_SENTINEL",
  sequence = 1,
  start = "20280311T030000Z",
  status = "CONFIRMED",
  title = "A Curious Evening",
  uid = "shared-event@meetup.com",
} = {}) {
  return `BEGIN:VEVENT
UID:${uid}
DTSTART:${start}
DTEND:${end}
SUMMARY:${title}
DESCRIPTION:${description}
LOCATION:${location}
URL:https://www.meetup.com/${groupSlug}/events/${eventId}/
STATUS:${status}
SEQUENCE:${sequence}
LAST-MODIFIED:${lastModified}
END:VEVENT`;
}

function calendar(...events) {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Meetup//Official calendar export//EN
METHOD:PUBLISH
${events.join("\n")}
END:VCALENDAR`;
}

function calendarResponse(body, { etag = null } = {}) {
  const headers = new Headers({
    "content-type": "text/calendar; charset=utf-8",
  });
  if (etag) headers.set("etag", etag);
  return new Response(body, { status: 200, headers });
}

function sequenceFetcher(responses) {
  let index = 0;
  return async () => {
    const selected = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return typeof selected === "function"
      ? selected()
      : calendarResponse(selected);
  };
}

function feedAwareFetcher(feeds) {
  return async (url) => {
    const body = feeds.get(String(url));
    assert.ok(body, `unexpected feed URL: ${String(url)}`);
    return calendarResponse(body);
  };
}

function countingDatabase(database) {
  let queryCount = 0;
  return {
    prepare(sql) {
      queryCount += 1;
      return database.prepare(sql);
    },
    async batch(statements) {
      return database.batch(statements);
    },
    count() {
      return queryCount;
    },
    reset() {
      queryCount = 0;
    },
  };
}

async function configure(database, clubId, feedUrl = FEED_A, now = 1_000) {
  return configureMeetupCalendarSource(
    database,
    OWNER_IDENTITY,
    { clubId, feedUrl },
    now,
  );
}

async function refresh(
  database,
  clubId,
  fetcher,
  nowUtcMs = 2_000,
  extra = {},
) {
  return refreshMeetupCalendarSource(database, OWNER_IDENTITY, {
    clubId,
    fetcher,
    nowUtcMs,
    clock: () => nowUtcMs,
    ...extra,
  });
}

test("isolates the same external UID across two official club feeds", async (t) => {
  const database = createDatabase({ clubs: ["club_a", "club_b"] });
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);
  await configure(database, "club_b", FEED_B, 1_001);

  const fetcher = feedAwareFetcher(
    new Map([
      [
        FEED_A,
        calendar(
          meetupEvent({
            eventId: "1001",
            groupSlug: "vancouver-curiosity-club",
            start: "20280311T030000Z",
            end: "20280311T050000Z",
            title: "Club A Event",
          }),
        ),
      ],
      [
        FEED_B,
        calendar(
          meetupEvent({
            eventId: "2001",
            groupSlug: "vancouver-ideas-club",
            start: "20280312T030000Z",
            end: "20280312T050000Z",
            title: "Club B Event",
          }),
        ),
      ],
    ]),
  );

  assert.equal(
    (await refresh(database, "club_a", fetcher, 2_000)).outcome,
    "completed",
  );
  assert.equal(
    (await refresh(database, "club_b", fetcher, 3_000)).outcome,
    "completed",
  );

  const events = await database
    .prepare(
      `SELECT title, club_id
       FROM events
       WHERE deleted_at IS NULL
       ORDER BY title`,
    )
    .all();
  assert.deepEqual(events.results.map((row) => ({ ...row })), [
    { title: "Club A Event", club_id: "club_a" },
    { title: "Club B Event", club_id: "club_b" },
  ]);
  const links = await database
    .prepare(
      `SELECT count(*) AS count,
              count(DISTINCT sync_source_id) AS source_count,
              count(DISTINCT entity_id) AS event_count
       FROM external_source_links
       WHERE source_type = 'meetup_ics'
         AND deleted_at IS NULL`,
    )
    .first();
  assert.deepEqual({ ...links }, {
    count: 2,
    source_count: 2,
    event_count: 2,
  });
});

test("generated generation migration preserves a source and safely clears legacy partial state", async (t) => {
  const database = new SqliteD1TestDatabase(
    [
      "0000_remarkable_mordo.sql",
      "0001_outgoing_madelyne_pryor.sql",
      "0002_warm_yellowjacket.sql",
    ]
      .map(loadGeneratedMigration)
      .join("\n"),
  );
  t.after(() => database.close());
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile_owner', 'email:${OWNER_EMAIL}', '${OWNER_EMAIL}', 'Reza',
      'active', 1, 1
    );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      owner_bootstrap_claimed_by_profile_id, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      '${ORGANIZATION_ID}', 'Vancouver Curiosity and Education Society',
      'vancouver-curiosity-and-education-society', 'America/Vancouver', 1,
      'profile_owner', 'profile_owner', 1, 1
    );
    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'club_a', '${ORGANIZATION_ID}', 'Club 1', 'club-1',
      'profile_owner', 1, 1
    );
    INSERT INTO sync_sources (
      id, organization_id, club_id, source_type, source_url,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'source_before_cursor', '${ORGANIZATION_ID}', 'club_a',
      'meetup_ics', '${FEED_A}', 'profile_owner', 'profile_owner', 1, 1
    );
  `);

  database.exec(loadGeneratedMigration("0003_amusing_pyro.sql"));
  database.exec(loadGeneratedMigration("0004_milky_fallen_one.sql"));
  database.exec(`
    UPDATE sync_sources
    SET pending_snapshot_hash = '${"a".repeat(64)}',
        pending_cursor = 3
    WHERE id = 'source_before_cursor';
  `);
  database.exec(loadGeneratedMigration("0005_dashing_ronan.sql"));
  const source = await database
    .prepare(
      `SELECT id, source_url, active_generation_id, pending_generation_id,
              pending_snapshot_hash, pending_cursor
       FROM sync_sources`,
    )
    .first();
  assert.deepEqual({ ...source }, {
    id: "source_before_cursor",
    source_url: FEED_A,
    active_generation_id: null,
    pending_generation_id: null,
    pending_snapshot_hash: null,
    pending_cursor: null,
  });
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('meetup_sync_generations', 'meetup_event_snapshots')`,
      )
      .first("count"),
    2,
  );
});

test("same-source configuration is idempotent and replacement leaves one active source", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());

  const firstState = await configure(database, "club_a", FEED_A, 1_000);
  const first = await database
    .prepare(
      `SELECT id, source_url, created_at, updated_at
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  const repeatedState = await configure(
    database,
    "club_a",
    FEED_A,
    2_000,
  );
  const repeated = await database
    .prepare(
      `SELECT id, source_url, created_at, updated_at
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();

  assert.deepEqual(repeated, first);
  assert.deepEqual(repeatedState, firstState);
  assert.equal(JSON.stringify(repeatedState).includes(FEED_A), false);

  await configure(database, "club_a", FEED_B, 3_000);
  const replacement = await database
    .prepare(
      `SELECT id, source_url
       FROM sync_sources
       WHERE club_id = 'club_a'
         AND deleted_at IS NULL`,
    )
    .first();
  assert.notEqual(replacement.id, first.id);
  assert.equal(replacement.source_url, FEED_B);
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM sync_sources
         WHERE club_id = 'club_a'
           AND deleted_at IS NULL`,
      )
      .first("count"),
    1,
  );
});

test("auto-assigns distinct official feeds across multiple club-scoped sources", async (t) => {
  const database = createDatabase({ clubs: ["club_a"] });
  t.after(() => database.close());

  await configureMeetupCalendarSource(
    database,
    OWNER_IDENTITY,
    { feedUrl: FEED_A },
    1_000,
  );
  const state = await configureMeetupCalendarSource(
    database,
    OWNER_IDENTITY,
    { feedUrl: FEED_B },
    2_000,
  );

  const sources = await database
    .prepare(
      `SELECT club_id, source_url
       FROM sync_sources
       WHERE organization_id = ?
         AND source_type = 'meetup_ics'
         AND deleted_at IS NULL
       ORDER BY source_url`,
    )
    .bind(ORGANIZATION_ID)
    .all();
  assert.equal(sources.results.length, 2);
  assert.equal(
    new Set(sources.results.map((row) => row.club_id)).size,
    2,
  );
  assert.deepEqual(
    sources.results.map((row) => row.source_url).sort(),
    [FEED_A, FEED_B].sort(),
  );
  assert.equal(JSON.stringify(state).includes(FEED_A), false);
  assert.equal(JSON.stringify(state).includes(FEED_B), false);
});

test("feed URLs and tokens stay out of client DTOs and safe logs", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const privateFeed =
    "https://www.meetup.com/vancouver-curiosity-club/events/ical/";
  const privateToken = "MEETUP_PRIVATE_TOKEN_SENTINEL";
  const connection = await configure(
    database,
    "club_a",
    privateFeed,
    1_000,
  );
  const state = await getMeetupConnectionState(
    database,
    OWNER_IDENTITY,
    1_001,
  );
  const publicCalendar = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 1_001,
  });
  for (const dto of [connection, state, publicCalendar]) {
    const serialized = JSON.stringify(dto);
    assert.equal(serialized.includes(privateFeed), false);
    assert.equal(serialized.includes("sourceUrl"), false);
    assert.equal(serialized.includes("source_url"), false);
    assert.equal(serialized.includes(privateToken), false);
  }
  const clientState = toMeetupUiState({
    ...state,
    sourceUrl: `${privateFeed}?token=${privateToken}`,
    source_url: `${privateFeed}?token=${privateToken}`,
  });
  assert.equal(JSON.stringify(clientState).includes(privateFeed), false);
  assert.equal(JSON.stringify(clientState).includes(privateToken), false);

  const lines = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (line) => lines.push(String(line));
  console.error = (line) => lines.push(String(line));
  try {
    writeSafeLog("warn", privateFeed, {
      operation: "meetup_sync",
      route: `/api/organizer/meetup/connect?feed=${encodeURIComponent(
        privateFeed,
      )}&token=${privateToken}`,
      status: 400,
    });
    const response = safeErrorResponse(
      new Error(`${privateFeed}?token=${privateToken}`),
      {
        route: `/api/organizer/meetup/connect?token=${privateToken}`,
      },
    );
    assert.equal(
      (await response.text()).includes(privateToken),
      false,
    );
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
  const serializedLogs = lines.join("\n");
  assert.equal(serializedLogs.includes(privateFeed), false);
  assert.equal(serializedLogs.includes(privateToken), false);
});

test("stale replays cannot undo a newer cancellation, which stays out of upcoming", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);

  const fetcher = sequenceFetcher([
    calendar(
      meetupEvent({
        sequence: 5,
        status: "CONFIRMED",
        title: "Monotonic Event",
      }),
    ),
    calendar(
      meetupEvent({
        lastModified: "20260724T030000Z",
        sequence: 4,
        status: "CANCELLED",
        title: "Stale Cancellation",
      }),
    ),
    calendar(
      meetupEvent({
        lastModified: "20260724T040000Z",
        sequence: 6,
        status: "CANCELLED",
        title: "Current Cancellation",
      }),
    ),
    calendar(
      meetupEvent({
        lastModified: "20260724T050000Z",
        sequence: 5,
        status: "CONFIRMED",
        title: "Stale Resurrection",
      }),
    ),
  ]);

  const created = await refresh(database, "club_a", fetcher, 2_000);
  assert.equal(created.counts.created, 1);

  const staleCancellation = await refresh(
    database,
    "club_a",
    fetcher,
    3_000,
  );
  assert.equal(staleCancellation.counts.cancelled, 0);
  assert.deepEqual(
    {
      ...(await database
      .prepare(`SELECT title, status FROM events`)
      .first()),
    },
    { title: "Monotonic Event", status: "confirmed" },
  );

  const cancelled = await refresh(database, "club_a", fetcher, 4_000);
  assert.equal(cancelled.counts.cancelled, 1);
  assert.deepEqual(
    {
      ...(await database
      .prepare(`SELECT title, status FROM events`)
      .first()),
    },
    { title: "Current Cancellation", status: "cancelled" },
  );

  await refresh(database, "club_a", fetcher, 5_000);
  assert.deepEqual(
    {
      ...(await database
      .prepare(`SELECT title, status FROM events`)
      .first()),
    },
    { title: "Current Cancellation", status: "cancelled" },
  );

  const publicCalendar = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 5_001,
  });
  assert.deepEqual(publicCalendar.events, []);
});

test("imported description and location remain absent from persistence and public DTOs", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);

  const description = "PRIVATE_DESCRIPTION_SENTINEL_93a74";
  const location = "PRIVATE_LOCATION_SENTINEL_29bc1";
  const result = await refresh(
    database,
    "club_a",
    sequenceFetcher([
      calendar(meetupEvent({ description, location })),
    ]),
    2_000,
  );
  assert.equal(result.outcome, "completed");

  const eventRow = await database
    .prepare(
      `SELECT summary, description, venue_id, private_notes,
              private_meeting_details
       FROM events`,
    )
    .first();
  assert.deepEqual({ ...eventRow }, {
    summary: null,
    description: null,
    venue_id: null,
    private_notes: null,
    private_meeting_details: null,
  });

  const durablePayloads = await database
    .prepare(
      `SELECT source_payload_json, normalized_payload_json
       FROM import_rows`,
    )
    .all();
  const serializedRows = JSON.stringify(durablePayloads.results);
  assert.equal(serializedRows.includes(description), false);
  assert.equal(serializedRows.includes(location), false);

  const publicCalendar = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 2_001,
  });
  assert.equal(publicCalendar.events.length, 1);
  assert.equal(publicCalendar.events[0].description, null);
  assert.equal(publicCalendar.events[0].venue, null);
  const serializedPublic = JSON.stringify(publicCalendar);
  assert.equal(serializedPublic.includes(description), false);
  assert.equal(serializedPublic.includes(location), false);
});

test("a three-event refresh stays within the per-invocation D1 query budget", async (t) => {
  const innerDatabase = createDatabase();
  t.after(() => innerDatabase.close());
  const database = countingDatabase(innerDatabase);
  await configure(database, "club_a", FEED_A, 1_000);
  database.reset();

  const body = calendar(
    meetupEvent({
      uid: "query-1@meetup.com",
      eventId: "3001",
      title: "Query One",
      start: "20280311T030000Z",
      end: "20280311T040000Z",
    }),
    meetupEvent({
      uid: "query-2@meetup.com",
      eventId: "3002",
      title: "Query Two",
      start: "20280312T030000Z",
      end: "20280312T040000Z",
    }),
    meetupEvent({
      uid: "query-3@meetup.com",
      eventId: "3003",
      title: "Query Three",
      start: "20280313T030000Z",
      end: "20280313T040000Z",
    }),
  );
  const result = await refresh(
    database,
    "club_a",
    sequenceFetcher([body]),
    2_000,
  );

  assert.equal(result.outcome, "completed");
  assert.equal(result.counts.created, 3);
  assert.ok(
    database.count() <= 50,
    `refresh prepared ${database.count()} D1 statements; expected <= 50`,
  );
});

test("three conflict rejections stay within the per-invocation D1 query budget", async (t) => {
  const innerDatabase = createDatabase();
  t.after(() => innerDatabase.close());
  await configure(innerDatabase, "club_a", FEED_A, 1_000);
  innerDatabase.exec(`
    INSERT INTO events (
      id, organization_id, club_id, title, slug, status, visibility,
      time_kind, starts_at_utc, ends_at_utc, timezone,
      organizer_scope_json, schedule_version, schedule_review_state,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'blocking_event', '${ORGANIZATION_ID}', 'club_a',
      'Blocking event', 'blocking-event', 'confirmed', 'private',
      'timed', 1835319600000, 1835326800000, 'America/Vancouver',
      '[]', 1, 'unreviewed', 'profile_owner', 'profile_owner', 1, 1
    );
  `);
  const database = countingDatabase(innerDatabase);
  database.reset();

  const body = calendar(
    ...[1, 2, 3].map((number) =>
      meetupEvent({
        uid: `conflict-${number}@meetup.com`,
        eventId: `500${number}`,
        title: `Conflict ${number}`,
        start: "20280228T030000Z",
        end: "20280228T050000Z",
      }),
    ),
  );
  const result = await refresh(
    database,
    "club_a",
    sequenceFetcher([body]),
    2_000,
  );

  assert.equal(result.outcome, "completed");
  assert.equal(result.counts.created, 0);
  assert.equal(result.counts.rejected, 3);
  assert.ok(
    database.count() <= 50,
    `conflict path prepared ${database.count()} D1 statements; expected <= 50`,
  );
  assert.equal(
    await innerDatabase
      .prepare(`SELECT count(*) AS count FROM events`)
      .first("count"),
    1,
  );
});

test("resumes a stable feed snapshot in bounded three-row chunks", async (t) => {
  const innerDatabase = createDatabase();
  t.after(() => innerDatabase.close());
  const database = countingDatabase(innerDatabase);
  await configure(database, "club_a", FEED_A, 1_000);

  const body = calendar(
    meetupEvent({
      uid: "chunk-1@meetup.com",
      eventId: "4001",
      title: "Chunk One",
      start: "20280401T030000Z",
      end: "20280401T040000Z",
    }),
    meetupEvent({
      uid: "chunk-2@meetup.com",
      eventId: "4002",
      title: "Chunk Two",
      start: "20280402T030000Z",
      end: "20280402T040000Z",
    }),
    meetupEvent({
      uid: "chunk-3@meetup.com",
      eventId: "4003",
      title: "Chunk Three",
      start: "20280403T030000Z",
      end: "20280403T040000Z",
    }),
    meetupEvent({
      uid: "chunk-4@meetup.com",
      eventId: "4004",
      title: "Chunk Four",
      start: "20280404T030000Z",
      end: "20280404T040000Z",
    }),
  );
  const fetcher = sequenceFetcher([body, body]);

  database.reset();
  const partial = await refresh(
    database,
    "club_a",
    fetcher,
    2_000,
  );
  const firstQueryCount = database.count();
  assert.equal(partial.outcome, "partial");
  assert.equal(partial.state.status, "partial");
  assert.equal(partial.counts.created, 3);
  assert.ok(
    firstQueryCount <= 50,
    `first chunk prepared ${firstQueryCount} D1 statements; expected <= 50`,
  );
  assert.equal(
    await innerDatabase
      .prepare(`SELECT count(*) AS count FROM events`)
      .first("count"),
    3,
  );
  const pending = await innerDatabase
    .prepare(
      `SELECT active_generation_id, pending_generation_id, pending_cursor,
              pending_snapshot_hash, last_success_at
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(pending.active_generation_id, null);
  assert.equal(typeof pending.pending_generation_id, "string");
  assert.equal(pending.pending_cursor, 3);
  assert.equal(typeof pending.pending_snapshot_hash, "string");
  assert.equal(pending.pending_snapshot_hash.length, 64);
  assert.equal(pending.last_success_at, null);
  assert.deepEqual(
    {
      ...(await innerDatabase
        .prepare(
          `SELECT state, expected_item_count, processed_item_count,
                  rejected_item_count, removed_count, published_at,
                  previous_generation_id
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(pending.pending_generation_id)
        .first()),
    },
    {
      state: "staging",
      expected_item_count: 4,
      processed_item_count: 3,
      rejected_item_count: 0,
      removed_count: 0,
      published_at: null,
      previous_generation_id: null,
    },
  );

  const duringPartial = await listPublicMeetupCalendar(innerDatabase, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 2_001,
  });
  assert.equal(duringPartial.sync.status, "partial");
  assert.deepEqual(duringPartial.events, []);

  database.reset();
  const completed = await refresh(
    database,
    "club_a",
    fetcher,
    3_000,
  );
  const secondQueryCount = database.count();
  assert.equal(completed.outcome, "completed");
  assert.equal(completed.counts.created, 1);
  assert.ok(
    secondQueryCount <= 50,
    `resume chunk prepared ${secondQueryCount} D1 statements; expected <= 50`,
  );
  assert.equal(
    await innerDatabase
      .prepare(`SELECT count(*) AS count FROM events`)
      .first("count"),
    4,
  );
  const finished = await innerDatabase
    .prepare(
      `SELECT active_generation_id, pending_generation_id, pending_cursor,
              pending_snapshot_hash, last_success_at
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(finished.active_generation_id, pending.pending_generation_id);
  assert.equal(finished.pending_generation_id, null);
  assert.equal(finished.pending_cursor, null);
  assert.equal(finished.pending_snapshot_hash, null);
  assert.equal(finished.last_success_at, 3_000);
  assert.deepEqual(
    {
      ...(await innerDatabase
        .prepare(
          `SELECT state, expected_item_count, processed_item_count,
                  rejected_item_count, removed_count, published_at,
                  previous_generation_id
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(finished.active_generation_id)
        .first()),
    },
    {
      state: "published",
      expected_item_count: 4,
      processed_item_count: 4,
      rejected_item_count: 0,
      removed_count: 0,
      published_at: 3_000,
      previous_generation_id: null,
    },
  );

  const publicCalendar = await listPublicMeetupCalendar(innerDatabase, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 3_001,
  });
  assert.equal(publicCalendar.sync.status, "current");
  assert.equal(publicCalendar.events.length, 4);
});

test("disabled sources pause publication as well as refresh", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);
  const published = await refresh(
    database,
    "club_a",
    sequenceFetcher([
      calendar(
        meetupEvent({
          uid: "disabled-source@meetup.com",
          eventId: "7001",
          title: "Paused Source Event",
        }),
      ),
    ]),
    2_000,
  );
  assert.equal(published.outcome, "completed");
  database.exec(`
    UPDATE sync_sources
    SET enabled = 0
    WHERE organization_id = '${ORGANIZATION_ID}'
      AND club_id = 'club_a';
  `);

  const publicCalendar = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 2_001,
  });
  assert.equal(publicCalendar.sync.status, "disabled");
  assert.deepEqual(publicCalendar.events, []);
});

test("keeps the last completed generation public when a later chunk fails", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);

  const publishedFeed = calendar(
    meetupEvent({
      uid: "generation-baseline@meetup.com",
      eventId: "8101",
      title: "Published Baseline",
      start: "20280501T030000Z",
      end: "20280501T040000Z",
    }),
    meetupEvent({
      uid: "generation-cancel-baseline@meetup.com",
      eventId: "8100",
      title: "Published Until Finalized",
      start: "20280430T030000Z",
      end: "20280430T040000Z",
    }),
  );
  const published = await refresh(
    database,
    "club_a",
    sequenceFetcher([publishedFeed]),
    2_000,
  );
  assert.equal(published.outcome, "completed");

  database.exec(`
    INSERT INTO events (
      id, organization_id, club_id, title, slug, status, visibility,
      time_kind, starts_at_utc, ends_at_utc, timezone,
      organizer_scope_json, schedule_version, schedule_review_state,
      published_at, created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'manual_projection_sentinel', '${ORGANIZATION_ID}', 'club_a',
      'Manual Projection Sentinel', 'manual-projection-sentinel',
      'confirmed', 'public', 'timed',
      ${Date.parse("2028-05-10T03:00:00Z")},
      ${Date.parse("2028-05-10T04:00:00Z")}, 'America/Vancouver',
      '[]', 1, 'unreviewed', 2050, 'profile_owner', 'profile_owner',
      2050, 2050
    );

    UPDATE events
    SET summary = 'OWNER SUMMARY SENTINEL',
        description = 'OWNER DESCRIPTION SENTINEL',
        schedule_version = schedule_version + 1
    WHERE title = 'Published Baseline';

    UPDATE events
    SET visibility = 'private',
        published_at = NULL,
        schedule_version = schedule_version + 1
    WHERE title = 'Published Until Finalized';
  `);

  const sourceAfterPublished = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(typeof sourceAfterPublished.active_generation_id, "string");
  assert.equal(sourceAfterPublished.pending_generation_id, null);
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT state, previous_generation_id, expected_item_count,
                  processed_item_count, rejected_item_count, removed_count,
                  published_at
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(sourceAfterPublished.active_generation_id)
        .first()),
    },
    {
      state: "published",
      previous_generation_id: null,
      expected_item_count: 2,
      processed_item_count: 2,
      rejected_item_count: 0,
      removed_count: 0,
      published_at: 2_000,
    },
  );

  const publicBefore = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 2_001,
  });
  assert.deepEqual(
    publicBefore.events.map((event) => event.title),
    ["Published Baseline"],
  );
  assert.equal(publicBefore.events[0]?.summary, "OWNER SUMMARY SENTINEL");
  assert.equal(
    publicBefore.events[0]?.description,
    "OWNER DESCRIPTION SENTINEL",
  );
  const serializedPublishedEvents = JSON.stringify(publicBefore.events);
  const generalBefore = await listUpcomingPublicEvents(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
  });
  assert.deepEqual(
    generalBefore.map((event) => event.title),
    ["Manual Projection Sentinel"],
    "the general/manual projection must exclude every Meetup-source-linked event",
  );
  const serializedGeneralEvents = JSON.stringify(generalBefore);

  const changedFourRowFeed = calendar(
    meetupEvent({
      uid: "generation-baseline@meetup.com",
      eventId: "8101",
      lastModified: "20260724T030000Z",
      sequence: 2,
      title: "UNCOMMITTED UPDATE SENTINEL",
      start: "20280501T030000Z",
      end: "20280501T040000Z",
    }),
    meetupEvent({
      uid: "generation-cancel-baseline@meetup.com",
      eventId: "8100",
      lastModified: "20260724T030000Z",
      sequence: 2,
      status: "CANCELLED",
      title: "Published Until Finalized",
      start: "20280430T030000Z",
      end: "20280430T040000Z",
    }),
    meetupEvent({
      uid: "generation-new-2@meetup.com",
      eventId: "8102",
      title: "UNCOMMITTED NEW TWO",
      start: "20280502T030000Z",
      end: "20280502T040000Z",
    }),
    meetupEvent({
      uid: "generation-new-3@meetup.com",
      eventId: "8103",
      title: "UNCOMMITTED NEW THREE",
      start: "20280503T030000Z",
      end: "20280503T040000Z",
    }),
  );
  const interruptedFetcher = sequenceFetcher([
    changedFourRowFeed,
    () => {
      throw new Error("later chunk fetch failed");
    },
  ]);

  const partial = await refresh(
    database,
    "club_a",
    interruptedFetcher,
    3_000,
  );
  assert.equal(partial.outcome, "partial");
  assert.equal(partial.counts.cancelled, 1);
  assert.equal(partial.counts.created, 1);
  assert.equal(partial.counts.updated, 2);

  const sourceDuringPartial = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(
    sourceDuringPartial.active_generation_id,
    sourceAfterPublished.active_generation_id,
  );
  assert.equal(typeof sourceDuringPartial.pending_generation_id, "string");
  assert.notEqual(
    sourceDuringPartial.pending_generation_id,
    sourceDuringPartial.active_generation_id,
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT state, previous_generation_id, expected_item_count,
                  processed_item_count, rejected_item_count, removed_count,
                  published_at
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(sourceDuringPartial.pending_generation_id)
        .first()),
    },
    {
      state: "staging",
      previous_generation_id: sourceAfterPublished.active_generation_id,
      expected_item_count: 4,
      processed_item_count: 3,
      rejected_item_count: 0,
      removed_count: 0,
      published_at: null,
    },
  );

  const publicDuringPartial = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 3_001,
  });
  assert.equal(
    JSON.stringify(publicDuringPartial.events),
    serializedPublishedEvents,
    "a partial generation must not change the last completed public snapshot",
  );
  const generalDuringPartial = await listUpcomingPublicEvents(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
  });
  assert.equal(
    JSON.stringify(generalDuringPartial),
    serializedGeneralEvents,
    "the general/manual projection must not expose source-backed staged rows",
  );
  assert.equal(
    JSON.stringify(generalDuringPartial).includes("UNCOMMITTED"),
    false,
  );
  const baseRowsDuringPartial = await database
    .prepare(
      `SELECT title, summary, description, visibility, published_at
       FROM events
       WHERE title IN (
         'UNCOMMITTED UPDATE SENTINEL',
         'Published Until Finalized'
       )
       ORDER BY title`,
    )
    .all();
  assert.deepEqual(
    baseRowsDuringPartial.results.map((row) => ({ ...row })),
    [
      {
        title: "Published Until Finalized",
        summary: null,
        description: null,
        visibility: "private",
        published_at: null,
      },
      {
        title: "UNCOMMITTED UPDATE SENTINEL",
        summary: "OWNER SUMMARY SENTINEL",
        description: "OWNER DESCRIPTION SENTINEL",
        visibility: "public",
        published_at: 2_000,
      },
    ],
    "pending writes must preserve owner-managed enrichment and publication state",
  );

  const failed = await refresh(
    database,
    "club_a",
    interruptedFetcher,
    4_000,
  );
  assert.equal(failed.outcome, "failed");

  const sourceAfterFailure = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id, last_error_code
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(
    sourceAfterFailure.active_generation_id,
    sourceAfterPublished.active_generation_id,
  );
  assert.equal(
    sourceAfterFailure.pending_generation_id,
    sourceDuringPartial.pending_generation_id,
  );
  assert.equal(typeof sourceAfterFailure.last_error_code, "string");
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT state, previous_generation_id, expected_item_count,
                  processed_item_count, rejected_item_count, removed_count,
                  published_at
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(sourceAfterFailure.pending_generation_id)
        .first()),
    },
    {
      state: "staging",
      previous_generation_id: sourceAfterPublished.active_generation_id,
      expected_item_count: 4,
      processed_item_count: 3,
      rejected_item_count: 0,
      removed_count: 0,
      published_at: null,
    },
    "a failed continuation must not publish or advance the pending generation",
  );

  const publicAfterFailure = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 4_001,
  });
  assert.equal(
    JSON.stringify(publicAfterFailure.events),
    serializedPublishedEvents,
    "a failed generation must leave the prior public snapshot byte-for-byte intact",
  );
  const generalAfterFailure = await listUpcomingPublicEvents(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
  });
  assert.equal(
    JSON.stringify(generalAfterFailure),
    serializedGeneralEvents,
    "a failed generation must not leak through the general/manual projection",
  );
  const baseRowsAfterFailure = await database
    .prepare(
      `SELECT title, summary, description, visibility, published_at
       FROM events
       WHERE title IN (
         'UNCOMMITTED UPDATE SENTINEL',
         'Published Until Finalized'
       )
       ORDER BY title`,
    )
    .all();
  assert.deepEqual(
    baseRowsAfterFailure.results.map((row) => ({ ...row })),
    baseRowsDuringPartial.results.map((row) => ({ ...row })),
    "a failed continuation must not mutate owner-managed base fields",
  );
});

test("an unsolicited 304 cannot finalize a pending generation", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);
  await refresh(
    database,
    "club_a",
    sequenceFetcher([
      calendar(
        meetupEvent({
          uid: "not-modified-baseline@meetup.com",
          eventId: "8150",
          title: "Stable Before 304",
        }),
      ),
    ]),
    2_000,
  );
  const sourceBefore = await database
    .prepare(
      `SELECT active_generation_id
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  const changedFeed = calendar(
    ...[1, 2, 3, 4].map((number) =>
      meetupEvent({
        uid: `not-modified-${number}@meetup.com`,
        eventId: `815${number}`,
        title: `Pending 304 ${number}`,
        start: `2028050${number}T030000Z`,
        end: `2028050${number}T040000Z`,
      }),
    ),
  );
  let fetchCount = 0;
  const fetcher = async () => {
    fetchCount += 1;
    return fetchCount === 1
      ? calendarResponse(changedFeed)
      : new Response(null, { status: 304 });
  };
  assert.equal(
    (await refresh(database, "club_a", fetcher, 3_000)).outcome,
    "partial",
  );
  assert.equal(
    (await refresh(database, "club_a", fetcher, 4_000)).outcome,
    "failed",
  );
  const sourceAfter = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(sourceAfter.active_generation_id, sourceBefore.active_generation_id);
  assert.equal(typeof sourceAfter.pending_generation_id, "string");
  const publicCalendar = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 4_001,
  });
  assert.deepEqual(
    publicCalendar.events.map((event) => event.title),
    ["Stable Before 304"],
  );
});

test("reconciles disappeared future events only after source-scoped finalization and supports reappearance", async (t) => {
  const database = createDatabase({ clubs: ["club_a", "club_b"] });
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);
  await configure(database, "club_b", FEED_B, 1_001);

  const keepEvent = meetupEvent({
    uid: "reconcile-keep@meetup.com",
    eventId: "8201",
    title: "Keep Future Event",
    start: "20280601T030000Z",
    end: "20280601T040000Z",
  });
  const missingEvent = meetupEvent({
    uid: "reconcile-missing@meetup.com",
    eventId: "8202",
    title: "Missing Future Event",
    start: "20280602T030000Z",
    end: "20280602T040000Z",
  });
  const secondMissingEvent = meetupEvent({
    uid: "reconcile-missing-2@meetup.com",
    eventId: "8206",
    title: "Second Missing Future Event",
    start: "20280606T030000Z",
    end: "20280606T040000Z",
  });
  const initialA = await refresh(
    database,
    "club_a",
    sequenceFetcher([calendar(keepEvent, missingEvent, secondMissingEvent)]),
    2_000,
  );
  assert.equal(initialA.outcome, "completed");
  assert.equal(initialA.counts.created, 3);

  const sourceBEvent = meetupEvent({
    uid: "other-source@meetup.com",
    eventId: "9201",
    groupSlug: "vancouver-ideas-club",
    title: "Other Source Event",
    start: "20280610T030000Z",
    end: "20280610T040000Z",
  });
  const initialB = await refresh(
    database,
    "club_b",
    sequenceFetcher([calendar(sourceBEvent)]),
    2_100,
  );
  assert.equal(initialB.outcome, "completed");
  assert.equal(initialB.counts.created, 1);

  database.exec(`
    INSERT INTO events (
      id, organization_id, club_id, title, slug, status, visibility,
      time_kind, starts_at_utc, ends_at_utc, timezone,
      organizer_scope_json, schedule_version, schedule_review_state,
      published_at, created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'manual_event', '${ORGANIZATION_ID}', 'club_b',
      'Manual Event', 'manual-event', 'confirmed', 'public',
      'timed', ${Date.parse("2028-06-11T03:00:00Z")},
      ${Date.parse("2028-06-11T04:00:00Z")}, 'America/Vancouver',
      '[]', 1, 'unreviewed', 2200, 'profile_owner', 'profile_owner',
      2200, 2200
    );
  `);

  const missingBefore = await database
    .prepare(
      `SELECT id, status, visibility, published_at, deleted_at
       FROM events
       WHERE title = 'Missing Future Event'
         AND deleted_at IS NULL`,
    )
    .first();
  assert.ok(missingBefore);
  const secondMissingBefore = await database
    .prepare(
      `SELECT id, status, visibility, published_at, deleted_at
       FROM events
       WHERE title = 'Second Missing Future Event'
         AND deleted_at IS NULL`,
    )
    .first();
  assert.ok(secondMissingBefore);

  const protectedColumns = `
    id, organization_id, club_id, title, slug, status, visibility,
    time_kind, starts_at_utc, ends_at_utc, timezone, published_at,
    schedule_version, updated_at, deleted_at
  `;
  const otherSourceBefore = await database
    .prepare(
      `SELECT ${protectedColumns}
       FROM events
       WHERE title = 'Other Source Event'
         AND deleted_at IS NULL`,
    )
    .first();
  const manualBefore = await database
    .prepare(
      `SELECT ${protectedColumns}
       FROM events
       WHERE id = 'manual_event'`,
    )
    .first();
  assert.ok(otherSourceBefore);
  assert.ok(manualBefore);

  const newEventOne = meetupEvent({
    uid: "reconcile-new-1@meetup.com",
    eventId: "8203",
    title: "New Future Event One",
    start: "20280603T030000Z",
    end: "20280603T040000Z",
  });
  const newEventTwo = meetupEvent({
    uid: "reconcile-new-2@meetup.com",
    eventId: "8204",
    title: "New Future Event Two",
    start: "20280604T030000Z",
    end: "20280604T040000Z",
  });
  const newEventThree = meetupEvent({
    uid: "reconcile-new-3@meetup.com",
    eventId: "8205",
    title: "New Future Event Three",
    start: "20280605T030000Z",
    end: "20280605T040000Z",
  });
  const completedSnapshotWithoutMissing = calendar(
    keepEvent,
    newEventOne,
    newEventTwo,
    newEventThree,
  );
  const disappearanceFetcher = sequenceFetcher([
    completedSnapshotWithoutMissing,
    completedSnapshotWithoutMissing,
  ]);
  const sourceBeforeDisappearance = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(typeof sourceBeforeDisappearance.active_generation_id, "string");
  assert.equal(sourceBeforeDisappearance.pending_generation_id, null);

  const disappearancePartial = await refresh(
    database,
    "club_a",
    disappearanceFetcher,
    3_000,
  );
  assert.equal(disappearancePartial.outcome, "partial");
  assert.equal(disappearancePartial.counts.removed, 0);
  const sourceDuringDisappearance = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(
    sourceDuringDisappearance.active_generation_id,
    sourceBeforeDisappearance.active_generation_id,
  );
  assert.equal(typeof sourceDuringDisappearance.pending_generation_id, "string");
  assert.notEqual(
    sourceDuringDisappearance.pending_generation_id,
    sourceDuringDisappearance.active_generation_id,
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT state, previous_generation_id, expected_item_count,
                  processed_item_count, removed_count
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(sourceDuringDisappearance.pending_generation_id)
        .first()),
    },
    {
      state: "staging",
      previous_generation_id: sourceBeforeDisappearance.active_generation_id,
      expected_item_count: 4,
      processed_item_count: 3,
      removed_count: 0,
    },
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT status, visibility, published_at, deleted_at
           FROM events
           WHERE id = ?`,
        )
        .bind(missingBefore.id)
        .first()),
    },
    {
      status: "confirmed",
      visibility: "public",
      published_at: 2_000,
      deleted_at: null,
    },
    "an incomplete cursor must not reconcile a missing UID",
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT status, visibility, published_at, deleted_at
           FROM events
           WHERE id = ?`,
        )
        .bind(secondMissingBefore.id)
        .first()),
    },
    {
      status: "confirmed",
      visibility: "public",
      published_at: 2_000,
      deleted_at: null,
    },
    "an incomplete cursor must not reconcile any missing UID",
  );
  const publicDuringPartial = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 3_001,
  });
  assert.equal(
    publicDuringPartial.events.some(
      (event) => event.title === "Missing Future Event",
    ),
    true,
  );

  const disappearanceCompleted = await refresh(
    database,
    "club_a",
    disappearanceFetcher,
    4_000,
  );
  assert.equal(disappearanceCompleted.outcome, "completed");
  assert.equal(disappearanceCompleted.counts.removed, 2);

  const sourceAfterDisappearance = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(typeof sourceAfterDisappearance.active_generation_id, "string");
  assert.equal(
    sourceAfterDisappearance.active_generation_id,
    sourceDuringDisappearance.pending_generation_id,
  );
  assert.notEqual(
    sourceAfterDisappearance.active_generation_id,
    sourceBeforeDisappearance.active_generation_id,
  );
  assert.equal(sourceAfterDisappearance.pending_generation_id, null);
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT state, expected_item_count, processed_item_count,
                  rejected_item_count, removed_count, published_at
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(sourceAfterDisappearance.active_generation_id)
        .first()),
    },
    {
      state: "published",
      expected_item_count: 4,
      processed_item_count: 4,
      rejected_item_count: 0,
      removed_count: 2,
      published_at: 4_000,
    },
    "the published generation must durably record the exact reconciliation count",
  );

  const retiredMissing = await database
    .prepare(
      `SELECT status, visibility, published_at, deleted_at
       FROM events
       WHERE id = ?`,
    )
    .bind(missingBefore.id)
    .first();
  assert.deepEqual(
    {
      status: retiredMissing.status,
      visibility: retiredMissing.visibility,
      published_at: retiredMissing.published_at,
    },
    {
      status: "cancelled",
      visibility: "private",
      published_at: null,
    },
  );
  assert.equal(typeof retiredMissing.deleted_at, "number");
  const retiredSecondMissing = await database
    .prepare(
      `SELECT status, visibility, published_at, deleted_at
       FROM events
       WHERE id = ?`,
    )
    .bind(secondMissingBefore.id)
    .first();
  assert.deepEqual(
    {
      status: retiredSecondMissing.status,
      visibility: retiredSecondMissing.visibility,
      published_at: retiredSecondMissing.published_at,
    },
    {
      status: "cancelled",
      visibility: "private",
      published_at: null,
    },
  );
  assert.equal(typeof retiredSecondMissing.deleted_at, "number");

  const publicAfterDisappearance = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 4_001,
  });
  const titlesAfterDisappearance = publicAfterDisappearance.events.map(
    (event) => event.title,
  );
  assert.equal(titlesAfterDisappearance.includes("Missing Future Event"), false);
  assert.equal(
    titlesAfterDisappearance.includes("Second Missing Future Event"),
    false,
  );
  assert.equal(titlesAfterDisappearance.includes("Keep Future Event"), true);
  assert.equal(titlesAfterDisappearance.includes("Other Source Event"), true);
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT ${protectedColumns}
           FROM events
           WHERE title = 'Other Source Event'
             AND deleted_at IS NULL`,
        )
        .first()),
    },
    { ...otherSourceBefore },
    "reconciliation must not touch another Meetup source",
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT ${protectedColumns}
           FROM events
           WHERE id = 'manual_event'`,
        )
        .first()),
    },
    { ...manualBefore },
    "reconciliation must not touch a manually managed event",
  );

  const reappearedEvent = meetupEvent({
    uid: "reconcile-missing@meetup.com",
    eventId: "8202",
    lastModified: "20260724T040000Z",
    sequence: 2,
    title: "Missing Future Event",
    start: "20280602T030000Z",
    end: "20280602T040000Z",
  });
  const completedSnapshotWithReappearance = calendar(
    keepEvent,
    newEventOne,
    newEventTwo,
    reappearedEvent,
    newEventThree,
  );
  const reappearanceFetcher = sequenceFetcher([
    completedSnapshotWithReappearance,
    completedSnapshotWithReappearance,
  ]);

  const reappearancePartial = await refresh(
    database,
    "club_a",
    reappearanceFetcher,
    5_000,
  );
  assert.equal(reappearancePartial.outcome, "partial");
  assert.equal(reappearancePartial.counts.removed, 0);
  const publicBeforeReappearanceFinalizes =
    await listPublicMeetupCalendar(database, {
      organizationId: ORGANIZATION_ID,
      fromUtcMs: 0,
      todayDate: "2026-01-01",
      nowUtcMs: 5_001,
    });
  assert.equal(
    publicBeforeReappearanceFinalizes.events.some(
      (event) => event.title === "Missing Future Event",
    ),
    false,
  );

  const reappearanceCompleted = await refresh(
    database,
    "club_a",
    reappearanceFetcher,
    6_000,
  );
  assert.equal(reappearanceCompleted.outcome, "completed");
  assert.equal(reappearanceCompleted.counts.removed, 0);

  const publicAfterReappearance = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 6_001,
  });
  assert.equal(
    publicAfterReappearance.events.some(
      (event) => event.title === "Missing Future Event",
    ),
    true,
  );
  const activeReappearance = await database
    .prepare(
      `SELECT id, status, visibility, published_at, deleted_at
       FROM events
       WHERE title = 'Missing Future Event'
         AND deleted_at IS NULL`,
    )
    .first();
  assert.ok(activeReappearance);
  assert.equal(activeReappearance.status, "confirmed");
  assert.equal(activeReappearance.visibility, "public");
  assert.equal(typeof activeReappearance.published_at, "number");
  assert.equal(activeReappearance.deleted_at, null);
});

test("keeps a shared canonical event while another active source still reserves it as tentative", async (t) => {
  const database = createDatabase({ clubs: ["club_a", "club_b"] });
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);
  await configure(database, "club_b", FEED_B, 1_001);

  const sharedEvent = meetupEvent({
    uid: "shared-source-a@meetup.com",
    eventId: "8301",
    title: "Shared Canonical Event",
    start: "20280701T030000Z",
    end: "20280701T040000Z",
  });
  const keepEvent = meetupEvent({
    uid: "shared-keep-a@meetup.com",
    eventId: "8302",
    title: "Source A Keep Event",
    start: "20280702T030000Z",
    end: "20280702T040000Z",
  });
  assert.equal(
    (
      await refresh(
        database,
        "club_a",
        sequenceFetcher([calendar(sharedEvent, keepEvent)]),
        2_000,
      )
    ).outcome,
    "completed",
  );

  const tentativeReservation = meetupEvent({
    uid: "shared-source-b@meetup.com",
    eventId: "9301",
    groupSlug: "vancouver-ideas-club",
    status: "TENTATIVE",
    title: "Tentative Source B Reservation",
    start: "20280703T030000Z",
    end: "20280703T040000Z",
  });
  assert.equal(
    (
      await refresh(
        database,
        "club_b",
        sequenceFetcher([calendar(tentativeReservation)]),
        2_100,
      )
    ).outcome,
    "completed",
  );

  const sharedCanonical = await database
    .prepare(
      `SELECT id, slug
       FROM events
       WHERE title = 'Shared Canonical Event'
         AND deleted_at IS NULL`,
    )
    .first();
  const sourceB = await database
    .prepare(
      `SELECT id, active_generation_id
       FROM sync_sources
       WHERE club_id = 'club_b'`,
    )
    .first();
  assert.ok(sharedCanonical);
  assert.equal(typeof sourceB.active_generation_id, "string");

  await database
    .prepare(
      `UPDATE meetup_event_snapshots
       SET event_id = ?,
           event_slug = ?
       WHERE sync_source_id = ?
         AND generation_id = ?
         AND status = 'tentative'`,
    )
    .bind(
      sharedCanonical.id,
      sharedCanonical.slug,
      sourceB.id,
      sourceB.active_generation_id,
    )
    .run();
  await database
    .prepare(
      `UPDATE external_source_links
       SET entity_id = ?
       WHERE sync_source_id = ?
         AND source_type = 'meetup_ics'
         AND entity_type = 'event'
         AND deleted_at IS NULL`,
    )
    .bind(sharedCanonical.id, sourceB.id)
    .run();

  const activeTentativeSnapshot = await database
    .prepare(
      `SELECT snapshot.status, snapshot.event_id
       FROM meetup_event_snapshots AS snapshot
       JOIN sync_sources AS source
         ON source.id = snapshot.sync_source_id
        AND source.active_generation_id = snapshot.generation_id
       WHERE snapshot.sync_source_id = ?`,
    )
    .bind(sourceB.id)
    .first();
  assert.deepEqual(
    { ...activeTentativeSnapshot },
    {
      status: "tentative",
      event_id: sharedCanonical.id,
    },
  );

  const completedWithoutShared = await refresh(
    database,
    "club_a",
    sequenceFetcher([calendar(keepEvent)]),
    3_000,
  );
  assert.equal(completedWithoutShared.outcome, "completed");
  assert.equal(
    completedWithoutShared.counts.removed,
    0,
    "another active tentative snapshot must protect the shared canonical event",
  );
  const sourceAAfterCompletion = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(typeof sourceAAfterCompletion.active_generation_id, "string");
  assert.equal(sourceAAfterCompletion.pending_generation_id, null);
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT state, removed_count
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(sourceAAfterCompletion.active_generation_id)
        .first()),
    },
    {
      state: "published",
      removed_count: 0,
    },
    "the completed generation must persist that no shared event was removed",
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT status, visibility, published_at, deleted_at
           FROM events
           WHERE id = ?`,
        )
        .bind(sharedCanonical.id)
        .first()),
    },
    {
      status: "confirmed",
      visibility: "public",
      published_at: 2_000,
      deleted_at: null,
    },
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM event_revisions
         WHERE event_id = ?
           AND reason =
               'Meetup event absent from completed source snapshot'`,
      )
      .bind(sharedCanonical.id)
      .first("count"),
    0,
  );
});
