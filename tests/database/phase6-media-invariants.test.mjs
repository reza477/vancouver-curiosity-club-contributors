import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  DATABASE_INVARIANT_VERSION,
  ensureDatabaseInvariants,
} from "../../lib/server/database/invariants.ts";
import {
  PHASE6_INVARIANT_COUNT_SQL,
  PHASE6_INVARIANT_TRIGGER_STATEMENTS,
} from "../../lib/server/database/phase6-invariant-sql.ts";
import { MAX_DATABASE_INVARIANT_READY_ATTEMPTS } from "./invariant-ready.mjs";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

function newDatabase() {
  const schema = readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) =>
      readFileSync(join(process.cwd(), "drizzle", name), "utf8"),
    )
    .join("\n");
  const database = new SqliteD1TestDatabase(schema);
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES
      (
        'profile-phase6-owner', 'subject-phase6-owner',
        'phase6-owner@example.test', 'Phase 6 Owner', 'active', 1, 1
      ),
      (
        'profile-phase6-other', 'subject-phase6-other',
        'phase6-other@example.test', 'Other Owner', 'active', 1, 1
      );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'org-phase6', 'Phase 6 organization', 'phase6-organization',
        'America/Vancouver', 1, 'profile-phase6-owner', 1, 1
      ),
      (
        'org-phase6-other', 'Other organization', 'other-organization',
        'America/Vancouver', 1, 'profile-phase6-other', 1, 1
      );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'membership-phase6-owner', 'org-phase6', 'profile-phase6-owner',
        'phase6-owner@example.test', 'owner', 'active',
        'profile-phase6-owner', 1, 1
      ),
      (
        'membership-phase6-other', 'org-phase6-other',
        'profile-phase6-other', 'phase6-other@example.test', 'owner',
        'active', 'profile-phase6-other', 1, 1
      );
    INSERT INTO event_lanes (
      id, organization_id, name, slug, sort_order,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'lane-phase6', 'org-phase6', 'Think', 'think', 10,
      'profile-phase6-owner', 1, 1
    );
    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'club-phase6', 'org-phase6', 'Phase 6 Club', 'phase-6-club',
      'profile-phase6-owner', 1, 1
    );
    INSERT INTO club_public_profiles (
      club_id, organization_id, primary_event_lane_id,
      publication_status, is_featured, created_at, updated_at
    ) VALUES (
      'club-phase6', 'org-phase6', 'lane-phase6', 'draft', 0, 1, 1
    );
    INSERT INTO pages (
      id, organization_id, title, slug, status, visibility,
      current_revision, created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'page-about', 'org-phase6', 'About', 'about', 'draft', 'private', 1,
      'profile-phase6-owner', 'profile-phase6-owner', 1, 1
    );
    INSERT INTO cms_entity_publication_states (
      id, organization_id, entity_type, entity_key, workflow_status,
      content_version, current_draft_revision_id, last_editor_profile_id,
      draft_updated_at, created_at, updated_at
    ) VALUES
      (
        'state-page-about', 'org-phase6', 'page', 'page-about', 'draft', 1,
        'revision-page-about', 'profile-phase6-owner', 1, 1, 1
      ),
      (
        'state-site-identity', 'org-phase6', 'site_identity', 'site_identity',
        'draft', 1, 'revision-site-identity', 'profile-phase6-owner', 1, 1, 1
      );
    INSERT INTO cms_entity_revisions (
      id, organization_id, publication_state_id, entity_type, entity_key,
      revision_number, snapshot_json, content_hash, canonical_byte_size,
      actor_profile_id, created_at
    ) VALUES
      (
        'revision-page-about', 'org-phase6', 'state-page-about',
        'page', 'page-about', 1, '{}', '${"a".repeat(64)}', 2,
        'profile-phase6-owner', 1
      ),
      (
        'revision-site-identity', 'org-phase6', 'state-site-identity',
        'site_identity', 'site_identity', 1, '{}', '${"b".repeat(64)}', 2,
        'profile-phase6-owner', 1
      );
    INSERT INTO media_assets (
      id, organization_id, object_key, file_name, mime_type, byte_size,
      alt_text, credit, rights_status, participant_consent_status,
      is_public, uploaded_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'asset-phase6', 'org-phase6', 'opaque/phase6/original',
        'private-original.png', 'image/png', 100,
        'Original abstract category artwork.',
        'Vancouver Curiosity Club', 'approved', 'not_applicable', 0,
        'profile-phase6-owner', 1, 1
      ),
      (
        'asset-phase6-other', 'org-phase6-other',
        'opaque/phase6-other/original', 'other-private-original.png',
        'image/png', 100, 'Other artwork.', 'Other organization',
        'approved', 'not_applicable', 0, 'profile-phase6-other', 1, 1
      );
    INSERT INTO media_asset_details (
      asset_id, organization_id, upload_state, informative, content_version,
      original_sha256, width, height, pixel_count, finalized_at,
      updated_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'asset-phase6', 'org-phase6', 'ready', 1, 1,
        '${"c".repeat(64)}', 10, 10, 100, 1,
        'profile-phase6-owner', 1, 1
      ),
      (
        'asset-phase6-other', 'org-phase6-other', 'ready', 1, 1,
        '${"d".repeat(64)}', 10, 10, 100, 1,
        'profile-phase6-other', 1, 1
      );
    INSERT INTO media_asset_variants (
      id, organization_id, asset_id, variant_kind, object_key, mime_type,
      byte_size, width, height, pixel_count, sha256, state,
      finalized_at, created_at
    ) VALUES
      (
        'variant-phase6-original', 'org-phase6', 'asset-phase6', 'original',
        'opaque/phase6/original', 'image/png', 100, 10, 10, 100,
        '${"e".repeat(64)}', 'ready', 1, 1
      ),
      (
        'variant-phase6-480', 'org-phase6', 'asset-phase6', 'webp_480',
        'opaque/phase6/480', 'image/webp', 80, 10, 10, 100,
        '${"f".repeat(64)}', 'ready', 1, 1
      ),
      (
        'variant-phase6-960', 'org-phase6', 'asset-phase6', 'webp_960',
        'opaque/phase6/960', 'image/webp', 80, 10, 10, 100,
        '${"0".repeat(64)}', 'ready', 1, 1
      ),
      (
        'variant-phase6-1600', 'org-phase6', 'asset-phase6', 'webp_1600',
        'opaque/phase6/1600', 'image/webp', 80, 10, 10, 100,
        '${"1".repeat(64)}', 'ready', 1, 1
      ),
      (
        'variant-other-original', 'org-phase6-other',
        'asset-phase6-other', 'original', 'opaque/other/original',
        'image/png', 100, 10, 10, 100, '${"2".repeat(64)}',
        'ready', 1, 1
      ),
      (
        'variant-other-480', 'org-phase6-other',
        'asset-phase6-other', 'webp_480', 'opaque/other/480',
        'image/webp', 80, 10, 10, 100, '${"3".repeat(64)}',
        'ready', 1, 1
      ),
      (
        'variant-other-960', 'org-phase6-other',
        'asset-phase6-other', 'webp_960', 'opaque/other/960',
        'image/webp', 80, 10, 10, 100, '${"4".repeat(64)}',
        'ready', 1, 1
      ),
      (
        'variant-other-1600', 'org-phase6-other',
        'asset-phase6-other', 'webp_1600', 'opaque/other/1600',
        'image/webp', 80, 10, 10, 100, '${"5".repeat(64)}',
        'ready', 1, 1
      );
    INSERT INTO media_usage_references (
      id, organization_id, asset_id, entity_type, entity_id, revision_id,
      usage_kind, publication_scope, created_by_profile_id, created_at
    ) VALUES
      (
        'usage-page', 'org-phase6', 'asset-phase6', 'page', 'page-about',
        'revision-page-about', 'hero', 'draft', 'profile-phase6-owner', 1
      ),
      (
        'usage-site-logo', 'org-phase6', 'asset-phase6', 'site_logo',
        'org-phase6', 'revision-site-identity', 'logo', 'draft',
        'profile-phase6-owner', 1
      );
  `);
  return database;
}

test("Phase 6 media usage guards bind revisions exactly and retain immutable soft-delete history", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureInvariantReadiness(database);

  assert.throws(
    () =>
      database.exec(`
        INSERT INTO media_usage_references (
          id, organization_id, asset_id, entity_type, entity_id, revision_id,
          usage_kind, publication_scope, created_by_profile_id, created_at
        ) VALUES (
          'usage-empty-revision', 'org-phase6', 'asset-phase6',
          'page', 'page-about', '', 'empty-revision',
          'draft', 'profile-phase6-owner', 2
        );
      `),
    /phase6_media_usage_target_mismatch/u,
  );
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO media_usage_references (
          id, organization_id, asset_id, entity_type, entity_id, revision_id,
          usage_kind, publication_scope, created_by_profile_id, created_at
        ) VALUES (
          'usage-wrong-page-revision', 'org-phase6', 'asset-phase6',
          'page', 'page-about', 'revision-site-identity', 'wrong-revision',
          'draft', 'profile-phase6-owner', 2
        );
      `),
    /phase6_media_usage_target_mismatch/u,
  );
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO media_usage_references (
          id, organization_id, asset_id, entity_type, entity_id, revision_id,
          usage_kind, publication_scope, created_by_profile_id, created_at
        ) VALUES (
          'usage-wrong-logo-revision', 'org-phase6', 'asset-phase6',
          'site_logo', 'org-phase6', 'revision-page-about', 'wrong-logo',
          'draft', 'profile-phase6-owner', 2
        );
      `),
    /phase6_media_usage_target_mismatch/u,
  );

  await assert.rejects(
    database.batch([
      database.prepare(
        `INSERT INTO media_usage_references (
           id, organization_id, asset_id, entity_type, entity_id, revision_id,
           usage_kind, publication_scope, created_by_profile_id, created_at
         ) VALUES (
           'usage-batch-valid', 'org-phase6', 'asset-phase6',
           'page', 'page-about', 'revision-page-about', 'batch-valid',
           'draft', 'profile-phase6-owner', 3
         )`,
      ),
      database.prepare(
        `INSERT INTO media_usage_references (
           id, organization_id, asset_id, entity_type, entity_id, revision_id,
           usage_kind, publication_scope, created_by_profile_id, created_at
         ) VALUES (
           'usage-batch-invalid', 'org-phase6', 'asset-phase6',
           'page', 'page-about', 'revision-site-identity', 'batch-invalid',
           'draft', 'profile-phase6-owner', 3
         )`,
      ),
    ]),
    /phase6_media_usage_target_mismatch/u,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM media_usage_references
         WHERE id IN ('usage-batch-valid', 'usage-batch-invalid')`,
      )
      .first("count"),
    0,
  );

  assert.throws(
    () =>
      database.exec(`
        UPDATE media_usage_references
        SET revision_id = ''
        WHERE id = 'usage-page';
      `),
    /phase6_media_usage_identity_immutable/u,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE media_usage_references
        SET usage_kind = 'crafted'
        WHERE id = 'usage-page';
      `),
    /phase6_media_usage_identity_immutable/u,
  );
  database.exec(`
    UPDATE media_usage_references
    SET deleted_at = 10
    WHERE id = 'usage-page';
  `);
  assert.throws(
    () =>
      database.exec(`
        UPDATE media_usage_references
        SET deleted_at = NULL
        WHERE id = 'usage-page';
      `),
    /phase6_media_usage_identity_immutable/u,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE media_usage_references
        SET deleted_at = 11
        WHERE id = 'usage-page';
      `),
    /phase6_media_usage_identity_immutable/u,
  );
  assert.deepEqual(
    {
      ...await database
        .prepare(
          `SELECT asset_id, entity_type, entity_id, revision_id, usage_kind,
                  publication_scope, created_by_profile_id, created_at,
                  deleted_at
           FROM media_usage_references
           WHERE id = 'usage-page'`,
        )
        .first(),
    },
    {
      asset_id: "asset-phase6",
      created_at: 1,
      created_by_profile_id: "profile-phase6-owner",
      deleted_at: 10,
      entity_id: "page-about",
      entity_type: "page",
      publication_scope: "draft",
      revision_id: "revision-page-about",
      usage_kind: "hero",
    },
  );
});

