import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  DATABASE_INVARIANT_MARKER_KEY,
  DATABASE_INVARIANT_STATEMENT_LIMIT,
  DATABASE_INVARIANT_TRIGGER_NAMES,
  DATABASE_INVARIANT_TRIGGER_STATEMENTS,
  DATABASE_INVARIANT_VERSION,
  PRE_PHASE7_DATABASE_INVARIANT_TRIGGER_NAMES,
  ensureDatabaseInvariants,
  ensureDatabaseInvariantsForRequest,
  getExpectedDatabaseInvariantFingerprint,
  normalizeTriggerDefinition,
} from "../../lib/server/database/invariants.ts";
import { normalizeAllDayConflictInterval } from "../../lib/server/organizer/conflict-domain.ts";
import {
  ORGANIZER_PUBLIC_SLUG_COLLISION_QUERY_SQL,
  PHASE5_INVARIANT_COUNT_SQL,
} from "../../lib/server/organizer/publication-invariant-sql.ts";
import {
  PHASE6_INVARIANT_COUNT_SQL,
} from "../../lib/server/database/phase6-invariant-sql.ts";
import {
  PHASE7_INVARIANT_TRIGGER_STATEMENTS,
} from "../../lib/server/database/phase7-invariant-sql.ts";
import { MAX_DATABASE_INVARIANT_READY_ATTEMPTS } from "./invariant-ready.mjs";
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

async function ensureInvariantReadiness(database, label = "invariant install") {
  const attempts = [];
  for (
    let index = 0;
    index < MAX_DATABASE_INVARIANT_READY_ATTEMPTS;
    index += 1
  ) {
    const counter = countedBinding(database);
    const status = await ensureDatabaseInvariants(counter.binding);
    assertWithinD1StatementCap(counter, `${label} request ${index + 1}`);
    attempts.push({ counts: counter.counts(), status });
    const currentMarker = await marker(database);
    if (
      status === "ready" &&
      currentMarker?.version === DATABASE_INVARIANT_VERSION
    ) {
      return attempts;
    }
  }
  assert.fail(`${label} did not reach the durable v6 readiness marker`);
}

async function assertEventuallyFailsClosed(database, label) {
  for (
    let index = 0;
    index < MAX_DATABASE_INVARIANT_READY_ATTEMPTS;
    index += 1
  ) {
    const counter = countedBinding(database);
    try {
      await ensureDatabaseInvariants(counter.binding);
    } catch (error) {
      assert.match(
        String(error),
        /Database integrity guards are unavailable/u,
      );
      assertWithinD1StatementCap(counter, `${label} request ${index + 1}`);
      assert.equal(await marker(database), null);
      return;
    }
    assertWithinD1StatementCap(counter, `${label} request ${index + 1}`);
    assert.equal(
      await marker(database),
      null,
      `${label} must not certify malformed data while adoption is staged`,
    );
  }
  assert.fail(`${label} never failed closed`);
}

test("concurrent isolate initialization installs one exact durable guard set", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  const expectedTriggerCount =
    PRE_PHASE7_DATABASE_INVARIANT_TRIGGER_NAMES.length +
    PHASE7_INVARIANT_TRIGGER_STATEMENTS.length;
  assert.equal(
    DATABASE_INVARIANT_TRIGGER_NAMES.length,
    expectedTriggerCount,
    "the v7 contract retains every prior guard and adds every Phase 7 guard",
  );
  assert.equal(
    new Set(DATABASE_INVARIANT_TRIGGER_NAMES).size,
    expectedTriggerCount,
    "the composed v7 trigger contract contains no duplicate names",
  );
  const firstCounter = countedBinding(database);
  const secondCounter = countedBinding(database);
  const thirdCounter = countedBinding(database);

  await Promise.all([
    ensureDatabaseInvariants(firstCounter.binding),
    ensureDatabaseInvariants(secondCounter.binding),
    ensureDatabaseInvariants(thirdCounter.binding),
  ]);
  assertWithinD1StatementCap(firstCounter, "first concurrent cold isolate");
  assertWithinD1StatementCap(secondCounter, "second concurrent cold isolate");
  assertWithinD1StatementCap(thirdCounter, "third concurrent cold isolate");
  await ensureInvariantReadiness(database, "concurrent convergence");

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

test("the compile-time invariant fingerprint stays memoized", async () => {
  const expected = await getExpectedDatabaseInvariantFingerprint();
  const startedAt = performance.now();
  for (let index = 0; index < 200; index += 1) {
    assert.equal(await getExpectedDatabaseInvariantFingerprint(), expected);
  }
  const averageMs = (performance.now() - startedAt) / 200;
  assert.ok(
    averageMs < 0.05,
    `memoized fingerprint calls averaged ${averageMs.toFixed(4)} ms`,
  );
});

test("healthy public reads reuse five-second readiness while private and mutating requests reverify", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureInvariantReadiness(database, "public readiness TTL setup");

  const counter = countedBinding(database);
  assert.equal(
    await ensureDatabaseInvariantsForRequest(counter.binding, {
      method: "GET",
      pathname: "/events",
    }),
    "ready",
  );
  assert.equal(counter.counts().statementCount, 2);

  counter.resetCounts();
  assert.equal(
    await ensureDatabaseInvariantsForRequest(counter.binding, {
      method: "HEAD",
      pathname: "/events",
    }),
    "ready",
  );
  assert.equal(
    counter.counts().statementCount,
    0,
    "a healthy warm public read must not query D1 again within the TTL",
  );

  counter.resetCounts();
  assert.equal(
    await ensureDatabaseInvariantsForRequest(counter.binding, {
      method: "GET",
      pathname: "/organizer",
    }),
    "ready",
  );
  assert.equal(counter.counts().statementCount, 2);

  counter.resetCounts();
  assert.equal(
    await ensureDatabaseInvariantsForRequest(counter.binding, {
      method: "POST",
      pathname: "/events",
    }),
    "ready",
  );
  assert.equal(counter.counts().statementCount, 2);
});

