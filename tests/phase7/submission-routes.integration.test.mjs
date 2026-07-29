import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import test from "node:test";
import {
  bootstrapInitialOwner,
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import {
  ensureDatabaseInvariants,
} from "../../lib/server/database/invariants.ts";
import {
  runRequestMaintenance,
} from "../../lib/server/database/request-maintenance.ts";
import {
  PHASE7_INVARIANT_COUNT_SQL,
  PHASE7_INVARIANT_TRIGGER_STATEMENTS,
} from "../../lib/server/database/phase7-invariant-sql.ts";
import { submitPublicForm } from "../../lib/server/phase7/public-forms.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";
import {
  ensureDatabaseInvariantsReady,
} from "../database/invariant-ready.mjs";

const ORIGIN = "https://submissions.example";
const OWNER_EMAIL = "submissions-owner@vcc-tests.invalid";
const ADMIN_EMAIL = "submissions-admin@vcc-tests.invalid";
const ORGANIZER_A_EMAIL = "submissions-organizer-a@vcc-tests.invalid";
const ORGANIZER_B_EMAIL = "submissions-organizer-b@vcc-tests.invalid";
const OTHER_OWNER_EMAIL = "submissions-other-owner@vcc-tests.invalid";
const VISITOR_EMAIL = "private-visitor@vcc-tests.invalid";
const VISITOR_MESSAGE =
  "Please keep this message private while reviewing accessibility.";
const VISITOR_NAME = "Private Submission Visitor";
const OWNER_NOTE = "Owner-only private note sentinel.";
const ADMIN_NOTE = "Administrator-only private note sentinel.";
const ORGANIZER_NOTE = "Assigned-organizer private note sentinel.";
const ROUTE_ENVIRONMENT = {};
const ROUTE_HEADERS = {};

globalThis.__VCC_PHASE7_SUBMISSION_ROUTE_ENV__ = ROUTE_ENVIRONMENT;
globalThis.__VCC_PHASE7_SUBMISSION_ROUTE_HEADERS__ = ROUTE_HEADERS;

nodeModule.registerHooks?.({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export const env = globalThis.__VCC_PHASE7_SUBMISSION_ROUTE_ENV__;",
        ),
      };
    }
    if (specifier === "next/headers") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export async function headers() { return new Headers(globalThis.__VCC_PHASE7_SUBMISSION_ROUTE_HEADERS__); }",
        ),
      };
    }
    if (specifier === "server-only") {
      return { shortCircuit: true, url: dataModule("export {};") };
    }
    return nextResolve(specifier, context);
  },
});

const [
  collectionRoute,
  detailRoute,
  assignmentRoute,
  statusRoute,
  notesRoute,
  redactRoute,
] = await Promise.all([
  import("../../app/api/organizer/submissions/route.ts?phase7-submission-route"),
  import(
    "../../app/api/organizer/submissions/[id]/route.ts?phase7-submission-route"
  ),
  import(
    "../../app/api/organizer/submissions/[id]/assignment/route.ts?phase7-submission-route"
  ),
  import(
    "../../app/api/organizer/submissions/[id]/status/route.ts?phase7-submission-route"
  ),
  import(
    "../../app/api/organizer/submissions/[id]/notes/route.ts?phase7-submission-route"
  ),
  import(
    "../../app/api/organizer/submissions/[id]/redact/route.ts?phase7-submission-route"
  ),
]);

