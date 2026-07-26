import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const nowMs = sql`(unixepoch() * 1000)`;

/**
 * Persistent proof that the Worker-installed database guards match the
 * expected runtime contract. SQLite trigger bodies are installed at runtime
 * because the Sites production migration tokenizer cannot preserve their
 * internal semicolons as one prepared statement.
 */
export const databaseInvariantState = sqliteTable(
  "database_invariant_state",
  {
    singletonKey: text("singleton_key").primaryKey(),
    version: integer("version").notNull(),
    triggerFingerprint: text("trigger_fingerprint").notNull(),
    verifiedAt: integer("verified_at").notNull().default(nowMs),
  },
  (table) => [
    check(
      "database_invariant_state_version_check",
      sql`${table.version} >= 1`,
    ),
    check(
      "database_invariant_state_fingerprint_check",
      sql`length(${table.triggerFingerprint}) = 64`,
    ),
  ],
);

export const profiles = sqliteTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    siwcSubject: text("siwc_subject").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    displayName: text("display_name"),
    publicAttributionConsent: integer("public_attribution_consent", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    status: text("status", { enum: ["active", "suspended"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("profiles_siwc_subject_unique").on(table.siwcSubject),
    uniqueIndex("profiles_normalized_email_unique").on(table.normalizedEmail),
    index("profiles_status_idx").on(table.status),
    check(
      "profiles_normalized_email_check",
      sql`${table.normalizedEmail} = lower(trim(${table.normalizedEmail}))`,
    ),
  ],
);

export const organizations = sqliteTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    timezone: text("timezone").notNull().default("America/Vancouver"),
    ownerBootstrapClosedAt: integer("owner_bootstrap_closed_at"),
    ownerBootstrapClaimedByProfileId: text(
      "owner_bootstrap_claimed_by_profile_id",
    ).references(() => profiles.id, { onDelete: "set null" }),
    createdByProfileId: text("created_by_profile_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("organizations_slug_unique").on(table.slug),
    index("organizations_deleted_at_idx").on(table.deletedAt),
  ],
);

export const organizationMemberships = sqliteTable(
  "organization_memberships",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    normalizedEmail: text("normalized_email").notNull(),
    role: text("role", {
      enum: ["owner", "administrator", "organizer"],
    }).notNull(),
    status: text("status", {
      enum: ["active", "suspended", "revoked"],
    })
      .notNull()
      .default("active"),
    createdByProfileId: text("created_by_profile_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("organization_memberships_org_profile_unique").on(
      table.organizationId,
      table.profileId,
    ),
    uniqueIndex("organization_memberships_org_email_unique").on(
      table.organizationId,
      table.normalizedEmail,
    ),
    index("organization_memberships_authorization_idx").on(
      table.organizationId,
      table.status,
      table.role,
      table.deletedAt,
    ),
    check(
      "organization_memberships_normalized_email_check",
      sql`${table.normalizedEmail} = lower(trim(${table.normalizedEmail}))`,
    ),
  ],
);

/**
 * Organizer-only presentation and notification preferences live in a retry-
 * safe additive sidecar. Existing public attribution fields remain on
 * `profiles`, so this table cannot change Phase 2 public host projection.
 */
export const organizerProfilePreferences = sqliteTable(
  "organizer_profile_preferences",
  {
    profileId: text("profile_id")
      .primaryKey()
      .references(() => profiles.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    initials: text("initials"),
    calendarColor: text("calendar_color"),
    workspaceDisplayName: text("workspace_display_name"),
    publicBiography: text("public_biography"),
    publicAttributionConsentDraft: integer(
      "public_attribution_consent_draft",
      { mode: "boolean" },
    ),
    notificationPreferenceMode: text("notification_preference_mode", {
      enum: ["all_relevant", "important_only"],
    })
      .notNull()
      .default("all_relevant"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("organizer_profile_preferences_org_profile_unique").on(
      table.organizationId,
      table.profileId,
    ),
    index("organizer_profile_preferences_org_idx").on(
      table.organizationId,
      table.profileId,
    ),
    check(
      "organizer_profile_preferences_mode_check",
      sql`${table.notificationPreferenceMode} IN ('all_relevant', 'important_only')`,
    ),
    check(
      "organizer_profile_preferences_consent_check",
      sql`${table.publicAttributionConsentDraft} IS NULL OR ${table.publicAttributionConsentDraft} IN (0, 1)`,
    ),
  ],
);

export const clubs = sqliteTable(
  "clubs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    createdByProfileId: text("created_by_profile_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("clubs_org_slug_unique").on(table.organizationId, table.slug),
    index("clubs_org_active_idx").on(table.organizationId, table.deletedAt),
  ],
);

export const clubMemberships = sqliteTable(
  "club_memberships",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clubId: text("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    organizationMembershipId: text("organization_membership_id")
      .notNull()
      .references(() => organizationMemberships.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["organizer"] })
      .notNull()
      .default("organizer"),
    status: text("status", {
      enum: ["active", "suspended", "revoked"],
    })
      .notNull()
      .default("active"),
    createdByProfileId: text("created_by_profile_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("club_memberships_club_profile_unique").on(
      table.clubId,
      table.profileId,
    ),
    index("club_memberships_authorization_idx").on(
      table.organizationId,
      table.clubId,
      table.status,
      table.deletedAt,
    ),
  ],
);

