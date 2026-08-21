import type { D1DatabaseLike, D1ResultLike } from "../auth";
import { tryNormalizeEmail } from "../../validation";
import { writeSafeLog } from "../../validation/server-observability";
import {
  parsePublicFormKey,
  parsePublicFormPayload,
  publicFormLabel,
  type PublicFormKey,
  type PublicFormPayload,
} from "./public-form-contract";

const PROVIDER_URL = "https://api.resend.com/emails";
const DELIVERY_TIMEOUT_MS = 5_000;
const LEASE_DURATION_MS = 2 * 60_000;
const MAX_BACKOFF_ATTEMPTS = 12;
const MAX_DRAIN_ITEMS = 6;

export type PublicFormEmailConfiguration = Readonly<{
  apiKey: string;
  fromEmail: string;
  toEmail: string;
}>;

export type PublicFormEmailDeliveryOutcome =
  | "already_sent"
  | "blocked"
  | "configuration_missing"
  | "not_due"
  | "provider_retry"
  | "sent"
  | "suppressed";

export type PublicFormEmailDrainResult = Readonly<{
  attempted: number;
  blocked: number;
  configurationMissing: number;
  hasMoreDue: boolean;
  retried: number;
  sent: number;
  suppressed: number;
}>;

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type ClaimedSubmission = Readonly<{
  attemptCount: number;
  createdAt: number;
  formKey: PublicFormKey;
  payload: PublicFormPayload;
  publicReference: string;
  submissionId: string;
}>;

type ClaimSubmissionResult = ClaimedSubmission | "blocked" | null;

type DeliveryErrorCode =
  | "configuration_missing"
  | "provider_concurrent_request"
  | "provider_invalid_response"
  | "provider_rate_limited"
  | "provider_rejected"
  | "provider_timeout"
  | "provider_unavailable";

