/**
 * Phase 7 keeps schema changes additive while installing cross-table and
 * transition guards through the established runtime invariant mechanism.
 * Every statement is intentionally shallow so it remains independently
 * executable within Cloudflare D1's SQL parser and statement limits.
 */

export const PHASE7_INVARIANT_TRIGGER_STATEMENTS = Object.freeze([
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_write_intents_phase7_before_insert
BEFORE INSERT ON form_submission_write_intents
BEGIN
  SELECT CASE
    WHEN NEW.completed_at IS NOT NULL
      OR NEW.completion_audit_log_id IS NOT NULL
      OR abs(NEW.created_at - (unixepoch() * 1000)) > 300000
    THEN RAISE(ABORT, 'phase7_form_intent_initial_shape_invalid')
  END;
  SELECT CASE
    WHEN NEW.action = 'create'
     AND (
       NEW.proposed_canonical_status NOT IN ('new', 'spam')
       OR EXISTS (
         SELECT 1
         FROM form_submissions AS submission
         WHERE submission.id = NEW.submission_id
       )
       OR EXISTS (
         SELECT 1
         FROM form_submission_workflows AS workflow
         WHERE workflow.submission_id = NEW.submission_id
       )
     )
    THEN RAISE(ABORT, 'phase7_form_intent_create_invalid')
  END;
  SELECT CASE
    WHEN NEW.action <> 'create'
     AND NOT EXISTS (
       SELECT 1
       FROM form_submission_workflows AS workflow
       INNER JOIN form_submissions AS submission
         ON submission.id = workflow.submission_id
        AND submission.organization_id = workflow.organization_id
       INNER JOIN form_submission_write_intents AS prior_intent
         ON prior_intent.id = workflow.write_intent_id
        AND prior_intent.organization_id = workflow.organization_id
        AND prior_intent.submission_id = workflow.submission_id
        AND prior_intent.completed_at IS NOT NULL
       INNER JOIN organization_memberships AS actor
         ON actor.organization_id = workflow.organization_id
        AND actor.profile_id = NEW.actor_profile_id
        AND actor.status = 'active'
        AND actor.deleted_at IS NULL
       INNER JOIN profiles AS profile
         ON profile.id = actor.profile_id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
       WHERE workflow.submission_id = NEW.submission_id
         AND workflow.organization_id = NEW.organization_id
         AND workflow.version = NEW.expected_workflow_version
         AND (
           (NEW.action = 'assign'
            AND actor.role IN ('owner', 'administrator')
            AND NEW.proposed_canonical_status =
                workflow.canonical_status
            AND NEW.proposed_payload_json = submission.payload_json)
           OR (
             NEW.action = 'status'
             AND NEW.proposed_assigned_to_profile_id
                 IS submission.assigned_to_profile_id
             AND NEW.proposed_payload_json = submission.payload_json
             AND (
               actor.role IN ('owner', 'administrator')
               OR (
                 actor.role = 'organizer'
                 AND submission.assigned_to_profile_id = actor.profile_id
                 AND (
                   (workflow.canonical_status = 'new'
                    AND NEW.proposed_canonical_status = 'in_review')
                   OR (
                     workflow.canonical_status = 'in_review'
                     AND NEW.proposed_canonical_status = 'responded'
                   )
                   OR (
                     workflow.canonical_status = 'responded'
                     AND NEW.proposed_canonical_status = 'in_review'
                   )
                 )
               )
             )
           )
           OR (
             NEW.action = 'redact'
             AND actor.role = 'owner'
             AND NEW.proposed_canonical_status =
                 workflow.canonical_status
             AND NEW.proposed_assigned_to_profile_id
                 IS submission.assigned_to_profile_id
             AND NEW.proposed_payload_json = '{"redacted":true}'
             AND workflow.redacted_at IS NULL
           )
         )
     )
    THEN RAISE(ABORT, 'phase7_form_intent_actor_or_source_invalid')
  END;
  SELECT CASE
    WHEN NEW.proposed_assigned_to_profile_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM organization_memberships AS assignee
       INNER JOIN profiles AS profile
         ON profile.id = assignee.profile_id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
       WHERE assignee.organization_id = NEW.organization_id
         AND assignee.profile_id = NEW.proposed_assigned_to_profile_id
         AND assignee.status = 'active'
         AND assignee.deleted_at IS NULL
     )
    THEN RAISE(ABORT, 'phase7_form_intent_assignee_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_write_intents_phase7_before_update
BEFORE UPDATE ON form_submission_write_intents
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.submission_id <> OLD.submission_id
      OR NEW.action <> OLD.action
      OR NEW.expected_workflow_version <> OLD.expected_workflow_version
      OR NEW.proposed_workflow_version <> OLD.proposed_workflow_version
      OR NEW.proposed_canonical_status <> OLD.proposed_canonical_status
      OR NEW.proposed_assigned_to_profile_id
          IS NOT OLD.proposed_assigned_to_profile_id
      OR NEW.proposed_public_reference
          IS NOT OLD.proposed_public_reference
      OR NEW.proposed_request_idempotency_hash
          IS NOT OLD.proposed_request_idempotency_hash
      OR NEW.proposed_retention_review_at
          IS NOT OLD.proposed_retention_review_at
      OR NEW.actor_profile_id IS NOT OLD.actor_profile_id
      OR NEW.created_at <> OLD.created_at
      OR (
        OLD.completed_at IS NULL
        AND (
          NEW.proposed_payload_json <> OLD.proposed_payload_json
          OR NEW.completed_at IS NULL
          OR NEW.completion_audit_log_id IS NULL
        )
      )
      OR (
        OLD.completed_at IS NOT NULL
        AND (
          OLD.completion_audit_log_id IS NULL
          OR NEW.completed_at <> OLD.completed_at
          OR NEW.completion_audit_log_id
              IS NOT OLD.completion_audit_log_id
          OR OLD.proposed_payload_json = '{"redacted":true}'
          OR NEW.proposed_payload_json <> '{"redacted":true}'
          OR NOT EXISTS (
            SELECT 1
            FROM form_submission_workflows AS workflow
            INNER JOIN form_submissions AS submission
              ON submission.id = workflow.submission_id
             AND submission.organization_id = workflow.organization_id
            INNER JOIN form_submission_write_intents AS redaction_intent
              ON redaction_intent.id = workflow.write_intent_id
             AND redaction_intent.organization_id =
                 workflow.organization_id
             AND redaction_intent.submission_id =
                 workflow.submission_id
             AND redaction_intent.action = 'redact'
             AND redaction_intent.completed_at IS NULL
             AND redaction_intent.completion_audit_log_id IS NULL
            INNER JOIN organization_memberships AS actor
              ON actor.organization_id = workflow.organization_id
             AND actor.profile_id =
                 redaction_intent.actor_profile_id
             AND actor.role = 'owner'
             AND actor.status = 'active'
             AND actor.deleted_at IS NULL
            INNER JOIN profiles AS actor_profile
              ON actor_profile.id = actor.profile_id
             AND actor_profile.status = 'active'
             AND actor_profile.deleted_at IS NULL
            WHERE workflow.submission_id = NEW.submission_id
              AND workflow.organization_id = NEW.organization_id
              AND workflow.version =
                  redaction_intent.proposed_workflow_version
              AND workflow.updated_by_profile_id =
                  redaction_intent.actor_profile_id
              AND workflow.redacted_at IS NOT NULL
              AND workflow.redacted_by_profile_id =
                  redaction_intent.actor_profile_id
              AND submission.payload_json = '{"redacted":true}'
              AND submission.assigned_to_profile_id
                  IS redaction_intent.proposed_assigned_to_profile_id
              AND redaction_intent.proposed_payload_json =
                  '{"redacted":true}'
              AND NOT EXISTS (
                SELECT 1
                FROM form_submission_notes AS note
                WHERE note.organization_id = workflow.organization_id
                  AND note.submission_id = workflow.submission_id
                  AND (
                    note.redacted_at IS NULL
                    OR note.redacted_by_profile_id <>
                        redaction_intent.actor_profile_id
                    OR note.body_text <> '[redacted]'
                  )
              )
          )
        )
      )
    THEN RAISE(ABORT, 'phase7_form_intent_completion_invalid')
  END;
  SELECT CASE
    WHEN OLD.completed_at IS NULL
     AND NOT EXISTS (
      SELECT 1
      FROM form_submission_workflows AS workflow
      INNER JOIN form_submissions AS submission
        ON submission.id = workflow.submission_id
       AND submission.organization_id = workflow.organization_id
      INNER JOIN audit_logs AS audit
        ON audit.id = NEW.completion_audit_log_id
       AND audit.organization_id = workflow.organization_id
       AND audit.actor_profile_id IS NEW.actor_profile_id
       AND audit.entity_type = 'form_submission'
       AND audit.entity_id = workflow.submission_id
       AND audit.action = CASE NEW.action
         WHEN 'create' THEN 'form_submission.created'
         WHEN 'assign' THEN 'form_submission.assigned'
         WHEN 'status' THEN 'form_submission.status_changed'
         ELSE 'form_submission.personal_content_redacted'
       END
      WHERE workflow.submission_id = NEW.submission_id
        AND workflow.organization_id = NEW.organization_id
        AND workflow.write_intent_id = NEW.id
        AND workflow.version = NEW.proposed_workflow_version
        AND workflow.canonical_status = NEW.proposed_canonical_status
        AND submission.assigned_to_profile_id
            IS NEW.proposed_assigned_to_profile_id
        AND submission.payload_json = NEW.proposed_payload_json
        AND (
          (workflow.canonical_status = 'new'
           AND submission.status = 'new')
          OR (workflow.canonical_status = 'in_review'
              AND submission.status = 'in_review')
          OR (workflow.canonical_status IN ('responded', 'archived')
              AND submission.status = 'resolved')
          OR (workflow.canonical_status = 'spam'
              AND submission.status = 'spam')
        )
        AND (
          NEW.action <> 'create'
          OR (
            workflow.public_reference =
                NEW.proposed_public_reference
            AND workflow.request_idempotency_hash =
                NEW.proposed_request_idempotency_hash
            AND workflow.retention_review_at =
                NEW.proposed_retention_review_at
          )
        )
        AND (
          NEW.action <> 'redact'
          OR (
            workflow.redacted_at IS NOT NULL
            AND workflow.redacted_by_profile_id =
                NEW.actor_profile_id
            AND NOT EXISTS (
              SELECT 1
              FROM form_submission_notes AS note
             WHERE note.organization_id = workflow.organization_id
                 AND note.submission_id = workflow.submission_id
                 AND (
                  note.redacted_at IS NULL
                  OR note.redacted_by_profile_id <>
                      NEW.actor_profile_id
                   OR note.body_text <> '[redacted]'
                 )
             )
            AND NOT EXISTS (
              SELECT 1
              FROM form_submission_write_intents AS historical_intent
              WHERE historical_intent.organization_id =
                    workflow.organization_id
                AND historical_intent.submission_id =
                    workflow.submission_id
                AND historical_intent.proposed_payload_json <>
                    '{"redacted":true}'
            )
          )
        )
    )
    THEN RAISE(ABORT, 'phase7_form_intent_completion_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_write_intents_phase7_before_delete
BEFORE DELETE ON form_submission_write_intents
BEGIN
  SELECT RAISE(ABORT, 'phase7_form_intent_delete_denied');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submissions_phase7_before_insert
BEFORE INSERT ON form_submissions
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM form_submission_write_intents AS intent
      WHERE intent.organization_id = NEW.organization_id
        AND intent.submission_id = NEW.id
        AND intent.action = 'create'
        AND intent.completed_at IS NULL
        AND intent.proposed_workflow_version = 1
        AND intent.proposed_assigned_to_profile_id IS NULL
        AND intent.proposed_payload_json = NEW.payload_json
        AND NEW.submitted_by_profile_id IS NULL
        AND NEW.assigned_to_profile_id IS NULL
        AND NEW.deleted_at IS NULL
        AND (
          (intent.proposed_canonical_status = 'new'
           AND NEW.status = 'new')
          OR (intent.proposed_canonical_status = 'spam'
              AND NEW.status = 'spam')
        )
    )
    THEN RAISE(ABORT, 'phase7_form_submission_create_intent_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_workflows_phase7_before_insert
BEFORE INSERT ON form_submission_workflows
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM form_submissions AS submission
      INNER JOIN form_submission_write_intents AS intent
        ON intent.id = NEW.write_intent_id
       AND intent.organization_id = NEW.organization_id
       AND intent.submission_id = NEW.submission_id
       AND intent.action = 'create'
       AND intent.completed_at IS NULL
      WHERE submission.id = NEW.submission_id
        AND submission.organization_id = NEW.organization_id
        AND NEW.version = 1
        AND NEW.updated_by_profile_id IS NULL
        AND NEW.redacted_at IS NULL
        AND NEW.redacted_by_profile_id IS NULL
        AND NEW.public_reference = intent.proposed_public_reference
        AND NEW.request_idempotency_hash =
            intent.proposed_request_idempotency_hash
        AND NEW.retention_review_at =
            intent.proposed_retention_review_at
        AND NEW.canonical_status =
            intent.proposed_canonical_status
        AND submission.payload_json = intent.proposed_payload_json
        AND submission.assigned_to_profile_id
            IS intent.proposed_assigned_to_profile_id
        AND (
          (NEW.canonical_status = 'new' AND submission.status = 'new')
          OR (NEW.canonical_status = 'in_review'
              AND submission.status = 'in_review')
          OR (NEW.canonical_status IN ('responded', 'archived')
              AND submission.status = 'resolved')
          OR (NEW.canonical_status = 'spam' AND submission.status = 'spam')
        )
    )
    THEN RAISE(ABORT, 'phase7_form_workflow_source_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_workflows_phase7_before_update
BEFORE UPDATE ON form_submission_workflows
BEGIN
  SELECT CASE
    WHEN NEW.submission_id <> OLD.submission_id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.public_reference <> OLD.public_reference
      OR NEW.request_idempotency_hash <> OLD.request_idempotency_hash
      OR NEW.created_at <> OLD.created_at
      OR NEW.version <> OLD.version + 1
      OR NEW.updated_at < OLD.updated_at
    THEN RAISE(ABORT, 'phase7_form_workflow_immutable')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM form_submission_write_intents AS intent
      INNER JOIN form_submissions AS submission
        ON submission.id = NEW.submission_id
       AND submission.organization_id = NEW.organization_id
      WHERE intent.id = NEW.write_intent_id
        AND intent.organization_id = NEW.organization_id
        AND intent.submission_id = NEW.submission_id
        AND intent.completed_at IS NULL
        AND intent.action <> 'create'
        AND intent.expected_workflow_version = OLD.version
        AND intent.proposed_workflow_version = NEW.version
        AND intent.proposed_canonical_status =
            NEW.canonical_status
        AND (
          intent.action = 'assign'
          OR intent.proposed_assigned_to_profile_id
              IS submission.assigned_to_profile_id
        )
        AND (
          intent.action = 'redact'
          OR intent.proposed_payload_json = submission.payload_json
        )
        AND NEW.updated_by_profile_id = intent.actor_profile_id
        AND (
          (intent.action <> 'redact'
           AND NEW.redacted_at IS OLD.redacted_at
           AND NEW.redacted_by_profile_id
               IS OLD.redacted_by_profile_id)
          OR (
            intent.action = 'redact'
            AND OLD.redacted_at IS NULL
            AND NEW.redacted_at IS NOT NULL
            AND NEW.redacted_by_profile_id =
                intent.actor_profile_id
          )
        )
    )
    THEN RAISE(ABORT, 'phase7_form_workflow_intent_mismatch')
  END;
  SELECT CASE
    WHEN OLD.redacted_at IS NOT NULL
    THEN RAISE(ABORT, 'phase7_form_workflow_redaction_immutable')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_workflows_phase7_before_delete
BEFORE DELETE ON form_submission_workflows
BEGIN
  SELECT RAISE(ABORT, 'phase7_form_workflow_delete_denied');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submissions_phase7_before_update
BEFORE UPDATE ON form_submissions
WHEN EXISTS (
  SELECT 1
  FROM form_submission_workflows AS workflow
  WHERE workflow.submission_id = OLD.id
)
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.form_key <> OLD.form_key
      OR NEW.submitted_by_profile_id IS NOT OLD.submitted_by_profile_id
      OR NEW.created_at <> OLD.created_at
      OR NEW.deleted_at IS NOT OLD.deleted_at
      OR NEW.updated_at < OLD.updated_at
    THEN RAISE(ABORT, 'phase7_form_submission_immutable')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM form_submission_workflows AS workflow
      INNER JOIN form_submission_write_intents AS intent
        ON intent.id = workflow.write_intent_id
       AND intent.organization_id = workflow.organization_id
       AND intent.submission_id = workflow.submission_id
       AND intent.completed_at IS NULL
       AND intent.action <> 'create'
      WHERE workflow.submission_id = NEW.id
        AND workflow.organization_id = NEW.organization_id
        AND workflow.version = intent.proposed_workflow_version
        AND workflow.canonical_status =
            intent.proposed_canonical_status
        AND NEW.assigned_to_profile_id
            IS intent.proposed_assigned_to_profile_id
        AND NEW.payload_json = intent.proposed_payload_json
        AND (
          (workflow.canonical_status = 'new' AND NEW.status = 'new')
          OR (workflow.canonical_status = 'in_review'
              AND NEW.status = 'in_review')
          OR (workflow.canonical_status IN ('responded', 'archived')
              AND NEW.status = 'resolved')
          OR (workflow.canonical_status = 'spam' AND NEW.status = 'spam')
        )
    )
    THEN RAISE(ABORT, 'phase7_form_submission_status_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submissions_phase7_before_delete
BEFORE DELETE ON form_submissions
WHEN EXISTS (
  SELECT 1
  FROM form_submission_workflows AS workflow
  WHERE workflow.submission_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'phase7_form_submission_delete_denied');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_notes_phase7_before_insert
BEFORE INSERT ON form_submission_notes
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM form_submissions AS submission
      INNER JOIN form_submission_workflows AS workflow
        ON workflow.submission_id = submission.id
       AND workflow.organization_id = submission.organization_id
      INNER JOIN form_submission_write_intents AS current_intent
        ON current_intent.id = workflow.write_intent_id
       AND current_intent.organization_id = workflow.organization_id
       AND current_intent.submission_id = workflow.submission_id
       AND current_intent.completed_at IS NOT NULL
      INNER JOIN organization_memberships AS membership
        ON membership.organization_id = submission.organization_id
       AND membership.profile_id = NEW.author_profile_id
       AND membership.status = 'active'
       AND membership.deleted_at IS NULL
      INNER JOIN profiles AS profile
        ON profile.id = membership.profile_id
       AND profile.status = 'active'
       AND profile.deleted_at IS NULL
      WHERE submission.id = NEW.submission_id
        AND submission.organization_id = NEW.organization_id
        AND workflow.redacted_at IS NULL
        AND (
          membership.role IN ('owner', 'administrator')
          OR (
            membership.role = 'organizer'
            AND submission.assigned_to_profile_id = membership.profile_id
          )
        )
    )
    THEN RAISE(ABORT, 'phase7_form_note_authorization_invalid')
  END;
  SELECT CASE
    WHEN NEW.redacted_at IS NOT NULL OR NEW.redacted_by_profile_id IS NOT NULL
    THEN RAISE(ABORT, 'phase7_form_note_insert_redacted')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_notes_phase7_before_update
BEFORE UPDATE ON form_submission_notes
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.submission_id <> OLD.submission_id
      OR NEW.author_profile_id <> OLD.author_profile_id
      OR NEW.created_at <> OLD.created_at
      OR OLD.redacted_at IS NOT NULL
      OR NEW.redacted_at IS NULL
      OR NEW.redacted_by_profile_id IS NULL
      OR NEW.body_text <> '[redacted]'
      OR NOT EXISTS (
        SELECT 1
        FROM form_submission_workflows AS workflow
        INNER JOIN organization_memberships AS owner
          ON owner.organization_id = workflow.organization_id
         AND owner.profile_id = NEW.redacted_by_profile_id
         AND owner.role = 'owner'
         AND owner.status = 'active'
         AND owner.deleted_at IS NULL
        WHERE workflow.submission_id = NEW.submission_id
          AND workflow.organization_id = NEW.organization_id
          AND workflow.redacted_at IS NOT NULL
          AND workflow.redacted_by_profile_id = NEW.redacted_by_profile_id
      )
    THEN RAISE(ABORT, 'phase7_form_note_update_denied')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_notes_phase7_before_delete
BEFORE DELETE ON form_submission_notes
BEGIN
  SELECT RAISE(ABORT, 'phase7_form_note_delete_denied');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS public_form_protection_keys_phase7_before_update
BEFORE UPDATE ON public_form_protection_keys
BEGIN
  SELECT CASE
    WHEN NEW.organization_id <> OLD.organization_id
      OR NEW.created_at <> OLD.created_at
      OR NEW.version <> OLD.version + 1
      OR NEW.updated_at < OLD.updated_at
      OR NEW.key_hex = OLD.key_hex
    THEN RAISE(ABORT, 'phase7_public_form_key_rotation_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS public_form_protection_keys_phase7_before_delete
BEFORE DELETE ON public_form_protection_keys
BEGIN
  SELECT RAISE(ABORT, 'phase7_public_form_key_delete_denied');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS public_form_rate_windows_phase7_before_update
BEFORE UPDATE ON public_form_rate_windows
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.action <> OLD.action
      OR NEW.scope_key <> OLD.scope_key
      OR NEW.window_started_at <> OLD.window_started_at
      OR NEW.window_ends_at <> OLD.window_ends_at
      OR NEW.created_at <> OLD.created_at
      OR NEW.request_count < OLD.request_count
      OR NEW.updated_at < OLD.updated_at
    THEN RAISE(ABORT, 'phase7_public_form_rate_window_immutable')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS import_batches_phase7_identity_before_update
BEFORE UPDATE ON import_batches
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.source_type <> OLD.source_type
      OR NEW.source_label IS NOT OLD.source_label
      OR NEW.created_by_profile_id <> OLD.created_by_profile_id
      OR NEW.created_at <> OLD.created_at
    THEN RAISE(ABORT, 'phase7_import_batch_identity_immutable')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS import_batch_details_phase7_before_insert
BEFORE INSERT ON import_batch_details
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM import_batches AS batch
      INNER JOIN organization_memberships AS actor
        ON actor.organization_id = batch.organization_id
       AND actor.profile_id = batch.created_by_profile_id
       AND actor.role IN ('owner', 'administrator')
       AND actor.status = 'active'
       AND actor.deleted_at IS NULL
      INNER JOIN profiles AS profile
        ON profile.id = actor.profile_id
       AND profile.status = 'active'
       AND profile.deleted_at IS NULL
      WHERE batch.id = NEW.import_batch_id
        AND batch.organization_id = NEW.organization_id
        AND batch.source_type = 'csv'
        AND batch.status = 'pending'
        AND NEW.phase = 'uploaded'
        AND NEW.version = 1
        AND NEW.updated_by_profile_id = batch.created_by_profile_id
        AND NEW.preview_fingerprint IS NULL
        AND NEW.preview_version = 0
        AND NEW.total_row_count = 0
        AND NEW.valid_row_count = 0
        AND NEW.invalid_row_count = 0
        AND NEW.warning_row_count = 0
        AND NEW.selected_row_count = 0
        AND NEW.imported_row_count = 0
        AND NEW.skipped_row_count = 0
        AND NEW.failed_row_count = 0
        AND NEW.pending_row_count = 0
        AND NEW.application_cursor = 0
        AND NEW.approved_by_profile_id IS NULL
        AND NEW.approved_at IS NULL
        AND NEW.started_at IS NULL
        AND NEW.completed_at IS NULL
        AND NEW.active_runner_version IS NULL
        AND NEW.active_runner_lease_hash IS NULL
        AND NEW.active_runner_expires_at IS NULL
        AND NEW.source_payload_redacted_at IS NULL
        AND NEW.redacted_by_profile_id IS NULL
    )
    THEN RAISE(ABORT, 'phase7_import_batch_source_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS import_batch_details_phase7_before_update
BEFORE UPDATE ON import_batch_details
BEGIN
  SELECT CASE
    WHEN NEW.import_batch_id <> OLD.import_batch_id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.file_sha256 <> OLD.file_sha256
      OR NEW.source_namespace <> OLD.source_namespace
      OR NEW.template_version <> OLD.template_version
      OR NEW.parser_version <> OLD.parser_version
      OR NEW.encoding <> OLD.encoding
      OR NEW.delimiter <> OLD.delimiter
      OR NEW.created_at <> OLD.created_at
      OR NEW.version <> OLD.version + 1
      OR NEW.updated_at < OLD.updated_at
      OR NEW.total_row_count < OLD.total_row_count
      OR NEW.valid_row_count < OLD.valid_row_count
      OR NEW.invalid_row_count < OLD.invalid_row_count
      OR NEW.warning_row_count < OLD.warning_row_count
      OR NEW.selected_row_count < OLD.selected_row_count
      OR NEW.imported_row_count < OLD.imported_row_count
      OR NEW.skipped_row_count < OLD.skipped_row_count
      OR NEW.failed_row_count < OLD.failed_row_count
      OR NEW.application_cursor < OLD.application_cursor
    THEN RAISE(ABORT, 'phase7_import_batch_immutable')
  END;
  SELECT CASE
    WHEN (
      OLD.phase IN (
        'approved', 'applying', 'completed', 'completed_with_errors',
        'interrupted', 'failed', 'redacted'
      )
      OR NEW.phase IN (
      'approved', 'applying', 'completed', 'completed_with_errors',
      'interrupted', 'failed', 'redacted'
      )
    )
     AND (
       NEW.column_mapping_json <> OLD.column_mapping_json
       OR NEW.mapping_fingerprint <> OLD.mapping_fingerprint
       OR NEW.preview_fingerprint IS NOT OLD.preview_fingerprint
       OR NEW.preview_version <> OLD.preview_version
     )
    THEN RAISE(ABORT, 'phase7_import_preview_immutable')
  END;
  SELECT CASE
    WHEN NEW.phase IN (
      'approved', 'applying', 'completed', 'completed_with_errors',
      'interrupted', 'failed', 'redacted'
    )
     AND (
       NEW.total_row_count <> OLD.total_row_count
       OR NEW.valid_row_count <> OLD.valid_row_count
       OR NEW.invalid_row_count <> OLD.invalid_row_count
       OR NEW.warning_row_count <> OLD.warning_row_count
       OR (
         OLD.phase IN (
           'approved', 'applying', 'completed', 'completed_with_errors',
           'interrupted', 'failed', 'redacted'
         )
         AND NEW.selected_row_count <> OLD.selected_row_count
       )
     )
    THEN RAISE(ABORT, 'phase7_import_preview_counts_immutable')
  END;
  SELECT CASE
    WHEN NEW.total_row_count <> (
      SELECT count(*)
      FROM import_rows AS row
      WHERE row.organization_id = NEW.organization_id
        AND row.import_batch_id = NEW.import_batch_id
    )
     AND NEW.phase <> 'uploaded'
    THEN RAISE(ABORT, 'phase7_import_batch_row_count_mismatch')
  END;
  SELECT CASE
    WHEN NOT (
      (OLD.phase = 'uploaded'
       AND NEW.phase IN ('uploaded', 'previewed', 'failed'))
      OR (OLD.phase = 'previewed'
          AND NEW.phase IN ('previewed', 'approved', 'failed', 'redacted'))
      OR (OLD.phase = 'approved'
          AND NEW.phase IN ('approved', 'applying', 'interrupted', 'failed'))
      OR (OLD.phase = 'applying'
          AND NEW.phase IN (
            'applying', 'completed', 'completed_with_errors',
            'interrupted', 'failed'
          ))
      OR (OLD.phase = 'interrupted'
          AND NEW.phase IN (
            'interrupted', 'applying', 'completed',
            'completed_with_errors', 'failed'
          ))
      OR (OLD.phase IN ('completed', 'completed_with_errors', 'failed')
          AND NEW.phase IN (OLD.phase, 'redacted'))
      OR (OLD.phase = 'redacted' AND NEW.phase = 'redacted')
    )
    THEN RAISE(ABORT, 'phase7_import_batch_transition_invalid')
  END;
  SELECT CASE
    WHEN OLD.phase NOT IN ('completed', 'completed_with_errors')
     AND NEW.phase IN ('completed', 'completed_with_errors')
     AND NOT (
       OLD.phase IN ('applying', 'interrupted')
       AND NEW.pending_row_count = 0
       AND NEW.application_cursor = NEW.selected_row_count
       AND NEW.imported_row_count + NEW.failed_row_count =
           NEW.selected_row_count
       AND NEW.imported_row_count = (
         SELECT count(*)
         FROM import_row_applications AS application
         WHERE application.organization_id = NEW.organization_id
           AND application.import_batch_id = NEW.import_batch_id
           AND application.approval_action IN (
             'selected', 'create_separate'
           )
           AND application.application_state = 'imported'
       )
       AND NEW.failed_row_count = (
         SELECT count(*)
         FROM import_row_applications AS application
         WHERE application.organization_id = NEW.organization_id
           AND application.import_batch_id = NEW.import_batch_id
           AND application.approval_action IN (
             'selected', 'create_separate'
           )
           AND application.application_state = 'failed'
       )
       AND NEW.skipped_row_count = (
         SELECT count(*)
         FROM import_row_applications AS application
         WHERE application.organization_id = NEW.organization_id
           AND application.import_batch_id = NEW.import_batch_id
           AND application.approval_action = 'skip'
           AND application.application_state = 'skipped'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM import_row_applications AS application
         WHERE application.organization_id = NEW.organization_id
           AND application.import_batch_id = NEW.import_batch_id
           AND (
             (
               application.approval_action IN (
                 'selected', 'create_separate'
               )
               AND application.application_state NOT IN (
                 'imported', 'failed'
               )
             )
             OR (
               application.approval_action = 'skip'
               AND application.application_state <> 'skipped'
             )
           )
       )
       AND NEW.completed_at IS NOT NULL
       AND NEW.completed_at = NEW.updated_at
       AND NEW.completed_at BETWEEN
           (unixepoch() * 1000) - 300000
           AND (unixepoch() * 1000) + 300000
       AND NEW.active_runner_version IS NULL
       AND NEW.active_runner_lease_hash IS NULL
       AND NEW.active_runner_expires_at IS NULL
       AND (
         (
           NEW.failed_row_count = 0
           AND NEW.phase = 'completed'
           AND NEW.outcome_code = 'completed'
         )
         OR (
           NEW.failed_row_count > 0
           AND NEW.phase = 'completed_with_errors'
           AND NEW.outcome_code = 'completed_with_errors'
         )
       )
       AND EXISTS (
         SELECT 1
         FROM import_batches AS batch
         WHERE batch.id = NEW.import_batch_id
           AND batch.organization_id = NEW.organization_id
           AND batch.status = 'completed'
           AND batch.completed_at = NEW.completed_at
       )
       AND (
         SELECT count(*)
         FROM audit_logs AS audit
         WHERE audit.organization_id = NEW.organization_id
           AND audit.actor_profile_id = NEW.updated_by_profile_id
           AND audit.action = 'import.completed'
           AND audit.entity_type = 'import_batch'
           AND audit.entity_id = NEW.import_batch_id
           AND audit.created_at = NEW.completed_at
           AND json_valid(audit.metadata_json)
           AND json_extract(
             audit.metadata_json,
             '$.selectedRowCount'
           ) = NEW.selected_row_count
           AND json_extract(
             audit.metadata_json,
             '$.importedRowCount'
           ) = NEW.imported_row_count
           AND json_extract(
             audit.metadata_json,
             '$.skippedRowCount'
           ) = NEW.skipped_row_count
           AND json_extract(
             audit.metadata_json,
             '$.failedRowCount'
           ) = NEW.failed_row_count
       ) = 1
     )
    THEN RAISE(ABORT, 'phase7_import_completion_envelope_invalid')
  END;
  SELECT CASE
    WHEN OLD.phase IN ('completed', 'completed_with_errors')
     AND (
       NEW.selected_row_count <> OLD.selected_row_count
       OR NEW.imported_row_count <> OLD.imported_row_count
       OR NEW.skipped_row_count <> OLD.skipped_row_count
       OR NEW.failed_row_count <> OLD.failed_row_count
       OR NEW.pending_row_count <> OLD.pending_row_count
       OR NEW.application_cursor <> OLD.application_cursor
       OR NEW.outcome_code IS NOT OLD.outcome_code
       OR NEW.started_at IS NOT OLD.started_at
       OR NEW.completed_at IS NOT OLD.completed_at
     )
    THEN RAISE(ABORT, 'phase7_import_completion_immutable')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS actor
      INNER JOIN profiles AS profile
        ON profile.id = actor.profile_id
       AND profile.status = 'active'
       AND profile.deleted_at IS NULL
      WHERE actor.organization_id = NEW.organization_id
        AND actor.profile_id = NEW.updated_by_profile_id
        AND actor.role IN ('owner', 'administrator')
        AND actor.status = 'active'
        AND actor.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'phase7_import_batch_actor_invalid')
  END;
  SELECT CASE
    WHEN NEW.approved_at IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM organization_memberships AS approver
       INNER JOIN profiles AS approver_profile
         ON approver_profile.id = approver.profile_id
        AND approver_profile.status = 'active'
        AND approver_profile.deleted_at IS NULL
       WHERE approver.organization_id = NEW.organization_id
         AND approver.profile_id = NEW.approved_by_profile_id
         AND approver.role IN ('owner', 'administrator')
         AND approver.status = 'active'
         AND approver.deleted_at IS NULL
     )
    THEN RAISE(ABORT, 'phase7_import_batch_approver_invalid')
  END;
  SELECT CASE
    WHEN OLD.phase <> 'approved'
     AND NEW.phase = 'approved'
     AND NOT (
       OLD.phase = 'previewed'
       AND NEW.approved_by_profile_id IS NOT NULL
       AND NEW.approved_at IS NOT NULL
       AND NEW.updated_by_profile_id = NEW.approved_by_profile_id
       AND NEW.updated_at = NEW.approved_at
       AND NEW.preview_fingerprint IS NOT NULL
       AND NEW.preview_fingerprint = OLD.preview_fingerprint
       AND NEW.preview_version = OLD.preview_version
       AND NEW.preview_version >= 1
       AND NEW.approved_at BETWEEN
           (unixepoch() * 1000) - 300000
           AND (unixepoch() * 1000) + 300000
       AND NEW.total_row_count = (
         SELECT count(*)
         FROM import_row_applications AS application
         WHERE application.organization_id = NEW.organization_id
           AND application.import_batch_id = NEW.import_batch_id
       )
       AND NOT EXISTS (
         SELECT 1
         FROM import_row_applications AS application
         WHERE application.organization_id = NEW.organization_id
           AND application.import_batch_id = NEW.import_batch_id
           AND (
             application.approval_action = 'pending'
             OR application.approved_by_profile_id
                IS NOT NEW.approved_by_profile_id
             OR application.approved_at IS NOT NEW.approved_at
             OR (
               application.approval_action IN (
                 'selected', 'create_separate'
               )
               AND application.application_state <> 'approved'
             )
             OR (
               application.approval_action = 'skip'
               AND application.application_state <> 'skipped'
             )
           )
       )
       AND NEW.selected_row_count = (
         SELECT count(*)
         FROM import_row_applications AS application
         WHERE application.organization_id = NEW.organization_id
           AND application.import_batch_id = NEW.import_batch_id
           AND application.approval_action IN (
             'selected', 'create_separate'
           )
       )
       AND NEW.skipped_row_count = (
         SELECT count(*)
         FROM import_row_applications AS application
         WHERE application.organization_id = NEW.organization_id
           AND application.import_batch_id = NEW.import_batch_id
           AND application.approval_action = 'skip'
       )
       AND NEW.pending_row_count = NEW.selected_row_count
       AND NEW.imported_row_count = 0
       AND NEW.failed_row_count = 0
       AND NEW.application_cursor = 0
       AND (
         SELECT count(*)
         FROM audit_logs AS audit
         WHERE audit.organization_id = NEW.organization_id
           AND audit.actor_profile_id = NEW.approved_by_profile_id
           AND audit.action = 'import.approved'
           AND audit.entity_type = 'import_batch'
           AND audit.entity_id = NEW.import_batch_id
           AND audit.created_at = NEW.approved_at
           AND json_valid(audit.metadata_json)
           AND json_extract(
             audit.metadata_json,
             '$.previewFingerprint'
           ) = NEW.preview_fingerprint
           AND json_extract(
             audit.metadata_json,
             '$.previewVersion'
           ) = NEW.preview_version
           AND json_extract(
             audit.metadata_json,
             '$.selectedRowCount'
           ) = NEW.selected_row_count
           AND json_extract(
             audit.metadata_json,
             '$.skippedRowCount'
           ) = NEW.skipped_row_count
       ) = 1
     )
    THEN RAISE(ABORT, 'phase7_import_approval_envelope_invalid')
  END;
  SELECT CASE
    WHEN OLD.phase <> 'redacted'
     AND NEW.phase = 'redacted'
     AND NOT (
       OLD.phase IN (
         'previewed', 'completed', 'completed_with_errors', 'failed'
       )
       AND OLD.source_payload_redacted_at IS NULL
       AND OLD.redacted_by_profile_id IS NULL
       AND NEW.source_payload_redacted_at IS NOT NULL
       AND NEW.redacted_by_profile_id IS NOT NULL
       AND NEW.updated_by_profile_id = NEW.redacted_by_profile_id
       AND (unixepoch() * 1000) >= OLD.created_at + 7776000000
       AND NEW.source_payload_redacted_at BETWEEN
           (unixepoch() * 1000) - 300000
           AND (unixepoch() * 1000) + 300000
       AND EXISTS (
         SELECT 1
         FROM organization_memberships AS owner
         INNER JOIN profiles AS owner_profile
           ON owner_profile.id = owner.profile_id
          AND owner_profile.status = 'active'
          AND owner_profile.deleted_at IS NULL
         INNER JOIN audit_logs AS audit
           ON audit.organization_id = owner.organization_id
          AND audit.actor_profile_id = owner.profile_id
          AND audit.action = 'import.source_payload_redacted'
          AND audit.entity_type = 'import_batch'
          AND audit.entity_id = NEW.import_batch_id
          AND audit.created_at = NEW.source_payload_redacted_at
         WHERE owner.organization_id = NEW.organization_id
           AND owner.profile_id = NEW.redacted_by_profile_id
           AND owner.role = 'owner'
           AND owner.status = 'active'
           AND owner.deleted_at IS NULL
       )
     )
    THEN RAISE(ABORT, 'phase7_import_source_redaction_transition_invalid')
  END;
  SELECT CASE
    WHEN NEW.source_payload_redacted_at IS NOT OLD.source_payload_redacted_at
     AND NOT (
       OLD.source_payload_redacted_at IS NULL
       AND NEW.source_payload_redacted_at IS NOT NULL
       AND (unixepoch() * 1000) >= OLD.created_at + 7776000000
       AND NEW.source_payload_redacted_at BETWEEN
           (unixepoch() * 1000) - 300000
           AND (unixepoch() * 1000) + 300000
       AND NEW.phase = 'redacted'
       AND EXISTS (
         SELECT 1
         FROM organization_memberships AS owner
         INNER JOIN profiles AS owner_profile
           ON owner_profile.id = owner.profile_id
          AND owner_profile.status = 'active'
          AND owner_profile.deleted_at IS NULL
         INNER JOIN audit_logs AS audit
           ON audit.organization_id = owner.organization_id
          AND audit.actor_profile_id = owner.profile_id
          AND audit.action = 'import.source_payload_redacted'
          AND audit.entity_type = 'import_batch'
          AND audit.entity_id = NEW.import_batch_id
          AND audit.created_at = NEW.source_payload_redacted_at
         WHERE owner.organization_id = NEW.organization_id
           AND owner.profile_id = NEW.redacted_by_profile_id
           AND owner.role = 'owner'
           AND owner.status = 'active'
           AND owner.deleted_at IS NULL
           AND NEW.updated_by_profile_id = NEW.redacted_by_profile_id
       )
     )
    THEN RAISE(ABORT, 'phase7_import_source_redaction_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS import_batch_details_phase7_before_delete
BEFORE DELETE ON import_batch_details
BEGIN
  SELECT RAISE(ABORT, 'phase7_import_batch_delete_denied');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS import_rows_phase7_org_before_insert
BEFORE INSERT ON import_rows
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM import_batches AS batch
      WHERE batch.id = NEW.import_batch_id
        AND batch.organization_id = NEW.organization_id
        AND (
          (
            batch.source_type <> 'csv'
            AND NOT EXISTS (
              SELECT 1
              FROM import_batch_details AS any_detail
              WHERE any_detail.import_batch_id = batch.id
            )
          )
          OR (
            batch.source_type = 'csv'
            AND EXISTS (
              SELECT 1
              FROM import_batch_details AS detail
              WHERE detail.import_batch_id = batch.id
                AND detail.organization_id = batch.organization_id
                AND detail.phase IN ('uploaded', 'previewed')
            )
          )
        )
    )
    THEN RAISE(ABORT, 'phase7_import_row_organization_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS import_rows_phase7_before_update
BEFORE UPDATE ON import_rows
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.import_batch_id <> OLD.import_batch_id
      OR NEW.row_number <> OLD.row_number
      OR NEW.created_at <> OLD.created_at
      OR NEW.updated_at < OLD.updated_at
      OR NOT EXISTS (
        SELECT 1
        FROM import_batches AS batch
        WHERE batch.id = OLD.import_batch_id
          AND batch.organization_id = OLD.organization_id
      )
      OR (
        (
          EXISTS (
            SELECT 1
            FROM import_batches AS batch
            WHERE batch.id = OLD.import_batch_id
              AND batch.organization_id = OLD.organization_id
              AND batch.source_type = 'csv'
          )
          OR EXISTS (
            SELECT 1
            FROM import_batch_details AS any_detail
            WHERE any_detail.import_batch_id = OLD.import_batch_id
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM import_batch_details AS detail
          WHERE detail.import_batch_id = OLD.import_batch_id
            AND detail.organization_id = OLD.organization_id
        )
      )
      OR EXISTS (
        SELECT 1
        FROM import_batch_details AS detail
        WHERE detail.import_batch_id = OLD.import_batch_id
          AND detail.organization_id = OLD.organization_id
          AND detail.phase IN (
            'approved', 'applying', 'completed', 'completed_with_errors',
            'interrupted', 'failed'
          )
          AND (
            NEW.source_payload_json <> OLD.source_payload_json
            OR NEW.normalized_payload_json
                IS NOT OLD.normalized_payload_json
            OR NEW.status <> OLD.status
            OR NEW.error_code IS NOT OLD.error_code
          )
      )
      OR (
        EXISTS (
          SELECT 1
          FROM import_batch_details AS detail
          WHERE detail.import_batch_id = OLD.import_batch_id
            AND detail.organization_id = OLD.organization_id
            AND detail.phase = 'redacted'
            AND detail.source_payload_redacted_at IS NOT NULL
            AND detail.redacted_by_profile_id IS NOT NULL
            AND detail.updated_by_profile_id =
                detail.redacted_by_profile_id
            AND EXISTS (
              SELECT 1
              FROM audit_logs AS audit
              WHERE audit.organization_id = detail.organization_id
                AND audit.actor_profile_id =
                    detail.redacted_by_profile_id
                AND audit.action = 'import.source_payload_redacted'
                AND audit.entity_type = 'import_batch'
                AND audit.entity_id = detail.import_batch_id
                AND audit.created_at =
                    detail.source_payload_redacted_at
            )
        )
        AND NOT (
          NEW.source_payload_json = '{"redacted":true}'
          AND NEW.normalized_payload_json = '{"redacted":true}'
          AND NEW.status = OLD.status
          AND NEW.error_code IS OLD.error_code
        )
      )
    THEN RAISE(ABORT, 'phase7_import_row_immutable')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS import_rows_phase7_before_delete
BEFORE DELETE ON import_rows
WHEN EXISTS (
  SELECT 1
  FROM import_batches AS batch
  WHERE batch.id = OLD.import_batch_id
    AND batch.source_type = 'csv'
)
OR EXISTS (
  SELECT 1
  FROM import_batch_details AS detail
  WHERE detail.import_batch_id = OLD.import_batch_id
)
BEGIN
  SELECT RAISE(ABORT, 'phase7_import_row_delete_denied');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS import_row_applications_phase7_before_insert
BEFORE INSERT ON import_row_applications
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM import_rows AS row
      INNER JOIN import_batch_details AS detail
        ON detail.import_batch_id = row.import_batch_id
       AND detail.organization_id = row.organization_id
      WHERE row.id = NEW.import_row_id
        AND row.import_batch_id = NEW.import_batch_id
        AND row.organization_id = NEW.organization_id
        AND detail.phase IN ('uploaded', 'previewed')
        AND NEW.approval_action = 'pending'
        AND NEW.duplicate_decision IS NULL
        AND NEW.duplicate_reason IS NULL
        AND NEW.conflict_decision IS NULL
        AND NEW.conflict_reason IS NULL
        AND NEW.target_organizer_event_id IS NULL
        AND NEW.application_state = 'previewed'
        AND NEW.result_code IS NULL
        AND NEW.approved_by_profile_id IS NULL
        AND NEW.apply_actor_profile_id IS NULL
        AND NEW.approved_at IS NULL
        AND NEW.applied_at IS NULL
    )
    THEN RAISE(ABORT, 'phase7_import_application_source_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS import_row_applications_phase7_before_update
BEFORE UPDATE ON import_row_applications
BEGIN
  SELECT CASE
    WHEN NEW.import_row_id <> OLD.import_row_id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.import_batch_id <> OLD.import_batch_id
      OR NEW.normalized_row_fingerprint <> OLD.normalized_row_fingerprint
      OR NEW.idempotency_key <> OLD.idempotency_key
      OR NEW.preview_result_code <> OLD.preview_result_code
      OR NEW.preview_error_codes_json <> OLD.preview_error_codes_json
      OR NEW.preview_warning_codes_json <> OLD.preview_warning_codes_json
      OR NEW.created_at <> OLD.created_at
      OR NEW.updated_at < OLD.updated_at
    THEN RAISE(ABORT, 'phase7_import_application_immutable')
  END;
  SELECT CASE
    WHEN OLD.approval_action = 'pending'
     AND NEW.approval_action <> 'pending'
     AND (
       (
         NEW.approval_action IN ('selected', 'create_separate')
         AND NEW.application_state <> 'approved'
       )
       OR (
         NEW.approval_action = 'skip'
         AND NEW.application_state <> 'skipped'
       )
       OR NEW.approved_by_profile_id IS NULL
       OR NEW.approved_at IS NULL
       OR NEW.updated_at <> NEW.approved_at
       OR NEW.approved_at NOT BETWEEN
          (unixepoch() * 1000) - 300000
          AND (unixepoch() * 1000) + 300000
       OR NOT EXISTS (
         SELECT 1
         FROM import_batch_details AS detail
         INNER JOIN audit_logs AS audit
           ON audit.organization_id = detail.organization_id
          AND audit.actor_profile_id = NEW.approved_by_profile_id
          AND audit.action = 'import.approved'
          AND audit.entity_type = 'import_batch'
          AND audit.entity_id = detail.import_batch_id
          AND audit.created_at = NEW.approved_at
          AND json_valid(audit.metadata_json)
          AND json_extract(
            audit.metadata_json,
            '$.previewFingerprint'
          ) = detail.preview_fingerprint
          AND json_extract(
            audit.metadata_json,
            '$.previewVersion'
          ) = detail.preview_version
         WHERE detail.import_batch_id = NEW.import_batch_id
           AND detail.organization_id = NEW.organization_id
           AND detail.phase = 'previewed'
           AND detail.preview_fingerprint IS NOT NULL
           AND detail.preview_version >= 1
       )
       OR (
         NEW.approval_action IN ('selected', 'create_separate')
         AND (
           NEW.result_code IS NOT NULL
           OR NEW.apply_actor_profile_id IS NOT NULL
           OR NEW.applied_at IS NOT NULL
           OR NEW.target_organizer_event_id IS NOT NULL
         )
       )
       OR (
         NEW.approval_action = 'skip'
         AND (
           NEW.result_code IS NULL
           OR NEW.result_code NOT IN (
             'invalid_preview',
             'hard_duplicate_source',
             'hard_duplicate_meetup_url',
             'hard_duplicate_batch_fingerprint',
             'semantic_duplicate_skipped',
             'skipped_by_approval'
           )
           OR NEW.apply_actor_profile_id
              IS NOT NEW.approved_by_profile_id
           OR NEW.applied_at IS NOT NEW.approved_at
           OR NEW.target_organizer_event_id IS NOT NULL
           OR (
             NEW.result_code IN (
               'hard_duplicate_source',
               'hard_duplicate_meetup_url',
               'hard_duplicate_batch_fingerprint',
               'semantic_duplicate_skipped'
             )
             AND NEW.duplicate_decision <> 'skip'
           )
         )
       )
     )
    THEN RAISE(ABORT, 'phase7_import_approval_transition_invalid')
  END;
  SELECT CASE
    WHEN OLD.approval_action <> 'pending'
     AND (
       NEW.approval_action <> OLD.approval_action
       OR NEW.duplicate_decision IS NOT OLD.duplicate_decision
       OR NEW.duplicate_reason IS NOT OLD.duplicate_reason
       OR NEW.conflict_decision IS NOT OLD.conflict_decision
       OR NEW.conflict_reason IS NOT OLD.conflict_reason
       OR NEW.approved_by_profile_id IS NOT OLD.approved_by_profile_id
       OR NEW.approved_at IS NOT OLD.approved_at
     )
    THEN RAISE(ABORT, 'phase7_import_approval_immutable')
  END;
  SELECT CASE
    WHEN NOT (
      (OLD.application_state = 'previewed'
       AND NEW.application_state IN ('previewed', 'approved', 'skipped'))
      OR (OLD.application_state = 'approved'
          AND NEW.application_state IN (
            'approved', 'applying', 'skipped', 'failed'
          ))
      OR (OLD.application_state = 'applying'
          AND NEW.application_state IN (
            'applying', 'imported', 'failed'
          ))
      OR (
        OLD.application_state IN (
          'imported', 'skipped', 'failed', 'redacted'
        )
        AND NEW.application_state = OLD.application_state
      )
    )
    THEN RAISE(ABORT, 'phase7_import_application_transition_invalid')
  END;
  SELECT CASE
    WHEN OLD.application_state IN (
      'imported', 'skipped', 'failed', 'redacted'
    )
     AND (
       NEW.target_organizer_event_id
           IS NOT OLD.target_organizer_event_id
       OR NEW.result_code IS NOT OLD.result_code
       OR NEW.apply_actor_profile_id
           IS NOT OLD.apply_actor_profile_id
       OR NEW.applied_at IS NOT OLD.applied_at
     )
    THEN RAISE(ABORT, 'phase7_import_application_terminal_immutable')
  END;
  SELECT CASE
    WHEN NEW.application_state = 'imported'
     AND (
       NEW.approval_action NOT IN ('selected', 'create_separate')
       OR NEW.result_code IS NULL
       OR NEW.result_code NOT IN (
         'imported_private',
         'imported_private_pending_administrator_review'
       )
       OR NEW.apply_actor_profile_id IS NULL
       OR NEW.applied_at IS NULL
       OR NEW.applied_at NOT BETWEEN
          (unixepoch() * 1000) - 300000
          AND (unixepoch() * 1000) + 300000
       OR (
         NEW.result_code =
           'imported_private_pending_administrator_review'
         AND NEW.conflict_decision <> 'administrator_review'
       )
     )
    THEN RAISE(ABORT, 'phase7_import_application_imported_shape_invalid')
  END;
  SELECT CASE
    WHEN NEW.application_state = 'skipped'
     AND (
       NEW.approval_action <> 'skip'
       OR NEW.result_code IS NULL
       OR NEW.result_code NOT IN (
         'invalid_preview',
         'hard_duplicate_source',
         'hard_duplicate_meetup_url',
         'hard_duplicate_batch_fingerprint',
         'semantic_duplicate_skipped',
         'skipped_by_approval'
       )
       OR NEW.apply_actor_profile_id IS NULL
       OR NEW.apply_actor_profile_id
          IS NOT NEW.approved_by_profile_id
       OR NEW.applied_at IS NULL
       OR NEW.applied_at IS NOT NEW.approved_at
       OR NEW.target_organizer_event_id IS NOT NULL
       OR (
         NEW.result_code IN (
           'hard_duplicate_source',
           'hard_duplicate_meetup_url',
           'hard_duplicate_batch_fingerprint',
           'semantic_duplicate_skipped'
         )
         AND NEW.duplicate_decision <> 'skip'
       )
     )
    THEN RAISE(ABORT, 'phase7_import_application_skipped_shape_invalid')
  END;
  SELECT CASE
    WHEN NEW.application_state = 'failed'
     AND (
       NEW.approval_action NOT IN ('selected', 'create_separate')
       OR NEW.result_code IS NULL
       OR NEW.result_code NOT IN (
         'mapping_unavailable',
         'actor_unavailable',
         'duplicate_detected_at_apply',
         'conflict_blocked',
         'conflict_reason_required',
         'stale_preview',
         'application_failed'
       )
       OR NEW.apply_actor_profile_id IS NULL
       OR NEW.applied_at IS NULL
       OR NEW.applied_at NOT BETWEEN
          (unixepoch() * 1000) - 300000
          AND (unixepoch() * 1000) + 300000
       OR NEW.target_organizer_event_id IS NOT NULL
       OR (
         NEW.result_code = 'duplicate_detected_at_apply'
         AND NEW.duplicate_decision <> 'skip'
       )
       OR (
         NEW.result_code = 'conflict_blocked'
         AND NEW.conflict_decision <> 'blocked'
       )
     )
    THEN RAISE(ABORT, 'phase7_import_application_failed_shape_invalid')
  END;
  SELECT CASE
    WHEN NEW.target_organizer_event_id IS NOT NULL
     AND (
       NEW.approval_action = 'pending'
       OR NOT EXISTS (
         SELECT 1
         FROM organizer_events AS event
         WHERE event.id = NEW.target_organizer_event_id
           AND event.organization_id = NEW.organization_id
       )
     )
    THEN RAISE(ABORT, 'phase7_import_target_before_approval')
  END;
  SELECT CASE
    WHEN NEW.approval_action <> 'pending'
     AND NOT EXISTS (
       SELECT 1
       FROM organization_memberships AS approver
       INNER JOIN profiles AS approver_profile
         ON approver_profile.id = approver.profile_id
        AND approver_profile.status = 'active'
        AND approver_profile.deleted_at IS NULL
       WHERE approver.organization_id = NEW.organization_id
         AND approver.profile_id = NEW.approved_by_profile_id
         AND approver.role IN ('owner', 'administrator')
         AND approver.status = 'active'
         AND approver.deleted_at IS NULL
     )
    THEN RAISE(ABORT, 'phase7_import_application_approver_invalid')
  END;
  SELECT CASE
    WHEN NEW.application_state IN ('applying', 'imported', 'skipped', 'failed')
     AND NOT EXISTS (
       SELECT 1
       FROM organization_memberships AS actor
       INNER JOIN profiles AS actor_profile
         ON actor_profile.id = actor.profile_id
        AND actor_profile.status = 'active'
        AND actor_profile.deleted_at IS NULL
       WHERE actor.organization_id = NEW.organization_id
         AND actor.profile_id = NEW.apply_actor_profile_id
         AND actor.role IN ('owner', 'administrator')
         AND actor.status = 'active'
         AND actor.deleted_at IS NULL
     )
    THEN RAISE(ABORT, 'phase7_import_application_actor_invalid')
  END;
  SELECT CASE
    WHEN NEW.application_state = 'imported'
     AND (
       NEW.target_organizer_event_id IS NULL
       OR NEW.result_code IS NULL
       OR NEW.apply_actor_profile_id IS NULL
       OR NEW.applied_at IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM import_rows AS row
         INNER JOIN import_batch_details AS detail
           ON detail.import_batch_id = row.import_batch_id
          AND detail.organization_id = row.organization_id
         INNER JOIN external_source_links AS source_link
           ON source_link.organization_id = NEW.organization_id
          AND source_link.entity_type = 'organizer_event'
          AND source_link.entity_id = NEW.target_organizer_event_id
          AND source_link.source_type = 'csv'
          AND source_link.sync_source_id = detail.source_namespace
          AND source_link.external_id = COALESCE(
            json_extract(row.normalized_payload_json, '$.externalId'),
            NEW.normalized_row_fingerprint
          )
          AND source_link.source_fingerprint =
              NEW.normalized_row_fingerprint
          AND source_link.deleted_at IS NULL
         WHERE row.id = NEW.import_row_id
           AND row.organization_id = NEW.organization_id
           AND row.import_batch_id = NEW.import_batch_id
       )
     )
    THEN RAISE(ABORT, 'phase7_import_application_receipt_missing')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS import_row_applications_phase7_before_delete
BEFORE DELETE ON import_row_applications
BEGIN
  SELECT RAISE(ABORT, 'phase7_import_application_delete_denied');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS external_source_links_phase7_csv_before_insert
BEFORE INSERT ON external_source_links
WHEN NEW.source_type = 'csv'
BEGIN
  SELECT CASE
    WHEN NEW.entity_type <> 'organizer_event'
      OR NEW.sync_source_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM import_row_applications AS application
        INNER JOIN import_rows AS row
          ON row.id = application.import_row_id
         AND row.import_batch_id = application.import_batch_id
         AND row.organization_id = application.organization_id
        INNER JOIN import_batch_details AS detail
          ON detail.import_batch_id = application.import_batch_id
         AND detail.organization_id = application.organization_id
        WHERE application.organization_id = NEW.organization_id
          AND application.target_organizer_event_id = NEW.entity_id
          AND application.application_state IN ('applying', 'imported')
          AND application.approval_action IN ('selected', 'create_separate')
          AND NEW.sync_source_id = detail.source_namespace
          AND NEW.external_id = COALESCE(
            json_extract(row.normalized_payload_json, '$.externalId'),
            application.normalized_row_fingerprint
          )
          AND NEW.source_fingerprint =
              application.normalized_row_fingerprint
          AND NEW.deleted_at IS NULL
      )
    THEN RAISE(ABORT, 'phase7_csv_source_link_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS external_source_links_phase7_csv_before_update
BEFORE UPDATE ON external_source_links
WHEN NEW.source_type = 'csv' OR OLD.source_type = 'csv'
BEGIN
  SELECT CASE
    WHEN NEW.organization_id <> OLD.organization_id
      OR NEW.source_type <> OLD.source_type
      OR NEW.sync_source_id IS NOT OLD.sync_source_id
      OR NEW.external_id <> OLD.external_id
      OR NEW.entity_id <> OLD.entity_id
      OR NEW.source_fingerprint IS NOT OLD.source_fingerprint
      OR NEW.deleted_at IS NOT OLD.deleted_at
      OR NEW.entity_type <> 'organizer_event'
      OR NOT EXISTS (
        SELECT 1
        FROM import_row_applications AS application
        INNER JOIN import_rows AS row
          ON row.id = application.import_row_id
         AND row.import_batch_id = application.import_batch_id
         AND row.organization_id = application.organization_id
        INNER JOIN import_batch_details AS detail
          ON detail.import_batch_id = application.import_batch_id
         AND detail.organization_id = application.organization_id
        WHERE application.organization_id = NEW.organization_id
          AND application.target_organizer_event_id = NEW.entity_id
          AND application.application_state IN ('applying', 'imported')
          AND application.approval_action IN ('selected', 'create_separate')
          AND NEW.sync_source_id = detail.source_namespace
          AND NEW.external_id = COALESCE(
            json_extract(row.normalized_payload_json, '$.externalId'),
            application.normalized_row_fingerprint
          )
          AND NEW.source_fingerprint =
              application.normalized_row_fingerprint
      )
    THEN RAISE(ABORT, 'phase7_csv_source_link_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS external_source_links_phase7_csv_before_delete
BEFORE DELETE ON external_source_links
WHEN OLD.source_type = 'csv'
BEGIN
  SELECT RAISE(ABORT, 'phase7_csv_source_link_delete_denied');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS ics_subscription_tokens_phase7_before_insert
BEFORE INSERT ON ics_subscription_tokens
BEGIN
  SELECT CASE
    WHEN length(NEW.token_hash) <> 64
      OR NEW.token_hash <> lower(NEW.token_hash)
      OR NEW.token_hash GLOB '*[^0-9a-f]*'
      OR NEW.last_used_at IS NOT NULL
      OR NEW.revoked_at IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM organization_memberships AS membership
        INNER JOIN profiles AS profile
          ON profile.id = membership.profile_id
         AND profile.status = 'active'
         AND profile.deleted_at IS NULL
        WHERE membership.organization_id = NEW.organization_id
          AND membership.profile_id = NEW.profile_id
          AND membership.role IN ('owner', 'administrator', 'organizer')
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
      )
      OR (
        SELECT count(*)
        FROM ics_subscription_tokens AS token
        WHERE token.organization_id = NEW.organization_id
          AND token.profile_id = NEW.profile_id
          AND token.revoked_at IS NULL
      ) >= 3
    THEN RAISE(ABORT, 'phase7_ics_subscription_token_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS ics_subscription_tokens_phase7_before_update
BEFORE UPDATE ON ics_subscription_tokens
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.profile_id <> OLD.profile_id
      OR NEW.token_hash <> OLD.token_hash
      OR NEW.label IS NOT OLD.label
      OR NEW.created_at <> OLD.created_at
      OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
      OR (OLD.last_used_at IS NOT NULL
          AND NEW.last_used_at IS NOT OLD.last_used_at
          AND NEW.last_used_at < OLD.last_used_at + 86400000)
      OR (NEW.last_used_at IS NOT OLD.last_used_at
          AND (
            NEW.last_used_at < (unixepoch() * 1000) - 300000
            OR NEW.last_used_at > (unixepoch() * 1000) + 300000
          ))
      OR NOT EXISTS (
        SELECT 1
        FROM organization_memberships AS membership
        INNER JOIN profiles AS profile
          ON profile.id = membership.profile_id
         AND profile.status = 'active'
         AND profile.deleted_at IS NULL
        WHERE membership.organization_id = NEW.organization_id
          AND membership.profile_id = NEW.profile_id
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
      )
    THEN RAISE(ABORT, 'phase7_ics_subscription_token_update_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS ics_subscription_tokens_phase7_before_delete
BEFORE DELETE ON ics_subscription_tokens
BEGIN
  SELECT RAISE(ABORT, 'phase7_ics_subscription_token_delete_denied');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS event_calendar_component_revisions_phase7_before_insert
BEFORE INSERT ON event_calendar_component_revisions
BEGIN
  SELECT CASE
    WHEN NEW.sequence <> 0
      OR NEW.last_modified_at <> NEW.created_at
      OR NEW.updated_at <> NEW.created_at
      OR NEW.created_at < (unixepoch() * 1000) - 1000
      OR NEW.created_at > (unixepoch() * 1000)
      OR NOT EXISTS (
        SELECT 1
        FROM organizations AS organization
        WHERE organization.id = NEW.organization_id
          AND organization.deleted_at IS NULL
      )
    THEN RAISE(
      ABORT,
      'phase7_calendar_component_revision_initial_state_invalid'
    )
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS event_calendar_component_revisions_phase7_before_update
BEFORE UPDATE ON event_calendar_component_revisions
BEGIN
  SELECT CASE
    WHEN NEW.organization_id <> OLD.organization_id
      OR NEW.scope <> OLD.scope
      OR NEW.event_key <> OLD.event_key
      OR NEW.created_at <> OLD.created_at
      OR NEW.canonical_fingerprint =
         OLD.canonical_fingerprint
      OR OLD.sequence >= 2147483647
      OR NEW.sequence <> OLD.sequence + 1
      OR NEW.last_modified_at <> max(
        OLD.last_modified_at + 1000,
        NEW.updated_at
      )
      OR NEW.updated_at < OLD.updated_at
      OR NEW.updated_at < (unixepoch() * 1000) - 1000
      OR NEW.updated_at > (unixepoch() * 1000)
    THEN RAISE(
      ABORT,
      'phase7_calendar_component_revision_transition_invalid'
    )
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS event_calendar_component_revisions_phase7_before_delete
BEFORE DELETE ON event_calendar_component_revisions
BEGIN
  SELECT RAISE(
    ABORT,
    'phase7_calendar_component_revision_delete_denied'
  );
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_rate_limits_phase7_import_before_insert
BEFORE INSERT ON organizer_rate_limits
WHEN NEW.action IN (
  'csv_import_preview_15m',
  'csv_import_batch_day',
  'csv_import_apply_hour'
)
BEGIN
  SELECT CASE
    WHEN NEW.organization_id IS NULL
      OR NEW.profile_id IS NULL
      OR length(NEW.scope_key) <> 64
      OR NEW.scope_key <> lower(NEW.scope_key)
      OR NEW.scope_key GLOB '*[^0-9a-f]*'
      OR (
        NEW.action = 'csv_import_preview_15m'
        AND NEW.request_count > 5
      )
      OR (
        NEW.action = 'csv_import_batch_day'
        AND NEW.request_count > 20
      )
      OR (
        NEW.action = 'csv_import_apply_hour'
        AND NEW.request_count > 120
      )
      OR (
        NEW.action = 'csv_import_preview_15m'
        AND (
          NEW.window_expires_at <> NEW.window_started_at + 900000
          OR NEW.window_started_at % 900000 <> 0
        )
      )
      OR (
        NEW.action = 'csv_import_batch_day'
        AND (
          NEW.window_expires_at <> NEW.window_started_at + 86400000
          OR NEW.window_started_at % 86400000 <> 0
        )
      )
      OR (
        NEW.action = 'csv_import_apply_hour'
        AND (
          NEW.window_expires_at <> NEW.window_started_at + 3600000
          OR NEW.window_started_at % 3600000 <> 0
        )
      )
      OR NOT EXISTS (
        SELECT 1
        FROM organization_memberships AS membership
        INNER JOIN profiles AS profile
          ON profile.id = membership.profile_id
         AND profile.status = 'active'
         AND profile.deleted_at IS NULL
        WHERE membership.organization_id = NEW.organization_id
          AND membership.profile_id = NEW.profile_id
          AND membership.role IN ('owner', 'administrator')
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
      )
    THEN RAISE(ABORT, 'phase7_import_rate_limit_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_rate_limits_phase7_import_before_update
BEFORE UPDATE ON organizer_rate_limits
WHEN NEW.action IN (
  'csv_import_preview_15m',
  'csv_import_batch_day',
  'csv_import_apply_hour'
) OR OLD.action IN (
  'csv_import_preview_15m',
  'csv_import_batch_day',
  'csv_import_apply_hour'
)
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id IS NOT OLD.organization_id
      OR NEW.profile_id IS NOT OLD.profile_id
      OR NEW.action <> OLD.action
      OR NEW.scope_key <> OLD.scope_key
      OR NEW.window_started_at <> OLD.window_started_at
      OR NEW.window_expires_at <> OLD.window_expires_at
      OR NEW.created_at <> OLD.created_at
      OR NEW.request_count < OLD.request_count
      OR (
        NEW.action = 'csv_import_preview_15m'
        AND NEW.request_count > 5
      )
      OR (
        NEW.action = 'csv_import_batch_day'
        AND NEW.request_count > 20
      )
      OR (
        NEW.action = 'csv_import_apply_hour'
        AND NEW.request_count > 120
      )
      OR (
        NEW.action = 'csv_import_preview_15m'
        AND (
          NEW.window_expires_at <> NEW.window_started_at + 900000
          OR NEW.window_started_at % 900000 <> 0
        )
      )
      OR (
        NEW.action = 'csv_import_batch_day'
        AND (
          NEW.window_expires_at <> NEW.window_started_at + 86400000
          OR NEW.window_started_at % 86400000 <> 0
        )
      )
      OR (
        NEW.action = 'csv_import_apply_hour'
        AND (
          NEW.window_expires_at <> NEW.window_started_at + 3600000
          OR NEW.window_started_at % 3600000 <> 0
        )
      )
      OR NOT EXISTS (
        SELECT 1
        FROM organization_memberships AS membership
        INNER JOIN profiles AS profile
          ON profile.id = membership.profile_id
         AND profile.status = 'active'
         AND profile.deleted_at IS NULL
        WHERE membership.organization_id = NEW.organization_id
          AND membership.profile_id = NEW.profile_id
          AND membership.role IN ('owner', 'administrator')
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
      )
    THEN RAISE(ABORT, 'phase7_import_rate_limit_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_email_outbox_phase7_before_insert
BEFORE INSERT ON form_submission_email_outbox
BEGIN
  SELECT CASE
    WHEN NEW.destination_key <> 'owner_inbox'
      OR NEW.state <> 'pending'
      OR NEW.attempt_count <> 0
      OR NEW.lease_token_hash IS NOT NULL
      OR NEW.lease_expires_at IS NOT NULL
      OR NEW.provider_message_id IS NOT NULL
      OR NEW.last_error_code IS NOT NULL
      OR NEW.sent_at IS NOT NULL
      OR NEW.suppressed_at IS NOT NULL
      OR NEW.created_at <> NEW.updated_at
      OR NOT EXISTS (
        SELECT 1
        FROM form_submissions AS submission
        INNER JOIN form_submission_workflows AS workflow
          ON workflow.submission_id = submission.id
         AND workflow.organization_id = submission.organization_id
        WHERE submission.id = NEW.submission_id
          AND submission.organization_id = NEW.organization_id
          AND submission.created_at = NEW.created_at
          AND submission.status <> 'spam'
          AND submission.deleted_at IS NULL
          AND workflow.canonical_status <> 'spam'
          AND workflow.redacted_at IS NULL
      )
    THEN RAISE(ABORT, 'phase7_form_email_outbox_insert_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_email_outbox_phase7_before_update
BEFORE UPDATE ON form_submission_email_outbox
BEGIN
  SELECT CASE
    WHEN NEW.submission_id <> OLD.submission_id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.destination_key <> OLD.destination_key
      OR NEW.created_at <> OLD.created_at
      OR NEW.attempt_count < OLD.attempt_count
      OR NEW.updated_at < OLD.updated_at
      OR OLD.state IN ('sent', 'suppressed')
      OR (
        NEW.state <> 'suppressed'
        AND NOT EXISTS (
          SELECT 1
          FROM form_submissions AS submission
          INNER JOIN form_submission_workflows AS workflow
            ON workflow.submission_id = submission.id
           AND workflow.organization_id = submission.organization_id
          WHERE submission.id = NEW.submission_id
            AND submission.organization_id = NEW.organization_id
            AND submission.status <> 'spam'
            AND submission.deleted_at IS NULL
            AND workflow.canonical_status <> 'spam'
            AND workflow.redacted_at IS NULL
        )
      )
      OR (
        NEW.state = 'suppressed'
        AND NOT EXISTS (
          SELECT 1
          FROM form_submissions AS submission
          INNER JOIN form_submission_workflows AS workflow
            ON workflow.submission_id = submission.id
           AND workflow.organization_id = submission.organization_id
          WHERE submission.id = NEW.submission_id
            AND submission.organization_id = NEW.organization_id
            AND (
              submission.status = 'spam'
              OR submission.deleted_at IS NOT NULL
              OR workflow.canonical_status = 'spam'
              OR workflow.redacted_at IS NOT NULL
            )
        )
      )
    THEN RAISE(ABORT, 'phase7_form_email_outbox_update_invalid')
  END;
END;`,
]);

export const PHASE7_INVARIANT_COUNT_SQL = Object.freeze([
  String.raw`
SELECT COALESCE(sum(count_group.violation_count), 0) AS violation_count
FROM (
  SELECT count(*) AS violation_count
  FROM form_submission_workflows AS workflow
  LEFT JOIN form_submissions AS submission
    ON submission.id = workflow.submission_id
   AND submission.organization_id = workflow.organization_id
  LEFT JOIN form_submission_write_intents AS intent
    ON intent.id = workflow.write_intent_id
   AND intent.organization_id = workflow.organization_id
   AND intent.submission_id = workflow.submission_id
  LEFT JOIN audit_logs AS audit
    ON audit.id = intent.completion_audit_log_id
   AND audit.organization_id = intent.organization_id
   AND audit.actor_profile_id IS intent.actor_profile_id
   AND audit.entity_type = 'form_submission'
   AND audit.entity_id = intent.submission_id
  WHERE submission.id IS NULL
     OR intent.id IS NULL
     OR intent.completed_at IS NULL
     OR audit.id IS NULL
     OR workflow.version <> intent.proposed_workflow_version
     OR workflow.canonical_status <> intent.proposed_canonical_status
     OR submission.assigned_to_profile_id
         IS NOT intent.proposed_assigned_to_profile_id
     OR submission.payload_json <> intent.proposed_payload_json
     OR (
       workflow.redacted_at IS NOT NULL
       AND (
         submission.payload_json <> '{"redacted":true}'
         OR intent.action <> 'redact'
         OR intent.proposed_payload_json <> '{"redacted":true}'
         OR EXISTS (
           SELECT 1
           FROM form_submission_write_intents AS historical_intent
           WHERE historical_intent.organization_id =
                 workflow.organization_id
             AND historical_intent.submission_id =
                 workflow.submission_id
             AND historical_intent.proposed_payload_json <>
                 '{"redacted":true}'
         )
       )
     )
     OR audit.action <> CASE intent.action
       WHEN 'create' THEN 'form_submission.created'
       WHEN 'assign' THEN 'form_submission.assigned'
       WHEN 'status' THEN 'form_submission.status_changed'
       ELSE 'form_submission.personal_content_redacted'
     END
     OR NOT (
       (workflow.canonical_status = 'new' AND submission.status = 'new')
       OR (workflow.canonical_status = 'in_review'
           AND submission.status = 'in_review')
       OR (workflow.canonical_status IN ('responded', 'archived')
           AND submission.status = 'resolved')
       OR (workflow.canonical_status = 'spam' AND submission.status = 'spam')
     )
     OR (
       submission.assigned_to_profile_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM organization_memberships AS membership
         INNER JOIN profiles AS profile
           ON profile.id = membership.profile_id
          AND profile.status = 'active'
          AND profile.deleted_at IS NULL
         WHERE membership.organization_id = workflow.organization_id
           AND membership.profile_id = submission.assigned_to_profile_id
           AND membership.status = 'active'
           AND membership.deleted_at IS NULL
       )
     )
  UNION ALL
  SELECT count(*) AS violation_count
  FROM form_submission_write_intents AS open_intent
  WHERE open_intent.completed_at IS NULL
) AS count_group`,
  String.raw`
SELECT count(*) AS violation_count
FROM form_submission_notes AS note
WHERE NOT EXISTS (
  SELECT 1
  FROM form_submissions AS submission
  INNER JOIN form_submission_workflows AS workflow
    ON workflow.submission_id = submission.id
   AND workflow.organization_id = submission.organization_id
  WHERE submission.id = note.submission_id
    AND submission.organization_id = note.organization_id
)
OR (
  note.redacted_at IS NOT NULL
  AND note.body_text <> '[redacted]'
)`,
  String.raw`
SELECT COALESCE(sum(count_group.violation_count), 0) AS violation_count
FROM (
  SELECT count(*) AS violation_count
  FROM public_form_protection_keys AS protection_key
  WHERE length(protection_key.key_hex) <> 64
     OR protection_key.key_hex <> lower(protection_key.key_hex)
     OR protection_key.key_hex GLOB '*[^0-9a-f]*'
  UNION ALL
  SELECT count(*) AS violation_count
  FROM public_form_rate_windows AS rate_window
  WHERE length(rate_window.scope_key) <> 64
     OR rate_window.scope_key <> lower(rate_window.scope_key)
     OR rate_window.scope_key GLOB '*[^0-9a-f]*'
     OR (rate_window.action = 'public_form_scope_15m'
         AND rate_window.request_count > 5)
     OR (rate_window.action = 'public_form_scope_day'
         AND rate_window.request_count > 20)
     OR (rate_window.action = 'public_form_organization_hour'
         AND rate_window.request_count > 500)
     OR (rate_window.action = 'public_form_scope_15m'
         AND (
           rate_window.window_ends_at <>
               rate_window.window_started_at + 900000
           OR rate_window.window_started_at % 900000 <> 0
         ))
     OR (rate_window.action = 'public_form_scope_day'
         AND (
           rate_window.window_ends_at <>
               rate_window.window_started_at + 86400000
           OR rate_window.window_started_at % 86400000 <> 0
         ))
     OR (rate_window.action = 'public_form_organization_hour'
         AND (
           rate_window.window_ends_at <>
               rate_window.window_started_at + 3600000
           OR rate_window.window_started_at % 3600000 <> 0
         ))
) AS count_group`,
  String.raw`
SELECT COALESCE(sum(count_group.violation_count), 0) AS violation_count
FROM (
  SELECT count(*) AS violation_count
  FROM import_batch_details AS detail
  LEFT JOIN import_batches AS batch
    ON batch.id = detail.import_batch_id
   AND batch.organization_id = detail.organization_id
   AND batch.source_type = 'csv'
  WHERE batch.id IS NULL
     OR (
       detail.phase <> 'uploaded'
       AND detail.total_row_count <> (
         SELECT count(*)
         FROM import_rows AS row
         WHERE row.organization_id = detail.organization_id
           AND row.import_batch_id = detail.import_batch_id
       )
     )
     OR (
       (
         detail.phase IN (
           'approved', 'applying', 'completed',
           'completed_with_errors', 'interrupted'
         )
         OR detail.approved_at IS NOT NULL
         OR detail.approved_by_profile_id IS NOT NULL
       )
       AND (
         detail.approved_at IS NULL
         OR detail.approved_by_profile_id IS NULL
         OR detail.preview_fingerprint IS NULL
         OR detail.preview_version < 1
         OR detail.total_row_count <> (
           SELECT count(*)
           FROM import_row_applications AS application
           WHERE application.organization_id = detail.organization_id
             AND application.import_batch_id = detail.import_batch_id
         )
         OR EXISTS (
           SELECT 1
           FROM import_row_applications AS application
           WHERE application.organization_id = detail.organization_id
             AND application.import_batch_id = detail.import_batch_id
             AND (
               application.approval_action = 'pending'
               OR application.approved_by_profile_id
                  IS NOT detail.approved_by_profile_id
               OR application.approved_at IS NOT detail.approved_at
               OR (
                 application.approval_action IN (
                   'selected', 'create_separate'
                 )
                 AND application.application_state NOT IN (
                   'approved', 'applying', 'imported', 'failed'
                 )
               )
               OR (
                 application.approval_action = 'skip'
                 AND application.application_state <> 'skipped'
               )
             )
         )
         OR detail.selected_row_count <> (
           SELECT count(*)
           FROM import_row_applications AS application
           WHERE application.organization_id = detail.organization_id
             AND application.import_batch_id = detail.import_batch_id
             AND application.approval_action IN (
               'selected', 'create_separate'
             )
         )
         OR detail.skipped_row_count < (
           SELECT count(*)
           FROM import_row_applications AS application
           WHERE application.organization_id = detail.organization_id
             AND application.import_batch_id = detail.import_batch_id
             AND application.approval_action = 'skip'
         )
         OR (
           detail.phase = 'approved'
           AND detail.pending_row_count <> detail.selected_row_count
         )
         OR (
           SELECT count(*)
           FROM audit_logs AS audit
           WHERE audit.organization_id = detail.organization_id
             AND audit.actor_profile_id =
                 detail.approved_by_profile_id
             AND audit.action = 'import.approved'
             AND audit.entity_type = 'import_batch'
             AND audit.entity_id = detail.import_batch_id
             AND audit.created_at = detail.approved_at
             AND json_valid(audit.metadata_json)
             AND json_extract(
               audit.metadata_json,
               '$.previewFingerprint'
             ) = detail.preview_fingerprint
             AND json_extract(
               audit.metadata_json,
               '$.previewVersion'
             ) = detail.preview_version
             AND json_extract(
               audit.metadata_json,
               '$.selectedRowCount'
             ) = detail.selected_row_count
             AND json_extract(
               audit.metadata_json,
               '$.skippedRowCount'
             ) = (
               SELECT count(*)
               FROM import_row_applications AS application
               WHERE application.organization_id =
                     detail.organization_id
                 AND application.import_batch_id =
                     detail.import_batch_id
                 AND application.approval_action = 'skip'
             )
         ) <> 1
       )
     )
     OR (
       detail.phase IN ('completed', 'completed_with_errors')
       AND (
         detail.pending_row_count <> 0
         OR detail.application_cursor <> detail.selected_row_count
         OR detail.imported_row_count + detail.failed_row_count <>
            detail.selected_row_count
         OR detail.imported_row_count <> (
           SELECT count(*)
           FROM import_row_applications AS application
           WHERE application.organization_id = detail.organization_id
             AND application.import_batch_id = detail.import_batch_id
             AND application.approval_action IN (
               'selected', 'create_separate'
             )
             AND application.application_state = 'imported'
         )
         OR detail.failed_row_count <> (
           SELECT count(*)
           FROM import_row_applications AS application
           WHERE application.organization_id = detail.organization_id
             AND application.import_batch_id = detail.import_batch_id
             AND application.approval_action IN (
               'selected', 'create_separate'
             )
             AND application.application_state = 'failed'
         )
         OR detail.skipped_row_count <> (
           SELECT count(*)
           FROM import_row_applications AS application
           WHERE application.organization_id = detail.organization_id
             AND application.import_batch_id = detail.import_batch_id
             AND application.approval_action = 'skip'
             AND application.application_state = 'skipped'
         )
         OR detail.completed_at IS NULL
         OR (
           detail.failed_row_count = 0
           AND (
             detail.phase <> 'completed'
             OR detail.outcome_code <> 'completed'
           )
         )
         OR (
           detail.failed_row_count > 0
           AND (
             detail.phase <> 'completed_with_errors'
             OR detail.outcome_code <> 'completed_with_errors'
           )
         )
         OR detail.active_runner_version IS NOT NULL
         OR detail.active_runner_lease_hash IS NOT NULL
         OR detail.active_runner_expires_at IS NOT NULL
         OR NOT EXISTS (
           SELECT 1
           FROM import_batches AS terminal_batch
           WHERE terminal_batch.id = detail.import_batch_id
             AND terminal_batch.organization_id =
                 detail.organization_id
             AND terminal_batch.status = 'completed'
             AND terminal_batch.completed_at = detail.completed_at
         )
         OR (
           SELECT count(*)
           FROM audit_logs AS audit
           WHERE audit.organization_id = detail.organization_id
             AND audit.actor_profile_id =
                 detail.updated_by_profile_id
             AND audit.action = 'import.completed'
             AND audit.entity_type = 'import_batch'
             AND audit.entity_id = detail.import_batch_id
             AND audit.created_at = detail.completed_at
             AND json_valid(audit.metadata_json)
             AND json_extract(
               audit.metadata_json,
               '$.selectedRowCount'
             ) = detail.selected_row_count
             AND json_extract(
               audit.metadata_json,
               '$.importedRowCount'
             ) = detail.imported_row_count
             AND json_extract(
               audit.metadata_json,
               '$.skippedRowCount'
             ) = detail.skipped_row_count
             AND json_extract(
               audit.metadata_json,
               '$.failedRowCount'
             ) = detail.failed_row_count
         ) <> 1
       )
     )
     OR (
       detail.phase = 'redacted'
       AND (
         detail.source_payload_redacted_at IS NULL
         OR detail.redacted_by_profile_id IS NULL
         OR detail.updated_by_profile_id
            IS NOT detail.redacted_by_profile_id
         OR detail.source_payload_redacted_at <
            detail.created_at + 7776000000
         OR (
           SELECT count(*)
           FROM audit_logs AS audit
           WHERE audit.organization_id = detail.organization_id
             AND audit.actor_profile_id =
                 detail.redacted_by_profile_id
             AND audit.action = 'import.source_payload_redacted'
             AND audit.entity_type = 'import_batch'
             AND audit.entity_id = detail.import_batch_id
             AND audit.created_at =
                 detail.source_payload_redacted_at
         ) <> 1
         OR EXISTS (
           SELECT 1
           FROM import_rows AS row
           WHERE row.organization_id = detail.organization_id
             AND row.import_batch_id = detail.import_batch_id
             AND (
               row.source_payload_json <> '{"redacted":true}'
               OR row.normalized_payload_json <> '{"redacted":true}'
             )
         )
       )
     )
     OR (
       detail.phase <> 'redacted'
       AND (
         detail.source_payload_redacted_at IS NOT NULL
         OR detail.redacted_by_profile_id IS NOT NULL
       )
     )
  UNION ALL
  SELECT count(*) AS violation_count
  FROM import_batches AS batch
  WHERE batch.source_type = 'csv'
    AND NOT EXISTS (
      SELECT 1
      FROM import_batch_details AS detail
      WHERE detail.import_batch_id = batch.id
        AND detail.organization_id = batch.organization_id
    )
  UNION ALL
  SELECT count(*) AS violation_count
  FROM import_rows AS row
  LEFT JOIN import_batches AS batch
    ON batch.id = row.import_batch_id
   AND batch.organization_id = row.organization_id
  WHERE batch.id IS NULL
) AS count_group`,
  String.raw`
SELECT COALESCE(sum(count_group.violation_count), 0) AS violation_count
FROM (
  SELECT count(*) AS violation_count
  FROM import_row_applications AS application
  LEFT JOIN import_rows AS row
    ON row.id = application.import_row_id
   AND row.import_batch_id = application.import_batch_id
   AND row.organization_id = application.organization_id
  LEFT JOIN import_batch_details AS detail
    ON detail.import_batch_id = application.import_batch_id
   AND detail.organization_id = application.organization_id
  WHERE row.id IS NULL
     OR detail.import_batch_id IS NULL
     OR (
       application.approval_action = 'pending'
       AND (
         application.approved_by_profile_id IS NOT NULL
         OR application.approved_at IS NOT NULL
         OR application.application_state <> 'previewed'
       )
     )
     OR (
       application.approval_action <> 'pending'
       AND (
         application.approved_by_profile_id IS NULL
         OR application.approved_at IS NULL
         OR detail.approved_by_profile_id IS NULL
         OR detail.approved_at IS NULL
         OR application.approved_by_profile_id
            IS NOT detail.approved_by_profile_id
         OR application.approved_at IS NOT detail.approved_at
         OR (
           application.approval_action IN (
             'selected', 'create_separate'
           )
           AND application.application_state NOT IN (
             'approved', 'applying', 'imported', 'failed'
           )
         )
         OR (
           application.approval_action = 'skip'
           AND application.application_state <> 'skipped'
         )
       )
     )
     OR (
       detail.phase = 'previewed'
       AND application.approval_action <> 'pending'
     )
     OR (
       application.application_state = 'applying'
       AND NOT EXISTS (
         SELECT 1
         FROM organization_memberships AS actor
         INNER JOIN profiles AS actor_profile
           ON actor_profile.id = actor.profile_id
          AND actor_profile.status = 'active'
          AND actor_profile.deleted_at IS NULL
         WHERE actor.organization_id = application.organization_id
           AND actor.profile_id = application.apply_actor_profile_id
           AND actor.role IN ('owner', 'administrator')
           AND actor.status = 'active'
           AND actor.deleted_at IS NULL
       )
     )
     OR (
       application.application_state = 'imported'
       AND (
         application.approval_action NOT IN (
           'selected', 'create_separate'
         )
         OR application.result_code IS NULL
         OR application.result_code NOT IN (
           'imported_private',
           'imported_private_pending_administrator_review'
         )
         OR application.apply_actor_profile_id IS NULL
         OR application.applied_at IS NULL
         OR (
           application.result_code =
             'imported_private_pending_administrator_review'
           AND application.conflict_decision <>
               'administrator_review'
         )
       )
     )
     OR (
       application.application_state = 'skipped'
       AND (
         application.approval_action <> 'skip'
         OR application.result_code IS NULL
         OR application.result_code NOT IN (
           'invalid_preview',
           'hard_duplicate_source',
           'hard_duplicate_meetup_url',
           'hard_duplicate_batch_fingerprint',
           'semantic_duplicate_skipped',
           'skipped_by_approval'
         )
         OR application.apply_actor_profile_id IS NULL
         OR application.apply_actor_profile_id
            IS NOT application.approved_by_profile_id
         OR application.applied_at IS NULL
         OR application.applied_at IS NOT application.approved_at
         OR application.target_organizer_event_id IS NOT NULL
         OR (
           application.result_code IN (
             'hard_duplicate_source',
             'hard_duplicate_meetup_url',
             'hard_duplicate_batch_fingerprint',
             'semantic_duplicate_skipped'
           )
           AND application.duplicate_decision <> 'skip'
         )
       )
     )
     OR (
       application.application_state = 'failed'
       AND (
         application.approval_action NOT IN (
           'selected', 'create_separate'
         )
         OR application.result_code IS NULL
         OR application.result_code NOT IN (
           'mapping_unavailable',
           'actor_unavailable',
           'duplicate_detected_at_apply',
           'conflict_blocked',
           'conflict_reason_required',
           'stale_preview',
           'application_failed'
         )
         OR application.apply_actor_profile_id IS NULL
         OR application.applied_at IS NULL
         OR application.target_organizer_event_id IS NOT NULL
         OR (
           application.result_code = 'duplicate_detected_at_apply'
           AND application.duplicate_decision <> 'skip'
         )
         OR (
           application.result_code = 'conflict_blocked'
           AND application.conflict_decision <> 'blocked'
         )
       )
     )
     OR (
       application.target_organizer_event_id IS NOT NULL
       AND (
         application.approval_action = 'pending'
         OR NOT EXISTS (
           SELECT 1
           FROM organizer_events AS event
           WHERE event.id = application.target_organizer_event_id
             AND event.organization_id = application.organization_id
         )
       )
     )
     OR (
       application.application_state = 'imported'
       AND (
         application.target_organizer_event_id IS NULL
         OR application.result_code IS NULL
         OR application.apply_actor_profile_id IS NULL
         OR application.applied_at IS NULL
         OR NOT EXISTS (
           SELECT 1
           FROM external_source_links AS source_link
           WHERE source_link.organization_id =
                 application.organization_id
             AND source_link.entity_type = 'organizer_event'
             AND source_link.entity_id =
                 application.target_organizer_event_id
             AND source_link.source_type = 'csv'
             AND source_link.sync_source_id =
                 detail.source_namespace
             AND source_link.external_id = COALESCE(
               json_extract(row.normalized_payload_json, '$.externalId'),
               application.normalized_row_fingerprint
             )
             AND source_link.source_fingerprint =
                 application.normalized_row_fingerprint
             AND source_link.deleted_at IS NULL
         )
       )
     )
  UNION ALL
  SELECT count(*) AS violation_count
  FROM external_source_links AS source_link
  WHERE source_link.source_type = 'csv'
    AND (
      source_link.entity_type <> 'organizer_event'
      OR source_link.sync_source_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM import_row_applications AS application
        INNER JOIN import_rows AS row
          ON row.id = application.import_row_id
         AND row.import_batch_id = application.import_batch_id
         AND row.organization_id = application.organization_id
        INNER JOIN import_batch_details AS detail
          ON detail.import_batch_id = application.import_batch_id
         AND detail.organization_id = application.organization_id
        WHERE application.organization_id = source_link.organization_id
          AND application.target_organizer_event_id = source_link.entity_id
          AND application.application_state = 'imported'
          AND application.approval_action IN ('selected', 'create_separate')
          AND source_link.sync_source_id = detail.source_namespace
          AND source_link.external_id = COALESCE(
            json_extract(row.normalized_payload_json, '$.externalId'),
            application.normalized_row_fingerprint
          )
          AND source_link.source_fingerprint =
              application.normalized_row_fingerprint
          AND source_link.deleted_at IS NULL
      )
    )
) AS count_group`,
  String.raw`
SELECT COALESCE(sum(count_group.violation_count), 0) AS violation_count
FROM (
  SELECT count(*) AS violation_count
  FROM ics_subscription_tokens AS token
  WHERE length(token.token_hash) <> 64
     OR token.token_hash <> lower(token.token_hash)
     OR token.token_hash GLOB '*[^0-9a-f]*'
     OR (
       token.revoked_at IS NULL
       AND NOT EXISTS (
       SELECT 1
       FROM organization_memberships AS membership
       INNER JOIN profiles AS profile
         ON profile.id = membership.profile_id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
       WHERE membership.organization_id = token.organization_id
         AND membership.profile_id = token.profile_id
         AND membership.status = 'active'
         AND membership.deleted_at IS NULL
       )
     )
     OR (
       token.revoked_at IS NULL
       AND (
         SELECT count(*)
         FROM ics_subscription_tokens AS active_token
         WHERE active_token.organization_id = token.organization_id
           AND active_token.profile_id = token.profile_id
           AND active_token.revoked_at IS NULL
       ) > 3
     )
  UNION ALL
  SELECT count(*) AS violation_count
  FROM organizer_rate_limits AS rate_limit
  WHERE rate_limit.action IN (
    'csv_import_preview_15m',
    'csv_import_batch_day',
    'csv_import_apply_hour'
  )
    AND (
      rate_limit.organization_id IS NULL
      OR rate_limit.profile_id IS NULL
      OR length(rate_limit.scope_key) <> 64
      OR rate_limit.scope_key <> lower(rate_limit.scope_key)
      OR rate_limit.scope_key GLOB '*[^0-9a-f]*'
      OR (rate_limit.action = 'csv_import_preview_15m'
          AND rate_limit.request_count > 5)
      OR (rate_limit.action = 'csv_import_batch_day'
          AND rate_limit.request_count > 20)
      OR (rate_limit.action = 'csv_import_apply_hour'
          AND rate_limit.request_count > 120)
      OR (rate_limit.action = 'csv_import_preview_15m'
          AND (
            rate_limit.window_expires_at <>
                rate_limit.window_started_at + 900000
            OR rate_limit.window_started_at % 900000 <> 0
          ))
      OR (rate_limit.action = 'csv_import_batch_day'
          AND (
            rate_limit.window_expires_at <>
                rate_limit.window_started_at + 86400000
            OR rate_limit.window_started_at % 86400000 <> 0
          ))
      OR (rate_limit.action = 'csv_import_apply_hour'
          AND (
            rate_limit.window_expires_at <>
                rate_limit.window_started_at + 3600000
            OR rate_limit.window_started_at % 3600000 <> 0
          ))
      OR NOT EXISTS (
        SELECT 1
        FROM organization_memberships AS membership
        INNER JOIN profiles AS profile
          ON profile.id = membership.profile_id
         AND profile.status = 'active'
         AND profile.deleted_at IS NULL
        WHERE membership.organization_id = rate_limit.organization_id
          AND membership.profile_id = rate_limit.profile_id
          AND membership.role IN ('owner', 'administrator')
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
      )
    )
) AS count_group`,
  String.raw`
SELECT count(*) AS violation_count
FROM event_calendar_component_revisions AS revision
WHERE revision.scope NOT IN ('public', 'private')
   OR length(revision.event_key) NOT BETWEEN 1 AND 255
   OR revision.event_key <> trim(revision.event_key)
   OR length(revision.canonical_fingerprint) <> 64
   OR revision.canonical_fingerprint <>
      lower(revision.canonical_fingerprint)
   OR revision.canonical_fingerprint GLOB '*[^0-9a-f]*'
   OR revision.sequence NOT BETWEEN 0 AND 2147483647
   OR revision.last_modified_at NOT BETWEEN 0 AND 8640000000000000
   OR revision.created_at NOT BETWEEN 0 AND 8640000000000000
   OR revision.updated_at NOT BETWEEN
      revision.created_at AND 8640000000000000
   OR revision.last_modified_at <
      revision.created_at + (revision.sequence * 1000)
   OR revision.last_modified_at < revision.updated_at
   OR revision.last_modified_at >
      revision.updated_at + (revision.sequence * 1000)
   OR revision.created_at > (unixepoch() * 1000) + 1000
   OR revision.updated_at > (unixepoch() * 1000) + 1000
   OR NOT EXISTS (
     SELECT 1
     FROM organizations AS organization
     WHERE organization.id = revision.organization_id
       AND organization.deleted_at IS NULL
   )`,
  String.raw`
SELECT COALESCE(sum(count_group.violation_count), 0) AS violation_count
FROM (
  SELECT count(*) AS violation_count
  FROM form_submission_email_outbox AS outbox
  LEFT JOIN form_submissions AS submission
    ON submission.id = outbox.submission_id
   AND submission.organization_id = outbox.organization_id
  LEFT JOIN form_submission_workflows AS workflow
    ON workflow.submission_id = outbox.submission_id
   AND workflow.organization_id = outbox.organization_id
  WHERE submission.id IS NULL
     OR workflow.submission_id IS NULL
     OR outbox.destination_key <> 'owner_inbox'
     OR outbox.created_at <> submission.created_at
     OR (
       outbox.state <> 'suppressed'
       AND (
         submission.status = 'spam'
         OR submission.deleted_at IS NOT NULL
         OR workflow.canonical_status = 'spam'
         OR workflow.redacted_at IS NOT NULL
       )
     )
     OR (
       outbox.state = 'suppressed'
       AND submission.status <> 'spam'
       AND submission.deleted_at IS NULL
       AND workflow.canonical_status <> 'spam'
       AND workflow.redacted_at IS NULL
     )
  UNION ALL
  SELECT count(*) AS violation_count
  FROM form_submissions AS submission
  INNER JOIN form_submission_workflows AS workflow
    ON workflow.submission_id = submission.id
   AND workflow.organization_id = submission.organization_id
  WHERE submission.created_at >= 1785567600000
    AND submission.status <> 'spam'
    AND submission.deleted_at IS NULL
    AND workflow.canonical_status <> 'spam'
    AND workflow.redacted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM form_submission_email_outbox AS outbox
      WHERE outbox.submission_id = submission.id
        AND outbox.organization_id = submission.organization_id
    )
) AS count_group`,
]);
