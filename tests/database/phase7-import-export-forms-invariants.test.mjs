import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  PHASE7_INVARIANT_COUNT_SQL,
  PHASE7_INVARIANT_TRIGGER_STATEMENTS,
} from "../../lib/server/database/phase7-invariant-sql.ts";

const DRIZZLE = join(process.cwd(), "drizzle");

test("Phase 7 form mutations require an exact completed write intent", () => {
  const database = fixture();
  try {
    const now = Date.now();
    createSubmission(database, now);
    database
      .prepare(
        `INSERT INTO form_submission_notes (
           id, organization_id, submission_id, author_profile_id,
           body_text, created_at
         ) VALUES ('note-1', 'org-1', 'submission-1', 'owner-1', ?, ?)`,
      )
      .run("Private follow-up note", now);

    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE form_submissions
             SET payload_json = '{"forged":true}', updated_at = ?
             WHERE id = 'submission-1'`,
          )
          .run(now + 1),
      /phase7_form_submission_status_mismatch/iu,
    );
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE form_submission_workflows
             SET canonical_status = 'archived',
                 version = version + 1,
                 updated_by_profile_id = 'owner-1',
                 updated_at = ?
             WHERE submission_id = 'submission-1'`,
          )
          .run(now + 1),
      /phase7_form_workflow_intent_mismatch/iu,
    );
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE form_submission_write_intents
             SET proposed_payload_json = '{"redacted":true}'
             WHERE id = 'intent-create'`,
          )
          .run(),
      /phase7_form_intent_completion_invalid/iu,
    );

    const redactionIntent = database.prepare(
      `INSERT INTO form_submission_write_intents (
         id, organization_id, submission_id, action,
         expected_workflow_version, proposed_workflow_version,
         proposed_canonical_status, proposed_assigned_to_profile_id,
         proposed_payload_json, actor_profile_id, created_at
       ) VALUES (
         'intent-redact', 'org-1', 'submission-1', 'redact',
         1, 2, 'new', NULL, '{"redacted":true}', 'owner-1', ?
       )`,
    );
    redactionIntent.run(now + 2);
    database
      .prepare(
        `UPDATE form_submission_workflows
         SET version = 2,
             write_intent_id = 'intent-redact',
             updated_by_profile_id = 'owner-1',
             updated_at = ?,
             redacted_at = ?,
             redacted_by_profile_id = 'owner-1'
         WHERE submission_id = 'submission-1'`,
      )
      .run(now + 3, now + 3);
    database
      .prepare(
        `UPDATE form_submissions
         SET payload_json = '{"redacted":true}', updated_at = ?
         WHERE id = 'submission-1'`,
      )
      .run(now + 3);
    database
      .prepare(
        `UPDATE form_submission_notes
         SET body_text = '[redacted]',
             redacted_at = ?,
             redacted_by_profile_id = 'owner-1'
         WHERE id = 'note-1'`,
      )
      .run(now + 3);
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         ) VALUES (
           'audit-redact', 'org-1', 'owner-1',
           'form_submission.personal_content_redacted',
           'form_submission', 'submission-1', '{}', ?
         )`,
      )
      .run(now + 3);
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE form_submission_write_intents
             SET completed_at = ?,
                 completion_audit_log_id = 'audit-redact'
             WHERE id = 'intent-redact'`,
          )
          .run(now + 3),
      /phase7_form_intent_completion_mismatch/iu,
    );
    database
      .prepare(
        `UPDATE form_submission_write_intents
         SET proposed_payload_json = '{"redacted":true}'
         WHERE organization_id = 'org-1'
           AND submission_id = 'submission-1'
           AND completed_at IS NOT NULL
           AND proposed_payload_json <> '{"redacted":true}'`,
      )
      .run();
    database
      .prepare(
        `UPDATE form_submission_write_intents
         SET completed_at = ?, completion_audit_log_id = 'audit-redact'
         WHERE id = 'intent-redact'`,
      )
      .run(now + 3);

    assert.deepEqual(
      database
        .prepare(
          `SELECT id, proposed_payload_json
           FROM form_submission_write_intents
           WHERE organization_id = 'org-1'
             AND submission_id = 'submission-1'
           ORDER BY created_at, id`,
        )
        .all()
        .map((row) => ({ ...row })),
      [
        {
          id: "intent-create",
          proposed_payload_json: '{"redacted":true}',
        },
        {
          id: "intent-redact",
          proposed_payload_json: '{"redacted":true}',
        },
      ],
    );
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE form_submission_write_intents
             SET proposed_payload_json = '{"name":"Visitor"}'
             WHERE id = 'intent-create'`,
          )
          .run(),
      /phase7_form_intent_completion_invalid/iu,
    );
    assert.equal(
      database
        .prepare(
          `SELECT body_text
           FROM form_submission_notes
           WHERE id = 'note-1'`,
        )
        .get().body_text,
      "[redacted]",
    );
    assertPhase7CountsZero(database);
    database.exec(
      "DROP TRIGGER form_submission_write_intents_phase7_before_update",
    );
    database
      .prepare(
        `UPDATE form_submission_write_intents
         SET proposed_payload_json = '{"name":"Recovered visitor"}'
         WHERE id = 'intent-create'`,
      )
      .run();
    assert.ok(
      readPhase7Counts(database)[0] > 0,
      "the global submission integrity probe detects retained personal data in a redacted intent history",
    );
  } finally {
    database.close();
  }
});