test("global Phase 6 integrity rejects a legacy empty media revision without a ready marker", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  database.exec(`
    PRAGMA ignore_check_constraints = ON;
    INSERT INTO media_usage_references (
      id, organization_id, asset_id, entity_type, entity_id, revision_id,
      usage_kind, publication_scope, created_by_profile_id, created_at
    ) VALUES (
      'usage-empty-revision-residue', 'org-phase6', 'asset-phase6',
      'page', 'page-about', '', 'legacy-empty',
      'draft', 'profile-phase6-owner', 2
    );
    PRAGMA ignore_check_constraints = OFF;
  `);
  let rejected = false;
  for (
    let attempt = 0;
    attempt < MAX_DATABASE_INVARIANT_READY_ATTEMPTS && !rejected;
    attempt += 1
  ) {
    try {
      await ensureDatabaseInvariants(database);
    } catch (error) {
      assert.match(
        error instanceof Error ? error.message : String(error),
        /Database integrity guards are unavailable/u,
      );
      rejected = true;
    }
  }
  assert.equal(rejected, true);
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM database_invariant_state
         WHERE singleton_key = 'database-guards'`,
      )
      .first("count"),
    0,
  );
});

test("public-attribution state, receipts, and canonical consent reject direct D1 bypasses", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureInvariantReadiness(database);

  database.exec(`
    INSERT INTO organizer_public_attribution_states (
      profile_id, organization_id, attribution_version,
      workflow_status, draft_photo_media_asset_id,
      public_display_name, public_biography,
      public_photo_media_asset_id, current_receipt_id,
      confirmed_at, revoked_at, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'profile-phase6-owner', 'org-phase6', 1,
      'unconfirmed', NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, 'profile-phase6-owner', 2, 2
    );
    INSERT INTO organizer_profile_preferences (
      profile_id, organization_id, workspace_display_name,
      public_biography, public_attribution_consent_draft,
      notification_preference_mode, created_at, updated_at
    ) VALUES (
      'profile-phase6-owner', 'org-phase6', 'Phase 6 Owner',
      'Receipt-bound biography.', 1, 'all_relevant', 2, 2
    );
    INSERT INTO organizer_public_attribution_write_intents (
      id, organization_id, profile_id, operation,
      expected_draft_version, expected_published_version,
      proposed_published_version, snapshot_hash,
      actor_profile_id, created_at, completed_at
    ) VALUES (
      'intent-phase6-attribution', 'org-phase6',
      'profile-phase6-owner', 'confirmed', 1, 0, 1,
      '${"a".repeat(64)}', 'profile-phase6-owner', 3, NULL
    );
  `);

  assert.throws(
    () =>
      database.exec(`
        UPDATE profiles
        SET public_attribution_consent = 1
        WHERE id = 'profile-phase6-owner';
      `),
    /phase6_public_attribution_profile_guard/u,
  );
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO organizer_public_attribution_receipts (
          id, organization_id, profile_id, action,
          attribution_version, display_name, biography,
          photo_media_asset_id, consent, draft_version,
          legacy_adopted, prior_published_version,
          snapshot_json, snapshot_hash, actor_profile_id,
          write_intent_id, related_receipt_id, created_at
        ) VALUES (
          'forged-attribution-receipt', 'org-phase6',
          'profile-phase6-owner', 'confirmed', 1,
          'Phase 6 Owner', 'Receipt-bound biography.', NULL,
          1, 1, 0, NULL,
          '{"biography":"Receipt-bound biography.","consent":true,"displayName":"Phase 6 Owner","draftVersion":1,"extraPrivateKey":"must-not-survive","legacyAdopted":false,"photoAssetId":null}',
          '${"a".repeat(64)}', 'profile-phase6-owner',
          'intent-phase6-attribution', NULL, 3
        );
      `),
    /phase6_public_attribution_receipt_invalid/u,
  );
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO organizer_public_attribution_receipts (
          id, organization_id, profile_id, action,
          attribution_version, display_name, biography,
          photo_media_asset_id, consent, draft_version,
          legacy_adopted, prior_published_version,
          snapshot_json, snapshot_hash, actor_profile_id,
          write_intent_id, related_receipt_id, created_at
        ) VALUES (
          'forged-attribution-fields', 'org-phase6',
          'profile-phase6-owner', 'confirmed', 1,
          'Forged typed name', 'Receipt-bound biography.', NULL,
          1, 1, 0, NULL,
          '{"biography":"Receipt-bound biography.","consent":true,"displayName":"Phase 6 Owner","draftVersion":1,"legacyAdopted":false,"photoAssetId":null}',
          '${"a".repeat(64)}', 'profile-phase6-owner',
          'intent-phase6-attribution', NULL, 3
        );
      `),
    /phase6_public_attribution_receipt_invalid/u,
  );
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO organizer_public_attribution_receipts (
          id, organization_id, profile_id, action,
          attribution_version, display_name, biography,
          photo_media_asset_id, consent, draft_version,
          legacy_adopted, prior_published_version,
          snapshot_json, snapshot_hash, actor_profile_id,
          write_intent_id, related_receipt_id, created_at
        ) VALUES (
          'forged-attribution-hash', 'org-phase6',
          'profile-phase6-owner', 'confirmed', 1,
          'Phase 6 Owner', 'Receipt-bound biography.', NULL,
          1, 1, 0, NULL,
          '{"biography":"Receipt-bound biography.","consent":true,"displayName":"Phase 6 Owner","draftVersion":1,"legacyAdopted":false,"photoAssetId":null}',
          '${"b".repeat(64)}', 'profile-phase6-owner',
          'intent-phase6-attribution', NULL, 3
        );
      `),
    /phase6_public_attribution_receipt_invalid/u,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE organizer_public_attribution_states
        SET attribution_version = 2,
            workflow_status = 'confirmed',
            public_display_name = 'Forged',
            current_receipt_id = 'forged-attribution-receipt',
            confirmed_at = 3,
            updated_at = 3
        WHERE profile_id = 'profile-phase6-owner';
      `),
    /FOREIGN KEY|phase6_public_attribution_state_invalid/u,
  );
  assert.throws(
    () =>
      database.exec(`
        DELETE FROM organizer_public_attribution_states
        WHERE profile_id = 'profile-phase6-owner';
      `),
    /phase6_public_attribution_state_immutable/u,
  );
  assert.deepEqual(
    {
      ...await database
        .prepare(
          `SELECT attribution_version, workflow_status, current_receipt_id
           FROM organizer_public_attribution_states
           WHERE profile_id = 'profile-phase6-owner'`,
        )
        .first(),
    },
    {
      attribution_version: 1,
      current_receipt_id: null,
      workflow_status: "unconfirmed",
    },
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM organizer_public_attribution_receipts
         WHERE profile_id = 'profile-phase6-owner'`,
      )
      .first("count"),
    0,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM database_invariant_state
         WHERE singleton_key = 'database-guards'`,
      )
      .first("count"),
    0,
    "opening a public-attribution intent invalidates readiness immediately",
  );
});

test("current published media usage rejects historical inserts and every direct public-readiness downgrade", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  database.exec(`
    UPDATE pages
    SET status = 'published',
        visibility = 'public',
        slug = 'about-synthetic',
        current_revision = 1,
        published_at = 1
    WHERE id = 'page-about';
    UPDATE cms_entity_revisions
    SET snapshot_json =
          '{"blocks":[],"metaDescription":"Synthetic About description.","openGraphAssetId":"asset-phase6","seoTitle":"About","slug":"about-synthetic","title":"About"}',
        canonical_byte_size = length(CAST(
          '{"blocks":[],"metaDescription":"Synthetic About description.","openGraphAssetId":"asset-phase6","seoTitle":"About","slug":"about-synthetic","title":"About"}'
          AS BLOB
        ))
    WHERE id = 'revision-page-about';
    UPDATE cms_entity_publication_states
    SET workflow_status = 'published',
        published_revision_id = 'revision-page-about',
        published_at = 1
    WHERE id = 'state-page-about';
    INSERT INTO page_public_metadata (
      page_id, organization_id, seo_title, meta_description,
      og_media_asset_id,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'page-about', 'org-phase6', 'About',
      'Synthetic About description.', 'asset-phase6',
      'profile-phase6-owner', 1, 1
    );
    INSERT INTO cms_public_materialization_receipts (
      id, organization_id, publication_state_id, entity_type, entity_key,
      revision_id, revision_hash, projection_json, canonical_byte_size,
      actor_profile_id, created_at
    ) VALUES (
      'receipt-page-about', 'org-phase6', 'state-page-about', 'page',
      'page-about', 'revision-page-about', '${"a".repeat(64)}',
      '{"metadata":{"metaDescription":"Synthetic About description.","openGraphAssetId":"asset-phase6","seoTitle":"About"},"page":{"currentRevision":1,"slug":"about-synthetic","title":"About"},"sections":[]}',
      length(CAST(
        '{"metadata":{"metaDescription":"Synthetic About description.","openGraphAssetId":"asset-phase6","seoTitle":"About"},"page":{"currentRevision":1,"slug":"about-synthetic","title":"About"},"sections":[]}'
        AS BLOB
      )),
      'profile-phase6-owner', 1
    );
    UPDATE media_usage_references
    SET usage_kind = 'open_graph',
        publication_scope = 'published'
    WHERE id = 'usage-page';
  `);
  const resourcesSnapshot = JSON.stringify({
    blocks: [
      {
        config: { assetId: "asset-phase6" },
        id: "resource-art",
        type: "media",
      },
    ],
    metaDescription: "Synthetic Resources description.",
    openGraphAssetId: null,
    seoTitle: "Resources",
    slug: "resources",
    title: "Resources",
  });
  const resourcesProjection = JSON.stringify({
    metadata: {
      metaDescription: "Synthetic Resources description.",
      openGraphAssetId: null,
      seoTitle: "Resources",
    },
    page: {
      currentRevision: 1,
      slug: "resources",
      title: "Resources",
    },
    sections: [
      {
        contentJson: JSON.stringify({ assetId: "asset-phase6" }),
        sectionKey: "resource-art",
        sectionType: "media",
        sortOrder: 10,
      },
    ],
  });
  database.exec(`
    INSERT INTO pages (
      id, organization_id, title, slug, status, visibility,
      current_revision, published_at, created_by_profile_id,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'page-resources', 'org-phase6', 'Resources', 'resources',
      'published', 'public', 1, 1, 'profile-phase6-owner',
      'profile-phase6-owner', 1, 1
    );
    INSERT INTO cms_entity_publication_states (
      id, organization_id, entity_type, entity_key, workflow_status,
      content_version, published_revision_id, last_editor_profile_id,
      published_at, created_at, updated_at
    ) VALUES (
      'state-page-resources', 'org-phase6', 'page', 'page-resources',
      'published', 1, 'revision-page-resources',
      'profile-phase6-owner', 1, 1, 1
    );
  `);
  database
    .prepare(
      `INSERT INTO cms_entity_revisions (
         id, organization_id, publication_state_id, entity_type, entity_key,
         revision_number, snapshot_json, content_hash, canonical_byte_size,
         actor_profile_id, created_at
       ) VALUES (
         'revision-page-resources', 'org-phase6', 'state-page-resources',
         'page', 'page-resources', 1, ?, ?, ?,
         'profile-phase6-owner', 1
       )`,
    )
    .bind(
      resourcesSnapshot,
      "6".repeat(64),
      Buffer.byteLength(resourcesSnapshot),
    )
    .runSynchronously();
  database.exec(`
    INSERT INTO page_sections (
      id, organization_id, page_id, section_key, section_type,
      content_json, sort_order, created_at, updated_at
    ) VALUES (
      'section-page-resources-art', 'org-phase6', 'page-resources',
      'resource-art', 'media', '{"assetId":"asset-phase6"}', 10, 1, 1
    );
    INSERT INTO page_public_metadata (
      page_id, organization_id, seo_title, meta_description,
      og_media_asset_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'page-resources', 'org-phase6', 'Resources',
      'Synthetic Resources description.', NULL,
      'profile-phase6-owner', 1, 1
    );
  `);
  database
    .prepare(
      `INSERT INTO cms_public_materialization_receipts (
         id, organization_id, publication_state_id, entity_type, entity_key,
         revision_id, revision_hash, projection_json, canonical_byte_size,
         actor_profile_id, created_at
       ) VALUES (
         'receipt-page-resources', 'org-phase6', 'state-page-resources',
         'page', 'page-resources', 'revision-page-resources', ?, ?, ?,
         'profile-phase6-owner', 1
       )`,
    )
    .bind(
      "6".repeat(64),
      resourcesProjection,
      Buffer.byteLength(resourcesProjection),
    )
    .runSynchronously();
  database.exec(`
    INSERT INTO media_usage_references (
      id, organization_id, asset_id, entity_type, entity_id, revision_id,
      usage_kind, publication_scope, created_by_profile_id, created_at
    ) VALUES (
      'usage-page-resources', 'org-phase6', 'asset-phase6', 'page',
      'page-resources', 'revision-page-resources', 'block:resource-art',
      'published', 'profile-phase6-owner', 1
    );
  `);
  await ensureInvariantReadiness(database);

  database.exec(`
    INSERT INTO media_assets (
      id, organization_id, object_key, file_name, mime_type, byte_size,
      alt_text, credit, rights_status, participant_consent_status,
      is_public, uploaded_by_profile_id, created_at, updated_at
    ) VALUES (
      'asset-phase6-decorative', 'org-phase6',
      'opaque/phase6-decorative/original', 'decorative.png', 'image/png', 100,
      NULL, 'Vancouver Curiosity Club', 'approved', 'not_applicable', 0,
      'profile-phase6-owner', 2, 2
    );
    INSERT INTO media_asset_details (
      asset_id, organization_id, upload_state, informative, content_version,
      original_sha256, width, height, pixel_count, finalized_at,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'asset-phase6-decorative', 'org-phase6', 'ready', 0, 1,
      '${"6".repeat(64)}', 10, 10, 100, 2,
      'profile-phase6-owner', 2, 2
    );
    INSERT INTO media_asset_variants (
      id, organization_id, asset_id, variant_kind, object_key, mime_type,
      byte_size, width, height, pixel_count, sha256, state,
      finalized_at, created_at
    ) VALUES
      (
        'variant-decorative-original', 'org-phase6',
        'asset-phase6-decorative', 'original',
        'opaque/phase6-decorative/original', 'image/png',
        100, 10, 10, 100, '${"6".repeat(64)}', 'ready', 2, 2
      ),
      (
        'variant-decorative-480', 'org-phase6',
        'asset-phase6-decorative', 'webp_480',
        'opaque/phase6-decorative/480', 'image/webp',
        80, 10, 10, 100, '${"7".repeat(64)}', 'ready', 2, 2
      ),
      (
        'variant-decorative-960', 'org-phase6',
        'asset-phase6-decorative', 'webp_960',
        'opaque/phase6-decorative/960', 'image/webp',
        80, 10, 10, 100, '${"8".repeat(64)}', 'ready', 2, 2
      ),
      (
        'variant-decorative-1600', 'org-phase6',
        'asset-phase6-decorative', 'webp_1600',
        'opaque/phase6-decorative/1600', 'image/webp',
        80, 10, 10, 100, '${"9".repeat(64)}', 'ready', 2, 2
      );
  `);
  for (const usageKind of [
    "event_artwork",
    "open_graph",
    "cover",
    "thumbnail",
  ]) {
    assert.throws(
      () =>
        database.sqlite
          .prepare(
            `INSERT INTO media_usage_references (
               id, organization_id, asset_id, entity_type, entity_id,
               revision_id, usage_kind, publication_scope,
               created_by_profile_id, created_at
             ) VALUES (?, 'org-phase6', 'asset-phase6-decorative', 'page',
               'page-about', 'revision-page-about', ?, 'draft',
               'profile-phase6-owner', 2)`,
          )
          .run(`usage-decorative-${usageKind}`, usageKind),
      /phase6_media_useful_alt_required/u,
      `${usageKind} must require useful alt text even for a decorative asset`,
    );
  }

  for (const sql of [
    `UPDATE media_assets
     SET rights_status = 'restricted'
     WHERE id = 'asset-phase6'`,
    `UPDATE media_assets
     SET participant_consent_status = 'unconfirmed'
     WHERE id = 'asset-phase6'`,
    `UPDATE media_assets
     SET credit = NULL
     WHERE id = 'asset-phase6'`,
    `UPDATE media_assets
     SET alt_text = NULL
     WHERE id = 'asset-phase6'`,
    `UPDATE media_asset_details
     SET upload_state = 'deleting'
     WHERE asset_id = 'asset-phase6'`,
    `DELETE FROM media_asset_details
     WHERE asset_id = 'asset-phase6'`,
    `DELETE FROM media_asset_variants
     WHERE id = 'variant-phase6-480'`,
  ]) {
    assert.throws(
      () => database.exec(sql),
      /phase6_media_published_asset_downgrade/u,
    );
  }

  database.exec(`
    INSERT INTO cms_entity_revisions (
      id, organization_id, publication_state_id, entity_type, entity_key,
      revision_number, snapshot_json, content_hash, canonical_byte_size,
      actor_profile_id, created_at
    ) VALUES (
      'revision-page-historical', 'org-phase6', 'state-page-about',
      'page', 'page-about', 2,
      '{"blocks":[],"openGraphAssetId":"asset-phase6"}',
      '${"9".repeat(64)}', 47, 'profile-phase6-owner', 2
    );
  `);
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO media_usage_references (
          id, organization_id, asset_id, entity_type, entity_id, revision_id,
          usage_kind, publication_scope, created_by_profile_id, created_at
        ) VALUES (
          'usage-historical-published', 'org-phase6', 'asset-phase6',
          'page', 'page-about', 'revision-page-historical', 'open_graph',
          'published', 'profile-phase6-owner', 2
        );
      `),
    /phase6_media_usage_not_current_published/u,
  );
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO media_usage_references (
          id, organization_id, asset_id, entity_type, entity_id, revision_id,
          usage_kind, publication_scope, created_by_profile_id, created_at
        ) VALUES (
          'usage-current-wrong-kind', 'org-phase6', 'asset-phase6',
          'page', 'page-about', 'revision-page-about', 'cover',
          'published', 'profile-phase6-owner', 2
        );
      `),
    /phase6_media_usage_not_current_published/u,
  );
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO media_usage_references (
          id, organization_id, asset_id, entity_type, entity_id, revision_id,
          usage_kind, publication_scope, created_by_profile_id, created_at
        ) VALUES (
          'usage-draft-as-published', 'org-phase6', 'asset-phase6',
          'site_og', 'org-phase6', 'revision-site-identity', 'open_graph',
          'published', 'profile-phase6-owner', 2
        );
      `),
    /phase6_media_usage_not_current_published/u,
  );

  await ensureInvariantReadiness(database);
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO cms_public_materialization_receipts (
          id, organization_id, publication_state_id, entity_type, entity_key,
          revision_id, revision_hash, projection_json, canonical_byte_size,
          actor_profile_id, created_at
        ) VALUES (
          'receipt-forged-page-about', 'org-phase6', 'state-page-about',
          'page', 'page-about', 'revision-page-about', '${"f".repeat(64)}',
          '{}', 2, 'profile-phase6-owner', 3
        );
      `),
    /phase6_materialization_revision_mismatch/u,
  );
  assert.throws(
    () =>
      database.exec(`
        DELETE FROM cms_public_materialization_receipts
        WHERE id = 'receipt-page-about';
      `),
    /phase6_materialization_receipt_immutable/u,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM database_invariant_state
         WHERE singleton_key = 'database-guards'`,
      )
      .first("count"),
    1,
  );
  database.exec(`
    UPDATE media_usage_references
    SET deleted_at = 4
    WHERE id = 'usage-page';
  `);
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM database_invariant_state
         WHERE singleton_key = 'database-guards'`,
      )
      .first("count"),
    0,
    "retiring an exact current public usage must invalidate readiness",
  );
  const mediaCompletenessSql = PHASE6_INVARIANT_COUNT_SQL.find((sql) =>
    sql.includes("expected_public_media"),
  );
  assert.ok(mediaCompletenessSql);
  assert.equal(
    await database.prepare(mediaCompletenessSql).first("violation_count"),
    1,
    "an unrelated current Resources usage cannot satisfy About's missing slot",
  );
  await assert.rejects(
    ensureDatabaseInvariants(database),
    (error) => error?.name === "DatabaseInvariantError",
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM media_usage_references
         WHERE id = 'usage-page-resources'
           AND deleted_at IS NULL`,
      )
      .first("count"),
    1,
    "the independent Resources usage remains valid",
  );
});

