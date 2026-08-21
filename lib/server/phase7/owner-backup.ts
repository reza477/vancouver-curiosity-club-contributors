import {
  authorizeMembership,
  type AuthorizedMembership,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  parseFiniteInteger,
  parseIdentifier,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  parseClubProfileSnapshot,
  parseCommunityLinkSnapshot,
  parseLegalStatusSnapshot,
  parsePersistedNavigationSnapshot,
  parsePageSnapshot,
  parseProgramProfileSnapshot,
  parseSiteIdentitySnapshot,
  type CmsPageBlock,
  type CmsPageSnapshot,
} from "../organizer/cms-validation";
import {
  prepareMediaManifestStatement,
  readMediaManifestEntriesResult,
  type MediaManifestEntry,
} from "./private-exports";

export const OWNER_BACKUP_SCHEMA_VERSION = "vcc-owner-backup-v1";

export const OWNER_BACKUP_SECTION_LIMITS = Object.freeze({
  organization: 1,
  memberships: 500,
  clubs: 500,
  programs: 2_000,
  lanes: 200,
  categories: 2_000,
  venues: 2_000,
  events: 10_000,
  eventOrganizers: 50_000,
  eventRevisions: 50_000,
  conflictPolicy: 100,
  pages: 500,
  pageSections: 12_000,
  cmsRevisions: 50_000,
  communityLinks: 500,
  navigation: 100,
  publicSettings: 100,
} as const);

export type OwnerBackupDownload = Readonly<{
  body: string;
  contentType: string;
  fileName: string;
}>;

const EMAIL_IN_TEXT =
  /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const PRIVATE_FEED_IN_TEXT = /https?:\/\/[^\s"]*\/calendar\/private\/[^\s"]+/giu;
