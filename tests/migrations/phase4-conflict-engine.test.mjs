import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const DRIZZLE = join(process.cwd(), "drizzle");
const PHASE3_FILES = Object.freeze([
  "0008_preproduction_reset.sql",
  "0009_sites_compatible_baseline.sql",
  "0010_sites_compatible_indexes_a.sql",
  "0011_sites_compatible_indexes_b.sql",
  "0012_phase3_organizer_foundation.sql",
]);
const PHASE4_FILE = "0013_phase4_conflict_engine.sql";
const EXPECTED_SIGNATURE = Object.freeze({
  checks: 91,
  explicitIndexes: 117,
  foreignKeys: 177,
  tables: 52,
  triggers: 0,
  uniqueIndexes: 44,
});
const PHASE4_TABLES = Object.freeze([
  "meetup_snapshot_reservation_normalizations",
  "organizer_conflict_incidents",
  "organizer_conflict_overrides",
  "organizer_conflict_policies",
  "organizer_conflict_review_requests",
  "organizer_external_reservation_intervals",
  "organizer_hold_notice_receipts",
  "organizer_reservation_states",
  "organizer_schedule_write_intents",
]);
const PHASE4_INDEXES = Object.freeze([
  "organizer_conflict_incidents_pair_version_unique",
  "organizer_conflict_incidents_queue_idx",
  "organizer_conflict_incidents_event_idx",
  "organizer_conflict_incidents_conflicting_event_idx",
  "organizer_conflict_overrides_active_incident_unique",
  "organizer_conflict_overrides_event_idx",
  "organizer_conflict_policies_org_unique",
  "organizer_conflict_policies_org_version_idx",
  "organizer_conflict_reviews_queue_idx",
  "organizer_conflict_reviews_event_idx",
  "organizer_external_reservations_source_record_unique",
  "organizer_external_reservations_interval_idx",
  "organizer_external_reservations_expanded_idx",
  "organizer_external_reservations_source_generation_idx",
  "organizer_external_reservations_venue_idx",
  "meetup_snapshot_reservation_normalization_unique",
  "meetup_snapshot_reservation_normalization_generation_idx",
  "meetup_snapshot_reservation_normalization_event_idx",
  "organizer_hold_notice_receipts_dedupe_unique",
  "organizer_hold_notice_receipts_org_event_idx",
  "organizer_reservation_states_interval_idx",
  "organizer_reservation_states_expanded_idx",
  "organizer_reservation_states_venue_idx",
  "organizer_reservation_states_hold_expiry_idx",
  "organizer_reservation_states_club_idx",
  "organizer_schedule_write_intents_event_idx",
  "organizer_schedule_write_intents_actor_idx",
]);
const PHASE4_CHECKS = Object.freeze([
  "organizer_conflict_incidents_versions_check",
  "organizer_conflict_incidents_interval_check",
  "organizer_conflict_incidents_resources_check",
  "organizer_conflict_incidents_fingerprint_check",
  "organizer_conflict_overrides_versions_check",
  "organizer_conflict_overrides_fingerprint_check",
  "organizer_conflict_overrides_reason_check",
  "organizer_conflict_policies_mode_check",
  "organizer_conflict_policies_version_check",
  "organizer_conflict_policies_hold_check",
  "organizer_conflict_reviews_version_check",
  "organizer_conflict_reviews_fingerprint_check",
  "organizer_conflict_reviews_requested_state_check",
  "organizer_conflict_reviews_reason_check",
  "organizer_conflict_reviews_state_check",
  "organizer_external_reservations_source_check",
  "organizer_external_reservations_interval_check",
  "organizer_external_reservations_scope_check",
  "organizer_external_reservations_version_check",
  "organizer_external_reservations_fingerprint_check",
  "meetup_snapshot_reservation_normalization_status_check",
  "meetup_snapshot_reservation_normalization_interval_check",
  "meetup_snapshot_reservation_normalization_scope_check",
  "meetup_snapshot_reservation_normalization_fingerprint_check",
  "meetup_snapshot_reservation_normalization_version_check",
  "organizer_hold_notice_receipts_version_check",
  "organizer_reservation_states_status_check",
  "organizer_reservation_states_interval_check",
  "organizer_reservation_states_scope_check",
  "organizer_reservation_states_hold_check",
  "organizer_reservation_states_version_check",
  "organizer_schedule_write_intents_status_check",
  "organizer_schedule_write_intents_policy_mode_check",
  "organizer_schedule_write_intents_versions_check",
  "organizer_schedule_write_intents_scope_check",
  "organizer_schedule_write_intents_interval_check",
  "organizer_schedule_write_intents_buffer_check",
  "organizer_schedule_write_intents_hold_check",
  "organizer_schedule_write_intents_reason_check",
  "organizer_schedule_write_intents_fingerprint_check",
]);

