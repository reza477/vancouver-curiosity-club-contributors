import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { trustedIdentityFromSites } from "../../lib/server/auth/index.ts";
import {
  PHASE6_INVARIANT_COUNT_SQL,
  PHASE6_INVARIANT_TRIGGER_STATEMENTS,
} from "../../lib/server/database/phase6-invariant-sql.ts";
import {
  createOrganizerTaxonomyItem,
  performOrganizerTaxonomyAction,
  readOrganizerTaxonomyWorkspace,
} from "../../lib/server/organizer/taxonomy.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

function migratedDatabase() {
  const schema = readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) =>
      readFileSync(join(process.cwd(), "drizzle", name), "utf8"),
    )
    .join("\n");
  return new SqliteD1TestDatabase(schema);
}

function seedOwner(database, suffix = "a") {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile-${suffix}', 'subject-${suffix}',
      'owner-${suffix}@example.test', 'Owner ${suffix}', 'active', 1, 1
    );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'org-${suffix}', 'Organization ${suffix}', 'organization-${suffix}',
      'America/Vancouver', 1, 'profile-${suffix}', 1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership-${suffix}', 'org-${suffix}', 'profile-${suffix}',
      'owner-${suffix}@example.test', 'owner', 'active',
      'profile-${suffix}', 1, 1
    );
  `);
}

function seedOrganizer(database, suffix = "a") {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile-organizer-${suffix}', 'subject-organizer-${suffix}',
      'organizer-${suffix}@example.test', 'Organizer ${suffix}',
      'active', 1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership-organizer-${suffix}', 'org-${suffix}',
      'profile-organizer-${suffix}', 'organizer-${suffix}@example.test',
      'organizer', 'active', 'profile-${suffix}', 1, 1
    );
  `);
}

async function installPhase6Triggers(database) {
  for (
    let index = 0;
    index < PHASE6_INVARIANT_TRIGGER_STATEMENTS.length;
    index += 40
  ) {
    await database.batch(
      PHASE6_INVARIANT_TRIGGER_STATEMENTS
        .slice(index, index + 40)
        .map((sql) => database.prepare(sql)),
    );
  }
}

function ownerIdentity(suffix = "a") {
  return trustedIdentityFromSites({
    displayName: `Owner ${suffix}`,
    email: `owner-${suffix}@example.test`,
  });
}

function organizerIdentity(suffix = "a") {
  return trustedIdentityFromSites({
    displayName: `Organizer ${suffix}`,
    email: `organizer-${suffix}@example.test`,
  });
}