test("Phase 7 import preview facts freeze at approval", () => {
  const database = fixture();
  try {
    const now = Date.now();
    database
      .prepare(
        `INSERT INTO import_batches (
           id, organization_id, source_type, source_label, status,
           created_by_profile_id, created_at
         ) VALUES (
           'batch-1', 'org-1', 'csv', 'Fixture', 'pending',
           'owner-1', ?
         )`,
      )
      .run(now);
    database
      .prepare(
        `INSERT INTO import_batch_details (
           import_batch_id, organization_id, file_sha256,
           source_namespace, template_version, parser_version,
           encoding, delimiter, column_mapping_json,
           mapping_fingerprint, updated_by_profile_id,
           created_at, updated_at
         ) VALUES (
           'batch-1', 'org-1', ?, 'fixture-source', 1, 1,
           'utf-8', ',', '{}', ?, 'owner-1', ?, ?
         )`,
      )
      .run("a".repeat(64), "b".repeat(64), now, now);
    database
      .prepare(
        `INSERT INTO import_rows (
           id, organization_id, import_batch_id, row_number,
           source_payload_json, normalized_payload_json,
           status, created_at, updated_at
         ) VALUES (
           'row-1', 'org-1', 'batch-1', 2,
           '{"title":"Draft"}',
           '{"externalId":"external-1","title":"Draft"}',
           'accepted', ?, ?
         )`,
      )
      .run(now, now);
    database
      .prepare(
        `INSERT INTO import_row_applications (
           import_row_id, organization_id, import_batch_id,
           normalized_row_fingerprint, idempotency_key,
           preview_result_code, preview_error_codes_json,
           preview_warning_codes_json, created_at, updated_at
         ) VALUES (
           'row-1', 'org-1', 'batch-1', ?, ?,
           'valid', '[]', '[]', ?, ?
         )`,
      )
      .run("c".repeat(64), "d".repeat(64), now, now);
    database
      .prepare(
        `UPDATE import_batch_details
         SET phase = 'previewed',
             preview_fingerprint = ?,
             preview_version = 1,
             total_row_count = 1,
             valid_row_count = 1,
             version = 2,
             updated_by_profile_id = 'owner-1',
             updated_at = ?
         WHERE import_batch_id = 'batch-1'`,
      )
      .run("e".repeat(64), now + 1);
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         ) VALUES (
           'audit-approve', 'org-1', 'owner-1', 'import.approved',
           'import_batch', 'batch-1', ?, ?
         )`,
      )
      .run(
        JSON.stringify({
          previewFingerprint: "e".repeat(64),
          previewVersion: 1,
          selectedRowCount: 1,
          skippedRowCount: 0,
        }),
        now + 2,
      );
    database
      .prepare(
        `UPDATE import_row_applications
         SET approval_action = 'selected',
             application_state = 'approved',
             approved_by_profile_id = 'owner-1',
             approved_at = ?,
             updated_at = ?
         WHERE import_row_id = 'row-1'`,
      )
      .run(now + 2, now + 2);
    database
      .prepare(
        `UPDATE import_batch_details
         SET phase = 'approved',
             selected_row_count = 1,
             pending_row_count = 1,
             approved_by_profile_id = 'owner-1',
             approved_at = ?,
             version = 3,
             updated_by_profile_id = 'owner-1',
             updated_at = ?
         WHERE import_batch_id = 'batch-1'`,
      )
      .run(now + 2, now + 2);

    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE import_rows
             SET normalized_payload_json = '{"title":"Changed"}',
                 updated_at = ?
             WHERE id = 'row-1'`,
          )
          .run(now + 3),
      /phase7_import_row_immutable/iu,
    );
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE import_row_applications
             SET preview_result_code = 'changed', updated_at = ?
             WHERE import_row_id = 'row-1'`,
          )
          .run(now + 3),
      /phase7_import_application_immutable/iu,
    );
    assertPhase7CountsZero(database);
  } finally {
    database.close();
  }
});

test("Phase 7 import redaction rejects missing provenance and preserves only the audited Owner redaction", () => {
  const database = fixture();
  try {
    const now = Date.now();
    const createdAt = now - 7_776_000_000 - 60_000;
    createMember(database, {
      profileId: "admin-1",
      role: "administrator",
      email: "admin@example.test",
    });
    createImportPreview(database, {
      actorProfileId: "admin-1",
      createdAt,
      previewedAt: createdAt + 1,
    });

    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE import_batch_details
             SET phase = 'redacted',
                 version = 3,
                 updated_by_profile_id = 'admin-1',
                 updated_at = ?
             WHERE import_batch_id = 'batch-1'`,
          )
          .run(now),
      /phase7_import_source_redaction_transition_invalid/iu,
    );
    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT phase, source_payload_redacted_at, redacted_by_profile_id
             FROM import_batch_details
             WHERE import_batch_id = 'batch-1'`,
          )
          .get(),
      },
      {
        phase: "previewed",
        source_payload_redacted_at: null,
        redacted_by_profile_id: null,
      },
    );

    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         ) VALUES (
           'audit-redact-import', 'org-1', 'owner-1',
           'import.source_payload_redacted',
           'import_batch', 'batch-1', '{}', ?
         )`,
      )
      .run(now);
    database
      .prepare(
        `UPDATE import_batch_details
         SET phase = 'redacted',
             version = 3,
             source_payload_redacted_at = ?,
             redacted_by_profile_id = 'owner-1',
             updated_by_profile_id = 'owner-1',
             updated_at = ?
         WHERE import_batch_id = 'batch-1'`,
      )
      .run(now, now);
    database
      .prepare(
        `UPDATE import_rows
         SET source_payload_json = '{"redacted":true}',
             normalized_payload_json = '{"redacted":true}',
             updated_at = ?
         WHERE id = 'row-1'`,
      )
      .run(now);

    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE import_rows
             SET source_payload_json = '{"email":"restored@example.test"}',
                 normalized_payload_json = '{"title":"Forged"}',
                 updated_at = ?
             WHERE id = 'row-1'`,
          )
          .run(now + 1),
      /phase7_import_row_immutable/iu,
    );
    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT source_payload_json, normalized_payload_json
             FROM import_rows
             WHERE id = 'row-1'`,
          )
          .get(),
      },
      {
        source_payload_json: '{"redacted":true}',
        normalized_payload_json: '{"redacted":true}',
      },
    );
    assertPhase7CountsZero(database);
  } finally {
    database.close();
  }
});

