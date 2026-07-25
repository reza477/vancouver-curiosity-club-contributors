import type { D1DatabaseLike } from "../auth";
import { CONFLICT_GUARD_TRIGGER_STATEMENTS } from "../conflicts/guard-sql";

export const DATABASE_INVARIANT_MARKER_KEY = "database-guards";
export const DATABASE_INVARIANT_VERSION = 1;

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

const CLUB_PUBLIC_PROFILE_INTEGRITY_PROBE_SQL = String.raw`
UPDATE club_public_profiles
SET organization_id = organization_id
WHERE NOT EXISTS (
  SELECT 1
  FROM organizations AS organization
  INNER JOIN clubs AS club
    ON club.id = club_public_profiles.club_id
   AND club.organization_id = organization.id
  INNER JOIN event_lanes AS lane
    ON lane.id = club_public_profiles.primary_event_lane_id
   AND lane.organization_id = organization.id
  WHERE organization.id = club_public_profiles.organization_id
)`;

const EVENT_PUBLIC_DETAILS_INTEGRITY_PROBE_SQL = String.raw`
UPDATE event_public_details
SET organization_id = organization_id
WHERE NOT EXISTS (
  SELECT 1
  FROM organizations AS organization
  INNER JOIN events AS event
    ON event.id = event_public_details.event_id
   AND event.organization_id = organization.id
  WHERE organization.id = event_public_details.organization_id
)`;

export const DATABASE_INVARIANT_TRIGGER_STATEMENTS = Object.freeze([
  ...CONFLICT_GUARD_TRIGGER_STATEMENTS,
  ...PUBLIC_INTEGRITY_TRIGGER_STATEMENTS,
]);

export const DATABASE_INVARIANT_TRIGGER_NAMES = Object.freeze(
  DATABASE_INVARIANT_TRIGGER_STATEMENTS.map(readTriggerName).sort(),
);

const EXPECTED_TRIGGER_NAME_SQL = DATABASE_INVARIANT_TRIGGER_NAMES.map(
  () => "?",
).join(", ");

const initializationByDatabase = new WeakMap<
  D1DatabaseLike,
  Promise<void>
>();

export class DatabaseInvariantError extends Error {
  constructor() {
    super("Database integrity guards are unavailable.");
    this.name = "DatabaseInvariantError";
  }
}

/**
 * Installs and verifies every database-enforced guard before application code
 * can access D1. The in-isolate promise is only an optimization: the durable
 * marker and sqlite_master definitions are authoritative on each new isolate.
 */
export function ensureDatabaseInvariants(
  database: D1DatabaseLike,
): Promise<void> {
  const existing = initializationByDatabase.get(database);
  if (existing) return existing;

  const initialization = initializeDatabaseInvariants(database).catch(
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
): Promise<void> {
  const fingerprint = await getExpectedDatabaseInvariantFingerprint();
  if (await databaseInvariantsAreReady(database, fingerprint)) return;

  const triggerNames = [...DATABASE_INVARIANT_TRIGGER_NAMES];
  const installationStatements = [
    database
      .prepare(
        `DELETE FROM database_invariant_state
         WHERE singleton_key = ?`,
      )
      .bind(DATABASE_INVARIANT_MARKER_KEY),
    ...triggerNames.map((name) =>
      database.prepare(`DROP TRIGGER IF EXISTS "${name}"`),
    ),
    ...DATABASE_INVARIANT_TRIGGER_STATEMENTS.map((sql) =>
      database.prepare(sql),
    ),
    database.prepare(CLUB_PUBLIC_PROFILE_INTEGRITY_PROBE_SQL),
    database.prepare(EVENT_PUBLIC_DETAILS_INTEGRITY_PROBE_SQL),
    database
      .prepare(
        `INSERT INTO database_invariant_state (
           singleton_key, version, trigger_fingerprint, verified_at
         )
         SELECT ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1
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
           )
         )
           AND NOT EXISTS (
             SELECT 1
             FROM event_public_details AS detail
             WHERE NOT EXISTS (
               SELECT 1
               FROM organizations AS organization
               INNER JOIN events AS event
                 ON event.id = detail.event_id
                AND event.organization_id = organization.id
               WHERE organization.id = detail.organization_id
             )
           )
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

  const results = await database.batch(installationStatements);
  if (
    results.length !== installationStatements.length ||
    results.some((result) => result.success === false)
  ) {
    throw new DatabaseInvariantError();
  }
  const markerResult = results.at(-1);
  if (markerResult?.meta?.changes !== 1) {
    throw new DatabaseInvariantError();
  }
  if (!(await databaseInvariantsAreReady(database, fingerprint))) {
    throw new DatabaseInvariantError();
  }
}

async function databaseInvariantsAreReady(
  database: D1DatabaseLike,
  fingerprint: string,
): Promise<boolean> {
  const marker = await database
    .prepare(
      `SELECT version, trigger_fingerprint
       FROM database_invariant_state
       WHERE singleton_key = ?
       LIMIT 1`,
    )
    .bind(DATABASE_INVARIANT_MARKER_KEY)
    .first<Record<string, unknown>>();
  if (
    marker?.version !== DATABASE_INVARIANT_VERSION ||
    marker.trigger_fingerprint !== fingerprint
  ) {
    return false;
  }

  const triggerResult = await database
    .prepare(
      `SELECT name, sql
       FROM sqlite_master
       WHERE type = 'trigger'
       ORDER BY name`,
    )
    .all<Record<string, unknown>>();
  const actualDefinitions = (triggerResult.results ?? []).map((row) => ({
    name: typeof row.name === "string" ? row.name : "",
    sql: typeof row.sql === "string" ? normalizeTriggerDefinition(row.sql) : "",
  }));
  const expectedDefinitions = expectedNormalizedTriggerDefinitions();
  if (
    actualDefinitions.length !== expectedDefinitions.length ||
    actualDefinitions.some(
      (actual, index) =>
        actual.name !== expectedDefinitions[index]?.name ||
        actual.sql !== expectedDefinitions[index]?.sql,
    )
  ) {
    return false;
  }

  const [clubProbe, eventProbe] = await Promise.all([
    database
      .prepare(CLUB_PUBLIC_PROFILE_INTEGRITY_COUNT_SQL)
      .first<Record<string, unknown>>(),
    database
      .prepare(EVENT_PUBLIC_DETAILS_INTEGRITY_COUNT_SQL)
      .first<Record<string, unknown>>(),
  ]);
  return readViolationCount(clubProbe) === 0 && readViolationCount(eventProbe) === 0;
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
