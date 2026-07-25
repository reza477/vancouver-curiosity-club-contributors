import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { Miniflare } from "miniflare";

import {
  createUnreviewedTimedReservation,
  ReservationWriteRejectedError,
  updateUnreviewedTimedReservation,
} from "../../lib/server/conflicts/atomic-write.ts";
import { CONFLICT_GUARD_SQL } from "../../lib/server/conflicts/guard-sql.ts";
import { ensureDatabaseInvariants } from "../../lib/server/database/invariants.ts";

let miniflare;
let database;

const migrationFileNames = async () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  return (await readdir(migrationDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
};

const migrationFileStatements = async (name) => {
  const sql = await readFile(
    resolve(process.cwd(), "drizzle", name),
    "utf8",
  );
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
};

const seed = async (targetDatabase = database) => {
  await targetDatabase.batch([
    ...["owner", "organizer-a", "organizer-b", "co-shared"].map((id) =>
      targetDatabase
        .prepare(
          `INSERT INTO profiles (
             id, siwc_subject, normalized_email, display_name
           ) VALUES (?, ?, ?, ?)`,
        )
        .bind(id, `siwc-${id}`, `${id}@example.test`, id),
    ),
    targetDatabase
      .prepare(
        `INSERT INTO organizations (id, name, slug)
         VALUES (?, ?, ?)`,
      )
      .bind("org-1", "Architecture proof", "architecture-proof"),
    targetDatabase
      .prepare(
        `INSERT INTO clubs (id, organization_id, name, slug)
         VALUES (?, ?, ?, ?)`,
      )
      .bind("club-1", "org-1", "Test club", "test-club"),
    targetDatabase
      .prepare(
        `INSERT INTO clubs (id, organization_id, name, slug)
         VALUES (?, ?, ?, ?)`,
      )
      .bind("club-2", "org-1", "Second test club", "second-test-club"),
    targetDatabase
      .prepare(
        `INSERT INTO venues (id, organization_id, name, slug)
         VALUES (?, ?, ?, ?)`,
      )
      .bind("venue-a", "org-1", "Venue A", "venue-a"),
    targetDatabase
      .prepare(
        `INSERT INTO venues (id, organization_id, name, slug)
         VALUES (?, ?, ?, ?)`,
      )
      .bind("venue-b", "org-1", "Venue B", "venue-b"),
  ]);
};

const reservation = (overrides) => ({
  id: crypto.randomUUID(),
  organizationId: "org-1",
  clubId: "club-1",
  venueId: "venue-a",
  primaryOrganizerProfileId: "organizer-a",
  coOrganizerProfileIds: [],
  title: "Architecture proof",
  slug: crypto.randomUUID(),
  status: "confirmed",
  visibility: "private",
  startsAtUtc: Date.parse("2026-08-12T01:00:00.000Z"),
  endsAtUtc: Date.parse("2026-08-12T03:00:00.000Z"),
  timezone: "America/Vancouver",
  bufferBeforeMinutes: 15,
  bufferAfterMinutes: 15,
  actorProfileId: "owner",
  ...overrides,
});

const directReservation = (overrides = {}) => ({
  id: crypto.randomUUID(),
  clubId: "club-1",
  venueId: "venue-a",
  primaryOrganizerProfileId: "organizer-a",
  coOrganizerProfileIds: [],
  title: "Direct guard probe",
  slug: crypto.randomUUID(),
  status: "confirmed",
  scheduleReviewState: "unreviewed",
  startsAtUtc: Date.parse("2026-08-16T01:00:00.000Z"),
  endsAtUtc: Date.parse("2026-08-16T02:00:00.000Z"),
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  holdExpiresAt: null,
  ...overrides,
});

const insertDirectReservation = async (overrides = {}) => {
  const event = directReservation(overrides);
  return database
    .prepare(
      `INSERT INTO events (
         id, organization_id, club_id, venue_id,
         primary_organizer_profile_id, title, slug, status, visibility,
         time_kind, starts_at_utc, ends_at_utc, timezone,
         buffer_before_minutes, buffer_after_minutes, organizer_scope_json,
         schedule_version, schedule_review_state, hold_expires_at,
         created_by_profile_id, updated_by_profile_id
       ) VALUES (
         ?, 'org-1', ?, ?, ?, ?, ?, ?, 'private',
         'timed', ?, ?, 'America/Vancouver',
         ?, ?, ?, 1, ?, ?, 'owner', 'owner'
       )`,
    )
    .bind(
      event.id,
      event.clubId,
      event.venueId,
      event.primaryOrganizerProfileId,
      event.title,
      event.slug,
      event.status,
      event.startsAtUtc,
      event.endsAtUtc,
      event.bufferBeforeMinutes,
      event.bufferAfterMinutes,
      JSON.stringify(
        [...new Set([
          event.primaryOrganizerProfileId,
          ...event.coOrganizerProfileIds,
        ])].sort(),
      ),
      event.scheduleReviewState,
      event.holdExpiresAt,
    )
    .run();
};

const insertBoundaryHold = async (overrides = {}) => {
  const event = directReservation({
    ...overrides,
    status: "hold",
    holdExpiresAt: undefined,
  });
  return database
    .prepare(
      `INSERT INTO events (
         id, organization_id, club_id, venue_id,
         primary_organizer_profile_id, title, slug, status, visibility,
         time_kind, starts_at_utc, ends_at_utc, timezone,
         buffer_before_minutes, buffer_after_minutes, organizer_scope_json,
         schedule_version, schedule_review_state, hold_expires_at,
         created_by_profile_id, updated_by_profile_id
       ) VALUES (
         ?, 'org-1', ?, ?, ?, ?, ?, 'hold', 'private',
         'timed', ?, ?, 'America/Vancouver',
         ?, ?, ?, 1, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER),
         'owner', 'owner'
       )`,
    )
    .bind(
      event.id,
      event.clubId,
      event.venueId,
      event.primaryOrganizerProfileId,
      event.title,
      event.slug,
      event.startsAtUtc,
      event.endsAtUtc,
      event.bufferBeforeMinutes,
      event.bufferAfterMinutes,
      JSON.stringify(
        [...new Set([
          event.primaryOrganizerProfileId,
          ...event.coOrganizerProfileIds,
        ])].sort(),
      ),
      event.scheduleReviewState,
    )
    .run();
};

before(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: "",
    d1Databases: { DB: crypto.randomUUID() },
  });
  database = await miniflare.getD1Database("DB");
  for (const name of await migrationFileNames()) {
    await database.batch(
      (await migrationFileStatements(name)).map((statement) =>
        database.prepare(statement),
      ),
    );
  }
  await ensureDatabaseInvariants(database);

  const installedTriggers = await database
    .prepare(
      `SELECT sql
       FROM sqlite_master
       WHERE type = 'trigger'
         AND name LIKE 'events_reservation_guard_%'
       ORDER BY name`,
    )
    .all();
  const normalizeSql = (sql) =>
    sql
      .replace(/\bIF NOT EXISTS\b/giu, "")
      .replace(/\s+/gu, " ")
      .trim();
  assert.equal(installedTriggers.results.length, 2);
  assert.equal(
    normalizeSql(
      installedTriggers.results.map((row) => `${row.sql};`).join("\n\n"),
    ),
    normalizeSql(CONFLICT_GUARD_SQL),
  );

  await seed();
});

