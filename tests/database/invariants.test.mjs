import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  DATABASE_INVARIANT_MARKER_KEY,
  DATABASE_INVARIANT_TRIGGER_NAMES,
  DATABASE_INVARIANT_TRIGGER_STATEMENTS,
  DATABASE_INVARIANT_VERSION,
  ensureDatabaseInvariants,
  getExpectedDatabaseInvariantFingerprint,
  normalizeTriggerDefinition,
} from "../../lib/server/database/invariants.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

function migrationSql() {
  return readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) =>
      readFileSync(join(process.cwd(), "drizzle", name), "utf8"),
    )
    .join("\n");
}

function newDatabase() {
  return new SqliteD1TestDatabase(migrationSql());
}

function isolatedBinding(database) {
  return {
    batch: (statements) => database.batch(statements),
    prepare: (sql) => database.prepare(sql),
  };
}

test("concurrent isolate initialization installs one exact durable guard set", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  const firstIsolate = isolatedBinding(database);
  const secondIsolate = isolatedBinding(database);

  await Promise.all([
    ensureDatabaseInvariants(firstIsolate),
    ensureDatabaseInvariants(firstIsolate),
    ensureDatabaseInvariants(secondIsolate),
  ]);

  const expectedFingerprint =
    await getExpectedDatabaseInvariantFingerprint();
  assert.match(expectedFingerprint, /^[a-f0-9]{64}$/u);
  assert.deepEqual(await marker(database), {
    singleton_key: DATABASE_INVARIANT_MARKER_KEY,
    trigger_fingerprint: expectedFingerprint,
    version: DATABASE_INVARIANT_VERSION,
  });
  assert.deepEqual(
    await normalizedTriggerDefinitions(database),
    expectedTriggerDefinitions(),
  );
  assert.deepEqual(
    (await normalizedTriggerDefinitions(database)).map(({ name }) => name),
    [...DATABASE_INVARIANT_TRIGGER_NAMES],
  );
});

test("a fresh isolate repairs a missing or mismatched expected trigger", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariants(isolatedBinding(database));

  database.exec(`
    DROP TRIGGER events_reservation_guard_before_insert;
    CREATE TRIGGER events_reservation_guard_before_insert
    BEFORE INSERT ON events
    BEGIN
      SELECT 1;
    END;
  `);
  assert.notDeepEqual(
    await normalizedTriggerDefinitions(database),
    expectedTriggerDefinitions(),
  );

  await ensureDatabaseInvariants(isolatedBinding(database));
  assert.deepEqual(
    await normalizedTriggerDefinitions(database),
    expectedTriggerDefinitions(),
  );
  assert.ok(await marker(database));
});

test("cross-organization probe failure leaves no durable readiness marker", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedOrganizations(database);
  database.exec(`
    INSERT INTO club_public_profiles (
      club_id, organization_id, primary_event_lane_id,
      publication_status, is_featured, created_at, updated_at
    ) VALUES (
      'club_a', 'org_b', 'lane_b', 'draft', 0, 1, 1
    );
    INSERT INTO event_public_details (
      event_id, organization_id, attendance_mode, created_at, updated_at
    ) VALUES (
      'event_a', 'org_b', 'location_undecided', 1, 1
    );
  `);

  const binding = isolatedBinding(database);
  await assert.rejects(
    ensureDatabaseInvariants(binding),
    /Database integrity guards are unavailable/u,
  );
  assert.equal(await marker(database), null);
  assert.deepEqual(
    await normalizedTriggerDefinitions(database),
    [],
    "the atomic probe failure must roll back every trigger install",
  );

  database.exec(`
    DELETE FROM club_public_profiles;
    DELETE FROM event_public_details;
  `);
  await ensureDatabaseInvariants(binding);
  assert.ok(await marker(database));
});

test("installed guards continue rejecting malformed public rows", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedOrganizations(database);
  await ensureDatabaseInvariants(isolatedBinding(database));

  assert.throws(
    () =>
      database.exec(`
        INSERT INTO club_public_profiles (
          club_id, organization_id, primary_event_lane_id,
          publication_status, is_featured, created_at, updated_at
        ) VALUES (
          'club_a', 'org_b', 'lane_b', 'draft', 0, 1, 1
        );
      `),
    /club_public_profiles_organization_mismatch/u,
  );
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO event_public_details (
          event_id, organization_id, attendance_mode, created_at, updated_at
        ) VALUES (
          'event_a', 'org_b', 'location_undecided', 1, 1
        );
      `),
    /event_public_details_organization_mismatch/u,
  );
});

function seedOrganizations(database) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES
      ('profile_a', 'subject-a', 'a@example.test', 'Profile A', 'active', 1, 1),
      ('profile_b', 'subject-b', 'b@example.test', 'Profile B', 'active', 1, 1);

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
      ('club_a', 'org_a', 'Club A', 'club-a', 'profile_a', 1, 1),
      ('club_b', 'org_b', 'Club B', 'club-b', 'profile_b', 1, 1);

    INSERT INTO event_lanes (
      id, organization_id, name, slug, sort_order, created_by_profile_id,
      created_at, updated_at
    ) VALUES
      ('lane_a', 'org_a', 'Lane A', 'lane-a', 10, 'profile_a', 1, 1),
      ('lane_b', 'org_b', 'Lane B', 'lane-b', 10, 'profile_b', 1, 1);

    INSERT INTO events (
      id, organization_id, club_id, event_lane_id, title, slug,
      status, visibility, time_kind, starts_at_utc, ends_at_utc, timezone,
      buffer_before_minutes, buffer_after_minutes, organizer_scope_json,
      schedule_version, schedule_review_state, created_by_profile_id,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'event_a', 'org_a', 'club_a', 'lane_a', 'Event A', 'event-a',
      'draft', 'private', 'timed', 1800000000000, 1800003600000,
      'America/Vancouver', 0, 0, '[]', 1, 'unreviewed',
      'profile_a', 'profile_a', 1, 1
    );
  `);
}

async function marker(database) {
  return database
    .prepare(
      `SELECT singleton_key, version, trigger_fingerprint
       FROM database_invariant_state
       WHERE singleton_key = ?`,
    )
    .bind(DATABASE_INVARIANT_MARKER_KEY)
    .first()
    .then((row) => (row ? { ...row } : null));
}

function expectedTriggerDefinitions() {
  return DATABASE_INVARIANT_TRIGGER_STATEMENTS.map((sql) => ({
    name: triggerName(sql),
    sql: normalizeTriggerDefinition(sql),
  })).sort((left, right) => left.name.localeCompare(right.name));
}

async function normalizedTriggerDefinitions(database) {
  return database
    .prepare(
      `SELECT name, sql
       FROM sqlite_master
       WHERE type = 'trigger'
       ORDER BY name`,
    )
    .all()
    .then((result) =>
      result.results.map((row) => ({
        name: row.name,
        sql: normalizeTriggerDefinition(row.sql),
      })),
    );
}

function triggerName(sql) {
  return /^CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS\s+([A-Za-z0-9_]+)/iu.exec(
    sql.trim(),
  )[1];
}
