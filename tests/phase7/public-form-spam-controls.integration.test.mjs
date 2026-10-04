import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { bootstrapInitialOwner, trustedIdentityFromSites } from "../../lib/server/auth/index.ts";
import { PHASE7_INVARIANT_TRIGGER_STATEMENTS } from "../../lib/server/database/phase7-invariant-sql.ts";
import { FORM_SUBMISSION_DEDUPLICATION_COUNT_SQL } from "../../lib/server/database/form-submission-deduplication-invariant-sql.ts";
import { submitPublicForm } from "../../lib/server/phase7/public-forms.ts";
import { isIndexRegistrationSolicitation } from "../../lib/server/phase7/public-form-spam-policy.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const PAYLOADS = {
  contact: { name: "Synthetic Visitor", replyEmail: "visitor@example.invalid", topic: "Privacy", message: "Please explain the privacy policy for our upcoming event." },
  volunteer: { name: "Synthetic Visitor", replyEmail: "visitor@example.invalid", interestAreas: ["Welcoming"], howToHelp: "I can welcome visitors at the next event.", availabilityContext: "Weekends" },
  host_event: { name: "Synthetic Visitor", replyEmail: "visitor@example.invalid", eventIdea: "A workshop about search engines and accessible websites.", proposedTitle: "Web workshop", format: "In person", preferredClubOrProgram: null, preferredTiming: null },
  partnership: { name: "Synthetic Visitor", replyEmail: "visitor@example.invalid", organizationOrVenueName: "Synthetic Venue", partnershipType: "Venue", website: "https://example.invalid", message: "We would like to offer meeting space for an event." },
};

async function fixture(t) {
  const database = new SqliteD1TestDatabase(readdirSync("drizzle").filter((f) => /^\d+.*\.sql$/u.test(f)).sort().map((f) => readFileSync(`drizzle/${f}`, "utf8")).join("\n"));
  t.after(() => database.close());
  const now = Date.now();
  const identity = trustedIdentityFromSites({ displayName: "Synthetic Owner", email: "owner@spam-tests.invalid" });
  await bootstrapInitialOwner(database, identity, "owner@spam-tests.invalid", now);
  const organizationId = await database.prepare("SELECT id FROM organizations LIMIT 1").first("id");
  database.exec(PHASE7_INVARIANT_TRIGGER_STATEMENTS.join("\n"));
  return { database, now, organizationId };
}

function input(data, formKey, index, overrides = {}) {
  return { anonymousClientId: `client-${index}`, formInstance: { formKey, issuedAt: data.now - 4_000, nonce: `nonce-${index}`.padEnd(32, "x") }, formKey, honeypot: "", keyHex: "b".repeat(64), networkFacts: "192.0.2.1\0browser\0en", nowUtcMs: data.now, organizationId: data.organizationId, payload: PAYLOADS[formKey], ...overrides };
}

test("valid honeypot messages from all four forms are retained in recoverable quarantine without notification", async (t) => {
  const data = await fixture(t);
  for (const formKey of Object.keys(PAYLOADS)) {
    const stored = await submitPublicForm(data.database, input(data, formKey, formKey, { honeypot: "autofilled" }));
    assert.equal(stored.notificationEligible, false);
    const row = await data.database.prepare(`SELECT submission.payload_json, submission.status, moderation.folder, moderation.reason, moderation.email_hold_at FROM form_submissions AS submission JOIN form_submission_moderation AS moderation ON moderation.submission_id = submission.id WHERE submission.id = ?`).bind(stored.submissionId).first();
    assert.equal(JSON.parse(row.payload_json).replyEmail, PAYLOADS[formKey].replyEmail);
    assert.equal(row.status, "new");
    assert.equal(row.folder, "spam");
    assert.equal(row.reason, "honeypot");
    assert.equal(row.email_hold_at, data.now);
    assert.equal((await submitPublicForm(data.database, input(data, formKey, formKey, { honeypot: "" }))).notificationEligible, false);
  }
  assert.equal(await data.database.prepare("SELECT count(*) AS count FROM notifications WHERE type='form_submission_received'").first("count"), 0);
  assert.equal(await data.database.prepare("SELECT count(*) AS count FROM form_submission_email_outbox").first("count"), 4);
});

test("fast autofill receives a retry preserving answers and nonce, then succeeds", async (t) => {
  const data = await fixture(t);
  const original = input(data, "contact", "fast", { formInstance: { formKey: "contact", issuedAt: data.now - 500, nonce: "fast".padEnd(32, "x") } });
  await assert.rejects(submitPublicForm(data.database, original), (error) => {
    assert.match(error.fieldErrors.form, /wait a moment/u);
    assert.equal(error.values.message, PAYLOADS.contact.message);
    return true;
  });
  assert.equal(await data.database.prepare("SELECT count(*) AS count FROM form_submissions").first("count"), 0);
  const stored = await submitPublicForm(data.database, { ...original, nowUtcMs: data.now + 4_000 });
  assert.equal(stored.notificationEligible, true);
});

