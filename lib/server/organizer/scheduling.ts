import {
  authorizeMembership,
  type AuthorizedMembership,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  assertOnlyKeys,
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  parseObject,
  parseOptionalBoundedString,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import { parseIanaTimeZone } from "../../time";
import type { EventPublicationStatus } from "./lifecycle";
import {
  normalizeAllDayConflictInterval,
  normalizeConflictInterval,
  PHASE4_PLANNING_STATUSES,
  type ConflictCandidate,
  type ConflictFact,
  type NormalizedConflictInterval,
  type Phase4PlanningStatus,
} from "./conflict-domain";
import {
  currentD1Time,
  loadAuthoritativeConflictFacts,
} from "./conflicts";
import { getOrganizerConflictPolicy } from "./conflict-policy";
import { prepareNotificationInsert } from "./notifications";
import {
  prepareCanonicalEventPublicationMutationGuard,
  type CanonicalPublicationMutationOperation,
} from "./publication-bridge";

export const ORGANIZER_LIFECYCLE_ACTIONS = [
  "archive",
  "cancel",
  "complete",
  "confirm",
  "extend_hold",
  "place_hold",
  "release_hold",
  "restore_cancelled",
] as const;

export type OrganizerLifecycleAction =
  (typeof ORGANIZER_LIFECYCLE_ACTIONS)[number];

export type OrganizerSchedulingResult = Readonly<{
  event: OrganizerScheduledEventDto;
  outcome: "applied" | "pending_approval";
  reviewRequestId: string | null;
}>;

export type OrganizerScheduledEventDto = Readonly<{
  contentVersion: number;
  holdExpiresAt: number | null;
  holdState: "active" | "expired" | "nearing_expiry" | null;
  id: string;
  planningStatus: Phase4PlanningStatus;
  publicationStatus: EventPublicationStatus;
  scheduleVersion: number;
  title: string;
}>;

export type NonReservingScheduleGuard = Readonly<{
  completionStatement: D1PreparedStatementLike;
  incidentStatement: D1PreparedStatementLike;
  invalidationStatements: readonly D1PreparedStatementLike[];
  intentId: string;
  intentStatement: D1PreparedStatementLike;
}>;

export type NonReservingScheduleGuardInput = Readonly<{
  allDayEndDateExclusive: string | null;
  allDayStartDate: string | null;
  bufferAfterMinutes: number;
  bufferBeforeMinutes: number;
  clubId: string;
  eventId: string;
  expectedContentVersion: number;
  expectedScheduleVersion: number;
  operation: "create" | "duplicate" | "restore" | "soft_delete" | "update";
  organizerScope: readonly string[];
  primaryOrganizerProfileId: string;
  planningStatus: Phase4PlanningStatus;
  proposedContentVersion: number;
  proposedScheduleVersion: number;
  scheduleShape: "all_day" | "timed" | "unscheduled";
  startsAtUtc: number | null;
  endsAtUtc: number | null;
  timeZone: string;
  venueId: string | null;
}>;

export type OrganizerScheduleEditGuard =
  | Readonly<{
      completionStatement: D1PreparedStatementLike;
      finalizationStatement: D1PreparedStatementLike;
      incidentStatement: D1PreparedStatementLike;
      invalidationStatements: readonly D1PreparedStatementLike[];
      intentId: string;
      intentStatement: D1PreparedStatementLike;
      outcome: "apply";
      overrideStatement: D1PreparedStatementLike;
    }>
  | Readonly<{
      outcome: "pending_approval";
      reviewRequestId: string;
    }>;

export type OrganizerScheduleEditGuardInput = Readonly<{
  allDayEndDateExclusive: string | null;
  allDayStartDate: string | null;
  bufferAfterMinutes: number;
  bufferBeforeMinutes: number;
  clubId: string;
  endsAtUtc: number | null;
  eventId: string;
  expectedContentVersion: number;
  expectedScheduleVersion: number;
  holdExpiresAt: number | null;
  organizerScope: readonly string[];
  planningStatus: Phase4PlanningStatus;
  primaryOrganizerProfileId: string;
  proposedContentVersion: number;
  proposedScheduleVersion: number;
  reason: string | null;
  scheduleShape: "all_day" | "timed" | "unscheduled";
  startsAtUtc: number | null;
  timeZone: string;
  title: string;
  venueId: string | null;
}>;

export const ORGANIZER_PUBLICATION_SCHEDULE_OPERATIONS = [
  "cancel_scheduled_publication",
  "publish",
  "reconcile_publication",
  "invalidate_scheduled_publication",
  "schedule_publication",
  "unpublish",
  "update_public_details",
  "update_published",
  "update_scheduled",
  "update_unpublished",
] as const;

export type OrganizerPublicationScheduleOperation =
  (typeof ORGANIZER_PUBLICATION_SCHEDULE_OPERATIONS)[number];

export type OrganizerPublicationSchedulingEvent = Readonly<{
  actor: AuthorizedMembership;
  clubId: string;
  contentVersion: number;
  eventId: string;
  organizationId: string;
  planningStatus: Phase4PlanningStatus;
  primaryOrganizerProfileId: string;
  publicationStatus: EventPublicationStatus;
  scheduleVersion: number;
  slug: string;
  title: string;
}>;

export type OrganizerPublicationScheduleGuard = Readonly<{
  authorizationExpectedChanges: number;
  authorizationStatements: readonly D1PreparedStatementLike[];
  completionStatement: D1PreparedStatementLike;
  event: OrganizerPublicationSchedulingEvent;
  finalizationStatement: D1PreparedStatementLike | null;
  intentId: string;
  intentStatement: D1PreparedStatementLike;
  policyMode: "block" | "require_admin_approval" | "warn_reason";
  stateFingerprint: string;
}>;

type SchedulingEvent = Readonly<{
  allDayEndDateExclusive: string | null;
  allDayStartDate: string | null;
  bufferAfterMinutes: number;
  bufferBeforeMinutes: number;
  clubId: string;
  coOrganizerProfileIds: readonly string[];
  contentVersion: number;
  createdAt: number;
  createdByProfileId: string;
  deletedAt: number | null;
  endsAtUtc: number | null;
  holdExpiresAt: number | null;
  id: string;
  organizationId: string;
  planningStatus: Phase4PlanningStatus;
  primaryOrganizerProfileId: string;
  publicationStatus: EventPublicationStatus;
  scheduleShape: "all_day" | "timed" | "unscheduled";
  scheduleVersion: number;
  slug: string;
  startsAtUtc: number | null;
  timeZone: string;
  title: string;
  venueId: string | null;
}>;

type ActionInput = Readonly<{
  action: OrganizerLifecycleAction;
  expectedContentVersion: number;
  expectedScheduleVersion: number;
  holdDurationHours: number | null;
  reason: string | null;
}>;

type ProposedWrite = Readonly<{
  action: OrganizerLifecycleAction;
  event: SchedulingEvent;
  holdExpiresAt: number | null;
  interval: NormalizedConflictInterval | null;
  nextPlanningStatus: Phase4PlanningStatus;
  nextPublicationStatus: EventPublicationStatus;
  nextContentVersion: number;
  nextScheduleVersion: number;
  organizerScope: readonly string[];
  reason: string | null;
}>;

const PHASE4_EVENT_SELECT = `
SELECT event.id,
       event.organization_id,
       event.club_id,
       event.venue_id,
       event.primary_organizer_profile_id,
       event.title,
       event.slug,
       event.planning_status,
       event.publication_status,
       event.schedule_shape,
       event.starts_at_utc,
       event.ends_at_utc,
       event.timezone,
       event.all_day_start_date,
       event.all_day_end_date_exclusive,
       event.buffer_before_minutes,
       event.buffer_after_minutes,
       event.content_version,
       event.schedule_version,
       event.created_by_profile_id,
       event.created_at,
       event.deleted_at,
       reservation.hold_expires_at,
       COALESCE((
         SELECT json_group_array(ordered.profile_id)
         FROM (
           SELECT association.profile_id
           FROM organizer_event_organizers AS association
           WHERE association.organization_id = event.organization_id
             AND association.organizer_event_id = event.id
             AND association.deleted_at IS NULL
           ORDER BY association.profile_id
         ) AS ordered
       ), '[]') AS co_organizer_profile_ids_json
FROM organizer_events AS event
LEFT JOIN organizer_reservation_states AS reservation
  ON reservation.organizer_event_id = event.id
 AND reservation.organization_id = event.organization_id`;

export async function performOrganizerLifecycleAction(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  eventIdValue: unknown,
  value: unknown,
): Promise<OrganizerSchedulingResult> {
  const eventId = parseIdentifier(eventIdValue, "eventId");
  const input = parseActionInput(value);
  const actor = await authorizeMembership(database, identity);
  const event = await requireSchedulingEvent(
    database,
    actor,
    eventId,
    true,
  );
  await authorizeSchedulingEdit(database, identity, actor, event);
  if (
    event.contentVersion !== input.expectedContentVersion ||
    event.scheduleVersion !== input.expectedScheduleVersion
  ) {
    throw staleSchedule();
  }

  const d1Now = await currentD1Time(database);
  const policy = await getOrganizerConflictPolicy(database, identity);
  const proposed = proposeLifecycleWrite(event, input, policy.defaultHoldHours, d1Now);
  const conflicts =
    proposed.interval &&
    (proposed.nextPlanningStatus === "tentative_hold" ||
      proposed.nextPlanningStatus === "confirmed")
      ? await loadAuthoritativeConflictFacts(
          database,
          actor.organizationId,
          candidateFromProposed(proposed),
          d1Now,
        )
      : [];
  const reason =
    conflicts.length > 0 && policy.mode === "warn_reason"
      ? requireConflictReason(input.reason)
      : null;

  if (conflicts.length > 0 && policy.mode === "block") {
    throw conflictRefused(
      "This time is already reserved. The current workspace policy blocks overlapping reservations.",
    );
  }
  const fingerprint = await schedulingFingerprint({
    allDayEndDateExclusive: event.allDayEndDateExclusive,
    allDayStartDate: event.allDayStartDate,
    bufferAfterMinutes: event.bufferAfterMinutes,
    bufferBeforeMinutes: event.bufferBeforeMinutes,
    clubId: event.clubId,
    eventId: event.id,
    holdExpiresAt: proposed.holdExpiresAt,
    interval: proposed.interval,
    organizerScope: proposed.organizerScope,
    planningStatus: proposed.nextPlanningStatus,
    policyId: policy.id,
    policyVersion: policy.version,
    scheduleShape: event.scheduleShape,
    scheduleVersion: proposed.nextScheduleVersion,
    startsAtUtc: event.startsAtUtc,
    endsAtUtc: event.endsAtUtc,
    timeZone: event.timeZone,
    venueId: event.venueId,
  });

  if (
    conflicts.length > 0 &&
    policy.mode === "require_admin_approval"
  ) {
    if (
      event.planningStatus !== "idea" &&
      event.planningStatus !== "draft" &&
      event.planningStatus !== "cancelled"
    ) {
      throw conflictRefused(
        "Release the current reservation before requesting approval for a new overlapping reservation.",
      );
    }
    const reviewRequestId = await createPendingReview(
      database,
      actor,
      event,
      proposed,
      conflicts,
      policy,
      fingerprint,
      requireConflictReason(input.reason),
      d1Now,
    );
    return Object.freeze({
      event: await readScheduledEvent(database, actor, event.id, d1Now),
      outcome: "pending_approval" as const,
      reviewRequestId,
    });
  }

  await commitProposedWrite(
    database,
    actor,
    proposed,
    policy,
    fingerprint,
    reason,
    null,
    d1Now,
  );
  return Object.freeze({
    event: await readScheduledEvent(database, actor, event.id, d1Now),
    outcome: "applied" as const,
    reviewRequestId: null,
  });
}

/**
 * Builds the mandatory persistent intent envelope for Phase 3-compatible
 * non-reserving writes. Callers own one DB.batch() and must order the returned
 * statements as intent -> event mutation -> exact associations -> incident
 * projection -> revision/audit/notifications -> completion. For an existing
 * event the informational incident may safely precede the mutation; a create
 * must place it after the event insert because of the incident FK.
 */
export async function prepareNonReservingScheduleGuard(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  actor: AuthorizedMembership,
  input: NonReservingScheduleGuardInput,
  now: number,
): Promise<NonReservingScheduleGuard> {
  const policy = await getOrganizerConflictPolicy(database, identity);
  const interval =
    input.scheduleShape === "unscheduled"
      ? null
      : input.scheduleShape === "timed"
        ? normalizeConflictInterval({
            bufferAfterMinutes: input.bufferAfterMinutes,
            bufferBeforeMinutes: input.bufferBeforeMinutes,
            endUtc: input.endsAtUtc ?? Number.NaN,
            startUtc: input.startsAtUtc ?? Number.NaN,
          })
        : normalizeAllDayConflictInterval({
            bufferAfterMinutes: input.bufferAfterMinutes,
            bufferBeforeMinutes: input.bufferBeforeMinutes,
            endDateExclusive: input.allDayEndDateExclusive,
            startDate: input.allDayStartDate,
            timeZone: input.timeZone,
          });
  const scope = Object.freeze([...new Set(input.organizerScope)].sort());
  const fingerprint = await schedulingFingerprint({
    allDayEndDateExclusive: input.allDayEndDateExclusive,
    allDayStartDate: input.allDayStartDate,
    bufferAfterMinutes: input.bufferAfterMinutes,
    bufferBeforeMinutes: input.bufferBeforeMinutes,
    clubId: input.clubId,
    endsAtUtc: input.endsAtUtc,
    eventId: input.eventId,
    holdExpiresAt: null,
    interval,
    organizerScope: scope,
    planningStatus: input.planningStatus,
    policyId: policy.id,
    policyVersion: policy.version,
    scheduleShape: input.scheduleShape,
    scheduleVersion: input.proposedScheduleVersion,
    startsAtUtc: input.startsAtUtc,
    timeZone: input.timeZone,
    venueId: input.venueId,
  });
  const intentId = `schedule-intent:${crypto.randomUUID()}`;
  const intentStatement = database
    .prepare(
      `INSERT INTO organizer_schedule_write_intents (
         id, organization_id, organizer_event_id, actor_profile_id, club_id,
         operation, planning_status, schedule_shape, actual_start_utc,
         actual_end_utc, expanded_start_utc, expanded_end_utc, timezone,
         all_day_start_date, all_day_end_date_exclusive,
         buffer_before_minutes, buffer_after_minutes, venue_id,
         primary_organizer_profile_id, organizer_scope_json, hold_expires_at,
         expected_content_version,
         expected_schedule_version, proposed_content_version,
         proposed_schedule_version, policy_id, policy_version, policy_mode,
         reason, review_request_id, state_fingerprint, created_at,
         completed_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL,
         ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL
       )`,
    )
    .bind(
      intentId,
      actor.organizationId,
      input.eventId,
      actor.profileId,
      input.clubId,
      input.operation,
      input.planningStatus,
      input.scheduleShape,
      interval?.actualStartUtc ?? null,
      interval?.actualEndUtc ?? null,
      interval?.expandedStartUtc ?? null,
      interval?.expandedEndUtc ?? null,
      input.timeZone,
      input.allDayStartDate,
      input.allDayEndDateExclusive,
      input.bufferBeforeMinutes,
      input.bufferAfterMinutes,
      input.venueId,
      input.primaryOrganizerProfileId,
      JSON.stringify(scope),
      input.expectedContentVersion,
      input.expectedScheduleVersion,
      input.proposedContentVersion,
      input.proposedScheduleVersion,
      policy.id,
      policy.version,
      policy.mode,
      fingerprint,
      now,
    );
  return Object.freeze({
    completionStatement: database
      .prepare(
        `UPDATE organizer_schedule_write_intents
         SET completed_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND organizer_event_id = ?
           AND completed_at IS NULL`,
      )
      .bind(now, intentId, actor.organizationId, input.eventId),
    incidentStatement:
      input.operation === "soft_delete"
        ? database.prepare("SELECT 0 AS phase4_no_deleted_event_incident")
        : incidentInsertStatement(
            database,
            actor,
            intentId,
            null,
            fingerprint,
            policy.id,
            policy.version,
            input.proposedScheduleVersion,
            "informational",
            now,
          ),
    invalidationStatements:
      input.expectedScheduleVersion === 0
        ? Object.freeze([])
        : Object.freeze(
            scheduleContextInvalidationStatements(
              database,
              actor,
              input.eventId,
              null,
              now,
            ),
          ),
    intentId,
    intentStatement,
  });
}

/**
 * Builds the authoritative D1 envelope for an edit that keeps an existing
 * tentative hold or confirmed event in its reserving lifecycle state. The
 * caller must keep every returned statement in one DB.batch(), ordered as:
 * invalidations -> intent -> incidents -> overrides -> event mutation ->
 * finalization -> associations/revision/audit/notifications -> completion.
 */
export async function prepareOrganizerScheduleEditGuard(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  actor: AuthorizedMembership,
  input: OrganizerScheduleEditGuardInput,
  now: number,
): Promise<OrganizerScheduleEditGuard> {
  if (
    input.planningStatus !== "tentative_hold" &&
    input.planningStatus !== "confirmed"
  ) {
    throw validationError(
      "Only an existing tentative hold or confirmed event uses the reserving edit guard.",
    );
  }
  if (input.scheduleShape === "unscheduled") {
    throw validationError(
      "A tentative hold or confirmed event needs a timed or all-day schedule.",
    );
  }
  const interval =
    input.scheduleShape === "timed"
      ? normalizeConflictInterval({
          bufferAfterMinutes: input.bufferAfterMinutes,
          bufferBeforeMinutes: input.bufferBeforeMinutes,
          endUtc: input.endsAtUtc ?? Number.NaN,
          startUtc: input.startsAtUtc ?? Number.NaN,
        })
      : normalizeAllDayConflictInterval({
          bufferAfterMinutes: input.bufferAfterMinutes,
          bufferBeforeMinutes: input.bufferBeforeMinutes,
          endDateExclusive: input.allDayEndDateExclusive,
          startDate: input.allDayStartDate,
          timeZone: input.timeZone,
        });
  const scope = Object.freeze([...new Set(input.organizerScope)].sort());
  const policy = await getOrganizerConflictPolicy(database, identity);
  const candidate: ConflictCandidate = Object.freeze({
    bufferAfterMinutes: input.bufferAfterMinutes,
    bufferBeforeMinutes: input.bufferBeforeMinutes,
    candidateKey: `manual:${input.eventId}`,
    clubId: input.clubId,
    eventId: input.eventId,
    holdExpiresAt: input.holdExpiresAt,
    interval,
    organizationId: actor.organizationId,
    organizerProfileIds: scope,
    planningStatus: input.planningStatus,
    primaryOrganizerProfileId: input.primaryOrganizerProfileId,
    scheduleVersion: input.proposedScheduleVersion,
    source: "manual",
    title: input.title,
    venueId: input.venueId,
  });
  const conflicts = await loadAuthoritativeConflictFacts(
    database,
    actor.organizationId,
    candidate,
    now,
  );
  if (conflicts.length > 0 && policy.mode === "block") {
    throw conflictRefused(
      "This time is already reserved. The current workspace policy blocks overlapping reservations.",
    );
  }
  const reason =
    conflicts.length > 0 && policy.mode === "warn_reason"
      ? requireConflictReason(input.reason)
      : null;
  const fingerprint = await schedulingFingerprint({
    allDayEndDateExclusive: input.allDayEndDateExclusive,
    allDayStartDate: input.allDayStartDate,
    bufferAfterMinutes: input.bufferAfterMinutes,
    bufferBeforeMinutes: input.bufferBeforeMinutes,
    clubId: input.clubId,
    endsAtUtc: input.endsAtUtc,
    eventId: input.eventId,
    holdExpiresAt: input.holdExpiresAt,
    interval,
    organizerScope: scope,
    planningStatus: input.planningStatus,
    policyId: policy.id,
    policyVersion: policy.version,
    scheduleShape: input.scheduleShape,
    scheduleVersion: input.proposedScheduleVersion,
    startsAtUtc: input.startsAtUtc,
    timeZone: input.timeZone,
    venueId: input.venueId,
  });
  if (
    conflicts.length > 0 &&
    policy.mode === "require_admin_approval"
  ) {
    const reviewRequestId = await createPendingScheduleEditReview(
      database,
      actor,
      input,
      conflicts,
      policy,
      fingerprint,
      requireConflictReason(input.reason),
      now,
    );
    return Object.freeze({
      outcome: "pending_approval" as const,
      reviewRequestId,
    });
  }
  const intentId = `schedule-intent:${crypto.randomUUID()}`;
  const invalidationStatements = Object.freeze(
    scheduleContextInvalidationStatements(
      database,
      actor,
      input.eventId,
      null,
      now,
    ),
  );
  const intentStatement = database
    .prepare(
      `INSERT INTO organizer_schedule_write_intents (
         id, organization_id, organizer_event_id, actor_profile_id, club_id,
         operation, planning_status, schedule_shape, actual_start_utc,
         actual_end_utc, expanded_start_utc, expanded_end_utc, timezone,
         all_day_start_date, all_day_end_date_exclusive,
         buffer_before_minutes, buffer_after_minutes, venue_id,
         primary_organizer_profile_id, organizer_scope_json, hold_expires_at,
         expected_content_version, expected_schedule_version,
         proposed_content_version, proposed_schedule_version, policy_id,
         policy_version, policy_mode, reason, review_request_id,
         state_fingerprint, created_at, completed_at
       ) VALUES (
         ?, ?, ?, ?, ?, 'update', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL
       )`,
    )
    .bind(
      intentId,
      actor.organizationId,
      input.eventId,
      actor.profileId,
      input.clubId,
      input.planningStatus,
      input.scheduleShape,
      interval.actualStartUtc,
      interval.actualEndUtc,
      interval.expandedStartUtc,
      interval.expandedEndUtc,
      input.timeZone,
      input.allDayStartDate,
      input.allDayEndDateExclusive,
      input.bufferBeforeMinutes,
      input.bufferAfterMinutes,
      input.venueId,
      input.primaryOrganizerProfileId,
      JSON.stringify(scope),
      input.holdExpiresAt,
      input.expectedContentVersion,
      input.expectedScheduleVersion,
      input.proposedContentVersion,
      input.proposedScheduleVersion,
      policy.id,
      policy.version,
      policy.mode,
      reason,
      fingerprint,
      now,
    );
  const incidentStatement = incidentInsertStatement(
    database,
    actor,
    intentId,
    null,
    fingerprint,
    policy.id,
    policy.version,
    input.proposedScheduleVersion,
    "open",
    now,
  );
  const overrideStatement = database
    .prepare(
      `INSERT INTO organizer_conflict_overrides (
         id, organization_id, incident_id, organizer_event_id,
         conflicting_candidate_key, proposed_schedule_version,
         conflicting_schedule_version, policy_id, policy_version,
         state_fingerprint, reason, actor_profile_id, review_request_id,
         created_at, invalidated_at, invalidated_by_profile_id
       )
       SELECT 'conflict-override:' || lower(hex(randomblob(16))),
              incident.organization_id, incident.id,
              incident.organizer_event_id,
              incident.conflicting_candidate_key,
              incident.proposed_schedule_version,
              incident.conflicting_schedule_version,
              incident.policy_id, incident.policy_version,
              incident.state_fingerprint, ?, ?, NULL, ?, NULL, NULL
       FROM organizer_conflict_incidents AS incident
       WHERE incident.organization_id = ?
         AND incident.write_intent_id = ?
         AND incident.proposed_schedule_version = ?`,
    )
    .bind(
      reason ?? "No overlap",
      actor.profileId,
      now,
      actor.organizationId,
      intentId,
      input.proposedScheduleVersion,
    );
  return Object.freeze({
    completionStatement: database
      .prepare(
        `UPDATE organizer_schedule_write_intents
         SET completed_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND organizer_event_id = ?
           AND completed_at IS NULL`,
      )
      .bind(now, intentId, actor.organizationId, input.eventId),
    finalizationStatement: database
      .prepare(
        `UPDATE organizer_conflict_incidents
         SET state = 'approved',
             updated_at = ?
         WHERE organization_id = ?
           AND write_intent_id = ?
           AND proposed_schedule_version = ?
           AND state = 'open'`,
      )
      .bind(
        now,
        actor.organizationId,
        intentId,
        input.proposedScheduleVersion,
      ),
    incidentStatement,
    invalidationStatements,
    intentId,
    intentStatement,
    outcome: "apply" as const,
    overrideStatement,
  });
}

/**
 * Creates the Phase 4 envelope used by every Phase 5 publication mutation.
 * The proposed schedule is the canonical current schedule, so publication
 * changes content_version while leaving schedule_version untouched. The D1
 * intent trigger still evaluates the complete reservation and active policy.
 */
export async function prepareOrganizerPublicationScheduleGuard(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  input: Readonly<{
    eventId: unknown;
    expectedContentVersion: unknown;
    expectedScheduleVersion: unknown;
    operation: OrganizerPublicationScheduleOperation;
    proposedContentVersion: unknown;
  }>,
  now: number,
): Promise<OrganizerPublicationScheduleGuard> {
  const actor = await authorizeMembership(database, identity);
  return prepareOrganizerPublicationScheduleGuardForAuthorizedActor(
    database,
    actor,
    input,
    now,
  );
}

/**
 * Internal reconciliation seam. The caller must derive this membership from
 * durable D1 state; it never accepts a browser identity, email, or role claim.
 * Current profile, membership, club assignment, and event participation are
 * revalidated below before an intent can be created.
 */
export async function prepareOrganizerPublicationScheduleGuardForAuthorizedActor(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  input: Readonly<{
    eventId: unknown;
    expectedContentVersion: unknown;
    expectedScheduleVersion: unknown;
    operation: OrganizerPublicationScheduleOperation;
    proposedContentVersion: unknown;
  }>,
  now: number,
): Promise<OrganizerPublicationScheduleGuard> {
  const eventId = parseIdentifier(input.eventId, "eventId");
  const expectedContentVersion = parseFiniteInteger(
    input.expectedContentVersion,
    { path: "expectedContentVersion", minimum: 1 },
  );
  const expectedScheduleVersion = parseFiniteInteger(
    input.expectedScheduleVersion,
    { path: "expectedScheduleVersion", minimum: 1 },
  );
  const proposedContentVersion = parseFiniteInteger(
    input.proposedContentVersion,
    { path: "proposedContentVersion", minimum: 2 },
  );
  if (proposedContentVersion !== expectedContentVersion + 1) {
    throw staleSchedule();
  }
  const terminalRecovery =
    input.operation === "invalidate_scheduled_publication";
  const event = await requireSchedulingEvent(
    database,
    actor,
    eventId,
    terminalRecovery,
  );
  await authorizeSchedulingActorForEvent(database, actor, event);
  if (
    event.contentVersion !== expectedContentVersion ||
    event.scheduleVersion !== expectedScheduleVersion
  ) {
    throw staleSchedule();
  }
  const publicationRequiresReservationAuthorization =
    input.operation === "publish" ||
    input.operation === "reconcile_publication" ||
    input.operation === "schedule_publication" ||
    input.operation === "update_published";
  if (
    (!terminalRecovery && event.deletedAt !== null) ||
    (publicationRequiresReservationAuthorization &&
      (event.planningStatus !== "confirmed" ||
        event.scheduleShape === "unscheduled"))
  ) {
    throw new SafeApplicationError(
      "validation_failed",
      422,
      "Website publication requires a confirmed timed or all-day event.",
    );
  }

  const policy = await readOrganizerConflictPolicyForAuthorizedActor(
    database,
    actor,
  );
  const interval = conflictIntervalForEvent(event);
  if (publicationRequiresReservationAuthorization && !interval) {
    throw new SafeApplicationError(
      "validation_failed",
      422,
      "Website publication requires a real schedule.",
    );
  }
  const organizerScope = Object.freeze(
    [...new Set([
      event.primaryOrganizerProfileId,
      ...event.coOrganizerProfileIds,
    ])].sort(),
  );
  const conflicts =
    publicationRequiresReservationAuthorization &&
    interval !== null &&
    event.planningStatus === "confirmed"
      ? await loadAuthoritativeConflictFacts(
          database,
          actor.organizationId,
          Object.freeze({
            bufferAfterMinutes: event.bufferAfterMinutes,
            bufferBeforeMinutes: event.bufferBeforeMinutes,
            candidateKey: `manual:${event.id}`,
            clubId: event.clubId,
            eventId: event.id,
            holdExpiresAt: null,
            interval,
            organizationId: event.organizationId,
            organizerProfileIds: organizerScope,
            planningStatus: "confirmed" as const,
            primaryOrganizerProfileId: event.primaryOrganizerProfileId,
            scheduleVersion: event.scheduleVersion,
            source: "manual" as const,
            title: event.title,
            venueId: event.venueId,
          }),
          now,
        )
      : [];
  if (conflicts.length > 0 && policy.mode === "block") {
    throw conflictRefused(
      "This event has an unresolved overlap under the current blocking policy.",
    );
  }

  const stateFingerprint = await schedulingFingerprint({
    allDayEndDateExclusive: event.allDayEndDateExclusive,
    allDayStartDate: event.allDayStartDate,
    bufferAfterMinutes: event.bufferAfterMinutes,
    bufferBeforeMinutes: event.bufferBeforeMinutes,
    clubId: event.clubId,
    endsAtUtc: event.endsAtUtc,
    eventId: event.id,
    holdExpiresAt: null,
    interval,
    organizerScope,
    planningStatus: event.planningStatus,
    policyId: policy.id,
    policyVersion: policy.version,
    scheduleShape: event.scheduleShape,
    scheduleVersion: event.scheduleVersion,
    startsAtUtc: event.startsAtUtc,
    timeZone: event.timeZone,
    venueId: event.venueId,
  });
  const authorization = await requireExistingPublicationConflictAuthorization(
    database,
    actor,
    event,
    conflicts,
    policy,
    stateFingerprint,
  );
  const intentId = `schedule-intent:${crypto.randomUUID()}`;
  const intentStatement = database
    .prepare(
      `INSERT INTO organizer_schedule_write_intents (
         id, organization_id, organizer_event_id, actor_profile_id, club_id,
         operation, planning_status, schedule_shape, actual_start_utc,
         actual_end_utc, expanded_start_utc, expanded_end_utc, timezone,
         all_day_start_date, all_day_end_date_exclusive,
         buffer_before_minutes, buffer_after_minutes, venue_id,
         primary_organizer_profile_id, organizer_scope_json,
         hold_expires_at, expected_content_version,
         expected_schedule_version, proposed_content_version,
         proposed_schedule_version, policy_id, policy_version, policy_mode,
         reason, review_request_id, state_fingerprint, created_at,
         completed_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
       )`,
    )
    .bind(
      intentId,
      actor.organizationId,
      event.id,
      actor.profileId,
      event.clubId,
      input.operation,
      event.planningStatus,
      event.scheduleShape,
      interval?.actualStartUtc ?? null,
      interval?.actualEndUtc ?? null,
      interval?.expandedStartUtc ?? null,
      interval?.expandedEndUtc ?? null,
      event.timeZone,
      event.allDayStartDate,
      event.allDayEndDateExclusive,
      event.bufferBeforeMinutes,
      event.bufferAfterMinutes,
      event.venueId,
      event.primaryOrganizerProfileId,
      JSON.stringify(organizerScope),
      expectedContentVersion,
      expectedScheduleVersion,
      proposedContentVersion,
      expectedScheduleVersion,
      policy.id,
      policy.version,
      policy.mode,
      authorization.reason,
      authorization.reviewRequestId,
      stateFingerprint,
      now,
    );
  const authorizationStatements =
    publicationRequiresReservationAuthorization && conflicts.length > 0
      ? publicationConflictAuthorizationStatements(
          database,
          actor,
          event,
          conflicts,
          intentId,
          policy,
          stateFingerprint,
          authorization,
          now,
        )
      : Object.freeze([]);
  const finalizationStatement =
    authorizationStatements.length > 0
      ? database
          .prepare(
            `UPDATE organizer_conflict_incidents
             SET state = 'approved',
                 updated_at = ?
             WHERE organization_id = ?
               AND organizer_event_id = ?
               AND write_intent_id = ?
               AND proposed_schedule_version = ?
               AND policy_id = ?
               AND policy_version = ?
               AND state_fingerprint = ?
               AND state = 'open'`,
          )
          .bind(
            now,
            actor.organizationId,
            event.id,
            intentId,
            event.scheduleVersion,
            policy.id,
            policy.version,
            stateFingerprint,
          )
      : null;

  return Object.freeze({
    authorizationExpectedChanges: conflicts.length,
    authorizationStatements,
    completionStatement: database
      .prepare(
        `UPDATE organizer_schedule_write_intents
         SET completed_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND organizer_event_id = ?
           AND completed_at IS NULL`,
      )
      .bind(now, intentId, actor.organizationId, event.id),
    event: Object.freeze({
      actor,
      clubId: event.clubId,
      contentVersion: event.contentVersion,
      eventId: event.id,
      organizationId: event.organizationId,
      planningStatus: event.planningStatus,
      primaryOrganizerProfileId: event.primaryOrganizerProfileId,
      publicationStatus: event.publicationStatus,
      scheduleVersion: event.scheduleVersion,
      slug: event.slug,
      title: event.title,
    }),
    finalizationStatement,
    intentId,
    intentStatement,
    policyMode: policy.mode,
    stateFingerprint,
  });
}

export async function decideOrganizerConflictReview(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  reviewIdValue: unknown,
  value: unknown,
): Promise<Readonly<{ decision: "approve" | "reject"; event: OrganizerScheduledEventDto | null }>> {
  const reviewId = parseIdentifier(reviewIdValue, "reviewId");
  const input = parseObject(value, "body");
  assertOnlyKeys(input, ["decision", "note"], "body");
  const decision = parseEnum(
    input.decision,
    ["approve", "reject"] as const,
    "decision",
  );
  const decisionNote = parseOptionalBoundedString(input.note, {
    path: "note",
    maxLength: 1_000,
  });
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const review = await readPendingReview(database, actor, reviewId);
  if (
    decision === "approve" &&
    actor.role === "administrator" &&
    actor.profileId === review.requesterProfileId
  ) {
    throw new SafeApplicationError(
      "authorization_denied",
      403,
      "An Administrator cannot approve their own request.",
    );
  }
  const now = await currentD1Time(database);
  if (decision === "reject") {
    try {
      const results = await database.batch([
        database
          .prepare(
          `UPDATE organizer_conflict_review_requests AS review
           SET state = 'rejected',
               decided_by_profile_id = ?,
               decided_at = ?,
               decision_note = ?,
               updated_at = ?
           WHERE review.id = ?
             AND review.organization_id = ?
             AND review.state = 'pending'
             AND EXISTS (
               SELECT 1
               FROM organization_memberships AS membership
               JOIN profiles AS profile
                 ON profile.id = membership.profile_id
                AND profile.status = 'active'
                AND profile.deleted_at IS NULL
               WHERE membership.id = ?
                 AND membership.organization_id = review.organization_id
                 AND membership.profile_id = ?
                 AND membership.role IN ('owner', 'administrator')
                 AND membership.status = 'active'
                 AND membership.deleted_at IS NULL
             )`,
          )
          .bind(
          actor.profileId,
          now,
          decisionNote,
          now,
          reviewId,
          actor.organizationId,
          actor.membershipId,
          actor.profileId,
        ),
        database
          .prepare(
          `UPDATE organizer_conflict_incidents
           SET state = 'rejected', updated_at = ?
           WHERE organization_id = ?
             AND review_request_id = ?
             AND state = 'pending_approval'
             AND changes() = 1`,
          )
          .bind(now, actor.organizationId, reviewId),
        database
          .prepare(
          `INSERT INTO audit_logs (
             id, organization_id, actor_profile_id, action, entity_type,
             entity_id, metadata_json, created_at
           ) VALUES (
             ?, ?, ?,
             CASE WHEN changes() >= 1
               THEN 'conflict_review.rejected'
               ELSE NULL
             END,
             'organizer_event', ?, ?, ?
           )`,
          )
          .bind(
          `audit:${crypto.randomUUID()}`,
          actor.organizationId,
          actor.profileId,
          review.eventId,
          JSON.stringify({ reviewId }),
          now,
          ),
        conflictNotificationStatement(database, actor, {
          directRecipientProfileId: review.requesterProfileId,
          eventId: review.eventId,
          includeReviewers: false,
          now,
          sourceId: reviewId,
          sourceKind: "review",
          type: "conflict_rejected",
        }),
      ]);
      if (
        changes(results[0]) < 1 ||
        changes(results[1]) < 1 ||
        changes(results[2]) < 1
      ) {
        throw staleReview();
      }
    } catch (error) {
      throw mapSchedulingDatabaseError(error);
    }
    return Object.freeze({ decision, event: null });
  }

  const current = await requireSchedulingEvent(
    database,
    actor,
    review.eventId,
    true,
  );
  await authorizeSchedulingEdit(database, identity, actor, current);
  if (review.requestedState.action === "update_schedule") {
    const requestedEdit = requestedScheduleEditFromReview(review, current);
    const policy = await getOrganizerConflictPolicy(database, identity);
    if (
      policy.id !== review.policyId ||
      policy.version !== review.policyVersion ||
      policy.mode !== "require_admin_approval"
    ) {
      throw staleReview();
    }
    const conflicts = await loadAuthoritativeConflictFacts(
      database,
      actor.organizationId,
      candidateFromRequestedScheduleEdit(current, requestedEdit),
      now,
    );
    const currentFingerprint = await schedulingFingerprint({
      allDayEndDateExclusive: requestedEdit.allDayEndDateExclusive,
      allDayStartDate: requestedEdit.allDayStartDate,
      bufferAfterMinutes: requestedEdit.bufferAfterMinutes,
      bufferBeforeMinutes: requestedEdit.bufferBeforeMinutes,
      clubId: requestedEdit.clubId,
      endsAtUtc: requestedEdit.endsAtUtc,
      eventId: current.id,
      holdExpiresAt: requestedEdit.holdExpiresAt,
      interval: requestedEdit.interval,
      organizerScope: requestedEdit.organizerScope,
      planningStatus: requestedEdit.planningStatus,
      policyId: policy.id,
      policyVersion: policy.version,
      scheduleShape: requestedEdit.scheduleShape,
      scheduleVersion: requestedEdit.proposedScheduleVersion,
      startsAtUtc: requestedEdit.startsAtUtc,
      timeZone: requestedEdit.timeZone,
      venueId: requestedEdit.venueId,
    });
    if (
      currentFingerprint !== review.stateFingerprint ||
      !sameConflictSet(conflicts, review.conflictKeys)
    ) {
      throw staleReview();
    }
    await commitApprovedScheduleEdit(
      database,
      actor,
      current,
      requestedEdit,
      review,
      reviewId,
      policy,
      currentFingerprint,
      decisionNote,
      now,
    );
    return Object.freeze({
      decision,
      event: await readScheduledEvent(database, actor, current.id, now),
    });
  }
  const requested = requestedStateFromReview(review, current);
  if (
    current.scheduleVersion + 1 !== review.requestedScheduleVersion
  ) {
    throw staleReview();
  }
  const policy = await getOrganizerConflictPolicy(database, identity);
  if (
    policy.id !== review.policyId ||
    policy.version !== review.policyVersion ||
    policy.mode !== "require_admin_approval"
  ) {
    throw staleReview();
  }
  const candidate = candidateFromProposed(requested);
  const conflicts = requested.interval
    ? await loadAuthoritativeConflictFacts(
        database,
        actor.organizationId,
        candidate,
        now,
      )
    : [];
  const currentFingerprint = await schedulingFingerprint({
    allDayEndDateExclusive: current.allDayEndDateExclusive,
    allDayStartDate: current.allDayStartDate,
    bufferAfterMinutes: current.bufferAfterMinutes,
    bufferBeforeMinutes: current.bufferBeforeMinutes,
    clubId: current.clubId,
    eventId: current.id,
    holdExpiresAt: requested.holdExpiresAt,
    interval: requested.interval,
    organizerScope: requested.organizerScope,
    planningStatus: requested.nextPlanningStatus,
    policyId: policy.id,
    policyVersion: policy.version,
    scheduleShape: current.scheduleShape,
    scheduleVersion: requested.nextScheduleVersion,
    startsAtUtc: current.startsAtUtc,
    endsAtUtc: current.endsAtUtc,
    timeZone: current.timeZone,
    venueId: current.venueId,
  });
  if (
    currentFingerprint !== review.stateFingerprint ||
    !sameConflictSet(conflicts, review.conflictKeys)
  ) {
    throw staleReview();
  }

  await commitProposedWrite(
    database,
    actor,
    requested,
    policy,
    currentFingerprint,
    review.reason,
    reviewId,
    now,
    {
      decisionNote,
      decisionProfileId: actor.profileId,
      requesterProfileId: review.requesterProfileId,
    },
  );
  return Object.freeze({
    decision,
    event: await readScheduledEvent(database, actor, current.id, now),
  });
}

type RequestedScheduleEdit = Readonly<{
  allDayEndDateExclusive: string | null;
  allDayStartDate: string | null;
  bufferAfterMinutes: number;
  bufferBeforeMinutes: number;
  clubId: string;
  endsAtUtc: number | null;
  expectedContentVersion: number;
  expectedScheduleVersion: number;
  holdExpiresAt: number | null;
  interval: NormalizedConflictInterval;
  organizerScope: readonly string[];
  planningStatus: "confirmed" | "tentative_hold";
  primaryOrganizerProfileId: string;
  proposedContentVersion: number;
  proposedScheduleVersion: number;
  scheduleShape: "all_day" | "timed";
  startsAtUtc: number | null;
  timeZone: string;
  venueId: string | null;
}>;

function requestedScheduleEditFromReview(
  review: PendingReview,
  current: SchedulingEvent,
): RequestedScheduleEdit {
  try {
    const state = review.requestedState;
    const scheduleShape = parseEnum(
      state.scheduleShape,
      ["timed", "all_day"] as const,
      "requestedState.scheduleShape",
    );
    const planningStatus = parseEnum(
      state.planningStatus,
      ["tentative_hold", "confirmed"] as const,
      "requestedState.planningStatus",
    );
    const expectedContentVersion = parseFiniteInteger(
      state.expectedContentVersion,
      { path: "requestedState.expectedContentVersion", minimum: 1 },
    );
    const expectedScheduleVersion = parseFiniteInteger(
      state.expectedScheduleVersion,
      { path: "requestedState.expectedScheduleVersion", minimum: 1 },
    );
    const proposedContentVersion = parseFiniteInteger(
      state.proposedContentVersion,
      { path: "requestedState.proposedContentVersion", minimum: 2 },
    );
    const proposedScheduleVersion = parseFiniteInteger(
      state.proposedScheduleVersion,
      { path: "requestedState.proposedScheduleVersion", minimum: 2 },
    );
    if (
      planningStatus !== current.planningStatus ||
      expectedContentVersion !== current.contentVersion ||
      expectedScheduleVersion !== current.scheduleVersion ||
      proposedContentVersion !== current.contentVersion + 1 ||
      proposedScheduleVersion !== current.scheduleVersion + 1 ||
      review.requestedScheduleVersion !== proposedScheduleVersion
    ) {
      throw staleReview();
    }
    const primaryOrganizerProfileId = parseIdentifier(
      state.primaryOrganizerProfileId,
      "requestedState.primaryOrganizerProfileId",
    );
    if (!Array.isArray(state.organizerScope) || state.organizerScope.length > 13) {
      throw staleReview();
    }
    const parsedScope = state.organizerScope.map((value, index) =>
      parseIdentifier(value, `requestedState.organizerScope.${index}`),
    );
    const organizerScope = Object.freeze([...new Set(parsedScope)].sort());
    if (
      organizerScope.length !== parsedScope.length ||
      !organizerScope.includes(primaryOrganizerProfileId)
    ) {
      throw staleReview();
    }
    const bufferBeforeMinutes = parseFiniteInteger(
      state.bufferBeforeMinutes,
      {
        path: "requestedState.bufferBeforeMinutes",
        minimum: 0,
        maximum: 1_440,
      },
    );
    const bufferAfterMinutes = parseFiniteInteger(
      state.bufferAfterMinutes,
      {
        path: "requestedState.bufferAfterMinutes",
        minimum: 0,
        maximum: 1_440,
      },
    );
    const timeZone = parseIanaTimeZone(
      state.timeZone,
      "requestedState.timeZone",
    );
    const startsAtUtc =
      state.startsAtUtc === null ? null : requiredInteger(state.startsAtUtc);
    const endsAtUtc =
      state.endsAtUtc === null ? null : requiredInteger(state.endsAtUtc);
    const allDayStartDate =
      state.allDayStartDate === null
        ? null
        : requiredString(state.allDayStartDate);
    const allDayEndDateExclusive =
      state.allDayEndDateExclusive === null
        ? null
        : requiredString(state.allDayEndDateExclusive);
    const interval =
      scheduleShape === "timed"
        ? normalizeConflictInterval({
            bufferAfterMinutes,
            bufferBeforeMinutes,
            endUtc: endsAtUtc ?? Number.NaN,
            startUtc: startsAtUtc ?? Number.NaN,
          })
        : normalizeAllDayConflictInterval({
            bufferAfterMinutes,
            bufferBeforeMinutes,
            endDateExclusive: allDayEndDateExclusive,
            startDate: allDayStartDate,
            timeZone,
          });
    if (
      (scheduleShape === "timed" &&
        (allDayStartDate !== null || allDayEndDateExclusive !== null)) ||
      (scheduleShape === "all_day" &&
        (startsAtUtc !== null || endsAtUtc !== null))
    ) {
      throw staleReview();
    }
    const holdExpiresAt =
      state.holdExpiresAt === null
        ? null
        : requiredInteger(state.holdExpiresAt);
    if (
      (planningStatus === "tentative_hold" && holdExpiresAt === null) ||
      (planningStatus === "confirmed" && holdExpiresAt !== null)
    ) {
      throw staleReview();
    }
    return Object.freeze({
      allDayEndDateExclusive,
      allDayStartDate,
      bufferAfterMinutes,
      bufferBeforeMinutes,
      clubId: parseIdentifier(state.clubId, "requestedState.clubId"),
      endsAtUtc,
      expectedContentVersion,
      expectedScheduleVersion,
      holdExpiresAt,
      interval,
      organizerScope,
      planningStatus,
      primaryOrganizerProfileId,
      proposedContentVersion,
      proposedScheduleVersion,
      scheduleShape,
      startsAtUtc,
      timeZone,
      venueId:
        state.venueId === null
          ? null
          : parseIdentifier(state.venueId, "requestedState.venueId"),
    });
  } catch (error) {
    if (error instanceof SafeApplicationError && error.code === "stale_edit") {
      throw error;
    }
    throw staleReview();
  }
}

function candidateFromRequestedScheduleEdit(
  current: SchedulingEvent,
  requested: RequestedScheduleEdit,
): ConflictCandidate {
  return Object.freeze({
    bufferAfterMinutes: requested.bufferAfterMinutes,
    bufferBeforeMinutes: requested.bufferBeforeMinutes,
    candidateKey: `manual:${current.id}`,
    clubId: requested.clubId,
    eventId: current.id,
    holdExpiresAt: requested.holdExpiresAt,
    interval: requested.interval,
    organizationId: current.organizationId,
    organizerProfileIds: requested.organizerScope,
    planningStatus: requested.planningStatus,
    primaryOrganizerProfileId: requested.primaryOrganizerProfileId,
    scheduleVersion: requested.proposedScheduleVersion,
    source: "manual",
    title: current.title,
    venueId: requested.venueId,
  });
}

async function commitApprovedScheduleEdit(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  current: SchedulingEvent,
  requested: RequestedScheduleEdit,
  review: PendingReview,
  reviewId: string,
  policy: Readonly<{ id: string; version: number }>,
  fingerprint: string,
  decisionNote: string | null,
  now: number,
): Promise<void> {
  const intentId = `schedule-intent:${crypto.randomUUID()}`;
  const invalidations = scheduleContextInvalidationStatements(
    database,
    actor,
    current.id,
    reviewId,
    now,
  );
  const statements: D1PreparedStatementLike[] = [
    database
      .prepare(
        `UPDATE organizer_conflict_review_requests AS review
         SET state = 'approved',
             decided_by_profile_id = ?,
             decided_at = ?,
             decision_note = ?,
             updated_at = ?
         WHERE review.id = ?
           AND review.organization_id = ?
           AND review.state = 'pending'
           AND review.state_fingerprint = ?
           AND review.policy_id = ?
           AND review.policy_version = ?
           AND review.requested_schedule_version = ?
           AND EXISTS (
             SELECT 1
             FROM organization_memberships AS membership
             JOIN profiles AS profile
               ON profile.id = membership.profile_id
              AND profile.status = 'active'
              AND profile.deleted_at IS NULL
             WHERE membership.id = ?
               AND membership.organization_id = review.organization_id
               AND membership.profile_id = ?
               AND membership.role IN ('owner', 'administrator')
               AND membership.status = 'active'
               AND membership.deleted_at IS NULL
           )
           AND (
             ? = 'owner'
             OR review.requester_profile_id <> ?
           )`,
      )
      .bind(
        actor.profileId,
        now,
        decisionNote,
        now,
        reviewId,
        actor.organizationId,
        fingerprint,
        policy.id,
        policy.version,
        requested.proposedScheduleVersion,
        actor.membershipId,
        actor.profileId,
        actor.role,
        actor.profileId,
      ),
    ...invalidations,
  ];
  const intentIndex = statements.length;
  statements.push(
    database
      .prepare(
        `INSERT INTO organizer_schedule_write_intents (
           id, organization_id, organizer_event_id, actor_profile_id, club_id,
           operation, planning_status, schedule_shape, actual_start_utc,
           actual_end_utc, expanded_start_utc, expanded_end_utc, timezone,
           all_day_start_date, all_day_end_date_exclusive,
           buffer_before_minutes, buffer_after_minutes, venue_id,
           primary_organizer_profile_id, organizer_scope_json, hold_expires_at,
           expected_content_version, expected_schedule_version,
           proposed_content_version, proposed_schedule_version, policy_id,
           policy_version, policy_mode, reason, review_request_id,
           state_fingerprint, created_at, completed_at
         ) VALUES (
           ?, ?, ?, ?, ?, 'update', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, 'require_admin_approval', ?, ?, ?, ?, NULL
         )`,
      )
      .bind(
        intentId,
        actor.organizationId,
        current.id,
        actor.profileId,
        requested.clubId,
        requested.planningStatus,
        requested.scheduleShape,
        requested.interval.actualStartUtc,
        requested.interval.actualEndUtc,
        requested.interval.expandedStartUtc,
        requested.interval.expandedEndUtc,
        requested.timeZone,
        requested.allDayStartDate,
        requested.allDayEndDateExclusive,
        requested.bufferBeforeMinutes,
        requested.bufferAfterMinutes,
        requested.venueId,
        requested.primaryOrganizerProfileId,
        JSON.stringify(requested.organizerScope),
        requested.holdExpiresAt,
        requested.expectedContentVersion,
        requested.expectedScheduleVersion,
        requested.proposedContentVersion,
        requested.proposedScheduleVersion,
        policy.id,
        policy.version,
        review.reason,
        reviewId,
        fingerprint,
        now,
      ),
    adoptApprovedIncidentsStatement(
      database,
      actor,
      intentId,
      reviewId,
      fingerprint,
      policy.id,
      policy.version,
      requested.proposedScheduleVersion,
      now,
    ),
    database
      .prepare(
        `INSERT INTO organizer_conflict_overrides (
           id, organization_id, incident_id, organizer_event_id,
           conflicting_candidate_key, proposed_schedule_version,
           conflicting_schedule_version, policy_id, policy_version,
           state_fingerprint, reason, actor_profile_id, review_request_id,
           created_at, invalidated_at, invalidated_by_profile_id
         )
         SELECT 'conflict-override:' || lower(hex(randomblob(16))),
                incident.organization_id, incident.id,
                incident.organizer_event_id,
                incident.conflicting_candidate_key,
                incident.proposed_schedule_version,
                incident.conflicting_schedule_version,
                incident.policy_id, incident.policy_version,
                incident.state_fingerprint, ?, ?, ?, ?, NULL, NULL
         FROM organizer_conflict_incidents AS incident
         WHERE incident.organization_id = ?
           AND incident.write_intent_id = ?
           AND incident.proposed_schedule_version = ?`,
      )
      .bind(
        review.reason,
        actor.profileId,
        reviewId,
        now,
        actor.organizationId,
        intentId,
        requested.proposedScheduleVersion,
      ),
  );
  const eventIndex = statements.length;
  statements.push(
    database
      .prepare(
        `UPDATE organizer_events AS event
         SET club_id = ?,
             venue_id = ?,
             primary_organizer_profile_id = ?,
             schedule_shape = ?,
             starts_at_utc = ?,
             ends_at_utc = ?,
             timezone = ?,
             all_day_start_date = ?,
             all_day_end_date_exclusive = ?,
             buffer_before_minutes = ?,
             buffer_after_minutes = ?,
             content_version = ?,
             schedule_version = ?,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE event.id = ?
           AND event.organization_id = ?
           AND event.content_version = ?
           AND event.schedule_version = ?
           AND event.planning_status = ?
           AND event.deleted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM organization_memberships AS membership
             JOIN profiles AS profile
               ON profile.id = membership.profile_id
              AND profile.status = 'active'
              AND profile.deleted_at IS NULL
             WHERE membership.id = ?
               AND membership.organization_id = event.organization_id
               AND membership.profile_id = ?
               AND membership.role IN ('owner', 'administrator')
               AND membership.status = 'active'
               AND membership.deleted_at IS NULL
           )`,
      )
      .bind(
        requested.clubId,
        requested.venueId,
        requested.primaryOrganizerProfileId,
        requested.scheduleShape,
        requested.startsAtUtc,
        requested.endsAtUtc,
        requested.timeZone,
        requested.allDayStartDate,
        requested.allDayEndDateExclusive,
        requested.bufferBeforeMinutes,
        requested.bufferAfterMinutes,
        requested.proposedContentVersion,
        requested.proposedScheduleVersion,
        actor.profileId,
        now,
        current.id,
        actor.organizationId,
        requested.expectedContentVersion,
        requested.expectedScheduleVersion,
        requested.planningStatus,
        actor.membershipId,
        actor.profileId,
      ),
    database
      .prepare(
        `DELETE FROM organizer_event_organizers
         WHERE organization_id = ?
           AND organizer_event_id = ?`,
      )
      .bind(actor.organizationId, current.id),
    ...requested.organizerScope
      .filter(
        (profileId) => profileId !== requested.primaryOrganizerProfileId,
      )
      .map((profileId) =>
        approvedCoOrganizerInsertStatement(
          database,
          actor,
          current.id,
          requested.clubId,
          profileId,
          now,
        ),
      ),
    database
      .prepare(
        `INSERT INTO organizer_event_revisions (
           id, organization_id, organizer_event_id, content_version,
           schedule_version, action, snapshot_json, actor_profile_id,
           created_at
         ) VALUES (?, ?, ?, ?, ?, 'updated', ?, ?, ?)`,
      )
      .bind(
        `organizer-event-revision:${crypto.randomUUID()}`,
        actor.organizationId,
        current.id,
        requested.proposedContentVersion,
        requested.proposedScheduleVersion,
        JSON.stringify({
          allDayEndDateExclusive: requested.allDayEndDateExclusive,
          allDayStartDate: requested.allDayStartDate,
          bufferAfterMinutes: requested.bufferAfterMinutes,
          bufferBeforeMinutes: requested.bufferBeforeMinutes,
          clubId: requested.clubId,
          contentVersion: requested.proposedContentVersion,
          holdExpiresAt: requested.holdExpiresAt,
          id: current.id,
          organizerScope: requested.organizerScope,
          planningStatus: requested.planningStatus,
          publicationStatus: current.publicationStatus,
          scheduleShape: requested.scheduleShape,
          scheduleVersion: requested.proposedScheduleVersion,
          timeZone: requested.timeZone,
          venueId: requested.venueId,
        }),
        actor.profileId,
        now,
      ),
    auditStatement(
      database,
      actor,
      current.id,
      "organizer_event.schedule_edit_approved",
      {
        contentVersion: requested.proposedContentVersion,
        reviewId,
        scheduleVersion: requested.proposedScheduleVersion,
      },
      now,
    ),
    ...requested.organizerScope
      .filter((profileId) => profileId !== actor.profileId)
      .map((profileId) =>
        prepareNotificationInsert(database, {
          organizationId: actor.organizationId,
          recipientProfileId: profileId,
          createdAt: now,
          payload: {
            type: "event_schedule_changed",
            eventId: current.id,
            title: current.title.slice(0, 160),
          },
        }),
      ),
    conflictNotificationStatement(database, actor, {
      directRecipientProfileId: review.requesterProfileId,
      eventId: current.id,
      includeReviewers: false,
      now,
      sourceId: reviewId,
      sourceKind: "review",
      type: "conflict_approved",
    }),
    database
      .prepare(
        `UPDATE organizer_conflict_incidents
         SET state = 'approved',
             updated_at = ?
         WHERE organization_id = ?
           AND write_intent_id = ?
           AND proposed_schedule_version = ?
           AND state = 'open'`,
      )
      .bind(
        now,
        actor.organizationId,
        intentId,
        requested.proposedScheduleVersion,
      ),
    database
      .prepare(
        `UPDATE organizer_schedule_write_intents
         SET completed_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND organizer_event_id = ?
           AND completed_at IS NULL`,
      )
      .bind(now, intentId, actor.organizationId, current.id),
  );
  try {
    const results = await database.batch(statements);
    if (
      changes(results[0]) < 1 ||
      changes(results[intentIndex]) < 1 ||
      changes(results[eventIndex]) < 1 ||
      changes(results[results.length - 1]) < 1
    ) {
      throw staleSchedule();
    }
  } catch (error) {
    throw mapSchedulingDatabaseError(error);
  }
}

function approvedCoOrganizerInsertStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
  clubId: string,
  profileId: string,
  now: number,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO organizer_event_organizers (
         id, organization_id, organizer_event_id, profile_id,
         created_by_profile_id, created_at, deleted_at
       )
       SELECT ?, ?, ?, profile.id, ?, ?, NULL
       FROM profiles AS profile
       JOIN organization_memberships AS membership
         ON membership.organization_id = ?
        AND membership.profile_id = profile.id
        AND membership.status = 'active'
        AND membership.deleted_at IS NULL
       WHERE profile.id = ?
         AND profile.status = 'active'
         AND profile.deleted_at IS NULL
         AND (
           membership.role IN ('owner', 'administrator')
           OR EXISTS (
             SELECT 1
             FROM club_memberships AS club_membership
             WHERE club_membership.organization_id = ?
               AND club_membership.club_id = ?
               AND club_membership.organization_membership_id = membership.id
               AND club_membership.profile_id = profile.id
               AND club_membership.role = 'organizer'
               AND club_membership.status = 'active'
               AND club_membership.deleted_at IS NULL
           )
         )`,
    )
    .bind(
      `organizer-event-organizer:${crypto.randomUUID()}`,
      actor.organizationId,
      eventId,
      actor.profileId,
      now,
      actor.organizationId,
      profileId,
      actor.organizationId,
      clubId,
    );
}

async function commitProposedWrite(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  proposed: ProposedWrite,
  policy: Readonly<{
    id: string;
    mode: "block" | "require_admin_approval" | "warn_reason";
    version: number;
  }>,
  fingerprint: string,
  reason: string | null,
  reviewRequestId: string | null,
  now: number,
  approval?: Readonly<{
    decisionNote: string | null;
    decisionProfileId: string;
    requesterProfileId: string;
  }>,
): Promise<void> {
  const event = proposed.event;
  const intentId = `schedule-intent:${crypto.randomUUID()}`;
  const revisionId = `organizer-event-revision:${crypto.randomUUID()}`;
  const scopeJson = JSON.stringify(proposed.organizerScope);
  const interval = proposed.interval;
  const reserving =
    interval !== null &&
    (proposed.nextPlanningStatus === "confirmed" ||
      proposed.nextPlanningStatus === "tentative_hold");
  const statements: D1PreparedStatementLike[] = [];
  if (approval && reviewRequestId) {
    statements.push(
      database
        .prepare(
          `UPDATE organizer_conflict_review_requests AS review
           SET state = 'approved',
               decided_by_profile_id = ?,
               decided_at = ?,
               decision_note = ?,
               updated_at = ?
           WHERE review.id = ?
             AND review.organization_id = ?
             AND review.state = 'pending'
             AND review.state_fingerprint = ?
             AND review.policy_id = ?
             AND review.policy_version = ?
             AND review.requested_schedule_version = ?
             AND EXISTS (
               SELECT 1
               FROM organization_memberships AS membership
               JOIN profiles AS profile
                 ON profile.id = membership.profile_id
                AND profile.status = 'active'
                AND profile.deleted_at IS NULL
               WHERE membership.id = ?
                 AND membership.organization_id = review.organization_id
                 AND membership.profile_id = ?
                 AND membership.role IN ('owner', 'administrator')
                 AND membership.status = 'active'
                 AND membership.deleted_at IS NULL
             )
             AND (
               ? = 'owner'
               OR review.requester_profile_id <> ?
             )`,
        )
        .bind(
          approval.decisionProfileId,
          now,
          approval.decisionNote,
          now,
          reviewRequestId,
          actor.organizationId,
          fingerprint,
          policy.id,
          policy.version,
          proposed.nextScheduleVersion,
          actor.membershipId,
          actor.profileId,
          actor.role,
          actor.profileId,
        ),
    );
  }
  statements.push(
    ...scheduleContextInvalidationStatements(
      database,
      actor,
      event.id,
      reviewRequestId,
      now,
    ),
  );
  const preIntentCount = statements.length;
  const publicationOperation =
    publicationOperationForLifecycle(proposed);
  const publicationGuard = publicationOperation
    ? await prepareCanonicalEventPublicationMutationGuard(
        database,
        actor,
        event,
        {
          now,
          operation: publicationOperation,
          nextPublicationStatus: proposed.nextPublicationStatus,
          proposedContentVersion: proposed.nextContentVersion,
          proposedScheduleVersion: proposed.nextScheduleVersion,
          scheduleWriteIntentId: intentId,
        },
      )
    : null;
  statements.push(
    database
      .prepare(
        `INSERT INTO organizer_schedule_write_intents (
           id, organization_id, organizer_event_id, actor_profile_id, club_id,
           operation, planning_status, schedule_shape, actual_start_utc,
           actual_end_utc, expanded_start_utc, expanded_end_utc, timezone,
           all_day_start_date, all_day_end_date_exclusive,
           buffer_before_minutes, buffer_after_minutes, venue_id,
           primary_organizer_profile_id, organizer_scope_json,
           hold_expires_at,
           expected_content_version, expected_schedule_version,
           proposed_content_version, proposed_schedule_version, policy_id,
           policy_version, policy_mode, reason, review_request_id,
           state_fingerprint, created_at, completed_at
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, ?,
           NULL
         )`,
      )
      .bind(
        intentId,
        actor.organizationId,
        event.id,
        actor.profileId,
        event.clubId,
        proposed.action,
        proposed.nextPlanningStatus,
        event.scheduleShape,
        interval?.actualStartUtc ?? null,
        interval?.actualEndUtc ?? null,
        interval?.expandedStartUtc ?? null,
        interval?.expandedEndUtc ?? null,
        event.timeZone,
        event.allDayStartDate,
        event.allDayEndDateExclusive,
        event.bufferBeforeMinutes,
        event.bufferAfterMinutes,
        event.venueId,
        event.primaryOrganizerProfileId,
        scopeJson,
        proposed.holdExpiresAt,
        event.contentVersion,
        event.scheduleVersion,
        proposed.nextContentVersion,
        proposed.nextScheduleVersion,
        policy.id,
        policy.version,
        policy.mode,
        reason,
        reviewRequestId,
        fingerprint,
        now,
      ),
    ...(publicationGuard
      ? [
          publicationGuard.intentStatement,
          ...publicationGuard.preMutationStatements,
        ]
      : []),
    database
      .prepare(
        `UPDATE organizer_events AS event
         SET planning_status = ?,
             publication_status = ?,
             content_version = ?,
             schedule_version = ?,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE event.id = ?
           AND event.organization_id = ?
           AND event.content_version = ?
           AND event.schedule_version = ?
           AND event.publication_status = ?
           AND event.deleted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM organization_memberships AS membership
             JOIN profiles AS profile
               ON profile.id = membership.profile_id
              AND profile.status = 'active'
              AND profile.deleted_at IS NULL
             WHERE membership.id = ?
               AND membership.organization_id = event.organization_id
               AND membership.profile_id = ?
               AND membership.status = 'active'
               AND membership.deleted_at IS NULL
               AND (
                 membership.role IN ('owner', 'administrator')
                 OR (
                   membership.role = 'organizer'
                   AND EXISTS (
                     SELECT 1
                     FROM club_memberships AS club_membership
                     WHERE club_membership.organization_id =
                           event.organization_id
                       AND club_membership.club_id = event.club_id
                       AND club_membership.organization_membership_id =
                           membership.id
                       AND club_membership.profile_id = membership.profile_id
                       AND club_membership.role = 'organizer'
                       AND club_membership.status = 'active'
                       AND club_membership.deleted_at IS NULL
                   )
                   AND (
                     event.primary_organizer_profile_id =
                       membership.profile_id
                     OR EXISTS (
                       SELECT 1
                       FROM organizer_event_organizers AS association
                       WHERE association.organization_id =
                             event.organization_id
                         AND association.organizer_event_id = event.id
                         AND association.profile_id = membership.profile_id
                         AND association.deleted_at IS NULL
                     )
                   )
                 )
               )
           )`,
      )
      .bind(
        proposed.nextPlanningStatus,
        proposed.nextPublicationStatus,
        proposed.nextContentVersion,
        proposed.nextScheduleVersion,
        actor.profileId,
        now,
        event.id,
        actor.organizationId,
        event.contentVersion,
        event.scheduleVersion,
        event.publicationStatus,
        actor.membershipId,
        actor.profileId,
      ),
    reserving && approval && reviewRequestId
      ? adoptApprovedIncidentsStatement(
          database,
          actor,
          intentId,
          reviewRequestId,
          fingerprint,
          policy.id,
          policy.version,
          proposed.nextScheduleVersion,
          now,
        )
      : reserving
        ? incidentInsertStatement(
          database,
          actor,
          intentId,
          reviewRequestId,
          fingerprint,
          policy.id,
          policy.version,
          proposed.nextScheduleVersion,
          "open",
          now,
        )
        : database.prepare("SELECT 0 AS phase4_no_conflict_incident"),
    reserving
      ? database
      .prepare(
        `INSERT INTO organizer_conflict_overrides (
           id, organization_id, incident_id, organizer_event_id,
           conflicting_candidate_key, proposed_schedule_version,
           conflicting_schedule_version, policy_id, policy_version,
           state_fingerprint, reason, actor_profile_id,
           review_request_id, created_at, invalidated_at,
           invalidated_by_profile_id
         )
         SELECT 'conflict-override:' || lower(hex(randomblob(16))),
                incident.organization_id, incident.id,
                incident.organizer_event_id,
                incident.conflicting_candidate_key,
                incident.proposed_schedule_version,
                incident.conflicting_schedule_version,
                incident.policy_id, incident.policy_version,
                incident.state_fingerprint, ?, ?, ?, ?, NULL, NULL
         FROM organizer_conflict_incidents AS incident
         WHERE incident.organization_id = ?
           AND incident.write_intent_id = ?
           AND incident.proposed_schedule_version = ?`,
      )
      .bind(
        reason ?? "Approved conflict review",
        approval?.decisionProfileId ?? actor.profileId,
        reviewRequestId,
        now,
        actor.organizationId,
        intentId,
        proposed.nextScheduleVersion,
      )
      : database.prepare("SELECT 0 AS phase4_no_conflict_override"),
    database
      .prepare(
        `INSERT INTO organizer_event_revisions (
           id, organization_id, organizer_event_id, content_version,
           schedule_version, action, snapshot_json, actor_profile_id,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        revisionId,
        actor.organizationId,
        event.id,
        proposed.nextContentVersion,
        proposed.nextScheduleVersion,
        lifecycleRevisionAction(proposed.action),
        JSON.stringify({
          bufferAfterMinutes: event.bufferAfterMinutes,
          bufferBeforeMinutes: event.bufferBeforeMinutes,
          clubId: event.clubId,
          contentVersion: proposed.nextContentVersion,
          holdExpiresAt: proposed.holdExpiresAt,
          id: event.id,
          organizerScope: proposed.organizerScope,
          planningStatus: proposed.nextPlanningStatus,
          publicationStatus: proposed.nextPublicationStatus,
          scheduleShape: event.scheduleShape,
          scheduleVersion: proposed.nextScheduleVersion,
          timeZone: event.timeZone,
          venueId: event.venueId,
        }),
        actor.profileId,
        now,
      ),
    auditStatement(
      database,
      actor,
      event.id,
      `organizer_event.${proposed.action}`,
      {
        contentVersion: proposed.nextContentVersion,
        planningStatus: proposed.nextPlanningStatus,
        scheduleVersion: proposed.nextScheduleVersion,
      },
      now,
    ),
    ...scheduleNotificationStatements(
      database,
      actor,
      proposed,
      now,
    ),
    ...(approval && reviewRequestId
      ? [
          conflictNotificationStatement(database, actor, {
            directRecipientProfileId: approval.requesterProfileId,
            eventId: event.id,
            includeReviewers: false,
            now,
            sourceId: reviewRequestId,
            sourceKind: "review",
            type: "conflict_approved",
          }),
        ]
      : reserving && reason
        ? [
            conflictNotificationStatement(database, actor, {
              directRecipientProfileId: null,
              eventId: event.id,
              includeReviewers: false,
              now,
              sourceId: intentId,
              sourceKind: "intent",
              type: "conflict_created",
            }),
          ]
        : []),
    database
      .prepare(
        `UPDATE organizer_schedule_write_intents
         SET completed_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND organizer_event_id = ?
           AND completed_at IS NULL`,
      )
      .bind(now, intentId, actor.organizationId, event.id),
  );

  // The database reservation-state trigger requires the complete canonical
  // incident and override evidence to exist before the event can enter a
  // reserving state. Phase 5 additionally requires its intent plus any exact
  // old-job/public-state transition before the canonical mutation:
  // schedule intent -> publication intent/state -> incidents -> overrides ->
  // event -> finalization -> history -> publication seal -> schedule seal.
  const publicationPreludeCount = publicationGuard
    ? 1 + publicationGuard.preMutationStatements.length
    : 0;
  const eventOriginalIndex =
    preIntentCount + 1 + publicationPreludeCount;
  const [eventMutation] = statements.splice(eventOriginalIndex, 1);
  const eventIndex =
    preIntentCount + 1 + publicationPreludeCount + 2;
  statements.splice(eventIndex, 0, eventMutation);
  statements.splice(
    eventIndex + 1,
    0,
    reserving
      ? database
          .prepare(
            `UPDATE organizer_conflict_incidents
             SET state = 'approved',
                 updated_at = ?
             WHERE organization_id = ?
               AND write_intent_id = ?
               AND proposed_schedule_version = ?
               AND state = 'open'`,
          )
          .bind(
            now,
            actor.organizationId,
            intentId,
            proposed.nextScheduleVersion,
          )
      : database.prepare("SELECT 0 AS phase4_no_conflict_finalization"),
  );
  let publicationCompletionIndex: number | null = null;
  if (publicationGuard) {
    publicationCompletionIndex = statements.length - 1;
    statements.splice(
      publicationCompletionIndex,
      0,
      publicationGuard.completionStatement,
    );
  }

  try {
    const results = await database.batch(statements);
    const intentIndex = preIntentCount;
    const finalIndex = statements.length - 1;
    if (
      (approval && reviewRequestId && changes(results[0]) < 1) ||
      changes(results[intentIndex]) < 1 ||
      changes(results[eventIndex]) < 1 ||
      (publicationCompletionIndex !== null &&
        changes(results[publicationCompletionIndex]) < 1) ||
      changes(results[finalIndex]) < 1
    ) {
      throw staleSchedule();
    }
  } catch (error) {
    throw mapSchedulingDatabaseError(error);
  }
}

function scheduleContextInvalidationStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
  preservedReviewId: string | null,
  now: number,
): D1PreparedStatementLike[] {
  return [
    database
      .prepare(
        `UPDATE organizer_conflict_overrides AS override
         SET invalidated_at = ?,
             invalidated_by_profile_id = ?
         WHERE override.organization_id = ?
           AND override.invalidated_at IS NULL
           AND (
             override.organizer_event_id = ?
             OR EXISTS (
               SELECT 1
               FROM organizer_conflict_incidents AS incident
               WHERE incident.id = override.incident_id
                 AND incident.organization_id = override.organization_id
                 AND incident.conflicting_source_kind = 'manual'
                 AND incident.conflicting_event_id = ?
             )
           )
           AND (
             ? IS NULL
             OR override.review_request_id IS NOT ?
           )`,
      )
      .bind(
        now,
        actor.profileId,
        actor.organizationId,
        eventId,
        eventId,
        preservedReviewId,
        preservedReviewId,
      ),
    database
      .prepare(
        `UPDATE organizer_conflict_review_requests AS review
         SET state = 'invalidated',
             updated_at = ?
         WHERE review.organization_id = ?
           AND review.state = 'pending'
           AND review.id IS NOT ?
           AND (
             review.organizer_event_id = ?
             OR EXISTS (
               SELECT 1
               FROM organizer_conflict_incidents AS incident
               WHERE incident.organization_id = review.organization_id
                 AND incident.review_request_id = review.id
                 AND incident.conflicting_source_kind = 'manual'
                 AND incident.conflicting_event_id = ?
             )
           )`,
      )
      .bind(
        now,
        actor.organizationId,
        preservedReviewId,
        eventId,
        eventId,
      ),
    database
      .prepare(
        `UPDATE organizer_conflict_incidents
         SET state = 'invalidated',
             resolved_at = ?,
             updated_at = ?
         WHERE organization_id = ?
           AND state IN (
             'open', 'pending_approval', 'approved', 'rejected',
             'informational'
           )
           AND (
             ? IS NULL
             OR review_request_id IS NOT ?
           )
           AND (
             organizer_event_id = ?
             OR (
               conflicting_source_kind = 'manual'
               AND conflicting_event_id = ?
             )
           )`,
      )
      .bind(
        now,
        now,
        actor.organizationId,
        preservedReviewId,
        preservedReviewId,
        eventId,
        eventId,
      ),
  ];
}

