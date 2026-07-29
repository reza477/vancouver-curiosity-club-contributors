import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  archiveCmsClubProfile,
  archiveCmsProgramProfile,
  confirmCmsLegalStatus,
  createCmsEntityDraft,
  listCmsEntities,
  publishCmsEntity,
  readCmsEntityWorkspace,
  readCmsRevisionPreview,
  restoreCmsRevisionAsDraft,
  revokeCmsLegalStatus,
  safeDeleteCmsProgramProfile,
  saveCmsEntityDraft,
  unpublishCmsEntity,
} from "../../lib/server/organizer/cms.ts";
import { archivePrivateOrganizerClub } from "../../lib/server/organizer/clubs.ts";
import {
  createOrganizerEvent,
  getOrganizerEvent,
} from "../../lib/server/organizer/events.ts";
import { performOrganizerLifecycleAction } from "../../lib/server/organizer/scheduling.ts";
import {
  performOrganizerPublicationAction,
  readOrganizerPublicationWorkspace,
  updateOrganizerEventPublicDetails,
} from "../../lib/server/organizer/publication.ts";
import { transferWorkspaceOwnership } from "../../lib/server/organizer/team.ts";
import {
  getEditorialPublicEvents,
  getPublicEventBySlug,
  queryPublicEvents,
  publicEventSelectionProofCteSqlForOrganization,
} from "../../lib/server/public/events.ts";
import {
  resolveMediaAssetsForRendering,
} from "../../lib/server/media/usage.ts";
import {
  getPublicClubBySlug,
  getPublicPageContent,
  getPublicProgramBySlugs,
  getPublicSiteContext,
  getPublicSlugRedirect,
  listPublicClubs,
  listPublicProgramsForClub,
  listPublicCommunityLinks,
  loadPublicCatalog,
  listPublicNavigation,
  resolvePublicOrganization,
} from "../../lib/server/public/catalog.ts";
import {
  DATABASE_INVARIANT_VERSION,
  ensureDatabaseInvariants,
} from "../../lib/server/database/invariants.ts";
import { PHASE6_INVARIANT_COUNT_SQL } from "../../lib/server/database/phase6-invariant-sql.ts";
import { cmsReceiptMatchesRevisionSql } from "../../lib/server/public/cms-materialization-contract.ts";
import { runRequestMaintenance } from "../../lib/server/database/request-maintenance.ts";
import { MAX_DATABASE_INVARIANT_READY_ATTEMPTS } from "../database/invariant-ready.mjs";
import {
  SqliteD1TestDatabase,
  startSqliteD1StatementRecording,
} from "../auth/sqlite-d1.mjs";
import {
  countD1Statements,
  interceptD1Statements,
} from "../auth/intercept-d1.mjs";
import {
  assertRecordedD1ShapesCompile,
} from "../database/d1-recorded-shapes.mjs";

const cmsSqlRecording = startSqliteD1StatementRecording({
  sourceIncludes: [
    "/lib/server/organizer/cms.ts",
    "/lib/server/organizer/cms-adoption.ts",
  ],
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
const suspendedIdentity = Object.freeze({
  displayName: "Suspended",
  email: "suspended@example.test",
  source: "sites-siwc",
});
const otherOwnerIdentity = Object.freeze({
  displayName: "Other owner",
  email: "other@example.test",
  source: "sites-siwc",
});
const NOW = Date.parse("2030-01-01T08:00:00.000Z");

test("first authorized CMS read adopts the exact public baseline and enforces role and organization scope", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());

  const entities = await listCmsEntities(database, ownerIdentity);
  assert.ok(
    entities.some(
      (entity) =>
        entity.entityType === "page" &&
        entity.entityKey === "page-about" &&
        entity.workflowStatus === "published",
    ),
  );
  assert.equal(
    entities.find(
      (entity) =>
        entity.entityType === "page" &&
        entity.entityKey === "page-about",
    )?.displayLabel,
    "About",
  );
  assert.equal(
    entities.find(
      (entity) =>
        entity.entityType === "club_public_profile" &&
        entity.entityKey === "club-main",
    )?.displayLabel,
    "Vancouver Curiosity Club",
  );
  assert.equal(
    entities.find(
      (entity) =>
        entity.entityType === "community_link" &&
        entity.entityKey === "community-one",
    )?.displayLabel,
    "Vancouver Curiosity Club",
  );
  assert.deepEqual(
    Object.fromEntries(
      entities
        .filter((entity) =>
          ["legal_status", "navigation", "site_identity"].includes(
            entity.entityType,
          ),
        )
        .map((entity) => [entity.entityType, entity.displayLabel]),
    ),
    {
      legal_status: "Legal status",
      navigation: "Header and footer navigation",
      site_identity: "Site identity",
    },
  );
  assert.equal(
    entities.some((entity) => entity.displayLabel === entity.entityKey),
    false,
  );
  assert.equal(scalar(database, "SELECT count(*) FROM cms_adoption_states"), 1);
  assert.equal(
    (
      await readCmsEntityWorkspace(
        database,
        adminIdentity,
        "page",
        "page-about",
      )
    ).permissions.canEdit,
    true,
  );
  await assert.rejects(
    listCmsEntities(database, organizerIdentity),
    (error) => error?.status === 403,
  );
  await assert.rejects(
    listCmsEntities(database, suspendedIdentity),
    (error) => error?.status === 403,
  );
  await assert.rejects(
    readCmsEntityWorkspace(
      database,
      otherOwnerIdentity,
      "page",
      "page-about",
    ),
    (error) => error?.status === 404,
  );

  const publicLinks = await listPublicCommunityLinks(database);
  assert.deepEqual(
    publicLinks.map(({ url }) => url),
    [
      "https://www.meetup.com/vancouver-meetup-group/",
      "https://www.meetup.com/vancouver-literature-and-film/",
      "https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/",
    ],
  );
  assert.equal(
    publicLinks.some(({ url }) => url === "https://example.com/unconfirmed"),
    false,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM community_link_public_details
       WHERE organization_id = 'org-main'
         AND confirmed_at IS NOT NULL`,
    ),
    3,
  );
});

test("CMS collection read binds the exact live actor and stays bounded after adoption", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await listCmsEntities(database, ownerIdentity);

  const counter = countD1Statements(database);
  assert.ok(
    (await listCmsEntities(counter.database, adminIdentity)).length > 0,
  );
  assert.equal(counter.count(), 3);

  const intercepted = interceptD1Statements(database, {
    before: (sql) => sql.includes("SELECT state.entity_type"),
    hook: async () => {
      database.exec(
        `UPDATE profiles
         SET status = 'suspended', updated_at = updated_at + 1
         WHERE id = 'profile-admin'`,
      );
    },
  });
  await assert.rejects(
    listCmsEntities(intercepted.database, adminIdentity),
    (error) => error?.code === "authorization_denied",
  );
  assert.equal(intercepted.fired(), true);
});

test("CMS workspace seals the exact manager role after all private content reads", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await listCmsEntities(database, ownerIdentity);

  const counter = countD1Statements(database);
  assert.equal(
    (
      await readCmsEntityWorkspace(
        counter.database,
        adminIdentity,
        "page",
        "page-about",
      )
    ).entity.entityKey,
    "page-about",
  );
  assert.equal(counter.count(), 8);

  const intercepted = interceptD1Statements(database, {
    after: (sql) =>
      sql.includes(
        "FROM legal_status_confirmation_receipts AS confirmation",
      ),
    before: (sql) => sql.includes("SELECT membership.id"),
    hook: async () => {
      database.exec(
        `UPDATE organization_memberships
         SET role = 'administrator', updated_at = updated_at + 1
         WHERE id = 'membership-owner'`,
      );
    },
  });
  await assert.rejects(
    readCmsEntityWorkspace(
      intercepted.database,
      ownerIdentity,
      "legal_status",
      "legal_status",
    ),
    (error) => error?.code === "authorization_denied",
  );
  assert.equal(intercepted.fired(), true);
});

test("CMS workspace and immutable revision preview deny data when manager authority changes after the read", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await listCmsEntities(database, ownerIdentity);
  const initial = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "page",
    "page-about",
  );
  assert.ok(initial.revision);

  const suspendOwner = (updatedAt) => {
    database.exec(`
      UPDATE organization_memberships
      SET status = 'suspended', updated_at = ${updatedAt}
      WHERE id = 'membership-owner';
    `);
  };
  const reactivateOwner = (updatedAt) => {
    database.exec(`
      UPDATE organization_memberships
      SET status = 'active', updated_at = ${updatedAt}
      WHERE id = 'membership-owner';
    `);
  };

  await assert.rejects(
    readCmsEntityWorkspace(
      afterMatchingFirstDatabase(
        database,
        (sql) =>
          sql.includes("WHERE state.id = ?") &&
          sql.includes("current_draft_revision_id"),
        () => suspendOwner(NOW + 100),
      ),
      ownerIdentity,
      "page",
      "page-about",
    ),
    (error) =>
      error?.code === "authorization_denied" &&
      error?.status === 403,
  );
  reactivateOwner(NOW + 101);

  await assert.rejects(
    readCmsRevisionPreview(
      afterMatchingFirstDatabase(
        database,
        (sql) =>
          sql.includes("FROM cms_entity_revisions AS revision") &&
          sql.includes("WHERE revision.id = ?"),
        () => suspendOwner(NOW + 102),
      ),
      ownerIdentity,
      initial.revision.id,
    ),
    (error) =>
      error?.code === "authorization_denied" &&
      error?.status === 403,
  );
});

test("every mandatory system page rejects a blank publish without partial public, state, or audit changes", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  database.exec(`
    INSERT INTO pages (
      id, organization_id, title, slug, status, visibility,
      current_revision, published_at, created_by_profile_id,
      updated_by_profile_id, created_at, updated_at
    ) VALUES
      ('page-home', 'org-main', 'Home', 'home', 'published', 'public',
       1, 1, 'profile-owner', 'profile-owner', 1, 1),
      ('page-host-an-event', 'org-main', 'Host an Event', 'host-an-event',
       'published', 'public', 1, 1, 'profile-owner', 'profile-owner', 1, 1);
    INSERT INTO page_sections (
      id, organization_id, page_id, section_key, section_type,
      content_json, sort_order, created_at, updated_at
    ) VALUES
      ('section-home-hero', 'org-main', 'page-home', 'hero', 'hero',
       '{"heading":"Home","text":"Existing public home copy."}', 10, 1, 1),
      ('section-host-intro', 'org-main', 'page-host-an-event', 'intro', 'intro',
       '{"heading":"Host an Event","text":"Existing public host copy."}',
       10, 1, 1);
  `);
  await listCmsEntities(database, ownerIdentity);

  for (const [slug, title] of [
    ["home", "Home"],
    ["events", "Events"],
    ["clubs", "Clubs"],
    ["community", "Community"],
    ["about", "About"],
    ["get-involved", "Get Involved"],
    ["host-an-event", "Host an Event"],
    ["contact", "Contact"],
    ["conduct", "Code of Conduct"],
    ["accessibility", "Accessibility"],
    ["privacy", "Privacy"],
  ]) {
    const row = database.sqlite
      .prepare(
        `SELECT id
         FROM pages
         WHERE organization_id = 'org-main'
           AND slug = ?`,
      )
      .get(slug);
    let workspace;
    if (row) {
      workspace = await readCmsEntityWorkspace(
        database,
        ownerIdentity,
        "page",
        row.id,
      );
      workspace = await saveCmsEntityDraft(
        database,
        ownerIdentity,
        "page",
        row.id,
        {
          expectedContentVersion: workspace.entity.contentVersion,
          snapshot: pageSnapshot({
            blocks: [],
            slug,
            title,
          }),
        },
        NOW + workspace.entity.contentVersion,
      );
    } else {
      workspace = await createCmsEntityDraft(
        database,
        ownerIdentity,
        "page",
        {
          snapshot: pageSnapshot({
            blocks: [],
            slug,
            title,
          }),
        },
        NOW,
      );
    }
    const publicBefore = await getPublicPageContent(database, slug);
    const stateId = database.sqlite
      .prepare(
        `SELECT id
         FROM cms_entity_publication_states
         WHERE organization_id = 'org-main'
           AND entity_type = 'page'
           AND entity_key = ?`,
      )
      .get(workspace.entity.entityKey).id;
    const stateBefore = database.sqlite
      .prepare(
        `SELECT content_version, workflow_status, published_revision_id,
                published_at
         FROM cms_entity_publication_states
         WHERE id = ?`,
      )
      .get(stateId);
    const auditBefore = scalar(database, "SELECT count(*) FROM audit_logs");
    const revisionsBefore = scalar(
      database,
      `SELECT count(*)
       FROM cms_entity_revisions
       WHERE publication_state_id = ?`,
      stateId,
    );

    await assert.rejects(
      publishCmsEntity(
        database,
        ownerIdentity,
        "page",
        workspace.entity.entityKey,
        { expectedContentVersion: workspace.entity.contentVersion },
        NOW + 100,
      ),
      (error) =>
        error?.issues?.some(
          ({ code }) => code === "required_page_structure",
        ) === true,
      `${slug} must reject a blank publication`,
    );
    assert.deepEqual(await getPublicPageContent(database, slug), publicBefore);
    assert.deepEqual(
      database.sqlite
        .prepare(
          `SELECT content_version, workflow_status, published_revision_id,
                  published_at
           FROM cms_entity_publication_states
           WHERE id = ?`,
        )
        .get(stateId),
      stateBefore,
    );
    assert.equal(scalar(database, "SELECT count(*) FROM audit_logs"), auditBefore);
    assert.equal(
      scalar(
        database,
        `SELECT count(*)
         FROM cms_entity_revisions
         WHERE publication_state_id = ?`,
        stateId,
      ),
      revisionsBefore,
    );
  }
});

test("CMS dashboard and workspace retain immutable history after the last editor is suspended or deleted", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await listCmsEntities(database, ownerIdentity);
  let workspace = await readCmsEntityWorkspace(
    database,
    adminIdentity,
    "page",
    "page-about",
  );
  workspace = await saveCmsEntityDraft(
    database,
    adminIdentity,
    "page",
    "page-about",
    {
      expectedContentVersion: workspace.entity.contentVersion,
      snapshot: {
        ...workspace.revision.snapshot,
        metaDescription: "A private historical editor regression.",
      },
    },
    NOW,
  );
  database.exec(
    `UPDATE organization_memberships
     SET status = 'suspended', updated_at = ${NOW + 1}
     WHERE id = 'membership-admin';
     UPDATE profiles
     SET status = 'suspended', deleted_at = ${NOW + 1},
         updated_at = ${NOW + 1}
     WHERE id = 'profile-admin';`,
  );

  const summary = (await listCmsEntities(database, ownerIdentity)).find(
    ({ entityKey, entityType }) =>
      entityType === "page" && entityKey === "page-about",
  );
  assert.equal(summary?.lastEditorDisplayName, "Administrator");
  const retained = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "page",
    "page-about",
  );
  assert.equal(retained.entity.lastEditorDisplayName, "Administrator");
  assert.equal(retained.revision.id, workspace.revision.id);
  assert.ok(
    retained.revisions.some(({ id }) => id === workspace.revision.id),
  );
});

test("draft, preview, publish, stale save, and required-page locks preserve public separation", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());

  const initial = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "page",
    "page-about",
  );
  assert.equal(initial.permissions.canChangeSlug, false);
  assert.equal(initial.permissions.canUnpublish, false);
  const before = await getPublicPageContent(database, "about");
  assert.equal(
    before.sections[0].content.text,
    "Existing public copy for curious Vancouver neighbours.",
  );
  const draft = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "page",
    "page-about",
    {
      expectedContentVersion: initial.entity.contentVersion,
      snapshot: pageSnapshot({
        text: "Private replacement copy.",
      }),
    },
    NOW,
  );
  assert.equal(
    (await getPublicPageContent(database, "about")).sections[0].content.text,
    "Existing public copy for curious Vancouver neighbours.",
  );
  const preview = await readCmsRevisionPreview(
    database,
    adminIdentity,
    draft.revision.id,
  );
  assert.equal(preview.snapshot.blocks[0].config.text, "Private replacement copy.");

  const residueBeforeStale = cmsResidue(database, "page-about");
  await assert.rejects(
    saveCmsEntityDraft(
      database,
      ownerIdentity,
      "page",
      "page-about",
      {
        expectedContentVersion: initial.entity.contentVersion,
        snapshot: pageSnapshot({ text: "Stale content." }),
      },
      NOW + 1,
    ),
    (error) => error?.status === 409,
  );
  assert.deepEqual(cmsResidue(database, "page-about"), residueBeforeStale);

  const published = await publishCmsEntity(
    database,
    adminIdentity,
    "page",
    "page-about",
    { expectedContentVersion: draft.entity.contentVersion },
    NOW + 2,
  );
  assert.equal(published.entity.workflowStatus, "published");
  assert.equal(
    (await getPublicPageContent(database, "about")).sections[0].content.text,
    "Private replacement copy.",
  );
  await assert.rejects(
    saveCmsEntityDraft(
      database,
      ownerIdentity,
      "page",
      "page-about",
      {
        expectedContentVersion: published.entity.contentVersion,
        snapshot: pageSnapshot({ slug: "about-renamed" }),
      },
      NOW + 3,
    ),
    (error) => error?.status === 409,
  );
  await assert.rejects(
    unpublishCmsEntity(
      database,
      ownerIdentity,
      "page",
      "page-about",
      { expectedContentVersion: published.entity.contentVersion },
      NOW + 6,
    ),
    (error) => error?.status === 409,
  );
  assert.ok(await getPublicPageContent(database, "about"));
});

test("optional Resources workflow keeps its permanent route, publishes once under concurrency, unpublishes, and restores immutable history", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await listCmsEntities(database, ownerIdentity);

  const created = await createCmsEntityDraft(
    database,
    ownerIdentity,
    "page",
    { snapshot: pageSnapshot({ slug: "resources", text: "Reading list draft." }) },
    NOW,
  );
  assert.equal(await getPublicPageContent(database, "resources"), null);
  assert.equal(created.permissions.canChangeSlug, false);
  assert.equal(created.permissions.canUnpublish, false);
  const expected = created.entity.contentVersion;
  const attempts = await Promise.allSettled([
    publishCmsEntity(
      database,
      ownerIdentity,
      "page",
      created.entity.entityKey,
      { expectedContentVersion: expected },
      NOW + 1,
    ),
    publishCmsEntity(
      database,
      adminIdentity,
      "page",
      created.entity.entityKey,
      { expectedContentVersion: expected },
      NOW + 1,
    ),
  ]);
  assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(attempts.filter(({ status }) => status === "rejected").length, 1);
  let workspace = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "page",
    created.entity.entityKey,
  );
  assert.equal(workspace.entity.workflowStatus, "published");
  assert.equal(workspace.permissions.canUnpublish, true);
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM audit_logs
       WHERE entity_id = ?
         AND action = 'cms.entity_published'`,
      created.entity.entityKey,
    ),
    1,
  );

  const beforeRenameAttempt = cmsResidue(
    database,
    created.entity.entityKey,
  );
  await assert.rejects(
    saveCmsEntityDraft(
      database,
      ownerIdentity,
      "page",
      created.entity.entityKey,
      {
        expectedContentVersion: workspace.entity.contentVersion,
        snapshot: pageSnapshot({
          slug: "reading-packets",
          text: "This route change must not persist.",
        }),
      },
      NOW + 2,
    ),
    (error) => error?.status === 409,
  );
  assert.deepEqual(
    cmsResidue(database, created.entity.entityKey),
    beforeRenameAttempt,
  );
  workspace = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "page",
    created.entity.entityKey,
    {
      expectedContentVersion: workspace.entity.contentVersion,
      snapshot: pageSnapshot({
        slug: "resources",
        text: "Published reading packets.",
      }),
    },
    NOW + 3,
  );
  workspace = await publishCmsEntity(
    database,
    ownerIdentity,
    "page",
    created.entity.entityKey,
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 4,
  );
  assert.equal(
    (await getPublicPageContent(database, "resources")).sections[0].content
      .text,
    "Published reading packets.",
  );

  const historicalRevisionId = created.revision.id;
  workspace = await unpublishCmsEntity(
    database,
    adminIdentity,
    "page",
    created.entity.entityKey,
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 7,
  );
  assert.equal(await getPublicPageContent(database, "resources"), null);
  const restored = await restoreCmsRevisionAsDraft(
    database,
    ownerIdentity,
    "page",
    created.entity.entityKey,
    {
      expectedContentVersion: workspace.entity.contentVersion,
      revisionId: historicalRevisionId,
    },
    NOW + 6,
  );
  assert.equal(restored.revision.snapshot.slug, "resources");
  assert.equal(restored.revision.snapshot.blocks[0].config.text, "Reading list draft.");
  assert.equal(await getPublicPageContent(database, "resources"), null);
  assert.ok(
    restored.revisions.some(
      (revision) =>
        revision.id === historicalRevisionId &&
        revision.id !== restored.revision.id,
    ),
  );
});

