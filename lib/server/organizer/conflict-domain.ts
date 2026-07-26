import {
  localDateTimeToUtcMs,
  parseCalendarDate,
  parseIanaTimeZone,
} from "../../time";
import { validationIssue } from "../../validation";

export const CONFLICT_POLICY_MODES = [
  "warn_reason",
  "require_admin_approval",
  "block",
] as const;

export type ConflictPolicyMode = (typeof CONFLICT_POLICY_MODES)[number];

export const PHASE4_PLANNING_STATUSES = [
  "idea",
  "draft",
  "tentative_hold",
  "confirmed",
  "cancelled",
  "completed",
  "archived",
] as const;

export type Phase4PlanningStatus =
  (typeof PHASE4_PLANNING_STATUSES)[number];

export type NormalizedConflictInterval = Readonly<{
  actualEndUtc: number;
  actualStartUtc: number;
  expandedEndUtc: number;
  expandedStartUtc: number;
}>;

export type ConflictCandidate = Readonly<{
  bufferAfterMinutes: number;
  bufferBeforeMinutes: number;
  candidateKey: string;
  clubId: string;
  eventId: string;
  holdExpiresAt: number | null;
  interval: NormalizedConflictInterval;
  organizationId: string;
  organizerProfileIds: readonly string[];
  planningStatus: Phase4PlanningStatus;
  primaryOrganizerProfileId: string | null;
  scheduleVersion: number;
  source: "manual" | "legacy" | "meetup";
  title: string;
  venueId: string | null;
}>;

export type ConflictResource = Readonly<{
  resourceId: string;
  type: "organization" | "primary_organizer" | "co_organizer" | "venue";
}>;

export type ConflictFact = Readonly<{
  classification: "direct" | "buffer";
  existingCandidateKey: string;
  existingEventId: string;
  existingScheduleVersion: number;
  overlapEndUtc: number;
  overlapStartUtc: number;
  proposedEventId: string;
  proposedScheduleVersion: number;
  resources: readonly ConflictResource[];
}>;

export type ExternalReservationFingerprintInput = Readonly<{
  allDayEndDateExclusive: string | null;
  allDayStartDate: string | null;
  bufferAfterMinutes: number;
  bufferBeforeMinutes: number;
  clubId: string;
  eventId: string;
  generationId: string | null;
  holdExpiresAt: number | null;
  interval: NormalizedConflictInterval;
  organizerScope: readonly string[];
  organizationId: string;
  planningStatus: string;
  primaryOrganizerProfileId: string | null;
  scheduleShape: "all_day" | "timed";
  scheduleVersion: number;
  sourceFingerprint: string;
  sourceKind: "legacy" | "meetup";
  sourceRecordId: string;
  syncSourceId: string | null;
  timeZone: string;
  venueId: string | null;
}>;

const MINUTE_MS = 60_000;

/**
 * Canonical durable hash for an external reservation projection. The key
 * order is part of the D1 invariant contract: both runtime adoption and
 * source staging must use this helper so an activation cannot swap mutable
 * source facts underneath the normalized conflict interval.
 */
