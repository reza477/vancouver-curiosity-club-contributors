-- Sites-compatible final table baseline. Every statement is retry-safe.
CREATE TABLE IF NOT EXISTS `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_profile_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "audit_logs_metadata_json_check" CHECK(json_valid("audit_logs"."metadata_json"))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`color_token` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `club_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`club_id` text NOT NULL,
	`organization_membership_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`role` text DEFAULT 'organizer' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_profile_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_membership_id`) REFERENCES `organization_memberships`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `club_public_profiles` (
	`club_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`primary_event_lane_id` text NOT NULL,
	`publication_status` text DEFAULT 'draft' NOT NULL,
	`is_featured` integer DEFAULT false NOT NULL,
	`description` text,
	`public_group_url` text,
	`published_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`primary_event_lane_id`) REFERENCES `event_lanes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "club_public_profiles_published_at_check" CHECK("club_public_profiles"."publication_status" <> 'published' OR "club_public_profiles"."published_at" IS NOT NULL)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `clubs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`created_by_profile_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `community_links` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`link_type` text NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `conflict_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text NOT NULL,
	`conflicting_event_id` text NOT NULL,
	`policy_id` text,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`proposed_start_utc` integer NOT NULL,
	`proposed_end_utc` integer NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`detected_by_profile_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conflicting_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policy_id`) REFERENCES `conflict_policies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`detected_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "conflict_incidents_interval_check" CHECK("conflict_incidents"."proposed_end_utc" > "conflict_incidents"."proposed_start_utc")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `conflict_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`conflict_incident_id` text NOT NULL,
	`event_id` text NOT NULL,
	`reason` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`revoked_at` integer,
	`revoked_by_profile_id` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conflict_incident_id`) REFERENCES `conflict_incidents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`revoked_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `conflict_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`reserving_statuses_json` text DEFAULT '["hold","tentative","confirmed"]' NOT NULL,
	`block_venue_overlap` integer DEFAULT true NOT NULL,
	`block_organizer_overlap` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by_profile_id` text NOT NULL,
	`updated_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "conflict_policies_statuses_json_check" CHECK(json_valid("conflict_policies"."reserving_statuses_json") AND json_type("conflict_policies"."reserving_statuses_json") = 'array')
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `database_invariant_state` (
	`singleton_key` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`trigger_fingerprint` text NOT NULL,
	`verified_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "database_invariant_state_version_check" CHECK("database_invariant_state"."version" >= 1),
	CONSTRAINT "database_invariant_state_fingerprint_check" CHECK(length("database_invariant_state"."trigger_fingerprint") = 64)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `event_lanes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by_profile_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `event_organizers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`role` text NOT NULL,
	`is_publicly_listed` integer DEFAULT false NOT NULL,
	`created_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `event_public_details` (
	`event_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`attendance_mode` text DEFAULT 'location_undecided' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_public_details_attendance_mode_check" CHECK("event_public_details"."attendance_mode" IN ('in_person', 'online', 'hybrid', 'location_undecided'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `event_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text NOT NULL,
	`schedule_version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`reason` text,
	`actor_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "event_revisions_snapshot_json_check" CHECK(json_valid("event_revisions"."snapshot_json"))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `events` (
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
	CONSTRAINT "events_nonnegative_buffers_check" CHECK("events"."buffer_before_minutes" >= 0 AND "events"."buffer_after_minutes" >= 0),
	CONSTRAINT "events_schedule_version_check" CHECK("events"."schedule_version" >= 1),
	CONSTRAINT "events_hold_expiry_shape_check" CHECK((
        "events"."status" = 'hold'
        AND "events"."hold_expires_at" IS NOT NULL
      ) OR (
        "events"."status" <> 'hold'
        AND "events"."hold_expires_at" IS NULL
      )),
	CONSTRAINT "events_organizer_scope_json_check" CHECK(json_valid("events"."organizer_scope_json") AND json_type("events"."organizer_scope_json") = 'array'),
	CONSTRAINT "events_time_shape_check" CHECK((
        "events"."time_kind" = 'timed'
        AND "events"."starts_at_utc" IS NOT NULL
        AND "events"."ends_at_utc" IS NOT NULL
        AND "events"."ends_at_utc" > "events"."starts_at_utc"
        AND "events"."all_day_start_date" IS NULL
        AND "events"."all_day_end_date_exclusive" IS NULL
      ) OR (
        "events"."time_kind" = 'all_day'
        AND "events"."starts_at_utc" IS NULL
        AND "events"."ends_at_utc" IS NULL
        AND "events"."all_day_start_date" IS NOT NULL
        AND "events"."all_day_end_date_exclusive" IS NOT NULL
        AND "events"."all_day_end_date_exclusive" > "events"."all_day_start_date"
      ))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `external_source_links` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`source_type` text NOT NULL,
	`sync_source_id` text,
	`external_id` text NOT NULL,
	`external_url` text,
	`source_fingerprint` text,
	`source_sequence` integer,
	`source_last_modified_at` integer,
	`last_imported_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "external_source_links_meetup_source_check" CHECK("external_source_links"."source_type" <> 'meetup_ics' OR "external_source_links"."sync_source_id" IS NOT NULL)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `form_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`form_key` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`submitted_by_profile_id` text,
	`assigned_to_profile_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submitted_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assigned_to_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "form_submissions_payload_json_check" CHECK(json_valid("form_submissions"."payload_json"))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ics_subscription_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`label` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ics_subscription_tokens_hash_check" CHECK(length("ics_subscription_tokens"."token_hash") = 64)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_label` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`import_batch_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`source_payload_json` text NOT NULL,
	`normalized_payload_json` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "import_rows_source_payload_json_check" CHECK(json_valid("import_rows"."source_payload_json")),
	CONSTRAINT "import_rows_normalized_payload_json_check" CHECK("import_rows"."normalized_payload_json" IS NULL OR json_valid("import_rows"."normalized_payload_json"))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`club_id` text,
	`token_hash` text NOT NULL,
	`target_normalized_email` text NOT NULL,
	`intended_role` text NOT NULL,
	`created_by_profile_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`used_at` integer,
	`used_by_profile_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`used_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invitations_token_hash_check" CHECK(length("invitations"."token_hash") = 64),
	CONSTRAINT "invitations_target_email_check" CHECK("invitations"."target_normalized_email" = lower(trim("invitations"."target_normalized_email"))),
	CONSTRAINT "invitations_terminal_state_check" CHECK(NOT ("invitations"."revoked_at" IS NOT NULL AND "invitations"."used_at" IS NOT NULL))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`alt_text` text,
	`credit` text,
	`rights_status` text DEFAULT 'unconfirmed' NOT NULL,
	`participant_consent_status` text DEFAULT 'unconfirmed' NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	`uploaded_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "media_assets_byte_size_check" CHECK("media_assets"."byte_size" >= 0)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `meetup_event_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`sync_source_id` text NOT NULL,
	`generation_id` text NOT NULL,
	`external_id` text NOT NULL,
	`event_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`event_slug` text NOT NULL,
	`title` text NOT NULL,
	`event_url` text NOT NULL,
	`status` text NOT NULL,
	`time_kind` text NOT NULL,
	`starts_at_utc` integer,
	`ends_at_utc` integer,
	`timezone` text NOT NULL,
	`all_day_start_date` text,
	`all_day_end_date_exclusive` text,
	`source_fingerprint` text NOT NULL,
	`source_sequence` integer,
	`source_last_modified_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sync_source_id`) REFERENCES `sync_sources`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`generation_id`) REFERENCES `meetup_sync_generations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "meetup_event_snapshots_ordinal_check" CHECK("meetup_event_snapshots"."ordinal" >= 0),
	CONSTRAINT "meetup_event_snapshots_time_shape_check" CHECK((
        "meetup_event_snapshots"."time_kind" = 'timed'
        AND "meetup_event_snapshots"."starts_at_utc" IS NOT NULL
        AND "meetup_event_snapshots"."ends_at_utc" IS NOT NULL
        AND "meetup_event_snapshots"."ends_at_utc" > "meetup_event_snapshots"."starts_at_utc"
        AND "meetup_event_snapshots"."all_day_start_date" IS NULL
        AND "meetup_event_snapshots"."all_day_end_date_exclusive" IS NULL
      ) OR (
        "meetup_event_snapshots"."time_kind" = 'all_day'
        AND "meetup_event_snapshots"."starts_at_utc" IS NULL
        AND "meetup_event_snapshots"."ends_at_utc" IS NULL
        AND "meetup_event_snapshots"."all_day_start_date" IS NOT NULL
        AND "meetup_event_snapshots"."all_day_end_date_exclusive" IS NOT NULL
        AND "meetup_event_snapshots"."all_day_end_date_exclusive" > "meetup_event_snapshots"."all_day_start_date"
      ))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `meetup_sync_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`sync_source_id` text NOT NULL,
	`previous_generation_id` text,
	`snapshot_hash` text NOT NULL,
	`expected_item_count` integer NOT NULL,
	`processed_item_count` integer DEFAULT 0 NOT NULL,
	`rejected_item_count` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'staging' NOT NULL,
	`removed_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`published_at` integer,
	`failed_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sync_source_id`) REFERENCES `sync_sources`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "meetup_sync_generations_snapshot_hash_check" CHECK(length("meetup_sync_generations"."snapshot_hash") = 64),
	CONSTRAINT "meetup_sync_generations_expected_count_check" CHECK("meetup_sync_generations"."expected_item_count" >= 0),
	CONSTRAINT "meetup_sync_generations_processed_count_check" CHECK("meetup_sync_generations"."processed_item_count" >= 0 AND "meetup_sync_generations"."processed_item_count" <= "meetup_sync_generations"."expected_item_count"),
	CONSTRAINT "meetup_sync_generations_rejected_count_check" CHECK("meetup_sync_generations"."rejected_item_count" >= 0 AND "meetup_sync_generations"."rejected_item_count" <= "meetup_sync_generations"."processed_item_count"),
	CONSTRAINT "meetup_sync_generations_removed_count_check" CHECK("meetup_sync_generations"."removed_count" >= 0),
	CONSTRAINT "meetup_sync_generations_state_shape_check" CHECK((
        "meetup_sync_generations"."state" = 'published'
        AND "meetup_sync_generations"."published_at" IS NOT NULL
        AND "meetup_sync_generations"."failed_at" IS NULL
      ) OR (
        "meetup_sync_generations"."state" = 'failed'
        AND "meetup_sync_generations"."published_at" IS NULL
        AND "meetup_sync_generations"."failed_at" IS NOT NULL
      ) OR (
        "meetup_sync_generations"."state" IN ('staging', 'abandoned')
        AND "meetup_sync_generations"."published_at" IS NULL
        AND "meetup_sync_generations"."failed_at" IS NULL
      ))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `navigation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`label` text NOT NULL,
	`placement` text NOT NULL,
	`page_id` text,
	`external_url` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`created_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "navigation_items_target_check" CHECK(("navigation_items"."page_id" IS NOT NULL AND "navigation_items"."external_url" IS NULL) OR ("navigation_items"."page_id" IS NULL AND "navigation_items"."external_url" IS NOT NULL))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notification_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`notification_type` text NOT NULL,
	`channel` text DEFAULT 'in_app' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`recipient_profile_id` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notifications_payload_json_check" CHECK(json_valid("notifications"."payload_json"))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`normalized_email` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_profile_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "organization_memberships_normalized_email_check" CHECK("organization_memberships"."normalized_email" = lower(trim("organization_memberships"."normalized_email")))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`timezone` text DEFAULT 'America/Vancouver' NOT NULL,
	`owner_bootstrap_closed_at` integer,
	`owner_bootstrap_claimed_by_profile_id` text,
	`created_by_profile_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_bootstrap_claimed_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `page_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`page_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "page_revisions_snapshot_json_check" CHECK(json_valid("page_revisions"."snapshot_json"))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `page_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`page_id` text NOT NULL,
	`section_key` text NOT NULL,
	`section_type` text NOT NULL,
	`content_json` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "page_sections_content_json_check" CHECK(json_valid("page_sections"."content_json"))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`current_revision` integer DEFAULT 1 NOT NULL,
	`published_at` integer,
	`created_by_profile_id` text NOT NULL,
	`updated_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`siwc_subject` text NOT NULL,
	`normalized_email` text NOT NULL,
	`display_name` text,
	`public_attribution_consent` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "profiles_normalized_email_check" CHECK("profiles"."normalized_email" = lower(trim("profiles"."normalized_email")))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `programs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`club_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`created_by_profile_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `site_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	`updated_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "site_settings_value_json_check" CHECK(json_valid("site_settings"."value_json"))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sync_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`club_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`refresh_interval_minutes` integer DEFAULT 15 NOT NULL,
	`next_refresh_at` integer,
	`lease_token` text,
	`lease_expires_at` integer,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`last_error_at` integer,
	`last_error_code` text,
	`etag` text,
	`http_last_modified` text,
	`active_generation_id` text,
	`pending_generation_id` text,
	`pending_snapshot_hash` text,
	`pending_cursor` integer,
	`created_by_profile_id` text NOT NULL,
	`updated_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sync_sources_refresh_interval_check" CHECK("sync_sources"."refresh_interval_minutes" >= 15),
	CONSTRAINT "sync_sources_lease_shape_check" CHECK((
        "sync_sources"."lease_token" IS NULL
        AND "sync_sources"."lease_expires_at" IS NULL
      ) OR (
        "sync_sources"."lease_token" IS NOT NULL
        AND "sync_sources"."lease_expires_at" IS NOT NULL
      )),
	CONSTRAINT "sync_sources_pending_shape_check" CHECK((
        "sync_sources"."pending_generation_id" IS NULL
        AND
        "sync_sources"."pending_snapshot_hash" IS NULL
        AND "sync_sources"."pending_cursor" IS NULL
      ) OR (
        "sync_sources"."pending_generation_id" IS NOT NULL
        AND length("sync_sources"."pending_generation_id") > 0
        AND
        "sync_sources"."pending_snapshot_hash" IS NOT NULL
        AND length("sync_sources"."pending_snapshot_hash") = 64
        AND "sync_sources"."pending_cursor" IS NOT NULL
        AND "sync_sources"."pending_cursor" >= 0
      ))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `venues` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`timezone` text DEFAULT 'America/Vancouver' NOT NULL,
	`public_location_name` text,
	`public_address` text,
	`private_address` text,
	`private_directions` text,
	`accessibility_notes` text,
	`is_public` integer DEFAULT false NOT NULL,
	`created_by_profile_id` text,
	`updated_by_profile_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