test("published club resource dependencies block Resources unpublish and stale public targets are suppressed", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await listCmsEntities(database, ownerIdentity);

  let resources = await createCmsEntityDraft(
    database,
    ownerIdentity,
    "page",
    {
      snapshot: pageSnapshot({
        metaDescription: "Confirmed reading packets.",
        seoTitle: "Resources",
        slug: "resources",
        text: "Confirmed reading packets.",
        title: "Resources",
      }),
    },
    NOW,
  );
  resources = await publishCmsEntity(
    database,
    ownerIdentity,
    "page",
    resources.entity.entityKey,
    { expectedContentVersion: resources.entity.contentVersion },
    NOW + 1,
  );
  let club = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "club_public_profile",
    "club-main",
  );
  club = await saveCmsEntityDraft(
    database,
    adminIdentity,
    "club_public_profile",
    "club-main",
    {
      expectedContentVersion: club.entity.contentVersion,
      snapshot: {
        ...club.revision.snapshot,
        relatedResourceIds: [
          resources.entity.entityKey,
          "page-about",
          "missing-private-resource",
        ],
      },
    },
    NOW + 4,
  );
  club = await publishCmsEntity(
    database,
    adminIdentity,
    "club_public_profile",
    "club-main",
    { expectedContentVersion: club.entity.contentVersion },
    NOW + 3,
  );
  assert.deepEqual(
    (await getPublicClubBySlug(
      database,
      "vancouver-curiosity-club",
    )).relatedResources,
    [
      {
        label: "Resources",
        url: "/resources",
      },
      {
        label: "About",
        url: "/about",
      },
    ],
    "only the exact eligible published subset is materialized",
  );
  const clubReceiptProjection = String(
    database.sqlite
      .prepare(
        `SELECT projection_json
         FROM cms_public_materialization_receipts
         WHERE revision_id = ?`,
      )
      .get(club.revision.id).projection_json,
  );
  const clubReceiptParity = (projectionJson) =>
    Number(
      database.sqlite
        .prepare(
          `WITH receipt AS (
             SELECT 'club_public_profile' AS entity_type,
                    'org-main' AS organization_id,
                    ? AS projection_json
           ),
           revision AS (
             SELECT snapshot_json
             FROM cms_entity_revisions
             WHERE id = ?
           )
           SELECT ${cmsReceiptMatchesRevisionSql(
             "receipt",
             "revision",
           )} AS matches
           FROM receipt, revision`,
        )
        .get(projectionJson, club.revision.id).matches,
    );
  assert.equal(clubReceiptParity(clubReceiptProjection), 1);
  const forgedResourceProof = JSON.parse(clubReceiptProjection);
  forgedResourceProof.details.relatedResourceBindings[0].receiptId =
    "forged-resource-receipt";
  assert.equal(
    clubReceiptParity(JSON.stringify(forgedResourceProof)),
    0,
    "a selected resource must retain its exact immutable receipt proof",
  );
  const outOfRangeResourceProof = JSON.parse(clubReceiptProjection);
  outOfRangeResourceProof.details.relatedResourceBindings[0].selectedIndex =
    99;
  assert.equal(
    clubReceiptParity(JSON.stringify(outOfRangeResourceProof)),
    0,
    "an out-of-range selected-resource index cannot authenticate",
  );
  const duplicateResourceProof = JSON.parse(clubReceiptProjection);
  duplicateResourceProof.details.relatedResourceBindings[1].selectedIndex =
    duplicateResourceProof.details.relatedResourceBindings[0].selectedIndex;
  duplicateResourceProof.details.relatedResourceBindings[1].id =
    duplicateResourceProof.details.relatedResourceBindings[0].id;
  assert.equal(
    clubReceiptParity(JSON.stringify(duplicateResourceProof)),
    0,
    "duplicate selected-resource indices cannot authenticate",
  );
  const injectedResourceProof = JSON.parse(clubReceiptProjection);
  injectedResourceProof.details.relatedResourceBindings[0].label =
    "Injected private link";
  injectedResourceProof.details.relatedResourceBindings[0].url =
    "https://private.example.test/";
  injectedResourceProof.details.relatedResources[0] = {
    label: "Injected private link",
    url: "https://private.example.test/",
  };
  assert.equal(
    clubReceiptParity(JSON.stringify(injectedResourceProof)),
    0,
    "a self-consistent injected link cannot replace historical Page proof",
  );
  await assert.rejects(
    unpublishCmsEntity(
      database,
      ownerIdentity,
      "page",
      resources.entity.entityKey,
      { expectedContentVersion: resources.entity.contentVersion },
      NOW + 6,
    ),
    (error) =>
      error?.status === 409 &&
      /Vancouver Curiosity Club|published club profiles/u.test(
        error.message,
      ),
  );
  assert.ok(await getPublicPageContent(database, "resources"));

  database.exec(
    `UPDATE pages
     SET status = 'draft',
         visibility = 'private',
         published_at = NULL
     WHERE id = '${resources.entity.entityKey}'
       AND organization_id = 'org-main'`,
  );
  assert.deepEqual(
    (await getPublicClubBySlug(
      database,
      "vancouver-curiosity-club",
    )).relatedResources,
    [
      {
        label: "About",
        url: "/about",
      },
    ],
    "a stale dependency is filtered at link level without invalidating its parent Club receipt",
  );
  database.exec(
    `UPDATE pages
     SET status = 'published',
         visibility = 'public',
         published_at = ${NOW + 1}
     WHERE id = '${resources.entity.entityKey}'
       AND organization_id = 'org-main'`,
  );

  club = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "club_public_profile",
    "club-main",
    {
      expectedContentVersion: club.entity.contentVersion,
      snapshot: {
        ...club.revision.snapshot,
        relatedResourceIds: [],
      },
    },
    NOW + 7,
  );
  await publishCmsEntity(
    database,
    ownerIdentity,
    "club_public_profile",
    "club-main",
    { expectedContentVersion: club.entity.contentVersion },
    NOW + 6,
  );
  let program = await createCmsEntityDraft(
    database,
    ownerIdentity,
    "program_public_profile",
    {
      snapshot: programProfileSnapshot({
        name: "Resource-linked Program",
        relatedResourceIds: [resources.entity.entityKey],
        slug: "resource-linked-program",
      }),
    },
    NOW + 7,
  );
  program = await publishCmsEntity(
    database,
    ownerIdentity,
    "program_public_profile",
    program.entity.entityKey,
    { expectedContentVersion: program.entity.contentVersion },
    NOW + 8,
  );
  await assert.rejects(
    unpublishCmsEntity(
      database,
      ownerIdentity,
      "page",
      resources.entity.entityKey,
      { expectedContentVersion: resources.entity.contentVersion },
      NOW + 9,
    ),
    (error) =>
      error?.status === 409 &&
      /Resource-linked Program|Club or Program profiles/u.test(
        error.message,
      ),
  );
  program = await unpublishCmsEntity(
    database,
    ownerIdentity,
    "program_public_profile",
    program.entity.entityKey,
    { expectedContentVersion: program.entity.contentVersion },
    NOW + 10,
  );
  assert.equal(program.entity.workflowStatus, "unpublished");
  resources = await unpublishCmsEntity(
    database,
    ownerIdentity,
    "page",
    resources.entity.entityKey,
    { expectedContentVersion: resources.entity.contentVersion },
    NOW + 11,
  );
  assert.equal(resources.entity.workflowStatus, "unpublished");
});