test("empty and twelve-record legacy-attribution upgrades converge to an observed ready request within the D1 cap", async (t) => {
  const empty = newDatabase();
  t.after(() => empty.close());
  const emptyAttempts = await ensureInvariantReadiness(
    empty,
    "empty v6 convergence",
  );
  const expectedEmptyTrace = [
    ...Array.from(
      { length: 6 },
      () => ({
        counts: { batchLengths: [39], statementCount: 46 },
        status: "repaired",
      }),
    ),
    {
      counts: { batchLengths: [22], statementCount: 29 },
      status: "repaired",
    },
    {
      counts: { batchLengths: [25], statementCount: 34 },
      status: "repaired",
    },
    {
      counts: { batchLengths: [], statementCount: 2 },
      status: "ready",
    },
  ];
  assert.deepEqual(
    emptyAttempts,
    expectedEmptyTrace,
    "empty v7 initialization uses eight bounded repair responses before the terminal ready response",
  );
  assert.equal(emptyAttempts.at(-1)?.status, "ready");
  assert.ok(
    emptyAttempts
      .slice(0, -1)
      .every(({ status }) => status === "repaired"),
  );
  assert.ok(
    emptyAttempts.every(
      ({ counts }) =>
        counts.statementCount < DATABASE_INVARIANT_STATEMENT_LIMIT &&
        counts.batchLengths.every(
          (length) => length <= DATABASE_INVARIANT_STATEMENT_LIMIT,
        ),
    ),
  );
  assert.equal(
    Math.max(
      ...emptyAttempts.map(({ counts }) => counts.statementCount),
    ),
    46,
  );
  const expectedFingerprint =
    await getExpectedDatabaseInvariantFingerprint();
  assert.deepEqual(await marker(empty), {
    singleton_key: DATABASE_INVARIANT_MARKER_KEY,
    trigger_fingerprint: expectedFingerprint,
    version: DATABASE_INVARIANT_VERSION,
  });
  assert.deepEqual(await legacyAttributionAdoptionSummary(empty), {
    auditCount: 0,
    intentCount: 0,
    openIntentCount: 0,
    receiptCount: 0,
    sentinelCount: 0,
    stateCount: 0,
    validCount: 0,
  });
  assert.deepEqual(await taxonomyAdoptionSummary(empty), {
    auditCount: 0,
    intentCount: 0,
    openIntentCount: 0,
    stateCount: 0,
  });

  const legacy = newDatabase();
  t.after(() => legacy.close());
  seedOwnerInvariantData(legacy);
  legacy.exec(`
    INSERT INTO event_lanes (
      id, organization_id, name, slug, description, sort_order,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'lane-legacy-taxonomy', 'org-owner', 'Legacy Taxonomy Lane',
      'legacy-taxonomy-lane', 'Awaiting bounded adoption.', 10,
      'profile-owner', 1, 1
    );
    INSERT INTO categories (
      id, organization_id, name, slug, description, color_token,
      created_at, updated_at
    ) VALUES (
      'category-legacy-taxonomy', 'org-owner',
      'Legacy Taxonomy Category', 'legacy-taxonomy-category',
      'Awaiting bounded adoption.', 'forest', 1, 1
    );
  `);
  await legacy
    .prepare(
      `UPDATE profiles
       SET public_attribution_consent = 1
       WHERE id = 'profile-owner'`,
    )
    .run();
  for (let index = 1; index < 12; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const profileId = `profile-legacy-attribution-${suffix}`;
    const email = `legacy-attribution-${suffix}@example.test`;
    await legacy
      .prepare(
        `INSERT INTO profiles (
           id, siwc_subject, normalized_email, display_name,
           public_attribution_consent, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 1, 'active', 1, 1)`,
      )
      .bind(
        profileId,
        `subject-legacy-attribution-${suffix}`,
        email,
        `Legacy attribution ${suffix}`,
      )
      .run();
    await legacy
      .prepare(
        `INSERT INTO organization_memberships (
           id, organization_id, profile_id, normalized_email, role, status,
           created_by_profile_id, created_at, updated_at
         ) VALUES (?, 'org-owner', ?, ?, 'administrator', 'active',
                   'profile-owner', 1, 1)`,
      )
      .bind(`membership-legacy-attribution-${suffix}`, profileId, email)
      .run();
  }
  const initialPhase6Counts = await Promise.all(
    PHASE6_INVARIANT_COUNT_SQL.map((sql) =>
      legacy.prepare(sql).first("violation_count"),
    ),
  );
  const expectedInitialCounts = PHASE6_INVARIANT_COUNT_SQL.map(() => 0);
  const legacyAttributionCountIndex = PHASE6_INVARIANT_COUNT_SQL.findIndex(
    (sql) =>
      sql.includes("profile.public_attribution_consent = 1") &&
      sql.includes("FROM profiles AS profile"),
  );
  assert.notEqual(
    legacyAttributionCountIndex,
    -1,
    "the legacy-attribution integrity count remains part of the exported contract",
  );
  expectedInitialCounts[legacyAttributionCountIndex] = 12;
  expectedInitialCounts[PHASE6_INVARIANT_COUNT_SQL.length - 1] = 2;
  assert.deepEqual(initialPhase6Counts.map(Number), expectedInitialCounts);

  const legacyAttempts = await ensureInvariantReadiness(
    legacy,
    "twelve-record legacy attribution convergence",
  );
  const expectedLegacyTrace = [
    {
      counts: { batchLengths: [3], statementCount: 6 },
      status: "repaired",
    },
    ...Array.from(
      { length: 12 },
      () => ({
        counts: { batchLengths: [9], statementCount: 15 },
        status: "repaired",
      }),
    ),
    {
      counts: { batchLengths: [11], statementCount: 18 },
      status: "repaired",
    },
    ...Array.from(
      { length: 6 },
      () => ({
        counts: { batchLengths: [39], statementCount: 46 },
        status: "repaired",
      }),
    ),
    {
      counts: { batchLengths: [22], statementCount: 29 },
      status: "repaired",
    },
    {
      counts: { batchLengths: [25], statementCount: 34 },
      status: "repaired",
    },
    {
      counts: { batchLengths: [], statementCount: 2 },
      status: "ready",
    },
  ];
  assert.deepEqual(
    legacyAttempts,
    expectedLegacyTrace,
    "one policy repair, twelve one-record attribution adoptions, one set-based taxonomy adoption, six full guard-repair batches, two tail repair batches, and one final ready request are required",
  );
  assert.equal(legacyAttempts.at(-1)?.status, "ready");
  assert.ok(
    legacyAttempts
      .slice(0, -1)
      .every(({ status }) => status === "repaired"),
  );
  assert.ok(
    legacyAttempts.every(
      ({ counts }) =>
        counts.statementCount < DATABASE_INVARIANT_STATEMENT_LIMIT &&
        counts.batchLengths.every(
          (length) => length <= DATABASE_INVARIANT_STATEMENT_LIMIT,
        ),
    ),
  );
  assert.equal(
    Math.max(
      ...legacyAttempts.map(({ counts }) => counts.statementCount),
    ),
    46,
  );
  const adoptedSummary = await legacyAttributionAdoptionSummary(legacy);
  assert.deepEqual(adoptedSummary, {
    auditCount: 12,
    intentCount: 12,
    openIntentCount: 0,
    receiptCount: 12,
    sentinelCount: 0,
    stateCount: 12,
    validCount: 12,
  });
  const taxonomySummary = await taxonomyAdoptionSummary(legacy);
  assert.deepEqual(taxonomySummary, {
    auditCount: 2,
    intentCount: 2,
    openIntentCount: 0,
    stateCount: 2,
  });
  assert.deepEqual(await marker(legacy), {
    singleton_key: DATABASE_INVARIANT_MARKER_KEY,
    trigger_fingerprint: expectedFingerprint,
    version: DATABASE_INVARIANT_VERSION,
  });
  assert.deepEqual(
    await Promise.all(
      PHASE6_INVARIANT_COUNT_SQL.map((sql) =>
        legacy.prepare(sql).first("violation_count"),
      ),
    ).then((counts) => counts.map(Number)),
    PHASE6_INVARIANT_COUNT_SQL.map(() => 0),
  );

  for (let request = 1; request <= 2; request += 1) {
    const counter = countedBinding(legacy);
    assert.equal(await ensureDatabaseInvariants(counter.binding), "ready");
    assert.deepEqual(counter.counts(), {
      batchLengths: [],
      statementCount: 2,
    });
    assertWithinD1StatementCap(
      counter,
      `idempotent attribution-ready request ${request}`,
    );
  }
  assert.deepEqual(
    await legacyAttributionAdoptionSummary(legacy),
    adoptedSummary,
    "healthy retries must not duplicate adopted states, intents, receipts, or audit history",
  );
  assert.deepEqual(
    await taxonomyAdoptionSummary(legacy),
    taxonomySummary,
    "healthy retries must not duplicate taxonomy states, intents, or audit history",
  );
});

