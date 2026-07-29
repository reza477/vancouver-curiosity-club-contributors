import {
  type D1DatabaseLike,
  type D1ResultLike,
} from "../auth";
import {
  parseBoundedString,
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  validationIssue,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  canonicalCalendarComponent,
  ICS_SEQUENCE_MAX,
  type CalendarComponentFacts,
  type CalendarExportEvent,
} from "./export-format";

export const CALENDAR_COMPONENT_REVISION_LIMIT = 500;
const MAX_CALENDAR_TIMESTAMP = 8_640_000_000_000_000;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;

export type CalendarComponentScope = "private" | "public";

export type CalendarComponentRevisionCandidate = Readonly<{
  event: CalendarComponentFacts;
  eventKey: string;
}>;

export async function reconcileCalendarComponentRevisions(
  database: D1DatabaseLike,
  input: Readonly<{
    candidates: readonly CalendarComponentRevisionCandidate[];
    organizationId: unknown;
    scope: unknown;
  }>,
): Promise<readonly CalendarExportEvent[]> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "calendarRevision.organizationId",
  );
  const scope = parseEnum(
    input.scope,
    ["public", "private"] as const,
    "calendarRevision.scope",
  );
  if (
    !Array.isArray(input.candidates) ||
    input.candidates.length > CALENDAR_COMPONENT_REVISION_LIMIT
  ) {
    throw validationIssue(
      "calendarRevision.candidates",
      "invalid_length",
      "At most 500 calendar components can be reconciled at once.",
    );
  }
  if (input.candidates.length === 0) return Object.freeze([]);

  const seen = new Set<string>();
  const candidates = await Promise.all(
    input.candidates.map(async (candidate, index) => {
      const eventKey = parseBoundedString(candidate.eventKey, {
        path: `calendarRevision.candidates.${index}.eventKey`,
        maxLength: 255,
      });
      if (seen.has(eventKey)) {
        throw validationIssue(
          `calendarRevision.candidates.${index}.eventKey`,
          "duplicate_value",
          "A calendar component may be reconciled only once per request.",
        );
      }
      seen.add(eventKey);
      const fingerprint = await sha256Hex(
        canonicalCalendarComponent(candidate.event),
      );
      return Object.freeze({
        event: candidate.event,
        eventKey,
        fingerprint,
        ordinal: index,
      });
    }),
  );
  const payload = JSON.stringify(
    candidates.map(({ eventKey, fingerprint, ordinal }) => ({
      eventKey,
      fingerprint,
      ordinal,
    })),
  );

  try {
    const [writeResult] = await database.batch([
      database
        .prepare(CALENDAR_COMPONENT_REVISION_RECONCILE_SQL)
        .bind(
          payload,
          organizationId,
          scope,
        ),
    ]);
    assertSuccessful(writeResult);
  } catch {
    return unavailable();
  }

  const readResult = await database
    .prepare(CALENDAR_COMPONENT_REVISION_READ_SQL)
    .bind(payload, organizationId, scope)
    .all<Record<string, unknown>>();
  assertSuccessful(readResult);
  const rows = readResult.results ?? [];
  if (rows.length !== candidates.length) return unavailable();

  const revisions = new Map<string, Readonly<{
    fingerprint: string;
    lastModifiedAt: number;
    sequence: number;
  }>>();
  for (const [index, row] of rows.entries()) {
    const eventKey = parseBoundedString(row.event_key, {
      path: `calendarRevision.rows.${index}.eventKey`,
      maxLength: 255,
    });
    if (revisions.has(eventKey)) return unavailable();
    const fingerprint = parseBoundedString(row.canonical_fingerprint, {
      path: `calendarRevision.rows.${index}.fingerprint`,
      maxLength: 64,
    });
    if (!FINGERPRINT_PATTERN.test(fingerprint)) return unavailable();
    revisions.set(
      eventKey,
      Object.freeze({
        fingerprint,
        lastModifiedAt: calendarTimestamp(row.last_modified_at),
        sequence: parseFiniteInteger(row.sequence, {
          path: `calendarRevision.rows.${index}.sequence`,
          minimum: 0,
          maximum: ICS_SEQUENCE_MAX,
        }),
      }),
    );
  }

  return Object.freeze(
    candidates.map(({ event, eventKey, fingerprint }) => {
      const revision = revisions.get(eventKey);
      if (!revision || revision.fingerprint !== fingerprint) {
        return unavailable();
      }
      return Object.freeze({
        ...event,
        lastModifiedAt: revision.lastModifiedAt,
        sequence: revision.sequence,
      });
    }),
  );
}

