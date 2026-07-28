/**
 * SQL fragments for the immutable Phase 6 CMS materialization contract.
 *
 * A receipt is useful only when it is bound both to the immutable revision
 * semantics and to the exact current allowlisted public projection. Keeping
 * these fragments in one server-only module prevents public reads and the
 * fail-closed invariant scan from drifting apart.
 */

export function jsonSemanticallyEqualSql(
  leftExpression: string,
  rightExpression: string,
): string {
  return String.raw`(
    json_valid(${leftExpression})
    AND json_valid(${rightExpression})
    AND NOT EXISTS (
      SELECT left_tree.fullkey, left_tree.type, left_tree.atom
      FROM json_tree(${leftExpression}) AS left_tree
      EXCEPT
      SELECT right_tree.fullkey, right_tree.type, right_tree.atom
      FROM json_tree(${rightExpression}) AS right_tree
    )
    AND NOT EXISTS (
      SELECT right_tree.fullkey, right_tree.type, right_tree.atom
      FROM json_tree(${rightExpression}) AS right_tree
      EXCEPT
      SELECT left_tree.fullkey, left_tree.type, left_tree.atom
      FROM json_tree(${leftExpression}) AS left_tree
    )
  )`;
}

function pageBlockConfigSemanticallyEqualSql(
  projectionExpression: string,
  revisionExpression: string,
): string {
  return String.raw`(
    ${jsonSemanticallyEqualSql(projectionExpression, revisionExpression)}
    OR (
      json_type(${projectionExpression}, '$.paragraphs') IS NULL
      AND json_type(${revisionExpression}, '$.paragraphs') = 'array'
      AND json_array_length(${revisionExpression}, '$.paragraphs') = 0
      AND ${jsonSemanticallyEqualSql(
        projectionExpression,
        `json_remove(${revisionExpression}, '$.paragraphs')`,
      )}
    )
  )`;
}

function publishedResourceLinksMatchSnapshotSql(
  projectionExpression: string,
  snapshotExpression: string,
  organizationExpression: string,
): string {
  return String.raw`(
    json_type(
      ${projectionExpression},
      '$.details.relatedResources'
    ) = 'array'
    AND ${jsonSemanticallyEqualSql(
      `COALESCE(
         json_extract(
           ${projectionExpression},
           '$.details.relatedResourceSelectionIds'
         ),
         json('[]')
       )`,
      `json_extract(${snapshotExpression}, '$.relatedResourceIds')`,
    )}
    AND json_array_length(
          ${projectionExpression},
          '$.details.relatedResources'
        ) = COALESCE(
          json_array_length(
            ${projectionExpression},
            '$.details.relatedResourceBindings'
          ),
          0
        )
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(
             ${projectionExpression},
             '$.details.relatedResourceBindings'
           ) AS binding
      WHERE binding.type <> 'object'
         OR json_type(binding.value, '$.selectedIndex') <> 'integer'
         OR json_extract(binding.value, '$.selectedIndex') < 0
         OR json_extract(binding.value, '$.selectedIndex') >=
            json_array_length(
              ${snapshotExpression},
              '$.relatedResourceIds'
            )
         OR json_extract(binding.value, '$.id') <>
            json_extract(
              ${snapshotExpression},
              '$.relatedResourceIds['
              || json_extract(binding.value, '$.selectedIndex') || ']'
            )
         OR json_extract(binding.value, '$.label') <>
            json_extract(
              ${projectionExpression},
              '$.details.relatedResources[' || binding.key || '].label'
            )
         OR json_extract(binding.value, '$.url') <>
            json_extract(
              ${projectionExpression},
              '$.details.relatedResources[' || binding.key || '].url'
            )
         OR NOT EXISTS (
           SELECT 1
           FROM cms_entity_publication_states AS resource_state
           JOIN cms_entity_revisions AS resource_revision
             ON resource_revision.publication_state_id = resource_state.id
            AND resource_revision.organization_id =
                resource_state.organization_id
            AND resource_revision.entity_type = 'page'
            AND resource_revision.entity_key = resource_state.entity_key
           JOIN cms_public_materialization_receipts AS resource_receipt
             ON resource_receipt.id =
                json_extract(binding.value, '$.receiptId')
            AND resource_receipt.organization_id =
                resource_state.organization_id
            AND resource_receipt.publication_state_id = resource_state.id
            AND resource_receipt.entity_type = 'page'
            AND resource_receipt.entity_key = resource_state.entity_key
            AND resource_receipt.revision_id = resource_revision.id
            AND resource_receipt.revision_hash =
                resource_revision.content_hash
           WHERE resource_state.organization_id =
                 ${organizationExpression}
             AND resource_state.entity_type = 'page'
             AND resource_state.entity_key =
                 json_extract(binding.value, '$.id')
             AND resource_revision.id =
                 json_extract(binding.value, '$.revisionId')
             AND json_valid(resource_revision.snapshot_json)
             AND json_valid(resource_receipt.projection_json)
             AND json_extract(
                   resource_revision.snapshot_json,
                   '$.title'
                 ) = json_extract(binding.value, '$.label')
             AND '/' || json_extract(
                   resource_revision.snapshot_json,
                   '$.slug'
                 ) = json_extract(binding.value, '$.url')
             AND json_extract(
                   resource_receipt.projection_json,
                   '$.page.title'
                 ) = json_extract(binding.value, '$.label')
             AND '/' || json_extract(
                   resource_receipt.projection_json,
                   '$.page.slug'
                 ) = json_extract(binding.value, '$.url')
         )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(
             ${projectionExpression},
             '$.details.relatedResourceBindings'
           ) AS earlier
      JOIN json_each(
             ${projectionExpression},
             '$.details.relatedResourceBindings'
           ) AS later
        ON CAST(earlier.key AS INTEGER) < CAST(later.key AS INTEGER)
      WHERE json_extract(earlier.value, '$.selectedIndex') >=
            json_extract(later.value, '$.selectedIndex')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(
          ${snapshotExpression},
          '$.relatedResourceIds'
         ) AS selected_resource
      WHERE selected_resource.type <> 'text'
    )
  )`;
}

