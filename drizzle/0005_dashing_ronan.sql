CREATE TABLE `meetup_event_snapshots` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meetup_event_snapshots_generation_external_unique` ON `meetup_event_snapshots` (`sync_source_id`,`generation_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `meetup_event_snapshots_public_timed_idx` ON `meetup_event_snapshots` (`organization_id`,`sync_source_id`,`generation_id`,`status`,`ends_at_utc`);--> statement-breakpoint
CREATE INDEX `meetup_event_snapshots_public_all_day_idx` ON `meetup_event_snapshots` (`organization_id`,`sync_source_id`,`generation_id`,`status`,`all_day_end_date_exclusive`);--> statement-breakpoint
CREATE INDEX `meetup_event_snapshots_event_idx` ON `meetup_event_snapshots` (`organization_id`,`event_id`);--> statement-breakpoint
CREATE TABLE `meetup_sync_generations` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meetup_sync_generations_source_hash_id_unique` ON `meetup_sync_generations` (`sync_source_id`,`snapshot_hash`,`id`);--> statement-breakpoint
CREATE INDEX `meetup_sync_generations_source_state_idx` ON `meetup_sync_generations` (`sync_source_id`,`state`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sync_sources` (
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
	CONSTRAINT "sync_sources_refresh_interval_check" CHECK("__new_sync_sources"."refresh_interval_minutes" >= 15),
	CONSTRAINT "sync_sources_lease_shape_check" CHECK((
        "__new_sync_sources"."lease_token" IS NULL
        AND "__new_sync_sources"."lease_expires_at" IS NULL
      ) OR (
        "__new_sync_sources"."lease_token" IS NOT NULL
        AND "__new_sync_sources"."lease_expires_at" IS NOT NULL
      )),
	CONSTRAINT "sync_sources_pending_shape_check" CHECK((
        "__new_sync_sources"."pending_generation_id" IS NULL
        AND
        "__new_sync_sources"."pending_snapshot_hash" IS NULL
        AND "__new_sync_sources"."pending_cursor" IS NULL
      ) OR (
        "__new_sync_sources"."pending_generation_id" IS NOT NULL
        AND length("__new_sync_sources"."pending_generation_id") > 0
        AND
        "__new_sync_sources"."pending_snapshot_hash" IS NOT NULL
        AND length("__new_sync_sources"."pending_snapshot_hash") = 64
        AND "__new_sync_sources"."pending_cursor" IS NOT NULL
        AND "__new_sync_sources"."pending_cursor" >= 0
      ))
);
--> statement-breakpoint
INSERT INTO `__new_sync_sources`("id", "organization_id", "club_id", "source_type", "source_url", "enabled", "refresh_interval_minutes", "next_refresh_at", "lease_token", "lease_expires_at", "last_attempt_at", "last_success_at", "last_error_at", "last_error_code", "etag", "http_last_modified", "active_generation_id", "pending_generation_id", "pending_snapshot_hash", "pending_cursor", "created_by_profile_id", "updated_by_profile_id", "created_at", "updated_at", "deleted_at") SELECT "id", "organization_id", "club_id", "source_type", "source_url", "enabled", "refresh_interval_minutes", "next_refresh_at", "lease_token", "lease_expires_at", "last_attempt_at", "last_success_at", "last_error_at", "last_error_code", "etag", "http_last_modified", NULL, NULL, NULL, NULL, "created_by_profile_id", "updated_by_profile_id", "created_at", "updated_at", "deleted_at" FROM `sync_sources`;--> statement-breakpoint
DROP TABLE `sync_sources`;--> statement-breakpoint
ALTER TABLE `__new_sync_sources` RENAME TO `sync_sources`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `sync_sources_org_club_type_unique` ON `sync_sources` (`organization_id`,`club_id`,`source_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_sources_org_type_url_unique` ON `sync_sources` (`organization_id`,`source_type`,`source_url`);--> statement-breakpoint
CREATE INDEX `sync_sources_due_idx` ON `sync_sources` (`enabled`,`next_refresh_at`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `sync_sources_org_club_idx` ON `sync_sources` (`organization_id`,`club_id`,`deleted_at`);
