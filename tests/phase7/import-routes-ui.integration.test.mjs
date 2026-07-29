import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CSV_IMPORT_CANONICAL_COLUMNS,
} from "../../lib/imports/csv.ts";
import {
  bootstrapInitialOwner,
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import {
  PHASE7_INVARIANT_TRIGGER_STATEMENTS,
} from "../../lib/server/database/phase7-invariant-sql.ts";
import {
  approveCsvImportBatch,
} from "../../lib/server/phase7/imports.ts";
import {
  parseCsvImportWorkspace,
} from "../../app/_organizer/csv-import-dto.ts";
import {
  readCsvImportMultipart,
} from "../../app/api/organizer/imports/_multipart.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const ROOT = process.cwd();
const TEST_RUNTIME = {};
const TEST_HEADERS = {};
globalThis.__VCC_PHASE7_IMPORT_ROUTE_ENV__ = TEST_RUNTIME;
globalThis.__VCC_PHASE7_IMPORT_ROUTE_HEADERS__ = TEST_HEADERS;
const cssShim = dataModule(
  "const styles = new Proxy({}, { get: (_target, key) => String(key) }); export default styles;",
);
const workersShim = dataModule(
  "export const env = globalThis.__VCC_PHASE7_IMPORT_ROUTE_ENV__;",
);
const headersShim = dataModule(
  "export async function headers() { return new Headers(globalThis.__VCC_PHASE7_IMPORT_ROUTE_HEADERS__); }",
);
nodeModule.registerHooks?.({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith(".module.css")) {
      return { shortCircuit: true, url: cssShim };
    }
    if (specifier === "cloudflare:workers") {
      return { shortCircuit: true, url: workersShim };
    }
    if (specifier === "next/headers") {
      return { shortCircuit: true, url: headersShim };
    }
    if (specifier === "server-only") {
      return { shortCircuit: true, url: dataModule("export {};") };
    }
    return nextResolve(specifier, context);
  },
});
const { CsvImportBatchWorkspace } = await import(
  "../../app/_organizer/CsvImportBatchWorkspace.tsx?phase7-import-ui"
);
const [
  importsRoute,
  inspectRoute,
  detailRoute,
  approvalRoute,
  redactionRoute,
] =
await Promise.all([
  import("../../app/api/organizer/imports/route.ts?phase7-import-route"),
  import(
    "../../app/api/organizer/imports/inspect/route.ts?phase7-import-route"
  ),
  import("../../app/api/organizer/imports/[id]/route.ts?phase7-import-route"),
  import(
    "../../app/api/organizer/imports/[id]/approve/route.ts?phase7-import-route"
  ),
  import(
    "../../app/api/organizer/imports/[id]/redact/route.ts?phase7-import-route"
  ),
]);

test("CSV import DTO parser returns only the exact bounded allowlist", () => {
  const parsed = parseCsvImportWorkspace(workspace());
  assert.equal(parsed.batch.batchId, "import-batch:test");
  assert.equal(parsed.rows.length, 4);
  assert.equal(parsed.mappingDecisions[0].sourceHeader, "title");
  assert.deepEqual(parsed.rowPage, {
    hasMore: false,
    nextCursor: null,
    total: 4,
  });
  assert.deepEqual(Object.keys(parsed.batch).sort(), [
    "actorDisplayName",
    "actorProfileId",
    "applicationCursor",
    "approvedAt",
    "batchId",
    "completedAt",
    "createdAt",
    "failedRowCount",
    "fileSha256",
    "importedRowCount",
    "invalidRowCount",
    "mappingFingerprint",
    "outcomeCode",
    "parserVersion",
    "pendingRowCount",
    "phase",
    "redactionEligible",
    "redactionEligibleAt",
    "selectedRowCount",
    "skippedRowCount",
    "sourceLabel",
    "sourceNamespace",
    "sourcePayloadRedactedAt",
    "startedAt",
    "templateVersion",
    "totalRowCount",
    "validRowCount",
    "version",
    "warningRowCount",
  ]);
  assert.equal("privateSentinel" in parsed.batch, false);
  assert.equal(
    parseCsvImportWorkspace({
      ...workspace(),
      batch: { ...workspace().batch, phase: "uploaded", version: 1 },
      previewFingerprint: null,
      previewVersion: 0,
      rowPage: { hasMore: false, nextCursor: null, total: 0 },
      rows: [],
    }).previewVersion,
    0,
  );

  assert.throws(
    () =>
      parseCsvImportWorkspace({
        ...workspace(),
        batch: { ...workspace().batch, version: "2" },
      }),
    /Unexpected CSV import response/u,
  );
  assert.throws(
    () =>
      parseCsvImportWorkspace({
        ...workspace(),
        batch: { ...workspace().batch, fileSha256: "not-a-hash" },
      }),
    /Unexpected CSV import response/u,
  );
  assert.throws(
    () =>
      parseCsvImportWorkspace({
        ...workspace(),
        rows: [{ ...workspace().rows[0], normalized: ["not", "an", "object"] }],
      }),
    /Unexpected CSV import response/u,
  );
});