test("Phase 7 import approval requires exact row decisions, audit, fingerprint, version, and active Administrator provenance", () => {
  const database = fixture();
  try {
    const now = Date.now();
    createMember(database, {
      profileId: "admin-1",
      role: "administrator",
      email: "admin@example.test",
    });
    createImportPreview(database, {
      actorProfileId: "admin-1",
      createdAt: now,
      previewedAt: now + 1,
    });

    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE import_batch_details
             SET phase = 'approved',
                 selected_row_count = 1,
                 pending_row_count = 1,
                 version = 3,
                 updated_by_profile_id = 'admin-1',
                 updated_at = ?
             WHERE import_batch_id = 'batch-1'`,
          )
          .run(now + 2),
      /phase7_import_approval_envelope_invalid/iu,
    );

    recordImportApprovalAudit(database, {
      auditId: "audit-approve-admin",
      actorProfileId: "admin-1",
      approvedAt: now + 2,
      selectedRowCount: 1,
      skippedRowCount: 0,
    });
    assert.throws(
      () =>
        approveImportBatch(database, {
          actorProfileId: "admin-1",
          approvedAt: now + 2,
          selectedRowCount: 1,
          skippedRowCount: 0,
        }),
      /phase7_import_approval_envelope_invalid/iu,
    );

    approveImportRow(database, {
      actorProfileId: "admin-1",
      approvedAt: now + 2,
    });
    approveImportBatch(database, {
      actorProfileId: "admin-1",
      approvedAt: now + 2,
      selectedRowCount: 1,
      skippedRowCount: 0,
    });

    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT phase, preview_fingerprint, preview_version,
                    approved_by_profile_id, approved_at, version
             FROM import_batch_details
             WHERE import_batch_id = 'batch-1'`,
          )
          .get(),
      },
      {
        phase: "approved",
        preview_fingerprint: "e".repeat(64),
        preview_version: 1,
        approved_by_profile_id: "admin-1",
        approved_at: now + 2,
        version: 3,
      },
    );
    assertPhase7CountsZero(database);
  } finally {
    database.close();
  }
});

test("Phase 7 global integrity detects a forged approved batch with pending decisions and no provenance", () => {
  const database = fixture();
  try {
    const now = Date.now();
    createImportPreview(database, {
      actorProfileId: "owner-1",
      createdAt: now,
      previewedAt: now + 1,
    });

    database.exec(
      "DROP TRIGGER import_batch_details_phase7_before_update",
    );
    database
      .prepare(
        `UPDATE import_batch_details
         SET phase = 'approved',
             selected_row_count = 1,
             pending_row_count = 1,
             version = 3,
             updated_by_profile_id = 'owner-1',
             updated_at = ?
         WHERE import_batch_id = 'batch-1'`,
      )
      .run(now + 2);
    installPhase7Triggers(database);

    const counts = readPhase7Counts(database);
    assert.ok(
      counts.some((count) => count > 0),
      `expected forged approval residue to be detected; got ${JSON.stringify(counts)}`,
    );
  } finally {
    database.close();
  }
});

