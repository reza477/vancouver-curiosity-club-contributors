import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";
import {
  CSV_IMPORT_CANONICAL_COLUMNS,
} from "../../lib/imports/csv.ts";
import {
  bootstrapInitialOwner,
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import {
  approveCsvImportBatch,
  createCsvImportPreview,
} from "../../lib/server/phase7/imports.ts";
import {
  ensurePublicCatalog,
} from "../../lib/server/public/catalog.ts";
import {
  SqliteD1TestDatabase,
  startSqliteD1StatementRecording,
} from "../auth/sqlite-d1.mjs";
import {
  assertRecordedD1ShapesCompile,
} from "../database/d1-recorded-shapes.mjs";
import {
  productionMigrationFragments,
} from "../../scripts/d1-migration-batches.mjs";

const OWNER_EMAIL = "phase7-import-d1-owner@vcc-tests.invalid";
const OWNER = trustedIdentityFromSites({
  displayName: "Phase 7 import D1 owner",
  email: OWNER_EMAIL,
});
const ROW_COUNT = 2_000;
const NOW = Date.UTC(2031, 0, 1);

test("maximum CSV preview and approval payload statements compile within real D1 limits", async (t) => {
  const database = new SqliteD1TestDatabase(migrations());
  t.after(() => database.close());
  assert.equal(
    await bootstrapInitialOwner(database, OWNER, OWNER_EMAIL, 100),
    true,
  );
  await ensurePublicCatalog(database, OWNER, 110);
  const owner = await database
    .prepare(
      `SELECT membership.organization_id, membership.profile_id
       FROM organization_memberships AS membership
       JOIN profiles AS profile
         ON profile.id = membership.profile_id
       WHERE profile.normalized_email = ?
       LIMIT 1`,
    )
    .bind(OWNER_EMAIL)
    .first();
  database.exec(`
    INSERT INTO organizer_conflict_policies (
      id, organization_id, mode, policy_version, default_hold_hours,
      nearing_expiry_hours, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'phase7-import-d1-policy', '${owner.organization_id}',
      'warn_reason', 1, 72, 24, '${owner.profile_id}', 120, 120
    );
  `);

  const csvBytes = new TextEncoder().encode(maximumCsv());
  const recording = startSqliteD1StatementRecording({
    sourceIncludes: ["/lib/server/phase7/imports.ts"],
  });
  const preview = await createCsvImportPreview(database, OWNER, {
    bytes: csvBytes,
    contentType: "text/csv",
    fileName: "phase7-maximum.csv",
    headerSelections: CSV_IMPORT_CANONICAL_COLUMNS,
    sourceLabel: "Maximum D1 compatibility fixture",
    sourceNamespace: "phase7-d1-maximum",
  });
  assert.equal(preview.rows.length, 50);
  assert.equal(preview.rowPage.total, ROW_COUNT);
  assert.equal(preview.rowPage.hasMore, true);
  assert.equal(preview.batch.validRowCount, ROW_COUNT);
  assert.equal(preview.batch.invalidRowCount, 0);
  const persistedRows = await database
    .prepare(
      `SELECT id
       FROM import_rows
       WHERE import_batch_id = ?
       ORDER BY row_number, id`,
    )
    .bind(preview.batch.batchId)
    .all();
  assert.equal(persistedRows.results.length, ROW_COUNT);

  await approveCsvImportBatch(
    database,
    OWNER,
    preview.batch.batchId,
    {
      decisions: persistedRows.results.map((row) => ({
        action: "selected",
        rowId: row.id,
      })),
      expectedVersion: preview.batch.version,
      previewFingerprint: preview.previewFingerprint,
    },
  );
  const allShapes = recording.stop();
  assert.equal(allShapes.length, 26);
  assert.deepEqual({
    maxBinds: Math.max(
      ...allShapes.map(({ bindings }) => bindings.length),
    ),
    maxBytes: Math.max(
      ...allShapes.map(({ sql }) =>
        new TextEncoder().encode(sql).byteLength,
      ),
    ),
  }, {
    maxBinds: 61,
    maxBytes: 4_592,
  });
  const selected = allShapes.filter(({ sql }) =>
    sql.includes("preview_payload(value) AS") ||
    sql.includes("candidate_payload(value) AS") ||
    sql.includes("decision_payload(value) AS"),
  );
  assert.equal(
    selected.filter(({ sql }) =>
      sql.includes("preview_payload(value) AS"),
    ).length,
    1,
  );
  assert.equal(
    selected.filter(({ sql }) =>
      sql.includes("candidate_payload(value) AS"),
    ).length,
    1,
  );
  assert.equal(
    selected.filter(({ sql }) =>
      sql.includes("decision_payload(value) AS"),
    ).length,
    2,
  );
  const sizes = selected.map(({ bindings, sql }) => ({
    binds: bindings.length,
    bytes: new TextEncoder().encode(sql).byteLength,
    family: sql.includes("preview_payload")
      ? "preview_payload"
      : sql.includes("candidate_payload")
        ? "candidate_payload"
        : "decision_payload",
  }));
  assert.deepEqual(
    sizes.map(({ family }) => family).sort(),
    [
      "candidate_payload",
      "decision_payload",
      "decision_payload",
      "preview_payload",
    ],
  );
  assert.ok(Math.max(...sizes.map(({ binds }) => binds)) < 100);
  assert.ok(Math.max(...sizes.map(({ bytes }) => bytes)) < 100_000);
  assert.deepEqual(sizes, [
    {
      binds: 10,
      bytes: 4_592,
      family: "candidate_payload",
    },
    {
      binds: 61,
      bytes: 1_333,
      family: "preview_payload",
    },
    {
      binds: 12,
      bytes: 3_342,
      family: "decision_payload",
    },
    {
      binds: 8,
      bytes: 1_544,
      family: "decision_payload",
    },
  ]);
  await assertRecordedD1ShapesCompile(allShapes, {
    expectedCount: 26,
    label: "maximum Phase 7 import preview and approval path",
  });

  const densePreview = await createCsvImportPreview(database, OWNER, {
    bytes: new TextEncoder().encode(denseDuplicateCsv(800)),
    contentType: "text/csv",
    fileName: "phase7-dense-duplicates.csv",
    headerSelections: CSV_IMPORT_CANONICAL_COLUMNS,
    sourceLabel: "Dense duplicate D1 compatibility fixture",
    sourceNamespace: "phase7-d1-dense-duplicates",
  });
  assert.equal(densePreview.rowPage.total, 800);
  assert.equal(densePreview.rows[0].previewResultCode, "hard_duplicate");
  assert.equal(densePreview.rows[0].duplicateDetails.length, 8);
  assert.equal(densePreview.rows[0].duplicateDetailsTotal, 799);
  assert.equal(densePreview.rows[0].duplicateDetailsHasMore, true);
  const densePersistence = await database
    .prepare(
      `SELECT count(*) AS exact_count,
              max(length(source_payload_json)) AS max_payload_bytes
       FROM import_rows
       WHERE import_batch_id = ?`,
    )
    .bind(densePreview.batch.batchId)
    .first();
  assert.deepEqual({ ...densePersistence }, {
    exact_count: 800,
    max_payload_bytes: 3_384,
  });
});

test("dense existing-event duplicate and conflict facts execute through real D1 with bounded identities", async (t) => {
  const miniflare = new Miniflare({
    d1Databases: { DB: randomUUID() },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
  });
  t.after(async () => {
    await miniflare.dispose();
  });
  const database = await miniflare.getD1Database("DB");
  const fragments = productionMigrationFragments(migrations());
  for (let index = 0; index < fragments.length; index += 48) {
    await database.batch(
      fragments
        .slice(index, index + 48)
        .map((sql) => database.prepare(sql)),
    );
  }
  assert.equal(
    await bootstrapInitialOwner(database, OWNER, OWNER_EMAIL, NOW),
    true,
  );
  await ensurePublicCatalog(database, OWNER, NOW + 1);
  const owner = await database
    .prepare(
      `SELECT membership.organization_id, membership.profile_id,
              club.id AS club_id
       FROM organization_memberships AS membership
       INNER JOIN profiles AS profile
         ON profile.id = membership.profile_id
       INNER JOIN clubs AS club
         ON club.organization_id = membership.organization_id
        AND club.slug = 'vancouver-curiosity-club'
        AND club.deleted_at IS NULL
       WHERE profile.normalized_email = ?
       LIMIT 1`,
    )
    .bind(OWNER_EMAIL)
    .first();
  await database
    .prepare(
      `INSERT INTO organizer_conflict_policies (
         id, organization_id, mode, policy_version, default_hold_hours,
         nearing_expiry_hours, updated_by_profile_id, created_at,
         updated_at
       ) VALUES (
         'phase7-dense-policy', ?, 'warn_reason', 1, 72, 24, ?, ?, ?
       )`,
    )
    .bind(
      owner.organization_id,
      owner.profile_id,
      NOW,
      NOW,
    )
    .run();
  const startsAt = Date.parse("2032-08-15T18:30:00.000Z");
  const endsAt = Date.parse("2032-08-15T20:30:00.000Z");
  for (let index = 0; index < 800; index += 40) {
    await database.batch(
      Array.from({ length: 40 }, (_, offset) => {
        const sequence = index + offset;
        return database
          .prepare(
            `INSERT INTO organizer_events (
               id, organization_id, club_id,
               primary_organizer_profile_id, title, slug,
               planning_status, publication_status, schedule_shape,
               starts_at_utc, ends_at_utc, timezone,
               buffer_before_minutes, buffer_after_minutes,
               content_version, schedule_version,
               created_by_profile_id, updated_by_profile_id,
               created_at, updated_at, deleted_at
             ) VALUES (
               ?, ?, ?, ?, 'Dense existing timed event', ?,
               'draft', 'private', 'timed', ?, ?,
               'America/Vancouver', 0, 0, 1, 1, ?, ?, ?, ?, NULL
             )`,
          )
          .bind(
            `phase7-dense-event-${sequence}`,
            owner.organization_id,
            owner.club_id,
            owner.profile_id,
            `phase7-dense-event-${sequence}`,
            startsAt,
            endsAt,
            owner.profile_id,
            owner.profile_id,
            NOW,
            NOW,
          );
      }),
    );
  }
  const preview = await createCsvImportPreview(database, OWNER, {
    bytes: new TextEncoder().encode(denseExistingEventCsv()),
    contentType: "text/csv",
    fileName: "phase7-dense-existing.csv",
    headerSelections: CSV_IMPORT_CANONICAL_COLUMNS,
    sourceLabel: "Dense existing event fixture",
    sourceNamespace: "phase7-d1-dense-existing",
  });
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].previewResultCode, "warning");
  assert.equal(preview.rows[0].duplicateDetails.length, 8);
  assert.equal(preview.rows[0].duplicateDetailsTotal, 800);
  assert.equal(preview.rows[0].duplicateDetailsHasMore, true);
  assert.equal(preview.rows[0].conflictDetails.length, 0);
  assert.equal(preview.rows[0].conflictDetailsTotal, 0);
  assert.equal(preview.rows[0].conflictDetailsHasMore, false);
  assert.deepEqual(
    preview.rows[0].duplicateDetails.map((detail) => detail.referenceId),
    Array.from(
      { length: 800 },
      (_, index) => `phase7-dense-event-${index}`,
    ).sort().slice(0, 8),
  );
});

