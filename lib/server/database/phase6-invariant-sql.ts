/**
 * Phase 6 CMS and media guards are installed at runtime because Sites'
 * production migration tokenizer splits migration resources at semicolons and
 * therefore cannot preserve SQLite trigger bodies.
 */

import {
  classifiedLegalClaimSql,
  protectedLegalClaimSql,
} from "../../validation/protected-legal-claims";
import {
  organizationPublicContentContainsEmailSql,
  publicOrganizerEmailExposureSql,
} from "../../validation/public-organizer-email";
import {
  currentPublishedMediaUsageTargetSql,
  mediaUsageRequiresUsefulAltSql,
  missingCurrentPublishedMediaUsageCountSqlStatements,
} from "../media/public-usage-contract";
import {
  type CmsReceiptEntityType,
  cmsClubLiveProjectionMatchesReceiptSql,
  cmsCommunityLiveProjectionMatchesReceiptSql,
  cmsNavigationLiveProjectionMatchesReceiptSql,
  cmsPageLiveProjectionMatchesReceiptSql,
  cmsReceiptEnvelopeMatchesRevisionSql,
  cmsReceiptRevisionPredicateGroupsForEntityTypeSql,
  jsonSemanticallyEqualSql,
} from "../public/cms-materialization-contract";
import { publicEventSelectionProofCteSqlForOrganization } from "../public/events";

const CMS_ACTOR_IS_MANAGER_SQL = String.raw`
EXISTS (
  SELECT 1
  FROM organization_memberships AS membership
  JOIN profiles AS actor
    ON actor.id = membership.profile_id
   AND actor.status = 'active'
   AND actor.deleted_at IS NULL
  WHERE membership.organization_id = NEW.organization_id
    AND membership.profile_id = NEW.last_editor_profile_id
    AND membership.role IN ('owner', 'administrator')
    AND membership.status = 'active'
    AND membership.deleted_at IS NULL
)`;

const CMS_STATE_SOURCE_MATCH_SQL = String.raw`
(
  (
    NEW.entity_type = 'page'
    AND EXISTS (
      SELECT 1
      FROM pages AS page
      WHERE page.id = NEW.entity_key
        AND page.organization_id = NEW.organization_id
        AND page.deleted_at IS NULL
    )
  )
  OR (
    NEW.entity_type = 'club_public_profile'
    AND EXISTS (
      SELECT 1
      FROM club_public_profiles AS public_profile
      JOIN clubs AS club
        ON club.id = public_profile.club_id
       AND club.organization_id = public_profile.organization_id
       AND club.deleted_at IS NULL
      WHERE public_profile.club_id = NEW.entity_key
        AND public_profile.organization_id = NEW.organization_id
        AND public_profile.deleted_at IS NULL
    )
  )
  OR (
    NEW.entity_type = 'program_public_profile'
    AND EXISTS (
      SELECT 1
      FROM programs AS program
      JOIN clubs AS club
        ON club.id = program.club_id
       AND club.organization_id = program.organization_id
      WHERE program.id = NEW.entity_key
        AND program.organization_id = NEW.organization_id
        AND (
          (
            program.deleted_at IS NULL
            AND club.deleted_at IS NULL
          )
          OR (
            NEW.workflow_status = 'archived'
            AND program.deleted_at IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM program_public_profile_details AS tombstone_detail
              WHERE tombstone_detail.program_id = program.id
                AND tombstone_detail.organization_id =
                    program.organization_id
                AND tombstone_detail.club_id = program.club_id
                AND tombstone_detail.publication_status = 'archived'
                AND tombstone_detail.published_at IS NULL
                AND tombstone_detail.deleted_at IS NOT NULL
            )
          )
        )
    )
  )
  OR (
    NEW.entity_type = 'community_link'
    AND EXISTS (
      SELECT 1
      FROM community_links AS community_link
      WHERE community_link.id = NEW.entity_key
        AND community_link.organization_id = NEW.organization_id
        AND community_link.deleted_at IS NULL
    )
  )
  OR (
    NEW.entity_type = 'navigation'
    AND NEW.entity_key = 'navigation'
  )
  OR (
    NEW.entity_type = 'site_identity'
    AND NEW.entity_key = 'site_identity'
  )
  OR (
    NEW.entity_type = 'legal_status'
    AND NEW.entity_key = 'legal_status'
  )
)`;

const CMS_STATE_REVISION_MATCH_SQL = String.raw`
(
  NEW.current_draft_revision_id IS NULL
  OR EXISTS (
    SELECT 1
    FROM cms_entity_revisions AS revision
    WHERE revision.id = NEW.current_draft_revision_id
      AND revision.organization_id = NEW.organization_id
      AND revision.publication_state_id = NEW.id
      AND revision.entity_type = NEW.entity_type
      AND revision.entity_key = NEW.entity_key
  )
)
AND (
  NEW.published_revision_id IS NULL
  OR EXISTS (
    SELECT 1
    FROM cms_entity_revisions AS revision
    WHERE revision.id = NEW.published_revision_id
      AND revision.organization_id = NEW.organization_id
      AND revision.publication_state_id = NEW.id
      AND revision.entity_type = NEW.entity_type
      AND revision.entity_key = NEW.entity_key
)
)`;

function cmsRevisionHasActiveLaneSql(
  entityTypeExpression: string,
  snapshotExpression: string,
  canonicalByteSizeExpression: string,
  organizationExpression: string,
): string {
  return String.raw`
(
  CASE
    WHEN ${entityTypeExpression} NOT IN (
      'club_public_profile', 'program_public_profile'
    ) THEN 1
    WHEN json_valid(${snapshotExpression}) <> 1 THEN 0
    ELSE (
      json_type(${snapshotExpression}) = 'object'
      AND ${canonicalByteSizeExpression} =
          length(CAST(${snapshotExpression} AS BLOB))
      AND ${canonicalByteSizeExpression} BETWEEN 2 AND 131072
      AND json_type(${snapshotExpression}, '$.laneId') = 'text'
      AND length(trim(json_extract(
            ${snapshotExpression},
            '$.laneId'
          ))) BETWEEN 1 AND 160
      AND EXISTS (
        SELECT 1
        FROM event_lanes AS revision_lane
        WHERE revision_lane.id =
              json_extract(${snapshotExpression}, '$.laneId')
          AND revision_lane.organization_id =
              ${organizationExpression}
          AND revision_lane.deleted_at IS NULL
      )
    )
  END
)`;
}

export function phase6RequiredPageSnapshotSql(
  snapshotExpression: string,
): string {
  const slug = `json_extract(${snapshotExpression}, '$.slug')`;
  return String.raw`(
    json_valid(${snapshotExpression})
    AND json_type(${snapshotExpression}, '$.blocks') = 'array'
    AND length(trim(COALESCE(
      json_extract(${snapshotExpression}, '$.title'),
      ''
    ))) >= 3
    AND length(trim(COALESCE(
      json_extract(${snapshotExpression}, '$.seoTitle'),
      ''
    ))) >= 3
    AND length(trim(COALESCE(
      json_extract(${snapshotExpression}, '$.metaDescription'),
      ''
    ))) >= 20
    AND EXISTS (
      SELECT 1
      FROM json_each(${snapshotExpression}, '$.blocks') AS required_block
      WHERE json_extract(required_block.value, '$.type') =
            CASE WHEN ${slug} = 'home' THEN 'hero' ELSE 'intro' END
        AND length(trim(COALESCE(
          json_extract(required_block.value, '$.config.heading'),
          ''
        ))) >= 3
        AND length(trim(
          COALESCE(
            json_extract(required_block.value, '$.config.text'),
            ''
          )
          || ' '
          || COALESCE((
            SELECT group_concat(
                     CAST(paragraph.value AS TEXT),
                     ' '
                   )
            FROM json_each(
              required_block.value,
              '$.config.paragraphs'
            ) AS paragraph
            WHERE paragraph.type = 'text'
          ), '')
        )) >= 20
    )
  )`;
}

export function phase6LegalSnapshotCoherentSql(
  snapshotExpression: string,
): string {
  const charityStatus = `json_extract(${snapshotExpression}, '$.charityStatus')`;
  const charityNumber = `json_extract(${snapshotExpression}, '$.charityNumber')`;
  const effectiveDate = `json_extract(${snapshotExpression}, '$.effectiveDate')`;
  const footerWording = `json_extract(${snapshotExpression}, '$.footerWording')`;
  const jurisdiction = `json_extract(${snapshotExpression}, '$.jurisdiction')`;
  const legalFormWording =
    `json_extract(${snapshotExpression}, '$.legalFormWording')`;
  const legalName = `json_extract(${snapshotExpression}, '$.legalName')`;
  const registrationNumber =
    `json_extract(${snapshotExpression}, '$.registrationNumber')`;
  const publicWording = [
    footerWording,
    jurisdiction,
    legalFormWording,
    legalName,
    registrationNumber,
  ];
  const optionalText = (
    field: string,
    path: string,
    maximum: number,
  ) => String.raw`
    json_type(${snapshotExpression}, '${path}') IN ('null', 'text')
    AND (
      json_type(${snapshotExpression}, '${path}') = 'null'
      OR length(trim(${field})) BETWEEN 1 AND ${maximum}
    )`;
  const realEffectiveDate = String.raw`
    json_type(${snapshotExpression}, '$.effectiveDate') = 'text'
    AND length(${effectiveDate}) = 10
    AND ${effectiveDate} GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(${effectiveDate}, '+0 days') = ${effectiveDate}`;
  return String.raw`(
    json_valid(${snapshotExpression})
    AND json_type(${snapshotExpression}, '$.charityStatus') = 'text'
    AND ${charityStatus} IN (
      'unconfirmed', 'registered', 'confirmed_not_registered'
    )
    AND ${optionalText(charityNumber, "$.charityNumber", 120)}
    AND ${optionalText(effectiveDate, "$.effectiveDate", 10)}
    AND ${optionalText(footerWording, "$.footerWording", 500)}
    AND ${optionalText(jurisdiction, "$.jurisdiction", 120)}
    AND ${optionalText(legalFormWording, "$.legalFormWording", 240)}
    AND ${optionalText(legalName, "$.legalName", 240)}
    AND ${optionalText(registrationNumber, "$.registrationNumber", 120)}
    AND (
      (
        ${charityStatus} = 'registered'
        AND json_type(${snapshotExpression}, '$.charityNumber') = 'text'
        AND length(trim(${charityNumber})) BETWEEN 1 AND 120
      )
      OR (
        ${charityStatus} <> 'registered'
        AND json_type(${snapshotExpression}, '$.charityNumber') = 'null'
      )
    )
    AND ${classifiedLegalClaimSql(
      publicWording,
      String.raw`
        (
          legal_flags.protected_claim = 0
          OR legal_flags.positive_charity_status = 1
          OR legal_flags.negative_charity_status = 1
          OR legal_flags.positive_charity_benefit = 1
          OR legal_flags.negative_charity_benefit = 1
          OR legal_flags.provincial_status = 1
        )
        AND (
          (
            legal_flags.positive_charity_status = 0
            AND legal_flags.positive_charity_benefit = 0
          )
          OR (
            ${charityStatus} = 'registered'
            AND json_type(
                  ${snapshotExpression},
                  '$.charityNumber'
                ) = 'text'
            AND length(trim(${charityNumber})) BETWEEN 1 AND 120
          )
        )
        AND (
          legal_flags.negative_charity_status = 0
          OR ${charityStatus} = 'confirmed_not_registered'
        )
        AND (
          legal_flags.negative_charity_benefit = 0
          OR ${charityStatus} <> 'unconfirmed'
        )
        AND (
          (
            legal_flags.provincial_status = 0
            AND NOT (
              json_type(
                ${snapshotExpression},
                '$.registrationNumber'
              ) = 'text'
              AND length(trim(${registrationNumber})) > 0
            )
          )
          OR (
            json_type(${snapshotExpression}, '$.legalName') = 'text'
            AND length(trim(${legalName})) BETWEEN 1 AND 240
            AND json_type(
                  ${snapshotExpression},
                  '$.jurisdiction'
                ) = 'text'
            AND length(trim(${jurisdiction})) BETWEEN 1 AND 120
            AND json_type(
                  ${snapshotExpression},
                  '$.legalFormWording'
                ) = 'text'
            AND length(trim(${legalFormWording})) BETWEEN 1 AND 240
            AND json_type(
                  ${snapshotExpression},
                  '$.registrationNumber'
                ) = 'text'
            AND length(trim(${registrationNumber})) BETWEEN 1 AND 120
            AND ${realEffectiveDate}
          )
        )`,
    )}
  )`;
}

const CMS_LEGAL_PUBLICATION_CONFIRMED_SQL = String.raw`
(
  NEW.entity_type <> 'legal_status'
  OR NEW.workflow_status <> 'published'
  OR EXISTS (
    SELECT 1
    FROM legal_status_confirmation_receipts AS confirmation
    JOIN cms_entity_revisions AS revision
      ON revision.id = confirmation.revision_id
     AND revision.organization_id = confirmation.organization_id
     AND revision.content_hash = confirmation.revision_hash
    WHERE confirmation.organization_id = NEW.organization_id
      AND confirmation.revision_id = NEW.published_revision_id
      AND confirmation.action = 'confirmed'
      AND NOT EXISTS (
        SELECT 1
        FROM legal_status_confirmation_receipts AS revocation
        WHERE revocation.organization_id = confirmation.organization_id
          AND revocation.action = 'revoked'
          AND revocation.revokes_receipt_id = confirmation.id
      )
  )
)`;

const CMS_LEGAL_PUBLICATION_COHERENT_SQL = String.raw`
(
  NEW.entity_type <> 'legal_status'
  OR NEW.workflow_status <> 'published'
  OR EXISTS (
    SELECT 1
    FROM legal_status_confirmation_receipts AS confirmation
    JOIN cms_entity_revisions AS revision
      ON revision.id = confirmation.revision_id
     AND revision.organization_id = confirmation.organization_id
     AND revision.content_hash = confirmation.revision_hash
    WHERE confirmation.organization_id = NEW.organization_id
      AND confirmation.revision_id = NEW.published_revision_id
      AND confirmation.action = 'confirmed'
      AND ${phase6LegalSnapshotCoherentSql("revision.snapshot_json")}
      AND NOT EXISTS (
        SELECT 1
        FROM legal_status_confirmation_receipts AS revocation
        WHERE revocation.organization_id = confirmation.organization_id
          AND revocation.action = 'revoked'
          AND revocation.revokes_receipt_id = confirmation.id
      )
  )
)`;

const CMS_PUBLICATION_ORGANIZER_EMAIL_SAFE_SQL = String.raw`
(
  NEW.workflow_status <> 'published'
  OR NOT EXISTS (
    SELECT 1
    FROM cms_entity_revisions AS public_revision
    WHERE public_revision.id = NEW.published_revision_id
      AND public_revision.organization_id = NEW.organization_id
      AND public_revision.publication_state_id = NEW.id
      AND public_revision.entity_type = NEW.entity_type
      AND public_revision.entity_key = NEW.entity_key
      AND ${publicOrganizerEmailExposureSql(
        ["public_revision.snapshot_json"],
        "NEW.organization_id",
      )}
  )
)`;

const CMS_REQUIRED_PAGE_PUBLICATION_STRUCTURE_SQL = String.raw`
(
  NEW.entity_type <> 'page'
  OR NEW.workflow_status <> 'published'
  OR NOT (
    json_extract(
      (
        SELECT required_revision.snapshot_json
        FROM cms_entity_revisions AS required_revision
        WHERE required_revision.id = NEW.published_revision_id
          AND required_revision.organization_id = NEW.organization_id
          AND required_revision.publication_state_id = NEW.id
          AND required_revision.entity_type = NEW.entity_type
          AND required_revision.entity_key = NEW.entity_key
      ),
      '$.slug'
    ) IN (
      'home', 'events', 'clubs', 'community', 'about', 'get-involved',
      'host-an-event', 'contact', 'conduct', 'accessibility', 'privacy'
    )
  )
  OR EXISTS (
    SELECT 1
    FROM cms_entity_revisions AS required_revision
    WHERE required_revision.id = NEW.published_revision_id
      AND required_revision.organization_id = NEW.organization_id
      AND required_revision.publication_state_id = NEW.id
      AND required_revision.entity_type = NEW.entity_type
      AND required_revision.entity_key = NEW.entity_key
      AND ${phase6RequiredPageSnapshotSql(
        "required_revision.snapshot_json",
      )}
  )
)`;

function mediaAssetPublicReadySql(
  assetIdExpression: string,
  organizationIdExpression: string,
): string {
  return String.raw`(
    ${mediaAssetPublicReadyCoreSql(
      assetIdExpression,
      organizationIdExpression,
    )}
    AND ${mediaAssetPublicLegalSafeSql(
      assetIdExpression,
      organizationIdExpression,
    )}
    AND ${mediaAssetPublicEmailSafeSql(
      assetIdExpression,
      organizationIdExpression,
    )}
  )`;
}

function mediaAssetPublicReadyCoreSql(
  assetIdExpression: string,
  organizationIdExpression: string,
): string {
  return String.raw`
EXISTS (
  SELECT 1
  FROM media_assets AS asset
  JOIN media_asset_details AS detail
    ON detail.asset_id = asset.id
   AND detail.organization_id = asset.organization_id
  WHERE asset.id = ${assetIdExpression}
    AND asset.organization_id = ${organizationIdExpression}
    AND asset.deleted_at IS NULL
    AND detail.upload_state = 'ready'
    AND asset.rights_status = 'approved'
    AND asset.participant_consent_status IN ('confirmed', 'not_applicable')
    AND length(trim(COALESCE(asset.credit, ''))) BETWEEN 1 AND 300
    AND (
      detail.informative = 0
      OR length(trim(COALESCE(asset.alt_text, ''))) BETWEEN 1 AND 300
    )
    AND (
      SELECT count(*)
      FROM media_asset_variants AS variant
      WHERE variant.organization_id = asset.organization_id
        AND variant.asset_id = asset.id
        AND variant.state = 'ready'
        AND variant.variant_kind IN (
          'original', 'webp_480', 'webp_960', 'webp_1600'
        )
    ) = 4
)`;
}

function mediaAssetPublicLegalSafeSql(
  assetIdExpression: string,
  organizationIdExpression: string,
): string {
  const publicTextJson = String.raw`(
    SELECT json_array(asset.alt_text, asset.credit, detail.caption)
    FROM media_assets AS asset
    JOIN media_asset_details AS detail
      ON detail.asset_id = asset.id
     AND detail.organization_id = asset.organization_id
    WHERE asset.id = ${assetIdExpression}
      AND asset.organization_id = ${organizationIdExpression}
  )`;
  return `NOT (${protectedLegalClaimSql([publicTextJson])})`;
}

function mediaAssetPublicEmailSafeSql(
  assetIdExpression: string,
  organizationIdExpression: string,
): string {
  const publicTextJson = String.raw`(
    SELECT json_array(asset.alt_text, asset.credit, detail.caption)
    FROM media_assets AS asset
    JOIN media_asset_details AS detail
      ON detail.asset_id = asset.id
     AND detail.organization_id = asset.organization_id
    WHERE asset.id = ${assetIdExpression}
      AND asset.organization_id = ${organizationIdExpression}
  )`;
  return `NOT (${publicOrganizerEmailExposureSql(
    [publicTextJson],
    organizationIdExpression,
  )})`;
}

const MEDIA_ASSET_PUBLIC_LEGAL_FROM_NEW_SQL =
  protectedLegalClaimSql([
    "NEW.alt_text",
    "NEW.credit",
  ]);
const MEDIA_ASSET_PUBLIC_EMAIL_FROM_NEW_SQL =
  publicOrganizerEmailExposureSql(
    ["NEW.alt_text", "NEW.credit"],
    "NEW.organization_id",
  );

const MEDIA_DETAIL_PUBLIC_LEGAL_FROM_NEW_SQL =
  protectedLegalClaimSql(["NEW.caption"]);
const MEDIA_DETAIL_PUBLIC_EMAIL_FROM_NEW_SQL =
  publicOrganizerEmailExposureSql(
    ["NEW.caption"],
    "NEW.organization_id",
  );

const MEDIA_ASSET_PUBLIC_READY_SQL = mediaAssetPublicReadySql(
  "NEW.asset_id",
  "NEW.organization_id",
);

const MEDIA_USAGE_ACTOR_AUTHORIZED_SQL = String.raw`
EXISTS (
  SELECT 1
  FROM organization_memberships AS membership
  JOIN profiles AS actor
    ON actor.id = membership.profile_id
   AND actor.status = 'active'
   AND actor.deleted_at IS NULL
  WHERE membership.organization_id = NEW.organization_id
    AND membership.profile_id = NEW.created_by_profile_id
    AND membership.status = 'active'
    AND membership.deleted_at IS NULL
    AND (
      (
        membership.role IN ('owner', 'administrator')
        AND NEW.entity_type <> 'organizer_profile'
      )
      OR (
        membership.role = 'organizer'
        AND NEW.entity_type = 'organizer_event'
        AND EXISTS (
          SELECT 1
          FROM organizer_events AS event
          JOIN club_memberships AS club_membership
            ON club_membership.organization_id = event.organization_id
           AND club_membership.club_id = event.club_id
           AND club_membership.profile_id = membership.profile_id
           AND club_membership.status = 'active'
           AND club_membership.deleted_at IS NULL
          WHERE event.id = NEW.entity_id
            AND event.organization_id = NEW.organization_id
            AND event.deleted_at IS NULL
            AND (
              event.primary_organizer_profile_id = membership.profile_id
              OR EXISTS (
                SELECT 1
                FROM organizer_event_organizers AS co_organizer
                WHERE co_organizer.organization_id = event.organization_id
                  AND co_organizer.organizer_event_id = event.id
                  AND co_organizer.profile_id = membership.profile_id
                  AND co_organizer.deleted_at IS NULL
              )
            )
        )
      )
      OR (
        NEW.entity_type = 'organizer_profile'
        AND NEW.entity_id = membership.profile_id
        AND NEW.created_by_profile_id = membership.profile_id
      )
    )
)`;

const MEDIA_USAGE_TARGET_MATCH_SQL = String.raw`
(
  (
    NEW.entity_type = 'page'
    AND EXISTS (
      SELECT 1
      FROM pages AS page
      WHERE page.id = NEW.entity_id
        AND page.organization_id = NEW.organization_id
    )
  )
  OR (
    NEW.entity_type = 'club_public_profile'
    AND EXISTS (
      SELECT 1
      FROM club_public_profiles AS public_profile
      WHERE public_profile.club_id = NEW.entity_id
        AND public_profile.organization_id = NEW.organization_id
    )
  )
  OR (
    NEW.entity_type = 'program_public_profile'
    AND EXISTS (
      SELECT 1
      FROM programs AS program
      WHERE program.id = NEW.entity_id
        AND program.organization_id = NEW.organization_id
    )
  )
  OR (
    NEW.entity_type = 'organizer_event'
    AND EXISTS (
      SELECT 1
      FROM organizer_events AS event
      WHERE event.id = NEW.entity_id
        AND event.organization_id = NEW.organization_id
    )
  )
  OR (
    NEW.entity_type = 'organizer_profile'
    AND NEW.entity_id = NEW.created_by_profile_id
    AND EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      WHERE attribution.profile_id = NEW.entity_id
        AND attribution.organization_id = NEW.organization_id
    )
  )
  OR (
    NEW.entity_type = 'community_link'
    AND EXISTS (
      SELECT 1
      FROM community_links AS community_link
      WHERE community_link.id = NEW.entity_id
        AND community_link.organization_id = NEW.organization_id
    )
  )
  OR (
    NEW.entity_type IN ('site_logo', 'site_og', 'footer')
    AND NEW.entity_id = NEW.organization_id
  )
)
AND (
  (
    NEW.entity_type = 'organizer_event'
    AND EXISTS (
      SELECT 1
      FROM organizer_event_revisions AS revision
      WHERE revision.id = NEW.revision_id
        AND revision.organization_id = NEW.organization_id
        AND revision.organizer_event_id = NEW.entity_id
    )
  )
  OR (
    NEW.entity_type = 'organizer_profile'
    AND EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      WHERE attribution.profile_id = NEW.entity_id
        AND attribution.organization_id = NEW.organization_id
        AND (
          (
            NEW.publication_scope = 'draft'
            AND attribution.draft_photo_media_asset_id = NEW.asset_id
            AND NEW.revision_id =
                'profile-draft:' || attribution.attribution_version
          )
          OR (
            NEW.publication_scope = 'published'
            AND attribution.workflow_status = 'confirmed'
            AND attribution.public_photo_media_asset_id = NEW.asset_id
            AND attribution.current_receipt_id = NEW.revision_id
          )
        )
    )
  )
  OR (
    NEW.entity_type IN (
      'page', 'club_public_profile', 'program_public_profile',
      'community_link'
    )
    AND EXISTS (
      SELECT 1
      FROM cms_entity_revisions AS revision
      WHERE revision.id = NEW.revision_id
        AND revision.organization_id = NEW.organization_id
        AND revision.entity_type = NEW.entity_type
        AND revision.entity_key = NEW.entity_id
    )
  )
  OR (
    NEW.entity_type IN ('site_logo', 'site_og', 'footer')
    AND EXISTS (
      SELECT 1
      FROM cms_entity_revisions AS revision
      WHERE revision.id = NEW.revision_id
        AND revision.organization_id = NEW.organization_id
        AND revision.entity_type = 'site_identity'
        AND revision.entity_key = 'site_identity'
    )
  )
)`;

const MEDIA_USAGE_OPEN_PROFILE_ATTRIBUTION_SQL = String.raw`
(
  NEW.entity_type = 'organizer_profile'
  AND NEW.usage_kind = 'profile_photo'
  AND NEW.publication_scope = 'published'
  AND EXISTS (
    SELECT 1
    FROM organizer_public_attribution_states AS attribution
    JOIN organizer_public_attribution_receipts AS receipt
      ON receipt.id = attribution.current_receipt_id
     AND receipt.organization_id = attribution.organization_id
     AND receipt.profile_id = attribution.profile_id
     AND receipt.action IN ('adopted', 'confirmed')
     AND receipt.attribution_version =
         attribution.published_attribution_version
     AND receipt.consent = 1
     AND receipt.photo_media_asset_id =
         attribution.public_photo_media_asset_id
     AND receipt.actor_profile_id = attribution.profile_id
    JOIN organizer_public_attribution_write_intents AS intent
      ON intent.id = receipt.write_intent_id
     AND intent.organization_id = attribution.organization_id
     AND intent.profile_id = attribution.profile_id
     AND intent.operation = receipt.action
     AND intent.proposed_published_version =
         receipt.attribution_version
     AND intent.snapshot_hash = receipt.snapshot_hash
     AND intent.actor_profile_id = attribution.profile_id
     AND intent.completed_at IS NULL
    WHERE attribution.profile_id = NEW.entity_id
      AND attribution.organization_id = NEW.organization_id
      AND attribution.workflow_status = 'confirmed'
      AND attribution.public_photo_media_asset_id = NEW.asset_id
      AND attribution.current_receipt_id = NEW.revision_id
  )
)`;

const EVENT_PUBLIC_METADATA_ACTOR_AUTHORIZED_SQL = String.raw`
EXISTS (
  SELECT 1
  FROM organizer_events AS event
  JOIN organization_memberships AS membership
    ON membership.organization_id = event.organization_id
   AND membership.profile_id = NEW.updated_by_profile_id
   AND membership.status = 'active'
   AND membership.deleted_at IS NULL
  JOIN profiles AS actor
    ON actor.id = membership.profile_id
   AND actor.status = 'active'
   AND actor.deleted_at IS NULL
  WHERE event.id = NEW.organizer_event_id
    AND event.organization_id = NEW.organization_id
    AND event.deleted_at IS NULL
    AND (
      membership.role IN ('owner', 'administrator')
      OR (
        membership.role = 'organizer'
        AND EXISTS (
          SELECT 1
          FROM club_memberships AS club_membership
          WHERE club_membership.organization_id = event.organization_id
            AND club_membership.club_id = event.club_id
            AND club_membership.profile_id = membership.profile_id
            AND club_membership.status = 'active'
            AND club_membership.deleted_at IS NULL
        )
        AND (
          event.primary_organizer_profile_id = membership.profile_id
          OR EXISTS (
            SELECT 1
            FROM organizer_event_organizers AS co_organizer
            WHERE co_organizer.organization_id = event.organization_id
              AND co_organizer.organizer_event_id = event.id
              AND co_organizer.profile_id = membership.profile_id
              AND co_organizer.deleted_at IS NULL
          )
        )
      )
    )
)`;

const EVENT_PUBLIC_TEXT_FROM_NEW_EVENT_EXPRESSIONS = Object.freeze([
  "NEW.title",
  "NEW.summary",
  "NEW.description",
  `(SELECT detail.public_location_name
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT detail.public_address
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT detail.public_access_note
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT detail.cost_text
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT detail.preparation_information
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT detail.what_to_bring
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT detail.arrival_instructions
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT detail.weather_note
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT detail.verified_accessibility_notes
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT metadata.seo_title
    FROM organizer_event_public_metadata AS metadata
    WHERE metadata.organizer_event_id = NEW.id
      AND metadata.organization_id = NEW.organization_id)`,
  `(SELECT metadata.meta_description
    FROM organizer_event_public_metadata AS metadata
    WHERE metadata.organizer_event_id = NEW.id
      AND metadata.organization_id = NEW.organization_id)`,
] as const);
const EVENT_LEGAL_CLAIM_FROM_NEW_EVENT_SQL = protectedLegalClaimSql(
  EVENT_PUBLIC_TEXT_FROM_NEW_EVENT_EXPRESSIONS,
);
const EVENT_ORGANIZER_EMAIL_FROM_NEW_EVENT_SQL =
  publicOrganizerEmailExposureSql(
    EVENT_PUBLIC_TEXT_FROM_NEW_EVENT_EXPRESSIONS,
    "NEW.organization_id",
  );

