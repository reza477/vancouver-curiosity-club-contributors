import {
  authorizeMembership,
  type AuthorizedMembership,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  assertOnlyKeys,
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  parseObject,
} from "../../validation";
import {
  normalizeAllDayEventRange,
  normalizeTimedEventRange,
  parseIanaTimeZone,
} from "../../time";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  findConflictFacts,
  normalizeAllDayConflictInterval,
  normalizeConflictInterval,
  PHASE4_PLANNING_STATUSES,
  type ConflictCandidate,
  type ConflictFact,
  type NormalizedConflictInterval,
  type Phase4PlanningStatus,
} from "./conflict-domain";

type CandidateRecord = Readonly<{
  candidate: ConflictCandidate;
  clubName: string;
  organizerName: string;
  organizerNames: Readonly<Record<string, string>>;
  readOnly: boolean;
  sourceLabel: string;
  timeZone: string;
}>;

export type ConflictPreviewItemDto = Readonly<{
  classification: "buffer" | "direct";
  clubName: string;
  eventId: string;
  id: string;
  organizerName: string;
  overlapLabel: string;
  planningStatus: string;
  readOnly: boolean;
  resources: readonly Readonly<{
    label: string;
    type: "co_organizer" | "organization" | "organizer" | "venue";
  }>[];
  scheduleLabel: string;
  sourceLabel: string;
  title: string;
}>;

export type ConflictCenterItemDto = Readonly<{
  activity: readonly Readonly<{ id: string; label: string; timeLabel: string }>[];
  allowedActions: readonly Readonly<{
    eventId: string | null;
    expectedContentVersion: number | null;
    expectedScheduleVersion: number | null;
    kind:
      | "approve"
      | "cancel"
      | "change_time"
      | "edit"
      | "mark_reviewed"
      | "reject";
  }>[];
  classification: "buffer" | "direct";
  eventA: ConflictCenterEventDto;
  eventB: ConflictCenterEventDto;
  groupDate: string;
  id: string;
  overlapLabel: string;
  reason: string | null;
  resources: readonly Readonly<{ label: string; type: string }>[];
  state:
    | "approved"
    | "invalidated"
    | "open"
    | "pending"
    | "rejected"
    | "resolved"
    | "warning";
}>;

type ConflictCenterEventDto = Readonly<{
  clubName: string;
  eventId: string;
  organizerName: string;
  planningStatus: string;
  readOnly: boolean;
  scheduleLabel: string;
  title: string;
}>;

type ProposedConflictState = Readonly<{
  bufferAfterMinutes: number;
  bufferBeforeMinutes: number;
  candidate: ConflictCandidate;
}>;

const CANDIDATE_SELECT_SQL = `
SELECT candidate.candidate_key,
       candidate.event_id,
       candidate.club_id,
       candidate.club_name,
       candidate.planning_status,
       candidate.actual_start_utc,
       candidate.actual_end_utc,
       candidate.expanded_start_utc,
       candidate.expanded_end_utc,
       candidate.timezone,
       candidate.venue_id,
       candidate.organizer_scope_json,
       candidate.primary_organizer_profile_id,
       candidate.schedule_version,
       candidate.hold_expires_at,
       candidate.title,
       candidate.source,
       candidate.source_label,
       candidate.read_only,
       candidate.organizer_name,
       candidate.organizer_names_json
FROM (
  SELECT 'manual:' || state.organizer_event_id AS candidate_key,
         state.organizer_event_id AS event_id,
         state.club_id,
         club.name AS club_name,
         state.planning_status,
         state.actual_start_utc,
         state.actual_end_utc,
         state.expanded_start_utc,
         state.expanded_end_utc,
         state.timezone,
         state.venue_id,
         state.organizer_scope_json,
         event.primary_organizer_profile_id,
         state.schedule_version,
         state.hold_expires_at,
         event.title,
         'manual' AS source,
         'Manual event' AS source_label,
         0 AS read_only,
         COALESCE(primary_profile.display_name, 'Organizer not listed')
           AS organizer_name,
         COALESCE((
           SELECT json_group_object(profile.id, profile.display_name)
           FROM profiles AS profile
           WHERE profile.id IN (
             SELECT value
             FROM json_each(state.organizer_scope_json)
           )
         ), '{}') AS organizer_names_json
  FROM organizer_reservation_states AS state
  JOIN organizer_events AS event
    ON event.id = state.organizer_event_id
   AND event.organization_id = state.organization_id
   AND event.deleted_at IS NULL
  JOIN clubs AS club
    ON club.id = state.club_id
   AND club.organization_id = state.organization_id
   AND club.deleted_at IS NULL
  LEFT JOIN profiles AS primary_profile
    ON primary_profile.id = event.primary_organizer_profile_id
  WHERE state.organization_id = ?
    AND state.expanded_start_utc < ?
    AND state.expanded_end_utc > ?
    AND (
      ? = 1
      OR state.planning_status = 'confirmed'
      OR (
        state.planning_status = 'tentative_hold'
        AND state.hold_expires_at >
            CAST(unixepoch('subsec') * 1000 AS INTEGER)
      )
    )

  UNION ALL

  SELECT external.source_kind || ':' || external.id AS candidate_key,
         external.event_id,
         external.club_id,
         club.name AS club_name,
         CASE
           WHEN external.planning_status IN ('tentative', 'hold')
             THEN 'tentative_hold'
           WHEN external.planning_status = 'cancelled' THEN 'cancelled'
           ELSE 'confirmed'
         END AS planning_status,
         external.actual_start_utc,
         external.actual_end_utc,
         external.expanded_start_utc,
         external.expanded_end_utc,
         external.timezone,
         external.venue_id,
         external.organizer_scope_json,
         legacy.primary_organizer_profile_id,
         external.schedule_version,
         external.hold_expires_at,
         external.title,
         external.source_kind AS source,
         CASE external.source_kind
           WHEN 'meetup' THEN 'Meetup'
           ELSE 'Read-only legacy event'
         END AS source_label,
         1 AS read_only,
         COALESCE(primary_profile.display_name, 'Organizer not listed')
           AS organizer_name,
         COALESCE((
           SELECT json_group_object(profile.id, profile.display_name)
           FROM profiles AS profile
           WHERE profile.id IN (
             SELECT value
             FROM json_each(external.organizer_scope_json)
           )
         ), '{}') AS organizer_names_json
  FROM organizer_external_reservation_intervals AS external
  JOIN events AS legacy
    ON legacy.id = external.event_id
   AND legacy.organization_id = external.organization_id
  JOIN clubs AS club
    ON club.id = external.club_id
   AND club.organization_id = external.organization_id
   AND club.deleted_at IS NULL
  LEFT JOIN profiles AS primary_profile
    ON primary_profile.id = legacy.primary_organizer_profile_id
  WHERE external.organization_id = ?
    AND external.expanded_start_utc < ?
    AND external.expanded_end_utc > ?
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
) AS candidate
ORDER BY candidate.actual_start_utc, candidate.candidate_key
LIMIT 501`;

