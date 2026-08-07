import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  MAX_D1_MIGRATION_BATCH_STATEMENTS_WITH_LEDGER,
  MAX_D1_MIGRATION_STATEMENTS_PER_BATCH,
  migrationStatementBatches,
} from "../../scripts/d1-migration-batches.mjs";

const DRIZZLE = join(process.cwd(), "drizzle");
const PRE_PHASE7_FILES = Object.freeze([
  "0008_preproduction_reset.sql",
  "0009_sites_compatible_baseline.sql",
  "0010_sites_compatible_indexes_a.sql",
  "0011_sites_compatible_indexes_b.sql",
  "0012_phase3_organizer_foundation.sql",
  "0013_phase4_conflict_engine.sql",
  "0014_phase5_publication.sql",
  "0015_phase6_cms_media.sql",
]);
const PRE_PHASE7_HASHES = Object.freeze([
  "066e8ea2f6bd95e9e9cdd5680031627fd2a63e38d848fff7c31a49517d8da366",
  "956be86cb19dd6bf7f8843585a6014dffeca060bc7cd386606e69a82846afe78",
  "9dce8c6d88a4c84d64e84b9cb969a5204a9b602186750ef2e60d443669f1d319",
  "1b2b571eb745f7b56021fb8f8825344aabd24ea186cfa6efaa638aee01f144ad",
  "897b44d481da7286902302e89dec4d348721940a022e77c0e2b5e5187b883f33",
  "ffd06dcf86c672754c88ef79952411bebc3a3c2a27f5a81b52d8d94234910aa8",
  "b757744ca03d80efbd372021085aaa1a872c31c206e9261d4285d494e439867d",
  "53f13344db9a8f37c34e2c4b9c2fefb0fd6184b842be8a69583f9c2165448091",
]);
const PHASE7_FILE = "0016_phase7_import_export_forms.sql";
const PHASE7_TABLES = Object.freeze([
  "form_submission_notes",
  "form_submission_workflows",
  "form_submission_write_intents",
  "event_calendar_component_revisions",
  "import_batch_details",
  "import_row_applications",
  "public_form_protection_keys",
  "public_form_rate_windows",
]);
const EXPECTED_SIGNATURE = Object.freeze({
  checks: 243,
  explicitIndexes: 199,
  foreignKeys: 298,
  tables: 86,
  triggers: 0,
  uniqueIndexes: 79,
});

test("Phase 7 is one additive retry-safe tokenizer migration", () => {
  assert.deepEqual(
    PRE_PHASE7_FILES.map((file) => sha256(sql(file))),
    PRE_PHASE7_HASHES,
    "migrations 0008 through 0015 must remain byte-for-byte unchanged",
  );
  assert.deepEqual(
    readdirSync(DRIZZLE)
      .filter((name) => /^0016.*\.sql$/u.test(name))
      .sort(),
    [PHASE7_FILE],
  );
  const journal = json("meta/_journal.json");
  assert.deepEqual(
    journal.entries
      .filter(({ idx }) => idx >= 15 && idx <= 16)
      .map(({ idx, tag }) => ({ idx, tag })),
    [
      { idx: 15, tag: "0015_phase6_cms_media" },
      { idx: 16, tag: "0016_phase7_import_export_forms" },
    ],
  );
  assert.equal(
    journal.entries.filter(({ idx }) => idx === 16).length,
    1,
  );

  const migration = sql(PHASE7_FILE);
  assert.doesNotMatch(migration, /\bCREATE\s+TRIGGER\b/iu);
  assert.doesNotMatch(migration, /\bALTER\s+TABLE\b/iu);
  assert.doesNotMatch(migration, /\bDROP\b/iu);
  assert.doesNotMatch(migration, /\bPRAGMA\b/iu);
  assert.doesNotMatch(migration, /\bRENAME\s+TO\b/iu);
  const fragments = productionFragments(migration);
  assert.equal(fragments.length, 23);
  for (const fragment of fragments) {
    assert.match(fragment, /\bCREATE\b/iu);
    assert.match(fragment, /\bIF\s+NOT\s+EXISTS\b/iu);
  }
  const batches = migrationStatementBatches(fragments);
  assert.deepEqual(batches.map((batch) => batch.length), [23]);
  assert.ok(
    batches[0].length <= MAX_D1_MIGRATION_STATEMENTS_PER_BATCH,
  );
  assert.ok(
    batches[0].length + 1 <=
      MAX_D1_MIGRATION_BATCH_STATEMENTS_WITH_LEDGER,
  );
});