const EVENT_PUBLIC_TEXT_FROM_NEW_DETAILS_EXPRESSIONS = Object.freeze([
  `(SELECT event.title
    FROM organizer_events AS event
    WHERE event.id = NEW.organizer_event_id
      AND event.organization_id = NEW.organization_id)`,
  `(SELECT event.summary
    FROM organizer_events AS event
    WHERE event.id = NEW.organizer_event_id
      AND event.organization_id = NEW.organization_id)`,
  `(SELECT event.description
    FROM organizer_events AS event
    WHERE event.id = NEW.organizer_event_id
      AND event.organization_id = NEW.organization_id)`,
  "NEW.public_location_name",
  "NEW.public_address",
  "NEW.public_access_note",
  "NEW.cost_text",
  "NEW.preparation_information",
  "NEW.what_to_bring",
  "NEW.arrival_instructions",
  "NEW.weather_note",
  "NEW.verified_accessibility_notes",
  `(SELECT metadata.seo_title
    FROM organizer_event_public_metadata AS metadata
    WHERE metadata.organizer_event_id = NEW.organizer_event_id
      AND metadata.organization_id = NEW.organization_id)`,
  `(SELECT metadata.meta_description
    FROM organizer_event_public_metadata AS metadata
    WHERE metadata.organizer_event_id = NEW.organizer_event_id
      AND metadata.organization_id = NEW.organization_id)`,
] as const);
const EVENT_LEGAL_CLAIM_FROM_NEW_DETAILS_SQL = protectedLegalClaimSql(
  EVENT_PUBLIC_TEXT_FROM_NEW_DETAILS_EXPRESSIONS,
);
const EVENT_ORGANIZER_EMAIL_FROM_NEW_DETAILS_SQL =
  publicOrganizerEmailExposureSql(
    EVENT_PUBLIC_TEXT_FROM_NEW_DETAILS_EXPRESSIONS,
    "NEW.organization_id",
  );

const EVENT_PUBLIC_TEXT_FROM_NEW_METADATA_EXPRESSIONS = Object.freeze([
  `(SELECT event.title
    FROM organizer_events AS event
    WHERE event.id = NEW.organizer_event_id
      AND event.organization_id = NEW.organization_id)`,
  `(SELECT event.summary
    FROM organizer_events AS event
    WHERE event.id = NEW.organizer_event_id
      AND event.organization_id = NEW.organization_id)`,
  `(SELECT event.description
    FROM organizer_events AS event
    WHERE event.id = NEW.organizer_event_id
      AND event.organization_id = NEW.organization_id)`,
  `(SELECT detail.public_location_name
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.organizer_event_id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT detail.public_address
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.organizer_event_id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT detail.public_access_note
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.organizer_event_id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT detail.cost_text
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.organizer_event_id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT detail.preparation_information
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.organizer_event_id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT detail.what_to_bring
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.organizer_event_id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT detail.arrival_instructions
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.organizer_event_id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT detail.weather_note
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.organizer_event_id
      AND detail.organization_id = NEW.organization_id)`,
  `(SELECT detail.verified_accessibility_notes
    FROM organizer_event_public_details AS detail
    WHERE detail.organizer_event_id = NEW.organizer_event_id
      AND detail.organization_id = NEW.organization_id)`,
  "NEW.seo_title",
  "NEW.meta_description",
] as const);
const EVENT_LEGAL_CLAIM_FROM_NEW_METADATA_SQL = protectedLegalClaimSql(
  EVENT_PUBLIC_TEXT_FROM_NEW_METADATA_EXPRESSIONS,
);
const EVENT_ORGANIZER_EMAIL_FROM_NEW_METADATA_SQL =
  publicOrganizerEmailExposureSql(
    EVENT_PUBLIC_TEXT_FROM_NEW_METADATA_EXPRESSIONS,
    "NEW.organization_id",
  );

function exactCurrentReceiptExistsSql(
  entityType: CmsReceiptEntityType,
  entityKeyExpression: string,
  organizationExpression: string,
  projectionPredicate: string,
): string {
  return String.raw`
(
  NOT EXISTS (
    SELECT 1
    FROM cms_adoption_states AS adoption
    WHERE adoption.organization_id = ${organizationExpression}
      AND adoption.adoption_version = 1
  )
  OR EXISTS (
  SELECT 1
  FROM cms_entity_publication_states AS public_state
  JOIN cms_entity_revisions AS public_revision
    ON public_revision.id = public_state.published_revision_id
   AND public_revision.organization_id = public_state.organization_id
   AND public_revision.publication_state_id = public_state.id
   AND public_revision.entity_type = public_state.entity_type
   AND public_revision.entity_key = public_state.entity_key
  JOIN cms_public_materialization_receipts AS public_receipt
    ON public_receipt.organization_id = public_state.organization_id
   AND public_receipt.publication_state_id = public_state.id
   AND public_receipt.entity_type = public_state.entity_type
   AND public_receipt.entity_key = public_state.entity_key
   AND public_receipt.revision_id = public_revision.id
   AND public_receipt.revision_hash = public_revision.content_hash
  WHERE public_state.organization_id = ${organizationExpression}
    AND public_state.entity_type = '${entityType}'
    AND public_state.entity_key = ${entityKeyExpression}
    AND (
      public_state.workflow_status = 'published'
      OR (
        public_state.workflow_status = 'archived'
        AND public_state.entity_type IN (
          'club_public_profile', 'program_public_profile'
        )
      )
    )
    AND ${cmsReceiptEnvelopeMatchesRevisionSql(
      "public_receipt",
      "public_revision",
    )}
    AND (${projectionPredicate})
  )
)`;
}

function programPublicProjectionMatchesReceiptSql(
  detailExpression: string,
): string {
  return String.raw`
    public_state.workflow_status = ${detailExpression}.publication_status
    AND public_state.workflow_status IN ('published', 'archived')
    AND ${detailExpression}.published_at IS NOT NULL
    AND ${detailExpression}.deleted_at IS NULL
    AND json_type(public_receipt.projection_json, '$.details') = 'object'
    AND ${detailExpression}.club_id =
        json_extract(public_receipt.projection_json, '$.details.clubId')
    AND ${detailExpression}.primary_event_lane_id =
        json_extract(public_receipt.projection_json, '$.details.laneId')
    AND ${detailExpression}.public_display_name =
        json_extract(public_receipt.projection_json, '$.details.name')
    AND ${detailExpression}.public_slug =
        json_extract(public_receipt.projection_json, '$.details.slug')
    AND ${detailExpression}.short_summary =
        json_extract(public_receipt.projection_json, '$.details.summary')
    AND ${detailExpression}.full_description =
        json_extract(
          public_receipt.projection_json,
          '$.details.fullDescription'
        )
    AND ${detailExpression}.program_type =
        json_extract(public_receipt.projection_json, '$.details.programType')
    AND ${detailExpression}.public_group_url IS
        json_extract(
          public_receipt.projection_json,
          '$.details.meetupGroupUrl'
        )
    AND ${detailExpression}.cover_media_asset_id IS
        json_extract(public_receipt.projection_json, '$.details.coverAssetId')
    AND ${detailExpression}.thumbnail_media_asset_id IS
        json_extract(
          public_receipt.projection_json,
          '$.details.thumbnailAssetId'
        )
    AND ${detailExpression}.theme_color IS
        json_extract(public_receipt.projection_json, '$.details.themeColor')
    AND ${detailExpression}.participant_expectations IS
        json_extract(
          public_receipt.projection_json,
          '$.details.participantExpectations'
        )
    AND ${detailExpression}.preparation_information IS
        json_extract(
          public_receipt.projection_json,
          '$.details.preparationInformation'
        )
    AND ${detailExpression}.typical_format IS
        json_extract(public_receipt.projection_json, '$.details.typicalFormat')
    AND ${detailExpression}.is_featured =
        json_extract(public_receipt.projection_json, '$.details.featured')
    AND ${detailExpression}.display_order =
        json_extract(public_receipt.projection_json, '$.details.displayOrder')
    AND ${detailExpression}.confirmed_social_links_json =
        json(
          json_extract(
            public_receipt.projection_json,
            '$.details.confirmedSocialLinks'
          )
        )
    AND ${detailExpression}.related_resources_json =
        json(
          json_extract(
            public_receipt.projection_json,
            '$.details.relatedResources'
          )
        )
    AND ${detailExpression}.seo_title IS
        json_extract(public_receipt.projection_json, '$.details.seoTitle')
    AND ${detailExpression}.meta_description IS
        json_extract(
          public_receipt.projection_json,
          '$.details.metaDescription'
        )
    AND ${detailExpression}.og_media_asset_id IS
        json_extract(
          public_receipt.projection_json,
          '$.details.openGraphAssetId'
        )`;
}

function programCurrentMaterializationExistsSql(
  detailExpression: string,
): string {
  return String.raw`
EXISTS (
  SELECT 1
  FROM cms_entity_publication_states AS public_state
  JOIN cms_entity_revisions AS public_revision
    ON public_revision.id = public_state.published_revision_id
   AND public_revision.organization_id = public_state.organization_id
   AND public_revision.publication_state_id = public_state.id
   AND public_revision.entity_type = public_state.entity_type
   AND public_revision.entity_key = public_state.entity_key
  JOIN cms_public_materialization_receipts AS public_receipt
    ON public_receipt.organization_id = public_state.organization_id
   AND public_receipt.publication_state_id = public_state.id
   AND public_receipt.entity_type = public_state.entity_type
   AND public_receipt.entity_key = public_state.entity_key
   AND public_receipt.revision_id = public_revision.id
   AND public_receipt.revision_hash = public_revision.content_hash
  WHERE public_state.organization_id = ${detailExpression}.organization_id
    AND public_state.entity_type = 'program_public_profile'
    AND public_state.entity_key = ${detailExpression}.program_id
    AND (${programPublicProjectionMatchesReceiptSql(detailExpression)})
)`;
}

function programPublicFieldsUnchangedSql(
  nextExpression: string,
  priorExpression: string,
): string {
  return [
    "program_id",
    "organization_id",
    "club_id",
    "primary_event_lane_id",
    "is_featured",
    "display_order",
    "public_display_name",
    "public_slug",
    "short_summary",
    "full_description",
    "program_type",
    "public_group_url",
    "cover_media_asset_id",
    "thumbnail_media_asset_id",
    "theme_color",
    "participant_expectations",
    "preparation_information",
    "typical_format",
    "confirmed_social_links_json",
    "related_resources_json",
    "seo_title",
    "meta_description",
    "og_media_asset_id",
    "published_at",
    "created_at",
    "deleted_at",
  ]
    .map(
      (field) =>
        `${nextExpression}.${field} IS ${priorExpression}.${field}`,
    )
    .join("\n      AND ");
}

function taxonomyIntentActorIsManagerSql(intentAlias: string): string {
  return String.raw`
EXISTS (
  SELECT 1
  FROM organization_memberships AS membership
  JOIN profiles AS actor
    ON actor.id = membership.profile_id
   AND actor.status = 'active'
   AND actor.deleted_at IS NULL
  JOIN organizations AS organization
    ON organization.id = membership.organization_id
   AND organization.deleted_at IS NULL
  WHERE membership.organization_id = ${intentAlias}.organization_id
    AND membership.profile_id = ${intentAlias}.actor_profile_id
    AND membership.role IN ('owner', 'administrator')
    AND membership.status = 'active'
    AND membership.deleted_at IS NULL
)`;
}

const TAXONOMY_INTENT_ACTOR_IS_MANAGER_SQL =
  taxonomyIntentActorIsManagerSql("NEW");

function taxonomyReorderGroupCompleteSql(
  intentAlias: string,
  baseTable: "event_lanes" | "categories",
  baseIdColumn: "id",
  stateTable:
    | "event_lane_taxonomy_states"
    | "category_taxonomy_states",
  stateIdColumn: "lane_id" | "category_id",
): string {
  return String.raw`
(
  ${intentAlias}.operation <> 'reorder'
  OR (
    ${intentAlias}.mutation_group_id IS NOT NULL
    AND ${intentAlias}.mutation_group_size = (
      SELECT count(*)
      FROM ${baseTable} AS active_item
      WHERE active_item.organization_id =
            ${intentAlias}.organization_id
        AND active_item.deleted_at IS NULL
    )
    AND ${intentAlias}.mutation_group_size = (
      SELECT count(*)
      FROM taxonomy_write_intents AS group_intent
      WHERE group_intent.organization_id =
            ${intentAlias}.organization_id
        AND group_intent.entity_type =
            ${intentAlias}.entity_type
        AND group_intent.operation = 'reorder'
        AND group_intent.mutation_group_id =
            ${intentAlias}.mutation_group_id
        AND group_intent.mutation_group_size =
            ${intentAlias}.mutation_group_size
        AND group_intent.actor_profile_id =
            ${intentAlias}.actor_profile_id
        AND group_intent.completed_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ${baseTable} AS active_item
      JOIN ${stateTable} AS active_state
        ON active_state.${stateIdColumn} =
           active_item.${baseIdColumn}
       AND active_state.organization_id =
           active_item.organization_id
      WHERE active_item.organization_id =
            ${intentAlias}.organization_id
        AND active_item.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM taxonomy_write_intents AS group_intent
          WHERE group_intent.organization_id =
                active_item.organization_id
            AND group_intent.entity_type =
                ${intentAlias}.entity_type
            AND group_intent.entity_id =
                active_item.${baseIdColumn}
            AND group_intent.operation = 'reorder'
            AND group_intent.mutation_group_id =
                ${intentAlias}.mutation_group_id
            AND group_intent.mutation_group_size =
                ${intentAlias}.mutation_group_size
            AND group_intent.expected_content_version =
                active_state.content_version
            AND group_intent.completed_at IS NULL
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM taxonomy_write_intents AS group_intent
      LEFT JOIN ${baseTable} AS active_item
        ON active_item.${baseIdColumn} =
           group_intent.entity_id
       AND active_item.organization_id =
           group_intent.organization_id
       AND active_item.deleted_at IS NULL
      LEFT JOIN ${stateTable} AS active_state
        ON active_state.${stateIdColumn} =
           active_item.${baseIdColumn}
       AND active_state.organization_id =
           active_item.organization_id
      WHERE group_intent.organization_id =
            ${intentAlias}.organization_id
        AND group_intent.entity_type =
            ${intentAlias}.entity_type
        AND group_intent.operation = 'reorder'
        AND group_intent.mutation_group_id =
            ${intentAlias}.mutation_group_id
        AND group_intent.completed_at IS NULL
        AND (
          active_item.${baseIdColumn} IS NULL
          OR active_state.${stateIdColumn} IS NULL
          OR active_state.content_version <>
             group_intent.expected_content_version
        )
    )
  )
)`;
}

const LANE_REORDER_GROUP_COMPLETE_SQL =
  taxonomyReorderGroupCompleteSql(
    "intent",
    "event_lanes",
    "id",
    "event_lane_taxonomy_states",
    "lane_id",
  );
const CATEGORY_REORDER_GROUP_COMPLETE_SQL =
  taxonomyReorderGroupCompleteSql(
    "intent",
    "categories",
    "id",
    "category_taxonomy_states",
    "category_id",
  );

const CMS_RECEIPT_ENTITY_TYPES = Object.freeze([
  "page",
  "club_public_profile",
  "program_public_profile",
  "community_link",
  "navigation",
  "site_identity",
  "legal_status",
] as const satisfies readonly CmsReceiptEntityType[]);

function cmsReceiptRevisionGuardTriggerSql(
  entityType: CmsReceiptEntityType,
): readonly string[] {
  const triggerSuffix = entityType.replaceAll("_", "");
  const predicateGroups =
    cmsReceiptRevisionPredicateGroupsForEntityTypeSql(
      entityType,
      "NEW",
      "receipt_revision",
      entityType === "page"
        ? {
            unifiedPublicEventCteSql:
              publicEventSelectionProofCteSqlForOrganization(
                "NEW.organization_id",
              ),
          }
        : {},
    );
  return Object.freeze(
    predicateGroups.map((predicate, index) => String.raw`
CREATE TRIGGER IF NOT EXISTS cms_public_materialization_receipts_phase6_${triggerSuffix}_${index + 1}_before_insert
BEFORE INSERT ON cms_public_materialization_receipts
WHEN NEW.entity_type = '${entityType}'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM cms_entity_revisions AS receipt_revision
      WHERE receipt_revision.id = NEW.revision_id
        AND receipt_revision.organization_id = NEW.organization_id
        AND receipt_revision.publication_state_id =
            NEW.publication_state_id
        AND receipt_revision.entity_type = NEW.entity_type
        AND receipt_revision.entity_key = NEW.entity_key
        AND receipt_revision.content_hash = NEW.revision_hash
        AND ${predicate}
    )
    THEN RAISE(ABORT, 'phase6_materialization_revision_mismatch')
  END;
END;`),
  );
}