/**
 * A transfer lock exists only inside the atomic ownership-transfer batch. Its
 * runtime-installed guards allow the batch's temporary zero-owner state and
 * refuse deletion until the target is the sole active Owner.
 */
export const ownershipTransferLocks = sqliteTable(
  "ownership_transfer_locks",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    targetMembershipId: text("target_membership_id")
      .notNull()
      .references(() => organizationMemberships.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("ownership_transfer_locks_target_unique").on(
      table.targetMembershipId,
    ),
  ],
);

/**
 * Durable rate-limit counters. A SHA-256 token digest may be used as scope_key
 * before an invitation has a profile or membership; raw tokens and emails are
 * never stored here.
 */
export const organizerRateLimits = sqliteTable(
  "organizer_rate_limits",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(
      () => organizations.id,
      { onDelete: "cascade" },
    ),
    profileId: text("profile_id").references(() => profiles.id, {
      onDelete: "cascade",
    }),
    action: text("action").notNull(),
    scopeKey: text("scope_key").notNull(),
    windowStartedAt: integer("window_started_at").notNull(),
    windowExpiresAt: integer("window_expires_at").notNull(),
    requestCount: integer("request_count").notNull().default(1),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("organizer_rate_limits_scope_window_unique").on(
      table.action,
      table.scopeKey,
      table.windowStartedAt,
    ),
    index("organizer_rate_limits_active_window_idx").on(
      table.action,
      table.scopeKey,
      table.windowExpiresAt,
    ),
    check(
      "organizer_rate_limits_request_count_check",
      sql`${table.requestCount} >= 1`,
    ),
    check(
      "organizer_rate_limits_window_check",
      sql`${table.windowExpiresAt} > ${table.windowStartedAt}`,
    ),
  ],
);

export const programs = sqliteTable(
  "programs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clubId: text("club_id").references(() => clubs.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    createdByProfileId: text("created_by_profile_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("programs_org_slug_unique").on(
      table.organizationId,
      table.slug,
    ),
    index("programs_org_active_idx").on(table.organizationId, table.deletedAt),
  ],
);

export const eventLanes = sqliteTable(
  "event_lanes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdByProfileId: text("created_by_profile_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("event_lanes_org_slug_unique").on(
      table.organizationId,
      table.slug,
    ),
    index("event_lanes_org_sort_idx").on(
      table.organizationId,
      table.sortOrder,
    ),
  ],
);

