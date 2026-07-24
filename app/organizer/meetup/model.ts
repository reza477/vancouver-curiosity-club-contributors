import type { MeetupConnectionState } from "@/lib/server/meetup";

export type MeetupUiState = Readonly<{
  enabled: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextRefreshAt: string | null;
  status:
    | "current"
    | "disabled"
    | "error"
    | "not_connected"
    | "partial"
    | "pending"
    | "refreshing"
    | "stale";
}>;

/**
 * Explicitly strips organization identifiers, source URLs, query strings, and
 * internal error codes before state crosses into a page or API response.
 */
export function toMeetupUiState(
  state: MeetupConnectionState,
): MeetupUiState {
  return Object.freeze({
    enabled: state.enabled,
    lastAttemptAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt,
    nextRefreshAt: state.nextRefreshAt,
    status: state.status,
  });
}