test("Community publication requires explicit confirmation, rejects duplicate normalized destinations, and unpublishes cleanly", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await listCmsEntities(database, ownerIdentity);
  const adoptedPublicLinks = await listPublicCommunityLinks(database);
  assert.equal(
    adoptedPublicLinks.filter(({ url }) =>
      url.startsWith("https://www.meetup.com/"),
    ).length,
    3,
    "the three confirmed adopted Meetup destinations remain public",
  );
  database.exec(
    `INSERT INTO community_links (
       id, organization_id, label, url, link_type, is_published, sort_order,
       created_by_profile_id, created_at, updated_at, deleted_at
     ) VALUES (
       'legacy-community-without-receipt',
       'org-main',
       'Legacy unauthenticated destination',
       'https://example.org/legacy-community',
       'resource',
       1,
       999,
       'profile-owner',
       ${NOW - 2},
       ${NOW - 2},
       NULL
     )`,
  );
  assert.equal(
    (await listPublicCommunityLinks(database)).some(
      ({ url }) => url === "https://example.org/legacy-community",
    ),
    false,
    "a legacy base row without an authenticated Phase 6 projection stays private",
  );
  database.exec(
    `INSERT INTO community_link_public_details (
       community_link_id, organization_id, description, destination_type,
       confirmed_by_profile_id, confirmed_at, created_at, updated_at
     ) VALUES (
       'legacy-community-without-receipt',
       'org-main',
       'Synthetic confirmed details without a publication receipt.',
       'resource',
       'profile-owner',
       ${NOW - 1},
       ${NOW - 1},
       ${NOW - 1}
     )`,
  );
  assert.equal(
    (await listPublicCommunityLinks(database)).some(
      ({ url }) => url === "https://example.org/legacy-community",
    ),
    false,
    "confirmed details without an exact current revision receipt stay private",
  );

  let workspace = await createCmsEntityDraft(
    database,
    adminIdentity,
    "community_link",
    {
      snapshot: communitySnapshot({
        confirmed: false,
        url: "https://example.org/community?utm_source=test#fragment",
      }),
    },
    NOW,
  );
  await assert.rejects(
    publishCmsEntity(
      database,
      adminIdentity,
      "community_link",
      workspace.entity.entityKey,
      { expectedContentVersion: workspace.entity.contentVersion },
      NOW + 1,
    ),
    (error) => error?.status === 409,
  );
  assert.equal(
    (await listPublicCommunityLinks(database)).some(
      ({ url }) => url === "https://example.org/community?utm_source=test",
    ),
    false,
  );
  workspace = await saveCmsEntityDraft(
    database,
    adminIdentity,
    "community_link",
    workspace.entity.entityKey,
    {
      expectedContentVersion: workspace.entity.contentVersion,
      snapshot: communitySnapshot({
        confirmed: true,
        url: "https://example.org/community?utm_source=test#fragment",
      }),
    },
    NOW + 2,
  );
  workspace = await publishCmsEntity(
    database,
    adminIdentity,
    "community_link",
    workspace.entity.entityKey,
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 3,
  );
  assert.equal(
    (await listPublicCommunityLinks(database)).some(
      ({ url }) => url === "https://example.org/community?utm_source=test",
    ),
    true,
  );
  database.exec(
    `UPDATE organization_memberships
     SET status = 'suspended', updated_at = ${NOW + 4}
     WHERE id = 'membership-admin'`,
  );
  assert.equal(
    (await listPublicCommunityLinks(database)).some(
      ({ url }) => url === "https://example.org/community?utm_source=test",
    ),
    true,
    "a durable published confirmation must not disappear when its historical confirmer later loses authority",
  );
  const suspendedConfirmerPreview = await readCmsRevisionPreview(
    database,
    ownerIdentity,
    workspace.revision.id,
  );
  assert.equal(
    suspendedConfirmerPreview.communityLinkOrder.some(
      ({ entityKey }) => entityKey === workspace.entity.entityKey,
    ),
    true,
  );
  await assert.rejects(
    unpublishCmsEntity(
      database,
      adminIdentity,
      "community_link",
      workspace.entity.entityKey,
      { expectedContentVersion: workspace.entity.contentVersion },
      NOW + 4,
    ),
    (error) => error?.status === 403,
    "the suspended historical confirmer must not retain mutation authority",
  );
  database.exec(
    `UPDATE organization_memberships
     SET status = 'active', updated_at = ${NOW + 4}
     WHERE id = 'membership-admin'`,
  );
  workspace = await saveCmsEntityDraft(
    database,
    adminIdentity,
    "community_link",
    workspace.entity.entityKey,
    {
      expectedContentVersion: workspace.entity.contentVersion,
      snapshot: communitySnapshot({
        confirmed: true,
        label: "Renamed destination",
        sortOrder: 5,
        url: "https://example.org/renamed-community",
      }),
    },
    NOW + 4,
  );
  const renamedPreview = await readCmsRevisionPreview(
    database,
    adminIdentity,
    workspace.revision.id,
  );
  assert.deepEqual(
    renamedPreview.communityLinkOrder.find(
      ({ entityKey }) => entityKey === workspace.entity.entityKey,
    ),
    {
      entityKey: workspace.entity.entityKey,
      sortOrder: 40,
      url: "https://example.org/community?utm_source=test",
    },
    "private preview ordering must identify and replace the published entity by key",
  );
  workspace = await saveCmsEntityDraft(
    database,
    adminIdentity,
    "community_link",
    workspace.entity.entityKey,
    {
      expectedContentVersion: workspace.entity.contentVersion,
      snapshot: communitySnapshot({
        confirmed: false,
        label: "Hidden renamed destination",
        sortOrder: 5,
        url: "https://example.org/hidden-community",
      }),
    },
    NOW + 5,
  );
  const hiddenPreview = await readCmsRevisionPreview(
    database,
    adminIdentity,
    workspace.revision.id,
  );
  assert.equal(hiddenPreview.snapshot.confirmed, false);
  assert.equal(
    hiddenPreview.communityLinkOrder.some(
      ({ entityKey }) => entityKey === workspace.entity.entityKey,
    ),
    true,
    "the private identity remains available so an unconfirmed draft removes the published link throughout preview",
  );
  await assert.rejects(
    createCmsEntityDraft(
      database,
      ownerIdentity,
      "community_link",
      {
        snapshot: communitySnapshot({
          confirmed: true,
          url: "https://example.org/community?utm_source=test#other",
        }),
      },
      NOW + 4,
    ),
    (error) => error?.status === 409,
  );
  workspace = await unpublishCmsEntity(
    database,
    ownerIdentity,
    "community_link",
    workspace.entity.entityKey,
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 5,
  );
  assert.equal(
    (await listPublicCommunityLinks(database)).some(
      ({ url }) => url === "https://example.org/community?utm_source=test",
    ),
    false,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM community_link_public_details
       WHERE community_link_id = ?`,
      workspace.entity.entityKey,
    ),
    1,
  );
});

test("club, navigation, identity, and dynamic blocks materialize allowlisted public values without internal IDs", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedApprovedMedia(database);
  await listCmsEntities(database, ownerIdentity);
  await ensureRuntimeInvariantReadiness(database);

  let club = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "club_public_profile",
    "club-main",
  );
  club = await saveCmsEntityDraft(
    database,
    adminIdentity,
    "club_public_profile",
    "club-main",
    {
      expectedContentVersion: club.entity.contentVersion,
      snapshot: {
        ...club.revision.snapshot,
        coverAssetId: "asset-approved",
        description: "Updated full public description.",
        imageAltText: "Approved public club artwork.",
        metaDescription: "A concise factual club search description.",
        name: "Vancouver Curiosity Club",
        openGraphAssetId: "asset-approved",
        relatedResourceIds: ["page-about", "missing-private-resource"],
        slug: "vancouver-curiosity-club-updated",
        socialUrls: [
          "https://www.meetup.com/vancouver-meetup-group/",
          "https://social.example/public",
        ],
        seoTitle: "Curiosity Club gatherings",
        summary: "Updated public summary.",
        thumbnailAssetId: "asset-approved",
      },
    },
    NOW,
  );
  assert.equal(
    (await getPublicClubBySlug(database, "vancouver-curiosity-club"))
      .description,
    "Thoughtful Vancouver events.",
  );
  club = await publishCmsEntity(
    database,
    adminIdentity,
    "club_public_profile",
    "club-main",
    { expectedContentVersion: club.entity.contentVersion },
    NOW + 1,
  );
  const publicClub = await getPublicClubBySlug(
    database,
    "vancouver-curiosity-club-updated",
  );
  assert.equal(publicClub.description, "Updated public summary.");
  assert.equal(publicClub.coverAssetId, "asset-approved");
  assert.equal(publicClub.metaDescription, "A concise factual club search description.");
  assert.equal(publicClub.openGraphAssetId, "asset-approved");
  assert.equal(publicClub.seoTitle, "Curiosity Club gatherings");
  assert.deepEqual(publicClub.socialLinks, [
    {
      label: "Meetup",
      url: "https://www.meetup.com/vancouver-meetup-group/",
    },
    { label: "social.example", url: "https://social.example/public" },
  ]);
  assert.deepEqual(publicClub.relatedResources, [
    { label: "About", url: "/about" },
  ]);
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_usage_references
       WHERE revision_id = ?
         AND usage_kind = 'open_graph'
         AND publication_scope = 'published'
         AND deleted_at IS NULL`,
      club.revision.id,
    ),
    1,
  );
  assert.doesNotMatch(
    JSON.stringify(publicClub),
    /page-about|missing-private-resource|profile-owner/u,
  );
  assert.equal(
    await getPublicSlugRedirect(database, {
      entityType: "club_public_profile",
      fromSlug: "vancouver-curiosity-club",
    }),
    "vancouver-curiosity-club-updated",
  );
  club = await unpublishCmsEntity(
    database,
    adminIdentity,
    "club_public_profile",
    "club-main",
    { expectedContentVersion: club.entity.contentVersion },
    NOW + 2,
  );
  assert.equal(
    await getPublicSlugRedirect(database, {
      entityType: "club_public_profile",
      fromSlug: "vancouver-curiosity-club",
    }),
    null,
  );
  assert.equal(
    await getPublicClubBySlug(
      database,
      "vancouver-curiosity-club-updated",
    ),
    null,
  );
  await publishCmsEntity(
    database,
    ownerIdentity,
    "club_public_profile",
    "club-main",
    { expectedContentVersion: club.entity.contentVersion },
    NOW + 3,
  );
  assert.equal(
    await getPublicSlugRedirect(database, {
      entityType: "club_public_profile",
      fromSlug: "vancouver-curiosity-club",
    }),
    "vancouver-curiosity-club-updated",
  );

  let navigation = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "navigation",
    "navigation",
  );
  navigation = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "navigation",
    "navigation",
    {
      expectedContentVersion: navigation.entity.contentVersion,
      snapshot: {
        items: navigation.revision.snapshot.items.map((item) =>
          item.target === "/events"
            ? { ...item, label: "What’s On" }
            : item,
        ),
      },
    },
    NOW + 4,
  );
  await publishCmsEntity(
    database,
    ownerIdentity,
    "navigation",
    "navigation",
    { expectedContentVersion: navigation.entity.contentVersion },
    NOW + 5,
  );
  assert.equal(
    (await listPublicNavigation(database)).header.find(
      ({ href }) => href === "/events",
    ).label,
    "What’s On",
  );
  assert.equal(
    (await listPublicNavigation(database)).header.find(
      ({ href }) => href === "/organizer",
    ).label,
    "Organizer Login",
  );

  let identity = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "site_identity",
    "site_identity",
  );
  const siteBefore = await getPublicSiteContext(database);
  identity = await saveCmsEntityDraft(
    database,
    adminIdentity,
    "site_identity",
    "site_identity",
    {
      expectedContentVersion: identity.entity.contentVersion,
      snapshot: {
        ...identity.revision.snapshot,
        footerMission: "Updated private footer draft.",
      },
    },
    NOW + 6,
  );
  assert.equal(
    (await getPublicSiteContext(database)).footerMission,
    siteBefore.footerMission,
  );
  identity = await publishCmsEntity(
    database,
    adminIdentity,
    "site_identity",
    "site_identity",
    { expectedContentVersion: identity.entity.contentVersion },
    NOW + 7,
  );
  assert.equal(identity.permissions.canUnpublish, false);
  assert.equal(
    (await getPublicSiteContext(database)).footerMission,
    "Updated private footer draft.",
  );
  const publishedIdentity = await getPublicSiteContext(database);
  await assert.rejects(
    unpublishCmsEntity(
      database,
      ownerIdentity,
      "site_identity",
      "site_identity",
      { expectedContentVersion: identity.entity.contentVersion },
    NOW + 8,
    ),
    (error) => error?.status === 409,
  );
  assert.deepEqual(await getPublicSiteContext(database), publishedIdentity);

  const featuredEvent = await createPublishedClubEvent(database, "club-main");
  const dynamicPage = await createCmsEntityDraft(
    database,
    ownerIdentity,
    "page",
    {
      snapshot: pageSnapshot({
        blocks: [
          {
            id: "featured-club",
            type: "featured_clubs",
            config: {
              heading: "Selected club",
              ids: ["club-main"],
              limit: 1,
            },
          },
          {
            id: "selected-community",
            type: "community_links",
            config: {
              heading: "Selected destination",
              ids: ["community-two"],
              limit: 1,
            },
          },
          {
            id: "selected-event",
            type: "featured_events",
            config: {
              heading: "Selected event",
              ids: [`organizer:${featuredEvent.id}`],
              limit: 1,
            },
          },
        ],
        openGraphAssetId: "asset-approved",
        slug: "resources",
      }),
    },
    NOW + 9,
  );
  const dynamicPreview = await readCmsRevisionPreview(
    database,
    adminIdentity,
    dynamicPage.revision.id,
  );
  assert.deepEqual(
    dynamicPreview.snapshot.blocks[0].config.clubSlugs,
    ["vancouver-curiosity-club-updated"],
  );
  assert.deepEqual(
    dynamicPreview.snapshot.blocks[1].config.links,
    [
      {
        label: "Vancouver Literature and Film",
        url: "https://www.meetup.com/vancouver-literature-and-film/",
      },
    ],
  );
  assert.deepEqual(dynamicPreview.snapshot.blocks[2].config.eventSlugs, [
    featuredEvent.slug,
  ]);
  assert.equal(dynamicPreview.snapshot.openGraphAssetId, "asset-approved");
  assert.equal(dynamicPreview.mediaAssets[0]?.assetId, "asset-approved");
  assert.doesNotMatch(
    JSON.stringify(dynamicPreview.snapshot.blocks),
    /club-main|community-two|profile-owner/u,
  );
  await publishCmsEntity(
    database,
    ownerIdentity,
    "page",
    dynamicPage.entity.entityKey,
    { expectedContentVersion: dynamicPage.entity.contentVersion },
    NOW + 10,
  );
  const materialized = database.sqlite
    .prepare(
      `SELECT section_type, content_json
       FROM page_sections
       WHERE page_id = ?
         AND deleted_at IS NULL
       ORDER BY sort_order`,
    )
    .all(dynamicPage.entity.entityKey);
  assert.deepEqual(JSON.parse(materialized[0].content_json), {
    clubSlugs: ["vancouver-curiosity-club-updated"],
    heading: "Selected club",
    limit: 1,
  });
  assert.deepEqual(JSON.parse(materialized[1].content_json), {
    heading: "Selected destination",
    limit: 1,
    links: [
      {
        label: "Vancouver Literature and Film",
        url: "https://www.meetup.com/vancouver-literature-and-film/",
      },
    ],
  });
  assert.deepEqual(JSON.parse(materialized[2].content_json), {
    eventSlugs: [featuredEvent.slug],
    heading: "Selected event",
    limit: 1,
  });
  assert.doesNotMatch(
    materialized.map(({ content_json }) => content_json).join("\n"),
    /club-main|community-two|profile-owner/u,
  );
  const materializationReceiptJson = String(
    database.sqlite
      .prepare(
        `SELECT projection_json
         FROM cms_public_materialization_receipts
         WHERE revision_id = ?`,
      )
      .get(dynamicPage.revision.id).projection_json,
  );
  const receiptParity = (projectionJson) =>
    Number(
      database.sqlite
        .prepare(
          `WITH receipt AS (
             SELECT 'page' AS entity_type,
                    'org-main' AS organization_id,
                    ? AS projection_json
           ),
           revision AS (
             SELECT snapshot_json
             FROM cms_entity_revisions
             WHERE id = ?
           )
           SELECT ${cmsReceiptMatchesRevisionSql(
             "receipt",
             "revision",
             {
               unifiedPublicEventCteSql:
                 publicEventSelectionProofCteSqlForOrganization(
                   "receipt.organization_id",
                 ),
             },
           )} AS matches
           FROM receipt, revision`,
        )
        .get(projectionJson, dynamicPage.revision.id).matches,
    );
  assert.equal(receiptParity(materializationReceiptJson), 1);
  const forgedClubProjection = JSON.parse(materializationReceiptJson);
  forgedClubProjection.sections[0].contentJson = JSON.stringify({
    clubSlugs: ["forged-same-length-club"],
    heading: "Selected club",
    limit: 1,
  });
  assert.equal(
    receiptParity(JSON.stringify(forgedClubProjection)),
    0,
    "same-length dynamic club substitutions must not satisfy a receipt",
  );
  const forgedCommunityProjection = JSON.parse(materializationReceiptJson);
  forgedCommunityProjection.sections[1].contentJson = JSON.stringify({
    heading: "Selected destination",
    limit: 1,
    links: [
      {
        label: "Vancouver Curiosity Club",
        url: "https://www.meetup.com/vancouver-meetup-group/",
      },
    ],
  });
  assert.equal(
    receiptParity(JSON.stringify(forgedCommunityProjection)),
    0,
    "same-length dynamic Community substitutions must not satisfy a receipt",
  );
  const forgedEventProjection = JSON.parse(materializationReceiptJson);
  forgedEventProjection.sections[2].contentJson = JSON.stringify({
    eventSlugs: ["forged-same-length-event"],
    heading: "Selected event",
    limit: 1,
  });
  assert.equal(
    receiptParity(JSON.stringify(forgedEventProjection)),
    0,
    "same-length dynamic event substitutions must not satisfy a receipt",
  );
  const parsedReceipt = JSON.parse(materializationReceiptJson);
  const eventSourceProof = database.sqlite
    .prepare(
      `SELECT 'organizer:' || event.content_version || ':' ||
              event.schedule_version AS event_source_version,
              club_state.id AS club_state_id,
              club_state.content_version AS club_content_version,
              club_revision.id AS club_revision_id,
              club_revision.content_hash AS club_revision_hash,
              club_receipt.id AS club_receipt_id,
              event.program_id
       FROM organizer_events AS event
       JOIN cms_entity_publication_states AS club_state
         ON club_state.organization_id = event.organization_id
        AND club_state.entity_type = 'club_public_profile'
        AND club_state.entity_key = event.club_id
        AND club_state.workflow_status IN ('published', 'archived')
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
       WHERE event.id = ?`,
    )
    .get(featuredEvent.id);
  assert.equal(
    eventSourceProof.program_id,
    null,
    "this fixture intentionally proves the explicit program-none token",
  );
  const expectedClubProjectionToken = JSON.stringify([
    eventSourceProof.club_state_id,
    eventSourceProof.club_content_version,
    eventSourceProof.club_revision_id,
    eventSourceProof.club_revision_hash,
    eventSourceProof.club_receipt_id,
  ]);
  const expectedEventSourceVersion =
    `${eventSourceProof.event_source_version}` +
    `|club:${expectedClubProjectionToken}|program:none`;
  assert.deepEqual(parsedReceipt.eventSelectionProofs, [
    {
      requestedId: `organizer:${featuredEvent.id}`,
      slug: featuredEvent.slug,
      sourceIdentity: `organizer:${featuredEvent.id}`,
      sourceVersion: expectedEventSourceVersion,
    },
  ]);
  assert.doesNotMatch(
    materialized.map(({ content_json }) => content_json).join("\n"),
    /eventSelectionProofs|sourceIdentity|sourceVersion/u,
  );
  assert.doesNotMatch(
    JSON.stringify(await getPublicPageContent(database, "resources")),
    /eventSelectionProofs|sourceIdentity|sourceVersion/u,
  );
  for (const [label, mutate] of [
    [
      "missing proof",
      (projection) => {
        projection.eventSelectionProofs = [];
      },
    ],
    [
      "duplicate proof",
      (projection) => {
        projection.eventSelectionProofs.push({
          ...projection.eventSelectionProofs[0],
        });
      },
    ],
    [
      "stale source version",
      (projection) => {
        projection.eventSelectionProofs[0].sourceVersion += ":stale";
      },
    ],
    [
      "forged source identity",
      (projection) => {
        projection.eventSelectionProofs[0].sourceIdentity =
          "organizer:forged-event";
      },
    ],
    [
      "self-consistent forged slug",
      (projection) => {
        projection.eventSelectionProofs[0].slug =
          "forged-same-length-event";
        projection.sections[2].contentJson = JSON.stringify({
          eventSlugs: ["forged-same-length-event"],
          heading: "Selected event",
          limit: 1,
        });
      },
    ],
  ]) {
    const projection = structuredClone(parsedReceipt);
    mutate(projection);
    assert.equal(
      receiptParity(JSON.stringify(projection)),
      0,
      `${label} must not satisfy a page receipt`,
    );
  }
});

test("club and site palette publication enforce cross-entity contrast with race-safe guards", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await listCmsEntities(database, ownerIdentity);

  let identity = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "site_identity",
    "site_identity",
  );
  identity = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "site_identity",
    "site_identity",
    {
      expectedContentVersion: identity.entity.contentVersion,
      snapshot: {
        ...identity.revision.snapshot,
        palette: {
          accent: "#1B43A8",
          background: "#D0D8D6",
          foreground: "#142C30",
          secondary: "#0C665E",
        },
      },
    },
    NOW,
  );
  identity = await publishCmsEntity(
    database,
    ownerIdentity,
    "site_identity",
    "site_identity",
    { expectedContentVersion: identity.entity.contentVersion },
    NOW + 1,
  );

  let club = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "club_public_profile",
    "club-main",
  );
  club = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "club_public_profile",
    "club-main",
    {
      expectedContentVersion: club.entity.contentVersion,
      snapshot: {
        ...club.revision.snapshot,
        themeColor: "#0C665E",
      },
    },
    NOW + 2,
  );
  club = await publishCmsEntity(
    database,
    ownerIdentity,
    "club_public_profile",
    "club-main",
    { expectedContentVersion: club.entity.contentVersion },
    NOW + 3,
  );
  club = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "club_public_profile",
    "club-main",
    {
      expectedContentVersion: club.entity.contentVersion,
      snapshot: {
        ...club.revision.snapshot,
        themeColor: "#2C6D68",
      },
    },
    NOW + 2,
  );
  await assert.rejects(
    publishCmsEntity(
      database,
      ownerIdentity,
      "club_public_profile",
      "club-main",
      { expectedContentVersion: club.entity.contentVersion },
      NOW + 5,
    ),
    (error) =>
      error?.status === 409 &&
      /current published site surfaces/u.test(error.message),
  );
  assert.equal(
    (await getPublicClubBySlug(database, "vancouver-curiosity-club"))
      .themeColor,
    "#0c665e",
  );

  identity = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "site_identity",
    "site_identity",
    {
      expectedContentVersion: identity.entity.contentVersion,
      snapshot: {
        ...identity.revision.snapshot,
        palette: {
          accent: "#1B43A8",
          background: "#D9C9B2",
          foreground: "#142C30",
          secondary: "#164E4A",
        },
      },
    },
    NOW + 6,
  );
  await assert.rejects(
    publishCmsEntity(
      database,
      ownerIdentity,
      "site_identity",
      "site_identity",
      { expectedContentVersion: identity.entity.contentVersion },
      NOW + 7,
    ),
    (error) =>
      error?.status === 409 &&
      /Vancouver Curiosity Club/u.test(error.message),
  );
  assert.equal(
    (await getPublicSiteContext(database)).palette.background,
    "#d0d8d6",
  );

  identity = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "site_identity",
    "site_identity",
    {
      expectedContentVersion: identity.entity.contentVersion,
      snapshot: {
        ...identity.revision.snapshot,
        footerMission: "A race-safe identity draft.",
        palette: {
          accent: "#1B43A8",
          background: "#D0D8D6",
          foreground: "#142C30",
          secondary: "#0C665E",
        },
      },
    },
    NOW + 8,
  );
  const originalBatch = database.batch.bind(database);
  database.batch = async (statements) => {
    database.batch = originalBatch;
    database.sqlite
      .prepare(
        `UPDATE club_public_profile_details
         SET theme_color = '#164E4A', updated_at = ?
         WHERE club_id = 'club-main'
           AND organization_id = 'org-main'`,
      )
      .run(NOW + 9);
    return originalBatch(statements);
  };
  await assert.rejects(
    publishCmsEntity(
      database,
      ownerIdentity,
      "site_identity",
      "site_identity",
      { expectedContentVersion: identity.entity.contentVersion },
      NOW + 10,
    ),
    (error) => error?.status === 409,
  );
  database.batch = originalBatch;
  assert.notEqual(
    (await getPublicSiteContext(database)).footerMission,
    "A race-safe identity draft.",
  );

  club = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "club_public_profile",
    "club-main",
    {
      expectedContentVersion: club.entity.contentVersion,
      snapshot: {
        ...club.revision.snapshot,
        themeColor: "#5A4B20",
      },
    },
    NOW + 11,
  );
  database.batch = async (statements) => {
    database.batch = originalBatch;
    database.sqlite
      .prepare(
        `UPDATE site_settings
         SET value_json = json_set(
               value_json,
               '$.tagline',
               'A concurrent published identity edit.'
             ),
             updated_at = ?
         WHERE organization_id = 'org-main'
           AND key = 'public_identity'
           AND is_public = 1`,
      )
      .run(NOW + 12);
    return originalBatch(statements);
  };
  await assert.rejects(
    publishCmsEntity(
      database,
      ownerIdentity,
      "club_public_profile",
      "club-main",
      { expectedContentVersion: club.entity.contentVersion },
      NOW + 13,
    ),
    (error) => error?.status === 409,
  );
  database.batch = originalBatch;
  assert.equal(
    await getPublicClubBySlug(database, "vancouver-curiosity-club"),
    null,
    "a forged live club projection must fail closed after the race",
  );
});