function featuredClubBlockMatchesSnapshotSql(
  publicConfigExpression: string,
  snapshotConfigExpression: string,
  organizationExpression: string,
): string {
  const eligibleClubs = String.raw`(
    SELECT COALESCE(
      json_group_array(ordered_club.slug),
      json('[]')
    )
    FROM (
      SELECT club.slug
      FROM json_each(
             ${snapshotConfigExpression},
             '$.ids'
           ) AS selected_club
      JOIN clubs AS club
        ON club.id = selected_club.value
       AND club.organization_id = ${organizationExpression}
       AND club.deleted_at IS NULL
      JOIN club_public_profiles AS profile
        ON profile.club_id = club.id
       AND profile.organization_id = club.organization_id
       AND profile.publication_status = 'published'
       AND profile.published_at IS NOT NULL
       AND profile.deleted_at IS NULL
      JOIN cms_entity_publication_states AS club_state
        ON club_state.organization_id = club.organization_id
       AND club_state.entity_type = 'club_public_profile'
       AND club_state.entity_key = club.id
       AND club_state.workflow_status = 'published'
       AND club_state.published_revision_id IS NOT NULL
      JOIN cms_entity_revisions AS club_revision
        ON club_revision.id = club_state.published_revision_id
       AND club_revision.organization_id = club_state.organization_id
       AND club_revision.publication_state_id = club_state.id
       AND club_revision.entity_type = club_state.entity_type
       AND club_revision.entity_key = club_state.entity_key
      JOIN cms_public_materialization_receipts AS club_receipt
        ON club_receipt.organization_id = club_state.organization_id
       AND club_receipt.publication_state_id = club_state.id
       AND club_receipt.entity_type = club_state.entity_type
       AND club_receipt.entity_key = club_state.entity_key
       AND club_receipt.revision_id = club_revision.id
       AND club_receipt.revision_hash = club_revision.content_hash
      WHERE selected_club.type = 'text'
        AND json_valid(club_receipt.projection_json)
        AND json_extract(club_receipt.projection_json, '$.club.slug') =
            club.slug
        AND json_extract(club_receipt.projection_json, '$.club.name') =
            club.name
        AND json_extract(club_revision.snapshot_json, '$.slug') =
            club.slug
        AND json_extract(club_revision.snapshot_json, '$.name') =
            club.name
        AND CAST(selected_club.key AS INTEGER) <
            CAST(json_extract(${snapshotConfigExpression}, '$.limit') AS INTEGER)
      ORDER BY CAST(selected_club.key AS INTEGER)
    ) AS ordered_club
  )`;
  const eligibleCount = String.raw`(
    SELECT count(*)
    FROM json_each(${snapshotConfigExpression}, '$.ids') AS selected_club
    JOIN clubs AS club
      ON club.id = selected_club.value
     AND club.organization_id = ${organizationExpression}
     AND club.deleted_at IS NULL
    JOIN club_public_profiles AS profile
      ON profile.club_id = club.id
     AND profile.organization_id = club.organization_id
     AND profile.publication_status = 'published'
     AND profile.published_at IS NOT NULL
     AND profile.deleted_at IS NULL
    JOIN cms_entity_publication_states AS club_state
      ON club_state.organization_id = club.organization_id
     AND club_state.entity_type = 'club_public_profile'
     AND club_state.entity_key = club.id
     AND club_state.workflow_status = 'published'
     AND club_state.published_revision_id IS NOT NULL
    JOIN cms_entity_revisions AS club_revision
      ON club_revision.id = club_state.published_revision_id
     AND club_revision.organization_id = club_state.organization_id
     AND club_revision.publication_state_id = club_state.id
     AND club_revision.entity_type = club_state.entity_type
     AND club_revision.entity_key = club_state.entity_key
    JOIN cms_public_materialization_receipts AS club_receipt
      ON club_receipt.organization_id = club_state.organization_id
     AND club_receipt.publication_state_id = club_state.id
     AND club_receipt.entity_type = club_state.entity_type
     AND club_receipt.entity_key = club_state.entity_key
     AND club_receipt.revision_id = club_revision.id
     AND club_receipt.revision_hash = club_revision.content_hash
    WHERE selected_club.type = 'text'
      AND json_valid(club_receipt.projection_json)
      AND json_extract(club_receipt.projection_json, '$.club.slug') =
          club.slug
      AND json_extract(club_receipt.projection_json, '$.club.name') =
          club.name
      AND json_extract(club_revision.snapshot_json, '$.slug') = club.slug
      AND json_extract(club_revision.snapshot_json, '$.name') = club.name
  )`;
  return String.raw`(
    json_type(${publicConfigExpression}, '$.clubSlugs') = 'array'
    AND (${eligibleCount}) =
        json_array_length(${snapshotConfigExpression}, '$.ids')
    AND json(json_extract(${publicConfigExpression}, '$.clubSlugs')) =
        json(${eligibleClubs})
  )`;
}

function communityBlockMatchesSnapshotSql(
  publicConfigExpression: string,
  snapshotConfigExpression: string,
  organizationExpression: string,
): string {
  const eligibilityJoins = String.raw`
    JOIN community_links AS link
      ON link.id = selected_link.value
     AND link.organization_id = ${organizationExpression}
     AND link.is_published = 1
     AND link.deleted_at IS NULL
    JOIN community_link_public_details AS details
      ON details.community_link_id = link.id
     AND details.organization_id = link.organization_id
     AND details.confirmed_at IS NOT NULL
    JOIN cms_entity_publication_states AS link_state
      ON link_state.organization_id = link.organization_id
     AND link_state.entity_type = 'community_link'
     AND link_state.entity_key = link.id
     AND link_state.workflow_status = 'published'
     AND link_state.published_revision_id IS NOT NULL
    JOIN cms_entity_revisions AS link_revision
      ON link_revision.id = link_state.published_revision_id
     AND link_revision.organization_id = link_state.organization_id
     AND link_revision.publication_state_id = link_state.id
     AND link_revision.entity_type = link_state.entity_type
     AND link_revision.entity_key = link_state.entity_key
     AND json_valid(link_revision.snapshot_json)
     AND json_extract(link_revision.snapshot_json, '$.confirmed') = 1
     AND json_extract(link_revision.snapshot_json, '$.label') = link.label
     AND json_extract(link_revision.snapshot_json, '$.url') = link.url
     AND json_extract(
           link_revision.snapshot_json,
           '$.destinationType'
         ) = details.destination_type
     AND json_extract(
           link_revision.snapshot_json,
           '$.description'
         ) = details.description
     AND json_extract(
           link_revision.snapshot_json,
           '$.sortOrder'
         ) = link.sort_order
    JOIN cms_public_materialization_receipts AS link_receipt
      ON link_receipt.organization_id = link_state.organization_id
     AND link_receipt.publication_state_id = link_state.id
     AND link_receipt.entity_type = link_state.entity_type
     AND link_receipt.entity_key = link_state.entity_key
     AND link_receipt.revision_id = link_revision.id
     AND link_receipt.revision_hash = link_revision.content_hash
     AND json_valid(link_receipt.projection_json)
     AND json_extract(link_receipt.projection_json, '$.link.label') =
         link.label
     AND json_extract(link_receipt.projection_json, '$.link.url') =
         link.url
     AND json_extract(
           link_receipt.projection_json,
           '$.details.destinationType'
         ) = details.destination_type
     AND json_extract(
           link_receipt.projection_json,
           '$.details.description'
         ) = details.description`;
  const eligibleLinks = String.raw`(
    SELECT COALESCE(
      json_group_array(json(ordered_link.link_json)),
      json('[]')
    )
    FROM (
      SELECT json_object(
               'label', link.label,
               'url', link.url
             ) AS link_json
      FROM json_each(
             ${snapshotConfigExpression},
             '$.ids'
           ) AS selected_link
      ${eligibilityJoins}
      WHERE selected_link.type = 'text'
        AND CAST(selected_link.key AS INTEGER) <
            CAST(json_extract(${snapshotConfigExpression}, '$.limit') AS INTEGER)
      ORDER BY CAST(selected_link.key AS INTEGER)
    ) AS ordered_link
  )`;
  const eligibleCount = String.raw`(
    SELECT count(*)
    FROM json_each(${snapshotConfigExpression}, '$.ids') AS selected_link
    ${eligibilityJoins}
    WHERE selected_link.type = 'text'
  )`;
  return String.raw`(
    json_type(${publicConfigExpression}, '$.links') = 'array'
    AND (${eligibleCount}) =
        json_array_length(${snapshotConfigExpression}, '$.ids')
    AND json(json_extract(${publicConfigExpression}, '$.links')) =
        json(${eligibleLinks})
  )`;
}

