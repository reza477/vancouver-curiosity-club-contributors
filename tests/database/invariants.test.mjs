import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  DATABASE_INVARIANT_MARKER_KEY,
  DATABASE_INVARIANT_STATEMENT_LIMIT,
  DATABASE_INVARIANT_TRIGGER_NAMES,
  DATABASE_INVARIANT_TRIGGER_STATEMENTS,
  DATABASE_INVARIANT_VERSION,
  ensureDatabaseInvariants,
  getExpectedDatabaseInvariantFingerprint,
  normalizeTriggerDefinition,
} from "../../lib/server/database/invariants.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

function migrationSql() {
  return readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) =>
      readFileSync(join(process.cwd(), "drizzle", name), "utf8"),
    )
    .join("\n");
}

function newDatabase() {
  return new SqliteD1TestDatabase(migrationSql());
}

function isolatedBinding(database) {
  return {
    batch: (statements) => database.batch(statements),
    prepare: (sql) => database.prepare(sql),
  };
}

function countedBinding(database) {
  let statementCount = 0;
  const batchLengths = [];

  function wrap(statement) {
    return {
      inner: statement,
      bind(...values) {
        return wrap(statement.bind(...values));
      },
      async first(...arguments_) {
        statementCount += 1;
        return statement.first(...arguments_);
      },
      async all(...arguments_) {
        statementCount += 1;
        return statement.all(...arguments_);
      },
      async run(...arguments_) {
        statementCount += 1;
        return statement.run(...arguments_);
      },
    };
  }

  return {
    binding: {
      async batch(statements) {
        statementCount += statements.length;
        batchLengths.push(statements.length);
        return database.batch(statements.map((statement) => statement.inner));
      },
      prepare(sql) {
        return wrap(database.prepare(sql));
      },
    },
    counts() {
      return { batchLengths: [...batchLengths], statementCount };
    },
    resetCounts() {
      statementCount = 0;
      batchLengths.length = 0;
    },
  };
}

function assertWithinD1StatementCap(counter, label) {
  const { batchLengths, statementCount } = counter.counts();
  assert.ok(
    statementCount <= DATABASE_INVARIANT_STATEMENT_LIMIT,
    `${label} executed ${statementCount} statements; expected <= ${DATABASE_INVARIANT_STATEMENT_LIMIT}`,
  );
  assert.ok(
    batchLengths.every(
      (length) => length <= DATABASE_INVARIANT_STATEMENT_LIMIT,
    ),
    `${label} batch lengths ${batchLengths.join(", ")} exceeded ${DATABASE_INVARIANT_STATEMENT_LIMIT}`,
  );
}

test("concurrent isolate initialization installs one exact durable guard set", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  assert.equal(
    DATABASE_INVARIANT_TRIGGER_NAMES.length,
    30,
    "the v3 contract retains all prior guards and adds both profile identity/owner guards",
  );
  const firstCounter = countedBinding(database);
  const secondCounter = countedBinding(database);

  await Promise.all([
    ensureDatabaseInvariants(firstCounter.binding),
    ensureDatabaseInvariants(firstCounter.binding),
    ensureDatabaseInvariants(secondCounter.binding),
  ]);
  assertWithinD1StatementCap(firstCounter, "first concurrent cold isolate");
  assertWithinD1StatementCap(secondCounter, "second concurrent cold isolate");

  const expectedFingerprint =
    await getExpectedDatabaseInvariantFingerprint();
  assert.match(expectedFingerprint, /^[a-f0-9]{64}$/u);
  assert.deepEqual(await marker(database), {
    singleton_key: DATABASE_INVARIANT_MARKER_KEY,
    trigger_fingerprint: expectedFingerprint,
    version: DATABASE_INVARIANT_VERSION,
  });
  assert.deepEqual(
    await normalizedTriggerDefinitions(database),
    expectedTriggerDefinitions(),
  );
  assert.deepEqual(
    (await normalizedTriggerDefinitions(database)).map(({ name }) => name),
    [...DATABASE_INVARIANT_TRIGGER_NAMES],
  );
});

