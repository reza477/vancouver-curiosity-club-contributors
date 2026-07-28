import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  authorizeOrganizerEventMediaSelection,
  deleteMediaAsset,
  getPrivateMediaVariant,
  getPublicMediaVariant,
  listMediaAssets,
  listPendingMediaCleanups,
  retryDeletedMediaCleanup,
  updateMediaAssetMetadata,
  uploadMediaAsset,
} from "../../lib/server/media/storage.ts";
import {
  SqliteD1TestDatabase,
  startSqliteD1StatementRecording,
} from "../auth/sqlite-d1.mjs";
import {
  assertRecordedD1ShapesCompile,
} from "../database/d1-recorded-shapes.mjs";
import { pngBytes, webpBytes } from "./image-fixtures.mjs";
import {
  prepareMediaUsageReconciliation,
  resolveMediaAssetsForRendering,
  resolvePublishedMediaAsset,
  validateMediaAssetsForUsage,
} from "../../lib/server/media/usage.ts";
import {
  resolvePublicEventMetadataImage,
} from "../../lib/server/public/metadata.ts";

const mediaSqlRecording = startSqliteD1StatementRecording({
  sourceIncludes: [],
});

const ownerIdentity = Object.freeze({
  displayName: "Owner",
  email: "owner@example.test",
  source: "sites-siwc",
});
const adminIdentity = Object.freeze({
  displayName: "Administrator",
  email: "admin@example.test",
  source: "sites-siwc",
});
const organizerIdentity = Object.freeze({
  displayName: "Organizer",
  email: "organizer@example.test",
  source: "sites-siwc",
});
const otherOrganizerIdentity = Object.freeze({
  displayName: "Other Organizer",
  email: "other@example.test",
  source: "sites-siwc",
});
const BASE_NOW = Date.parse("2030-01-01T08:00:00.000Z");
const decodeProbe = async () => {};
const ownerMembership = Object.freeze({
  membershipId: "membership-owner",
  organizationId: "org-main",
  profileId: "profile-owner",
  role: "owner",
});

