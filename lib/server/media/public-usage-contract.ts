/**
 * One pure SQL contract determines whether a media usage belongs to the exact
 * current public projection. Runtime triggers, integrity probes, and anonymous
 * byte serving import this builder so the public authorization branches cannot
 * drift apart.
 */

export function mediaUsageRequiresUsefulAltSql(
  usageAlias: string,
): string {
  return String.raw`(
    ${usageAlias}.usage_kind IN (
      'event_artwork', 'profile_photo', 'open_graph', 'cover', 'thumbnail'
    )
  )`;
}

export function currentPublishedOrganizerProfilePhotoUsageTargetSql(
  usageAlias: string,
): string {
  return String.raw`(
    ${usageAlias}.entity_type = 'organizer_profile'
    AND ${usageAlias}.usage_kind = 'profile_photo'
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
       AND receipt.actor_profile_id = attribution.profile_id
       AND receipt.consent = 1
       AND receipt.display_name = attribution.public_display_name
       AND receipt.biography IS attribution.public_biography
       AND receipt.photo_media_asset_id =
           attribution.public_photo_media_asset_id
      JOIN organizer_public_attribution_write_intents AS intent
        ON intent.id = receipt.write_intent_id
       AND intent.organization_id = attribution.organization_id
       AND intent.profile_id = attribution.profile_id
       AND intent.actor_profile_id = attribution.profile_id
       AND intent.operation = receipt.action
       AND intent.proposed_published_version =
           receipt.attribution_version
       AND intent.snapshot_hash = receipt.snapshot_hash
       AND intent.completed_at IS NOT NULL
      JOIN profiles AS profile
        ON profile.id = attribution.profile_id
       AND profile.status = 'active'
       AND profile.deleted_at IS NULL
       AND profile.public_attribution_consent = 1
       AND profile.display_name = attribution.public_display_name
      JOIN organization_memberships AS membership
        ON membership.organization_id = attribution.organization_id
       AND membership.profile_id = attribution.profile_id
       AND membership.status = 'active'
       AND membership.deleted_at IS NULL
      WHERE attribution.profile_id = ${usageAlias}.entity_id
        AND attribution.organization_id = ${usageAlias}.organization_id
        AND attribution.workflow_status = 'confirmed'
        AND attribution.current_receipt_id = ${usageAlias}.revision_id
        AND attribution.public_photo_media_asset_id = ${usageAlias}.asset_id
    )
  )`;
}

