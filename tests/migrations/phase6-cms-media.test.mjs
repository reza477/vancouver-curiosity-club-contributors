import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  applyD1MigrationBatches,
  MAX_D1_MIGRATION_BATCH_STATEMENTS_WITH_LEDGER,
  MAX_D1_MIGRATION_STATEMENTS_PER_BATCH,
  migrationStatementBatches,
} from "../../scripts/d1-migration-batches.mjs";

const DRIZZLE = join(process.cwd(), "drizzle");
const PRE_PHASE6_FILES = Object.freeze([
  "0008_preproduction_reset.sql",
  "0009_sites_compatible_baseline.sql",
  "0010_sites_compatible_indexes_a.sql",
  "0011_sites_compatible_indexes_b.sql",
  "0012_phase3_organizer_foundation.sql",
  "0013_phase4_conflict_engine.sql",
  "0014_phase5_publication.sql",
]);
const PHASE6_FILE = "0015_phase6_cms_media.sql";
const PHASE6_TABLES = Object.freeze([
  "category_taxonomy_states",
  "club_public_profile_details",
  "cms_adoption_states",
  "cms_entity_publication_states",
  "cms_entity_revisions",
  "cms_public_materialization_receipts",
  "community_link_public_details",
  "event_lane_taxonomy_states",
  "legal_status_confirmation_receipts",
  "media_asset_details",
  "media_asset_variants",
  "media_usage_references",
  "organizer_event_public_metadata",
  "organizer_public_attribution_receipts",
  "organizer_public_attribution_states",
  "organizer_public_attribution_write_intents",
  "page_public_metadata",
  "program_public_profile_details",
  "public_slug_redirects",
  "taxonomy_write_intents",
]);
const EXPECTED_SIGNATURE = Object.freeze({
  checks: 194,
  explicitIndexes: 184,
  foreignKeys: 273,
  tables: 78,
  triggers: 0,
  uniqueIndexes: 73,
});

test("Phase 6 is exactly one additive retry-safe tokenizer migration", () => {
  const journal = json("meta/_journal.json");
  assert.deepEqual(
    journal.entries
      .filter(({ idx }) => idx >= 14)
      .map(({ idx, tag }) => ({ idx, tag })),
    [
      { idx: 14, tag: "0014_phase5_publication" },
      { idx: 15, tag: "0015_phase6_cms_media" },
    ],
  );
  assert.equal(
    journal.entries.filter(({ idx }) => idx === 15).length,
    1,
    "Phase 6 must have one and only one migration",
  );

  const migration = sql(PHASE6_FILE);
  assert.doesNotMatch(migration, /\bCREATE\s+TRIGGER\b/iu);
  assert.doesNotMatch(migration, /\bALTER\s+TABLE\b/iu);
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|INDEX)\b/iu);
  assert.doesNotMatch(migration, /\bPRAGMA\b/iu);
  assert.doesNotMatch(migration, /\bRENAME\s+TO\b/iu);

  const fragments = productionFragments(migration);
  assert.equal(fragments.length, 73);
  const batches = migrationStatementBatches(fragments);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [48, 25],
  );
  assert.ok(
    batches.every(
      (batch) =>
        batch.length <= MAX_D1_MIGRATION_STATEMENTS_PER_BATCH,
    ),
  );
  assert.ok(
    batches.every(
      (batch, index) =>
        batch.length + (index === batches.length - 1 ? 1 : 0) <=
        MAX_D1_MIGRATION_BATCH_STATEMENTS_WITH_LEDGER,
    ),
  );
  for (const [index, fragment] of fragments.entries()) {
    const statement = fragment
      .replace(/^(?:\s*--[^\r\n]*(?:\r?\n|$))+/u, "")
      .trimStart();
    assert.match(statement, /^CREATE\b/iu);
    assert.doesNotMatch(statement, /^(?:INSERT|UPDATE|DELETE)\b/iu);
    assert.match(statement, /\bIF\s+NOT\s+EXISTS\b/iu);
    const database = phase5Database();
    try {
      apply(database, fragments.slice(0, index));
      database.prepare(fragment).run();
    } finally {
      database.close();
    }
  }
});