test("clean and populated Phase 6 databases gain the exact Phase 7 schema", () => {
  for (const populated of [false, true]) {
    const database = phase6Database();
    try {
      if (populated) seedPhase6Data(database);
      const fragments = productionFragments(sql(PHASE7_FILE));
      apply(database, fragments);
      apply(database, fragments);
      assertSnapshotColumnParity(
        database,
        json("meta/0016_snapshot.json"),
      );
      assertDatabaseSignature(database, EXPECTED_SIGNATURE);
      const tables = new Set(
        database
          .prepare(
            `SELECT name
             FROM sqlite_master
             WHERE type = 'table'`,
          )
          .all()
          .map(({ name }) => name),
      );
      for (const table of PHASE7_TABLES) {
        assert.ok(tables.has(table), `missing Phase 7 table ${table}`);
      }
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
      if (populated) {
        assert.deepEqual(
          {
            ...database
              .prepare(
                `SELECT id, organization_id, status
                 FROM form_submissions
                 WHERE id = 'submission-existing'`,
              )
              .get(),
          },
          {
            id: "submission-existing",
            organization_id: "org-existing",
            status: "new",
          },
        );
        assert.equal(
          database
            .prepare(
              `SELECT count(*) AS count
               FROM import_rows
               WHERE import_batch_id = 'batch-existing'`,
            )
            .get().count,
          1,
        );
      }
    } finally {
      database.close();
    }
  }
});

test("every partial Phase 7 prefix retries to exact convergence", () => {
  const fragments = productionFragments(sql(PHASE7_FILE));
  for (let cut = 0; cut <= fragments.length; cut += 1) {
    const database = phase6Database();
    try {
      seedPhase6Data(database);
      apply(database, fragments.slice(0, cut));
      apply(database, fragments);
      apply(database, fragments);
      assertDatabaseSignature(database, EXPECTED_SIGNATURE);
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      database.close();
    }
  }
});

test("Phase 7 schema constraints reject malformed hashes, rates, and JSON", () => {
  const database = phase7Database();
  try {
    seedPhase6Data(database);
    assert.throws(
      () =>
        database.prepare(
          `INSERT INTO public_form_protection_keys (
             organization_id, key_hex, version, created_at, updated_at
           ) VALUES ('org-existing', ?, 1, 1, 1)`,
        ).run("A".repeat(64)),
      /public_form_protection_keys_material_check/iu,
    );
    assert.throws(
      () =>
        database.prepare(
          `INSERT INTO public_form_rate_windows (
             id, organization_id, action, scope_key,
             window_started_at, window_ends_at, request_count,
             created_at, updated_at
           ) VALUES (
             'rate-too-high', 'org-existing', 'public_form_scope_15m', ?,
             0, 900000, 6, 1, 1
           )`,
        ).run("a".repeat(64)),
      /public_form_rate_windows_count_check/iu,
    );
    assert.throws(
      () =>
        database.prepare(
          `INSERT INTO import_batch_details (
             import_batch_id, organization_id, file_sha256, source_namespace,
             template_version, parser_version, encoding, delimiter,
             column_mapping_json, mapping_fingerprint, phase,
             created_at, updated_at
           ) VALUES (
             'batch-existing', 'org-existing', ?, 'fixture',
             1, 1, 'utf-8', ',', '[]', ?, 'uploaded', 1, 1
           )`,
        ).run("b".repeat(64), "c".repeat(64)),
      /import_batch_details_mapping_json_check/iu,
    );
  } finally {
    database.close();
  }
});

