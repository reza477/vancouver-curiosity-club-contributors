import {
  authorizeMembership,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  assertOnlyKeys,
  parseBoundedString,
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  parseObject,
  parseOptionalBoundedString,
} from "../../validation";
import {
  assertNoProtectedLegalClaim,
  protectedLegalClaimSql,
} from "../../validation/protected-legal-claims";
import { publicOrganizerEmailExposureSql } from "../../validation/public-organizer-email";
import { SafeApplicationError } from "../../validation/server-observability";
import type { NotificationPreferenceMode } from "./notifications";
import { canonicalJson, contentHash } from "./cms-validation";

export const CALENDAR_COLOR_TOKENS = [
  "forest",
  "cobalt",
  "coral",
  "amber",
  "plum",
  "teal",
] as const;

export type CalendarColorToken =
  (typeof CALENDAR_COLOR_TOKENS)[number];

export type PublicAttributionWorkflowStatus =
  | "confirmed"
  | "legacy"
  | "revoked"
  | "unconfirmed";

export type PublicAttributionPhotoOptionDto = Readonly<{
  altText: string;
  credit: string;
  id: string;
}>;

export type OrganizerProfileDto = Readonly<{
  assignedClubs: readonly Readonly<{ id: string; name: string }>[];
  calendarColor: CalendarColorToken;
  displayName: string;
  eligiblePublicPhotos: readonly PublicAttributionPhotoOptionDto[];
  initials: string;
  notificationPreferenceMode: NotificationPreferenceMode;
  publicAttributionConsent: boolean;
  publicAttributionDraftVersion: number;
  publicAttributionHasNewerDraft: boolean;
  publicAttributionPublished: Readonly<{
    biography: string | null;
    displayName: string;
    photoAssetId: string | null;
  }> | null;
  publicAttributionStatus: PublicAttributionWorkflowStatus;
  publicAttributionPublishedVersion: number;
  publicBiography: string | null;
  publicPhotoAssetId: string | null;
  role: "administrator" | "organizer" | "owner";
}>;

const PROFILE_PUBLIC_MEDIA_READY_SQL = `
  asset.deleted_at IS NULL
  AND detail.upload_state = 'ready'
  AND asset.rights_status = 'approved'
  AND asset.participant_consent_status IN ('confirmed', 'not_applicable')
  AND length(trim(COALESCE(asset.credit, ''))) BETWEEN 1 AND 300
  AND length(trim(COALESCE(asset.alt_text, ''))) BETWEEN 1 AND 300
  AND NOT (${protectedLegalClaimSql([
    "asset.alt_text",
    "asset.credit",
    "detail.caption",
  ])})
  AND NOT (${publicOrganizerEmailExposureSql(
    ["asset.alt_text", "asset.credit", "detail.caption"],
    "asset.organization_id",
  )})
  AND (
    SELECT count(*)
    FROM media_asset_variants AS variant
    WHERE variant.organization_id = asset.organization_id
      AND variant.asset_id = asset.id
      AND variant.state = 'ready'
      AND variant.variant_kind IN (
        'original', 'webp_480', 'webp_960', 'webp_1600'
      )
  ) = 4`;