test("submission routes enforce private role, assignment, redaction, and request-budget boundaries", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.database.close());
  ROUTE_ENVIRONMENT.DB = fixture.counted;
  ROUTE_ENVIRONMENT.INITIAL_OWNER_EMAIL = OWNER_EMAIL;
  const counts = {};

  const ownerList = await countedRequest(
    fixture,
    counts,
    "owner_list",
    OWNER_EMAIL,
    () =>
      collectionRoute.GET(
        new Request(
          `${ORIGIN}/api/organizer/submissions?from=${fixture.fromDate}&to=${fixture.toDate}`,
        ),
      ),
  );
  assert.equal(ownerList.response.status, 200);
  assert.equal(ownerList.body.page.totalCount, 1);
  assert.equal(ownerList.body.page.items.length, 1);
  assert.equal("fields" in ownerList.body.page.items[0], false);

  const adminList = await countedRequest(
    fixture,
    counts,
    "admin_list",
    ADMIN_EMAIL,
    () =>
      collectionRoute.GET(
        new Request(`${ORIGIN}/api/organizer/submissions`),
      ),
  );
  assert.equal(adminList.response.status, 200);
  assert.equal(adminList.body.page.totalCount, 1);

  const invalidDate = await countedRequest(
    fixture,
    counts,
    "invalid_date_filter",
    OWNER_EMAIL,
    () =>
      collectionRoute.GET(
        new Request(
          `${ORIGIN}/api/organizer/submissions?from=${fixture.fromDate}`,
        ),
      ),
  );
  assert.equal(invalidDate.response.status, 422);
  assert.equal(invalidDate.body.error.code, "validation_failed");

  const excessiveDate = await countedRequest(
    fixture,
    counts,
    "excessive_date_filter",
    OWNER_EMAIL,
    () =>
      collectionRoute.GET(
        new Request(
          `${ORIGIN}/api/organizer/submissions?from=2025-01-01&to=2026-12-31`,
        ),
      ),
  );
  assert.equal(excessiveDate.response.status, 422);

  const ownerDetail = await detailRequest(
    fixture,
    counts,
    "owner_detail",
    OWNER_EMAIL,
  );
  assert.equal(ownerDetail.response.status, 200);
  assert.equal(ownerDetail.body.submission.fields.replyEmail, VISITOR_EMAIL);
  const adminDetail = await detailRequest(
    fixture,
    counts,
    "admin_detail",
    ADMIN_EMAIL,
  );
  assert.equal(adminDetail.response.status, 200);

  const unassignedOrganizer = await detailRequest(
    fixture,
    counts,
    "unassigned_organizer_detail",
    ORGANIZER_A_EMAIL,
  );
  assert.equal(unassignedOrganizer.response.status, 404);
  assert.equal(unassignedOrganizer.body.error.code, "not_found");
  const unassignedOrganizerList = await countedRequest(
    fixture,
    counts,
    "unassigned_organizer_list",
    ORGANIZER_A_EMAIL,
    () =>
      collectionRoute.GET(
        new Request(
          `${ORIGIN}/api/organizer/submissions?from=${fixture.fromDate}&to=${fixture.toDate}&assignment=all`,
        ),
      ),
  );
  assert.equal(unassignedOrganizerList.response.status, 200);
  assert.equal(unassignedOrganizerList.body.page.totalCount, 0);

  let version = ownerDetail.body.submission.version;
  const ownerNote = await mutationRequest(
    fixture,
    counts,
    "owner_note",
    OWNER_EMAIL,
    notesRoute.POST,
    { body: OWNER_NOTE },
  );
  assert.equal(ownerNote.response.status, 201);
  assert.equal(ownerNote.body.submission.notes.at(-1).body, OWNER_NOTE);

  const adminNote = await mutationRequest(
    fixture,
    counts,
    "admin_note",
    ADMIN_EMAIL,
    notesRoute.POST,
    { body: ADMIN_NOTE },
  );
  assert.equal(adminNote.response.status, 201);
  assert.equal(adminNote.body.submission.notes.at(-1).body, ADMIN_NOTE);

  const ownerStatus = await mutationRequest(
    fixture,
    counts,
    "owner_status",
    OWNER_EMAIL,
    statusRoute.PATCH,
    { expectedVersion: version, status: "in_review" },
  );
  assert.equal(ownerStatus.response.status, 200);
  version = ownerStatus.body.submission.version;
  assert.equal(ownerStatus.body.submission.status, "in_review");

  const ownerAssignment = await mutationRequest(
    fixture,
    counts,
    "owner_assignment",
    OWNER_EMAIL,
    assignmentRoute.PATCH,
    {
      assigneeProfileId: fixture.organizerAProfileId,
      expectedVersion: version,
    },
  );
  assert.equal(ownerAssignment.response.status, 200);
  version = ownerAssignment.body.submission.version;
  assert.equal(
    ownerAssignment.body.submission.assignedTo.profileId,
    fixture.organizerAProfileId,
  );

  const assignedOrganizer = await detailRequest(
    fixture,
    counts,
    "assigned_organizer_detail",
    ORGANIZER_A_EMAIL,
  );
  assert.equal(assignedOrganizer.response.status, 200);
  const assignedOrganizerList = await countedRequest(
    fixture,
    counts,
    "assigned_organizer_list",
    ORGANIZER_A_EMAIL,
    () =>
      collectionRoute.GET(
        new Request(
          `${ORIGIN}/api/organizer/submissions?from=${fixture.fromDate}&to=${fixture.toDate}&assignment=unassigned`,
        ),
      ),
  );
  assert.equal(assignedOrganizerList.response.status, 200);
  assert.equal(assignedOrganizerList.body.page.totalCount, 1);

  const organizerNote = await mutationRequest(
    fixture,
    counts,
    "organizer_note",
    ORGANIZER_A_EMAIL,
    notesRoute.POST,
    { body: ORGANIZER_NOTE },
  );
  assert.equal(organizerNote.response.status, 201);
  assert.equal(
    organizerNote.body.submission.notes.at(-1).body,
    ORGANIZER_NOTE,
  );

  const organizerStatus = await mutationRequest(
    fixture,
    counts,
    "organizer_status",
    ORGANIZER_A_EMAIL,
    statusRoute.PATCH,
    { expectedVersion: version, status: "responded" },
  );
  assert.equal(organizerStatus.response.status, 200);
  version = organizerStatus.body.submission.version;
  assert.equal(organizerStatus.body.submission.status, "responded");

  const adminAssignment = await mutationRequest(
    fixture,
    counts,
    "admin_assignment",
    ADMIN_EMAIL,
    assignmentRoute.PATCH,
    {
      assigneeProfileId: fixture.organizerBProfileId,
      expectedVersion: version,
    },
  );
  assert.equal(adminAssignment.response.status, 200);
  version = adminAssignment.body.submission.version;
  assert.equal(
    adminAssignment.body.submission.assignedTo.profileId,
    fixture.organizerBProfileId,
  );

  const reassignedOrganizerDenied = await detailRequest(
    fixture,
    counts,
    "reassigned_organizer_denied",
    ORGANIZER_A_EMAIL,
  );
  assert.equal(reassignedOrganizerDenied.response.status, 404);
  const newAssigneeDetail = await detailRequest(
    fixture,
    counts,
    "new_assignee_detail",
    ORGANIZER_B_EMAIL,
  );
  assert.equal(newAssigneeDetail.response.status, 200);

  const adminStatus = await mutationRequest(
    fixture,
    counts,
    "admin_status",
    ADMIN_EMAIL,
    statusRoute.PATCH,
    { expectedVersion: version, status: "in_review" },
  );
  assert.equal(adminStatus.response.status, 200);
  version = adminStatus.body.submission.version;

  const adminRedactionDenied = await mutationRequest(
    fixture,
    counts,
    "admin_redaction_denied",
    ADMIN_EMAIL,
    redactRoute.POST,
    {
      confirmationReference: fixture.publicReference,
      expectedVersion: version,
    },
  );
  assert.equal(adminRedactionDenied.response.status, 403);
  const organizerRedactionDenied = await mutationRequest(
    fixture,
    counts,
    "organizer_redaction_denied",
    ORGANIZER_B_EMAIL,
    redactRoute.POST,
    {
      confirmationReference: fixture.publicReference,
      expectedVersion: version,
    },
  );
  assert.equal(organizerRedactionDenied.response.status, 403);

  await fixture.database
    .prepare(
      `UPDATE profiles
       SET status = 'suspended', updated_at = ?
       WHERE id = ?`,
    )
    .bind(Date.now(), fixture.organizerBProfileId)
    .run();
  const suspendedAssigneeDenied = await detailRequest(
    fixture,
    counts,
    "suspended_assignee_denied",
    ORGANIZER_B_EMAIL,
  );
  assert.equal(suspendedAssigneeDenied.response.status, 403);

  const ownerUnassign = await mutationRequest(
    fixture,
    counts,
    "owner_unassign",
    OWNER_EMAIL,
    assignmentRoute.PATCH,
    { assigneeProfileId: null, expectedVersion: version },
  );
  assert.equal(ownerUnassign.response.status, 200);
  version = ownerUnassign.body.submission.version;
  assert.equal(ownerUnassign.body.submission.assignedTo, null);

  const crossOrgDetail = await detailRequest(
    fixture,
    counts,
    "cross_org_detail",
    OTHER_OWNER_EMAIL,
  );
  assert.equal(crossOrgDetail.response.status, 404);
  const crossOrgList = await countedRequest(
    fixture,
    counts,
    "cross_org_list",
    OTHER_OWNER_EMAIL,
    () =>
      collectionRoute.GET(
        new Request(`${ORIGIN}/api/organizer/submissions?q=VCC-`),
      ),
  );
  assert.equal(crossOrgList.response.status, 200);
  assert.equal(crossOrgList.body.page.totalCount, 0);

  const ownerRedaction = await mutationRequest(
    fixture,
    counts,
    "owner_redaction",
    OWNER_EMAIL,
    redactRoute.POST,
    {
      confirmationReference: fixture.publicReference,
      expectedVersion: version,
    },
  );
  assert.equal(ownerRedaction.response.status, 200);
  assert.deepEqual(ownerRedaction.body.submission.fields, {
    redacted: true,
  });
  assert.equal(ownerRedaction.body.submission.notes.length, 3);
  for (const note of ownerRedaction.body.submission.notes) {
    assert.equal(note.body, "[redacted]");
    assert.equal(note.redacted, true);
  }

  const postRedaction = await detailRequest(
    fixture,
    counts,
    "post_redaction_detail",
    ADMIN_EMAIL,
  );
  assert.equal(postRedaction.response.status, 200);
  assert.deepEqual(postRedaction.body.submission.fields, {
    redacted: true,
  });
  assert.deepEqual(
    postRedaction.body.submission.notes.map((note) => note.body),
    ["[redacted]", "[redacted]", "[redacted]"],
  );
  const staleRedaction = await mutationRequest(
    fixture,
    counts,
    "post_redaction_stale",
    OWNER_EMAIL,
    redactRoute.POST,
    {
      confirmationReference: fixture.publicReference,
      expectedVersion: version,
    },
  );
  assert.equal(staleRedaction.response.status, 409);
  const privateSentinels = [
    VISITOR_EMAIL,
    VISITOR_MESSAGE,
    VISITOR_NAME,
    OWNER_NOTE,
    ADMIN_NOTE,
    ORGANIZER_NOTE,
  ];
  const endpointText = JSON.stringify([
    ownerRedaction.body,
    postRedaction.body,
    staleRedaction.body,
  ]);
  const durableMetadataText = JSON.stringify(
    await fixture.database
      .prepare(
        `SELECT 'submission' AS source, 'payload' AS kind,
                payload_json AS payload
         FROM form_submissions
         WHERE organization_id = ?
           AND id = ?
         UNION ALL
         SELECT 'note' AS source, id AS kind, body_text AS payload
         FROM form_submission_notes
         WHERE organization_id = ?
           AND submission_id = ?
         UNION ALL
         SELECT 'intent' AS source, action AS kind,
                proposed_payload_json AS payload
         FROM form_submission_write_intents
         WHERE organization_id = ?
           AND submission_id = ?
         UNION ALL
         SELECT 'audit' AS source, action AS kind, metadata_json AS payload
         FROM audit_logs
         WHERE organization_id = ?
           AND entity_type = 'form_submission'
           AND entity_id = ?
         UNION ALL
         SELECT 'notification' AS source, type AS kind, payload_json AS payload
         FROM notifications
         WHERE organization_id = ?
           AND json_extract(payload_json, '$.submissionId') = ?`,
      )
      .bind(
        fixture.organizationId,
        fixture.submissionId,
        fixture.organizationId,
        fixture.submissionId,
        fixture.organizationId,
        fixture.submissionId,
        fixture.organizationId,
        fixture.submissionId,
        fixture.organizationId,
        fixture.submissionId,
      )
      .all(),
  );
  for (const sentinel of privateSentinels) {
    const pattern = new RegExp(escapeRegExp(sentinel), "u");
    assert.doesNotMatch(endpointText, pattern);
    assert.doesNotMatch(durableMetadataText, pattern);
  }
  assert.equal(
    await fixture.database
      .prepare(
        `SELECT count(*) AS count
         FROM audit_logs
         WHERE organization_id = ?
           AND entity_type = 'form_submission'
           AND entity_id = ?
           AND action = 'form_submission.personal_content_redacted'`,
      )
      .bind(fixture.organizationId, fixture.submissionId)
      .first("count"),
    1,
  );
  assert.deepEqual(
    await Promise.all(
      PHASE7_INVARIANT_COUNT_SQL.map((sql) =>
        fixture.database.prepare(sql).first("violation_count"),
      ),
    ),
    Array(PHASE7_INVARIANT_COUNT_SQL.length).fill(0),
  );

  assert.deepEqual(counts, {
    admin_assignment: 17,
    admin_detail: 8,
    admin_list: 7,
    admin_note: 12,
    admin_redaction_denied: 3,
    admin_status: 16,
    assigned_organizer_detail: 8,
    assigned_organizer_list: 7,
    cross_org_detail: 5,
    cross_org_list: 7,
    excessive_date_filter: 4,
    invalid_date_filter: 4,
    new_assignee_detail: 8,
    organizer_note: 12,
    organizer_redaction_denied: 3,
    organizer_status: 16,
    owner_assignment: 17,
    owner_detail: 8,
    owner_list: 7,
    owner_note: 12,
    owner_redaction: 18,
    owner_status: 16,
    owner_unassign: 16,
    post_redaction_detail: 8,
    post_redaction_stale: 5,
    reassigned_organizer_denied: 5,
    suspended_assignee_denied: 3,
    unassigned_organizer_detail: 5,
    unassigned_organizer_list: 7,
  });
  assert.ok(
    Object.values(counts).every((count) => count < 50),
    "every complete submissions route invocation must remain below 50 D1 statements",
  );
});

