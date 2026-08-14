import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { authorizeOrganizerAccess } from "../../lib/server/auth/index.ts";
import {
  createOrganizerEvent,
  getOrganizerEvent,
  getOrganizerEventRecord,
  softDeleteOrganizerEvent,
  updateOrganizerEvent,
} from "../../lib/server/organizer/events.ts";
import {
  decideOrganizerConflictReview,
  performOrganizerLifecycleAction,
} from "../../lib/server/organizer/scheduling.ts";
import {
  getOrganizerConflictPolicy,
  updateOrganizerConflictPolicy,
} from "../../lib/server/organizer/conflict-policy.ts";
import {
  ORGANIZER_PUBLICATION_RECONCILIATION_STATEMENT_MAXIMUM,
  performOrganizerPublicationAction,
  readOrganizationPublicationPolicy,
  readOrganizerPublicationPreview,
  readOrganizerPublicationWorkspace,
  reconcileDueOrganizerPublications,
  updateOrganizationPublicationPolicy,
  updateOrganizerEventPublicDetails,
} from "../../lib/server/organizer/publication.ts";
import { updateTeamMember } from "../../lib/server/organizer/team.ts";
import {
  confirmOrganizerPublicAttribution,
  revokeOrganizerPublicAttribution,
  updateOrganizerProfile,
} from "../../lib/server/organizer/profiles.ts";
import {
  getPublicEventBySlug,
  listPublicEventSitemapSlugs,
  queryPublicEvents,
} from "../../lib/server/public/events.ts";
import {
  deleteMediaAsset,
  getPublicMediaVariant,
} from "../../lib/server/media/storage.ts";
import {
  ensureDatabaseInvariants,
} from "../../lib/server/database/invariants.ts";
import { ensureDatabaseInvariantsReady } from "../database/invariant-ready.mjs";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";
import { interceptD1Statements } from "../auth/intercept-d1.mjs";

const ownerIdentity = Object.freeze({
  displayName: "Owner",
  email: "owner@example.test",
  source: "sites-siwc",
});
const administratorIdentity = Object.freeze({
  displayName: "Administrator",
  email: "admin@example.test",
  source: "sites-siwc",
});
const organizerIdentity = Object.freeze({
  displayName: "Organizer",
  email: "organizer@example.test",
  source: "sites-siwc",
});
const viewerIdentity = Object.freeze({
  displayName: "Viewer",
  email: "viewer@example.test",
  source: "sites-siwc",
});
const unassignedOrganizerIdentity = Object.freeze({
  displayName: "Unassigned Organizer",
  email: "unassigned@example.test",
  source: "sites-siwc",
});

const BASE_NOW = Date.parse("2030-01-01T08:00:00.000Z");

test("fresh confirmed event workspace is private and the first details save creates durable sidecars", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  setD1Now(database, BASE_NOW);
  const event = await createConfirmedEvent(database, {
    title: "First publication workspace",
  });

  const initial = await readOrganizerPublicationWorkspace(
    database,
    ownerIdentity,
    event.id,
  );
  assert.equal(initial.event.publicationStatus, "private");
  assert.equal(initial.details.attendanceMode, "location_undecided");
  assert.equal(initial.details.rsvpMode, "coming_soon");
  assert.equal(initial.pendingJob, null);
  assert.equal(initial.permissions.canPreview, false);
  assert.equal(
    await readOrganizerPublicationPreview(
      database,
      ownerIdentity,
      event.id,
    ),
    null,
  );
  assert.equal(initial.readiness.ready, false);
  assert.ok(
    initial.readiness.missing.some(
      (item) => item.code === "public_details_required",
    ),
  );

  const incomplete = await saveDetails(
    database,
    ownerIdentity,
    initial,
    {
      attendanceMode: "location_undecided",
      publicLocationName: null,
    },
  );
  assert.equal(incomplete.readiness.ready, false);
  assert.ok(
    incomplete.readiness.missing.some(
      (item) => item.code === "attendance_mode_required",
    ),
  );
  const saved = await saveDetails(database, ownerIdentity, incomplete);
  assert.equal(saved.event.contentVersion, initial.event.contentVersion + 2);
  assert.equal(saved.event.scheduleVersion, initial.event.scheduleVersion);
  assert.equal(saved.event.publicationStatus, "private");
  assert.equal(saved.details.attendanceMode, "in_person");
  assert.equal(saved.details.publicLocationName, "Approved public location");
  assert.equal(saved.details.rsvpMode, "coming_soon");
  assert.equal(saved.readiness.ready, true);
  assert.equal(saved.permissions.canPreview, true);
  assert.equal(
    (
      await readOrganizerPublicationPreview(
        database,
        ownerIdentity,
        event.id,
      )
    )?.slug,
    saved.event.slug,
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_event_public_details",
      "organizer_event_id = ?",
      event.id,
    ),
    1,
  );
  const state = await row(
    database,
    `SELECT first_published_at, most_recent_published_at,
            most_recent_unpublished_at, public_cancellation_at
     FROM organizer_event_publication_state
     WHERE organizer_event_id = ?`,
    event.id,
  );
  assert.deepEqual(
    {
      first: state.first_published_at,
      published: state.most_recent_published_at,
      unpublished: state.most_recent_unpublished_at,
      cancelled: state.public_cancellation_at,
    },
    { cancelled: null, first: null, published: null, unpublished: null },
  );
});

test("authorized event artwork selection is content-only, atomic, public-gated, and deletion-blocking", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  setD1Now(database, BASE_NOW);
  const event = await createConfirmedEvent(database, {
    primaryOrganizerProfileId: "profile-organizer",
    title: "Event artwork integration",
  });
  const initial = await readOrganizerPublicationWorkspace(
    database,
    organizerIdentity,
    event.id,
  );
  assert.equal(initial.permissions.canEditPublicDetails, true);
  assert.deepEqual(
    initial.artworkOptions.map(({ assetId }) => assetId),
    ["asset-event-artwork"],
  );

  const saved = await saveDetails(
    database,
    organizerIdentity,
    initial,
    {
      artworkAssetId: "asset-event-artwork",
      metaDescription:
        "A precise social description for the published event.",
      seoTitle: "A precise event title",
    },
  );
  assert.equal(saved.details.artworkAssetId, "asset-event-artwork");
  assert.equal(saved.details.seoTitle, "A precise event title");
  assert.equal(
    saved.details.metaDescription,
    "A precise social description for the published event.",
  );
  assert.equal(saved.event.contentVersion, initial.event.contentVersion + 1);
  assert.equal(saved.event.scheduleVersion, initial.event.scheduleVersion);
  assert.deepEqual(
    await activeEventArtworkUsages(database, event.id),
    [
      {
        asset_id: "asset-event-artwork",
        publication_scope: "draft",
      },
    ],
  );
  const preview = await readOrganizerPublicationPreview(
    database,
    organizerIdentity,
    event.id,
  );
  assert.equal(preview.artwork.altText, "Abstract cobalt and forest shapes.");
  assert.equal(preview.artwork.credit, "Vancouver Curiosity Club");
  assert.equal(preview.artwork.focalPoint.x, 2500);
  assert.equal(preview.artwork.focalPoint.y, 7500);
  assert.deepEqual(preview.artwork.dimensions, {
    large: { height: 900, width: 1600 },
    medium: { height: 540, width: 960 },
    small: { height: 270, width: 480 },
  });
  assert.equal(preview.seoTitle, "A precise event title");
  assert.equal(
    preview.metaDescription,
    "A precise social description for the published event.",
  );
  assert.equal(
    preview.artwork.url,
    `/api/organizer/media/asset-event-artwork/variants/webp_1600?eventId=${encodeURIComponent(event.id)}`,
  );
  assert.equal(
    await getPublicEventBySlug(database, {
      organizationId: "org-main",
      slug: saved.event.slug,
    }),
    null,
  );

  const beforeStale = {
    event: await getOrganizerEvent(database, ownerIdentity, event.id),
    usages: await activeEventArtworkUsages(database, event.id),
  };
  await assert.rejects(
    saveDetails(
      database,
      organizerIdentity,
      initial,
      { artworkAssetId: null },
    ),
    (error) => error?.code === "stale_edit" && error?.status === 409,
  );
  assert.equal(
    (await getOrganizerEvent(database, ownerIdentity, event.id)).contentVersion,
    beforeStale.event.contentVersion,
  );
  assert.deepEqual(
    await activeEventArtworkUsages(database, event.id),
    beforeStale.usages,
  );

  seedCrossOrganizationArtwork(database);
  await assert.rejects(
    saveDetails(
      database,
      organizerIdentity,
      saved,
      { artworkAssetId: "asset-other-organization" },
    ),
    isInputValidationError,
  );
  assert.deepEqual(
    await activeEventArtworkUsages(database, event.id),
    beforeStale.usages,
  );

  const published = await publicationAction(
    database,
    administratorIdentity,
    saved,
    "publish",
  );
  const publicEvent = await getPublicEventBySlug(database, {
    organizationId: "org-main",
    slug: published.workspace.event.slug,
  });
  assert.equal(publicEvent.artwork.url, "/media/asset-event-artwork/webp_1600");
  assert.deepEqual(publicEvent.artwork.srcSet, {
    large: "/media/asset-event-artwork/webp_1600",
    medium: "/media/asset-event-artwork/webp_960",
    small: "/media/asset-event-artwork/webp_480",
  });
  assert.deepEqual(publicEvent.artwork.dimensions, {
    large: { height: 900, width: 1600 },
    medium: { height: 540, width: 960 },
    small: { height: 270, width: 480 },
  });
  assert.equal(publicEvent.seoTitle, "A precise event title");
  assert.equal(
    publicEvent.metaDescription,
    "A precise social description for the published event.",
  );
  assert.doesNotMatch(
    JSON.stringify(publicEvent),
    /private-original|private\/event-art|object_key|rights_source/iu,
  );
  assert.deepEqual(
    (await activeEventArtworkUsages(database, event.id)).map(
      ({ asset_id, publication_scope }) => ({
        asset_id,
        publication_scope,
      }),
    ),
    [
      {
        asset_id: "asset-event-artwork",
        publication_scope: "draft",
      },
      {
        asset_id: "asset-event-artwork",
        publication_scope: "published",
      },
    ],
  );

  const deletion = await deleteMediaAsset(
    database,
    {
      delete: async () => {
        throw new Error("R2 deletion must not run for an in-use asset.");
      },
      get: async () => null,
      put: async () => undefined,
    },
    administratorIdentity,
    "asset-event-artwork",
    1,
    { nowUtcMs: BASE_NOW + 5_000 },
  );
  assert.equal(deletion.deleted, false);
  assert.equal(
    deletion.blockers.some(
      (blocker) =>
        blocker.entityType === "organizer_event" &&
        blocker.entityId === event.id &&
        blocker.usageKind === "event_artwork",
    ),
    true,
  );
});

test("event artwork carries exact portrait and square WebP dimensions into public renderers", async (t) => {
  const shapes = [
    {
      dimensions: {
        large: { height: 2_400, width: 1_600 },
        medium: { height: 1_440, width: 960 },
        original: { height: 2_400, width: 1_600 },
        small: { height: 720, width: 480 },
      },
      label: "portrait",
    },
    {
      dimensions: {
        large: { height: 1_600, width: 1_600 },
        medium: { height: 960, width: 960 },
        original: { height: 1_600, width: 1_600 },
        small: { height: 480, width: 480 },
      },
      label: "square",
    },
  ];
  for (const shape of shapes) {
    await t.test(shape.label, async (t) => {
      const database = await newDatabase({
        artworkDimensions: shape.dimensions,
      });
      t.after(() => database.close());
      setD1Now(database, BASE_NOW);
      const event = await createConfirmedEvent(database, {
        title: `Exact ${shape.label} artwork`,
      });
      const workspace = await readOrganizerPublicationWorkspace(
        database,
        ownerIdentity,
        event.id,
      );
      const ready = await saveDetails(
        database,
        ownerIdentity,
        workspace,
        { artworkAssetId: "asset-event-artwork" },
      );
      const published = await publicationAction(
        database,
        ownerIdentity,
        ready,
        "publish",
      );
      const detail = await getPublicEventBySlug(database, {
        organizationId: "org-main",
        slug: published.workspace.event.slug,
      });
      assert.deepEqual(detail?.artwork?.dimensions, {
        large: shape.dimensions.large,
        medium: shape.dimensions.medium,
        small: shape.dimensions.small,
      });
    });
  }

  for (const sourcePath of [
    "app/_components/EventCard.tsx",
    "app/_components/PublicEventDetailRenderer.tsx",
  ]) {
    const source = readFileSync(sourcePath, "utf8");
    assert.match(source, /event\.artwork\.dimensions\.large\.height/u);
    assert.match(source, /event\.artwork\.dimensions\.large\.width/u);
    assert.doesNotMatch(source, /height=\{900\}|width=\{1600\}/u);
  }
});

test("event website fields share the CMS legal-claim gate and never reach public discovery", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  setD1Now(database, BASE_NOW);
  const neutralEvent = await createConfirmedEvent(database, {
    title: "Protected claim detail validation",
  });
  const neutralWorkspace = await readOrganizerPublicationWorkspace(
    database,
    ownerIdentity,
    neutralEvent.id,
  );
  for (const [field, value] of [
    ["publicLocationName", "BC incorporated society hall"],
    ["publicAddress", "Registered nonprofit society office"],
    ["publicAccessNote", "Tax-deductible admission claim"],
    ["costText", "CRA charity status admission"],
    ["preparationInformation", "Bring the society registration record"],
    ["whatToBring", "A registration number"],
    ["arrivalInstructions", "Enter the registered charity office"],
    ["weatherNote", "Non-profit organization weather plan"],
    ["verifiedAccessibilityNotes", "Legal status accessibility note"],
    ["seoTitle", "Registered nonprofit society event"],
    ["metaDescription", "BC incorporated society event details"],
  ]) {
    await assert.rejects(
      saveDetails(database, ownerIdentity, neutralWorkspace, {
        [field]: value,
      }),
      (error) =>
        isInputValidationError(error) &&
        error.issues?.some(
          (entry) =>
            entry.path === field &&
            entry.code === "protected_legal_claim",
        ),
      field,
    );
  }
  for (const value of [
    "We are a charity.",
    "We are a charitable organization.",
    "We are a not-for-profit organization.",
    "This organization is tax exempt.",
    "This event is government-funded.",
    "We are registered as a charity.",
    "We are incorporated under the Societies Act.",
    "We are registered with the CRA.",
    "We can issue donation receipts.",
    "We are not a registered charity.",
    "Donations are not tax deductible.",
    "We cannot issue tax receipts.",
    "We do not issue donation receipts.",
  ]) {
    await assert.rejects(
      saveDetails(database, ownerIdentity, neutralWorkspace, {
        publicAccessNote: value,
      }),
      (error) =>
        isInputValidationError(error) &&
        error.issues?.some(
          (entry) =>
            entry.path === "publicAccessNote" &&
            entry.code === "protected_legal_claim",
        ),
      value,
    );
  }
  assert.equal(
    await countWhere(
      database,
      "organizer_event_public_details",
      "organizer_event_id = ?",
      neutralEvent.id,
    ),
    0,
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_event_public_metadata",
      "organizer_event_id = ?",
      neutralEvent.id,
    ),
    0,
  );

  const claimedEvent = await createConfirmedEvent(database, {
    description:
      "Registration number and tax receipt claims belong in the legal workflow.",
    endLocal: "2032-08-16T20:30",
    startLocal: "2032-08-16T18:30",
    summary: "CRA charity status is not ordinary event copy.",
    title: "Registered nonprofit society gathering",
  });
  const claimedInitial = await readOrganizerPublicationWorkspace(
    database,
    ownerIdentity,
    claimedEvent.id,
  );
  const claimedReady = await saveDetails(
    database,
    ownerIdentity,
    claimedInitial,
  );
  assert.deepEqual(
    claimedReady.readiness.missing
      .filter(({ code }) => code === "protected_legal_claim")
      .map(({ field }) => field)
      .sort(),
    ["description", "summary", "title"],
  );
  await assert.rejects(
    publicationAction(
      database,
      ownerIdentity,
      claimedReady,
      "publish",
    ),
    (error) => error?.code === "validation_failed" && error?.status === 422,
  );

  const raceReady = await saveDetails(
    database,
    ownerIdentity,
    neutralWorkspace,
    { seoTitle: "A safe event title" },
  );
  const residueBeforeRace = {
    audits: await countWhere(
      database,
      "audit_logs",
      "entity_type = 'organizer_event' AND entity_id = ?",
      neutralEvent.id,
    ),
    revisions: await countWhere(
      database,
      "organizer_event_revisions",
      "organizer_event_id = ?",
      neutralEvent.id,
    ),
  };
  const racedDatabase = beforeBatchDatabase(database, () => {
    database.exec(`
      UPDATE organizer_event_public_metadata
      SET seo_title = 'BC incorporated society event',
          updated_by_profile_id = 'profile-owner',
          updated_at = updated_at + 1
      WHERE organizer_event_id = '${neutralEvent.id}';
    `);
  });
  await assert.rejects(
    publicationAction(
      racedDatabase,
      ownerIdentity,
      raceReady,
      "publish",
    ),
    (error) => error?.code === "validation_failed" && error?.status === 422,
  );
  assert.equal(
    (
      await getOrganizerEvent(database, ownerIdentity, neutralEvent.id)
    ).publicationStatus,
    "private",
  );
  assert.deepEqual(
    {
      audits: await countWhere(
        database,
        "audit_logs",
        "entity_type = 'organizer_event' AND entity_id = ?",
        neutralEvent.id,
      ),
      revisions: await countWhere(
        database,
        "organizer_event_revisions",
        "organizer_event_id = ?",
        neutralEvent.id,
      ),
    },
    residueBeforeRace,
  );

  for (const event of [claimedEvent, neutralEvent]) {
    assert.equal(
      await getPublicEventBySlug(database, {
        organizationId: "org-main",
        slug: event.slug,
      }),
      null,
    );
  }
  const publicPage = await queryPublicEvents(database, {
    nowUtcMs: BASE_NOW,
    organizationId: "org-main",
    page: 1,
    pageSize: 48,
    todayDate: "2030-01-01",
    view: "upcoming",
  });
  assert.equal(
    publicPage.events.some(
      ({ slug }) =>
        slug === claimedEvent.slug || slug === neutralEvent.slug,
    ),
    false,
  );
  const sitemapSlugs = await listPublicEventSitemapSlugs(database, {
    organizationId: "org-main",
  });
  assert.equal(sitemapSlugs.includes(claimedEvent.slug), false);
  assert.equal(sitemapSlugs.includes(neutralEvent.slug), false);

  const routeSource = readFileSync("app/events/[slug]/page.tsx", "utf8");
  assert.match(routeSource, /event\.seoTitle \?\? loaded\.event\.title/u);
  assert.match(routeSource, /buildPublicEventMetadataDescription/u);
  assert.match(routeSource, /metaDescription:\s*loaded\.event\.metaDescription/u);
  assert.match(routeSource, /resolvePublicEventMetadataImage/u);
  assert.match(routeSource, /siteOpenGraphAssetId/u);
  assert.match(routeSource, /imageHeight:\s*image\?\.height/u);
  assert.match(routeSource, /buildPublicEventJsonLd/u);
  assert.doesNotMatch(
    routeSource,
    /\bperformer\s*:/u,
  );
});