function featuredEventBlockMatchesSnapshotSql(
  publicConfigExpression: string,
  snapshotConfigExpression: string,
  receiptProjectionExpression: string,
): string {
  return String.raw`(
    json_type(${publicConfigExpression}, '$.eventSlugs') = 'array'
    AND json(json_extract(${publicConfigExpression}, '$.eventSlugs')) =
        json(
          COALESCE(
            (
              SELECT json_group_array(ordered.slug)
              FROM (
                SELECT json_extract(
                         selection_proof.value,
                         '$.slug'
                       ) AS slug
                FROM json_each(
                       ${snapshotConfigExpression},
                       '$.ids'
                     ) AS selected_event
                JOIN json_each(
                       ${receiptProjectionExpression},
                       '$.eventSelectionProofs'
                     ) AS selection_proof
                  ON json_extract(
                       selection_proof.value,
                       '$.requestedId'
                     ) = CAST(selected_event.value AS TEXT)
                WHERE CAST(selected_event.key AS INTEGER) <
                      CAST(
                        json_extract(
                          ${snapshotConfigExpression},
                          '$.limit'
                        ) AS INTEGER
                      )
                ORDER BY CAST(selected_event.key AS INTEGER)
              ) AS ordered
            ),
            '[]'
          )
        )
  )`;
}

function featuredEventSelectionProofPredicatesSql(
  projectionExpression: string,
  snapshotExpression: string,
  unifiedPublicEventCteSql: string | undefined,
): readonly string[] {
  const proofCoverage = String.raw`(
    json_type(${projectionExpression}, '$.eventSelectionProofs') = 'array'
    AND json_array_length(
          ${projectionExpression},
          '$.eventSelectionProofs'
        ) = (
          SELECT count(DISTINCT CAST(selected_event.value AS TEXT))
          FROM json_each(
                 ${snapshotExpression},
                 '$.blocks'
               ) AS featured_block
          JOIN json_each(
                 featured_block.value,
                 '$.config.ids'
               ) AS selected_event
          WHERE json_extract(featured_block.value, '$.type') =
                'featured_events'
        )
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(
             ${snapshotExpression},
             '$.blocks'
           ) AS featured_block
      JOIN json_each(
             featured_block.value,
             '$.config.ids'
           ) AS selected_event
      WHERE json_extract(featured_block.value, '$.type') =
            'featured_events'
        AND (
          SELECT count(*)
          FROM json_each(
                 ${projectionExpression},
                 '$.eventSelectionProofs'
               ) AS selection_proof
          WHERE json_extract(
                  selection_proof.value,
                  '$.requestedId'
                ) = CAST(selected_event.value AS TEXT)
        ) <> 1
    )
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(
             ${projectionExpression},
             '$.eventSelectionProofs'
           ) AS selection_proof
      WHERE json_type(selection_proof.value) <> 'object'
         OR json_type(selection_proof.value, '$.requestedId') <> 'text'
         OR json_type(selection_proof.value, '$.sourceIdentity') <> 'text'
         OR json_type(selection_proof.value, '$.slug') <> 'text'
         OR json_type(selection_proof.value, '$.sourceVersion') <> 'text'
         OR length(
              json_extract(selection_proof.value, '$.sourceVersion')
            ) NOT BETWEEN 3 AND 2048
         OR NOT EXISTS (
           SELECT 1
           FROM json_each(
                  ${snapshotExpression},
                  '$.blocks'
                ) AS featured_block
           JOIN json_each(
                  featured_block.value,
                  '$.config.ids'
                ) AS selected_event
           WHERE json_extract(featured_block.value, '$.type') =
                 'featured_events'
             AND CAST(selected_event.value AS TEXT) =
                 json_extract(
                   selection_proof.value,
                   '$.requestedId'
                 )
         )
    )
  )`;
  if (!unifiedPublicEventCteSql) {
    return Object.freeze([proofCoverage]);
  }
  const currentTargetProof = String.raw`(
    NOT EXISTS (
      SELECT 1
      FROM json_each(
             ${projectionExpression},
             '$.eventSelectionProofs'
           ) AS selection_proof
      WHERE NOT EXISTS (
        ${unifiedPublicEventCteSql}
        SELECT 1
        FROM public_events AS public_event
        WHERE public_event.source_identity_key =
              json_extract(
                selection_proof.value,
                '$.sourceIdentity'
              )
          AND public_event.slug =
              json_extract(selection_proof.value, '$.slug')
          AND public_event.public_source_version =
              json_extract(
                selection_proof.value,
                '$.sourceVersion'
              )
          AND public_event.public_slug_count = 1
          AND (
            json_extract(
              selection_proof.value,
              '$.requestedId'
            ) = public_event.source_identity_key
            OR (
              instr(
                json_extract(
                  selection_proof.value,
                  '$.requestedId'
                ),
                ':'
              ) = 0
              AND public_event.source_identity_key =
                  'organizer:' || json_extract(
                    selection_proof.value,
                    '$.requestedId'
                  )
            )
          )
      )
    )
  )`;
  return Object.freeze([proofCoverage, currentTargetProof]);
}