test("cold, healthy, missing, and ordinary mismatch paths stay under the D1 statement cap", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());

  const cold = countedBinding(database);
  assert.equal(await ensureDatabaseInvariants(cold.binding), "repaired");
  assertWithinD1StatementCap(cold, "cold installation");
  assert.deepEqual(cold.counts(), {
    batchLengths: [DATABASE_INVARIANT_TRIGGER_NAMES.length + 2],
    statementCount: DATABASE_INVARIANT_TRIGGER_NAMES.length + 8,
  });

  const healthy = countedBinding(database);
  assert.equal(await ensureDatabaseInvariants(healthy.binding), "ready");
  assertWithinD1StatementCap(healthy, "healthy verification");
  assert.deepEqual(healthy.counts(), {
    batchLengths: [],
    statementCount: 3,
  });

  database.exec(
    "DROP TRIGGER organizer_events_phase3_integrity_before_insert;",
  );
  const missing = countedBinding(database);
  assert.equal(await ensureDatabaseInvariants(missing.binding), "repaired");
  assertWithinD1StatementCap(missing, "missing-trigger repair");
  assert.deepEqual(missing.counts(), {
    batchLengths: [3],
    statementCount: 9,
  });

  database.exec(`
    DROP TRIGGER events_reservation_guard_before_insert;
    CREATE TRIGGER events_reservation_guard_before_insert
    BEFORE INSERT ON events
    BEGIN
      SELECT 1;
    END;
  `);
  const mismatch = countedBinding(database);
  assert.equal(await ensureDatabaseInvariants(mismatch.binding), "repaired");
  assertWithinD1StatementCap(mismatch, "single-mismatch repair");
  assert.deepEqual(mismatch.counts(), {
    batchLengths: [4],
    statementCount: 10,
  });
  assert.deepEqual(
    await normalizedTriggerDefinitions(database),
    expectedTriggerDefinitions(),
  );
});

test("repair requests terminate before app queries and a verified request retains the combined budget", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());

  const repairRequest = countedBinding(database);
  const repairStatus = await ensureDatabaseInvariants(
    repairRequest.binding,
  );
  let dispatchedAppQueries = 0;
  if (repairStatus === "ready") {
    dispatchedAppQueries += 1;
    await repairRequest.binding.prepare("SELECT 1").first();
  }
  assert.equal(repairStatus, "repaired");
  assert.equal(dispatchedAppQueries, 0);
  assertWithinD1StatementCap(repairRequest, "repair-only request");

  repairRequest.resetCounts();
  const verifiedRequest = repairRequest;
  assert.equal(
    await ensureDatabaseInvariants(verifiedRequest.binding),
    "ready",
  );
  for (let index = 0; index < 47; index += 1) {
    await verifiedRequest.binding.prepare("SELECT 1").first();
  }
  assert.equal(verifiedRequest.counts().statementCount, 50);
  assertWithinD1StatementCap(
    verifiedRequest,
    "verified request plus maximum application budget",
  );

  const workerSource = readFileSync(
    join(process.cwd(), "worker", "index.ts"),
    "utf8",
  );
  assert.match(
    workerSource,
    /invariantStatus === "repaired"[\s\S]*databaseInvariantUnavailableResponse\(\s*"The database safety checks were updated/u,
  );
});

test("a resolved same-isolate result never masks another isolate's invalidation", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  const firstIsolate = countedBinding(database);

  assert.equal(
    await ensureDatabaseInvariants(firstIsolate.binding),
    "repaired",
  );
  firstIsolate.resetCounts();
  assert.equal(await ensureDatabaseInvariants(firstIsolate.binding), "ready");
  assert.deepEqual(firstIsolate.counts(), {
    batchLengths: [],
    statementCount: 3,
  });

  database.exec(`
    DELETE FROM database_invariant_state
    WHERE singleton_key = 'database-guards';
    DROP TRIGGER organizer_events_phase3_integrity_before_insert;
  `);
  firstIsolate.resetCounts();
  assert.equal(
    await ensureDatabaseInvariants(firstIsolate.binding),
    "repaired",
  );
  assert.deepEqual(firstIsolate.counts(), {
    batchLengths: [3],
    statementCount: 9,
  });
  assertWithinD1StatementCap(
    firstIsolate,
    "same-isolate cross-repair detection",
  );
});