after(async () => {
  await miniflare?.dispose();
});

test("two synchronized writes for one empty slot commit at most one reservation", async () => {
  let release;
  const startingGate = new Promise((resolve) => {
    release = resolve;
  });

  const attempt = async (input) => {
    await startingGate;
    return createUnreviewedTimedReservation(database, input);
  };

  const first = attempt(
    reservation({
      id: "simultaneous-a",
      slug: "simultaneous-a",
      primaryOrganizerProfileId: "organizer-a",
    }),
  );
  const second = attempt(
    reservation({
      id: "simultaneous-b",
      slug: "simultaneous-b",
      clubId: "club-2",
      venueId: "venue-b",
      primaryOrganizerProfileId: "organizer-b",
    }),
  );

  release();
  const outcomes = await Promise.allSettled([first, second]);
  const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const rejected = outcomes.filter((outcome) => outcome.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof ReservationWriteRejectedError);

  const eventCount = await database
    .prepare(
      `SELECT count(*) AS count
       FROM events
       WHERE id IN ('simultaneous-a', 'simultaneous-b')`,
    )
    .first("count");
  const organizerCount = await database
    .prepare(
      `SELECT count(*) AS count
       FROM event_organizers
       WHERE event_id IN ('simultaneous-a', 'simultaneous-b')`,
    )
    .first("count");
  const revisionCount = await database
    .prepare(
      `SELECT count(*) AS count
       FROM event_revisions
       WHERE event_id IN ('simultaneous-a', 'simultaneous-b')`,
    )
    .first("count");
  const auditCount = await database
    .prepare(
      `SELECT count(*) AS count
       FROM audit_logs
       WHERE entity_id IN ('simultaneous-a', 'simultaneous-b')`,
    )
    .first("count");

  assert.equal(eventCount, 1);
  assert.equal(organizerCount, 1);
  assert.equal(revisionCount, 1);
  assert.equal(auditCount, 1);
});

