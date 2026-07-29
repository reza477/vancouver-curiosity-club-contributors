import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = process.cwd();

test("Phase 7 ledger and README state the active phase without invented provenance", () => {
  const status = source("BUILD_STATUS.md");
  const readme = source("README.md");

  assert.match(status, /Active phase: Phase 7/u);
  assert.match(status, /Phase 6 is \*\*Completed and verified\*\*/u);
  assert.match(status, /Phase 8 — Not started/u);
  assert.doesNotMatch(status, /\*\*Phase 7 — Not started\.\*\*/u);
  assert.match(status, /Phase 7 saved source commit: \*\*Not run\*\*/u);
  assert.match(status, /New unpublished Phase 7 Sites version: \*\*Not run\*\*/u);
  assert.match(status, /Awaiting owner smoke test/u);
  assert.match(status, /Awaiting a future authorized deployment/u);
  assert.match(
    status,
    /\*\*ICS file import — Not implemented — authorized cut\.\*\*/u,
  );

  const smokeSteps = [
    ...status.matchAll(/^(\d+)\. /gmu),
  ].map((match) => Number(match[1]));
  assert.deepEqual(smokeSteps.slice(-17), Array.from({ length: 17 }, (_, i) => i + 1));

  for (const path of [
    "docs/architecture/0011-phase-7-imports-exports-forms.md",
    "docs/phase7-csv-field-guide.md",
    "docs/phase7-exports-calendar-backup.md",
    "docs/phase7-public-forms-submissions.md",
    "docs/phase7-local-testing.md",
    "docs/owner-guide-phase7.md",
    "docs/organizer-guide-phase7.md",
    "docs/known-limitations-phase7.md",
  ]) {
    assert.match(readme, new RegExp(escapeRegex(path), "u"), path);
  }
  assert.doesNotMatch(readme, /Phase 7 imports,[\s\S]*have not started/u);
});

test("Phase 7 ADR pins persisted approval, resumability, conflict, atomicity, retention, and privacy", () => {
  const adr = source("docs/architecture/0011-phase-7-imports-exports-forms.md");
  for (const phrase of [
    "Persisted preview is the approval boundary",
    "Resumability and idempotency",
    "Phase 4 conflict integration",
    "Per-row atomicity",
    "Retention and redaction",
    "Public/private boundaries",
  ]) {
    assert.match(adr, new RegExp(escapeRegex(phrase), "u"));
  }
  assert.match(adr, /never supplies an authoritative normalized event payload/u);
  assert.match(adr, /50 D1 statements/u);
});

test("downloadable CSV field guide is self-contained and covers every template field", () => {
  const template = source("public/templates/vcc-event-import-v1.csv").trim();
  const guide = source("public/templates/vcc-event-import-v1-field-guide.txt");
  const headers = template.split(",");

  assert.equal(headers.length, 25);
  for (const header of headers) {
    assert.match(
      guide,
      new RegExp(`^${escapeRegex(header)}$`, "mu"),
      header,
    );
  }
  assert.match(guide, /SOURCE LABEL AND NAMESPACE/u);
  assert.match(guide, /one to 64 characters/iu);
  assert.match(guide, /Hard duplicates are skipped/u);
  assert.match(guide, /ICS file import - Not implemented - authorized cut/u);
  assert.doesNotMatch(guide, /see docs\/|complete field-by-field guide/iu);
});

test("backup and Owner guides define the exact schema, restore limits, and import outcomes", () => {
  const backup = source("docs/phase7-exports-calendar-backup.md");
  const owner = source("docs/owner-guide-phase7.md");

  assert.match(backup, /Exact `vcc-owner-backup-v1` envelope/u);
  for (const field of [
    "schemaVersion",
    "applicationRevision",
    "sourceRevision",
    "generatedAt",
    "organization",
    "counts",
    "includedSections",
    "excludedSections",
    "restore",
    "sections",
  ]) {
    assert.match(backup, new RegExp(`\\b${field}\\b`, "u"), field);
  }
  for (const section of [
    "memberships",
    "clubs",
    "programs",
    "lanes",
    "categories",
    "venues",
    "events",
    "eventOrganizers",
    "eventRevisions",
    "conflictPolicy",
    "pages",
    "pageSections",
    "cmsRevisions",
    "communityLinks",
    "navigation",
    "publicSettings",
    "media",
  ]) {
    assert.match(backup, new RegExp(`\\b${section}\\b`, "u"), section);
  }
  assert.match(backup, /Dependency-order restore mapping/u);
  assert.match(backup, /PRAGMA foreign_key_check/u);
  assert.match(backup, /automatic:false/u);
  assert.match(backup, /\*\*Not run\.\*\*/u);

  for (const outcome of [
    "Imported",
    "Skipped",
    "Failed",
    "Pending",
    "Administrator review",
  ]) {
    assert.match(owner, new RegExp(`\\*\\*${escapeRegex(outcome)}\\*\\*`, "u"));
  }
  assert.match(owner, /Source namespace/u);
  assert.match(owner, /terminal batch/u);
  assert.match(owner, /after 90 days/u);
});

function source(path) {
  return readFileSync(`${ROOT}/${path}`, "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