export const CALENDAR_COMPONENT_REVISION_RECONCILE_SQL = String.raw`
WITH requested AS (
  SELECT CAST(json_extract(value, '$.ordinal') AS INTEGER) AS ordinal,
         json_extract(value, '$.eventKey') AS event_key,
         json_extract(value, '$.fingerprint') AS canonical_fingerprint
  FROM json_each(?)
  WHERE json_type(value, '$.ordinal') = 'integer'
    AND json_type(value, '$.eventKey') = 'text'
    AND json_type(value, '$.fingerprint') = 'text'
),
revision_clock AS (
  SELECT unixepoch() * 1000 AS revision_at
)
INSERT INTO event_calendar_component_revisions (
  organization_id,
  scope,
  event_key,
  canonical_fingerprint,
  sequence,
  last_modified_at,
  created_at,
  updated_at
)
SELECT ?,
       ?,
       requested.event_key,
       requested.canonical_fingerprint,
       0,
       revision_clock.revision_at,
       revision_clock.revision_at,
       revision_clock.revision_at
FROM requested
CROSS JOIN revision_clock
WHERE requested.ordinal >= 0
  AND requested.event_key <> ''
  AND length(requested.event_key) <= 255
  AND length(requested.canonical_fingerprint) = 64
  AND requested.canonical_fingerprint =
      lower(requested.canonical_fingerprint)
  AND requested.canonical_fingerprint NOT GLOB '*[^0-9a-f]*'
ON CONFLICT(organization_id, scope, event_key) DO UPDATE SET
  canonical_fingerprint = excluded.canonical_fingerprint,
  sequence = event_calendar_component_revisions.sequence + 1,
  last_modified_at = max(
    event_calendar_component_revisions.last_modified_at + 1000,
    excluded.last_modified_at
  ),
  updated_at = excluded.updated_at
WHERE event_calendar_component_revisions.canonical_fingerprint <>
      excluded.canonical_fingerprint`;

export const CALENDAR_COMPONENT_REVISION_READ_SQL = String.raw`
WITH requested AS (
  SELECT CAST(json_extract(value, '$.ordinal') AS INTEGER) AS ordinal,
         json_extract(value, '$.eventKey') AS event_key
  FROM json_each(?)
  WHERE json_type(value, '$.ordinal') = 'integer'
    AND json_type(value, '$.eventKey') = 'text'
)
SELECT revision.event_key,
       revision.canonical_fingerprint,
       revision.sequence,
       revision.last_modified_at
FROM requested
JOIN event_calendar_component_revisions AS revision
  ON revision.organization_id = ?
 AND revision.scope = ?
 AND revision.event_key = requested.event_key
ORDER BY requested.ordinal ASC`;

function calendarTimestamp(value: unknown): number {
  const timestamp = parseFiniteInteger(value, {
    path: "calendarRevision.timestamp",
    minimum: 0,
    maximum: MAX_CALENDAR_TIMESTAMP,
  });
  return Math.floor(timestamp / 1_000) * 1_000;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function assertSuccessful(result: D1ResultLike | undefined): void {
  if (!result || result.success === false) return unavailable();
}

function unavailable(): never {
  throw new SafeApplicationError(
    "service_unavailable",
    503,
    "The calendar revision could not be verified safely.",
  );
}