function phase6Database() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  apply(
    database,
    PRE_PHASE7_FILES.flatMap((file) => productionFragments(sql(file))),
  );
  return database;
}

function phase7Database() {
  const database = phase6Database();
  apply(database, productionFragments(sql(PHASE7_FILE)));
  return database;
}

function seedPhase6Data(database) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile-existing', 'subject-existing', 'owner@example.test',
      'Existing Owner', 'active', 1, 1
    );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'org-existing', 'Existing organization', 'existing-organization',
      'America/Vancouver', 1, 'profile-existing', 1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_at, updated_at
    ) VALUES (
      'membership-existing', 'org-existing', 'profile-existing',
      'owner@example.test', 'owner', 'active', 1, 1
    );
    INSERT INTO form_submissions (
      id, organization_id, form_key, payload_json, status,
      created_at, updated_at
    ) VALUES (
      'submission-existing', 'org-existing', 'contact', '{}', 'new', 1, 1
    );
    INSERT INTO import_batches (
      id, organization_id, source_type, source_label, status,
      created_by_profile_id, created_at
    ) VALUES (
      'batch-existing', 'org-existing', 'meetup_ics',
      'Existing calendar import', 'completed', 'profile-existing', 1
    );
    INSERT INTO import_rows (
      id, organization_id, import_batch_id, row_number,
      source_payload_json, normalized_payload_json, status,
      created_at, updated_at
    ) VALUES (
      'row-existing', 'org-existing', 'batch-existing', 1,
      '{}', '{}', 'accepted', 1, 1
    );
  `);
}

function assertSnapshotColumnParity(database, snapshot) {
  const expectedTables = Object.values(snapshot.tables)
    .map(({ name }) => name)
    .sort();
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
  assert.deepEqual(actualTables, expectedTables);
  for (const table of Object.values(snapshot.tables)) {
    const actualColumns = database
      .prepare(`PRAGMA table_info("${table.name}")`)
      .all()
      .map(({ name }) => name)
      .sort();
    assert.deepEqual(
      actualColumns,
      Object.keys(table.columns).sort(),
      `${table.name} columns must match the generated snapshot`,
    );
  }
}

function assertDatabaseSignature(database, expected) {
  const rows = database
    .prepare(
      `SELECT type, name, sql
       FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%'`,
    )
    .all();
  const tables = rows.filter(({ type }) => type === "table");
  const indexes = rows.filter(({ type }) => type === "index");
  const checks = tables.reduce(
    (count, row) =>
      count + (row.sql.match(/\bCHECK\s*\(/giu)?.length ?? 0),
    0,
  );
  const foreignKeys = tables.reduce(
    (count, row) =>
      count +
      database.prepare(`PRAGMA foreign_key_list("${row.name}")`).all().length,
    0,
  );
  assert.deepEqual(
    {
      checks,
      explicitIndexes: indexes.length,
      foreignKeys,
      tables: tables.length,
      triggers: rows.filter(({ type }) => type === "trigger").length,
      uniqueIndexes: indexes.filter(({ sql: indexSql }) =>
        /^CREATE\s+UNIQUE\s+INDEX\b/iu.test(indexSql ?? ""),
      ).length,
    },
    expected,
  );
}

function apply(database, fragments) {
  for (const fragment of fragments) database.prepare(fragment).run();
}

function productionFragments(source) {
  return source
    .split(";")
    .map((fragment) => fragment.trim())
    .filter(Boolean);
}

function sql(file) {
  return readFileSync(join(DRIZZLE, file), "utf8");
}

function json(file) {
  return JSON.parse(readFileSync(join(DRIZZLE, file), "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
