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
import {
  submitPublicForm,
} from "../../lib/server/phase7/public-forms.ts";
import {
  deliverPublicFormEmail,
  drainPublicFormEmailOutbox,
} from "../../lib/server/phase7/public-form-email.ts";
import {
  assignFormSubmission,
  getFormSubmission,
  listFormSubmissions,
  listSubmissionAssignees,
} from "../../lib/server/phase7/submissions.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";
import {
  countD1Statements,
  interceptD1Statements,
} from "../auth/intercept-d1.mjs";

const OWNER_EMAIL = "phase7-inbox-owner@vcc-tests.invalid";
const ORGANIZER_EMAIL =
  "phase7-inbox-organizer@vcc-tests.invalid";
const KEY_HEX = "b".repeat(64);

function migrations() {
  const directory = join(process.cwd(), "drizzle");
  return readdirSync(directory)
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) => readFileSync(join(directory, name), "utf8"))
    .join("\n");
}

async function fixture() {
  const database = new SqliteD1TestDatabase(migrations());
  const now = Date.now();
  const ownerIdentity = trustedIdentityFromSites({
    displayName: "Phase 7 Owner",
    email: OWNER_EMAIL,
  });
  assert.equal(
    await bootstrapInitialOwner(
      database,
      ownerIdentity,
      OWNER_EMAIL,
      now,
    ),
    true,
  );
  const owner = await database
    .prepare(
      `SELECT organization_id, profile_id
       FROM organization_memberships
       WHERE normalized_email = ?
         AND role = 'owner'
         AND status = 'active'
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(OWNER_EMAIL)
    .first();
  assert.equal(typeof owner.organization_id, "string");
  assert.equal(typeof owner.profile_id, "string");
  database.exec(PHASE7_INVARIANT_TRIGGER_STATEMENTS.join("\n"));
  return {
    database,
    now,
    organizationId: owner.organization_id,
    ownerIdentity,
    ownerProfileId: owner.profile_id,
  };
}

function formInput(formKey, nonce, now, payload, overrides = {}) {
  return {
    anonymousClientId: `client-${nonce}`,
    formInstance: {
      formKey,
      issuedAt: now - 4_000,
      nonce,
    },
    formKey,
    honeypot: "",
    keyHex: KEY_HEX,
    networkFacts: `network-${nonce}`,
    nowUtcMs: now,
    payload,
    ...overrides,
  };
}

function invalidRateInput(
  data,
  { clientId, networkFacts, nonce, now },
) {
  return {
    ...formInput(
      "contact",
      nonce,
      now,
      { ...PAYLOADS.contact, name: "x" },
      { organizationId: data.organizationId },
    ),
    anonymousClientId: clientId,
    networkFacts,
  };
}

async function publicFormPrivateResidueCounts(database) {
  return {
    ...(await database
      .prepare(
        `SELECT
           (SELECT count(*) FROM audit_logs
            WHERE action = 'form_submission.created') AS audits,
           (SELECT count(*) FROM form_submission_write_intents) AS intents,
           (SELECT count(*) FROM notifications
            WHERE type = 'form_submission_received') AS notifications,
           (SELECT count(*) FROM form_submission_email_outbox) AS email_outbox,
           (SELECT count(*) FROM form_submissions) AS submissions,
           (SELECT count(*) FROM form_submission_workflows) AS workflows`,
      )
      .first()),
  };
}

async function publicFormScopeRateCount(database, organizationId) {
  return database
    .prepare(
      `SELECT request_count
       FROM public_form_rate_windows
       WHERE organization_id = ?
         AND action = 'public_form_scope_15m'
       LIMIT 1`,
    )
    .bind(organizationId)
    .first("request_count");
}

const PAYLOADS = Object.freeze({
  contact: {
    message: "Please share the accessible entrance information.",
    name: "Contact Visitor",
    replyEmail: "contact@public-visitor.invalid",
    topic: "Accessibility",
  },
  volunteer: {
    availabilityContext: "Some weekday evenings.",
    howToHelp: "I would like to help welcome people at events.",
    interestAreas: ["Welcoming", "Event support"],
    name: "Volunteer Visitor",
    replyEmail: "volunteer@public-visitor.invalid",
  },
  host_event: {
    eventIdea: "A careful discussion about urban curiosity walks.",
    format: "In person",
    name: "Host Visitor",
    preferredClubOrProgram: null,
    preferredTiming: "A weekend afternoon.",
    proposedTitle: "Curiosity walk",
    replyEmail: "host@public-visitor.invalid",
  },
  partnership: {
    message: "We would like to discuss hosting a public gathering.",
    name: "Partner Visitor",
    organizationOrVenueName: "Example Venue",
    partnershipType: "Venue",
    replyEmail: "partner@public-visitor.invalid",
    website: "https://example.invalid/venue",
  },
});

test("all four forms commit once, retry idempotently, and spam stores only a redacted receipt", async (t) => {
  const data = await fixture();
  t.after(() => data.database.close());

  for (const [index, formKey] of [
    "contact",
    "volunteer",
    "host_event",
    "partnership",
  ].entries()) {
    const input = formInput(
      formKey,
      `nonce-${index}`.padEnd(32, "x"),
      data.now + index * 60_000,
      PAYLOADS[formKey],
      { organizationId: data.organizationId },
    );
    const first = await submitPublicForm(data.database, input);
    const retry = await submitPublicForm(data.database, input);
    assert.deepEqual(retry, first);
  }

  const spamInput = formInput(
    "contact",
    "spam-nonce".padEnd(32, "x"),
    data.now + 4 * 60_000,
    {
      message: "private spam message sentinel",
      name: "Private Spam Name",
      replyEmail: "private-spam@visitor.invalid",
      topic: "General",
    },
    {
      honeypot: "filled",
      organizationId: data.organizationId,
    },
  );
  const spam = await submitPublicForm(data.database, spamInput);
  assert.match(spam.publicReference, /^VCC-[A-Z0-9-]+$/u);

  const counts = await data.database
    .prepare(
      `SELECT
         count(*) AS submission_count,
         count(DISTINCT workflow.request_idempotency_hash) AS hash_count,
         (SELECT count(*)
          FROM form_submission_email_outbox AS email_outbox
          WHERE email_outbox.organization_id = ?) AS email_outbox_count,
         sum(CASE WHEN workflow.canonical_status = 'spam' THEN 1 ELSE 0 END)
           AS spam_count
       FROM form_submissions AS submission
       JOIN form_submission_workflows AS workflow
         ON workflow.submission_id = submission.id
        AND workflow.organization_id = submission.organization_id
       JOIN form_submission_write_intents AS intent
         ON intent.id = workflow.write_intent_id
        AND intent.completed_at IS NOT NULL
       WHERE submission.organization_id = ?`,
    )
    .bind(data.organizationId, data.organizationId)
    .first();
  assert.equal(counts.submission_count, 5);
  assert.equal(counts.hash_count, 5);
  assert.equal(counts.email_outbox_count, 4);
  assert.equal(counts.spam_count, 1);

  const spamRow = await data.database
    .prepare(
      `SELECT submission.payload_json,
              (
                SELECT count(*)
                FROM notifications AS notification
                WHERE notification.organization_id =
                      submission.organization_id
                  AND json_extract(
                        notification.payload_json,
                        '$.submissionId'
                      ) = submission.id
              ) AS notification_count
              ,(
                SELECT count(*)
                FROM form_submission_email_outbox AS email_outbox
                WHERE email_outbox.submission_id = submission.id
              ) AS email_outbox_count
       FROM form_submissions AS submission
       JOIN form_submission_workflows AS workflow
         ON workflow.submission_id = submission.id
       WHERE workflow.public_reference = ?`,
    )
    .bind(spam.publicReference)
    .first();
  assert.equal(
    spamRow.payload_json,
    '{"redacted":true,"reason":"anti_abuse"}',
  );
  assert.equal(spamRow.notification_count, 0);
  assert.equal(spamRow.email_outbox_count, 0);
  const spamSubmissionId = await data.database
    .prepare(
      `SELECT submission.id
       FROM form_submissions AS submission
       JOIN form_submission_workflows AS workflow
         ON workflow.submission_id = submission.id
       WHERE workflow.public_reference = ?`,
    )
    .bind(spam.publicReference)
    .first("id");
  await assert.rejects(
    data.database
      .prepare(
        `INSERT INTO form_submission_email_outbox (
           submission_id, organization_id, destination_key, state,
           attempt_count, next_attempt_at, created_at, updated_at
         ) VALUES (?, ?, 'owner_inbox', 'pending', 0, ?, ?, ?)`,
      )
      .bind(
        spamSubmissionId,
        data.organizationId,
        data.now + 4 * 60_000,
        data.now + 4 * 60_000,
        data.now + 4 * 60_000,
      )
      .run(),
    /phase7_form_email_outbox_insert_invalid/iu,
  );
  const serialized = JSON.stringify(
    await data.database
      .prepare(
        `SELECT payload_json
         FROM form_submissions
         WHERE organization_id = ?`,
      )
      .bind(data.organizationId)
      .all(),
  );
  for (const sentinel of [
    "private spam message sentinel",
    "Private Spam Name",
    "private-spam@visitor.invalid",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(sentinel, "u"));
  }
  await assertPhase7Clean(data.database);
});

test("the durable email outbox sends one private organizer copy and records no form PII", async (t) => {
  const data = await fixture();
  t.after(() => data.database.close());
  const stored = await submitPublicForm(
    data.database,
    formInput(
      "contact",
      "email-delivery-once".padEnd(32, "x"),
      data.now,
      PAYLOADS.contact,
      { organizationId: data.organizationId },
    ),
  );
  const requests = [];
  const configuration = {
    apiKey: "synthetic-delivery-api-key",
    fromEmail: "website-sender@example.invalid",
    toEmail: "organizer-inbox@example.invalid",
  };
  const fetcher = async (input, init) => {
    requests.push({ input: String(input), init });
    return Response.json({ id: "provider_message_1" }, { status: 200 });
  };

  assert.equal(
    await deliverPublicFormEmail(data.database, stored.submissionId, {
      configuration,
      fetcher,
      nowUtcMs: data.now + 1_000,
    }),
    "sent",
  );
  assert.equal(
    await deliverPublicFormEmail(data.database, stored.submissionId, {
      configuration,
      fetcher,
      nowUtcMs: data.now + 2_000,
    }),
    "already_sent",
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input, "https://api.resend.com/emails");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(
    requests[0].init.headers["Idempotency-Key"],
    `vcc-form/${stored.submissionId}`,
  );
  const body = JSON.parse(requests[0].init.body);
  assert.deepEqual(body.to, [configuration.toEmail]);
  assert.equal(body.reply_to, PAYLOADS.contact.replyEmail);
  assert.equal(
    body.from,
    `Vancouver Curiosity Club Website <${configuration.fromEmail}>`,
  );
  assert.match(body.subject, new RegExp(stored.publicReference, "u"));
  assert.match(body.text, /Please share the accessible entrance information\./u);

  const receipt = await data.database
    .prepare(
      `SELECT *
       FROM form_submission_email_outbox
       WHERE submission_id = ?`,
    )
    .bind(stored.submissionId)
    .first();
  assert.equal(receipt.state, "sent");
  assert.equal(receipt.attempt_count, 1);
  assert.equal(receipt.provider_message_id, "provider_message_1");
  await assert.rejects(
    data.database
      .prepare(
        `UPDATE form_submission_email_outbox
         SET state = 'pending',
             provider_message_id = NULL,
             sent_at = NULL,
             updated_at = ?
         WHERE submission_id = ?`,
      )
      .bind(data.now + 3_000, stored.submissionId)
      .run(),
    /phase7_form_email_outbox_update_invalid/iu,
  );
  const serializedReceipt = JSON.stringify(receipt);
  for (const sentinel of [
    PAYLOADS.contact.name,
    PAYLOADS.contact.replyEmail,
    PAYLOADS.contact.message,
    configuration.fromEmail,
    configuration.toEmail,
    configuration.apiKey,
  ]) {
    assert.doesNotMatch(serializedReceipt, new RegExp(sentinel, "u"));
  }
});

test("retryable provider failure keeps the D1 submission and maintenance later delivers it", async (t) => {
  const data = await fixture();
  t.after(() => data.database.close());
  const stored = await submitPublicForm(
    data.database,
    formInput(
      "volunteer",
      "email-retry".padEnd(32, "x"),
      data.now,
      PAYLOADS.volunteer,
      { organizationId: data.organizationId },
    ),
  );
  const configuration = {
    apiKey: "synthetic-retry-api-key",
    fromEmail: "website-sender@example.invalid",
    toEmail: "organizer-inbox@example.invalid",
  };
  const idempotencyKeys = [];
  assert.equal(
    await deliverPublicFormEmail(data.database, stored.submissionId, {
      configuration,
      fetcher: async (_input, init) => {
        idempotencyKeys.push(init.headers["Idempotency-Key"]);
        return new Response("temporarily unavailable", { status: 503 });
      },
      nowUtcMs: data.now + 1_000,
    }),
    "provider_retry",
  );
  const pending = await data.database
    .prepare(
      `SELECT state, attempt_count, next_attempt_at, last_error_code
       FROM form_submission_email_outbox
       WHERE submission_id = ?`,
    )
    .bind(stored.submissionId)
    .first();
  assert.equal(pending.state, "pending");
  assert.equal(pending.attempt_count, 1);
  assert.equal(pending.last_error_code, "provider_unavailable");
  assert.ok(pending.next_attempt_at > data.now + 1_000);
  assert.equal(
    await data.database
      .prepare("SELECT count(*) FROM form_submissions WHERE id = ?")
      .bind(stored.submissionId)
      .first("count(*)"),
    1,
  );

  const drained = await drainPublicFormEmailOutbox(data.database, {
    configuration,
    fetcher: async (_input, init) => {
      idempotencyKeys.push(init.headers["Idempotency-Key"]);
      return Response.json({ id: "provider_message_retry" });
    },
    nowUtcMs: pending.next_attempt_at,
  });
  assert.deepEqual(drained, {
    attempted: 1,
    blocked: 0,
    configurationMissing: 0,
    retried: 0,
    sent: 1,
    suppressed: 0,
  });
  assert.deepEqual(idempotencyKeys, [
    `vcc-form/${stored.submissionId}`,
    `vcc-form/${stored.submissionId}`,
  ]);
  assert.equal(
    await data.database
      .prepare(
        `SELECT state
         FROM form_submission_email_outbox
         WHERE submission_id = ?`,
      )
      .bind(stored.submissionId)
      .first("state"),
    "sent",
  );
});

test("missing configuration and concurrent drains never lose or duplicate a queued email", async (t) => {
  const data = await fixture();
  t.after(() => data.database.close());
  const stored = await submitPublicForm(
    data.database,
    formInput(
      "partnership",
      "email-concurrency".padEnd(32, "x"),
      data.now,
      PAYLOADS.partnership,
      { organizationId: data.organizationId },
    ),
  );
  assert.equal(
    await deliverPublicFormEmail(data.database, stored.submissionId, {
      configuration: null,
      nowUtcMs: data.now + 1_000,
    }),
    "configuration_missing",
  );
  const pending = await data.database
    .prepare(
      `SELECT state, attempt_count, next_attempt_at, last_error_code
       FROM form_submission_email_outbox
       WHERE submission_id = ?`,
    )
    .bind(stored.submissionId)
    .first();
  assert.deepEqual(
    {
      attemptCount: pending.attempt_count,
      error: pending.last_error_code,
      state: pending.state,
    },
    {
      attemptCount: 0,
      error: "configuration_missing",
      state: "pending",
    },
  );

  const configuration = {
    apiKey: "synthetic-concurrent-api-key",
    fromEmail: "website-sender@example.invalid",
    toEmail: "organizer-inbox@example.invalid",
  };
  let releaseProvider;
  let signalProvider;
  const providerStarted = new Promise((resolve) => {
    signalProvider = resolve;
  });
  const providerRelease = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  let providerCalls = 0;
  const first = deliverPublicFormEmail(data.database, stored.submissionId, {
    configuration,
    fetcher: async () => {
      providerCalls += 1;
      signalProvider();
      await providerRelease;
      return Response.json({ id: "provider_message_concurrent" });
    },
    nowUtcMs: pending.next_attempt_at,
  });
  await providerStarted;
  const second = await deliverPublicFormEmail(
    data.database,
    stored.submissionId,
    {
      configuration,
      fetcher: async () => {
        providerCalls += 1;
        return Response.json({ id: "duplicate_should_not_send" });
      },
      nowUtcMs: pending.next_attempt_at,
    },
  );
  assert.equal(second, "not_due");
  releaseProvider();
  assert.equal(await first, "sent");
  assert.equal(providerCalls, 1);
});

test("submission list applies a bounded inclusive UTC date filter", async (t) => {
  const data = await fixture();
  t.after(() => data.database.close());
  const firstAt = data.now;
  const secondAt = data.now + 60_000;
  const currentUtcDate = new Date(firstAt).toISOString().slice(0, 10);
  const previousUtcDate = new Date(firstAt - 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
  await submitPublicForm(
    data.database,
    formInput(
      "contact",
      "date-first".padEnd(32, "x"),
      firstAt,
      PAYLOADS.contact,
      { organizationId: data.organizationId },
    ),
  );
  await submitPublicForm(
    data.database,
    formInput(
      "volunteer",
      "date-second".padEnd(32, "x"),
      secondAt,
      PAYLOADS.volunteer,
      { organizationId: data.organizationId },
    ),
  );
  const currentDay = await listFormSubmissions(
    data.database,
    data.ownerIdentity,
    { fromDate: currentUtcDate, toDate: currentUtcDate },
    secondAt,
  );
  assert.equal(currentDay.totalCount, 2);
  const previousDay = await listFormSubmissions(
    data.database,
    data.ownerIdentity,
    { fromDate: previousUtcDate, toDate: previousUtcDate },
    secondAt,
  );
  assert.equal(previousDay.totalCount, 0);
  await assert.rejects(
    listFormSubmissions(
      data.database,
      data.ownerIdentity,
      { fromDate: "2026-12-31", toDate: "2026-01-01" },
    ),
    (error) => error?.code === "validation_failed",
  );
  await assert.rejects(
    listFormSubmissions(
      data.database,
      data.ownerIdentity,
      { fromDate: "2025-01-01", toDate: "2026-01-02" },
    ),
    (error) => error?.code === "validation_failed",
  );
});

test("public form limits are atomic and an impossible-speed post stores only a spam receipt", async (t) => {
  const data = await fixture();
  t.after(() => data.database.close());
  for (let index = 0; index < 5; index += 1) {
    await submitPublicForm(data.database, {
      ...formInput(
        "contact",
        `rate-${index}`.padEnd(32, "x"),
        data.now + index,
        PAYLOADS.contact,
        { organizationId: data.organizationId },
      ),
      anonymousClientId: "same-rate-client",
      networkFacts: "same-rate-network",
    });
  }
  await assert.rejects(
    submitPublicForm(data.database, {
      ...formInput(
        "contact",
        "rate-six".padEnd(32, "x"),
        data.now + 10,
        PAYLOADS.contact,
        { organizationId: data.organizationId },
      ),
      anonymousClientId: "same-rate-client",
      networkFacts: "same-rate-network",
    }),
    (error) => error?.code === "rate_limited" && error?.status === 429,
  );
  assert.equal(
    await data.database
      .prepare(
        `SELECT count(*)
         FROM form_submissions
         WHERE organization_id = ?`,
      )
      .bind(data.organizationId)
      .first("count(*)"),
    5,
  );
  assert.equal(
    await data.database
      .prepare(
        `SELECT request_count
         FROM public_form_rate_windows
         WHERE organization_id = ?
           AND action = 'public_form_scope_15m'
         LIMIT 1`,
      )
      .bind(data.organizationId)
      .first("request_count"),
    5,
  );

  const tooFast = await submitPublicForm(data.database, {
    ...formInput(
      "contact",
      "too-fast".padEnd(32, "x"),
      data.now + 100,
      {
        message: "too-fast private message sentinel",
        name: "Too Fast Visitor",
        replyEmail: "too-fast@visitor.invalid",
        topic: "General",
      },
      { organizationId: data.organizationId },
    ),
    anonymousClientId: "too-fast-client",
    formInstance: {
      formKey: "contact",
      issuedAt: data.now,
      nonce: "too-fast".padEnd(32, "x"),
    },
    networkFacts: "too-fast-network",
  });
  const receipt = await data.database
    .prepare(
      `SELECT submission.payload_json,
              (
                SELECT count(*)
                FROM notifications AS notification
                WHERE json_extract(
                        notification.payload_json,
                        '$.submissionId'
                      ) = submission.id
              ) AS notification_count
       FROM form_submissions AS submission
       JOIN form_submission_workflows AS workflow
         ON workflow.submission_id = submission.id
       WHERE workflow.public_reference = ?`,
    )
    .bind(tooFast.publicReference)
    .first();
  assert.equal(
    receipt.payload_json,
    '{"redacted":true,"reason":"anti_abuse"}',
  );
  assert.equal(receipt.notification_count, 0);
});

test("field-invalid public-form attempts consume the same durable atomic limits", async (t) => {
  await t.test("five invalid attempts are admitted, the sixth is limited, and nothing private is stored", async () => {
    const data = await fixture();
    try {
      for (let index = 0; index < 5; index += 1) {
        await assert.rejects(
          submitPublicForm(data.database, invalidRateInput(data, {
            clientId: "invalid-rate-client",
            networkFacts: "invalid-rate-network",
            nonce: `invalid-rate-${index}`.padEnd(32, "x"),
            now: data.now + index,
          })),
          (error) =>
            error?.name === "PublicFormValidationError" &&
            typeof error?.fieldErrors?.name === "string",
        );
      }
      await assert.rejects(
        submitPublicForm(data.database, invalidRateInput(data, {
          clientId: "invalid-rate-client",
          networkFacts: "invalid-rate-network",
          nonce: "invalid-rate-six".padEnd(32, "x"),
          now: data.now + 10,
        })),
        (error) => error?.code === "rate_limited" && error?.status === 429,
      );
      assert.deepEqual(
        await publicFormPrivateResidueCounts(data.database),
        {
          audits: 0,
          email_outbox: 0,
          intents: 0,
          notifications: 0,
          submissions: 0,
          workflows: 0,
        },
      );
      assert.equal(
        await publicFormScopeRateCount(
          data.database,
          data.organizationId,
        ),
        5,
      );
    } finally {
      data.database.close();
    }
  });

  await t.test("invalid and genuine attempts share one threshold", async () => {
    const data = await fixture();
    try {
      for (let index = 0; index < 4; index += 1) {
        await assert.rejects(
          submitPublicForm(data.database, invalidRateInput(data, {
            clientId: "mixed-rate-client",
            networkFacts: "mixed-rate-network",
            nonce: `mixed-rate-${index}`.padEnd(32, "x"),
            now: data.now + index,
          })),
          (error) => error?.name === "PublicFormValidationError",
        );
      }
      await submitPublicForm(data.database, {
        ...formInput(
          "contact",
          "mixed-rate-valid".padEnd(32, "x"),
          data.now + 10,
          PAYLOADS.contact,
          { organizationId: data.organizationId },
        ),
        anonymousClientId: "mixed-rate-client",
        networkFacts: "mixed-rate-network",
      });
      await assert.rejects(
        submitPublicForm(data.database, invalidRateInput(data, {
          clientId: "mixed-rate-client",
          networkFacts: "mixed-rate-network",
          nonce: "mixed-rate-six".padEnd(32, "x"),
          now: data.now + 11,
        })),
        (error) => error?.code === "rate_limited",
      );
      assert.equal(
        await data.database
          .prepare(
            `SELECT count(*)
             FROM form_submissions
             WHERE organization_id = ?`,
          )
          .bind(data.organizationId)
          .first("count(*)"),
        1,
      );
    } finally {
      data.database.close();
    }
  });

  await t.test("synchronized invalid attempts at count four admit exactly one", async () => {
    const data = await fixture();
    try {
      for (let index = 0; index < 4; index += 1) {
        await assert.rejects(
          submitPublicForm(data.database, invalidRateInput(data, {
            clientId: "race-invalid-client",
            networkFacts: "race-invalid-network",
            nonce: `race-invalid-${index}`.padEnd(32, "x"),
            now: data.now + index,
          })),
          (error) => error?.name === "PublicFormValidationError",
        );
      }
      const settled = await Promise.allSettled(
        ["a", "b"].map((suffix) =>
          submitPublicForm(data.database, invalidRateInput(data, {
            clientId: "race-invalid-client",
            networkFacts: "race-invalid-network",
            nonce: `race-invalid-five-${suffix}`.padEnd(32, "x"),
            now: data.now + 10,
          })),
        ),
      );
      assert.equal(
        settled.filter(
          (result) =>
            result.status === "rejected" &&
            result.reason?.name === "PublicFormValidationError",
        ).length,
        1,
      );
      assert.equal(
        settled.filter(
          (result) =>
            result.status === "rejected" &&
            result.reason?.code === "rate_limited",
        ).length,
        1,
      );
      assert.equal(
        await publicFormScopeRateCount(
          data.database,
          data.organizationId,
        ),
        5,
      );
    } finally {
      data.database.close();
    }
  });

  await t.test("an invalid-attempt rate-write failure returns 503 with no residue", async () => {
    const data = await fixture();
    try {
      const failingDatabase = {
        batch() {
          throw new Error("synthetic invalid-rate persistence failure");
        },
        prepare(sql) {
          return data.database.prepare(sql);
        },
      };
      await assert.rejects(
        submitPublicForm(failingDatabase, invalidRateInput(data, {
          clientId: "invalid-rate-failure-client",
          networkFacts: "invalid-rate-failure-network",
          nonce: "invalid-rate-failure".padEnd(32, "x"),
          now: data.now,
        })),
        (error) =>
          error?.code === "service_unavailable" && error?.status === 503,
      );
      assert.deepEqual(
        await publicFormPrivateResidueCounts(data.database),
        {
          audits: 0,
          email_outbox: 0,
          intents: 0,
          notifications: 0,
          submissions: 0,
          workflows: 0,
        },
      );
      assert.equal(
        await data.database
          .prepare(
            `SELECT count(*)
             FROM public_form_rate_windows
             WHERE organization_id = ?`,
          )
          .bind(data.organizationId)
          .first("count(*)"),
        0,
      );
    } finally {
      data.database.close();
    }
  });

  await t.test("a stale Host club choice is also rate-admitted before its safe 422", async () => {
    const data = await fixture();
    try {
      await assert.rejects(
        submitPublicForm(data.database, {
          ...formInput(
            "host_event",
            "invalid-host-choice".padEnd(32, "x"),
            data.now,
            {
              ...PAYLOADS.host_event,
              preferredClubOrProgram: "club:missing-club",
            },
            { organizationId: data.organizationId },
          ),
          anonymousClientId: "invalid-host-client",
          networkFacts: "invalid-host-network",
        }),
        (error) =>
          error?.code === "validation_failed" &&
          /no longer available/iu.test(
            error?.safeMessage ?? error?.message,
          ),
      );
      assert.equal(
        await publicFormScopeRateCount(
          data.database,
          data.organizationId,
        ),
        1,
      );
      assert.equal(
        await data.database
          .prepare("SELECT count(*) FROM form_submissions")
          .first("count(*)"),
        0,
      );
    } finally {
      data.database.close();
    }
  });
});

test("detail response fails closed when organizer assignment or membership changes between reads", async (t) => {
  const data = await fixture();
  t.after(() => data.database.close());
  const organizerProfileId = "phase7-organizer-profile";
  await data.database
    .prepare(
      `INSERT INTO profiles (
         id, siwc_subject, normalized_email, display_name,
         public_attribution_consent, status, created_at, updated_at,
         deleted_at
       ) VALUES (?, ?, ?, 'Assigned Organizer', 0, 'active', ?, ?, NULL)`,
    )
    .bind(
      organizerProfileId,
      "phase7-organizer-subject",
      ORGANIZER_EMAIL,
      data.now,
      data.now,
    )
    .run();
  await data.database
    .prepare(
      `INSERT INTO organization_memberships (
         id, organization_id, profile_id, normalized_email, role, status,
         created_by_profile_id, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, 'organizer', 'active', ?, ?, ?, NULL)`,
    )
    .bind(
      "phase7-organizer-membership",
      data.organizationId,
      organizerProfileId,
      ORGANIZER_EMAIL,
      data.ownerProfileId,
      data.now,
      data.now,
    )
    .run();
  const organizerIdentity = trustedIdentityFromSites({
    displayName: "Assigned Organizer",
    email: ORGANIZER_EMAIL,
  });
  const stored = await submitPublicForm(
    data.database,
    formInput(
      "contact",
      "race-detail".padEnd(32, "x"),
      data.now,
      PAYLOADS.contact,
      { organizationId: data.organizationId },
    ),
  );
  const initial = await data.database
    .prepare(
      `SELECT submission_id, version
       FROM form_submission_workflows
       WHERE public_reference = ?`,
    )
    .bind(stored.publicReference)
    .first();
  await assignFormSubmission(data.database, data.ownerIdentity, {
    assigneeProfileId: organizerProfileId,
    expectedVersion: initial.version,
    submissionId: initial.submission_id,
  });

  const racedDatabase = interceptAfterHistoryRead(
    data.database,
    async () => {
      await data.database
        .prepare(
          `UPDATE organization_memberships
           SET status = 'suspended', updated_at = ?
           WHERE organization_id = ?
             AND profile_id = ?`,
        )
        .bind(data.now + 1, data.organizationId, organizerProfileId)
        .run();
    },
  );
  await assert.rejects(
    getFormSubmission(
      racedDatabase,
      organizerIdentity,
      initial.submission_id,
      data.now,
    ),
    (error) => error?.code === "not_found",
  );
});

test("list response fails closed when organizer membership or assignment changes between reads", async (t) => {
  await t.test("suspension before the final list seal denies the response", async () => {
    const data = await fixture();
    try {
      const assigned = await seedAssignedOrganizerSubmission(data, "list-suspended");
      const racedDatabase = interceptBeforeListAccessSeal(
        data.database,
        async () => {
          await data.database
            .prepare(
              `UPDATE profiles
               SET status = 'suspended', updated_at = ?
               WHERE id = ?`,
            )
            .bind(data.now + 1, assigned.profileId)
            .run();
        },
      );
      await assert.rejects(
        listFormSubmissions(
          racedDatabase,
          assigned.identity,
          { assignment: "mine" },
          data.now,
        ),
        (error) => error?.code === "not_found",
      );
    } finally {
      data.database.close();
    }
  });

  await t.test("reassignment before the final list seal denies the prior organizer", async () => {
    const data = await fixture();
    try {
      const assigned = await seedAssignedOrganizerSubmission(data, "list-reassigned");
      const replacement = await createOrganizerMember(data, "replacement");
      const racedDatabase = interceptBeforeListAccessSeal(
        data.database,
        async () => {
          await assignFormSubmission(data.database, data.ownerIdentity, {
            assigneeProfileId: replacement.profileId,
            expectedVersion: assigned.version,
            submissionId: assigned.submissionId,
          });
        },
      );
      await assert.rejects(
        listFormSubmissions(
          racedDatabase,
          assigned.identity,
          { assignment: "mine" },
          data.now,
        ),
        (error) => error?.code === "not_found",
      );
    } finally {
      data.database.close();
    }
  });

  await t.test("reassignment before the row read cannot leak a stale nonzero count", async () => {
    const data = await fixture();
    try {
      const assigned = await seedAssignedOrganizerSubmission(
        data,
        "list-reassigned-before-rows",
      );
      const replacement = await createOrganizerMember(
        data,
        "replacement-before-rows",
      );
      const racedDatabase = interceptBeforeListRowsRead(
        data.database,
        async () => {
          await assignFormSubmission(data.database, data.ownerIdentity, {
            assigneeProfileId: replacement.profileId,
            expectedVersion: assigned.version,
            submissionId: assigned.submissionId,
          });
        },
      );
      await assert.rejects(
        listFormSubmissions(
          racedDatabase,
          assigned.identity,
          { assignment: "mine" },
          data.now,
        ),
        (error) => error?.code === "not_found",
      );
    } finally {
      data.database.close();
    }
  });
});

test("submission assignee options revalidate the exact manager after reading private team data", async (t) => {
  const data = await fixture();
  t.after(() => data.database.close());
  const profileId = "phase7-assignee-admin-profile";
  const membershipId = "phase7-assignee-admin-membership";
  const email = "assignee-admin@vcc-tests.invalid";
  data.database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name,
      public_attribution_consent, status, created_at, updated_at,
      deleted_at
    ) VALUES (
      '${profileId}', 'phase7-assignee-admin-subject', '${email}',
      'Assignee Administrator', 0, 'active', ${data.now}, ${data.now},
      NULL
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at, deleted_at
    ) VALUES (
      '${membershipId}', '${data.organizationId}', '${profileId}',
      '${email}', 'administrator', 'active', '${data.ownerProfileId}',
      ${data.now}, ${data.now}, NULL
    );
  `);
  const administrator = trustedIdentityFromSites({
    displayName: "Assignee Administrator",
    email,
  });

  const counter = countD1Statements(data.database);
  assert.ok(
    (await listSubmissionAssignees(
      counter.database,
      administrator,
    )).some((assignee) => assignee.profileId === profileId),
  );
  assert.equal(counter.count(), 3);

  const intercepted = interceptD1Statements(data.database, {
    after: (sql) =>
      sql.includes("ORDER BY profile.display_name COLLATE NOCASE"),
    before: (sql) => sql.includes("SELECT membership.id"),
    hook: async () => {
      data.database.exec(
        `UPDATE profiles
         SET status = 'suspended', updated_at = updated_at + 1
         WHERE id = '${profileId}'`,
      );
    },
  });
  await assert.rejects(
    listSubmissionAssignees(intercepted.database, administrator),
    (error) => error?.code === "authorization_denied",
  );
  assert.equal(intercepted.fired(), true);
});