test("Owner/Admin upload creates pending-to-ready metadata and four opaque R2 objects without exposing keys", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket();
  t.after(() => database.close());

  const asset = await uploadMediaAsset(
    database,
    bucket,
    ownerIdentity,
    uploadInput(),
    { decodeProbe, nowUtcMs: BASE_NOW },
  );
  assert.equal(asset.uploadState, "ready");
  assert.equal(asset.contentVersion, 1);
  assert.equal(asset.variants.length, 4);
  assert.equal(asset.width, 1600);
  assert.equal(asset.height, 900);
  assert.equal(bucket.objects.size, 4);
  assert.doesNotMatch(JSON.stringify(asset), /media\/[0-9a-f-]+\//u);

  const rows = all(
    database,
    `SELECT variant_kind, object_key, state
     FROM media_asset_variants
     WHERE asset_id = ?
     ORDER BY variant_kind`,
    asset.id,
  );
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.state === "ready"));
  assert.ok(
    rows.every((row) =>
      /^media\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/u.test(row.object_key),
    ),
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM audit_logs
       WHERE entity_id = ?
         AND action IN ('media.upload_started', 'media.upload_finalized')`,
      asset.id,
    ),
    2,
  );

  const adminAsset = await uploadMediaAsset(
    database,
    bucket,
    adminIdentity,
    uploadInput({ fileName: "admin.png" }),
    { decodeProbe, nowUtcMs: BASE_NOW + 1 },
  );
  assert.equal(adminAsset.uploadState, "ready");
});

test("public media metadata rejects protected legal claims on upload and update while private notes remain private", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket();
  t.after(() => database.close());

  for (const [field, value] of [
    ["altText", "Registered charity artwork."],
    ["caption", "A society registration document."],
    ["credit", "Registered nonprofit society"],
  ]) {
    await assert.rejects(
      uploadMediaAsset(
        database,
        bucket,
        ownerIdentity,
        uploadInput({
          fileName: `protected-${field}.png`,
          metadata: { ...approvedMetadata(), [field]: value },
        }),
        { decodeProbe, nowUtcMs: BASE_NOW },
      ),
      (error) =>
        error?.name === "InputValidationError" &&
        error.issues?.some(
          (issue) =>
            issue.code === "protected_legal_claim" &&
            issue.path === `metadata.${field}`,
        ),
    );
  }
  assert.equal(bucket.objects.size, 0);

  const metadata = {
    ...approvedMetadata(),
    participantConsentNote:
      "Private evidence may mention CRA charity registration.",
    rightsSourceNote:
      "Private source note may mention a registration number.",
  };
  const asset = await uploadMediaAsset(
    database,
    bucket,
    ownerIdentity,
    uploadInput({ metadata }),
    { decodeProbe, nowUtcMs: BASE_NOW + 1 },
  );
  assert.equal(asset.uploadState, "ready");

  for (const [field, value] of [
    ["altText", "Tax-deductible artwork."],
    ["caption", "Registered society material."],
    ["credit", "CRA charity"],
  ]) {
    await assert.rejects(
      updateMediaAssetMetadata(
        database,
        ownerIdentity,
        asset.id,
        asset.contentVersion,
        { ...metadata, [field]: value },
        { nowUtcMs: BASE_NOW + 2 },
      ),
      (error) =>
        error?.name === "InputValidationError" &&
        error.issues?.some(
          (issue) =>
            issue.code === "protected_legal_claim" &&
            issue.path === `metadata.${field}`,
        ),
    );
  }
  assert.deepEqual(
    {
      ...database.sqlite
        .prepare(
          `SELECT asset.alt_text, asset.credit, detail.caption,
                  detail.private_rights_source_note,
                  detail.private_participant_consent_note,
                  detail.content_version
           FROM media_assets AS asset
           JOIN media_asset_details AS detail
             ON detail.asset_id = asset.id
            AND detail.organization_id = asset.organization_id
           WHERE asset.id = ?`,
        )
        .get(asset.id),
    },
    {
      alt_text: approvedMetadata().altText,
      caption: approvedMetadata().caption,
      content_version: 1,
      credit: approvedMetadata().credit,
      private_participant_consent_note:
        metadata.participantConsentNote,
      private_rights_source_note: metadata.rightsSourceNote,
    },
  );
});

test("public media DTOs, metadata, and bytes suppress crafted protected claims without exposing private notes", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket();
  t.after(() => database.close());
  const metadata = {
    ...approvedMetadata(),
    participantConsentNote:
      "Private evidence may mention registered charity evidence.",
    rightsSourceNote:
      "Private source may include a registration number.",
  };
  const asset = await uploadMediaAsset(
    database,
    bucket,
    ownerIdentity,
    uploadInput({ metadata }),
    { decodeProbe, nowUtcMs: BASE_NOW },
  );
  insertUsage(database, asset.id, "published");
  insertSiteOgUsage(database, asset.id);

  const publicMedia = await resolveMediaAssetsForRendering(database, {
    organizationId: "org-main",
    publicationScope: "published",
    usages: [
      {
        assetId: asset.id,
        entityKey: "about",
        entityType: "page",
        usageKind: "block:hero",
      },
    ],
  });
  assert.equal(publicMedia.length, 1);
  assert.doesNotMatch(
    JSON.stringify(publicMedia),
    /registered charity evidence|registration number/iu,
  );
  assert.deepEqual(
    await resolvePublicEventMetadataImage(database, {
      artwork: null,
      organizationId: "org-main",
      siteOpenGraphAssetId: asset.id,
    }),
    {
      altText: approvedMetadata().altText,
      height: 900,
      path: `/media/${asset.id}/webp_1600`,
      width: 1600,
    },
  );

  const mutations = [
    {
      apply: () =>
        database.sqlite
          .prepare(
            `UPDATE media_assets SET alt_text = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run("Registered charity artwork.", BASE_NOW + 1, asset.id),
      restore: () =>
        database.sqlite
          .prepare(
            `UPDATE media_assets SET alt_text = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(metadata.altText, BASE_NOW + 2, asset.id),
    },
    {
      apply: () =>
        database.sqlite
          .prepare(
            `UPDATE media_asset_details SET caption = ?, updated_at = ?
             WHERE asset_id = ?`,
          )
          .run("Tax-deductible artwork.", BASE_NOW + 3, asset.id),
      restore: () =>
        database.sqlite
          .prepare(
            `UPDATE media_asset_details SET caption = ?, updated_at = ?
             WHERE asset_id = ?`,
          )
          .run(metadata.caption, BASE_NOW + 4, asset.id),
    },
    {
      apply: () =>
        database.sqlite
          .prepare(
            `UPDATE media_assets SET credit = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run("CRA charity", BASE_NOW + 5, asset.id),
      restore: () =>
        database.sqlite
          .prepare(
            `UPDATE media_assets SET credit = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(metadata.credit, BASE_NOW + 6, asset.id),
    },
  ];
  for (const mutation of mutations) {
    mutation.apply();
    assert.deepEqual(
      await resolveMediaAssetsForRendering(database, {
        organizationId: "org-main",
        publicationScope: "published",
        usages: [
          {
            assetId: asset.id,
            entityKey: "about",
            entityType: "page",
            usageKind: "block:hero",
          },
        ],
      }),
      [],
    );
    assert.equal(
      await resolvePublishedMediaAsset(database, {
        assetId: asset.id,
        organizationId: "org-main",
        variant: "webp_1600",
      }),
      null,
    );
    assert.equal(
      await resolvePublicEventMetadataImage(database, {
        artwork: null,
        organizationId: "org-main",
        siteOpenGraphAssetId: asset.id,
      }),
      null,
    );
    await assert.rejects(
      getPublicMediaVariant(
        database,
        bucket,
        asset.id,
        "webp_1600",
      ),
      (error) => error?.code === "not_found",
    );
    mutation.restore();
  }
});

test("Organizer cannot upload or manage media and selection is limited to approved assets on assigned owned/co-organized events", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket();
  t.after(() => database.close());
  const asset = await uploadMediaAsset(
    database,
    bucket,
    ownerIdentity,
    uploadInput(),
    { decodeProbe, nowUtcMs: BASE_NOW },
  );
  const decorativeWithoutAlt = await uploadMediaAsset(
    database,
    bucket,
    ownerIdentity,
    uploadInput({
      fileName: "decorative-event-artwork.png",
      metadata: {
        ...approvedMetadata(),
        altText: null,
        informative: false,
      },
    }),
    { decodeProbe, nowUtcMs: BASE_NOW + 1 },
  );

  await assert.rejects(
    uploadMediaAsset(database, bucket, organizerIdentity, uploadInput(), {
      decodeProbe,
      nowUtcMs: BASE_NOW,
    }),
    (error) => error?.code === "authorization_denied",
  );
  await assert.rejects(
    updateMediaAssetMetadata(
      database,
      organizerIdentity,
      asset.id,
      asset.contentVersion,
      approvedMetadata(),
    ),
    (error) => error?.code === "authorization_denied",
  );

  assert.deepEqual(
    await authorizeOrganizerEventMediaSelection(
      database,
      organizerIdentity,
      "event-organizer",
      asset.id,
    ),
    { assetId: asset.id, organizationId: "org-main" },
  );
  await authorizeOrganizerEventMediaSelection(
    database,
    organizerIdentity,
    "event-co-organizer",
    asset.id,
  );
  await assert.rejects(
    authorizeOrganizerEventMediaSelection(
      database,
      otherOrganizerIdentity,
      "event-organizer",
      asset.id,
    ),
    (error) => error?.code === "not_found",
  );
  await assert.rejects(
    authorizeOrganizerEventMediaSelection(
      database,
      organizerIdentity,
      "event-organizer",
      decorativeWithoutAlt.id,
    ),
    (error) => error?.code === "not_found",
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM media_usage_references
       WHERE asset_id = ?`,
      decorativeWithoutAlt.id,
    ),
    0,
  );
  await assert.rejects(
    authorizeOrganizerEventMediaSelection(
      database,
      organizerIdentity,
      "event-other-club",
      asset.id,
    ),
    (error) => error?.code === "not_found",
  );

  const privateVariant = await getPrivateMediaVariant(
    database,
    bucket,
    organizerIdentity,
    asset.id,
    "webp_480",
    { eventId: "event-organizer" },
  );
  assert.equal(privateVariant.mimeType, "image/webp");
  await assert.rejects(
    getPrivateMediaVariant(
      database,
      bucket,
      organizerIdentity,
      asset.id,
      "webp_480",
    ),
    (error) => error?.code === "not_found",
  );
});

test("public bytes are responsive WebP only while private originals remain Owner/Admin-only and no-store", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket();
  t.after(() => database.close());
  const asset = await uploadMediaAsset(
    database,
    bucket,
    ownerIdentity,
    uploadInput(),
    { decodeProbe, nowUtcMs: BASE_NOW },
  );
  insertUsage(database, asset.id, "published");

  const originalKey = scalar(
    database,
    `SELECT object_key
     FROM media_asset_variants
     WHERE asset_id = ?
       AND variant_kind = 'original'`,
    asset.id,
  );
  const privateOriginalSentinel =
    "PRIVATE_EXIF_LOCATION_AND_CAMERA_SERIAL";
  bucket.objects.set(originalKey, {
    bytes: new TextEncoder().encode(privateOriginalSentinel),
    contentType: "image/png",
  });

  await assert.rejects(
    getPublicMediaVariant(database, bucket, asset.id, "original"),
    (error) => error?.code === "not_found" && error?.status === 404,
  );
  assert.equal(bucket.getKeys.includes(originalKey), false);

  const publicVariant = await getPublicMediaVariant(
    database,
    bucket,
    asset.id,
    "webp_480",
  );
  const publicBytes = new Uint8Array(await publicVariant.body.arrayBuffer());
  assert.equal(
    new TextDecoder().decode(publicBytes).includes(privateOriginalSentinel),
    false,
  );
  assert.equal(bucket.getKeys.includes(originalKey), false);

  await assert.rejects(
    getPrivateMediaVariant(
      database,
      bucket,
      organizerIdentity,
      asset.id,
      "original",
      { eventId: "event-organizer" },
    ),
    (error) => error?.code === "not_found",
  );
  assert.equal(bucket.getKeys.includes(originalKey), false);

  const ownerOriginal = await getPrivateMediaVariant(
    database,
    bucket,
    ownerIdentity,
    asset.id,
    "original",
  );
  assert.equal(
    new TextDecoder()
      .decode(new Uint8Array(await ownerOriginal.body.arrayBuffer())),
    privateOriginalSentinel,
  );
  assert.equal(bucket.getKeys.at(-1), originalKey);
});

