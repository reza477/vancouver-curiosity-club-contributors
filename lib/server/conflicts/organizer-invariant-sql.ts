/**
 * Phase 4 database guards for the canonical `organizer_events` scheduling
 * path. The Sites migration tokenizer cannot carry SQLite trigger bodies, so
 * these complete single statements are installed and fingerprinted by the
 * server-only invariant initializer.
 *
 * The organizer-event INSERT/UPDATE triggers remain in
 * `organizer/invariant-sql.ts` because they replace the Phase 3 lifecycle
 * guards in place. This file owns the intent, reservation, policy, review,
 * override, and source-activation sides of the same contract.
 */

const ACTIVE_ACTOR_FOR_ORGANIZATION_SQL = String.raw`
EXISTS (
  SELECT 1
  FROM profiles AS actor_profile
  JOIN organization_memberships AS actor_membership
    ON actor_membership.profile_id = actor_profile.id
   AND actor_membership.organization_id = NEW.organization_id
   AND actor_membership.status = 'active'
   AND actor_membership.deleted_at IS NULL
  WHERE actor_profile.id = NEW.actor_profile_id
    AND actor_profile.status = 'active'
    AND actor_profile.deleted_at IS NULL
)`;

const ACTIVE_RESERVATION_CONFLICT_SQL = String.raw`
(
  EXISTS (
    SELECT 1
    FROM organizer_reservation_states AS reserved
    JOIN organizer_events AS reserved_event
      ON reserved_event.id = reserved.organizer_event_id
     AND reserved_event.organization_id = reserved.organization_id
     AND reserved_event.deleted_at IS NULL
    WHERE reserved.organization_id = NEW.organization_id
      AND reserved.organizer_event_id <> NEW.organizer_event_id
      AND reserved.planning_status IN ('tentative_hold', 'confirmed')
      AND (
        reserved.planning_status <> 'tentative_hold'
        OR reserved.hold_expires_at >
           CAST(unixepoch('subsec') * 1000 AS INTEGER)
      )
      AND reserved.expanded_start_utc < NEW.expanded_end_utc
      AND NEW.expanded_start_utc < reserved.expanded_end_utc
  )
  OR EXISTS (
    SELECT 1
    FROM organizer_external_reservation_intervals AS reserved
    WHERE reserved.organization_id = NEW.organization_id
      AND reserved.event_id <> NEW.organizer_event_id
      AND reserved.planning_status IN (
        'hold', 'tentative', 'tentative_hold', 'confirmed'
      )
      AND (
        reserved.planning_status NOT IN ('hold', 'tentative_hold')
        OR reserved.hold_expires_at IS NULL
        OR reserved.hold_expires_at >
           CAST(unixepoch('subsec') * 1000 AS INTEGER)
      )
      AND reserved.expanded_start_utc < NEW.expanded_end_utc
      AND NEW.expanded_start_utc < reserved.expanded_end_utc
      AND (
        reserved.source_kind = 'legacy'
        OR (
          reserved.source_kind = 'meetup'
          AND EXISTS (
            SELECT 1
            FROM sync_sources AS active_source
            JOIN meetup_sync_generations AS active_generation
              ON active_generation.id = active_source.active_generation_id
             AND active_generation.sync_source_id = active_source.id
             AND active_generation.state = 'published'
            WHERE active_source.id = reserved.sync_source_id
              AND active_source.organization_id = reserved.organization_id
              AND active_source.active_generation_id =
                  reserved.generation_id
              AND active_source.enabled = 1
              AND active_source.deleted_at IS NULL
          )
        )
      )
  )
)`;

/*
 * The intent insert is an authorization/preflight record, not permission by
 * itself. A reserving state is allowed only when every conflict that exists at
 * the committing mutation has an exact incident and active version-bound
 * override created earlier in the same D1 batch.
 */
const MISSING_MANUAL_CONFLICT_AUTHORIZATION_SQL = String.raw`
EXISTS (
  SELECT 1
  FROM organizer_reservation_states AS reserved
  JOIN organizer_events AS reserved_event
    ON reserved_event.id = reserved.organizer_event_id
   AND reserved_event.organization_id = reserved.organization_id
   AND reserved_event.deleted_at IS NULL
  WHERE reserved.organization_id = NEW.organization_id
    AND reserved.organizer_event_id <> NEW.organizer_event_id
    AND reserved.planning_status IN ('tentative_hold', 'confirmed')
    AND (
      reserved.planning_status <> 'tentative_hold'
      OR reserved.hold_expires_at >
         CAST(unixepoch('subsec') * 1000 AS INTEGER)
    )
    AND reserved.expanded_start_utc < NEW.expanded_end_utc
    AND NEW.expanded_start_utc < reserved.expanded_end_utc
    AND NOT EXISTS (
      SELECT 1
      FROM organizer_conflict_incidents AS incident
      JOIN organizer_conflict_overrides AS override
        ON override.incident_id = incident.id
       AND override.organization_id = incident.organization_id
       AND override.organizer_event_id = incident.organizer_event_id
       AND override.conflicting_candidate_key =
           incident.conflicting_candidate_key
       AND override.proposed_schedule_version =
           incident.proposed_schedule_version
       AND override.conflicting_schedule_version =
           incident.conflicting_schedule_version
       AND override.policy_id = incident.policy_id
       AND override.policy_version = incident.policy_version
       AND override.state_fingerprint = incident.state_fingerprint
       AND override.invalidated_at IS NULL
      JOIN organizer_schedule_write_intents AS intent
        ON intent.id = NEW.write_intent_id
       AND intent.organization_id = NEW.organization_id
       AND intent.organizer_event_id = NEW.organizer_event_id
       AND intent.completed_at IS NULL
      WHERE incident.organization_id = NEW.organization_id
        AND incident.organizer_event_id = NEW.organizer_event_id
        AND incident.conflicting_candidate_key =
            'manual:' || reserved.organizer_event_id
        AND incident.conflicting_event_id =
            reserved.organizer_event_id
        AND incident.conflicting_source_kind = 'manual'
        AND incident.proposed_schedule_version = NEW.schedule_version
        AND incident.conflicting_schedule_version =
            reserved.schedule_version
        AND incident.policy_id = intent.policy_id
        AND incident.policy_version = intent.policy_version
        AND incident.classification = CASE
          WHEN reserved.actual_start_utc < NEW.actual_end_utc
           AND NEW.actual_start_utc < reserved.actual_end_utc
          THEN 'direct' ELSE 'buffer' END
        AND incident.overlap_start_utc = CASE
          WHEN reserved.actual_start_utc < NEW.actual_end_utc
           AND NEW.actual_start_utc < reserved.actual_end_utc
          THEN max(reserved.actual_start_utc, NEW.actual_start_utc)
          ELSE max(reserved.expanded_start_utc, NEW.expanded_start_utc)
        END
        AND incident.overlap_end_utc = CASE
          WHEN reserved.actual_start_utc < NEW.actual_end_utc
           AND NEW.actual_start_utc < reserved.actual_end_utc
          THEN min(reserved.actual_end_utc, NEW.actual_end_utc)
          ELSE min(reserved.expanded_end_utc, NEW.expanded_end_utc)
        END
        AND incident.resources_json = (
          SELECT json_group_array(json(resource_json))
          FROM (
            SELECT
              json_object(
                'type', 'organization',
                'resourceId', NEW.organization_id
              ) AS resource_json,
              0 AS resource_rank,
              NEW.organization_id AS resource_id
            UNION ALL
            SELECT
              json_object(
                'type',
                CASE
                  WHEN CAST(proposed_scope.value AS TEXT) =
                       NEW.primary_organizer_profile_id
                   AND CAST(proposed_scope.value AS TEXT) =
                       reserved.primary_organizer_profile_id
                  THEN 'primary_organizer'
                  ELSE 'co_organizer'
                END,
                'resourceId', CAST(proposed_scope.value AS TEXT)
              ),
              CASE
                WHEN CAST(proposed_scope.value AS TEXT) =
                     NEW.primary_organizer_profile_id
                 AND CAST(proposed_scope.value AS TEXT) =
                     reserved.primary_organizer_profile_id
                THEN 1 ELSE 2
              END,
              CAST(proposed_scope.value AS TEXT)
            FROM json_each(NEW.organizer_scope_json) AS proposed_scope
            WHERE proposed_scope.type = 'text'
              AND EXISTS (
                SELECT 1
                FROM json_each(reserved.organizer_scope_json)
                     AS reserved_scope
                WHERE reserved_scope.type = 'text'
                  AND CAST(reserved_scope.value AS TEXT) =
                      CAST(proposed_scope.value AS TEXT)
              )
            UNION ALL
            SELECT
              json_object(
                'type', 'venue',
                'resourceId', NEW.venue_id
              ),
              3,
              NEW.venue_id
            WHERE NEW.venue_id IS NOT NULL
              AND NEW.venue_id = reserved.venue_id
            ORDER BY resource_rank, resource_id
          )
        )
        AND incident.state_fingerprint = intent.state_fingerprint
        AND incident.state = 'open'
        AND incident.write_intent_id = intent.id
        AND incident.detected_by_profile_id =
            intent.actor_profile_id
        AND incident.resolved_at IS NULL
        AND override.actor_profile_id = intent.actor_profile_id
        AND (
          (
            intent.policy_mode = 'warn_reason'
            AND override.review_request_id IS NULL
            AND override.reason = intent.reason
          )
          OR (
            intent.policy_mode = 'require_admin_approval'
            AND override.review_request_id = intent.review_request_id
            AND EXISTS (
              SELECT 1
              FROM organizer_conflict_review_requests AS review
              WHERE review.id = intent.review_request_id
                AND review.organization_id = intent.organization_id
                AND review.organizer_event_id =
                    intent.organizer_event_id
                AND review.requested_schedule_version =
                    intent.proposed_schedule_version
                AND review.requested_planning_status =
                    intent.planning_status
                AND review.state_fingerprint =
                    intent.state_fingerprint
                AND review.policy_id = intent.policy_id
                AND review.policy_version = intent.policy_version
                AND review.state = 'approved'
            )
          )
        )
    )
)`;