export async function previewOrganizerConflicts(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  value: unknown,
): Promise<readonly ConflictPreviewItemDto[]> {
  const input = parsePreviewInput(value);
  const actor = await authorizeMembership(database, identity, {
    clubId: input.candidate.clubId,
  });
  const proposed = Object.freeze({
    ...input.candidate,
    organizationId: actor.organizationId,
  });
  await validateProposedReferences(database, actor, proposed);
  const now = await currentD1Time(database);
  const records = await loadCandidateRecords(
    database,
    actor.organizationId,
    input.candidate.interval,
    true,
  );
  const facts = allCollisionFacts(proposed, records, now);
  return Object.freeze(
    facts.slice(0, 100).map(({ fact, record }) =>
      previewItem(proposed, fact, record),
    ),
  );
}

export async function listOrganizerConflictCenter(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
): Promise<readonly ConflictCenterItemDto[]> {
  const actor = await authorizeMembership(database, identity);
  const result = await database
    .prepare(
      `SELECT incident.id,
              incident.review_request_id,
              incident.conflicting_event_id,
              incident.conflicting_source_kind,
              incident.classification,
              incident.overlap_start_utc,
              incident.overlap_end_utc,
              incident.resources_json,
              incident.state,
              incident.created_at,
              incident.updated_at,
              event_a.id AS event_a_id,
              event_a.title AS event_a_title,
              event_a.planning_status AS event_a_status,
              event_a.content_version AS event_a_content_version,
              event_a.schedule_version AS event_a_schedule_version,
              CASE
                WHEN ? IN ('owner', 'administrator')
                  OR event_a.primary_organizer_profile_id = ?
                  OR EXISTS (
                    SELECT 1
                    FROM organizer_event_organizers AS editable_scope_a
                    WHERE editable_scope_a.organization_id =
                          incident.organization_id
                      AND editable_scope_a.organizer_event_id = event_a.id
                      AND editable_scope_a.profile_id = ?
                      AND editable_scope_a.deleted_at IS NULL
                  )
                THEN 1 ELSE 0
              END AS actor_can_edit_a,
              state_a.actual_start_utc AS event_a_start,
              state_a.actual_end_utc AS event_a_end,
              state_a.timezone AS event_a_timezone,
              club_a.name AS event_a_club,
              COALESCE(profile_a.display_name, 'Organizer not listed')
                AS event_a_organizer,
              COALESCE(
                event_b.title,
                CASE
                  WHEN incident.conflicting_source_kind = 'legacy'
                    THEN external_referenced.title
                  WHEN external_current.id IS NOT NULL
                    THEN external_current.title
                  WHEN incident.state IN (
                    'invalidated', 'rejected', 'resolved'
                  )
                    THEN external_referenced.title
                END,
                'Read-only event'
              ) AS event_b_title,
              event_b.content_version AS event_b_content_version,
              event_b.schedule_version AS event_b_schedule_version,
              CASE
                WHEN event_b.id IS NOT NULL
                 AND (
                   ? IN ('owner', 'administrator')
                   OR event_b.primary_organizer_profile_id = ?
                   OR EXISTS (
                     SELECT 1
                     FROM organizer_event_organizers AS editable_scope_b
                     WHERE editable_scope_b.organization_id =
                           incident.organization_id
                       AND editable_scope_b.organizer_event_id = event_b.id
                       AND editable_scope_b.profile_id = ?
                       AND editable_scope_b.deleted_at IS NULL
                   )
                 )
                THEN 1 ELSE 0
              END AS actor_can_edit_b,
              COALESCE(
                event_b.planning_status,
                CASE
                  WHEN incident.conflicting_source_kind = 'legacy'
                    THEN external_referenced.planning_status
                  WHEN external_current.id IS NOT NULL
                    THEN external_current.planning_status
                  WHEN incident.state IN (
                    'invalidated', 'rejected', 'resolved'
                  )
                    THEN external_referenced.planning_status
                END,
                'confirmed'
              ) AS event_b_status,
              CASE WHEN event_b.id IS NULL THEN 1 ELSE 0 END
                AS event_b_read_only,
              COALESCE(
                state_b.actual_start_utc,
                CASE
                  WHEN incident.conflicting_source_kind = 'legacy'
                    THEN external_referenced.actual_start_utc
                  WHEN external_current.id IS NOT NULL
                    THEN external_current.actual_start_utc
                  WHEN incident.state IN (
                    'invalidated', 'rejected', 'resolved'
                  )
                    THEN external_referenced.actual_start_utc
                END
              ) AS event_b_start,
              COALESCE(
                state_b.actual_end_utc,
                CASE
                  WHEN incident.conflicting_source_kind = 'legacy'
                    THEN external_referenced.actual_end_utc
                  WHEN external_current.id IS NOT NULL
                    THEN external_current.actual_end_utc
                  WHEN incident.state IN (
                    'invalidated', 'rejected', 'resolved'
                  )
                    THEN external_referenced.actual_end_utc
                END
              ) AS event_b_end,
              COALESCE(
                state_b.timezone,
                CASE
                  WHEN incident.conflicting_source_kind = 'legacy'
                    THEN external_referenced.timezone
                  WHEN external_current.id IS NOT NULL
                    THEN external_current.timezone
                  WHEN incident.state IN (
                    'invalidated', 'rejected', 'resolved'
                  )
                    THEN external_referenced.timezone
                END,
                'America/Vancouver'
              ) AS event_b_timezone,
              COALESCE(club_b.name, club_external.name, 'Unknown club')
                AS event_b_club,
              COALESCE(profile_b.display_name, profile_external.display_name,
                       'Organizer not listed') AS event_b_organizer,
              review.requester_profile_id,
              review.reason AS review_reason,
              override.reason AS override_reason
       FROM organizer_conflict_incidents AS incident
       JOIN organizer_events AS event_a
         ON event_a.id = incident.organizer_event_id
        AND event_a.organization_id = incident.organization_id
       JOIN clubs AS club_a
         ON club_a.id = event_a.club_id
        AND club_a.organization_id = incident.organization_id
       LEFT JOIN organizer_reservation_states AS state_a
         ON state_a.organizer_event_id = event_a.id
       LEFT JOIN profiles AS profile_a
         ON profile_a.id = event_a.primary_organizer_profile_id
       LEFT JOIN organizer_events AS event_b
         ON incident.conflicting_source_kind = 'manual'
        AND event_b.id = incident.conflicting_event_id
        AND event_b.organization_id = incident.organization_id
       LEFT JOIN organizer_reservation_states AS state_b
         ON state_b.organizer_event_id = event_b.id
       LEFT JOIN clubs AS club_b
         ON club_b.id = event_b.club_id
        AND club_b.organization_id = incident.organization_id
       LEFT JOIN profiles AS profile_b
         ON profile_b.id = event_b.primary_organizer_profile_id
       LEFT JOIN organizer_external_reservation_intervals
         AS external_referenced
         ON incident.conflicting_candidate_key =
              external_referenced.source_kind || ':' ||
              external_referenced.id
        AND external_referenced.event_id = incident.conflicting_event_id
        AND external_referenced.organization_id =
            incident.organization_id
        AND external_referenced.source_kind =
            incident.conflicting_source_kind
        AND external_referenced.schedule_version =
            incident.conflicting_schedule_version
       LEFT JOIN organizer_external_reservation_intervals
         AS external_current
         ON external_current.id = (
          SELECT current_interval.id
          FROM organizer_external_reservation_intervals
            AS current_interval
          JOIN sync_sources AS active_source
            ON active_source.id = current_interval.sync_source_id
           AND active_source.organization_id =
               current_interval.organization_id
           AND active_source.active_generation_id =
               current_interval.generation_id
           AND active_source.enabled = 1
           AND active_source.deleted_at IS NULL
          JOIN meetup_sync_generations AS active_generation
            ON active_generation.id =
               active_source.active_generation_id
           AND active_generation.organization_id =
               active_source.organization_id
           AND active_generation.sync_source_id =
               active_source.id
           AND active_generation.state = 'published'
          WHERE external_referenced.source_kind = 'meetup'
            AND current_interval.source_kind = 'meetup'
            AND current_interval.organization_id =
                external_referenced.organization_id
            AND current_interval.sync_source_id =
                external_referenced.sync_source_id
            AND current_interval.event_id =
                external_referenced.event_id
            AND current_interval.schedule_version =
                incident.conflicting_schedule_version
            AND current_interval.reservation_semantic_fingerprint =
                external_referenced.reservation_semantic_fingerprint
          ORDER BY current_interval.id
          LIMIT 1
        )
       LEFT JOIN clubs AS club_external
         ON club_external.id = CASE
              WHEN incident.conflicting_source_kind = 'legacy'
                THEN external_referenced.club_id
              WHEN external_current.id IS NOT NULL
                THEN external_current.club_id
              WHEN incident.state IN (
                'invalidated', 'rejected', 'resolved'
              )
                THEN external_referenced.club_id
            END
        AND club_external.organization_id = incident.organization_id
       LEFT JOIN profiles AS profile_external
         ON profile_external.id = CASE
              WHEN incident.conflicting_source_kind = 'legacy'
                THEN external_referenced.primary_organizer_profile_id
              WHEN external_current.id IS NOT NULL
                THEN external_current.primary_organizer_profile_id
              WHEN incident.state IN (
                'invalidated', 'rejected', 'resolved'
              )
                THEN external_referenced.primary_organizer_profile_id
            END
       LEFT JOIN organizer_conflict_review_requests AS review
         ON review.id = incident.review_request_id
        AND review.organization_id = incident.organization_id
       LEFT JOIN organizer_conflict_overrides AS override
         ON override.incident_id = incident.id
        AND override.organization_id = incident.organization_id
        AND override.invalidated_at IS NULL
       WHERE incident.organization_id = ?
         AND (
           incident.state IN ('invalidated', 'rejected', 'resolved')
           OR (
             event_a.deleted_at IS NULL
             AND event_a.planning_status NOT IN (
               'archived', 'cancelled', 'completed'
             )
             AND (
               event_b.id IS NULL
               OR (
                 event_b.deleted_at IS NULL
                 AND event_b.planning_status NOT IN (
                   'archived', 'cancelled', 'completed'
                 )
               )
             )
           )
         )
         AND (
           ? IN ('owner', 'administrator')
           OR event_a.primary_organizer_profile_id = ?
           OR EXISTS (
             SELECT 1 FROM organizer_event_organizers AS scope_a
             WHERE scope_a.organization_id = incident.organization_id
               AND scope_a.organizer_event_id = event_a.id
               AND scope_a.profile_id = ?
               AND scope_a.deleted_at IS NULL
           )
           OR event_b.primary_organizer_profile_id = ?
           OR EXISTS (
             SELECT 1 FROM organizer_event_organizers AS scope_b
             WHERE scope_b.organization_id = incident.organization_id
               AND scope_b.organizer_event_id = event_b.id
               AND scope_b.profile_id = ?
               AND scope_b.deleted_at IS NULL
           )
         )
       ORDER BY incident.overlap_start_utc DESC, incident.id
       LIMIT 200`,
    )
    .bind(
      actor.role,
      actor.profileId,
      actor.profileId,
      actor.role,
      actor.profileId,
      actor.profileId,
      actor.organizationId,
      actor.role,
      actor.profileId,
      actor.profileId,
      actor.profileId,
      actor.profileId,
    )
    .all<Record<string, unknown>>();
  return Object.freeze((result.results ?? []).map((row) => readCenterItem(row, actor)));
}