const PRIVATE_MEETING_URL_IN_TEXT =
  /https?:\/\/(?:[^\s"/]+\.)?(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com)\/[^\s"]+/giu;
const CREDENTIAL_QUERY_URL_IN_TEXT =
  /https?:\/\/[^\s"]*[?&](?:auth|key|password|pwd|secret|sig|signature|token)=[^\s"&#]+[^\s"]*/giu;

export async function createOwnerJsonBackup(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  input: Readonly<{
    confirmation: unknown;
    generatedAt?: unknown;
    sourceRevision: unknown;
  }>,
): Promise<OwnerBackupDownload> {
  if (input.confirmation !== "GENERATE SENSITIVE OWNER BACKUP") {
    throw new SafeApplicationError(
      "validation_failed",
      422,
      "Confirm the sensitive Owner backup before downloading it.",
    );
  }
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner"],
  });
  const generatedAt = parseFiniteInteger(input.generatedAt ?? Date.now(), {
    path: "generatedAt",
    minimum: 0,
  });
  if (
    typeof input.sourceRevision !== "string" ||
    !/^[0-9a-f]{7,64}$/iu.test(input.sourceRevision)
  ) {
    throw new SafeApplicationError(
      "validation_failed",
      422,
      "The exact source revision could not be verified for this backup.",
    );
  }
  const sourceRevision = input.sourceRevision.toLowerCase();

  const results = await database.batch<Record<string, unknown>>([
    ...BACKUP_QUERIES.map((query) =>
      database
        .prepare(query.sql)
        .bind(actor.organizationId, query.maximum + 1),
    ),
    prepareMediaManifestStatement(database, actor.organizationId),
  ]);
  if (
    results.length !== BACKUP_QUERIES.length + 1 ||
    results.some((result) => result.success === false)
  ) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The Owner backup could not be read safely.",
    );
  }

  const rows = results
    .slice(0, BACKUP_QUERIES.length)
    .map((result, index) => {
      const sectionRows = readRows(result);
      const query = BACKUP_QUERIES[index];
      if (!query || sectionRows.length > query.maximum) {
        throw new SafeApplicationError(
          "validation_failed",
          422,
          "The Owner backup is too large for one bounded download.",
        );
      }
      return sectionRows;
    });
  const organizationRow = rows[0]?.[0];
  if (!organizationRow) {
    throw new SafeApplicationError(
      "authorization_denied",
      403,
      "The organization is no longer available.",
    );
  }
  const members = rows[1] ?? [];
  const memberReferenceByProfile = new Map<string, string>();
  const memberships = members.map((row, index) => {
    const profileId = identifier(row.profile_id, "membership.profileId");
    const reference = `member-${index + 1}`;
    memberReferenceByProfile.set(profileId, reference);
    return Object.freeze({
      reference,
      role: text(row.role),
      status: text(row.status),
      createdAt: integer(row.created_at),
      updatedAt: integer(row.updated_at),
      deletedAt: nullableInteger(row.deleted_at),
    });
  });
  const memberReference = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    return memberReferenceByProfile.get(value) ?? null;
  };

  const mediaManifestResult = results[BACKUP_QUERIES.length];
  if (!mediaManifestResult) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The Owner backup could not be read safely.",
    );
  }
  const mediaManifest = readMediaManifestEntriesResult(
    mediaManifestResult,
  );
  const sections = Object.freeze({
    memberships,
    clubs: mapRows(rows[2], (row) => ({
      id: identifier(row.id, "club.id"),
      name: safeText(row.name),
      slug: text(row.slug),
      description: nullableSafeText(row.description),
      createdAt: integer(row.created_at),
      updatedAt: integer(row.updated_at),
      deletedAt: nullableInteger(row.deleted_at),
    })),
    programs: mapRows(rows[3], (row) => ({
      id: identifier(row.id, "program.id"),
      clubId: nullableIdentifier(row.club_id),
      name: safeText(row.name),
      slug: text(row.slug),
      description: nullableSafeText(row.description),
      createdAt: integer(row.created_at),
      updatedAt: integer(row.updated_at),
      deletedAt: nullableInteger(row.deleted_at),
    })),
    lanes: mapRows(rows[4], (row) => ({
      id: identifier(row.id, "lane.id"),
      name: safeText(row.name),
      slug: text(row.slug),
      description: nullableSafeText(row.description),
      sortOrder: integer(row.sort_order),
      createdAt: integer(row.created_at),
      updatedAt: integer(row.updated_at),
      deletedAt: nullableInteger(row.deleted_at),
    })),
    categories: mapRows(rows[5], (row) => ({
      id: identifier(row.id, "category.id"),
      name: safeText(row.name),
      slug: text(row.slug),
      description: nullableSafeText(row.description),
      colorToken: nullableText(row.color_token),
      sortOrder: integer(row.sort_order),
      createdAt: integer(row.created_at),
      updatedAt: integer(row.updated_at),
      deletedAt: nullableInteger(row.deleted_at),
    })),
    venues: mapRows(rows[6], (row) => ({
      id: identifier(row.id, "venue.id"),
      name: safeText(row.name),
      slug: text(row.slug),
      timezone: text(row.timezone),
      publicLocationName: nullableSafeText(row.public_location_name),
      publicAddress: nullableSafeText(row.public_address),
      privateAddress: nullableSafeText(row.private_address),
      privateDirections: nullableSafeText(row.private_directions),
      accessibilityNotes: nullableSafeText(row.accessibility_notes),
      isPublic: Boolean(row.is_public),
      createdAt: integer(row.created_at),
      updatedAt: integer(row.updated_at),
      deletedAt: nullableInteger(row.deleted_at),
    })),
    events: mapRows(rows[7], (row) => ({
      id: identifier(row.id, "event.id"),
      clubId: identifier(row.club_id, "event.clubId"),
      programId: nullableIdentifier(row.program_id),
      laneId: nullableIdentifier(row.event_lane_id),
      categoryId: nullableIdentifier(row.category_id),
      venueId: nullableIdentifier(row.venue_id),
      primaryOrganizer: memberReference(row.primary_organizer_profile_id),
      title: safeText(row.title),
      slug: text(row.slug),
      summary: nullableSafeText(row.summary),
      description: nullableSafeText(row.description),
      privateNotes: nullablePrivatePlanningText(row.private_notes),
      meetupEventUrl: nullableSafeText(row.meetup_event_url),
      planningStatus: text(row.planning_status),
      publicationStatus: text(row.publication_status),
      scheduleShape: text(row.schedule_shape),
      startsAtUtc: nullableInteger(row.starts_at_utc),
      endsAtUtc: nullableInteger(row.ends_at_utc),
      timezone: text(row.timezone),
      allDayStartDate: nullableText(row.all_day_start_date),
      allDayEndDateExclusive: nullableText(row.all_day_end_date_exclusive),
      bufferBeforeMinutes: integer(row.buffer_before_minutes),
      bufferAfterMinutes: integer(row.buffer_after_minutes),
      contentVersion: integer(row.content_version),
      scheduleVersion: integer(row.schedule_version),
      createdBy: memberReference(row.created_by_profile_id),
      updatedBy: memberReference(row.updated_by_profile_id),
      createdAt: integer(row.created_at),
      updatedAt: integer(row.updated_at),
      deletedAt: nullableInteger(row.deleted_at),
    })),
    eventOrganizers: mapRows(rows[8], (row) => ({
      eventId: identifier(row.organizer_event_id, "eventOrganizer.eventId"),
      member: memberReference(row.profile_id),
      createdAt: integer(row.created_at),
      deletedAt: nullableInteger(row.deleted_at),
    })).filter((row) => row.member !== null),
    eventRevisions: mapRows(rows[9], (row) => ({
      id: identifier(row.id, "eventRevision.id"),
      eventId: identifier(row.organizer_event_id, "eventRevision.eventId"),
      action: text(row.action),
      contentVersion: integer(row.content_version),
      scheduleVersion: integer(row.schedule_version),
      snapshot: sanitizeOrganizerEventRevisionSnapshot(
        row.snapshot_json,
        memberReference,
      ),
      actor: memberReference(row.actor_profile_id),
      createdAt: integer(row.created_at),
    })),
    conflictPolicy: mapRows(rows[10], (row) => ({
      policyVersion: integer(row.policy_version),
      mode: text(row.mode),
      configuredAt: integer(row.updated_at),
      defaultHoldHours: integer(row.default_hold_hours),
      nearingExpiryHours: integer(row.nearing_expiry_hours),
    })),
    pages: mapRows(rows[11], (row) => ({
      id: identifier(row.id, "page.id"),
      title: safeText(row.title),
      slug: text(row.slug),
      status: text(row.status),
      visibility: text(row.visibility),
      currentRevision: integer(row.current_revision),
      publishedAt: nullableInteger(row.published_at),
      createdAt: integer(row.created_at),
      updatedAt: integer(row.updated_at),
      deletedAt: nullableInteger(row.deleted_at),
    })),
    pageSections: mapRows(rows[12], (row) => ({
      id: identifier(row.id, "pageSection.id"),
      pageId: identifier(row.page_id, "pageSection.pageId"),
      sectionKey: text(row.section_key),
      sectionType: text(row.section_type),
      content: sanitizePageSectionContent(
        row.content_json,
        row.section_type,
      ),
      sortOrder: integer(row.sort_order),
      createdAt: integer(row.created_at),
      updatedAt: integer(row.updated_at),
      deletedAt: nullableInteger(row.deleted_at),
    })),
    cmsRevisions: mapRows(rows[13], (row) => ({
      id: identifier(row.id, "cmsRevision.id"),
      entityType: text(row.entity_type),
      entityKey: text(row.entity_key),
      revisionNumber: integer(row.revision_number),
      snapshot: sanitizeCmsRevisionSnapshot(
        row.snapshot_json,
        row.entity_type,
      ),
      contentHash: text(row.content_hash),
      restoredFromRevisionId: nullableIdentifier(row.restored_from_revision_id),
      actor: memberReference(row.actor_profile_id),
      createdAt: integer(row.created_at),
    })),
    communityLinks: mapRows(rows[14], (row) => ({
      id: identifier(row.id, "communityLink.id"),
      label: safeText(row.label),
      url: safeBackupPublicUrl(row.url),
      linkType: text(row.link_type),
      isPublished: Boolean(row.is_published),
      sortOrder: integer(row.sort_order),
      createdAt: integer(row.created_at),
      updatedAt: integer(row.updated_at),
      deletedAt: nullableInteger(row.deleted_at),
    })),
    navigation: mapRows(rows[15], (row) => ({
      id: identifier(row.id, "navigation.id"),
      label: safeText(row.label),
      placement: text(row.placement),
      pageId: nullableIdentifier(row.page_id),
      externalUrl: safeBackupPublicUrl(row.external_url),
      sortOrder: integer(row.sort_order),
      isPublished: Boolean(row.is_published),
      createdAt: integer(row.created_at),
      updatedAt: integer(row.updated_at),
      deletedAt: nullableInteger(row.deleted_at),
    })),
    publicSettings: mapRows(rows[16], (row) => ({
      key: text(row.key),
      value: sanitizePublicSiteSettingValue(
        row.key,
        row.value_json,
      ),
      createdAt: integer(row.created_at),
      updatedAt: integer(row.updated_at),
    })).filter((row) => row.value !== null),
    media: sanitizeMediaManifestForBackup(mediaManifest),
  });

  const counts = Object.freeze(
    Object.fromEntries(
      Object.entries(sections).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.length : 0,
      ]),
    ),
  );
  const backup = Object.freeze({
    schemaVersion: OWNER_BACKUP_SCHEMA_VERSION,
    applicationRevision: "phase7-export-contract-v1",
    sourceRevision,
    generatedAt: new Date(generatedAt).toISOString(),
    organization: Object.freeze({
      name: safeText(organizationRow.name),
      slug: text(organizationRow.slug),
      timezone: text(organizationRow.timezone),
      createdAt: integer(organizationRow.created_at),
      updatedAt: integer(organizationRow.updated_at),
    }),
    counts,
    includedSections: Object.keys(sections),
    excludedSections: [
      "identity_headers_and_provider_identifiers",
      "email_addresses",
      "invitations_sessions_and_tokens",
      "private_calendar_tokens_and_hashes",
      "meetup_source_feed_addresses_and_tokens",
      "public_form_protection_keys_and_rate_fingerprints",
      "form_submissions_and_form_notes",
      "raw_import_source_payloads",
      "notifications_and_generic_audit_payloads",
      "runtime_values_credentials_and_r2_object_keys",
    ],
    restore: Object.freeze({
      automatic: false,
      limitation:
        "This export is an allowlisted product-data backup, not a complete infrastructure backup. Restore requires a reviewed nonproduction rehearsal.",
    }),
    sections,
  });
  await writeBackupAudit(database, actor, generatedAt, counts);
  return Object.freeze({
    body: `${JSON.stringify(backup, null, 2)}\n`,
    contentType: "application/json; charset=utf-8",
    fileName: "vcc-owner-backup.json",
  });
}