export async function getOrganizerProfile(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
): Promise<OrganizerProfileDto> {
  const actor = await authorizeMembership(database, identity);
  const row = await database
    .prepare(
      `SELECT COALESCE(
                preference.workspace_display_name,
                profile.display_name
              ) AS display_name,
              profile.display_name AS canonical_display_name,
              profile.public_attribution_consent
                AS canonical_public_attribution_consent,
              preference.initials,
              preference.calendar_color,
              preference.public_biography,
              COALESCE(
                preference.public_attribution_consent_draft,
                profile.public_attribution_consent
              ) AS public_attribution_consent,
              preference.notification_preference_mode,
              attribution.attribution_version,
              attribution.published_attribution_version,
              attribution.workflow_status AS attribution_workflow_status,
              attribution.draft_photo_media_asset_id,
              attribution.public_display_name,
              attribution.public_biography AS published_biography,
              attribution.public_photo_media_asset_id,
              attribution.confirmed_at,
              attribution.updated_at AS attribution_updated_at,
              current_receipt.draft_version AS published_draft_version
       FROM profiles AS profile
       LEFT JOIN organizer_profile_preferences AS preference
         ON preference.profile_id = profile.id
        AND preference.organization_id = ?
       LEFT JOIN organizer_public_attribution_states AS attribution
         ON attribution.profile_id = profile.id
        AND attribution.organization_id = ?
       LEFT JOIN organizer_public_attribution_receipts AS current_receipt
         ON current_receipt.id = attribution.current_receipt_id
        AND current_receipt.organization_id = attribution.organization_id
        AND current_receipt.profile_id = attribution.profile_id
       WHERE profile.id = ?
         AND profile.status = 'active'
         AND profile.deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(
      actor.organizationId,
      actor.organizationId,
      actor.profileId,
    )
    .first<Record<string, unknown>>();
  if (!row) throw unavailableProfile();

  const clubs = await database
    .prepare(
      `SELECT club.id, club.name
       FROM club_memberships AS assignment
       JOIN clubs AS club
         ON club.id = assignment.club_id
        AND club.organization_id = assignment.organization_id
        AND club.deleted_at IS NULL
       WHERE assignment.organization_id = ?
         AND assignment.profile_id = ?
         AND assignment.status = 'active'
         AND assignment.deleted_at IS NULL
       ORDER BY club.name COLLATE NOCASE ASC, club.id ASC
       LIMIT 100`,
    )
    .bind(actor.organizationId, actor.profileId)
    .all<Record<string, unknown>>();

  const eligiblePhotos = await database
    .prepare(
      `SELECT asset.id, asset.alt_text, asset.credit
       FROM media_assets AS asset
       JOIN media_asset_details AS detail
         ON detail.asset_id = asset.id
        AND detail.organization_id = asset.organization_id
       WHERE asset.organization_id = ?
         AND ${PROFILE_PUBLIC_MEDIA_READY_SQL}
       ORDER BY asset.updated_at DESC, asset.id ASC
       LIMIT 100`,
    )
    .bind(actor.organizationId)
    .all<Record<string, unknown>>();

  return profileFromRows(
    row,
    clubs.results ?? [],
    eligiblePhotos.results ?? [],
    actor.role,
  );
}

export async function updateOrganizerProfile(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<OrganizerProfileDto> {
  const actor = await authorizeMembership(database, identity);
  const input = parseObject(inputValue);
  assertOnlyKeys(input, [
    "calendarColor",
    "displayName",
    "expectedAttributionDraftVersion",
    "initials",
    "publicAttributionConsent",
    "publicBiography",
    "publicPhotoAssetId",
  ]);
  const expectedAttributionVersion = parseFiniteInteger(
    input.expectedAttributionDraftVersion,
    {
      path: "expectedAttributionDraftVersion",
      minimum: 0,
    },
  );
  const displayName = parseBoundedString(input.displayName, {
    path: "displayName",
    minLength: 1,
    maxLength: 120,
  });
  const initials = parseInitials(input.initials);
  const calendarColor = parseEnum(
    input.calendarColor,
    CALENDAR_COLOR_TOKENS,
    "calendarColor",
  );
  const publicBiography = parseOptionalBoundedString(
    input.publicBiography,
    {
      path: "publicBiography",
      maxLength: 800,
    },
  );
  const publicAttributionConsent = parseBoolean(
    input.publicAttributionConsent,
    "publicAttributionConsent",
  );
  const publicPhotoAssetId = parseOptionalIdentifier(
    input.publicPhotoAssetId,
    "publicPhotoAssetId",
  );
  assertSafePublicAttributionText(displayName, publicBiography);
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const metadata = JSON.stringify({
    fields: [
      "calendar_color",
      "display_name",
      "initials",
      "public_attribution_consent",
      "public_biography",
      "public_photo",
    ],
  });
  const nextAttributionVersion = expectedAttributionVersion + 1;
  const draftRevisionId =
    `profile-draft:${nextAttributionVersion}`;

  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO organizer_public_attribution_states (
           profile_id, organization_id, attribution_version,
           workflow_status, draft_photo_media_asset_id,
           public_display_name, public_biography,
           public_photo_media_asset_id, current_receipt_id,
           confirmed_at, revoked_at, updated_by_profile_id,
           created_at, updated_at
         )
         SELECT profile.id, membership.organization_id, 1,
                'unconfirmed', ?, NULL, NULL, NULL, NULL,
                NULL, NULL, profile.id, ?, ?
         FROM organization_memberships AS membership
         JOIN profiles AS profile
           ON profile.id = membership.profile_id
          AND profile.status = 'active'
          AND profile.deleted_at IS NULL
         WHERE membership.id = ?
           AND membership.organization_id = ?
           AND membership.profile_id = ?
           AND membership.status = 'active'
           AND membership.deleted_at IS NULL
           AND (
             (
               ? = 0
               AND NOT EXISTS (
                 SELECT 1
                 FROM organizer_public_attribution_states AS current_state
                 WHERE current_state.profile_id = profile.id
               )
             )
             OR EXISTS (
               SELECT 1
               FROM organizer_public_attribution_states AS current_state
               WHERE current_state.profile_id = profile.id
                 AND current_state.organization_id =
                     membership.organization_id
                 AND current_state.attribution_version = ?
             )
           )
         ON CONFLICT(profile_id) DO UPDATE SET
           attribution_version =
             organizer_public_attribution_states.attribution_version + 1,
           draft_photo_media_asset_id =
             excluded.draft_photo_media_asset_id,
           updated_by_profile_id = excluded.updated_by_profile_id,
           updated_at = excluded.updated_at
         WHERE organizer_public_attribution_states.organization_id =
               excluded.organization_id
           AND organizer_public_attribution_states.attribution_version = ?`,
      )
      .bind(
        publicPhotoAssetId,
        now,
        now,
        actor.membershipId,
        actor.organizationId,
        actor.profileId,
        expectedAttributionVersion,
        expectedAttributionVersion,
        expectedAttributionVersion,
      ),
    database
      .prepare(
        `INSERT INTO organizer_profile_preferences (
           profile_id, organization_id, initials, calendar_color,
           workspace_display_name, public_biography,
           public_attribution_consent_draft, notification_preference_mode,
           created_at, updated_at
         )
         SELECT profile.id, ?, ?, ?, ?, ?, ?, 'all_relevant', ?, ?
         FROM profiles AS profile
         JOIN organizer_public_attribution_states AS attribution
           ON attribution.profile_id = profile.id
          AND attribution.organization_id = ?
          AND attribution.attribution_version = ?
         WHERE profile.id = ?
           AND profile.status = 'active'
           AND profile.deleted_at IS NULL
         ON CONFLICT(profile_id) DO UPDATE SET
           initials = excluded.initials,
           calendar_color = excluded.calendar_color,
           workspace_display_name = excluded.workspace_display_name,
           public_biography = excluded.public_biography,
           public_attribution_consent_draft =
             excluded.public_attribution_consent_draft,
           updated_at = excluded.updated_at
         WHERE organizer_profile_preferences.organization_id =
               excluded.organization_id`,
      )
      .bind(
        actor.organizationId,
        initials,
        calendarColor,
        displayName,
        publicBiography,
        publicAttributionConsent ? 1 : 0,
        now,
        now,
        actor.organizationId,
        nextAttributionVersion,
        actor.profileId,
      ),
    database
      .prepare(
        `UPDATE media_usage_references
         SET deleted_at = ?
         WHERE organization_id = ?
           AND entity_type = 'organizer_profile'
           AND entity_id = ?
           AND usage_kind = 'profile_photo'
           AND publication_scope = 'draft'
           AND deleted_at IS NULL`,
      )
      .bind(now, actor.organizationId, actor.profileId),
    database
      .prepare(
        `INSERT INTO media_usage_references (
           id, organization_id, asset_id, entity_type, entity_id,
           revision_id, usage_kind, publication_scope,
           created_by_profile_id, created_at, deleted_at
         )
         SELECT ?, attribution.organization_id,
                attribution.draft_photo_media_asset_id,
                'organizer_profile', attribution.profile_id,
                ?, 'profile_photo', 'draft',
                attribution.profile_id, ?, NULL
         FROM organizer_public_attribution_states AS attribution
         WHERE attribution.profile_id = ?
           AND attribution.organization_id = ?
           AND attribution.attribution_version = ?
           AND attribution.draft_photo_media_asset_id IS NOT NULL`,
      )
      .bind(
        crypto.randomUUID(),
        draftRevisionId,
        now,
        actor.profileId,
        actor.organizationId,
        nextAttributionVersion,
      ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         )
         VALUES (
           ?, ?, ?,
           CASE WHEN EXISTS (
             SELECT 1
             FROM profiles AS profile
             JOIN organizer_profile_preferences AS preference
              ON preference.profile_id = profile.id
              AND preference.organization_id = ?
             JOIN organizer_public_attribution_states AS attribution
               ON attribution.profile_id = profile.id
              AND attribution.organization_id =
                  preference.organization_id
              AND attribution.attribution_version = ?
             WHERE profile.id = ?
               AND preference.workspace_display_name = ?
               AND preference.initials = ?
               AND preference.calendar_color = ?
               AND preference.public_attribution_consent_draft = ?
               AND (
                 preference.public_biography = ?
                 OR (
                   preference.public_biography IS NULL
                   AND ? IS NULL
                 )
               )
               AND profile.status = 'active'
               AND profile.deleted_at IS NULL
               AND attribution.draft_photo_media_asset_id IS ?
               AND (
                 (
                   attribution.draft_photo_media_asset_id IS NULL
                   AND NOT EXISTS (
                     SELECT 1
                     FROM media_usage_references AS draft_usage
                     WHERE draft_usage.organization_id =
                           attribution.organization_id
                       AND draft_usage.entity_type =
                           'organizer_profile'
                       AND draft_usage.entity_id =
                           attribution.profile_id
                       AND draft_usage.usage_kind = 'profile_photo'
                       AND draft_usage.publication_scope = 'draft'
                       AND draft_usage.deleted_at IS NULL
                   )
                 )
                 OR EXISTS (
                   SELECT 1
                   FROM media_usage_references AS draft_usage
                   WHERE draft_usage.organization_id =
                         attribution.organization_id
                     AND draft_usage.asset_id =
                         attribution.draft_photo_media_asset_id
                     AND draft_usage.entity_type =
                         'organizer_profile'
                     AND draft_usage.entity_id =
                         attribution.profile_id
                     AND draft_usage.revision_id = ?
                     AND draft_usage.usage_kind = 'profile_photo'
                     AND draft_usage.publication_scope = 'draft'
                     AND draft_usage.deleted_at IS NULL
                 )
               )
           ) THEN 'profile.updated' ELSE NULL END,
           'profile', ?, ?, ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        actor.organizationId,
        nextAttributionVersion,
        actor.profileId,
        displayName,
        initials,
        calendarColor,
        publicAttributionConsent ? 1 : 0,
        publicBiography,
        publicBiography,
        publicPhotoAssetId,
        draftRevisionId,
        actor.profileId,
        metadata,
        now,
      ),
  ]);
  if (
    changes(results[0]) !== 1 ||
    changes(results[1]) !== 1 ||
    changes(results[4]) !== 1
  ) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "The profile could not be updated.",
    );
  }

  return getOrganizerProfile(database, identity);
}

