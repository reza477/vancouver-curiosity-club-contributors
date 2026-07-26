import type { CanonicalEventSchedule } from "./lifecycle";
import { localDateTimeToUtcMs } from "../../time";

export function organizerScheduleIsCurrent(
  schedule: CanonicalEventSchedule,
  nowMs: number,
): boolean {
  if (schedule.shape === "unscheduled") return true;
  if (schedule.shape === "timed") return schedule.endsAtUtc >= nowMs;
  return (
    localDateTimeToUtcMs(
      `${schedule.allDayEndDateExclusive}T00:00`,
      schedule.timeZone,
      "reject",
    ) > nowMs
  );
}

export function organizerScheduleOverlapsUtcRange(
  schedule: CanonicalEventSchedule,
  fromUtc: number | null,
  toUtc: number | null,
): boolean {
  if (schedule.shape === "unscheduled") {
    return fromUtc === null && toUtc === null;
  }
  const startsAtUtc =
    schedule.shape === "timed"
      ? schedule.startsAtUtc
      : localDateTimeToUtcMs(
          `${schedule.allDayStartDate}T00:00`,
          schedule.timeZone,
          "reject",
        );
  const endsAtUtc =
    schedule.shape === "timed"
      ? schedule.endsAtUtc
      : localDateTimeToUtcMs(
          `${schedule.allDayEndDateExclusive}T00:00`,
          schedule.timeZone,
          "reject",
        );
  return (
    (fromUtc === null || endsAtUtc > fromUtc) &&
    (toUtc === null || startsAtUtc < toUtc)
  );
}
