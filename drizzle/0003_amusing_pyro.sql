PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_external_source_links` (
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
	CONSTRAINT "external_source_links_meetup_source_check" CHECK("__new_external_source_links"."source_type" <> 'meetup_ics' OR "__new_external_source_links"."sync_source_id" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_external_source_links`("id", "organization_id", "entity_type", "entity_id", "source_type", "sync_source_id", "external_id", "external_url", "source_fingerprint", "source_sequence", "source_last_modified_at", "last_imported_at", "created_at", "updated_at", "deleted_at") SELECT "id", "organization_id", "entity_type", "entity_id", "source_type", "sync_source_id", "external_id", "external_url", "source_fingerprint", "source_sequence", "source_last_modified_at", "last_imported_at", "created_at", "updated_at", "deleted_at" FROM `external_source_links`;--> statement-breakpoint
DROP TABLE `external_source_links`;--> statement-breakpoint
ALTER TABLE `__new_external_source_links` RENAME TO `external_source_links`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `external_source_links_source_unique` ON `external_source_links` (`organization_id`,`source_type`,`sync_source_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `external_source_links_entity_idx` ON `external_source_links` (`organization_id`,`entity_type`,`entity_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `external_source_links_sync_source_idx` ON `external_source_links` (`organization_id`,`sync_source_id`,`deleted_at`);--> statement-breakpoint
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
        "__new_sync_sources"."pending_snapshot_hash" IS NULL
        AND "__new_sync_sources"."pending_cursor" IS NULL
      ) OR (
        "__new_sync_sources"."pending_snapshot_hash" IS NOT NULL
        AND length("__new_sync_sources"."pending_snapshot_hash") = 64
        AND "__new_sync_sources"."pending_cursor" IS NOT NULL
        AND "__new_sync_sources"."pending_cursor" >= 0
      ))
);
--> statement-breakpoint
INSERT INTO `__new_sync_sources`("id", "organization_id", "club_id", "source_type", "source_url", "enabled", "refresh_interval_minutes", "next_refresh_at", "lease_token", "lease_expires_at", "last_attempt_at", "last_success_at", "last_error_at", "last_error_code", "etag", "http_last_modified", "pending_snapshot_hash", "pending_cursor", "created_by_profile_id", "updated_by_profile_id", "created_at", "updated_at", "deleted_at") SELECT "id", "organization_id", "club_id", "source_type", "source_url", "enabled", "refresh_interval_minutes", "next_refresh_at", "lease_token", "lease_expires_at", "last_attempt_at", "last_success_at", "last_error_at", "last_error_code", "etag", "http_last_modified", NULL, NULL, "created_by_profile_id", "updated_by_profile_id", "created_at", "updated_at", "deleted_at" FROM `sync_sources`;--> statement-breakpoint
DROP TABLE `sync_sources`;--> statement-breakpoint
ALTER TABLE `__new_sync_sources` RENAME TO `sync_sources`;--> statement-breakpoint
CREATE UNIQUE INDEX `sync_sources_org_club_type_unique` ON `sync_sources` (`organization_id`,`club_id`,`source_type`);--> statement-breakpoint
CREATE INDEX `sync_sources_due_idx` ON `sync_sources` (`enabled`,`next_refresh_at`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `sync_sources_org_club_idx` ON `sync_sources` (`organization_id`,`club_id`,`deleted_at`);