test("synchronized legacy-attribution adoption creates one complete receipt graph and the losing isolate converges without residue", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedOwnerInvariantData(database);
  database.exec(`
    UPDATE profiles
    SET public_attribution_consent = 1
    WHERE id = 'profile-owner';
    INSERT INTO organizer_conflict_policies (
      id, organization_id, mode, policy_version, default_hold_hours,
      nearing_expiry_hours, updated_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'phase4-policy-org-owner', 'org-owner', 'warn_reason', 1, 72, 24,
        'profile-owner', 1, 1
      ),
      (
        'phase4-policy-org-external', 'org-external', 'warn_reason', 1, 72, 24,
        'profile-external', 1, 1
      );
  `);

  const firstCounter = countedBinding(database);
  const secondCounter = countedBinding(database);
  const barrier = twoPartyBarrier();
  const statuses = await Promise.all([
    ensureDatabaseInvariants(
      synchronizeFirstInvariantBatch(firstCounter.binding, barrier),
    ),
    ensureDatabaseInvariants(
      synchronizeFirstInvariantBatch(secondCounter.binding, barrier),
    ),
  ]);
  assert.deepEqual(statuses, ["repaired", "repaired"]);
  assertWithinD1StatementCap(
    firstCounter,
    "first synchronized attribution adopter",
  );
  assertWithinD1StatementCap(
    secondCounter,
    "second synchronized attribution adopter",
  );
  assert.ok(
    firstCounter.counts().statementCount <
      DATABASE_INVARIANT_STATEMENT_LIMIT,
  );
  assert.ok(
    secondCounter.counts().statementCount <
      DATABASE_INVARIANT_STATEMENT_LIMIT,
  );
  assert.deepEqual(await legacyAttributionAdoptionSummary(database), {
    auditCount: 1,
    intentCount: 1,
    openIntentCount: 0,
    receiptCount: 1,
    sentinelCount: 0,
    stateCount: 1,
    validCount: 1,
  });

  const convergence = await ensureInvariantReadiness(
    database,
    "synchronized attribution loser convergence",
  );
  assert.equal(convergence.at(-1)?.status, "ready");
  assert.ok(
    convergence.every(
      ({ counts }) =>
        counts.statementCount < DATABASE_INVARIANT_STATEMENT_LIMIT,
    ),
  );
  assert.deepEqual(await legacyAttributionAdoptionSummary(database), {
    auditCount: 1,
    intentCount: 1,
    openIntentCount: 0,
    receiptCount: 1,
    sentinelCount: 0,
    stateCount: 1,
    validCount: 1,
  });
  assert.deepEqual(
    await Promise.all(
      PHASE6_INVARIANT_COUNT_SQL.map((sql) =>
        database.prepare(sql).first("violation_count"),
      ),
    ).then((counts) => counts.map(Number)),
    PHASE6_INVARIANT_COUNT_SQL.map(() => 0),
  );
});