test("public page, club, and site projections reject cross-organization media on insert and update", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureInvariantReadiness(database);

  assert.throws(
    () =>
      database.exec(`
        INSERT INTO page_public_metadata (
          page_id, organization_id, seo_title, meta_description,
          og_media_asset_id, updated_by_profile_id, created_at, updated_at
        ) VALUES (
          'page-about', 'org-phase6', 'About', 'About page',
          'asset-phase6-other', 'profile-phase6-owner', 2, 2
        );
      `),
    /phase6_page_metadata_media_organization_mismatch/u,
  );
  database.exec(`
    INSERT INTO page_public_metadata (
      page_id, organization_id, seo_title, meta_description,
      og_media_asset_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'page-about', 'org-phase6', 'About', 'About page',
      'asset-phase6', 'profile-phase6-owner', 2, 2
    );
  `);
  assert.throws(
    () =>
      database.exec(`
        UPDATE page_public_metadata
        SET og_media_asset_id = 'asset-phase6-other',
            updated_at = 3
        WHERE page_id = 'page-about';
      `),
    /phase6_page_metadata_media_organization_mismatch/u,
  );

  for (const [cover, thumbnail] of [
    ["asset-phase6-other", "asset-phase6"],
    ["asset-phase6", "asset-phase6-other"],
  ]) {
    assert.throws(
      () =>
        database.exec(`
          INSERT INTO club_public_profile_details (
            club_id, organization_id, public_display_name, short_summary,
            full_description, program_type, cover_media_asset_id,
            thumbnail_media_asset_id, confirmed_social_links_json,
            related_resources_json, updated_by_profile_id,
            created_at, updated_at
          ) VALUES (
            'club-phase6', 'org-phase6', 'Phase 6 Club',
            'A synthetic club summary.', 'A synthetic club description.',
            'club', '${cover}', '${thumbnail}', '[]', '[]',
            'profile-phase6-owner', 2, 2
          );
        `),
      /phase6_club_details_media_organization_mismatch/u,
    );
  }
  database.exec(`
    INSERT INTO club_public_profile_details (
      club_id, organization_id, public_display_name, short_summary,
      full_description, program_type, cover_media_asset_id,
      thumbnail_media_asset_id, confirmed_social_links_json,
      related_resources_json, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'club-phase6', 'org-phase6', 'Phase 6 Club',
      'A synthetic club summary.', 'A synthetic club description.',
      'club', 'asset-phase6', 'asset-phase6', '[]', '[]',
      'profile-phase6-owner', 2, 2
    );
  `);
  for (const column of [
    "cover_media_asset_id",
    "thumbnail_media_asset_id",
  ]) {
    assert.throws(
      () =>
        database.exec(`
          UPDATE club_public_profile_details
          SET ${column} = 'asset-phase6-other', updated_at = 3
          WHERE club_id = 'club-phase6';
        `),
      /phase6_club_details_media_organization_mismatch/u,
    );
  }

  for (const valueJson of [
    JSON.stringify({
      logoAssetId: "asset-phase6-other",
      openGraphAssetId: null,
    }),
    JSON.stringify({
      logoAssetId: null,
      openGraphAssetId: "asset-phase6-other",
    }),
  ]) {
    assert.throws(
      () =>
        database.sqlite
          .prepare(
            `INSERT INTO site_settings (
               id, organization_id, key, value_json, is_public,
               updated_by_profile_id, created_at, updated_at
             ) VALUES (?, ?, 'public_identity', ?, 1, ?, 2, 2)`,
          )
          .run(
            `site-cross-${valueJson.length}`,
            "org-phase6",
            valueJson,
            "profile-phase6-owner",
          ),
      /phase6_site_identity_media_organization_mismatch/u,
    );
  }
  database.sqlite
    .prepare(
      `INSERT INTO site_settings (
         id, organization_id, key, value_json, is_public,
         updated_by_profile_id, created_at, updated_at
       ) VALUES (
         'site-identity', 'org-phase6', 'public_identity', ?, 1,
         'profile-phase6-owner', 2, 2
       )`,
    )
    .run(
      JSON.stringify({
        logoAssetId: "asset-phase6",
        openGraphAssetId: "asset-phase6",
      }),
    );
  for (const valueJson of [
    JSON.stringify({
      logoAssetId: "asset-phase6-other",
      openGraphAssetId: "asset-phase6",
    }),
    JSON.stringify({
      logoAssetId: "asset-phase6",
      openGraphAssetId: "asset-phase6-other",
    }),
  ]) {
    assert.throws(
      () =>
        database.sqlite
          .prepare(
            `UPDATE site_settings
             SET value_json = ?, updated_at = 3
             WHERE id = 'site-identity'`,
          )
          .run(valueJson),
      /phase6_site_identity_media_organization_mismatch/u,
    );
  }
});