test("multipart inspection requires same-origin provenance and rejects malformed mapping", async () => {
  const missingOrigin = await csvRequest({
    mapping: JSON.stringify(["title"]),
    withOrigin: false,
  });
  await assert.rejects(
    () => readCsvImportMultipart(missingOrigin, { requireMapping: true }),
    (error) =>
      error?.code === "authorization_denied" &&
      error?.status === 403,
  );

  const malformed = await csvRequest({
    mapping: JSON.stringify(["title", "forged_private_field"]),
    withOrigin: true,
  });
  await assert.rejects(
    () => readCsvImportMultipart(malformed, { requireMapping: true }),
    (error) => error?.name === "InputValidationError",
  );

  const valid = await readCsvImportMultipart(
    await csvRequest({
      mapping: JSON.stringify(["title", "club"]),
      withOrigin: true,
    }),
    { requireMapping: true },
  );
  assert.deepEqual(valid.headerSelections, ["title", "club"]);
  assert.equal(valid.sourceNamespace, "route-test");
  assert.equal(valid.file.name, "events.csv");

  const extra = await csvRequest({
    mapping: JSON.stringify(["title", "club"]),
    withOrigin: true,
  });
  const extraForm = await extra.clone().formData();
  extraForm.set("forgedOrganizationId", "org-other");
  const extraRequest = await requestFromFormData(extraForm, true);
  await assert.rejects(
    () =>
      readCsvImportMultipart(
        extraRequest,
        { requireMapping: true },
      ),
    (error) => error?.name === "InputValidationError",
  );

  const mismatchedLength = await csvRequest({
    mapping: JSON.stringify(["title", "club"]),
    withOrigin: true,
    contentLength: "1",
  });
  await assert.rejects(
    () =>
      readCsvImportMultipart(mismatchedLength, { requireMapping: true }),
    (error) => error?.name === "InputValidationError",
  );

  const tooLarge = oversizedStreamedUpload();
  await assert.rejects(
    () => readCsvImportMultipart(tooLarge, { requireMapping: true }),
    (error) => error?.name === "InputValidationError",
  );
});