function interceptAfterHistoryRead(database, hook) {
  let fired = false;
  return {
    batch(statements) {
      return database.batch(statements);
    },
    exec(sql) {
      return database.exec(sql);
    },
    prepare(sql) {
      return wrap(database.prepare(sql), sql);
    },
  };

  function wrap(statement, sql) {
    return {
      bind(...values) {
        return wrap(statement.bind(...values), sql);
      },
      first(column) {
        return statement.first(column);
      },
      run() {
        return statement.run();
      },
      async all() {
        const result = await statement.all();
        if (
          !fired &&
          sql.includes("FROM audit_logs AS audit") &&
          sql.includes("form_submission.status_changed")
        ) {
          fired = true;
          await hook();
        }
        return result;
      },
    };
  }
}

function interceptBeforeListAccessSeal(database, hook) {
  let fired = false;
  return {
    batch(statements) {
      return database.batch(statements);
    },
    exec(sql) {
      return database.exec(sql);
    },
    prepare(sql) {
      return wrap(database.prepare(sql), sql);
    },
  };

  function wrap(statement, sql) {
    return {
      bind(...values) {
        return wrap(statement.bind(...values), sql);
      },
      async first(column) {
        if (
          !fired &&
          sql.includes("json_each(?) AS returned") &&
          sql.includes("current_submission.assigned_to_profile_id")
        ) {
          fired = true;
          await hook();
        }
        return statement.first(column);
      },
      run() {
        return statement.run();
      },
      all() {
        return statement.all();
      },
    };
  }
}