test("cold, healthy, missing, and ordinary mismatch paths stay under the D1 statement cap", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());

  const expectedColdTrace = [
    { batchLengths: [39], statementCount: 46 },
    { batchLengths: [39], statementCount: 46 },
    { batchLengths: [39], statementCount: 46 },
    { batchLengths: [39], statementCount: 46 },
    { batchLengths: [39], statementCount: 46 },
    { batchLengths: [39], statementCount: 46 },
    { batchLengths: [22], statementCount: 29 },
    { batchLengths: [25], statementCount: 34 },
  ];
  for (const [index, expectedCounts] of expectedColdTrace.entries()) {
    const request = countedBinding(database);
    assert.equal(
      await ensureDatabaseInvariants(request.binding),
      "repaired",
    );
    assertWithinD1StatementCap(
      request,
      `cold installation request ${index + 1}`,
    );
    assert.deepEqual(request.counts(), expectedCounts);
    assert.ok(
      request.counts().statementCount < DATABASE_INVARIANT_STATEMENT_LIMIT,
      "every fail-closed setup request retains statement headroom",
    );
    assert.equal(
      Boolean(await marker(database)),
      index === expectedColdTrace.length - 1,
    );
  }

  const healthy = countedBinding(database);
  assert.equal(await ensureDatabaseInvariants(healthy.binding), "ready");
  assertWithinD1StatementCap(healthy, "healthy verification");
  assert.deepEqual(healthy.counts(), {
    batchLengths: [],
    statementCount: 2,
  });

  database.exec(
    "DROP TRIGGER organizer_events_phase3_integrity_before_insert;",
  );
  const missing = countedBinding(database);
  assert.equal(await ensureDatabaseInvariants(missing.binding), "repaired");
  assertWithinD1StatementCap(missing, "missing-trigger repair");
  assert.deepEqual(missing.counts(), {
    batchLengths: [26],
    statementCount: 31,
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
    batchLengths: [27],
    statementCount: 32,
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

  await ensureInvariantReadiness(database, "repair request convergence");
  const verifiedRequest = countedBinding(database);
  assert.equal(await ensureDatabaseInvariants(verifiedRequest.binding), "ready");
  for (let index = 0; index < 48; index += 1) {
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

  assert.equal(await ensureDatabaseInvariants(firstIsolate.binding), "repaired");
  await ensureInvariantReadiness(database, "same-isolate initial convergence");
  firstIsolate.resetCounts();
  assert.equal(await ensureDatabaseInvariants(firstIsolate.binding), "ready");
  assert.deepEqual(firstIsolate.counts(), {
    batchLengths: [],
    statementCount: 2,
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
    batchLengths: [26],
    statementCount: 35,
  });
  assertWithinD1StatementCap(
    firstIsolate,
    "same-isolate cross-repair detection",
  );
});

test("full mismatch repair converges through bounded fail-closed invocations", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureInvariantReadiness(database, "full mismatch setup");

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

  const attempts = await ensureInvariantReadiness(
    database,
    "full-mismatch convergence",
  );
  assert.ok(
    attempts.length >= 2,
    "complete corruption must converge across bounded fail-closed requests",
  );
  assert.ok(
    attempts.slice(0, -1).every(({ status }) => status === "repaired"),
  );
  assert.ok(
    attempts.every(({ counts }) => counts.statementCount <= 50),
  );
  assert.deepEqual(
    await normalizedTriggerDefinitions(database),
    expectedTriggerDefinitions(),
  );
  assert.ok(await marker(database));
});