test("taxonomy service completes intent-bound writes and exact retries without duplicate effects", async () => {
  const database = migratedDatabase();
  seedOwner(database);
  seedOrganizer(database);
  seedOwner(database, "other");
  await installPhase6Triggers(database);
  const identity = ownerIdentity();

  let workspace = await createOrganizerTaxonomyItem(
    database,
    identity,
    {
      description: "A custom learning lane.",
      entityType: "lane",
      name: "Learn",
      slug: "learn",
    },
    800,
  );
  workspace = await createOrganizerTaxonomyItem(
    database,
    identity,
    {
      description: "A custom wandering lane.",
      entityType: "lane",
      name: "Wander",
      slug: "wander",
    },
    900,
  );
  assert.equal(workspace.lanes.length, 2);

  const alphaCreate = {
    colorToken: "forest",
    description: "Alpha category",
    entityType: "category",
    name: "Alpha",
    slug: "alpha",
  };
  workspace = await createOrganizerTaxonomyItem(
    database,
    identity,
    alphaCreate,
    1_000,
  );
  assert.equal(workspace.categories.length, 1);

  workspace = await createOrganizerTaxonomyItem(
    database,
    identity,
    alphaCreate,
    1_001,
  );
  assert.equal(workspace.categories.length, 1);

  workspace = await createOrganizerTaxonomyItem(
    database,
    identity,
    {
      colorToken: "cobalt",
      description: "Beta category",
      entityType: "category",
      name: "Beta",
      slug: "beta",
    },
    1_100,
  );
  const alpha = workspace.categories.find((item) => item.slug === "alpha");
  const beta = workspace.categories.find((item) => item.slug === "beta");
  assert.ok(alpha);
  assert.ok(beta);
  assert.equal(workspace.categories.length, 2);

  await assert.rejects(
    readOrganizerTaxonomyWorkspace(database, organizerIdentity()),
    (error) =>
      error?.code === "authorization_denied" && error?.status === 403,
  );
  await assert.rejects(
    performOrganizerTaxonomyAction(
      database,
      ownerIdentity("other"),
      {
        action: "update",
        colorToken: "amber",
        description: "A crafted cross-organization edit.",
        entityType: "category",
        expectedContentVersion: alpha.contentVersion,
        id: alpha.id,
        name: "Cross-organization edit",
      },
      1_150,
    ),
    (error) => error?.code === "not_found" && error?.status === 404,
  );

  const update = {
    action: "update",
    colorToken: "amber",
    description: "Revised category",
    entityType: "category",
    expectedContentVersion: alpha.contentVersion,
    id: alpha.id,
    name: "Alpha revised",
  };
  workspace = await performOrganizerTaxonomyAction(
    database,
    identity,
    update,
    1_200,
  );
  assert.equal(
    workspace.categories.find((item) => item.id === alpha.id)
      ?.contentVersion,
    2,
  );
  await assert.rejects(
    performOrganizerTaxonomyAction(
      database,
      identity,
      {
        ...update,
        name: "Divergent stale retry",
      },
      1_202,
    ),
    (error) => error?.code === "stale_edit" && error?.status === 409,
  );
  workspace = await performOrganizerTaxonomyAction(
    database,
    identity,
    update,
    1_201,
  );
  assert.equal(
    workspace.categories.find((item) => item.id === alpha.id)
      ?.contentVersion,
    2,
  );

  await assert.rejects(
    performOrganizerTaxonomyAction(
      database,
      identity,
      {
        action: "reorder",
        entityType: "category",
        items: [
          { expectedContentVersion: 2, id: alpha.id },
        ],
      },
      1_250,
    ),
    (error) => error?.code === "stale_edit" && error?.status === 409,
  );
  const incompleteReorderResidue = await database
    .prepare(
      `SELECT count(*) AS count
       FROM taxonomy_write_intents
       WHERE operation = 'reorder'`,
    )
    .first();
  assert.equal(incompleteReorderResidue.count, 0);

  const reorder = {
    action: "reorder",
    entityType: "category",
    items: [
      { expectedContentVersion: 1, id: beta.id },
      { expectedContentVersion: 2, id: alpha.id },
    ],
  };
  workspace = await performOrganizerTaxonomyAction(
    database,
    identity,
    reorder,
    1_300,
  );
  assert.deepEqual(
    workspace.categories
      .filter((item) => !item.archived)
      .map((item) => item.id),
    [beta.id, alpha.id],
  );
  workspace = await performOrganizerTaxonomyAction(
    database,
    identity,
    reorder,
    1_301,
  );
  assert.deepEqual(
    workspace.categories
      .filter((item) => !item.archived)
      .map((item) => item.id),
    [beta.id, alpha.id],
  );

  const archive = {
    action: "archive",
    entityType: "category",
    expectedContentVersion: 2,
    id: beta.id,
  };
  workspace = await performOrganizerTaxonomyAction(
    database,
    identity,
    archive,
    1_400,
  );
  assert.equal(
    workspace.categories.find((item) => item.id === beta.id)?.archived,
    true,
  );
  workspace = await performOrganizerTaxonomyAction(
    database,
    identity,
    archive,
    1_401,
  );
  assert.equal(
    workspace.categories.find((item) => item.id === beta.id)?.archived,
    true,
  );

  const safeDelete = {
    action: "safe_delete",
    entityType: "category",
    expectedContentVersion: 3,
    id: beta.id,
  };
  workspace = await performOrganizerTaxonomyAction(
    database,
    identity,
    safeDelete,
    1_500,
  );
  assert.equal(
    workspace.categories.some((item) => item.id === beta.id),
    false,
  );
  workspace = await performOrganizerTaxonomyAction(
    database,
    identity,
    safeDelete,
    1_501,
  );
  assert.equal(
    workspace.categories.some((item) => item.id === beta.id),
    false,
  );

  const [
    openIntents,
    intentCountsResult,
    auditCountsResult,
    betaDeleteCount,
  ] = await Promise.all([
    database
      .prepare(
        `SELECT count(*) AS count
         FROM taxonomy_write_intents
         WHERE completed_at IS NULL`,
      )
      .first(),
    database
      .prepare(
        `SELECT operation, count(*) AS count
         FROM taxonomy_write_intents
         GROUP BY operation
         ORDER BY operation`,
      )
      .all(),
    database
      .prepare(
        `SELECT action, count(*) AS count
         FROM audit_logs
         WHERE action LIKE 'taxonomy.%'
         GROUP BY action
         ORDER BY action`,
      )
      .all(),
    database
      .prepare(
        `SELECT count(*) AS count
         FROM taxonomy_write_intents
         WHERE entity_id = ?
           AND operation = 'safe_delete'
           AND completed_at IS NOT NULL`,
      )
      .bind(beta.id)
      .first(),
  ]);
  assert.equal(openIntents.count, 0);
  assert.equal(betaDeleteCount.count, 1);
  assert.deepEqual(
    Object.fromEntries(
      intentCountsResult.results.map((row) => [
        row.operation,
        Number(row.count),
      ]),
    ),
    {
      archive: 1,
      create: 4,
      reorder: 2,
      safe_delete: 1,
      update: 1,
    },
  );
  assert.deepEqual(
    Object.fromEntries(
      auditCountsResult.results.map((row) => [
        row.action,
        Number(row.count),
      ]),
    ),
    {
      "taxonomy.category_archived": 1,
      "taxonomy.category_created": 2,
      "taxonomy.category_deleted": 1,
      "taxonomy.category_reordered": 2,
      "taxonomy.category_updated": 1,
      "taxonomy.lane_created": 2,
    },
  );
  for (const [index, sql] of PHASE6_INVARIANT_COUNT_SQL.entries()) {
    assert.equal(
      Number(await database.prepare(sql).first("violation_count")),
      0,
      `Phase 6 invariant count ${index}`,
    );
  }
  database.close();
});