test("event artwork eligibility is rechecked by D1 inside the details batch", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  setD1Now(database, BASE_NOW);
  const event = await createConfirmedEvent(database, {
    primaryOrganizerProfileId: "profile-organizer",
    title: "Artwork eligibility race",
  });
  const initial = await readOrganizerPublicationWorkspace(
    database,
    organizerIdentity,
    event.id,
  );
  const before = {
    audit: await countWhere(
      database,
      "audit_logs",
      "entity_id = ?",
      event.id,
    ),
    event: await getOrganizerEvent(database, ownerIdentity, event.id),
    revisions: await countWhere(
      database,
      "organizer_event_revisions",
      "organizer_event_id = ?",
      event.id,
    ),
    usages: await activeEventArtworkUsages(database, event.id),
  };
  const originalBatch = database.batch.bind(database);
  let intercepted = false;
  database.batch = async (statements) => {
    if (!intercepted) {
      intercepted = true;
      database.exec(`
        UPDATE media_assets
        SET rights_status = 'unconfirmed',
            updated_at = ${BASE_NOW + 1}
        WHERE id = 'asset-event-artwork';
      `);
    }
    return originalBatch(statements);
  };
  try {
    await assert.rejects(
      saveDetails(
        database,
        organizerIdentity,
        initial,
        { artworkAssetId: "asset-event-artwork" },
      ),
      (error) =>
        error?.code === "validation_failed" &&
        error?.status === 422 &&
        /no longer eligible/iu.test(error?.message ?? "") &&
        !/phase6_/iu.test(error?.message ?? ""),
    );
  } finally {
    database.batch = originalBatch;
  }
  assert.equal(intercepted, true);
  const after = await getOrganizerEvent(
    database,
    ownerIdentity,
    event.id,
  );
  assert.equal(after.contentVersion, before.event.contentVersion);
  assert.equal(after.scheduleVersion, before.event.scheduleVersion);
  assert.deepEqual(
    await activeEventArtworkUsages(database, event.id),
    before.usages,
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_event_revisions",
      "organizer_event_id = ?",
      event.id,
    ),
    before.revisions,
  );
  assert.equal(
    await countWhere(
      database,
      "audit_logs",
      "entity_id = ?",
      event.id,
    ),
    before.audit,
  );
});

test("preview permission exactly matches the protected projection for draft and incomplete records", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  setD1Now(database, BASE_NOW);

  const draft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({ title: "Draft preview parity" }),
  );
  const draftWorkspace = await saveDetails(
    database,
    ownerIdentity,
    await readOrganizerPublicationWorkspace(
      database,
      ownerIdentity,
      draft.id,
    ),
  );
  assert.equal(draftWorkspace.readiness.ready, false);
  assert.equal(draftWorkspace.permissions.canPreview, false);
  assert.equal(
    await readOrganizerPublicationPreview(
      database,
      ownerIdentity,
      draft.id,
    ),
    null,
  );

  const incomplete = await createConfirmedEvent(database, {
    summary: null,
    title: "Incomplete preview parity",
  });
  const incompleteWorkspace = await saveDetails(
    database,
    ownerIdentity,
    await readOrganizerPublicationWorkspace(
      database,
      ownerIdentity,
      incomplete.id,
    ),
  );
  assert.equal(incompleteWorkspace.readiness.ready, false);
  assert.equal(
    incompleteWorkspace.readiness.missing.some(
      (item) => item.code === "summary_required",
    ),
    true,
  );
  assert.equal(incompleteWorkspace.permissions.canPreview, false);
  assert.equal(
    await readOrganizerPublicationPreview(
      database,
      ownerIdentity,
      incomplete.id,
    ),
    null,
  );
});

test("publication workspace and preview revalidate live membership and club scope at their final reads", async (t) => {
  await t.test("club assignment loss denies the private publication workspace", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const event = await createConfirmedEvent(database, {
      primaryOrganizerProfileId: "profile-organizer",
      title: "Publication assignment race",
    });
    await saveDetails(
      database,
      organizerIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        organizerIdentity,
        event.id,
      ),
      { artworkAssetId: "asset-event-artwork" },
    );
    const raced = beforeFirstMatchingDatabase(
      database,
      /SELECT asset\.id,[\s\S]*Approved artwork/u,
      () => {
        database.exec(`
          UPDATE club_memberships
          SET deleted_at = ${BASE_NOW}
          WHERE id = 'club-organizer-main';
        `);
      },
    );
    await assert.rejects(
      readOrganizerPublicationWorkspace(
        raced,
        organizerIdentity,
        event.id,
      ),
      (error) => error?.code === "authorization_denied",
    );
  });

  await t.test("membership suspension before the final artwork read denies the workspace", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const event = await createConfirmedEvent(database, {
      primaryOrganizerProfileId: "profile-organizer",
      title: "Publication membership race",
    });
    await saveDetails(
      database,
      organizerIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        organizerIdentity,
        event.id,
      ),
      { artworkAssetId: "asset-event-artwork" },
    );
    const raced = beforeFirstMatchingDatabase(
      database,
      /SELECT asset\.id,[\s\S]*Approved artwork/u,
      () => {
        database.exec(`
          UPDATE organization_memberships
          SET status = 'suspended'
          WHERE id = 'membership-organizer';
        `);
      },
    );
    await assert.rejects(
      readOrganizerPublicationWorkspace(
        raced,
        organizerIdentity,
        event.id,
      ),
      (error) => error?.code === "authorization_denied",
    );
  });

  await t.test("preview projection loses access before its terminal SQL read", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const event = await createConfirmedEvent(database, {
      primaryOrganizerProfileId: "profile-organizer",
      title: "Publication preview race",
    });
    await saveDetails(
      database,
      organizerIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        organizerIdentity,
        event.id,
      ),
      { artworkAssetId: "asset-event-artwork" },
    );
    const raced = beforeFirstMatchingDatabase(
      database,
      /JOIN organization_memberships AS preview_membership/u,
      () => {
        database.exec(`
          UPDATE profiles
          SET status = 'suspended'
          WHERE id = 'profile-organizer';
        `);
      },
    );
    assert.equal(
      await readOrganizerPublicationPreview(
        raced,
        organizerIdentity,
        event.id,
      ),
      null,
    );
  });

  await t.test("suspension after readiness but before final access denies every workspace field", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const event = await createConfirmedEvent(database, {
      primaryOrganizerProfileId: "profile-organizer",
      title: "Publication final-seal race",
    });
    await saveDetails(
      database,
      organizerIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        organizerIdentity,
        event.id,
      ),
      { artworkAssetId: "asset-event-artwork" },
    );
    const intercepted = interceptD1Statements(database, {
      before: (sql) =>
        sql.includes("SELECT membership.role,") &&
        sql.includes("END AS can_edit"),
      hook: async () => {
        database.exec(`
          UPDATE organization_memberships
          SET status = 'suspended'
          WHERE id = 'membership-organizer'
        `);
      },
    });

    await assert.rejects(
      readOrganizerPublicationWorkspace(
        intercepted.database,
        organizerIdentity,
        event.id,
      ),
      (error) => error?.code === "authorization_denied",
    );
    assert.equal(intercepted.fired(), true);
  });

  await t.test("policy read denies an actor suspended after initial authorization", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    const intercepted = interceptD1Statements(database, {
      before: (sql) =>
        sql.includes("LEFT JOIN organization_publication_policies AS policy"),
      hook: async () => {
        database.exec(`
          UPDATE organization_memberships
          SET status = 'suspended'
          WHERE id = 'membership-organizer'
        `);
      },
    });

    await assert.rejects(
      readOrganizationPublicationPolicy(
        intercepted.database,
        organizerIdentity,
      ),
      (error) => error?.code === "authorization_denied",
    );
    assert.equal(intercepted.fired(), true);
  });
});

test("publish, unpublish, and republish preserve one canonical record and publication history", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  setD1Now(database, BASE_NOW);
  const event = await createConfirmedEvent(database, {
    title: "Publication lifecycle",
  });
  let workspace = await saveDetails(
    database,
    ownerIdentity,
    await readOrganizerPublicationWorkspace(database, ownerIdentity, event.id),
  );

  setD1Now(database, BASE_NOW + 1_000);
  const published = await publicationAction(
    database,
    ownerIdentity,
    workspace,
    "publish",
  );
  workspace = published.workspace;
  assert.equal(published.outcome, "published");
  assert.equal(workspace.event.publicationStatus, "published");
  const firstPublic = await getPublicEventBySlug(database, {
    organizationId: "org-main",
    slug: workspace.event.slug,
  });
  assert.equal(firstPublic?.title, "Publication lifecycle");
  const firstState = await publicationState(database, event.id);

  setD1Now(database, BASE_NOW + 2_000);
  const unpublished = await publicationAction(
    database,
    ownerIdentity,
    workspace,
    "unpublish",
  );
  workspace = unpublished.workspace;
  assert.equal(unpublished.outcome, "unpublished");
  assert.equal(workspace.event.publicationStatus, "unpublished");
  assert.equal(
    await getPublicEventBySlug(database, {
      organizationId: "org-main",
      slug: workspace.event.slug,
    }),
    null,
  );

  setD1Now(database, BASE_NOW + 3_000);
  const republished = await publicationAction(
    database,
    ownerIdentity,
    workspace,
    "publish",
  );
  assert.equal(republished.workspace.event.publicationStatus, "published");
  const finalState = await publicationState(database, event.id);
  assert.equal(finalState.first_published_at, firstState.first_published_at);
  assert.ok(
    finalState.most_recent_published_at >
      firstState.most_recent_published_at,
  );
  assert.ok(
    finalState.most_recent_published_at >
      finalState.most_recent_unpublished_at,
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_events",
      "id = ? AND organization_id = ?",
      event.id,
      "org-main",
    ),
    1,
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_event_revisions",
      `organizer_event_id = ?
       AND action IN ('published', 'unpublished')`,
      event.id,
    ),
    3,
  );
});

test("reschedule closes the old job, details invalidate the new job, and another Administrator may cancel a later schedule", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  setD1Now(database, BASE_NOW);
  const event = await createConfirmedEvent(database, {
    title: "Scheduled publication lifecycle",
  });
  let workspace = await saveDetails(
    database,
    ownerIdentity,
    await readOrganizerPublicationWorkspace(database, ownerIdentity, event.id),
  );

  const first = await schedulePublication(
    database,
    ownerIdentity,
    workspace,
    "2030-01-02T09:00",
  );
  workspace = first.workspace;
  const firstJob = await pendingJobRow(database, event.id);
  assert.equal(first.outcome, "publication_scheduled");
  assert.equal(workspace.event.publicationStatus, "scheduled");

  const second = await schedulePublication(
    database,
    ownerIdentity,
    workspace,
    "2030-01-03T09:00",
  );
  workspace = second.workspace;
  const jobsAfterReschedule = await all(
    database,
    `SELECT id, state, failure_code
     FROM organizer_event_publication_jobs
     WHERE organizer_event_id = ?
     ORDER BY created_at, id`,
    event.id,
  );
  assert.equal(jobsAfterReschedule.length, 2);
  assert.equal(
    jobsAfterReschedule.find((job) => job.id === firstJob.id)?.state,
    "cancelled",
  );
  assert.equal(
    jobsAfterReschedule.filter((job) => job.state === "pending").length,
    1,
  );

  workspace = await saveDetails(database, ownerIdentity, workspace, {
    costText: "Pay what you can",
  });
  assert.equal(workspace.event.publicationStatus, "unpublished");
  assert.equal(workspace.pendingJob, null);
  assert.equal(
    (
      await all(
        database,
        `SELECT state, failure_code
         FROM organizer_event_publication_jobs
         WHERE organizer_event_id = ?
         ORDER BY created_at, id`,
        event.id,
      )
    ).filter(
      (job) =>
        job.state === "invalidated" &&
        job.failure_code === "publication_facts_changed",
    ).length,
    1,
  );

  const third = await schedulePublication(
    database,
    ownerIdentity,
    workspace,
    "2030-01-04T09:00",
  );
  const cancelled = await publicationAction(
    database,
    administratorIdentity,
    third.workspace,
    "cancel_scheduled_publication",
  );
  assert.equal(cancelled.outcome, "publication_cancelled");
  assert.equal(cancelled.workspace.event.publicationStatus, "unpublished");
  assert.equal(cancelled.workspace.pendingJob, null);
  assert.equal(
    await countWhere(
      database,
      "organizer_event_publication_jobs",
      "organizer_event_id = ? AND state = 'pending'",
      event.id,
    ),
    0,
  );
});

test("two due reconcilers publish one job exactly once", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  setD1Now(database, BASE_NOW);
  const event = await createConfirmedEvent(database, {
    title: "Exactly once reconciliation",
  });
  const ready = await saveDetails(
    database,
    ownerIdentity,
    await readOrganizerPublicationWorkspace(database, ownerIdentity, event.id),
  );
  const scheduled = await schedulePublication(
    database,
    ownerIdentity,
    ready,
    "2030-01-02T09:00",
  );
  const dueAt = scheduled.workspace.pendingJob.requestedPublicationAtUtc;
  setD1Now(database, dueAt);

  const results = await Promise.all([
    reconcileDueOrganizerPublications(database, { now: dueAt }),
    reconcileDueOrganizerPublications(database, { now: dueAt }),
  ]);
  assert.equal(
    results.reduce((sum, result) => sum + result.executed, 0),
    1,
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_event_publication_jobs",
      "organizer_event_id = ? AND state = 'executed'",
      event.id,
    ),
    1,
  );
  assert.equal(
    await countWhere(
      database,
      "audit_logs",
      "entity_id = ? AND action = 'organizer_event.publication_executed'",
      event.id,
    ),
    1,
  );
  assert.equal(
    (
      await getOrganizerEvent(database, ownerIdentity, event.id)
    ).publicationStatus,
    "published",
  );
});

test("scheduled reconciliation stays within the D1 statement cap and processes at most one job", async (t) => {
  await t.test("no due job returns without unrelated work", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const counter = countedBinding(database);
    assert.equal(await ensureDatabaseInvariants(counter.binding), "ready");
    const reconciled = await reconcileDueOrganizerPublications(
      counter.binding,
    );
    assert.deepEqual(reconciled, {
      executed: 0,
      inspected: 0,
      invalidated: 0,
      transientFailures: 0,
    });
    assertWithinStatementCap(counter, "publication no-due");
    assert.deepEqual(counter.counts(), {
      batchLengths: [],
      statementCount: 3,
    });
  });

  await t.test("successful execution includes candidate selection and one bounded job batch", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const first = await createReadyConfirmedEvent(
      database,
      "Budgeted successful reconciliation",
    );
    const second = await createReadyConfirmedEvent(
      database,
      "Second due job remains pending",
      {
        endLocal: "2032-08-16T20:30",
        startLocal: "2032-08-16T18:30",
      },
    );
    const scheduledFirst = await schedulePublication(
      database,
      ownerIdentity,
      first.workspace,
      "2030-01-02T09:00",
    );
    const scheduledSecond = await schedulePublication(
      database,
      ownerIdentity,
      second.workspace,
      "2030-01-02T09:01",
    );
    const dueAt =
      scheduledSecond.workspace.pendingJob.requestedPublicationAtUtc;
    setD1Now(database, dueAt);
    const counter = countedBinding(database);
    assert.equal(await ensureDatabaseInvariants(counter.binding), "ready");
    const reconciled = await reconcileDueOrganizerPublications(
      counter.binding,
      { now: dueAt },
    );
    assert.deepEqual(
      {
        executed: reconciled.executed,
        inspected: reconciled.inspected,
      },
      { executed: 1, inspected: 1 },
    );
    assertWithinStatementCap(counter, "successful reconciliation");
    assert.deepEqual(counter.counts(), {
      batchLengths: [10],
      statementCount: 23,
    });
    assert.equal(
      await countWhere(
        database,
        "organizer_event_publication_jobs",
        "state = 'pending'",
      ),
      1,
    );
    assert.equal(
      (
        await getOrganizerEvent(
          database,
          ownerIdentity,
          scheduledFirst.workspace.event.id,
        )
      ).publicationStatus,
      "published",
    );
  });

  await t.test("deterministic authorizer invalidation plus notifications stays bounded", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const event = await createConfirmedEvent(database, {
      primaryOrganizerProfileId: "profile-organizer",
      title: "Budgeted deterministic invalidation",
    });
    const ready = await saveDetails(
      database,
      administratorIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        administratorIdentity,
        event.id,
      ),
    );
    const scheduled = await schedulePublication(
      database,
      administratorIdentity,
      ready,
      "2030-01-02T09:00",
    );
    await updateTeamMember(
      database,
      ownerIdentity,
      "membership-admin",
      { role: "administrator", status: "revoked" },
      BASE_NOW + 500,
    );
    const dueAt = scheduled.workspace.pendingJob.requestedPublicationAtUtc;
    setD1Now(database, dueAt);
    const counter = countedBinding(database);
    assert.equal(await ensureDatabaseInvariants(counter.binding), "ready");
    const reconciled = await reconcileDueOrganizerPublications(
      counter.binding,
      { now: dueAt },
    );
    assert.equal(reconciled.invalidated, 1);
    assert.equal(reconciled.transientFailures, 0);
    assertWithinStatementCap(counter, "deterministic invalidation");
    assert.deepEqual(counter.counts(), {
      batchLengths: [10],
      statementCount: 19,
    });
    assert.equal(
      await countWhere(
        database,
        "notifications",
        `type = 'publication_failed'
         AND json_extract(payload_json, '$.eventId') = ?`,
        event.id,
      ),
      2,
    );
  });

  await t.test("a transient batch failure leaves the due job pending within budget", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const { workspace: ready } = await createReadyConfirmedEvent(
      database,
      "Budgeted transient reconciliation",
    );
    const scheduled = await schedulePublication(
      database,
      ownerIdentity,
      ready,
      "2030-01-02T09:00",
    );
    const dueAt = scheduled.workspace.pendingJob.requestedPublicationAtUtc;
    setD1Now(database, dueAt);
    const counter = countedBinding(database);
    assert.equal(await ensureDatabaseInvariants(counter.binding), "ready");
    counter.failNextBatch();
    const reconciled = await reconcileDueOrganizerPublications(
      counter.binding,
      { now: dueAt },
    );
    assert.equal(reconciled.executed, 0);
    assert.equal(reconciled.invalidated, 0);
    assert.equal(reconciled.transientFailures, 1);
    assertWithinStatementCap(counter, "transient reconciliation failure");
    assert.deepEqual(counter.counts(), {
      batchLengths: [10],
      statementCount: 25,
    });
    assert.equal(
      (await pendingJobRow(database, scheduled.workspace.event.id)).state,
      "pending",
    );
  });

  const limitDatabase = await newDatabase();
  t.after(() => limitDatabase.close());
  await assert.rejects(
    reconcileDueOrganizerPublications(limitDatabase, {
      limit: 2,
      now: BASE_NOW,
    }),
    isInputValidationError,
  );
});

