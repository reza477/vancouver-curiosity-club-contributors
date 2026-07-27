import {
  authorizeMembership,
  type AuthorizedMembership,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type TrustedServerIdentity,
} from "../auth";
import { parseOfficialMeetupEventUrl } from "../meetup/url";
import {
  getAuthorizedOrganizerEventPublicPreview,
  hasAuthorizedOrganizerEventPublicPreview,
  type PublicEventDetailDto,
} from "../public/events";
import {
  assertOnlyKeys,
  parseEnum,
  parseFiniteInteger,
  parseHttpsUrl,
  parseIdentifier,
  parseObject,
  parseOptionalBoundedString,
  validationIssue,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  localDateTimeToUtcMs,
  parseIanaTimeZone,
} from "../../time";
import {
  getOrganizerEvent,
  getOrganizerEventForAuthorizedActor,
  getOrganizerEventForAuthorizedWorkspaceViewer,
  type OrganizerEventDto,
} from "./events";
import { prepareNotificationInsert } from "./notifications";
import {
  currentD1Time,
} from "./conflicts";
import {
  mapSchedulingDatabaseError,
  prepareOrganizerPublicationScheduleGuard,
  prepareOrganizerPublicationScheduleGuardForAuthorizedActor,
  type OrganizerPublicationScheduleOperation,
} from "./scheduling";
import type { EventPublicationStatus } from "./lifecycle";
import { ORGANIZER_PUBLIC_SLUG_COLLISION_QUERY_SQL } from "./publication-invariant-sql";

export const ORGANIZER_PUBLICATION_ACTIONS = [
  "publish",
  "schedule_publication",
  "cancel_scheduled_publication",
  "unpublish",
] as const;

export type OrganizerPublicationAction =
  (typeof ORGANIZER_PUBLICATION_ACTIONS)[number];

export type OrganizerPublicationDetailsDto = Readonly<{
  attendanceMode:
    | "hybrid"
    | "in_person"
    | "location_undecided"
    | "online";
  availabilityState: "full" | "open" | "waitlist";
  capacity: number | null;
  costText: string | null;
  externalMapUrl: string | null;
  meetupUrlConfirmed: boolean;
  preparationInformation: string | null;
  publicAccessNote: string | null;
  publicAddress: string | null;
  publicHostsEnabled: boolean;
  publicLocationName: string | null;
  publicOnlineUrl: string | null;
  rsvpMode: "coming_soon" | "meetup";
  verifiedAccessibilityNotes: string | null;
  weatherNote: string | null;
  whatToBring: string | null;
  arrivalInstructions: string | null;
}>;

export type OrganizerPublicationHostOptionDto = Readonly<{
  displayName: string;
  eligible: true;
  profileId: string;
  selected: boolean;
}>;

export type OrganizerPublicationReadinessIssue = Readonly<{
  code: string;
  field?: string;
  label: string;
}>;

export type OrganizerPublicationWorkspaceDto = Readonly<{
  details: OrganizerPublicationDetailsDto;
  event: Readonly<{
    contentVersion: number;
    id: string;
    meetupEventUrl: string | null;
    planningStatus: OrganizerEventDto["planningStatus"];
    publicationStatus: EventPublicationStatus;
    scheduleVersion: number;
    slug: string;
    title: string;
  }>;
  hostOptions: readonly OrganizerPublicationHostOptionDto[];
  pendingJob: Readonly<{
    originalTimezone: string;
    requestedPublicationAtUtc: number;
  }> | null;
  permissions: Readonly<{
    canCancelScheduledPublication: boolean;
    canEditPublicDetails: boolean;
    canPreview: boolean;
    canPublish: boolean;
    canSchedule: boolean;
    canUnpublish: boolean;
  }>;
  publicPath: string | null;
  readiness: Readonly<{
    missing: readonly OrganizerPublicationReadinessIssue[];
    ready: boolean;
  }>;
}>;

export type OrganizationPublicationPolicyDto = Readonly<{
  organizerSelfPublishEnabled: boolean;
}>;

export type OrganizerPublicationActionResult = Readonly<{
  outcome:
    | "published"
    | "publication_cancelled"
    | "publication_scheduled"
    | "unpublished";
  workspace: OrganizerPublicationWorkspaceDto;
}>;

type ParsedPublicDetails = Readonly<{
  attendanceMode: OrganizerPublicationDetailsDto["attendanceMode"];
  availabilityState: OrganizerPublicationDetailsDto["availabilityState"];
  capacity: number | null;
  confirmedMeetupEventUrl: string | null;
  costText: string | null;
  externalMapUrl: string | null;
  meetupEventUrl: string | null;
  preparationInformation: string | null;
  publicAccessNote: string | null;
  publicAddress: string | null;
  publicHostsEnabled: boolean;
  publicLocationName: string | null;
  publicOnlineUrl: string | null;
  rsvpMode: OrganizerPublicationDetailsDto["rsvpMode"];
  selectedHostProfileIds: readonly string[];
  verifiedAccessibilityNotes: string | null;
  weatherNote: string | null;
  whatToBring: string | null;
  arrivalInstructions: string | null;
}>;

type ParsedAction = Readonly<{
  action: OrganizerPublicationAction;
  expectedContentVersion: number;
  expectedScheduleVersion: number;
  originalTimezone: string | null;
  requestedPublicationAtUtc: number | null;
}>;

type PublicationMutation = Readonly<{
  action: OrganizerPublicationScheduleOperation;
  event: OrganizerEventDto;
  jobId: string | null;
  previousJobId: string | null;
  nextPublicationStatus: EventPublicationStatus;
  now: number;
  proposedContentVersion: number;
  revisionAction:
    | "publication_cancelled"
    | "publication_executed"
    | "publication_scheduled"
    | "published"
    | "public_details_updated"
    | "unpublished";
}>;

type DuePublicationJob = Readonly<{
  authorizingProfileId: string;
  boundContentVersion: number;
  boundScheduleVersion: number;
  id: string;
  organizationId: string;
  organizerEventId: string;
  requestedPublicationAtUtc: number;
}>;

export type PublicationReconciliationResult = Readonly<{
  executed: number;
  invalidated: number;
  inspected: number;
  transientFailures: number;
}>;

const DEFAULT_DETAILS: OrganizerPublicationDetailsDto = Object.freeze({
  arrivalInstructions: null,
  attendanceMode: "location_undecided",
  availabilityState: "open",
  capacity: null,
  costText: null,
  externalMapUrl: null,
  meetupUrlConfirmed: false,
  preparationInformation: null,
  publicAccessNote: null,
  publicAddress: null,
  publicHostsEnabled: false,
  publicLocationName: null,
  publicOnlineUrl: null,
  rsvpMode: "coming_soon",
  verifiedAccessibilityNotes: null,
  weatherNote: null,
  whatToBring: null,
});

export async function readOrganizerPublicationWorkspace(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  eventIdValue: unknown,
): Promise<OrganizerPublicationWorkspaceDto> {
  const eventId = parseIdentifier(eventIdValue, "eventId");
  const actor = await authorizeMembership(database, identity);
  const event = await getOrganizerEventForAuthorizedWorkspaceViewer(
    database,
    actor,
    eventId,
  );
  const canEditPublicDetails = await canActorEditPublicationEvent(
    database,
    actor,
    event,
  );
  const [detailsRow, hostOptions, pendingJob, policy, hasPreviewProjection] =
    await Promise.all([
      readPublicDetailsRow(database, actor, eventId),
      readHostOptions(database, actor, event),
      readPendingJob(database, actor, eventId),
      readPublicationPolicyByActor(database, actor),
      hasAuthorizedOrganizerEventPublicPreview(database, {
        organizationId: actor.organizationId,
        organizerEventId: event.id,
      }),
    ]);
  const details = detailsRow ? detailsDto(detailsRow, event) : null;
  const missing = await publicationReadinessIssues(
    database,
    actor,
    event,
    detailsRow,
    hostOptions,
    canEditPublicDetails,
  );
  const canPublish =
    canEditPublicDetails &&
    (actor.role === "owner" ||
      actor.role === "administrator" ||
      (actor.role === "organizer" &&
        policy.organizerSelfPublishEnabled));
  return Object.freeze({
    details: details ?? DEFAULT_DETAILS,
    event: Object.freeze({
      contentVersion: event.contentVersion,
      id: event.id,
      meetupEventUrl: event.meetupEventUrl,
      planningStatus: event.planningStatus,
      publicationStatus: event.publicationStatus,
      scheduleVersion: event.scheduleVersion,
      slug: event.slug,
      title: event.title,
    }),
    hostOptions,
    pendingJob,
    permissions: Object.freeze({
      canCancelScheduledPublication:
        event.publicationStatus === "scheduled" &&
        canPublish,
      canEditPublicDetails,
      canPreview: canEditPublicDetails && hasPreviewProjection,
      canPublish:
        canPublish &&
        event.publicationStatus !== "published" &&
        missing.length === 0,
      canSchedule:
        canPublish &&
        event.publicationStatus !== "published" &&
        missing.length === 0,
      canUnpublish:
        canPublish && event.publicationStatus === "published",
    }),
    publicPath:
      event.publicationStatus === "published"
        ? `/events/${event.slug}`
        : null,
    readiness: Object.freeze({
      missing: Object.freeze(missing),
      ready: missing.length === 0,
    }),
  });
}

