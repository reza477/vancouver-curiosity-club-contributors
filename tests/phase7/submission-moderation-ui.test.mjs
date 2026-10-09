import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const moduleUrl = (text) => `data:text/javascript,${encodeURIComponent(text)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith(".module.css")) return { shortCircuit: true, url: moduleUrl('export default new Proxy({}, { get: (_, key) => String(key) });') };
    if (specifier === "next/navigation") return { shortCircuit: true, url: moduleUrl('export function useRouter() { return { refresh() {} }; }') };
    return nextResolve(specifier, context);
  },
});
const { SubmissionInbox } = await import("../../app/_organizer/SubmissionInbox.tsx");
const { SubmissionWorkspace } = await import("../../app/_organizer/SubmissionWorkspace.tsx");

const item = Object.freeze({
  id: "synthetic-submission", publicReference: "VCC-0123456789ABCDEF0123", formKey: "contact",
  createdAt: 1791061200000, retentionReviewAt: 1822597200000, retentionDue: false,
  assignedTo: null, status: "new", version: 1, moderationFolder: "inbox", moderationVersion: 0, emailHeld: false,
});
const detail = { ...item, fields: { name: "Synthetic Visitor", email: "visitor@example.invalid", topic: "privacy", message: "Synthetic local inquiry." }, notes: [], history: [], redactedAt: null };
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test("manager inbox exposes bounded reversible actions, not permanent bulk redaction", () => {
  const html = render(SubmissionInbox, { items: [item], manager: true, folder: "inbox" });
  assert.match(html, /Select up to 10 submissions/);
  assert.match(html, /aria-label="Select VCC-0123456789ABCDEF0123"/);
  assert.match(html, /disabled="">Move selected to Spam/);
  assert.match(html, /disabled="">Move selected to Trash/);
  assert.doesNotMatch(html, /Permanently redact|Synthetic Visitor|visitor@example/);
});

test("assigned organizer list and detail do not expose moderation or redaction controls", () => {
  const html = render(SubmissionInbox, { items: [item], manager: false, folder: "inbox" });
  assert.doesNotMatch(html, /Bulk moderation|type="checkbox"|Move selected/);
  const page = render(SubmissionWorkspace, { initialSubmission: detail, assignees: [], role: "organizer" });
  assert.doesNotMatch(page, /Move to Spam|Move to Trash|Restore to Inbox|Permanently redact content/);
});

test("recoverable folders expose restore and explain the persistent email hold", () => {
  const html = render(SubmissionInbox, { items: [{ ...item, moderationFolder: "spam", moderationVersion: 1, emailHeld: true }], manager: true, folder: "spam" });
  assert.match(html, /Restore selected to Inbox/);
  assert.doesNotMatch(html, /Move selected to Spam/);
  const page = render(SubmissionWorkspace, { initialSubmission: { ...detail, moderationFolder: "trash", moderationVersion: 2, emailHeld: true }, assignees: [], role: "administrator" });
  assert.match(page, /Folder: Trash/);
  assert.match(page, /Restore to Inbox/);
  assert.match(page, /including after restoration/);
  assert.match(page, /Synthetic local inquiry/);
  assert.doesNotMatch(page, /Permanently redact content/);
});

test("owner permanent redaction remains separately labeled and confirmation gated", () => {
  const html = render(SubmissionWorkspace, { initialSubmission: detail, assignees: [], role: "owner" });
  assert.match(html, /Irreversible privacy action/);
  assert.match(html, /Type VCC-0123456789ABCDEF0123 to confirm/);
  assert.match(html, /disabled=""[^>]*>Permanently redact content/);
});