const MISSING_EXTERNAL_CONFLICT_AUTHORIZATION_SQL = String.raw`
EXISTS (
  SELECT 1
  FROM organizer_external_reservation_intervals AS reserved
  WHERE reserved.organization_id = NEW.organization_id
    AND reserved.event_id <> NEW.organizer_event_id
    AND reserved.planning_status IN (
      'hold', 'tentative', 'tentative_hold', 'confirmed'
    )
    AND (
      reserved.planning_status NOT IN ('hold', 'tentative_hold')
      OR reserved.hold_expires_at IS NULL
      OR reserved.hold_expires_at >
         CAST(unixepoch('subsec') * 1000 AS INTEGER)
    )
    AND reserved.expanded_start_utc < NEW.expanded_end_utc
    AND NEW.expanded_start_utc < reserved.expanded_end_utc
    AND (
      reserved.source_kind = 'legacy'
      OR (
        reserved.source_kind = 'meetup'
        AND EXISTS (
          SELECT 1
          FROM sync_sources AS active_source
          JOIN meetup_sync_generations AS active_generation
            ON active_generation.id = active_source.active_generation_id
           AND active_generation.sync_source_id = active_source.id
           AND active_generation.state = 'published'
          WHERE active_source.id = reserved.sync_source_id
            AND active_source.organization_id = reserved.organization_id
            AND active_source.active_generation_id =
                reserved.generation_id
            AND active_source.enabled = 1
            AND active_source.deleted_at IS NULL
        )
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM organizer_conflict_incidents AS incident
      JOIN organizer_conflict_overrides AS override
        ON override.incident_id = incident.id
       AND override.organization_id = incident.organization_id
       AND override.organizer_event_id = incident.organizer_event_id
       AND override.conflicting_candidate_key =
           incident.conflicting_candidate_key
       AND override.proposed_schedule_version =
           incident.proposed_schedule_version
       AND override.conflicting_schedule_version =
           incident.conflicting_schedule_version
       AND override.policy_id = incident.policy_id
       AND override.policy_version = incident.policy_version
       AND override.state_fingerprint = incident.state_fingerprint
       AND override.invalidated_at IS NULL
      JOIN organizer_schedule_write_intents AS intent
        ON intent.id = NEW.write_intent_id
       AND intent.organization_id = NEW.organization_id
       AND intent.organizer_event_id = NEW.organizer_event_id
       AND intent.completed_at IS NULL
      WHERE incident.organization_id = NEW.organization_id
        AND incident.organizer_event_id = NEW.organizer_event_id
        AND incident.conflicting_candidate_key =
            reserved.source_kind || ':' || reserved.id
        AND incident.conflicting_event_id = reserved.event_id
        AND incident.conflicting_source_kind = reserved.source_kind
        AND incident.proposed_schedule_version = NEW.schedule_version
        AND incident.conflicting_schedule_version =
            reserved.schedule_version
        AND incident.policy_id = intent.policy_id
        AND incident.policy_version = intent.policy_version
        AND incident.classification = CASE
          WHEN reserved.actual_start_utc < NEW.actual_end_utc
           AND NEW.actual_start_utc < reserved.actual_end_utc
          THEN 'direct' ELSE 'buffer' END
        AND incident.overlap_start_utc = CASE
          WHEN reserved.actual_start_utc < NEW.actual_end_utc
           AND NEW.actual_start_utc < reserved.actual_end_utc
          THEN max(reserved.actual_start_utc, NEW.actual_start_utc)
          ELSE max(reserved.expanded_start_utc, NEW.expanded_start_utc)
        END
        AND incident.overlap_end_utc = CASE
          WHEN reserved.actual_start_utc < NEW.actual_end_utc
           AND NEW.actual_start_utc < reserved.actual_end_utc
          THEN min(reserved.actual_end_utc, NEW.actual_end_utc)
          ELSE min(reserved.expanded_end_utc, NEW.expanded_end_utc)
        END
        AND incident.resources_json = (
          SELECT json_group_array(json(resource_json))
          FROM (
            SELECT
              json_object(
                'type', 'organization',
                'resourceId', NEW.organization_id
              ) AS resource_json,
              0 AS resource_rank,
              NEW.organization_id AS resource_id
            UNION ALL
            SELECT
              json_object(
                'type',
                CASE
                  WHEN CAST(proposed_scope.value AS TEXT) =
                       NEW.primary_organizer_profile_id
                   AND CAST(proposed_scope.value AS TEXT) =
                       reserved.primary_organizer_profile_id
                  THEN 'primary_organizer'
                  ELSE 'co_organizer'
                END,
                'resourceId', CAST(proposed_scope.value AS TEXT)
              ),
              CASE
                WHEN CAST(proposed_scope.value AS TEXT) =
                     NEW.primary_organizer_profile_id
                 AND CAST(proposed_scope.value AS TEXT) =
                     reserved.primary_organizer_profile_id
                THEN 1 ELSE 2
              END,
              CAST(proposed_scope.value AS TEXT)
            FROM json_each(NEW.organizer_scope_json) AS proposed_scope
            WHERE proposed_scope.type = 'text'
              AND EXISTS (
                SELECT 1
                FROM json_each(reserved.organizer_scope_json)
                     AS reserved_scope
                WHERE reserved_scope.type = 'text'
                  AND CAST(reserved_scope.value AS TEXT) =
                      CAST(proposed_scope.value AS TEXT)
              )
            UNION ALL
            SELECT
              json_object(
                'type', 'venue',
                'resourceId', NEW.venue_id
              ),
              3,
              NEW.venue_id
            WHERE NEW.venue_id IS NOT NULL
              AND NEW.venue_id = reserved.venue_id
            ORDER BY resource_rank, resource_id
          )
        )
        AND incident.state_fingerprint = intent.state_fingerprint
        AND incident.state = 'open'
        AND incident.write_intent_id = intent.id
        AND incident.detected_by_profile_id =
            intent.actor_profile_id
        AND incident.resolved_at IS NULL
        AND override.actor_profile_id = intent.actor_profile_id
        AND (
          (
            intent.policy_mode = 'warn_reason'
            AND override.review_request_id IS NULL
            AND override.reason = intent.reason
          )
          OR (
            intent.policy_mode = 'require_admin_approval'
            AND override.review_request_id = intent.review_request_id
            AND EXISTS (
              SELECT 1
              FROM organizer_conflict_review_requests AS review
              WHERE review.id = intent.review_request_id
                AND review.organization_id = intent.organization_id
                AND review.organizer_event_id =
                    intent.organizer_event_id
                AND review.requested_schedule_version =
                    intent.proposed_schedule_version
                AND review.requested_planning_status =
                    intent.planning_status
                AND review.state_fingerprint =
                    intent.state_fingerprint
                AND review.policy_id = intent.policy_id
                AND review.policy_version = intent.policy_version
                AND review.state = 'approved'
            )
          )
        )
    )
)`;

const RESERVATION_POLICY_COMMIT_GUARD_SQL = String.raw`
(
  EXISTS (
    SELECT 1
    FROM organizer_schedule_write_intents AS intent
    WHERE intent.id = NEW.write_intent_id
      AND intent.policy_mode = 'block'
  )
  AND ${ACTIVE_RESERVATION_CONFLICT_SQL}
)
OR (
  EXISTS (
    SELECT 1
    FROM organizer_schedule_write_intents AS intent
    WHERE intent.id = NEW.write_intent_id
      AND intent.policy_mode IN (
        'warn_reason', 'require_admin_approval'
      )
  )
  AND (
    ${MISSING_MANUAL_CONFLICT_AUTHORIZATION_SQL}
    OR ${MISSING_EXTERNAL_CONFLICT_AUTHORIZATION_SQL}
  )
)`;

const SCHEDULE_INTENT_BEFORE_INSERT_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_schedule_write_intents_phase4_before_insert
BEFORE INSERT ON organizer_schedule_write_intents
BEGIN
  SELECT CASE
    WHEN NEW.completed_at IS NOT NULL
      OR NEW.operation NOT IN (
        'create', 'update', 'place_hold', 'extend_hold', 'release_hold',
        'confirm', 'cancel', 'complete', 'archive', 'soft_delete',
        'restore', 'duplicate', 'duplicate_reserving', 'phase4_backfill'
      )
    THEN RAISE(ABORT, 'phase4_intent_reference_mismatch')
  END;

  SELECT CASE
    WHEN NOT ${ACTIVE_ACTOR_FOR_ORGANIZATION_SQL}
    THEN RAISE(ABORT, 'phase4_intent_actor_forbidden')
  END;

  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS actor_membership
      WHERE actor_membership.organization_id = NEW.organization_id
        AND actor_membership.profile_id = NEW.actor_profile_id
        AND actor_membership.status = 'active'
        AND actor_membership.deleted_at IS NULL
        AND (
          actor_membership.role IN ('owner', 'administrator')
          OR (
            actor_membership.role = 'organizer'
            AND EXISTS (
              SELECT 1
              FROM club_memberships AS actor_club
              WHERE actor_club.organization_id = NEW.organization_id
                AND actor_club.club_id = NEW.club_id
                AND actor_club.organization_membership_id =
                    actor_membership.id
                AND actor_club.profile_id = NEW.actor_profile_id
                AND actor_club.status = 'active'
                AND actor_club.deleted_at IS NULL
            )
          )
        )
    )
    THEN RAISE(ABORT, 'phase4_intent_actor_forbidden')
  END;

  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM clubs AS club
      WHERE club.id = NEW.club_id
        AND club.organization_id = NEW.organization_id
        AND club.deleted_at IS NULL
    )
    OR (
      NEW.venue_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM venues AS venue
        WHERE venue.id = NEW.venue_id
          AND venue.organization_id = NEW.organization_id
          AND venue.deleted_at IS NULL
      )
    )
    OR NOT EXISTS (
      SELECT 1
      FROM organizer_conflict_policies AS policy
      WHERE policy.id = NEW.policy_id
        AND policy.organization_id = NEW.organization_id
        AND policy.policy_version = NEW.policy_version
        AND policy.mode = NEW.policy_mode
    )
    THEN RAISE(ABORT, 'phase4_intent_reference_mismatch')
  END;

  SELECT CASE
    WHEN json_array_length(NEW.organizer_scope_json) < 1
      OR NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.organizer_scope_json) AS primary_scope
        WHERE primary_scope.type = 'text'
          AND CAST(primary_scope.value AS TEXT) =
              NEW.primary_organizer_profile_id
      )
      OR EXISTS (
        SELECT 1
        FROM json_each(NEW.organizer_scope_json) AS scope
        WHERE scope.type <> 'text'
          OR length(trim(CAST(scope.value AS TEXT))) = 0
      )
      OR (
        SELECT count(*)
        FROM json_each(NEW.organizer_scope_json)
      ) <> (
        SELECT count(DISTINCT CAST(scope.value AS TEXT))
        FROM json_each(NEW.organizer_scope_json) AS scope
      )
      OR EXISTS (
        SELECT 1
        FROM json_each(NEW.organizer_scope_json) AS scope
        WHERE NOT EXISTS (
          SELECT 1
          FROM profiles AS organizer
          JOIN organization_memberships AS membership
            ON membership.profile_id = organizer.id
           AND membership.organization_id = NEW.organization_id
           AND membership.status = 'active'
           AND membership.deleted_at IS NULL
          WHERE organizer.id = CAST(scope.value AS TEXT)
            AND organizer.status = 'active'
            AND organizer.deleted_at IS NULL
            AND (
              membership.role <> 'organizer'
              OR EXISTS (
                SELECT 1
                FROM club_memberships AS club_membership
                WHERE club_membership.organization_id = NEW.organization_id
                  AND club_membership.club_id = NEW.club_id
                  AND club_membership.organization_membership_id =
                      membership.id
                  AND club_membership.profile_id = organizer.id
                  AND club_membership.status = 'active'
                  AND club_membership.deleted_at IS NULL
              )
            )
        )
      )
    THEN RAISE(ABORT, 'phase4_intent_reference_mismatch')
  END;

  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS actor_membership
      WHERE actor_membership.organization_id = NEW.organization_id
        AND actor_membership.profile_id = NEW.actor_profile_id
        AND actor_membership.status = 'active'
        AND actor_membership.deleted_at IS NULL
        AND (
          actor_membership.role IN ('owner', 'administrator')
          OR (
            actor_membership.role = 'organizer'
            AND EXISTS (
              SELECT 1
              FROM club_memberships AS actor_club
              WHERE actor_club.organization_id = NEW.organization_id
                AND actor_club.club_id = NEW.club_id
                AND actor_club.organization_membership_id =
                    actor_membership.id
                AND actor_club.profile_id = NEW.actor_profile_id
                AND actor_club.status = 'active'
                AND actor_club.deleted_at IS NULL
            )
            AND (
              (
                NOT EXISTS (
                  SELECT 1
                  FROM organizer_events AS current_event
                  WHERE current_event.id = NEW.organizer_event_id
                )
                AND EXISTS (
                  SELECT 1
                  FROM json_each(NEW.organizer_scope_json) AS actor_scope
                  WHERE actor_scope.type = 'text'
                    AND CAST(actor_scope.value AS TEXT) =
                        NEW.actor_profile_id
                )
              )
              OR EXISTS (
                SELECT 1
                FROM organizer_events AS current_event
                WHERE current_event.id = NEW.organizer_event_id
                  AND current_event.organization_id =
                      NEW.organization_id
                  AND (
                    current_event.primary_organizer_profile_id =
                        NEW.actor_profile_id
                    OR EXISTS (
                      SELECT 1
                      FROM organizer_event_organizers AS actor_association
                      WHERE actor_association.organization_id =
                            NEW.organization_id
                        AND actor_association.organizer_event_id =
                            current_event.id
                        AND actor_association.profile_id =
                            NEW.actor_profile_id
                        AND actor_association.deleted_at IS NULL
                    )
                  )
              )
            )
          )
        )
    )
    THEN RAISE(ABORT, 'phase4_intent_actor_forbidden')
  END;

  SELECT CASE
    WHEN (
      EXISTS (
        SELECT 1
        FROM organizer_events AS current_event
        WHERE current_event.id = NEW.organizer_event_id
          AND (
            current_event.organization_id <> NEW.organization_id
            OR current_event.content_version <>
               NEW.expected_content_version
            OR current_event.schedule_version <>
               NEW.expected_schedule_version
            OR (
              NEW.operation = 'phase4_backfill'
              AND (
                NEW.proposed_content_version <>
                    NEW.expected_content_version
                OR NEW.proposed_schedule_version <>
                    NEW.expected_schedule_version
              )
            )
            OR (
              NEW.operation <> 'phase4_backfill'
              AND (
                NEW.proposed_content_version <>
                    NEW.expected_content_version + 1
                OR NEW.proposed_schedule_version <>
                    NEW.expected_schedule_version + 1
              )
            )
          )
      )
    )
    OR (
      NOT EXISTS (
        SELECT 1
        FROM organizer_events AS current_event
        WHERE current_event.id = NEW.organizer_event_id
      )
      AND (
        NEW.expected_content_version <> 0
        OR NEW.expected_schedule_version <> 0
        OR NEW.proposed_content_version <> 1
        OR NEW.proposed_schedule_version <> 1
      )
    )
    THEN RAISE(ABORT, 'phase4_intent_version_mismatch')
  END;

  SELECT CASE
    WHEN NEW.operation = 'phase4_backfill'
      AND NOT EXISTS (
        SELECT 1
        FROM organizer_events AS event
        WHERE event.id = NEW.organizer_event_id
          AND event.organization_id = NEW.organization_id
          AND event.club_id = NEW.club_id
          AND event.planning_status = NEW.planning_status
          AND event.publication_status = 'private'
          AND event.schedule_shape = NEW.schedule_shape
          AND event.timezone = NEW.timezone
          AND event.all_day_start_date IS NEW.all_day_start_date
          AND event.all_day_end_date_exclusive IS
              NEW.all_day_end_date_exclusive
          AND event.buffer_before_minutes = NEW.buffer_before_minutes
          AND event.buffer_after_minutes = NEW.buffer_after_minutes
          AND event.venue_id IS NEW.venue_id
          AND event.primary_organizer_profile_id =
              NEW.primary_organizer_profile_id
          AND event.content_version = NEW.proposed_content_version
          AND event.schedule_version = NEW.proposed_schedule_version
          AND (
            (
              event.schedule_shape = 'timed'
              AND event.starts_at_utc = NEW.actual_start_utc
              AND event.ends_at_utc = NEW.actual_end_utc
            )
            OR event.schedule_shape = 'all_day'
          )
      )
    THEN RAISE(ABORT, 'phase4_intent_reference_mismatch')
  END;

  SELECT CASE
    WHEN NEW.planning_status = 'tentative_hold'
      AND NEW.operation <> 'soft_delete'
      AND NEW.hold_expires_at <=
          CAST(unixepoch('subsec') * 1000 AS INTEGER)
    THEN RAISE(ABORT, 'phase4_hold_expired')
  END;

  SELECT CASE
    WHEN NEW.operation = 'complete'
      AND NEW.actual_end_utc >
          CAST(unixepoch('subsec') * 1000 AS INTEGER)
    THEN RAISE(ABORT, 'phase4_complete_before_end')
  END;

  SELECT CASE
    WHEN NEW.planning_status IN ('tentative_hold', 'confirmed')
      AND NEW.operation <> 'soft_delete'
      AND NEW.policy_mode = 'block'
      AND ${ACTIVE_RESERVATION_CONFLICT_SQL}
    THEN RAISE(ABORT, 'phase4_conflict_blocked')
  END;

  SELECT CASE
    WHEN NEW.planning_status IN ('tentative_hold', 'confirmed')
      AND NEW.operation <> 'soft_delete'
      AND NEW.policy_mode = 'warn_reason'
      AND ${ACTIVE_RESERVATION_CONFLICT_SQL}
      AND (NEW.reason IS NULL OR length(trim(NEW.reason)) = 0)
    THEN RAISE(ABORT, 'phase4_conflict_reason_required')
  END;

  SELECT CASE
    WHEN NEW.planning_status IN ('tentative_hold', 'confirmed')
      AND NEW.operation <> 'soft_delete'
      AND NEW.policy_mode = 'require_admin_approval'
      AND ${ACTIVE_RESERVATION_CONFLICT_SQL}
      AND NOT EXISTS (
        SELECT 1
        FROM organizer_conflict_review_requests AS review
        WHERE review.id = NEW.review_request_id
          AND review.organization_id = NEW.organization_id
          AND review.organizer_event_id = NEW.organizer_event_id
          AND review.requested_planning_status = NEW.planning_status
          AND review.requested_schedule_version =
              NEW.proposed_schedule_version
          AND review.state_fingerprint = NEW.state_fingerprint
          AND review.policy_id = NEW.policy_id
          AND review.policy_version = NEW.policy_version
          AND review.state = 'approved'
      )
    THEN RAISE(ABORT, 'phase4_conflict_approval_required')
  END;