test("a material public rebrand requires approved logo and social artwork before publication", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await listCmsEntities(database, ownerIdentity);
  const publicBefore = await getPublicSiteContext(database);
  let identity = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "site_identity",
    "site_identity",
  );
  identity = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "site_identity",
    "site_identity",
    {
      expectedContentVersion: identity.entity.contentVersion,
      snapshot: {
        ...identity.revision.snapshot,
        brandName: "Synthetic Field Notes",
        tagline: "A synthetic test tagline.",
      },
    },
    NOW,
  );
  await assert.rejects(
    publishCmsEntity(
      database,
      ownerIdentity,
      "site_identity",
      "site_identity",
      { expectedContentVersion: identity.entity.contentVersion },
      NOW + 1,
    ),
    (error) =>
      error?.status === 409 &&
      /approved logo and an approved Open Graph image/u.test(error.message),
  );
  assert.deepEqual(await getPublicSiteContext(database), publicBefore);

  seedApprovedMedia(database);
  identity = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "site_identity",
    "site_identity",
    {
      expectedContentVersion: identity.entity.contentVersion,
      snapshot: {
        ...identity.revision.snapshot,
        brandName: publicBefore.brandName,
        logoAssetId: null,
        openGraphAssetId: "asset-approved",
        tagline: publicBefore.tagline,
      },
    },
    NOW + 2,
  );
  identity = await publishCmsEntity(
    database,
    ownerIdentity,
    "site_identity",
    "site_identity",
    { expectedContentVersion: identity.entity.contentVersion },
    NOW + 3,
  );
  assert.equal((await getPublicSiteContext(database)).logoAssetId, null);
  assert.equal(
    (await getPublicSiteContext(database)).openGraphAssetId,
    "asset-approved",
  );
  identity = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "site_identity",
    "site_identity",
    {
      expectedContentVersion: identity.entity.contentVersion,
      snapshot: {
        ...identity.revision.snapshot,
        logoAssetId: "asset-approved",
        openGraphAssetId: null,
      },
    },
    NOW + 4,
  );
  await assert.rejects(
    publishCmsEntity(
      database,
      ownerIdentity,
      "site_identity",
      "site_identity",
      { expectedContentVersion: identity.entity.contentVersion },
      NOW + 5,
    ),
    (error) =>
      error?.status === 409 &&
      /approved logo and an approved Open Graph image/u.test(error.message),
    "a changed logo must not retain the shipped social and icon set",
  );
  identity = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "site_identity",
    "site_identity",
    {
      expectedContentVersion: identity.entity.contentVersion,
      snapshot: {
        ...identity.revision.snapshot,
        brandName: "Synthetic Field Notes",
        openGraphAssetId: "asset-approved",
        tagline: "A synthetic test tagline.",
      },
    },
    NOW + 6,
  );
  await publishCmsEntity(
    database,
    ownerIdentity,
    "site_identity",
    "site_identity",
    { expectedContentVersion: identity.entity.contentVersion },
    NOW + 7,
  );
  const published = await getPublicSiteContext(database);
  assert.equal(published.brandName, "Synthetic Field Notes");
  assert.equal(published.logoAssetId, "asset-approved");
  assert.equal(published.openGraphAssetId, "asset-approved");
});

test("historical page preview uses exact retired revision media proof and suppresses revoked assets", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedApprovedMedia(database);
  await listCmsEntities(database, ownerIdentity);
  await ensureRuntimeInvariantReadiness(database);
  const initial = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "page",
    "page-about",
  );
  const mediaDraft = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "page",
    "page-about",
    {
      expectedContentVersion: initial.entity.contentVersion,
      snapshot: pageSnapshot({
        blocks: [
          {
            id: "historical-media",
            type: "media",
            config: {
              assetId: "asset-approved",
              caption: "Historical approved artwork.",
              heading: "Artwork",
            },
          },
        ],
        openGraphAssetId: "asset-approved",
      }),
    },
    NOW,
  );
  await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "page",
    "page-about",
    {
      expectedContentVersion: mediaDraft.entity.contentVersion,
      snapshot: pageSnapshot({ text: "A later revision without artwork." }),
    },
    NOW + 1,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM media_usage_references
       WHERE revision_id = ?
         AND publication_scope = 'draft'
         AND deleted_at IS NOT NULL`,
      mediaDraft.revision.id,
    ),
    2,
  );

  const historical = await readCmsRevisionPreview(
    database,
    adminIdentity,
    mediaDraft.revision.id,
  );
  assert.equal(historical.mediaAssets[0]?.assetId, "asset-approved");
  assert.equal(
    historical.snapshot.blocks[0].config.assetId,
    "asset-approved",
  );
  assert.equal(historical.snapshot.openGraphAssetId, "asset-approved");

  database.exec(`
    UPDATE media_assets
    SET rights_status = 'restricted', updated_at = ${NOW + 2}
    WHERE id = 'asset-approved';
  `);
  const revoked = await readCmsRevisionPreview(
    database,
    ownerIdentity,
    mediaDraft.revision.id,
  );
  assert.equal(revoked.mediaAssets.length, 0);
  assert.equal(revoked.snapshot.openGraphAssetId, null);
  assert.equal("assetId" in revoked.snapshot.blocks[0].config, false);
  assert.doesNotMatch(JSON.stringify(revoked), /private-object-key/u);
});

test("legal confirmation enforces charity polarity and complete provincial facts with no failed-write residue", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  let workspace = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "legal_status",
    "legal_status",
  );
  await ensureRuntimeInvariantReadiness(database);
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
  const expectConfirmationRejectedWithoutResidue = async (
    snapshot,
    issueCode,
    now,
  ) => {
    workspace = await saveCmsEntityDraft(
      database,
      adminIdentity,
      "legal_status",
      "legal_status",
      {
        expectedContentVersion: workspace.entity.contentVersion,
        snapshot,
      },
      now,
    );
    const receiptsBefore = scalar(
      database,
      "SELECT count(*) FROM legal_status_confirmation_receipts",
    );
    const auditsBefore = scalar(
      database,
      `SELECT count(*) FROM audit_logs
       WHERE action = 'cms.legal_status_confirmed'`,
    );
    await assert.rejects(
      confirmCmsLegalStatus(
        database,
        ownerIdentity,
        { expectedContentVersion: workspace.entity.contentVersion },
        now + 1,
      ),
      (error) =>
        error?.issues?.some(({ code }) => code === issueCode),
    );
    assert.equal(
      scalar(
        database,
        "SELECT count(*) FROM legal_status_confirmation_receipts",
      ),
      receiptsBefore,
    );
    assert.equal(
      scalar(
        database,
        `SELECT count(*) FROM audit_logs
         WHERE action = 'cms.legal_status_confirmed'`,
      ),
      auditsBefore,
    );
  };

  await expectConfirmationRejectedWithoutResidue(
    {
      ...neutral,
      footerWording: "We are registered as a charity.",
    },
    "charity_claim_requires_registration",
    NOW,
  );
  const contradictoryRevisionId = workspace.entity.currentDraftRevisionId;
  const contradictoryRevisionHash = scalar(
    database,
    "SELECT content_hash FROM cms_entity_revisions WHERE id = ?",
    contradictoryRevisionId,
  );
  assert.throws(
    () =>
      database.sqlite
        .prepare(
          `INSERT INTO legal_status_confirmation_receipts (
             id, organization_id, revision_id, revision_hash, action,
             actor_profile_id, revokes_receipt_id, created_at
           ) VALUES (
             'crafted-incoherent-confirmation', 'org-main', ?, ?,
             'confirmed', 'profile-owner', NULL, ?
           )`,
        )
        .run(
          contradictoryRevisionId,
          contradictoryRevisionHash,
          NOW + 2,
        ),
    /phase6_legal_confirmation_mismatch/u,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM legal_status_confirmation_receipts
       WHERE id = 'crafted-incoherent-confirmation'`,
    ),
    0,
  );

  await expectConfirmationRejectedWithoutResidue(
    {
      ...neutral,
      charityNumber: "SYNTHETIC-CHARITY",
      charityStatus: "registered",
      footerWording: "We are not a registered charity.",
    },
    "negative_charity_claim_requires_confirmation",
    NOW + 3,
  );
  await expectConfirmationRejectedWithoutResidue(
    {
      ...neutral,
      footerWording: "Incorporated under the Societies Act.",
      legalName: "Synthetic Test Organization",
    },
    "provincial_claim_requires_complete_facts",
    NOW + 6,
  );
  await expectConfirmationRejectedWithoutResidue(
    {
      ...neutral,
      footerWording: "We cannot issue tax receipts.",
    },
    "negative_tax_claim_requires_confirmed_status",
    NOW + 8,
  );

  workspace = await saveCmsEntityDraft(
    database,
    adminIdentity,
    "legal_status",
    "legal_status",
    {
      expectedContentVersion: workspace.entity.contentVersion,
      snapshot: {
        ...neutral,
        charityStatus: "confirmed_not_registered",
        footerWording:
          "We are not a registered charity and cannot issue tax receipts.",
        legalName: "Synthetic Test Organization",
      },
    },
    NOW + 9,
  );
  await confirmCmsLegalStatus(
    database,
    ownerIdentity,
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 10,
  );
  workspace = await publishCmsEntity(
    database,
    ownerIdentity,
    "legal_status",
    "legal_status",
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 11,
  );
  assert.equal(
    (await getPublicSiteContext(database)).legalFooter,
    "We are not a registered charity and cannot issue tax receipts.",
  );

  workspace = await saveCmsEntityDraft(
    database,
    adminIdentity,
    "legal_status",
    "legal_status",
    {
      expectedContentVersion: workspace.entity.contentVersion,
      snapshot: {
        ...neutral,
        charityNumber: "SYNTHETIC-CHARITY",
        charityStatus: "registered",
        footerWording:
          "We are registered with the CRA and can issue donation receipts.",
        legalName: "Synthetic Registered Charity",
      },
    },
    NOW + 12,
  );
  await confirmCmsLegalStatus(
    database,
    ownerIdentity,
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 13,
  );
  workspace = await publishCmsEntity(
    database,
    ownerIdentity,
    "legal_status",
    "legal_status",
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 14,
  );
  const publicSite = await getPublicSiteContext(database);
  assert.equal(publicSite.legalName, "Synthetic Registered Charity");
  assert.equal(
    publicSite.legalFooter,
    "We are registered with the CRA and can issue donation receipts.",
  );
  const incoherentSnapshotJson = JSON.stringify({
    ...neutral,
    footerWording: "We are registered as a charity.",
    legalName: "Crafted unconfirmed charity",
  });
  database.exec(`
    DROP TRIGGER cms_entity_revisions_phase6_before_update;
    DROP TRIGGER site_settings_phase6_media_before_update;
  `);
  database.sqlite
    .prepare(
      `UPDATE cms_entity_revisions
       SET snapshot_json = ?, canonical_byte_size = ?
       WHERE id = ?`,
    )
    .run(
      incoherentSnapshotJson,
      Buffer.byteLength(incoherentSnapshotJson),
      workspace.entity.publishedRevisionId,
    );
  database.sqlite
    .prepare(
      `UPDATE site_settings
       SET value_json = ?, updated_at = ?
       WHERE organization_id = 'org-main'
         AND key = 'public_legal_status'`,
    )
    .run(
      incoherentSnapshotJson,
      NOW + 15,
    );
  const suppressed = await getPublicSiteContext(database);
  assert.equal(suppressed.legalFooter, null);
  assert.equal(suppressed.legalName, null);
});

test("legal drafts are inert until exact Owner confirmation and publication; edits and revocation never leak unconfirmed wording", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  let workspace = await readCmsEntityWorkspace(
    database,
    adminIdentity,
    "legal_status",
    "legal_status",
  );
  assert.equal(workspace.permissions.canConfirmLegal, false);
  workspace = await saveCmsEntityDraft(
    database,
    adminIdentity,
    "legal_status",
    "legal_status",
    {
      expectedContentVersion: workspace.entity.contentVersion,
      snapshot: legalSnapshot("Synthetic legal wording v1"),
    },
    NOW,
  );
  await assert.rejects(
    confirmCmsLegalStatus(
      database,
      adminIdentity,
      { expectedContentVersion: workspace.entity.contentVersion },
      NOW + 1,
    ),
    (error) => error?.status === 403,
  );
  await assert.rejects(
    publishCmsEntity(
      database,
      ownerIdentity,
      "legal_status",
      "legal_status",
      { expectedContentVersion: workspace.entity.contentVersion },
      NOW + 2,
    ),
    (error) => error?.status === 409,
  );
  await confirmCmsLegalStatus(
    database,
    ownerIdentity,
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 3,
  );
  workspace = await publishCmsEntity(
    database,
    ownerIdentity,
    "legal_status",
    "legal_status",
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 4,
  );
  assert.match(
    scalar(
      database,
      `SELECT value_json FROM site_settings
       WHERE organization_id = 'org-main'
         AND key = 'public_legal_status'
         AND is_public = 1`,
    ),
    /Synthetic legal wording v1/u,
  );
  workspace = await saveCmsEntityDraft(
    database,
    adminIdentity,
    "legal_status",
    "legal_status",
    {
      expectedContentVersion: workspace.entity.contentVersion,
      snapshot: legalSnapshot("Synthetic legal wording v2"),
    },
    NOW + 5,
  );
  assert.doesNotMatch(
    scalar(
      database,
      `SELECT value_json FROM site_settings
       WHERE organization_id = 'org-main'
         AND key = 'public_legal_status'`,
    ),
    /wording v2/u,
  );
  const ownerWithNewerDraft = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "legal_status",
    "legal_status",
  );
  assert.equal(ownerWithNewerDraft.permissions.canRevokeLegal, true);
  assert.equal(ownerWithNewerDraft.permissions.canPublish, false);
  assert.equal(ownerWithNewerDraft.permissions.canConfirmLegal, true);
  await assert.rejects(
    publishCmsEntity(
      database,
      ownerIdentity,
      "legal_status",
      "legal_status",
      { expectedContentVersion: workspace.entity.contentVersion },
      NOW + 6,
    ),
    (error) => error?.status === 409,
  );
  workspace = await revokeCmsLegalStatus(
    database,
    ownerIdentity,
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 7,
  );
  assert.equal(workspace.entity.workflowStatus, "unpublished");
  assert.equal(
    scalar(
      database,
      `SELECT is_public FROM site_settings
       WHERE organization_id = 'org-main'
         AND key = 'public_legal_status'`,
    ),
    0,
  );
});