export const clubPublicProfiles = sqliteTable(
  "club_public_profiles",
  {
    clubId: text("club_id")
      .primaryKey()
      .references(() => clubs.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    primaryEventLaneId: text("primary_event_lane_id")
      .notNull()
      .references(() => eventLanes.id, { onDelete: "restrict" }),
    publicationStatus: text("publication_status", {
      enum: ["draft", "published", "archived"],
    })
      .notNull()
      .default("draft"),
    isFeatured: integer("is_featured", { mode: "boolean" })
      .notNull()
      .default(false),
    description: text("description"),
    publicGroupUrl: text("public_group_url"),
    publishedAt: integer("published_at"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("club_public_profiles_org_club_unique").on(
      table.organizationId,
      table.clubId,
    ),
    index("club_public_profiles_public_featured_idx").on(
      table.organizationId,
      table.publicationStatus,
      table.isFeatured,
      table.deletedAt,
    ),
    index("club_public_profiles_lane_idx").on(
      table.organizationId,
      table.primaryEventLaneId,
      table.publicationStatus,
      table.deletedAt,
    ),
    check(
      "club_public_profiles_published_at_check",
      sql`${table.publicationStatus} <> 'published' OR ${table.publishedAt} IS NOT NULL`,
    ),
  ],
);

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    colorToken: text("color_token"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("categories_org_slug_unique").on(
      table.organizationId,
      table.slug,
    ),
    index("categories_org_active_idx").on(
      table.organizationId,
      table.deletedAt,
    ),
  ],
);

export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clubId: text("club_id").references(() => clubs.id, {
      onDelete: "cascade",
    }),
    tokenHash: text("token_hash").notNull(),
    targetNormalizedEmail: text("target_normalized_email").notNull(),
    intendedRole: text("intended_role", {
      enum: ["owner", "administrator", "organizer"],
    }).notNull(),
    createdByProfileId: text("created_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    usedAt: integer("used_at"),
    usedByProfileId: text("used_by_profile_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
    index("invitations_target_lookup_idx").on(
      table.organizationId,
      table.targetNormalizedEmail,
      table.expiresAt,
    ),
    check("invitations_token_hash_check", sql`length(${table.tokenHash}) = 64`),
    check(
      "invitations_target_email_check",
      sql`${table.targetNormalizedEmail} = lower(trim(${table.targetNormalizedEmail}))`,
    ),
    check(
      "invitations_terminal_state_check",
      sql`NOT (${table.revokedAt} IS NOT NULL AND ${table.usedAt} IS NOT NULL)`,
    ),
  ],
);

export const venues = sqliteTable(
  "venues",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    timezone: text("timezone").notNull().default("America/Vancouver"),
    publicLocationName: text("public_location_name"),
    publicAddress: text("public_address"),
    privateAddress: text("private_address"),
    privateDirections: text("private_directions"),
    accessibilityNotes: text("accessibility_notes"),
    isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
    createdByProfileId: text("created_by_profile_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    updatedByProfileId: text("updated_by_profile_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("venues_org_slug_unique").on(table.organizationId, table.slug),
    index("venues_org_public_idx").on(
      table.organizationId,
      table.isPublic,
      table.deletedAt,
    ),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clubId: text("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "restrict" }),
    programId: text("program_id").references(() => programs.id, {
      onDelete: "set null",
    }),
    eventLaneId: text("event_lane_id").references(() => eventLanes.id, {
      onDelete: "set null",
    }),
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    venueId: text("venue_id").references(() => venues.id, {
      onDelete: "set null",
    }),
    primaryOrganizerProfileId: text(
      "primary_organizer_profile_id",
    ).references(() => profiles.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    summary: text("summary"),
    description: text("description"),
    status: text("status", {
      enum: [
        "idea",
        "draft",
        "hold",
        "tentative",
        "confirmed",
        "cancelled",
        "archived",
      ],
    })
      .notNull()
      .default("draft"),
    visibility: text("visibility", {
      enum: ["public", "members", "private"],
    })
      .notNull()
      .default("private"),
    timeKind: text("time_kind", { enum: ["timed", "all_day"] }).notNull(),
    startsAtUtc: integer("starts_at_utc"),
    endsAtUtc: integer("ends_at_utc"),
    timezone: text("timezone").notNull().default("America/Vancouver"),
    allDayStartDate: text("all_day_start_date"),
    allDayEndDateExclusive: text("all_day_end_date_exclusive"),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    organizerScopeJson: text("organizer_scope_json").notNull().default("[]"),
    scheduleVersion: integer("schedule_version").notNull().default(1),
    scheduleReviewState: text("schedule_review_state", {
      enum: ["unreviewed", "reviewed", "overridden"],
    })
      .notNull()
      .default("unreviewed"),
    holdExpiresAt: integer("hold_expires_at"),
    privateNotes: text("private_notes"),
    privateMeetingDetails: text("private_meeting_details"),
    publishedAt: integer("published_at"),
    createdByProfileId: text("created_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("events_org_slug_unique").on(table.organizationId, table.slug),
    index("events_public_projection_idx").on(
      table.organizationId,
      table.visibility,
      table.status,
      table.publishedAt,
      table.deletedAt,
    ),
    index("events_timed_conflict_scan_idx").on(
      table.organizationId,
      table.status,
      table.holdExpiresAt,
      table.startsAtUtc,
      table.endsAtUtc,
      table.deletedAt,
    ),
    index("events_venue_conflict_idx").on(
      table.organizationId,
      table.venueId,
      table.startsAtUtc,
      table.endsAtUtc,
    ),
    index("events_primary_organizer_conflict_idx").on(
      table.organizationId,
      table.primaryOrganizerProfileId,
      table.startsAtUtc,
      table.endsAtUtc,
    ),
    index("events_org_club_archive_idx").on(
      table.organizationId,
      table.clubId,
      table.deletedAt,
    ),
    check(
      "events_nonnegative_buffers_check",
      sql`${table.bufferBeforeMinutes} >= 0 AND ${table.bufferAfterMinutes} >= 0`,
    ),
    check("events_schedule_version_check", sql`${table.scheduleVersion} >= 1`),
    check(
      "events_hold_expiry_shape_check",
      sql`(
        ${table.status} = 'hold'
        AND ${table.holdExpiresAt} IS NOT NULL
      ) OR (
        ${table.status} <> 'hold'
        AND ${table.holdExpiresAt} IS NULL
      )`,
    ),
    check(
      "events_organizer_scope_json_check",
      sql`json_valid(${table.organizerScopeJson}) AND json_type(${table.organizerScopeJson}) = 'array'`,
    ),
    check(
      "events_time_shape_check",
      sql`(
        ${table.timeKind} = 'timed'
        AND ${table.startsAtUtc} IS NOT NULL
        AND ${table.endsAtUtc} IS NOT NULL
        AND ${table.endsAtUtc} > ${table.startsAtUtc}
        AND ${table.allDayStartDate} IS NULL
        AND ${table.allDayEndDateExclusive} IS NULL
      ) OR (
        ${table.timeKind} = 'all_day'
        AND ${table.startsAtUtc} IS NULL
        AND ${table.endsAtUtc} IS NULL
        AND ${table.allDayStartDate} IS NOT NULL
        AND ${table.allDayEndDateExclusive} IS NOT NULL
        AND ${table.allDayEndDateExclusive} > ${table.allDayStartDate}
      )`,
    ),
  ],
);

export const eventPublicDetails = sqliteTable(
  "event_public_details",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => events.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    attendanceMode: text("attendance_mode", {
      enum: [
        "in_person",
        "online",
        "hybrid",
        "location_undecided",
      ],
    })
      .notNull()
      .default("location_undecided"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    index("event_public_details_org_mode_idx").on(
      table.organizationId,
      table.attendanceMode,
      table.eventId,
    ),
    check(
      "event_public_details_attendance_mode_check",
      sql`${table.attendanceMode} IN ('in_person', 'online', 'hybrid', 'location_undecided')`,
    ),
  ],
);

export const eventOrganizers = sqliteTable(
  "event_organizers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    role: text("role", { enum: ["primary", "co_organizer"] }).notNull(),
    isPubliclyListed: integer("is_publicly_listed", { mode: "boolean" })
      .notNull()
      .default(false),
    createdByProfileId: text("created_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("event_organizers_event_profile_unique").on(
      table.eventId,
      table.profileId,
    ),
    index("event_organizers_conflict_lookup_idx").on(
      table.organizationId,
      table.profileId,
      table.deletedAt,
      table.eventId,
    ),
  ],
);

export const eventRevisions = sqliteTable(
  "event_revisions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    scheduleVersion: integer("schedule_version").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    reason: text("reason"),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("event_revisions_event_version_unique").on(
      table.eventId,
      table.scheduleVersion,
    ),
    index("event_revisions_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    check(
      "event_revisions_snapshot_json_check",
      sql`json_valid(${table.snapshotJson})`,
    ),
  ],
);

/**
 * Canonical writable store for Phase 3 source-free planning records.
 *
 * The legacy `events` table remains the immutable compatibility source for
 * already reserving, published, and Meetup-controlled rows. The organizer
 * domain maps both stores into one service model, but only this table accepts
 * Phase 3 manual writes. Runtime guards currently restrict those writes to
 * private Ideas and Drafts.
 */
export const organizerEvents = sqliteTable(
  "organizer_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clubId: text("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "restrict" }),
    programId: text("program_id").references(() => programs.id, {
      onDelete: "set null",
    }),
    eventLaneId: text("event_lane_id").references(() => eventLanes.id, {
      onDelete: "set null",
    }),
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    venueId: text("venue_id").references(() => venues.id, {
      onDelete: "set null",
    }),
    primaryOrganizerProfileId: text("primary_organizer_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    summary: text("summary"),
    description: text("description"),
    privateNotes: text("private_notes"),
    privateMeetingDetails: text("private_meeting_details"),
    meetupEventUrl: text("meetup_event_url"),
    planningStatus: text("planning_status", {
      enum: [
        "idea",
        "draft",
        "tentative_hold",
        "confirmed",
        "cancelled",
        "completed",
        "archived",
      ],
    })
      .notNull()
      .default("idea"),
    publicationStatus: text("publication_status", {
      enum: ["private", "scheduled", "published", "unpublished"],
    })
      .notNull()
      .default("private"),
    scheduleShape: text("schedule_shape", {
      enum: ["unscheduled", "timed", "all_day"],
    })
      .notNull()
      .default("unscheduled"),
    startsAtUtc: integer("starts_at_utc"),
    endsAtUtc: integer("ends_at_utc"),
    timezone: text("timezone").notNull().default("America/Vancouver"),
    allDayStartDate: text("all_day_start_date"),
    allDayEndDateExclusive: text("all_day_end_date_exclusive"),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    contentVersion: integer("content_version").notNull().default(1),
    scheduleVersion: integer("schedule_version").notNull().default(1),
    createdByProfileId: text("created_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("organizer_events_org_slug_unique").on(
      table.organizationId,
      table.slug,
    ),
    index("organizer_events_org_schedule_idx").on(
      table.organizationId,
      table.deletedAt,
      table.scheduleShape,
      table.startsAtUtc,
      table.allDayStartDate,
    ),
    index("organizer_events_org_status_idx").on(
      table.organizationId,
      table.planningStatus,
      table.publicationStatus,
      table.deletedAt,
      table.updatedAt,
    ),
    index("organizer_events_org_club_idx").on(
      table.organizationId,
      table.clubId,
      table.deletedAt,
      table.updatedAt,
    ),
    index("organizer_events_primary_organizer_idx").on(
      table.organizationId,
      table.primaryOrganizerProfileId,
      table.deletedAt,
      table.updatedAt,
    ),
    check(
      "organizer_events_planning_status_check",
      sql`${table.planningStatus} IN ('idea', 'draft', 'tentative_hold', 'confirmed', 'cancelled', 'completed', 'archived')`,
    ),
    check(
      "organizer_events_publication_status_check",
      sql`${table.publicationStatus} IN ('private', 'scheduled', 'published', 'unpublished')`,
    ),
    check(
      "organizer_events_schedule_shape_check",
      sql`(
        ${table.scheduleShape} = 'unscheduled'
        AND ${table.planningStatus} = 'idea'
        AND ${table.startsAtUtc} IS NULL
        AND ${table.endsAtUtc} IS NULL
        AND ${table.allDayStartDate} IS NULL
        AND ${table.allDayEndDateExclusive} IS NULL
      ) OR (
        ${table.scheduleShape} = 'timed'
        AND ${table.startsAtUtc} IS NOT NULL
        AND ${table.endsAtUtc} IS NOT NULL
        AND ${table.endsAtUtc} > ${table.startsAtUtc}
        AND ${table.allDayStartDate} IS NULL
        AND ${table.allDayEndDateExclusive} IS NULL
      ) OR (
        ${table.scheduleShape} = 'all_day'
        AND ${table.startsAtUtc} IS NULL
        AND ${table.endsAtUtc} IS NULL
        AND ${table.allDayStartDate} IS NOT NULL
        AND ${table.allDayEndDateExclusive} IS NOT NULL
        AND ${table.allDayEndDateExclusive} > ${table.allDayStartDate}
      )`,
    ),
    check(
      "organizer_events_version_check",
      sql`${table.contentVersion} >= 1 AND ${table.scheduleVersion} >= 1`,
    ),
    check(
      "organizer_events_buffer_check",
      sql`${table.bufferBeforeMinutes} >= 0 AND ${table.bufferAfterMinutes} >= 0`,
    ),
  ],
);

