import {
  OrganizerAccessDeniedError,
  authorizeMembership,
  revalidateAuthorizedMembership,
  type AuthorizedMembership,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type D1Value,
  type TrustedServerIdentity,
} from "../auth";
import {
  assertOnlyKeys,
  parseBoundedString,
  parseObject,
  validationIssue,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  prepareMediaUsageReconciliation,
  resolveCmsRevisionMediaAssets,
  validateMediaAssetsForUsage,
  type MediaUsageEntityType,
  type MediaUsageReferenceInput,
  type PublicReadyMediaAsset,
  type ResponsiveMediaAssetDto,
} from "../media/usage";
import {
  canonicalJson,
  contrastRatio,
  contentHash,
  assertLegalStatusSnapshotCoherent,
  assertPagePublicationStructure,
  parseClubProfileSnapshot,
  parseCmsEntityType,
  parseCommunityLinkSnapshot,
  parseExpectedContentVersion,
  parseLegalStatusSnapshot,
  parseNavigationSnapshot,
  parsePageSnapshot,
  parsePublishInput,
  parseProgramProfileSnapshot,
  parseRestoreInput,
  parseSiteIdentitySnapshot,
  type CmsClubProfileSnapshot,
  type CmsCommunityLinkSnapshot,
  type CmsEntityType,
  type CmsLegalStatusSnapshot,
  type CmsNavigationSnapshot,
  type CmsPageBlock,
  type CmsPageSnapshot,
  type CmsProgramProfileSnapshot,
  type CmsSiteIdentitySnapshot,
  type CmsWorkflowState,
} from "./cms-validation";
import { ensureCmsAdoption } from "./cms-adoption";
import {
  resolveEditorialPublishedEventSelectionProofs,
} from "../public/events";
import { requiresCompleteBrandArtwork } from "../../brand";
import { assertNoHistoricalOrganizerEmail } from "../public-content-safety";
import { publicOrganizerEmailExposureSql } from "../../validation/public-organizer-email";
import {
  cmsPageLiveProjectionMatchesReceiptSql,
  cmsReceiptEnvelopeMatchesRevisionSql,
} from "../public/cms-materialization-contract";
import {
  calendarDateInTimeZone,
  DEFAULT_TIME_ZONE,
} from "../../time";
import {
  PUBLIC_CATALOG_PAGES,
  PUBLIC_ORGANIZATION_SLUG,
  type PublicCatalogPageDefinition,
} from "../public/catalog-definitions";
import { prepareNotificationInsert } from "./notifications";

const CMS_ADOPTION_VERSION = 1;
const CMS_ENTITY_LIMIT = 200;
const CMS_REVISION_LIMIT = 100;
const PHASE7_STARTER_COPY_UPGRADE_VERSION = 1;
const PHASE7_STARTER_COPY_MARKER_KEY =
  "phase7_starter_copy_upgrade";
const VISITOR_PRIVACY_COPY_UPGRADE_VERSION = 1;
const VISITOR_PRIVACY_COPY_MARKER_KEY =
  "visitor_privacy_copy_upgrade";
const VISITOR_PRIVACY_COPY_AUDIT_SOURCE =
  "visitor_privacy_copy_upgrade";
const VISITOR_FEEDBACK_COPY_UPGRADE_VERSION = 1;
const VISITOR_FEEDBACK_COPY_MARKER_KEY =
  "visitor_feedback_copy_upgrade";
const VISITOR_FEEDBACK_COPY_AUDIT_SOURCE =
  "visitor_feedback_copy_upgrade";
const PHASE7_STARTER_COPY_PAGE_SLUGS = Object.freeze([
  "contact",
  "get-involved",
  "host-an-event",
  "privacy",
] as const);
type Phase7StarterCopyPageSlug =
  (typeof PHASE7_STARTER_COPY_PAGE_SLUGS)[number];
type Phase7StarterCopyOutcome = Readonly<{
  contentHash: string | null;
  outcome: "skipped" | "upgraded";
  reason:
    | "already_current"
    | "legacy_copy_upgraded"
    | "newer_draft_preserved"
    | "nonlegacy_copy_preserved"
    | "page_unavailable";
  recordedAt: number;
  slug: Phase7StarterCopyPageSlug;
}>;
type Phase7StarterCopyMarker = Readonly<{
  completedAt: number | null;
  outcomes: readonly Phase7StarterCopyOutcome[];
  version: typeof PHASE7_STARTER_COPY_UPGRADE_VERSION;
}>;
type Phase7StarterCopyCandidate = Readonly<{
  actor: AuthorizedMembership;
  contentVersion: number;
  currentDraftHash: string | null;
  currentDraftIsUpgrade: boolean;
  currentDraftRevisionId: string | null;
  entityKey: string | null;
  publishedHash: string | null;
  publishedRevisionId: string | null;
  workflowStatus: CmsWorkflowState | null;
}>;
export type Phase7StarterCopyReconciliationResult =
  | "processed"
  | "ready";
export type VisitorPrivacyCopyReconciliationResult =
  | "processed"
  | "ready";
export type VisitorFeedbackCopyReconciliationResult =
  | "processed"
  | "ready";
type VisitorPrivacyCopyMarker = Readonly<{
  completedAt: number;
  contentHash: string | null;
  outcome: "skipped" | "upgraded";
  reason:
    | "already_current"
    | "legacy_copy_upgraded"
    | "newer_draft_preserved"
    | "nonlegacy_copy_preserved"
    | "page_unavailable";
  version: typeof VISITOR_PRIVACY_COPY_UPGRADE_VERSION;
}>;
type VisitorFeedbackCopyMarker = Readonly<{
  completedAt: number;
  contentHash: string | null;
  outcome: "skipped" | "upgraded";
  reason:
    | "already_current"
    | "legacy_copy_upgraded"
    | "newer_draft_preserved"
    | "nonlegacy_copy_preserved"
    | "page_unavailable";
  version: typeof VISITOR_FEEDBACK_COPY_UPGRADE_VERSION;
}>;
const LEGACY_PHASE7_STARTER_PAGE_CONTENT = Object.freeze({
  contact: Object.freeze({
    heading: "Find us on Meetup",
    text:
      "No public contact form or confirmed public email is available yet. Use one of the confirmed Meetup group destinations.",
  }),
  "get-involved": Object.freeze({
    heading: "Bring something to the club",
    paragraphs: Object.freeze([
      "Attending a published event is the simplest way in. Volunteer, host, and partner conversations currently begin through one of the confirmed Meetup group pages.",
      "No public intake form is enabled in this phase, and an idea does not reserve a date or guarantee publication.",
    ]),
    text:
      "You can attend, share an event idea, volunteer, host a gathering, or begin a conversation about partnering.",
  }),
  "host-an-event": Object.freeze({
    heading: "Interested in hosting?",
    paragraphs: Object.freeze([
      "This page is informational. It does not submit an event, reserve a date, or promise that an idea will be scheduled.",
      "A useful starting idea has a clear question or activity, a reason to gather, and enough practical detail for an organizer to assess later.",
    ]),
    text:
      "Event-hosting tools are not open yet. For now, read the club’s approach and connect through a confirmed Meetup group page.",
  }),
  privacy: Object.freeze({
    heading: "Privacy, in plain language",
    paragraphs: Object.freeze([
      "The site is hosted with ChatGPT Sites and uses Sites-managed D1 for structured data and R2 for approved files.",
      "Organizer access will use Sign in with ChatGPT, which shares authenticated identity information with the organizer portal. Public event facts imported from Meetup link back to the official RSVP page.",
      "This starter notice needs legal review before a public launch.",
    ]),
    text:
      "Public pages can be browsed without an attendee account. This phase has no enabled public submission form.",
  }),
} satisfies Readonly<
  Record<
    Phase7StarterCopyPageSlug,
    Readonly<{
      heading: string;
      paragraphs?: readonly string[];
      text: string;
    }>
  >
>);
const PREVIOUS_VISITOR_PRIVACY_PAGE_CONTENT = Object.freeze({
  heading: "Privacy, in plain language",
  paragraphs: Object.freeze([
    "The site is hosted with ChatGPT Sites and uses Sites-managed D1 for structured data and R2 for approved files.",
    "Organizer access uses Sign in with ChatGPT, which can provide name and email identity to the private organizer portal. Public visitors do not need to sign in.",
    "This starter notice needs legal review before a public launch.",
  ]),
  text:
    "Public pages and the four public forms can be used without an attendee account. Form submissions are stored in the private organizer inbox for authorized organizers to review.",
});
const PREVIOUS_VISITOR_FEEDBACK_PAGE_CONTENT = Object.freeze({
  heading: "Send a private inquiry",
  text:
    "The Contact form stores your name, reply email, topic, and message in the private organizer inbox. It does not enroll you in marketing or send an email confirmation.",
});
const PUBLIC_LEGAL_SETTING_KEY = "public_legal_status";
const PUBLIC_IDENTITY_SETTING_KEY = "public_identity";
const REQUIRED_SYSTEM_PAGE_SLUGS = new Set([
  "home",
  "events",
  "clubs",
  "community",
  "about",
  "get-involved",
  "host-an-event",
  "contact",
  "conduct",
  "accessibility",
  "privacy",
]);
const IMMUTABLE_PAGE_SLUGS = new Set([
  ...REQUIRED_SYSTEM_PAGE_SLUGS,
  "resources",
]);
const SINGLETON_ENTITY_KEYS = Object.freeze({
  legal_status: "legal_status",
  navigation: "navigation",
  site_identity: "site_identity",
});

const CMS_ENTITY_DISPLAY_LABEL_SQL = String.raw`
CASE state.entity_type
  WHEN 'page' THEN (
    SELECT page.title
    FROM pages AS page
    WHERE page.id = state.entity_key
      AND page.organization_id = state.organization_id
      AND page.deleted_at IS NULL
  )
  WHEN 'club_public_profile' THEN COALESCE(
    (
      SELECT NULLIF(trim(detail.public_display_name), '')
      FROM club_public_profile_details AS detail
      WHERE detail.club_id = state.entity_key
        AND detail.organization_id = state.organization_id
    ),
    (
      SELECT club.name
      FROM clubs AS club
      WHERE club.id = state.entity_key
        AND club.organization_id = state.organization_id
    )
  )
  WHEN 'program_public_profile' THEN COALESCE(
    (
      SELECT NULLIF(trim(detail.public_display_name), '')
      FROM program_public_profile_details AS detail
      WHERE detail.program_id = state.entity_key
        AND detail.organization_id = state.organization_id
    ),
    (
      SELECT program.name
      FROM programs AS program
      WHERE program.id = state.entity_key
        AND program.organization_id = state.organization_id
    )
  )
  WHEN 'community_link' THEN (
    SELECT link.label
    FROM community_links AS link
    WHERE link.id = state.entity_key
      AND link.organization_id = state.organization_id
      AND link.deleted_at IS NULL
  )
  WHEN 'navigation' THEN 'Header and footer navigation'
  WHEN 'site_identity' THEN 'Site identity'
  WHEN 'legal_status' THEN 'Legal status'
END`;

type CmsSnapshot =
  | CmsClubProfileSnapshot
  | CmsCommunityLinkSnapshot
  | CmsLegalStatusSnapshot
  | CmsNavigationSnapshot
  | CmsPageSnapshot
  | CmsProgramProfileSnapshot
  | CmsSiteIdentitySnapshot;

type CmsStateRow = Readonly<{
  contentVersion: number;
  currentDraftRevisionId: string | null;
  entityKey: string;
  entityType: CmsEntityType;
  id: string;
  publishedRevisionId: string | null;
  workflowStatus: CmsWorkflowState;
}>;

type CmsRevisionRow = Readonly<{
  contentHash: string;
  id: string;
  revisionNumber: number;
  snapshot: CmsSnapshot;
}>;

type CmsMediaUsageGroup = Readonly<{
  entityId: string;
  entityType: MediaUsageEntityType;
  usages: readonly MediaUsageReferenceInput[];
}>;

export type CmsEntitySummaryDto = Readonly<{
  contentVersion: number;
  currentDraftRevisionId: string | null;
  currentRevisionNumber: number | null;
  displayLabel: string;
  entityKey: string;
  entityType: CmsEntityType;
  hasNewerDraft: boolean;
  lastEditorDisplayName: string;
  publishedRevisionId: string | null;
  publishedRevisionNumber: number | null;
  updatedAt: number;
  workflowStatus: CmsWorkflowState;
}>;

export type CmsRevisionDto = Readonly<{
  actorDisplayName: string;
  contentHash: string;
  createdAt: number;
  id: string;
  restoredFromRevisionId: string | null;
  revisionNumber: number;
}>;

export type CmsEntityWorkspaceDto = Readonly<{
  entity: CmsEntitySummaryDto;
  permissions: Readonly<{
    canArchive: boolean;
    canChangeSlug: boolean;
    canConfirmLegal: boolean;
    canDelete: boolean;
    canEdit: boolean;
    canPublish: boolean;
    canRevokeLegal: boolean;
    canRestore: boolean;
    canUnpublish: boolean;
  }>;
  revision: Readonly<{
    contentHash: string;
    id: string;
    revisionNumber: number;
    snapshot: CmsSnapshot;
  }> | null;
  revisions: readonly CmsRevisionDto[];
}>;

export type CmsRevisionPreviewDto = Readonly<{
  clubRelatedResources: readonly Readonly<{
    label: string;
    url: string;
  }>[];
  communityLinkOrder: readonly Readonly<{
    entityKey: string;
    sortOrder: number;
    url: string;
  }>[];
  contentHash: string;
  entityKey: string;
  entityType: CmsEntityType;
  mediaAssets: readonly ResponsiveMediaAssetDto[];
  revisionId: string;
  revisionNumber: number;
  snapshot: CmsSnapshot;
}>;

export async function listCmsEntities(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
): Promise<readonly CmsEntitySummaryDto[]> {
  const actor = await authorizeCmsActor(database, identity);
  await ensureCmsAdoption(database, actor);
  const result = await database
    .prepare(
      `SELECT state.entity_type, state.entity_key, state.workflow_status,
              state.content_version, state.current_draft_revision_id,
              state.published_revision_id, state.updated_at,
              ${CMS_ENTITY_DISPLAY_LABEL_SQL} AS display_label,
              editor.display_name AS last_editor_display_name,
              draft.revision_number AS current_revision_number,
              published.revision_number AS published_revision_number
       FROM cms_entity_publication_states AS state
       LEFT JOIN profiles AS editor
         ON editor.id = state.last_editor_profile_id
       LEFT JOIN cms_entity_revisions AS draft
         ON draft.id = state.current_draft_revision_id
        AND draft.organization_id = state.organization_id
        AND draft.publication_state_id = state.id
       LEFT JOIN cms_entity_revisions AS published
         ON published.id = state.published_revision_id
        AND published.organization_id = state.organization_id
        AND published.publication_state_id = state.id
       WHERE state.organization_id = ?
         AND EXISTS (
           SELECT 1
           FROM organization_memberships AS membership
           JOIN profiles AS profile
             ON profile.id = membership.profile_id
            AND profile.normalized_email = ?
            AND profile.status = 'active'
            AND profile.deleted_at IS NULL
           JOIN organizations AS organization
             ON organization.id = membership.organization_id
            AND organization.deleted_at IS NULL
           WHERE membership.id = ?
             AND membership.organization_id = state.organization_id
             AND membership.profile_id = ?
             AND membership.role = ?
             AND membership.normalized_email = ?
             AND membership.status = 'active'
             AND membership.deleted_at IS NULL
         )
       ORDER BY state.entity_type ASC, state.updated_at DESC, state.entity_key ASC
       LIMIT ?`,
    )
    .bind(
      actor.organizationId,
      identity.email,
      actor.membershipId,
      actor.profileId,
      actor.role,
      identity.email,
      CMS_ENTITY_LIMIT,
    )
    .all<Record<string, unknown>>();
  if ((result.results ?? []).length === 0) {
    throw new OrganizerAccessDeniedError("inactive_membership");
  }
  return Object.freeze(
    (result.results ?? []).map((row) => entitySummary(row)),
  );
}

export async function readCmsEntityWorkspace(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  entityTypeValue: unknown,
  entityKeyValue: unknown,
): Promise<CmsEntityWorkspaceDto> {
  const actor = await authorizeCmsActor(database, identity);
  await ensureCmsAdoption(database, actor);
  const entityType = parseCmsEntityType(entityTypeValue);
  const entityKey = parseEntityKey(entityKeyValue);
  const state = await readState(database, actor.organizationId, entityType, entityKey);
  if (!state) throw notFound();
  const row = await database
    .prepare(
      `SELECT state.entity_type, state.entity_key, state.workflow_status,
              state.content_version, state.current_draft_revision_id,
              state.published_revision_id, state.updated_at,
              ${CMS_ENTITY_DISPLAY_LABEL_SQL} AS display_label,
              editor.display_name AS last_editor_display_name,
              draft.revision_number AS current_revision_number,
              published.revision_number AS published_revision_number
       FROM cms_entity_publication_states AS state
       LEFT JOIN profiles AS editor
         ON editor.id = state.last_editor_profile_id
       LEFT JOIN cms_entity_revisions AS draft
         ON draft.id = state.current_draft_revision_id
        AND draft.organization_id = state.organization_id
        AND draft.publication_state_id = state.id
       LEFT JOIN cms_entity_revisions AS published
         ON published.id = state.published_revision_id
        AND published.organization_id = state.organization_id
        AND published.publication_state_id = state.id
       WHERE state.id = ?
         AND state.organization_id = ?
       LIMIT 1`,
    )
    .bind(state.id, actor.organizationId)
    .first<Record<string, unknown>>();
  if (!row) throw notFound();
  const revision = state.currentDraftRevisionId
    ? await readRevision(
        database,
        actor.organizationId,
        state,
        state.currentDraftRevisionId,
      )
    : null;
  const revisions = await listCmsEntityRevisionsForActor(
    database,
    actor,
    state,
  );
  const permissions = await cmsWorkspacePermissions(
    database,
    actor,
    state,
    revision?.snapshot ?? null,
  );
  await sealCmsReadActor(database, identity, actor);
  return Object.freeze({
    entity: entitySummary(row),
    permissions,
    revision: revision
      ? Object.freeze({
          contentHash: revision.contentHash,
          id: revision.id,
          revisionNumber: revision.revisionNumber,
          snapshot: revision.snapshot,
        })
      : null,
    revisions,
  });
}

export async function readCmsRevisionPreview(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  revisionIdValue: unknown,
): Promise<CmsRevisionPreviewDto> {
  const actor = await authorizeCmsActor(database, identity);
  await ensureCmsAdoption(database, actor);
  const revisionId = parseEntityKey(revisionIdValue);
  const row = await database
    .prepare(
      `SELECT revision.id, revision.entity_type, revision.entity_key,
              revision.revision_number, revision.snapshot_json,
              revision.content_hash, state.id AS state_id,
              state.content_version, state.current_draft_revision_id,
              state.published_revision_id, state.workflow_status
       FROM cms_entity_revisions AS revision
       JOIN cms_entity_publication_states AS state
         ON state.id = revision.publication_state_id
        AND state.organization_id = revision.organization_id
        AND state.entity_type = revision.entity_type
        AND state.entity_key = revision.entity_key
       WHERE revision.id = ?
         AND revision.organization_id = ?
       LIMIT 1`,
    )
    .bind(revisionId, actor.organizationId)
    .first<Record<string, unknown>>();
  if (!row) throw notFound();
  const entityType = parseCmsEntityType(row.entity_type);
  let raw: unknown;
  try {
    raw = JSON.parse(requiredString(row.snapshot_json));
  } catch {
    throw serviceUnavailable();
  }
  let snapshot = parseSnapshot(entityType, raw);
  let clubRelatedResources: readonly Readonly<{
    label: string;
    url: string;
  }>[] = Object.freeze([]);
  let communityLinkOrder: readonly Readonly<{
    entityKey: string;
    sortOrder: number;
    url: string;
  }>[] = Object.freeze([]);
  const mediaGroups = cmsMediaUsageGroups(
    actor.organizationId,
    entityType,
    requiredString(row.entity_key),
    snapshot,
  );
  const mediaAssets: readonly ResponsiveMediaAssetDto[] =
    await resolveCmsRevisionMediaAssets(
      database,
      actor,
      {
        assetIds: mediaGroups.flatMap((group) =>
          group.usages.map((usage) => usage.assetId),
        ),
        revisionId,
      },
    );
  const publicMedia = new Map(
    mediaAssets.map((asset) => [asset.assetId, asset]),
  );
  if (entityType === "page") {
    const pageSnapshot = snapshot as CmsPageSnapshot;
    const { blocks } = await materializePublicPageBlocks(
      database,
      actor.organizationId,
      pageSnapshot,
      publicMedia,
      false,
    );
    snapshot = Object.freeze({
      ...pageSnapshot,
      blocks,
      openGraphAssetId:
        pageSnapshot.openGraphAssetId &&
        publicMedia.has(pageSnapshot.openGraphAssetId)
          ? pageSnapshot.openGraphAssetId
          : null,
    });
  } else if (entityType === "club_public_profile") {
    const clubSnapshot = snapshot as CmsClubProfileSnapshot;
    clubRelatedResources = await publishedResourceLinks(
      database,
      actor.organizationId,
      clubSnapshot.relatedResourceIds,
    );
    snapshot = Object.freeze({
      ...clubSnapshot,
      coverAssetId:
        clubSnapshot.coverAssetId &&
        publicMedia.has(clubSnapshot.coverAssetId)
          ? clubSnapshot.coverAssetId
          : null,
      thumbnailAssetId:
        clubSnapshot.thumbnailAssetId &&
        publicMedia.has(clubSnapshot.thumbnailAssetId)
          ? clubSnapshot.thumbnailAssetId
          : null,
      openGraphAssetId:
        clubSnapshot.openGraphAssetId &&
        publicMedia.has(clubSnapshot.openGraphAssetId)
          ? clubSnapshot.openGraphAssetId
          : null,
    });
  } else if (entityType === "program_public_profile") {
    const programSnapshot = snapshot as CmsProgramProfileSnapshot;
    clubRelatedResources = await publishedResourceLinks(
      database,
      actor.organizationId,
      programSnapshot.relatedResourceIds,
    );
    snapshot = Object.freeze({
      ...programSnapshot,
      coverAssetId:
        programSnapshot.coverAssetId &&
        publicMedia.has(programSnapshot.coverAssetId)
          ? programSnapshot.coverAssetId
          : null,
      thumbnailAssetId:
        programSnapshot.thumbnailAssetId &&
        publicMedia.has(programSnapshot.thumbnailAssetId)
          ? programSnapshot.thumbnailAssetId
          : null,
      openGraphAssetId:
        programSnapshot.openGraphAssetId &&
        publicMedia.has(programSnapshot.openGraphAssetId)
          ? programSnapshot.openGraphAssetId
          : null,
    });
  } else if (entityType === "site_identity") {
    const siteSnapshot = snapshot as CmsSiteIdentitySnapshot;
    snapshot = Object.freeze({
      ...siteSnapshot,
      logoAssetId:
        siteSnapshot.logoAssetId &&
        publicMedia.has(siteSnapshot.logoAssetId)
          ? siteSnapshot.logoAssetId
          : null,
      openGraphAssetId:
        siteSnapshot.openGraphAssetId &&
        publicMedia.has(siteSnapshot.openGraphAssetId)
          ? siteSnapshot.openGraphAssetId
          : null,
    });
  } else if (entityType === "community_link") {
    communityLinkOrder = await readPrivateCommunityPreviewOrder(
      database,
      actor.organizationId,
    );
  }
  await sealCmsReadActor(database, identity, actor);
  return Object.freeze({
    clubRelatedResources,
    communityLinkOrder,
    contentHash: requiredString(row.content_hash),
    entityKey: requiredString(row.entity_key),
    entityType,
    mediaAssets,
    revisionId: requiredString(row.id),
    revisionNumber: requiredInteger(row.revision_number),
    snapshot,
  });
}