test("private media byte lookup revalidates live membership, profile, role, and club scope immediately before R2", async (t) => {
  const cases = [
    {
      label: "membership suspension",
      identity: organizerIdentity,
      eventId: "event-organizer",
      variant: "webp_480",
      mutate(database) {
        database.exec(
          `UPDATE organization_memberships
           SET status = 'suspended'
           WHERE id = 'membership-organizer'`,
        );
      },
    },
    {
      label: "profile suspension",
      identity: organizerIdentity,
      eventId: "event-organizer",
      variant: "webp_480",
      mutate(database) {
        database.exec(
          `UPDATE profiles
           SET status = 'suspended'
           WHERE id = 'profile-organizer'`,
        );
      },
    },
    {
      label: "club assignment removal",
      identity: organizerIdentity,
      eventId: "event-organizer",
      variant: "webp_480",
      mutate(database) {
        database
          .prepare(
            `UPDATE club_memberships
             SET deleted_at = ?
             WHERE id = 'club-member-organizer'`,
          )
          .bind(BASE_NOW)
          .runSynchronously();
      },
    },
    {
      label: "Administrator demotion before original-byte access",
      identity: adminIdentity,
      eventId: undefined,
      variant: "original",
      mutate(database) {
        database.exec(
          `UPDATE organization_memberships
           SET role = 'organizer'
           WHERE id = 'membership-admin'`,
        );
      },
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.label, async (t) => {
      const database = newDatabase();
      const bucket = new MemoryR2Bucket();
      t.after(() => database.close());
      const asset = await uploadMediaAsset(
        database,
        bucket,
        ownerIdentity,
        uploadInput(),
        { decodeProbe, nowUtcMs: BASE_NOW },
      );
      bucket.getKeys.length = 0;
      const raced = beforeFirstMatchingDatabase(
        database,
        /SELECT variant\.object_key[\s\S]*current_membership/u,
        () => testCase.mutate(database),
      );
      await assert.rejects(
        getPrivateMediaVariant(
          raced,
          bucket,
          testCase.identity,
          asset.id,
          testCase.variant,
          { eventId: testCase.eventId },
        ),
        (error) => error?.code === "not_found",
      );
      assert.deepEqual(bucket.getKeys, []);
    });
  }
});

test("public serving requires ready approved rights, consent, credit, useful alt for informative media, and a published usage", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket();
  t.after(() => database.close());
  const asset = await uploadMediaAsset(
    database,
    bucket,
    ownerIdentity,
    uploadInput(),
    { decodeProbe, nowUtcMs: BASE_NOW },
  );

  await assert.rejects(
    getPublicMediaVariant(database, bucket, asset.id, "webp_480"),
    (error) => error?.code === "not_found",
  );
  insertUsage(database, asset.id, "published");
  const media = await getPublicMediaVariant(
    database,
    bucket,
    asset.id,
    "webp_480",
  );
  assert.equal(media.mimeType, "image/webp");
  assert.equal(media.etag.length, 64);
  assert.ok(await media.body.arrayBuffer());

  const readsBeforeNoncanonicalCheck = bucket.getKeys.length;
  database.exec(`
    UPDATE organizations
    SET slug = 'other-published-organization'
    WHERE id = 'org-main';
  `);
  await assert.rejects(
    getPublicMediaVariant(database, bucket, asset.id, "webp_480"),
    (error) => error?.code === "not_found",
  );
  assert.equal(bucket.getKeys.length, readsBeforeNoncanonicalCheck);
  database.exec(`
    UPDATE organizations
    SET slug = 'vancouver-curiosity-and-education-society'
    WHERE id = 'org-main';
  `);

  database.exec(`
    INSERT INTO cms_entity_revisions (
      id, organization_id, publication_state_id, entity_type, entity_key,
      revision_number, snapshot_json, content_hash, canonical_byte_size,
      actor_profile_id, created_at
    ) VALUES (
      'revision-2-no-media', 'org-main', 'state-about', 'page', 'about',
      2, '{"blocks":[],"openGraphAssetId":null}',
      '${"c".repeat(64)}', 37, 'profile-owner', 2
    );
    UPDATE cms_entity_publication_states
    SET published_revision_id = 'revision-2-no-media',
        content_version = 2,
        updated_at = 2
    WHERE id = 'state-about';
    UPDATE pages
    SET current_revision = 2, updated_at = 2
    WHERE id = 'about';
  `);
  const readsBeforeHistoricalCheck = bucket.getKeys.length;
  await assert.rejects(
    getPublicMediaVariant(database, bucket, asset.id, "webp_480"),
    (error) => error?.code === "not_found",
  );
  assert.equal(bucket.getKeys.length, readsBeforeHistoricalCheck);
  database.exec(`
    UPDATE cms_entity_publication_states
    SET published_revision_id = 'revision-1',
        content_version = 1,
        updated_at = 3
    WHERE id = 'state-about';
    UPDATE pages
    SET current_revision = 1, updated_at = 3
    WHERE id = 'about';
  `);

  database
    .prepare(
      `UPDATE media_usage_references
       SET publication_scope = 'draft'
       WHERE asset_id = ? AND deleted_at IS NULL`,
    )
    .bind(asset.id)
    .runSynchronously();
  await assert.rejects(
    getPublicMediaVariant(database, bucket, asset.id, "webp_480"),
    (error) => error?.code === "not_found",
  );
  database
    .prepare(
      `UPDATE media_usage_references
       SET publication_scope = 'published'
       WHERE asset_id = ? AND deleted_at IS NULL`,
    )
    .bind(asset.id)
    .runSynchronously();

  const unconfirmed = await uploadMediaAsset(
    database,
    bucket,
    ownerIdentity,
    uploadInput({
      metadata: {
        ...approvedMetadata(),
        rightsStatus: "unconfirmed",
      },
    }),
    { decodeProbe, nowUtcMs: BASE_NOW + 1 },
  );
  insertUsage(database, unconfirmed.id, "published", "secondary-hero");
  await assert.rejects(
    getPublicMediaVariant(database, bucket, unconfirmed.id, "webp_480"),
    (error) => error?.code === "not_found",
  );

  for (const metadata of [
    { ...approvedMetadata(), rightsStatus: "unconfirmed" },
    { ...approvedMetadata(), consentStatus: "unconfirmed" },
    { ...approvedMetadata(), credit: null },
    { ...approvedMetadata(), altText: null },
  ]) {
    await assert.rejects(
      updateMediaAssetMetadata(
        database,
        ownerIdentity,
        asset.id,
        asset.contentVersion,
        metadata,
        { nowUtcMs: BASE_NOW + 2 },
      ),
      (error) =>
        error?.code === "conflict" &&
        error?.blockers?.length === 1 &&
        error?.blockers?.[0]?.publicationScope === "published",
    );
    await getPublicMediaVariant(database, bucket, asset.id, "webp_480");
  }
  const decorative = await updateMediaAssetMetadata(
    database,
    ownerIdentity,
    asset.id,
    asset.contentVersion,
    { ...approvedMetadata(), altText: null, informative: false },
    { nowUtcMs: BASE_NOW + 3 },
  );
  assert.equal(decorative.contentVersion, 2);
  assert.equal(decorative.informative, false);
  await getPublicMediaVariant(database, bucket, asset.id, "webp_480");
  database
    .prepare(
      `UPDATE media_usage_references
       SET deleted_at = ?
       WHERE asset_id = ?
         AND publication_scope = 'published'
         AND deleted_at IS NULL`,
    )
    .bind(BASE_NOW + 4, asset.id)
    .runSynchronously();
  const downgraded = await updateMediaAssetMetadata(
    database,
    ownerIdentity,
    asset.id,
    decorative.contentVersion,
    { ...approvedMetadata(), rightsStatus: "unconfirmed" },
    { nowUtcMs: BASE_NOW + 5 },
  );
  assert.equal(downgraded.rightsStatus, "unconfirmed");
  await assert.rejects(
    getPublicMediaVariant(database, bucket, asset.id, "webp_480"),
    (error) => error?.code === "not_found",
  );
});