test("direct publish and schedule actions stay within the D1 statement cap", async (t) => {
  for (const action of ["publish", "schedule_publication"]) {
    await t.test(action, async (t) => {
      const database = await newDatabase();
      t.after(() => database.close());
      setD1Now(database, BASE_NOW);
      const { workspace: ready } = await createReadyConfirmedEvent(
        database,
        `Budgeted direct ${action}`,
      );
      const counter = countedBinding(database);
      assert.equal(await ensureDatabaseInvariants(counter.binding), "ready");
      const result =
        action === "publish"
          ? await publicationAction(
              counter.binding,
              ownerIdentity,
              ready,
              "publish",
            )
          : await schedulePublication(
              counter.binding,
              ownerIdentity,
              ready,
              "2030-01-02T09:00",
            );
      assert.equal(
        result.outcome,
        action === "publish"
          ? "published"
          : "publication_scheduled",
      );
      assertWithinStatementCap(counter, `direct ${action}`);
      assert.deepEqual(counter.counts(), {
        batchLengths: [9],
        statementCount: 40,
      });
      assert.equal(
        await countWhere(
          database,
          "organizer_schedule_write_intents",
          "organizer_event_id = ? AND operation = ?",
          ready.event.id,
          action,
        ),
        1,
      );
    });
  }
});

test("publication exits and maximum host plus artwork details stay within the D1 statement cap", async (t) => {
  await t.test("unpublish", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const { workspace: ready } = await createReadyConfirmedEvent(
      database,
      "Budgeted unpublish",
    );
    const published = await publicationAction(
      database,
      ownerIdentity,
      ready,
      "publish",
    );
    const counter = countedBinding(database);
    assert.equal(await ensureDatabaseInvariants(counter.binding), "ready");
    const unpublished = await publicationAction(
      counter.binding,
      ownerIdentity,
      published.workspace,
      "unpublish",
    );
    assert.equal(unpublished.outcome, "unpublished");
    assertWithinStatementCap(counter, "unpublish");
    assert.deepEqual(counter.counts(), {
      batchLengths: [9],
      statementCount: 36,
    });
  });

  for (const initialPublication of ["published", "scheduled"]) {
    await t.test(`cancel ${initialPublication}`, async (t) => {
      const database = await newDatabase();
      t.after(() => database.close());
      setD1Now(database, BASE_NOW);
      const { workspace: ready } = await createReadyConfirmedEvent(
        database,
        `Budgeted cancel ${initialPublication}`,
      );
      const current =
        initialPublication === "published"
          ? (
              await publicationAction(
                database,
                ownerIdentity,
                ready,
                "publish",
              )
            ).workspace
          : (
              await schedulePublication(
                database,
                ownerIdentity,
                ready,
                "2030-01-02T09:00",
              )
            ).workspace;
      const counter = countedBinding(database);
      assert.equal(await ensureDatabaseInvariants(counter.binding), "ready");
      const result = await performOrganizerLifecycleAction(
        counter.binding,
        ownerIdentity,
        current.event.id,
        {
          action: "cancel",
          expectedContentVersion: current.event.contentVersion,
          expectedScheduleVersion: current.event.scheduleVersion,
        },
      );
      assert.equal(result.event.planningStatus, "cancelled");
      assertWithinStatementCap(counter, `cancel ${initialPublication}`);
      assert.deepEqual(
        counter.counts(),
        initialPublication === "published"
          ? { batchLengths: [14], statementCount: 26 }
          : { batchLengths: [16], statementCount: 29 },
      );
    });
  }

  await t.test("approved event artwork", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const event = await createConfirmedEvent(database, {
      title: "Budgeted approved event artwork",
    });
    const initial = await readOrganizerPublicationWorkspace(
      database,
      ownerIdentity,
      event.id,
    );
    const detailsCounter = countedBinding(database);
    assert.equal(
      await ensureDatabaseInvariants(detailsCounter.binding),
      "ready",
    );
    assert.equal(
      (
        await authorizeOrganizerAccess(
          detailsCounter.binding,
          ownerIdentity,
          { initialOwnerEmail: null },
        )
      ).role,
      "owner",
    );
    const ready = await saveDetails(
      detailsCounter.binding,
      ownerIdentity,
      initial,
      {
        artworkAssetId: "asset-event-artwork",
      },
    );
    assertWithinStatementCap(detailsCounter, "approved event artwork details");
    assert.deepEqual(detailsCounter.counts(), {
      batchLengths: [13],
      statementCount: 42,
    });

    const publishCounter = countedBinding(database);
    assert.equal(
      await ensureDatabaseInvariants(publishCounter.binding),
      "ready",
    );
    assert.equal(
      (
        await authorizeOrganizerAccess(
          publishCounter.binding,
          ownerIdentity,
          { initialOwnerEmail: null },
        )
      ).role,
      "owner",
    );
    const published = await publicationAction(
      publishCounter.binding,
      ownerIdentity,
      ready,
      "publish",
    );
    assert.equal(published.outcome, "published");
    assertWithinStatementCap(publishCounter, "approved event artwork publish");
    assert.deepEqual(publishCounter.counts(), {
      batchLengths: [10],
      statementCount: 42,
    });
  });

  await t.test("maximum hosts with approved event artwork", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const coOrganizerProfileIds = [];
    for (let index = 1; index <= 12; index += 1) {
      const profileId = `profile-budget-host-${index}`;
      const membershipId = `membership-budget-host-${index}`;
      coOrganizerProfileIds.push(profileId);
      database.exec(`
        INSERT INTO profiles (
          id, siwc_subject, normalized_email, display_name,
          public_attribution_consent, status, created_at, updated_at
        ) VALUES (
          '${profileId}', 'subject-budget-host-${index}',
          'budget-host-${index}@example.test', 'Budget Host ${index}',
          1, 'active', 1, 1
        );
        INSERT INTO organization_memberships (
          id, organization_id, profile_id, normalized_email, role, status,
          created_by_profile_id, created_at, updated_at
        ) VALUES (
          '${membershipId}', 'org-main', '${profileId}',
          'budget-host-${index}@example.test', 'organizer', 'active',
          'profile-owner', 1, 1
        );
        INSERT INTO club_memberships (
          id, organization_id, club_id, organization_membership_id,
          profile_id, role, status, created_by_profile_id,
          created_at, updated_at
        ) VALUES (
          'club-budget-host-${index}', 'org-main', 'club-main',
          '${membershipId}', '${profileId}', 'organizer', 'active',
          'profile-owner', 1, 1
        );
      `);
    }
    const event = await createConfirmedEvent(database, {
      coOrganizerProfileIds,
      title: "Budgeted maximum public hosts and artwork",
    });
    const initial = await readOrganizerPublicationWorkspace(
      database,
      ownerIdentity,
      event.id,
    );
    const selectedHostProfileIds = [
      "profile-owner",
      ...coOrganizerProfileIds,
    ];
    assert.equal(selectedHostProfileIds.length, 13);

    const detailsCounter = countedBinding(database);
    assert.equal(
      await ensureDatabaseInvariants(detailsCounter.binding),
      "ready",
    );
    assert.equal(
      (
        await authorizeOrganizerAccess(
          detailsCounter.binding,
          ownerIdentity,
          { initialOwnerEmail: null },
        )
      ).role,
      "owner",
    );
    const ready = await saveDetails(
      detailsCounter.binding,
      ownerIdentity,
      initial,
      {
        artworkAssetId: "asset-event-artwork",
        publicHostsEnabled: true,
        selectedHostProfileIds,
      },
    );
    assert.equal(ready.details.artworkAssetId, "asset-event-artwork");
    assertWithinStatementCap(
      detailsCounter,
      "maximum public hosts and artwork details",
    );
    assert.deepEqual(detailsCounter.counts(), {
      batchLengths: [14],
      statementCount: 43,
    });
    assert.equal(
      await countWhere(
        database,
        "organizer_event_public_hosts",
        "organizer_event_id = ?",
        event.id,
      ),
      13,
    );

    const publishCounter = countedBinding(database);
    assert.equal(
      await ensureDatabaseInvariants(publishCounter.binding),
      "ready",
    );
    assert.equal(
      (
        await authorizeOrganizerAccess(
          publishCounter.binding,
          ownerIdentity,
          { initialOwnerEmail: null },
        )
      ).role,
      "owner",
    );
    const published = await publicationAction(
      publishCounter.binding,
      ownerIdentity,
      ready,
      "publish",
    );
    assert.equal(published.outcome, "published");
    assertWithinStatementCap(
      publishCounter,
      "maximum public hosts and artwork publish",
    );
    assert.deepEqual(publishCounter.counts(), {
      batchLengths: [11],
      statementCount: 43,
    });
  });
});