const PHASE6_INVARIANT_TRIGGER_STATEMENT_SOURCE = Object.freeze([
  String.raw`
CREATE TRIGGER IF NOT EXISTS cms_entity_publication_states_phase6_before_insert
BEFORE INSERT ON cms_entity_publication_states
BEGIN
  SELECT CASE
    WHEN NOT (${CMS_ACTOR_IS_MANAGER_SQL})
    THEN RAISE(ABORT, 'phase6_cms_actor_unauthorized')
  END;
  SELECT CASE
    WHEN NOT (${CMS_STATE_SOURCE_MATCH_SQL})
    THEN RAISE(ABORT, 'phase6_cms_entity_organization_mismatch')
  END;
  SELECT CASE
    WHEN NEW.workflow_status <> 'archived'
      OR NEW.current_draft_revision_id IS NOT NULL
      OR NEW.published_revision_id IS NOT NULL
    THEN RAISE(ABORT, 'phase6_cms_initial_state_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS cms_entity_publication_states_phase6_before_update
BEFORE UPDATE ON cms_entity_publication_states
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.entity_type <> OLD.entity_type
      OR NEW.entity_key <> OLD.entity_key
      OR NEW.content_version NOT BETWEEN OLD.content_version
                                    AND OLD.content_version + 1
    THEN RAISE(ABORT, 'phase6_cms_state_identity_or_version_invalid')
  END;
  SELECT CASE
    WHEN NOT (${CMS_ACTOR_IS_MANAGER_SQL})
    THEN RAISE(ABORT, 'phase6_cms_actor_unauthorized')
  END;
  SELECT CASE
    WHEN NOT (${CMS_STATE_SOURCE_MATCH_SQL})
    THEN RAISE(ABORT, 'phase6_cms_entity_organization_mismatch')
  END;
  SELECT CASE
    WHEN NOT (${CMS_STATE_REVISION_MATCH_SQL})
    THEN RAISE(ABORT, 'phase6_cms_revision_mismatch')
  END;
  SELECT CASE
    WHEN NOT (${CMS_LEGAL_PUBLICATION_CONFIRMED_SQL})
    THEN RAISE(ABORT, 'phase6_legal_confirmation_required')
  END;
  SELECT CASE
    WHEN NOT (${CMS_PUBLICATION_ORGANIZER_EMAIL_SAFE_SQL})
    THEN RAISE(ABORT, 'phase6_public_organizer_email_forbidden')
  END;
  SELECT CASE
    WHEN NOT (${CMS_REQUIRED_PAGE_PUBLICATION_STRUCTURE_SQL})
    THEN RAISE(ABORT, 'phase6_required_page_structure_invalid')
  END;
  SELECT CASE
    WHEN NEW.entity_type = 'legal_status'
      AND (
        (
          NEW.workflow_status = 'published'
          AND (
            OLD.workflow_status <> 'published'
            OR NEW.published_revision_id IS NOT OLD.published_revision_id
          )
        )
        OR (
          OLD.workflow_status = 'published'
          AND NEW.workflow_status <> 'published'
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM organization_memberships AS owner_membership
        JOIN profiles AS owner
          ON owner.id = owner_membership.profile_id
         AND owner.status = 'active'
         AND owner.deleted_at IS NULL
        WHERE owner_membership.organization_id = NEW.organization_id
          AND owner_membership.profile_id = NEW.last_editor_profile_id
          AND owner_membership.role = 'owner'
          AND owner_membership.status = 'active'
          AND owner_membership.deleted_at IS NULL
      )
    THEN RAISE(ABORT, 'phase6_legal_owner_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS cms_entity_publication_states_phase6_legal_coherence_before_update
BEFORE UPDATE ON cms_entity_publication_states
WHEN NEW.entity_type = 'legal_status'
 AND NEW.workflow_status = 'published'
BEGIN
  SELECT CASE
    WHEN NOT (${CMS_LEGAL_PUBLICATION_COHERENT_SQL})
    THEN RAISE(ABORT, 'phase6_legal_confirmation_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS cms_entity_publication_states_phase6_before_delete
BEFORE DELETE ON cms_entity_publication_states
BEGIN
  SELECT RAISE(ABORT, 'phase6_cms_state_delete_forbidden');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS cms_entity_revisions_phase6_before_insert
BEFORE INSERT ON cms_entity_revisions
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM cms_entity_publication_states AS state
      WHERE state.id = NEW.publication_state_id
        AND state.organization_id = NEW.organization_id
        AND state.entity_type = NEW.entity_type
        AND state.entity_key = NEW.entity_key
    )
    THEN RAISE(ABORT, 'phase6_cms_revision_state_mismatch')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS membership
      JOIN profiles AS actor
        ON actor.id = membership.profile_id
       AND actor.status = 'active'
       AND actor.deleted_at IS NULL
      WHERE membership.organization_id = NEW.organization_id
        AND membership.profile_id = NEW.actor_profile_id
        AND membership.role IN ('owner', 'administrator')
        AND membership.status = 'active'
        AND membership.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'phase6_cms_actor_unauthorized')
  END;
  SELECT CASE
    WHEN NOT (${cmsRevisionHasActiveLaneSql(
      "NEW.entity_type",
      "NEW.snapshot_json",
      "NEW.canonical_byte_size",
      "NEW.organization_id",
    )})
    THEN RAISE(ABORT, 'phase6_cms_revision_lane_mismatch')
  END;
  SELECT CASE
    WHEN NEW.restored_from_revision_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM cms_entity_revisions AS prior_revision
        WHERE prior_revision.id = NEW.restored_from_revision_id
          AND prior_revision.organization_id = NEW.organization_id
          AND prior_revision.publication_state_id =
              NEW.publication_state_id
          AND prior_revision.entity_type = NEW.entity_type
          AND prior_revision.entity_key = NEW.entity_key
          AND prior_revision.revision_number < NEW.revision_number
      )
    THEN RAISE(ABORT, 'phase6_cms_restore_revision_mismatch')
  END;
  SELECT CASE
    WHEN (
      NEW.entity_type <> 'page'
      AND NEW.legacy_page_revision_id IS NOT NULL
    ) OR (
      NEW.legacy_page_revision_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM page_revisions AS legacy_revision
        JOIN pages AS page
          ON page.id = legacy_revision.page_id
         AND page.organization_id = legacy_revision.organization_id
        WHERE legacy_revision.id = NEW.legacy_page_revision_id
          AND legacy_revision.organization_id = NEW.organization_id
          AND legacy_revision.page_id = NEW.entity_key
      )
    )
    THEN RAISE(ABORT, 'phase6_cms_legacy_revision_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS cms_entity_revisions_phase6_before_update
BEFORE UPDATE ON cms_entity_revisions
BEGIN
  SELECT RAISE(ABORT, 'phase6_cms_revision_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS cms_entity_revisions_phase6_before_delete
BEFORE DELETE ON cms_entity_revisions
BEGIN
  SELECT RAISE(ABORT, 'phase6_cms_revision_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS cms_public_materialization_receipts_phase6_before_insert
BEFORE INSERT ON cms_public_materialization_receipts
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM cms_entity_publication_states AS state
      JOIN cms_entity_revisions AS revision
        ON revision.id = state.published_revision_id
       AND revision.organization_id = state.organization_id
       AND revision.publication_state_id = state.id
       AND revision.entity_type = state.entity_type
       AND revision.entity_key = state.entity_key
      JOIN organization_memberships AS membership
        ON membership.organization_id = state.organization_id
       AND membership.profile_id = NEW.actor_profile_id
       AND membership.role IN ('owner', 'administrator')
       AND (
         state.entity_type <> 'legal_status'
         OR membership.role = 'owner'
       )
       AND membership.status = 'active'
       AND membership.deleted_at IS NULL
      JOIN profiles AS actor
        ON actor.id = membership.profile_id
       AND actor.status = 'active'
       AND actor.deleted_at IS NULL
      WHERE state.id = NEW.publication_state_id
        AND state.organization_id = NEW.organization_id
        AND state.entity_type = NEW.entity_type
        AND state.entity_key = NEW.entity_key
        AND state.workflow_status = 'published'
        AND state.published_revision_id = NEW.revision_id
        AND state.last_editor_profile_id = NEW.actor_profile_id
        AND revision.content_hash = NEW.revision_hash
    )
    THEN RAISE(ABORT, 'phase6_materialization_receipt_mismatch')
  END;
  SELECT CASE
    WHEN NEW.entity_type NOT IN (
      'page',
      'club_public_profile',
      'program_public_profile',
      'community_link',
      'navigation',
      'site_identity',
      'legal_status'
    )
    THEN RAISE(ABORT, 'phase6_materialization_revision_mismatch')
  END;
END;`,
  ...CMS_RECEIPT_ENTITY_TYPES.flatMap(cmsReceiptRevisionGuardTriggerSql),
  String.raw`
CREATE TRIGGER IF NOT EXISTS cms_public_materialization_receipts_phase6_before_update
BEFORE UPDATE ON cms_public_materialization_receipts
BEGIN
  SELECT RAISE(ABORT, 'phase6_materialization_receipt_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS cms_public_materialization_receipts_phase6_before_delete
BEFORE DELETE ON cms_public_materialization_receipts
BEGIN
  SELECT RAISE(ABORT, 'phase6_materialization_receipt_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS pages_phase6_materialization_before_insert
BEFORE INSERT ON pages
WHEN NEW.status = 'published'
 AND NEW.visibility = 'public'
 AND NEW.published_at IS NOT NULL
 AND NEW.deleted_at IS NULL
BEGIN
  SELECT CASE
    WHEN NOT (${exactCurrentReceiptExistsSql(
      "page",
      "NEW.id",
      "NEW.organization_id",
      String.raw`
        NEW.title =
            json_extract(
              public_receipt.projection_json,
              '$.page.title'
            )
        AND NEW.slug =
            json_extract(
              public_receipt.projection_json,
              '$.page.slug'
            )
        AND NEW.current_revision =
            json_extract(
              public_receipt.projection_json,
              '$.page.currentRevision'
            )`,
    )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS pages_phase6_materialization_before_update
BEFORE UPDATE ON pages
WHEN NEW.status = 'published'
 AND NEW.visibility = 'public'
 AND NEW.published_at IS NOT NULL
 AND NEW.deleted_at IS NULL
BEGIN
  SELECT CASE
    WHEN NOT (${exactCurrentReceiptExistsSql(
      "page",
      "NEW.id",
      "NEW.organization_id",
      String.raw`
        NEW.title =
            json_extract(
              public_receipt.projection_json,
              '$.page.title'
            )
        AND NEW.slug =
            json_extract(
              public_receipt.projection_json,
              '$.page.slug'
            )
        AND NEW.current_revision =
            json_extract(
              public_receipt.projection_json,
              '$.page.currentRevision'
            )`,
    )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS page_sections_phase6_materialization_before_insert
BEFORE INSERT ON page_sections
WHEN NEW.deleted_at IS NULL
 AND EXISTS (
   SELECT 1
   FROM pages AS public_page
   WHERE public_page.id = NEW.page_id
     AND public_page.organization_id = NEW.organization_id
     AND public_page.status = 'published'
     AND public_page.visibility = 'public'
     AND public_page.published_at IS NOT NULL
     AND public_page.deleted_at IS NULL
 )
BEGIN
  SELECT CASE
    WHEN NOT (${exactCurrentReceiptExistsSql(
      "page",
      "NEW.page_id",
      "NEW.organization_id",
      String.raw`
        EXISTS (
          SELECT 1
          FROM json_each(
            public_receipt.projection_json,
            '$.sections'
          ) AS expected
          WHERE json_extract(expected.value, '$.sectionKey') =
                NEW.section_key
            AND json_extract(expected.value, '$.sectionType') =
                NEW.section_type
            AND json_extract(expected.value, '$.sortOrder') =
                NEW.sort_order
            AND ${jsonSemanticallyEqualSql(
              "json_extract(expected.value, '$.contentJson')",
              "NEW.content_json",
            )}
        )`,
    )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS page_sections_phase6_materialization_before_update
BEFORE UPDATE ON page_sections
WHEN NEW.deleted_at IS NULL
 AND EXISTS (
   SELECT 1
   FROM pages AS public_page
   WHERE public_page.id = NEW.page_id
     AND public_page.organization_id = NEW.organization_id
     AND public_page.status = 'published'
     AND public_page.visibility = 'public'
     AND public_page.published_at IS NOT NULL
     AND public_page.deleted_at IS NULL
 )
BEGIN
  SELECT CASE
    WHEN NOT (${exactCurrentReceiptExistsSql(
      "page",
      "NEW.page_id",
      "NEW.organization_id",
      String.raw`
        EXISTS (
          SELECT 1
          FROM json_each(
            public_receipt.projection_json,
            '$.sections'
          ) AS expected
          WHERE json_extract(expected.value, '$.sectionKey') =
                NEW.section_key
            AND json_extract(expected.value, '$.sectionType') =
                NEW.section_type
            AND json_extract(expected.value, '$.sortOrder') =
                NEW.sort_order
            AND ${jsonSemanticallyEqualSql(
              "json_extract(expected.value, '$.contentJson')",
              "NEW.content_json",
            )}
        )`,
    )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS page_sections_phase6_materialization_before_delete
BEFORE DELETE ON page_sections
WHEN OLD.deleted_at IS NULL
 AND EXISTS (
   SELECT 1
   FROM pages AS public_page
   JOIN cms_entity_publication_states AS public_state
     ON public_state.organization_id = public_page.organization_id
    AND public_state.entity_type = 'page'
    AND public_state.entity_key = public_page.id
    AND public_state.workflow_status = 'published'
   WHERE public_page.id = OLD.page_id
     AND public_page.organization_id = OLD.organization_id
     AND public_page.status = 'published'
     AND public_page.visibility = 'public'
     AND public_page.published_at IS NOT NULL
     AND public_page.deleted_at IS NULL
 )
BEGIN
  SELECT RAISE(ABORT, 'phase6_public_projection_receipt_required');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organization_memberships_phase6_public_email_before_insert
BEFORE INSERT ON organization_memberships
BEGIN
  SELECT CASE
    WHEN ${organizationPublicContentContainsEmailSql(
      "NEW.normalized_email",
      "NEW.organization_id",
    )}
    THEN RAISE(ABORT, 'phase6_public_organizer_email_forbidden')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organization_memberships_phase6_public_email_before_update
BEFORE UPDATE ON organization_memberships
BEGIN
  SELECT CASE
    WHEN ${organizationPublicContentContainsEmailSql(
      "NEW.normalized_email",
      "NEW.organization_id",
    )}
    THEN RAISE(ABORT, 'phase6_public_organizer_email_forbidden')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS profiles_phase6_public_email_before_update
BEFORE UPDATE ON profiles
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM organization_memberships AS profile_membership
      WHERE profile_membership.profile_id = NEW.id
        AND ${organizationPublicContentContainsEmailSql(
          "NEW.normalized_email",
          "profile_membership.organization_id",
        )}
    )
    THEN RAISE(ABORT, 'phase6_public_organizer_email_forbidden')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_intents_phase6_before_insert
BEFORE INSERT ON organizer_public_attribution_write_intents
BEGIN
  SELECT CASE
    WHEN NEW.actor_profile_id <> NEW.profile_id
      OR NEW.operation NOT IN ('adopted', 'confirmed', 'revoked')
      OR EXISTS (
        SELECT 1
        FROM organizer_public_attribution_write_intents AS open_intent
        WHERE open_intent.organization_id = NEW.organization_id
          AND open_intent.profile_id = NEW.profile_id
          AND open_intent.completed_at IS NULL
      )
      OR NOT EXISTS (
        SELECT 1
        FROM organizer_public_attribution_states AS attribution
        JOIN organization_memberships AS membership
          ON membership.organization_id = attribution.organization_id
         AND membership.profile_id = attribution.profile_id
         AND membership.status = 'active'
         AND membership.deleted_at IS NULL
        JOIN profiles AS profile
          ON profile.id = attribution.profile_id
         AND profile.status = 'active'
         AND profile.deleted_at IS NULL
        WHERE attribution.profile_id = NEW.profile_id
          AND attribution.organization_id = NEW.organization_id
          AND attribution.attribution_version =
              NEW.expected_draft_version
          AND attribution.published_attribution_version =
              NEW.expected_published_version
          AND NEW.proposed_published_version =
              attribution.published_attribution_version + 1
      )
    THEN RAISE(ABORT, 'phase6_public_attribution_intent_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_intents_phase6_adopted_before_insert
BEFORE INSERT ON organizer_public_attribution_write_intents
WHEN NEW.operation = 'adopted'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      JOIN profiles AS profile
        ON profile.id = attribution.profile_id
       AND profile.status = 'active'
       AND profile.deleted_at IS NULL
      WHERE attribution.profile_id = NEW.profile_id
        AND attribution.organization_id = NEW.organization_id
        AND attribution.workflow_status = 'unconfirmed'
        AND attribution.published_attribution_version = 0
        AND attribution.current_receipt_id IS NULL
        AND profile.public_attribution_consent = 1
        AND length(trim(profile.display_name)) BETWEEN 1 AND 120
        AND instr(profile.display_name, '@') = 0
        AND lower(trim(profile.display_name)) <>
            lower(profile.normalized_email)
        AND NOT (${protectedLegalClaimSql(["profile.display_name"])})
        AND NOT (${publicOrganizerEmailExposureSql(
          ["profile.display_name"],
          "attribution.organization_id",
        )})
    )
    THEN RAISE(ABORT, 'phase6_public_attribution_intent_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_intents_phase6_confirmed_before_insert
BEFORE INSERT ON organizer_public_attribution_write_intents
WHEN NEW.operation = 'confirmed'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      JOIN profiles AS profile
        ON profile.id = attribution.profile_id
       AND profile.status = 'active'
       AND profile.deleted_at IS NULL
      JOIN organizer_profile_preferences AS preference
        ON preference.profile_id = attribution.profile_id
       AND preference.organization_id = attribution.organization_id
      WHERE attribution.profile_id = NEW.profile_id
        AND attribution.organization_id = NEW.organization_id
        AND preference.public_attribution_consent_draft = 1
        AND length(trim(preference.workspace_display_name))
            BETWEEN 1 AND 120
        AND instr(preference.workspace_display_name, '@') = 0
        AND lower(trim(preference.workspace_display_name)) <>
            lower(profile.normalized_email)
    )
    THEN RAISE(ABORT, 'phase6_public_attribution_intent_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_intents_phase6_confirmed_legal_before_insert
BEFORE INSERT ON organizer_public_attribution_write_intents
WHEN NEW.operation = 'confirmed'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      JOIN organizer_profile_preferences AS preference
        ON preference.profile_id = attribution.profile_id
       AND preference.organization_id = attribution.organization_id
      WHERE attribution.profile_id = NEW.profile_id
        AND attribution.organization_id = NEW.organization_id
        AND NOT (${protectedLegalClaimSql([
          "preference.workspace_display_name",
          "preference.public_biography",
        ])})
    )
    THEN RAISE(ABORT, 'phase6_public_attribution_intent_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_intents_phase6_confirmed_email_before_insert
BEFORE INSERT ON organizer_public_attribution_write_intents
WHEN NEW.operation = 'confirmed'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      JOIN organizer_profile_preferences AS preference
        ON preference.profile_id = attribution.profile_id
       AND preference.organization_id = attribution.organization_id
      WHERE attribution.profile_id = NEW.profile_id
        AND attribution.organization_id = NEW.organization_id
        AND NOT (${publicOrganizerEmailExposureSql(
          [
            "preference.workspace_display_name",
            "preference.public_biography",
          ],
          "attribution.organization_id",
        )})
    )
    THEN RAISE(ABORT, 'phase6_public_attribution_intent_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_intents_phase6_confirmed_photo_before_insert
BEFORE INSERT ON organizer_public_attribution_write_intents
WHEN NEW.operation = 'confirmed'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      WHERE attribution.profile_id = NEW.profile_id
        AND attribution.organization_id = NEW.organization_id
        AND (
          attribution.draft_photo_media_asset_id IS NULL
          OR ${mediaAssetPublicReadyCoreSql(
            "attribution.draft_photo_media_asset_id",
            "attribution.organization_id",
          )}
        )
    )
    THEN RAISE(ABORT, 'phase6_public_attribution_intent_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_intents_phase6_confirmed_photo_legal_before_insert
BEFORE INSERT ON organizer_public_attribution_write_intents
WHEN NEW.operation = 'confirmed'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      WHERE attribution.profile_id = NEW.profile_id
        AND attribution.organization_id = NEW.organization_id
        AND (
          attribution.draft_photo_media_asset_id IS NULL
          OR ${mediaAssetPublicLegalSafeSql(
            "attribution.draft_photo_media_asset_id",
            "attribution.organization_id",
          )}
        )
    )
    THEN RAISE(ABORT, 'phase6_public_attribution_intent_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_intents_phase6_confirmed_photo_email_before_insert
BEFORE INSERT ON organizer_public_attribution_write_intents
WHEN NEW.operation = 'confirmed'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      WHERE attribution.profile_id = NEW.profile_id
        AND attribution.organization_id = NEW.organization_id
        AND (
          attribution.draft_photo_media_asset_id IS NULL
          OR ${mediaAssetPublicEmailSafeSql(
            "attribution.draft_photo_media_asset_id",
            "attribution.organization_id",
          )}
        )
    )
    THEN RAISE(ABORT, 'phase6_public_attribution_intent_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_intents_phase6_revoked_before_insert
BEFORE INSERT ON organizer_public_attribution_write_intents
WHEN NEW.operation = 'revoked'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      JOIN profiles AS profile
        ON profile.id = attribution.profile_id
       AND profile.status = 'active'
       AND profile.deleted_at IS NULL
      WHERE attribution.profile_id = NEW.profile_id
        AND attribution.organization_id = NEW.organization_id
        AND attribution.workflow_status = 'confirmed'
        AND attribution.current_receipt_id IS NOT NULL
        AND profile.public_attribution_consent = 1
    )
    THEN RAISE(ABORT, 'phase6_public_attribution_intent_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_intents_phase6_before_update
BEFORE UPDATE ON organizer_public_attribution_write_intents
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.profile_id <> OLD.profile_id
      OR NEW.operation <> OLD.operation
      OR NEW.expected_draft_version <> OLD.expected_draft_version
      OR NEW.expected_published_version <>
          OLD.expected_published_version
      OR NEW.proposed_published_version <>
          OLD.proposed_published_version
      OR NEW.snapshot_hash <> OLD.snapshot_hash
      OR NEW.actor_profile_id <> OLD.actor_profile_id
      OR NEW.created_at <> OLD.created_at
      OR OLD.completed_at IS NOT NULL
      OR NEW.completed_at IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM organizer_public_attribution_states AS attribution
        JOIN organizer_public_attribution_receipts AS receipt
          ON receipt.write_intent_id = OLD.id
         AND receipt.organization_id = OLD.organization_id
         AND receipt.profile_id = OLD.profile_id
         AND receipt.attribution_version =
             OLD.proposed_published_version
         AND receipt.snapshot_hash = OLD.snapshot_hash
        JOIN profiles AS profile
          ON profile.id = attribution.profile_id
         AND profile.status = 'active'
         AND profile.deleted_at IS NULL
        WHERE attribution.profile_id = OLD.profile_id
          AND attribution.organization_id = OLD.organization_id
          AND attribution.attribution_version =
              OLD.expected_draft_version
          AND attribution.published_attribution_version =
              OLD.proposed_published_version
          AND attribution.current_receipt_id = receipt.id
          AND (
            (
              OLD.operation IN ('adopted', 'confirmed')
              AND receipt.action = OLD.operation
              AND attribution.workflow_status = 'confirmed'
              AND profile.public_attribution_consent = 1
              AND profile.display_name =
                  attribution.public_display_name
              AND receipt.consent = 1
              AND receipt.draft_version =
                  attribution.attribution_version
              AND receipt.display_name =
                  attribution.public_display_name
              AND receipt.biography IS attribution.public_biography
              AND receipt.photo_media_asset_id IS
                  attribution.public_photo_media_asset_id
              AND (
                (
                  attribution.public_photo_media_asset_id IS NULL
                  AND NOT EXISTS (
                    SELECT 1
                    FROM media_usage_references AS public_photo
                    WHERE public_photo.organization_id =
                          attribution.organization_id
                      AND public_photo.entity_type =
                          'organizer_profile'
                      AND public_photo.entity_id =
                          attribution.profile_id
                      AND public_photo.usage_kind = 'profile_photo'
                      AND public_photo.publication_scope = 'published'
                      AND public_photo.deleted_at IS NULL
                  )
                )
                OR EXISTS (
                  SELECT 1
                  FROM media_usage_references AS public_photo
                  WHERE public_photo.organization_id =
                        attribution.organization_id
                    AND public_photo.asset_id =
                        attribution.public_photo_media_asset_id
                    AND public_photo.entity_type =
                        'organizer_profile'
                    AND public_photo.entity_id =
                        attribution.profile_id
                    AND public_photo.revision_id =
                        attribution.current_receipt_id
                    AND public_photo.usage_kind = 'profile_photo'
                    AND public_photo.publication_scope = 'published'
                    AND public_photo.deleted_at IS NULL
                )
              )
              AND EXISTS (
                SELECT 1
                FROM audit_logs AS audit
                WHERE audit.organization_id =
                      attribution.organization_id
                  AND audit.actor_profile_id =
                      attribution.profile_id
                  AND audit.entity_type = 'profile'
                  AND audit.entity_id = attribution.profile_id
                  AND audit.action =
                      CASE OLD.operation
                        WHEN 'adopted'
                        THEN 'profile.public_attribution_adopted'
                        ELSE 'profile.public_attribution_confirmed'
                      END
                  AND json_extract(
                        audit.metadata_json,
                        '$.writeIntentId'
                      ) = OLD.id
              )
            )
            OR (
              OLD.operation = 'revoked'
              AND receipt.action = 'revoked'
              AND attribution.workflow_status = 'revoked'
              AND profile.public_attribution_consent = 0
              AND attribution.public_display_name IS NULL
              AND attribution.public_biography IS NULL
              AND attribution.public_photo_media_asset_id IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM media_usage_references AS public_photo
                WHERE public_photo.organization_id =
                      attribution.organization_id
                  AND public_photo.entity_type = 'organizer_profile'
                  AND public_photo.entity_id = attribution.profile_id
                  AND public_photo.usage_kind = 'profile_photo'
                  AND public_photo.publication_scope = 'published'
                  AND public_photo.deleted_at IS NULL
              )
              AND EXISTS (
                SELECT 1
                FROM audit_logs AS audit
                WHERE audit.organization_id =
                      attribution.organization_id
                  AND audit.actor_profile_id =
                      attribution.profile_id
                  AND audit.entity_type = 'profile'
                  AND audit.entity_id = attribution.profile_id
                  AND audit.action =
                      'profile.public_attribution_revoked'
                  AND json_extract(
                        audit.metadata_json,
                        '$.writeIntentId'
                      ) = OLD.id
              )
            )
          )
      )
    THEN RAISE(ABORT, 'phase6_public_attribution_intent_incomplete')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_intents_phase6_before_delete
BEFORE DELETE ON organizer_public_attribution_write_intents
BEGIN
  SELECT RAISE(ABORT, 'phase6_public_attribution_intent_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_intents_phase6_after_insert
AFTER INSERT ON organizer_public_attribution_write_intents
BEGIN
  DELETE FROM database_invariant_state
  WHERE singleton_key = 'database-guards';
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_receipts_phase6_before_insert
BEFORE INSERT ON organizer_public_attribution_receipts
BEGIN
  SELECT CASE
    WHEN NEW.actor_profile_id <> NEW.profile_id
      OR NEW.action NOT IN ('adopted', 'confirmed', 'revoked')
      OR NOT EXISTS (
        SELECT 1
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
        WHERE intent.id = NEW.write_intent_id
          AND intent.organization_id = NEW.organization_id
          AND intent.profile_id = NEW.profile_id
          AND intent.actor_profile_id = NEW.actor_profile_id
          AND intent.completed_at IS NULL
          AND intent.proposed_published_version =
              NEW.attribution_version
          AND intent.snapshot_hash = NEW.snapshot_hash
          AND NEW.action = intent.operation
          AND NEW.related_receipt_id IS
              attribution.current_receipt_id
          AND NEW.draft_version = attribution.attribution_version
      )
    THEN RAISE(ABORT, 'phase6_public_attribution_receipt_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_receipts_phase6_adopted_before_insert
BEFORE INSERT ON organizer_public_attribution_receipts
WHEN NEW.action = 'adopted'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      JOIN profiles AS profile
        ON profile.id = attribution.profile_id
       AND profile.status = 'active'
       AND profile.deleted_at IS NULL
      WHERE attribution.profile_id = NEW.profile_id
        AND attribution.organization_id = NEW.organization_id
        AND attribution.workflow_status = 'unconfirmed'
        AND attribution.current_receipt_id IS NULL
        AND profile.public_attribution_consent = 1
        AND NEW.legacy_adopted = 1
        AND NEW.consent = 1
        AND NEW.display_name = profile.display_name
        AND NEW.biography IS NULL
        AND NEW.photo_media_asset_id IS NULL
        AND NEW.prior_published_version IS NULL
        AND NEW.snapshot_json = json_object(
          'biography', NULL,
          'consent', json('true'),
          'displayName', NEW.display_name,
          'draftVersion', NEW.draft_version,
          'legacyAdopted', json('true'),
          'photoAssetId', NULL
        )
    )
    THEN RAISE(ABORT, 'phase6_public_attribution_receipt_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_receipts_phase6_confirmed_before_insert
BEFORE INSERT ON organizer_public_attribution_receipts
WHEN NEW.action = 'confirmed'
BEGIN
  SELECT CASE
    WHEN NEW.legacy_adopted <> 0
      OR NEW.consent <> 1
      OR NEW.prior_published_version IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM organizer_public_attribution_states AS attribution
        JOIN organizer_profile_preferences AS preference
          ON preference.profile_id = attribution.profile_id
         AND preference.organization_id = attribution.organization_id
        WHERE attribution.profile_id = NEW.profile_id
          AND attribution.organization_id = NEW.organization_id
          AND preference.public_attribution_consent_draft = 1
          AND NEW.display_name = preference.workspace_display_name
          AND NEW.biography IS preference.public_biography
          AND NEW.photo_media_asset_id IS
              attribution.draft_photo_media_asset_id
          AND NEW.snapshot_json = json_object(
            'biography', NEW.biography,
            'consent', json('true'),
            'displayName', NEW.display_name,
            'draftVersion', NEW.draft_version,
            'legacyAdopted', json('false'),
            'photoAssetId', NEW.photo_media_asset_id
          )
      )
    THEN RAISE(ABORT, 'phase6_public_attribution_receipt_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_receipts_phase6_confirmed_legal_before_insert
BEFORE INSERT ON organizer_public_attribution_receipts
WHEN NEW.action = 'confirmed'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      JOIN organizer_profile_preferences AS preference
        ON preference.profile_id = attribution.profile_id
       AND preference.organization_id = attribution.organization_id
      WHERE attribution.profile_id = NEW.profile_id
        AND attribution.organization_id = NEW.organization_id
        AND NOT (${protectedLegalClaimSql([
          "preference.workspace_display_name",
          "preference.public_biography",
        ])})
    )
    THEN RAISE(ABORT, 'phase6_public_attribution_receipt_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_receipts_phase6_confirmed_email_before_insert
BEFORE INSERT ON organizer_public_attribution_receipts
WHEN NEW.action = 'confirmed'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      JOIN organizer_profile_preferences AS preference
        ON preference.profile_id = attribution.profile_id
       AND preference.organization_id = attribution.organization_id
      WHERE attribution.profile_id = NEW.profile_id
        AND attribution.organization_id = NEW.organization_id
        AND NOT (${publicOrganizerEmailExposureSql(
          [
            "preference.workspace_display_name",
            "preference.public_biography",
          ],
          "attribution.organization_id",
        )})
    )
    THEN RAISE(ABORT, 'phase6_public_attribution_receipt_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_receipts_phase6_confirmed_photo_before_insert
BEFORE INSERT ON organizer_public_attribution_receipts
WHEN NEW.action = 'confirmed'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      WHERE attribution.profile_id = NEW.profile_id
        AND attribution.organization_id = NEW.organization_id
        AND (
          attribution.draft_photo_media_asset_id IS NULL
          OR ${mediaAssetPublicReadyCoreSql(
            "attribution.draft_photo_media_asset_id",
            "attribution.organization_id",
          )}
        )
    )
    THEN RAISE(ABORT, 'phase6_public_attribution_receipt_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_receipts_phase6_confirmed_photo_legal_before_insert
BEFORE INSERT ON organizer_public_attribution_receipts
WHEN NEW.action = 'confirmed'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      WHERE attribution.profile_id = NEW.profile_id
        AND attribution.organization_id = NEW.organization_id
        AND (
          attribution.draft_photo_media_asset_id IS NULL
          OR ${mediaAssetPublicLegalSafeSql(
            "attribution.draft_photo_media_asset_id",
            "attribution.organization_id",
          )}
        )
    )
    THEN RAISE(ABORT, 'phase6_public_attribution_receipt_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_receipts_phase6_confirmed_photo_email_before_insert
BEFORE INSERT ON organizer_public_attribution_receipts
WHEN NEW.action = 'confirmed'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      WHERE attribution.profile_id = NEW.profile_id
        AND attribution.organization_id = NEW.organization_id
        AND (
          attribution.draft_photo_media_asset_id IS NULL
          OR ${mediaAssetPublicEmailSafeSql(
            "attribution.draft_photo_media_asset_id",
            "attribution.organization_id",
          )}
        )
    )
    THEN RAISE(ABORT, 'phase6_public_attribution_receipt_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_receipts_phase6_revoked_before_insert
BEFORE INSERT ON organizer_public_attribution_receipts
WHEN NEW.action = 'revoked'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      JOIN profiles AS profile
        ON profile.id = attribution.profile_id
       AND profile.status = 'active'
       AND profile.deleted_at IS NULL
      WHERE attribution.profile_id = NEW.profile_id
        AND attribution.organization_id = NEW.organization_id
        AND attribution.workflow_status = 'confirmed'
        AND profile.public_attribution_consent = 1
        AND NEW.consent = 0
        AND NEW.legacy_adopted = 0
        AND NEW.display_name IS NULL
        AND NEW.biography IS NULL
        AND NEW.photo_media_asset_id IS NULL
        AND NEW.related_receipt_id = attribution.current_receipt_id
        AND NEW.prior_published_version =
            attribution.published_attribution_version
        AND NEW.snapshot_json = json_object(
          'consent', json('false'),
          'draftVersion', NEW.draft_version,
          'priorPublishedVersion', NEW.prior_published_version,
          'relatedReceiptId', NEW.related_receipt_id
        )
    )
    THEN RAISE(ABORT, 'phase6_public_attribution_receipt_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_receipts_phase6_before_update
BEFORE UPDATE ON organizer_public_attribution_receipts
BEGIN
  SELECT RAISE(ABORT, 'phase6_public_attribution_receipt_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_receipts_phase6_before_delete
BEFORE DELETE ON organizer_public_attribution_receipts
BEGIN
  SELECT RAISE(ABORT, 'phase6_public_attribution_receipt_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_receipts_phase6_after_insert
AFTER INSERT ON organizer_public_attribution_receipts
BEGIN
  DELETE FROM database_invariant_state
  WHERE singleton_key = 'database-guards';
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_states_phase6_before_insert
BEFORE INSERT ON organizer_public_attribution_states
BEGIN
  SELECT CASE
    WHEN NEW.profile_id <> NEW.updated_by_profile_id
      OR NEW.attribution_version <> 1
      OR NEW.published_attribution_version <> 0
      OR NEW.workflow_status <> 'unconfirmed'
      OR NOT EXISTS (
        SELECT 1
        FROM organization_memberships AS membership
        JOIN profiles AS profile
          ON profile.id = membership.profile_id
         AND profile.status = 'active'
         AND profile.deleted_at IS NULL
        WHERE membership.organization_id = NEW.organization_id
          AND membership.profile_id = NEW.profile_id
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
      )
      OR (
        NEW.draft_photo_media_asset_id IS NOT NULL
        AND NOT (${mediaAssetPublicReadySql(
          "NEW.draft_photo_media_asset_id",
          "NEW.organization_id",
        )})
      )
    THEN RAISE(ABORT, 'phase6_public_attribution_state_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_states_phase6_before_update
BEFORE UPDATE ON organizer_public_attribution_states
BEGIN
  SELECT CASE
    WHEN NEW.profile_id <> OLD.profile_id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.created_at <> OLD.created_at
      OR NEW.updated_by_profile_id <> NEW.profile_id
      OR NOT EXISTS (
        SELECT 1
        FROM organization_memberships AS membership
        JOIN profiles AS actor
          ON actor.id = membership.profile_id
         AND actor.status = 'active'
         AND actor.deleted_at IS NULL
        WHERE membership.organization_id = NEW.organization_id
          AND membership.profile_id = NEW.profile_id
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
      )
      OR NOT (
        (
          NEW.attribution_version = OLD.attribution_version + 1
          AND NEW.published_attribution_version =
              OLD.published_attribution_version
          AND NEW.workflow_status = OLD.workflow_status
          AND NEW.public_display_name IS OLD.public_display_name
          AND NEW.public_biography IS OLD.public_biography
          AND NEW.public_photo_media_asset_id IS
              OLD.public_photo_media_asset_id
          AND NEW.current_receipt_id IS OLD.current_receipt_id
          AND NEW.confirmed_at IS OLD.confirmed_at
          AND NEW.revoked_at IS OLD.revoked_at
          AND NOT EXISTS (
            SELECT 1
            FROM organizer_public_attribution_write_intents AS intent
            WHERE intent.organization_id = NEW.organization_id
              AND intent.profile_id = NEW.profile_id
              AND intent.completed_at IS NULL
          )
          AND (
            NEW.draft_photo_media_asset_id IS NULL
            OR ${mediaAssetPublicReadySql(
              "NEW.draft_photo_media_asset_id",
              "NEW.organization_id",
            )}
          )
        )
        OR (
          NEW.attribution_version = OLD.attribution_version
          AND NEW.published_attribution_version =
              OLD.published_attribution_version + 1
          AND NEW.draft_photo_media_asset_id IS
              OLD.draft_photo_media_asset_id
          AND EXISTS (
            SELECT 1
            FROM organizer_public_attribution_write_intents AS intent
            JOIN organizer_public_attribution_receipts AS receipt
              ON receipt.write_intent_id = intent.id
             AND receipt.organization_id = intent.organization_id
             AND receipt.profile_id = intent.profile_id
             AND receipt.attribution_version =
                 intent.proposed_published_version
             AND receipt.snapshot_hash = intent.snapshot_hash
            JOIN profiles AS profile
              ON profile.id = NEW.profile_id
            WHERE intent.organization_id = NEW.organization_id
              AND intent.profile_id = NEW.profile_id
              AND intent.actor_profile_id = NEW.profile_id
              AND intent.expected_draft_version =
                  OLD.attribution_version
              AND intent.expected_published_version =
                  OLD.published_attribution_version
              AND intent.proposed_published_version =
                  NEW.published_attribution_version
              AND intent.completed_at IS NULL
              AND NEW.current_receipt_id = receipt.id
              AND (
                (
                  intent.operation IN ('adopted', 'confirmed')
                  AND receipt.action = intent.operation
                  AND NEW.workflow_status = 'confirmed'
                  AND NEW.public_display_name =
                      receipt.display_name
                  AND NEW.public_biography IS receipt.biography
                  AND NEW.public_photo_media_asset_id IS
                      receipt.photo_media_asset_id
                  AND profile.public_attribution_consent = 1
                  AND profile.display_name =
                      NEW.public_display_name
                  AND NEW.confirmed_at IS NOT NULL
                  AND NEW.revoked_at IS NULL
                )
                OR (
                  intent.operation = 'revoked'
                  AND receipt.action = 'revoked'
                  AND OLD.workflow_status = 'confirmed'
                  AND receipt.related_receipt_id =
                      OLD.current_receipt_id
                  AND NEW.workflow_status = 'revoked'
                  AND NEW.public_display_name IS NULL
                  AND NEW.public_biography IS NULL
                  AND NEW.public_photo_media_asset_id IS NULL
                  AND profile.public_attribution_consent = 0
                  AND NEW.confirmed_at IS OLD.confirmed_at
                  AND NEW.revoked_at IS NOT NULL
                )
              )
          )
        )
      )
    THEN RAISE(ABORT, 'phase6_public_attribution_state_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_states_phase6_before_delete
BEFORE DELETE ON organizer_public_attribution_states
BEGIN
  SELECT RAISE(ABORT, 'phase6_public_attribution_state_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_states_phase6_after_insert
AFTER INSERT ON organizer_public_attribution_states
BEGIN
  DELETE FROM database_invariant_state
  WHERE singleton_key = 'database-guards';
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS profiles_phase6_public_attribution_before_update
BEFORE UPDATE OF display_name, public_attribution_consent ON profiles
WHEN (
  NEW.display_name IS NOT OLD.display_name
  OR NEW.public_attribution_consent <> OLD.public_attribution_consent
)
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      JOIN organizer_public_attribution_write_intents AS intent
        ON intent.organization_id = attribution.organization_id
       AND intent.profile_id = attribution.profile_id
       AND intent.expected_draft_version =
           attribution.attribution_version
       AND intent.expected_published_version =
           attribution.published_attribution_version
       AND intent.proposed_published_version =
           attribution.published_attribution_version + 1
       AND intent.completed_at IS NULL
      JOIN organizer_public_attribution_receipts AS receipt
        ON receipt.write_intent_id = intent.id
       AND receipt.organization_id = attribution.organization_id
       AND receipt.profile_id = attribution.profile_id
       AND receipt.attribution_version =
           intent.proposed_published_version
       AND receipt.snapshot_hash = intent.snapshot_hash
      WHERE attribution.profile_id = OLD.id
        AND (
          (
            intent.operation IN ('adopted', 'confirmed')
            AND receipt.action = intent.operation
            AND NEW.public_attribution_consent = 1
            AND NEW.display_name = receipt.display_name
          )
          OR (
            intent.operation = 'revoked'
            AND NEW.public_attribution_consent = 0
            AND NEW.display_name IS OLD.display_name
            AND receipt.action = 'revoked'
            AND receipt.related_receipt_id =
                attribution.current_receipt_id
          )
        )
    )
    THEN RAISE(ABORT, 'phase6_public_attribution_profile_guard')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS profiles_phase6_public_attribution_after_update
AFTER UPDATE OF display_name, public_attribution_consent ON profiles
WHEN NEW.display_name IS NOT OLD.display_name
  OR NEW.public_attribution_consent <> OLD.public_attribution_consent
BEGIN
  DELETE FROM database_invariant_state
  WHERE singleton_key = 'database-guards';
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_public_attribution_states_phase6_after_update
AFTER UPDATE ON organizer_public_attribution_states
BEGIN
  DELETE FROM database_invariant_state
  WHERE singleton_key = 'database-guards';
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS public_slug_redirects_phase6_before_insert
BEFORE INSERT ON public_slug_redirects
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS membership
      JOIN profiles AS actor
        ON actor.id = membership.profile_id
       AND actor.status = 'active'
       AND actor.deleted_at IS NULL
      WHERE membership.organization_id = NEW.organization_id
        AND membership.profile_id = NEW.created_by_profile_id
        AND membership.role IN ('owner', 'administrator')
        AND membership.status = 'active'
        AND membership.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'phase6_cms_actor_unauthorized')
  END;
  SELECT CASE
    WHEN (
      NEW.entity_type = 'page'
      AND NOT EXISTS (
        SELECT 1
        FROM pages AS page
        WHERE page.id = NEW.entity_id
          AND page.organization_id = NEW.organization_id
      )
    ) OR (
      NEW.entity_type = 'club_public_profile'
      AND NOT EXISTS (
        SELECT 1
        FROM club_public_profiles AS profile
        WHERE profile.club_id = NEW.entity_id
          AND profile.organization_id = NEW.organization_id
      )
    ) OR (
      NEW.entity_type = 'program_public_profile'
      AND NOT EXISTS (
        SELECT 1
        FROM programs AS program
        WHERE program.id = NEW.entity_id
          AND program.organization_id = NEW.organization_id
      )
    )
    THEN RAISE(ABORT, 'phase6_slug_redirect_organization_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS public_slug_redirects_phase6_before_update
BEFORE UPDATE ON public_slug_redirects
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.entity_type <> OLD.entity_type
      OR NEW.entity_id <> OLD.entity_id
      OR NEW.from_slug <> OLD.from_slug
      OR NEW.to_slug <> OLD.to_slug
      OR NEW.created_by_profile_id <> OLD.created_by_profile_id
      OR NEW.created_at <> OLD.created_at
      OR OLD.state <> 'active'
      OR NEW.state <> 'superseded'
    THEN RAISE(ABORT, 'phase6_slug_redirect_transition_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS page_public_metadata_phase6_before_insert
BEFORE INSERT ON page_public_metadata
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM pages AS page
      JOIN organization_memberships AS membership
        ON membership.organization_id = page.organization_id
       AND membership.profile_id = NEW.updated_by_profile_id
       AND membership.role IN ('owner', 'administrator')
       AND membership.status = 'active'
       AND membership.deleted_at IS NULL
      JOIN profiles AS actor
        ON actor.id = membership.profile_id
       AND actor.status = 'active'
       AND actor.deleted_at IS NULL
      WHERE page.id = NEW.page_id
        AND page.organization_id = NEW.organization_id
    )
    THEN RAISE(ABORT, 'phase6_page_metadata_organization_mismatch')
  END;
  SELECT CASE
    WHEN NEW.og_media_asset_id IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "NEW.og_media_asset_id",
        "NEW.organization_id",
      )})
    THEN RAISE(ABORT, 'phase6_page_metadata_media_organization_mismatch')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM pages AS public_page
      WHERE public_page.id = NEW.page_id
        AND public_page.organization_id = NEW.organization_id
        AND public_page.status = 'published'
        AND public_page.visibility = 'public'
        AND public_page.published_at IS NOT NULL
        AND public_page.deleted_at IS NULL
    )
      AND NOT (${exactCurrentReceiptExistsSql(
        "page",
        "NEW.page_id",
        "NEW.organization_id",
        String.raw`
          NEW.seo_title =
              json_extract(
                public_receipt.projection_json,
                '$.metadata.seoTitle'
              )
          AND NEW.meta_description =
              json_extract(
                public_receipt.projection_json,
                '$.metadata.metaDescription'
              )
          AND NEW.og_media_asset_id IS
              json_extract(
                public_receipt.projection_json,
                '$.metadata.openGraphAssetId'
              )`,
      )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS page_public_metadata_phase6_before_update
BEFORE UPDATE ON page_public_metadata
BEGIN
  SELECT CASE
    WHEN NEW.page_id <> OLD.page_id
      OR NEW.organization_id <> OLD.organization_id
      OR NOT EXISTS (
        SELECT 1
        FROM organization_memberships AS membership
        JOIN profiles AS actor
          ON actor.id = membership.profile_id
         AND actor.status = 'active'
         AND actor.deleted_at IS NULL
        WHERE membership.organization_id = NEW.organization_id
          AND membership.profile_id = NEW.updated_by_profile_id
          AND membership.role IN ('owner', 'administrator')
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
      )
    THEN RAISE(ABORT, 'phase6_page_metadata_organization_mismatch')
  END;
  SELECT CASE
    WHEN NEW.og_media_asset_id IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "NEW.og_media_asset_id",
        "NEW.organization_id",
      )})
    THEN RAISE(ABORT, 'phase6_page_metadata_media_organization_mismatch')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM pages AS public_page
      WHERE public_page.id = NEW.page_id
        AND public_page.organization_id = NEW.organization_id
        AND public_page.status = 'published'
        AND public_page.visibility = 'public'
        AND public_page.published_at IS NOT NULL
        AND public_page.deleted_at IS NULL
    )
      AND NOT (${exactCurrentReceiptExistsSql(
        "page",
        "NEW.page_id",
        "NEW.organization_id",
        String.raw`
          NEW.seo_title =
              json_extract(
                public_receipt.projection_json,
                '$.metadata.seoTitle'
              )
          AND NEW.meta_description =
              json_extract(
                public_receipt.projection_json,
                '$.metadata.metaDescription'
              )
          AND NEW.og_media_asset_id IS
              json_extract(
                public_receipt.projection_json,
                '$.metadata.openGraphAssetId'
              )`,
      )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS clubs_phase6_materialization_before_update
BEFORE UPDATE ON clubs
WHEN NEW.deleted_at IS NULL
 AND EXISTS (
   SELECT 1
   FROM club_public_profiles AS public_profile
   WHERE public_profile.club_id = NEW.id
     AND public_profile.organization_id = NEW.organization_id
     AND public_profile.publication_status IN ('published', 'archived')
     AND public_profile.published_at IS NOT NULL
     AND public_profile.deleted_at IS NULL
 )
BEGIN
  SELECT CASE
    WHEN NOT (${exactCurrentReceiptExistsSql(
      "club_public_profile",
      "NEW.id",
      "NEW.organization_id",
      String.raw`
        NEW.name =
            json_extract(
              public_receipt.projection_json,
              '$.club.name'
            )
        AND NEW.slug =
            json_extract(
              public_receipt.projection_json,
              '$.club.slug'
            )
        AND NEW.description =
            json_extract(
              public_receipt.projection_json,
              '$.club.description'
            )`,
    )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS club_public_profiles_phase6_materialization_before_insert
BEFORE INSERT ON club_public_profiles
WHEN NEW.publication_status IN ('published', 'archived')
 AND NEW.published_at IS NOT NULL
 AND NEW.deleted_at IS NULL
BEGIN
  SELECT CASE
    WHEN NOT (${exactCurrentReceiptExistsSql(
      "club_public_profile",
      "NEW.club_id",
      "NEW.organization_id",
      String.raw`
        NEW.primary_event_lane_id =
            json_extract(
              public_receipt.projection_json,
              '$.profile.laneId'
            )
        AND NEW.is_featured =
            json_extract(
              public_receipt.projection_json,
              '$.profile.featured'
            )
        AND NEW.description =
            json_extract(
              public_receipt.projection_json,
              '$.profile.summary'
            )
        AND NEW.public_group_url IS
            json_extract(
              public_receipt.projection_json,
              '$.profile.meetupGroupUrl'
            )`,
    )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS club_public_profiles_phase6_materialization_before_update
BEFORE UPDATE ON club_public_profiles
WHEN NEW.publication_status IN ('published', 'archived')
 AND NEW.published_at IS NOT NULL
 AND NEW.deleted_at IS NULL
BEGIN
  SELECT CASE
    WHEN NOT (${exactCurrentReceiptExistsSql(
      "club_public_profile",
      "NEW.club_id",
      "NEW.organization_id",
      String.raw`
        NEW.primary_event_lane_id =
            json_extract(
              public_receipt.projection_json,
              '$.profile.laneId'
            )
        AND NEW.is_featured =
            json_extract(
              public_receipt.projection_json,
              '$.profile.featured'
            )
        AND NEW.description =
            json_extract(
              public_receipt.projection_json,
              '$.profile.summary'
            )
        AND NEW.public_group_url IS
            json_extract(
              public_receipt.projection_json,
              '$.profile.meetupGroupUrl'
            )`,
    )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_events_phase6_public_legal_before_update
BEFORE UPDATE ON organizer_events
WHEN NEW.publication_status IN ('scheduled', 'published')
BEGIN
  SELECT CASE
    WHEN ${EVENT_LEGAL_CLAIM_FROM_NEW_EVENT_SQL}
    THEN RAISE(ABORT, 'phase6_event_public_legal_claim_unconfirmed')
  END;
  SELECT CASE
    WHEN ${EVENT_ORGANIZER_EMAIL_FROM_NEW_EVENT_SQL}
    THEN RAISE(ABORT, 'phase6_public_organizer_email_forbidden')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_public_details_phase6_legal_before_insert
BEFORE INSERT ON organizer_event_public_details
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM organizer_events AS event
      WHERE event.id = NEW.organizer_event_id
        AND event.organization_id = NEW.organization_id
        AND event.publication_status IN ('scheduled', 'published')
    )
      AND ${EVENT_LEGAL_CLAIM_FROM_NEW_DETAILS_SQL}
    THEN RAISE(ABORT, 'phase6_event_public_legal_claim_unconfirmed')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM organizer_events AS event
      WHERE event.id = NEW.organizer_event_id
        AND event.organization_id = NEW.organization_id
        AND event.publication_status IN ('scheduled', 'published')
    )
      AND ${EVENT_ORGANIZER_EMAIL_FROM_NEW_DETAILS_SQL}
    THEN RAISE(ABORT, 'phase6_public_organizer_email_forbidden')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_public_details_phase6_legal_before_update
BEFORE UPDATE ON organizer_event_public_details
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM organizer_events AS event
      WHERE event.id = NEW.organizer_event_id
        AND event.organization_id = NEW.organization_id
        AND event.publication_status IN ('scheduled', 'published')
    )
      AND ${EVENT_LEGAL_CLAIM_FROM_NEW_DETAILS_SQL}
    THEN RAISE(ABORT, 'phase6_event_public_legal_claim_unconfirmed')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM organizer_events AS event
      WHERE event.id = NEW.organizer_event_id
        AND event.organization_id = NEW.organization_id
        AND event.publication_status IN ('scheduled', 'published')
    )
      AND ${EVENT_ORGANIZER_EMAIL_FROM_NEW_DETAILS_SQL}
    THEN RAISE(ABORT, 'phase6_public_organizer_email_forbidden')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_public_metadata_phase6_before_insert
BEFORE INSERT ON organizer_event_public_metadata
BEGIN
  SELECT CASE
    WHEN NOT (${EVENT_PUBLIC_METADATA_ACTOR_AUTHORIZED_SQL})
      OR NEW.updated_at < NEW.created_at
    THEN RAISE(ABORT, 'phase6_event_public_metadata_unauthorized')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM organizer_events AS event
      WHERE event.id = NEW.organizer_event_id
        AND event.organization_id = NEW.organization_id
        AND event.publication_status IN ('scheduled', 'published')
    )
      AND ${EVENT_LEGAL_CLAIM_FROM_NEW_METADATA_SQL}
    THEN RAISE(ABORT, 'phase6_event_public_legal_claim_unconfirmed')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM organizer_events AS event
      WHERE event.id = NEW.organizer_event_id
        AND event.organization_id = NEW.organization_id
        AND event.publication_status IN ('scheduled', 'published')
    )
      AND ${EVENT_ORGANIZER_EMAIL_FROM_NEW_METADATA_SQL}
    THEN RAISE(ABORT, 'phase6_public_organizer_email_forbidden')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_event_public_metadata_phase6_before_update
BEFORE UPDATE ON organizer_event_public_metadata
BEGIN
  SELECT CASE
    WHEN NEW.organizer_event_id <> OLD.organizer_event_id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.created_at <> OLD.created_at
      OR NEW.updated_at < NEW.created_at
      OR NOT (${EVENT_PUBLIC_METADATA_ACTOR_AUTHORIZED_SQL})
    THEN RAISE(ABORT, 'phase6_event_public_metadata_unauthorized')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM organizer_events AS event
      WHERE event.id = NEW.organizer_event_id
        AND event.organization_id = NEW.organization_id
        AND event.publication_status IN ('scheduled', 'published')
    )
      AND ${EVENT_LEGAL_CLAIM_FROM_NEW_METADATA_SQL}
    THEN RAISE(ABORT, 'phase6_event_public_legal_claim_unconfirmed')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM organizer_events AS event
      WHERE event.id = NEW.organizer_event_id
        AND event.organization_id = NEW.organization_id
        AND event.publication_status IN ('scheduled', 'published')
    )
      AND ${EVENT_ORGANIZER_EMAIL_FROM_NEW_METADATA_SQL}
    THEN RAISE(ABORT, 'phase6_public_organizer_email_forbidden')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS club_public_profile_details_phase6_before_insert
BEFORE INSERT ON club_public_profile_details
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM club_public_profiles AS public_profile
      JOIN organization_memberships AS membership
        ON membership.organization_id = public_profile.organization_id
       AND membership.profile_id = NEW.updated_by_profile_id
       AND membership.role IN ('owner', 'administrator')
       AND membership.status = 'active'
       AND membership.deleted_at IS NULL
      JOIN profiles AS actor
        ON actor.id = membership.profile_id
       AND actor.status = 'active'
       AND actor.deleted_at IS NULL
      WHERE public_profile.club_id = NEW.club_id
        AND public_profile.organization_id = NEW.organization_id
    )
    THEN RAISE(ABORT, 'phase6_club_details_organization_mismatch')
  END;
  SELECT CASE
    WHEN (
      NEW.cover_media_asset_id IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "NEW.cover_media_asset_id",
        "NEW.organization_id",
      )})
    ) OR (
      NEW.thumbnail_media_asset_id IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "NEW.thumbnail_media_asset_id",
        "NEW.organization_id",
      )})
    )
    THEN RAISE(ABORT, 'phase6_club_details_media_organization_mismatch')
  END;
  SELECT CASE
    WHEN NEW.og_media_asset_id IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "NEW.og_media_asset_id",
        "NEW.organization_id",
      )})
    THEN RAISE(ABORT, 'phase6_club_details_og_media_not_public_ready')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM club_public_profiles AS public_profile
      WHERE public_profile.club_id = NEW.club_id
        AND public_profile.organization_id = NEW.organization_id
        AND public_profile.publication_status IN ('published', 'archived')
        AND public_profile.published_at IS NOT NULL
        AND public_profile.deleted_at IS NULL
    )
      AND NOT (${exactCurrentReceiptExistsSql(
        "club_public_profile",
        "NEW.club_id",
        "NEW.organization_id",
        String.raw`
          json_type(
            public_receipt.projection_json,
            '$.details'
          ) = 'object'
          AND NEW.public_display_name =
              json_extract(
                public_receipt.projection_json,
                '$.details.publicDisplayName'
              )
          AND NEW.short_summary =
              json_extract(
                public_receipt.projection_json,
                '$.details.shortSummary'
              )
          AND NEW.full_description =
              json_extract(
                public_receipt.projection_json,
                '$.details.fullDescription'
              )
          AND NEW.program_type =
              json_extract(
                public_receipt.projection_json,
                '$.details.programType'
              )
          AND NEW.cover_media_asset_id IS
              json_extract(
                public_receipt.projection_json,
                '$.details.coverAssetId'
              )
          AND NEW.thumbnail_media_asset_id IS
              json_extract(
                public_receipt.projection_json,
                '$.details.thumbnailAssetId'
              )
          AND NEW.image_alt_text IS
              json_extract(
                public_receipt.projection_json,
                '$.details.imageAltText'
              )
          AND NEW.theme_color =
              json_extract(
                public_receipt.projection_json,
                '$.details.themeColor'
              )
          AND NEW.participant_expectations IS
              json_extract(
                public_receipt.projection_json,
                '$.details.participantExpectations'
              )
          AND NEW.preparation_information IS
              json_extract(
                public_receipt.projection_json,
                '$.details.preparationInformation'
              )
          AND NEW.typical_format IS
              json_extract(
                public_receipt.projection_json,
                '$.details.typicalFormat'
              )
          AND json(NEW.confirmed_social_links_json) =
              json(
                json_extract(
                  public_receipt.projection_json,
                  '$.details.confirmedSocialLinks'
                )
              )
          AND json(NEW.related_resources_json) =
              json(
                json_extract(
                  public_receipt.projection_json,
                  '$.details.relatedResources'
                )
              )
          AND NEW.seo_title =
              json_extract(
                public_receipt.projection_json,
                '$.details.seoTitle'
              )
          AND NEW.meta_description =
              json_extract(
                public_receipt.projection_json,
                '$.details.metaDescription'
              )
          AND NEW.og_media_asset_id IS
              json_extract(
                public_receipt.projection_json,
                '$.details.openGraphAssetId'
              )`,
      )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS club_public_profile_details_phase6_before_update
BEFORE UPDATE ON club_public_profile_details
BEGIN
  SELECT CASE
    WHEN NEW.club_id <> OLD.club_id
      OR NEW.organization_id <> OLD.organization_id
      OR NOT EXISTS (
        SELECT 1
        FROM organization_memberships AS membership
        JOIN profiles AS actor
          ON actor.id = membership.profile_id
         AND actor.status = 'active'
         AND actor.deleted_at IS NULL
        WHERE membership.organization_id = NEW.organization_id
          AND membership.profile_id = NEW.updated_by_profile_id
          AND membership.role IN ('owner', 'administrator')
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
      )
    THEN RAISE(ABORT, 'phase6_club_details_organization_mismatch')
  END;
  SELECT CASE
    WHEN (
      NEW.cover_media_asset_id IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "NEW.cover_media_asset_id",
        "NEW.organization_id",
      )})
    ) OR (
      NEW.thumbnail_media_asset_id IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "NEW.thumbnail_media_asset_id",
        "NEW.organization_id",
      )})
    )
    THEN RAISE(ABORT, 'phase6_club_details_media_organization_mismatch')
  END;
  SELECT CASE
    WHEN NEW.og_media_asset_id IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "NEW.og_media_asset_id",
        "NEW.organization_id",
      )})
    THEN RAISE(ABORT, 'phase6_club_details_og_media_not_public_ready')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM club_public_profiles AS public_profile
      WHERE public_profile.club_id = NEW.club_id
        AND public_profile.organization_id = NEW.organization_id
        AND public_profile.publication_status IN ('published', 'archived')
        AND public_profile.published_at IS NOT NULL
        AND public_profile.deleted_at IS NULL
    )
      AND NOT (${exactCurrentReceiptExistsSql(
        "club_public_profile",
        "NEW.club_id",
        "NEW.organization_id",
        String.raw`
          json_type(
            public_receipt.projection_json,
            '$.details'
          ) = 'object'
          AND NEW.public_display_name =
              json_extract(
                public_receipt.projection_json,
                '$.details.publicDisplayName'
              )
          AND NEW.short_summary =
              json_extract(
                public_receipt.projection_json,
                '$.details.shortSummary'
              )
          AND NEW.full_description =
              json_extract(
                public_receipt.projection_json,
                '$.details.fullDescription'
              )
          AND NEW.program_type =
              json_extract(
                public_receipt.projection_json,
                '$.details.programType'
              )
          AND NEW.cover_media_asset_id IS
              json_extract(
                public_receipt.projection_json,
                '$.details.coverAssetId'
              )
          AND NEW.thumbnail_media_asset_id IS
              json_extract(
                public_receipt.projection_json,
                '$.details.thumbnailAssetId'
              )
          AND NEW.image_alt_text IS
              json_extract(
                public_receipt.projection_json,
                '$.details.imageAltText'
              )
          AND NEW.theme_color =
              json_extract(
                public_receipt.projection_json,
                '$.details.themeColor'
              )
          AND NEW.participant_expectations IS
              json_extract(
                public_receipt.projection_json,
                '$.details.participantExpectations'
              )
          AND NEW.preparation_information IS
              json_extract(
                public_receipt.projection_json,
                '$.details.preparationInformation'
              )
          AND NEW.typical_format IS
              json_extract(
                public_receipt.projection_json,
                '$.details.typicalFormat'
              )
          AND json(NEW.confirmed_social_links_json) =
              json(
                json_extract(
                  public_receipt.projection_json,
                  '$.details.confirmedSocialLinks'
                )
              )
          AND json(NEW.related_resources_json) =
              json(
                json_extract(
                  public_receipt.projection_json,
                  '$.details.relatedResources'
                )
              )
          AND NEW.seo_title =
              json_extract(
                public_receipt.projection_json,
                '$.details.seoTitle'
              )
          AND NEW.meta_description =
              json_extract(
                public_receipt.projection_json,
                '$.details.metaDescription'
              )
          AND NEW.og_media_asset_id IS
              json_extract(
                public_receipt.projection_json,
                '$.details.openGraphAssetId'
              )`,
      )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS program_public_profile_details_phase6_before_insert
BEFORE INSERT ON program_public_profile_details
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM programs AS program
      JOIN clubs AS club
        ON club.id = program.club_id
       AND club.organization_id = program.organization_id
       AND club.deleted_at IS NULL
      JOIN event_lanes AS lane
        ON lane.id = NEW.primary_event_lane_id
       AND lane.organization_id = program.organization_id
       AND lane.deleted_at IS NULL
      JOIN organization_memberships AS membership
        ON membership.organization_id = program.organization_id
       AND membership.profile_id = NEW.updated_by_profile_id
       AND membership.role IN ('owner', 'administrator')
       AND membership.status = 'active'
       AND membership.deleted_at IS NULL
      JOIN profiles AS actor
        ON actor.id = membership.profile_id
       AND actor.status = 'active'
       AND actor.deleted_at IS NULL
      WHERE program.id = NEW.program_id
        AND program.organization_id = NEW.organization_id
        AND program.club_id = NEW.club_id
        AND program.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'phase6_program_details_organization_mismatch')
  END;
  SELECT CASE
    WHEN (
      NEW.cover_media_asset_id IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "NEW.cover_media_asset_id",
        "NEW.organization_id",
      )})
    ) OR (
      NEW.thumbnail_media_asset_id IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "NEW.thumbnail_media_asset_id",
        "NEW.organization_id",
      )})
    ) OR (
      NEW.og_media_asset_id IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "NEW.og_media_asset_id",
        "NEW.organization_id",
      )})
    )
    THEN RAISE(ABORT, 'phase6_program_details_media_not_public_ready')
  END;
  SELECT CASE
    WHEN (
      NEW.publication_status = 'published'
      OR (
        NEW.publication_status = 'archived'
        AND NEW.published_at IS NOT NULL
      )
    )
      AND NOT (${exactCurrentReceiptExistsSql(
        "program_public_profile",
        "NEW.program_id",
        "NEW.organization_id",
        programPublicProjectionMatchesReceiptSql("NEW"),
      )})
    THEN RAISE(ABORT, 'phase6_program_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS program_public_profile_details_phase6_before_update
BEFORE UPDATE ON program_public_profile_details
BEGIN
  SELECT CASE
    WHEN NEW.program_id <> OLD.program_id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.club_id <> OLD.club_id
      OR NEW.created_at <> OLD.created_at
      OR NOT EXISTS (
        SELECT 1
        FROM programs AS program
        JOIN event_lanes AS lane
          ON lane.id = NEW.primary_event_lane_id
         AND lane.organization_id = program.organization_id
         AND lane.deleted_at IS NULL
        JOIN organization_memberships AS membership
          ON membership.organization_id = program.organization_id
         AND membership.profile_id = NEW.updated_by_profile_id
         AND membership.role IN ('owner', 'administrator')
         AND membership.status = 'active'
         AND membership.deleted_at IS NULL
        JOIN profiles AS actor
          ON actor.id = membership.profile_id
         AND actor.status = 'active'
         AND actor.deleted_at IS NULL
        WHERE program.id = NEW.program_id
          AND program.organization_id = NEW.organization_id
          AND program.club_id = NEW.club_id
          AND program.deleted_at IS NULL
      )
    THEN RAISE(ABORT, 'phase6_program_details_organization_mismatch')
  END;
  SELECT CASE
    WHEN (
      NEW.cover_media_asset_id IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "NEW.cover_media_asset_id",
        "NEW.organization_id",
      )})
    ) OR (
      NEW.thumbnail_media_asset_id IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "NEW.thumbnail_media_asset_id",
        "NEW.organization_id",
      )})
    ) OR (
      NEW.og_media_asset_id IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "NEW.og_media_asset_id",
        "NEW.organization_id",
      )})
    )
    THEN RAISE(ABORT, 'phase6_program_details_media_not_public_ready')
  END;
  SELECT CASE
    WHEN (
      NEW.publication_status = 'published'
      OR (
        NEW.publication_status = 'archived'
        AND NEW.published_at IS NOT NULL
      )
    )
      AND NOT (
        ${exactCurrentReceiptExistsSql(
          "program_public_profile",
          "NEW.program_id",
          "NEW.organization_id",
          programPublicProjectionMatchesReceiptSql("NEW"),
        )}
        OR (
          OLD.publication_status = 'published'
          AND OLD.published_at IS NOT NULL
          AND NEW.publication_status = 'archived'
          AND (${programPublicFieldsUnchangedSql("NEW", "OLD")})
          AND ${exactCurrentReceiptExistsSql(
            "program_public_profile",
            "OLD.program_id",
            "OLD.organization_id",
            programPublicProjectionMatchesReceiptSql("OLD"),
          )}
        )
      )
    THEN RAISE(ABORT, 'phase6_program_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS program_public_profile_details_phase6_before_delete
BEFORE DELETE ON program_public_profile_details
BEGIN
  SELECT RAISE(ABORT, 'phase6_program_details_delete_forbidden');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_events_phase6_program_before_insert
BEFORE INSERT ON organizer_events
WHEN NEW.program_id IS NOT NULL
 AND NEW.deleted_at IS NULL
 AND NEW.planning_status NOT IN ('cancelled', 'completed', 'archived')
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM program_public_profile_details AS program_detail
      JOIN cms_entity_publication_states AS program_state
        ON program_state.organization_id = program_detail.organization_id
       AND program_state.entity_type = 'program_public_profile'
       AND program_state.entity_key = program_detail.program_id
       AND program_state.workflow_status = 'archived'
       AND program_state.published_revision_id IS NOT NULL
      WHERE program_detail.program_id = NEW.program_id
        AND program_detail.organization_id = NEW.organization_id
        AND program_detail.club_id = NEW.club_id
        AND program_detail.publication_status = 'archived'
        AND program_detail.published_at IS NOT NULL
        AND program_detail.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'phase6_archived_program_scheduling_forbidden')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS organizer_events_phase6_program_before_update
BEFORE UPDATE ON organizer_events
WHEN NEW.program_id IS NOT NULL
 AND NEW.deleted_at IS NULL
 AND NEW.planning_status NOT IN ('cancelled', 'completed', 'archived')
 AND (
   NEW.program_id IS NOT OLD.program_id
   OR NEW.club_id <> OLD.club_id
   OR NEW.planning_status <> OLD.planning_status
   OR NEW.schedule_version <> OLD.schedule_version
   OR NEW.deleted_at IS NOT OLD.deleted_at
 )
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM program_public_profile_details AS program_detail
      JOIN cms_entity_publication_states AS program_state
        ON program_state.organization_id = program_detail.organization_id
       AND program_state.entity_type = 'program_public_profile'
       AND program_state.entity_key = program_detail.program_id
       AND program_state.workflow_status = 'archived'
       AND program_state.published_revision_id IS NOT NULL
      WHERE program_detail.program_id = NEW.program_id
        AND program_detail.organization_id = NEW.organization_id
        AND program_detail.club_id = NEW.club_id
        AND program_detail.publication_status = 'archived'
        AND program_detail.published_at IS NOT NULL
        AND program_detail.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'phase6_archived_program_scheduling_forbidden')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS site_settings_phase6_media_before_insert
BEFORE INSERT ON site_settings
WHEN NEW.key IN ('public_identity', 'public_legal_status')
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS membership
      JOIN profiles AS actor
        ON actor.id = membership.profile_id
       AND actor.status = 'active'
       AND actor.deleted_at IS NULL
      WHERE membership.organization_id = NEW.organization_id
        AND membership.profile_id = NEW.updated_by_profile_id
        AND membership.role IN ('owner', 'administrator')
        AND (
          NEW.key <> 'public_legal_status'
          OR membership.role = 'owner'
        )
        AND membership.status = 'active'
        AND membership.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'phase6_site_identity_actor_unauthorized')
  END;
  SELECT CASE
    WHEN (
      json_extract(NEW.value_json, '$.logoAssetId') IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "json_extract(NEW.value_json, '$.logoAssetId')",
        "NEW.organization_id",
      )})
    ) OR (
      json_extract(NEW.value_json, '$.openGraphAssetId') IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "json_extract(NEW.value_json, '$.openGraphAssetId')",
        "NEW.organization_id",
      )})
    )
    THEN RAISE(ABORT, 'phase6_site_identity_media_organization_mismatch')
  END;
  SELECT CASE
    WHEN NEW.is_public = 1
      AND NOT (${exactCurrentReceiptExistsSql(
        "site_identity",
        "'site_identity'",
        "NEW.organization_id",
        String.raw`
          NEW.key = 'public_identity'
          AND NEW.value_json =
              json_extract(
                public_receipt.projection_json,
                '$.setting.valueJson'
              )`,
      )})
      AND NOT (${exactCurrentReceiptExistsSql(
        "legal_status",
        "'legal_status'",
        "NEW.organization_id",
        String.raw`
          NEW.key = 'public_legal_status'
          AND NEW.value_json =
              json_extract(
                public_receipt.projection_json,
                '$.setting.valueJson'
              )`,
      )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS site_settings_phase6_media_before_update
BEFORE UPDATE ON site_settings
WHEN OLD.key IN ('public_identity', 'public_legal_status')
  OR NEW.key IN ('public_identity', 'public_legal_status')
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.key <> OLD.key
    THEN RAISE(ABORT, 'phase6_site_identity_projection_immutable')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organization_memberships AS membership
      JOIN profiles AS actor
        ON actor.id = membership.profile_id
       AND actor.status = 'active'
       AND actor.deleted_at IS NULL
      WHERE membership.organization_id = NEW.organization_id
        AND membership.profile_id = NEW.updated_by_profile_id
        AND membership.role IN ('owner', 'administrator')
        AND (
          NEW.key <> 'public_legal_status'
          OR membership.role = 'owner'
        )
        AND membership.status = 'active'
        AND membership.deleted_at IS NULL
    )
    THEN RAISE(ABORT, 'phase6_site_identity_actor_unauthorized')
  END;
  SELECT CASE
    WHEN (
      json_extract(NEW.value_json, '$.logoAssetId') IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "json_extract(NEW.value_json, '$.logoAssetId')",
        "NEW.organization_id",
      )})
    ) OR (
      json_extract(NEW.value_json, '$.openGraphAssetId') IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "json_extract(NEW.value_json, '$.openGraphAssetId')",
        "NEW.organization_id",
      )})
    )
    THEN RAISE(ABORT, 'phase6_site_identity_media_organization_mismatch')
  END;
  SELECT CASE
    WHEN NEW.is_public = 1
      AND NOT (${exactCurrentReceiptExistsSql(
        "site_identity",
        "'site_identity'",
        "NEW.organization_id",
        String.raw`
          NEW.key = 'public_identity'
          AND NEW.value_json =
              json_extract(
                public_receipt.projection_json,
                '$.setting.valueJson'
              )`,
      )})
      AND NOT (${exactCurrentReceiptExistsSql(
        "legal_status",
        "'legal_status'",
        "NEW.organization_id",
        String.raw`
          NEW.key = 'public_legal_status'
          AND NEW.value_json =
              json_extract(
                public_receipt.projection_json,
                '$.setting.valueJson'
              )`,
      )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS community_links_phase6_materialization_before_insert
BEFORE INSERT ON community_links
WHEN NEW.is_published = 1 AND NEW.deleted_at IS NULL
BEGIN
  SELECT CASE
    WHEN NOT (${exactCurrentReceiptExistsSql(
      "community_link",
      "NEW.id",
      "NEW.organization_id",
      String.raw`
        NEW.label =
            json_extract(
              public_receipt.projection_json,
              '$.link.label'
            )
        AND NEW.url =
            json_extract(
              public_receipt.projection_json,
              '$.link.url'
            )
        AND NEW.link_type =
            json_extract(
              public_receipt.projection_json,
              '$.link.linkType'
            )
        AND NEW.sort_order =
            json_extract(
              public_receipt.projection_json,
              '$.link.sortOrder'
            )`,
    )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS community_links_phase6_materialization_before_update
BEFORE UPDATE ON community_links
WHEN NEW.is_published = 1 AND NEW.deleted_at IS NULL
BEGIN
  SELECT CASE
    WHEN NOT (${exactCurrentReceiptExistsSql(
      "community_link",
      "NEW.id",
      "NEW.organization_id",
      String.raw`
        NEW.label =
            json_extract(
              public_receipt.projection_json,
              '$.link.label'
            )
        AND NEW.url =
            json_extract(
              public_receipt.projection_json,
              '$.link.url'
            )
        AND NEW.link_type =
            json_extract(
              public_receipt.projection_json,
              '$.link.linkType'
            )
        AND NEW.sort_order =
            json_extract(
              public_receipt.projection_json,
              '$.link.sortOrder'
            )`,
    )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS community_link_public_details_phase6_before_insert
BEFORE INSERT ON community_link_public_details
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM community_links AS link
      JOIN organization_memberships AS membership
        ON membership.organization_id = link.organization_id
       AND membership.profile_id = NEW.confirmed_by_profile_id
       AND membership.role IN ('owner', 'administrator')
       AND membership.status = 'active'
       AND membership.deleted_at IS NULL
      JOIN profiles AS actor
        ON actor.id = membership.profile_id
       AND actor.status = 'active'
       AND actor.deleted_at IS NULL
      WHERE link.id = NEW.community_link_id
        AND link.organization_id = NEW.organization_id
    )
    THEN RAISE(ABORT, 'phase6_community_details_organization_mismatch')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM community_links AS public_link
      WHERE public_link.id = NEW.community_link_id
        AND public_link.organization_id = NEW.organization_id
        AND public_link.is_published = 1
        AND public_link.deleted_at IS NULL
    )
      AND NOT (${exactCurrentReceiptExistsSql(
        "community_link",
        "NEW.community_link_id",
        "NEW.organization_id",
        String.raw`
          NEW.description =
              json_extract(
                public_receipt.projection_json,
                '$.details.description'
              )
          AND NEW.destination_type =
              json_extract(
                public_receipt.projection_json,
                '$.details.destinationType'
              )
          AND NEW.confirmed_by_profile_id =
              public_receipt.actor_profile_id
          AND NEW.confirmed_at = public_receipt.created_at`,
      )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS community_link_public_details_phase6_before_update
BEFORE UPDATE ON community_link_public_details
BEGIN
  SELECT CASE
    WHEN NEW.community_link_id <> OLD.community_link_id
      OR NEW.organization_id <> OLD.organization_id
      OR NOT EXISTS (
        SELECT 1
        FROM organization_memberships AS membership
        JOIN profiles AS actor
          ON actor.id = membership.profile_id
         AND actor.status = 'active'
         AND actor.deleted_at IS NULL
        WHERE membership.organization_id = NEW.organization_id
          AND membership.profile_id = NEW.confirmed_by_profile_id
          AND membership.role IN ('owner', 'administrator')
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
      )
    THEN RAISE(ABORT, 'phase6_community_details_organization_mismatch')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM community_links AS public_link
      WHERE public_link.id = NEW.community_link_id
        AND public_link.organization_id = NEW.organization_id
        AND public_link.is_published = 1
        AND public_link.deleted_at IS NULL
    )
      AND NOT (${exactCurrentReceiptExistsSql(
        "community_link",
        "NEW.community_link_id",
        "NEW.organization_id",
        String.raw`
          NEW.description =
              json_extract(
                public_receipt.projection_json,
                '$.details.description'
              )
          AND NEW.destination_type =
              json_extract(
                public_receipt.projection_json,
                '$.details.destinationType'
              )
          AND NEW.confirmed_by_profile_id =
              public_receipt.actor_profile_id
          AND NEW.confirmed_at = public_receipt.created_at`,
      )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS navigation_items_phase6_materialization_before_insert
BEFORE INSERT ON navigation_items
WHEN NEW.is_published = 1 AND NEW.deleted_at IS NULL
BEGIN
  SELECT CASE
    WHEN NOT (${exactCurrentReceiptExistsSql(
      "navigation",
      "'navigation'",
      "NEW.organization_id",
      String.raw`
        EXISTS (
          SELECT 1
          FROM json_each(
            public_receipt.projection_json,
            '$.items'
          ) AS expected
          LEFT JOIN pages AS target_page
            ON target_page.id = NEW.page_id
           AND target_page.organization_id = NEW.organization_id
          WHERE json_extract(expected.value, '$.id') = NEW.id
            AND json_extract(expected.value, '$.label') = NEW.label
            AND json_extract(expected.value, '$.placement') =
                NEW.placement
            AND json_extract(expected.value, '$.sortOrder') =
                NEW.sort_order
            AND json_extract(expected.value, '$.target') =
                CASE
                  WHEN NEW.external_url IS NOT NULL
                  THEN NEW.external_url
                  WHEN target_page.slug = 'home' THEN '/'
                  WHEN target_page.slug IS NOT NULL
                  THEN '/' || target_page.slug
                  ELSE NULL
                END
        )`,
    )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS navigation_items_phase6_materialization_before_update
BEFORE UPDATE ON navigation_items
WHEN NEW.is_published = 1 AND NEW.deleted_at IS NULL
BEGIN
  SELECT CASE
    WHEN NOT (${exactCurrentReceiptExistsSql(
      "navigation",
      "'navigation'",
      "NEW.organization_id",
      String.raw`
        EXISTS (
          SELECT 1
          FROM json_each(
            public_receipt.projection_json,
            '$.items'
          ) AS expected
          LEFT JOIN pages AS target_page
            ON target_page.id = NEW.page_id
           AND target_page.organization_id = NEW.organization_id
          WHERE json_extract(expected.value, '$.id') = NEW.id
            AND json_extract(expected.value, '$.label') = NEW.label
            AND json_extract(expected.value, '$.placement') =
                NEW.placement
            AND json_extract(expected.value, '$.sortOrder') =
                NEW.sort_order
            AND json_extract(expected.value, '$.target') =
                CASE
                  WHEN NEW.external_url IS NOT NULL
                  THEN NEW.external_url
                  WHEN target_page.slug = 'home' THEN '/'
                  WHEN target_page.slug IS NOT NULL
                  THEN '/' || target_page.slug
                  ELSE NULL
                END
        )`,
    )})
    THEN RAISE(ABORT, 'phase6_public_projection_receipt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS media_assets_phase6_public_legal_before_insert
BEFORE INSERT ON media_assets
BEGIN
  SELECT CASE
    WHEN ${MEDIA_ASSET_PUBLIC_LEGAL_FROM_NEW_SQL}
    THEN RAISE(ABORT, 'phase6_media_public_legal_claim_unconfirmed')
  END;
  SELECT CASE
    WHEN ${MEDIA_ASSET_PUBLIC_EMAIL_FROM_NEW_SQL}
    THEN RAISE(ABORT, 'phase6_public_organizer_email_forbidden')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS media_assets_phase6_public_legal_before_update
BEFORE UPDATE ON media_assets
BEGIN
  SELECT CASE
    WHEN ${MEDIA_ASSET_PUBLIC_LEGAL_FROM_NEW_SQL}
    THEN RAISE(ABORT, 'phase6_media_public_legal_claim_unconfirmed')
  END;
  SELECT CASE
    WHEN ${MEDIA_ASSET_PUBLIC_EMAIL_FROM_NEW_SQL}
    THEN RAISE(ABORT, 'phase6_public_organizer_email_forbidden')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM media_usage_references AS usage
      WHERE usage.organization_id = OLD.organization_id
        AND usage.asset_id = OLD.id
        AND usage.publication_scope = 'published'
        AND usage.deleted_at IS NULL
        AND ${currentPublishedMediaUsageTargetSql("usage")}
    )
    AND (
      NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.deleted_at IS NOT NULL
      OR NEW.rights_status <> 'approved'
      OR NEW.participant_consent_status NOT IN (
        'confirmed', 'not_applicable'
      )
      OR length(trim(COALESCE(NEW.credit, ''))) NOT BETWEEN 1 AND 300
      OR (
        length(trim(COALESCE(NEW.alt_text, ''))) NOT BETWEEN 1 AND 300
        AND (
          EXISTS (
            SELECT 1
            FROM media_usage_references AS required_usage
            WHERE required_usage.organization_id = OLD.organization_id
              AND required_usage.asset_id = OLD.id
              AND required_usage.publication_scope = 'published'
              AND required_usage.deleted_at IS NULL
              AND ${currentPublishedMediaUsageTargetSql("required_usage")}
              AND ${mediaUsageRequiresUsefulAltSql("required_usage")}
          )
          OR EXISTS (
            SELECT 1
            FROM media_asset_details AS detail
            WHERE detail.asset_id = OLD.id
              AND detail.organization_id = OLD.organization_id
              AND detail.informative = 1
          )
        )
      )
    )
    THEN RAISE(ABORT, 'phase6_media_published_asset_downgrade')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS media_asset_details_phase6_before_insert
BEFORE INSERT ON media_asset_details
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM media_assets AS asset
      JOIN organization_memberships AS membership
        ON membership.organization_id = asset.organization_id
       AND membership.profile_id = NEW.updated_by_profile_id
       AND membership.role IN ('owner', 'administrator')
       AND membership.status = 'active'
       AND membership.deleted_at IS NULL
      JOIN profiles AS actor
        ON actor.id = membership.profile_id
       AND actor.status = 'active'
       AND actor.deleted_at IS NULL
      WHERE asset.id = NEW.asset_id
        AND asset.organization_id = NEW.organization_id
    )
    THEN RAISE(ABORT, 'phase6_media_asset_organization_mismatch')
  END;
  SELECT CASE
    WHEN ${MEDIA_DETAIL_PUBLIC_LEGAL_FROM_NEW_SQL}
    THEN RAISE(ABORT, 'phase6_media_public_legal_claim_unconfirmed')
  END;
  SELECT CASE
    WHEN ${MEDIA_DETAIL_PUBLIC_EMAIL_FROM_NEW_SQL}
    THEN RAISE(ABORT, 'phase6_public_organizer_email_forbidden')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS media_asset_details_phase6_before_update
BEFORE UPDATE ON media_asset_details
BEGIN
  SELECT CASE
    WHEN NEW.asset_id <> OLD.asset_id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.content_version NOT BETWEEN OLD.content_version
                                    AND OLD.content_version + 1
      OR NOT EXISTS (
        SELECT 1
        FROM organization_memberships AS membership
        JOIN profiles AS actor
          ON actor.id = membership.profile_id
         AND actor.status = 'active'
         AND actor.deleted_at IS NULL
        WHERE membership.organization_id = NEW.organization_id
          AND membership.profile_id = NEW.updated_by_profile_id
          AND membership.role IN ('owner', 'administrator')
          AND membership.status = 'active'
          AND membership.deleted_at IS NULL
      )
      OR NOT (
        (OLD.upload_state = 'pending' AND NEW.upload_state IN ('pending', 'ready', 'failed'))
        OR (OLD.upload_state = 'failed' AND NEW.upload_state IN ('failed', 'pending'))
        OR (OLD.upload_state = 'ready' AND NEW.upload_state IN ('ready', 'deleting'))
        OR (OLD.upload_state = 'deleting' AND NEW.upload_state = 'deleting')
    )
    THEN RAISE(ABORT, 'phase6_media_asset_transition_invalid')
  END;
  SELECT CASE
    WHEN ${MEDIA_DETAIL_PUBLIC_LEGAL_FROM_NEW_SQL}
    THEN RAISE(ABORT, 'phase6_media_public_legal_claim_unconfirmed')
  END;
  SELECT CASE
    WHEN ${MEDIA_DETAIL_PUBLIC_EMAIL_FROM_NEW_SQL}
    THEN RAISE(ABORT, 'phase6_public_organizer_email_forbidden')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM media_usage_references AS usage
      WHERE usage.organization_id = OLD.organization_id
        AND usage.asset_id = OLD.asset_id
        AND usage.publication_scope = 'published'
        AND usage.deleted_at IS NULL
        AND ${currentPublishedMediaUsageTargetSql("usage")}
    )
    AND (
      NEW.upload_state <> 'ready'
      OR (
        NEW.informative = 1
        AND NOT EXISTS (
          SELECT 1
          FROM media_assets AS asset
          WHERE asset.id = OLD.asset_id
            AND asset.organization_id = OLD.organization_id
            AND length(trim(COALESCE(asset.alt_text, '')))
                BETWEEN 1 AND 300
        )
      )
    )
    THEN RAISE(ABORT, 'phase6_media_published_asset_downgrade')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS media_asset_details_phase6_before_delete
BEFORE DELETE ON media_asset_details
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM media_usage_references AS usage
      WHERE usage.organization_id = OLD.organization_id
        AND usage.asset_id = OLD.asset_id
        AND usage.publication_scope = 'published'
        AND usage.deleted_at IS NULL
        AND ${currentPublishedMediaUsageTargetSql("usage")}
    )
    THEN RAISE(ABORT, 'phase6_media_published_asset_downgrade')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS media_asset_variants_phase6_before_insert
BEFORE INSERT ON media_asset_variants
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM media_assets AS asset
      JOIN media_asset_details AS detail
        ON detail.asset_id = asset.id
       AND detail.organization_id = asset.organization_id
      WHERE asset.id = NEW.asset_id
        AND asset.organization_id = NEW.organization_id
        AND asset.deleted_at IS NULL
        AND detail.upload_state IN ('pending', 'ready')
    )
    THEN RAISE(ABORT, 'phase6_media_variant_organization_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS media_asset_variants_phase6_before_update
BEFORE UPDATE ON media_asset_variants
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.asset_id <> OLD.asset_id
      OR NEW.variant_kind <> OLD.variant_kind
      OR NEW.object_key <> OLD.object_key
      OR NEW.mime_type <> OLD.mime_type
      OR NEW.byte_size <> OLD.byte_size
      OR NEW.width <> OLD.width
      OR NEW.height <> OLD.height
      OR NEW.pixel_count <> OLD.pixel_count
      OR NEW.sha256 <> OLD.sha256
      OR NEW.created_at <> OLD.created_at
      OR NOT (
        (OLD.state = 'pending' AND NEW.state IN ('pending', 'ready', 'failed'))
        OR (OLD.state = 'ready' AND NEW.state = 'ready')
        OR (OLD.state = 'failed' AND NEW.state = 'failed')
      )
    THEN RAISE(ABORT, 'phase6_media_variant_transition_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS media_asset_variants_phase6_before_delete
BEFORE DELETE ON media_asset_variants
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM media_usage_references AS usage
      WHERE usage.organization_id = OLD.organization_id
        AND usage.asset_id = OLD.asset_id
        AND usage.publication_scope = 'published'
        AND usage.deleted_at IS NULL
        AND ${currentPublishedMediaUsageTargetSql("usage")}
    )
    THEN RAISE(ABORT, 'phase6_media_published_asset_downgrade')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS media_usage_references_phase6_before_insert
BEFORE INSERT ON media_usage_references
BEGIN
  SELECT CASE
    WHEN NOT (${MEDIA_USAGE_ACTOR_AUTHORIZED_SQL})
    THEN RAISE(ABORT, 'phase6_media_usage_actor_unauthorized')
  END;
  SELECT CASE
    WHEN NOT (${MEDIA_USAGE_TARGET_MATCH_SQL})
    THEN RAISE(ABORT, 'phase6_media_usage_target_mismatch')
  END;
  SELECT CASE
    WHEN NEW.publication_scope = 'published'
      AND NOT (
        ${currentPublishedMediaUsageTargetSql("NEW")}
        OR ${MEDIA_USAGE_OPEN_PROFILE_ATTRIBUTION_SQL}
      )
    THEN RAISE(ABORT, 'phase6_media_usage_not_current_published')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM media_assets AS asset
      JOIN media_asset_details AS detail
        ON detail.asset_id = asset.id
       AND detail.organization_id = asset.organization_id
      WHERE asset.id = NEW.asset_id
        AND asset.organization_id = NEW.organization_id
        AND asset.deleted_at IS NULL
        AND detail.upload_state = 'ready'
    )
    THEN RAISE(ABORT, 'phase6_media_asset_not_ready')
  END;
  SELECT CASE
    WHEN (
      NEW.publication_scope = 'published'
      OR (
        NEW.entity_type = 'organizer_event'
        AND NEW.usage_kind = 'event_artwork'
      )
    )
      AND NOT (${MEDIA_ASSET_PUBLIC_READY_SQL})
    THEN RAISE(ABORT, 'phase6_media_asset_not_public_ready')
  END;
  SELECT CASE
    WHEN ${mediaUsageRequiresUsefulAltSql("NEW")}
      AND NOT EXISTS (
        SELECT 1
        FROM media_assets AS asset
        WHERE asset.id = NEW.asset_id
          AND asset.organization_id = NEW.organization_id
          AND length(trim(COALESCE(asset.alt_text, '')))
              BETWEEN 1 AND 300
      )
    THEN RAISE(ABORT, 'phase6_media_useful_alt_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS media_usage_references_phase6_before_update
BEFORE UPDATE ON media_usage_references
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.asset_id <> OLD.asset_id
      OR NEW.entity_type <> OLD.entity_type
      OR NEW.entity_id <> OLD.entity_id
      OR NEW.revision_id <> OLD.revision_id
      OR NEW.usage_kind <> OLD.usage_kind
      OR NEW.publication_scope <> OLD.publication_scope
      OR NEW.created_by_profile_id <> OLD.created_by_profile_id
      OR NEW.created_at <> OLD.created_at
      OR OLD.deleted_at IS NOT NULL
      OR NEW.deleted_at IS NULL
      OR typeof(NEW.deleted_at) <> 'integer'
      OR NEW.deleted_at < 0
    THEN RAISE(ABORT, 'phase6_media_usage_identity_immutable')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS media_usage_references_phase6_after_retire
AFTER UPDATE OF deleted_at ON media_usage_references
WHEN OLD.deleted_at IS NULL
 AND NEW.deleted_at IS NOT NULL
 AND OLD.publication_scope = 'published'
 AND ${currentPublishedMediaUsageTargetSql("OLD")}
BEGIN
  DELETE FROM database_invariant_state
  WHERE singleton_key = 'database-guards';
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS legal_status_confirmation_receipts_phase6_before_insert
BEFORE INSERT ON legal_status_confirmation_receipts
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM cms_entity_revisions AS revision
      JOIN organization_memberships AS owner_membership
        ON owner_membership.organization_id = revision.organization_id
       AND owner_membership.profile_id = NEW.actor_profile_id
       AND owner_membership.role = 'owner'
       AND owner_membership.status = 'active'
       AND owner_membership.deleted_at IS NULL
      JOIN profiles AS owner
        ON owner.id = owner_membership.profile_id
       AND owner.status = 'active'
       AND owner.deleted_at IS NULL
      WHERE revision.id = NEW.revision_id
        AND revision.organization_id = NEW.organization_id
        AND revision.entity_type = 'legal_status'
        AND revision.entity_key = 'legal_status'
        AND revision.content_hash = NEW.revision_hash
        AND ${phase6LegalSnapshotCoherentSql("revision.snapshot_json")}
    )
    THEN RAISE(ABORT, 'phase6_legal_confirmation_mismatch')
  END;
  SELECT CASE
    WHEN NEW.action = 'revoked'
      AND NOT EXISTS (
        SELECT 1
        FROM legal_status_confirmation_receipts AS confirmation
        WHERE confirmation.id = NEW.revokes_receipt_id
          AND confirmation.organization_id = NEW.organization_id
          AND confirmation.action = 'confirmed'
          AND confirmation.revision_id = NEW.revision_id
          AND confirmation.revision_hash = NEW.revision_hash
      )
    THEN RAISE(ABORT, 'phase6_legal_revocation_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS legal_status_confirmation_receipts_phase6_before_update
BEFORE UPDATE ON legal_status_confirmation_receipts
BEGIN
  SELECT RAISE(ABORT, 'phase6_legal_receipt_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS legal_status_confirmation_receipts_phase6_before_delete
BEFORE DELETE ON legal_status_confirmation_receipts
BEGIN
  SELECT RAISE(ABORT, 'phase6_legal_receipt_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS taxonomy_write_intents_phase6_before_insert
BEFORE INSERT ON taxonomy_write_intents
BEGIN
  SELECT CASE
    WHEN NOT (${TAXONOMY_INTENT_ACTOR_IS_MANAGER_SQL})
      OR EXISTS (
        SELECT 1
        FROM taxonomy_write_intents AS open_intent
        WHERE open_intent.organization_id = NEW.organization_id
          AND open_intent.entity_type = NEW.entity_type
          AND open_intent.entity_id = NEW.entity_id
          AND open_intent.completed_at IS NULL
      )
      OR (
        NEW.entity_type = 'lane'
        AND NOT (
          (
            NEW.operation = 'create'
            AND NOT EXISTS (
              SELECT 1 FROM event_lanes AS lane
              WHERE lane.id = NEW.entity_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM event_lane_taxonomy_states AS state
              WHERE state.lane_id = NEW.entity_id
            )
            AND (
              SELECT count(*) FROM event_lanes AS lane
              WHERE lane.organization_id = NEW.organization_id
            ) < 100
          )
          OR (
            NEW.operation = 'adopt'
            AND EXISTS (
              SELECT 1
              FROM event_lanes AS lane
              WHERE lane.id = NEW.entity_id
                AND lane.organization_id = NEW.organization_id
                AND lane.name = NEW.proposed_name
                AND lane.slug = NEW.proposed_slug
                AND lane.description IS NEW.proposed_description
                AND lane.sort_order = NEW.proposed_sort_order
                AND lane.deleted_at IS NEW.proposed_deleted_at
                AND NEW.proposed_color_token IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM event_lane_taxonomy_states AS state
              WHERE state.lane_id = NEW.entity_id
            )
          )
          OR (
            NEW.operation IN (
              'update', 'reorder', 'archive', 'safe_delete'
            )
            AND EXISTS (
              SELECT 1
              FROM event_lanes AS lane
              JOIN event_lane_taxonomy_states AS state
                ON state.lane_id = lane.id
               AND state.organization_id = lane.organization_id
              WHERE lane.id = NEW.entity_id
                AND lane.organization_id = NEW.organization_id
                AND state.content_version =
                    NEW.expected_content_version
                AND state.active_intent_id IS NULL
                AND NEW.proposed_slug = lane.slug
                AND NEW.proposed_color_token IS NULL
                AND (
                  (
                    NEW.operation = 'update'
                    AND lane.deleted_at IS NULL
                    AND NEW.proposed_sort_order = lane.sort_order
                    AND NEW.proposed_deleted_at IS NULL
                  )
                  OR (
                    NEW.operation = 'reorder'
                    AND lane.deleted_at IS NULL
                    AND NEW.proposed_name = lane.name
                    AND NEW.proposed_description IS lane.description
                    AND NEW.proposed_deleted_at IS NULL
                  )
                  OR (
                    NEW.operation = 'archive'
                    AND lane.deleted_at IS NULL
                    AND NEW.proposed_name = lane.name
                    AND NEW.proposed_description IS lane.description
                    AND NEW.proposed_sort_order = lane.sort_order
                    AND NEW.proposed_deleted_at IS NOT NULL
                    AND lane.slug NOT IN (
                      'think', 'reset-and-make',
                      'explore', 'eat-and-play'
                    )
                    AND NOT EXISTS (
                      SELECT 1 FROM club_public_profiles AS profile
                      WHERE profile.organization_id =
                            lane.organization_id
                        AND profile.primary_event_lane_id = lane.id
                    )
                    AND NOT EXISTS (
                      SELECT 1
                      FROM program_public_profile_details AS detail
                      WHERE detail.organization_id =
                            lane.organization_id
                        AND detail.primary_event_lane_id = lane.id
                    )
                    AND NOT EXISTS (
                      SELECT 1
                      FROM cms_entity_revisions AS revision
                      WHERE revision.organization_id =
                            lane.organization_id
                        AND revision.entity_type IN (
                          'club_public_profile',
                          'program_public_profile'
                        )
                        AND json_valid(revision.snapshot_json)
                        AND json_extract(
                              revision.snapshot_json,
                              '$.laneId'
                            ) = lane.id
                    )
                  )
                  OR (
                    NEW.operation = 'safe_delete'
                    AND lane.deleted_at IS NOT NULL
                    AND NEW.proposed_name = lane.name
                    AND NEW.proposed_description IS lane.description
                    AND NEW.proposed_sort_order = lane.sort_order
                    AND NEW.proposed_deleted_at IS lane.deleted_at
                    AND lane.slug NOT IN (
                      'think', 'reset-and-make',
                      'explore', 'eat-and-play'
                    )
                    AND NOT EXISTS (
                      SELECT 1 FROM organizer_events AS event
                      WHERE event.organization_id =
                            lane.organization_id
                        AND event.event_lane_id = lane.id
                    )
                    AND NOT EXISTS (
                      SELECT 1 FROM events AS event
                      WHERE event.organization_id =
                            lane.organization_id
                        AND event.event_lane_id = lane.id
                    )
                    AND NOT EXISTS (
                      SELECT 1 FROM club_public_profiles AS profile
                      WHERE profile.organization_id =
                            lane.organization_id
                        AND profile.primary_event_lane_id = lane.id
                    )
                    AND NOT EXISTS (
                      SELECT 1
                      FROM program_public_profile_details AS detail
                      WHERE detail.organization_id =
                            lane.organization_id
                        AND detail.primary_event_lane_id = lane.id
                    )
                    AND NOT EXISTS (
                      SELECT 1
                      FROM cms_entity_revisions AS revision
                      WHERE revision.organization_id =
                            lane.organization_id
                        AND revision.entity_type IN (
                          'club_public_profile',
                          'program_public_profile'
                        )
                        AND json_valid(revision.snapshot_json)
                        AND json_extract(
                              revision.snapshot_json,
                              '$.laneId'
                            ) = lane.id
                    )
                  )
                )
            )
          )
        )
      )
      OR (
        NEW.entity_type = 'category'
        AND NOT (
          (
            NEW.operation = 'create'
            AND NOT EXISTS (
              SELECT 1 FROM categories AS category
              WHERE category.id = NEW.entity_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM category_taxonomy_states AS state
              WHERE state.category_id = NEW.entity_id
            )
            AND (
              SELECT count(*) FROM categories AS category
              WHERE category.organization_id = NEW.organization_id
            ) < 100
          )
          OR (
            NEW.operation = 'adopt'
            AND EXISTS (
              SELECT 1
              FROM categories AS category
              WHERE category.id = NEW.entity_id
                AND category.organization_id = NEW.organization_id
                AND category.name = NEW.proposed_name
                AND category.slug = NEW.proposed_slug
                AND category.description IS NEW.proposed_description
                AND category.color_token IS NEW.proposed_color_token
                AND category.deleted_at IS NEW.proposed_deleted_at
            )
            AND NOT EXISTS (
              SELECT 1 FROM category_taxonomy_states AS state
              WHERE state.category_id = NEW.entity_id
            )
          )
          OR (
            NEW.operation IN (
              'update', 'reorder', 'archive', 'safe_delete'
            )
            AND EXISTS (
              SELECT 1
              FROM categories AS category
              JOIN category_taxonomy_states AS state
                ON state.category_id = category.id
               AND state.organization_id = category.organization_id
              WHERE category.id = NEW.entity_id
                AND category.organization_id = NEW.organization_id
                AND state.content_version =
                    NEW.expected_content_version
                AND state.active_intent_id IS NULL
                AND NEW.proposed_slug = category.slug
                AND (
                  (
                    NEW.operation = 'update'
                    AND category.deleted_at IS NULL
                    AND NEW.proposed_sort_order = state.sort_order
                    AND NEW.proposed_deleted_at IS NULL
                  )
                  OR (
                    NEW.operation = 'reorder'
                    AND category.deleted_at IS NULL
                    AND NEW.proposed_name = category.name
                    AND NEW.proposed_description IS category.description
                    AND NEW.proposed_color_token IS category.color_token
                    AND NEW.proposed_deleted_at IS NULL
                  )
                  OR (
                    NEW.operation = 'archive'
                    AND category.deleted_at IS NULL
                    AND NEW.proposed_name = category.name
                    AND NEW.proposed_description IS category.description
                    AND NEW.proposed_color_token IS category.color_token
                    AND NEW.proposed_sort_order = state.sort_order
                    AND NEW.proposed_deleted_at IS NOT NULL
                  )
                  OR (
                    NEW.operation = 'safe_delete'
                    AND category.deleted_at IS NOT NULL
                    AND NEW.proposed_name = category.name
                    AND NEW.proposed_description IS category.description
                    AND NEW.proposed_color_token IS category.color_token
                    AND NEW.proposed_sort_order = state.sort_order
                    AND NEW.proposed_deleted_at IS category.deleted_at
                    AND NOT EXISTS (
                      SELECT 1 FROM organizer_events AS event
                      WHERE event.organization_id =
                            category.organization_id
                        AND event.category_id = category.id
                    )
                    AND NOT EXISTS (
                      SELECT 1 FROM events AS event
                      WHERE event.organization_id =
                            category.organization_id
                        AND event.category_id = category.id
                    )
                  )
                )
            )
          )
        )
      )
    THEN RAISE(ABORT, 'phase6_taxonomy_intent_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS taxonomy_write_intents_phase6_before_update
BEFORE UPDATE ON taxonomy_write_intents
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.entity_type <> OLD.entity_type
      OR NEW.entity_id <> OLD.entity_id
      OR NEW.operation <> OLD.operation
      OR NEW.expected_content_version <>
          OLD.expected_content_version
      OR NEW.proposed_content_version <>
          OLD.proposed_content_version
      OR NEW.proposed_name <> OLD.proposed_name
      OR NEW.proposed_slug <> OLD.proposed_slug
      OR NEW.proposed_description IS NOT OLD.proposed_description
      OR NEW.proposed_color_token IS NOT OLD.proposed_color_token
      OR NEW.proposed_sort_order <> OLD.proposed_sort_order
      OR NEW.proposed_deleted_at IS NOT OLD.proposed_deleted_at
      OR NEW.mutation_group_id IS NOT OLD.mutation_group_id
      OR NEW.mutation_group_size IS NOT OLD.mutation_group_size
      OR NEW.actor_profile_id <> OLD.actor_profile_id
      OR NEW.created_at <> OLD.created_at
      OR OLD.completed_at IS NOT NULL
      OR NEW.completed_at IS NULL
      OR NOT (${taxonomyIntentActorIsManagerSql("OLD")})
      OR NOT EXISTS (
        SELECT 1
        FROM audit_logs AS audit
        WHERE audit.organization_id = OLD.organization_id
          AND audit.actor_profile_id = OLD.actor_profile_id
          AND audit.entity_type = 'event_' || OLD.entity_type
          AND audit.entity_id = OLD.entity_id
          AND audit.action =
              'taxonomy.' || OLD.entity_type || '_' ||
              CASE OLD.operation
                WHEN 'adopt' THEN 'adopted'
                WHEN 'create' THEN 'created'
                WHEN 'update' THEN 'updated'
                WHEN 'reorder' THEN 'reordered'
                WHEN 'archive' THEN 'archived'
                ELSE 'deleted'
              END
          AND json_extract(
                audit.metadata_json,
                '$.writeIntentId'
              ) = OLD.id
      )
      OR (
        OLD.operation <> 'safe_delete'
        AND (
          (
            OLD.entity_type = 'lane'
            AND NOT EXISTS (
              SELECT 1
              FROM event_lanes AS lane
              JOIN event_lane_taxonomy_states AS state
                ON state.lane_id = lane.id
               AND state.organization_id = lane.organization_id
              WHERE lane.id = OLD.entity_id
                AND lane.organization_id = OLD.organization_id
                AND lane.name = OLD.proposed_name
                AND lane.slug = OLD.proposed_slug
                AND lane.description IS OLD.proposed_description
                AND lane.sort_order = OLD.proposed_sort_order
                AND lane.deleted_at IS OLD.proposed_deleted_at
                AND state.content_version =
                    OLD.proposed_content_version
                AND state.active_intent_id IS NULL
                AND state.last_completed_intent_id = OLD.id
                AND state.updated_by_profile_id =
                    OLD.actor_profile_id
            )
          )
          OR (
            OLD.entity_type = 'category'
            AND NOT EXISTS (
              SELECT 1
              FROM categories AS category
              JOIN category_taxonomy_states AS state
                ON state.category_id = category.id
               AND state.organization_id = category.organization_id
              WHERE category.id = OLD.entity_id
                AND category.organization_id = OLD.organization_id
                AND category.name = OLD.proposed_name
                AND category.slug = OLD.proposed_slug
                AND category.description IS OLD.proposed_description
                AND category.color_token IS
                    OLD.proposed_color_token
                AND category.deleted_at IS OLD.proposed_deleted_at
                AND state.sort_order = OLD.proposed_sort_order
                AND state.content_version =
                    OLD.proposed_content_version
                AND state.active_intent_id IS NULL
                AND state.last_completed_intent_id = OLD.id
                AND state.updated_by_profile_id =
                    OLD.actor_profile_id
            )
          )
        )
      )
      OR (
        OLD.operation = 'safe_delete'
        AND (
          (
            OLD.entity_type = 'lane'
            AND (
              EXISTS (
                SELECT 1 FROM event_lanes AS lane
                WHERE lane.id = OLD.entity_id
              )
              OR EXISTS (
                SELECT 1 FROM event_lane_taxonomy_states AS state
                WHERE state.lane_id = OLD.entity_id
              )
            )
          )
          OR (
            OLD.entity_type = 'category'
            AND (
              EXISTS (
                SELECT 1 FROM categories AS category
                WHERE category.id = OLD.entity_id
              )
              OR EXISTS (
                SELECT 1 FROM category_taxonomy_states AS state
                WHERE state.category_id = OLD.entity_id
              )
            )
          )
        )
      )
    THEN RAISE(ABORT, 'phase6_taxonomy_intent_incomplete')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS taxonomy_write_intents_phase6_before_delete
BEFORE DELETE ON taxonomy_write_intents
BEGIN
  SELECT RAISE(ABORT, 'phase6_taxonomy_intent_immutable');
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS taxonomy_write_intents_phase6_after_insert
AFTER INSERT ON taxonomy_write_intents
BEGIN
  DELETE FROM database_invariant_state
  WHERE singleton_key = 'database-guards';
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS event_lanes_phase6_taxonomy_before_insert
BEFORE INSERT ON event_lanes
BEGIN
  SELECT CASE
    WHEN (
      SELECT count(*) FROM event_lanes AS lane
      WHERE lane.organization_id = NEW.organization_id
    ) >= 100
      OR NOT EXISTS (
        SELECT 1
        FROM taxonomy_write_intents AS intent
        WHERE intent.organization_id = NEW.organization_id
          AND intent.entity_type = 'lane'
          AND intent.entity_id = NEW.id
          AND intent.operation = 'create'
          AND intent.expected_content_version = 0
          AND intent.proposed_content_version = 1
          AND intent.proposed_name = NEW.name
          AND intent.proposed_slug = NEW.slug
          AND intent.proposed_description IS NEW.description
          AND intent.proposed_color_token IS NULL
          AND intent.proposed_sort_order = NEW.sort_order
          AND intent.proposed_deleted_at IS NULL
          AND intent.actor_profile_id =
              NEW.created_by_profile_id
          AND intent.created_at = NEW.created_at
          AND NEW.updated_at = NEW.created_at
          AND intent.completed_at IS NULL
          AND ${taxonomyIntentActorIsManagerSql("intent")}
      )
    THEN RAISE(ABORT, 'phase6_lane_taxonomy_write_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS event_lanes_phase6_taxonomy_before_update
BEFORE UPDATE ON event_lanes
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.slug <> OLD.slug
      OR NEW.created_by_profile_id IS NOT OLD.created_by_profile_id
      OR NEW.created_at <> OLD.created_at
      OR NEW.updated_at < OLD.updated_at
      OR NOT EXISTS (
        SELECT 1
        FROM event_lane_taxonomy_states AS state
        JOIN taxonomy_write_intents AS intent
          ON intent.id = state.active_intent_id
         AND intent.organization_id = state.organization_id
         AND intent.entity_type = 'lane'
         AND intent.entity_id = state.lane_id
         AND intent.expected_content_version =
             state.content_version
         AND intent.completed_at IS NULL
         AND ${taxonomyIntentActorIsManagerSql("intent")}
        WHERE state.lane_id = OLD.id
          AND state.organization_id = OLD.organization_id
          AND intent.proposed_name = NEW.name
          AND intent.proposed_slug = NEW.slug
          AND intent.proposed_description IS NEW.description
          AND intent.proposed_color_token IS NULL
          AND intent.proposed_sort_order = NEW.sort_order
          AND intent.proposed_deleted_at IS NEW.deleted_at
          AND (
            (
              intent.operation = 'update'
              AND OLD.deleted_at IS NULL
              AND NEW.deleted_at IS NULL
              AND NEW.sort_order = OLD.sort_order
            )
            OR (
              intent.operation = 'reorder'
              AND OLD.deleted_at IS NULL
              AND NEW.deleted_at IS NULL
              AND NEW.name = OLD.name
              AND NEW.description IS OLD.description
              AND ${LANE_REORDER_GROUP_COMPLETE_SQL}
            )
            OR (
              intent.operation = 'archive'
              AND OLD.deleted_at IS NULL
              AND NEW.deleted_at IS NOT NULL
              AND NEW.name = OLD.name
              AND NEW.description IS OLD.description
              AND NEW.sort_order = OLD.sort_order
              AND OLD.slug NOT IN (
                'think', 'reset-and-make',
                'explore', 'eat-and-play'
              )
              AND NOT EXISTS (
                SELECT 1 FROM club_public_profiles AS profile
                WHERE profile.organization_id =
                      OLD.organization_id
                  AND profile.primary_event_lane_id = OLD.id
              )
              AND NOT EXISTS (
                SELECT 1
                FROM program_public_profile_details AS detail
                WHERE detail.organization_id =
                      OLD.organization_id
                  AND detail.primary_event_lane_id = OLD.id
              )
              AND NOT EXISTS (
                SELECT 1
                FROM cms_entity_revisions AS revision
                WHERE revision.organization_id = OLD.organization_id
                  AND revision.entity_type IN (
                    'club_public_profile',
                    'program_public_profile'
                  )
                  AND json_valid(revision.snapshot_json)
                  AND json_extract(
                        revision.snapshot_json,
                        '$.laneId'
                      ) = OLD.id
              )
            )
          )
      )
    THEN RAISE(ABORT, 'phase6_lane_taxonomy_write_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS event_lanes_phase6_taxonomy_before_delete
BEFORE DELETE ON event_lanes
BEGIN
  SELECT CASE
    WHEN OLD.slug IN (
      'think', 'reset-and-make', 'explore', 'eat-and-play'
    )
      OR NOT EXISTS (
        SELECT 1
        FROM event_lane_taxonomy_states AS state
        JOIN taxonomy_write_intents AS intent
          ON intent.id = state.active_intent_id
         AND intent.organization_id = state.organization_id
         AND intent.entity_type = 'lane'
         AND intent.entity_id = state.lane_id
         AND intent.operation = 'safe_delete'
         AND intent.expected_content_version =
             state.content_version
         AND intent.completed_at IS NULL
         AND ${taxonomyIntentActorIsManagerSql("intent")}
        WHERE state.lane_id = OLD.id
          AND state.organization_id = OLD.organization_id
          AND OLD.deleted_at IS NOT NULL
          AND intent.proposed_name = OLD.name
          AND intent.proposed_slug = OLD.slug
          AND intent.proposed_description IS OLD.description
          AND intent.proposed_color_token IS NULL
          AND intent.proposed_sort_order = OLD.sort_order
          AND intent.proposed_deleted_at IS OLD.deleted_at
      )
      OR EXISTS (
        SELECT 1 FROM organizer_events AS event
        WHERE event.organization_id = OLD.organization_id
          AND event.event_lane_id = OLD.id
      )
      OR EXISTS (
        SELECT 1 FROM events AS event
        WHERE event.organization_id = OLD.organization_id
          AND event.event_lane_id = OLD.id
      )
      OR EXISTS (
        SELECT 1 FROM club_public_profiles AS profile
        WHERE profile.organization_id = OLD.organization_id
          AND profile.primary_event_lane_id = OLD.id
      )
      OR EXISTS (
        SELECT 1 FROM program_public_profile_details AS detail
        WHERE detail.organization_id = OLD.organization_id
          AND detail.primary_event_lane_id = OLD.id
      )
      OR EXISTS (
        SELECT 1
        FROM cms_entity_revisions AS revision
        WHERE revision.organization_id = OLD.organization_id
          AND revision.entity_type IN (
            'club_public_profile', 'program_public_profile'
          )
          AND json_valid(revision.snapshot_json)
          AND json_extract(revision.snapshot_json, '$.laneId') = OLD.id
      )
    THEN RAISE(ABORT, 'phase6_lane_taxonomy_delete_blocked')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS categories_phase6_taxonomy_before_insert
BEFORE INSERT ON categories
BEGIN
  SELECT CASE
    WHEN (
      SELECT count(*) FROM categories AS category
      WHERE category.organization_id = NEW.organization_id
    ) >= 100
      OR NOT EXISTS (
        SELECT 1
        FROM taxonomy_write_intents AS intent
        WHERE intent.organization_id = NEW.organization_id
          AND intent.entity_type = 'category'
          AND intent.entity_id = NEW.id
          AND intent.operation = 'create'
          AND intent.expected_content_version = 0
          AND intent.proposed_content_version = 1
          AND intent.proposed_name = NEW.name
          AND intent.proposed_slug = NEW.slug
          AND intent.proposed_description IS NEW.description
          AND intent.proposed_color_token IS NEW.color_token
          AND intent.proposed_deleted_at IS NULL
          AND intent.created_at = NEW.created_at
          AND NEW.updated_at = NEW.created_at
          AND intent.completed_at IS NULL
          AND ${taxonomyIntentActorIsManagerSql("intent")}
      )
    THEN RAISE(ABORT, 'phase6_category_taxonomy_write_required')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS categories_phase6_taxonomy_before_update
BEFORE UPDATE ON categories
BEGIN
  SELECT CASE
    WHEN NEW.id <> OLD.id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.slug <> OLD.slug
      OR NEW.created_at <> OLD.created_at
      OR NEW.updated_at < OLD.updated_at
      OR NOT EXISTS (
        SELECT 1
        FROM category_taxonomy_states AS state
        JOIN taxonomy_write_intents AS intent
          ON intent.id = state.active_intent_id
         AND intent.organization_id = state.organization_id
         AND intent.entity_type = 'category'
         AND intent.entity_id = state.category_id
         AND intent.expected_content_version =
             state.content_version
         AND intent.completed_at IS NULL
         AND ${taxonomyIntentActorIsManagerSql("intent")}
        WHERE state.category_id = OLD.id
          AND state.organization_id = OLD.organization_id
          AND intent.proposed_name = NEW.name
          AND intent.proposed_slug = NEW.slug
          AND intent.proposed_description IS NEW.description
          AND intent.proposed_color_token IS NEW.color_token
          AND intent.proposed_deleted_at IS NEW.deleted_at
          AND (
            (
              intent.operation = 'update'
              AND OLD.deleted_at IS NULL
              AND NEW.deleted_at IS NULL
              AND intent.proposed_sort_order = state.sort_order
            )
            OR (
              intent.operation = 'reorder'
              AND OLD.deleted_at IS NULL
              AND NEW.deleted_at IS NULL
              AND NEW.name = OLD.name
              AND NEW.description IS OLD.description
              AND NEW.color_token IS OLD.color_token
              AND ${CATEGORY_REORDER_GROUP_COMPLETE_SQL}
            )
            OR (
              intent.operation = 'archive'
              AND OLD.deleted_at IS NULL
              AND NEW.deleted_at IS NOT NULL
              AND NEW.name = OLD.name
              AND NEW.description IS OLD.description
              AND NEW.color_token IS OLD.color_token
              AND intent.proposed_sort_order = state.sort_order
            )
          )
      )
    THEN RAISE(ABORT, 'phase6_category_taxonomy_write_invalid')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS categories_phase6_taxonomy_before_delete
BEFORE DELETE ON categories
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM category_taxonomy_states AS state
      JOIN taxonomy_write_intents AS intent
        ON intent.id = state.active_intent_id
       AND intent.organization_id = state.organization_id
       AND intent.entity_type = 'category'
       AND intent.entity_id = state.category_id
       AND intent.operation = 'safe_delete'
       AND intent.expected_content_version =
           state.content_version
       AND intent.completed_at IS NULL
       AND ${taxonomyIntentActorIsManagerSql("intent")}
      WHERE state.category_id = OLD.id
        AND state.organization_id = OLD.organization_id
        AND OLD.deleted_at IS NOT NULL
        AND intent.proposed_name = OLD.name
        AND intent.proposed_slug = OLD.slug
        AND intent.proposed_description IS OLD.description
        AND intent.proposed_color_token IS OLD.color_token
        AND intent.proposed_sort_order = state.sort_order
        AND intent.proposed_deleted_at IS OLD.deleted_at
    )
      OR EXISTS (
        SELECT 1 FROM organizer_events AS event
        WHERE event.organization_id = OLD.organization_id
          AND event.category_id = OLD.id
      )
      OR EXISTS (
        SELECT 1 FROM events AS event
        WHERE event.organization_id = OLD.organization_id
          AND event.category_id = OLD.id
      )
    THEN RAISE(ABORT, 'phase6_category_taxonomy_delete_blocked')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS event_lane_taxonomy_states_phase6_before_insert
BEFORE INSERT ON event_lane_taxonomy_states
BEGIN
  SELECT CASE
    WHEN NEW.content_version <> 1
      OR NEW.active_intent_id IS NULL
      OR NEW.last_completed_intent_id IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM event_lanes AS lane
        JOIN taxonomy_write_intents AS intent
          ON intent.id = NEW.active_intent_id
         AND intent.organization_id = lane.organization_id
         AND intent.entity_type = 'lane'
         AND intent.entity_id = lane.id
         AND intent.operation IN ('adopt', 'create')
         AND intent.expected_content_version = 0
         AND intent.proposed_content_version = 1
         AND intent.actor_profile_id =
             NEW.updated_by_profile_id
         AND intent.completed_at IS NULL
        WHERE lane.id = NEW.lane_id
          AND lane.organization_id = NEW.organization_id
          AND lane.name = intent.proposed_name
          AND lane.slug = intent.proposed_slug
          AND lane.description IS intent.proposed_description
          AND lane.sort_order = intent.proposed_sort_order
          AND lane.deleted_at IS intent.proposed_deleted_at
          AND intent.proposed_color_token IS NULL
          AND NEW.created_at = intent.created_at
          AND NEW.updated_at = intent.created_at
      )
    THEN RAISE(ABORT, 'phase6_lane_taxonomy_state_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS event_lane_taxonomy_states_phase6_before_update
BEFORE UPDATE ON event_lane_taxonomy_states
BEGIN
  SELECT CASE
    WHEN NEW.lane_id <> OLD.lane_id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.created_at <> OLD.created_at
      OR NOT (
        (
          OLD.active_intent_id IS NULL
          AND NEW.active_intent_id IS NOT NULL
          AND NEW.last_completed_intent_id IS
              OLD.last_completed_intent_id
          AND NEW.content_version = OLD.content_version
          AND NEW.updated_by_profile_id =
              OLD.updated_by_profile_id
          AND NEW.updated_at = OLD.updated_at
          AND EXISTS (
            SELECT 1
            FROM event_lanes AS lane
            JOIN taxonomy_write_intents AS intent
              ON intent.id = NEW.active_intent_id
             AND intent.organization_id = lane.organization_id
             AND intent.entity_type = 'lane'
             AND intent.entity_id = lane.id
             AND intent.operation IN (
               'update', 'reorder', 'archive', 'safe_delete'
             )
             AND intent.expected_content_version =
                 OLD.content_version
             AND intent.completed_at IS NULL
            WHERE lane.id = OLD.lane_id
              AND lane.organization_id = OLD.organization_id
              AND ${LANE_REORDER_GROUP_COMPLETE_SQL}
          )
        )
        OR (
          OLD.active_intent_id IS NOT NULL
          AND NEW.active_intent_id IS NULL
          AND NEW.last_completed_intent_id =
              OLD.active_intent_id
          AND EXISTS (
            SELECT 1
            FROM event_lanes AS lane
            JOIN taxonomy_write_intents AS intent
              ON intent.id = OLD.active_intent_id
             AND intent.organization_id = lane.organization_id
             AND intent.entity_type = 'lane'
             AND intent.entity_id = lane.id
             AND intent.completed_at IS NULL
            WHERE lane.id = OLD.lane_id
              AND lane.organization_id = OLD.organization_id
              AND lane.name = intent.proposed_name
              AND lane.slug = intent.proposed_slug
              AND lane.description IS intent.proposed_description
              AND lane.sort_order = intent.proposed_sort_order
              AND lane.deleted_at IS intent.proposed_deleted_at
              AND intent.proposed_color_token IS NULL
              AND NEW.content_version =
                  intent.proposed_content_version
              AND NEW.updated_by_profile_id =
                  intent.actor_profile_id
              AND NEW.updated_at >= OLD.updated_at
              AND (
                (
                  intent.operation IN ('adopt', 'create')
                  AND OLD.content_version = 1
                  AND NEW.content_version = 1
                )
                OR (
                  intent.operation IN (
                    'update', 'reorder', 'archive'
                  )
                  AND NEW.content_version =
                      OLD.content_version + 1
                )
              )
              AND EXISTS (
                SELECT 1
                FROM audit_logs AS audit
                WHERE audit.organization_id =
                      intent.organization_id
                  AND audit.actor_profile_id =
                      intent.actor_profile_id
                  AND audit.entity_type = 'event_lane'
                  AND audit.entity_id = intent.entity_id
                  AND json_extract(
                        audit.metadata_json,
                        '$.writeIntentId'
                      ) = intent.id
              )
          )
        )
      )
    THEN RAISE(ABORT, 'phase6_lane_taxonomy_state_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS event_lane_taxonomy_states_phase6_before_delete
BEFORE DELETE ON event_lane_taxonomy_states
BEGIN
  SELECT CASE
    WHEN OLD.active_intent_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM taxonomy_write_intents AS intent
        WHERE intent.id = OLD.active_intent_id
          AND intent.organization_id = OLD.organization_id
          AND intent.entity_type = 'lane'
          AND intent.entity_id = OLD.lane_id
          AND intent.operation = 'safe_delete'
          AND intent.expected_content_version =
              OLD.content_version
          AND intent.completed_at IS NULL
      )
    THEN RAISE(ABORT, 'phase6_lane_taxonomy_state_immutable')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS category_taxonomy_states_phase6_before_insert
BEFORE INSERT ON category_taxonomy_states
BEGIN
  SELECT CASE
    WHEN NEW.content_version <> 1
      OR NEW.active_intent_id IS NULL
      OR NEW.last_completed_intent_id IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM categories AS category
        JOIN taxonomy_write_intents AS intent
          ON intent.id = NEW.active_intent_id
         AND intent.organization_id = category.organization_id
         AND intent.entity_type = 'category'
         AND intent.entity_id = category.id
         AND intent.operation IN ('adopt', 'create')
         AND intent.expected_content_version = 0
         AND intent.proposed_content_version = 1
         AND intent.actor_profile_id =
             NEW.updated_by_profile_id
         AND intent.completed_at IS NULL
        WHERE category.id = NEW.category_id
          AND category.organization_id = NEW.organization_id
          AND category.name = intent.proposed_name
          AND category.slug = intent.proposed_slug
          AND category.description IS intent.proposed_description
          AND category.color_token IS intent.proposed_color_token
          AND category.deleted_at IS intent.proposed_deleted_at
          AND NEW.sort_order = intent.proposed_sort_order
          AND NEW.created_at = intent.created_at
          AND NEW.updated_at = intent.created_at
      )
    THEN RAISE(ABORT, 'phase6_category_taxonomy_state_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS category_taxonomy_states_phase6_before_update
BEFORE UPDATE ON category_taxonomy_states
BEGIN
  SELECT CASE
    WHEN NEW.category_id <> OLD.category_id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.created_at <> OLD.created_at
      OR NOT (
        (
          OLD.active_intent_id IS NULL
          AND NEW.active_intent_id IS NOT NULL
          AND NEW.last_completed_intent_id IS
              OLD.last_completed_intent_id
          AND NEW.sort_order = OLD.sort_order
          AND NEW.content_version = OLD.content_version
          AND NEW.updated_by_profile_id =
              OLD.updated_by_profile_id
          AND NEW.updated_at = OLD.updated_at
          AND EXISTS (
            SELECT 1
            FROM categories AS category
            JOIN taxonomy_write_intents AS intent
              ON intent.id = NEW.active_intent_id
             AND intent.organization_id =
                 category.organization_id
             AND intent.entity_type = 'category'
             AND intent.entity_id = category.id
             AND intent.operation IN (
               'update', 'reorder', 'archive', 'safe_delete'
             )
             AND intent.expected_content_version =
                 OLD.content_version
             AND intent.completed_at IS NULL
            WHERE category.id = OLD.category_id
              AND category.organization_id =
                  OLD.organization_id
              AND ${CATEGORY_REORDER_GROUP_COMPLETE_SQL}
          )
        )
        OR (
          OLD.active_intent_id IS NOT NULL
          AND NEW.active_intent_id IS NULL
          AND NEW.last_completed_intent_id =
              OLD.active_intent_id
          AND EXISTS (
            SELECT 1
            FROM categories AS category
            JOIN taxonomy_write_intents AS intent
              ON intent.id = OLD.active_intent_id
             AND intent.organization_id =
                 category.organization_id
             AND intent.entity_type = 'category'
             AND intent.entity_id = category.id
             AND intent.completed_at IS NULL
            WHERE category.id = OLD.category_id
              AND category.organization_id =
                  OLD.organization_id
              AND category.name = intent.proposed_name
              AND category.slug = intent.proposed_slug
              AND category.description IS
                  intent.proposed_description
              AND category.color_token IS
                  intent.proposed_color_token
              AND category.deleted_at IS
                  intent.proposed_deleted_at
              AND NEW.sort_order = intent.proposed_sort_order
              AND NEW.content_version =
                  intent.proposed_content_version
              AND NEW.updated_by_profile_id =
                  intent.actor_profile_id
              AND NEW.updated_at >= OLD.updated_at
              AND (
                (
                  intent.operation IN ('adopt', 'create')
                  AND OLD.content_version = 1
                  AND NEW.content_version = 1
                )
                OR (
                  intent.operation IN (
                    'update', 'reorder', 'archive'
                  )
                  AND NEW.content_version =
                      OLD.content_version + 1
                )
              )
              AND EXISTS (
                SELECT 1
                FROM audit_logs AS audit
                WHERE audit.organization_id =
                      intent.organization_id
                  AND audit.actor_profile_id =
                      intent.actor_profile_id
                  AND audit.entity_type = 'event_category'
                  AND audit.entity_id = intent.entity_id
                  AND json_extract(
                        audit.metadata_json,
                        '$.writeIntentId'
                      ) = intent.id
              )
          )
        )
      )
    THEN RAISE(ABORT, 'phase6_category_taxonomy_state_mismatch')
  END;
END;`,
  String.raw`
CREATE TRIGGER IF NOT EXISTS category_taxonomy_states_phase6_before_delete
BEFORE DELETE ON category_taxonomy_states
BEGIN
  SELECT CASE
    WHEN OLD.active_intent_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM taxonomy_write_intents AS intent
        WHERE intent.id = OLD.active_intent_id
          AND intent.organization_id = OLD.organization_id
          AND intent.entity_type = 'category'
          AND intent.entity_id = OLD.category_id
          AND intent.operation = 'safe_delete'
          AND intent.expected_content_version =
              OLD.content_version
          AND intent.completed_at IS NULL
      )
    THEN RAISE(ABORT, 'phase6_category_taxonomy_state_immutable')
  END;
END;`,
] as const);