test("a shared co-organizer is guarded even when venues differ", async () => {
  await createUnreviewedTimedReservation(
    database,
    reservation({
      id: "co-organizer-existing",
      slug: "co-organizer-existing",
      venueId: "venue-b",
      startsAtUtc: Date.parse("2026-08-13T01:00:00.000Z"),
      endsAtUtc: Date.parse("2026-08-13T02:00:00.000Z"),
      coOrganizerProfileIds: ["co-shared"],
    }),
  );

  await assert.rejects(
    createUnreviewedTimedReservation(
      database,
      reservation({
        id: "co-organizer-overlap",
        slug: "co-organizer-overlap",
        venueId: "venue-a",
        primaryOrganizerProfileId: "organizer-b",
        startsAtUtc: Date.parse("2026-08-13T01:30:00.000Z"),
        endsAtUtc: Date.parse("2026-08-13T02:30:00.000Z"),
        coOrganizerProfileIds: ["co-shared"],
      }),
    ),
    ReservationWriteRejectedError,
  );
});

test("buffers are part of the normalized interval guard", async () => {
  await createUnreviewedTimedReservation(
    database,
    reservation({
      id: "buffer-existing",
      slug: "buffer-existing",
      venueId: "venue-b",
      primaryOrganizerProfileId: "organizer-a",
      startsAtUtc: Date.parse("2026-08-14T01:00:00.000Z"),
      endsAtUtc: Date.parse("2026-08-14T02:00:00.000Z"),
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 30,
    }),
  );

  await assert.rejects(
    createUnreviewedTimedReservation(
      database,
      reservation({
        id: "buffer-overlap",
        slug: "buffer-overlap",
        venueId: "venue-b",
        primaryOrganizerProfileId: "organizer-b",
        startsAtUtc: Date.parse("2026-08-14T02:15:00.000Z"),
        endsAtUtc: Date.parse("2026-08-14T03:00:00.000Z"),
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
      }),
    ),
    ReservationWriteRejectedError,
  );
});

test("a stale optimistic version rolls back associations, revision, and audit", async () => {
  const initial = reservation({
    id: "stale-update",
    slug: "stale-update",
    venueId: "venue-a",
    startsAtUtc: Date.parse("2026-08-15T01:00:00.000Z"),
    endsAtUtc: Date.parse("2026-08-15T02:00:00.000Z"),
  });
  await createUnreviewedTimedReservation(database, initial);

  await assert.rejects(
    updateUnreviewedTimedReservation(database, {
      ...initial,
      title: "Must not persist",
      coOrganizerProfileIds: ["co-shared"],
      expectedScheduleVersion: 99,
    }),
    ReservationWriteRejectedError,
  );

  const event = await database
    .prepare(
      `SELECT title, schedule_version AS scheduleVersion
       FROM events WHERE id = ?`,
    )
    .bind(initial.id)
    .first();
  const organizerCount = await database
    .prepare(
      "SELECT count(*) AS count FROM event_organizers WHERE event_id = ?",
    )
    .bind(initial.id)
    .first("count");
  const revisionCount = await database
    .prepare(
      "SELECT count(*) AS count FROM event_revisions WHERE event_id = ?",
    )
    .bind(initial.id)
    .first("count");
  const auditCount = await database
    .prepare("SELECT count(*) AS count FROM audit_logs WHERE entity_id = ?")
    .bind(initial.id)
    .first("count");

  assert.equal(event.title, "Architecture proof");
  assert.equal(event.scheduleVersion, 1);
  assert.equal(organizerCount, 1);
  assert.equal(revisionCount, 1);
  assert.equal(auditCount, 1);
});

