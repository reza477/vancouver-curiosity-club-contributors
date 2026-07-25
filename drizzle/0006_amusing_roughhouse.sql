CREATE TABLE `club_public_profiles` (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `club_public_profiles_org_club_unique` ON `club_public_profiles` (`organization_id`,`club_id`);--> statement-breakpoint
CREATE INDEX `club_public_profiles_public_featured_idx` ON `club_public_profiles` (`organization_id`,`publication_status`,`is_featured`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `club_public_profiles_lane_idx` ON `club_public_profiles` (`organization_id`,`primary_event_lane_id`,`publication_status`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `event_public_details` (
	`event_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`attendance_mode` text DEFAULT 'location_undecided' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_public_details_attendance_mode_check" CHECK("event_public_details"."attendance_mode" IN ('in_person', 'online', 'hybrid', 'location_undecided'))
);
--> statement-breakpoint
CREATE INDEX `event_public_details_org_mode_idx` ON `event_public_details` (`organization_id`,`attendance_mode`,`event_id`);