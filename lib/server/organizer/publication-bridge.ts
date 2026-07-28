import type {
  AuthorizedMembership,
  D1DatabaseLike,
  D1PreparedStatementLike,
} from "../auth";
import type { EventPublicationStatus } from "./lifecycle";
import { SafeApplicationError } from "../../validation/server-observability";

export type CanonicalPublicationEvent = Readonly<{
  contentVersion: number;
  id: string;
  organizationId: string;
  publicationStatus: EventPublicationStatus;
  scheduleVersion: number;
}>;

export type CanonicalEventPublicationMutationGuard = Readonly<{
  completionStatement: D1PreparedStatementLike;
  intentStatement: D1PreparedStatementLike;
  nextPublicationStatus: EventPublicationStatus;
  preMutationStatements: readonly D1PreparedStatementLike[];
}>;

export type CanonicalPublicationMutationOperation =
  | "public_cancel"
  | "restore_cancelled"
  | "unpublish"
  | "update_published"
  | "update_scheduled"
  | "update_unpublished";

/**
 * Adds the Phase 5 envelope to a canonical Phase 3/4 mutation without creating
 * a second event write path. Scheduled edits retire the exact pending job and
 * become unpublished; published edits stay published and are revalidated by
 * the fail-closed runtime guards after the canonical row changes.
 */