test("required OG artwork without useful alt never yields anonymous R2 bytes", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket();
  t.after(() => database.close());
  const asset = await uploadMediaAsset(
    database,
    bucket,
    ownerIdentity,
    uploadInput({
      metadata: {
        ...approvedMetadata(),
        altText: null,
        informative: false,
      },
    }),
    { decodeProbe, nowUtcMs: BASE_NOW },
  );
  insertSiteOgUsage(database, asset.id);
  const readsBefore = bucket.getKeys.length;
  await assert.rejects(
    getPublicMediaVariant(database, bucket, asset.id, "webp_480"),
    (error) => error?.code === "not_found",
  );
  assert.equal(bucket.getKeys.length, readsBefore);
});

test("failed R2 upload remains nonpublic, records a bounded failure, and cleans every opaque object", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket({ failPutAt: 3 });
  t.after(() => database.close());

  await assert.rejects(
    uploadMediaAsset(
      database,
      bucket,
      ownerIdentity,
      uploadInput(),
      { decodeProbe, nowUtcMs: BASE_NOW },
    ),
    (error) => error?.code === "service_unavailable",
  );
  assert.equal(bucket.objects.size, 0);
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_asset_details
       WHERE upload_state = 'failed'
         AND failure_code = 'r2_put_failed'`,
    ),
    1,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_asset_variants
       WHERE state = 'failed'
         AND failure_code = 'r2_put_failed'`,
    ),
    4,
  );
});

test("failed upload cleanup survives R2 delete failure and remains retryable after a fresh service call", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket({
    failDeleteCount: 2,
    failPutAt: 2,
  });
  t.after(() => database.close());

  await assert.rejects(
    uploadMediaAsset(
      database,
      bucket,
      ownerIdentity,
      uploadInput(),
      { decodeProbe, nowUtcMs: BASE_NOW },
    ),
    (error) => error?.code === "service_unavailable",
  );
  assert.equal(bucket.objects.size, 3);
  const pending = await listPendingMediaCleanups(
    database,
    ownerIdentity,
    { nowUtcMs: BASE_NOW + 1 },
  );
  assert.equal(pending.length, 1);
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_asset_details
       WHERE upload_state = 'failed'
         AND failure_code = 'r2_cleanup_pending'`,
    ),
    1,
  );

  const firstRetry = await retryDeletedMediaCleanup(
    database,
    bucket,
    ownerIdentity,
    pending[0].assetId,
    pending[0].cleanupVersion,
  );
  assert.deepEqual(firstRetry, { cleanupPending: true });
  assert.equal(bucket.objects.size, 3);

  const completed = await retryDeletedMediaCleanup(
    database,
    bucket,
    ownerIdentity,
    pending[0].assetId,
    pending[0].cleanupVersion,
  );
  assert.deepEqual(completed, { cleanupPending: false });
  assert.equal(bucket.objects.size, 0);
  assert.deepEqual(
    await listPendingMediaCleanups(database, ownerIdentity, {
      nowUtcMs: BASE_NOW + 2,
    }),
    [],
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_assets
       WHERE id = ? AND deleted_at IS NOT NULL`,
      pending[0].assetId,
    ),
    1,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_asset_variants
       WHERE asset_id = ?`,
      pending[0].assetId,
    ),
    0,
  );
});

test("upload finalization rolls back every ready transition when the live Administrator is suspended", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket();
  t.after(() => database.close());
  const raced = finalizationRaceDatabase(database, () => {
    database.exec(
      `UPDATE organization_memberships
       SET status = 'suspended', updated_at = ${BASE_NOW + 1}
       WHERE id = 'membership-admin'`,
    );
  });

  await assert.rejects(
    uploadMediaAsset(
      raced,
      bucket,
      adminIdentity,
      uploadInput({ fileName: "suspended-admin.png" }),
      { decodeProbe, nowUtcMs: BASE_NOW },
    ),
  );
  assert.equal(bucket.objects.size, 0);
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_asset_variants
       WHERE state = 'ready'`,
    ),
    0,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_asset_details
       WHERE upload_state = 'ready'`,
    ),
    0,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM audit_logs
       WHERE action = 'media.upload_finalized'`,
    ),
    0,
  );
});

