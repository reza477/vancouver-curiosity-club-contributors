-- Sites-compatible final indexes, part 1 of 2.
CREATE INDEX IF NOT EXISTS `audit_logs_org_entity_idx` ON `audit_logs` (`organization_id`,`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_logs_org_actor_idx` ON `audit_logs` (`organization_id`,`actor_profile_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `categories_org_slug_unique` ON `categories` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `categories_org_active_idx` ON `categories` (`organization_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `club_memberships_club_profile_unique` ON `club_memberships` (`club_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `club_memberships_authorization_idx` ON `club_memberships` (`organization_id`,`club_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `club_public_profiles_org_club_unique` ON `club_public_profiles` (`organization_id`,`club_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `club_public_profiles_public_featured_idx` ON `club_public_profiles` (`organization_id`,`publication_status`,`is_featured`,`deleted_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `club_public_profiles_lane_idx` ON `club_public_profiles` (`organization_id`,`primary_event_lane_id`,`publication_status`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `clubs_org_slug_unique` ON `clubs` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `clubs_org_active_idx` ON `clubs` (`organization_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `community_links_org_url_unique` ON `community_links` (`organization_id`,`url`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `community_links_public_sort_idx` ON `community_links` (`organization_id`,`is_published`,`sort_order`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `conflict_incidents_event_state_idx` ON `conflict_incidents` (`organization_id`,`event_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `conflict_overrides_active_incident_unique` ON `conflict_overrides` (`conflict_incident_id`) WHERE "conflict_overrides"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `conflict_overrides_org_event_idx` ON `conflict_overrides` (`organization_id`,`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `conflict_policies_org_slug_unique` ON `conflict_policies` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `conflict_policies_org_active_idx` ON `conflict_policies` (`organization_id`,`is_active`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `event_lanes_org_slug_unique` ON `event_lanes` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `event_lanes_org_sort_idx` ON `event_lanes` (`organization_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `event_organizers_event_profile_unique` ON `event_organizers` (`event_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `event_organizers_conflict_lookup_idx` ON `event_organizers` (`organization_id`,`profile_id`,`deleted_at`,`event_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `event_public_details_org_mode_idx` ON `event_public_details` (`organization_id`,`attendance_mode`,`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `event_revisions_event_version_unique` ON `event_revisions` (`event_id`,`schedule_version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `event_revisions_org_created_idx` ON `event_revisions` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `events_org_slug_unique` ON `events` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_public_projection_idx` ON `events` (`organization_id`,`visibility`,`status`,`published_at`,`deleted_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_timed_conflict_scan_idx` ON `events` (`organization_id`,`status`,`hold_expires_at`,`starts_at_utc`,`ends_at_utc`,`deleted_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_venue_conflict_idx` ON `events` (`organization_id`,`venue_id`,`starts_at_utc`,`ends_at_utc`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_primary_organizer_conflict_idx` ON `events` (`organization_id`,`primary_organizer_profile_id`,`starts_at_utc`,`ends_at_utc`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `external_source_links_source_unique` ON `external_source_links` (`organization_id`,`source_type`,`sync_source_id`,`external_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `external_source_links_entity_idx` ON `external_source_links` (`organization_id`,`entity_type`,`entity_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `external_source_links_sync_source_idx` ON `external_source_links` (`organization_id`,`sync_source_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `form_submissions_org_status_idx` ON `form_submissions` (`organization_id`,`form_key`,`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `ics_subscription_tokens_hash_unique` ON `ics_subscription_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ics_subscription_tokens_profile_idx` ON `ics_subscription_tokens` (`organization_id`,`profile_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `import_batches_org_status_idx` ON `import_batches` (`organization_id`,`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `import_rows_batch_number_unique` ON `import_rows` (`import_batch_id`,`row_number`);