export async function prepareCanonicalEventPublicationMutationGuard(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  event: CanonicalPublicationEvent,
  input: Readonly<{
    authorizationExpectedChanges?: number;
    now: number;
    operation?: CanonicalPublicationMutationOperation;
    nextPublicationStatus?: EventPublicationStatus;
    proposedContentVersion: number;
    proposedScheduleVersion: number;
    scheduleWriteIntentId: string;
    stateEffect?:
      | "none"
      | "public_cancelled"
      | "restored_unpublished"
      | "unpublished";
    previousJobDisposition?: "cancelled" | "invalidated";
  }>,
): Promise<CanonicalEventPublicationMutationGuard | null> {
  const operation =
    input.operation ??
    (event.publicationStatus === "published"
      ? "update_published"
      : event.publicationStatus === "scheduled"
        ? "update_scheduled"
        : event.publicationStatus === "unpublished"
          ? "update_unpublished"
          : null);
  if (!operation) {
    return null;
  }
  const nextPublicationStatus =
    input.nextPublicationStatus ??
    (event.publicationStatus === "scheduled"
      ? ("unpublished" as const)
      : event.publicationStatus);
  const previousJobId =
    event.publicationStatus === "scheduled"
      ? await readPendingJobId(database, actor, event.id)
      : null;
  if (event.publicationStatus === "scheduled" && !previousJobId) {
    throw stalePublication();
  }
  const fingerprint = await fingerprintOf({
    eventId: event.id,
    operation,
    previousJobId,
    proposedContentVersion: input.proposedContentVersion,
    proposedScheduleVersion: input.proposedScheduleVersion,
    publicationStatus: nextPublicationStatus,
  });
  const publicationIntentId = `publication-intent:${crypto.randomUUID()}`;
  const intentStatement = database
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
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?,
              'actor', ?, NULL
       WHERE ? = 0 OR changes() = ?`,
    )
    .bind(
      publicationIntentId,
      actor.organizationId,
      event.id,
      input.scheduleWriteIntentId,
      actor.profileId,
      operation,
      event.publicationStatus,
      nextPublicationStatus,
      event.contentVersion,
      event.scheduleVersion,
      input.proposedContentVersion,
      input.proposedScheduleVersion,
      fingerprint,
      previousJobId,
      input.now,
      input.authorizationExpectedChanges ?? 0,
      input.authorizationExpectedChanges ?? 0,
    );
  const preMutationStatements: D1PreparedStatementLike[] = [];
  if (previousJobId) {
    const disposition =
      input.previousJobDisposition ??
      (operation === "public_cancel" ? "cancelled" : "invalidated");
    preMutationStatements.push(
      database
        .prepare(
          `UPDATE organizer_event_publication_jobs
           SET state = ?,
               attempted_at = COALESCE(attempted_at, ?),
               terminal_at = ?,
               failure_code = ?,
               updated_at = ?
           WHERE id = ?
             AND organization_id = ?
             AND organizer_event_id = ?
             AND state = 'pending'`,
        )
        .bind(
          disposition,
          input.now,
          input.now,
          disposition === "invalidated"
            ? "canonical_event_changed"
            : null,
          input.now,
          previousJobId,
          actor.organizationId,
          event.id,
        ),
    );
  }
  const stateEffect =
    input.stateEffect ??
    (operation === "public_cancel" &&
    event.publicationStatus === "published"
      ? "public_cancelled"
      : operation === "restore_cancelled"
        ? "restored_unpublished"
        : nextPublicationStatus === "unpublished" &&
            event.publicationStatus !== "unpublished"
          ? "unpublished"
          : "none");
  if (stateEffect === "public_cancelled") {
    preMutationStatements.push(
      database
        .prepare(
          `UPDATE organizer_event_publication_state
           SET public_cancellation_at = ?,
               last_mutation_actor_profile_id = ?,
               updated_at = ?
           WHERE organizer_event_id = ?
             AND organization_id = ?
             AND first_published_at IS NOT NULL
             AND most_recent_published_at IS NOT NULL`,
        )
        .bind(
          input.now,
          actor.profileId,
          input.now,
          event.id,
          actor.organizationId,
        ),
    );
  } else if (
    stateEffect === "unpublished" ||
    stateEffect === "restored_unpublished"
  ) {
    preMutationStatements.push(
      database
        .prepare(
          `INSERT INTO organizer_event_publication_state (
             organizer_event_id, organization_id, first_published_at,
             most_recent_published_at, most_recent_unpublished_at,
             public_cancellation_at, last_mutation_actor_profile_id,
             created_at, updated_at
           ) VALUES (?, ?, NULL, NULL, ?, NULL, ?, ?, ?)
           ON CONFLICT(organizer_event_id) DO UPDATE SET
             most_recent_unpublished_at = excluded.most_recent_unpublished_at,
             public_cancellation_at = NULL,
             last_mutation_actor_profile_id =
               excluded.last_mutation_actor_profile_id,
             updated_at = excluded.updated_at
           WHERE organizer_event_publication_state.organization_id =
                 excluded.organization_id`,
        )
        .bind(
          event.id,
          actor.organizationId,
          input.now,
          actor.profileId,
          input.now,
          input.now,
        ),
    );
  }
  if (
    nextPublicationStatus === "unpublished" ||
    stateEffect === "restored_unpublished"
  ) {
    preMutationStatements.push(
      database
        .prepare(
          `UPDATE media_usage_references
           SET deleted_at = ?
           WHERE organization_id = ?
             AND entity_type = 'organizer_event'
             AND entity_id = ?
             AND usage_kind = 'event_artwork'
             AND publication_scope = 'published'
             AND deleted_at IS NULL`,
        )
        .bind(
          input.now,
          actor.organizationId,
          event.id,
        ),
    );
  }
  return Object.freeze({
    completionStatement: database
      .prepare(
        `UPDATE organizer_event_publication_write_intents
         SET completed_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND organizer_event_id = ?
           AND completed_at IS NULL`,
      )
      .bind(
        input.now,
        publicationIntentId,
        actor.organizationId,
        event.id,
      ),
    intentStatement,
    nextPublicationStatus,
    preMutationStatements: Object.freeze(preMutationStatements),
  });
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
  return typeof row?.id === "string" ? row.id : null;
}

async function fingerprintOf(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stalePublication(): SafeApplicationError {
  return new SafeApplicationError(
    "stale_edit",
    409,
    "This event's website publication state changed. Refresh and try again.",
  );
}