test("taxonomy service fails closed instead of adopting a missing state row", async () => {
  const database = migratedDatabase();
  seedOwner(database, "b");
  database.exec(`
    INSERT INTO categories (
      id, organization_id, name, slug, description, color_token,
      created_at, updated_at, deleted_at
    ) VALUES (
      'category-orphan', 'org-b', 'Orphan', 'orphan',
      'Missing its required workflow state.', 'forest', 1, 1, NULL
    );
  `);
  await installPhase6Triggers(database);

  await assert.rejects(
    readOrganizerTaxonomyWorkspace(database, ownerIdentity("b")),
    (error) =>
      error?.code === "service_unavailable" && error?.status === 503,
  );
  const state = await database
    .prepare(
      `SELECT category_id
       FROM category_taxonomy_states
       WHERE category_id = 'category-orphan'`,
    )
    .first();
  assert.equal(state, null);
  database.close();
});

test("an archived lane rejects a late historical revision before safe delete", async () => {
  const database = migratedDatabase();
  seedOwner(database, "c");
  database.exec(`
    INSERT INTO cms_entity_publication_states (
      id, organization_id, entity_type, entity_key, workflow_status,
      content_version, current_draft_revision_id, published_revision_id,
      last_editor_profile_id, draft_updated_at, published_at,
      unpublished_at, adopted_at, created_at, updated_at
    ) VALUES (
      'cms-state-history', 'org-c', 'club_public_profile',
      'historical-club', 'archived', 1, NULL, NULL,
      'profile-c', NULL, NULL, NULL, NULL, 1, 1
    );
  `);
  await installPhase6Triggers(database);
  const identity = ownerIdentity("c");
  let workspace = await createOrganizerTaxonomyItem(
    database,
    identity,
    {
      description: "A lane retained only by immutable history.",
      entityType: "lane",
      name: "Historical Lane",
      slug: "historical-lane",
    },
    2_000,
  );
  const lane = workspace.lanes.find(
    (item) => item.slug === "historical-lane",
  );
  assert.ok(lane);
  workspace = await performOrganizerTaxonomyAction(
    database,
    identity,
    {
      action: "archive",
      entityType: "lane",
      expectedContentVersion: lane.contentVersion,
      id: lane.id,
    },
    2_100,
  );
  const archived = workspace.lanes.find((item) => item.id === lane.id);
  assert.equal(archived?.canDelete, true);

  const snapshot = JSON.stringify({ laneId: lane.id });
  await assert.rejects(
    database
      .prepare(
        `INSERT INTO cms_entity_revisions (
           id, organization_id, publication_state_id,
           entity_type, entity_key, revision_number,
           snapshot_json, content_hash, canonical_byte_size,
           restored_from_revision_id, legacy_page_revision_id,
           actor_profile_id, created_at
         ) VALUES (
           'cms-revision-history', 'org-c', 'cms-state-history',
           'club_public_profile', 'historical-club', 1,
           ?, ?, ?, NULL, NULL, 'profile-c', 2200
         )`,
      )
      .bind(snapshot, "a".repeat(64), Buffer.byteLength(snapshot))
      .run(),
    /phase6_cms_revision_lane_mismatch/iu,
  );
  const revisionBeforeDelete = await database
    .prepare(
      `SELECT count(*) AS count
       FROM cms_entity_revisions
       WHERE id = 'cms-revision-history'`,
    )
    .first();
  assert.equal(revisionBeforeDelete.count, 0);

  workspace = await performOrganizerTaxonomyAction(
    database,
    identity,
    {
      action: "safe_delete",
      entityType: "lane",
      expectedContentVersion: archived.contentVersion,
      id: lane.id,
    },
    2_300,
  );

  const [base, state, deleteIntents, deleteAudits] =
    await Promise.all([
      database
        .prepare(
          `SELECT count(*) AS count
           FROM event_lanes
           WHERE id = ?`,
        )
        .bind(lane.id)
        .first(),
      database
        .prepare(
          `SELECT count(*) AS count
           FROM event_lane_taxonomy_states
           WHERE lane_id = ?`,
        )
        .bind(lane.id)
        .first(),
      database
        .prepare(
          `SELECT count(*) AS count
           FROM taxonomy_write_intents
           WHERE entity_id = ?
             AND operation = 'safe_delete'
             AND completed_at IS NOT NULL`,
        )
        .bind(lane.id)
        .first(),
      database
        .prepare(
          `SELECT count(*) AS count
           FROM audit_logs
           WHERE entity_id = ?
             AND action = 'taxonomy.lane_deleted'`,
        )
        .bind(lane.id)
        .first(),
    ]);
  assert.equal(
    workspace.lanes.some((item) => item.id === lane.id),
    false,
  );
  assert.equal(base.count, 0);
  assert.equal(state.count, 0);
  assert.equal(deleteIntents.count, 1);
  assert.equal(deleteAudits.count, 1);
  database.close();
});

