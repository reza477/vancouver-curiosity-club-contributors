import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  DATABASE_INVARIANT_MARKER_KEY,
  ensureDatabaseInvariants,
} from "../../lib/server/database/invariants.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";
import { ensureDatabaseInvariantsReady } from "../database/invariant-ready.mjs";

const INTEGRITY_TRIGGER_NAMES = [
  "club_public_profiles_org_integrity_before_insert",
  "club_public_profiles_org_integrity_before_update",
  "clubs_public_profile_org_integrity_before_update",
  "event_lanes_public_profile_org_integrity_before_update",
  "event_public_details_org_integrity_before_insert",
  "event_public_details_org_integrity_before_update",
  "events_public_details_org_integrity_before_update",
];
const RESERVATION_TRIGGER_NAMES = [
  "events_reservation_guard_before_insert",
  "events_reservation_guard_before_update",
];

function migrationFiles() {
  return readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort();
}

function migrationSql(names) {
  return names
    .map((name) =>
      readFileSync(join(process.cwd(), "drizzle", name), "utf8"),
    )
    .join("\n");
}

function seedOrganizations(database) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES
      (
        'profile_a', 'subject-a', 'a@example.test', 'Profile A',
        'active', 1, 1
      ),
      (
        'profile_b', 'subject-b', 'b@example.test', 'Profile B',
        'active', 1, 1
      );

    INSERT INTO organizations (
      id, name, slug, timezone, created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'org_a', 'Organization A', 'organization-a', 'America/Vancouver',
        'profile_a', 1, 1
      ),
      (
        'org_b', 'Organization B', 'organization-b', 'America/Vancouver',
        'profile_b', 1, 1
      );

    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES
      ('club_a_1', 'org_a', 'Club A One', 'club-a-one', 'profile_a', 1, 1),
      ('club_a_2', 'org_a', 'Club A Two', 'club-a-two', 'profile_a', 1, 1),
      ('club_b_1', 'org_b', 'Club B One', 'club-b-one', 'profile_b', 1, 1);

    INSERT INTO event_lanes (
      id, organization_id, name, slug, sort_order, created_by_profile_id,
      created_at, updated_at
    ) VALUES
      ('lane_a_1', 'org_a', 'Lane A One', 'lane-a-one', 10, 'profile_a', 1, 1),
      ('lane_a_2', 'org_a', 'Lane A Two', 'lane-a-two', 20, 'profile_a', 1, 1),
      ('lane_b_1', 'org_b', 'Lane B One', 'lane-b-one', 10, 'profile_b', 1, 1);

    INSERT INTO events (
      id, organization_id, club_id, event_lane_id, title, slug,
      status, visibility, time_kind, starts_at_utc, ends_at_utc, timezone,
      buffer_before_minutes, buffer_after_minutes, organizer_scope_json,
      schedule_version, schedule_review_state, created_by_profile_id,
      updated_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'event_a_1', 'org_a', 'club_a_1', 'lane_a_1',
        'Event A One', 'event-a-one', 'draft', 'private', 'timed',
        1800000000000, 1800003600000, 'America/Vancouver',
        0, 0, '[]', 1, 'unreviewed', 'profile_a', 'profile_a', 1, 1
      ),
      (
        'event_a_2', 'org_a', 'club_a_2', 'lane_a_2',
        'Event A Two', 'event-a-two', 'draft', 'private', 'timed',
        1800007200000, 1800010800000, 'America/Vancouver',
        0, 0, '[]', 1, 'unreviewed', 'profile_a', 'profile_a', 1, 1
      ),
      (
        'event_b_1', 'org_b', 'club_b_1', 'lane_b_1',
        'Event B One', 'event-b-one', 'draft', 'private', 'timed',
        1800014400000, 1800018000000, 'America/Vancouver',
        0, 0, '[]', 1, 'unreviewed', 'profile_b', 'profile_b', 1, 1
      );
  `);
}

test("fresh migrations enforce same-organization public catalog rows on every mutation path", async (t) => {
  const database = new SqliteD1TestDatabase(
    migrationSql(migrationFiles()),
  );
  t.after(() => database.close());
  seedOrganizations(database);
  await ensureDatabaseInvariantsReady(database);

  assert.deepEqual(
    await triggerNames(database, "%_org_integrity_before_%"),
    INTEGRITY_TRIGGER_NAMES,
  );
  assert.deepEqual(
    await triggerNames(database, "events_reservation_guard_%"),
    RESERVATION_TRIGGER_NAMES,
  );

  database.exec(`
    INSERT INTO club_public_profiles (
      club_id, organization_id, primary_event_lane_id,
      publication_status, is_featured, created_at, updated_at
    ) VALUES (
      'club_a_1', 'org_a', 'lane_a_1', 'draft', 0, 1, 1
    );
    INSERT INTO event_public_details (
      event_id, organization_id, attendance_mode, created_at, updated_at
    ) VALUES (
      'event_a_1', 'org_a', 'location_undecided', 1, 1
    );
  `);

  database.exec(`
    UPDATE club_public_profiles
    SET club_id = 'club_a_2',
        primary_event_lane_id = 'lane_a_2'
    WHERE club_id = 'club_a_1';
    UPDATE club_public_profiles
    SET club_id = 'club_a_1',
        primary_event_lane_id = 'lane_a_1'
    WHERE club_id = 'club_a_2';
    UPDATE event_public_details
    SET event_id = 'event_a_2'
    WHERE event_id = 'event_a_1';
    UPDATE event_public_details
    SET event_id = 'event_a_1'
    WHERE event_id = 'event_a_2';
  `);

  assert.throws(
    () =>
      database.exec(`
        INSERT INTO club_public_profiles (
          club_id, organization_id, primary_event_lane_id,
          publication_status, is_featured, created_at, updated_at
        ) VALUES (
          'club_b_1', 'org_a', 'lane_a_1', 'draft', 0, 1, 1
        );
      `),
    /club_public_profiles_organization_mismatch/u,
  );
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO club_public_profiles (
          club_id, organization_id, primary_event_lane_id,
          publication_status, is_featured, created_at, updated_at
        ) VALUES (
          'club_a_2', 'org_a', 'lane_b_1', 'draft', 0, 1, 1
        );
      `),
    /club_public_profiles_organization_mismatch/u,
  );
  for (const sql of [
    "UPDATE club_public_profiles SET club_id = 'club_b_1' WHERE club_id = 'club_a_1'",
    "UPDATE club_public_profiles SET organization_id = 'org_b' WHERE club_id = 'club_a_1'",
    "UPDATE club_public_profiles SET primary_event_lane_id = 'lane_b_1' WHERE club_id = 'club_a_1'",
  ]) {
    assert.throws(
      () => database.exec(sql),
      /club_public_profiles_organization_mismatch/u,
    );
  }

  assert.throws(
    () =>
      database.exec(`
        INSERT INTO event_public_details (
          event_id, organization_id, attendance_mode, created_at, updated_at
        ) VALUES (
          'event_b_1', 'org_a', 'location_undecided', 1, 1
        );
      `),
    /event_public_details_organization_mismatch/u,
  );
  for (const sql of [
    "UPDATE event_public_details SET event_id = 'event_b_1' WHERE event_id = 'event_a_1'",
    "UPDATE event_public_details SET organization_id = 'org_b' WHERE event_id = 'event_a_1'",
  ]) {
    assert.throws(
      () => database.exec(sql),
      /event_public_details_organization_mismatch/u,
    );
  }

  assert.throws(
    () =>
      database.exec(
        "UPDATE clubs SET organization_id = 'org_b' WHERE id = 'club_a_1'",
      ),
    /clubs_public_profile_organization_mismatch/u,
  );
  assert.throws(
    () =>
      database.exec(
        "UPDATE event_lanes SET organization_id = 'org_b' WHERE id = 'lane_a_1'",
      ),
    /event_lanes_public_profile_organization_mismatch/u,
  );
  assert.throws(
    () =>
      database.exec(
        "UPDATE events SET organization_id = 'org_b' WHERE id = 'event_a_1'",
      ),
    /events_public_details_organization_mismatch/u,
  );

  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT club_id, organization_id, primary_event_lane_id
           FROM club_public_profiles`,
        )
        .first()),
    },
    {
      club_id: "club_a_1",
      organization_id: "org_a",
      primary_event_lane_id: "lane_a_1",
    },
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT event_id, organization_id
           FROM event_public_details`,
        )
        .first()),
    },
    {
      event_id: "event_a_1",
      organization_id: "org_a",
    },
  );
  assert.equal(await foreignKeyViolationCount(database), 0);
});