test("public page, club, and site projections reject same-organization media that is pending, unapproved, deleted, or legally unsafe", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  insertProjectionMediaFixtures(database);
  await ensureInvariantReadiness(database);

  for (const triggerName of [
    "media_assets_phase6_public_legal_before_insert",
    "media_assets_phase6_public_legal_before_update",
    "media_asset_details_phase6_before_insert",
    "media_asset_details_phase6_before_update",
  ]) {
    database.exec(`DROP TRIGGER ${triggerName};`);
  }
  database.exec(`
    UPDATE media_asset_details
    SET caption = 'Registered nonprofit society artwork', updated_at = 4
    WHERE asset_id = 'asset-phase6-legal';
  `);
  const invalidAssetIds = [
    "asset-phase6-pending",
    "asset-phase6-unapproved",
    "asset-phase6-deleted",
    "asset-phase6-legal",
  ];
  for (const assetId of invalidAssetIds) {
    assert.throws(
      () =>
        database.sqlite
          .prepare(
            `INSERT INTO page_public_metadata (
               page_id, organization_id, seo_title, meta_description,
               og_media_asset_id, updated_by_profile_id, created_at, updated_at
             ) VALUES (
               'page-about', 'org-phase6', 'About', 'About page',
               ?, 'profile-phase6-owner', 2, 2
             )`,
          )
          .run(assetId),
      /phase6_page_metadata_media_organization_mismatch/u,
    );
  }
  database.exec(`
    INSERT INTO page_public_metadata (
      page_id, organization_id, seo_title, meta_description,
      og_media_asset_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'page-about', 'org-phase6', 'About', 'About page',
      'asset-phase6', 'profile-phase6-owner', 2, 2
    );
    INSERT INTO club_public_profile_details (
      club_id, organization_id, public_display_name, short_summary,
      full_description, program_type, cover_media_asset_id,
      thumbnail_media_asset_id, seo_title, meta_description,
      og_media_asset_id, confirmed_social_links_json,
      related_resources_json, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'club-phase6', 'org-phase6', 'Phase 6 Club',
      'A synthetic club summary.', 'A synthetic club description.',
      'club', 'asset-phase6', 'asset-phase6', 'Phase 6 Club',
      'A synthetic club metadata description.', 'asset-phase6', '[]', '[]',
      'profile-phase6-owner', 2, 2
    );
    INSERT INTO site_settings (
      id, organization_id, key, value_json, is_public,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'site-identity', 'org-phase6', 'public_identity',
      '{"logoAssetId":"asset-phase6","openGraphAssetId":"asset-phase6"}',
      1, 'profile-phase6-owner', 2, 2
    );
  `);

  for (const assetId of invalidAssetIds) {
    assert.throws(
      () =>
        database.sqlite
          .prepare(
            `UPDATE page_public_metadata
             SET og_media_asset_id = ?, updated_at = 3
             WHERE page_id = 'page-about'`,
          )
          .run(assetId),
      /phase6_page_metadata_media_organization_mismatch/u,
    );
    for (const column of [
      "cover_media_asset_id",
      "thumbnail_media_asset_id",
    ]) {
      assert.throws(
        () =>
          database.sqlite
            .prepare(
              `UPDATE club_public_profile_details
               SET ${column} = ?, updated_at = 3
               WHERE club_id = 'club-phase6'`,
            )
            .run(assetId),
        /phase6_club_details_media_organization_mismatch/u,
      );
    }
    assert.throws(
      () =>
        database.sqlite
          .prepare(
            `UPDATE club_public_profile_details
             SET og_media_asset_id = ?, updated_at = 3
             WHERE club_id = 'club-phase6'`,
          )
          .run(assetId),
      /phase6_club_details_og_media_not_public_ready/u,
    );
    for (const field of ["logoAssetId", "openGraphAssetId"]) {
      assert.throws(
        () =>
          database.sqlite
            .prepare(
              `UPDATE site_settings
               SET value_json = ?, updated_at = 3
               WHERE id = 'site-identity'`,
            )
            .run(
              JSON.stringify({
                logoAssetId: "asset-phase6",
                openGraphAssetId: "asset-phase6",
                [field]: assetId,
              }),
            ),
        /phase6_site_identity_media_organization_mismatch/u,
      );
    }
  }

  assert.deepEqual(
    {
      ...await database
        .prepare(
          `SELECT metadata.og_media_asset_id,
                  json_extract(setting.value_json, '$.logoAssetId')
                    AS logo_asset_id,
                  json_extract(setting.value_json, '$.openGraphAssetId')
                    AS og_asset_id
           FROM page_public_metadata AS metadata
           JOIN site_settings AS setting
             ON setting.organization_id = metadata.organization_id
            AND setting.key = 'public_identity'
           WHERE metadata.page_id = 'page-about'`,
        )
        .first(),
    },
    {
      logo_asset_id: "asset-phase6",
      og_asset_id: "asset-phase6",
      og_media_asset_id: "asset-phase6",
    },
  );
});