END;`;

const SCHEDULE_INTENT_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_schedule_write_intents_phase4_before_update
BEFORE UPDATE ON organizer_schedule_write_intents
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.organizer_event_id <> OLD.organizer_event_id
      OR NEW.actor_profile_id <> OLD.actor_profile_id
      OR NEW.club_id <> OLD.club_id
      OR NEW.operation <> OLD.operation
      OR NEW.planning_status <> OLD.planning_status
      OR NEW.schedule_shape <> OLD.schedule_shape
      OR NEW.actual_start_utc IS NOT OLD.actual_start_utc
      OR NEW.actual_end_utc IS NOT OLD.actual_end_utc
      OR NEW.expanded_start_utc IS NOT OLD.expanded_start_utc
      OR NEW.expanded_end_utc IS NOT OLD.expanded_end_utc
      OR NEW.timezone <> OLD.timezone
      OR NEW.all_day_start_date IS NOT OLD.all_day_start_date
      OR NEW.all_day_end_date_exclusive IS NOT
         OLD.all_day_end_date_exclusive
      OR NEW.buffer_before_minutes <> OLD.buffer_before_minutes
      OR NEW.buffer_after_minutes <> OLD.buffer_after_minutes
      OR NEW.venue_id IS NOT OLD.venue_id
      OR NEW.primary_organizer_profile_id <>
         OLD.primary_organizer_profile_id
      OR NEW.organizer_scope_json <> OLD.organizer_scope_json
      OR NEW.hold_expires_at IS NOT OLD.hold_expires_at
      OR NEW.expected_content_version <> OLD.expected_content_version
      OR NEW.expected_schedule_version <> OLD.expected_schedule_version
      OR NEW.proposed_content_version <> OLD.proposed_content_version
      OR NEW.proposed_schedule_version <> OLD.proposed_schedule_version
      OR NEW.policy_id <> OLD.policy_id
      OR NEW.policy_version <> OLD.policy_version
      OR NEW.policy_mode <> OLD.policy_mode
      OR NEW.reason IS NOT OLD.reason
      OR NEW.review_request_id IS NOT OLD.review_request_id
      OR NEW.state_fingerprint <> OLD.state_fingerprint
      OR NEW.created_at <> OLD.created_at
      OR OLD.completed_at IS NOT NULL
      OR NEW.completed_at IS NULL
    THEN RAISE(ABORT, 'phase4_intent_finalization_mismatch')
  END;

  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_events AS event
      WHERE event.id = NEW.organizer_event_id
        AND event.organization_id = NEW.organization_id
        AND event.club_id = NEW.club_id
        AND event.planning_status = NEW.planning_status
        AND event.publication_status = 'private'
        AND event.schedule_shape = NEW.schedule_shape
        AND event.timezone = NEW.timezone
        AND event.all_day_start_date IS NEW.all_day_start_date
        AND event.all_day_end_date_exclusive IS
            NEW.all_day_end_date_exclusive
        AND event.buffer_before_minutes = NEW.buffer_before_minutes
        AND event.buffer_after_minutes = NEW.buffer_after_minutes
        AND event.venue_id IS NEW.venue_id
        AND event.primary_organizer_profile_id =
            NEW.primary_organizer_profile_id
        AND event.content_version = NEW.proposed_content_version
        AND event.schedule_version = NEW.proposed_schedule_version
        AND (
          NEW.operation = 'phase4_backfill'
          OR event.updated_by_profile_id = NEW.actor_profile_id
        )
        AND EXISTS (
          SELECT 1
          FROM json_each(NEW.organizer_scope_json) AS primary_scope
          WHERE primary_scope.type = 'text'
            AND CAST(primary_scope.value AS TEXT) =
                event.primary_organizer_profile_id
        )
        AND (
          (event.schedule_shape = 'unscheduled'
           AND event.starts_at_utc IS NULL
           AND event.ends_at_utc IS NULL)
          OR event.schedule_shape = 'all_day'
          OR (
            event.schedule_shape = 'timed'
            AND event.starts_at_utc = NEW.actual_start_utc
            AND event.ends_at_utc = NEW.actual_end_utc
          )
        )
    )
    THEN RAISE(ABORT, 'phase4_intent_finalization_mismatch')
  END;

  SELECT CASE
    WHEN (
      SELECT count(*)
      FROM json_each(NEW.organizer_scope_json)
    ) <> (
      1 + (
        SELECT count(*)
        FROM organizer_event_organizers AS association
        WHERE association.organization_id = NEW.organization_id
          AND association.organizer_event_id = NEW.organizer_event_id
          AND association.deleted_at IS NULL
      )
    )
    OR EXISTS (
      SELECT 1
      FROM json_each(NEW.organizer_scope_json) AS scope
      WHERE CAST(scope.value AS TEXT) <> (
        SELECT event.primary_organizer_profile_id
        FROM organizer_events AS event
        WHERE event.id = NEW.organizer_event_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM organizer_event_organizers AS association
        WHERE association.organization_id = NEW.organization_id
          AND association.organizer_event_id = NEW.organizer_event_id
          AND association.profile_id = CAST(scope.value AS TEXT)
          AND association.deleted_at IS NULL
      )
    )
    THEN RAISE(ABORT, 'phase4_intent_finalization_mismatch')
  END;

  SELECT CASE
    WHEN (
      NEW.schedule_shape = 'unscheduled'
      OR NEW.operation = 'soft_delete'
    )
      AND EXISTS (
        SELECT 1
        FROM organizer_reservation_states AS state
        WHERE state.organizer_event_id = NEW.organizer_event_id
      )
    OR (
      NEW.schedule_shape <> 'unscheduled'
      AND NEW.operation <> 'soft_delete'
    )
      AND NOT EXISTS (
        SELECT 1
        FROM organizer_reservation_states AS state
        WHERE state.organizer_event_id = NEW.organizer_event_id
          AND state.organization_id = NEW.organization_id
          AND state.club_id = NEW.club_id
          AND state.planning_status = NEW.planning_status
          AND state.schedule_shape = NEW.schedule_shape
          AND state.actual_start_utc = NEW.actual_start_utc
          AND state.actual_end_utc = NEW.actual_end_utc
          AND state.expanded_start_utc = NEW.expanded_start_utc
          AND state.expanded_end_utc = NEW.expanded_end_utc
          AND state.timezone = NEW.timezone
          AND state.all_day_start_date IS NEW.all_day_start_date
          AND state.all_day_end_date_exclusive IS
              NEW.all_day_end_date_exclusive
          AND state.buffer_before_minutes =
              NEW.buffer_before_minutes
          AND state.buffer_after_minutes =
              NEW.buffer_after_minutes
          AND state.venue_id IS NEW.venue_id
          AND state.primary_organizer_profile_id =
              NEW.primary_organizer_profile_id
          AND state.organizer_scope_json = NEW.organizer_scope_json
          AND state.hold_expires_at IS NEW.hold_expires_at
          AND state.schedule_version = NEW.proposed_schedule_version
          AND state.policy_version = NEW.policy_version
          AND state.write_intent_id = NEW.id
          AND state.updated_by_profile_id = NEW.actor_profile_id
      )
    THEN RAISE(ABORT, 'phase4_intent_finalization_mismatch')
  END;
END;`;

const RESERVATION_STATE_BEFORE_INSERT_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_reservation_states_phase4_before_insert
BEFORE INSERT ON organizer_reservation_states
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_schedule_write_intents AS intent
      JOIN organizer_events AS event
        ON event.id = intent.organizer_event_id
       AND event.organization_id = intent.organization_id
      WHERE intent.id = NEW.write_intent_id
        AND intent.completed_at IS NULL
        AND intent.organizer_event_id = NEW.organizer_event_id
        AND intent.organization_id = NEW.organization_id
        AND intent.club_id = NEW.club_id
        AND intent.planning_status = NEW.planning_status
        AND intent.schedule_shape = NEW.schedule_shape
        AND intent.actual_start_utc = NEW.actual_start_utc
        AND intent.actual_end_utc = NEW.actual_end_utc
        AND intent.expanded_start_utc = NEW.expanded_start_utc
        AND intent.expanded_end_utc = NEW.expanded_end_utc
        AND intent.timezone = NEW.timezone
        AND intent.all_day_start_date IS NEW.all_day_start_date
        AND intent.all_day_end_date_exclusive IS
            NEW.all_day_end_date_exclusive
        AND intent.buffer_before_minutes = NEW.buffer_before_minutes
        AND intent.buffer_after_minutes = NEW.buffer_after_minutes
        AND intent.venue_id IS NEW.venue_id
        AND intent.primary_organizer_profile_id =
            NEW.primary_organizer_profile_id
        AND intent.organizer_scope_json = NEW.organizer_scope_json
        AND intent.hold_expires_at IS NEW.hold_expires_at
        AND intent.proposed_schedule_version = NEW.schedule_version
        AND intent.policy_version = NEW.policy_version
        AND intent.actor_profile_id = NEW.updated_by_profile_id
        AND event.club_id = NEW.club_id
        AND event.planning_status = NEW.planning_status
        AND event.publication_status = 'private'
        AND event.schedule_shape = NEW.schedule_shape
        AND event.schedule_version = NEW.schedule_version
        AND event.all_day_start_date IS NEW.all_day_start_date
        AND event.all_day_end_date_exclusive IS
            NEW.all_day_end_date_exclusive
        AND event.buffer_before_minutes = NEW.buffer_before_minutes
        AND event.buffer_after_minutes = NEW.buffer_after_minutes
        AND event.primary_organizer_profile_id =
            NEW.primary_organizer_profile_id
        AND NEW.expanded_start_utc =
            NEW.actual_start_utc - event.buffer_before_minutes * 60000
        AND NEW.expanded_end_utc =
            NEW.actual_end_utc + event.buffer_after_minutes * 60000
    )
    THEN RAISE(ABORT, 'phase4_reservation_state_mismatch')
  END;
  SELECT CASE
    WHEN NEW.planning_status IN ('tentative_hold', 'confirmed')
      AND (${RESERVATION_POLICY_COMMIT_GUARD_SQL})
    THEN RAISE(ABORT, 'phase4_conflict_authorization_required')
  END;