export async function markInformationalConflictReviewed(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  incidentIdValue: unknown,
): Promise<Readonly<{ id: string; state: "resolved" }>> {
  const actor = await authorizeMembership(database, identity);
  const incidentId = parseIdentifier(incidentIdValue, "incidentId");
  const now = await currentD1Time(database);
  const results = await database.batch([
    database
      .prepare(
        `UPDATE organizer_conflict_incidents AS incident
         SET state = 'resolved', resolved_at = ?, updated_at = ?
         WHERE incident.id = ?
           AND incident.organization_id = ?
           AND incident.state = 'informational'
           AND (
             ? IN ('owner', 'administrator')
             OR EXISTS (
               SELECT 1
               FROM organizer_events AS event
               JOIN club_memberships AS club_membership
                 ON club_membership.organization_id = event.organization_id
                AND club_membership.club_id = event.club_id
                AND club_membership.organization_membership_id = ?
                AND club_membership.profile_id = ?
                AND club_membership.role = 'organizer'
                AND club_membership.status = 'active'
                AND club_membership.deleted_at IS NULL
               WHERE event.organization_id = incident.organization_id
                 AND (
                   event.id = incident.organizer_event_id
                   OR (
                     incident.conflicting_source_kind = 'manual'
                     AND event.id = incident.conflicting_event_id
                   )
                 )
                 AND (
                   event.primary_organizer_profile_id = ?
                   OR EXISTS (
                     SELECT 1
                     FROM organizer_event_organizers AS association
                     WHERE association.organization_id =
                           incident.organization_id
                       AND association.organizer_event_id = event.id
                       AND association.profile_id = ?
                       AND association.deleted_at IS NULL
                   )
                 )
             )
           )`,
      )
      .bind(
        now,
        now,
        incidentId,
        actor.organizationId,
        actor.role,
        actor.membershipId,
        actor.profileId,
        actor.profileId,
        actor.profileId,
      ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action, entity_type,
           entity_id, metadata_json, created_at
         )
         SELECT ?, ?, ?, 'conflict_warning.reviewed',
                'organizer_conflict_incident', ?, '{}', ?
         WHERE changes() = 1`,
      )
      .bind(
        `audit:${crypto.randomUUID()}`,
        actor.organizationId,
        actor.profileId,
        incidentId,
        now,
      ),
  ]);
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    throw new SafeApplicationError(
      "not_found",
      404,
      "The informational warning is not available.",
    );
  }
  return Object.freeze({ id: incidentId, state: "resolved" as const });
}

export async function loadAuthoritativeConflictFacts(
  database: D1DatabaseLike,
  organizationId: string,
  proposed: ConflictCandidate,
  now: number,
): Promise<readonly ConflictFact[]> {
  const records = await loadCandidateRecords(
    database,
    organizationId,
    proposed.interval,
    false,
  );
  return findConflictFacts(
    proposed,
    records.map((record) => record.candidate),
    now,
  );
}

export async function currentD1Time(
  database: D1DatabaseLike,
): Promise<number> {
  const row = await database
    .prepare(
      `SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER) AS now_utc`,
    )
    .first<Record<string, unknown>>();
  const now = integerValue(row?.now_utc);
  if (now === null) {
    throw unavailable("The scheduling clock is not available.");
  }
  return now;
}

function parsePreviewInput(value: unknown): ProposedConflictState {
  const raw = parseObject(value, "body");
  assertOnlyKeys(
    raw,
    [
      "bufferAfterMinutes",
      "bufferBeforeMinutes",
      "clubId",
      "coOrganizerProfileIds",
      "eventId",
      "expectedScheduleVersion",
      "planningStatus",
      "primaryOrganizerProfileId",
      "schedule",
      "venueId",
    ],
    "body",
  );
  const schedule = parseObject(raw.schedule, "schedule");
  const shape = parseEnum(
    schedule.shape,
    ["timed", "all_day"] as const,
    "schedule.shape",
  );
  const timeZone = parseIanaTimeZone(schedule.timeZone, "schedule.timeZone");
  const interval =
    shape === "timed"
      ? timedPreviewInterval(schedule, timeZone, raw)
      : allDayPreviewInterval(schedule, timeZone, raw);
  const organizerProfileIds = parseIdentifierArray(
    raw.coOrganizerProfileIds,
    "coOrganizerProfileIds",
  );
  const primaryOrganizerProfileId = parseIdentifier(
    raw.primaryOrganizerProfileId,
    "primaryOrganizerProfileId",
  );
  const scope = Object.freeze(
    [...new Set([primaryOrganizerProfileId, ...organizerProfileIds])].sort(),
  );
  const expectedScheduleVersion =
    raw.expectedScheduleVersion === null ||
    raw.expectedScheduleVersion === undefined
      ? 0
      : parseFiniteInteger(raw.expectedScheduleVersion, {
          path: "expectedScheduleVersion",
          minimum: 1,
        });
  const planningStatus = parseEnum(
    raw.planningStatus,
    PHASE4_PLANNING_STATUSES,
    "planningStatus",
  );
  const eventId =
    raw.eventId === null || raw.eventId === undefined
      ? `preview:${crypto.randomUUID()}`
      : parseIdentifier(raw.eventId, "eventId");
  const bufferBeforeMinutes = parseFiniteInteger(
    raw.bufferBeforeMinutes ?? 0,
    { path: "bufferBeforeMinutes", minimum: 0, maximum: 1_440 },
  );
  const bufferAfterMinutes = parseFiniteInteger(
    raw.bufferAfterMinutes ?? 0,
    { path: "bufferAfterMinutes", minimum: 0, maximum: 1_440 },
  );
  return Object.freeze({
    bufferAfterMinutes,
    bufferBeforeMinutes,
    candidate: Object.freeze({
      bufferAfterMinutes,
      bufferBeforeMinutes,
      candidateKey: `manual:${eventId}`,
      clubId: parseIdentifier(raw.clubId, "clubId"),
      eventId,
      holdExpiresAt: null,
      interval,
      organizationId: "",
      organizerProfileIds: scope,
      planningStatus,
      primaryOrganizerProfileId,
      scheduleVersion: expectedScheduleVersion + 1,
      source: "manual" as const,
      title: "Proposed schedule",
      venueId:
        raw.venueId === null || raw.venueId === undefined || raw.venueId === ""
          ? null
          : parseIdentifier(raw.venueId, "venueId"),
    }),
  });
}

function timedPreviewInterval(
  schedule: Record<string, unknown>,
  timeZone: string,
  raw: Record<string, unknown>,
): NormalizedConflictInterval {
  assertOnlyKeys(
    schedule,
    ["endLocal", "shape", "startLocal", "timeZone"],
    "schedule",
  );
  const range = normalizeTimedEventRange({
    endLocal: schedule.endLocal,
    startLocal: schedule.startLocal,
    timeZone,
  });
  return normalizeConflictInterval({
    bufferAfterMinutes: parseFiniteInteger(raw.bufferAfterMinutes ?? 0, {
      path: "bufferAfterMinutes",
      minimum: 0,
      maximum: 1_440,
    }),
    bufferBeforeMinutes: parseFiniteInteger(raw.bufferBeforeMinutes ?? 0, {
      path: "bufferBeforeMinutes",
      minimum: 0,
      maximum: 1_440,
    }),
    endUtc: range.endsAtUtcMs,
    startUtc: range.startsAtUtcMs,
  });
}

function allDayPreviewInterval(
  schedule: Record<string, unknown>,
  timeZone: string,
  raw: Record<string, unknown>,
): NormalizedConflictInterval {
  assertOnlyKeys(
    schedule,
    [
      "allDayEndDateExclusive",
      "allDayStartDate",
      "shape",
      "timeZone",
    ],
    "schedule",
  );
  const range = normalizeAllDayEventRange({
    endDateExclusive: schedule.allDayEndDateExclusive,
    startDate: schedule.allDayStartDate,
  });
  return normalizeAllDayConflictInterval({
    bufferAfterMinutes: parseFiniteInteger(raw.bufferAfterMinutes ?? 0, {
      path: "bufferAfterMinutes",
      minimum: 0,
      maximum: 1_440,
    }),
    bufferBeforeMinutes: parseFiniteInteger(raw.bufferBeforeMinutes ?? 0, {
      path: "bufferBeforeMinutes",
      minimum: 0,
      maximum: 1_440,
    }),
    endDateExclusive: range.endDateExclusive,
    startDate: range.startDate,
    timeZone,
  });
}

async function validateProposedReferences(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  proposedInput: ConflictCandidate,
): Promise<void> {
  const proposed = Object.freeze({
    ...proposedInput,
    organizationId: actor.organizationId,
  });
  const scopeJson = JSON.stringify(proposed.organizerProfileIds);
  const result = await database
    .prepare(
      `SELECT
         EXISTS (
           SELECT 1 FROM clubs
           WHERE id = ? AND organization_id = ? AND deleted_at IS NULL
         ) AS club_valid,
         CASE WHEN ? IS NULL THEN 1 ELSE EXISTS (
           SELECT 1 FROM venues
           WHERE id = ? AND organization_id = ? AND deleted_at IS NULL
         ) END AS venue_valid,
         (
           SELECT COUNT(*)
           FROM json_each(?) AS requested
           WHERE EXISTS (
             SELECT 1
             FROM profiles AS profile
             JOIN organization_memberships AS membership
               ON membership.profile_id = profile.id
              AND membership.organization_id = ?
              AND membership.status = 'active'
              AND membership.deleted_at IS NULL
             WHERE profile.id = requested.value
               AND profile.status = 'active'
               AND profile.deleted_at IS NULL
               AND (
                 membership.role IN ('owner', 'administrator')
                 OR (
                   membership.role = 'organizer'
                   AND EXISTS (
                     SELECT 1
                     FROM club_memberships AS club_membership
                     WHERE club_membership.organization_id =
                           membership.organization_id
                       AND club_membership.club_id = ?
                       AND club_membership.organization_membership_id =
                           membership.id
                       AND club_membership.profile_id = membership.profile_id
                       AND club_membership.role = 'organizer'
                       AND club_membership.status = 'active'
                       AND club_membership.deleted_at IS NULL
                   )
                 )
               )
           )
         ) AS organizer_count`,
    )
    .bind(
      proposed.clubId,
      actor.organizationId,
      proposed.venueId,
      proposed.venueId,
      actor.organizationId,
      scopeJson,
      actor.organizationId,
      proposed.clubId,
    )
    .first<Record<string, unknown>>();
  if (
    integerValue(result?.club_valid) !== 1 ||
    integerValue(result?.venue_valid) !== 1 ||
    integerValue(result?.organizer_count) !== proposed.organizerProfileIds.length
  ) {
    throw new SafeApplicationError(
      "not_found",
      404,
      "A scheduling reference is not available.",
    );
  }
  if (actor.role === "organizer" && !proposed.organizerProfileIds.includes(actor.profileId)) {
    throw new SafeApplicationError(
      "authorization_denied",
      403,
      "The proposed organizer assignment is not authorized.",
    );
  }
}

async function loadCandidateRecords(
  database: D1DatabaseLike,
  organizationId: string,
  interval: NormalizedConflictInterval,
  includeInformational: boolean,
): Promise<readonly CandidateRecord[]> {
  const result = await database
    .prepare(CANDIDATE_SELECT_SQL)
    .bind(
      organizationId,
      interval.expandedEndUtc,
      interval.expandedStartUtc,
      includeInformational ? 1 : 0,
      organizationId,
      interval.expandedEndUtc,
      interval.expandedStartUtc,
    )
    .all<Record<string, unknown>>();
  if ((result.results ?? []).length > 500) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "The conflict check is too broad. Narrow the proposed interval before saving.",
    );
  }
  return Object.freeze(
    (result.results ?? []).map((row) => candidateRecord(row, organizationId)),
  );
}

function allCollisionFacts(
  proposed: ConflictCandidate,
  records: readonly CandidateRecord[],
  now: number,
): readonly Readonly<{ fact: ConflictFact; record: CandidateRecord }>[] {
  const output: Readonly<{ fact: ConflictFact; record: CandidateRecord }>[] = [];
  for (const record of records) {
    const candidate =
      record.candidate.planningStatus === "draft" ||
      record.candidate.planningStatus === "idea"
        ? Object.freeze({
            ...record.candidate,
            planningStatus: "confirmed" as const,
          })
        : record.candidate;
    const fact = findConflictFacts(proposed, [candidate], now)[0];
    if (fact) output.push(Object.freeze({ fact, record }));
  }
  return Object.freeze(output);
}

function candidateRecord(
  row: Record<string, unknown>,
  organizationId: string,
): CandidateRecord {
  const planningStatus = readPlanningStatus(row.planning_status);
  const scope = parseStoredIdentifierArray(row.organizer_scope_json);
  const source = readSource(row.source);
  const names = parseStoredStringMap(row.organizer_names_json);
  const candidate: ConflictCandidate = Object.freeze({
    bufferAfterMinutes: 0,
    bufferBeforeMinutes: 0,
    candidateKey: requiredString(row.candidate_key),
    clubId: requiredString(row.club_id),
    eventId: requiredString(row.event_id),
    holdExpiresAt: optionalInteger(row.hold_expires_at),
    interval: Object.freeze({
      actualEndUtc: requiredInteger(row.actual_end_utc),
      actualStartUtc: requiredInteger(row.actual_start_utc),
      expandedEndUtc: requiredInteger(row.expanded_end_utc),
      expandedStartUtc: requiredInteger(row.expanded_start_utc),
    }),
    organizationId,
    organizerProfileIds: scope,
    planningStatus,
    primaryOrganizerProfileId: optionalString(row.primary_organizer_profile_id),
    scheduleVersion: requiredInteger(row.schedule_version),
    source,
    title: requiredString(row.title),
    venueId: optionalString(row.venue_id),
  });
  return Object.freeze({
    candidate,
    clubName: requiredString(row.club_name),
    organizerName: requiredString(row.organizer_name),
    organizerNames: names,
    readOnly: requiredInteger(row.read_only) === 1,
    sourceLabel: requiredString(row.source_label),
    timeZone: requiredString(row.timezone),
  });
}

function previewItem(
  proposed: ConflictCandidate,
  fact: ConflictFact,
  record: CandidateRecord,
): ConflictPreviewItemDto {
  return Object.freeze({
    classification: fact.classification,
    clubName: record.clubName,
    eventId: record.candidate.eventId,
    id: `${fact.classification}:${record.candidate.candidateKey}:${record.candidate.scheduleVersion}`,
    organizerName: record.organizerName,
    overlapLabel: intervalLabel(
      fact.overlapStartUtc,
      fact.overlapEndUtc,
      record.timeZone,
    ),
    planningStatus: record.candidate.planningStatus,
    readOnly: record.readOnly,
    resources: Object.freeze(
      fact.resources.map((resource) =>
        Object.freeze({
          label:
            resource.type === "organization"
              ? "Organization-wide schedule"
              : resource.type === "venue"
                ? "Shared venue"
                : record.organizerNames[resource.resourceId] ??
                  "Shared organizer",
          type:
            resource.type === "primary_organizer"
              ? ("organizer" as const)
              : resource.type,
        }),
      ),
    ),
    scheduleLabel: intervalLabel(
      record.candidate.interval.actualStartUtc,
      record.candidate.interval.actualEndUtc,
      record.timeZone,
    ),
    sourceLabel: record.sourceLabel,
    title: record.candidate.title,
  });
}

function readCenterItem(
  row: Record<string, unknown>,
  actor: AuthorizedMembership,
): ConflictCenterItemDto {
  const incidentId = requiredString(row.id);
  const reviewId = optionalString(row.review_request_id);
  const state = mapCenterState(requiredString(row.state));
  const eventA = centerEvent(row, "event_a");
  const eventB = centerEvent(row, "event_b", requiredString(row.conflicting_event_id));
  const resources = parseStoredResources(row.resources_json).map((resource) =>
    Object.freeze({
      label:
        resource.type === "organization"
          ? "Organization-wide schedule"
          : resource.type === "venue"
            ? "Shared venue"
            : "Shared organizer",
      type: resource.type,
    }),
  );
  const requestedBy = optionalString(row.requester_profile_id);
  const editableEvents = [
    requiredInteger(row.actor_can_edit_a) === 1
      ? {
          event: eventA,
          contentVersion: requiredInteger(row.event_a_content_version),
          scheduleVersion: requiredInteger(row.event_a_schedule_version),
        }
      : null,
    requiredInteger(row.actor_can_edit_b) === 1
      ? {
          event: eventB,
          contentVersion: requiredInteger(row.event_b_content_version),
          scheduleVersion: requiredInteger(row.event_b_schedule_version),
        }
      : null,
  ].filter(
    (
      value,
    ): value is Readonly<{
      contentVersion: number;
      event: ConflictCenterEventDto;
      scheduleVersion: number;
    }> => value !== null,
  );
  const actions: ConflictCenterItemDto["allowedActions"][number][] =
    editableEvents.flatMap(({ event }) => [
      {
        eventId: event.eventId,
        expectedContentVersion: null,
        expectedScheduleVersion: null,
        kind: "edit" as const,
      },
      {
        eventId: event.eventId,
        expectedContentVersion: null,
        expectedScheduleVersion: null,
        kind: "change_time" as const,
      },
    ]);
  if (state === "pending" && reviewId) {
    if (
      actor.role === "owner" ||
      (actor.role === "administrator" && actor.profileId !== requestedBy)
    ) {
      actions.push({
        eventId: null,
        expectedContentVersion: null,
        expectedScheduleVersion: null,
        kind: "approve",
      });
    }
    if (actor.role === "owner" || actor.role === "administrator") {
      actions.push({
        eventId: null,
        expectedContentVersion: null,
        expectedScheduleVersion: null,
        kind: "reject",
      });
    }
  }
  if (state === "warning" && editableEvents[0]) {
    actions.push({
      eventId: editableEvents[0].event.eventId,
      expectedContentVersion: null,
      expectedScheduleVersion: null,
      kind: "mark_reviewed",
    });
  }
  for (const editable of editableEvents) {
    if (
      editable.event.planningStatus === "confirmed" ||
      editable.event.planningStatus === "tentative_hold"
    ) {
      actions.push({
        eventId: editable.event.eventId,
        expectedContentVersion: editable.contentVersion,
        expectedScheduleVersion: editable.scheduleVersion,
        kind: "cancel",
      });
    }
  }
  const createdAt = requiredInteger(row.created_at);
  const updatedAt = requiredInteger(row.updated_at);
  return Object.freeze({
    activity: Object.freeze([
      {
        id: `${incidentId}:created`,
        label: "Conflict recorded",
        timeLabel: dateTimeLabel(createdAt, "America/Vancouver"),
      },
      ...(updatedAt !== createdAt
        ? [
            {
              id: `${incidentId}:updated`,
              label: "Conflict state updated",
              timeLabel: dateTimeLabel(updatedAt, "America/Vancouver"),
            },
          ]
        : []),
    ]),
    allowedActions: Object.freeze(actions),
    classification: readClassification(row.classification),
    eventA,
    eventB,
    groupDate: localDate(requiredInteger(row.overlap_start_utc)),
    id: state === "pending" && reviewId ? reviewId : incidentId,
    overlapLabel: intervalLabel(
      requiredInteger(row.overlap_start_utc),
      requiredInteger(row.overlap_end_utc),
      "America/Vancouver",
    ),
    reason: optionalString(row.override_reason) ?? optionalString(row.review_reason),
    resources: Object.freeze(resources),
    state,
  });
}

function centerEvent(
  row: Record<string, unknown>,
  prefix: "event_a" | "event_b",
  fallbackId?: string,
): ConflictCenterEventDto {
  const eventId = optionalString(row[`${prefix}_id`]) ?? fallbackId;
  if (!eventId) throw unavailable("The conflict event data is unavailable.");
  const start = requiredInteger(row[`${prefix}_start`]);
  const end = requiredInteger(row[`${prefix}_end`]);
  const timezone = optionalString(row[`${prefix}_timezone`]) ?? "America/Vancouver";
  return Object.freeze({
    clubName: requiredString(row[`${prefix}_club`]),
    eventId,
    organizerName: requiredString(row[`${prefix}_organizer`]),
    planningStatus: requiredString(row[`${prefix}_status`]),
    readOnly:
      prefix === "event_b" && requiredInteger(row.event_b_read_only) === 1,
    scheduleLabel: intervalLabel(start, end, timezone),
    title: requiredString(row[`${prefix}_title`]),
  });
}

function parseIdentifierArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 12) {
    throw new SafeApplicationError(
      "validation_failed",
      422,
      "The organizer scope could not be validated.",
    );
  }
  return Object.freeze(
    [...new Set(value.map((item, index) => parseIdentifier(item, `${path}.${index}`)))].sort(),
  );
}

function parseStoredIdentifierArray(value: unknown): readonly string[] {
  if (typeof value !== "string") throw unavailable("The scheduling data is unavailable.");
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      throw new TypeError("invalid scope");
    }
    return Object.freeze([...new Set(parsed)].sort());
  } catch {
    throw unavailable("The scheduling data is unavailable.");
  }
}

function parseStoredStringMap(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== "string") return Object.freeze({});
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Object.freeze({});
    }
    return Object.freeze(
      Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    );
  } catch {
    return Object.freeze({});
  }
}

function parseStoredResources(
  value: unknown,
): readonly Readonly<{ resourceId: string; type: string }>[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const resourceId = Reflect.get(item, "resourceId");
      const type = Reflect.get(item, "type");
      return typeof resourceId === "string" && typeof type === "string"
        ? [Object.freeze({ resourceId, type })]
        : [];
    });
  } catch {
    return [];
  }
}

function readPlanningStatus(value: unknown): Phase4PlanningStatus {
  const status = PHASE4_PLANNING_STATUSES.find((candidate) => candidate === value);
  if (!status) throw unavailable("The scheduling data is unavailable.");
  return status;
}

function readSource(value: unknown): ConflictCandidate["source"] {
  if (value === "manual" || value === "legacy" || value === "meetup") return value;
  throw unavailable("The scheduling data is unavailable.");
}

function readClassification(value: unknown): "buffer" | "direct" {
  if (value === "buffer" || value === "direct") return value;
  throw unavailable("The conflict data is unavailable.");
}

function mapCenterState(value: string): ConflictCenterItemDto["state"] {
  if (value === "pending_approval") return "pending";
  if (value === "informational") return "warning";
  if (
    value === "approved" ||
    value === "invalidated" ||
    value === "open" ||
    value === "rejected" ||
    value === "resolved"
  ) {
    return value;
  }
  throw unavailable("The conflict data is unavailable.");
}

function intervalLabel(start: number, end: number, timeZone: string): string {
  return `${dateTimeLabel(start, timeZone)} – ${dateTimeLabel(end, timeZone)} (${timeZone})`;
}

function dateTimeLabel(value: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/Vancouver",
    }).format(new Date(value));
  }
}

function localDate(value: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Vancouver",
    year: "numeric",
  }).formatToParts(new Date(value));
  const pick = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw unavailable("The conflict data is unavailable.");
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : requiredString(value);
}

function requiredInteger(value: unknown): number {
  const parsed = integerValue(value);
  if (parsed === null) throw unavailable("The conflict data is unavailable.");
  return parsed;
}

function optionalInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : requiredInteger(value);
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function unavailable(message: string): SafeApplicationError {
  return new SafeApplicationError("service_unavailable", 503, message);
}

function changes(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const meta = Reflect.get(result, "meta");
  if (!meta || typeof meta !== "object") return 0;
  const count = Reflect.get(meta, "changes");
  return typeof count === "number" ? count : 0;
}