function interceptBeforeListRowsRead(database, hook) {
  let fired = false;
  return {
    batch(statements) {
      return database.batch(statements);
    },
    exec(sql) {
      return database.exec(sql);
    },
    prepare(sql) {
      return wrap(database.prepare(sql), sql);
    },
  };

  function wrap(statement, sql) {
    return {
      bind(...values) {
        return wrap(statement.bind(...values), sql);
      },
      first(column) {
        return statement.first(column);
      },
      run() {
        return statement.run();
      },
      async all() {
        if (
          !fired &&
          sql.includes("SELECT submission.id,") &&
          sql.includes("workflow.public_reference")
        ) {
          fired = true;
          await hook();
        }
        return statement.all();
      },
    };
  }
}

async function seedAssignedOrganizerSubmission(data, suffix) {
  const organizer = await createOrganizerMember(data, suffix);
  const stored = await submitPublicForm(
    data.database,
    formInput(
      "contact",
      `race-${suffix}`.padEnd(32, "x"),
      data.now,
      PAYLOADS.contact,
      { organizationId: data.organizationId },
    ),
  );
  const initial = await data.database
    .prepare(
      `SELECT submission_id, version
       FROM form_submission_workflows
       WHERE public_reference = ?`,
    )
    .bind(stored.publicReference)
    .first();
  const assigned = await assignFormSubmission(
    data.database,
    data.ownerIdentity,
    {
      assigneeProfileId: organizer.profileId,
      expectedVersion: initial.version,
      submissionId: initial.submission_id,
    },
  );
  return {
    ...organizer,
    submissionId: initial.submission_id,
    version: assigned.version,
  };
}