const SHALLOW_PHASE6_TRIGGER_NAMES = new Set([
  "cms_entity_publication_states_phase6_before_update",
  "legal_status_confirmation_receipts_phase6_before_insert",
  "organizer_public_attribution_intents_phase6_before_insert",
  "organizer_public_attribution_receipts_phase6_before_insert",
]);

/**
 * D1 compiles every trigger body that participates in a mutation. A long
 * sequence of independent `SELECT CASE ... RAISE` checks in one body can
 * exceed SQLite's expression-depth limit even though every check is shallow.
 * Split only the named validation-only BEFORE triggers into one check per
 * trigger. All checks still execute within the same outer D1 statement and
 * any rejection rolls the complete write back.
 */
function shallowPhase6TriggerStatements(sql: string): readonly string[] {
  const nameMatch = sql.match(
    /CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s]+)/iu,
  );
  const name = nameMatch?.[1];
  if (!name || !SHALLOW_PHASE6_TRIGGER_NAMES.has(name)) return [sql];
  const beginIndex = sql.indexOf("BEGIN");
  const endIndex = sql.lastIndexOf("END;");
  if (beginIndex < 0 || endIndex < beginIndex) {
    throw new Error(`Malformed Phase 6 trigger ${name}.`);
  }
  const header = sql.slice(0, beginIndex);
  const statements = splitTriggerBodyStatements(
    sql.slice(beginIndex + "BEGIN".length, endIndex),
  );
  return Object.freeze(
    statements.map((statement, index) => {
      const splitName = index === 0 ? name : `${name}_check_${index + 1}`;
      return `${header.replace(name, splitName)}BEGIN
  ${statement.trim()};
END;`;
    }),
  );
}