const BACKUP_QUERIES = Object.freeze([
  backupQuery(
    "organization",
    OWNER_BACKUP_SECTION_LIMITS.organization,
    `SELECT name, slug, timezone, created_at, updated_at
     FROM organizations
     WHERE id = ? AND deleted_at IS NULL
     LIMIT ?`,
  ),
  backupQuery(
    "memberships",
    OWNER_BACKUP_SECTION_LIMITS.memberships,
    `SELECT profile_id, role, status, created_at, updated_at, deleted_at
     FROM organization_memberships
     WHERE organization_id = ?
     ORDER BY created_at, id
     LIMIT ?`,
  ),
  backupQuery(
    "clubs",
    OWNER_BACKUP_SECTION_LIMITS.clubs,
    `SELECT id, name, slug, description, created_at, updated_at, deleted_at
     FROM clubs WHERE organization_id = ?
     ORDER BY created_at, id
     LIMIT ?`,
  ),
  backupQuery(
    "programs",
    OWNER_BACKUP_SECTION_LIMITS.programs,
    `SELECT id, club_id, name, slug, description, created_at, updated_at,
            deleted_at
     FROM programs WHERE organization_id = ?
     ORDER BY created_at, id
     LIMIT ?`,
  ),
  backupQuery(
    "lanes",
    OWNER_BACKUP_SECTION_LIMITS.lanes,
    `SELECT id, name, slug, description, sort_order, created_at, updated_at,
            deleted_at
     FROM event_lanes WHERE organization_id = ?
     ORDER BY sort_order, id
     LIMIT ?`,
  ),
  backupQuery(
    "categories",
    OWNER_BACKUP_SECTION_LIMITS.categories,
    `SELECT category.id, category.name, category.slug, category.description,
            category.color_token, COALESCE(state.sort_order, 0) AS sort_order,
            category.created_at, category.updated_at, category.deleted_at
     FROM categories AS category
     LEFT JOIN category_taxonomy_states AS state
       ON state.category_id = category.id
      AND state.organization_id = category.organization_id
     WHERE category.organization_id = ?
     ORDER BY COALESCE(state.sort_order, 0), category.id
     LIMIT ?`,
  ),
  backupQuery(
    "venues",
    OWNER_BACKUP_SECTION_LIMITS.venues,
    `SELECT id, name, slug, timezone, public_location_name, public_address,
            private_address, private_directions, accessibility_notes, is_public,
            created_at, updated_at, deleted_at
     FROM venues WHERE organization_id = ?
     ORDER BY created_at, id
     LIMIT ?`,
  ),
  backupQuery(
    "events",
    OWNER_BACKUP_SECTION_LIMITS.events,
    `SELECT id, club_id, program_id, event_lane_id, category_id, venue_id,
            primary_organizer_profile_id, title, slug, summary, description,
            private_notes, meetup_event_url, planning_status,
            publication_status, schedule_shape, starts_at_utc, ends_at_utc,
            timezone, all_day_start_date, all_day_end_date_exclusive,
            buffer_before_minutes, buffer_after_minutes,
            content_version, schedule_version, created_by_profile_id,
            updated_by_profile_id, created_at, updated_at, deleted_at
     FROM organizer_events WHERE organization_id = ?
     ORDER BY created_at, id
     LIMIT ?`,
  ),
  backupQuery(
    "eventOrganizers",
    OWNER_BACKUP_SECTION_LIMITS.eventOrganizers,
    `SELECT organizer_event_id, profile_id, created_at, deleted_at
     FROM organizer_event_organizers
     WHERE organization_id = ?
     ORDER BY organizer_event_id, created_at, id
     LIMIT ?`,
  ),
  backupQuery(
    "eventRevisions",
    OWNER_BACKUP_SECTION_LIMITS.eventRevisions,
    `SELECT id, organizer_event_id, action, content_version,
            schedule_version, snapshot_json, actor_profile_id, created_at
     FROM organizer_event_revisions
     WHERE organization_id = ?
     ORDER BY created_at, id
     LIMIT ?`,
  ),
  backupQuery(
    "conflictPolicy",
    OWNER_BACKUP_SECTION_LIMITS.conflictPolicy,
    `SELECT policy_version, mode, default_hold_hours, nearing_expiry_hours,
            updated_at
     FROM organizer_conflict_policies
     WHERE organization_id = ?
     ORDER BY policy_version
     LIMIT ?`,
  ),
  backupQuery(
    "pages",
    OWNER_BACKUP_SECTION_LIMITS.pages,
    `SELECT id, title, slug, status, visibility, current_revision, published_at,
            created_at, updated_at, deleted_at
     FROM pages WHERE organization_id = ?
     ORDER BY created_at, id
     LIMIT ?`,
  ),
  backupQuery(
    "pageSections",
    OWNER_BACKUP_SECTION_LIMITS.pageSections,
    `SELECT id, page_id, section_key, section_type, content_json, sort_order,
            created_at, updated_at, deleted_at
     FROM page_sections WHERE organization_id = ?
     ORDER BY page_id, sort_order, id
     LIMIT ?`,
  ),
  backupQuery(
    "cmsRevisions",
    OWNER_BACKUP_SECTION_LIMITS.cmsRevisions,
    `SELECT id, entity_type, entity_key, revision_number, snapshot_json,
            content_hash, restored_from_revision_id, actor_profile_id, created_at
     FROM cms_entity_revisions
     WHERE organization_id = ?
     ORDER BY entity_type, entity_key, revision_number
     LIMIT ?`,
  ),
  backupQuery(
    "communityLinks",
    OWNER_BACKUP_SECTION_LIMITS.communityLinks,
    `SELECT id, label, url, link_type, is_published, sort_order,
            created_at, updated_at, deleted_at
     FROM community_links WHERE organization_id = ?
     ORDER BY sort_order, id
     LIMIT ?`,
  ),
  backupQuery(
    "navigation",
    OWNER_BACKUP_SECTION_LIMITS.navigation,
    `SELECT id, label, placement, page_id, external_url, sort_order,
            is_published, created_at, updated_at, deleted_at
     FROM navigation_items WHERE organization_id = ?
     ORDER BY placement, sort_order, id
     LIMIT ?`,
  ),
  backupQuery(
    "publicSettings",
    OWNER_BACKUP_SECTION_LIMITS.publicSettings,
    `SELECT key, value_json, created_at, updated_at
     FROM site_settings
     WHERE organization_id = ? AND is_public = 1
     ORDER BY key
     LIMIT ?`,
  ),
]);

