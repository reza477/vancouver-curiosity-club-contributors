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

/**
 * Exact transaction envelope for owner/administrator taxonomy mutations.
 *
 * Taxonomy rows predate Phase 6 and remain the canonical scheduling
 * identities. The intent binds the complete proposed base/state value so
 * runtime guards can reject direct writes that omit optimistic versioning,
 * immutable audit history, or reference-safe archive/delete checks.
 */
export const taxonomyWriteIntents = sqliteTable(
  "taxonomy_write_intents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entityType: text("entity_type", {
      enum: ["lane", "category"],
    }).notNull(),
    entityId: text("entity_id").notNull(),
    operation: text("operation", {
      enum: [
        "adopt",
        "create",
        "update",
        "reorder",
        "archive",
        "safe_delete",
      ],
    }).notNull(),
    expectedContentVersion: integer(
      "expected_content_version",
    ).notNull(),
    proposedContentVersion: integer(
      "proposed_content_version",
    ).notNull(),
    proposedName: text("proposed_name").notNull(),
    proposedSlug: text("proposed_slug").notNull(),
    proposedDescription: text("proposed_description"),
    proposedColorToken: text("proposed_color_token"),
    proposedSortOrder: integer("proposed_sort_order").notNull(),
    proposedDeletedAt: integer("proposed_deleted_at"),
    mutationGroupId: text("mutation_group_id"),
    mutationGroupSize: integer("mutation_group_size"),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    completedAt: integer("completed_at"),
  },
  (table) => [
    uniqueIndex("taxonomy_write_intents_open_entity_unique")
      .on(table.organizationId, table.entityType, table.entityId)
      .where(sql`${table.completedAt} IS NULL`),
    index("taxonomy_write_intents_entity_history_idx").on(
      table.organizationId,
      table.entityType,
      table.entityId,
      table.proposedContentVersion,
    ),
    uniqueIndex("taxonomy_write_intents_entity_version_unique").on(
      table.organizationId,
      table.entityType,
      table.entityId,
      table.proposedContentVersion,
    ),
    index("taxonomy_write_intents_open_idx").on(
      table.organizationId,
      table.completedAt,
      table.createdAt,
    ),
    uniqueIndex("taxonomy_write_intents_reorder_group_sort_unique")
      .on(
        table.organizationId,
        table.entityType,
        table.mutationGroupId,
        table.proposedSortOrder,
      )
      .where(sql`${table.operation} = 'reorder'`),
    index("taxonomy_write_intents_reorder_group_idx").on(
      table.organizationId,
      table.entityType,
      table.mutationGroupId,
      table.completedAt,
    ),
    check(
      "taxonomy_write_intents_operation_check",
      sql`${table.operation} IN (
        'adopt', 'create', 'update', 'reorder', 'archive', 'safe_delete'
      )`,
    ),
    check(
      "taxonomy_write_intents_version_check",
      sql`${table.expectedContentVersion} >= 0
          AND ${table.proposedContentVersion} =
              ${table.expectedContentVersion} + 1
          AND (
            (
              ${table.operation} IN ('adopt', 'create')
              AND ${table.expectedContentVersion} = 0
            )
            OR (
              ${table.operation} NOT IN ('adopt', 'create')
              AND ${table.expectedContentVersion} >= 1
            )
          )`,
    ),
    check(
      "taxonomy_write_intents_public_fields_check",
      sql`length(trim(${table.proposedName})) BETWEEN 1 AND 120
          AND length(${table.proposedSlug}) BETWEEN 1 AND 160
          AND ${table.proposedSlug} = lower(${table.proposedSlug})
          AND ${table.proposedSlug} NOT GLOB '*[^a-z0-9-]*'
          AND ${table.proposedSlug} NOT GLOB '-*'
          AND ${table.proposedSlug} NOT GLOB '*-'
          AND instr(${table.proposedSlug}, '--') = 0
          AND (
            ${table.proposedDescription} IS NULL
            OR length(${table.proposedDescription}) BETWEEN 1 AND 1000
          )
          AND (
            ${table.proposedColorToken} IS NULL
            OR (
              length(${table.proposedColorToken}) BETWEEN 1 AND 64
              AND ${table.proposedColorToken} =
                  lower(${table.proposedColorToken})
              AND ${table.proposedColorToken} GLOB '[a-z]*'
              AND ${table.proposedColorToken}
                  NOT GLOB '*[^a-z0-9-]*'
              AND instr(${table.proposedColorToken}, '--') = 0
              AND ${table.proposedColorToken} NOT GLOB '*-'
            )
          )
          AND ${table.proposedSortOrder} BETWEEN 0 AND 100000
          AND (
            ${table.entityType} <> 'lane'
            OR ${table.proposedColorToken} IS NULL
          )`,
    ),
    check(
      "taxonomy_write_intents_state_shape_check",
      sql`(
        ${table.operation} IN ('create', 'update', 'reorder')
        AND ${table.proposedDeletedAt} IS NULL
      ) OR (
        ${table.operation} IN ('archive', 'safe_delete')
        AND ${table.proposedDeletedAt} IS NOT NULL
      ) OR ${table.operation} = 'adopt'`,
    ),
    check(
      "taxonomy_write_intents_group_shape_check",
      sql`(
        ${table.operation} = 'reorder'
        AND length(${table.mutationGroupId}) BETWEEN 1 AND 128
        AND ${table.mutationGroupSize} BETWEEN 1 AND 100
        AND ${table.proposedSortOrder} BETWEEN 10 AND 1000
        AND ${table.proposedSortOrder} % 10 = 0
        AND ${table.proposedSortOrder} <=
            ${table.mutationGroupSize} * 10
      ) OR (
        ${table.operation} <> 'reorder'
        AND ${table.mutationGroupId} IS NULL
        AND ${table.mutationGroupSize} IS NULL
      )`,
    ),
    check(
      "taxonomy_write_intents_completion_check",
      sql`${table.completedAt} IS NULL
          OR ${table.completedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const eventLaneTaxonomyStates = sqliteTable(
  "event_lane_taxonomy_states",
  {
    laneId: text("lane_id")
      .primaryKey()
      .references(() => eventLanes.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contentVersion: integer("content_version").notNull().default(1),
    activeIntentId: text("active_intent_id").references(
      () => taxonomyWriteIntents.id,
      { onDelete: "restrict" },
    ),
    lastCompletedIntentId: text("last_completed_intent_id").references(
      () => taxonomyWriteIntents.id,
      { onDelete: "restrict" },
    ),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("event_lane_taxonomy_states_org_lane_unique").on(
      table.organizationId,
      table.laneId,
    ),
    check(
      "event_lane_taxonomy_states_version_check",
      sql`${table.contentVersion} >= 1`,
    ),
  ],
);

export const categoryTaxonomyStates = sqliteTable(
  "category_taxonomy_states",
  {
    categoryId: text("category_id")
      .primaryKey()
      .references(() => categories.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    contentVersion: integer("content_version").notNull().default(1),
    activeIntentId: text("active_intent_id").references(
      () => taxonomyWriteIntents.id,
      { onDelete: "restrict" },
    ),
    lastCompletedIntentId: text("last_completed_intent_id").references(
      () => taxonomyWriteIntents.id,
      { onDelete: "restrict" },
    ),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("category_taxonomy_states_org_category_unique").on(
      table.organizationId,
      table.categoryId,
    ),
    index("category_taxonomy_states_org_sort_idx").on(
      table.organizationId,
      table.sortOrder,
      table.categoryId,
    ),
    check(
      "category_taxonomy_states_sort_order_check",
      sql`${table.sortOrder} BETWEEN 0 AND 100000`,
    ),
    check(
      "category_taxonomy_states_version_check",
      sql`${table.contentVersion} >= 1`,
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
      enum: [
        "created",
        "updated",
        "duplicated",
        "deleted",
        "restored",
        "public_details_updated",
        "publication_scheduled",
        "publication_executed",
        "publication_cancelled",
        "published",
        "unpublished",
        "publicly_cancelled",
        "publication_restored",
      ],
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

/**
 * Phase 4's single active, organization-scoped scheduling policy. The legacy
 * conflict_policies table remains the immutable Phase 1 proof surface.
 */
export const organizerConflictPolicies = sqliteTable(
  "organizer_conflict_policies",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    mode: text("mode", {
      enum: ["warn_reason", "require_admin_approval", "block"],
    })
      .notNull()
      .default("warn_reason"),
    policyVersion: integer("policy_version").notNull().default(1),
    defaultHoldHours: integer("default_hold_hours").notNull().default(72),
    nearingExpiryHours: integer("nearing_expiry_hours").notNull().default(24),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("organizer_conflict_policies_org_unique").on(
      table.organizationId,
    ),
    index("organizer_conflict_policies_org_version_idx").on(
      table.organizationId,
      table.policyVersion,
    ),
    check(
      "organizer_conflict_policies_mode_check",
      sql`${table.mode} IN ('warn_reason', 'require_admin_approval', 'block')`,
    ),
    check(
      "organizer_conflict_policies_version_check",
      sql`${table.policyVersion} >= 1`,
    ),
    check(
      "organizer_conflict_policies_hold_check",
      sql`${table.defaultHoldHours} BETWEEN 1 AND 720
          AND ${table.nearingExpiryHours} BETWEEN 1 AND ${table.defaultHoldHours}`,
    ),
  ],
);

/**
 * A transaction-local, complete proposed scheduling state. Runtime guards
 * require a matching intent before any schedule-affecting organizer-event
 * mutation. Intents contain IDs and normalized facts only, never private
 * notes, identity headers, emails, or secrets.
 */
export const organizerScheduleWriteIntents = sqliteTable(
  "organizer_schedule_write_intents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    organizerEventId: text("organizer_event_id").notNull(),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    clubId: text("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "restrict" }),
    operation: text("operation").notNull(),
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
    }).notNull(),
    scheduleShape: text("schedule_shape", {
      enum: ["unscheduled", "timed", "all_day"],
    }).notNull(),
    actualStartUtc: integer("actual_start_utc"),
    actualEndUtc: integer("actual_end_utc"),
    expandedStartUtc: integer("expanded_start_utc"),
    expandedEndUtc: integer("expanded_end_utc"),
    timezone: text("timezone").notNull(),
    allDayStartDate: text("all_day_start_date"),
    allDayEndDateExclusive: text("all_day_end_date_exclusive"),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    venueId: text("venue_id").references(() => venues.id, {
      onDelete: "restrict",
    }),
    primaryOrganizerProfileId: text("primary_organizer_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    organizerScopeJson: text("organizer_scope_json").notNull(),
    holdExpiresAt: integer("hold_expires_at"),
    expectedContentVersion: integer("expected_content_version").notNull(),
    expectedScheduleVersion: integer("expected_schedule_version").notNull(),
    proposedContentVersion: integer("proposed_content_version").notNull(),
    proposedScheduleVersion: integer("proposed_schedule_version").notNull(),
    policyId: text("policy_id")
      .notNull()
      .references(() => organizerConflictPolicies.id, {
        onDelete: "restrict",
      }),
    policyVersion: integer("policy_version").notNull(),
    policyMode: text("policy_mode", {
      enum: ["warn_reason", "require_admin_approval", "block"],
    }).notNull(),
    reason: text("reason"),
    reviewRequestId: text("review_request_id"),
    stateFingerprint: text("state_fingerprint").notNull(),
    createdAt: integer("created_at").notNull().default(nowMs),
    completedAt: integer("completed_at"),
  },
  (table) => [
    index("organizer_schedule_write_intents_event_idx").on(
      table.organizationId,
      table.organizerEventId,
      table.createdAt,
    ),
    index("organizer_schedule_write_intents_actor_idx").on(
      table.organizationId,
      table.actorProfileId,
      table.createdAt,
    ),
    check(
      "organizer_schedule_write_intents_status_check",
      sql`${table.planningStatus} IN (
        'idea', 'draft', 'tentative_hold', 'confirmed', 'cancelled',
        'completed', 'archived'
      )`,
    ),
    check(
      "organizer_schedule_write_intents_policy_mode_check",
      sql`${table.policyMode} IN ('warn_reason', 'require_admin_approval', 'block')`,
    ),
    check(
      "organizer_schedule_write_intents_versions_check",
      sql`${table.expectedContentVersion} >= 0
          AND ${table.expectedScheduleVersion} >= 0
          AND ${table.proposedContentVersion} >= 1
          AND ${table.proposedScheduleVersion} >= 1
          AND ${table.policyVersion} >= 1`,
    ),
    check(
      "organizer_schedule_write_intents_scope_check",
      sql`json_valid(${table.organizerScopeJson})
          AND json_type(${table.organizerScopeJson}) = 'array'
          AND length(${table.organizerScopeJson}) <= 4096`,
    ),
    check(
      "organizer_schedule_write_intents_interval_check",
      sql`(
        ${table.scheduleShape} = 'unscheduled'
        AND ${table.planningStatus} IN ('idea', 'archived')
        AND ${table.actualStartUtc} IS NULL
        AND ${table.actualEndUtc} IS NULL
        AND ${table.expandedStartUtc} IS NULL
        AND ${table.expandedEndUtc} IS NULL
        AND ${table.allDayStartDate} IS NULL
        AND ${table.allDayEndDateExclusive} IS NULL
      ) OR (
        ${table.scheduleShape} = 'timed'
        AND ${table.actualStartUtc} IS NOT NULL
        AND ${table.actualEndUtc} > ${table.actualStartUtc}
        AND ${table.expandedStartUtc} IS NOT NULL
        AND ${table.expandedStartUtc} <= ${table.actualStartUtc}
        AND ${table.expandedEndUtc} >= ${table.actualEndUtc}
        AND ${table.allDayStartDate} IS NULL
        AND ${table.allDayEndDateExclusive} IS NULL
      ) OR (
        ${table.scheduleShape} = 'all_day'
        AND ${table.actualStartUtc} IS NOT NULL
        AND ${table.actualEndUtc} > ${table.actualStartUtc}
        AND ${table.expandedStartUtc} IS NOT NULL
        AND ${table.expandedStartUtc} <= ${table.actualStartUtc}
        AND ${table.expandedEndUtc} >= ${table.actualEndUtc}
        AND ${table.allDayStartDate} IS NOT NULL
        AND ${table.allDayEndDateExclusive} > ${table.allDayStartDate}
      )`,
    ),
    check(
      "organizer_schedule_write_intents_buffer_check",
      sql`${table.bufferBeforeMinutes} BETWEEN 0 AND 1440
          AND ${table.bufferAfterMinutes} BETWEEN 0 AND 1440
          AND (
            ${table.expandedStartUtc} IS NULL
            OR ${table.expandedStartUtc} =
               ${table.actualStartUtc} - (${table.bufferBeforeMinutes} * 60000)
          )
          AND (
            ${table.expandedEndUtc} IS NULL
            OR ${table.expandedEndUtc} =
               ${table.actualEndUtc} + (${table.bufferAfterMinutes} * 60000)
          )`,
    ),
    check(
      "organizer_schedule_write_intents_hold_check",
      sql`(
        ${table.planningStatus} = 'tentative_hold'
        AND ${table.scheduleShape} <> 'unscheduled'
        AND (
          ${table.holdExpiresAt} IS NOT NULL
          OR ${table.operation} = 'soft_delete'
        )
      ) OR (
        ${table.planningStatus} <> 'tentative_hold'
        AND ${table.holdExpiresAt} IS NULL
      )`,
    ),
    check(
      "organizer_schedule_write_intents_reason_check",
      sql`${table.reason} IS NULL
          OR (length(trim(${table.reason})) BETWEEN 1 AND 1000)`,
    ),
    check(
      "organizer_schedule_write_intents_fingerprint_check",
      sql`length(${table.stateFingerprint}) = 64`,
    ),
  ],
);

/**
 * Materialized normalized schedule facts for every manual organizer event.
 * This is a conflict projection of organizer_events, not a second event store.
 */
export const organizerReservationStates = sqliteTable(
  "organizer_reservation_states",
  {
    organizerEventId: text("organizer_event_id")
      .primaryKey()
      .references(() => organizerEvents.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clubId: text("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "restrict" }),
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
    }).notNull(),
    scheduleShape: text("schedule_shape", {
      enum: ["timed", "all_day"],
    }).notNull(),
    actualStartUtc: integer("actual_start_utc").notNull(),
    actualEndUtc: integer("actual_end_utc").notNull(),
    expandedStartUtc: integer("expanded_start_utc").notNull(),
    expandedEndUtc: integer("expanded_end_utc").notNull(),
    timezone: text("timezone").notNull(),
    allDayStartDate: text("all_day_start_date"),
    allDayEndDateExclusive: text("all_day_end_date_exclusive"),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    venueId: text("venue_id").references(() => venues.id, {
      onDelete: "restrict",
    }),
    primaryOrganizerProfileId: text("primary_organizer_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    organizerScopeJson: text("organizer_scope_json").notNull(),
    holdExpiresAt: integer("hold_expires_at"),
    scheduleVersion: integer("schedule_version").notNull(),
    policyVersion: integer("policy_version").notNull(),
    writeIntentId: text("write_intent_id")
      .notNull()
      .references(() => organizerScheduleWriteIntents.id, {
        onDelete: "restrict",
      }),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    index("organizer_reservation_states_interval_idx").on(
      table.organizationId,
      table.actualStartUtc,
      table.actualEndUtc,
    ),
    index("organizer_reservation_states_expanded_idx").on(
      table.organizationId,
      table.expandedStartUtc,
      table.expandedEndUtc,
    ),
    index("organizer_reservation_states_venue_idx").on(
      table.organizationId,
      table.venueId,
      table.actualStartUtc,
    ),
    index("organizer_reservation_states_hold_expiry_idx").on(
      table.organizationId,
      table.planningStatus,
      table.holdExpiresAt,
    ),
    index("organizer_reservation_states_club_idx").on(
      table.organizationId,
      table.clubId,
      table.actualStartUtc,
    ),
    check(
      "organizer_reservation_states_status_check",
      sql`${table.planningStatus} IN (
        'idea', 'draft', 'tentative_hold', 'confirmed', 'cancelled',
        'completed', 'archived'
      )`,
    ),
    check(
      "organizer_reservation_states_interval_check",
      sql`${table.actualEndUtc} > ${table.actualStartUtc}
          AND ${table.expandedStartUtc} <= ${table.actualStartUtc}
          AND ${table.expandedEndUtc} >= ${table.actualEndUtc}
          AND (
            ${table.scheduleShape} = 'timed'
            AND ${table.allDayStartDate} IS NULL
            AND ${table.allDayEndDateExclusive} IS NULL
            OR
            ${table.scheduleShape} = 'all_day'
            AND ${table.allDayStartDate} IS NOT NULL
            AND ${table.allDayEndDateExclusive} > ${table.allDayStartDate}
          )
          AND ${table.bufferBeforeMinutes} BETWEEN 0 AND 1440
          AND ${table.bufferAfterMinutes} BETWEEN 0 AND 1440
          AND ${table.expandedStartUtc} =
              ${table.actualStartUtc} - (${table.bufferBeforeMinutes} * 60000)
          AND ${table.expandedEndUtc} =
              ${table.actualEndUtc} + (${table.bufferAfterMinutes} * 60000)`,
    ),
    check(
      "organizer_reservation_states_scope_check",
      sql`json_valid(${table.organizerScopeJson})
          AND json_type(${table.organizerScopeJson}) = 'array'
          AND length(${table.organizerScopeJson}) <= 4096`,
    ),
    check(
      "organizer_reservation_states_hold_check",
      sql`(
        ${table.planningStatus} = 'tentative_hold'
        AND ${table.holdExpiresAt} IS NOT NULL
      ) OR (
        ${table.planningStatus} <> 'tentative_hold'
        AND ${table.holdExpiresAt} IS NULL
      )`,
    ),
    check(
      "organizer_reservation_states_version_check",
      sql`${table.scheduleVersion} >= 1 AND ${table.policyVersion} >= 1`,
    ),
  ],
);

/**
 * Immutable-generation and legacy reservation intervals. Meetup rows are
 * reserving only while their generation is the source's active completed
 * generation; pending/failed rows never become candidates.
 */
export const organizerExternalReservationIntervals = sqliteTable(
  "organizer_external_reservation_intervals",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind", {
      enum: ["legacy", "meetup"],
    }).notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    syncSourceId: text("sync_source_id").references(() => syncSources.id, {
      onDelete: "cascade",
    }),
    generationId: text("generation_id").references(
      () => meetupSyncGenerations.id,
      { onDelete: "cascade" },
    ),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    clubId: text("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "restrict" }),
    planningStatus: text("planning_status").notNull(),
    scheduleShape: text("schedule_shape", {
      enum: ["timed", "all_day"],
    }).notNull(),
    actualStartUtc: integer("actual_start_utc").notNull(),
    actualEndUtc: integer("actual_end_utc").notNull(),
    expandedStartUtc: integer("expanded_start_utc").notNull(),
    expandedEndUtc: integer("expanded_end_utc").notNull(),
    timezone: text("timezone").notNull(),
    allDayStartDate: text("all_day_start_date"),
    allDayEndDateExclusive: text("all_day_end_date_exclusive"),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    venueId: text("venue_id").references(() => venues.id, {
      onDelete: "set null",
    }),
    primaryOrganizerProfileId: text("primary_organizer_profile_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    organizerScopeJson: text("organizer_scope_json").notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    normalizedStateFingerprint: text(
      "normalized_state_fingerprint",
    ).notNull(),
    reservationSemanticFingerprint: text(
      "reservation_semantic_fingerprint",
    ).notNull(),
    scheduleVersion: integer("schedule_version").notNull(),
    holdExpiresAt: integer("hold_expires_at"),
    title: text("title").notNull(),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("organizer_external_reservations_source_record_unique").on(
      table.sourceKind,
      table.sourceRecordId,
    ),
    index("organizer_external_reservations_interval_idx").on(
      table.organizationId,
      table.actualStartUtc,
      table.actualEndUtc,
    ),
    index("organizer_external_reservations_expanded_idx").on(
      table.organizationId,
      table.expandedStartUtc,
      table.expandedEndUtc,
    ),
    index("organizer_external_reservations_source_generation_idx").on(
      table.syncSourceId,
      table.generationId,
      table.actualStartUtc,
    ),
    index("organizer_external_reservations_venue_idx").on(
      table.organizationId,
      table.venueId,
      table.actualStartUtc,
    ),
    check(
      "organizer_external_reservations_source_check",
      sql`(
        ${table.sourceKind} = 'legacy'
        AND ${table.syncSourceId} IS NULL
        AND ${table.generationId} IS NULL
      ) OR (
        ${table.sourceKind} = 'meetup'
        AND ${table.syncSourceId} IS NOT NULL
        AND ${table.generationId} IS NOT NULL
      )`,
    ),
    check(
      "organizer_external_reservations_interval_check",
      sql`${table.actualEndUtc} > ${table.actualStartUtc}
          AND ${table.expandedStartUtc} <= ${table.actualStartUtc}
          AND ${table.expandedEndUtc} >= ${table.actualEndUtc}
          AND (
            ${table.scheduleShape} = 'timed'
            AND ${table.allDayStartDate} IS NULL
            AND ${table.allDayEndDateExclusive} IS NULL
            OR
            ${table.scheduleShape} = 'all_day'
            AND ${table.allDayStartDate} IS NOT NULL
            AND ${table.allDayEndDateExclusive} > ${table.allDayStartDate}
          )
          AND ${table.bufferBeforeMinutes} BETWEEN 0 AND 1440
          AND ${table.bufferAfterMinutes} BETWEEN 0 AND 1440
          AND ${table.expandedStartUtc} =
              ${table.actualStartUtc} - (${table.bufferBeforeMinutes} * 60000)
          AND ${table.expandedEndUtc} =
              ${table.actualEndUtc} + (${table.bufferAfterMinutes} * 60000)`,
    ),
    check(
      "organizer_external_reservations_scope_check",
      sql`json_valid(${table.organizerScopeJson})
          AND json_type(${table.organizerScopeJson}) = 'array'
          AND length(${table.organizerScopeJson}) <= 4096`,
    ),
    check(
      "organizer_external_reservations_version_check",
      sql`${table.scheduleVersion} >= 1`,
    ),
    check(
      "organizer_external_reservations_fingerprint_check",
      sql`length(${table.sourceFingerprint}) = 64
          AND length(${table.normalizedStateFingerprint}) = 64
          AND length(${table.reservationSemanticFingerprint}) = 64`,
    ),
  ],
);

/**
 * Generation-owned, server-normalized Meetup reservation facts.
 *
 * In particular, all-day UTC boundaries are calculated in TypeScript with the
 * source IANA timezone while a generation is staged. D1 activation can then
 * compare the proposed external reservation projection to this immutable
 * normalization row without attempting timezone conversion in SQL.
 */
export const meetupSnapshotReservationNormalizations = sqliteTable(
  "meetup_snapshot_reservation_normalizations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    syncSourceId: text("sync_source_id")
      .notNull()
      .references(() => syncSources.id, { onDelete: "cascade" }),
    generationId: text("generation_id")
      .notNull()
      .references(() => meetupSyncGenerations.id, { onDelete: "cascade" }),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => meetupEventSnapshots.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    clubId: text("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "restrict" }),
    planningStatus: text("planning_status", {
      enum: ["confirmed", "tentative"],
    }).notNull(),
    scheduleShape: text("schedule_shape", {
      enum: ["timed", "all_day"],
    }).notNull(),
    actualStartUtc: integer("actual_start_utc").notNull(),
    actualEndUtc: integer("actual_end_utc").notNull(),
    expandedStartUtc: integer("expanded_start_utc").notNull(),
    expandedEndUtc: integer("expanded_end_utc").notNull(),
    timezone: text("timezone").notNull(),
    allDayStartDate: text("all_day_start_date"),
    allDayEndDateExclusive: text("all_day_end_date_exclusive"),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    venueId: text("venue_id").references(() => venues.id, {
      onDelete: "set null",
    }),
    primaryOrganizerProfileId: text("primary_organizer_profile_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    organizerScopeJson: text("organizer_scope_json").notNull(),
    scheduleVersion: integer("schedule_version").notNull(),
    holdExpiresAt: integer("hold_expires_at"),
    sourceFingerprint: text("source_fingerprint").notNull(),
    normalizedStateFingerprint: text(
      "normalized_state_fingerprint",
    ).notNull(),
    reservationSemanticFingerprint: text(
      "reservation_semantic_fingerprint",
    ).notNull(),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("meetup_snapshot_reservation_normalization_unique").on(
      table.syncSourceId,
      table.generationId,
      table.snapshotId,
      table.eventId,
    ),
    index("meetup_snapshot_reservation_normalization_generation_idx").on(
      table.organizationId,
      table.syncSourceId,
      table.generationId,
      table.actualStartUtc,
    ),
    index("meetup_snapshot_reservation_normalization_event_idx").on(
      table.organizationId,
      table.eventId,
      table.generationId,
    ),
    check(
      "meetup_snapshot_reservation_normalization_status_check",
      sql`${table.planningStatus} IN ('confirmed', 'tentative')`,
    ),
    check(
      "meetup_snapshot_reservation_normalization_interval_check",
      sql`${table.actualEndUtc} > ${table.actualStartUtc}
          AND ${table.expandedStartUtc} =
              ${table.actualStartUtc} - (${table.bufferBeforeMinutes} * 60000)
          AND ${table.expandedEndUtc} =
              ${table.actualEndUtc} + (${table.bufferAfterMinutes} * 60000)
          AND ${table.bufferBeforeMinutes} BETWEEN 0 AND 1440
          AND ${table.bufferAfterMinutes} BETWEEN 0 AND 1440
          AND (
            ${table.scheduleShape} = 'timed'
            AND ${table.allDayStartDate} IS NULL
            AND ${table.allDayEndDateExclusive} IS NULL
            OR
            ${table.scheduleShape} = 'all_day'
            AND ${table.allDayStartDate} IS NOT NULL
            AND ${table.allDayEndDateExclusive} >
                ${table.allDayStartDate}
          )`,
    ),
    check(
      "meetup_snapshot_reservation_normalization_scope_check",
      sql`json_valid(${table.organizerScopeJson})
          AND json_type(${table.organizerScopeJson}) = 'array'
          AND length(${table.organizerScopeJson}) <= 4096`,
    ),
    check(
      "meetup_snapshot_reservation_normalization_fingerprint_check",
      sql`length(${table.sourceFingerprint}) = 64
          AND length(${table.normalizedStateFingerprint}) = 64
          AND length(${table.reservationSemanticFingerprint}) = 64`,
    ),
    check(
      "meetup_snapshot_reservation_normalization_version_check",
      sql`${table.scheduleVersion} >= 1`,
    ),
  ],
);

export const organizerConflictReviewRequests = sqliteTable(
  "organizer_conflict_review_requests",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    organizerEventId: text("organizer_event_id")
      .notNull()
      .references(() => organizerEvents.id, { onDelete: "cascade" }),
    requestedPlanningStatus: text("requested_planning_status", {
      enum: ["tentative_hold", "confirmed"],
    }).notNull(),
    requestedStateJson: text("requested_state_json").notNull(),
    requestedScheduleVersion: integer("requested_schedule_version").notNull(),
    stateFingerprint: text("state_fingerprint").notNull(),
    policyId: text("policy_id")
      .notNull()
      .references(() => organizerConflictPolicies.id, {
        onDelete: "restrict",
      }),
    policyVersion: integer("policy_version").notNull(),
    requesterProfileId: text("requester_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    state: text("state", {
      enum: ["pending", "approved", "rejected", "invalidated"],
    })
      .notNull()
      .default("pending"),
    decidedByProfileId: text("decided_by_profile_id").references(
      () => profiles.id,
      { onDelete: "restrict" },
    ),
    decidedAt: integer("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    index("organizer_conflict_reviews_queue_idx").on(
      table.organizationId,
      table.state,
      table.createdAt,
    ),
    index("organizer_conflict_reviews_event_idx").on(
      table.organizationId,
      table.organizerEventId,
      table.requestedScheduleVersion,
    ),
    check(
      "organizer_conflict_reviews_version_check",
      sql`${table.requestedScheduleVersion} >= 1 AND ${table.policyVersion} >= 1`,
    ),
    check(
      "organizer_conflict_reviews_fingerprint_check",
      sql`length(${table.stateFingerprint}) = 64`,
    ),
    check(
      "organizer_conflict_reviews_requested_state_check",
      sql`json_valid(${table.requestedStateJson})
          AND json_type(${table.requestedStateJson}) = 'object'
          AND length(${table.requestedStateJson}) <= 8192`,
    ),
    check(
      "organizer_conflict_reviews_reason_check",
      sql`length(trim(${table.reason})) BETWEEN 1 AND 1000`,
    ),
    check(
      "organizer_conflict_reviews_state_check",
      sql`(
        ${table.state} = 'pending'
        AND ${table.decidedByProfileId} IS NULL
        AND ${table.decidedAt} IS NULL
      ) OR (
        ${table.state} IN ('approved', 'rejected')
        AND ${table.decidedByProfileId} IS NOT NULL
        AND ${table.decidedAt} IS NOT NULL
      ) OR ${table.state} = 'invalidated'`,
    ),
  ],
);

export const organizerConflictIncidents = sqliteTable(
  "organizer_conflict_incidents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    organizerEventId: text("organizer_event_id")
      .notNull()
      .references(() => organizerEvents.id, { onDelete: "cascade" }),
    conflictingCandidateKey: text("conflicting_candidate_key").notNull(),
    conflictingEventId: text("conflicting_event_id").notNull(),
    conflictingSourceKind: text("conflicting_source_kind", {
      enum: ["manual", "legacy", "meetup"],
    }).notNull(),
    proposedScheduleVersion: integer("proposed_schedule_version").notNull(),
    conflictingScheduleVersion: integer(
      "conflicting_schedule_version",
    ).notNull(),
    policyId: text("policy_id")
      .notNull()
      .references(() => organizerConflictPolicies.id, {
        onDelete: "restrict",
      }),
    policyVersion: integer("policy_version").notNull(),
    classification: text("classification", {
      enum: ["direct", "buffer"],
    }).notNull(),
    overlapStartUtc: integer("overlap_start_utc").notNull(),
    overlapEndUtc: integer("overlap_end_utc").notNull(),
    resourcesJson: text("resources_json").notNull(),
    stateFingerprint: text("state_fingerprint").notNull(),
    state: text("state", {
      enum: [
        "open",
        "pending_approval",
        "approved",
        "rejected",
        "invalidated",
        "resolved",
        "informational",
      ],
    })
      .notNull()
      .default("open"),
    writeIntentId: text("write_intent_id").references(
      () => organizerScheduleWriteIntents.id,
      { onDelete: "cascade" },
    ),
    reviewRequestId: text("review_request_id").references(
      () => organizerConflictReviewRequests.id,
      { onDelete: "set null" },
    ),
    detectedByProfileId: text("detected_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    resolvedAt: integer("resolved_at"),
  },
  (table) => [
    uniqueIndex("organizer_conflict_incidents_pair_version_unique").on(
      table.organizerEventId,
      table.proposedScheduleVersion,
      table.conflictingCandidateKey,
      table.conflictingScheduleVersion,
      table.classification,
    ),
    index("organizer_conflict_incidents_queue_idx").on(
      table.organizationId,
      table.state,
      table.createdAt,
    ),
    index("organizer_conflict_incidents_event_idx").on(
      table.organizationId,
      table.organizerEventId,
      table.proposedScheduleVersion,
    ),
    index("organizer_conflict_incidents_conflicting_event_idx").on(
      table.organizationId,
      table.conflictingEventId,
      table.state,
    ),
    check(
      "organizer_conflict_incidents_versions_check",
      sql`${table.proposedScheduleVersion} >= 1
          AND ${table.conflictingScheduleVersion} >= 1
          AND ${table.policyVersion} >= 1`,
    ),
    check(
      "organizer_conflict_incidents_interval_check",
      sql`${table.overlapEndUtc} > ${table.overlapStartUtc}`,
    ),
    check(
      "organizer_conflict_incidents_resources_check",
      sql`json_valid(${table.resourcesJson})
          AND json_type(${table.resourcesJson}) = 'array'
          AND length(${table.resourcesJson}) <= 4096`,
    ),
    check(
      "organizer_conflict_incidents_fingerprint_check",
      sql`length(${table.stateFingerprint}) = 64`,
    ),
  ],
);

export const organizerConflictOverrides = sqliteTable(
  "organizer_conflict_overrides",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    incidentId: text("incident_id")
      .notNull()
      .references(() => organizerConflictIncidents.id, {
        onDelete: "cascade",
      }),
    organizerEventId: text("organizer_event_id")
      .notNull()
      .references(() => organizerEvents.id, { onDelete: "cascade" }),
    conflictingCandidateKey: text("conflicting_candidate_key").notNull(),
    proposedScheduleVersion: integer("proposed_schedule_version").notNull(),
    conflictingScheduleVersion: integer(
      "conflicting_schedule_version",
    ).notNull(),
    policyId: text("policy_id")
      .notNull()
      .references(() => organizerConflictPolicies.id, {
        onDelete: "restrict",
      }),
    policyVersion: integer("policy_version").notNull(),
    stateFingerprint: text("state_fingerprint").notNull(),
    reason: text("reason").notNull(),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    reviewRequestId: text("review_request_id").references(
      () => organizerConflictReviewRequests.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at").notNull().default(nowMs),
    invalidatedAt: integer("invalidated_at"),
    invalidatedByProfileId: text("invalidated_by_profile_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
  },
  (table) => [
    uniqueIndex("organizer_conflict_overrides_active_incident_unique")
      .on(table.incidentId)
      .where(sql`${table.invalidatedAt} IS NULL`),
    index("organizer_conflict_overrides_event_idx").on(
      table.organizationId,
      table.organizerEventId,
      table.proposedScheduleVersion,
    ),
    check(
      "organizer_conflict_overrides_versions_check",
      sql`${table.proposedScheduleVersion} >= 1
          AND ${table.conflictingScheduleVersion} >= 1
          AND ${table.policyVersion} >= 1`,
    ),
    check(
      "organizer_conflict_overrides_fingerprint_check",
      sql`length(${table.stateFingerprint}) = 64`,
    ),
    check(
      "organizer_conflict_overrides_reason_check",
      sql`length(trim(${table.reason})) BETWEEN 1 AND 1000`,
    ),
  ],
);

export const organizerHoldNoticeReceipts = sqliteTable(
  "organizer_hold_notice_receipts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    organizerEventId: text("organizer_event_id")
      .notNull()
      .references(() => organizerEvents.id, { onDelete: "cascade" }),
    scheduleVersion: integer("schedule_version").notNull(),
    noticeType: text("notice_type", {
      enum: ["nearing_expiry", "expired"],
    }).notNull(),
    recipientProfileId: text("recipient_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    notificationId: text("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("organizer_hold_notice_receipts_dedupe_unique").on(
      table.organizerEventId,
      table.scheduleVersion,
      table.noticeType,
      table.recipientProfileId,
    ),
    index("organizer_hold_notice_receipts_org_event_idx").on(
      table.organizationId,
      table.organizerEventId,
      table.scheduleVersion,
    ),
    check(
      "organizer_hold_notice_receipts_version_check",
      sql`${table.scheduleVersion} >= 1`,
    ),
  ],
);

/**
 * Phase 5 keeps public presentation and publication workflow state in
 * organization-scoped sidecars. `organizer_events` remains the only writable
 * manual event identity and schedule.
 */
export const organizationPublicationPolicies = sqliteTable(
  "organization_publication_policies",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    organizerSelfPublishEnabled: integer(
      "organizer_self_publish_enabled",
      { mode: "boolean" },
    )
      .notNull()
      .default(false),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    check(
      "organization_publication_policies_self_publish_check",
      sql`${table.organizerSelfPublishEnabled} IN (0, 1)`,
    ),
  ],
);

export const organizerEventPublicDetails = sqliteTable(
  "organizer_event_public_details",
  {
    organizerEventId: text("organizer_event_id")
      .primaryKey()
      .references(() => organizerEvents.id, { onDelete: "cascade" }),
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
    publicLocationName: text("public_location_name"),
    publicAddress: text("public_address"),
    publicAccessNote: text("public_access_note"),
    publicOnlineUrl: text("public_online_url"),
    externalMapUrl: text("external_map_url"),
    costText: text("cost_text"),
    capacity: integer("capacity"),
    availabilityState: text("availability_state", {
      enum: ["open", "full", "waitlist"],
    })
      .notNull()
      .default("open"),
    preparationInformation: text("preparation_information"),
    whatToBring: text("what_to_bring"),
    arrivalInstructions: text("arrival_instructions"),
    weatherNote: text("weather_note"),
    verifiedAccessibilityNotes: text("verified_accessibility_notes"),
    publicHostsEnabled: integer("public_hosts_enabled", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    rsvpMode: text("rsvp_mode", {
      enum: ["meetup", "coming_soon"],
    })
      .notNull()
      .default("coming_soon"),
    confirmedMeetupEventUrl: text("confirmed_meetup_event_url"),
    meetupUrlConfirmedByProfileId: text(
      "meetup_url_confirmed_by_profile_id",
    ).references(() => profiles.id, { onDelete: "restrict" }),
    meetupUrlConfirmedAt: integer("meetup_url_confirmed_at"),
    createdByProfileId: text("created_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    index("organizer_event_public_details_org_event_idx").on(
      table.organizationId,
      table.organizerEventId,
    ),
    index("organizer_event_public_details_org_mode_idx").on(
      table.organizationId,
      table.attendanceMode,
      table.organizerEventId,
    ),
    check(
      "organizer_event_public_details_attendance_mode_check",
      sql`${table.attendanceMode} IN ('in_person', 'online', 'hybrid', 'location_undecided')`,
    ),
    check(
      "organizer_event_public_details_availability_check",
      sql`${table.availabilityState} IN ('open', 'full', 'waitlist')`,
    ),
    check(
      "organizer_event_public_details_capacity_check",
      sql`${table.capacity} IS NULL OR ${table.capacity} BETWEEN 1 AND 1000000`,
    ),
    check(
      "organizer_event_public_details_hosts_check",
      sql`${table.publicHostsEnabled} IN (0, 1)`,
    ),
    check(
      "organizer_event_public_details_rsvp_shape_check",
      sql`(
        ${table.rsvpMode} = 'coming_soon'
        AND ${table.confirmedMeetupEventUrl} IS NULL
        AND ${table.meetupUrlConfirmedByProfileId} IS NULL
        AND ${table.meetupUrlConfirmedAt} IS NULL
      ) OR (
        ${table.rsvpMode} = 'meetup'
        AND length(trim(${table.confirmedMeetupEventUrl}))
            BETWEEN 1 AND 2048
        AND ${table.meetupUrlConfirmedByProfileId} IS NOT NULL
        AND ${table.meetupUrlConfirmedAt} IS NOT NULL
      )`,
    ),
  ],
);

export const organizerEventPublicHosts = sqliteTable(
  "organizer_event_public_hosts",
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
      .references(() => profiles.id, { onDelete: "cascade" }),
    selectedByProfileId: text("selected_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    selectedAt: integer("selected_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("organizer_event_public_hosts_event_profile_unique").on(
      table.organizerEventId,
      table.profileId,
    ),
    index("organizer_event_public_hosts_org_event_idx").on(
      table.organizationId,
      table.organizerEventId,
      table.profileId,
    ),
    index("organizer_event_public_hosts_org_profile_idx").on(
      table.organizationId,
      table.profileId,
      table.organizerEventId,
    ),
  ],
);

export const organizerEventPublicationState = sqliteTable(
  "organizer_event_publication_state",
  {
    organizerEventId: text("organizer_event_id")
      .primaryKey()
      .references(() => organizerEvents.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    firstPublishedAt: integer("first_published_at"),
    mostRecentPublishedAt: integer("most_recent_published_at"),
    mostRecentUnpublishedAt: integer("most_recent_unpublished_at"),
    publicCancellationAt: integer("public_cancellation_at"),
    lastMutationActorProfileId: text("last_mutation_actor_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    index("organizer_event_publication_state_org_event_idx").on(
      table.organizationId,
      table.organizerEventId,
    ),
    check(
      "organizer_event_publication_state_publish_shape_check",
      sql`(
        ${table.firstPublishedAt} IS NULL
        AND ${table.mostRecentPublishedAt} IS NULL
        AND ${table.publicCancellationAt} IS NULL
      ) OR (
        ${table.firstPublishedAt} IS NOT NULL
        AND ${table.mostRecentPublishedAt} IS NOT NULL
        AND ${table.mostRecentPublishedAt} >= ${table.firstPublishedAt}
        AND (
          ${table.publicCancellationAt} IS NULL
          OR ${table.publicCancellationAt} >= ${table.firstPublishedAt}
        )
      )`,
    ),
    check(
      "organizer_event_publication_state_unpublish_check",
      sql`${table.mostRecentUnpublishedAt} IS NULL OR ${table.mostRecentUnpublishedAt} >= 0`,
    ),
  ],
);

export const organizerEventPublicationJobs = sqliteTable(
  "organizer_event_publication_jobs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    organizerEventId: text("organizer_event_id")
      .notNull()
      .references(() => organizerEvents.id, { onDelete: "cascade" }),
    requestedPublicationAtUtc: integer(
      "requested_publication_at_utc",
    ).notNull(),
    originalTimezone: text("original_timezone").notNull(),
    boundContentVersion: integer("bound_content_version").notNull(),
    boundScheduleVersion: integer("bound_schedule_version").notNull(),
    authorizingProfileId: text("authorizing_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    state: text("state", {
      enum: [
        "pending",
        "executed",
        "cancelled",
        "invalidated",
        "failed",
      ],
    })
      .notNull()
      .default("pending"),
    attemptedAt: integer("attempted_at"),
    terminalAt: integer("terminal_at"),
    failureCode: text("failure_code"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("organizer_event_publication_jobs_one_pending_unique")
      .on(table.organizerEventId)
      .where(sql`${table.state} = 'pending'`),
    index("organizer_event_publication_jobs_due_idx").on(
      table.state,
      table.requestedPublicationAtUtc,
      table.organizationId,
      table.id,
    ),
    index("organizer_event_publication_jobs_org_event_idx").on(
      table.organizationId,
      table.organizerEventId,
      table.createdAt,
    ),
    check(
      "organizer_event_publication_jobs_versions_check",
      sql`${table.boundContentVersion} >= 1 AND ${table.boundScheduleVersion} >= 1`,
    ),
    check(
      "organizer_event_publication_jobs_time_check",
      sql`${table.requestedPublicationAtUtc} >= 0 AND length(trim(${table.originalTimezone})) BETWEEN 1 AND 255`,
    ),
    check(
      "organizer_event_publication_jobs_state_shape_check",
      sql`(
        ${table.state} = 'pending'
        AND ${table.terminalAt} IS NULL
        AND ${table.failureCode} IS NULL
      ) OR (
        ${table.state} IN ('executed', 'cancelled')
        AND ${table.terminalAt} IS NOT NULL
        AND ${table.failureCode} IS NULL
      ) OR (
        ${table.state} IN ('invalidated', 'failed')
        AND ${table.terminalAt} IS NOT NULL
        AND length(trim(${table.failureCode})) BETWEEN 1 AND 64
      )`,
    ),
    check(
      "organizer_event_publication_jobs_terminal_time_check",
      sql`${table.terminalAt} IS NULL OR ${table.terminalAt} >= ${table.createdAt}`,
    ),
  ],
);

/**
 * A transaction-local publication envelope. It binds each public mutation to
 * the same complete Phase 4 schedule intent used by the authoritative
 * reservation guard, while adding only public-state/version facts.
 */
export const organizerEventPublicationWriteIntents = sqliteTable(
  "organizer_event_publication_write_intents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    organizerEventId: text("organizer_event_id")
      .notNull()
      .references(() => organizerEvents.id, { onDelete: "cascade" }),
    scheduleWriteIntentId: text("schedule_write_intent_id")
      .notNull()
      .references(() => organizerScheduleWriteIntents.id, {
        onDelete: "restrict",
      }),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    operation: text("operation", {
      enum: [
        "update_public_details",
        "publish",
        "schedule_publication",
        "cancel_scheduled_publication",
        "reconcile_publication",
        "invalidate_scheduled_publication",
        "unpublish",
        "public_cancel",
        "restore_cancelled",
        "update_published",
        "update_scheduled",
        "update_unpublished",
      ],
    }).notNull(),
    expectedPublicationStatus: text("expected_publication_status", {
      enum: ["private", "scheduled", "published", "unpublished"],
    }).notNull(),
    proposedPublicationStatus: text("proposed_publication_status", {
      enum: ["private", "scheduled", "published", "unpublished"],
    }).notNull(),
    expectedContentVersion: integer("expected_content_version").notNull(),
    expectedScheduleVersion: integer("expected_schedule_version").notNull(),
    proposedContentVersion: integer("proposed_content_version").notNull(),
    proposedScheduleVersion: integer("proposed_schedule_version").notNull(),
    publicStateFingerprint: text("public_state_fingerprint").notNull(),
    // The new job is created later in the same guarded batch. Runtime
    // invariants enforce exact eventual parity; an immediate SQLite FK would
    // make the transaction-safe intent-first ordering impossible.
    publicationJobId: text("publication_job_id"),
    previousPublicationJobId: text("previous_publication_job_id").references(
      () => organizerEventPublicationJobs.id,
      { onDelete: "restrict" },
    ),
    executionKind: text("execution_kind", {
      enum: ["actor", "reconciliation"],
    })
      .notNull()
      .default("actor"),
    createdAt: integer("created_at").notNull().default(nowMs),
    completedAt: integer("completed_at"),
  },
  (table) => [
    uniqueIndex(
      "organizer_event_publication_write_intents_schedule_unique",
    ).on(table.scheduleWriteIntentId),
    index("organizer_event_publication_write_intents_event_open_idx").on(
      table.organizationId,
      table.organizerEventId,
      table.completedAt,
      table.createdAt,
    ),
    index("organizer_event_publication_write_intents_job_idx").on(
      table.organizationId,
      table.publicationJobId,
    ),
    index("organizer_event_publication_write_intents_previous_job_idx").on(
      table.organizationId,
      table.previousPublicationJobId,
    ),
    check(
      "organizer_event_publication_write_intents_operation_check",
      sql`${table.operation} IN (
        'update_public_details', 'publish', 'schedule_publication',
        'cancel_scheduled_publication', 'reconcile_publication',
        'invalidate_scheduled_publication',
        'unpublish', 'public_cancel', 'restore_cancelled',
        'update_published', 'update_scheduled', 'update_unpublished'
      )`,
    ),
    check(
      "organizer_event_publication_write_intents_status_check",
      sql`${table.expectedPublicationStatus} IN (
        'private', 'scheduled', 'published', 'unpublished'
      ) AND ${table.proposedPublicationStatus} IN (
        'private', 'scheduled', 'published', 'unpublished'
      )`,
    ),
    check(
      "organizer_event_publication_write_intents_versions_check",
      sql`${table.expectedContentVersion} >= 1
          AND ${table.expectedScheduleVersion} >= 1
          AND ${table.proposedContentVersion} =
              ${table.expectedContentVersion} + 1
          AND ${table.proposedScheduleVersion} BETWEEN
              ${table.expectedScheduleVersion}
              AND ${table.expectedScheduleVersion} + 1`,
    ),
    check(
      "organizer_event_publication_write_intents_fingerprint_check",
      sql`length(${table.publicStateFingerprint}) = 64`,
    ),
    check(
      "organizer_event_publication_write_intents_execution_check",
      sql`${table.executionKind} IN ('actor', 'reconciliation')`,
    ),
    check(
      "organizer_event_publication_write_intents_completion_check",
      sql`${table.completedAt} IS NULL OR ${table.completedAt} >= ${table.createdAt}`,
    ),
    check(
      "organizer_event_publication_write_intents_transition_check",
      sql`(
        ${table.operation} = 'update_public_details'
        AND (
          ${table.proposedPublicationStatus} =
              ${table.expectedPublicationStatus}
          OR (
            ${table.expectedPublicationStatus} = 'scheduled'
            AND ${table.proposedPublicationStatus}
                IN ('private', 'unpublished')
          )
        )
      ) OR (
        ${table.operation} = 'publish'
        AND ${table.expectedPublicationStatus}
            IN ('private', 'scheduled', 'unpublished')
        AND ${table.proposedPublicationStatus} = 'published'
      ) OR (
        ${table.operation} = 'schedule_publication'
        AND ${table.expectedPublicationStatus}
            IN ('private', 'scheduled', 'unpublished')
        AND ${table.proposedPublicationStatus} = 'scheduled'
      ) OR (
        ${table.operation} = 'cancel_scheduled_publication'
        AND ${table.expectedPublicationStatus} = 'scheduled'
        AND ${table.proposedPublicationStatus}
            IN ('private', 'unpublished')
      ) OR (
        ${table.operation} = 'reconcile_publication'
        AND ${table.expectedPublicationStatus} = 'scheduled'
        AND ${table.proposedPublicationStatus} = 'published'
      ) OR (
        ${table.operation} = 'invalidate_scheduled_publication'
        AND ${table.expectedPublicationStatus} = 'scheduled'
        AND ${table.proposedPublicationStatus} = 'unpublished'
      ) OR (
        ${table.operation} = 'unpublish'
        AND ${table.expectedPublicationStatus} = 'published'
        AND ${table.proposedPublicationStatus} = 'unpublished'
      ) OR (
        ${table.operation} = 'public_cancel'
        AND (
          (
            ${table.expectedPublicationStatus} = 'published'
            AND ${table.proposedPublicationStatus} = 'published'
          )
          OR (
            ${table.expectedPublicationStatus} = 'scheduled'
            AND ${table.proposedPublicationStatus} = 'unpublished'
          )
          OR (
            ${table.expectedPublicationStatus}
                IN ('private', 'unpublished')
            AND ${table.proposedPublicationStatus} =
                ${table.expectedPublicationStatus}
          )
        )
      ) OR (
        ${table.operation} = 'restore_cancelled'
        AND ${table.expectedPublicationStatus}
            IN ('private', 'published', 'unpublished')
        AND ${table.proposedPublicationStatus} = 'unpublished'
      ) OR (
        ${table.operation} = 'update_published'
        AND ${table.expectedPublicationStatus} = 'published'
        AND ${table.proposedPublicationStatus} = 'published'
      ) OR (
        ${table.operation} = 'update_scheduled'
        AND ${table.expectedPublicationStatus} = 'scheduled'
        AND ${table.proposedPublicationStatus} = 'unpublished'
      ) OR (
        ${table.operation} = 'update_unpublished'
        AND ${table.expectedPublicationStatus} = 'unpublished'
        AND ${table.proposedPublicationStatus} = 'unpublished'
      )`,
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

/**
 * Phase 6 keeps the existing public tables as the only public materialized
 * projection. This additive state row points at private immutable revisions;
 * saving a draft cannot mutate a public table.
 */
export const cmsEntityPublicationStates = sqliteTable(
  "cms_entity_publication_states",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entityType: text("entity_type", {
      enum: [
        "page",
        "club_public_profile",
        "program_public_profile",
        "community_link",
        "navigation",
        "site_identity",
        "legal_status",
      ],
    }).notNull(),
    entityKey: text("entity_key").notNull(),
    workflowStatus: text("workflow_status", {
      enum: ["draft", "published", "unpublished", "archived"],
    })
      .notNull()
      .default("draft"),
    contentVersion: integer("content_version").notNull().default(1),
    currentDraftRevisionId: text("current_draft_revision_id"),
    publishedRevisionId: text("published_revision_id"),
    lastEditorProfileId: text("last_editor_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    draftUpdatedAt: integer("draft_updated_at"),
    publishedAt: integer("published_at"),
    unpublishedAt: integer("unpublished_at"),
    adoptedAt: integer("adopted_at"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("cms_entity_publication_states_org_entity_unique").on(
      table.organizationId,
      table.entityType,
      table.entityKey,
    ),
    index("cms_entity_publication_states_org_status_idx").on(
      table.organizationId,
      table.entityType,
      table.workflowStatus,
      table.updatedAt,
    ),
    index("cms_entity_publication_states_draft_revision_idx").on(
      table.organizationId,
      table.currentDraftRevisionId,
    ),
    index("cms_entity_publication_states_published_revision_idx").on(
      table.organizationId,
      table.publishedRevisionId,
    ),
    check(
      "cms_entity_publication_states_entity_type_check",
      sql`${table.entityType} IN (
        'page', 'club_public_profile', 'program_public_profile',
        'community_link',
        'navigation', 'site_identity', 'legal_status'
      )`,
    ),
    check(
      "cms_entity_publication_states_status_check",
      sql`${table.workflowStatus} IN (
        'draft', 'published', 'unpublished', 'archived'
      )`,
    ),
    check(
      "cms_entity_publication_states_version_check",
      sql`${table.contentVersion} >= 1`,
    ),
    check(
      "cms_entity_publication_states_entity_key_check",
      sql`length(trim(${table.entityKey})) BETWEEN 1 AND 160`,
    ),
    check(
      "cms_entity_publication_states_revision_shape_check",
      sql`(
        ${table.workflowStatus} = 'draft'
        AND ${table.currentDraftRevisionId} IS NOT NULL
      ) OR (
        ${table.workflowStatus} = 'published'
        AND ${table.publishedRevisionId} IS NOT NULL
        AND ${table.publishedAt} IS NOT NULL
      ) OR (
        ${table.workflowStatus} = 'unpublished'
        AND ${table.unpublishedAt} IS NOT NULL
      ) OR ${table.workflowStatus} = 'archived'`,
    ),
  ],
);

export const cmsEntityRevisions = sqliteTable(
  "cms_entity_revisions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    publicationStateId: text("publication_state_id")
      .notNull()
      .references(() => cmsEntityPublicationStates.id, {
        onDelete: "cascade",
      }),
    entityType: text("entity_type", {
      enum: [
        "page",
        "club_public_profile",
        "program_public_profile",
        "community_link",
        "navigation",
        "site_identity",
        "legal_status",
      ],
    }).notNull(),
    entityKey: text("entity_key").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    contentHash: text("content_hash").notNull(),
    canonicalByteSize: integer("canonical_byte_size").notNull(),
    restoredFromRevisionId: text("restored_from_revision_id"),
    legacyPageRevisionId: text("legacy_page_revision_id").references(
      () => pageRevisions.id,
      { onDelete: "restrict" },
    ),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("cms_entity_revisions_state_number_unique").on(
      table.publicationStateId,
      table.revisionNumber,
    ),
    index("cms_entity_revisions_org_entity_idx").on(
      table.organizationId,
      table.entityType,
      table.entityKey,
      table.revisionNumber,
    ),
    index("cms_entity_revisions_restore_idx").on(
      table.organizationId,
      table.restoredFromRevisionId,
    ),
    uniqueIndex("cms_entity_revisions_legacy_page_unique")
      .on(table.legacyPageRevisionId)
      .where(sql`${table.legacyPageRevisionId} IS NOT NULL`),
    check(
      "cms_entity_revisions_entity_type_check",
      sql`${table.entityType} IN (
        'page', 'club_public_profile', 'program_public_profile',
        'community_link',
        'navigation', 'site_identity', 'legal_status'
      )`,
    ),
    check(
      "cms_entity_revisions_number_check",
      sql`${table.revisionNumber} >= 1`,
    ),
    check(
      "cms_entity_revisions_snapshot_check",
      sql`json_valid(${table.snapshotJson})
          AND json_type(${table.snapshotJson}) = 'object'
          AND ${table.canonicalByteSize} =
              length(CAST(${table.snapshotJson} AS BLOB))
          AND ${table.canonicalByteSize} BETWEEN 2 AND 131072`,
    ),
    check(
      "cms_entity_revisions_hash_check",
      sql`length(${table.contentHash}) = 64
          AND ${table.contentHash} = lower(${table.contentHash})
          AND ${table.contentHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "cms_entity_revisions_entity_key_check",
      sql`length(trim(${table.entityKey})) BETWEEN 1 AND 160`,
    ),
  ],
);

