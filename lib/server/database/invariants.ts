import type { D1DatabaseLike } from "../auth";
import { CONFLICT_GUARD_TRIGGER_STATEMENTS } from "../conflicts/guard-sql";
import {
  PHASE3_INVARIANT_COUNT_SQL,
  PHASE3_INVARIANT_TRIGGER_STATEMENTS,
} from "../organizer/invariant-sql";

export const DATABASE_INVARIANT_MARKER_KEY = "database-guards";
export const DATABASE_INVARIANT_VERSION = 3;
export const DATABASE_INVARIANT_STATEMENT_LIMIT = 50;

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

export const DATABASE_INVARIANT_TRIGGER_STATEMENTS = Object.freeze([
  ...CONFLICT_GUARD_TRIGGER_STATEMENTS,
  ...PUBLIC_INTEGRITY_TRIGGER_STATEMENTS,
  ...PHASE3_INVARIANT_TRIGGER_STATEMENTS,
]);

export const DATABASE_INVARIANT_TRIGGER_NAMES = Object.freeze(
  DATABASE_INVARIANT_TRIGGER_STATEMENTS.map(readTriggerName).sort(),
);

const EXPECTED_TRIGGER_NAME_SQL = DATABASE_INVARIANT_TRIGGER_NAMES.map(
  () => "?",
).join(", ");

const INTEGRITY_COUNT_SQL = Object.freeze([
  CLUB_PUBLIC_PROFILE_INTEGRITY_COUNT_SQL,
  EVENT_PUBLIC_DETAILS_INTEGRITY_COUNT_SQL,
  ...PHASE3_INVARIANT_COUNT_SQL,
]);

const COMBINED_INTEGRITY_COUNT_SQL = String.raw`
SELECT ${
  INTEGRITY_COUNT_SQL.map((query) => `(${query.trim()})`).join("\n     + ")
} AS violation_count`;

/**
 * `database_invariant_state` rejects version zero and an empty fingerprint.
 * If any violation appears after the preflight read but before this statement,
 * the one conditional insert aborts the complete D1 batch and rolls back every
 * trigger change.
 */
const ABORTING_INTEGRITY_PROBE_SQL = String.raw`
INSERT INTO database_invariant_state (
  singleton_key, version, trigger_fingerprint, verified_at
)
SELECT 'integrity-probe', 0, '', 0
WHERE (${COMBINED_INTEGRITY_COUNT_SQL}) > 0`;

// Three preflight reads, one aborting probe, one marker write, three read-back
// checks, and (only after a failed read-back) one marker invalidation must all
// fit in one Worker invocation.
const MAX_ATOMIC_REPAIR_MUTATIONS =
  DATABASE_INVARIANT_STATEMENT_LIMIT - 3 - 2 - 3 - 1;
const MAX_FAIL_CLOSED_DROP_COUNT =
  DATABASE_INVARIANT_STATEMENT_LIMIT - 3 - 1;

const initializationByDatabase = new WeakMap<
  D1DatabaseLike,
  Promise<DatabaseInvariantInitializationStatus>
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
 * every request revalidates the durable marker, sqlite_master definitions,
 * and integrity counts so a repair initiated by another isolate fails closed.
 */
export function ensureDatabaseInvariants(
  database: D1DatabaseLike,
): Promise<DatabaseInvariantInitializationStatus> {
  const existing = initializationByDatabase.get(database);
  if (existing) return existing;

  const initialization = initializeDatabaseInvariants(database).then(
    (status) => {
      // This map deduplicates only concurrent work. Never cache a resolved
      // result across requests: another Worker isolate may have invalidated
      // the durable marker while repairing a corrupted trigger set.
      initializationByDatabase.delete(database);
      return status;
    },
    (error: unknown) => {
      initializationByDatabase.delete(database);
      throw error instanceof DatabaseInvariantError
        ? error
        : new DatabaseInvariantError();
    },
  );
  initializationByDatabase.set(database, initialization);
  return initialization;
}