function pageReceiptBlockPredicatesSql(
  projectionExpression: string,
  snapshotExpression: string,
  organizationExpression: string,
  unifiedPublicEventCteSql: string | undefined,
): readonly string[] {
  const matchingSectionSql = (
    expectedTypePredicate: string,
    contentPredicate: string,
  ) => String.raw`
NOT EXISTS (
  SELECT 1
  FROM json_each(${snapshotExpression}, '$.blocks') AS expected_block
  WHERE ${expectedTypePredicate}
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(${projectionExpression}, '$.sections') AS public_section
      WHERE json_extract(public_section.value, '$.sectionKey') =
            json_extract(expected_block.value, '$.id')
        AND json_extract(public_section.value, '$.sectionType') =
            json_extract(expected_block.value, '$.type')
        AND json_extract(public_section.value, '$.sortOrder') =
            (CAST(expected_block.key AS INTEGER) + 1) * 10
        AND (${contentPredicate})
    )
)`;
  const publicConfig =
    "json_extract(public_section.value, '$.contentJson')";
  const snapshotConfig =
    "json_extract(expected_block.value, '$.config')";
  const headingAndLimit = String.raw`
json_extract(${publicConfig}, '$.heading') IS
    json_extract(expected_block.value, '$.config.heading')
AND json_extract(${publicConfig}, '$.limit') =
    json_extract(expected_block.value, '$.config.limit')`;
  return Object.freeze([
    matchingSectionSql(
      String.raw`json_extract(expected_block.value, '$.type') NOT IN (
        'featured_clubs', 'featured_events', 'community_links', 'media'
      )`,
      pageBlockConfigSemanticallyEqualSql(publicConfig, snapshotConfig),
    ),
    matchingSectionSql(
      "json_extract(expected_block.value, '$.type') = 'media'",
      String.raw`
json_extract(${publicConfig}, '$.assetId') IS
    json_extract(expected_block.value, '$.config.assetId')
AND json_extract(${publicConfig}, '$.caption') IS
    json_extract(expected_block.value, '$.config.caption')
AND json_extract(${publicConfig}, '$.heading') IS
    json_extract(expected_block.value, '$.config.heading')`,
    ),
    matchingSectionSql(
      "json_extract(expected_block.value, '$.type') = 'featured_clubs'",
      String.raw`
${headingAndLimit}
AND ${featuredClubBlockMatchesSnapshotSql(
  publicConfig,
  snapshotConfig,
  organizationExpression,
)}`,
    ),
    matchingSectionSql(
      "json_extract(expected_block.value, '$.type') = 'featured_events'",
      String.raw`
${headingAndLimit}
AND ${featuredEventBlockMatchesSnapshotSql(
  publicConfig,
  snapshotConfig,
  projectionExpression,
)}`,
    ),
    matchingSectionSql(
      "json_extract(expected_block.value, '$.type') = 'community_links'",
      String.raw`
${headingAndLimit}
AND ${communityBlockMatchesSnapshotSql(
  publicConfig,
  snapshotConfig,
  organizationExpression,
      )}`,
    ),
    ...featuredEventSelectionProofPredicatesSql(
      projectionExpression,
      snapshotExpression,
      unifiedPublicEventCteSql,
    ),
  ]);
}

export type CmsReceiptMatchSqlOptions = Readonly<{
  unifiedPublicEventCteSql?: string;
}>;

/**
 * Compact immutable-envelope proof for hot public projections.
 *
 * The full semantic receipt matcher is intentionally retained for the
 * database write guards and global invariant scan. Public club/program reads
 * already compare every materialized allowlisted field to the receipt, so
 * repeating the complete multi-entity CASE expression in each join only
 * recreates the write-time proof and can exceed D1's statement limits. This
 * envelope binds the immutable receipt to the exact immutable revision; the
 * entity-specific public projection then supplies the field-by-field proof.
 */
export function cmsReceiptEnvelopeMatchesRevisionSql(
  receiptAlias = "receipt",
  revisionAlias = "revision",
): string {
  return String.raw`(
    ${receiptAlias}.organization_id = ${revisionAlias}.organization_id
    AND ${receiptAlias}.publication_state_id =
        ${revisionAlias}.publication_state_id
    AND ${receiptAlias}.entity_type = ${revisionAlias}.entity_type
    AND ${receiptAlias}.entity_key = ${revisionAlias}.entity_key
    AND ${receiptAlias}.revision_id = ${revisionAlias}.id
    AND ${receiptAlias}.revision_hash = ${revisionAlias}.content_hash
    AND json_valid(${receiptAlias}.projection_json)
    AND json_type(${receiptAlias}.projection_json) = 'object'
    AND ${receiptAlias}.canonical_byte_size =
        length(CAST(${receiptAlias}.projection_json AS BLOB))
    AND ${receiptAlias}.canonical_byte_size BETWEEN 2 AND 131072
    AND json_valid(${revisionAlias}.snapshot_json)
    AND json_type(${revisionAlias}.snapshot_json) = 'object'
    AND ${revisionAlias}.canonical_byte_size =
        length(CAST(${revisionAlias}.snapshot_json AS BLOB))
    AND ${revisionAlias}.canonical_byte_size BETWEEN 2 AND 131072
  )`;
}

export function cmsClubReceiptProjectionMatchesRevisionSql(
  receiptAlias = "receipt",
  revisionAlias = "revision",
): string {
  const projection = `${receiptAlias}.projection_json`;
  const snapshot = `${revisionAlias}.snapshot_json`;
  return String.raw`(
    json_extract(${projection}, '$.club.name') =
        json_extract(${snapshot}, '$.name')
    AND json_extract(${projection}, '$.club.slug') =
        json_extract(${snapshot}, '$.slug')
    AND json_extract(${projection}, '$.club.description') =
        json_extract(${snapshot}, '$.summary')
    AND json_extract(${projection}, '$.profile.laneId') =
        json_extract(${snapshot}, '$.laneId')
    AND json_extract(${projection}, '$.profile.featured') =
        json_extract(${snapshot}, '$.featured')
    AND json_extract(${projection}, '$.profile.summary') =
        json_extract(${snapshot}, '$.summary')
    AND json_extract(${projection}, '$.profile.meetupGroupUrl') IS
        json_extract(${snapshot}, '$.meetupGroupUrl')
    AND (
      json_type(${projection}, '$.details') = 'null'
      OR (
        json_extract(${projection}, '$.details.publicDisplayName') =
            json_extract(${snapshot}, '$.name')
        AND json_extract(${projection}, '$.details.shortSummary') =
            json_extract(${snapshot}, '$.summary')
        AND json_extract(${projection}, '$.details.fullDescription') =
            json_extract(${snapshot}, '$.description')
        AND json_extract(${projection}, '$.details.programType') =
            json_extract(${snapshot}, '$.programType')
        AND json_extract(${projection}, '$.details.coverAssetId') IS
            json_extract(${snapshot}, '$.coverAssetId')
        AND json_extract(${projection}, '$.details.thumbnailAssetId') IS
            json_extract(${snapshot}, '$.thumbnailAssetId')
        AND json_extract(${projection}, '$.details.themeColor') IS
            json_extract(${snapshot}, '$.themeColor')
        AND json_extract(
              ${projection},
              '$.details.participantExpectations'
            ) IS json_extract(${snapshot}, '$.whatToExpect')
        AND json_extract(
              ${projection},
              '$.details.preparationInformation'
            ) IS json_extract(${snapshot}, '$.preparation')
        AND json_extract(${projection}, '$.details.typicalFormat') IS
            json_extract(${snapshot}, '$.typicalFormat')
        AND json_extract(${projection}, '$.details.seoTitle') IS
            json_extract(${snapshot}, '$.seoTitle')
        AND json_extract(${projection}, '$.details.metaDescription') IS
            json_extract(${snapshot}, '$.metaDescription')
        AND json_extract(${projection}, '$.details.openGraphAssetId') IS
            json_extract(${snapshot}, '$.openGraphAssetId')
        AND json_array_length(
              ${projection},
              '$.details.confirmedSocialLinks'
            ) = json_array_length(${snapshot}, '$.socialUrls')
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(${snapshot}, '$.socialUrls') AS source_social
          WHERE json_extract(
                  ${projection},
                  '$.details.confirmedSocialLinks['
                  || source_social.key || '].url'
                ) <> source_social.value
        )
        AND ${publishedResourceLinksMatchSnapshotSql(
          projection,
          snapshot,
          `${receiptAlias}.organization_id`,
        )}
      )
    )
  )`;
}

