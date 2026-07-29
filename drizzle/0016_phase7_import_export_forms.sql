CREATE TABLE IF NOT EXISTS `form_submission_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`author_profile_id` text NOT NULL,
	`body_text` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`redacted_at` integer,
	`redacted_by_profile_id` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `form_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`redacted_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "form_submission_notes_body_check" CHECK(length("form_submission_notes"."body_text") BETWEEN 1 AND 4000),
	CONSTRAINT "form_submission_notes_redaction_check" CHECK(("form_submission_notes"."redacted_at" IS NULL AND "form_submission_notes"."redacted_by_profile_id" IS NULL)
          OR ("form_submission_notes"."redacted_at" IS NOT NULL AND "form_submission_notes"."redacted_by_profile_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `form_submission_notes_submission_created_idx` ON `form_submission_notes` (`organization_id`,`submission_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `form_submission_workflows` (
	`submission_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`public_reference` text NOT NULL,
	`canonical_status` text DEFAULT 'new' NOT NULL,
	`request_idempotency_hash` text NOT NULL,
	`retention_review_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`write_intent_id` text NOT NULL,
	`updated_by_profile_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`redacted_at` integer,
	`redacted_by_profile_id` text,
	FOREIGN KEY (`submission_id`) REFERENCES `form_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`redacted_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "form_submission_workflows_public_reference_check" CHECK(length("form_submission_workflows"."public_reference") BETWEEN 12 AND 64
          AND substr("form_submission_workflows"."public_reference", 1, 4) = 'VCC-'
          AND substr("form_submission_workflows"."public_reference", 5) NOT GLOB '*[^A-Z0-9-]*'),
	CONSTRAINT "form_submission_workflows_status_check" CHECK("form_submission_workflows"."canonical_status" IN ('new', 'in_review', 'responded', 'archived', 'spam')),
	CONSTRAINT "form_submission_workflows_idempotency_hash_check" CHECK(length("form_submission_workflows"."request_idempotency_hash") = 64
          AND "form_submission_workflows"."request_idempotency_hash" = lower("form_submission_workflows"."request_idempotency_hash")
          AND "form_submission_workflows"."request_idempotency_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "form_submission_workflows_version_check" CHECK("form_submission_workflows"."version" >= 1),
	CONSTRAINT "form_submission_workflows_retention_check" CHECK("form_submission_workflows"."retention_review_at" >= "form_submission_workflows"."created_at"),
	CONSTRAINT "form_submission_workflows_redaction_check" CHECK(("form_submission_workflows"."redacted_at" IS NULL AND "form_submission_workflows"."redacted_by_profile_id" IS NULL)
          OR ("form_submission_workflows"."redacted_at" IS NOT NULL AND "form_submission_workflows"."redacted_by_profile_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `form_submission_workflows_public_reference_unique` ON `form_submission_workflows` (`public_reference`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `form_submission_workflows_idempotency_unique` ON `form_submission_workflows` (`request_idempotency_hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `form_submission_workflows_org_status_retention_idx` ON `form_submission_workflows` (`organization_id`,`canonical_status`,`retention_review_at`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `form_submission_write_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`action` text NOT NULL,
	`expected_workflow_version` integer NOT NULL,
	`proposed_workflow_version` integer NOT NULL,
	`proposed_canonical_status` text NOT NULL,
	`proposed_assigned_to_profile_id` text,
	`proposed_payload_json` text NOT NULL,
	`proposed_public_reference` text,
	`proposed_request_idempotency_hash` text,
	`proposed_retention_review_at` integer,
	`actor_profile_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	`completion_audit_log_id` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposed_assigned_to_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "form_submission_write_intents_action_check" CHECK("form_submission_write_intents"."action" IN ('create', 'assign', 'status', 'redact')),
	CONSTRAINT "form_submission_write_intents_version_check" CHECK((
        "form_submission_write_intents"."action" = 'create'
        AND "form_submission_write_intents"."expected_workflow_version" = 0
        AND "form_submission_write_intents"."proposed_workflow_version" = 1
      ) OR (
        "form_submission_write_intents"."action" <> 'create'
        AND "form_submission_write_intents"."expected_workflow_version" >= 1
        AND "form_submission_write_intents"."proposed_workflow_version" =
            "form_submission_write_intents"."expected_workflow_version" + 1
      )),
	CONSTRAINT "form_submission_write_intents_status_check" CHECK("form_submission_write_intents"."proposed_canonical_status" IN (
        'new', 'in_review', 'responded', 'archived', 'spam'
      )),
	CONSTRAINT "form_submission_write_intents_payload_check" CHECK(json_valid("form_submission_write_intents"."proposed_payload_json")
          AND length("form_submission_write_intents"."proposed_payload_json") BETWEEN 2 AND 16384),
	CONSTRAINT "form_submission_write_intents_create_shape_check" CHECK((
        "form_submission_write_intents"."action" = 'create'
        AND "form_submission_write_intents"."actor_profile_id" IS NULL
        AND "form_submission_write_intents"."proposed_assigned_to_profile_id" IS NULL
        AND "form_submission_write_intents"."proposed_public_reference" IS NOT NULL
        AND "form_submission_write_intents"."proposed_request_idempotency_hash" IS NOT NULL
        AND "form_submission_write_intents"."proposed_retention_review_at" IS NOT NULL
      ) OR (
        "form_submission_write_intents"."action" <> 'create'
        AND "form_submission_write_intents"."actor_profile_id" IS NOT NULL
        AND "form_submission_write_intents"."proposed_public_reference" IS NULL
        AND "form_submission_write_intents"."proposed_request_idempotency_hash" IS NULL
        AND "form_submission_write_intents"."proposed_retention_review_at" IS NULL
      )),
	CONSTRAINT "form_submission_write_intents_reference_check" CHECK("form_submission_write_intents"."proposed_public_reference" IS NULL OR (
        length("form_submission_write_intents"."proposed_public_reference") BETWEEN 12 AND 64
        AND substr("form_submission_write_intents"."proposed_public_reference", 1, 4) = 'VCC-'
        AND substr("form_submission_write_intents"."proposed_public_reference", 5)
            NOT GLOB '*[^A-Z0-9-]*'
      )),
	CONSTRAINT "form_submission_write_intents_idempotency_check" CHECK("form_submission_write_intents"."proposed_request_idempotency_hash" IS NULL OR (
        length("form_submission_write_intents"."proposed_request_idempotency_hash") = 64
        AND "form_submission_write_intents"."proposed_request_idempotency_hash" =
            lower("form_submission_write_intents"."proposed_request_idempotency_hash")
        AND "form_submission_write_intents"."proposed_request_idempotency_hash"
            NOT GLOB '*[^0-9a-f]*'
      )),
	CONSTRAINT "form_submission_write_intents_completion_check" CHECK((
        "form_submission_write_intents"."completed_at" IS NULL
        AND "form_submission_write_intents"."completion_audit_log_id" IS NULL
      ) OR (
        "form_submission_write_intents"."completed_at" IS NOT NULL
        AND "form_submission_write_intents"."completion_audit_log_id" IS NOT NULL
        AND "form_submission_write_intents"."completed_at" >= "form_submission_write_intents"."created_at"
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `form_submission_write_intents_open_unique` ON `form_submission_write_intents` (`organization_id`,`submission_id`) WHERE "form_submission_write_intents"."completed_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `form_submission_write_intents_submission_idx` ON `form_submission_write_intents` (`organization_id`,`submission_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `import_batch_details` (
	`import_batch_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`file_sha256` text NOT NULL,
	`source_namespace` text NOT NULL,
	`template_version` integer NOT NULL,
	`parser_version` integer NOT NULL,
	`encoding` text NOT NULL,
	`delimiter` text NOT NULL,
	`column_mapping_json` text NOT NULL,
	`mapping_fingerprint` text NOT NULL,
	`preview_fingerprint` text,
	`preview_version` integer DEFAULT 0 NOT NULL,
	`total_row_count` integer DEFAULT 0 NOT NULL,
	`valid_row_count` integer DEFAULT 0 NOT NULL,
	`invalid_row_count` integer DEFAULT 0 NOT NULL,
	`warning_row_count` integer DEFAULT 0 NOT NULL,
	`selected_row_count` integer DEFAULT 0 NOT NULL,
	`imported_row_count` integer DEFAULT 0 NOT NULL,
	`skipped_row_count` integer DEFAULT 0 NOT NULL,
	`failed_row_count` integer DEFAULT 0 NOT NULL,
	`pending_row_count` integer DEFAULT 0 NOT NULL,
	`phase` text DEFAULT 'uploaded' NOT NULL,
	`outcome_code` text,
	`application_cursor` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`approved_by_profile_id` text,
	`approved_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`active_runner_version` integer,
	`active_runner_lease_hash` text,
	`active_runner_expires_at` integer,
	`source_payload_redacted_at` integer,
	`redacted_by_profile_id` text,
	`updated_by_profile_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`redacted_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "import_batch_details_file_hash_check" CHECK(length("import_batch_details"."file_sha256") = 64
          AND "import_batch_details"."file_sha256" = lower("import_batch_details"."file_sha256")
          AND "import_batch_details"."file_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "import_batch_details_source_namespace_check" CHECK(length(trim("import_batch_details"."source_namespace")) BETWEEN 1 AND 100
          AND "import_batch_details"."source_namespace" = lower(trim("import_batch_details"."source_namespace"))),
	CONSTRAINT "import_batch_details_versions_check" CHECK("import_batch_details"."template_version" >= 1
          AND "import_batch_details"."parser_version" >= 1
          AND "import_batch_details"."preview_version" >= 0
          AND "import_batch_details"."version" >= 1),
	CONSTRAINT "import_batch_details_format_check" CHECK("import_batch_details"."encoding" = 'utf-8' AND "import_batch_details"."delimiter" = ','),
	CONSTRAINT "import_batch_details_mapping_json_check" CHECK(json_valid("import_batch_details"."column_mapping_json")
          AND json_type("import_batch_details"."column_mapping_json") = 'object'),
	CONSTRAINT "import_batch_details_mapping_hash_check" CHECK(length("import_batch_details"."mapping_fingerprint") = 64
          AND "import_batch_details"."mapping_fingerprint" = lower("import_batch_details"."mapping_fingerprint")
          AND "import_batch_details"."mapping_fingerprint" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "import_batch_details_preview_hash_check" CHECK("import_batch_details"."preview_fingerprint" IS NULL OR (
        length("import_batch_details"."preview_fingerprint") = 64
        AND "import_batch_details"."preview_fingerprint" = lower("import_batch_details"."preview_fingerprint")
        AND "import_batch_details"."preview_fingerprint" NOT GLOB '*[^0-9a-f]*'
      )),
	CONSTRAINT "import_batch_details_counts_check" CHECK("import_batch_details"."total_row_count" BETWEEN 0 AND 2000
          AND "import_batch_details"."valid_row_count" BETWEEN 0 AND "import_batch_details"."total_row_count"
          AND "import_batch_details"."invalid_row_count" BETWEEN 0 AND "import_batch_details"."total_row_count"
          AND "import_batch_details"."warning_row_count" BETWEEN 0 AND "import_batch_details"."total_row_count"
          AND "import_batch_details"."selected_row_count" BETWEEN 0 AND "import_batch_details"."total_row_count"
          AND "import_batch_details"."imported_row_count" BETWEEN 0 AND "import_batch_details"."total_row_count"
          AND "import_batch_details"."skipped_row_count" BETWEEN 0 AND "import_batch_details"."total_row_count"
          AND "import_batch_details"."failed_row_count" BETWEEN 0 AND "import_batch_details"."total_row_count"
          AND "import_batch_details"."pending_row_count" BETWEEN 0 AND "import_batch_details"."total_row_count"
          AND "import_batch_details"."valid_row_count" + "import_batch_details"."invalid_row_count" =
              "import_batch_details"."total_row_count"
          AND "import_batch_details"."selected_row_count" <= "import_batch_details"."valid_row_count"
          AND "import_batch_details"."selected_row_count" + "import_batch_details"."skipped_row_count" <=
              "import_batch_details"."total_row_count"
          AND "import_batch_details"."imported_row_count" + "import_batch_details"."failed_row_count"
              + "import_batch_details"."pending_row_count" =
              "import_batch_details"."selected_row_count"),
	CONSTRAINT "import_batch_details_phase_check" CHECK("import_batch_details"."phase" IN (
        'uploaded', 'previewed', 'approved', 'applying', 'completed',
        'completed_with_errors', 'interrupted', 'failed', 'redacted'
      )),
	CONSTRAINT "import_batch_details_cursor_check" CHECK("import_batch_details"."application_cursor" BETWEEN 0 AND "import_batch_details"."total_row_count"),
	CONSTRAINT "import_batch_details_approval_shape_check" CHECK((
        "import_batch_details"."approved_at" IS NULL
        AND "import_batch_details"."approved_by_profile_id" IS NULL
      ) OR (
        "import_batch_details"."approved_at" IS NOT NULL
        AND "import_batch_details"."approved_by_profile_id" IS NOT NULL
        AND "import_batch_details"."preview_fingerprint" IS NOT NULL
        AND "import_batch_details"."preview_version" >= 1
      )),
	CONSTRAINT "import_batch_details_runner_shape_check" CHECK((
        "import_batch_details"."active_runner_version" IS NULL
        AND "import_batch_details"."active_runner_lease_hash" IS NULL
        AND "import_batch_details"."active_runner_expires_at" IS NULL
      ) OR (
        "import_batch_details"."active_runner_version" IS NOT NULL
        AND "import_batch_details"."active_runner_version" >= 1
        AND length("import_batch_details"."active_runner_lease_hash") = 64
        AND "import_batch_details"."active_runner_lease_hash" =
            lower("import_batch_details"."active_runner_lease_hash")
        AND "import_batch_details"."active_runner_lease_hash" NOT GLOB '*[^0-9a-f]*'
        AND "import_batch_details"."active_runner_expires_at" IS NOT NULL
      )),
	CONSTRAINT "import_batch_details_redaction_shape_check" CHECK((
        "import_batch_details"."source_payload_redacted_at" IS NULL
        AND "import_batch_details"."redacted_by_profile_id" IS NULL
      ) OR (
        "import_batch_details"."source_payload_redacted_at" IS NOT NULL
        AND "import_batch_details"."redacted_by_profile_id" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `import_batch_details_org_phase_idx` ON `import_batch_details` (`organization_id`,`phase`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `import_batch_details_runner_idx` ON `import_batch_details` (`organization_id`,`active_runner_expires_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `import_row_applications` (
	`import_row_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`import_batch_id` text NOT NULL,
	`normalized_row_fingerprint` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`preview_result_code` text NOT NULL,
	`preview_error_codes_json` text DEFAULT '[]' NOT NULL,
	`preview_warning_codes_json` text DEFAULT '[]' NOT NULL,
	`approval_action` text DEFAULT 'pending' NOT NULL,
	`duplicate_decision` text,
	`duplicate_reason` text,
	`conflict_decision` text,
	`conflict_reason` text,
	`target_organizer_event_id` text,
	`application_state` text DEFAULT 'previewed' NOT NULL,
	`result_code` text,
	`approved_by_profile_id` text,
	`apply_actor_profile_id` text,
	`approved_at` integer,
	`applied_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`import_row_id`) REFERENCES `import_rows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_organizer_event_id`) REFERENCES `organizer_events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approved_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`apply_actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "import_row_applications_fingerprint_check" CHECK(length("import_row_applications"."normalized_row_fingerprint") = 64
          AND "import_row_applications"."normalized_row_fingerprint" =
              lower("import_row_applications"."normalized_row_fingerprint")
          AND "import_row_applications"."normalized_row_fingerprint" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "import_row_applications_idempotency_check" CHECK(length("import_row_applications"."idempotency_key") = 64
          AND "import_row_applications"."idempotency_key" = lower("import_row_applications"."idempotency_key")
          AND "import_row_applications"."idempotency_key" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "import_row_applications_preview_json_check" CHECK(json_valid("import_row_applications"."preview_error_codes_json")
          AND json_type("import_row_applications"."preview_error_codes_json") = 'array'
          AND json_valid("import_row_applications"."preview_warning_codes_json")
          AND json_type("import_row_applications"."preview_warning_codes_json") = 'array'),
	CONSTRAINT "import_row_applications_approval_check" CHECK("import_row_applications"."approval_action" IN (
        'pending', 'selected', 'skip', 'create_separate'
      )),
	CONSTRAINT "import_row_applications_state_check" CHECK("import_row_applications"."application_state" IN (
        'previewed', 'approved', 'applying', 'imported', 'skipped',
        'failed', 'redacted'
      )),
	CONSTRAINT "import_row_applications_approval_shape_check" CHECK((
        "import_row_applications"."approval_action" = 'pending'
        AND "import_row_applications"."approved_by_profile_id" IS NULL
        AND "import_row_applications"."approved_at" IS NULL
      ) OR (
        "import_row_applications"."approval_action" <> 'pending'
        AND "import_row_applications"."approved_by_profile_id" IS NOT NULL
        AND "import_row_applications"."approved_at" IS NOT NULL
      )),
	CONSTRAINT "import_row_applications_target_shape_check" CHECK("import_row_applications"."target_organizer_event_id" IS NULL
          OR "import_row_applications"."application_state" IN ('applying', 'imported', 'skipped')),
	CONSTRAINT "import_row_applications_duplicate_reason_check" CHECK("import_row_applications"."duplicate_decision" <> 'create_separate'
          OR length(trim("import_row_applications"."duplicate_reason")) BETWEEN 1 AND 1000),
	CONSTRAINT "import_row_applications_conflict_reason_check" CHECK("import_row_applications"."conflict_decision" <> 'reason_recorded'
          OR length(trim("import_row_applications"."conflict_reason")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `import_row_applications_idempotency_unique` ON `import_row_applications` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `import_row_applications_batch_state_idx` ON `import_row_applications` (`organization_id`,`import_batch_id`,`application_state`,`import_row_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `import_row_applications_target_event_idx` ON `import_row_applications` (`organization_id`,`target_organizer_event_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `public_form_protection_keys` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`key_hex` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "public_form_protection_keys_material_check" CHECK(length("public_form_protection_keys"."key_hex") = 64
          AND "public_form_protection_keys"."key_hex" = lower("public_form_protection_keys"."key_hex")
          AND "public_form_protection_keys"."key_hex" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "public_form_protection_keys_version_check" CHECK("public_form_protection_keys"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `public_form_rate_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`action` text NOT NULL,
	`scope_key` text NOT NULL,
	`window_started_at` integer NOT NULL,
	`window_ends_at` integer NOT NULL,
	`request_count` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "public_form_rate_windows_action_check" CHECK("public_form_rate_windows"."action" IN (
        'public_form_scope_15m',
        'public_form_scope_day',
        'public_form_organization_hour'
      )),
	CONSTRAINT "public_form_rate_windows_scope_hash_check" CHECK(length("public_form_rate_windows"."scope_key") = 64
          AND "public_form_rate_windows"."scope_key" = lower("public_form_rate_windows"."scope_key")
          AND "public_form_rate_windows"."scope_key" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "public_form_rate_windows_window_check" CHECK((
        "public_form_rate_windows"."action" = 'public_form_scope_15m'
        AND "public_form_rate_windows"."window_ends_at" =
            "public_form_rate_windows"."window_started_at" + 900000
        AND "public_form_rate_windows"."window_started_at" % 900000 = 0
      ) OR (
        "public_form_rate_windows"."action" = 'public_form_scope_day'
        AND "public_form_rate_windows"."window_ends_at" =
            "public_form_rate_windows"."window_started_at" + 86400000
        AND "public_form_rate_windows"."window_started_at" % 86400000 = 0
      ) OR (
        "public_form_rate_windows"."action" = 'public_form_organization_hour'
        AND "public_form_rate_windows"."window_ends_at" =
            "public_form_rate_windows"."window_started_at" + 3600000
        AND "public_form_rate_windows"."window_started_at" % 3600000 = 0
      )),
	CONSTRAINT "public_form_rate_windows_count_check" CHECK((
        "public_form_rate_windows"."action" = 'public_form_scope_15m'
        AND "public_form_rate_windows"."request_count" BETWEEN 1 AND 5
      ) OR (
        "public_form_rate_windows"."action" = 'public_form_scope_day'
        AND "public_form_rate_windows"."request_count" BETWEEN 1 AND 20
      ) OR (
        "public_form_rate_windows"."action" = 'public_form_organization_hour'
        AND "public_form_rate_windows"."request_count" BETWEEN 1 AND 500
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `public_form_rate_windows_scope_unique` ON `public_form_rate_windows` (`organization_id`,`action`,`scope_key`,`window_started_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `public_form_rate_windows_active_idx` ON `public_form_rate_windows` (`organization_id`,`action`,`window_ends_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `event_calendar_component_revisions` (
	`organization_id` text NOT NULL,
	`scope` text NOT NULL,
	`event_key` text NOT NULL,
	`canonical_fingerprint` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`last_modified_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_calendar_component_revisions_scope_check" CHECK("event_calendar_component_revisions"."scope" IN ('public', 'private')),
	CONSTRAINT "event_calendar_component_revisions_event_key_check" CHECK(length("event_calendar_component_revisions"."event_key") BETWEEN 1 AND 255
          AND "event_calendar_component_revisions"."event_key" = trim("event_calendar_component_revisions"."event_key")),
	CONSTRAINT "event_calendar_component_revisions_fingerprint_check" CHECK(length("event_calendar_component_revisions"."canonical_fingerprint") = 64
          AND "event_calendar_component_revisions"."canonical_fingerprint" =
              lower("event_calendar_component_revisions"."canonical_fingerprint")
          AND "event_calendar_component_revisions"."canonical_fingerprint" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "event_calendar_component_revisions_sequence_check" CHECK("event_calendar_component_revisions"."sequence" BETWEEN 0 AND 2147483647),
	CONSTRAINT "event_calendar_component_revisions_timestamp_check" CHECK("event_calendar_component_revisions"."last_modified_at" BETWEEN 0 AND 8640000000000000
          AND "event_calendar_component_revisions"."created_at" BETWEEN 0 AND 8640000000000000
          AND "event_calendar_component_revisions"."updated_at" BETWEEN "event_calendar_component_revisions"."created_at"
              AND 8640000000000000
          AND "event_calendar_component_revisions"."last_modified_at" >=
              "event_calendar_component_revisions"."created_at" + ("event_calendar_component_revisions"."sequence" * 1000)
          AND "event_calendar_component_revisions"."last_modified_at" >= "event_calendar_component_revisions"."updated_at"
          AND "event_calendar_component_revisions"."last_modified_at" <=
              "event_calendar_component_revisions"."updated_at" + ("event_calendar_component_revisions"."sequence" * 1000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `event_calendar_component_revisions_identity_unique` ON `event_calendar_component_revisions` (`organization_id`,`scope`,`event_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `event_calendar_component_revisions_updated_idx` ON `event_calendar_component_revisions` (`organization_id`,`scope`,`updated_at`);