function splitTriggerBodyStatements(body: string): string[] {
  const statements: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "'") {
      if (quoted && body[index + 1] === "'") {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (character === ";" && !quoted) {
      const statement = body.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

export const PHASE6_INVARIANT_TRIGGER_STATEMENTS = Object.freeze(
  PHASE6_INVARIANT_TRIGGER_STATEMENT_SOURCE.flatMap(
    shallowPhase6TriggerStatements,
  ),
);

const CMS_STATE_SOURCE_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM cms_entity_publication_states AS state
WHERE NOT (
  (
    state.entity_type = 'page'
    AND EXISTS (
      SELECT 1 FROM pages AS page
      WHERE page.id = state.entity_key
        AND page.organization_id = state.organization_id
        AND page.deleted_at IS NULL
    )
  )
  OR (
    state.entity_type = 'club_public_profile'
    AND EXISTS (
      SELECT 1 FROM club_public_profiles AS profile
      WHERE profile.club_id = state.entity_key
        AND profile.organization_id = state.organization_id
        AND profile.deleted_at IS NULL
    )
  )
  OR (
    state.entity_type = 'program_public_profile'
    AND EXISTS (
      SELECT 1
      FROM programs AS program
      JOIN clubs AS club
        ON club.id = program.club_id
       AND club.organization_id = program.organization_id
      WHERE program.id = state.entity_key
        AND program.organization_id = state.organization_id
        AND (
          (
            program.deleted_at IS NULL
            AND club.deleted_at IS NULL
          )
          OR (
            state.workflow_status = 'archived'
            AND program.deleted_at IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM program_public_profile_details AS tombstone_detail
              WHERE tombstone_detail.program_id = program.id
                AND tombstone_detail.organization_id =
                    program.organization_id
                AND tombstone_detail.club_id = program.club_id
                AND tombstone_detail.publication_status = 'archived'
                AND tombstone_detail.published_at IS NULL
                AND tombstone_detail.deleted_at IS NOT NULL
            )
          )
        )
    )
  )
  OR (
    state.entity_type = 'community_link'
    AND EXISTS (
      SELECT 1 FROM community_links AS link
      WHERE link.id = state.entity_key
        AND link.organization_id = state.organization_id
        AND link.deleted_at IS NULL
    )
  )
  OR (state.entity_type = 'navigation' AND state.entity_key = 'navigation')
  OR (state.entity_type = 'site_identity' AND state.entity_key = 'site_identity')
  OR (state.entity_type = 'legal_status' AND state.entity_key = 'legal_status')
 )`;

const CMS_STATE_REVISION_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM cms_entity_publication_states AS state
WHERE (
  state.current_draft_revision_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM cms_entity_revisions AS revision
    WHERE revision.id = state.current_draft_revision_id
      AND revision.publication_state_id = state.id
      AND revision.organization_id = state.organization_id
      AND revision.entity_type = state.entity_type
      AND revision.entity_key = state.entity_key
  )
)
OR (
  state.published_revision_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM cms_entity_revisions AS revision
    WHERE revision.id = state.published_revision_id
      AND revision.publication_state_id = state.id
      AND revision.organization_id = state.organization_id
      AND revision.entity_type = state.entity_type
      AND revision.entity_key = state.entity_key
  )
 )`;

const CMS_STATE_LEGAL_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM cms_entity_publication_states AS state
WHERE (
  state.entity_type = 'legal_status'
  AND state.workflow_status = 'published'
  AND NOT EXISTS (
    SELECT 1
    FROM legal_status_confirmation_receipts AS confirmation
    JOIN cms_entity_revisions AS revision
      ON revision.id = confirmation.revision_id
     AND revision.content_hash = confirmation.revision_hash
    WHERE confirmation.organization_id = state.organization_id
      AND confirmation.revision_id = state.published_revision_id
      AND confirmation.action = 'confirmed'
      AND NOT EXISTS (
        SELECT 1
        FROM legal_status_confirmation_receipts AS revocation
        WHERE revocation.organization_id = confirmation.organization_id
          AND revocation.action = 'revoked'
          AND revocation.revokes_receipt_id = confirmation.id
      )
  )
 )`;

const CMS_STATE_PUBLIC_EMAIL_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM cms_entity_publication_states AS state
WHERE (
  state.workflow_status = 'published'
  AND EXISTS (
    SELECT 1
    FROM cms_entity_revisions AS public_revision
    WHERE public_revision.id = state.published_revision_id
      AND public_revision.organization_id = state.organization_id
      AND public_revision.publication_state_id = state.id
      AND public_revision.entity_type = state.entity_type
      AND public_revision.entity_key = state.entity_key
      AND ${publicOrganizerEmailExposureSql(
        ["public_revision.snapshot_json"],
        "state.organization_id",
      )}
  )
 )`;

const CMS_STATE_REQUIRED_PAGE_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM cms_entity_publication_states AS state
WHERE (
  state.entity_type = 'page'
  AND state.workflow_status = 'published'
  AND EXISTS (
    SELECT 1
    FROM cms_entity_revisions AS required_revision
    WHERE required_revision.id = state.published_revision_id
      AND required_revision.organization_id = state.organization_id
      AND required_revision.publication_state_id = state.id
      AND required_revision.entity_type = state.entity_type
      AND required_revision.entity_key = state.entity_key
      AND json_extract(required_revision.snapshot_json, '$.slug') IN (
        'home', 'events', 'clubs', 'community', 'about', 'get-involved',
        'host-an-event', 'contact', 'conduct', 'accessibility', 'privacy'
      )
      AND NOT (${phase6RequiredPageSnapshotSql(
        "required_revision.snapshot_json",
      )})
  )
)`;

const CMS_STATE_INTEGRITY_COUNT_SQL = Object.freeze([
  CMS_STATE_SOURCE_INTEGRITY_COUNT_SQL,
  CMS_STATE_REVISION_INTEGRITY_COUNT_SQL,
  CMS_STATE_LEGAL_INTEGRITY_COUNT_SQL,
  CMS_STATE_PUBLIC_EMAIL_INTEGRITY_COUNT_SQL,
  CMS_STATE_REQUIRED_PAGE_INTEGRITY_COUNT_SQL,
]);

const CMS_REVISION_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM cms_entity_revisions AS revision
WHERE NOT EXISTS (
  SELECT 1
  FROM cms_entity_publication_states AS state
  WHERE state.id = revision.publication_state_id
    AND state.organization_id = revision.organization_id
    AND state.entity_type = revision.entity_type
    AND state.entity_key = revision.entity_key
)
OR NOT (${cmsRevisionHasActiveLaneSql(
  "revision.entity_type",
  "revision.snapshot_json",
  "revision.canonical_byte_size",
  "revision.organization_id",
)})
OR (
  revision.restored_from_revision_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM cms_entity_revisions AS prior_revision
    WHERE prior_revision.id = revision.restored_from_revision_id
      AND prior_revision.organization_id = revision.organization_id
      AND prior_revision.publication_state_id =
          revision.publication_state_id
      AND prior_revision.revision_number < revision.revision_number
  )
)
OR (
  revision.legacy_page_revision_id IS NOT NULL
  AND (
    revision.entity_type <> 'page'
    OR NOT EXISTS (
      SELECT 1
      FROM page_revisions AS legacy_revision
      WHERE legacy_revision.id = revision.legacy_page_revision_id
        AND legacy_revision.organization_id = revision.organization_id
        AND legacy_revision.page_id = revision.entity_key
    )
  )
)`;

function cmsMaterializationReceiptIntegrityCountSql(
  entityType: CmsReceiptEntityType,
): readonly string[] {
  const predicateGroups =
    cmsReceiptRevisionPredicateGroupsForEntityTypeSql(
      entityType,
      "receipt",
      "revision",
      entityType === "page"
        ? {
            unifiedPublicEventCteSql:
              publicEventSelectionProofCteSqlForOrganization(
                "receipt.organization_id",
              ),
          }
        : {},
    );
  const linkageAndCoverage = String.raw`
SELECT (
  SELECT count(*)
  FROM cms_public_materialization_receipts AS receipt
  WHERE receipt.entity_type = '${entityType}'
    AND NOT EXISTS (
      SELECT 1
      FROM cms_entity_publication_states AS state
      JOIN cms_entity_revisions AS revision
        ON revision.id = receipt.revision_id
       AND revision.organization_id = receipt.organization_id
       AND revision.publication_state_id = receipt.publication_state_id
       AND revision.entity_type = receipt.entity_type
       AND revision.entity_key = receipt.entity_key
       AND revision.content_hash = receipt.revision_hash
      WHERE state.id = receipt.publication_state_id
        AND state.organization_id = receipt.organization_id
        AND state.entity_type = receipt.entity_type
        AND state.entity_key = receipt.entity_key
    )
) + (
  SELECT count(*)
  FROM cms_entity_publication_states AS state
  WHERE state.entity_type = '${entityType}'
    AND (
      state.workflow_status = 'published'
      OR (
        state.workflow_status = 'archived'
        AND state.entity_type IN (
          'club_public_profile', 'program_public_profile'
        )
        AND state.published_revision_id IS NOT NULL
      )
    )
    AND EXISTS (
      SELECT 1
      FROM cms_adoption_states AS adoption
      WHERE adoption.organization_id = state.organization_id
        AND adoption.adoption_version = 1
    )
    AND NOT EXISTS (
      SELECT 1
      FROM cms_public_materialization_receipts AS receipt
      JOIN cms_entity_revisions AS revision
        ON revision.id = receipt.revision_id
       AND revision.organization_id = receipt.organization_id
       AND revision.publication_state_id = receipt.publication_state_id
       AND revision.entity_type = receipt.entity_type
       AND revision.entity_key = receipt.entity_key
       AND revision.content_hash = receipt.revision_hash
      WHERE receipt.publication_state_id = state.id
        AND receipt.organization_id = state.organization_id
        AND receipt.entity_type = state.entity_type
        AND receipt.entity_key = state.entity_key
        AND receipt.revision_id = state.published_revision_id
    )
) AS violation_count`;
  const semanticGroups = predicateGroups.map(
    (predicate) => String.raw`
SELECT count(*) AS violation_count
FROM cms_public_materialization_receipts AS receipt
JOIN cms_entity_revisions AS revision
  ON revision.id = receipt.revision_id
 AND revision.organization_id = receipt.organization_id
 AND revision.publication_state_id = receipt.publication_state_id
 AND revision.entity_type = receipt.entity_type
 AND revision.entity_key = receipt.entity_key
 AND revision.content_hash = receipt.revision_hash
WHERE receipt.entity_type = '${entityType}'
  AND NOT (${predicate})`,
  );
  return Object.freeze([linkageAndCoverage, ...semanticGroups]);
}

const CMS_MATERIALIZATION_RECEIPT_INTEGRITY_COUNT_SQL =
  Object.freeze(
    CMS_RECEIPT_ENTITY_TYPES.flatMap(
      cmsMaterializationReceiptIntegrityCountSql,
    ),
  );

const CMS_MATERIALIZATION_RECEIPT_PUBLIC_LEGAL_INTEGRITY_COUNT_SQL =
  String.raw`
SELECT count(*) AS violation_count
FROM cms_public_materialization_receipts AS receipt
WHERE receipt.entity_type <> 'legal_status'
  AND ${protectedLegalClaimSql(["receipt.projection_json"])}`;

const CMS_MATERIALIZATION_RECEIPT_PUBLIC_EMAIL_INTEGRITY_COUNT_SQL =
  String.raw`
SELECT count(*) AS violation_count
FROM cms_public_materialization_receipts AS receipt
WHERE receipt.entity_type <> 'legal_status'
  AND ${publicOrganizerEmailExposureSql(
    ["receipt.projection_json"],
    "receipt.organization_id",
  )}`;

const CMS_PUBLIC_PROJECTION_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM cms_entity_publication_states AS state
JOIN cms_entity_revisions AS revision
  ON revision.id = state.published_revision_id
 AND revision.organization_id = state.organization_id
 AND revision.publication_state_id = state.id
 AND revision.entity_type = state.entity_type
 AND revision.entity_key = state.entity_key
JOIN cms_public_materialization_receipts AS receipt
  ON receipt.organization_id = state.organization_id
 AND receipt.publication_state_id = state.id
 AND receipt.entity_type = state.entity_type
 AND receipt.entity_key = state.entity_key
 AND receipt.revision_id = revision.id
 AND receipt.revision_hash = revision.content_hash
LEFT JOIN pages AS page
  ON state.entity_type = 'page'
 AND page.id = state.entity_key
 AND page.organization_id = state.organization_id
LEFT JOIN clubs AS club
  ON state.entity_type = 'club_public_profile'
 AND club.id = state.entity_key
 AND club.organization_id = state.organization_id
LEFT JOIN club_public_profiles AS profile
  ON state.entity_type = 'club_public_profile'
 AND profile.club_id = state.entity_key
 AND profile.organization_id = state.organization_id
LEFT JOIN club_public_profile_details AS club_details
  ON state.entity_type = 'club_public_profile'
 AND club_details.club_id = state.entity_key
 AND club_details.organization_id = state.organization_id
LEFT JOIN community_links AS community_link
  ON state.entity_type = 'community_link'
 AND community_link.id = state.entity_key
 AND community_link.organization_id = state.organization_id
LEFT JOIN community_link_public_details AS community_details
  ON state.entity_type = 'community_link'
 AND community_details.community_link_id = state.entity_key
 AND community_details.organization_id = state.organization_id
LEFT JOIN site_settings AS site_setting
  ON state.entity_type IN ('site_identity', 'legal_status')
 AND site_setting.organization_id = state.organization_id
 AND site_setting.key = CASE state.entity_type
   WHEN 'site_identity' THEN 'public_identity'
   WHEN 'legal_status' THEN 'public_legal_status'
 END
WHERE (
  state.workflow_status = 'published'
  OR (
    state.workflow_status = 'archived'
    AND state.entity_type IN (
      'club_public_profile', 'program_public_profile'
    )
    AND state.published_revision_id IS NOT NULL
  )
)
AND EXISTS (
  SELECT 1
  FROM cms_adoption_states AS adoption
  WHERE adoption.organization_id = state.organization_id
    AND adoption.adoption_version = 1
)
AND CASE state.entity_type
  WHEN 'page' THEN (
    page.id IS NOT NULL
    AND page.status = 'published'
    AND page.visibility = 'public'
    AND page.published_at IS NOT NULL
    AND page.deleted_at IS NULL
    AND ${cmsPageLiveProjectionMatchesReceiptSql("page", "receipt")}
  )
  WHEN 'club_public_profile' THEN (
    club.id IS NOT NULL
    AND club.deleted_at IS NULL
    AND profile.club_id IS NOT NULL
    AND profile.publication_status IN ('published', 'archived')
    AND profile.published_at IS NOT NULL
    AND profile.deleted_at IS NULL
    AND ${cmsClubLiveProjectionMatchesReceiptSql(
      "club",
      "profile",
      "club_details",
      "receipt",
    )}
  )
  WHEN 'community_link' THEN (
    community_link.id IS NOT NULL
    AND community_link.is_published = 1
    AND community_link.deleted_at IS NULL
    AND community_details.community_link_id IS NOT NULL
    AND ${cmsCommunityLiveProjectionMatchesReceiptSql(
      "community_link",
      "community_details",
      "receipt",
    )}
  )
  WHEN 'navigation' THEN
    ${cmsNavigationLiveProjectionMatchesReceiptSql(
      "state.organization_id",
      "receipt",
    )}
  WHEN 'site_identity' THEN (
    site_setting.id IS NOT NULL
    AND site_setting.is_public = 1
    AND site_setting.value_json = revision.snapshot_json
    AND json_extract(receipt.projection_json, '$.setting.key') =
        'public_identity'
    AND json_extract(receipt.projection_json, '$.setting.valueJson') =
        site_setting.value_json
  )
  WHEN 'legal_status' THEN (
    site_setting.id IS NOT NULL
    AND site_setting.is_public = 1
    AND site_setting.value_json = revision.snapshot_json
    AND json_extract(receipt.projection_json, '$.setting.key') =
        'public_legal_status'
    AND json_extract(receipt.projection_json, '$.setting.valueJson') =
        site_setting.value_json
  )
  WHEN 'program_public_profile' THEN 1
  ELSE 0
END = 0`;

const PUBLIC_SLUG_REDIRECT_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM public_slug_redirects AS redirect
WHERE (
  redirect.entity_type = 'page'
  AND NOT EXISTS (
    SELECT 1 FROM pages AS page
    WHERE page.id = redirect.entity_id
      AND page.organization_id = redirect.organization_id
  )
) OR (
  redirect.entity_type = 'club_public_profile'
  AND NOT EXISTS (
    SELECT 1 FROM club_public_profiles AS profile
    WHERE profile.club_id = redirect.entity_id
      AND profile.organization_id = redirect.organization_id
  )
) OR (
  redirect.entity_type = 'program_public_profile'
  AND NOT EXISTS (
    SELECT 1
    FROM programs AS program
    WHERE program.id = redirect.entity_id
      AND program.organization_id = redirect.organization_id
  )
)`;

const PAGE_PUBLIC_METADATA_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM page_public_metadata AS metadata
WHERE NOT EXISTS (
  SELECT 1 FROM pages AS page
  WHERE page.id = metadata.page_id
    AND page.organization_id = metadata.organization_id
)
OR (
  metadata.og_media_asset_id IS NOT NULL
  AND NOT (${mediaAssetPublicReadySql(
    "metadata.og_media_asset_id",
    "metadata.organization_id",
  )})
)`;

const ORGANIZER_EVENT_PUBLIC_METADATA_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM organizer_event_public_metadata AS metadata
WHERE NOT EXISTS (
  SELECT 1
  FROM organizer_events AS event
  WHERE event.id = metadata.organizer_event_id
    AND event.organization_id = metadata.organization_id
)
OR NOT EXISTS (
  SELECT 1
  FROM organization_memberships AS membership
  WHERE membership.organization_id = metadata.organization_id
    AND membership.profile_id = metadata.updated_by_profile_id
)`;

const ORGANIZER_EVENT_PUBLIC_LEGAL_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM organizer_events AS event
LEFT JOIN organizer_event_public_details AS detail
  ON detail.organizer_event_id = event.id
 AND detail.organization_id = event.organization_id
LEFT JOIN organizer_event_public_metadata AS metadata
  ON metadata.organizer_event_id = event.id
 AND metadata.organization_id = event.organization_id
WHERE event.publication_status IN ('scheduled', 'published')
  AND (
    ${protectedLegalClaimSql([
      "event.title",
      "event.summary",
      "event.description",
      "detail.public_location_name",
      "detail.public_address",
      "detail.public_access_note",
      "detail.cost_text",
      "detail.preparation_information",
      "detail.what_to_bring",
      "detail.arrival_instructions",
      "detail.weather_note",
      "detail.verified_accessibility_notes",
      "metadata.seo_title",
      "metadata.meta_description",
    ])}
    OR ${publicOrganizerEmailExposureSql(
      [
        "event.title",
        "event.summary",
        "event.description",
        "detail.public_location_name",
        "detail.public_address",
        "detail.public_access_note",
        "detail.cost_text",
        "detail.preparation_information",
        "detail.what_to_bring",
        "detail.arrival_instructions",
        "detail.weather_note",
        "detail.verified_accessibility_notes",
        "metadata.seo_title",
        "metadata.meta_description",
      ],
      "event.organization_id",
    )}
  )`;

const CLUB_PUBLIC_DETAILS_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM club_public_profile_details AS detail
WHERE NOT EXISTS (
  SELECT 1 FROM club_public_profiles AS profile
  WHERE profile.club_id = detail.club_id
    AND profile.organization_id = detail.organization_id
)
OR (
  detail.cover_media_asset_id IS NOT NULL
  AND NOT (${mediaAssetPublicReadySql(
    "detail.cover_media_asset_id",
    "detail.organization_id",
  )})
)
OR (
  detail.thumbnail_media_asset_id IS NOT NULL
  AND NOT (${mediaAssetPublicReadySql(
    "detail.thumbnail_media_asset_id",
    "detail.organization_id",
  )})
)
OR (
  detail.og_media_asset_id IS NOT NULL
  AND NOT (${mediaAssetPublicReadySql(
    "detail.og_media_asset_id",
    "detail.organization_id",
  )})
)`;

const PROGRAM_PUBLIC_DETAILS_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM program_public_profile_details AS detail
WHERE detail.deleted_at IS NULL
AND (
  NOT EXISTS (
    SELECT 1
    FROM programs AS program
    JOIN clubs AS club
      ON club.id = program.club_id
     AND club.organization_id = program.organization_id
    JOIN event_lanes AS lane
      ON lane.id = detail.primary_event_lane_id
     AND lane.organization_id = program.organization_id
     AND lane.deleted_at IS NULL
    WHERE program.id = detail.program_id
      AND program.organization_id = detail.organization_id
      AND program.club_id = detail.club_id
      AND (
        (
          program.deleted_at IS NULL
          AND club.deleted_at IS NULL
        )
        OR (
          detail.publication_status = 'archived'
          AND program.deleted_at IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM cms_entity_publication_states AS tombstone_state
            WHERE tombstone_state.organization_id =
                  detail.organization_id
              AND tombstone_state.entity_type =
                  'program_public_profile'
              AND tombstone_state.entity_key = detail.program_id
              AND tombstone_state.workflow_status = 'archived'
          )
        )
      )
)
OR (
    detail.cover_media_asset_id IS NOT NULL
    AND NOT (${mediaAssetPublicReadySql(
      "detail.cover_media_asset_id",
      "detail.organization_id",
    )})
)
OR (
    detail.thumbnail_media_asset_id IS NOT NULL
    AND NOT (${mediaAssetPublicReadySql(
      "detail.thumbnail_media_asset_id",
      "detail.organization_id",
    )})
)
OR (
    detail.og_media_asset_id IS NOT NULL
    AND NOT (${mediaAssetPublicReadySql(
      "detail.og_media_asset_id",
      "detail.organization_id",
    )})
)
OR (
    (
      detail.publication_status = 'published'
      OR (
        detail.publication_status = 'archived'
        AND detail.published_at IS NOT NULL
      )
    )
    AND NOT (${programCurrentMaterializationExistsSql("detail")})
  )
)`;

const PROGRAM_PUBLIC_STATE_DETAILS_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM cms_entity_publication_states AS program_state
WHERE program_state.entity_type = 'program_public_profile'
  AND program_state.workflow_status IN ('published', 'archived')
  AND program_state.published_revision_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM program_public_profile_details AS detail
    WHERE detail.program_id = program_state.entity_key
      AND detail.organization_id = program_state.organization_id
      AND detail.publication_status = program_state.workflow_status
      AND detail.published_at IS NOT NULL
      AND detail.deleted_at IS NULL
      AND (${programCurrentMaterializationExistsSql("detail")})
  )`;

const SITE_IDENTITY_MEDIA_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM site_settings AS setting
WHERE setting.key = 'public_identity'
  AND (
    (
      json_extract(setting.value_json, '$.logoAssetId') IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "json_extract(setting.value_json, '$.logoAssetId')",
        "setting.organization_id",
      )})
    )
    OR (
      json_extract(setting.value_json, '$.openGraphAssetId') IS NOT NULL
      AND NOT (${mediaAssetPublicReadySql(
        "json_extract(setting.value_json, '$.openGraphAssetId')",
        "setting.organization_id",
      )})
    )
  )`;

const COMMUNITY_PUBLIC_DETAILS_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM community_link_public_details AS detail
WHERE NOT EXISTS (
  SELECT 1 FROM community_links AS link
  WHERE link.id = detail.community_link_id
    AND link.organization_id = detail.organization_id
)`;