async function createPendingScheduleEditReview(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  input: OrganizerScheduleEditGuardInput,
  conflicts: readonly ConflictFact[],
  policy: Readonly<{ id: string; version: number }>,
  fingerprint: string,
  reason: string,
  now: number,
): Promise<string> {
  const reviewId = `conflict-review:${crypto.randomUUID()}`;
  const scope = Object.freeze([...new Set(input.organizerScope)].sort());
  const requestedState = {
    action: "update_schedule",
    allDayEndDateExclusive: input.allDayEndDateExclusive,
    allDayStartDate: input.allDayStartDate,
    bufferAfterMinutes: input.bufferAfterMinutes,
    bufferBeforeMinutes: input.bufferBeforeMinutes,
    clubId: input.clubId,
    endsAtUtc: input.endsAtUtc,
    expectedContentVersion: input.expectedContentVersion,
    expectedScheduleVersion: input.expectedScheduleVersion,
    holdExpiresAt: input.holdExpiresAt,
    organizerScope: scope,
    planningStatus: input.planningStatus,
    primaryOrganizerProfileId: input.primaryOrganizerProfileId,
    proposedContentVersion: input.proposedContentVersion,
    proposedScheduleVersion: input.proposedScheduleVersion,
    scheduleShape: input.scheduleShape,
    startsAtUtc: input.startsAtUtc,
    timeZone: input.timeZone,
    venueId: input.venueId,
  };
  const statements: D1PreparedStatementLike[] = [
    database
      .prepare(
        `UPDATE organizer_conflict_review_requests
         SET state = 'invalidated',
             updated_at = ?
         WHERE organization_id = ?
           AND organizer_event_id = ?
           AND state = 'pending'`,
      )
      .bind(now, actor.organizationId, input.eventId),
    database
      .prepare(
        `UPDATE organizer_conflict_incidents
         SET state = 'invalidated',
             resolved_at = ?,
             updated_at = ?
         WHERE organization_id = ?
           AND organizer_event_id = ?
           AND state = 'pending_approval'`,
      )
      .bind(now, now, actor.organizationId, input.eventId),
    database
      .prepare(
        `INSERT INTO organizer_conflict_review_requests (
           id, organization_id, organizer_event_id,
           requested_planning_status, requested_schedule_version,
           state_fingerprint, requested_state_json, policy_id, policy_version,
           requester_profile_id, reason, state, decided_by_profile_id,
           decided_at, decision_note, created_at, updated_at
         )
         SELECT ?, event.organization_id, event.id, ?, ?, ?, ?, ?, ?, ?, ?,
                'pending', NULL, NULL, NULL, ?, ?
         FROM organizer_events AS event
         JOIN organization_memberships AS membership
           ON membership.id = ?
          AND membership.organization_id = event.organization_id
          AND membership.profile_id = ?
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
         JOIN profiles AS profile
           ON profile.id = membership.profile_id
          AND profile.status = 'active'
          AND profile.deleted_at IS NULL
         WHERE event.id = ?
           AND event.organization_id = ?
           AND event.content_version = ?
           AND event.schedule_version = ?
           AND event.planning_status = ?
           AND event.deleted_at IS NULL
           AND (
             membership.role IN ('owner', 'administrator')
             OR (
               membership.role = 'organizer'
               AND EXISTS (
                 SELECT 1
                 FROM club_memberships AS club_membership
                 WHERE club_membership.organization_id =
                       event.organization_id
                   AND club_membership.club_id = ?
                   AND club_membership.organization_membership_id =
                       membership.id
                   AND club_membership.profile_id = membership.profile_id
                   AND club_membership.role = 'organizer'
                   AND club_membership.status = 'active'
                   AND club_membership.deleted_at IS NULL
               )
               AND (
                 event.primary_organizer_profile_id = membership.profile_id
                 OR EXISTS (
                   SELECT 1
                   FROM organizer_event_organizers AS association
                   WHERE association.organization_id = event.organization_id
                     AND association.organizer_event_id = event.id
                     AND association.profile_id = membership.profile_id
                     AND association.deleted_at IS NULL
                 )
               )
             )
           )`,
      )
      .bind(
        reviewId,
        input.planningStatus,
        input.proposedScheduleVersion,
        fingerprint,
        JSON.stringify(requestedState),
        policy.id,
        policy.version,
        actor.profileId,
        reason,
        now,
        now,
        actor.membershipId,
        actor.profileId,
        input.eventId,
        actor.organizationId,
        input.expectedContentVersion,
        input.expectedScheduleVersion,
        input.planningStatus,
        input.clubId,
      ),
    ...pendingIncidentStatements(
      database,
      actor,
      input.eventId,
      conflicts,
      reviewId,
      policy,
      fingerprint,
      now,
    ),
    conflictNotificationStatement(database, actor, {
      directRecipientProfileId: null,
      eventId: input.eventId,
      includeReviewers: true,
      now,
      sourceId: reviewId,
      sourceKind: "review",
      type: "conflict_review_requested",
    }),
    auditStatement(
      database,
      actor,
      input.eventId,
      "conflict_review.schedule_edit_requested",
      {
        policyVersion: policy.version,
        proposedScheduleVersion: input.proposedScheduleVersion,
        requestedScheduleVersion: input.proposedScheduleVersion,
        reviewId,
      },
      now,
    ),
  ];
  try {
    const results = await database.batch(statements);
    if (
      changes(results[2]) < 1 ||
      changes(results[results.length - 1]) < 1
    ) {
      throw staleSchedule();
    }
  } catch (error) {
    throw mapSchedulingDatabaseError(error);
  }
  return reviewId;
}