function backupQuery(
  section: keyof typeof OWNER_BACKUP_SECTION_LIMITS,
  maximum: number,
  sql: string,
) {
  return Object.freeze({ maximum, section, sql });
}

async function writeBackupAudit(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  generatedAt: number,
  counts: Readonly<Record<string, number>>,
): Promise<void> {
  const result = await database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action,
         entity_type, entity_id, metadata_json, created_at
       )
       SELECT ?, membership.organization_id, membership.profile_id,
              'owner_backup.generated', 'data_export', ?, ?, ?
       FROM organization_memberships AS membership
       JOIN profiles AS profile ON profile.id = membership.profile_id
       WHERE membership.id = ?
         AND membership.organization_id = ?
         AND membership.profile_id = ?
         AND membership.role = 'owner'
         AND membership.status = 'active'
         AND membership.deleted_at IS NULL
         AND profile.status = 'active'
         AND profile.deleted_at IS NULL`,
    )
    .bind(
      `audit:${crypto.randomUUID()}`,
      `owner-backup:${generatedAt}`,
      JSON.stringify({
        exportType: "owner_json_backup",
        rowCounts: counts,
        schemaVersion: OWNER_BACKUP_SCHEMA_VERSION,
      }),
      generatedAt,
      actor.membershipId,
      actor.organizationId,
      actor.profileId,
    )
    .run();
  if (changes(result) !== 1) {
    throw new SafeApplicationError(
      "authorization_denied",
      403,
      "Your current Owner access could not be revalidated.",
    );
  }
}

function readRows(
  result: Readonly<{
    results?: readonly Record<string, unknown>[];
  }>,
): readonly Record<string, unknown>[] {
  return result.results ?? [];
}

function mapRows<T>(
  rows: readonly Record<string, unknown>[] | undefined,
  mapper: (row: Record<string, unknown>) => T,
): readonly T[] {
  return Object.freeze((rows ?? []).map(mapper));
}

function sanitizePageSectionContent(
  value: unknown,
  sectionTypeValue: unknown,
): Readonly<Record<string, unknown>> {
  const input = parseBackupJsonRecord(value, 32_768);
  const sectionType = text(sectionTypeValue).replaceAll("-", "_");
  if (!input) return unavailableBackupJson();
  if (
    sectionType === "hero" ||
    sectionType === "intro" ||
    sectionType === "prose" ||
    sectionType === "callout"
  ) {
    return freezeDefined({
      eyebrow: safeOptionalText(input.eyebrow),
      heading: safeOptionalText(input.heading),
      text: safeOptionalText(input.text),
      paragraphs: safeBackupTextArray(input.paragraphs, 12),
    });
  }
  if (
    sectionType === "ordered_link_list" ||
    sectionType === "resource_list" ||
    sectionType === "community_links"
  ) {
    return freezeDefined({
      heading: safeOptionalText(input.heading),
      items: safeBackupLinkArray(
        Array.isArray(input.items) ? input.items : input.links,
        sectionType === "resource_list" ? 40 : 24,
      ),
    });
  }
  if (sectionType === "media") {
    return freezeDefined({
      assetId: safeBackupIdentifier(input.assetId),
      altText: safeOptionalText(input.altText),
      caption: safeOptionalText(input.caption),
      heading: safeOptionalText(input.heading),
    });
  }
  if (
    sectionType === "featured_events" ||
    sectionType === "featured_clubs"
  ) {
    const rawIds =
      input.ids ??
      (sectionType === "featured_events"
        ? input.eventSlugs ?? input.slugs
        : input.clubSlugs);
    return freezeDefined({
      heading: safeOptionalText(input.heading),
      ids: safeBackupIdentifierArray(rawIds, 24),
      limit: boundedOptionalInteger(input.limit, 1, 12),
    });
  }
  return unavailableBackupJson();
}

function sanitizeCmsRevisionSnapshot(
  value: unknown,
  entityTypeValue: unknown,
): Readonly<Record<string, unknown>> {
  const parsed = parseBackupJsonRecord(value, 131_072);
  if (!parsed) return unavailableBackupJson();
  try {
    switch (text(entityTypeValue)) {
      case "page":
        return sanitizeCmsPageSnapshot(parsePageSnapshot(parsed));
      case "club_public_profile":
        return sanitizeCmsClubSnapshot(
          parseClubProfileSnapshot(parsed),
        );
      case "program_public_profile":
        return sanitizeCmsProgramSnapshot(
          parseProgramProfileSnapshot(parsed),
        );
      case "community_link":
        return sanitizeCmsCommunitySnapshot(
          parseCommunityLinkSnapshot(parsed),
        );
      case "navigation":
        return sanitizeCmsNavigationSnapshot(
          parsePersistedNavigationSnapshot(parsed),
        );
      case "site_identity":
        return sanitizeCmsSiteIdentitySnapshot(
          parseSiteIdentitySnapshot(parsed),
        );
      case "legal_status":
        return sanitizeCmsLegalStatusSnapshot(
          parseLegalStatusSnapshot(parsed),
        );
      default:
        return unavailableBackupJson();
    }
  } catch {
    return unavailableBackupJson();
  }
}

function sanitizePublicSiteSettingValue(
  keyValue: unknown,
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  if (text(keyValue) !== "public_identity") return null;
  const parsed = parseBackupJsonRecord(value, 131_072);
  if (!parsed) return null;
  try {
    return sanitizeCmsSiteIdentitySnapshot(
      parseSiteIdentitySnapshot(parsed),
    );
  } catch {
    return null;
  }
}

function sanitizeCmsPageSnapshot(
  snapshot: CmsPageSnapshot,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    title: safeText(snapshot.title),
    slug: snapshot.slug,
    seoTitle: safeText(snapshot.seoTitle),
    metaDescription: safeText(snapshot.metaDescription),
    openGraphAssetId: snapshot.openGraphAssetId,
    blocks: Object.freeze(
      snapshot.blocks.map((block) =>
        Object.freeze({
          id: block.id,
          type: block.type,
          config: sanitizeCmsPageBlockConfig(block),
        }),
      ),
    ),
  });
}

function sanitizeCmsPageBlockConfig(
  block: CmsPageBlock,
): Readonly<Record<string, unknown>> {
  const config = block.config;
  if (
    block.type === "hero" ||
    block.type === "intro" ||
    block.type === "prose" ||
    block.type === "callout"
  ) {
    return freezeDefined({
      eyebrow: safeOptionalText(config.eyebrow),
      heading: safeOptionalText(config.heading),
      text: safeOptionalText(config.text),
      paragraphs: safeBackupTextArray(config.paragraphs, 12),
    });
  }
  if (
    block.type === "ordered_link_list" ||
    block.type === "resource_list"
  ) {
    return freezeDefined({
      heading: safeOptionalText(config.heading),
      items: safeBackupLinkArray(
        config.items,
        block.type === "resource_list" ? 40 : 24,
      ),
    });
  }
  if (block.type === "media") {
    return freezeDefined({
      assetId: safeBackupIdentifier(config.assetId),
      caption: safeOptionalText(config.caption),
      heading: safeOptionalText(config.heading),
    });
  }
  return freezeDefined({
    heading: safeOptionalText(config.heading),
    ids: safeBackupIdentifierArray(config.ids, 24),
    limit: boundedOptionalInteger(config.limit, 1, 12),
  });
}

function sanitizeCmsCommunitySnapshot(
  snapshot: ReturnType<typeof parseCommunityLinkSnapshot>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    confirmed: snapshot.confirmed,
    description: safeText(snapshot.description),
    destinationType: snapshot.destinationType,
    label: safeText(snapshot.label),
    sortOrder: snapshot.sortOrder,
    url: safeBackupPublicUrl(snapshot.url),
  });
}

function sanitizeCmsNavigationSnapshot(
  snapshot: ReturnType<typeof parsePersistedNavigationSnapshot>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    items: Object.freeze(
      snapshot.items.map((item) =>
        Object.freeze({
          id: item.id,
          label: safeText(item.label),
          placement: item.placement,
          sortOrder: item.sortOrder,
          target: safeBackupPublicUrl(item.target),
        }),
      ),
    ),
  });
}

function sanitizeCmsSiteIdentitySnapshot(
  snapshot: ReturnType<typeof parseSiteIdentitySnapshot>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    brandName: safeText(snapshot.brandName),
    footerMission: safeText(snapshot.footerMission),
    institutionalFacts: Object.freeze({
      attendanceTotal: snapshot.institutionalFacts.attendanceTotal,
      attendanceTotalAsOf: snapshot.institutionalFacts.attendanceTotalAsOf,
      attendanceTotalConfirmed:
        snapshot.institutionalFacts.attendanceTotalConfirmed,
      foundedYear: snapshot.institutionalFacts.foundedYear,
      foundedYearConfirmed:
        snapshot.institutionalFacts.foundedYearConfirmed,
      memberTotal: snapshot.institutionalFacts.memberTotal,
      memberTotalAsOf: snapshot.institutionalFacts.memberTotalAsOf,
      memberTotalConfirmed:
        snapshot.institutionalFacts.memberTotalConfirmed,
    }),
    locationLabel: safeText(snapshot.locationLabel),
    logoAssetId: snapshot.logoAssetId,
    metaDescription: safeText(snapshot.metaDescription),
    mission: safeText(snapshot.mission),
    openGraphAssetId: snapshot.openGraphAssetId,
    palette: Object.freeze({
      accent: snapshot.palette.accent,
      background: snapshot.palette.background,
      foreground: snapshot.palette.foreground,
      secondary: snapshot.palette.secondary,
    }),
    seoTitle: safeText(snapshot.seoTitle),
    tagline: safeText(snapshot.tagline),
    typography: snapshot.typography,
  });
}

function sanitizeCmsLegalStatusSnapshot(
  snapshot: ReturnType<typeof parseLegalStatusSnapshot>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    charityNumber: nullableSafeText(snapshot.charityNumber),
    charityStatus: snapshot.charityStatus,
    effectiveDate: snapshot.effectiveDate,
    footerWording: nullableSafeText(snapshot.footerWording),
    jurisdiction: nullableSafeText(snapshot.jurisdiction),
    legalFormWording: nullableSafeText(snapshot.legalFormWording),
    legalName: nullableSafeText(snapshot.legalName),
    registrationNumber: nullableSafeText(snapshot.registrationNumber),
  });
}

function sanitizeCmsClubSnapshot(
  snapshot: ReturnType<typeof parseClubProfileSnapshot>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    contentConfirmed: snapshot.contentConfirmed,
    coverAssetId: snapshot.coverAssetId,
    description: safeText(snapshot.description),
    displayOrder: snapshot.displayOrder,
    featured: snapshot.featured,
    imageAltText: nullableSafeText(snapshot.imageAltText),
    laneId: snapshot.laneId,
    meetupGroupUrl: safeBackupPublicUrl(snapshot.meetupGroupUrl),
    metaDescription: safeText(snapshot.metaDescription),
    name: safeText(snapshot.name),
    openGraphAssetId: snapshot.openGraphAssetId,
    preparation: nullableSafeText(snapshot.preparation),
    programType: snapshot.programType,
    relatedResourceIds: Object.freeze([...snapshot.relatedResourceIds]),
    seoTitle: safeText(snapshot.seoTitle),
    slug: snapshot.slug,
    socialUrls: Object.freeze(
      snapshot.socialUrls.flatMap((url) => {
        const safe = safeBackupPublicUrl(url);
        return safe ? [safe] : [];
      }),
    ),
    summary: safeText(snapshot.summary),
    themeColor: snapshot.themeColor,
    thumbnailAssetId: snapshot.thumbnailAssetId,
    typicalFormat: nullableSafeText(snapshot.typicalFormat),
    whatToExpect: nullableSafeText(snapshot.whatToExpect),
  });
}

function sanitizeCmsProgramSnapshot(
  snapshot: ReturnType<typeof parseProgramProfileSnapshot>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    clubId: snapshot.clubId,
    contentConfirmed: snapshot.contentConfirmed,
    coverAssetId: snapshot.coverAssetId,
    description: safeText(snapshot.description),
    displayOrder: snapshot.displayOrder,
    featured: snapshot.featured,
    laneId: snapshot.laneId,
    meetupGroupUrl: safeBackupPublicUrl(snapshot.meetupGroupUrl),
    metaDescription: safeText(snapshot.metaDescription),
    name: safeText(snapshot.name),
    openGraphAssetId: snapshot.openGraphAssetId,
    preparation: nullableSafeText(snapshot.preparation),
    programType: snapshot.programType,
    relatedResourceIds: Object.freeze([...snapshot.relatedResourceIds]),
    seoTitle: safeText(snapshot.seoTitle),
    slug: snapshot.slug,
    socialUrls: Object.freeze(
      snapshot.socialUrls.flatMap((url) => {
        const safe = safeBackupPublicUrl(url);
        return safe ? [safe] : [];
      }),
    ),
    summary: safeText(snapshot.summary),
    themeColor: snapshot.themeColor,
    thumbnailAssetId: snapshot.thumbnailAssetId,
    typicalFormat: nullableSafeText(snapshot.typicalFormat),
    whatToExpect: nullableSafeText(snapshot.whatToExpect),
  });
}

function sanitizeMediaManifestForBackup(
  entries: readonly MediaManifestEntry[],
): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze(
    entries.map((entry) =>
      Object.freeze({
        id: entry.id,
        fileName: safeText(entry.fileName),
        mimeType: entry.mimeType,
        byteSize: entry.byteSize,
        width: entry.width,
        height: entry.height,
        sha256: entry.sha256,
        publicClassification: entry.publicClassification,
        altText: nullableSafeText(entry.altText),
        caption: nullableSafeText(entry.caption),
        credit: nullableSafeText(entry.credit),
        informative: entry.informative,
        rightsStatus: entry.rightsStatus,
        rightsSourceNote: nullableSafeText(entry.rightsSourceNote),
        consentStatus: entry.consentStatus,
        participantConsentNote: nullableSafeText(
          entry.participantConsentNote,
        ),
        usages: Object.freeze(
          entry.usages.map((usage) =>
            Object.freeze({
              entityId: usage.entityId,
              entityType: usage.entityType,
              publicationScope: usage.publicationScope,
              revisionId: usage.revisionId,
              usageKind: usage.usageKind,
            }),
          ),
        ),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }),
    ),
  );
}

function parseBackupJsonRecord(
  value: unknown,
  maximumBytes: number,
): Record<string, unknown> | null {
  if (
    typeof value !== "string" ||
    new TextEncoder().encode(value).byteLength > maximumBytes
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function unavailableBackupJson(): Readonly<Record<string, unknown>> {
  return Object.freeze({ unavailable: true });
}

function freezeDefined(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).filter(
        ([, nested]) => nested !== null && nested !== undefined,
      ),
    ),
  );
}

function safeBackupTextArray(
  value: unknown,
  maximum: number,
): readonly string[] {
  return Object.freeze(
    (Array.isArray(value) ? value : [])
      .slice(0, maximum)
      .flatMap((entry) =>
        typeof entry === "string" ? [safeText(entry)] : [],
      ),
  );
}

function safeBackupIdentifierArray(
  value: unknown,
  maximum: number,
): readonly string[] {
  return Object.freeze(
    (Array.isArray(value) ? value : [])
      .slice(0, maximum)
      .flatMap((entry) => {
        const parsed = safeBackupIdentifier(entry);
        return parsed ? [parsed] : [];
      }),
  );
}

function safeBackupLinkArray(
  value: unknown,
  maximum: number,
): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze(
    (Array.isArray(value) ? value : [])
      .slice(0, maximum)
      .flatMap((entry) => {
        if (
          typeof entry !== "object" ||
          entry === null ||
          Array.isArray(entry)
        ) {
          return [];
        }
        const record = entry as Record<string, unknown>;
        const label = safeOptionalText(record.label);
        const url = safeBackupPublicUrl(record.url);
        if (!label || !url) return [];
        return [
          freezeDefined({
            label,
            url,
            description: safeOptionalText(record.description),
          }),
        ];
      }),
  );
}

function safeBackupPublicUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  if (value.startsWith("/") && !value.startsWith("//")) {
    if (/[\u0000-\u001F\u007F\\]/u.test(value)) return null;
    try {
      const url = new URL(value, "https://backup.invalid");
      return url.pathname;
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      host.length === 0 ||
      host === "zoom.us" ||
      host.endsWith(".zoom.us") ||
      host === "meet.google.com" ||
      host === "teams.microsoft.com" ||
      url.pathname.toLowerCase().includes("/calendar/private/")
    ) {
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function boundedOptionalInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

function sanitizeOrganizerEventRevisionSnapshot(
  value: unknown,
  memberReference: (value: unknown) => string | null,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "string" || value.length > 131_072) {
    return Object.freeze({ unavailable: true });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return Object.freeze({ unavailable: true });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return Object.freeze({ unavailable: true });
  }
  const snapshot = parsed as Record<string, unknown>;
  const coOrganizers = Array.isArray(snapshot.coOrganizerProfileIds)
    ? snapshot.coOrganizerProfileIds
        .map(memberReference)
        .filter((reference): reference is string => reference !== null)
    : [];
  return Object.freeze({
    id: safeBackupIdentifier(snapshot.id),
    clubId: safeBackupIdentifier(snapshot.clubId),
    programId: safeBackupIdentifier(snapshot.programId),
    eventLaneId: safeBackupIdentifier(snapshot.eventLaneId),
    categoryId: safeBackupIdentifier(snapshot.categoryId),
    venueId: safeBackupIdentifier(snapshot.venueId),
    primaryOrganizer: memberReference(
      snapshot.primaryOrganizerProfileId,
    ),
    coOrganizers: Object.freeze(coOrganizers),
    title: safeOptionalText(snapshot.title),
    slug: safeOptionalText(snapshot.slug),
    summary: safeOptionalText(snapshot.summary),
    description: safeOptionalText(snapshot.description),
    privateNotes: safeOptionalText(snapshot.privateNotes),
    meetupEventUrl: safeMeetupEventUrl(snapshot.meetupEventUrl),
    planningStatus: safeOptionalText(snapshot.planningStatus),
    publicationStatus: safeOptionalText(snapshot.publicationStatus),
    schedule: sanitizeEventRevisionSchedule(snapshot.schedule),
    bufferBeforeMinutes: safeOptionalInteger(
      snapshot.bufferBeforeMinutes,
    ),
    bufferAfterMinutes: safeOptionalInteger(
      snapshot.bufferAfterMinutes,
    ),
    contentVersion: safeOptionalInteger(snapshot.contentVersion),
    scheduleVersion: safeOptionalInteger(snapshot.scheduleVersion),
    createdBy: memberReference(snapshot.createdByProfileId),
    updatedBy: memberReference(snapshot.updatedByProfileId),
    createdAt: safeOptionalInteger(snapshot.createdAt),
    updatedAt: safeOptionalInteger(snapshot.updatedAt),
    deletedAt: safeOptionalInteger(snapshot.deletedAt),
  });
}

function sanitizeEventRevisionSchedule(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }
  const schedule = value as Record<string, unknown>;
  return Object.freeze({
    shape: safeOptionalText(schedule.shape),
    startsAtUtc: safeOptionalInteger(schedule.startsAtUtc),
    endsAtUtc: safeOptionalInteger(schedule.endsAtUtc),
    timeZone: safeOptionalText(
      schedule.timeZone ?? schedule.timezone,
    ),
    allDayStartDate: safeOptionalText(schedule.allDayStartDate),
    allDayEndDateExclusive: safeOptionalText(
      schedule.allDayEndDateExclusive,
    ),
  });
}

function safeBackupIdentifier(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return parseIdentifier(value, "backup.eventRevision.identifier");
  } catch {
    return null;
  }
}

function safeOptionalInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function safeOptionalText(value: unknown): string | null {
  return typeof value === "string" ? safeText(value) : null;
}

function safeMeetupEventUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      (host !== "meetup.com" && !host.endsWith(".meetup.com")) ||
      !/^\/[a-z0-9_-]+\/events\/[0-9]+\/?$/iu.test(url.pathname)
    ) {
      return null;
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function safeText(value: unknown): string {
  return text(value)
    .replace(EMAIL_IN_TEXT, "[redacted-email]")
    .replace(PRIVATE_FEED_IN_TEXT, "[redacted-private-feed]")
    .replace(PRIVATE_MEETING_URL_IN_TEXT, "[redacted-meeting-url]")
    .replace(CREDENTIAL_QUERY_URL_IN_TEXT, "[redacted-credential-url]");
}

function nullableSafeText(value: unknown): string | null {
  return value === null || value === undefined ? null : safeText(value);
}

function nullablePrivatePlanningText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return safeText(value).replace(
    /\bhttps?:\/\/[^\s<>"']+/giu,
    "[redacted-private-url]",
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function identifier(value: unknown, path: string): string {
  return parseIdentifier(value, path);
}

function nullableIdentifier(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : parseIdentifier(value, "backup.identifier");
}

function integer(value: unknown): number {
  return parseFiniteInteger(value, {
    path: "backup.integer",
    minimum: 0,
  });
}

function nullableInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : integer(value);
}

function changes(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  const meta = Reflect.get(result, "meta");
  if (typeof meta !== "object" || meta === null) return 0;
  const value = Reflect.get(meta, "changes");
  return typeof value === "number" ? value : 0;
}
