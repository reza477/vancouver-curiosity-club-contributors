CREATE TABLE IF NOT EXISTS `form_submission_deduplication` (
  `submission_id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `fingerprint_hash` text NOT NULL,
  `window_started_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`submission_id`) REFERENCES `form_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `form_submission_deduplication_hash_check` CHECK(length(`fingerprint_hash`) = 64 AND `fingerprint_hash` = lower(`fingerprint_hash`) AND `fingerprint_hash` NOT GLOB '*[^0-9a-f]*'),
  CONSTRAINT `form_submission_deduplication_window_check` CHECK(`window_started_at` % 900000 = 0 AND `created_at` >= `window_started_at` AND `created_at` < `window_started_at` + 900000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `form_submission_deduplication_window_unique` ON `form_submission_deduplication` (`organization_id`, `fingerprint_hash`, `window_started_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `form_submission_retry_receipts` (
  `request_idempotency_hash` text PRIMARY KEY NOT NULL,
  `submission_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`submission_id`) REFERENCES `form_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `form_submission_retry_receipts_hash_check` CHECK(length(`request_idempotency_hash`) = 64 AND `request_idempotency_hash` = lower(`request_idempotency_hash`) AND `request_idempotency_hash` NOT GLOB '*[^0-9a-f]*')
);
