import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
} from "../auth";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  parsePublicFormPayload,
  PublicFormValidationError,
  publicFormLabel,
  type PublicFormKey,
  type PublicFormPayload,
} from "./public-form-contract";
import {
  listPublicClubs,
  listPublicProgramsForClubs,
} from "../public/catalog";
import { isCompatibilityProgramAlias } from "../public/program-identity";
import {
  PUBLIC_FORM_MINIMUM_COMPLETION_MS,
  derivePublicFormScopeKey,
  publicFormIdempotencyHash,
  type PublicFormInstance,
} from "./public-form-protection";

const DAY_MS = 24 * 60 * 60 * 1_000;
const RETENTION_REVIEW_MS = 365 * DAY_MS;

export type PublicFormSubmissionResult = Readonly<{
  notificationEligible: boolean;
  publicReference: string;
  submissionId: string;
  stored: true;
}>;

export type PublicFormClubProgramChoice = Readonly<{
  label: string;
  value: string;
}>;

export async function listPublicFormClubProgramChoices(
  database: D1DatabaseLike,
): Promise<readonly PublicFormClubProgramChoice[]> {
  const clubs = await listPublicClubs(database);
  const selectedClubs = clubs.slice(0, 12);
  const programs = await listPublicProgramsForClubs(
    database,
    selectedClubs.map((club) => club.slug),
  );
  const programsByClub = new Map<string, typeof programs>();
  for (const club of selectedClubs) {
    programsByClub.set(
      club.slug,
      programs.filter((program) => program.parentClub.slug === club.slug),
    );
  }
  const choices: PublicFormClubProgramChoice[] = [];
  for (const club of selectedClubs) {
    choices.push({ label: club.name, value: `club:${club.slug}` });
    for (const program of (programsByClub.get(club.slug) ?? []).slice(0, 24)) {
      if (isCompatibilityProgramAlias(program)) continue;
      choices.push({
        label: `${program.name} — ${club.name}`,
        value: `program:${club.slug}/${program.slug}`,
      });
    }
  }
  return Object.freeze(choices);
}