test("full mismatch repair converges through bounded fail-closed invocations", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariants(isolatedBinding(database));

  for (const name of DATABASE_INVARIANT_TRIGGER_NAMES) {
    database.exec(`
      DROP TRIGGER "${name}";
      CREATE TRIGGER "${name}"
      BEFORE INSERT ON profiles
      BEGIN
        SELECT 1;
      END;
    `);
  }

  const invalidation = countedBinding(database);
  await assert.rejects(
    ensureDatabaseInvariants(invalidation.binding),
    /Database integrity guards are unavailable/u,
  );
  assertWithinD1StatementCap(invalidation, "full-mismatch invalidation");
  assert.deepEqual(invalidation.counts(), {
    batchLengths: [DATABASE_INVARIANT_TRIGGER_NAMES.length + 1],
    statementCount: DATABASE_INVARIANT_TRIGGER_NAMES.length + 4,
  });
  assert.equal(await marker(database), null);
  assert.deepEqual(
    await normalizedTriggerDefinitions(database),
    [],
    "the first bounded invocation removes every bad definition and dispatches no application work",
  );

  const completion = countedBinding(database);
  assert.equal(
    await ensureDatabaseInvariants(completion.binding),
    "repaired",
  );
  assertWithinD1StatementCap(completion, "full-mismatch completion");
  assert.deepEqual(completion.counts(), {
    batchLengths: [DATABASE_INVARIANT_TRIGGER_NAMES.length + 2],
    statementCount: DATABASE_INVARIANT_TRIGGER_NAMES.length + 8,
  });
  assert.deepEqual(
    await normalizedTriggerDefinitions(database),
    expectedTriggerDefinitions(),
  );
  assert.ok(await marker(database));
});

test("a fresh isolate repairs a missing or mismatched expected trigger", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariants(isolatedBinding(database));

  database.exec(`
    DROP TRIGGER events_reservation_guard_before_insert;
    CREATE TRIGGER events_reservation_guard_before_insert
    BEFORE INSERT ON events
    BEGIN
      SELECT 1;
    END;
  `);
  assert.notDeepEqual(
    await normalizedTriggerDefinitions(database),
    expectedTriggerDefinitions(),
  );

  await ensureDatabaseInvariants(isolatedBinding(database));
  assert.deepEqual(
    await normalizedTriggerDefinitions(database),
    expectedTriggerDefinitions(),
  );
  assert.ok(await marker(database));
});

test("cross-organization probe failure leaves no durable readiness marker", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedOrganizations(database);
  database.exec(`
    INSERT INTO club_public_profiles (
      club_id, organization_id, primary_event_lane_id,
      publication_status, is_featured, created_at, updated_at
    ) VALUES (
      'club_a', 'org_b', 'lane_b', 'draft', 0, 1, 1
    );
    INSERT INTO event_public_details (
      event_id, organization_id, attendance_mode, created_at, updated_at
    ) VALUES (
      'event_a', 'org_b', 'location_undecided', 1, 1
    );
  `);

  const counter = countedBinding(database);
  await assert.rejects(
    ensureDatabaseInvariants(counter.binding),
    /Database integrity guards are unavailable/u,
  );
  assertWithinD1StatementCap(counter, "malformed-data rejection");
  assert.equal(await marker(database), null);
  assert.deepEqual(
    await normalizedTriggerDefinitions(database),
    [],
    "the atomic probe failure must roll back every trigger install",
  );

  database.exec(`
    DELETE FROM club_public_profiles;
    DELETE FROM event_public_details;
  `);
  await ensureDatabaseInvariants(counter.binding);
  assert.ok(await marker(database));
});

test("installed guards continue rejecting malformed public rows", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedOrganizations(database);
  await ensureDatabaseInvariants(isolatedBinding(database));

  assert.throws(
    () =>
      database.exec(`
        INSERT INTO club_public_profiles (
          club_id, organization_id, primary_event_lane_id,
          publication_status, is_featured, created_at, updated_at
        ) VALUES (
          'club_a', 'org_b', 'lane_b', 'draft', 0, 1, 1
        );
      `),
    /club_public_profiles_organization_mismatch/u,
  );
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO event_public_details (
          event_id, organization_id, attendance_mode, created_at, updated_at
        ) VALUES (
          'event_a', 'org_b', 'location_undecided', 1, 1
        );
      `),
    /event_public_details_organization_mismatch/u,
  );
});

test("installed guards keep audit history append-only", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedOrganizations(database);
  await ensureDatabaseInvariants(isolatedBinding(database));

  database.exec(`
    INSERT INTO audit_logs (
      id, organization_id, actor_profile_id, action, entity_type,
      entity_id, metadata_json, created_at
    ) VALUES (
      'audit-a', 'org_a', 'profile_a', 'created', 'event',
      'event_a', '{}', 1
    );
  `);
  assert.throws(
    () =>
      database.exec(`
        UPDATE audit_logs
        SET action = 'rewritten'
        WHERE id = 'audit-a';
      `),
    /audit_log_is_immutable/u,
  );
  assert.throws(
    () =>
      database.exec(`
        DELETE FROM audit_logs
        WHERE id = 'audit-a';
      `),
    /audit_log_is_immutable/u,
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT action, metadata_json
           FROM audit_logs
           WHERE id = 'audit-a'`,
        )
        .first()),
    },
    { action: "created", metadata_json: "{}" },
  );
});

