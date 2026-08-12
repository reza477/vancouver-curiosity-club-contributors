import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  MAX_D1_MIGRATION_BATCH_STATEMENTS_WITH_LEDGER,
  MAX_D1_MIGRATION_STATEMENTS_PER_BATCH,
  migrationStatementBatches,
} from "../../scripts/d1-migration-batches.mjs";

const MIGRATION_DIRECTORY = join(process.cwd(), "drizzle");
const EXPECTED_MIGRATIONS = Object.freeze([
  "0008_preproduction_reset.sql",
  "0009_sites_compatible_baseline.sql",
  "0010_sites_compatible_indexes_a.sql",
  "0011_sites_compatible_indexes_b.sql",
  "0012_phase3_organizer_foundation.sql",
  "0013_phase4_conflict_engine.sql",
  "0014_phase5_publication.sql",
  "0015_phase6_cms_media.sql",
  "0016_phase7_import_export_forms.sql",
  "0017_bright_captain_america.sql",
  "0018_public_event_calendar_snapshots.sql",
  "0019_meetup_event_lanes.sql",
]);
const EXPECTED_SIGNATURE = Object.freeze({
  checks: 246,
  explicitIndexes: 200,
  foreignKeys: 300,
  tables: 88,
  triggers: 0,
  uniqueIndexes: 79,
});

