import { protectedLegalClaimSql } from "../../validation/protected-legal-claims";
import { publicOrganizerEmailExposureSql } from "../../validation/public-organizer-email";
import {
  cmsClubReceiptProjectionMatchesRevisionSql,
  cmsProgramReceiptProjectionMatchesRevisionSql,
  cmsReceiptEnvelopeMatchesRevisionSql,
} from "./cms-materialization-contract";

type ProgramProjectionAlias =
  | "detail"
  | "details"
  | "program_public"
  | "target_program";
type ClubProjectionAlias = "club_public" | "target_profile";

function cmsProjectionAdoptionPendingSql(
  organizationExpression: string,
  entityType: "club_public_profile" | "program_public_profile",
  entityKeyExpression: string,
): string {
  return `(
    NOT EXISTS (
      SELECT 1
      FROM cms_adoption_states AS adoption
      WHERE adoption.organization_id = ${organizationExpression}
        AND adoption.adoption_version = 1
    )
    AND NOT EXISTS (
      SELECT 1
      FROM cms_entity_publication_states AS pending_state
      WHERE pending_state.organization_id = ${organizationExpression}
        AND pending_state.entity_type = '${entityType}'
        AND pending_state.entity_key = ${entityKeyExpression}
    )
  )`;
}

/**
 * Exact-current proof for a materialized public Club identity. Core scheduling
 * keeps the `clubs` row, but public event surfaces may use its mutable name and
 * slug only while every allowlisted Club/profile/detail field still equals the
 * immutable receipt for the state's exact current published revision.
 */