export async function readOrganizerPublicationPreview(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  eventIdValue: unknown,
): Promise<PublicEventDetailDto | null> {
  const eventId = parseIdentifier(eventIdValue, "eventId");
  const actor = await authorizeMembership(database, identity);
  const event = await getOrganizerEventForAuthorizedWorkspaceViewer(
    database,
    actor,
    eventId,
  );
  if (!(await canActorEditPublicationEvent(database, actor, event))) {
    return null;
  }
  return getAuthorizedOrganizerEventPublicPreview(database, {
    organizationId: actor.organizationId,
    organizerEventId: event.id,
  });
}

export async function readOrganizationPublicationPolicy(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
): Promise<OrganizationPublicationPolicyDto> {
  const actor = await authorizeMembership(database, identity);
  return readPublicationPolicyByActor(database, actor);
}

export async function updateOrganizationPublicationPolicy(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  value: unknown,
): Promise<OrganizationPublicationPolicyDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const input = parseObject(value, "body");
  assertOnlyKeys(input, ["organizerSelfPublishEnabled"], "body");
  const enabled = parseBoolean(
    input.organizerSelfPublishEnabled,
    "organizerSelfPublishEnabled",
  );
  const now = Date.now();
  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO organization_publication_policies (
           organization_id, organizer_self_publish_enabled,
           updated_by_profile_id, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?
         WHERE EXISTS (
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
         )
         ON CONFLICT(organization_id) DO UPDATE SET
           organizer_self_publish_enabled = excluded.organizer_self_publish_enabled,
           updated_by_profile_id = excluded.updated_by_profile_id,
           updated_at = excluded.updated_at`,
      )
      .bind(
        actor.organizationId,
        enabled ? 1 : 0,
        actor.profileId,
        now,
        now,
        actor.membershipId,
        actor.organizationId,
        actor.profileId,
      ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         )
         SELECT ?, ?, ?, 'organization.publication_policy_updated',
                'organization', ?, ?, ?
         WHERE changes() = 1`,
      )
      .bind(
        `audit:${crypto.randomUUID()}`,
        actor.organizationId,
        actor.profileId,
        actor.organizationId,
        JSON.stringify({ organizerSelfPublishEnabled: enabled }),
        now,
      ),
  ]);
  if (changes(results[0]) < 1 || changes(results[1]) !== 1) {
    throw stalePublication();
  }
  return Object.freeze({ organizerSelfPublishEnabled: enabled });
}

export async function updateOrganizerEventPublicDetails(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  eventIdValue: unknown,
  value: unknown,
): Promise<OrganizerPublicationWorkspaceDto> {
  const eventId = parseIdentifier(eventIdValue, "eventId");
  const input = parsePublicDetailsInput(value);
  const event = await getOrganizerEvent(database, identity, eventId);
  requireExpectedVersions(event, input);
  const now = await currentD1Time(database);
  const proposedContentVersion = event.contentVersion + 1;
  const guard = await prepareOrganizerPublicationScheduleGuard(
    database,
    identity,
    {
      eventId,
      expectedContentVersion: event.contentVersion,
      expectedScheduleVersion: event.scheduleVersion,
      operation: "update_public_details",
      proposedContentVersion,
    },
    now,
  );
  const selectedHosts = await validateSelectedHosts(
    database,
    guard.event.actor,
    event,
    input.selectedHostProfileIds,
  );
  const nextPublicationStatus =
    event.publicationStatus === "scheduled"
      ? ("unpublished" as const)
      : event.publicationStatus;
  const previousJobId =
    event.publicationStatus === "scheduled"
      ? await readPendingJobId(database, guard.event.actor, event.id)
      : null;
  const mutation: PublicationMutation = Object.freeze({
    action: "update_public_details",
    event,
    jobId: null,
    previousJobId,
    nextPublicationStatus,
    now,
    proposedContentVersion,
    revisionAction: "public_details_updated",
  });
  const fingerprint = await publicStateFingerprint({
    details: input,
    eventId,
    nextPublicationStatus,
    proposedContentVersion,
    scheduleVersion: event.scheduleVersion,
    selectedHosts,
  });
  const publicationIntentId = `publication-intent:${crypto.randomUUID()}`;
  const statements: D1PreparedStatementLike[] = [
    guard.intentStatement,
    ...guard.authorizationStatements,
  ];
  const authorizationIndexes = guard.authorizationStatements.map(
    (_, index) => index + 1,
  );
  const publicationIntentIndex = statements.push(
    publicationIntentStatement(
      database,
      guard,
      mutation,
      publicationIntentId,
      fingerprint,
      "actor",
    ),
  ) - 1;
  statements.push(
    publicDetailsUpsertStatement(
      database,
      guard.event.actor,
      event,
      input,
      now,
    ),
    event.publicationStatus === "scheduled"
      ? publicationStateUnpublishedStatement(
          database,
          guard.event.actor,
          event.id,
          now,
        )
      : publicationStateEnsureStatement(
          database,
          guard.event.actor,
          event.id,
          now,
        ),
    database
      .prepare(
        `DELETE FROM organizer_event_public_hosts
         WHERE organization_id = ?
           AND organizer_event_id = ?`,
      )
      .bind(guard.event.organizationId, event.id),
    ...selectedHosts.map((profileId) =>
      publicHostInsertStatement(
        database,
        guard.event.actor,
        event,
        profileId,
        now,
      ),
    ),
  );
  if (event.publicationStatus === "scheduled") {
    if (!previousJobId) throw stalePublication();
    statements.push(
      pendingJobTerminalStatement(
        database,
        guard.event.actor.organizationId,
        event.id,
        previousJobId,
        "invalidated",
        "publication_facts_changed",
        now,
      ),
    );
  }
  const eventIndex = statements.length;
  statements.push(
    eventContentUpdateStatement(
      database,
      guard.event.actor,
      mutation,
      input.meetupEventUrl,
    ),
    publicationRevisionStatement(
      database,
      guard.event.actor,
      mutation,
      publicRevisionSnapshot(event, mutation, input),
    ),
    publicationAuditStatement(
      database,
      guard.event.actor,
      event.id,
      "organizer_event.public_details_updated",
      mutation,
    ),
  );
  const conflictFinalizationIndex =
    guard.finalizationStatement === null
      ? null
      : statements.push(guard.finalizationStatement) - 1;
  statements.push(
    publicationIntentCompletionStatement(
      database,
      guard.event.actor,
      publicationIntentId,
      event.id,
      now,
    ),
    guard.completionStatement,
  );
  await runPublicationBatch(database, statements, [
    0,
    ...authorizationIndexes,
    publicationIntentIndex,
    eventIndex,
    ...(conflictFinalizationIndex === null
      ? []
      : [conflictFinalizationIndex]),
    statements.length - 2,
    statements.length - 1,
  ], [
    ...authorizationIndexes.map((index) => ({
      expected: guard.authorizationExpectedChanges,
      index,
    })),
    ...(conflictFinalizationIndex === null
      ? []
      : [{
          expected: guard.authorizationExpectedChanges,
          index: conflictFinalizationIndex,
        }]),
  ]);
  return readOrganizerPublicationWorkspace(database, identity, event.id);
}

