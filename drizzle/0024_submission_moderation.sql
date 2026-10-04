CREATE TABLE IF NOT EXISTS `form_submission_moderation` (
  `submission_id` text PRIMARY KEY NOT NULL REFERENCES `form_submissions`(`id`) ON DELETE RESTRICT,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE RESTRICT,
  `folder` text NOT NULL CONSTRAINT `form_submission_moderation_folder_check` CHECK (`folder` IN ('inbox', 'spam', 'trash')),
  `version` integer NOT NULL CONSTRAINT `form_submission_moderation_version_check` CHECK (`version` >= 1),
  `reason` text NOT NULL CONSTRAINT `form_submission_moderation_reason_check` CHECK (`reason` IN ('manual', 'honeypot', 'index_registration_solicitation')),
  `email_hold_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `updated_by_profile_id` text REFERENCES `profiles`(`id`) ON DELETE RESTRICT,
  `audit_id` text REFERENCES `audit_logs`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `form_submission_moderation_time_check` CHECK (`updated_at` >= `created_at` AND `email_hold_at` = `created_at`),
  CONSTRAINT `form_submission_moderation_actor_check` CHECK ((`reason` = 'manual' AND `updated_by_profile_id` IS NOT NULL AND `audit_id` IS NOT NULL) OR (`reason` <> 'manual' AND `updated_by_profile_id` IS NULL AND `audit_id` IS NULL AND `folder` = 'spam' AND `version` = 1))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `form_submission_moderation_org_folder_idx` ON `form_submission_moderation` (`organization_id`, `folder`, `updated_at`);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `form_submission_moderation_audit_id_unique` ON `form_submission_moderation` (`audit_id`);