export async function submitPublicForm(
  database: D1DatabaseLike,
  input: Readonly<{
    anonymousClientId: string;
    formInstance: PublicFormInstance;
    formKey: PublicFormKey;
    honeypot: unknown;
    keyHex: string;
    networkFacts: string;
    nowUtcMs: number;
    organizationId: string;
    payload: unknown;
  }>,
): Promise<PublicFormSubmissionResult> {
  const idempotencyHash = await publicFormIdempotencyHash(input.keyHex, {
    clientId: input.anonymousClientId,
    formKey: input.formKey,
    nonce: input.formInstance.nonce,
    organizationId: input.organizationId,
  });
  const existing = await findIdempotentSubmission(
    database,
    input.organizationId,
    idempotencyHash,
  );
  if (existing) return existing;

  const spam =
    hasHoneypotValue(input.honeypot) ||
    input.nowUtcMs - input.formInstance.issuedAt <
      PUBLIC_FORM_MINIMUM_COMPLETION_MS;
  let payload: PublicFormPayload = Object.freeze({
    redacted: true,
    reason: "anti_abuse",
  });
  let validationFailure:
    | PublicFormValidationError
    | SafeApplicationError
    | null = null;
  if (!spam) {
    try {
      payload = parsePublicFormPayload(input.formKey, input.payload);
      if (input.formKey === "host_event") {
        await assertCurrentPublicClubProgramChoice(database, payload);
      }
    } catch (error) {
      if (
        error instanceof PublicFormValidationError ||
        (
          error instanceof SafeApplicationError &&
          error.code === "validation_failed"
        )
      ) {
        validationFailure = error;
      } else {
        throw error;
      }
    }
  }
  const rateStatements = await publicFormRateStatements(database, input);
  if (validationFailure) {
    try {
      await database.batch([...rateStatements]);
    } catch (error) {
      if (isRateLimitError(error)) {
        throw publicFormRateLimited();
      }
      throw publicFormUnavailable();
    }
    throw validationFailure;
  }
  const submissionId = crypto.randomUUID();
  const writeIntentId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const publicReference = createPublicReference();
  const retentionReviewAt = input.nowUtcMs + RETENTION_REVIEW_MS;
  const notificationIdPrefix = `${submissionId}:form:`;
  const payloadJson = JSON.stringify(payload);
  const statements: D1PreparedStatementLike[] = [
    ...rateStatements,
    database
      .prepare(
        `INSERT INTO form_submission_write_intents (
           id, organization_id, submission_id, action,
           expected_workflow_version, proposed_workflow_version,
           proposed_canonical_status, proposed_assigned_to_profile_id,
           proposed_payload_json, proposed_public_reference,
           proposed_request_idempotency_hash,
           proposed_retention_review_at, actor_profile_id,
           created_at, completed_at, completion_audit_log_id
         )
         VALUES (
           ?, ?, ?, 'create', 0, 1, ?, NULL, ?, ?, ?, ?, NULL,
           ?, NULL, NULL
         )`,
      )
      .bind(
        writeIntentId,
        input.organizationId,
        submissionId,
        spam ? "spam" : "new",
        payloadJson,
        publicReference,
        idempotencyHash,
        retentionReviewAt,
        input.nowUtcMs,
      ),
    database
      .prepare(
        `INSERT INTO form_submissions (
           id, organization_id, form_key, payload_json, status,
           submitted_by_profile_id, assigned_to_profile_id,
           created_at, updated_at, deleted_at
         )
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)`,
      )
      .bind(
        submissionId,
        input.organizationId,
        input.formKey,
        payloadJson,
        spam ? "spam" : "new",
        input.nowUtcMs,
        input.nowUtcMs,
      ),
    database
      .prepare(
        `INSERT INTO form_submission_workflows (
           submission_id, organization_id, public_reference,
           canonical_status, request_idempotency_hash,
           retention_review_at, version, write_intent_id,
           updated_by_profile_id,
           created_at, updated_at, redacted_at,
           redacted_by_profile_id
         )
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?, NULL, NULL)`,
      )
      .bind(
        submissionId,
        input.organizationId,
        publicReference,
        spam ? "spam" : "new",
        idempotencyHash,
        retentionReviewAt,
        writeIntentId,
        input.nowUtcMs,
        input.nowUtcMs,
      ),
    ...(spam
      ? []
      : [
          publicSubmissionEmailOutboxStatement(database, {
            nowUtcMs: input.nowUtcMs,
            organizationId: input.organizationId,
            submissionId,
          }),
          publicSubmissionNotificationStatement(database, {
            formKey: input.formKey,
            idPrefix: notificationIdPrefix,
            nowUtcMs: input.nowUtcMs,
            organizationId: input.organizationId,
            publicReference,
            submissionId,
          }),
        ]),
    publicSubmissionCompletionStatement(database, {
      auditId,
      formKey: input.formKey,
      idPrefix: notificationIdPrefix,
      nowUtcMs: input.nowUtcMs,
      organizationId: input.organizationId,
      publicReference,
      spam,
      submissionId,
    }),
    database
      .prepare(
        `UPDATE form_submission_write_intents
         SET completed_at = ?,
             completion_audit_log_id = ?
         WHERE id = ?
           AND organization_id = ?
           AND submission_id = ?
           AND action = 'create'
           AND completed_at IS NULL
           AND completion_audit_log_id IS NULL
           AND EXISTS (
             SELECT 1
             FROM audit_logs AS audit
             WHERE audit.id = ?
               AND audit.organization_id =
                   form_submission_write_intents.organization_id
               AND audit.entity_type = 'form_submission'
               AND audit.entity_id =
                   form_submission_write_intents.submission_id
               AND audit.action = 'form_submission.created'
           )`,
      )
      .bind(
        input.nowUtcMs,
        auditId,
        writeIntentId,
        input.organizationId,
        submissionId,
        auditId,
      ),
  ];

  try {
    await database.batch(statements);
  } catch (error) {
    if (isExactWorkflowIdempotencyConflict(error)) {
      const raced = await findIdempotentSubmission(
        database,
        input.organizationId,
        idempotencyHash,
      );
      if (raced) return raced;
    }
    if (isRateLimitError(error)) {
      throw publicFormRateLimited();
    }
    throw publicFormUnavailable();
  }
  return Object.freeze({
    notificationEligible: !spam,
    publicReference,
    submissionId,
    stored: true,
  });
}