async function createFixture() {
  const database = new SqliteD1TestDatabase(loadGeneratedMigrations());
  const now = Date.now();
  const ownerIdentity = trustedIdentityFromSites({
    displayName: "Submission Owner",
    email: OWNER_EMAIL,
  });
  assert.equal(
    await bootstrapInitialOwner(database, ownerIdentity, OWNER_EMAIL, now),
    true,
  );
  const owner = await database
    .prepare(
      `SELECT membership.organization_id,
              membership.profile_id
       FROM organization_memberships AS membership
       WHERE membership.normalized_email = ?
       LIMIT 1`,
    )
    .bind(OWNER_EMAIL)
    .first();
  const organizationId = owner.organization_id;
  const ownerProfileId = owner.profile_id;
  const organizerAProfileId = "profile-phase7-submission-organizer-a";
  const organizerBProfileId = "profile-phase7-submission-organizer-b";
  await seedMember(database, {
    email: ADMIN_EMAIL,
    organizationId,
    ownerProfileId,
    profileId: "profile-phase7-submission-admin",
    role: "administrator",
  });
  await seedMember(database, {
    email: ORGANIZER_A_EMAIL,
    organizationId,
    ownerProfileId,
    profileId: organizerAProfileId,
    role: "organizer",
  });
  await seedMember(database, {
    email: ORGANIZER_B_EMAIL,
    organizationId,
    ownerProfileId,
    profileId: organizerBProfileId,
    role: "organizer",
  });
  await seedOtherOrganization(database, now);
  database.exec(PHASE7_INVARIANT_TRIGGER_STATEMENTS.join("\n"));

  const submitted = await submitPublicForm(database, {
    anonymousClientId: "submission-route-client",
    formInstance: {
      formKey: "contact",
      issuedAt: now - 4_000,
      nonce: "submission-route-nonce",
    },
    formKey: "contact",
    honeypot: "",
    keyHex: "b".repeat(64),
    networkFacts: "submission-route-network-scope",
    nowUtcMs: now,
    organizationId,
    payload: {
      message: VISITOR_MESSAGE,
      name: VISITOR_NAME,
      replyEmail: VISITOR_EMAIL,
      topic: "Accessibility",
    },
  });
  const submissionId = await database
    .prepare(
      `SELECT submission_id
       FROM form_submission_workflows
       WHERE organization_id = ?
         AND public_reference = ?
       LIMIT 1`,
    )
    .bind(organizationId, submitted.publicReference)
    .first("submission_id");
  const date = new Date(now);
  const fromDate = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - 1,
    ),
  )
    .toISOString()
    .slice(0, 10);
  const toDate = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + 1,
    ),
  )
    .toISOString()
    .slice(0, 10);
  return {
    counted: new CountingD1Database(database),
    database,
    fromDate,
    organizationId,
    organizerAProfileId,
    organizerBProfileId,
    publicReference: submitted.publicReference,
    submissionId,
    toDate,
  };
}

