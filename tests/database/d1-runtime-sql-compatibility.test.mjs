import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";
import {
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import {
  DATABASE_INVARIANT_ABORTING_INTEGRITY_PROBE_SQL,
  DATABASE_INVARIANT_COMBINED_COUNT_SQL,
  DATABASE_INVARIANT_TRIGGER_NAMES,
  DATABASE_INVARIANT_TRIGGER_STATEMENTS,
} from "../../lib/server/database/invariants.ts";
import {
  PHASE6_INVARIANT_COUNT_SQL,
} from "../../lib/server/database/phase6-invariant-sql.ts";
import {
  PHASE7_INVARIANT_COUNT_SQL,
  PHASE7_INVARIANT_TRIGGER_STATEMENTS,
} from "../../lib/server/database/phase7-invariant-sql.ts";
import { submitPublicForm } from "../../lib/server/phase7/public-forms.ts";
import {
  appendFormSubmissionNote,
  redactFormSubmissionPersonalContent,
} from "../../lib/server/phase7/submissions.ts";
import {
  protectedLegalClaimSql,
} from "../../lib/validation/protected-legal-claims.ts";
import {
  productionMigrationFragments,
} from "../../scripts/d1-migration-batches.mjs";

const MAX_D1_STATEMENT_BYTES = 100_000;

const workerScript = `
export default {
  async fetch(request, env) {
    const input = await request.json();
    try {
      if (input.mode === "batch") {
        const statements = input.statements.map((item) => {
          let statement = env.DB.prepare(item.sql);
          if (item.bindings.length) statement = statement.bind(...item.bindings);
          return statement;
        });
        return Response.json({ ok: true, result: await env.DB.batch(statements) });
      }
      let statement = env.DB.prepare(input.sql);
      if (input.bindings?.length) statement = statement.bind(...input.bindings);
      const result =
        input.mode === "run"
          ? await statement.run()
          : input.mode === "first"
            ? await statement.first()
            : await statement.all();
      return Response.json({ ok: true, result });
    } catch (error) {
      return Response.json({
        ok: false,
        error: String(error?.message ?? error),
      });
    }
  },
};
`;

function byteLength(sql) {
  return new TextEncoder().encode(sql).byteLength;
}

function triggerOperation(sql) {
  const match = sql.match(
    /CREATE\s+TRIGGER(?:\s+IF\s+NOT\s+EXISTS)?\s+(\S+)\s+(?:BEFORE|AFTER)\s+(INSERT|UPDATE|DELETE)(?:\s+OF\s+[^\n]+)?\s+ON\s+(\S+)/iu,
  );
  assert.ok(match, `Could not parse runtime trigger:\n${sql.slice(0, 200)}`);
  return { name: match[1], operation: match[2], table: match[3] };
}

test("Phase 6 Club and Program theme checks execute within D1 limits", async () => {
  const miniflare = new Miniflare({
    d1Databases: { DB: randomUUID() },
    modules: true,
    script: workerScript,
  });
  try {
    const execute = async (sql, mode = "run") => {
      assert.ok(
        byteLength(sql) < MAX_D1_STATEMENT_BYTES,
        `D1 statement is ${byteLength(sql)} bytes`,
      );
      const response = await miniflare.dispatchFetch("http://d1.test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, sql }),
      });
      return response.json();
    };
    const request = async (sql, mode = "run") => {
      const body = await execute(sql, mode);
      assert.equal(body.ok, true, body.error);
      return body.result;
    };

    const fiftyBytePattern = "a".repeat(50);
    const fiftyByteWitness = await request(
      `SELECT 'a' GLOB '${fiftyBytePattern}' AS matched`,
      "first",
    );
    assert.equal(fiftyByteWitness.matched, 0);
    const fiftyOneByteWitness = await execute(
      `SELECT 'a' GLOB '${fiftyBytePattern}a' AS matched`,
      "first",
    );
    assert.equal(fiftyOneByteWitness.ok, false);
    assert.match(
      fiftyOneByteWitness.error,
      /LIKE or GLOB pattern too complex/iu,
    );

    for (
      const name of (await readdir(join(process.cwd(), "drizzle")))
        .filter((candidate) => candidate.endsWith(".sql"))
        .sort()
    ) {
      const sql = await readFile(join(process.cwd(), "drizzle", name), "utf8");
      for (const statement of productionMigrationFragments(sql)) {
        await request(statement);
      }
    }

    await request(
      `INSERT INTO profiles (
         id, siwc_subject, normalized_email, display_name, status,
         created_at, updated_at
       ) VALUES (
         'theme-owner', 'theme-owner-subject', 'theme-owner@example.test',
         'Theme Owner', 'active', 1, 1
       )`,
    );
    await request(
      `INSERT INTO organizations (
         id, name, slug, timezone, owner_bootstrap_closed_at,
         created_by_profile_id, created_at, updated_at
       ) VALUES (
         'theme-org', 'Theme organization', 'theme-organization',
         'America/Vancouver', 1, 'theme-owner', 1, 1
       )`,
    );
    await request(
      `INSERT INTO event_lanes (
         id, organization_id, name, slug, sort_order,
         created_by_profile_id, created_at, updated_at
       ) VALUES (
         'theme-lane', 'theme-org', 'Theme lane', 'theme-lane', 1,
         'theme-owner', 1, 1
       )`,
    );
    await request(
      `INSERT INTO clubs (
         id, organization_id, name, slug, created_by_profile_id,
         created_at, updated_at
       ) VALUES (
         'theme-club', 'theme-org', 'Theme club', 'theme-club',
         'theme-owner', 1, 1
       )`,
    );
    await request(
      `INSERT INTO programs (
         id, organization_id, club_id, name, slug, created_by_profile_id,
         created_at, updated_at
       ) VALUES (
         'theme-program', 'theme-org', 'theme-club', 'Theme program',
         'theme-program', 'theme-owner', 1, 1
       )`,
    );
    await request(
      `INSERT INTO club_public_profile_details (
         club_id, organization_id, public_display_name, short_summary,
         full_description, program_type, theme_color,
         confirmed_social_links_json, related_resources_json,
         updated_by_profile_id, created_at, updated_at
       ) VALUES (
         'theme-club', 'theme-org', 'Theme club', 'A substantive summary.',
         'A substantive public description.', 'club', '#0C665E',
         '[]', '[]', 'theme-owner', 1, 1
       )`,
    );
    await request(
      `INSERT INTO program_public_profile_details (
         program_id, organization_id, club_id, primary_event_lane_id,
         publication_status, is_featured, display_order,
         public_display_name, public_slug, short_summary, full_description,
         program_type, theme_color, confirmed_social_links_json,
         related_resources_json, updated_by_profile_id,
         created_at, updated_at
       ) VALUES (
         'theme-program', 'theme-org', 'theme-club', 'theme-lane',
         'draft', 0, 1, 'Theme program', 'theme-program',
         'A substantive summary.', 'A substantive public description.',
         'program', '#aBc123', '[]', '[]', 'theme-owner', 1, 1
       )`,
    );

    const invalidClub = await execute(
      `UPDATE club_public_profile_details
       SET theme_color = '#12G45Z'
       WHERE club_id = 'theme-club'`,
    );
    assert.equal(invalidClub.ok, false);
    assert.match(invalidClub.error, /theme_check|CHECK constraint failed/iu);
    assert.doesNotMatch(invalidClub.error, /pattern too complex/iu);

    const invalidProgram = await execute(
      `UPDATE program_public_profile_details
       SET theme_color = '#1234567'
       WHERE program_id = 'theme-program'`,
    );
    assert.equal(invalidProgram.ok, false);
    assert.match(invalidProgram.error, /theme_check|CHECK constraint failed/iu);
    assert.doesNotMatch(invalidProgram.error, /pattern too complex/iu);

    const colors = await request(
      `SELECT
         (SELECT theme_color
          FROM club_public_profile_details
          WHERE club_id = 'theme-club') AS club_theme,
         (SELECT theme_color
          FROM program_public_profile_details
          WHERE program_id = 'theme-program') AS program_theme`,
      "first",
    );
    assert.deepEqual(colors, {
      club_theme: "#0C665E",
      program_theme: "#aBc123",
    });
  } finally {
    await miniflare.dispose();
  }
});