test("Phase 7 import approval rejects a suspended profile even while membership remains active", () => {
  const database = fixture();
  try {
    const now = Date.now();
    createMember(database, {
      profileId: "admin-1",
      role: "administrator",
      email: "admin@example.test",
    });
    createImportPreview(database, {
      actorProfileId: "admin-1",
      createdAt: now,
      previewedAt: now + 1,
    });
    database
      .prepare(
        `UPDATE profiles
         SET status = 'suspended', updated_at = ?
         WHERE id = 'admin-1'`,
      )
      .run(now + 2);
    recordImportApprovalAudit(database, {
      auditId: "audit-suspended-approve",
      actorProfileId: "admin-1",
      approvedAt: now + 3,
      selectedRowCount: 1,
      skippedRowCount: 0,
    });

    assert.throws(
      () =>
        approveImportRow(database, {
          actorProfileId: "admin-1",
          approvedAt: now + 3,
        }),
      /phase7_import_application_approver_invalid/iu,
    );
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE import_batch_details
             SET phase = 'approved',
                 selected_row_count = 1,
                 pending_row_count = 1,
                 approved_by_profile_id = 'admin-1',
                 approved_at = ?,
                 version = 3,
                 updated_by_profile_id = 'owner-1',
                 updated_at = ?
             WHERE import_batch_id = 'batch-1'`,
          )
          .run(now + 3, now + 3),
      /phase7_import_batch_approver_invalid/iu,
    );
    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT approval_action, application_state,
                    approved_by_profile_id, apply_actor_profile_id
             FROM import_row_applications
             WHERE import_row_id = 'row-1'`,
          )
          .get(),
      },
      {
        approval_action: "pending",
        application_state: "previewed",
        approved_by_profile_id: null,
        apply_actor_profile_id: null,
      },
    );
  } finally {
    database.close();
  }
});

test("Phase 7 import application rejects an actor suspended after approval", () => {
  const database = fixture();
  try {
    const now = Date.now();
    createMember(database, {
      profileId: "admin-1",
      role: "administrator",
      email: "admin@example.test",
    });
    createImportPreview(database, {
      actorProfileId: "admin-1",
      createdAt: now,
      previewedAt: now + 1,
    });
    recordImportApprovalAudit(database, {
      auditId: "audit-approve-before-suspension",
      actorProfileId: "admin-1",
      approvedAt: now + 2,
      selectedRowCount: 1,
      skippedRowCount: 0,
    });
    approveImportRow(database, {
      actorProfileId: "admin-1",
      approvedAt: now + 2,
    });
    approveImportBatch(database, {
      actorProfileId: "admin-1",
      approvedAt: now + 2,
      selectedRowCount: 1,
      skippedRowCount: 0,
    });
    database
      .prepare(
        `UPDATE profiles
         SET status = 'suspended', updated_at = ?
         WHERE id = 'admin-1'`,
      )
      .run(now + 3);

    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE import_row_applications
             SET application_state = 'applying',
                 apply_actor_profile_id = 'admin-1',
                 updated_at = ?
             WHERE import_row_id = 'row-1'`,
          )
          .run(now + 4),
      /phase7_import_application_(?:approver|actor)_invalid/iu,
    );
    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT application_state, apply_actor_profile_id
             FROM import_row_applications
             WHERE import_row_id = 'row-1'`,
          )
          .get(),
      },
      {
        application_state: "approved",
        apply_actor_profile_id: null,
      },
    );
  } finally {
    database.close();
  }
});

