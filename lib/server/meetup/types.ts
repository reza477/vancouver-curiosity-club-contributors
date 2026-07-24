import type { PublicEventDto } from "../public/events";
import type { MeetupSyncErrorCode } from "./errors";

export type MeetupSyncStatus =
  | "current"
  | "disabled"
  | "error"
  | "not_connected"
  | "partial"
  | "pending"
  | "refreshing"
  | "stale";

export type MeetupConnectionState = Readonly<{
  clubId: string | null;
  enabled: boolean;
  lastAttemptAt: string | null;
  lastErrorCode: MeetupSyncErrorCode | null;
  lastSuccessAt: string | null;
  nextRefreshAt: string | null;
  status: MeetupSyncStatus;
}>;

export type MeetupRefreshCounts = Readonly<{
  cancelled: number;
  created: number;
  rejected: number;
  removed: number;
  updated: number;
}>;

export type MeetupRefreshOutcome =
  | "busy"
  | "completed"
  | "disabled"
  | "failed"
  | "not_connected"
  | "not_due"
  | "not_modified"
  | "partial";

export type MeetupRefreshResult = Readonly<{
  counts: MeetupRefreshCounts;
  outcome: MeetupRefreshOutcome;
  state: MeetupConnectionState;
}>;

export type PublicMeetupSyncStatus =
  | "current"
  | "disabled"
  | "error"
  | "not_connected"
  | "partial"
  | "pending"
  | "stale";

export type PublicMeetupCalendarDto = Readonly<{
  events: readonly PublicEventDto[];
  sync: Readonly<{
    lastSuccessAt: string | null;
    status: PublicMeetupSyncStatus;
  }>;
}>;