export async function deliverPublicFormEmail(
  database: D1DatabaseLike,
  submissionId: string,
  options: Readonly<{
    configuration?: PublicFormEmailConfiguration | null;
    fetcher?: Fetcher;
    nowUtcMs?: number;
  }> = {},
): Promise<PublicFormEmailDeliveryOutcome> {
  const nowUtcMs = validNow(options.nowUtcMs ?? Date.now());
  const configuration = options.configuration ?? null;
  const fetcher = options.fetcher ?? fetch;

  const existingState = await database
    .prepare(
      `SELECT state
       FROM form_submission_email_outbox
       WHERE submission_id = ?
       LIMIT 1`,
    )
    .bind(submissionId)
    .first<string>("state");
  if (existingState === "sent") return "already_sent";
  if (existingState === "suppressed") return "suppressed";
  if (existingState === "blocked") return "blocked";
  if (existingState === null) return "not_due";

  await recoverExpiredLease(database, submissionId, nowUtcMs);
  const suppressed = await suppressUndeliverableSubmission(
    database,
    submissionId,
    nowUtcMs,
  );
  if (suppressed) return "suppressed";

  if (!configuration) {
    await noteMissingConfiguration(database, submissionId, nowUtcMs);
    writeSafeLog("warn", "public_form_email_configuration_missing", {
      code: "configuration_missing",
      operation: "deliver_public_form_email",
      requestId: submissionId,
    });
    return "configuration_missing";
  }

  const leaseTokenHash = await createLeaseTokenHash();
  const claimed = await claimSubmission(
    database,
    submissionId,
    leaseTokenHash,
    nowUtcMs,
  );
  if (claimed === "blocked") return "blocked";
  if (!claimed) return "not_due";

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetchWithTimeout(fetcher, configuration, claimed);
  } catch (error) {
    const code: DeliveryErrorCode =
      error instanceof DOMException && error.name === "AbortError"
        ? "provider_timeout"
        : "provider_unavailable";
    await releaseForRetry(
      database,
      claimed,
      leaseTokenHash,
      code,
      nowUtcMs,
    );
    writeSafeLog("warn", "public_form_email_delivery_deferred", {
      code,
      durationMs: Date.now() - startedAt,
      operation: "deliver_public_form_email",
      requestId: submissionId,
    });
    return "provider_retry";
  }

  if (!response.ok) {
    const code = providerErrorCode(response.status);
    await releaseForRetry(
      database,
      claimed,
      leaseTokenHash,
      code,
      nowUtcMs,
    );
    writeSafeLog("warn", "public_form_email_delivery_failed", {
      code,
      durationMs: Date.now() - startedAt,
      operation: "deliver_public_form_email",
      requestId: submissionId,
      status: response.status,
    });
    return "provider_retry";
  }

  const providerMessageId = await readProviderMessageId(response);
  if (!providerMessageId) {
    await releaseForRetry(
      database,
      claimed,
      leaseTokenHash,
      "provider_invalid_response",
      nowUtcMs,
    );
    writeSafeLog("warn", "public_form_email_delivery_deferred", {
      code: "provider_invalid_response",
      durationMs: Date.now() - startedAt,
      operation: "deliver_public_form_email",
      requestId: submissionId,
      status: response.status,
    });
    return "provider_retry";
  }

  const completed = await database
    .prepare(
      `UPDATE form_submission_email_outbox
       SET state = 'sent',
           lease_token_hash = NULL,
           lease_expires_at = NULL,
           provider_message_id = ?,
           last_error_code = NULL,
           updated_at = ?,
           sent_at = ?
       WHERE submission_id = ?
         AND state = 'leased'
         AND lease_token_hash = ?`,
    )
    .bind(
      providerMessageId,
      nowUtcMs,
      nowUtcMs,
      submissionId,
      leaseTokenHash,
    )
    .run();
  if (changes(completed) !== 1) {
    writeSafeLog("error", "public_form_email_delivery_receipt_failed", {
      code: "lease_lost",
      durationMs: Date.now() - startedAt,
      operation: "deliver_public_form_email",
      requestId: submissionId,
    });
    return "provider_retry";
  }

  writeSafeLog("info", "public_form_email_delivered", {
    durationMs: Date.now() - startedAt,
    operation: "deliver_public_form_email",
    requestId: submissionId,
    status: response.status,
  });
  return "sent";
}

export async function drainPublicFormEmailOutbox(
  database: D1DatabaseLike,
  options: Readonly<{
    configuration?: PublicFormEmailConfiguration | null;
    fetcher?: Fetcher;
    limit?: number;
    nowUtcMs?: number;
  }> = {},
): Promise<PublicFormEmailDrainResult> {
  const nowUtcMs = validNow(options.nowUtcMs ?? Date.now());
  const limit = Math.max(
    1,
    Math.min(MAX_DRAIN_ITEMS, Math.trunc(options.limit ?? MAX_DRAIN_ITEMS)),
  );
  const rows = await database
    .prepare(
      `SELECT submission_id
       FROM form_submission_email_outbox
       WHERE (
           state = 'pending'
           AND next_attempt_at <= ?
         ) OR (
           state = 'leased'
           AND lease_expires_at <= ?
         )
       ORDER BY next_attempt_at ASC, created_at ASC, submission_id ASC
       LIMIT ?`,
    )
    .bind(nowUtcMs, nowUtcMs, limit + 1)
    .all<Record<string, unknown>>();
  const dueRows = rows.results ?? [];
  const hasMoreDue = dueRows.length > limit;

  const counts = {
    attempted: 0,
    blocked: 0,
    configurationMissing: 0,
    retried: 0,
    sent: 0,
    suppressed: 0,
  };
  for (const row of dueRows.slice(0, limit)) {
    const submissionId = readString(row.submission_id);
    if (!submissionId) continue;
    const outcome = await deliverPublicFormEmail(database, submissionId, {
      configuration: options.configuration ?? null,
      fetcher: options.fetcher,
      nowUtcMs,
    });
    counts.attempted += 1;
    if (outcome === "sent") counts.sent += 1;
    else if (outcome === "blocked") counts.blocked += 1;
    else if (outcome === "provider_retry") counts.retried += 1;
    else if (outcome === "configuration_missing") {
      counts.configurationMissing += 1;
    } else if (outcome === "suppressed") counts.suppressed += 1;
  }
  return Object.freeze({ ...counts, hasMoreDue });
}