const MEDIA_DETAILS_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM media_asset_details AS detail
WHERE NOT EXISTS (
  SELECT 1 FROM media_assets AS asset
  WHERE asset.id = detail.asset_id
    AND asset.organization_id = detail.organization_id
)`;

const MEDIA_PUBLIC_LEGAL_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM media_assets AS asset
LEFT JOIN media_asset_details AS detail
  ON detail.asset_id = asset.id
 AND detail.organization_id = asset.organization_id
WHERE ${protectedLegalClaimSql([
    "asset.alt_text",
    "asset.credit",
    "detail.caption",
  ])}
   OR ${publicOrganizerEmailExposureSql(
     ["asset.alt_text", "asset.credit", "detail.caption"],
     "asset.organization_id",
   )}`;

const MEDIA_VARIANT_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM media_asset_variants AS variant
WHERE NOT EXISTS (
  SELECT 1
  FROM media_assets AS asset
  JOIN media_asset_details AS detail
    ON detail.asset_id = asset.id
   AND detail.organization_id = asset.organization_id
  WHERE asset.id = variant.asset_id
    AND asset.organization_id = variant.organization_id
)`;

const MEDIA_USAGE_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM media_usage_references AS usage
WHERE NOT (
  (
    usage.entity_type = 'page'
    AND EXISTS (
      SELECT 1 FROM pages AS page
      WHERE page.id = usage.entity_id
        AND page.organization_id = usage.organization_id
    )
  )
  OR (
    usage.entity_type = 'club_public_profile'
    AND EXISTS (
      SELECT 1 FROM club_public_profiles AS profile
      WHERE profile.club_id = usage.entity_id
        AND profile.organization_id = usage.organization_id
    )
  )
  OR (
    usage.entity_type = 'program_public_profile'
    AND EXISTS (
      SELECT 1
      FROM programs AS program
      WHERE program.id = usage.entity_id
        AND program.organization_id = usage.organization_id
    )
  )
  OR (
    usage.entity_type = 'organizer_event'
    AND EXISTS (
      SELECT 1 FROM organizer_events AS event
      WHERE event.id = usage.entity_id
        AND event.organization_id = usage.organization_id
    )
  )
  OR (
    usage.entity_type = 'organizer_profile'
    AND EXISTS (
      SELECT 1
      FROM organizer_public_attribution_states AS attribution
      WHERE attribution.profile_id = usage.entity_id
        AND attribution.organization_id = usage.organization_id
    )
  )
  OR (
    usage.entity_type = 'community_link'
    AND EXISTS (
      SELECT 1 FROM community_links AS link
      WHERE link.id = usage.entity_id
        AND link.organization_id = usage.organization_id
    )
  )
  OR (
    usage.entity_type IN ('site_logo', 'site_og', 'footer')
    AND usage.entity_id = usage.organization_id
  )
)
OR NOT (
  (
    usage.entity_type = 'organizer_event'
    AND EXISTS (
      SELECT 1
      FROM organizer_event_revisions AS revision
      WHERE revision.id = usage.revision_id
        AND revision.organization_id = usage.organization_id
        AND revision.organizer_event_id = usage.entity_id
    )
  )
  OR (
    usage.entity_type = 'organizer_profile'
    AND (
      EXISTS (
        SELECT 1
        FROM organizer_public_attribution_states AS attribution
        WHERE attribution.profile_id = usage.entity_id
          AND attribution.organization_id = usage.organization_id
          AND (
            (
              usage.publication_scope = 'draft'
              AND attribution.draft_photo_media_asset_id =
                  usage.asset_id
              AND usage.revision_id =
                  'profile-draft:' || attribution.attribution_version
            )
            OR (
              usage.publication_scope = 'published'
              AND attribution.workflow_status = 'confirmed'
              AND attribution.public_photo_media_asset_id =
                  usage.asset_id
              AND attribution.current_receipt_id =
                  usage.revision_id
            )
          )
      )
      OR (
        usage.deleted_at IS NOT NULL
        AND usage.publication_scope = 'published'
        AND EXISTS (
          SELECT 1
          FROM organizer_public_attribution_receipts AS receipt
          WHERE receipt.id = usage.revision_id
            AND receipt.organization_id = usage.organization_id
            AND receipt.profile_id = usage.entity_id
            AND receipt.action IN ('adopted', 'confirmed')
            AND receipt.photo_media_asset_id = usage.asset_id
        )
      )
    )
  )
  OR (
    usage.entity_type IN (
      'page', 'club_public_profile', 'program_public_profile',
      'community_link'
    )
    AND EXISTS (
      SELECT 1
      FROM cms_entity_revisions AS revision
      WHERE revision.id = usage.revision_id
        AND revision.organization_id = usage.organization_id
        AND revision.entity_type = usage.entity_type
        AND revision.entity_key = usage.entity_id
    )
  )
  OR (
    usage.entity_type IN ('site_logo', 'site_og', 'footer')
    AND EXISTS (
      SELECT 1
      FROM cms_entity_revisions AS revision
      WHERE revision.id = usage.revision_id
        AND revision.organization_id = usage.organization_id
        AND revision.entity_type = 'site_identity'
        AND revision.entity_key = 'site_identity'
    )
  )
)
OR (
  usage.deleted_at IS NULL
  AND (
    (
      usage.publication_scope = 'published'
      AND NOT (${currentPublishedMediaUsageTargetSql("usage")})
    )
    OR (
      ${mediaUsageRequiresUsefulAltSql("usage")}
      AND NOT EXISTS (
        SELECT 1
        FROM media_assets AS required_alt_asset
        WHERE required_alt_asset.id = usage.asset_id
          AND required_alt_asset.organization_id =
              usage.organization_id
          AND length(
                trim(COALESCE(required_alt_asset.alt_text, ''))
              ) BETWEEN 1 AND 300
      )
    )
    OR
    NOT EXISTS (
    SELECT 1
    FROM media_assets AS asset
    JOIN media_asset_details AS detail
      ON detail.asset_id = asset.id
     AND detail.organization_id = asset.organization_id
    WHERE asset.id = usage.asset_id
      AND asset.organization_id = usage.organization_id
      AND asset.deleted_at IS NULL
      AND detail.upload_state = 'ready'
    )
    OR (
      usage.publication_scope = 'published'
      AND NOT EXISTS (
      SELECT 1
      FROM media_assets AS asset
      JOIN media_asset_details AS detail
        ON detail.asset_id = asset.id
       AND detail.organization_id = asset.organization_id
      WHERE asset.id = usage.asset_id
        AND asset.organization_id = usage.organization_id
        AND asset.deleted_at IS NULL
        AND detail.upload_state = 'ready'
        AND asset.rights_status = 'approved'
        AND asset.participant_consent_status IN ('confirmed', 'not_applicable')
        AND length(trim(COALESCE(asset.credit, ''))) BETWEEN 1 AND 300
        AND (
          detail.informative = 0
          OR length(trim(COALESCE(asset.alt_text, ''))) BETWEEN 1 AND 300
        )
        AND (
          SELECT count(*)
          FROM media_asset_variants AS variant
          WHERE variant.organization_id = asset.organization_id
            AND variant.asset_id = asset.id
            AND variant.state = 'ready'
            AND variant.variant_kind IN (
              'original', 'webp_480', 'webp_960', 'webp_1600'
            )
        ) = 4
      )
    )
  )
)`;