test("reviewed and overridden states cannot bypass the INSERT guard", async () => {
  await createUnreviewedTimedReservation(
    database,
    reservation({
      id: "review-state-anchor",
      slug: "review-state-anchor",
      startsAtUtc: Date.parse("2026-08-16T01:00:00.000Z"),
      endsAtUtc: Date.parse("2026-08-16T02:00:00.000Z"),
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
    }),
  );

  for (const scheduleReviewState of ["reviewed", "overridden"]) {
    await assert.rejects(
      insertDirectReservation({
        id: `new-${scheduleReviewState}-bypass`,
        slug: `new-${scheduleReviewState}-bypass`,
        clubId: "club-2",
        venueId: "venue-b",
        primaryOrganizerProfileId: "organizer-b",
        scheduleReviewState,
        startsAtUtc: Date.parse("2026-08-16T01:30:00.000Z"),
        endsAtUtc: Date.parse("2026-08-16T02:30:00.000Z"),
      }),
      /conflict_guard_overlap_organization/u,
    );
  }
});

test("existing reviewed and overridden reservations remain visible to future writes", async () => {
  for (const [index, scheduleReviewState] of [
    "reviewed",
    "overridden",
  ].entries()) {
    const day = 17 + index;
    const startsAtUtc = Date.parse(
      `2026-08-${String(day).padStart(2, "0")}T01:00:00.000Z`,
    );
    const endsAtUtc = startsAtUtc + 60 * 60_000;
    await insertDirectReservation({
      id: `existing-${scheduleReviewState}`,
      slug: `existing-${scheduleReviewState}`,
      scheduleReviewState,
      startsAtUtc,
      endsAtUtc,
    });

    await assert.rejects(
      createUnreviewedTimedReservation(
        database,
        reservation({
          id: `future-against-${scheduleReviewState}`,
          slug: `future-against-${scheduleReviewState}`,
          clubId: "club-2",
          venueId: "venue-b",
          primaryOrganizerProfileId: "organizer-b",
          startsAtUtc: startsAtUtc + 30 * 60_000,
          endsAtUtc: endsAtUtc + 30 * 60_000,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
        }),
      ),
      ReservationWriteRejectedError,
    );
  }
});

test("active holds reserve and naturally expired holds stop reserving", async () => {
  const startsAtUtc = Date.parse("2026-08-19T01:00:00.000Z");
  const holdExpiresAt = Date.now() + 1_500;
  await createUnreviewedTimedReservation(
    database,
    reservation({
      id: "expiring-hold",
      slug: "expiring-hold",
      status: "hold",
      holdExpiresAt,
      startsAtUtc,
      endsAtUtc: startsAtUtc + 60 * 60_000,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
    }),
  );

  const candidate = reservation({
    id: "after-expiring-hold",
    slug: "after-expiring-hold",
    clubId: "club-2",
    venueId: "venue-b",
    primaryOrganizerProfileId: "organizer-b",
    startsAtUtc: startsAtUtc + 30 * 60_000,
    endsAtUtc: startsAtUtc + 90 * 60_000,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
  });

  await assert.rejects(
    createUnreviewedTimedReservation(database, candidate),
    ReservationWriteRejectedError,
  );

  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, holdExpiresAt - Date.now()) + 150),
  );
  await createUnreviewedTimedReservation(database, candidate);
});

test("a hold expiring exactly at SQLite current time is expired", async () => {
  await assert.rejects(
    insertBoundaryHold({
      id: "boundary-hold",
      slug: "boundary-hold",
      startsAtUtc: Date.parse("2026-08-20T01:00:00.000Z"),
      endsAtUtc: Date.parse("2026-08-20T02:00:00.000Z"),
    }),
    /conflict_guard_hold_expired/u,
  );
});

test("hold expiry is required for holds and forbidden for non-holds", async () => {
  await assert.rejects(
    createUnreviewedTimedReservation(
      database,
      reservation({
        status: "hold",
        holdExpiresAt: null,
        startsAtUtc: Date.parse("2026-08-21T01:00:00.000Z"),
        endsAtUtc: Date.parse("2026-08-21T02:00:00.000Z"),
      }),
    ),
    /holdExpiresAt is required/u,
  );
  await assert.rejects(
    insertDirectReservation({
      id: "non-hold-with-expiry",
      slug: "non-hold-with-expiry",
      status: "confirmed",
      holdExpiresAt: Date.now() + 60_000,
      startsAtUtc: Date.parse("2026-08-21T01:00:00.000Z"),
      endsAtUtc: Date.parse("2026-08-21T02:00:00.000Z"),
    }),
    /conflict_guard_non_hold_expiry|events_hold_expiry_shape_check/u,
  );
});