async function claimSubmission(
  database: D1DatabaseLike,
  submissionId: string,
  leaseTokenHash: string,
  nowUtcMs: number,
): Promise<ClaimSubmissionResult> {
  const claimed = await database
    .prepare(
      `UPDATE form_submission_email_outbox
       SET state = 'leased',
           attempt_count = min(attempt_count + 1, ?),
           lease_token_hash = ?,
           lease_expires_at = ?,
           last_error_code = NULL,
           updated_at = ?
       WHERE submission_id = ?
         AND state = 'pending'
         AND next_attempt_at <= ?
         AND EXISTS (
           SELECT 1
           FROM form_submissions AS submission
           JOIN form_submission_workflows AS workflow
             ON workflow.submission_id = submission.id
            AND workflow.organization_id = submission.organization_id
           WHERE submission.id = form_submission_email_outbox.submission_id
             AND submission.organization_id =
                 form_submission_email_outbox.organization_id
             AND submission.status <> 'spam'
             AND submission.deleted_at IS NULL
             AND workflow.redacted_at IS NULL
         )`,
    )
    .bind(
      MAX_BACKOFF_ATTEMPTS,
      leaseTokenHash,
      nowUtcMs + LEASE_DURATION_MS,
      nowUtcMs,
      submissionId,
      nowUtcMs,
    )
    .run();
  if (changes(claimed) !== 1) return null;

  const row = await database
    .prepare(
      `SELECT submission.id AS submission_id,
              submission.form_key,
              submission.payload_json,
              submission.created_at,
              workflow.public_reference,
              outbox.attempt_count
       FROM form_submission_email_outbox AS outbox
       JOIN form_submissions AS submission
         ON submission.id = outbox.submission_id
        AND submission.organization_id = outbox.organization_id
       JOIN form_submission_workflows AS workflow
         ON workflow.submission_id = submission.id
        AND workflow.organization_id = submission.organization_id
       WHERE outbox.submission_id = ?
         AND outbox.state = 'leased'
         AND outbox.lease_token_hash = ?
         AND submission.status <> 'spam'
         AND submission.deleted_at IS NULL
         AND workflow.redacted_at IS NULL
       LIMIT 1`,
    )
    .bind(submissionId, leaseTokenHash)
    .first<Record<string, unknown>>();
  if (!row) return null;
  try {
    const formKey = parsePublicFormKey(row.form_key);
    const payloadJson = readString(row.payload_json);
    const publicReference = readString(row.public_reference);
    const createdAt = readInteger(row.created_at);
    const attemptCount = readInteger(row.attempt_count);
    if (!payloadJson || !publicReference || createdAt === null || attemptCount === null) {
      throw new TypeError("Invalid canonical submission email row.");
    }
    return Object.freeze({
      attemptCount,
      createdAt,
      formKey,
      payload: parsePublicFormPayload(formKey, JSON.parse(payloadJson)),
      publicReference,
      submissionId,
    });
  } catch {
    await blockDelivery(
      database,
      submissionId,
      leaseTokenHash,
      "provider_invalid_response",
      nowUtcMs,
    );
    return "blocked";
  }
}