test("conflict-authorized publication paths stay within the D1 statement cap", async (t) => {
  for (const action of ["publish", "schedule_publication"]) {
    await t.test(`Warn ${action}`, async (t) => {
      const database = await newDatabase();
      t.after(() => database.close());
      setD1Now(database, BASE_NOW);
      await createConfirmedEvent(database, {
        title: `Budgeted existing Warn ${action}`,
      });
      const draft = await createOrganizerEvent(
        database,
        ownerIdentity,
        timedDraftInput({
          title: `Budgeted Warn ${action} candidate`,
        }),
      );
      const details = await saveDetails(
        database,
        ownerIdentity,
        await readOrganizerPublicationWorkspace(
          database,
          ownerIdentity,
          draft.id,
        ),
      );
      const reason =
        "The owner documented this intentional overlap for the budget proof.";
      const confirmed = await confirmWithConflictReason(
        database,
        ownerIdentity,
        details.event,
        reason,
      );
      const ready = await readOrganizerPublicationWorkspace(
        database,
        ownerIdentity,
        confirmed.id,
      );
      const originalOverrides = await activeConflictOverrideIds(
        database,
        confirmed.id,
      );
      const counter = countedBinding(database);
      assert.equal(await ensureDatabaseInvariants(counter.binding), "ready");
      const result =
        action === "publish"
          ? await publicationAction(
              counter.binding,
              ownerIdentity,
              ready,
              "publish",
            )
          : await schedulePublication(
              counter.binding,
              ownerIdentity,
              ready,
              "2030-01-02T09:00",
            );
      assert.equal(
        result.outcome,
        action === "publish"
          ? "published"
          : "publication_scheduled",
      );
      assertWithinStatementCap(counter, `Warn ${action}`);
      assert.deepEqual(
        counter.counts(),
        action === "publish"
          ? { batchLengths: [13], statementCount: 46 }
          : { batchLengths: [13], statementCount: 46 },
      );
      const intent = await row(
        database,
        `SELECT id
         FROM organizer_schedule_write_intents
         WHERE organizer_event_id = ?
           AND operation = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        confirmed.id,
        action,
      );
      await assertPublicationConflictArtifactsRebound(database, {
        actorProfileId: "profile-owner",
        eventId: confirmed.id,
        intentId: intent.id,
        originalOverrideIds: originalOverrides,
        reason,
        reviewRequestId: null,
      });
    });
  }

  await t.test("Administrator-approved immediate publication", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    await setConflictPolicy(database, "require_admin_approval");
    await createConfirmedEvent(database, {
      title: "Budgeted existing approved reservation",
    });
    const draft = await createOrganizerEvent(
      database,
      administratorIdentity,
      timedDraftInput({
        coOrganizerProfileIds: ["profile-owner"],
        primaryOrganizerProfileId: "profile-admin",
        title: "Budgeted approved publication candidate",
      }),
    );
    const details = await saveDetails(
      database,
      administratorIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        administratorIdentity,
        draft.id,
      ),
      {
        artworkAssetId: "asset-event-artwork",
      },
    );
    const pending = await performOrganizerLifecycleAction(
      database,
      administratorIdentity,
      draft.id,
      {
        action: "confirm",
        expectedContentVersion: details.event.contentVersion,
        expectedScheduleVersion: details.event.scheduleVersion,
        reason: "The Administrator requests the budgeted approval.",
      },
    );
    await decideOrganizerConflictReview(
      database,
      ownerIdentity,
      pending.reviewRequestId,
      {
        decision: "approve",
        note: "Approved for the publication statement-budget proof.",
      },
    );
    const ready = await readOrganizerPublicationWorkspace(
      database,
      administratorIdentity,
      draft.id,
    );
    const originalOverrides = await activeConflictOverrideIds(
      database,
      draft.id,
    );
    const counter = countedBinding(database);
    assert.equal(await ensureDatabaseInvariants(counter.binding), "ready");
    const routeActor = await authorizeOrganizerAccess(
      counter.binding,
      administratorIdentity,
    );
    assert.equal(routeActor.profileId, "profile-admin");
    const published = await publicationAction(
      counter.binding,
      administratorIdentity,
      ready,
      "publish",
    );
    assert.equal(published.outcome, "published");
    assertWithinStatementCap(
      counter,
      "Administrator-approved immediate publication",
    );
    assert.deepEqual(counter.counts(), {
      batchLengths: [15],
      statementCount: 49,
    });
    const intent = await row(
      database,
      `SELECT id
       FROM organizer_schedule_write_intents
       WHERE organizer_event_id = ?
         AND operation = 'publish'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      draft.id,
    );
    await assertPublicationConflictArtifactsRebound(database, {
      actorProfileId: "profile-admin",
      eventId: draft.id,
      intentId: intent.id,
      originalOverrideIds: originalOverrides,
      reason: "Approved version-bound conflict review",
      reviewRequestId: pending.reviewRequestId,
    });
  });

  await t.test("Administrator-approved due reconciliation", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    await setConflictPolicy(database, "require_admin_approval");
    await createConfirmedEvent(database, {
      title: "Budgeted existing due reservation",
    });
    const draft = await createOrganizerEvent(
      database,
      administratorIdentity,
      timedDraftInput({
        coOrganizerProfileIds: ["profile-owner"],
        primaryOrganizerProfileId: "profile-admin",
        title: "Budgeted approved due candidate",
      }),
    );
    const details = await saveDetails(
      database,
      administratorIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        administratorIdentity,
        draft.id,
      ),
      {
        artworkAssetId: "asset-event-artwork",
      },
    );
    const pending = await performOrganizerLifecycleAction(
      database,
      administratorIdentity,
      draft.id,
      {
        action: "confirm",
        expectedContentVersion: details.event.contentVersion,
        expectedScheduleVersion: details.event.scheduleVersion,
        reason: "The Administrator requests the due-job approval.",
      },
    );
    await decideOrganizerConflictReview(
      database,
      ownerIdentity,
      pending.reviewRequestId,
      {
        decision: "approve",
        note: "Approved for the due-job statement-budget proof.",
      },
    );
    const ready = await readOrganizerPublicationWorkspace(
      database,
      administratorIdentity,
      draft.id,
    );
    const scheduled = await schedulePublication(
      database,
      administratorIdentity,
      ready,
      "2030-01-02T09:00",
    );
    const dueAt =
      scheduled.workspace.pendingJob.requestedPublicationAtUtc;
    const originalOverrides = await activeConflictOverrideIds(
      database,
      draft.id,
    );
    setD1Now(database, dueAt);
    const counter = countedBinding(database);
    assert.equal(await ensureDatabaseInvariants(counter.binding), "ready");
    const reconciled = await reconcileDueOrganizerPublications(
      counter.binding,
    );
    assert.deepEqual(reconciled, {
      executed: 1,
      inspected: 1,
      invalidated: 0,
      transientFailures: 0,
    });
    assertWithinStatementCap(
      counter,
      "Administrator-approved due reconciliation",
    );
    assert.deepEqual(counter.counts(), {
      batchLengths: [16],
      statementCount:
        ORGANIZER_PUBLICATION_RECONCILIATION_STATEMENT_MAXIMUM + 2,
    });
    assert.equal(
      await countWhere(
        database,
        "notifications",
        `type = 'event_published'
         AND recipient_profile_id = 'profile-owner'
         AND json_extract(payload_json, '$.eventId') = ?`,
        draft.id,
      ),
      1,
      "the non-actor co-organizer receives the due-publication notification",
    );
    const intent = await row(
      database,
      `SELECT id
       FROM organizer_schedule_write_intents
       WHERE organizer_event_id = ?
         AND operation = 'reconcile_publication'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      draft.id,
    );
    await assertPublicationConflictArtifactsRebound(database, {
      actorProfileId: "profile-admin",
      eventId: draft.id,
      intentId: intent.id,
      originalOverrideIds: originalOverrides,
      reason: "Approved version-bound conflict review",
      reviewRequestId: pending.reviewRequestId,
    });
  });
});

test("removed, demoted, suspended, and policy-disabled scheduling actors invalidate due jobs without publishing", async (t) => {
  await t.test("removed Administrator", async () => {
    await authorizerInvalidationCase({
      authorizer: administratorIdentity,
      mutate: async (database) => {
        await updateTeamMember(
          database,
          ownerIdentity,
          "membership-admin",
          { role: "administrator", status: "revoked" },
          BASE_NOW + 500,
        );
      },
      expectedNotificationRecipients: [
        "profile-organizer",
        "profile-owner",
      ],
      primaryOrganizerProfileId: "profile-organizer",
    });
  });

  await t.test("demoted Administrator", async () => {
    await authorizerInvalidationCase({
      authorizer: administratorIdentity,
      mutate: async (database) => {
        await updateTeamMember(
          database,
          ownerIdentity,
          "membership-admin",
          {
            clubIds: ["club-main"],
            role: "organizer",
            status: "active",
          },
          BASE_NOW + 500,
        );
      },
      expectedNotificationRecipients: [
        "profile-organizer",
        "profile-owner",
      ],
      primaryOrganizerProfileId: "profile-organizer",
    });
  });

  await t.test("suspended Organizer profile", async () => {
    await authorizerInvalidationCase({
      authorizer: organizerIdentity,
      enableOrganizerPolicy: true,
      mutate: async (database) => {
        database.exec(`
          UPDATE profiles
          SET status = 'suspended', updated_at = updated_at + 1
          WHERE id = 'profile-organizer';
        `);
      },
      expectedNotificationRecipients: ["profile-owner"],
      primaryOrganizerProfileId: "profile-organizer",
    });
  });

  await t.test("Organizer self-publish policy disabled", async () => {
    await authorizerInvalidationCase({
      authorizer: organizerIdentity,
      enableOrganizerPolicy: true,
      mutate: async (database) => {
        await updateOrganizationPublicationPolicy(database, ownerIdentity, {
          organizerSelfPublishEnabled: false,
        });
      },
      expectedNotificationRecipients: [
        "profile-organizer",
        "profile-owner",
      ],
      primaryOrganizerProfileId: "profile-organizer",
    });
  });
});

test("due publication deterministically invalidates when selected artwork loses public eligibility", async (t) => {
  const eligibilityChanges = [
    {
      label: "rights approval revoked",
      update:
        "UPDATE media_assets SET rights_status = 'unconfirmed' WHERE id = 'asset-event-artwork'",
    },
    {
      label: "participant consent revoked",
      update:
        "UPDATE media_assets SET participant_consent_status = 'unconfirmed' WHERE id = 'asset-event-artwork'",
    },
    {
      label: "required credit removed",
      update:
        "UPDATE media_assets SET credit = NULL WHERE id = 'asset-event-artwork'",
    },
    {
      label: "informative alt text removed",
      update:
        "UPDATE media_assets SET alt_text = NULL WHERE id = 'asset-event-artwork'",
    },
    {
      label: "asset soft-deleted",
      update:
        "UPDATE media_assets SET deleted_at = 1893456000000 WHERE id = 'asset-event-artwork'",
    },
  ];

  for (const eligibilityChange of eligibilityChanges) {
    await t.test(eligibilityChange.label, async (t) => {
      const database = await newDatabase();
      t.after(() => database.close());
      setD1Now(database, BASE_NOW);
      const event = await createConfirmedEvent(database, {
        title: `Due artwork ${eligibilityChange.label}`,
      });
      const detailed = await saveDetails(
        database,
        ownerIdentity,
        await readOrganizerPublicationWorkspace(
          database,
          ownerIdentity,
          event.id,
        ),
        { artworkAssetId: "asset-event-artwork" },
      );
      const scheduled = await schedulePublication(
        database,
        ownerIdentity,
        detailed,
        "2030-01-02T09:00",
      );
      const dueAt =
        scheduled.workspace.pendingJob.requestedPublicationAtUtc;
      database.exec(eligibilityChange.update);
      setD1Now(database, dueAt);

      assert.deepEqual(
        await reconcileDueOrganizerPublications(database, { now: dueAt }),
        {
          executed: 0,
          inspected: 1,
          invalidated: 1,
          transientFailures: 0,
        },
      );
      const after = await getOrganizerEvent(
        database,
        ownerIdentity,
        event.id,
      );
      assert.equal(after.publicationStatus, "unpublished");
      assert.equal(
        await countWhere(
          database,
          "organizer_event_publication_jobs",
          "organizer_event_id = ? AND state = 'invalidated'",
          event.id,
        ),
        1,
      );
      assert.equal(
        await countWhere(
          database,
          "notifications",
          `type = 'publication_failed'
           AND json_extract(payload_json, '$.eventId') = ?`,
          event.id,
        ),
        1,
      );
      assert.equal(
        (
          await activeEventArtworkUsages(database, event.id)
        ).some(({ publication_scope }) => publication_scope === "published"),
        false,
      );
    });
  }

  await t.test("eligibility revoked after due preflight is mapped and invalidated atomically", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const event = await createConfirmedEvent(database, {
      title: "Due artwork eligibility race",
    });
    const detailed = await saveDetails(
      database,
      ownerIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        ownerIdentity,
        event.id,
      ),
      { artworkAssetId: "asset-event-artwork" },
    );
    const scheduled = await schedulePublication(
      database,
      ownerIdentity,
      detailed,
      "2030-01-02T09:00",
    );
    const dueAt =
      scheduled.workspace.pendingJob.requestedPublicationAtUtc;
    setD1Now(database, dueAt);
    const originalBatch = database.batch.bind(database);
    let intercepted = false;
    database.batch = async (statements) => {
      if (!intercepted) {
        intercepted = true;
        database.exec(`
          UPDATE media_assets
          SET rights_status = 'unconfirmed',
              updated_at = ${dueAt}
          WHERE id = 'asset-event-artwork';
        `);
      }
      return originalBatch(statements);
    };
    let reconciled;
    try {
      reconciled = await reconcileDueOrganizerPublications(database, {
        now: dueAt,
      });
    } finally {
      database.batch = originalBatch;
    }
    assert.equal(intercepted, true);
    assert.deepEqual(reconciled, {
      executed: 0,
      inspected: 1,
      invalidated: 1,
      transientFailures: 0,
    });
    const after = await getOrganizerEvent(database, ownerIdentity, event.id);
    assert.equal(after.publicationStatus, "unpublished");
    const job = await row(
      database,
      `SELECT state, failure_code
       FROM organizer_event_publication_jobs
       WHERE organizer_event_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      event.id,
    );
    assert.deepEqual(
      {
        failure_code: job.failure_code,
        state: job.state,
      },
      {
        failure_code: "publication_check_failed",
        state: "invalidated",
      },
    );
    assert.equal(
      (await activeEventArtworkUsages(database, event.id)).some(
        ({ publication_scope }) => publication_scope === "published",
      ),
      false,
    );
    assert.equal(
      await countWhere(
        database,
        "notifications",
        `type = 'publication_failed'
         AND json_extract(payload_json, '$.eventId') = ?`,
        event.id,
      ),
      1,
    );
  });
});

test("Organizer publication is default-denied and succeeds only after the narrow policy is enabled", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  setD1Now(database, BASE_NOW);
  const event = await createConfirmedEvent(database, {
    primaryOrganizerProfileId: "profile-organizer",
    title: "Organizer self-publish",
  });
  const ready = await saveDetails(
    database,
    organizerIdentity,
    await readOrganizerPublicationWorkspace(
      database,
      organizerIdentity,
      event.id,
    ),
  );
  const before = await publicationResidue(database, event.id);
  await assert.rejects(
    publicationAction(database, organizerIdentity, ready, "publish"),
    (error) => error?.status === 403,
  );
  assert.deepEqual(await publicationResidue(database, event.id), before);

  await updateOrganizationPublicationPolicy(database, ownerIdentity, {
    organizerSelfPublishEnabled: true,
  });
  const enabledWorkspace = await readOrganizerPublicationWorkspace(
    database,
    organizerIdentity,
    event.id,
  );
  assert.equal(enabledWorkspace.permissions.canPublish, true);
  const published = await publicationAction(
    database,
    organizerIdentity,
    enabledWorkspace,
    "publish",
  );
  assert.equal(published.workspace.event.publicationStatus, "published");
});

test("nonparticipant and unassigned Organizers receive a publication workspace with every mutation permission denied", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  setD1Now(database, BASE_NOW);
  const event = await createConfirmedEvent(database, {
    title: "Read-only publication controls",
  });
  await saveDetails(
    database,
    ownerIdentity,
    await readOrganizerPublicationWorkspace(
      database,
      ownerIdentity,
      event.id,
    ),
  );

  for (const identity of [viewerIdentity, unassignedOrganizerIdentity]) {
    const record = await getOrganizerEventRecord(
      database,
      identity,
      event.id,
    );
    assert.equal(record.id, event.id);
    assert.equal(record.source, "manual");
    assert.equal("organizationId" in record, false);
    const workspace = await readOrganizerPublicationWorkspace(
      database,
      identity,
      event.id,
    );
    assert.deepEqual(workspace.permissions, {
      canCancelScheduledPublication: false,
      canEditPublicDetails: false,
      canPreview: false,
      canPublish: false,
      canSchedule: false,
      canUnpublish: false,
    });
    assert.equal(
      await readOrganizerPublicationPreview(database, identity, event.id),
      null,
    );
  }
});

test("Meetup confirmation is exact, host selection is consent-gated, and public DTOs contain no private values", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  setD1Now(database, BASE_NOW);
  const event = await createConfirmedEvent(database, {
    coOrganizerProfileIds: ["profile-organizer"],
    meetupEventUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/123456789/?tracking=private",
    privateMeetingDetails: "PRIVATE_MEETING_SENTINEL",
    privateNotes: "PRIVATE_NOTES_SENTINEL",
    title: "Consent and URL gates",
  });
  const initial = await readOrganizerPublicationWorkspace(
    database,
    ownerIdentity,
    event.id,
  );
  assert.deepEqual(
    initial.hostOptions.map((host) => host.profileId),
    ["profile-owner"],
  );

  await assert.rejects(
    saveDetails(database, ownerIdentity, initial, {
      confirmMeetupEventUrl: false,
      meetupEventUrl: event.meetupEventUrl,
      rsvpMode: "meetup",
    }),
    isInputValidationError,
  );
  await assert.rejects(
    saveDetails(database, ownerIdentity, initial, {
      confirmMeetupEventUrl: true,
      meetupEventUrl: "https://www.meetup.com/vancouver-meetup-group/",
      rsvpMode: "meetup",
    }),
    isInputValidationError,
  );
  await assert.rejects(
    saveDetails(database, ownerIdentity, initial, {
      publicHostsEnabled: true,
      selectedHostProfileIds: ["profile-organizer"],
    }),
    isInputValidationError,
  );

  const saved = await saveDetails(database, ownerIdentity, initial, {
    confirmMeetupEventUrl: true,
    meetupEventUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/123456789/?tracking=private",
    publicHostsEnabled: true,
    rsvpMode: "meetup",
    selectedHostProfileIds: ["profile-owner"],
  });
  assert.equal(saved.details.meetupUrlConfirmed, true);
  assert.equal(
    saved.event.meetupEventUrl,
    "https://www.meetup.com/vancouver-meetup-group/events/123456789/",
  );
  const preview = await readOrganizerPublicationPreview(
    database,
    ownerIdentity,
    event.id,
  );
  assert.deepEqual(
    preview?.organizers.map((organizer) => organizer.displayName),
    ["Owner"],
  );
  const serializedPreview = JSON.stringify(preview);
  for (const forbidden of [
    "PRIVATE_MEETING_SENTINEL",
    "PRIVATE_NOTES_SENTINEL",
    "@example.test",
    "profile-owner",
    "profile-organizer",
  ]) {
    assert.equal(serializedPreview.includes(forbidden), false);
  }

  const published = await publicationAction(
    database,
    ownerIdentity,
    saved,
    "publish",
  );
  const publicEvent = await getPublicEventBySlug(database, {
    organizationId: "org-main",
    slug: published.workspace.event.slug,
  });
  assert.equal(
    publicEvent?.rsvpUrl,
    "https://www.meetup.com/vancouver-meetup-group/events/123456789/",
  );
  assert.equal(JSON.stringify(publicEvent).includes("PRIVATE_"), false);

  const changed = await saveDetails(
    database,
    ownerIdentity,
    published.workspace,
    {
      confirmMeetupEventUrl: false,
      meetupEventUrl:
        "https://www.meetup.com/vancouver-meetup-group/events/987654321/",
      publicHostsEnabled: false,
      rsvpMode: "coming_soon",
      selectedHostProfileIds: [],
    },
  );
  assert.equal(changed.details.meetupUrlConfirmed, false);
  assert.equal(
    (
      await row(
        database,
        `SELECT confirmed_meetup_event_url
         FROM organizer_event_public_details
         WHERE organizer_event_id = ?`,
        event.id,
      )
    ).confirmed_meetup_event_url,
    null,
  );
});

test("published events stay visible while guarded or revoked public hosts never leak", async (t) => {
  await t.test(
    "an unsafe canonical display-name mutation is rejected without changing the published host",
    async (t) => {
      const database = await newDatabase();
      t.after(() => database.close());
      setD1Now(database, BASE_NOW);
      await confirmPublicOrganizerAttribution(database, BASE_NOW - 100);
      const event = await createConfirmedEvent(database, {
        coOrganizerProfileIds: ["profile-organizer"],
        title: "Unsafe public host regression guard",
      });
      const initial = await readOrganizerPublicationWorkspace(
        database,
        ownerIdentity,
        event.id,
      );
      assert.ok(
        initial.hostOptions.some(
          (host) => host.profileId === "profile-organizer",
        ),
      );
      const ready = await saveDetails(database, ownerIdentity, initial, {
        publicHostsEnabled: true,
        selectedHostProfileIds: ["profile-organizer"],
      });
      const published = await publicationAction(
        database,
        ownerIdentity,
        ready,
        "publish",
      );
      assert.equal(published.workspace.event.publicationStatus, "published");

      await assert.rejects(
        database
          .prepare(
            `UPDATE profiles
             SET display_name = normalized_email,
                 updated_at = updated_at + 1
             WHERE id = 'profile-organizer'`,
          )
          .run(),
        /phase6_public_attribution_profile_guard/u,
      );
      const selected = await row(
        database,
        `SELECT count(*) AS selected_count
         FROM organizer_event_public_hosts
         WHERE organization_id = 'org-main'
           AND organizer_event_id = ?`,
        event.id,
      );
      assert.equal(selected.selected_count, 1);
      await ensureReady(database);

      const publicEvent = await getPublicEventBySlug(database, {
        organizationId: "org-main",
        slug: published.workspace.event.slug,
      });
      assert.ok(publicEvent, "a rejected host mutation must not unpublish");
      assert.deepEqual(
        publicEvent.organizers.map((host) => host.displayName),
        ["Organizer"],
      );
      assert.equal(JSON.stringify(publicEvent).includes("@example.test"), false);
      const preview = await readOrganizerPublicationPreview(
        database,
        ownerIdentity,
        event.id,
      );
      assert.ok(preview, "a rejected mutation must not hide the preview");
      assert.deepEqual(
        preview.organizers.map((host) => host.displayName),
        ["Organizer"],
      );
    },
  );

  await t.test(
    "authoritative public-attribution revocation suppresses the host without unpublishing",
    async (t) => {
      const database = await newDatabase();
      t.after(() => database.close());
      setD1Now(database, BASE_NOW);
      const confirmed = await confirmPublicOrganizerAttribution(
        database,
        BASE_NOW - 100,
      );
      const event = await createConfirmedEvent(database, {
        coOrganizerProfileIds: ["profile-organizer"],
        title: "Revoked public host attribution",
      });
      const ready = await saveDetails(
        database,
        ownerIdentity,
        await readOrganizerPublicationWorkspace(
          database,
          ownerIdentity,
          event.id,
        ),
        {
          publicHostsEnabled: true,
          selectedHostProfileIds: ["profile-organizer"],
        },
      );
      const published = await publicationAction(
        database,
        ownerIdentity,
        ready,
        "publish",
      );
      await revokeOrganizerPublicAttribution(
        database,
        organizerIdentity,
        {
          expectedAttributionDraftVersion:
            confirmed.publicAttributionDraftVersion,
          expectedAttributionPublishedVersion:
            confirmed.publicAttributionPublishedVersion,
        },
        BASE_NOW + 1,
      );
      assert.equal(
        (
          await row(
            database,
            `SELECT count(*) AS selected_count
             FROM organizer_event_public_hosts
             WHERE organization_id = 'org-main'
               AND organizer_event_id = ?`,
            event.id,
          )
        ).selected_count,
        0,
      );
      await ensureReady(database);
      const publicEvent = await getPublicEventBySlug(database, {
        organizationId: "org-main",
        slug: published.workspace.event.slug,
      });
      assert.ok(publicEvent, "host revocation must not unpublish the event");
      assert.deepEqual(publicEvent.organizers, []);
      const preview = await readOrganizerPublicationPreview(
        database,
        ownerIdentity,
        event.id,
      );
      assert.ok(preview, "host revocation must not hide the preview");
      assert.deepEqual(preview.organizers, []);
    },
  );

  await t.test(
    "membership suspension after authoritative co-organizer removal",
    async (t) => {
      const database = await newDatabase();
      t.after(() => database.close());
      setD1Now(database, BASE_NOW);
      await confirmPublicOrganizerAttribution(database, BASE_NOW - 100);
      const event = await createConfirmedEvent(database, {
        coOrganizerProfileIds: ["profile-organizer"],
        title: "Public host membership suspension",
      });
      const ready = await saveDetails(
        database,
        ownerIdentity,
        await readOrganizerPublicationWorkspace(
          database,
          ownerIdentity,
          event.id,
        ),
        {
          publicHostsEnabled: true,
          selectedHostProfileIds: ["profile-organizer"],
        },
      );
      const published = await publicationAction(
        database,
        ownerIdentity,
        ready,
        "publish",
      );
      await editCanonicalEvent(database, event, {
        coOrganizerProfileIds: [],
      });
      await updateTeamMember(
        database,
        ownerIdentity,
        "membership-organizer",
        { role: "organizer", status: "suspended" },
        BASE_NOW + 500,
      );

      await ensureReady(database);
      const publicEvent = await getPublicEventBySlug(database, {
        organizationId: "org-main",
        slug: published.workspace.event.slug,
      });
      assert.ok(publicEvent);
      assert.deepEqual(publicEvent.organizers, []);
      const preview = await readOrganizerPublicationPreview(
        database,
        ownerIdentity,
        event.id,
      );
      assert.ok(preview);
      assert.deepEqual(preview.organizers, []);
    },
  );
});