export async function createCmsEntityDraft(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  entityTypeValue: unknown,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<CmsEntityWorkspaceDto> {
  const actor = await authorizeCmsActor(database, identity);
  await ensureCmsAdoption(database, actor);
  const entityType = parseCmsEntityType(entityTypeValue);
  if (
    entityType !== "page" &&
    entityType !== "club_public_profile" &&
    entityType !== "program_public_profile" &&
    entityType !== "community_link"
  ) {
    throw validationIssue(
      "entityType",
      "creation_not_supported",
      "This content type is established through the existing catalog.",
    );
  }
  const input = parseObject(inputValue);
  assertOnlyKeys(
    input,
    entityType === "club_public_profile"
      ? ["entityKey", "snapshot"]
      : ["snapshot"],
  );
  const snapshot = parseSnapshot(entityType, input.snapshot);
  if (
    entityType === "page" &&
    (snapshot as CmsPageSnapshot).slug !== "resources"
  ) {
    throw validationIssue(
      "snapshot.slug",
      "page_not_supported",
      "Only the Resources page may be added in this phase.",
    );
  }
  const now = parseTimestamp(nowUtcMs);
  const entityKey =
    entityType === "club_public_profile"
      ? parseEntityKey(input.entityKey)
      : crypto.randomUUID();
  if (entityType === "club_public_profile") {
    await validateClubSnapshotReferences(
      database,
      actor.organizationId,
      entityKey,
      snapshot as CmsClubProfileSnapshot,
    );
  }
  if (entityType === "program_public_profile") {
    await validateProgramSnapshotReferences(
      database,
      actor.organizationId,
      null,
      snapshot as CmsProgramProfileSnapshot,
    );
  }
  const stateId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const snapshotJson = canonicalJson(snapshot);
  const hash = await contentHash(snapshot);
  const byteSize = utf8Size(snapshotJson);
  const mediaGroups = cmsMediaUsageGroups(
    actor.organizationId,
    entityType,
    entityKey,
    snapshot,
  );
  await validateCmsMediaUsageGroups(
    database,
    actor.organizationId,
    mediaGroups,
    "draft",
  );
  const media = prepareCmsMediaReconciliation(database, actor, mediaGroups, {
    now,
    publicationScope: "draft",
    revisionId,
  });
  const auditId = crypto.randomUUID();
  const actorGuard = cmsActorGuard("owner", "administrator");
  const sourceStatement =
    entityType === "page"
      ? database
          .prepare(
            `INSERT INTO pages (
               id, organization_id, title, slug, status, visibility,
               current_revision, published_at, created_by_profile_id,
               updated_by_profile_id, created_at, updated_at, deleted_at
             )
             SELECT ?, ?, ?, ?, 'draft', 'private', 1, NULL, ?, ?, ?, ?, NULL
             WHERE ${actorGuard.sql}
               AND NOT EXISTS (
                 SELECT 1
                 FROM pages
                 WHERE organization_id = ?
                   AND (id = ? OR slug = ?)
               )`,
          )
          .bind(
            entityKey,
            actor.organizationId,
            (snapshot as CmsPageSnapshot).title,
            (snapshot as CmsPageSnapshot).slug,
            actor.profileId,
            actor.profileId,
            now,
            now,
            ...actorGuard.bindings(actor),
            actor.organizationId,
            entityKey,
            (snapshot as CmsPageSnapshot).slug,
          )
      : entityType === "community_link"
        ? database
          .prepare(
            `INSERT INTO community_links (
               id, organization_id, label, url, link_type, is_published,
               sort_order, created_by_profile_id, created_at, updated_at,
               deleted_at
             )
             SELECT ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL
             WHERE ${actorGuard.sql}
               AND NOT EXISTS (
                 SELECT 1
                 FROM community_links
                 WHERE organization_id = ?
                   AND (id = ? OR url = ?)
               )`,
          )
          .bind(
            entityKey,
            actor.organizationId,
            (snapshot as CmsCommunityLinkSnapshot).label,
            (snapshot as CmsCommunityLinkSnapshot).url,
            (snapshot as CmsCommunityLinkSnapshot).destinationType,
            (snapshot as CmsCommunityLinkSnapshot).sortOrder,
            actor.profileId,
            now,
            now,
            ...actorGuard.bindings(actor),
            actor.organizationId,
            entityKey,
            (snapshot as CmsCommunityLinkSnapshot).url,
          )
        : entityType === "program_public_profile"
          ? database
              .prepare(
                `INSERT INTO programs (
                   id, organization_id, club_id, name, slug, description,
                   created_by_profile_id, created_at, updated_at, deleted_at
                 )
                 SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
                 WHERE ${actorGuard.sql}
                   AND EXISTS (
                     SELECT 1
                     FROM clubs AS club
                     WHERE club.id = ?
                       AND club.organization_id = ?
                       AND club.deleted_at IS NULL
                       AND NOT EXISTS (
                         SELECT 1
                         FROM club_public_profiles AS profile
                         WHERE profile.club_id = club.id
                           AND profile.organization_id =
                               club.organization_id
                           AND profile.publication_status = 'archived'
                           AND profile.deleted_at IS NULL
                       )
                   )
                   AND NOT EXISTS (
                     SELECT 1
                     FROM programs AS existing
                     WHERE existing.organization_id = ?
                       AND (
                         existing.id = ?
                         OR existing.slug = ?
                       )
                   )`,
              )
              .bind(
                entityKey,
                actor.organizationId,
                (snapshot as CmsProgramProfileSnapshot).clubId,
                (snapshot as CmsProgramProfileSnapshot).name,
                (snapshot as CmsProgramProfileSnapshot).slug,
                (snapshot as CmsProgramProfileSnapshot).summary || null,
                actor.profileId,
                now,
                now,
                ...actorGuard.bindings(actor),
                (snapshot as CmsProgramProfileSnapshot).clubId,
                actor.organizationId,
                actor.organizationId,
                entityKey,
                (snapshot as CmsProgramProfileSnapshot).slug,
              )
          : database
            .prepare(
              `INSERT INTO club_public_profiles (
                 club_id, organization_id, primary_event_lane_id,
                 publication_status, is_featured, description,
                 public_group_url, published_at, created_at, updated_at,
                 deleted_at
               )
               SELECT club.id, club.organization_id, lane.id, 'draft', 0,
                      NULL, NULL, NULL, ?, ?, NULL
               FROM clubs AS club
               JOIN event_lanes AS lane
                 ON lane.id = ?
                AND lane.organization_id = club.organization_id
                AND lane.deleted_at IS NULL
               WHERE club.id = ?
                 AND club.organization_id = ?
                 AND club.deleted_at IS NULL
                 AND ${actorGuard.sql}
                 AND NOT EXISTS (
                   SELECT 1
                   FROM club_public_profiles AS existing
                   WHERE existing.club_id = club.id
                      OR (
                        existing.organization_id = club.organization_id
                        AND existing.club_id = ?
                      )
                 )
                 AND NOT EXISTS (
                   SELECT 1
                   FROM cms_entity_publication_states AS existing_state
                   WHERE existing_state.organization_id =
                         club.organization_id
                     AND existing_state.entity_type =
                         'club_public_profile'
                     AND existing_state.entity_key = club.id
                 )`,
            )
            .bind(
              now,
              now,
              (snapshot as CmsClubProfileSnapshot).laneId,
              entityKey,
              actor.organizationId,
              ...actorGuard.bindings(actor),
              entityKey,
            );
  const results = await executeCmsBatch(database, [
    sourceStatement,
    database
      .prepare(
        `INSERT INTO cms_entity_publication_states (
           id, organization_id, entity_type, entity_key, workflow_status,
           content_version, current_draft_revision_id, published_revision_id,
           last_editor_profile_id, draft_updated_at, published_at,
           unpublished_at, adopted_at, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, 'archived', 1, NULL, NULL, ?, NULL, NULL, NULL,
                NULL, ?, ?
         WHERE changes() = 1
           AND ${actorGuard.sql}
           AND EXISTS (
             SELECT 1
             FROM cms_adoption_states
             WHERE organization_id = ?
               AND adoption_version = ?
           )
           AND NOT EXISTS (
             SELECT 1
             FROM cms_entity_publication_states
             WHERE organization_id = ?
               AND entity_type = ?
               AND entity_key = ?
           )`,
      )
      .bind(
        stateId,
        actor.organizationId,
        entityType,
        entityKey,
        actor.profileId,
        now,
        now,
        ...actorGuard.bindings(actor),
        actor.organizationId,
        CMS_ADOPTION_VERSION,
        actor.organizationId,
        entityType,
        entityKey,
      ),
    database
      .prepare(
        `INSERT INTO cms_entity_revisions (
           id, organization_id, publication_state_id, entity_type, entity_key,
           revision_number, snapshot_json, content_hash, canonical_byte_size,
           restored_from_revision_id, legacy_page_revision_id,
           actor_profile_id, created_at
         )
         SELECT ?, state.organization_id, state.id, state.entity_type,
                state.entity_key, 1, ?, ?, ?, NULL, NULL, ?, ?
         FROM cms_entity_publication_states AS state
         WHERE state.id = ?
           AND state.organization_id = ?
           AND state.entity_type = ?
           AND state.entity_key = ?
           AND state.workflow_status = 'archived'
           AND state.content_version = 1
           AND state.current_draft_revision_id IS NULL
           AND ${actorGuard.sql}`,
      )
      .bind(
        revisionId,
        snapshotJson,
        hash,
        byteSize,
        actor.profileId,
        now,
        stateId,
        actor.organizationId,
        entityType,
        entityKey,
        ...actorGuard.bindings(actor),
      ),
    ...media.statements,
    database
      .prepare(
        `UPDATE cms_entity_publication_states
         SET workflow_status = 'draft',
             current_draft_revision_id = ?,
             last_editor_profile_id = ?,
             draft_updated_at = ?,
             updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND entity_type = ?
           AND entity_key = ?
           AND workflow_status = 'archived'
           AND content_version = 1
           AND current_draft_revision_id IS NULL
           AND EXISTS (
             SELECT 1
             FROM cms_entity_revisions AS revision
             WHERE revision.id = ?
               AND revision.publication_state_id =
                   cms_entity_publication_states.id
               AND revision.organization_id =
                   cms_entity_publication_states.organization_id
               AND revision.revision_number = 1
           )
           AND ${actorGuard.sql}`,
      )
      .bind(
        revisionId,
        actor.profileId,
        now,
        now,
        stateId,
        actor.organizationId,
        entityType,
        entityKey,
        revisionId,
        ...actorGuard.bindings(actor),
      ),
    auditStatement(database, {
      action: "cms.entity_created",
      actor,
      auditId,
      contentVersion: 1,
      entityId: entityKey,
      entityType,
      metadata: { contentVersion: 1 },
      mediaRevisionId: revisionId,
      mediaScope: "draft",
      mediaUsageCount: media.insertCount,
      now,
      stateId,
      revisionId,
    }),
  ]);
  const stateUpdateIndex = 3 + media.statements.length;
  const auditIndex = stateUpdateIndex + 1;
  if (
    changes(results[0]) !== 1 ||
    changes(results[1]) !== 1 ||
    changes(results[2]) !== 1 ||
    changes(results[stateUpdateIndex]) !== 1 ||
    changes(results[auditIndex]) !== 1 ||
    media.requiredRelativeChanges.some(
      (required) =>
        changes(results[3 + required.index]) !== required.changes,
    )
  ) {
    throw staleEdit();
  }
  return readCmsEntityWorkspace(database, identity, entityType, entityKey);
}

export async function saveCmsEntityDraft(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  entityTypeValue: unknown,
  entityKeyValue: unknown,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<CmsEntityWorkspaceDto> {
  const actor = await authorizeCmsActor(database, identity);
  await ensureCmsAdoption(database, actor);
  const entityType = parseCmsEntityType(entityTypeValue);
  const entityKey = parseEntityKey(entityKeyValue);
  enforceSingletonKey(entityType, entityKey);
  const input = parseObject(inputValue);
  assertOnlyKeys(input, ["expectedContentVersion", "snapshot"]);
  const expectedContentVersion = parseExpectedContentVersion(
    input.expectedContentVersion,
  );
  if (expectedContentVersion < 1) {
    throw validationIssue(
      "expectedContentVersion",
      "invalid_version",
      "Existing content requires a positive version.",
    );
  }
  const snapshot = parseSnapshot(entityType, input.snapshot);
  await saveRevision(database, actor, {
    entityKey,
    entityType,
    expectedContentVersion,
    now: parseTimestamp(nowUtcMs),
    restoredFromRevisionId: null,
    snapshot,
  });
  return readCmsEntityWorkspace(database, identity, entityType, entityKey);
}

export async function restoreCmsRevisionAsDraft(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  entityTypeValue: unknown,
  entityKeyValue: unknown,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<CmsEntityWorkspaceDto> {
  const actor = await authorizeCmsActor(database, identity);
  await ensureCmsAdoption(database, actor);
  const entityType = parseCmsEntityType(entityTypeValue);
  const entityKey = parseEntityKey(entityKeyValue);
  enforceSingletonKey(entityType, entityKey);
  const input = parseRestoreInput(inputValue);
  const state = await readState(database, actor.organizationId, entityType, entityKey);
  if (!state) throw notFound();
  const source = await readRevision(
    database,
    actor.organizationId,
    state,
    input.revisionId,
  );
  if (!source) throw notFound();
  await saveRevision(database, actor, {
    entityKey,
    entityType,
    expectedContentVersion: input.expectedContentVersion,
    now: parseTimestamp(nowUtcMs),
    restoredFromRevisionId: source.id,
    snapshot: source.snapshot,
  });
  return readCmsEntityWorkspace(database, identity, entityType, entityKey);
}

export async function publishCmsEntity(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  entityTypeValue: unknown,
  entityKeyValue: unknown,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<CmsEntityWorkspaceDto> {
  const entityType = parseCmsEntityType(entityTypeValue);
  const allowedRoles =
    entityType === "legal_status"
      ? (["owner"] as const)
      : (["owner", "administrator"] as const);
  const actor = await authorizeMembership(database, identity, { allowedRoles });
  await ensureCmsAdoption(database, actor);
  const entityKey = parseEntityKey(entityKeyValue);
  enforceSingletonKey(entityType, entityKey);
  const { expectedContentVersion } = parsePublishInput(inputValue);
  const now = parseTimestamp(nowUtcMs);
  await publishRevisionForActor(database, actor, {
    entityKey,
    entityType,
    expectedContentVersion,
    now,
  });
  return readCmsEntityWorkspace(database, identity, entityType, entityKey);
}

async function publishRevisionForActor(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  input: Readonly<{
    auditMetadata?: Readonly<Record<string, boolean | number | string>>;
    entityKey: string;
    entityType: CmsEntityType;
    expectedContentVersion: number;
    now: number;
  }>,
): Promise<void> {
  const {
    entityKey,
    entityType,
    expectedContentVersion,
    now,
  } = input;
  const allowedRoles =
    entityType === "legal_status"
      ? (["owner"] as const)
      : (["owner", "administrator"] as const);
  const state = await readState(database, actor.organizationId, entityType, entityKey);
  if (
    !state ||
    state.contentVersion !== expectedContentVersion ||
    !state.currentDraftRevisionId
  ) {
    throw staleEdit();
  }
  if (
    (
      state.entityType === "club_public_profile" ||
      state.entityType === "program_public_profile"
    ) &&
    state.workflowStatus === "archived"
  ) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "Archived public profiles retain their history but cannot be edited or republished.",
    );
  }
  const revision = await readRevision(
    database,
    actor.organizationId,
    state,
    state.currentDraftRevisionId,
  );
  if (!revision) throw serviceUnavailable();
  await assertNoHistoricalOrganizerEmail(
    database,
    actor.organizationId,
    [canonicalJson(revision.snapshot)],
    "snapshot",
  );
  if (entityType === "legal_status") {
    assertLegalStatusSnapshotCoherent(
      revision.snapshot as CmsLegalStatusSnapshot,
    );
  }
  if (entityType === "club_public_profile") {
    assertClubSnapshotPublicationReady(
      revision.snapshot as CmsClubProfileSnapshot,
    );
  }
  if (entityType === "program_public_profile") {
    assertProgramSnapshotPublicationReady(
      revision.snapshot as CmsProgramProfileSnapshot,
    );
  }
  const mediaGroups = cmsMediaUsageGroups(
    actor.organizationId,
    entityType,
    entityKey,
    revision.snapshot,
  );
  const publicMedia = await validateCmsMediaUsageGroups(
    database,
    actor.organizationId,
    mediaGroups,
    "published",
  );
  const projection = await publicationStatements(
    database,
    actor,
    state,
    revision,
    now,
    publicMedia,
  );
  const media = prepareCmsMediaReconciliation(database, actor, mediaGroups, {
    now,
    publicationScope: "published",
    revisionId: revision.id,
  });
  const nextContentVersion = expectedContentVersion + 1;
  const actorGuard = cmsActorGuard(...allowedRoles);
  const stateUpdate = database
    .prepare(
      `UPDATE cms_entity_publication_states
       SET workflow_status = 'published',
           content_version = ?,
           published_revision_id = ?,
           last_editor_profile_id = ?,
           published_at = ?,
           unpublished_at = NULL,
           updated_at = ?
       WHERE id = ?
         AND organization_id = ?
         AND entity_type = ?
         AND entity_key = ?
         AND content_version = ?
         AND current_draft_revision_id = ?
         AND (
           workflow_status IN ('draft', 'unpublished')
         OR (
             workflow_status = 'published'
             AND published_revision_id IS NOT ?
           )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM cms_entity_revisions AS public_revision
           WHERE public_revision.id = ?
             AND public_revision.organization_id =
                 cms_entity_publication_states.organization_id
             AND public_revision.publication_state_id =
                 cms_entity_publication_states.id
             AND ${publicOrganizerEmailExposureSql(
               ["public_revision.snapshot_json"],
               "cms_entity_publication_states.organization_id",
             )}
         )
         AND ${actorGuard.sql}`,
    )
    .bind(
      nextContentVersion,
      revision.id,
      actor.profileId,
      now,
      now,
      state.id,
      actor.organizationId,
      entityType,
      entityKey,
      expectedContentVersion,
      revision.id,
      revision.id,
      revision.id,
      ...actorGuard.bindings(actor),
    );
  const receiptId = crypto.randomUUID();
  const receipt = database
    .prepare(
      `INSERT INTO cms_public_materialization_receipts (
         id, organization_id, publication_state_id, entity_type, entity_key,
         revision_id, revision_hash, projection_json, canonical_byte_size,
         actor_profile_id, created_at
       )
       SELECT ?, state.organization_id, state.id, state.entity_type,
              state.entity_key, revision.id, revision.content_hash, ?, ?, ?, ?
       FROM cms_entity_publication_states AS state
       JOIN cms_entity_revisions AS revision
         ON revision.id = state.published_revision_id
        AND revision.organization_id = state.organization_id
        AND revision.publication_state_id = state.id
        AND revision.entity_type = state.entity_type
        AND revision.entity_key = state.entity_key
       WHERE state.id = ?
         AND state.organization_id = ?
         AND state.entity_type = ?
         AND state.entity_key = ?
         AND state.workflow_status = 'published'
         AND state.content_version = ?
         AND state.current_draft_revision_id = ?
         AND state.published_revision_id = ?
          AND revision.content_hash = ?
          AND state.last_editor_profile_id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM cms_public_materialization_receipts AS existing_receipt
            WHERE existing_receipt.publication_state_id = state.id
              AND existing_receipt.organization_id = state.organization_id
              AND existing_receipt.entity_type = state.entity_type
              AND existing_receipt.entity_key = state.entity_key
              AND existing_receipt.revision_id = revision.id
              AND existing_receipt.revision_hash = revision.content_hash
              AND existing_receipt.projection_json = ?
          )
          AND ${actorGuard.sql}`,
    )
    .bind(
      receiptId,
      projection.projectionJson,
      utf8Size(projection.projectionJson),
      actor.profileId,
      now,
      state.id,
      actor.organizationId,
      entityType,
      entityKey,
      nextContentVersion,
      revision.id,
      revision.id,
      revision.contentHash,
      actor.profileId,
      projection.projectionJson,
      ...actorGuard.bindings(actor),
    );
  const publishCompletion = projectionCompletion(
    `(${projection.completion.sql})
       AND EXISTS (
        SELECT 1
        FROM cms_public_materialization_receipts AS receipt
        WHERE receipt.organization_id = ?
          AND receipt.publication_state_id = ?
         AND receipt.entity_type = ?
         AND receipt.entity_key = ?
         AND receipt.revision_id = ?
         AND receipt.revision_hash = ?
         AND receipt.projection_json = ?
    )`,
    ...projection.completion.bindings,
    actor.organizationId,
    state.id,
    entityType,
    entityKey,
    revision.id,
    revision.contentHash,
    projection.projectionJson,
  );
  const auditId = crypto.randomUUID();
  const audit = auditStatement(database, {
    action: "cms.entity_published",
    actor,
    auditId,
    entityId: entityKey,
    entityType,
    metadata: {
      contentVersion: nextContentVersion,
      revisionNumber: revision.revisionNumber,
      ...(input.auditMetadata ?? {}),
    },
    contentVersion: nextContentVersion,
    completion: publishCompletion,
    mediaRevisionId: revision.id,
    mediaScope: "published",
    mediaUsageCount: media.insertCount,
    now,
    publishedRevisionId: revision.id,
    stateId: state.id,
  });
  const results = await executeCmsBatch(database, [
    ...media.retirementStatements,
    stateUpdate,
    receipt,
    ...projection.statements,
    ...media.materializationStatements,
    audit,
  ]);
  const stateUpdateIndex = media.retirementStatements.length;
  const receiptIndex = stateUpdateIndex + 1;
  const projectionOffset = receiptIndex + 1;
  const mediaOffset = projectionOffset + projection.statements.length;
  const auditIndex = mediaOffset + media.materializationStatements.length;
  if (
    changes(results[stateUpdateIndex]) !== 1 ||
    ![0, 1].includes(changes(results[receiptIndex])) ||
    changes(results[auditIndex]) !== 1 ||
    projection.requiredChanges.some(
      (required) =>
        changes(results[projectionOffset + required.index]) !==
        required.changes,
    ) ||
    media.requiredMaterializationChanges.some(
      (required) =>
        changes(results[mediaOffset + required.index]) !==
        required.changes,
    )
  ) {
    throw staleEdit();
  }
}

/**
 * Bounded post-adoption maintenance for the four Phase 7 form pages.
 *
 * A call processes at most one page. Only the exact published Phase 6 starter
 * snapshot may be replaced. Any newer or non-starter draft is preserved and
 * recorded as an explicit skip. The actor is selected from the same current,
 * active canonical Owner relationship used by invariant adoption; no request
 * can supply or fabricate an actor.
 */
export async function reconcilePhase7StarterPageCopy(
  database: D1DatabaseLike,
  nowUtcMs = Date.now(),
): Promise<Phase7StarterCopyReconciliationResult> {
  const now = parseTimestamp(nowUtcMs);
  const markerEnvelope = await readPhase7StarterCopyMarker(database);
  if (!markerEnvelope) return "ready";
  if (
    markerEnvelope.marker?.completedAt !== null &&
    markerEnvelope.marker?.outcomes.length ===
      PHASE7_STARTER_COPY_PAGE_SLUGS.length
  ) {
    return "ready";
  }

  const completedSlugs = new Set(
    markerEnvelope.marker?.outcomes.map((outcome) => outcome.slug) ?? [],
  );
  const slug = PHASE7_STARTER_COPY_PAGE_SLUGS.find(
    (candidate) => !completedSlugs.has(candidate),
  );
  if (!slug) {
    throw serviceUnavailable();
  }

  const targetSnapshot = phase7StarterPageSnapshot(slug, false);
  const legacySnapshot = phase7StarterPageSnapshot(slug, true);
  const [targetHash, legacyHash] = await Promise.all([
    contentHash(targetSnapshot),
    contentHash(legacySnapshot),
  ]);
  const candidate = await readPhase7StarterCopyCandidate(
    database,
    markerEnvelope.organizationId,
    slug,
    targetHash,
    "phase7_starter_copy_upgrade",
  );
  if (!candidate) throw serviceUnavailable();

  let outcome: Phase7StarterCopyOutcome;
  let notifyOwner = false;
  if (
    candidate.workflowStatus === "published" &&
    candidate.currentDraftHash === targetHash &&
    candidate.publishedHash === targetHash
  ) {
    outcome = phase7StarterCopyOutcome(
      slug,
      "upgraded",
      "already_current",
      targetHash,
      now,
    );
  } else if (
    candidate.entityKey &&
    candidate.workflowStatus === "published" &&
    candidate.currentDraftRevisionId === candidate.publishedRevisionId &&
    candidate.currentDraftHash === legacyHash &&
    candidate.publishedHash === legacyHash
  ) {
    const draftVersion = await saveRevision(database, candidate.actor, {
      auditMetadata: {
        source: "phase7_starter_copy_upgrade",
        targetContentHash: targetHash,
        upgradeVersion: PHASE7_STARTER_COPY_UPGRADE_VERSION,
      },
      entityKey: candidate.entityKey,
      entityType: "page",
      expectedContentVersion: candidate.contentVersion,
      now,
      restoredFromRevisionId: null,
      snapshot: targetSnapshot,
    });
    await publishRevisionForActor(database, candidate.actor, {
      auditMetadata: {
        source: "phase7_starter_copy_upgrade",
        targetContentHash: targetHash,
        upgradeVersion: PHASE7_STARTER_COPY_UPGRADE_VERSION,
      },
      entityKey: candidate.entityKey,
      entityType: "page",
      expectedContentVersion: draftVersion,
      now,
    });
    outcome = phase7StarterCopyOutcome(
      slug,
      "upgraded",
      "legacy_copy_upgraded",
      targetHash,
      now,
    );
  } else if (
    candidate.entityKey &&
    candidate.workflowStatus === "published" &&
    candidate.currentDraftRevisionId !== candidate.publishedRevisionId &&
    candidate.currentDraftHash === targetHash &&
    candidate.publishedHash === legacyHash &&
    candidate.currentDraftIsUpgrade
  ) {
    await publishRevisionForActor(database, candidate.actor, {
      auditMetadata: {
        resumed: true,
        source: "phase7_starter_copy_upgrade",
        targetContentHash: targetHash,
        upgradeVersion: PHASE7_STARTER_COPY_UPGRADE_VERSION,
      },
      entityKey: candidate.entityKey,
      entityType: "page",
      expectedContentVersion: candidate.contentVersion,
      now,
    });
    outcome = phase7StarterCopyOutcome(
      slug,
      "upgraded",
      "legacy_copy_upgraded",
      targetHash,
      now,
    );
  } else if (
    candidate.currentDraftRevisionId !==
      candidate.publishedRevisionId
  ) {
    notifyOwner = true;
    outcome = phase7StarterCopyOutcome(
      slug,
      "skipped",
      "newer_draft_preserved",
      candidate.publishedHash,
      now,
    );
  } else if (!candidate.entityKey || !candidate.workflowStatus) {
    outcome = phase7StarterCopyOutcome(
      slug,
      "skipped",
      "page_unavailable",
      null,
      now,
    );
  } else {
    outcome = phase7StarterCopyOutcome(
      slug,
      "skipped",
      "nonlegacy_copy_preserved",
      candidate.publishedHash,
      now,
    );
  }

  await recordPhase7StarterCopyOutcome(database, {
    actor: candidate.actor,
    entityKey: candidate.entityKey,
    marker: markerEnvelope.marker,
    markerJson: markerEnvelope.markerJson,
    notifyOwner,
    now,
    outcome,
  });
  return "processed";
}

/**
 * One-time visitor-facing Privacy publication upgrade.
 *
 * Only the exact previously shipped public Privacy snapshot is eligible for
 * automatic replacement. Owner drafts and every unknown/custom publication
 * are preserved. Publication still runs through the normal CMS revision,
 * receipt, projection, media, and audit protocol rather than mutating the
 * public projection directly.
 */
export async function reconcileVisitorPrivacyCopy(
  database: D1DatabaseLike,
  nowUtcMs = Date.now(),
): Promise<VisitorPrivacyCopyReconciliationResult> {
  const now = parseTimestamp(nowUtcMs);
  const markerEnvelope = await readVisitorPrivacyCopyMarker(database);
  if (!markerEnvelope) return "ready";
  if (markerEnvelope.marker) return "ready";

  const targetSnapshot = phase7StarterPageSnapshot("privacy", false);
  const previousSnapshot = previousVisitorPrivacyPageSnapshot();
  const [targetHash, previousHash] = await Promise.all([
    contentHash(targetSnapshot),
    contentHash(previousSnapshot),
  ]);
  const candidate = await readPhase7StarterCopyCandidate(
    database,
    markerEnvelope.organizationId,
    "privacy",
    targetHash,
    VISITOR_PRIVACY_COPY_AUDIT_SOURCE,
  );
  if (!candidate) throw serviceUnavailable();

  let outcome: VisitorPrivacyCopyMarker["outcome"];
  let reason: VisitorPrivacyCopyMarker["reason"];
  let outcomeHash: string | null;
  let notifyOwner = false;
  if (
    candidate.workflowStatus === "published" &&
    candidate.currentDraftHash === targetHash &&
    candidate.publishedHash === targetHash
  ) {
    outcome = "upgraded";
    reason = "already_current";
    outcomeHash = targetHash;
  } else if (
    candidate.entityKey &&
    candidate.workflowStatus === "published" &&
    candidate.currentDraftRevisionId === candidate.publishedRevisionId &&
    candidate.currentDraftHash === previousHash &&
    candidate.publishedHash === previousHash
  ) {
    const draftVersion = await saveRevision(database, candidate.actor, {
      auditMetadata: {
        source: VISITOR_PRIVACY_COPY_AUDIT_SOURCE,
        targetContentHash: targetHash,
        upgradeVersion: VISITOR_PRIVACY_COPY_UPGRADE_VERSION,
      },
      entityKey: candidate.entityKey,
      entityType: "page",
      expectedContentVersion: candidate.contentVersion,
      now,
      restoredFromRevisionId: null,
      snapshot: targetSnapshot,
    });
    await publishRevisionForActor(database, candidate.actor, {
      auditMetadata: {
        source: VISITOR_PRIVACY_COPY_AUDIT_SOURCE,
        targetContentHash: targetHash,
        upgradeVersion: VISITOR_PRIVACY_COPY_UPGRADE_VERSION,
      },
      entityKey: candidate.entityKey,
      entityType: "page",
      expectedContentVersion: draftVersion,
      now,
    });
    outcome = "upgraded";
    reason = "legacy_copy_upgraded";
    outcomeHash = targetHash;
  } else if (
    candidate.entityKey &&
    candidate.workflowStatus === "published" &&
    candidate.currentDraftRevisionId !== candidate.publishedRevisionId &&
    candidate.currentDraftHash === targetHash &&
    candidate.publishedHash === previousHash &&
    candidate.currentDraftIsUpgrade
  ) {
    await publishRevisionForActor(database, candidate.actor, {
      auditMetadata: {
        resumed: true,
        source: VISITOR_PRIVACY_COPY_AUDIT_SOURCE,
        targetContentHash: targetHash,
        upgradeVersion: VISITOR_PRIVACY_COPY_UPGRADE_VERSION,
      },
      entityKey: candidate.entityKey,
      entityType: "page",
      expectedContentVersion: candidate.contentVersion,
      now,
    });
    outcome = "upgraded";
    reason = "legacy_copy_upgraded";
    outcomeHash = targetHash;
  } else if (
    candidate.currentDraftRevisionId !== candidate.publishedRevisionId
  ) {
    outcome = "skipped";
    reason = "newer_draft_preserved";
    outcomeHash = candidate.publishedHash;
    notifyOwner = true;
  } else if (!candidate.entityKey || !candidate.workflowStatus) {
    outcome = "skipped";
    reason = "page_unavailable";
    outcomeHash = null;
  } else {
    outcome = "skipped";
    reason = "nonlegacy_copy_preserved";
    outcomeHash = candidate.publishedHash;
  }

  await recordVisitorPrivacyCopyMarker(database, {
    actor: candidate.actor,
    entityKey: candidate.entityKey,
    markerJson: markerEnvelope.markerJson,
    marker: Object.freeze({
      completedAt: now,
      contentHash: outcomeHash,
      outcome,
      reason,
      version: VISITOR_PRIVACY_COPY_UPGRADE_VERSION,
    }),
    notifyOwner,
    now,
  });
  return "processed";
}

/**
 * One-time visitor-facing Feedback terminology publication upgrade.
 *
 * Only the exact previously shipped Contact snapshot is eligible for
 * automatic replacement. Owner drafts and every unknown/custom publication
 * are preserved. Publication still runs through the normal CMS revision,
 * receipt, projection, media, and audit protocol rather than mutating the
 * public projection directly.
 */
export async function reconcileVisitorFeedbackCopy(
  database: D1DatabaseLike,
  nowUtcMs = Date.now(),
): Promise<VisitorFeedbackCopyReconciliationResult> {
  const now = parseTimestamp(nowUtcMs);
  const markerEnvelope = await readVisitorFeedbackCopyMarker(database);
  if (!markerEnvelope) return "ready";
  if (markerEnvelope.marker) return "ready";

  const targetSnapshot = phase7StarterPageSnapshot("contact", false);
  const previousSnapshot = previousVisitorFeedbackPageSnapshot();
  const [targetHash, previousHash] = await Promise.all([
    contentHash(targetSnapshot),
    contentHash(previousSnapshot),
  ]);
  const candidate = await readPhase7StarterCopyCandidate(
    database,
    markerEnvelope.organizationId,
    "contact",
    targetHash,
    VISITOR_FEEDBACK_COPY_AUDIT_SOURCE,
  );
  if (!candidate) throw serviceUnavailable();

  let outcome: VisitorFeedbackCopyMarker["outcome"];
  let reason: VisitorFeedbackCopyMarker["reason"];
  let outcomeHash: string | null;
  let notifyOwner = false;
  if (
    candidate.workflowStatus === "published" &&
    candidate.currentDraftHash === targetHash &&
    candidate.publishedHash === targetHash
  ) {
    outcome = "upgraded";
    reason = "already_current";
    outcomeHash = targetHash;
  } else if (
    candidate.entityKey &&
    candidate.workflowStatus === "published" &&
    candidate.currentDraftRevisionId === candidate.publishedRevisionId &&
    candidate.currentDraftHash === previousHash &&
    candidate.publishedHash === previousHash
  ) {
    const draftVersion = await saveRevision(database, candidate.actor, {
      auditMetadata: {
        source: VISITOR_FEEDBACK_COPY_AUDIT_SOURCE,
        targetContentHash: targetHash,
        upgradeVersion: VISITOR_FEEDBACK_COPY_UPGRADE_VERSION,
      },
      entityKey: candidate.entityKey,
      entityType: "page",
      expectedContentVersion: candidate.contentVersion,
      now,
      restoredFromRevisionId: null,
      snapshot: targetSnapshot,
    });
    await publishRevisionForActor(database, candidate.actor, {
      auditMetadata: {
        source: VISITOR_FEEDBACK_COPY_AUDIT_SOURCE,
        targetContentHash: targetHash,
        upgradeVersion: VISITOR_FEEDBACK_COPY_UPGRADE_VERSION,
      },
      entityKey: candidate.entityKey,
      entityType: "page",
      expectedContentVersion: draftVersion,
      now,
    });
    outcome = "upgraded";
    reason = "legacy_copy_upgraded";
    outcomeHash = targetHash;
  } else if (
    candidate.entityKey &&
    candidate.workflowStatus === "published" &&
    candidate.currentDraftRevisionId !== candidate.publishedRevisionId &&
    candidate.currentDraftHash === targetHash &&
    candidate.publishedHash === previousHash &&
    candidate.currentDraftIsUpgrade
  ) {
    await publishRevisionForActor(database, candidate.actor, {
      auditMetadata: {
        resumed: true,
        source: VISITOR_FEEDBACK_COPY_AUDIT_SOURCE,
        targetContentHash: targetHash,
        upgradeVersion: VISITOR_FEEDBACK_COPY_UPGRADE_VERSION,
      },
      entityKey: candidate.entityKey,
      entityType: "page",
      expectedContentVersion: candidate.contentVersion,
      now,
    });
    outcome = "upgraded";
    reason = "legacy_copy_upgraded";
    outcomeHash = targetHash;
  } else if (
    candidate.currentDraftRevisionId !== candidate.publishedRevisionId
  ) {
    outcome = "skipped";
    reason = "newer_draft_preserved";
    outcomeHash = candidate.publishedHash;
    notifyOwner = true;
  } else if (!candidate.entityKey || !candidate.workflowStatus) {
    outcome = "skipped";
    reason = "page_unavailable";
    outcomeHash = null;
  } else {
    outcome = "skipped";
    reason = "nonlegacy_copy_preserved";
    outcomeHash = candidate.publishedHash;
  }

  await recordVisitorFeedbackCopyMarker(database, {
    actor: candidate.actor,
    entityKey: candidate.entityKey,
    markerJson: markerEnvelope.markerJson,
    marker: Object.freeze({
      completedAt: now,
      contentHash: outcomeHash,
      outcome,
      reason,
      version: VISITOR_FEEDBACK_COPY_UPGRADE_VERSION,
    }),
    notifyOwner,
    now,
  });
  return "processed";
}

export async function unpublishCmsEntity(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  entityTypeValue: unknown,
  entityKeyValue: unknown,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<CmsEntityWorkspaceDto> {
  const entityType = parseCmsEntityType(entityTypeValue);
  const allowedRoles =
    entityType === "legal_status"
      ? (["owner"] as const)
      : (["owner", "administrator"] as const);
  const actor = await authorizeMembership(database, identity, { allowedRoles });
  await ensureCmsAdoption(database, actor);
  const entityKey = parseEntityKey(entityKeyValue);
  enforceSingletonKey(entityType, entityKey);
  if (entityType === "site_identity") {
    throw new SafeApplicationError(
      "conflict",
      409,
      "Site identity must remain published so the public shell stays available.",
    );
  }
  const { expectedContentVersion } = parsePublishInput(inputValue);
  const now = parseTimestamp(nowUtcMs);
  const state = await readState(database, actor.organizationId, entityType, entityKey);
  if (!state || state.contentVersion !== expectedContentVersion) {
    throw staleEdit();
  }
  if (
    state.workflowStatus !== "published" ||
    !state.publishedRevisionId
  ) {
    throw staleEdit();
  }
  if (entityType === "page") {
    await assertPageCanUnpublish(
      database,
      actor.organizationId,
      entityKey,
    );
  } else if (entityType === "club_public_profile") {
    await assertClubProfileCanLeavePublic(
      database,
      actor.organizationId,
      entityKey,
      now,
      calendarDateInTimeZone(now, DEFAULT_TIME_ZONE),
    );
  }
  const publishedRevision = await readRevision(
    database,
    actor.organizationId,
    state,
    state.publishedRevisionId,
  );
  if (!publishedRevision) throw serviceUnavailable();
  const publishedMediaGroups = cmsMediaUsageGroups(
    actor.organizationId,
    entityType,
    entityKey,
    publishedRevision.snapshot,
  ).map((group) =>
    Object.freeze({
      entityId: group.entityId,
      entityType: group.entityType,
      usages: Object.freeze([]),
    }),
  );
  const media = prepareCmsMediaReconciliation(
    database,
    actor,
    publishedMediaGroups,
    {
      now,
      publicationScope: "published",
      revisionId: publishedRevision.id,
    },
  );
  const nextContentVersion = expectedContentVersion + 1;
  const projection = unpublicationStatements(
    database,
    actor,
    state,
    now,
  );
  const dependencyGuard =
    entityType === "page"
      ? pageUnpublishDependencyGuard(actor.organizationId, entityKey)
      : entityType === "club_public_profile"
        ? clubProfilePublicationDependencyGuard(
            actor.organizationId,
            entityKey,
            now,
            calendarDateInTimeZone(now, DEFAULT_TIME_ZONE),
          )
        : Object.freeze({
            bindings: Object.freeze([]) as readonly string[],
            sql: "1 = 1",
          });
  const actorGuard = cmsActorGuard(...allowedRoles);
  const stateUpdate = database
    .prepare(
      `UPDATE cms_entity_publication_states
       SET workflow_status = 'unpublished',
           content_version = ?,
           published_revision_id = NULL,
           last_editor_profile_id = ?,
           unpublished_at = ?,
           updated_at = ?
       WHERE id = ?
         AND organization_id = ?
         AND entity_type = ?
         AND entity_key = ?
         AND content_version = ?
         AND workflow_status = 'published'
         AND published_revision_id = ?
         AND (${projection.completion.sql})
         AND (${dependencyGuard.sql})
         AND (
           SELECT count(*)
           FROM media_usage_references AS usage
           WHERE usage.organization_id = ?
             AND usage.publication_scope = 'published'
             AND usage.entity_id = ?
             AND usage.deleted_at IS NULL
         ) = 0
         AND ${actorGuard.sql}`,
    )
    .bind(
      nextContentVersion,
      actor.profileId,
      now,
      now,
      state.id,
      actor.organizationId,
      entityType,
      entityKey,
      expectedContentVersion,
      publishedRevision.id,
      ...projection.completion.bindings,
      ...dependencyGuard.bindings,
      actor.organizationId,
      entityKey,
      ...actorGuard.bindings(actor),
    );
  const audit = auditStatement(database, {
    action: "cms.entity_unpublished",
    actor,
    auditId: crypto.randomUUID(),
    entityId: entityKey,
    entityType,
    contentVersion: nextContentVersion,
    metadata: { contentVersion: nextContentVersion },
    mediaRevisionId: publishedRevision.id,
    mediaScope: "published",
    mediaUsageCount: 0,
    now,
    stateId: state.id,
    workflowStatus: "unpublished",
  });
  const results = await executeCmsBatch(database, [
    ...projection.statements,
    ...media.statements,
    stateUpdate,
    audit,
  ]);
  const stateUpdateIndex =
    projection.statements.length + media.statements.length;
  const auditIndex = stateUpdateIndex + 1;
  if (
    changes(results[stateUpdateIndex]) !== 1 ||
    changes(results[auditIndex]) !== 1 ||
    projection.requiredChanges.some(
      (required) =>
        changes(results[required.index]) !== required.changes,
    ) ||
    media.requiredRelativeChanges.some(
      (required) =>
        changes(
          results[projection.statements.length + required.index],
        ) !== required.changes,
    )
  ) {
    throw staleEdit();
  }
  return readCmsEntityWorkspace(database, identity, entityType, entityKey);
}

export async function archiveCmsClubProfile(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  entityKeyValue: unknown,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<CmsEntityWorkspaceDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  await ensureCmsAdoption(database, actor);
  const entityKey = parseEntityKey(entityKeyValue);
  const { expectedContentVersion } = parsePublishInput(inputValue);
  const state = await readState(
    database,
    actor.organizationId,
    "club_public_profile",
    entityKey,
  );
  if (
    !state ||
    state.contentVersion !== expectedContentVersion ||
    !state.currentDraftRevisionId
  ) {
    throw staleEdit();
  }
  if (
    state.workflowStatus !== "draft" &&
    state.workflowStatus !== "unpublished" &&
    state.workflowStatus !== "published"
  ) {
    throw staleEdit();
  }
  const now = parseTimestamp(nowUtcMs);
  const todayDate = calendarDateInTimeZone(now, DEFAULT_TIME_ZONE);
  await assertClubProfileCanLeavePublic(
    database,
    actor.organizationId,
    entityKey,
    now,
    todayDate,
  );
  const revision = await readRevision(
    database,
    actor.organizationId,
    state,
    state.currentDraftRevisionId,
  );
  if (!revision) throw serviceUnavailable();
  const publishedRevision = state.publishedRevisionId
    ? await readRevision(
        database,
        actor.organizationId,
        state,
        state.publishedRevisionId,
      )
    : null;
  if (state.publishedRevisionId && !publishedRevision) {
    throw serviceUnavailable();
  }
  const draftMediaGroups = cmsMediaUsageGroups(
    actor.organizationId,
    "club_public_profile",
    entityKey,
    revision.snapshot,
  ).map((group) =>
    Object.freeze({
      entityId: group.entityId,
      entityType: group.entityType,
      usages: Object.freeze([]),
    }),
  );
  const draftMedia = prepareCmsMediaReconciliation(
    database,
    actor,
    draftMediaGroups,
    {
      now,
      publicationScope: "draft",
      revisionId: revision.id,
    },
  );
  const publishedMedia = prepareArchivedPublishedMediaRetention(
    database,
    actor,
    state.publishedRevisionId && publishedRevision
      ? cmsMediaUsageGroups(
          actor.organizationId,
          "club_public_profile",
          entityKey,
          publishedRevision.snapshot,
        )
      : Object.freeze([]),
    {
      entityId: entityKey,
      entityType: "club_public_profile",
      now,
      revisionId: state.publishedRevisionId,
    },
  );
  const actorGuard = cmsActorGuard("owner", "administrator");
  const projectionGuardSql = projectionGuard(
    state,
    actor,
    revision.id,
  );
  const dependencyGuard = clubProfilePublicationDependencyGuard(
    actor.organizationId,
    entityKey,
    now,
    todayDate,
  );
  const nextContentVersion = expectedContentVersion + 1;
  const projection = database
    .prepare(
      `UPDATE club_public_profiles
       SET publication_status = 'archived',
           updated_at = ?
       WHERE club_id = ?
         AND organization_id = ?
         AND publication_status = CASE
               WHEN ? = 'published' THEN 'published'
               ELSE 'draft'
             END
         AND deleted_at IS NULL
         AND ${projectionGuardSql.sql}
         AND (${dependencyGuard.sql})`,
    )
    .bind(
      now,
      entityKey,
      actor.organizationId,
      state.workflowStatus,
      ...projectionGuardSql.bindings,
      ...dependencyGuard.bindings,
    );
  const stateUpdate = database
    .prepare(
      `UPDATE cms_entity_publication_states
       SET workflow_status = 'archived',
           content_version = ?,
           last_editor_profile_id = ?,
           unpublished_at = COALESCE(unpublished_at, ?),
           updated_at = ?
       WHERE id = ?
         AND organization_id = ?
         AND entity_type = 'club_public_profile'
         AND entity_key = ?
         AND content_version = ?
         AND workflow_status = ?
         AND current_draft_revision_id = ?
         AND published_revision_id IS ?
         AND EXISTS (
           SELECT 1
           FROM club_public_profiles AS profile
           WHERE profile.club_id =
                 cms_entity_publication_states.entity_key
             AND profile.organization_id =
                 cms_entity_publication_states.organization_id
             AND profile.publication_status = 'archived'
             AND (
               (? = 'published' AND profile.published_at IS NOT NULL)
               OR (? <> 'published' AND profile.published_at IS NULL)
             )
             AND profile.deleted_at IS NULL
         )
         AND (${dependencyGuard.sql})
         AND (
           SELECT count(*)
           FROM media_usage_references AS usage
           WHERE usage.organization_id = ?
             AND usage.entity_type = 'club_public_profile'
             AND usage.entity_id = ?
             AND usage.publication_scope = 'draft'
             AND usage.deleted_at IS NULL
         ) = 0
         AND (${publishedMedia.integrity.sql})
         AND ${actorGuard.sql}`,
    )
    .bind(
      nextContentVersion,
      actor.profileId,
      now,
      now,
      state.id,
      actor.organizationId,
      entityKey,
      expectedContentVersion,
      state.workflowStatus,
      revision.id,
      state.publishedRevisionId,
      state.workflowStatus,
      state.workflowStatus,
      ...dependencyGuard.bindings,
      actor.organizationId,
      entityKey,
      ...publishedMedia.integrity.bindings,
      ...actorGuard.bindings(actor),
    );
  const audit = auditStatement(database, {
    action: "cms.club_profile_archived",
    actor,
    auditId: crypto.randomUUID(),
    contentVersion: nextContentVersion,
    entityId: entityKey,
    entityType: "club_public_profile",
    metadata: { contentVersion: nextContentVersion },
    now,
    ...(state.publishedRevisionId
      ? { publishedRevisionId: state.publishedRevisionId }
      : {}),
    stateId: state.id,
    workflowStatus: "archived",
  });
  const results = await executeCmsBatch(database, [
    projection,
    ...draftMedia.statements,
    publishedMedia.retirementStatement,
    stateUpdate,
    audit,
  ]);
  const stateUpdateIndex =
    2 + draftMedia.statements.length;
  const auditIndex = stateUpdateIndex + 1;
  if (
    changes(results[0]) !== 1 ||
    changes(results[stateUpdateIndex]) !== 1 ||
    changes(results[auditIndex]) !== 1 ||
    draftMedia.requiredRelativeChanges.some(
      (required) =>
        changes(results[1 + required.index]) !== required.changes,
    )
  ) {
    throw staleEdit();
  }
  return readCmsEntityWorkspace(
    database,
    identity,
    "club_public_profile",
    entityKey,
  );
}

export async function archiveCmsProgramProfile(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  entityKeyValue: unknown,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<CmsEntityWorkspaceDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  await ensureCmsAdoption(database, actor);
  const entityKey = parseEntityKey(entityKeyValue);
  const { expectedContentVersion } = parsePublishInput(inputValue);
  const state = await readState(
    database,
    actor.organizationId,
    "program_public_profile",
    entityKey,
  );
  if (
    !state ||
    state.contentVersion !== expectedContentVersion ||
    !state.currentDraftRevisionId ||
    !["draft", "unpublished", "published"].includes(state.workflowStatus)
  ) {
    throw staleEdit();
  }
  const now = parseTimestamp(nowUtcMs);
  const todayDate = calendarDateInTimeZone(now, DEFAULT_TIME_ZONE);
  await assertProgramProfileCanArchive(
    database,
    actor.organizationId,
    entityKey,
    now,
    todayDate,
  );
  const revision = await readRevision(
    database,
    actor.organizationId,
    state,
    state.currentDraftRevisionId,
  );
  if (!revision) throw serviceUnavailable();
  const publishedRevision = state.publishedRevisionId
    ? await readRevision(
        database,
        actor.organizationId,
        state,
        state.publishedRevisionId,
      )
    : null;
  if (state.publishedRevisionId && !publishedRevision) {
    throw serviceUnavailable();
  }
  const draftMediaGroups = cmsMediaUsageGroups(
    actor.organizationId,
    "program_public_profile",
    entityKey,
    revision.snapshot,
  ).map((group) =>
    Object.freeze({
      entityId: group.entityId,
      entityType: group.entityType,
      usages: Object.freeze([]),
    }),
  );
  const draftMedia = prepareCmsMediaReconciliation(
    database,
    actor,
    draftMediaGroups,
    {
      now,
      publicationScope: "draft",
      revisionId: revision.id,
    },
  );
  const publishedMedia = prepareArchivedPublishedMediaRetention(
    database,
    actor,
    state.publishedRevisionId && publishedRevision
      ? cmsMediaUsageGroups(
          actor.organizationId,
          "program_public_profile",
          entityKey,
          publishedRevision.snapshot,
        )
      : Object.freeze([]),
    {
      entityId: entityKey,
      entityType: "program_public_profile",
      now,
      revisionId: state.publishedRevisionId,
    },
  );
  const actorGuard = cmsActorGuard("owner", "administrator");
  const currentProjectionGuard = projectionGuard(state, actor, revision.id);
  const dependencyGuard = programProfileArchiveDependencyGuard(
    actor.organizationId,
    entityKey,
    now,
    todayDate,
  );
  const nextContentVersion = expectedContentVersion + 1;
  const projection =
    state.publishedRevisionId !== null
      ? database
          .prepare(
            `UPDATE program_public_profile_details
             SET publication_status = 'archived',
                 updated_by_profile_id = ?,
                 updated_at = ?
             WHERE program_id = ?
               AND organization_id = ?
               AND publication_status = CASE
                     WHEN ? = 'published' THEN 'published'
                     ELSE 'draft'
                   END
               AND published_at IS NOT NULL
               AND deleted_at IS NULL
               AND ${currentProjectionGuard.sql}
               AND (${dependencyGuard.sql})`,
          )
          .bind(
            actor.profileId,
            now,
            entityKey,
            actor.organizationId,
            state.workflowStatus,
            ...currentProjectionGuard.bindings,
            ...dependencyGuard.bindings,
          )
      : (() => {
          const snapshot =
            revision.snapshot as CmsProgramProfileSnapshot;
          return database
            .prepare(
              `INSERT INTO program_public_profile_details (
                 program_id, organization_id, club_id,
                 primary_event_lane_id, publication_status, is_featured,
                 display_order, public_display_name, public_slug,
                 short_summary, full_description, program_type,
                 public_group_url, cover_media_asset_id,
                 thumbnail_media_asset_id, theme_color,
                 participant_expectations, preparation_information,
                 typical_format, confirmed_social_links_json,
                 related_resources_json, seo_title, meta_description,
                 og_media_asset_id, updated_by_profile_id, published_at,
                 created_at, updated_at, deleted_at
               )
               SELECT ?, ?, ?, ?, 'archived', ?, ?, ?, ?, ?, ?, ?, ?,
                      NULL, NULL, ?, ?, ?, ?, '[]', '[]', ?, ?, NULL, ?,
                      NULL, ?, ?, NULL
               WHERE ${currentProjectionGuard.sql}
                 AND (${dependencyGuard.sql})
                 AND EXISTS (
                   SELECT 1
                   FROM programs AS program
                   JOIN clubs AS club
                     ON club.id = program.club_id
                    AND club.organization_id = program.organization_id
                    AND club.deleted_at IS NULL
                   JOIN event_lanes AS lane
                     ON lane.id = ?
                    AND lane.organization_id = program.organization_id
                    AND lane.deleted_at IS NULL
                   WHERE program.id = ?
                     AND program.organization_id = ?
                     AND program.club_id = ?
                     AND program.deleted_at IS NULL
                 )
               ON CONFLICT(program_id) DO UPDATE SET
                 primary_event_lane_id =
                     excluded.primary_event_lane_id,
                 publication_status = 'archived',
                 is_featured = excluded.is_featured,
                 display_order = excluded.display_order,
                 public_display_name = excluded.public_display_name,
                 public_slug = excluded.public_slug,
                 short_summary = excluded.short_summary,
                 full_description = excluded.full_description,
                 program_type = excluded.program_type,
                 public_group_url = excluded.public_group_url,
                 cover_media_asset_id = NULL,
                 thumbnail_media_asset_id = NULL,
                 theme_color = excluded.theme_color,
                 participant_expectations =
                     excluded.participant_expectations,
                 preparation_information =
                     excluded.preparation_information,
                 typical_format = excluded.typical_format,
                 confirmed_social_links_json = '[]',
                 related_resources_json = '[]',
                 seo_title = excluded.seo_title,
                 meta_description = excluded.meta_description,
                 og_media_asset_id = NULL,
                 updated_by_profile_id =
                     excluded.updated_by_profile_id,
                 published_at = NULL,
                 updated_at = excluded.updated_at,
                 deleted_at = NULL
               WHERE program_public_profile_details.organization_id =
                     excluded.organization_id
                 AND program_public_profile_details.published_at IS NULL`,
            )
            .bind(
              entityKey,
              actor.organizationId,
              snapshot.clubId,
              snapshot.laneId,
              snapshot.featured ? 1 : 0,
              snapshot.displayOrder,
              snapshot.name,
              snapshot.slug,
              snapshot.summary,
              snapshot.description,
              snapshot.programType,
              snapshot.meetupGroupUrl,
              snapshot.themeColor,
              snapshot.whatToExpect,
              snapshot.preparation,
              snapshot.typicalFormat,
              snapshot.seoTitle,
              snapshot.metaDescription,
              actor.profileId,
              now,
              now,
              ...currentProjectionGuard.bindings,
              ...dependencyGuard.bindings,
              snapshot.laneId,
              entityKey,
              actor.organizationId,
              snapshot.clubId,
            );
        })();
  const stateUpdate = database
    .prepare(
      `UPDATE cms_entity_publication_states
       SET workflow_status = 'archived',
           content_version = ?,
           last_editor_profile_id = ?,
           unpublished_at = COALESCE(unpublished_at, ?),
           updated_at = ?
       WHERE id = ?
         AND organization_id = ?
         AND entity_type = 'program_public_profile'
         AND entity_key = ?
         AND content_version = ?
         AND workflow_status = ?
         AND current_draft_revision_id = ?
         AND published_revision_id IS ?
         AND EXISTS (
           SELECT 1
           FROM program_public_profile_details AS detail
           WHERE detail.program_id =
                 cms_entity_publication_states.entity_key
             AND detail.organization_id =
                 cms_entity_publication_states.organization_id
             AND detail.publication_status = 'archived'
             AND (
               (? = 'published' AND detail.published_at IS NOT NULL)
               OR (? <> 'published' AND detail.published_at IS NULL)
             )
             AND detail.deleted_at IS NULL
         )
         AND (${dependencyGuard.sql})
         AND (
           SELECT count(*)
           FROM media_usage_references AS usage
           WHERE usage.organization_id = ?
             AND usage.entity_type = 'program_public_profile'
             AND usage.entity_id = ?
             AND usage.publication_scope = 'draft'
             AND usage.deleted_at IS NULL
         ) = 0
         AND (${publishedMedia.integrity.sql})
         AND ${actorGuard.sql}`,
    )
    .bind(
      nextContentVersion,
      actor.profileId,
      now,
      now,
      state.id,
      actor.organizationId,
      entityKey,
      expectedContentVersion,
      state.workflowStatus,
      revision.id,
      state.publishedRevisionId,
      state.workflowStatus,
      state.workflowStatus,
      ...dependencyGuard.bindings,
      actor.organizationId,
      entityKey,
      ...publishedMedia.integrity.bindings,
      ...actorGuard.bindings(actor),
    );
  const audit = auditStatement(database, {
    action: "cms.program_profile_archived",
    actor,
    auditId: crypto.randomUUID(),
    contentVersion: nextContentVersion,
    entityId: entityKey,
    entityType: "program_public_profile",
    metadata: { contentVersion: nextContentVersion },
    now,
    ...(state.publishedRevisionId
      ? { publishedRevisionId: state.publishedRevisionId }
      : {}),
    stateId: state.id,
    workflowStatus: "archived",
  });
  const results = await executeCmsBatch(database, [
    projection,
    ...draftMedia.statements,
    publishedMedia.retirementStatement,
    stateUpdate,
    audit,
  ]);
  const stateUpdateIndex =
    2 + draftMedia.statements.length;
  const auditIndex = stateUpdateIndex + 1;
  if (
    changes(results[0]) !== 1 ||
    changes(results[stateUpdateIndex]) !== 1 ||
    changes(results[auditIndex]) !== 1 ||
    draftMedia.requiredRelativeChanges.some(
      (required) =>
        changes(results[1 + required.index]) !== required.changes,
    )
  ) {
    throw staleEdit();
  }
  return readCmsEntityWorkspace(
    database,
    identity,
    "program_public_profile",
    entityKey,
  );
}

export async function safeDeleteCmsProgramProfile(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  entityKeyValue: unknown,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<Readonly<{ deleted: true }>> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  await ensureCmsAdoption(database, actor);
  const entityKey = parseEntityKey(entityKeyValue);
  const { expectedContentVersion } = parsePublishInput(inputValue);
  const state = await readState(
    database,
    actor.organizationId,
    "program_public_profile",
    entityKey,
  );
  if (
    !state ||
    state.contentVersion !== expectedContentVersion ||
    state.workflowStatus !== "archived" ||
    state.publishedRevisionId !== null
  ) {
    throw staleEdit();
  }
  const now = parseTimestamp(nowUtcMs);
  await assertProgramProfileCanDelete(
    database,
    actor.organizationId,
    entityKey,
  );
  const dependencyGuard = programProfileDeleteDependencyGuard(
    actor.organizationId,
    entityKey,
  );
  const actorGuard = cmsActorGuard("owner", "administrator");
  const nextContentVersion = expectedContentVersion + 1;
  const detailDelete = database
    .prepare(
      `UPDATE program_public_profile_details
       SET deleted_at = ?, updated_by_profile_id = ?, updated_at = ?
       WHERE program_id = ?
         AND organization_id = ?
         AND publication_status = 'archived'
         AND published_at IS NULL
         AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM cms_entity_publication_states AS state
           WHERE state.id = ?
             AND state.organization_id =
                 program_public_profile_details.organization_id
             AND state.entity_type = 'program_public_profile'
             AND state.entity_key =
                 program_public_profile_details.program_id
             AND state.workflow_status = 'archived'
             AND state.content_version = ?
             AND state.current_draft_revision_id IS ?
             AND state.published_revision_id IS NULL
         )
         AND (${dependencyGuard.sql})
         AND ${actorGuard.sql}`,
    )
    .bind(
      now,
      actor.profileId,
      now,
      entityKey,
      actor.organizationId,
      state.id,
      expectedContentVersion,
      state.currentDraftRevisionId,
      ...dependencyGuard.bindings,
      ...actorGuard.bindings(actor),
    );
  const retireMedia = database
    .prepare(
      `UPDATE media_usage_references
       SET deleted_at = ?
       WHERE organization_id = ?
         AND entity_type = 'program_public_profile'
         AND entity_id = ?
         AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM program_public_profile_details AS detail
           WHERE detail.program_id =
                 media_usage_references.entity_id
             AND detail.organization_id =
                 media_usage_references.organization_id
             AND detail.publication_status = 'archived'
             AND detail.published_at IS NULL
             AND detail.deleted_at = ?
         )
         AND ${actorGuard.sql}`,
    )
    .bind(
      now,
      actor.organizationId,
      entityKey,
      now,
      ...actorGuard.bindings(actor),
    );
  const programDelete = database
    .prepare(
      `UPDATE programs
       SET deleted_at = ?, updated_at = ?
       WHERE id = ?
         AND organization_id = ?
         AND deleted_at IS NULL
         AND (${dependencyGuard.sql})
         AND EXISTS (
           SELECT 1
           FROM cms_entity_publication_states AS state
           JOIN program_public_profile_details AS detail
             ON detail.program_id = state.entity_key
             AND detail.organization_id = state.organization_id
             AND detail.publication_status = 'archived'
             AND detail.published_at IS NULL
             AND detail.deleted_at = ?
           WHERE state.id = ?
             AND state.organization_id = programs.organization_id
             AND state.entity_type = 'program_public_profile'
             AND state.entity_key = programs.id
             AND state.workflow_status = 'archived'
             AND state.content_version = ?
             AND state.current_draft_revision_id IS ?
             AND state.published_revision_id IS ?
         )
         AND ${actorGuard.sql}`,
    )
    .bind(
      now,
      now,
      entityKey,
      actor.organizationId,
      ...dependencyGuard.bindings,
      now,
      state.id,
      expectedContentVersion,
      state.currentDraftRevisionId,
      state.publishedRevisionId,
      ...actorGuard.bindings(actor),
    );
  const retireRedirects = database
    .prepare(
      `UPDATE public_slug_redirects
       SET state = 'superseded', updated_at = ?, retired_at = ?
       WHERE organization_id = ?
         AND entity_type = 'program_public_profile'
         AND entity_id = ?
         AND state = 'active'
         AND EXISTS (
           SELECT 1
           FROM programs AS program
           WHERE program.id = public_slug_redirects.entity_id
             AND program.organization_id =
                 public_slug_redirects.organization_id
             AND program.deleted_at = ?
         )`,
    )
    .bind(
      now,
      now,
      actor.organizationId,
      entityKey,
      now,
    );
  const stateUpdate = database
    .prepare(
      `UPDATE cms_entity_publication_states
       SET content_version = ?,
           last_editor_profile_id = ?,
           updated_at = ?
       WHERE id = ?
         AND organization_id = ?
         AND entity_type = 'program_public_profile'
         AND entity_key = ?
         AND workflow_status = 'archived'
         AND content_version = ?
         AND current_draft_revision_id IS ?
         AND published_revision_id IS ?
         AND EXISTS (
           SELECT 1
           FROM programs AS program
           JOIN program_public_profile_details AS detail
             ON detail.program_id = program.id
            AND detail.organization_id = program.organization_id
            AND detail.publication_status = 'archived'
            AND detail.published_at IS NULL
            AND detail.deleted_at = ?
           WHERE program.id =
                 cms_entity_publication_states.entity_key
             AND program.organization_id =
                 cms_entity_publication_states.organization_id
             AND program.deleted_at = ?
         )
         AND (${dependencyGuard.sql})
         AND (
           SELECT count(*)
           FROM media_usage_references AS usage
           WHERE usage.organization_id = ?
             AND usage.entity_type = 'program_public_profile'
             AND usage.entity_id = ?
             AND usage.deleted_at IS NULL
         ) = 0
         AND ${actorGuard.sql}`,
    )
    .bind(
      nextContentVersion,
      actor.profileId,
      now,
      state.id,
      actor.organizationId,
      entityKey,
      expectedContentVersion,
      state.currentDraftRevisionId,
      state.publishedRevisionId,
      now,
      now,
      ...dependencyGuard.bindings,
      actor.organizationId,
      entityKey,
      ...actorGuard.bindings(actor),
    );
  const audit = auditStatement(database, {
    action: "cms.program_profile_deleted",
    actor,
    auditId: crypto.randomUUID(),
    completion: Object.freeze({
      bindings: Object.freeze([
        actor.organizationId,
        entityKey,
        now,
      ]),
      sql: `EXISTS (
        SELECT 1
        FROM programs AS program
        WHERE program.organization_id = ?
          AND program.id = ?
          AND program.deleted_at = ?
      )`,
    }),
    contentVersion: nextContentVersion,
    entityId: entityKey,
    entityType: "program_public_profile",
    metadata: { contentVersion: nextContentVersion },
    now,
    ...(state.publishedRevisionId
      ? { publishedRevisionId: state.publishedRevisionId }
      : {}),
    stateId: state.id,
    workflowStatus: "archived",
  });
  const results = await executeCmsBatch(database, [
    detailDelete,
    retireMedia,
    programDelete,
    retireRedirects,
    stateUpdate,
    audit,
  ]);
  if (
    changes(results[0]) !== 1 ||
    changes(results[2]) !== 1 ||
    changes(results[4]) !== 1 ||
    changes(results[5]) !== 1
  ) {
    throw staleEdit();
  }
  return Object.freeze({ deleted: true as const });
}

export async function confirmCmsLegalStatus(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<CmsEntityWorkspaceDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner"],
  });
  await ensureCmsAdoption(database, actor);
  const { expectedContentVersion } = parsePublishInput(inputValue);
  const entityKey = SINGLETON_ENTITY_KEYS.legal_status;
  const state = await readState(
    database,
    actor.organizationId,
    "legal_status",
    entityKey,
  );
  if (
    !state ||
    state.contentVersion !== expectedContentVersion ||
    !state.currentDraftRevisionId
  ) {
    throw staleEdit();
  }
  const revision = await readRevision(
    database,
    actor.organizationId,
    state,
    state.currentDraftRevisionId,
  );
  if (!revision) throw serviceUnavailable();
  assertLegalStatusSnapshotCoherent(
    revision.snapshot as CmsLegalStatusSnapshot,
  );
  const now = parseTimestamp(nowUtcMs);
  const receiptId = crypto.randomUUID();
  const actorGuard = cmsActorGuard("owner");
  const results = await executeCmsBatch(database, [
    database
      .prepare(
        `INSERT INTO legal_status_confirmation_receipts (
           id, organization_id, revision_id, revision_hash, action,
           actor_profile_id, revokes_receipt_id, created_at
         )
         SELECT ?, state.organization_id, revision.id, revision.content_hash,
                'confirmed', ?, NULL, ?
         FROM cms_entity_publication_states AS state
         JOIN cms_entity_revisions AS revision
           ON revision.id = state.current_draft_revision_id
          AND revision.publication_state_id = state.id
          AND revision.organization_id = state.organization_id
         WHERE state.id = ?
           AND state.organization_id = ?
           AND state.entity_type = 'legal_status'
           AND state.entity_key = ?
           AND state.content_version = ?
           AND revision.id = ?
           AND revision.content_hash = ?
           AND ${actorGuard.sql}
           AND NOT EXISTS (
             SELECT 1
             FROM legal_status_confirmation_receipts AS prior
             WHERE prior.organization_id = state.organization_id
               AND prior.revision_id = revision.id
               AND prior.action = 'confirmed'
           )`,
      )
      .bind(
        receiptId,
        actor.profileId,
        now,
        state.id,
        actor.organizationId,
        entityKey,
        expectedContentVersion,
        revision.id,
        revision.contentHash,
        ...actorGuard.bindings(actor),
      ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action, entity_type,
           entity_id, metadata_json, created_at
         )
         SELECT ?, ?, ?, 'cms.legal_status_confirmed', 'legal_status', ?,
                ?, ?
         WHERE EXISTS (
           SELECT 1
           FROM legal_status_confirmation_receipts
           WHERE id = ?
             AND organization_id = ?
             AND revision_id = ?
             AND revision_hash = ?
             AND action = 'confirmed'
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        entityKey,
        JSON.stringify({
          contentVersion: expectedContentVersion,
          revisionNumber: revision.revisionNumber,
        }),
        now,
        receiptId,
        actor.organizationId,
        revision.id,
        revision.contentHash,
      ),
  ]);
  requireExactChanges(results, [1, 1], "confirm");
  return readCmsEntityWorkspace(
    database,
    identity,
    "legal_status",
    entityKey,
  );
}

export async function revokeCmsLegalStatus(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<CmsEntityWorkspaceDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner"],
  });
  await ensureCmsAdoption(database, actor);
  const { expectedContentVersion } = parsePublishInput(inputValue);
  const entityKey = SINGLETON_ENTITY_KEYS.legal_status;
  const state = await readState(
    database,
    actor.organizationId,
    "legal_status",
    entityKey,
  );
  if (!state || state.contentVersion !== expectedContentVersion) {
    throw staleEdit();
  }
  const revisionId =
    state.workflowStatus === "published"
      ? state.publishedRevisionId
      : state.currentDraftRevisionId;
  if (!revisionId) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "No confirmed legal-status revision is available to revoke.",
    );
  }
  const revision = await readRevision(
    database,
    actor.organizationId,
    state,
    revisionId,
  );
  if (!revision) throw serviceUnavailable();
  const confirmation = await database
    .prepare(
      `SELECT confirmation.id
       FROM legal_status_confirmation_receipts AS confirmation
       WHERE confirmation.organization_id = ?
         AND confirmation.revision_id = ?
         AND confirmation.revision_hash = ?
         AND confirmation.action = 'confirmed'
         AND NOT EXISTS (
           SELECT 1
           FROM legal_status_confirmation_receipts AS revocation
           WHERE revocation.organization_id = confirmation.organization_id
             AND revocation.action = 'revoked'
             AND revocation.revokes_receipt_id = confirmation.id
         )
       LIMIT 1`,
    )
    .bind(actor.organizationId, revision.id, revision.contentHash)
    .first<Record<string, unknown>>();
  if (!confirmation) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "The legal-status confirmation is no longer active.",
    );
  }
  const confirmationId = requiredString(confirmation.id);
  const now = parseTimestamp(nowUtcMs);
  const receiptId = crypto.randomUUID();
  const actorGuard = cmsActorGuard("owner");
  const wasPublished = state.workflowStatus === "published";
  const resultingContentVersion = wasPublished
    ? expectedContentVersion + 1
    : expectedContentVersion;
  const statements: D1PreparedStatementLike[] = [
    database
      .prepare(
        `INSERT INTO legal_status_confirmation_receipts (
           id, organization_id, revision_id, revision_hash, action,
           actor_profile_id, revokes_receipt_id, created_at
         )
         SELECT ?, ?, ?, ?, 'revoked', ?, ?, ?
         WHERE ${actorGuard.sql}
           AND EXISTS (
             SELECT 1
             FROM cms_entity_publication_states AS state
             WHERE state.id = ?
               AND state.organization_id = ?
               AND state.entity_type = 'legal_status'
               AND state.entity_key = ?
               AND state.content_version = ?
               AND state.workflow_status = ?
               AND state.current_draft_revision_id IS ?
               AND state.published_revision_id IS ?
           )
           AND EXISTS (
             SELECT 1
             FROM legal_status_confirmation_receipts AS confirmation
             WHERE confirmation.id = ?
               AND confirmation.organization_id = ?
               AND confirmation.revision_id = ?
               AND confirmation.revision_hash = ?
               AND confirmation.action = 'confirmed'
               AND NOT EXISTS (
                 SELECT 1
                 FROM legal_status_confirmation_receipts AS prior_revocation
                 WHERE prior_revocation.organization_id =
                       confirmation.organization_id
                   AND prior_revocation.action = 'revoked'
                   AND prior_revocation.revokes_receipt_id = confirmation.id
               )
           )`,
      )
      .bind(
        receiptId,
        actor.organizationId,
        revision.id,
        revision.contentHash,
        actor.profileId,
        confirmationId,
        now,
        ...actorGuard.bindings(actor),
        state.id,
        actor.organizationId,
        entityKey,
        expectedContentVersion,
        state.workflowStatus,
        state.currentDraftRevisionId,
        state.publishedRevisionId,
        confirmationId,
        actor.organizationId,
        revision.id,
        revision.contentHash,
      ),
  ];
  if (wasPublished) {
    statements.push(
      database
        .prepare(
          `UPDATE site_settings
           SET is_public = 0, updated_by_profile_id = ?, updated_at = ?
           WHERE organization_id = ?
             AND key = ?
             AND is_public = 1
             AND EXISTS (
               SELECT 1
               FROM cms_entity_publication_states AS state
               WHERE state.id = ?
                 AND state.organization_id = ?
                 AND state.entity_type = 'legal_status'
                 AND state.entity_key = ?
                 AND state.content_version = ?
                 AND state.workflow_status = 'published'
                 AND state.current_draft_revision_id IS ?
                 AND state.published_revision_id = ?
             )
             AND EXISTS (
               SELECT 1
               FROM legal_status_confirmation_receipts
               WHERE id = ?
                 AND organization_id = ?
                 AND action = 'revoked'
             )`,
        )
        .bind(
          actor.profileId,
          now,
          actor.organizationId,
          PUBLIC_LEGAL_SETTING_KEY,
          state.id,
          actor.organizationId,
          entityKey,
          expectedContentVersion,
          state.currentDraftRevisionId,
          revision.id,
          receiptId,
          actor.organizationId,
        ),
      database
        .prepare(
          `UPDATE cms_entity_publication_states
           SET workflow_status = 'unpublished',
               content_version = ?,
               published_revision_id = NULL,
               last_editor_profile_id = ?,
               unpublished_at = ?,
               updated_at = ?
           WHERE id = ?
             AND organization_id = ?
             AND entity_type = 'legal_status'
             AND entity_key = ?
             AND content_version = ?
             AND workflow_status = 'published'
             AND current_draft_revision_id IS ?
             AND published_revision_id = ?
             AND ${actorGuard.sql}
             AND EXISTS (
               SELECT 1
               FROM legal_status_confirmation_receipts
               WHERE id = ?
                 AND organization_id = ?
                 AND action = 'revoked'
             )`,
        )
        .bind(
          resultingContentVersion,
          actor.profileId,
          now,
          now,
          state.id,
          actor.organizationId,
          entityKey,
          expectedContentVersion,
          state.currentDraftRevisionId,
          revision.id,
          ...actorGuard.bindings(actor),
          receiptId,
          actor.organizationId,
        ),
    );
  }
  statements.push(
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action, entity_type,
           entity_id, metadata_json, created_at
         )
         VALUES (
           ?, ?, ?,
           CASE WHEN
             EXISTS (
               SELECT 1
               FROM legal_status_confirmation_receipts AS revocation
               WHERE revocation.id = ?
                 AND revocation.organization_id = ?
                 AND revocation.revision_id = ?
                 AND revocation.revision_hash = ?
                 AND revocation.action = 'revoked'
                 AND revocation.revokes_receipt_id = ?
             )
             AND EXISTS (
               SELECT 1
               FROM cms_entity_publication_states AS state
               WHERE state.id = ?
                 AND state.organization_id = ?
                 AND state.entity_type = 'legal_status'
                 AND state.entity_key = ?
                 AND state.content_version = ?
                 AND state.workflow_status = ?
                 AND state.current_draft_revision_id IS ?
                 AND state.published_revision_id IS ?
             )
             ${
               wasPublished
                 ? `AND EXISTS (
                   SELECT 1
                   FROM site_settings AS setting
                   WHERE setting.organization_id = ?
                     AND setting.key = ?
                     AND setting.is_public = 0
                 )`
                 : ""
             }
           THEN 'cms.legal_status_revoked'
           ELSE NULL
           END,
           'legal_status', ?, ?, ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        receiptId,
        actor.organizationId,
        revision.id,
        revision.contentHash,
        confirmationId,
        state.id,
        actor.organizationId,
        entityKey,
        resultingContentVersion,
        wasPublished ? "unpublished" : state.workflowStatus,
        state.currentDraftRevisionId,
        wasPublished ? null : state.publishedRevisionId,
        ...(wasPublished
          ? [actor.organizationId, PUBLIC_LEGAL_SETTING_KEY]
          : []),
        entityKey,
        JSON.stringify({
          contentVersion: resultingContentVersion,
          unpublished: wasPublished,
        }),
        now,
      ),
  );
  const results = await executeCmsBatch(database, statements);
  if (
    changes(results[0]) !== 1 ||
    changes(results.at(-1)) !== 1 ||
    (wasPublished &&
      (changes(results[1]) !== 1 || changes(results[2]) !== 1))
  ) {
    throw staleEdit();
  }
  return readCmsEntityWorkspace(
    database,
    identity,
    "legal_status",
    entityKey,
  );
}

