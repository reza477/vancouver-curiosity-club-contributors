/**
 * These are the authoritative database-enforced reservation guards. Sites
 * production tokenizes packaged migrations at semicolons, so each complete
 * trigger is prepared and installed by the server-only D1 invariant
 * initializer before application access.
 *
 * A canonical organizer_scope_json snapshot is deliberately stored on events:
 * it lets SQLite evaluate the complete proposed organizer set in the same
 * statement that reserves the interval. event_organizers remains the normalized
 * association table and is written in the same D1 batch.
 */
const CONFLICT_GUARD_BEFORE_INSERT_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS events_reservation_guard_before_insert
BEFORE INSERT ON events
WHEN NEW.deleted_at IS NULL
  AND NEW.status IN ('hold', 'tentative', 'confirmed')
BEGIN
  SELECT CASE
    WHEN NEW.status = 'hold'
      AND (
        NEW.hold_expires_at IS NULL
        OR NEW.hold_expires_at
          <= CAST(unixepoch('subsec') * 1000 AS INTEGER)
      )
    THEN RAISE(ABORT, 'conflict_guard_hold_expired')
  END;

  SELECT CASE
    WHEN NEW.status <> 'hold' AND NEW.hold_expires_at IS NOT NULL
    THEN RAISE(ABORT, 'conflict_guard_non_hold_expiry')
  END;

  SELECT CASE
    WHEN NEW.time_kind <> 'timed'
    THEN RAISE(ABORT, 'conflict_guard_requires_normalized_timed_interval')
  END;

  SELECT CASE
    WHEN NEW.primary_organizer_profile_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.organizer_scope_json) AS proposed_organizer
        WHERE proposed_organizer.type = 'text'
          AND proposed_organizer.value = NEW.primary_organizer_profile_id
      )
    THEN RAISE(ABORT, 'conflict_guard_primary_organizer_missing_from_scope')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM json_each(NEW.organizer_scope_json) AS proposed_organizer
      WHERE proposed_organizer.type <> 'text'
        OR length(trim(proposed_organizer.value)) = 0
    )
    THEN RAISE(ABORT, 'conflict_guard_invalid_organizer_scope')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT proposed_organizer.value
      FROM json_each(NEW.organizer_scope_json) AS proposed_organizer
      GROUP BY proposed_organizer.value
      HAVING count(*) > 1
    )
    THEN RAISE(ABORT, 'conflict_guard_duplicate_organizer_scope')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM events AS reserved
      WHERE reserved.organization_id = NEW.organization_id
        AND reserved.id <> NEW.id
        AND reserved.deleted_at IS NULL
        AND reserved.time_kind = 'timed'
        AND reserved.status IN ('hold', 'tentative', 'confirmed')
        AND (
          reserved.status <> 'hold'
          OR reserved.hold_expires_at
            > CAST(unixepoch('subsec') * 1000 AS INTEGER)
        )
        AND (
          reserved.starts_at_utc
            - (reserved.buffer_before_minutes * 60000)
        ) < (
          NEW.ends_at_utc
            + (NEW.buffer_after_minutes * 60000)
        )
        AND (
          NEW.starts_at_utc
            - (NEW.buffer_before_minutes * 60000)
        ) < (
          reserved.ends_at_utc
            + (reserved.buffer_after_minutes * 60000)
        )
        AND NEW.venue_id IS NOT NULL
        AND reserved.venue_id = NEW.venue_id
    )
    THEN RAISE(ABORT, 'conflict_guard_overlap_venue')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM events AS reserved
      WHERE reserved.organization_id = NEW.organization_id
        AND reserved.id <> NEW.id
        AND reserved.deleted_at IS NULL
        AND reserved.time_kind = 'timed'
        AND reserved.status IN ('hold', 'tentative', 'confirmed')
        AND (
          reserved.status <> 'hold'
          OR reserved.hold_expires_at
            > CAST(unixepoch('subsec') * 1000 AS INTEGER)
        )
        AND (
          reserved.starts_at_utc
            - (reserved.buffer_before_minutes * 60000)
        ) < (
          NEW.ends_at_utc
            + (NEW.buffer_after_minutes * 60000)
        )
        AND (
          NEW.starts_at_utc
            - (NEW.buffer_before_minutes * 60000)
        ) < (
          reserved.ends_at_utc
            + (reserved.buffer_after_minutes * 60000)
        )
        AND EXISTS (
          SELECT 1
          FROM json_each(NEW.organizer_scope_json) AS proposed_organizer
          INNER JOIN json_each(reserved.organizer_scope_json)
            AS reserved_organizer
            ON reserved_organizer.value = proposed_organizer.value
          WHERE proposed_organizer.type = 'text'
            AND reserved_organizer.type = 'text'
        )
    )
    THEN RAISE(ABORT, 'conflict_guard_overlap_organizer')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM events AS reserved
      WHERE reserved.organization_id = NEW.organization_id
        AND reserved.id <> NEW.id
        AND reserved.deleted_at IS NULL
        AND reserved.time_kind = 'timed'
        AND reserved.status IN ('hold', 'tentative', 'confirmed')
        AND (
          reserved.status <> 'hold'
          OR reserved.hold_expires_at
            > CAST(unixepoch('subsec') * 1000 AS INTEGER)
        )
        AND (
          reserved.starts_at_utc
            - (reserved.buffer_before_minutes * 60000)
        ) < (
          NEW.ends_at_utc
            + (NEW.buffer_after_minutes * 60000)
        )
        AND (
          NEW.starts_at_utc
            - (NEW.buffer_before_minutes * 60000)
        ) < (
          reserved.ends_at_utc
            + (reserved.buffer_after_minutes * 60000)
        )
    )
    THEN RAISE(ABORT, 'conflict_guard_overlap_organization')
  END;