test("the normalized migration chain is safe for the Sites production tokenizer", () => {
  assert.deepEqual(migrationFiles(), [...EXPECTED_MIGRATIONS]);
  assert.deepEqual(
    readdirSync(join(MIGRATION_DIRECTORY, "meta"))
      .filter((name) => name.endsWith(".json"))
      .sort(),
    [
      "0008_snapshot.json",
      "0009_snapshot.json",
      "0010_snapshot.json",
      "0011_snapshot.json",
      "0012_snapshot.json",
      "0013_snapshot.json",
      "0014_snapshot.json",
      "0015_snapshot.json",
      "0016_snapshot.json",
      "0017_snapshot.json",
      "0018_snapshot.json",
      "0019_snapshot.json",
      "_journal.json",
    ],
    "the normalized chain must include every public-content and Events snapshot migration",
  );

  const journal = JSON.parse(
    readFileSync(join(MIGRATION_DIRECTORY, "meta", "_journal.json"), "utf8"),
  );
  assert.deepEqual(
    journal.entries.map(({ idx, tag }) => ({ idx, tag })),
    [
      { idx: 8, tag: "0008_preproduction_reset" },
      { idx: 9, tag: "0009_sites_compatible_baseline" },
      { idx: 10, tag: "0010_sites_compatible_indexes_a" },
      { idx: 11, tag: "0011_sites_compatible_indexes_b" },
      { idx: 12, tag: "0012_phase3_organizer_foundation" },
      { idx: 13, tag: "0013_phase4_conflict_engine" },
      { idx: 14, tag: "0014_phase5_publication" },
      { idx: 15, tag: "0015_phase6_cms_media" },
      { idx: 16, tag: "0016_phase7_import_export_forms" },
      { idx: 17, tag: "0017_bright_captain_america" },
      { idx: 18, tag: "0018_public_event_calendar_snapshots" },
      { idx: 19, tag: "0019_meetup_event_lanes" },
    ],
  );
  assert.deepEqual(
    [
      "0008",
      "0009",
      "0010",
      "0011",
      "0012",
      "0013",
      "0014",
      "0015",
      "0016",
      "0017",
      "0018",
      "0019",
    ].map((prefix) => {
      const snapshot = JSON.parse(
        readFileSync(
          join(MIGRATION_DIRECTORY, "meta", `${prefix}_snapshot.json`),
          "utf8",
        ),
      );
      return Object.values(snapshot.tables ?? {}).reduce(
        (count, table) =>
          count + Object.keys(table.indexes ?? {}).length,
        0,
      );
    }),
    [0, 0, 38, 75, 90, 117, 131, 184, 199, 199, 200, 200],
    "migration snapshots must match the cumulative packaged index state",
  );

  for (const file of EXPECTED_MIGRATIONS) {
    const sql = migrationSql(file);
    assert.doesNotMatch(sql, /\bCREATE\s+TRIGGER\b/iu, file);
    assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/iu, file);
    assert.doesNotMatch(sql, /\bPRAGMA\b/iu, file);
    assert.doesNotMatch(sql, /\bRENAME\s+TO\b/iu, file);
    const fragments = productionFragments(sql);
    assert.ok(fragments.length > 0, `${file} must contain SQL`);
    assert.ok(
      migrationStatementBatches(fragments).every(
        (batch) =>
          batch.length <= MAX_D1_MIGRATION_STATEMENTS_PER_BATCH,
      ),
      `${file} exceeds the bounded per-D1-request migration contract`,
    );
  }

  const phase6Fragments = productionFragments(
    migrationSql("0015_phase6_cms_media.sql"),
  );
  const phase6Batches = migrationStatementBatches(phase6Fragments);
  assert.equal(phase6Fragments.length, 73);
  assert.deepEqual(
    phase6Batches.map((batch) => batch.length),
    [48, 25],
  );
  assert.deepEqual(
    phase6Batches.map(
      (batch, index) =>
        batch.length + (index === phase6Batches.length - 1 ? 1 : 0),
    ),
    [48, 26],
    "the migration ledger insert belongs only to the final D1 batch",
  );
  assert.ok(
    phase6Batches.every(
      (batch, index) =>
        batch.length +
          (index === phase6Batches.length - 1 ? 1 : 0) <=
        MAX_D1_MIGRATION_BATCH_STATEMENTS_WITH_LEDGER,
    ),
  );

  const phase7Fragments = productionFragments(
    migrationSql("0016_phase7_import_export_forms.sql"),
  );
  const phase7Batches = migrationStatementBatches(phase7Fragments);
  assert.equal(phase7Fragments.length, 23);
  assert.deepEqual(
    phase7Batches.map((batch) => batch.length),
    [23],
  );
  assert.equal(
    phase7Batches[0].length + 1,
    24,
    "the Phase 7 migration and final ledger remain in one bounded request",
  );

  const meetupPublicContentFragments = productionFragments(
    migrationSql("0017_bright_captain_america.sql"),
  );
  assert.equal(meetupPublicContentFragments.length, 1);
  assert.match(
    meetupPublicContentFragments[0],
    /CREATE TABLE IF NOT EXISTS `meetup_event_snapshot_public_contents`/u,
  );

  const eventSnapshotFragments = productionFragments(
    migrationSql("0018_public_event_calendar_snapshots.sql"),
  );
  assert.equal(eventSnapshotFragments.length, 2);
  assert.match(
    eventSnapshotFragments[0],
    /CREATE TABLE IF NOT EXISTS `public_event_calendar_snapshots`/u,
  );
  assert.match(
    eventSnapshotFragments[1],
    /CREATE INDEX IF NOT EXISTS `public_event_calendar_snapshots_org_expiry_idx`/u,
  );

  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    applyProductionFragments(database, allProductionFragments());
    assertDatabaseSignature(database, EXPECTED_SIGNATURE);
  } finally {
    database.close();
  }
});