test("membership identity and the sole usable Owner profile are database-guarded", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedOwnerInvariantData(database);
  await ensureDatabaseInvariants(isolatedBinding(database));

  assert.throws(
    () =>
      database.exec(`
        UPDATE organization_memberships
        SET normalized_email = 'crafted@example.test'
        WHERE id = 'membership-owner';
      `),
    /membership_identity_is_immutable/u,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE organization_memberships
        SET profile_id = 'profile-admin',
            normalized_email = 'admin@example.test'
        WHERE id = 'membership-owner';
      `),
    /membership_identity_is_immutable/u,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE profiles
        SET normalized_email = 'renamed-owner@example.test'
        WHERE id = 'profile-owner';
      `),
    /profile_membership_identity_is_immutable/u,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE profiles
        SET status = 'suspended'
        WHERE id = 'profile-owner';
      `),
    /organization_requires_exactly_one_owner/u,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE profiles
        SET deleted_at = 2
        WHERE id = 'profile-owner';
      `),
    /organization_requires_exactly_one_owner/u,
  );
  assert.throws(
    () =>
      database.exec(`
        DELETE FROM profiles
        WHERE id = 'profile-owner';
      `),
    /profile_membership_identity_is_immutable/u,
  );

  database.exec(`
    UPDATE profiles
    SET status = 'suspended'
    WHERE id = 'profile-admin';
  `);
  assert.equal(
    (
      await database
      .prepare(
        `SELECT status
         FROM profiles
         WHERE id = 'profile-admin'`,
      )
      .first()
    ).status,
    "suspended",
    "a non-owner profile remains administratively suspendable",
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT membership.profile_id, membership.normalized_email,
                  profile.status, profile.deleted_at
           FROM organization_memberships AS membership
           JOIN profiles AS profile ON profile.id = membership.profile_id
           WHERE membership.id = 'membership-owner'`,
        )
        .first()),
    },
    {
      deleted_at: null,
      normalized_email: "owner@example.test",
      profile_id: "profile-owner",
      status: "active",
    },
  );
});

test("malformed membership identity or an unusable sole Owner fails closed without a marker", async (t) => {
  for (const corrupt of [
    (database) =>
      database.exec(`
        UPDATE organization_memberships
        SET normalized_email = 'wrong-owner@example.test'
        WHERE id = 'membership-owner';
      `),
    (database) =>
      database.exec(`
        UPDATE profiles
        SET status = 'suspended'
        WHERE id = 'profile-owner';
      `),
    (database) =>
      database.exec(`
        UPDATE profiles
        SET deleted_at = 2
        WHERE id = 'profile-owner';
      `),
  ]) {
    const database = newDatabase();
    t.after(() => database.close());
    seedOwnerInvariantData(database);
    corrupt(database);

    await assert.rejects(
      ensureDatabaseInvariants(isolatedBinding(database)),
      /Database integrity guards are unavailable/u,
    );
    assert.equal(await marker(database), null);
    assert.deepEqual(
      await normalizedTriggerDefinitions(database),
      [],
      "a malformed owner/identity state must not retain a partial guard set",
    );
  }
});

test("organizer-event creators require same-organization membership, including history", async (t) => {
  const malformed = newDatabase();
  t.after(() => malformed.close());
  seedOwnerInvariantData(malformed);
  malformed.exec(`
    INSERT INTO organizer_events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, planning_status, publication_status, schedule_shape,
      timezone, created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'event-cross-org-creator', 'org-owner', 'club-owner', 'profile-owner',
      'Cross organization creator', 'cross-org-creator', 'idea', 'private',
      'unscheduled', 'America/Vancouver', 'profile-external',
      'profile-owner', 1, 1
    );
  `);
  await assert.rejects(
    ensureDatabaseInvariants(isolatedBinding(malformed)),
    /Database integrity guards are unavailable/u,
  );
  assert.equal(await marker(malformed), null);
  assert.deepEqual(await normalizedTriggerDefinitions(malformed), []);

  const historical = newDatabase();
  t.after(() => historical.close());
  seedOwnerInvariantData(historical);
  historical.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile-history', 'subject-history', 'history@example.test',
      'Historical creator', 'suspended', 1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership-history', 'org-owner', 'profile-history',
      'history@example.test', 'organizer', 'suspended',
      'profile-owner', 1, 1
    );
    INSERT INTO organizer_events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, planning_status, publication_status, schedule_shape,
      timezone, created_by_profile_id, updated_by_profile_id,
      created_at, updated_at, deleted_at
    ) VALUES (
      'event-historical-creator', 'org-owner', 'club-owner', 'profile-owner',
      'Historical creator', 'historical-creator', 'idea', 'private',
      'unscheduled', 'America/Vancouver', 'profile-history',
      'profile-owner', 1, 2, 2
    );
  `);
  assert.equal(
    await ensureDatabaseInvariants(isolatedBinding(historical)),
    "repaired",
    "same-organization historical creator membership remains a valid durable provenance link",
  );
  assert.ok(await marker(historical));
});

