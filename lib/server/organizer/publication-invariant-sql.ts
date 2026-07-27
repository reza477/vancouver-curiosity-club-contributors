/**
 * Phase 5 database-enforced publication invariants.
 *
 * Sites tokenizes packaged migrations at semicolons, so these complete trigger
 * statements are installed only through the server-only invariant initializer,
 * one prepared statement at a time. No private copy or event content is stored
 * in a trigger definition.
 */

function publicationOperationScheduleMappingSql(
  publicationOperationSql: string,
  scheduleIntentAlias = "schedule_intent",
): string {
  return String.raw`
(
  ${scheduleIntentAlias}.operation = ${publicationOperationSql}
  OR (
    ${publicationOperationSql} = 'public_cancel'
    AND ${scheduleIntentAlias}.operation IN ('public_cancel', 'cancel')
  )
  OR (
    ${publicationOperationSql} = 'restore_cancelled'
    AND ${scheduleIntentAlias}.operation IN ('restore', 'restore_cancelled')
  )
  OR (
    ${publicationOperationSql} = 'update_published'
    AND ${scheduleIntentAlias}.operation IN ('update', 'complete')
  )
  OR (
    ${publicationOperationSql} = 'update_scheduled'
    AND ${scheduleIntentAlias}.operation IN (
      'update', 'soft_delete', 'archive', 'complete'
    )
  )
  OR (
    ${publicationOperationSql} = 'update_unpublished'
    AND ${scheduleIntentAlias}.operation IN (
      'update_unpublished', 'update', 'place_hold', 'extend_hold',
      'release_hold', 'confirm', 'cancel', 'complete', 'archive',
      'soft_delete', 'restore'
    )
  )
  OR (
    ${publicationOperationSql} = 'unpublish'
    AND ${scheduleIntentAlias}.operation IN (
      'unpublish', 'archive', 'soft_delete'
    )
  )
  OR (
    ${publicationOperationSql} = 'invalidate_scheduled_publication'
    AND ${scheduleIntentAlias}.operation =
        'invalidate_scheduled_publication'
  )
)`;
}

const PUBLICATION_OPERATION_SCHEDULE_MAPPING_FOR_NEW_SQL =
  publicationOperationScheduleMappingSql("NEW.operation");

const PUBLICATION_OPERATION_SCHEDULE_MAPPING_FOR_EVENT_SQL =
  publicationOperationScheduleMappingSql("publication_intent.operation");

function publicationRevisionMatchSql(
  publicationIntentAlias: string,
  revisionAlias: string,
): string {
  const operation = `${publicationIntentAlias}.operation`;
  return String.raw`
(
  (
    ${operation} = 'update_public_details'
    AND ${revisionAlias}.action = 'public_details_updated'
  )
  OR (
    ${operation} = 'publish'
    AND ${revisionAlias}.action = 'published'
  )
  OR (
    ${operation} = 'schedule_publication'
    AND ${revisionAlias}.action = 'publication_scheduled'
  )
  OR (
    ${operation} IN (
      'cancel_scheduled_publication',
      'invalidate_scheduled_publication'
    )
    AND ${revisionAlias}.action = 'publication_cancelled'
  )
  OR (
    ${operation} = 'reconcile_publication'
    AND ${revisionAlias}.action = 'publication_executed'
  )
  OR (
    ${operation} IN (
      'unpublish', 'public_cancel', 'restore_cancelled',
      'update_published', 'update_scheduled', 'update_unpublished'
    )
    AND EXISTS (
    SELECT 1
    FROM organizer_schedule_write_intents AS completion_schedule
    WHERE completion_schedule.id =
          ${publicationIntentAlias}.schedule_write_intent_id
      AND completion_schedule.organization_id =
          ${publicationIntentAlias}.organization_id
      AND completion_schedule.organizer_event_id =
          ${publicationIntentAlias}.organizer_event_id
      AND ${publicationOperationScheduleMappingSql(
        operation,
        "completion_schedule",
      )}
      AND ${revisionAlias}.action = CASE completion_schedule.operation
        WHEN 'soft_delete' THEN 'deleted'
        WHEN 'restore' THEN 'restored'
        WHEN 'unpublish' THEN 'unpublished'
        ELSE 'updated'
      END
    )
  )
)`;
}

function publicationAuditMatchSql(
  publicationIntentAlias: string,
  auditAlias: string,
): string {
  const operation = `${publicationIntentAlias}.operation`;
  return String.raw`
(
  ${auditAlias}.action = CASE ${operation}
    WHEN 'update_public_details'
      THEN 'organizer_event.public_details_updated'
    WHEN 'publish' THEN 'organizer_event.published'
    WHEN 'schedule_publication'
      THEN 'organizer_event.publication_scheduled'
    WHEN 'cancel_scheduled_publication'
      THEN 'organizer_event.publication_cancelled'
    WHEN 'reconcile_publication'
      THEN 'organizer_event.publication_executed'
    WHEN 'invalidate_scheduled_publication'
      THEN 'organizer_event.publication_invalidated'
  END
  OR (
    ${operation} IN (
      'unpublish', 'public_cancel', 'restore_cancelled',
      'update_published', 'update_scheduled', 'update_unpublished'
    )
    AND EXISTS (
    SELECT 1
    FROM organizer_schedule_write_intents AS completion_schedule
    WHERE completion_schedule.id =
          ${publicationIntentAlias}.schedule_write_intent_id
      AND completion_schedule.organization_id =
          ${publicationIntentAlias}.organization_id
      AND completion_schedule.organizer_event_id =
          ${publicationIntentAlias}.organizer_event_id
      AND ${publicationOperationScheduleMappingSql(
        operation,
        "completion_schedule",
      )}
      AND ${auditAlias}.action = CASE completion_schedule.operation
        WHEN 'soft_delete' THEN 'organizer_event.deleted'
        WHEN 'restore' THEN 'organizer_event.restored'
        WHEN 'unpublish' THEN 'organizer_event.unpublished'
        WHEN 'update' THEN 'organizer_event.updated'
        WHEN 'update_published' THEN 'organizer_event.updated'
        WHEN 'update_scheduled' THEN 'organizer_event.updated'
        WHEN 'update_unpublished' THEN 'organizer_event.updated'
        WHEN 'public_cancel' THEN 'organizer_event.updated'
        ELSE 'organizer_event.' || completion_schedule.operation
      END
    )
  )
)`;
}

const PUBLICATION_REVISION_MATCH_FOR_NEW_SQL =
  publicationRevisionMatchSql("NEW", "revision");

const PUBLICATION_AUDIT_MATCH_FOR_NEW_SQL =
  publicationAuditMatchSql("NEW", "audit");

const PUBLICATION_REVISION_MATCH_FOR_SCAN_SQL =
  publicationRevisionMatchSql("publication_intent", "revision");

const PUBLICATION_AUDIT_MATCH_FOR_SCAN_SQL =
  publicationAuditMatchSql("publication_intent", "audit");

function httpsUrlSql(valueSql: string): string {
  return String.raw`
(
  ${valueSql} = trim(${valueSql})
  AND lower(substr(${valueSql}, 1, 8)) = 'https://'
  AND length(${valueSql}) BETWEEN 9 AND 2048
)`;
}

function canonicalMeetupEventUrlSql(valueSql: string): string {
  return String.raw`
(
  ${valueSql} = trim(${valueSql})
  AND substr(${valueSql}, 1, 23) = 'https://www.meetup.com/'
  AND ${valueSql} GLOB 'https://www.meetup.com/?*/events/?*/'
  AND length(${valueSql}) - length(replace(${valueSql}, '/', '')) = 6
  AND instr(${valueSql}, '?') = 0
  AND instr(${valueSql}, '#') = 0
  AND length(${valueSql}) BETWEEN 34 AND 2048
)`;
}

function publicDetailsUrlsAreSafeSql(alias: string): string {
  return String.raw`
(
  (
    ${alias}.public_online_url IS NULL
    OR ${httpsUrlSql(`${alias}.public_online_url`)}
  )
  AND (
    ${alias}.external_map_url IS NULL
    OR ${httpsUrlSql(`${alias}.external_map_url`)}
  )
  AND (
    ${alias}.rsvp_mode = 'coming_soon'
    OR ${canonicalMeetupEventUrlSql(
      `${alias}.confirmed_meetup_event_url`,
    )}
  )
)`;
}

const NEW_PUBLIC_DETAILS_URLS_ARE_SAFE_SQL =
  publicDetailsUrlsAreSafeSql("NEW");

const PUBLICATION_INTENT_ACTOR_AUTHORIZATION_SQL = String.raw`
EXISTS (
  SELECT 1
  FROM organizer_events AS event
  JOIN profiles AS actor_profile
    ON actor_profile.id = NEW.actor_profile_id
   AND actor_profile.status = 'active'
   AND actor_profile.deleted_at IS NULL
  JOIN organization_memberships AS actor_membership
    ON actor_membership.organization_id = event.organization_id
   AND actor_membership.profile_id = actor_profile.id
   AND actor_membership.status = 'active'
   AND actor_membership.deleted_at IS NULL
  WHERE event.id = NEW.organizer_event_id
    AND event.organization_id = NEW.organization_id
    AND event.deleted_at IS NULL
    AND (
      actor_membership.role IN ('owner', 'administrator')
      OR (
        actor_membership.role = 'organizer'
        AND EXISTS (
          SELECT 1
          FROM club_memberships AS club_membership
          WHERE club_membership.organization_id = event.organization_id
            AND club_membership.club_id = event.club_id
            AND club_membership.organization_membership_id =
                actor_membership.id
            AND club_membership.profile_id = actor_profile.id
            AND club_membership.role = 'organizer'
            AND club_membership.status = 'active'
            AND club_membership.deleted_at IS NULL
        )
        AND (
          event.primary_organizer_profile_id = actor_profile.id
          OR EXISTS (
            SELECT 1
            FROM organizer_event_organizers AS association
            WHERE association.organization_id = event.organization_id
              AND association.organizer_event_id = event.id
              AND association.profile_id = actor_profile.id
              AND association.deleted_at IS NULL
          )
        )
        AND (
          NEW.operation NOT IN (
            'publish', 'schedule_publication',
            'cancel_scheduled_publication', 'reconcile_publication',
            'unpublish'
          )
          OR EXISTS (
            SELECT 1
            FROM organization_publication_policies AS publication_policy
            WHERE publication_policy.organization_id =
                  event.organization_id
              AND publication_policy.organizer_self_publish_enabled = 1
          )
        )
      )
    )
)`;