export const organizerEventOrganizers = sqliteTable(
  "organizer_event_organizers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    organizerEventId: text("organizer_event_id")
      .notNull()
      .references(() => organizerEvents.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdByProfileId: text("created_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("organizer_event_organizers_event_profile_unique").on(
      table.organizerEventId,
      table.profileId,
    ),
    index("organizer_event_organizers_profile_idx").on(
      table.organizationId,
      table.profileId,
      table.deletedAt,
      table.organizerEventId,
    ),
  ],
);

export const organizerEventRevisions = sqliteTable(
  "organizer_event_revisions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    organizerEventId: text("organizer_event_id")
      .notNull()
      .references(() => organizerEvents.id, { onDelete: "cascade" }),
    contentVersion: integer("content_version").notNull(),
    scheduleVersion: integer("schedule_version").notNull(),
    action: text("action", {
      enum: ["created", "updated", "duplicated", "deleted", "restored"],
    }).notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("organizer_event_revisions_event_content_version_unique").on(
      table.organizerEventId,
      table.contentVersion,
    ),
    index("organizer_event_revisions_org_event_idx").on(
      table.organizationId,
      table.organizerEventId,
      table.createdAt,
    ),
    check(
      "organizer_event_revisions_version_check",
      sql`${table.contentVersion} >= 1 AND ${table.scheduleVersion} >= 1`,
    ),
    check(
      "organizer_event_revisions_snapshot_json_check",
      sql`json_valid(${table.snapshotJson})`,
    ),
  ],
);