END;`;

const RESERVATION_STATE_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_reservation_states_phase4_before_update
BEFORE UPDATE ON organizer_reservation_states
BEGIN
  SELECT CASE
    WHEN NEW.organizer_event_id <> OLD.organizer_event_id
      OR NEW.organization_id <> OLD.organization_id
    THEN RAISE(ABORT, 'phase4_reservation_state_identity_immutable')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_schedule_write_intents AS intent
      JOIN organizer_events AS event
        ON event.id = intent.organizer_event_id
       AND event.organization_id = intent.organization_id
      WHERE intent.id = NEW.write_intent_id
        AND intent.completed_at IS NULL
        AND intent.organizer_event_id = NEW.organizer_event_id
        AND intent.organization_id = NEW.organization_id
        AND intent.club_id = NEW.club_id
        AND intent.planning_status = NEW.planning_status
        AND intent.schedule_shape = NEW.schedule_shape
        AND intent.actual_start_utc = NEW.actual_start_utc
        AND intent.actual_end_utc = NEW.actual_end_utc
        AND intent.expanded_start_utc = NEW.expanded_start_utc
        AND intent.expanded_end_utc = NEW.expanded_end_utc
        AND intent.timezone = NEW.timezone
        AND intent.all_day_start_date IS NEW.all_day_start_date
        AND intent.all_day_end_date_exclusive IS
            NEW.all_day_end_date_exclusive
        AND intent.buffer_before_minutes = NEW.buffer_before_minutes
        AND intent.buffer_after_minutes = NEW.buffer_after_minutes
        AND intent.venue_id IS NEW.venue_id
        AND intent.primary_organizer_profile_id =
            NEW.primary_organizer_profile_id
        AND intent.organizer_scope_json = NEW.organizer_scope_json
        AND intent.hold_expires_at IS NEW.hold_expires_at
        AND intent.proposed_schedule_version = NEW.schedule_version
        AND intent.policy_version = NEW.policy_version
        AND intent.actor_profile_id = NEW.updated_by_profile_id
        AND event.club_id = NEW.club_id
        AND event.planning_status = NEW.planning_status
        AND event.publication_status = 'private'
        AND event.schedule_shape = NEW.schedule_shape
        AND event.schedule_version = NEW.schedule_version
        AND event.all_day_start_date IS NEW.all_day_start_date
        AND event.all_day_end_date_exclusive IS
            NEW.all_day_end_date_exclusive
        AND event.buffer_before_minutes = NEW.buffer_before_minutes
        AND event.buffer_after_minutes = NEW.buffer_after_minutes
        AND event.primary_organizer_profile_id =
            NEW.primary_organizer_profile_id
        AND NEW.expanded_start_utc =
            NEW.actual_start_utc - event.buffer_before_minutes * 60000
        AND NEW.expanded_end_utc =
            NEW.actual_end_utc + event.buffer_after_minutes * 60000
    )
    THEN RAISE(ABORT, 'phase4_reservation_state_mismatch')
  END;
  SELECT CASE
    WHEN NEW.planning_status IN ('tentative_hold', 'confirmed')
      AND (${RESERVATION_POLICY_COMMIT_GUARD_SQL})
    THEN RAISE(ABORT, 'phase4_conflict_authorization_required')
  END;
END;`;

const RESERVATION_STATE_BEFORE_DELETE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_reservation_states_phase4_before_delete
BEFORE DELETE ON organizer_reservation_states
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_schedule_write_intents AS intent
      JOIN organizer_events AS event
        ON event.id = intent.organizer_event_id
       AND event.organization_id = intent.organization_id
       WHERE intent.organizer_event_id = OLD.organizer_event_id
         AND intent.organization_id = OLD.organization_id
         AND intent.proposed_schedule_version = event.schedule_version
         AND (
           intent.schedule_shape = 'unscheduled'
           OR event.deleted_at IS NOT NULL
         )
         AND intent.completed_at IS NULL
    )
    THEN RAISE(ABORT, 'phase4_reservation_state_delete_forbidden')
  END;
END;`;

const CONFLICT_POLICY_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_conflict_policies_phase4_before_update
BEFORE UPDATE ON organizer_conflict_policies
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.created_at <> OLD.created_at
       OR NEW.policy_version <> OLD.policy_version + 1
       OR NEW.updated_at <= OLD.updated_at
       OR EXISTS (
         SELECT 1
         FROM organizer_conflict_review_requests AS review
         WHERE review.organization_id = OLD.organization_id
           AND review.policy_id = OLD.id
           AND review.policy_version = OLD.policy_version
           AND review.state IN ('pending', 'approved')
       )
       OR EXISTS (
         SELECT 1
         FROM organizer_conflict_overrides AS override
         WHERE override.organization_id = OLD.organization_id
           AND override.policy_id = OLD.id
           AND override.policy_version = OLD.policy_version
           AND override.invalidated_at IS NULL
       )
       OR EXISTS (
         SELECT 1
         FROM organizer_conflict_incidents AS incident
         WHERE incident.organization_id = OLD.organization_id
           AND incident.policy_id = OLD.id
           AND incident.policy_version = OLD.policy_version
           AND incident.state IN (
             'open', 'pending_approval', 'approved', 'informational'
           )
       )
       OR NOT EXISTS (
        SELECT 1
        FROM profiles AS actor_profile
        JOIN organization_memberships AS actor_membership
          ON actor_membership.profile_id = actor_profile.id
         AND actor_membership.organization_id = NEW.organization_id
         AND actor_membership.role IN ('owner', 'administrator')
         AND actor_membership.status = 'active'
         AND actor_membership.deleted_at IS NULL
        WHERE actor_profile.id = NEW.updated_by_profile_id
          AND actor_profile.status = 'active'
          AND actor_profile.deleted_at IS NULL
      )
    THEN RAISE(ABORT, 'phase4_policy_update_forbidden')
  END;
END;`;

const CONFLICT_POLICY_BEFORE_INSERT_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_conflict_policies_phase4_before_insert
BEFORE INSERT ON organizer_conflict_policies
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM profiles AS actor_profile
      JOIN organization_memberships AS actor_membership
        ON actor_membership.profile_id = actor_profile.id
       AND actor_membership.organization_id = NEW.organization_id
       AND actor_membership.role IN ('owner', 'administrator')
       AND actor_membership.status = 'active'
       AND actor_membership.deleted_at IS NULL
      WHERE actor_profile.id = NEW.updated_by_profile_id
        AND actor_profile.status = 'active'
        AND actor_profile.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'phase4_policy_update_forbidden')
  END;
END;`;

const CONFLICT_REVIEW_BEFORE_INSERT_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_conflict_reviews_phase4_before_insert
BEFORE INSERT ON organizer_conflict_review_requests
BEGIN
  SELECT CASE
    WHEN NEW.state <> 'pending'
      OR NEW.decided_by_profile_id IS NOT NULL
      OR NEW.decided_at IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM organizer_events AS event
        JOIN organizer_conflict_policies AS policy
          ON policy.id = NEW.policy_id
         AND policy.organization_id = event.organization_id
         AND policy.policy_version = NEW.policy_version
        JOIN profiles AS requester_profile
          ON requester_profile.id = NEW.requester_profile_id
         AND requester_profile.status = 'active'
         AND requester_profile.deleted_at IS NULL
        JOIN organization_memberships AS requester_membership
          ON requester_membership.profile_id = requester_profile.id
         AND requester_membership.organization_id = event.organization_id
         AND requester_membership.status = 'active'
         AND requester_membership.deleted_at IS NULL
        WHERE event.id = NEW.organizer_event_id
          AND event.organization_id = NEW.organization_id
          AND event.schedule_version + 1 =
              NEW.requested_schedule_version
          AND event.publication_status = 'private'
          AND (
            requester_membership.role IN ('owner', 'administrator')
            OR event.primary_organizer_profile_id =
               NEW.requester_profile_id
            OR EXISTS (
              SELECT 1
              FROM organizer_event_organizers AS association
              WHERE association.organization_id = event.organization_id
                AND association.organizer_event_id = event.id
                AND association.profile_id =
                    NEW.requester_profile_id
                AND association.deleted_at IS NULL
            )
          )
      )
    THEN RAISE(ABORT, 'phase4_review_forbidden')
  END;
END;`;

const CONFLICT_REVIEW_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_conflict_reviews_phase4_before_update
BEFORE UPDATE ON organizer_conflict_review_requests
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.organizer_event_id <> OLD.organizer_event_id
      OR NEW.requested_planning_status <> OLD.requested_planning_status
      OR NEW.requested_schedule_version <> OLD.requested_schedule_version
      OR NEW.state_fingerprint <> OLD.state_fingerprint
      OR NEW.requested_state_json <> OLD.requested_state_json
      OR NEW.policy_id <> OLD.policy_id
      OR NEW.policy_version <> OLD.policy_version
      OR NEW.requester_profile_id <> OLD.requester_profile_id
       OR NEW.reason <> OLD.reason
       OR NEW.created_at <> OLD.created_at
       OR NOT (
         (
           OLD.state = 'pending'
           AND NEW.state IN ('approved', 'rejected', 'invalidated')
         )
         OR (
           OLD.state = 'approved'
           AND NEW.state = 'invalidated'
         )
       )
    THEN RAISE(ABORT, 'phase4_review_stale')
  END;

  SELECT CASE
    WHEN NEW.state IN ('approved', 'rejected')
      AND (
        NEW.decided_by_profile_id IS NULL
        OR NEW.decided_at IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM profiles AS decider_profile
          JOIN organization_memberships AS decider_membership
            ON decider_membership.profile_id = decider_profile.id
           AND decider_membership.organization_id =
               NEW.organization_id
           AND decider_membership.role IN ('owner', 'administrator')
           AND decider_membership.status = 'active'
           AND decider_membership.deleted_at IS NULL
          WHERE decider_profile.id = NEW.decided_by_profile_id
            AND decider_profile.status = 'active'
            AND decider_profile.deleted_at IS NULL
             AND (
               NEW.state = 'rejected'
               OR
               decider_membership.role = 'owner'
               OR NEW.decided_by_profile_id <>
                  NEW.requester_profile_id
            )
        )
        OR NOT EXISTS (
          SELECT 1
          FROM organizer_events AS event
          JOIN organizer_conflict_policies AS policy
            ON policy.id = NEW.policy_id
           AND policy.organization_id = event.organization_id
           AND policy.policy_version = NEW.policy_version
          WHERE event.id = NEW.organizer_event_id
            AND event.organization_id = NEW.organization_id
             AND event.schedule_version + 1 =
                 NEW.requested_schedule_version
            AND event.publication_status = 'private'
        )
      )
    THEN RAISE(ABORT, 'phase4_review_forbidden')
  END;