function maximumCsv() {
  const rows = [CSV_IMPORT_CANONICAL_COLUMNS.join(",")];
  for (let index = 1; index <= ROW_COUNT; index += 1) {
    const values = Object.fromEntries(
      CSV_IMPORT_CANONICAL_COLUMNS.map((column) => [column, ""]),
    );
    values.title = `Distinct private idea ${String(index).padStart(4, "0")}`;
    values.club = "vancouver-curiosity-club";
    values.schedule_type = "unscheduled";
    values.planning_status = "idea";
    values.publication_status = "private";
    values.primary_organizer_email = OWNER_EMAIL;
    values.attendance_mode = "undecided";
    rows.push(
      CSV_IMPORT_CANONICAL_COLUMNS.map((column) => values[column]).join(","),
    );
  }
  return `${rows.join("\r\n")}\r\n`;
}

function denseExistingEventCsv() {
  const values = Object.fromEntries(
    CSV_IMPORT_CANONICAL_COLUMNS.map((column) => [column, ""]),
  );
  values.title = "Dense existing timed event";
  values.club = "vancouver-curiosity-club";
  values.schedule_type = "timed";
  values.start_date = "2032-08-15";
  values.start_time = "11:30";
  values.end_date = "2032-08-15";
  values.end_time = "13:30";
  values.timezone = "America/Vancouver";
  values.planning_status = "draft";
  values.publication_status = "private";
  values.primary_organizer_email = OWNER_EMAIL;
  values.attendance_mode = "in_person";
  return [
    CSV_IMPORT_CANONICAL_COLUMNS.join(","),
    CSV_IMPORT_CANONICAL_COLUMNS
      .map((column) => values[column])
      .join(","),
    "",
  ].join("\r\n");
}

function denseDuplicateCsv(count) {
  const values = Object.fromEntries(
    CSV_IMPORT_CANONICAL_COLUMNS.map((column) => [column, ""]),
  );
  values.title = "One repeated private idea";
  values.club = "vancouver-curiosity-club";
  values.schedule_type = "unscheduled";
  values.planning_status = "idea";
  values.publication_status = "private";
  values.primary_organizer_email = OWNER_EMAIL;
  values.attendance_mode = "undecided";
  const row = CSV_IMPORT_CANONICAL_COLUMNS
    .map((column) => values[column])
    .join(",");
  return [
    CSV_IMPORT_CANONICAL_COLUMNS.join(","),
    ...Array.from({ length: count }, () => row),
    "",
  ].join("\r\n");
}

function migrations() {
  return readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) =>
      readFileSync(join(process.cwd(), "drizzle", name), "utf8"),
    )
    .join("\n");
}