test("all import HTTP routes pin Owner/Administrator authorization and server-scoped IDs", () => {
  const routes = [
    ["app/api/organizer/imports/route.ts", "createCsvImportPreview"],
    [
      "app/api/organizer/imports/inspect/route.ts",
      "inspectCsvImportUpload",
    ],
    ["app/api/organizer/imports/[id]/route.ts", "getCsvImportBatch"],
    [
      "app/api/organizer/imports/[id]/approve/route.ts",
      "approveCsvImportBatch",
    ],
    [
      "app/api/organizer/imports/[id]/apply-next/route.ts",
      "applyNextCsvImportRow",
    ],
    [
      "app/api/organizer/imports/[id]/redact/route.ts",
      "redactCsvImportSourcePayload",
    ],
  ];
  for (const [path, service] of routes) {
    const value = source(path);
    assert.match(value, new RegExp(`\\b${service}\\b`, "u"), path);
    assert.doesNotMatch(value, /console\.(?:log|info|warn|error)/u, path);
    assert.doesNotMatch(value, /organizationId\s*:/u, path);
    assert.match(value, /noReferrer:\s*true/u, path);
  }
  for (const path of [
    "app/api/organizer/imports/route.ts",
    "app/api/organizer/imports/inspect/route.ts",
    "app/api/organizer/imports/[id]/route.ts",
    "app/api/organizer/imports/[id]/approve/route.ts",
    "app/api/organizer/imports/[id]/apply-next/route.ts",
  ]) {
    assert.match(
      source(path),
      /requireOrganizerApiActor\(\[\s*"owner",\s*"administrator",?\s*\]\)/u,
      path,
    );
  }
  assert.match(
    source("app/api/organizer/imports/[id]/redact/route.ts"),
    /requireOrganizerApiActor\(\["owner"\]\)/u,
  );
  assert.match(
    source("app/api/organizer/imports/[id]/approve/route.ts"),
    /approveCsvImportBatch\(\s*database,\s*identity,\s*id,\s*input,/u,
  );
  assert.match(
    source("app/api/organizer/imports/[id]/apply-next/route.ts"),
    /body\.expectedVersion/u,
  );
});

test("real import routes deny Organizer, hide cross-org IDs, reject stale approval, and stay bounded", async (t) => {
  const database = new SqliteD1TestDatabase(migrations());
  t.after(() => database.close());
  const ownerEmail = "phase7-import-route-owner@vcc-tests.invalid";
  const identity = trustedIdentityFromSites({
    displayName: "Import Route Owner",
    email: ownerEmail,
  });
  assert.equal(
    await bootstrapInitialOwner(database, identity, ownerEmail, 100),
    true,
  );
  const owner = await database
    .prepare(
      `SELECT membership.organization_id, membership.profile_id
       FROM organization_memberships AS membership
       JOIN profiles AS profile ON profile.id = membership.profile_id
       WHERE profile.normalized_email = ?
       LIMIT 1`,
    )
    .bind(ownerEmail)
    .first();
  seedRouteBatches(database, owner);
  for (const statement of PHASE7_INVARIANT_TRIGGER_STATEMENTS) {
    database.exec(statement);
  }
  TEST_RUNTIME.DB = database;
  TEST_RUNTIME.INITIAL_OWNER_EMAIL = ownerEmail;
  setIdentity(ownerEmail);

  await assert.rejects(
    approveCsvImportBatch(
      database,
      identity,
      "import-batch:owner",
      {
        decisions: [],
        expectedVersion: 999,
        previewFingerprint: "b".repeat(64),
      },
    ),
    (error) => error?.code === "stale_edit" && error?.status === 409,
  );

  const counted = countedDatabase(database);
  TEST_RUNTIME.DB = counted.database;
  const list = await importsRoute.GET(
    new Request("https://imports.example/api/organizer/imports?limit=1"),
  );
  assert.equal(list.status, 200);
  const historyResponse = await list.json();
  assert.equal(historyResponse.history.items.length, 1);
  assert.equal(historyResponse.history.total, 2);
  assert.equal(historyResponse.history.hasMore, true);
  assert.equal(typeof historyResponse.history.nextCursor, "string");
  assert.equal(counted.count(), 5);

  counted.reset();
  const older = await importsRoute.GET(
    new Request(
      `https://imports.example/api/organizer/imports?limit=1&cursor=${encodeURIComponent(historyResponse.history.nextCursor)}`,
    ),
  );
  assert.equal(older.status, 200);
  const olderHistory = (await older.json()).history;
  assert.equal(olderHistory.items.length, 1);
  assert.equal(olderHistory.items[0].batchId, "import-batch:owner-old");
  assert.equal(olderHistory.total, 2);
  assert.equal(olderHistory.hasMore, false);
  assert.equal(olderHistory.nextCursor, null);
  assert.equal(counted.count(), 5);

  counted.reset();
  const filtered = await importsRoute.GET(
    new Request(
      "https://imports.example/api/organizer/imports?sourceNamespace=route-owner-old",
    ),
  );
  assert.equal(filtered.status, 200);
  const filteredHistory = (await filtered.json()).history;
  assert.equal(filteredHistory.total, 1);
  assert.equal(filteredHistory.items[0].batchId, "import-batch:owner-old");
  assert.equal(counted.count(), 5);

  counted.reset();
  const detail = await detailRoute.GET(
    new Request(
      "https://imports.example/api/organizer/imports/import-batch:owner",
    ),
    routeContext("import-batch:owner"),
  );
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.equal(
    parseCsvImportWorkspace(detailBody.batch).conflictPolicyMode,
    "warn_reason",
  );
  assert.equal(counted.count(), 5);

  counted.reset();
  const crossOrg = await detailRoute.GET(
    new Request("https://imports.example/api/organizer/imports/import-batch:other"),
    routeContext("import-batch:other"),
  );
  assert.equal(crossOrg.status, 404);
  assert.equal(counted.count(), 3);
  assert.doesNotMatch(await crossOrg.text(), /Other organization/iu);

  counted.reset();
  const stale = await approvalRoute.POST(
    new Request(
      "https://imports.example/api/organizer/imports/import-batch:owner/approve",
      {
        body: JSON.stringify({
          decisions: [],
          expectedVersion: 999,
          previewFingerprint: "b".repeat(64),
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://imports.example",
        },
        method: "POST",
      },
    ),
    routeContext("import-batch:owner"),
  );
  assert.equal(stale.status, 409);
  assert.equal(counted.count(), 5);
  assert.deepEqual(await stale.json(), {
    error: {
      code: "stale_edit",
      message: "The import changed. Refresh its durable preview before continuing.",
    },
  });

  counted.reset();
  const nonterminalRedaction = await redactionRoute.POST(
    new Request(
      "https://imports.example/api/organizer/imports/import-batch:owner/redact",
      {
        body: JSON.stringify({ expectedVersion: 2 }),
        headers: {
          "content-type": "application/json",
          origin: "https://imports.example",
        },
        method: "POST",
      },
    ),
    routeContext("import-batch:owner"),
  );
  assert.equal(nonterminalRedaction.status, 409);
  assert.equal(
    await countWhere(
      database,
      "audit_logs",
      "entity_id = ? AND action = 'import.source_payload_redacted'",
      "import-batch:owner",
    ),
    0,
  );

  counted.reset();
  const malformed = await csvRequest({
    mapping: JSON.stringify(["forged_private_field", "club"]),
    withOrigin: true,
  });
  const malformedResponse = await importsRoute.POST(malformed);
  assert.equal(malformedResponse.status, 422);
  assert.equal(counted.count(), 1);

  setIdentity("phase7-import-route-organizer@vcc-tests.invalid");
  counted.reset();
  const denied = await importsRoute.GET();
  assert.equal(denied.status, 403);
  assert.equal(counted.count(), 1);
  assert.deepEqual(await denied.json(), {
    error: {
      code: "authorization_denied",
      message:
        "This ChatGPT identity does not have access to the organizer portal.",
    },
  });
  const deniedRedaction = await redactionRoute.POST(
    new Request(
      "https://imports.example/api/organizer/imports/import-batch:owner/redact",
      {
        body: JSON.stringify({ expectedVersion: 2 }),
        headers: {
          "content-type": "application/json",
          origin: "https://imports.example",
        },
        method: "POST",
      },
    ),
    routeContext("import-batch:owner"),
  );
  assert.equal(deniedRedaction.status, 403);

  setIdentity(ownerEmail);
  const batchesBeforeInspection = await countWhere(
    database,
    "import_batches",
    "organization_id = ? AND source_label = 'Route inspection'",
    owner.organization_id,
  );
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    counted.reset();
    const inspected = await inspectRoute.POST(
      await inspectionRequest(`route-inspection-${attempt}`),
    );
    assert.equal(inspected.status, 200);
    const inspectedBody = await inspected.json();
    assert.match(inspectedBody.inspectionBatchId, /^import-batch:/u);
    assert.equal(inspectedBody.nonblankRowCount, 1);
    assert.equal(
      inspectedBody.headers.length,
      CSV_IMPORT_CANONICAL_COLUMNS.length,
    );
    assert.equal(
      inspectedBody.selections.length,
      CSV_IMPORT_CANONICAL_COLUMNS.length,
    );
    assert.match(inspectedBody.fileSha256, /^[0-9a-f]{64}$/u);
    assert.equal(counted.count(), 8);
  }
  assert.equal(
    await countWhere(
      database,
      "import_batches",
      "organization_id = ? AND source_label = 'Route inspection'",
      owner.organization_id,
    ),
    batchesBeforeInspection + 5,
  );
  assert.equal(
    await countWhere(
      database,
      "import_batch_details",
      "organization_id = ? AND phase = 'uploaded' AND total_row_count = 0",
      owner.organization_id,
    ),
    5,
  );
  assert.equal(
    await countWhere(
      database,
      "audit_logs",
      "organization_id = ? AND action = 'import.batch_created'",
      owner.organization_id,
    ),
    5,
  );
  const rateRows = await database
    .prepare(
      `SELECT action, request_count
       FROM organizer_rate_limits
       WHERE organization_id = ?
         AND profile_id = ?
         AND action IN ('csv_import_preview_15m', 'csv_import_batch_day')
       ORDER BY action`,
    )
    .bind(owner.organization_id, owner.profile_id)
    .all();
  assert.deepEqual(
    rateRows.results.map((row) => [row.action, row.request_count]),
    [
      ["csv_import_batch_day", 5],
      ["csv_import_preview_15m", 5],
    ],
  );
  counted.reset();
  const limited = await inspectRoute.POST(
    await inspectionRequest("route-inspection-limited"),
  );
  assert.equal(limited.status, 429);
  assert.equal(counted.count(), 5);
  assert.equal(
    await countWhere(
      database,
      "import_batches",
      "organization_id = ? AND source_label = 'Route inspection'",
      owner.organization_id,
    ),
    batchesBeforeInspection + 5,
  );

  setIdentity("phase7-import-route-organizer@vcc-tests.invalid");
  counted.reset();
  const deniedInspection = await inspectRoute.POST(
    await inspectionRequest("route-inspection-denied"),
  );
  assert.equal(deniedInspection.status, 403);
  assert.equal(counted.count(), 1);
});

test("import workspace renders explicit decisions, mobile row details, results, and no ICS control", () => {
  const html = renderToStaticMarkup(
    React.createElement(CsvImportBatchWorkspace, {
      initialBatch: workspace(),
      role: "owner",
    }),
  );
  assert.match(html, /Persisted batch state/u);
  assert.match(html, /Preview is non-authoritative/u);
  assert.match(html, /No event exists before explicit approval/u);
  assert.match(html, /Approve decisions/u);
  assert.match(html, /Create Separate Event/u);
  assert.match(html, /Duplicate match details \(1\)/u);
  assert.ok(count(html, /<details/gu) >= 4);
  assert.ok(count(html, /<table/gu) === 1);
  assert.doesNotMatch(html, /ICS import|import ICS/iu);

  const component = source(
    "app/_organizer/CsvImportBatchWorkspace.tsx",
  );
  assert.match(component, /Each request applies at most one persisted row/u);
  assert.match(component, /expectedVersion:\s*batch\.version/u);
  assert.match(component, /previewFingerprint:\s*workspace\.previewFingerprint/u);
  assert.match(component, /parseCsvImportWorkspace/u);
  assert.match(component, /Required duplicate reason/u);
  assert.match(component, /Required conflict reason/u);
  assert.match(component, /aria-describedby/u);
  assert.match(component, /aria-invalid/u);
  assert.match(component, /details\.open = true/u);
  assert.match(component, /duplicateDetailsHasMore/u);
  assert.match(component, /Showing \{row\.duplicateDetails\.length\} of/u);
  assert.match(component, /Load more rows/u);
  assert.match(component, /Uploaded-header mapping/u);
  assert.match(
    component,
    /statusHeadingRef\.current\?\.focus\(\)/u,
  );
  assert.match(
    component,
    /ref=\{statusHeadingRef\}[\s\S]*tabIndex=\{-1\}/u,
  );
  assert.match(component, /Eligibility date:/u);
  assert.match(
    component,
    /redactionConfirmation !== batch\.batchId/u,
  );
  const css = source("app/_organizer/imports.module.css");
  assert.match(
    css,
    /@media \(max-width: 52rem\)[\s\S]*\.tableScroll\s*\{\s*display: none;[\s\S]*\.rowDetails\s*\{\s*display: block;/u,
  );
  assert.match(css, /overflow-wrap: anywhere/u);
});

test("organizer import navigation targets real pages and exposes no ICS-import route", () => {
  for (const path of [
    "app/organizer/imports/page.tsx",
    "app/organizer/imports/new/page.tsx",
    "app/organizer/imports/[id]/page.tsx",
  ]) {
    assert.equal(existsSync(join(ROOT, path)), true, path);
    assert.match(
      source(path),
      /membership\.role === "organizer"\) forbidden\(\)/u,
      path,
    );
  }
  const shell = source("app/_organizer/WorkspaceShell.tsx");
  assert.match(shell, /\{ href: "\/organizer\/imports", label: "Imports" \}/u);
  assert.equal(
    existsSync(join(ROOT, "app/organizer/imports/ics")),
    false,
  );
  assert.doesNotMatch(
    [
      shell,
      source("app/organizer/imports/page.tsx"),
      source("app/organizer/imports/new/page.tsx"),
      source("app/_organizer/CsvImportUploadWorkspace.tsx"),
    ].join("\n"),
    /\/organizer\/imports\/ics|ICS file upload|Import ICS/iu,
  );
});

function workspace() {
  const rows = [
    previewRow({
      id: "row:valid",
      normalized: {
        clubId: "club:vcc",
        planningStatus: "draft",
        publicationStatus: "private",
        title: "Valid private draft",
      },
      result: "valid",
      row: 2,
    }),
    previewRow({
      errors: ["invalid_schedule"],
      id: "row:invalid",
      normalized: null,
      result: "invalid",
      row: 3,
    }),
    previewRow({
      errors: ["hard_duplicate_external_id"],
      id: "row:duplicate",
      normalized: { title: "Existing private event" },
      result: "hard_duplicate",
      row: 4,
    }),
    previewRow({
      id: "row:warning",
      normalized: { title: "Possible duplicate and conflict" },
      result: "warning",
      row: 5,
      warnings: [
        "semantic_duplicate_warning",
        "existing_schedule_conflict",
      ],
    }),
  ];
  return {
    batch: {
      actorDisplayName: "Import Route Owner",
      actorProfileId: "profile:owner",
      applicationCursor: 0,
      approvedAt: null,
      batchId: "import-batch:test",
      completedAt: null,
      createdAt: 1_700_000_000_000,
      failedRowCount: 0,
      fileSha256: "a".repeat(64),
      importedRowCount: 0,
      invalidRowCount: 1,
      mappingFingerprint: "c".repeat(64),
      outcomeCode: null,
      parserVersion: 1,
      pendingRowCount: 0,
      phase: "previewed",
      privateSentinel: "must not survive DTO parsing",
      redactionEligible: false,
      redactionEligibleAt: 1_707_776_000_000,
      selectedRowCount: 0,
      skippedRowCount: 0,
      sourceLabel: "Smoke preview",
      sourceNamespace: "smoke-preview",
      sourcePayloadRedactedAt: null,
      startedAt: null,
      templateVersion: 1,
      totalRowCount: 4,
      validRowCount: 3,
      version: 2,
      warningRowCount: 1,
    },
    conflictPolicyMode: "warn_reason",
    mappingDecisions: [
      { canonicalField: "title", sourceHeader: "title" },
      { canonicalField: "club", sourceHeader: "club" },
    ],
    previewFingerprint: "b".repeat(64),
    previewVersion: 1,
    rowPage: {
      hasMore: false,
      nextCursor: null,
      total: 4,
    },
    rows,
  };
}

function previewRow({
  errors = [],
  id,
  normalized,
  result,
  row,
  warnings = [],
}) {
  return {
    applicationState: "previewed",
    approvalAction: "pending",
    canSelect: result !== "invalid" && result !== "hard_duplicate",
    conflictDetails: warnings.includes("existing_schedule_conflict")
      ? [
          {
            endsAtUtc: 1_700_007_200_000,
            planningStatus: "confirmed",
            referenceId: "event:existing",
            source: "existing_organizer",
            sourceRowNumber: null,
            startsAtUtc: 1_700_003_600_000,
            title: "Existing event",
          },
        ]
      : [],
    conflictDetailsHasMore: false,
    conflictDetailsTotal: warnings.includes(
      "existing_schedule_conflict",
    )
      ? 1
      : 0,
    defaultsApplied: ["timezone_America_Vancouver"],
    duplicateDetails:
      result === "hard_duplicate"
        ? [{
            code: "hard_duplicate_source",
            referenceId: "event:existing",
            source: "existing_event",
            sourceRowNumber: null,
            title: "Existing event",
          }]
        : [],
    duplicateDetailsHasMore: false,
    duplicateDetailsTotal: result === "hard_duplicate" ? 1 : 0,
    errorCodes: errors,
    mappingFields: ["title", "club"],
    matchSummary: {
      category: null,
      club: "Vancouver Curiosity Club",
      coOrganizers: [],
      lane: null,
      primaryOrganizer: "Import Route Owner",
      program: null,
      venue: null,
    },
    normalized,
    previewResultCode: result,
    resultCode: null,
    rowId: id,
    sourceRowNumber: row,
    targetEventId: null,
    warningCodes: warnings,
  };
}

async function csvRequest({ contentLength, mapping, withOrigin }) {
  const form = new FormData();
  form.set(
    "file",
    new File(
      [
        "title,club\r\nPrivate draft,Vancouver Curiosity Club\r\n",
      ],
      "events.csv",
      { type: "text/csv" },
    ),
  );
  form.set("headerSelections", mapping);
  form.set("inspectionBatchId", "import-batch:inspection");
  form.set("sourceNamespace", "route-test");
  const request = await requestFromFormData(form, withOrigin);
  if (!contentLength) return request;
  return new Request(request.url, {
    body: await request.arrayBuffer(),
    headers: {
      ...Object.fromEntries(request.headers),
      "content-length": contentLength,
    },
    method: "POST",
  });
}

async function inspectionRequest(sourceNamespace) {
  const form = new FormData();
  form.set(
    "file",
    new File(
      [
        `${CSV_IMPORT_CANONICAL_COLUMNS.join(",")}\r\n`,
        `Private draft${",".repeat(
          CSV_IMPORT_CANONICAL_COLUMNS.length - 1,
        )}\r\n`,
      ],
      "events.csv",
      { type: "text/csv" },
    ),
  );
  form.set("sourceLabel", "Route inspection");
  form.set("sourceNamespace", sourceNamespace);
  return requestFromFormData(
    form,
    true,
    "https://imports.example/api/organizer/imports/inspect",
  );
}

async function requestFromFormData(
  form,
  withOrigin,
  url = "https://imports.example/api/organizer/imports",
) {
  const initial = new Request(
    url,
    {
      body: form,
      method: "POST",
    },
  );
  const bytes = new Uint8Array(await initial.arrayBuffer());
  const headers = withOrigin
    ? {
        origin: "https://imports.example",
        "sec-fetch-site": "same-origin",
      }
    : {};
  headers["content-length"] = String(bytes.byteLength);
  headers["content-type"] = initial.headers.get("content-type");
  return new Request(url, {
    body: bytes,
    headers,
    method: "POST",
  });
}

function oversizedStreamedUpload() {
  let emitted = false;
  const bytes = new Uint8Array(2 * 1024 * 1024 + 256 * 1024 + 1);
  const body = new ReadableStream({
    pull(controller) {
      if (emitted) {
        controller.close();
        return;
      }
      emitted = true;
      controller.enqueue(bytes);
    },
  });
  return new Request("https://imports.example/api/organizer/imports", {
    body,
    duplex: "half",
    headers: {
      "content-type": "multipart/form-data; boundary=bounded-test",
      "content-length": String(2 * 1024 * 1024 + 256 * 1024),
      origin: "https://imports.example",
      "sec-fetch-site": "same-origin",
    },
    method: "POST",
  });
}

function source(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function count(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

async function countWhere(database, table, where, ...bindings) {
  const row = await database
    .prepare(`SELECT count(*) AS exact_count FROM ${table} WHERE ${where}`)
    .bind(...bindings)
    .first();
  return Number(row.exact_count);
}

function dataModule(value) {
  return `data:text/javascript,${encodeURIComponent(value)}`;
}

function migrations() {
  return readdirSync(join(ROOT, "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) => readFileSync(join(ROOT, "drizzle", name), "utf8"))
    .join("\n");
}

function seedRouteBatches(database, owner) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile:route-organizer',
      'email:phase7-import-route-organizer@vcc-tests.invalid',
      'phase7-import-route-organizer@vcc-tests.invalid',
      'Route Organizer', 'active', 100, 100
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership:route-organizer', '${owner.organization_id}',
      'profile:route-organizer',
      'phase7-import-route-organizer@vcc-tests.invalid',
      'organizer', 'active', '${owner.profile_id}', 100, 100
    );
    INSERT INTO organizations (
      id, name, slug, timezone, created_at, updated_at
    ) VALUES (
      'org:other', 'Other organization', 'other-organization',
      'America/Vancouver', 100, 100
    );
    INSERT INTO organizer_conflict_policies (
      id, organization_id, mode, policy_version, default_hold_hours,
      nearing_expiry_hours, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'conflict-policy:route-owner', '${owner.organization_id}',
      'warn_reason', 1, 72, 24, '${owner.profile_id}', 100, 100
    );
    INSERT INTO import_batches (
      id, organization_id, source_type, source_label, status,
      created_by_profile_id, created_at, completed_at
    ) VALUES
      (
        'import-batch:owner', '${owner.organization_id}', 'csv',
        'Owner batch', 'pending', '${owner.profile_id}', 100, NULL
      ),
      (
        'import-batch:owner-old', '${owner.organization_id}', 'csv',
        'Older Owner batch', 'pending', '${owner.profile_id}', 90, NULL
      ),
      (
        'import-batch:other', 'org:other', 'csv',
        'Other organization secret batch', 'pending',
        '${owner.profile_id}', 100, NULL
      );
    INSERT INTO import_batch_details (
      import_batch_id, organization_id, file_sha256, source_namespace,
      template_version, parser_version, encoding, delimiter,
      column_mapping_json, mapping_fingerprint, preview_fingerprint,
      preview_version, total_row_count, valid_row_count,
      invalid_row_count, warning_row_count, selected_row_count,
      imported_row_count, skipped_row_count, failed_row_count,
      pending_row_count, phase, application_cursor, version,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'import-batch:owner', '${owner.organization_id}', '${"a".repeat(64)}',
      'route-owner', 1, 1, 'utf-8', ',', '{}', '${"c".repeat(64)}',
      '${"b".repeat(64)}', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      'previewed', 0, 2, '${owner.profile_id}', 100, 100
    ), (
      'import-batch:owner-old', '${owner.organization_id}',
      '${"d".repeat(64)}', 'route-owner-old', 1, 1, 'utf-8', ',',
      '{}', '${"e".repeat(64)}', '${"f".repeat(64)}', 1,
      0, 0, 0, 0, 0, 0, 0, 0, 0,
      'previewed', 0, 2, '${owner.profile_id}', 90, 90
    );
  `);
}

function setIdentity(email) {
  for (const key of Object.keys(TEST_HEADERS)) delete TEST_HEADERS[key];
  TEST_HEADERS["oai-authenticated-user-email"] = email;
}

function routeContext(id) {
  return { params: Promise.resolve({ id }) };
}

function countedDatabase(database) {
  const rawStatement = Symbol("rawStatement");
  let statements = 0;
  return {
    count: () => statements,
    database: {
      batch(items) {
        statements += items.length;
        const rawItems = items.map((item) => item[rawStatement] ?? item);
        if (
          rawItems.every((item) =>
            item.sql.trimStart().toUpperCase().startsWith("SELECT")
          )
        ) {
          return Promise.all(rawItems.map((item) => item.all()));
        }
        return database.batch(rawItems);
      },
      exec(sql) {
        return database.exec(sql);
      },
      prepare(sql) {
        const prepared = database.prepare(sql);
        return wrapPrepared(prepared);
      },
    },
    reset: () => {
      statements = 0;
    },
  };

  function wrapPrepared(prepared) {
    return {
      [rawStatement]: prepared,
      bind(...values) {
        return wrapPrepared(prepared.bind(...values));
      },
      first(...args) {
        statements += 1;
        return prepared.first(...args);
      },
      all(...args) {
        statements += 1;
        return prepared.all(...args);
      },
      run(...args) {
        statements += 1;
        return prepared.run(...args);
      },
    };
  }
}