test("the Meetup lane backfill is narrow, accurate, and idempotent", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    const migrationsBeforeLaneBackfill = EXPECTED_MIGRATIONS.slice(0, -1)
      .flatMap((file) => productionFragments(migrationSql(file)));
    applyProductionFragments(database, migrationsBeforeLaneBackfill);
    seedMeetupLaneBackfillCases(database);

    const [laneBackfill] = productionFragments(
      migrationSql("0019_meetup_event_lanes.sql"),
    );
    assert.ok(laneBackfill, "the lane backfill must contain one statement");

    const firstRun = database.prepare(laneBackfill).run();
    assert.equal(
      firstRun.changes,
      4,
      "only the four null-lane, active Meetup-linked events are backfilled",
    );
    const firstSnapshot = readMeetupLaneBackfillCases(database);
    assert.deepEqual(firstSnapshot, [
      { event_lane_id: null, id: "deleted-event" },
      { event_lane_id: null, id: "deleted-link" },
      { event_lane_id: "lane-eat", id: "explicit-lane" },
      { event_lane_id: null, id: "manual-null" },
      { event_lane_id: "lane-think", id: "meetup-eyes-wide-shut" },
      { event_lane_id: "lane-eat", id: "meetup-latin-dance" },
      { event_lane_id: "lane-reset", id: "meetup-meditation" },
      { event_lane_id: "lane-explore", id: "meetup-paddleboarding" },
      { event_lane_id: null, id: "non-meetup-link" },
    ]);

    const secondRun = database.prepare(laneBackfill).run();
    assert.equal(secondRun.changes, 0, "replaying the backfill is a no-op");
    assert.deepEqual(readMeetupLaneBackfillCases(database), firstSnapshot);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("every normalized partial migration prefix can be retried safely", () => {
  const reset = productionFragments(migrationSql(EXPECTED_MIGRATIONS[0]));
  const baseline = EXPECTED_MIGRATIONS.slice(1).flatMap((file) =>
    productionFragments(migrationSql(file)),
  );

  for (let cut = 0; cut <= reset.length; cut += 1) {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      seedRepresentativeFailedVersionSevenState(database);
      applyProductionFragments(database, reset.slice(0, cut));
      applyProductionFragments(database, reset);
      applyProductionFragments(database, baseline);
      assertDatabaseSignature(database, EXPECTED_SIGNATURE);
      assert.equal(
        database
          .prepare(
            "SELECT count(*) AS count FROM profiles WHERE id = 'legacy-sentinel'",
          )
          .get().count,
        0,
      );
    } finally {
      database.close();
    }
  }

  for (let cut = 0; cut <= baseline.length; cut += 1) {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      applyProductionFragments(database, reset);
      applyProductionFragments(database, baseline.slice(0, cut));
      applyProductionFragments(database, baseline);
      assertDatabaseSignature(database, EXPECTED_SIGNATURE);
    } finally {
      database.close();
    }
  }
});

test("the reset recovers known rebuild remnants and a failed version-7 schema prefix", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    seedRepresentativeFailedVersionSevenState(database);
    database.exec(`
      CREATE TABLE __new_events (id TEXT PRIMARY KEY);
      CREATE TABLE __new_external_source_links (id TEXT PRIMARY KEY);
      CREATE TABLE __new_sync_sources (id TEXT PRIMARY KEY);
    `);

    applyProductionFragments(database, allProductionFragments());
    assertDatabaseSignature(database, EXPECTED_SIGNATURE);
    assert.deepEqual(
      database
        .prepare(
          `SELECT name
           FROM sqlite_master
           WHERE type = 'table'
             AND name LIKE '__new_%'
           ORDER BY name`,
        )
        .all(),
      [],
    );
  } finally {
    database.close();
  }
});

test("malformed or truncated packaged SQL fails instead of being accepted", () => {
  const firstTable = productionFragments(
    migrationSql("0009_sites_compatible_baseline.sql"),
  )[0];
  const truncated = firstTable.slice(0, firstTable.lastIndexOf(")"));
  const database = new DatabaseSync(":memory:");
  try {
    assert.throws(
      () => database.prepare(truncated).run(),
      /incomplete input/iu,
    );
  } finally {
    database.close();
  }
});

function migrationFiles() {
  return readdirSync(MIGRATION_DIRECTORY)
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort();
}

function migrationSql(file) {
  return readFileSync(join(MIGRATION_DIRECTORY, file), "utf8");
}

function productionFragments(sql) {
  return sql
    .split(";")
    .map((fragment) => fragment.trim())
    .filter(Boolean);
}

function allProductionFragments() {
  return EXPECTED_MIGRATIONS.flatMap((file) =>
    productionFragments(migrationSql(file)),
  );
}

function applyProductionFragments(database, fragments) {
  for (const fragment of fragments) database.prepare(fragment).run();
}