test("runtime initialization preserves valid populated rows while installing every guard", async (t) => {
  const database = new SqliteD1TestDatabase(
    migrationSql(migrationFiles()),
  );
  t.after(() => database.close());
  seedOrganizations(database);
  database.exec(`
    INSERT INTO club_public_profiles (
      club_id, organization_id, primary_event_lane_id,
      publication_status, is_featured, description, public_group_url,
      published_at, created_at, updated_at, deleted_at
    ) VALUES (
      'club_a_1', 'org_a', 'lane_a_1', 'published', 1,
      'Existing public description',
      'https://www.meetup.com/existing-safe-group/', 1, 1, 1, NULL
    );
    INSERT INTO event_public_details (
      event_id, organization_id, attendance_mode, created_at, updated_at
    ) VALUES (
      'event_a_1', 'org_a', 'hybrid', 1, 1
    );
  `);

  const beforeProfiles = await rows(
    database,
    "SELECT * FROM club_public_profiles ORDER BY club_id",
  );
  const beforeDetails = await rows(
    database,
    "SELECT * FROM event_public_details ORDER BY event_id",
  );
  assert.deepEqual(
    await triggerDefinitions(database, "%"),
    [],
    "packaged migrations must not install tokenizer-incompatible triggers",
  );

  await ensureDatabaseInvariantsReady(database);
  assert.deepEqual(
    await rows(
      database,
      "SELECT * FROM club_public_profiles ORDER BY club_id",
    ),
    beforeProfiles,
  );
  assert.deepEqual(
    await rows(
      database,
      "SELECT * FROM event_public_details ORDER BY event_id",
    ),
    beforeDetails,
  );
  assert.deepEqual(
    await triggerNames(database, "events_reservation_guard_%"),
    RESERVATION_TRIGGER_NAMES,
  );
  assert.deepEqual(
    await triggerNames(database, "%_org_integrity_before_%"),
    INTEGRITY_TRIGGER_NAMES,
  );
  assert.equal(await foreignKeyViolationCount(database), 0);
});