test("a fresh isolate repairs a missing or mismatched expected trigger", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureInvariantReadiness(database, "fresh-isolate setup");

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

  await ensureInvariantReadiness(database, "fresh-isolate repair");
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
    INSERT INTO audit_logs (
      id, organization_id, actor_profile_id, action, entity_type,
      entity_id, metadata_json, created_at
    ) VALUES (
      'audit-partial-install', 'org_a', 'profile_a', 'created', 'event',
      'event_a', '{}', 1
    );
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

  await assertEventuallyFailsClosed(database, "malformed-data rejection");
  assert.equal(await marker(database), null);
  await assertInstalledGuardSetFailClosed(
    database,
    "the malformed-data probe failure",
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE audit_logs
        SET action = 'rewritten'
        WHERE id = 'audit-partial-install';
      `),
    /audit_log_is_immutable/u,
    "an already-installed guard must remain protective while readiness stays unavailable",
  );

  database.exec(`
    DELETE FROM club_public_profiles;
    DELETE FROM event_public_details;
  `);
  await ensureInvariantReadiness(database, "malformed-data recovery");
  assert.ok(await marker(database));
  assert.deepEqual(
    await normalizedTriggerDefinitions(database),
    expectedTriggerDefinitions(),
    "retry must converge the staged subset to the exact complete trigger contract",
  );
});

test("installed guards continue rejecting malformed public rows", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedOrganizations(database);
  await ensureInvariantReadiness(database, "public guard setup");

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
  await ensureInvariantReadiness(database, "audit guard setup");

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
  await ensureInvariantReadiness(database, "owner guard setup");

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

    await assertEventuallyFailsClosed(database, "malformed owner data");
    await assertInstalledGuardSetFailClosed(
      database,
      "the malformed owner/identity state",
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
  await assertEventuallyFailsClosed(
    malformed,
    "cross-organization creator",
  );
  await assertInstalledGuardSetFailClosed(
    malformed,
    "the cross-organization creator state",
  );

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
  await ensureInvariantReadiness(
    historical,
    "same-organization historical creator",
  );
  assert.ok(await marker(historical));
});

test("Phase 5 readiness fails closed for location-undecided public events", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedOwnerInvariantData(database);
  database.exec(`
    INSERT INTO event_lanes (
      id, organization_id, name, slug, sort_order,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'lane-owner', 'org-owner', 'Think', 'think', 10,
      'profile-owner', 1, 1
    );
    INSERT INTO club_public_profiles (
      club_id, organization_id, primary_event_lane_id,
      publication_status, is_featured, published_at,
      created_at, updated_at
    ) VALUES (
      'club-owner', 'org-owner', 'lane-owner',
      'published', 1, 1, 1, 1
    );
    INSERT INTO organizer_events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, summary, description, planning_status,
      publication_status, schedule_shape, starts_at_utc, ends_at_utc,
      timezone, content_version, schedule_version,
      created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'event-location-undecided', 'org-owner', 'club-owner',
      'profile-owner', 'Location undecided', 'location-undecided',
      'A complete summary', 'A complete public description',
      'confirmed', 'published', 'timed',
      1960000000000, 1960003600000, 'America/Vancouver', 1, 1,
      'profile-owner', 'profile-owner', 1, 1
    );
    INSERT INTO organizer_event_public_details (
      organizer_event_id, organization_id, attendance_mode,
      availability_state, public_hosts_enabled, rsvp_mode,
      created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'event-location-undecided', 'org-owner', 'location_undecided',
      'open', 0, 'coming_soon', 'profile-owner', 'profile-owner', 1, 1
    );
    INSERT INTO organizer_event_publication_state (
      organizer_event_id, organization_id, first_published_at,
      most_recent_published_at, last_mutation_actor_profile_id,
      created_at, updated_at
    ) VALUES (
      'event-location-undecided', 'org-owner', 1, 1,
      'profile-owner', 1, 1
    );
  `);
  assert.equal(
    (
      await database
        .prepare(PHASE5_INVARIANT_COUNT_SQL[4])
        .first()
    ).violation_count,
    1,
    "the Phase 5 readiness scan must reject location-undecided events",
  );

  await assertEventuallyFailsClosed(
    database,
    "location-undecided public event",
  );
  await assertInstalledGuardSetFailClosed(
    database,
    "the non-ready public event state",
  );
});

test("the shared public-slug guard includes tentative legacy candidates but excludes Meetup-owned canonical rows", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedOwnerInvariantData(database);
  database.exec(`
    INSERT INTO events (
      id, organization_id, club_id, title, slug, status, visibility,
      time_kind, starts_at_utc, ends_at_utc, timezone,
      buffer_before_minutes, buffer_after_minutes, organizer_scope_json,
      schedule_version, schedule_review_state, published_at,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'legacy-tentative', 'org-owner', 'club-owner',
      'Tentative legacy event', 'shared-public-slug', 'tentative', 'public',
      'timed', 1960000000000, 1960003600000, 'America/Vancouver',
      0, 0, '[]', 1, 'unreviewed', 1,
      'profile-owner', 'profile-owner', 1, 1
    );
  `);
  const collision = await database
    .prepare(ORGANIZER_PUBLIC_SLUG_COLLISION_QUERY_SQL)
    .bind("org-owner", "organizer-candidate", "shared-public-slug")
    .first();
  assert.equal(collision?.collision, 1);

  database.exec(`
    INSERT INTO sync_sources (
      id, organization_id, club_id, source_type, source_url, enabled,
      refresh_interval_minutes, created_by_profile_id,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'source-test-only', 'org-owner', 'club-owner', 'meetup_ics',
      'https://example.invalid/test-only-calendar', 1, 15,
      'profile-owner', 'profile-owner', 1, 1
    );
    INSERT INTO external_source_links (
      id, organization_id, entity_type, entity_id, source_type,
      sync_source_id, external_id, created_at, updated_at
    ) VALUES (
      'meetup-owned-link', 'org-owner', 'event', 'legacy-tentative',
      'meetup_ics', 'source-test-only', 'meetup-owned-uid', 1, 1
    );
  `);
  const excluded = await database
    .prepare(ORGANIZER_PUBLIC_SLUG_COLLISION_QUERY_SQL)
    .bind("org-owner", "organizer-candidate", "shared-public-slug")
    .first();
  assert.equal(excluded, null);
});

test("v4 adoption creates exact timed and all-day manual projections once", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedOwnerInvariantData(database);
  database.exec(`
    INSERT INTO organizer_events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, planning_status, publication_status, schedule_shape,
      starts_at_utc, ends_at_utc, timezone,
      all_day_start_date, all_day_end_date_exclusive,
      buffer_before_minutes, buffer_after_minutes,
      content_version, schedule_version,
      created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES
      (
        'event-adopt-timed', 'org-owner', 'club-owner', 'profile-owner',
        'Timed adoption', 'timed-adoption', 'draft', 'private', 'timed',
        1960000000000, 1960007200000, 'America/Vancouver',
        NULL, NULL, 30, 15, 3, 7,
        'profile-owner', 'profile-owner', 1, 1
      ),
      (
        'event-adopt-all-day', 'org-owner', 'club-owner', 'profile-owner',
        'All-day adoption', 'all-day-adoption', 'idea', 'private',
        'all_day', NULL, NULL, 'America/Vancouver',
        '2032-03-14', '2032-03-16', 0, 0, 2, 5,
        'profile-owner', 'profile-owner', 1, 1
      );
  `);

  const attempts = await ensureInvariantReadiness(
    database,
    "manual projection adoption",
  );
  assert.ok(attempts.length >= 3, "policy and projection adoption are staged");
  const expectedAllDay = normalizeAllDayConflictInterval({
    startDate: "2032-03-14",
    endDateExclusive: "2032-03-16",
    timeZone: "America/Vancouver",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
  });
  const states = await database
    .prepare(
      `SELECT organizer_event_id, planning_status, schedule_shape,
              actual_start_utc, actual_end_utc, expanded_start_utc,
              expanded_end_utc, timezone, organizer_scope_json,
              schedule_version
       FROM organizer_reservation_states
       WHERE organizer_event_id IN (
         'event-adopt-timed', 'event-adopt-all-day'
       )
       ORDER BY organizer_event_id`,
    )
    .all();
  assert.deepEqual(
    states.results.map((state) => ({ ...state })),
    [
      {
        actual_end_utc: expectedAllDay.actualEndUtc,
        actual_start_utc: expectedAllDay.actualStartUtc,
        expanded_end_utc: expectedAllDay.expandedEndUtc,
        expanded_start_utc: expectedAllDay.expandedStartUtc,
        organizer_event_id: "event-adopt-all-day",
        organizer_scope_json: '["profile-owner"]',
        planning_status: "idea",
        schedule_shape: "all_day",
        schedule_version: 5,
        timezone: "America/Vancouver",
      },
      {
        actual_end_utc: 1960007200000,
        actual_start_utc: 1960000000000,
        expanded_end_utc: 1960008100000,
        expanded_start_utc: 1959998200000,
        organizer_event_id: "event-adopt-timed",
        organizer_scope_json: '["profile-owner"]',
        planning_status: "draft",
        schedule_shape: "timed",
        schedule_version: 7,
        timezone: "America/Vancouver",
      },
    ],
  );
  const intentCount = await database
    .prepare(
      `SELECT count(*) AS count
       FROM organizer_schedule_write_intents
       WHERE operation = 'phase4_backfill'`,
    )
    .first("count");
  await Promise.all([
    ensureDatabaseInvariants({
      prepare: (sql) => database.prepare(sql),
      batch: (statements) => database.batch(statements),
    }),
    ensureDatabaseInvariants({
      prepare: (sql) => database.prepare(sql),
      batch: (statements) => database.batch(statements),
    }),
  ]);
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM organizer_schedule_write_intents
         WHERE operation = 'phase4_backfill'`,
      )
      .first("count"),
    intentCount,
    "ready/repeated isolates must not duplicate adoption intents",
  );
});

