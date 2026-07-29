import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  bootstrapInitialOwner,
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import {
  applyNextCsvImportRow,
  approveCsvImportBatch,
  createCsvImportPreview,
} from "../../lib/server/phase7/imports.ts";
import { ensurePublicCatalog } from "../../lib/server/public/catalog.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const OWNER_EMAIL = "phase7-import-race-owner@vcc-tests.invalid";
const OWNER = trustedIdentityFromSites({
  displayName: "Phase 7 import race owner",
  email: OWNER_EMAIL,
});

test("synchronized approval permits one envelope and no loser audit residue", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.database.close());
  const preview = await createOneRowPreview(
    fixture.database,
    "approval-race",
    "approval-race-1",
    "Synchronized approval",
  );
  const input = approvalInput(preview);
  const [first, second] = synchronizedBatchDatabases(
    fixture.database,
    2,
  );
  const outcomes = await Promise.allSettled([
    approveCsvImportBatch(
      first,
      OWNER,
      preview.batch.batchId,
      input,
    ),
    approveCsvImportBatch(
      second,
      OWNER,
      preview.batch.batchId,
      input,
    ),
  ]);

  assert.equal(
    outcomes.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  assert.equal(
    outcomes.filter(({ status }) => status === "rejected").length,
    1,
  );
  assert.equal(
    await count(
      fixture.database,
      `SELECT count(*) AS count
       FROM audit_logs
       WHERE organization_id = ?
         AND action = 'import.approved'
         AND entity_type = 'import_batch'
         AND entity_id = ?`,
      fixture.organizationId,
      preview.batch.batchId,
    ),
    1,
  );
  const detail = await row(
    fixture.database,
    `SELECT phase, version, selected_row_count, pending_row_count
     FROM import_batch_details
     WHERE import_batch_id = ?`,
    preview.batch.batchId,
  );
  assert.deepEqual({ ...detail }, {
    pending_row_count: 1,
    phase: "approved",
    selected_row_count: 1,
    version: preview.batch.version + 1,
  });
});

test("lease theft before successful finalization rolls back every event and import receipt", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.database.close());
  const preview = await createOneRowPreview(
    fixture.database,
    "lease-success",
    "lease-success-1",
    "Lease theft successful path",
  );
  const approved = await approveCsvImportBatch(
    fixture.database,
    OWNER,
    preview.batch.batchId,
    approvalInput(preview),
  );
  const intercepted = interceptFinalizationBatch(
    fixture.database,
    preview.batch.batchId,
    (statements) =>
      statements.some(({ sql }) =>
        sql.includes("INSERT INTO external_source_links"),
      ),
  );

  await assert.rejects(
    applyNextCsvImportRow(
      intercepted.database,
      OWNER,
      preview.batch.batchId,
      approved.batch.version,
    ),
  );
  assert.equal(intercepted.intercepted(), true);
  const residue = await importResidue(
    fixture.database,
    preview.batch.batchId,
    preview.rows[0].rowId,
    "Lease theft successful path",
    "lease-success",
  );
  assert.deepEqual(
    importBatchResidue(residue),
    intercepted.snapshot(),
  );
  assert.equal(residue.eventCount, 0);
  assert.equal(residue.sourceCount, 0);
  assert.deepEqual({ ...residue.row }, {
    application_state: "applying",
    applied_at: null,
    result_code: null,
    target_organizer_event_id: null,
  });
});

test("failed-row finalization sentinel rolls back every partial audit and outcome", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.database.close());
  const first = await createOneRowPreview(
    fixture.database,
    "failed-finalize",
    "shared-external-id",
    "Duplicate source first",
  );
  const second = await createOneRowPreview(
    fixture.database,
    "failed-finalize",
    "shared-external-id",
    "Duplicate source second",
  );
  const [firstApproved, secondApproved] = await Promise.all([
    approveCsvImportBatch(
      fixture.database,
      OWNER,
      first.batch.batchId,
      approvalInput(first),
    ),
    approveCsvImportBatch(
      fixture.database,
      OWNER,
      second.batch.batchId,
      approvalInput(second),
    ),
  ]);
  const firstResult = await applyNextCsvImportRow(
    fixture.database,
    OWNER,
    first.batch.batchId,
    firstApproved.batch.version,
  );
  assert.equal(firstResult.row.resultCode, "imported_private");

  const intercepted = interceptFinalizationBatch(
    fixture.database,
    second.batch.batchId,
    (statements) =>
      statements.some(({ sql }) =>
        sql.includes("SET application_state = 'failed'"),
      ),
  );
  await assert.rejects(
    applyNextCsvImportRow(
      intercepted.database,
      OWNER,
      second.batch.batchId,
      secondApproved.batch.version,
    ),
  );
  assert.equal(intercepted.intercepted(), true);
  const residue = await importResidue(
    fixture.database,
    second.batch.batchId,
    second.rows[0].rowId,
    "Duplicate source second",
    "failed-finalize",
  );
  assert.deepEqual(
    importBatchResidue(residue),
    intercepted.snapshot(),
  );
  assert.equal(residue.eventCount, 0);
  assert.equal(residue.sourceCount, 1);
  assert.deepEqual({ ...residue.row }, {
    application_state: "applying",
    applied_at: null,
    result_code: null,
    target_organizer_event_id: null,
  });
  assert.equal(
    await count(
      fixture.database,
      `SELECT count(*) AS count
       FROM organizer_events
       WHERE organization_id = ?
         AND title IN ('Duplicate source first', 'Duplicate source second')`,
      fixture.organizationId,
    ),
    1,
  );
});