test("canonical Meetup URL edits clear confirmation and never expose a new unconfirmed destination", async (t) => {
  const oldUrl =
    "https://www.meetup.com/vancouver-meetup-group/events/111111111/";
  const newUrl =
    "https://www.meetup.com/vancouver-meetup-group/events/222222222/";

  await t.test("a private preview-configured event falls back to an honest no-link RSVP state", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const event = await createConfirmedEvent(database, {
      meetupEventUrl: oldUrl,
      title: "Private Meetup confirmation invalidation",
    });
    const ready = await saveDetails(
      database,
      ownerIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        ownerIdentity,
        event.id,
      ),
      {
        confirmMeetupEventUrl: true,
        meetupEventUrl: oldUrl,
        rsvpMode: "meetup",
      },
    );
    assert.equal(ready.permissions.canPreview, true);
    const edited = await editCanonicalEvent(database, ready.event, {
      meetupEventUrl: newUrl,
    });
    assert.equal(edited.publicationStatus, "private");
    const details = await row(
      database,
      `SELECT confirmed_meetup_event_url, rsvp_mode
       FROM organizer_event_public_details
       WHERE organizer_event_id = ?`,
      event.id,
    );
    assert.equal(details.confirmed_meetup_event_url, null);
    assert.equal(details.rsvp_mode, "coming_soon");
    const workspace = await readOrganizerPublicationWorkspace(
      database,
      ownerIdentity,
      event.id,
    );
    assert.equal(workspace.readiness.ready, true);
    assert.equal(workspace.permissions.canPreview, true);
    assert.equal(workspace.details.rsvpMode, "coming_soon");
    const preview = await readOrganizerPublicationPreview(
      database,
      ownerIdentity,
      event.id,
    );
    assert.ok(preview);
    assert.equal(preview.rsvpUrl, null);
    assert.doesNotMatch(JSON.stringify(preview), /222222222/);
  });

  await t.test("a published edit keeps the page live with the honest no-link alternative", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const event = await createConfirmedEvent(database, {
      meetupEventUrl: oldUrl,
      title: "Published Meetup confirmation invalidation",
    });
    const ready = await saveDetails(
      database,
      ownerIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        ownerIdentity,
        event.id,
      ),
      {
        confirmMeetupEventUrl: true,
        meetupEventUrl: oldUrl,
        rsvpMode: "meetup",
      },
    );
    const published = await publicationAction(
      database,
      ownerIdentity,
      ready,
      "publish",
    );
    const edited = await editCanonicalEvent(
      database,
      published.workspace.event,
      { meetupEventUrl: newUrl },
    );
    assert.equal(edited.publicationStatus, "published");
    const workspace = await readOrganizerPublicationWorkspace(
      database,
      ownerIdentity,
      event.id,
    );
    assert.equal(workspace.details.rsvpMode, "coming_soon");
    assert.equal(workspace.details.meetupUrlConfirmed, false);
    assert.equal(workspace.readiness.ready, true);
    const publicEvent = await getPublicEventBySlug(database, {
      organizationId: "org-main",
      slug: published.workspace.event.slug,
    });
    assert.ok(publicEvent);
    assert.equal(publicEvent.rsvpUrl, null);
    assert.doesNotMatch(JSON.stringify(publicEvent), /111111111|222222222/);
    const details = await row(
      database,
      `SELECT confirmed_meetup_event_url, rsvp_mode
       FROM organizer_event_public_details
       WHERE organizer_event_id = ?`,
      event.id,
    );
    assert.equal(details.confirmed_meetup_event_url, null);
    assert.equal(details.rsvp_mode, "coming_soon");
    await ensureReady(database);
  });
});

test("canonical Phase 4 event seams preserve publication, jobs, history, and public isolation", async (t) => {
  await t.test("an unpublished event edit stays unpublished and keeps its stable slug", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const { workspace: ready } = await createReadyConfirmedEvent(
      database,
      "Unpublished canonical edit",
    );
    const published = await publicationAction(
      database,
      ownerIdentity,
      ready,
      "publish",
    );
    const unpublished = await publicationAction(
      database,
      ownerIdentity,
      published.workspace,
      "unpublish",
    );
    const before = await canonicalMutationCounts(
      database,
      unpublished.workspace.event.id,
    );
    const edited = await editCanonicalEvent(
      database,
      unpublished.workspace.event,
      { title: "Unpublished canonical edit revised" },
    );
    const after = await canonicalMutationCounts(database, edited.id);
    assert.equal(edited.publicationStatus, "unpublished");
    assert.equal(edited.slug, unpublished.workspace.event.slug);
    assert.equal(edited.scheduleVersion, unpublished.workspace.event.scheduleVersion);
    assert.equal(after.revisions, before.revisions + 1);
    assert.equal(after.audits, before.audits + 1);
    assert.equal(
      await getPublicEventBySlug(database, {
        organizationId: "org-main",
        slug: edited.slug,
      }),
      null,
    );
  });

  await t.test("a published event edit stays published and updates canonical public facts", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const { workspace: ready } = await createReadyConfirmedEvent(
      database,
      "Published canonical edit",
    );
    const published = await publicationAction(
      database,
      ownerIdentity,
      ready,
      "publish",
    );
    const stateBefore = await publicationState(
      database,
      published.workspace.event.id,
    );
    const edited = await editCanonicalEvent(
      database,
      published.workspace.event,
      {
        description:
          "The updated canonical description appears on the same public event.",
        summary: "Updated canonical public summary.",
        title: "Published canonical edit revised",
      },
    );
    assert.equal(edited.publicationStatus, "published");
    assert.equal(edited.slug, published.workspace.event.slug);
    const publicEvent = await getPublicEventBySlug(database, {
      organizationId: "org-main",
      slug: edited.slug,
    });
    assert.equal(publicEvent?.title, "Published canonical edit revised");
    assert.equal(
      publicEvent?.summary,
      "Updated canonical public summary.",
    );
    assert.equal(
      (await publicationState(database, edited.id)).first_published_at,
      stateBefore.first_published_at,
    );
  });

  await t.test("published canonical copy rejects normalized legal-claim variants without residue", async (t) => {
    const variants = [
      ["three spaces", "Registered   charity gathering"],
      ["tab and newline", "Registered\t\ncharity gathering"],
      ["nonbreaking space", "Registered\u00a0charity gathering"],
      ["nonbreaking hyphen", "Registered\u2011charity gathering"],
      ["en dash", "Registered\u2013charity gathering"],
      ["comma punctuation", "Registered, charity gathering"],
      ["parentheses", "Registered (charity) gathering"],
      ["slash punctuation", "Registered/charity gathering"],
      ["period punctuation", "Registered.charity gathering"],
      ["underscore punctuation", "Registered_charity gathering"],
      ["middle dot punctuation", "Registered\u00b7charity gathering"],
      ["zero-width space", "Registered\u200bcharity gathering"],
      ["zero-width non-joiner", "Registered char\u200city gathering"],
      ["zero-width joiner", "Registered char\u200dity gathering"],
      ["word joiner", "Registered\u2060charity gathering"],
      ["byte-order mark", "Registered char\ufeffity gathering"],
      ["directional isolate", "Registered\u2066charity\u2069 gathering"],
    ];
    for (const [label, title] of variants) {
      await t.test(label, async (t) => {
        const database = await newDatabase();
        t.after(() => database.close());
        setD1Now(database, BASE_NOW);
        const { workspace: ready } = await createReadyConfirmedEvent(
          database,
          `Legal normalization ${label}`,
        );
        const published = await publicationAction(
          database,
          ownerIdentity,
          ready,
          "publish",
        );
        const current = await getOrganizerEvent(
          database,
          ownerIdentity,
          published.workspace.event.id,
        );
        const before = {
          mutations: await canonicalMutationCounts(database, current.id),
          publicEvent: await getPublicEventBySlug(database, {
            organizationId: "org-main",
            slug: current.slug,
          }),
        };
        await assert.rejects(
          updateOrganizerEvent(
            database,
            ownerIdentity,
            current.id,
            current.contentVersion,
            canonicalEditInput(current, { title }),
            current.scheduleVersion,
          ),
          (error) =>
            isInputValidationError(error) &&
            error.issues?.some(
              (entry) =>
                entry.path === "title" &&
                entry.code === "protected_legal_claim",
            ),
        );
        assert.deepEqual(
          await canonicalMutationCounts(database, current.id),
          before.mutations,
        );
        assert.equal(
          (
            await getOrganizerEvent(
              database,
              ownerIdentity,
              current.id,
            )
          ).title,
          before.publicEvent?.title,
        );
        assert.deepEqual(
          await getPublicEventBySlug(database, {
            organizationId: "org-main",
            slug: current.slug,
          }),
          before.publicEvent,
        );
        await ensureReady(database);
      });
    }
  });

  await t.test("a scheduled edit rejects stale versions, then invalidates the exact job and becomes unpublished", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const { workspace: ready } = await createReadyConfirmedEvent(
      database,
      "Scheduled canonical edit",
    );
    const scheduled = await schedulePublication(
      database,
      ownerIdentity,
      ready,
      "2030-01-02T09:00",
    );
    const job = await pendingJobRow(
      database,
      scheduled.workspace.event.id,
    );
    const before = await canonicalMutationCounts(
      database,
      scheduled.workspace.event.id,
    );
    const scheduledEvent = await getOrganizerEvent(
      database,
      ownerIdentity,
      scheduled.workspace.event.id,
    );
    await assert.rejects(
      updateOrganizerEvent(
        database,
        ownerIdentity,
        scheduled.workspace.event.id,
        scheduled.workspace.event.contentVersion - 1,
        canonicalEditInput(scheduledEvent, {
          title: "Stale scheduled edit",
        }),
        scheduled.workspace.event.scheduleVersion,
      ),
      (error) => error?.status === 409,
    );
    assert.deepEqual(
      await canonicalMutationCounts(
        database,
        scheduled.workspace.event.id,
      ),
      before,
    );
    assert.equal(
      (await pendingJobRow(database, scheduled.workspace.event.id)).id,
      job.id,
    );

    const edited = await editCanonicalEvent(
      database,
      scheduled.workspace.event,
      { title: "Scheduled canonical edit revised" },
    );
    assert.equal(edited.publicationStatus, "unpublished");
    const retiredJob = await row(
      database,
      `SELECT state, failure_code
       FROM organizer_event_publication_jobs
       WHERE id = ?`,
      job.id,
    );
    assert.equal(retiredJob.state, "invalidated");
    assert.equal(retiredJob.failure_code, "canonical_event_changed");
    assert.equal(
      await countWhere(
        database,
        "organizer_event_publication_jobs",
        "organizer_event_id = ? AND state = 'pending'",
        edited.id,
      ),
      0,
    );
    assert.equal(
      await getPublicEventBySlug(database, {
        organizationId: "org-main",
        slug: edited.slug,
      }),
      null,
    );
  });

  await t.test("cancelling a published event preserves its truthful public page", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const { workspace: ready } = await createReadyConfirmedEvent(
      database,
      "Published cancellation",
    );
    const published = await publicationAction(
      database,
      ownerIdentity,
      ready,
      "publish",
    );
    const cancelled = await lifecycleAction(
      database,
      published.workspace.event,
      "cancel",
    );
    assert.equal(cancelled.planningStatus, "cancelled");
    assert.equal(cancelled.publicationStatus, "published");
    assert.ok(
      (await publicationState(database, cancelled.id)).public_cancellation_at,
    );
    assert.equal(
      (
        await getPublicEventBySlug(database, {
          organizationId: "org-main",
          slug: cancelled.slug,
        })
      )?.status,
      "cancelled",
    );
  });

  await t.test("cancelling a scheduled event cancels its job and never creates a public page", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const { workspace: ready } = await createReadyConfirmedEvent(
      database,
      "Scheduled cancellation",
    );
    const scheduled = await schedulePublication(
      database,
      ownerIdentity,
      ready,
      "2030-01-02T09:00",
    );
    const job = await pendingJobRow(
      database,
      scheduled.workspace.event.id,
    );
    const cancelled = await lifecycleAction(
      database,
      scheduled.workspace.event,
      "cancel",
    );
    assert.equal(cancelled.planningStatus, "cancelled");
    assert.equal(cancelled.publicationStatus, "unpublished");
    assert.equal((await row(
      database,
      "SELECT state FROM organizer_event_publication_jobs WHERE id = ?",
      job.id,
    )).state, "cancelled");
    assert.equal(
      await getPublicEventBySlug(database, {
        organizationId: "org-main",
        slug: cancelled.slug,
      }),
      null,
    );
  });

  await t.test("completing a previously published event keeps it in the public past", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const { event, workspace: ready } = await createReadyConfirmedEvent(
      database,
      "Published completion",
    );
    const published = await publicationAction(
      database,
      ownerIdentity,
      ready,
      "publish",
    );
    setD1Now(database, event.schedule.endsAtUtc);
    const completed = await lifecycleAction(
      database,
      published.workspace.event,
      "complete",
    );
    assert.equal(completed.planningStatus, "completed");
    assert.equal(completed.publicationStatus, "published");
    assert.equal(
      (
        await getPublicEventBySlug(database, {
          organizationId: "org-main",
          slug: completed.slug,
        })
      )?.status,
      "completed",
    );
  });

  for (const [label, initialPublication, operation] of [
    ["archive published", "published", "archive"],
    ["archive scheduled", "scheduled", "archive"],
    ["delete published", "published", "soft_delete"],
    ["delete scheduled", "scheduled", "soft_delete"],
  ]) {
    await t.test(`${label} unpublishes without leaking discovery`, async (t) => {
      const database = await newDatabase();
      t.after(() => database.close());
      setD1Now(database, BASE_NOW);
      const { workspace: ready } = await createReadyConfirmedEvent(
        database,
        `Canonical ${label}`,
      );
      const current =
        initialPublication === "published"
          ? (
              await publicationAction(
                database,
                ownerIdentity,
                ready,
                "publish",
              )
            ).workspace
          : (
              await schedulePublication(
                database,
                ownerIdentity,
                ready,
                "2030-01-02T09:00",
              )
            ).workspace;
      const changed =
        operation === "soft_delete"
          ? await softDeleteOrganizerEvent(
              database,
              ownerIdentity,
              current.event.id,
              current.event.contentVersion,
              current.event.scheduleVersion,
            )
          : await lifecycleAction(database, current.event, "archive");
      assert.equal(changed.publicationStatus, "unpublished");
      if (operation === "soft_delete") {
        assert.ok(changed.deletedAt);
      } else {
        assert.equal(changed.planningStatus, "archived");
      }
      assert.equal(
        await countWhere(
          database,
          "organizer_event_publication_jobs",
          "organizer_event_id = ? AND state = 'pending'",
          changed.id,
        ),
        0,
      );
      assert.equal(
        await getPublicEventBySlug(database, {
          organizationId: "org-main",
          slug: changed.slug,
        }),
        null,
      );
    });
  }

  await t.test("restoring a cancelled public event requires a new explicit publish", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const { workspace: ready } = await createReadyConfirmedEvent(
      database,
      "Cancelled restoration",
    );
    const published = await publicationAction(
      database,
      ownerIdentity,
      ready,
      "publish",
    );
    const cancelled = await lifecycleAction(
      database,
      published.workspace.event,
      "cancel",
    );
    const restored = await lifecycleAction(
      database,
      cancelled,
      "restore_cancelled",
    );
    assert.equal(restored.planningStatus, "confirmed");
    assert.equal(restored.publicationStatus, "unpublished");
    assert.equal(
      (await publicationState(database, restored.id)).public_cancellation_at,
      null,
    );
    assert.equal(
      await getPublicEventBySlug(database, {
        organizationId: "org-main",
        slug: restored.slug,
      }),
      null,
    );
  });
});

