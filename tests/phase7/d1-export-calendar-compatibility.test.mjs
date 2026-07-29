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
  createOwnCalendarSubscription,
  readPrivateCalendarSubscription,
} from "../../lib/server/phase7/calendar-subscriptions.ts";
import {
  createOwnerMediaManifest,
  createOperationalEventCsv,
  MEDIA_MANIFEST_USAGE_LIMIT,
  prepareMediaManifestStatement,
  readMediaManifestEntriesResult,
} from "../../lib/server/phase7/private-exports.ts";
import {
  createOwnerJsonBackup,
} from "../../lib/server/phase7/owner-backup.ts";
import {
  PHASE7_INVARIANT_TRIGGER_STATEMENTS,
} from "../../lib/server/database/phase7-invariant-sql.ts";
import {
  productionMigrationFragments,
} from "../../scripts/d1-migration-batches.mjs";

const OWNER = trustedIdentityFromSites({
  displayName: "D1 export owner",
  email: "d1-export-owner@example.invalid",
});
const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);
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
      if (input.bindings.length) statement = statement.bind(...input.bindings);
      const result =
        input.mode === "first"
          ? await statement.first()
          : input.mode === "run"
            ? await statement.run()
            : await statement.all();
      return Response.json({ ok: true, result });
    } catch (error) {
      return Response.json({ ok: false, error: String(error?.message ?? error) });
    }
  },
};
`;

test("operational, calendar, and bounded media-manifest SQL execute through real D1", async (t) => {
  const miniflare = new Miniflare({
    d1Databases: { DB: randomUUID() },
    modules: true,
    script: workerScript,
  });
  t.after(async () => {
    await miniflare.dispose();
  });
  const request = async (payload) => {
    const response = await miniflare.dispatchFetch("http://d1.test/", {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
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
      await request({ bindings: [], mode: "run", sql: statement });
    }
  }
  for (const statement of PHASE7_INVARIANT_TRIGGER_STATEMENTS.filter(
    (sql) => sql.includes("event_calendar_component_revisions_phase7_"),
  )) {
    await request({ bindings: [], mode: "run", sql: statement });
  }
  for (const statement of [
    `INSERT INTO profiles (
       id, siwc_subject, normalized_email, display_name, status,
       created_at, updated_at, deleted_at
     ) VALUES (
       'profile-owner', 'email:d1-export-owner@example.invalid',
       'd1-export-owner@example.invalid', 'D1 export owner', 'active',
       ${NOW}, ${NOW}, NULL
     )`,
    `INSERT INTO organizations (
       id, name, slug, timezone, owner_bootstrap_closed_at,
       created_by_profile_id, created_at, updated_at, deleted_at
     ) VALUES (
       'org-vcc', 'Vancouver Curiosity Club', 'vancouver-curiosity-club',
       'America/Vancouver', ${NOW}, 'profile-owner',
       ${NOW}, ${NOW}, NULL
     )`,
    `INSERT INTO organization_memberships (
       id, organization_id, profile_id, normalized_email, role, status,
       created_by_profile_id, created_at, updated_at, deleted_at
     ) VALUES (
       'membership-owner', 'org-vcc', 'profile-owner',
       'd1-export-owner@example.invalid', 'owner', 'active',
       'profile-owner', ${NOW}, ${NOW}, NULL
     )`,
    `INSERT INTO clubs (
       id, organization_id, name, slug, description,
       created_by_profile_id, created_at, updated_at, deleted_at
     ) VALUES (
       'club-calendar', 'org-vcc', 'Calendar Club', 'calendar-club',
       'Calendar fixture.', 'profile-owner', ${NOW}, ${NOW}, NULL
     )`,
    `INSERT INTO organizer_events (
       id, organization_id, club_id, primary_organizer_profile_id,
       title, slug, planning_status, publication_status,
       schedule_shape, starts_at_utc, ends_at_utc, timezone,
       buffer_before_minutes, buffer_after_minutes,
       content_version, schedule_version,
       created_by_profile_id, updated_by_profile_id,
       created_at, updated_at, deleted_at
     ) VALUES (
       'event-calendar', 'org-vcc', 'club-calendar', 'profile-owner',
       'Private calendar event', 'private-calendar-event',
       'draft', 'private', 'timed',
       ${NOW + 86400000}, ${NOW + 90000000}, 'America/Vancouver',
       0, 0, 1, 1, 'profile-owner', 'profile-owner',
       ${NOW}, ${NOW}, NULL
     )`,
  ]) {
    await request({ bindings: [], mode: "run", sql: statement });
  }
  const forgedResponse = await miniflare.dispatchFetch("http://d1.test/", {
    body: JSON.stringify({
      bindings: ["f".repeat(64)],
      mode: "run",
      sql: `INSERT INTO event_calendar_component_revisions (
              organization_id, scope, event_key, canonical_fingerprint,
              sequence, last_modified_at, created_at, updated_at
            ) VALUES (
              'org-vcc', 'public', 'forged:timestamp', ?,
              0, 8640000000000000, 8640000000000000,
              8640000000000000
            )`,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const forgedBody = await forgedResponse.json();
  assert.equal(forgedBody.ok, false);
  assert.match(
    forgedBody.error,
    /phase7_calendar_component_revision_initial_state_invalid/iu,
  );

  let maximumBytes = 0;
  let maximumBindings = 0;
  const database = {
    prepare(sql) {
      maximumBytes = Math.max(
        maximumBytes,
        new TextEncoder().encode(sql).byteLength,
      );
      return prepared(sql, []);
    },
    async batch(statements) {
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
        maximumBindings = Math.max(maximumBindings, nextBindings.length);
        return prepared(sql, nextBindings);
      },
      all() {
        return request({ bindings, mode: "all", sql });
      },
      first() {
        return request({ bindings, mode: "first", sql });
      },
      run() {
        return request({ bindings, mode: "run", sql });
      },
    };
  }

  const operational = await createOperationalEventCsv(database, OWNER, NOW);
  assert.match(operational.body, /^event_reference,/u);
  const created = await createOwnCalendarSubscription(
    database,
    OWNER,
    "Real D1",
    NOW,
  );
  const calendar = await readPrivateCalendarSubscription(
    database,
    created.token,
    {
      generatedAt: NOW + 1_000,
      origin: "https://example.invalid",
    },
  );
  assert.match(calendar, /^BEGIN:VCALENDAR\r\n/u);
  const revision = await request({
    bindings: ["org-vcc"],
    mode: "first",
    sql: `SELECT scope, sequence, canonical_fingerprint
          FROM event_calendar_component_revisions
          WHERE organization_id = ?`,
  });
  assert.equal(revision.scope, "private");
  assert.equal(revision.sequence, 0);
  assert.match(revision.canonical_fingerprint, /^[0-9a-f]{64}$/u);

  const initialTokenState = await request({
    bindings: [created.subscription.id],
    mode: "first",
    sql: `SELECT last_used_at
          FROM ics_subscription_tokens
          WHERE id = ?`,
  });
  await request({
    bindings: [NOW + 2_000],
    mode: "run",
    sql: `UPDATE organization_memberships
          SET status = 'suspended', updated_at = ?
          WHERE id = 'membership-owner'`,
  });
  await assertPrivateCalendarNotFound(
    database,
    created.token,
    NOW + 86_401_000,
  );
  await assertTokenTouchUnchanged(
    request,
    created.subscription.id,
    initialTokenState.last_used_at,
  );

  await request({
    bindings: [NOW + 3_000, NOW + 3_000],
    mode: "run",
    sql: `UPDATE organization_memberships
          SET status = 'active', deleted_at = ?, updated_at = ?
          WHERE id = 'membership-owner'`,
  });
  await assertPrivateCalendarNotFound(
    database,
    created.token,
    NOW + 172_801_000,
  );
  await assertTokenTouchUnchanged(
    request,
    created.subscription.id,
    initialTokenState.last_used_at,
  );

  for (const statement of [
    `UPDATE organization_memberships
     SET deleted_at = NULL, updated_at = ${NOW + 4_000}
     WHERE id = 'membership-owner'`,
    `INSERT INTO organizations (
       id, name, slug, timezone, owner_bootstrap_closed_at,
       created_by_profile_id, created_at, updated_at, deleted_at
     ) VALUES (
       'org-other', 'Other D1 organization', 'other-d1-organization',
       'America/Vancouver', ${NOW}, 'profile-owner',
       ${NOW}, ${NOW}, NULL
     )`,
    `UPDATE ics_subscription_tokens
     SET organization_id = 'org-other'
     WHERE id = '${created.subscription.id}'`,
  ]) {
    await request({ bindings: [], mode: "run", sql: statement });
  }
  await assertPrivateCalendarNotFound(
    database,
    created.token,
    NOW + 259_201_000,
  );
  await assertTokenTouchUnchanged(
    request,
    created.subscription.id,
    initialTokenState.last_used_at,
  );
  await request({
    bindings: [created.subscription.id],
    mode: "run",
    sql: `UPDATE ics_subscription_tokens
          SET organization_id = 'org-vcc'
          WHERE id = ?`,
  });

  for (const statement of [
    `INSERT INTO media_assets (
       id, organization_id, object_key, file_name, mime_type, byte_size,
       alt_text, credit, rights_status, participant_consent_status,
       is_public, uploaded_by_profile_id, created_at, updated_at, deleted_at
     ) VALUES (
       'asset-dense-manifest', 'org-vcc', 'private-dense-object',
       'dense.png', 'image/png', 4, 'Dense usage fixture', NULL,
       'approved', 'not_applicable', 0, 'profile-owner',
       ${NOW}, ${NOW}, NULL
     )`,
    `INSERT INTO media_asset_details (
       asset_id, organization_id, upload_state, caption,
       private_rights_source_note, private_participant_consent_note,
       focal_point_x, focal_point_y, informative, content_version,
       original_sha256, width, height, pixel_count, failure_code,
       finalized_at, updated_by_profile_id, created_at, updated_at
     ) VALUES (
       'asset-dense-manifest', 'org-vcc', 'ready', NULL, NULL, NULL,
       5000, 5000, 1, 1, '${"d".repeat(64)}',
       2, 2, 4, NULL, ${NOW}, 'profile-owner', ${NOW}, ${NOW}
     )`,
  ]) {
    await request({ bindings: [], mode: "run", sql: statement });
  }
  const denseUsageCount = MEDIA_MANIFEST_USAGE_LIMIT * 2;
  await request({
    bindings: [
      denseUsageCount,
      `entity-${"\u0001".repeat(148)}-`,
      `revision-${"\u0001".repeat(147)}-`,
      `usage-${"\u0001".repeat(53)}-`,
      NOW,
    ],
    mode: "run",
    sql: `WITH RECURSIVE sequence(value) AS (
            VALUES (1)
            UNION ALL
            SELECT value + 1
            FROM sequence
            WHERE value < ?
          )
          INSERT INTO media_usage_references (
            id, organization_id, asset_id, entity_type, entity_id,
            revision_id, usage_kind, publication_scope,
            created_by_profile_id, created_at, deleted_at
          )
          SELECT printf('usage-d1-%03d', value),
                 'org-vcc',
                 'asset-dense-manifest',
                 'page',
                 ? || printf('%03d', value),
                 ? || printf('%03d', value),
                 ? || printf('%03d', value),
                 'draft',
                 'profile-owner',
                 ?,
                 NULL
          FROM sequence`,
  });
  const denseResult = await prepareMediaManifestStatement(
    database,
    "org-vcc",
  ).all();
  assert.equal(denseResult.results.length, 1);
  assert.equal(
    denseResult.results[0].usage_count,
    denseUsageCount,
  );
  assert.equal(
    JSON.parse(denseResult.results[0].usages_json).length,
    MEDIA_MANIFEST_USAGE_LIMIT + 1,
  );
  const boundedUsageBytes = new TextEncoder().encode(
    denseResult.results[0].usages_json,
  ).byteLength;
  assert.ok(
    boundedUsageBytes > 850_000 && boundedUsageBytes < 1_100_000,
    `bounded usage JSON bytes: ${boundedUsageBytes}`,
  );
  assert.throws(
    () => readMediaManifestEntriesResult(denseResult),
    (error) => error?.code === "validation_failed",
  );
  await assert.rejects(
    createOwnerMediaManifest(database, OWNER, NOW),
    (error) => error?.code === "validation_failed",
  );
  await assert.rejects(
    createOwnerJsonBackup(database, OWNER, {
      confirmation: "GENERATE SENSITIVE OWNER BACKUP",
      generatedAt: NOW,
      sourceRevision: "abcdef1234567890",
    }),
    (error) => error?.code === "validation_failed",
  );
  const exportAuditCount = await request({
    bindings: [],
    mode: "first",
    sql: `SELECT count(*) AS count
          FROM audit_logs
          WHERE action IN (
            'media_export.manifest',
            'owner_backup.generated'
          )`,
  });
  assert.equal(exportAuditCount.count, 0);
  assert.ok(maximumBytes < 90_000, `maximum SQL bytes: ${maximumBytes}`);
  assert.ok(maximumBindings < 100, `maximum bindings: ${maximumBindings}`);
});

async function assertPrivateCalendarNotFound(
  database,
  rawToken,
  generatedAt,
) {
  let rejected;
  try {
    await readPrivateCalendarSubscription(database, rawToken, {
      generatedAt,
      origin: "https://example.invalid",
    });
  } catch (error) {
    rejected = error;
  }
  assert.ok(rejected, "the private D1 feed must reject");
  assert.equal(rejected.code, "not_found");
  assert.equal(rejected.status, 404);
  assert.equal(
    rejected.publicMessage,
    "The calendar subscription could not be found.",
  );
  assert.equal(
    [
      rejected.message,
      rejected.publicMessage,
      JSON.stringify(rejected),
    ].join("\n").includes(rawToken),
    false,
    "the raw D1 calendar token must not appear in the error",
  );
}

async function assertTokenTouchUnchanged(request, tokenId, expected) {
  const current = await request({
    bindings: [tokenId],
    mode: "first",
    sql: `SELECT last_used_at
          FROM ics_subscription_tokens
          WHERE id = ?`,
  });
  assert.equal(current.last_used_at, expected);
}