export const conflictPolicies = sqliteTable(
  "conflict_policies",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    reservingStatusesJson: text("reserving_statuses_json")
      .notNull()
      .default('["hold","tentative","confirmed"]'),
    blockVenueOverlap: integer("block_venue_overlap", { mode: "boolean" })
      .notNull()
      .default(true),
    blockOrganizerOverlap: integer("block_organizer_overlap", {
      mode: "boolean",
    })
      .notNull()
      .default(true),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdByProfileId: text("created_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("conflict_policies_org_slug_unique").on(
      table.organizationId,
      table.slug,
    ),
    index("conflict_policies_org_active_idx").on(
      table.organizationId,
      table.isActive,
      table.deletedAt,
    ),
    check(
      "conflict_policies_statuses_json_check",
      sql`json_valid(${table.reservingStatusesJson}) AND json_type(${table.reservingStatusesJson}) = 'array'`,
    ),
  ],
);

export const conflictIncidents = sqliteTable(
  "conflict_incidents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    conflictingEventId: text("conflicting_event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    policyId: text("policy_id").references(() => conflictPolicies.id, {
      onDelete: "set null",
    }),
    resourceType: text("resource_type", {
      enum: ["venue", "organizer"],
    }).notNull(),
    resourceId: text("resource_id").notNull(),
    proposedStartUtc: integer("proposed_start_utc").notNull(),
    proposedEndUtc: integer("proposed_end_utc").notNull(),
    state: text("state", {
      enum: ["open", "overridden", "resolved"],
    })
      .notNull()
      .default("open"),
    detectedByProfileId: text("detected_by_profile_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at").notNull().default(nowMs),
    resolvedAt: integer("resolved_at"),
  },
  (table) => [
    index("conflict_incidents_event_state_idx").on(
      table.organizationId,
      table.eventId,
      table.state,
    ),
    check(
      "conflict_incidents_interval_check",
      sql`${table.proposedEndUtc} > ${table.proposedStartUtc}`,
    ),
  ],
);

export const conflictOverrides = sqliteTable(
  "conflict_overrides",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conflictIncidentId: text("conflict_incident_id")
      .notNull()
      .references(() => conflictIncidents.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    revokedAt: integer("revoked_at"),
    revokedByProfileId: text("revoked_by_profile_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
  },
  (table) => [
    uniqueIndex("conflict_overrides_active_incident_unique")
      .on(table.conflictIncidentId)
      .where(sql`${table.revokedAt} IS NULL`),
    index("conflict_overrides_org_event_idx").on(
      table.organizationId,
      table.eventId,
    ),
  ],
);

export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    status: text("status", { enum: ["draft", "published", "archived"] })
      .notNull()
      .default("draft"),
    visibility: text("visibility", { enum: ["public", "private"] })
      .notNull()
      .default("private"),
    currentRevision: integer("current_revision").notNull().default(1),
    publishedAt: integer("published_at"),
    createdByProfileId: text("created_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("pages_org_slug_unique").on(table.organizationId, table.slug),
    index("pages_public_idx").on(
      table.organizationId,
      table.status,
      table.visibility,
      table.deletedAt,
    ),
  ],
);