test("runtime media guards reject crafted public legal claims while private rights and consent notes remain allowed", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureInvariantReadiness(database);

  for (const [column, value] of [
    ["alt_text", "Registered charity artwork"],
    ["credit", "BC incorporated society"],
  ]) {
    assert.throws(
      () =>
        database.sqlite
          .prepare(
            `UPDATE media_assets
             SET ${column} = ?, updated_at = 2
             WHERE id = 'asset-phase6'`,
          )
          .run(value),
      /phase6_media_public_legal_claim_unconfirmed/u,
    );
  }
  assert.throws(
    () =>
      database.sqlite
        .prepare(
          `UPDATE media_asset_details
           SET caption = ?, updated_at = 2
           WHERE asset_id = 'asset-phase6'`,
        )
        .run("Tax-deductible category artwork"),
    /phase6_media_public_legal_claim_unconfirmed/u,
  );
  for (const caption of [
    "We are a charity.",
    "A charitable organization.",
    "A not-for-profit organization.",
    "Tax exempt artwork.",
    "Government-funded artwork.",
    "Registered as a charity.",
    "Incorporated under the Societies Act.",
    "Registered with the CRA.",
    "We can issue donation receipts.",
    "Not a registered charity.",
    "Donations are not tax deductible.",
    "We cannot issue tax receipts.",
    "We do not issue donation receipts.",
  ]) {
    assert.throws(
      () =>
        database.sqlite
          .prepare(
            `UPDATE media_asset_details
             SET caption = ?, updated_at = 2
             WHERE asset_id = 'asset-phase6'`,
          )
          .run(caption),
      /phase6_media_public_legal_claim_unconfirmed/u,
      caption,
    );
  }
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO media_assets (
          id, organization_id, object_key, file_name, mime_type, byte_size,
          alt_text, credit, rights_status, participant_consent_status,
          is_public, uploaded_by_profile_id, created_at, updated_at
        ) VALUES (
          'asset-phase6-protected-insert', 'org-phase6',
          'opaque/phase6/protected-insert', 'protected.png', 'image/png', 100,
          'CRA charity registration artwork', 'A safe credit', 'approved',
          'not_applicable', 0, 'profile-phase6-owner', 2, 2
        );
      `),
    /phase6_media_public_legal_claim_unconfirmed/u,
  );
  database.exec(`
    INSERT INTO media_assets (
      id, organization_id, object_key, file_name, mime_type, byte_size,
      alt_text, credit, rights_status, participant_consent_status,
      is_public, uploaded_by_profile_id, created_at, updated_at
    ) VALUES (
      'asset-phase6-caption-insert', 'org-phase6',
      'opaque/phase6/caption-insert', 'caption.png', 'image/png', 100,
      'Safe category artwork', 'A safe credit', 'approved',
      'not_applicable', 0, 'profile-phase6-owner', 2, 2
    );
  `);
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO media_asset_details (
          asset_id, organization_id, upload_state, informative,
          content_version, caption, original_sha256, width, height,
          pixel_count, finalized_at, updated_by_profile_id,
          created_at, updated_at
        ) VALUES (
          'asset-phase6-caption-insert', 'org-phase6', 'ready', 1, 1,
          'Registered society material', '${"6".repeat(64)}', 10, 10, 100, 2,
          'profile-phase6-owner', 2, 2
        );
      `),
    /phase6_media_public_legal_claim_unconfirmed/u,
  );

  database.exec(`
    UPDATE media_asset_details
    SET private_rights_source_note =
          'Private evidence may mention CRA charity registration.',
        private_participant_consent_note =
          'Private source may include a society registration number.',
        updated_at = 2
    WHERE asset_id = 'asset-phase6';
  `);
  assert.deepEqual(
    {
      ...await database
        .prepare(
          `SELECT asset.alt_text, asset.credit, detail.caption,
                  detail.private_rights_source_note,
                  detail.private_participant_consent_note
           FROM media_assets AS asset
           JOIN media_asset_details AS detail
             ON detail.asset_id = asset.id
            AND detail.organization_id = asset.organization_id
           WHERE asset.id = 'asset-phase6'`,
        )
        .first(),
    },
    {
      alt_text: "Original abstract category artwork.",
      caption: null,
      credit: "Vancouver Curiosity Club",
      private_participant_consent_note:
        "Private source may include a society registration number.",
      private_rights_source_note:
        "Private evidence may mention CRA charity registration.",
    },
  );
});

