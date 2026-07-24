CREATE TABLE `audit_logs` (
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
);
--> statement-breakpoint
CREATE INDEX `audit_logs_org_entity_idx` ON `audit_logs` (`organization_id`,`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_org_actor_idx` ON `audit_logs` (`organization_id`,`actor_profile_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `categories` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_org_slug_unique` ON `categories` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX `categories_org_active_idx` ON `categories` (`organization_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `club_memberships` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `club_memberships_club_profile_unique` ON `club_memberships` (`club_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX `club_memberships_authorization_idx` ON `club_memberships` (`organization_id`,`club_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `clubs` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clubs_org_slug_unique` ON `clubs` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX `clubs_org_active_idx` ON `clubs` (`organization_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `community_links` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_links_org_url_unique` ON `community_links` (`organization_id`,`url`);--> statement-breakpoint
CREATE INDEX `community_links_public_sort_idx` ON `community_links` (`organization_id`,`is_published`,`sort_order`);--> statement-breakpoint
CREATE TABLE `conflict_incidents` (
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
);
--> statement-breakpoint
CREATE INDEX `conflict_incidents_event_state_idx` ON `conflict_incidents` (`organization_id`,`event_id`,`state`);--> statement-breakpoint
CREATE TABLE `conflict_overrides` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conflict_overrides_active_incident_unique` ON `conflict_overrides` (`conflict_incident_id`) WHERE "conflict_overrides"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX `conflict_overrides_org_event_idx` ON `conflict_overrides` (`organization_id`,`event_id`);--> statement-breakpoint
CREATE TABLE `conflict_policies` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conflict_policies_org_slug_unique` ON `conflict_policies` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX `conflict_policies_org_active_idx` ON `conflict_policies` (`organization_id`,`is_active`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `event_lanes` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_lanes_org_slug_unique` ON `event_lanes` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX `event_lanes_org_sort_idx` ON `event_lanes` (`organization_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `event_organizers` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_organizers_event_profile_unique` ON `event_organizers` (`event_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX `event_organizers_conflict_lookup_idx` ON `event_organizers` (`organization_id`,`profile_id`,`deleted_at`,`event_id`);--> statement-breakpoint
CREATE TABLE `event_revisions` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_revisions_event_version_unique` ON `event_revisions` (`event_id`,`schedule_version`);--> statement-breakpoint
CREATE INDEX `event_revisions_org_created_idx` ON `event_revisions` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `events` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_org_slug_unique` ON `events` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX `events_public_projection_idx` ON `events` (`organization_id`,`visibility`,`status`,`published_at`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `events_timed_conflict_scan_idx` ON `events` (`organization_id`,`status`,`schedule_review_state`,`starts_at_utc`,`ends_at_utc`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `events_venue_conflict_idx` ON `events` (`organization_id`,`venue_id`,`starts_at_utc`,`ends_at_utc`);--> statement-breakpoint
CREATE INDEX `events_primary_organizer_conflict_idx` ON `events` (`organization_id`,`primary_organizer_profile_id`,`starts_at_utc`,`ends_at_utc`);--> statement-breakpoint
CREATE TABLE `external_source_links` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`source_type` text NOT NULL,
	`external_id` text NOT NULL,
	`external_url` text,
	`last_imported_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_source_links_source_unique` ON `external_source_links` (`organization_id`,`source_type`,`external_id`);--> statement-breakpoint
CREATE INDEX `external_source_links_entity_idx` ON `external_source_links` (`organization_id`,`entity_type`,`entity_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `form_submissions` (
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
);
--> statement-breakpoint
CREATE INDEX `form_submissions_org_status_idx` ON `form_submissions` (`organization_id`,`form_key`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `ics_subscription_tokens` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ics_subscription_tokens_hash_unique` ON `ics_subscription_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `ics_subscription_tokens_profile_idx` ON `ics_subscription_tokens` (`organization_id`,`profile_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `import_batches` (
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
);
--> statement-breakpoint
CREATE INDEX `import_batches_org_status_idx` ON `import_batches` (`organization_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `import_rows` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_rows_batch_number_unique` ON `import_rows` (`import_batch_id`,`row_number`);--> statement-breakpoint
CREATE INDEX `import_rows_batch_status_idx` ON `import_rows` (`import_batch_id`,`status`);--> statement-breakpoint
CREATE TABLE `invitations` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitations_target_lookup_idx` ON `invitations` (`organization_id`,`target_normalized_email`,`expires_at`);--> statement-breakpoint
CREATE TABLE `media_assets` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_org_object_key_unique` ON `media_assets` (`organization_id`,`object_key`);--> statement-breakpoint
CREATE INDEX `media_assets_org_public_idx` ON `media_assets` (`organization_id`,`is_public`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `navigation_items` (
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
);
--> statement-breakpoint
CREATE INDEX `navigation_items_org_placement_sort_idx` ON `navigation_items` (`organization_id`,`placement`,`is_published`,`sort_order`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_preferences_scope_unique` ON `notification_preferences` (`organization_id`,`profile_id`,`notification_type`,`channel`);--> statement-breakpoint
CREATE TABLE `notifications` (
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
);
--> statement-breakpoint
CREATE INDEX `notifications_recipient_unread_idx` ON `notifications` (`recipient_profile_id`,`read_at`,`created_at`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `organization_memberships` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_memberships_org_profile_unique` ON `organization_memberships` (`organization_id`,`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_memberships_org_email_unique` ON `organization_memberships` (`organization_id`,`normalized_email`);--> statement-breakpoint
CREATE INDEX `organization_memberships_authorization_idx` ON `organization_memberships` (`organization_id`,`status`,`role`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `organizations` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE INDEX `organizations_deleted_at_idx` ON `organizations` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `page_revisions` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_revisions_page_number_unique` ON `page_revisions` (`page_id`,`revision_number`);--> statement-breakpoint
CREATE TABLE `page_sections` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_sections_page_key_unique` ON `page_sections` (`page_id`,`section_key`);--> statement-breakpoint
CREATE INDEX `page_sections_page_sort_idx` ON `page_sections` (`page_id`,`sort_order`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `pages` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_org_slug_unique` ON `pages` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX `pages_public_idx` ON `pages` (`organization_id`,`status`,`visibility`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`siwc_subject` text NOT NULL,
	`normalized_email` text NOT NULL,
	`display_name` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "profiles_normalized_email_check" CHECK("profiles"."normalized_email" = lower(trim("profiles"."normalized_email")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_siwc_subject_unique` ON `profiles` (`siwc_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_normalized_email_unique` ON `profiles` (`normalized_email`);--> statement-breakpoint
CREATE INDEX `profiles_status_idx` ON `profiles` (`status`);--> statement-breakpoint
CREATE TABLE `programs` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `programs_org_slug_unique` ON `programs` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX `programs_org_active_idx` ON `programs` (`organization_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `site_settings` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_settings_org_key_unique` ON `site_settings` (`organization_id`,`key`);--> statement-breakpoint
CREATE INDEX `site_settings_public_idx` ON `site_settings` (`organization_id`,`is_public`);--> statement-breakpoint
CREATE TABLE `venues` (
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
--> statement-breakpoint
CREATE UNIQUE INDEX `venues_org_slug_unique` ON `venues` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX `venues_org_public_idx` ON `venues` (`organization_id`,`is_public`,`deleted_at`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS events_reservation_guard_before_insert
BEFORE INSERT ON events
WHEN NEW.deleted_at IS NULL
  AND NEW.status IN ('hold', 'tentative', 'confirmed')
  AND NEW.schedule_review_state = 'unreviewed'
BEGIN
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
        AND reserved.schedule_review_state = 'unreviewed'
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
        AND (
          (
            NEW.venue_id IS NOT NULL
            AND reserved.venue_id = NEW.venue_id
          )
          OR EXISTS (
            SELECT 1
            FROM json_each(NEW.organizer_scope_json) AS proposed_organizer
            INNER JOIN json_each(reserved.organizer_scope_json)
              AS reserved_organizer
              ON reserved_organizer.value = proposed_organizer.value
            WHERE proposed_organizer.type = 'text'
              AND reserved_organizer.type = 'text'
          )
        )
    )
    THEN RAISE(ABORT, 'conflict_guard_overlap')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS events_reservation_guard_before_update
BEFORE UPDATE ON events
WHEN NEW.deleted_at IS NULL
  AND NEW.status IN ('hold', 'tentative', 'confirmed')
  AND NEW.schedule_review_state = 'unreviewed'
BEGIN
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
        AND reserved.schedule_review_state = 'unreviewed'
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
        AND (
          (
            NEW.venue_id IS NOT NULL
            AND reserved.venue_id = NEW.venue_id
          )
          OR EXISTS (
            SELECT 1
            FROM json_each(NEW.organizer_scope_json) AS proposed_organizer
            INNER JOIN json_each(reserved.organizer_scope_json)
              AS reserved_organizer
              ON reserved_organizer.value = proposed_organizer.value
            WHERE proposed_organizer.type = 'text'
              AND reserved_organizer.type = 'text'
          )
        )
    )
    THEN RAISE(ABORT, 'conflict_guard_overlap')
  END;
END;