export function publicClubProjectionParitySql(
  alias: ClubProjectionAlias,
): string {
  return `(
    ${cmsProjectionAdoptionPendingSql(
      `${alias}.organization_id`,
      "club_public_profile",
      `${alias}.club_id`,
    )}
    OR EXISTS (
    SELECT 1
    FROM cms_entity_publication_states AS club_state
    JOIN cms_entity_revisions AS club_revision
      ON club_revision.id = club_state.published_revision_id
     AND club_revision.organization_id = club_state.organization_id
     AND club_revision.publication_state_id = club_state.id
     AND club_revision.entity_type = 'club_public_profile'
     AND club_revision.entity_key = ${alias}.club_id
    JOIN cms_public_materialization_receipts AS club_receipt
      ON club_receipt.organization_id = club_state.organization_id
     AND club_receipt.publication_state_id = club_state.id
     AND club_receipt.entity_type = club_state.entity_type
     AND club_receipt.entity_key = club_state.entity_key
     AND club_receipt.revision_id = club_revision.id
     AND club_receipt.revision_hash = club_revision.content_hash
    JOIN clubs AS materialized_club
      ON materialized_club.id = ${alias}.club_id
     AND materialized_club.organization_id = ${alias}.organization_id
     AND materialized_club.deleted_at IS NULL
    LEFT JOIN club_public_profile_details AS club_details
      ON club_details.club_id = ${alias}.club_id
     AND club_details.organization_id = ${alias}.organization_id
    WHERE club_state.organization_id = ${alias}.organization_id
      AND club_state.entity_type = 'club_public_profile'
      AND club_state.entity_key = ${alias}.club_id
      AND club_state.workflow_status IN ('published', 'archived')
      AND club_state.published_revision_id IS NOT NULL
      AND (SELECT ${cmsReceiptEnvelopeMatchesRevisionSql(
        "club_receipt",
        "club_revision",
      )})
      AND (SELECT ${cmsClubReceiptProjectionMatchesRevisionSql(
        "club_receipt",
        "club_revision",
      )})
      AND ${alias}.publication_status = club_state.workflow_status
      AND ${alias}.published_at IS NOT NULL
      AND ${alias}.deleted_at IS NULL
      AND json_type(club_receipt.projection_json, '$.club') = 'object'
      AND json_type(club_receipt.projection_json, '$.profile') = 'object'
      AND materialized_club.name =
          json_extract(club_receipt.projection_json, '$.club.name')
      AND materialized_club.slug =
          json_extract(club_receipt.projection_json, '$.club.slug')
      AND materialized_club.description IS
          json_extract(club_receipt.projection_json, '$.club.description')
      AND ${alias}.primary_event_lane_id =
          json_extract(club_receipt.projection_json, '$.profile.laneId')
      AND ${alias}.is_featured =
          json_extract(club_receipt.projection_json, '$.profile.featured')
      AND ${alias}.description IS
          json_extract(club_receipt.projection_json, '$.profile.summary')
      AND ${alias}.public_group_url IS
          json_extract(
            club_receipt.projection_json,
            '$.profile.meetupGroupUrl'
          )
      AND (
        (
          json_type(club_receipt.projection_json, '$.details') = 'null'
          AND club_details.club_id IS NULL
        )
        OR (
          json_type(club_receipt.projection_json, '$.details') = 'object'
      AND club_details.public_display_name =
          json_extract(
            club_receipt.projection_json,
            '$.details.publicDisplayName'
          )
      AND club_details.short_summary =
          json_extract(
            club_receipt.projection_json,
            '$.details.shortSummary'
          )
      AND club_details.full_description =
          json_extract(
            club_receipt.projection_json,
            '$.details.fullDescription'
          )
      AND club_details.program_type =
          json_extract(
            club_receipt.projection_json,
            '$.details.programType'
          )
      AND club_details.cover_media_asset_id IS
          json_extract(
            club_receipt.projection_json,
            '$.details.coverAssetId'
          )
      AND club_details.thumbnail_media_asset_id IS
          json_extract(
            club_receipt.projection_json,
            '$.details.thumbnailAssetId'
          )
      AND club_details.image_alt_text IS
          json_extract(
            club_receipt.projection_json,
            '$.details.imageAltText'
          )
      AND club_details.theme_color IS
          json_extract(
            club_receipt.projection_json,
            '$.details.themeColor'
          )
      AND club_details.participant_expectations IS
          json_extract(
            club_receipt.projection_json,
            '$.details.participantExpectations'
          )
      AND club_details.preparation_information IS
          json_extract(
            club_receipt.projection_json,
            '$.details.preparationInformation'
          )
      AND club_details.typical_format IS
          json_extract(
            club_receipt.projection_json,
            '$.details.typicalFormat'
          )
      AND club_details.confirmed_social_links_json =
          json(
            json_extract(
              club_receipt.projection_json,
              '$.details.confirmedSocialLinks'
            )
          )
      AND club_details.related_resources_json =
          json(
            json_extract(
              club_receipt.projection_json,
              '$.details.relatedResources'
            )
          )
      AND club_details.seo_title IS
          json_extract(club_receipt.projection_json, '$.details.seoTitle')
      AND club_details.meta_description IS
          json_extract(
            club_receipt.projection_json,
            '$.details.metaDescription'
          )
      AND club_details.og_media_asset_id IS
          json_extract(
            club_receipt.projection_json,
            '$.details.openGraphAssetId'
          )
        )
      )
      AND NOT (SELECT ${protectedLegalClaimSql([
        "club_receipt.projection_json",
      ])})
      AND NOT (SELECT ${publicOrganizerEmailExposureSql(
        ["club_receipt.projection_json"],
        `${alias}.organization_id`,
      )})
    )
  )`;
}

/**
 * Exact-current proof for the public Program sidecar. Callers choose one
 * compile-time alias; no request value is interpolated. The immutable receipt
 * binds the current published revision, while every materialized allowlisted
 * field must still equal the receipt. A crafted direct sidecar edit therefore
 * suppresses the Program rather than leaking it.
 */