async function saveRevision(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  input: Readonly<{
    auditMetadata?: Readonly<Record<string, boolean | number | string>>;
    entityKey: string;
    entityType: CmsEntityType;
    expectedContentVersion: number;
    now: number;
    restoredFromRevisionId: string | null;
    snapshot: CmsSnapshot;
  }>,
): Promise<number> {
  const state = await readState(
    database,
    actor.organizationId,
    input.entityType,
    input.entityKey,
  );
  if (!state || state.contentVersion !== input.expectedContentVersion) {
    throw staleEdit();
  }
  if (
    (
      state.entityType === "club_public_profile" ||
      state.entityType === "program_public_profile"
    ) &&
    state.workflowStatus === "archived"
  ) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "Archived club profiles retain their history but cannot be edited or restored.",
    );
  }
  if (input.entityType === "page") {
    await assertPageSlugMutationAllowed(
      database,
      actor.organizationId,
      input.entityKey,
      (input.snapshot as CmsPageSnapshot).slug,
    );
  }
  if (input.entityType === "club_public_profile") {
    await validateClubSnapshotReferences(
      database,
      actor.organizationId,
      input.entityKey,
      input.snapshot as CmsClubProfileSnapshot,
    );
  }
  if (input.entityType === "program_public_profile") {
    await validateProgramSnapshotReferences(
      database,
      actor.organizationId,
      input.entityKey,
      input.snapshot as CmsProgramProfileSnapshot,
    );
  }
  const revisionId = crypto.randomUUID();
  const nextVersion = input.expectedContentVersion + 1;
  const snapshotJson = canonicalJson(input.snapshot);
  const hash = await contentHash(input.snapshot);
  const mediaGroups = cmsMediaUsageGroups(
    actor.organizationId,
    input.entityType,
    input.entityKey,
    input.snapshot,
  );
  await validateCmsMediaUsageGroups(
    database,
    actor.organizationId,
    mediaGroups,
    "draft",
  );
  const media = prepareCmsMediaReconciliation(database, actor, mediaGroups, {
    now: input.now,
    publicationScope: "draft",
    revisionId,
  });
  const actorGuard = cmsActorGuard("owner", "administrator");
  const results = await executeCmsBatch(database, [
    database
      .prepare(
        `INSERT INTO cms_entity_revisions (
           id, organization_id, publication_state_id, entity_type, entity_key,
           revision_number, snapshot_json, content_hash, canonical_byte_size,
           restored_from_revision_id, legacy_page_revision_id,
           actor_profile_id, created_at
         )
         SELECT ?, state.organization_id, state.id, state.entity_type,
                state.entity_key, ?, ?, ?, ?, ?, NULL, ?, ?
         FROM cms_entity_publication_states AS state
         WHERE state.id = ?
           AND state.organization_id = ?
           AND state.entity_type = ?
           AND state.entity_key = ?
           AND state.content_version = ?
           AND ${actorGuard.sql}
           AND (
             ? IS NULL OR EXISTS (
               SELECT 1
               FROM cms_entity_revisions AS restored
               WHERE restored.id = ?
                 AND restored.publication_state_id = state.id
                 AND restored.organization_id = state.organization_id
             )
           )`,
      )
      .bind(
        revisionId,
        nextVersion,
        snapshotJson,
        hash,
        utf8Size(snapshotJson),
        input.restoredFromRevisionId,
        actor.profileId,
        input.now,
        state.id,
        actor.organizationId,
        input.entityType,
        input.entityKey,
        input.expectedContentVersion,
        ...actorGuard.bindings(actor),
        input.restoredFromRevisionId,
        input.restoredFromRevisionId,
      ),
    ...media.statements,
    database
      .prepare(
        `UPDATE cms_entity_publication_states
         SET workflow_status =
               CASE WHEN workflow_status = 'archived' THEN 'draft'
                    ELSE workflow_status END,
             content_version = ?,
             current_draft_revision_id = ?,
             last_editor_profile_id = ?,
             draft_updated_at = ?,
             updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND entity_type = ?
           AND entity_key = ?
           AND content_version = ?
           AND EXISTS (
             SELECT 1
             FROM cms_entity_revisions AS revision
             WHERE revision.id = ?
               AND revision.publication_state_id =
                   cms_entity_publication_states.id
               AND revision.organization_id =
                   cms_entity_publication_states.organization_id
               AND revision.revision_number = ?
           )
           AND ${actorGuard.sql}`,
      )
      .bind(
        nextVersion,
        revisionId,
        actor.profileId,
        input.now,
        input.now,
        state.id,
        actor.organizationId,
        input.entityType,
        input.entityKey,
        input.expectedContentVersion,
        revisionId,
        nextVersion,
        ...actorGuard.bindings(actor),
      ),
    auditStatement(database, {
      action: input.restoredFromRevisionId
        ? "cms.entity_restored_as_draft"
        : "cms.entity_draft_saved",
      actor,
      auditId: crypto.randomUUID(),
      contentVersion: nextVersion,
      entityId: input.entityKey,
      entityType: input.entityType,
      metadata: {
        contentVersion: nextVersion,
        restored: input.restoredFromRevisionId !== null,
        ...(input.auditMetadata ?? {}),
      },
      mediaRevisionId: revisionId,
      mediaScope: "draft",
      mediaUsageCount: media.insertCount,
      now: input.now,
      stateId: state.id,
      revisionId,
    }),
  ]);
  const stateUpdateIndex = 1 + media.statements.length;
  const auditIndex = stateUpdateIndex + 1;
  if (
    changes(results[0]) !== 1 ||
    changes(results[stateUpdateIndex]) !== 1 ||
    changes(results[auditIndex]) !== 1 ||
    media.requiredRelativeChanges.some(
      (required) =>
        changes(results[1 + required.index]) !== required.changes,
    )
  ) {
    throw staleEdit();
  }
  return nextVersion;
}