export function currentPublishedMediaUsageTargetSql(
  usageAlias: string,
): string {
  return String.raw`(
    (
      ${usageAlias}.entity_type = 'page'
      AND EXISTS (
        SELECT 1
        FROM cms_entity_publication_states AS state
        JOIN cms_entity_revisions AS revision
          ON revision.id = state.published_revision_id
         AND revision.organization_id = state.organization_id
         AND revision.publication_state_id = state.id
         AND revision.entity_type = 'page'
         AND revision.entity_key = ${usageAlias}.entity_id
        JOIN cms_public_materialization_receipts AS receipt
          ON receipt.organization_id = state.organization_id
         AND receipt.publication_state_id = state.id
         AND receipt.entity_type = state.entity_type
         AND receipt.entity_key = state.entity_key
         AND receipt.revision_id = revision.id
         AND receipt.revision_hash = revision.content_hash
        JOIN pages AS page
          ON page.id = ${usageAlias}.entity_id
         AND page.organization_id = ${usageAlias}.organization_id
         AND page.status = 'published'
         AND page.visibility = 'public'
         AND page.published_at IS NOT NULL
         AND page.current_revision = revision.revision_number
         AND page.deleted_at IS NULL
        WHERE state.organization_id = ${usageAlias}.organization_id
          AND state.entity_type = 'page'
          AND state.entity_key = ${usageAlias}.entity_id
          AND state.workflow_status = 'published'
          AND state.published_revision_id = ${usageAlias}.revision_id
          AND (
            (
              ${usageAlias}.usage_kind = 'open_graph'
              AND json_extract(
                    revision.snapshot_json,
                    '$.openGraphAssetId'
                  ) = ${usageAlias}.asset_id
              AND EXISTS (
                SELECT 1
                FROM page_public_metadata AS metadata
                WHERE metadata.page_id = page.id
                  AND metadata.organization_id = page.organization_id
                  AND metadata.og_media_asset_id =
                      ${usageAlias}.asset_id
              )
              AND json_extract(
                    receipt.projection_json,
                    '$.metadata.openGraphAssetId'
                  ) = ${usageAlias}.asset_id
            )
            OR EXISTS (
              SELECT 1
              FROM json_each(
                revision.snapshot_json,
                '$.blocks'
              ) AS block
              JOIN page_sections AS section
                ON section.page_id = page.id
               AND section.organization_id = page.organization_id
               AND section.section_key =
                   json_extract(block.value, '$.id')
               AND section.section_type = 'media'
               AND section.deleted_at IS NULL
               AND json_extract(
                     section.content_json,
                     '$.assetId'
                   ) = ${usageAlias}.asset_id
              WHERE json_extract(block.value, '$.type') = 'media'
                AND 'block:' ||
                    json_extract(block.value, '$.id') =
                    ${usageAlias}.usage_kind
                AND json_extract(
                      block.value,
                      '$.config.assetId'
                    ) = ${usageAlias}.asset_id
                AND EXISTS (
                  SELECT 1
                  FROM json_each(
                    receipt.projection_json,
                    '$.sections'
                  ) AS receipt_section
                  WHERE json_extract(
                          receipt_section.value,
                          '$.sectionKey'
                        ) =
                        json_extract(block.value, '$.id')
                    AND json_extract(
                          receipt_section.value,
                          '$.sectionType'
                        ) = 'media'
                    AND json_extract(
                          json_extract(
                            receipt_section.value,
                            '$.contentJson'
                          ),
                          '$.assetId'
                        ) = ${usageAlias}.asset_id
                )
            )
          )
      )
    )
    OR (
      ${usageAlias}.entity_type = 'club_public_profile'
      AND EXISTS (
        SELECT 1
        FROM cms_entity_publication_states AS state
        JOIN cms_entity_revisions AS revision
          ON revision.id = state.published_revision_id
         AND revision.organization_id = state.organization_id
         AND revision.publication_state_id = state.id
         AND revision.entity_type = 'club_public_profile'
         AND revision.entity_key = ${usageAlias}.entity_id
        JOIN cms_public_materialization_receipts AS receipt
          ON receipt.organization_id = state.organization_id
         AND receipt.publication_state_id = state.id
         AND receipt.entity_type = state.entity_type
         AND receipt.entity_key = state.entity_key
         AND receipt.revision_id = revision.id
         AND receipt.revision_hash = revision.content_hash
        JOIN club_public_profiles AS profile
          ON profile.club_id = ${usageAlias}.entity_id
         AND profile.organization_id = ${usageAlias}.organization_id
         AND profile.publication_status = state.workflow_status
         AND profile.publication_status IN ('published', 'archived')
         AND profile.published_at IS NOT NULL
         AND profile.deleted_at IS NULL
        JOIN club_public_profile_details AS detail
          ON detail.club_id = profile.club_id
         AND detail.organization_id = profile.organization_id
        WHERE state.organization_id = ${usageAlias}.organization_id
          AND state.entity_type = 'club_public_profile'
          AND state.entity_key = ${usageAlias}.entity_id
          AND state.workflow_status IN ('published', 'archived')
          AND state.published_revision_id = ${usageAlias}.revision_id
          AND (
            (
              ${usageAlias}.usage_kind = 'cover'
              AND json_extract(
                    revision.snapshot_json,
                    '$.coverAssetId'
                  ) = ${usageAlias}.asset_id
              AND detail.cover_media_asset_id = ${usageAlias}.asset_id
              AND json_extract(
                    receipt.projection_json,
                    '$.details.coverAssetId'
                  ) = ${usageAlias}.asset_id
            )
            OR (
              ${usageAlias}.usage_kind = 'thumbnail'
              AND json_extract(
                    revision.snapshot_json,
                    '$.thumbnailAssetId'
                  ) = ${usageAlias}.asset_id
              AND detail.thumbnail_media_asset_id =
                  ${usageAlias}.asset_id
              AND json_extract(
                    receipt.projection_json,
                    '$.details.thumbnailAssetId'
                  ) = ${usageAlias}.asset_id
            )
            OR (
              ${usageAlias}.usage_kind = 'open_graph'
              AND json_extract(
                    revision.snapshot_json,
                    '$.openGraphAssetId'
                  ) = ${usageAlias}.asset_id
              AND detail.og_media_asset_id = ${usageAlias}.asset_id
              AND json_extract(
                    receipt.projection_json,
                    '$.details.openGraphAssetId'
                  ) = ${usageAlias}.asset_id
            )
          )
      )
    )
    OR (
      ${usageAlias}.entity_type = 'program_public_profile'
      AND EXISTS (
        SELECT 1
        FROM cms_entity_publication_states AS state
        JOIN cms_entity_revisions AS revision
          ON revision.id = state.published_revision_id
         AND revision.organization_id = state.organization_id
         AND revision.publication_state_id = state.id
         AND revision.entity_type = 'program_public_profile'
         AND revision.entity_key = ${usageAlias}.entity_id
        JOIN cms_public_materialization_receipts AS receipt
          ON receipt.organization_id = state.organization_id
         AND receipt.publication_state_id = state.id
         AND receipt.entity_type = state.entity_type
         AND receipt.entity_key = state.entity_key
         AND receipt.revision_id = revision.id
         AND receipt.revision_hash = revision.content_hash
        JOIN program_public_profile_details AS detail
          ON detail.program_id = ${usageAlias}.entity_id
         AND detail.organization_id = ${usageAlias}.organization_id
         AND detail.publication_status = state.workflow_status
         AND detail.publication_status IN ('published', 'archived')
         AND detail.published_at IS NOT NULL
         AND detail.deleted_at IS NULL
        WHERE state.organization_id = ${usageAlias}.organization_id
          AND state.entity_type = 'program_public_profile'
          AND state.entity_key = ${usageAlias}.entity_id
          AND state.workflow_status IN ('published', 'archived')
          AND state.published_revision_id = ${usageAlias}.revision_id
          AND (
            (
              ${usageAlias}.usage_kind = 'cover'
              AND json_extract(
                    revision.snapshot_json,
                    '$.coverAssetId'
                  ) = ${usageAlias}.asset_id
              AND detail.cover_media_asset_id = ${usageAlias}.asset_id
              AND json_extract(
                    receipt.projection_json,
                    '$.details.coverAssetId'
                  ) = ${usageAlias}.asset_id
            )
            OR (
              ${usageAlias}.usage_kind = 'thumbnail'
              AND json_extract(
                    revision.snapshot_json,
                    '$.thumbnailAssetId'
                  ) = ${usageAlias}.asset_id
              AND detail.thumbnail_media_asset_id =
                  ${usageAlias}.asset_id
              AND json_extract(
                    receipt.projection_json,
                    '$.details.thumbnailAssetId'
                  ) = ${usageAlias}.asset_id
            )
            OR (
              ${usageAlias}.usage_kind = 'open_graph'
              AND json_extract(
                    revision.snapshot_json,
                    '$.openGraphAssetId'
                  ) = ${usageAlias}.asset_id
              AND detail.og_media_asset_id = ${usageAlias}.asset_id
              AND json_extract(
                    receipt.projection_json,
                    '$.details.openGraphAssetId'
                  ) = ${usageAlias}.asset_id
            )
          )
      )
    )
    OR (
      ${usageAlias}.entity_type = 'organizer_event'
      AND ${usageAlias}.usage_kind = 'event_artwork'
      AND EXISTS (
        SELECT 1
        FROM organizer_events AS event
        JOIN organizer_event_revisions AS revision
          ON revision.id = ${usageAlias}.revision_id
         AND revision.organization_id = event.organization_id
         AND revision.organizer_event_id = event.id
         AND json_extract(revision.snapshot_json, '$.artworkAssetId') =
             ${usageAlias}.asset_id
        JOIN organizer_event_publication_state AS publication_state
          ON publication_state.organization_id = event.organization_id
         AND publication_state.organizer_event_id = event.id
         AND publication_state.first_published_at IS NOT NULL
         AND publication_state.most_recent_published_at IS NOT NULL
         AND (
           publication_state.most_recent_unpublished_at IS NULL
           OR publication_state.most_recent_published_at >=
              publication_state.most_recent_unpublished_at
         )
        WHERE event.id = ${usageAlias}.entity_id
          AND event.organization_id = ${usageAlias}.organization_id
          AND event.publication_status = 'published'
          AND event.planning_status IN ('confirmed', 'cancelled', 'completed')
          AND event.deleted_at IS NULL
          AND revision.content_version = (
            SELECT max(candidate.content_version)
            FROM organizer_event_revisions AS candidate
            WHERE candidate.organization_id = event.organization_id
              AND candidate.organizer_event_id = event.id
              AND json_type(
                    candidate.snapshot_json,
                    '$.artworkAssetId'
                  ) IN ('text', 'null')
          )
      )
    )
    OR ${currentPublishedOrganizerProfilePhotoUsageTargetSql(usageAlias)}
    OR (
      ${usageAlias}.entity_type IN ('site_logo', 'site_og')
      AND ${usageAlias}.entity_id = ${usageAlias}.organization_id
      AND EXISTS (
        SELECT 1
        FROM cms_entity_publication_states AS state
        JOIN cms_entity_revisions AS revision
          ON revision.id = state.published_revision_id
         AND revision.organization_id = state.organization_id
         AND revision.publication_state_id = state.id
         AND revision.entity_type = 'site_identity'
         AND revision.entity_key = 'site_identity'
        JOIN cms_public_materialization_receipts AS receipt
          ON receipt.organization_id = state.organization_id
         AND receipt.publication_state_id = state.id
         AND receipt.entity_type = state.entity_type
         AND receipt.entity_key = state.entity_key
         AND receipt.revision_id = revision.id
         AND receipt.revision_hash = revision.content_hash
        JOIN site_settings AS setting
          ON setting.organization_id = state.organization_id
         AND setting.key = 'public_identity'
         AND setting.is_public = 1
        WHERE state.organization_id = ${usageAlias}.organization_id
          AND state.entity_type = 'site_identity'
          AND state.entity_key = 'site_identity'
          AND state.workflow_status = 'published'
          AND state.published_revision_id = ${usageAlias}.revision_id
          AND setting.value_json = revision.snapshot_json
          AND (
            (
              ${usageAlias}.entity_type = 'site_logo'
              AND ${usageAlias}.usage_kind = 'logo'
              AND json_extract(
                    revision.snapshot_json,
                    '$.logoAssetId'
                  ) = ${usageAlias}.asset_id
              AND json_extract(
                    json_extract(
                      receipt.projection_json,
                      '$.setting.valueJson'
                    ),
                    '$.logoAssetId'
                  ) = ${usageAlias}.asset_id
            )
            OR (
              ${usageAlias}.entity_type = 'site_og'
              AND ${usageAlias}.usage_kind = 'open_graph'
              AND json_extract(
                    revision.snapshot_json,
                    '$.openGraphAssetId'
                  ) = ${usageAlias}.asset_id
              AND json_extract(
                    json_extract(
                      receipt.projection_json,
                      '$.setting.valueJson'
                    ),
                    '$.openGraphAssetId'
                  ) = ${usageAlias}.asset_id
            )
          )
      )
    )
  )`;
}