test("global integrity detects crafted protected public media metadata without writing a ready marker", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  const legalIntegritySql = PHASE6_INVARIANT_COUNT_SQL.find(
    (sql) =>
      sql.includes("LEFT JOIN media_asset_details AS detail") &&
      sql.includes("detail.caption") &&
      sql.includes("protected_normalized"),
  );
  assert.ok(legalIntegritySql);
  const variants = [
    "Registered (charity) artwork",
    "Registered/charity artwork",
    "Registered.charity artwork",
    "Registered_charity artwork",
    "Registered\u00b7charity artwork",
    "We are a charity.",
    "Charitable organization artwork.",
    "Not-for-profit organization artwork.",
    "Tax-exempt artwork.",
    "Government-funded artwork.",
    "Registered as a charity.",
    "Incorporated under the Societies Act.",
    "Registered with the CRA.",
    "Can issue donation receipts.",
    "Not a registered charity.",
    "Donations are not tax deductible.",
    "Cannot issue tax receipts.",
    "Do not issue donation receipts.",
  ];
  for (const caption of variants) {
    database.sqlite
      .prepare(
        `UPDATE media_asset_details
         SET caption = ?, updated_at = 2
         WHERE asset_id = 'asset-phase6'`,
      )
      .run(caption);
    assert.equal(
      await database.prepare(legalIntegritySql).first("violation_count"),
      1,
    );
    database.exec(`
      UPDATE media_asset_details
      SET caption = NULL, updated_at = 1
      WHERE asset_id = 'asset-phase6';
    `);
    assert.equal(
      await database.prepare(legalIntegritySql).first("violation_count"),
      0,
    );
  }
  database.sqlite
    .prepare(
      `UPDATE media_asset_details
       SET caption = ?, updated_at = 2
       WHERE asset_id = 'asset-phase6'`,
    )
    .run("Registered,\u200bcharity artwork");
  assert.equal(
    await database.prepare(legalIntegritySql).first("violation_count"),
    1,
  );
  let rejected = false;
  for (
    let attempt = 0;
    attempt < MAX_DATABASE_INVARIANT_READY_ATTEMPTS && !rejected;
    attempt += 1
  ) {
    try {
      await ensureDatabaseInvariants(database);
    } catch (error) {
      assert.match(
        error instanceof Error ? error.message : String(error),
        /Database integrity guards are unavailable/u,
      );
      rejected = true;
    }
  }
  assert.equal(rejected, true);
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM database_invariant_state
         WHERE singleton_key = 'database-guards'`,
      )
      .first("count"),
    0,
  );
});

test("legal receipt, publication, and global guards reject incoherent charity and provincial snapshots", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureInvariantReadiness(database);
  database.exec(`
    INSERT INTO cms_entity_publication_states (
      id, organization_id, entity_type, entity_key, workflow_status,
      content_version, current_draft_revision_id, published_revision_id,
      last_editor_profile_id, created_at, updated_at
    ) VALUES (
      'state-phase6-legal', 'org-phase6', 'legal_status', 'legal_status',
      'archived', 1, NULL, NULL, 'profile-phase6-owner', 2, 2
    );
  `);
  const neutral = {
    charityNumber: null,
    charityStatus: "unconfirmed",
    effectiveDate: null,
    footerWording: null,
    jurisdiction: null,
    legalFormWording: null,
    legalName: null,
    registrationNumber: null,
  };
  const contradictorySnapshots = [
    {
      ...neutral,
      footerWording: "We are registered as a charity.",
    },
    {
      ...neutral,
      charityNumber: "SYNTHETIC-CHARITY",
      charityStatus: "registered",
      footerWording: "We are not a registered charity.",
    },
    {
      ...neutral,
      footerWording: "We cannot issue tax receipts.",
    },
    {
      ...neutral,
      footerWording: "Incorporated under the Societies Act.",
      legalName: "Synthetic Test Organization",
    },
  ];
  for (const [index, snapshot] of contradictorySnapshots.entries()) {
    const revisionId = `revision-phase6-legal-${index}`;
    const snapshotJson = JSON.stringify(snapshot);
    database.sqlite
      .prepare(
        `INSERT INTO cms_entity_revisions (
           id, organization_id, publication_state_id, entity_type,
           entity_key, revision_number, snapshot_json, content_hash,
           canonical_byte_size, actor_profile_id, created_at
         ) VALUES (
           ?, 'org-phase6', 'state-phase6-legal', 'legal_status',
           'legal_status', ?, ?, ?, ?, 'profile-phase6-owner', ?
         )`,
      )
      .run(
        revisionId,
        index + 1,
        snapshotJson,
        (index + 6).toString(16).repeat(64),
        Buffer.byteLength(snapshotJson),
        3 + index,
      );
    assert.throws(
      () =>
        database.sqlite
          .prepare(
            `INSERT INTO legal_status_confirmation_receipts (
               id, organization_id, revision_id, revision_hash, action,
               actor_profile_id, revokes_receipt_id, created_at
             ) VALUES (
               ?, 'org-phase6', ?, ?, 'confirmed',
               'profile-phase6-owner', NULL, ?
             )`,
          )
          .run(
            `receipt-phase6-legal-${index}`,
            revisionId,
            (index + 6).toString(16).repeat(64),
            10 + index,
          ),
      /phase6_legal_confirmation_mismatch/u,
    );
  }
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM legal_status_confirmation_receipts
         WHERE organization_id = 'org-phase6'`,
      )
      .first("count"),
    0,
  );

  database.exec(`
    UPDATE cms_entity_publication_states
    SET workflow_status = 'draft',
        current_draft_revision_id = 'revision-phase6-legal-0',
        draft_updated_at = 20,
        updated_at = 20
    WHERE id = 'state-phase6-legal';
    DROP TRIGGER legal_status_confirmation_receipts_phase6_before_insert;
    INSERT INTO legal_status_confirmation_receipts (
      id, organization_id, revision_id, revision_hash, action,
      actor_profile_id, revokes_receipt_id, created_at
    ) VALUES (
      'receipt-phase6-legal-crafted', 'org-phase6',
      'revision-phase6-legal-0', '${"6".repeat(64)}', 'confirmed',
      'profile-phase6-owner', NULL, 21
    );
  `);
  assert.throws(
    () =>
      database.exec(`
        UPDATE cms_entity_publication_states
        SET workflow_status = 'published',
            published_revision_id = 'revision-phase6-legal-0',
            published_at = 22,
            content_version = 2,
            updated_at = 22
        WHERE id = 'state-phase6-legal';
      `),
    /phase6_legal_confirmation_required/u,
  );
  assert.deepEqual(
    {
      ...await database
        .prepare(
          `SELECT workflow_status, published_revision_id, content_version
           FROM cms_entity_publication_states
           WHERE id = 'state-phase6-legal'`,
        )
        .first(),
    },
    {
      content_version: 1,
      published_revision_id: null,
      workflow_status: "draft",
    },
  );
  const legalIntegritySql = PHASE6_INVARIANT_COUNT_SQL.find((sql) =>
    sql.includes("FROM legal_status_confirmation_receipts AS receipt"),
  );
  assert.ok(legalIntegritySql);
  assert.equal(
    await database.prepare(legalIntegritySql).first("violation_count"),
    1,
  );
  let rejected = false;
  for (
    let attempt = 0;
    attempt < MAX_DATABASE_INVARIANT_READY_ATTEMPTS && !rejected;
    attempt += 1
  ) {
    try {
      await ensureDatabaseInvariants(database);
    } catch (error) {
      assert.match(
        error instanceof Error ? error.message : String(error),
        /Database integrity guards are unavailable/u,
      );
      rejected = true;
    }
  }
  assert.equal(rejected, true);
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM database_invariant_state
         WHERE singleton_key = 'database-guards'`,
      )
      .first("count"),
    0,
  );
});

test("club SEO and Open Graph metadata require bounded text and same-organization public-ready media", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureInvariantReadiness(database);
  database.exec(`
    INSERT INTO media_assets (
      id, organization_id, object_key, file_name, mime_type, byte_size,
      alt_text, credit, rights_status, participant_consent_status,
      is_public, uploaded_by_profile_id, created_at, updated_at
    ) VALUES (
      'asset-phase6-pending', 'org-phase6', 'opaque/phase6/pending',
      'pending.png', 'image/png', 100, 'Pending artwork.',
      'Vancouver Curiosity Club', 'approved', 'not_applicable', 0,
      'profile-phase6-owner', 2, 2
    );
    INSERT INTO club_public_profile_details (
      club_id, organization_id, public_display_name, short_summary,
      full_description, program_type, seo_title, meta_description,
      og_media_asset_id, confirmed_social_links_json,
      related_resources_json, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'club-phase6', 'org-phase6', 'Phase 6 Club',
      'A synthetic club summary.', 'A synthetic club description.',
      'club', 'Phase 6 Club', 'A bounded metadata description.',
      'asset-phase6', '[]', '[]', 'profile-phase6-owner', 2, 2
    );
  `);
  assert.deepEqual(
    {
      ...await database
        .prepare(
          `SELECT seo_title, meta_description, og_media_asset_id
           FROM club_public_profile_details
           WHERE club_id = 'club-phase6'`,
        )
        .first(),
    },
    {
      meta_description: "A bounded metadata description.",
      og_media_asset_id: "asset-phase6",
      seo_title: "Phase 6 Club",
    },
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE club_public_profile_details
        SET og_media_asset_id = 'asset-phase6-other', updated_at = 3
        WHERE club_id = 'club-phase6';
      `),
    /phase6_club_details_og_media_not_public_ready/u,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE club_public_profile_details
        SET og_media_asset_id = 'asset-phase6-pending', updated_at = 3
        WHERE club_id = 'club-phase6';
      `),
    /phase6_club_details_og_media_not_public_ready/u,
  );
  assert.throws(
    () =>
      database.sqlite
        .prepare(
          `UPDATE club_public_profile_details
           SET seo_title = ?, updated_at = 3
           WHERE club_id = 'club-phase6'`,
        )
        .run("x".repeat(61)),
    /club_public_profile_details_seo_title_check/u,
  );
  assert.throws(
    () =>
      database.sqlite
        .prepare(
          `UPDATE club_public_profile_details
           SET meta_description = ?, updated_at = 3
           WHERE club_id = 'club-phase6'`,
        )
        .run("x".repeat(161)),
    /club_public_profile_details_meta_description_check/u,
  );
});

test("event SEO metadata is organization-scoped, authorized, immutable in identity, and privately draftable", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureInvariantReadiness(database);
  database.exec(`
    INSERT INTO organizer_events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, summary, description, planning_status,
      publication_status, schedule_shape, timezone,
      content_version, schedule_version, created_by_profile_id,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'event-phase6', 'org-phase6', 'club-phase6',
      'profile-phase6-owner', 'Private Phase 6 event',
      'private-phase6-event', 'A private summary.',
      'A private description.', 'idea', 'private', 'unscheduled',
      'America/Vancouver', 1, 1, 'profile-phase6-owner',
      'profile-phase6-owner', 1, 1
    );
    INSERT INTO organizer_event_public_metadata (
      organizer_event_id, organization_id, seo_title, meta_description,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'event-phase6', 'org-phase6', 'Private registered charity draft',
      'This protected wording remains private until confirmed.',
      'profile-phase6-owner', 2, 2
    );
  `);
  assert.throws(
    () =>
      database.exec(`
        UPDATE organizer_event_public_metadata
        SET updated_by_profile_id = 'profile-phase6-other', updated_at = 3
        WHERE organizer_event_id = 'event-phase6';
      `),
    /phase6_event_public_metadata_unauthorized/u,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE organizer_event_public_metadata
        SET created_at = 3, updated_at = 3
        WHERE organizer_event_id = 'event-phase6';
      `),
    /phase6_event_public_metadata_unauthorized/u,
  );
  assert.throws(
    () =>
      database.sqlite
        .prepare(
          `UPDATE organizer_event_public_metadata
           SET seo_title = ?, updated_at = 3
           WHERE organizer_event_id = 'event-phase6'`,
        )
        .run("x".repeat(61)),
    /organizer_event_public_metadata_seo_title_check/u,
  );
});