END;`;

const CONFLICT_OVERRIDE_BEFORE_INSERT_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_conflict_overrides_phase4_before_insert
BEFORE INSERT ON organizer_conflict_overrides
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_conflict_incidents AS incident
      JOIN organizer_schedule_write_intents AS intent
        ON intent.id = incident.write_intent_id
       AND intent.organization_id = incident.organization_id
       AND intent.organizer_event_id = incident.organizer_event_id
       AND intent.completed_at IS NULL
      JOIN organizer_events AS event
        ON event.id = incident.organizer_event_id
       AND event.organization_id = incident.organization_id
      JOIN organizer_conflict_policies AS policy
        ON policy.id = incident.policy_id
       AND policy.organization_id = incident.organization_id
      JOIN profiles AS actor_profile
        ON actor_profile.id = NEW.actor_profile_id
       AND actor_profile.status = 'active'
       AND actor_profile.deleted_at IS NULL
      JOIN organization_memberships AS actor_membership
        ON actor_membership.profile_id = actor_profile.id
       AND actor_membership.organization_id = incident.organization_id
       AND actor_membership.status = 'active'
       AND actor_membership.deleted_at IS NULL
      WHERE incident.id = NEW.incident_id
        AND incident.organization_id = NEW.organization_id
        AND incident.organizer_event_id = NEW.organizer_event_id
        AND incident.conflicting_candidate_key =
            NEW.conflicting_candidate_key
        AND incident.proposed_schedule_version =
            NEW.proposed_schedule_version
        AND incident.conflicting_schedule_version =
            NEW.conflicting_schedule_version
        AND incident.policy_id = NEW.policy_id
        AND incident.policy_version = NEW.policy_version
        AND incident.state_fingerprint = NEW.state_fingerprint
        AND incident.state = 'open'
        AND incident.resolved_at IS NULL
        AND incident.proposed_schedule_version =
            intent.proposed_schedule_version
        AND event.content_version = intent.expected_content_version
        AND event.schedule_version = intent.expected_schedule_version
        AND NEW.proposed_schedule_version =
            intent.proposed_schedule_version
        AND NEW.actor_profile_id = intent.actor_profile_id
        AND NEW.policy_id = intent.policy_id
        AND NEW.policy_version = intent.policy_version
        AND NEW.state_fingerprint = intent.state_fingerprint
        AND policy.policy_version = NEW.policy_version
        AND (
          actor_membership.role IN ('owner', 'administrator')
          OR event.primary_organizer_profile_id =
             NEW.actor_profile_id
          OR EXISTS (
            SELECT 1
            FROM organizer_event_organizers AS association
            WHERE association.organization_id = event.organization_id
              AND association.organizer_event_id = event.id
              AND association.profile_id = NEW.actor_profile_id
              AND association.deleted_at IS NULL
          )
        )
        AND (
          policy.mode = 'warn_reason'
          OR (
            policy.mode = 'require_admin_approval'
            AND EXISTS (
              SELECT 1
              FROM organizer_conflict_review_requests AS review
              WHERE review.id = NEW.review_request_id
                AND review.organization_id = NEW.organization_id
                AND review.organizer_event_id =
                    NEW.organizer_event_id
                AND review.requested_schedule_version =
                    NEW.proposed_schedule_version
                AND review.state_fingerprint =
                    NEW.state_fingerprint
                AND review.policy_id = NEW.policy_id
                AND review.policy_version = NEW.policy_version
                AND review.state = 'approved'
            )
          )
        )
    )
    THEN RAISE(ABORT, 'phase4_override_mismatch')
  END;
END;`;

const CONFLICT_OVERRIDE_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_conflict_overrides_phase4_before_update
BEFORE UPDATE ON organizer_conflict_overrides
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.incident_id <> OLD.incident_id
      OR NEW.organizer_event_id <> OLD.organizer_event_id
      OR NEW.conflicting_candidate_key <>
         OLD.conflicting_candidate_key
      OR NEW.proposed_schedule_version <>
         OLD.proposed_schedule_version
      OR NEW.conflicting_schedule_version <>
         OLD.conflicting_schedule_version
      OR NEW.policy_id <> OLD.policy_id
      OR NEW.policy_version <> OLD.policy_version
      OR NEW.state_fingerprint <> OLD.state_fingerprint
      OR NEW.reason <> OLD.reason
      OR NEW.actor_profile_id <> OLD.actor_profile_id
      OR NEW.review_request_id IS NOT OLD.review_request_id
      OR NEW.created_at <> OLD.created_at
      OR OLD.invalidated_at IS NOT NULL
      OR NEW.invalidated_at IS NULL
      OR NEW.invalidated_by_profile_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM profiles AS invalidator_profile
        JOIN organization_memberships AS invalidator_membership
          ON invalidator_membership.profile_id =
             invalidator_profile.id
         AND invalidator_membership.organization_id =
             NEW.organization_id
         AND invalidator_membership.status = 'active'
         AND invalidator_membership.deleted_at IS NULL
        WHERE invalidator_profile.id =
              NEW.invalidated_by_profile_id
          AND invalidator_profile.status = 'active'
          AND invalidator_profile.deleted_at IS NULL
      )
    THEN RAISE(ABORT, 'phase4_override_mismatch')
  END;
END;`;

const EXTERNAL_RESERVATION_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_external_reservations_phase4_before_update
BEFORE UPDATE ON organizer_external_reservation_intervals
WHEN (
 (
  OLD.source_kind = 'legacy'
  AND EXISTS (
    SELECT 1
    FROM events AS event
    WHERE event.id = OLD.source_record_id
      AND event.organization_id = OLD.organization_id
      AND event.deleted_at IS NULL
      AND event.status IN ('hold', 'tentative', 'confirmed')
      AND (
        event.status <> 'hold'
        OR event.hold_expires_at >
           CAST(unixepoch('subsec') * 1000 AS INTEGER)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM external_source_links AS source_link
        WHERE source_link.organization_id = event.organization_id
          AND source_link.entity_type = 'event'
          AND source_link.entity_id = event.id
          AND source_link.source_type = 'meetup_ics'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM organizer_events AS adopted
        WHERE adopted.id = event.id
          AND adopted.organization_id = event.organization_id
      )
  )
 )
 OR (
  OLD.source_kind = 'meetup'
  AND EXISTS (
    SELECT 1
    FROM sync_sources AS source
    JOIN meetup_sync_generations AS generation
      ON generation.id = source.active_generation_id
     AND generation.sync_source_id = source.id
     AND generation.state = 'published'
    WHERE source.id = OLD.sync_source_id
      AND source.organization_id = OLD.organization_id
      AND source.active_generation_id = OLD.generation_id
      AND source.enabled = 1
      AND source.deleted_at IS NULL
  )
 )
)
AND EXISTS (
  SELECT 1
  FROM database_invariant_state AS marker
  WHERE marker.singleton_key = 'database-guards'
    AND marker.version = 4
)
BEGIN
  SELECT RAISE(ABORT, 'phase4_external_reservation_active');
END;`;

