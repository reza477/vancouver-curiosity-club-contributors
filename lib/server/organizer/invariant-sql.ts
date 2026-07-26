/**
 * Phase 3 guards are installed as complete prepared statements by the runtime
 * invariant initializer. They must never be copied into packaged migrations:
 * Sites' production tokenizer cannot preserve trigger-body semicolons.
 */
export const PHASE3_INVARIANT_TRIGGER_STATEMENTS = [
  String.raw`
CREATE TRIGGER IF NOT EXISTS organization_memberships_single_owner_before_insert
BEFORE INSERT ON organization_memberships
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM profiles AS profile
      WHERE profile.id = NEW.profile_id
        AND profile.normalized_email = NEW.normalized_email
    )
    THEN RAISE(ABORT, 'membership_profile_identity_mismatch')
  END;
  SELECT CASE
    WHEN NEW.role = 'owner'
     AND NEW.status = 'active'
     AND NEW.deleted_at IS NULL
     AND (
       NOT EXISTS (
         SELECT 1
         FROM profiles AS owner_profile
         WHERE owner_profile.id = NEW.profile_id
           AND owner_profile.status = 'active'
           AND owner_profile.deleted_at IS NULL
       )
       OR EXISTS (
         SELECT 1
         FROM organization_memberships AS existing
         JOIN profiles AS existing_profile
           ON existing_profile.id = existing.profile_id
          AND existing_profile.status = 'active'
          AND existing_profile.deleted_at IS NULL
         WHERE existing.organization_id = NEW.organization_id
           AND existing.role = 'owner'
           AND existing.status = 'active'
           AND existing.deleted_at IS NULL
       )
     )
    THEN RAISE(ABORT, 'organization_requires_exactly_one_owner')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organization_memberships_single_owner_before_update
BEFORE UPDATE OF organization_id, profile_id, normalized_email, role, status, deleted_at
ON organization_memberships
BEGIN
  SELECT CASE
    WHEN NEW.organization_id <> OLD.organization_id
      OR NEW.profile_id <> OLD.profile_id
      OR NEW.normalized_email <> OLD.normalized_email
    THEN RAISE(ABORT, 'membership_identity_is_immutable')
  END;
  SELECT CASE
    WHEN OLD.role = 'owner'
     AND OLD.status = 'active'
     AND OLD.deleted_at IS NULL
     AND EXISTS (
       SELECT 1
       FROM profiles AS old_owner_profile
       WHERE old_owner_profile.id = OLD.profile_id
         AND old_owner_profile.status = 'active'
         AND old_owner_profile.deleted_at IS NULL
     )
     AND NOT (
       NEW.organization_id = OLD.organization_id
       AND NEW.role = 'owner'
       AND NEW.status = 'active'
       AND NEW.deleted_at IS NULL
     )
     AND NOT EXISTS (
       SELECT 1
       FROM ownership_transfer_locks AS transfer
       WHERE transfer.organization_id = OLD.organization_id
         AND transfer.actor_profile_id = OLD.profile_id
     )
    THEN RAISE(ABORT, 'organization_requires_exactly_one_owner')
  END;
  SELECT CASE
    WHEN NEW.role = 'owner'
     AND NEW.status = 'active'
     AND NEW.deleted_at IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM profiles AS new_owner_profile
       WHERE new_owner_profile.id = NEW.profile_id
         AND new_owner_profile.status = 'active'
         AND new_owner_profile.deleted_at IS NULL
     )
    THEN RAISE(ABORT, 'organization_requires_exactly_one_owner')
  END;
  SELECT CASE
    WHEN NEW.role = 'owner'
     AND NEW.status = 'active'
     AND NEW.deleted_at IS NULL
     AND NOT (
       OLD.organization_id = NEW.organization_id
       AND OLD.role = 'owner'
       AND OLD.status = 'active'
       AND OLD.deleted_at IS NULL
       AND EXISTS (
         SELECT 1
         FROM profiles AS old_owner_profile
         WHERE old_owner_profile.id = OLD.profile_id
           AND old_owner_profile.status = 'active'
           AND old_owner_profile.deleted_at IS NULL
       )
     )
     AND EXISTS (
       SELECT 1
       FROM organization_memberships AS existing
       JOIN profiles AS existing_profile
         ON existing_profile.id = existing.profile_id
        AND existing_profile.status = 'active'
        AND existing_profile.deleted_at IS NULL
       WHERE existing.organization_id = NEW.organization_id
         AND existing.id <> NEW.id
         AND existing.role = 'owner'
         AND existing.status = 'active'
         AND existing.deleted_at IS NULL
     )
     AND NOT EXISTS (
       SELECT 1
       FROM ownership_transfer_locks AS transfer
       WHERE transfer.organization_id = NEW.organization_id
         AND transfer.target_membership_id = NEW.id
     )
    THEN RAISE(ABORT, 'organization_requires_exactly_one_owner')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organization_memberships_single_owner_before_delete
BEFORE DELETE ON organization_memberships
WHEN OLD.role = 'owner'
 AND OLD.status = 'active'
 AND OLD.deleted_at IS NULL
 AND NOT EXISTS (
   SELECT 1
   FROM ownership_transfer_locks AS transfer
   WHERE transfer.organization_id = OLD.organization_id
     AND transfer.actor_profile_id = OLD.profile_id
 )
BEGIN
  SELECT RAISE(ABORT, 'organization_requires_exactly_one_owner');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS ownership_transfer_locks_before_insert
BEFORE INSERT ON ownership_transfer_locks
BEGIN
  SELECT CASE
    WHEN (
      SELECT count(*)
      FROM organization_memberships AS owner_membership
      JOIN profiles AS owner_profile
        ON owner_profile.id = owner_membership.profile_id
       AND owner_profile.status = 'active'
       AND owner_profile.deleted_at IS NULL
      WHERE owner_membership.organization_id = NEW.organization_id
        AND owner_membership.profile_id = NEW.actor_profile_id
        AND owner_membership.role = 'owner'
        AND owner_membership.status = 'active'
        AND owner_membership.deleted_at IS NULL
    ) <> 1
    OR (
      SELECT count(*)
      FROM organization_memberships AS active_owner
      JOIN profiles AS active_owner_profile
        ON active_owner_profile.id = active_owner.profile_id
       AND active_owner_profile.status = 'active'
       AND active_owner_profile.deleted_at IS NULL
      WHERE active_owner.organization_id = NEW.organization_id
        AND active_owner.role = 'owner'
        AND active_owner.status = 'active'
        AND active_owner.deleted_at IS NULL
    ) <> 1
    OR NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS target
      JOIN profiles AS target_profile
        ON target_profile.id = target.profile_id
       AND target_profile.status = 'active'
       AND target_profile.deleted_at IS NULL
      WHERE target.id = NEW.target_membership_id
        AND target.organization_id = NEW.organization_id
        AND target.profile_id <> NEW.actor_profile_id
        AND target.role <> 'owner'
        AND target.status = 'active'
        AND target.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'invalid_ownership_transfer_lock')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS ownership_transfer_locks_before_update
BEFORE UPDATE ON ownership_transfer_locks
BEGIN
  SELECT RAISE(ABORT, 'ownership_transfer_lock_is_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS ownership_transfer_locks_before_delete
BEFORE DELETE ON ownership_transfer_locks
BEGIN
  SELECT CASE
    WHEN (
      SELECT count(*)
      FROM organization_memberships AS owner_membership
      JOIN profiles AS owner_profile
        ON owner_profile.id = owner_membership.profile_id
       AND owner_profile.status = 'active'
       AND owner_profile.deleted_at IS NULL
      WHERE owner_membership.organization_id = OLD.organization_id
        AND owner_membership.role = 'owner'
        AND owner_membership.status = 'active'
        AND owner_membership.deleted_at IS NULL
    ) <> 1
    OR NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS target
      JOIN profiles AS target_profile
        ON target_profile.id = target.profile_id
       AND target_profile.status = 'active'
       AND target_profile.deleted_at IS NULL
      WHERE target.id = OLD.target_membership_id
        AND target.organization_id = OLD.organization_id
        AND target.role = 'owner'
        AND target.status = 'active'
        AND target.deleted_at IS NULL
    )
    OR NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS actor
      JOIN profiles AS actor_profile
        ON actor_profile.id = actor.profile_id
       AND actor_profile.status = 'active'
       AND actor_profile.deleted_at IS NULL
      WHERE actor.organization_id = OLD.organization_id
        AND actor.profile_id = OLD.actor_profile_id
        AND actor.role <> 'owner'
        AND actor.status = 'active'
        AND actor.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'ownership_transfer_not_complete')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS profiles_membership_identity_before_update
BEFORE UPDATE OF normalized_email, status, deleted_at ON profiles
BEGIN
  SELECT CASE
    WHEN NEW.normalized_email <> OLD.normalized_email
     AND EXISTS (
       SELECT 1
       FROM organization_memberships AS membership
       WHERE membership.profile_id = OLD.id
     )
    THEN RAISE(ABORT, 'profile_membership_identity_is_immutable')
  END;
  SELECT CASE
    WHEN OLD.status = 'active'
     AND OLD.deleted_at IS NULL
     AND (
       NEW.status <> 'active'
       OR NEW.deleted_at IS NOT NULL
     )
     AND EXISTS (
       SELECT 1
       FROM organization_memberships AS owner_membership
       WHERE owner_membership.profile_id = OLD.id
         AND owner_membership.role = 'owner'
         AND owner_membership.status = 'active'
         AND owner_membership.deleted_at IS NULL
     )
     AND NOT EXISTS (
       SELECT 1
       FROM ownership_transfer_locks AS transfer
       WHERE transfer.organization_id = (
         SELECT owner_membership.organization_id
         FROM organization_memberships AS owner_membership
         WHERE owner_membership.profile_id = OLD.id
           AND owner_membership.role = 'owner'
           AND owner_membership.status = 'active'
           AND owner_membership.deleted_at IS NULL
         LIMIT 1
       )
         AND transfer.actor_profile_id = OLD.id
     )
    THEN RAISE(ABORT, 'organization_requires_exactly_one_owner')
  END;
  SELECT CASE
    WHEN NEW.status = 'active'
     AND NEW.deleted_at IS NULL
     AND NOT (
       OLD.status = 'active'
       AND OLD.deleted_at IS NULL
     )
     AND EXISTS (
       SELECT 1
       FROM organization_memberships AS owner_membership
       WHERE owner_membership.profile_id = NEW.id
         AND owner_membership.role = 'owner'
         AND owner_membership.status = 'active'
         AND owner_membership.deleted_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM organization_memberships AS other_owner
           JOIN profiles AS other_profile
             ON other_profile.id = other_owner.profile_id
            AND other_profile.status = 'active'
            AND other_profile.deleted_at IS NULL
           WHERE other_owner.organization_id =
                 owner_membership.organization_id
             AND other_owner.profile_id <> NEW.id
             AND other_owner.role = 'owner'
             AND other_owner.status = 'active'
             AND other_owner.deleted_at IS NULL
         )
     )
    THEN RAISE(ABORT, 'organization_requires_exactly_one_owner')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS profiles_membership_identity_before_delete
BEFORE DELETE ON profiles
WHEN EXISTS (
  SELECT 1
  FROM organization_memberships AS membership
  WHERE membership.profile_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'profile_membership_identity_is_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_events_phase3_integrity_before_insert
BEFORE INSERT ON organizer_events
BEGIN
  SELECT CASE
    WHEN NEW.planning_status NOT IN ('idea', 'draft')
      OR NEW.publication_status <> 'private'
    THEN RAISE(ABORT, 'phase3_event_lifecycle_forbidden')
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
      NEW.program_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM programs AS program
        WHERE program.id = NEW.program_id
          AND program.organization_id = NEW.organization_id
          AND (program.club_id IS NULL OR program.club_id = NEW.club_id)
          AND program.deleted_at IS NULL
      )
    )
    OR (
      NEW.event_lane_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM event_lanes AS lane
        WHERE lane.id = NEW.event_lane_id
          AND lane.organization_id = NEW.organization_id
          AND lane.deleted_at IS NULL
      )
    )
    OR (
      NEW.category_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM categories AS category
        WHERE category.id = NEW.category_id
          AND category.organization_id = NEW.organization_id
          AND category.deleted_at IS NULL
      )
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
      FROM profiles AS organizer
      JOIN organization_memberships AS membership
        ON membership.profile_id = organizer.id
       AND membership.organization_id = NEW.organization_id
       AND membership.status = 'active'
       AND membership.deleted_at IS NULL
      WHERE organizer.id = NEW.primary_organizer_profile_id
        AND organizer.status = 'active'
        AND organizer.deleted_at IS NULL
        AND (
          membership.role <> 'organizer'
          OR EXISTS (
            SELECT 1
            FROM club_memberships AS club_membership
            WHERE club_membership.organization_id = NEW.organization_id
              AND club_membership.club_id = NEW.club_id
              AND club_membership.organization_membership_id = membership.id
              AND club_membership.profile_id = organizer.id
              AND club_membership.status = 'active'
              AND club_membership.deleted_at IS NULL
          )
        )
    )
    OR NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS creator
      WHERE creator.organization_id = NEW.organization_id
        AND creator.profile_id = NEW.created_by_profile_id
        AND creator.status = 'active'
        AND creator.deleted_at IS NULL
    )
    OR NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS updater
      WHERE updater.organization_id = NEW.organization_id
        AND updater.profile_id = NEW.updated_by_profile_id
        AND updater.status = 'active'
        AND updater.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'organizer_event_organization_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_events_phase3_integrity_before_update
BEFORE UPDATE ON organizer_events
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.created_by_profile_id <> OLD.created_by_profile_id
    THEN RAISE(ABORT, 'organizer_event_identity_immutable')
  END;
  SELECT CASE
    WHEN NEW.planning_status NOT IN ('idea', 'draft')
      OR NEW.publication_status <> 'private'
    THEN RAISE(ABORT, 'phase3_event_lifecycle_forbidden')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM clubs AS club
      WHERE club.id = NEW.club_id
        AND club.organization_id = NEW.organization_id
        AND club.deleted_at IS NULL
    )
    OR (
      NEW.program_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM programs AS program
        WHERE program.id = NEW.program_id
          AND program.organization_id = NEW.organization_id
          AND (program.club_id IS NULL OR program.club_id = NEW.club_id)
          AND program.deleted_at IS NULL
      )
    )
    OR (
      NEW.event_lane_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM event_lanes AS lane
        WHERE lane.id = NEW.event_lane_id
          AND lane.organization_id = NEW.organization_id
          AND lane.deleted_at IS NULL
      )
    )
    OR (
      NEW.category_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM categories AS category
        WHERE category.id = NEW.category_id
          AND category.organization_id = NEW.organization_id
          AND category.deleted_at IS NULL
      )
    )
    OR (
      NEW.venue_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM venues AS venue
        WHERE venue.id = NEW.venue_id
          AND venue.organization_id = NEW.organization_id
          AND venue.deleted_at IS NULL
      )
    )
    OR NOT EXISTS (
      SELECT 1
      FROM profiles AS organizer
      JOIN organization_memberships AS membership
        ON membership.profile_id = organizer.id
       AND membership.organization_id = NEW.organization_id
       AND membership.status = 'active'
       AND membership.deleted_at IS NULL
      WHERE organizer.id = NEW.primary_organizer_profile_id
        AND organizer.status = 'active'
        AND organizer.deleted_at IS NULL
        AND (
          membership.role <> 'organizer'
          OR EXISTS (
            SELECT 1
            FROM club_memberships AS club_membership
            WHERE club_membership.organization_id = NEW.organization_id
              AND club_membership.club_id = NEW.club_id
              AND club_membership.organization_membership_id = membership.id
              AND club_membership.profile_id = organizer.id
              AND club_membership.status = 'active'
              AND club_membership.deleted_at IS NULL
          )
        )
    )
    OR NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS updater
      WHERE updater.organization_id = NEW.organization_id
        AND updater.profile_id = NEW.updated_by_profile_id
        AND updater.status = 'active'
        AND updater.deleted_at IS NULL
    )
    OR (
      OLD.deleted_at IS NOT NULL
      AND NEW.deleted_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM organizer_event_organizers AS association
        WHERE association.organizer_event_id = NEW.id
          AND association.organization_id = NEW.organization_id
          AND association.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM profiles AS co_organizer
            JOIN organization_memberships AS co_membership
              ON co_membership.profile_id = co_organizer.id
             AND co_membership.organization_id = NEW.organization_id
             AND co_membership.status = 'active'
             AND co_membership.deleted_at IS NULL
            WHERE co_organizer.id = association.profile_id
              AND co_organizer.status = 'active'
              AND co_organizer.deleted_at IS NULL
              AND (
                co_membership.role <> 'organizer'
                OR EXISTS (
                  SELECT 1
                  FROM club_memberships AS club_membership
                  WHERE club_membership.organization_id = NEW.organization_id
                    AND club_membership.club_id = NEW.club_id
                    AND club_membership.organization_membership_id =
                      co_membership.id
                    AND club_membership.profile_id = co_organizer.id
                    AND club_membership.status = 'active'
                    AND club_membership.deleted_at IS NULL
                )
              )
          )
      )
    )
    THEN RAISE(ABORT, 'organizer_event_organization_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_organizers_integrity_before_insert
BEFORE INSERT ON organizer_event_organizers
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_events AS event
      JOIN profiles AS organizer
        ON organizer.id = NEW.profile_id
       AND organizer.status = 'active'
       AND organizer.deleted_at IS NULL
      JOIN organization_memberships AS membership
        ON membership.organization_id = event.organization_id
       AND membership.profile_id = organizer.id
       AND membership.status = 'active'
       AND membership.deleted_at IS NULL
      WHERE event.id = NEW.organizer_event_id
        AND event.organization_id = NEW.organization_id
        AND event.primary_organizer_profile_id <> NEW.profile_id
        AND (
          membership.role <> 'organizer'
          OR EXISTS (
            SELECT 1
            FROM club_memberships AS club_membership
            WHERE club_membership.organization_id = event.organization_id
              AND club_membership.club_id = event.club_id
              AND club_membership.organization_membership_id = membership.id
              AND club_membership.profile_id = organizer.id
              AND club_membership.status = 'active'
              AND club_membership.deleted_at IS NULL
          )
        )
    )
    OR NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS creator
      WHERE creator.organization_id = NEW.organization_id
        AND creator.profile_id = NEW.created_by_profile_id
    )
    THEN RAISE(ABORT, 'organizer_event_organizer_organization_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_organizers_integrity_before_update
BEFORE UPDATE OF organization_id, organizer_event_id, profile_id, deleted_at
ON organizer_event_organizers
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_events AS event
      JOIN profiles AS organizer
        ON organizer.id = NEW.profile_id
       AND organizer.status = 'active'
       AND organizer.deleted_at IS NULL
      JOIN organization_memberships AS membership
        ON membership.organization_id = event.organization_id
       AND membership.profile_id = organizer.id
       AND membership.status = 'active'
       AND membership.deleted_at IS NULL
      WHERE event.id = NEW.organizer_event_id
        AND event.organization_id = NEW.organization_id
        AND event.primary_organizer_profile_id <> NEW.profile_id
        AND (
          membership.role <> 'organizer'
          OR EXISTS (
            SELECT 1
            FROM club_memberships AS club_membership
            WHERE club_membership.organization_id = event.organization_id
              AND club_membership.club_id = event.club_id
              AND club_membership.organization_membership_id = membership.id
              AND club_membership.profile_id = organizer.id
              AND club_membership.status = 'active'
              AND club_membership.deleted_at IS NULL
          )
        )
    )
    OR NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS creator
      WHERE creator.organization_id = NEW.organization_id
        AND creator.profile_id = NEW.created_by_profile_id
    )
    THEN RAISE(ABORT, 'organizer_event_organizer_organization_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_revisions_integrity_before_insert
BEFORE INSERT ON organizer_event_revisions
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_events AS event
      WHERE event.id = NEW.organizer_event_id
        AND event.organization_id = NEW.organization_id
        AND event.content_version = NEW.content_version
        AND event.schedule_version = NEW.schedule_version
    )
    OR NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS actor
      WHERE actor.organization_id = NEW.organization_id
        AND actor.profile_id = NEW.actor_profile_id
    )
    THEN RAISE(ABORT, 'organizer_event_revision_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_revisions_integrity_before_update
BEFORE UPDATE ON organizer_event_revisions
BEGIN
  SELECT RAISE(ABORT, 'organizer_event_revision_is_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_revisions_integrity_before_delete
BEFORE DELETE ON organizer_event_revisions
BEGIN
  SELECT RAISE(ABORT, 'organizer_event_revision_is_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS audit_logs_immutable_before_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_log_is_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS audit_logs_immutable_before_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_log_is_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_profile_preferences_integrity_before_insert
BEFORE INSERT ON organizer_profile_preferences
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM profiles AS profile
      JOIN organization_memberships AS membership
        ON membership.profile_id = profile.id
       AND membership.organization_id = NEW.organization_id
      WHERE profile.id = NEW.profile_id
    )
    THEN RAISE(ABORT, 'organizer_profile_preference_organization_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_profile_preferences_integrity_before_update
BEFORE UPDATE OF profile_id, organization_id
ON organizer_profile_preferences
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM profiles AS profile
      JOIN organization_memberships AS membership
        ON membership.profile_id = profile.id
       AND membership.organization_id = NEW.organization_id
      WHERE profile.id = NEW.profile_id
    )
    THEN RAISE(ABORT, 'organizer_profile_preference_organization_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_rate_limits_integrity_before_insert
BEFORE INSERT ON organizer_rate_limits
WHEN NEW.organization_id IS NOT NULL
 AND NEW.profile_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1
   FROM organization_memberships AS membership
   WHERE membership.organization_id = NEW.organization_id
     AND membership.profile_id = NEW.profile_id
 )
BEGIN
  SELECT RAISE(ABORT, 'organizer_rate_limit_organization_mismatch');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_rate_limits_integrity_before_update
BEFORE UPDATE OF organization_id, profile_id ON organizer_rate_limits
WHEN NEW.organization_id IS NOT NULL
 AND NEW.profile_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1
   FROM organization_memberships AS membership
   WHERE membership.organization_id = NEW.organization_id
     AND membership.profile_id = NEW.profile_id
 )
BEGIN
  SELECT RAISE(ABORT, 'organizer_rate_limit_organization_mismatch');
END;`,
] as const;