export async function performOrganizerPublicationAction(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  eventIdValue: unknown,
  value: unknown,
): Promise<OrganizerPublicationActionResult> {
  const eventId = parseIdentifier(eventIdValue, "eventId");
  const input = parsePublicationAction(value);
  const event = await getOrganizerEvent(database, identity, eventId);
  requireExpectedVersions(event, input);
  const actor = await authorizeMembership(database, identity);
  const policy = await readPublicationPolicyByActor(database, actor);
  if (
    actor.role === "organizer" &&
    !policy.organizerSelfPublishEnabled
  ) {
    throw new SafeApplicationError(
      "authorization_denied",
      403,
      "Organizer self-publishing is not enabled for this workspace.",
    );
  }
  const now = await currentD1Time(database);
  const detailsRow = await readPublicDetailsRow(database, actor, event.id);
  const hostOptions = await readHostOptions(database, actor, event);
  if (
    input.action === "publish" ||
    input.action === "schedule_publication"
  ) {
    const missing = await publicationReadinessIssues(
      database,
      actor,
      event,
      detailsRow,
      hostOptions,
      false,
    );
    if (missing.length > 0) {
      throw new SafeApplicationError(
        "validation_failed",
        422,
        "Complete the website publication checklist before publishing.",
      );
    }
  }
  if (
    input.action === "schedule_publication" &&
    (input.requestedPublicationAtUtc === null ||
      input.requestedPublicationAtUtc <= now)
  ) {
    throw validationIssue(
      "requestedPublicationLocal",
      "publication_time_not_future",
      "Choose a publication time in the future.",
    );
  }
  assertActionState(input.action, event.publicationStatus);
  const proposedContentVersion = event.contentVersion + 1;
  const nextPublicationStatus = publicationStatusForAction(
    input.action,
  );
  const jobId =
    input.action === "schedule_publication"
      ? `publication-job:${crypto.randomUUID()}`
      : null;
  const previousJobId =
    event.publicationStatus === "scheduled"
      ? await readPendingJobId(database, actor, event.id)
      : null;
  const revisionAction = revisionActionForPublication(input.action);
  const mutation: PublicationMutation = Object.freeze({
    action: input.action,
    event,
    jobId,
    previousJobId,
    nextPublicationStatus,
    now,
    proposedContentVersion,
    revisionAction,
  });
  const guard = await prepareOrganizerPublicationScheduleGuard(
    database,
    identity,
    {
      eventId,
      expectedContentVersion: event.contentVersion,
      expectedScheduleVersion: event.scheduleVersion,
      operation: input.action,
      proposedContentVersion,
    },
    now,
  );
  const fingerprint = await publicStateFingerprint({
    action: input.action,
    eventId,
    jobId,
    previousJobId,
    nextPublicationStatus,
    proposedContentVersion,
    requestedPublicationAtUtc: input.requestedPublicationAtUtc,
    scheduleVersion: event.scheduleVersion,
  });
  const publicationIntentId = `publication-intent:${crypto.randomUUID()}`;
  const statements: D1PreparedStatementLike[] = [
    guard.intentStatement,
    ...guard.authorizationStatements,
  ];
  const authorizationIndexes = guard.authorizationStatements.map(
    (_, index) => index + 1,
  );
  const publicationIntentIndex = statements.push(
    publicationIntentStatement(
      database,
      guard,
      mutation,
      publicationIntentId,
      fingerprint,
      "actor",
    ),
  ) - 1;
  if (input.action === "schedule_publication") {
    statements.push(
      publicationStateEnsureStatement(
        database,
        actor,
        event.id,
        now,
      ),
    );
    if (previousJobId) {
      statements.push(
        pendingJobTerminalStatement(
          database,
          actor.organizationId,
          event.id,
          previousJobId,
          "cancelled",
          null,
          now,
        ),
      );
    }
    statements.push(
      database
        .prepare(
          `INSERT INTO organizer_event_publication_jobs (
             id, organization_id, organizer_event_id,
             requested_publication_at_utc, original_timezone,
             bound_content_version, bound_schedule_version,
             authorizing_profile_id, state, attempted_at, terminal_at,
             failure_code, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?)`,
        )
        .bind(
          jobId,
          actor.organizationId,
          event.id,
          input.requestedPublicationAtUtc,
          input.originalTimezone,
          proposedContentVersion,
          event.scheduleVersion,
          actor.profileId,
          now,
          now,
        ),
    );
  } else if (
    input.action === "publish" &&
    event.publicationStatus === "scheduled"
  ) {
    if (!previousJobId) throw stalePublication();
    statements.push(
      pendingJobTerminalStatement(
        database,
        actor.organizationId,
        event.id,
        previousJobId,
        "cancelled",
        null,
        now,
      ),
    );
  }
  if (
    input.action === "publish"
  ) {
    statements.push(
      publicationStatePublishedStatement(
        database,
        actor,
        event.id,
        now,
      ),
    );
  } else if (input.action === "cancel_scheduled_publication") {
    if (!previousJobId) throw stalePublication();
    statements.push(
      pendingJobTerminalStatement(
        database,
        actor.organizationId,
        event.id,
        previousJobId,
        "cancelled",
        null,
        now,
      ),
      publicationStateUnpublishedStatement(
        database,
        actor,
        event.id,
        now,
      ),
    );
  } else if (input.action === "unpublish") {
    statements.push(
      publicationStateUnpublishedStatement(
        database,
        actor,
        event.id,
        now,
      ),
    );
  }
  const eventIndex = statements.length;
  statements.push(
    eventContentUpdateStatement(database, actor, mutation, undefined),
  );
  statements.push(
    publicationRevisionStatement(
      database,
      actor,
      mutation,
      publicRevisionSnapshot(event, mutation, null),
    ),
    publicationAuditStatement(
      database,
      actor,
      event.id,
      auditActionForPublication(input.action),
      mutation,
    ),
    ...publicationNotificationStatements(
      database,
      actor,
      event,
      notificationTypeForAction(input.action),
      now,
    ),
  );
  const conflictFinalizationIndex =
    guard.finalizationStatement === null
      ? null
      : statements.push(guard.finalizationStatement) - 1;
  statements.push(
    publicationIntentCompletionStatement(
      database,
      actor,
      publicationIntentId,
      event.id,
      now,
    ),
    guard.completionStatement,
  );
  await runPublicationBatch(database, statements, [
    0,
    ...authorizationIndexes,
    publicationIntentIndex,
    eventIndex,
    ...(conflictFinalizationIndex === null
      ? []
      : [conflictFinalizationIndex]),
    statements.length - 2,
    statements.length - 1,
  ], [
    ...authorizationIndexes.map((index) => ({
      expected: guard.authorizationExpectedChanges,
      index,
    })),
    ...(conflictFinalizationIndex === null
      ? []
      : [{
          expected: guard.authorizationExpectedChanges,
          index: conflictFinalizationIndex,
        }]),
  ]);
  const workspace = await readOrganizerPublicationWorkspace(
    database,
    identity,
    event.id,
  );
  return Object.freeze({
    outcome: outcomeForAction(input.action),
    workspace,
  });
}

/**
 * Bounded on-request reconciliation. There is intentionally no cron claim:
 * a due job is considered only when a relevant request invokes this service.
 * Each job owns one independent atomic batch so D1's statement envelope stays
 * bounded and a transient failure cannot make another event partially public.
 */
export async function reconcileDueOrganizerPublications(
  database: D1DatabaseLike,
  options: Readonly<{ limit?: number; now?: number }> = {},
): Promise<PublicationReconciliationResult> {
  const limit =
    options.limit === undefined
      ? 1
      : parseFiniteInteger(options.limit, {
          path: "limit",
          minimum: 1,
          maximum: 1,
        });
  const now =
    options.now === undefined
      ? await currentD1Time(database)
      : parseFiniteInteger(options.now, { path: "now", minimum: 0 });
  const result = await database
    .prepare(
      `SELECT job.id, job.organization_id, job.organizer_event_id,
              job.requested_publication_at_utc,
              job.bound_content_version, job.bound_schedule_version,
              job.authorizing_profile_id
       FROM organizer_event_publication_jobs AS job
       WHERE job.state = 'pending'
         AND job.requested_publication_at_utc <= ?
       ORDER BY job.requested_publication_at_utc, job.id
       LIMIT ?`,
    )
    .bind(now, limit)
    .all<Record<string, unknown>>();
  const jobs = (result.results ?? []).map(readDuePublicationJob);
  let executed = 0;
  let invalidated = 0;
  let transientFailures = 0;
  for (const job of jobs) {
    try {
      const originalActor = await readCurrentPublicationActorForJob(
        database,
        job,
      );
      if (!originalActor) {
        const recoveryActor = await readCurrentPublicationRecoveryActor(
          database,
          job.organizationId,
        );
        if (!recoveryActor) {
          transientFailures += 1;
          continue;
        }
        const recovered = await invalidateDuePublicationJob(
          database,
          recoveryActor,
          job,
          "authorizer_no_longer_eligible",
          now,
        );
        if (recovered) invalidated += 1;
        continue;
      }
      const event = await getOrganizerEventForAuthorizedActor(
        database,
        originalActor,
        job.organizerEventId,
      );
      if (
        event.publicationStatus !== "scheduled" ||
        event.contentVersion !== job.boundContentVersion ||
        event.scheduleVersion !== job.boundScheduleVersion
      ) {
        const recoveryActor = await readCurrentPublicationRecoveryActor(
          database,
          job.organizationId,
        );
        if (
          recoveryActor &&
          (await invalidateDuePublicationJob(
            database,
            recoveryActor,
            job,
            "bound_version_changed",
            now,
          ))
        ) {
          invalidated += 1;
        }
        continue;
      }
      const detailsRow = await readPublicDetailsRow(
        database,
        originalActor,
        event.id,
      );
      const hosts = await readHostOptions(database, originalActor, event);
      const missing = await publicationReadinessIssues(
        database,
        originalActor,
        event,
        detailsRow,
        hosts,
        false,
      );
      if (missing.length > 0) {
        const recoveryActor = await readCurrentPublicationRecoveryActor(
          database,
          job.organizationId,
        );
        if (
          recoveryActor &&
          (await invalidateDuePublicationJob(
            database,
            recoveryActor,
            job,
            "publication_readiness_changed",
            now,
          ))
        ) {
          invalidated += 1;
        }
        continue;
      }
      if (
        await executeDuePublicationJob(
          database,
          originalActor,
          event,
          job,
          now,
        )
      ) {
        executed += 1;
      }
    } catch (error) {
      const stillPending = await dueJobIsPending(database, job);
      if (!stillPending) continue;
      if (isDeterministicPublicationFailure(error)) {
        const recoveryActor = await readCurrentPublicationRecoveryActor(
          database,
          job.organizationId,
        );
        if (
          recoveryActor &&
          (await invalidateDuePublicationJob(
            database,
            recoveryActor,
            job,
            "publication_check_failed",
            now,
          ))
        ) {
          invalidated += 1;
        }
      } else {
        transientFailures += 1;
      }
    }
  }
  return Object.freeze({
    executed,
    inspected: jobs.length,
    invalidated,
    transientFailures,
  });
}