export async function externalReservationStateFingerprint(
  input: ExternalReservationFingerprintInput,
): Promise<string> {
  const encoded = new TextEncoder().encode(
    JSON.stringify({
      allDayEndDateExclusive: input.allDayEndDateExclusive,
      allDayStartDate: input.allDayStartDate,
      bufferAfterMinutes: input.bufferAfterMinutes,
      bufferBeforeMinutes: input.bufferBeforeMinutes,
      clubId: input.clubId,
      eventId: input.eventId,
      generationId: input.generationId,
      holdExpiresAt: input.holdExpiresAt,
      interval: input.interval,
      organizerScope: [...input.organizerScope],
      organizationId: input.organizationId,
      planningStatus: input.planningStatus,
      primaryOrganizerProfileId: input.primaryOrganizerProfileId,
      scheduleShape: input.scheduleShape,
      scheduleVersion: input.scheduleVersion,
      sourceFingerprint: input.sourceFingerprint,
      sourceKind: input.sourceKind,
      sourceRecordId: input.sourceRecordId,
      syncSourceId: input.syncSourceId,
      timeZone: input.timeZone,
      venueId: input.venueId,
    }),
  );
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generation-independent reservation semantics used when an immutable source
 * snapshot is promoted. Content-only changes (for example a Meetup title)
 * deliberately do not change this hash, while every schedule/resource fact
 * that can affect reservation safety does.
 */
export async function externalReservationSemanticFingerprint(
  input: ExternalReservationFingerprintInput,
): Promise<string> {
  const encoded = new TextEncoder().encode(
    JSON.stringify({
      allDayEndDateExclusive: input.allDayEndDateExclusive,
      allDayStartDate: input.allDayStartDate,
      bufferAfterMinutes: input.bufferAfterMinutes,
      bufferBeforeMinutes: input.bufferBeforeMinutes,
      clubId: input.clubId,
      eventId: input.eventId,
      holdExpiresAt: input.holdExpiresAt,
      interval: input.interval,
      organizerScope: [...input.organizerScope],
      organizationId: input.organizationId,
      planningStatus: input.planningStatus,
      primaryOrganizerProfileId: input.primaryOrganizerProfileId,
      scheduleShape: input.scheduleShape,
      scheduleVersion: input.scheduleVersion,
      sourceKind: input.sourceKind,
      syncSourceId: input.syncSourceId,
      timeZone: input.timeZone,
      venueId: input.venueId,
    }),
  );
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizeConflictInterval(input: Readonly<{
  bufferAfterMinutes?: number;
  bufferBeforeMinutes?: number;
  endUtc: number;
  startUtc: number;
}>): NormalizedConflictInterval {
  const startUtc = requireEpoch(input.startUtc, "startUtc");
  const endUtc = requireEpoch(input.endUtc, "endUtc");
  const bufferBeforeMinutes = requireBuffer(
    input.bufferBeforeMinutes ?? 0,
    "bufferBeforeMinutes",
  );
  const bufferAfterMinutes = requireBuffer(
    input.bufferAfterMinutes ?? 0,
    "bufferAfterMinutes",
  );
  if (endUtc <= startUtc) {
    throw validationIssue(
      "endUtc",
      endUtc === startUtc ? "zero_duration" : "end_before_start",
      "The conflict interval must end after it starts.",
    );
  }
  return Object.freeze({
    actualStartUtc: startUtc,
    actualEndUtc: endUtc,
    expandedStartUtc: startUtc - bufferBeforeMinutes * MINUTE_MS,
    expandedEndUtc: endUtc + bufferAfterMinutes * MINUTE_MS,
  });
}

/**
 * All-day values remain calendar dates in storage. This conversion is only
 * the normalized conflict interval: each boundary is local midnight in the
 * event's original IANA zone, so Vancouver DST days correctly span 23 or 25
 * hours instead of being treated as midnight UTC.
 */
export function normalizeAllDayConflictInterval(input: Readonly<{
  bufferAfterMinutes?: number;
  bufferBeforeMinutes?: number;
  endDateExclusive: unknown;
  startDate: unknown;
  timeZone: unknown;
}>): NormalizedConflictInterval {
  const timeZone = parseIanaTimeZone(input.timeZone);
  const startDate = parseCalendarDate(input.startDate, "startDate");
  const endDateExclusive = parseCalendarDate(
    input.endDateExclusive,
    "endDateExclusive",
  );
  if (endDateExclusive <= startDate) {
    throw validationIssue(
      "endDateExclusive",
      "invalid_date_range",
      "An all-day event must end after it starts.",
    );
  }
  return normalizeConflictInterval({
    startUtc: localDateTimeToUtcMs(`${startDate}T00:00`, timeZone, "earlier"),
    endUtc: localDateTimeToUtcMs(
      `${endDateExclusive}T00:00`,
      timeZone,
      "earlier",
    ),
    bufferBeforeMinutes: input.bufferBeforeMinutes,
    bufferAfterMinutes: input.bufferAfterMinutes,
  });
}

export function isReservingCandidate(
  candidate: Pick<
    ConflictCandidate,
    "holdExpiresAt" | "planningStatus"
  > & Partial<Pick<ConflictCandidate, "source">>,
  nowUtc: number,
): boolean {
  if (candidate.planningStatus === "confirmed") return true;
  // Meetup's source-native "tentative" state is not a website hold and has
  // no website-owned expiry. Keep the label at the source boundary while
  // treating the active completed snapshot as a coordination reservation.
  if (
    candidate.planningStatus === "tentative_hold" &&
    candidate.source === "meetup" &&
    candidate.holdExpiresAt === null
  ) {
    return true;
  }
  return (
    candidate.planningStatus === "tentative_hold" &&
    candidate.holdExpiresAt !== null &&
    candidate.holdExpiresAt > nowUtc
  );
}

export function findConflictFacts(
  proposed: ConflictCandidate,
  candidates: readonly ConflictCandidate[],
  nowUtc: number,
): readonly ConflictFact[] {
  const facts: ConflictFact[] = [];
  for (const existing of candidates) {
    if (
      existing.candidateKey === proposed.candidateKey ||
      existing.eventId === proposed.eventId ||
      existing.organizationId !== proposed.organizationId ||
      !isReservingCandidate(existing, nowUtc)
    ) {
      continue;
    }
    const direct = overlaps(
      proposed.interval.actualStartUtc,
      proposed.interval.actualEndUtc,
      existing.interval.actualStartUtc,
      existing.interval.actualEndUtc,
    );
    const buffered =
      direct ||
      overlaps(
        proposed.interval.expandedStartUtc,
        proposed.interval.expandedEndUtc,
        existing.interval.expandedStartUtc,
        existing.interval.expandedEndUtc,
      );
    if (!buffered) continue;

    const classification = direct ? "direct" : "buffer";
    const proposedStart = direct
      ? proposed.interval.actualStartUtc
      : proposed.interval.expandedStartUtc;
    const proposedEnd = direct
      ? proposed.interval.actualEndUtc
      : proposed.interval.expandedEndUtc;
    const existingStart = direct
      ? existing.interval.actualStartUtc
      : existing.interval.expandedStartUtc;
    const existingEnd = direct
      ? existing.interval.actualEndUtc
      : existing.interval.expandedEndUtc;
    facts.push(
      Object.freeze({
        classification,
        existingCandidateKey: existing.candidateKey,
        existingEventId: existing.eventId,
        existingScheduleVersion: existing.scheduleVersion,
        overlapStartUtc: Math.max(proposedStart, existingStart),
        overlapEndUtc: Math.min(proposedEnd, existingEnd),
        proposedEventId: proposed.eventId,
        proposedScheduleVersion: proposed.scheduleVersion,
        resources: conflictResources(proposed, existing),
      }),
    );
  }
  return Object.freeze(
    facts.sort(
      (left, right) =>
        left.overlapStartUtc - right.overlapStartUtc ||
        left.overlapEndUtc - right.overlapEndUtc ||
        left.existingCandidateKey.localeCompare(right.existingCandidateKey),
    ),
  );
}

export function isPhase4TransitionAllowed(
  from: Phase4PlanningStatus,
  to: Phase4PlanningStatus,
): boolean {
  if (from === to) return true;
  const allowed: Readonly<Record<Phase4PlanningStatus, readonly Phase4PlanningStatus[]>> =
    {
      idea: ["draft", "tentative_hold", "confirmed", "archived"],
      draft: ["idea", "tentative_hold", "confirmed", "archived"],
      tentative_hold: ["draft", "confirmed", "cancelled", "archived"],
      confirmed: ["cancelled", "completed", "archived"],
      cancelled: ["archived"],
      completed: ["archived"],
      archived: ["idea", "draft"],
    };
  return allowed[from].includes(to);
}

export function requiresScheduleForPlanningStatus(
  status: Phase4PlanningStatus,
): boolean {
  return status !== "idea" && status !== "archived";
}

function conflictResources(
  proposed: ConflictCandidate,
  existing: ConflictCandidate,
): readonly ConflictResource[] {
  const resources: ConflictResource[] = [
    {
      type: "organization",
      resourceId: proposed.organizationId,
    },
  ];
  if (
    proposed.venueId !== null &&
    proposed.venueId === existing.venueId
  ) {
    resources.push({ type: "venue", resourceId: proposed.venueId });
  }
  const shared = [...new Set(proposed.organizerProfileIds)]
    .filter((profileId) => existing.organizerProfileIds.includes(profileId))
    .sort();
  for (const profileId of shared) {
    resources.push({
      type:
        profileId === proposed.primaryOrganizerProfileId &&
        profileId === existing.primaryOrganizerProfileId
          ? "primary_organizer"
          : "co_organizer",
      resourceId: profileId,
    });
  }
  return Object.freeze(
    resources.sort(
      (left, right) =>
        resourceRank(left.type) - resourceRank(right.type) ||
        left.resourceId.localeCompare(right.resourceId),
    ),
  );
}

function resourceRank(type: ConflictResource["type"]): number {
  return {
    organization: 0,
    primary_organizer: 1,
    co_organizer: 2,
    venue: 3,
  }[type];
}

function overlaps(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  return leftStart < rightEnd && leftEnd > rightStart;
}

function requireEpoch(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw validationIssue(path, "invalid_datetime", "Expected a UTC timestamp.");
  }
  return value;
}

function requireBuffer(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 24 * 60) {
    throw validationIssue(
      path,
      "invalid_buffer",
      "Expected a buffer from 0 to 1440 minutes.",
    );
  }
  return value;
}