test("Phase 7 mixed selected, invalid Skip, and hard-duplicate Skip approval reconciles exact counts", () => {
  const database = fixture();
  try {
    const now = Date.now();
    createImportPreview(database, {
      actorProfileId: "owner-1",
      createdAt: now,
      previewedAt: now + 1,
      rows: [
        previewRow({
          id: "row-selected",
          rowNumber: 2,
          fingerprintCharacter: "1",
          idempotencyCharacter: "2",
          status: "accepted",
          previewResultCode: "valid",
        }),
        previewRow({
          id: "row-invalid",
          rowNumber: 3,
          fingerprintCharacter: "3",
          idempotencyCharacter: "4",
          status: "rejected",
          previewResultCode: "invalid",
          previewErrorCodes: ["title_required"],
        }),
        previewRow({
          id: "row-duplicate",
          rowNumber: 4,
          fingerprintCharacter: "5",
          idempotencyCharacter: "6",
          status: "accepted",
          previewResultCode: "hard_duplicate",
          previewWarningCodes: ["hard_duplicate_source"],
        }),
      ],
    });
    recordImportApprovalAudit(database, {
      auditId: "audit-mixed-approval",
      actorProfileId: "owner-1",
      approvedAt: now + 2,
      selectedRowCount: 1,
      skippedRowCount: 2,
    });
    approveImportRow(database, {
      actorProfileId: "owner-1",
      approvedAt: now + 2,
      rowId: "row-selected",
    });
    approveSkippedImportRow(database, {
      actorProfileId: "owner-1",
      approvedAt: now + 2,
      rowId: "row-invalid",
      resultCode: "invalid_preview",
    });
    approveSkippedImportRow(database, {
      actorProfileId: "owner-1",
      approvedAt: now + 2,
      rowId: "row-duplicate",
      resultCode: "hard_duplicate_source",
      duplicateDecision: "skip",
    });
    approveImportBatch(database, {
      actorProfileId: "owner-1",
      approvedAt: now + 2,
      selectedRowCount: 1,
      skippedRowCount: 2,
    });

    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT selected_row_count, skipped_row_count,
                    pending_row_count, imported_row_count, failed_row_count
             FROM import_batch_details
             WHERE import_batch_id = 'batch-1'`,
          )
          .get(),
      },
      {
        selected_row_count: 1,
        skipped_row_count: 2,
        pending_row_count: 1,
        imported_row_count: 0,
        failed_row_count: 0,
      },
    );
    assertPhase7CountsZero(database);
  } finally {
    database.close();
  }
});

test("Phase 7 skipped and failed terminal rows reject null receipts and preserve valid immutable outcomes", () => {
  const skippedDatabase = fixture();
  try {
    const now = Date.now();
    createImportPreview(skippedDatabase, {
      actorProfileId: "owner-1",
      createdAt: now,
      previewedAt: now + 1,
      rows: [
        previewRow({
          id: "row-1",
          rowNumber: 2,
          fingerprintCharacter: "1",
          idempotencyCharacter: "2",
          status: "rejected",
          previewResultCode: "invalid",
          previewErrorCodes: ["title_required"],
        }),
      ],
    });
    recordImportApprovalAudit(skippedDatabase, {
      auditId: "audit-skip-approval",
      actorProfileId: "owner-1",
      approvedAt: now + 2,
      selectedRowCount: 0,
      skippedRowCount: 1,
    });
    assert.throws(
      () =>
        skippedDatabase
          .prepare(
            `UPDATE import_row_applications
             SET approval_action = 'skip',
                 application_state = 'skipped',
                 approved_by_profile_id = 'owner-1',
                 approved_at = ?,
                 updated_at = ?
             WHERE import_row_id = 'row-1'`,
          )
          .run(now + 2, now + 2),
      /phase7_import_approval_transition_invalid/iu,
    );
    approveSkippedImportRow(skippedDatabase, {
      actorProfileId: "owner-1",
      approvedAt: now + 2,
      rowId: "row-1",
      resultCode: "invalid_preview",
    });
    approveImportBatch(skippedDatabase, {
      actorProfileId: "owner-1",
      approvedAt: now + 2,
      selectedRowCount: 0,
      skippedRowCount: 1,
    });
    assertPhase7CountsZero(skippedDatabase);
  } finally {
    skippedDatabase.close();
  }

  const failedDatabase = fixture();
  try {
    const now = Date.now();
    createImportPreview(failedDatabase, {
      actorProfileId: "owner-1",
      createdAt: now,
      previewedAt: now + 1,
    });
    recordImportApprovalAudit(failedDatabase, {
      auditId: "audit-fail-approval",
      actorProfileId: "owner-1",
      approvedAt: now + 2,
      selectedRowCount: 1,
      skippedRowCount: 0,
    });
    approveImportRow(failedDatabase, {
      actorProfileId: "owner-1",
      approvedAt: now + 2,
    });
    approveImportBatch(failedDatabase, {
      actorProfileId: "owner-1",
      approvedAt: now + 2,
      selectedRowCount: 1,
      skippedRowCount: 0,
    });
    assert.throws(
      () =>
        failedDatabase
          .prepare(
            `UPDATE import_row_applications
             SET application_state = 'failed',
                 apply_actor_profile_id = 'owner-1',
                 updated_at = ?
             WHERE import_row_id = 'row-1'`,
          )
          .run(now + 3),
      /phase7_import_application_failed_shape_invalid/iu,
    );
    failedDatabase
      .prepare(
        `UPDATE import_row_applications
         SET application_state = 'failed',
             result_code = 'mapping_unavailable',
             apply_actor_profile_id = 'owner-1',
             applied_at = ?,
             updated_at = ?
         WHERE import_row_id = 'row-1'`,
      )
      .run(now + 3, now + 3);
    assert.throws(
      () =>
        failedDatabase
          .prepare(
            `UPDATE import_row_applications
             SET result_code = 'application_failed', updated_at = ?
             WHERE import_row_id = 'row-1'`,
          )
          .run(now + 4),
      /phase7_import_application_terminal_immutable/iu,
    );
    assertPhase7CountsZero(failedDatabase);
  } finally {
    failedDatabase.close();
  }
});

test("Phase 7 batch completion requires exact row, count, timestamp, base, outcome, and audit reconciliation", () => {
  const database = fixture();
  try {
    const now = Date.now();
    createImportPreview(database, {
      actorProfileId: "owner-1",
      createdAt: now,
      previewedAt: now + 1,
    });
    recordImportApprovalAudit(database, {
      auditId: "audit-completion-approval",
      actorProfileId: "owner-1",
      approvedAt: now + 2,
      selectedRowCount: 1,
      skippedRowCount: 0,
    });
    approveImportRow(database, {
      actorProfileId: "owner-1",
      approvedAt: now + 2,
    });
    approveImportBatch(database, {
      actorProfileId: "owner-1",
      approvedAt: now + 2,
      selectedRowCount: 1,
      skippedRowCount: 0,
    });
    database
      .prepare(
        `UPDATE import_batch_details
         SET phase = 'applying',
             started_at = ?,
             version = 4,
             updated_by_profile_id = 'owner-1',
             updated_at = ?
         WHERE import_batch_id = 'batch-1'`,
      )
      .run(now + 3, now + 3);
    database
      .prepare(
        `UPDATE import_row_applications
         SET application_state = 'failed',
             result_code = 'mapping_unavailable',
             apply_actor_profile_id = 'owner-1',
             applied_at = ?,
             updated_at = ?
         WHERE import_row_id = 'row-1'`,
      )
      .run(now + 4, now + 4);

    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE import_batch_details
             SET phase = 'completed',
                 version = 5,
                 updated_by_profile_id = 'owner-1',
                 updated_at = ?
             WHERE import_batch_id = 'batch-1'`,
          )
          .run(now + 5),
      /phase7_import_completion_envelope_invalid/iu,
    );

    database
      .prepare(
        `UPDATE import_batches
         SET status = 'completed', completed_at = ?
         WHERE id = 'batch-1' AND organization_id = 'org-1'`,
      )
      .run(now + 5);
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         ) VALUES (
           'audit-import-completed', 'org-1', 'owner-1',
           'import.completed', 'import_batch', 'batch-1', ?, ?
         )`,
      )
      .run(
        JSON.stringify({
          selectedRowCount: 1,
          importedRowCount: 0,
          skippedRowCount: 0,
          failedRowCount: 1,
        }),
        now + 5,
      );
    database
      .prepare(
        `UPDATE import_batch_details
         SET phase = 'completed_with_errors',
             outcome_code = 'completed_with_errors',
             application_cursor = 1,
             failed_row_count = 1,
             pending_row_count = 0,
             completed_at = ?,
             version = 5,
             updated_by_profile_id = 'owner-1',
             updated_at = ?
         WHERE import_batch_id = 'batch-1'`,
      )
      .run(now + 5, now + 5);

    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE import_batch_details
             SET completed_at = ?,
                 version = 6,
                 updated_by_profile_id = 'owner-1',
                 updated_at = ?
             WHERE import_batch_id = 'batch-1'`,
          )
          .run(now + 6, now + 6),
      /phase7_import_completion_immutable/iu,
    );
    assertPhase7CountsZero(database);
  } finally {
    database.close();
  }
});

