CREATE TABLE `sync_sources` (
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
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_sources_org_club_type_unique` ON `sync_sources` (`organization_id`,`club_id`,`source_type`);--> statement-breakpoint
CREATE INDEX `sync_sources_due_idx` ON `sync_sources` (`enabled`,`next_refresh_at`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `sync_sources_org_club_idx` ON `sync_sources` (`organization_id`,`club_id`,`deleted_at`);--> statement-breakpoint
ALTER TABLE `external_source_links` ADD `sync_source_id` text;--> statement-breakpoint
ALTER TABLE `external_source_links` ADD `source_fingerprint` text;--> statement-breakpoint
ALTER TABLE `external_source_links` ADD `source_sequence` integer;--> statement-breakpoint
ALTER TABLE `external_source_links` ADD `source_last_modified_at` integer;--> statement-breakpoint
CREATE INDEX `external_source_links_sync_source_idx` ON `external_source_links` (`organization_id`,`sync_source_id`,`deleted_at`);