test("scheduled or published protected event claims are a Phase 6 global integrity violation", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  database.exec(`
    INSERT INTO organizer_events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, summary, description, planning_status,
      publication_status, schedule_shape, starts_at_utc, ends_at_utc,
      timezone, content_version, schedule_version,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'event-phase6', 'org-phase6', 'club-phase6',
      'profile-phase6-owner', 'Private Phase 6 event', 'private-phase6-event',
      'A private summary.', 'A private description.', 'confirmed',
      'private', 'timed', 10000, 20000, 'America/Vancouver', 1, 1,
      'profile-phase6-owner', 'profile-phase6-owner', 1, 1
    );
    INSERT INTO organizer_event_public_metadata (
      organizer_event_id, organization_id, seo_title, meta_description,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'event-phase6', 'org-phase6', 'Registered charity event',
      'Synthetic private legal wording.',
      'profile-phase6-owner', 2, 2
    );
    UPDATE organizer_events
    SET publication_status = 'published'
    WHERE id = 'event-phase6';
  `);
  const legalIntegritySql = PHASE6_INVARIANT_COUNT_SQL.find((sql) =>
    sql.includes("event.publication_status IN ('scheduled', 'published')"),
  );
  assert.ok(legalIntegritySql);
  assert.equal(
    await database.prepare(legalIntegritySql).first("violation_count"),
    1,
  );
});

test("runtime guards reject post-preflight protected claims across every published event surface", (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  database.exec(`
    INSERT INTO organizer_events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, summary, description, planning_status,
      publication_status, schedule_shape, starts_at_utc, ends_at_utc,
      timezone, content_version, schedule_version,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'event-phase6', 'org-phase6', 'club-phase6',
      'profile-phase6-owner', 'Published Phase 6 event',
      'published-phase6-event', 'A safe public summary.',
      'A safe public description.', 'confirmed', 'published', 'timed',
      10000, 20000, 'America/Vancouver', 1, 1,
      'profile-phase6-owner', 'profile-phase6-owner', 1, 1
    );
    INSERT INTO organizer_event_public_details (
      organizer_event_id, organization_id, attendance_mode,
      public_location_name, availability_state, public_hosts_enabled,
      rsvp_mode, created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'event-phase6', 'org-phase6', 'in_person', 'A public venue',
      'open', 0, 'coming_soon', 'profile-phase6-owner',
      'profile-phase6-owner', 1, 1
    );
    INSERT INTO organizer_event_public_metadata (
      organizer_event_id, organization_id, seo_title, meta_description,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'event-phase6', 'org-phase6', 'A safe event title',
      'A safe public event description.', 'profile-phase6-owner', 1, 1
    );
  `);
  for (const triggerSql of PHASE6_INVARIANT_TRIGGER_STATEMENTS.filter(
    (sql) =>
      /organizer_events_phase6_public_legal_before_update|organizer_event_public_details_phase6_legal_before_update|organizer_event_public_metadata_phase6_before_update/u.test(
        sql,
      ),
  )) {
    database.exec(triggerSql);
  }
  for (const title of [
    "Registered, charity event",
    "Registered (charity) event",
    "Registered/charity event",
    "Registered.charity event",
    "Registered_charity event",
    "Registered\u00b7charity event",
    "Registered\u200bcharity event",
    "Registered char\u200city event",
    "Registered char\u200dity event",
    "Registered\u2060charity event",
    "Registered char\ufeffity event",
    "Registered\u2066charity\u2069 event",
  ]) {
    assert.throws(
      () =>
        database.sqlite
          .prepare(
            `UPDATE organizer_events
             SET title = ?, updated_at = 2
             WHERE id = 'event-phase6'`,
          )
          .run(title),
      /phase6_event_public_legal_claim_unconfirmed/u,
    );
  }
  assert.throws(
    () =>
      database.exec(`
        UPDATE organizer_event_public_details
        SET cost_text = 'Tax-deductible admission', updated_at = 2
        WHERE organizer_event_id = 'event-phase6';
      `),
    /phase6_event_public_legal_claim_unconfirmed/u,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE organizer_event_public_metadata
        SET meta_description = 'CRA charity registration',
            updated_at = 2
        WHERE organizer_event_id = 'event-phase6';
      `),
    /phase6_event_public_legal_claim_unconfirmed/u,
  );
  assert.deepEqual(
    {
      ...database.sqlite
        .prepare(
          `SELECT event.title, detail.cost_text, metadata.meta_description
           FROM organizer_events AS event
           JOIN organizer_event_public_details AS detail
             ON detail.organizer_event_id = event.id
           JOIN organizer_event_public_metadata AS metadata
             ON metadata.organizer_event_id = event.id
           WHERE event.id = 'event-phase6'`,
        )
        .get(),
    },
    {
      cost_text: null,
      meta_description: "A safe public event description.",
      title: "Published Phase 6 event",
    },
  );
});

test("global Phase 6 integrity rejects same-organization pending, unapproved, and deleted public media residue", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  insertProjectionMediaFixtures(database);
  database.exec(`
    INSERT INTO page_public_metadata (
      page_id, organization_id, seo_title, meta_description,
      og_media_asset_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'page-about', 'org-phase6', 'About', 'About page',
      'asset-phase6-pending', 'profile-phase6-owner', 2, 2
    );
    INSERT INTO club_public_profile_details (
      club_id, organization_id, public_display_name, short_summary,
      full_description, program_type, cover_media_asset_id,
      thumbnail_media_asset_id, seo_title, meta_description,
      og_media_asset_id, confirmed_social_links_json,
      related_resources_json, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'club-phase6', 'org-phase6', 'Phase 6 Club',
      'A synthetic club summary.', 'A synthetic club description.',
      'club', 'asset-phase6-unapproved', 'asset-phase6-unapproved',
      'Phase 6 Club', 'A synthetic club metadata description.',
      'asset-phase6-unapproved', '[]', '[]',
      'profile-phase6-owner', 2, 2
    );
    INSERT INTO site_settings (
      id, organization_id, key, value_json, is_public,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'site-identity-unready', 'org-phase6', 'public_identity',
      '{"logoAssetId":"asset-phase6-deleted","openGraphAssetId":"asset-phase6-deleted"}',
      1, 'profile-phase6-owner', 2, 2
    );
  `);
  const projectionChecks = [
    [
      "page metadata",
      PHASE6_INVARIANT_COUNT_SQL.find((sql) =>
        /^\s*SELECT count\(\*\) AS violation_count\s+FROM page_public_metadata AS metadata/u.test(
          sql,
        ),
      ),
    ],
    [
      "club profile",
      PHASE6_INVARIANT_COUNT_SQL.find((sql) =>
        /^\s*SELECT count\(\*\) AS violation_count\s+FROM club_public_profile_details AS detail/u.test(
          sql,
        ),
      ),
    ],
    [
      "site identity",
      PHASE6_INVARIANT_COUNT_SQL.find(
        (sql) =>
          /^\s*SELECT count\(\*\) AS violation_count\s+FROM site_settings AS setting/u.test(
            sql,
          ) &&
          sql.includes("$.logoAssetId"),
      ),
    ],
  ];
  assert.equal(projectionChecks.every(([, sql]) => Boolean(sql)), true);
  for (const [label, sql] of projectionChecks) {
    assert.equal(
      await database.prepare(sql).first("violation_count"),
      1,
      label,
    );
  }
  let rejected = false;
  for (
    let attempt = 0;
    attempt < MAX_DATABASE_INVARIANT_READY_ATTEMPTS && !rejected;
    attempt += 1
  ) {
    try {
      await ensureDatabaseInvariants(database);
    } catch (error) {
      assert.match(
        error instanceof Error ? error.message : String(error),
        /Database integrity guards are unavailable/u,
      );
      rejected = true;
    }
  }
  assert.equal(rejected, true);
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM database_invariant_state
         WHERE singleton_key = 'database-guards'`,
      )
      .first("count"),
    0,
  );
});