async function createFixture() {
  const database = new SqliteD1TestDatabase(migrations());
  assert.equal(
    await bootstrapInitialOwner(database, OWNER, OWNER_EMAIL, 100),
    true,
  );
  await ensurePublicCatalog(database, OWNER, 110);
  const membership = await row(
    database,
    `SELECT organization_id, profile_id
     FROM organization_memberships
     WHERE normalized_email = ?
       AND role = 'owner'
       AND status = 'active'
       AND deleted_at IS NULL`,
    OWNER_EMAIL,
  );
  await database
    .prepare(
      `INSERT INTO organizer_conflict_policies (
         id, organization_id, mode, policy_version, default_hold_hours,
         nearing_expiry_hours, updated_by_profile_id, created_at,
         updated_at
       ) VALUES (?, ?, 'warn_reason', 1, 72, 24, ?, 120, 120)`,
    )
    .bind(
      "phase7-import-race-policy",
      membership.organization_id,
      membership.profile_id,
    )
    .run();
  return Object.freeze({
    database,
    organizationId: membership.organization_id,
  });
}

async function createOneRowPreview(
  database,
  sourceNamespace,
  externalId,
  title,
) {
  const headers = [
    "external_id",
    "title",
    "club",
    "schedule_type",
    "planning_status",
    "publication_status",
    "primary_organizer_email",
    "attendance_mode",
  ];
  const values = [
    externalId,
    title,
    "vancouver-curiosity-club",
    "unscheduled",
    "idea",
    "private",
    OWNER_EMAIL,
    "undecided",
  ];
  const preview = await createCsvImportPreview(database, OWNER, {
    bytes: new TextEncoder().encode(
      `${headers.join(",")}\r\n${values.join(",")}\r\n`,
    ),
    contentType: "text/csv",
    fileName: `${externalId}.csv`,
    headerSelections: headers,
    sourceLabel: "Phase 7 import concurrency fixture",
    sourceNamespace,
  });
  assert.equal(preview.batch.validRowCount, 1);
  assert.equal(preview.batch.invalidRowCount, 0);
  assert.equal(preview.rows[0].canSelect, true);
  return preview;
}

function approvalInput(preview) {
  return {
    decisions: [{
      action: "selected",
      rowId: preview.rows[0].rowId,
    }],
    expectedVersion: preview.batch.version,
    previewFingerprint: preview.previewFingerprint,
  };
}

function synchronizedBatchDatabases(database, count) {
  let arrivals = 0;
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  return Array.from({ length: count }, () => ({
    prepare(sql) {
      return database.prepare(sql);
    },
    async batch(statements) {
      arrivals += 1;
      if (arrivals === count) release();
      await barrier;
      return database.batch(statements);
    },
  }));
}

function interceptFinalizationBatch(database, batchId, predicate) {
  let captured = null;
  let didIntercept = false;
  return Object.freeze({
    database: {
      prepare(sql) {
        return database.prepare(sql);
      },
      async batch(statements) {
        if (!didIntercept && predicate(statements)) {
          didIntercept = true;
          database.exec(`
            UPDATE import_batch_details
            SET active_runner_lease_hash =
                  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
            WHERE import_batch_id = '${batchId}';
          `);
          captured = await importResidueForBatch(
            database,
            batchId,
          );
        }
        return database.batch(statements);
      },
    },
    intercepted() {
      return didIntercept;
    },
    snapshot() {
      assert.ok(captured, "expected a captured post-theft snapshot");
      return captured;
    },
  });
}

async function importResidue(
  database,
  batchId,
  rowId,
  title,
  sourceNamespace,
) {
  return {
    ...await importResidueForBatch(database, batchId),
    eventCount: await count(
      database,
      `SELECT count(*) AS count
       FROM organizer_events
       WHERE title = ?`,
      title,
    ),
    row: await row(
      database,
      `SELECT application_state, result_code,
              target_organizer_event_id, applied_at
       FROM import_row_applications
       WHERE import_row_id = ?`,
      rowId,
    ),
    sourceCount: await count(
      database,
      `SELECT count(*) AS count
       FROM external_source_links
       WHERE source_type = 'csv'
         AND sync_source_id = ?`,
      sourceNamespace,
    ),
  };
}

async function importResidueForBatch(database, batchId) {
  return {
    auditCount: await count(
      database,
      `SELECT count(*) AS count
       FROM audit_logs
       WHERE entity_type = 'import_batch'
         AND entity_id = ?
         AND action IN ('import.row_applied', 'import.completed')`,
      batchId,
    ),
    batch: await row(
      database,
      `SELECT status, completed_at
       FROM import_batches
       WHERE id = ?`,
      batchId,
    ),
    detail: await row(
      database,
      `SELECT phase, outcome_code, application_cursor, version,
              imported_row_count, failed_row_count, pending_row_count,
              active_runner_version, active_runner_lease_hash,
              active_runner_expires_at
       FROM import_batch_details
       WHERE import_batch_id = ?`,
      batchId,
    ),
  };
}

function importBatchResidue(residue) {
  return {
    auditCount: residue.auditCount,
    batch: residue.batch,
    detail: residue.detail,
  };
}

async function count(database, sql, ...bindings) {
  return Number(
    await database.prepare(sql).bind(...bindings).first("count"),
  );
}

async function row(database, sql, ...bindings) {
  const value = await database.prepare(sql).bind(...bindings).first();
  assert.ok(value, "expected one durable row");
  return value;
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