const PUBLICATION_INTENT_ACTOR_OR_INTERNAL_INVALIDATION_SQL = String.raw`
(
  (
    NEW.operation = 'invalidate_scheduled_publication'
    AND NEW.execution_kind = 'reconciliation'
    AND EXISTS (
      SELECT 1
      FROM organization_memberships AS recovery_membership
      JOIN profiles AS recovery_profile
        ON recovery_profile.id = recovery_membership.profile_id
       AND recovery_profile.status = 'active'
       AND recovery_profile.deleted_at IS NULL
      JOIN organizer_event_publication_jobs AS invalidated_job
        ON invalidated_job.id = NEW.previous_publication_job_id
       AND invalidated_job.organization_id =
           recovery_membership.organization_id
       AND invalidated_job.organizer_event_id =
           NEW.organizer_event_id
       AND invalidated_job.state = 'pending'
      WHERE recovery_membership.organization_id = NEW.organization_id
        AND recovery_membership.profile_id = NEW.actor_profile_id
        AND recovery_membership.role IN ('owner', 'administrator')
        AND recovery_membership.status = 'active'
        AND recovery_membership.deleted_at IS NULL
    )
  )
  OR (
    NEW.operation <> 'invalidate_scheduled_publication'
    AND ${PUBLICATION_INTENT_ACTOR_AUTHORIZATION_SQL}
  )
)`;

const OPEN_PUBLICATION_INTENT_FOR_EVENT_UPDATE_SQL = String.raw`
EXISTS (
  SELECT 1
  FROM organizer_event_publication_write_intents AS publication_intent
  JOIN organizer_schedule_write_intents AS schedule_intent
    ON schedule_intent.id = publication_intent.schedule_write_intent_id
   AND schedule_intent.organization_id =
       publication_intent.organization_id
   AND schedule_intent.organizer_event_id =
       publication_intent.organizer_event_id
   AND schedule_intent.actor_profile_id =
       publication_intent.actor_profile_id
   AND schedule_intent.expected_content_version =
       publication_intent.expected_content_version
   AND schedule_intent.expected_schedule_version =
       publication_intent.expected_schedule_version
   AND schedule_intent.proposed_content_version =
       publication_intent.proposed_content_version
   AND schedule_intent.proposed_schedule_version =
       publication_intent.proposed_schedule_version
   AND schedule_intent.completed_at IS NULL
  WHERE publication_intent.organization_id = NEW.organization_id
    AND publication_intent.organizer_event_id = NEW.id
    AND publication_intent.actor_profile_id = NEW.updated_by_profile_id
    AND publication_intent.expected_publication_status =
        OLD.publication_status
    AND publication_intent.proposed_publication_status =
        NEW.publication_status
    AND publication_intent.expected_content_version = OLD.content_version
    AND publication_intent.expected_schedule_version =
        OLD.schedule_version
    AND publication_intent.proposed_content_version = NEW.content_version
    AND publication_intent.proposed_schedule_version =
        NEW.schedule_version
    AND publication_intent.completed_at IS NULL
    AND ${PUBLICATION_OPERATION_SCHEDULE_MAPPING_FOR_EVENT_SQL}
    AND schedule_intent.club_id = NEW.club_id
    AND schedule_intent.planning_status = NEW.planning_status
    AND schedule_intent.schedule_shape = NEW.schedule_shape
    AND schedule_intent.timezone = NEW.timezone
    AND schedule_intent.all_day_start_date IS
        NEW.all_day_start_date
    AND schedule_intent.all_day_end_date_exclusive IS
        NEW.all_day_end_date_exclusive
    AND schedule_intent.buffer_before_minutes =
        NEW.buffer_before_minutes
    AND schedule_intent.buffer_after_minutes =
        NEW.buffer_after_minutes
    AND schedule_intent.venue_id IS NEW.venue_id
    AND schedule_intent.primary_organizer_profile_id =
        NEW.primary_organizer_profile_id
    AND (
      (
        NEW.schedule_shape = 'timed'
        AND schedule_intent.actual_start_utc = NEW.starts_at_utc
        AND schedule_intent.actual_end_utc = NEW.ends_at_utc
      )
      OR (
        NEW.schedule_shape = 'all_day'
        AND schedule_intent.actual_start_utc IS NOT NULL
        AND schedule_intent.actual_end_utc >
            schedule_intent.actual_start_utc
      )
      OR (
        NEW.schedule_shape = 'unscheduled'
        AND schedule_intent.actual_start_utc IS NULL
        AND schedule_intent.actual_end_utc IS NULL
      )
    )
)`;

const ORGANIZER_EVENT_PUBLIC_READINESS_SQL = String.raw`
EXISTS (
  SELECT 1
  FROM organizer_event_public_details AS public_detail
  JOIN organizer_event_publication_state AS publication_state
    ON publication_state.organizer_event_id =
       public_detail.organizer_event_id
   AND publication_state.organization_id = public_detail.organization_id
  JOIN clubs AS club
    ON club.id = NEW.club_id
   AND club.organization_id = NEW.organization_id
   AND club.deleted_at IS NULL
  JOIN club_public_profiles AS club_public
    ON club_public.club_id = club.id
   AND club_public.organization_id = club.organization_id
   AND club_public.publication_status = 'published'
   AND club_public.published_at IS NOT NULL
   AND club_public.deleted_at IS NULL
  WHERE public_detail.organizer_event_id = NEW.id
    AND public_detail.organization_id = NEW.organization_id
    AND length(trim(NEW.title)) BETWEEN 1 AND 180
    AND length(trim(NEW.slug)) BETWEEN 1 AND 200
    AND length(trim(NEW.summary)) BETWEEN 1 AND 500
    AND length(trim(NEW.description)) BETWEEN 1 AND 20000
    AND (
      (
        public_detail.attendance_mode = 'in_person'
        AND length(trim(public_detail.public_location_name))
            BETWEEN 1 AND 500
      )
      OR (
        public_detail.attendance_mode = 'online'
        AND length(trim(public_detail.public_online_url))
            BETWEEN 1 AND 2048
        AND ${httpsUrlSql("public_detail.public_online_url")}
      )
      OR (
        public_detail.attendance_mode = 'hybrid'
        AND length(trim(public_detail.public_location_name))
            BETWEEN 1 AND 500
        AND length(trim(public_detail.public_online_url))
            BETWEEN 1 AND 2048
        AND ${httpsUrlSql("public_detail.public_online_url")}
      )
    )
    AND (
      public_detail.rsvp_mode = 'coming_soon'
      OR (
        public_detail.rsvp_mode = 'meetup'
        AND NEW.meetup_event_url IS NOT NULL
        AND public_detail.confirmed_meetup_event_url =
            NEW.meetup_event_url
        AND ${canonicalMeetupEventUrlSql(
          "public_detail.confirmed_meetup_event_url",
        )}
        AND public_detail.meetup_url_confirmed_by_profile_id IS NOT NULL
        AND public_detail.meetup_url_confirmed_at IS NOT NULL
      )
    )
    AND (
      public_detail.public_hosts_enabled = 0
      OR ${eligibleSelectedPublicHostExistsSql({
        eventIdSql: "NEW.id",
        organizationIdSql: "NEW.organization_id",
      })}
    )
)`;

function eligibleSelectedPublicHostExistsSql(input: Readonly<{
  eventIdSql: string;
  organizationIdSql: string;
}>): string {
  return String.raw`
EXISTS (
  SELECT 1
  FROM organizer_event_public_hosts AS eligible_public_host
  JOIN profiles AS eligible_profile
    ON eligible_profile.id = eligible_public_host.profile_id
   AND eligible_profile.status = 'active'
   AND eligible_profile.deleted_at IS NULL
   AND eligible_profile.public_attribution_consent = 1
   AND length(trim(eligible_profile.display_name)) BETWEEN 1 AND 200
   AND instr(eligible_profile.display_name, '@') = 0
   AND lower(trim(eligible_profile.display_name)) <>
       lower(eligible_profile.normalized_email)
  JOIN organization_memberships AS eligible_membership
    ON eligible_membership.organization_id =
       eligible_public_host.organization_id
   AND eligible_membership.profile_id = eligible_profile.id
   AND eligible_membership.status = 'active'
   AND eligible_membership.deleted_at IS NULL
  JOIN organizer_events AS eligible_event
    ON eligible_event.id = eligible_public_host.organizer_event_id
   AND eligible_event.organization_id =
       eligible_public_host.organization_id
   AND eligible_event.deleted_at IS NULL
  WHERE eligible_public_host.organization_id = ${input.organizationIdSql}
    AND eligible_public_host.organizer_event_id = ${input.eventIdSql}
    AND (
      eligible_event.primary_organizer_profile_id =
          eligible_public_host.profile_id
      OR EXISTS (
        SELECT 1
        FROM organizer_event_organizers AS eligible_association
        WHERE eligible_association.organization_id =
              eligible_public_host.organization_id
          AND eligible_association.organizer_event_id =
              eligible_public_host.organizer_event_id
          AND eligible_association.profile_id =
              eligible_public_host.profile_id
          AND eligible_association.deleted_at IS NULL
      )
    )
)`;
}

function publicSlugCollisionSql(input: Readonly<{
  eventIdSql: string;
  organizationIdSql: string;
  slugSql: string;
}>): string {
  return String.raw`
(
  EXISTS (
    SELECT 1
    FROM organizer_events AS other_organizer_event
    WHERE other_organizer_event.organization_id =
          ${input.organizationIdSql}
      AND other_organizer_event.id <> ${input.eventIdSql}
      AND other_organizer_event.slug = ${input.slugSql}
      AND other_organizer_event.publication_status IN (
        'scheduled', 'published'
      )
      AND other_organizer_event.planning_status IN (
        'confirmed', 'cancelled', 'completed'
      )
      AND other_organizer_event.schedule_shape IN ('timed', 'all_day')
      AND other_organizer_event.deleted_at IS NULL
  )
  OR EXISTS (
    SELECT 1
    FROM events AS legacy_event
    WHERE legacy_event.organization_id = ${input.organizationIdSql}
      AND legacy_event.slug = ${input.slugSql}
      AND legacy_event.visibility = 'public'
      AND legacy_event.status IN ('confirmed', 'tentative', 'cancelled')
      AND legacy_event.published_at IS NOT NULL
      AND legacy_event.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM external_source_links AS source_link
        WHERE source_link.organization_id = legacy_event.organization_id
          AND source_link.entity_type = 'event'
          AND source_link.entity_id = legacy_event.id
          AND source_link.source_type = 'meetup_ics'
      )
  )
  OR EXISTS (
    SELECT 1
    FROM sync_sources AS source
    JOIN meetup_sync_generations AS generation
      ON generation.id = source.active_generation_id
     AND generation.organization_id = source.organization_id
     AND generation.sync_source_id = source.id
     AND generation.state = 'published'
     AND generation.published_at IS NOT NULL
     AND generation.processed_item_count = generation.expected_item_count
    JOIN meetup_event_snapshots AS snapshot
      ON snapshot.organization_id = source.organization_id
     AND snapshot.sync_source_id = source.id
     AND snapshot.generation_id = generation.id
    JOIN events AS source_event
      ON source_event.id = snapshot.event_id
     AND source_event.organization_id = snapshot.organization_id
     AND source_event.visibility = 'public'
     AND source_event.published_at IS NOT NULL
     AND source_event.deleted_at IS NULL
    WHERE source.organization_id = ${input.organizationIdSql}
      AND source.source_type = 'meetup_ics'
      AND source.enabled = 1
      AND source.active_generation_id IS NOT NULL
      AND source.deleted_at IS NULL
      AND snapshot.event_slug = ${input.slugSql}
      AND snapshot.status IN ('confirmed', 'tentative', 'cancelled')
      AND (
        snapshot.status <> 'cancelled'
        OR EXISTS (
          SELECT 1
          FROM meetup_event_snapshots AS previous_snapshot
          JOIN meetup_sync_generations AS previous_generation
            ON previous_generation.id = previous_snapshot.generation_id
           AND previous_generation.organization_id =
               previous_snapshot.organization_id
           AND previous_generation.sync_source_id =
               previous_snapshot.sync_source_id
           AND previous_generation.state = 'published'
           AND previous_generation.published_at IS NOT NULL
           AND previous_generation.processed_item_count =
               previous_generation.expected_item_count
          WHERE previous_snapshot.organization_id =
                snapshot.organization_id
            AND previous_snapshot.sync_source_id =
                snapshot.sync_source_id
            AND previous_snapshot.external_id = snapshot.external_id
            AND previous_snapshot.generation_id <> snapshot.generation_id
            AND previous_snapshot.status IN ('confirmed', 'tentative')
        )
      )
  )
)`;
}