async function seedMember(
  database,
  { email, organizationId, ownerProfileId, profileId, role },
) {
  const now = Date.now();
  await database.batch([
    database
      .prepare(
        `INSERT INTO profiles (
           id, siwc_subject, normalized_email, display_name, status,
           created_at, updated_at, deleted_at
         ) VALUES (?, ?, ?, ?, 'active', ?, ?, NULL)`,
      )
      .bind(
        profileId,
        `email:${email}`,
        email,
        email.split("@", 1)[0],
        now,
        now,
      ),
    database
      .prepare(
        `INSERT INTO organization_memberships (
           id, organization_id, profile_id, normalized_email,
           role, status, created_by_profile_id,
           created_at, updated_at, deleted_at
         ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)`,
      )
      .bind(
        `membership:${profileId}`,
        organizationId,
        profileId,
        email,
        role,
        ownerProfileId,
        now,
        now,
      ),
  ]);
}

async function seedOtherOrganization(database, now) {
  const profileId = "profile-phase7-submission-other-owner";
  const organizationId = "organization-phase7-submission-other";
  await database.batch([
    database
      .prepare(
        `INSERT INTO profiles (
           id, siwc_subject, normalized_email, display_name, status,
           created_at, updated_at, deleted_at
         ) VALUES (?, ?, ?, 'Other Owner', 'active', ?, ?, NULL)`,
      )
      .bind(
        profileId,
        `email:${OTHER_OWNER_EMAIL}`,
        OTHER_OWNER_EMAIL,
        now,
        now,
      ),
    database
      .prepare(
        `INSERT INTO organizations (
           id, name, slug, timezone, owner_bootstrap_closed_at,
           owner_bootstrap_claimed_by_profile_id, created_by_profile_id,
           created_at, updated_at, deleted_at
         ) VALUES (
           ?, 'Other organization', 'phase7-submission-other',
           'America/Vancouver', ?, ?, ?, ?, ?, NULL
         )`,
      )
      .bind(
        organizationId,
        now,
        profileId,
        profileId,
        now,
        now,
      ),
    database
      .prepare(
        `INSERT INTO organization_memberships (
           id, organization_id, profile_id, normalized_email,
           role, status, created_by_profile_id,
           created_at, updated_at, deleted_at
         ) VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?, ?, NULL)`,
      )
      .bind(
        `membership:${profileId}`,
        organizationId,
        profileId,
        OTHER_OWNER_EMAIL,
        profileId,
        now,
        now,
      ),
  ]);
}

