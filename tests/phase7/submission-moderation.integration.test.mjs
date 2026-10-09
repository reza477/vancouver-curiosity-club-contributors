import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as nodeModule from "node:module";
import { bootstrapInitialOwner, trustedIdentityFromSites } from "../../lib/server/auth/index.ts";
import { PHASE7_INVARIANT_COUNT_SQL, PHASE7_INVARIANT_TRIGGER_STATEMENTS } from "../../lib/server/database/phase7-invariant-sql.ts";
import { submitPublicForm } from "../../lib/server/phase7/public-forms.ts";
import { moderateFormSubmissions } from "../../lib/server/phase7/submission-moderation.ts";
import { appendFormSubmissionNote, assignFormSubmission, changeFormSubmissionStatus, getFormSubmission, listFormSubmissions, redactFormSubmissionPersonalContent } from "../../lib/server/phase7/submissions.ts";
import { deliverPublicFormEmail, drainPublicFormEmailOutbox } from "../../lib/server/phase7/public-form-email.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const OWNER_EMAIL = "moderation-owner@vcc-tests.invalid";
const CONFIG = { apiKey: "test-key", fromEmail: "forms@vcc-tests.invalid", toEmail: OWNER_EMAIL };

async function fixture(t) {
  const database = new SqliteD1TestDatabase(readdirSync("drizzle").filter((name) => /^\d+.*\.sql$/u.test(name)).sort().map((name) => readFileSync(join("drizzle", name), "utf8")).join("\n"));
  t.after(() => database.close());
  const identity = trustedIdentityFromSites({ email: OWNER_EMAIL, displayName: "Moderation Owner" });
  await bootstrapInitialOwner(database, identity, OWNER_EMAIL, Date.now());
  const membership = await database.prepare("SELECT organization_id, profile_id FROM organization_memberships WHERE normalized_email = ?").bind(OWNER_EMAIL).first();
  database.exec(PHASE7_INVARIANT_TRIGGER_STATEMENTS.join("\n"));
  let sequence = 0;
  return {
    database, identity, membership,
    async create() {
      sequence += 1;
      const now = Date.now();
      const receipt = await submitPublicForm(database, {
        anonymousClientId: `moderation-client-${sequence}`,
        formInstance: { formKey: "contact", issuedAt: now - 5_000, nonce: `moderation-nonce-${sequence}` },
        formKey: "contact", honeypot: "", keyHex: "b".repeat(64),
        networkFacts: `moderation-network-${sequence}`, nowUtcMs: now,
        organizationId: membership.organization_id,
        payload: { name: `Synthetic Visitor ${sequence}`, replyEmail: `visitor${sequence}@vcc-tests.invalid`, topic: "Event question", message: `Please explain the venue arrangements for discussion number ${sequence}.` },
      });
      return getFormSubmission(database, identity, receipt.submissionId);
    },
  };
}

function item(value) {
  return { submissionId: value.id, expectedVersion: value.version, expectedModerationVersion: value.moderationVersion };
}

async function assertInvariants(database) {
  for (const sql of PHASE7_INVARIANT_COUNT_SQL) {
    assert.equal(await database.prepare(sql).first("violation_count"), 0);
  }
}

test("bulk spam and restore preserve content and notes while permanently holding unsent email", async (t) => {
  const f = await fixture(t);
  const a = await f.create();
  const b = await f.create();
  const legitimate = await f.create();
  await appendFormSubmissionNote(f.database, f.identity, { submissionId: a.id, body: "Synthetic private review note." });
  assert.deepEqual(await moderateFormSubmissions(f.database, f.identity, { folder: "spam", items: [item(a), item(b)] }), { changed: 2 });
  const normal = await listFormSubmissions(f.database, f.identity);
  assert.deepEqual(normal.items.map((entry) => entry.id), [legitimate.id]);
  const spam = await listFormSubmissions(f.database, f.identity, { folder: "spam" });
  assert.equal(spam.totalCount, 2);
  const heldA = await getFormSubmission(f.database, f.identity, a.id);
  const heldB = await getFormSubmission(f.database, f.identity, b.id);
  assert.deepEqual(heldA.fields, a.fields);
  assert.equal(heldA.notes[0].body, "Synthetic private review note.");
  assert.equal(heldA.status, "new");
  assert.equal(heldA.moderationFolder, "spam");
  assert.equal(heldA.emailHeld, true);
  await moderateFormSubmissions(f.database, f.identity, { folder: "inbox", items: [item(heldA), item(heldB)] });
  const restored = await getFormSubmission(f.database, f.identity, a.id);
  assert.equal(restored.moderationFolder, "inbox");
  assert.equal(restored.emailHeld, true);
  assert.equal(restored.moderationVersion, 2);
  let sends = 0;
  const fetcher = async () => { sends += 1; return new Response(JSON.stringify({ id: "synthetic-provider-id" }), { status: 200 }); };
  assert.equal(await deliverPublicFormEmail(f.database, a.id, { configuration: CONFIG, fetcher }), "suppressed");
  const drain = await drainPublicFormEmailOutbox(f.database, { configuration: CONFIG, fetcher, nowUtcMs: Date.now() + 5_000 });
  assert.equal(sends, 1);
  assert.equal(drain.sent, 1);
  assert.equal(drain.hasMoreDue, false);
  await assertInvariants(f.database);
});