const ORGANIZER_EVENT_PUBLIC_SLUG_IS_CLEAR_SQL = String.raw`
NOT ${publicSlugCollisionSql({
  eventIdSql: "NEW.id",
  organizationIdSql: "NEW.organization_id",
  slugSql: "NEW.slug",
})}`;

export const ORGANIZER_PUBLIC_SLUG_COLLISION_QUERY_SQL = String.raw`
WITH candidate AS (
  SELECT ? AS organization_id, ? AS event_id, ? AS slug
)
SELECT 1 AS collision
FROM candidate
WHERE ${publicSlugCollisionSql({
  eventIdSql: "candidate.event_id",
  organizationIdSql: "candidate.organization_id",
  slugSql: "candidate.slug",
})}
LIMIT 1`;

const SELECTED_PUBLIC_HOST_IS_CURRENTLY_ELIGIBLE_SQL = String.raw`
EXISTS (
  SELECT 1
  FROM organizer_events AS selected_event
  JOIN profiles AS selected_profile
    ON selected_profile.id = selected_host.profile_id
   AND selected_profile.status = 'active'
   AND selected_profile.deleted_at IS NULL
   AND selected_profile.public_attribution_consent = 1
   AND length(trim(selected_profile.display_name)) BETWEEN 1 AND 200
   AND instr(selected_profile.display_name, '@') = 0
   AND lower(trim(selected_profile.display_name)) <>
       lower(selected_profile.normalized_email)
  JOIN organization_memberships AS selected_membership
    ON selected_membership.organization_id =
       selected_event.organization_id
   AND selected_membership.profile_id = selected_profile.id
   AND selected_membership.status = 'active'
   AND selected_membership.deleted_at IS NULL
  WHERE selected_event.id = selected_host.organizer_event_id
    AND selected_event.organization_id = selected_host.organization_id
    AND selected_event.deleted_at IS NULL
    AND (
      selected_event.primary_organizer_profile_id =
          selected_profile.id
      OR EXISTS (
        SELECT 1
        FROM organizer_event_organizers AS selected_association
        WHERE selected_association.organization_id =
              selected_event.organization_id
          AND selected_association.organizer_event_id =
              selected_event.id
          AND selected_association.profile_id = selected_profile.id
          AND selected_association.deleted_at IS NULL
      )
    )
)`;

const ORGANIZATION_PUBLICATION_POLICY_BEFORE_INSERT_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organization_publication_policies_phase5_before_insert
BEFORE INSERT ON organization_publication_policies
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS membership
      JOIN profiles AS profile
        ON profile.id = membership.profile_id
       AND profile.status = 'active'
       AND profile.deleted_at IS NULL
      WHERE membership.organization_id = NEW.organization_id
        AND membership.profile_id = NEW.updated_by_profile_id
        AND membership.role IN ('owner', 'administrator')
        AND membership.status = 'active'
        AND membership.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'phase5_publication_policy_forbidden')
  END;
END;`;

const ORGANIZATION_PUBLICATION_POLICY_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organization_publication_policies_phase5_before_update
BEFORE UPDATE ON organization_publication_policies
BEGIN
  SELECT CASE
    WHEN NEW.organization_id <> OLD.organization_id
    THEN RAISE(ABORT, 'phase5_publication_policy_identity_immutable')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS membership
      JOIN profiles AS profile
        ON profile.id = membership.profile_id
       AND profile.status = 'active'
       AND profile.deleted_at IS NULL
      WHERE membership.organization_id = NEW.organization_id
        AND membership.profile_id = NEW.updated_by_profile_id
        AND membership.role IN ('owner', 'administrator')
        AND membership.status = 'active'
        AND membership.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'phase5_publication_policy_forbidden')
  END;
END;`;

const ORGANIZATION_PUBLICATION_POLICY_BEFORE_DELETE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organization_publication_policies_phase5_before_delete
BEFORE DELETE ON organization_publication_policies
BEGIN
  SELECT RAISE(ABORT, 'phase5_publication_policy_delete_forbidden');
END;`;

const PUBLICATION_INTENT_BEFORE_INSERT_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_publication_write_intents_phase5_before_insert
BEFORE INSERT ON organizer_event_publication_write_intents
BEGIN
  SELECT CASE
    WHEN NEW.completed_at IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM organizer_events AS event
        JOIN organizer_schedule_write_intents AS schedule_intent
          ON schedule_intent.id = NEW.schedule_write_intent_id
         AND schedule_intent.organization_id = NEW.organization_id
         AND schedule_intent.organizer_event_id = event.id
         AND schedule_intent.actor_profile_id = NEW.actor_profile_id
         AND schedule_intent.club_id = event.club_id
         AND schedule_intent.expected_content_version =
             NEW.expected_content_version
         AND schedule_intent.expected_schedule_version =
             NEW.expected_schedule_version
         AND schedule_intent.proposed_content_version =
             NEW.proposed_content_version
         AND schedule_intent.proposed_schedule_version =
             NEW.proposed_schedule_version
         AND schedule_intent.completed_at IS NULL
        WHERE event.id = NEW.organizer_event_id
          AND event.organization_id = NEW.organization_id
          AND event.content_version = NEW.expected_content_version
          AND event.schedule_version = NEW.expected_schedule_version
          AND event.publication_status = NEW.expected_publication_status
          AND ${PUBLICATION_OPERATION_SCHEDULE_MAPPING_FOR_NEW_SQL}
      )
      OR NOT (${PUBLICATION_INTENT_ACTOR_OR_INTERNAL_INVALIDATION_SQL})
      OR (
        NEW.execution_kind = 'reconciliation'
        AND NEW.operation NOT IN (
          'reconcile_publication',
          'invalidate_scheduled_publication'
        )
      )
      OR (
        NEW.execution_kind = 'actor'
        AND NEW.operation IN (
          'reconcile_publication',
          'invalidate_scheduled_publication'
        )
      )
      OR (
        NEW.operation = 'reconcile_publication'
        AND (
          NEW.execution_kind <> 'reconciliation'
          OR NEW.publication_job_id IS NULL
          OR NEW.previous_publication_job_id IS NOT NULL
          OR NOT EXISTS (
            SELECT 1
            FROM organizer_event_publication_jobs AS job
            WHERE job.id = NEW.publication_job_id
              AND job.organization_id = NEW.organization_id
              AND job.organizer_event_id = NEW.organizer_event_id
              AND job.authorizing_profile_id = NEW.actor_profile_id
              AND job.bound_content_version =
                  NEW.expected_content_version
              AND job.bound_schedule_version =
                  NEW.expected_schedule_version
              AND job.state = 'pending'
              AND job.requested_publication_at_utc <=
                  CAST(unixepoch('subsec') * 1000 AS INTEGER)
          )
        )
      )
      OR (
        NEW.operation = 'invalidate_scheduled_publication'
        AND (
          NEW.execution_kind <> 'reconciliation'
          OR NEW.publication_job_id IS NOT NULL
          OR NEW.previous_publication_job_id IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM organizer_event_publication_jobs AS job
            WHERE job.id = NEW.previous_publication_job_id
              AND job.organization_id = NEW.organization_id
              AND job.organizer_event_id = NEW.organizer_event_id
              AND job.state = 'pending'
          )
        )
      )
      OR (
        NEW.operation = 'schedule_publication'
        AND (
          NEW.publication_job_id IS NULL
          OR (
            NEW.expected_publication_status <> 'scheduled'
            AND NEW.previous_publication_job_id IS NOT NULL
          )
          OR (
            NEW.expected_publication_status = 'scheduled'
            AND (
              NEW.previous_publication_job_id IS NULL
              OR NEW.previous_publication_job_id =
                  NEW.publication_job_id
              OR NOT EXISTS (
                SELECT 1
                FROM organizer_event_publication_jobs AS previous_job
                WHERE previous_job.id =
                      NEW.previous_publication_job_id
                  AND previous_job.organization_id =
                      NEW.organization_id
                  AND previous_job.organizer_event_id =
                      NEW.organizer_event_id
                  AND previous_job.bound_content_version =
                      NEW.expected_content_version
                  AND previous_job.bound_schedule_version =
                      NEW.expected_schedule_version
                  AND previous_job.state = 'pending'
              )
            )
          )
        )
      )
      OR (
        NEW.operation IN (
          'cancel_scheduled_publication', 'public_cancel',
          'update_public_details', 'update_scheduled', 'publish'
        )
        AND NEW.expected_publication_status = 'scheduled'
        AND (
          NEW.publication_job_id IS NOT NULL
          OR NEW.previous_publication_job_id IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM organizer_event_publication_jobs AS job
            WHERE job.id = NEW.previous_publication_job_id
              AND job.organization_id = NEW.organization_id
              AND job.organizer_event_id = NEW.organizer_event_id
              AND job.bound_content_version =
                  NEW.expected_content_version
              AND job.bound_schedule_version =
                  NEW.expected_schedule_version
              AND job.state = 'pending'
          )
        )
      )
      OR (
        NEW.operation IN ('update_public_details', 'update_scheduled')
        AND NEW.expected_publication_status = 'scheduled'
        AND NEW.proposed_publication_status = 'scheduled'
      )
      OR (
        NEW.operation NOT IN (
          'schedule_publication', 'reconcile_publication',
          'invalidate_scheduled_publication'
        )
        AND NOT (
          NEW.operation IN (
            'cancel_scheduled_publication', 'public_cancel',
            'update_public_details', 'update_scheduled', 'publish'
          )
          AND NEW.expected_publication_status = 'scheduled'
        )
        AND (
          NEW.publication_job_id IS NOT NULL
          OR NEW.previous_publication_job_id IS NOT NULL
        )
      )
    THEN RAISE(ABORT, 'phase5_publication_intent_mismatch')
  END;
END;`;