test("event artwork published usage follows every canonical publication lifecycle exit", async (t) => {
  async function readyArtwork(database, title) {
    const event = await createConfirmedEvent(database, { title });
    const workspace = await saveDetails(
      database,
      ownerIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        ownerIdentity,
        event.id,
      ),
      { artworkAssetId: "asset-event-artwork" },
    );
    return { event, workspace };
  }

  function publicBucket() {
    let reads = 0;
    return {
      bucket: {
        async get() {
          reads += 1;
          return {};
        },
      },
      reads: () => reads,
    };
  }

  async function assertPublishedArtworkAvailable(database, bucketState) {
    await getPublicMediaVariant(
      database,
      bucketState.bucket,
      "asset-event-artwork",
      "webp_1600",
    );
  }

  async function assertPublishedArtworkRetired(database, bucketState) {
    const readsBefore = bucketState.reads();
    await assert.rejects(
      getPublicMediaVariant(
        database,
        bucketState.bucket,
        "asset-event-artwork",
        "webp_1600",
      ),
      (error) => error?.code === "not_found" && error?.status === 404,
    );
    assert.equal(
      bucketState.reads(),
      readsBefore,
      "a retired usage must be denied before any R2 read",
    );
  }

  await t.test("unpublish retires the public usage and anonymous bytes", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const { workspace } = await readyArtwork(database, "Artwork unpublish");
    const published = await publicationAction(
      database,
      ownerIdentity,
      workspace,
      "publish",
    );
    const bucketState = publicBucket();
    await assertPublishedArtworkAvailable(database, bucketState);
    const unpublished = await publicationAction(
      database,
      ownerIdentity,
      published.workspace,
      "unpublish",
    );
    assert.equal(unpublished.workspace.event.publicationStatus, "unpublished");
    assert.deepEqual(
      (await activeEventArtworkUsages(
        database,
        unpublished.workspace.event.id,
      )).map(({ publication_scope }) => publication_scope),
      ["draft"],
    );
    await assertPublishedArtworkRetired(database, bucketState);
  });

  for (const operation of ["archive", "soft_delete"]) {
    await t.test(`${operation} retires the public usage and anonymous bytes`, async (t) => {
      const database = await newDatabase();
      t.after(() => database.close());
      setD1Now(database, BASE_NOW);
      const { workspace } = await readyArtwork(
        database,
        `Artwork ${operation}`,
      );
      const published = await publicationAction(
        database,
        ownerIdentity,
        workspace,
        "publish",
      );
      const bucketState = publicBucket();
      await assertPublishedArtworkAvailable(database, bucketState);
      const changed =
        operation === "archive"
          ? await lifecycleAction(
              database,
              published.workspace.event,
              "archive",
            )
          : await softDeleteOrganizerEvent(
              database,
              ownerIdentity,
              published.workspace.event.id,
              published.workspace.event.contentVersion,
              published.workspace.event.scheduleVersion,
            );
      assert.equal(changed.publicationStatus, "unpublished");
      assert.equal(
        (await activeEventArtworkUsages(database, changed.id)).some(
          ({ publication_scope }) => publication_scope === "published",
        ),
        false,
      );
      await assertPublishedArtworkRetired(database, bucketState);
    });
  }

  await t.test("scheduled cancellation never creates a public usage", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const { workspace } = await readyArtwork(
      database,
      "Artwork scheduled cancellation",
    );
    const scheduled = await schedulePublication(
      database,
      ownerIdentity,
      workspace,
      "2030-01-02T09:00",
    );
    assert.deepEqual(
      (await activeEventArtworkUsages(
        database,
        scheduled.workspace.event.id,
      )).map(({ publication_scope }) => publication_scope),
      ["draft"],
    );
    const bucketState = publicBucket();
    await assertPublishedArtworkRetired(database, bucketState);
    const cancelled = await lifecycleAction(
      database,
      scheduled.workspace.event,
      "cancel",
    );
    assert.equal(cancelled.publicationStatus, "unpublished");
    assert.equal(
      (await activeEventArtworkUsages(database, cancelled.id)).some(
        ({ publication_scope }) => publication_scope === "published",
      ),
      false,
    );
    await assertPublishedArtworkRetired(database, bucketState);
  });

  await t.test("restoring a public cancellation never silently restores artwork publication", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const { workspace } = await readyArtwork(
      database,
      "Artwork cancellation restore",
    );
    const published = await publicationAction(
      database,
      ownerIdentity,
      workspace,
      "publish",
    );
    const cancelled = await lifecycleAction(
      database,
      published.workspace.event,
      "cancel",
    );
    const bucketState = publicBucket();
    await assertPublishedArtworkAvailable(database, bucketState);
    const restored = await lifecycleAction(
      database,
      cancelled,
      "restore_cancelled",
    );
    assert.equal(restored.publicationStatus, "unpublished");
    assert.equal(
      (await activeEventArtworkUsages(database, restored.id)).some(
        ({ publication_scope }) => publication_scope === "published",
      ),
      false,
    );
    await assertPublishedArtworkRetired(database, bucketState);
  });

  await t.test("public cancellation and completion retain truthful artwork", async (t) => {
    for (const operation of ["cancel", "complete"]) {
      const database = await newDatabase();
      t.after(() => database.close());
      setD1Now(database, BASE_NOW);
      const { event, workspace } = await readyArtwork(
        database,
        `Artwork retained ${operation}`,
      );
      const published = await publicationAction(
        database,
        ownerIdentity,
        workspace,
        "publish",
      );
      if (operation === "complete") {
        setD1Now(database, event.schedule.endsAtUtc);
      }
      const changed = await lifecycleAction(
        database,
        published.workspace.event,
        operation,
      );
      assert.equal(changed.publicationStatus, "published");
      assert.equal(
        (await activeEventArtworkUsages(database, changed.id)).some(
          ({ publication_scope }) => publication_scope === "published",
        ),
        true,
      );
      await assertPublishedArtworkAvailable(database, publicBucket());
    }
  });
});

test("Phase 5 publication reuses the authoritative Phase 4 conflict policy", async (t) => {
  await t.test("Block mode refuses both immediate and scheduled publication", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);

    await createConfirmedEvent(database, {
      title: "Existing Block reservation",
    });
    const candidateDraft = await createOrganizerEvent(
      database,
      ownerIdentity,
      timedDraftInput({ title: "Block publication candidate" }),
    );
    const candidateDetails = await saveDetails(
      database,
      ownerIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        ownerIdentity,
        candidateDraft.id,
      ),
    );
    const confirmed = await confirmWithConflictReason(
      database,
      ownerIdentity,
      candidateDetails.event,
      "The owner recorded the intentional overlap before Block mode.",
    );
    const ready = await readOrganizerPublicationWorkspace(
      database,
      ownerIdentity,
      confirmed.id,
    );
    assert.equal(ready.readiness.ready, true);
    await setConflictPolicy(database, "block");

    const blockedWorkspace = await readOrganizerPublicationWorkspace(
      database,
      ownerIdentity,
      confirmed.id,
    );
    assert.equal(blockedWorkspace.readiness.ready, false);
    assert.equal(
      blockedWorkspace.readiness.missing.some(
        ({ code }) => code === "conflict_clearance_required",
      ),
      true,
    );
    await assertPublicationConflictRefused(
      publicationAction(
        database,
        ownerIdentity,
        blockedWorkspace,
        "publish",
      ),
    );
    await assertPublicationConflictRefused(
      schedulePublication(
        database,
        ownerIdentity,
        blockedWorkspace,
        "2030-01-02T09:00",
      ),
    );
    const unchanged = await getOrganizerEvent(
      database,
      ownerIdentity,
      confirmed.id,
    );
    assert.equal(unchanged.publicationStatus, "private");
    assert.equal(
      await countWhere(
        database,
        "organizer_event_publication_jobs",
        "organizer_event_id = ?",
        confirmed.id,
      ),
      0,
    );
    assert.equal(
      await getPublicEventBySlug(database, {
        organizationId: "org-main",
        slug: unchanged.slug,
      }),
      null,
    );
  });

  await t.test("Warn mode accepts only the current exact reason-bound override", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);

    await createConfirmedEvent(database, {
      title: "Existing Warn reservation",
    });
    const candidateDraft = await createOrganizerEvent(
      database,
      ownerIdentity,
      timedDraftInput({ title: "Warn publication candidate" }),
    );
    const candidateDetails = await saveDetails(
      database,
      ownerIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        ownerIdentity,
        candidateDraft.id,
      ),
    );
    const reason =
      "The owner confirmed separate facilitation and documented the overlap.";
    const confirmed = await confirmWithConflictReason(
      database,
      ownerIdentity,
      candidateDetails.event,
      reason,
    );
    const ready = await readOrganizerPublicationWorkspace(
      database,
      ownerIdentity,
      confirmed.id,
    );
    assert.equal(ready.readiness.ready, true);
    const originalOverrides = await activeConflictOverrideIds(
      database,
      confirmed.id,
    );
    const published = await publicationAction(
      database,
      ownerIdentity,
      ready,
      "publish",
    );
    assert.equal(published.outcome, "published");
    const publicationIntent = await row(
      database,
      `SELECT id, policy_mode, policy_version, reason, review_request_id,
              proposed_schedule_version, completed_at
       FROM organizer_schedule_write_intents
       WHERE organizer_event_id = ?
         AND operation = 'publish'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      confirmed.id,
    );
    assert.equal(publicationIntent.policy_mode, "warn_reason");
    assert.equal(publicationIntent.reason, reason);
    assert.equal(publicationIntent.review_request_id, null);
    assert.equal(
      publicationIntent.proposed_schedule_version,
      confirmed.scheduleVersion,
    );
    assert.equal(typeof publicationIntent.completed_at, "number");
    await assertPublicationConflictArtifactsRebound(database, {
      actorProfileId: "profile-owner",
      eventId: confirmed.id,
      intentId: publicationIntent.id,
      originalOverrideIds: originalOverrides,
      reason,
      reviewRequestId: null,
    });

    const staleDatabase = await newDatabase();
    t.after(() => staleDatabase.close());
    setD1Now(staleDatabase, BASE_NOW);
    await createConfirmedEvent(staleDatabase, {
      title: "Existing stale Warn reservation",
    });
    const staleDraft = await createOrganizerEvent(
      staleDatabase,
      ownerIdentity,
      timedDraftInput({ title: "Stale Warn publication candidate" }),
    );
    const staleDetails = await saveDetails(
      staleDatabase,
      ownerIdentity,
      await readOrganizerPublicationWorkspace(
        staleDatabase,
        ownerIdentity,
        staleDraft.id,
      ),
    );
    const staleConfirmed = await confirmWithConflictReason(
      staleDatabase,
      ownerIdentity,
      staleDetails.event,
      "This reason is bound to the original conflict-policy version.",
    );
    const staleReady = await readOrganizerPublicationWorkspace(
      staleDatabase,
      ownerIdentity,
      staleConfirmed.id,
    );
    assert.equal(staleReady.readiness.ready, true);
    await setConflictPolicy(staleDatabase, "block");
    await setConflictPolicy(staleDatabase, "warn_reason");
    const staleWorkspace = await readOrganizerPublicationWorkspace(
      staleDatabase,
      ownerIdentity,
      staleConfirmed.id,
    );
    assert.equal(staleWorkspace.readiness.ready, false);
    await assertPublicationConflictRefused(
      publicationAction(
        staleDatabase,
        ownerIdentity,
        staleWorkspace,
        "publish",
      ),
    );
    assert.equal(
      await countWhere(
        staleDatabase,
        "organizer_conflict_overrides",
        "organizer_event_id = ? AND invalidated_at IS NULL",
        staleConfirmed.id,
      ),
      0,
    );
  });

  await t.test("an exact Administrator-approved review authorizes publication while stale approval does not", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    await setConflictPolicy(database, "require_admin_approval");
    await createConfirmedEvent(database, {
      title: "Existing approval reservation",
    });
    const candidateDraft = await createOrganizerEvent(
      database,
      administratorIdentity,
      timedDraftInput({
        primaryOrganizerProfileId: "profile-admin",
        title: "Administrator-approved publication candidate",
      }),
    );
    const candidateDetails = await saveDetails(
      database,
      administratorIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        administratorIdentity,
        candidateDraft.id,
      ),
    );
    const pending = await performOrganizerLifecycleAction(
      database,
      administratorIdentity,
      candidateDraft.id,
      {
        action: "confirm",
        expectedContentVersion:
          candidateDetails.event.contentVersion,
        expectedScheduleVersion:
          candidateDetails.event.scheduleVersion,
        reason: "The Administrator requests approval for this overlap.",
      },
    );
    assert.equal(pending.outcome, "pending_approval");
    assert.ok(pending.reviewRequestId);
    const approved = await decideOrganizerConflictReview(
      database,
      ownerIdentity,
      pending.reviewRequestId,
      {
        decision: "approve",
        note: "Approved after checking the complete schedule.",
      },
    );
    assert.equal(approved.decision, "approve");
    assert.equal(approved.event?.planningStatus, "confirmed");
    const ready = await readOrganizerPublicationWorkspace(
      database,
      administratorIdentity,
      candidateDraft.id,
    );
    assert.equal(ready.readiness.ready, true);
    const originalOverrides = await activeConflictOverrideIds(
      database,
      candidateDraft.id,
    );
    const published = await publicationAction(
      database,
      administratorIdentity,
      ready,
      "publish",
    );
    assert.equal(published.outcome, "published");
    const publicationIntent = await row(
      database,
      `SELECT id, policy_mode, review_request_id, policy_version,
              proposed_schedule_version
       FROM organizer_schedule_write_intents
       WHERE organizer_event_id = ?
         AND operation = 'publish'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      candidateDraft.id,
    );
    assert.equal(
      publicationIntent.policy_mode,
      "require_admin_approval",
    );
    assert.equal(
      publicationIntent.review_request_id,
      pending.reviewRequestId,
    );
    assert.equal(
      publicationIntent.proposed_schedule_version,
      approved.event.scheduleVersion,
    );
    await assertPublicationConflictArtifactsRebound(database, {
      actorProfileId: "profile-admin",
      eventId: candidateDraft.id,
      intentId: publicationIntent.id,
      originalOverrideIds: originalOverrides,
      reason: "Approved version-bound conflict review",
      reviewRequestId: pending.reviewRequestId,
    });

    const staleDatabase = await newDatabase();
    t.after(() => staleDatabase.close());
    setD1Now(staleDatabase, BASE_NOW);
    await createConfirmedEvent(staleDatabase, {
      title: "Existing stale approval reservation",
    });
    const staleDraft = await createOrganizerEvent(
      staleDatabase,
      ownerIdentity,
      timedDraftInput({ title: "Stale approval publication candidate" }),
    );
    const staleDetails = await saveDetails(
      staleDatabase,
      ownerIdentity,
      await readOrganizerPublicationWorkspace(
        staleDatabase,
        ownerIdentity,
        staleDraft.id,
      ),
    );
    const staleConfirmed = await confirmWithConflictReason(
      staleDatabase,
      ownerIdentity,
      staleDetails.event,
      "This initial Warn reason will be invalidated by policy changes.",
    );
    const staleReady = await readOrganizerPublicationWorkspace(
      staleDatabase,
      ownerIdentity,
      staleConfirmed.id,
    );
    assert.equal(staleReady.readiness.ready, true);
    await setConflictPolicy(
      staleDatabase,
      "require_admin_approval",
    );
    const staleWorkspace = await readOrganizerPublicationWorkspace(
      staleDatabase,
      ownerIdentity,
      staleConfirmed.id,
    );
    assert.equal(staleWorkspace.readiness.ready, false);
    await assertPublicationConflictRefused(
      publicationAction(
        staleDatabase,
        ownerIdentity,
        staleWorkspace,
        "publish",
      ),
    );
    assert.equal(
      await countWhere(
        staleDatabase,
        "organizer_conflict_review_requests",
        "organizer_event_id = ? AND state = 'approved'",
        staleConfirmed.id,
      ),
      0,
    );
  });

  await t.test("informational and resolved incidents never become publication authority or blockers", async (t) => {
    const informationalDatabase = await newDatabase();
    t.after(() => informationalDatabase.close());
    setD1Now(informationalDatabase, BASE_NOW);
    const candidate = await createConfirmedEvent(informationalDatabase, {
      title: "Informational publication candidate",
    });
    await createOrganizerEvent(
      informationalDatabase,
      ownerIdentity,
      timedDraftInput({
        primaryOrganizerProfileId: "profile-admin",
        title: "Overlapping informational Draft",
      }),
    );
    assert.ok(
      await countWhere(
        informationalDatabase,
        "organizer_conflict_incidents",
        "state = 'informational'",
      ),
    );
    const informationalReady = await saveDetails(
      informationalDatabase,
      ownerIdentity,
      await readOrganizerPublicationWorkspace(
        informationalDatabase,
        ownerIdentity,
        candidate.id,
      ),
    );
    assert.equal(informationalReady.readiness.ready, true);
    assert.equal(
      (
        await publicationAction(
          informationalDatabase,
          ownerIdentity,
          informationalReady,
          "publish",
        )
      ).outcome,
      "published",
    );

    const resolvedDatabase = await newDatabase();
    t.after(() => resolvedDatabase.close());
    setD1Now(resolvedDatabase, BASE_NOW);
    const existing = await createConfirmedEvent(resolvedDatabase, {
      title: "Reservation that will be cancelled",
    });
    const resolvedDraft = await createOrganizerEvent(
      resolvedDatabase,
      ownerIdentity,
      timedDraftInput({
        title: "Resolved-conflict publication candidate",
      }),
    );
    const resolvedCandidate = await confirmWithConflictReason(
      resolvedDatabase,
      ownerIdentity,
      resolvedDraft,
      "This overlap is temporary until the first event is cancelled.",
    );
    await performOrganizerLifecycleAction(
      resolvedDatabase,
      ownerIdentity,
      existing.id,
      {
        action: "cancel",
        expectedContentVersion: existing.contentVersion,
        expectedScheduleVersion: existing.scheduleVersion,
      },
    );
    const resolvedReady = await saveDetails(
      resolvedDatabase,
      ownerIdentity,
      await readOrganizerPublicationWorkspace(
        resolvedDatabase,
        ownerIdentity,
        resolvedCandidate.id,
      ),
    );
    assert.equal(resolvedReady.readiness.ready, true);
    assert.equal(
      (
        await publicationAction(
          resolvedDatabase,
          ownerIdentity,
          resolvedReady,
          "publish",
        )
      ).outcome,
      "published",
    );
  });

  await t.test("a conflict removed after preflight rolls back the stale authorization batch", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const existing = await createConfirmedEvent(database, {
      title: "Reservation removed during publication",
    });
    const candidateDraft = await createOrganizerEvent(
      database,
      ownerIdentity,
      timedDraftInput({
        title: "Publication with a disappearing conflict",
      }),
    );
    const candidateDetails = await saveDetails(
      database,
      ownerIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        ownerIdentity,
        candidateDraft.id,
      ),
    );
    const candidate = await confirmWithConflictReason(
      database,
      ownerIdentity,
      candidateDetails.event,
      "The owner recorded this overlap before the other event was cancelled.",
    );
    const ready = await readOrganizerPublicationWorkspace(
      database,
      ownerIdentity,
      candidate.id,
    );
    const before = await publicationResidue(database, candidate.id);
    const originalBatch = database.batch.bind(database);
    let intercepted = false;
    database.batch = async (statements) => {
      if (!intercepted) {
        intercepted = true;
        database.batch = originalBatch;
        await performOrganizerLifecycleAction(
          database,
          ownerIdentity,
          existing.id,
          {
            action: "cancel",
            expectedContentVersion: existing.contentVersion,
            expectedScheduleVersion: existing.scheduleVersion,
          },
        );
      }
      return originalBatch(statements);
    };
    try {
      await assert.rejects(
        publicationAction(
          database,
          ownerIdentity,
          ready,
          "publish",
        ),
        (error) => error?.status === 409,
      );
    } finally {
      database.batch = originalBatch;
    }
    assert.equal(intercepted, true);
    assert.deepEqual(
      await publicationResidue(database, candidate.id),
      before,
    );
    const unchanged = await getOrganizerEvent(
      database,
      ownerIdentity,
      candidate.id,
    );
    assert.equal(unchanged.publicationStatus, "private");
    assert.equal(
      await getPublicEventBySlug(database, {
        organizationId: "org-main",
        slug: unchanged.slug,
      }),
      null,
    );
  });

  await t.test("a conflict introduced after preflight returns a safe 409 for direct publication actions", async (t) => {
    for (const action of ["publish", "schedule_publication"]) {
      await t.test(action, async (t) => {
        const database = await newDatabase();
        t.after(() => database.close());
        setD1Now(database, BASE_NOW);
        const candidate = await createConfirmedEvent(database, {
          title: `Concurrent ${action} candidate`,
        });
        const ready = await saveDetails(
          database,
          ownerIdentity,
          await readOrganizerPublicationWorkspace(
            database,
            ownerIdentity,
            candidate.id,
          ),
        );
        const before = await publicationResidue(database, candidate.id);
        const originalBatch = database.batch.bind(database);
        let intercepted = false;
        database.batch = async (statements) => {
          if (!intercepted) {
            intercepted = true;
            database.batch = originalBatch;
            const competingDraft = await createOrganizerEvent(
              database,
              ownerIdentity,
              timedDraftInput({
                primaryOrganizerProfileId: "profile-admin",
                title: `Conflict introduced during ${action}`,
              }),
            );
            await confirmWithConflictReason(
              database,
              ownerIdentity,
              competingDraft,
              "The competing reservation was committed after publication preflight.",
            );
          }
          return originalBatch(statements);
        };
        try {
          await assert.rejects(
            action === "publish"
              ? publicationAction(
                  database,
                  ownerIdentity,
                  ready,
                  "publish",
                )
              : schedulePublication(
                  database,
                  ownerIdentity,
                  ready,
                  "2030-01-02T09:00",
                ),
            (error) =>
              error?.code === "conflict" &&
              error?.status === 409 &&
              !/phase4_/iu.test(error?.message ?? ""),
          );
        } finally {
          database.batch = originalBatch;
        }
        assert.equal(intercepted, true);
        assert.deepEqual(
          await publicationResidue(database, candidate.id),
          before,
        );
        const unchanged = await getOrganizerEvent(
          database,
          ownerIdentity,
          candidate.id,
        );
        assert.equal(unchanged.publicationStatus, "private");
        assert.equal(
          await countWhere(
            database,
            "organizer_event_publication_jobs",
            "organizer_event_id = ?",
            candidate.id,
          ),
          0,
        );
        assert.equal(
          await getPublicEventBySlug(database, {
            organizationId: "org-main",
            slug: candidate.slug,
          }),
          null,
        );
      });
    }
  });

  await t.test("a conflict introduced inside due execution deterministically invalidates the job", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const candidate = await createConfirmedEvent(database, {
      title: "Due execution race candidate",
    });
    const ready = await saveDetails(
      database,
      ownerIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        ownerIdentity,
        candidate.id,
      ),
    );
    const scheduled = await schedulePublication(
      database,
      ownerIdentity,
      ready,
      "2030-01-02T09:00",
    );
    const dueAt =
      scheduled.workspace.pendingJob.requestedPublicationAtUtc;
    setD1Now(database, dueAt);

    const originalBatch = database.batch.bind(database);
    let intercepted = false;
    database.batch = async (statements) => {
      if (!intercepted) {
        intercepted = true;
        database.batch = originalBatch;
        const competingDraft = await createOrganizerEvent(
          database,
          ownerIdentity,
          timedDraftInput({
            primaryOrganizerProfileId: "profile-admin",
            title: "Conflict introduced during due execution",
          }),
        );
        await confirmWithConflictReason(
          database,
          ownerIdentity,
          competingDraft,
          "The competing reservation was committed after due-job preflight.",
        );
      }
      return originalBatch(statements);
    };
    let reconciled;
    try {
      reconciled = await reconcileDueOrganizerPublications(database, {
        now: dueAt,
      });
    } finally {
      database.batch = originalBatch;
    }
    assert.equal(intercepted, true);
    assert.deepEqual(reconciled, {
      executed: 0,
      inspected: 1,
      invalidated: 1,
      transientFailures: 0,
    });
    const finalEvent = await getOrganizerEvent(
      database,
      ownerIdentity,
      candidate.id,
    );
    assert.equal(finalEvent.publicationStatus, "unpublished");
    assert.equal(
      await getPublicEventBySlug(database, {
        organizationId: "org-main",
        slug: finalEvent.slug,
      }),
      null,
    );
    const job = await row(
      database,
      `SELECT state, failure_code
       FROM organizer_event_publication_jobs
       WHERE organizer_event_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      candidate.id,
    );
    assert.equal(job.state, "invalidated");
    assert.equal(job.failure_code, "publication_check_failed");
  });

  await t.test("a conflict introduced after scheduling deterministically invalidates the due job", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    setD1Now(database, BASE_NOW);
    const candidate = await createConfirmedEvent(database, {
      title: "Due publication conflict candidate",
    });
    const ready = await saveDetails(
      database,
      ownerIdentity,
      await readOrganizerPublicationWorkspace(
        database,
        ownerIdentity,
        candidate.id,
      ),
    );
    await setConflictPolicy(database, "block");
    const scheduled = await schedulePublication(
      database,
      ownerIdentity,
      ready,
      "2030-01-02T09:00",
    );
    const dueAt = scheduled.workspace.pendingJob.requestedPublicationAtUtc;

    await setConflictPolicy(database, "warn_reason");
    const laterDraft = await createOrganizerEvent(
      database,
      ownerIdentity,
      timedDraftInput({
        primaryOrganizerProfileId: "profile-admin",
        title: "Conflict introduced after scheduling",
      }),
    );
    await confirmWithConflictReason(
      database,
      ownerIdentity,
      laterDraft,
      "The later reservation is intentional under the temporary Warn policy.",
    );
    await setConflictPolicy(database, "block");

    setD1Now(database, dueAt);
    const reconciled = await reconcileDueOrganizerPublications(database, {
      now: dueAt,
    });
    assert.deepEqual(reconciled, {
      executed: 0,
      inspected: 1,
      invalidated: 1,
      transientFailures: 0,
    });
    const finalEvent = await getOrganizerEvent(
      database,
      ownerIdentity,
      candidate.id,
    );
    assert.equal(finalEvent.publicationStatus, "unpublished");
    assert.equal(
      await getPublicEventBySlug(database, {
        organizationId: "org-main",
        slug: finalEvent.slug,
      }),
      null,
    );
    const job = await row(
      database,
      `SELECT state, failure_code
       FROM organizer_event_publication_jobs
       WHERE organizer_event_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      candidate.id,
    );
    assert.equal(job.state, "invalidated");
    assert.equal(job.failure_code, "publication_check_failed");
    assert.equal(
      await countWhere(
        database,
        "audit_logs",
        `entity_type = 'organizer_event'
         AND entity_id = ?
         AND action = 'organizer_event.publication_invalidated'`,
        candidate.id,
      ),
      1,
    );
  });
});