export function publicProgramProjectionParitySql(
  alias: ProgramProjectionAlias,
): string {
  return `(
    ${cmsProjectionAdoptionPendingSql(
      `${alias}.organization_id`,
      "program_public_profile",
      `${alias}.program_id`,
    )}
    OR EXISTS (
    SELECT 1
    FROM cms_entity_publication_states AS program_state
    JOIN cms_entity_revisions AS program_revision
      ON program_revision.id = program_state.published_revision_id
     AND program_revision.organization_id =
         program_state.organization_id
     AND program_revision.publication_state_id = program_state.id
     AND program_revision.entity_type = 'program_public_profile'
     AND program_revision.entity_key = ${alias}.program_id
    JOIN cms_public_materialization_receipts AS program_receipt
      ON program_receipt.organization_id =
         program_state.organization_id
     AND program_receipt.publication_state_id = program_state.id
     AND program_receipt.entity_type = program_state.entity_type
     AND program_receipt.entity_key = program_state.entity_key
     AND program_receipt.revision_id = program_revision.id
     AND program_receipt.revision_hash = program_revision.content_hash
    WHERE program_state.organization_id = ${alias}.organization_id
      AND program_state.entity_type = 'program_public_profile'
      AND program_state.entity_key = ${alias}.program_id
      AND program_state.workflow_status = ${alias}.publication_status
      AND program_state.workflow_status IN ('published', 'archived')
      AND program_state.published_revision_id IS NOT NULL
      AND (SELECT ${cmsReceiptEnvelopeMatchesRevisionSql(
        "program_receipt",
        "program_revision",
      )})
      AND (SELECT ${cmsProgramReceiptProjectionMatchesRevisionSql(
        "program_receipt",
        "program_revision",
      )})
      AND ${alias}.published_at IS NOT NULL
      AND ${alias}.deleted_at IS NULL
      AND json_type(program_receipt.projection_json, '$.details') = 'object'
      AND ${alias}.club_id =
          json_extract(
            program_receipt.projection_json,
            '$.details.clubId'
          )
      AND ${alias}.primary_event_lane_id =
          json_extract(
            program_receipt.projection_json,
            '$.details.laneId'
          )
      AND ${alias}.public_display_name =
          json_extract(
            program_receipt.projection_json,
            '$.details.name'
          )
      AND ${alias}.public_slug =
          json_extract(
            program_receipt.projection_json,
            '$.details.slug'
          )
      AND ${alias}.short_summary =
          json_extract(
            program_receipt.projection_json,
            '$.details.summary'
          )
      AND ${alias}.full_description =
          json_extract(
            program_receipt.projection_json,
            '$.details.fullDescription'
          )
      AND ${alias}.program_type =
          json_extract(
            program_receipt.projection_json,
            '$.details.programType'
          )
      AND ${alias}.public_group_url IS
          json_extract(
            program_receipt.projection_json,
            '$.details.meetupGroupUrl'
          )
      AND ${alias}.cover_media_asset_id IS
          json_extract(
            program_receipt.projection_json,
            '$.details.coverAssetId'
          )
      AND ${alias}.thumbnail_media_asset_id IS
          json_extract(
            program_receipt.projection_json,
            '$.details.thumbnailAssetId'
          )
      AND ${alias}.theme_color IS
          json_extract(
            program_receipt.projection_json,
            '$.details.themeColor'
          )
      AND ${alias}.participant_expectations IS
          json_extract(
            program_receipt.projection_json,
            '$.details.participantExpectations'
          )
      AND ${alias}.preparation_information IS
          json_extract(
            program_receipt.projection_json,
            '$.details.preparationInformation'
          )
      AND ${alias}.typical_format IS
          json_extract(
            program_receipt.projection_json,
            '$.details.typicalFormat'
          )
      AND ${alias}.is_featured =
          json_extract(
            program_receipt.projection_json,
            '$.details.featured'
          )
      AND ${alias}.display_order =
          json_extract(
            program_receipt.projection_json,
            '$.details.displayOrder'
          )
      AND ${alias}.confirmed_social_links_json =
          json(
            json_extract(
              program_receipt.projection_json,
              '$.details.confirmedSocialLinks'
            )
          )
      AND ${alias}.related_resources_json =
          json(
            json_extract(
              program_receipt.projection_json,
              '$.details.relatedResources'
            )
          )
      AND ${alias}.seo_title IS
          json_extract(
            program_receipt.projection_json,
            '$.details.seoTitle'
          )
      AND ${alias}.meta_description IS
          json_extract(
            program_receipt.projection_json,
            '$.details.metaDescription'
          )
      AND ${alias}.og_media_asset_id IS
          json_extract(
            program_receipt.projection_json,
            '$.details.openGraphAssetId'
          )
      AND NOT (SELECT ${protectedLegalClaimSql([
        "program_receipt.projection_json",
      ])})
      AND NOT (SELECT ${publicOrganizerEmailExposureSql(
        ["program_receipt.projection_json"],
        `${alias}.organization_id`,
      )})
    )
  )`;
}