const PUBLICATION_INTENT_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_publication_write_intents_phase5_before_update
BEFORE UPDATE ON organizer_event_publication_write_intents
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.organizer_event_id <> OLD.organizer_event_id
      OR NEW.schedule_write_intent_id <> OLD.schedule_write_intent_id
      OR NEW.actor_profile_id <> OLD.actor_profile_id
      OR NEW.operation <> OLD.operation
      OR NEW.expected_publication_status <>
         OLD.expected_publication_status
      OR NEW.proposed_publication_status <>
         OLD.proposed_publication_status
      OR NEW.expected_content_version <> OLD.expected_content_version
      OR NEW.expected_schedule_version <> OLD.expected_schedule_version
      OR NEW.proposed_content_version <> OLD.proposed_content_version
      OR NEW.proposed_schedule_version <> OLD.proposed_schedule_version
      OR NEW.public_state_fingerprint <> OLD.public_state_fingerprint
      OR NEW.publication_job_id IS NOT OLD.publication_job_id
      OR NEW.previous_publication_job_id IS NOT
         OLD.previous_publication_job_id
      OR NEW.execution_kind <> OLD.execution_kind
      OR NEW.created_at <> OLD.created_at
      OR OLD.completed_at IS NOT NULL
      OR NEW.completed_at IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM organizer_events AS event
        JOIN organizer_schedule_write_intents AS schedule_intent
          ON schedule_intent.id = NEW.schedule_write_intent_id
         AND schedule_intent.organization_id = NEW.organization_id
         AND schedule_intent.organizer_event_id = event.id
         AND schedule_intent.actor_profile_id = NEW.actor_profile_id
         AND schedule_intent.club_id = event.club_id
         AND schedule_intent.expected_content_version =
             NEW.expected_content_version
         AND schedule_intent.expected_schedule_version =
             NEW.expected_schedule_version
         AND schedule_intent.proposed_content_version =
             NEW.proposed_content_version
         AND schedule_intent.proposed_schedule_version =
             NEW.proposed_schedule_version
         AND schedule_intent.completed_at IS NULL
        WHERE event.id = NEW.organizer_event_id
          AND event.organization_id = NEW.organization_id
          AND event.content_version = NEW.proposed_content_version
          AND event.schedule_version = NEW.proposed_schedule_version
          AND event.publication_status = NEW.proposed_publication_status
          AND ${PUBLICATION_OPERATION_SCHEDULE_MAPPING_FOR_NEW_SQL}
      )
      OR (
        NEW.proposed_publication_status = 'scheduled'
        AND (
          (
            SELECT count(*)
            FROM organizer_event_publication_jobs AS job
            WHERE job.organization_id = NEW.organization_id
              AND job.organizer_event_id = NEW.organizer_event_id
              AND job.state = 'pending'
              AND job.bound_content_version =
                  NEW.proposed_content_version
              AND job.bound_schedule_version =
                  NEW.proposed_schedule_version
              AND job.id = NEW.publication_job_id
          ) <> 1
          OR EXISTS (
            SELECT 1
            FROM organizer_event_publication_jobs AS other_pending_job
            WHERE other_pending_job.organization_id =
                  NEW.organization_id
              AND other_pending_job.organizer_event_id =
                  NEW.organizer_event_id
              AND other_pending_job.state = 'pending'
              AND other_pending_job.id <> NEW.publication_job_id
          )
        )
      )
      OR (
        NEW.proposed_publication_status <> 'scheduled'
        AND EXISTS (
          SELECT 1
          FROM organizer_event_publication_jobs AS pending_job
          WHERE pending_job.organization_id = NEW.organization_id
            AND pending_job.organizer_event_id =
                NEW.organizer_event_id
            AND pending_job.state = 'pending'
        )
      )
      OR (
        NEW.operation = 'reconcile_publication'
        AND NOT EXISTS (
          SELECT 1
          FROM organizer_event_publication_jobs AS job
          WHERE job.id = NEW.publication_job_id
            AND job.organization_id = NEW.organization_id
            AND job.organizer_event_id = NEW.organizer_event_id
            AND job.authorizing_profile_id = NEW.actor_profile_id
            AND job.bound_content_version =
                NEW.expected_content_version
            AND job.bound_schedule_version =
                NEW.expected_schedule_version
            AND job.state = 'executed'
            AND job.terminal_at IS NOT NULL
        )
      )
      OR (
        NEW.operation IN (
          'cancel_scheduled_publication', 'public_cancel',
          'publish'
        )
        AND NEW.expected_publication_status = 'scheduled'
        AND NOT EXISTS (
          SELECT 1
          FROM organizer_event_publication_jobs AS job
          WHERE job.id = NEW.previous_publication_job_id
            AND job.organization_id = NEW.organization_id
            AND job.organizer_event_id = NEW.organizer_event_id
            AND job.bound_content_version =
                NEW.expected_content_version
            AND job.bound_schedule_version =
                NEW.expected_schedule_version
            AND job.state = 'cancelled'
            AND job.terminal_at IS NOT NULL
        )
      )
      OR (
        NEW.operation IN ('update_public_details', 'update_scheduled')
        AND NEW.expected_publication_status = 'scheduled'
        AND NOT EXISTS (
          SELECT 1
          FROM organizer_event_publication_jobs AS job
          WHERE job.id = NEW.previous_publication_job_id
            AND job.organization_id = NEW.organization_id
            AND job.organizer_event_id = NEW.organizer_event_id
            AND job.bound_content_version =
                NEW.expected_content_version
            AND job.bound_schedule_version =
                NEW.expected_schedule_version
            AND job.state = 'invalidated'
            AND job.terminal_at IS NOT NULL
        )
      )
      OR (
        NEW.operation = 'invalidate_scheduled_publication'
        AND NOT EXISTS (
          SELECT 1
          FROM organizer_event_publication_jobs AS job
          WHERE job.id = NEW.previous_publication_job_id
            AND job.organization_id = NEW.organization_id
            AND job.organizer_event_id = NEW.organizer_event_id
            AND job.state IN ('invalidated', 'failed')
            AND job.terminal_at IS NOT NULL
        )
      )
      OR (
        NEW.operation = 'schedule_publication'
        AND NEW.expected_publication_status = 'scheduled'
        AND NOT EXISTS (
          SELECT 1
          FROM organizer_event_publication_jobs AS previous_job
          WHERE previous_job.id = NEW.previous_publication_job_id
            AND previous_job.organization_id = NEW.organization_id
            AND previous_job.organizer_event_id =
                NEW.organizer_event_id
            AND previous_job.bound_content_version =
                NEW.expected_content_version
            AND previous_job.bound_schedule_version =
                NEW.expected_schedule_version
            AND previous_job.state = 'cancelled'
            AND previous_job.terminal_at IS NOT NULL
        )
      )
      OR (
        NEW.operation IN ('publish', 'reconcile_publication')
        AND NOT EXISTS (
          SELECT 1
          FROM organizer_event_publication_state AS publication_state
          WHERE publication_state.organization_id = NEW.organization_id
            AND publication_state.organizer_event_id =
                NEW.organizer_event_id
            AND publication_state.first_published_at IS NOT NULL
            AND publication_state.most_recent_published_at IS NOT NULL
            AND publication_state.public_cancellation_at IS NULL
        )
      )
      OR (
        (
          NEW.operation IN (
            'unpublish', 'restore_cancelled',
            'cancel_scheduled_publication',
            'invalidate_scheduled_publication'
          )
          OR (
            NEW.operation IN (
              'update_public_details', 'update_scheduled',
              'public_cancel'
            )
            AND NEW.expected_publication_status = 'scheduled'
            AND NEW.proposed_publication_status <> 'scheduled'
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM organizer_event_publication_state AS publication_state
          WHERE publication_state.organization_id = NEW.organization_id
            AND publication_state.organizer_event_id =
                NEW.organizer_event_id
            AND publication_state.most_recent_unpublished_at IS NOT NULL
            AND (
              NEW.operation <> 'restore_cancelled'
              OR publication_state.public_cancellation_at IS NULL
            )
        )
      )
      OR (
        NEW.operation = 'public_cancel'
        AND NEW.expected_publication_status = 'published'
        AND NOT EXISTS (
          SELECT 1
          FROM organizer_event_publication_state AS publication_state
          WHERE publication_state.organization_id = NEW.organization_id
            AND publication_state.organizer_event_id =
                NEW.organizer_event_id
            AND publication_state.public_cancellation_at IS NOT NULL
        )
      )
      OR NOT EXISTS (
        SELECT 1
        FROM organizer_event_revisions AS revision
        WHERE revision.organization_id = NEW.organization_id
          AND revision.organizer_event_id = NEW.organizer_event_id
          AND revision.content_version = NEW.proposed_content_version
          AND revision.schedule_version = NEW.proposed_schedule_version
          AND revision.actor_profile_id = NEW.actor_profile_id
          AND ${PUBLICATION_REVISION_MATCH_FOR_NEW_SQL}
      )
      OR NOT EXISTS (
        SELECT 1
        FROM audit_logs AS audit
        WHERE audit.organization_id = NEW.organization_id
          AND audit.actor_profile_id = NEW.actor_profile_id
          AND audit.entity_type = 'organizer_event'
          AND audit.entity_id = NEW.organizer_event_id
          AND audit.created_at BETWEEN NEW.created_at AND NEW.completed_at
          AND ${PUBLICATION_AUDIT_MATCH_FOR_NEW_SQL}
      )
    THEN RAISE(ABORT, 'phase5_publication_intent_completion_mismatch')
  END;
END;`;

const PUBLICATION_INTENT_BEFORE_DELETE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_publication_write_intents_phase5_before_delete
BEFORE DELETE ON organizer_event_publication_write_intents
BEGIN
  SELECT RAISE(ABORT, 'phase5_publication_intent_delete_forbidden');
END;`;

const PUBLIC_DETAILS_BEFORE_INSERT_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_public_details_phase5_before_insert
BEFORE INSERT ON organizer_event_public_details
BEGIN
  SELECT CASE
    WHEN NOT (${NEW_PUBLIC_DETAILS_URLS_ARE_SAFE_SQL})
    THEN RAISE(ABORT, 'phase5_public_details_url_invalid')
  END;

  SELECT CASE
    WHEN NEW.created_by_profile_id <> NEW.updated_by_profile_id
      OR (
        NEW.rsvp_mode = 'meetup'
        AND NEW.meetup_url_confirmed_by_profile_id <>
            NEW.updated_by_profile_id
      )
      OR NOT EXISTS (
        SELECT 1
        FROM organizer_events AS event
        JOIN organizer_event_publication_write_intents
             AS publication_intent
          ON publication_intent.organization_id = event.organization_id
         AND publication_intent.organizer_event_id = event.id
         AND publication_intent.actor_profile_id =
             NEW.updated_by_profile_id
         AND publication_intent.expected_content_version =
             event.content_version
         AND publication_intent.expected_schedule_version =
             event.schedule_version
         AND publication_intent.completed_at IS NULL
        JOIN organizer_schedule_write_intents AS schedule_intent
          ON schedule_intent.id =
             publication_intent.schedule_write_intent_id
         AND schedule_intent.completed_at IS NULL
        WHERE event.id = NEW.organizer_event_id
          AND event.organization_id = NEW.organization_id
      )
    THEN RAISE(ABORT, 'phase5_public_details_intent_required')
  END;
END;`;

const PUBLIC_DETAILS_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_public_details_phase5_before_update
BEFORE UPDATE ON organizer_event_public_details
BEGIN
  SELECT CASE
    WHEN NOT (${NEW_PUBLIC_DETAILS_URLS_ARE_SAFE_SQL})
    THEN RAISE(ABORT, 'phase5_public_details_url_invalid')
  END;

  SELECT CASE
    WHEN NEW.organizer_event_id <> OLD.organizer_event_id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.created_by_profile_id <> OLD.created_by_profile_id
      OR NEW.created_at <> OLD.created_at
      OR (
        NEW.rsvp_mode = 'meetup'
        AND NEW.meetup_url_confirmed_by_profile_id <>
            NEW.updated_by_profile_id
      )
      OR (
        NOT EXISTS (
          SELECT 1
          FROM organizer_events AS event
          JOIN organizer_event_publication_write_intents
               AS publication_intent
            ON publication_intent.organization_id =
               event.organization_id
           AND publication_intent.organizer_event_id = event.id
           AND publication_intent.actor_profile_id =
               NEW.updated_by_profile_id
           AND publication_intent.expected_content_version =
               event.content_version
           AND publication_intent.expected_schedule_version =
               event.schedule_version
           AND publication_intent.completed_at IS NULL
          JOIN organizer_schedule_write_intents AS schedule_intent
            ON schedule_intent.id =
               publication_intent.schedule_write_intent_id
           AND schedule_intent.completed_at IS NULL
          WHERE event.id = NEW.organizer_event_id
            AND event.organization_id = NEW.organization_id
        )
        AND NOT (
          OLD.rsvp_mode = 'meetup'
          AND NEW.rsvp_mode = 'coming_soon'
          AND NEW.confirmed_meetup_event_url IS NULL
          AND NEW.meetup_url_confirmed_by_profile_id IS NULL
          AND NEW.meetup_url_confirmed_at IS NULL
          AND NEW.attendance_mode = OLD.attendance_mode
          AND NEW.public_location_name IS OLD.public_location_name
          AND NEW.public_address IS OLD.public_address
          AND NEW.public_access_note IS OLD.public_access_note
          AND NEW.public_online_url IS OLD.public_online_url
          AND NEW.external_map_url IS OLD.external_map_url
          AND NEW.cost_text IS OLD.cost_text
          AND NEW.capacity IS OLD.capacity
          AND NEW.availability_state = OLD.availability_state
          AND NEW.preparation_information IS
              OLD.preparation_information
          AND NEW.what_to_bring IS OLD.what_to_bring
          AND NEW.arrival_instructions IS OLD.arrival_instructions
          AND NEW.weather_note IS OLD.weather_note
          AND NEW.verified_accessibility_notes IS
              OLD.verified_accessibility_notes
          AND NEW.public_hosts_enabled = OLD.public_hosts_enabled
          AND NEW.updated_at >= OLD.updated_at
          AND EXISTS (
            SELECT 1
            FROM organization_memberships AS cleanup_actor
            JOIN profiles AS cleanup_profile
              ON cleanup_profile.id = cleanup_actor.profile_id
             AND cleanup_profile.status = 'active'
             AND cleanup_profile.deleted_at IS NULL
            WHERE cleanup_actor.organization_id =
                  NEW.organization_id
              AND cleanup_actor.profile_id =
                  NEW.updated_by_profile_id
              AND cleanup_actor.status = 'active'
              AND cleanup_actor.deleted_at IS NULL
          )
        )
      )
    THEN RAISE(ABORT, 'phase5_public_details_intent_required')
  END;
END;`;

const PUBLIC_DETAILS_BEFORE_DELETE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_public_details_phase5_before_delete
BEFORE DELETE ON organizer_event_public_details
BEGIN
  SELECT RAISE(ABORT, 'phase5_public_details_delete_forbidden');
END;`;

const PUBLIC_HOST_BEFORE_INSERT_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_public_hosts_phase5_before_insert
BEFORE INSERT ON organizer_event_public_hosts
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_events AS event
      JOIN organizer_event_publication_write_intents
           AS publication_intent
        ON publication_intent.organization_id = event.organization_id
       AND publication_intent.organizer_event_id = event.id
       AND publication_intent.actor_profile_id =
           NEW.selected_by_profile_id
       AND publication_intent.expected_content_version =
           event.content_version
       AND publication_intent.expected_schedule_version =
           event.schedule_version
       AND publication_intent.completed_at IS NULL
      JOIN profiles AS host_profile
        ON host_profile.id = NEW.profile_id
       AND host_profile.status = 'active'
       AND host_profile.deleted_at IS NULL
       AND host_profile.public_attribution_consent = 1
       AND length(trim(host_profile.display_name)) BETWEEN 1 AND 200
      JOIN organization_memberships AS host_membership
        ON host_membership.organization_id = event.organization_id
       AND host_membership.profile_id = host_profile.id
       AND host_membership.status = 'active'
       AND host_membership.deleted_at IS NULL
      WHERE event.id = NEW.organizer_event_id
        AND event.organization_id = NEW.organization_id
        AND (
          event.primary_organizer_profile_id = host_profile.id
          OR EXISTS (
            SELECT 1
            FROM organizer_event_organizers AS association
            WHERE association.organization_id = event.organization_id
              AND association.organizer_event_id = event.id
              AND association.profile_id = host_profile.id
              AND association.deleted_at IS NULL
          )
        )
    )
    THEN RAISE(ABORT, 'phase5_public_host_forbidden')
  END;
END;`;

const PUBLIC_HOST_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_public_hosts_phase5_before_update
BEFORE UPDATE ON organizer_event_public_hosts
BEGIN
  SELECT RAISE(ABORT, 'phase5_public_host_identity_immutable');
END;`;

const PUBLIC_HOST_BEFORE_DELETE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_public_hosts_phase5_before_delete
BEFORE DELETE ON organizer_event_public_hosts
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM organizer_event_public_hosts AS selected_host
      WHERE selected_host.id = OLD.id
        AND ${SELECTED_PUBLIC_HOST_IS_CURRENTLY_ELIGIBLE_SQL}
    )
    AND NOT EXISTS (
      SELECT 1
      FROM organizer_events AS event
      JOIN organizer_event_publication_write_intents
           AS publication_intent
        ON publication_intent.organization_id = event.organization_id
       AND publication_intent.organizer_event_id = event.id
       AND publication_intent.expected_content_version =
           event.content_version
       AND publication_intent.expected_schedule_version =
           event.schedule_version
       AND publication_intent.completed_at IS NULL
      WHERE event.id = OLD.organizer_event_id
        AND event.organization_id = OLD.organization_id
    )
    THEN RAISE(ABORT, 'phase5_public_host_intent_required')
  END;
END;`;

const PUBLICATION_STATE_BEFORE_INSERT_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_publication_state_phase5_before_insert
BEFORE INSERT ON organizer_event_publication_state
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_events AS event
      JOIN organizer_event_publication_write_intents
           AS publication_intent
        ON publication_intent.organization_id = event.organization_id
       AND publication_intent.organizer_event_id = event.id
       AND publication_intent.actor_profile_id =
           NEW.last_mutation_actor_profile_id
       AND publication_intent.expected_content_version =
           event.content_version
       AND publication_intent.expected_schedule_version =
           event.schedule_version
       AND publication_intent.completed_at IS NULL
      WHERE event.id = NEW.organizer_event_id
        AND event.organization_id = NEW.organization_id
    )
    THEN RAISE(ABORT, 'phase5_publication_state_intent_required')
  END;