async function detailRequest(fixture, counts, label, email) {
  const pathname =
    `/api/organizer/submissions/${fixture.submissionId}`;
  return countedRequest(
    fixture,
    counts,
    label,
    email,
    () =>
      detailRoute.GET(
        new Request(`${ORIGIN}${pathname}`),
        { params: Promise.resolve({ id: fixture.submissionId }) },
      ),
    { method: "GET", pathname },
  );
}

async function mutationRequest(
  fixture,
  counts,
  label,
  email,
  handler,
  body,
) {
  const operation =
    handler === assignmentRoute.PATCH
      ? "assignment"
      : handler === statusRoute.PATCH
        ? "status"
        : handler === notesRoute.POST
          ? "notes"
          : "redact";
  const pathname =
    `/api/organizer/submissions/${fixture.submissionId}/${operation}`;
  const method =
    handler === notesRoute.POST || handler === redactRoute.POST
      ? "POST"
      : "PATCH";
  return countedRequest(
    fixture,
    counts,
    label,
    email,
    () =>
      handler(
        new Request(`${ORIGIN}${pathname}`, {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            origin: ORIGIN,
          },
          method,
        }),
        { params: Promise.resolve({ id: fixture.submissionId }) },
      ),
    { method, pathname },
  );
}

async function countedRequest(
  fixture,
  counts,
  label,
  email,
  callback,
  request = {
    method: "GET",
    pathname: "/api/organizer/submissions",
  },
) {
  await ensureDatabaseInvariantsReady(fixture.database);
  setIdentity(email);
  fixture.counted.reset();
  assert.equal(
    await ensureDatabaseInvariants(fixture.counted),
    "ready",
    `${label} must enter through the invariant fast path`,
  );
  assert.deepEqual(
    await runRequestMaintenance(fixture.counted, request),
    { kind: "continue" },
    `${label} must continue past request maintenance`,
  );
  const response = await callback();
  counts[label] = fixture.counted.count;
  assertPrivateHeaders(response);
  return {
    body: await response.json(),
    response,
  };
}