async function recoverExpiredLease(
  database: D1DatabaseLike,
  submissionId: string,
  nowUtcMs: number,
): Promise<void> {
  await database
    .prepare(
      `UPDATE form_submission_email_outbox
       SET state = 'pending',
           lease_token_hash = NULL,
           lease_expires_at = NULL,
           last_error_code = 'provider_timeout',
           next_attempt_at = ?,
           updated_at = ?
       WHERE submission_id = ?
         AND state = 'leased'
         AND lease_expires_at <= ?`,
    )
    .bind(nowUtcMs, nowUtcMs, submissionId, nowUtcMs)
    .run();
}

async function suppressUndeliverableSubmission(
  database: D1DatabaseLike,
  submissionId: string,
  nowUtcMs: number,
): Promise<boolean> {
  const result = await database
    .prepare(
      `UPDATE form_submission_email_outbox
       SET state = 'suppressed',
           lease_token_hash = NULL,
           lease_expires_at = NULL,
           provider_message_id = NULL,
           last_error_code = 'submission_redacted',
           updated_at = ?,
           suppressed_at = ?
       WHERE submission_id = ?
         AND state IN ('pending', 'leased', 'blocked')
         AND EXISTS (
           SELECT 1
           FROM form_submissions AS submission
           JOIN form_submission_workflows AS workflow
             ON workflow.submission_id = submission.id
            AND workflow.organization_id = submission.organization_id
           WHERE submission.id = form_submission_email_outbox.submission_id
             AND submission.organization_id =
                 form_submission_email_outbox.organization_id
             AND (
               submission.status = 'spam'
               OR submission.deleted_at IS NOT NULL
               OR workflow.redacted_at IS NOT NULL
             )
         )`,
    )
    .bind(nowUtcMs, nowUtcMs, submissionId)
    .run();
  return changes(result) === 1;
}

async function noteMissingConfiguration(
  database: D1DatabaseLike,
  submissionId: string,
  nowUtcMs: number,
): Promise<void> {
  await database
    .prepare(
      `UPDATE form_submission_email_outbox
       SET last_error_code = 'configuration_missing',
           next_attempt_at = ?,
           updated_at = ?
       WHERE submission_id = ?
         AND state = 'pending'`,
    )
    .bind(nowUtcMs + 60 * 60_000, nowUtcMs, submissionId)
    .run();
}

async function releaseForRetry(
  database: D1DatabaseLike,
  claimed: ClaimedSubmission,
  leaseTokenHash: string,
  code: DeliveryErrorCode,
  nowUtcMs: number,
): Promise<void> {
  await database
    .prepare(
      `UPDATE form_submission_email_outbox
       SET state = ?,
           lease_token_hash = NULL,
           lease_expires_at = NULL,
           last_error_code = ?,
           next_attempt_at = ?,
           updated_at = ?
       WHERE submission_id = ?
         AND state = 'leased'
         AND lease_token_hash = ?`,
    )
    .bind(
      "pending",
      code,
      nowUtcMs + retryDelayMs(claimed.attemptCount),
      nowUtcMs,
      claimed.submissionId,
      leaseTokenHash,
    )
    .run();
}

async function blockDelivery(
  database: D1DatabaseLike,
  submissionId: string,
  leaseTokenHash: string,
  code: DeliveryErrorCode,
  nowUtcMs: number,
): Promise<void> {
  await database
    .prepare(
      `UPDATE form_submission_email_outbox
       SET state = 'blocked',
           lease_token_hash = NULL,
           lease_expires_at = NULL,
           last_error_code = ?,
           updated_at = ?
       WHERE submission_id = ?
         AND state = 'leased'
         AND lease_token_hash = ?`,
    )
    .bind(code, nowUtcMs, submissionId, leaseTokenHash)
    .run();
}