test("stale, repeated, oversized and mixed foreign batches never partially move submissions", async (t) => {
  const f = await fixture(t);
  const a = await f.create();
  const b = await f.create();
  await assert.rejects(moderateFormSubmissions(f.database, f.identity, {
    folder: "trash", items: [item(a), { ...item(b), expectedVersion: 99 }],
  }), (error) => error.code === "stale_edit");
  assert.equal((await getFormSubmission(f.database, f.identity, a.id)).moderationVersion, 0);
  assert.equal(await f.database.prepare("SELECT count(*) AS count FROM audit_logs WHERE action = 'form_submission.moderation_changed'").first("count"), 0);
  await assert.rejects(moderateFormSubmissions(f.database, f.identity, { folder: "spam", items: [item(a), item(a)] }), (error) => error.code === "validation_failed");
  await assert.rejects(moderateFormSubmissions(f.database, f.identity, { folder: "spam", items: Array.from({ length: 11 }, () => item(a)) }), (error) => error.code === "validation_failed");
  await assert.rejects(moderateFormSubmissions(f.database, f.identity, {
    folder: "trash", items: [item(a), { submissionId: "absent-submission", expectedVersion: 1, expectedModerationVersion: 0 }],
  }), (error) => error.code === "stale_edit");
  assert.equal((await listFormSubmissions(f.database, f.identity)).totalCount, 2);
  await assertInvariants(f.database);
});

test("active delivery leases block moderation and sent receipts survive moderation", async (t) => {
  const f = await fixture(t);
  const a = await f.create();
  await f.database.prepare(`UPDATE form_submission_email_outbox SET state = 'leased', attempt_count = 1, lease_token_hash = ?, lease_expires_at = ? WHERE submission_id = ?`).bind("d".repeat(64), Date.now() + 60_000, a.id).run();
  await assert.rejects(moderateFormSubmissions(f.database, f.identity, { folder: "spam", items: [item(a)] }), (error) => error.code === "stale_edit");
  await f.database.prepare(`UPDATE form_submission_email_outbox SET state = 'sent', lease_token_hash = NULL, lease_expires_at = NULL, provider_message_id = 'prior-delivery', sent_at = ? WHERE submission_id = ?`).bind(Date.now(), a.id).run();
  await moderateFormSubmissions(f.database, f.identity, { folder: "trash", items: [item(a)] });
  const outbox = await f.database.prepare("SELECT state, provider_message_id FROM form_submission_email_outbox WHERE submission_id = ?").bind(a.id).first();
  assert.deepEqual({ ...outbox }, { state: "sent", provider_message_id: "prior-delivery" });
  assert.deepEqual((await getFormSubmission(f.database, f.identity, a.id)).fields, a.fields);
  await assertInvariants(f.database);
});