/**
 * Immutable proof that the allowlisted materialized public rows were produced
 * from one exact CMS revision. The projection JSON is verification data only:
 * public readers continue to read the established projection tables and must
 * prove those rows still match this receipt.
 */
export const cmsPublicMaterializationReceipts = sqliteTable(
  "cms_public_materialization_receipts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    publicationStateId: text("publication_state_id")
      .notNull()
      .references(() => cmsEntityPublicationStates.id, {
        onDelete: "cascade",
      }),
    entityType: text("entity_type", {
      enum: [
        "page",
        "club_public_profile",
        "program_public_profile",
        "community_link",
        "navigation",
        "site_identity",
        "legal_status",
      ],
    }).notNull(),
    entityKey: text("entity_key").notNull(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => cmsEntityRevisions.id, { onDelete: "cascade" }),
    revisionHash: text("revision_hash").notNull(),
    projectionJson: text("projection_json").notNull(),
    canonicalByteSize: integer("canonical_byte_size").notNull(),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("cms_public_materialization_receipts_state_revision_unique")
      .on(table.publicationStateId, table.revisionId),
    index("cms_public_materialization_receipts_org_entity_idx").on(
      table.organizationId,
      table.entityType,
      table.entityKey,
      table.createdAt,
    ),
    check(
      "cms_public_materialization_receipts_entity_type_check",
      sql`${table.entityType} IN (
        'page', 'club_public_profile', 'program_public_profile',
        'community_link', 'navigation', 'site_identity', 'legal_status'
      )`,
    ),
    check(
      "cms_public_materialization_receipts_projection_check",
      sql`json_valid(${table.projectionJson})
          AND json_type(${table.projectionJson}) = 'object'
          AND ${table.canonicalByteSize} =
              length(CAST(${table.projectionJson} AS BLOB))
          AND ${table.canonicalByteSize} BETWEEN 2 AND 131072`,
    ),
    check(
      "cms_public_materialization_receipts_hash_check",
      sql`length(${table.revisionHash}) = 64
          AND ${table.revisionHash} = lower(${table.revisionHash})
          AND ${table.revisionHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "cms_public_materialization_receipts_entity_key_check",
      sql`length(trim(${table.entityKey})) BETWEEN 1 AND 160`,
    ),
  ],
);

/**
 * CMS adoption is scoped per organization and is deliberately not part of the
 * global public-request readiness marker. Private CMS services fail closed
 * until the existing public projection has been adopted and this marker has
 * been written atomically.
 */
export const cmsAdoptionStates = sqliteTable(
  "cms_adoption_states",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    adoptionVersion: integer("adoption_version").notNull().default(1),
    sourceFingerprint: text("source_fingerprint").notNull(),
    adoptedAt: integer("adopted_at").notNull(),
    verifiedAt: integer("verified_at").notNull(),
  },
  (table) => [
    check(
      "cms_adoption_states_version_check",
      sql`${table.adoptionVersion} = 1`,
    ),
    check(
      "cms_adoption_states_fingerprint_check",
      sql`length(${table.sourceFingerprint}) = 64
          AND ${table.sourceFingerprint} = lower(${table.sourceFingerprint})
          AND ${table.sourceFingerprint} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "cms_adoption_states_time_check",
      sql`${table.verifiedAt} >= ${table.adoptedAt}`,
    ),
  ],
);

