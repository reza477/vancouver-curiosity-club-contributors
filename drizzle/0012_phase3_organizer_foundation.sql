CREATE INDEX IF NOT EXISTS `events_org_club_archive_idx` ON `events` (`organization_id`,`club_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_event_organizers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`organizer_event_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`created_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organizer_event_id`) REFERENCES `organizer_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_event_organizers_event_profile_unique` ON `organizer_event_organizers` (`organizer_event_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_event_organizers_profile_idx` ON `organizer_event_organizers` (`organization_id`,`profile_id`,`deleted_at`,`organizer_event_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_event_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`organizer_event_id` text NOT NULL,
	`content_version` integer NOT NULL,
	`schedule_version` integer NOT NULL,
	`action` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organizer_event_id`) REFERENCES `organizer_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organizer_event_revisions_version_check" CHECK("organizer_event_revisions"."content_version" >= 1 AND "organizer_event_revisions"."schedule_version" >= 1),
	CONSTRAINT "organizer_event_revisions_snapshot_json_check" CHECK(json_valid("organizer_event_revisions"."snapshot_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_event_revisions_event_content_version_unique` ON `organizer_event_revisions` (`organizer_event_id`,`content_version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_event_revisions_org_event_idx` ON `organizer_event_revisions` (`organization_id`,`organizer_event_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`club_id` text NOT NULL,
	`program_id` text,
	`event_lane_id` text,
	`category_id` text,
	`venue_id` text,
	`primary_organizer_profile_id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`summary` text,
	`description` text,
	`private_notes` text,
	`private_meeting_details` text,
	`meetup_event_url` text,
	`planning_status` text DEFAULT 'idea' NOT NULL,
	`publication_status` text DEFAULT 'private' NOT NULL,
	`schedule_shape` text DEFAULT 'unscheduled' NOT NULL,
	`starts_at_utc` integer,
	`ends_at_utc` integer,
	`timezone` text DEFAULT 'America/Vancouver' NOT NULL,
	`all_day_start_date` text,
	`all_day_end_date_exclusive` text,
	`buffer_before_minutes` integer DEFAULT 0 NOT NULL,
	`buffer_after_minutes` integer DEFAULT 0 NOT NULL,
	`content_version` integer DEFAULT 1 NOT NULL,
	`schedule_version` integer DEFAULT 1 NOT NULL,
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
	FOREIGN KEY (`primary_organizer_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organizer_events_planning_status_check" CHECK("organizer_events"."planning_status" IN ('idea', 'draft', 'tentative_hold', 'confirmed', 'cancelled', 'completed', 'archived')),
	CONSTRAINT "organizer_events_publication_status_check" CHECK("organizer_events"."publication_status" IN ('private', 'scheduled', 'published', 'unpublished')),
	CONSTRAINT "organizer_events_schedule_shape_check" CHECK((
        "organizer_events"."schedule_shape" = 'unscheduled'
        AND "organizer_events"."planning_status" = 'idea'
        AND "organizer_events"."starts_at_utc" IS NULL
        AND "organizer_events"."ends_at_utc" IS NULL
        AND "organizer_events"."all_day_start_date" IS NULL
        AND "organizer_events"."all_day_end_date_exclusive" IS NULL
      ) OR (
        "organizer_events"."schedule_shape" = 'timed'
        AND "organizer_events"."starts_at_utc" IS NOT NULL
        AND "organizer_events"."ends_at_utc" IS NOT NULL
        AND "organizer_events"."ends_at_utc" > "organizer_events"."starts_at_utc"
        AND "organizer_events"."all_day_start_date" IS NULL
        AND "organizer_events"."all_day_end_date_exclusive" IS NULL
      ) OR (
        "organizer_events"."schedule_shape" = 'all_day'
        AND "organizer_events"."starts_at_utc" IS NULL
        AND "organizer_events"."ends_at_utc" IS NULL
        AND "organizer_events"."all_day_start_date" IS NOT NULL
        AND "organizer_events"."all_day_end_date_exclusive" IS NOT NULL
        AND "organizer_events"."all_day_end_date_exclusive" > "organizer_events"."all_day_start_date"
      )),
	CONSTRAINT "organizer_events_version_check" CHECK("organizer_events"."content_version" >= 1 AND "organizer_events"."schedule_version" >= 1),
	CONSTRAINT "organizer_events_buffer_check" CHECK("organizer_events"."buffer_before_minutes" >= 0 AND "organizer_events"."buffer_after_minutes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_events_org_slug_unique` ON `organizer_events` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_events_org_schedule_idx` ON `organizer_events` (`organization_id`,`deleted_at`,`schedule_shape`,`starts_at_utc`,`all_day_start_date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_events_org_status_idx` ON `organizer_events` (`organization_id`,`planning_status`,`publication_status`,`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_events_org_club_idx` ON `organizer_events` (`organization_id`,`club_id`,`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_events_primary_organizer_idx` ON `organizer_events` (`organization_id`,`primary_organizer_profile_id`,`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_profile_preferences` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`initials` text,
	`calendar_color` text,
	`workspace_display_name` text,
	`public_biography` text,
	`public_attribution_consent_draft` integer,
	`notification_preference_mode` text DEFAULT 'all_relevant' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organizer_profile_preferences_mode_check" CHECK("organizer_profile_preferences"."notification_preference_mode" IN ('all_relevant', 'important_only')),
	CONSTRAINT "organizer_profile_preferences_consent_check" CHECK("organizer_profile_preferences"."public_attribution_consent_draft" IS NULL OR "organizer_profile_preferences"."public_attribution_consent_draft" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_profile_preferences_org_profile_unique` ON `organizer_profile_preferences` (`organization_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_profile_preferences_org_idx` ON `organizer_profile_preferences` (`organization_id`,`profile_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`profile_id` text,
	`action` text NOT NULL,
	`scope_key` text NOT NULL,
	`window_started_at` integer NOT NULL,
	`window_expires_at` integer NOT NULL,
	`request_count` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organizer_rate_limits_request_count_check" CHECK("organizer_rate_limits"."request_count" >= 1),
	CONSTRAINT "organizer_rate_limits_window_check" CHECK("organizer_rate_limits"."window_expires_at" > "organizer_rate_limits"."window_started_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_rate_limits_scope_window_unique` ON `organizer_rate_limits` (`action`,`scope_key`,`window_started_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_rate_limits_active_window_idx` ON `organizer_rate_limits` (`action`,`scope_key`,`window_expires_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ownership_transfer_locks` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`actor_profile_id` text NOT NULL,
	`target_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`target_membership_id`) REFERENCES `organization_memberships`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `ownership_transfer_locks_target_unique` ON `ownership_transfer_locks` (`target_membership_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO organizer_events (
  id, organization_id, club_id, program_id, event_lane_id, category_id,
  venue_id, primary_organizer_profile_id, title, slug, summary, description,
  private_notes, private_meeting_details, meetup_event_url, planning_status,
  publication_status, schedule_shape, starts_at_utc, ends_at_utc, timezone,
  all_day_start_date, all_day_end_date_exclusive, buffer_before_minutes,
  buffer_after_minutes, content_version, schedule_version,
  created_by_profile_id, updated_by_profile_id, created_at, updated_at,
  deleted_at
)
SELECT event.id, event.organization_id, event.club_id, event.program_id,
       event.event_lane_id, event.category_id, event.venue_id,
       event.primary_organizer_profile_id, event.title, event.slug,
       event.summary, event.description, event.private_notes,
       event.private_meeting_details, NULL, event.status, 'private',
       event.time_kind, event.starts_at_utc, event.ends_at_utc, event.timezone,
       event.all_day_start_date, event.all_day_end_date_exclusive,
       event.buffer_before_minutes, event.buffer_after_minutes, 1,
       event.schedule_version, event.created_by_profile_id,
       event.updated_by_profile_id, event.created_at, event.updated_at,
       event.deleted_at
FROM events AS event
WHERE event.status IN ('idea', 'draft')
  AND event.published_at IS NULL
  AND event.primary_organizer_profile_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM external_source_links AS source_link
    WHERE source_link.organization_id = event.organization_id
      AND source_link.entity_type = 'event'
      AND source_link.entity_id = event.id
      AND source_link.deleted_at IS NULL
  )
  AND EXISTS (
    SELECT 1
    FROM clubs AS club
    WHERE club.id = event.club_id
      AND club.organization_id = event.organization_id
  )
  AND (
    event.program_id IS NULL
    OR EXISTS (
      SELECT 1 FROM programs AS program
      WHERE program.id = event.program_id
        AND program.organization_id = event.organization_id
        AND (program.club_id IS NULL OR program.club_id = event.club_id)
    )
  )
  AND (
    event.event_lane_id IS NULL
    OR EXISTS (
      SELECT 1 FROM event_lanes AS lane
      WHERE lane.id = event.event_lane_id
        AND lane.organization_id = event.organization_id
    )
  )
  AND (
    event.category_id IS NULL
    OR EXISTS (
      SELECT 1 FROM categories AS category
      WHERE category.id = event.category_id
        AND category.organization_id = event.organization_id
    )
  )
  AND (
    event.venue_id IS NULL
    OR EXISTS (
      SELECT 1 FROM venues AS venue
      WHERE venue.id = event.venue_id
        AND venue.organization_id = event.organization_id
    )
  )
  AND EXISTS (
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
  AND EXISTS (
    SELECT 1
    FROM organization_memberships AS creator_membership
    WHERE creator_membership.organization_id = event.organization_id
      AND creator_membership.profile_id = event.created_by_profile_id
  )
  AND json_type(event.organizer_scope_json) = 'array'
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(event.organizer_scope_json) AS scope
    WHERE scope.type <> 'text'
       OR trim(CAST(scope.value AS TEXT)) = ''
  )
  AND (
    SELECT count(*)
    FROM json_each(event.organizer_scope_json)
  ) = (
    SELECT count(DISTINCT CAST(scope.value AS TEXT))
    FROM json_each(event.organizer_scope_json) AS scope
  )
  AND (
    SELECT count(*)
    FROM json_each(event.organizer_scope_json) AS scope
    WHERE CAST(scope.value AS TEXT) =
          event.primary_organizer_profile_id
  ) = 1
  AND (
    SELECT count(*)
    FROM event_organizers AS association
    WHERE association.event_id = event.id
      AND association.deleted_at IS NULL
  ) = (
    SELECT count(*)
    FROM json_each(event.organizer_scope_json)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(event.organizer_scope_json) AS scope
    WHERE (
      SELECT count(*)
      FROM event_organizers AS association
      WHERE association.event_id = event.id
        AND association.organization_id = event.organization_id
        AND association.profile_id = CAST(scope.value AS TEXT)
        AND association.role = CASE
          WHEN CAST(scope.value AS TEXT) =
               event.primary_organizer_profile_id
          THEN 'primary'
          ELSE 'co_organizer'
        END
        AND association.deleted_at IS NULL
    ) <> 1
  )
  AND NOT EXISTS (
    SELECT 1
    FROM event_organizers AS association
    WHERE association.event_id = event.id
      AND association.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(event.organizer_scope_json) AS scope
        WHERE scope.type = 'text'
          AND CAST(scope.value AS TEXT) = association.profile_id
          AND association.role = CASE
            WHEN CAST(scope.value AS TEXT) =
                 event.primary_organizer_profile_id
            THEN 'primary'
            ELSE 'co_organizer'
          END
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM event_organizers AS association
    WHERE association.event_id = event.id
      AND association.deleted_at IS NULL
      AND (
        association.organization_id <> event.organization_id
        OR association.role NOT IN ('primary', 'co_organizer')
        OR (
          association.role = 'primary'
          AND association.profile_id <> event.primary_organizer_profile_id
        )
        OR (
          association.role = 'co_organizer'
          AND association.profile_id = event.primary_organizer_profile_id
        )
        OR NOT EXISTS (
          SELECT 1
          FROM profiles AS association_profile
          JOIN organization_memberships AS association_membership
            ON association_membership.profile_id = association_profile.id
           AND association_membership.organization_id = event.organization_id
           AND association_membership.status = 'active'
           AND association_membership.deleted_at IS NULL
          WHERE association_profile.id = association.profile_id
            AND association_profile.status = 'active'
            AND association_profile.deleted_at IS NULL
            AND (
              association_membership.role <> 'organizer'
              OR EXISTS (
                SELECT 1
                FROM club_memberships AS association_club_membership
                WHERE association_club_membership.organization_id =
                      event.organization_id
                  AND association_club_membership.club_id = event.club_id
                  AND association_club_membership.organization_membership_id =
                      association_membership.id
                  AND association_club_membership.profile_id =
                      association_profile.id
                  AND association_club_membership.status = 'active'
                  AND association_club_membership.deleted_at IS NULL
              )
            )
        )
        OR NOT EXISTS (
          SELECT 1
          FROM organization_memberships AS association_creator_membership
          WHERE association_creator_membership.organization_id =
                event.organization_id
            AND association_creator_membership.profile_id =
                association.created_by_profile_id
        )
      )
  )
  AND EXISTS (
    SELECT 1
    FROM organization_memberships AS updater_membership
    WHERE updater_membership.organization_id = event.organization_id
      AND updater_membership.profile_id = event.updated_by_profile_id
  )
  AND (
    event.deleted_at IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM organization_memberships AS active_updater_membership
      WHERE active_updater_membership.organization_id = event.organization_id
        AND active_updater_membership.profile_id = event.updated_by_profile_id
        AND active_updater_membership.status = 'active'
        AND active_updater_membership.deleted_at IS NULL
    )
  );
--> statement-breakpoint
INSERT OR IGNORE INTO organizer_event_organizers (
  id, organization_id, organizer_event_id, profile_id,
  created_by_profile_id, created_at, deleted_at
)
-- Active primary associations are represented by the parent row. Deleted
-- association tombstones remain preserved in the legacy table. Only the
-- complete active co-organizer set for an eligible event is copied.
SELECT 'adopted-organizer:' || association.id, association.organization_id,
       association.event_id, association.profile_id,
       association.created_by_profile_id, association.created_at,
       association.deleted_at
FROM event_organizers AS association
JOIN organizer_events AS adopted
  ON adopted.id = association.event_id
 AND adopted.organization_id = association.organization_id
WHERE association.role = 'co_organizer'
  AND association.deleted_at IS NULL
  AND association.profile_id <> adopted.primary_organizer_profile_id
  AND NOT EXISTS (
    SELECT 1
    FROM organizer_event_organizers AS existing
    WHERE existing.organizer_event_id = association.event_id
      AND existing.profile_id = association.profile_id
  );
--> statement-breakpoint
INSERT OR IGNORE INTO organizer_event_revisions (
  id, organization_id, organizer_event_id, content_version, schedule_version,
  action, snapshot_json, actor_profile_id, created_at
)
SELECT 'adopted-revision:' || event.id, event.organization_id, event.id, 1,
       event.schedule_version, 'created',
       json_object(
         'id', event.id,
         'organizationId', event.organization_id,
         'clubId', event.club_id,
         'programId', event.program_id,
         'eventLaneId', event.event_lane_id,
         'categoryId', event.category_id,
         'venueId', event.venue_id,
         'primaryOrganizerProfileId', event.primary_organizer_profile_id,
         'coOrganizerProfileIds', json(COALESCE((
           SELECT json_group_array(association.profile_id)
           FROM organizer_event_organizers AS association
           WHERE association.organization_id = event.organization_id
             AND association.organizer_event_id = event.id
             AND association.deleted_at IS NULL
         ), '[]')),
         'title', event.title,
         'slug', event.slug,
         'summary', event.summary,
         'description', event.description,
         'privateNotes', event.private_notes,
         'privateMeetingDetails', event.private_meeting_details,
         'meetupEventUrl', event.meetup_event_url,
         'planningStatus', event.planning_status,
         'publicationStatus', event.publication_status,
         'schedule', json_object(
           'shape', event.schedule_shape,
           'timeZone', event.timezone,
           'startsAtUtc', event.starts_at_utc,
           'endsAtUtc', event.ends_at_utc,
           'allDayStartDate', event.all_day_start_date,
           'allDayEndDateExclusive', event.all_day_end_date_exclusive
         ),
         'bufferBeforeMinutes', event.buffer_before_minutes,
         'bufferAfterMinutes', event.buffer_after_minutes,
         'contentVersion', event.content_version,
         'scheduleVersion', event.schedule_version,
         'createdByProfileId', event.created_by_profile_id,
         'updatedByProfileId', event.updated_by_profile_id,
         'createdAt', event.created_at,
         'updatedAt', event.updated_at,
         'deletedAt', event.deleted_at
       ),
       event.updated_by_profile_id, event.updated_at
FROM organizer_events AS event
WHERE NOT EXISTS (
  SELECT 1
  FROM organizer_event_revisions AS existing_revision
  WHERE existing_revision.organizer_event_id = event.id
    AND existing_revision.content_version = 1
);