async function executeDuePublicationJob(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  event: OrganizerEventDto,
  job: DuePublicationJob,
  now: number,
): Promise<boolean> {
  const proposedContentVersion = event.contentVersion + 1;
  const guard =
    await prepareOrganizerPublicationScheduleGuardForAuthorizedActor(
      database,
      actor,
      {
        eventId: event.id,
        expectedContentVersion: event.contentVersion,
        expectedScheduleVersion: event.scheduleVersion,
        operation: "reconcile_publication",
        proposedContentVersion,
      },
      now,
    );
  const mutation: PublicationMutation = Object.freeze({
    action: "reconcile_publication",
    event,
    jobId: job.id,
    nextPublicationStatus: "published",
    now,
    previousJobId: null,
    proposedContentVersion,
    revisionAction: "publication_executed",
  });
  const fingerprint = await publicStateFingerprint({
    action: mutation.action,
    eventId: event.id,
    jobId: job.id,
    nextPublicationStatus: "published",
    proposedContentVersion,
    scheduleVersion: event.scheduleVersion,
  });
  const publicationIntentId = `publication-intent:${crypto.randomUUID()}`;
  const statements: D1PreparedStatementLike[] = [
    guard.intentStatement,
    ...guard.authorizationStatements,
  ];
  const authorizationIndexes = guard.authorizationStatements.map(
    (_, index) => index + 1,
  );
  const publicationIntentIndex = statements.push(
    publicationIntentStatement(
      database,
      guard,
      mutation,
      publicationIntentId,
      fingerprint,
      "reconciliation",
    ),
  ) - 1;
  const jobIndex = statements.push(
    database
      .prepare(
        `UPDATE organizer_event_publication_jobs
         SET state = 'executed',
             attempted_at = ?,
             terminal_at = ?,
             failure_code = NULL,
             updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND organizer_event_id = ?
           AND state = 'pending'
           AND requested_publication_at_utc <= ?
           AND bound_content_version = ?
           AND bound_schedule_version = ?`,
      )
      .bind(
        now,
        now,
        now,
        job.id,
        actor.organizationId,
        event.id,
        now,
        event.contentVersion,
        event.scheduleVersion,
      ),
  ) - 1;
  statements.push(
    publicationStatePublishedStatement(
      database,
      actor,
      event.id,
      now,
    ),
  );
  const eventIndex = statements.length;
  statements.push(
    eventContentUpdateStatement(database, actor, mutation, undefined),
    publicationRevisionStatement(
      database,
      actor,
      mutation,
      publicRevisionSnapshot(event, mutation, null),
    ),
    publicationAuditStatement(
      database,
      actor,
      event.id,
      "organizer_event.publication_executed",
      mutation,
    ),
    ...publicationNotificationStatements(
      database,
      actor,
      event,
      "event_published",
      now,
    ),
  );
  const conflictFinalizationIndex =
    guard.finalizationStatement === null
      ? null
      : statements.push(guard.finalizationStatement) - 1;
  statements.push(
    publicationIntentCompletionStatement(
      database,
      actor,
      publicationIntentId,
      event.id,
      now,
    ),
    guard.completionStatement,
  );
  try {
    await runPublicationBatch(database, statements, [
      0,
      ...authorizationIndexes,
      publicationIntentIndex,
      jobIndex,
      eventIndex,
      ...(conflictFinalizationIndex === null
        ? []
        : [conflictFinalizationIndex]),
      statements.length - 2,
      statements.length - 1,
    ], [
      ...authorizationIndexes.map((index) => ({
        expected: guard.authorizationExpectedChanges,
        index,
      })),
      ...(conflictFinalizationIndex === null
        ? []
        : [{
            expected: guard.authorizationExpectedChanges,
            index: conflictFinalizationIndex,
          }]),
    ]);
    return true;
  } catch (error) {
    if (!(await dueJobIsPending(database, job))) return false;
    throw error;
  }
}

async function invalidateDuePublicationJob(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  job: DuePublicationJob,
  failureCode: string,
  now: number,
): Promise<boolean> {
  const event = await getOrganizerEventForAuthorizedActor(
    database,
    actor,
    job.organizerEventId,
  );
  if (event.publicationStatus !== "scheduled") {
    return false;
  }
  const proposedContentVersion = event.contentVersion + 1;
  const guard =
    await prepareOrganizerPublicationScheduleGuardForAuthorizedActor(
      database,
      actor,
      {
        eventId: event.id,
        expectedContentVersion: event.contentVersion,
        expectedScheduleVersion: event.scheduleVersion,
        operation: "invalidate_scheduled_publication",
        proposedContentVersion,
      },
      now,
    );
  const mutation: PublicationMutation = Object.freeze({
    action: "invalidate_scheduled_publication",
    event,
    jobId: null,
    nextPublicationStatus: "unpublished",
    now,
    previousJobId: job.id,
    proposedContentVersion,
    revisionAction: "publication_cancelled",
  });
  const fingerprint = await publicStateFingerprint({
    action: mutation.action,
    eventId: event.id,
    failureCode,
    previousJobId: job.id,
    proposedContentVersion,
    scheduleVersion: event.scheduleVersion,
  });
  const publicationIntentId = `publication-intent:${crypto.randomUUID()}`;
  const statements: D1PreparedStatementLike[] = [
    guard.intentStatement,
    publicationIntentStatement(
      database,
      guard,
      mutation,
      publicationIntentId,
      fingerprint,
      "reconciliation",
    ),
    pendingJobTerminalStatement(
      database,
      actor.organizationId,
      event.id,
      job.id,
      "invalidated",
      failureCode,
      now,
    ),
    publicationStateUnpublishedStatement(
      database,
      actor,
      event.id,
      now,
    ),
  ];
  const eventIndex = statements.length;
  statements.push(
    eventContentUpdateStatement(database, actor, mutation, undefined),
    publicationRevisionStatement(
      database,
      actor,
      mutation,
      publicRevisionSnapshot(event, mutation, null),
    ),
    publicationAuditStatement(
      database,
      actor,
      event.id,
      "organizer_event.publication_invalidated",
      mutation,
    ),
    ...publicationNotificationStatements(
      database,
      actor,
      event,
      "publication_failed",
      now,
      true,
    ),
    publicationIntentCompletionStatement(
      database,
      actor,
      publicationIntentId,
      event.id,
      now,
    ),
    guard.completionStatement,
  );
  try {
    await runPublicationBatch(database, statements, [
      0,
      1,
      2,
      3,
      eventIndex,
      statements.length - 2,
      statements.length - 1,
    ]);
    return true;
  } catch (error) {
    if (!(await dueJobIsPending(database, job))) return false;
    throw error;
  }
}

async function readCurrentPublicationActorForJob(
  database: D1DatabaseLike,
  job: DuePublicationJob,
): Promise<AuthorizedMembership | null> {
  const row = await database
    .prepare(
      `SELECT membership.id AS membership_id,
              membership.organization_id,
              membership.profile_id,
              membership.role
       FROM organization_memberships AS membership
       JOIN profiles AS profile
         ON profile.id = membership.profile_id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
       JOIN organizer_events AS event
         ON event.id = ?
        AND event.organization_id = membership.organization_id
        AND event.deleted_at IS NULL
       WHERE membership.organization_id = ?
         AND membership.profile_id = ?
         AND membership.status = 'active'
         AND membership.deleted_at IS NULL
         AND (
           membership.role IN ('owner', 'administrator')
           OR (
             membership.role = 'organizer'
             AND EXISTS (
               SELECT 1
               FROM organization_publication_policies AS policy
               WHERE policy.organization_id = membership.organization_id
                 AND policy.organizer_self_publish_enabled = 1
             )
             AND EXISTS (
               SELECT 1
               FROM club_memberships AS club_membership
               WHERE club_membership.organization_id =
                     membership.organization_id
                 AND club_membership.club_id = event.club_id
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
                 WHERE association.organization_id =
                       membership.organization_id
                   AND association.organizer_event_id = event.id
                   AND association.profile_id = membership.profile_id
                   AND association.deleted_at IS NULL
               )
             )
           )
         )
       LIMIT 1`,
    )
    .bind(
      job.organizerEventId,
      job.organizationId,
      job.authorizingProfileId,
    )
    .first<Record<string, unknown>>();
  return row ? readAuthorizedMembership(row) : null;
}

async function readCurrentPublicationRecoveryActor(
  database: D1DatabaseLike,
  organizationId: string,
): Promise<AuthorizedMembership | null> {
  const row = await database
    .prepare(
      `SELECT membership.id AS membership_id,
              membership.organization_id,
              membership.profile_id,
              membership.role
       FROM organization_memberships AS membership
       JOIN profiles AS profile
         ON profile.id = membership.profile_id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
       WHERE membership.organization_id = ?
         AND membership.role IN ('owner', 'administrator')
         AND membership.status = 'active'
         AND membership.deleted_at IS NULL
       ORDER BY CASE membership.role WHEN 'owner' THEN 0 ELSE 1 END,
                membership.created_at,
                membership.id
       LIMIT 1`,
    )
    .bind(organizationId)
    .first<Record<string, unknown>>();
  return row ? readAuthorizedMembership(row) : null;
}

function readAuthorizedMembership(
  row: Record<string, unknown>,
): AuthorizedMembership {
  return Object.freeze({
    membershipId: parseIdentifier(row.membership_id, "membership.id"),
    organizationId: parseIdentifier(
      row.organization_id,
      "membership.organizationId",
    ),
    profileId: parseIdentifier(row.profile_id, "membership.profileId"),
    role: parseEnum(
      row.role,
      ["owner", "administrator", "organizer"] as const,
      "membership.role",
    ),
  });
}

