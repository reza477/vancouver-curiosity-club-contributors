-- Pre-production retry normalization.
--
-- Sites version 7 never published a Worker and could not accept user writes.
-- Its first migration may nevertheless have left schema objects before the
-- production tokenizer reached the first trigger body. These idempotent,
-- single-statement drops clear only that unservable pre-production schema so
-- the following generated baseline can be applied deterministically.
DROP TRIGGER IF EXISTS `events_reservation_guard_before_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `events_reservation_guard_before_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `club_public_profiles_org_integrity_before_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `club_public_profiles_org_integrity_before_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `clubs_public_profile_org_integrity_before_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `event_lanes_public_profile_org_integrity_before_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `event_public_details_org_integrity_before_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `event_public_details_org_integrity_before_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `events_public_details_org_integrity_before_update`;--> statement-breakpoint
DROP TABLE IF EXISTS `__new_events`;--> statement-breakpoint
DROP TABLE IF EXISTS `__new_external_source_links`;--> statement-breakpoint
DROP TABLE IF EXISTS `__new_sync_sources`;--> statement-breakpoint
DROP TABLE IF EXISTS `site_settings`;--> statement-breakpoint
DROP TABLE IF EXISTS `page_sections`;--> statement-breakpoint
DROP TABLE IF EXISTS `page_revisions`;--> statement-breakpoint
DROP TABLE IF EXISTS `notifications`;--> statement-breakpoint
DROP TABLE IF EXISTS `notification_preferences`;--> statement-breakpoint
DROP TABLE IF EXISTS `navigation_items`;--> statement-breakpoint
DROP TABLE IF EXISTS `pages`;--> statement-breakpoint
DROP TABLE IF EXISTS `meetup_event_snapshots`;--> statement-breakpoint
DROP TABLE IF EXISTS `meetup_sync_generations`;--> statement-breakpoint
DROP TABLE IF EXISTS `sync_sources`;--> statement-breakpoint
DROP TABLE IF EXISTS `media_assets`;--> statement-breakpoint
DROP TABLE IF EXISTS `invitations`;--> statement-breakpoint
DROP TABLE IF EXISTS `import_rows`;--> statement-breakpoint
DROP TABLE IF EXISTS `import_batches`;--> statement-breakpoint
DROP TABLE IF EXISTS `ics_subscription_tokens`;--> statement-breakpoint
DROP TABLE IF EXISTS `form_submissions`;--> statement-breakpoint
DROP TABLE IF EXISTS `external_source_links`;--> statement-breakpoint
DROP TABLE IF EXISTS `event_revisions`;--> statement-breakpoint
DROP TABLE IF EXISTS `event_public_details`;--> statement-breakpoint
DROP TABLE IF EXISTS `event_organizers`;--> statement-breakpoint
DROP TABLE IF EXISTS `database_invariant_state`;--> statement-breakpoint
DROP TABLE IF EXISTS `conflict_overrides`;--> statement-breakpoint
DROP TABLE IF EXISTS `conflict_incidents`;--> statement-breakpoint
DROP TABLE IF EXISTS `conflict_policies`;--> statement-breakpoint
DROP TABLE IF EXISTS `events`;--> statement-breakpoint
DROP TABLE IF EXISTS `venues`;--> statement-breakpoint
DROP TABLE IF EXISTS `programs`;--> statement-breakpoint
DROP TABLE IF EXISTS `community_links`;--> statement-breakpoint
DROP TABLE IF EXISTS `club_public_profiles`;--> statement-breakpoint
DROP TABLE IF EXISTS `event_lanes`;--> statement-breakpoint
DROP TABLE IF EXISTS `club_memberships`;--> statement-breakpoint
DROP TABLE IF EXISTS `organization_memberships`;--> statement-breakpoint
DROP TABLE IF EXISTS `clubs`;--> statement-breakpoint
DROP TABLE IF EXISTS `categories`;--> statement-breakpoint
DROP TABLE IF EXISTS `audit_logs`;--> statement-breakpoint
DROP TABLE IF EXISTS `organizations`;--> statement-breakpoint
DROP TABLE IF EXISTS `profiles`;