test("a historical lane revision injected before commit rolls archive back", async () => {
  const database = migratedDatabase();
  seedOwner(database, "d");
  database.exec(`
    INSERT INTO cms_entity_publication_states (
      id, organization_id, entity_type, entity_key, workflow_status,
      content_version, current_draft_revision_id, published_revision_id,
      last_editor_profile_id, draft_updated_at, published_at,
      unpublished_at, adopted_at, created_at, updated_at
    ) VALUES (
      'cms-state-archive-race', 'org-d', 'program_public_profile',
      'historical-program', 'archived', 1, NULL, NULL,
      'profile-d', NULL, NULL, NULL, NULL, 1, 1
    );
  `);
  await installPhase6Triggers(database);
  const identity = ownerIdentity("d");
  const workspace = await createOrganizerTaxonomyItem(
    database,
    identity,
    {
      description: "A noncanonical lane for an archive race.",
      entityType: "lane",
      name: "Archive Race Lane",
      slug: "archive-race-lane",
    },
    3_000,
  );
  const lane = workspace.lanes.find(
    (item) => item.slug === "archive-race-lane",
  );
  assert.ok(lane);
  assert.equal(lane.canArchive, true);

  let injected = false;
  const racedDatabase = {
    prepare(sql) {
      return database.prepare(sql);
    },
    async batch(statements) {
      if (!injected) {
        injected = true;
        const snapshot = JSON.stringify({ laneId: lane.id });
        await database
          .prepare(
            `INSERT INTO cms_entity_revisions (
               id, organization_id, publication_state_id,
               entity_type, entity_key, revision_number,
               snapshot_json, content_hash, canonical_byte_size,
               restored_from_revision_id, legacy_page_revision_id,
               actor_profile_id, created_at
             ) VALUES (
               'cms-revision-archive-race', 'org-d',
               'cms-state-archive-race', 'program_public_profile',
               'historical-program', 1, ?, ?, ?, NULL, NULL,
               'profile-d', 3100
             )`,
          )
          .bind(snapshot, "b".repeat(64), Buffer.byteLength(snapshot))
          .run();
      }
      return database.batch(statements);
    },
  };

  await assert.rejects(
    performOrganizerTaxonomyAction(
      racedDatabase,
      identity,
      {
        action: "archive",
        entityType: "lane",
        expectedContentVersion: lane.contentVersion,
        id: lane.id,
      },
      3_200,
    ),
    (error) => error?.status === 409 && !/SQLITE|constraint/iu.test(
      error?.message ?? "",
    ),
  );

  const [base, state, archiveIntents, archiveAudits, revision] =
    await Promise.all([
      database
        .prepare(
          `SELECT deleted_at
           FROM event_lanes
           WHERE id = ?`,
        )
        .bind(lane.id)
        .first(),
      database
        .prepare(
          `SELECT content_version, active_intent_id,
                  last_completed_intent_id
           FROM event_lane_taxonomy_states
           WHERE lane_id = ?`,
        )
        .bind(lane.id)
        .first(),
      database
        .prepare(
          `SELECT count(*) AS count
           FROM taxonomy_write_intents
           WHERE entity_id = ?
             AND operation = 'archive'`,
        )
        .bind(lane.id)
        .first(),
      database
        .prepare(
          `SELECT count(*) AS count
           FROM audit_logs
           WHERE entity_id = ?
             AND action = 'taxonomy.lane_archived'`,
        )
        .bind(lane.id)
        .first(),
      database
        .prepare(
          `SELECT count(*) AS count
           FROM cms_entity_revisions
           WHERE id = 'cms-revision-archive-race'`,
        )
        .first(),
    ]);
  assert.equal(base.deleted_at, null);
  assert.equal(state.content_version, 1);
  assert.equal(state.active_intent_id, null);
  assert.match(
    state.last_completed_intent_id,
    /^[0-9a-f-]{36}$/u,
  );
  assert.equal(archiveIntents.count, 0);
  assert.equal(archiveAudits.count, 0);
  assert.equal(revision.count, 1);

  const afterRace = await readOrganizerTaxonomyWorkspace(
    database,
    identity,
  );
  const retainedLane = afterRace.lanes.find(
    (item) => item.id === lane.id,
  );
  assert.equal(retainedLane?.archived, false);
  assert.equal(retainedLane?.canArchive, false);
  assert.equal(retainedLane?.canDelete, false);
  await assert.rejects(
    performOrganizerTaxonomyAction(
      database,
      identity,
      {
        action: "safe_delete",
        entityType: "lane",
        expectedContentVersion: lane.contentVersion,
        id: lane.id,
      },
      3_300,
    ),
    (error) => error?.status === 409,
  );
  const [safeDeleteIntents, safeDeleteAudits] = await Promise.all([
    database
      .prepare(
        `SELECT count(*) AS count
         FROM taxonomy_write_intents
         WHERE entity_id = ?
           AND operation = 'safe_delete'`,
      )
      .bind(lane.id)
      .first(),
    database
      .prepare(
        `SELECT count(*) AS count
         FROM audit_logs
         WHERE entity_id = ?
           AND action = 'taxonomy.lane_deleted'`,
      )
      .bind(lane.id)
      .first(),
  ]);
  assert.equal(safeDeleteIntents.count, 0);
  assert.equal(safeDeleteAudits.count, 0);
  database.close();
});
