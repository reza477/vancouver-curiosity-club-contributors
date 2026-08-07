CREATE TABLE IF NOT EXISTS `meetup_event_snapshot_public_contents` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`public_summary` text NOT NULL,
	`public_description` text NOT NULL,
	`public_description_blocks_json` text NOT NULL,
	`public_venue_name` text,
	`public_venue_address` text,
	`poster_source_url` text,
	`poster_alt_text` text,
	`poster_credit` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `meetup_event_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