function readDuePublicationJob(
  row: Record<string, unknown>,
): DuePublicationJob {
  return Object.freeze({
    authorizingProfileId: parseIdentifier(
      row.authorizing_profile_id,
      "publicationJob.authorizingProfileId",
    ),
    boundContentVersion: requiredInteger(row.bound_content_version),
    boundScheduleVersion: requiredInteger(row.bound_schedule_version),
    id: parseIdentifier(row.id, "publicationJob.id"),
    organizationId: parseIdentifier(
      row.organization_id,
      "publicationJob.organizationId",
    ),
    organizerEventId: parseIdentifier(
      row.organizer_event_id,
      "publicationJob.organizerEventId",
    ),
    requestedPublicationAtUtc: requiredInteger(
      row.requested_publication_at_utc,
    ),
  });
}

async function dueJobIsPending(
  database: D1DatabaseLike,
  job: DuePublicationJob,
): Promise<boolean> {
  const row = await database
    .prepare(
      `SELECT 1 AS pending
       FROM organizer_event_publication_jobs
       WHERE id = ?
         AND organization_id = ?
         AND organizer_event_id = ?
         AND state = 'pending'
       LIMIT 1`,
    )
    .bind(job.id, job.organizationId, job.organizerEventId)
    .first<Record<string, unknown>>();
  return row !== null;
}

function isDeterministicPublicationFailure(error: unknown): boolean {
  return (
    error instanceof SafeApplicationError &&
    [403, 404, 409, 422].includes(error.status)
  );
}

async function readPublicationPolicyByActor(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
): Promise<OrganizationPublicationPolicyDto> {
  const row = await database
    .prepare(
      `SELECT organizer_self_publish_enabled
       FROM organization_publication_policies
       WHERE organization_id = ?
       LIMIT 1`,
    )
    .bind(actor.organizationId)
    .first<Record<string, unknown>>();
  return Object.freeze({
    organizerSelfPublishEnabled:
      row?.organizer_self_publish_enabled === 1,
  });
}

async function readPublicDetailsRow(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
): Promise<Record<string, unknown> | null> {
  return database
    .prepare(
      `SELECT attendance_mode, public_location_name, public_address,
              public_access_note, public_online_url, external_map_url,
              cost_text, capacity, availability_state,
              preparation_information, what_to_bring, arrival_instructions,
              weather_note, verified_accessibility_notes,
              public_hosts_enabled, rsvp_mode,
              confirmed_meetup_event_url
       FROM organizer_event_public_details
       WHERE organization_id = ?
         AND organizer_event_id = ?
       LIMIT 1`,
    )
    .bind(actor.organizationId, eventId)
    .first<Record<string, unknown>>();
}

async function readHostOptions(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  event: OrganizerEventDto,
): Promise<readonly OrganizerPublicationHostOptionDto[]> {
  const result = await database
    .prepare(
      `SELECT profile.id,
              profile.display_name,
              CASE WHEN selected.profile_id IS NULL THEN 0 ELSE 1 END
                AS selected
       FROM profiles AS profile
       JOIN organization_memberships AS membership
         ON membership.organization_id = ?
        AND membership.profile_id = profile.id
        AND membership.status = 'active'
        AND membership.deleted_at IS NULL
       LEFT JOIN organizer_event_public_hosts AS selected
         ON selected.organization_id = membership.organization_id
        AND selected.organizer_event_id = ?
        AND selected.profile_id = profile.id
       WHERE profile.status = 'active'
         AND profile.deleted_at IS NULL
         AND profile.public_attribution_consent = 1
         AND profile.display_name IS NOT NULL
         AND length(trim(profile.display_name)) > 0
         AND instr(profile.display_name, '@') = 0
         AND lower(trim(profile.display_name)) <>
             lower(profile.normalized_email)
         AND (
           profile.id = ?
           OR EXISTS (
             SELECT 1
             FROM organizer_event_organizers AS association
             WHERE association.organization_id = membership.organization_id
               AND association.organizer_event_id = ?
               AND association.profile_id = profile.id
               AND association.deleted_at IS NULL
           )
         )
       ORDER BY profile.display_name COLLATE NOCASE, profile.id
       LIMIT 100`,
    )
    .bind(
      actor.organizationId,
      event.id,
      event.primaryOrganizerProfileId,
      event.id,
    )
    .all<Record<string, unknown>>();
  return Object.freeze(
    (result.results ?? []).map((row) =>
      Object.freeze({
        displayName: requiredString(row.display_name),
        eligible: true as const,
        profileId: parseIdentifier(row.id, "host.profileId"),
        selected: row.selected === 1,
      }),
    ),
  );
}

async function readPendingJob(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
): Promise<OrganizerPublicationWorkspaceDto["pendingJob"]> {
  const row = await database
    .prepare(
      `SELECT requested_publication_at_utc, original_timezone
       FROM organizer_event_publication_jobs
       WHERE organization_id = ?
         AND organizer_event_id = ?
         AND state = 'pending'
       LIMIT 1`,
    )
    .bind(actor.organizationId, eventId)
    .first<Record<string, unknown>>();
  return row
    ? Object.freeze({
        originalTimezone: parseIanaTimeZone(row.original_timezone),
        requestedPublicationAtUtc: requiredInteger(
          row.requested_publication_at_utc,
        ),
      })
    : null;
}

async function readPendingJobId(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
): Promise<string | null> {
  const row = await database
    .prepare(
      `SELECT id
       FROM organizer_event_publication_jobs
       WHERE organization_id = ?
         AND organizer_event_id = ?
         AND state = 'pending'
       LIMIT 1`,
    )
    .bind(actor.organizationId, eventId)
    .first<Record<string, unknown>>();
  return row ? parseIdentifier(row.id, "publicationJob.id") : null;
}

async function canActorEditPublicationEvent(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  event: OrganizerEventDto,
): Promise<boolean> {
  if (
    actor.role === "owner" ||
    actor.role === "administrator"
  ) {
    return true;
  }
  const allowed = await database
    .prepare(
      `SELECT 1 AS allowed
       FROM organization_memberships AS membership
       JOIN profiles AS profile
         ON profile.id = membership.profile_id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
       JOIN club_memberships AS club_membership
         ON club_membership.organization_id = membership.organization_id
        AND club_membership.club_id = ?
        AND club_membership.organization_membership_id = membership.id
        AND club_membership.profile_id = membership.profile_id
        AND club_membership.role = 'organizer'
        AND club_membership.status = 'active'
        AND club_membership.deleted_at IS NULL
       WHERE membership.id = ?
         AND membership.organization_id = ?
         AND membership.profile_id = ?
         AND membership.role = 'organizer'
         AND membership.status = 'active'
         AND membership.deleted_at IS NULL
         AND (
           ? = ?
           OR EXISTS (
             SELECT 1
             FROM organizer_event_organizers AS association
             WHERE association.organization_id = ?
               AND association.organizer_event_id = ?
               AND association.profile_id = ?
               AND association.deleted_at IS NULL
           )
         )
       LIMIT 1`,
    )
    .bind(
      event.clubId,
      actor.membershipId,
      actor.organizationId,
      actor.profileId,
      event.primaryOrganizerProfileId,
      actor.profileId,
      actor.organizationId,
      event.id,
      actor.profileId,
    )
    .first<Record<string, unknown>>();
  return allowed !== null;
}