END;`;

const PUBLICATION_STATE_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_publication_state_phase5_before_update
BEFORE UPDATE ON organizer_event_publication_state
BEGIN
  SELECT CASE
    WHEN NEW.organizer_event_id <> OLD.organizer_event_id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.created_at <> OLD.created_at
      OR NOT EXISTS (
        SELECT 1
        FROM organizer_events AS event
        JOIN organizer_event_publication_write_intents
             AS publication_intent
          ON publication_intent.organization_id = event.organization_id
         AND publication_intent.organizer_event_id = event.id
         AND publication_intent.actor_profile_id =
             NEW.last_mutation_actor_profile_id
         AND publication_intent.expected_content_version =
             event.content_version
         AND publication_intent.expected_schedule_version =
             event.schedule_version
         AND publication_intent.completed_at IS NULL
        WHERE event.id = NEW.organizer_event_id
          AND event.organization_id = NEW.organization_id
      )
    THEN RAISE(ABORT, 'phase5_publication_state_intent_required')
  END;
END;`;

const PUBLICATION_STATE_BEFORE_DELETE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_publication_state_phase5_before_delete
BEFORE DELETE ON organizer_event_publication_state
BEGIN
  SELECT RAISE(ABORT, 'phase5_publication_state_delete_forbidden');