async function assertCurrentPublicClubProgramChoice(
  database: D1DatabaseLike,
  payload: PublicFormPayload,
): Promise<void> {
  const selected = payload.preferredClubOrProgram;
  if (selected === null || selected === "") return;
  if (typeof selected !== "string") throw invalidChoice();
  const match = /^(club|program):([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/u.exec(
    selected,
  );
  if (!match) throw invalidChoice();
  const [, kind, clubSlug, programSlug] = match;
  const clubs = await listPublicClubs(database);
  if (!clubs.some((club) => club.slug === clubSlug)) throw invalidChoice();
  if (kind === "club" && programSlug === undefined) return;
  if (kind !== "program" || !programSlug) throw invalidChoice();
  const programs = await listPublicProgramsForClubs(database, [clubSlug]);
  if (!programs.some((program) => program.slug === programSlug)) {
    throw invalidChoice();
  }
}

function invalidChoice(): SafeApplicationError {
  return new SafeApplicationError(
    "validation_failed",
    422,
    "The preferred club or program is no longer available.",
  );
}

async function publicFormRateStatements(
  database: D1DatabaseLike,
  input: Readonly<{
    anonymousClientId: string;
    formKey: PublicFormKey;
    keyHex: string;
    networkFacts: string;
    nowUtcMs: number;
    organizationId: string;
  }>,
): Promise<readonly D1PreparedStatementLike[]> {
  const boundedNetworkFacts = input.networkFacts.slice(0, 768);
  const scope = await derivePublicFormScopeKey(
    input.keyHex,
    `scope\u0000${input.anonymousClientId}\u0000${boundedNetworkFacts}`,
  );
  const organizationScope = await derivePublicFormScopeKey(
    input.keyHex,
    `organization\u0000${input.organizationId}`,
  );
  const fifteenMinutes = 15 * 60 * 1_000;
  const oneHour = 60 * 60 * 1_000;
  const dayStart = Math.floor(input.nowUtcMs / DAY_MS) * DAY_MS;
  return Object.freeze([
    rateWindowUpsert(
      database,
      input.organizationId,
      "public_form_scope_15m",
      scope,
      Math.floor(input.nowUtcMs / fifteenMinutes) * fifteenMinutes,
      fifteenMinutes,
      input.nowUtcMs,
    ),
    rateWindowUpsert(
      database,
      input.organizationId,
      "public_form_scope_day",
      scope,
      dayStart,
      DAY_MS,
      input.nowUtcMs,
    ),
    rateWindowUpsert(
      database,
      input.organizationId,
      "public_form_organization_hour",
      organizationScope,
      Math.floor(input.nowUtcMs / oneHour) * oneHour,
      oneHour,
      input.nowUtcMs,
    ),
  ]);
}

function rateWindowUpsert(
  database: D1DatabaseLike,
  organizationId: string,
  action: string,
  scopeKey: string,
  windowStartedAt: number,
  durationMs: number,
  nowUtcMs: number,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO public_form_rate_windows (
         id, organization_id, action, scope_key,
         window_started_at, window_ends_at, request_count,
         created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(
         organization_id, action, scope_key, window_started_at
       ) DO UPDATE SET
         request_count = public_form_rate_windows.request_count + 1,
         updated_at = excluded.updated_at
       WHERE public_form_rate_windows.window_ends_at =
             excluded.window_ends_at`,
    )
    .bind(
      crypto.randomUUID(),
      organizationId,
      action,
      scopeKey,
      windowStartedAt,
      windowStartedAt + durationMs,
      nowUtcMs,
      nowUtcMs,
    );
}

function publicSubmissionNotificationStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    formKey: PublicFormKey;
    idPrefix: string;
    nowUtcMs: number;
    organizationId: string;
    publicReference: string;
    submissionId: string;
  }>,
): D1PreparedStatementLike {
  const payload = JSON.stringify({
    formKey: publicFormLabel(input.formKey),
    publicReference: input.publicReference,
    status: "new",
    submissionId: input.submissionId,
  });
  return database
    .prepare(
      `INSERT INTO notifications (
         id, organization_id, recipient_profile_id, type,
         payload_json, read_at, created_at, deleted_at
       )
       SELECT ? || membership.profile_id,
              membership.organization_id,
              membership.profile_id,
              'form_submission_received',
              ?,
              NULL,
              ?,
              NULL
       FROM organization_memberships AS membership
       JOIN profiles AS profile
         ON profile.id = membership.profile_id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
       LEFT JOIN organizer_profile_preferences AS preference
         ON preference.profile_id = membership.profile_id
        AND preference.organization_id = membership.organization_id
       WHERE membership.organization_id = ?
         AND membership.role IN ('owner', 'administrator')
         AND membership.status = 'active'
         AND membership.deleted_at IS NULL
         AND COALESCE(
               preference.notification_preference_mode,
               'all_relevant'
             ) IN ('all_relevant', 'important_only')
       ORDER BY membership.profile_id`,
    )
    .bind(
      input.idPrefix,
      payload,
      input.nowUtcMs,
      input.organizationId,
    );
}

function publicSubmissionEmailOutboxStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    nowUtcMs: number;
    organizationId: string;
    submissionId: string;
  }>,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO form_submission_email_outbox (
         submission_id, organization_id, destination_key, state,
         attempt_count, next_attempt_at, lease_token_hash,
         lease_expires_at, provider_message_id, last_error_code,
         created_at, updated_at, sent_at, suppressed_at
       )
       SELECT submission.id, submission.organization_id,
              'owner_inbox', 'pending', 0, ?, NULL, NULL, NULL, NULL,
              ?, ?, NULL, NULL
       FROM form_submissions AS submission
       WHERE submission.id = ?
         AND submission.organization_id = ?
         AND submission.status <> 'spam'
         AND submission.deleted_at IS NULL`,
    )
    .bind(
      input.nowUtcMs,
      input.nowUtcMs,
      input.nowUtcMs,
      input.submissionId,
      input.organizationId,
    );
}

function publicSubmissionCompletionStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    auditId: string;
    formKey: PublicFormKey;
    idPrefix: string;
    nowUtcMs: number;
    organizationId: string;
    publicReference: string;
    spam: boolean;
    submissionId: string;
  }>,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action,
         entity_type, entity_id, metadata_json, created_at
       )
       SELECT ?, ?, NULL,
              CASE
                WHEN submission.organization_id = ?
                 AND submission.form_key = ?
                 AND workflow.organization_id = submission.organization_id
                 AND workflow.public_reference = ?
                 AND workflow.canonical_status = ?
                 AND (
                   ? = 1
                   OR EXISTS (
                     SELECT 1
                     FROM form_submission_email_outbox AS email_outbox
                     WHERE email_outbox.submission_id = submission.id
                       AND email_outbox.organization_id =
                           submission.organization_id
                       AND email_outbox.destination_key = 'owner_inbox'
                       AND email_outbox.state = 'pending'
                       AND email_outbox.attempt_count = 0
                   )
                 )
                 AND (
                   ? = 1
                   OR NOT EXISTS (
                     SELECT 1
                     FROM organization_memberships AS recipient
                     JOIN profiles AS recipient_profile
                       ON recipient_profile.id = recipient.profile_id
                      AND recipient_profile.status = 'active'
                      AND recipient_profile.deleted_at IS NULL
                     WHERE recipient.organization_id =
                           submission.organization_id
                       AND recipient.role IN ('owner', 'administrator')
                       AND recipient.status = 'active'
                       AND recipient.deleted_at IS NULL
                       AND COALESCE(
                             (
                               SELECT preference.notification_preference_mode
                               FROM organizer_profile_preferences AS preference
                               WHERE preference.profile_id =
                                     recipient.profile_id
                                 AND preference.organization_id =
                                     recipient.organization_id
                             ),
                             'all_relevant'
                           ) IN ('all_relevant', 'important_only')
                       AND NOT EXISTS (
                         SELECT 1
                         FROM notifications AS notice
                         WHERE notice.id = ? || recipient.profile_id
                           AND notice.organization_id =
                               submission.organization_id
                           AND notice.recipient_profile_id =
                               recipient.profile_id
                           AND notice.type =
                               'form_submission_received'
                       )
                   )
                 )
                THEN ?
                ELSE NULL
              END,
              'form_submission',
              submission.id,
              ?,
              ?
       FROM form_submissions AS submission
       JOIN form_submission_workflows AS workflow
         ON workflow.submission_id = submission.id
       WHERE submission.id = ?
         AND submission.organization_id = ?`,
    )
    .bind(
      input.auditId,
      input.organizationId,
      input.organizationId,
      input.formKey,
      input.publicReference,
      input.spam ? "spam" : "new",
      input.spam ? 1 : 0,
      input.spam ? 1 : 0,
      input.idPrefix,
      "form_submission.created",
      JSON.stringify({
        formKey: input.formKey,
        publicReference: input.publicReference,
        status: input.spam ? "spam" : "new",
      }),
      input.nowUtcMs,
      input.submissionId,
      input.organizationId,
    );
}

async function findIdempotentSubmission(
  database: D1DatabaseLike,
  organizationId: string,
  idempotencyHash: string,
): Promise<PublicFormSubmissionResult | null> {
  const reference = await database
    .prepare(
      `SELECT workflow.public_reference,
              workflow.submission_id,
              workflow.canonical_status
       FROM form_submission_workflows AS workflow
       JOIN form_submissions AS submission
         ON submission.id = workflow.submission_id
        AND submission.organization_id = workflow.organization_id
       JOIN form_submission_write_intents AS intent
         ON intent.id = workflow.write_intent_id
        AND intent.organization_id = workflow.organization_id
        AND intent.submission_id = workflow.submission_id
        AND intent.completed_at IS NOT NULL
        AND intent.completion_audit_log_id IS NOT NULL
       WHERE workflow.organization_id = ?
         AND workflow.request_idempotency_hash = ?
       LIMIT 1`,
    )
    .bind(organizationId, idempotencyHash)
    .first<Record<string, unknown>>();
  if (!reference) return null;
  const publicReference = reference.public_reference;
  const submissionId = reference.submission_id;
  const canonicalStatus = reference.canonical_status;
  return typeof publicReference === "string" &&
    typeof submissionId === "string" &&
    typeof canonicalStatus === "string"
    ? Object.freeze({
        notificationEligible: canonicalStatus !== "spam",
        publicReference,
        submissionId,
        stored: true,
      })
    : null;
}

function hasHoneypotValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

function createPublicReference(): string {
  return `VCC-${crypto.randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
}

function isExactWorkflowIdempotencyConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("UNIQUE constraint failed") &&
    (
      message.includes(
        "form_submission_workflows.request_idempotency_hash",
      ) ||
      message.includes(
        "form_submission_workflows_request_idempotency_hash_unique",
      )
    )
  );
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("phase7_public_form_rate_limit_exceeded") ||
    (
      message.includes("CHECK constraint failed") &&
      message.includes("public_form_rate_windows_count_check")
    )
  );
}

function publicFormRateLimited(): SafeApplicationError {
  return new SafeApplicationError(
    "rate_limited",
    429,
    "Too many attempts were received. Please wait and try again.",
  );
}

function publicFormUnavailable(): SafeApplicationError {
  return new SafeApplicationError(
    "service_unavailable",
    503,
    "The submission could not be stored. Please try again.",
  );
}