test("published legal confirmation survives ownership transfer while confirmation and revocation remain current-Owner actions", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  let workspace = await readCmsEntityWorkspace(
    database,
    adminIdentity,
    "legal_status",
    "legal_status",
  );
  workspace = await saveCmsEntityDraft(
    database,
    adminIdentity,
    "legal_status",
    "legal_status",
    {
      expectedContentVersion: workspace.entity.contentVersion,
      snapshot: legalSnapshot("Synthetic confirmed legal wording."),
    },
    NOW,
  );
  await confirmCmsLegalStatus(
    database,
    ownerIdentity,
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 1,
  );
  workspace = await publishCmsEntity(
    database,
    ownerIdentity,
    "legal_status",
    "legal_status",
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 2,
  );
  assert.equal(
    (await getPublicSiteContext(database)).legalFooter,
    "Synthetic confirmed legal wording.",
  );

  await transferWorkspaceOwnership(
    database,
    ownerIdentity,
    "membership-admin",
    NOW + 3,
  );
  assert.equal(
    (await getPublicSiteContext(database)).legalFooter,
    "Synthetic confirmed legal wording.",
    "an immutable valid confirmation remains public after its confirmer changes role",
  );

  workspace = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "legal_status",
    "legal_status",
    {
      expectedContentVersion: workspace.entity.contentVersion,
      snapshot: legalSnapshot("Synthetic replacement legal wording."),
    },
    NOW + 4,
  );
  const receiptsBefore = scalar(
    database,
    "SELECT count(*) FROM legal_status_confirmation_receipts",
  );
  const auditsBefore = scalar(
    database,
    `SELECT count(*)
     FROM audit_logs
     WHERE action IN (
       'cms.legal_status_confirmed',
       'cms.legal_status_revoked'
     )`,
  );
  await assert.rejects(
    confirmCmsLegalStatus(
      database,
      ownerIdentity,
      { expectedContentVersion: workspace.entity.contentVersion },
      NOW + 5,
    ),
    (error) => error?.status === 403,
  );
  await assert.rejects(
    revokeCmsLegalStatus(
      database,
      ownerIdentity,
      { expectedContentVersion: workspace.entity.contentVersion },
      NOW + 6,
    ),
    (error) => error?.status === 403,
  );
  assert.equal(
    scalar(
      database,
      "SELECT count(*) FROM legal_status_confirmation_receipts",
    ),
    receiptsBefore,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM audit_logs
       WHERE action IN (
         'cms.legal_status_confirmed',
         'cms.legal_status_revoked'
       )`,
    ),
    auditsBefore,
  );
  assert.equal(
    (await getPublicSiteContext(database)).legalFooter,
    "Synthetic confirmed legal wording.",
  );

  await confirmCmsLegalStatus(
    database,
    adminIdentity,
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 7,
  );
  const currentOwnerWorkspace = await readCmsEntityWorkspace(
    database,
    adminIdentity,
    "legal_status",
    "legal_status",
  );
  assert.equal(currentOwnerWorkspace.permissions.canRevokeLegal, true);
  await revokeCmsLegalStatus(
    database,
    adminIdentity,
    { expectedContentVersion: currentOwnerWorkspace.entity.contentVersion },
    NOW + 8,
  );
  assert.equal((await getPublicSiteContext(database)).legalFooter, null);
});

test("legal revocation is bound to the exact live workflow version and leaves no residue after a concurrent draft save", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  let workspace = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "legal_status",
    "legal_status",
  );
  workspace = await saveCmsEntityDraft(
    database,
    adminIdentity,
    "legal_status",
    "legal_status",
    {
      expectedContentVersion: workspace.entity.contentVersion,
      snapshot: legalSnapshot("Synthetic legal wording for a revoke race"),
    },
    NOW,
  );
  await confirmCmsLegalStatus(
    database,
    ownerIdentity,
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 1,
  );
  workspace = await publishCmsEntity(
    database,
    ownerIdentity,
    "legal_status",
    "legal_status",
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 2,
  );
  const publishedRevisionId = workspace.entity.publishedRevisionId;
  const beforeRevocations = scalar(
    database,
    `SELECT count(*)
     FROM legal_status_confirmation_receipts
     WHERE action = 'revoked'`,
  );
  const beforeAudits = scalar(
    database,
    `SELECT count(*)
     FROM audit_logs
     WHERE action = 'cms.legal_status_revoked'`,
  );
  const originalBatch = database.batch.bind(database);
  let intercepted = false;
  database.batch = async (statements) => {
    if (!intercepted) {
      intercepted = true;
      database.batch = originalBatch;
      await saveCmsEntityDraft(
        database,
        adminIdentity,
        "legal_status",
        "legal_status",
        {
          expectedContentVersion: workspace.entity.contentVersion,
          snapshot: legalSnapshot("Concurrent unconfirmed legal draft"),
        },
        NOW + 3,
      );
    }
    return originalBatch(statements);
  };
  try {
    await assert.rejects(
      revokeCmsLegalStatus(
        database,
        ownerIdentity,
        { expectedContentVersion: workspace.entity.contentVersion },
        NOW + 4,
      ),
      (error) => error?.status === 409,
    );
  } finally {
    database.batch = originalBatch;
  }
  assert.equal(intercepted, true);
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM legal_status_confirmation_receipts
       WHERE action = 'revoked'`,
    ),
    beforeRevocations,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM audit_logs
       WHERE action = 'cms.legal_status_revoked'`,
    ),
    beforeAudits,
  );
  const afterRace = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "legal_status",
    "legal_status",
  );
  assert.equal(afterRace.entity.workflowStatus, "published");
  assert.equal(afterRace.entity.publishedRevisionId, publishedRevisionId);
  assert.equal(
    scalar(
      database,
      `SELECT is_public FROM site_settings
       WHERE organization_id = 'org-main'
         AND key = 'public_legal_status'`,
    ),
    1,
  );

  const revoked = await revokeCmsLegalStatus(
    database,
    ownerIdentity,
    { expectedContentVersion: afterRace.entity.contentVersion },
    NOW + 5,
  );
  assert.equal(revoked.entity.workflowStatus, "unpublished");
  assert.equal(
    revoked.entity.contentVersion,
    afterRace.entity.contentVersion + 1,
  );
});

test("draft and published media usages are revision-bound and public materialization excludes private media metadata", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedApprovedMedia(database);
  await listCmsEntities(database, ownerIdentity);
  const phase6ViolationCounts = PHASE6_INVARIANT_COUNT_SQL.map((sql) =>
    Number(database.sqlite.prepare(sql).get()?.violation_count ?? 0),
  );
  const expectedPreReadinessCounts =
    PHASE6_INVARIANT_COUNT_SQL.map(() => 0);
  // The semantic receipt predicates may be decomposed into more bounded D1
  // probes over time. Attribution remains the third-from-last Phase 6 family
  // and taxonomy remains the terminal family, so do not pin a stale absolute
  // index when the earlier receipt group count changes.
  expectedPreReadinessCounts[
    PHASE6_INVARIANT_COUNT_SQL.length - 3
  ] = 1;
  expectedPreReadinessCounts[
    PHASE6_INVARIANT_COUNT_SQL.length - 1
  ] = 2;
  assert.deepEqual(
    phase6ViolationCounts,
    expectedPreReadinessCounts,
    "the fixture begins with one legacy public-consent profile and two legacy taxonomy rows awaiting bounded adoption",
  );
  const readinessStatuses = await ensureRuntimeInvariantReadiness(database);
  assert.equal(readinessStatuses.at(-1), "ready");
  assert.deepEqual(
    PHASE6_INVARIANT_COUNT_SQL.map((sql) =>
      Number(database.sqlite.prepare(sql).get()?.violation_count ?? 0),
    ),
    PHASE6_INVARIANT_COUNT_SQL.map(() => 0),
    "the final ready request observes every Phase 6 violation count at zero",
  );
  let workspace = await createCmsEntityDraft(
    database,
    ownerIdentity,
    "page",
    {
      snapshot: pageSnapshot({
        blocks: [
          {
            id: "art",
            type: "media",
            config: {
              assetId: "asset-approved",
              caption: "Public caption.",
              heading: "Artwork",
            },
          },
        ],
        openGraphAssetId: "asset-approved",
        slug: "resources",
      }),
    },
    NOW,
  );
  assert.equal(
    activeUsageCount(database, workspace.revision.id, "draft"),
    2,
  );
  workspace = await publishCmsEntity(
    database,
    ownerIdentity,
    "page",
    workspace.entity.entityKey,
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 1,
  );
  assert.equal(
    activeUsageCount(database, workspace.revision.id, "published"),
    2,
  );
  const serialized = JSON.stringify(
    await getPublicPageContent(database, "resources"),
  );
  assert.match(serialized, /asset-approved/u);
  assert.doesNotMatch(
    serialized,
    /Approved public artwork|original\.png|private rights|private consent|object-key|profile-owner/u,
  );
  let renderedMedia = await resolveMediaAssetsForRendering(database, {
    organizationId: "org-main",
    publicationScope: "published",
    usages: [
      {
        assetId: "asset-approved",
        entityKey: "resources",
        entityType: "page",
        usageKind: "block:art",
      },
      {
        assetId: "asset-approved",
        entityKey: "resources",
        entityType: "page",
        usageKind: "open_graph",
      },
    ],
  });
  assert.equal(
    renderedMedia[0]?.altText,
    "Approved public artwork.",
  );
  database.exec(
    `UPDATE media_assets
     SET alt_text = 'Current approved artwork description.',
         updated_at = ${NOW + 2}
     WHERE id = 'asset-approved'
       AND organization_id = 'org-main';
     UPDATE media_asset_details
     SET caption = 'Current asset caption.',
         updated_at = ${NOW + 2}
     WHERE asset_id = 'asset-approved'
       AND organization_id = 'org-main'`,
  );
  renderedMedia = await resolveMediaAssetsForRendering(database, {
    organizationId: "org-main",
    publicationScope: "published",
    usages: [
      {
        assetId: "asset-approved",
        entityKey: "resources",
        entityType: "page",
        usageKind: "block:art",
      },
      {
        assetId: "asset-approved",
        entityKey: "resources",
        entityType: "page",
        usageKind: "open_graph",
      },
    ],
  });
  assert.equal(
    renderedMedia[0]?.altText,
    "Current approved artwork description.",
  );
  assert.equal(renderedMedia[0]?.caption, "Current asset caption.");

  const exactBlockUsageId = database.sqlite
    .prepare(
      `SELECT id
       FROM media_usage_references
       WHERE organization_id = 'org-main'
         AND asset_id = 'asset-approved'
         AND entity_type = 'page'
         AND entity_id = ?
         AND revision_id = ?
         AND usage_kind = 'block:art'
         AND publication_scope = 'published'
         AND deleted_at IS NULL`,
    )
    .get(workspace.entity.entityKey, workspace.revision.id)?.id;
  assert.equal(typeof exactBlockUsageId, "string");
  database
    .prepare(
      `UPDATE media_usage_references
       SET deleted_at = ?
       WHERE id = ?
         AND deleted_at IS NULL`,
    )
    .bind(NOW + 3, exactBlockUsageId)
    .runSynchronously();
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM database_invariant_state
       WHERE singleton_key = 'database-guards'`,
    ),
    0,
    "retiring an exact current published usage must invalidate readiness",
  );
  assert.deepEqual(
    await resolveMediaAssetsForRendering(database, {
      organizationId: "org-main",
      publicationScope: "published",
      usages: [
        {
          assetId: "asset-approved",
          entityKey: "resources",
          entityType: "page",
          usageKind: "block:art",
        },
      ],
    }),
    [],
    "a same-asset Open Graph usage must not authorize the retired block slot",
  );
  assert.equal(
    (
      await resolveMediaAssetsForRendering(database, {
        organizationId: "org-main",
        publicationScope: "published",
        usages: [
          {
            assetId: "asset-approved",
            entityKey: "resources",
            entityType: "page",
            usageKind: "open_graph",
          },
        ],
      })
    )[0]?.assetId,
    "asset-approved",
    "the still-current exact Open Graph usage remains independently valid",
  );
  await assert.rejects(
    () => ensureDatabaseInvariants(database),
    /Database integrity guards are unavailable/u,
  );
  database
    .prepare(
      `INSERT INTO media_usage_references (
         id, organization_id, asset_id, entity_type, entity_id, revision_id,
         usage_kind, publication_scope, created_by_profile_id, created_at
       ) VALUES (?, 'org-main', 'asset-approved', 'page', ?, ?,
                 'block:art', 'published', 'profile-owner', ?)`,
    )
    .bind(
      "usage-resources-art-repaired",
      workspace.entity.entityKey,
      workspace.revision.id,
      NOW + 4,
    )
    .runSynchronously();
  await ensureRuntimeInvariantReadiness(database);
  assert.equal(
    (
      await resolveMediaAssetsForRendering(database, {
        organizationId: "org-main",
        publicationScope: "published",
        usages: [
          {
            assetId: "asset-approved",
            entityKey: "resources",
            entityType: "page",
            usageKind: "block:art",
          },
        ],
      })
    )[0]?.assetId,
    "asset-approved",
  );

  const storedSection = database.sqlite
    .prepare(
      `SELECT content_json
       FROM page_sections
       WHERE page_id = ?
         AND section_key = 'art'
         AND deleted_at IS NULL`,
    )
    .get(workspace.entity.entityKey);
  assert.deepEqual(JSON.parse(storedSection.content_json), {
    assetId: "asset-approved",
    caption: "Public caption.",
    heading: "Artwork",
  });
  assert.equal(
    database.sqlite
      .prepare(
        `SELECT og_media_asset_id
         FROM page_public_metadata
         WHERE page_id = ?`,
      )
      .get(workspace.entity.entityKey).og_media_asset_id,
    "asset-approved",
  );
  workspace = await unpublishCmsEntity(
    database,
    ownerIdentity,
    "page",
    workspace.entity.entityKey,
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 2,
  );
  assert.equal(activeUsageCount(database, workspace.revision.id, "published"), 0);
});

test("maximum 24-block page publish stays inside the D1 50-statement request and batch limits", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedApprovedMedia(database);
  await listCmsEntities(database, ownerIdentity);
  const workspace = await createCmsEntityDraft(
    database,
    ownerIdentity,
    "page",
    {
      snapshot: pageSnapshot({
        blocks: Array.from({ length: 24 }, (_, index) => ({
          id: `art-${index + 1}`,
          type: "media",
          config: {
            assetId: "asset-approved",
            caption: `Public caption ${index + 1}.`,
            heading: `Artwork ${index + 1}`,
          },
        })),
        openGraphAssetId: "asset-approved",
        slug: "resources",
      }),
    },
    NOW,
  );
  await ensureRuntimeInvariantReadiness(database);
  const counter = countedDatabase(database);
  assert.equal(
    await ensureDatabaseInvariants(counter.database),
    "ready",
  );
  assert.deepEqual(
    await runRequestMaintenance(counter.database, {
      method: "POST",
      pathname:
        `/api/organizer/cms/page/${workspace.entity.entityKey}/publish`,
    }),
    { kind: "continue" },
  );
  const published = await publishCmsEntity(
    counter.database,
    ownerIdentity,
    "page",
    workspace.entity.entityKey,
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 1,
  );
  assert.equal(published.entity.workflowStatus, "published");
  assert.equal(
    counter.statementCount,
    27,
    "the maximum CMS page publish statement budget drifted",
  );
  assert.ok(
    counter.statementCount <= 50,
    `max page publish used ${counter.statementCount} D1 statements`,
  );
  assert.ok(
    counter.batchLengths.every((length) => length <= 50),
    `max page publish used oversized batches: ${counter.batchLengths.join(", ")}`,
  );
  assert.ok(
    counter.bindingCounts.every((count) => count <= 99),
    `max page publish exceeded the D1 bind limit: ${counter.bindingCounts.join(", ")}`,
  );
  assert.ok(
    counter.maxBindingCount <= 99,
    `max page publish used ${counter.maxBindingCount} binds in one statement`,
  );
  assert.equal(
    activeUsageCount(database, published.revision.id, "published"),
    25,
  );
  assert.equal(
    database.sqlite
      .prepare(
        `SELECT count(*) AS count
         FROM page_sections
         WHERE page_id = ?
           AND deleted_at IS NULL`,
      )
      .get(workspace.entity.entityKey).count,
    24,
  );
  const publicPage = await getPublicPageContent(database, "resources");
  assert.equal(publicPage.sections.length, 24);
  assert.equal(publicPage.sections[0].content.heading, "Artwork 1");
  assert.equal(publicPage.sections[23].content.heading, "Artwork 24");
});

test("maximum mixed 24-block public request stays below the Worker D1 statement cap", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedApprovedMedia(database);
  await listCmsEntities(database, ownerIdentity);
  let identity = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "site_identity",
    "site_identity",
  );
  identity = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "site_identity",
    "site_identity",
    {
      expectedContentVersion: identity.entity.contentVersion,
      snapshot: {
        ...identity.revision.snapshot,
        logoAssetId: "asset-approved",
        openGraphAssetId: "asset-approved",
      },
    },
    NOW - 2,
  );
  await publishCmsEntity(
    database,
    ownerIdentity,
    "site_identity",
    "site_identity",
    { expectedContentVersion: identity.entity.contentVersion },
    NOW - 1,
  );
  const blocks = Array.from({ length: 24 }, (_, index) => {
    const number = index + 1;
    switch (index % 4) {
      case 0:
        return {
          id: `media-${number}`,
          type: "media",
          config: {
            assetId: "asset-approved",
            caption: `Public caption ${number}.`,
            heading: `Artwork ${number}`,
          },
        };
      case 1:
        return {
          id: `clubs-${number}`,
          type: "featured_clubs",
          config: {
            heading: `Featured clubs ${number}`,
            ids: ["club-main"],
            limit: 1,
          },
        };
      case 2:
        return {
          id: `community-${number}`,
          type: "community_links",
          config: {
            heading: `Community links ${number}`,
            ids: ["community-one"],
            limit: 1,
          },
        };
      default:
        return {
          id: `events-${number}`,
          type: "featured_events",
          config: {
            heading: `Upcoming events ${number}`,
            ids: [],
            limit: 6,
          },
        };
    }
  });
  const workspace = await createCmsEntityDraft(
    database,
    ownerIdentity,
    "page",
    {
      snapshot: pageSnapshot({
        blocks,
        openGraphAssetId: "asset-approved",
        slug: "resources",
      }),
    },
    NOW,
  );
  await publishCmsEntity(
    database,
    ownerIdentity,
    "page",
    workspace.entity.entityKey,
    { expectedContentVersion: workspace.entity.contentVersion },
    NOW + 1,
  );
  await ensureRuntimeInvariantReadiness(database);

  const counter = countedDatabase(database);
  assert.equal(
    await ensureDatabaseInvariants(counter.database),
    "ready",
  );
  assert.deepEqual(
    await runRequestMaintenance(counter.database, {
      method: "GET",
      pathname: "/resources",
    }),
    { kind: "continue" },
  );
  const catalog = await loadPublicCatalog(counter.database);
  assert.ok(catalog);
  const shellOrganization = await resolvePublicOrganization(counter.database);
  assert.ok(shellOrganization);
  const shellLogo = await resolveMediaAssetsForRendering(counter.database, {
    organizationId: shellOrganization.id,
    publicationScope: "published",
    usages: [
      {
        assetId: catalog.site.logoAssetId,
        entityKey: shellOrganization.id,
        entityType: "site_logo",
        usageKind: "logo",
      },
    ],
  });
  assert.equal(shellLogo[0]?.assetId, "asset-approved");
  const [rootMetadataSite, rootMetadataOrganization] = await Promise.all([
    getPublicSiteContext(counter.database),
    resolvePublicOrganization(counter.database),
  ]);
  assert.ok(rootMetadataSite);
  assert.ok(rootMetadataOrganization);
  const rootSocialMedia = await resolveMediaAssetsForRendering(
    counter.database,
    {
      organizationId: rootMetadataOrganization.id,
      publicationScope: "published",
      usages: [
        {
          assetId: rootMetadataSite.openGraphAssetId,
          entityKey: rootMetadataOrganization.id,
          entityType: "site_og",
          usageKind: "open_graph",
        },
      ],
    },
  );
  assert.equal(rootSocialMedia[0]?.assetId, "asset-approved");
  const metadataPage = await getPublicPageContent(
    counter.database,
    "resources",
  );
  assert.ok(metadataPage);
  const pageMetadataSite = await getPublicSiteContext(counter.database);
  assert.ok(pageMetadataSite);
  const pageMetadataOrganization =
    await resolvePublicOrganization(counter.database);
  assert.ok(pageMetadataOrganization);
  const pageSocialMedia = await resolveMediaAssetsForRendering(
    counter.database,
    {
      organizationId: pageMetadataOrganization.id,
      publicationScope: "published",
      usages: [
        {
          assetId: metadataPage.openGraphAssetId,
          entityKey: metadataPage.slug,
          entityType: "page",
          usageKind: "open_graph",
        },
        {
          assetId: pageMetadataSite.openGraphAssetId,
          entityKey: pageMetadataOrganization.id,
          entityType: "site_og",
          usageKind: "open_graph",
        },
      ],
    },
  );
  assert.equal(pageSocialMedia[0]?.assetId, "asset-approved");
  const page = await getPublicPageContent(
    counter.database,
    "resources",
  );
  assert.equal(page.sections.length, 24);
  const organization = await resolvePublicOrganization(counter.database);
  assert.ok(organization);
  const [clubs, communityLinks, events, media] = await Promise.all([
    listPublicClubs(counter.database),
    listPublicCommunityLinks(counter.database),
    getEditorialPublicEvents(counter.database, {
      nowUtcMs: NOW,
      organizationId: organization.id,
      requestedSlugs: page.sections.flatMap(
        (section) => section.content.eventSlugs ?? [],
      ),
      todayDate: "2030-01-01",
    }),
    resolveMediaAssetsForRendering(counter.database, {
      organizationId: organization.id,
      publicationScope: "published",
      usages: page.sections.flatMap((section) =>
        section.content.assetId
          ? [
              {
                assetId: section.content.assetId,
                entityKey: page.slug,
                entityType: "page",
                usageKind: `block:${section.key}`,
              },
            ]
          : [],
      ),
    }),
  ]);
  assert.equal(clubs.length, 1);
  assert.equal(communityLinks.length, 3);
  assert.equal(events.defaultUpcoming.length, 0);
  assert.equal(media.length, 1);
  assert.equal(
    counter.statementCount,
    22,
    "the full maximum-block public request statement budget drifted",
  );
  assert.ok(counter.statementCount < 50);
});