test("upload finalization rolls back every ready transition after a stale cleanup/content version race", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket();
  t.after(() => database.close());
  const raced = finalizationRaceDatabase(database, () => {
    database.exec(
      `UPDATE media_asset_details
       SET content_version = content_version + 1,
           updated_by_profile_id = 'profile-owner',
           updated_at = ${BASE_NOW + 1}
       WHERE upload_state = 'pending'`,
    );
  });

  await assert.rejects(
    uploadMediaAsset(
      raced,
      bucket,
      ownerIdentity,
      uploadInput({ fileName: "stale-finalization.png" }),
      { decodeProbe, nowUtcMs: BASE_NOW },
    ),
  );
  assert.equal(bucket.objects.size, 0);
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_asset_variants
       WHERE state = 'ready'`,
    ),
    0,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_asset_details
       WHERE upload_state = 'ready'`,
    ),
    0,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM audit_logs
       WHERE action = 'media.upload_finalized'`,
    ),
    0,
  );
});

test("delete blocks all draft/published usages, then soft-deletes metadata and removes all R2 bytes", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket();
  t.after(() => database.close());
  const asset = await uploadMediaAsset(
    database,
    bucket,
    ownerIdentity,
    uploadInput(),
    { decodeProbe, nowUtcMs: BASE_NOW },
  );
  insertUsage(database, asset.id, "published", "deletion-hero");
  await getPublicMediaVariant(database, bucket, asset.id, "webp_480");
  database
    .prepare(
      `UPDATE media_usage_references
       SET deleted_at = ?
       WHERE asset_id = ?`,
    )
    .bind(BASE_NOW + 2, asset.id)
    .runSynchronously();
  insertUsage(database, asset.id, "draft");
  insertUsage(database, asset.id, "published", "hero-published");

  const blocked = await deleteMediaAsset(
    database,
    bucket,
    ownerIdentity,
    asset.id,
    asset.contentVersion,
    { nowUtcMs: BASE_NOW + 1 },
  );
  assert.equal(blocked.deleted, false);
  assert.equal(blocked.blockers.length, 2);
  assert.equal(bucket.objects.size, 4);
  assert.equal(
    scalar(
      database,
      "SELECT count(*) FROM media_assets WHERE id = ? AND deleted_at IS NULL",
      asset.id,
    ),
    1,
  );

  database
    .prepare(
      `UPDATE media_usage_references
       SET deleted_at = ?
       WHERE asset_id = ?`,
    )
    .bind(BASE_NOW + 2, asset.id)
    .runSynchronously();
  const deleted = await deleteMediaAsset(
    database,
    bucket,
    ownerIdentity,
    asset.id,
    asset.contentVersion,
    { nowUtcMs: BASE_NOW + 3 },
  );
  assert.deepEqual(deleted, {
    cleanupPending: false,
    cleanupVersion: asset.contentVersion + 1,
    deleted: true,
  });
  assert.equal(bucket.objects.size, 0);
  assert.equal(
    scalar(
      database,
      "SELECT count(*) FROM media_asset_variants WHERE asset_id = ?",
      asset.id,
    ),
    0,
  );
  await assert.rejects(
    getPublicMediaVariant(database, bucket, asset.id, "webp_480"),
    (error) => error?.code === "not_found",
  );
  assert.equal(
    scalar(
      database,
      "SELECT count(*) FROM media_assets WHERE id = ? AND deleted_at IS NOT NULL",
      asset.id,
    ),
    1,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM audit_logs
       WHERE entity_id = ? AND action = 'media.deleted'`,
      asset.id,
    ),
    1,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM audit_logs
       WHERE entity_id = ? AND action = 'media.cleanup_completed'`,
      asset.id,
    ),
    1,
  );
});

test("R2 deletion failure remains durably retryable from the persisted four-key manifest", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket({ failDeleteCount: 2 });
  t.after(() => database.close());
  const asset = await uploadMediaAsset(
    database,
    bucket,
    ownerIdentity,
    uploadInput(),
    { decodeProbe, nowUtcMs: BASE_NOW },
  );
  const deleted = await deleteMediaAsset(
    database,
    bucket,
    ownerIdentity,
    asset.id,
    asset.contentVersion,
    { nowUtcMs: BASE_NOW + 1 },
  );
  assert.deepEqual(deleted, {
    cleanupPending: true,
    cleanupVersion: asset.contentVersion + 1,
    deleted: true,
  });
  assert.equal(bucket.objects.size, 4);
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_asset_variants WHERE asset_id = ?`,
      asset.id,
    ),
    4,
  );
  assert.deepEqual(await listPendingMediaCleanups(database, ownerIdentity), [
    {
      assetId: asset.id,
      cleanupVersion: asset.contentVersion + 1,
      fileName: asset.fileName,
      updatedAt: BASE_NOW + 1,
    },
  ]);
  await assert.rejects(
    retryDeletedMediaCleanup(
      database,
      bucket,
      ownerIdentity,
      asset.id,
      asset.contentVersion + 2,
    ),
    (error) => error?.code === "stale_edit",
  );
  assert.equal(bucket.objects.size, 4);
  const failedRetry = await retryDeletedMediaCleanup(
    database,
    bucket,
    ownerIdentity,
    asset.id,
    asset.contentVersion + 1,
  );
  assert.deepEqual(failedRetry, { cleanupPending: true });
  assert.equal(bucket.objects.size, 4);
  assert.equal(
    (await listPendingMediaCleanups(database, ownerIdentity)).length,
    1,
  );
  const retry = await retryDeletedMediaCleanup(
    database,
    bucket,
    ownerIdentity,
    asset.id,
    asset.contentVersion + 1,
  );
  assert.deepEqual(retry, { cleanupPending: false });
  assert.equal(bucket.objects.size, 0);
  assert.deepEqual(
    await listPendingMediaCleanups(database, ownerIdentity),
    [],
  );
  assert.equal(
    scalar(
      database,
      "SELECT count(*) FROM media_asset_variants WHERE asset_id = ?",
      asset.id,
    ),
    0,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM audit_logs
       WHERE entity_id = ? AND action = 'media.cleanup_completed'`,
      asset.id,
    ),
    1,
  );
  assert.deepEqual(
    await retryDeletedMediaCleanup(
      database,
      bucket,
      ownerIdentity,
      asset.id,
      asset.contentVersion + 1,
    ),
    { cleanupPending: false },
  );
});

test("media list stays bounded to one authorization read plus one aggregate query", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket();
  t.after(() => database.close());
  for (let index = 0; index < 3; index += 1) {
    await uploadMediaAsset(
      database,
      bucket,
      ownerIdentity,
      uploadInput({ fileName: `asset-${index}.png` }),
      { decodeProbe, nowUtcMs: BASE_NOW + index },
    );
  }
  const counted = countedDatabase(database);
  const assets = await listMediaAssets(counted.database, ownerIdentity, {
    limit: 100,
  });
  assert.equal(assets.length, 3);
  assert.equal(counted.count, 2);
  assert.ok(assets.every((asset) => asset.variants.length === 4));
});

test("CMS usage validation and reconciliation stay same-org, public-ready, atomic, and revision-current", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket();
  t.after(() => database.close());
  const approved = await uploadMediaAsset(
    database,
    bucket,
    ownerIdentity,
    uploadInput(),
    { decodeProbe, nowUtcMs: BASE_NOW },
  );
  const unconfirmed = await uploadMediaAsset(
    database,
    bucket,
    ownerIdentity,
    uploadInput({
      fileName: "unconfirmed.png",
      metadata: { ...approvedMetadata(), rightsStatus: "unconfirmed" },
    }),
    { decodeProbe, nowUtcMs: BASE_NOW + 1 },
  );
  const decorative = await uploadMediaAsset(
    database,
    bucket,
    ownerIdentity,
    uploadInput({
      fileName: "decorative-inline.png",
      metadata: {
        ...approvedMetadata(),
        altText: null,
        informative: false,
      },
    }),
    { decodeProbe, nowUtcMs: BASE_NOW + 2 },
  );

  assert.equal(
    (
      await validateMediaAssetsForUsage(database, {
        assetIds: [approved.id],
        organizationId: "org-main",
        publicationScope: "published",
      })
    )[0].altText,
    approved.altText,
  );
  await assert.rejects(
    validateMediaAssetsForUsage(database, {
      assetIds: [unconfirmed.id],
      organizationId: "org-main",
      publicationScope: "published",
    }),
    (error) => error?.name === "InputValidationError",
  );
  assert.equal(
    (
      await validateMediaAssetsForUsage(database, {
        assetIds: [unconfirmed.id],
        organizationId: "org-main",
        publicationScope: "draft",
      })
    ).length,
    1,
  );
  assert.equal(
    (
      await validateMediaAssetsForUsage(database, {
        assetIds: [decorative.id],
        organizationId: "org-main",
        publicationScope: "published",
      })
    ).length,
    1,
    "decorative inline artwork may use an empty alt",
  );
  await assert.rejects(
    validateMediaAssetsForUsage(database, {
      assetIds: [decorative.id],
      organizationId: "org-main",
      publicationScope: "published",
      requireUsefulAltAssetIds: [decorative.id],
    }),
    (error) =>
      error?.name === "InputValidationError" &&
      error.issues?.some((issue) => issue.code === "media_not_eligible"),
  );

  const revision1 = prepareMediaUsageReconciliation(
    database,
    ownerMembership,
    {
      entityId: "about",
      entityType: "page",
      nowUtcMs: BASE_NOW + 2,
      publicationScope: "published",
      revisionId: "revision-1",
      usages: [{ assetId: approved.id, usageKind: "hero" }],
    },
  );
  await database.batch([...revision1.statements]);
  assert.equal(revision1.insertStatementCount, 1);
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_usage_references
       WHERE entity_id = 'about' AND deleted_at IS NULL`,
    ),
    1,
  );
  const resolved = await resolvePublishedMediaAsset(database, {
    assetId: approved.id,
    organizationId: "org-main",
    usageKind: "hero",
    variant: "webp_960",
  });
  assert.equal(resolved.url, `/media/${approved.id}/webp_960`);
  assert.equal(resolved.credit, "Vancouver Curiosity Club");
  assert.equal("objectKey" in resolved, false);
  assert.equal(
    await resolvePublishedMediaAsset(database, {
      assetId: approved.id,
      entityId: "org-main",
      entityType: "site_og",
      organizationId: "org-main",
      usageKind: "open_graph",
      variant: "webp_1600",
    }),
    null,
    "a page usage must not masquerade as the Site Identity OG fallback",
  );
  insertSiteOgUsage(database, approved.id);
  const metadataCounter = countedDatabase(database);
  const fallback = await resolvePublicEventMetadataImage(
    metadataCounter.database,
    {
      artwork: null,
      organizationId: "org-main",
      siteOpenGraphAssetId: approved.id,
    },
  );
  assert.equal(
    metadataCounter.count,
    1,
    "the exact live Site Identity fallback costs one bounded D1 read",
  );
  assert.deepEqual(fallback, {
    altText: "Abstract field-note shapes in forest green and cobalt.",
    height: 900,
    path: `/media/${approved.id}/webp_1600`,
    width: 1600,
  });
  database.exec(
    `UPDATE media_assets
     SET rights_status = 'restricted', updated_at = ${BASE_NOW + 3}
     WHERE id = '${approved.id}'`,
  );
  assert.equal(
    await resolvePublicEventMetadataImage(database, {
      artwork: null,
      organizationId: "org-main",
      siteOpenGraphAssetId: approved.id,
    }),
    null,
    "revoked Site Identity artwork must fall through to the shipped default",
  );
  database.exec(
    `UPDATE media_assets
     SET rights_status = 'approved', updated_at = ${BASE_NOW + 4}
     WHERE id = '${approved.id}'`,
  );

  const revision2 = prepareMediaUsageReconciliation(
    database,
    ownerMembership,
    {
      entityId: "about",
      entityType: "page",
      nowUtcMs: BASE_NOW + 3,
      publicationScope: "published",
      revisionId: "revision-2",
      usages: [{ assetId: approved.id, usageKind: "hero" }],
    },
  );
  await database.batch([...revision2.statements]);
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_usage_references
       WHERE entity_id = 'about'
         AND revision_id = 'revision-1'
         AND deleted_at IS NOT NULL`,
    ),
    1,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_usage_references
       WHERE entity_id = 'about'
         AND revision_id = 'revision-2'
         AND deleted_at IS NULL`,
    ),
    1,
  );

  const adminMembership = Object.freeze({
    membershipId: "membership-admin",
    organizationId: "org-main",
    profileId: "profile-admin",
    role: "administrator",
  });
  const raced = prepareMediaUsageReconciliation(database, adminMembership, {
    entityId: "about",
    entityType: "page",
    nowUtcMs: BASE_NOW + 4,
    publicationScope: "published",
    revisionId: "revision-raced",
    usages: [{ assetId: approved.id, usageKind: "hero" }],
  });
  database.exec(
    `UPDATE organization_memberships
     SET status = 'suspended'
     WHERE id = 'membership-admin'`,
  );
  await assert.rejects(database.batch([...raced.statements]));
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_usage_references
       WHERE entity_id = 'about'
         AND revision_id = 'revision-2'
         AND deleted_at IS NULL`,
    ),
    1,
  );
});

test("maximum CMS media reconciliation stays at three D1 batch statements", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket();
  t.after(() => database.close());
  const asset = await uploadMediaAsset(
    database,
    bucket,
    ownerIdentity,
    uploadInput(),
    { decodeProbe, nowUtcMs: BASE_NOW },
  );
  const prepared = prepareMediaUsageReconciliation(
    database,
    Object.freeze({
      membershipId: "membership-owner",
      organizationId: "org-main",
      profileId: "profile-owner",
      role: "owner",
    }),
    {
      entityId: "about",
      entityType: "page",
      nowUtcMs: BASE_NOW + 1,
      publicationScope: "published",
      revisionId: "revision-max-media",
      usages: Array.from({ length: 24 }, (_, index) => ({
        assetId: asset.id,
        usageKind: `page-media-${String(index).padStart(2, "0")}`,
      })),
    },
  );
  assert.equal(prepared.statements.length, 3);
  assert.equal(prepared.insertStatementIndex, 1);
  assert.equal(prepared.insertStatementCount, 24);
  const results = await database.batch([...prepared.statements]);
  assert.equal(results[1]?.meta?.changes, 24);
  assert.equal(results[2]?.meta?.changes, 1);
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM media_usage_references
       WHERE entity_id = 'about'
         AND revision_id = 'revision-max-media'
         AND deleted_at IS NULL`,
    ),
    24,
  );
});

