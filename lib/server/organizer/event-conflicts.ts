import {
  authorizeMembership,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import { parseOfficialMeetupEventUrl } from "../meetup/url";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  assertCurrentOrganizerEventReadAccess,
  getOrganizerEventForAuthorizedActor,
} from "./events";

export type OrganizerEventConflictSummaryDto = Readonly<{
  clubName: string;
  destination:
    | Readonly<{
        external: boolean;
        href: string;
        label: string;
      }>
    | null;
  id: string;
  organizerName: string;
  overlapLabel: string;
  planningStatus: string;
  scheduleLabel: string;
  sourceLabel: string;
  state: string;
  title: string;
}>;

/**
 * Returns only current, event-scoped coordination facts. Reasons and review
 * notes stay in the separately authorized Conflict Center.
 */
export async function listOrganizerEventConflictSummaries(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  eventId: unknown,
): Promise<readonly OrganizerEventConflictSummaryDto[]> {
  const actor = await authorizeMembership(database, identity);
  const target = await getOrganizerEventForAuthorizedActor(
    database,
    actor,
    eventId,
  );
  const result = await database
    .prepare(
      `SELECT incident.id,
              incident.state,
              incident.overlap_start_utc,
              incident.overlap_end_utc,
              CASE
                WHEN incident.organizer_event_id = ? THEN 1
                ELSE 0
              END AS target_is_event_a,
              event_a.id AS event_a_id,
              event_a.title AS event_a_title,
              event_a.planning_status AS event_a_status,
              state_a.actual_start_utc AS event_a_start,
              state_a.actual_end_utc AS event_a_end,
              state_a.timezone AS event_a_timezone,
              club_a.name AS event_a_club,
              COALESCE(profile_a.display_name, 'Organizer not listed')
                AS event_a_organizer,
              event_b.id AS event_b_id,
              event_b.title AS event_b_title,
              event_b.planning_status AS event_b_status,
              state_b.actual_start_utc AS event_b_start,
              state_b.actual_end_utc AS event_b_end,
              state_b.timezone AS event_b_timezone,
              club_b.name AS event_b_club,
              COALESCE(profile_b.display_name, 'Organizer not listed')
                AS event_b_organizer,
              incident.conflicting_source_kind AS external_source,
              legacy_b.id AS external_event_id,
              legacy_b.title AS external_title,
              external_b.planning_status AS external_status,
              external_b.actual_start_utc AS external_start,
              external_b.actual_end_utc AS external_end,
              external_b.timezone AS external_timezone,
              club_external.name AS external_club,
              COALESCE(profile_external.display_name,
                       'Organizer not listed') AS external_organizer,
              snapshot.event_url AS meetup_event_url
       FROM organizer_conflict_incidents AS incident
       JOIN organizer_events AS event_a
         ON event_a.id = incident.organizer_event_id
        AND event_a.organization_id = incident.organization_id
        AND event_a.deleted_at IS NULL
       JOIN organizer_reservation_states AS state_a
         ON state_a.organizer_event_id = event_a.id
        AND state_a.organization_id = event_a.organization_id
       JOIN clubs AS club_a
         ON club_a.id = event_a.club_id
        AND club_a.organization_id = event_a.organization_id
        AND club_a.deleted_at IS NULL
       LEFT JOIN profiles AS profile_a
         ON profile_a.id = event_a.primary_organizer_profile_id
       LEFT JOIN organizer_events AS event_b
         ON incident.conflicting_source_kind = 'manual'
        AND event_b.id = incident.conflicting_event_id
        AND event_b.organization_id = incident.organization_id
        AND event_b.deleted_at IS NULL
       LEFT JOIN organizer_reservation_states AS state_b
         ON state_b.organizer_event_id = event_b.id
        AND state_b.organization_id = event_b.organization_id
       LEFT JOIN clubs AS club_b
         ON club_b.id = event_b.club_id
        AND club_b.organization_id = event_b.organization_id
        AND club_b.deleted_at IS NULL
       LEFT JOIN profiles AS profile_b
         ON profile_b.id = event_b.primary_organizer_profile_id
       LEFT JOIN organizer_external_reservation_intervals AS external_b
         ON incident.conflicting_source_kind IN ('legacy', 'meetup')
        AND incident.conflicting_candidate_key =
            external_b.source_kind || ':' || external_b.id
        AND external_b.event_id = incident.conflicting_event_id
        AND external_b.organization_id = incident.organization_id
        AND external_b.schedule_version =
            incident.conflicting_schedule_version
       LEFT JOIN events AS legacy_b
         ON legacy_b.id = external_b.event_id
        AND legacy_b.organization_id = external_b.organization_id
       LEFT JOIN clubs AS club_external
         ON club_external.id = external_b.club_id
        AND club_external.organization_id = external_b.organization_id
        AND club_external.deleted_at IS NULL
       LEFT JOIN profiles AS profile_external
         ON profile_external.id = external_b.primary_organizer_profile_id
       LEFT JOIN sync_sources AS source
         ON external_b.source_kind = 'meetup'
        AND source.id = external_b.sync_source_id
        AND source.organization_id = external_b.organization_id
        AND source.enabled = 1
        AND source.deleted_at IS NULL
        AND source.active_generation_id = external_b.generation_id
       LEFT JOIN meetup_sync_generations AS generation
         ON generation.id = source.active_generation_id
        AND generation.organization_id = source.organization_id
        AND generation.sync_source_id = source.id
        AND generation.state = 'published'
       LEFT JOIN meetup_event_snapshots AS snapshot
         ON snapshot.organization_id = source.organization_id
        AND snapshot.sync_source_id = source.id
        AND snapshot.generation_id = source.active_generation_id
        AND snapshot.event_id = external_b.event_id
       WHERE incident.organization_id = ?
         AND (
           incident.organizer_event_id = ?
           OR (
             incident.conflicting_source_kind = 'manual'
             AND incident.conflicting_event_id = ?
           )
         )
         AND incident.state IN (
           'open', 'pending_approval', 'approved', 'rejected',
           'informational'
         )
         AND event_a.planning_status NOT IN (
           'cancelled', 'completed', 'archived'
         )
         AND (
           event_a.planning_status <> 'tentative_hold'
           OR state_a.hold_expires_at >
              CAST(unixepoch('subsec') * 1000 AS INTEGER)
         )
         AND (
           (
             incident.conflicting_source_kind = 'manual'
             AND event_b.id IS NOT NULL
             AND state_b.organizer_event_id IS NOT NULL
             AND event_b.planning_status NOT IN (
               'cancelled', 'completed', 'archived'
             )
             AND (
               event_b.planning_status <> 'tentative_hold'
               OR state_b.hold_expires_at >
                  CAST(unixepoch('subsec') * 1000 AS INTEGER)
             )
           )
           OR (
             incident.conflicting_source_kind = 'legacy'
             AND external_b.id IS NOT NULL
             AND external_b.planning_status <> 'cancelled'
           )
           OR (
             incident.conflicting_source_kind = 'meetup'
             AND external_b.id IS NOT NULL
             AND generation.id IS NOT NULL
             AND external_b.planning_status <> 'cancelled'
           )
         )
       ORDER BY incident.overlap_start_utc, incident.id
       LIMIT 25`,
    )
    .bind(
      target.id,
      target.organizationId,
      target.id,
      target.id,
    )
    .all<Record<string, unknown>>();

  const summaries = Object.freeze(
    (result.results ?? []).map(readConflictSummary),
  );
  await assertCurrentOrganizerEventReadAccess(
    database,
    identity,
    actor,
    [target.id],
    true,
  );
  return summaries;
}