test("Phase 7 rate and private-calendar guards enforce durable bounds", () => {
  const database = fixture();
  try {
    const now = Date.now();
    database
      .prepare(
        `INSERT INTO public_form_rate_windows (
           id, organization_id, action, scope_key, window_started_at,
           window_ends_at, request_count, created_at, updated_at
         ) VALUES (
           'form-rate', 'org-1', 'public_form_scope_15m', ?,
           0, 900000, 5, ?, ?
         )`,
      )
      .run("f".repeat(64), now, now);
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE public_form_rate_windows
             SET request_count = 4, updated_at = ?
             WHERE id = 'form-rate'`,
          )
          .run(now + 1),
      /phase7_public_form_rate_window_immutable/iu,
    );
    for (let index = 0; index < 3; index += 1) {
      database
        .prepare(
          `INSERT INTO ics_subscription_tokens (
             id, organization_id, profile_id, token_hash, label, created_at
           ) VALUES (?, 'org-1', 'owner-1', ?, 'Calendar', ?)`,
        )
        .run(`token-${index}`, `${index}`.repeat(64), now);
    }
    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO ics_subscription_tokens (
               id, organization_id, profile_id, token_hash, label, created_at
             ) VALUES ('token-4', 'org-1', 'owner-1', ?, 'Fourth', ?)`,
          )
          .run("4".repeat(64), now),
      /phase7_ics_subscription_token_invalid/iu,
    );
    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO ics_subscription_tokens (
               id, organization_id, profile_id, token_hash, label, created_at
             ) VALUES ('token-upper', 'org-1', 'owner-1', ?, 'Bad', ?)`,
          )
          .run("A".repeat(64), now),
      /phase7_ics_subscription_token_invalid/iu,
    );
    assertPhase7CountsZero(database);
  } finally {
    database.close();
  }
});

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const files = readdirSync(DRIZZLE)
    .filter((name) => /^\d{4}.*\.sql$/u.test(name))
    .sort();
  for (const file of files) {
    for (const statement of fragments(readFileSync(join(DRIZZLE, file), "utf8"))) {
      database.prepare(statement).run();
    }
  }
  for (const statement of PHASE7_INVARIANT_TRIGGER_STATEMENTS) {
    database.prepare(statement).run();
  }
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'owner-1', 'owner-subject', 'owner@example.test',
      'Owner', 'active', 1, 1
    );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'org-1', 'Fixture organization', 'fixture-organization',
      'America/Vancouver', 1, 'owner-1', 1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email,
      role, status, created_at, updated_at
    ) VALUES (
      'membership-owner', 'org-1', 'owner-1',
      'owner@example.test', 'owner', 'active', 1, 1
    );
  `);
  return database;
}