async function createPendingReview(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  event: SchedulingEvent,
  proposed: ProposedWrite,
  conflicts: readonly ConflictFact[],
  policy: Readonly<{ id: string; version: number }>,
  fingerprint: string,
  reason: string,
  now: number,
): Promise<string> {
  const reviewId = `conflict-review:${crypto.randomUUID()}`;
  const requestedState = {
    action: proposed.action,
    clubId: event.clubId,
    conflictKeys: conflictKeys(conflicts),
    holdExpiresAt: proposed.holdExpiresAt,
    interval: proposed.interval,
    organizerScope: proposed.organizerScope,
    planningStatus: proposed.nextPlanningStatus,
    scheduleShape: event.scheduleShape,
    proposedScheduleVersion: proposed.nextScheduleVersion,
    expectedScheduleVersion: event.scheduleVersion,
    timeZone: event.timeZone,
    venueId: event.venueId,
  };
  const statements: D1PreparedStatementLike[] = [
    database
      .prepare(
        `UPDATE organizer_conflict_review_requests
         SET state = 'invalidated',
             updated_at = ?
         WHERE organization_id = ?
           AND organizer_event_id = ?
           AND state = 'pending'`,
      )
      .bind(now, actor.organizationId, event.id),
    database
      .prepare(
        `UPDATE organizer_conflict_incidents
         SET state = 'invalidated',
             updated_at = ?,
             resolved_at = ?
         WHERE organization_id = ?
           AND organizer_event_id = ?
           AND proposed_schedule_version = ?
           AND state IN (
             'open', 'pending_approval', 'approved', 'rejected',
             'informational'
           )`,
      )
      .bind(
        now,
        now,
        actor.organizationId,
        event.id,
        proposed.nextScheduleVersion,
      ),
    database
      .prepare(
        `INSERT INTO organizer_conflict_review_requests (
           id, organization_id, organizer_event_id,
           requested_planning_status, requested_schedule_version,
           state_fingerprint, requested_state_json, policy_id, policy_version,
           requester_profile_id, reason, state, decided_by_profile_id,
           decided_at, decision_note, created_at, updated_at
         )
         SELECT ?, event.organization_id, event.id, ?, ?, ?, ?, ?, ?, ?, ?,
                'pending', NULL, NULL, NULL, ?, ?
         FROM organizer_events AS event
         JOIN organization_memberships AS membership
           ON membership.id = ?
          AND membership.organization_id = event.organization_id
          AND membership.profile_id = ?
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
         JOIN profiles AS profile
           ON profile.id = membership.profile_id
          AND profile.status = 'active'
          AND profile.deleted_at IS NULL
         WHERE event.id = ?
           AND event.organization_id = ?
           AND event.content_version = ?
           AND event.schedule_version = ?
           AND event.planning_status IN ('idea', 'draft')
           AND event.publication_status IN ('private', 'unpublished')
           AND event.deleted_at IS NULL
           AND (
             membership.role IN ('owner', 'administrator')
             OR (
               membership.role = 'organizer'
               AND (
                 event.primary_organizer_profile_id = membership.profile_id
                 OR EXISTS (
                   SELECT 1 FROM organizer_event_organizers AS association
                   WHERE association.organization_id = event.organization_id
                     AND association.organizer_event_id = event.id
                     AND association.profile_id = membership.profile_id
                     AND association.deleted_at IS NULL
                 )
               )
             )
           )`,
      )
      .bind(
        reviewId,
        proposed.nextPlanningStatus,
        proposed.nextScheduleVersion,
        fingerprint,
        JSON.stringify(requestedState),
        policy.id,
        policy.version,
        actor.profileId,
        reason,
        now,
        now,
        actor.membershipId,
        actor.profileId,
        event.id,
        actor.organizationId,
        event.contentVersion,
        event.scheduleVersion,
      ),
    ...pendingIncidentStatements(
      database,
      actor,
      event.id,
      conflicts,
      reviewId,
      policy,
      fingerprint,
      now,
    ),
    conflictNotificationStatement(database, actor, {
      directRecipientProfileId: null,
      eventId: event.id,
      includeReviewers: true,
      now,
      sourceId: reviewId,
      sourceKind: "review",
      type: "conflict_review_requested",
    }),
    auditStatement(
      database,
      actor,
      event.id,
      "conflict_review.requested",
      {
        policyVersion: policy.version,
        proposedScheduleVersion: proposed.nextScheduleVersion,
        requestedScheduleVersion: proposed.nextScheduleVersion,
        reviewId,
      },
      now,
    ),
  ];
  try {
    const results = await database.batch(statements);
    if (
      changes(results[2]) < 1 ||
      changes(results[results.length - 1]) < 1
    ) {
      throw staleSchedule();
    }
  } catch (error) {
    throw mapSchedulingDatabaseError(error);
  }
  return reviewId;
}

function pendingIncidentStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
  conflicts: readonly ConflictFact[],
  reviewId: string,
  policy: Readonly<{ id: string; version: number }>,
  fingerprint: string,
  now: number,
): D1PreparedStatementLike[] {
  return conflicts.map((fact) =>
    database
      .prepare(
        `INSERT INTO organizer_conflict_incidents (
           id, organization_id, organizer_event_id,
           conflicting_candidate_key, conflicting_event_id,
           conflicting_source_kind, proposed_schedule_version,
           conflicting_schedule_version, policy_id, policy_version,
           classification, overlap_start_utc, overlap_end_utc,
           resources_json, state_fingerprint, state, write_intent_id,
           review_request_id, detected_by_profile_id, created_at, updated_at,
           resolved_at
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval',
           NULL, ?, ?, ?, ?, NULL
         )
         ON CONFLICT(
           organizer_event_id, proposed_schedule_version,
           conflicting_candidate_key, conflicting_schedule_version,
           classification
         ) DO UPDATE SET
           policy_id = excluded.policy_id,
           policy_version = excluded.policy_version,
           overlap_start_utc = excluded.overlap_start_utc,
           overlap_end_utc = excluded.overlap_end_utc,
           resources_json = excluded.resources_json,
           state_fingerprint = excluded.state_fingerprint,
           state = 'pending_approval',
           write_intent_id = NULL,
           review_request_id = excluded.review_request_id,
           detected_by_profile_id = excluded.detected_by_profile_id,
           updated_at = excluded.updated_at,
           resolved_at = NULL
         WHERE organizer_conflict_incidents.organization_id =
               excluded.organization_id
           AND organizer_conflict_incidents.state IN (
             'pending_approval', 'rejected', 'invalidated', 'resolved'
           )`,
      )
      .bind(
        `conflict-incident:${crypto.randomUUID()}`,
        actor.organizationId,
        eventId,
        fact.existingCandidateKey,
        fact.existingEventId,
        sourceKindFromCandidateKey(fact.existingCandidateKey),
        fact.proposedScheduleVersion,
        fact.existingScheduleVersion,
        policy.id,
        policy.version,
        fact.classification,
        fact.overlapStartUtc,
        fact.overlapEndUtc,
        JSON.stringify(fact.resources),
        fingerprint,
        reviewId,
        actor.profileId,
        now,
        now,
      ),
  );
}

function adoptApprovedIncidentsStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  intentId: string,
  reviewRequestId: string,
  fingerprint: string,
  policyId: string,
  policyVersion: number,
  proposedScheduleVersion: number,
  now: number,
): D1PreparedStatementLike {
  return database
    .prepare(
      `UPDATE organizer_conflict_incidents
       SET state = 'open',
           write_intent_id = ?,
           detected_by_profile_id = ?,
           updated_at = ?,
           resolved_at = NULL
       WHERE organization_id = ?
         AND review_request_id = ?
         AND organizer_event_id = (
           SELECT organizer_event_id
           FROM organizer_schedule_write_intents
           WHERE id = ?
             AND organization_id = ?
             AND completed_at IS NULL
         )
         AND proposed_schedule_version = ?
         AND policy_id = ?
         AND policy_version = ?
         AND state_fingerprint = ?
         AND state = 'pending_approval'
         AND EXISTS (
           SELECT 1
           FROM organization_memberships AS membership
           JOIN profiles AS profile
             ON profile.id = membership.profile_id
            AND profile.status = 'active'
            AND profile.deleted_at IS NULL
           WHERE membership.id = ?
             AND membership.organization_id = ?
             AND membership.profile_id = ?
             AND membership.role IN ('owner', 'administrator')
             AND membership.status = 'active'
             AND membership.deleted_at IS NULL
         )`,
    )
    .bind(
      intentId,
      actor.profileId,
      now,
      actor.organizationId,
      reviewRequestId,
      intentId,
      actor.organizationId,
      proposedScheduleVersion,
      policyId,
      policyVersion,
      fingerprint,
      actor.membershipId,
      actor.organizationId,
      actor.profileId,
    );
}

function publicationConflictAuthorizationStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  event: SchedulingEvent,
  conflicts: readonly ConflictFact[],
  intentId: string,
  policy: Readonly<{ id: string; version: number }>,
  fingerprint: string,
  authorization: Readonly<{
    reason: string | null;
    reviewRequestId: string | null;
  }>,
  now: number,
): readonly D1PreparedStatementLike[] {
  const authorizedConflictKeys = conflictKeys(conflicts);
  const conflictKeysJson = JSON.stringify(authorizedConflictKeys);
  return Object.freeze([
    database
      .prepare(
        `UPDATE organizer_conflict_overrides AS override
         SET invalidated_at = ?,
             invalidated_by_profile_id = ?
         WHERE override.organization_id = ?
           AND override.organizer_event_id = ?
           AND override.invalidated_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM organizer_conflict_incidents AS incident,
                  json_each(?) AS authorized_conflict
             WHERE incident.id = override.incident_id
               AND incident.organization_id =
                   override.organization_id
               AND incident.organizer_event_id =
                   override.organizer_event_id
               AND incident.proposed_schedule_version = ?
               AND incident.policy_id = ?
               AND incident.policy_version = ?
               AND incident.state_fingerprint = ?
               AND incident.state = 'approved'
               AND authorized_conflict.type = 'text'
               AND CAST(authorized_conflict.value AS TEXT) =
                   incident.conflicting_candidate_key || ':' ||
                   incident.conflicting_schedule_version || ':' ||
                   incident.classification
           )`,
      )
      .bind(
        now,
        actor.profileId,
        actor.organizationId,
        event.id,
        conflictKeysJson,
        event.scheduleVersion,
        policy.id,
        policy.version,
        fingerprint,
      ),
    incidentInsertStatement(
      database,
      actor,
      intentId,
      authorization.reviewRequestId,
      fingerprint,
      policy.id,
      policy.version,
      event.scheduleVersion,
      "open",
      now,
      authorizedConflictKeys,
      true,
      conflicts.length,
    ),
    database
      .prepare(
        `INSERT INTO organizer_conflict_overrides (
           id, organization_id, incident_id, organizer_event_id,
           conflicting_candidate_key, proposed_schedule_version,
           conflicting_schedule_version, policy_id, policy_version,
           state_fingerprint, reason, actor_profile_id, review_request_id,
           created_at, invalidated_at, invalidated_by_profile_id
         )
         SELECT 'conflict-override:' || lower(hex(randomblob(16))),
                incident.organization_id, incident.id,
                incident.organizer_event_id,
                incident.conflicting_candidate_key,
                incident.proposed_schedule_version,
                incident.conflicting_schedule_version,
                incident.policy_id, incident.policy_version,
                incident.state_fingerprint, ?, ?, ?, ?, NULL, NULL
         FROM organizer_conflict_incidents AS incident
         WHERE incident.organization_id = ?
           AND incident.organizer_event_id = ?
           AND incident.write_intent_id = ?
           AND incident.proposed_schedule_version = ?
           AND incident.policy_id = ?
           AND incident.policy_version = ?
           AND incident.state_fingerprint = ?
           AND incident.state = 'open'
           AND changes() = ?`,
      )
      .bind(
        authorization.reason ?? "Approved version-bound conflict review",
        actor.profileId,
        authorization.reviewRequestId,
        now,
        actor.organizationId,
        event.id,
        intentId,
        event.scheduleVersion,
        policy.id,
        policy.version,
        fingerprint,
        conflicts.length,
      ),
  ]);
}

function incidentInsertStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  intentId: string,
  reviewRequestId: string | null,
  fingerprint: string,
  policyId: string,
  policyVersion: number,
  proposedScheduleVersion: number,
  state: "informational" | "open",
  now: number,
  authorizedConflictKeys: readonly string[] | null = null,
  allowApprovedRebind = false,
  requiredPreviousChanges: number | null = null,
): D1PreparedStatementLike {
  const previousChangesFilter =
    requiredPreviousChanges === null
      ? ""
      : "AND changes() = ?";
  const authorizedConflictFilter =
    authorizedConflictKeys === null
      ? ""
      : String.raw`
       AND EXISTS (
         SELECT 1
         FROM json_each(?) AS authorized_conflict
         WHERE authorized_conflict.type = 'text'
           AND CAST(authorized_conflict.value AS TEXT) =
               collision.candidate_key || ':' ||
               collision.schedule_version || ':' ||
               collision.classification
       )`;
  const approvedRebindState = allowApprovedRebind
    ? ", 'approved'"
    : "";
  return database
    .prepare(
      `WITH candidate AS (
         SELECT 'manual:' || state.organizer_event_id AS candidate_key,
                state.organizer_event_id AS event_id,
                'manual' AS source_kind,
                state.schedule_version,
                state.actual_start_utc,
                state.actual_end_utc,
                state.expanded_start_utc,
                state.expanded_end_utc,
                state.venue_id,
                state.organizer_scope_json,
                event.primary_organizer_profile_id
         FROM organizer_reservation_states AS state
         JOIN organizer_events AS event
           ON event.id = state.organizer_event_id
          AND event.organization_id = state.organization_id
          AND event.deleted_at IS NULL
         WHERE state.organization_id = ?
           AND (
             state.planning_status = 'confirmed'
             OR (
               state.planning_status = 'tentative_hold'
               AND state.hold_expires_at >
                   CAST(unixepoch('subsec') * 1000 AS INTEGER)
             )
           )
         UNION ALL
         SELECT external.source_kind || ':' || external.id,
                external.event_id,
                external.source_kind,
                external.schedule_version,
                external.actual_start_utc,
                external.actual_end_utc,
                external.expanded_start_utc,
                external.expanded_end_utc,
                external.venue_id,
                external.organizer_scope_json,
                legacy.primary_organizer_profile_id
         FROM organizer_external_reservation_intervals AS external
         JOIN events AS legacy
           ON legacy.id = external.event_id
          AND legacy.organization_id = external.organization_id
         WHERE external.organization_id = ?
           AND external.planning_status <> 'cancelled'
           AND (
             external.source_kind = 'legacy'
             OR (
               external.source_kind = 'meetup'
               AND EXISTS (
                 SELECT 1
                 FROM sync_sources AS source
                 JOIN meetup_sync_generations AS generation
                   ON generation.id = source.active_generation_id
                  AND generation.sync_source_id = source.id
                  AND generation.state = 'published'
                 WHERE source.id = external.sync_source_id
                   AND source.organization_id = external.organization_id
                   AND source.active_generation_id = external.generation_id
                   AND source.enabled = 1
                   AND source.deleted_at IS NULL
               )
             )
           )
       ),
       proposed AS (
         SELECT intent.*,
                event.primary_organizer_profile_id AS proposed_primary
         FROM organizer_schedule_write_intents AS intent
         JOIN organizer_events AS event
           ON event.id = intent.organizer_event_id
          AND event.organization_id = intent.organization_id
         WHERE intent.id = ?
           AND intent.organization_id = ?
           AND intent.completed_at IS NULL
       ),
       collisions AS (
         SELECT candidate.*,
                CASE
                  WHEN proposed.actual_start_utc < candidate.actual_end_utc
                   AND proposed.actual_end_utc > candidate.actual_start_utc
                    THEN 'direct'
                  ELSE 'buffer'
                END AS classification,
                CASE
                  WHEN proposed.actual_start_utc < candidate.actual_end_utc
                   AND proposed.actual_end_utc > candidate.actual_start_utc
                    THEN max(proposed.actual_start_utc,
                             candidate.actual_start_utc)
                  ELSE max(proposed.expanded_start_utc,
                           candidate.expanded_start_utc)
                END AS overlap_start,
                CASE
                  WHEN proposed.actual_start_utc < candidate.actual_end_utc
                   AND proposed.actual_end_utc > candidate.actual_start_utc
                    THEN min(proposed.actual_end_utc,
                             candidate.actual_end_utc)
                  ELSE min(proposed.expanded_end_utc,
                           candidate.expanded_end_utc)
                END AS overlap_end,
                proposed.organizer_event_id,
                proposed.proposed_primary,
                proposed.organizer_scope_json AS proposed_scope_json,
                proposed.venue_id AS proposed_venue_id
         FROM candidate, proposed
         WHERE candidate.event_id <> proposed.organizer_event_id
           AND proposed.expanded_start_utc < candidate.expanded_end_utc
           AND proposed.expanded_end_utc > candidate.expanded_start_utc
       )
       INSERT INTO organizer_conflict_incidents (
         id, organization_id, organizer_event_id,
         conflicting_candidate_key, conflicting_event_id,
         conflicting_source_kind, proposed_schedule_version,
         conflicting_schedule_version, policy_id, policy_version,
         classification, overlap_start_utc, overlap_end_utc,
         resources_json, state_fingerprint, state, write_intent_id,
         review_request_id, detected_by_profile_id, created_at, updated_at,
         resolved_at
       )
       SELECT 'conflict-incident:' || lower(hex(randomblob(16))),
              ?, collision.organizer_event_id, collision.candidate_key,
              collision.event_id, collision.source_kind, ?,
              collision.schedule_version, ?, ?, collision.classification,
              collision.overlap_start, collision.overlap_end,
              (
                SELECT json_group_array(
                  json_object('type', resource_type,
                              'resourceId', resource_id)
                )
                FROM (
                  SELECT 0 AS rank, 'organization' AS resource_type,
                         ? AS resource_id
                  UNION ALL
                  SELECT 1,
                         CASE
                           WHEN proposed_scope.value =
                                  collision.proposed_primary
                            AND proposed_scope.value =
                                  collision.primary_organizer_profile_id
                             THEN 'primary_organizer'
                           ELSE 'co_organizer'
                         END,
                         proposed_scope.value
                  FROM json_each(collision.proposed_scope_json) AS proposed_scope
                  JOIN json_each(collision.organizer_scope_json) AS existing_scope
                    ON existing_scope.value = proposed_scope.value
                  UNION ALL
                  SELECT 3, 'venue', collision.proposed_venue_id
                  WHERE collision.proposed_venue_id IS NOT NULL
                    AND collision.proposed_venue_id = collision.venue_id
                  ORDER BY rank, resource_id
                )
              ),
              ?, ?, ?, ?, ?, ?, ?, NULL
       FROM collisions AS collision
       WHERE 1 = 1
       ${previousChangesFilter}
       ${authorizedConflictFilter}
       ON CONFLICT(
         organizer_event_id, proposed_schedule_version,
         conflicting_candidate_key, conflicting_schedule_version,
         classification
       ) DO UPDATE SET
         conflicting_event_id = excluded.conflicting_event_id,
         conflicting_source_kind = excluded.conflicting_source_kind,
         policy_id = excluded.policy_id,
         policy_version = excluded.policy_version,
         overlap_start_utc = excluded.overlap_start_utc,
         overlap_end_utc = excluded.overlap_end_utc,
         resources_json = excluded.resources_json,
         state_fingerprint = excluded.state_fingerprint,
         state = excluded.state,
         write_intent_id = excluded.write_intent_id,
         review_request_id = excluded.review_request_id,
         detected_by_profile_id = excluded.detected_by_profile_id,
         updated_at = excluded.updated_at,
         resolved_at = NULL
       WHERE organizer_conflict_incidents.organization_id =
             excluded.organization_id
         AND organizer_conflict_incidents.state IN (
           'pending_approval', 'rejected', 'invalidated', 'resolved',
           'informational'${approvedRebindState}
         )`,
    )
    .bind(
      actor.organizationId,
      actor.organizationId,
      intentId,
      actor.organizationId,
      actor.organizationId,
      proposedScheduleVersion,
      policyId,
      policyVersion,
      actor.organizationId,
      fingerprint,
      state,
      intentId,
      reviewRequestId,
      actor.profileId,
      now,
      now,
      ...(requiredPreviousChanges === null
        ? []
        : [requiredPreviousChanges]),
      ...(authorizedConflictKeys === null
        ? []
        : [JSON.stringify(authorizedConflictKeys)]),
    );
}