test("v4 adopts only active legacy reservations across updater roles and repairs a corrupt projection fail-closed", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedOwnerInvariantData(database);
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile-organizer', 'subject-organizer',
      'organizer@example.test', 'Organizer', 'active', 1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership-organizer', 'org-owner', 'profile-organizer',
      'organizer@example.test', 'organizer', 'active',
      'profile-owner', 1, 1
    );
    INSERT INTO events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, status, visibility, time_kind,
      starts_at_utc, ends_at_utc, timezone,
      all_day_start_date, all_day_end_date_exclusive,
      buffer_before_minutes, buffer_after_minutes,
      organizer_scope_json, schedule_version, schedule_review_state,
      hold_expires_at, created_by_profile_id, updated_by_profile_id,
      created_at, updated_at, deleted_at
    ) VALUES
      (
        'legacy-owner', 'org-owner', 'club-owner', 'profile-owner',
        'Owner legacy', 'owner-legacy', 'confirmed', 'private', 'timed',
        1970000000000, 1970003600000, 'America/Vancouver',
        NULL, NULL, 0, 0, '["profile-owner"]', 2, 'unreviewed', NULL,
        'profile-owner', 'profile-owner', 1, 1, NULL
      ),
      (
        'legacy-admin-all-day', 'org-owner', 'club-owner',
        'profile-owner', 'Admin all-day legacy', 'admin-all-day-legacy',
        'confirmed', 'private', 'all_day', NULL, NULL,
        'America/Vancouver', '2032-06-10', '2032-06-12',
        0, 0, '["profile-owner"]', 3, 'unreviewed', NULL,
        'profile-owner', 'profile-admin', 1, 1, NULL
      ),
      (
        'legacy-organizer', 'org-owner', 'club-owner', 'profile-owner',
        'Organizer legacy', 'organizer-legacy', 'tentative', 'private',
        'timed', 1970010000000, 1970013600000, 'America/Vancouver',
        NULL, NULL, 0, 0, '["profile-owner"]', 4, 'unreviewed', NULL,
        'profile-owner', 'profile-organizer', 1, 1, NULL
      ),
      (
        'legacy-active-hold', 'org-owner', 'club-owner', 'profile-owner',
        'Active hold', 'active-hold', 'hold', 'private', 'timed',
        1970020000000, 1970023600000, 'America/Vancouver',
        NULL, NULL, 0, 0, '["profile-owner"]', 5, 'unreviewed',
        4102444800000, 'profile-owner', 'profile-owner', 1, 1, NULL
      ),
      (
        'legacy-expired-hold', 'org-owner', 'club-owner', 'profile-owner',
        'Expired hold', 'expired-hold', 'hold', 'private', 'timed',
        1970030000000, 1970033600000, 'America/Vancouver',
        NULL, NULL, 0, 0, '["profile-owner"]', 6, 'unreviewed',
        1, 'profile-owner', 'profile-owner', 1, 1, NULL
      ),
      (
        'legacy-cancelled', 'org-owner', 'club-owner', 'profile-owner',
        'Cancelled', 'cancelled', 'cancelled', 'private', 'timed',
        1970040000000, 1970043600000, 'America/Vancouver',
        NULL, NULL, 0, 0, '["profile-owner"]', 7, 'unreviewed', NULL,
        'profile-owner', 'profile-owner', 1, 1, NULL
      ),
      (
        'legacy-deleted', 'org-owner', 'club-owner', 'profile-owner',
        'Deleted', 'deleted', 'confirmed', 'private', 'timed',
        1970050000000, 1970053600000, 'America/Vancouver',
        NULL, NULL, 0, 0, '["profile-owner"]', 8, 'unreviewed', NULL,
        'profile-owner', 'profile-owner', 1, 1, 2
      );
  `);

  await ensureInvariantReadiness(database, "legacy reservation adoption");
  const intervals = await database
    .prepare(
      `SELECT source_record_id, planning_status, schedule_shape,
              actual_start_utc, actual_end_utc, schedule_version,
              hold_expires_at, reservation_semantic_fingerprint
       FROM organizer_external_reservation_intervals
       WHERE source_kind = 'legacy'
       ORDER BY source_record_id`,
    )
    .all();
  assert.deepEqual(
    intervals.results.map((interval) => interval.source_record_id),
    [
      "legacy-active-hold",
      "legacy-admin-all-day",
      "legacy-organizer",
      "legacy-owner",
    ],
  );
  assert.deepEqual(
    intervals.results.map((interval) => interval.schedule_version),
    [5, 3, 4, 2],
  );
  const allDay = intervals.results.find(
    (interval) => interval.source_record_id === "legacy-admin-all-day",
  );
  const expectedAllDay = normalizeAllDayConflictInterval({
    startDate: "2032-06-10",
    endDateExclusive: "2032-06-12",
    timeZone: "America/Vancouver",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
  });
  assert.deepEqual(
    {
      actualEndUtc: allDay.actual_end_utc,
      actualStartUtc: allDay.actual_start_utc,
      scheduleShape: allDay.schedule_shape,
    },
    {
      actualEndUtc: expectedAllDay.actualEndUtc,
      actualStartUtc: expectedAllDay.actualStartUtc,
      scheduleShape: "all_day",
    },
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE organizer_external_reservation_intervals
        SET title = 'Crafted active rewrite'
        WHERE source_kind = 'legacy'
          AND source_record_id = 'legacy-owner';
      `),
    /phase4_external_reservation_active/u,
  );

  database.exec(`
    DELETE FROM database_invariant_state
    WHERE singleton_key = '${DATABASE_INVARIANT_MARKER_KEY}';
    UPDATE organizer_external_reservation_intervals
    SET reservation_semantic_fingerprint = '${"0".repeat(64)}'
    WHERE source_kind = 'legacy'
      AND source_record_id = 'legacy-owner';
  `);
  await ensureInvariantReadiness(database, "corrupt legacy repair");
  const repaired = await database
    .prepare(
      `SELECT reservation_semantic_fingerprint
       FROM organizer_external_reservation_intervals
       WHERE source_kind = 'legacy'
         AND source_record_id = 'legacy-owner'`,
    )
    .first();
  assert.match(repaired.reservation_semantic_fingerprint, /^[a-f0-9]{64}$/u);
  assert.notEqual(
    repaired.reservation_semantic_fingerprint,
    "0".repeat(64),
  );
});

