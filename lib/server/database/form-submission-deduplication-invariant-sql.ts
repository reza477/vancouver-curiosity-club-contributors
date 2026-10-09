export const FORM_SUBMISSION_DEDUPLICATION_TRIGGER_STATEMENTS = Object.freeze([
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_deduplication_before_insert
BEFORE INSERT ON form_submission_deduplication
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM form_submissions AS submission
    JOIN form_submission_workflows AS workflow
      ON workflow.submission_id = submission.id
     AND workflow.organization_id = submission.organization_id
    JOIN form_submission_write_intents AS intent
      ON intent.id = workflow.write_intent_id
     AND intent.submission_id = submission.id
     AND intent.organization_id = submission.organization_id
    WHERE submission.id = NEW.submission_id
      AND submission.organization_id = NEW.organization_id
      AND submission.created_at = NEW.created_at
      AND workflow.canonical_status = 'new'
      AND submission.status = 'new'
      AND intent.action = 'create'
      AND intent.completed_at IS NULL
      AND intent.completion_audit_log_id IS NULL
  ) THEN RAISE(ABORT, 'form_submission_deduplication_insert_invalid') END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_retry_receipts_before_insert
BEFORE INSERT ON form_submission_retry_receipts
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM form_submission_deduplication AS deduplication
    JOIN form_submission_workflows AS workflow
      ON workflow.submission_id = deduplication.submission_id
     AND workflow.organization_id = deduplication.organization_id
    JOIN form_submission_write_intents AS intent
      ON intent.id = workflow.write_intent_id
     AND intent.submission_id = workflow.submission_id
     AND intent.organization_id = workflow.organization_id
    WHERE workflow.submission_id = NEW.submission_id
      AND workflow.organization_id = NEW.organization_id
      AND intent.completed_at IS NOT NULL
      AND intent.completion_audit_log_id IS NOT NULL
      AND NEW.created_at >= deduplication.created_at
      AND NEW.created_at < deduplication.window_started_at + 900000
      AND NOT EXISTS (
        SELECT 1 FROM form_submission_workflows AS canonical
        WHERE canonical.request_idempotency_hash = NEW.request_idempotency_hash
      )
  ) THEN RAISE(ABORT, 'form_submission_retry_receipt_insert_invalid') END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_retry_receipts_before_update
BEFORE UPDATE ON form_submission_retry_receipts
BEGIN
  SELECT RAISE(ABORT, 'form_submission_retry_receipt_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS form_submission_deduplication_before_update
BEFORE UPDATE ON form_submission_deduplication
BEGIN
  SELECT RAISE(ABORT, 'form_submission_deduplication_immutable');
END;`,
]);

export const FORM_SUBMISSION_DEDUPLICATION_COUNT_SQL = Object.freeze([
  String.raw`SELECT count(*) AS violation_count
FROM form_submission_deduplication AS deduplication
LEFT JOIN form_submissions AS submission
  ON submission.id = deduplication.submission_id
 AND submission.organization_id = deduplication.organization_id
LEFT JOIN form_submission_workflows AS workflow
  ON workflow.submission_id = submission.id
 AND workflow.organization_id = submission.organization_id
LEFT JOIN form_submission_write_intents AS intent
  ON intent.id = workflow.write_intent_id
 AND intent.submission_id = submission.id
 AND intent.organization_id = submission.organization_id
WHERE submission.id IS NULL
   OR workflow.submission_id IS NULL
   OR intent.id IS NULL
   OR intent.completed_at IS NULL
   OR intent.completion_audit_log_id IS NULL
   OR submission.created_at <> deduplication.created_at`,
  String.raw`SELECT count(*) AS violation_count
FROM form_submission_retry_receipts AS receipt
LEFT JOIN form_submission_deduplication AS deduplication
  ON deduplication.submission_id = receipt.submission_id
 AND deduplication.organization_id = receipt.organization_id
WHERE deduplication.submission_id IS NULL
   OR receipt.created_at < deduplication.created_at
   OR receipt.created_at >= deduplication.window_started_at + 900000
   OR EXISTS (
     SELECT 1 FROM form_submission_workflows AS canonical
     WHERE canonical.request_idempotency_hash = receipt.request_idempotency_hash
   )`,
]);
