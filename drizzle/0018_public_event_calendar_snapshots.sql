CREATE TABLE IF NOT EXISTS `public_event_calendar_snapshots` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "public_event_calendar_snapshots_key_check" CHECK(length("public_event_calendar_snapshots"."cache_key") BETWEEN 1 AND 512
          AND "public_event_calendar_snapshots"."cache_key" = trim("public_event_calendar_snapshots"."cache_key")),
	CONSTRAINT "public_event_calendar_snapshots_json_check" CHECK(json_valid("public_event_calendar_snapshots"."snapshot_json")
          AND json_type("public_event_calendar_snapshots"."snapshot_json") = 'object'
          AND length("public_event_calendar_snapshots"."snapshot_json") BETWEEN 2 AND 1000000),
	CONSTRAINT "public_event_calendar_snapshots_timestamp_check" CHECK("public_event_calendar_snapshots"."created_at" BETWEEN 0 AND 8640000000000000
          AND "public_event_calendar_snapshots"."updated_at" BETWEEN "public_event_calendar_snapshots"."created_at"
              AND 8640000000000000
          AND "public_event_calendar_snapshots"."expires_at" > "public_event_calendar_snapshots"."updated_at"
          AND "public_event_calendar_snapshots"."expires_at" <= 8640000000000000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `public_event_calendar_snapshots_org_expiry_idx` ON `public_event_calendar_snapshots` (`organization_id`,`expires_at`);