async function createOrganizerMember(data, suffix) {
  const profileId = `phase7-organizer-${suffix}`;
  const email = `phase7-organizer-${suffix}@example.invalid`;
  await data.database
    .prepare(
      `INSERT INTO profiles (
         id, siwc_subject, normalized_email, display_name,
         public_attribution_consent, status, created_at, updated_at,
         deleted_at
       ) VALUES (?, ?, ?, ?, 0, 'active', ?, ?, NULL)`,
    )
    .bind(
      profileId,
      `phase7-subject-${suffix}`,
      email,
      `Organizer ${suffix}`,
      data.now,
      data.now,
    )
    .run();
  await data.database
    .prepare(
      `INSERT INTO organization_memberships (
         id, organization_id, profile_id, normalized_email, role, status,
         created_by_profile_id, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, 'organizer', 'active', ?, ?, ?, NULL)`,
    )
    .bind(
      `phase7-membership-${suffix}`,
      data.organizationId,
      profileId,
      email,
      data.ownerProfileId,
      data.now,
      data.now,
    )
    .run();
  return {
    identity: trustedIdentityFromSites({
      displayName: `Organizer ${suffix}`,
      email,
    }),
    profileId,
  };
}

async function assertPhase7Clean(database) {
  assert.deepEqual(
    await Promise.all(
      PHASE7_INVARIANT_COUNT_SQL.map((sql) =>
        database.prepare(sql).first("violation_count"),
      ),
    ),
    Array(PHASE7_INVARIANT_COUNT_SQL.length).fill(0),
  );
}
