import type { D1DatabaseLike } from "../auth";
import { CONFLICT_GUARD_TRIGGER_STATEMENTS } from "../conflicts/guard-sql";
import {
  PHASE4_INVARIANT_COUNT_SQL,
  PHASE4_INVARIANT_TRIGGER_STATEMENTS,
} from "../conflicts/organizer-invariant-sql";
import {
  PHASE3_INVARIANT_COUNT_SQL,
  PHASE3_INVARIANT_TRIGGER_STATEMENTS,
} from "../organizer/invariant-sql";
import {
  PHASE5_INVARIANT_COUNT_SQL,
  PHASE5_INVARIANT_TRIGGER_STATEMENTS,
} from "../organizer/publication-invariant-sql";
import {
  PHASE6_INVARIANT_COUNT_SQL,
  PHASE6_INVARIANT_TRIGGER_STATEMENTS,
} from "./phase6-invariant-sql";
import {
  PHASE7_INVARIANT_COUNT_SQL,
  PHASE7_INVARIANT_TRIGGER_STATEMENTS,
} from "./phase7-invariant-sql";
import {
  externalReservationSemanticFingerprint,
  externalReservationStateFingerprint,
  normalizeAllDayConflictInterval,
  normalizeConflictInterval,
} from "../organizer/conflict-domain";
import { protectedLegalClaimSql } from "../../validation/protected-legal-claims";
import { publicOrganizerEmailExposureSql } from "../../validation/public-organizer-email";

export const DATABASE_INVARIANT_MARKER_KEY = "database-guards";
export const PRE_PHASE5_DATABASE_INVARIANT_VERSION = 4;
export const PRE_PHASE6_DATABASE_INVARIANT_VERSION = 5;
export const PRE_PHASE7_DATABASE_INVARIANT_VERSION = 6;
export const DATABASE_INVARIANT_VERSION = 7;
export const DATABASE_INVARIANT_STATEMENT_LIMIT = 50;

export type DatabaseInvariantVersion =
  | typeof PRE_PHASE5_DATABASE_INVARIANT_VERSION
  | typeof PRE_PHASE6_DATABASE_INVARIANT_VERSION
  | typeof PRE_PHASE7_DATABASE_INVARIANT_VERSION
  | typeof DATABASE_INVARIANT_VERSION;

const PUBLIC_INTEGRITY_TRIGGER_STATEMENTS = [
  String.raw`
CREATE TRIGGER IF NOT EXISTS club_public_profiles_org_integrity_before_insert
BEFORE INSERT ON club_public_profiles
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizations AS organization
      INNER JOIN clubs AS club
        ON club.id = NEW.club_id
       AND club.organization_id = organization.id
      INNER JOIN event_lanes AS lane
        ON lane.id = NEW.primary_event_lane_id
       AND lane.organization_id = organization.id
      WHERE organization.id = NEW.organization_id
    )
    THEN RAISE(ABORT, 'club_public_profiles_organization_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS club_public_profiles_org_integrity_before_update
BEFORE UPDATE OF club_id, organization_id, primary_event_lane_id
ON club_public_profiles
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizations AS organization
      INNER JOIN clubs AS club
        ON club.id = NEW.club_id
       AND club.organization_id = organization.id
      INNER JOIN event_lanes AS lane
        ON lane.id = NEW.primary_event_lane_id
       AND lane.organization_id = organization.id
      WHERE organization.id = NEW.organization_id
    )
    THEN RAISE(ABORT, 'club_public_profiles_organization_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS clubs_public_profile_org_integrity_before_update
BEFORE UPDATE OF organization_id ON clubs
WHEN NEW.organization_id <> OLD.organization_id
 AND EXISTS (
   SELECT 1
   FROM club_public_profiles AS profile
   WHERE profile.club_id = OLD.id
     AND profile.organization_id <> NEW.organization_id
 )
BEGIN
  SELECT RAISE(ABORT, 'clubs_public_profile_organization_mismatch');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS event_lanes_public_profile_org_integrity_before_update
BEFORE UPDATE OF organization_id ON event_lanes
WHEN NEW.organization_id <> OLD.organization_id
 AND EXISTS (
   SELECT 1
   FROM club_public_profiles AS profile
   WHERE profile.primary_event_lane_id = OLD.id
     AND profile.organization_id <> NEW.organization_id
 )
BEGIN
  SELECT RAISE(ABORT, 'event_lanes_public_profile_organization_mismatch');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS event_public_details_org_integrity_before_insert
BEFORE INSERT ON event_public_details
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizations AS organization
      INNER JOIN events AS event
        ON event.id = NEW.event_id
       AND event.organization_id = organization.id
      WHERE organization.id = NEW.organization_id
    )
    THEN RAISE(ABORT, 'event_public_details_organization_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS event_public_details_org_integrity_before_update
BEFORE UPDATE OF event_id, organization_id ON event_public_details
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizations AS organization
      INNER JOIN events AS event
        ON event.id = NEW.event_id
       AND event.organization_id = organization.id
      WHERE organization.id = NEW.organization_id
    )
    THEN RAISE(ABORT, 'event_public_details_organization_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS events_public_details_org_integrity_before_update
BEFORE UPDATE OF organization_id ON events
WHEN NEW.organization_id <> OLD.organization_id
 AND EXISTS (
   SELECT 1
   FROM event_public_details AS detail
   WHERE detail.event_id = OLD.id
     AND detail.organization_id <> NEW.organization_id
 )
BEGIN
  SELECT RAISE(ABORT, 'events_public_details_organization_mismatch');
END;`,
] as const;

const CLUB_PUBLIC_PROFILE_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM club_public_profiles AS profile
WHERE NOT EXISTS (
  SELECT 1
  FROM organizations AS organization
  INNER JOIN clubs AS club
    ON club.id = profile.club_id
   AND club.organization_id = organization.id
  INNER JOIN event_lanes AS lane
    ON lane.id = profile.primary_event_lane_id
   AND lane.organization_id = organization.id
  WHERE organization.id = profile.organization_id
)`;

const EVENT_PUBLIC_DETAILS_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM event_public_details AS detail
WHERE NOT EXISTS (
  SELECT 1
  FROM organizations AS organization
  INNER JOIN events AS event
    ON event.id = detail.event_id
   AND event.organization_id = organization.id
  WHERE organization.id = detail.organization_id
)`;

const PRE_PHASE5_DATABASE_INVARIANT_TRIGGER_STATEMENTS = Object.freeze([
  ...CONFLICT_GUARD_TRIGGER_STATEMENTS,
  ...PUBLIC_INTEGRITY_TRIGGER_STATEMENTS,
  ...PHASE3_INVARIANT_TRIGGER_STATEMENTS,
  ...PHASE4_INVARIANT_TRIGGER_STATEMENTS,
]);

const PRE_PHASE6_DATABASE_INVARIANT_TRIGGER_STATEMENTS = Object.freeze([
  ...PRE_PHASE5_DATABASE_INVARIANT_TRIGGER_STATEMENTS,
  ...PHASE5_INVARIANT_TRIGGER_STATEMENTS,
]);

export const PRE_PHASE7_DATABASE_INVARIANT_TRIGGER_STATEMENTS = Object.freeze([
  ...PRE_PHASE6_DATABASE_INVARIANT_TRIGGER_STATEMENTS,
  ...PHASE6_INVARIANT_TRIGGER_STATEMENTS,
]);

export const DATABASE_INVARIANT_TRIGGER_STATEMENTS = Object.freeze([
  ...PRE_PHASE7_DATABASE_INVARIANT_TRIGGER_STATEMENTS,
  ...PHASE7_INVARIANT_TRIGGER_STATEMENTS,
]);

export const PRE_PHASE5_DATABASE_INVARIANT_TRIGGER_NAMES = Object.freeze(
  PRE_PHASE5_DATABASE_INVARIANT_TRIGGER_STATEMENTS.map(readTriggerName).sort(),
);

export const PRE_PHASE6_DATABASE_INVARIANT_TRIGGER_NAMES = Object.freeze(
  PRE_PHASE6_DATABASE_INVARIANT_TRIGGER_STATEMENTS.map(
    readTriggerName,
  ).sort(),
);

export const PRE_PHASE7_DATABASE_INVARIANT_TRIGGER_NAMES = Object.freeze(
  PRE_PHASE7_DATABASE_INVARIANT_TRIGGER_STATEMENTS.map(
    readTriggerName,
  ).sort(),
);

export const DATABASE_INVARIANT_TRIGGER_NAMES = Object.freeze(
  DATABASE_INVARIANT_TRIGGER_STATEMENTS.map(readTriggerName).sort(),
);

const PRE_PHASE5_INTEGRITY_COUNT_SQL = Object.freeze([
  CLUB_PUBLIC_PROFILE_INTEGRITY_COUNT_SQL,
  EVENT_PUBLIC_DETAILS_INTEGRITY_COUNT_SQL,
  ...PHASE3_INVARIANT_COUNT_SQL,
  ...PHASE4_INVARIANT_COUNT_SQL,
]);

const PRE_PHASE6_INTEGRITY_COUNT_SQL = Object.freeze([
  ...PRE_PHASE5_INTEGRITY_COUNT_SQL,
  ...PHASE5_INVARIANT_COUNT_SQL,
]);

const PRE_PHASE7_INTEGRITY_COUNT_SQL = Object.freeze([
  ...PRE_PHASE6_INTEGRITY_COUNT_SQL,
  ...PHASE6_INVARIANT_COUNT_SQL,
]);

const INTEGRITY_COUNT_SQL = Object.freeze([
  ...PRE_PHASE7_INTEGRITY_COUNT_SQL,
  ...PHASE7_INVARIANT_COUNT_SQL,
]);

// Leave material headroom below D1's 100 KiB prepared-statement limit. The
// wrapper and aborting INSERT add a small amount of SQL around each packed
// group, so enforce the ceiling on the final combined count statement.
export const DATABASE_INVARIANT_SQL_BYTE_LIMIT = 85_000;
const INTEGRITY_COUNT_MAX_COMPOUND_TERMS = 4;

function combinedIntegrityCountChunkSql(
  chunk: readonly string[],
): string {
  return String.raw`
SELECT COALESCE(sum(invariant_check.violation_count), 0)
       AS violation_count
FROM (
  ${chunk
    .map((query) => {
      const trimmed = query.trim();
      return /^WITH\b/iu.test(trimmed)
        ? `SELECT isolated_invariant.violation_count
           FROM (${trimmed}) AS isolated_invariant`
        : trimmed;
    })
    .join("\n  UNION ALL\n  ")}
) AS invariant_check`;
}

function combineIntegrityCountSql(
  checks: readonly string[],
): readonly string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  for (const check of checks) {
    const candidate = [...current, check];
    const candidateSql = combinedIntegrityCountChunkSql(candidate);
    const candidateBytes =
      new TextEncoder().encode(candidateSql).length;
    if (
      current.length > 0 &&
      (
        candidate.length > INTEGRITY_COUNT_MAX_COMPOUND_TERMS ||
        candidateBytes > DATABASE_INVARIANT_SQL_BYTE_LIMIT
      )
    ) {
      chunks.push(combinedIntegrityCountChunkSql(current));
      current = [check];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    chunks.push(combinedIntegrityCountChunkSql(current));
  }
  for (const sql of chunks) {
    if (new TextEncoder().encode(sql).length >
        DATABASE_INVARIANT_SQL_BYTE_LIMIT) {
      throw new Error(
        "A database invariant probe exceeds the D1 SQL byte budget.",
      );
    }
  }
  return Object.freeze(chunks);
}

const PRE_PHASE5_COMBINED_INTEGRITY_COUNT_SQL =
  combineIntegrityCountSql(PRE_PHASE5_INTEGRITY_COUNT_SQL);
const PRE_PHASE6_COMBINED_INTEGRITY_COUNT_SQL =
  combineIntegrityCountSql(PRE_PHASE6_INTEGRITY_COUNT_SQL);
export const DATABASE_INVARIANT_COMBINED_COUNT_SQL =
  combineIntegrityCountSql(INTEGRITY_COUNT_SQL);
const PRE_PHASE7_COMBINED_INTEGRITY_COUNT_SQL =
  combineIntegrityCountSql(PRE_PHASE7_INTEGRITY_COUNT_SQL);

/**
 * `database_invariant_state` rejects version zero and an empty fingerprint.
 * If any violation appears after the preflight read but before this statement,
 * the one conditional insert aborts the complete D1 batch and rolls back every
 * trigger change.
 */
function abortingIntegrityProbeSql(
  combinedIntegrityCountSql: readonly string[],
): readonly string[] {
  return Object.freeze(
    combinedIntegrityCountSql.map(
      (countSql) => String.raw`
INSERT INTO database_invariant_state (
  singleton_key, version, trigger_fingerprint, verified_at
)
SELECT 'integrity-probe', 0, '', 0
FROM (${countSql}) AS integrity_result
WHERE integrity_result.violation_count > 0`,
    ),
  );
}

const PRE_PHASE5_ABORTING_INTEGRITY_PROBE_SQL =
  abortingIntegrityProbeSql(PRE_PHASE5_COMBINED_INTEGRITY_COUNT_SQL);
const PRE_PHASE6_ABORTING_INTEGRITY_PROBE_SQL =
  abortingIntegrityProbeSql(PRE_PHASE6_COMBINED_INTEGRITY_COUNT_SQL);