END;`;

const PUBLICATION_JOB_BEFORE_INSERT_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_publication_jobs_phase5_before_insert
BEFORE INSERT ON organizer_event_publication_jobs
BEGIN
  SELECT CASE
    WHEN NEW.state <> 'pending'
      OR NEW.requested_publication_at_utc <=
         CAST(unixepoch('subsec') * 1000 AS INTEGER)
      OR NOT EXISTS (
        SELECT 1
        FROM organizer_events AS event
        JOIN organizer_event_publication_write_intents
             AS publication_intent
          ON publication_intent.organization_id =
             event.organization_id
         AND publication_intent.organizer_event_id = event.id
         AND publication_intent.actor_profile_id =
             NEW.authorizing_profile_id
         AND publication_intent.operation = 'schedule_publication'
         AND publication_intent.publication_job_id = NEW.id
         AND publication_intent.proposed_content_version =
             NEW.bound_content_version
         AND publication_intent.proposed_schedule_version =
             NEW.bound_schedule_version
         AND publication_intent.completed_at IS NULL
        JOIN organizer_schedule_write_intents AS schedule_intent
          ON schedule_intent.id =
             publication_intent.schedule_write_intent_id
         AND schedule_intent.organization_id = event.organization_id
         AND schedule_intent.organizer_event_id = event.id
         AND schedule_intent.actor_profile_id =
             NEW.authorizing_profile_id
         AND schedule_intent.club_id = event.club_id
         AND schedule_intent.operation = 'schedule_publication'
         AND schedule_intent.expected_content_version =
             publication_intent.expected_content_version
         AND schedule_intent.expected_schedule_version =
             publication_intent.expected_schedule_version
         AND schedule_intent.proposed_content_version =
             NEW.bound_content_version
         AND schedule_intent.proposed_schedule_version =
             NEW.bound_schedule_version
         AND schedule_intent.planning_status =
             event.planning_status
         AND schedule_intent.schedule_shape = event.schedule_shape
         AND schedule_intent.completed_at IS NULL
        JOIN profiles AS actor_profile
          ON actor_profile.id = NEW.authorizing_profile_id
         AND actor_profile.status = 'active'
         AND actor_profile.deleted_at IS NULL
        JOIN organization_memberships AS actor_membership
          ON actor_membership.organization_id = event.organization_id
         AND actor_membership.profile_id = actor_profile.id
         AND actor_membership.status = 'active'
         AND actor_membership.deleted_at IS NULL
        WHERE event.id = NEW.organizer_event_id
          AND event.organization_id = NEW.organization_id
          AND event.content_version =
              publication_intent.expected_content_version
          AND event.schedule_version =
              publication_intent.expected_schedule_version
          AND event.publication_status =
              publication_intent.expected_publication_status
          AND event.planning_status = 'confirmed'
          AND event.schedule_shape IN ('timed', 'all_day')
          AND event.deleted_at IS NULL
          AND NEW.bound_content_version = event.content_version + 1
          AND NEW.bound_schedule_version = event.schedule_version
          AND (
            actor_membership.role IN ('owner', 'administrator')
            OR (
              actor_membership.role = 'organizer'
              AND EXISTS (
                SELECT 1
                FROM organization_publication_policies AS policy
                WHERE policy.organization_id = event.organization_id
                  AND policy.organizer_self_publish_enabled = 1
              )
              AND EXISTS (
                SELECT 1
                FROM club_memberships AS club_membership
                WHERE club_membership.organization_id =
                      event.organization_id
                  AND club_membership.club_id = event.club_id
                  AND club_membership.organization_membership_id =
                      actor_membership.id
                  AND club_membership.profile_id = actor_profile.id
                  AND club_membership.status = 'active'
                  AND club_membership.deleted_at IS NULL
              )
              AND (
                event.primary_organizer_profile_id = actor_profile.id
                OR EXISTS (
                  SELECT 1
                  FROM organizer_event_organizers AS association
                  WHERE association.organization_id =
                        event.organization_id
                    AND association.organizer_event_id = event.id
                    AND association.profile_id = actor_profile.id
                    AND association.deleted_at IS NULL
                )
              )
            )
          )
      )
    THEN RAISE(ABORT, 'phase5_publication_job_forbidden')
  END;
END;`;

const PUBLICATION_JOB_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_publication_jobs_phase5_before_update
BEFORE UPDATE ON organizer_event_publication_jobs
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.organizer_event_id <> OLD.organizer_event_id
      OR NEW.requested_publication_at_utc <>
         OLD.requested_publication_at_utc
      OR NEW.original_timezone <> OLD.original_timezone
      OR NEW.bound_content_version <> OLD.bound_content_version
      OR NEW.bound_schedule_version <> OLD.bound_schedule_version
      OR NEW.authorizing_profile_id <> OLD.authorizing_profile_id
      OR NEW.created_at <> OLD.created_at
      OR NEW.updated_at < OLD.updated_at
      OR (
        OLD.attempted_at IS NOT NULL
        AND NEW.attempted_at IS NOT OLD.attempted_at
      )
      OR OLD.state <> 'pending'
      OR NEW.state NOT IN (
        'executed', 'cancelled', 'invalidated', 'failed'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM organizer_events AS event
        JOIN organizer_event_publication_write_intents
             AS publication_intent
         ON publication_intent.organization_id =
             event.organization_id
         AND publication_intent.organizer_event_id = event.id
         AND publication_intent.completed_at IS NULL
        JOIN organizer_schedule_write_intents AS schedule_intent
          ON schedule_intent.id =
             publication_intent.schedule_write_intent_id
         AND schedule_intent.organization_id =
             publication_intent.organization_id
         AND schedule_intent.organizer_event_id =
             publication_intent.organizer_event_id
         AND schedule_intent.actor_profile_id =
             publication_intent.actor_profile_id
         AND schedule_intent.completed_at IS NULL
        WHERE event.id = NEW.organizer_event_id
          AND event.organization_id = NEW.organization_id
          AND event.content_version =
              publication_intent.expected_content_version
          AND event.schedule_version =
              publication_intent.expected_schedule_version
          AND event.publication_status =
              publication_intent.expected_publication_status
          AND (
            (
              NEW.state = 'executed'
              AND publication_intent.operation =
                  'reconcile_publication'
              AND publication_intent.publication_job_id = NEW.id
              AND publication_intent.previous_publication_job_id
                  IS NULL
              AND publication_intent.execution_kind =
                  'reconciliation'
              AND publication_intent.actor_profile_id =
                  NEW.authorizing_profile_id
              AND publication_intent.expected_content_version =
                  NEW.bound_content_version
              AND publication_intent.expected_schedule_version =
                  NEW.bound_schedule_version
              AND publication_intent.proposed_publication_status =
                  'published'
              AND NEW.attempted_at IS NOT NULL
            )
            OR (
              NEW.state = 'cancelled'
              AND publication_intent.execution_kind = 'actor'
              AND publication_intent.operation IN (
                'cancel_scheduled_publication', 'public_cancel',
                'publish', 'schedule_publication'
              )
              AND publication_intent.previous_publication_job_id =
                  NEW.id
              AND publication_intent.expected_publication_status =
                  'scheduled'
              AND publication_intent.expected_content_version =
                  NEW.bound_content_version
              AND publication_intent.expected_schedule_version =
                  NEW.bound_schedule_version
              AND (
                (
                  publication_intent.operation =
                      'schedule_publication'
                  AND publication_intent.proposed_publication_status =
                      'scheduled'
                )
                OR (
                  publication_intent.operation = 'publish'
                  AND publication_intent.proposed_publication_status =
                      'published'
                )
                OR (
                  publication_intent.operation NOT IN (
                    'schedule_publication', 'publish'
                  )
                  AND publication_intent.proposed_publication_status
                      IN ('private', 'unpublished')
                )
              )
            )
            OR (
              NEW.state IN ('invalidated', 'failed')
              AND publication_intent.operation =
                  'invalidate_scheduled_publication'
              AND publication_intent.previous_publication_job_id =
                  NEW.id
              AND publication_intent.publication_job_id IS NULL
              AND publication_intent.execution_kind =
                  'reconciliation'
              AND publication_intent.proposed_publication_status =
                  'unpublished'
              AND NEW.attempted_at IS NOT NULL
            )
            OR (
              NEW.state = 'invalidated'
              AND publication_intent.operation IN (
                'update_public_details', 'update_scheduled'
              )
              AND publication_intent.previous_publication_job_id =
                  NEW.id
              AND publication_intent.publication_job_id IS NULL
              AND publication_intent.execution_kind = 'actor'
              AND publication_intent.expected_content_version =
                  NEW.bound_content_version
              AND publication_intent.expected_schedule_version =
                  NEW.bound_schedule_version
              AND publication_intent.proposed_publication_status =
                  'unpublished'
              AND NEW.attempted_at IS NOT NULL
            )
          )
      )
    THEN RAISE(ABORT, 'phase5_publication_job_transition_forbidden')
  END;
END;`;

const PUBLICATION_JOB_BEFORE_DELETE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_publication_jobs_phase5_before_delete
BEFORE DELETE ON organizer_event_publication_jobs
BEGIN
  SELECT RAISE(ABORT, 'phase5_publication_job_delete_forbidden');
END;`;

const ORGANIZER_EVENT_BEFORE_INSERT_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_events_phase5_publication_before_insert
BEFORE INSERT ON organizer_events
WHEN NEW.publication_status <> 'private'
BEGIN
  SELECT RAISE(ABORT, 'phase5_publication_intent_required');
END;`;

const ORGANIZER_EVENT_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_events_phase5_publication_before_update
BEFORE UPDATE ON organizer_events
WHEN NEW.publication_status <> OLD.publication_status
  OR NEW.publication_status <> 'private'
  OR OLD.publication_status <> 'private'
  OR EXISTS (
    SELECT 1
    FROM organizer_event_publication_write_intents AS publication_intent
    WHERE publication_intent.organization_id = NEW.organization_id
      AND publication_intent.organizer_event_id = NEW.id
      AND publication_intent.completed_at IS NULL
  )
  OR EXISTS (
    SELECT 1
    FROM organizer_event_publication_jobs AS pending_job
    WHERE pending_job.organization_id = NEW.organization_id
      AND pending_job.organizer_event_id = NEW.id
      AND pending_job.state = 'pending'
  )
  OR (
    NEW.meetup_event_url IS NOT OLD.meetup_event_url
    AND EXISTS (
      SELECT 1
      FROM organizer_event_public_details AS confirmed_detail
      WHERE confirmed_detail.organization_id = NEW.organization_id
        AND confirmed_detail.organizer_event_id = NEW.id
        AND confirmed_detail.confirmed_meetup_event_url IS NOT NULL
    )
  )
BEGIN
  UPDATE organizer_event_public_details
  SET rsvp_mode = 'coming_soon',
      confirmed_meetup_event_url = NULL,
      meetup_url_confirmed_by_profile_id = NULL,
      meetup_url_confirmed_at = NULL,
      updated_by_profile_id = NEW.updated_by_profile_id,
      updated_at = NEW.updated_at
  WHERE organization_id = NEW.organization_id
    AND organizer_event_id = NEW.id
    AND confirmed_meetup_event_url IS NOT NULL
    AND NEW.meetup_event_url IS NOT OLD.meetup_event_url;

  SELECT CASE
    WHEN (
      NEW.publication_status <> OLD.publication_status
      OR NEW.publication_status <> 'private'
      OR OLD.publication_status <> 'private'
      OR EXISTS (
        SELECT 1
        FROM organizer_event_publication_write_intents
             AS publication_intent
        WHERE publication_intent.organization_id =
              NEW.organization_id
          AND publication_intent.organizer_event_id = NEW.id
          AND publication_intent.completed_at IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM organizer_event_publication_jobs AS pending_job
        WHERE pending_job.organization_id = NEW.organization_id
          AND pending_job.organizer_event_id = NEW.id
          AND pending_job.state = 'pending'
      )
    )
    AND NOT (${OPEN_PUBLICATION_INTENT_FOR_EVENT_UPDATE_SQL})
    THEN RAISE(ABORT, 'phase5_publication_intent_required')
  END;

  SELECT CASE
    WHEN NEW.publication_status = 'scheduled'
      AND (
        NEW.planning_status <> 'confirmed'
        OR NEW.schedule_shape NOT IN ('timed', 'all_day')
        OR NEW.deleted_at IS NOT NULL
        OR NOT (${ORGANIZER_EVENT_PUBLIC_READINESS_SQL})
        OR NOT EXISTS (
          SELECT 1
          FROM organizer_event_publication_jobs AS pending_job
          WHERE pending_job.organization_id = NEW.organization_id
            AND pending_job.organizer_event_id = NEW.id
            AND pending_job.state = 'pending'
            AND pending_job.bound_content_version = NEW.content_version
            AND pending_job.bound_schedule_version =
                NEW.schedule_version
        )
        OR NOT (${ORGANIZER_EVENT_PUBLIC_SLUG_IS_CLEAR_SQL})
      )
    THEN RAISE(ABORT, 'phase5_scheduled_event_not_ready')
  END;

  SELECT CASE
    WHEN NEW.publication_status = 'published'
      AND (
        NEW.planning_status NOT IN (
          'confirmed', 'cancelled', 'completed'
        )
        OR NEW.schedule_shape NOT IN ('timed', 'all_day')
        OR NEW.deleted_at IS NOT NULL
        OR NOT (${ORGANIZER_EVENT_PUBLIC_READINESS_SQL})
        OR NOT (${ORGANIZER_EVENT_PUBLIC_SLUG_IS_CLEAR_SQL})
        OR NOT EXISTS (
          SELECT 1
          FROM organizer_event_publication_state AS publication_state
          WHERE publication_state.organization_id =
                NEW.organization_id
            AND publication_state.organizer_event_id = NEW.id
            AND publication_state.first_published_at IS NOT NULL
            AND publication_state.most_recent_published_at IS NOT NULL
            AND (
              (
                NEW.planning_status = 'cancelled'
                AND publication_state.public_cancellation_at IS NOT NULL
              )
              OR (
                NEW.planning_status IN ('confirmed', 'completed')
                AND publication_state.public_cancellation_at IS NULL
              )
            )
        )
      )
    THEN RAISE(ABORT, 'phase5_published_event_not_ready')
  END;

  SELECT CASE
    WHEN (
      NEW.planning_status = 'archived'
      OR NEW.deleted_at IS NOT NULL
    )
      AND NEW.publication_status IN ('scheduled', 'published')
    THEN RAISE(ABORT, 'phase5_event_must_be_unpublished')
  END;
END;`;