export const pageSections = sqliteTable(
  "page_sections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    sectionKey: text("section_key").notNull(),
    sectionType: text("section_type").notNull(),
    contentJson: text("content_json").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("page_sections_page_key_unique").on(
      table.pageId,
      table.sectionKey,
    ),
    index("page_sections_page_sort_idx").on(
      table.pageId,
      table.sortOrder,
      table.deletedAt,
    ),
    check(
      "page_sections_content_json_check",
      sql`json_valid(${table.contentJson})`,
    ),
  ],
);

export const pageRevisions = sqliteTable(
  "page_revisions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("page_revisions_page_number_unique").on(
      table.pageId,
      table.revisionNumber,
    ),
    check(
      "page_revisions_snapshot_json_check",
      sql`json_valid(${table.snapshotJson})`,
    ),
  ],
);

export const communityLinks = sqliteTable(
  "community_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    url: text("url").notNull(),
    linkType: text("link_type").notNull(),
    isPublished: integer("is_published", { mode: "boolean" })
      .notNull()
      .default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdByProfileId: text("created_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("community_links_org_url_unique").on(
      table.organizationId,
      table.url,
    ),
    index("community_links_public_sort_idx").on(
      table.organizationId,
      table.isPublished,
      table.sortOrder,
    ),
  ],
);

export const mediaAssets = sqliteTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    altText: text("alt_text"),
    credit: text("credit"),
    rightsStatus: text("rights_status", {
      enum: ["unconfirmed", "approved", "restricted"],
    })
      .notNull()
      .default("unconfirmed"),
    participantConsentStatus: text("participant_consent_status", {
      enum: ["not_applicable", "unconfirmed", "confirmed"],
    })
      .notNull()
      .default("unconfirmed"),
    isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
    uploadedByProfileId: text("uploaded_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("media_assets_org_object_key_unique").on(
      table.organizationId,
      table.objectKey,
    ),
    index("media_assets_org_public_idx").on(
      table.organizationId,
      table.isPublic,
      table.deletedAt,
    ),
    check("media_assets_byte_size_check", sql`${table.byteSize} >= 0`),
  ],
);

export const navigationItems = sqliteTable(
  "navigation_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    placement: text("placement", { enum: ["header", "footer"] }).notNull(),
    pageId: text("page_id").references(() => pages.id, {
      onDelete: "set null",
    }),
    externalUrl: text("external_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: integer("is_published", { mode: "boolean" })
      .notNull()
      .default(false),
    createdByProfileId: text("created_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    index("navigation_items_org_placement_sort_idx").on(
      table.organizationId,
      table.placement,
      table.isPublished,
      table.sortOrder,
    ),
    check(
      "navigation_items_target_check",
      sql`(${table.pageId} IS NOT NULL AND ${table.externalUrl} IS NULL) OR (${table.pageId} IS NULL AND ${table.externalUrl} IS NOT NULL)`,
    ),
  ],
);

export const siteSettings = sqliteTable(
  "site_settings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    valueJson: text("value_json").notNull(),
    isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("site_settings_org_key_unique").on(
      table.organizationId,
      table.key,
    ),
    index("site_settings_public_idx").on(
      table.organizationId,
      table.isPublic,
    ),
    check(
      "site_settings_value_json_check",
      sql`json_valid(${table.valueJson})`,
    ),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recipientProfileId: text("recipient_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    index("notifications_recipient_unread_idx").on(
      table.recipientProfileId,
      table.readAt,
      table.createdAt,
      table.deletedAt,
    ),
    check(
      "notifications_payload_json_check",
      sql`json_valid(${table.payloadJson})`,
    ),
  ],
);

export const notificationPreferences = sqliteTable(
  "notification_preferences",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    notificationType: text("notification_type").notNull(),
    channel: text("channel", { enum: ["in_app"] })
      .notNull()
      .default("in_app"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("notification_preferences_scope_unique").on(
      table.organizationId,
      table.profileId,
      table.notificationType,
      table.channel,
    ),
  ],
);