test("external adoption splits twenty-three candidates across bounded requests", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedOwnerInvariantData(database);
  const insert = database.prepare(
    `INSERT INTO events (
       id, organization_id, club_id, primary_organizer_profile_id,
       title, slug, status, visibility, time_kind,
       starts_at_utc, ends_at_utc, timezone,
       buffer_before_minutes, buffer_after_minutes,
       organizer_scope_json, schedule_version, schedule_review_state,
       created_by_profile_id, updated_by_profile_id,
       created_at, updated_at
     ) VALUES (
       ?, 'org-owner', 'club-owner', 'profile-owner',
       ?, ?, 'confirmed', 'private', 'timed', ?, ?,
       'America/Vancouver', 0, 0, '["profile-owner"]', 1, 'unreviewed',
       'profile-owner', 'profile-owner', 1, 1
     )`,
  );
  for (let index = 0; index < 23; index += 1) {
    const id = `legacy-bounded-${String(index).padStart(2, "0")}`;
    insert
      .bind(
        id,
        `Bounded candidate ${index}`,
        id,
        1980000000000 + index * 86_400_000,
        1980003600000 + index * 86_400_000,
      )
      .runSynchronously();
  }

  const policyRequest = countedBinding(database);
  assert.equal(
    await ensureDatabaseInvariants(policyRequest.binding),
    "repaired",
  );
  assertWithinD1StatementCap(policyRequest, "policy adoption");
  assert.equal(await marker(database), null);

  const firstExternalRequest = countedBinding(database);
  assert.equal(
    await ensureDatabaseInvariants(firstExternalRequest.binding),
    "repaired",
  );
  assertWithinD1StatementCap(
    firstExternalRequest,
    "twenty-two-candidate adoption",
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM organizer_external_reservation_intervals
         WHERE source_kind = 'legacy'`,
      )
      .first("count"),
    22,
  );
  assert.equal(await marker(database), null);

  const secondExternalRequest = countedBinding(database);
  assert.equal(
    await ensureDatabaseInvariants(secondExternalRequest.binding),
    "repaired",
  );
  assertWithinD1StatementCap(
    secondExternalRequest,
    "remaining-candidate adoption",
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM organizer_external_reservation_intervals
         WHERE source_kind = 'legacy'`,
      )
      .first("count"),
    23,
  );
  assert.equal(await marker(database), null);
  await ensureInvariantReadiness(database, "post-adoption guard install");
  assert.deepEqual(
    await normalizedTriggerDefinitions(database),
    expectedTriggerDefinitions(),
  );
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

    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'membership_a', 'org_a', 'profile_a', 'a@example.test',
        'owner', 'active', 'profile_a', 1, 1
      ),
      (
        'membership_b', 'org_b', 'profile_b', 'b@example.test',
        'owner', 'active', 'profile_b', 1, 1
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

async function legacyAttributionAdoptionSummary(database) {
  const summary = await database
    .prepare(
      `SELECT
         (
           SELECT count(*)
           FROM organizer_public_attribution_states
         ) AS state_count,
         (
           SELECT count(*)
           FROM organizer_public_attribution_write_intents
           WHERE operation = 'adopted'
         ) AS intent_count,
         (
           SELECT count(*)
           FROM organizer_public_attribution_write_intents
           WHERE completed_at IS NULL
         ) AS open_intent_count,
         (
           SELECT count(*)
           FROM organizer_public_attribution_receipts
           WHERE action = 'adopted'
         ) AS receipt_count,
         (
           SELECT count(*)
           FROM audit_logs
           WHERE action = 'profile.public_attribution_adopted'
         ) AS audit_count,
         (
           SELECT count(*)
           FROM database_invariant_state
           WHERE singleton_key <> 'database-guards'
         ) AS sentinel_count,
         (
           SELECT count(*)
           FROM organizer_public_attribution_states AS attribution
           JOIN profiles AS profile
             ON profile.id = attribution.profile_id
            AND profile.public_attribution_consent = 1
            AND profile.status = 'active'
            AND profile.deleted_at IS NULL
            AND profile.display_name = attribution.public_display_name
           JOIN organizer_public_attribution_receipts AS receipt
             ON receipt.id = attribution.current_receipt_id
            AND receipt.organization_id = attribution.organization_id
            AND receipt.profile_id = attribution.profile_id
            AND receipt.action = 'adopted'
            AND receipt.attribution_version = 1
            AND receipt.related_receipt_id IS NULL
           JOIN organizer_public_attribution_write_intents AS intent
             ON intent.id = receipt.write_intent_id
            AND intent.organization_id = attribution.organization_id
            AND intent.profile_id = attribution.profile_id
            AND intent.operation = 'adopted'
            AND intent.expected_draft_version = 1
            AND intent.expected_published_version = 0
            AND intent.proposed_published_version = 1
            AND intent.snapshot_hash = receipt.snapshot_hash
            AND intent.actor_profile_id = attribution.profile_id
            AND intent.completed_at IS NOT NULL
           JOIN audit_logs AS audit
             ON audit.organization_id = attribution.organization_id
            AND audit.actor_profile_id = attribution.profile_id
            AND audit.action = 'profile.public_attribution_adopted'
            AND audit.entity_type = 'profile'
            AND audit.entity_id = attribution.profile_id
           WHERE attribution.attribution_version = 1
             AND attribution.published_attribution_version = 1
             AND attribution.workflow_status = 'confirmed'
             AND attribution.public_biography IS NULL
             AND attribution.public_photo_media_asset_id IS NULL
             AND attribution.confirmed_at IS NOT NULL
             AND attribution.revoked_at IS NULL
             AND receipt.actor_profile_id = attribution.profile_id
             AND json_valid(receipt.snapshot_json)
             AND json_type(receipt.snapshot_json, '$.biography') = 'null'
             AND json_type(receipt.snapshot_json, '$.consent') = 'true'
             AND json_type(receipt.snapshot_json, '$.displayName') = 'text'
             AND json_extract(receipt.snapshot_json, '$.displayName') =
                 attribution.public_display_name
             AND json_type(receipt.snapshot_json, '$.draftVersion') =
                 'integer'
             AND json_extract(receipt.snapshot_json, '$.draftVersion') = 1
             AND json_type(receipt.snapshot_json, '$.legacyAdopted') = 'true'
             AND json_type(receipt.snapshot_json, '$.photoAssetId') = 'null'
             AND json_valid(audit.metadata_json)
             AND json_extract(audit.metadata_json, '$.draftVersion') = 1
             AND json_extract(audit.metadata_json, '$.publishedVersion') = 1
             AND json_extract(audit.metadata_json, '$.writeIntentId') =
                 intent.id
         ) AS valid_count`,
    )
    .first();
  return {
    auditCount: Number(summary?.audit_count ?? -1),
    intentCount: Number(summary?.intent_count ?? -1),
    openIntentCount: Number(summary?.open_intent_count ?? -1),
    receiptCount: Number(summary?.receipt_count ?? -1),
    sentinelCount: Number(summary?.sentinel_count ?? -1),
    stateCount: Number(summary?.state_count ?? -1),
    validCount: Number(summary?.valid_count ?? -1),
  };
}

async function taxonomyAdoptionSummary(database) {
  const summary = await database
    .prepare(
      `SELECT
         (
           SELECT count(*) FROM event_lane_taxonomy_states
         ) + (
           SELECT count(*) FROM category_taxonomy_states
         ) AS state_count,
         (
           SELECT count(*) FROM taxonomy_write_intents
           WHERE operation = 'adopt'
         ) AS intent_count,
         (
           SELECT count(*) FROM taxonomy_write_intents
           WHERE operation = 'adopt'
             AND completed_at IS NULL
         ) AS open_intent_count,
         (
           SELECT count(*) FROM audit_logs
           WHERE action IN (
             'taxonomy.lane_adopted',
             'taxonomy.category_adopted'
           )
         ) AS audit_count`,
    )
    .first();
  return {
    auditCount: Number(summary?.audit_count ?? -1),
    intentCount: Number(summary?.intent_count ?? -1),
    openIntentCount: Number(summary?.open_intent_count ?? -1),
    stateCount: Number(summary?.state_count ?? -1),
  };
}

function twoPartyBarrier() {
  let arrivals = 0;
  let release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  return {
    async wait() {
      arrivals += 1;
      if (arrivals === 2) release();
      await ready;
    },
  };
}

function synchronizeFirstInvariantBatch(database, barrier) {
  let synchronized = false;
  return {
    async batch(statements) {
      if (!synchronized) {
        synchronized = true;
        await barrier.wait();
      }
      return database.batch(statements);
    },
    prepare: (sql) => database.prepare(sql),
  };
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

async function assertInstalledGuardSetFailClosed(database, label) {
  const installed = await normalizedTriggerDefinitions(database);
  const expected = expectedTriggerDefinitions();
  const expectedByName = new Map(
    expected.map((definition) => [definition.name, definition.sql]),
  );

  assert.equal(
    await marker(database),
    null,
    `${label} must never retain a durable readiness marker`,
  );
  assert.ok(
    installed.length > 0 && installed.length <= expected.length,
    `${label} must retain only an exact staged subset of the guard contract`,
  );
  for (const definition of installed) {
    assert.equal(
      definition.sql,
      expectedByName.get(definition.name),
      `${label} retained an unexpected or mismatched ${definition.name} trigger`,
    );
  }
}

function triggerName(sql) {
  return /^CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS\s+([A-Za-z0-9_]+)/iu.exec(
    sql.trim(),
  )[1];
}