test("runtime validation rejects malformed pre-existing rows atomically", async (t) => {
  const database = new SqliteD1TestDatabase(
    migrationSql(migrationFiles()),
  );
  t.after(() => database.close());
  seedOrganizations(database);
  database.exec(`
    INSERT INTO club_public_profiles (
      club_id, organization_id, primary_event_lane_id,
      publication_status, is_featured, created_at, updated_at
    ) VALUES (
      'club_a_1', 'org_b', 'lane_b_1', 'draft', 0, 1, 1
    );
    INSERT INTO event_public_details (
      event_id, organization_id, attendance_mode, created_at, updated_at
    ) VALUES (
      'event_a_1', 'org_b', 'location_undecided', 1, 1
    );
  `);

  await assert.rejects(
    ensureDatabaseInvariants(database),
    /Database integrity guards are unavailable/u,
  );
  assert.deepEqual(
    await triggerNames(database, "%_org_integrity_before_%"),
    [],
    "the failed D1 batch must not leave partial guard installation",
  );
  assert.equal(
    await database
      .prepare("SELECT count(*) AS count FROM club_public_profiles")
      .first("count"),
    1,
  );
  assert.equal(
    await database
      .prepare("SELECT count(*) AS count FROM event_public_details")
      .first("count"),
    1,
  );
  assert.deepEqual(
    await triggerNames(database, "events_reservation_guard_%"),
    [],
    "the failed atomic batch must not leave reservation guards either",
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM database_invariant_state
         WHERE singleton_key = ?`,
      )
      .bind(DATABASE_INVARIANT_MARKER_KEY)
      .first("count"),
    0,
  );
});

async function triggerNames(database, pattern) {
  const result = await database
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'trigger'
         AND name LIKE ?
       ORDER BY name`,
    )
    .bind(pattern)
    .all();
  return result.results.map((row) => row.name);
}

async function triggerDefinitions(database, pattern) {
  const result = await database
    .prepare(
      `SELECT name, sql
       FROM sqlite_master
       WHERE type = 'trigger'
         AND name LIKE ?
       ORDER BY name`,
    )
    .bind(pattern)
    .all();
  return result.results.map((row) => ({ ...row }));
}

async function rows(database, sql) {
  return database
    .prepare(sql)
    .all()
    .then((result) => result.results.map((row) => ({ ...row })));
}

async function foreignKeyViolationCount(database) {
  return database
    .prepare("PRAGMA foreign_key_check")
    .all()
    .then((result) => result.results.length);
}