export async function confirmOrganizerPublicAttribution(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<OrganizerProfileDto> {
  const actor = await authorizeMembership(database, identity);
  const expected = parseAttributionActionVersions(inputValue);
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const draft = await readAttributionDraft(
    database,
    actor.organizationId,
    actor.profileId,
  );
  if (
    !draft ||
    draft.draftVersion !== expected.draftVersion ||
    !draft.consent ||
    !draft.displayName
  ) {
    throw staleAttribution();
  }
  assertSafePublicAttributionText(draft.displayName, draft.biography);
  const nextPublishedVersion = expected.publishedVersion + 1;
  const intentId = crypto.randomUUID();
  const receiptId = crypto.randomUUID();
  const snapshot = Object.freeze({
    biography: draft.biography,
    consent: true,
    displayName: draft.displayName,
    draftVersion: draft.draftVersion,
    legacyAdopted: false,
    photoAssetId: draft.photoAssetId,
  });
  const snapshotJson = canonicalJson(snapshot);
  const snapshotHash = await contentHash(snapshot);
  if (
    draft.workflowStatus === "confirmed" &&
    (
      draft.publishedVersion === expected.publishedVersion ||
      draft.publishedVersion === expected.publishedVersion + 1
    ) &&
    await hasExactConfirmedPublicAttribution(database, {
      draftVersion: expected.draftVersion,
      organizationId: actor.organizationId,
      profileId: actor.profileId,
      publishedVersion: draft.publishedVersion,
      snapshotHash,
      snapshotJson,
    })
  ) {
    return getOrganizerProfile(database, identity);
  }
  if (draft.publishedVersion !== expected.publishedVersion) {
    throw staleAttribution();
  }
  const metadata = JSON.stringify({
    draftVersion: draft.draftVersion,
    hasPhoto: draft.photoAssetId !== null,
    publishedVersion: nextPublishedVersion,
    writeIntentId: intentId,
  });

  let results: Awaited<ReturnType<D1DatabaseLike["batch"]>>;
  try {
    results = await database.batch([
    database
      .prepare(
        `INSERT INTO organizer_public_attribution_write_intents (
           id, organization_id, profile_id, operation,
           expected_draft_version, expected_published_version,
           proposed_published_version, snapshot_hash,
           actor_profile_id, created_at, completed_at
         )
         SELECT ?, attribution.organization_id,
                attribution.profile_id, 'confirmed',
                attribution.attribution_version,
                attribution.published_attribution_version,
                attribution.published_attribution_version + 1,
                ?, attribution.profile_id, ?, NULL
         FROM organizer_public_attribution_states AS attribution
         JOIN organization_memberships AS membership
           ON membership.id = ?
          AND membership.organization_id = attribution.organization_id
          AND membership.profile_id = attribution.profile_id
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
         JOIN profiles AS profile
           ON profile.id = attribution.profile_id
          AND profile.status = 'active'
          AND profile.deleted_at IS NULL
         WHERE attribution.profile_id = ?
           AND attribution.organization_id = ?
           AND attribution.attribution_version = ?
           AND attribution.published_attribution_version = ?
           AND NOT EXISTS (
             SELECT 1
             FROM organizer_public_attribution_write_intents AS open_intent
             WHERE open_intent.organization_id =
                   attribution.organization_id
               AND open_intent.profile_id = attribution.profile_id
               AND open_intent.completed_at IS NULL
           )`,
      )
      .bind(
        intentId,
        snapshotHash,
        now,
        actor.membershipId,
        actor.profileId,
        actor.organizationId,
        expected.draftVersion,
        expected.publishedVersion,
      ),
    database
      .prepare(
        `INSERT INTO organizer_public_attribution_receipts (
           id, organization_id, profile_id, action,
           attribution_version, display_name, biography,
           photo_media_asset_id, consent, draft_version,
           legacy_adopted, prior_published_version,
           snapshot_json, snapshot_hash,
           actor_profile_id, write_intent_id,
           related_receipt_id, created_at
         )
         SELECT ?, intent.organization_id,
                intent.profile_id, 'confirmed',
                intent.proposed_published_version,
                preference.workspace_display_name,
                preference.public_biography,
                attribution.draft_photo_media_asset_id,
                1, attribution.attribution_version, 0, NULL,
                ?, ?,
                intent.actor_profile_id, intent.id,
                attribution.current_receipt_id, ?
         FROM organizer_public_attribution_write_intents AS intent
         JOIN organizer_public_attribution_states AS attribution
           ON attribution.profile_id = intent.profile_id
          AND attribution.organization_id = intent.organization_id
          AND attribution.attribution_version =
              intent.expected_draft_version
          AND attribution.published_attribution_version =
              intent.expected_published_version
         JOIN organizer_profile_preferences AS preference
           ON preference.profile_id = attribution.profile_id
          AND preference.organization_id = attribution.organization_id
         JOIN profiles AS profile
           ON profile.id = attribution.profile_id
          AND profile.status = 'active'
          AND profile.deleted_at IS NULL
         WHERE intent.id = ?
           AND intent.operation = 'confirmed'
           AND intent.completed_at IS NULL
           AND preference.public_attribution_consent_draft = 1
           AND preference.workspace_display_name = ?
           AND (
             preference.public_biography IS ?
             OR preference.public_biography = ?
           )
           AND attribution.draft_photo_media_asset_id IS ?
           AND instr(preference.workspace_display_name, '@') = 0
           AND lower(trim(preference.workspace_display_name)) <>
               lower(profile.normalized_email)
           AND NOT (${protectedLegalClaimSql([
             "preference.workspace_display_name",
             "preference.public_biography",
           ])})
           AND NOT (${publicOrganizerEmailExposureSql(
             [
               "preference.workspace_display_name",
               "preference.public_biography",
             ],
             "attribution.organization_id",
           )})
           AND (
             attribution.draft_photo_media_asset_id IS NULL
             OR EXISTS (
               SELECT 1
               FROM media_assets AS asset
               JOIN media_asset_details AS detail
                 ON detail.asset_id = asset.id
                AND detail.organization_id = asset.organization_id
               WHERE asset.id =
                     attribution.draft_photo_media_asset_id
                 AND asset.organization_id =
                     attribution.organization_id
                 AND ${PROFILE_PUBLIC_MEDIA_READY_SQL}
             )
           )`,
      )
      .bind(
        receiptId,
        snapshotJson,
        snapshotHash,
        now,
        intentId,
        draft.displayName,
        draft.biography,
        draft.biography,
        draft.photoAssetId,
      ),
    database
      .prepare(
        `UPDATE profiles
         SET display_name = ?,
             public_attribution_consent = 1,
             updated_at = ?
         WHERE id = ?
           AND status = 'active'
           AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM organizer_public_attribution_states AS attribution
             JOIN organizer_public_attribution_receipts AS receipt
               ON receipt.id = ?
              AND receipt.organization_id =
                  attribution.organization_id
              AND receipt.profile_id = attribution.profile_id
              AND receipt.action = 'confirmed'
              AND receipt.attribution_version =
                  attribution.published_attribution_version + 1
              AND receipt.write_intent_id = ?
             WHERE attribution.profile_id = profiles.id
               AND attribution.organization_id = ?
               AND attribution.attribution_version = ?
               AND attribution.published_attribution_version = ?
           )`,
      )
      .bind(
        draft.displayName,
        now,
        actor.profileId,
        receiptId,
        intentId,
        actor.organizationId,
        expected.draftVersion,
        expected.publishedVersion,
      ),
    database
      .prepare(
        `UPDATE organizer_public_attribution_states
         SET published_attribution_version = ?,
             workflow_status = 'confirmed',
             public_display_name = ?,
             public_biography = ?,
             public_photo_media_asset_id =
               draft_photo_media_asset_id,
             current_receipt_id = ?,
             confirmed_at = ?,
             revoked_at = NULL,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE profile_id = ?
           AND organization_id = ?
           AND attribution_version = ?
           AND published_attribution_version = ?
           AND EXISTS (
             SELECT 1
             FROM organizer_public_attribution_write_intents AS intent
             JOIN organizer_public_attribution_receipts AS receipt
               ON receipt.write_intent_id = intent.id
             WHERE receipt.id = ?
               AND intent.id = ?
               AND intent.organization_id =
                   organizer_public_attribution_states.organization_id
               AND intent.profile_id =
                   organizer_public_attribution_states.profile_id
               AND receipt.action = 'confirmed'
               AND receipt.attribution_version =
                   intent.proposed_published_version
               AND intent.completed_at IS NULL
           )`,
      )
      .bind(
        nextPublishedVersion,
        draft.displayName,
        draft.biography,
        receiptId,
        now,
        actor.profileId,
        now,
        actor.profileId,
        actor.organizationId,
        expected.draftVersion,
        expected.publishedVersion,
        receiptId,
        intentId,
      ),
    database
      .prepare(
        `UPDATE media_usage_references
         SET deleted_at = ?
         WHERE organization_id = ?
           AND entity_type = 'organizer_profile'
           AND entity_id = ?
           AND usage_kind = 'profile_photo'
           AND publication_scope IN ('draft', 'published')
           AND deleted_at IS NULL`,
      )
      .bind(now, actor.organizationId, actor.profileId),
    database
      .prepare(
        `INSERT INTO media_usage_references (
           id, organization_id, asset_id, entity_type, entity_id,
           revision_id, usage_kind, publication_scope,
           created_by_profile_id, created_at, deleted_at
         )
         SELECT ?, attribution.organization_id,
                attribution.public_photo_media_asset_id,
                'organizer_profile', attribution.profile_id,
                attribution.current_receipt_id,
                'profile_photo', 'published',
                attribution.profile_id, ?, NULL
         FROM organizer_public_attribution_states AS attribution
         WHERE attribution.profile_id = ?
           AND attribution.organization_id = ?
           AND attribution.published_attribution_version = ?
           AND attribution.workflow_status = 'confirmed'
           AND attribution.current_receipt_id = ?
           AND attribution.public_photo_media_asset_id IS NOT NULL`,
      )
      .bind(
        crypto.randomUUID(),
        now,
        actor.profileId,
        actor.organizationId,
        nextPublishedVersion,
        receiptId,
      ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         )
         VALUES (
           ?, ?, ?,
           CASE WHEN EXISTS (
             SELECT 1
             FROM organizer_public_attribution_states AS attribution
             JOIN organizer_public_attribution_receipts AS receipt
               ON receipt.id = attribution.current_receipt_id
              AND receipt.organization_id =
                  attribution.organization_id
              AND receipt.profile_id = attribution.profile_id
              AND receipt.action = 'confirmed'
              AND receipt.attribution_version =
                  attribution.published_attribution_version
              AND receipt.write_intent_id = ?
             JOIN profiles AS profile
               ON profile.id = attribution.profile_id
              AND profile.status = 'active'
              AND profile.deleted_at IS NULL
              AND profile.public_attribution_consent = 1
              AND profile.display_name =
                  attribution.public_display_name
             WHERE attribution.profile_id = ?
               AND attribution.organization_id = ?
               AND attribution.attribution_version = ?
               AND attribution.published_attribution_version = ?
               AND attribution.workflow_status = 'confirmed'
               AND attribution.current_receipt_id = ?
               AND (
                 (
                   attribution.public_photo_media_asset_id IS NULL
                   AND NOT EXISTS (
                     SELECT 1
                     FROM media_usage_references AS photo_usage
                     WHERE photo_usage.organization_id =
                           attribution.organization_id
                       AND photo_usage.entity_type =
                           'organizer_profile'
                       AND photo_usage.entity_id =
                           attribution.profile_id
                       AND photo_usage.usage_kind = 'profile_photo'
                       AND photo_usage.publication_scope = 'published'
                       AND photo_usage.deleted_at IS NULL
                   )
                 )
                 OR EXISTS (
                   SELECT 1
                   FROM media_usage_references AS photo_usage
                   WHERE photo_usage.organization_id =
                         attribution.organization_id
                     AND photo_usage.asset_id =
                         attribution.public_photo_media_asset_id
                     AND photo_usage.entity_type =
                         'organizer_profile'
                     AND photo_usage.entity_id =
                         attribution.profile_id
                     AND photo_usage.revision_id =
                         attribution.current_receipt_id
                     AND photo_usage.usage_kind = 'profile_photo'
                     AND photo_usage.publication_scope = 'published'
                     AND photo_usage.deleted_at IS NULL
                 )
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM media_usage_references AS draft_usage
                 WHERE draft_usage.organization_id =
                       attribution.organization_id
                   AND draft_usage.entity_type = 'organizer_profile'
                   AND draft_usage.entity_id = attribution.profile_id
                   AND draft_usage.usage_kind = 'profile_photo'
                   AND draft_usage.publication_scope = 'draft'
                   AND draft_usage.deleted_at IS NULL
               )
           ) THEN 'profile.public_attribution_confirmed'
             ELSE NULL END,
           'profile', ?, ?, ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        intentId,
        actor.profileId,
        actor.organizationId,
        expected.draftVersion,
        nextPublishedVersion,
        receiptId,
        actor.profileId,
        metadata,
        now,
      ),
    database
      .prepare(
        `UPDATE organizer_public_attribution_write_intents
         SET completed_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND profile_id = ?
           AND operation = 'confirmed'
           AND expected_draft_version = ?
           AND expected_published_version = ?
           AND proposed_published_version = ?
           AND completed_at IS NULL`,
      )
      .bind(
        now,
        intentId,
        actor.organizationId,
        actor.profileId,
        expected.draftVersion,
        expected.publishedVersion,
        nextPublishedVersion,
      ),
    ]);
  } catch {
    if (
      await hasExactConfirmedPublicAttribution(database, {
        draftVersion: expected.draftVersion,
        organizationId: actor.organizationId,
        profileId: actor.profileId,
        publishedVersion: nextPublishedVersion,
        snapshotHash,
        snapshotJson,
      })
    ) {
      return getOrganizerProfile(database, identity);
    }
    throw staleAttribution();
  }
  if (
    changes(results[0]) !== 1 ||
    changes(results[1]) !== 1 ||
    changes(results[2]) !== 1 ||
    changes(results[3]) !== 1 ||
    changes(results[6]) !== 1 ||
    changes(results[7]) !== 1
  ) {
    if (
      await hasExactConfirmedPublicAttribution(database, {
        draftVersion: expected.draftVersion,
        organizationId: actor.organizationId,
        profileId: actor.profileId,
        publishedVersion: nextPublishedVersion,
        snapshotHash,
        snapshotJson,
      })
    ) {
      return getOrganizerProfile(database, identity);
    }
    throw staleAttribution();
  }
  return getOrganizerProfile(database, identity);
}

export async function revokeOrganizerPublicAttribution(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<OrganizerProfileDto> {
  const actor = await authorizeMembership(database, identity);
  const expected = parseAttributionActionVersions(inputValue);
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  if (
    await hasExactRevokedPublicAttribution(database, {
      draftVersion: expected.draftVersion,
      expectedPublishedVersion: expected.publishedVersion,
      organizationId: actor.organizationId,
      profileId: actor.profileId,
    })
  ) {
    return getOrganizerProfile(database, identity);
  }
  const state = await database
    .prepare(
      `SELECT attribution.current_receipt_id,
              attribution.attribution_version,
              attribution.published_attribution_version
       FROM organizer_public_attribution_states AS attribution
       WHERE attribution.profile_id = ?
         AND attribution.organization_id = ?
         AND attribution.attribution_version = ?
         AND attribution.published_attribution_version = ?
         AND attribution.workflow_status = 'confirmed'
       LIMIT 1`,
    )
    .bind(
      actor.profileId,
      actor.organizationId,
      expected.draftVersion,
      expected.publishedVersion,
    )
    .first<Record<string, unknown>>();
  const relatedReceiptId = readString(state?.current_receipt_id);
  if (!relatedReceiptId) throw staleAttribution();
  const nextPublishedVersion = expected.publishedVersion + 1;
  const intentId = crypto.randomUUID();
  const receiptId = crypto.randomUUID();
  const snapshot = Object.freeze({
    consent: false,
    draftVersion: expected.draftVersion,
    priorPublishedVersion: expected.publishedVersion,
    relatedReceiptId,
  });
  const snapshotJson = canonicalJson(snapshot);
  const snapshotHash = await contentHash(snapshot);
  const metadata = JSON.stringify({
    draftVersion: expected.draftVersion,
    publishedVersion: nextPublishedVersion,
    writeIntentId: intentId,
  });

  let results: Awaited<ReturnType<D1DatabaseLike["batch"]>>;
  try {
    results = await database.batch([
    database
      .prepare(
        `INSERT INTO organizer_public_attribution_write_intents (
           id, organization_id, profile_id, operation,
           expected_draft_version, expected_published_version,
           proposed_published_version, snapshot_hash,
           actor_profile_id, created_at, completed_at
         )
         SELECT ?, attribution.organization_id,
                attribution.profile_id, 'revoked',
                attribution.attribution_version,
                attribution.published_attribution_version,
                attribution.published_attribution_version + 1,
                ?, attribution.profile_id, ?, NULL
         FROM organizer_public_attribution_states AS attribution
         JOIN organization_memberships AS membership
           ON membership.id = ?
          AND membership.organization_id = attribution.organization_id
          AND membership.profile_id = attribution.profile_id
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
         JOIN profiles AS profile
           ON profile.id = attribution.profile_id
          AND profile.status = 'active'
          AND profile.deleted_at IS NULL
         WHERE attribution.profile_id = ?
           AND attribution.organization_id = ?
           AND attribution.attribution_version = ?
           AND attribution.published_attribution_version = ?
           AND attribution.workflow_status = 'confirmed'
           AND attribution.current_receipt_id = ?
           AND NOT EXISTS (
             SELECT 1
             FROM organizer_public_attribution_write_intents AS open_intent
             WHERE open_intent.organization_id =
                   attribution.organization_id
               AND open_intent.profile_id = attribution.profile_id
               AND open_intent.completed_at IS NULL
           )`,
      )
      .bind(
        intentId,
        snapshotHash,
        now,
        actor.membershipId,
        actor.profileId,
        actor.organizationId,
        expected.draftVersion,
        expected.publishedVersion,
        relatedReceiptId,
      ),
    database
      .prepare(
        `INSERT INTO organizer_public_attribution_receipts (
           id, organization_id, profile_id, action,
           attribution_version, display_name, biography,
           photo_media_asset_id, consent, draft_version,
           legacy_adopted, prior_published_version,
           snapshot_json, snapshot_hash,
           actor_profile_id, write_intent_id,
           related_receipt_id, created_at
         )
         SELECT ?, intent.organization_id,
                intent.profile_id, 'revoked',
                intent.proposed_published_version,
                NULL, NULL, NULL, 0,
                attribution.attribution_version, 0,
                attribution.published_attribution_version,
                ?, ?,
                intent.actor_profile_id, intent.id,
                attribution.current_receipt_id, ?
         FROM organizer_public_attribution_write_intents AS intent
         JOIN organizer_public_attribution_states AS attribution
           ON attribution.profile_id = intent.profile_id
          AND attribution.organization_id = intent.organization_id
          AND attribution.attribution_version =
              intent.expected_draft_version
          AND attribution.published_attribution_version =
              intent.expected_published_version
         JOIN profiles AS profile
           ON profile.id = attribution.profile_id
          AND profile.status = 'active'
          AND profile.deleted_at IS NULL
         WHERE intent.id = ?
           AND intent.operation = 'revoked'
           AND intent.completed_at IS NULL
           AND attribution.workflow_status = 'confirmed'
           AND attribution.current_receipt_id = ?`,
      )
      .bind(
        receiptId,
        snapshotJson,
        snapshotHash,
        now,
        intentId,
        relatedReceiptId,
      ),
    database
      .prepare(
        `UPDATE profiles
         SET public_attribution_consent = 0,
             updated_at = ?
         WHERE id = ?
           AND status = 'active'
           AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM organizer_public_attribution_states AS attribution
             JOIN organizer_public_attribution_receipts AS receipt
               ON receipt.id = ?
              AND receipt.organization_id =
                  attribution.organization_id
              AND receipt.profile_id = attribution.profile_id
              AND receipt.action = 'revoked'
              AND receipt.attribution_version =
                  attribution.published_attribution_version + 1
              AND receipt.related_receipt_id =
                  attribution.current_receipt_id
              AND receipt.write_intent_id = ?
             WHERE attribution.profile_id = profiles.id
               AND attribution.organization_id = ?
               AND attribution.attribution_version = ?
               AND attribution.published_attribution_version = ?
               AND attribution.workflow_status = 'confirmed'
           )`,
      )
      .bind(
        now,
        actor.profileId,
        receiptId,
        intentId,
        actor.organizationId,
        expected.draftVersion,
        expected.publishedVersion,
      ),
    database
      .prepare(
        `UPDATE organizer_public_attribution_states
         SET published_attribution_version = ?,
             workflow_status = 'revoked',
             public_display_name = NULL,
             public_biography = NULL,
             public_photo_media_asset_id = NULL,
             current_receipt_id = ?,
             revoked_at = ?,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE profile_id = ?
           AND organization_id = ?
           AND attribution_version = ?
           AND published_attribution_version = ?
           AND workflow_status = 'confirmed'
           AND current_receipt_id = ?
           AND EXISTS (
             SELECT 1
             FROM organizer_public_attribution_write_intents AS intent
             JOIN organizer_public_attribution_receipts AS receipt
               ON receipt.write_intent_id = intent.id
             WHERE receipt.id = ?
               AND intent.id = ?
               AND intent.organization_id =
                   organizer_public_attribution_states.organization_id
               AND intent.profile_id =
                   organizer_public_attribution_states.profile_id
               AND receipt.action = 'revoked'
               AND receipt.attribution_version =
                   intent.proposed_published_version
               AND receipt.related_receipt_id =
                   organizer_public_attribution_states.current_receipt_id
           )`,
      )
      .bind(
        nextPublishedVersion,
        receiptId,
        now,
        actor.profileId,
        now,
        actor.profileId,
        actor.organizationId,
        expected.draftVersion,
        expected.publishedVersion,
        relatedReceiptId,
        receiptId,
        intentId,
      ),
    database
      .prepare(
        `UPDATE media_usage_references
         SET deleted_at = ?
         WHERE organization_id = ?
           AND entity_type = 'organizer_profile'
           AND entity_id = ?
           AND usage_kind = 'profile_photo'
           AND publication_scope = 'published'
           AND deleted_at IS NULL`,
      )
      .bind(now, actor.organizationId, actor.profileId),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         )
         VALUES (
           ?, ?, ?,
           CASE WHEN EXISTS (
             SELECT 1
             FROM organizer_public_attribution_states AS attribution
             JOIN organizer_public_attribution_receipts AS receipt
               ON receipt.id = attribution.current_receipt_id
              AND receipt.organization_id =
                  attribution.organization_id
              AND receipt.profile_id = attribution.profile_id
              AND receipt.action = 'revoked'
              AND receipt.attribution_version =
                  attribution.published_attribution_version
              AND receipt.write_intent_id = ?
             JOIN profiles AS profile
               ON profile.id = attribution.profile_id
              AND profile.public_attribution_consent = 0
             WHERE attribution.profile_id = ?
               AND attribution.organization_id = ?
               AND attribution.attribution_version = ?
               AND attribution.published_attribution_version = ?
               AND attribution.workflow_status = 'revoked'
               AND attribution.current_receipt_id = ?
               AND NOT EXISTS (
                 SELECT 1
                 FROM media_usage_references AS photo_usage
                 WHERE photo_usage.organization_id =
                       attribution.organization_id
                   AND photo_usage.entity_type = 'organizer_profile'
                   AND photo_usage.entity_id = attribution.profile_id
                   AND photo_usage.usage_kind = 'profile_photo'
                   AND photo_usage.publication_scope = 'published'
                   AND photo_usage.deleted_at IS NULL
               )
           ) THEN 'profile.public_attribution_revoked'
             ELSE NULL END,
           'profile', ?, ?, ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        intentId,
        actor.profileId,
        actor.organizationId,
        expected.draftVersion,
        nextPublishedVersion,
        receiptId,
        actor.profileId,
        metadata,
        now,
      ),
    database
      .prepare(
        `UPDATE organizer_public_attribution_write_intents
         SET completed_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND profile_id = ?
           AND operation = 'revoked'
           AND expected_draft_version = ?
           AND expected_published_version = ?
           AND proposed_published_version = ?
           AND completed_at IS NULL`,
      )
      .bind(
        now,
        intentId,
        actor.organizationId,
        actor.profileId,
        expected.draftVersion,
        expected.publishedVersion,
        nextPublishedVersion,
      ),
    ]);
  } catch {
    if (
      await hasExactRevokedPublicAttribution(database, {
        draftVersion: expected.draftVersion,
        expectedPublishedVersion: expected.publishedVersion,
        organizationId: actor.organizationId,
        profileId: actor.profileId,
      })
    ) {
      return getOrganizerProfile(database, identity);
    }
    throw staleAttribution();
  }
  if (
    changes(results[0]) !== 1 ||
    changes(results[1]) !== 1 ||
    changes(results[2]) !== 1 ||
    changes(results[3]) !== 1 ||
    changes(results[5]) !== 1 ||
    changes(results[6]) !== 1
  ) {
    if (
      await hasExactRevokedPublicAttribution(database, {
        draftVersion: expected.draftVersion,
        expectedPublishedVersion: expected.publishedVersion,
        organizationId: actor.organizationId,
        profileId: actor.profileId,
      })
    ) {
      return getOrganizerProfile(database, identity);
    }
    throw staleAttribution();
  }
  return getOrganizerProfile(database, identity);
}

type AttributionDraft = Readonly<{
  biography: string | null;
  consent: boolean;
  displayName: string | null;
  draftVersion: number;
  photoAssetId: string | null;
  publishedBiography: string | null;
  publishedConsent: boolean;
  publishedDisplayName: string | null;
  publishedDraftVersion: number;
  publishedPhotoAssetId: string | null;
  publishedVersion: number;
  workflowStatus: string;
}>;

async function hasExactConfirmedPublicAttribution(
  database: D1DatabaseLike,
  input: Readonly<{
    draftVersion: number;
    organizationId: string;
    profileId: string;
    publishedVersion: number;
    snapshotHash: string;
    snapshotJson: string;
  }>,
): Promise<boolean> {
  if (input.publishedVersion < 1) return false;
  try {
    const row = await database
      .prepare(
      `SELECT count(*) AS exact_count
       FROM organizer_public_attribution_states AS attribution
       JOIN organizer_public_attribution_receipts AS receipt
         ON receipt.id = attribution.current_receipt_id
        AND receipt.organization_id = attribution.organization_id
        AND receipt.profile_id = attribution.profile_id
        AND receipt.action = 'confirmed'
        AND receipt.attribution_version =
            attribution.published_attribution_version
        AND receipt.display_name = attribution.public_display_name
        AND receipt.biography IS attribution.public_biography
        AND receipt.photo_media_asset_id IS
            attribution.public_photo_media_asset_id
        AND receipt.consent = 1
        AND receipt.draft_version = ?
        AND receipt.legacy_adopted = 0
        AND receipt.prior_published_version IS NULL
        AND receipt.snapshot_json = ?
        AND receipt.snapshot_hash = ?
        AND receipt.actor_profile_id = attribution.profile_id
       JOIN organizer_public_attribution_write_intents AS intent
         ON intent.id = receipt.write_intent_id
        AND intent.organization_id = attribution.organization_id
        AND intent.profile_id = attribution.profile_id
        AND intent.operation = 'confirmed'
        AND intent.expected_draft_version = ?
        AND intent.expected_published_version = ? - 1
        AND intent.proposed_published_version = ?
        AND intent.snapshot_hash = receipt.snapshot_hash
        AND intent.actor_profile_id = attribution.profile_id
        AND intent.completed_at IS NOT NULL
       JOIN profiles AS profile
         ON profile.id = attribution.profile_id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
        AND profile.public_attribution_consent = 1
        AND profile.display_name = attribution.public_display_name
       WHERE attribution.profile_id = ?
         AND attribution.organization_id = ?
         AND attribution.attribution_version = ?
         AND attribution.published_attribution_version = ?
         AND attribution.workflow_status = 'confirmed'
         AND attribution.revoked_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM audit_logs AS audit
           WHERE audit.organization_id = attribution.organization_id
             AND audit.actor_profile_id = attribution.profile_id
             AND audit.action =
                 'profile.public_attribution_confirmed'
             AND audit.entity_type = 'profile'
             AND audit.entity_id = attribution.profile_id
             AND json_extract(
                   audit.metadata_json,
                   '$.writeIntentId'
                 ) = intent.id
             AND json_extract(
                   audit.metadata_json,
                   '$.draftVersion'
                 ) = ?
             AND json_extract(
                   audit.metadata_json,
                   '$.publishedVersion'
                 ) = ?
         )
         AND (
           (
             attribution.public_photo_media_asset_id IS NULL
             AND NOT EXISTS (
               SELECT 1
               FROM media_usage_references AS usage
               WHERE usage.organization_id =
                     attribution.organization_id
                 AND usage.entity_type = 'organizer_profile'
                 AND usage.entity_id = attribution.profile_id
                 AND usage.usage_kind = 'profile_photo'
                 AND usage.publication_scope = 'published'
                 AND usage.deleted_at IS NULL
             )
           )
           OR EXISTS (
             SELECT 1
             FROM media_usage_references AS usage
             WHERE usage.organization_id =
                   attribution.organization_id
               AND usage.asset_id =
                   attribution.public_photo_media_asset_id
               AND usage.entity_type = 'organizer_profile'
               AND usage.entity_id = attribution.profile_id
               AND usage.revision_id = receipt.id
               AND usage.usage_kind = 'profile_photo'
               AND usage.publication_scope = 'published'
               AND usage.deleted_at IS NULL
           )
         )`,
    )
    .bind(
      input.draftVersion,
      input.snapshotJson,
      input.snapshotHash,
      input.draftVersion,
      input.publishedVersion,
      input.publishedVersion,
      input.profileId,
      input.organizationId,
      input.draftVersion,
      input.publishedVersion,
      input.draftVersion,
      input.publishedVersion,
    )
      .first<{ exact_count: number }>();
    return row?.exact_count === 1;
  } catch {
    return false;
  }
}

async function hasExactRevokedPublicAttribution(
  database: D1DatabaseLike,
  input: Readonly<{
    draftVersion: number;
    expectedPublishedVersion: number;
    organizationId: string;
    profileId: string;
  }>,
): Promise<boolean> {
  const proposedPublishedVersion = input.expectedPublishedVersion + 1;
  try {
    const row = await database
      .prepare(
      `SELECT count(*) AS exact_count
       FROM organizer_public_attribution_states AS attribution
       JOIN organizer_public_attribution_receipts AS receipt
         ON receipt.id = attribution.current_receipt_id
        AND receipt.organization_id = attribution.organization_id
        AND receipt.profile_id = attribution.profile_id
        AND receipt.action = 'revoked'
        AND receipt.attribution_version =
            attribution.published_attribution_version
        AND receipt.display_name IS NULL
        AND receipt.biography IS NULL
        AND receipt.photo_media_asset_id IS NULL
        AND receipt.consent = 0
        AND receipt.draft_version = ?
        AND receipt.legacy_adopted = 0
        AND receipt.prior_published_version = ?
        AND receipt.related_receipt_id IS NOT NULL
        AND receipt.actor_profile_id = attribution.profile_id
       JOIN organizer_public_attribution_write_intents AS intent
         ON intent.id = receipt.write_intent_id
        AND intent.organization_id = attribution.organization_id
        AND intent.profile_id = attribution.profile_id
        AND intent.operation = 'revoked'
        AND intent.expected_draft_version = ?
        AND intent.expected_published_version = ?
        AND intent.proposed_published_version = ?
        AND intent.snapshot_hash = receipt.snapshot_hash
        AND intent.actor_profile_id = attribution.profile_id
        AND intent.completed_at IS NOT NULL
       JOIN organizer_public_attribution_receipts AS predecessor
         ON predecessor.id = receipt.related_receipt_id
        AND predecessor.organization_id = attribution.organization_id
        AND predecessor.profile_id = attribution.profile_id
        AND predecessor.action IN ('adopted', 'confirmed')
        AND predecessor.attribution_version = ?
       JOIN profiles AS profile
         ON profile.id = attribution.profile_id
        AND profile.public_attribution_consent = 0
       WHERE attribution.profile_id = ?
         AND attribution.organization_id = ?
         AND attribution.attribution_version = ?
         AND attribution.published_attribution_version = ?
         AND attribution.workflow_status = 'revoked'
         AND attribution.current_receipt_id = receipt.id
         AND attribution.public_display_name IS NULL
         AND attribution.public_biography IS NULL
         AND attribution.public_photo_media_asset_id IS NULL
         AND attribution.revoked_at IS NOT NULL
         AND receipt.snapshot_json = json_object(
           'consent', json('false'),
           'draftVersion', receipt.draft_version,
           'priorPublishedVersion',
             receipt.prior_published_version,
           'relatedReceiptId', receipt.related_receipt_id
         )
         AND EXISTS (
           SELECT 1
           FROM audit_logs AS audit
           WHERE audit.organization_id = attribution.organization_id
             AND audit.actor_profile_id = attribution.profile_id
             AND audit.action = 'profile.public_attribution_revoked'
             AND audit.entity_type = 'profile'
             AND audit.entity_id = attribution.profile_id
             AND json_extract(
                   audit.metadata_json,
                   '$.writeIntentId'
                 ) = intent.id
             AND json_extract(
                   audit.metadata_json,
                   '$.draftVersion'
                 ) = ?
             AND json_extract(
                   audit.metadata_json,
                   '$.publishedVersion'
                 ) = ?
         )
         AND NOT EXISTS (
           SELECT 1
           FROM media_usage_references AS usage
           WHERE usage.organization_id = attribution.organization_id
             AND usage.entity_type = 'organizer_profile'
             AND usage.entity_id = attribution.profile_id
             AND usage.usage_kind = 'profile_photo'
             AND usage.publication_scope = 'published'
             AND usage.deleted_at IS NULL
         )`,
    )
    .bind(
      input.draftVersion,
      input.expectedPublishedVersion,
      input.draftVersion,
      input.expectedPublishedVersion,
      proposedPublishedVersion,
      input.expectedPublishedVersion,
      input.profileId,
      input.organizationId,
      input.draftVersion,
      proposedPublishedVersion,
      input.draftVersion,
      proposedPublishedVersion,
    )
      .first<{ exact_count: number }>();
    return row?.exact_count === 1;
  } catch {
    return false;
  }
}

async function readAttributionDraft(
  database: D1DatabaseLike,
  organizationId: string,
  profileId: string,
): Promise<AttributionDraft | null> {
  const row = await database
    .prepare(
      `SELECT attribution.attribution_version,
              attribution.published_attribution_version,
              attribution.workflow_status,
              current_receipt.draft_version AS published_draft_version,
              current_receipt.display_name AS published_display_name,
              current_receipt.biography AS published_biography,
              current_receipt.photo_media_asset_id
                AS published_photo_media_asset_id,
              current_receipt.consent AS published_consent,
              preference.workspace_display_name,
              preference.public_biography,
              preference.public_attribution_consent_draft,
              attribution.draft_photo_media_asset_id
       FROM organizer_public_attribution_states AS attribution
       JOIN organizer_profile_preferences AS preference
         ON preference.profile_id = attribution.profile_id
        AND preference.organization_id = attribution.organization_id
       LEFT JOIN organizer_public_attribution_receipts AS current_receipt
         ON current_receipt.id = attribution.current_receipt_id
        AND current_receipt.organization_id = attribution.organization_id
        AND current_receipt.profile_id = attribution.profile_id
       WHERE attribution.profile_id = ?
         AND attribution.organization_id = ?
       LIMIT 1`,
    )
    .bind(profileId, organizationId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return Object.freeze({
    draftVersion:
      readNumber(row.attribution_version) ?? 0,
    biography: readNullableString(row.public_biography),
    consent:
      row.public_attribution_consent_draft === 1 ||
      row.public_attribution_consent_draft === true,
    displayName: readString(row.workspace_display_name),
    photoAssetId: readString(row.draft_photo_media_asset_id),
    publishedBiography:
      readNullableString(row.published_biography),
    publishedConsent:
      row.published_consent === 1 ||
      row.published_consent === true,
    publishedDisplayName:
      readString(row.published_display_name),
    publishedDraftVersion:
      readNumber(row.published_draft_version) ?? 0,
    publishedPhotoAssetId:
      readString(row.published_photo_media_asset_id),
    publishedVersion:
      readNumber(row.published_attribution_version) ?? 0,
    workflowStatus: readString(row.workflow_status) ?? "unconfirmed",
  });
}

function parseAttributionActionVersions(value: unknown): Readonly<{
  draftVersion: number;
  publishedVersion: number;
}> {
  const input = parseObject(value);
  assertOnlyKeys(input, [
    "expectedAttributionDraftVersion",
    "expectedAttributionPublishedVersion",
  ]);
  return Object.freeze({
    draftVersion: parseFiniteInteger(
      input.expectedAttributionDraftVersion,
      {
        path: "expectedAttributionDraftVersion",
        minimum: 1,
      },
    ),
    publishedVersion: parseFiniteInteger(
      input.expectedAttributionPublishedVersion,
      {
        path: "expectedAttributionPublishedVersion",
        minimum: 0,
      },
    ),
  });
}

function profileFromRows(
  row: Record<string, unknown>,
  clubRows: readonly Record<string, unknown>[],
  photoRows: readonly Record<string, unknown>[],
  role: OrganizerProfileDto["role"],
): OrganizerProfileDto {
  const displayName =
    readString(row.display_name) ?? "Organizer";
  const initials =
    parseStoredInitials(row.initials) ?? deriveInitials(displayName);
  const calendarColor =
    CALENDAR_COLOR_TOKENS.find(
      (value) => value === row.calendar_color,
    ) ?? "forest";
  const mode: NotificationPreferenceMode =
    row.notification_preference_mode === "important_only"
      ? "important_only"
      : "all_relevant";
  const assignedClubs = clubRows
    .map((club) => {
      const id = readString(club.id);
      const name = readString(club.name);
      return id && name ? Object.freeze({ id, name }) : null;
    })
    .filter(
      (
        club,
      ): club is Readonly<{
        id: string;
        name: string;
      }> => club !== null,
    );
  const eligiblePublicPhotos = photoRows.flatMap((photo) => {
    const id = readString(photo.id);
    const altText = readString(photo.alt_text);
    const credit = readString(photo.credit);
    return id && altText && credit
      ? [Object.freeze({ altText, credit, id })]
      : [];
  });
  const publicAttributionDraftVersion =
    readNumber(row.attribution_version) ?? 0;
  const publicAttributionPublishedVersion =
    readNumber(row.published_attribution_version) ?? 0;
  const canonicalConsent =
    row.canonical_public_attribution_consent === 1 ||
    row.canonical_public_attribution_consent === true;
  const canonicalDisplayName = readString(row.canonical_display_name);
  const workflowStatus = row.attribution_workflow_status;
  const publicAttributionStatus: PublicAttributionWorkflowStatus =
    workflowStatus === "confirmed"
      ? "confirmed"
      : workflowStatus === "revoked"
        ? "revoked"
        : canonicalConsent && canonicalDisplayName
          ? "legacy"
          : "unconfirmed";
  const publicAttributionPublished =
    publicAttributionStatus === "confirmed"
      ? Object.freeze({
          biography: readNullableString(row.published_biography),
          displayName:
            readString(row.public_display_name) ?? "Organizer",
          photoAssetId: readString(row.public_photo_media_asset_id),
        })
      : publicAttributionStatus === "legacy" && canonicalDisplayName
        ? Object.freeze({
            biography: null,
            displayName: canonicalDisplayName,
            photoAssetId: null,
          })
        : null;
  const publishedDraftVersion =
    readNumber(row.published_draft_version) ?? 0;
  const draftConsent =
    row.public_attribution_consent === 1 ||
    row.public_attribution_consent === true;
  const draftBiography = readNullableString(row.public_biography);
  const draftPhotoAssetId = readString(row.draft_photo_media_asset_id);
  const privateDisplayName = readString(row.display_name);

  return Object.freeze({
    displayName,
    initials,
    calendarColor,
    publicBiography: readNullableString(row.public_biography),
    publicAttributionConsent:
      draftConsent,
    publicAttributionHasNewerDraft:
      (publicAttributionStatus === "confirmed" &&
        (
          publicAttributionDraftVersion > publishedDraftVersion ||
          !draftConsent ||
          privateDisplayName !==
            publicAttributionPublished?.displayName ||
          draftBiography !==
            publicAttributionPublished?.biography ||
          draftPhotoAssetId !==
            publicAttributionPublished?.photoAssetId
        )) ||
      (publicAttributionStatus === "legacy" &&
        (
          publicAttributionDraftVersion > publishedDraftVersion ||
          !draftConsent ||
          privateDisplayName !== canonicalDisplayName ||
          draftBiography !== null ||
          draftPhotoAssetId !== null
        )),
    publicAttributionPublished,
    publicAttributionStatus,
    publicAttributionDraftVersion,
    publicAttributionPublishedVersion,
    publicPhotoAssetId: draftPhotoAssetId,
    eligiblePublicPhotos: Object.freeze(eligiblePublicPhotos),
    notificationPreferenceMode: mode,
    role,
    assignedClubs: Object.freeze(assignedClubs),
  });
}

function parseInitials(value: unknown): string {
  const initials = parseBoundedString(value, {
    path: "initials",
    minLength: 1,
    maxLength: 4,
  }).toLocaleUpperCase("en-CA");
  if (!/^[\p{L}\p{N}]{1,4}$/u.test(initials)) {
    throw validationError();
  }
  return initials;
}

function parseStoredInitials(value: unknown): string | null {
  try {
    return parseInitials(value);
  } catch {
    return null;
  }
}

function deriveInitials(displayName: string): string {
  const parts = displayName
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2);
  const initials = parts.map((part) => part[0] ?? "").join("");
  return initials.toLocaleUpperCase("en-CA").slice(0, 4) || "O";
}

function parseBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw validationError(path);
  return value;
}

function parseOptionalIdentifier(
  value: unknown,
  path: string,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  return parseIdentifier(value, path);
}

function assertSafePublicAttributionText(
  displayName: string,
  biography: string | null,
): void {
  if (displayName.includes("@")) {
    throw validationError("displayName");
  }
  assertNoProtectedLegalClaim(displayName, "displayName");
  if (biography) {
    assertNoProtectedLegalClaim(biography, "publicBiography");
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function changes(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  const meta = Reflect.get(result, "meta");
  if (typeof meta !== "object" || meta === null) return 0;
  const value = Reflect.get(meta, "changes");
  return typeof value === "number" ? value : 0;
}

function unavailableProfile(): SafeApplicationError {
  return new SafeApplicationError(
    "not_found",
    404,
    "The organizer profile is not available.",
  );
}

function staleAttribution(): SafeApplicationError {
  return new SafeApplicationError(
    "conflict",
    409,
    "The public-attribution draft changed. Refresh it before trying again.",
  );
}

function validationError(path?: string): SafeApplicationError {
  return new SafeApplicationError(
    "validation_failed",
    422,
    path
      ? `The ${path} value could not be validated.`
      : "The request could not be validated.",
  );
}