const ORGANIZER_EVENT_HOST_CLEANUP_AFTER_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_events_phase5_host_cleanup_after_update
AFTER UPDATE OF organization_id, primary_organizer_profile_id, deleted_at
ON organizer_events
BEGIN
  DELETE FROM organizer_event_public_hosts
  WHERE organizer_event_id = NEW.id
    AND EXISTS (
      SELECT 1
      FROM organizer_event_public_hosts AS selected_host
      WHERE selected_host.id = organizer_event_public_hosts.id
        AND NOT (${SELECTED_PUBLIC_HOST_IS_CURRENTLY_ELIGIBLE_SQL})
    );
END;`;

const ORGANIZER_ASSOCIATION_HOST_CLEANUP_AFTER_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_organizers_phase5_host_cleanup_after_update
AFTER UPDATE OF organization_id, organizer_event_id, profile_id, deleted_at
ON organizer_event_organizers
BEGIN
  DELETE FROM organizer_event_public_hosts
  WHERE (
      (
        organizer_event_id = OLD.organizer_event_id
        AND profile_id = OLD.profile_id
      )
      OR (
        organizer_event_id = NEW.organizer_event_id
        AND profile_id = NEW.profile_id
      )
    )
    AND EXISTS (
      SELECT 1
      FROM organizer_event_public_hosts AS selected_host
      WHERE selected_host.id = organizer_event_public_hosts.id
        AND NOT (${SELECTED_PUBLIC_HOST_IS_CURRENTLY_ELIGIBLE_SQL})
    );
END;`;

const ORGANIZER_ASSOCIATION_HOST_CLEANUP_AFTER_DELETE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_organizers_phase5_host_cleanup_after_delete
AFTER DELETE ON organizer_event_organizers
BEGIN
  DELETE FROM organizer_event_public_hosts
  WHERE organizer_event_id = OLD.organizer_event_id
    AND profile_id = OLD.profile_id
    AND EXISTS (
      SELECT 1
      FROM organizer_event_public_hosts AS selected_host
      WHERE selected_host.id = organizer_event_public_hosts.id
        AND NOT (${SELECTED_PUBLIC_HOST_IS_CURRENTLY_ELIGIBLE_SQL})
    );
END;`;

const PROFILE_HOST_CLEANUP_AFTER_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS profiles_phase5_host_cleanup_after_update
AFTER UPDATE OF status, deleted_at, public_attribution_consent, display_name
ON profiles
BEGIN
  DELETE FROM organizer_event_public_hosts
  WHERE profile_id = NEW.id
    AND EXISTS (
      SELECT 1
      FROM organizer_event_public_hosts AS selected_host
      WHERE selected_host.id = organizer_event_public_hosts.id
        AND NOT (${SELECTED_PUBLIC_HOST_IS_CURRENTLY_ELIGIBLE_SQL})
    );
END;`;

const MEMBERSHIP_HOST_CLEANUP_AFTER_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organization_memberships_phase5_host_cleanup_after_update
AFTER UPDATE OF organization_id, profile_id, status, deleted_at
ON organization_memberships
BEGIN
  DELETE FROM organizer_event_public_hosts
  WHERE profile_id IN (OLD.profile_id, NEW.profile_id)
    AND organization_id IN (OLD.organization_id, NEW.organization_id)
    AND EXISTS (
      SELECT 1
      FROM organizer_event_public_hosts AS selected_host
      WHERE selected_host.id = organizer_event_public_hosts.id
        AND NOT (${SELECTED_PUBLIC_HOST_IS_CURRENTLY_ELIGIBLE_SQL})
    );
END;`;

const MEMBERSHIP_HOST_CLEANUP_AFTER_DELETE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organization_memberships_phase5_host_cleanup_after_delete
AFTER DELETE ON organization_memberships
BEGIN
  DELETE FROM organizer_event_public_hosts
  WHERE profile_id = OLD.profile_id
    AND organization_id = OLD.organization_id
    AND EXISTS (
      SELECT 1
      FROM organizer_event_public_hosts AS selected_host
      WHERE selected_host.id = organizer_event_public_hosts.id
        AND NOT (${SELECTED_PUBLIC_HOST_IS_CURRENTLY_ELIGIBLE_SQL})
    );
END;`;

export const PHASE5_INVARIANT_TRIGGER_STATEMENTS = Object.freeze([
  ORGANIZATION_PUBLICATION_POLICY_BEFORE_INSERT_SQL,
  ORGANIZATION_PUBLICATION_POLICY_BEFORE_UPDATE_SQL,
  ORGANIZATION_PUBLICATION_POLICY_BEFORE_DELETE_SQL,
  PUBLICATION_INTENT_BEFORE_INSERT_SQL,
  PUBLICATION_INTENT_BEFORE_UPDATE_SQL,
  PUBLICATION_INTENT_BEFORE_DELETE_SQL,
  PUBLIC_DETAILS_BEFORE_INSERT_SQL,
  PUBLIC_DETAILS_BEFORE_UPDATE_SQL,
  PUBLIC_DETAILS_BEFORE_DELETE_SQL,
  PUBLIC_HOST_BEFORE_INSERT_SQL,
  PUBLIC_HOST_BEFORE_UPDATE_SQL,
  PUBLIC_HOST_BEFORE_DELETE_SQL,
  PUBLICATION_STATE_BEFORE_INSERT_SQL,
  PUBLICATION_STATE_BEFORE_UPDATE_SQL,
  PUBLICATION_STATE_BEFORE_DELETE_SQL,
  PUBLICATION_JOB_BEFORE_INSERT_SQL,
  PUBLICATION_JOB_BEFORE_UPDATE_SQL,
  PUBLICATION_JOB_BEFORE_DELETE_SQL,
  ORGANIZER_EVENT_BEFORE_INSERT_SQL,
  ORGANIZER_EVENT_BEFORE_UPDATE_SQL,
  ORGANIZER_EVENT_HOST_CLEANUP_AFTER_UPDATE_SQL,
  ORGANIZER_ASSOCIATION_HOST_CLEANUP_AFTER_UPDATE_SQL,
  ORGANIZER_ASSOCIATION_HOST_CLEANUP_AFTER_DELETE_SQL,
  PROFILE_HOST_CLEANUP_AFTER_UPDATE_SQL,
  MEMBERSHIP_HOST_CLEANUP_AFTER_UPDATE_SQL,
  MEMBERSHIP_HOST_CLEANUP_AFTER_DELETE_SQL,
]);

const PHASE5_SIDECAR_ORGANIZATION_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM (
  SELECT detail.organizer_event_id AS row_id
  FROM organizer_event_public_details AS detail
  WHERE NOT EXISTS (
    SELECT 1
    FROM organizer_events AS event
    WHERE event.id = detail.organizer_event_id
      AND event.organization_id = detail.organization_id
  )
    OR NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS creator
      WHERE creator.organization_id = detail.organization_id
        AND creator.profile_id = detail.created_by_profile_id
    )
    OR NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS updater
      WHERE updater.organization_id = detail.organization_id
        AND updater.profile_id = detail.updated_by_profile_id
    )
    OR NOT (${publicDetailsUrlsAreSafeSql("detail")})
  UNION ALL
  SELECT publication_state.organizer_event_id AS row_id
  FROM organizer_event_publication_state AS publication_state
  WHERE NOT EXISTS (
    SELECT 1
    FROM organizer_events AS event
    WHERE event.id = publication_state.organizer_event_id
      AND event.organization_id = publication_state.organization_id
  )
    OR NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS actor
      WHERE actor.organization_id = publication_state.organization_id
        AND actor.profile_id =
            publication_state.last_mutation_actor_profile_id
    )
  UNION ALL
  SELECT job.id AS row_id
  FROM organizer_event_publication_jobs AS job
  WHERE NOT EXISTS (
    SELECT 1
    FROM organizer_events AS event
    WHERE event.id = job.organizer_event_id
      AND event.organization_id = job.organization_id
  )
    OR NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS authorizer
      WHERE authorizer.organization_id = job.organization_id
        AND authorizer.profile_id = job.authorizing_profile_id
    )
  UNION ALL
  SELECT publication_intent.id AS row_id
  FROM organizer_event_publication_write_intents AS publication_intent
  WHERE NOT EXISTS (
    SELECT 1
    FROM organizer_events AS event
    JOIN organizer_schedule_write_intents AS schedule_intent
      ON schedule_intent.id =
         publication_intent.schedule_write_intent_id
     AND schedule_intent.organization_id =
         publication_intent.organization_id
     AND schedule_intent.organizer_event_id =
         publication_intent.organizer_event_id
     AND schedule_intent.actor_profile_id =
         publication_intent.actor_profile_id
    WHERE event.id = publication_intent.organizer_event_id
      AND event.organization_id = publication_intent.organization_id
  )
  UNION ALL
  SELECT publication_policy.organization_id AS row_id
  FROM organization_publication_policies AS publication_policy
  WHERE NOT EXISTS (
    SELECT 1
    FROM organization_memberships AS updater
    WHERE updater.organization_id = publication_policy.organization_id
      AND updater.profile_id = publication_policy.updated_by_profile_id
  )
) AS invalid_phase5_sidecar`;

const PHASE5_PUBLIC_HOST_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM organizer_event_public_hosts AS selected_host
WHERE NOT (${SELECTED_PUBLIC_HOST_IS_CURRENTLY_ELIGIBLE_SQL})
   OR NOT EXISTS (
     SELECT 1
     FROM organization_memberships AS selector_membership
     WHERE selector_membership.organization_id =
           selected_host.organization_id
       AND selector_membership.profile_id =
           selected_host.selected_by_profile_id
   )`;