const EXTERNAL_RESERVATION_BEFORE_INSERT_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_external_reservations_phase4_before_insert
BEFORE INSERT ON organizer_external_reservation_intervals
BEGIN
  SELECT CASE
    WHEN (
      NEW.source_kind = 'legacy'
      AND NOT EXISTS (
        SELECT 1
        FROM events AS event
        WHERE event.id = NEW.source_record_id
          AND event.id = NEW.event_id
          AND event.organization_id = NEW.organization_id
          AND event.club_id = NEW.club_id
          AND event.status = NEW.planning_status
          AND event.time_kind = NEW.schedule_shape
          AND event.timezone = NEW.timezone
          AND event.all_day_start_date IS NEW.all_day_start_date
          AND event.all_day_end_date_exclusive IS
              NEW.all_day_end_date_exclusive
          AND event.buffer_before_minutes =
              NEW.buffer_before_minutes
          AND event.buffer_after_minutes =
              NEW.buffer_after_minutes
          AND event.venue_id IS NEW.venue_id
          AND event.primary_organizer_profile_id IS
              NEW.primary_organizer_profile_id
          AND event.organizer_scope_json = NEW.organizer_scope_json
          AND event.schedule_version = NEW.schedule_version
          AND event.hold_expires_at IS NEW.hold_expires_at
           AND event.title = NEW.title
           AND length(NEW.source_fingerprint) = 64
           AND length(NEW.normalized_state_fingerprint) = 64
           AND length(NEW.reservation_semantic_fingerprint) = 64
          AND event.deleted_at IS NULL
          AND event.status IN ('hold', 'tentative', 'confirmed')
          AND (
            event.time_kind = 'all_day'
            OR (
              event.starts_at_utc = NEW.actual_start_utc
              AND event.ends_at_utc = NEW.actual_end_utc
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM external_source_links AS source_link
            WHERE source_link.organization_id = event.organization_id
              AND source_link.entity_type = 'event'
              AND source_link.entity_id = event.id
              AND source_link.source_type = 'meetup_ics'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM organizer_events AS adopted
            WHERE adopted.id = event.id
              AND adopted.organization_id = event.organization_id
          )
      )
    )
    OR (
      NEW.source_kind = 'meetup'
      AND NOT EXISTS (
        SELECT 1
        FROM meetup_event_snapshots AS snapshot
        JOIN sync_sources AS source
          ON source.id = snapshot.sync_source_id
         AND source.organization_id = snapshot.organization_id
         AND source.club_id = NEW.club_id
         AND source.deleted_at IS NULL
        JOIN meetup_sync_generations AS generation
          ON generation.id = snapshot.generation_id
         AND generation.organization_id = snapshot.organization_id
         AND generation.sync_source_id = snapshot.sync_source_id
         AND (
           (
             source.pending_generation_id = snapshot.generation_id
             AND generation.state = 'staging'
           )
           OR (
             source.active_generation_id = snapshot.generation_id
             AND generation.state = 'published'
           )
         )
         JOIN events AS event
           ON event.id = snapshot.event_id
          AND event.organization_id = snapshot.organization_id
         JOIN meetup_snapshot_reservation_normalizations AS normalization
           ON normalization.organization_id = snapshot.organization_id
          AND normalization.sync_source_id = snapshot.sync_source_id
          AND normalization.generation_id = snapshot.generation_id
          AND normalization.snapshot_id = snapshot.id
          AND normalization.event_id = snapshot.event_id
         WHERE snapshot.id = NEW.source_record_id
          AND snapshot.organization_id = NEW.organization_id
          AND snapshot.sync_source_id = NEW.sync_source_id
          AND snapshot.generation_id = NEW.generation_id
          AND snapshot.event_id = NEW.event_id
          AND snapshot.status = NEW.planning_status
          AND snapshot.status IN ('confirmed', 'tentative')
          AND snapshot.time_kind = NEW.schedule_shape
          AND snapshot.timezone = NEW.timezone
          AND snapshot.all_day_start_date IS NEW.all_day_start_date
          AND snapshot.all_day_end_date_exclusive IS
              NEW.all_day_end_date_exclusive
          AND NEW.buffer_before_minutes = 0
          AND NEW.buffer_after_minutes = 0
          AND event.venue_id IS NEW.venue_id
          AND event.primary_organizer_profile_id IS
              NEW.primary_organizer_profile_id
          AND event.organizer_scope_json = NEW.organizer_scope_json
          AND event.schedule_version = NEW.schedule_version
          AND snapshot.title = NEW.title
           AND snapshot.source_fingerprint = NEW.source_fingerprint
           AND normalization.club_id = NEW.club_id
           AND normalization.planning_status = NEW.planning_status
           AND normalization.schedule_shape = NEW.schedule_shape
           AND normalization.actual_start_utc = NEW.actual_start_utc
           AND normalization.actual_end_utc = NEW.actual_end_utc
           AND normalization.expanded_start_utc = NEW.expanded_start_utc
           AND normalization.expanded_end_utc = NEW.expanded_end_utc
           AND normalization.timezone = NEW.timezone
           AND normalization.all_day_start_date IS
               NEW.all_day_start_date
           AND normalization.all_day_end_date_exclusive IS
               NEW.all_day_end_date_exclusive
           AND normalization.buffer_before_minutes =
               NEW.buffer_before_minutes
           AND normalization.buffer_after_minutes =
               NEW.buffer_after_minutes
           AND normalization.venue_id IS NEW.venue_id
           AND normalization.primary_organizer_profile_id IS
               NEW.primary_organizer_profile_id
           AND normalization.organizer_scope_json =
               NEW.organizer_scope_json
           AND normalization.schedule_version = NEW.schedule_version
           AND normalization.hold_expires_at IS NEW.hold_expires_at
           AND normalization.source_fingerprint = NEW.source_fingerprint
           AND normalization.normalized_state_fingerprint =
               NEW.normalized_state_fingerprint
           AND normalization.reservation_semantic_fingerprint =
               NEW.reservation_semantic_fingerprint
          AND (
            snapshot.time_kind = 'all_day'
            OR (
              snapshot.starts_at_utc = NEW.actual_start_utc
              AND snapshot.ends_at_utc = NEW.actual_end_utc
            )
          )
      )
    )
    THEN RAISE(ABORT, 'phase4_external_reservation_mismatch')
  END;
END;`;

const EXTERNAL_RESERVATION_BEFORE_DELETE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_external_reservations_phase4_before_delete
BEFORE DELETE ON organizer_external_reservation_intervals
WHEN (
  OLD.source_kind = 'legacy'
  AND EXISTS (
    SELECT 1
    FROM events AS event
    WHERE event.id = OLD.source_record_id
      AND event.organization_id = OLD.organization_id
      AND event.deleted_at IS NULL
      AND event.status IN ('hold', 'tentative', 'confirmed')
      AND (
        event.status <> 'hold'
        OR event.hold_expires_at >
           CAST(unixepoch('subsec') * 1000 AS INTEGER)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM external_source_links AS source_link
        WHERE source_link.organization_id = event.organization_id
          AND source_link.entity_type = 'event'
          AND source_link.entity_id = event.id
          AND source_link.source_type = 'meetup_ics'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM organizer_events AS adopted
        WHERE adopted.id = event.id
          AND adopted.organization_id = event.organization_id
      )
  )
)
OR (
  OLD.source_kind = 'meetup'
  AND EXISTS (
    SELECT 1
    FROM sync_sources AS source
    JOIN meetup_sync_generations AS generation
      ON generation.id = source.active_generation_id
     AND generation.sync_source_id = source.id
     AND generation.state = 'published'
    WHERE source.id = OLD.sync_source_id
      AND source.organization_id = OLD.organization_id
      AND source.active_generation_id = OLD.generation_id
      AND source.enabled = 1
      AND source.deleted_at IS NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'phase4_external_reservation_active');
END;`;

const SOURCE_ACTIVATION_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS sync_sources_phase4_activation_before_update
BEFORE UPDATE OF active_generation_id, enabled, deleted_at ON sync_sources
WHEN NEW.active_generation_id IS NOT NULL
 AND NEW.enabled = 1
 AND NEW.deleted_at IS NULL
 AND (
   NEW.active_generation_id IS NOT OLD.active_generation_id
   OR (OLD.enabled = 0 AND NEW.enabled = 1)
   OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
 )
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM profiles AS actor_profile
      JOIN organization_memberships AS actor_membership
        ON actor_membership.profile_id = actor_profile.id
       AND actor_membership.organization_id = NEW.organization_id
       AND actor_membership.role IN ('owner', 'administrator')
       AND actor_membership.status = 'active'
       AND actor_membership.deleted_at IS NULL
      WHERE actor_profile.id = NEW.updated_by_profile_id
        AND actor_profile.status = 'active'
        AND actor_profile.deleted_at IS NULL
    )
    OR NOT EXISTS (
      SELECT 1
      FROM meetup_sync_generations AS generation
      WHERE generation.id = NEW.active_generation_id
        AND generation.organization_id = NEW.organization_id
        AND generation.sync_source_id = NEW.id
        AND generation.state IN ('staging', 'published')
        AND generation.processed_item_count =
            generation.expected_item_count
    )
    THEN RAISE(ABORT, 'phase4_source_activation_mismatch')
  END;

  UPDATE organizer_conflict_overrides
  SET invalidated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
      invalidated_by_profile_id = NEW.updated_by_profile_id
  WHERE organization_id = NEW.organization_id
    AND invalidated_at IS NULL
    AND incident_id IN (
      SELECT incident.id
      FROM organizer_conflict_incidents AS incident
      JOIN organizer_external_reservation_intervals AS prior
        ON incident.conflicting_candidate_key = 'meetup:' || prior.id
       AND prior.source_kind = 'meetup'
       AND prior.organization_id = incident.organization_id
       AND prior.sync_source_id = NEW.id
       AND prior.generation_id = OLD.active_generation_id
       AND NOT EXISTS (
         SELECT 1
         FROM organizer_external_reservation_intervals AS proposed
         WHERE proposed.source_kind = 'meetup'
           AND proposed.organization_id = prior.organization_id
           AND proposed.sync_source_id = NEW.id
           AND proposed.generation_id = NEW.active_generation_id
           AND proposed.event_id = prior.event_id
           AND proposed.reservation_semantic_fingerprint =
               prior.reservation_semantic_fingerprint
       )
      WHERE incident.organization_id = NEW.organization_id
    );

  UPDATE organizer_conflict_review_requests
  SET state = 'invalidated',
      updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
  WHERE organization_id = NEW.organization_id
    AND state IN ('pending', 'approved')
    AND id IN (
      SELECT incident.review_request_id
      FROM organizer_conflict_incidents AS incident
      JOIN organizer_external_reservation_intervals AS prior
        ON incident.conflicting_candidate_key = 'meetup:' || prior.id
       AND prior.source_kind = 'meetup'
       AND prior.organization_id = incident.organization_id
       AND prior.sync_source_id = NEW.id
       AND prior.generation_id = OLD.active_generation_id
       AND NOT EXISTS (
         SELECT 1
         FROM organizer_external_reservation_intervals AS proposed
         WHERE proposed.source_kind = 'meetup'
           AND proposed.organization_id = prior.organization_id
           AND proposed.sync_source_id = NEW.id
           AND proposed.generation_id = NEW.active_generation_id
           AND proposed.event_id = prior.event_id
           AND proposed.reservation_semantic_fingerprint =
               prior.reservation_semantic_fingerprint
       )
      WHERE incident.organization_id = NEW.organization_id
        AND incident.review_request_id IS NOT NULL
    );

  UPDATE organizer_conflict_incidents
  SET state = 'invalidated',
      updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
      resolved_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
  WHERE organization_id = NEW.organization_id
    AND state IN (
      'open', 'pending_approval', 'approved', 'informational'
    )
    AND conflicting_candidate_key IN (
      SELECT 'meetup:' || prior.id
      FROM organizer_external_reservation_intervals AS prior
      WHERE prior.source_kind = 'meetup'
        AND prior.organization_id = NEW.organization_id
        AND prior.sync_source_id = NEW.id
        AND prior.generation_id = OLD.active_generation_id
        AND NOT EXISTS (
          SELECT 1
          FROM organizer_external_reservation_intervals AS proposed
          WHERE proposed.source_kind = 'meetup'
            AND proposed.organization_id = prior.organization_id
            AND proposed.sync_source_id = NEW.id
            AND proposed.generation_id = NEW.active_generation_id
            AND proposed.event_id = prior.event_id
            AND proposed.reservation_semantic_fingerprint =
                prior.reservation_semantic_fingerprint
        )
    );

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM meetup_event_snapshots AS snapshot
      WHERE snapshot.organization_id = NEW.organization_id
        AND snapshot.sync_source_id = NEW.id
        AND snapshot.generation_id = NEW.active_generation_id
        AND snapshot.status IN ('confirmed', 'tentative')
        AND NOT EXISTS (
          SELECT 1
           FROM organizer_external_reservation_intervals AS interval
           JOIN events AS event
             ON event.id = snapshot.event_id
            AND event.organization_id = snapshot.organization_id
           JOIN meetup_snapshot_reservation_normalizations AS normalization
             ON normalization.organization_id =
                snapshot.organization_id
            AND normalization.sync_source_id = snapshot.sync_source_id
            AND normalization.generation_id = snapshot.generation_id
            AND normalization.snapshot_id = snapshot.id
            AND normalization.event_id = snapshot.event_id
           WHERE interval.source_kind = 'meetup'
            AND interval.source_record_id = snapshot.id
            AND interval.organization_id = snapshot.organization_id
            AND interval.sync_source_id = snapshot.sync_source_id
            AND interval.generation_id = snapshot.generation_id
            AND interval.event_id = snapshot.event_id
            AND interval.club_id = NEW.club_id
            AND interval.planning_status = snapshot.status
            AND interval.schedule_shape = snapshot.time_kind
            AND interval.timezone = snapshot.timezone
            AND interval.all_day_start_date IS
                snapshot.all_day_start_date
            AND interval.all_day_end_date_exclusive IS
                snapshot.all_day_end_date_exclusive
            AND interval.buffer_before_minutes = 0
            AND interval.buffer_after_minutes = 0
            AND interval.venue_id IS event.venue_id
            AND interval.primary_organizer_profile_id IS
                event.primary_organizer_profile_id
            AND interval.organizer_scope_json =
                event.organizer_scope_json
            AND interval.schedule_version = event.schedule_version
            AND interval.title = snapshot.title
             AND interval.source_fingerprint =
                 snapshot.source_fingerprint
             AND normalization.club_id = interval.club_id
             AND normalization.planning_status =
                 interval.planning_status
             AND normalization.schedule_shape = interval.schedule_shape
             AND normalization.actual_start_utc =
                 interval.actual_start_utc
             AND normalization.actual_end_utc =
                 interval.actual_end_utc
             AND normalization.expanded_start_utc =
                 interval.expanded_start_utc
             AND normalization.expanded_end_utc =
                 interval.expanded_end_utc
             AND normalization.timezone = interval.timezone
             AND normalization.all_day_start_date IS
                 interval.all_day_start_date
             AND normalization.all_day_end_date_exclusive IS
                 interval.all_day_end_date_exclusive
             AND normalization.buffer_before_minutes =
                 interval.buffer_before_minutes
             AND normalization.buffer_after_minutes =
                 interval.buffer_after_minutes
             AND normalization.venue_id IS interval.venue_id
             AND normalization.primary_organizer_profile_id IS
                 interval.primary_organizer_profile_id
             AND normalization.organizer_scope_json =
                 interval.organizer_scope_json
             AND normalization.schedule_version =
                 interval.schedule_version
             AND normalization.hold_expires_at IS
                 interval.hold_expires_at
             AND normalization.source_fingerprint =
                 interval.source_fingerprint
             AND normalization.normalized_state_fingerprint =
                 interval.normalized_state_fingerprint
             AND normalization.reservation_semantic_fingerprint =
                 interval.reservation_semantic_fingerprint
            AND (
              snapshot.time_kind = 'all_day'
              OR (
                interval.actual_start_utc = snapshot.starts_at_utc
                AND interval.actual_end_utc = snapshot.ends_at_utc
              )
            )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM organizer_external_reservation_intervals AS interval
      WHERE interval.source_kind = 'meetup'
        AND interval.organization_id = NEW.organization_id
        AND interval.sync_source_id = NEW.id
        AND interval.generation_id = NEW.active_generation_id
        AND NOT EXISTS (
          SELECT 1
          FROM meetup_event_snapshots AS snapshot
          WHERE snapshot.id = interval.source_record_id
            AND snapshot.organization_id = interval.organization_id
            AND snapshot.sync_source_id = interval.sync_source_id
            AND snapshot.generation_id = interval.generation_id
            AND snapshot.event_id = interval.event_id
            AND snapshot.status IN ('confirmed', 'tentative')
            AND snapshot.status = interval.planning_status
        )
    )
    THEN RAISE(ABORT, 'phase4_source_activation_mismatch')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM organizer_external_reservation_intervals AS proposed
      JOIN organizer_reservation_states AS reserved
        ON reserved.organization_id = proposed.organization_id
       AND reserved.expanded_start_utc < proposed.expanded_end_utc
       AND proposed.expanded_start_utc < reserved.expanded_end_utc
      JOIN organizer_events AS reserved_event
        ON reserved_event.id = reserved.organizer_event_id
       AND reserved_event.organization_id = reserved.organization_id
       AND reserved_event.deleted_at IS NULL
      WHERE proposed.source_kind = 'meetup'
        AND proposed.organization_id = NEW.organization_id
        AND proposed.sync_source_id = NEW.id
        AND proposed.generation_id = NEW.active_generation_id
        AND proposed.planning_status IN (
          'tentative', 'tentative_hold', 'confirmed'
        )
        AND reserved.planning_status IN (
          'tentative_hold', 'confirmed'
        )
        AND (
          reserved.planning_status <> 'tentative_hold'
          OR reserved.hold_expires_at >
             CAST(unixepoch('subsec') * 1000 AS INTEGER)
        )
        AND reserved.organizer_event_id <> proposed.event_id
        AND NOT EXISTS (
          SELECT 1
          FROM organizer_external_reservation_intervals AS prior
         WHERE prior.source_kind = 'meetup'
           AND OLD.enabled = 1
           AND OLD.deleted_at IS NULL
           AND prior.organization_id = proposed.organization_id
             AND prior.sync_source_id = NEW.id
             AND prior.generation_id = OLD.active_generation_id
             AND prior.event_id = proposed.event_id
             AND prior.reservation_semantic_fingerprint =
                 proposed.reservation_semantic_fingerprint
        )
    )
    OR EXISTS (
      SELECT 1
      FROM organizer_external_reservation_intervals AS proposed
      JOIN organizer_external_reservation_intervals AS reserved
        ON reserved.organization_id = proposed.organization_id
       AND reserved.id <> proposed.id
       AND reserved.event_id <> proposed.event_id
       AND reserved.expanded_start_utc < proposed.expanded_end_utc
       AND proposed.expanded_start_utc < reserved.expanded_end_utc
      WHERE proposed.source_kind = 'meetup'
        AND proposed.organization_id = NEW.organization_id
        AND proposed.sync_source_id = NEW.id
        AND proposed.generation_id = NEW.active_generation_id
        AND proposed.planning_status IN (
          'tentative', 'tentative_hold', 'confirmed'
        )
        AND reserved.planning_status IN (
          'hold', 'tentative', 'tentative_hold', 'confirmed'
        )
        AND (
          (
            reserved.source_kind = 'meetup'
            AND reserved.sync_source_id = NEW.id
            AND reserved.generation_id = NEW.active_generation_id
          )
          OR reserved.source_kind = 'legacy'
          OR (
            reserved.source_kind = 'meetup'
            AND EXISTS (
              SELECT 1
              FROM sync_sources AS other_source
              JOIN meetup_sync_generations AS other_generation
                ON other_generation.id =
                   other_source.active_generation_id
               AND other_generation.sync_source_id = other_source.id
               AND other_generation.state = 'published'
              WHERE other_source.id = reserved.sync_source_id
                AND other_source.organization_id =
                    reserved.organization_id
                AND other_source.active_generation_id =
                    reserved.generation_id
                AND other_source.id <> NEW.id
                AND other_source.enabled = 1
                AND other_source.deleted_at IS NULL
            )
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM organizer_external_reservation_intervals AS prior
          WHERE prior.source_kind = 'meetup'
            AND OLD.enabled = 1
            AND OLD.deleted_at IS NULL
            AND prior.organization_id = proposed.organization_id
             AND prior.sync_source_id = NEW.id
             AND prior.generation_id = OLD.active_generation_id
             AND prior.event_id = proposed.event_id
             AND prior.reservation_semantic_fingerprint =
                 proposed.reservation_semantic_fingerprint
        )
    )
    THEN RAISE(ABORT, 'phase4_source_activation_conflict')
  END;
END;`;

const SOURCE_DEACTIVATION_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS sync_sources_phase4_deactivation_before_update
BEFORE UPDATE OF active_generation_id, enabled, deleted_at ON sync_sources
WHEN OLD.active_generation_id IS NOT NULL
 AND (
   NEW.active_generation_id IS NULL
   OR (OLD.enabled = 1 AND NEW.enabled = 0)
   OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
 )
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM profiles AS actor_profile
      JOIN organization_memberships AS actor_membership
        ON actor_membership.profile_id = actor_profile.id
       AND actor_membership.organization_id = NEW.organization_id
       AND actor_membership.role IN ('owner', 'administrator')
       AND actor_membership.status = 'active'
       AND actor_membership.deleted_at IS NULL
      WHERE actor_profile.id = NEW.updated_by_profile_id
        AND actor_profile.status = 'active'
        AND actor_profile.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'phase4_source_activation_mismatch')
  END;

  UPDATE organizer_conflict_overrides
  SET invalidated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
      invalidated_by_profile_id = NEW.updated_by_profile_id
  WHERE organization_id = NEW.organization_id
    AND invalidated_at IS NULL
    AND incident_id IN (
      SELECT incident.id
      FROM organizer_conflict_incidents AS incident
      JOIN organizer_external_reservation_intervals AS prior
        ON incident.conflicting_candidate_key = 'meetup:' || prior.id
       AND prior.source_kind = 'meetup'
       AND prior.organization_id = incident.organization_id
       AND prior.sync_source_id = NEW.id
       AND prior.generation_id = OLD.active_generation_id
      WHERE incident.organization_id = NEW.organization_id
    );

  UPDATE organizer_conflict_review_requests
  SET state = 'invalidated',
      updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
  WHERE organization_id = NEW.organization_id
    AND state IN ('pending', 'approved')
    AND id IN (
      SELECT incident.review_request_id
      FROM organizer_conflict_incidents AS incident
      JOIN organizer_external_reservation_intervals AS prior
        ON incident.conflicting_candidate_key = 'meetup:' || prior.id
       AND prior.source_kind = 'meetup'
       AND prior.organization_id = incident.organization_id
       AND prior.sync_source_id = NEW.id
       AND prior.generation_id = OLD.active_generation_id
      WHERE incident.organization_id = NEW.organization_id
        AND incident.review_request_id IS NOT NULL
    );

  UPDATE organizer_conflict_incidents
  SET state = 'invalidated',
      updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
      resolved_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
  WHERE organization_id = NEW.organization_id
    AND state IN (
      'open', 'pending_approval', 'approved', 'informational'
    )
    AND conflicting_candidate_key IN (
      SELECT 'meetup:' || prior.id
      FROM organizer_external_reservation_intervals AS prior
      WHERE prior.source_kind = 'meetup'
        AND prior.organization_id = NEW.organization_id
        AND prior.sync_source_id = NEW.id
        AND prior.generation_id = OLD.active_generation_id
    );
END;`;

const SOURCE_IDENTITY_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS sync_sources_phase4_identity_before_update
BEFORE UPDATE OF organization_id, club_id ON sync_sources
WHEN OLD.active_generation_id IS NOT NULL
 AND (
   NEW.organization_id <> OLD.organization_id
   OR NEW.club_id <> OLD.club_id
 )
BEGIN
  SELECT RAISE(ABORT, 'phase4_source_identity_immutable');
END;`;

export const PHASE4_INVARIANT_TRIGGER_STATEMENTS = [
  SCHEDULE_INTENT_BEFORE_INSERT_SQL,
  SCHEDULE_INTENT_BEFORE_UPDATE_SQL,
  RESERVATION_STATE_BEFORE_INSERT_SQL,
  RESERVATION_STATE_BEFORE_UPDATE_SQL,
  RESERVATION_STATE_BEFORE_DELETE_SQL,
  CONFLICT_POLICY_BEFORE_INSERT_SQL,
  CONFLICT_POLICY_BEFORE_UPDATE_SQL,
  CONFLICT_REVIEW_BEFORE_INSERT_SQL,
  CONFLICT_REVIEW_BEFORE_UPDATE_SQL,
  CONFLICT_OVERRIDE_BEFORE_INSERT_SQL,
  CONFLICT_OVERRIDE_BEFORE_UPDATE_SQL,
  EXTERNAL_RESERVATION_BEFORE_INSERT_SQL,
  EXTERNAL_RESERVATION_BEFORE_UPDATE_SQL,
  EXTERNAL_RESERVATION_BEFORE_DELETE_SQL,
  SOURCE_ACTIVATION_BEFORE_UPDATE_SQL,
  SOURCE_DEACTIVATION_BEFORE_UPDATE_SQL,
  SOURCE_IDENTITY_BEFORE_UPDATE_SQL,
] as const;

export const PHASE4_INVARIANT_COUNT_SQL = [
  String.raw`
SELECT count(*) AS violation_count
FROM organizations AS organization
WHERE EXISTS (
  SELECT 1
  FROM organization_memberships AS membership
  WHERE membership.organization_id = organization.id
    AND membership.status = 'active'
    AND membership.deleted_at IS NULL
)
AND (
  SELECT count(*)
  FROM organizer_conflict_policies AS policy
  WHERE policy.organization_id = organization.id
) <> 1`,
  String.raw`
SELECT count(*) AS violation_count
FROM organizer_conflict_policies AS policy
WHERE NOT EXISTS (
  SELECT 1
  FROM organization_memberships AS updater_membership
  JOIN profiles AS updater_profile
    ON updater_profile.id = updater_membership.profile_id
  WHERE updater_membership.organization_id = policy.organization_id
    AND updater_membership.profile_id = policy.updated_by_profile_id
    AND updater_membership.role IN ('owner', 'administrator')
    AND updater_membership.status = 'active'
    AND updater_membership.deleted_at IS NULL
    AND updater_profile.status = 'active'
    AND updater_profile.deleted_at IS NULL
)`,
  String.raw`
SELECT count(*) AS violation_count
FROM organizer_reservation_states AS state
WHERE NOT EXISTS (
  SELECT 1
  FROM organizer_events AS event
  JOIN organizer_schedule_write_intents AS intent
    ON intent.id = state.write_intent_id
   AND intent.organizer_event_id = event.id
   AND intent.organization_id = event.organization_id
  WHERE event.id = state.organizer_event_id
    AND event.organization_id = state.organization_id
    AND event.club_id = state.club_id
    AND event.planning_status = state.planning_status
    AND event.publication_status = 'private'
    AND event.deleted_at IS NULL
    AND event.schedule_shape = state.schedule_shape
    AND event.timezone = state.timezone
    AND event.all_day_start_date IS state.all_day_start_date
    AND event.all_day_end_date_exclusive IS
        state.all_day_end_date_exclusive
    AND event.buffer_before_minutes = state.buffer_before_minutes
    AND event.buffer_after_minutes = state.buffer_after_minutes
    AND event.venue_id IS state.venue_id
    AND event.primary_organizer_profile_id =
        state.primary_organizer_profile_id
    AND event.schedule_version = state.schedule_version
    AND intent.completed_at IS NOT NULL
    AND intent.club_id = state.club_id
    AND intent.planning_status = state.planning_status
    AND intent.schedule_shape = state.schedule_shape
    AND intent.actual_start_utc = state.actual_start_utc
    AND intent.actual_end_utc = state.actual_end_utc
    AND intent.expanded_start_utc = state.expanded_start_utc
    AND intent.expanded_end_utc = state.expanded_end_utc
    AND intent.timezone = state.timezone
    AND intent.all_day_start_date IS state.all_day_start_date
    AND intent.all_day_end_date_exclusive IS
        state.all_day_end_date_exclusive
    AND intent.buffer_before_minutes = state.buffer_before_minutes
    AND intent.buffer_after_minutes = state.buffer_after_minutes
    AND intent.venue_id IS state.venue_id
    AND intent.primary_organizer_profile_id =
        state.primary_organizer_profile_id
    AND intent.proposed_schedule_version = state.schedule_version
    AND intent.policy_version = state.policy_version
    AND intent.organizer_scope_json = state.organizer_scope_json
    AND state.expanded_start_utc =
        state.actual_start_utc - state.buffer_before_minutes * 60000
    AND state.expanded_end_utc =
        state.actual_end_utc + state.buffer_after_minutes * 60000
    AND (
      event.schedule_shape = 'all_day'
      OR (
        event.starts_at_utc = state.actual_start_utc
        AND event.ends_at_utc = state.actual_end_utc
      )
    )
)`,
  String.raw`
SELECT count(*) AS violation_count
FROM organizer_events AS event
JOIN organizer_conflict_policies AS policy
  ON policy.organization_id = event.organization_id
WHERE event.schedule_shape IN ('timed', 'all_day')
  AND event.publication_status = 'private'
  AND event.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM organizer_reservation_states AS state
    JOIN organizer_schedule_write_intents AS intent
      ON intent.id = state.write_intent_id
     AND intent.organizer_event_id = event.id
     AND intent.organization_id = event.organization_id
     AND intent.completed_at IS NOT NULL
    WHERE state.organizer_event_id = event.id
      AND state.organization_id = event.organization_id
      AND state.club_id = event.club_id
      AND state.planning_status = event.planning_status
      AND state.schedule_shape = event.schedule_shape
      AND state.timezone = event.timezone
      AND state.all_day_start_date IS event.all_day_start_date
      AND state.all_day_end_date_exclusive IS
          event.all_day_end_date_exclusive
      AND state.buffer_before_minutes = event.buffer_before_minutes
      AND state.buffer_after_minutes = event.buffer_after_minutes
      AND state.venue_id IS event.venue_id
      AND state.primary_organizer_profile_id =
          event.primary_organizer_profile_id
      AND state.schedule_version = event.schedule_version
      AND state.policy_version > 0
      AND state.policy_version <= policy.policy_version
      AND state.expanded_start_utc =
          state.actual_start_utc - state.buffer_before_minutes * 60000
      AND state.expanded_end_utc =
          state.actual_end_utc + state.buffer_after_minutes * 60000
      AND (
        event.schedule_shape = 'all_day'
        OR (
          state.actual_start_utc = event.starts_at_utc
          AND state.actual_end_utc = event.ends_at_utc
        )
      )
      AND (
        SELECT count(*)
        FROM json_each(state.organizer_scope_json)
      ) = 1 + (
        SELECT count(*)
        FROM organizer_event_organizers AS association
        WHERE association.organization_id = event.organization_id
          AND association.organizer_event_id = event.id
          AND association.deleted_at IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM json_each(state.organizer_scope_json) AS primary_scope
        WHERE primary_scope.type = 'text'
          AND CAST(primary_scope.value AS TEXT) =
              event.primary_organizer_profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM organizer_event_organizers AS association
        WHERE association.organization_id = event.organization_id
          AND association.organizer_event_id = event.id
          AND association.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM json_each(state.organizer_scope_json) AS scope
            WHERE scope.type = 'text'
              AND CAST(scope.value AS TEXT) = association.profile_id
          )
      )
  )`,
  String.raw`