export const publicSlugRedirects = sqliteTable(
  "public_slug_redirects",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entityType: text("entity_type", {
      enum: ["page", "club_public_profile", "program_public_profile"],
    }).notNull(),
    entityId: text("entity_id").notNull(),
    fromSlug: text("from_slug").notNull(),
    toSlug: text("to_slug").notNull(),
    state: text("state", { enum: ["active", "superseded"] })
      .notNull()
      .default("active"),
    createdByProfileId: text("created_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    retiredAt: integer("retired_at"),
  },
  (table) => [
    uniqueIndex("public_slug_redirects_active_from_unique")
      .on(table.organizationId, table.entityType, table.fromSlug)
      .where(sql`${table.state} = 'active'`),
    index("public_slug_redirects_entity_idx").on(
      table.organizationId,
      table.entityType,
      table.entityId,
      table.state,
    ),
    check(
      "public_slug_redirects_entity_type_check",
      sql`${table.entityType} IN (
        'page', 'club_public_profile', 'program_public_profile'
      )`,
    ),
    check(
      "public_slug_redirects_state_shape_check",
      sql`(
        ${table.state} = 'active' AND ${table.retiredAt} IS NULL
      ) OR (
        ${table.state} = 'superseded'
        AND ${table.retiredAt} IS NOT NULL
      )`,
    ),
    check(
      "public_slug_redirects_slug_check",
      sql`length(${table.fromSlug}) BETWEEN 1 AND 160
          AND length(${table.toSlug}) BETWEEN 1 AND 160
          AND ${table.fromSlug} <> ${table.toSlug}`,
    ),
  ],
);