export function cmsProgramReceiptProjectionMatchesRevisionSql(
  receiptAlias = "receipt",
  revisionAlias = "revision",
): string {
  const projection = `${receiptAlias}.projection_json`;
  const snapshot = `${revisionAlias}.snapshot_json`;
  return String.raw`(
    json_extract(${projection}, '$.details.clubId') =
        json_extract(${snapshot}, '$.clubId')
    AND json_extract(${projection}, '$.details.name') =
        json_extract(${snapshot}, '$.name')
    AND json_extract(${projection}, '$.details.slug') =
        json_extract(${snapshot}, '$.slug')
    AND json_extract(${projection}, '$.details.summary') =
        json_extract(${snapshot}, '$.summary')
    AND json_extract(${projection}, '$.details.fullDescription') =
        json_extract(${snapshot}, '$.description')
    AND json_extract(${projection}, '$.details.laneId') =
        json_extract(${snapshot}, '$.laneId')
    AND json_extract(${projection}, '$.details.featured') =
        json_extract(${snapshot}, '$.featured')
    AND json_extract(${projection}, '$.details.displayOrder') =
        json_extract(${snapshot}, '$.displayOrder')
    AND json_extract(${projection}, '$.details.programType') =
        json_extract(${snapshot}, '$.programType')
    AND json_extract(${projection}, '$.details.meetupGroupUrl') IS
        json_extract(${snapshot}, '$.meetupGroupUrl')
    AND json_extract(${projection}, '$.details.coverAssetId') IS
        json_extract(${snapshot}, '$.coverAssetId')
    AND json_extract(${projection}, '$.details.thumbnailAssetId') IS
        json_extract(${snapshot}, '$.thumbnailAssetId')
    AND json_extract(${projection}, '$.details.themeColor') IS
        json_extract(${snapshot}, '$.themeColor')
    AND json_extract(
          ${projection},
          '$.details.participantExpectations'
        ) IS json_extract(${snapshot}, '$.whatToExpect')
    AND json_extract(
          ${projection},
          '$.details.preparationInformation'
        ) IS json_extract(${snapshot}, '$.preparation')
    AND json_extract(${projection}, '$.details.typicalFormat') IS
        json_extract(${snapshot}, '$.typicalFormat')
    AND json_extract(${projection}, '$.details.seoTitle') IS
        json_extract(${snapshot}, '$.seoTitle')
    AND json_extract(${projection}, '$.details.metaDescription') IS
        json_extract(${snapshot}, '$.metaDescription')
    AND json_extract(${projection}, '$.details.openGraphAssetId') IS
        json_extract(${snapshot}, '$.openGraphAssetId')
    AND json_array_length(
          ${projection},
          '$.details.confirmedSocialLinks'
        ) = json_array_length(${snapshot}, '$.socialUrls')
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(${snapshot}, '$.socialUrls') AS source_social
      WHERE json_extract(
              ${projection},
              '$.details.confirmedSocialLinks['
              || source_social.key || '].url'
            ) <> source_social.value
    )
    AND ${publishedResourceLinksMatchSnapshotSql(
      projection,
      snapshot,
      `${receiptAlias}.organization_id`,
    )}
  )`;
}