export const formSubmissions = sqliteTable(
  "form_submissions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    formKey: text("form_key").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status", {
      enum: ["new", "in_review", "resolved", "spam"],
    })
      .notNull()
      .default("new"),
    submittedByProfileId: text("submitted_by_profile_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    assignedToProfileId: text("assigned_to_profile_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    index("form_submissions_org_status_idx").on(
      table.organizationId,
      table.formKey,
      table.status,
      table.createdAt,
    ),
    check(
      "form_submissions_payload_json_check",
      sql`json_valid(${table.payloadJson})`,
    ),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorProfileId: text("actor_profile_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (table) => [
    index("audit_logs_org_entity_idx").on(
      table.organizationId,
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    index("audit_logs_org_actor_idx").on(
      table.organizationId,
      table.actorProfileId,
      table.createdAt,
    ),
    check(
      "audit_logs_metadata_json_check",
      sql`json_valid(${table.metadataJson})`,
    ),
  ],
);

export const importBatches = sqliteTable(
  "import_batches",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceLabel: text("source_label"),
    status: text("status", {
      enum: ["pending", "processing", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    createdByProfileId: text("created_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    completedAt: integer("completed_at"),
  },
  (table) => [
    index("import_batches_org_status_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const importRows = sqliteTable(
  "import_rows",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    importBatchId: text("import_batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    sourcePayloadJson: text("source_payload_json").notNull(),
    normalizedPayloadJson: text("normalized_payload_json"),
    status: text("status", {
      enum: ["pending", "accepted", "rejected", "skipped"],
    })
      .notNull()
      .default("pending"),
    errorCode: text("error_code"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("import_rows_batch_number_unique").on(
      table.importBatchId,
      table.rowNumber,
    ),
    index("import_rows_batch_status_idx").on(
      table.importBatchId,
      table.status,
    ),
    check(
      "import_rows_source_payload_json_check",
      sql`json_valid(${table.sourcePayloadJson})`,
    ),
    check(
      "import_rows_normalized_payload_json_check",
      sql`${table.normalizedPayloadJson} IS NULL OR json_valid(${table.normalizedPayloadJson})`,
    ),
  ],
);

export const externalSourceLinks = sqliteTable(
  "external_source_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    sourceType: text("source_type").notNull(),
    syncSourceId: text("sync_source_id"),
    externalId: text("external_id").notNull(),
    externalUrl: text("external_url"),
    sourceFingerprint: text("source_fingerprint"),
    sourceSequence: integer("source_sequence"),
    sourceLastModifiedAt: integer("source_last_modified_at"),
    lastImportedAt: integer("last_imported_at"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("external_source_links_source_unique").on(
      table.organizationId,
      table.sourceType,
      table.syncSourceId,
      table.externalId,
    ),
    index("external_source_links_entity_idx").on(
      table.organizationId,
      table.entityType,
      table.entityId,
      table.deletedAt,
    ),
    index("external_source_links_sync_source_idx").on(
      table.organizationId,
      table.syncSourceId,
      table.deletedAt,
    ),
    check(
      "external_source_links_meetup_source_check",
      sql`${table.sourceType} <> 'meetup_ics' OR ${table.syncSourceId} IS NOT NULL`,
    ),
  ],
);

export const syncSources = sqliteTable(
  "sync_sources",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clubId: text("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "restrict" }),
    sourceType: text("source_type", { enum: ["meetup_ics"] }).notNull(),
    sourceUrl: text("source_url").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    refreshIntervalMinutes: integer("refresh_interval_minutes")
      .notNull()
      .default(15),
    nextRefreshAt: integer("next_refresh_at"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: integer("lease_expires_at"),
    lastAttemptAt: integer("last_attempt_at"),
    lastSuccessAt: integer("last_success_at"),
    lastErrorAt: integer("last_error_at"),
    lastErrorCode: text("last_error_code"),
    etag: text("etag"),
    httpLastModified: text("http_last_modified"),
    activeGenerationId: text("active_generation_id"),
    pendingGenerationId: text("pending_generation_id"),
    pendingSnapshotHash: text("pending_snapshot_hash"),
    pendingCursor: integer("pending_cursor"),
    createdByProfileId: text("created_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("sync_sources_org_club_type_unique").on(
      table.organizationId,
      table.clubId,
      table.sourceType,
    ),
    uniqueIndex("sync_sources_org_type_url_unique").on(
      table.organizationId,
      table.sourceType,
      table.sourceUrl,
    ),
    index("sync_sources_due_idx").on(
      table.enabled,
      table.nextRefreshAt,
      table.leaseExpiresAt,
    ),
    index("sync_sources_org_club_idx").on(
      table.organizationId,
      table.clubId,
      table.deletedAt,
    ),
    check(
      "sync_sources_refresh_interval_check",
      sql`${table.refreshIntervalMinutes} >= 15`,
    ),
    check(
      "sync_sources_lease_shape_check",
      sql`(
        ${table.leaseToken} IS NULL
        AND ${table.leaseExpiresAt} IS NULL
      ) OR (
        ${table.leaseToken} IS NOT NULL
        AND ${table.leaseExpiresAt} IS NOT NULL
      )`,
    ),
    check(
      "sync_sources_pending_shape_check",
      sql`(
        ${table.pendingGenerationId} IS NULL
        AND
        ${table.pendingSnapshotHash} IS NULL
        AND ${table.pendingCursor} IS NULL
      ) OR (
        ${table.pendingGenerationId} IS NOT NULL
        AND length(${table.pendingGenerationId}) > 0
        AND
        ${table.pendingSnapshotHash} IS NOT NULL
        AND length(${table.pendingSnapshotHash}) = 64
        AND ${table.pendingCursor} IS NOT NULL
        AND ${table.pendingCursor} >= 0
      )`,
    ),
  ],
);

export const meetupSyncGenerations = sqliteTable(
  "meetup_sync_generations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    syncSourceId: text("sync_source_id")
      .notNull()
      .references(() => syncSources.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    previousGenerationId: text("previous_generation_id"),
    snapshotHash: text("snapshot_hash").notNull(),
    expectedItemCount: integer("expected_item_count").notNull(),
    processedItemCount: integer("processed_item_count").notNull().default(0),
    rejectedItemCount: integer("rejected_item_count").notNull().default(0),
    state: text("state", {
      enum: ["staging", "published", "abandoned", "failed"],
    })
      .notNull()
      .default("staging"),
    removedCount: integer("removed_count").notNull().default(0),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    publishedAt: integer("published_at"),
    failedAt: integer("failed_at"),
  },
  (table) => [
    uniqueIndex("meetup_sync_generations_source_hash_id_unique").on(
      table.syncSourceId,
      table.snapshotHash,
      table.id,
    ),
    index("meetup_sync_generations_source_state_idx").on(
      table.syncSourceId,
      table.state,
      table.createdAt,
    ),
    check(
      "meetup_sync_generations_snapshot_hash_check",
      sql`length(${table.snapshotHash}) = 64`,
    ),
    check(
      "meetup_sync_generations_expected_count_check",
      sql`${table.expectedItemCount} >= 0`,
    ),
    check(
      "meetup_sync_generations_processed_count_check",
      sql`${table.processedItemCount} >= 0 AND ${table.processedItemCount} <= ${table.expectedItemCount}`,
    ),
    check(
      "meetup_sync_generations_rejected_count_check",
      sql`${table.rejectedItemCount} >= 0 AND ${table.rejectedItemCount} <= ${table.processedItemCount}`,
    ),
    check(
      "meetup_sync_generations_removed_count_check",
      sql`${table.removedCount} >= 0`,
    ),
    check(
      "meetup_sync_generations_state_shape_check",
      sql`(
        ${table.state} = 'published'
        AND ${table.publishedAt} IS NOT NULL
        AND ${table.failedAt} IS NULL
      ) OR (
        ${table.state} = 'failed'
        AND ${table.publishedAt} IS NULL
        AND ${table.failedAt} IS NOT NULL
      ) OR (
        ${table.state} IN ('staging', 'abandoned')
        AND ${table.publishedAt} IS NULL
        AND ${table.failedAt} IS NULL
      )`,
    ),
  ],
);

export const meetupEventSnapshots = sqliteTable(
  "meetup_event_snapshots",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    syncSourceId: text("sync_source_id")
      .notNull()
      .references(() => syncSources.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    generationId: text("generation_id")
      .notNull()
      .references(() => meetupSyncGenerations.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    eventSlug: text("event_slug").notNull(),
    title: text("title").notNull(),
    eventUrl: text("event_url").notNull(),
    status: text("status", {
      enum: ["confirmed", "tentative", "cancelled"],
    }).notNull(),
    timeKind: text("time_kind", { enum: ["timed", "all_day"] }).notNull(),
    startsAtUtc: integer("starts_at_utc"),
    endsAtUtc: integer("ends_at_utc"),
    timezone: text("timezone").notNull(),
    allDayStartDate: text("all_day_start_date"),
    allDayEndDateExclusive: text("all_day_end_date_exclusive"),
    sourceFingerprint: text("source_fingerprint").notNull(),
    sourceSequence: integer("source_sequence"),
    sourceLastModifiedAt: integer("source_last_modified_at"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("meetup_event_snapshots_generation_external_unique").on(
      table.syncSourceId,
      table.generationId,
      table.externalId,
    ),
    index("meetup_event_snapshots_public_timed_idx").on(
      table.organizationId,
      table.syncSourceId,
      table.generationId,
      table.status,
      table.endsAtUtc,
    ),
    index("meetup_event_snapshots_public_all_day_idx").on(
      table.organizationId,
      table.syncSourceId,
      table.generationId,
      table.status,
      table.allDayEndDateExclusive,
    ),
    index("meetup_event_snapshots_event_idx").on(
      table.organizationId,
      table.eventId,
    ),
    check(
      "meetup_event_snapshots_ordinal_check",
      sql`${table.ordinal} >= 0`,
    ),
    check(
      "meetup_event_snapshots_time_shape_check",
      sql`(
        ${table.timeKind} = 'timed'
        AND ${table.startsAtUtc} IS NOT NULL
        AND ${table.endsAtUtc} IS NOT NULL
        AND ${table.endsAtUtc} > ${table.startsAtUtc}
        AND ${table.allDayStartDate} IS NULL
        AND ${table.allDayEndDateExclusive} IS NULL
      ) OR (
        ${table.timeKind} = 'all_day'
        AND ${table.startsAtUtc} IS NULL
        AND ${table.endsAtUtc} IS NULL
        AND ${table.allDayStartDate} IS NOT NULL
        AND ${table.allDayEndDateExclusive} IS NOT NULL
        AND ${table.allDayEndDateExclusive} > ${table.allDayStartDate}
      )`,
    ),
  ],
);

export const icsSubscriptionTokens = sqliteTable(
  "ics_subscription_tokens",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    label: text("label"),
    createdAt: integer("created_at").notNull().default(nowMs),
    lastUsedAt: integer("last_used_at"),
    revokedAt: integer("revoked_at"),
  },
  (table) => [
    uniqueIndex("ics_subscription_tokens_hash_unique").on(table.tokenHash),
    index("ics_subscription_tokens_profile_idx").on(
      table.organizationId,
      table.profileId,
      table.revokedAt,
    ),
    check(
      "ics_subscription_tokens_hash_check",
      sql`length(${table.tokenHash}) = 64`,
    ),
  ],
);