export async function getExpectedDatabaseInvariantFingerprint(): Promise<string> {
  const definitions = expectedNormalizedTriggerDefinitions();
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
): Promise<DatabaseInvariantInitializationStatus> {
  const fingerprint = await getExpectedDatabaseInvariantFingerprint();
  const inspection = await inspectDatabaseInvariants(database, fingerprint);
  if (inspection.ready) return "ready";

  if (inspection.violationCount !== 0) {
    await invalidateReadinessMarker(database);
    throw new DatabaseInvariantError();
  }

  const expectedDefinitions = expectedNormalizedTriggerDefinitions();
  const expectedByName = new Map(
    expectedDefinitions.map((definition) => [definition.name, definition.sql]),
  );
  const actualByName = new Map(
    inspection.actualDefinitions.map((definition) => [
      definition.name,
      definition.sql,
    ]),
  );
  const dropNames = inspection.actualDefinitions
    .filter(
      (definition) =>
        expectedByName.get(definition.name) !== definition.sql,
    )
    .map((definition) => definition.name);
  const createStatements = DATABASE_INVARIANT_TRIGGER_STATEMENTS.filter(
    (sql) => {
      const name = readTriggerName(sql);
      return actualByName.get(name) !== normalizeTriggerDefinition(sql);
    },
  );

  /**
   * Replacing every one of the 30 exact trigger definitions would require 60
   * mutations, which cannot fit D1's 50-statement invocation cap. That
   * pathological corruption enters a bounded fail-closed repair state:
   *
   * 1. atomically invalidate readiness and remove at most 46 bad definitions;
   * 2. reject this request, so no application code can observe the gap;
   * 3. the next request atomically installs the complete missing set, probes
   *    it, writes the marker, and read-verifies it before dispatch.
   *
   * Normal cold, missing-trigger, and ordinary mismatch repairs stay in one
   * atomic request. Every intermediate state has no readiness marker.
   */
  if (
    dropNames.length + createStatements.length >
    MAX_ATOMIC_REPAIR_MUTATIONS
  ) {
    const cleanupStatements = [
      database
        .prepare(
          `DELETE FROM database_invariant_state
           WHERE singleton_key = ?`,
        )
        .bind(DATABASE_INVARIANT_MARKER_KEY),
      ...dropNames
        .slice(0, MAX_FAIL_CLOSED_DROP_COUNT)
        .map((name) =>
          database.prepare(
            `DROP TRIGGER IF EXISTS ${quoteSqliteIdentifier(name)}`,
          ),
        ),
    ];
    await runInvariantBatch(database, cleanupStatements);
    throw new DatabaseInvariantError();
  }

  const triggerNames = [...DATABASE_INVARIANT_TRIGGER_NAMES];
  const installationStatements = [
    ...dropNames.map((name) =>
      database.prepare(
        `DROP TRIGGER IF EXISTS ${quoteSqliteIdentifier(name)}`,
      ),
    ),
    ...createStatements.map((sql) => database.prepare(sql)),
    database.prepare(ABORTING_INTEGRITY_PROBE_SQL),
    database
      .prepare(
        `INSERT INTO database_invariant_state (
           singleton_key, version, trigger_fingerprint, verified_at
         )
         SELECT ?, ?, ?, ?
         WHERE (${COMBINED_INTEGRITY_COUNT_SQL}) = 0
           AND (
             SELECT count(*)
             FROM sqlite_master
             WHERE type = 'trigger'
           ) = ?
           AND (
             SELECT count(*)
             FROM sqlite_master
             WHERE type = 'trigger'
               AND name IN (${EXPECTED_TRIGGER_NAME_SQL})
           ) = ?
         ON CONFLICT(singleton_key) DO UPDATE SET
           version = excluded.version,
           trigger_fingerprint = excluded.trigger_fingerprint,
           verified_at = excluded.verified_at`,
      )
      .bind(
        DATABASE_INVARIANT_MARKER_KEY,
        DATABASE_INVARIANT_VERSION,
        fingerprint,
        Date.now(),
        triggerNames.length,
        ...triggerNames,
        triggerNames.length,
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
  if (!(await inspectDatabaseInvariants(database, fingerprint)).ready) {
    await invalidateReadinessMarker(database);
    throw new DatabaseInvariantError();
  }
  return "repaired";
}

async function inspectDatabaseInvariants(
  database: D1DatabaseLike,
  fingerprint: string,
): Promise<{
  actualDefinitions: ReadonlyArray<{ name: string; sql: string }>;
  ready: boolean;
  violationCount: number;
}> {
  const [marker, triggerResult, integrityResult] = await Promise.all([
    database
      .prepare(
        `SELECT version, trigger_fingerprint
         FROM database_invariant_state
         WHERE singleton_key = ?
         LIMIT 1`,
      )
      .bind(DATABASE_INVARIANT_MARKER_KEY)
      .first<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT name, sql
         FROM sqlite_master
         WHERE type = 'trigger'
         ORDER BY name`,
      )
      .all<Record<string, unknown>>(),
    database
      .prepare(COMBINED_INTEGRITY_COUNT_SQL)
      .first<Record<string, unknown>>(),
  ]);
  const actualDefinitions = (triggerResult.results ?? []).map((row) => ({
    name: typeof row.name === "string" ? row.name : "",
    sql: typeof row.sql === "string" ? normalizeTriggerDefinition(row.sql) : "",
  }));
  const expectedDefinitions = expectedNormalizedTriggerDefinitions();
  const definitionsMismatch =
    actualDefinitions.length !== expectedDefinitions.length ||
    actualDefinitions.some(
      (actual, index) =>
        actual.name !== expectedDefinitions[index]?.name ||
        actual.sql !== expectedDefinitions[index]?.sql,
    );
  const violationCount = readViolationCount(integrityResult);
  return {
    actualDefinitions,
    ready:
      marker?.version === DATABASE_INVARIANT_VERSION &&
      marker.trigger_fingerprint === fingerprint &&
      !definitionsMismatch &&
      violationCount === 0,
    violationCount,
  };
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

function expectedNormalizedTriggerDefinitions(): ReadonlyArray<{
  name: string;
  sql: string;
}> {
  return DATABASE_INVARIANT_TRIGGER_STATEMENTS.map((sql) => ({
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