test("organizer access is revoked by quarantine and only current managers may restore", async (t) => {
  const f = await fixture(t);
  const initial = await f.create();
  const a = await assignFormSubmission(f.database, f.identity, {
    submissionId: initial.id, expectedVersion: initial.version, assigneeProfileId: f.membership.profile_id,
  });
  await moderateFormSubmissions(f.database, f.identity, { folder: "spam", items: [item(a)] });
  const held = await getFormSubmission(f.database, f.identity, a.id);
  await f.database.prepare("UPDATE organization_memberships SET role = 'organizer' WHERE profile_id = ?").bind(f.membership.profile_id).run();
  await assert.rejects(getFormSubmission(f.database, f.identity, a.id), (error) => error.code === "not_found");
  await assert.rejects(listFormSubmissions(f.database, f.identity, { folder: "spam" }), (error) => error.code === "not_found");
  await assert.rejects(moderateFormSubmissions(f.database, f.identity, { folder: "inbox", items: [item(held)] }));
  await f.database.prepare("UPDATE organization_memberships SET role = 'administrator' WHERE profile_id = ?").bind(f.membership.profile_id).run();
  await moderateFormSubmissions(f.database, f.identity, { folder: "inbox", items: [item(held)] });
  assert.equal((await getFormSubmission(f.database, f.identity, a.id)).emailHeld, true);
  await assertInvariants(f.database);
});

test("redaction remains a separate owner action and cannot be undone by restoring trash", async (t) => {
  const f = await fixture(t);
  const a = await f.create();
  await moderateFormSubmissions(f.database, f.identity, { folder: "trash", items: [item(a)] });
  const held = await getFormSubmission(f.database, f.identity, a.id);
  const redacted = await redactFormSubmissionPersonalContent(f.database, f.identity, {
    submissionId: a.id, expectedVersion: held.version, confirmationReference: held.publicReference,
  });
  await moderateFormSubmissions(f.database, f.identity, { folder: "inbox", items: [item(redacted)] });
  const restored = await getFormSubmission(f.database, f.identity, a.id);
  assert.deepEqual(restored.fields, { redacted: true });
  assert.equal(restored.emailHeld, true);
  await assertInvariants(f.database);
});

test("database guards deny forged moderation, removal and delivery after a hold", async (t) => {
  const f = await fixture(t);
  const a = await f.create();
  const now = Date.now();
  await assert.rejects(f.database.prepare(`INSERT INTO form_submission_moderation (submission_id, organization_id, folder, version, reason, email_hold_at, created_at, updated_at) VALUES (?, ?, 'spam', 1, 'honeypot', ?, ?, ?)`).bind(a.id, f.membership.organization_id, now, now, now).run());
  await moderateFormSubmissions(f.database, f.identity, { folder: "spam", items: [item(a)] });
  await assert.rejects(f.database.prepare("DELETE FROM form_submission_moderation WHERE submission_id = ?").bind(a.id).run());
  await assert.rejects(f.database.prepare(`UPDATE form_submission_email_outbox SET state = 'leased', attempt_count = 1, lease_token_hash = ?, lease_expires_at = ? WHERE submission_id = ?`).bind("e".repeat(64), now + 60_000, a.id).run());
  await assertInvariants(f.database);
});

test("quarantine interleaved after an organizer read blocks status, note and content responses", async (t) => {
  for (const operation of ["status", "note", "read"]) {
    await t.test(operation, async (t) => {
      const f = await fixture(t);
      const now = Date.now();
      const organizerEmail = "assigned-organizer@vcc-tests.invalid";
      await f.database.prepare(`INSERT INTO profiles (id, siwc_subject, normalized_email, display_name, status, created_at, updated_at) VALUES ('moderation-organizer', ?, ?, 'Synthetic Organizer', 'active', ?, ?)`)
        .bind(`email:${organizerEmail}`, organizerEmail, now, now).run();
      await f.database.prepare(`INSERT INTO organization_memberships (id, organization_id, profile_id, normalized_email, role, status, created_by_profile_id, created_at, updated_at) VALUES ('moderation-organizer-membership', ?, 'moderation-organizer', ?, 'organizer', 'active', ?, ?, ?)`)
        .bind(f.membership.organization_id, organizerEmail, f.membership.profile_id, now, now).run();
      const organizer = trustedIdentityFromSites({ email: organizerEmail, displayName: "Synthetic Organizer" });
      const initial = await f.create();
      const assigned = await assignFormSubmission(f.database, f.identity, { submissionId: initial.id, expectedVersion: initial.version, assigneeProfileId: "moderation-organizer" });
      let moved = false;
      async function quarantine() {
        if (moved) return;
        moved = true;
        await moderateFormSubmissions(f.database, f.identity, { folder: "spam", items: [item(assigned)] });
      }
      const raced = {
        prepare(sql) {
          function wrap(statement) {
            return {
              bind(...bindings) { return wrap(statement.bind(...bindings)); },
              first: (...args) => statement.first(...args),
              run: (...args) => statement.run(...args),
              async all(...args) {
                const result = await statement.all(...args);
                if (operation === "read" && sql.includes("SELECT audit.id")) await quarantine();
                return result;
              },
            };
          }
          return operation === "read" ? wrap(f.database.prepare(sql)) : f.database.prepare(sql);
        },
        async batch(statements) {
          if (operation !== "read") await quarantine();
          return f.database.batch(statements);
        },
      };
      await assert.rejects(operation === "status"
        ? changeFormSubmissionStatus(raced, organizer, { submissionId: assigned.id, expectedVersion: assigned.version, status: "in_review" })
        : operation === "note"
          ? appendFormSubmissionNote(raced, organizer, { submissionId: assigned.id, body: "This raced note must not persist." })
          : getFormSubmission(raced, organizer, assigned.id));
      assert.equal(moved, true);
      const current = await getFormSubmission(f.database, f.identity, assigned.id);
      assert.equal(current.status, "new");
      assert.equal(current.notes.length, 0);
      assert.equal(current.moderationFolder, "spam");
      await assertInvariants(f.database);
    });
  }
});