async function publicationReadinessIssues(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  event: OrganizerEventDto,
  detailsRow: Record<string, unknown> | null,
  hostOptions: readonly OrganizerPublicationHostOptionDto[],
  canInspectConflictClearance = true,
): Promise<OrganizerPublicationReadinessIssue[]> {
  const issues: OrganizerPublicationReadinessIssue[] = [];
  if (event.planningStatus !== "confirmed") {
    issues.push(issue("confirmed_event_required", "Confirm the event first."));
  }
  if (event.schedule.shape === "unscheduled") {
    issues.push(issue("schedule_required", "Add a timed or all-day schedule."));
  }
  if (event.deletedAt !== null) {
    issues.push(issue("deleted_event", "Restore the event before publishing."));
  }
  if (!event.summary?.trim()) {
    issues.push(issue("summary_required", "Add a public summary.", "summary"));
  }
  if (!event.description?.trim()) {
    issues.push(
      issue("description_required", "Add a public description.", "description"),
    );
  }
  const publicClub = await database
    .prepare(
      `SELECT 1 AS valid
       FROM clubs AS club
       JOIN club_public_profiles AS public_profile
         ON public_profile.organization_id = club.organization_id
        AND public_profile.club_id = club.id
        AND public_profile.publication_status = 'published'
        AND public_profile.published_at IS NOT NULL
       WHERE club.id = ?
         AND club.organization_id = ?
         AND club.deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(event.clubId, actor.organizationId)
    .first<Record<string, unknown>>();
  if (!publicClub) {
    issues.push(
      issue("public_club_required", "Choose a publicly available club."),
    );
  }
  if (!detailsRow) {
    issues.push(
      issue(
        "public_details_required",
        "Complete the website publication details.",
      ),
    );
    return issues;
  }
  const details = detailsDto(detailsRow, event);
  if (details.attendanceMode === "location_undecided") {
    issues.push(
      issue(
        "attendance_mode_required",
        "Choose in-person, online, or hybrid attendance before publishing.",
        "attendanceMode",
      ),
    );
  }
  if (
    (details.attendanceMode === "in_person" ||
      details.attendanceMode === "hybrid") &&
    !details.publicLocationName
  ) {
    issues.push(
      issue(
        "public_location_required",
        "Add an approved public location name.",
        "publicLocationName",
      ),
    );
  }
  if (
    (details.attendanceMode === "online" ||
      details.attendanceMode === "hybrid") &&
    !details.publicOnlineUrl
  ) {
    issues.push(
      issue(
        "public_online_url_required",
        "Add the approved public online destination.",
        "publicOnlineUrl",
      ),
    );
  }
  if (
    details.rsvpMode === "meetup" &&
    (!event.meetupEventUrl || !details.meetupUrlConfirmed)
  ) {
    issues.push(
      issue(
        "meetup_confirmation_required",
        "Confirm the exact individual Meetup event link.",
        "meetupEventUrl",
      ),
    );
  }
  if (
    details.publicHostsEnabled &&
    !hostOptions.some((host) => host.selected)
  ) {
    issues.push(
      issue(
        "public_host_required",
        "Select at least one eligible, consented public host.",
        "selectedHostProfileIds",
      ),
    );
  }
  const slugCollision = await database
    .prepare(ORGANIZER_PUBLIC_SLUG_COLLISION_QUERY_SQL)
    .bind(actor.organizationId, event.id, event.slug)
    .first<Record<string, unknown>>();
  if (slugCollision) {
    issues.push(
      issue(
        "public_slug_conflict",
        "This permanent public address is already used by another event.",
      ),
    );
  }
  if (
    canInspectConflictClearance &&
    event.planningStatus === "confirmed" &&
    event.schedule.shape !== "unscheduled" &&
    event.deletedAt === null
  ) {
    try {
      await prepareOrganizerPublicationScheduleGuardForAuthorizedActor(
        database,
        actor,
        {
          eventId: event.id,
          expectedContentVersion: event.contentVersion,
          expectedScheduleVersion: event.scheduleVersion,
          operation: "publish",
          proposedContentVersion: event.contentVersion + 1,
        },
        await currentD1Time(database),
      );
    } catch (error) {
      if (
        error instanceof SafeApplicationError &&
        error.code === "conflict"
      ) {
        issues.push(
          issue(
            "conflict_clearance_required",
            "Resolve or authorize the current schedule overlap before publishing.",
          ),
        );
      } else {
        throw error;
      }
    }
  }
  return issues;
}

function parsePublicDetailsInput(value: unknown): ParsedPublicDetails &
  Readonly<{
    expectedContentVersion: number;
    expectedScheduleVersion: number;
  }> {
  const input = parseObject(value, "body");
  assertOnlyKeys(
    input,
    [
      "arrivalInstructions",
      "attendanceMode",
      "availabilityState",
      "capacity",
      "confirmMeetupEventUrl",
      "costText",
      "expectedContentVersion",
      "expectedScheduleVersion",
      "externalMapUrl",
      "meetupEventUrl",
      "preparationInformation",
      "publicAccessNote",
      "publicAddress",
      "publicHostsEnabled",
      "publicLocationName",
      "publicOnlineUrl",
      "rsvpMode",
      "selectedHostProfileIds",
      "verifiedAccessibilityNotes",
      "weatherNote",
      "whatToBring",
    ],
    "body",
  );
  const rsvpMode = parseEnum(
    input.rsvpMode,
    ["meetup", "coming_soon"] as const,
    "rsvpMode",
  );
  const meetupEventUrl =
    input.meetupEventUrl === null ||
    input.meetupEventUrl === undefined ||
    input.meetupEventUrl === ""
      ? null
      : parseOfficialMeetupEventUrl(
          input.meetupEventUrl,
          "meetupEventUrl",
        );
  const confirmMeetupEventUrl = parseBoolean(
    input.confirmMeetupEventUrl ?? false,
    "confirmMeetupEventUrl",
  );
  if (
    rsvpMode === "meetup" &&
    (!meetupEventUrl || !confirmMeetupEventUrl)
  ) {
    throw validationIssue(
      "meetupEventUrl",
      "meetup_event_confirmation_required",
      "Confirm the exact individual Meetup event page.",
    );
  }
  const selectedHostProfileIds = parseIdentifierList(
    input.selectedHostProfileIds,
    "selectedHostProfileIds",
  );
  return Object.freeze({
    arrivalInstructions: optionalText(
      input.arrivalInstructions,
      "arrivalInstructions",
      4_000,
    ),
    attendanceMode: parseEnum(
      input.attendanceMode,
      ["in_person", "online", "hybrid", "location_undecided"] as const,
      "attendanceMode",
    ),
    availabilityState: parseEnum(
      input.availabilityState,
      ["open", "full", "waitlist"] as const,
      "availabilityState",
    ),
    capacity:
      input.capacity === null ||
      input.capacity === undefined ||
      input.capacity === ""
        ? null
        : parseFiniteInteger(input.capacity, {
            path: "capacity",
            minimum: 1,
            maximum: 1_000_000,
          }),
    confirmedMeetupEventUrl:
      rsvpMode === "meetup" ? meetupEventUrl : null,
    costText: optionalText(input.costText, "costText", 500),
    expectedContentVersion: parseFiniteInteger(
      input.expectedContentVersion,
      { path: "expectedContentVersion", minimum: 1 },
    ),
    expectedScheduleVersion: parseFiniteInteger(
      input.expectedScheduleVersion,
      { path: "expectedScheduleVersion", minimum: 1 },
    ),
    externalMapUrl: optionalHttpsUrl(
      input.externalMapUrl,
      "externalMapUrl",
    ),
    meetupEventUrl,
    preparationInformation: optionalText(
      input.preparationInformation,
      "preparationInformation",
      4_000,
    ),
    publicAccessNote: optionalText(
      input.publicAccessNote,
      "publicAccessNote",
      2_000,
    ),
    publicAddress: optionalText(
      input.publicAddress,
      "publicAddress",
      500,
    ),
    publicHostsEnabled: parseBoolean(
      input.publicHostsEnabled ?? false,
      "publicHostsEnabled",
    ),
    publicLocationName: optionalText(
      input.publicLocationName,
      "publicLocationName",
      250,
    ),
    publicOnlineUrl: optionalHttpsUrl(
      input.publicOnlineUrl,
      "publicOnlineUrl",
    ),
    rsvpMode,
    selectedHostProfileIds,
    verifiedAccessibilityNotes: optionalText(
      input.verifiedAccessibilityNotes,
      "verifiedAccessibilityNotes",
      4_000,
    ),
    weatherNote: optionalText(input.weatherNote, "weatherNote", 2_000),
    whatToBring: optionalText(input.whatToBring, "whatToBring", 4_000),
  });
}

function parsePublicationAction(value: unknown): ParsedAction {
  const input = parseObject(value, "body");
  assertOnlyKeys(
    input,
    [
      "action",
      "expectedContentVersion",
      "expectedScheduleVersion",
      "originalTimezone",
      "requestedPublicationLocal",
    ],
    "body",
  );
  const action = parseEnum(
    input.action,
    ORGANIZER_PUBLICATION_ACTIONS,
    "action",
  );
  const originalTimezone =
    action === "schedule_publication"
      ? parseIanaTimeZone(
          input.originalTimezone ?? "America/Vancouver",
          "originalTimezone",
        )
      : null;
  const requestedPublicationAtUtc =
    action === "schedule_publication"
      ? localDateTimeToUtcMs(
          input.requestedPublicationLocal,
          originalTimezone ?? "America/Vancouver",
          "reject",
        )
      : null;
  return Object.freeze({
    action,
    expectedContentVersion: parseFiniteInteger(
      input.expectedContentVersion,
      { path: "expectedContentVersion", minimum: 1 },
    ),
    expectedScheduleVersion: parseFiniteInteger(
      input.expectedScheduleVersion,
      { path: "expectedScheduleVersion", minimum: 1 },
    ),
    originalTimezone,
    requestedPublicationAtUtc,
  });
}

async function validateSelectedHosts(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  event: OrganizerEventDto,
  selected: readonly string[],
): Promise<readonly string[]> {
  const options = await readHostOptions(database, actor, event);
  const eligible = new Set(options.map((option) => option.profileId));
  if (!selected.every((profileId) => eligible.has(profileId))) {
    throw validationIssue(
      "selectedHostProfileIds",
      "ineligible_public_host",
      "Select only current organizers who have opted into public attribution.",
    );
  }
  return Object.freeze([...new Set(selected)].sort());
}

function publicationIntentStatement(
  database: D1DatabaseLike,
  guard: Awaited<
    ReturnType<typeof prepareOrganizerPublicationScheduleGuard>
  >,
  mutation: PublicationMutation,
  intentId: string,
  fingerprint: string,
  executionKind: "actor" | "reconciliation",
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO organizer_event_publication_write_intents (
         id, organization_id, organizer_event_id, schedule_write_intent_id,
         actor_profile_id, operation, expected_publication_status,
         proposed_publication_status, expected_content_version,
         expected_schedule_version, proposed_content_version,
         proposed_schedule_version, public_state_fingerprint,
         publication_job_id, previous_publication_job_id,
         execution_kind, created_at, completed_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
       WHERE ? = 0 OR changes() = ?`,
    )
    .bind(
      intentId,
      guard.event.organizationId,
      guard.event.eventId,
      guard.intentId,
      guard.event.actor.profileId,
      mutation.action,
      mutation.event.publicationStatus,
      mutation.nextPublicationStatus,
      mutation.event.contentVersion,
      mutation.event.scheduleVersion,
      mutation.proposedContentVersion,
      mutation.event.scheduleVersion,
      fingerprint,
      mutation.jobId,
      mutation.previousJobId,
      executionKind,
      mutation.now,
      guard.authorizationExpectedChanges,
      guard.authorizationExpectedChanges,
    );
}

function publicDetailsUpsertStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  event: OrganizerEventDto,
  input: ParsedPublicDetails,
  now: number,
): D1PreparedStatementLike {
  const confirmed =
    input.rsvpMode === "meetup"
      ? input.confirmedMeetupEventUrl
      : null;
  return database
    .prepare(
      `INSERT INTO organizer_event_public_details (
         organizer_event_id, organization_id, attendance_mode,
         public_location_name, public_address, public_access_note,
         public_online_url, external_map_url, cost_text, capacity,
         availability_state, preparation_information, what_to_bring,
         arrival_instructions, weather_note, verified_accessibility_notes,
         public_hosts_enabled, rsvp_mode, confirmed_meetup_event_url,
         meetup_url_confirmed_by_profile_id, meetup_url_confirmed_at,
         created_by_profile_id, updated_by_profile_id, created_at, updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?
       )
       ON CONFLICT(organizer_event_id) DO UPDATE SET
         attendance_mode = excluded.attendance_mode,
         public_location_name = excluded.public_location_name,
         public_address = excluded.public_address,
         public_access_note = excluded.public_access_note,
         public_online_url = excluded.public_online_url,
         external_map_url = excluded.external_map_url,
         cost_text = excluded.cost_text,
         capacity = excluded.capacity,
         availability_state = excluded.availability_state,
         preparation_information = excluded.preparation_information,
         what_to_bring = excluded.what_to_bring,
         arrival_instructions = excluded.arrival_instructions,
         weather_note = excluded.weather_note,
         verified_accessibility_notes =
           excluded.verified_accessibility_notes,
         public_hosts_enabled = excluded.public_hosts_enabled,
         rsvp_mode = excluded.rsvp_mode,
         confirmed_meetup_event_url =
           excluded.confirmed_meetup_event_url,
         meetup_url_confirmed_by_profile_id =
           excluded.meetup_url_confirmed_by_profile_id,
         meetup_url_confirmed_at = excluded.meetup_url_confirmed_at,
         updated_by_profile_id = excluded.updated_by_profile_id,
         updated_at = excluded.updated_at`,
    )
    .bind(
      event.id,
      actor.organizationId,
      input.attendanceMode,
      input.publicLocationName,
      input.publicAddress,
      input.publicAccessNote,
      input.publicOnlineUrl,
      input.externalMapUrl,
      input.costText,
      input.capacity,
      input.availabilityState,
      input.preparationInformation,
      input.whatToBring,
      input.arrivalInstructions,
      input.weatherNote,
      input.verifiedAccessibilityNotes,
      input.publicHostsEnabled ? 1 : 0,
      input.rsvpMode,
      confirmed,
      confirmed ? actor.profileId : null,
      confirmed ? now : null,
      actor.profileId,
      actor.profileId,
      now,
      now,
    );
}

function publicHostInsertStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  event: OrganizerEventDto,
  profileId: string,
  now: number,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO organizer_event_public_hosts (
         id, organization_id, organizer_event_id, profile_id,
         selected_by_profile_id, selected_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `public-host:${crypto.randomUUID()}`,
      actor.organizationId,
      event.id,
      profileId,
      actor.profileId,
      now,
    );
}

function eventContentUpdateStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  mutation: PublicationMutation,
  meetupEventUrl: string | null | undefined,
): D1PreparedStatementLike {
  return database
    .prepare(
      `UPDATE organizer_events
       SET publication_status = ?,
           meetup_event_url =
             CASE WHEN ? = 1 THEN ? ELSE meetup_event_url END,
           content_version = ?,
           updated_by_profile_id = ?,
           updated_at = ?
       WHERE id = ?
         AND organization_id = ?
         AND content_version = ?
         AND schedule_version = ?
         AND publication_status = ?
         AND deleted_at IS NULL`,
    )
    .bind(
      mutation.nextPublicationStatus,
      meetupEventUrl === undefined ? 0 : 1,
      meetupEventUrl ?? null,
      mutation.proposedContentVersion,
      actor.profileId,
      mutation.now,
      mutation.event.id,
      actor.organizationId,
      mutation.event.contentVersion,
      mutation.event.scheduleVersion,
      mutation.event.publicationStatus,
    );
}

function publicationStatePublishedStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
  now: number,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO organizer_event_publication_state (
         organizer_event_id, organization_id, first_published_at,
         most_recent_published_at, most_recent_unpublished_at,
         public_cancellation_at, last_mutation_actor_profile_id,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)
       ON CONFLICT(organizer_event_id) DO UPDATE SET
         first_published_at =
           COALESCE(organizer_event_publication_state.first_published_at,
                    excluded.first_published_at),
         most_recent_published_at = excluded.most_recent_published_at,
         public_cancellation_at = NULL,
         last_mutation_actor_profile_id =
           excluded.last_mutation_actor_profile_id,
         updated_at = excluded.updated_at`,
    )
    .bind(
      eventId,
      actor.organizationId,
      now,
      now,
      actor.profileId,
      now,
      now,
    );
}

function publicationStateEnsureStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
  now: number,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO organizer_event_publication_state (
         organizer_event_id, organization_id, first_published_at,
         most_recent_published_at, most_recent_unpublished_at,
         public_cancellation_at, last_mutation_actor_profile_id,
         created_at, updated_at
       ) VALUES (?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)
       ON CONFLICT(organizer_event_id) DO UPDATE SET
         last_mutation_actor_profile_id =
           excluded.last_mutation_actor_profile_id,
         updated_at = excluded.updated_at`,
    )
    .bind(
      eventId,
      actor.organizationId,
      actor.profileId,
      now,
      now,
    );
}

function publicationStateUnpublishedStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
  now: number,
): D1PreparedStatementLike {
  return database
    .prepare(
      `UPDATE organizer_event_publication_state
       SET most_recent_unpublished_at = ?,
           last_mutation_actor_profile_id = ?,
           updated_at = ?
       WHERE organizer_event_id = ?
         AND organization_id = ?`,
    )
    .bind(now, actor.profileId, now, eventId, actor.organizationId);
}

function pendingJobTerminalStatement(
  database: D1DatabaseLike,
  organizationId: string,
  eventId: string,
  jobId: string,
  state: "cancelled" | "invalidated",
  failureCode: string | null,
  now: number,
): D1PreparedStatementLike {
  return database
    .prepare(
      `UPDATE organizer_event_publication_jobs
       SET state = ?,
           attempted_at = COALESCE(attempted_at, ?),
           terminal_at = ?,
           failure_code = ?,
           updated_at = ?
       WHERE organization_id = ?
         AND organizer_event_id = ?
         AND id = ?
         AND state = 'pending'`,
    )
    .bind(
      state,
      now,
      now,
      failureCode,
      now,
      organizationId,
      eventId,
      jobId,
    );
}

function publicationRevisionStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  mutation: PublicationMutation,
  snapshot: Readonly<Record<string, unknown>>,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO organizer_event_revisions (
         id, organization_id, organizer_event_id, content_version,
         schedule_version, action, snapshot_json, actor_profile_id,
         created_at
       ) VALUES (
         ?, ?,
         CASE WHEN changes() >= 1 THEN ? ELSE NULL END,
         ?, ?, ?, ?, ?, ?
       )`,
    )
    .bind(
      `organizer-event-revision:${crypto.randomUUID()}`,
      actor.organizationId,
      mutation.event.id,
      mutation.proposedContentVersion,
      mutation.event.scheduleVersion,
      mutation.revisionAction,
      JSON.stringify(snapshot),
      actor.profileId,
      mutation.now,
    );
}

function publicationAuditStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  eventId: string,
  action: string,
  mutation: PublicationMutation,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action,
         entity_type, entity_id, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, 'organizer_event', ?, ?, ?)`,
    )
    .bind(
      `audit:${crypto.randomUUID()}`,
      actor.organizationId,
      actor.profileId,
      action,
      eventId,
      JSON.stringify({
        contentVersion: mutation.proposedContentVersion,
        publicationStatus: mutation.nextPublicationStatus,
        scheduleVersion: mutation.event.scheduleVersion,
      }),
      mutation.now,
    );
}

function publicationIntentCompletionStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  intentId: string,
  eventId: string,
  now: number,
): D1PreparedStatementLike {
  return database
    .prepare(
      `UPDATE organizer_event_publication_write_intents
       SET completed_at = ?
       WHERE id = ?
         AND organization_id = ?
         AND organizer_event_id = ?
         AND completed_at IS NULL`,
    )
    .bind(now, intentId, actor.organizationId, eventId);
}

function publicationNotificationStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  event: OrganizerEventDto,
  type:
    | "event_published"
    | "publication_failed"
    | "publication_scheduled"
    | "public_event_cancelled"
    | null,
  now: number,
  includeActor = false,
): D1PreparedStatementLike[] {
  if (!type) return [];
  const recipients = [
    ...(includeActor ? [actor.profileId] : []),
    event.primaryOrganizerProfileId,
    ...event.coOrganizerProfileIds,
  ];
  return [...new Set(recipients)]
    .filter((profileId) => includeActor || profileId !== actor.profileId)
    .map((profileId) =>
      prepareNotificationInsert(database, {
        createdAt: now,
        id: `notification:${type}:${event.id}:${event.contentVersion + 1}:${profileId}`,
        organizationId: actor.organizationId,
        payload: {
          eventId: event.id,
          title: event.title.slice(0, 160),
          type,
        },
        recipientProfileId: profileId,
      }),
    );
}

async function runPublicationBatch(
  database: D1DatabaseLike,
  statements: D1PreparedStatementLike[],
  guardedIndexes: readonly number[],
  exactChanges: readonly Readonly<{
    expected: number;
    index: number;
  }>[] = [],
): Promise<void> {
  try {
    const results = await database.batch(statements);
    if (
      guardedIndexes.some((index) => changes(results[index]) < 1)
      || exactChanges.some(
        ({ expected, index }) => changes(results[index]) !== expected,
      )
    ) {
      throw stalePublication();
    }
  } catch (error) {
    if (error instanceof SafeApplicationError) throw error;
    const schedulingError = mapSchedulingDatabaseError(error);
    if (schedulingError instanceof SafeApplicationError) {
      throw schedulingError;
    }
    const message =
      error instanceof Error
        ? `${error.message} ${String(
            (error as Error & { cause?: unknown }).cause ?? "",
          )}`
        : String(error);
    if (
      /phase5_|organizer_event_revision_mismatch|UNIQUE constraint failed: organizer_event_publication_jobs.organizer_event_id/iu.test(
        message,
      )
    ) {
      if (/slug|readiness|host|confirmation/iu.test(message)) {
        throw new SafeApplicationError(
          "validation_failed",
          422,
          "The event is not ready for website publication.",
        );
      }
      if (/authorization|membership|profile|club/iu.test(message)) {
        throw new SafeApplicationError(
          "authorization_denied",
          403,
          "Your current organizer access does not allow this action.",
        );
      }
      throw stalePublication();
    }
    throw error;
  }
}

function detailsDto(
  row: Record<string, unknown>,
  event: OrganizerEventDto,
): OrganizerPublicationDetailsDto {
  const attendanceMode = parseEnum(
    row.attendance_mode,
    ["in_person", "online", "hybrid", "location_undecided"] as const,
    "publicDetails.attendanceMode",
  );
  const availabilityState = parseEnum(
    row.availability_state,
    ["open", "full", "waitlist"] as const,
    "publicDetails.availabilityState",
  );
  const rsvpMode = parseEnum(
    row.rsvp_mode,
    ["meetup", "coming_soon"] as const,
    "publicDetails.rsvpMode",
  );
  const confirmed = optionalString(row.confirmed_meetup_event_url);
  return Object.freeze({
    arrivalInstructions: optionalString(row.arrival_instructions),
    attendanceMode,
    availabilityState,
    capacity: optionalInteger(row.capacity),
    costText: optionalString(row.cost_text),
    externalMapUrl: optionalString(row.external_map_url),
    meetupUrlConfirmed:
      rsvpMode === "meetup" &&
      confirmed !== null &&
      confirmed === event.meetupEventUrl,
    preparationInformation: optionalString(
      row.preparation_information,
    ),
    publicAccessNote: optionalString(row.public_access_note),
    publicAddress: optionalString(row.public_address),
    publicHostsEnabled: row.public_hosts_enabled === 1,
    publicLocationName: optionalString(row.public_location_name),
    publicOnlineUrl: optionalString(row.public_online_url),
    rsvpMode,
    verifiedAccessibilityNotes: optionalString(
      row.verified_accessibility_notes,
    ),
    weatherNote: optionalString(row.weather_note),
    whatToBring: optionalString(row.what_to_bring),
  });
}

function publicRevisionSnapshot(
  event: OrganizerEventDto,
  mutation: PublicationMutation,
  details: ParsedPublicDetails | null,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    attendanceMode: details?.attendanceMode ?? null,
    availabilityState: details?.availabilityState ?? null,
    contentVersion: mutation.proposedContentVersion,
    eventId: event.id,
    planningStatus: event.planningStatus,
    publicationStatus: mutation.nextPublicationStatus,
    rsvpMode: details?.rsvpMode ?? null,
    scheduleVersion: event.scheduleVersion,
    selectedPublicHostCount:
      details?.selectedHostProfileIds.length ?? null,
  });
}

function requireExpectedVersions(
  event: OrganizerEventDto,
  input: Readonly<{
    expectedContentVersion: number;
    expectedScheduleVersion: number;
  }>,
): void {
  if (
    event.contentVersion !== input.expectedContentVersion ||
    event.scheduleVersion !== input.expectedScheduleVersion
  ) {
    throw stalePublication();
  }
}

function assertActionState(
  action: OrganizerPublicationAction,
  status: EventPublicationStatus,
): void {
  const allowed =
    action === "publish"
      ? ["private", "scheduled", "unpublished"].includes(status)
      : action === "schedule_publication"
        ? ["private", "scheduled", "unpublished"].includes(status)
        : action === "cancel_scheduled_publication"
          ? status === "scheduled"
          : status === "published";
  if (!allowed) {
    throw new SafeApplicationError(
      "validation_failed",
      422,
      "That website publication action is not available from the current state.",
    );
  }
}

function publicationStatusForAction(
  action: OrganizerPublicationAction,
): EventPublicationStatus {
  if (action === "publish") return "published";
  if (action === "schedule_publication") return "scheduled";
  return "unpublished";
}

function revisionActionForPublication(
  action: OrganizerPublicationAction,
): PublicationMutation["revisionAction"] {
  if (action === "publish") return "published";
  if (action === "schedule_publication") return "publication_scheduled";
  if (action === "cancel_scheduled_publication") {
    return "publication_cancelled";
  }
  return "unpublished";
}

function auditActionForPublication(
  action: OrganizerPublicationAction,
): string {
  if (action === "publish") return "organizer_event.published";
  if (action === "schedule_publication") {
    return "organizer_event.publication_scheduled";
  }
  if (action === "cancel_scheduled_publication") {
    return "organizer_event.publication_cancelled";
  }
  return "organizer_event.unpublished";
}

function notificationTypeForAction(
  action: OrganizerPublicationAction,
):
  | "event_published"
  | "publication_scheduled"
  | "public_event_cancelled"
  | null {
  if (action === "publish") return "event_published";
  if (action === "schedule_publication") return "publication_scheduled";
  return null;
}

function outcomeForAction(
  action: OrganizerPublicationAction,
): OrganizerPublicationActionResult["outcome"] {
  if (action === "publish") return "published";
  if (action === "schedule_publication") return "publication_scheduled";
  if (action === "cancel_scheduled_publication") {
    return "publication_cancelled";
  }
  return "unpublished";
}

function parseIdentifierList(
  value: unknown,
  path: string,
): readonly string[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw validationIssue(
      path,
      "invalid_list",
      "Expected a bounded list of identifiers.",
    );
  }
  const parsed = value.map((entry, index) =>
    parseIdentifier(entry, `${path}.${index}`),
  );
  if (new Set(parsed).size !== parsed.length) {
    throw validationIssue(
      path,
      "duplicate_identifier",
      "The list contains a duplicate selection.",
    );
  }
  return Object.freeze(parsed);
}

function optionalText(
  value: unknown,
  path: string,
  maxLength: number,
): string | null {
  return parseOptionalBoundedString(value, { path, maxLength });
}

function optionalHttpsUrl(value: unknown, path: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return parseHttpsUrl(value, path);
}

function parseBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw validationIssue(path, "invalid_boolean", "Expected true or false.");
  }
  return value;
}

function issue(
  code: string,
  label: string,
  field?: string,
): OrganizerPublicationReadinessIssue {
  return Object.freeze(field ? { code, field, label } : { code, label });
}

function stalePublication(): SafeApplicationError {
  return new SafeApplicationError(
    "stale_edit",
    409,
    "This event changed before the website publication action completed. Refresh and try again.",
  );
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw publicationDataUnavailable();
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value);
}

function requiredInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw publicationDataUnavailable();
  }
  return value;
}

function optionalInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return requiredInteger(value);
}

function changes(value: unknown): number {
  if (
    typeof value !== "object" ||
    value === null ||
    !("meta" in value) ||
    typeof (value as { meta?: unknown }).meta !== "object" ||
    (value as { meta?: unknown }).meta === null
  ) {
    return 0;
  }
  const count = (value as { meta: { changes?: unknown } }).meta.changes;
  return typeof count === "number" && Number.isSafeInteger(count)
    ? count
    : 0;
}

function publicationDataUnavailable(): SafeApplicationError {
  return new SafeApplicationError(
    "service_unavailable",
    503,
    "Website publication data is temporarily unavailable.",
  );
}

async function publicStateFingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${stableJson(entry)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export { DEFAULT_DETAILS as DEFAULT_ORGANIZER_PUBLICATION_DETAILS };