export const DATABASE_INVARIANT_ABORTING_INTEGRITY_PROBE_SQL =
  abortingIntegrityProbeSql(DATABASE_INVARIANT_COMBINED_COUNT_SQL);
const PRE_PHASE7_ABORTING_INTEGRITY_PROBE_SQL =
  abortingIntegrityProbeSql(PRE_PHASE7_COMBINED_INTEGRITY_COUNT_SQL);

// A mismatched durable marker may require the three bounded Phase 4 adoption
// scans, the Phase 6 legacy public-attribution scan, and one taxonomy coverage
// read after the two-read marker/definition fast path. Repair budgets reserve
// those reads plus headroom even though a healthy request executes only the
// fast path.
const PHASE4_ADOPTION_PREFLIGHT_STATEMENT_COUNT = 9;

type DatabaseInvariantContract = Readonly<{
  abortingIntegrityProbeSql: readonly string[];
  combinedIntegrityCountSql: readonly string[];
  expectedTriggerNameSql: string;
  maxAtomicRepairMutations: number;
  maxFailClosedDropCount: number;
  triggerNames: readonly string[];
  triggerStatements: readonly string[];
  version: DatabaseInvariantVersion;
}>;

function createDatabaseInvariantContract(input: Readonly<{
  abortingIntegrityProbeSql: readonly string[];
  combinedIntegrityCountSql: readonly string[];
  triggerNames: readonly string[];
  triggerStatements: readonly string[];
  version: DatabaseInvariantVersion;
}>): DatabaseInvariantContract {
  // The fast readiness read already returns the exact trigger definitions.
  // A repair therefore executes every integrity chunk exactly once, as an
  // aborting statement in the same batch as trigger installation and marker
  // certification. Do not pre-scan or repeat the counts in the marker write.
  const readinessStatementCount = 2;
  const certificationReadBackStatementCount = 2;
  return Object.freeze({
    ...input,
    // Trigger names are compile-time constants extracted from our own CREATE
    // statements. Embed them as escaped literals so the consolidated marker
    // write does not exceed D1's bound-variable limit as the guard set grows.
    expectedTriggerNameSql: input.triggerNames
      .map(quoteSqliteStringLiteral)
      .join(", "),
    maxAtomicRepairMutations: Math.max(
      0,
      DATABASE_INVARIANT_STATEMENT_LIMIT -
        PHASE4_ADOPTION_PREFLIGHT_STATEMENT_COUNT -
        readinessStatementCount -
        input.abortingIntegrityProbeSql.length -
        1 -
        certificationReadBackStatementCount -
        1,
    ),
    // Adoption preflight can read marker, missing policies, manual
    // projections, external projections, and invariant inspection state.
    maxFailClosedDropCount:
      DATABASE_INVARIANT_STATEMENT_LIMIT -
      PHASE4_ADOPTION_PREFLIGHT_STATEMENT_COUNT -
      readinessStatementCount -
      1,
  });
}

const PRE_PHASE5_DATABASE_INVARIANT_CONTRACT =
  createDatabaseInvariantContract({
    abortingIntegrityProbeSql:
      PRE_PHASE5_ABORTING_INTEGRITY_PROBE_SQL,
    combinedIntegrityCountSql:
      PRE_PHASE5_COMBINED_INTEGRITY_COUNT_SQL,
    triggerNames: PRE_PHASE5_DATABASE_INVARIANT_TRIGGER_NAMES,
    triggerStatements:
      PRE_PHASE5_DATABASE_INVARIANT_TRIGGER_STATEMENTS,
    version: PRE_PHASE5_DATABASE_INVARIANT_VERSION,
  });

const PRE_PHASE6_DATABASE_INVARIANT_CONTRACT =
  createDatabaseInvariantContract({
    abortingIntegrityProbeSql:
      PRE_PHASE6_ABORTING_INTEGRITY_PROBE_SQL,
    combinedIntegrityCountSql:
      PRE_PHASE6_COMBINED_INTEGRITY_COUNT_SQL,
    triggerNames: PRE_PHASE6_DATABASE_INVARIANT_TRIGGER_NAMES,
    triggerStatements:
      PRE_PHASE6_DATABASE_INVARIANT_TRIGGER_STATEMENTS,
    version: PRE_PHASE6_DATABASE_INVARIANT_VERSION,
  });

const PRE_PHASE7_DATABASE_INVARIANT_CONTRACT =
  createDatabaseInvariantContract({
    abortingIntegrityProbeSql:
      PRE_PHASE7_ABORTING_INTEGRITY_PROBE_SQL,
    combinedIntegrityCountSql:
      PRE_PHASE7_COMBINED_INTEGRITY_COUNT_SQL,
    triggerNames: PRE_PHASE7_DATABASE_INVARIANT_TRIGGER_NAMES,
    triggerStatements:
      PRE_PHASE7_DATABASE_INVARIANT_TRIGGER_STATEMENTS,
    version: PRE_PHASE7_DATABASE_INVARIANT_VERSION,
  });

const DATABASE_INVARIANT_CONTRACT = createDatabaseInvariantContract({
  abortingIntegrityProbeSql:
    DATABASE_INVARIANT_ABORTING_INTEGRITY_PROBE_SQL,
  combinedIntegrityCountSql:
    DATABASE_INVARIANT_COMBINED_COUNT_SQL,
  triggerNames: DATABASE_INVARIANT_TRIGGER_NAMES,
  triggerStatements: DATABASE_INVARIANT_TRIGGER_STATEMENTS,
  version: DATABASE_INVARIANT_VERSION,
});

function databaseInvariantContract(
  version: DatabaseInvariantVersion,
): DatabaseInvariantContract {
  if (version === PRE_PHASE5_DATABASE_INVARIANT_VERSION) {
    return PRE_PHASE5_DATABASE_INVARIANT_CONTRACT;
  }
  if (version === PRE_PHASE6_DATABASE_INVARIANT_VERSION) {
    return PRE_PHASE6_DATABASE_INVARIANT_CONTRACT;
  }
  return version === PRE_PHASE7_DATABASE_INVARIANT_VERSION
    ? PRE_PHASE7_DATABASE_INVARIANT_CONTRACT
    : DATABASE_INVARIANT_CONTRACT;
}
const MAX_POLICY_ADOPTIONS_PER_REQUEST = 24;
const MAX_MANUAL_ADOPTIONS_PER_REQUEST = 15;
// A Meetup adoption emits two statements (normalization + projection). Keep
// the whole repair request below D1's 50-statement invocation limit.
const MAX_EXTERNAL_ADOPTIONS_PER_REQUEST = 22;
const MAX_MANUAL_ALL_DAY_SCAN = 5_000;
const MAX_EXTERNAL_SCAN = 5_000;

const initializationByDatabase = new WeakMap<
  D1DatabaseLike,
  Map<DatabaseInvariantVersion, Promise<DatabaseInvariantInitializationStatus>>
>();

export type DatabaseInvariantInitializationStatus = "ready" | "repaired";

export class DatabaseInvariantError extends Error {
  constructor() {
    super("Database integrity guards are unavailable.");
    this.name = "DatabaseInvariantError";
  }
}

/**
 * Installs and verifies every database-enforced guard before application code
 * can access D1. The in-isolate promise deduplicates concurrent calls only:
 * every request revalidates the durable marker and exact sqlite_master
 * definitions. The database triggers keep a healthy marked database closed
 * against malformed writes; the heavier integrity/adoption scans run only
 * after the marker or definitions drift. A repair initiated by another isolate
 * therefore remains fail closed without charging every application request for
 * the complete integrity suite.
 */
export function ensureDatabaseInvariants(
  database: D1DatabaseLike,
  expectedVersion: DatabaseInvariantVersion = DATABASE_INVARIANT_VERSION,
): Promise<DatabaseInvariantInitializationStatus> {
  const byVersion =
    initializationByDatabase.get(database) ??
    new Map<
      DatabaseInvariantVersion,
      Promise<DatabaseInvariantInitializationStatus>
    >();
  if (!initializationByDatabase.has(database)) {
    initializationByDatabase.set(database, byVersion);
  }
  const existing = byVersion.get(expectedVersion);
  if (existing) return existing;

  const contract = databaseInvariantContract(expectedVersion);
  const clearInitialization = () => {
    byVersion.delete(expectedVersion);
    if (byVersion.size === 0) initializationByDatabase.delete(database);
  };
  const initialization = initializeDatabaseInvariants(database, contract).then(
    (status) => {
      // This map deduplicates only concurrent work. Never cache a resolved
      // result across requests: another Worker isolate may have invalidated
      // the durable marker while repairing a corrupted trigger set.
      clearInitialization();
      return status;
    },
    (error: unknown) => {
      clearInitialization();
      throw error instanceof DatabaseInvariantError
        ? error
        : new DatabaseInvariantError();
    },
  );
  byVersion.set(expectedVersion, initialization);
  return initialization;
}

