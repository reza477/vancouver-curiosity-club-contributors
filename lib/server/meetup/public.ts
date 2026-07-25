import {
  listUpcomingPublicMeetupEvents,
} from "../public/events";
import type {
  D1DatabaseLike,
} from "../auth";
import {
  parseFiniteInteger,
  parseIdentifier,
} from "../../validation";
import type {
  PublicMeetupCalendarDto,
  PublicMeetupSyncStatus,
} from "./types";
import { refreshMeetupCalendarSourceIfDue } from "./sync";
import { MeetupSyncError } from "./errors";

const SOURCE_TYPE = "meetup_ics";
const STALE_AFTER_MS = 30 * 60_000;

export type ListPublicMeetupCalendarInput = Readonly<{
  fromUtcMs: unknown;
  limit?: unknown;
  nowUtcMs?: unknown;
  organizationId: unknown;
  todayDate: unknown;
}>;

export type ListDefaultPublicMeetupCalendarInput = Readonly<{
  fetcher?: typeof fetch;
  fromUtcMs: unknown;
  limit?: unknown;
  nowUtcMs?: unknown;
  todayDate: unknown;
}>;

export async function listPublicMeetupCalendar(
  database: Pick<D1DatabaseLike, "prepare">,
  input: ListPublicMeetupCalendarInput,
): Promise<PublicMeetupCalendarDto> {
  const organizationId = parseIdentifier(
    input.organizationId,
    "organizationId",
  );
  const now = parseFiniteInteger(input.nowUtcMs ?? Date.now(), {
    path: "nowUtcMs",
    minimum: 0,
  });
  const sync = await readPublicMeetupSyncState(database, organizationId, now);
  if (sync.status === "not_connected") {
    return Object.freeze({
      sync,
      events: Object.freeze([]),
    });
  }
  const events = await listUpcomingPublicMeetupEvents(database, {
    organizationId,
    fromUtcMs: input.fromUtcMs,
    todayDate: input.todayDate,
    limit: input.limit,
  });
  return Object.freeze({ sync, events });
}

/**
 * Public route helper. It resolves the configured organization server-side,
 * attempts the due-gated refresh, and never accepts a client organization ID.
 */
export async function listDefaultPublicMeetupCalendar(
  database: D1DatabaseLike,
  input: ListDefaultPublicMeetupCalendarInput,
): Promise<PublicMeetupCalendarDto> {
  const now = parseFiniteInteger(input.nowUtcMs ?? Date.now(), {
    path: "nowUtcMs",
    minimum: 0,
  });
  const organizationId = await readSingleConfiguredOrganization(database);
  if (!organizationId) {
    return Object.freeze({
      sync: Object.freeze({
        status: "not_connected" as const,
        lastSuccessAt: null,
      }),
      events: Object.freeze([]),
    });
  }
  await refreshMeetupCalendarSourceIfDue(database, {
    organizationId,
    fetcher: input.fetcher,
    nowUtcMs: now,
  });
  return listPublicMeetupCalendar(database, {
    organizationId,
    fromUtcMs: input.fromUtcMs,
    todayDate: input.todayDate,
    limit: input.limit,
    nowUtcMs: now,
  });
}

async function readSingleConfiguredOrganization(
  database: Pick<D1DatabaseLike, "prepare">,
): Promise<string | null> {
  const result = await database
    .prepare(
      `SELECT DISTINCT organization_id
       FROM sync_sources
       WHERE source_type = ?
         AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC
       LIMIT 2`,
    )
    .bind(SOURCE_TYPE)
    .all<Record<string, unknown>>();
  const rows = result.results ?? [];
  if (rows.length > 1) throw new MeetupSyncError("internal_error");
  const value = rows[0]?.organization_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function readPublicMeetupSyncState(
  database: Pick<D1DatabaseLike, "prepare">,
  organizationIdInput: unknown,
  nowUtcMs: unknown = Date.now(),
): Promise<PublicMeetupCalendarDto["sync"]> {
  const organizationId = parseIdentifier(
    organizationIdInput,
    "organizationId",
  );
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const result = await database
    .prepare(
      `SELECT enabled, last_success_at, last_error_at,
              pending_snapshot_hash
       FROM sync_sources
       WHERE organization_id = ?
         AND source_type = ?
         AND deleted_at IS NULL`,
    )
    .bind(organizationId, SOURCE_TYPE)
    .all<Record<string, unknown>>();
  const rows = result.results ?? [];
  if (rows.length === 0) {
    return Object.freeze({
      status: "not_connected" as const,
      lastSuccessAt: null,
    });
  }
  const enabledRows = rows.filter(
    (row) => row.enabled === 1 || row.enabled === true,
  );
  const statuses = enabledRows.map((row): PublicMeetupSyncStatus => {
    const lastSuccessAt = optionalInteger(row.last_success_at);
    const lastErrorAt = optionalInteger(row.last_error_at);
    if (
      lastErrorAt !== null &&
      (lastSuccessAt === null || lastErrorAt >= lastSuccessAt)
    ) {
      return "error";
    }
    if (typeof row.pending_snapshot_hash === "string") return "partial";
    if (lastSuccessAt === null) return "pending";
    return now - lastSuccessAt > STALE_AFTER_MS ? "stale" : "current";
  });
  const priority: readonly PublicMeetupSyncStatus[] = [
    "error",
    "partial",
    "pending",
    "stale",
    "current",
  ];
  const status =
    enabledRows.length === 0
      ? "disabled"
      : (priority.find((candidate) => statuses.includes(candidate)) ??
        "current");
  const successfulTimes = enabledRows
    .map((row) => optionalInteger(row.last_success_at))
    .filter((value): value is number => value !== null);
  const lastSuccessAt =
    enabledRows.length > 0 &&
    successfulTimes.length === enabledRows.length
      ? Math.min(...successfulTimes)
      : null;
  return Object.freeze({
    status,
    lastSuccessAt:
      lastSuccessAt === null
        ? null
        : new Date(lastSuccessAt).toISOString(),
  });
}

function optionalInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) ? (value as number) : null;
}