export const PHASE3_INVARIANT_COUNT_SQL = [
  String.raw`
SELECT count(*) AS violation_count
FROM organizations AS organization
WHERE organization.deleted_at IS NULL
  AND (
    organization.owner_bootstrap_closed_at IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM organization_memberships AS any_membership
      WHERE any_membership.organization_id = organization.id
        AND any_membership.deleted_at IS NULL
    )
  )
  AND (
    SELECT count(*)
    FROM organization_memberships AS owner_membership
    JOIN profiles AS owner_profile
      ON owner_profile.id = owner_membership.profile_id
     AND owner_profile.status = 'active'
     AND owner_profile.deleted_at IS NULL
    WHERE owner_membership.organization_id = organization.id
      AND owner_membership.role = 'owner'
      AND owner_membership.status = 'active'
      AND owner_membership.deleted_at IS NULL
  ) <> 1`,
  String.raw`
SELECT count(*) AS violation_count
FROM organization_memberships AS membership
WHERE NOT EXISTS (
  SELECT 1
  FROM profiles AS profile
  WHERE profile.id = membership.profile_id
    AND profile.normalized_email = membership.normalized_email
)`,
  String.raw`
SELECT count(*) AS violation_count
FROM ownership_transfer_locks`,
  String.raw`
SELECT count(*) AS violation_count
FROM organizer_events AS event
WHERE NOT EXISTS (
  SELECT 1
  FROM organization_memberships AS creator
  WHERE creator.organization_id = event.organization_id
    AND creator.profile_id = event.created_by_profile_id
)
OR (
  event.deleted_at IS NULL
  AND (
    event.planning_status NOT IN ('idea', 'draft')
    OR event.publication_status <> 'private'
    OR NOT EXISTS (
     SELECT 1 FROM clubs AS club
     WHERE club.id = event.club_id
       AND club.organization_id = event.organization_id
       AND club.deleted_at IS NULL
   )
   OR (event.program_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM programs AS program
     WHERE program.id = event.program_id
       AND program.organization_id = event.organization_id
       AND (program.club_id IS NULL OR program.club_id = event.club_id)
       AND program.deleted_at IS NULL
   ))
   OR (event.event_lane_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM event_lanes AS lane
     WHERE lane.id = event.event_lane_id
       AND lane.organization_id = event.organization_id
       AND lane.deleted_at IS NULL
   ))
   OR (event.category_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM categories AS category
     WHERE category.id = event.category_id
       AND category.organization_id = event.organization_id
       AND category.deleted_at IS NULL
   ))
   OR (event.venue_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM venues AS venue
     WHERE venue.id = event.venue_id
       AND venue.organization_id = event.organization_id
       AND venue.deleted_at IS NULL
   ))
   OR NOT EXISTS (
     SELECT 1
     FROM profiles AS organizer
     JOIN organization_memberships AS membership
       ON membership.profile_id = organizer.id
      AND membership.organization_id = event.organization_id
      AND membership.status = 'active'
      AND membership.deleted_at IS NULL
     WHERE organizer.id = event.primary_organizer_profile_id
       AND organizer.status = 'active'
       AND organizer.deleted_at IS NULL
       AND (
         membership.role <> 'organizer'
         OR EXISTS (
           SELECT 1
           FROM club_memberships AS club_membership
           WHERE club_membership.organization_id = event.organization_id
             AND club_membership.club_id = event.club_id
             AND club_membership.organization_membership_id = membership.id
             AND club_membership.profile_id = organizer.id
             AND club_membership.status = 'active'
             AND club_membership.deleted_at IS NULL
         )
       )
   )
   OR NOT EXISTS (
     SELECT 1
     FROM organization_memberships AS updater
     WHERE updater.organization_id = event.organization_id
       AND updater.profile_id = event.updated_by_profile_id
       AND updater.status = 'active'
       AND updater.deleted_at IS NULL
   )
  )
)`,
  String.raw`
SELECT count(*) AS violation_count
FROM organizer_event_organizers AS association
JOIN organizer_events AS parent_event
  ON parent_event.id = association.organizer_event_id
WHERE association.deleted_at IS NULL
  AND parent_event.deleted_at IS NULL
  AND NOT EXISTS (
  SELECT 1
  FROM organizer_events AS event
  JOIN profiles AS organizer
    ON organizer.id = association.profile_id
   AND organizer.status = 'active'
   AND organizer.deleted_at IS NULL
  JOIN organization_memberships AS membership
    ON membership.organization_id = event.organization_id
   AND membership.profile_id = organizer.id
   AND membership.status = 'active'
   AND membership.deleted_at IS NULL
  WHERE event.id = association.organizer_event_id
    AND event.organization_id = association.organization_id
    AND event.primary_organizer_profile_id <> association.profile_id
    AND (
      membership.role <> 'organizer'
      OR EXISTS (
        SELECT 1
        FROM club_memberships AS club_membership
        WHERE club_membership.organization_id = event.organization_id
          AND club_membership.club_id = event.club_id
          AND club_membership.organization_membership_id = membership.id
          AND club_membership.profile_id = organizer.id
          AND club_membership.status = 'active'
          AND club_membership.deleted_at IS NULL
      )
    )
)
OR (
  association.deleted_at IS NULL
  AND parent_event.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM organization_memberships AS creator
    WHERE creator.organization_id = association.organization_id
      AND creator.profile_id = association.created_by_profile_id
  )
)`,
  String.raw`
SELECT count(*) AS violation_count
FROM organizer_event_revisions AS revision
WHERE NOT EXISTS (
  SELECT 1
  FROM organizer_events AS event
  WHERE event.id = revision.organizer_event_id
    AND event.organization_id = revision.organization_id
    AND event.content_version >= revision.content_version
    AND event.schedule_version >= revision.schedule_version
)
OR NOT EXISTS (
  SELECT 1
  FROM organization_memberships AS actor
  WHERE actor.organization_id = revision.organization_id
    AND actor.profile_id = revision.actor_profile_id
)`,
  String.raw`
SELECT count(*) AS violation_count
FROM organizer_profile_preferences AS preference
WHERE NOT EXISTS (
  SELECT 1
  FROM profiles AS profile
  JOIN organization_memberships AS membership
    ON membership.profile_id = profile.id
   AND membership.organization_id = preference.organization_id
  WHERE profile.id = preference.profile_id
)`,
  String.raw`
SELECT count(*) AS violation_count
FROM organizer_rate_limits AS rate_limit
WHERE rate_limit.organization_id IS NOT NULL
  AND rate_limit.profile_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM organization_memberships AS membership
    WHERE membership.organization_id = rate_limit.organization_id
      AND membership.profile_id = rate_limit.profile_id
  )`,
] as const;
