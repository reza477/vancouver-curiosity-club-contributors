import {
  authorizeMembership,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type TrustedServerIdentity,
} from "../auth";
import { parseEnum, parseFiniteInteger, parseIdentifier } from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import { currentD1Time } from "../organizer/conflicts";

import { SUBMISSION_MODERATION_FOLDERS, MAX_SUBMISSION_MODERATION_BATCH } from "../../submission-moderation-contract";
export { SUBMISSION_MODERATION_FOLDERS, MAX_SUBMISSION_MODERATION_BATCH } from "../../submission-moderation-contract";
export type { SubmissionModerationFolder } from "../../submission-moderation-contract";

export function initialSubmissionModerationStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    submissionId: string;
    organizationId: string;
    nowUtcMs: number;
    reason: "honeypot" | "index_registration_solicitation";
  }>,
): D1PreparedStatementLike {
  return database.prepare(
    `INSERT INTO form_submission_moderation (
       submission_id, organization_id, folder, version, reason,
       email_hold_at, created_at, updated_at, updated_by_profile_id, audit_id
     ) VALUES (?, ?, 'spam', 1, ?, ?, ?, ?, NULL, NULL)`,
  ).bind(input.submissionId, input.organizationId, input.reason,
    input.nowUtcMs, input.nowUtcMs, input.nowUtcMs);
}

/** Content and canonical workflow remain intact. Restoring never releases email. */
export async function moderateFormSubmissions(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  input: Readonly<{ folder: unknown; items: unknown }>,
): Promise<Readonly<{ changed: number }>> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const folder = parseEnum(input.folder, SUBMISSION_MODERATION_FOLDERS, "folder");
  if (!Array.isArray(input.items) || input.items.length < 1 ||
      input.items.length > MAX_SUBMISSION_MODERATION_BATCH) throw invalid();
  const items = input.items.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
    const item = value as Record<string, unknown>;
    return {
      submissionId: parseIdentifier(item.submissionId, "submissionId"),
      expectedVersion: parseFiniteInteger(item.expectedVersion, { path: "expectedVersion", minimum: 1 }),
      expectedModerationVersion: parseFiniteInteger(item.expectedModerationVersion, { path: "expectedModerationVersion", minimum: 0 }),
    };
  });
  if (new Set(items.map((item) => item.submissionId)).size !== items.length) throw invalid();
  const now = await currentD1Time(database);
  const statements: D1PreparedStatementLike[] = [];
  for (const item of items) {
    const auditId = crypto.randomUUID();
    statements.push(database.prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action, entity_type,
         entity_id, metadata_json, created_at
       ) VALUES (?, ?, ?, CASE WHEN EXISTS (
         SELECT 1 FROM form_submissions AS submission
         JOIN form_submission_workflows AS workflow
           ON workflow.submission_id = submission.id
          AND workflow.organization_id = submission.organization_id
         JOIN form_submission_write_intents AS intent
           ON intent.id = workflow.write_intent_id
          AND intent.organization_id = workflow.organization_id
          AND intent.submission_id = workflow.submission_id
          AND intent.completed_at IS NOT NULL
          AND intent.completion_audit_log_id IS NOT NULL
         JOIN organization_memberships AS membership
           ON membership.organization_id = submission.organization_id
          AND membership.profile_id = ?
          AND membership.role IN ('owner', 'administrator')
          AND membership.status = 'active' AND membership.deleted_at IS NULL
         JOIN profiles AS profile ON profile.id = membership.profile_id
          AND profile.status = 'active' AND profile.deleted_at IS NULL
         LEFT JOIN form_submission_moderation AS moderation
           ON moderation.submission_id = submission.id
          AND moderation.organization_id = submission.organization_id
         WHERE submission.id = ? AND submission.organization_id = ?
           AND submission.deleted_at IS NULL
           AND workflow.canonical_status <> 'spam'
           AND workflow.version = ?
           AND COALESCE(moderation.version, 0) = ?
           AND COALESCE(moderation.folder, 'inbox') <> ?
           AND NOT EXISTS (
             SELECT 1 FROM form_submission_email_outbox AS outbox
             WHERE outbox.submission_id = submission.id
               AND outbox.organization_id = submission.organization_id
               AND outbox.state = 'leased' AND outbox.lease_expires_at > ?
           )
       ) THEN 'form_submission.moderation_changed' ELSE NULL END,
       'form_submission', ?, json_object(
         'from', COALESCE((SELECT folder FROM form_submission_moderation
                          WHERE submission_id = ? AND organization_id = ?), 'inbox'),
         'to', ?, 'version', ?, 'workflowVersion', ?
       ), ?)`,
    ).bind(auditId, actor.organizationId, actor.profileId, actor.profileId,
      item.submissionId, actor.organizationId, item.expectedVersion,
      item.expectedModerationVersion, folder, now, item.submissionId,
      item.submissionId, actor.organizationId, folder,
      item.expectedModerationVersion + 1, item.expectedVersion, now));
    statements.push(database.prepare(
      `INSERT INTO form_submission_moderation (
         submission_id, organization_id, folder, version, reason,
         email_hold_at, created_at, updated_at, updated_by_profile_id, audit_id
       ) VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)
       ON CONFLICT(submission_id) DO UPDATE SET
         folder = excluded.folder, version = excluded.version,
         reason = 'manual', updated_at = excluded.updated_at,
         updated_by_profile_id = excluded.updated_by_profile_id,
         audit_id = excluded.audit_id`,
    ).bind(item.submissionId, actor.organizationId, folder,
      item.expectedModerationVersion + 1, now, now, now,
      actor.profileId, auditId));
  }
  try {
    await database.batch(statements);
  } catch {
    throw new SafeApplicationError("stale_edit", 409,
      "A selected submission changed or its email is being delivered. Refresh and try again; nothing in this batch was moved.");
  }
  return Object.freeze({ changed: items.length });
}

function invalid(): SafeApplicationError {
  return new SafeApplicationError("validation_failed", 422,
    "Select between one and ten different submissions with their current versions.");
}