export async function getExpectedDatabaseInvariantFingerprint(
  expectedVersion: DatabaseInvariantVersion = DATABASE_INVARIANT_VERSION,
): Promise<string> {
  const definitions = expectedNormalizedTriggerDefinitions(
    databaseInvariantContract(expectedVersion),
  );
  const serialized = definitions
    .map(({ name, sql }) => `${name}\u0000${sql}`)
    .join("\u0001");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(serialized),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function normalizeTriggerDefinition(sql: string): string {
  return sql
    .trim()
    .replace(
      /^CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS\s+/iu,
      "CREATE TRIGGER ",
    )
    .replace(/;\s*$/u, "")
    .replace(/\s+/gu, " ");
}

async function initializeDatabaseInvariants(
  database: D1DatabaseLike,
  contract: DatabaseInvariantContract,
): Promise<DatabaseInvariantInitializationStatus> {
  const fingerprint = await getExpectedDatabaseInvariantFingerprint(
    contract.version,
  );
  const readiness = await inspectDatabaseInvariantReadiness(
    database,
    fingerprint,
    contract,
  );
  if (readiness.ready) return "ready";

  if (
    readiness.markerVersion !== contract.version &&
    (await adoptMissingPhase4ConflictProjections(database))
  ) {
    return "repaired";
  }
  if (
    readiness.markerVersion !== contract.version &&
    contract.version === DATABASE_INVARIANT_VERSION &&
    (await adoptLegacyPublicAttribution(database))
  ) {
    return "repaired";
  }
  if (
    !readiness.ready &&
    contract.version === DATABASE_INVARIANT_VERSION &&
    (await adoptMissingPhase6TaxonomyStates(database))
  ) {
    return "repaired";
  }

  const expectedDefinitions = expectedNormalizedTriggerDefinitions(contract);
  const expectedByName = new Map(
    expectedDefinitions.map((definition) => [definition.name, definition.sql]),
  );
  const actualByName = new Map(
    readiness.actualDefinitions.map((definition) => [
      definition.name,
      definition.sql,
    ]),
  );
  const dropNames = readiness.actualDefinitions
    .filter(
      (definition) =>
        expectedByName.get(definition.name) !== definition.sql,
    )
    .map((definition) => definition.name);
  const createStatements = contract.triggerStatements.filter(
    (sql) => {
      const name = readTriggerName(sql);
      return actualByName.get(name) !== normalizeTriggerDefinition(sql);
    },
  );

  /**
   * Replacing every exact trigger definition can require more mutations than
   * D1's 50-statement invocation cap permits. That
   * pathological corruption enters a bounded fail-closed repair state:
   *
   * 1. atomically invalidate readiness and remove at most 36 bad definitions;
   * 2. reject this request, so no application code can observe the gap;
   * 3. the next request atomically installs the complete missing set, probes
   *    it, writes the marker, and read-verifies it before dispatch.
   *
   * Normal cold, missing-trigger, and ordinary mismatch repairs stay in one
   * atomic request. Every intermediate state has no readiness marker.
   */
  if (dropNames.length + createStatements.length >
      contract.maxAtomicRepairMutations) {
    /*
     * More exact guards than a single install+probe+read-back request can
     * safely carry are staged while the durable readiness marker is absent.
     * The Worker returns its fail-closed repair response; the next request
     * completes the remaining definitions and only then writes the marker.
     */
    const mutationBudget = contract.maxFailClosedDropCount;
    const stagedDrops = dropNames.slice(0, mutationBudget);
    const remainingBudget = mutationBudget - stagedDrops.length;
    const stagedCreates = createStatements.slice(0, remainingBudget);
    const cleanupStatements = [
      database
        .prepare(
          `DELETE FROM database_invariant_state
           WHERE singleton_key = ?`,
        )
        .bind(DATABASE_INVARIANT_MARKER_KEY),
      ...stagedDrops
        .map((name) =>
          database.prepare(
            `DROP TRIGGER IF EXISTS ${quoteSqliteIdentifier(name)}`,
          ),
        ),
      ...stagedCreates.map((sql) => database.prepare(sql)),
    ];
    await runInvariantBatch(database, cleanupStatements);
    return "repaired";
  }

  const installationStatements = [
    ...dropNames.map((name) =>
      database.prepare(
        `DROP TRIGGER IF EXISTS ${quoteSqliteIdentifier(name)}`,
      ),
    ),
    ...createStatements.map((sql) => database.prepare(sql)),
    ...contract.abortingIntegrityProbeSql.map((sql) =>
      database.prepare(sql),
    ),
    database
      .prepare(
        `INSERT INTO database_invariant_state (
           singleton_key, version, trigger_fingerprint, verified_at
         )
         SELECT ?, ?, ?, ?
         WHERE (
             SELECT count(*)
             FROM sqlite_master
             WHERE type = 'trigger'
         ) = ?
         AND (
             SELECT count(*)
             FROM sqlite_master
             WHERE type = 'trigger'
               AND name IN (${contract.expectedTriggerNameSql})
           ) = ?
         ON CONFLICT(singleton_key) DO UPDATE SET
           version = excluded.version,
           trigger_fingerprint = excluded.trigger_fingerprint,
           verified_at = excluded.verified_at`,
      )
      .bind(
        DATABASE_INVARIANT_MARKER_KEY,
        contract.version,
        fingerprint,
        Date.now(),
        contract.triggerNames.length,
        contract.triggerNames.length,
      ),
  ];

  let results: Awaited<ReturnType<D1DatabaseLike["batch"]>>;
  try {
    results = await runInvariantBatch(database, installationStatements);
  } catch {
    await invalidateReadinessMarker(database);
    throw new DatabaseInvariantError();
  }
  const markerResult = results.at(-1);
  if (markerResult?.meta?.changes !== 1) {
    await invalidateReadinessMarker(database);
    throw new DatabaseInvariantError();
  }
  if (
    !(
      await inspectDatabaseInvariantReadiness(
        database,
        fingerprint,
        contract,
      )
    ).ready
  ) {
    await invalidateReadinessMarker(database);
    throw new DatabaseInvariantError();
  }
  return "repaired";
}

async function inspectDatabaseInvariantReadiness(
  database: D1DatabaseLike,
  fingerprint: string,
  contract: DatabaseInvariantContract,
): Promise<{
  actualDefinitions: ReadonlyArray<{ name: string; sql: string }>;
  markerVersion: unknown;
  ready: boolean;
}> {
  const markerPromise = database
      .prepare(
        `SELECT version, trigger_fingerprint
         FROM database_invariant_state
         WHERE singleton_key = ?
         LIMIT 1`,
      )
      .bind(DATABASE_INVARIANT_MARKER_KEY)
      .first<Record<string, unknown>>();
  const triggerPromise = database
      .prepare(
        `SELECT name, sql
         FROM sqlite_master
         WHERE type = 'trigger'
         ORDER BY name`,
      )
      .all<Record<string, unknown>>();
  const [marker, triggerResult] = await Promise.all([
    markerPromise,
    triggerPromise,
  ]);
  const actualDefinitions = (triggerResult.results ?? []).map((row) => ({
    name: typeof row.name === "string" ? row.name : "",
    sql: typeof row.sql === "string" ? normalizeTriggerDefinition(row.sql) : "",
  }));
  return {
    actualDefinitions,
    markerVersion: marker?.version,
    ready:
      marker?.version === contract.version &&
      marker.trigger_fingerprint === fingerprint &&
      triggerDefinitionsMatch(actualDefinitions, contract),
  };
}

function triggerDefinitionsMatch(
  actualDefinitions: ReadonlyArray<{ name: string; sql: string }>,
  contract: DatabaseInvariantContract,
): boolean {
  const expectedDefinitions = expectedNormalizedTriggerDefinitions(contract);
  return (
    actualDefinitions.length === expectedDefinitions.length &&
    actualDefinitions.every(
      (actual, index) =>
        actual.name === expectedDefinitions[index]?.name &&
        actual.sql === expectedDefinitions[index]?.sql,
    )
  );
}

const PHASE4_MANUAL_ADOPTION_SQL = String.raw`
SELECT event.id AS event_id,
       event.organization_id,
       event.club_id,
       event.planning_status,
       event.schedule_shape,
       event.starts_at_utc,
       event.ends_at_utc,
       event.timezone,
       event.all_day_start_date,
       event.all_day_end_date_exclusive,
       event.buffer_before_minutes,
       event.buffer_after_minutes,
       event.venue_id,
       event.primary_organizer_profile_id,
       event.content_version,
       event.schedule_version,
       policy.id AS policy_id,
       policy.policy_version,
       policy.mode AS policy_mode,
       (
         SELECT owner_membership.profile_id
         FROM organization_memberships AS owner_membership
         JOIN profiles AS owner_profile
           ON owner_profile.id = owner_membership.profile_id
          AND owner_profile.status = 'active'
          AND owner_profile.deleted_at IS NULL
         WHERE owner_membership.organization_id = event.organization_id
           AND owner_membership.role = 'owner'
           AND owner_membership.status = 'active'
           AND owner_membership.deleted_at IS NULL
         ORDER BY owner_membership.id
         LIMIT 1
       ) AS actor_profile_id,
       COALESCE((
         SELECT json_group_array(profile_id)
         FROM (
           SELECT event.primary_organizer_profile_id AS profile_id
           UNION
           SELECT association.profile_id
           FROM organizer_event_organizers AS association
           WHERE association.organization_id = event.organization_id
             AND association.organizer_event_id = event.id
             AND association.deleted_at IS NULL
           ORDER BY profile_id
         )
       ), '[]') AS organizer_scope_json,
       state.actual_start_utc AS state_actual_start_utc,
       state.actual_end_utc AS state_actual_end_utc,
       state.expanded_start_utc AS state_expanded_start_utc,
       state.expanded_end_utc AS state_expanded_end_utc,
       state.schedule_shape AS state_schedule_shape,
       state.timezone AS state_timezone,
       state.all_day_start_date AS state_all_day_start_date,
       state.all_day_end_date_exclusive AS state_all_day_end_date_exclusive,
       state.buffer_before_minutes AS state_buffer_before_minutes,
       state.buffer_after_minutes AS state_buffer_after_minutes,
       state.venue_id AS state_venue_id,
       state.primary_organizer_profile_id AS state_primary_organizer_profile_id,
       state.organizer_scope_json AS state_organizer_scope_json,
       state.schedule_version AS state_schedule_version,
       state.policy_version AS state_policy_version,
       state.organization_id AS state_organization_id,
       state.organizer_event_id AS state_event_id,
       state.club_id AS state_club_id,
       state.planning_status AS state_planning_status
FROM organizer_events AS event
JOIN organizer_conflict_policies AS policy
  ON policy.organization_id = event.organization_id
LEFT JOIN organizer_reservation_states AS state
  ON state.organizer_event_id = event.id
 AND state.organization_id = event.organization_id
WHERE event.schedule_shape IN ('timed', 'all_day')
  AND event.planning_status IN ('idea', 'draft')
  AND event.deleted_at IS NULL
  AND (
    state.organizer_event_id IS NULL
    OR state.club_id <> event.club_id
    OR state.planning_status <> event.planning_status
    OR state.schedule_shape <> event.schedule_shape
    OR state.timezone <> event.timezone
    OR state.all_day_start_date IS NOT event.all_day_start_date
    OR state.all_day_end_date_exclusive IS NOT
       event.all_day_end_date_exclusive
    OR state.buffer_before_minutes <> event.buffer_before_minutes
    OR state.buffer_after_minutes <> event.buffer_after_minutes
    OR state.venue_id IS NOT event.venue_id
    OR state.primary_organizer_profile_id <>
       event.primary_organizer_profile_id
    OR state.schedule_version <> event.schedule_version
    OR state.policy_version < 1
    OR state.policy_version > policy.policy_version
    OR state.organizer_scope_json <> COALESCE((
      SELECT json_group_array(profile_id)
      FROM (
        SELECT event.primary_organizer_profile_id AS profile_id
        UNION
        SELECT association.profile_id
        FROM organizer_event_organizers AS association
        WHERE association.organization_id = event.organization_id
          AND association.organizer_event_id = event.id
          AND association.deleted_at IS NULL
        ORDER BY profile_id
      )
    ), '[]')
    OR (
      event.schedule_shape = 'timed'
      AND (
        state.actual_start_utc <> event.starts_at_utc
        OR state.actual_end_utc <> event.ends_at_utc
        OR state.expanded_start_utc <>
           event.starts_at_utc - event.buffer_before_minutes * 60000
        OR state.expanded_end_utc <>
           event.ends_at_utc + event.buffer_after_minutes * 60000
      )
    )
    OR event.schedule_shape = 'all_day'
  )
ORDER BY
  CASE WHEN state.organizer_event_id IS NULL THEN 0 ELSE 1 END,
  event.id
LIMIT 5001`;

const PHASE4_POLICY_ADOPTION_SQL = String.raw`
SELECT organization.id AS organization_id,
       owner_membership.profile_id AS actor_profile_id
FROM organizations AS organization
JOIN organization_memberships AS owner_membership
  ON owner_membership.organization_id = organization.id
 AND owner_membership.role = 'owner'
 AND owner_membership.status = 'active'
 AND owner_membership.deleted_at IS NULL
JOIN profiles AS owner_profile
  ON owner_profile.id = owner_membership.profile_id
 AND owner_profile.status = 'active'
 AND owner_profile.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM organizer_conflict_policies AS policy
  WHERE policy.organization_id = organization.id
)
ORDER BY organization.id
LIMIT 24`;

const PHASE4_EXTERNAL_ADOPTION_SQL = String.raw`
SELECT candidate.*,
       interval.actual_start_utc AS state_actual_start_utc,
       interval.actual_end_utc AS state_actual_end_utc,
       interval.expanded_start_utc AS state_expanded_start_utc,
       interval.expanded_end_utc AS state_expanded_end_utc,
       interval.schedule_shape AS state_schedule_shape,
       interval.timezone AS state_timezone,
       interval.all_day_start_date AS state_all_day_start_date,
       interval.all_day_end_date_exclusive AS state_all_day_end_date_exclusive,
       interval.buffer_before_minutes AS state_buffer_before_minutes,
       interval.buffer_after_minutes AS state_buffer_after_minutes,
       interval.venue_id AS state_venue_id,
       interval.primary_organizer_profile_id
         AS state_primary_organizer_profile_id,
       interval.organizer_scope_json AS state_organizer_scope_json,
       interval.schedule_version AS state_schedule_version,
       interval.planning_status AS state_planning_status,
       interval.title AS state_title,
       interval.source_fingerprint AS state_source_fingerprint,
       interval.normalized_state_fingerprint
         AS state_normalized_state_fingerprint,
       interval.reservation_semantic_fingerprint
         AS state_reservation_semantic_fingerprint,
       interval.organization_id AS state_organization_id,
       interval.source_kind AS state_source_kind,
       interval.source_record_id AS state_source_record_id,
       interval.sync_source_id AS state_sync_source_id,
       interval.generation_id AS state_generation_id,
       interval.event_id AS state_event_id,
       interval.club_id AS state_club_id,
       interval.hold_expires_at AS state_hold_expires_at,
       normalization.id AS normalization_id,
       normalization.organization_id AS normalization_organization_id,
       normalization.sync_source_id AS normalization_sync_source_id,
       normalization.generation_id AS normalization_generation_id,
       normalization.snapshot_id AS normalization_snapshot_id,
       normalization.event_id AS normalization_event_id,
       normalization.club_id AS normalization_club_id,
       normalization.planning_status AS normalization_planning_status,
       normalization.schedule_shape AS normalization_schedule_shape,
       normalization.actual_start_utc AS normalization_actual_start_utc,
       normalization.actual_end_utc AS normalization_actual_end_utc,
       normalization.expanded_start_utc AS normalization_expanded_start_utc,
       normalization.expanded_end_utc AS normalization_expanded_end_utc,
       normalization.timezone AS normalization_timezone,
       normalization.all_day_start_date AS normalization_all_day_start_date,
       normalization.all_day_end_date_exclusive
         AS normalization_all_day_end_date_exclusive,
       normalization.buffer_before_minutes
         AS normalization_buffer_before_minutes,
       normalization.buffer_after_minutes
         AS normalization_buffer_after_minutes,
       normalization.venue_id AS normalization_venue_id,
       normalization.primary_organizer_profile_id
         AS normalization_primary_organizer_profile_id,
       normalization.organizer_scope_json
         AS normalization_organizer_scope_json,
       normalization.schedule_version AS normalization_schedule_version,
       normalization.hold_expires_at AS normalization_hold_expires_at,
       normalization.source_fingerprint AS normalization_source_fingerprint,
       normalization.normalized_state_fingerprint
         AS normalization_normalized_state_fingerprint,
       normalization.reservation_semantic_fingerprint
         AS normalization_reservation_semantic_fingerprint
FROM (
  SELECT 'legacy' AS source_kind,
         event.id AS source_record_id,
         NULL AS snapshot_id,
         NULL AS sync_source_id,
         NULL AS generation_id,
         event.id AS event_id,
         event.organization_id,
         event.club_id,
         event.status AS planning_status,
         event.time_kind AS schedule_shape,
         event.starts_at_utc,
         event.ends_at_utc,
         event.timezone,
         event.all_day_start_date,
         event.all_day_end_date_exclusive,
         event.buffer_before_minutes,
         event.buffer_after_minutes,
         event.venue_id,
         event.primary_organizer_profile_id,
         event.organizer_scope_json,
         event.schedule_version,
         event.hold_expires_at,
         event.title,
         NULL AS source_fingerprint
  FROM events AS event
  WHERE event.deleted_at IS NULL
    AND event.status IN ('hold', 'tentative', 'confirmed')
    AND (
      event.status <> 'hold'
      OR event.hold_expires_at >
         CAST(unixepoch('subsec') * 1000 AS INTEGER)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM external_source_links AS source_link
      WHERE source_link.organization_id = event.organization_id
        AND source_link.entity_type = 'event'
        AND source_link.entity_id = event.id
        AND source_link.source_type = 'meetup_ics'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM organizer_events AS adopted
      WHERE adopted.id = event.id
        AND adopted.organization_id = event.organization_id
    )

  UNION ALL

  SELECT 'meetup',
         snapshot.id,
         snapshot.id,
         source.id,
         source.active_generation_id,
         snapshot.event_id,
         snapshot.organization_id,
         source.club_id,
         snapshot.status,
         snapshot.time_kind,
         snapshot.starts_at_utc,
         snapshot.ends_at_utc,
         snapshot.timezone,
         snapshot.all_day_start_date,
         snapshot.all_day_end_date_exclusive,
         0,
         0,
         event.venue_id,
         event.primary_organizer_profile_id,
         event.organizer_scope_json,
         event.schedule_version,
         NULL,
         snapshot.title,
         snapshot.source_fingerprint
  FROM sync_sources AS source
  JOIN meetup_sync_generations AS generation
    ON generation.id = source.active_generation_id
   AND generation.organization_id = source.organization_id
   AND generation.sync_source_id = source.id
   AND generation.state = 'published'
  JOIN meetup_event_snapshots AS snapshot
    ON snapshot.organization_id = source.organization_id
   AND snapshot.sync_source_id = source.id
   AND snapshot.generation_id = source.active_generation_id
  JOIN events AS event
    ON event.id = snapshot.event_id
   AND event.organization_id = snapshot.organization_id
  WHERE source.enabled = 1
    AND source.deleted_at IS NULL
    AND snapshot.status IN ('confirmed', 'tentative')
) AS candidate
LEFT JOIN organizer_external_reservation_intervals AS interval
  ON interval.source_kind = candidate.source_kind
 AND interval.source_record_id = candidate.source_record_id
LEFT JOIN meetup_snapshot_reservation_normalizations AS normalization
  ON candidate.source_kind = 'meetup'
 AND normalization.organization_id = candidate.organization_id
 AND normalization.sync_source_id = candidate.sync_source_id
 AND normalization.generation_id = candidate.generation_id
 AND normalization.snapshot_id = candidate.snapshot_id
 AND normalization.event_id = candidate.event_id
WHERE interval.id IS NULL
   OR interval.organization_id <> candidate.organization_id
   OR interval.source_kind <> candidate.source_kind
   OR interval.source_record_id <> candidate.source_record_id
   OR interval.sync_source_id IS NOT candidate.sync_source_id
   OR interval.generation_id IS NOT candidate.generation_id
   OR interval.event_id <> candidate.event_id
   OR interval.club_id <> candidate.club_id
   OR interval.planning_status <> candidate.planning_status
   OR interval.schedule_shape <> candidate.schedule_shape
   OR interval.timezone <> candidate.timezone
   OR interval.all_day_start_date IS NOT candidate.all_day_start_date
   OR interval.all_day_end_date_exclusive IS NOT
      candidate.all_day_end_date_exclusive
   OR interval.buffer_before_minutes <> candidate.buffer_before_minutes
   OR interval.buffer_after_minutes <> candidate.buffer_after_minutes
   OR interval.venue_id IS NOT candidate.venue_id
   OR interval.primary_organizer_profile_id IS NOT
      candidate.primary_organizer_profile_id
   OR interval.organizer_scope_json <> candidate.organizer_scope_json
   OR interval.schedule_version <> candidate.schedule_version
   OR interval.hold_expires_at IS NOT candidate.hold_expires_at
   OR interval.title <> candidate.title
   OR (
     candidate.source_kind = 'meetup'
     AND interval.source_fingerprint <> candidate.source_fingerprint
   )
   OR interval.reservation_semantic_fingerprint IS NULL
   OR (
     candidate.source_kind = 'meetup'
     AND (
       normalization.id IS NULL
       OR normalization.club_id <> candidate.club_id
       OR normalization.planning_status <> candidate.planning_status
       OR normalization.schedule_shape <> candidate.schedule_shape
       OR normalization.timezone <> candidate.timezone
       OR normalization.all_day_start_date IS NOT
          candidate.all_day_start_date
       OR normalization.all_day_end_date_exclusive IS NOT
          candidate.all_day_end_date_exclusive
       OR normalization.buffer_before_minutes <>
          candidate.buffer_before_minutes
       OR normalization.buffer_after_minutes <>
          candidate.buffer_after_minutes
       OR normalization.venue_id IS NOT candidate.venue_id
       OR normalization.primary_organizer_profile_id IS NOT
          candidate.primary_organizer_profile_id
       OR normalization.organizer_scope_json <>
          candidate.organizer_scope_json
       OR normalization.schedule_version <> candidate.schedule_version
       OR normalization.hold_expires_at IS NOT candidate.hold_expires_at
       OR normalization.source_fingerprint <>
          candidate.source_fingerprint
       OR normalization.actual_start_utc IS NOT interval.actual_start_utc
       OR normalization.actual_end_utc IS NOT interval.actual_end_utc
       OR normalization.expanded_start_utc IS NOT
          interval.expanded_start_utc
       OR normalization.expanded_end_utc IS NOT
          interval.expanded_end_utc
       OR normalization.normalized_state_fingerprint IS NOT
          interval.normalized_state_fingerprint
       OR normalization.reservation_semantic_fingerprint IS NOT
          interval.reservation_semantic_fingerprint
     )
   )
   OR (
     candidate.schedule_shape = 'timed'
     AND (
       interval.actual_start_utc <> candidate.starts_at_utc
       OR interval.actual_end_utc <> candidate.ends_at_utc
       OR interval.expanded_start_utc <>
          candidate.starts_at_utc -
          candidate.buffer_before_minutes * 60000
       OR interval.expanded_end_utc <>
          candidate.ends_at_utc +
          candidate.buffer_after_minutes * 60000
     )
   )
   -- Fingerprints and IANA-derived all-day boundaries cannot be recomputed in
   -- SQLite. Scan every bounded active candidate and compare them in the
   -- server normalizer before certifying readiness.
   OR candidate.source_kind IN ('legacy', 'meetup')
ORDER BY
  CASE WHEN interval.id IS NULL THEN 0 ELSE 1 END,
  candidate.source_kind,
  candidate.source_record_id
LIMIT 5001`;

async function adoptMissingPhase4ConflictProjections(
  database: D1DatabaseLike,
): Promise<boolean> {
  const missingPolicies =
    (await database
      .prepare(PHASE4_POLICY_ADOPTION_SQL)
      .all<Record<string, unknown>>()).results ?? [];
  if (missingPolicies.length > 0) {
    const now = Date.now();
    const policyStatements = [
      database
        .prepare(
          `DELETE FROM database_invariant_state
           WHERE singleton_key = ?`,
        )
        .bind(DATABASE_INVARIANT_MARKER_KEY),
      ...missingPolicies
        .slice(0, MAX_POLICY_ADOPTIONS_PER_REQUEST)
        .map((row) => {
          const organizationId = readString(row.organization_id);
          const actorProfileId = readString(row.actor_profile_id);
          return database
            .prepare(
              `INSERT OR IGNORE INTO organizer_conflict_policies (
                 id, organization_id, mode, policy_version,
                 default_hold_hours, nearing_expiry_hours,
                 updated_by_profile_id, created_at, updated_at
               ) VALUES (?, ?, 'warn_reason', 1, 72, 24, ?, ?, ?)`,
            )
            .bind(
              `phase4-policy:${organizationId}`,
              organizationId,
              actorProfileId,
              now,
              now,
            );
        }),
    ];
    try {
      await runInvariantBatch(database, policyStatements);
    } catch {
      await invalidateReadinessMarker(database);
      throw new DatabaseInvariantError();
    }
    return true;
  }

  let manualRows: readonly Record<string, unknown>[];
  try {
    manualRows =
      (await database
        .prepare(PHASE4_MANUAL_ADOPTION_SQL)
        .all<Record<string, unknown>>()).results ?? [];
  } catch {
    // The Phase 4 migration may not yet exist in a migration-only test seam.
    return false;
  }
  if (manualRows.length > MAX_MANUAL_ALL_DAY_SCAN) {
    await invalidateReadinessMarker(database);
    throw new DatabaseInvariantError();
  }
  const manualCandidates: ManualAdoption[] = [];
  for (const row of manualRows) {
    const candidate = await readManualAdoption(row);
    if (!candidate.stateMatches) manualCandidates.push(candidate);
    if (manualCandidates.length >= MAX_MANUAL_ADOPTIONS_PER_REQUEST) break;
  }
  if (manualCandidates.length > 0) {
    const statements = [
      database
        .prepare(
          `DELETE FROM database_invariant_state
           WHERE singleton_key = ?`,
        )
        .bind(DATABASE_INVARIANT_MARKER_KEY),
    ];
    for (const candidate of manualCandidates) {
      statements.push(...manualAdoptionStatements(database, candidate));
    }
    try {
      await runInvariantBatch(database, statements);
    } catch {
      await invalidateReadinessMarker(database);
      throw new DatabaseInvariantError();
    }
    return true;
  }

  const externalRows =
    (await database
      .prepare(PHASE4_EXTERNAL_ADOPTION_SQL)
      .all<Record<string, unknown>>()).results ?? [];
  if (externalRows.length > MAX_EXTERNAL_SCAN) {
    await invalidateReadinessMarker(database);
    throw new DatabaseInvariantError();
  }
  const externalCandidates: ExternalAdoption[] = [];
  for (const row of externalRows) {
    const candidate = await readExternalAdoption(row);
    if (!candidate.stateMatches) externalCandidates.push(candidate);
    if (externalCandidates.length >= MAX_EXTERNAL_ADOPTIONS_PER_REQUEST) {
      break;
    }
  }
  if (externalCandidates.length === 0) return false;
  const statements = [
    database
      .prepare(
        `DELETE FROM database_invariant_state
         WHERE singleton_key = ?`,
      )
      .bind(DATABASE_INVARIANT_MARKER_KEY),
    ...externalCandidates.flatMap((candidate) =>
      externalAdoptionStatements(database, candidate),
    ),
  ];
  try {
    await runInvariantBatch(database, statements);
  } catch {
    await invalidateReadinessMarker(database);
    throw new DatabaseInvariantError();
  }
  return true;
}

const PHASE6_TAXONOMY_ADOPTION_COUNT_SQL = String.raw`
SELECT (
  (
    SELECT count(*)
    FROM event_lanes AS lane
    WHERE NOT EXISTS (
      SELECT 1
      FROM event_lane_taxonomy_states AS state
      WHERE state.lane_id = lane.id
        AND state.organization_id = lane.organization_id
    )
  )
  +
  (
    SELECT count(*)
    FROM categories AS category
    WHERE NOT EXISTS (
      SELECT 1
      FROM category_taxonomy_states AS state
      WHERE state.category_id = category.id
        AND state.organization_id = category.organization_id
    )
  )
  +
  (
    SELECT count(*)
    FROM taxonomy_write_intents AS intent
    WHERE intent.operation = 'adopt'
      AND intent.completed_at IS NULL
  )
) AS violation_count,
(
  (
    SELECT count(*)
    FROM (
      SELECT organization_id
      FROM event_lanes
      GROUP BY organization_id
      HAVING count(*) > 100
    )
  )
  +
  (
    SELECT count(*)
    FROM (
      SELECT organization_id
      FROM categories
      GROUP BY organization_id
      HAVING count(*) > 100
    )
  )
) AS overflow_count`;

/**
 * Phase 6 adds optimistic workflow state around the preexisting lane/category
 * scheduling identities. This bounded, set-based bootstrap runs before the
 * full integrity scan and never depends on an organizer route being visited.
 * Deterministic intent/audit IDs plus INSERT-OR-IGNORE make concurrent isolates
 * and a retry after an interrupted request converge without duplicate history.
 */
export async function adoptMissingPhase6TaxonomyStates(
  database: D1DatabaseLike,
): Promise<boolean> {
  let missing: Record<string, unknown> | null;
  try {
    missing = await database
      .prepare(PHASE6_TAXONOMY_ADOPTION_COUNT_SQL)
      .first<Record<string, unknown>>();
  } catch {
    // A pre-0015 migration-only harness does not yet have taxonomy state.
    return false;
  }
  if (readInteger(missing?.overflow_count) !== 0) {
    await invalidateReadinessMarker(database);
    throw new DatabaseInvariantError();
  }
  if (readViolationCount(missing) === 0) return false;

  const now = Date.now();
  const activeManagerSql = String.raw`
    SELECT membership.profile_id
    FROM organization_memberships AS membership
    JOIN profiles AS profile
      ON profile.id = membership.profile_id
     AND profile.status = 'active'
     AND profile.deleted_at IS NULL
    JOIN organizations AS organization
      ON organization.id = membership.organization_id
     AND organization.deleted_at IS NULL
    WHERE membership.organization_id = source.organization_id
      AND membership.role IN ('owner', 'administrator')
      AND membership.status = 'active'
      AND membership.deleted_at IS NULL
    ORDER BY CASE membership.role WHEN 'owner' THEN 0 ELSE 1 END,
             membership.id
    LIMIT 1`;
  const statements = [
    database
      .prepare(
        `DELETE FROM database_invariant_state
         WHERE singleton_key = ?`,
      )
      .bind(DATABASE_INVARIANT_MARKER_KEY),
    database
      .prepare(
        `INSERT OR IGNORE INTO taxonomy_write_intents (
           id, organization_id, entity_type, entity_id, operation,
           expected_content_version, proposed_content_version,
           proposed_name, proposed_slug, proposed_description,
           proposed_color_token, proposed_sort_order,
           proposed_deleted_at, mutation_group_id,
           mutation_group_size, actor_profile_id,
           created_at, completed_at
         )
         SELECT 'taxonomy-adopt-v1:lane:' || source.id,
                source.organization_id, 'lane', source.id, 'adopt',
                0, 1, source.name, source.slug, source.description,
                NULL, source.sort_order, source.deleted_at, NULL, NULL,
                (${activeManagerSql}), ?, NULL
         FROM event_lanes AS source
         WHERE NOT EXISTS (
           SELECT 1
           FROM event_lane_taxonomy_states AS state
           WHERE state.lane_id = source.id
         )
           AND (${activeManagerSql}) IS NOT NULL`,
      )
      .bind(now),
    database
      .prepare(
        `INSERT OR IGNORE INTO event_lane_taxonomy_states (
           lane_id, organization_id, content_version,
           active_intent_id, last_completed_intent_id,
           updated_by_profile_id, created_at, updated_at
         )
         SELECT source.id, source.organization_id, 1,
                intent.id, NULL, intent.actor_profile_id,
                intent.created_at, intent.created_at
         FROM event_lanes AS source
         JOIN taxonomy_write_intents AS intent
           ON intent.id = 'taxonomy-adopt-v1:lane:' || source.id
          AND intent.organization_id = source.organization_id
          AND intent.entity_type = 'lane'
          AND intent.entity_id = source.id
          AND intent.operation = 'adopt'
          AND intent.completed_at IS NULL
         WHERE NOT EXISTS (
           SELECT 1
           FROM event_lane_taxonomy_states AS state
           WHERE state.lane_id = source.id
         )`,
      ),
    database
      .prepare(
        `INSERT OR IGNORE INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         )
         SELECT 'taxonomy-adopt-audit-v1:lane:' || intent.entity_id,
                intent.organization_id, intent.actor_profile_id,
                'taxonomy.lane_adopted', 'event_lane',
                intent.entity_id,
                json_object('writeIntentId', intent.id),
                intent.created_at
         FROM taxonomy_write_intents AS intent
         WHERE intent.entity_type = 'lane'
           AND intent.operation = 'adopt'
           AND intent.completed_at IS NULL`,
      ),
    database
      .prepare(
        `UPDATE event_lane_taxonomy_states
         SET active_intent_id = NULL,
             last_completed_intent_id = active_intent_id,
             updated_by_profile_id = (
               SELECT intent.actor_profile_id
               FROM taxonomy_write_intents AS intent
               WHERE intent.id =
                     event_lane_taxonomy_states.active_intent_id
             ),
             updated_at = ?
         WHERE active_intent_id IN (
           SELECT intent.id
           FROM taxonomy_write_intents AS intent
           WHERE intent.entity_type = 'lane'
             AND intent.operation = 'adopt'
             AND intent.completed_at IS NULL
         )`,
      )
      .bind(now),
    database
      .prepare(
        `UPDATE taxonomy_write_intents
         SET completed_at = ?
         WHERE entity_type = 'lane'
           AND operation = 'adopt'
           AND completed_at IS NULL`,
      )
      .bind(now),
    database
      .prepare(
        `INSERT OR IGNORE INTO taxonomy_write_intents (
           id, organization_id, entity_type, entity_id, operation,
           expected_content_version, proposed_content_version,
           proposed_name, proposed_slug, proposed_description,
           proposed_color_token, proposed_sort_order,
           proposed_deleted_at, mutation_group_id,
           mutation_group_size, actor_profile_id,
           created_at, completed_at
         )
         SELECT 'taxonomy-adopt-v1:category:' || source.id,
                source.organization_id, 'category', source.id, 'adopt',
                0, 1, source.name, source.slug, source.description,
                source.color_token,
                (
                  SELECT count(*) * 10
                  FROM categories AS ordered
                  WHERE ordered.organization_id =
                        source.organization_id
                    AND (
                      ordered.name COLLATE NOCASE <
                          source.name COLLATE NOCASE
                      OR (
                        ordered.name COLLATE NOCASE =
                            source.name COLLATE NOCASE
                        AND ordered.id <= source.id
                      )
                    )
                ),
                source.deleted_at, NULL, NULL,
                (${activeManagerSql}), ?, NULL
         FROM categories AS source
         WHERE NOT EXISTS (
           SELECT 1
           FROM category_taxonomy_states AS state
           WHERE state.category_id = source.id
         )
           AND (${activeManagerSql}) IS NOT NULL`,
      )
      .bind(now),
    database
      .prepare(
        `INSERT OR IGNORE INTO category_taxonomy_states (
           category_id, organization_id, sort_order, content_version,
           active_intent_id, last_completed_intent_id,
           updated_by_profile_id, created_at, updated_at
         )
         SELECT source.id, source.organization_id,
                intent.proposed_sort_order, 1,
                intent.id, NULL, intent.actor_profile_id,
                intent.created_at, intent.created_at
         FROM categories AS source
         JOIN taxonomy_write_intents AS intent
           ON intent.id = 'taxonomy-adopt-v1:category:' || source.id
          AND intent.organization_id = source.organization_id
          AND intent.entity_type = 'category'
          AND intent.entity_id = source.id
          AND intent.operation = 'adopt'
          AND intent.completed_at IS NULL
         WHERE NOT EXISTS (
           SELECT 1
           FROM category_taxonomy_states AS state
           WHERE state.category_id = source.id
         )`,
      ),
    database
      .prepare(
        `INSERT OR IGNORE INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         )
         SELECT 'taxonomy-adopt-audit-v1:category:' ||
                    intent.entity_id,
                intent.organization_id, intent.actor_profile_id,
                'taxonomy.category_adopted', 'event_category',
                intent.entity_id,
                json_object('writeIntentId', intent.id),
                intent.created_at
         FROM taxonomy_write_intents AS intent
         WHERE intent.entity_type = 'category'
           AND intent.operation = 'adopt'
           AND intent.completed_at IS NULL`,
      ),
    database
      .prepare(
        `UPDATE category_taxonomy_states
         SET active_intent_id = NULL,
             last_completed_intent_id = active_intent_id,
             updated_by_profile_id = (
               SELECT intent.actor_profile_id
               FROM taxonomy_write_intents AS intent
               WHERE intent.id =
                     category_taxonomy_states.active_intent_id
             ),
             updated_at = ?
         WHERE active_intent_id IN (
           SELECT intent.id
           FROM taxonomy_write_intents AS intent
           WHERE intent.entity_type = 'category'
             AND intent.operation = 'adopt'
             AND intent.completed_at IS NULL
         )`,
      )
      .bind(now),
    database
      .prepare(
        `UPDATE taxonomy_write_intents
         SET completed_at = ?
         WHERE entity_type = 'category'
           AND operation = 'adopt'
           AND completed_at IS NULL`,
      )
      .bind(now),
  ];

  let results: Awaited<ReturnType<D1DatabaseLike["batch"]>>;
  try {
    results = await runInvariantBatch(database, statements);
  } catch {
    await invalidateReadinessMarker(database);
    throw new DatabaseInvariantError();
  }
  if (
    results.slice(1).every((result) => result.meta?.changes === 0)
  ) {
    await invalidateReadinessMarker(database);
    throw new DatabaseInvariantError();
  }
  return true;
}

const LEGACY_PUBLIC_ATTRIBUTION_ADOPTION_SQL = String.raw`
SELECT profile.id AS profile_id,
       profile.display_name AS display_name,
       membership.organization_id AS organization_id,
       COALESCE(attribution.attribution_version, 1)
         AS draft_version,
       (
         SELECT count(*)
         FROM organization_memberships AS active_membership
         WHERE active_membership.profile_id = profile.id
           AND active_membership.status = 'active'
           AND active_membership.deleted_at IS NULL
       ) AS active_organization_count,
       CASE
         WHEN length(trim(profile.display_name)) NOT BETWEEN 1 AND 120
           OR instr(profile.display_name, '@') > 0
           OR lower(trim(profile.display_name)) =
              lower(profile.normalized_email)
           OR ${protectedLegalClaimSql(["profile.display_name"])}
           OR ${publicOrganizerEmailExposureSql(
             ["profile.display_name"],
             "membership.organization_id",
           )}
         THEN 1
         ELSE 0
       END AS unsafe_public_content
FROM profiles AS profile
JOIN organization_memberships AS membership
  ON membership.profile_id = profile.id
 AND membership.status = 'active'
 AND membership.deleted_at IS NULL
LEFT JOIN organizer_public_attribution_states AS attribution
  ON attribution.profile_id = profile.id
 AND attribution.organization_id = membership.organization_id
WHERE profile.public_attribution_consent = 1
  AND profile.status = 'active'
  AND profile.deleted_at IS NULL
  AND (
    attribution.profile_id IS NULL
    OR (
      attribution.workflow_status = 'unconfirmed'
      AND attribution.published_attribution_version = 0
      AND attribution.current_receipt_id IS NULL
    )
  )
ORDER BY membership.organization_id, profile.id
LIMIT 1`;

/**
 * Phase 5 stored a canonical name/consent bit without a durable self-receipt.
 * Before the Phase 6 integrity marker can be certified, one bounded candidate
 * per fail-closed request is adopted into the receipt-backed model. The
 * `adopted` action preserves the exact already-public name without pretending
 * the organizer performed a new confirmation.
 */
async function adoptLegacyPublicAttribution(
  database: D1DatabaseLike,
): Promise<boolean> {
  let candidate: Record<string, unknown> | null;
  try {
    candidate = await database
      .prepare(LEGACY_PUBLIC_ATTRIBUTION_ADOPTION_SQL)
      .first<Record<string, unknown>>();
  } catch {
    // The additive Phase 6 tables may not exist in a pre-0015 migration seam.
    return false;
  }
  if (!candidate) return false;

  const profileId = readString(candidate.profile_id);
  const organizationId = readString(candidate.organization_id);
  const displayName = readString(candidate.display_name);
  const draftVersion = readInteger(candidate.draft_version);
  if (
    readInteger(candidate.active_organization_count) !== 1 ||
    readInteger(candidate.unsafe_public_content) !== 0 ||
    draftVersion < 1
  ) {
    await invalidateReadinessMarker(database);
    throw new DatabaseInvariantError();
  }

  const adoptionId = await sha256Hex(
    `phase6-public-attribution-adoption-v1\u0000${organizationId}\u0000${profileId}`,
  );
  const intentId = `attribution-adoption-intent:${adoptionId}`;
  const receiptId = `attribution-adoption-receipt:${adoptionId}`;
  const auditId = `attribution-adoption-audit:${adoptionId}`;
  const assertionKey = `attribution-adoption-assert:${adoptionId}`;
  const now = Date.now();
  const snapshotJson = JSON.stringify({
    biography: null,
    consent: true,
    displayName,
    draftVersion,
    legacyAdopted: true,
    photoAssetId: null,
  });
  const snapshotHash = await sha256Hex(snapshotJson);
  const metadataJson = JSON.stringify({
    draftVersion,
    publishedVersion: 1,
    writeIntentId: intentId,
  });
  const statements = [
    database
      .prepare(
        `DELETE FROM database_invariant_state
         WHERE singleton_key IN (?, ?)`,
      )
      .bind(DATABASE_INVARIANT_MARKER_KEY, assertionKey),
    database
      .prepare(
        `INSERT INTO organizer_public_attribution_states (
           profile_id, organization_id, attribution_version,
           published_attribution_version, workflow_status,
           draft_photo_media_asset_id, public_display_name,
           public_biography, public_photo_media_asset_id,
           current_receipt_id, confirmed_at, revoked_at,
           updated_by_profile_id, created_at, updated_at
         )
         SELECT profile.id, membership.organization_id, 1, 0,
                'unconfirmed', NULL, NULL, NULL, NULL, NULL,
                NULL, NULL, profile.id, ?, ?
         FROM profiles AS profile
         JOIN organization_memberships AS membership
           ON membership.profile_id = profile.id
          AND membership.organization_id = ?
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
         WHERE profile.id = ?
           AND profile.status = 'active'
           AND profile.deleted_at IS NULL
           AND profile.public_attribution_consent = 1
           AND NOT EXISTS (
             SELECT 1
             FROM organizer_public_attribution_states AS existing
             WHERE existing.profile_id = profile.id
           )`,
      )
      .bind(now, now, organizationId, profileId),
    database
      .prepare(
        `INSERT INTO organizer_public_attribution_write_intents (
           id, organization_id, profile_id, operation,
           expected_draft_version, expected_published_version,
           proposed_published_version, snapshot_hash,
           actor_profile_id, created_at, completed_at
         )
         SELECT ?, attribution.organization_id,
                attribution.profile_id, 'adopted',
                attribution.attribution_version, 0, 1, ?,
                attribution.profile_id, ?, NULL
         FROM organizer_public_attribution_states AS attribution
         WHERE attribution.profile_id = ?
           AND attribution.organization_id = ?
           AND attribution.attribution_version = ?
           AND attribution.published_attribution_version = 0
           AND attribution.workflow_status = 'unconfirmed'
           AND attribution.current_receipt_id IS NULL`,
      )
      .bind(
        intentId,
        snapshotHash,
        now,
        profileId,
        organizationId,
        draftVersion,
      ),
    database
      .prepare(
        `INSERT INTO organizer_public_attribution_receipts (
           id, organization_id, profile_id, action,
           attribution_version, display_name, biography,
           photo_media_asset_id, consent, draft_version,
           legacy_adopted, prior_published_version,
           snapshot_json, snapshot_hash,
           actor_profile_id, write_intent_id,
           related_receipt_id, created_at
         )
         SELECT ?, intent.organization_id, intent.profile_id,
                'adopted', 1, ?, NULL, NULL, 1, ?, 1, NULL,
                ?, ?, intent.profile_id,
                intent.id, NULL, ?
         FROM organizer_public_attribution_write_intents AS intent
         WHERE intent.id = ?
           AND intent.organization_id = ?
           AND intent.profile_id = ?
           AND intent.operation = 'adopted'
           AND intent.completed_at IS NULL`,
      )
      .bind(
        receiptId,
        displayName,
        draftVersion,
        snapshotJson,
        snapshotHash,
        now,
        intentId,
        organizationId,
        profileId,
      ),
    database
      .prepare(
        `UPDATE organizer_public_attribution_states
         SET published_attribution_version = 1,
             workflow_status = 'confirmed',
             public_display_name = ?,
             public_biography = NULL,
             public_photo_media_asset_id = NULL,
             current_receipt_id = ?,
             confirmed_at = ?,
             revoked_at = NULL,
             updated_by_profile_id = profile_id,
             updated_at = ?
         WHERE profile_id = ?
           AND organization_id = ?
           AND attribution_version = ?
           AND published_attribution_version = 0
           AND workflow_status = 'unconfirmed'
           AND current_receipt_id IS NULL`,
      )
      .bind(
        displayName,
        receiptId,
        now,
        now,
        profileId,
        organizationId,
        draftVersion,
      ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         )
         SELECT ?, ?, ?, 'profile.public_attribution_adopted',
                'profile', ?, ?, ?
         WHERE EXISTS (
           SELECT 1
           FROM organizer_public_attribution_states AS attribution
           JOIN organizer_public_attribution_receipts AS receipt
             ON receipt.id = attribution.current_receipt_id
            AND receipt.write_intent_id = ?
            AND receipt.action = 'adopted'
           WHERE attribution.profile_id = ?
             AND attribution.organization_id = ?
             AND attribution.attribution_version = ?
             AND attribution.published_attribution_version = 1
             AND attribution.workflow_status = 'confirmed'
         )`,
      )
      .bind(
        auditId,
        organizationId,
        profileId,
        profileId,
        metadataJson,
        now,
        intentId,
        profileId,
        organizationId,
        draftVersion,
      ),
    database
      .prepare(
        `UPDATE organizer_public_attribution_write_intents
         SET completed_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND profile_id = ?
           AND operation = 'adopted'
           AND expected_draft_version = ?
           AND expected_published_version = 0
           AND proposed_published_version = 1
           AND completed_at IS NULL`,
      )
      .bind(
        now,
        intentId,
        organizationId,
        profileId,
        draftVersion,
      ),
    database
      .prepare(
        `INSERT INTO database_invariant_state (
           singleton_key, version, trigger_fingerprint, verified_at
         )
         SELECT ?,
                CASE WHEN EXISTS (
                  SELECT 1
                  FROM organizer_public_attribution_states AS attribution
                  JOIN organizer_public_attribution_receipts AS receipt
                    ON receipt.id = attribution.current_receipt_id
                   AND receipt.organization_id =
                       attribution.organization_id
                   AND receipt.profile_id = attribution.profile_id
                   AND receipt.action = 'adopted'
                   AND receipt.attribution_version = 1
                   AND receipt.display_name = ?
                   AND receipt.biography IS NULL
                   AND receipt.photo_media_asset_id IS NULL
                   AND receipt.consent = 1
                   AND receipt.draft_version = ?
                   AND receipt.legacy_adopted = 1
                   AND receipt.prior_published_version IS NULL
                   AND receipt.snapshot_json = ?
                   AND receipt.snapshot_hash = ?
                   AND receipt.actor_profile_id = attribution.profile_id
                   AND receipt.write_intent_id = ?
                   AND receipt.related_receipt_id IS NULL
                  JOIN organizer_public_attribution_write_intents AS intent
                    ON intent.id = receipt.write_intent_id
                   AND intent.organization_id =
                       attribution.organization_id
                   AND intent.profile_id = attribution.profile_id
                   AND intent.operation = 'adopted'
                   AND intent.expected_draft_version = ?
                   AND intent.expected_published_version = 0
                   AND intent.proposed_published_version = 1
                   AND intent.snapshot_hash = receipt.snapshot_hash
                   AND intent.actor_profile_id = attribution.profile_id
                   AND intent.completed_at IS NOT NULL
                  JOIN audit_logs AS audit
                    ON audit.id = ?
                   AND audit.organization_id =
                       attribution.organization_id
                   AND audit.actor_profile_id =
                       attribution.profile_id
                   AND audit.action =
                       'profile.public_attribution_adopted'
                   AND audit.entity_type = 'profile'
                   AND audit.entity_id = attribution.profile_id
                   AND audit.metadata_json = ?
                  WHERE attribution.profile_id = ?
                    AND attribution.organization_id = ?
                    AND attribution.attribution_version = ?
                    AND attribution.published_attribution_version = 1
                    AND attribution.workflow_status = 'confirmed'
                    AND attribution.public_display_name = ?
                    AND attribution.public_biography IS NULL
                    AND attribution.public_photo_media_asset_id IS NULL
                    AND attribution.confirmed_at IS NOT NULL
                    AND attribution.revoked_at IS NULL
                ) THEN 1 ELSE 0 END,
                ?, ?
         ON CONFLICT(singleton_key) DO UPDATE SET
           version = excluded.version,
           trigger_fingerprint = excluded.trigger_fingerprint,
           verified_at = excluded.verified_at`,
      )
      .bind(
        assertionKey,
        displayName,
        draftVersion,
        snapshotJson,
        snapshotHash,
        intentId,
        draftVersion,
        auditId,
        metadataJson,
        profileId,
        organizationId,
        draftVersion,
        displayName,
        snapshotHash,
        now,
      ),
    database
      .prepare(
        `DELETE FROM database_invariant_state
         WHERE singleton_key = ?`,
      )
      .bind(assertionKey),
  ];

  try {
    const results = await runInvariantBatch(database, statements);
    if (
      results[2]?.meta?.changes !== 1 ||
      results[3]?.meta?.changes !== 1 ||
      results[4]?.meta?.changes !== 1 ||
      results[5]?.meta?.changes !== 1 ||
      results[6]?.meta?.changes !== 1 ||
      results[7]?.meta?.changes !== 1 ||
      results[8]?.meta?.changes !== 1
    ) {
      throw new DatabaseInvariantError();
    }
  } catch {
    if (
      await hasExactAdoptedPublicAttribution(
        database,
        organizationId,
        profileId,
        displayName,
        snapshotJson,
        snapshotHash,
        intentId,
        receiptId,
        auditId,
        metadataJson,
      )
    ) {
      return true;
    }
    await invalidateReadinessMarker(database);
    throw new DatabaseInvariantError();
  }
  return true;
}

async function hasExactAdoptedPublicAttribution(
  database: D1DatabaseLike,
  organizationId: string,
  profileId: string,
  displayName: string,
  snapshotJson: string,
  snapshotHash: string,
  intentId: string,
  receiptId: string,
  auditId: string,
  metadataJson: string,
): Promise<boolean> {
  const row = await database
    .prepare(
      `SELECT count(*) AS exact_count
       FROM organizer_public_attribution_states AS attribution
       JOIN organizer_public_attribution_receipts AS receipt
         ON receipt.id = attribution.current_receipt_id
        AND receipt.id = ?
        AND receipt.organization_id = attribution.organization_id
        AND receipt.profile_id = attribution.profile_id
        AND receipt.action = 'adopted'
        AND receipt.attribution_version =
            attribution.published_attribution_version
        AND receipt.display_name = ?
        AND receipt.biography IS NULL
        AND receipt.photo_media_asset_id IS NULL
        AND receipt.consent = 1
        AND receipt.draft_version = attribution.attribution_version
        AND receipt.legacy_adopted = 1
        AND receipt.prior_published_version IS NULL
        AND receipt.snapshot_json = ?
        AND receipt.snapshot_hash = ?
       JOIN organizer_public_attribution_write_intents AS intent
         ON intent.id = receipt.write_intent_id
        AND intent.id = ?
        AND intent.completed_at IS NOT NULL
        AND intent.snapshot_hash = receipt.snapshot_hash
       JOIN audit_logs AS audit
         ON audit.id = ?
        AND audit.organization_id = attribution.organization_id
        AND audit.actor_profile_id = attribution.profile_id
        AND audit.action = 'profile.public_attribution_adopted'
        AND audit.entity_type = 'profile'
        AND audit.entity_id = attribution.profile_id
        AND audit.metadata_json = ?
       JOIN profiles AS profile
         ON profile.id = attribution.profile_id
        AND profile.public_attribution_consent = 1
        AND profile.display_name = attribution.public_display_name
       WHERE attribution.profile_id = ?
         AND attribution.organization_id = ?
         AND attribution.workflow_status = 'confirmed'
         AND attribution.public_display_name = ?
         AND attribution.published_attribution_version = 1`,
    )
    .bind(
      receiptId,
      displayName,
      snapshotJson,
      snapshotHash,
      intentId,
      auditId,
      metadataJson,
      profileId,
      organizationId,
      displayName,
    )
    .first<{ exact_count: number }>();
  return row?.exact_count === 1;
}

type AdoptionInterval = Readonly<{
  actualEndUtc: number;
  actualStartUtc: number;
  expandedEndUtc: number;
  expandedStartUtc: number;
}>;

type ManualAdoption = Readonly<{
  actorProfileId: string;
  allDayEndDateExclusive: string | null;
  allDayStartDate: string | null;
  bufferAfterMinutes: number;
  bufferBeforeMinutes: number;
  clubId: string;
  contentVersion: number;
  eventId: string;
  fingerprint: string;
  interval: AdoptionInterval;
  organizerScopeJson: string;
  organizationId: string;
  planningStatus: "draft" | "idea";
  policyId: string;
  policyMode: string;
  policyVersion: number;
  primaryOrganizerProfileId: string;
  scheduleShape: "all_day" | "timed";
  scheduleVersion: number;
  stateMatches: boolean;
  timeZone: string;
  venueId: string | null;
}>;

type ExternalAdoption = Readonly<{
  allDayEndDateExclusive: string | null;
  allDayStartDate: string | null;
  bufferAfterMinutes: number;
  bufferBeforeMinutes: number;
  clubId: string;
  eventId: string;
  generationId: string | null;
  holdExpiresAt: number | null;
  interval: AdoptionInterval;
  organizerScopeJson: string;
  organizationId: string;
  planningStatus: string;
  primaryOrganizerProfileId: string | null;
  scheduleShape: "all_day" | "timed";
  scheduleVersion: number;
  sourceKind: "legacy" | "meetup";
  sourceFingerprint: string;
  sourceRecordId: string;
  stateMatches: boolean;
  normalizedStateFingerprint: string;
  reservationSemanticFingerprint: string;
  snapshotId: string | null;
  syncSourceId: string | null;
  timeZone: string;
  title: string;
  venueId: string | null;
}>;

async function readManualAdoption(
  row: Record<string, unknown>,
): Promise<ManualAdoption> {
  const scheduleShape = readScheduleShape(row.schedule_shape);
  const timeZone = readString(row.timezone);
  const bufferBeforeMinutes = readInteger(row.buffer_before_minutes);
  const bufferAfterMinutes = readInteger(row.buffer_after_minutes);
  const allDayStartDate = readNullableString(row.all_day_start_date);
  const allDayEndDateExclusive = readNullableString(
    row.all_day_end_date_exclusive,
  );
  const interval =
    scheduleShape === "timed"
      ? normalizeConflictInterval({
          startUtc: readInteger(row.starts_at_utc),
          endUtc: readInteger(row.ends_at_utc),
          bufferBeforeMinutes,
          bufferAfterMinutes,
        })
      : normalizeAllDayConflictInterval({
          startDate: allDayStartDate,
          endDateExclusive: allDayEndDateExclusive,
          timeZone,
          bufferBeforeMinutes,
          bufferAfterMinutes,
        });
  const organizerScope = readCanonicalIdentifierArray(
    row.organizer_scope_json,
    false,
  );
  const organizerScopeJson = JSON.stringify(organizerScope);
  const stateMatches =
    row.state_organization_id === row.organization_id &&
    row.state_event_id === row.event_id &&
    row.state_club_id === row.club_id &&
    row.state_planning_status === row.planning_status &&
    row.state_schedule_shape === scheduleShape &&
    row.state_timezone === timeZone &&
    row.state_all_day_start_date === allDayStartDate &&
    row.state_all_day_end_date_exclusive === allDayEndDateExclusive &&
    row.state_buffer_before_minutes === bufferBeforeMinutes &&
    row.state_buffer_after_minutes === bufferAfterMinutes &&
    row.state_venue_id === row.venue_id &&
    row.state_primary_organizer_profile_id ===
      row.primary_organizer_profile_id &&
    row.state_organizer_scope_json === organizerScopeJson &&
    row.state_schedule_version === row.schedule_version &&
    row.state_policy_version === row.policy_version &&
    row.state_actual_start_utc === interval.actualStartUtc &&
    row.state_actual_end_utc === interval.actualEndUtc &&
    row.state_expanded_start_utc === interval.expandedStartUtc &&
    row.state_expanded_end_utc === interval.expandedEndUtc;
  const fingerprint = await sha256Hex(
    JSON.stringify({
      allDayEndDateExclusive,
      allDayStartDate,
      bufferAfterMinutes,
      bufferBeforeMinutes,
      clubId: readString(row.club_id),
      eventId: readString(row.event_id),
      interval,
      organizerScope,
      organizationId: readString(row.organization_id),
      planningStatus: readPlanningStatus(row.planning_status),
      primaryOrganizerProfileId: readString(
        row.primary_organizer_profile_id,
      ),
      scheduleShape,
      scheduleVersion: readInteger(row.schedule_version),
      timeZone,
      venueId: readNullableString(row.venue_id),
    }),
  );
  return Object.freeze({
    actorProfileId: readString(row.actor_profile_id),
    allDayEndDateExclusive,
    allDayStartDate,
    bufferAfterMinutes,
    bufferBeforeMinutes,
    clubId: readString(row.club_id),
    contentVersion: readInteger(row.content_version),
    eventId: readString(row.event_id),
    fingerprint,
    interval,
    organizerScopeJson,
    organizationId: readString(row.organization_id),
    planningStatus: readPlanningStatus(row.planning_status),
    policyId: readString(row.policy_id),
    policyMode: readString(row.policy_mode),
    policyVersion: readInteger(row.policy_version),
    primaryOrganizerProfileId: readString(
      row.primary_organizer_profile_id,
    ),
    scheduleShape,
    scheduleVersion: readInteger(row.schedule_version),
    stateMatches,
    timeZone,
    venueId: readNullableString(row.venue_id),
  });
}

async function readExternalAdoption(
  row: Record<string, unknown>,
): Promise<ExternalAdoption> {
  const scheduleShape = readScheduleShape(row.schedule_shape);
  const timeZone = readString(row.timezone);
  const bufferBeforeMinutes = readInteger(row.buffer_before_minutes);
  const bufferAfterMinutes = readInteger(row.buffer_after_minutes);
  const allDayStartDate = readNullableString(row.all_day_start_date);
  const allDayEndDateExclusive = readNullableString(
    row.all_day_end_date_exclusive,
  );
  const interval =
    scheduleShape === "timed"
      ? normalizeConflictInterval({
          startUtc: readInteger(row.starts_at_utc),
          endUtc: readInteger(row.ends_at_utc),
          bufferBeforeMinutes,
          bufferAfterMinutes,
        })
      : normalizeAllDayConflictInterval({
          startDate: allDayStartDate,
          endDateExclusive: allDayEndDateExclusive,
          timeZone,
          bufferBeforeMinutes,
          bufferAfterMinutes,
        });
  const organizerScope = readCanonicalIdentifierArray(
    row.organizer_scope_json,
    true,
  );
  const organizerScopeJson = JSON.stringify(organizerScope);
  const sourceKind = readString(row.source_kind);
  if (sourceKind !== "legacy" && sourceKind !== "meetup") {
    throw new DatabaseInvariantError();
  }
  const sourceFingerprint =
    sourceKind === "meetup"
      ? readSha256(row.source_fingerprint)
      : await sha256Hex(
          JSON.stringify({
            eventId: readString(row.event_id),
            organizationId: readString(row.organization_id),
            scheduleVersion: readInteger(row.schedule_version),
            title: readString(row.title),
          }),
        );
  const normalizedStateFingerprint =
    await externalReservationStateFingerprint({
      allDayEndDateExclusive,
      allDayStartDate,
      bufferAfterMinutes,
      bufferBeforeMinutes,
      clubId: readString(row.club_id),
      eventId: readString(row.event_id),
      generationId: readNullableString(row.generation_id),
      holdExpiresAt: readNullableInteger(row.hold_expires_at),
      interval,
      organizerScope,
      organizationId: readString(row.organization_id),
      planningStatus: readString(row.planning_status),
      primaryOrganizerProfileId: readNullableString(
        row.primary_organizer_profile_id,
      ),
      scheduleShape,
      scheduleVersion: readInteger(row.schedule_version),
      sourceFingerprint,
      sourceKind,
      sourceRecordId: readString(row.source_record_id),
      syncSourceId: readNullableString(row.sync_source_id),
      timeZone,
      venueId: readNullableString(row.venue_id),
    });
  const reservationSemanticFingerprint =
    await externalReservationSemanticFingerprint({
      allDayEndDateExclusive,
      allDayStartDate,
      bufferAfterMinutes,
      bufferBeforeMinutes,
      clubId: readString(row.club_id),
      eventId: readString(row.event_id),
      generationId: readNullableString(row.generation_id),
      holdExpiresAt: readNullableInteger(row.hold_expires_at),
      interval,
      organizerScope,
      organizationId: readString(row.organization_id),
      planningStatus: readString(row.planning_status),
      primaryOrganizerProfileId: readNullableString(
        row.primary_organizer_profile_id,
      ),
      scheduleShape,
      scheduleVersion: readInteger(row.schedule_version),
      sourceFingerprint,
      sourceKind,
      sourceRecordId: readString(row.source_record_id),
      syncSourceId: readNullableString(row.sync_source_id),
      timeZone,
      venueId: readNullableString(row.venue_id),
    });
  const normalizationMatches =
    sourceKind === "legacy"
      ? row.normalization_id == null
      : row.normalization_organization_id === row.organization_id &&
        row.normalization_sync_source_id === row.sync_source_id &&
        row.normalization_generation_id === row.generation_id &&
        row.normalization_snapshot_id === row.snapshot_id &&
        row.normalization_event_id === row.event_id &&
        row.normalization_club_id === row.club_id &&
        row.normalization_planning_status === row.planning_status &&
        row.normalization_schedule_shape === scheduleShape &&
        row.normalization_timezone === timeZone &&
        row.normalization_all_day_start_date === allDayStartDate &&
        row.normalization_all_day_end_date_exclusive ===
          allDayEndDateExclusive &&
        row.normalization_buffer_before_minutes === bufferBeforeMinutes &&
        row.normalization_buffer_after_minutes === bufferAfterMinutes &&
        row.normalization_venue_id === row.venue_id &&
        row.normalization_primary_organizer_profile_id ===
          row.primary_organizer_profile_id &&
        row.normalization_organizer_scope_json === organizerScopeJson &&
        row.normalization_schedule_version === row.schedule_version &&
        row.normalization_hold_expires_at === row.hold_expires_at &&
        row.normalization_source_fingerprint === sourceFingerprint &&
        row.normalization_normalized_state_fingerprint ===
          normalizedStateFingerprint &&
        row.normalization_reservation_semantic_fingerprint ===
          reservationSemanticFingerprint &&
        row.normalization_actual_start_utc === interval.actualStartUtc &&
        row.normalization_actual_end_utc === interval.actualEndUtc &&
        row.normalization_expanded_start_utc === interval.expandedStartUtc &&
        row.normalization_expanded_end_utc === interval.expandedEndUtc;
  const stateMatches =
    row.state_organization_id === row.organization_id &&
    row.state_source_kind === sourceKind &&
    row.state_source_record_id === row.source_record_id &&
    row.state_sync_source_id === row.sync_source_id &&
    row.state_generation_id === row.generation_id &&
    row.state_event_id === row.event_id &&
    row.state_club_id === row.club_id &&
    row.state_hold_expires_at === row.hold_expires_at &&
    row.state_schedule_shape === scheduleShape &&
    row.state_timezone === timeZone &&
    row.state_all_day_start_date === allDayStartDate &&
    row.state_all_day_end_date_exclusive === allDayEndDateExclusive &&
    row.state_buffer_before_minutes === bufferBeforeMinutes &&
    row.state_buffer_after_minutes === bufferAfterMinutes &&
    row.state_venue_id === row.venue_id &&
    row.state_primary_organizer_profile_id ===
      row.primary_organizer_profile_id &&
    row.state_organizer_scope_json === organizerScopeJson &&
    row.state_schedule_version === row.schedule_version &&
    row.state_planning_status === row.planning_status &&
    row.state_title === row.title &&
    row.state_source_fingerprint === sourceFingerprint &&
    row.state_normalized_state_fingerprint ===
      normalizedStateFingerprint &&
    row.state_reservation_semantic_fingerprint ===
      reservationSemanticFingerprint &&
    row.state_actual_start_utc === interval.actualStartUtc &&
    row.state_actual_end_utc === interval.actualEndUtc &&
    row.state_expanded_start_utc === interval.expandedStartUtc &&
    row.state_expanded_end_utc === interval.expandedEndUtc &&
    normalizationMatches;
  return Object.freeze({
    allDayEndDateExclusive,
    allDayStartDate,
    bufferAfterMinutes,
    bufferBeforeMinutes,
    clubId: readString(row.club_id),
    eventId: readString(row.event_id),
    generationId: readNullableString(row.generation_id),
    holdExpiresAt: readNullableInteger(row.hold_expires_at),
    interval,
    organizerScopeJson,
    organizationId: readString(row.organization_id),
    planningStatus: readString(row.planning_status),
    primaryOrganizerProfileId: readNullableString(
      row.primary_organizer_profile_id,
    ),
    scheduleShape,
    scheduleVersion: readInteger(row.schedule_version),
    sourceKind,
    sourceFingerprint,
    sourceRecordId: readString(row.source_record_id),
    stateMatches,
    normalizedStateFingerprint,
    reservationSemanticFingerprint,
    snapshotId: readNullableString(row.snapshot_id),
    syncSourceId: readNullableString(row.sync_source_id),
    timeZone,
    title: readString(row.title),
    venueId: readNullableString(row.venue_id),
  });
}

function manualAdoptionStatements(
  database: D1DatabaseLike,
  candidate: ManualAdoption,
) {
  const intentId = `phase4-backfill-${crypto.randomUUID()}`;
  const now = Date.now();
  const values = [
    intentId,
    candidate.organizationId,
    candidate.eventId,
    candidate.actorProfileId,
    candidate.clubId,
    candidate.planningStatus,
    candidate.scheduleShape,
    candidate.interval.actualStartUtc,
    candidate.interval.actualEndUtc,
    candidate.interval.expandedStartUtc,
    candidate.interval.expandedEndUtc,
    candidate.timeZone,
    candidate.allDayStartDate,
    candidate.allDayEndDateExclusive,
    candidate.bufferBeforeMinutes,
    candidate.bufferAfterMinutes,
    candidate.venueId,
    candidate.primaryOrganizerProfileId,
    candidate.organizerScopeJson,
    candidate.contentVersion,
    candidate.scheduleVersion,
    candidate.contentVersion,
    candidate.scheduleVersion,
    candidate.policyId,
    candidate.policyVersion,
    candidate.policyMode,
    candidate.fingerprint,
    now,
  ] as const;
  return [
    database
      .prepare(
        `INSERT INTO organizer_schedule_write_intents (
           id, organization_id, organizer_event_id, actor_profile_id,
           club_id, operation, planning_status, schedule_shape,
           actual_start_utc, actual_end_utc, expanded_start_utc,
           expanded_end_utc, timezone, all_day_start_date,
           all_day_end_date_exclusive, buffer_before_minutes,
           buffer_after_minutes, venue_id, primary_organizer_profile_id,
           organizer_scope_json, hold_expires_at,
           expected_content_version, expected_schedule_version,
           proposed_content_version, proposed_schedule_version,
           policy_id, policy_version, policy_mode, reason,
           review_request_id, state_fingerprint, created_at, completed_at
         ) VALUES (
           ?, ?, ?, ?, ?, 'phase4_backfill', ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL
         )`,
      )
      .bind(...values),
    database
      .prepare(
        `INSERT INTO organizer_reservation_states (
           organizer_event_id, organization_id, club_id, planning_status,
           schedule_shape, actual_start_utc, actual_end_utc,
           expanded_start_utc, expanded_end_utc, timezone,
           all_day_start_date, all_day_end_date_exclusive,
           buffer_before_minutes, buffer_after_minutes, venue_id,
           primary_organizer_profile_id, organizer_scope_json,
           hold_expires_at, schedule_version, policy_version,
           write_intent_id, updated_by_profile_id, updated_at
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?,
           ?, ?, ?, ?
         )
         ON CONFLICT(organizer_event_id) DO UPDATE SET
           organization_id = excluded.organization_id,
           club_id = excluded.club_id,
           planning_status = excluded.planning_status,
           schedule_shape = excluded.schedule_shape,
           actual_start_utc = excluded.actual_start_utc,
           actual_end_utc = excluded.actual_end_utc,
           expanded_start_utc = excluded.expanded_start_utc,
           expanded_end_utc = excluded.expanded_end_utc,
           timezone = excluded.timezone,
           all_day_start_date = excluded.all_day_start_date,
           all_day_end_date_exclusive =
             excluded.all_day_end_date_exclusive,
           buffer_before_minutes = excluded.buffer_before_minutes,
           buffer_after_minutes = excluded.buffer_after_minutes,
           venue_id = excluded.venue_id,
           primary_organizer_profile_id =
             excluded.primary_organizer_profile_id,
           organizer_scope_json = excluded.organizer_scope_json,
           hold_expires_at = excluded.hold_expires_at,
           schedule_version = excluded.schedule_version,
           policy_version = excluded.policy_version,
           write_intent_id = excluded.write_intent_id,
           updated_by_profile_id = excluded.updated_by_profile_id,
           updated_at = excluded.updated_at`,
      )
      .bind(
        candidate.eventId,
        candidate.organizationId,
        candidate.clubId,
        candidate.planningStatus,
        candidate.scheduleShape,
        candidate.interval.actualStartUtc,
        candidate.interval.actualEndUtc,
        candidate.interval.expandedStartUtc,
        candidate.interval.expandedEndUtc,
        candidate.timeZone,
        candidate.allDayStartDate,
        candidate.allDayEndDateExclusive,
        candidate.bufferBeforeMinutes,
        candidate.bufferAfterMinutes,
        candidate.venueId,
        candidate.primaryOrganizerProfileId,
        candidate.organizerScopeJson,
        candidate.scheduleVersion,
        candidate.policyVersion,
        intentId,
        candidate.actorProfileId,
        now,
      ),
    database
      .prepare(
        `UPDATE organizer_schedule_write_intents
         SET completed_at = ?
         WHERE id = ?
           AND completed_at IS NULL`,
      )
      .bind(now, intentId),
  ];
}

function externalAdoptionStatements(
  database: D1DatabaseLike,
  candidate: ExternalAdoption,
) {
  const id = `${candidate.sourceKind}-interval:${candidate.sourceRecordId}`;
  const now = Date.now();
  const statements = [];
  if (candidate.sourceKind === "meetup") {
    if (
      candidate.snapshotId == null ||
      candidate.syncSourceId == null ||
      candidate.generationId == null
    ) {
      throw new DatabaseInvariantError();
    }
    statements.push(
      database
        .prepare(
          `INSERT INTO meetup_snapshot_reservation_normalizations (
             id, organization_id, sync_source_id, generation_id,
             snapshot_id, event_id, club_id, planning_status,
             schedule_shape, actual_start_utc, actual_end_utc,
             expanded_start_utc, expanded_end_utc, timezone,
             all_day_start_date, all_day_end_date_exclusive,
             buffer_before_minutes, buffer_after_minutes, venue_id,
             primary_organizer_profile_id, organizer_scope_json,
             schedule_version, hold_expires_at, source_fingerprint,
             normalized_state_fingerprint,
             reservation_semantic_fingerprint, created_at, updated_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?
           )
           ON CONFLICT(
             sync_source_id, generation_id, snapshot_id, event_id
           ) DO UPDATE SET
             organization_id = excluded.organization_id,
             club_id = excluded.club_id,
             planning_status = excluded.planning_status,
             schedule_shape = excluded.schedule_shape,
             actual_start_utc = excluded.actual_start_utc,
             actual_end_utc = excluded.actual_end_utc,
             expanded_start_utc = excluded.expanded_start_utc,
             expanded_end_utc = excluded.expanded_end_utc,
             timezone = excluded.timezone,
             all_day_start_date = excluded.all_day_start_date,
             all_day_end_date_exclusive =
               excluded.all_day_end_date_exclusive,
             buffer_before_minutes = excluded.buffer_before_minutes,
             buffer_after_minutes = excluded.buffer_after_minutes,
             venue_id = excluded.venue_id,
             primary_organizer_profile_id =
               excluded.primary_organizer_profile_id,
             organizer_scope_json = excluded.organizer_scope_json,
             schedule_version = excluded.schedule_version,
             hold_expires_at = excluded.hold_expires_at,
             source_fingerprint = excluded.source_fingerprint,
             normalized_state_fingerprint =
               excluded.normalized_state_fingerprint,
             reservation_semantic_fingerprint =
               excluded.reservation_semantic_fingerprint,
             updated_at = excluded.updated_at`,
        )
        .bind(
          `meetup-normalization:${candidate.sourceRecordId}`,
          candidate.organizationId,
          candidate.syncSourceId,
          candidate.generationId,
          candidate.snapshotId,
          candidate.eventId,
          candidate.clubId,
          candidate.planningStatus,
          candidate.scheduleShape,
          candidate.interval.actualStartUtc,
          candidate.interval.actualEndUtc,
          candidate.interval.expandedStartUtc,
          candidate.interval.expandedEndUtc,
          candidate.timeZone,
          candidate.allDayStartDate,
          candidate.allDayEndDateExclusive,
          candidate.bufferBeforeMinutes,
          candidate.bufferAfterMinutes,
          candidate.venueId,
          candidate.primaryOrganizerProfileId,
          candidate.organizerScopeJson,
          candidate.scheduleVersion,
          candidate.holdExpiresAt,
          candidate.sourceFingerprint,
          candidate.normalizedStateFingerprint,
          candidate.reservationSemanticFingerprint,
          now,
          now,
        ),
    );
  }
  statements.push(
    database
    .prepare(
      `INSERT INTO organizer_external_reservation_intervals (
         id, organization_id, source_kind, source_record_id, sync_source_id,
         generation_id, event_id, club_id, planning_status, schedule_shape,
         actual_start_utc, actual_end_utc, expanded_start_utc,
         expanded_end_utc, timezone, all_day_start_date,
         all_day_end_date_exclusive, buffer_before_minutes,
         buffer_after_minutes, venue_id, primary_organizer_profile_id,
         organizer_scope_json, schedule_version, hold_expires_at, title,
         source_fingerprint, normalized_state_fingerprint,
         reservation_semantic_fingerprint,
         created_at, updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, ?
       )
       ON CONFLICT(source_kind, source_record_id) DO UPDATE SET
         organization_id = excluded.organization_id,
         sync_source_id = excluded.sync_source_id,
         generation_id = excluded.generation_id,
         event_id = excluded.event_id,
         club_id = excluded.club_id,
         planning_status = excluded.planning_status,
         schedule_shape = excluded.schedule_shape,
         actual_start_utc = excluded.actual_start_utc,
         actual_end_utc = excluded.actual_end_utc,
         expanded_start_utc = excluded.expanded_start_utc,
         expanded_end_utc = excluded.expanded_end_utc,
         timezone = excluded.timezone,
         all_day_start_date = excluded.all_day_start_date,
         all_day_end_date_exclusive =
           excluded.all_day_end_date_exclusive,
         buffer_before_minutes = excluded.buffer_before_minutes,
         buffer_after_minutes = excluded.buffer_after_minutes,
         venue_id = excluded.venue_id,
         primary_organizer_profile_id =
           excluded.primary_organizer_profile_id,
         organizer_scope_json = excluded.organizer_scope_json,
         schedule_version = excluded.schedule_version,
         hold_expires_at = excluded.hold_expires_at,
         title = excluded.title,
         source_fingerprint = excluded.source_fingerprint,
         normalized_state_fingerprint =
           excluded.normalized_state_fingerprint,
         reservation_semantic_fingerprint =
           excluded.reservation_semantic_fingerprint,
         updated_at = excluded.updated_at
       WHERE organizer_external_reservation_intervals.organization_id
             IS NOT excluded.organization_id
          OR organizer_external_reservation_intervals.sync_source_id
             IS NOT excluded.sync_source_id
          OR organizer_external_reservation_intervals.generation_id
             IS NOT excluded.generation_id
          OR organizer_external_reservation_intervals.event_id
             <> excluded.event_id
          OR organizer_external_reservation_intervals.club_id
             <> excluded.club_id
          OR organizer_external_reservation_intervals.planning_status
             <> excluded.planning_status
          OR organizer_external_reservation_intervals.actual_start_utc
             <> excluded.actual_start_utc
          OR organizer_external_reservation_intervals.actual_end_utc
             <> excluded.actual_end_utc
          OR organizer_external_reservation_intervals.expanded_start_utc
             <> excluded.expanded_start_utc
          OR organizer_external_reservation_intervals.expanded_end_utc
             <> excluded.expanded_end_utc
          OR organizer_external_reservation_intervals.timezone
             <> excluded.timezone
          OR organizer_external_reservation_intervals.all_day_start_date
             IS NOT excluded.all_day_start_date
          OR organizer_external_reservation_intervals.all_day_end_date_exclusive
             IS NOT excluded.all_day_end_date_exclusive
          OR organizer_external_reservation_intervals.buffer_before_minutes
             <> excluded.buffer_before_minutes
          OR organizer_external_reservation_intervals.buffer_after_minutes
             <> excluded.buffer_after_minutes
          OR organizer_external_reservation_intervals.venue_id
             IS NOT excluded.venue_id
          OR organizer_external_reservation_intervals.primary_organizer_profile_id
             IS NOT excluded.primary_organizer_profile_id
          OR organizer_external_reservation_intervals.organizer_scope_json
             <> excluded.organizer_scope_json
          OR organizer_external_reservation_intervals.schedule_version
             <> excluded.schedule_version
          OR organizer_external_reservation_intervals.hold_expires_at
             IS NOT excluded.hold_expires_at
          OR organizer_external_reservation_intervals.title
             <> excluded.title
          OR organizer_external_reservation_intervals.source_fingerprint
             <> excluded.source_fingerprint
          OR organizer_external_reservation_intervals.normalized_state_fingerprint
             <> excluded.normalized_state_fingerprint
          OR organizer_external_reservation_intervals.reservation_semantic_fingerprint
             <> excluded.reservation_semantic_fingerprint`,
    )
    .bind(
      id,
      candidate.organizationId,
      candidate.sourceKind,
      candidate.sourceRecordId,
      candidate.syncSourceId,
      candidate.generationId,
      candidate.eventId,
      candidate.clubId,
      candidate.planningStatus,
      candidate.scheduleShape,
      candidate.interval.actualStartUtc,
      candidate.interval.actualEndUtc,
      candidate.interval.expandedStartUtc,
      candidate.interval.expandedEndUtc,
      candidate.timeZone,
      candidate.allDayStartDate,
      candidate.allDayEndDateExclusive,
      candidate.bufferBeforeMinutes,
      candidate.bufferAfterMinutes,
      candidate.venueId,
      candidate.primaryOrganizerProfileId,
      candidate.organizerScopeJson,
      candidate.scheduleVersion,
      candidate.holdExpiresAt,
      candidate.title,
      candidate.sourceFingerprint,
      candidate.normalizedStateFingerprint,
      candidate.reservationSemanticFingerprint,
      now,
      now,
    ),
  );
  return statements;
}

function readCanonicalIdentifierArray(
  value: unknown,
  allowEmpty: boolean,
): readonly string[] {
  if (typeof value !== "string") throw new DatabaseInvariantError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new DatabaseInvariantError();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (item) =>
        typeof item !== "string" ||
        item.length === 0 ||
        item.length > 128,
    )
  ) {
    throw new DatabaseInvariantError();
  }
  const unique = [...new Set(parsed)].sort();
  if ((!allowEmpty && unique.length === 0) || unique.length !== parsed.length) {
    throw new DatabaseInvariantError();
  }
  return Object.freeze(unique);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function readString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DatabaseInvariantError();
  }
  return value;
}

function readNullableString(value: unknown): string | null {
  if (value === null) return null;
  return readString(value);
}

function readInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new DatabaseInvariantError();
  }
  return value;
}

function readNullableInteger(value: unknown): number | null {
  if (value === null) return null;
  return readInteger(value);
}

function readScheduleShape(value: unknown): "all_day" | "timed" {
  if (value !== "all_day" && value !== "timed") {
    throw new DatabaseInvariantError();
  }
  return value;
}

function readPlanningStatus(value: unknown): "draft" | "idea" {
  if (value !== "draft" && value !== "idea") {
    throw new DatabaseInvariantError();
  }
  return value;
}

function readSha256(value: unknown): string {
  const fingerprint = readString(value);
  if (!/^[a-f0-9]{64}$/u.test(fingerprint)) {
    throw new DatabaseInvariantError();
  }
  return fingerprint;
}

async function runInvariantBatch(
  database: D1DatabaseLike,
  statements: Parameters<D1DatabaseLike["batch"]>[0],
): Promise<Awaited<ReturnType<D1DatabaseLike["batch"]>>> {
  if (statements.length > DATABASE_INVARIANT_STATEMENT_LIMIT) {
    throw new DatabaseInvariantError();
  }
  const results = await database.batch(statements);
  if (
    results.length !== statements.length ||
    results.some((result) => result.success === false)
  ) {
    throw new DatabaseInvariantError();
  }
  return results;
}

async function invalidateReadinessMarker(
  database: D1DatabaseLike,
): Promise<void> {
  await database
    .prepare(
      `DELETE FROM database_invariant_state
       WHERE singleton_key = ?`,
    )
    .bind(DATABASE_INVARIANT_MARKER_KEY)
    .run();
}

function quoteSqliteIdentifier(value: string): string {
  return `"${value.replace(/"/gu, '""')}"`;
}

function quoteSqliteStringLiteral(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

function expectedNormalizedTriggerDefinitions(
  contract: DatabaseInvariantContract = DATABASE_INVARIANT_CONTRACT,
): ReadonlyArray<{
  name: string;
  sql: string;
}> {
  return contract.triggerStatements.map((sql) => ({
    name: readTriggerName(sql),
    sql: normalizeTriggerDefinition(sql),
  })).sort((left, right) => left.name.localeCompare(right.name));
}

function readTriggerName(sql: string): string {
  const match =
    /^CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS\s+([A-Za-z0-9_]+)/iu.exec(
      sql.trim(),
    );
  if (!match?.[1]) throw new DatabaseInvariantError();
  return match[1];
}

function readViolationCount(row: Record<string, unknown> | null): number {
  const value = row?.violation_count;
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : Number.NaN;
}