test("Phase 4 is one additive production-tokenizer-safe migration", () => {
  const journal = json("meta/_journal.json");
  const phase4Entry = journal.entries.find(
    (entry) => entry.tag === "0013_phase4_conflict_engine",
  );
  assert.deepEqual(
    phase4Entry && {
      breakpoints: phase4Entry.breakpoints,
      idx: phase4Entry.idx,
      tag: phase4Entry.tag,
      version: phase4Entry.version,
    },
    {
      breakpoints: true,
      idx: 13,
      tag: "0013_phase4_conflict_engine",
      version: "6",
    },
  );
  assert.deepEqual(
    journal.entries
      .filter(({ idx }) => idx >= 13)
      .map(({ idx, tag }) => ({ idx, tag })),
    [
      { idx: 13, tag: "0013_phase4_conflict_engine" },
      { idx: 14, tag: "0014_phase5_publication" },
      { idx: 15, tag: "0015_phase6_cms_media" },
    ],
    "Phase 4 must remain immutable after the single Phase 5 and Phase 6 migrations",
  );

  const migration = sql(PHASE4_FILE);
  assert.doesNotMatch(migration, /\bCREATE\s+TRIGGER\b/iu);
  assert.doesNotMatch(migration, /\bALTER\s+TABLE\b/iu);
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|INDEX)\b/iu);
  assert.doesNotMatch(migration, /\bPRAGMA\b/iu);
  assert.doesNotMatch(migration, /\bRENAME\s+TO\b/iu);

  const fragments = productionFragments(migration);
  assert.equal(fragments.length, 37);
  assert.ok(
    fragments.length < 50,
    "the packaged migration must remain below the D1 invocation cap",
  );
  for (const fragment of fragments) {
    if (/^CREATE\b/iu.test(fragment)) {
      assert.match(fragment, /\bIF\s+NOT\s+EXISTS\b/iu);
    } else {
      assert.match(fragment, /^INSERT\s+OR\s+IGNORE\b/iu);
    }
  }
});

test("the Phase 4 snapshot follows Phase 3 and matches packaged D1 schema", () => {
  const phase3Snapshot = json("meta/0012_snapshot.json");
  const phase4Snapshot = json("meta/0013_snapshot.json");
  assert.equal(phase4Snapshot.prevId, phase3Snapshot.id);
  assert.notEqual(phase4Snapshot.id, phase3Snapshot.id);

  const database = phase3Database();
  try {
    apply(database, productionFragments(sql(PHASE4_FILE)));
    apply(database, productionFragments(sql(PHASE4_FILE)));
    assertSnapshotColumnParity(database, phase4Snapshot);
    assertDatabaseSignature(database, EXPECTED_SIGNATURE);
    assertPhase4Objects(database, phase4Snapshot);
  } finally {
    database.close();
  }
});

test("every partial Phase 4 prefix and complete double retry converge", () => {
  const fragments = productionFragments(sql(PHASE4_FILE));
  for (let cut = 0; cut <= fragments.length; cut += 1) {
    const database = phase3Database();
    try {
      seedPopulatedPhase3(database);
      apply(database, fragments.slice(0, cut));
      apply(database, fragments);
      apply(database, fragments);

      assertDatabaseSignature(database, EXPECTED_SIGNATURE);
      assert.equal(
        database
          .prepare(
            `SELECT count(*) AS count
             FROM organizer_events
             WHERE id = 'phase3-preserved-draft'
               AND title = 'Preserved private draft'
               AND content_version = 7
               AND schedule_version = 3`,
          )
          .get().count,
        1,
        `partial prefix ${cut} must preserve populated Phase 3 event data`,
      );
      assert.deepEqual(
        {
          ...database
            .prepare(
              `SELECT policy_version, mode, default_hold_hours,
                      nearing_expiry_hours
               FROM organizer_conflict_policies
               WHERE organization_id = 'org-phase3'`,
            )
            .get(),
        },
        {
          default_hold_hours: 72,
          mode: "warn_reason",
          nearing_expiry_hours: 24,
          policy_version: 1,
        },
        `partial prefix ${cut} must converge on one default policy`,
      );
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      database.close();
    }
  }
});

function phase3Database() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  apply(
    database,
    PHASE3_FILES.flatMap((file) => productionFragments(sql(file))),
  );
  return database;
}

