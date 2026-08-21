CREATE TABLE `form_submission_email_outbox` (
	`submission_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`destination_key` text DEFAULT 'owner_inbox' NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`lease_token_hash` text,
	`lease_expires_at` integer,
	`provider_message_id` text,
	`last_error_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`sent_at` integer,
	`suppressed_at` integer,
	FOREIGN KEY (`submission_id`) REFERENCES `form_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "form_submission_email_outbox_destination_check" CHECK("form_submission_email_outbox"."destination_key" = 'owner_inbox'),
	CONSTRAINT "form_submission_email_outbox_state_check" CHECK("form_submission_email_outbox"."state" IN ('pending', 'leased', 'sent', 'blocked', 'suppressed')),
	CONSTRAINT "form_submission_email_outbox_attempt_check" CHECK("form_submission_email_outbox"."attempt_count" BETWEEN 0 AND 12),
	CONSTRAINT "form_submission_email_outbox_error_check" CHECK("form_submission_email_outbox"."last_error_code" IS NULL OR "form_submission_email_outbox"."last_error_code" IN (
        'configuration_missing',
        'provider_timeout',
        'provider_rate_limited',
        'provider_unavailable',
        'provider_rejected',
        'provider_invalid_response',
        'provider_concurrent_request',
        'submission_redacted'
      )),
	CONSTRAINT "form_submission_email_outbox_lease_hash_check" CHECK("form_submission_email_outbox"."lease_token_hash" IS NULL OR (
        length("form_submission_email_outbox"."lease_token_hash") = 64
        AND "form_submission_email_outbox"."lease_token_hash" = lower("form_submission_email_outbox"."lease_token_hash")
        AND "form_submission_email_outbox"."lease_token_hash" NOT GLOB '*[^0-9a-f]*'
      )),
	CONSTRAINT "form_submission_email_outbox_provider_id_check" CHECK("form_submission_email_outbox"."provider_message_id" IS NULL OR length("form_submission_email_outbox"."provider_message_id") BETWEEN 1 AND 255),
	CONSTRAINT "form_submission_email_outbox_time_check" CHECK("form_submission_email_outbox"."updated_at" >= "form_submission_email_outbox"."created_at"
          AND "form_submission_email_outbox"."next_attempt_at" >= "form_submission_email_outbox"."created_at"
          AND ("form_submission_email_outbox"."sent_at" IS NULL OR "form_submission_email_outbox"."sent_at" >= "form_submission_email_outbox"."created_at")
          AND ("form_submission_email_outbox"."suppressed_at" IS NULL OR "form_submission_email_outbox"."suppressed_at" >= "form_submission_email_outbox"."created_at")),
	CONSTRAINT "form_submission_email_outbox_shape_check" CHECK((
        "form_submission_email_outbox"."state" = 'pending'
        AND "form_submission_email_outbox"."lease_token_hash" IS NULL
        AND "form_submission_email_outbox"."lease_expires_at" IS NULL
        AND "form_submission_email_outbox"."provider_message_id" IS NULL
        AND "form_submission_email_outbox"."sent_at" IS NULL
        AND "form_submission_email_outbox"."suppressed_at" IS NULL
      ) OR (
        "form_submission_email_outbox"."state" = 'leased'
        AND "form_submission_email_outbox"."lease_token_hash" IS NOT NULL
        AND "form_submission_email_outbox"."lease_expires_at" IS NOT NULL
        AND "form_submission_email_outbox"."provider_message_id" IS NULL
        AND "form_submission_email_outbox"."sent_at" IS NULL
        AND "form_submission_email_outbox"."suppressed_at" IS NULL
      ) OR (
        "form_submission_email_outbox"."state" = 'sent'
        AND "form_submission_email_outbox"."lease_token_hash" IS NULL
        AND "form_submission_email_outbox"."lease_expires_at" IS NULL
        AND "form_submission_email_outbox"."provider_message_id" IS NOT NULL
        AND "form_submission_email_outbox"."last_error_code" IS NULL
        AND "form_submission_email_outbox"."sent_at" IS NOT NULL
        AND "form_submission_email_outbox"."suppressed_at" IS NULL
      ) OR (
        "form_submission_email_outbox"."state" = 'blocked'
        AND "form_submission_email_outbox"."lease_token_hash" IS NULL
        AND "form_submission_email_outbox"."lease_expires_at" IS NULL
        AND "form_submission_email_outbox"."provider_message_id" IS NULL
        AND "form_submission_email_outbox"."last_error_code" IS NOT NULL
        AND "form_submission_email_outbox"."sent_at" IS NULL
        AND "form_submission_email_outbox"."suppressed_at" IS NULL
      ) OR (
        "form_submission_email_outbox"."state" = 'suppressed'
        AND "form_submission_email_outbox"."lease_token_hash" IS NULL
        AND "form_submission_email_outbox"."lease_expires_at" IS NULL
        AND "form_submission_email_outbox"."provider_message_id" IS NULL
        AND "form_submission_email_outbox"."last_error_code" = 'submission_redacted'
        AND "form_submission_email_outbox"."sent_at" IS NULL
        AND "form_submission_email_outbox"."suppressed_at" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE INDEX `form_submission_email_outbox_due_idx` ON `form_submission_email_outbox` (`organization_id`,`state`,`next_attempt_at`,`created_at`);
--> statement-breakpoint
INSERT INTO form_submission_email_outbox (
  submission_id, organization_id, destination_key, state,
  attempt_count, next_attempt_at, lease_token_hash, lease_expires_at,
  provider_message_id, last_error_code, created_at, updated_at,
  sent_at, suppressed_at
)
SELECT submission.id, submission.organization_id, 'owner_inbox', 'pending',
       0, submission.created_at, NULL, NULL, NULL, NULL,
       submission.created_at, submission.created_at, NULL, NULL
FROM form_submissions AS submission
JOIN form_submission_workflows AS workflow
  ON workflow.submission_id = submission.id
 AND workflow.organization_id = submission.organization_id
WHERE submission.created_at >= 1785567600000
  AND submission.status <> 'spam'
  AND submission.deleted_at IS NULL
  AND workflow.redacted_at IS NULL
ON CONFLICT(submission_id) DO NOTHING;
