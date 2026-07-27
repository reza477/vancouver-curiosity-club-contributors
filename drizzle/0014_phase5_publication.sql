CREATE TABLE IF NOT EXISTS `organization_publication_policies` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`organizer_self_publish_enabled` integer DEFAULT false NOT NULL,
	`updated_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organization_publication_policies_self_publish_check" CHECK("organization_publication_policies"."organizer_self_publish_enabled" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_event_public_details` (
	`organizer_event_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`attendance_mode` text DEFAULT 'location_undecided' NOT NULL,
	`public_location_name` text,
	`public_address` text,
	`public_access_note` text,
	`public_online_url` text,
	`external_map_url` text,
	`cost_text` text,
	`capacity` integer,
	`availability_state` text DEFAULT 'open' NOT NULL,
	`preparation_information` text,
	`what_to_bring` text,
	`arrival_instructions` text,
	`weather_note` text,
	`verified_accessibility_notes` text,
	`public_hosts_enabled` integer DEFAULT false NOT NULL,
	`rsvp_mode` text DEFAULT 'coming_soon' NOT NULL,
	`confirmed_meetup_event_url` text,
	`meetup_url_confirmed_by_profile_id` text,
	`meetup_url_confirmed_at` integer,
	`created_by_profile_id` text NOT NULL,
	`updated_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organizer_event_id`) REFERENCES `organizer_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meetup_url_confirmed_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organizer_event_public_details_attendance_mode_check" CHECK("organizer_event_public_details"."attendance_mode" IN ('in_person', 'online', 'hybrid', 'location_undecided')),
	CONSTRAINT "organizer_event_public_details_availability_check" CHECK("organizer_event_public_details"."availability_state" IN ('open', 'full', 'waitlist')),
	CONSTRAINT "organizer_event_public_details_capacity_check" CHECK("organizer_event_public_details"."capacity" IS NULL OR "organizer_event_public_details"."capacity" BETWEEN 1 AND 1000000),
	CONSTRAINT "organizer_event_public_details_hosts_check" CHECK("organizer_event_public_details"."public_hosts_enabled" IN (0, 1)),
	CONSTRAINT "organizer_event_public_details_rsvp_shape_check" CHECK((
        "organizer_event_public_details"."rsvp_mode" = 'coming_soon'
        AND "organizer_event_public_details"."confirmed_meetup_event_url" IS NULL
        AND "organizer_event_public_details"."meetup_url_confirmed_by_profile_id" IS NULL
        AND "organizer_event_public_details"."meetup_url_confirmed_at" IS NULL
      ) OR (
        "organizer_event_public_details"."rsvp_mode" = 'meetup'
        AND length(trim("organizer_event_public_details"."confirmed_meetup_event_url"))
            BETWEEN 1 AND 2048
        AND "organizer_event_public_details"."meetup_url_confirmed_by_profile_id" IS NOT NULL
        AND "organizer_event_public_details"."meetup_url_confirmed_at" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_event_public_details_org_event_idx` ON `organizer_event_public_details` (`organization_id`,`organizer_event_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_event_public_details_org_mode_idx` ON `organizer_event_public_details` (`organization_id`,`attendance_mode`,`organizer_event_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_event_public_hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`organizer_event_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`selected_by_profile_id` text NOT NULL,
	`selected_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organizer_event_id`) REFERENCES `organizer_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selected_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_event_public_hosts_event_profile_unique` ON `organizer_event_public_hosts` (`organizer_event_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_event_public_hosts_org_event_idx` ON `organizer_event_public_hosts` (`organization_id`,`organizer_event_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_event_public_hosts_org_profile_idx` ON `organizer_event_public_hosts` (`organization_id`,`profile_id`,`organizer_event_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_event_publication_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`organizer_event_id` text NOT NULL,
	`requested_publication_at_utc` integer NOT NULL,
	`original_timezone` text NOT NULL,
	`bound_content_version` integer NOT NULL,
	`bound_schedule_version` integer NOT NULL,
	`authorizing_profile_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempted_at` integer,
	`terminal_at` integer,
	`failure_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organizer_event_id`) REFERENCES `organizer_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`authorizing_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organizer_event_publication_jobs_versions_check" CHECK("organizer_event_publication_jobs"."bound_content_version" >= 1 AND "organizer_event_publication_jobs"."bound_schedule_version" >= 1),
	CONSTRAINT "organizer_event_publication_jobs_time_check" CHECK("organizer_event_publication_jobs"."requested_publication_at_utc" >= 0 AND length(trim("organizer_event_publication_jobs"."original_timezone")) BETWEEN 1 AND 255),
	CONSTRAINT "organizer_event_publication_jobs_state_shape_check" CHECK((
        "organizer_event_publication_jobs"."state" = 'pending'
        AND "organizer_event_publication_jobs"."terminal_at" IS NULL
        AND "organizer_event_publication_jobs"."failure_code" IS NULL
      ) OR (
        "organizer_event_publication_jobs"."state" IN ('executed', 'cancelled')
        AND "organizer_event_publication_jobs"."terminal_at" IS NOT NULL
        AND "organizer_event_publication_jobs"."failure_code" IS NULL
      ) OR (
        "organizer_event_publication_jobs"."state" IN ('invalidated', 'failed')
        AND "organizer_event_publication_jobs"."terminal_at" IS NOT NULL
        AND length(trim("organizer_event_publication_jobs"."failure_code")) BETWEEN 1 AND 64
      )),
	CONSTRAINT "organizer_event_publication_jobs_terminal_time_check" CHECK("organizer_event_publication_jobs"."terminal_at" IS NULL OR "organizer_event_publication_jobs"."terminal_at" >= "organizer_event_publication_jobs"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_event_publication_jobs_one_pending_unique` ON `organizer_event_publication_jobs` (`organizer_event_id`) WHERE "organizer_event_publication_jobs"."state" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_event_publication_jobs_due_idx` ON `organizer_event_publication_jobs` (`state`,`requested_publication_at_utc`,`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_event_publication_jobs_org_event_idx` ON `organizer_event_publication_jobs` (`organization_id`,`organizer_event_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_event_publication_state` (
	`organizer_event_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`first_published_at` integer,
	`most_recent_published_at` integer,
	`most_recent_unpublished_at` integer,
	`public_cancellation_at` integer,
	`last_mutation_actor_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organizer_event_id`) REFERENCES `organizer_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_mutation_actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organizer_event_publication_state_publish_shape_check" CHECK((
        "organizer_event_publication_state"."first_published_at" IS NULL
        AND "organizer_event_publication_state"."most_recent_published_at" IS NULL
        AND "organizer_event_publication_state"."public_cancellation_at" IS NULL
      ) OR (
        "organizer_event_publication_state"."first_published_at" IS NOT NULL
        AND "organizer_event_publication_state"."most_recent_published_at" IS NOT NULL
        AND "organizer_event_publication_state"."most_recent_published_at" >= "organizer_event_publication_state"."first_published_at"
        AND (
          "organizer_event_publication_state"."public_cancellation_at" IS NULL
          OR "organizer_event_publication_state"."public_cancellation_at" >= "organizer_event_publication_state"."first_published_at"
        )
      )),
	CONSTRAINT "organizer_event_publication_state_unpublish_check" CHECK("organizer_event_publication_state"."most_recent_unpublished_at" IS NULL OR "organizer_event_publication_state"."most_recent_unpublished_at" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_event_publication_state_org_event_idx` ON `organizer_event_publication_state` (`organization_id`,`organizer_event_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_event_publication_write_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`organizer_event_id` text NOT NULL,
	`schedule_write_intent_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`operation` text NOT NULL,
	`expected_publication_status` text NOT NULL,
	`proposed_publication_status` text NOT NULL,
	`expected_content_version` integer NOT NULL,
	`expected_schedule_version` integer NOT NULL,
	`proposed_content_version` integer NOT NULL,
	`proposed_schedule_version` integer NOT NULL,
	`public_state_fingerprint` text NOT NULL,
	`publication_job_id` text,
	`previous_publication_job_id` text,
	`execution_kind` text DEFAULT 'actor' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organizer_event_id`) REFERENCES `organizer_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`schedule_write_intent_id`) REFERENCES `organizer_schedule_write_intents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`previous_publication_job_id`) REFERENCES `organizer_event_publication_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organizer_event_publication_write_intents_operation_check" CHECK("organizer_event_publication_write_intents"."operation" IN (
        'update_public_details', 'publish', 'schedule_publication',
        'cancel_scheduled_publication', 'reconcile_publication',
        'invalidate_scheduled_publication',
        'unpublish', 'public_cancel', 'restore_cancelled',
        'update_published', 'update_scheduled', 'update_unpublished'
      )),
	CONSTRAINT "organizer_event_publication_write_intents_status_check" CHECK("organizer_event_publication_write_intents"."expected_publication_status" IN (
        'private', 'scheduled', 'published', 'unpublished'
      ) AND "organizer_event_publication_write_intents"."proposed_publication_status" IN (
        'private', 'scheduled', 'published', 'unpublished'
      )),
	CONSTRAINT "organizer_event_publication_write_intents_versions_check" CHECK("organizer_event_publication_write_intents"."expected_content_version" >= 1
          AND "organizer_event_publication_write_intents"."expected_schedule_version" >= 1
          AND "organizer_event_publication_write_intents"."proposed_content_version" =
              "organizer_event_publication_write_intents"."expected_content_version" + 1
          AND "organizer_event_publication_write_intents"."proposed_schedule_version" BETWEEN
              "organizer_event_publication_write_intents"."expected_schedule_version"
              AND "organizer_event_publication_write_intents"."expected_schedule_version" + 1),
	CONSTRAINT "organizer_event_publication_write_intents_fingerprint_check" CHECK(length("organizer_event_publication_write_intents"."public_state_fingerprint") = 64),
	CONSTRAINT "organizer_event_publication_write_intents_execution_check" CHECK("organizer_event_publication_write_intents"."execution_kind" IN ('actor', 'reconciliation')),
	CONSTRAINT "organizer_event_publication_write_intents_completion_check" CHECK("organizer_event_publication_write_intents"."completed_at" IS NULL OR "organizer_event_publication_write_intents"."completed_at" >= "organizer_event_publication_write_intents"."created_at"),
	CONSTRAINT "organizer_event_publication_write_intents_transition_check" CHECK((
        "organizer_event_publication_write_intents"."operation" = 'update_public_details'
        AND (
          "organizer_event_publication_write_intents"."proposed_publication_status" =
              "organizer_event_publication_write_intents"."expected_publication_status"
          OR (
            "organizer_event_publication_write_intents"."expected_publication_status" = 'scheduled'
            AND "organizer_event_publication_write_intents"."proposed_publication_status"
                IN ('private', 'unpublished')
          )
        )
      ) OR (
        "organizer_event_publication_write_intents"."operation" = 'publish'
        AND "organizer_event_publication_write_intents"."expected_publication_status"
            IN ('private', 'scheduled', 'unpublished')
        AND "organizer_event_publication_write_intents"."proposed_publication_status" = 'published'
      ) OR (
        "organizer_event_publication_write_intents"."operation" = 'schedule_publication'
        AND "organizer_event_publication_write_intents"."expected_publication_status"
            IN ('private', 'scheduled', 'unpublished')
        AND "organizer_event_publication_write_intents"."proposed_publication_status" = 'scheduled'
      ) OR (
        "organizer_event_publication_write_intents"."operation" = 'cancel_scheduled_publication'
        AND "organizer_event_publication_write_intents"."expected_publication_status" = 'scheduled'
        AND "organizer_event_publication_write_intents"."proposed_publication_status"
            IN ('private', 'unpublished')
      ) OR (
        "organizer_event_publication_write_intents"."operation" = 'reconcile_publication'
        AND "organizer_event_publication_write_intents"."expected_publication_status" = 'scheduled'
        AND "organizer_event_publication_write_intents"."proposed_publication_status" = 'published'
      ) OR (
        "organizer_event_publication_write_intents"."operation" = 'invalidate_scheduled_publication'
        AND "organizer_event_publication_write_intents"."expected_publication_status" = 'scheduled'
        AND "organizer_event_publication_write_intents"."proposed_publication_status" = 'unpublished'
      ) OR (
        "organizer_event_publication_write_intents"."operation" = 'unpublish'
        AND "organizer_event_publication_write_intents"."expected_publication_status" = 'published'
        AND "organizer_event_publication_write_intents"."proposed_publication_status" = 'unpublished'
      ) OR (
        "organizer_event_publication_write_intents"."operation" = 'public_cancel'
        AND (
          (
            "organizer_event_publication_write_intents"."expected_publication_status" = 'published'
            AND "organizer_event_publication_write_intents"."proposed_publication_status" = 'published'
          )
          OR (
            "organizer_event_publication_write_intents"."expected_publication_status" = 'scheduled'
            AND "organizer_event_publication_write_intents"."proposed_publication_status" = 'unpublished'
          )
          OR (
            "organizer_event_publication_write_intents"."expected_publication_status"
                IN ('private', 'unpublished')
            AND "organizer_event_publication_write_intents"."proposed_publication_status" =
                "organizer_event_publication_write_intents"."expected_publication_status"
          )
        )
      ) OR (
        "organizer_event_publication_write_intents"."operation" = 'restore_cancelled'
        AND "organizer_event_publication_write_intents"."expected_publication_status"
            IN ('private', 'published', 'unpublished')
        AND "organizer_event_publication_write_intents"."proposed_publication_status" = 'unpublished'
      ) OR (
        "organizer_event_publication_write_intents"."operation" = 'update_published'
        AND "organizer_event_publication_write_intents"."expected_publication_status" = 'published'
        AND "organizer_event_publication_write_intents"."proposed_publication_status" = 'published'
      ) OR (
        "organizer_event_publication_write_intents"."operation" = 'update_scheduled'
        AND "organizer_event_publication_write_intents"."expected_publication_status" = 'scheduled'
        AND "organizer_event_publication_write_intents"."proposed_publication_status" = 'unpublished'
      ) OR (
        "organizer_event_publication_write_intents"."operation" = 'update_unpublished'
        AND "organizer_event_publication_write_intents"."expected_publication_status" = 'unpublished'
        AND "organizer_event_publication_write_intents"."proposed_publication_status" = 'unpublished'
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_event_publication_write_intents_schedule_unique` ON `organizer_event_publication_write_intents` (`schedule_write_intent_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_event_publication_write_intents_event_open_idx` ON `organizer_event_publication_write_intents` (`organization_id`,`organizer_event_id`,`completed_at`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_event_publication_write_intents_job_idx` ON `organizer_event_publication_write_intents` (`organization_id`,`publication_job_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_event_publication_write_intents_previous_job_idx` ON `organizer_event_publication_write_intents` (`organization_id`,`previous_publication_job_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meetup_event_snapshots_org_slug_generation_idx` ON `meetup_event_snapshots` (`organization_id`,`event_slug`,`generation_id`,`status`);