const PHASE5_OPEN_INTENT_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM organizer_event_publication_write_intents AS publication_intent
WHERE publication_intent.completed_at IS NULL
   OR NOT EXISTS (
     SELECT 1
     FROM organizer_schedule_write_intents AS schedule_intent
     WHERE schedule_intent.id =
           publication_intent.schedule_write_intent_id
       AND schedule_intent.organization_id =
           publication_intent.organization_id
       AND schedule_intent.organizer_event_id =
           publication_intent.organizer_event_id
       AND schedule_intent.actor_profile_id =
           publication_intent.actor_profile_id
       AND schedule_intent.expected_content_version =
           publication_intent.expected_content_version
       AND schedule_intent.expected_schedule_version =
           publication_intent.expected_schedule_version
       AND schedule_intent.proposed_content_version =
           publication_intent.proposed_content_version
       AND schedule_intent.proposed_schedule_version =
           publication_intent.proposed_schedule_version
       AND schedule_intent.completed_at IS NOT NULL
       AND ${PUBLICATION_OPERATION_SCHEDULE_MAPPING_FOR_EVENT_SQL}
   )
   OR NOT EXISTS (
     SELECT 1
     FROM organizer_event_revisions AS revision
     WHERE revision.organization_id = publication_intent.organization_id
       AND revision.organizer_event_id =
           publication_intent.organizer_event_id
       AND revision.content_version =
           publication_intent.proposed_content_version
       AND revision.schedule_version =
           publication_intent.proposed_schedule_version
       AND revision.actor_profile_id =
           publication_intent.actor_profile_id
       AND ${PUBLICATION_REVISION_MATCH_FOR_SCAN_SQL}
   )
   OR NOT EXISTS (
     SELECT 1
     FROM audit_logs AS audit
     WHERE audit.organization_id = publication_intent.organization_id
       AND audit.actor_profile_id = publication_intent.actor_profile_id
       AND audit.entity_type = 'organizer_event'
       AND audit.entity_id = publication_intent.organizer_event_id
       AND audit.created_at BETWEEN publication_intent.created_at
                                AND publication_intent.completed_at
       AND ${PUBLICATION_AUDIT_MATCH_FOR_SCAN_SQL}
   )
   OR (
     publication_intent.operation = 'schedule_publication'
     AND NOT EXISTS (
       SELECT 1
       FROM organizer_event_publication_jobs AS created_job
       WHERE created_job.id = publication_intent.publication_job_id
         AND created_job.organization_id =
             publication_intent.organization_id
         AND created_job.organizer_event_id =
             publication_intent.organizer_event_id
         AND created_job.authorizing_profile_id =
             publication_intent.actor_profile_id
         AND created_job.bound_content_version =
             publication_intent.proposed_content_version
         AND created_job.bound_schedule_version =
             publication_intent.proposed_schedule_version
     )
   )
   OR (
     publication_intent.operation = 'reconcile_publication'
     AND NOT EXISTS (
       SELECT 1
       FROM organizer_event_publication_jobs AS executed_job
       WHERE executed_job.id = publication_intent.publication_job_id
         AND executed_job.organization_id =
             publication_intent.organization_id
         AND executed_job.organizer_event_id =
             publication_intent.organizer_event_id
         AND executed_job.authorizing_profile_id =
             publication_intent.actor_profile_id
         AND executed_job.bound_content_version =
             publication_intent.expected_content_version
         AND executed_job.bound_schedule_version =
             publication_intent.expected_schedule_version
         AND executed_job.state = 'executed'
     )
   )
   OR (
     (
       publication_intent.operation IN (
         'cancel_scheduled_publication', 'public_cancel',
         'publish'
       )
       AND publication_intent.expected_publication_status =
           'scheduled'
     )
     OR (
       publication_intent.operation = 'schedule_publication'
       AND publication_intent.expected_publication_status =
           'scheduled'
     )
   )
   AND NOT EXISTS (
     SELECT 1
     FROM organizer_event_publication_jobs AS cancelled_job
     WHERE cancelled_job.id =
           publication_intent.previous_publication_job_id
       AND cancelled_job.organization_id =
           publication_intent.organization_id
       AND cancelled_job.organizer_event_id =
           publication_intent.organizer_event_id
       AND cancelled_job.bound_content_version =
           publication_intent.expected_content_version
       AND cancelled_job.bound_schedule_version =
           publication_intent.expected_schedule_version
       AND cancelled_job.state = 'cancelled'
   )
   OR (
     publication_intent.operation IN (
       'update_public_details', 'update_scheduled'
     )
     AND publication_intent.expected_publication_status = 'scheduled'
     AND NOT EXISTS (
       SELECT 1
       FROM organizer_event_publication_jobs AS invalidated_detail_job
       WHERE invalidated_detail_job.id =
             publication_intent.previous_publication_job_id
         AND invalidated_detail_job.organization_id =
             publication_intent.organization_id
         AND invalidated_detail_job.organizer_event_id =
             publication_intent.organizer_event_id
         AND invalidated_detail_job.bound_content_version =
             publication_intent.expected_content_version
         AND invalidated_detail_job.bound_schedule_version =
             publication_intent.expected_schedule_version
         AND invalidated_detail_job.state = 'invalidated'
     )
   )
   OR (
     publication_intent.operation =
         'invalidate_scheduled_publication'
     AND NOT EXISTS (
       SELECT 1
       FROM organizer_event_publication_jobs AS invalidated_job
       WHERE invalidated_job.id =
             publication_intent.previous_publication_job_id
         AND invalidated_job.organization_id =
             publication_intent.organization_id
         AND invalidated_job.organizer_event_id =
             publication_intent.organizer_event_id
         AND invalidated_job.state IN ('invalidated', 'failed')
     )
   )`;

const PHASE5_PENDING_JOB_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM organizer_event_publication_jobs AS job
WHERE job.state = 'pending'
  AND NOT EXISTS (
    SELECT 1
    FROM organizer_events AS event
    WHERE event.id = job.organizer_event_id
      AND event.organization_id = job.organization_id
      AND event.publication_status = 'scheduled'
      AND event.planning_status = 'confirmed'
      AND event.deleted_at IS NULL
  )`;

const PHASE5_PUBLIC_EVENT_READINESS_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM organizer_events AS event
WHERE event.publication_status IN ('scheduled', 'published')
  AND (
    event.deleted_at IS NOT NULL
    OR event.schedule_shape NOT IN ('timed', 'all_day')
    OR (
      event.publication_status = 'scheduled'
      AND event.planning_status <> 'confirmed'
    )
    OR (
      event.publication_status = 'published'
      AND event.planning_status NOT IN (
        'confirmed', 'cancelled', 'completed'
      )
    )
    OR coalesce(length(trim(event.title)), 0) NOT BETWEEN 1 AND 180
    OR coalesce(length(trim(event.slug)), 0) NOT BETWEEN 1 AND 200
    OR coalesce(length(trim(event.summary)), 0) NOT BETWEEN 1 AND 500
    OR coalesce(length(trim(event.description)), 0)
       NOT BETWEEN 1 AND 20000
    OR NOT EXISTS (
      SELECT 1
      FROM organizer_event_public_details AS public_detail
      JOIN organizer_event_publication_state AS publication_state
        ON publication_state.organizer_event_id =
           public_detail.organizer_event_id
       AND publication_state.organization_id =
           public_detail.organization_id
      JOIN clubs AS club
        ON club.id = event.club_id
       AND club.organization_id = event.organization_id
       AND club.deleted_at IS NULL
      JOIN club_public_profiles AS club_public
        ON club_public.club_id = club.id
       AND club_public.organization_id = club.organization_id
       AND club_public.publication_status = 'published'
       AND club_public.published_at IS NOT NULL
       AND club_public.deleted_at IS NULL
      WHERE public_detail.organizer_event_id = event.id
        AND public_detail.organization_id = event.organization_id
        AND (
          (
            public_detail.attendance_mode = 'in_person'
            AND length(trim(public_detail.public_location_name))
                BETWEEN 1 AND 500
          )
          OR (
            public_detail.attendance_mode = 'online'
            AND length(trim(public_detail.public_online_url))
                BETWEEN 1 AND 2048
            AND ${httpsUrlSql("public_detail.public_online_url")}
          )
          OR (
            public_detail.attendance_mode = 'hybrid'
            AND length(trim(public_detail.public_location_name))
                BETWEEN 1 AND 500
            AND length(trim(public_detail.public_online_url))
                BETWEEN 1 AND 2048
            AND ${httpsUrlSql("public_detail.public_online_url")}
          )
        )
        AND (
          public_detail.rsvp_mode = 'coming_soon'
          OR (
            public_detail.rsvp_mode = 'meetup'
            AND event.meetup_event_url IS NOT NULL
            AND public_detail.confirmed_meetup_event_url =
                event.meetup_event_url
            AND ${canonicalMeetupEventUrlSql(
              "public_detail.confirmed_meetup_event_url",
            )}
            AND public_detail.meetup_url_confirmed_by_profile_id
                IS NOT NULL
            AND public_detail.meetup_url_confirmed_at IS NOT NULL
          )
        )
    )
    OR (
      event.publication_status = 'scheduled'
      AND (
        SELECT count(*)
        FROM organizer_event_publication_jobs AS job
        WHERE job.organization_id = event.organization_id
          AND job.organizer_event_id = event.id
          AND job.state = 'pending'
      ) <> 1
    )
    OR (
      event.publication_status = 'published'
      AND NOT EXISTS (
        SELECT 1
        FROM organizer_event_publication_state AS publication_state
        WHERE publication_state.organization_id = event.organization_id
          AND publication_state.organizer_event_id = event.id
          AND publication_state.first_published_at IS NOT NULL
          AND publication_state.most_recent_published_at IS NOT NULL
          AND (
            (
              event.planning_status = 'cancelled'
              AND publication_state.public_cancellation_at IS NOT NULL
            )
            OR (
              event.planning_status IN ('confirmed', 'completed')
              AND publication_state.public_cancellation_at IS NULL
            )
          )
      )
    )
  )`;

const PHASE5_PUBLIC_SLUG_COLLISION_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM organizer_events AS organizer_event
WHERE organizer_event.publication_status IN ('scheduled', 'published')
  AND ${publicSlugCollisionSql({
    eventIdSql: "organizer_event.id",
    organizationIdSql: "organizer_event.organization_id",
    slugSql: "organizer_event.slug",
  })}`;

export const PHASE5_INVARIANT_COUNT_SQL = Object.freeze([
  PHASE5_SIDECAR_ORGANIZATION_COUNT_SQL,
  PHASE5_PUBLIC_HOST_COUNT_SQL,
  PHASE5_OPEN_INTENT_COUNT_SQL,
  PHASE5_PENDING_JOB_COUNT_SQL,
  PHASE5_PUBLIC_EVENT_READINESS_COUNT_SQL,
  PHASE5_PUBLIC_SLUG_COLLISION_COUNT_SQL,
]);