test("D1 upload rate limit persists across service calls and rejects the eleventh attempt", async (t) => {
  const database = newDatabase();
  const bucket = new MemoryR2Bucket();
  t.after(() => database.close());
  const invalid = uploadInput();
  invalid.original.bytes = new Uint8Array([1, 2, 3]);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await assert.rejects(
      uploadMediaAsset(database, bucket, ownerIdentity, invalid, {
        decodeProbe,
        nowUtcMs: BASE_NOW,
      }),
      (error) => error?.name === "InputValidationError",
    );
  }
  await assert.rejects(
    uploadMediaAsset(database, bucket, ownerIdentity, invalid, {
      decodeProbe,
      nowUtcMs: BASE_NOW,
    }),
    (error) => error?.code === "rate_limited",
  );
  assert.equal(
    scalar(
      database,
      `SELECT request_count FROM organizer_rate_limits
       WHERE action = 'media_upload'`,
    ),
    10,
  );
});

function newDatabase() {
  const schemaSql = readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) => readFileSync(join(process.cwd(), "drizzle", name), "utf8"))
    .join("\n");
  const database = new SqliteD1TestDatabase(schemaSql);
  seed(database);
  return database;
}

function seed(database) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name,
      public_attribution_consent, status, created_at, updated_at
    ) VALUES
      ('profile-owner', 'subject-owner', 'owner@example.test', 'Owner', 1, 'active', 1, 1),
      ('profile-admin', 'subject-admin', 'admin@example.test', 'Admin', 0, 'active', 1, 1),
      ('profile-organizer', 'subject-organizer', 'organizer@example.test', 'Organizer', 0, 'active', 1, 1),
      ('profile-other', 'subject-other', 'other@example.test', 'Other', 0, 'active', 1, 1);

    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'org-main', 'Main Organization',
      'vancouver-curiosity-and-education-society',
      'America/Vancouver', 1, 'profile-owner', 1, 1
    );

    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      ('membership-owner', 'org-main', 'profile-owner', 'owner@example.test', 'owner', 'active', 'profile-owner', 1, 1),
      ('membership-admin', 'org-main', 'profile-admin', 'admin@example.test', 'administrator', 'active', 'profile-owner', 1, 1),
      ('membership-organizer', 'org-main', 'profile-organizer', 'organizer@example.test', 'organizer', 'active', 'profile-owner', 1, 1),
      ('membership-other', 'org-main', 'profile-other', 'other@example.test', 'organizer', 'active', 'profile-owner', 1, 1);

    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES
      ('club-main', 'org-main', 'Main Club', 'main-club', 'profile-owner', 1, 1),
      ('club-other', 'org-main', 'Other Club', 'other-club', 'profile-owner', 1, 1);

    INSERT INTO club_memberships (
      id, organization_id, club_id, organization_membership_id,
      profile_id, role, status, created_by_profile_id, created_at, updated_at
    ) VALUES
      ('club-member-organizer', 'org-main', 'club-main', 'membership-organizer', 'profile-organizer', 'organizer', 'active', 'profile-owner', 1, 1),
      ('club-member-other', 'org-main', 'club-main', 'membership-other', 'profile-other', 'organizer', 'active', 'profile-owner', 1, 1);

    INSERT INTO organizer_events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, planning_status, publication_status, schedule_shape,
      timezone, content_version, schedule_version, created_by_profile_id,
      updated_by_profile_id, created_at, updated_at
    ) VALUES
      ('event-organizer', 'org-main', 'club-main', 'profile-organizer',
       'Owned', 'owned', 'idea', 'private', 'unscheduled',
       'America/Vancouver', 1, 1, 'profile-organizer', 'profile-organizer', 1, 1),
      ('event-co-organizer', 'org-main', 'club-main', 'profile-owner',
       'Co-organized', 'co-organized', 'idea', 'private', 'unscheduled',
       'America/Vancouver', 1, 1, 'profile-owner', 'profile-owner', 1, 1),
      ('event-other-club', 'org-main', 'club-other', 'profile-organizer',
       'Wrong Club', 'wrong-club', 'idea', 'private', 'unscheduled',
       'America/Vancouver', 1, 1, 'profile-owner', 'profile-owner', 1, 1);

    INSERT INTO pages (
      id, organization_id, title, slug, status, visibility,
      current_revision, published_at, created_by_profile_id,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'about', 'org-main', 'About', 'about', 'published', 'public',
      1, 1, 'profile-owner', 'profile-owner', 1, 1
    );
    INSERT INTO cms_entity_publication_states (
      id, organization_id, entity_type, entity_key, workflow_status,
      content_version, published_revision_id, last_editor_profile_id,
      published_at, created_at, updated_at
    ) VALUES (
      'state-about', 'org-main', 'page', 'about', 'published',
      1, 'revision-1', 'profile-owner', 1, 1, 1
    );
    INSERT INTO cms_entity_revisions (
      id, organization_id, publication_state_id, entity_type, entity_key,
      revision_number, snapshot_json, content_hash, canonical_byte_size,
      actor_profile_id, created_at
    ) VALUES (
      'revision-1', 'org-main', 'state-about', 'page', 'about',
      1, '{"blocks":[],"openGraphAssetId":null}',
      '${"a".repeat(64)}', 37, 'profile-owner', 1
    );
    INSERT INTO cms_entity_publication_states (
      id, organization_id, entity_type, entity_key, workflow_status,
      content_version, published_revision_id, last_editor_profile_id,
      published_at, created_at, updated_at
    ) VALUES (
      'state-site-identity-media', 'org-main', 'site_identity',
      'site_identity', 'published', 1, 'revision-site-identity',
      'profile-owner', 1, 1, 1
    );
    INSERT INTO cms_entity_revisions (
      id, organization_id, publication_state_id, entity_type, entity_key,
      revision_number, snapshot_json, content_hash, canonical_byte_size,
      actor_profile_id, created_at
    ) VALUES (
      'revision-site-identity', 'org-main', 'state-site-identity-media',
      'site_identity', 'site_identity', 1,
      '{"logoAssetId":null,"openGraphAssetId":null}',
      '${"b".repeat(64)}', 44, 'profile-owner', 1
    );

    INSERT INTO organizer_event_organizers (
      id, organization_id, organizer_event_id, profile_id,
      created_by_profile_id, created_at
    ) VALUES (
      'co-organizer', 'org-main', 'event-co-organizer',
      'profile-organizer', 'profile-owner', 1
    );
  `);
}

function approvedMetadata() {
  return {
    altText: "Abstract field-note shapes in forest green and cobalt.",
    caption: "Original editorial category artwork.",
    consentStatus: "not_applicable",
    credit: "Vancouver Curiosity Club",
    focalPointX: 5000,
    focalPointY: 5000,
    informative: true,
    participantConsentNote: "No people are depicted.",
    rightsSourceNote: "Original project artwork.",
    rightsStatus: "approved",
  };
}

function uploadInput(overrides = {}) {
  return {
    metadata: overrides.metadata ?? approvedMetadata(),
    original: {
      bytes: pngBytes(1600, 900),
      declaredMimeType: "image/png",
      fileName: overrides.fileName ?? "field-notes.png",
    },
    variants: {
      webp_480: webpPart(480, 270),
      webp_960: webpPart(960, 540),
      webp_1600: webpPart(1600, 900),
    },
  };
}

function insertUsage(
  database,
  assetId,
  publicationScope,
  usageKind = "hero",
) {
  const storedUsageKind = usageKind.startsWith("block:")
    ? usageKind
    : `block:${usageKind}`;
  const existingUsages = all(
    database,
    `SELECT asset_id, usage_kind
     FROM media_usage_references
     WHERE organization_id = 'org-main'
       AND entity_type = 'page'
       AND entity_id = 'about'
       AND deleted_at IS NULL`,
  );
  const byAssetId = new Map(
    existingUsages.map((usage) => [
      usage.asset_id,
      usage.usage_kind,
    ]),
  );
  byAssetId.set(assetId, storedUsageKind);
  const snapshot = JSON.stringify({
    blocks: [...byAssetId].map(([selectedAssetId, selectedUsageKind]) => ({
      id: selectedUsageKind.slice("block:".length),
      type: "media",
      config: { assetId: selectedAssetId },
    })),
    openGraphAssetId: null,
  });
  database
    .prepare(
      `UPDATE cms_entity_revisions
       SET snapshot_json = ?, canonical_byte_size = ?
       WHERE id = 'revision-1'
         AND organization_id = 'org-main'`,
    )
    .bind(snapshot, new TextEncoder().encode(snapshot).byteLength)
    .runSynchronously();
  database.exec(`
    DELETE FROM page_sections
    WHERE organization_id = 'org-main'
      AND page_id = 'about';
    DELETE FROM cms_public_materialization_receipts
    WHERE publication_state_id = 'state-about';
  `);
  const blocks = JSON.parse(snapshot).blocks;
  const projectedSections = [];
  for (const [index, block] of blocks.entries()) {
    const contentJson = JSON.stringify(block.config);
    database
      .prepare(
        `INSERT INTO page_sections (
           id, organization_id, page_id, section_key, section_type,
           content_json, sort_order, created_at, updated_at
         ) VALUES (?, 'org-main', 'about', ?, 'media', ?, ?, 1, 1)`,
      )
      .bind(
        `section-${block.id}`,
        block.id,
        contentJson,
        (index + 1) * 10,
      )
      .runSynchronously();
    projectedSections.push({
      contentJson,
      sectionKey: block.id,
      sectionType: "media",
      sortOrder: (index + 1) * 10,
    });
  }
  const projectionJson = JSON.stringify({
    metadata: {
      metaDescription: null,
      openGraphAssetId: null,
      seoTitle: null,
    },
    page: {
      currentRevision: 1,
      slug: "about",
      title: "About",
    },
    sections: projectedSections,
  });
  database
    .prepare(
      `INSERT INTO cms_public_materialization_receipts (
         id, organization_id, publication_state_id, entity_type, entity_key,
         revision_id, revision_hash, projection_json, canonical_byte_size,
         actor_profile_id, created_at
       ) VALUES (
         ?, 'org-main', 'state-about', 'page', 'about', 'revision-1',
         ?, ?, ?, 'profile-owner', 1
       )`,
    )
    .bind(
      crypto.randomUUID(),
      "a".repeat(64),
      projectionJson,
      new TextEncoder().encode(projectionJson).byteLength,
    )
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO media_usage_references (
         id, organization_id, asset_id, entity_type, entity_id, revision_id,
         usage_kind, publication_scope, created_by_profile_id, created_at
       ) VALUES (?, 'org-main', ?, 'page', 'about', 'revision-1', ?, ?,
                 'profile-owner', ?)`,
    )
    .bind(
      crypto.randomUUID(),
      assetId,
      storedUsageKind,
      publicationScope,
      BASE_NOW,
    )
    .runSynchronously();
}