async function publicationStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  state: CmsStateRow,
  revision: CmsRevisionRow,
  now: number,
  publicMedia: ReadonlyMap<string, PublicReadyMediaAsset>,
): Promise<Readonly<{
  completion: Readonly<{
    bindings: readonly (number | string | null)[];
    sql: string;
  }>;
  projectionJson: string;
  requiredChanges: readonly Readonly<{
    changes: number;
    index: number;
  }>[];
  statements: readonly D1PreparedStatementLike[];
}>> {
  switch (state.entityType) {
    case "page":
      return pagePublicationStatements(
        database,
        actor,
        state,
        revision,
        now,
        publicMedia,
      );
    case "club_public_profile":
      return clubPublicationStatements(
        database,
        actor,
        state,
        revision,
        now,
        publicMedia,
      );
    case "program_public_profile":
      return programPublicationStatements(
        database,
        actor,
        state,
        revision,
        now,
      );
    case "community_link":
      return communityPublicationStatements(
        database,
        actor,
        state,
        revision,
        now,
      );
    case "navigation":
      return navigationPublicationStatements(
        database,
        actor,
        state,
        revision,
        now,
      );
    case "site_identity":
      return siteIdentityPublicationStatements(
        database,
        actor,
        state,
        revision,
        now,
      );
    case "legal_status":
      return legalPublicationStatements(database, actor, state, revision, now);
  }
}

function unpublicationStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  state: CmsStateRow,
  now: number,
): Readonly<{
  completion: Readonly<{
    bindings: readonly (number | string | null)[];
    sql: string;
  }>;
  requiredChanges: readonly Readonly<{
    changes: number;
    index: number;
  }>[];
  statements: readonly D1PreparedStatementLike[];
}> {
  const guard = projectionGuard(state, actor, state.currentDraftRevisionId);
  switch (state.entityType) {
    case "page":
      return requiredOnly(
        database
          .prepare(
            `UPDATE pages
             SET status = 'draft', visibility = 'private',
                 published_at = NULL, updated_by_profile_id = ?, updated_at = ?
             WHERE id = ?
               AND organization_id = ?
               AND ${guard.sql}`,
          )
          .bind(
            actor.profileId,
            now,
            state.entityKey,
            actor.organizationId,
            ...guard.bindings,
          ),
        projectionCompletion(
          `EXISTS (
             SELECT 1
             FROM pages AS page
             WHERE page.id = ?
               AND page.organization_id = ?
               AND page.status = 'draft'
               AND page.visibility = 'private'
               AND page.published_at IS NULL
           )`,
          state.entityKey,
          actor.organizationId,
        ),
      );
    case "club_public_profile":
      return requiredOnly(
        database
          .prepare(
            `UPDATE club_public_profiles
             SET publication_status = 'draft', published_at = NULL,
                 updated_at = ?
             WHERE club_id = ?
               AND organization_id = ?
               AND ${guard.sql}`,
          )
          .bind(
            now,
            state.entityKey,
            actor.organizationId,
            ...guard.bindings,
          ),
        projectionCompletion(
          `EXISTS (
             SELECT 1
             FROM club_public_profiles AS profile
             WHERE profile.club_id = ?
               AND profile.organization_id = ?
               AND profile.publication_status = 'draft'
               AND profile.published_at IS NULL
           )`,
          state.entityKey,
          actor.organizationId,
        ),
      );
    case "program_public_profile":
      return requiredOnly(
        database
          .prepare(
            `UPDATE program_public_profile_details
             SET publication_status = 'draft',
                 is_featured = 0,
                 published_at = NULL,
                 updated_by_profile_id = ?,
                 updated_at = ?
             WHERE program_id = ?
               AND organization_id = ?
               AND publication_status = 'published'
               AND deleted_at IS NULL
               AND ${guard.sql}`,
          )
          .bind(
            actor.profileId,
            now,
            state.entityKey,
            actor.organizationId,
            ...guard.bindings,
          ),
        projectionCompletion(
          `EXISTS (
             SELECT 1
             FROM program_public_profile_details AS detail
             WHERE detail.program_id = ?
               AND detail.organization_id = ?
               AND detail.publication_status = 'draft'
               AND detail.published_at IS NULL
               AND detail.deleted_at IS NULL
           )`,
          state.entityKey,
          actor.organizationId,
        ),
      );
    case "community_link":
      return requiredOnly(
        database
          .prepare(
            `UPDATE community_links
             SET is_published = 0, updated_at = ?
             WHERE id = ?
               AND organization_id = ?
               AND ${guard.sql}`,
          )
          .bind(
            now,
            state.entityKey,
            actor.organizationId,
            ...guard.bindings,
          ),
        projectionCompletion(
          `EXISTS (
             SELECT 1
             FROM community_links AS link
             WHERE link.id = ?
               AND link.organization_id = ?
               AND link.is_published = 0
           )`,
          state.entityKey,
          actor.organizationId,
        ),
      );
    case "navigation":
      return requiredOnly(
        database
          .prepare(
            `UPDATE navigation_items
             SET is_published = 0, updated_at = ?
             WHERE organization_id = ?
               AND ${guard.sql}`,
          )
          .bind(now, actor.organizationId, ...guard.bindings),
        projectionCompletion(
          `NOT EXISTS (
             SELECT 1
             FROM navigation_items AS item
             WHERE item.organization_id = ?
               AND item.is_published = 1
               AND item.deleted_at IS NULL
           )`,
          actor.organizationId,
        ),
        false,
      );
    case "site_identity":
      return requiredOnly(
        database
          .prepare(
            `UPDATE site_settings
             SET is_public = 0, updated_by_profile_id = ?, updated_at = ?
             WHERE organization_id = ?
               AND key = ?
               AND ${guard.sql}`,
          )
          .bind(
            actor.profileId,
            now,
            actor.organizationId,
            PUBLIC_IDENTITY_SETTING_KEY,
            ...guard.bindings,
          ),
        projectionCompletion(
          `NOT EXISTS (
             SELECT 1
             FROM site_settings AS setting
             WHERE setting.organization_id = ?
               AND setting.key = ?
               AND setting.is_public = 1
           )`,
          actor.organizationId,
          PUBLIC_IDENTITY_SETTING_KEY,
        ),
      );
    case "legal_status":
      return requiredOnly(
        database
          .prepare(
            `UPDATE site_settings
             SET is_public = 0, updated_by_profile_id = ?, updated_at = ?
             WHERE organization_id = ?
               AND key = ?
               AND ${guard.sql}`,
          )
          .bind(
            actor.profileId,
            now,
            actor.organizationId,
            PUBLIC_LEGAL_SETTING_KEY,
            ...guard.bindings,
          ),
        projectionCompletion(
          `NOT EXISTS (
             SELECT 1
             FROM site_settings AS setting
             WHERE setting.organization_id = ?
               AND setting.key = ?
               AND setting.is_public = 1
           )`,
          actor.organizationId,
          PUBLIC_LEGAL_SETTING_KEY,
        ),
        false,
      );
  }
}

async function pagePublicationStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  state: CmsStateRow,
  revision: CmsRevisionRow,
  now: number,
  publicMedia: ReadonlyMap<string, PublicReadyMediaAsset>,
) {
  const snapshot = revision.snapshot as CmsPageSnapshot;
  assertPagePublicationStructure(snapshot);
  const {
    blocks: publicBlocks,
    eventSelectionProofs,
  } = await materializePublicPageBlocks(
    database,
    actor.organizationId,
    snapshot,
    publicMedia,
  );
  const existing = await database
    .prepare(
      `SELECT slug
       FROM pages
       WHERE id = ?
         AND organization_id = ?
       LIMIT 1`,
    )
    .bind(state.entityKey, actor.organizationId)
    .first<Record<string, unknown>>();
  const previousSlug =
    typeof existing?.slug === "string" ? existing.slug : null;
  if (
    previousSlug &&
    REQUIRED_SYSTEM_PAGE_SLUGS.has(previousSlug) &&
    snapshot.slug !== previousSlug
  ) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "Required public page slugs cannot be changed.",
    );
  }
  const guard = publishedProjectionGuard(state, actor, revision.id);
  const sectionRowsJson = canonicalJson(
    publicBlocks.map((block, index) =>
      Object.freeze({
        contentJson: canonicalJson(block.config),
        id: crypto.randomUUID(),
        sectionKey: block.id,
        sectionType: block.type,
        sortOrder: (index + 1) * 10,
      }),
    ),
  );
  const statements: D1PreparedStatementLike[] = [
    database
      .prepare(
        `INSERT INTO pages (
           id, organization_id, title, slug, status, visibility,
           current_revision, published_at, created_by_profile_id,
           updated_by_profile_id, created_at, updated_at, deleted_at
         )
         SELECT ?, ?, ?, ?, 'published', 'public', ?, ?, ?, ?, ?, ?, NULL
         WHERE ${guard.sql}
           AND NOT EXISTS (
             SELECT 1
             FROM pages AS collision
             WHERE collision.organization_id = ?
               AND collision.slug = ?
               AND collision.id <> ?
               AND collision.deleted_at IS NULL
           )
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           slug = excluded.slug,
           status = 'published',
           visibility = 'public',
           current_revision = excluded.current_revision,
           published_at = excluded.published_at,
           updated_by_profile_id = excluded.updated_by_profile_id,
           updated_at = excluded.updated_at,
           deleted_at = NULL
         WHERE pages.organization_id = excluded.organization_id`,
      )
      .bind(
        state.entityKey,
        actor.organizationId,
        snapshot.title,
        snapshot.slug,
        revision.revisionNumber,
        now,
        actor.profileId,
        actor.profileId,
        now,
        now,
        ...guard.bindings,
        actor.organizationId,
        snapshot.slug,
        state.entityKey,
      ),
    database
      .prepare(
        `UPDATE page_sections
         SET deleted_at = ?, updated_at = ?
         WHERE page_id = ?
           AND organization_id = ?
           AND deleted_at IS NULL
           AND ${guard.sql}`,
      )
      .bind(
        now,
        now,
        state.entityKey,
        actor.organizationId,
        ...guard.bindings,
      ),
    database
      .prepare(
        `INSERT INTO page_sections (
           id, organization_id, page_id, section_key, section_type,
           content_json, sort_order, created_at, updated_at, deleted_at
         )
         SELECT json_extract(item.value, '$.id'), ?, ?,
                json_extract(item.value, '$.sectionKey'),
                json_extract(item.value, '$.sectionType'),
                json_extract(item.value, '$.contentJson'),
                json_extract(item.value, '$.sortOrder'), ?, ?, NULL
         FROM json_each(?) AS item
         WHERE ${guard.sql}
         ON CONFLICT(page_id, section_key) DO UPDATE SET
           section_type = excluded.section_type,
           content_json = excluded.content_json,
           sort_order = excluded.sort_order,
           updated_at = excluded.updated_at,
           deleted_at = NULL
         WHERE page_sections.organization_id = excluded.organization_id`,
      )
      .bind(
        actor.organizationId,
        state.entityKey,
        now,
        now,
        sectionRowsJson,
        ...guard.bindings,
      ),
  ];
  statements.push(
    database
      .prepare(
        `INSERT INTO page_public_metadata (
           page_id, organization_id, seo_title, meta_description,
           og_media_asset_id, updated_by_profile_id, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE ${guard.sql}
         ON CONFLICT(page_id) DO UPDATE SET
           seo_title = excluded.seo_title,
           meta_description = excluded.meta_description,
           og_media_asset_id = excluded.og_media_asset_id,
           updated_by_profile_id = excluded.updated_by_profile_id,
           updated_at = excluded.updated_at
         WHERE page_public_metadata.organization_id =
               excluded.organization_id`,
      )
      .bind(
        state.entityKey,
        actor.organizationId,
        snapshot.seoTitle,
        snapshot.metaDescription,
        snapshot.openGraphAssetId,
        actor.profileId,
        now,
        now,
        ...guard.bindings,
      ),
  );
  const requiredChanges = [
    Object.freeze({ changes: 1, index: 0 }),
    Object.freeze({ changes: publicBlocks.length, index: 2 }),
    Object.freeze({ changes: 1, index: statements.length - 1 }),
  ];
  if (previousSlug && previousSlug !== snapshot.slug) {
    statements.push(
      database
        .prepare(
          `INSERT INTO public_slug_redirects (
             id, organization_id, entity_type, entity_id, from_slug, to_slug,
             state, created_by_profile_id, created_at, updated_at, retired_at
           )
           SELECT ?, ?, 'page', ?, ?, ?, 'active', ?, ?, ?, NULL
           WHERE ${guard.sql}
             AND NOT EXISTS (
               SELECT 1
               FROM public_slug_redirects AS redirect
               WHERE redirect.organization_id = ?
                 AND redirect.entity_type = 'page'
                 AND redirect.from_slug = ?
                 AND redirect.state = 'active'
             )`,
        )
        .bind(
          crypto.randomUUID(),
          actor.organizationId,
          state.entityKey,
          previousSlug,
          snapshot.slug,
          actor.profileId,
          now,
          now,
          ...guard.bindings,
          actor.organizationId,
          previousSlug,
        ),
    );
    const redirectInsertIndex = statements.length - 1;
    statements.push(
      database
        .prepare(
          `UPDATE public_slug_redirects
           SET to_slug = ?, updated_at = ?
           WHERE organization_id = ?
             AND entity_type = 'page'
             AND entity_id = ?
             AND to_slug = ?
             AND from_slug <> ?
             AND state = 'active'
             AND ${guard.sql}`,
        )
        .bind(
          snapshot.slug,
          now,
          actor.organizationId,
          state.entityKey,
          previousSlug,
          snapshot.slug,
          ...guard.bindings,
        ),
    );
    requiredChanges.push(
      Object.freeze({ changes: 1, index: redirectInsertIndex }),
    );
  }
  const sectionCompletionJson = canonicalJson(
    publicBlocks.map((block, index) =>
      Object.freeze({
        contentJson: canonicalJson(block.config),
        sectionKey: block.id,
        sectionType: block.type,
        sortOrder: (index + 1) * 10,
      }),
    ),
  );
  const projectionJson = canonicalJson({
    eventSelectionProofs,
    metadata: {
      metaDescription: snapshot.metaDescription,
      openGraphAssetId: snapshot.openGraphAssetId,
      seoTitle: snapshot.seoTitle,
    },
    page: {
      currentRevision: revision.revisionNumber,
      slug: snapshot.slug,
      title: snapshot.title,
    },
    sections: JSON.parse(sectionCompletionJson) as unknown,
  });
  return Object.freeze({
    completion: projectionCompletion(
      `EXISTS (
         SELECT 1
         FROM pages AS page
         WHERE page.id = ?
           AND page.organization_id = ?
           AND page.title = ?
           AND page.slug = ?
           AND page.status = 'published'
           AND page.visibility = 'public'
           AND page.current_revision = ?
           AND page.published_at IS NOT NULL
           AND page.deleted_at IS NULL
       )
       AND EXISTS (
         SELECT 1
         FROM page_public_metadata AS metadata
         WHERE metadata.page_id = ?
           AND metadata.organization_id = ?
           AND metadata.seo_title = ?
           AND metadata.meta_description = ?
           AND metadata.og_media_asset_id IS ?
       )
       AND (
         SELECT json_group_array(
                  json_object(
                    'contentJson', ordered.content_json,
                    'sectionKey', ordered.section_key,
                    'sectionType', ordered.section_type,
                    'sortOrder', ordered.sort_order
                  )
                )
         FROM (
           SELECT section.content_json, section.section_key,
                  section.section_type, section.sort_order
           FROM page_sections AS section
           WHERE section.page_id = ?
             AND section.organization_id = ?
             AND section.deleted_at IS NULL
           ORDER BY section.sort_order ASC, section.section_key ASC
         ) AS ordered
       ) = json(?)`,
      state.entityKey,
      actor.organizationId,
      snapshot.title,
      snapshot.slug,
      revision.revisionNumber,
      state.entityKey,
      actor.organizationId,
      snapshot.seoTitle,
      snapshot.metaDescription,
      snapshot.openGraphAssetId,
      state.entityKey,
      actor.organizationId,
      sectionCompletionJson,
    ),
    projectionJson,
    requiredChanges: Object.freeze(requiredChanges),
    statements: Object.freeze(statements),
  });
}

async function materializePublicPageBlocks(
  database: D1DatabaseLike,
  organizationId: string,
  snapshot: CmsPageSnapshot,
  publicMedia: ReadonlyMap<string, PublicReadyMediaAsset>,
  strict = true,
): Promise<
  Readonly<{
    blocks: readonly CmsPageBlock[];
    eventSelectionProofs: readonly Readonly<{
      requestedId: string;
      slug: string;
      sourceIdentity: string;
      sourceVersion: string;
    }>[];
  }>
> {
  const clubIds = uniqueConfigIdentifiers(snapshot, "featured_clubs");
  const eventIds = uniqueConfigIdentifiers(snapshot, "featured_events");
  const communityIds = uniqueConfigIdentifiers(snapshot, "community_links");
  const clubSlugs = await publicClubSlugs(
    database,
    organizationId,
    clubIds,
  );
  const eventSelections =
    await resolveEditorialPublishedEventSelectionProofs(
    database,
    {
      organizationId,
      selectionIds: eventIds,
    },
    );
  const eventSlugs = Object.freeze(
    eventSelections.map((selection) => selection.slug),
  );
  const communityDestinations = await publicCommunityDestinations(
    database,
    organizationId,
    communityIds,
  );
  if (
    strict &&
    (
      clubSlugs.length !== clubIds.length ||
      eventSlugs.length !== eventIds.length ||
      communityDestinations.length !== communityIds.length
    )
  ) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "Every dynamic selection must reference current published content.",
    );
  }
  const clubSlugById = new Map(
    clubIds.map((id, index) => [id, clubSlugs[index]]),
  );
  const eventSlugById = new Map(
    eventSelections.map((selection) => [selection.id, selection.slug]),
  );
  const communityById = new Map(
    communityIds.map((id, index) => [id, communityDestinations[index]]),
  );
  const output: CmsPageBlock[] = [];
  for (const block of snapshot.blocks) {
    if (block.type === "media") {
      const assetId = requiredString(block.config.assetId);
      const media = publicMedia.get(assetId);
      if (!media) {
        if (!strict) {
          output.push(
            Object.freeze({
              config: Object.freeze({
                heading: block.config.heading ?? null,
              }),
              id: block.id,
              type: block.type,
            }),
          );
          continue;
        }
        throw new SafeApplicationError(
          "conflict",
          409,
          "The selected media is not eligible for public use.",
        );
      }
      output.push(
        Object.freeze({
          config: Object.freeze({
            assetId: media.assetId,
            caption: block.config.caption ?? null,
            heading: block.config.heading ?? null,
          }),
          id: block.id,
          type: block.type,
        }),
      );
      continue;
    }
    if (block.type === "featured_clubs") {
      const ids = configIdentifiers(block.config.ids);
      const slugs = ids.flatMap((id) => {
        const slug = clubSlugById.get(id);
        return slug ? [slug] : [];
      });
      if (strict && slugs.length !== ids.length) {
        throw new SafeApplicationError(
          "conflict",
          409,
          "Every selected featured club must be currently published.",
        );
      }
      output.push(
        Object.freeze({
          config: Object.freeze({
            clubSlugs: Object.freeze(
              slugs.slice(0, requiredInteger(block.config.limit)),
            ),
            heading: block.config.heading ?? null,
            limit: block.config.limit,
          }),
          id: block.id,
          type: block.type,
        }),
      );
      continue;
    }
    if (block.type === "featured_events") {
      const ids = configIdentifiers(block.config.ids);
      const slugs = ids.flatMap((id) => {
        const slug = eventSlugById.get(id);
        return slug ? [slug] : [];
      });
      if (strict && slugs.length !== ids.length) {
        throw new SafeApplicationError(
          "conflict",
          409,
          "Every selected featured event must be currently public.",
        );
      }
      output.push(
        Object.freeze({
          config: Object.freeze({
            eventSlugs: Object.freeze(
              slugs.slice(0, requiredInteger(block.config.limit)),
            ),
            heading: block.config.heading ?? null,
            limit: block.config.limit,
          }),
          id: block.id,
          type: block.type,
        }),
      );
      continue;
    }
    if (block.type === "community_links") {
      const ids = configIdentifiers(block.config.ids);
      const destinations = ids.flatMap((id) => {
        const destination = communityById.get(id);
        return destination ? [destination] : [];
      });
      if (strict && destinations.length !== ids.length) {
        throw new SafeApplicationError(
          "conflict",
          409,
          "Every selected community destination must be confirmed and public.",
        );
      }
      output.push(
        Object.freeze({
          config: Object.freeze({
            heading: block.config.heading ?? null,
            limit: block.config.limit,
            links: Object.freeze(
              destinations.slice(
                0,
                requiredInteger(block.config.limit),
              ),
            ),
          }),
          id: block.id,
          type: block.type,
        }),
      );
      continue;
    }
    output.push(
      Object.freeze({
        config: block.config,
        id: block.id,
        type: block.type,
      }),
    );
  }
  return Object.freeze({
    blocks: Object.freeze(output),
    eventSelectionProofs: Object.freeze(
      eventSelections.map((selection) =>
        Object.freeze({
          requestedId: selection.id,
          slug: selection.slug,
          sourceIdentity: selection.sourceIdentity,
          sourceVersion: selection.sourceVersion,
        }),
      ),
    ),
  });
}