test("UPDATE guard blocks organization-wide overlap across different resources", async () => {
  const first = reservation({
    id: "update-org-anchor",
    slug: "update-org-anchor",
    startsAtUtc: Date.parse("2026-08-22T01:00:00.000Z"),
    endsAtUtc: Date.parse("2026-08-22T02:00:00.000Z"),
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
  });
  const second = reservation({
    id: "update-org-candidate",
    slug: "update-org-candidate",
    clubId: "club-2",
    venueId: "venue-b",
    primaryOrganizerProfileId: "organizer-b",
    startsAtUtc: Date.parse("2026-08-22T03:00:00.000Z"),
    endsAtUtc: Date.parse("2026-08-22T04:00:00.000Z"),
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
  });
  await createUnreviewedTimedReservation(database, first);
  await createUnreviewedTimedReservation(database, second);

  await assert.rejects(
    database
      .prepare(
        `UPDATE events
         SET starts_at_utc = ?,
             ends_at_utc = ?,
             schedule_review_state = 'overridden',
             schedule_version = schedule_version + 1
         WHERE id = ? AND schedule_version = 1`,
      )
      .bind(first.startsAtUtc + 30 * 60_000, first.endsAtUtc + 30 * 60_000, second.id)
      .run(),
    /conflict_guard_overlap_organization/u,
  );

  const unchanged = await database
    .prepare(
      `SELECT starts_at_utc AS startsAtUtc,
              schedule_version AS scheduleVersion,
              schedule_review_state AS scheduleReviewState
       FROM events WHERE id = ?`,
    )
    .bind(second.id)
    .first();
  assert.equal(unchanged.startsAtUtc, second.startsAtUtc);
  assert.equal(unchanged.scheduleVersion, 1);
  assert.equal(unchanged.scheduleReviewState, "unreviewed");
});

test("conflict reasons use venue, organizer, then organization priority", async () => {
  const startsAtUtc = Date.parse("2026-08-23T01:00:00.000Z");
  const endsAtUtc = startsAtUtc + 60 * 60_000;
  await createUnreviewedTimedReservation(
    database,
    reservation({
      id: "reason-anchor",
      slug: "reason-anchor",
      coOrganizerProfileIds: ["co-shared"],
      startsAtUtc,
      endsAtUtc,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
    }),
  );

  await assert.rejects(
    insertDirectReservation({
      id: "reason-venue",
      slug: "reason-venue",
      primaryOrganizerProfileId: "organizer-b",
      startsAtUtc,
      endsAtUtc,
    }),
    /conflict_guard_overlap_venue/u,
  );

  await assert.rejects(
    insertDirectReservation({
      id: "reason-organizer",
      slug: "reason-organizer",
      clubId: "club-2",
      venueId: "venue-b",
      primaryOrganizerProfileId: "organizer-b",
      coOrganizerProfileIds: ["co-shared"],
      startsAtUtc,
      endsAtUtc,
    }),
    /conflict_guard_overlap_organizer/u,
  );

  await assert.rejects(
    insertDirectReservation({
      id: "reason-organization",
      slug: "reason-organization",
      clubId: "club-2",
      venueId: "venue-b",
      primaryOrganizerProfileId: "organizer-b",
      startsAtUtc,
      endsAtUtc,
    }),
    /conflict_guard_overlap_organization/u,
  );
});

test("the normalized baseline and reservation path reject holds without expiry", async () => {
  const stagedMiniflare = new Miniflare({
    modules: true,
    script: "",
    d1Databases: { DB: crypto.randomUUID() },
  });

  try {
    const stagedDatabase = await stagedMiniflare.getD1Database("DB");
    for (const name of await migrationFileNames()) {
      await stagedDatabase.batch(
        (await migrationFileStatements(name)).map((statement) =>
          stagedDatabase.prepare(statement),
        ),
      );
    }
    await ensureDatabaseInvariants(stagedDatabase);
    await seed(stagedDatabase);

    const columns = await stagedDatabase
      .prepare("PRAGMA table_info(events)")
      .all();
    assert.ok(
      columns.results.some((column) => column.name === "hold_expires_at"),
    );
    await assert.rejects(
      createUnreviewedTimedReservation(
        stagedDatabase,
        reservation({
          id: "hold-without-expiry",
          slug: "hold-without-expiry",
          status: "hold",
          holdExpiresAt: null,
        }),
      ),
      /holdExpiresAt is required for hold reservations/u,
    );
  } finally {
    await stagedMiniflare.dispose();
  }
});
