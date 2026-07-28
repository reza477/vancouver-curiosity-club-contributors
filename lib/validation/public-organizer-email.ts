/**
 * Builds a correlated SQLite/D1 predicate that detects an exact organization
 * member SIWC email inside any public-bound text expression.
 *
 * Historical membership rows are deliberately included: suspension,
 * soft-deletion, or a later role change must not turn a previously private
 * identity address into publishable content. Callers must pass only trusted,
 * source-authored SQL expressions.
 */
export function publicOrganizerEmailExposureSql(
  expressions: readonly string[],
  organizationIdExpression: string,
): string {
  if (expressions.length === 0) return "0";
  const values = expressions
    .map((expression) => `COALESCE(${expression}, '')`)
    .join(", ");
  return `EXISTS (
    SELECT 1
    FROM organization_memberships AS private_identity_membership
    LEFT JOIN profiles AS private_identity_profile
      ON private_identity_profile.id =
         private_identity_membership.profile_id
    JOIN json_each(json_array(${values})) AS public_field
    WHERE private_identity_membership.organization_id =
          ${organizationIdExpression}
      AND (
        (
          length(trim(private_identity_membership.normalized_email)) > 0
          AND instr(
            lower(CAST(public_field.value AS TEXT)),
            lower(private_identity_membership.normalized_email)
          ) > 0
        )
        OR (
          length(trim(COALESCE(
            private_identity_profile.normalized_email,
            ''
          ))) > 0
          AND instr(
            lower(CAST(public_field.value AS TEXT)),
            lower(private_identity_profile.normalized_email)
          ) > 0
        )
      )
  )`;
}

/**
 * Inverse lifecycle predicate used when a SIWC identity is added or changed.
 * It prevents a previously ordinary-looking public contact string from
 * becoming a private organizer sign-in address after publication.
 */
export function organizationPublicContentContainsEmailSql(
  emailExpression: string,
  organizationIdExpression: string,
): string {
  const containsEmail = (expressions: readonly string[]) => {
    const values = expressions
      .map((expression) => `COALESCE(${expression}, '')`)
      .join(", ");
    return `EXISTS (
      SELECT 1
      FROM json_each(json_array(${values})) AS public_field
      WHERE instr(
        lower(CAST(public_field.value AS TEXT)),
        lower(${emailExpression})
      ) > 0
    )`;
  };
  return `(
    length(trim(COALESCE(${emailExpression}, ''))) > 0
    AND (
      EXISTS (
        SELECT 1
        FROM cms_entity_publication_states AS public_state
        JOIN cms_entity_revisions AS public_revision
          ON public_revision.id = public_state.published_revision_id
         AND public_revision.organization_id =
             public_state.organization_id
         AND public_revision.publication_state_id = public_state.id
         AND public_revision.entity_type = public_state.entity_type
         AND public_revision.entity_key = public_state.entity_key
        WHERE public_state.organization_id =
              ${organizationIdExpression}
          AND (
            public_state.workflow_status = 'published'
            OR (
              public_state.workflow_status = 'archived'
              AND public_state.entity_type IN (
                'club_public_profile', 'program_public_profile'
              )
              AND public_state.published_revision_id IS NOT NULL
            )
          )
          AND ${containsEmail(["public_revision.snapshot_json"])}
      )
      OR EXISTS (
        SELECT 1
        FROM organizer_events AS public_event
        LEFT JOIN organizer_event_public_details AS public_detail
          ON public_detail.organizer_event_id = public_event.id
         AND public_detail.organization_id = public_event.organization_id
        LEFT JOIN organizer_event_public_metadata AS public_metadata
          ON public_metadata.organizer_event_id = public_event.id
         AND public_metadata.organization_id = public_event.organization_id
        WHERE public_event.organization_id =
              ${organizationIdExpression}
          AND public_event.publication_status IN ('scheduled', 'published')
          AND ${containsEmail([
            "public_event.title",
            "public_event.summary",
            "public_event.description",
            "public_detail.public_location_name",
            "public_detail.public_address",
            "public_detail.public_access_note",
            "public_detail.cost_text",
            "public_detail.preparation_information",
            "public_detail.what_to_bring",
            "public_detail.arrival_instructions",
            "public_detail.weather_note",
            "public_detail.verified_accessibility_notes",
            "public_metadata.seo_title",
            "public_metadata.meta_description",
          ])}
      )
      OR EXISTS (
        SELECT 1
        FROM events AS legacy_public_event
        WHERE legacy_public_event.organization_id =
              ${organizationIdExpression}
          AND legacy_public_event.visibility = 'public'
          AND legacy_public_event.published_at IS NOT NULL
          AND legacy_public_event.deleted_at IS NULL
          AND ${containsEmail([
            "legacy_public_event.title",
            "legacy_public_event.summary",
            "legacy_public_event.description",
          ])}
      )
      OR EXISTS (
        SELECT 1
        FROM media_assets AS public_asset
        LEFT JOIN media_asset_details AS public_detail
          ON public_detail.asset_id = public_asset.id
         AND public_detail.organization_id = public_asset.organization_id
        WHERE public_asset.organization_id =
              ${organizationIdExpression}
          AND public_asset.deleted_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM media_usage_references AS public_usage
            WHERE public_usage.organization_id =
                  public_asset.organization_id
              AND public_usage.asset_id = public_asset.id
              AND public_usage.publication_scope = 'published'
              AND public_usage.deleted_at IS NULL
          )
          AND ${containsEmail([
            "public_asset.alt_text",
            "public_asset.credit",
            "public_detail.caption",
          ])}
      )
    )
  )`;
}