test("runtime invariant SQL compiles and executes through real D1", async () => {
  const miniflare = new Miniflare({
    d1Databases: { DB: randomUUID() },
    modules: true,
    script: workerScript,
  });
  try {
    const request = async (sql, mode = "all") => {
      assert.ok(
        byteLength(sql) < MAX_D1_STATEMENT_BYTES,
        `D1 statement is ${byteLength(sql)} bytes`,
      );
      const response = await miniflare.dispatchFetch("http://d1.test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, sql }),
      });
      const body = await response.json();
      assert.equal(body.ok, true, body.error);
      return body.result;
    };

    for (
      const name of (await readdir(join(process.cwd(), "drizzle")))
        .filter((candidate) => candidate.endsWith(".sql"))
        .sort()
    ) {
      const sql = await readFile(join(process.cwd(), "drizzle", name), "utf8");
      for (const statement of productionMigrationFragments(sql)) {
        await request(statement, "run");
      }
    }

    for (const sql of DATABASE_INVARIANT_TRIGGER_STATEMENTS) {
      await request(sql, "run");
    }
    const installed = await request(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'trigger'
       ORDER BY name`,
    );
    assert.deepEqual(
      installed.results.map((row) => row.name),
      [...DATABASE_INVARIANT_TRIGGER_NAMES].sort(),
    );

    for (const sql of PHASE6_INVARIANT_COUNT_SQL) {
      const result = await request(sql);
      assert.equal(result.results.length, 1);
      assert.equal(Number(result.results[0].violation_count), 0);
    }
    for (const sql of DATABASE_INVARIANT_COMBINED_COUNT_SQL) {
      const result = await request(sql);
      assert.ok(result.results.length > 0);
      assert.ok(
        result.results.every(
          (row) => Number(row.violation_count) === 0,
        ),
      );
    }
    for (const sql of DATABASE_INVARIANT_ABORTING_INTEGRITY_PROBE_SQL) {
      await request(sql, "run");
    }

    let nestedLegalPredicate = protectedLegalClaimSql([
      "'Registered   charity gathering'",
    ]);
    for (let index = 0; index < 16; index += 1) {
      nestedLegalPredicate =
        `NOT (NOT (${nestedLegalPredicate}))`;
    }
    const protectedClaim = await request(
      `SELECT CASE
         WHEN ${nestedLegalPredicate} THEN 1 ELSE 0
       END AS protected_claim`,
    );
    assert.equal(protectedClaim.results[0].protected_claim, 1);

    const operations = new Map();
    for (const sql of DATABASE_INVARIANT_TRIGGER_STATEMENTS) {
      const operation = triggerOperation(sql);
      operations.set(
        `${operation.table}|${operation.operation}`,
        operation,
      );
    }
    for (const { operation, table } of operations.values()) {
      let explainSql;
      if (operation === "INSERT") {
        explainSql = `EXPLAIN INSERT INTO ${table} DEFAULT VALUES`;
      } else if (operation === "DELETE") {
        explainSql = `EXPLAIN DELETE FROM ${table} WHERE 0`;
      } else {
        const tableInfo = await request(`PRAGMA table_info(${table})`);
        const columns = tableInfo.results.map((row) => row.name);
        assert.ok(columns.length > 0, `No columns found for ${table}`);
        explainSql =
          `EXPLAIN UPDATE ${table} SET ` +
          columns.map((column) => `${column}=${column}`).join(", ") +
          " WHERE 0";
      }
      await request(explainSql);
    }
    assert.equal(
      operations.size,
      165,
      "Phase 7 adds 33 new guarded table-operation activation families",
    );

    await request(
      `INSERT INTO profiles (
         id, siwc_subject, normalized_email, display_name, status,
         created_at, updated_at
       ) VALUES
         (
           'profile-d1-runtime-owner', 'subject-d1-runtime-owner',
           'runtime-owner@example.test', 'Runtime Owner', 'active', 1, 1
         ),
         (
           'profile-d1-runtime-member', 'subject-d1-runtime-member',
           'runtime-member@example.test', 'Runtime Member', 'active', 1, 1
         )`,
      "run",
    );
    await request(
      `INSERT INTO organizations (
         id, name, slug, timezone, owner_bootstrap_closed_at,
         created_by_profile_id, created_at, updated_at
       ) VALUES (
         'org-d1-runtime', 'Runtime organization', 'runtime-organization',
         'America/Vancouver', 1, 'profile-d1-runtime-owner', 1, 1
       )`,
      "run",
    );
    await request(
      `INSERT INTO organization_memberships (
         id, organization_id, profile_id, normalized_email, role, status,
         created_by_profile_id, created_at, updated_at
       ) VALUES
         (
           'membership-d1-runtime-owner', 'org-d1-runtime',
           'profile-d1-runtime-owner', 'runtime-owner@example.test',
           'owner', 'active', 'profile-d1-runtime-owner', 1, 1
         ),
         (
           'membership-d1-runtime-member', 'org-d1-runtime',
           'profile-d1-runtime-member', 'runtime-member@example.test',
           'viewer', 'active', 'profile-d1-runtime-owner', 1, 1
         )`,
      "run",
    );

    const rejected = await miniflare.dispatchFetch("http://d1.test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "run",
        sql: `INSERT INTO organizer_public_attribution_write_intents (
          id, organization_id, profile_id, operation,
          expected_draft_version, expected_published_version,
          proposed_published_version, snapshot_hash,
          actor_profile_id, created_at, completed_at
        ) VALUES (
          'intent-d1-runtime-invalid', 'org-d1-runtime',
          'profile-d1-runtime-member', 'confirmed', 1, 0, 1,
          '${"a".repeat(64)}', 'profile-d1-runtime-member', 2, NULL
        )`,
      }),
    });
    const rejectedBody = await rejected.json();
    assert.equal(rejectedBody.ok, false);
    assert.match(
      rejectedBody.error,
      /phase6_public_attribution_intent_invalid/u,
    );
  } finally {
    await miniflare.dispose();
  }
});

test("Owner submission redaction scrubs every retained intent payload through real D1", async (t) => {
  const miniflare = new Miniflare({
    d1Databases: { DB: randomUUID() },
    modules: true,
    script: workerScript,
  });
  t.after(async () => {
    await miniflare.dispose();
  });
  const dispatch = async (payload) => {
    const response = await miniflare.dispatchFetch("http://d1.test/", {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return response.json();
  };
  const request = async (payload) => {
    const body = await dispatch(payload);
    if (!body.ok) throw new Error(body.error);
    return body.result;
  };
  const database = {
    prepare(sql) {
      assert.ok(
        byteLength(sql) < MAX_D1_STATEMENT_BYTES,
        `D1 statement is ${byteLength(sql)} bytes`,
      );
      return prepared(sql, []);
    },
    batch(statements) {
      return request({
        mode: "batch",
        statements: statements.map((statement) => ({
          bindings: statement.bindings,
          sql: statement.sql,
        })),
      });
    },
  };
  function prepared(sql, bindings) {
    return {
      bindings,
      sql,
      bind(...nextBindings) {
        return prepared(sql, nextBindings);
      },
      all() {
        return request({ bindings, mode: "all", sql });
      },
      async first(column) {
        const row = await request({ bindings, mode: "first", sql });
        return typeof column === "string" ? (row?.[column] ?? null) : row;
      },
      run() {
        return request({ bindings, mode: "run", sql });
      },
    };
  }

  for (
    const name of (await readdir(join(process.cwd(), "drizzle")))
      .filter((candidate) => candidate.endsWith(".sql"))
      .sort()
  ) {
    const sql = await readFile(join(process.cwd(), "drizzle", name), "utf8");
    for (const statement of productionMigrationFragments(sql)) {
      await database.prepare(statement).run();
    }
  }
  for (const statement of PHASE7_INVARIANT_TRIGGER_STATEMENTS) {
    await database.prepare(statement).run();
  }

  const now = Date.now();
  const ownerEmail = "d1-redaction-owner@example.invalid";
  const organizationId = "org-d1-redaction";
  const ownerProfileId = "profile-d1-redaction-owner";
  const visitorEmail = "d1-private-visitor@example.invalid";
  const visitorMessage = "D1 retained intent payload sentinel.";
  const visitorName = "D1 Private Visitor";
  const noteBody = "D1 private note sentinel.";
  await database.batch([
    database
      .prepare(
        `INSERT INTO profiles (
           id, siwc_subject, normalized_email, display_name, status,
           created_at, updated_at, deleted_at
         ) VALUES (?, ?, ?, 'D1 redaction owner', 'active', ?, ?, NULL)`,
      )
      .bind(
        ownerProfileId,
        `email:${ownerEmail}`,
        ownerEmail,
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
           ?, 'D1 redaction organization', 'd1-redaction-organization',
           'America/Vancouver', ?, ?, ?, ?, ?, NULL
         )`,
      )
      .bind(
        organizationId,
        now,
        ownerProfileId,
        ownerProfileId,
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
        "membership-d1-redaction-owner",
        organizationId,
        ownerProfileId,
        ownerEmail,
        ownerProfileId,
        now,
        now,
      ),
  ]);
  const identity = trustedIdentityFromSites({
    displayName: "D1 redaction owner",
    email: ownerEmail,
  });
  const submitted = await submitPublicForm(database, {
    anonymousClientId: "d1-redaction-client",
    formInstance: {
      formKey: "contact",
      issuedAt: now - 4_000,
      nonce: "d1-redaction-nonce",
    },
    formKey: "contact",
    honeypot: "",
    keyHex: "c".repeat(64),
    networkFacts: "d1-redaction-network",
    nowUtcMs: now,
    organizationId,
    payload: {
      message: visitorMessage,
      name: visitorName,
      replyEmail: visitorEmail,
      topic: "Privacy",
    },
  });
  const submissionId = await database
    .prepare(
      `SELECT submission_id
       FROM form_submission_workflows
       WHERE organization_id = ?
         AND public_reference = ?`,
    )
    .bind(organizationId, submitted.publicReference)
    .first("submission_id");
  assert.equal(typeof submissionId, "string");
  const withNote = await appendFormSubmissionNote(database, identity, {
    body: noteBody,
    submissionId,
  });
  const redacted = await redactFormSubmissionPersonalContent(
    database,
    identity,
    {
      confirmationReference: submitted.publicReference,
      expectedVersion: withNote.version,
      submissionId,
    },
  );
  assert.deepEqual(redacted.fields, { redacted: true });

  const retained = await database
    .prepare(
      `SELECT 'submission' AS source, payload_json AS retained_text
       FROM form_submissions
       WHERE organization_id = ?
         AND id = ?
       UNION ALL
       SELECT 'note', body_text
       FROM form_submission_notes
       WHERE organization_id = ?
         AND submission_id = ?
       UNION ALL
       SELECT 'intent', proposed_payload_json
       FROM form_submission_write_intents
       WHERE organization_id = ?
         AND submission_id = ?
       UNION ALL
       SELECT 'audit', metadata_json
       FROM audit_logs
       WHERE organization_id = ?
         AND entity_type = 'form_submission'
         AND entity_id = ?
       UNION ALL
       SELECT 'notification', payload_json
       FROM notifications
       WHERE organization_id = ?
         AND json_extract(payload_json, '$.submissionId') = ?`,
    )
    .bind(
      organizationId,
      submissionId,
      organizationId,
      submissionId,
      organizationId,
      submissionId,
      organizationId,
      submissionId,
      organizationId,
      submissionId,
    )
    .all();
  const retainedText = JSON.stringify(retained);
  for (const sentinel of [
    visitorEmail,
    visitorMessage,
    visitorName,
    noteBody,
  ]) {
    assert.doesNotMatch(retainedText, new RegExp(sentinel, "u"));
    assert.doesNotMatch(JSON.stringify(redacted), new RegExp(sentinel, "u"));
  }
  const intentPayloads = retained.results
    .filter((row) => row.source === "intent")
    .map((row) => row.retained_text);
  assert.ok(intentPayloads.length >= 2);
  assert.ok(
    intentPayloads.every((payload) => payload === '{"redacted":true}'),
  );

  const tamper = await dispatch({
    bindings: [visitorMessage, organizationId, submissionId],
    mode: "run",
    sql: `UPDATE form_submission_write_intents
          SET proposed_payload_json = json_object('message', ?)
          WHERE organization_id = ?
            AND submission_id = ?
            AND action = 'create'`,
  });
  assert.equal(tamper.ok, false);
  assert.match(tamper.error, /phase7_form_intent_completion_invalid/iu);

  for (let index = 0; index < 5; index += 1) {
    await assert.rejects(
      submitPublicForm(database, {
        anonymousClientId: "d1-invalid-rate-client",
        formInstance: {
          formKey: "contact",
          issuedAt: now - 4_000,
          nonce: `d1-invalid-rate-${index}`,
        },
        formKey: "contact",
        honeypot: "",
        keyHex: "c".repeat(64),
        networkFacts: "d1-invalid-rate-network",
        nowUtcMs: now + index,
        organizationId,
        payload: {
          message: "short",
          name: "x",
          replyEmail: "not-an-email",
          topic: "Privacy",
        },
      }),
      (error) => error?.name === "PublicFormValidationError",
    );
  }
  await assert.rejects(
    submitPublicForm(database, {
      anonymousClientId: "d1-invalid-rate-client",
      formInstance: {
        formKey: "contact",
        issuedAt: now - 4_000,
        nonce: "d1-invalid-rate-six",
      },
      formKey: "contact",
      honeypot: "",
      keyHex: "c".repeat(64),
      networkFacts: "d1-invalid-rate-network",
      nowUtcMs: now + 10,
      organizationId,
      payload: {
        message: "short",
        name: "x",
        replyEmail: "not-an-email",
        topic: "Privacy",
      },
    }),
    (error) => error?.code === "rate_limited" && error?.status === 429,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT request_count
         FROM public_form_rate_windows
         WHERE organization_id = ?
           AND action = 'public_form_scope_15m'
           AND request_count = 5
         LIMIT 1`,
      )
      .bind(organizationId)
      .first("request_count"),
    5,
  );
  assert.deepEqual(
    await Promise.all(
      PHASE7_INVARIANT_COUNT_SQL.map((sql) =>
        database.prepare(sql).first("violation_count"),
      ),
    ),
    PHASE7_INVARIANT_COUNT_SQL.map(() => 0),
  );
});