const MEDIA_USAGE_COMPLETENESS_INTEGRITY_COUNT_SQL =
  missingCurrentPublishedMediaUsageCountSqlStatements();

const PUBLIC_ATTRIBUTION_INTENT_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM organizer_public_attribution_write_intents AS intent
WHERE intent.completed_at IS NULL
   OR intent.actor_profile_id <> intent.profile_id
   OR NOT EXISTS (
     SELECT 1
     FROM organizer_public_attribution_receipts AS receipt
     WHERE receipt.write_intent_id = intent.id
       AND receipt.organization_id = intent.organization_id
       AND receipt.profile_id = intent.profile_id
       AND receipt.action = intent.operation
       AND receipt.attribution_version =
           intent.proposed_published_version
       AND receipt.snapshot_hash = intent.snapshot_hash
       AND receipt.actor_profile_id = intent.actor_profile_id
   )
   OR NOT EXISTS (
     SELECT 1
     FROM audit_logs AS audit
     WHERE audit.organization_id = intent.organization_id
       AND audit.actor_profile_id = intent.actor_profile_id
       AND audit.entity_type = 'profile'
       AND audit.entity_id = intent.profile_id
       AND audit.action =
           CASE intent.operation
             WHEN 'adopted'
             THEN 'profile.public_attribution_adopted'
             WHEN 'confirmed'
             THEN 'profile.public_attribution_confirmed'
             ELSE 'profile.public_attribution_revoked'
           END
       AND json_extract(audit.metadata_json, '$.writeIntentId') =
           intent.id
       AND json_extract(
             audit.metadata_json,
             '$.draftVersion'
           ) = intent.expected_draft_version
       AND json_extract(
             audit.metadata_json,
             '$.publishedVersion'
           ) = intent.proposed_published_version
   )`;

const PUBLIC_ATTRIBUTION_RECEIPT_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM organizer_public_attribution_receipts AS receipt
WHERE receipt.actor_profile_id <> receipt.profile_id
   OR NOT EXISTS (
     SELECT 1
     FROM organizer_public_attribution_write_intents AS intent
     WHERE intent.id = receipt.write_intent_id
       AND intent.organization_id = receipt.organization_id
       AND intent.profile_id = receipt.profile_id
       AND intent.operation = receipt.action
       AND intent.proposed_published_version =
           receipt.attribution_version
       AND intent.snapshot_hash = receipt.snapshot_hash
       AND intent.actor_profile_id = receipt.actor_profile_id
       AND intent.completed_at IS NOT NULL
   )
   OR NOT EXISTS (
     SELECT 1
     FROM organization_memberships AS membership
     JOIN profiles AS profile
       ON profile.id = membership.profile_id
     WHERE membership.organization_id = receipt.organization_id
       AND membership.profile_id = receipt.profile_id
   )
   OR (
     receipt.action = 'adopted'
     AND (
       receipt.consent <> 1
       OR receipt.legacy_adopted <> 1
       OR receipt.display_name IS NULL
       OR length(trim(receipt.display_name)) NOT BETWEEN 1 AND 120
       OR receipt.biography IS NOT NULL
       OR receipt.photo_media_asset_id IS NOT NULL
       OR receipt.prior_published_version IS NOT NULL
       OR receipt.related_receipt_id IS NOT NULL
       OR receipt.snapshot_json <> json_object(
         'biography', NULL,
         'consent', json('true'),
         'displayName', receipt.display_name,
         'draftVersion', receipt.draft_version,
         'legacyAdopted', json('true'),
         'photoAssetId', NULL
       )
     )
   )
   OR (
     receipt.action = 'confirmed'
     AND (
       receipt.consent <> 1
       OR receipt.legacy_adopted <> 0
       OR receipt.display_name IS NULL
       OR length(trim(receipt.display_name)) NOT BETWEEN 1 AND 120
       OR (
         receipt.biography IS NOT NULL
         AND length(receipt.biography) NOT BETWEEN 1 AND 800
       )
       OR receipt.prior_published_version IS NOT NULL
       OR receipt.snapshot_json <> json_object(
         'biography', receipt.biography,
         'consent', json('true'),
         'displayName', receipt.display_name,
         'draftVersion', receipt.draft_version,
         'legacyAdopted', json('false'),
         'photoAssetId', receipt.photo_media_asset_id
       )
       OR (
         receipt.related_receipt_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM organizer_public_attribution_receipts AS prior
           WHERE prior.id = receipt.related_receipt_id
             AND prior.organization_id = receipt.organization_id
             AND prior.profile_id = receipt.profile_id
             AND prior.attribution_version <
                 receipt.attribution_version
         )
       )
     )
   )
   OR (
     receipt.action = 'revoked'
     AND (
       receipt.consent <> 0
       OR receipt.legacy_adopted <> 0
       OR receipt.display_name IS NOT NULL
       OR receipt.biography IS NOT NULL
       OR receipt.photo_media_asset_id IS NOT NULL
       OR receipt.prior_published_version <>
          receipt.attribution_version - 1
       OR receipt.snapshot_json <> json_object(
         'consent', json('false'),
         'draftVersion', receipt.draft_version,
         'priorPublishedVersion', receipt.prior_published_version,
         'relatedReceiptId', receipt.related_receipt_id
       )
       OR NOT EXISTS (
         SELECT 1
         FROM organizer_public_attribution_receipts AS confirmation
         WHERE confirmation.id = receipt.related_receipt_id
           AND confirmation.organization_id = receipt.organization_id
           AND confirmation.profile_id = receipt.profile_id
           AND confirmation.action IN ('adopted', 'confirmed')
           AND confirmation.attribution_version =
               receipt.prior_published_version
       )
     )
   )
   OR NOT (
     EXISTS (
       SELECT 1
       FROM organizer_public_attribution_states AS current_state
       WHERE current_state.profile_id = receipt.profile_id
         AND current_state.organization_id = receipt.organization_id
         AND current_state.current_receipt_id = receipt.id
     )
     OR EXISTS (
       SELECT 1
       FROM organizer_public_attribution_receipts AS successor
       WHERE successor.organization_id = receipt.organization_id
         AND successor.profile_id = receipt.profile_id
         AND successor.related_receipt_id = receipt.id
         AND successor.attribution_version >
             receipt.attribution_version
     )
   )`;