test("moderation API requires current manager identity and same-origin bounded requests", async (t) => {
  const f = await fixture(t);
  const entries = [];
  for (let index = 0; index < 10; index += 1) entries.push(await f.create());
  let queries = 0;
  const counted = {
    prepare(sql) {
      function wrap(statement) {
        return {
          bind(...bindings) { return wrap(statement.bind(...bindings)); },
          first(...args) { queries += 1; return statement.first(...args); },
          all(...args) { queries += 1; return statement.all(...args); },
          run(...args) { queries += 1; return statement.run(...args); },
          rawStatement: statement,
        };
      }
      return wrap(f.database.prepare(sql));
    },
    batch(statements) { queries += statements.length; return f.database.batch(statements.map((entry) => entry.rawStatement)); },
  };
  globalThis.__VCC_MODERATION_ROUTE_ENV__ = { DB: counted, INITIAL_OWNER_EMAIL: OWNER_EMAIL };
  globalThis.__VCC_MODERATION_ROUTE_HEADERS__ = { "oai-authenticated-user-email": OWNER_EMAIL, "oai-authenticated-user-full-name": "Moderation Owner" };
  const dataModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
  const hooks = nodeModule.registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "cloudflare:workers") return { shortCircuit: true, url: dataModule("export const env = globalThis.__VCC_MODERATION_ROUTE_ENV__;") };
      if (specifier === "next/headers") return { shortCircuit: true, url: dataModule("export async function headers() { return new Headers(globalThis.__VCC_MODERATION_ROUTE_HEADERS__); }") };
      if (specifier === "server-only") return { shortCircuit: true, url: dataModule("export {};") };
      return next(specifier, context);
    },
  });
  t.after(() => hooks.deregister());
  const route = await import("../../app/api/organizer/submissions/moderation/route.ts?moderation-test");
  const url = "https://moderation.example/api/organizer/submissions/moderation";
  function request(origin, body = { folder: "spam", items: entries.map(item) }) {
    return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
  }
  assert.equal((await route.POST(request(null))).status, 403);
  assert.equal((await route.POST(request("https://untrusted.example"))).status, 403);
  assert.equal((await route.POST(request("https://moderation.example", { padding: "x".repeat(20_000) }))).status, 422);
  assert.equal(await f.database.prepare("SELECT count(*) AS count FROM form_submission_moderation").first("count"), 0);
  queries = 0;
  const saved = await route.POST(request("https://moderation.example"));
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { changed: 10 });
  assert.ok(queries <= 50, `largest moderation request used ${queries} statements`);
  assert.match(saved.headers.get("cache-control"), /no-store/u);
  assert.equal(saved.headers.get("referrer-policy"), "no-referrer");
  await f.database.prepare("UPDATE organization_memberships SET role = 'organizer' WHERE profile_id = ?").bind(f.membership.profile_id).run();
  assert.equal((await route.POST(request("https://moderation.example"))).status, 403);
  globalThis.__VCC_MODERATION_ROUTE_HEADERS__ = {};
  assert.equal((await route.POST(request("https://moderation.example"))).status, 401);
  await assertInvariants(f.database);
});