function createSubmission(database, now) {
  database
    .prepare(
      `INSERT INTO form_submission_write_intents (
         id, organization_id, submission_id, action,
         expected_workflow_version, proposed_workflow_version,
         proposed_canonical_status, proposed_assigned_to_profile_id,
         proposed_payload_json, proposed_public_reference,
         proposed_request_idempotency_hash, proposed_retention_review_at,
         created_at
       ) VALUES (
         'intent-create', 'org-1', 'submission-1', 'create',
         0, 1, 'new', NULL, '{"name":"Visitor"}',
         'VCC-TEST-0001', ?, ?, ?
       )`,
    )
    .run("1".repeat(64), now + 31536000000, now);
  database
    .prepare(
      `INSERT INTO form_submissions (
         id, organization_id, form_key, payload_json, status,
         created_at, updated_at
       ) VALUES (
         'submission-1', 'org-1', 'contact',
         '{"name":"Visitor"}', 'new', ?, ?
       )`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO form_submission_workflows (
         submission_id, organization_id, public_reference,
         canonical_status, request_idempotency_hash,
         retention_review_at, version, write_intent_id,
         created_at, updated_at
       ) VALUES (
         'submission-1', 'org-1', 'VCC-TEST-0001', 'new', ?,
         ?, 1, 'intent-create', ?, ?
       )`,
    )
    .run("1".repeat(64), now + 31536000000, now, now);
  database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action,
         entity_type, entity_id, metadata_json, created_at
       ) VALUES (
         'audit-create', 'org-1', NULL, 'form_submission.created',
         'form_submission', 'submission-1', '{}', ?
       )`,
    )
    .run(now);
  database
    .prepare(
      `UPDATE form_submission_write_intents
       SET completed_at = ?, completion_audit_log_id = 'audit-create'
       WHERE id = 'intent-create'`,
    )
    .run(now);
}

function createMember(
  database,
  { profileId, role, email, status = "active" },
) {
  database
    .prepare(
      `INSERT INTO profiles (
         id, siwc_subject, normalized_email, display_name, status,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 1, 1)`,
    )
    .run(
      profileId,
      `${profileId}-subject`,
      email,
      profileId,
      status,
    );
  database
    .prepare(
      `INSERT INTO organization_memberships (
         id, organization_id, profile_id, normalized_email,
         role, status, created_at, updated_at
       ) VALUES (?, 'org-1', ?, ?, ?, 'active', 1, 1)`,
    )
    .run(`membership-${profileId}`, profileId, email, role);
}

function previewRow({
  id,
  rowNumber,
  fingerprintCharacter,
  idempotencyCharacter,
  status,
  previewResultCode,
  previewErrorCodes = [],
  previewWarningCodes = [],
}) {
  return {
    id,
    rowNumber,
    sourcePayload: { title: `Source ${rowNumber}` },
    normalizedPayload: {
      externalId: `external-${rowNumber}`,
      title: `Normalized ${rowNumber}`,
    },
    status,
    previewResultCode,
    previewErrorCodes,
    previewWarningCodes,
    fingerprint: fingerprintCharacter.repeat(64),
    idempotencyKey: idempotencyCharacter.repeat(64),
  };
}