/**
 * A current public projection must not merely validate any usage rows that
 * happen to exist. Every selected public media slot must also have its exact
 * entity/revision/kind usage row, so an asset authorized elsewhere cannot make
 * a detached selection renderable.
 */
export function missingCurrentPublishedMediaUsageCountSql(): string {
  return String.raw`
WITH expected_public_media AS (
  SELECT state.organization_id,
         'page' AS entity_type,
         state.entity_key AS entity_id,
         state.published_revision_id AS revision_id,
         'open_graph' AS usage_kind,
         json_extract(
           receipt.projection_json,
           '$.metadata.openGraphAssetId'
         ) AS asset_id
  FROM cms_entity_publication_states AS state
  JOIN cms_entity_revisions AS revision
    ON revision.id = state.published_revision_id
   AND revision.organization_id = state.organization_id
   AND revision.publication_state_id = state.id
   AND revision.entity_type = 'page'
   AND revision.entity_key = state.entity_key
  JOIN cms_public_materialization_receipts AS receipt
    ON receipt.organization_id = state.organization_id
   AND receipt.publication_state_id = state.id
   AND receipt.entity_type = state.entity_type
   AND receipt.entity_key = state.entity_key
   AND receipt.revision_id = revision.id
   AND receipt.revision_hash = revision.content_hash
  WHERE state.entity_type = 'page'
    AND state.workflow_status = 'published'

  UNION ALL

  SELECT state.organization_id,
         'page',
         state.entity_key,
         state.published_revision_id,
         'block:' ||
           json_extract(section.value, '$.sectionKey'),
         json_extract(
           json_extract(section.value, '$.contentJson'),
           '$.assetId'
         )
  FROM cms_entity_publication_states AS state
  JOIN cms_entity_revisions AS revision
    ON revision.id = state.published_revision_id
   AND revision.organization_id = state.organization_id
   AND revision.publication_state_id = state.id
   AND revision.entity_type = 'page'
   AND revision.entity_key = state.entity_key
  JOIN cms_public_materialization_receipts AS receipt
    ON receipt.organization_id = state.organization_id
   AND receipt.publication_state_id = state.id
   AND receipt.entity_type = state.entity_type
   AND receipt.entity_key = state.entity_key
   AND receipt.revision_id = revision.id
   AND receipt.revision_hash = revision.content_hash
  JOIN json_each(receipt.projection_json, '$.sections') AS section
  WHERE state.entity_type = 'page'
    AND state.workflow_status = 'published'
    AND json_extract(section.value, '$.sectionType') = 'media'

  UNION ALL

  SELECT state.organization_id,
         'club_public_profile',
         state.entity_key,
         state.published_revision_id,
         json_extract(media_slot.value, '$.usageKind'),
         json_extract(media_slot.value, '$.assetId')
  FROM cms_entity_publication_states AS state
  JOIN cms_entity_revisions AS revision
    ON revision.id = state.published_revision_id
   AND revision.organization_id = state.organization_id
   AND revision.publication_state_id = state.id
   AND revision.entity_type = 'club_public_profile'
   AND revision.entity_key = state.entity_key
  JOIN cms_public_materialization_receipts AS receipt
    ON receipt.organization_id = state.organization_id
   AND receipt.publication_state_id = state.id
   AND receipt.entity_type = state.entity_type
   AND receipt.entity_key = state.entity_key
   AND receipt.revision_id = revision.id
   AND receipt.revision_hash = revision.content_hash
  JOIN json_each(
    json_array(
      json_object(
        'usageKind', 'cover',
        'assetId',
        json_extract(receipt.projection_json, '$.details.coverAssetId')
      ),
      json_object(
        'usageKind', 'thumbnail',
        'assetId',
        json_extract(receipt.projection_json, '$.details.thumbnailAssetId')
      ),
      json_object(
        'usageKind', 'open_graph',
        'assetId',
        json_extract(receipt.projection_json, '$.details.openGraphAssetId')
      )
    )
  ) AS media_slot
  WHERE state.entity_type = 'club_public_profile'
    AND state.workflow_status IN ('published', 'archived')

  UNION ALL

  SELECT state.organization_id,
         'program_public_profile',
         state.entity_key,
         state.published_revision_id,
         json_extract(media_slot.value, '$.usageKind'),
         json_extract(media_slot.value, '$.assetId')
  FROM cms_entity_publication_states AS state
  JOIN cms_entity_revisions AS revision
    ON revision.id = state.published_revision_id
   AND revision.organization_id = state.organization_id
   AND revision.publication_state_id = state.id
   AND revision.entity_type = 'program_public_profile'
   AND revision.entity_key = state.entity_key
  JOIN cms_public_materialization_receipts AS receipt
    ON receipt.organization_id = state.organization_id
   AND receipt.publication_state_id = state.id
   AND receipt.entity_type = state.entity_type
   AND receipt.entity_key = state.entity_key
   AND receipt.revision_id = revision.id
   AND receipt.revision_hash = revision.content_hash
  JOIN json_each(
    json_array(
      json_object(
        'usageKind', 'cover',
        'assetId',
        json_extract(receipt.projection_json, '$.details.coverAssetId')
      ),
      json_object(
        'usageKind', 'thumbnail',
        'assetId',
        json_extract(receipt.projection_json, '$.details.thumbnailAssetId')
      ),
      json_object(
        'usageKind', 'open_graph',
        'assetId',
        json_extract(receipt.projection_json, '$.details.openGraphAssetId')
      )
    )
  ) AS media_slot
  WHERE state.entity_type = 'program_public_profile'
    AND state.workflow_status IN ('published', 'archived')

  UNION ALL

  SELECT state.organization_id,
         json_extract(media_slot.value, '$.entityType'),
         state.organization_id,
         state.published_revision_id,
         json_extract(media_slot.value, '$.usageKind'),
         json_extract(media_slot.value, '$.assetId')
  FROM cms_entity_publication_states AS state
  JOIN cms_entity_revisions AS revision
    ON revision.id = state.published_revision_id
   AND revision.organization_id = state.organization_id
   AND revision.publication_state_id = state.id
   AND revision.entity_type = 'site_identity'
   AND revision.entity_key = 'site_identity'
  JOIN cms_public_materialization_receipts AS receipt
    ON receipt.organization_id = state.organization_id
   AND receipt.publication_state_id = state.id
   AND receipt.entity_type = state.entity_type
   AND receipt.entity_key = state.entity_key
   AND receipt.revision_id = revision.id
   AND receipt.revision_hash = revision.content_hash
  JOIN json_each(
    json_array(
      json_object(
        'entityType', 'site_logo',
        'usageKind', 'logo',
        'assetId',
        json_extract(
          json_extract(receipt.projection_json, '$.setting.valueJson'),
          '$.logoAssetId'
        )
      ),
      json_object(
        'entityType', 'site_og',
        'usageKind', 'open_graph',
        'assetId',
        json_extract(
          json_extract(receipt.projection_json, '$.setting.valueJson'),
          '$.openGraphAssetId'
        )
      )
    )
  ) AS media_slot
  WHERE state.entity_type = 'site_identity'
    AND state.entity_key = 'site_identity'
    AND state.workflow_status = 'published'

  UNION ALL

  SELECT event.organization_id,
         'organizer_event',
         event.id,
         revision.id,
         'event_artwork',
         json_extract(revision.snapshot_json, '$.artworkAssetId')
  FROM organizer_events AS event
  JOIN organizer_event_publication_state AS publication_state
    ON publication_state.organization_id = event.organization_id
   AND publication_state.organizer_event_id = event.id
   AND publication_state.first_published_at IS NOT NULL
   AND publication_state.most_recent_published_at IS NOT NULL
   AND (
     publication_state.most_recent_unpublished_at IS NULL
     OR publication_state.most_recent_published_at >=
        publication_state.most_recent_unpublished_at
   )
  JOIN organizer_event_revisions AS revision
    ON revision.organization_id = event.organization_id
   AND revision.organizer_event_id = event.id
   AND revision.content_version = (
     SELECT max(candidate.content_version)
     FROM organizer_event_revisions AS candidate
     WHERE candidate.organization_id = event.organization_id
       AND candidate.organizer_event_id = event.id
       AND json_type(
             candidate.snapshot_json,
             '$.artworkAssetId'
           ) IN ('text', 'null')
   )
  WHERE event.publication_status = 'published'
    AND event.planning_status IN ('confirmed', 'cancelled', 'completed')
    AND event.deleted_at IS NULL

  UNION ALL

  SELECT attribution.organization_id,
         'organizer_profile',
         attribution.profile_id,
         attribution.current_receipt_id,
         'profile_photo',
         attribution.public_photo_media_asset_id
  FROM organizer_public_attribution_states AS attribution
  JOIN organizer_public_attribution_receipts AS receipt
    ON receipt.id = attribution.current_receipt_id
   AND receipt.organization_id = attribution.organization_id
   AND receipt.profile_id = attribution.profile_id
   AND receipt.action IN ('adopted', 'confirmed')
   AND receipt.attribution_version =
       attribution.published_attribution_version
   AND receipt.actor_profile_id = attribution.profile_id
   AND receipt.consent = 1
   AND receipt.display_name = attribution.public_display_name
   AND receipt.biography IS attribution.public_biography
   AND receipt.photo_media_asset_id =
       attribution.public_photo_media_asset_id
  JOIN organizer_public_attribution_write_intents AS intent
    ON intent.id = receipt.write_intent_id
   AND intent.organization_id = attribution.organization_id
   AND intent.profile_id = attribution.profile_id
   AND intent.operation = receipt.action
   AND intent.proposed_published_version =
       receipt.attribution_version
   AND intent.snapshot_hash = receipt.snapshot_hash
   AND intent.completed_at IS NOT NULL
  JOIN profiles AS profile
    ON profile.id = attribution.profile_id
   AND profile.status = 'active'
   AND profile.deleted_at IS NULL
   AND profile.public_attribution_consent = 1
   AND profile.display_name = attribution.public_display_name
  JOIN organization_memberships AS membership
    ON membership.organization_id = attribution.organization_id
   AND membership.profile_id = attribution.profile_id
   AND membership.status = 'active'
   AND membership.deleted_at IS NULL
  WHERE attribution.workflow_status = 'confirmed'
    AND attribution.public_photo_media_asset_id IS NOT NULL
)
SELECT count(*) AS violation_count
FROM expected_public_media AS expected
WHERE typeof(expected.asset_id) = 'text'
  AND length(trim(expected.asset_id)) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM media_usage_references AS usage
    WHERE usage.organization_id = expected.organization_id
      AND usage.asset_id = expected.asset_id
      AND usage.entity_type = expected.entity_type
      AND usage.entity_id = expected.entity_id
      AND usage.revision_id = expected.revision_id
      AND usage.usage_kind = expected.usage_kind
      AND usage.publication_scope = 'published'
      AND usage.deleted_at IS NULL
      AND ${currentPublishedMediaUsageTargetSql("usage")}
  )`;
}