/**
 * D1-compatible exact Club proof. Each proof dimension is projected as a
 * separate scalar expression so SQLite does not build one >100-deep AND tree.
 * The final predicate still requires every dimension simultaneously.
 */
export function publicClubProjectionParityD1Sql(
  alias: ClubProjectionAlias,
): string {
  return `(
    ${cmsProjectionAdoptionPendingSql(
      `${alias}.organization_id`,
      "club_public_profile",
      `${alias}.club_id`,
    )}
    OR EXISTS (
    SELECT 1
    FROM (
      SELECT
        ${cmsReceiptEnvelopeMatchesRevisionSql(
          "club_receipt",
          "club_revision",
        )} AS envelope_matches,
        ${cmsClubReceiptProjectionMatchesRevisionSql(
          "club_receipt",
          "club_revision",
        )} AS revision_matches,
        (
          ${alias}.publication_status = club_state.workflow_status
          AND ${alias}.published_at IS NOT NULL
          AND ${alias}.deleted_at IS NULL
          AND json_type(
                club_receipt.projection_json,
                '$.club'
              ) = 'object'
          AND json_type(
                club_receipt.projection_json,
                '$.profile'
              ) = 'object'
          AND materialized_club.name =
              json_extract(
                club_receipt.projection_json,
                '$.club.name'
              )
          AND materialized_club.slug =
              json_extract(
                club_receipt.projection_json,
                '$.club.slug'
              )
          AND materialized_club.description IS
              json_extract(
                club_receipt.projection_json,
                '$.club.description'
              )
          AND ${alias}.primary_event_lane_id =
              json_extract(
                club_receipt.projection_json,
                '$.profile.laneId'
              )
          AND ${alias}.is_featured =
              json_extract(
                club_receipt.projection_json,
                '$.profile.featured'
              )
          AND ${alias}.description IS
              json_extract(
                club_receipt.projection_json,
                '$.profile.summary'
              )
          AND ${alias}.public_group_url IS
              json_extract(
                club_receipt.projection_json,
                '$.profile.meetupGroupUrl'
              )
        ) AS profile_matches,
        (
          (
            json_type(
              club_receipt.projection_json,
              '$.details'
            ) = 'null'
            AND club_details.club_id IS NULL
          )
          OR (
            json_type(
              club_receipt.projection_json,
              '$.details'
            ) = 'object'
            AND club_details.public_display_name =
                json_extract(
                  club_receipt.projection_json,
                  '$.details.publicDisplayName'
                )
            AND club_details.short_summary =
                json_extract(
                  club_receipt.projection_json,
                  '$.details.shortSummary'
                )
            AND club_details.full_description =
                json_extract(
                  club_receipt.projection_json,
                  '$.details.fullDescription'
                )
            AND club_details.program_type =
                json_extract(
                  club_receipt.projection_json,
                  '$.details.programType'
                )
            AND club_details.cover_media_asset_id IS
                json_extract(
                  club_receipt.projection_json,
                  '$.details.coverAssetId'
                )
            AND club_details.thumbnail_media_asset_id IS
                json_extract(
                  club_receipt.projection_json,
                  '$.details.thumbnailAssetId'
                )
            AND club_details.image_alt_text IS
                json_extract(
                  club_receipt.projection_json,
                  '$.details.imageAltText'
                )
            AND club_details.theme_color IS
                json_extract(
                  club_receipt.projection_json,
                  '$.details.themeColor'
                )
            AND club_details.participant_expectations IS
                json_extract(
                  club_receipt.projection_json,
                  '$.details.participantExpectations'
                )
            AND club_details.preparation_information IS
                json_extract(
                  club_receipt.projection_json,
                  '$.details.preparationInformation'
                )
            AND club_details.typical_format IS
                json_extract(
                  club_receipt.projection_json,
                  '$.details.typicalFormat'
                )
            AND club_details.confirmed_social_links_json =
                json(
                  json_extract(
                    club_receipt.projection_json,
                    '$.details.confirmedSocialLinks'
                  )
                )
            AND club_details.related_resources_json =
                json(
                  json_extract(
                    club_receipt.projection_json,
                    '$.details.relatedResources'
                  )
                )
            AND club_details.seo_title IS
                json_extract(
                  club_receipt.projection_json,
                  '$.details.seoTitle'
                )
            AND club_details.meta_description IS
                json_extract(
                  club_receipt.projection_json,
                  '$.details.metaDescription'
                )
            AND club_details.og_media_asset_id IS
                json_extract(
                  club_receipt.projection_json,
                  '$.details.openGraphAssetId'
                )
          )
        ) AS detail_matches,
        NOT (${protectedLegalClaimSql([
          "club_receipt.projection_json",
        ])}) AS legal_safe,
        NOT (${publicOrganizerEmailExposureSql(
          ["club_receipt.projection_json"],
          `${alias}.organization_id`,
        )}) AS identity_safe
      FROM cms_entity_publication_states AS club_state
      JOIN cms_entity_revisions AS club_revision
        ON club_revision.id = club_state.published_revision_id
       AND club_revision.organization_id =
           club_state.organization_id
       AND club_revision.publication_state_id = club_state.id
       AND club_revision.entity_type = 'club_public_profile'
       AND club_revision.entity_key = ${alias}.club_id
      JOIN cms_public_materialization_receipts AS club_receipt
        ON club_receipt.organization_id = club_state.organization_id
       AND club_receipt.publication_state_id = club_state.id
       AND club_receipt.entity_type = club_state.entity_type
       AND club_receipt.entity_key = club_state.entity_key
       AND club_receipt.revision_id = club_revision.id
       AND club_receipt.revision_hash = club_revision.content_hash
      JOIN clubs AS materialized_club
        ON materialized_club.id = ${alias}.club_id
       AND materialized_club.organization_id =
           ${alias}.organization_id
       AND materialized_club.deleted_at IS NULL
      LEFT JOIN club_public_profile_details AS club_details
        ON club_details.club_id = ${alias}.club_id
       AND club_details.organization_id = ${alias}.organization_id
      WHERE club_state.organization_id = ${alias}.organization_id
        AND club_state.entity_type = 'club_public_profile'
        AND club_state.entity_key = ${alias}.club_id
        AND club_state.workflow_status IN ('published', 'archived')
        AND club_state.published_revision_id IS NOT NULL
    ) AS club_proof
    WHERE club_proof.envelope_matches = 1
      AND club_proof.revision_matches = 1
      AND club_proof.profile_matches = 1
      AND club_proof.detail_matches = 1
      AND club_proof.legal_safe = 1
      AND club_proof.identity_safe = 1
    )
  )`;
}