END;
`;

const CONFLICT_GUARD_BEFORE_UPDATE_SQL = String.raw`
CREATE TRIGGER IF NOT EXISTS events_reservation_guard_before_update
BEFORE UPDATE ON events
WHEN NEW.deleted_at IS NULL
  AND NEW.status IN ('hold', 'tentative', 'confirmed')
BEGIN
  SELECT CASE
    WHEN NEW.status = 'hold'
      AND (
        NEW.hold_expires_at IS NULL
        OR NEW.hold_expires_at
          <= CAST(unixepoch('subsec') * 1000 AS INTEGER)
      )
    THEN RAISE(ABORT, 'conflict_guard_hold_expired')
  END;

  SELECT CASE
    WHEN NEW.status <> 'hold' AND NEW.hold_expires_at IS NOT NULL
    THEN RAISE(ABORT, 'conflict_guard_non_hold_expiry')
  END;

  SELECT CASE
    WHEN NEW.schedule_version <> OLD.schedule_version + 1
    THEN RAISE(ABORT, 'conflict_guard_stale_schedule_version')
  END;

  SELECT CASE
    WHEN NEW.time_kind <> 'timed'
    THEN RAISE(ABORT, 'conflict_guard_requires_normalized_timed_interval')
  END;

  SELECT CASE
    WHEN NEW.primary_organizer_profile_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.organizer_scope_json) AS proposed_organizer
        WHERE proposed_organizer.type = 'text'
          AND proposed_organizer.value = NEW.primary_organizer_profile_id
      )
    THEN RAISE(ABORT, 'conflict_guard_primary_organizer_missing_from_scope')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM json_each(NEW.organizer_scope_json) AS proposed_organizer
      WHERE proposed_organizer.type <> 'text'
        OR length(trim(proposed_organizer.value)) = 0
    )
    THEN RAISE(ABORT, 'conflict_guard_invalid_organizer_scope')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT proposed_organizer.value
      FROM json_each(NEW.organizer_scope_json) AS proposed_organizer
      GROUP BY proposed_organizer.value
      HAVING count(*) > 1
    )
    THEN RAISE(ABORT, 'conflict_guard_duplicate_organizer_scope')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM events AS reserved
      WHERE reserved.organization_id = NEW.organization_id
        AND reserved.id <> NEW.id
        AND reserved.deleted_at IS NULL
        AND reserved.time_kind = 'timed'
        AND reserved.status IN ('hold', 'tentative', 'confirmed')
        AND (
          reserved.status <> 'hold'
          OR reserved.hold_expires_at
            > CAST(unixepoch('subsec') * 1000 AS INTEGER)
        )
        AND (
          reserved.starts_at_utc
            - (reserved.buffer_before_minutes * 60000)
        ) < (
          NEW.ends_at_utc
            + (NEW.buffer_after_minutes * 60000)
        )
        AND (
          NEW.starts_at_utc
            - (NEW.buffer_before_minutes * 60000)
        ) < (
          reserved.ends_at_utc
            + (reserved.buffer_after_minutes * 60000)
        )
        AND NEW.venue_id IS NOT NULL
        AND reserved.venue_id = NEW.venue_id
    )
    THEN RAISE(ABORT, 'conflict_guard_overlap_venue')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM events AS reserved
      WHERE reserved.organization_id = NEW.organization_id
        AND reserved.id <> NEW.id
        AND reserved.deleted_at IS NULL
        AND reserved.time_kind = 'timed'
        AND reserved.status IN ('hold', 'tentative', 'confirmed')
        AND (
          reserved.status <> 'hold'
          OR reserved.hold_expires_at
            > CAST(unixepoch('subsec') * 1000 AS INTEGER)
        )
        AND (
          reserved.starts_at_utc
            - (reserved.buffer_before_minutes * 60000)
        ) < (
          NEW.ends_at_utc
            + (NEW.buffer_after_minutes * 60000)
        )
        AND (
          NEW.starts_at_utc
            - (NEW.buffer_before_minutes * 60000)
        ) < (
          reserved.ends_at_utc
            + (reserved.buffer_after_minutes * 60000)
        )
        AND EXISTS (
          SELECT 1
          FROM json_each(NEW.organizer_scope_json) AS proposed_organizer
          INNER JOIN json_each(reserved.organizer_scope_json)
            AS reserved_organizer
            ON reserved_organizer.value = proposed_organizer.value
          WHERE proposed_organizer.type = 'text'
            AND reserved_organizer.type = 'text'
        )
    )
    THEN RAISE(ABORT, 'conflict_guard_overlap_organizer')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM events AS reserved
      WHERE reserved.organization_id = NEW.organization_id
        AND reserved.id <> NEW.id
        AND reserved.deleted_at IS NULL
        AND reserved.time_kind = 'timed'
        AND reserved.status IN ('hold', 'tentative', 'confirmed')
        AND (
          reserved.status <> 'hold'
          OR reserved.hold_expires_at
            > CAST(unixepoch('subsec') * 1000 AS INTEGER)
        )
        AND (
          reserved.starts_at_utc
            - (reserved.buffer_before_minutes * 60000)
        ) < (
          NEW.ends_at_utc
            + (NEW.buffer_after_minutes * 60000)
        )
        AND (
          NEW.starts_at_utc
            - (NEW.buffer_before_minutes * 60000)
        ) < (
          reserved.ends_at_utc
            + (reserved.buffer_after_minutes * 60000)
        )
    )
    THEN RAISE(ABORT, 'conflict_guard_overlap_organization')
  END;
END;
`;

export const CONFLICT_GUARD_TRIGGER_STATEMENTS = Object.freeze([
  CONFLICT_GUARD_BEFORE_INSERT_SQL,
  CONFLICT_GUARD_BEFORE_UPDATE_SQL,
]);

/**
 * Retained as a combined proof artifact for tests and architecture review.
 * Runtime installation always prepares the two statements independently.
 */
export const CONFLICT_GUARD_SQL =
  CONFLICT_GUARD_TRIGGER_STATEMENTS.join("\n\n");
