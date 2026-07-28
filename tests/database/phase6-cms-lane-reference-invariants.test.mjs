import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { trustedIdentityFromSites } from "../../lib/server/auth/index.ts";
import {
  PHASE6_INVARIANT_COUNT_SQL,
  PHASE6_INVARIANT_TRIGGER_STATEMENTS,
} from "../../lib/server/database/phase6-invariant-sql.ts";
import { performOrganizerTaxonomyAction } from "../../lib/server/organizer/taxonomy.ts";
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

function seedFixture(database) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES
      (
        'profile-main', 'subject-main', 'owner-main@example.test',
        'Main Owner', 'active', 1, 1
      ),
      (
        'profile-other', 'subject-other', 'owner-other@example.test',
        'Other Owner', 'active', 1, 1
      );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'org-main', 'Main organization', 'main-organization',
        'America/Vancouver', 1, 'profile-main', 1, 1
      ),
      (
        'org-other', 'Other organization', 'other-organization',
        'America/Vancouver', 1, 'profile-other', 1, 1
      );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'membership-main', 'org-main', 'profile-main',
        'owner-main@example.test', 'owner', 'active',
        'profile-main', 1, 1
      ),
      (
        'membership-other', 'org-other', 'profile-other',
        'owner-other@example.test', 'owner', 'active',
        'profile-other', 1, 1
      );

    INSERT INTO event_lanes (
      id, organization_id, name, slug, description, sort_order,
      created_by_profile_id, created_at, updated_at, deleted_at
    ) VALUES
      (
        'lane-active', 'org-main', 'Active Lane', 'active-lane',
        'An active same-organization lane.', 10,
        'profile-main', 1, 1, NULL
      ),
      (
        'lane-archived', 'org-main', 'Archived Lane', 'archived-lane',
        'An archived same-organization lane.', 20,
        'profile-main', 1, 5, 5
      ),
      (
        'lane-protocol-race', 'org-main', 'Protocol Race Lane',
        'protocol-race-lane', 'A lane archived through the live protocol.',
        30, 'profile-main', 1, 1, NULL
      ),
      (
        'lane-other', 'org-other', 'Other Lane', 'other-lane',
        'A cross-organization lane.', 10,
        'profile-other', 1, 1, NULL
      );
    INSERT INTO taxonomy_write_intents (
      id, organization_id, entity_type, entity_id, operation,
      expected_content_version, proposed_content_version,
      proposed_name, proposed_slug, proposed_description,
      proposed_color_token, proposed_sort_order, proposed_deleted_at,
      mutation_group_id, mutation_group_size, actor_profile_id,
      created_at, completed_at
    ) VALUES
      (
        'intent-adopt-active', 'org-main', 'lane', 'lane-active',
        'adopt', 0, 1, 'Active Lane', 'active-lane',
        'An active same-organization lane.', NULL, 10, NULL,
        NULL, NULL, 'profile-main', 2, 2
      ),
      (
        'intent-adopt-archived', 'org-main', 'lane', 'lane-archived',
        'adopt', 0, 1, 'Archived Lane', 'archived-lane',
        'An archived same-organization lane.', NULL, 20, 5,
        NULL, NULL, 'profile-main', 2, 2
      ),
      (
        'intent-adopt-protocol-race', 'org-main', 'lane',
        'lane-protocol-race', 'adopt', 0, 1, 'Protocol Race Lane',
        'protocol-race-lane', 'A lane archived through the live protocol.',
        NULL, 30, NULL, NULL, NULL, 'profile-main', 2, 2
      ),
      (
        'intent-adopt-other', 'org-other', 'lane', 'lane-other',
        'adopt', 0, 1, 'Other Lane', 'other-lane',
        'A cross-organization lane.', NULL, 10, NULL,
        NULL, NULL, 'profile-other', 2, 2
      ),
      (
        'intent-adopt-hard-deleted', 'org-main', 'lane',
        'lane-hard-deleted', 'adopt', 0, 1, 'Hard-deleted Lane',
        'hard-deleted-lane', 'A lane removed through safe delete.',
        NULL, 30, NULL, NULL, NULL, 'profile-main', 2, 2
      ),
      (
        'intent-archive-hard-deleted', 'org-main', 'lane',
        'lane-hard-deleted', 'archive', 1, 2, 'Hard-deleted Lane',
        'hard-deleted-lane', 'A lane removed through safe delete.',
        NULL, 30, 6, NULL, NULL, 'profile-main', 6, 6
      ),
      (
        'intent-delete-hard-deleted', 'org-main', 'lane',
        'lane-hard-deleted', 'safe_delete', 2, 3, 'Hard-deleted Lane',
        'hard-deleted-lane', 'A lane removed through safe delete.',
        NULL, 30, 6, NULL, NULL, 'profile-main', 7, 7
      );
    INSERT INTO event_lane_taxonomy_states (
      lane_id, organization_id, content_version, active_intent_id,
      last_completed_intent_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES
      (
        'lane-active', 'org-main', 1, NULL, 'intent-adopt-active',
        'profile-main', 2, 2
      ),
      (
        'lane-archived', 'org-main', 1, NULL,
        'intent-adopt-archived', 'profile-main', 2, 2
      ),
      (
        'lane-protocol-race', 'org-main', 1, NULL,
        'intent-adopt-protocol-race', 'profile-main', 2, 2
      ),
      (
        'lane-other', 'org-other', 1, NULL, 'intent-adopt-other',
        'profile-other', 2, 2
      );
    INSERT INTO audit_logs (
      id, organization_id, actor_profile_id, action,
      entity_type, entity_id, metadata_json, created_at
    ) VALUES
      (
        'audit-adopt-active', 'org-main', 'profile-main',
        'taxonomy.lane_adopted', 'event_lane', 'lane-active',
        '{"writeIntentId":"intent-adopt-active"}', 2
      ),
      (
        'audit-adopt-archived', 'org-main', 'profile-main',
        'taxonomy.lane_adopted', 'event_lane', 'lane-archived',
        '{"writeIntentId":"intent-adopt-archived"}', 2
      ),
      (
        'audit-adopt-protocol-race', 'org-main', 'profile-main',
        'taxonomy.lane_adopted', 'event_lane', 'lane-protocol-race',
        '{"writeIntentId":"intent-adopt-protocol-race"}', 2
      ),
      (
        'audit-adopt-other', 'org-other', 'profile-other',
        'taxonomy.lane_adopted', 'event_lane', 'lane-other',
        '{"writeIntentId":"intent-adopt-other"}', 2
      ),
      (
        'audit-adopt-hard-deleted', 'org-main', 'profile-main',
        'taxonomy.lane_adopted', 'event_lane', 'lane-hard-deleted',
        '{"writeIntentId":"intent-adopt-hard-deleted"}', 2
      ),
      (
        'audit-archive-hard-deleted', 'org-main', 'profile-main',
        'taxonomy.lane_archived', 'event_lane', 'lane-hard-deleted',
        '{"writeIntentId":"intent-archive-hard-deleted"}', 6
      ),
      (
        'audit-delete-hard-deleted', 'org-main', 'profile-main',
        'taxonomy.lane_deleted', 'event_lane', 'lane-hard-deleted',
        '{"writeIntentId":"intent-delete-hard-deleted"}', 7
      );

    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'club-main', 'org-main', 'Main Club', 'main-club',
      'profile-main', 1, 1
    );
    INSERT INTO club_public_profiles (
      club_id, organization_id, primary_event_lane_id,
      publication_status, is_featured, created_at, updated_at
    ) VALUES (
      'club-main', 'org-main', 'lane-active', 'draft', 0, 1, 1
    );
    INSERT INTO programs (
      id, organization_id, club_id, name, slug,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'program-main', 'org-main', 'club-main', 'Main Program',
      'main-program', 'profile-main', 1, 1
    );
    INSERT INTO pages (
      id, organization_id, title, slug, status, visibility,
      current_revision, created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'page-private', 'org-main', 'Private Page', 'private-page',
      'draft', 'private', 1, 'profile-main', 'profile-main', 1, 1
    );
    INSERT INTO cms_entity_publication_states (
      id, organization_id, entity_type, entity_key, workflow_status,
      content_version, current_draft_revision_id, published_revision_id,
      last_editor_profile_id, created_at, updated_at
    ) VALUES
      (
        'state-club', 'org-main', 'club_public_profile', 'club-main',
        'archived', 1, NULL, NULL, 'profile-main', 1, 1
      ),
      (
        'state-program', 'org-main', 'program_public_profile',
        'program-main', 'archived', 1, NULL, NULL, 'profile-main', 1, 1
      ),
      (
        'state-page', 'org-main', 'page', 'page-private',
        'archived', 1, NULL, NULL, 'profile-main', 1, 1
      );
  `);
}

function insertRevision(
  database,
  {
    entityKey,
    entityType,
    id,
    restoredFromRevisionId = null,
    revisionNumber,
    snapshot,
    stateId,
  },
) {
  const snapshotJson = JSON.stringify(snapshot);
  return database
    .prepare(
      `INSERT INTO cms_entity_revisions (
         id, organization_id, publication_state_id,
         entity_type, entity_key, revision_number,
         snapshot_json, content_hash, canonical_byte_size,
         restored_from_revision_id, legacy_page_revision_id,
         actor_profile_id, created_at
       ) VALUES (
         ?, 'org-main', ?, ?, ?, ?, ?, ?, ?, ?, NULL,
         'profile-main', ?
       )`,
    )
    .bind(
      id,
      stateId,
      entityType,
      entityKey,
      revisionNumber,
      snapshotJson,
      revisionNumber.toString(16).padStart(64, "0"),
      Buffer.byteLength(snapshotJson),
      restoredFromRevisionId,
      100 + revisionNumber,
    )
    .run();
}

async function assertAllPhase6CountsZero(database) {
  for (const [index, sql] of PHASE6_INVARIANT_COUNT_SQL.entries()) {
    assert.equal(
      Number(await database.prepare(sql).first("violation_count")),
      0,
      `Phase 6 invariant count ${index}`,
    );
  }
}

const ownerIdentity = trustedIdentityFromSites({
  displayName: "Main Owner",
  email: "owner-main@example.test",
});

test("active same-organization lanes support club and program create, update, and restore revision lineage", async (t) => {
  const database = migratedDatabase();
  t.after(() => database.close());
  seedFixture(database);
  await installPhase6Triggers(database);

  await insertRevision(database, {
    entityKey: "club-main",
    entityType: "club_public_profile",
    id: "revision-club-create",
    revisionNumber: 1,
    snapshot: { laneId: "lane-active", name: "Create" },
    stateId: "state-club",
  });
  await insertRevision(database, {
    entityKey: "club-main",
    entityType: "club_public_profile",
    id: "revision-club-update",
    revisionNumber: 2,
    snapshot: { laneId: "lane-active", name: "Update" },
    stateId: "state-club",
  });
  await insertRevision(database, {
    entityKey: "club-main",
    entityType: "club_public_profile",
    id: "revision-club-restore",
    restoredFromRevisionId: "revision-club-create",
    revisionNumber: 3,
    snapshot: { laneId: "lane-active", name: "Create" },
    stateId: "state-club",
  });
  await insertRevision(database, {
    entityKey: "program-main",
    entityType: "program_public_profile",
    id: "revision-program-create",
    revisionNumber: 1,
    snapshot: { laneId: "lane-active", name: "Program" },
    stateId: "state-program",
  });
  await insertRevision(database, {
    entityKey: "program-main",
    entityType: "program_public_profile",
    id: "revision-program-update",
    revisionNumber: 2,
    snapshot: { laneId: "lane-active", name: "Program update" },
    stateId: "state-program",
  });
  await insertRevision(database, {
    entityKey: "program-main",
    entityType: "program_public_profile",
    id: "revision-program-restore",
    restoredFromRevisionId: "revision-program-create",
    revisionNumber: 3,
    snapshot: { laneId: "lane-active", name: "Program" },
    stateId: "state-program",
  });
  await insertRevision(database, {
    entityKey: "page-private",
    entityType: "page",
    id: "revision-page-without-lane",
    revisionNumber: 1,
    snapshot: {},
    stateId: "state-page",
  });

  assert.equal(
    await database
      .prepare(`SELECT count(*) AS count FROM cms_entity_revisions`)
      .first("count"),
    7,
  );
  await assertAllPhase6CountsZero(database);
});

test("trigger-intact direct writes reject missing, non-text, cross-organization, archived, hard-deleted, and oversized lane references without residue", async (t) => {
  const database = migratedDatabase();
  t.after(() => database.close());
  seedFixture(database);
  await installPhase6Triggers(database);

  await performOrganizerTaxonomyAction(
    database,
    ownerIdentity,
    {
      action: "archive",
      entityType: "lane",
      expectedContentVersion: 1,
      id: "lane-protocol-race",
    },
    200,
  );
  for (const [entityType, entityKey, stateId] of [
    ["club_public_profile", "club-main", "state-club"],
    ["program_public_profile", "program-main", "state-program"],
  ]) {
    await assert.rejects(
      insertRevision(database, {
        entityKey,
        entityType,
        id: `revision-protocol-archived-${entityType}`,
        revisionNumber: 90,
        snapshot: { laneId: "lane-protocol-race" },
        stateId,
      }),
      /phase6_cms_revision_lane_mismatch/u,
    );
  }
  await performOrganizerTaxonomyAction(
    database,
    ownerIdentity,
    {
      action: "safe_delete",
      entityType: "lane",
      expectedContentVersion: 2,
      id: "lane-protocol-race",
    },
    201,
  );
  await assert.rejects(
    insertRevision(database, {
      entityKey: "club-main",
      entityType: "club_public_profile",
      id: "revision-protocol-deleted",
      revisionNumber: 91,
      snapshot: { laneId: "lane-protocol-race" },
      stateId: "state-club",
    }),
    /phase6_cms_revision_lane_mismatch/u,
  );

  const invalidCases = [
    {
      entityKey: "club-main",
      entityType: "club_public_profile",
      id: "revision-missing",
      snapshot: {},
      stateId: "state-club",
    },
    {
      entityKey: "program-main",
      entityType: "program_public_profile",
      id: "revision-non-text",
      snapshot: { laneId: 42 },
      stateId: "state-program",
    },
    {
      entityKey: "club-main",
      entityType: "club_public_profile",
      id: "revision-cross-org",
      snapshot: { laneId: "lane-other" },
      stateId: "state-club",
    },
    {
      entityKey: "program-main",
      entityType: "program_public_profile",
      id: "revision-archived",
      snapshot: { laneId: "lane-archived" },
      stateId: "state-program",
    },
    {
      entityKey: "club-main",
      entityType: "club_public_profile",
      id: "revision-archived-club",
      snapshot: { laneId: "lane-archived" },
      stateId: "state-club",
    },
    {
      entityKey: "program-main",
      entityType: "program_public_profile",
      id: "revision-hard-deleted",
      snapshot: { laneId: "lane-hard-deleted" },
      stateId: "state-program",
    },
    {
      entityKey: "club-main",
      entityType: "club_public_profile",
      id: "revision-missing-row",
      snapshot: { laneId: "lane-never-existed" },
      stateId: "state-club",
    },
    {
      entityKey: "program-main",
      entityType: "program_public_profile",
      id: "revision-oversized",
      snapshot: { laneId: "x".repeat(161) },
      stateId: "state-program",
    },
  ];
  for (const [index, invalid] of invalidCases.entries()) {
    await assert.rejects(
      insertRevision(database, {
        ...invalid,
        revisionNumber: index + 1,
      }),
      /phase6_cms_revision_lane_mismatch/u,
      invalid.id,
    );
  }

  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM cms_entity_revisions
         WHERE id LIKE 'revision-%'`,
      )
      .first("count"),
    0,
  );
  await assertAllPhase6CountsZero(database);
});

test("the global CMS revision scan detects pre-guard lane corruption and returns clean after residue removal", async (t) => {
  const database = migratedDatabase();
  t.after(() => database.close());
  seedFixture(database);

  await insertRevision(database, {
    entityKey: "club-main",
    entityType: "club_public_profile",
    id: "revision-pre-guard-corrupt",
    revisionNumber: 1,
    snapshot: { laneId: "lane-archived" },
    stateId: "state-club",
  });
  const revisionIntegritySql = PHASE6_INVARIANT_COUNT_SQL.find(
    (sql) =>
      sql.includes("FROM cms_entity_revisions AS revision") &&
      sql.includes("restored_from_revision_id") &&
      sql.includes("$.laneId"),
  );
  assert.equal(typeof revisionIntegritySql, "string");
  assert.equal(
    Number(
      await database
        .prepare(revisionIntegritySql)
        .first("violation_count"),
    ),
    1,
  );

  database.exec(`
    DELETE FROM cms_entity_revisions
    WHERE id = 'revision-pre-guard-corrupt';
  `);
  await installPhase6Triggers(database);
  await assertAllPhase6CountsZero(database);
});
