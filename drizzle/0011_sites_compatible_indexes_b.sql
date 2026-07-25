-- Sites-compatible final indexes, part 2 of 2.
CREATE INDEX IF NOT EXISTS `import_rows_batch_status_idx` ON `import_rows` (`import_batch_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invitations_target_lookup_idx` ON `invitations` (`organization_id`,`target_normalized_email`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `media_assets_org_object_key_unique` ON `media_assets` (`organization_id`,`object_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `media_assets_org_public_idx` ON `media_assets` (`organization_id`,`is_public`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `meetup_event_snapshots_generation_external_unique` ON `meetup_event_snapshots` (`sync_source_id`,`generation_id`,`external_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meetup_event_snapshots_public_timed_idx` ON `meetup_event_snapshots` (`organization_id`,`sync_source_id`,`generation_id`,`status`,`ends_at_utc`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meetup_event_snapshots_public_all_day_idx` ON `meetup_event_snapshots` (`organization_id`,`sync_source_id`,`generation_id`,`status`,`all_day_end_date_exclusive`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meetup_event_snapshots_event_idx` ON `meetup_event_snapshots` (`organization_id`,`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `meetup_sync_generations_source_hash_id_unique` ON `meetup_sync_generations` (`sync_source_id`,`snapshot_hash`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meetup_sync_generations_source_state_idx` ON `meetup_sync_generations` (`sync_source_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `navigation_items_org_placement_sort_idx` ON `navigation_items` (`organization_id`,`placement`,`is_published`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `notification_preferences_scope_unique` ON `notification_preferences` (`organization_id`,`profile_id`,`notification_type`,`channel`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notifications_recipient_unread_idx` ON `notifications` (`recipient_profile_id`,`read_at`,`created_at`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organization_memberships_org_profile_unique` ON `organization_memberships` (`organization_id`,`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organization_memberships_org_email_unique` ON `organization_memberships` (`organization_id`,`normalized_email`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organization_memberships_authorization_idx` ON `organization_memberships` (`organization_id`,`status`,`role`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizations_deleted_at_idx` ON `organizations` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `page_revisions_page_number_unique` ON `page_revisions` (`page_id`,`revision_number`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `page_sections_page_key_unique` ON `page_sections` (`page_id`,`section_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `page_sections_page_sort_idx` ON `page_sections` (`page_id`,`sort_order`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `pages_org_slug_unique` ON `pages` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pages_public_idx` ON `pages` (`organization_id`,`status`,`visibility`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `profiles_siwc_subject_unique` ON `profiles` (`siwc_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `profiles_normalized_email_unique` ON `profiles` (`normalized_email`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `profiles_status_idx` ON `profiles` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `programs_org_slug_unique` ON `programs` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `programs_org_active_idx` ON `programs` (`organization_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `site_settings_org_key_unique` ON `site_settings` (`organization_id`,`key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `site_settings_public_idx` ON `site_settings` (`organization_id`,`is_public`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `sync_sources_org_club_type_unique` ON `sync_sources` (`organization_id`,`club_id`,`source_type`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `sync_sources_org_type_url_unique` ON `sync_sources` (`organization_id`,`source_type`,`source_url`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sync_sources_due_idx` ON `sync_sources` (`enabled`,`next_refresh_at`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sync_sources_org_club_idx` ON `sync_sources` (`organization_id`,`club_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `venues_org_slug_unique` ON `venues` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `venues_org_public_idx` ON `venues` (`organization_id`,`is_public`,`deleted_at`);
