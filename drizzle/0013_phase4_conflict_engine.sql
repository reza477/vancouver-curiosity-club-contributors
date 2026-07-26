CREATE TABLE IF NOT EXISTS `organizer_conflict_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`organizer_event_id` text NOT NULL,
	`conflicting_candidate_key` text NOT NULL,
	`conflicting_event_id` text NOT NULL,
	`conflicting_source_kind` text NOT NULL,
	`proposed_schedule_version` integer NOT NULL,
	`conflicting_schedule_version` integer NOT NULL,
	`policy_id` text NOT NULL,
	`policy_version` integer NOT NULL,
	`classification` text NOT NULL,
	`overlap_start_utc` integer NOT NULL,
	`overlap_end_utc` integer NOT NULL,
	`resources_json` text NOT NULL,
	`state_fingerprint` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`write_intent_id` text,
	`review_request_id` text,
	`detected_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organizer_event_id`) REFERENCES `organizer_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policy_id`) REFERENCES `organizer_conflict_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`write_intent_id`) REFERENCES `organizer_schedule_write_intents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_request_id`) REFERENCES `organizer_conflict_review_requests`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`detected_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organizer_conflict_incidents_versions_check" CHECK("organizer_conflict_incidents"."proposed_schedule_version" >= 1
          AND "organizer_conflict_incidents"."conflicting_schedule_version" >= 1
          AND "organizer_conflict_incidents"."policy_version" >= 1),
	CONSTRAINT "organizer_conflict_incidents_interval_check" CHECK("organizer_conflict_incidents"."overlap_end_utc" > "organizer_conflict_incidents"."overlap_start_utc"),
	CONSTRAINT "organizer_conflict_incidents_resources_check" CHECK(json_valid("organizer_conflict_incidents"."resources_json")
          AND json_type("organizer_conflict_incidents"."resources_json") = 'array'
          AND length("organizer_conflict_incidents"."resources_json") <= 4096),
	CONSTRAINT "organizer_conflict_incidents_fingerprint_check" CHECK(length("organizer_conflict_incidents"."state_fingerprint") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_conflict_incidents_pair_version_unique` ON `organizer_conflict_incidents` (`organizer_event_id`,`proposed_schedule_version`,`conflicting_candidate_key`,`conflicting_schedule_version`,`classification`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_conflict_incidents_queue_idx` ON `organizer_conflict_incidents` (`organization_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_conflict_incidents_event_idx` ON `organizer_conflict_incidents` (`organization_id`,`organizer_event_id`,`proposed_schedule_version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_conflict_incidents_conflicting_event_idx` ON `organizer_conflict_incidents` (`organization_id`,`conflicting_event_id`,`state`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_conflict_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`incident_id` text NOT NULL,
	`organizer_event_id` text NOT NULL,
	`conflicting_candidate_key` text NOT NULL,
	`proposed_schedule_version` integer NOT NULL,
	`conflicting_schedule_version` integer NOT NULL,
	`policy_id` text NOT NULL,
	`policy_version` integer NOT NULL,
	`state_fingerprint` text NOT NULL,
	`reason` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`review_request_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`invalidated_at` integer,
	`invalidated_by_profile_id` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`incident_id`) REFERENCES `organizer_conflict_incidents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organizer_event_id`) REFERENCES `organizer_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policy_id`) REFERENCES `organizer_conflict_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`review_request_id`) REFERENCES `organizer_conflict_review_requests`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`invalidated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "organizer_conflict_overrides_versions_check" CHECK("organizer_conflict_overrides"."proposed_schedule_version" >= 1
          AND "organizer_conflict_overrides"."conflicting_schedule_version" >= 1
          AND "organizer_conflict_overrides"."policy_version" >= 1),
	CONSTRAINT "organizer_conflict_overrides_fingerprint_check" CHECK(length("organizer_conflict_overrides"."state_fingerprint") = 64),
	CONSTRAINT "organizer_conflict_overrides_reason_check" CHECK(length(trim("organizer_conflict_overrides"."reason")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_conflict_overrides_active_incident_unique` ON `organizer_conflict_overrides` (`incident_id`) WHERE "organizer_conflict_overrides"."invalidated_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_conflict_overrides_event_idx` ON `organizer_conflict_overrides` (`organization_id`,`organizer_event_id`,`proposed_schedule_version`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_conflict_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`mode` text DEFAULT 'warn_reason' NOT NULL,
	`policy_version` integer DEFAULT 1 NOT NULL,
	`default_hold_hours` integer DEFAULT 72 NOT NULL,
	`nearing_expiry_hours` integer DEFAULT 24 NOT NULL,
	`updated_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organizer_conflict_policies_mode_check" CHECK("organizer_conflict_policies"."mode" IN ('warn_reason', 'require_admin_approval', 'block')),
	CONSTRAINT "organizer_conflict_policies_version_check" CHECK("organizer_conflict_policies"."policy_version" >= 1),
	CONSTRAINT "organizer_conflict_policies_hold_check" CHECK("organizer_conflict_policies"."default_hold_hours" BETWEEN 1 AND 720
          AND "organizer_conflict_policies"."nearing_expiry_hours" BETWEEN 1 AND "organizer_conflict_policies"."default_hold_hours")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_conflict_policies_org_unique` ON `organizer_conflict_policies` (`organization_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_conflict_policies_org_version_idx` ON `organizer_conflict_policies` (`organization_id`,`policy_version`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_conflict_review_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`organizer_event_id` text NOT NULL,
	`requested_planning_status` text NOT NULL,
	`requested_state_json` text NOT NULL,
	`requested_schedule_version` integer NOT NULL,
	`state_fingerprint` text NOT NULL,
	`policy_id` text NOT NULL,
	`policy_version` integer NOT NULL,
	`requester_profile_id` text NOT NULL,
	`reason` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`decided_by_profile_id` text,
	`decided_at` integer,
	`decision_note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organizer_event_id`) REFERENCES `organizer_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policy_id`) REFERENCES `organizer_conflict_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requester_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`decided_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organizer_conflict_reviews_version_check" CHECK("organizer_conflict_review_requests"."requested_schedule_version" >= 1 AND "organizer_conflict_review_requests"."policy_version" >= 1),
	CONSTRAINT "organizer_conflict_reviews_fingerprint_check" CHECK(length("organizer_conflict_review_requests"."state_fingerprint") = 64),
	CONSTRAINT "organizer_conflict_reviews_requested_state_check" CHECK(json_valid("organizer_conflict_review_requests"."requested_state_json")
          AND json_type("organizer_conflict_review_requests"."requested_state_json") = 'object'
          AND length("organizer_conflict_review_requests"."requested_state_json") <= 8192),
	CONSTRAINT "organizer_conflict_reviews_reason_check" CHECK(length(trim("organizer_conflict_review_requests"."reason")) BETWEEN 1 AND 1000),
	CONSTRAINT "organizer_conflict_reviews_state_check" CHECK((
        "organizer_conflict_review_requests"."state" = 'pending'
        AND "organizer_conflict_review_requests"."decided_by_profile_id" IS NULL
        AND "organizer_conflict_review_requests"."decided_at" IS NULL
      ) OR (
        "organizer_conflict_review_requests"."state" IN ('approved', 'rejected')
        AND "organizer_conflict_review_requests"."decided_by_profile_id" IS NOT NULL
        AND "organizer_conflict_review_requests"."decided_at" IS NOT NULL
      ) OR "organizer_conflict_review_requests"."state" = 'invalidated')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_conflict_reviews_queue_idx` ON `organizer_conflict_review_requests` (`organization_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_conflict_reviews_event_idx` ON `organizer_conflict_review_requests` (`organization_id`,`organizer_event_id`,`requested_schedule_version`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_external_reservation_intervals` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_record_id` text NOT NULL,
	`sync_source_id` text,
	`generation_id` text,
	`event_id` text NOT NULL,
	`club_id` text NOT NULL,
	`planning_status` text NOT NULL,
	`schedule_shape` text NOT NULL,
	`actual_start_utc` integer NOT NULL,
	`actual_end_utc` integer NOT NULL,
	`expanded_start_utc` integer NOT NULL,
	`expanded_end_utc` integer NOT NULL,
	`timezone` text NOT NULL,
	`all_day_start_date` text,
	`all_day_end_date_exclusive` text,
	`buffer_before_minutes` integer DEFAULT 0 NOT NULL,
	`buffer_after_minutes` integer DEFAULT 0 NOT NULL,
	`venue_id` text,
	`primary_organizer_profile_id` text,
	`organizer_scope_json` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`normalized_state_fingerprint` text NOT NULL,
	`reservation_semantic_fingerprint` text NOT NULL,
	`schedule_version` integer NOT NULL,
	`hold_expires_at` integer,
	`title` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sync_source_id`) REFERENCES `sync_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`) REFERENCES `meetup_sync_generations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`primary_organizer_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "organizer_external_reservations_source_check" CHECK((
        "organizer_external_reservation_intervals"."source_kind" = 'legacy'
        AND "organizer_external_reservation_intervals"."sync_source_id" IS NULL
        AND "organizer_external_reservation_intervals"."generation_id" IS NULL
      ) OR (
        "organizer_external_reservation_intervals"."source_kind" = 'meetup'
        AND "organizer_external_reservation_intervals"."sync_source_id" IS NOT NULL
        AND "organizer_external_reservation_intervals"."generation_id" IS NOT NULL
      )),
	CONSTRAINT "organizer_external_reservations_interval_check" CHECK("organizer_external_reservation_intervals"."actual_end_utc" > "organizer_external_reservation_intervals"."actual_start_utc"
          AND "organizer_external_reservation_intervals"."expanded_start_utc" <= "organizer_external_reservation_intervals"."actual_start_utc"
          AND "organizer_external_reservation_intervals"."expanded_end_utc" >= "organizer_external_reservation_intervals"."actual_end_utc"
          AND (
            "organizer_external_reservation_intervals"."schedule_shape" = 'timed'
            AND "organizer_external_reservation_intervals"."all_day_start_date" IS NULL
            AND "organizer_external_reservation_intervals"."all_day_end_date_exclusive" IS NULL
            OR
            "organizer_external_reservation_intervals"."schedule_shape" = 'all_day'
            AND "organizer_external_reservation_intervals"."all_day_start_date" IS NOT NULL
            AND "organizer_external_reservation_intervals"."all_day_end_date_exclusive" > "organizer_external_reservation_intervals"."all_day_start_date"
          )
          AND "organizer_external_reservation_intervals"."buffer_before_minutes" BETWEEN 0 AND 1440
          AND "organizer_external_reservation_intervals"."buffer_after_minutes" BETWEEN 0 AND 1440
          AND "organizer_external_reservation_intervals"."expanded_start_utc" =
              "organizer_external_reservation_intervals"."actual_start_utc" - ("organizer_external_reservation_intervals"."buffer_before_minutes" * 60000)
          AND "organizer_external_reservation_intervals"."expanded_end_utc" =
              "organizer_external_reservation_intervals"."actual_end_utc" + ("organizer_external_reservation_intervals"."buffer_after_minutes" * 60000)),
	CONSTRAINT "organizer_external_reservations_scope_check" CHECK(json_valid("organizer_external_reservation_intervals"."organizer_scope_json")
          AND json_type("organizer_external_reservation_intervals"."organizer_scope_json") = 'array'
          AND length("organizer_external_reservation_intervals"."organizer_scope_json") <= 4096),
	CONSTRAINT "organizer_external_reservations_version_check" CHECK("organizer_external_reservation_intervals"."schedule_version" >= 1),
	CONSTRAINT "organizer_external_reservations_fingerprint_check" CHECK(length("organizer_external_reservation_intervals"."source_fingerprint") = 64
          AND length("organizer_external_reservation_intervals"."normalized_state_fingerprint") = 64
          AND length("organizer_external_reservation_intervals"."reservation_semantic_fingerprint") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_external_reservations_source_record_unique` ON `organizer_external_reservation_intervals` (`source_kind`,`source_record_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_external_reservations_interval_idx` ON `organizer_external_reservation_intervals` (`organization_id`,`actual_start_utc`,`actual_end_utc`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_external_reservations_expanded_idx` ON `organizer_external_reservation_intervals` (`organization_id`,`expanded_start_utc`,`expanded_end_utc`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_external_reservations_source_generation_idx` ON `organizer_external_reservation_intervals` (`sync_source_id`,`generation_id`,`actual_start_utc`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_external_reservations_venue_idx` ON `organizer_external_reservation_intervals` (`organization_id`,`venue_id`,`actual_start_utc`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `meetup_snapshot_reservation_normalizations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`sync_source_id` text NOT NULL,
	`generation_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`event_id` text NOT NULL,
	`club_id` text NOT NULL,
	`planning_status` text NOT NULL,
	`schedule_shape` text NOT NULL,
	`actual_start_utc` integer NOT NULL,
	`actual_end_utc` integer NOT NULL,
	`expanded_start_utc` integer NOT NULL,
	`expanded_end_utc` integer NOT NULL,
	`timezone` text NOT NULL,
	`all_day_start_date` text,
	`all_day_end_date_exclusive` text,
	`buffer_before_minutes` integer DEFAULT 0 NOT NULL,
	`buffer_after_minutes` integer DEFAULT 0 NOT NULL,
	`venue_id` text,
	`primary_organizer_profile_id` text,
	`organizer_scope_json` text NOT NULL,
	`schedule_version` integer NOT NULL,
	`hold_expires_at` integer,
	`source_fingerprint` text NOT NULL,
	`normalized_state_fingerprint` text NOT NULL,
	`reservation_semantic_fingerprint` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sync_source_id`) REFERENCES `sync_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`) REFERENCES `meetup_sync_generations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `meetup_event_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`primary_organizer_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meetup_snapshot_reservation_normalization_status_check" CHECK("meetup_snapshot_reservation_normalizations"."planning_status" IN ('confirmed', 'tentative')),
	CONSTRAINT "meetup_snapshot_reservation_normalization_interval_check" CHECK("meetup_snapshot_reservation_normalizations"."actual_end_utc" > "meetup_snapshot_reservation_normalizations"."actual_start_utc"
          AND "meetup_snapshot_reservation_normalizations"."expanded_start_utc" =
              "meetup_snapshot_reservation_normalizations"."actual_start_utc" - ("meetup_snapshot_reservation_normalizations"."buffer_before_minutes" * 60000)
          AND "meetup_snapshot_reservation_normalizations"."expanded_end_utc" =
              "meetup_snapshot_reservation_normalizations"."actual_end_utc" + ("meetup_snapshot_reservation_normalizations"."buffer_after_minutes" * 60000)
          AND "meetup_snapshot_reservation_normalizations"."buffer_before_minutes" BETWEEN 0 AND 1440
          AND "meetup_snapshot_reservation_normalizations"."buffer_after_minutes" BETWEEN 0 AND 1440
          AND (
            "meetup_snapshot_reservation_normalizations"."schedule_shape" = 'timed'
            AND "meetup_snapshot_reservation_normalizations"."all_day_start_date" IS NULL
            AND "meetup_snapshot_reservation_normalizations"."all_day_end_date_exclusive" IS NULL
            OR
            "meetup_snapshot_reservation_normalizations"."schedule_shape" = 'all_day'
            AND "meetup_snapshot_reservation_normalizations"."all_day_start_date" IS NOT NULL
            AND "meetup_snapshot_reservation_normalizations"."all_day_end_date_exclusive" >
                "meetup_snapshot_reservation_normalizations"."all_day_start_date"
          )),
	CONSTRAINT "meetup_snapshot_reservation_normalization_scope_check" CHECK(json_valid("meetup_snapshot_reservation_normalizations"."organizer_scope_json")
          AND json_type("meetup_snapshot_reservation_normalizations"."organizer_scope_json") = 'array'
          AND length("meetup_snapshot_reservation_normalizations"."organizer_scope_json") <= 4096),
	CONSTRAINT "meetup_snapshot_reservation_normalization_fingerprint_check" CHECK(length("meetup_snapshot_reservation_normalizations"."source_fingerprint") = 64
          AND length("meetup_snapshot_reservation_normalizations"."normalized_state_fingerprint") = 64
          AND length("meetup_snapshot_reservation_normalizations"."reservation_semantic_fingerprint") = 64),
	CONSTRAINT "meetup_snapshot_reservation_normalization_version_check" CHECK("meetup_snapshot_reservation_normalizations"."schedule_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `meetup_snapshot_reservation_normalization_unique` ON `meetup_snapshot_reservation_normalizations` (`sync_source_id`,`generation_id`,`snapshot_id`,`event_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meetup_snapshot_reservation_normalization_generation_idx` ON `meetup_snapshot_reservation_normalizations` (`organization_id`,`sync_source_id`,`generation_id`,`actual_start_utc`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meetup_snapshot_reservation_normalization_event_idx` ON `meetup_snapshot_reservation_normalizations` (`organization_id`,`event_id`,`generation_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_hold_notice_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`organizer_event_id` text NOT NULL,
	`schedule_version` integer NOT NULL,
	`notice_type` text NOT NULL,
	`recipient_profile_id` text NOT NULL,
	`notification_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organizer_event_id`) REFERENCES `organizer_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organizer_hold_notice_receipts_version_check" CHECK("organizer_hold_notice_receipts"."schedule_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_hold_notice_receipts_dedupe_unique` ON `organizer_hold_notice_receipts` (`organizer_event_id`,`schedule_version`,`notice_type`,`recipient_profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_hold_notice_receipts_org_event_idx` ON `organizer_hold_notice_receipts` (`organization_id`,`organizer_event_id`,`schedule_version`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_reservation_states` (
	`organizer_event_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`club_id` text NOT NULL,
	`planning_status` text NOT NULL,
	`schedule_shape` text NOT NULL,
	`actual_start_utc` integer NOT NULL,
	`actual_end_utc` integer NOT NULL,
	`expanded_start_utc` integer NOT NULL,
	`expanded_end_utc` integer NOT NULL,
	`timezone` text NOT NULL,
	`all_day_start_date` text,
	`all_day_end_date_exclusive` text,
	`buffer_before_minutes` integer DEFAULT 0 NOT NULL,
	`buffer_after_minutes` integer DEFAULT 0 NOT NULL,
	`venue_id` text,
	`primary_organizer_profile_id` text NOT NULL,
	`organizer_scope_json` text NOT NULL,
	`hold_expires_at` integer,
	`schedule_version` integer NOT NULL,
	`policy_version` integer NOT NULL,
	`write_intent_id` text NOT NULL,
	`updated_by_profile_id` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organizer_event_id`) REFERENCES `organizer_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`primary_organizer_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`write_intent_id`) REFERENCES `organizer_schedule_write_intents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organizer_reservation_states_status_check" CHECK("organizer_reservation_states"."planning_status" IN (
        'idea', 'draft', 'tentative_hold', 'confirmed', 'cancelled',
        'completed', 'archived'
      )),
	CONSTRAINT "organizer_reservation_states_interval_check" CHECK("organizer_reservation_states"."actual_end_utc" > "organizer_reservation_states"."actual_start_utc"
          AND "organizer_reservation_states"."expanded_start_utc" <= "organizer_reservation_states"."actual_start_utc"
          AND "organizer_reservation_states"."expanded_end_utc" >= "organizer_reservation_states"."actual_end_utc"
          AND (
            "organizer_reservation_states"."schedule_shape" = 'timed'
            AND "organizer_reservation_states"."all_day_start_date" IS NULL
            AND "organizer_reservation_states"."all_day_end_date_exclusive" IS NULL
            OR
            "organizer_reservation_states"."schedule_shape" = 'all_day'
            AND "organizer_reservation_states"."all_day_start_date" IS NOT NULL
            AND "organizer_reservation_states"."all_day_end_date_exclusive" > "organizer_reservation_states"."all_day_start_date"
          )
          AND "organizer_reservation_states"."buffer_before_minutes" BETWEEN 0 AND 1440
          AND "organizer_reservation_states"."buffer_after_minutes" BETWEEN 0 AND 1440
          AND "organizer_reservation_states"."expanded_start_utc" =
              "organizer_reservation_states"."actual_start_utc" - ("organizer_reservation_states"."buffer_before_minutes" * 60000)
          AND "organizer_reservation_states"."expanded_end_utc" =
              "organizer_reservation_states"."actual_end_utc" + ("organizer_reservation_states"."buffer_after_minutes" * 60000)),
	CONSTRAINT "organizer_reservation_states_scope_check" CHECK(json_valid("organizer_reservation_states"."organizer_scope_json")
          AND json_type("organizer_reservation_states"."organizer_scope_json") = 'array'
          AND length("organizer_reservation_states"."organizer_scope_json") <= 4096),
	CONSTRAINT "organizer_reservation_states_hold_check" CHECK((
        "organizer_reservation_states"."planning_status" = 'tentative_hold'
        AND "organizer_reservation_states"."hold_expires_at" IS NOT NULL
      ) OR (
        "organizer_reservation_states"."planning_status" <> 'tentative_hold'
        AND "organizer_reservation_states"."hold_expires_at" IS NULL
      )),
	CONSTRAINT "organizer_reservation_states_version_check" CHECK("organizer_reservation_states"."schedule_version" >= 1 AND "organizer_reservation_states"."policy_version" >= 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_reservation_states_interval_idx` ON `organizer_reservation_states` (`organization_id`,`actual_start_utc`,`actual_end_utc`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_reservation_states_expanded_idx` ON `organizer_reservation_states` (`organization_id`,`expanded_start_utc`,`expanded_end_utc`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_reservation_states_venue_idx` ON `organizer_reservation_states` (`organization_id`,`venue_id`,`actual_start_utc`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_reservation_states_hold_expiry_idx` ON `organizer_reservation_states` (`organization_id`,`planning_status`,`hold_expires_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_reservation_states_club_idx` ON `organizer_reservation_states` (`organization_id`,`club_id`,`actual_start_utc`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_schedule_write_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`organizer_event_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`club_id` text NOT NULL,
	`operation` text NOT NULL,
	`planning_status` text NOT NULL,
	`schedule_shape` text NOT NULL,
	`actual_start_utc` integer,
	`actual_end_utc` integer,
	`expanded_start_utc` integer,
	`expanded_end_utc` integer,
	`timezone` text NOT NULL,
	`all_day_start_date` text,
	`all_day_end_date_exclusive` text,
	`buffer_before_minutes` integer DEFAULT 0 NOT NULL,
	`buffer_after_minutes` integer DEFAULT 0 NOT NULL,
	`venue_id` text,
	`primary_organizer_profile_id` text NOT NULL,
	`organizer_scope_json` text NOT NULL,
	`hold_expires_at` integer,
	`expected_content_version` integer NOT NULL,
	`expected_schedule_version` integer NOT NULL,
	`proposed_content_version` integer NOT NULL,
	`proposed_schedule_version` integer NOT NULL,
	`policy_id` text NOT NULL,
	`policy_version` integer NOT NULL,
	`policy_mode` text NOT NULL,
	`reason` text,
	`review_request_id` text,
	`state_fingerprint` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`primary_organizer_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`policy_id`) REFERENCES `organizer_conflict_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organizer_schedule_write_intents_status_check" CHECK("organizer_schedule_write_intents"."planning_status" IN (
        'idea', 'draft', 'tentative_hold', 'confirmed', 'cancelled',
        'completed', 'archived'
      )),
	CONSTRAINT "organizer_schedule_write_intents_policy_mode_check" CHECK("organizer_schedule_write_intents"."policy_mode" IN ('warn_reason', 'require_admin_approval', 'block')),
	CONSTRAINT "organizer_schedule_write_intents_versions_check" CHECK("organizer_schedule_write_intents"."expected_content_version" >= 0
          AND "organizer_schedule_write_intents"."expected_schedule_version" >= 0
          AND "organizer_schedule_write_intents"."proposed_content_version" >= 1
          AND "organizer_schedule_write_intents"."proposed_schedule_version" >= 1
          AND "organizer_schedule_write_intents"."policy_version" >= 1),
	CONSTRAINT "organizer_schedule_write_intents_scope_check" CHECK(json_valid("organizer_schedule_write_intents"."organizer_scope_json")
          AND json_type("organizer_schedule_write_intents"."organizer_scope_json") = 'array'
          AND length("organizer_schedule_write_intents"."organizer_scope_json") <= 4096),
	CONSTRAINT "organizer_schedule_write_intents_interval_check" CHECK((
        "organizer_schedule_write_intents"."schedule_shape" = 'unscheduled'
        AND "organizer_schedule_write_intents"."planning_status" IN ('idea', 'archived')
        AND "organizer_schedule_write_intents"."actual_start_utc" IS NULL
        AND "organizer_schedule_write_intents"."actual_end_utc" IS NULL
        AND "organizer_schedule_write_intents"."expanded_start_utc" IS NULL
        AND "organizer_schedule_write_intents"."expanded_end_utc" IS NULL
        AND "organizer_schedule_write_intents"."all_day_start_date" IS NULL
        AND "organizer_schedule_write_intents"."all_day_end_date_exclusive" IS NULL
      ) OR (
        "organizer_schedule_write_intents"."schedule_shape" = 'timed'
        AND "organizer_schedule_write_intents"."actual_start_utc" IS NOT NULL
        AND "organizer_schedule_write_intents"."actual_end_utc" > "organizer_schedule_write_intents"."actual_start_utc"
        AND "organizer_schedule_write_intents"."expanded_start_utc" IS NOT NULL
        AND "organizer_schedule_write_intents"."expanded_start_utc" <= "organizer_schedule_write_intents"."actual_start_utc"
        AND "organizer_schedule_write_intents"."expanded_end_utc" >= "organizer_schedule_write_intents"."actual_end_utc"
        AND "organizer_schedule_write_intents"."all_day_start_date" IS NULL
        AND "organizer_schedule_write_intents"."all_day_end_date_exclusive" IS NULL
      ) OR (
        "organizer_schedule_write_intents"."schedule_shape" = 'all_day'
        AND "organizer_schedule_write_intents"."actual_start_utc" IS NOT NULL
        AND "organizer_schedule_write_intents"."actual_end_utc" > "organizer_schedule_write_intents"."actual_start_utc"
        AND "organizer_schedule_write_intents"."expanded_start_utc" IS NOT NULL
        AND "organizer_schedule_write_intents"."expanded_start_utc" <= "organizer_schedule_write_intents"."actual_start_utc"
        AND "organizer_schedule_write_intents"."expanded_end_utc" >= "organizer_schedule_write_intents"."actual_end_utc"
        AND "organizer_schedule_write_intents"."all_day_start_date" IS NOT NULL
        AND "organizer_schedule_write_intents"."all_day_end_date_exclusive" > "organizer_schedule_write_intents"."all_day_start_date"
      )),
	CONSTRAINT "organizer_schedule_write_intents_buffer_check" CHECK("organizer_schedule_write_intents"."buffer_before_minutes" BETWEEN 0 AND 1440
          AND "organizer_schedule_write_intents"."buffer_after_minutes" BETWEEN 0 AND 1440
          AND (
            "organizer_schedule_write_intents"."expanded_start_utc" IS NULL
            OR "organizer_schedule_write_intents"."expanded_start_utc" =
               "organizer_schedule_write_intents"."actual_start_utc" - ("organizer_schedule_write_intents"."buffer_before_minutes" * 60000)
          )
          AND (
            "organizer_schedule_write_intents"."expanded_end_utc" IS NULL
            OR "organizer_schedule_write_intents"."expanded_end_utc" =
               "organizer_schedule_write_intents"."actual_end_utc" + ("organizer_schedule_write_intents"."buffer_after_minutes" * 60000)
          )),
	CONSTRAINT "organizer_schedule_write_intents_hold_check" CHECK((
        "organizer_schedule_write_intents"."planning_status" = 'tentative_hold'
        AND "organizer_schedule_write_intents"."schedule_shape" <> 'unscheduled'
        AND (
          "organizer_schedule_write_intents"."hold_expires_at" IS NOT NULL
          OR "organizer_schedule_write_intents"."operation" = 'soft_delete'
        )
      ) OR (
        "organizer_schedule_write_intents"."planning_status" <> 'tentative_hold'
        AND "organizer_schedule_write_intents"."hold_expires_at" IS NULL
      )),
	CONSTRAINT "organizer_schedule_write_intents_reason_check" CHECK("organizer_schedule_write_intents"."reason" IS NULL
          OR (length(trim("organizer_schedule_write_intents"."reason")) BETWEEN 1 AND 1000)),
	CONSTRAINT "organizer_schedule_write_intents_fingerprint_check" CHECK(length("organizer_schedule_write_intents"."state_fingerprint") = 64)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_schedule_write_intents_event_idx` ON `organizer_schedule_write_intents` (`organization_id`,`organizer_event_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_schedule_write_intents_actor_idx` ON `organizer_schedule_write_intents` (`organization_id`,`actor_profile_id`,`created_at`);--> statement-breakpoint
INSERT OR IGNORE INTO organizer_conflict_policies (
  id, organization_id, mode, policy_version, default_hold_hours,
  nearing_expiry_hours, updated_by_profile_id, created_at, updated_at
)
SELECT
  'phase4-policy-' || organization.id,
  organization.id,
  'warn_reason',
  1,
  72,
  24,
  owner.profile_id,
  unixepoch() * 1000,
  unixepoch() * 1000
FROM organizations AS organization
INNER JOIN organization_memberships AS owner
 ON owner.organization_id = organization.id
 AND owner.role = 'owner'
 AND owner.status = 'active'
 AND owner.deleted_at IS NULL
INNER JOIN profiles AS owner_profile
 ON owner_profile.id = owner.profile_id
 AND owner_profile.status = 'active'
 AND owner_profile.deleted_at IS NULL;