const PUBLIC_ATTRIBUTION_STATE_BASE_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM organizer_public_attribution_states AS attribution
JOIN profiles AS profile
  ON profile.id = attribution.profile_id
WHERE attribution.updated_by_profile_id <> attribution.profile_id
 OR NOT EXISTS (
   SELECT 1
   FROM organization_memberships AS membership
   WHERE membership.organization_id = attribution.organization_id
     AND membership.profile_id = attribution.profile_id
 )
 OR (
   attribution.workflow_status = 'unconfirmed'
   AND (
     attribution.published_attribution_version <> 0
     OR attribution.current_receipt_id IS NOT NULL
     OR profile.public_attribution_consent <> 0
   )
 )
 OR (
   attribution.workflow_status = 'confirmed'
   AND (
     profile.public_attribution_consent <> 1
     OR profile.display_name IS NOT attribution.public_display_name
     OR instr(attribution.public_display_name, '@') > 0
     OR lower(trim(attribution.public_display_name)) =
        lower(profile.normalized_email)
     OR NOT EXISTS (
       SELECT 1
       FROM organizer_public_attribution_receipts AS receipt
       WHERE receipt.id = attribution.current_receipt_id
         AND receipt.organization_id = attribution.organization_id
         AND receipt.profile_id = attribution.profile_id
         AND receipt.action IN ('adopted', 'confirmed')
         AND receipt.attribution_version =
             attribution.published_attribution_version
         AND receipt.actor_profile_id = attribution.profile_id
         AND receipt.draft_version <= attribution.attribution_version
         AND receipt.consent = 1
         AND receipt.display_name = attribution.public_display_name
         AND receipt.biography IS attribution.public_biography
         AND receipt.photo_media_asset_id IS
             attribution.public_photo_media_asset_id
     )
   )
 )
 OR (
   attribution.workflow_status = 'revoked'
   AND (
     profile.public_attribution_consent <> 0
     OR NOT EXISTS (
       SELECT 1
       FROM organizer_public_attribution_receipts AS receipt
       WHERE receipt.id = attribution.current_receipt_id
         AND receipt.organization_id = attribution.organization_id
         AND receipt.profile_id = attribution.profile_id
         AND receipt.action = 'revoked'
         AND receipt.attribution_version =
             attribution.published_attribution_version
         AND receipt.actor_profile_id = attribution.profile_id
     )
   )
 )
 OR (
   profile.public_attribution_consent = 1
   AND attribution.workflow_status <> 'confirmed'
 )`;

const PUBLIC_ATTRIBUTION_STATE_TEXT_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM organizer_public_attribution_states AS attribution
WHERE attribution.workflow_status = 'confirmed'
  AND (
    ${protectedLegalClaimSql([
      "attribution.public_display_name",
      "attribution.public_biography",
    ])}
    OR ${publicOrganizerEmailExposureSql(
      ["attribution.public_display_name", "attribution.public_biography"],
      "attribution.organization_id",
    )}
  )`;

const PUBLIC_ATTRIBUTION_STATE_PHOTO_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM organizer_public_attribution_states AS attribution
WHERE attribution.workflow_status = 'confirmed'
  AND attribution.public_photo_media_asset_id IS NOT NULL
  AND NOT (${mediaAssetPublicReadySql(
    "attribution.public_photo_media_asset_id",
    "attribution.organization_id",
  )})`;

const PUBLIC_ATTRIBUTION_STATE_LEGACY_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM profiles AS profile
WHERE profile.public_attribution_consent = 1
  AND profile.status = 'active'
  AND profile.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM organization_memberships AS membership
    WHERE membership.profile_id = profile.id
      AND membership.status = 'active'
      AND membership.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM organizer_public_attribution_states AS attribution
    WHERE attribution.profile_id = profile.id
      AND attribution.workflow_status = 'confirmed'
  )`;

const PUBLIC_ATTRIBUTION_STATE_INTEGRITY_COUNT_SQL = Object.freeze([
  PUBLIC_ATTRIBUTION_STATE_BASE_INTEGRITY_COUNT_SQL,
  PUBLIC_ATTRIBUTION_STATE_TEXT_INTEGRITY_COUNT_SQL,
  PUBLIC_ATTRIBUTION_STATE_PHOTO_INTEGRITY_COUNT_SQL,
  PUBLIC_ATTRIBUTION_STATE_LEGACY_INTEGRITY_COUNT_SQL,
]);

const LEGAL_RECEIPT_INTEGRITY_COUNT_SQL = String.raw`
SELECT count(*) AS violation_count
FROM legal_status_confirmation_receipts AS receipt
WHERE NOT EXISTS (
  SELECT 1
  FROM cms_entity_revisions AS revision
  WHERE revision.id = receipt.revision_id
    AND revision.organization_id = receipt.organization_id
    AND revision.entity_type = 'legal_status'
    AND revision.entity_key = 'legal_status'
    AND revision.content_hash = receipt.revision_hash
    AND ${phase6LegalSnapshotCoherentSql("revision.snapshot_json")}
)
OR (
  receipt.action = 'revoked'
  AND NOT EXISTS (
    SELECT 1
    FROM legal_status_confirmation_receipts AS confirmation
    WHERE confirmation.id = receipt.revokes_receipt_id
      AND confirmation.organization_id = receipt.organization_id
      AND confirmation.action = 'confirmed'
      AND confirmation.revision_id = receipt.revision_id
      AND confirmation.revision_hash = receipt.revision_hash
  )
)`;

const TAXONOMY_STATE_INTEGRITY_COUNT_SQL = String.raw`
SELECT (
  (
    SELECT count(*)
    FROM event_lanes AS lane
    WHERE NOT EXISTS (
      SELECT 1
      FROM event_lane_taxonomy_states AS state
      WHERE state.lane_id = lane.id
        AND state.organization_id = lane.organization_id
    )
  )
  +
  (
    SELECT count(*)
    FROM categories AS category
    WHERE NOT EXISTS (
      SELECT 1
      FROM category_taxonomy_states AS state
      WHERE state.category_id = category.id
        AND state.organization_id = category.organization_id
    )
  )
  +
  (
    SELECT count(*)
    FROM event_lane_taxonomy_states AS state
    WHERE state.active_intent_id IS NOT NULL
       OR state.last_completed_intent_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM event_lanes AS lane
         JOIN taxonomy_write_intents AS intent
           ON intent.id = state.last_completed_intent_id
          AND intent.organization_id = state.organization_id
          AND intent.entity_type = 'lane'
          AND intent.entity_id = state.lane_id
          AND intent.operation <> 'safe_delete'
          AND intent.proposed_content_version =
              state.content_version
          AND intent.actor_profile_id =
              state.updated_by_profile_id
          AND intent.completed_at IS NOT NULL
         WHERE lane.id = state.lane_id
           AND lane.organization_id = state.organization_id
           AND lane.name = intent.proposed_name
           AND lane.slug = intent.proposed_slug
           AND lane.description IS intent.proposed_description
           AND lane.sort_order = intent.proposed_sort_order
           AND lane.deleted_at IS intent.proposed_deleted_at
           AND intent.proposed_color_token IS NULL
       )
  )
  +
  (
    SELECT count(*)
    FROM category_taxonomy_states AS state
    WHERE state.active_intent_id IS NOT NULL
       OR state.last_completed_intent_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM categories AS category
         JOIN taxonomy_write_intents AS intent
           ON intent.id = state.last_completed_intent_id
          AND intent.organization_id = state.organization_id
          AND intent.entity_type = 'category'
          AND intent.entity_id = state.category_id
          AND intent.operation <> 'safe_delete'
          AND intent.proposed_content_version =
              state.content_version
          AND intent.actor_profile_id =
              state.updated_by_profile_id
          AND intent.completed_at IS NOT NULL
         WHERE category.id = state.category_id
           AND category.organization_id = state.organization_id
           AND category.name = intent.proposed_name
           AND category.slug = intent.proposed_slug
           AND category.description IS intent.proposed_description
           AND category.color_token IS intent.proposed_color_token
           AND category.deleted_at IS intent.proposed_deleted_at
           AND state.sort_order = intent.proposed_sort_order
       )
  )
  +
  (
    SELECT count(*)
    FROM taxonomy_write_intents AS intent
    WHERE intent.completed_at IS NULL
  )
  +
  (
    SELECT count(*)
    FROM taxonomy_write_intents AS intent
    WHERE intent.completed_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM audit_logs AS audit
        WHERE audit.organization_id = intent.organization_id
          AND audit.actor_profile_id = intent.actor_profile_id
          AND audit.entity_type =
              'event_' || intent.entity_type
          AND audit.entity_id = intent.entity_id
          AND audit.action =
              'taxonomy.' || intent.entity_type || '_' ||
              CASE intent.operation
                WHEN 'adopt' THEN 'adopted'
                WHEN 'create' THEN 'created'
                WHEN 'update' THEN 'updated'
                WHEN 'reorder' THEN 'reordered'
                WHEN 'archive' THEN 'archived'
                ELSE 'deleted'
              END
          AND json_extract(
                audit.metadata_json,
                '$.writeIntentId'
              ) = intent.id
      )
  )
  +
  (
    SELECT count(*)
    FROM taxonomy_write_intents AS intent
    WHERE intent.completed_at IS NOT NULL
      AND (
        (
          intent.proposed_content_version = 1
          AND intent.operation NOT IN ('adopt', 'create')
        )
        OR (
          intent.proposed_content_version > 1
          AND NOT EXISTS (
            SELECT 1
            FROM taxonomy_write_intents AS previous_intent
            WHERE previous_intent.organization_id =
                  intent.organization_id
              AND previous_intent.entity_type =
                  intent.entity_type
              AND previous_intent.entity_id = intent.entity_id
              AND previous_intent.proposed_content_version =
                  intent.proposed_content_version - 1
              AND previous_intent.completed_at IS NOT NULL
          )
        )
        OR EXISTS (
          SELECT 1
          FROM taxonomy_write_intents AS terminal_intent
          WHERE terminal_intent.organization_id =
                intent.organization_id
            AND terminal_intent.entity_type = intent.entity_type
            AND terminal_intent.entity_id = intent.entity_id
            AND terminal_intent.operation = 'safe_delete'
            AND terminal_intent.completed_at IS NOT NULL
            AND terminal_intent.proposed_content_version <
                intent.proposed_content_version
        )
      )
  )
  +
  (
    SELECT count(*)
    FROM taxonomy_write_intents AS intent
    WHERE intent.completed_at IS NOT NULL
      AND intent.operation <> 'safe_delete'
      AND NOT (
        (
          intent.entity_type = 'lane'
          AND EXISTS (
            SELECT 1
            FROM event_lanes AS lane
            JOIN event_lane_taxonomy_states AS state
              ON state.lane_id = lane.id
             AND state.organization_id = lane.organization_id
            WHERE lane.id = intent.entity_id
              AND lane.organization_id = intent.organization_id
          )
        )
        OR (
          intent.entity_type = 'category'
          AND EXISTS (
            SELECT 1
            FROM categories AS category
            JOIN category_taxonomy_states AS state
              ON state.category_id = category.id
             AND state.organization_id = category.organization_id
            WHERE category.id = intent.entity_id
              AND category.organization_id =
                  intent.organization_id
          )
        )
        OR EXISTS (
          SELECT 1
          FROM taxonomy_write_intents AS terminal_intent
          WHERE terminal_intent.organization_id =
                intent.organization_id
            AND terminal_intent.entity_type = intent.entity_type
            AND terminal_intent.entity_id = intent.entity_id
            AND terminal_intent.operation = 'safe_delete'
            AND terminal_intent.completed_at IS NOT NULL
            AND terminal_intent.proposed_content_version >
                intent.proposed_content_version
        )
      )
  )
  +
  (
    SELECT count(*)
    FROM event_lane_taxonomy_states AS state
    WHERE state.content_version <> (
      SELECT max(intent.proposed_content_version)
      FROM taxonomy_write_intents AS intent
      WHERE intent.organization_id = state.organization_id
        AND intent.entity_type = 'lane'
        AND intent.entity_id = state.lane_id
        AND intent.completed_at IS NOT NULL
    )
  )
  +
  (
    SELECT count(*)
    FROM category_taxonomy_states AS state
    WHERE state.content_version <> (
      SELECT max(intent.proposed_content_version)
      FROM taxonomy_write_intents AS intent
      WHERE intent.organization_id = state.organization_id
        AND intent.entity_type = 'category'
        AND intent.entity_id = state.category_id
        AND intent.completed_at IS NOT NULL
    )
  )
  +
  (
    SELECT count(*)
    FROM taxonomy_write_intents AS intent
    WHERE intent.completed_at IS NOT NULL
      AND intent.operation = 'safe_delete'
      AND (
        (
          intent.entity_type = 'lane'
          AND (
            EXISTS (
              SELECT 1 FROM event_lanes AS lane
              WHERE lane.id = intent.entity_id
            )
            OR EXISTS (
              SELECT 1 FROM event_lane_taxonomy_states AS state
              WHERE state.lane_id = intent.entity_id
            )
            OR EXISTS (
              SELECT 1
              FROM cms_entity_revisions AS revision
              WHERE revision.organization_id =
                    intent.organization_id
                AND revision.entity_type IN (
                  'club_public_profile',
                  'program_public_profile'
                )
                AND json_valid(revision.snapshot_json)
                AND json_extract(
                      revision.snapshot_json,
                      '$.laneId'
                    ) = intent.entity_id
            )
          )
        )
        OR (
          intent.entity_type = 'category'
          AND (
            EXISTS (
              SELECT 1 FROM categories AS category
              WHERE category.id = intent.entity_id
            )
            OR EXISTS (
              SELECT 1 FROM category_taxonomy_states AS state
              WHERE state.category_id = intent.entity_id
            )
          )
        )
      )
  )
  +
  (
    SELECT count(*)
    FROM event_lanes AS lane
    WHERE lane.slug IN (
      'think', 'reset-and-make', 'explore', 'eat-and-play'
    )
      AND lane.deleted_at IS NOT NULL
  )
  +
  (
    SELECT count(*)
    FROM (
      SELECT organization_id
      FROM event_lanes
      GROUP BY organization_id
      HAVING count(*) > 100
    )
  )
  +
  (
    SELECT count(*)
    FROM (
      SELECT organization_id
      FROM categories
      GROUP BY organization_id
      HAVING count(*) > 100
    )
  )
  +
  (
    SELECT count(*)
    FROM organizations AS organization
    WHERE EXISTS (
      SELECT 1
      FROM site_settings AS catalog_marker
      WHERE catalog_marker.organization_id = organization.id
        AND catalog_marker.key = 'public_catalog_version'
    )
      AND (
        SELECT count(*)
        FROM event_lanes AS canonical_lane
        WHERE canonical_lane.organization_id = organization.id
          AND canonical_lane.slug IN (
            'think', 'reset-and-make', 'explore', 'eat-and-play'
          )
          AND canonical_lane.deleted_at IS NULL
      ) <> 4
  )
) AS violation_count`;

export const PHASE6_INVARIANT_COUNT_SQL = Object.freeze([
  ...CMS_STATE_INTEGRITY_COUNT_SQL,
  CMS_REVISION_INTEGRITY_COUNT_SQL,
  ...CMS_MATERIALIZATION_RECEIPT_INTEGRITY_COUNT_SQL,
  CMS_MATERIALIZATION_RECEIPT_PUBLIC_LEGAL_INTEGRITY_COUNT_SQL,
  CMS_MATERIALIZATION_RECEIPT_PUBLIC_EMAIL_INTEGRITY_COUNT_SQL,
  CMS_PUBLIC_PROJECTION_INTEGRITY_COUNT_SQL,
  PUBLIC_SLUG_REDIRECT_INTEGRITY_COUNT_SQL,
  PAGE_PUBLIC_METADATA_INTEGRITY_COUNT_SQL,
  ORGANIZER_EVENT_PUBLIC_METADATA_INTEGRITY_COUNT_SQL,
  ORGANIZER_EVENT_PUBLIC_LEGAL_INTEGRITY_COUNT_SQL,
  CLUB_PUBLIC_DETAILS_INTEGRITY_COUNT_SQL,
  PROGRAM_PUBLIC_DETAILS_INTEGRITY_COUNT_SQL,
  PROGRAM_PUBLIC_STATE_DETAILS_INTEGRITY_COUNT_SQL,
  SITE_IDENTITY_MEDIA_INTEGRITY_COUNT_SQL,
  COMMUNITY_PUBLIC_DETAILS_INTEGRITY_COUNT_SQL,
  MEDIA_DETAILS_INTEGRITY_COUNT_SQL,
  MEDIA_PUBLIC_LEGAL_INTEGRITY_COUNT_SQL,
  MEDIA_VARIANT_INTEGRITY_COUNT_SQL,
  MEDIA_USAGE_INTEGRITY_COUNT_SQL,
  ...MEDIA_USAGE_COMPLETENESS_INTEGRITY_COUNT_SQL,
  PUBLIC_ATTRIBUTION_INTENT_INTEGRITY_COUNT_SQL,
  PUBLIC_ATTRIBUTION_RECEIPT_INTEGRITY_COUNT_SQL,
  ...PUBLIC_ATTRIBUTION_STATE_INTEGRITY_COUNT_SQL,
  LEGAL_RECEIPT_INTEGRITY_COUNT_SQL,
  TAXONOMY_STATE_INTEGRITY_COUNT_SQL,
] as const);
