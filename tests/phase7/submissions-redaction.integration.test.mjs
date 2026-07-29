import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  bootstrapInitialOwner,
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import {
  PHASE7_INVARIANT_COUNT_SQL,
  PHASE7_INVARIANT_TRIGGER_STATEMENTS,
} from "../../lib/server/database/phase7-invariant-sql.ts";
import { submitPublicForm } from "../../lib/server/phase7/public-forms.ts";
import {
  appendFormSubmissionNote,
  redactFormSubmissionPersonalContent,
} from "../../lib/server/phase7/submissions.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const OWNER_EMAIL = "phase7-owner@vcc-tests.invalid";
const PRIVATE_NOTE = "Call the visitor only after reviewing their question.";
const VISITOR_EMAIL = "visitor@vcc-tests.invalid";
const VISITOR_MESSAGE =
  "Please help me understand the accessibility arrangements.";
const VISITOR_NAME = "Private Visitor";

function loadGeneratedMigrations() {
  const migrationDirectory = join(process.cwd(), "drizzle");
  return readdirSync(migrationDirectory)
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) => readFileSync(join(migrationDirectory, name), "utf8"))
    .join("\n");
}

test("Owner redaction irreversibly replaces an existing private note with the canonical marker", async (t) => {
  const database = new SqliteD1TestDatabase(loadGeneratedMigrations());
  t.after(() => database.close());
  const now = Date.now();
  const identity = trustedIdentityFromSites({
    displayName: "Phase 7 Owner",
    email: OWNER_EMAIL,
  });
  assert.equal(
    await bootstrapInitialOwner(database, identity, OWNER_EMAIL, now),
    true,
  );
  const organizationId = await database
    .prepare(
      `SELECT organization_id
       FROM organization_memberships
       WHERE normalized_email = ?
         AND role = 'owner'
         AND status = 'active'
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(OWNER_EMAIL)
    .first("organization_id");
  assert.equal(typeof organizationId, "string");

  database.exec(PHASE7_INVARIANT_TRIGGER_STATEMENTS.join("\n"));
  const submitted = await submitPublicForm(database, {
    anonymousClientId: "phase7-redaction-client",
    formInstance: {
      formKey: "contact",
      issuedAt: now - 4_000,
      nonce: "phase7-redaction-nonce",
    },
    formKey: "contact",
    honeypot: "",
    keyHex: "a".repeat(64),
    networkFacts: "phase7-redaction-network-scope",
    nowUtcMs: now,
    organizationId,
    payload: {
      message: VISITOR_MESSAGE,
      name: VISITOR_NAME,
      replyEmail: VISITOR_EMAIL,
      topic: "Accessibility",
    },
  });
  const submissionId = await database
    .prepare(
      `SELECT submission_id
       FROM form_submission_workflows
       WHERE organization_id = ?
         AND public_reference = ?
       LIMIT 1`,
    )
    .bind(organizationId, submitted.publicReference)
    .first("submission_id");
  assert.equal(typeof submissionId, "string");

  const withNote = await appendFormSubmissionNote(database, identity, {
    body: PRIVATE_NOTE,
    submissionId,
  });
  assert.equal(withNote.notes.length, 1);
  assert.equal(withNote.notes[0].body, PRIVATE_NOTE);
  assert.equal(withNote.notes[0].redacted, false);
  const retainedBeforeRedaction = JSON.stringify(
    await database
      .prepare(
        `SELECT proposed_payload_json
         FROM form_submission_write_intents
         WHERE organization_id = ?
           AND submission_id = ?
         ORDER BY created_at, id`,
      )
      .bind(organizationId, submissionId)
      .all(),
  );
  assert.match(retainedBeforeRedaction, new RegExp(VISITOR_EMAIL, "u"));
  assert.match(retainedBeforeRedaction, new RegExp(VISITOR_MESSAGE, "u"));

  const redacted = await redactFormSubmissionPersonalContent(
    database,
    identity,
    {
      confirmationReference: submitted.publicReference,
      expectedVersion: withNote.version,
      submissionId,
    },
  );
  assert.deepEqual(redacted.fields, { redacted: true });
  assert.equal(redacted.notes.length, 1);
  assert.equal(redacted.notes[0].body, "[redacted]");
  assert.equal(redacted.notes[0].redacted, true);
  assert.ok(redacted.redactedAt !== null);

  const durable = await database
    .prepare(
      `SELECT submission.payload_json,
              note.body_text,
              note.redacted_at,
              note.redacted_by_profile_id
       FROM form_submissions AS submission
       JOIN form_submission_notes AS note
         ON note.submission_id = submission.id
        AND note.organization_id = submission.organization_id
       WHERE submission.id = ?
         AND submission.organization_id = ?
       LIMIT 1`,
    )
    .bind(submissionId, organizationId)
    .first();
  assert.equal(durable.payload_json, '{"redacted":true}');
  assert.equal(durable.body_text, "[redacted]");
  assert.ok(Number.isSafeInteger(durable.redacted_at));
  assert.equal(
    durable.redacted_by_profile_id,
    await database
      .prepare(
        `SELECT profile_id
         FROM organization_memberships
         WHERE organization_id = ?
           AND role = 'owner'
           AND status = 'active'
           AND deleted_at IS NULL
         LIMIT 1`,
      )
      .bind(organizationId)
      .first("profile_id"),
  );
  assert.deepEqual(
    (
      await database
        .prepare(
          `SELECT proposed_payload_json
           FROM form_submission_write_intents
           WHERE organization_id = ?
             AND submission_id = ?
           ORDER BY created_at, id`,
        )
        .bind(organizationId, submissionId)
        .all()
    ).results.map((row) => row.proposed_payload_json),
    ['{"redacted":true}', '{"redacted":true}'],
  );

  const redactionAudits = await database
    .prepare(
      `SELECT action, metadata_json
       FROM audit_logs
       WHERE organization_id = ?
         AND entity_type = 'form_submission'
         AND entity_id = ?
         AND action = 'form_submission.personal_content_redacted'`,
    )
    .bind(organizationId, submissionId)
    .all();
  assert.equal(redactionAudits.results.length, 1);
  assert.deepEqual(
    JSON.parse(redactionAudits.results[0].metadata_json),
    {
      publicReference: submitted.publicReference,
      version: withNote.version + 1,
    },
  );
  const auditText = JSON.stringify(
    await database
      .prepare(
        `SELECT action, metadata_json
         FROM audit_logs
         WHERE organization_id = ?
           AND entity_type = 'form_submission'
           AND entity_id = ?`,
      )
      .bind(organizationId, submissionId)
      .all(),
  );
  const retainedPrivateState = JSON.stringify(
    await Promise.all([
      database
        .prepare(
          `SELECT payload_json
           FROM form_submissions
           WHERE organization_id = ?
             AND id = ?`,
        )
        .bind(organizationId, submissionId)
        .all(),
      database
        .prepare(
          `SELECT body_text
           FROM form_submission_notes
           WHERE organization_id = ?
             AND submission_id = ?`,
        )
        .bind(organizationId, submissionId)
        .all(),
      database
        .prepare(
          `SELECT proposed_payload_json
           FROM form_submission_write_intents
           WHERE organization_id = ?
             AND submission_id = ?`,
        )
        .bind(organizationId, submissionId)
        .all(),
      database
        .prepare(
          `SELECT action, metadata_json
           FROM audit_logs
           WHERE organization_id = ?
             AND entity_type = 'form_submission'
             AND entity_id = ?`,
        )
        .bind(organizationId, submissionId)
        .all(),
      database
        .prepare(
          `SELECT type, payload_json
           FROM notifications
           WHERE organization_id = ?
             AND json_extract(payload_json, '$.submissionId') = ?`,
        )
        .bind(organizationId, submissionId)
        .all(),
    ]),
  );
  for (const privateSentinel of [
    PRIVATE_NOTE,
    VISITOR_EMAIL,
    VISITOR_MESSAGE,
    VISITOR_NAME,
  ]) {
    assert.doesNotMatch(
      auditText,
      new RegExp(escapeRegExp(privateSentinel), "u"),
    );
    assert.doesNotMatch(
      JSON.stringify(redacted),
      new RegExp(escapeRegExp(privateSentinel), "u"),
    );
    assert.doesNotMatch(
      retainedPrivateState,
      new RegExp(escapeRegExp(privateSentinel), "u"),
    );
  }

  assert.deepEqual(
    await Promise.all(
      PHASE7_INVARIANT_COUNT_SQL.map((sql) =>
        database.prepare(sql).first("violation_count"),
      ),
    ),
    Array(PHASE7_INVARIANT_COUNT_SQL.length).fill(0),
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