function publishedClubAltText(
  snapshot: CmsClubProfileSnapshot,
  publicMedia: ReadonlyMap<string, PublicReadyMediaAsset>,
): string | null {
  const candidateId = snapshot.coverAssetId ?? snapshot.thumbnailAssetId;
  if (!candidateId) return null;
  const media = publicMedia.get(candidateId);
  if (!media) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "The selected club artwork is not eligible for public use.",
    );
  }
  return media.altText;
}

async function publicClubSlugs(
  database: D1DatabaseLike,
  organizationId: string,
  ids: readonly string[],
): Promise<readonly string[]> {
  if (ids.length === 0) return Object.freeze([]);
  const requestedIdsJson = canonicalJson(ids);
  const result = await database
    .prepare(
      `SELECT club.id, club.slug
       FROM json_each(?) AS requested
       JOIN clubs AS club
         ON club.id = CAST(requested.value AS TEXT)
       JOIN club_public_profiles AS profile
         ON profile.club_id = club.id
        AND profile.organization_id = club.organization_id
        AND profile.publication_status = 'published'
        AND profile.published_at IS NOT NULL
        AND profile.deleted_at IS NULL
       WHERE club.organization_id = ?
         AND club.deleted_at IS NULL`,
    )
    .bind(requestedIdsJson, organizationId)
    .all<Record<string, unknown>>();
  const byId = new Map(
    (result.results ?? []).map((row) => [
      requiredString(row.id),
      requiredString(row.slug),
    ]),
  );
  return Object.freeze(ids.flatMap((id) => {
    const slug = byId.get(id);
    return slug ? [slug] : [];
  }));
}

async function publicCommunityDestinations(
  database: D1DatabaseLike,
  organizationId: string,
  ids: readonly string[],
): Promise<readonly Readonly<{
  label: string;
  url: string;
}>[]> {
  if (ids.length === 0) return Object.freeze([]);
  const requestedIdsJson = canonicalJson(ids);
  const result = await database
    .prepare(
      `SELECT link.id, link.label, link.url
       FROM json_each(?) AS requested
       JOIN community_links AS link
         ON link.id = CAST(requested.value AS TEXT)
       JOIN community_link_public_details AS details
         ON details.community_link_id = link.id
        AND details.organization_id = link.organization_id
        AND details.confirmed_at IS NOT NULL
       JOIN cms_entity_publication_states AS state
         ON state.organization_id = link.organization_id
        AND state.entity_type = 'community_link'
        AND state.entity_key = link.id
        AND state.workflow_status = 'published'
        AND state.published_revision_id IS NOT NULL
       JOIN cms_entity_revisions AS revision
         ON revision.id = state.published_revision_id
        AND revision.organization_id = state.organization_id
        AND revision.publication_state_id = state.id
        AND revision.entity_type = state.entity_type
        AND revision.entity_key = state.entity_key
       WHERE link.organization_id = ?
         AND link.is_published = 1
         AND link.deleted_at IS NULL
         AND json_valid(revision.snapshot_json)
         AND json_extract(revision.snapshot_json, '$.confirmed') = 1
         AND json_extract(revision.snapshot_json, '$.label') = link.label
         AND json_extract(revision.snapshot_json, '$.url') = link.url
         AND json_extract(
               revision.snapshot_json,
               '$.destinationType'
             ) = details.destination_type
         AND json_extract(
               revision.snapshot_json,
               '$.description'
             ) = details.description
         AND json_extract(
               revision.snapshot_json,
               '$.sortOrder'
             ) = link.sort_order`,
    )
    .bind(requestedIdsJson, organizationId)
    .all<Record<string, unknown>>();
  const byId = new Map(
    (result.results ?? []).map((row) => [
      requiredString(row.id),
      Object.freeze({
        label: requiredString(row.label),
        url: requiredString(row.url),
      }),
    ]),
  );
  return Object.freeze(ids.flatMap((id) => {
    const destination = byId.get(id);
    return destination ? [destination] : [];
  }));
}

async function readPrivateCommunityPreviewOrder(
  database: D1DatabaseLike,
  organizationId: string,
): Promise<readonly Readonly<{
  entityKey: string;
  sortOrder: number;
  url: string;
}>[]> {
  const result = await database
    .prepare(
      `SELECT link.id, link.sort_order, link.url
       FROM community_links AS link
       JOIN community_link_public_details AS details
         ON details.community_link_id = link.id
        AND details.organization_id = link.organization_id
        AND details.confirmed_at > 0
       JOIN cms_entity_publication_states AS state
         ON state.organization_id = link.organization_id
        AND state.entity_type = 'community_link'
        AND state.entity_key = link.id
        AND state.workflow_status = 'published'
        AND state.published_revision_id IS NOT NULL
       JOIN cms_entity_revisions AS revision
         ON revision.id = state.published_revision_id
        AND revision.organization_id = state.organization_id
        AND revision.publication_state_id = state.id
        AND revision.entity_type = state.entity_type
        AND revision.entity_key = state.entity_key
       WHERE link.organization_id = ?
         AND link.is_published = 1
         AND link.deleted_at IS NULL
         AND link.link_type IN (
           'meetup_group', 'meetup_discussion', 'social_profile',
           'community_platform', 'resource', 'other'
         )
         AND json_valid(revision.snapshot_json)
         AND json_extract(revision.snapshot_json, '$.confirmed') = 1
         AND json_extract(revision.snapshot_json, '$.label') = link.label
         AND json_extract(revision.snapshot_json, '$.url') = link.url
         AND json_extract(
               revision.snapshot_json,
               '$.destinationType'
             ) = details.destination_type
         AND json_extract(
               revision.snapshot_json,
               '$.description'
             ) = details.description
         AND json_extract(
               revision.snapshot_json,
               '$.sortOrder'
             ) = link.sort_order
       ORDER BY link.sort_order ASC, link.label ASC
       LIMIT 200`,
    )
    .bind(organizationId)
    .all<Record<string, unknown>>();
  return Object.freeze(
    (result.results ?? []).map((row) =>
      Object.freeze({
        entityKey: requiredString(row.id),
        sortOrder: requiredInteger(row.sort_order),
        url: requiredString(row.url),
      }),
    ),
  );
}

function configIdentifiers(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.map((entry) => requiredString(entry)));
}

function uniqueConfigIdentifiers(
  snapshot: CmsPageSnapshot,
  blockType: "community_links" | "featured_clubs" | "featured_events",
): readonly string[] {
  return Object.freeze([
    ...new Set(
      snapshot.blocks.flatMap((block) =>
        block.type === blockType
          ? configIdentifiers(block.config.ids)
          : [],
      ),
    ),
  ]);
}

function publicSocialLinkObjects(
  urls: readonly string[],
): readonly Readonly<{ label: string; url: string }>[] {
  return Object.freeze(
    urls.map((url) => {
      const hostname = new URL(url).hostname.toLowerCase();
      const label = hostname === "www.meetup.com"
        ? "Meetup"
        : hostname.replace(/^www\./u, "").slice(0, 120);
      return Object.freeze({ label, url });
    }),
  );
}

async function publishedResourceLinks(
  database: D1DatabaseLike,
  organizationId: string,
  ids: readonly string[],
): Promise<readonly Readonly<{ label: string; url: string }>[]> {
  const bindings = await publishedResourceBindings(
    database,
    organizationId,
    ids,
  );
  return Object.freeze(
    bindings.map(({ label, url }) => Object.freeze({ label, url })),
  );
}

type PublishedResourceBinding = Readonly<{
  id: string;
  label: string;
  receiptId: string;
  revisionId: string;
  selectedIndex: number;
  url: string;
}>;

async function publishedResourceBindings(
  database: D1DatabaseLike,
  organizationId: string,
  ids: readonly string[],
): Promise<readonly PublishedResourceBinding[]> {
  if (ids.length === 0) return Object.freeze([]);
  const result = await database
    .prepare(
      `WITH requested_resource AS (
         SELECT CAST(key AS INTEGER) AS selected_index,
                CAST(value AS TEXT) AS page_id
         FROM json_each(?)
       )
       SELECT page.id, page.title, page.slug,
              requested.selected_index,
              revision.id AS revision_id,
              receipt.id AS receipt_id
       FROM requested_resource AS requested
       JOIN pages AS page
         ON page.id = requested.page_id
       JOIN cms_entity_publication_states AS state
         ON state.organization_id = page.organization_id
        AND state.entity_type = 'page'
        AND state.entity_key = page.id
        AND state.workflow_status = 'published'
        AND state.published_revision_id IS NOT NULL
       JOIN cms_entity_revisions AS revision
         ON revision.id = state.published_revision_id
        AND revision.organization_id = state.organization_id
        AND revision.publication_state_id = state.id
        AND revision.entity_type = 'page'
        AND revision.entity_key = page.id
        AND revision.revision_number = page.current_revision
       JOIN cms_public_materialization_receipts AS receipt
         ON receipt.organization_id = state.organization_id
        AND receipt.publication_state_id = state.id
        AND receipt.entity_type = state.entity_type
        AND receipt.entity_key = state.entity_key
        AND receipt.revision_id = revision.id
        AND receipt.revision_hash = revision.content_hash
        AND ${cmsReceiptEnvelopeMatchesRevisionSql(
          "receipt",
          "revision",
        )}
       WHERE page.organization_id = ?
         AND page.status = 'published'
         AND page.visibility = 'public'
         AND page.published_at IS NOT NULL
         AND page.deleted_at IS NULL
         AND ${cmsPageLiveProjectionMatchesReceiptSql("page", "receipt")}
       ORDER BY requested.selected_index`,
    )
    .bind(canonicalJson(ids), organizationId)
    .all<Record<string, unknown>>();
  return Object.freeze(
    (result.results ?? []).map((row) =>
      Object.freeze({
        id: requiredString(row.id),
        label: requiredString(row.title).slice(0, 120),
        receiptId: requiredString(row.receipt_id),
        revisionId: requiredString(row.revision_id),
        selectedIndex: requiredInteger(row.selected_index),
        url: `/${requiredString(row.slug)}`,
      }),
    ),
  );
}

function isClubSnapshotPublicationReady(
  snapshot: CmsClubProfileSnapshot,
): boolean {
  return (
    snapshot.contentConfirmed &&
    snapshot.summary.trim().length > 0 &&
    snapshot.description.trim().length > 0 &&
    snapshot.metaDescription.trim().length > 0
  );
}

function assertClubSnapshotPublicationReady(
  snapshot: CmsClubProfileSnapshot,
): void {
  if (!snapshot.contentConfirmed) {
    throw validationIssue(
      "snapshot.contentConfirmed",
      "public_content_unconfirmed",
      "Confirm that this revision contains real owner-approved public information before publishing.",
    );
  }
  for (const [field, value] of [
    ["summary", snapshot.summary],
    ["description", snapshot.description],
    ["metaDescription", snapshot.metaDescription],
  ] as const) {
    if (value.trim().length === 0) {
      throw validationIssue(
        `snapshot.${field}`,
        "public_content_required",
        "Complete the required public club content before publishing.",
      );
    }
  }
}

function isProgramSnapshotPublicationReady(
  snapshot: CmsProgramProfileSnapshot,
): boolean {
  return (
    snapshot.contentConfirmed &&
    snapshot.summary.trim().length > 0 &&
    snapshot.description.trim().length > 0 &&
    snapshot.metaDescription.trim().length > 0
  );
}

function assertProgramSnapshotPublicationReady(
  snapshot: CmsProgramProfileSnapshot,
): void {
  if (!snapshot.contentConfirmed) {
    throw validationIssue(
      "snapshot.contentConfirmed",
      "public_content_unconfirmed",
      "Confirm that this revision contains real owner-approved public information before publishing.",
    );
  }
  for (const [field, value] of [
    ["summary", snapshot.summary],
    ["description", snapshot.description],
    ["metaDescription", snapshot.metaDescription],
  ] as const) {
    if (value.trim().length === 0) {
      throw validationIssue(
        `snapshot.${field}`,
        "public_content_required",
        "Complete the required public Program content before publishing.",
      );
    }
  }
}

async function clubPublicationStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  state: CmsStateRow,
  revision: CmsRevisionRow,
  now: number,
  publicMedia: ReadonlyMap<string, PublicReadyMediaAsset>,
) {
  const snapshot = revision.snapshot as CmsClubProfileSnapshot;
  const publishedIdentity = await readPublishedIdentityContrastGuard(
    database,
    actor.organizationId,
  );
  assertClubThemeContrast(
    snapshot.themeColor,
    publishedIdentity.snapshot.palette.background,
  );
  await validateClubSnapshotReferences(
    database,
    actor.organizationId,
    state.entityKey,
    snapshot,
  );
  const existing = await database
    .prepare(
      `SELECT slug
       FROM clubs
       WHERE id = ?
         AND organization_id = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(state.entityKey, actor.organizationId)
    .first<Record<string, unknown>>();
  if (!existing) throw notFound();
  const previousSlug =
    typeof existing.slug === "string" ? existing.slug : null;
  const publicSocialLinks = publicSocialLinkObjects(snapshot.socialUrls);
  const relatedResourceBindings = await publishedResourceBindings(
    database,
    actor.organizationId,
    snapshot.relatedResourceIds,
  );
  const publicRelatedResources = Object.freeze(
    relatedResourceBindings.map(({ label, url }) =>
      Object.freeze({ label, url }),
    ),
  );
  const guard = publishedProjectionGuard(state, actor, revision.id);
  const statements: D1PreparedStatementLike[] = [
    database
      .prepare(
        `UPDATE clubs
         SET name = ?, slug = ?, description = ?, updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND deleted_at IS NULL
           AND ${guard.sql}
           AND NOT EXISTS (
             SELECT 1
             FROM clubs AS collision
             WHERE collision.organization_id = ?
               AND collision.slug = ?
               AND collision.id <> ?
               AND collision.deleted_at IS NULL
           )`,
      )
      .bind(
        snapshot.name,
        snapshot.slug,
        snapshot.summary,
        now,
        state.entityKey,
        actor.organizationId,
        ...guard.bindings,
        actor.organizationId,
        snapshot.slug,
        state.entityKey,
      ),
    database
      .prepare(
        `UPDATE club_public_profiles
         SET primary_event_lane_id = ?,
             publication_status = 'published',
             is_featured = ?,
             description = ?,
             public_group_url = ?,
             published_at = ?,
             updated_at = ?,
             deleted_at = NULL
         WHERE club_id = ?
           AND organization_id = ?
           AND ${guard.sql}`,
      )
      .bind(
        snapshot.laneId,
        snapshot.featured ? 1 : 0,
        snapshot.summary,
        snapshot.meetupGroupUrl,
        now,
        now,
        state.entityKey,
        actor.organizationId,
        ...guard.bindings,
      ),
    database
      .prepare(
        `INSERT INTO club_public_profile_details (
           club_id, organization_id, public_display_name, short_summary,
           full_description, program_type, cover_media_asset_id,
           thumbnail_media_asset_id, image_alt_text, theme_color,
           participant_expectations, preparation_information, typical_format,
           confirmed_social_links_json, related_resources_json, seo_title,
           meta_description, og_media_asset_id, updated_by_profile_id,
           created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?
         WHERE ${guard.sql}
         ON CONFLICT(club_id) DO UPDATE SET
           public_display_name = excluded.public_display_name,
           short_summary = excluded.short_summary,
           full_description = excluded.full_description,
           program_type = excluded.program_type,
           cover_media_asset_id = excluded.cover_media_asset_id,
           thumbnail_media_asset_id = excluded.thumbnail_media_asset_id,
           image_alt_text = excluded.image_alt_text,
           theme_color = excluded.theme_color,
           participant_expectations = excluded.participant_expectations,
           preparation_information = excluded.preparation_information,
           typical_format = excluded.typical_format,
           confirmed_social_links_json = excluded.confirmed_social_links_json,
           related_resources_json = excluded.related_resources_json,
           seo_title = excluded.seo_title,
           meta_description = excluded.meta_description,
           og_media_asset_id = excluded.og_media_asset_id,
           updated_by_profile_id = excluded.updated_by_profile_id,
           updated_at = excluded.updated_at
         WHERE club_public_profile_details.organization_id =
               excluded.organization_id`,
      )
      .bind(
        state.entityKey,
        actor.organizationId,
        snapshot.name,
        snapshot.summary,
        snapshot.description,
        snapshot.programType,
        snapshot.coverAssetId,
        snapshot.thumbnailAssetId,
        publishedClubAltText(snapshot, publicMedia),
        snapshot.themeColor,
        snapshot.whatToExpect,
        snapshot.preparation,
        snapshot.typicalFormat,
        canonicalJson(publicSocialLinks),
        canonicalJson(publicRelatedResources),
        snapshot.seoTitle,
        snapshot.metaDescription,
        snapshot.openGraphAssetId,
        actor.profileId,
        now,
        now,
        ...guard.bindings,
      ),
  ];
  const requiredChanges = [0, 1, 2].map((index) =>
    Object.freeze({ changes: 1, index }),
  );
  if (previousSlug && previousSlug !== snapshot.slug) {
    statements.push(
      database
        .prepare(
          `INSERT INTO public_slug_redirects (
             id, organization_id, entity_type, entity_id, from_slug, to_slug,
             state, created_by_profile_id, created_at, updated_at, retired_at
           )
           SELECT ?, ?, 'club_public_profile', ?, ?, ?, 'active', ?, ?, ?,
                  NULL
           WHERE ${guard.sql}
             AND NOT EXISTS (
               SELECT 1
               FROM public_slug_redirects AS redirect
               WHERE redirect.organization_id = ?
                 AND redirect.entity_type = 'club_public_profile'
                 AND redirect.from_slug = ?
                 AND redirect.state = 'active'
             )`,
        )
        .bind(
          crypto.randomUUID(),
          actor.organizationId,
          state.entityKey,
          previousSlug,
          snapshot.slug,
          actor.profileId,
          now,
          now,
          ...guard.bindings,
          actor.organizationId,
          previousSlug,
        ),
    );
    const redirectInsertIndex = statements.length - 1;
    statements.push(
      database
        .prepare(
          `UPDATE public_slug_redirects
           SET to_slug = ?, updated_at = ?
           WHERE organization_id = ?
             AND entity_type = 'club_public_profile'
             AND entity_id = ?
             AND to_slug = ?
             AND from_slug <> ?
             AND state = 'active'
             AND ${guard.sql}`,
        )
        .bind(
          snapshot.slug,
          now,
          actor.organizationId,
          state.entityKey,
          previousSlug,
          snapshot.slug,
          ...guard.bindings,
        ),
    );
    requiredChanges.push(
      Object.freeze({ changes: 1, index: redirectInsertIndex }),
    );
  }
  const projectionJson = canonicalJson({
    club: {
      description: snapshot.summary,
      name: snapshot.name,
      slug: snapshot.slug,
    },
    details: {
      confirmedSocialLinks: publicSocialLinks,
      coverAssetId: snapshot.coverAssetId,
      fullDescription: snapshot.description,
      imageAltText: publishedClubAltText(snapshot, publicMedia),
      metaDescription: snapshot.metaDescription,
      openGraphAssetId: snapshot.openGraphAssetId,
      participantExpectations: snapshot.whatToExpect,
      preparationInformation: snapshot.preparation,
      programType: snapshot.programType,
      publicDisplayName: snapshot.name,
      relatedResourceBindings,
      relatedResourceSelectionIds: snapshot.relatedResourceIds,
      relatedResources: publicRelatedResources,
      seoTitle: snapshot.seoTitle,
      shortSummary: snapshot.summary,
      themeColor: snapshot.themeColor,
      thumbnailAssetId: snapshot.thumbnailAssetId,
      typicalFormat: snapshot.typicalFormat,
    },
    profile: {
      featured: snapshot.featured,
      laneId: snapshot.laneId,
      meetupGroupUrl: snapshot.meetupGroupUrl,
      summary: snapshot.summary,
    },
  });
  return Object.freeze({
    completion: projectionCompletion(
      `EXISTS (
         SELECT 1
         FROM clubs AS club
         WHERE club.id = ?
           AND club.organization_id = ?
           AND club.name = ?
           AND club.slug = ?
           AND club.description = ?
           AND club.deleted_at IS NULL
       )
       AND EXISTS (
         SELECT 1
         FROM club_public_profiles AS profile
         WHERE profile.club_id = ?
           AND profile.organization_id = ?
           AND profile.primary_event_lane_id = ?
           AND profile.publication_status = 'published'
           AND profile.is_featured = ?
           AND profile.description = ?
           AND profile.public_group_url IS ?
           AND profile.published_at IS NOT NULL
           AND profile.deleted_at IS NULL
       )
       AND EXISTS (
         SELECT 1
         FROM club_public_profile_details AS details
         WHERE details.club_id = ?
           AND details.organization_id = ?
           AND details.public_display_name = ?
           AND details.short_summary = ?
           AND details.full_description = ?
           AND details.program_type = ?
           AND details.cover_media_asset_id IS ?
           AND details.thumbnail_media_asset_id IS ?
           AND details.image_alt_text IS ?
           AND details.theme_color = ?
           AND details.participant_expectations IS ?
           AND details.preparation_information IS ?
           AND details.typical_format IS ?
           AND details.confirmed_social_links_json = ?
           AND details.related_resources_json = ?
           AND details.seo_title = ?
           AND details.meta_description = ?
           AND details.og_media_asset_id IS ?
       )
       AND EXISTS (
         SELECT 1
         FROM site_settings AS identity
         WHERE identity.organization_id = ?
           AND identity.key = ?
           AND identity.value_json = ?
           AND identity.is_public = 1
       )`,
      state.entityKey,
      actor.organizationId,
      snapshot.name,
      snapshot.slug,
      snapshot.summary,
      state.entityKey,
      actor.organizationId,
      snapshot.laneId,
      snapshot.featured ? 1 : 0,
      snapshot.summary,
      snapshot.meetupGroupUrl,
      state.entityKey,
      actor.organizationId,
      snapshot.name,
      snapshot.summary,
      snapshot.description,
      snapshot.programType,
      snapshot.coverAssetId,
      snapshot.thumbnailAssetId,
      publishedClubAltText(snapshot, publicMedia),
      snapshot.themeColor,
      snapshot.whatToExpect,
      snapshot.preparation,
      snapshot.typicalFormat,
      canonicalJson(publicSocialLinks),
      canonicalJson(publicRelatedResources),
      snapshot.seoTitle,
      snapshot.metaDescription,
      snapshot.openGraphAssetId,
      actor.organizationId,
      PUBLIC_IDENTITY_SETTING_KEY,
      publishedIdentity.valueJson,
    ),
    projectionJson,
    requiredChanges: Object.freeze(requiredChanges),
    statements: Object.freeze(statements),
  });
}

async function programPublicationStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  state: CmsStateRow,
  revision: CmsRevisionRow,
  now: number,
) {
  const snapshot = revision.snapshot as CmsProgramProfileSnapshot;
  assertProgramSnapshotPublicationReady(snapshot);
  await validateProgramSnapshotReferences(
    database,
    actor.organizationId,
    state.entityKey,
    snapshot,
    true,
  );
  const existing = await database
    .prepare(
      `SELECT public_slug
       FROM program_public_profile_details
       WHERE program_id = ?
         AND organization_id = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(state.entityKey, actor.organizationId)
    .first<Record<string, unknown>>();
  const previousSlug = optionalString(existing?.public_slug);
  const publicSocialLinks = publicSocialLinkObjects(snapshot.socialUrls);
  const relatedResourceBindings = await publishedResourceBindings(
    database,
    actor.organizationId,
    snapshot.relatedResourceIds,
  );
  const publicRelatedResources = Object.freeze(
    relatedResourceBindings.map(({ label, url }) =>
      Object.freeze({ label, url }),
    ),
  );
  const guard = publishedProjectionGuard(state, actor, revision.id);
  const statements: D1PreparedStatementLike[] = [
    database
      .prepare(
        `INSERT INTO program_public_profile_details (
           program_id, organization_id, club_id, primary_event_lane_id,
           publication_status,
           is_featured, display_order, public_display_name, public_slug,
           short_summary, full_description, program_type, public_group_url,
           cover_media_asset_id,
           thumbnail_media_asset_id, theme_color, participant_expectations,
           preparation_information, typical_format,
           confirmed_social_links_json, related_resources_json, seo_title,
           meta_description, og_media_asset_id, updated_by_profile_id,
           published_at, created_at, updated_at, deleted_at
         )
         SELECT ?, ?, ?, ?, 'published',
                ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, NULL
         WHERE ${guard.sql}
           AND EXISTS (
             SELECT 1
             FROM programs AS program
             JOIN clubs AS club
               ON club.id = program.club_id
              AND club.organization_id = program.organization_id
              AND club.deleted_at IS NULL
             JOIN club_public_profiles AS profile
               ON profile.club_id = club.id
              AND profile.organization_id = club.organization_id
              AND profile.publication_status = 'published'
              AND profile.published_at IS NOT NULL
              AND profile.deleted_at IS NULL
             WHERE program.id = ?
               AND program.organization_id = ?
               AND program.club_id = ?
               AND program.deleted_at IS NULL
           )
           AND NOT EXISTS (
             SELECT 1
             FROM program_public_profile_details AS collision
             WHERE collision.organization_id = ?
               AND collision.public_slug = ?
               AND collision.program_id <> ?
               AND collision.deleted_at IS NULL
           )
         ON CONFLICT(program_id) DO UPDATE SET
           club_id = excluded.club_id,
           primary_event_lane_id = excluded.primary_event_lane_id,
           publication_status = 'published',
           is_featured = excluded.is_featured,
           display_order = excluded.display_order,
           public_display_name = excluded.public_display_name,
           public_slug = excluded.public_slug,
           short_summary = excluded.short_summary,
           full_description = excluded.full_description,
           program_type = excluded.program_type,
           public_group_url = excluded.public_group_url,
           cover_media_asset_id = excluded.cover_media_asset_id,
           thumbnail_media_asset_id = excluded.thumbnail_media_asset_id,
           theme_color = excluded.theme_color,
           participant_expectations = excluded.participant_expectations,
           preparation_information = excluded.preparation_information,
           typical_format = excluded.typical_format,
           confirmed_social_links_json =
               excluded.confirmed_social_links_json,
           related_resources_json = excluded.related_resources_json,
           seo_title = excluded.seo_title,
           meta_description = excluded.meta_description,
           og_media_asset_id = excluded.og_media_asset_id,
           updated_by_profile_id = excluded.updated_by_profile_id,
           published_at = excluded.published_at,
           updated_at = excluded.updated_at,
           deleted_at = NULL
         WHERE program_public_profile_details.organization_id =
               excluded.organization_id`,
      )
      .bind(
        state.entityKey,
        actor.organizationId,
        snapshot.clubId,
        snapshot.laneId,
        snapshot.featured ? 1 : 0,
        snapshot.displayOrder,
        snapshot.name,
        snapshot.slug,
        snapshot.summary,
        snapshot.description,
        snapshot.programType,
        snapshot.meetupGroupUrl,
        snapshot.coverAssetId,
        snapshot.thumbnailAssetId,
        snapshot.themeColor,
        snapshot.whatToExpect,
        snapshot.preparation,
        snapshot.typicalFormat,
        canonicalJson(publicSocialLinks),
        canonicalJson(publicRelatedResources),
        snapshot.seoTitle,
        snapshot.metaDescription,
        snapshot.openGraphAssetId,
        actor.profileId,
        now,
        now,
        now,
        ...guard.bindings,
        state.entityKey,
        actor.organizationId,
        snapshot.clubId,
        actor.organizationId,
        snapshot.slug,
        state.entityKey,
      ),
  ];
  const requiredChanges: Readonly<{
    changes: number;
    index: number;
  }>[] = [
    Object.freeze({ changes: 1, index: 0 }),
  ];
  if (previousSlug && previousSlug !== snapshot.slug) {
    statements.push(
      database
        .prepare(
          `INSERT INTO public_slug_redirects (
             id, organization_id, entity_type, entity_id, from_slug, to_slug,
             state, created_by_profile_id, created_at, updated_at, retired_at
           )
           SELECT ?, ?, 'program_public_profile', ?, ?, ?, 'active', ?, ?, ?,
                  NULL
           WHERE ${guard.sql}
             AND NOT EXISTS (
               SELECT 1
               FROM public_slug_redirects AS redirect
               WHERE redirect.organization_id = ?
                 AND redirect.entity_type = 'program_public_profile'
                 AND redirect.from_slug = ?
                 AND redirect.state = 'active'
             )`,
        )
        .bind(
          crypto.randomUUID(),
          actor.organizationId,
          state.entityKey,
          previousSlug,
          snapshot.slug,
          actor.profileId,
          now,
          now,
          ...guard.bindings,
          actor.organizationId,
          previousSlug,
        ),
    );
    requiredChanges.push(
      Object.freeze({ changes: 1, index: statements.length - 1 }),
    );
    statements.push(
      database
        .prepare(
          `UPDATE public_slug_redirects
           SET to_slug = ?, updated_at = ?
           WHERE organization_id = ?
             AND entity_type = 'program_public_profile'
             AND entity_id = ?
             AND to_slug = ?
             AND from_slug <> ?
             AND state = 'active'
             AND ${guard.sql}`,
        )
        .bind(
          snapshot.slug,
          now,
          actor.organizationId,
          state.entityKey,
          previousSlug,
          snapshot.slug,
          ...guard.bindings,
      ),
    );
  }
  const projectionJson = canonicalJson({
    details: {
      clubId: snapshot.clubId,
      confirmedSocialLinks: publicSocialLinks,
      coverAssetId: snapshot.coverAssetId,
      displayOrder: snapshot.displayOrder,
      featured: snapshot.featured,
      fullDescription: snapshot.description,
      laneId: snapshot.laneId,
      metaDescription: snapshot.metaDescription,
      meetupGroupUrl: snapshot.meetupGroupUrl,
      name: snapshot.name,
      openGraphAssetId: snapshot.openGraphAssetId,
      participantExpectations: snapshot.whatToExpect,
      preparationInformation: snapshot.preparation,
      programType: snapshot.programType,
      relatedResourceBindings,
      relatedResourceSelectionIds: snapshot.relatedResourceIds,
      relatedResources: publicRelatedResources,
      seoTitle: snapshot.seoTitle,
      slug: snapshot.slug,
      summary: snapshot.summary,
      themeColor: snapshot.themeColor,
      thumbnailAssetId: snapshot.thumbnailAssetId,
      typicalFormat: snapshot.typicalFormat,
    },
  });
  return Object.freeze({
    completion: projectionCompletion(
      `EXISTS (
         SELECT 1
         FROM program_public_profile_details AS detail
         JOIN programs AS program
           ON program.id = detail.program_id
          AND program.organization_id = detail.organization_id
          AND program.club_id = detail.club_id
          AND program.deleted_at IS NULL
         JOIN club_public_profiles AS profile
           ON profile.club_id = detail.club_id
          AND profile.organization_id = detail.organization_id
          AND profile.publication_status = 'published'
          AND profile.published_at IS NOT NULL
          AND profile.deleted_at IS NULL
         WHERE detail.program_id = ?
           AND detail.organization_id = ?
           AND detail.club_id = ?
           AND detail.primary_event_lane_id = ?
           AND detail.publication_status = 'published'
           AND detail.is_featured = ?
           AND detail.display_order = ?
           AND detail.public_display_name = ?
           AND detail.public_slug = ?
           AND detail.short_summary = ?
           AND detail.full_description = ?
           AND detail.program_type = ?
           AND detail.public_group_url IS ?
           AND detail.cover_media_asset_id IS ?
           AND detail.thumbnail_media_asset_id IS ?
           AND detail.theme_color IS ?
           AND detail.participant_expectations IS ?
           AND detail.preparation_information IS ?
           AND detail.typical_format IS ?
           AND detail.confirmed_social_links_json = ?
           AND detail.related_resources_json = ?
           AND detail.seo_title IS ?
           AND detail.meta_description IS ?
           AND detail.og_media_asset_id IS ?
           AND detail.published_at IS NOT NULL
           AND detail.deleted_at IS NULL
       )`,
      state.entityKey,
      actor.organizationId,
      snapshot.clubId,
      snapshot.laneId,
      snapshot.featured ? 1 : 0,
      snapshot.displayOrder,
      snapshot.name,
      snapshot.slug,
      snapshot.summary,
      snapshot.description,
      snapshot.programType,
      snapshot.meetupGroupUrl,
      snapshot.coverAssetId,
      snapshot.thumbnailAssetId,
      snapshot.themeColor,
      snapshot.whatToExpect,
      snapshot.preparation,
      snapshot.typicalFormat,
      canonicalJson(publicSocialLinks),
      canonicalJson(publicRelatedResources),
      snapshot.seoTitle,
      snapshot.metaDescription,
      snapshot.openGraphAssetId,
    ),
    projectionJson,
    requiredChanges: Object.freeze(requiredChanges),
    statements: Object.freeze(statements),
  });
}

async function communityPublicationStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  state: CmsStateRow,
  revision: CmsRevisionRow,
  now: number,
) {
  const snapshot = revision.snapshot as CmsCommunityLinkSnapshot;
  if (!snapshot.confirmed) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "The exact community destination must be confirmed before publication.",
    );
  }
  const guard = publishedProjectionGuard(state, actor, revision.id);
  const statements = [
    database
      .prepare(
        `INSERT INTO community_links (
           id, organization_id, label, url, link_type, is_published,
           sort_order, created_by_profile_id, created_at, updated_at,
           deleted_at
         )
         SELECT ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL
         WHERE ${guard.sql}
           AND NOT EXISTS (
             SELECT 1
             FROM community_links AS collision
             WHERE collision.organization_id = ?
               AND collision.url = ?
               AND collision.id <> ?
               AND collision.deleted_at IS NULL
           )
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           url = excluded.url,
           link_type = excluded.link_type,
           is_published = 1,
           sort_order = excluded.sort_order,
           updated_at = excluded.updated_at,
           deleted_at = NULL
         WHERE community_links.organization_id = excluded.organization_id`,
      )
      .bind(
        state.entityKey,
        actor.organizationId,
        snapshot.label,
        snapshot.url,
        snapshot.destinationType,
        snapshot.sortOrder,
        actor.profileId,
        now,
        now,
        ...guard.bindings,
        actor.organizationId,
        snapshot.url,
        state.entityKey,
      ),
    database
      .prepare(
        `INSERT INTO community_link_public_details (
           community_link_id, organization_id, description, destination_type,
           confirmed_by_profile_id, confirmed_at, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE ${guard.sql}
         ON CONFLICT(community_link_id) DO UPDATE SET
           description = excluded.description,
           destination_type = excluded.destination_type,
           confirmed_by_profile_id = excluded.confirmed_by_profile_id,
           confirmed_at = excluded.confirmed_at,
           updated_at = excluded.updated_at
         WHERE community_link_public_details.organization_id =
               excluded.organization_id`,
      )
      .bind(
        state.entityKey,
        actor.organizationId,
        snapshot.description,
        snapshot.destinationType,
        actor.profileId,
        now,
        now,
        now,
        ...guard.bindings,
      ),
  ];
  const projectionJson = canonicalJson({
    details: {
      description: snapshot.description,
      destinationType: snapshot.destinationType,
    },
    link: {
      label: snapshot.label,
      linkType: snapshot.destinationType,
      sortOrder: snapshot.sortOrder,
      url: snapshot.url,
    },
  });
  return Object.freeze({
    completion: projectionCompletion(
      `EXISTS (
         SELECT 1
         FROM community_links AS link
         JOIN community_link_public_details AS details
           ON details.community_link_id = link.id
          AND details.organization_id = link.organization_id
         WHERE link.id = ?
           AND link.organization_id = ?
           AND link.label = ?
           AND link.url = ?
           AND link.link_type = ?
           AND link.is_published = 1
           AND link.sort_order = ?
           AND link.deleted_at IS NULL
           AND details.description = ?
           AND details.destination_type = ?
           AND details.confirmed_by_profile_id = ?
           AND details.confirmed_at IS NOT NULL
       )`,
      state.entityKey,
      actor.organizationId,
      snapshot.label,
      snapshot.url,
      snapshot.destinationType,
      snapshot.sortOrder,
      snapshot.description,
      snapshot.destinationType,
      actor.profileId,
    ),
    projectionJson,
    requiredChanges: Object.freeze([
      Object.freeze({ changes: 1, index: 0 }),
      Object.freeze({ changes: 1, index: 1 }),
    ]),
    statements: Object.freeze(statements),
  });
}