function readConflictSummary(
  row: Record<string, unknown>,
): OrganizerEventConflictSummaryDto {
  const targetIsEventA = requiredInteger(row.target_is_event_a) === 1;
  const source = targetIsEventA
    ? requiredSource(row.external_source)
    : "manual";
  const prefix =
    targetIsEventA && source !== "manual"
      ? "external"
      : targetIsEventA
        ? "event_b"
        : "event_a";
  const eventId = requiredString(row[`${prefix}_event_id`] ?? row[`${prefix}_id`]);
  const meetupUrl =
    source === "meetup" ? safeMeetupEventUrl(row.meetup_event_url) : null;
  return Object.freeze({
    clubName: requiredString(row[`${prefix}_club`]),
    destination:
      source === "manual"
        ? Object.freeze({
            external: false,
            href: `/organizer/events/${encodeURIComponent(eventId)}`,
            label: "View event",
          })
        : meetupUrl
          ? Object.freeze({
              external: true,
              href: meetupUrl,
              label: "Open Meetup event",
            })
          : null,
    id: requiredString(row.id),
    organizerName: requiredString(row[`${prefix}_organizer`]),
    overlapLabel: intervalLabel(
      requiredInteger(row.overlap_start_utc),
      requiredInteger(row.overlap_end_utc),
      "America/Vancouver",
    ),
    planningStatus: requiredString(row[`${prefix}_status`]),
    scheduleLabel: intervalLabel(
      requiredInteger(row[`${prefix}_start`]),
      requiredInteger(row[`${prefix}_end`]),
      requiredString(row[`${prefix}_timezone`]),
    ),
    sourceLabel:
      source === "meetup"
        ? "Meetup · read-only"
        : source === "legacy"
          ? "Existing event · read-only"
          : "Manual event",
    state: centerState(requiredString(row.state)),
    title: requiredString(row[`${prefix}_title`]),
  });
}

function centerState(value: string): string {
  if (value === "pending_approval") return "Pending approval";
  if (value === "informational") return "Draft warning";
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function intervalLabel(start: number, end: number, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
    timeZoneName: "short",
    year: "numeric",
  });
  return `${formatter.format(new Date(start))} – ${formatter.format(
    new Date(end),
  )} (${timeZone})`;
}

function requiredSource(value: unknown): "legacy" | "manual" | "meetup" {
  if (value === "legacy" || value === "manual" || value === "meetup") {
    return value;
  }
  throw unavailable();
}

function safeMeetupEventUrl(value: unknown): string | null {
  try {
    return parseOfficialMeetupEventUrl(value);
  } catch {
    return null;
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw unavailable();
  return value;
}

function requiredInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw unavailable();
  }
  return value;
}

function unavailable(): SafeApplicationError {
  return new SafeApplicationError(
    "service_unavailable",
    503,
    "The event conflict summary is unavailable.",
  );
}