/**
 * Published-only page metadata. Draft SEO values remain inside an immutable
 * private revision until an authorized publish materializes them here.
 */
export const pagePublicMetadata = sqliteTable(
  "page_public_metadata",
  {
    pageId: text("page_id")
      .primaryKey()
      .references(() => pages.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    seoTitle: text("seo_title"),
    metaDescription: text("meta_description"),
    ogMediaAssetId: text("og_media_asset_id").references(
      () => mediaAssets.id,
      { onDelete: "restrict" },
    ),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("page_public_metadata_org_page_unique").on(
      table.organizationId,
      table.pageId,
    ),
    index("page_public_metadata_org_updated_idx").on(
      table.organizationId,
      table.updatedAt,
    ),
    check(
      "page_public_metadata_seo_title_check",
      sql`${table.seoTitle} IS NULL
          OR length(${table.seoTitle}) BETWEEN 1 AND 60`,
    ),
    check(
      "page_public_metadata_description_check",
      sql`${table.metaDescription} IS NULL
          OR length(${table.metaDescription}) BETWEEN 1 AND 160`,
    ),
  ],
);

/**
 * Optional published-facing SEO overrides for canonical organizer events.
 * The event title, summary, slug, and artwork remain authoritative elsewhere;
 * null values deliberately fall back to those canonical public facts.
 */
export const organizerEventPublicMetadata = sqliteTable(
  "organizer_event_public_metadata",
  {
    organizerEventId: text("organizer_event_id")
      .primaryKey()
      .references(() => organizerEvents.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    seoTitle: text("seo_title"),
    metaDescription: text("meta_description"),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("organizer_event_public_metadata_org_event_unique").on(
      table.organizationId,
      table.organizerEventId,
    ),
    index("organizer_event_public_metadata_org_updated_idx").on(
      table.organizationId,
      table.updatedAt,
    ),
    check(
      "organizer_event_public_metadata_seo_title_check",
      sql`${table.seoTitle} IS NULL
          OR length(trim(${table.seoTitle})) BETWEEN 1 AND 60`,
    ),
    check(
      "organizer_event_public_metadata_description_check",
      sql`${table.metaDescription} IS NULL
          OR length(trim(${table.metaDescription})) BETWEEN 1 AND 160`,
    ),
  ],
);

/**
 * Rich published club content is separated from private CMS revisions. The
 * established `club_public_profiles` record remains authoritative for lane,
 * publication state, confirmed Meetup group URL, and featured ordering.
 */
export const clubPublicProfileDetails = sqliteTable(
  "club_public_profile_details",
  {
    clubId: text("club_id")
      .primaryKey()
      .references(() => clubs.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    publicDisplayName: text("public_display_name").notNull(),
    shortSummary: text("short_summary").notNull(),
    fullDescription: text("full_description").notNull(),
    programType: text("program_type", {
      enum: ["club", "program", "circle", "series", "other"],
    })
      .notNull()
      .default("club"),
    coverMediaAssetId: text("cover_media_asset_id").references(
      () => mediaAssets.id,
      { onDelete: "restrict" },
    ),
    thumbnailMediaAssetId: text("thumbnail_media_asset_id").references(
      () => mediaAssets.id,
      { onDelete: "restrict" },
    ),
    imageAltText: text("image_alt_text"),
    themeColor: text("theme_color"),
    seoTitle: text("seo_title"),
    metaDescription: text("meta_description"),
    ogMediaAssetId: text("og_media_asset_id").references(
      () => mediaAssets.id,
      { onDelete: "restrict" },
    ),
    participantExpectations: text("participant_expectations"),
    preparationInformation: text("preparation_information"),
    typicalFormat: text("typical_format"),
    confirmedSocialLinksJson: text("confirmed_social_links_json")
      .notNull()
      .default("[]"),
    relatedResourcesJson: text("related_resources_json")
      .notNull()
      .default("[]"),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("club_public_profile_details_org_club_unique").on(
      table.organizationId,
      table.clubId,
    ),
    index("club_public_profile_details_org_updated_idx").on(
      table.organizationId,
      table.updatedAt,
    ),
    index("club_public_profile_details_org_og_media_idx").on(
      table.organizationId,
      table.ogMediaAssetId,
    ),
    check(
      "club_public_profile_details_display_name_check",
      sql`length(trim(${table.publicDisplayName})) BETWEEN 1 AND 120`,
    ),
    check(
      "club_public_profile_details_summary_check",
      sql`length(${table.shortSummary}) BETWEEN 1 AND 500`,
    ),
    check(
      "club_public_profile_details_description_check",
      sql`length(${table.fullDescription}) BETWEEN 1 AND 20000`,
    ),
    check(
      "club_public_profile_details_program_type_check",
      sql`${table.programType} IN ('club', 'program', 'circle', 'series', 'other')`,
    ),
    check(
      "club_public_profile_details_alt_check",
      sql`${table.imageAltText} IS NULL
          OR length(${table.imageAltText}) BETWEEN 1 AND 300`,
    ),
    check(
      "club_public_profile_details_theme_check",
      sql`${table.themeColor} IS NULL
          OR (
            length(${table.themeColor}) = 7
            AND substr(${table.themeColor}, 1, 1) = '#'
            AND substr(${table.themeColor}, 2)
                NOT GLOB '*[^0-9A-Fa-f]*'
          )`,
    ),
    check(
      "club_public_profile_details_seo_title_check",
      sql`${table.seoTitle} IS NULL
          OR length(trim(${table.seoTitle})) BETWEEN 1 AND 60`,
    ),
    check(
      "club_public_profile_details_meta_description_check",
      sql`${table.metaDescription} IS NULL
          OR length(trim(${table.metaDescription})) BETWEEN 1 AND 160`,
    ),
    check(
      "club_public_profile_details_social_links_check",
      sql`json_valid(${table.confirmedSocialLinksJson})
          AND json_type(${table.confirmedSocialLinksJson}) = 'array'
          AND length(CAST(${table.confirmedSocialLinksJson} AS BLOB)) <= 16384`,
    ),
    check(
      "club_public_profile_details_resources_check",
      sql`json_valid(${table.relatedResourcesJson})
          AND json_type(${table.relatedResourcesJson}) = 'array'
          AND length(CAST(${table.relatedResourcesJson} AS BLOB)) <= 16384`,
    ),
  ],
);

/**
 * Published recurring-program content remains a sidecar of the canonical
 * private `programs` scheduling identity. CMS revisions are the private draft
 * source; this table is only the allowlisted materialized public projection.
 */
export const programPublicProfileDetails = sqliteTable(
  "program_public_profile_details",
  {
    programId: text("program_id")
      .primaryKey()
      .references(() => programs.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clubId: text("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "restrict" }),
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
    displayOrder: integer("display_order").notNull().default(1000),
    publicDisplayName: text("public_display_name").notNull(),
    publicSlug: text("public_slug").notNull(),
    shortSummary: text("short_summary").notNull(),
    fullDescription: text("full_description").notNull(),
    programType: text("program_type", {
      enum: ["program", "circle", "series", "other"],
    })
      .notNull()
      .default("program"),
    publicGroupUrl: text("public_group_url"),
    coverMediaAssetId: text("cover_media_asset_id").references(
      () => mediaAssets.id,
      { onDelete: "restrict" },
    ),
    thumbnailMediaAssetId: text("thumbnail_media_asset_id").references(
      () => mediaAssets.id,
      { onDelete: "restrict" },
    ),
    themeColor: text("theme_color"),
    participantExpectations: text("participant_expectations"),
    preparationInformation: text("preparation_information"),
    typicalFormat: text("typical_format"),
    confirmedSocialLinksJson: text("confirmed_social_links_json")
      .notNull()
      .default("[]"),
    relatedResourcesJson: text("related_resources_json")
      .notNull()
      .default("[]"),
    seoTitle: text("seo_title"),
    metaDescription: text("meta_description"),
    ogMediaAssetId: text("og_media_asset_id").references(
      () => mediaAssets.id,
      { onDelete: "restrict" },
    ),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    publishedAt: integer("published_at"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("program_public_profile_details_org_program_unique").on(
      table.organizationId,
      table.programId,
    ),
    uniqueIndex("program_public_profile_details_org_slug_unique").on(
      table.organizationId,
      table.publicSlug,
    ),
    index("program_public_profile_details_org_club_status_idx").on(
      table.organizationId,
      table.clubId,
      table.publicationStatus,
      table.isFeatured,
      table.displayOrder,
      table.deletedAt,
    ),
    index("program_public_profile_details_org_og_media_idx").on(
      table.organizationId,
      table.ogMediaAssetId,
    ),
    check(
      "program_public_profile_details_status_check",
      sql`${table.publicationStatus} IN ('draft', 'published', 'archived')`,
    ),
    check(
      "program_public_profile_details_published_at_check",
      sql`${table.publicationStatus} <> 'published'
          OR ${table.publishedAt} IS NOT NULL`,
    ),
    check(
      "program_public_profile_details_order_check",
      sql`${table.displayOrder} BETWEEN 0 AND 100000`,
    ),
    check(
      "program_public_profile_details_program_type_check",
      sql`${table.programType} IN ('program', 'circle', 'series', 'other')`,
    ),
    check(
      "program_public_profile_details_name_check",
      sql`length(trim(${table.publicDisplayName})) BETWEEN 1 AND 120`,
    ),
    check(
      "program_public_profile_details_slug_check",
      sql`length(trim(${table.publicSlug})) BETWEEN 1 AND 120`,
    ),
    check(
      "program_public_profile_details_summary_check",
      sql`length(${table.shortSummary}) BETWEEN 0 AND 500`,
    ),
    check(
      "program_public_profile_details_description_check",
      sql`length(${table.fullDescription}) BETWEEN 0 AND 20000`,
    ),
    check(
      "program_public_profile_details_theme_check",
      sql`${table.themeColor} IS NULL
          OR (
            length(${table.themeColor}) = 7
            AND substr(${table.themeColor}, 1, 1) = '#'
            AND substr(${table.themeColor}, 2)
                NOT GLOB '*[^0-9A-Fa-f]*'
          )`,
    ),
    check(
      "program_public_profile_details_seo_title_check",
      sql`${table.seoTitle} IS NULL
          OR length(trim(${table.seoTitle})) BETWEEN 1 AND 60`,
    ),
    check(
      "program_public_profile_details_meta_description_check",
      sql`${table.metaDescription} IS NULL
          OR length(trim(${table.metaDescription})) BETWEEN 1 AND 160`,
    ),
    check(
      "program_public_profile_details_social_links_check",
      sql`json_valid(${table.confirmedSocialLinksJson})
          AND json_type(${table.confirmedSocialLinksJson}) = 'array'
          AND length(CAST(${table.confirmedSocialLinksJson} AS BLOB)) <= 16384`,
    ),
    check(
      "program_public_profile_details_resources_check",
      sql`json_valid(${table.relatedResourcesJson})
          AND json_type(${table.relatedResourcesJson}) = 'array'
          AND length(CAST(${table.relatedResourcesJson} AS BLOB)) <= 16384`,
    ),
  ],
);

export const communityLinkPublicDetails = sqliteTable(
  "community_link_public_details",
  {
    communityLinkId: text("community_link_id")
      .primaryKey()
      .references(() => communityLinks.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    destinationType: text("destination_type", {
      enum: [
        "meetup_group",
        "meetup_discussion",
        "social_profile",
        "community_platform",
        "resource",
        "other",
      ],
    }).notNull(),
    confirmedByProfileId: text("confirmed_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    confirmedAt: integer("confirmed_at").notNull(),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("community_link_public_details_org_link_unique").on(
      table.organizationId,
      table.communityLinkId,
    ),
    index("community_link_public_details_org_type_idx").on(
      table.organizationId,
      table.destinationType,
      table.confirmedAt,
    ),
    check(
      "community_link_public_details_description_check",
      sql`length(${table.description}) BETWEEN 1 AND 240`,
    ),
    check(
      "community_link_public_details_destination_check",
      sql`${table.destinationType} IN (
        'meetup_group', 'meetup_discussion', 'social_profile',
        'community_platform', 'resource', 'other'
      )`,
    ),
  ],
);

/**
 * Existing `media_assets` remains the private original metadata record.
 * Processing, provenance, variants, and usage are normalized in additive
 * sidecars so object bytes stay in R2 and are never embedded in D1.
 */
export const mediaAssetDetails = sqliteTable(
  "media_asset_details",
  {
    assetId: text("asset_id")
      .primaryKey()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    uploadState: text("upload_state", {
      enum: ["pending", "ready", "failed", "deleting"],
    })
      .notNull()
      .default("pending"),
    caption: text("caption"),
    privateRightsSourceNote: text("private_rights_source_note"),
    privateParticipantConsentNote: text(
      "private_participant_consent_note",
    ),
    focalPointX: integer("focal_point_x").notNull().default(5000),
    focalPointY: integer("focal_point_y").notNull().default(5000),
    informative: integer("informative", { mode: "boolean" })
      .notNull()
      .default(true),
    contentVersion: integer("content_version").notNull().default(1),
    originalSha256: text("original_sha256"),
    width: integer("width"),
    height: integer("height"),
    pixelCount: integer("pixel_count"),
    failureCode: text("failure_code"),
    finalizedAt: integer("finalized_at"),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("media_asset_details_org_asset_unique").on(
      table.organizationId,
      table.assetId,
    ),
    index("media_asset_details_org_state_idx").on(
      table.organizationId,
      table.uploadState,
      table.updatedAt,
    ),
    check(
      "media_asset_details_state_check",
      sql`${table.uploadState} IN ('pending', 'ready', 'failed', 'deleting')`,
    ),
    check(
      "media_asset_details_state_shape_check",
      sql`(
        ${table.uploadState} = 'pending'
        AND ${table.originalSha256} IS NULL
        AND ${table.width} IS NULL
        AND ${table.height} IS NULL
        AND ${table.pixelCount} IS NULL
        AND ${table.failureCode} IS NULL
        AND ${table.finalizedAt} IS NULL
      ) OR (
        ${table.uploadState} = 'ready'
        AND ${table.originalSha256} IS NOT NULL
        AND ${table.width} IS NOT NULL
        AND ${table.height} IS NOT NULL
        AND ${table.pixelCount} IS NOT NULL
        AND ${table.failureCode} IS NULL
        AND ${table.finalizedAt} IS NOT NULL
      ) OR (
        ${table.uploadState} = 'failed'
        AND length(trim(${table.failureCode})) BETWEEN 1 AND 64
        AND ${table.finalizedAt} IS NULL
      ) OR (
        ${table.uploadState} = 'deleting'
        AND ${table.failureCode} IS NULL
        AND ${table.finalizedAt} IS NOT NULL
      )`,
    ),
    check(
      "media_asset_details_bounds_check",
      sql`${table.focalPointX} BETWEEN 0 AND 10000
          AND ${table.focalPointY} BETWEEN 0 AND 10000
          AND ${table.informative} IN (0, 1)
          AND ${table.contentVersion} >= 1
          AND (${table.caption} IS NULL OR length(${table.caption}) <= 1000)
          AND (
            ${table.privateRightsSourceNote} IS NULL
            OR length(${table.privateRightsSourceNote}) <= 1000
          )
          AND (
            ${table.privateParticipantConsentNote} IS NULL
            OR length(${table.privateParticipantConsentNote}) <= 1000
          )`,
    ),
    check(
      "media_asset_details_image_check",
      sql`(
        ${table.originalSha256} IS NULL
        OR (
          length(${table.originalSha256}) = 64
          AND ${table.originalSha256} = lower(${table.originalSha256})
          AND ${table.originalSha256} NOT GLOB '*[^0-9a-f]*'
        )
      ) AND (
        ${table.width} IS NULL
        OR (
          ${table.width} BETWEEN 1 AND 8000
          AND ${table.height} BETWEEN 1 AND 8000
          AND ${table.pixelCount} =
              ${table.width} * ${table.height}
          AND ${table.pixelCount} BETWEEN 1 AND 20000000
        )
      )`,
    ),
  ],
);

export const mediaAssetVariants = sqliteTable(
  "media_asset_variants",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    variantKind: text("variant_kind", {
      enum: ["original", "webp_480", "webp_960", "webp_1600"],
    }).notNull(),
    objectKey: text("object_key").notNull(),
    mimeType: text("mime_type", {
      enum: ["image/jpeg", "image/png", "image/webp"],
    }).notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    pixelCount: integer("pixel_count").notNull(),
    sha256: text("sha256").notNull(),
    state: text("state", {
      enum: ["pending", "ready", "failed"],
    })
      .notNull()
      .default("pending"),
    failureCode: text("failure_code"),
    createdAt: integer("created_at").notNull().default(nowMs),
    finalizedAt: integer("finalized_at"),
  },
  (table) => [
    uniqueIndex("media_asset_variants_asset_kind_unique").on(
      table.assetId,
      table.variantKind,
    ),
    uniqueIndex("media_asset_variants_org_object_key_unique").on(
      table.organizationId,
      table.objectKey,
    ),
    index("media_asset_variants_org_asset_state_idx").on(
      table.organizationId,
      table.assetId,
      table.state,
    ),
    check(
      "media_asset_variants_kind_check",
      sql`${table.variantKind} IN (
        'original', 'webp_480', 'webp_960', 'webp_1600'
      )`,
    ),
    check(
      "media_asset_variants_mime_check",
      sql`${table.mimeType} IN ('image/jpeg', 'image/png', 'image/webp')
          AND (
            ${table.variantKind} = 'original'
            OR ${table.mimeType} = 'image/webp'
          )`,
    ),
    check(
      "media_asset_variants_image_check",
      sql`${table.byteSize} BETWEEN 1 AND 8388608
          AND ${table.width} BETWEEN 1 AND 8000
          AND ${table.height} BETWEEN 1 AND 8000
          AND ${table.pixelCount} = ${table.width} * ${table.height}
          AND ${table.pixelCount} BETWEEN 1 AND 20000000
          AND length(${table.sha256}) = 64
          AND ${table.sha256} = lower(${table.sha256})
          AND ${table.sha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "media_asset_variants_state_shape_check",
      sql`(
        ${table.state} = 'pending'
        AND ${table.failureCode} IS NULL
        AND ${table.finalizedAt} IS NULL
      ) OR (
        ${table.state} = 'ready'
        AND ${table.failureCode} IS NULL
        AND ${table.finalizedAt} IS NOT NULL
      ) OR (
        ${table.state} = 'failed'
        AND length(trim(${table.failureCode})) BETWEEN 1 AND 64
        AND ${table.finalizedAt} IS NULL
      )`,
    ),
  ],
);

/**
 * One bounded write envelope authorizes an exact self-confirmation, revocation,
 * or one-time legacy adoption. It prevents a syntactically valid receipt from
 * being inserted outside the atomic profile/state/audit transaction.
 */
export const organizerPublicAttributionWriteIntents = sqliteTable(
  "organizer_public_attribution_write_intents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    operation: text("operation", {
      enum: ["adopted", "confirmed", "revoked"],
    }).notNull(),
    expectedDraftVersion: integer("expected_draft_version").notNull(),
    expectedPublishedVersion: integer(
      "expected_published_version",
    ).notNull(),
    proposedPublishedVersion: integer(
      "proposed_published_version",
    ).notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    completedAt: integer("completed_at"),
  },
  (table) => [
    uniqueIndex(
      "organizer_public_attribution_intents_profile_version_unique",
    ).on(
      table.organizationId,
      table.profileId,
      table.proposedPublishedVersion,
    ),
    index("organizer_public_attribution_intents_open_idx").on(
      table.organizationId,
      table.completedAt,
      table.createdAt,
    ),
    check(
      "organizer_public_attribution_intents_operation_check",
      sql`${table.operation} IN ('adopted', 'confirmed', 'revoked')`,
    ),
    check(
      "organizer_public_attribution_intents_version_check",
      sql`${table.expectedDraftVersion} >= 1
          AND ${table.expectedPublishedVersion} >= 0
          AND ${table.proposedPublishedVersion} =
              ${table.expectedPublishedVersion} + 1`,
    ),
    check(
      "organizer_public_attribution_intents_hash_check",
      sql`length(${table.snapshotHash}) = 64
          AND ${table.snapshotHash} = lower(${table.snapshotHash})
          AND ${table.snapshotHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);

/**
 * Immutable self-attribution receipts bind an organizer's explicit public
 * consent or revocation to the exact bounded public name, biography, and
 * approved profile-photo selection. Administrators cannot consent for another
 * person; runtime guards enforce that the actor and subject are identical.
 */
export const organizerPublicAttributionReceipts = sqliteTable(
  "organizer_public_attribution_receipts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    action: text("action", {
      enum: ["adopted", "confirmed", "revoked"],
    }).notNull(),
    attributionVersion: integer("attribution_version").notNull(),
    displayName: text("display_name"),
    biography: text("biography"),
    photoMediaAssetId: text("photo_media_asset_id").references(
      () => mediaAssets.id,
      { onDelete: "restrict" },
    ),
    consent: integer("consent", { mode: "boolean" }).notNull(),
    draftVersion: integer("draft_version").notNull(),
    legacyAdopted: integer("legacy_adopted", {
      mode: "boolean",
    }).notNull(),
    priorPublishedVersion: integer("prior_published_version"),
    snapshotJson: text("snapshot_json").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    writeIntentId: text("write_intent_id")
      .notNull()
      .references(() => organizerPublicAttributionWriteIntents.id, {
        onDelete: "restrict",
      }),
    relatedReceiptId: text("related_receipt_id"),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("organizer_public_attribution_receipts_profile_version_unique")
      .on(
        table.organizationId,
        table.profileId,
        table.attributionVersion,
      ),
    index("organizer_public_attribution_receipts_org_profile_idx").on(
      table.organizationId,
      table.profileId,
      table.createdAt,
    ),
    uniqueIndex("organizer_public_attribution_receipts_intent_unique").on(
      table.writeIntentId,
    ),
    check(
      "organizer_public_attribution_receipts_action_check",
      sql`${table.action} IN ('adopted', 'confirmed', 'revoked')`,
    ),
    check(
      "organizer_public_attribution_receipts_version_check",
      sql`${table.attributionVersion} >= 1
          AND ${table.draftVersion} >= 1
          AND (
            ${table.priorPublishedVersion} IS NULL
            OR ${table.priorPublishedVersion} >= 1
          )`,
    ),
    check(
      "organizer_public_attribution_receipts_fields_check",
      sql`(
        ${table.action} = 'adopted'
        AND ${table.consent} = 1
        AND ${table.legacyAdopted} = 1
        AND ${table.displayName} IS NOT NULL
        AND length(trim(${table.displayName})) BETWEEN 1 AND 120
        AND ${table.biography} IS NULL
        AND ${table.photoMediaAssetId} IS NULL
        AND ${table.priorPublishedVersion} IS NULL
      ) OR (
        ${table.action} = 'confirmed'
        AND ${table.consent} = 1
        AND ${table.legacyAdopted} = 0
        AND ${table.displayName} IS NOT NULL
        AND length(trim(${table.displayName})) BETWEEN 1 AND 120
        AND (
          ${table.biography} IS NULL
          OR length(${table.biography}) BETWEEN 1 AND 800
        )
        AND ${table.priorPublishedVersion} IS NULL
      ) OR (
        ${table.action} = 'revoked'
        AND ${table.consent} = 0
        AND ${table.legacyAdopted} = 0
        AND ${table.displayName} IS NULL
        AND ${table.biography} IS NULL
        AND ${table.photoMediaAssetId} IS NULL
        AND ${table.priorPublishedVersion} IS NOT NULL
      )`,
    ),
    check(
      "organizer_public_attribution_receipts_snapshot_check",
      sql`json_valid(${table.snapshotJson})
          AND json_type(${table.snapshotJson}) = 'object'
          AND length(CAST(${table.snapshotJson} AS BLOB)) BETWEEN 2 AND 4096`,
    ),
    check(
      "organizer_public_attribution_receipts_hash_check",
      sql`length(${table.snapshotHash}) = 64
          AND ${table.snapshotHash} = lower(${table.snapshotHash})
          AND ${table.snapshotHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "organizer_public_attribution_receipts_relationship_check",
      sql`(
        ${table.action} IN ('adopted', 'confirmed')
      ) OR (
        ${table.action} = 'revoked'
        AND ${table.relatedReceiptId} IS NOT NULL
      )`,
    ),
  ],
);

/**
 * Private profile drafts remain separate from the one exact materialized
 * public attribution. The monotonic attribution version is the optimistic
 * compare-and-swap token for draft saves, confirmation, and revocation.
 */
export const organizerPublicAttributionStates = sqliteTable(
  "organizer_public_attribution_states",
  {
    profileId: text("profile_id")
      .primaryKey()
      .references(() => profiles.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    attributionVersion: integer("attribution_version").notNull().default(1),
    publishedAttributionVersion: integer(
      "published_attribution_version",
    )
      .notNull()
      .default(0),
    workflowStatus: text("workflow_status", {
      enum: ["unconfirmed", "confirmed", "revoked"],
    })
      .notNull()
      .default("unconfirmed"),
    draftPhotoMediaAssetId: text("draft_photo_media_asset_id").references(
      () => mediaAssets.id,
      { onDelete: "restrict" },
    ),
    publicDisplayName: text("public_display_name"),
    publicBiography: text("public_biography"),
    publicPhotoMediaAssetId: text("public_photo_media_asset_id").references(
      () => mediaAssets.id,
      { onDelete: "restrict" },
    ),
    currentReceiptId: text("current_receipt_id").references(
      () => organizerPublicAttributionReceipts.id,
      { onDelete: "restrict" },
    ),
    confirmedAt: integer("confirmed_at"),
    revokedAt: integer("revoked_at"),
    updatedByProfileId: text("updated_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("organizer_public_attribution_states_org_profile_unique").on(
      table.organizationId,
      table.profileId,
    ),
    index("organizer_public_attribution_states_org_status_idx").on(
      table.organizationId,
      table.workflowStatus,
      table.updatedAt,
    ),
    index("organizer_public_attribution_states_org_photo_idx").on(
      table.organizationId,
      table.publicPhotoMediaAssetId,
    ),
    check(
      "organizer_public_attribution_states_version_check",
      sql`${table.attributionVersion} >= 1
          AND ${table.publishedAttributionVersion} >= 0`,
    ),
    check(
      "organizer_public_attribution_states_status_check",
      sql`${table.workflowStatus} IN ('unconfirmed', 'confirmed', 'revoked')`,
    ),
    check(
      "organizer_public_attribution_states_shape_check",
      sql`(
        ${table.workflowStatus} = 'unconfirmed'
        AND ${table.currentReceiptId} IS NULL
        AND ${table.publicDisplayName} IS NULL
        AND ${table.publicBiography} IS NULL
        AND ${table.publicPhotoMediaAssetId} IS NULL
        AND ${table.confirmedAt} IS NULL
        AND ${table.revokedAt} IS NULL
        AND ${table.publishedAttributionVersion} = 0
      ) OR (
        ${table.workflowStatus} = 'confirmed'
        AND length(trim(${table.publicDisplayName})) BETWEEN 1 AND 120
        AND ${table.currentReceiptId} IS NOT NULL
        AND ${table.confirmedAt} IS NOT NULL
        AND ${table.revokedAt} IS NULL
        AND ${table.publishedAttributionVersion} >= 1
      ) OR (
        ${table.workflowStatus} = 'revoked'
        AND ${table.currentReceiptId} IS NOT NULL
        AND ${table.publicDisplayName} IS NULL
        AND ${table.publicBiography} IS NULL
        AND ${table.publicPhotoMediaAssetId} IS NULL
        AND ${table.revokedAt} IS NOT NULL
        AND ${table.publishedAttributionVersion} >= 1
      )`,
    ),
    check(
      "organizer_public_attribution_states_biography_check",
      sql`${table.publicBiography} IS NULL
          OR length(${table.publicBiography}) BETWEEN 1 AND 800`,
    ),
  ],
);

export const mediaUsageReferences = sqliteTable(
  "media_usage_references",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    entityType: text("entity_type", {
      enum: [
        "page",
        "club_public_profile",
        "program_public_profile",
        "organizer_event",
        "organizer_profile",
        "site_logo",
        "site_og",
        "footer",
        "community_link",
      ],
    }).notNull(),
    entityId: text("entity_id").notNull(),
    revisionId: text("revision_id").notNull(),
    usageKind: text("usage_kind").notNull(),
    publicationScope: text("publication_scope", {
      enum: ["draft", "published"],
    }).notNull(),
    createdByProfileId: text("created_by_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull().default(nowMs),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("media_usage_references_active_usage_unique")
      .on(
        table.organizationId,
        table.entityType,
        table.entityId,
        table.revisionId,
        table.usageKind,
        table.publicationScope,
      )
      .where(sql`${table.deletedAt} IS NULL`),
    index("media_usage_references_asset_scope_idx").on(
      table.organizationId,
      table.assetId,
      table.publicationScope,
      table.deletedAt,
    ),
    index("media_usage_references_entity_idx").on(
      table.organizationId,
      table.entityType,
      table.entityId,
      table.deletedAt,
    ),
    check(
      "media_usage_references_entity_type_check",
      sql`${table.entityType} IN (
        'page', 'club_public_profile', 'program_public_profile',
        'organizer_event', 'organizer_profile',
        'site_logo', 'site_og', 'footer', 'community_link'
      )`,
    ),
    check(
      "media_usage_references_scope_check",
      sql`${table.publicationScope} IN ('draft', 'published')`,
    ),
    check(
      "media_usage_references_identity_check",
      sql`length(trim(${table.entityId})) BETWEEN 1 AND 160
          AND length(trim(${table.usageKind})) BETWEEN 1 AND 64
          AND length(trim(${table.revisionId})) BETWEEN 1 AND 160`,
    ),
  ],
);

/**
 * An immutable receipt binds Owner confirmation or revocation to the exact
 * private legal-status revision hash. Public legal wording still requires a
 * separate CMS publication state transition.
 */
export const legalStatusConfirmationReceipts = sqliteTable(
  "legal_status_confirmation_receipts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    revisionId: text("revision_id")
      .notNull()
      .references(() => cmsEntityRevisions.id, { onDelete: "restrict" }),
    revisionHash: text("revision_hash").notNull(),
    action: text("action", { enum: ["confirmed", "revoked"] }).notNull(),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    revokesReceiptId: text("revokes_receipt_id"),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("legal_status_confirmation_receipts_confirm_unique")
      .on(table.organizationId, table.revisionId)
      .where(sql`${table.action} = 'confirmed'`),
    uniqueIndex("legal_status_confirmation_receipts_revoke_unique")
      .on(table.revokesReceiptId)
      .where(sql`${table.revokesReceiptId} IS NOT NULL`),
    index("legal_status_confirmation_receipts_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    check(
      "legal_status_confirmation_receipts_action_shape_check",
      sql`(
        ${table.action} = 'confirmed'
        AND ${table.revokesReceiptId} IS NULL
      ) OR (
        ${table.action} = 'revoked'
        AND ${table.revokesReceiptId} IS NOT NULL
      )`,
    ),
    check(
      "legal_status_confirmation_receipts_hash_check",
      sql`length(${table.revisionHash}) = 64
          AND ${table.revisionHash} = lower(${table.revisionHash})
          AND ${table.revisionHash} NOT GLOB '*[^0-9a-f]*'`,
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

/**
 * Single-transaction proof for every Phase 7 submission create, workflow
 * mutation, assignment, and owner redaction. The intent is inserted before
 * either side of the legacy-base/companion update and is completed only after
 * both rows and the minimum-safe audit receipt agree. Completed intent payload
 * copies are immutable except for the exact Owner redaction envelope, which
 * replaces every historical copy with the canonical redaction marker.
 */
export const formSubmissionWriteIntents = sqliteTable(
  "form_submission_write_intents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    submissionId: text("submission_id").notNull(),
    action: text("action", {
      enum: ["create", "assign", "status", "redact"],
    }).notNull(),
    expectedWorkflowVersion: integer("expected_workflow_version").notNull(),
    proposedWorkflowVersion: integer("proposed_workflow_version").notNull(),
    proposedCanonicalStatus: text("proposed_canonical_status", {
      enum: ["new", "in_review", "responded", "archived", "spam"],
    }).notNull(),
    proposedAssignedToProfileId: text(
      "proposed_assigned_to_profile_id",
    ).references(() => profiles.id, { onDelete: "restrict" }),
    proposedPayloadJson: text("proposed_payload_json").notNull(),
    proposedPublicReference: text("proposed_public_reference"),
    proposedRequestIdempotencyHash: text(
      "proposed_request_idempotency_hash",
    ),
    proposedRetentionReviewAt: integer("proposed_retention_review_at"),
    actorProfileId: text("actor_profile_id").references(() => profiles.id, {
      onDelete: "restrict",
    }),
    createdAt: integer("created_at").notNull().default(nowMs),
    completedAt: integer("completed_at"),
    completionAuditLogId: text("completion_audit_log_id"),
  },
  (table) => [
    uniqueIndex("form_submission_write_intents_open_unique")
      .on(table.organizationId, table.submissionId)
      .where(sql`${table.completedAt} IS NULL`),
    index("form_submission_write_intents_submission_idx").on(
      table.organizationId,
      table.submissionId,
      table.createdAt,
    ),
    check(
      "form_submission_write_intents_action_check",
      sql`${table.action} IN ('create', 'assign', 'status', 'redact')`,
    ),
    check(
      "form_submission_write_intents_version_check",
      sql`(
        ${table.action} = 'create'
        AND ${table.expectedWorkflowVersion} = 0
        AND ${table.proposedWorkflowVersion} = 1
      ) OR (
        ${table.action} <> 'create'
        AND ${table.expectedWorkflowVersion} >= 1
        AND ${table.proposedWorkflowVersion} =
            ${table.expectedWorkflowVersion} + 1
      )`,
    ),
    check(
      "form_submission_write_intents_status_check",
      sql`${table.proposedCanonicalStatus} IN (
        'new', 'in_review', 'responded', 'archived', 'spam'
      )`,
    ),
    check(
      "form_submission_write_intents_payload_check",
      sql`json_valid(${table.proposedPayloadJson})
          AND length(${table.proposedPayloadJson}) BETWEEN 2 AND 16384`,
    ),
    check(
      "form_submission_write_intents_create_shape_check",
      sql`(
        ${table.action} = 'create'
        AND ${table.actorProfileId} IS NULL
        AND ${table.proposedAssignedToProfileId} IS NULL
        AND ${table.proposedPublicReference} IS NOT NULL
        AND ${table.proposedRequestIdempotencyHash} IS NOT NULL
        AND ${table.proposedRetentionReviewAt} IS NOT NULL
      ) OR (
        ${table.action} <> 'create'
        AND ${table.actorProfileId} IS NOT NULL
        AND ${table.proposedPublicReference} IS NULL
        AND ${table.proposedRequestIdempotencyHash} IS NULL
        AND ${table.proposedRetentionReviewAt} IS NULL
      )`,
    ),
    check(
      "form_submission_write_intents_reference_check",
      sql`${table.proposedPublicReference} IS NULL OR (
        length(${table.proposedPublicReference}) BETWEEN 12 AND 64
        AND substr(${table.proposedPublicReference}, 1, 4) = 'VCC-'
        AND substr(${table.proposedPublicReference}, 5)
            NOT GLOB '*[^A-Z0-9-]*'
      )`,
    ),
    check(
      "form_submission_write_intents_idempotency_check",
      sql`${table.proposedRequestIdempotencyHash} IS NULL OR (
        length(${table.proposedRequestIdempotencyHash}) = 64
        AND ${table.proposedRequestIdempotencyHash} =
            lower(${table.proposedRequestIdempotencyHash})
        AND ${table.proposedRequestIdempotencyHash}
            NOT GLOB '*[^0-9a-f]*'
      )`,
    ),
    check(
      "form_submission_write_intents_completion_check",
      sql`(
        ${table.completedAt} IS NULL
        AND ${table.completionAuditLogId} IS NULL
      ) OR (
        ${table.completedAt} IS NOT NULL
        AND ${table.completionAuditLogId} IS NOT NULL
        AND ${table.completedAt} >= ${table.createdAt}
      )`,
    ),
  ],
);

export const formSubmissionWorkflows = sqliteTable(
  "form_submission_workflows",
  {
    submissionId: text("submission_id")
      .primaryKey()
      .references(() => formSubmissions.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    publicReference: text("public_reference").notNull(),
    canonicalStatus: text("canonical_status", {
      enum: ["new", "in_review", "responded", "archived", "spam"],
    })
      .notNull()
      .default("new"),
    requestIdempotencyHash: text("request_idempotency_hash").notNull(),
    retentionReviewAt: integer("retention_review_at").notNull(),
    version: integer("version").notNull().default(1),
    writeIntentId: text("write_intent_id").notNull(),
    updatedByProfileId: text("updated_by_profile_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    redactedAt: integer("redacted_at"),
    redactedByProfileId: text("redacted_by_profile_id").references(
      () => profiles.id,
      { onDelete: "restrict" },
    ),
  },
  (table) => [
    uniqueIndex("form_submission_workflows_public_reference_unique").on(
      table.publicReference,
    ),
    uniqueIndex("form_submission_workflows_idempotency_unique").on(
      table.requestIdempotencyHash,
    ),
    index("form_submission_workflows_org_status_retention_idx").on(
      table.organizationId,
      table.canonicalStatus,
      table.retentionReviewAt,
      table.createdAt,
    ),
    check(
      "form_submission_workflows_public_reference_check",
      sql`length(${table.publicReference}) BETWEEN 12 AND 64
          AND substr(${table.publicReference}, 1, 4) = 'VCC-'
          AND substr(${table.publicReference}, 5) NOT GLOB '*[^A-Z0-9-]*'`,
    ),
    check(
      "form_submission_workflows_status_check",
      sql`${table.canonicalStatus} IN ('new', 'in_review', 'responded', 'archived', 'spam')`,
    ),
    check(
      "form_submission_workflows_idempotency_hash_check",
      sql`length(${table.requestIdempotencyHash}) = 64
          AND ${table.requestIdempotencyHash} = lower(${table.requestIdempotencyHash})
          AND ${table.requestIdempotencyHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "form_submission_workflows_version_check",
      sql`${table.version} >= 1`,
    ),
    check(
      "form_submission_workflows_retention_check",
      sql`${table.retentionReviewAt} >= ${table.createdAt}`,
    ),
    check(
      "form_submission_workflows_redaction_check",
      sql`(${table.redactedAt} IS NULL AND ${table.redactedByProfileId} IS NULL)
          OR (${table.redactedAt} IS NOT NULL AND ${table.redactedByProfileId} IS NOT NULL)`,
    ),
  ],
);

export const formSubmissionNotes = sqliteTable(
  "form_submission_notes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    submissionId: text("submission_id")
      .notNull()
      .references(() => formSubmissions.id, { onDelete: "cascade" }),
    authorProfileId: text("author_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    bodyText: text("body_text").notNull(),
    createdAt: integer("created_at").notNull().default(nowMs),
    redactedAt: integer("redacted_at"),
    redactedByProfileId: text("redacted_by_profile_id").references(
      () => profiles.id,
      { onDelete: "restrict" },
    ),
  },
  (table) => [
    index("form_submission_notes_submission_created_idx").on(
      table.organizationId,
      table.submissionId,
      table.createdAt,
    ),
    check(
      "form_submission_notes_body_check",
      sql`length(${table.bodyText}) BETWEEN 1 AND 4000`,
    ),
    check(
      "form_submission_notes_redaction_check",
      sql`(${table.redactedAt} IS NULL AND ${table.redactedByProfileId} IS NULL)
          OR (${table.redactedAt} IS NOT NULL AND ${table.redactedByProfileId} IS NOT NULL)`,
    ),
  ],
);

export const publicFormProtectionKeys = sqliteTable(
  "public_form_protection_keys",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    keyHex: text("key_hex").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    check(
      "public_form_protection_keys_material_check",
      sql`length(${table.keyHex}) = 64
          AND ${table.keyHex} = lower(${table.keyHex})
          AND ${table.keyHex} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "public_form_protection_keys_version_check",
      sql`${table.version} >= 1`,
    ),
  ],
);

export const publicFormRateWindows = sqliteTable(
  "public_form_rate_windows",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    action: text("action", {
      enum: [
        "public_form_scope_15m",
        "public_form_scope_day",
        "public_form_organization_hour",
      ],
    }).notNull(),
    scopeKey: text("scope_key").notNull(),
    windowStartedAt: integer("window_started_at").notNull(),
    windowEndsAt: integer("window_ends_at").notNull(),
    requestCount: integer("request_count").notNull().default(1),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("public_form_rate_windows_scope_unique").on(
      table.organizationId,
      table.action,
      table.scopeKey,
      table.windowStartedAt,
    ),
    index("public_form_rate_windows_active_idx").on(
      table.organizationId,
      table.action,
      table.windowEndsAt,
    ),
    check(
      "public_form_rate_windows_action_check",
      sql`${table.action} IN (
        'public_form_scope_15m',
        'public_form_scope_day',
        'public_form_organization_hour'
      )`,
    ),
    check(
      "public_form_rate_windows_scope_hash_check",
      sql`length(${table.scopeKey}) = 64
          AND ${table.scopeKey} = lower(${table.scopeKey})
          AND ${table.scopeKey} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "public_form_rate_windows_window_check",
      sql`(
        ${table.action} = 'public_form_scope_15m'
        AND ${table.windowEndsAt} =
            ${table.windowStartedAt} + 900000
        AND ${table.windowStartedAt} % 900000 = 0
      ) OR (
        ${table.action} = 'public_form_scope_day'
        AND ${table.windowEndsAt} =
            ${table.windowStartedAt} + 86400000
        AND ${table.windowStartedAt} % 86400000 = 0
      ) OR (
        ${table.action} = 'public_form_organization_hour'
        AND ${table.windowEndsAt} =
            ${table.windowStartedAt} + 3600000
        AND ${table.windowStartedAt} % 3600000 = 0
      )`,
    ),
    check(
      "public_form_rate_windows_count_check",
      sql`(
        ${table.action} = 'public_form_scope_15m'
        AND ${table.requestCount} BETWEEN 1 AND 5
      ) OR (
        ${table.action} = 'public_form_scope_day'
        AND ${table.requestCount} BETWEEN 1 AND 20
      ) OR (
        ${table.action} = 'public_form_organization_hour'
        AND ${table.requestCount} BETWEEN 1 AND 500
      )`,
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

export const importBatchDetails = sqliteTable(
  "import_batch_details",
  {
    importBatchId: text("import_batch_id")
      .primaryKey()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fileSha256: text("file_sha256").notNull(),
    sourceNamespace: text("source_namespace").notNull(),
    templateVersion: integer("template_version").notNull(),
    parserVersion: integer("parser_version").notNull(),
    encoding: text("encoding", { enum: ["utf-8"] }).notNull(),
    delimiter: text("delimiter", { enum: [","] }).notNull(),
    columnMappingJson: text("column_mapping_json").notNull(),
    mappingFingerprint: text("mapping_fingerprint").notNull(),
    previewFingerprint: text("preview_fingerprint"),
    previewVersion: integer("preview_version").notNull().default(0),
    totalRowCount: integer("total_row_count").notNull().default(0),
    validRowCount: integer("valid_row_count").notNull().default(0),
    invalidRowCount: integer("invalid_row_count").notNull().default(0),
    warningRowCount: integer("warning_row_count").notNull().default(0),
    selectedRowCount: integer("selected_row_count").notNull().default(0),
    importedRowCount: integer("imported_row_count").notNull().default(0),
    skippedRowCount: integer("skipped_row_count").notNull().default(0),
    failedRowCount: integer("failed_row_count").notNull().default(0),
    pendingRowCount: integer("pending_row_count").notNull().default(0),
    phase: text("phase", {
      enum: [
        "uploaded",
        "previewed",
        "approved",
        "applying",
        "completed",
        "completed_with_errors",
        "interrupted",
        "failed",
        "redacted",
      ],
    })
      .notNull()
      .default("uploaded"),
    outcomeCode: text("outcome_code"),
    applicationCursor: integer("application_cursor").notNull().default(0),
    version: integer("version").notNull().default(1),
    approvedByProfileId: text("approved_by_profile_id").references(
      () => profiles.id,
      { onDelete: "restrict" },
    ),
    approvedAt: integer("approved_at"),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    activeRunnerVersion: integer("active_runner_version"),
    activeRunnerLeaseHash: text("active_runner_lease_hash"),
    activeRunnerExpiresAt: integer("active_runner_expires_at"),
    sourcePayloadRedactedAt: integer("source_payload_redacted_at"),
    redactedByProfileId: text("redacted_by_profile_id").references(
      () => profiles.id,
      { onDelete: "restrict" },
    ),
    updatedByProfileId: text("updated_by_profile_id").references(
      () => profiles.id,
      { onDelete: "restrict" },
    ),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    index("import_batch_details_org_phase_idx").on(
      table.organizationId,
      table.phase,
      table.updatedAt,
    ),
    index("import_batch_details_runner_idx").on(
      table.organizationId,
      table.activeRunnerExpiresAt,
    ),
    check(
      "import_batch_details_file_hash_check",
      sql`length(${table.fileSha256}) = 64
          AND ${table.fileSha256} = lower(${table.fileSha256})
          AND ${table.fileSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "import_batch_details_source_namespace_check",
      sql`length(trim(${table.sourceNamespace})) BETWEEN 1 AND 100
          AND ${table.sourceNamespace} = lower(trim(${table.sourceNamespace}))`,
    ),
    check(
      "import_batch_details_versions_check",
      sql`${table.templateVersion} >= 1
          AND ${table.parserVersion} >= 1
          AND ${table.previewVersion} >= 0
          AND ${table.version} >= 1`,
    ),
    check(
      "import_batch_details_format_check",
      sql`${table.encoding} = 'utf-8' AND ${table.delimiter} = ','`,
    ),
    check(
      "import_batch_details_mapping_json_check",
      sql`json_valid(${table.columnMappingJson})
          AND json_type(${table.columnMappingJson}) = 'object'`,
    ),
    check(
      "import_batch_details_mapping_hash_check",
      sql`length(${table.mappingFingerprint}) = 64
          AND ${table.mappingFingerprint} = lower(${table.mappingFingerprint})
          AND ${table.mappingFingerprint} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "import_batch_details_preview_hash_check",
      sql`${table.previewFingerprint} IS NULL OR (
        length(${table.previewFingerprint}) = 64
        AND ${table.previewFingerprint} = lower(${table.previewFingerprint})
        AND ${table.previewFingerprint} NOT GLOB '*[^0-9a-f]*'
      )`,
    ),
    check(
      "import_batch_details_counts_check",
      sql`${table.totalRowCount} BETWEEN 0 AND 2000
          AND ${table.validRowCount} BETWEEN 0 AND ${table.totalRowCount}
          AND ${table.invalidRowCount} BETWEEN 0 AND ${table.totalRowCount}
          AND ${table.warningRowCount} BETWEEN 0 AND ${table.totalRowCount}
          AND ${table.selectedRowCount} BETWEEN 0 AND ${table.totalRowCount}
          AND ${table.importedRowCount} BETWEEN 0 AND ${table.totalRowCount}
          AND ${table.skippedRowCount} BETWEEN 0 AND ${table.totalRowCount}
          AND ${table.failedRowCount} BETWEEN 0 AND ${table.totalRowCount}
          AND ${table.pendingRowCount} BETWEEN 0 AND ${table.totalRowCount}
          AND ${table.validRowCount} + ${table.invalidRowCount} =
              ${table.totalRowCount}
          AND ${table.selectedRowCount} <= ${table.validRowCount}
          AND ${table.selectedRowCount} + ${table.skippedRowCount} <=
              ${table.totalRowCount}
          AND ${table.importedRowCount} + ${table.failedRowCount}
              + ${table.pendingRowCount} =
              ${table.selectedRowCount}`,
    ),
    check(
      "import_batch_details_phase_check",
      sql`${table.phase} IN (
        'uploaded', 'previewed', 'approved', 'applying', 'completed',
        'completed_with_errors', 'interrupted', 'failed', 'redacted'
      )`,
    ),
    check(
      "import_batch_details_cursor_check",
      sql`${table.applicationCursor} BETWEEN 0 AND ${table.totalRowCount}`,
    ),
    check(
      "import_batch_details_approval_shape_check",
      sql`(
        ${table.approvedAt} IS NULL
        AND ${table.approvedByProfileId} IS NULL
      ) OR (
        ${table.approvedAt} IS NOT NULL
        AND ${table.approvedByProfileId} IS NOT NULL
        AND ${table.previewFingerprint} IS NOT NULL
        AND ${table.previewVersion} >= 1
      )`,
    ),
    check(
      "import_batch_details_runner_shape_check",
      sql`(
        ${table.activeRunnerVersion} IS NULL
        AND ${table.activeRunnerLeaseHash} IS NULL
        AND ${table.activeRunnerExpiresAt} IS NULL
      ) OR (
        ${table.activeRunnerVersion} IS NOT NULL
        AND ${table.activeRunnerVersion} >= 1
        AND length(${table.activeRunnerLeaseHash}) = 64
        AND ${table.activeRunnerLeaseHash} =
            lower(${table.activeRunnerLeaseHash})
        AND ${table.activeRunnerLeaseHash} NOT GLOB '*[^0-9a-f]*'
        AND ${table.activeRunnerExpiresAt} IS NOT NULL
      )`,
    ),
    check(
      "import_batch_details_redaction_shape_check",
      sql`(
        ${table.sourcePayloadRedactedAt} IS NULL
        AND ${table.redactedByProfileId} IS NULL
      ) OR (
        ${table.sourcePayloadRedactedAt} IS NOT NULL
        AND ${table.redactedByProfileId} IS NOT NULL
      )`,
    ),
  ],
);

export const importRowApplications = sqliteTable(
  "import_row_applications",
  {
    importRowId: text("import_row_id")
      .primaryKey()
      .references(() => importRows.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    importBatchId: text("import_batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    normalizedRowFingerprint: text("normalized_row_fingerprint").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    previewResultCode: text("preview_result_code").notNull(),
    previewErrorCodesJson: text("preview_error_codes_json").notNull().default("[]"),
    previewWarningCodesJson: text("preview_warning_codes_json")
      .notNull()
      .default("[]"),
    approvalAction: text("approval_action", {
      enum: ["pending", "selected", "skip", "create_separate"],
    })
      .notNull()
      .default("pending"),
    duplicateDecision: text("duplicate_decision", {
      enum: ["skip", "create_separate"],
    }),
    duplicateReason: text("duplicate_reason"),
    conflictDecision: text("conflict_decision", {
      enum: ["none", "reason_recorded", "administrator_review", "blocked"],
    }),
    conflictReason: text("conflict_reason"),
    targetOrganizerEventId: text("target_organizer_event_id").references(
      () => organizerEvents.id,
      { onDelete: "restrict" },
    ),
    applicationState: text("application_state", {
      enum: [
        "previewed",
        "approved",
        "applying",
        "imported",
        "skipped",
        "failed",
        "redacted",
      ],
    })
      .notNull()
      .default("previewed"),
    resultCode: text("result_code"),
    approvedByProfileId: text("approved_by_profile_id").references(
      () => profiles.id,
      { onDelete: "restrict" },
    ),
    applyActorProfileId: text("apply_actor_profile_id").references(
      () => profiles.id,
      { onDelete: "restrict" },
    ),
    approvedAt: integer("approved_at"),
    appliedAt: integer("applied_at"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("import_row_applications_idempotency_unique").on(
      table.idempotencyKey,
    ),
    index("import_row_applications_batch_state_idx").on(
      table.organizationId,
      table.importBatchId,
      table.applicationState,
      table.importRowId,
    ),
    index("import_row_applications_target_event_idx").on(
      table.organizationId,
      table.targetOrganizerEventId,
    ),
    check(
      "import_row_applications_fingerprint_check",
      sql`length(${table.normalizedRowFingerprint}) = 64
          AND ${table.normalizedRowFingerprint} =
              lower(${table.normalizedRowFingerprint})
          AND ${table.normalizedRowFingerprint} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "import_row_applications_idempotency_check",
      sql`length(${table.idempotencyKey}) = 64
          AND ${table.idempotencyKey} = lower(${table.idempotencyKey})
          AND ${table.idempotencyKey} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "import_row_applications_preview_json_check",
      sql`json_valid(${table.previewErrorCodesJson})
          AND json_type(${table.previewErrorCodesJson}) = 'array'
          AND json_valid(${table.previewWarningCodesJson})
          AND json_type(${table.previewWarningCodesJson}) = 'array'`,
    ),
    check(
      "import_row_applications_approval_check",
      sql`${table.approvalAction} IN (
        'pending', 'selected', 'skip', 'create_separate'
      )`,
    ),
    check(
      "import_row_applications_state_check",
      sql`${table.applicationState} IN (
        'previewed', 'approved', 'applying', 'imported', 'skipped',
        'failed', 'redacted'
      )`,
    ),
    check(
      "import_row_applications_approval_shape_check",
      sql`(
        ${table.approvalAction} = 'pending'
        AND ${table.approvedByProfileId} IS NULL
        AND ${table.approvedAt} IS NULL
      ) OR (
        ${table.approvalAction} <> 'pending'
        AND ${table.approvedByProfileId} IS NOT NULL
        AND ${table.approvedAt} IS NOT NULL
      )`,
    ),
    check(
      "import_row_applications_target_shape_check",
      sql`${table.targetOrganizerEventId} IS NULL
          OR ${table.applicationState} IN ('applying', 'imported', 'skipped')`,
    ),
    check(
      "import_row_applications_duplicate_reason_check",
      sql`${table.duplicateDecision} <> 'create_separate'
          OR length(trim(${table.duplicateReason})) BETWEEN 1 AND 1000`,
    ),
    check(
      "import_row_applications_conflict_reason_check",
      sql`${table.conflictDecision} <> 'reason_recorded'
          OR length(trim(${table.conflictReason})) BETWEEN 1 AND 1000`,
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
    index("meetup_event_snapshots_org_slug_generation_idx").on(
      table.organizationId,
      table.eventSlug,
      table.generationId,
      table.status,
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

/**
 * Public-safe attendee content captured beside an immutable Meetup snapshot.
 * A separate one-to-one table keeps the additive Sites migration retry-safe:
 * production can CREATE TABLE IF NOT EXISTS, while SQLite cannot retry a
 * partially applied ALTER TABLE ADD COLUMN sequence.
 */
export const meetupEventSnapshotPublicContents = sqliteTable(
  "meetup_event_snapshot_public_contents",
  {
    snapshotId: text("snapshot_id")
      .primaryKey()
      .references(() => meetupEventSnapshots.id, { onDelete: "cascade" }),
    publicSummary: text("public_summary").notNull(),
    publicDescription: text("public_description").notNull(),
    publicDescriptionBlocksJson: text(
      "public_description_blocks_json",
    ).notNull(),
    publicVenueName: text("public_venue_name"),
    publicVenueAddress: text("public_venue_address"),
    publicFloor: text("public_floor"),
    publicRoom: text("public_room"),
    capacity: integer("capacity"),
    costText: text("cost_text"),
    agePolicyText: text("age_policy_text"),
    waitlistAvailable: integer("waitlist_available", { mode: "boolean" }),
    availabilityState: text("availability_state", {
      enum: ["open", "full", "waitlist"],
    }),
    arrivalInstructions: text("arrival_instructions"),
    posterSourceUrl: text("poster_source_url"),
    posterAltText: text("poster_alt_text"),
    posterCredit: text("poster_credit"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
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

export const eventCalendarComponentRevisions = sqliteTable(
  "event_calendar_component_revisions",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: ["public", "private"] }).notNull(),
    eventKey: text("event_key").notNull(),
    canonicalFingerprint: text("canonical_fingerprint").notNull(),
    sequence: integer("sequence").notNull().default(0),
    lastModifiedAt: integer("last_modified_at").notNull(),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("event_calendar_component_revisions_identity_unique").on(
      table.organizationId,
      table.scope,
      table.eventKey,
    ),
    index("event_calendar_component_revisions_updated_idx").on(
      table.organizationId,
      table.scope,
      table.updatedAt,
    ),
    check(
      "event_calendar_component_revisions_scope_check",
      sql`${table.scope} IN ('public', 'private')`,
    ),
    check(
      "event_calendar_component_revisions_event_key_check",
      sql`length(${table.eventKey}) BETWEEN 1 AND 255
          AND ${table.eventKey} = trim(${table.eventKey})`,
    ),
    check(
      "event_calendar_component_revisions_fingerprint_check",
      sql`length(${table.canonicalFingerprint}) = 64
          AND ${table.canonicalFingerprint} =
              lower(${table.canonicalFingerprint})
          AND ${table.canonicalFingerprint} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "event_calendar_component_revisions_sequence_check",
      sql`${table.sequence} BETWEEN 0 AND 2147483647`,
    ),
    check(
      "event_calendar_component_revisions_timestamp_check",
      sql`${table.lastModifiedAt} BETWEEN 0 AND 8640000000000000
          AND ${table.createdAt} BETWEEN 0 AND 8640000000000000
          AND ${table.updatedAt} BETWEEN ${table.createdAt}
              AND 8640000000000000
          AND ${table.lastModifiedAt} >=
              ${table.createdAt} + (${table.sequence} * 1000)
          AND ${table.lastModifiedAt} >= ${table.updatedAt}
          AND ${table.lastModifiedAt} <=
              ${table.updatedAt} + (${table.sequence} * 1000)`,
    ),
  ],
);

/**
 * Durable, public-only Home and Events materializations. A protected updater
 * projects and atomically promotes the last-known-good rows; ordinary public
 * requests only read the stable, organization-scoped keys and never rebuild
 * or replace materializations on a visitor request.
 */
export const publicEventCalendarSnapshots = sqliteTable(
  "public_event_calendar_snapshots",
  {
    cacheKey: text("cache_key").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    snapshotJson: text("snapshot_json").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    index("public_event_calendar_snapshots_org_expiry_idx").on(
      table.organizationId,
      table.expiresAt,
    ),
    check(
      "public_event_calendar_snapshots_key_check",
      sql`length(${table.cacheKey}) BETWEEN 1 AND 512
          AND ${table.cacheKey} = trim(${table.cacheKey})`,
    ),
    check(
      "public_event_calendar_snapshots_json_check",
      sql`json_valid(${table.snapshotJson})
          AND json_type(${table.snapshotJson}) = 'object'
          AND length(${table.snapshotJson}) BETWEEN 2 AND 1000000`,
    ),
    check(
      "public_event_calendar_snapshots_timestamp_check",
      sql`${table.createdAt} BETWEEN 0 AND 8640000000000000
          AND ${table.updatedAt} BETWEEN ${table.createdAt}
              AND 8640000000000000
          AND ${table.expiresAt} > ${table.updatedAt}
          AND ${table.expiresAt} <= 8640000000000000`,
    ),
  ],
);

/**
 * Durable replay claims for narrowly authenticated maintenance requests.
 *
 * The public website never reads this table. A signed maintenance request
 * earns exactly one receipt before it can advance the Meetup importer, so a
 * retried or captured request cannot execute the updater twice.
 */
export const maintenanceRequestReceipts = sqliteTable(
  "maintenance_request_receipts",
  {
    requestId: text("request_id").primaryKey(),
    purpose: text("purpose", {
      enum: ["daily_meetup_refresh"],
    }).notNull(),
    issuedAt: integer("issued_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (table) => [
    index("maintenance_request_receipts_expiry_idx").on(table.expiresAt),
    check(
      "maintenance_request_receipts_request_id_check",
      sql`length(${table.requestId}) = 36
          AND ${table.requestId} = lower(${table.requestId})`,
    ),
    check(
      "maintenance_request_receipts_purpose_check",
      sql`${table.purpose} = 'daily_meetup_refresh'`,
    ),
    check(
      "maintenance_request_receipts_timestamp_check",
      sql`${table.issuedAt} BETWEEN 0 AND 8640000000000000
          AND ${table.createdAt} BETWEEN 0 AND 8640000000000000
          AND ${table.expiresAt} > ${table.createdAt}
          AND ${table.expiresAt} <= 8640000000000000`,
    ),
  ],
);