export function cmsReceiptMatchesRevisionSql(
  receiptAlias = "receipt",
  revisionAlias = "revision",
  options: CmsReceiptMatchSqlOptions = {},
): string {
  const receipt = receiptAlias;
  const revision = revisionAlias;
  const projection = `${receipt}.projection_json`;
  const snapshot = `${revision}.snapshot_json`;
  const pageBlockPredicates = pageReceiptBlockPredicatesSql(
    projection,
    snapshot,
    `${receipt}.organization_id`,
    options.unifiedPublicEventCteSql,
  );
  return String.raw`(
    json_valid(${projection})
    AND json_valid(${snapshot})
    AND CASE ${receipt}.entity_type
      WHEN 'page' THEN (
        json_extract(${projection}, '$.page.title') =
            json_extract(${snapshot}, '$.title')
        AND json_extract(${projection}, '$.page.slug') =
            json_extract(${snapshot}, '$.slug')
        AND json_extract(${projection}, '$.metadata.seoTitle') IS
            json_extract(${snapshot}, '$.seoTitle')
        AND json_extract(${projection}, '$.metadata.metaDescription') IS
            json_extract(${snapshot}, '$.metaDescription')
        AND json_extract(${projection}, '$.metadata.openGraphAssetId') IS
            json_extract(${snapshot}, '$.openGraphAssetId')
        AND json_array_length(${projection}, '$.sections') =
            json_array_length(${snapshot}, '$.blocks')
        AND ${pageBlockPredicates.join("\n        AND ")}
      )
      WHEN 'club_public_profile' THEN (
        json_extract(${projection}, '$.club.name') =
            json_extract(${snapshot}, '$.name')
        AND json_extract(${projection}, '$.club.slug') =
            json_extract(${snapshot}, '$.slug')
        AND json_extract(${projection}, '$.club.description') =
            json_extract(${snapshot}, '$.summary')
        AND json_extract(${projection}, '$.profile.laneId') =
            json_extract(${snapshot}, '$.laneId')
        AND json_extract(${projection}, '$.profile.featured') =
            json_extract(${snapshot}, '$.featured')
        AND json_extract(${projection}, '$.profile.summary') =
            json_extract(${snapshot}, '$.summary')
        AND json_extract(${projection}, '$.profile.meetupGroupUrl') IS
            json_extract(${snapshot}, '$.meetupGroupUrl')
        AND (
          json_type(${projection}, '$.details') = 'null'
          OR (
            json_extract(${projection}, '$.details.publicDisplayName') =
                json_extract(${snapshot}, '$.name')
            AND json_extract(${projection}, '$.details.shortSummary') =
                json_extract(${snapshot}, '$.summary')
            AND json_extract(${projection}, '$.details.fullDescription') =
                json_extract(${snapshot}, '$.description')
            AND json_extract(${projection}, '$.details.programType') =
                json_extract(${snapshot}, '$.programType')
            AND json_extract(${projection}, '$.details.coverAssetId') IS
                json_extract(${snapshot}, '$.coverAssetId')
            AND json_extract(${projection}, '$.details.thumbnailAssetId') IS
                json_extract(${snapshot}, '$.thumbnailAssetId')
            AND json_extract(${projection}, '$.details.themeColor') IS
                json_extract(${snapshot}, '$.themeColor')
            AND json_extract(
                  ${projection},
                  '$.details.participantExpectations'
                ) IS json_extract(${snapshot}, '$.whatToExpect')
            AND json_extract(
                  ${projection},
                  '$.details.preparationInformation'
                ) IS json_extract(${snapshot}, '$.preparation')
            AND json_extract(${projection}, '$.details.typicalFormat') IS
                json_extract(${snapshot}, '$.typicalFormat')
            AND json_extract(${projection}, '$.details.seoTitle') IS
                json_extract(${snapshot}, '$.seoTitle')
            AND json_extract(${projection}, '$.details.metaDescription') IS
                json_extract(${snapshot}, '$.metaDescription')
            AND json_extract(${projection}, '$.details.openGraphAssetId') IS
                json_extract(${snapshot}, '$.openGraphAssetId')
            AND json_array_length(
                  ${projection},
                  '$.details.confirmedSocialLinks'
                ) = json_array_length(${snapshot}, '$.socialUrls')
            AND NOT EXISTS (
              SELECT 1
              FROM json_each(${snapshot}, '$.socialUrls') AS source_social
              WHERE json_extract(
                      ${projection},
                      '$.details.confirmedSocialLinks['
                      || source_social.key || '].url'
                    ) <> source_social.value
            )
            AND ${publishedResourceLinksMatchSnapshotSql(
              projection,
              snapshot,
              `${receipt}.organization_id`,
            )}
          )
        )
      )
      WHEN 'program_public_profile' THEN (
        json_extract(${projection}, '$.details.clubId') =
            json_extract(${snapshot}, '$.clubId')
        AND json_extract(${projection}, '$.details.name') =
            json_extract(${snapshot}, '$.name')
        AND json_extract(${projection}, '$.details.slug') =
            json_extract(${snapshot}, '$.slug')
        AND json_extract(${projection}, '$.details.summary') =
            json_extract(${snapshot}, '$.summary')
        AND json_extract(${projection}, '$.details.fullDescription') =
            json_extract(${snapshot}, '$.description')
        AND json_extract(${projection}, '$.details.laneId') =
            json_extract(${snapshot}, '$.laneId')
        AND json_extract(${projection}, '$.details.featured') =
            json_extract(${snapshot}, '$.featured')
        AND json_extract(${projection}, '$.details.displayOrder') =
            json_extract(${snapshot}, '$.displayOrder')
        AND json_extract(${projection}, '$.details.programType') =
            json_extract(${snapshot}, '$.programType')
        AND json_extract(${projection}, '$.details.meetupGroupUrl') IS
            json_extract(${snapshot}, '$.meetupGroupUrl')
        AND json_extract(${projection}, '$.details.coverAssetId') IS
            json_extract(${snapshot}, '$.coverAssetId')
        AND json_extract(${projection}, '$.details.thumbnailAssetId') IS
            json_extract(${snapshot}, '$.thumbnailAssetId')
        AND json_extract(${projection}, '$.details.themeColor') IS
            json_extract(${snapshot}, '$.themeColor')
        AND json_extract(
              ${projection},
              '$.details.participantExpectations'
            ) IS json_extract(${snapshot}, '$.whatToExpect')
        AND json_extract(
              ${projection},
              '$.details.preparationInformation'
            ) IS json_extract(${snapshot}, '$.preparation')
        AND json_extract(${projection}, '$.details.typicalFormat') IS
            json_extract(${snapshot}, '$.typicalFormat')
        AND json_extract(${projection}, '$.details.seoTitle') IS
            json_extract(${snapshot}, '$.seoTitle')
        AND json_extract(${projection}, '$.details.metaDescription') IS
            json_extract(${snapshot}, '$.metaDescription')
        AND json_extract(${projection}, '$.details.openGraphAssetId') IS
            json_extract(${snapshot}, '$.openGraphAssetId')
        AND json_array_length(
              ${projection},
              '$.details.confirmedSocialLinks'
            ) = json_array_length(${snapshot}, '$.socialUrls')
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(${snapshot}, '$.socialUrls') AS source_social
          WHERE json_extract(
                  ${projection},
                  '$.details.confirmedSocialLinks['
                  || source_social.key || '].url'
                ) <> source_social.value
        )
        AND ${publishedResourceLinksMatchSnapshotSql(
          projection,
          snapshot,
          `${receipt}.organization_id`,
        )}
      )
      WHEN 'community_link' THEN (
        json_extract(${snapshot}, '$.confirmed') = 1
        AND json_extract(${projection}, '$.link.label') =
            json_extract(${snapshot}, '$.label')
        AND json_extract(${projection}, '$.link.url') =
            json_extract(${snapshot}, '$.url')
        AND json_extract(${projection}, '$.link.linkType') =
            json_extract(${snapshot}, '$.destinationType')
        AND json_extract(${projection}, '$.link.sortOrder') =
            json_extract(${snapshot}, '$.sortOrder')
        AND json_extract(${projection}, '$.details.description') =
            json_extract(${snapshot}, '$.description')
        AND json_extract(${projection}, '$.details.destinationType') =
            json_extract(${snapshot}, '$.destinationType')
      )
      WHEN 'navigation' THEN
        ${jsonSemanticallyEqualSql(
          `json_extract(${projection}, '$.items')`,
          `json_extract(${snapshot}, '$.items')`,
        )}
      WHEN 'site_identity' THEN (
        json_extract(${projection}, '$.setting.key') = 'public_identity'
        AND json_extract(${projection}, '$.setting.valueJson') =
            ${snapshot}
      )
      WHEN 'legal_status' THEN (
        json_extract(${projection}, '$.setting.key') =
            'public_legal_status'
        AND json_extract(${projection}, '$.setting.valueJson') =
            ${snapshot}
      )
      ELSE 0
    END
  )`;
}

export type CmsReceiptEntityType =
  | "page"
  | "club_public_profile"
  | "program_public_profile"
  | "community_link"
  | "navigation"
  | "site_identity"
  | "legal_status";

/**
 * Emits only one known CASE branch from the canonical receipt contract.
 *
 * D1 compiles each trigger and query under a 100 KiB SQL-text ceiling. The
 * generic CASE is useful for application-side validation, but embedding every
 * entity branch in an entity-specific trigger needlessly multiplies the
 * contract into several hundred kilobytes. Extracting the compile-time branch
 * keeps one semantic source while producing a bounded D1 statement.
 */