test("private clubs gain guarded public-profile drafts, deterministic published order, archive history, and safe deletion", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await listCmsEntities(database, ownerIdentity);
  seedApprovedMedia(database);
  setD1Now(database, NOW);
  database.exec(`
    INSERT INTO organizer_conflict_policies (
      id, organization_id, mode, policy_version, default_hold_hours,
      nearing_expiry_hours, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'phase4-policy-org-main', 'org-main', 'warn_reason', 1, 72, 24,
      'profile-owner', 1, 1
    );
  `);

  const firstSnapshot = clubProfileSnapshot({
    displayOrder: 10,
    name: "Private Curiosity Program",
    slug: "private-curiosity-program",
  });
  const secondSnapshot = clubProfileSnapshot({
    coverAssetId: "asset-approved",
    description:
      "Archived public reference for archived-club-contact@example.test.",
    displayOrder: 20,
    name: "Private Reading Circle",
    openGraphAssetId: "asset-approved",
    slug: "private-reading-circle",
    summary:
      "Archived public reference for archived-club-contact@example.test.",
    thumbnailAssetId: "asset-approved",
  });
  const incompleteFirstSnapshot = {
    ...firstSnapshot,
    contentConfirmed: false,
    description: "",
    metaDescription: "",
    summary: "",
  };
  await assert.rejects(
    createCmsEntityDraft(
      database,
      organizerIdentity,
      "club_public_profile",
      { entityKey: "club-private", snapshot: incompleteFirstSnapshot },
      NOW,
    ),
    (error) => error?.status === 403,
  );
  await assert.rejects(
    createCmsEntityDraft(
      database,
      ownerIdentity,
      "club_public_profile",
      { entityKey: "club-other", snapshot: incompleteFirstSnapshot },
      NOW,
    ),
    (error) => error?.status === 404,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM club_public_profiles
       WHERE club_id IN ('club-private', 'club-private-two')`,
    ),
    0,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM club_public_profiles
       WHERE organization_id = 'org-other'`,
    ),
    0,
    "a crafted cross-organization key leaves the other workspace untouched",
  );

  let first = await createCmsEntityDraft(
    database,
    ownerIdentity,
    "club_public_profile",
    { entityKey: "club-private", snapshot: incompleteFirstSnapshot },
    NOW + 1,
  );
  let second = await createCmsEntityDraft(
    database,
    adminIdentity,
    "club_public_profile",
    { entityKey: "club-private-two", snapshot: secondSnapshot },
    NOW + 2,
  );
  assert.equal(first.entity.workflowStatus, "draft");
  assert.equal(first.entity.entityKey, "club-private");
  assert.equal(first.revision.snapshot.contentConfirmed, false);
  assert.equal(first.permissions.canPublish, false);
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM club_public_profiles
       WHERE club_id = 'club-private'
         AND organization_id = 'org-main'
         AND publication_status = 'draft'
         AND published_at IS NULL`,
    ),
    1,
  );
  assert.equal(
    await getPublicClubBySlug(database, "private-curiosity-program"),
    null,
  );
  const incompleteStateBefore = row(
    database,
    `SELECT content_version, workflow_status, published_revision_id
     FROM cms_entity_publication_states
     WHERE organization_id = 'org-main'
       AND entity_type = 'club_public_profile'
       AND entity_key = 'club-private'`,
  );
  const incompleteAuditBefore = scalar(
    database,
    "SELECT count(*) FROM audit_logs",
  );
  await assert.rejects(
    publishCmsEntity(
      database,
      ownerIdentity,
      "club_public_profile",
      "club-private",
      { expectedContentVersion: first.entity.contentVersion },
      NOW + 3,
    ),
    (error) =>
      error?.issues?.some(
        ({ code }) => code === "public_content_unconfirmed",
      ) === true,
  );
  assert.deepEqual(
    row(
      database,
      `SELECT content_version, workflow_status, published_revision_id
       FROM cms_entity_publication_states
       WHERE organization_id = 'org-main'
         AND entity_type = 'club_public_profile'
         AND entity_key = 'club-private'`,
    ),
    incompleteStateBefore,
  );
  assert.equal(
    scalar(database, "SELECT count(*) FROM audit_logs"),
    incompleteAuditBefore,
  );
  first = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "club_public_profile",
    "club-private",
    {
      expectedContentVersion: first.entity.contentVersion,
      snapshot: firstSnapshot,
    },
    NOW + 4,
  );
  assert.equal(first.permissions.canPublish, true);

  let main = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "club_public_profile",
    "club-main",
  );
  main = await saveCmsEntityDraft(
    database,
    ownerIdentity,
    "club_public_profile",
    "club-main",
    {
      expectedContentVersion: main.entity.contentVersion,
      snapshot: {
        ...main.revision.snapshot,
        displayOrder: 20,
        featured: false,
      },
    },
    NOW + 5,
  );
  await publishCmsEntity(
    database,
    ownerIdentity,
    "club_public_profile",
    "club-main",
    { expectedContentVersion: main.entity.contentVersion },
    NOW + 6,
  );
  first = await publishCmsEntity(
    database,
    ownerIdentity,
    "club_public_profile",
    "club-private",
    { expectedContentVersion: first.entity.contentVersion },
    NOW + 7,
  );
  second = await publishCmsEntity(
    database,
    adminIdentity,
    "club_public_profile",
    "club-private-two",
    { expectedContentVersion: second.entity.contentVersion },
    NOW + 8,
  );
  assert.deepEqual(
    (await listPublicClubs(database)).map((club) => club.slug),
    [
      "private-curiosity-program",
      "private-reading-circle",
      "vancouver-curiosity-club",
    ],
  );

  second = await saveCmsEntityDraft(
    database,
    adminIdentity,
    "club_public_profile",
    "club-private-two",
    {
      expectedContentVersion: second.entity.contentVersion,
      snapshot: {
        ...second.revision.snapshot,
        displayOrder: 5,
        slug: "private-reading-circle-history",
      },
    },
    NOW + 9,
  );
  assert.deepEqual(
    (await listPublicClubs(database)).map((club) => club.slug),
    [
      "private-curiosity-program",
      "private-reading-circle",
      "vancouver-curiosity-club",
    ],
    "a private reorder must not change the published directory",
  );
  second = await publishCmsEntity(
    database,
    adminIdentity,
    "club_public_profile",
    "club-private-two",
    { expectedContentVersion: second.entity.contentVersion },
    NOW + 10,
  );
  assert.deepEqual(
    (await listPublicClubs(database)).map((club) => club.slug),
    [
      "private-reading-circle-history",
      "private-curiosity-program",
      "vancouver-curiosity-club",
    ],
  );
  assert.equal(
    await getPublicSlugRedirect(database, {
      entityType: "club_public_profile",
      fromSlug: "private-reading-circle",
    }),
    "private-reading-circle-history",
  );

  const secondPublishedRevisionId = second.entity.publishedRevisionId;
  assert.equal(typeof secondPublishedRevisionId, "string");
  const secondRevisionCountBeforeArchive = scalar(
    database,
    `SELECT count(*)
     FROM cms_entity_revisions
     WHERE organization_id = 'org-main'
       AND entity_type = 'club_public_profile'
       AND entity_key = 'club-private-two'`,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM media_usage_references
       WHERE organization_id = 'org-main'
         AND entity_type = 'club_public_profile'
         AND entity_id = 'club-private-two'
         AND publication_scope = 'draft'
         AND deleted_at IS NULL`,
    ),
    3,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM media_usage_references
       WHERE organization_id = 'org-main'
         AND entity_type = 'club_public_profile'
         AND entity_id = 'club-private-two'
         AND publication_scope = 'published'
         AND deleted_at IS NULL`,
    ),
    3,
  );

  await ensureRuntimeInvariantReadiness(database);
  const futureEvent = await createPublishedClubEvent(
    database,
    "club-private",
  );
  const failedArchiveStateBefore = row(
    database,
    `SELECT workflow_status, content_version, current_draft_revision_id,
            published_revision_id
     FROM cms_entity_publication_states
     WHERE organization_id = 'org-main'
       AND entity_type = 'club_public_profile'
       AND entity_key = 'club-private'`,
  );
  const failedArchiveProfileBefore = row(
    database,
    `SELECT publication_status, is_featured, published_at, updated_at
     FROM club_public_profiles
     WHERE organization_id = 'org-main'
       AND club_id = 'club-private'`,
  );
  const failedArchiveAuditBefore = scalar(
    database,
    `SELECT count(*)
     FROM audit_logs
     WHERE action = 'cms.club_profile_archived'
       AND entity_id = 'club-private'`,
  );
  await assert.rejects(
    archiveCmsClubProfile(
      database,
      ownerIdentity,
      "club-private",
      { expectedContentVersion: first.entity.contentVersion },
      NOW + 11,
    ),
    (error) => error?.status === 409,
  );
  assert.deepEqual(
    row(
      database,
      `SELECT workflow_status, content_version, current_draft_revision_id,
              published_revision_id
       FROM cms_entity_publication_states
       WHERE organization_id = 'org-main'
         AND entity_type = 'club_public_profile'
         AND entity_key = 'club-private'`,
    ),
    failedArchiveStateBefore,
  );
  assert.deepEqual(
    row(
      database,
      `SELECT publication_status, is_featured, published_at, updated_at
       FROM club_public_profiles
       WHERE organization_id = 'org-main'
         AND club_id = 'club-private'`,
    ),
    failedArchiveProfileBefore,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM audit_logs
       WHERE action = 'cms.club_profile_archived'
         AND entity_id = 'club-private'`,
    ),
    failedArchiveAuditBefore,
  );

  const completedNow = Date.parse("2033-01-01T08:00:00.000Z");
  setD1Now(database, completedNow);
  await performOrganizerLifecycleAction(
    database,
    ownerIdentity,
    futureEvent.id,
    {
      action: "complete",
      expectedContentVersion: futureEvent.contentVersion,
      expectedScheduleVersion: futureEvent.scheduleVersion,
    },
  );
  const completedEvent = await getOrganizerEvent(
    database,
    ownerIdentity,
    futureEvent.id,
  );
  assert.equal(completedEvent.planningStatus, "completed");
  assert.equal(completedEvent.publicationStatus, "published");

  first = await archiveCmsClubProfile(
    database,
    ownerIdentity,
    "club-private",
    { expectedContentVersion: first.entity.contentVersion },
    completedNow + 1,
  );
  second = await archiveCmsClubProfile(
    database,
    adminIdentity,
    "club-private-two",
    { expectedContentVersion: second.entity.contentVersion },
    completedNow + 2,
  );
  assert.equal(first.entity.workflowStatus, "archived");
  assert.equal(first.permissions.canEdit, false);
  assert.equal(first.permissions.canPublish, false);
  assert.equal(first.permissions.canRestore, false);
  assert.equal(first.permissions.canArchive, false);
  assert.deepEqual(
    (await listPublicClubs(database)).map((club) => club.slug),
    ["vancouver-curiosity-club"],
  );
  const archivedClub = await getPublicClubBySlug(
    database,
    "private-curiosity-program",
  );
  assert.equal(archivedClub?.archived, true);
  assert.equal(
    (
      await getPublicClubBySlug(
        database,
        "private-reading-circle-history",
      )
    )?.archived,
    true,
  );
  const pastEvents = await queryPublicEvents(database, {
    clubSlug: "private-curiosity-program",
    nowUtcMs: completedNow,
    organizationId: "org-main",
    page: 1,
    pageSize: 20,
    todayDate: "2033-01-01",
    view: "past",
  });
  assert.deepEqual(
    pastEvents.events.map((event) => event.slug),
    [completedEvent.slug],
  );
  const upcomingEvents = await queryPublicEvents(database, {
    clubSlug: "private-curiosity-program",
    nowUtcMs: completedNow,
    organizationId: "org-main",
    page: 1,
    pageSize: 20,
    todayDate: "2033-01-01",
    view: "upcoming",
  });
  assert.equal(upcomingEvents.totalCount, 0);
  assert.equal(
    (
      await getPublicEventBySlug(database, {
        organizationId: "org-main",
        slug: completedEvent.slug,
      })
    )?.status,
    "completed",
  );
  assert.equal(
    await getPublicSlugRedirect(database, {
      entityType: "club_public_profile",
      fromSlug: "private-reading-circle",
    }),
    null,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM media_usage_references
       WHERE organization_id = 'org-main'
         AND entity_type = 'club_public_profile'
         AND entity_id = 'club-private-two'
         AND deleted_at IS NULL`,
    ),
    3,
    "archive retires the draft usages and retains the exact published revision usages",
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM media_usage_references
       WHERE organization_id = 'org-main'
         AND entity_type = 'club_public_profile'
         AND entity_id = 'club-private-two'
         AND publication_scope = 'draft'
         AND deleted_at IS NULL`,
    ),
    0,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM media_usage_references
       WHERE organization_id = 'org-main'
         AND entity_type = 'club_public_profile'
         AND entity_id = 'club-private-two'
         AND publication_scope = 'published'
         AND revision_id = ?
         AND deleted_at IS NULL`,
      secondPublishedRevisionId,
    ),
    3,
  );
  const archivedMediaPreview = await readCmsRevisionPreview(
    database,
    ownerIdentity,
    secondPublishedRevisionId,
  );
  assert.equal(archivedMediaPreview.mediaAssets[0]?.assetId, "asset-approved");
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM cms_entity_revisions
       WHERE organization_id = 'org-main'
         AND entity_type = 'club_public_profile'
         AND entity_key = 'club-private-two'`,
    ),
    secondRevisionCountBeforeArchive,
  );
  await assert.rejects(
    saveCmsEntityDraft(
      database,
      ownerIdentity,
      "club_public_profile",
      "club-private",
      {
        expectedContentVersion: first.entity.contentVersion,
        snapshot: first.revision.snapshot,
      },
      completedNow + 3,
    ),
    (error) => error?.status === 409,
  );

  const phase6ViolationCounts = PHASE6_INVARIANT_COUNT_SQL.map((sql) =>
    Number(database.sqlite.prepare(sql).get()?.violation_count ?? 0),
  );
  assert.deepEqual(
    phase6ViolationCounts,
    phase6ViolationCounts.map(() => 0),
    "archiving a public profile must preserve every Phase 6 global invariant",
  );
  await ensureRuntimeInvariantReadiness(database);
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name,
      public_attribution_consent, status, created_at, updated_at
    ) VALUES (
      'profile-inverse-email', 'subject-inverse-email',
      'unrelated-member@example.test', 'Inverse lifecycle member',
      0, 'active', ${completedNow + 6}, ${completedNow + 6}
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership-inverse-email', 'org-main', 'profile-inverse-email',
      'unrelated-member@example.test', 'organizer', 'suspended',
      'profile-owner', ${completedNow + 6}, ${completedNow + 6}
    );
    UPDATE organization_memberships
    SET status = 'active', updated_at = ${completedNow + 7}
    WHERE id = 'membership-inverse-email';
  `);
  assert.throws(
    () =>
      database.exec(`
        UPDATE organization_memberships
        SET status = 'suspended', updated_at = ${completedNow + 8}
        WHERE id = 'membership-inverse-email';
        UPDATE organization_memberships
        SET normalized_email = 'archived-club-contact@example.test',
            status = 'active',
            updated_at = ${completedNow + 9}
        WHERE id = 'membership-inverse-email';
      `),
    /phase6_public_organizer_email_forbidden/u,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE profiles
        SET normalized_email = 'archived-club-contact@example.test',
            updated_at = ${completedNow + 10}
        WHERE id = 'profile-inverse-email';
      `),
    /phase6_public_organizer_email_forbidden/u,
  );
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name,
      public_attribution_consent, status, created_at, updated_at
    ) VALUES (
      'profile-inverse-add', 'subject-inverse-add',
      'different-unrelated@example.test', 'Inverse add member',
      0, 'active', ${completedNow + 11}, ${completedNow + 11}
    );
  `);
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO organization_memberships (
          id, organization_id, profile_id, normalized_email, role, status,
          created_by_profile_id, created_at, updated_at
        ) VALUES (
          'membership-inverse-add', 'org-main', 'profile-inverse-add',
          'archived-club-contact@example.test', 'organizer', 'active',
          'profile-owner', ${completedNow + 11}, ${completedNow + 11}
        );
      `),
    /phase6_public_organizer_email_forbidden/u,
  );
  const organizerEventCount = scalar(
    database,
    `SELECT count(*) FROM organizer_events`,
  );
  await assert.rejects(
    createOrganizerEvent(database, ownerIdentity, {
      clubId: "club-private",
      coOrganizerProfileIds: [],
      planningStatus: "idea",
      primaryOrganizerProfileId: "profile-owner",
      publicationStatus: "private",
      scheduleShape: "unscheduled",
      timeZone: "America/Vancouver",
      title: "Archived club must reject scheduling",
    }),
    (error) => error?.status === 422 || error?.status === 404,
  );
  assert.equal(
    scalar(database, `SELECT count(*) FROM organizer_events`),
    organizerEventCount,
  );
  await assert.rejects(
    archivePrivateOrganizerClub(
      database,
      ownerIdentity,
      "club-private",
      completedNow + 4,
    ),
    (error) => error?.status === 409 && error?.eventCount === 1,
  );
  assert.deepEqual(
    await archivePrivateOrganizerClub(
      database,
      adminIdentity,
      "club-private-two",
      completedNow + 5,
    ),
    { archived: true },
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM clubs
       WHERE id = 'club-private-two'
         AND deleted_at = ${completedNow + 5}`,
    ),
    1,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM club_public_profiles
         WHERE club_id = 'club-private-two'
         AND publication_status = 'archived'
         AND published_at IS NOT NULL`,
    ),
    1,
    "the inert archived profile remains as the immutable CMS history anchor",
  );
  assert.equal(
    await getPublicClubBySlug(
      database,
      "private-reading-circle-history",
    ),
    null,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*)
       FROM cms_entity_revisions
       WHERE organization_id = 'org-main'
         AND entity_type = 'club_public_profile'
         AND entity_key = 'club-private-two'`,
    ),
    secondRevisionCountBeforeArchive,
  );
  const deletedClubHistoricalPreview = await readCmsRevisionPreview(
    database,
    adminIdentity,
    secondPublishedRevisionId,
  );
  assert.equal(
    deletedClubHistoricalPreview.mediaAssets[0]?.assetId,
    "asset-approved",
  );
  await ensureRuntimeInvariantReadiness(database);
  assert.ok(
    (await listCmsEntities(database, ownerIdentity)).some(
      (entity) =>
        entity.entityType === "club_public_profile" &&
        entity.entityKey === "club-private-two" &&
        entity.workflowStatus === "archived",
    ),
  );
});

test("public Program profiles require an active same-organization parent club without exposing unassigned core Programs", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await listCmsEntities(database, ownerIdentity);

  let program = await createCmsEntityDraft(
    database,
    ownerIdentity,
    "program_public_profile",
    {
      snapshot: programProfileSnapshot({
        name: "Nested Program Contract",
        slug: "nested-program-contract",
      }),
    },
    NOW,
  );
  const programId = program.entity.entityKey;
  await ensureRuntimeInvariantReadiness(database);
  database.exec(`
    UPDATE programs
    SET club_id = NULL, updated_at = ${NOW + 1}
    WHERE id = '${programId}'
      AND organization_id = 'org-main'
  `);

  const privateWorkspace = await readCmsEntityWorkspace(
    database,
    ownerIdentity,
    "program_public_profile",
    programId,
  );
  assert.equal(privateWorkspace.entity.workflowStatus, "draft");
  assert.equal(
    privateWorkspace.revision?.snapshot.name,
    "Nested Program Contract",
  );
  assert.ok(
    (await listCmsEntities(database, ownerIdentity)).some(
      (entity) =>
        entity.entityType === "program_public_profile" &&
        entity.entityKey === programId &&
        entity.workflowStatus === "draft",
    ),
    "the private Program draft and history remain available while unassigned",
  );

  const residueBefore = Object.freeze({
    audit: scalar(
      database,
      `SELECT count(*) FROM audit_logs
       WHERE organization_id = 'org-main'
         AND action = 'cms.entity_published'
         AND entity_id = ?`,
      programId,
    ),
    details: scalar(
      database,
      `SELECT count(*) FROM program_public_profile_details
       WHERE organization_id = 'org-main' AND program_id = ?`,
      programId,
    ),
    receipts: scalar(
      database,
      `SELECT count(*) FROM cms_public_materialization_receipts
       WHERE organization_id = 'org-main'
         AND entity_type = 'program_public_profile'
         AND entity_key = ?`,
      programId,
    ),
    revisions: scalar(
      database,
      `SELECT count(*) FROM cms_entity_revisions
       WHERE organization_id = 'org-main'
         AND entity_type = 'program_public_profile'
         AND entity_key = ?`,
      programId,
    ),
  });
  const assertNoPublicResidue = () => {
    const state = database.sqlite
      .prepare(
        `SELECT workflow_status, content_version, published_revision_id
         FROM cms_entity_publication_states
         WHERE organization_id = 'org-main'
           AND entity_type = 'program_public_profile'
           AND entity_key = ?`,
      )
      .get(programId);
    assert.deepEqual(
      { ...state },
      {
        content_version: program.entity.contentVersion,
        published_revision_id: null,
        workflow_status: "draft",
      },
    );
    assert.equal(
      scalar(
        database,
        `SELECT count(*) FROM audit_logs
         WHERE organization_id = 'org-main'
           AND action = 'cms.entity_published'
           AND entity_id = ?`,
        programId,
      ),
      residueBefore.audit,
    );
    assert.equal(
      scalar(
        database,
        `SELECT count(*) FROM program_public_profile_details
         WHERE organization_id = 'org-main' AND program_id = ?`,
        programId,
      ),
      residueBefore.details,
    );
    assert.equal(
      scalar(
        database,
        `SELECT count(*) FROM cms_public_materialization_receipts
         WHERE organization_id = 'org-main'
           AND entity_type = 'program_public_profile'
           AND entity_key = ?`,
        programId,
      ),
      residueBefore.receipts,
    );
    assert.equal(
      scalar(
        database,
        `SELECT count(*) FROM cms_entity_revisions
         WHERE organization_id = 'org-main'
           AND entity_type = 'program_public_profile'
           AND entity_key = ?`,
        programId,
      ),
      residueBefore.revisions,
    );
  };

  await assert.rejects(
    publishCmsEntity(
      database,
      ownerIdentity,
      "program_public_profile",
      programId,
      { expectedContentVersion: program.entity.contentVersion },
      NOW + 2,
    ),
    (error) => error?.status === 404 && error?.code === "not_found",
  );
  assertNoPublicResidue();
  assert.equal(
    await getPublicProgramBySlugs(
      database,
      "vancouver-curiosity-club",
      "nested-program-contract",
    ),
    null,
  );

  await assert.rejects(
    saveCmsEntityDraft(
      database,
      ownerIdentity,
      "program_public_profile",
      programId,
      {
        expectedContentVersion: program.entity.contentVersion,
        snapshot: programProfileSnapshot({
          clubId: "club-other",
          name: "Nested Program Contract",
          slug: "nested-program-contract",
        }),
      },
      NOW + 3,
    ),
    (error) => error?.status === 404,
  );
  assertNoPublicResidue();

  database.exec(`
    UPDATE clubs
    SET deleted_at = ${NOW + 4}, updated_at = ${NOW + 4}
    WHERE id = 'club-private'
      AND organization_id = 'org-main'
  `);
  await assert.rejects(
    saveCmsEntityDraft(
      database,
      ownerIdentity,
      "program_public_profile",
      programId,
      {
        expectedContentVersion: program.entity.contentVersion,
        snapshot: programProfileSnapshot({
          clubId: "club-private",
          name: "Nested Program Contract",
          slug: "nested-program-contract",
        }),
      },
      NOW + 5,
    ),
    (error) => error?.status === 404,
  );
  assertNoPublicResidue();

  database.exec(`
    UPDATE programs
    SET club_id = 'club-main', updated_at = ${NOW + 6}
    WHERE id = '${programId}'
      AND organization_id = 'org-main'
  `);
  program = await publishCmsEntity(
    database,
    ownerIdentity,
    "program_public_profile",
    programId,
    { expectedContentVersion: program.entity.contentVersion },
    NOW + 7,
  );
  assert.equal(program.entity.workflowStatus, "published");
  assert.equal(
    (
      await getPublicProgramBySlugs(
        database,
        "vancouver-curiosity-club",
        "nested-program-contract",
      )
    )?.name,
    "Nested Program Contract",
  );
  assert.deepEqual(
    PHASE6_INVARIANT_COUNT_SQL.map((sql) =>
      Number(database.sqlite.prepare(sql).get()?.violation_count ?? 0),
    ),
    PHASE6_INVARIANT_COUNT_SQL.map(() => 0),
  );
  await ensureRuntimeInvariantReadiness(database);
});

test("Program profiles retain exact public history on archive and safely delete only never-published unused Programs", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  seedApprovedMedia(database);
  await listCmsEntities(database, ownerIdentity);

  let program = await createCmsEntityDraft(
    database,
    ownerIdentity,
    "program_public_profile",
    {
      snapshot: programProfileSnapshot({
        coverAssetId: "asset-approved",
        description:
          "Confirmed Program history. Future host: future-host@example.test",
        name: "Published Program History",
        openGraphAssetId: "asset-approved",
        relatedResourceIds: ["page-about", "missing-private-resource"],
        slug: "published-program-history",
        thumbnailAssetId: "asset-approved",
      }),
    },
    NOW,
  );
  const programId = program.entity.entityKey;
  program = await publishCmsEntity(
    database,
    ownerIdentity,
    "program_public_profile",
    programId,
    { expectedContentVersion: program.entity.contentVersion },
    NOW + 1,
  );
  const publishedRevisionId = program.entity.publishedRevisionId;
  assert.equal(typeof publishedRevisionId, "string");
  const publicProgram = await getPublicProgramBySlugs(
    database,
    "vancouver-curiosity-club",
    "published-program-history",
  );
  assert.equal(publicProgram?.name, "Published Program History");
  assert.deepEqual(publicProgram?.relatedResources, [
    { label: "About", url: "/about" },
  ]);
  assert.doesNotMatch(
    JSON.stringify(publicProgram),
    /page-about|missing-private-resource|profile-owner/u,
  );
  await ensureRuntimeInvariantReadiness(database);

  const futureEvent = await createPublishedClubEvent(
    database,
    "club-main",
    programId,
  );
  await assert.rejects(
    archiveCmsProgramProfile(
      database,
      ownerIdentity,
      programId,
      { expectedContentVersion: program.entity.contentVersion },
      NOW + 2,
    ),
    (error) => error?.status === 409,
  );

  const completedNow = Date.parse("2033-01-01T08:00:00.000Z");
  setD1Now(database, completedNow);
  await performOrganizerLifecycleAction(
    database,
    ownerIdentity,
    futureEvent.id,
    {
      action: "complete",
      expectedContentVersion: futureEvent.contentVersion,
      expectedScheduleVersion: futureEvent.scheduleVersion,
    },
  );
  const completedEvent = await getOrganizerEvent(
    database,
    ownerIdentity,
    futureEvent.id,
  );
  program = await archiveCmsProgramProfile(
    database,
    adminIdentity,
    programId,
    { expectedContentVersion: program.entity.contentVersion },
    completedNow + 1,
  );
  assert.equal(program.entity.workflowStatus, "archived");
  assert.equal(program.permissions.canDelete, false);
  assert.equal(
    (await listPublicProgramsForClub(
      database,
      "vancouver-curiosity-club",
    )).some((item) => item.slug === "published-program-history"),
    false,
  );
  assert.equal(
    (
      await getPublicProgramBySlugs(
        database,
        "vancouver-curiosity-club",
        "published-program-history",
      )
    )?.archived,
    true,
  );
  assert.deepEqual(
    (
      await queryPublicEvents(database, {
        clubSlug: "vancouver-curiosity-club",
        nowUtcMs: completedNow,
        organizationId: "org-main",
        page: 1,
        pageSize: 20,
        todayDate: "2033-01-01",
        view: "past",
      })
    ).events
      .filter(
        (event) => event.program?.slug === "published-program-history",
      )
      .map((event) => event.slug),
    [completedEvent.slug],
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_usage_references
       WHERE organization_id = 'org-main'
         AND entity_type = 'program_public_profile'
         AND entity_id = ?
         AND publication_scope = 'draft'
         AND deleted_at IS NULL`,
      programId,
    ),
    0,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM media_usage_references
       WHERE organization_id = 'org-main'
         AND entity_type = 'program_public_profile'
         AND entity_id = ?
         AND revision_id = ?
         AND publication_scope = 'published'
         AND deleted_at IS NULL`,
      programId,
      publishedRevisionId,
    ),
    3,
  );

  assert.throws(
    () =>
      database.exec(
        `DELETE FROM program_public_profile_details
         WHERE organization_id = 'org-main'
           AND program_id = '${programId}'`,
    ),
    /phase6_program_details_delete_forbidden/u,
  );
  assert.throws(
    () =>
      database.exec(
        `UPDATE program_public_profile_details
         SET public_display_name = 'Crafted Program tamper'
         WHERE organization_id = 'org-main'
           AND program_id = '${programId}'`,
      ),
    /phase6_program_projection_receipt_required/u,
  );
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name,
      public_attribution_consent, status, created_at, updated_at
    ) VALUES (
      'profile-email-control', 'subject-email-control',
      'unrelated@example.test', 'Email control', 0, 'active',
      ${completedNow + 2}, ${completedNow + 2}
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership-email-control', 'org-main', 'profile-email-control',
      'unrelated@example.test', 'organizer', 'active',
      'profile-owner', ${completedNow + 2}, ${completedNow + 2}
    );
  `);
  assert.throws(
    () =>
      database.exec(`
        UPDATE organization_memberships
        SET normalized_email = 'future-host@example.test'
        WHERE id = 'membership-email-control'
      `),
    /phase6_public_organizer_email_forbidden/u,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE profiles
        SET normalized_email = 'future-host@example.test'
        WHERE id = 'profile-email-control'
      `),
    /phase6_public_organizer_email_forbidden/u,
  );
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name,
      public_attribution_consent, status, created_at, updated_at
    ) VALUES (
      'profile-future-host', 'subject-future-host',
      'future-host@example.test', 'Future host', 0, 'active',
      ${completedNow + 3}, ${completedNow + 3}
    );
  `);
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO organization_memberships (
          id, organization_id, profile_id, normalized_email, role, status,
          created_by_profile_id, created_at, updated_at
        ) VALUES (
          'membership-future-host', 'org-main', 'profile-future-host',
          'future-host@example.test', 'organizer', 'active',
          'profile-owner', ${completedNow + 3}, ${completedNow + 3}
        )
      `),
    /phase6_public_organizer_email_forbidden/u,
  );

  let unusedProgram = await createCmsEntityDraft(
    database,
    ownerIdentity,
    "program_public_profile",
    {
      snapshot: programProfileSnapshot({
        name: "Unused Private Program",
        slug: "unused-private-program",
      }),
    },
    completedNow + 4,
  );
  const unusedProgramId = unusedProgram.entity.entityKey;
  unusedProgram = await archiveCmsProgramProfile(
    database,
    ownerIdentity,
    unusedProgramId,
    { expectedContentVersion: unusedProgram.entity.contentVersion },
    completedNow + 5,
  );
  assert.equal(unusedProgram.permissions.canDelete, true);
  const revisionCount = scalar(
    database,
    `SELECT count(*) FROM cms_entity_revisions
     WHERE organization_id = 'org-main'
       AND entity_type = 'program_public_profile'
       AND entity_key = ?`,
    unusedProgramId,
  );
  assert.deepEqual(
    await safeDeleteCmsProgramProfile(
      database,
      adminIdentity,
      unusedProgramId,
      { expectedContentVersion: unusedProgram.entity.contentVersion },
      completedNow + 6,
    ),
    { deleted: true },
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM programs
       WHERE id = ? AND organization_id = 'org-main'
         AND deleted_at = ?`,
      unusedProgramId,
      completedNow + 6,
    ),
    1,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM program_public_profile_details
       WHERE program_id = ? AND organization_id = 'org-main'
         AND deleted_at = ?`,
      unusedProgramId,
      completedNow + 6,
    ),
    1,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM cms_entity_revisions
       WHERE organization_id = 'org-main'
         AND entity_type = 'program_public_profile'
         AND entity_key = ?`,
      unusedProgramId,
    ),
    revisionCount,
  );
  assert.equal(
    scalar(
      database,
      `SELECT count(*) FROM audit_logs
       WHERE organization_id = 'org-main'
         AND action = 'cms.program_profile_deleted'
         AND entity_id = ?`,
      unusedProgramId,
    ),
    1,
  );
  assert.deepEqual(
    PHASE6_INVARIANT_COUNT_SQL.map((sql) =>
      Number(database.sqlite.prepare(sql).get()?.violation_count ?? 0),
    ),
    PHASE6_INVARIANT_COUNT_SQL.map(() => 0),
  );
  await ensureRuntimeInvariantReadiness(database);
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
      ('profile-admin', 'subject-admin', 'admin@example.test', 'Administrator', 0, 'active', 1, 1),
      ('profile-organizer', 'subject-organizer', 'organizer@example.test', 'Organizer', 0, 'active', 1, 1),
      ('profile-suspended', 'subject-suspended', 'suspended@example.test', 'Suspended', 0, 'active', 1, 1),
      ('profile-other', 'subject-other', 'other@example.test', 'Other owner', 0, 'active', 1, 1);

    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      ('org-main', 'Vancouver Curiosity Club',
       'vancouver-curiosity-and-education-society',
       'America/Vancouver', 1, 'profile-owner', 1, 1),
      ('org-other', 'Other', 'other', 'America/Vancouver', 1,
       'profile-other', 1, 1);

    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      ('membership-owner', 'org-main', 'profile-owner', 'owner@example.test', 'owner', 'active', 'profile-owner', 1, 1),
      ('membership-admin', 'org-main', 'profile-admin', 'admin@example.test', 'administrator', 'active', 'profile-owner', 1, 1),
      ('membership-organizer', 'org-main', 'profile-organizer', 'organizer@example.test', 'organizer', 'active', 'profile-owner', 1, 1),
      ('membership-suspended', 'org-main', 'profile-suspended', 'suspended@example.test', 'administrator', 'suspended', 'profile-owner', 1, 1),
      ('membership-other', 'org-other', 'profile-other', 'other@example.test', 'owner', 'active', 'profile-other', 1, 1);

    INSERT INTO event_lanes (
      id, organization_id, name, slug, sort_order,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'lane-think', 'org-main', 'Think', 'think', 10,
        'profile-owner', 1, 1
      ),
      (
        'lane-other', 'org-other', 'Other', 'other', 10,
        'profile-other', 1, 1
      );

    INSERT INTO clubs (
      id, organization_id, name, slug, description,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'club-main', 'org-main', 'Vancouver Curiosity Club',
        'vancouver-curiosity-club', 'Thoughtful Vancouver events.',
        'profile-owner', 1, 1
      ),
      (
        'club-private', 'org-main', 'Private Curiosity Program',
        'private-curiosity-program', 'Confirmed public information.',
        'profile-owner', 1, 1
      ),
      (
        'club-private-two', 'org-main', 'Private Reading Circle',
        'private-reading-circle', 'Confirmed reading-circle information.',
        'profile-owner', 1, 1
      ),
      (
        'club-other', 'org-other', 'Other Club', 'other-club',
        'Other organization content.', 'profile-other', 1, 1
      );

    INSERT INTO club_public_profiles (
      club_id, organization_id, primary_event_lane_id, publication_status,
      is_featured, description, public_group_url, published_at,
      created_at, updated_at
    ) VALUES (
      'club-main', 'org-main', 'lane-think', 'published', 1,
      'Thoughtful Vancouver events.',
      'https://www.meetup.com/vancouver-meetup-group/',
      1, 1, 1
    );

    INSERT INTO pages (
      id, organization_id, title, slug, status, visibility,
      current_revision, published_at, created_by_profile_id,
      updated_by_profile_id, created_at, updated_at
    ) VALUES
      ('page-about', 'org-main', 'About', 'about', 'published', 'public',
       1, 1, 'profile-owner', 'profile-owner', 1, 1),
      ('page-events', 'org-main', 'Events', 'events', 'published', 'public',
       1, 1, 'profile-owner', 'profile-owner', 1, 1),
      ('page-clubs', 'org-main', 'Clubs', 'clubs', 'published', 'public',
       1, 1, 'profile-owner', 'profile-owner', 1, 1),
      ('page-community', 'org-main', 'Community', 'community', 'published', 'public',
       1, 1, 'profile-owner', 'profile-owner', 1, 1),
      ('page-get-involved', 'org-main', 'Get Involved', 'get-involved', 'published', 'public',
       1, 1, 'profile-owner', 'profile-owner', 1, 1),
      ('page-contact', 'org-main', 'Contact', 'contact', 'published', 'public',
       1, 1, 'profile-owner', 'profile-owner', 1, 1),
      ('page-conduct', 'org-main', 'Code of Conduct', 'conduct', 'published', 'public',
       1, 1, 'profile-owner', 'profile-owner', 1, 1),
      ('page-accessibility', 'org-main', 'Accessibility', 'accessibility', 'published', 'public',
       1, 1, 'profile-owner', 'profile-owner', 1, 1),
      ('page-privacy', 'org-main', 'Privacy', 'privacy', 'published', 'public',
       1, 1, 'profile-owner', 'profile-owner', 1, 1);

    INSERT INTO page_sections (
      id, organization_id, page_id, section_key, section_type,
      content_json, sort_order, created_at, updated_at
    ) VALUES
      (
        'section-about', 'org-main', 'page-about', 'intro', 'intro',
        '{"heading":"About","paragraphs":[],"text":"Existing public copy for curious Vancouver neighbours."}',
        10, 1, 1
      ),
      (
        'section-events', 'org-main', 'page-events', 'intro', 'intro',
        '{"heading":"Events","paragraphs":[],"text":"Browse the genuinely published gatherings on the calendar."}',
        10, 1, 1
      ),
      (
        'section-clubs', 'org-main', 'page-clubs', 'intro', 'intro',
        '{"heading":"Clubs","paragraphs":[],"text":"Different doors into one curious Vancouver community."}',
        10, 1, 1
      ),
      (
        'section-community', 'org-main', 'page-community', 'intro', 'intro',
        '{"heading":"Community","paragraphs":[],"text":"Follow only the confirmed public community destinations."}',
        10, 1, 1
      ),
      (
        'section-get-involved', 'org-main', 'page-get-involved', 'intro', 'intro',
        '{"heading":"Get involved","paragraphs":[],"text":"Attend, volunteer, host, or begin a thoughtful partnership conversation."}',
        10, 1, 1
      ),
      (
        'section-contact', 'org-main', 'page-contact', 'intro', 'intro',
        '{"heading":"Contact","paragraphs":[],"text":"Use one of the confirmed Meetup group destinations to connect."}',
        10, 1, 1
      ),
      (
        'section-conduct', 'org-main', 'page-conduct', 'intro', 'intro',
        '{"heading":"Code of Conduct","paragraphs":[],"text":"Treat people with respect and make room for different ways of participating."}',
        10, 1, 1
      ),
      (
        'section-accessibility', 'org-main', 'page-accessibility', 'intro', 'intro',
        '{"heading":"Accessibility","paragraphs":[],"text":"The website supports keyboard use, clear focus, readable zoom, and reduced motion."}',
        10, 1, 1
      ),
      (
        'section-privacy', 'org-main', 'page-privacy', 'intro', 'intro',
        '{"heading":"Privacy","paragraphs":[],"text":"Public pages can be browsed without an attendee account or public submission form."}',
        10, 1, 1
      );

    INSERT INTO site_settings (
      id, organization_id, key, value_json, is_public,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'public-identity', 'org-main', 'public_identity',
      '{"brandName":"Vancouver Curiosity Club","footerMission":"Existing public mission.","locationLabel":"Vancouver, British Columbia","logoAssetId":null,"metaDescription":"Thoughtful events in good company.","mission":"A community organization for curious people.","openGraphAssetId":null,"palette":{"accent":"#2156D8","background":"#F5F0E6","foreground":"#142C30","secondary":"#0C665E"},"seoTitle":"Vancouver Curiosity Club","tagline":"A social calendar with a brain.","typography":"editorial"}',
      1, 'profile-owner', 1, 1
    );

    INSERT INTO community_links (
      id, organization_id, label, url, link_type, is_published,
      sort_order, created_by_profile_id, created_at, updated_at
    ) VALUES
      ('community-one', 'org-main', 'Vancouver Curiosity Club',
       'https://www.meetup.com/vancouver-meetup-group/',
       'meetup_group', 1, 10, 'profile-owner', 1, 1),
      ('community-two', 'org-main', 'Vancouver Literature and Film',
       'https://www.meetup.com/vancouver-literature-and-film/',
       'meetup_group', 1, 20, 'profile-owner', 1, 1),
      ('community-three', 'org-main', 'Vancouver Fantasy & Sci-Fi Group',
       'https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/',
       'meetup_group', 1, 30, 'profile-owner', 1, 1),
      ('community-unconfirmed', 'org-main', 'Unconfirmed legacy link',
       'https://example.com/unconfirmed',
       'other', 1, 40, 'profile-owner', 1, 1);
  `);
}

function pageSnapshot(overrides = {}) {
  return {
    blocks: overrides.blocks ?? [
      {
        id: "intro",
        type: "intro",
        config: {
          heading: "About",
          paragraphs: [],
          text: overrides.text ?? "Existing public copy.",
        },
      },
    ],
    metaDescription: "A factual page description.",
    openGraphAssetId: overrides.openGraphAssetId ?? null,
    seoTitle: "Page title",
    slug: overrides.slug ?? "about",
    title: overrides.title ?? "About",
  };
}

function communitySnapshot(overrides = {}) {
  return {
    confirmed: overrides.confirmed ?? false,
    description:
      overrides.description ?? "A confirmed external community destination.",
    destinationType: overrides.destinationType ?? "other",
    label: overrides.label ?? "Community destination",
    sortOrder: overrides.sortOrder ?? 40,
    url: overrides.url ?? "https://example.org/community",
  };
}

function clubProfileSnapshot(overrides = {}) {
  const name = overrides.name ?? "Private Club";
  const description =
    overrides.description ?? "Confirmed public information for this club.";
  return {
    contentConfirmed: overrides.contentConfirmed ?? true,
    coverAssetId: overrides.coverAssetId ?? null,
    description,
    displayOrder: overrides.displayOrder ?? 1000,
    featured: overrides.featured ?? false,
    imageAltText: null,
    laneId: "lane-think",
    meetupGroupUrl: null,
    metaDescription: description.slice(0, 160),
    name,
    openGraphAssetId: overrides.openGraphAssetId ?? null,
    preparation: null,
    programType: "club",
    relatedResourceIds: [],
    seoTitle: name.slice(0, 60),
    slug: overrides.slug ?? "private-club",
    socialUrls: [],
    summary: description.slice(0, 500),
    themeColor: "#0C665E",
    thumbnailAssetId: overrides.thumbnailAssetId ?? null,
    typicalFormat: null,
    whatToExpect: null,
  };
}

function legalSnapshot(footerWording) {
  return {
    charityNumber: null,
    charityStatus: "unconfirmed",
    effectiveDate: "2030-01-01",
    footerWording,
    jurisdiction: "British Columbia",
    legalFormWording: "Synthetic incorporated society",
    legalName: "Synthetic Test Organization",
    registrationNumber: "SYNTHETIC-ONLY",
  };
}

function setD1Now(database, milliseconds) {
  database.sqlite.function(
    "unixepoch",
    { deterministic: true, varargs: true },
    () => milliseconds / 1_000,
  );
}

async function createPublishedClubEvent(
  database,
  clubId,
  programId = null,
) {
  const draft = await createOrganizerEvent(database, ownerIdentity, {
    bufferAfterMinutes: 0,
    bufferBeforeMinutes: 0,
    clubId,
    coOrganizerProfileIds: [],
    description: "A complete public description for program history.",
    endLocal: "2032-08-15T20:30",
    planningStatus: "draft",
    primaryOrganizerProfileId: "profile-owner",
    programId,
    publicationStatus: "private",
    scheduleShape: "timed",
    startLocal: "2032-08-15T18:30",
    summary: "A complete public program-history summary.",
    timeZone: "America/Vancouver",
    title: "Archived program history event",
  });
  await performOrganizerLifecycleAction(
    database,
    ownerIdentity,
    draft.id,
    {
      action: "confirm",
      expectedContentVersion: draft.contentVersion,
      expectedScheduleVersion: draft.scheduleVersion,
    },
  );
  let workspace = await readOrganizerPublicationWorkspace(
    database,
    ownerIdentity,
    draft.id,
  );
  workspace = await updateOrganizerEventPublicDetails(
    database,
    ownerIdentity,
    draft.id,
    {
      arrivalInstructions: null,
      attendanceMode: "in_person",
      availabilityState: "open",
      capacity: null,
      confirmMeetupEventUrl: false,
      costText: null,
      expectedContentVersion: workspace.event.contentVersion,
      expectedScheduleVersion: workspace.event.scheduleVersion,
      externalMapUrl: null,
      meetupEventUrl: workspace.event.meetupEventUrl,
      preparationInformation: null,
      publicAccessNote: null,
      publicAddress: null,
      publicHostsEnabled: false,
      publicLocationName: "Approved public location",
      publicOnlineUrl: null,
      rsvpMode: "coming_soon",
      selectedHostProfileIds: [],
      verifiedAccessibilityNotes: null,
      weatherNote: null,
      whatToBring: null,
    },
  );
  await performOrganizerPublicationAction(
    database,
    ownerIdentity,
    draft.id,
    {
      action: "publish",
      expectedContentVersion: workspace.event.contentVersion,
      expectedScheduleVersion: workspace.event.scheduleVersion,
    },
  );
  return getOrganizerEvent(database, ownerIdentity, draft.id);
}

function programProfileSnapshot(overrides = {}) {
  const name = overrides.name ?? "Private Program";
  const description =
    overrides.description ??
    "Confirmed public information for this program.";
  return {
    clubId: overrides.clubId ?? "club-main",
    contentConfirmed: overrides.contentConfirmed ?? true,
    coverAssetId: overrides.coverAssetId ?? null,
    description,
    displayOrder: overrides.displayOrder ?? 1_000,
    featured: overrides.featured ?? false,
    laneId: overrides.laneId ?? "lane-think",
    meetupGroupUrl: overrides.meetupGroupUrl ?? null,
    metaDescription:
      overrides.metaDescription ?? description.slice(0, 160),
    name,
    openGraphAssetId: overrides.openGraphAssetId ?? null,
    preparation: overrides.preparation ?? null,
    programType: overrides.programType ?? "program",
    relatedResourceIds: overrides.relatedResourceIds ?? [],
    seoTitle: overrides.seoTitle ?? name.slice(0, 60),
    slug: overrides.slug ?? "private-program",
    socialUrls: overrides.socialUrls ?? [],
    summary: overrides.summary ?? description.slice(0, 500),
    themeColor: overrides.themeColor ?? "#0C665E",
    thumbnailAssetId: overrides.thumbnailAssetId ?? null,
    typicalFormat: overrides.typicalFormat ?? null,
    whatToExpect: overrides.whatToExpect ?? null,
  };
}

function seedApprovedMedia(database) {
  database.exec(`
    INSERT INTO media_assets (
      id, organization_id, object_key, file_name, mime_type, byte_size,
      alt_text, credit, rights_status, participant_consent_status,
      is_public, uploaded_by_profile_id, created_at, updated_at
    ) VALUES (
      'asset-approved', 'org-main', 'private-object-key', 'original.png',
      'image/png', 1000, 'Approved public artwork.',
      'Vancouver Curiosity Club', 'approved', 'not_applicable',
      0, 'profile-owner', 1, 1
    );
    INSERT INTO media_asset_details (
      asset_id, organization_id, upload_state, caption,
      private_rights_source_note, private_participant_consent_note,
      focal_point_x, focal_point_y, informative, content_version,
      original_sha256, width, height, pixel_count, finalized_at,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'asset-approved', 'org-main', 'ready', 'Safe public caption.',
      'private rights source', 'private consent note',
      5000, 5000, 1, 1,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      100, 100, 10000, 1, 'profile-owner', 1, 1
    );
    INSERT INTO media_asset_variants (
      id, organization_id, asset_id, variant_kind, object_key, mime_type,
      byte_size, width, height, pixel_count, sha256, state, finalized_at,
      created_at
    ) VALUES
      (
        'variant-approved-original', 'org-main', 'asset-approved', 'original',
        'opaque/approved/original', 'image/png', 1000, 100, 100, 10000,
        '${"a".repeat(64)}', 'ready', 1, 1
      ),
      (
        'variant-approved-480', 'org-main', 'asset-approved', 'webp_480',
        'opaque/approved/480', 'image/webp', 100, 100, 100, 10000,
        '${"b".repeat(64)}', 'ready', 1, 1
      ),
      (
        'variant-approved-960', 'org-main', 'asset-approved', 'webp_960',
        'opaque/approved/960', 'image/webp', 100, 100, 100, 10000,
        '${"c".repeat(64)}', 'ready', 1, 1
      ),
      (
        'variant-approved-1600', 'org-main', 'asset-approved', 'webp_1600',
        'opaque/approved/1600', 'image/webp', 100, 100, 100, 10000,
        '${"d".repeat(64)}', 'ready', 1, 1
      );
  `);
}

function activeUsageCount(database, revisionId, scope) {
  return scalar(
    database,
    `SELECT count(*) FROM media_usage_references
     WHERE revision_id = ?
       AND publication_scope = ?
       AND deleted_at IS NULL`,
    revisionId,
    scope,
  );
}

function cmsResidue(database, entityId) {
  return {
    audits: scalar(
      database,
      "SELECT count(*) FROM audit_logs WHERE entity_id = ?",
      entityId,
    ),
    revisions: scalar(
      database,
      "SELECT count(*) FROM cms_entity_revisions WHERE entity_key = ?",
      entityId,
    ),
    usages: scalar(
      database,
      "SELECT count(*) FROM media_usage_references WHERE entity_id = ?",
      entityId,
    ),
  };
}

function scalar(database, sql, ...bindings) {
  const row = database.sqlite.prepare(sql).get(...bindings);
  return row?.[Object.keys(row)[0]];
}

function row(database, sql, ...bindings) {
  const value = database.sqlite.prepare(sql).get(...bindings);
  return value ? { ...value } : null;
}

function afterMatchingFirstDatabase(database, matches, afterRead) {
  let fired = false;
  const wrap = (statement, sql) => ({
    bind(...values) {
      return wrap(statement.bind(...values), sql);
    },
    async first(...args) {
      const result = await statement.first(...args);
      if (!fired && matches(sql)) {
        fired = true;
        await afterRead();
      }
      return result;
    },
    all(...args) {
      return statement.all(...args);
    },
    run(...args) {
      return statement.run(...args);
    },
  });
  return {
    batch(statements) {
      return database.batch(statements);
    },
    prepare(sql) {
      return wrap(database.prepare(sql), sql);
    },
  };
}

function countedDatabase(database) {
  let statementCount = 0;
  const batchLengths = [];
  const bindingCounts = [];
  const recordBindings = (count) => {
    bindingCounts.push(count);
  };
  const wrap = (statement, bindingCount = 0) => ({
    bindingCount,
    inner: statement,
    bind(...values) {
      return wrap(statement.bind(...values), values.length);
    },
    async first(...args) {
      statementCount += 1;
      recordBindings(bindingCount);
      return statement.first(...args);
    },
    async all(...args) {
      statementCount += 1;
      recordBindings(bindingCount);
      return statement.all(...args);
    },
    async run(...args) {
      statementCount += 1;
      recordBindings(bindingCount);
      return statement.run(...args);
    },
  });
  return {
    batchLengths,
    bindingCounts,
    database: {
      async batch(statements) {
        statementCount += statements.length;
        batchLengths.push(statements.length);
        for (const statement of statements) {
          recordBindings(statement.bindingCount);
        }
        return database.batch(statements.map((statement) => statement.inner));
      },
      prepare(sql) {
        return wrap(database.prepare(sql));
      },
    },
    get statementCount() {
      return statementCount;
    },
    get maxBindingCount() {
      return Math.max(0, ...bindingCounts);
    },
  };
}

async function ensureRuntimeInvariantReadiness(database) {
  const statuses = [];
  for (
    let attempt = 0;
    attempt < MAX_DATABASE_INVARIANT_READY_ATTEMPTS;
    attempt += 1
  ) {
    const status = await ensureDatabaseInvariants(database);
    statuses.push(status);
    const marker = await database
      .prepare(
        `SELECT version
         FROM database_invariant_state
         WHERE singleton_key = 'database-guards'`,
      )
      .first();
    if (
      status === "ready" &&
      marker?.version === DATABASE_INVARIANT_VERSION
    ) {
      return Object.freeze(statuses);
    }
  }
  throw new Error("The runtime database invariants did not converge.");
}

test("all exercised CMS and adoption SQL shapes compile through real D1", async () => {
  const shapes = cmsSqlRecording.stop();
  await assertRecordedD1ShapesCompile(shapes, {
    expectedCount: 120,
    label: "CMS and adoption services",
  });
});