function seedOrganizations(database) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES
      ('profile_a', 'subject-a', 'a@example.test', 'Profile A', 'active', 1, 1),
      ('profile_b', 'subject-b', 'b@example.test', 'Profile B', 'active', 1, 1);

    INSERT INTO organizations (
      id, name, slug, timezone, created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'org_a', 'Organization A', 'organization-a', 'America/Vancouver',
        'profile_a', 1, 1
      ),
      (
        'org_b', 'Organization B', 'organization-b', 'America/Vancouver',
        'profile_b', 1, 1
      );

    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES
      ('club_a', 'org_a', 'Club A', 'club-a', 'profile_a', 1, 1),
      ('club_b', 'org_b', 'Club B', 'club-b', 'profile_b', 1, 1);

    INSERT INTO event_lanes (
      id, organization_id, name, slug, sort_order, created_by_profile_id,
      created_at, updated_at
    ) VALUES
      ('lane_a', 'org_a', 'Lane A', 'lane-a', 10, 'profile_a', 1, 1),
      ('lane_b', 'org_b', 'Lane B', 'lane-b', 10, 'profile_b', 1, 1);

    INSERT INTO events (
      id, organization_id, club_id, event_lane_id, title, slug,
      status, visibility, time_kind, starts_at_utc, ends_at_utc, timezone,
      buffer_before_minutes, buffer_after_minutes, organizer_scope_json,
      schedule_version, schedule_review_state, created_by_profile_id,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'event_a', 'org_a', 'club_a', 'lane_a', 'Event A', 'event-a',
      'draft', 'private', 'timed', 1800000000000, 1800003600000,
      'America/Vancouver', 0, 0, '[]', 1, 'unreviewed',
      'profile_a', 'profile_a', 1, 1
    );
  `);
}

function seedOwnerInvariantData(database) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES
      (
        'profile-owner', 'subject-owner', 'owner@example.test',
        'Owner', 'active', 1, 1
      ),
      (
        'profile-admin', 'subject-admin', 'admin@example.test',
        'Administrator', 'active', 1, 1
      ),
      (
        'profile-external', 'subject-external', 'external@example.test',
        'External Owner', 'active', 1, 1
      );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'org-owner', 'Owner Organization', 'owner-organization',
        'America/Vancouver', 1, 'profile-owner', 1, 1
      ),
      (
        'org-external', 'External Organization', 'external-organization',
        'America/Vancouver', 1, 'profile-external', 1, 1
      );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'membership-owner', 'org-owner', 'profile-owner',
        'owner@example.test', 'owner', 'active', 'profile-owner', 1, 1
      ),
      (
        'membership-admin', 'org-owner', 'profile-admin',
        'admin@example.test', 'administrator', 'active',
        'profile-owner', 1, 1
      ),
      (
        'membership-external', 'org-external', 'profile-external',
        'external@example.test', 'owner', 'active',
        'profile-external', 1, 1
      );
    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'club-owner', 'org-owner', 'Owner Club', 'owner-club',
      'profile-owner', 1, 1
    );
  `);
}

async function marker(database) {
  return database
    .prepare(
      `SELECT singleton_key, version, trigger_fingerprint
       FROM database_invariant_state
       WHERE singleton_key = ?`,
    )
    .bind(DATABASE_INVARIANT_MARKER_KEY)
    .first()
    .then((row) => (row ? { ...row } : null));
}

function expectedTriggerDefinitions() {
  return DATABASE_INVARIANT_TRIGGER_STATEMENTS.map((sql) => ({
    name: triggerName(sql),
    sql: normalizeTriggerDefinition(sql),
  })).sort((left, right) => left.name.localeCompare(right.name));
}

async function normalizedTriggerDefinitions(database) {
  return database
    .prepare(
      `SELECT name, sql
       FROM sqlite_master
       WHERE type = 'trigger'
       ORDER BY name`,
    )
    .all()
    .then((result) =>
      result.results.map((row) => ({
        name: row.name,
        sql: normalizeTriggerDefinition(row.sql),
      })),
    );
}

function triggerName(sql) {
  return /^CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS\s+([A-Za-z0-9_]+)/iu.exec(
    sql.trim(),
  )[1];
}