async function fetchWithTimeout(
  fetcher: Fetcher,
  configuration: PublicFormEmailConfiguration,
  submission: ClaimedSubmission,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    return await fetcher(PROVIDER_URL, {
      body: JSON.stringify({
        from: `Vancouver Curiosity Club Website <${configuration.fromEmail}>`,
        reply_to: readReplyEmail(submission.payload),
        subject: `${publicFormLabel(submission.formKey)} — ${submission.publicReference}`,
        text: renderPlainTextEmail(submission),
        to: [configuration.toEmail],
      }),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${configuration.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `vcc-form/${submission.submissionId}`,
      },
      method: "POST",
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function renderPlainTextEmail(submission: ClaimedSubmission): string {
  const lines = [
    `New ${publicFormLabel(submission.formKey)} website submission`,
    "",
    `Reference: ${submission.publicReference}`,
    `Submitted: ${new Date(submission.createdAt).toISOString()}`,
    ...formPayloadLines(submission.formKey, submission.payload),
  ];
  return `${lines.join("\n")}\n`;
}

function formPayloadLines(
  formKey: PublicFormKey,
  payload: PublicFormPayload,
): readonly string[] {
  const base = [
    "",
    `Name: ${readPayloadText(payload, "name")}`,
    `Reply email: ${readReplyEmail(payload)}`,
  ];
  if (formKey === "contact") {
    return [
      ...base,
      `Topic: ${readPayloadText(payload, "topic")}`,
      "",
      "Message:",
      readPayloadText(payload, "message"),
    ];
  }
  if (formKey === "volunteer") {
    return [
      ...base,
      `Interest areas: ${readPayloadList(payload, "interestAreas").join(", ")}`,
      "",
      "How they would like to help:",
      readPayloadText(payload, "howToHelp"),
      "",
      "Availability or relevant context:",
      readOptionalPayloadText(payload, "availabilityContext"),
    ];
  }
  if (formKey === "host_event") {
    return [
      ...base,
      `Proposed title: ${readPayloadText(payload, "proposedTitle")}`,
      `Preferred club or program: ${readOptionalPayloadText(payload, "preferredClubOrProgram")}`,
      `Format: ${readPayloadText(payload, "format")}`,
      "",
      "Event idea:",
      readPayloadText(payload, "eventIdea"),
      "",
      "Preferred timing:",
      readOptionalPayloadText(payload, "preferredTiming"),
    ];
  }
  return [
    ...base,
    `Organization, venue, or supporter: ${readPayloadText(payload, "organizationOrVenueName")}`,
    `Partnership type: ${readPayloadText(payload, "partnershipType")}`,
    `Website: ${readOptionalPayloadText(payload, "website")}`,
    "",
    "Message:",
    readPayloadText(payload, "message"),
  ];
}

async function readProviderMessageId(response: Response): Promise<string | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > 4_096) return null;
  let body: unknown;
  try {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > 4_096) return null;
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const id = Reflect.get(body, "id");
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,255}$/u.test(id)
    ? id
    : null;
}

function providerErrorCode(status: number): DeliveryErrorCode {
  if (status === 429) return "provider_rate_limited";
  if (status === 409) return "provider_concurrent_request";
  if (status >= 500 || status === 408 || status === 425) {
    return "provider_unavailable";
  }
  return "provider_rejected";
}

function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(8, attemptCount - 1));
  return Math.min(6 * 60 * 60_000, 60_000 * 2 ** exponent);
}

async function createLeaseTokenHash(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function readReplyEmail(payload: PublicFormPayload): string {
  const email = tryNormalizeEmail(payload.replyEmail);
  if (!email) throw new TypeError("Invalid canonical reply email.");
  return email;
}

function readPayloadText(payload: PublicFormPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Invalid canonical form text.");
  }
  return value;
}

function readOptionalPayloadText(
  payload: PublicFormPayload,
  key: string,
): string {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : "Not provided";
}

function readPayloadList(
  payload: PublicFormPayload,
  key: string,
): readonly string[] {
  const value = payload[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError("Invalid canonical form list.");
  }
  return value;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function validNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Invalid delivery timestamp.");
  }
  return value;
}

function changes(result: D1ResultLike | undefined): number {
  return typeof result?.meta?.changes === "number" ? result.meta.changes : 0;
}
