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

const SOURCE_TYPE = "meetup_ics";
const STALE_AFTER_MS = 30 * 60_000;

export type ListPublicMeetupCalendarInput = Readonly<{
  fromUtcMs: unknown;
  limit?: unknown;
  nowUtcMs?: unknown;
  organizationId: unknown;
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