function setIdentity(email) {
  for (const key of Object.keys(ROUTE_HEADERS)) delete ROUTE_HEADERS[key];
  ROUTE_HEADERS["oai-authenticated-user-email"] = email;
  ROUTE_HEADERS["oai-authenticated-user-full-name"] =
    encodeURIComponent(email.split("@", 1)[0]);
  ROUTE_HEADERS["oai-authenticated-user-full-name-encoding"] =
    "percent-encoded-utf-8";
}

function assertPrivateHeaders(response) {
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store, max-age=0",
  );
  assert.equal(
    response.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

function loadGeneratedMigrations() {
  const migrationDirectory = join(process.cwd(), "drizzle");
  return readdirSync(migrationDirectory)
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) => readFileSync(join(migrationDirectory, name), "utf8"))
    .join("\n");
}

class CountingD1Database {
  constructor(inner) {
    this.inner = inner;
    this.count = 0;
  }

  prepare(sql) {
    return new CountingD1Statement(this, this.inner.prepare(sql));
  }

  async batch(statements) {
    this.count += statements.length;
    return this.inner.batch(statements.map((statement) => statement.inner));
  }

  reset() {
    this.count = 0;
  }
}

class CountingD1Statement {
  constructor(database, inner) {
    this.database = database;
    this.inner = inner;
  }

  bind(...values) {
    return new CountingD1Statement(
      this.database,
      this.inner.bind(...values),
    );
  }

  async first(columnName) {
    this.database.count += 1;
    return this.inner.first(columnName);
  }

  async all() {
    this.database.count += 1;
    return this.inner.all();
  }

  async run() {
    this.database.count += 1;
    return this.inner.run();
  }
}

function dataModule(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