function seedPopulatedPhase3(database) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile-phase3', 'subject-phase3', 'phase3@example.test',
      'Phase 3 owner', 'active', 1, 1
    );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'org-phase3', 'Phase 3 organization', 'phase-3-organization',
      'America/Vancouver', 1, 'profile-phase3', 1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership-phase3', 'org-phase3', 'profile-phase3',
      'phase3@example.test', 'owner', 'active', 'profile-phase3', 1, 1
    );
    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'club-phase3', 'org-phase3', 'Phase 3 club', 'phase-3-club',
      'profile-phase3', 1, 1
    );
    INSERT INTO organizer_events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, planning_status, publication_status, schedule_shape,
      starts_at_utc, ends_at_utc, timezone, content_version,
      schedule_version, created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'phase3-preserved-draft', 'org-phase3', 'club-phase3',
      'profile-phase3', 'Preserved private draft',
      'preserved-private-draft', 'draft', 'private', 'timed',
      1900000000000, 1900003600000, 'America/Vancouver', 7, 3,
      'profile-phase3', 'profile-phase3', 1, 1
    );
  `);
}

function assertSnapshotColumnParity(database, snapshot) {
  const actualTables = database
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all()
    .map(({ name }) => name);
  const expectedTables = Object.values(snapshot.tables)
    .map(({ name }) => name)
    .sort();
  assert.deepEqual(actualTables, expectedTables);

  for (const table of Object.values(snapshot.tables)) {
    const actualColumns = database
      .prepare(
        `SELECT name
         FROM pragma_table_info(?)
         ORDER BY cid`,
      )
      .all(table.name)
      .map(({ name }) => name);
    assert.deepEqual(
      actualColumns,
      Object.keys(table.columns),
      `${table.name} columns must match the generated snapshot`,
    );
  }

  const actualIndexes = database
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'index'
         AND sql IS NOT NULL
       ORDER BY name`,
    )
    .all()
    .map(({ name }) => name);
  const expectedIndexes = Object.values(snapshot.tables)
    .flatMap((table) => Object.keys(table.indexes ?? {}))
    .sort();
  assert.deepEqual(actualIndexes, expectedIndexes);
}

function assertPhase4Objects(database, snapshot) {
  const tableNames = new Set(
    database
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'`,
      )
      .all()
      .map(({ name }) => name),
  );
  for (const table of PHASE4_TABLES) {
    assert.ok(tableNames.has(table), `missing Phase 4 table ${table}`);
  }

  const indexNames = new Set(
    database
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'index'`,
      )
      .all()
      .map(({ name }) => name),
  );
  for (const index of PHASE4_INDEXES) {
    assert.ok(indexNames.has(index), `missing Phase 4 index ${index}`);
  }

  const snapshotChecks = new Set(
    Object.values(snapshot.tables).flatMap((table) =>
      Object.keys(table.checkConstraints ?? {}),
    ),
  );
  const tableSql = database
    .prepare(
      `SELECT sql
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'`,
    )
    .all()
    .map(({ sql: value }) => value)
    .join("\n");
  for (const check of PHASE4_CHECKS) {
    assert.ok(snapshotChecks.has(check), `snapshot is missing check ${check}`);
    assert.ok(
      tableSql.includes(`CONSTRAINT \`${check}\``) ||
        tableSql.includes(`CONSTRAINT "${check}"`),
      `packaged SQL is missing check ${check}`,
    );
  }
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
  const checks = tables.reduce(
    (count, row) =>
      count + [...row.sql.matchAll(/\bCHECK\s*\(/giu)].length,
    0,
  );
  const foreignKeys = tables.reduce(
    (count, row) =>
      count +
      database
        .prepare(`PRAGMA foreign_key_list(${JSON.stringify(row.name)})`)
        .all().length,
    0,
  );

  assert.deepEqual(
    {
      checks,
      explicitIndexes: indexes.length,
      foreignKeys,
      tables: tables.length,
      triggers: Number(
        database
          .prepare(
            `SELECT count(*) AS count
             FROM sqlite_master
             WHERE type = 'trigger'`,
          )
          .get().count,
      ),
      uniqueIndexes: indexes.filter((row) =>
        /^CREATE\s+UNIQUE\s+INDEX\b/iu.test(row.sql),
      ).length,
    },
    expected,
  );
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
}

function json(file) {
  return JSON.parse(readFileSync(join(DRIZZLE, file), "utf8"));
}

function sql(file) {
  return readFileSync(join(DRIZZLE, file), "utf8");
}

function productionFragments(value) {
  return value
    .split(";")
    .map((fragment) =>
      fragment.replace(/--> statement-breakpoint/gu, "").trim(),
    )
    .filter(Boolean);
}

function apply(database, fragments) {
  for (const fragment of fragments) database.prepare(fragment).run();
}