function createImportPreview(
  database,
  {
    actorProfileId,
    createdAt,
    previewedAt,
    batchId = "batch-1",
    rowId = "row-1",
    rows = null,
  },
) {
  const previewRows =
    rows ??
    [
      {
        id: rowId,
        rowNumber: 2,
        sourcePayload: { title: "Draft" },
        normalizedPayload: {
          externalId: "external-1",
          title: "Draft",
        },
        status: "accepted",
        previewResultCode: "valid",
        previewErrorCodes: [],
        previewWarningCodes: [],
        fingerprint: "c".repeat(64),
        idempotencyKey: "d".repeat(64),
      },
    ];
  database
    .prepare(
      `INSERT INTO import_batches (
         id, organization_id, source_type, source_label, status,
         created_by_profile_id, created_at
       ) VALUES (?, 'org-1', 'csv', 'Fixture', 'pending', ?, ?)`,
    )
    .run(batchId, actorProfileId, createdAt);
  database
    .prepare(
      `INSERT INTO import_batch_details (
         import_batch_id, organization_id, file_sha256,
         source_namespace, template_version, parser_version,
         encoding, delimiter, column_mapping_json,
         mapping_fingerprint, updated_by_profile_id,
         created_at, updated_at
       ) VALUES (
         ?, 'org-1', ?, 'fixture-source', 1, 1,
         'utf-8', ',', '{}', ?, ?, ?, ?
       )`,
    )
    .run(
      batchId,
      "a".repeat(64),
      "b".repeat(64),
      actorProfileId,
      createdAt,
      createdAt,
    );
  for (const row of previewRows) {
    database
      .prepare(
        `INSERT INTO import_rows (
           id, organization_id, import_batch_id, row_number,
           source_payload_json, normalized_payload_json,
           status, created_at, updated_at
         ) VALUES (?, 'org-1', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        batchId,
        row.rowNumber,
        JSON.stringify(row.sourcePayload),
        JSON.stringify(row.normalizedPayload),
        row.status,
        createdAt,
        createdAt,
      );
    database
      .prepare(
        `INSERT INTO import_row_applications (
           import_row_id, organization_id, import_batch_id,
           normalized_row_fingerprint, idempotency_key,
           preview_result_code, preview_error_codes_json,
           preview_warning_codes_json, created_at, updated_at
         ) VALUES (?, 'org-1', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        batchId,
        row.fingerprint,
        row.idempotencyKey,
        row.previewResultCode,
        JSON.stringify(row.previewErrorCodes),
        JSON.stringify(row.previewWarningCodes),
        createdAt,
        createdAt,
      );
  }
  const validRowCount = previewRows.filter(
    (row) => row.status !== "rejected",
  ).length;
  const warningRowCount = previewRows.filter(
    (row) => row.previewWarningCodes.length > 0,
  ).length;
  database
    .prepare(
      `UPDATE import_batch_details
       SET phase = 'previewed',
           preview_fingerprint = ?,
           preview_version = 1,
           total_row_count = ?,
           valid_row_count = ?,
           invalid_row_count = ?,
           warning_row_count = ?,
           version = 2,
           updated_by_profile_id = ?,
           updated_at = ?
       WHERE import_batch_id = ?`,
    )
    .run(
      "e".repeat(64),
      previewRows.length,
      validRowCount,
      previewRows.length - validRowCount,
      warningRowCount,
      actorProfileId,
      previewedAt,
      batchId,
    );
}

function recordImportApprovalAudit(
  database,
  {
    auditId,
    actorProfileId,
    approvedAt,
    selectedRowCount,
    skippedRowCount,
    batchId = "batch-1",
  },
) {
  database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action,
         entity_type, entity_id, metadata_json, created_at
       ) VALUES (
         ?, 'org-1', ?, 'import.approved',
         'import_batch', ?, ?, ?
       )`,
    )
    .run(
      auditId,
      actorProfileId,
      batchId,
      JSON.stringify({
        previewFingerprint: "e".repeat(64),
        previewVersion: 1,
        selectedRowCount,
        skippedRowCount,
      }),
      approvedAt,
    );
}

function approveImportRow(
  database,
  {
    actorProfileId,
    approvedAt,
    rowId = "row-1",
  },
) {
  return database
    .prepare(
      `UPDATE import_row_applications
       SET approval_action = 'selected',
           application_state = 'approved',
           approved_by_profile_id = ?,
           approved_at = ?,
           updated_at = ?
       WHERE import_row_id = ?`,
    )
    .run(actorProfileId, approvedAt, approvedAt, rowId);
}

function approveSkippedImportRow(
  database,
  {
    actorProfileId,
    approvedAt,
    rowId,
    resultCode,
    duplicateDecision = null,
  },
) {
  return database
    .prepare(
      `UPDATE import_row_applications
       SET approval_action = 'skip',
           duplicate_decision = ?,
           application_state = 'skipped',
           result_code = ?,
           approved_by_profile_id = ?,
           apply_actor_profile_id = ?,
           approved_at = ?,
           applied_at = ?,
           updated_at = ?
       WHERE import_row_id = ?`,
    )
    .run(
      duplicateDecision,
      resultCode,
      actorProfileId,
      actorProfileId,
      approvedAt,
      approvedAt,
      approvedAt,
      rowId,
    );
}

function approveImportBatch(
  database,
  {
    actorProfileId,
    approvedAt,
    selectedRowCount,
    skippedRowCount,
    batchId = "batch-1",
  },
) {
  return database
    .prepare(
      `UPDATE import_batch_details
       SET phase = 'approved',
           selected_row_count = ?,
           skipped_row_count = ?,
           pending_row_count = ?,
           approved_by_profile_id = ?,
           approved_at = ?,
           version = 3,
           updated_by_profile_id = ?,
           updated_at = ?
       WHERE import_batch_id = ?`,
    )
    .run(
      selectedRowCount,
      skippedRowCount,
      selectedRowCount,
      actorProfileId,
      approvedAt,
      actorProfileId,
      approvedAt,
      batchId,
    );
}

function installPhase7Triggers(database) {
  for (const statement of PHASE7_INVARIANT_TRIGGER_STATEMENTS) {
    database.prepare(statement).run();
  }
}

function readPhase7Counts(database) {
  return PHASE7_INVARIANT_COUNT_SQL.map((sql) =>
    Number(database.prepare(sql).get().violation_count),
  );
}

function assertPhase7CountsZero(database) {
  assert.deepEqual(
    readPhase7Counts(database),
    PHASE7_INVARIANT_COUNT_SQL.map(() => 0),
  );
}

function fragments(source) {
  return source
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}