test("stale versions and a mid-batch failure leave no publication residue", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  setD1Now(database, BASE_NOW);
  const event = await createConfirmedEvent(database, {
    title: "Publication rollback",
  });
  const ready = await saveDetails(
    database,
    ownerIdentity,
    await readOrganizerPublicationWorkspace(database, ownerIdentity, event.id),
  );
  const before = await publicationResidue(database, event.id);

  await assert.rejects(
    performOrganizerPublicationAction(database, ownerIdentity, event.id, {
      action: "publish",
      expectedContentVersion: ready.event.contentVersion - 1,
      expectedScheduleVersion: ready.event.scheduleVersion,
    }),
    (error) => error?.status === 409,
  );
  assert.deepEqual(await publicationResidue(database, event.id), before);

  const originalBatch = database.batch.bind(database);
  database.batch = async (statements) => {
    const middle = Math.max(2, Math.floor(statements.length / 2));
    return originalBatch([
      ...statements.slice(0, middle),
      database.prepare(
        "INSERT INTO phase5_deliberately_missing_table (id) VALUES ('fail')",
      ),
      ...statements.slice(middle),
    ]);
  };
  try {
    await assert.rejects(
      publicationAction(database, ownerIdentity, ready, "publish"),
    );
  } finally {
    database.batch = originalBatch;
  }
  assert.deepEqual(await publicationResidue(database, event.id), before);
  const unchanged = await getOrganizerEvent(
    database,
    ownerIdentity,
    event.id,
  );
  assert.equal(unchanged.publicationStatus, "private");
  assert.equal(unchanged.contentVersion, ready.event.contentVersion);
});

async function createReadyConfirmedEvent(database, title, overrides = {}) {
  const event = await createConfirmedEvent(database, {
    title,
    ...overrides,
  });
  const workspace = await saveDetails(
    database,
    ownerIdentity,
    await readOrganizerPublicationWorkspace(
      database,
      ownerIdentity,
      event.id,
    ),
  );
  return { event, workspace };
}

async function setConflictPolicy(database, mode) {
  const current = await getOrganizerConflictPolicy(
    database,
    ownerIdentity,
  );
  if (current.mode === mode) return current;
  return updateOrganizerConflictPolicy(database, ownerIdentity, {
    defaultHoldHours: current.defaultHoldHours,
    expectedPolicyVersion: current.version,
    mode,
    nearingExpiryHours: current.nearingExpiryHours,
  });
}

async function confirmWithConflictReason(
  database,
  identity,
  event,
  reason,
) {
  const result = await performOrganizerLifecycleAction(
    database,
    identity,
    event.id,
    {
      action: "confirm",
      expectedContentVersion: event.contentVersion,
      expectedScheduleVersion: event.scheduleVersion,
      reason,
    },
  );
  assert.equal(result.outcome, "applied");
  assert.equal(result.event.planningStatus, "confirmed");
  return result.event;
}

async function assertPublicationConflictRefused(promise) {
  await assert.rejects(
    promise,
    (error) =>
      (error?.code === "conflict" && error?.status === 409) ||
      (error?.code === "validation_failed" && error?.status === 422),
  );
}

async function activeConflictOverrideIds(database, eventId) {
  const overrides = await all(
    database,
    `SELECT id
     FROM organizer_conflict_overrides
     WHERE organizer_event_id = ?
       AND invalidated_at IS NULL
     ORDER BY id`,
    eventId,
  );
  assert.ok(overrides.length > 0);
  return overrides.map(({ id }) => id);
}

async function assertPublicationConflictArtifactsRebound(
  database,
  {
    actorProfileId,
    eventId,
    intentId,
    originalOverrideIds,
    reason,
    reviewRequestId,
  },
) {
  const original = await all(
    database,
    `SELECT id, invalidated_at
     FROM organizer_conflict_overrides
     WHERE id IN (${originalOverrideIds.map(() => "?").join(", ")})
     ORDER BY id`,
    ...originalOverrideIds,
  );
  assert.equal(original.length, originalOverrideIds.length);
  assert.ok(
    original.every(({ invalidated_at }) =>
      typeof invalidated_at === "number"
    ),
  );
  const reboundIncidents = await all(
    database,
    `SELECT id, state, write_intent_id, detected_by_profile_id
     FROM organizer_conflict_incidents
     WHERE organizer_event_id = ?
       AND write_intent_id = ?
     ORDER BY id`,
    eventId,
    intentId,
  );
  assert.equal(reboundIncidents.length, originalOverrideIds.length);
  assert.ok(
    reboundIncidents.every(
      (incident) =>
        incident.state === "approved" &&
        incident.detected_by_profile_id === actorProfileId,
    ),
  );
  const active = await all(
    database,
    `SELECT override.incident_id, override.reason,
            override.actor_profile_id, override.review_request_id
     FROM organizer_conflict_overrides AS override
     JOIN organizer_conflict_incidents AS incident
       ON incident.id = override.incident_id
      AND incident.organization_id = override.organization_id
     WHERE override.organizer_event_id = ?
       AND override.invalidated_at IS NULL
       AND incident.write_intent_id = ?
     ORDER BY override.id`,
    eventId,
    intentId,
  );
  assert.equal(active.length, originalOverrideIds.length);
  assert.ok(
    active.every(
      (override) =>
        override.actor_profile_id === actorProfileId &&
        override.reason === reason &&
        override.review_request_id === reviewRequestId,
    ),
  );
}

function canonicalEditInput(event, overrides = {}) {
  return timedDraftInput({
    bufferAfterMinutes: event.bufferAfterMinutes,
    bufferBeforeMinutes: event.bufferBeforeMinutes,
    coOrganizerProfileIds: event.coOrganizerProfileIds,
    description: event.description,
    meetupEventUrl: event.meetupEventUrl,
    planningStatus: event.planningStatus,
    primaryOrganizerProfileId: event.primaryOrganizerProfileId,
    summary: event.summary,
    title: event.title,
    venueId: event.venueId,
    ...overrides,
  });
}

async function editCanonicalEvent(
  database,
  event,
  overrides = {},
) {
  const current = await getOrganizerEvent(
    database,
    ownerIdentity,
    event.id,
  );
  return updateOrganizerEvent(
    database,
    ownerIdentity,
    current.id,
    current.contentVersion,
    canonicalEditInput(current, overrides),
    current.scheduleVersion,
  );
}

async function lifecycleAction(database, event, action) {
  await performOrganizerLifecycleAction(
    database,
    ownerIdentity,
    event.id,
    {
      action,
      expectedContentVersion: event.contentVersion,
      expectedScheduleVersion: event.scheduleVersion,
    },
  );
  return getOrganizerEvent(database, ownerIdentity, event.id);
}

async function canonicalMutationCounts(database, eventId) {
  return {
    audits: await countWhere(
      database,
      "audit_logs",
      "entity_type = 'organizer_event' AND entity_id = ?",
      eventId,
    ),
    intents: await countWhere(
      database,
      "organizer_event_publication_write_intents",
      "organizer_event_id = ?",
      eventId,
    ),
    jobs: await countWhere(
      database,
      "organizer_event_publication_jobs",
      "organizer_event_id = ?",
      eventId,
    ),
    revisions: await countWhere(
      database,
      "organizer_event_revisions",
      "organizer_event_id = ?",
      eventId,
    ),
  };
}