test("global Phase 6 integrity rejects cross-organization media projection residue without a ready marker", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  database.exec(`
    INSERT INTO page_public_metadata (
      page_id, organization_id, seo_title, meta_description,
      og_media_asset_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'page-about', 'org-phase6', 'About', 'About page',
      'asset-phase6-other', 'profile-phase6-owner', 2, 2
    );
    INSERT INTO club_public_profile_details (
      club_id, organization_id, public_display_name, short_summary,
      full_description, program_type, cover_media_asset_id,
      thumbnail_media_asset_id, confirmed_social_links_json,
      related_resources_json, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'club-phase6', 'org-phase6', 'Phase 6 Club',
      'A synthetic club summary.', 'A synthetic club description.',
      'club', 'asset-phase6-other', 'asset-phase6-other', '[]', '[]',
      'profile-phase6-owner', 2, 2
    );
    INSERT INTO site_settings (
      id, organization_id, key, value_json, is_public,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'site-identity-cross', 'org-phase6', 'public_identity',
      '{"logoAssetId":"asset-phase6-other","openGraphAssetId":"asset-phase6-other"}',
      1, 'profile-phase6-owner', 2, 2
    );
  `);
  let rejected = false;
  for (
    let attempt = 0;
    attempt < MAX_DATABASE_INVARIANT_READY_ATTEMPTS && !rejected;
    attempt += 1
  ) {
    try {
      await ensureDatabaseInvariants(database);
    } catch (error) {
      assert.match(
        error instanceof Error ? error.message : String(error),
        /Database integrity guards are unavailable/u,
      );
      rejected = true;
    }
  }
  assert.equal(rejected, true);
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM database_invariant_state
         WHERE singleton_key = 'database-guards'`,
      )
      .first("count"),
    0,
  );
});

function insertProjectionMediaFixtures(database) {
  for (const fixture of [
    {
      deletedAt: null,
      id: "asset-phase6-pending",
      rightsStatus: "approved",
      uploadState: "pending",
    },
    {
      deletedAt: null,
      id: "asset-phase6-unapproved",
      rightsStatus: "unconfirmed",
      uploadState: "ready",
    },
    {
      deletedAt: 2,
      id: "asset-phase6-deleted",
      rightsStatus: "approved",
      uploadState: "ready",
    },
    {
      deletedAt: null,
      id: "asset-phase6-legal",
      rightsStatus: "approved",
      uploadState: "ready",
    },
  ]) {
    database.sqlite
      .prepare(
        `INSERT INTO media_assets (
           id, organization_id, object_key, file_name, mime_type, byte_size,
           alt_text, credit, rights_status, participant_consent_status,
           is_public, uploaded_by_profile_id, created_at, updated_at,
           deleted_at
         ) VALUES (
           ?, 'org-phase6', ?, ?, 'image/png', 100,
           'Safe abstract category artwork.', 'Vancouver Curiosity Club', ?,
           'not_applicable', 0, 'profile-phase6-owner', 2, 2, ?
         )`,
      )
      .run(
        fixture.id,
        `opaque/phase6/${fixture.id}`,
        `${fixture.id}.png`,
        fixture.rightsStatus,
        fixture.deletedAt,
      );
    database.sqlite
      .prepare(
        `INSERT INTO media_asset_details (
           asset_id, organization_id, upload_state, informative,
           content_version, original_sha256, width, height, pixel_count,
           finalized_at, updated_by_profile_id, created_at, updated_at
         ) VALUES (
           ?, 'org-phase6', ?, 1, 1, ?, ?, ?, ?, ?,
           'profile-phase6-owner', 2, 2
         )`,
      )
      .run(
        fixture.id,
        fixture.uploadState,
        fixture.uploadState === "ready" ? "7".repeat(64) : null,
        fixture.uploadState === "ready" ? 10 : null,
        fixture.uploadState === "ready" ? 10 : null,
        fixture.uploadState === "ready" ? 100 : null,
        fixture.uploadState === "ready" ? 2 : null,
      );
    for (const [index, variantKind] of [
      "original",
      "webp_480",
      "webp_960",
      "webp_1600",
    ].entries()) {
      database.sqlite
        .prepare(
          `INSERT INTO media_asset_variants (
             id, organization_id, asset_id, variant_kind, object_key,
             mime_type, byte_size, width, height, pixel_count, sha256,
             state, finalized_at, created_at
           ) VALUES (
             ?, 'org-phase6', ?, ?, ?, ?, 80, 10, 10, 100, ?,
             'ready', 2, 2
           )`,
        )
        .run(
          `variant-${fixture.id}-${variantKind}`,
          fixture.id,
          variantKind,
          `opaque/phase6/${fixture.id}/${variantKind}`,
          variantKind === "original" ? "image/png" : "image/webp",
          String((index + 6) % 10).repeat(64),
        );
    }
  }
}

async function ensureInvariantReadiness(database) {
  let lastError = null;
  const statusHistory = [];
  for (
    let attempt = 0;
    attempt < MAX_DATABASE_INVARIANT_READY_ATTEMPTS;
    attempt += 1
  ) {
    try {
      const status = await ensureDatabaseInvariants(database);
      statusHistory.push(status);
      lastError = null;
      const version = await database
        .prepare(
          `SELECT version
           FROM database_invariant_state
           WHERE singleton_key = 'database-guards'`,
        )
        .first("version");
      if (
        status === "ready" &&
        version === DATABASE_INVARIANT_VERSION
      ) {
        return;
      }
    } catch (error) {
      statusHistory.push(error instanceof Error ? error.name : String(error));
      lastError = error;
    }
  }
  const phase6Counts = [];
  for (const [index, sql] of PHASE6_INVARIANT_COUNT_SQL.entries()) {
    try {
      phase6Counts.push([
        index,
        Number(
          (await database.prepare(sql).first("violation_count")) ?? 0,
        ),
      ]);
    } catch (error) {
      phase6Counts.push([
        index,
        error instanceof Error ? error.message : String(error),
      ]);
    }
  }
  assert.fail(
    `runtime invariant installation did not reach v6 readiness (${lastError?.message ?? "no error"}): statuses=${JSON.stringify(statusHistory)} counts=${JSON.stringify(phase6Counts)}`,
  );
}
