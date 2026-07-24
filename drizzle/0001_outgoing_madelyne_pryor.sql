PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`club_id` text NOT NULL,
	`program_id` text,
	`event_lane_id` text,
	`category_id` text,
	`venue_id` text,
	`primary_organizer_profile_id` text,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`summary` text,
	`description` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`time_kind` text NOT NULL,
	`starts_at_utc` integer,
	`ends_at_utc` integer,
	`timezone` text DEFAULT 'America/Vancouver' NOT NULL,
	`all_day_start_date` text,
	`all_day_end_date_exclusive` text,
	`buffer_before_minutes` integer DEFAULT 0 NOT NULL,
	`buffer_after_minutes` integer DEFAULT 0 NOT NULL,
	`organizer_scope_json` text DEFAULT '[]' NOT NULL,
	`schedule_version` integer DEFAULT 1 NOT NULL,
	`schedule_review_state` text DEFAULT 'unreviewed' NOT NULL,
	`hold_expires_at` integer,
	`private_notes` text,
	`private_meeting_details` text,
	`published_at` integer,
	`created_by_profile_id` text NOT NULL,
	`updated_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`event_lane_id`) REFERENCES `event_lanes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`primary_organizer_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "events_nonnegative_buffers_check" CHECK("__new_events"."buffer_before_minutes" >= 0 AND "__new_events"."buffer_after_minutes" >= 0),
	CONSTRAINT "events_schedule_version_check" CHECK("__new_events"."schedule_version" >= 1),
	CONSTRAINT "events_hold_expiry_shape_check" CHECK((
        "__new_events"."status" = 'hold'
        AND "__new_events"."hold_expires_at" IS NOT NULL
      ) OR (
        "__new_events"."status" <> 'hold'
        AND "__new_events"."hold_expires_at" IS NULL
      )),
	CONSTRAINT "events_organizer_scope_json_check" CHECK(json_valid("__new_events"."organizer_scope_json") AND json_type("__new_events"."organizer_scope_json") = 'array'),
	CONSTRAINT "events_time_shape_check" CHECK((
        "__new_events"."time_kind" = 'timed'
        AND "__new_events"."starts_at_utc" IS NOT NULL
        AND "__new_events"."ends_at_utc" IS NOT NULL
        AND "__new_events"."ends_at_utc" > "__new_events"."starts_at_utc"
        AND "__new_events"."all_day_start_date" IS NULL
        AND "__new_events"."all_day_end_date_exclusive" IS NULL
      ) OR (
        "__new_events"."time_kind" = 'all_day'
        AND "__new_events"."starts_at_utc" IS NULL
        AND "__new_events"."ends_at_utc" IS NULL
        AND "__new_events"."all_day_start_date" IS NOT NULL
        AND "__new_events"."all_day_end_date_exclusive" IS NOT NULL
        AND "__new_events"."all_day_end_date_exclusive" > "__new_events"."all_day_start_date"
      ))
);
--> statement-breakpoint
INSERT INTO `__new_events`("id", "organization_id", "club_id", "program_id", "event_lane_id", "category_id", "venue_id", "primary_organizer_profile_id", "title", "slug", "summary", "description", "status", "visibility", "time_kind", "starts_at_utc", "ends_at_utc", "timezone", "all_day_start_date", "all_day_end_date_exclusive", "buffer_before_minutes", "buffer_after_minutes", "organizer_scope_json", "schedule_version", "schedule_review_state", "hold_expires_at", "private_notes", "private_meeting_details", "published_at", "created_by_profile_id", "updated_by_profile_id", "created_at", "updated_at", "deleted_at") SELECT "id", "organization_id", "club_id", "program_id", "event_lane_id", "category_id", "venue_id", "primary_organizer_profile_id", "title", "slug", "summary", "description", "status", "visibility", "time_kind", "starts_at_utc", "ends_at_utc", "timezone", "all_day_start_date", "all_day_end_date_exclusive", "buffer_before_minutes", "buffer_after_minutes", "organizer_scope_json", "schedule_version", "schedule_review_state", CASE WHEN "status" = 'hold' THEN 0 ELSE NULL END, "private_notes", "private_meeting_details", "published_at", "created_by_profile_id", "updated_by_profile_id", "created_at", "updated_at", "deleted_at" FROM `events`;--> statement-breakpoint
DROP TABLE `events`;--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `events_org_slug_unique` ON `events` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX `events_public_projection_idx` ON `events` (`organization_id`,`visibility`,`status`,`published_at`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `events_timed_conflict_scan_idx` ON `events` (`organization_id`,`status`,`hold_expires_at`,`starts_at_utc`,`ends_at_utc`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `events_venue_conflict_idx` ON `events` (`organization_id`,`venue_id`,`starts_at_utc`,`ends_at_utc`);--> statement-breakpoint
CREATE INDEX `events_primary_organizer_conflict_idx` ON `events` (`organization_id`,`primary_organizer_profile_id`,`starts_at_utc`,`ends_at_utc`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `public_attribution_consent` integer DEFAULT false NOT NULL;--> statement-breakpoint
DROP TRIGGER IF EXISTS events_reservation_guard_before_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS events_reservation_guard_before_update;--> statement-breakpoint
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
END;--> statement-breakpoint
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