export function cmsReceiptMatchesRevisionForEntityTypeSql(
  entityType: CmsReceiptEntityType,
  receiptAlias = "receipt",
  revisionAlias = "revision",
  options: CmsReceiptMatchSqlOptions = {},
): string {
  const generic = cmsReceiptMatchesRevisionSql(
    receiptAlias,
    revisionAlias,
    options,
  );
  const marker = `WHEN '${entityType}' THEN`;
  const markerIndex = generic.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`Missing CMS receipt branch for ${entityType}.`);
  }
  const expressionStart = generic.indexOf("(", markerIndex + marker.length);
  if (expressionStart < 0) {
    throw new Error(`Malformed CMS receipt branch for ${entityType}.`);
  }
  const expressionEnd = matchingSqlParenthesis(generic, expressionStart);
  const branch = generic.slice(expressionStart, expressionEnd + 1);
  return String.raw`(
    json_valid(${receiptAlias}.projection_json)
    AND json_valid(${revisionAlias}.snapshot_json)
    AND ${branch}
  )`;
}

const CMS_RECEIPT_PREDICATE_GROUP_MAX_TERMS = 8;
const CMS_RECEIPT_PREDICATE_GROUP_MAX_BYTES = 48_000;

/**
 * Returns shallow, independently executable predicates for one receipt type.
 *
 * SQLite's expression tree is limited to depth 100. A single long `AND`
 * expression can exceed that limit even when its SQL text is comfortably
 * below D1's statement-size ceiling. The canonical entity branch remains the
 * semantic source; this build-time splitter only changes how its independent
 * conjuncts are packaged into triggers and global probes.
 */
export function cmsReceiptRevisionPredicateGroupsForEntityTypeSql(
  entityType: CmsReceiptEntityType,
  receiptAlias = "receipt",
  revisionAlias = "revision",
  options: CmsReceiptMatchSqlOptions = {},
): readonly string[] {
  const entityPredicate = cmsReceiptMatchesRevisionForEntityTypeSql(
    entityType,
    receiptAlias,
    revisionAlias,
    options,
  );
  const outer = stripOuterSqlParentheses(entityPredicate);
  let predicates = flattenTopLevelAndPredicates(outer);

  // A legacy club receipt may intentionally have no extended detail object.
  // Distribute that one null guard across the detail conjuncts so D1 does not
  // have to compile their entire `OR (... AND ... AND ...)` tree at once.
  predicates = predicates.flatMap((predicate) => {
    const candidate = stripOuterSqlParentheses(predicate);
    const alternatives = splitTopLevelSqlKeyword(candidate, "OR");
    if (alternatives.length !== 2) return [predicate];
    const guarded = stripOuterSqlParentheses(alternatives[1] ?? "");
    const guardedPredicates = splitTopLevelSqlKeyword(guarded, "AND");
    if (guardedPredicates.length < 2) return [predicate];
    const nullGuard = alternatives[0]?.trim() ?? "0";
    return guardedPredicates.map(
      (guardedPredicate) =>
        `(${nullGuard} OR (${guardedPredicate.trim()}))`,
    );
  });

  const groups: string[] = [];
  let current: string[] = [];
  const maximumSimpleTerms =
    entityType === "page" ? 9 : CMS_RECEIPT_PREDICATE_GROUP_MAX_TERMS;
  for (const predicate of predicates) {
    const pageBlockPredicate =
      entityType === "page" &&
      predicate.includes("FROM json_each(") &&
      predicate.includes("snapshot_json, '$.blocks'");
    const currentEventProofPredicate =
      entityType === "page" &&
      predicate.includes("eventSelectionProofs") &&
      predicate.includes("FROM public_events AS public_event");
    if (pageBlockPredicate || currentEventProofPredicate) {
      if (current.length > 0) {
        groups.push(`(${current.join("\nAND ")})`);
        current = [];
      }
      groups.push(`(${predicate})`);
      continue;
    }
    const next = [...current, predicate];
    const nextSql = `(${next.join("\nAND ")})`;
    if (
      current.length > 0 &&
      (
        next.length > maximumSimpleTerms ||
        new TextEncoder().encode(nextSql).length >
          CMS_RECEIPT_PREDICATE_GROUP_MAX_BYTES
      )
    ) {
      groups.push(`(${current.join("\nAND ")})`);
      current = [predicate];
    } else {
      current = next;
    }
  }
  if (current.length > 0) {
    groups.push(`(${current.join("\nAND ")})`);
  }
  return Object.freeze(groups);
}

function flattenTopLevelAndPredicates(sql: string): string[] {
  const candidate = stripOuterSqlParentheses(sql);
  const parts = splitTopLevelSqlKeyword(candidate, "AND");
  if (parts.length === 1) return [sql.trim()];
  return parts.flatMap(flattenTopLevelAndPredicates);
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
  throw new Error("Unbalanced CMS receipt SQL branch.");
}

function stripOuterSqlParentheses(sql: string): string {
  let value = sql.trim();
  while (
    value.startsWith("(") &&
    matchingSqlParenthesis(value, 0) === value.length - 1
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function splitTopLevelSqlKeyword(
  sql: string,
  keyword: "AND" | "OR",
): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
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
      upper.startsWith(keyword, index) &&
      !/[A-Z0-9_]/u.test(upper[index - 1] ?? "") &&
      !/[A-Z0-9_]/u.test(upper[index + keyword.length] ?? "")
    ) {
      parts.push(sql.slice(start, index).trim());
      index += keyword.length - 1;
      start = index + 1;
    }
  }
  parts.push(sql.slice(start).trim());
  return parts.filter(Boolean);
}

export function cmsPageLiveProjectionMatchesReceiptSql(
  pageAlias = "page",
  receiptAlias = "receipt",
): string {
  const page = pageAlias;
  const receipt = receiptAlias;
  return String.raw`(
    ${page}.title = json_extract(${receipt}.projection_json, '$.page.title')
    AND ${page}.slug =
        json_extract(${receipt}.projection_json, '$.page.slug')
    AND ${page}.current_revision =
        json_extract(
          ${receipt}.projection_json,
          '$.page.currentRevision'
        )
    AND (
      EXISTS (
        SELECT 1
        FROM page_public_metadata AS metadata
        WHERE metadata.page_id = ${page}.id
          AND metadata.organization_id = ${page}.organization_id
          AND metadata.seo_title IS
              json_extract(
                ${receipt}.projection_json,
                '$.metadata.seoTitle'
              )
          AND metadata.meta_description IS
              json_extract(
                ${receipt}.projection_json,
                '$.metadata.metaDescription'
              )
          AND metadata.og_media_asset_id IS
              json_extract(
                ${receipt}.projection_json,
                '$.metadata.openGraphAssetId'
              )
      )
      OR (
        json_extract(
          ${receipt}.projection_json,
          '$.metadata.seoTitle'
        ) IS NULL
        AND json_extract(
          ${receipt}.projection_json,
          '$.metadata.metaDescription'
        ) IS NULL
        AND json_extract(
          ${receipt}.projection_json,
          '$.metadata.openGraphAssetId'
        ) IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM page_public_metadata AS metadata
          WHERE metadata.page_id = ${page}.id
            AND metadata.organization_id = ${page}.organization_id
        )
      )
    )
    AND (
      SELECT count(*)
      FROM page_sections AS section
      WHERE section.page_id = ${page}.id
        AND section.organization_id = ${page}.organization_id
        AND section.deleted_at IS NULL
    ) = json_array_length(${receipt}.projection_json, '$.sections')
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(${receipt}.projection_json, '$.sections') AS expected
      WHERE NOT EXISTS (
        SELECT 1
        FROM page_sections AS section
        WHERE section.page_id = ${page}.id
          AND section.organization_id = ${page}.organization_id
          AND section.section_key =
              json_extract(expected.value, '$.sectionKey')
          AND section.section_type =
              json_extract(expected.value, '$.sectionType')
          AND section.sort_order =
              json_extract(expected.value, '$.sortOrder')
          AND ${jsonSemanticallyEqualSql(
            "section.content_json",
            "json_extract(expected.value, '$.contentJson')",
          )}
          AND section.deleted_at IS NULL
      )
    )
  )`;
}