SELECT count(*) AS violation_count
FROM organizer_schedule_write_intents AS intent
WHERE NOT EXISTS (
  SELECT 1
  FROM organization_memberships AS actor_membership
  JOIN profiles AS actor_profile
    ON actor_profile.id = actor_membership.profile_id
  JOIN organizer_conflict_policies AS policy
    ON policy.id = intent.policy_id
   AND policy.organization_id = intent.organization_id
  WHERE actor_membership.organization_id = intent.organization_id
    AND actor_membership.profile_id = intent.actor_profile_id
    AND policy.policy_version >= intent.policy_version
)
OR (
  intent.completed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM organizer_events AS event
    WHERE event.id = intent.organizer_event_id
      AND event.organization_id = intent.organization_id
      AND event.content_version >= intent.proposed_content_version
      AND event.schedule_version >= intent.proposed_schedule_version
  )
)`,
  String.raw`
SELECT count(*) AS violation_count
FROM organizer_conflict_review_requests AS review
WHERE NOT EXISTS (
  SELECT 1
  FROM organizer_events AS event
  JOIN organizer_conflict_policies AS policy
    ON policy.id = review.policy_id
   AND policy.organization_id = event.organization_id
  JOIN organization_memberships AS requester
    ON requester.organization_id = event.organization_id
   AND requester.profile_id = review.requester_profile_id
  WHERE event.id = review.organizer_event_id
    AND event.organization_id = review.organization_id
    AND policy.policy_version >= review.policy_version
)
OR (
  review.decided_by_profile_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM organization_memberships AS decider
    WHERE decider.organization_id = review.organization_id
      AND decider.profile_id = review.decided_by_profile_id
  )
)`,
  String.raw`