async function navigationPublicationStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  state: CmsStateRow,
  revision: CmsRevisionRow,
  now: number,
) {
  const snapshot = revision.snapshot as CmsNavigationSnapshot;
  if (
    snapshot.items.some((item) => item.target === "/resources") &&
    !(await publishedPageExists(database, actor.organizationId, "resources"))
  ) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "Resources can appear in navigation only after the page is published.",
    );
  }
  const guard = publishedProjectionGuard(state, actor, revision.id);
  const itemsJson = canonicalJson(snapshot.items);
  const statements = [
    database
      .prepare(
        `UPDATE navigation_items
         SET is_published = 0, deleted_at = ?, updated_at = ?
         WHERE organization_id = ?
           AND ${guard.sql}`,
      )
      .bind(now, now, actor.organizationId, ...guard.bindings),
    database
      .prepare(
        `INSERT INTO navigation_items (
           id, organization_id, label, placement, page_id, external_url,
           sort_order, is_published, created_by_profile_id, created_at,
           updated_at, deleted_at
         )
         SELECT
           json_extract(item.value, '$.id'), ?,
           json_extract(item.value, '$.label'),
           json_extract(item.value, '$.placement'),
           CASE
             WHEN json_extract(item.value, '$.target') = '/' THEN (
               SELECT id FROM pages
               WHERE organization_id = ? AND slug = 'home'
                 AND status = 'published' AND visibility = 'public'
                 AND published_at IS NOT NULL AND deleted_at IS NULL
               LIMIT 1
             )
             WHEN json_extract(item.value, '$.target') LIKE '/%'
              AND json_extract(item.value, '$.target') <> '/organizer'
             THEN (
               SELECT id FROM pages
               WHERE organization_id = ?
                 AND slug = substr(json_extract(item.value, '$.target'), 2)
                 AND status = 'published' AND visibility = 'public'
                 AND published_at IS NOT NULL AND deleted_at IS NULL
               LIMIT 1
             )
             ELSE NULL
           END,
           CASE
             WHEN json_extract(item.value, '$.target') = '/organizer'
               OR json_extract(item.value, '$.target') LIKE 'https://%'
             THEN json_extract(item.value, '$.target')
             ELSE NULL
           END,
           json_extract(item.value, '$.sortOrder'), 1, ?, ?, ?, NULL
         FROM json_each(?) AS item
         WHERE ${guard.sql}
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           placement = excluded.placement,
           page_id = excluded.page_id,
           external_url = excluded.external_url,
           sort_order = excluded.sort_order,
           is_published = 1,
           updated_at = excluded.updated_at,
           deleted_at = NULL
         WHERE navigation_items.organization_id =
               excluded.organization_id`,
      )
      .bind(
        actor.organizationId,
        actor.organizationId,
        actor.organizationId,
        actor.profileId,
        now,
        now,
        itemsJson,
        ...guard.bindings,
      ),
  ];
  return Object.freeze({
    completion: projectionCompletion(
      `(
         SELECT count(*)
         FROM navigation_items AS item
         WHERE item.organization_id = ?
           AND item.is_published = 1
           AND item.deleted_at IS NULL
       ) = json_array_length(?)
       AND NOT EXISTS (
         SELECT 1
         FROM json_each(?) AS expected
         WHERE NOT EXISTS (
           SELECT 1
           FROM navigation_items AS item
           LEFT JOIN pages AS page
             ON page.id = item.page_id
            AND page.organization_id = item.organization_id
           WHERE item.id = json_extract(expected.value, '$.id')
             AND item.organization_id = ?
             AND item.label = json_extract(expected.value, '$.label')
             AND item.placement = json_extract(expected.value, '$.placement')
             AND item.sort_order =
                 json_extract(expected.value, '$.sortOrder')
             AND item.is_published = 1
             AND item.deleted_at IS NULL
             AND CASE
               WHEN item.external_url IS NOT NULL THEN item.external_url
               WHEN page.slug = 'home' THEN '/'
               WHEN page.slug IS NOT NULL THEN '/' || page.slug
               ELSE NULL
             END = json_extract(expected.value, '$.target')
         )
       )`,
      actor.organizationId,
      itemsJson,
      itemsJson,
      actor.organizationId,
    ),
    projectionJson: canonicalJson({ items: snapshot.items }),
    requiredChanges: Object.freeze([
      Object.freeze({ changes: snapshot.items.length, index: 1 }),
    ]),
    statements: Object.freeze(statements),
  });
}

async function siteIdentityPublicationStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  state: CmsStateRow,
  revision: CmsRevisionRow,
  now: number,
) {
  const snapshot = revision.snapshot as CmsSiteIdentitySnapshot;
  if (
    requiresCompleteBrandArtwork(snapshot) &&
    (!snapshot.logoAssetId || !snapshot.openGraphAssetId)
  ) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "A changed public brand identity or logo requires both an approved logo and an approved Open Graph image.",
    );
  }
  const publishedClubThemes = await readPublishedClubThemeGuard(
    database,
    actor.organizationId,
  );
  const blockers = publishedClubThemes.entries.filter(
    (club) =>
      !clubThemeHasRequiredContrast(
        club.themeColor,
        snapshot.palette.background,
      ),
  );
  if (blockers.length > 0) {
    const visibleNames = blockers
      .slice(0, 8)
      .map((club) => club.name)
      .join(", ");
    const remainder =
      blockers.length > 8 ? ` and ${blockers.length - 8} more` : "";
    throw new SafeApplicationError(
      "conflict",
      409,
      `The palette would make published club themes unreadable: ${visibleNames}${remainder}.`,
    );
  }
  const guard = publishedProjectionGuard(state, actor, revision.id);
  const statement = database
    .prepare(
      `INSERT INTO site_settings (
         id, organization_id, key, value_json, is_public,
         updated_by_profile_id, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, 1, ?, ?, ?
       WHERE ${guard.sql}
         AND (${publishedClubThemes.sql})
       ON CONFLICT(organization_id, key) DO UPDATE SET
         value_json = excluded.value_json,
         is_public = 1,
         updated_by_profile_id = excluded.updated_by_profile_id,
         updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      actor.organizationId,
      PUBLIC_IDENTITY_SETTING_KEY,
      canonicalJson(snapshot),
      actor.profileId,
      now,
      now,
      ...guard.bindings,
      ...publishedClubThemes.bindings,
    );
  return requiredOnly(
    statement,
    projectionCompletion(
      `EXISTS (
         SELECT 1
         FROM site_settings AS setting
         WHERE setting.organization_id = ?
           AND setting.key = ?
           AND setting.value_json = ?
           AND setting.is_public = 1
       )
       AND (${publishedClubThemes.sql})`,
      actor.organizationId,
      PUBLIC_IDENTITY_SETTING_KEY,
      canonicalJson(snapshot),
      ...publishedClubThemes.bindings,
    ),
    true,
    canonicalJson({
      setting: {
        key: PUBLIC_IDENTITY_SETTING_KEY,
        valueJson: canonicalJson(snapshot),
      },
    }),
  );
}

const CLUB_THEME_SURFACE = "#F2EDFF";

function clubThemeHasRequiredContrast(
  themeColor: string,
  backgroundColor: string,
): boolean {
  return (
    contrastRatio(themeColor, backgroundColor) >= 4.5 &&
    contrastRatio(themeColor, CLUB_THEME_SURFACE) >= 4.5
  );
}

function assertClubThemeContrast(
  themeColor: string,
  backgroundColor: string,
): void {
  if (clubThemeHasRequiredContrast(themeColor, backgroundColor)) return;
  throw new SafeApplicationError(
    "conflict",
    409,
    "The club theme color is not readable on the current published site surfaces.",
  );
}

async function readPublishedIdentityContrastGuard(
  database: D1DatabaseLike,
  organizationId: string,
): Promise<Readonly<{
  snapshot: CmsSiteIdentitySnapshot;
  valueJson: string;
}>> {
  const row = await database
    .prepare(
      `SELECT value_json
       FROM site_settings
       WHERE organization_id = ?
         AND key = ?
         AND is_public = 1
       LIMIT 1`,
    )
    .bind(organizationId, PUBLIC_IDENTITY_SETTING_KEY)
    .first<Record<string, unknown>>();
  if (!row) throw serviceUnavailable();
  const valueJson = requiredString(row.value_json);
  try {
    return Object.freeze({
      snapshot: parseSiteIdentitySnapshot(JSON.parse(valueJson)),
      valueJson,
    });
  } catch {
    throw serviceUnavailable();
  }
}

type PublishedClubThemeGuardEntry = Readonly<{
  id: string;
  name: string;
  themeColor: string;
}>;

async function readPublishedClubThemeGuard(
  database: D1DatabaseLike,
  organizationId: string,
): Promise<Readonly<{
  bindings: readonly (number | string | null)[];
  entries: readonly PublishedClubThemeGuardEntry[];
  sql: string;
}>> {
  const result = await database
    .prepare(
      `SELECT profile.club_id, club.name, detail.theme_color
       FROM club_public_profiles AS profile
       JOIN clubs AS club
         ON club.id = profile.club_id
        AND club.organization_id = profile.organization_id
        AND club.deleted_at IS NULL
       JOIN club_public_profile_details AS detail
         ON detail.club_id = profile.club_id
        AND detail.organization_id = profile.organization_id
       WHERE profile.organization_id = ?
         AND profile.publication_status = 'published'
         AND profile.published_at IS NOT NULL
         AND profile.deleted_at IS NULL
       ORDER BY profile.club_id
       LIMIT 101`,
    )
    .bind(organizationId)
    .all<Record<string, unknown>>();
  const rows = result.results ?? [];
  if (rows.length > 100) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "The published club contrast check exceeded its safe bound.",
    );
  }
  const entries = Object.freeze(
    rows.map((row) =>
      Object.freeze({
        id: requiredString(row.club_id),
        name: requiredString(row.name).slice(0, 120),
        themeColor: requiredString(row.theme_color),
      }),
    ),
  );
  const expectedJson = canonicalJson(
    entries.map((entry) =>
      Object.freeze({ id: entry.id, themeColor: entry.themeColor }),
    ),
  );
  const sql = `(
    SELECT count(*)
    FROM club_public_profiles AS profile
    JOIN clubs AS club
      ON club.id = profile.club_id
     AND club.organization_id = profile.organization_id
     AND club.deleted_at IS NULL
    JOIN club_public_profile_details AS detail
      ON detail.club_id = profile.club_id
     AND detail.organization_id = profile.organization_id
    WHERE profile.organization_id = ?
      AND profile.publication_status = 'published'
      AND profile.published_at IS NOT NULL
      AND profile.deleted_at IS NULL
  ) = json_array_length(?)
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(?) AS expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM club_public_profiles AS profile
      JOIN clubs AS club
        ON club.id = profile.club_id
       AND club.organization_id = profile.organization_id
       AND club.deleted_at IS NULL
      JOIN club_public_profile_details AS detail
        ON detail.club_id = profile.club_id
       AND detail.organization_id = profile.organization_id
      WHERE profile.organization_id = ?
        AND profile.club_id = json_extract(expected.value, '$.id')
        AND detail.theme_color =
            json_extract(expected.value, '$.themeColor')
        AND profile.publication_status = 'published'
        AND profile.published_at IS NOT NULL
        AND profile.deleted_at IS NULL
    )
  )`;
  return Object.freeze({
    bindings: Object.freeze([
      organizationId,
      expectedJson,
      expectedJson,
      organizationId,
    ]),
    entries,
    sql,
  });
}

async function legalPublicationStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  state: CmsStateRow,
  revision: CmsRevisionRow,
  now: number,
) {
  const snapshot = revision.snapshot as CmsLegalStatusSnapshot;
  assertLegalStatusSnapshotCoherent(snapshot);
  const confirmed = await database
    .prepare(
      `SELECT confirmation.id
       FROM legal_status_confirmation_receipts AS confirmation
       WHERE confirmation.organization_id = ?
         AND confirmation.revision_id = ?
         AND confirmation.revision_hash = ?
         AND confirmation.action = 'confirmed'
         AND NOT EXISTS (
           SELECT 1
           FROM legal_status_confirmation_receipts AS revocation
           WHERE revocation.organization_id = confirmation.organization_id
             AND revocation.action = 'revoked'
             AND revocation.revokes_receipt_id = confirmation.id
         )
       LIMIT 1`,
    )
    .bind(actor.organizationId, revision.id, revision.contentHash)
    .first<Record<string, unknown>>();
  if (!confirmed) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "The exact legal-status revision requires Owner confirmation.",
    );
  }
  const guard = publishedProjectionGuard(
    state,
    actor,
    revision.id,
    ["owner"],
  );
  const statement = database
    .prepare(
      `INSERT INTO site_settings (
         id, organization_id, key, value_json, is_public,
         updated_by_profile_id, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, 1, ?, ?, ?
       WHERE ${guard.sql}
         AND EXISTS (
           SELECT 1
           FROM legal_status_confirmation_receipts AS confirmation
           WHERE confirmation.id = ?
             AND confirmation.organization_id = ?
             AND confirmation.revision_id = ?
             AND confirmation.revision_hash = ?
             AND confirmation.action = 'confirmed'
             AND NOT EXISTS (
               SELECT 1
               FROM legal_status_confirmation_receipts AS revocation
               WHERE revocation.organization_id =
                     confirmation.organization_id
                 AND revocation.action = 'revoked'
                 AND revocation.revokes_receipt_id = confirmation.id
             )
         )
       ON CONFLICT(organization_id, key) DO UPDATE SET
         value_json = excluded.value_json,
         is_public = 1,
         updated_by_profile_id = excluded.updated_by_profile_id,
         updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      actor.organizationId,
      PUBLIC_LEGAL_SETTING_KEY,
      canonicalJson(snapshot),
      actor.profileId,
      now,
      now,
      ...guard.bindings,
      requiredString(confirmed.id),
      actor.organizationId,
      revision.id,
      revision.contentHash,
    );
  return requiredOnly(
    statement,
    projectionCompletion(
      `EXISTS (
         SELECT 1
         FROM site_settings AS setting
         WHERE setting.organization_id = ?
           AND setting.key = ?
           AND setting.value_json = ?
           AND setting.is_public = 1
       )
       AND EXISTS (
         SELECT 1
         FROM legal_status_confirmation_receipts AS confirmation
         WHERE confirmation.organization_id = ?
           AND confirmation.revision_id = ?
           AND confirmation.revision_hash = ?
           AND confirmation.action = 'confirmed'
           AND NOT EXISTS (
             SELECT 1
             FROM legal_status_confirmation_receipts AS revocation
             WHERE revocation.organization_id =
                   confirmation.organization_id
               AND revocation.action = 'revoked'
               AND revocation.revokes_receipt_id = confirmation.id
           )
       )`,
      actor.organizationId,
      PUBLIC_LEGAL_SETTING_KEY,
      canonicalJson(snapshot),
      actor.organizationId,
      revision.id,
      revision.contentHash,
    ),
    true,
    canonicalJson({
      setting: {
        key: PUBLIC_LEGAL_SETTING_KEY,
        valueJson: canonicalJson(snapshot),
      },
    }),
  );
}

async function validateClubSnapshotReferences(
  database: D1DatabaseLike,
  organizationId: string,
  clubId: string,
  snapshot: CmsClubProfileSnapshot,
): Promise<void> {
  const row = await database
    .prepare(
      `SELECT club.id
       FROM clubs AS club
       JOIN event_lanes AS lane
         ON lane.id = ?
        AND lane.organization_id = club.organization_id
        AND lane.deleted_at IS NULL
       WHERE club.id = ?
         AND club.organization_id = ?
         AND club.deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(snapshot.laneId, clubId, organizationId)
    .first<Record<string, unknown>>();
  if (!row) throw notFound();
}

async function validateProgramSnapshotReferences(
  database: D1DatabaseLike,
  organizationId: string,
  programId: string | null,
  snapshot: CmsProgramProfileSnapshot,
  requirePublishedClub = false,
): Promise<void> {
  const row = await database
    .prepare(
      `SELECT club.id
       FROM clubs AS club
       JOIN event_lanes AS lane
         ON lane.id = ?
        AND lane.organization_id = club.organization_id
        AND lane.deleted_at IS NULL
       WHERE club.id = ?
         AND club.organization_id = ?
         AND club.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM club_public_profiles AS archived_profile
           WHERE archived_profile.club_id = club.id
             AND archived_profile.organization_id = club.organization_id
             AND archived_profile.publication_status = 'archived'
             AND archived_profile.deleted_at IS NULL
         )
         AND (
           ? = 0
           OR EXISTS (
             SELECT 1
             FROM club_public_profiles AS published_profile
             WHERE published_profile.club_id = club.id
               AND published_profile.organization_id =
                   club.organization_id
               AND published_profile.publication_status = 'published'
               AND published_profile.published_at IS NOT NULL
               AND published_profile.deleted_at IS NULL
           )
         )
         AND (
           ? IS NULL
           OR EXISTS (
             SELECT 1
             FROM programs AS program
             WHERE program.id = ?
               AND program.organization_id = club.organization_id
               AND program.club_id = club.id
               AND program.deleted_at IS NULL
           )
         )
       LIMIT 1`,
    )
    .bind(
      snapshot.laneId,
      snapshot.clubId,
      organizationId,
      requirePublishedClub ? 1 : 0,
      programId,
      programId,
    )
    .first<Record<string, unknown>>();
  if (!row) throw notFound();
}

async function assertPageSlugMutationAllowed(
  database: D1DatabaseLike,
  organizationId: string,
  pageId: string,
  proposedSlug: string,
): Promise<void> {
  const row = await database
    .prepare(
      `SELECT slug
       FROM pages
       WHERE id = ?
         AND organization_id = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(pageId, organizationId)
    .first<Record<string, unknown>>();
  if (!row) throw notFound();
  const currentSlug = requiredString(row.slug);
  if (
    IMMUTABLE_PAGE_SLUGS.has(currentSlug) &&
    proposedSlug !== currentSlug
  ) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "This established public page slug cannot be changed.",
    );
  }
}