export function cmsCommunityLiveProjectionMatchesReceiptSql(
  linkAlias = "link",
  detailsAlias = "details",
  receiptAlias = "receipt",
): string {
  const link = linkAlias;
  const details = detailsAlias;
  const receipt = receiptAlias;
  return String.raw`(
    ${link}.label =
        json_extract(${receipt}.projection_json, '$.link.label')
    AND ${link}.url =
        json_extract(${receipt}.projection_json, '$.link.url')
    AND ${link}.link_type =
        json_extract(${receipt}.projection_json, '$.link.linkType')
    AND ${link}.sort_order =
        json_extract(${receipt}.projection_json, '$.link.sortOrder')
    AND ${details}.description =
        json_extract(
          ${receipt}.projection_json,
          '$.details.description'
        )
    AND ${details}.destination_type =
        json_extract(
          ${receipt}.projection_json,
          '$.details.destinationType'
        )
  )`;
}

export function cmsClubLiveProjectionMatchesReceiptSql(
  clubAlias = "club",
  profileAlias = "profile",
  detailsAlias = "details",
  receiptAlias = "receipt",
): string {
  const club = clubAlias;
  const profile = profileAlias;
  const details = detailsAlias;
  const receipt = receiptAlias;
  return String.raw`(
    ${club}.name =
        json_extract(${receipt}.projection_json, '$.club.name')
    AND ${club}.slug =
        json_extract(${receipt}.projection_json, '$.club.slug')
    AND ${club}.description =
        json_extract(${receipt}.projection_json, '$.club.description')
    AND ${profile}.primary_event_lane_id =
        json_extract(${receipt}.projection_json, '$.profile.laneId')
    AND ${profile}.is_featured =
        json_extract(${receipt}.projection_json, '$.profile.featured')
    AND ${profile}.description =
        json_extract(${receipt}.projection_json, '$.profile.summary')
    AND ${profile}.public_group_url IS
        json_extract(${receipt}.projection_json, '$.profile.meetupGroupUrl')
    AND (
      (
        json_type(${receipt}.projection_json, '$.details') = 'null'
        AND ${details}.club_id IS NULL
      )
      OR (
        json_type(${receipt}.projection_json, '$.details') = 'object'
        AND ${details}.public_display_name =
            json_extract(
              ${receipt}.projection_json,
              '$.details.publicDisplayName'
            )
        AND ${details}.short_summary =
            json_extract(
              ${receipt}.projection_json,
              '$.details.shortSummary'
            )
        AND ${details}.full_description =
            json_extract(
              ${receipt}.projection_json,
              '$.details.fullDescription'
            )
        AND ${details}.program_type =
            json_extract(
              ${receipt}.projection_json,
              '$.details.programType'
            )
        AND ${details}.cover_media_asset_id IS
            json_extract(
              ${receipt}.projection_json,
              '$.details.coverAssetId'
            )
        AND ${details}.thumbnail_media_asset_id IS
            json_extract(
              ${receipt}.projection_json,
              '$.details.thumbnailAssetId'
            )
        AND ${details}.image_alt_text IS
            json_extract(
              ${receipt}.projection_json,
              '$.details.imageAltText'
            )
        AND ${details}.theme_color =
            json_extract(
              ${receipt}.projection_json,
              '$.details.themeColor'
            )
        AND ${details}.participant_expectations IS
            json_extract(
              ${receipt}.projection_json,
              '$.details.participantExpectations'
            )
        AND ${details}.preparation_information IS
            json_extract(
              ${receipt}.projection_json,
              '$.details.preparationInformation'
            )
        AND ${details}.typical_format IS
            json_extract(
              ${receipt}.projection_json,
              '$.details.typicalFormat'
            )
        AND json(${details}.confirmed_social_links_json) =
            json(
              json_extract(
                ${receipt}.projection_json,
                '$.details.confirmedSocialLinks'
              )
            )
        AND json(${details}.related_resources_json) =
            json(
              json_extract(
                ${receipt}.projection_json,
                '$.details.relatedResources'
              )
            )
        AND ${details}.seo_title =
            json_extract(
              ${receipt}.projection_json,
              '$.details.seoTitle'
            )
        AND ${details}.meta_description =
            json_extract(
              ${receipt}.projection_json,
              '$.details.metaDescription'
            )
        AND ${details}.og_media_asset_id IS
            json_extract(
              ${receipt}.projection_json,
              '$.details.openGraphAssetId'
            )
      )
    )
  )`;
}

export function cmsNavigationLiveProjectionMatchesReceiptSql(
  organizationExpression: string,
  receiptAlias = "receipt",
): string {
  const receipt = receiptAlias;
  return String.raw`(
    (
      SELECT count(*)
      FROM navigation_items AS live_item
      WHERE live_item.organization_id = ${organizationExpression}
        AND live_item.is_published = 1
        AND live_item.deleted_at IS NULL
    ) = json_array_length(${receipt}.projection_json, '$.items')
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(${receipt}.projection_json, '$.items') AS expected
      WHERE NOT EXISTS (
        SELECT 1
        FROM navigation_items AS live_item
        LEFT JOIN pages AS target_page
          ON target_page.id = live_item.page_id
         AND target_page.organization_id = live_item.organization_id
        WHERE live_item.id = json_extract(expected.value, '$.id')
          AND live_item.organization_id = ${organizationExpression}
          AND live_item.label = json_extract(expected.value, '$.label')
          AND live_item.placement =
              json_extract(expected.value, '$.placement')
          AND live_item.sort_order =
              json_extract(expected.value, '$.sortOrder')
          AND live_item.is_published = 1
          AND live_item.deleted_at IS NULL
          AND CASE
            WHEN live_item.external_url IS NOT NULL
            THEN live_item.external_url
            WHEN target_page.slug = 'home' THEN '/'
            WHEN target_page.slug IS NOT NULL
            THEN '/' || target_page.slug
            ELSE NULL
          END = json_extract(expected.value, '$.target')
      )
    )
  )`;
}