test("the ledger is committed only with the final bounded D1 batch", async () => {
  const fragments = productionFragments(sql(PHASE6_FILE));
  const ledgerStatement = Object.freeze({ kind: "ledger" });
  const interrupted = fakeD1Database({ failBatch: 2 });

  await assert.rejects(
    applyD1MigrationBatches({
      database: interrupted,
      statements: fragments,
      finalStatement: ledgerStatement,
    }),
    /simulated migration interruption/iu,
  );
  assert.deepEqual(
    interrupted.calls.map((batch) => batch.length),
    [48, 26],
  );
  assert.equal(interrupted.ledgerCommitted, false);

  const retried = fakeD1Database();
  const result = await applyD1MigrationBatches({
    database: retried,
    statements: fragments,
    finalStatement: ledgerStatement,
  });
  assert.deepEqual(result.batchStatementCounts, [48, 26]);
  assert.equal(retried.ledgerCommitted, true);
  assert.equal(
    retried.calls
      .slice(0, -1)
      .some((batch) => batch.includes(ledgerStatement)),
    false,
  );
  assert.equal(
    retried.calls.at(-1).filter((statement) => statement === ledgerStatement)
      .length,
    1,
  );
});

test("Phase 6 snapshot follows Phase 5 and matches the packaged schema", () => {
  const phase5Snapshot = json("meta/0014_snapshot.json");
  const phase6Snapshot = json("meta/0015_snapshot.json");
  assert.equal(phase6Snapshot.prevId, phase5Snapshot.id);
  assert.notEqual(phase6Snapshot.id, phase5Snapshot.id);

  const database = phase5Database();
  try {
    apply(database, productionFragments(sql(PHASE6_FILE)));
    apply(database, productionFragments(sql(PHASE6_FILE)));
    assertSnapshotColumnParity(database, phase6Snapshot);
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
    for (const table of PHASE6_TABLES) {
      assert.ok(tables.has(table), `missing Phase 6 table ${table}`);
    }
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("every partial Phase 6 prefix and complete retry preserve Phase 5 public data", () => {
  const fragments = productionFragments(sql(PHASE6_FILE));
  for (let cut = 0; cut <= fragments.length; cut += 1) {
    const database = phase5Database();
    try {
      seedPopulatedPhase5(database);
      const before = readPublicSentinels(database);
      apply(database, fragments.slice(0, cut));
      apply(database, fragments);
      apply(database, fragments);

      assert.deepEqual(
        readPublicSentinels(database),
        before,
        `partial prefix ${cut} must not rewrite published Phase 5 content`,
      );
      assertDatabaseSignature(database, EXPECTED_SIGNATURE);
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(
        database
          .prepare(
            `SELECT count(*) AS count
             FROM cms_adoption_states`,
          )
          .get().count,
        0,
        "migration cannot claim that private CMS adoption ran",
      );
    } finally {
      database.close();
    }
  }
});

test("malformed and truncated Phase 6 SQL fail instead of being accepted", () => {
  const first = productionFragments(sql(PHASE6_FILE))[0];
  const truncated = first.slice(0, first.lastIndexOf(")"));
  const database = phase5Database();
  try {
    assert.throws(
      () => database.prepare(truncated).run(),
      /incomplete input/iu,
    );
  } finally {
    database.close();
  }
});

function phase5Database() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  apply(
    database,
    PRE_PHASE6_FILES.flatMap((file) => productionFragments(sql(file))),
  );
  return database;
}

function seedPopulatedPhase5(database) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name,
      public_attribution_consent, status, created_at, updated_at
    ) VALUES (
      'phase6-owner', 'phase6-subject', 'phase6@example.test',
      'Phase 6 owner', 0, 'active', 1, 1
    );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'phase6-org', 'Phase 6 organization', 'phase6-organization',
      'America/Vancouver', 1, 'phase6-owner', 1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'phase6-membership', 'phase6-org', 'phase6-owner',
      'phase6@example.test', 'owner', 'active', 'phase6-owner', 1, 1
    );
    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'phase6-club', 'phase6-org', 'Existing club', 'existing-club',
      'phase6-owner', 1, 1
    );
    INSERT INTO event_lanes (
      id, organization_id, name, slug, sort_order,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'phase6-lane', 'phase6-org', 'Think', 'think', 1,
      'phase6-owner', 1, 1
    );
    INSERT INTO club_public_profiles (
      club_id, organization_id, primary_event_lane_id,
      publication_status, is_featured, description, public_group_url,
      published_at, created_at, updated_at
    ) VALUES (
      'phase6-club', 'phase6-org', 'phase6-lane', 'published', 1,
      'Existing club description',
      'https://www.meetup.com/example-group/', 10, 1, 1
    );
    INSERT INTO pages (
      id, organization_id, title, slug, status, visibility,
      current_revision, published_at, created_by_profile_id,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'phase6-page', 'phase6-org', 'Existing page', 'existing-page',
      'published', 'public', 1, 10, 'phase6-owner',
      'phase6-owner', 1, 1
    );
    INSERT INTO page_sections (
      id, organization_id, page_id, section_key, section_type,
      content_json, sort_order, created_at, updated_at
    ) VALUES (
      'phase6-section', 'phase6-org', 'phase6-page', 'intro', 'intro',
      '{"text":"Existing public copy"}', 0, 1, 1
    );
    INSERT INTO page_revisions (
      id, organization_id, page_id, revision_number, snapshot_json,
      actor_profile_id, created_at
    ) VALUES (
      'phase6-page-revision', 'phase6-org', 'phase6-page', 1,
      '{"blocks":[{"type":"intro","text":"Existing public copy"}]}',
      'phase6-owner', 1
    );
    INSERT INTO community_links (
      id, organization_id, label, url, link_type, is_published,
      sort_order, created_by_profile_id, created_at, updated_at
    ) VALUES (
      'phase6-community-link', 'phase6-org', 'Existing Meetup group',
      'https://www.meetup.com/example-group/', 'meetup_group', 1,
      1, 'phase6-owner', 1, 1
    );
    INSERT INTO navigation_items (
      id, organization_id, label, placement, page_id, sort_order,
      is_published, created_by_profile_id, created_at, updated_at
    ) VALUES (
      'phase6-navigation', 'phase6-org', 'Existing page', 'header',
      'phase6-page', 1, 1, 'phase6-owner', 1, 1
    );
    INSERT INTO site_settings (
      id, organization_id, key, value_json, is_public,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'phase6-setting', 'phase6-org', 'identity',
      '{"brandName":"Existing identity"}', 1, 'phase6-owner', 1, 1
    );
    INSERT INTO media_assets (
      id, organization_id, object_key, file_name, mime_type, byte_size,
      alt_text, credit, rights_status, participant_consent_status,
      is_public, uploaded_by_profile_id, created_at, updated_at
    ) VALUES (
      'phase6-media', 'phase6-org', 'private/original-key',
      'existing.png', 'image/png', 1234, 'Existing artwork',
      'Existing credit', 'approved', 'not_applicable', 1,
      'phase6-owner', 1, 1
    );
  `);
}

function readPublicSentinels(database) {
  return Object.freeze({
    club: database
      .prepare(
        `SELECT publication_status, is_featured, description,
                public_group_url, published_at
         FROM club_public_profiles
         WHERE club_id = 'phase6-club'`,
      )
      .get(),
    community: database
      .prepare(
        `SELECT label, url, link_type, is_published, sort_order
         FROM community_links
         WHERE id = 'phase6-community-link'`,
      )
      .get(),
    navigation: database
      .prepare(
        `SELECT label, placement, page_id, is_published, sort_order
         FROM navigation_items
         WHERE id = 'phase6-navigation'`,
      )
      .get(),
    page: database
      .prepare(
        `SELECT title, slug, status, visibility, current_revision,
                published_at
         FROM pages
         WHERE id = 'phase6-page'`,
      )
      .get(),
    section: database
      .prepare(
        `SELECT section_key, section_type, content_json, sort_order
         FROM page_sections
         WHERE id = 'phase6-section'`,
      )
      .get(),
    setting: database
      .prepare(
        `SELECT key, value_json, is_public
         FROM site_settings
         WHERE id = 'phase6-setting'`,
      )
      .get(),
  });
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
  assert.deepEqual(
    {
      checks: tables.reduce(
        (count, row) =>
          count + [...row.sql.matchAll(/\bCHECK\s*\(/giu)].length,
        0,
      ),
      explicitIndexes: indexes.length,
      foreignKeys: tables.reduce(
        (count, row) =>
          count +
          database
            .prepare(`PRAGMA foreign_key_list(${JSON.stringify(row.name)})`)
            .all().length,
        0,
      ),
      tables: tables.length,
      triggers: Number(triggers),
      uniqueIndexes: indexes.filter((row) =>
        /^CREATE\s+UNIQUE\s+INDEX\b/iu.test(row.sql),
      ).length,
    },
    expected,
  );
}

function json(file) {
  return JSON.parse(readFileSync(join(DRIZZLE, file), "utf8"));
}

function sql(file) {
  return readFileSync(join(DRIZZLE, file), "utf8");
}

function productionFragments(source) {
  return source
    .split(";")
    .map((fragment) => fragment.trim())
    .filter(Boolean);
}

function apply(database, fragments) {
  for (const fragment of fragments) database.prepare(fragment).run();
}

function fakeD1Database({ failBatch } = {}) {
  const state = {
    calls: [],
    ledgerCommitted: false,
    prepare(statement) {
      return Object.freeze({ kind: "sql", statement });
    },
    async batch(statements) {
      state.calls.push([...statements]);
      if (state.calls.length === failBatch) {
        throw new Error("simulated migration interruption");
      }
      if (statements.some((statement) => statement.kind === "ledger")) {
        state.ledgerCommitted = true;
      }
      return statements.map(() => ({ success: true }));
    },
  };
  return state;
}