async function assertPageCanUnpublish(
  database: D1DatabaseLike,
  organizationId: string,
  pageId: string,
): Promise<void> {
  const row = await database
    .prepare(
      `SELECT slug
       FROM pages
       WHERE id = ?
         AND organization_id = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(pageId, organizationId)
    .first<Record<string, unknown>>();
  if (!row) throw notFound();
  if (REQUIRED_SYSTEM_PAGE_SLUGS.has(requiredString(row.slug))) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "Required public pages cannot be unpublished.",
    );
  }
  const dependencies = await readPublishedProfileResourceDependencies(
    database,
    organizationId,
    pageId,
  );
  if (dependencies.length > 0) {
    const visible = dependencies.slice(0, 5).join(", ");
    const remainder =
      dependencies.length > 5
        ? ` and ${dependencies.length - 5} more`
        : "";
    throw new SafeApplicationError(
      "conflict",
      409,
      `This page is still used by published Club or Program profiles: ${visible}${remainder}. Remove those related-resource selections and publish the profile updates first.`,
    );
  }
}

async function assertClubProfileCanLeavePublic(
  database: D1DatabaseLike,
  organizationId: string,
  clubId: string,
  nowUtcMs: number,
  todayDate: string,
): Promise<void> {
  const guard = clubProfilePublicationDependencyGuard(
    organizationId,
    clubId,
    nowUtcMs,
    todayDate,
  );
  const row = await database
    .prepare(`SELECT CASE WHEN ${guard.sql} THEN 1 ELSE 0 END AS allowed`)
    .bind(...guard.bindings)
    .first<Record<string, unknown>>();
  if (row?.allowed === 1) return;
  throw new SafeApplicationError(
    "conflict",
    409,
    "This club still has an active public event. Complete or cancel future public events before archiving its profile.",
  );
}

async function assertProgramProfileCanArchive(
  database: D1DatabaseLike,
  organizationId: string,
  programId: string,
  nowUtcMs: number,
  todayDate: string,
): Promise<void> {
  const guard = programProfileArchiveDependencyGuard(
    organizationId,
    programId,
    nowUtcMs,
    todayDate,
  );
  const row = await database
    .prepare(`SELECT CASE WHEN ${guard.sql} THEN 1 ELSE 0 END AS allowed`)
    .bind(...guard.bindings)
    .first<Record<string, unknown>>();
  if (row?.allowed === 1) return;
  throw new SafeApplicationError(
    "conflict",
    409,
    "This program still has an upcoming public event. Complete, cancel, or move those events before archiving the program.",
  );
}

async function assertProgramProfileCanDelete(
  database: D1DatabaseLike,
  organizationId: string,
  programId: string,
): Promise<void> {
  const guard = programProfileDeleteDependencyGuard(
    organizationId,
    programId,
  );
  const row = await database
    .prepare(`SELECT CASE WHEN ${guard.sql} THEN 1 ELSE 0 END AS allowed`)
    .bind(...guard.bindings)
    .first<Record<string, unknown>>();
  if (row?.allowed === 1) return;
  throw new SafeApplicationError(
    "conflict",
    409,
    "This Program is still referenced by an event. Remove every planning and public-event reference before deleting it.",
  );
}

function programProfileDeleteDependencyGuard(
  organizationId: string,
  programId: string,
): Readonly<{ bindings: readonly string[]; sql: string }> {
  return Object.freeze({
    bindings: Object.freeze([
      organizationId,
      programId,
      organizationId,
      programId,
    ]),
    sql: `NOT EXISTS (
      SELECT 1
      FROM organizer_events AS event
      WHERE event.organization_id = ?
        AND event.program_id = ?
    )
    AND NOT EXISTS (
      SELECT 1
      FROM events AS event
      WHERE event.organization_id = ?
        AND event.program_id = ?
    )`,
  });
}

function programProfileArchiveDependencyGuard(
  organizationId: string,
  programId: string,
  nowUtcMs: number,
  todayDate: string,
): Readonly<{
  bindings: readonly (number | string)[];
  sql: string;
}> {
  const futureSchedule = (alias: string) => `(
    (
      ${alias}.schedule_shape = 'timed'
      AND ${alias}.ends_at_utc > ?
    )
    OR (
      ${alias}.schedule_shape = 'all_day'
      AND ${alias}.all_day_end_date_exclusive > ?
    )
  )`;
  const futureLegacySchedule = (alias: string) => `(
    (
      ${alias}.time_kind = 'timed'
      AND ${alias}.ends_at_utc > ?
    )
    OR (
      ${alias}.time_kind = 'all_day'
      AND ${alias}.all_day_end_date_exclusive > ?
    )
  )`;
  return Object.freeze({
    bindings: Object.freeze([
      organizationId,
      programId,
      nowUtcMs,
      todayDate,
      organizationId,
      programId,
      nowUtcMs,
      todayDate,
      programId,
      organizationId,
      nowUtcMs,
      todayDate,
    ]),
    sql: `NOT EXISTS (
      SELECT 1
      FROM organizer_events AS event
      WHERE event.organization_id = ?
        AND event.program_id = ?
        AND event.publication_status = 'published'
        AND event.planning_status NOT IN (
          'cancelled', 'completed', 'archived'
        )
        AND event.deleted_at IS NULL
        AND ${futureSchedule("event")}
    )
    AND NOT EXISTS (
      SELECT 1
      FROM events AS event
      WHERE event.organization_id = ?
        AND event.program_id = ?
        AND event.visibility = 'public'
        AND event.published_at IS NOT NULL
        AND event.status NOT IN ('cancelled', 'archived')
        AND event.deleted_at IS NULL
        AND ${futureLegacySchedule("event")}
        AND NOT EXISTS (
          SELECT 1
          FROM meetup_event_snapshots AS snapshot
          WHERE snapshot.organization_id = event.organization_id
            AND snapshot.event_id = event.id
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM sync_sources AS source
      JOIN meetup_sync_generations AS generation
        ON generation.id = source.active_generation_id
       AND generation.organization_id = source.organization_id
       AND generation.sync_source_id = source.id
       AND generation.state = 'published'
       AND generation.published_at IS NOT NULL
       AND generation.processed_item_count =
           generation.expected_item_count
      JOIN meetup_event_snapshots AS snapshot
        ON snapshot.organization_id = source.organization_id
       AND snapshot.sync_source_id = source.id
       AND snapshot.generation_id = generation.id
      JOIN events AS event
        ON event.id = snapshot.event_id
       AND event.organization_id = snapshot.organization_id
       AND event.program_id = ?
       AND event.visibility = 'public'
       AND event.published_at IS NOT NULL
       AND event.deleted_at IS NULL
      WHERE source.organization_id = ?
        AND source.source_type = 'meetup_ics'
        AND source.enabled = 1
        AND source.deleted_at IS NULL
        AND snapshot.status IN ('confirmed', 'tentative')
        AND ${futureLegacySchedule("event")}
    )`,
  });
}

function clubProfilePublicationDependencyGuard(
  organizationId: string,
  clubId: string,
  nowUtcMs: number,
  todayDate: string,
): Readonly<{
  bindings: readonly (number | string)[];
  sql: string;
}> {
  const futureSchedule = (alias: string) => `(
    (
      ${alias}.schedule_shape = 'timed'
      AND ${alias}.ends_at_utc > ?
    )
    OR (
      ${alias}.schedule_shape = 'all_day'
      AND ${alias}.all_day_end_date_exclusive > ?
    )
  )`;
  const futureLegacySchedule = (alias: string) => `(
    (
      ${alias}.time_kind = 'timed'
      AND ${alias}.ends_at_utc > ?
    )
    OR (
      ${alias}.time_kind = 'all_day'
      AND ${alias}.all_day_end_date_exclusive > ?
    )
  )`;
  return Object.freeze({
    bindings: Object.freeze([
      organizationId,
      clubId,
      nowUtcMs,
      todayDate,
      organizationId,
      clubId,
      nowUtcMs,
      todayDate,
      organizationId,
      clubId,
      nowUtcMs,
      todayDate,
    ]),
    sql: `NOT EXISTS (
      SELECT 1
      FROM organizer_events AS event
      WHERE event.organization_id = ?
        AND event.club_id = ?
        AND event.publication_status = 'published'
        AND event.planning_status NOT IN (
          'cancelled', 'completed', 'archived'
        )
        AND event.deleted_at IS NULL
        AND ${futureSchedule("event")}
    )
    AND NOT EXISTS (
      SELECT 1
      FROM events AS event
      WHERE event.organization_id = ?
        AND event.club_id = ?
        AND event.visibility = 'public'
        AND event.published_at IS NOT NULL
        AND event.status NOT IN ('cancelled', 'archived')
        AND event.deleted_at IS NULL
        AND ${futureLegacySchedule("event")}
        AND NOT EXISTS (
          SELECT 1
          FROM meetup_event_snapshots AS snapshot
          WHERE snapshot.organization_id = event.organization_id
            AND snapshot.event_id = event.id
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM sync_sources AS source
      JOIN meetup_sync_generations AS generation
        ON generation.id = source.active_generation_id
       AND generation.organization_id = source.organization_id
       AND generation.sync_source_id = source.id
       AND generation.state = 'published'
       AND generation.published_at IS NOT NULL
       AND generation.processed_item_count =
           generation.expected_item_count
      JOIN meetup_event_snapshots AS snapshot
        ON snapshot.organization_id = source.organization_id
       AND snapshot.sync_source_id = source.id
       AND snapshot.generation_id = generation.id
      JOIN events AS event
        ON event.id = snapshot.event_id
       AND event.organization_id = snapshot.organization_id
       AND event.club_id = source.club_id
       AND event.visibility = 'public'
       AND event.published_at IS NOT NULL
       AND event.deleted_at IS NULL
      WHERE source.organization_id = ?
        AND source.club_id = ?
        AND source.source_type = 'meetup_ics'
        AND source.enabled = 1
        AND source.deleted_at IS NULL
        AND snapshot.status IN ('confirmed', 'tentative')
        AND ${futureLegacySchedule("event")}
    )`,
  });
}

function pageUnpublishDependencyGuard(
  organizationId: string,
  pageId: string,
): Readonly<{ bindings: readonly string[]; sql: string }> {
  return Object.freeze({
    bindings: Object.freeze([
      organizationId,
      pageId,
      organizationId,
      pageId,
    ]),
    sql: `NOT EXISTS (
      SELECT 1
      FROM cms_entity_publication_states AS club_state
      JOIN cms_entity_revisions AS club_revision
        ON club_revision.id = club_state.published_revision_id
       AND club_revision.organization_id = club_state.organization_id
       AND club_revision.publication_state_id = club_state.id
       AND club_revision.entity_type = 'club_public_profile'
       AND club_revision.entity_key = club_state.entity_key
      WHERE club_state.organization_id = ?
        AND club_state.entity_type = 'club_public_profile'
        AND club_state.workflow_status = 'published'
        AND club_state.published_revision_id IS NOT NULL
        AND json_valid(club_revision.snapshot_json)
        AND EXISTS (
          SELECT 1
          FROM json_each(
            json_extract(
              club_revision.snapshot_json,
              '$.relatedResourceIds'
            )
          ) AS resource
          WHERE resource.type = 'text'
            AND resource.value = ?
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM cms_entity_publication_states AS program_state
      JOIN cms_entity_revisions AS program_revision
        ON program_revision.id = program_state.published_revision_id
       AND program_revision.organization_id =
           program_state.organization_id
       AND program_revision.publication_state_id = program_state.id
       AND program_revision.entity_type = 'program_public_profile'
       AND program_revision.entity_key = program_state.entity_key
      WHERE program_state.organization_id = ?
        AND program_state.entity_type = 'program_public_profile'
        AND program_state.workflow_status = 'published'
        AND program_state.published_revision_id IS NOT NULL
        AND json_valid(program_revision.snapshot_json)
        AND EXISTS (
          SELECT 1
          FROM json_each(
            json_extract(
              program_revision.snapshot_json,
              '$.relatedResourceIds'
            )
          ) AS resource
          WHERE resource.type = 'text'
            AND resource.value = ?
        )
    )`,
  });
}

async function readPublishedProfileResourceDependencies(
  database: D1DatabaseLike,
  organizationId: string,
  pageId: string,
): Promise<readonly string[]> {
  const result = await database
    .prepare(
      `SELECT dependency_name
       FROM (
         SELECT COALESCE(
                  NULLIF(trim(detail.public_display_name), ''),
                  club.name
                ) AS dependency_name,
                club.id AS dependency_id
         FROM cms_entity_publication_states AS state
         JOIN cms_entity_revisions AS revision
           ON revision.id = state.published_revision_id
          AND revision.organization_id = state.organization_id
          AND revision.publication_state_id = state.id
          AND revision.entity_type = 'club_public_profile'
          AND revision.entity_key = state.entity_key
         JOIN clubs AS club
           ON club.id = state.entity_key
          AND club.organization_id = state.organization_id
          AND club.deleted_at IS NULL
         LEFT JOIN club_public_profile_details AS detail
           ON detail.club_id = club.id
          AND detail.organization_id = club.organization_id
         WHERE state.organization_id = ?
           AND state.entity_type = 'club_public_profile'
           AND state.workflow_status = 'published'
           AND state.published_revision_id IS NOT NULL
           AND json_valid(revision.snapshot_json)
           AND EXISTS (
             SELECT 1
             FROM json_each(
               json_extract(revision.snapshot_json, '$.relatedResourceIds')
             ) AS resource
             WHERE resource.type = 'text'
               AND resource.value = ?
           )
         UNION ALL
         SELECT COALESCE(
                  NULLIF(trim(detail.public_display_name), ''),
                  program.name
                ) AS dependency_name,
                program.id AS dependency_id
         FROM cms_entity_publication_states AS state
         JOIN cms_entity_revisions AS revision
           ON revision.id = state.published_revision_id
          AND revision.organization_id = state.organization_id
          AND revision.publication_state_id = state.id
          AND revision.entity_type = 'program_public_profile'
          AND revision.entity_key = state.entity_key
         JOIN programs AS program
           ON program.id = state.entity_key
          AND program.organization_id = state.organization_id
          AND program.deleted_at IS NULL
         LEFT JOIN program_public_profile_details AS detail
           ON detail.program_id = program.id
          AND detail.organization_id = program.organization_id
          AND detail.deleted_at IS NULL
         WHERE state.organization_id = ?
           AND state.entity_type = 'program_public_profile'
           AND state.workflow_status = 'published'
           AND state.published_revision_id IS NOT NULL
           AND json_valid(revision.snapshot_json)
           AND EXISTS (
             SELECT 1
             FROM json_each(
               json_extract(revision.snapshot_json, '$.relatedResourceIds')
             ) AS resource
             WHERE resource.type = 'text'
               AND resource.value = ?
           )
       )
       ORDER BY dependency_name COLLATE NOCASE, dependency_id
       LIMIT 101`,
    )
    .bind(organizationId, pageId, organizationId, pageId)
    .all<Record<string, unknown>>();
  return Object.freeze(
    (result.results ?? []).map((dependency) =>
      requiredString(dependency.dependency_name).slice(0, 120),
    ),
  );
}

function cmsMediaUsageGroups(
  organizationId: string,
  entityType: CmsEntityType,
  entityKey: string,
  snapshot: CmsSnapshot,
): readonly CmsMediaUsageGroup[] {
  if (entityType === "page") {
    const page = snapshot as CmsPageSnapshot;
    return Object.freeze([
      Object.freeze({
        entityId: entityKey,
        entityType: "page" as const,
        usages: Object.freeze(
          [
            ...page.blocks.flatMap((block) =>
              block.type === "media" &&
              typeof block.config.assetId === "string"
                ? [
                    Object.freeze({
                      assetId: block.config.assetId,
                      usageKind: `block:${block.id}`.slice(0, 64),
                    }),
                  ]
                : [],
            ),
            ...(page.openGraphAssetId
              ? [
                  Object.freeze({
                    assetId: page.openGraphAssetId,
                    usageKind: "open_graph",
                  }),
                ]
              : []),
          ],
        ),
      }),
    ]);
  }
  if (entityType === "club_public_profile") {
    const club = snapshot as CmsClubProfileSnapshot;
    return Object.freeze([
      Object.freeze({
        entityId: entityKey,
        entityType: "club_public_profile" as const,
        usages: Object.freeze([
          ...(club.coverAssetId
            ? [
                Object.freeze({
                  assetId: club.coverAssetId,
                  usageKind: "cover",
                }),
              ]
            : []),
          ...(club.thumbnailAssetId
            ? [
                Object.freeze({
                  assetId: club.thumbnailAssetId,
                  usageKind: "thumbnail",
                }),
              ]
            : []),
          ...(club.openGraphAssetId
            ? [
                Object.freeze({
                  assetId: club.openGraphAssetId,
                  usageKind: "open_graph",
                }),
              ]
            : []),
        ]),
      }),
    ]);
  }
  if (entityType === "program_public_profile") {
    const program = snapshot as CmsProgramProfileSnapshot;
    return Object.freeze([
      Object.freeze({
        entityId: entityKey,
        entityType: "program_public_profile" as const,
        usages: Object.freeze([
          ...(program.coverAssetId
            ? [
                Object.freeze({
                  assetId: program.coverAssetId,
                  usageKind: "cover",
                }),
              ]
            : []),
          ...(program.thumbnailAssetId
            ? [
                Object.freeze({
                  assetId: program.thumbnailAssetId,
                  usageKind: "thumbnail",
                }),
              ]
            : []),
          ...(program.openGraphAssetId
            ? [
                Object.freeze({
                  assetId: program.openGraphAssetId,
                  usageKind: "open_graph",
                }),
              ]
            : []),
        ]),
      }),
    ]);
  }
  if (entityType === "site_identity") {
    const site = snapshot as CmsSiteIdentitySnapshot;
    return Object.freeze([
      Object.freeze({
        entityId: organizationId,
        entityType: "site_logo" as const,
        usages: Object.freeze(
          site.logoAssetId
            ? [
                Object.freeze({
                  assetId: site.logoAssetId,
                  usageKind: "logo",
                }),
              ]
            : [],
        ),
      }),
      Object.freeze({
        entityId: organizationId,
        entityType: "site_og" as const,
        usages: Object.freeze(
          site.openGraphAssetId
            ? [
                Object.freeze({
                  assetId: site.openGraphAssetId,
                  usageKind: "open_graph",
                }),
              ]
            : [],
        ),
      }),
    ]);
  }
  if (entityType === "community_link") {
    return Object.freeze([
      Object.freeze({
        entityId: entityKey,
        entityType: "community_link" as const,
        usages: Object.freeze([]),
      }),
    ]);
  }
  return Object.freeze([]);
}

async function validateCmsMediaUsageGroups(
  database: D1DatabaseLike,
  organizationId: string,
  groups: readonly CmsMediaUsageGroup[],
  publicationScope: "draft" | "published",
): Promise<ReadonlyMap<string, PublicReadyMediaAsset>> {
  const assetIds = [
    ...new Set(
      groups.flatMap((group) =>
        group.usages.map((usage) => usage.assetId),
      ),
    ),
  ];
  const assets = await validateMediaAssetsForUsage(database, {
    assetIds,
    maximumAssetCount: groups.some(
      (group) => group.entityType === "page",
    )
      ? 25
      : 24,
    organizationId,
    publicationScope,
    requireUsefulAltAssetIds: groups.flatMap((group) =>
      group.usages.flatMap((usage) =>
        usage.usageKind === "open_graph" ||
        usage.usageKind === "cover" ||
        usage.usageKind === "thumbnail"
          ? [usage.assetId]
          : [],
      ),
    ),
  });
  return new Map(assets.map((asset) => [asset.assetId, asset]));
}

function prepareArchivedPublishedMediaRetention(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  groups: readonly CmsMediaUsageGroup[],
  input: Readonly<{
    entityId: string;
    entityType: "club_public_profile" | "program_public_profile";
    now: number;
    revisionId: string | null;
  }>,
): Readonly<{
  integrity: Readonly<{
    bindings: readonly D1Value[];
    sql: string;
  }>;
  retirementStatement: D1PreparedStatementLike;
}> {
  const expected = groups.flatMap((group) => {
    if (
      group.entityId !== input.entityId ||
      group.entityType !== input.entityType
    ) {
      throw new Error("Unexpected archived media usage scope.");
    }
    return group.usages.map((usage) =>
      Object.freeze({
        assetId: usage.assetId,
        usageKind: usage.usageKind,
      }),
    );
  });
  const expectedJson = JSON.stringify(expected);
  const actorGuard = cmsActorGuard("owner", "administrator");
  const retirementStatement = database
    .prepare(
      `UPDATE media_usage_references
       SET deleted_at = ?
       WHERE organization_id = ?
         AND entity_type = ?
         AND entity_id = ?
         AND publication_scope = 'published'
         AND deleted_at IS NULL
         AND NOT (
           revision_id IS ?
           AND EXISTS (
             SELECT 1
             FROM json_each(?) AS expected
             WHERE json_extract(expected.value, '$.assetId') =
                   media_usage_references.asset_id
               AND json_extract(expected.value, '$.usageKind') =
                   media_usage_references.usage_kind
           )
         )
         AND ${actorGuard.sql}`,
    )
    .bind(
      input.now,
      actor.organizationId,
      input.entityType,
      input.entityId,
      input.revisionId,
      expectedJson,
      ...actorGuard.bindings(actor),
    );
  return Object.freeze({
    integrity: Object.freeze({
      bindings: Object.freeze([
        actor.organizationId,
        input.entityType,
        input.entityId,
        input.revisionId,
        expectedJson,
        expectedJson,
        actor.organizationId,
        input.entityType,
        input.entityId,
        input.revisionId,
      ]),
      sql: `NOT EXISTS (
        SELECT 1
        FROM media_usage_references AS active_usage
        WHERE active_usage.organization_id = ?
          AND active_usage.entity_type = ?
          AND active_usage.entity_id = ?
          AND active_usage.publication_scope = 'published'
          AND active_usage.deleted_at IS NULL
          AND (
            active_usage.revision_id IS NOT ?
            OR NOT EXISTS (
              SELECT 1
              FROM json_each(?) AS expected
              WHERE json_extract(expected.value, '$.assetId') =
                    active_usage.asset_id
                AND json_extract(expected.value, '$.usageKind') =
                    active_usage.usage_kind
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(?) AS expected
        WHERE NOT EXISTS (
          SELECT 1
          FROM media_usage_references AS active_usage
          WHERE active_usage.organization_id = ?
            AND active_usage.entity_type = ?
            AND active_usage.entity_id = ?
            AND active_usage.revision_id IS ?
            AND active_usage.usage_kind =
                json_extract(expected.value, '$.usageKind')
            AND active_usage.asset_id =
                json_extract(expected.value, '$.assetId')
            AND active_usage.publication_scope = 'published'
            AND active_usage.deleted_at IS NULL
        )
      )`,
    }),
    retirementStatement,
  });
}

function prepareCmsMediaReconciliation(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  groups: readonly CmsMediaUsageGroup[],
  input: Readonly<{
    now: number;
    publicationScope: "draft" | "published";
    revisionId: string;
  }>,
): Readonly<{
  insertCount: number;
  materializationStatements: readonly D1PreparedStatementLike[];
  requiredRelativeChanges: readonly Readonly<{
    changes: number;
    index: number;
  }>[];
  requiredMaterializationChanges: readonly Readonly<{
    changes: number;
    index: number;
  }>[];
  retirementStatements: readonly D1PreparedStatementLike[];
  statements: readonly D1PreparedStatementLike[];
}> {
  const statements: D1PreparedStatementLike[] = [];
  const retirementStatements: D1PreparedStatementLike[] = [];
  const materializationStatements: D1PreparedStatementLike[] = [];
  const requiredRelativeChanges: Readonly<{
    changes: number;
    index: number;
  }>[] = [];
  const requiredMaterializationChanges: Readonly<{
    changes: number;
    index: number;
  }>[] = [];
  let insertCount = 0;
  for (const group of groups) {
    const prepared = prepareMediaUsageReconciliation(database, actor, {
      entityId: group.entityId,
      entityType: group.entityType,
      maximumUsageCount: group.entityType === "page" ? 25 : 24,
      nowUtcMs: input.now,
      publicationScope: input.publicationScope,
      revisionId: input.revisionId,
      usages: group.usages,
    });
    const offset = statements.length;
    statements.push(...prepared.statements);
    const retirementStatement = prepared.statements[0];
    if (!retirementStatement || prepared.statements.length !== 3) {
      throw new Error("Unexpected CMS media reconciliation statement shape.");
    }
    retirementStatements.push(retirementStatement);
    const materializationOffset = materializationStatements.length;
    materializationStatements.push(...prepared.statements.slice(1));
    requiredRelativeChanges.push(
      Object.freeze({
        changes: prepared.insertStatementCount,
        index: offset + prepared.insertStatementIndex,
      }),
    );
    requiredMaterializationChanges.push(
      Object.freeze({
        changes: prepared.insertStatementCount,
        index: materializationOffset,
      }),
      Object.freeze({
        changes: 1,
        index: materializationOffset + 1,
      }),
    );
    requiredRelativeChanges.push(
      Object.freeze({
        changes: 1,
        index: offset + prepared.statements.length - 1,
      }),
    );
    insertCount += prepared.insertStatementCount;
  }
  return Object.freeze({
    insertCount,
    materializationStatements: Object.freeze(materializationStatements),
    requiredRelativeChanges: Object.freeze(requiredRelativeChanges),
    requiredMaterializationChanges: Object.freeze(
      requiredMaterializationChanges,
    ),
    retirementStatements: Object.freeze(retirementStatements),
    statements: Object.freeze(statements),
  });
}

async function publishedPageExists(
  database: D1DatabaseLike,
  organizationId: string,
  slug: string,
): Promise<boolean> {
  return Boolean(
    await database
      .prepare(
        `SELECT id
         FROM pages
         WHERE organization_id = ?
           AND slug = ?
           AND status = 'published'
           AND visibility = 'public'
           AND published_at IS NOT NULL
           AND deleted_at IS NULL
         LIMIT 1`,
      )
      .bind(organizationId, slug)
      .first<Record<string, unknown>>(),
  );
}

async function authorizeCmsActor(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
): Promise<AuthorizedMembership> {
  return authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
}

async function sealCmsReadActor(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  expected: AuthorizedMembership,
): Promise<void> {
  await revalidateAuthorizedMembership(database, identity, expected, {
    allowedRoles: ["owner", "administrator"],
  });
}

async function cmsWorkspacePermissions(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  state: CmsStateRow,
  currentSnapshot: CmsSnapshot | null,
): Promise<CmsEntityWorkspaceDto["permissions"]> {
  const isOwner = actor.role === "owner";
  const ownerOnly = state.entityType === "legal_status";
  const isArchivedClub =
    state.entityType === "club_public_profile" &&
    state.workflowStatus === "archived";
  const isArchivedProgram =
    state.entityType === "program_public_profile" &&
    state.workflowStatus === "archived";
  const isArchivedPublicProfile = isArchivedClub || isArchivedProgram;
  let canDelete = false;
  if (isArchivedProgram && state.publishedRevisionId === null) {
    const dependencyGuard = programProfileDeleteDependencyGuard(
      actor.organizationId,
      state.entityKey,
    );
    canDelete = Boolean(
      await database
        .prepare(
          `SELECT program.id
           FROM programs AS program
           JOIN program_public_profile_details AS detail
             ON detail.program_id = program.id
            AND detail.organization_id = program.organization_id
            AND detail.publication_status = 'archived'
            AND detail.published_at IS NULL
            AND detail.deleted_at IS NULL
           WHERE program.id = ?
             AND program.organization_id = ?
             AND program.deleted_at IS NULL
             AND (${dependencyGuard.sql})
           LIMIT 1`,
        )
        .bind(
          state.entityKey,
          actor.organizationId,
          ...dependencyGuard.bindings,
        )
        .first<Record<string, unknown>>(),
    );
  }
  let canChangeSlug =
    (
      state.entityType === "club_public_profile" ||
      state.entityType === "program_public_profile"
    ) &&
    !isArchivedPublicProfile;
  let canUnpublish =
    state.workflowStatus === "published" &&
    state.entityType !== "site_identity" &&
    (!ownerOnly || isOwner);
  if (state.entityType === "page") {
    const row = await database
      .prepare(
        `SELECT slug
         FROM pages
         WHERE id = ?
           AND organization_id = ?
           AND deleted_at IS NULL
         LIMIT 1`,
      )
      .bind(state.entityKey, actor.organizationId)
      .first<Record<string, unknown>>();
    if (!row) throw notFound();
    const slug = requiredString(row.slug);
    canChangeSlug = !IMMUTABLE_PAGE_SLUGS.has(slug);
    canUnpublish = !REQUIRED_SYSTEM_PAGE_SLUGS.has(slug);
    canUnpublish =
      canUnpublish && state.workflowStatus === "published";
  }
  let currentLegalConfirmationActive = false;
  let publishedLegalConfirmationActive = false;
  if (ownerOnly) {
    const confirmations = await database
      .prepare(
        `SELECT
           max(
             CASE WHEN confirmation.revision_id IS ? THEN 1 ELSE 0 END
           ) AS current_confirmation_active,
           max(
             CASE WHEN confirmation.revision_id IS ? THEN 1 ELSE 0 END
           ) AS published_confirmation_active
         FROM legal_status_confirmation_receipts AS confirmation
         JOIN cms_entity_revisions AS revision
           ON revision.id = confirmation.revision_id
          AND revision.organization_id = confirmation.organization_id
          AND revision.content_hash = confirmation.revision_hash
         WHERE confirmation.organization_id = ?
           AND confirmation.action = 'confirmed'
           AND NOT EXISTS (
             SELECT 1
             FROM legal_status_confirmation_receipts AS revocation
             WHERE revocation.organization_id =
                   confirmation.organization_id
               AND revocation.action = 'revoked'
               AND revocation.revokes_receipt_id = confirmation.id
           )`,
      )
      .bind(
        state.currentDraftRevisionId,
        state.publishedRevisionId,
        actor.organizationId,
      )
      .first<Record<string, unknown>>();
    currentLegalConfirmationActive =
      confirmations?.current_confirmation_active === 1;
    publishedLegalConfirmationActive =
      confirmations?.published_confirmation_active === 1;
  }
  const hasPublishableDraft =
    state.currentDraftRevisionId !== null &&
    (
      state.workflowStatus !== "published" ||
      state.currentDraftRevisionId !== state.publishedRevisionId
    );
  const currentClubSnapshotReady =
    state.entityType !== "club_public_profile" ||
    (
      currentSnapshot !== null &&
      isClubSnapshotPublicationReady(
        currentSnapshot as CmsClubProfileSnapshot,
      )
    );
  const currentProgramSnapshotReady =
    state.entityType !== "program_public_profile" ||
    (
      currentSnapshot !== null &&
      isProgramSnapshotPublicationReady(
        currentSnapshot as CmsProgramProfileSnapshot,
      )
    );
  return Object.freeze({
    canArchive:
      (
        state.entityType === "club_public_profile" ||
        state.entityType === "program_public_profile"
      ) &&
      (state.workflowStatus === "draft" ||
        state.workflowStatus === "unpublished" ||
        state.workflowStatus === "published"),
    canChangeSlug,
    canConfirmLegal:
      isOwner &&
      ownerOnly &&
      state.currentDraftRevisionId !== null &&
      !currentLegalConfirmationActive,
    canDelete,
    canEdit: !isArchivedPublicProfile,
    canPublish:
      !isArchivedPublicProfile &&
      hasPublishableDraft &&
      currentClubSnapshotReady &&
      currentProgramSnapshotReady &&
      (!ownerOnly || (isOwner && currentLegalConfirmationActive)),
    canRevokeLegal:
      isOwner && ownerOnly && publishedLegalConfirmationActive,
    canRestore: !isArchivedPublicProfile,
    canUnpublish,
  });
}

async function readState(
  database: D1DatabaseLike,
  organizationId: string,
  entityType: CmsEntityType,
  entityKey: string,
): Promise<CmsStateRow | null> {
  const row = await database
    .prepare(
      `SELECT id, entity_type, entity_key, workflow_status, content_version,
              current_draft_revision_id, published_revision_id
       FROM cms_entity_publication_states
       WHERE organization_id = ?
         AND entity_type = ?
         AND entity_key = ?
       LIMIT 1`,
    )
    .bind(organizationId, entityType, entityKey)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return Object.freeze({
    contentVersion: requiredInteger(row.content_version),
    currentDraftRevisionId: optionalString(row.current_draft_revision_id),
    entityKey: requiredString(row.entity_key),
    entityType: parseCmsEntityType(row.entity_type),
    id: requiredString(row.id),
    publishedRevisionId: optionalString(row.published_revision_id),
    workflowStatus: workflowStatus(row.workflow_status),
  });
}

async function readRevision(
  database: D1DatabaseLike,
  organizationId: string,
  state: CmsStateRow,
  revisionId: string,
): Promise<CmsRevisionRow | null> {
  const row = await database
    .prepare(
      `SELECT id, revision_number, snapshot_json, content_hash
       FROM cms_entity_revisions
       WHERE id = ?
         AND organization_id = ?
         AND publication_state_id = ?
         AND entity_type = ?
         AND entity_key = ?
       LIMIT 1`,
    )
    .bind(
      revisionId,
      organizationId,
      state.id,
      state.entityType,
      state.entityKey,
    )
    .first<Record<string, unknown>>();
  if (!row) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(requiredString(row.snapshot_json));
  } catch {
    throw serviceUnavailable();
  }
  return Object.freeze({
    contentHash: requiredString(row.content_hash),
    id: requiredString(row.id),
    revisionNumber: requiredInteger(row.revision_number),
    snapshot: parseSnapshot(state.entityType, raw),
  });
}

async function listCmsEntityRevisionsForActor(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  state: CmsStateRow,
): Promise<readonly CmsRevisionDto[]> {
  const result = await database
    .prepare(
      `SELECT revision.id, revision.revision_number, revision.content_hash,
              revision.restored_from_revision_id, revision.created_at,
              actor_profile.display_name AS actor_display_name
       FROM cms_entity_revisions AS revision
       JOIN profiles AS actor_profile
         ON actor_profile.id = revision.actor_profile_id
       WHERE revision.organization_id = ?
         AND revision.publication_state_id = ?
         AND revision.entity_type = ?
         AND revision.entity_key = ?
       ORDER BY revision.revision_number DESC
       LIMIT ?`,
    )
    .bind(
      actor.organizationId,
      state.id,
      state.entityType,
      state.entityKey,
      CMS_REVISION_LIMIT,
    )
    .all<Record<string, unknown>>();
  return Object.freeze(
    (result.results ?? []).map((row) =>
      Object.freeze({
        actorDisplayName: safeDisplayName(row.actor_display_name),
        contentHash: requiredString(row.content_hash),
        createdAt: requiredInteger(row.created_at),
        id: requiredString(row.id),
        restoredFromRevisionId: optionalString(
          row.restored_from_revision_id,
        ),
        revisionNumber: requiredInteger(row.revision_number),
      }),
    ),
  );
}

function phase7StarterPageSnapshot(
  slug: Phase7StarterCopyPageSlug,
  legacy: boolean,
): CmsPageSnapshot {
  const definition = PUBLIC_CATALOG_PAGES.find(
    (page) => page.slug === slug,
  );
  if (!definition) throw serviceUnavailable();
  const sections = legacy
    ? phase7LegacyStarterSections(definition, slug)
    : definition.sections;
  const blocks = sections.map((section) => ({
    config: section.content,
    id: section.key,
    type: section.type,
  }));
  const summary = firstStarterPageSummary(blocks) ?? definition.title;
  return parsePageSnapshot({
    blocks,
    metaDescription: summary.slice(0, 160),
    openGraphAssetId: null,
    seoTitle: definition.title.slice(0, 60),
    slug,
    title: definition.title,
  });
}

function previousVisitorPrivacyPageSnapshot(): CmsPageSnapshot {
  const definition = PUBLIC_CATALOG_PAGES.find(
    (page) => page.slug === "privacy",
  );
  if (!definition) throw serviceUnavailable();
  const blocks = [
    {
      config: PREVIOUS_VISITOR_PRIVACY_PAGE_CONTENT,
      id: "intro",
      type: "intro",
    },
  ];
  const summary =
    firstStarterPageSummary(blocks) ?? definition.title;
  return parsePageSnapshot({
    blocks,
    metaDescription: summary.slice(0, 160),
    openGraphAssetId: null,
    seoTitle: definition.title.slice(0, 60),
    slug: "privacy",
    title: definition.title,
  });
}

function previousVisitorFeedbackPageSnapshot(): CmsPageSnapshot {
  const definition = PUBLIC_CATALOG_PAGES.find(
    (page) => page.slug === "contact",
  );
  if (!definition) throw serviceUnavailable();
  const blocks = [
    {
      config: PREVIOUS_VISITOR_FEEDBACK_PAGE_CONTENT,
      id: "intro",
      type: "intro",
    },
  ];
  const summary =
    firstStarterPageSummary(blocks) ?? "Contact";
  return parsePageSnapshot({
    blocks,
    metaDescription: summary.slice(0, 160),
    openGraphAssetId: null,
    seoTitle: "Contact",
    slug: "contact",
    title: "Contact",
  });
}

function phase7LegacyStarterSections(
  definition: PublicCatalogPageDefinition,
  slug: Phase7StarterCopyPageSlug,
): PublicCatalogPageDefinition["sections"] {
  const intro = definition.sections.find(
    (section) => section.key === "intro" && section.type === "intro",
  );
  if (!intro || definition.sections.length !== 1) {
    throw serviceUnavailable();
  }
  return Object.freeze([
    Object.freeze({
      ...intro,
      content: LEGACY_PHASE7_STARTER_PAGE_CONTENT[slug],
    }),
  ]);
}

function firstStarterPageSummary(
  blocks: readonly Readonly<{
    config: Readonly<Record<string, unknown>>;
  }>[],
): string | null {
  for (const block of blocks) {
    for (const key of ["text", "heading"] as const) {
      const value = block.config[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    const paragraphs = block.config.paragraphs;
    if (Array.isArray(paragraphs)) {
      const paragraph = paragraphs.find(
        (value) => typeof value === "string" && value.trim(),
      );
      if (typeof paragraph === "string") return paragraph.trim();
    }
  }
  return null;
}

async function readPhase7StarterCopyMarker(
  database: D1DatabaseLike,
): Promise<Readonly<{
  marker: Phase7StarterCopyMarker | null;
  markerJson: string | null;
  organizationId: string;
}> | null> {
  const row = await database
    .prepare(
      `SELECT organization.id AS organization_id,
              marker.value_json AS marker_json
       FROM organizations AS organization
       LEFT JOIN site_settings AS marker
         ON marker.organization_id = organization.id
        AND marker.key = ?
        AND marker.is_public = 0
       WHERE organization.slug = ?
       LIMIT 1`,
    )
    .bind(
      PHASE7_STARTER_COPY_MARKER_KEY,
      PUBLIC_ORGANIZATION_SLUG,
    )
    .first<Record<string, unknown>>();
  if (!row) return null;
  const markerJson = optionalString(row.marker_json);
  return Object.freeze({
    marker: markerJson ? parsePhase7StarterCopyMarker(markerJson) : null,
    markerJson,
    organizationId: requiredString(row.organization_id),
  });
}

async function readVisitorPrivacyCopyMarker(
  database: D1DatabaseLike,
): Promise<Readonly<{
  marker: VisitorPrivacyCopyMarker | null;
  markerJson: string | null;
  organizationId: string;
}> | null> {
  const row = await database
    .prepare(
      `SELECT organization.id AS organization_id,
              marker.value_json AS marker_json
       FROM organizations AS organization
       LEFT JOIN site_settings AS marker
         ON marker.organization_id = organization.id
        AND marker.key = ?
        AND marker.is_public = 0
       WHERE organization.slug = ?
       LIMIT 1`,
    )
    .bind(
      VISITOR_PRIVACY_COPY_MARKER_KEY,
      PUBLIC_ORGANIZATION_SLUG,
    )
    .first<Record<string, unknown>>();
  if (!row) return null;
  const markerJson = optionalString(row.marker_json);
  return Object.freeze({
    marker: markerJson ? parseVisitorPrivacyCopyMarker(markerJson) : null,
    markerJson,
    organizationId: requiredString(row.organization_id),
  });
}

async function readVisitorFeedbackCopyMarker(
  database: D1DatabaseLike,
): Promise<Readonly<{
  marker: VisitorFeedbackCopyMarker | null;
  markerJson: string | null;
  organizationId: string;
}> | null> {
  const row = await database
    .prepare(
      `SELECT organization.id AS organization_id,
              marker.value_json AS marker_json
       FROM organizations AS organization
       LEFT JOIN site_settings AS marker
         ON marker.organization_id = organization.id
        AND marker.key = ?
        AND marker.is_public = 0
       WHERE organization.slug = ?
       LIMIT 1`,
    )
    .bind(
      VISITOR_FEEDBACK_COPY_MARKER_KEY,
      PUBLIC_ORGANIZATION_SLUG,
    )
    .first<Record<string, unknown>>();
  if (!row) return null;
  const markerJson = optionalString(row.marker_json);
  return Object.freeze({
    marker: markerJson ? parseVisitorFeedbackCopyMarker(markerJson) : null,
    markerJson,
    organizationId: requiredString(row.organization_id),
  });
}

function parseVisitorFeedbackCopyMarker(
  value: string,
): VisitorFeedbackCopyMarker {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw serviceUnavailable();
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    Reflect.get(raw, "version") !==
      VISITOR_FEEDBACK_COPY_UPGRADE_VERSION
  ) {
    throw serviceUnavailable();
  }
  const outcome = Reflect.get(raw, "outcome");
  const reason = Reflect.get(raw, "reason");
  const contentHashValue = Reflect.get(raw, "contentHash");
  if (
    (outcome !== "skipped" && outcome !== "upgraded") ||
    !(
      reason === "already_current" ||
      reason === "legacy_copy_upgraded" ||
      reason === "newer_draft_preserved" ||
      reason === "nonlegacy_copy_preserved" ||
      reason === "page_unavailable"
    ) ||
    !(
      contentHashValue === null ||
      (
        typeof contentHashValue === "string" &&
        /^[a-f0-9]{64}$/u.test(contentHashValue)
      )
    )
  ) {
    throw serviceUnavailable();
  }
  return Object.freeze({
    completedAt: safeNonnegativeInteger(
      Reflect.get(raw, "completedAt"),
    ),
    contentHash: contentHashValue,
    outcome,
    reason,
    version: VISITOR_FEEDBACK_COPY_UPGRADE_VERSION,
  });
}

function parseVisitorPrivacyCopyMarker(
  value: string,
): VisitorPrivacyCopyMarker {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw serviceUnavailable();
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    Reflect.get(raw, "version") !==
      VISITOR_PRIVACY_COPY_UPGRADE_VERSION
  ) {
    throw serviceUnavailable();
  }
  const outcome = Reflect.get(raw, "outcome");
  const reason = Reflect.get(raw, "reason");
  const contentHashValue = Reflect.get(raw, "contentHash");
  if (
    (outcome !== "skipped" && outcome !== "upgraded") ||
    !(
      reason === "already_current" ||
      reason === "legacy_copy_upgraded" ||
      reason === "newer_draft_preserved" ||
      reason === "nonlegacy_copy_preserved" ||
      reason === "page_unavailable"
    ) ||
    !(
      contentHashValue === null ||
      (
        typeof contentHashValue === "string" &&
        /^[a-f0-9]{64}$/u.test(contentHashValue)
      )
    )
  ) {
    throw serviceUnavailable();
  }
  return Object.freeze({
    completedAt: safeNonnegativeInteger(
      Reflect.get(raw, "completedAt"),
    ),
    contentHash: contentHashValue,
    outcome,
    reason,
    version: VISITOR_PRIVACY_COPY_UPGRADE_VERSION,
  });
}

function parsePhase7StarterCopyMarker(
  value: string,
): Phase7StarterCopyMarker {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw serviceUnavailable();
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    Reflect.get(raw, "version") !==
      PHASE7_STARTER_COPY_UPGRADE_VERSION ||
    !Array.isArray(Reflect.get(raw, "outcomes"))
  ) {
    throw serviceUnavailable();
  }
  const completedAtValue = Reflect.get(raw, "completedAt");
  const completedAt =
    completedAtValue === null
      ? null
      : safeNonnegativeInteger(completedAtValue);
  const outcomes = Reflect.get(raw, "outcomes") as unknown[];
  if (outcomes.length > PHASE7_STARTER_COPY_PAGE_SLUGS.length) {
    throw serviceUnavailable();
  }
  const seen = new Set<Phase7StarterCopyPageSlug>();
  const parsed = outcomes.map((outcome) => {
    if (
      typeof outcome !== "object" ||
      outcome === null ||
      Array.isArray(outcome)
    ) {
      throw serviceUnavailable();
    }
    const slugValue = Reflect.get(outcome, "slug");
    const slug = PHASE7_STARTER_COPY_PAGE_SLUGS.find(
      (candidate) => candidate === slugValue,
    );
    const outcomeValue = Reflect.get(outcome, "outcome");
    const reasonValue = Reflect.get(outcome, "reason");
    const contentHashValue = Reflect.get(outcome, "contentHash");
    if (
      !slug ||
      seen.has(slug) ||
      (outcomeValue !== "skipped" && outcomeValue !== "upgraded") ||
      !(
        reasonValue === "already_current" ||
        reasonValue === "legacy_copy_upgraded" ||
        reasonValue === "newer_draft_preserved" ||
        reasonValue === "nonlegacy_copy_preserved" ||
        reasonValue === "page_unavailable"
      ) ||
      !(
        contentHashValue === null ||
        (
          typeof contentHashValue === "string" &&
          /^[a-f0-9]{64}$/u.test(contentHashValue)
        )
      )
    ) {
      throw serviceUnavailable();
    }
    seen.add(slug);
    return phase7StarterCopyOutcome(
      slug,
      outcomeValue,
      reasonValue,
      contentHashValue,
      safeNonnegativeInteger(Reflect.get(outcome, "recordedAt")),
    );
  });
  if (
    (completedAt === null) !==
      (parsed.length < PHASE7_STARTER_COPY_PAGE_SLUGS.length)
  ) {
    throw serviceUnavailable();
  }
  return Object.freeze({
    completedAt,
    outcomes: Object.freeze(parsed),
    version: PHASE7_STARTER_COPY_UPGRADE_VERSION,
  });
}

async function readPhase7StarterCopyCandidate(
  database: D1DatabaseLike,
  organizationId: string,
  slug: Phase7StarterCopyPageSlug,
  targetHash: string,
  auditSource: string,
): Promise<Phase7StarterCopyCandidate | null> {
  const row = await database
    .prepare(
      `SELECT owner_membership.id AS membership_id,
              owner_membership.organization_id,
              owner_membership.profile_id,
              page.id AS entity_key,
              state.workflow_status,
              state.content_version,
              state.current_draft_revision_id,
              state.published_revision_id,
              current_draft.content_hash AS current_draft_hash,
              published.content_hash AS published_hash,
              CASE WHEN EXISTS (
                SELECT 1
                FROM audit_logs AS audit
                WHERE audit.organization_id = state.organization_id
                  AND audit.actor_profile_id =
                      owner_membership.profile_id
                  AND audit.action = 'cms.entity_draft_saved'
                  AND audit.entity_type = 'page'
                  AND audit.entity_id = state.entity_key
                  AND json_extract(
                        audit.metadata_json,
                        '$.contentVersion'
                      ) = state.content_version
                  AND json_extract(
                        audit.metadata_json,
                        '$.source'
                      ) = ?
                  AND json_extract(
                        audit.metadata_json,
                        '$.targetContentHash'
                      ) = ?
              ) THEN 1 ELSE 0 END AS current_draft_is_upgrade
       FROM organization_memberships AS owner_membership
       JOIN profiles AS owner_profile
         ON owner_profile.id = owner_membership.profile_id
        AND owner_profile.status = 'active'
        AND owner_profile.deleted_at IS NULL
       JOIN cms_adoption_states AS adoption
         ON adoption.organization_id =
            owner_membership.organization_id
        AND adoption.adoption_version = ?
       LEFT JOIN pages AS page
         ON page.organization_id = owner_membership.organization_id
        AND page.slug = ?
        AND page.deleted_at IS NULL
       LEFT JOIN cms_entity_publication_states AS state
         ON state.organization_id = owner_membership.organization_id
        AND state.entity_type = 'page'
        AND state.entity_key = page.id
       LEFT JOIN cms_entity_revisions AS current_draft
         ON current_draft.id = state.current_draft_revision_id
        AND current_draft.organization_id = state.organization_id
        AND current_draft.publication_state_id = state.id
       LEFT JOIN cms_entity_revisions AS published
         ON published.id = state.published_revision_id
        AND published.organization_id = state.organization_id
        AND published.publication_state_id = state.id
       WHERE owner_membership.organization_id = ?
         AND owner_membership.role = 'owner'
         AND owner_membership.status = 'active'
         AND owner_membership.deleted_at IS NULL
       ORDER BY owner_membership.id
       LIMIT 1`,
    )
    .bind(
      auditSource,
      targetHash,
      CMS_ADOPTION_VERSION,
      slug,
      organizationId,
    )
    .first<Record<string, unknown>>();
  if (!row) return null;
  const workflowValue = optionalString(row.workflow_status);
  return Object.freeze({
    actor: Object.freeze({
      membershipId: requiredString(row.membership_id),
      organizationId: requiredString(row.organization_id),
      profileId: requiredString(row.profile_id),
      role: "owner" as const,
    }),
    contentVersion:
      row.content_version === null
        ? 0
        : safeNonnegativeInteger(row.content_version),
    currentDraftHash: optionalHash(row.current_draft_hash),
    currentDraftIsUpgrade: row.current_draft_is_upgrade === 1,
    currentDraftRevisionId: optionalString(
      row.current_draft_revision_id,
    ),
    entityKey: optionalString(row.entity_key),
    publishedHash: optionalHash(row.published_hash),
    publishedRevisionId: optionalString(row.published_revision_id),
    workflowStatus:
      workflowValue === null ? null : workflowStatus(workflowValue),
  });
}

function phase7StarterCopyOutcome(
  slug: Phase7StarterCopyPageSlug,
  outcome: Phase7StarterCopyOutcome["outcome"],
  reason: Phase7StarterCopyOutcome["reason"],
  contentHashValue: string | null,
  recordedAt: number,
): Phase7StarterCopyOutcome {
  return Object.freeze({
    contentHash: contentHashValue,
    outcome,
    reason,
    recordedAt,
    slug,
  });
}

async function recordPhase7StarterCopyOutcome(
  database: D1DatabaseLike,
  input: Readonly<{
    actor: AuthorizedMembership;
    entityKey: string | null;
    marker: Phase7StarterCopyMarker | null;
    markerJson: string | null;
    notifyOwner: boolean;
    now: number;
    outcome: Phase7StarterCopyOutcome;
  }>,
): Promise<void> {
  const outcomes = Object.freeze([
    ...(input.marker?.outcomes ?? []),
    input.outcome,
  ]);
  const complete =
    outcomes.length === PHASE7_STARTER_COPY_PAGE_SLUGS.length;
  const nextMarker: Phase7StarterCopyMarker = Object.freeze({
    completedAt: complete ? input.now : null,
    outcomes,
    version: PHASE7_STARTER_COPY_UPGRADE_VERSION,
  });
  const nextJson = canonicalJson(nextMarker);
  const markerId =
    `phase7-starter-copy-marker:${input.actor.organizationId}`;
  const actorGuard = cmsActorGuard("owner");
  const statements: D1PreparedStatementLike[] = [
    database
      .prepare(
        `INSERT INTO site_settings (
           id, organization_id, key, value_json, is_public,
           updated_by_profile_id, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, 0, ?, ?, ?
         WHERE ${actorGuard.sql}
         ON CONFLICT(organization_id, key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_by_profile_id = excluded.updated_by_profile_id,
           updated_at = excluded.updated_at
         WHERE site_settings.is_public = 0
           AND site_settings.value_json IS ?`,
      )
      .bind(
        markerId,
        input.actor.organizationId,
        PHASE7_STARTER_COPY_MARKER_KEY,
        nextJson,
        input.actor.profileId,
        input.now,
        input.now,
        ...actorGuard.bindings(input.actor),
        input.markerJson,
      ),
  ];
  if (input.notifyOwner && input.entityKey) {
    statements.push(
      prepareNotificationInsert(database, {
        createdAt: input.now,
        id:
          `phase7-starter-copy-skip:${input.actor.organizationId}:` +
          input.outcome.slug,
        organizationId: input.actor.organizationId,
        payload: {
          pageId: input.entityKey,
          pageSlug: input.outcome.slug,
          type: "cms_starter_copy_skipped",
        },
        recipientProfileId: input.actor.profileId,
      }),
    );
  }
  try {
    await database.batch(statements);
  } catch {
    // A synchronized identical call may have recorded the same outcome first.
  }

  const [markerRow, notificationRow] = await Promise.all([
    database
      .prepare(
        `SELECT value_json
         FROM site_settings
         WHERE organization_id = ?
           AND key = ?
           AND is_public = 0
         LIMIT 1`,
      )
      .bind(
        input.actor.organizationId,
        PHASE7_STARTER_COPY_MARKER_KEY,
      )
      .first<Record<string, unknown>>(),
    input.notifyOwner && input.entityKey
      ? database
          .prepare(
            `SELECT 1 AS exact
             FROM notifications
             WHERE id = ?
               AND organization_id = ?
               AND recipient_profile_id = ?
               AND type = 'cms_starter_copy_skipped'
               AND payload_json = ?
               AND deleted_at IS NULL
             LIMIT 1`,
          )
          .bind(
            `phase7-starter-copy-skip:${input.actor.organizationId}:` +
              input.outcome.slug,
            input.actor.organizationId,
            input.actor.profileId,
            canonicalJson({
              pageId: input.entityKey,
              pageSlug: input.outcome.slug,
            }),
          )
          .first<Record<string, unknown>>()
      : Promise.resolve({ exact: 1 } as Record<string, unknown>),
  ]);
  const persisted = markerRow
    ? parsePhase7StarterCopyMarker(
        requiredString(markerRow.value_json),
      )
    : null;
  const persistedOutcome = persisted?.outcomes.find(
    (outcome) => outcome.slug === input.outcome.slug,
  );
  if (
    !persistedOutcome ||
    persistedOutcome.outcome !== input.outcome.outcome ||
    persistedOutcome.reason !== input.outcome.reason ||
    persistedOutcome.contentHash !== input.outcome.contentHash ||
    notificationRow?.exact !== 1
  ) {
    throw serviceUnavailable();
  }
}

async function recordVisitorPrivacyCopyMarker(
  database: D1DatabaseLike,
  input: Readonly<{
    actor: AuthorizedMembership;
    entityKey: string | null;
    marker: VisitorPrivacyCopyMarker;
    markerJson: string | null;
    notifyOwner: boolean;
    now: number;
  }>,
): Promise<void> {
  const nextJson = canonicalJson(input.marker);
  const markerId =
    `visitor-privacy-copy-marker:${input.actor.organizationId}`;
  const actorGuard = cmsActorGuard("owner");
  const statements: D1PreparedStatementLike[] = [
    database
      .prepare(
        `INSERT INTO site_settings (
           id, organization_id, key, value_json, is_public,
           updated_by_profile_id, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, 0, ?, ?, ?
         WHERE ${actorGuard.sql}
         ON CONFLICT(organization_id, key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_by_profile_id = excluded.updated_by_profile_id,
           updated_at = excluded.updated_at
         WHERE site_settings.is_public = 0
           AND site_settings.value_json IS ?`,
      )
      .bind(
        markerId,
        input.actor.organizationId,
        VISITOR_PRIVACY_COPY_MARKER_KEY,
        nextJson,
        input.actor.profileId,
        input.now,
        input.now,
        ...actorGuard.bindings(input.actor),
        input.markerJson,
      ),
  ];
  if (input.notifyOwner && input.entityKey) {
    statements.push(
      prepareNotificationInsert(database, {
        createdAt: input.now,
        id:
          `visitor-privacy-copy-skip:${input.actor.organizationId}`,
        organizationId: input.actor.organizationId,
        payload: {
          pageId: input.entityKey,
          pageSlug: "privacy",
          type: "cms_starter_copy_skipped",
        },
        recipientProfileId: input.actor.profileId,
      }),
    );
  }
  try {
    await database.batch(statements);
  } catch {
    // A synchronized identical request may have completed first.
  }

  const markerRow = await database
    .prepare(
      `SELECT value_json
       FROM site_settings
       WHERE organization_id = ?
         AND key = ?
         AND is_public = 0
       LIMIT 1`,
    )
    .bind(
      input.actor.organizationId,
      VISITOR_PRIVACY_COPY_MARKER_KEY,
    )
    .first<Record<string, unknown>>();
  const persisted = markerRow
    ? parseVisitorPrivacyCopyMarker(
        requiredString(markerRow.value_json),
      )
    : null;
  if (!persisted) {
    throw serviceUnavailable();
  }

  // A synchronized request can win the compare-and-set with its own
  // completion timestamp. Any valid terminal marker means the one-time work
  // converged; requiring this caller's byte-identical marker would turn that
  // successful race into a spurious 503.
  if (persisted.reason === "newer_draft_preserved") {
    if (!input.entityKey) throw serviceUnavailable();
    const notificationRow = await database
      .prepare(
        `SELECT 1 AS exact
         FROM notifications
         WHERE id = ?
           AND organization_id = ?
           AND recipient_profile_id = ?
           AND type = 'cms_starter_copy_skipped'
           AND payload_json = ?
           AND deleted_at IS NULL
         LIMIT 1`,
      )
      .bind(
        `visitor-privacy-copy-skip:${input.actor.organizationId}`,
        input.actor.organizationId,
        input.actor.profileId,
        canonicalJson({
          pageId: input.entityKey,
          pageSlug: "privacy",
        }),
      )
      .first<Record<string, unknown>>();
    if (notificationRow?.exact !== 1) {
      throw serviceUnavailable();
    }
  }
}

async function recordVisitorFeedbackCopyMarker(
  database: D1DatabaseLike,
  input: Readonly<{
    actor: AuthorizedMembership;
    entityKey: string | null;
    marker: VisitorFeedbackCopyMarker;
    markerJson: string | null;
    notifyOwner: boolean;
    now: number;
  }>,
): Promise<void> {
  const nextJson = canonicalJson(input.marker);
  const markerId =
    `visitor-feedback-copy-marker:${input.actor.organizationId}`;
  const actorGuard = cmsActorGuard("owner");
  const statements: D1PreparedStatementLike[] = [
    database
      .prepare(
        `INSERT INTO site_settings (
           id, organization_id, key, value_json, is_public,
           updated_by_profile_id, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, 0, ?, ?, ?
         WHERE ${actorGuard.sql}
         ON CONFLICT(organization_id, key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_by_profile_id = excluded.updated_by_profile_id,
           updated_at = excluded.updated_at
         WHERE site_settings.is_public = 0
           AND site_settings.value_json IS ?`,
      )
      .bind(
        markerId,
        input.actor.organizationId,
        VISITOR_FEEDBACK_COPY_MARKER_KEY,
        nextJson,
        input.actor.profileId,
        input.now,
        input.now,
        ...actorGuard.bindings(input.actor),
        input.markerJson,
      ),
  ];
  if (input.notifyOwner && input.entityKey) {
    statements.push(
      prepareNotificationInsert(database, {
        createdAt: input.now,
        id:
          `visitor-feedback-copy-skip:${input.actor.organizationId}`,
        organizationId: input.actor.organizationId,
        payload: {
          pageId: input.entityKey,
          pageSlug: "contact",
          type: "cms_starter_copy_skipped",
        },
        recipientProfileId: input.actor.profileId,
      }),
    );
  }
  try {
    await database.batch(statements);
  } catch {
    // A synchronized identical request may have completed first.
  }

  const markerRow = await database
    .prepare(
      `SELECT value_json
       FROM site_settings
       WHERE organization_id = ?
         AND key = ?
         AND is_public = 0
       LIMIT 1`,
    )
    .bind(
      input.actor.organizationId,
      VISITOR_FEEDBACK_COPY_MARKER_KEY,
    )
    .first<Record<string, unknown>>();
  const persisted = markerRow
    ? parseVisitorFeedbackCopyMarker(
        requiredString(markerRow.value_json),
      )
    : null;
  if (!persisted) {
    throw serviceUnavailable();
  }

  // A synchronized request can win the compare-and-set with its own
  // completion timestamp. Any valid terminal marker means the one-time work
  // converged; requiring this caller's byte-identical marker would turn that
  // successful race into a spurious 503.
  if (persisted.reason === "newer_draft_preserved") {
    if (!input.entityKey) throw serviceUnavailable();
    const notificationRow = await database
      .prepare(
        `SELECT 1 AS exact
         FROM notifications
         WHERE id = ?
           AND organization_id = ?
           AND recipient_profile_id = ?
           AND type = 'cms_starter_copy_skipped'
           AND payload_json = ?
           AND deleted_at IS NULL
         LIMIT 1`,
      )
      .bind(
        `visitor-feedback-copy-skip:${input.actor.organizationId}`,
        input.actor.organizationId,
        input.actor.profileId,
        canonicalJson({
          pageId: input.entityKey,
          pageSlug: "contact",
        }),
      )
      .first<Record<string, unknown>>();
    if (notificationRow?.exact !== 1) {
      throw serviceUnavailable();
    }
  }
}

function optionalHash(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)) {
    return value;
  }
  throw serviceUnavailable();
}

function safeNonnegativeInteger(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw serviceUnavailable();
  }
  return value;
}

function parseSnapshot(
  entityType: CmsEntityType,
  value: unknown,
): CmsSnapshot {
  switch (entityType) {
    case "page":
      return parsePageSnapshot(value);
    case "club_public_profile":
      return parseClubProfileSnapshot(value);
    case "program_public_profile":
      return parseProgramProfileSnapshot(value);
    case "community_link":
      return parseCommunityLinkSnapshot(value);
    case "navigation":
      return parseNavigationSnapshot(value);
    case "site_identity":
      return parseSiteIdentitySnapshot(value);
    case "legal_status":
      return parseLegalStatusSnapshot(value);
  }
}

function projectionGuard(
  state: CmsStateRow,
  actor: AuthorizedMembership,
  revisionId: string | null,
  allowedRoles: readonly ("owner" | "administrator")[] = [
    "owner",
    "administrator",
  ],
): Readonly<{ bindings: readonly (number | string | null)[]; sql: string }> {
  const actorGuard = cmsActorGuard(...allowedRoles);
  return Object.freeze({
    sql: `EXISTS (
      SELECT 1
      FROM cms_entity_publication_states AS publication_state
      WHERE publication_state.id = ?
        AND publication_state.organization_id = ?
        AND publication_state.entity_type = ?
        AND publication_state.entity_key = ?
        AND publication_state.content_version = ?
        AND (
          ? IS NULL OR publication_state.current_draft_revision_id = ?
        )
        AND ${actorGuard.sql}
    )`,
    bindings: Object.freeze([
      state.id,
      actor.organizationId,
      state.entityType,
      state.entityKey,
      state.contentVersion,
      revisionId,
      revisionId,
      ...actorGuard.bindings(actor),
    ]),
  });
}

function publishedProjectionGuard(
  state: CmsStateRow,
  actor: AuthorizedMembership,
  revisionId: string,
  allowedRoles: readonly ("owner" | "administrator")[] = [
    "owner",
    "administrator",
  ],
): Readonly<{ bindings: readonly (number | string | null)[]; sql: string }> {
  const actorGuard = cmsActorGuard(...allowedRoles);
  return Object.freeze({
    sql: `EXISTS (
      SELECT 1
      FROM cms_entity_publication_states AS publication_state
      WHERE publication_state.id = ?
        AND publication_state.organization_id = ?
        AND publication_state.entity_type = ?
        AND publication_state.entity_key = ?
        AND publication_state.content_version = ?
        AND publication_state.workflow_status = 'published'
        AND publication_state.current_draft_revision_id = ?
        AND publication_state.published_revision_id = ?
        AND publication_state.last_editor_profile_id = ?
        AND ${actorGuard.sql}
    )`,
    bindings: Object.freeze([
      state.id,
      actor.organizationId,
      state.entityType,
      state.entityKey,
      state.contentVersion + 1,
      revisionId,
      revisionId,
      actor.profileId,
      ...actorGuard.bindings(actor),
    ]),
  });
}

function cmsActorGuard(
  ...allowedRoles: readonly ("owner" | "administrator")[]
): Readonly<{
  bindings(actor: AuthorizedMembership): readonly string[];
  sql: string;
}> {
  const roleSql = allowedRoles.map(() => "?").join(", ");
  return Object.freeze({
    sql: `EXISTS (
      SELECT 1
      FROM organization_memberships AS actor_membership
      JOIN profiles AS actor_profile
        ON actor_profile.id = actor_membership.profile_id
      WHERE actor_membership.id = ?
        AND actor_membership.organization_id = ?
        AND actor_membership.profile_id = ?
        AND actor_membership.role IN (${roleSql})
        AND actor_membership.status = 'active'
        AND actor_membership.deleted_at IS NULL
        AND actor_profile.status = 'active'
        AND actor_profile.deleted_at IS NULL
    )`,
    bindings: (actor) =>
      Object.freeze([
        actor.membershipId,
        actor.organizationId,
        actor.profileId,
        ...allowedRoles,
      ]),
  });
}

function auditStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    action: string;
    actor: AuthorizedMembership;
    auditId: string;
    contentVersion: number;
    completion?: Readonly<{
      bindings: readonly (number | string | null)[];
      sql: string;
    }>;
    entityId: string;
    entityType: string;
    metadata: Readonly<Record<string, boolean | number | string>>;
    mediaRevisionId?: string;
    mediaScope?: "draft" | "published";
    mediaUsageCount?: number;
    now: number;
    publishedRevisionId?: string;
    revisionId?: string;
    stateId: string;
    workflowStatus?: CmsWorkflowState;
  }>,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action, entity_type,
         entity_id, metadata_json, created_at
       )
       VALUES (
         ?, ?, ?,
         CASE WHEN EXISTS (
           SELECT 1
           FROM cms_entity_publication_states AS state
          WHERE state.id = ?
            AND state.organization_id = ?
            AND state.content_version = ?
             ${input.revisionId ? "AND state.current_draft_revision_id = ?" : ""}
             ${input.publishedRevisionId ? "AND state.published_revision_id = ?" : ""}
             ${input.workflowStatus ? "AND state.workflow_status = ?" : ""}
             ${
               input.completion
                 ? `AND (${input.completion.sql})`
                 : ""
             }
             ${
               input.mediaRevisionId && input.mediaScope !== undefined
                 ? `AND (
                   SELECT count(*)
                   FROM media_usage_references AS usage
                   WHERE usage.organization_id = state.organization_id
                     AND usage.revision_id = ?
                     AND usage.publication_scope = ?
                     AND usage.deleted_at IS NULL
                 ) = ?`
                  : ""
              }
            AND NOT EXISTS (
              SELECT 1
              FROM audit_logs AS prior
              WHERE prior.organization_id = state.organization_id
                AND prior.action = ?
                AND prior.entity_type = ?
                AND prior.entity_id = ?
                AND json_extract(
                      prior.metadata_json,
                      '$.contentVersion'
                    ) = ?
            )
          ) THEN ? ELSE NULL END,
         ?, ?, ?, ?
       )`,
    )
    .bind(
      input.auditId,
      input.actor.organizationId,
      input.actor.profileId,
      input.stateId,
      input.actor.organizationId,
      input.contentVersion,
      ...(input.revisionId ? [input.revisionId] : []),
      ...(input.publishedRevisionId ? [input.publishedRevisionId] : []),
      ...(input.workflowStatus ? [input.workflowStatus] : []),
      ...(input.completion ? input.completion.bindings : []),
      ...(input.mediaRevisionId && input.mediaScope !== undefined
        ? [
            input.mediaRevisionId,
            input.mediaScope,
            input.mediaUsageCount ?? 0,
          ]
         : []),
      input.action,
      input.entityType,
      input.entityId,
      input.contentVersion,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.metadata),
      input.now,
    );
}

function requiredOnly(
  statement: D1PreparedStatementLike,
  completion: Readonly<{
    bindings: readonly (number | string | null)[];
    sql: string;
  }>,
  required = true,
  projectionJson = "{}",
) {
  return Object.freeze({
    completion,
    projectionJson,
    requiredChanges: Object.freeze(
      required ? [Object.freeze({ changes: 1, index: 0 })] : [],
    ),
    statements: Object.freeze([statement]),
  });
}

function projectionCompletion(
  sql: string,
  ...bindings: readonly (number | string | null)[]
): Readonly<{
  bindings: readonly (number | string | null)[];
  sql: string;
}> {
  return Object.freeze({
    bindings: Object.freeze([...bindings]),
    sql,
  });
}

async function executeCmsBatch(
  database: D1DatabaseLike,
  statements: readonly D1PreparedStatementLike[],
): Promise<readonly unknown[]> {
  try {
    return await database.batch([...statements]);
  } catch (error) {
    if (error instanceof SafeApplicationError) throw error;
    throw staleEdit();
  }
}

function requireExactChanges(
  results: readonly unknown[],
  expected: readonly number[],
  operation: string,
): void {
  if (
    results.length !== expected.length ||
    expected.some((value, index) => changes(results[index]) !== value)
  ) {
    throw new SafeApplicationError(
      "stale_edit",
      409,
      `The content changed before the ${operation} could be completed.`,
    );
  }
}

function changes(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  const meta = Reflect.get(result, "meta");
  if (typeof meta !== "object" || meta === null) return 0;
  const value = Reflect.get(meta, "changes");
  return typeof value === "number" ? value : 0;
}

function entitySummary(row: Record<string, unknown>): CmsEntitySummaryDto {
  const currentDraftRevisionId = optionalString(
    row.current_draft_revision_id,
  );
  const publishedRevisionId = optionalString(row.published_revision_id);
  const currentRevisionNumber = optionalInteger(row.current_revision_number);
  const publishedRevisionNumber = optionalInteger(
    row.published_revision_number,
  );
  return Object.freeze({
    contentVersion: requiredInteger(row.content_version),
    currentDraftRevisionId,
    currentRevisionNumber,
    displayLabel: requiredString(row.display_label),
    entityKey: requiredString(row.entity_key),
    entityType: parseCmsEntityType(row.entity_type),
    hasNewerDraft:
      currentDraftRevisionId !== null &&
      currentDraftRevisionId !== publishedRevisionId,
    lastEditorDisplayName: safeDisplayName(row.last_editor_display_name),
    publishedRevisionId,
    publishedRevisionNumber,
    updatedAt: requiredInteger(row.updated_at),
    workflowStatus: workflowStatus(row.workflow_status),
  });
}

function enforceSingletonKey(
  entityType: CmsEntityType,
  entityKey: string,
): void {
  if (
    (entityType === "legal_status" ||
      entityType === "navigation" ||
      entityType === "site_identity") &&
    entityKey !== SINGLETON_ENTITY_KEYS[entityType]
  ) {
    throw notFound();
  }
}

function parseEntityKey(value: unknown): string {
  const key = parseBoundedString(value, {
    path: "entityKey",
    maxLength: 160,
  });
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]*$/u.test(key)) {
    throw validationIssue(
      "entityKey",
      "invalid_identifier",
      "Expected a valid content identifier.",
    );
  }
  return key;
}

function workflowStatus(value: unknown): CmsWorkflowState {
  if (
    value === "draft" ||
    value === "published" ||
    value === "unpublished" ||
    value === "archived"
  ) {
    return value;
  }
  throw serviceUnavailable();
}

function parseTimestamp(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw validationIssue(
      "nowUtcMs",
      "invalid_integer",
      "Expected a valid timestamp.",
    );
  }
  return value;
}

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw serviceUnavailable();
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : requiredString(value);
}

function requiredInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw serviceUnavailable();
  }
  return value;
}

function optionalInteger(value: unknown): number | null {
  return value === null || value === undefined
    ? null
    : requiredInteger(value);
}

function safeDisplayName(value: unknown): string {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 120 &&
    !value.includes("@")
    ? value.trim()
    : "Organizer";
}

function staleEdit(): SafeApplicationError {
  return new SafeApplicationError(
    "stale_edit",
    409,
    "This content changed before the action could be completed.",
  );
}

function notFound(): SafeApplicationError {
  return new SafeApplicationError(
    "not_found",
    404,
    "The requested content is not available.",
  );
}

function serviceUnavailable(): SafeApplicationError {
  return new SafeApplicationError(
    "service_unavailable",
    503,
    "The content workspace is temporarily unavailable.",
  );
}