function insertSiteOgUsage(database, assetId) {
  const snapshot = JSON.stringify({
    logoAssetId: null,
    openGraphAssetId: assetId,
  });
  database
    .prepare(
      `UPDATE cms_entity_revisions
       SET snapshot_json = ?, canonical_byte_size = ?
       WHERE id = 'revision-site-identity'
         AND organization_id = 'org-main'`,
    )
    .bind(snapshot, new TextEncoder().encode(snapshot).byteLength)
    .runSynchronously();
  database.exec(`
    DELETE FROM cms_public_materialization_receipts
    WHERE publication_state_id = 'state-site-identity-media';
  `);
  database
    .prepare(
      `INSERT INTO site_settings (
         id, organization_id, key, value_json, is_public,
         updated_by_profile_id, created_at, updated_at
       ) VALUES (
         'setting-public-identity', 'org-main', 'public_identity', ?, 1,
         'profile-owner', 1, 1
       )
       ON CONFLICT(organization_id, key) DO UPDATE SET
         value_json = excluded.value_json,
         is_public = 1,
         updated_by_profile_id = excluded.updated_by_profile_id,
         updated_at = excluded.updated_at`,
    )
    .bind(snapshot)
    .runSynchronously();
  const projectionJson = JSON.stringify({
    setting: {
      key: "public_identity",
      valueJson: snapshot,
    },
  });
  database
    .prepare(
      `INSERT INTO cms_public_materialization_receipts (
         id, organization_id, publication_state_id, entity_type, entity_key,
         revision_id, revision_hash, projection_json, canonical_byte_size,
         actor_profile_id, created_at
       ) VALUES (
         ?, 'org-main', 'state-site-identity-media', 'site_identity',
         'site_identity', 'revision-site-identity', ?, ?, ?,
         'profile-owner', 1
       )`,
    )
    .bind(
      crypto.randomUUID(),
      "b".repeat(64),
      projectionJson,
      new TextEncoder().encode(projectionJson).byteLength,
    )
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO media_usage_references (
         id, organization_id, asset_id, entity_type, entity_id, revision_id,
         usage_kind, publication_scope, created_by_profile_id, created_at
       ) VALUES (?, 'org-main', ?, 'site_og', 'org-main',
                 'revision-site-identity', 'open_graph', 'published',
                 'profile-owner', ?)`,
    )
    .bind(
      crypto.randomUUID(),
      assetId,
      BASE_NOW,
    )
    .runSynchronously();
}

class MemoryR2Bucket {
  constructor(options = {}) {
    this.failDeleteCount = options.failDeleteCount ?? 0;
    this.failPutAt = options.failPutAt ?? null;
    this.getKeys = [];
    this.putCount = 0;
    this.objects = new Map();
  }

  async put(key, value, options) {
    this.putCount += 1;
    if (this.failPutAt === this.putCount) throw new Error("synthetic_put_failure");
    const bytes = value instanceof Uint8Array
      ? value.slice()
      : new Uint8Array(value.buffer ?? value);
    this.objects.set(key, {
      bytes,
      contentType: options?.httpMetadata?.contentType ?? null,
    });
    return {};
  }

  async get(key) {
    this.getKeys.push(key);
    const object = this.objects.get(key);
    if (!object) return null;
    const bytes = object.bytes.slice();
    return {
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      size: bytes.byteLength,
    };
  }

  async delete(keys) {
    if (this.failDeleteCount > 0) {
      this.failDeleteCount -= 1;
      throw new Error("synthetic_delete_failure");
    }
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.objects.delete(key);
    }
  }
}

function beforeFirstMatchingDatabase(database, pattern, beforeFirst) {
  let fired = false;
  const wrap = (statement, matches) => ({
    all: (...args) => statement.all(...args),
    bind: (...values) => wrap(statement.bind(...values), matches),
    first: async (...args) => {
      if (matches && !fired) {
        fired = true;
        beforeFirst();
      }
      return statement.first(...args);
    },
    run: (...args) => statement.run(...args),
  });
  return {
    batch: (statements) => database.batch(statements),
    prepare(sql) {
      pattern.lastIndex = 0;
      return wrap(database.prepare(sql), pattern.test(sql));
    },
  };
}

function countedDatabase(database) {
  let count = 0;
  const wrap = (statement) => ({
    all: async (...args) => {
      count += 1;
      return statement.all(...args);
    },
    bind: (...values) => wrap(statement.bind(...values)),
    first: async (...args) => {
      count += 1;
      return statement.first(...args);
    },
    run: async (...args) => {
      count += 1;
      return statement.run(...args);
    },
  });
  return {
    database: {
      batch: async (statements) => database.batch(statements),
      prepare: (sql) => wrap(database.prepare(sql)),
    },
    get count() {
      return count;
    },
  };
}

function finalizationRaceDatabase(database, beforeFinalization) {
  let batchCount = 0;
  return {
    batch: async (statements) => {
      batchCount += 1;
      if (batchCount === 2) beforeFinalization();
      return database.batch(statements);
    },
    prepare: (sql) => database.prepare(sql),
  };
}

function all(database, sql, ...bindings) {
  return database.sqlite.prepare(sql).all(...bindings);
}

function scalar(database, sql, ...bindings) {
  const row = database.sqlite.prepare(sql).get(...bindings);
  return row?.[Object.keys(row)[0]];
}

function webpPart(width, height) {
  return {
    bytes: webpBytes(width, height),
    declaredMimeType: "image/webp",
    fileName: `${width}.webp`,
  };
}

test("all exercised media SQL shapes compile through real D1", async () => {
  const shapes = mediaSqlRecording.stop();
  await assertRecordedD1ShapesCompile(shapes, {
    expectedCount: 55,
    label: "media service",
  });
});
