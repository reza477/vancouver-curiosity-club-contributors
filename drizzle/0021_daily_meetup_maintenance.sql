CREATE TABLE IF NOT EXISTS `maintenance_request_receipts` (
	`request_id` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "maintenance_request_receipts_request_id_check" CHECK(length("maintenance_request_receipts"."request_id") = 36
          AND "maintenance_request_receipts"."request_id" = lower("maintenance_request_receipts"."request_id")),
	CONSTRAINT "maintenance_request_receipts_purpose_check" CHECK("maintenance_request_receipts"."purpose" = 'daily_meetup_refresh'),
	CONSTRAINT "maintenance_request_receipts_timestamp_check" CHECK("maintenance_request_receipts"."issued_at" BETWEEN 0 AND 8640000000000000
          AND "maintenance_request_receipts"."created_at" BETWEEN 0 AND 8640000000000000
          AND "maintenance_request_receipts"."expires_at" > "maintenance_request_receipts"."created_at"
          AND "maintenance_request_receipts"."expires_at" <= 8640000000000000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `maintenance_request_receipts_expiry_idx` ON `maintenance_request_receipts` (`expires_at`);