function proposeLifecycleWrite(
  event: SchedulingEvent,
  input: ActionInput,
  defaultHoldHours: number,
  now: number,
): ProposedWrite {
  const nextPlanningStatus = transitionForAction(event.planningStatus, input.action);
  const interval = conflictIntervalForEvent(event);
  if (
    (nextPlanningStatus === "tentative_hold" ||
      nextPlanningStatus === "confirmed") &&
    event.scheduleShape === "unscheduled"
  ) {
    throw validationError(
      "A tentative hold or confirmed event needs a timed or all-day schedule.",
    );
  }
  let holdExpiresAt: number | null = null;
  if (nextPlanningStatus === "tentative_hold") {
    const duration = input.holdDurationHours ?? defaultHoldHours;
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > 720) {
      throw validationError("Hold duration must be between 1 and 720 hours.");
    }
    holdExpiresAt = now + duration * 60 * 60_000;
  }
  if (
    input.action === "complete" &&
    interval !== null &&
    now < interval.actualEndUtc
  ) {
    throw new SafeApplicationError(
      "validation_failed",
      422,
      "A confirmed event can be completed only after its scheduled end.",
    );
  }
  return Object.freeze({
    action: input.action,
    event,
    holdExpiresAt,
    interval,
    nextContentVersion: event.contentVersion + 1,
    nextPlanningStatus,
    nextPublicationStatus: publicationStatusForLifecycle(
      event.publicationStatus,
      input.action,
    ),
    nextScheduleVersion: event.scheduleVersion + 1,
    organizerScope: Object.freeze(
      [...new Set([
        event.primaryOrganizerProfileId,
        ...event.coOrganizerProfileIds,
      ])].sort(),
    ),
    reason: input.reason,
  });
}

function publicationStatusForLifecycle(
  current: EventPublicationStatus,
  action: OrganizerLifecycleAction,
): EventPublicationStatus {
  if (action === "restore_cancelled") {
    return "unpublished";
  }
  if (action === "cancel") {
    return current === "scheduled" ? "unpublished" : current;
  }
  if (action === "archive" || action === "complete") {
    return current === "scheduled" || current === "published"
      ? action === "complete" && current === "published"
        ? "published"
        : "unpublished"
      : current;
  }
  return current;
}

function publicationOperationForLifecycle(
  proposed: ProposedWrite,
): CanonicalPublicationMutationOperation | null {
  const current = proposed.event.publicationStatus;
  if (proposed.action === "restore_cancelled") {
    return "restore_cancelled";
  }
  if (proposed.action === "cancel") {
    return current === "private" ? null : "public_cancel";
  }
  if (current === "private") return null;
  if (current === "scheduled") return "update_scheduled";
  if (current === "published") {
    return proposed.nextPublicationStatus === "unpublished"
      ? "unpublish"
      : "update_published";
  }
  return "update_unpublished";
}

function requestedStateFromReview(
  review: PendingReview,
  current: SchedulingEvent,
): ProposedWrite {
  const raw = review.requestedState;
  const planningStatus = parseEnum(
    raw.planningStatus,
    ["tentative_hold", "confirmed"] as const,
    "requestedState.planningStatus",
  );
  const intervalRaw =
    raw.interval === null ? null : parseObject(raw.interval, "requestedState.interval");
  const interval =
    intervalRaw === null
      ? null
      : Object.freeze({
          actualEndUtc: parseFiniteInteger(intervalRaw.actualEndUtc, {
            path: "requestedState.interval.actualEndUtc",
            minimum: 0,
          }),
          actualStartUtc: parseFiniteInteger(intervalRaw.actualStartUtc, {
            path: "requestedState.interval.actualStartUtc",
            minimum: 0,
          }),
          expandedEndUtc: parseFiniteInteger(intervalRaw.expandedEndUtc, {
            path: "requestedState.interval.expandedEndUtc",
            minimum: 0,
          }),
          expandedStartUtc: parseFiniteInteger(intervalRaw.expandedStartUtc, {
            path: "requestedState.interval.expandedStartUtc",
            minimum: 0,
          }),
        });
  const scope = parseStoredIdentifierList(raw.organizerScope);
  return Object.freeze({
    action: parseEnum(
      raw.action,
      ORGANIZER_LIFECYCLE_ACTIONS,
      "requestedState.action",
    ),
    event: current,
    holdExpiresAt:
      raw.holdExpiresAt === null
        ? null
        : parseFiniteInteger(raw.holdExpiresAt, {
            path: "requestedState.holdExpiresAt",
            minimum: 0,
          }),
    interval,
    nextContentVersion: current.contentVersion + 1,
    nextPlanningStatus: planningStatus,
    nextPublicationStatus: publicationStatusForLifecycle(
      current.publicationStatus,
      parseEnum(
        raw.action,
        ORGANIZER_LIFECYCLE_ACTIONS,
        "requestedState.action",
      ),
    ),
    nextScheduleVersion: review.requestedScheduleVersion,
    organizerScope: scope,
    reason: review.reason,
  });
}

function candidateFromProposed(proposed: ProposedWrite): ConflictCandidate {
  if (!proposed.interval) {
    throw validationError("This scheduling action requires a real schedule.");
  }
  const event = proposed.event;
  return Object.freeze({
    bufferAfterMinutes: event.bufferAfterMinutes,
    bufferBeforeMinutes: event.bufferBeforeMinutes,
    candidateKey: `manual:${event.id}`,
    clubId: event.clubId,
    eventId: event.id,
    holdExpiresAt: proposed.holdExpiresAt,
    interval: proposed.interval,
    organizationId: event.organizationId,
    organizerProfileIds: proposed.organizerScope,
    planningStatus: proposed.nextPlanningStatus,
    primaryOrganizerProfileId: event.primaryOrganizerProfileId,
    scheduleVersion: proposed.nextScheduleVersion,
    source: "manual",
    title: event.title,
    venueId: event.venueId,
  });
}

function conflictIntervalForEvent(
  event: SchedulingEvent,
): NormalizedConflictInterval | null {
  if (event.scheduleShape === "unscheduled") return null;
  if (event.scheduleShape === "timed") {
    if (event.startsAtUtc === null || event.endsAtUtc === null) {
      throw unavailable();
    }
    return normalizeConflictInterval({
      bufferAfterMinutes: event.bufferAfterMinutes,
      bufferBeforeMinutes: event.bufferBeforeMinutes,
      endUtc: event.endsAtUtc,
      startUtc: event.startsAtUtc,
    });
  }
  if (
    event.allDayStartDate === null ||
    event.allDayEndDateExclusive === null
  ) {
    throw unavailable();
  }
  return normalizeAllDayConflictInterval({
    bufferAfterMinutes: event.bufferAfterMinutes,
    bufferBeforeMinutes: event.bufferBeforeMinutes,
    endDateExclusive: event.allDayEndDateExclusive,
    startDate: event.allDayStartDate,
    timeZone: event.timeZone,
  });
}

function transitionForAction(
  current: Phase4PlanningStatus,
  action: OrganizerLifecycleAction,
): Phase4PlanningStatus {
  const next =
    action === "place_hold" || action === "extend_hold"
      ? "tentative_hold"
      : action === "release_hold"
        ? "draft"
        : action === "confirm"
          ? "confirmed"
          : action === "cancel"
            ? "cancelled"
            : action === "complete"
              ? "completed"
              : "archived";
  const allowed =
    (action === "place_hold" && (current === "idea" || current === "draft")) ||
    (action === "extend_hold" && current === "tentative_hold") ||
    (action === "release_hold" && current === "tentative_hold") ||
    (action === "confirm" &&
      (current === "idea" ||
        current === "draft" ||
        current === "tentative_hold")) ||
    (action === "cancel" &&
      (current === "tentative_hold" || current === "confirmed")) ||
    (action === "complete" && current === "confirmed") ||
    (action === "restore_cancelled" && current === "cancelled") ||
    (action === "archive" && current !== "archived");
  if (!allowed) {
    throw new SafeApplicationError(
      "validation_failed",
      422,
      "That lifecycle transition is not available from the current state.",
    );
  }
  return action === "restore_cancelled" ? "confirmed" : next;
}

function parseActionInput(value: unknown): ActionInput {
  const input = parseObject(value, "body");
  assertOnlyKeys(
    input,
    [
      "action",
      "expectedContentVersion",
      "expectedScheduleVersion",
      "holdDurationHours",
      "reason",
    ],
    "body",
  );
  return Object.freeze({
    action: parseEnum(input.action, ORGANIZER_LIFECYCLE_ACTIONS, "action"),
    expectedContentVersion: parseFiniteInteger(input.expectedContentVersion, {
      path: "expectedContentVersion",
      minimum: 1,
    }),
    expectedScheduleVersion: parseFiniteInteger(
      input.expectedScheduleVersion,
      { path: "expectedScheduleVersion", minimum: 1 },
    ),
    holdDurationHours:
      input.holdDurationHours === null ||
      input.holdDurationHours === undefined
        ? null
        : parseFiniteInteger(input.holdDurationHours, {
            path: "holdDurationHours",
            minimum: 1,
            maximum: 720,
          }),
    reason: parseOptionalBoundedString(input.reason, {
      path: "reason",
      maxLength: 1_000,
    }),
  });
}

async function requireSchedulingEvent(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
  includeDeleted: boolean,
): Promise<SchedulingEvent> {
  const row = await database
    .prepare(
      `${PHASE4_EVENT_SELECT}
       WHERE event.id = ?
         AND event.organization_id = ?
         AND (? = 1 OR event.deleted_at IS NULL)
       LIMIT 1`,
    )
    .bind(eventId, actor.organizationId, includeDeleted ? 1 : 0)
    .first<Record<string, unknown>>();
  if (!row) throw privateNotFound();
  return readSchedulingEvent(row);
}

async function authorizeSchedulingEdit(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  actor: AuthorizedMembership,
  event: SchedulingEvent,
): Promise<void> {
  await authorizeMembership(database, identity, { clubId: event.clubId });
  await authorizeSchedulingActorForEvent(database, actor, event);
}

async function authorizeSchedulingActorForEvent(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  event: SchedulingEvent,
): Promise<void> {
  const current = await database
    .prepare(
      `SELECT membership.role
       FROM organization_memberships AS membership
       JOIN profiles AS profile
         ON profile.id = membership.profile_id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
       JOIN clubs AS club
         ON club.id = ?
        AND club.organization_id = membership.organization_id
        AND club.deleted_at IS NULL
       WHERE membership.id = ?
         AND membership.organization_id = ?
         AND membership.profile_id = ?
         AND membership.role = ?
         AND membership.status = 'active'
         AND membership.deleted_at IS NULL
         AND (
           membership.role IN ('owner', 'administrator')
           OR EXISTS (
             SELECT 1
             FROM club_memberships AS club_membership
             WHERE club_membership.organization_id =
                   membership.organization_id
               AND club_membership.club_id = club.id
               AND club_membership.organization_membership_id =
                   membership.id
               AND club_membership.profile_id = membership.profile_id
               AND club_membership.role = 'organizer'
               AND club_membership.status = 'active'
               AND club_membership.deleted_at IS NULL
           )
         )
       LIMIT 1`,
    )
    .bind(
      event.clubId,
      actor.membershipId,
      actor.organizationId,
      actor.profileId,
      actor.role,
    )
    .first<Record<string, unknown>>();
  if (!current) throw privateNotFound();
  if (actor.role !== "organizer") return;
  if (
    actor.profileId !== event.primaryOrganizerProfileId &&
    !event.coOrganizerProfileIds.includes(actor.profileId)
  ) {
    throw privateNotFound();
  }
}

async function readOrganizerConflictPolicyForAuthorizedActor(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
): Promise<Readonly<{
  id: string;
  mode: "block" | "require_admin_approval" | "warn_reason";
  version: number;
}>> {
  const row = await database
    .prepare(
      `SELECT policy.id, policy.mode, policy.policy_version
       FROM organizer_conflict_policies AS policy
       WHERE policy.organization_id = ?
         AND EXISTS (
           SELECT 1
           FROM organization_memberships AS membership
           JOIN profiles AS profile
             ON profile.id = membership.profile_id
            AND profile.status = 'active'
            AND profile.deleted_at IS NULL
           WHERE membership.id = ?
             AND membership.organization_id = policy.organization_id
             AND membership.profile_id = ?
             AND membership.role = ?
             AND membership.status = 'active'
             AND membership.deleted_at IS NULL
         )
       LIMIT 1`,
    )
    .bind(
      actor.organizationId,
      actor.membershipId,
      actor.profileId,
      actor.role,
    )
    .first<Record<string, unknown>>();
  if (!row) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The conflict policy is unavailable.",
    );
  }
  const mode = requiredString(row.mode);
  if (
    mode !== "block" &&
    mode !== "require_admin_approval" &&
    mode !== "warn_reason"
  ) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The conflict policy is unavailable.",
    );
  }
  return Object.freeze({
    id: requiredString(row.id),
    mode,
    version: requiredInteger(row.policy_version),
  });
}

async function readScheduledEvent(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
  now: number,
): Promise<OrganizerScheduledEventDto> {
  const event = await requireSchedulingEvent(database, actor, eventId, true);
  const policyRow = await database
    .prepare(
      `SELECT nearing_expiry_hours
       FROM organizer_conflict_policies
       WHERE organization_id = ?
       LIMIT 1`,
    )
    .bind(actor.organizationId)
    .first<Record<string, unknown>>();
  const threshold =
    optionalInteger(policyRow?.nearing_expiry_hours) ?? 24;
  let holdState: OrganizerScheduledEventDto["holdState"] = null;
  if (
    event.planningStatus === "tentative_hold" &&
    event.holdExpiresAt !== null
  ) {
    holdState =
      event.holdExpiresAt <= now
        ? "expired"
        : event.holdExpiresAt - now <= threshold * 60 * 60_000
          ? "nearing_expiry"
          : "active";
  }
  return Object.freeze({
    contentVersion: event.contentVersion,
    holdExpiresAt: event.holdExpiresAt,
    holdState,
    id: event.id,
    planningStatus: event.planningStatus,
    publicationStatus: event.publicationStatus,
    scheduleVersion: event.scheduleVersion,
    title: event.title,
  });
}

type PendingReview = Readonly<{
  conflictKeys: readonly string[];
  eventId: string;
  policyId: string;
  policyVersion: number;
  reason: string;
  requestedScheduleVersion: number;
  requestedState: Record<string, unknown>;
  requesterProfileId: string;
  stateFingerprint: string;
}>;

async function readPendingReview(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  reviewId: string,
): Promise<PendingReview> {
  const row = await database
    .prepare(
      `SELECT review.organizer_event_id,
              review.requested_schedule_version,
              review.state_fingerprint,
              review.requested_state_json,
              review.policy_id,
              review.policy_version,
              review.requester_profile_id,
              review.reason,
              COALESCE((
                SELECT json_group_array(
                  incident.conflicting_candidate_key || ':' ||
                  incident.conflicting_schedule_version || ':' ||
                  incident.classification
                )
                FROM organizer_conflict_incidents AS incident
                WHERE incident.organization_id = review.organization_id
                  AND incident.review_request_id = review.id
              ), '[]') AS conflict_keys_json
       FROM organizer_conflict_review_requests AS review
       WHERE review.id = ?
         AND review.organization_id = ?
         AND review.state = 'pending'
       LIMIT 1`,
    )
    .bind(reviewId, actor.organizationId)
    .first<Record<string, unknown>>();
  if (!row) throw privateNotFound();
  const requestedState = parseStoredObject(row.requested_state_json);
  const conflictKeys = parseStoredStringList(row.conflict_keys_json);
  return Object.freeze({
    conflictKeys,
    eventId: requiredString(row.organizer_event_id),
    policyId: requiredString(row.policy_id),
    policyVersion: requiredInteger(row.policy_version),
    reason: requiredString(row.reason),
    requestedScheduleVersion: requiredInteger(row.requested_schedule_version),
    requestedState,
    requesterProfileId: requiredString(row.requester_profile_id),
    stateFingerprint: requiredString(row.state_fingerprint),
  });
}