test("fresh form instances and rotated cookies share one receipt for the same normalized inquiry", async (t) => {
  const data = await fixture(t);
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => submitPublicForm(data.database, input(data, "contact", i, { payload: { ...PAYLOADS.contact, message: i % 2 ? `  ${PAYLOADS.contact.message}  ` : PAYLOADS.contact.message } }))));
  assert.equal(new Set(results.map((item) => item.submissionId)).size, 1);
  assert.equal(new Set(results.map((item) => item.publicReference)).size, 1);
  assert.equal(results.filter((item) => item.notificationEligible).length, 1);
  assert.equal(await data.database.prepare("SELECT count(*) AS count FROM form_submission_email_outbox").first("count"), 1);
  const fingerprint = await data.database.prepare("SELECT fingerprint_hash FROM form_submission_deduplication").first("fingerprint_hash");
  assert.match(fingerprint, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(fingerprint, /visitor|privacy/iu);
  await assert.rejects(submitPublicForm(data.database, input(data, "contact", "six")), { code: "rate_limited" });
  assert.equal(await data.database.prepare("SELECT count(*) AS count FROM form_submission_retry_receipts").first("count"), 4);
  await assert.rejects(data.database.prepare("UPDATE form_submission_deduplication SET fingerprint_hash = ?").bind("f".repeat(64)).run(), /deduplication_immutable/u);
  await assert.rejects(data.database.prepare("UPDATE form_submission_retry_receipts SET request_idempotency_hash = ?").bind("e".repeat(64)).run(), /retry_receipt_immutable/u);
  await assert.rejects(data.database.prepare("INSERT INTO form_submission_retry_receipts (request_idempotency_hash, submission_id, organization_id, created_at) VALUES (?, ?, ?, ?)").bind("d".repeat(64), results[0].submissionId, "wrong-organization", data.now).run(), /retry_receipt_insert_invalid/u);
  for (const sql of FORM_SUBMISSION_DEDUPLICATION_COUNT_SQL) assert.equal(await data.database.prepare(sql).first("violation_count"), 0);
});

test("cookie-less visitors do not share a browser quota", async (t) => {
  const data = await fixture(t);
  for (let i = 0; i < 6; i++) {
    const stored = await submitPublicForm(data.database, input(data, "contact", i, {
      anonymousClientId: "contact-no-cookie-v1",
      payload: { ...PAYLOADS.contact, replyEmail: `different-${i}@example.invalid` },
    }));
    assert.equal(stored.notificationEligible, true);
  }
  assert.equal(await data.database.prepare("SELECT count(*) AS count FROM form_submissions").first("count"), 6);
});

test("reply-address limits survive fresh cookies and browser metadata while shared networks stay usable", async (t) => {
  const data = await fixture(t);
  for (let i = 0; i < 5; i++) await submitPublicForm(data.database, input(data, "contact", i, { networkFacts: `192.0.2.1\0browser-${i}\0language-${i}`, payload: { ...PAYLOADS.contact, message: `${PAYLOADS.contact.message} Inquiry ${i}.` } }));
  await assert.rejects(submitPublicForm(data.database, input(data, "contact", "six", { payload: { ...PAYLOADS.contact, message: `${PAYLOADS.contact.message} A different sixth inquiry.` } })), { code: "rate_limited", status: 429 });
  const other = await submitPublicForm(data.database, input(data, "contact", "other", { payload: { ...PAYLOADS.contact, replyEmail: "different@example.invalid" } }));
  assert.equal(other.notificationEligible, true);
});

test("known registration campaigns are review signals regardless of topic while legitimate reports and SEO questions are allowed", () => {
  const solicitation = "Register your domain in Google's search index at https://searchregister.pro/submit to get listed.";
  for (const topic of ["Privacy", "Event question", "General"]) assert.equal(isIndexRegistrationSolicitation({ ...PAYLOADS.contact, topic, message: solicitation }), true);
  for (const message of [
    "Can we host an event about SEO? Google and Bing have useful official documentation at https://developers.google.com/search/.",
    "I received this spam asking me to register my site in Google at https://searchregister.pro/submit. Please investigate.",
    "Google does not require paid registration. Is your site indexed?",
    "Register for our event about Google search at https://example.invalid/event.",
    "Register your domain with Google at https://searchregister.pro.attacker.invalid/submit.",
    "آیا می‌توانم درباره رویداد آینده سؤال بپرسم؟",
  ]) assert.equal(isIndexRegistrationSolicitation({ ...PAYLOADS.contact, message }), false, message);
});