async function authorizerInvalidationCase({
  authorizer,
  enableOrganizerPolicy = false,
  expectedNotificationRecipients,
  mutate,
  primaryOrganizerProfileId,
}) {
  const database = await newDatabase();
  try {
    setD1Now(database, BASE_NOW);
    if (enableOrganizerPolicy) {
      await updateOrganizationPublicationPolicy(database, ownerIdentity, {
        organizerSelfPublishEnabled: true,
      });
    }
    const event = await createConfirmedEvent(database, {
      primaryOrganizerProfileId,
      title: `Scheduled publication ${authorizer.displayName}`,
    });
    const ready = await saveDetails(
      database,
      authorizer,
      await readOrganizerPublicationWorkspace(
        database,
        authorizer,
        event.id,
      ),
    );
    const scheduled = await schedulePublication(
      database,
      authorizer,
      ready,
      "2030-01-02T09:00",
    );
    const dueAt = scheduled.workspace.pendingJob.requestedPublicationAtUtc;
    await mutate(database);
    setD1Now(database, dueAt);
    const reconciled = await reconcileDueOrganizerPublications(database, {
      now: dueAt,
    });
    assert.equal(reconciled.executed, 0);
    assert.equal(reconciled.invalidated, 1);
    const finalEvent = await getOrganizerEvent(
      database,
      ownerIdentity,
      event.id,
    );
    assert.equal(finalEvent.publicationStatus, "unpublished");
    assert.equal(
      await getPublicEventBySlug(database, {
        organizationId: "org-main",
        slug: finalEvent.slug,
      }),
      null,
    );
    const job = await row(
      database,
      `SELECT state, failure_code
       FROM organizer_event_publication_jobs
       WHERE organizer_event_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      event.id,
    );
    assert.equal(job.state, "invalidated");
    assert.equal(job.failure_code, "authorizer_no_longer_eligible");
    const notifications = await all(
      database,
      `SELECT recipient_profile_id, type, payload_json
       FROM notifications
       WHERE type = 'publication_failed'
         AND json_extract(payload_json, '$.eventId') = ?
       ORDER BY recipient_profile_id`,
      event.id,
    );
    assert.deepEqual(
      notifications.map((notification) => notification.recipient_profile_id),
      expectedNotificationRecipients,
    );
    for (const notification of notifications) {
      assert.equal(notification.type, "publication_failed");
      assert.equal(JSON.parse(notification.payload_json).eventId, event.id);
      assert.doesNotMatch(
        notification.payload_json,
        /@|normalized_email|private_notes|meeting_details/i,
      );
    }
  } finally {
    database.close();
  }
}

async function newDatabase(options = {}) {
  const schemaSql = readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) => readFileSync(join(process.cwd(), "drizzle", name), "utf8"))
    .join("\n");
  const database = new SqliteD1TestDatabase(schemaSql);
  seed(database);
  if (options.artworkDimensions) {
    await seedArtworkDimensions(database, options.artworkDimensions);
  }
  await ensureReady(database);
  return database;
}

async function seedArtworkDimensions(
  database,
  {
    large,
    medium,
    original = large,
    small,
  },
) {
  await database
    .prepare(
      `UPDATE media_asset_details
       SET width = ?,
           height = ?,
           pixel_count = ?
       WHERE asset_id = 'asset-event-artwork'`,
    )
    .bind(
      original.width,
      original.height,
      original.width * original.height,
    )
    .run();
  for (const [kind, dimensions] of [
    ["original", original],
    ["webp_480", small],
    ["webp_960", medium],
    ["webp_1600", large],
  ]) {
    await database
      .prepare(
        `UPDATE media_asset_variants
         SET width = ?,
             height = ?,
             pixel_count = ?
         WHERE asset_id = 'asset-event-artwork'
           AND variant_kind = ?`,
      )
      .bind(
        dimensions.width,
        dimensions.height,
        dimensions.width * dimensions.height,
        kind,
      )
      .run();
  }
}

function beforeBatchDatabase(database, beforeFirstBatch) {
  let fired = false;
  return {
    async batch(statements) {
      if (!fired) {
        fired = true;
        beforeFirstBatch();
      }
      return database.batch(statements);
    },
    prepare(sql) {
      return database.prepare(sql);
    },
  };
}

function beforeFirstMatchingDatabase(database, pattern, beforeFirst) {
  let fired = false;
  const wrap = (statement, matches) => ({
    all: async (...args) => {
      if (matches && !fired) {
        fired = true;
        beforeFirst();
      }
      return statement.all(...args);
    },
    bind: (...values) => wrap(statement.bind(...values), matches),
    first: async (...args) => {
      if (matches && !fired) {
        fired = true;
        beforeFirst();
      }
      return statement.first(...args);
    },
    run: async (...args) => statement.run(...args),
  });
  return {
    batch: (statements) => database.batch(statements),
    prepare(sql) {
      pattern.lastIndex = 0;
      return wrap(database.prepare(sql), pattern.test(sql));
    },
  };
}

function isInputValidationError(error) {
  return error?.name === "InputValidationError";
}

function countedBinding(database) {
  let statementCount = 0;
  let failBatch = false;
  const batchLengths = [];
  function wrap(statement) {
    return {
      inner: statement,
      bind(...values) {
        return wrap(statement.bind(...values));
      },
      async first(...arguments_) {
        statementCount += 1;
        return statement.first(...arguments_);
      },
      async all(...arguments_) {
        statementCount += 1;
        return statement.all(...arguments_);
      },
      async run(...arguments_) {
        statementCount += 1;
        return statement.run(...arguments_);
      },
    };
  }
  return {
    binding: {
      async batch(statements) {
        statementCount += statements.length;
        batchLengths.push(statements.length);
        if (failBatch) {
          failBatch = false;
          throw new Error("transient_d1_failure");
        }
        return database.batch(
          statements.map((statement) => statement.inner),
        );
      },
      prepare(sql) {
        return wrap(database.prepare(sql));
      },
    },
    counts() {
      return {
        batchLengths: [...batchLengths],
        statementCount,
      };
    },
    failNextBatch() {
      failBatch = true;
    },
  };
}

function assertWithinStatementCap(counter, label) {
  const { batchLengths, statementCount } = counter.counts();
  assert.ok(
    statementCount <= 50,
    `${label} used ${statementCount} D1 statements`,
  );
  assert.ok(
    batchLengths.every((length) => length <= 50),
    `${label} used oversized batches: ${batchLengths.join(", ")}`,
  );
}

async function ensureReady(database) {
  await ensureDatabaseInvariantsReady(database);
}

async function createConfirmedEvent(database, overrides = {}) {
  const draft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput(overrides),
  );
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
  return getOrganizerEvent(database, ownerIdentity, draft.id);
}

function timedDraftInput(overrides = {}) {
  return {
    bufferAfterMinutes: 0,
    bufferBeforeMinutes: 0,
    clubId: "club-main",
    coOrganizerProfileIds: [],
    description: "A complete public description for an isolated test event.",
    endLocal: "2032-08-15T20:30",
    planningStatus: "draft",
    primaryOrganizerProfileId: "profile-owner",
    publicationStatus: "private",
    scheduleShape: "timed",
    startLocal: "2032-08-15T18:30",
    summary: "A complete public summary.",
    timeZone: "America/Vancouver",
    title: "Confirmed publication event",
    venueId: "venue-main",
    ...overrides,
  };
}

async function saveDetails(
  database,
  identity,
  workspace,
  overrides = {},
) {
  return updateOrganizerEventPublicDetails(
    database,
    identity,
    workspace.event.id,
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
      ...overrides,
    },
  );
}

function publicationAction(database, identity, workspace, action) {
  return performOrganizerPublicationAction(
    database,
    identity,
    workspace.event.id,
    {
      action,
      expectedContentVersion: workspace.event.contentVersion,
      expectedScheduleVersion: workspace.event.scheduleVersion,
    },
  );
}

function schedulePublication(
  database,
  identity,
  workspace,
  requestedPublicationLocal,
) {
  return performOrganizerPublicationAction(
    database,
    identity,
    workspace.event.id,
    {
      action: "schedule_publication",
      expectedContentVersion: workspace.event.contentVersion,
      expectedScheduleVersion: workspace.event.scheduleVersion,
      originalTimezone: "America/Vancouver",
      requestedPublicationLocal,
    },
  );
}

function setD1Now(database, milliseconds) {
  database.sqlite.function(
    "unixepoch",
    { deterministic: true, varargs: true },
    () => milliseconds / 1_000,
  );
}

async function publicationState(database, eventId) {
  return row(
    database,
    `SELECT first_published_at, most_recent_published_at,
            most_recent_unpublished_at, public_cancellation_at
     FROM organizer_event_publication_state
     WHERE organizer_event_id = ?`,
    eventId,
  );
}

async function pendingJobRow(database, eventId) {
  return row(
    database,
    `SELECT id, state, requested_publication_at_utc
     FROM organizer_event_publication_jobs
     WHERE organizer_event_id = ? AND state = 'pending'
     LIMIT 1`,
    eventId,
  );
}

async function publicationResidue(database, eventId) {
  const event = await getOrganizerEvent(database, ownerIdentity, eventId);
  return {
    audits: await countWhere(
      database,
      "audit_logs",
      `entity_id = ?
       AND action LIKE 'organizer_event.publication_%'`,
      eventId,
    ),
    contentVersion: event.contentVersion,
    intents: await countWhere(
      database,
      "organizer_event_publication_write_intents",
      "organizer_event_id = ?",
      eventId,
    ),
    jobs: await countWhere(
      database,
      "organizer_event_publication_jobs",
      "organizer_event_id = ?",
      eventId,
    ),
    notifications: await countWhere(
      database,
      "notifications",
      `json_extract(payload_json, '$.eventId') = ?
       AND type IN (
         'publication_scheduled', 'event_published',
         'publication_failed', 'public_event_cancelled',
         'public_schedule_changed'
       )`,
      eventId,
    ),
    publicationStatus: event.publicationStatus,
    revisions: await countWhere(
      database,
      "organizer_event_revisions",
      `organizer_event_id = ?
       AND action IN (
         'public_details_updated', 'publication_scheduled',
         'publication_executed', 'publication_cancelled',
         'published', 'unpublished', 'publicly_cancelled',
         'publication_restored'
       )`,
      eventId,
    ),
  };
}

async function row(database, sql, ...bindings) {
  const result = await database.prepare(sql).bind(...bindings).first();
  assert.ok(result, "expected one persisted row");
  return result;
}

async function all(database, sql, ...bindings) {
  return (await database.prepare(sql).bind(...bindings).all()).results;
}

async function activeEventArtworkUsages(database, eventId) {
  return (
    await all(
      database,
      `SELECT asset_id, publication_scope
       FROM media_usage_references
       WHERE organization_id = 'org-main'
         AND entity_type = 'organizer_event'
         AND entity_id = ?
         AND usage_kind = 'event_artwork'
         AND deleted_at IS NULL
       ORDER BY publication_scope`,
      eventId,
    )
  ).map(({ asset_id, publication_scope }) => ({
    asset_id,
    publication_scope,
  }));
}

async function countWhere(database, table, predicate, ...bindings) {
  return (
    await database
      .prepare(`SELECT count(*) AS count FROM "${table}" WHERE ${predicate}`)
      .bind(...bindings)
      .first()
  ).count;
}

function seedCrossOrganizationArtwork(database) {
  database.exec(`
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'org-other-artwork', 'Other Artwork Organization',
      'other-artwork-organization', 'America/Vancouver', 1,
      'profile-owner', 1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership-other-artwork-owner', 'org-other-artwork',
      'profile-owner', 'owner@example.test', 'owner', 'active',
      'profile-owner', 1, 1
    );
    INSERT INTO media_assets (
      id, organization_id, object_key, file_name, mime_type, byte_size,
      alt_text, credit, rights_status, participant_consent_status,
      is_public, uploaded_by_profile_id, created_at, updated_at
    ) VALUES (
      'asset-other-organization', 'org-other-artwork',
      'private/other-artwork/original', 'other.png', 'image/png', 1024,
      'Other organization artwork.', 'Other organization',
      'approved', 'not_applicable', 0, 'profile-owner', 1, 1
    );
    INSERT INTO media_asset_details (
      asset_id, organization_id, upload_state, informative, content_version,
      original_sha256, width, height, pixel_count, finalized_at,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'asset-other-organization', 'org-other-artwork', 'ready', 1, 1,
      '${"e".repeat(64)}', 1600, 900, 1440000, 1,
      'profile-owner', 1, 1
    );
    INSERT INTO media_asset_variants (
      id, organization_id, asset_id, variant_kind, object_key,
      mime_type, byte_size, width, height, pixel_count, sha256,
      state, finalized_at, created_at
    ) VALUES
      (
        'variant-other-original', 'org-other-artwork',
        'asset-other-organization', 'original',
        'private/other-artwork/original', 'image/png', 1024,
        1600, 900, 1440000, '${"e".repeat(64)}', 'ready', 1, 1
      ),
      (
        'variant-other-480', 'org-other-artwork',
        'asset-other-organization', 'webp_480',
        'private/other-artwork/480', 'image/webp', 480,
        480, 270, 129600, '${"f".repeat(64)}', 'ready', 1, 1
      ),
      (
        'variant-other-960', 'org-other-artwork',
        'asset-other-organization', 'webp_960',
        'private/other-artwork/960', 'image/webp', 960,
        960, 540, 518400, '${"1".repeat(64)}', 'ready', 1, 1
      ),
      (
        'variant-other-1600', 'org-other-artwork',
        'asset-other-organization', 'webp_1600',
        'private/other-artwork/1600', 'image/webp', 1600,
        1600, 900, 1440000, '${"2".repeat(64)}', 'ready', 1, 1
      );
  `);
}

async function confirmPublicOrganizerAttribution(database, now) {
  const draft = await updateOrganizerProfile(
    database,
    organizerIdentity,
    {
      calendarColor: "forest",
      displayName: "Organizer",
      expectedAttributionDraftVersion: 0,
      initials: "OR",
      publicAttributionConsent: true,
      publicBiography: null,
      publicPhotoAssetId: null,
    },
    now,
  );
  return confirmOrganizerPublicAttribution(
    database,
    organizerIdentity,
    {
      expectedAttributionDraftVersion:
        draft.publicAttributionDraftVersion,
      expectedAttributionPublishedVersion:
        draft.publicAttributionPublishedVersion,
    },
    now + 1,
  );
}

function seed(database) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name,
      public_attribution_consent, status, created_at, updated_at
    ) VALUES
      (
        'profile-owner', 'subject-owner', 'owner@example.test', 'Owner',
        1, 'active', 1, 1
      ),
      (
        'profile-admin', 'subject-admin', 'admin@example.test',
        'Administrator', 0, 'active', 1, 1
      ),
      (
        'profile-organizer', 'subject-organizer', 'organizer@example.test',
        'Organizer', 0, 'active', 1, 1
      ),
      (
        'profile-viewer', 'subject-viewer', 'viewer@example.test',
        'Viewer', 0, 'active', 1, 1
      ),
      (
        'profile-unassigned', 'subject-unassigned',
        'unassigned@example.test', 'Unassigned Organizer',
        0, 'active', 1, 1
      );

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
      (
        'membership-owner', 'org-main', 'profile-owner',
        'owner@example.test', 'owner', 'active', 'profile-owner', 1, 1
      ),
      (
        'membership-admin', 'org-main', 'profile-admin',
        'admin@example.test', 'administrator', 'active', 'profile-owner', 1, 1
      ),
      (
        'membership-organizer', 'org-main', 'profile-organizer',
        'organizer@example.test', 'organizer', 'active', 'profile-owner', 1, 1
      ),
      (
        'membership-viewer', 'org-main', 'profile-viewer',
        'viewer@example.test', 'organizer', 'active', 'profile-owner', 1, 1
      ),
      (
        'membership-unassigned', 'org-main', 'profile-unassigned',
        'unassigned@example.test', 'organizer', 'active',
        'profile-owner', 1, 1
      );

    INSERT INTO event_lanes (
      id, organization_id, name, slug, sort_order,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'lane-think', 'org-main', 'Think', 'think', 10,
      'profile-owner', 1, 1
    );

    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'club-main', 'org-main', 'Main Club', 'main-club',
      'profile-owner', 1, 1
    );

    INSERT INTO club_public_profiles (
      club_id, organization_id, primary_event_lane_id, publication_status,
      is_featured, published_at, created_at, updated_at
    ) VALUES (
      'club-main', 'org-main', 'lane-think', 'published',
      1, 1, 1, 1
    );

    INSERT INTO club_memberships (
      id, organization_id, club_id, organization_membership_id,
      profile_id, role, status, created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'club-organizer-main', 'org-main', 'club-main',
        'membership-organizer', 'profile-organizer', 'organizer', 'active',
        'profile-owner', 1, 1
      ),
      (
        'club-viewer-main', 'org-main', 'club-main',
        'membership-viewer', 'profile-viewer', 'organizer', 'active',
        'profile-owner', 1, 1
      );

    INSERT INTO venues (
      id, organization_id, name, slug, timezone, created_at, updated_at
    ) VALUES (
      'venue-main', 'org-main', 'Private venue', 'private-venue',
      'America/Vancouver', 1, 1
    );

    INSERT INTO organizer_conflict_policies (
      id, organization_id, mode, policy_version, default_hold_hours,
      nearing_expiry_hours, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'phase4-policy-org-main', 'org-main', 'warn_reason', 1, 72, 24,
      'profile-owner', 1, 1
    );

    INSERT INTO media_assets (
      id, organization_id, object_key, file_name, mime_type, byte_size,
      alt_text, credit, rights_status, participant_consent_status,
      is_public, uploaded_by_profile_id, created_at, updated_at
    ) VALUES (
      'asset-event-artwork', 'org-main', 'private/event-art/original',
      'private-original.png', 'image/png', 1024,
      'Abstract cobalt and forest shapes.',
      'Vancouver Curiosity Club', 'approved', 'not_applicable', 0,
      'profile-owner', 1, 1
    );

    INSERT INTO media_asset_details (
      asset_id, organization_id, upload_state, caption,
      focal_point_x, focal_point_y, informative, content_version,
      original_sha256, width, height, pixel_count, finalized_at,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'asset-event-artwork', 'org-main', 'ready',
      'Original Field Notes event artwork.', 2500, 7500, 1, 1,
      '${"a".repeat(64)}', 1600, 900, 1440000, 1,
      'profile-owner', 1, 1
    );

    INSERT INTO media_asset_variants (
      id, organization_id, asset_id, variant_kind, object_key,
      mime_type, byte_size, width, height, pixel_count, sha256,
      state, finalized_at, created_at
    ) VALUES
      (
        'variant-event-original', 'org-main', 'asset-event-artwork',
        'original', 'private/event-art/original', 'image/png',
        1024, 1600, 900, 1440000, '${"a".repeat(64)}', 'ready', 1, 1
      ),
      (
        'variant-event-480', 'org-main', 'asset-event-artwork',
        'webp_480', 'private/event-art/480', 'image/webp',
        480, 480, 270, 129600, '${"b".repeat(64)}', 'ready', 1, 1
      ),
      (
        'variant-event-960', 'org-main', 'asset-event-artwork',
        'webp_960', 'private/event-art/960', 'image/webp',
        960, 960, 540, 518400, '${"c".repeat(64)}', 'ready', 1, 1
      ),
      (
        'variant-event-1600', 'org-main', 'asset-event-artwork',
        'webp_1600', 'private/event-art/1600', 'image/webp',
        1600, 1600, 900, 1440000, '${"d".repeat(64)}', 'ready', 1, 1
      );
  `);
}