SELECT count(*) AS violation_count
FROM organizer_conflict_incidents AS incident
WHERE NOT EXISTS (
  SELECT 1
  FROM organizer_events AS event
  JOIN organizer_conflict_policies AS policy
    ON policy.id = incident.policy_id
   AND policy.organization_id = event.organization_id
  JOIN organization_memberships AS detector
    ON detector.organization_id = event.organization_id
   AND detector.profile_id = incident.detected_by_profile_id
  WHERE event.id = incident.organizer_event_id
    AND event.organization_id = incident.organization_id
    AND policy.policy_version >= incident.policy_version
)`,
  String.raw`
SELECT count(*) AS violation_count
FROM organizer_conflict_overrides AS override
WHERE NOT EXISTS (
  SELECT 1
  FROM organizer_conflict_incidents AS incident
  JOIN organizer_conflict_policies AS policy
    ON policy.id = override.policy_id
   AND policy.organization_id = incident.organization_id
  JOIN organization_memberships AS actor
    ON actor.organization_id = incident.organization_id
   AND actor.profile_id = override.actor_profile_id
  WHERE incident.id = override.incident_id
    AND incident.organization_id = override.organization_id
    AND incident.organizer_event_id = override.organizer_event_id
    AND incident.conflicting_candidate_key =
        override.conflicting_candidate_key
    AND incident.proposed_schedule_version =
        override.proposed_schedule_version
    AND incident.conflicting_schedule_version =
        override.conflicting_schedule_version
    AND incident.policy_version = override.policy_version
    AND incident.state_fingerprint = override.state_fingerprint
)`,
  String.raw`
SELECT count(*) AS violation_count
FROM organizer_external_reservation_intervals AS interval
WHERE (
  interval.source_kind = 'legacy'
  AND NOT EXISTS (
    SELECT 1
    FROM events AS event
    WHERE event.id = interval.event_id
      AND event.id = interval.source_record_id
      AND event.organization_id = interval.organization_id
      AND event.club_id = interval.club_id
      AND event.status = interval.planning_status
      AND event.time_kind = interval.schedule_shape
      AND event.timezone = interval.timezone
      AND event.all_day_start_date IS interval.all_day_start_date
      AND event.all_day_end_date_exclusive IS
          interval.all_day_end_date_exclusive
      AND event.buffer_before_minutes = interval.buffer_before_minutes
      AND event.buffer_after_minutes = interval.buffer_after_minutes
      AND event.venue_id IS interval.venue_id
      AND event.primary_organizer_profile_id IS
          interval.primary_organizer_profile_id
      AND event.organizer_scope_json = interval.organizer_scope_json
      AND event.schedule_version = interval.schedule_version
      AND event.hold_expires_at IS interval.hold_expires_at
      AND event.title = interval.title
      AND event.deleted_at IS NULL
      AND event.status IN ('hold', 'tentative', 'confirmed')
      AND (
        event.time_kind = 'all_day'
        OR (
          event.starts_at_utc = interval.actual_start_utc
          AND event.ends_at_utc = interval.actual_end_utc
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM external_source_links AS source_link
        WHERE source_link.organization_id = event.organization_id
          AND source_link.entity_type = 'event'
          AND source_link.entity_id = event.id
          AND source_link.source_type = 'meetup_ics'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM organizer_events AS adopted
        WHERE adopted.id = event.id
          AND adopted.organization_id = event.organization_id
      )
       AND length(interval.source_fingerprint) = 64
       AND length(interval.normalized_state_fingerprint) = 64
       AND length(interval.reservation_semantic_fingerprint) = 64
  )
)
OR (
  interval.source_kind = 'meetup'
  AND NOT EXISTS (
    SELECT 1
     FROM meetup_event_snapshots AS snapshot
     JOIN sync_sources AS source
      ON source.id = snapshot.sync_source_id
     AND source.organization_id = snapshot.organization_id
     JOIN meetup_sync_generations AS generation
       ON generation.id = snapshot.generation_id
      AND generation.sync_source_id = source.id
     JOIN meetup_snapshot_reservation_normalizations AS normalization
       ON normalization.organization_id = snapshot.organization_id
      AND normalization.sync_source_id = snapshot.sync_source_id
      AND normalization.generation_id = snapshot.generation_id
      AND normalization.snapshot_id = snapshot.id
      AND normalization.event_id = snapshot.event_id
     WHERE snapshot.id = interval.source_record_id
      AND snapshot.organization_id = interval.organization_id
      AND snapshot.sync_source_id = interval.sync_source_id
      AND snapshot.generation_id = interval.generation_id
      AND snapshot.event_id = interval.event_id
      AND source.club_id = interval.club_id
      AND snapshot.status = interval.planning_status
      AND snapshot.status IN ('confirmed', 'tentative')
      AND snapshot.time_kind = interval.schedule_shape
      AND snapshot.timezone = interval.timezone
      AND snapshot.all_day_start_date IS interval.all_day_start_date
      AND snapshot.all_day_end_date_exclusive IS
          interval.all_day_end_date_exclusive
      AND interval.buffer_before_minutes = 0
      AND interval.buffer_after_minutes = 0
       AND interval.source_fingerprint = snapshot.source_fingerprint
       AND normalization.club_id = interval.club_id
       AND normalization.planning_status = interval.planning_status
       AND normalization.schedule_shape = interval.schedule_shape
       AND normalization.actual_start_utc = interval.actual_start_utc
       AND normalization.actual_end_utc = interval.actual_end_utc
       AND normalization.expanded_start_utc =
           interval.expanded_start_utc
       AND normalization.expanded_end_utc = interval.expanded_end_utc
       AND normalization.timezone = interval.timezone
       AND normalization.all_day_start_date IS
           interval.all_day_start_date
       AND normalization.all_day_end_date_exclusive IS
           interval.all_day_end_date_exclusive
       AND normalization.buffer_before_minutes =
           interval.buffer_before_minutes
       AND normalization.buffer_after_minutes =
           interval.buffer_after_minutes
       AND normalization.venue_id IS interval.venue_id
       AND normalization.primary_organizer_profile_id IS
           interval.primary_organizer_profile_id
       AND normalization.organizer_scope_json =
           interval.organizer_scope_json
       AND normalization.schedule_version = interval.schedule_version
       AND normalization.hold_expires_at IS interval.hold_expires_at
       AND normalization.source_fingerprint = interval.source_fingerprint
       AND normalization.normalized_state_fingerprint =
           interval.normalized_state_fingerprint
       AND normalization.reservation_semantic_fingerprint =
           interval.reservation_semantic_fingerprint
  )
)`,
  String.raw`
SELECT count(*) AS violation_count
FROM events AS event
WHERE event.deleted_at IS NULL
  AND event.status IN ('hold', 'tentative', 'confirmed')
  AND (
    event.status <> 'hold'
    OR event.hold_expires_at >
       CAST(unixepoch('subsec') * 1000 AS INTEGER)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM external_source_links AS source_link
    WHERE source_link.organization_id = event.organization_id
      AND source_link.entity_type = 'event'
      AND source_link.entity_id = event.id
      AND source_link.source_type = 'meetup_ics'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM organizer_events AS adopted
    WHERE adopted.id = event.id
      AND adopted.organization_id = event.organization_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM organizer_external_reservation_intervals AS interval
    WHERE interval.source_kind = 'legacy'
      AND interval.source_record_id = event.id
      AND interval.organization_id = event.organization_id
      AND interval.event_id = event.id
      AND interval.club_id = event.club_id
      AND interval.planning_status = event.status
      AND interval.schedule_shape = event.time_kind
      AND interval.timezone = event.timezone
      AND interval.all_day_start_date IS event.all_day_start_date
      AND interval.all_day_end_date_exclusive IS
          event.all_day_end_date_exclusive
      AND interval.buffer_before_minutes = event.buffer_before_minutes
      AND interval.buffer_after_minutes = event.buffer_after_minutes
      AND interval.venue_id IS event.venue_id
      AND interval.primary_organizer_profile_id IS
          event.primary_organizer_profile_id
      AND interval.organizer_scope_json = event.organizer_scope_json
      AND interval.schedule_version = event.schedule_version
      AND interval.hold_expires_at IS event.hold_expires_at
      AND interval.title = event.title
      AND (
        event.time_kind = 'all_day'
        OR (
          interval.actual_start_utc = event.starts_at_utc
          AND interval.actual_end_utc = event.ends_at_utc
        )
      )
  )`,
  String.raw`
SELECT count(*) AS violation_count
FROM sync_sources AS source
JOIN meetup_sync_generations AS generation
  ON generation.id = source.active_generation_id
 AND generation.organization_id = source.organization_id
 AND generation.sync_source_id = source.id
 AND generation.state = 'published'
JOIN meetup_event_snapshots AS snapshot
  ON snapshot.organization_id = source.organization_id
 AND snapshot.sync_source_id = source.id
 AND snapshot.generation_id = source.active_generation_id
JOIN events AS event
  ON event.id = snapshot.event_id
 AND event.organization_id = snapshot.organization_id
WHERE source.enabled = 1
  AND source.deleted_at IS NULL
  AND snapshot.status IN ('confirmed', 'tentative')
  AND NOT EXISTS (
    SELECT 1
    FROM organizer_external_reservation_intervals AS interval
    WHERE interval.source_kind = 'meetup'
      AND interval.source_record_id = snapshot.id
      AND interval.organization_id = snapshot.organization_id
      AND interval.sync_source_id = snapshot.sync_source_id
      AND interval.generation_id = snapshot.generation_id
      AND interval.event_id = snapshot.event_id
      AND interval.club_id = source.club_id
      AND interval.planning_status = snapshot.status
      AND interval.schedule_shape = snapshot.time_kind
      AND interval.timezone = snapshot.timezone
      AND interval.all_day_start_date IS snapshot.all_day_start_date
      AND interval.all_day_end_date_exclusive IS
          snapshot.all_day_end_date_exclusive
      AND interval.buffer_before_minutes = 0
      AND interval.buffer_after_minutes = 0
      AND interval.source_fingerprint = snapshot.source_fingerprint
      AND interval.title = snapshot.title
      AND (
        snapshot.time_kind = 'all_day'
        OR (
          interval.actual_start_utc = snapshot.starts_at_utc
          AND interval.actual_end_utc = snapshot.ends_at_utc
        )
      )
  )`,
  String.raw`
SELECT count(*) AS violation_count
FROM organizer_hold_notice_receipts AS receipt
WHERE NOT EXISTS (
  SELECT 1
  FROM organizer_events AS event
  JOIN organization_memberships AS recipient
    ON recipient.organization_id = event.organization_id
   AND recipient.profile_id = receipt.recipient_profile_id
  JOIN notifications AS notification
    ON notification.id = receipt.notification_id
   AND notification.organization_id = event.organization_id
   AND notification.recipient_profile_id = receipt.recipient_profile_id
  WHERE event.id = receipt.organizer_event_id
    AND event.organization_id = receipt.organization_id
    AND event.schedule_version >= receipt.schedule_version
)`,
] as const;