/**
 * D1's SQLite build permits fewer compound SELECT terms than local SQLite.
 * The canonical completeness query above remains the single semantic source;
 * this build-time splitter packages its independent expected-media branches
 * into shallow probes that can execute in production.
 */
export function missingCurrentPublishedMediaUsageCountSqlStatements():
  readonly string[] {
  const sql = missingCurrentPublishedMediaUsageCountSql();
  const marker = "WITH expected_public_media AS";
  const markerIndex = sql.indexOf(marker);
  const open = sql.indexOf("(", markerIndex + marker.length);
  if (markerIndex < 0 || open < 0) {
    throw new Error("Malformed current-published media completeness SQL.");
  }
  const close = matchingSqlParenthesis(sql, open);
  const terms = splitTopLevelUnionAll(sql.slice(open + 1, close));
  const tail = sql.slice(close + 1);
  const maximumTermsPerStatement = 3;
  const outputMarker = String.raw`WITH expected_public_media (
    organization_id, entity_type, entity_id, revision_id, usage_kind, asset_id
  ) AS`;
  return Object.freeze(
    Array.from(
      {
        length: Math.ceil(terms.length / maximumTermsPerStatement),
      },
      (_, index) => {
        const chunk = terms.slice(
          index * maximumTermsPerStatement,
          (index + 1) * maximumTermsPerStatement,
        );
        return `${outputMarker} (\n${chunk.join("\nUNION ALL\n")}\n)${tail}`;
      },
    ),
  );
}

function matchingSqlParenthesis(sql: string, start: number): number {
  let depth = 0;
  let quoted = false;
  for (let index = start; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "'") {
      if (quoted && sql[index + 1] === "'") {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("Unbalanced current-published media SQL.");
}

function splitTopLevelUnionAll(sql: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  const marker = "UNION ALL";
  const upper = sql.toUpperCase();
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "'") {
      if (quoted && sql[index + 1] === "'") {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth -= 1;
      continue;
    }
    if (
      depth === 0 &&
      upper.startsWith(marker, index) &&
      !/[A-Z0-9_]/u.test(upper[index - 1] ?? "") &&
      !/[A-Z0-9_]/u.test(upper[index + marker.length] ?? "")
    ) {
      parts.push(sql.slice(start, index).trim());
      index += marker.length - 1;
      start = index + 1;
    }
  }
  parts.push(sql.slice(start).trim());
  return parts.filter(Boolean);
}
