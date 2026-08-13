import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const ROOT = process.cwd();

test("Phase 9 ledger preserves local evidence and records the exact private deployment", () => {
  const status = source("BUILD_STATUS.md");
  const readme = source("README.md");

  assert.match(status, /Active phase: Phase 9/u);
  assert.match(status, /Phase 6 is \*\*Completed and verified\*\*/u);
  assert.match(
    status,
    /Phase 7 implementation[\s\S]*\*\*Completed and verified\*\*/u,
  );
  assert.match(
    status,
    /Phase 9 is \*\*Completed and verified\*\*[\s\S]*private-deployment/u,
  );
  assert.doesNotMatch(status, /Phase 9 [^\r\n]* Not started/u);
  assert.doesNotMatch(status, /Active phase: Phase 10/iu);
  assert.match(status, /No Phase 10 is started or authorized/u);
  assert.doesNotMatch(status, /\*\*Phase 8 [^\r\n]* Not started\.\*\*/u);
  assert.match(
    status,
    /Phase 7 saved source commit: (?:\*\*Not run\*\*|`[0-9a-f]{40}`)/u,
  );
  assert.match(
    status,
    /New unpublished Phase 7 Sites version: (?:\*\*Not run\*\*|`appgprj_[^`\s]+~appgver_[^`\s]+`)/u,
  );
  assert.match(
    status,
    /Phase 8 substantive source commit: (?:\*\*Pending final source freeze\*\*|`[0-9a-f]{40}`)/u,
  );
  assert.match(
    status,
    /Saved Sites version 14: `appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_69aafba5ef148191b00042bce388a678`/u,
  );
  assert.match(
    status,
    /appgdep_6a6a8ade7fa08191a6c1a21cf7d1f0b9/u,
  );
  assert.match(
    status,
    /aaeb6a648e93a7dd2e41f329085b611b8b7d10b1/u,
  );
  assert.match(
    status,
    /sha256:0b65ec790f59acd1ceb1d8ac62350e8914352c6b251aa78ecefbf743c81505d1/u,
  );
  assert.match(status, /one allowed owner and zero groups/u);
  assert.match(status, /Awaiting owner smoke test/u);
  assert.match(
    status,
    /\*\*ICS file import — Not implemented — authorized cut\.\*\*/u,
  );
  assert.match(status, /849 passed/u);
  assert.match(status, /15 exact-artifact runs/u);
  assert.match(status, /Local production performance/u);
  assert.match(status, /Not run — no approved real published event/u);
  assert.match(status, /Implemented but not externally verified/u);

  const smokeSteps = [
    ...status.matchAll(/^(\d+)\. /gmu),
  ].map((match) => Number(match[1]));
  assert.deepEqual(
    smokeSteps.slice(-10),
    Array.from({ length: 10 }, (_, i) => i + 1),
  );

  for (const path of [
    "docs/architecture/0011-phase-7-imports-exports-forms.md",
    "docs/phase7-csv-field-guide.md",
    "docs/phase7-exports-calendar-backup.md",
    "docs/phase7-public-forms-submissions.md",
    "docs/phase7-local-testing.md",
    "docs/owner-guide-phase7.md",
    "docs/organizer-guide-phase7.md",
    "docs/known-limitations-phase7.md",
    "docs/architecture/0012-phase-8-hardening.md",
    "docs/phase8-local-testing.md",
    "docs/owner-guide-phase8.md",
    "docs/organizer-guide-phase8.md",
    "docs/known-limitations-phase8.md",
  ]) {
    assert.equal(existsSync(`${ROOT}/${path}`), true, path);
  }
  assert.match(
    readme,
    /https:\/\/vancouver-curiosity-club\.reza5777\.chatgpt\.site/u,
  );
  assert.match(readme, /docs\/architecture\//u);
  assert.match(readme, /BUILD_STATUS\.md/u);
  assert.match(readme, /OWNER_INPUTS\.md/u);
  assert.doesNotMatch(readme, /appg(?:dep|prj|ver)_/u);
  assert.doesNotMatch(readme, /Sites version \d+/u);
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