function seedMeetupLaneBackfillCases(database) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'lane-profile', 'email:lane-profile@example.com',
      'lane-profile@example.com', 'Lane profile', 'active', 1, 1
    );

    INSERT INTO organizations (
      id, name, slug, created_by_profile_id, created_at, updated_at
    ) VALUES (
      'lane-org', 'Lane organization', 'lane-organization',
      'lane-profile', 1, 1
    );

    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'lane-club', 'lane-org', 'Lane club', 'lane-club',
      'lane-profile', 1, 1
    );

    INSERT INTO event_lanes (
      id, organization_id, name, slug, sort_order,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      ('lane-think', 'lane-org', 'Think', 'think', 10, 'lane-profile', 1, 1),
      ('lane-reset', 'lane-org', 'Reset & Make', 'reset-and-make', 20, 'lane-profile', 1, 1),
      ('lane-explore', 'lane-org', 'Explore', 'explore', 30, 'lane-profile', 1, 1),
      ('lane-eat', 'lane-org', 'Eat & Play', 'eat-and-play', 40, 'lane-profile', 1, 1);

    INSERT INTO events (
      id, organization_id, club_id, event_lane_id, title, slug,
      status, visibility, time_kind, starts_at_utc, ends_at_utc,
      timezone, organizer_scope_json, schedule_version,
      schedule_review_state, created_by_profile_id,
      updated_by_profile_id, created_at, updated_at, deleted_at
    ) VALUES
      ('meetup-meditation', 'lane-org', 'lane-club', NULL,
       'Meditation + Journaling Circle', 'meetup-meditation',
       'confirmed', 'public', 'timed', 100, 200, 'America/Vancouver',
       '[]', 1, 'unreviewed', 'lane-profile', 'lane-profile', 1, 1, NULL),
      ('meetup-paddleboarding', 'lane-org', 'lane-club', NULL,
       'Last-Minute Paddleboarding at Deep Cove', 'meetup-paddleboarding',
       'confirmed', 'public', 'timed', 300, 400, 'America/Vancouver',
       '[]', 1, 'unreviewed', 'lane-profile', 'lane-profile', 1, 1, NULL),
      ('meetup-latin-dance', 'lane-org', 'lane-club', NULL,
       'Mangos Latin Dance Night', 'meetup-latin-dance',
       'confirmed', 'public', 'timed', 500, 600, 'America/Vancouver',
       '[]', 1, 'unreviewed', 'lane-profile', 'lane-profile', 1, 1, NULL),
      ('meetup-eyes-wide-shut', 'lane-org', 'lane-club', NULL,
       'Eyes Wide Shut - marriage, desire, and rich-people nightmare rituals',
       'meetup-eyes-wide-shut', 'confirmed', 'public', 'timed', 700, 800,
       'America/Vancouver', '[]', 1, 'unreviewed', 'lane-profile',
       'lane-profile', 1, 1, NULL),
      ('explicit-lane', 'lane-org', 'lane-club', 'lane-eat',
       'Meditation + Journaling Circle', 'explicit-lane',
       'confirmed', 'public', 'timed', 900, 1000, 'America/Vancouver',
       '[]', 1, 'unreviewed', 'lane-profile', 'lane-profile', 1, 1, NULL),
      ('manual-null', 'lane-org', 'lane-club', NULL,
       'Meditation + Journaling Circle', 'manual-null',
       'confirmed', 'public', 'timed', 1100, 1200, 'America/Vancouver',
       '[]', 1, 'unreviewed', 'lane-profile', 'lane-profile', 1, 1, NULL),
      ('non-meetup-link', 'lane-org', 'lane-club', NULL,
       'Meditation + Journaling Circle', 'non-meetup-link',
       'confirmed', 'public', 'timed', 1300, 1400, 'America/Vancouver',
       '[]', 1, 'unreviewed', 'lane-profile', 'lane-profile', 1, 1, NULL),
      ('deleted-link', 'lane-org', 'lane-club', NULL,
       'Meditation + Journaling Circle', 'deleted-link',
       'confirmed', 'public', 'timed', 1500, 1600, 'America/Vancouver',
       '[]', 1, 'unreviewed', 'lane-profile', 'lane-profile', 1, 1, NULL),
      ('deleted-event', 'lane-org', 'lane-club', NULL,
       'Meditation + Journaling Circle', 'deleted-event',
       'confirmed', 'public', 'timed', 1700, 1800, 'America/Vancouver',
       '[]', 1, 'unreviewed', 'lane-profile', 'lane-profile', 1, 1, 2);

    INSERT INTO external_source_links (
      id, organization_id, entity_type, entity_id, source_type,
      sync_source_id, external_id, created_at, updated_at, deleted_at
    ) VALUES
      ('link-meditation', 'lane-org', 'event', 'meetup-meditation',
       'meetup_ics', 'lane-source', 'meditation', 1, 1, NULL),
      ('link-paddleboarding', 'lane-org', 'event', 'meetup-paddleboarding',
       'meetup_ics', 'lane-source', 'paddleboarding', 1, 1, NULL),
      ('link-latin-dance', 'lane-org', 'event', 'meetup-latin-dance',
       'meetup_ics', 'lane-source', 'latin-dance', 1, 1, NULL),
      ('link-eyes-wide-shut', 'lane-org', 'event', 'meetup-eyes-wide-shut',
       'meetup_ics', 'lane-source', 'eyes-wide-shut', 1, 1, NULL),
      ('link-explicit', 'lane-org', 'event', 'explicit-lane',
       'meetup_ics', 'lane-source', 'explicit', 1, 1, NULL),
      ('link-non-meetup', 'lane-org', 'event', 'non-meetup-link',
       'csv_import', NULL, 'non-meetup', 1, 1, NULL),
      ('link-deleted', 'lane-org', 'event', 'deleted-link',
       'meetup_ics', 'lane-source', 'deleted-link', 1, 1, 2),
      ('link-deleted-event', 'lane-org', 'event', 'deleted-event',
       'meetup_ics', 'lane-source', 'deleted-event', 1, 1, NULL);
  `);
}

function readMeetupLaneBackfillCases(database) {
  return database
    .prepare(
      `SELECT id, event_lane_id
       FROM events
       WHERE organization_id = 'lane-org'
       ORDER BY id`,
    )
    .all()
    .map((row) => ({ ...row }));
}

function seedRepresentativeFailedVersionSevenState(database) {
  database.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY NOT NULL,
      siwc_subject TEXT NOT NULL,
      normalized_email TEXT NOT NULL,
      display_name TEXT
    );
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      created_by_profile_id TEXT,
      FOREIGN KEY (created_by_profile_id) REFERENCES profiles(id)
    );
    CREATE TABLE clubs (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      club_id TEXT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (club_id) REFERENCES clubs(id)
    );
    CREATE INDEX events_legacy_partial_idx
      ON events (organization_id, slug);
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name
    ) VALUES (
      'legacy-sentinel', 'legacy-subject', 'legacy@example.invalid',
      'Legacy pre-production sentinel'
    );
  `);
}

function assertDatabaseSignature(database, expected) {
  const tables = database
    .prepare(
      `SELECT name, sql
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all();
  const indexes = database
    .prepare(
      `SELECT sql
       FROM sqlite_master
       WHERE type = 'index'
         AND sql IS NOT NULL`,
    )
    .all();
  const triggers = database
    .prepare(
      `SELECT count(*) AS count
       FROM sqlite_master
       WHERE type = 'trigger'`,
    )
    .get().count;
  const checks = tables.reduce(
    (count, row) =>
      count + ([...row.sql.matchAll(/\bCHECK\s*\(/giu)].length),
    0,
  );
  const foreignKeys = tables.reduce(
    (count, row) =>
      count +
      database
        .prepare(`PRAGMA foreign_key_list("${row.name}")`)
        .all().length,
    0,
  );
  const uniqueIndexes = indexes.filter((row) =>
    /^CREATE\s+UNIQUE\s+INDEX\b/iu.test(row.sql),
  ).length;

  assert.deepEqual(
    {
      checks,
      explicitIndexes: indexes.length,
      foreignKeys,
      tables: tables.length,
      triggers: Number(triggers),
      uniqueIndexes,
    },
    expected,
  );
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
}