/**
 * D1-compatible Program counterpart to the Club proof above.
 */
export function publicProgramProjectionParityD1Sql(
  alias: ProgramProjectionAlias,
): string {
  return `(
    ${cmsProjectionAdoptionPendingSql(
      `${alias}.organization_id`,
      "program_public_profile",
      `${alias}.program_id`,
    )}
    OR EXISTS (
    SELECT 1
    FROM (
      SELECT
        ${cmsReceiptEnvelopeMatchesRevisionSql(
          "program_receipt",
          "program_revision",
        )} AS envelope_matches,
        ${cmsProgramReceiptProjectionMatchesRevisionSql(
          "program_receipt",
          "program_revision",
        )} AS revision_matches,
        (
          ${alias}.published_at IS NOT NULL
          AND ${alias}.deleted_at IS NULL
          AND json_type(
                program_receipt.projection_json,
                '$.details'
              ) = 'object'
          AND ${alias}.club_id =
              json_extract(
                program_receipt.projection_json,
                '$.details.clubId'
              )
          AND ${alias}.primary_event_lane_id =
              json_extract(
                program_receipt.projection_json,
                '$.details.laneId'
              )
          AND ${alias}.public_display_name =
              json_extract(
                program_receipt.projection_json,
                '$.details.name'
              )
          AND ${alias}.public_slug =
              json_extract(
                program_receipt.projection_json,
                '$.details.slug'
              )
          AND ${alias}.short_summary =
              json_extract(
                program_receipt.projection_json,
                '$.details.summary'
              )
          AND ${alias}.full_description =
              json_extract(
                program_receipt.projection_json,
                '$.details.fullDescription'
              )
          AND ${alias}.program_type =
              json_extract(
                program_receipt.projection_json,
                '$.details.programType'
              )
          AND ${alias}.public_group_url IS
              json_extract(
                program_receipt.projection_json,
                '$.details.meetupGroupUrl'
              )
          AND ${alias}.cover_media_asset_id IS
              json_extract(
                program_receipt.projection_json,
                '$.details.coverAssetId'
              )
          AND ${alias}.thumbnail_media_asset_id IS
              json_extract(
                program_receipt.projection_json,
                '$.details.thumbnailAssetId'
              )
          AND ${alias}.theme_color IS
              json_extract(
                program_receipt.projection_json,
                '$.details.themeColor'
              )
          AND ${alias}.participant_expectations IS
              json_extract(
                program_receipt.projection_json,
                '$.details.participantExpectations'
              )
          AND ${alias}.preparation_information IS
              json_extract(
                program_receipt.projection_json,
                '$.details.preparationInformation'
              )
          AND ${alias}.typical_format IS
              json_extract(
                program_receipt.projection_json,
                '$.details.typicalFormat'
              )
          AND ${alias}.is_featured =
              json_extract(
                program_receipt.projection_json,
                '$.details.featured'
              )
          AND ${alias}.display_order =
              json_extract(
                program_receipt.projection_json,
                '$.details.displayOrder'
              )
          AND ${alias}.confirmed_social_links_json =
              json(
                json_extract(
                  program_receipt.projection_json,
                  '$.details.confirmedSocialLinks'
                )
              )
          AND ${alias}.related_resources_json =
              json(
                json_extract(
                  program_receipt.projection_json,
                  '$.details.relatedResources'
                )
              )
          AND ${alias}.seo_title IS
              json_extract(
                program_receipt.projection_json,
                '$.details.seoTitle'
              )
          AND ${alias}.meta_description IS
              json_extract(
                program_receipt.projection_json,
                '$.details.metaDescription'
              )
          AND ${alias}.og_media_asset_id IS
              json_extract(
                program_receipt.projection_json,
                '$.details.openGraphAssetId'
              )
        ) AS projection_matches,
        NOT (${protectedLegalClaimSql([
          "program_receipt.projection_json",
        ])}) AS legal_safe,
        NOT (${publicOrganizerEmailExposureSql(
          ["program_receipt.projection_json"],
          `${alias}.organization_id`,
        )}) AS identity_safe
      FROM cms_entity_publication_states AS program_state
      JOIN cms_entity_revisions AS program_revision
        ON program_revision.id = program_state.published_revision_id
       AND program_revision.organization_id =
           program_state.organization_id
       AND program_revision.publication_state_id = program_state.id
       AND program_revision.entity_type = 'program_public_profile'
       AND program_revision.entity_key = ${alias}.program_id
      JOIN cms_public_materialization_receipts AS program_receipt
        ON program_receipt.organization_id =
           program_state.organization_id
       AND program_receipt.publication_state_id = program_state.id
       AND program_receipt.entity_type = program_state.entity_type
       AND program_receipt.entity_key = program_state.entity_key
       AND program_receipt.revision_id = program_revision.id
       AND program_receipt.revision_hash = program_revision.content_hash
      WHERE program_state.organization_id = ${alias}.organization_id
        AND program_state.entity_type = 'program_public_profile'
        AND program_state.entity_key = ${alias}.program_id
        AND program_state.workflow_status = ${alias}.publication_status
        AND program_state.workflow_status IN ('published', 'archived')
        AND program_state.published_revision_id IS NOT NULL
    ) AS program_proof
    WHERE program_proof.envelope_matches = 1
      AND program_proof.revision_matches = 1
      AND program_proof.projection_matches = 1
      AND program_proof.legal_safe = 1
      AND program_proof.identity_safe = 1
    )
  )`;
}
