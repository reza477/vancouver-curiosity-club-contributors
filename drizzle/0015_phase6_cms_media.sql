CREATE TABLE IF NOT EXISTS `club_public_profile_details` (
	`club_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`public_display_name` text NOT NULL,
	`short_summary` text NOT NULL,
	`full_description` text NOT NULL,
	`program_type` text DEFAULT 'club' NOT NULL,
	`cover_media_asset_id` text,
	`thumbnail_media_asset_id` text,
	`image_alt_text` text,
	`theme_color` text,
	`seo_title` text,
	`meta_description` text,
	`og_media_asset_id` text,
	`participant_expectations` text,
	`preparation_information` text,
	`typical_format` text,
	`confirmed_social_links_json` text DEFAULT '[]' NOT NULL,
	`related_resources_json` text DEFAULT '[]' NOT NULL,
	`updated_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cover_media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`thumbnail_media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`og_media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "club_public_profile_details_display_name_check" CHECK(length(trim("club_public_profile_details"."public_display_name")) BETWEEN 1 AND 120),
	CONSTRAINT "club_public_profile_details_summary_check" CHECK(length("club_public_profile_details"."short_summary") BETWEEN 1 AND 500),
	CONSTRAINT "club_public_profile_details_description_check" CHECK(length("club_public_profile_details"."full_description") BETWEEN 1 AND 20000),
	CONSTRAINT "club_public_profile_details_program_type_check" CHECK("club_public_profile_details"."program_type" IN ('club', 'program', 'circle', 'series', 'other')),
	CONSTRAINT "club_public_profile_details_alt_check" CHECK("club_public_profile_details"."image_alt_text" IS NULL
          OR length("club_public_profile_details"."image_alt_text") BETWEEN 1 AND 300),
	CONSTRAINT "club_public_profile_details_theme_check" CHECK("club_public_profile_details"."theme_color" IS NULL
          OR (
            length("club_public_profile_details"."theme_color") = 7
            AND substr("club_public_profile_details"."theme_color", 1, 1) = '#'
            AND substr("club_public_profile_details"."theme_color", 2)
                NOT GLOB '*[^0-9A-Fa-f]*'
          )),
	CONSTRAINT "club_public_profile_details_seo_title_check" CHECK("club_public_profile_details"."seo_title" IS NULL
          OR length(trim("club_public_profile_details"."seo_title")) BETWEEN 1 AND 60),
	CONSTRAINT "club_public_profile_details_meta_description_check" CHECK("club_public_profile_details"."meta_description" IS NULL
          OR length(trim("club_public_profile_details"."meta_description")) BETWEEN 1 AND 160),
	CONSTRAINT "club_public_profile_details_social_links_check" CHECK(json_valid("club_public_profile_details"."confirmed_social_links_json")
          AND json_type("club_public_profile_details"."confirmed_social_links_json") = 'array'
          AND length(CAST("club_public_profile_details"."confirmed_social_links_json" AS BLOB)) <= 16384),
	CONSTRAINT "club_public_profile_details_resources_check" CHECK(json_valid("club_public_profile_details"."related_resources_json")
          AND json_type("club_public_profile_details"."related_resources_json") = 'array'
          AND length(CAST("club_public_profile_details"."related_resources_json" AS BLOB)) <= 16384)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `club_public_profile_details_org_club_unique` ON `club_public_profile_details` (`organization_id`,`club_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `club_public_profile_details_org_updated_idx` ON `club_public_profile_details` (`organization_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `club_public_profile_details_org_og_media_idx` ON `club_public_profile_details` (`organization_id`,`og_media_asset_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `program_public_profile_details` (
	`program_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`club_id` text NOT NULL,
	`primary_event_lane_id` text NOT NULL,
	`publication_status` text DEFAULT 'draft' NOT NULL,
	`is_featured` integer DEFAULT false NOT NULL,
	`display_order` integer DEFAULT 1000 NOT NULL,
	`public_display_name` text NOT NULL,
	`public_slug` text NOT NULL,
	`short_summary` text NOT NULL,
	`full_description` text NOT NULL,
	`program_type` text DEFAULT 'program' NOT NULL,
	`public_group_url` text,
	`cover_media_asset_id` text,
	`thumbnail_media_asset_id` text,
	`theme_color` text,
	`participant_expectations` text,
	`preparation_information` text,
	`typical_format` text,
	`confirmed_social_links_json` text DEFAULT '[]' NOT NULL,
	`related_resources_json` text DEFAULT '[]' NOT NULL,
	`seo_title` text,
	`meta_description` text,
	`og_media_asset_id` text,
	`updated_by_profile_id` text NOT NULL,
	`published_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`primary_event_lane_id`) REFERENCES `event_lanes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cover_media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`thumbnail_media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`og_media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "program_public_profile_details_status_check" CHECK("program_public_profile_details"."publication_status" IN ('draft', 'published', 'archived')),
	CONSTRAINT "program_public_profile_details_published_at_check" CHECK("program_public_profile_details"."publication_status" <> 'published'
          OR "program_public_profile_details"."published_at" IS NOT NULL),
	CONSTRAINT "program_public_profile_details_order_check" CHECK("program_public_profile_details"."display_order" BETWEEN 0 AND 100000),
	CONSTRAINT "program_public_profile_details_program_type_check" CHECK("program_public_profile_details"."program_type" IN ('program', 'circle', 'series', 'other')),
	CONSTRAINT "program_public_profile_details_name_check" CHECK(length(trim("program_public_profile_details"."public_display_name")) BETWEEN 1 AND 120),
	CONSTRAINT "program_public_profile_details_slug_check" CHECK(length(trim("program_public_profile_details"."public_slug")) BETWEEN 1 AND 120),
	CONSTRAINT "program_public_profile_details_summary_check" CHECK(length("program_public_profile_details"."short_summary") BETWEEN 0 AND 500),
	CONSTRAINT "program_public_profile_details_description_check" CHECK(length("program_public_profile_details"."full_description") BETWEEN 0 AND 20000),
	CONSTRAINT "program_public_profile_details_theme_check" CHECK("program_public_profile_details"."theme_color" IS NULL
          OR (
            length("program_public_profile_details"."theme_color") = 7
            AND substr("program_public_profile_details"."theme_color", 1, 1) = '#'
            AND substr("program_public_profile_details"."theme_color", 2)
                NOT GLOB '*[^0-9A-Fa-f]*'
          )),
	CONSTRAINT "program_public_profile_details_seo_title_check" CHECK("program_public_profile_details"."seo_title" IS NULL
          OR length(trim("program_public_profile_details"."seo_title")) BETWEEN 1 AND 60),
	CONSTRAINT "program_public_profile_details_meta_description_check" CHECK("program_public_profile_details"."meta_description" IS NULL
          OR length(trim("program_public_profile_details"."meta_description")) BETWEEN 1 AND 160),
	CONSTRAINT "program_public_profile_details_social_links_check" CHECK(json_valid("program_public_profile_details"."confirmed_social_links_json")
          AND json_type("program_public_profile_details"."confirmed_social_links_json") = 'array'
          AND length(CAST("program_public_profile_details"."confirmed_social_links_json" AS BLOB)) <= 16384),
	CONSTRAINT "program_public_profile_details_resources_check" CHECK(json_valid("program_public_profile_details"."related_resources_json")
          AND json_type("program_public_profile_details"."related_resources_json") = 'array'
          AND length(CAST("program_public_profile_details"."related_resources_json" AS BLOB)) <= 16384)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `program_public_profile_details_org_program_unique` ON `program_public_profile_details` (`organization_id`,`program_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `program_public_profile_details_org_slug_unique` ON `program_public_profile_details` (`organization_id`,`public_slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `program_public_profile_details_org_club_status_idx` ON `program_public_profile_details` (`organization_id`,`club_id`,`publication_status`,`is_featured`,`display_order`,`deleted_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `program_public_profile_details_org_og_media_idx` ON `program_public_profile_details` (`organization_id`,`og_media_asset_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cms_adoption_states` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`adoption_version` integer DEFAULT 1 NOT NULL,
	`source_fingerprint` text NOT NULL,
	`adopted_at` integer NOT NULL,
	`verified_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cms_adoption_states_version_check" CHECK("cms_adoption_states"."adoption_version" = 1),
	CONSTRAINT "cms_adoption_states_fingerprint_check" CHECK(length("cms_adoption_states"."source_fingerprint") = 64
          AND "cms_adoption_states"."source_fingerprint" = lower("cms_adoption_states"."source_fingerprint")
          AND "cms_adoption_states"."source_fingerprint" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "cms_adoption_states_time_check" CHECK("cms_adoption_states"."verified_at" >= "cms_adoption_states"."adopted_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cms_entity_publication_states` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_key` text NOT NULL,
	`workflow_status` text DEFAULT 'draft' NOT NULL,
	`content_version` integer DEFAULT 1 NOT NULL,
	`current_draft_revision_id` text,
	`published_revision_id` text,
	`last_editor_profile_id` text NOT NULL,
	`draft_updated_at` integer,
	`published_at` integer,
	`unpublished_at` integer,
	`adopted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_editor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cms_entity_publication_states_entity_type_check" CHECK("cms_entity_publication_states"."entity_type" IN (
        'page', 'club_public_profile', 'program_public_profile', 'community_link',
        'navigation', 'site_identity', 'legal_status'
      )),
	CONSTRAINT "cms_entity_publication_states_status_check" CHECK("cms_entity_publication_states"."workflow_status" IN (
        'draft', 'published', 'unpublished', 'archived'
      )),
	CONSTRAINT "cms_entity_publication_states_version_check" CHECK("cms_entity_publication_states"."content_version" >= 1),
	CONSTRAINT "cms_entity_publication_states_entity_key_check" CHECK(length(trim("cms_entity_publication_states"."entity_key")) BETWEEN 1 AND 160),
	CONSTRAINT "cms_entity_publication_states_revision_shape_check" CHECK((
        "cms_entity_publication_states"."workflow_status" = 'draft'
        AND "cms_entity_publication_states"."current_draft_revision_id" IS NOT NULL
      ) OR (
        "cms_entity_publication_states"."workflow_status" = 'published'
        AND "cms_entity_publication_states"."published_revision_id" IS NOT NULL
        AND "cms_entity_publication_states"."published_at" IS NOT NULL
      ) OR (
        "cms_entity_publication_states"."workflow_status" = 'unpublished'
        AND "cms_entity_publication_states"."unpublished_at" IS NOT NULL
      ) OR "cms_entity_publication_states"."workflow_status" = 'archived')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `cms_entity_publication_states_org_entity_unique` ON `cms_entity_publication_states` (`organization_id`,`entity_type`,`entity_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cms_entity_publication_states_org_status_idx` ON `cms_entity_publication_states` (`organization_id`,`entity_type`,`workflow_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cms_entity_publication_states_draft_revision_idx` ON `cms_entity_publication_states` (`organization_id`,`current_draft_revision_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cms_entity_publication_states_published_revision_idx` ON `cms_entity_publication_states` (`organization_id`,`published_revision_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cms_entity_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`publication_state_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_key` text NOT NULL,
	`revision_number` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`canonical_byte_size` integer NOT NULL,
	`restored_from_revision_id` text,
	`legacy_page_revision_id` text,
	`actor_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`publication_state_id`) REFERENCES `cms_entity_publication_states`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`legacy_page_revision_id`) REFERENCES `page_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cms_entity_revisions_entity_type_check" CHECK("cms_entity_revisions"."entity_type" IN (
        'page', 'club_public_profile', 'program_public_profile', 'community_link',
        'navigation', 'site_identity', 'legal_status'
      )),
	CONSTRAINT "cms_entity_revisions_number_check" CHECK("cms_entity_revisions"."revision_number" >= 1),
	CONSTRAINT "cms_entity_revisions_snapshot_check" CHECK(json_valid("cms_entity_revisions"."snapshot_json")
          AND json_type("cms_entity_revisions"."snapshot_json") = 'object'
          AND "cms_entity_revisions"."canonical_byte_size" =
              length(CAST("cms_entity_revisions"."snapshot_json" AS BLOB))
          AND "cms_entity_revisions"."canonical_byte_size" BETWEEN 2 AND 131072),
	CONSTRAINT "cms_entity_revisions_hash_check" CHECK(length("cms_entity_revisions"."content_hash") = 64
          AND "cms_entity_revisions"."content_hash" = lower("cms_entity_revisions"."content_hash")
          AND "cms_entity_revisions"."content_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "cms_entity_revisions_entity_key_check" CHECK(length(trim("cms_entity_revisions"."entity_key")) BETWEEN 1 AND 160)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `cms_entity_revisions_state_number_unique` ON `cms_entity_revisions` (`publication_state_id`,`revision_number`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cms_entity_revisions_org_entity_idx` ON `cms_entity_revisions` (`organization_id`,`entity_type`,`entity_key`,`revision_number`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cms_entity_revisions_restore_idx` ON `cms_entity_revisions` (`organization_id`,`restored_from_revision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `cms_entity_revisions_legacy_page_unique` ON `cms_entity_revisions` (`legacy_page_revision_id`) WHERE "cms_entity_revisions"."legacy_page_revision_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cms_public_materialization_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`publication_state_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_key` text NOT NULL,
	`revision_id` text NOT NULL,
	`revision_hash` text NOT NULL,
	`projection_json` text NOT NULL,
	`canonical_byte_size` integer NOT NULL,
	`actor_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`publication_state_id`) REFERENCES `cms_entity_publication_states`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `cms_entity_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cms_public_materialization_receipts_entity_type_check" CHECK("cms_public_materialization_receipts"."entity_type" IN (
        'page', 'club_public_profile', 'program_public_profile',
        'community_link', 'navigation', 'site_identity', 'legal_status'
      )),
	CONSTRAINT "cms_public_materialization_receipts_projection_check" CHECK(json_valid("cms_public_materialization_receipts"."projection_json")
          AND json_type("cms_public_materialization_receipts"."projection_json") = 'object'
          AND "cms_public_materialization_receipts"."canonical_byte_size" =
              length(CAST("cms_public_materialization_receipts"."projection_json" AS BLOB))
          AND "cms_public_materialization_receipts"."canonical_byte_size" BETWEEN 2 AND 131072),
	CONSTRAINT "cms_public_materialization_receipts_hash_check" CHECK(length("cms_public_materialization_receipts"."revision_hash") = 64
          AND "cms_public_materialization_receipts"."revision_hash" = lower("cms_public_materialization_receipts"."revision_hash")
          AND "cms_public_materialization_receipts"."revision_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "cms_public_materialization_receipts_entity_key_check" CHECK(length(trim("cms_public_materialization_receipts"."entity_key")) BETWEEN 1 AND 160)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `cms_public_materialization_receipts_state_revision_unique` ON `cms_public_materialization_receipts` (`publication_state_id`,`revision_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cms_public_materialization_receipts_org_entity_idx` ON `cms_public_materialization_receipts` (`organization_id`,`entity_type`,`entity_key`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `community_link_public_details` (
	`community_link_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`description` text NOT NULL,
	`destination_type` text NOT NULL,
	`confirmed_by_profile_id` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`community_link_id`) REFERENCES `community_links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`confirmed_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "community_link_public_details_description_check" CHECK(length("community_link_public_details"."description") BETWEEN 1 AND 240),
	CONSTRAINT "community_link_public_details_destination_check" CHECK("community_link_public_details"."destination_type" IN (
        'meetup_group', 'meetup_discussion', 'social_profile',
        'community_platform', 'resource', 'other'
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `community_link_public_details_org_link_unique` ON `community_link_public_details` (`organization_id`,`community_link_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `community_link_public_details_org_type_idx` ON `community_link_public_details` (`organization_id`,`destination_type`,`confirmed_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `legal_status_confirmation_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`revision_hash` text NOT NULL,
	`action` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`revokes_receipt_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `cms_entity_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "legal_status_confirmation_receipts_action_shape_check" CHECK((
        "legal_status_confirmation_receipts"."action" = 'confirmed'
        AND "legal_status_confirmation_receipts"."revokes_receipt_id" IS NULL
      ) OR (
        "legal_status_confirmation_receipts"."action" = 'revoked'
        AND "legal_status_confirmation_receipts"."revokes_receipt_id" IS NOT NULL
      )),
	CONSTRAINT "legal_status_confirmation_receipts_hash_check" CHECK(length("legal_status_confirmation_receipts"."revision_hash") = 64
          AND "legal_status_confirmation_receipts"."revision_hash" = lower("legal_status_confirmation_receipts"."revision_hash")
          AND "legal_status_confirmation_receipts"."revision_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `legal_status_confirmation_receipts_confirm_unique` ON `legal_status_confirmation_receipts` (`organization_id`,`revision_id`) WHERE "legal_status_confirmation_receipts"."action" = 'confirmed';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `legal_status_confirmation_receipts_revoke_unique` ON `legal_status_confirmation_receipts` (`revokes_receipt_id`) WHERE "legal_status_confirmation_receipts"."revokes_receipt_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `legal_status_confirmation_receipts_org_created_idx` ON `legal_status_confirmation_receipts` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media_asset_details` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`upload_state` text DEFAULT 'pending' NOT NULL,
	`caption` text,
	`private_rights_source_note` text,
	`private_participant_consent_note` text,
	`focal_point_x` integer DEFAULT 5000 NOT NULL,
	`focal_point_y` integer DEFAULT 5000 NOT NULL,
	`informative` integer DEFAULT true NOT NULL,
	`content_version` integer DEFAULT 1 NOT NULL,
	`original_sha256` text,
	`width` integer,
	`height` integer,
	`pixel_count` integer,
	`failure_code` text,
	`finalized_at` integer,
	`updated_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "media_asset_details_state_check" CHECK("media_asset_details"."upload_state" IN ('pending', 'ready', 'failed', 'deleting')),
	CONSTRAINT "media_asset_details_state_shape_check" CHECK((
        "media_asset_details"."upload_state" = 'pending'
        AND "media_asset_details"."original_sha256" IS NULL
        AND "media_asset_details"."width" IS NULL
        AND "media_asset_details"."height" IS NULL
        AND "media_asset_details"."pixel_count" IS NULL
        AND "media_asset_details"."failure_code" IS NULL
        AND "media_asset_details"."finalized_at" IS NULL
      ) OR (
        "media_asset_details"."upload_state" = 'ready'
        AND "media_asset_details"."original_sha256" IS NOT NULL
        AND "media_asset_details"."width" IS NOT NULL
        AND "media_asset_details"."height" IS NOT NULL
        AND "media_asset_details"."pixel_count" IS NOT NULL
        AND "media_asset_details"."failure_code" IS NULL
        AND "media_asset_details"."finalized_at" IS NOT NULL
      ) OR (
        "media_asset_details"."upload_state" = 'failed'
        AND length(trim("media_asset_details"."failure_code")) BETWEEN 1 AND 64
        AND "media_asset_details"."finalized_at" IS NULL
      ) OR (
        "media_asset_details"."upload_state" = 'deleting'
        AND "media_asset_details"."failure_code" IS NULL
        AND "media_asset_details"."finalized_at" IS NOT NULL
      )),
	CONSTRAINT "media_asset_details_bounds_check" CHECK("media_asset_details"."focal_point_x" BETWEEN 0 AND 10000
          AND "media_asset_details"."focal_point_y" BETWEEN 0 AND 10000
          AND "media_asset_details"."informative" IN (0, 1)
          AND "media_asset_details"."content_version" >= 1
          AND ("media_asset_details"."caption" IS NULL OR length("media_asset_details"."caption") <= 1000)
          AND (
            "media_asset_details"."private_rights_source_note" IS NULL
            OR length("media_asset_details"."private_rights_source_note") <= 1000
          )
          AND (
            "media_asset_details"."private_participant_consent_note" IS NULL
            OR length("media_asset_details"."private_participant_consent_note") <= 1000
          )),
	CONSTRAINT "media_asset_details_image_check" CHECK((
        "media_asset_details"."original_sha256" IS NULL
        OR (
          length("media_asset_details"."original_sha256") = 64
          AND "media_asset_details"."original_sha256" = lower("media_asset_details"."original_sha256")
          AND "media_asset_details"."original_sha256" NOT GLOB '*[^0-9a-f]*'
        )
      ) AND (
        "media_asset_details"."width" IS NULL
        OR (
          "media_asset_details"."width" BETWEEN 1 AND 8000
          AND "media_asset_details"."height" BETWEEN 1 AND 8000
          AND "media_asset_details"."pixel_count" =
              "media_asset_details"."width" * "media_asset_details"."height"
          AND "media_asset_details"."pixel_count" BETWEEN 1 AND 20000000
        )
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `media_asset_details_org_asset_unique` ON `media_asset_details` (`organization_id`,`asset_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `media_asset_details_org_state_idx` ON `media_asset_details` (`organization_id`,`upload_state`,`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media_asset_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`variant_kind` text NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`pixel_count` integer NOT NULL,
	`sha256` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`failure_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finalized_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "media_asset_variants_kind_check" CHECK("media_asset_variants"."variant_kind" IN (
        'original', 'webp_480', 'webp_960', 'webp_1600'
      )),
	CONSTRAINT "media_asset_variants_mime_check" CHECK("media_asset_variants"."mime_type" IN ('image/jpeg', 'image/png', 'image/webp')
          AND (
            "media_asset_variants"."variant_kind" = 'original'
            OR "media_asset_variants"."mime_type" = 'image/webp'
          )),
	CONSTRAINT "media_asset_variants_image_check" CHECK("media_asset_variants"."byte_size" BETWEEN 1 AND 8388608
          AND "media_asset_variants"."width" BETWEEN 1 AND 8000
          AND "media_asset_variants"."height" BETWEEN 1 AND 8000
          AND "media_asset_variants"."pixel_count" = "media_asset_variants"."width" * "media_asset_variants"."height"
          AND "media_asset_variants"."pixel_count" BETWEEN 1 AND 20000000
          AND length("media_asset_variants"."sha256") = 64
          AND "media_asset_variants"."sha256" = lower("media_asset_variants"."sha256")
          AND "media_asset_variants"."sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "media_asset_variants_state_shape_check" CHECK((
        "media_asset_variants"."state" = 'pending'
        AND "media_asset_variants"."failure_code" IS NULL
        AND "media_asset_variants"."finalized_at" IS NULL
      ) OR (
        "media_asset_variants"."state" = 'ready'
        AND "media_asset_variants"."failure_code" IS NULL
        AND "media_asset_variants"."finalized_at" IS NOT NULL
      ) OR (
        "media_asset_variants"."state" = 'failed'
        AND length(trim("media_asset_variants"."failure_code")) BETWEEN 1 AND 64
        AND "media_asset_variants"."finalized_at" IS NULL
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `media_asset_variants_asset_kind_unique` ON `media_asset_variants` (`asset_id`,`variant_kind`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `media_asset_variants_org_object_key_unique` ON `media_asset_variants` (`organization_id`,`object_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `media_asset_variants_org_asset_state_idx` ON `media_asset_variants` (`organization_id`,`asset_id`,`state`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_public_attribution_write_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`operation` text NOT NULL,
	`expected_draft_version` integer NOT NULL,
	`expected_published_version` integer NOT NULL,
	`proposed_published_version` integer NOT NULL,
	`snapshot_hash` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organizer_public_attribution_intents_operation_check" CHECK("organizer_public_attribution_write_intents"."operation" IN ('adopted', 'confirmed', 'revoked')),
	CONSTRAINT "organizer_public_attribution_intents_version_check" CHECK("organizer_public_attribution_write_intents"."expected_draft_version" >= 1
          AND "organizer_public_attribution_write_intents"."expected_published_version" >= 0
          AND "organizer_public_attribution_write_intents"."proposed_published_version" =
              "organizer_public_attribution_write_intents"."expected_published_version" + 1),
	CONSTRAINT "organizer_public_attribution_intents_hash_check" CHECK(length("organizer_public_attribution_write_intents"."snapshot_hash") = 64
          AND "organizer_public_attribution_write_intents"."snapshot_hash" = lower("organizer_public_attribution_write_intents"."snapshot_hash")
          AND "organizer_public_attribution_write_intents"."snapshot_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_public_attribution_intents_profile_version_unique` ON `organizer_public_attribution_write_intents` (`organization_id`,`profile_id`,`proposed_published_version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_public_attribution_intents_open_idx` ON `organizer_public_attribution_write_intents` (`organization_id`,`completed_at`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_public_attribution_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`action` text NOT NULL,
	`attribution_version` integer NOT NULL,
	`display_name` text,
	`biography` text,
	`photo_media_asset_id` text,
	`consent` integer NOT NULL,
	`draft_version` integer NOT NULL,
	`legacy_adopted` integer NOT NULL,
	`prior_published_version` integer,
	`snapshot_json` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`write_intent_id` text NOT NULL,
	`related_receipt_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`photo_media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`write_intent_id`) REFERENCES `organizer_public_attribution_write_intents`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organizer_public_attribution_receipts_action_check" CHECK("organizer_public_attribution_receipts"."action" IN ('adopted', 'confirmed', 'revoked')),
	CONSTRAINT "organizer_public_attribution_receipts_version_check" CHECK("organizer_public_attribution_receipts"."attribution_version" >= 1
          AND "organizer_public_attribution_receipts"."draft_version" >= 1
          AND (
            "organizer_public_attribution_receipts"."prior_published_version" IS NULL
            OR "organizer_public_attribution_receipts"."prior_published_version" >= 1
          )),
	CONSTRAINT "organizer_public_attribution_receipts_fields_check" CHECK((
        "organizer_public_attribution_receipts"."action" = 'adopted'
        AND "organizer_public_attribution_receipts"."consent" = 1
        AND "organizer_public_attribution_receipts"."legacy_adopted" = 1
        AND "organizer_public_attribution_receipts"."display_name" IS NOT NULL
        AND length(trim("organizer_public_attribution_receipts"."display_name")) BETWEEN 1 AND 120
        AND "organizer_public_attribution_receipts"."biography" IS NULL
        AND "organizer_public_attribution_receipts"."photo_media_asset_id" IS NULL
        AND "organizer_public_attribution_receipts"."prior_published_version" IS NULL
      ) OR (
        "organizer_public_attribution_receipts"."action" = 'confirmed'
        AND "organizer_public_attribution_receipts"."consent" = 1
        AND "organizer_public_attribution_receipts"."legacy_adopted" = 0
        AND "organizer_public_attribution_receipts"."display_name" IS NOT NULL
        AND length(trim("organizer_public_attribution_receipts"."display_name")) BETWEEN 1 AND 120
        AND (
          "organizer_public_attribution_receipts"."biography" IS NULL
          OR length("organizer_public_attribution_receipts"."biography") BETWEEN 1 AND 800
        )
        AND "organizer_public_attribution_receipts"."prior_published_version" IS NULL
      ) OR (
        "organizer_public_attribution_receipts"."action" = 'revoked'
        AND "organizer_public_attribution_receipts"."consent" = 0
        AND "organizer_public_attribution_receipts"."legacy_adopted" = 0
        AND "organizer_public_attribution_receipts"."display_name" IS NULL
        AND "organizer_public_attribution_receipts"."biography" IS NULL
        AND "organizer_public_attribution_receipts"."photo_media_asset_id" IS NULL
        AND "organizer_public_attribution_receipts"."prior_published_version" IS NOT NULL
      )),
	CONSTRAINT "organizer_public_attribution_receipts_snapshot_check" CHECK(json_valid("organizer_public_attribution_receipts"."snapshot_json")
          AND json_type("organizer_public_attribution_receipts"."snapshot_json") = 'object'
          AND length(CAST("organizer_public_attribution_receipts"."snapshot_json" AS BLOB)) BETWEEN 2 AND 4096),
	CONSTRAINT "organizer_public_attribution_receipts_hash_check" CHECK(length("organizer_public_attribution_receipts"."snapshot_hash") = 64
          AND "organizer_public_attribution_receipts"."snapshot_hash" = lower("organizer_public_attribution_receipts"."snapshot_hash")
          AND "organizer_public_attribution_receipts"."snapshot_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "organizer_public_attribution_receipts_relationship_check" CHECK((
        "organizer_public_attribution_receipts"."action" IN ('adopted', 'confirmed')
      ) OR (
        "organizer_public_attribution_receipts"."action" = 'revoked'
        AND "organizer_public_attribution_receipts"."related_receipt_id" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_public_attribution_receipts_profile_version_unique` ON `organizer_public_attribution_receipts` (`organization_id`,`profile_id`,`attribution_version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_public_attribution_receipts_org_profile_idx` ON `organizer_public_attribution_receipts` (`organization_id`,`profile_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_public_attribution_receipts_intent_unique` ON `organizer_public_attribution_receipts` (`write_intent_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_public_attribution_states` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`attribution_version` integer DEFAULT 1 NOT NULL,
	`published_attribution_version` integer DEFAULT 0 NOT NULL,
	`workflow_status` text DEFAULT 'unconfirmed' NOT NULL,
	`draft_photo_media_asset_id` text,
	`public_display_name` text,
	`public_biography` text,
	`public_photo_media_asset_id` text,
	`current_receipt_id` text,
	`confirmed_at` integer,
	`revoked_at` integer,
	`updated_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_photo_media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`public_photo_media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`current_receipt_id`) REFERENCES `organizer_public_attribution_receipts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organizer_public_attribution_states_version_check" CHECK("organizer_public_attribution_states"."attribution_version" >= 1
          AND "organizer_public_attribution_states"."published_attribution_version" >= 0),
	CONSTRAINT "organizer_public_attribution_states_status_check" CHECK("organizer_public_attribution_states"."workflow_status" IN ('unconfirmed', 'confirmed', 'revoked')),
	CONSTRAINT "organizer_public_attribution_states_shape_check" CHECK((
        "organizer_public_attribution_states"."workflow_status" = 'unconfirmed'
        AND "organizer_public_attribution_states"."current_receipt_id" IS NULL
        AND "organizer_public_attribution_states"."public_display_name" IS NULL
        AND "organizer_public_attribution_states"."public_biography" IS NULL
        AND "organizer_public_attribution_states"."public_photo_media_asset_id" IS NULL
        AND "organizer_public_attribution_states"."confirmed_at" IS NULL
        AND "organizer_public_attribution_states"."revoked_at" IS NULL
        AND "organizer_public_attribution_states"."published_attribution_version" = 0
      ) OR (
        "organizer_public_attribution_states"."workflow_status" = 'confirmed'
        AND length(trim("organizer_public_attribution_states"."public_display_name")) BETWEEN 1 AND 120
        AND "organizer_public_attribution_states"."current_receipt_id" IS NOT NULL
        AND "organizer_public_attribution_states"."confirmed_at" IS NOT NULL
        AND "organizer_public_attribution_states"."revoked_at" IS NULL
        AND "organizer_public_attribution_states"."published_attribution_version" >= 1
      ) OR (
        "organizer_public_attribution_states"."workflow_status" = 'revoked'
        AND "organizer_public_attribution_states"."current_receipt_id" IS NOT NULL
        AND "organizer_public_attribution_states"."public_display_name" IS NULL
        AND "organizer_public_attribution_states"."public_biography" IS NULL
        AND "organizer_public_attribution_states"."public_photo_media_asset_id" IS NULL
        AND "organizer_public_attribution_states"."revoked_at" IS NOT NULL
        AND "organizer_public_attribution_states"."published_attribution_version" >= 1
      )),
	CONSTRAINT "organizer_public_attribution_states_biography_check" CHECK("organizer_public_attribution_states"."public_biography" IS NULL
          OR length("organizer_public_attribution_states"."public_biography") BETWEEN 1 AND 800)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_public_attribution_states_org_profile_unique` ON `organizer_public_attribution_states` (`organization_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_public_attribution_states_org_status_idx` ON `organizer_public_attribution_states` (`organization_id`,`workflow_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_public_attribution_states_org_photo_idx` ON `organizer_public_attribution_states` (`organization_id`,`public_photo_media_asset_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media_usage_references` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`usage_kind` text NOT NULL,
	`publication_scope` text NOT NULL,
	`created_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "media_usage_references_entity_type_check" CHECK("media_usage_references"."entity_type" IN (
        'page', 'club_public_profile', 'program_public_profile', 'organizer_event',
        'organizer_profile',
        'site_logo', 'site_og', 'footer', 'community_link'
      )),
	CONSTRAINT "media_usage_references_scope_check" CHECK("media_usage_references"."publication_scope" IN ('draft', 'published')),
	CONSTRAINT "media_usage_references_identity_check" CHECK(length(trim("media_usage_references"."entity_id")) BETWEEN 1 AND 160
          AND length(trim("media_usage_references"."usage_kind")) BETWEEN 1 AND 64
          AND length(trim("media_usage_references"."revision_id")) BETWEEN 1 AND 160)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `media_usage_references_active_usage_unique` ON `media_usage_references` (`organization_id`,`entity_type`,`entity_id`,`revision_id`,`usage_kind`,`publication_scope`) WHERE "media_usage_references"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `media_usage_references_asset_scope_idx` ON `media_usage_references` (`organization_id`,`asset_id`,`publication_scope`,`deleted_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `media_usage_references_entity_idx` ON `media_usage_references` (`organization_id`,`entity_type`,`entity_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `page_public_metadata` (
	`page_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`seo_title` text,
	`meta_description` text,
	`og_media_asset_id` text,
	`updated_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`og_media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "page_public_metadata_seo_title_check" CHECK("page_public_metadata"."seo_title" IS NULL
          OR length("page_public_metadata"."seo_title") BETWEEN 1 AND 60),
	CONSTRAINT "page_public_metadata_description_check" CHECK("page_public_metadata"."meta_description" IS NULL
          OR length("page_public_metadata"."meta_description") BETWEEN 1 AND 160)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `page_public_metadata_org_page_unique` ON `page_public_metadata` (`organization_id`,`page_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `page_public_metadata_org_updated_idx` ON `page_public_metadata` (`organization_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizer_event_public_metadata` (
	`organizer_event_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`seo_title` text,
	`meta_description` text,
	`updated_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organizer_event_id`) REFERENCES `organizer_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "organizer_event_public_metadata_seo_title_check" CHECK("organizer_event_public_metadata"."seo_title" IS NULL
          OR length(trim("organizer_event_public_metadata"."seo_title")) BETWEEN 1 AND 60),
	CONSTRAINT "organizer_event_public_metadata_description_check" CHECK("organizer_event_public_metadata"."meta_description" IS NULL
          OR length(trim("organizer_event_public_metadata"."meta_description")) BETWEEN 1 AND 160)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizer_event_public_metadata_org_event_unique` ON `organizer_event_public_metadata` (`organization_id`,`organizer_event_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizer_event_public_metadata_org_updated_idx` ON `organizer_event_public_metadata` (`organization_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `public_slug_redirects` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`from_slug` text NOT NULL,
	`to_slug` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`created_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`retired_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "public_slug_redirects_entity_type_check" CHECK("public_slug_redirects"."entity_type" IN ('page', 'club_public_profile', 'program_public_profile')),
	CONSTRAINT "public_slug_redirects_state_shape_check" CHECK((
        "public_slug_redirects"."state" = 'active' AND "public_slug_redirects"."retired_at" IS NULL
      ) OR (
        "public_slug_redirects"."state" = 'superseded'
        AND "public_slug_redirects"."retired_at" IS NOT NULL
      )),
	CONSTRAINT "public_slug_redirects_slug_check" CHECK(length("public_slug_redirects"."from_slug") BETWEEN 1 AND 160
          AND length("public_slug_redirects"."to_slug") BETWEEN 1 AND 160
          AND "public_slug_redirects"."from_slug" <> "public_slug_redirects"."to_slug")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `public_slug_redirects_active_from_unique` ON `public_slug_redirects` (`organization_id`,`entity_type`,`from_slug`) WHERE "public_slug_redirects"."state" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `public_slug_redirects_entity_idx` ON `public_slug_redirects` (`organization_id`,`entity_type`,`entity_id`,`state`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `taxonomy_write_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text NOT NULL,
	`expected_content_version` integer NOT NULL,
	`proposed_content_version` integer NOT NULL,
	`proposed_name` text NOT NULL,
	`proposed_slug` text NOT NULL,
	`proposed_description` text,
	`proposed_color_token` text,
	`proposed_sort_order` integer NOT NULL,
	`proposed_deleted_at` integer,
	`mutation_group_id` text,
	`mutation_group_size` integer,
	`actor_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "taxonomy_write_intents_operation_check" CHECK("taxonomy_write_intents"."operation" IN (
        'adopt', 'create', 'update', 'reorder', 'archive', 'safe_delete'
      )),
	CONSTRAINT "taxonomy_write_intents_version_check" CHECK("taxonomy_write_intents"."expected_content_version" >= 0
          AND "taxonomy_write_intents"."proposed_content_version" =
              "taxonomy_write_intents"."expected_content_version" + 1
          AND (
            (
              "taxonomy_write_intents"."operation" IN ('adopt', 'create')
              AND "taxonomy_write_intents"."expected_content_version" = 0
            )
            OR (
              "taxonomy_write_intents"."operation" NOT IN ('adopt', 'create')
              AND "taxonomy_write_intents"."expected_content_version" >= 1
            )
          )),
	CONSTRAINT "taxonomy_write_intents_public_fields_check" CHECK(length(trim("taxonomy_write_intents"."proposed_name")) BETWEEN 1 AND 120
          AND length("taxonomy_write_intents"."proposed_slug") BETWEEN 1 AND 160
          AND "taxonomy_write_intents"."proposed_slug" = lower("taxonomy_write_intents"."proposed_slug")
          AND "taxonomy_write_intents"."proposed_slug" NOT GLOB '*[^a-z0-9-]*'
          AND "taxonomy_write_intents"."proposed_slug" NOT GLOB '-*'
          AND "taxonomy_write_intents"."proposed_slug" NOT GLOB '*-'
          AND instr("taxonomy_write_intents"."proposed_slug", '--') = 0
          AND (
            "taxonomy_write_intents"."proposed_description" IS NULL
            OR length("taxonomy_write_intents"."proposed_description") BETWEEN 1 AND 1000
          )
          AND (
            "taxonomy_write_intents"."proposed_color_token" IS NULL
            OR (
              length("taxonomy_write_intents"."proposed_color_token") BETWEEN 1 AND 64
              AND "taxonomy_write_intents"."proposed_color_token" =
                  lower("taxonomy_write_intents"."proposed_color_token")
              AND "taxonomy_write_intents"."proposed_color_token" GLOB '[a-z]*'
              AND "taxonomy_write_intents"."proposed_color_token"
                  NOT GLOB '*[^a-z0-9-]*'
              AND instr("taxonomy_write_intents"."proposed_color_token", '--') = 0
              AND "taxonomy_write_intents"."proposed_color_token" NOT GLOB '*-'
            )
          )
          AND "taxonomy_write_intents"."proposed_sort_order" BETWEEN 0 AND 100000
          AND (
            "taxonomy_write_intents"."entity_type" <> 'lane'
            OR "taxonomy_write_intents"."proposed_color_token" IS NULL
          )),
	CONSTRAINT "taxonomy_write_intents_state_shape_check" CHECK((
        "taxonomy_write_intents"."operation" IN ('create', 'update', 'reorder')
        AND "taxonomy_write_intents"."proposed_deleted_at" IS NULL
      ) OR (
        "taxonomy_write_intents"."operation" IN ('archive', 'safe_delete')
        AND "taxonomy_write_intents"."proposed_deleted_at" IS NOT NULL
      ) OR "taxonomy_write_intents"."operation" = 'adopt'),
	CONSTRAINT "taxonomy_write_intents_group_shape_check" CHECK((
        "taxonomy_write_intents"."operation" = 'reorder'
        AND length("taxonomy_write_intents"."mutation_group_id") BETWEEN 1 AND 128
        AND "taxonomy_write_intents"."mutation_group_size" BETWEEN 1 AND 100
        AND "taxonomy_write_intents"."proposed_sort_order" BETWEEN 10 AND 1000
        AND "taxonomy_write_intents"."proposed_sort_order" % 10 = 0
        AND "taxonomy_write_intents"."proposed_sort_order" <=
            "taxonomy_write_intents"."mutation_group_size" * 10
      ) OR (
        "taxonomy_write_intents"."operation" <> 'reorder'
        AND "taxonomy_write_intents"."mutation_group_id" IS NULL
        AND "taxonomy_write_intents"."mutation_group_size" IS NULL
      )),
	CONSTRAINT "taxonomy_write_intents_completion_check" CHECK("taxonomy_write_intents"."completed_at" IS NULL
          OR "taxonomy_write_intents"."completed_at" >= "taxonomy_write_intents"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `taxonomy_write_intents_open_entity_unique` ON `taxonomy_write_intents` (`organization_id`,`entity_type`,`entity_id`) WHERE "taxonomy_write_intents"."completed_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `taxonomy_write_intents_entity_history_idx` ON `taxonomy_write_intents` (`organization_id`,`entity_type`,`entity_id`,`proposed_content_version`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `taxonomy_write_intents_entity_version_unique` ON `taxonomy_write_intents` (`organization_id`,`entity_type`,`entity_id`,`proposed_content_version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `taxonomy_write_intents_open_idx` ON `taxonomy_write_intents` (`organization_id`,`completed_at`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `taxonomy_write_intents_reorder_group_sort_unique` ON `taxonomy_write_intents` (`organization_id`,`entity_type`,`mutation_group_id`,`proposed_sort_order`) WHERE "taxonomy_write_intents"."operation" = 'reorder';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `taxonomy_write_intents_reorder_group_idx` ON `taxonomy_write_intents` (`organization_id`,`entity_type`,`mutation_group_id`,`completed_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `event_lane_taxonomy_states` (
	`lane_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`content_version` integer DEFAULT 1 NOT NULL,
	`active_intent_id` text,
	`last_completed_intent_id` text,
	`updated_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`lane_id`) REFERENCES `event_lanes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_intent_id`) REFERENCES `taxonomy_write_intents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`last_completed_intent_id`) REFERENCES `taxonomy_write_intents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "event_lane_taxonomy_states_version_check" CHECK("event_lane_taxonomy_states"."content_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `event_lane_taxonomy_states_org_lane_unique` ON `event_lane_taxonomy_states` (`organization_id`,`lane_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `category_taxonomy_states` (
	`category_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`content_version` integer DEFAULT 1 NOT NULL,
	`active_intent_id` text,
	`last_completed_intent_id` text,
	`updated_by_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_intent_id`) REFERENCES `taxonomy_write_intents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`last_completed_intent_id`) REFERENCES `taxonomy_write_intents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "category_taxonomy_states_sort_order_check" CHECK("category_taxonomy_states"."sort_order" BETWEEN 0 AND 100000),
	CONSTRAINT "category_taxonomy_states_version_check" CHECK("category_taxonomy_states"."content_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `category_taxonomy_states_org_category_unique` ON `category_taxonomy_states` (`organization_id`,`category_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `category_taxonomy_states_org_sort_idx` ON `category_taxonomy_states` (`organization_id`,`sort_order`,`category_id`);
