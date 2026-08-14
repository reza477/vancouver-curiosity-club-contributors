import type { D1DatabaseLike } from "../auth";
import { refreshMeetupCalendarSourceIfDue } from "@/lib/server/meetup";
import type {
  MeetupRefreshCounts,
  MeetupRefreshOutcome,
} from "../meetup/types";
import { refreshPublicEventMaterializations } from "@/lib/server/public/event-materializations";
import { SafeApplicationError } from "../../validation/server-observability";

export const MAX_DAILY_MEETUP_REFRESH_PASSES = 1;

type MaterializationCounts = Readonly<{
  eventsSnapshotCount: number;
  homeEventCount: number;
}>;

export type DailyMeetupRefreshResult = Readonly<{
  completedAt: string;
  counts: MeetupRefreshCounts &
    Readonly<{
      materializations: MaterializationCounts | null;
      passes: 1;
    }>;
  outcome: MeetupRefreshOutcome;
  startedAt: string;
  status: "continue" | "succeeded";
}>;

/**
 * Performs exactly one bounded Meetup import slice. The workflow, rather than
 * one Worker request, follows partial generations so every invocation remains
 * below D1's per-request statement ceiling.
 */
export async function runDailyMeetupRefresh(
  database: D1DatabaseLike,
  options: Readonly<{
    maxPasses?: number;
    nowUtcMs: number;
    requestId: string;
  }>,
): Promise<DailyMeetupRefreshResult> {
  if (
    !Number.isSafeInteger(options.nowUtcMs) ||
    options.nowUtcMs < 0 ||
    (options.maxPasses !== undefined && options.maxPasses !== 1)
  ) {
    throw invalidConfiguration();
  }
  // The correlation ID is validated by the signature layer. Keeping it out of
  // persistence and business inputs prevents a caller-controlled actor path.
  void options.requestId;
  const startedAt = new Date(options.nowUtcMs).toISOString();
  const refresh = await refreshMeetupCalendarSourceIfDue(database, {
    nowUtcMs: options.nowUtcMs,
  });

  if (refresh.outcome === "failed" || refresh.outcome === "busy") {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The Meetup refresh could not be completed.",
    );
  }

  const requiresAnotherRequest =
    refresh.outcome === "partial" ||
    refresh.outcome === "completed" ||
    refresh.outcome === "not_modified";
  const terminalStateIsSafe =
    refresh.state.status === "current" ||
    refresh.state.status === "disabled" ||
    refresh.state.status === "not_connected";
  if (!requiresAnotherRequest && !terminalStateIsSafe) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The Meetup refresh did not reach a safe terminal state.",
    );
  }
  let materializations: MaterializationCounts | null = null;
  if (!requiresAnotherRequest) {
    const refreshed = await refreshPublicEventMaterializations(database, {
      nowUtcMs: options.nowUtcMs,
    });
    materializations = Object.freeze({
      eventsSnapshotCount: safeCount(
        refreshed.eventsSnapshotCount,
        "eventsSnapshotCount",
      ),
      homeEventCount: safeCount(
        refreshed.homeEventCount,
        "homeEventCount",
      ),
    });
  }

  return Object.freeze({
    completedAt: new Date().toISOString(),
    counts: Object.freeze({
      cancelled: safeCount(refresh.counts.cancelled, "cancelled"),
      created: safeCount(refresh.counts.created, "created"),
      materializations,
      passes: 1 as const,
      rejected: safeCount(refresh.counts.rejected, "rejected"),
      removed: safeCount(refresh.counts.removed, "removed"),
      updated: safeCount(refresh.counts.updated, "updated"),
    }),
    outcome: refresh.outcome,
    startedAt,
    status: requiresAnotherRequest
      ? ("continue" as const)
      : ("succeeded" as const),
  });
}

function safeCount(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new SafeApplicationError(
      "internal_error",
      500,
      `The ${field} maintenance count was invalid.`,
    );
  }
  return value;
}

function invalidConfiguration(): SafeApplicationError {
  return new SafeApplicationError(
    "validation_failed",
    400,
    "The maintenance request could not be validated.",
  );
}
