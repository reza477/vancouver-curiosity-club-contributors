export const MEETUP_SYNC_ERROR_CODES = [
  "calendar_invalid",
  "conflict_rejected",
  "internal_error",
  "lease_lost",
  "network_error",
  "redirect_rejected",
  "response_too_large",
  "upstream_rejected",
] as const;

export type MeetupSyncErrorCode =
  (typeof MEETUP_SYNC_ERROR_CODES)[number];

export class MeetupSyncError extends Error {
  readonly code: MeetupSyncErrorCode;

  constructor(code: MeetupSyncErrorCode) {
    super("The Meetup calendar could not be synchronized safely.");
    this.name = "MeetupSyncError";
    this.code = code;
  }
}
