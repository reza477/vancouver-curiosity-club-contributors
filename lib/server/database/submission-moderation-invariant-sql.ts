const MANUAL_AUTHORIZATION = String.raw`
  EXISTS (
    SELECT 1 FROM form_submissions AS submission
    JOIN form_submission_workflows AS workflow
      ON workflow.submission_id = submission.id
     AND workflow.organization_id = submission.organization_id
    JOIN organization_memberships AS membership
      ON membership.organization_id = submission.organization_id
     AND membership.profile_id = NEW.updated_by_profile_id
     AND membership.role IN ('owner', 'administrator')
     AND membership.status = 'active' AND membership.deleted_at IS NULL
    JOIN profiles AS profile ON profile.id = membership.profile_id
     AND profile.status = 'active' AND profile.deleted_at IS NULL
    JOIN audit_logs AS audit ON audit.id = NEW.audit_id
     AND audit.organization_id = submission.organization_id
     AND audit.actor_profile_id = membership.profile_id
     AND audit.action = 'form_submission.moderation_changed'
     AND audit.entity_type = 'form_submission' AND audit.entity_id = submission.id
     AND json_extract(audit.metadata_json, '$.to') = NEW.folder
     AND json_extract(audit.metadata_json, '$.version') = NEW.version
     AND json_extract(audit.metadata_json, '$.workflowVersion') = workflow.version
     AND audit.created_at = NEW.updated_at
    WHERE submission.id = NEW.submission_id
      AND submission.organization_id = NEW.organization_id
      AND submission.deleted_at IS NULL AND workflow.canonical_status <> 'spam'
      AND NOT EXISTS (
        SELECT 1 FROM form_submission_email_outbox AS outbox
        WHERE outbox.submission_id = submission.id
          AND outbox.organization_id = submission.organization_id
          AND outbox.state = 'leased' AND outbox.lease_expires_at > NEW.updated_at
      )
  )`;

export const SUBMISSION_MODERATION_TRIGGER_STATEMENTS = Object.freeze([
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_moderation_before_insert
BEFORE INSERT ON form_submission_moderation
BEGIN
  SELECT CASE WHEN abs(NEW.updated_at - unixepoch() * 1000) > 300000
    OR NEW.version <> COALESCE((SELECT version + 1 FROM form_submission_moderation
      WHERE submission_id = NEW.submission_id AND organization_id = NEW.organization_id), 1)
    OR NOT (
      (NEW.reason = 'manual' AND ${MANUAL_AUTHORIZATION})
      OR (NEW.reason IN ('honeypot', 'index_registration_solicitation')
        AND NEW.folder = 'spam' AND NEW.version = 1
        AND NEW.updated_by_profile_id IS NULL AND NEW.audit_id IS NULL
        AND EXISTS (
          SELECT 1 FROM form_submissions AS submission
          JOIN form_submission_workflows AS workflow
            ON workflow.submission_id = submission.id
           AND workflow.organization_id = submission.organization_id
          JOIN form_submission_write_intents AS intent
            ON intent.id = workflow.write_intent_id
           AND intent.organization_id = workflow.organization_id
           AND intent.submission_id = workflow.submission_id
           AND intent.action = 'create' AND intent.completed_at IS NULL
          WHERE submission.id = NEW.submission_id
            AND submission.organization_id = NEW.organization_id
            AND submission.created_at = NEW.created_at
            AND NEW.created_at = NEW.updated_at
            AND workflow.canonical_status = 'new'
            AND submission.deleted_at IS NULL
        ))
    ) THEN RAISE(ABORT, 'submission_moderation_insert_denied') END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_moderation_before_update
BEFORE UPDATE ON form_submission_moderation
BEGIN
  SELECT CASE WHEN NEW.submission_id <> OLD.submission_id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.created_at <> OLD.created_at OR NEW.email_hold_at <> OLD.email_hold_at
    OR NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at
    OR NEW.reason <> 'manual' OR NEW.folder = OLD.folder
    OR NOT (${MANUAL_AUTHORIZATION})
    THEN RAISE(ABORT, 'submission_moderation_update_denied') END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_moderation_before_delete
BEFORE DELETE ON form_submission_moderation
BEGIN SELECT RAISE(ABORT, 'submission_moderation_delete_denied'); END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_email_moderation_hold
BEFORE UPDATE ON form_submission_email_outbox
WHEN NEW.state = 'leased' AND EXISTS (
  SELECT 1 FROM form_submission_moderation AS moderation
  WHERE moderation.submission_id = NEW.submission_id
    AND moderation.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'submission_email_moderation_held'); END;`,
]);

export const SUBMISSION_MODERATION_COUNT_SQL = Object.freeze([String.raw`
SELECT count(*) AS violation_count
FROM form_submission_moderation AS moderation
LEFT JOIN form_submissions AS submission ON submission.id = moderation.submission_id
  AND submission.organization_id = moderation.organization_id
LEFT JOIN form_submission_workflows AS workflow ON workflow.submission_id = submission.id
  AND workflow.organization_id = submission.organization_id
LEFT JOIN form_submission_write_intents AS intent ON intent.id = workflow.write_intent_id
  AND intent.organization_id = workflow.organization_id AND intent.submission_id = workflow.submission_id
LEFT JOIN audit_logs AS audit ON audit.id = moderation.audit_id
WHERE submission.id IS NULL OR workflow.submission_id IS NULL
  OR workflow.canonical_status = 'spam' OR submission.deleted_at IS NOT NULL
  OR intent.completed_at IS NULL OR intent.completion_audit_log_id IS NULL
  OR (moderation.reason = 'manual' AND (
    audit.id IS NULL OR audit.organization_id <> moderation.organization_id
    OR audit.actor_profile_id <> moderation.updated_by_profile_id
    OR audit.action <> 'form_submission.moderation_changed'
    OR audit.entity_type <> 'form_submission' OR audit.entity_id <> moderation.submission_id
    OR json_extract(audit.metadata_json, '$.to') <> moderation.folder
    OR json_extract(audit.metadata_json, '$.version') <> moderation.version
  ))`]);