function readSchedulingEvent(row: Record<string, unknown>): SchedulingEvent {
  const planningStatus = PHASE4_PLANNING_STATUSES.find(
    (status) => status === row.planning_status,
  );
  const scheduleShape =
    row.schedule_shape === "unscheduled" ||
    row.schedule_shape === "timed" ||
    row.schedule_shape === "all_day"
      ? row.schedule_shape
      : null;
  if (
    !planningStatus ||
    !scheduleShape ||
    !(
      row.publication_status === "private" ||
      row.publication_status === "scheduled" ||
      row.publication_status === "published" ||
      row.publication_status === "unpublished"
    )
  ) {
    throw unavailable();
  }
  return Object.freeze({
    allDayEndDateExclusive: optionalString(row.all_day_end_date_exclusive),
    allDayStartDate: optionalString(row.all_day_start_date),
    bufferAfterMinutes: requiredInteger(row.buffer_after_minutes),
    bufferBeforeMinutes: requiredInteger(row.buffer_before_minutes),
    clubId: requiredString(row.club_id),
    coOrganizerProfileIds: parseStoredStringList(
      row.co_organizer_profile_ids_json,
    ),
    contentVersion: requiredInteger(row.content_version),
    createdAt: requiredInteger(row.created_at),
    createdByProfileId: requiredString(row.created_by_profile_id),
    deletedAt: optionalInteger(row.deleted_at),
    endsAtUtc: optionalInteger(row.ends_at_utc),
    holdExpiresAt: optionalInteger(row.hold_expires_at),
    id: requiredString(row.id),
    organizationId: requiredString(row.organization_id),
    planningStatus,
    primaryOrganizerProfileId: requiredString(
      row.primary_organizer_profile_id,
    ),
    publicationStatus: row.publication_status,
    scheduleShape,
    scheduleVersion: requiredInteger(row.schedule_version),
    slug: requiredString(row.slug),
    startsAtUtc: optionalInteger(row.starts_at_utc),
    timeZone: requiredString(row.timezone),
    title: requiredString(row.title),
    venueId: optionalString(row.venue_id),
  });
}

type ConflictNotificationType =
  | "conflict_approved"
  | "conflict_created"
  | "conflict_rejected"
  | "conflict_review_requested";

/**
 * Adds one notification per directly affected active organizer and, for a new
 * approval request, each active Owner/Administrator reviewer. The recipient
 * set is derived from canonical D1 associations inside the caller's batch;
 * client-supplied identities never participate. Review reasons and private
 * event fields are deliberately absent from the allowlisted payload.
 */
function conflictNotificationStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  input: Readonly<{
    directRecipientProfileId: string | null;
    eventId: string;
    includeReviewers: boolean;
    now: number;
    sourceId: string;
    sourceKind: "intent" | "review";
    type: ConflictNotificationType;
  }>,
): D1PreparedStatementLike {
  const sourceColumn =
    input.sourceKind === "intent"
      ? "incident.write_intent_id"
      : "incident.review_request_id";
  return database
    .prepare(
      `INSERT OR IGNORE INTO notifications (
         id, organization_id, recipient_profile_id, type,
         payload_json, read_at, created_at, deleted_at
       )
       SELECT 'notification:' || lower(hex(randomblob(16))),
              ?, recipient_profile.id, ?,
              json_object('eventId', ?, 'title', substr(subject.title, 1, 160)),
              NULL, ?, NULL
       FROM organizer_events AS subject
       JOIN organization_memberships AS recipient_membership
         ON recipient_membership.organization_id = subject.organization_id
        AND recipient_membership.status = 'active'
        AND recipient_membership.deleted_at IS NULL
       JOIN profiles AS recipient_profile
         ON recipient_profile.id = recipient_membership.profile_id
        AND recipient_profile.status = 'active'
        AND recipient_profile.deleted_at IS NULL
       LEFT JOIN organizer_profile_preferences AS preference
         ON preference.organization_id = subject.organization_id
        AND preference.profile_id = recipient_profile.id
       WHERE subject.id = ?
         AND subject.organization_id = ?
         AND subject.deleted_at IS NULL
         AND recipient_profile.id <> ?
         AND COALESCE(
           preference.notification_preference_mode,
           'all_relevant'
         ) IN ('all_relevant', 'important_only')
         AND (
           subject.primary_organizer_profile_id = recipient_profile.id
           OR EXISTS (
             SELECT 1
             FROM organizer_event_organizers AS subject_association
             WHERE subject_association.organization_id =
                   subject.organization_id
               AND subject_association.organizer_event_id = subject.id
               AND subject_association.profile_id = recipient_profile.id
               AND subject_association.deleted_at IS NULL
           )
           OR EXISTS (
             SELECT 1
             FROM organizer_conflict_incidents AS incident
             JOIN organizer_events AS conflicting_event
               ON conflicting_event.organization_id =
                  incident.organization_id
              AND conflicting_event.id = incident.conflicting_event_id
              AND conflicting_event.deleted_at IS NULL
             WHERE incident.organization_id = ?
               AND ${sourceColumn} = ?
               AND incident.conflicting_source_kind = 'manual'
               AND (
                 conflicting_event.primary_organizer_profile_id =
                   recipient_profile.id
                 OR EXISTS (
                   SELECT 1
                   FROM organizer_event_organizers AS conflicting_association
                   WHERE conflicting_association.organization_id =
                         conflicting_event.organization_id
                     AND conflicting_association.organizer_event_id =
                         conflicting_event.id
                     AND conflicting_association.profile_id =
                         recipient_profile.id
                     AND conflicting_association.deleted_at IS NULL
                 )
               )
           )
           OR (
             ? = 1
             AND recipient_membership.role IN ('owner', 'administrator')
           )
           OR (
             ? IS NOT NULL
             AND recipient_profile.id = ?
           )
         )
         AND EXISTS (
           SELECT 1
           FROM organizer_conflict_incidents AS incident
           WHERE incident.organization_id = ?
             AND ${sourceColumn} = ?
         )`,
    )
    .bind(
      actor.organizationId,
      input.type,
      input.eventId,
      input.now,
      input.eventId,
      actor.organizationId,
      actor.profileId,
      actor.organizationId,
      input.sourceId,
      input.includeReviewers ? 1 : 0,
      input.directRecipientProfileId,
      input.directRecipientProfileId,
      actor.organizationId,
      input.sourceId,
    );
}

function scheduleNotificationStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  proposed: ProposedWrite,
  now: number,
): D1PreparedStatementLike[] {
  const type =
    proposed.nextPlanningStatus === "confirmed"
      ? "event_confirmed"
      : proposed.nextPlanningStatus === "cancelled"
        ? "event_cancelled"
        : "event_schedule_changed";
  return proposed.organizerScope
    .filter((profileId) => profileId !== actor.profileId)
    .map((profileId) =>
      prepareNotificationInsert(database, {
        organizationId: actor.organizationId,
        recipientProfileId: profileId,
        createdAt: now,
        payload: {
          type,
          eventId: proposed.event.id,
          title: proposed.event.title,
        },
      }),
    );
}

function auditStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
  action: string,
  metadata: Readonly<Record<string, number | string>>,
  now: number,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action, entity_type,
         entity_id, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, 'organizer_event', ?, ?, ?)`,
    )
    .bind(
      `audit:${crypto.randomUUID()}`,
      actor.organizationId,
      actor.profileId,
      action,
      eventId,
      JSON.stringify(metadata),
      now,
    );
}

async function schedulingFingerprint(
  value: Readonly<Record<string, unknown>>,
): Promise<string> {
  const encoded = new TextEncoder().encode(stableJson(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireConflictReason(value: string | null): string {
  if (!value || value.trim().length === 0) {
    throw conflictRefused(
      "A written coordination reason is required for this overlap.",
    );
  }
  return value.trim();
}

function conflictKeys(facts: readonly ConflictFact[]): readonly string[] {
  return Object.freeze(
    facts
      .map(
        (fact) =>
          `${fact.existingCandidateKey}:${fact.existingScheduleVersion}:${fact.classification}`,
      )
      .sort(),
  );
}

function sameConflictSet(
  facts: readonly ConflictFact[],
  expected: readonly string[],
): boolean {
  const actual = conflictKeys(facts);
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((value, index) => value === sortedExpected[index])
  );
}

async function requireExistingPublicationConflictAuthorization(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  event: SchedulingEvent,
  conflicts: readonly ConflictFact[],
  policy: Readonly<{
    id: string;
    mode: "block" | "require_admin_approval" | "warn_reason";
    version: number;
  }>,
  stateFingerprint: string,
): Promise<Readonly<{
  reason: string | null;
  reviewRequestId: string | null;
}>> {
  if (conflicts.length === 0) {
    return Object.freeze({ reason: null, reviewRequestId: null });
  }
  const result = await database
    .prepare(
      `SELECT incident.conflicting_candidate_key,
              incident.conflicting_schedule_version,
              incident.classification,
              override.reason,
              override.review_request_id,
              review.state AS review_state
       FROM organizer_conflict_incidents AS incident
       JOIN organizer_conflict_overrides AS override
         ON override.incident_id = incident.id
        AND override.organization_id = incident.organization_id
        AND override.invalidated_at IS NULL
        AND override.proposed_schedule_version =
            incident.proposed_schedule_version
        AND override.conflicting_schedule_version =
            incident.conflicting_schedule_version
        AND override.policy_id = incident.policy_id
        AND override.policy_version = incident.policy_version
        AND override.state_fingerprint = incident.state_fingerprint
       LEFT JOIN organizer_conflict_review_requests AS review
         ON review.id = override.review_request_id
        AND review.organization_id = override.organization_id
       WHERE incident.organization_id = ?
         AND incident.organizer_event_id = ?
         AND incident.proposed_schedule_version = ?
         AND incident.policy_id = ?
         AND incident.policy_version = ?
         AND incident.state_fingerprint = ?
         AND incident.state = 'approved'
       ORDER BY incident.conflicting_candidate_key,
                incident.conflicting_schedule_version,
                incident.classification
       LIMIT 501`,
    )
    .bind(
      actor.organizationId,
      event.id,
      event.scheduleVersion,
      policy.id,
      policy.version,
      stateFingerprint,
    )
    .all<Record<string, unknown>>();
  const rows = result.results ?? [];
  if (rows.length > 500) {
    throw conflictRefused(
      "The conflict authorization set is too large to verify safely.",
    );
  }
  const byKey = new Map<
    string,
    Readonly<{
      reason: string;
      reviewRequestId: string | null;
      reviewState: string | null;
    }>
  >();
  for (const row of rows) {
    const key = `${requiredString(row.conflicting_candidate_key)}:${requiredInteger(
      row.conflicting_schedule_version,
    )}:${requiredString(row.classification)}`;
    byKey.set(
      key,
      Object.freeze({
        reason: requiredString(row.reason),
        reviewRequestId: optionalString(row.review_request_id),
        reviewState: optionalString(row.review_state),
      }),
    );
  }
  const requiredKeys = conflictKeys(conflicts);
  if (!requiredKeys.every((key) => byKey.has(key))) {
    throw conflictRefused(
      "This event needs a current version-bound conflict review before it can be published.",
    );
  }
  if (policy.mode === "warn_reason") {
    const reason = byKey.get(requiredKeys[0])?.reason.trim();
    if (!reason) {
      throw conflictRefused(
        "This event needs a current written conflict reason before it can be published.",
      );
    }
    return Object.freeze({ reason, reviewRequestId: null });
  }
  const reviewIds = new Set(
    requiredKeys.map((key) => {
      const authorization = byKey.get(key);
      return authorization?.reviewState === "approved"
        ? authorization.reviewRequestId
        : null;
    }),
  );
  if (
    reviewIds.size !== 1 ||
    reviewIds.has(null)
  ) {
    throw conflictRefused(
      "This event needs one current Administrator approval before it can be published.",
    );
  }
  return Object.freeze({
    reason: "Approved version-bound conflict review",
    reviewRequestId: [...reviewIds][0] ?? null,
  });
}

function sourceKindFromCandidateKey(
  key: string,
): "legacy" | "manual" | "meetup" {
  if (key.startsWith("manual:")) return "manual";
  if (key.startsWith("meetup:")) return "meetup";
  return "legacy";
}

function lifecycleRevisionAction(
  action: OrganizerLifecycleAction,
): "updated" {
  // Phase 3's revision action constraint uses the broad `updated` value;
  // the exact lifecycle operation remains in the append-only audit action.
  void action;
  return "updated";
}

export function mapSchedulingDatabaseError(error: unknown): Error {
  const message =
    error instanceof Error
      ? `${error.message} ${String(
          (error as Error & { cause?: unknown }).cause ?? "",
        )}`
      : String(error);
  if (
    /phase4_intent_version_mismatch|phase4_review_stale|phase4_intent_finalization_mismatch|phase4_reservation_state_identity_immutable/iu.test(
      message,
    )
  ) {
    return staleSchedule();
  }
  if (/phase4_hold_expired/iu.test(message)) {
    return new SafeApplicationError(
      "conflict",
      409,
      "The hold has expired. Refresh and run a new authoritative check.",
    );
  }
  if (/phase4_complete_before_end/iu.test(message)) {
    return new SafeApplicationError(
      "validation_failed",
      422,
      "A confirmed event cannot be completed before its scheduled end.",
    );
  }
  if (/phase4_conflict_reason_required/iu.test(message)) {
    return conflictRefused(
      "A written coordination reason is required for this overlap.",
    );
  }
  if (/phase4_conflict_approval_required/iu.test(message)) {
    return conflictRefused(
      "This overlap requires a new Administrator approval request.",
    );
  }
  if (/phase4_conflict_blocked|phase4_source_activation_conflict/iu.test(message)) {
    return conflictRefused(
      "The authoritative D1 conflict guard refused this reservation.",
    );
  }
  if (
    /phase4_intent_actor_forbidden|phase4_event_actor_forbidden|phase4_review_forbidden|phase4_policy_update_forbidden|phase4_reservation_state_delete_forbidden|phase4_external_reservation_active/iu.test(
      message,
    )
  ) {
    return new SafeApplicationError(
      "authorization_denied",
      403,
      "This scheduling action is not authorized.",
    );
  }
  if (
    /phase4_intent_reference_mismatch|phase4_event_lifecycle_forbidden|phase4_override_mismatch|phase4_event_write_intent_required|phase4_reservation_state_mismatch|phase4_conflict_authorization_required|phase4_source_activation_mismatch|phase4_external_reservation_mismatch/iu.test(
      message,
    )
  ) {
    return conflictRefused(
      "The authoritative scheduling state changed. Refresh before trying again.",
    );
  }
  return error instanceof Error
    ? error
    : new Error("The scheduling write failed.");
}

function parseStoredObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") throw unavailable();
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("invalid object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw unavailable();
  }
}

function parseStoredStringList(value: unknown): readonly string[] {
  if (typeof value !== "string") throw unavailable();
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      throw new TypeError("invalid list");
    }
    return Object.freeze([...new Set(parsed)].sort());
  } catch {
    throw unavailable();
  }
}

function parseStoredIdentifierList(value: unknown): readonly string[] {
  return Object.freeze(
    parseStoredStringList(JSON.stringify(value)).map((item, index) =>
      parseIdentifier(item, `requestedState.organizerScope.${index}`),
    ),
  );
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw unavailable();
  return value;
}

function optionalString(value: unknown): string | null {
  return value === null || value === undefined ? null : requiredString(value);
}

function requiredInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw unavailable();
  }
  return value;
}

function optionalInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : requiredInteger(value);
}

function changes(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const meta = Reflect.get(result, "meta");
  if (!meta || typeof meta !== "object") return 0;
  const count = Reflect.get(meta, "changes");
  return typeof count === "number" ? count : 0;
}

function staleSchedule(): SafeApplicationError {
  return new SafeApplicationError(
    "stale_edit",
    409,
    "The event schedule changed in another session. Your action was not applied.",
  );
}

function staleReview(): SafeApplicationError {
  return new SafeApplicationError(
    "conflict",
    409,
    "This review no longer matches the current schedule and must be requested again.",
  );
}

function conflictRefused(message: string): SafeApplicationError {
  return new SafeApplicationError("conflict", 409, message);
}

function validationError(message: string): SafeApplicationError {
  return new SafeApplicationError("validation_failed", 422, message);
}

function privateNotFound(): SafeApplicationError {
  return new SafeApplicationError(
    "not_found",
    404,
    "The private event or review could not be found.",
  );
}

function unavailable(): SafeApplicationError {
  return new SafeApplicationError(
    "service_unavailable",
    503,
    "The authoritative scheduling data is unavailable.",
  );
}
