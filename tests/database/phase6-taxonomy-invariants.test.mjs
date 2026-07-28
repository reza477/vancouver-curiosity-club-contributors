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
import { ensureDatabaseInvariantsReady } from "./invariant-ready.mjs";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const CANONICAL_LANES = Object.freeze([
  Object.freeze({
    description:
      "Books, film, philosophy, debate, psychology, artificial intelligence, technology, and serious discussion.",
    id: "lane-think",
    name: "Think",
    slug: "think",
    sortOrder: 10,
  }),
  Object.freeze({
    description:
      "Meditation, journaling, poetry, creative workshops, reflective practice, and silent reading.",
    id: "lane-reset-and-make",
    name: "Reset & Make",
    slug: "reset-and-make",
    sortOrder: 20,
  }),
  Object.freeze({
    description:
      "Walks, hikes, art, culture, neighbourhood outings, and discovering Vancouver.",
    id: "lane-explore",
    name: "Explore",
    slug: "explore",
    sortOrder: 30,
  }),
  Object.freeze({
    description:
      "Restaurant outings, karaoke, casual social events, and playful community gatherings.",
    id: "lane-eat-and-play",
    name: "Eat & Play",
    slug: "eat-and-play",
    sortOrder: 40,
  }),
]);

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

function seedOrganization(database, suffix = "a") {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile-${suffix}', 'subject-${suffix}', 'owner-${suffix}@example.test',
      'Owner ${suffix}', 'active', 1, 1
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

function seedNonManager(database, {
  role = "organizer",
  suffix = "organizer",
} = {}) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile-${suffix}', 'subject-${suffix}',
      '${suffix}@example.test', 'Member ${suffix}', 'active', 1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership-${suffix}', 'org-a', 'profile-${suffix}',
      '${suffix}@example.test', '${role}', 'active',
      'profile-a', 1, 1
    );
  `);
}

function distinctDatabaseBinding(database) {
  return {
    batch(statements) {
      return database.batch(statements);
    },
    prepare(sql) {
      return database.prepare(sql);
    },
  };
}

async function installPhase6Triggers(database) {
  for (let index = 0; index < PHASE6_INVARIANT_TRIGGER_STATEMENTS.length;
    index += 40) {
    await database.batch(
      PHASE6_INVARIANT_TRIGGER_STATEMENTS
        .slice(index, index + 40)
        .map((sql) => database.prepare(sql)),
    );
  }
}

async function taxonomyViolationCount(database) {
  const result = await database
    .prepare(PHASE6_INVARIANT_COUNT_SQL.at(-1))
    .first();
  return Number(result?.violation_count ?? 0);
}

async function assertInvariantEventuallyFailsClosed(database) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    try {
      await ensureDatabaseInvariants(
        distinctDatabaseBinding(database),
        DATABASE_INVARIANT_VERSION,
      );
    } catch (error) {
      assert.equal(error?.name, "DatabaseInvariantError");
      return;
    }
  }
  assert.fail("the malformed taxonomy state never failed closed");
}

function taxonomyAudit(
  database,
  {
    action,
    actor = "profile-a",
    entityId,
    entityType,
    intentId,
    now,
  },
) {
  return database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action,
         entity_type, entity_id, metadata_json, created_at
       ) VALUES (?, 'org-a', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `audit:${intentId}`,
      actor,
      action,
      entityType,
      entityId,
      JSON.stringify({ writeIntentId: intentId }),
      now,
    );
}

async function createLane(
  database,
  {
    id,
    name,
    slug,
    sortOrder,
    now,
  },
) {
  const intentId = `intent:create:${id}`;
  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO taxonomy_write_intents (
           id, organization_id, entity_type, entity_id, operation,
           expected_content_version, proposed_content_version,
           proposed_name, proposed_slug, proposed_description,
           proposed_color_token, proposed_sort_order,
           proposed_deleted_at, mutation_group_id,
           mutation_group_size, actor_profile_id,
           created_at, completed_at
         ) VALUES (
           ?, 'org-a', 'lane', ?, 'create', 0, 1,
           ?, ?, NULL, NULL, ?, NULL, NULL, NULL,
           'profile-a', ?, NULL
         )`,
      )
      .bind(intentId, id, name, slug, sortOrder, now),
    database
      .prepare(
        `INSERT INTO event_lanes (
           id, organization_id, name, slug, description, sort_order,
           created_by_profile_id, created_at, updated_at, deleted_at
         ) VALUES (
           ?, 'org-a', ?, ?, NULL, ?,
           'profile-a', ?, ?, NULL
         )`,
      )
      .bind(id, name, slug, sortOrder, now, now),
    database
      .prepare(
        `INSERT INTO event_lane_taxonomy_states (
           lane_id, organization_id, content_version,
           active_intent_id, last_completed_intent_id,
           updated_by_profile_id, created_at, updated_at
         ) VALUES (
           ?, 'org-a', 1, ?, NULL, 'profile-a', ?, ?
         )`,
      )
      .bind(id, intentId, now, now),
    taxonomyAudit(database, {
      action: "taxonomy.lane_created",
      entityId: id,
      entityType: "event_lane",
      intentId,
      now,
    }),
    database
      .prepare(
        `UPDATE event_lane_taxonomy_states
         SET active_intent_id = NULL,
             last_completed_intent_id = ?,
             updated_by_profile_id = 'profile-a',
             updated_at = ?
         WHERE lane_id = ?
           AND active_intent_id = ?`,
      )
      .bind(intentId, now, id, intentId),
    database
      .prepare(
        `UPDATE taxonomy_write_intents
         SET completed_at = ?
         WHERE id = ? AND completed_at IS NULL`,
      )
      .bind(now, intentId),
  ]);
  assert.deepEqual(
    results.map((result) => result.meta?.changes),
    [1, 1, 1, 1, 1, 1],
  );
}

async function createCategory(
  database,
  {
    colorToken = null,
    id,
    name,
    now,
    slug,
    sortOrder,
  },
) {
  const intentId = `intent:create:${id}`;
  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO taxonomy_write_intents (
           id, organization_id, entity_type, entity_id, operation,
           expected_content_version, proposed_content_version,
           proposed_name, proposed_slug, proposed_description,
           proposed_color_token, proposed_sort_order,
           proposed_deleted_at, mutation_group_id,
           mutation_group_size, actor_profile_id,
           created_at, completed_at
         ) VALUES (
           ?, 'org-a', 'category', ?, 'create', 0, 1,
           ?, ?, NULL, ?, ?, NULL, NULL, NULL,
           'profile-a', ?, NULL
         )`,
      )
      .bind(
        intentId,
        id,
        name,
        slug,
        colorToken,
        sortOrder,
        now,
      ),
    database
      .prepare(
        `INSERT INTO categories (
           id, organization_id, name, slug, description, color_token,
           created_at, updated_at, deleted_at
         ) VALUES (?, 'org-a', ?, ?, NULL, ?, ?, ?, NULL)`,
      )
      .bind(id, name, slug, colorToken, now, now),
    database
      .prepare(
        `INSERT INTO category_taxonomy_states (
           category_id, organization_id, sort_order, content_version,
           active_intent_id, last_completed_intent_id,
           updated_by_profile_id, created_at, updated_at
         ) VALUES (
           ?, 'org-a', ?, 1, ?, NULL, 'profile-a', ?, ?
         )`,
      )
      .bind(id, sortOrder, intentId, now, now),
    taxonomyAudit(database, {
      action: "taxonomy.category_created",
      entityId: id,
      entityType: "event_category",
      intentId,
      now,
    }),
    database
      .prepare(
        `UPDATE category_taxonomy_states
         SET active_intent_id = NULL,
             last_completed_intent_id = ?,
             updated_by_profile_id = 'profile-a',
             updated_at = ?
         WHERE category_id = ?
           AND active_intent_id = ?`,
      )
      .bind(intentId, now, id, intentId),
    database
      .prepare(
        `UPDATE taxonomy_write_intents
         SET completed_at = ?
         WHERE id = ? AND completed_at IS NULL`,
      )
      .bind(now, intentId),
  ]);
  assert.deepEqual(
    results.map((result) => result.meta?.changes),
    [1, 1, 1, 1, 1, 1],
  );
}

function taxonomyConfig(entityType) {
  return entityType === "lane"
    ? {
        auditEntityType: "event_lane",
        baseIdColumn: "id",
        baseTable: "event_lanes",
        stateIdColumn: "lane_id",
        stateTable: "event_lane_taxonomy_states",
      }
    : {
        auditEntityType: "event_category",
        baseIdColumn: "id",
        baseTable: "categories",
        stateIdColumn: "category_id",
        stateTable: "category_taxonomy_states",
      };
}

async function readTaxonomyRecord(database, entityType, entityId) {
  const config = taxonomyConfig(entityType);
  return database
    .prepare(
      `SELECT item.name, item.slug, item.description,
              ${entityType === "category"
                ? "item.color_token"
                : "NULL AS color_token"},
              ${entityType === "lane"
                ? "item.sort_order"
                : "state.sort_order"} AS sort_order,
              item.deleted_at, state.content_version,
              state.active_intent_id, state.last_completed_intent_id
       FROM ${config.baseTable} AS item
       JOIN ${config.stateTable} AS state
         ON state.${config.stateIdColumn} = item.${config.baseIdColumn}
        AND state.organization_id = item.organization_id
       WHERE item.${config.baseIdColumn} = ?
         AND item.organization_id = 'org-a'`,
    )
    .bind(entityId)
    .first();
}

async function mutateTaxonomyItem(
  database,
  {
    actor = "profile-a",
    colorToken,
    description,
    entityId,
    entityType,
    name,
    now,
    operation,
  },
) {
  const current = await readTaxonomyRecord(
    database,
    entityType,
    entityId,
  );
  assert.ok(current);
  const config = taxonomyConfig(entityType);
  const intentId = `intent:${operation}:${entityId}:${now}`;
  const proposedName = name ?? current.name;
  const proposedDescription =
    description === undefined ? current.description : description;
  const proposedColorToken =
    entityType === "category"
      ? colorToken === undefined
        ? current.color_token
        : colorToken
      : null;
  const proposedDeletedAt =
    operation === "archive" ? now : current.deleted_at;
  const proposedVersion = current.content_version + 1;
  const actionPastTense = {
    archive: "archived",
    safe_delete: "deleted",
    update: "updated",
  }[operation];
  const intentStatement = database
    .prepare(
      `INSERT INTO taxonomy_write_intents (
         id, organization_id, entity_type, entity_id, operation,
         expected_content_version, proposed_content_version,
         proposed_name, proposed_slug, proposed_description,
         proposed_color_token, proposed_sort_order,
         proposed_deleted_at, mutation_group_id,
         mutation_group_size, actor_profile_id,
         created_at, completed_at
       ) VALUES (
         ?, 'org-a', ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL
       )`,
    )
    .bind(
      intentId,
      entityType,
      entityId,
      operation,
      current.content_version,
      proposedVersion,
      proposedName,
      current.slug,
      proposedDescription,
      proposedColorToken,
      current.sort_order,
      proposedDeletedAt,
      actor,
      now,
    );
  const claimStatement = database
    .prepare(
      `UPDATE ${config.stateTable}
       SET active_intent_id = ?
       WHERE ${config.stateIdColumn} = ?
         AND organization_id = 'org-a'
         AND content_version = ?
         AND active_intent_id IS NULL`,
    )
    .bind(intentId, entityId, current.content_version);
  const auditStatement = taxonomyAudit(database, {
    action: `taxonomy.${entityType}_${actionPastTense}`,
    actor,
    entityId,
    entityType: config.auditEntityType,
    intentId,
    now,
  });
  const completeStatement = database
    .prepare(
      `UPDATE taxonomy_write_intents
       SET completed_at = ?
       WHERE id = ? AND completed_at IS NULL`,
    )
    .bind(now, intentId);

  let statements;
  if (operation === "safe_delete") {
    statements = [
      intentStatement,
      claimStatement,
      database
        .prepare(
          `DELETE FROM ${config.baseTable}
           WHERE ${config.baseIdColumn} = ?
             AND organization_id = 'org-a'`,
        )
        .bind(entityId),
      auditStatement,
      completeStatement,
    ];
  } else {
    const baseStatement =
      entityType === "lane"
        ? database
            .prepare(
              `UPDATE event_lanes
               SET name = ?, description = ?, deleted_at = ?,
                   updated_at = ?
               WHERE id = ? AND organization_id = 'org-a'`,
            )
            .bind(
              proposedName,
              proposedDescription,
              proposedDeletedAt,
              now,
              entityId,
            )
        : database
            .prepare(
              `UPDATE categories
               SET name = ?, description = ?, color_token = ?,
                   deleted_at = ?, updated_at = ?
               WHERE id = ? AND organization_id = 'org-a'`,
            )
            .bind(
              proposedName,
              proposedDescription,
              proposedColorToken,
              proposedDeletedAt,
              now,
              entityId,
            );
    const finalizeStatement =
      entityType === "lane"
        ? database
            .prepare(
              `UPDATE event_lane_taxonomy_states
               SET content_version = content_version + 1,
                   active_intent_id = NULL,
                   last_completed_intent_id = ?,
                   updated_by_profile_id = ?,
                   updated_at = ?
               WHERE lane_id = ?
                 AND organization_id = 'org-a'
                 AND active_intent_id = ?`,
            )
            .bind(intentId, actor, now, entityId, intentId)
        : database
            .prepare(
              `UPDATE category_taxonomy_states
               SET sort_order = ?,
                   content_version = content_version + 1,
                   active_intent_id = NULL,
                   last_completed_intent_id = ?,
                   updated_by_profile_id = ?,
                   updated_at = ?
               WHERE category_id = ?
                 AND organization_id = 'org-a'
                 AND active_intent_id = ?`,
            )
            .bind(
              current.sort_order,
              intentId,
              actor,
              now,
              entityId,
              intentId,
            );
    statements = [
      intentStatement,
      claimStatement,
      baseStatement,
      auditStatement,
      finalizeStatement,
      completeStatement,
    ];
  }
  const results = await database.batch(statements);
  assert.deepEqual(
    results.map((result) => result.meta?.changes),
    statements.map(() => 1),
  );
  return { intentId, proposedVersion };
}

async function reorderTaxonomyItems(
  database,
  {
    entityIds,
    entityType,
    now,
  },
) {
  const config = taxonomyConfig(entityType);
  const current = await Promise.all(
    entityIds.map((id) => readTaxonomyRecord(database, entityType, id)),
  );
  assert.ok(current.every(Boolean));
  const mutationGroupId = `reorder:${entityType}:${now}`;
  const proposed = entityIds.map((entityId, index) => ({
    ...current[index],
    entityId,
    intentId: `intent:${mutationGroupId}:${entityId}`,
    sortOrder: (index + 1) * 10,
  }));
  const intentStatements = proposed.map((item) =>
    database
      .prepare(
        `INSERT INTO taxonomy_write_intents (
           id, organization_id, entity_type, entity_id, operation,
           expected_content_version, proposed_content_version,
           proposed_name, proposed_slug, proposed_description,
           proposed_color_token, proposed_sort_order,
           proposed_deleted_at, mutation_group_id,
           mutation_group_size, actor_profile_id,
           created_at, completed_at
         ) VALUES (
           ?, 'org-a', ?, ?, 'reorder', ?, ?,
           ?, ?, ?, ?, ?, NULL, ?, ?, 'profile-a', ?, NULL
         )`,
      )
      .bind(
        item.intentId,
        entityType,
        item.entityId,
        item.content_version,
        item.content_version + 1,
        item.name,
        item.slug,
        item.description,
        entityType === "category" ? item.color_token : null,
        item.sortOrder,
        mutationGroupId,
        proposed.length,
        now,
      ),
  );
  const claimStatement = database
    .prepare(
      `UPDATE ${config.stateTable}
       SET active_intent_id = (
         SELECT intent.id
         FROM taxonomy_write_intents AS intent
         WHERE intent.organization_id =
               ${config.stateTable}.organization_id
           AND intent.entity_type = ?
           AND intent.entity_id =
               ${config.stateTable}.${config.stateIdColumn}
           AND intent.mutation_group_id = ?
           AND intent.completed_at IS NULL
       )
       WHERE organization_id = 'org-a'
         AND ${config.stateIdColumn} IN (${entityIds.map(() => "?").join(", ")})
         AND active_intent_id IS NULL`,
    )
    .bind(entityType, mutationGroupId, ...entityIds);
  const baseStatements =
    entityType === "lane"
      ? proposed.map((item) =>
          database
            .prepare(
              `UPDATE event_lanes
               SET sort_order = ?, updated_at = ?
               WHERE id = ? AND organization_id = 'org-a'`,
            )
            .bind(item.sortOrder, now, item.entityId),
        )
      : [];
  const auditStatements = proposed.map((item) =>
    taxonomyAudit(database, {
      action: `taxonomy.${entityType}_reordered`,
      entityId: item.entityId,
      entityType: config.auditEntityType,
      intentId: item.intentId,
      now,
    }),
  );
  const finalizeStatements = proposed.map((item) =>
    entityType === "lane"
      ? database
          .prepare(
            `UPDATE event_lane_taxonomy_states
             SET content_version = content_version + 1,
                 active_intent_id = NULL,
                 last_completed_intent_id = ?,
                 updated_by_profile_id = 'profile-a',
                 updated_at = ?
             WHERE lane_id = ?
               AND organization_id = 'org-a'
               AND active_intent_id = ?`,
          )
          .bind(item.intentId, now, item.entityId, item.intentId)
      : database
          .prepare(
            `UPDATE category_taxonomy_states
             SET sort_order = ?,
                 content_version = content_version + 1,
                 active_intent_id = NULL,
                 last_completed_intent_id = ?,
                 updated_by_profile_id = 'profile-a',
                 updated_at = ?
             WHERE category_id = ?
               AND organization_id = 'org-a'
               AND active_intent_id = ?`,
          )
          .bind(
            item.sortOrder,
            item.intentId,
            now,
            item.entityId,
            item.intentId,
          ),
  );
  const completionStatements = proposed.map((item) =>
    database
      .prepare(
        `UPDATE taxonomy_write_intents
         SET completed_at = ?
         WHERE id = ? AND completed_at IS NULL`,
      )
      .bind(now, item.intentId),
  );
  const statements = [
    ...intentStatements,
    claimStatement,
    ...baseStatements,
    ...auditStatements,
    ...finalizeStatements,
    ...completionStatements,
  ];
  const results = await database.batch(statements);
  const expectedChanges = [
    ...intentStatements.map(() => 1),
    proposed.length,
    ...baseStatements.map(() => 1),
    ...auditStatements.map(() => 1),
    ...finalizeStatements.map(() => 1),
    ...completionStatements.map(() => 1),
  ];
  assert.deepEqual(
    results.map((result) => result.meta?.changes),
    expectedChanges,
  );
}

test("invariant bootstrap adopts active and archived pre-Phase-6 taxonomy exactly once", async (t) => {
  const database = migratedDatabase();
  t.after(() => database.close());
  seedOrganization(database);
  const laneValues = CANONICAL_LANES.map(
    (lane) => `(
      '${lane.id}', 'org-a', '${lane.name.replaceAll("'", "''")}',
      '${lane.slug}', '${lane.description.replaceAll("'", "''")}',
      ${lane.sortOrder}, 'profile-a', 1, 1, NULL
    )`,
  ).join(",\n");
  database.exec(`
    INSERT INTO event_lanes (
      id, organization_id, name, slug, description, sort_order,
      created_by_profile_id, created_at, updated_at, deleted_at
    ) VALUES
      ${laneValues},
      (
        'lane-archived', 'org-a', 'Old Lane', 'old-lane', NULL, 50,
        'profile-a', 1, 2, 2
      );
    INSERT INTO categories (
      id, organization_id, name, slug, description, color_token,
      created_at, updated_at, deleted_at
    ) VALUES
      (
        'category-reading', 'org-a', 'Reading', 'reading', NULL,
        'forest', 1, 1, NULL
      ),
      (
        'category-archived', 'org-a', 'Old Category', 'old-category',
        NULL, NULL, 1, 2, 2
      );
    INSERT INTO site_settings (
      id, organization_id, key, value_json, is_public,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'catalog-marker-a', 'org-a', 'public_catalog_version',
      '"phase6-test-catalog"', 0, 'profile-a', 1, 1
    );

    INSERT INTO taxonomy_write_intents (
      id, organization_id, entity_type, entity_id, operation,
      expected_content_version, proposed_content_version,
      proposed_name, proposed_slug, proposed_description,
      proposed_color_token, proposed_sort_order,
      proposed_deleted_at, mutation_group_id, mutation_group_size,
      actor_profile_id, created_at, completed_at
    ) VALUES (
      'taxonomy-adopt-v1:lane:lane-think', 'org-a', 'lane',
      'lane-think', 'adopt', 0, 1, 'Think', 'think',
      '${CANONICAL_LANES[0].description.replaceAll("'", "''")}',
      NULL, 10, NULL, NULL, NULL, 'profile-a', 2, 2
    );
    INSERT INTO event_lane_taxonomy_states (
      lane_id, organization_id, content_version,
      active_intent_id, last_completed_intent_id,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'lane-think', 'org-a', 1, NULL,
      'taxonomy-adopt-v1:lane:lane-think', 'profile-a', 2, 2
    );
    INSERT INTO audit_logs (
      id, organization_id, actor_profile_id, action,
      entity_type, entity_id, metadata_json, created_at
    ) VALUES (
      'taxonomy-adopt-audit-v1:lane:lane-think', 'org-a',
      'profile-a', 'taxonomy.lane_adopted', 'event_lane',
      'lane-think',
      '{"writeIntentId":"taxonomy-adopt-v1:lane:lane-think"}', 2
    );
  `);

  const concurrent = await Promise.allSettled([
    ensureDatabaseInvariants(
      distinctDatabaseBinding(database),
      DATABASE_INVARIANT_VERSION,
    ),
    ensureDatabaseInvariants(
      distinctDatabaseBinding(database),
      DATABASE_INVARIANT_VERSION,
    ),
  ]);
  assert.ok(
    concurrent.every(
      (result) =>
        result.status === "fulfilled" ||
        result.reason?.name === "DatabaseInvariantError",
    ),
  );
  const statuses = await ensureDatabaseInvariantsReady(database);
  assert.equal(statuses.at(-1), "ready");
  assert.ok(statuses.includes("repaired"));

  const rows = await database
    .prepare(
      `SELECT entity_type, entity_id, operation,
              proposed_deleted_at, completed_at
       FROM taxonomy_write_intents
       ORDER BY entity_type, entity_id`,
    )
    .all();
  assert.equal(rows.results.length, 7);
  assert.ok(rows.results.every((row) => row.operation === "adopt"));
  assert.ok(rows.results.every((row) => row.completed_at !== null));
  assert.equal(
    rows.results.filter((row) => row.entity_id === "lane-think").length,
    1,
  );
  assert.equal(
    rows.results.find((row) => row.entity_id === "lane-archived")
      ?.proposed_deleted_at,
    2,
  );
  assert.equal(
    rows.results.find((row) => row.entity_id === "category-archived")
      ?.proposed_deleted_at,
    2,
  );
  const canonical = await database
    .prepare(
      `SELECT name, slug, description, sort_order
       FROM event_lanes
       WHERE organization_id = 'org-a'
         AND slug IN (
           'think', 'reset-and-make', 'explore', 'eat-and-play'
         )
       ORDER BY sort_order`,
    )
    .all();
  assert.deepEqual(
    canonical.results.map((row) => ({ ...row })),
    CANONICAL_LANES.map(({ description, name, slug, sortOrder }) => ({
      description,
      name,
      slug,
      sort_order: sortOrder,
    })),
  );

  const second = await ensureDatabaseInvariants(
    database,
    DATABASE_INVARIANT_VERSION,
  );
  assert.equal(second, "ready");
  const duplicateCount = await database
    .prepare(
      `SELECT count(*) AS count
       FROM taxonomy_write_intents`,
    )
    .first();
  assert.equal(duplicateCount?.count, 7);
  for (const sql of PHASE6_INVARIANT_COUNT_SQL) {
    const result = await database.prepare(sql).first();
    assert.equal(Number(result?.violation_count ?? 0), 0);
  }
});

test("base taxonomy writes require the exact open intent, state, audit, and completion protocol", async (t) => {
  const database = migratedDatabase();
  t.after(() => database.close());
  seedOrganization(database);
  await installPhase6Triggers(database);

  assert.throws(
    () =>
      database.exec(`
        INSERT INTO event_lanes (
          id, organization_id, name, slug, sort_order,
          created_by_profile_id, created_at, updated_at
        ) VALUES (
          'lane-raw', 'org-a', 'Raw', 'raw', 10,
          'profile-a', 2, 2
        );
      `),
    /phase6_lane_taxonomy_write_required/u,
  );

  await createLane(database, {
    id: "lane-custom",
    name: "Custom Lane",
    now: 10,
    slug: "custom-lane",
    sortOrder: 10,
  });

  assert.throws(
    () =>
      database.exec(`
        UPDATE event_lanes
        SET name = 'Bypass', updated_at = 11
        WHERE id = 'lane-custom';
      `),
    /phase6_lane_taxonomy_write_invalid/u,
  );
  assert.throws(
    () =>
      database.exec(`
        DELETE FROM event_lanes WHERE id = 'lane-custom';
      `),
    /phase6_lane_taxonomy_delete_blocked/u,
  );

  const lane = await database
    .prepare(
      `SELECT lane.name, state.content_version,
              state.active_intent_id, state.last_completed_intent_id
       FROM event_lanes AS lane
       JOIN event_lane_taxonomy_states AS state
         ON state.lane_id = lane.id
       WHERE lane.id = 'lane-custom'`,
    )
    .first();
  assert.deepEqual(
    {
      active: lane?.active_intent_id,
      name: lane?.name,
      version: lane?.content_version,
    },
    { active: null, name: "Custom Lane", version: 1 },
  );
  assert.equal(lane?.last_completed_intent_id, "intent:create:lane-custom");
});

test("lane and category envelopes support update, reorder, archive, and safe delete while retaining references", async (t) => {
  const database = migratedDatabase();
  t.after(() => database.close());
  seedOrganization(database);
  await installPhase6Triggers(database);

  await createLane(database, {
    id: "lane-alpha",
    name: "Alpha Lane",
    now: 10,
    slug: "alpha-lane",
    sortOrder: 10,
  });
  await createLane(database, {
    id: "lane-beta",
    name: "Beta Lane",
    now: 20,
    slug: "beta-lane",
    sortOrder: 20,
  });
  await createCategory(database, {
    colorToken: "forest",
    id: "category-alpha",
    name: "Alpha Category",
    now: 30,
    slug: "alpha-category",
    sortOrder: 10,
  });
  await createCategory(database, {
    colorToken: "cobalt",
    id: "category-beta",
    name: "Beta Category",
    now: 40,
    slug: "beta-category",
    sortOrder: 20,
  });

  await mutateTaxonomyItem(database, {
    description: "Updated lane description.",
    entityId: "lane-alpha",
    entityType: "lane",
    name: "Alpha Lane Updated",
    now: 50,
    operation: "update",
  });
  await mutateTaxonomyItem(database, {
    colorToken: "amber",
    description: "Updated category description.",
    entityId: "category-alpha",
    entityType: "category",
    name: "Alpha Category Updated",
    now: 60,
    operation: "update",
  });
  await reorderTaxonomyItems(database, {
    entityIds: ["lane-beta", "lane-alpha"],
    entityType: "lane",
    now: 70,
  });
  await reorderTaxonomyItems(database, {
    entityIds: ["category-beta", "category-alpha"],
    entityType: "category",
    now: 80,
  });
  assert.equal(
    (await readTaxonomyRecord(database, "lane", "lane-beta"))
      ?.sort_order,
    10,
  );
  assert.equal(
    (await readTaxonomyRecord(database, "category", "category-beta"))
      ?.sort_order,
    10,
  );

  await mutateTaxonomyItem(database, {
    entityId: "lane-alpha",
    entityType: "lane",
    now: 90,
    operation: "archive",
  });
  await mutateTaxonomyItem(database, {
    entityId: "lane-alpha",
    entityType: "lane",
    now: 100,
    operation: "safe_delete",
  });
  await mutateTaxonomyItem(database, {
    entityId: "category-alpha",
    entityType: "category",
    now: 110,
    operation: "archive",
  });
  await mutateTaxonomyItem(database, {
    entityId: "category-alpha",
    entityType: "category",
    now: 120,
    operation: "safe_delete",
  });
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM event_lanes
         WHERE id = 'lane-alpha'`,
      )
      .first("count"),
    0,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM categories
         WHERE id = 'category-alpha'`,
      )
      .first("count"),
    0,
  );

  await createCategory(database, {
    id: "category-referenced",
    name: "Referenced Category",
    now: 130,
    slug: "referenced-category",
    sortOrder: 30,
  });
  database.exec(`
    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'club-reference', 'org-a', 'Reference Club', 'reference-club',
      'profile-a', 1, 1
    );
    INSERT INTO events (
      id, organization_id, club_id, category_id, title, slug,
      status, visibility, time_kind, starts_at_utc, ends_at_utc,
      timezone, created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'event-reference', 'org-a', 'club-reference',
      'category-referenced', 'Reference Event', 'reference-event',
      'draft', 'private', 'timed', 2000000000000, 2000003600000,
      'America/Vancouver', 'profile-a', 'profile-a', 1, 1
    );
  `);
  await mutateTaxonomyItem(database, {
    entityId: "category-referenced",
    entityType: "category",
    now: 140,
    operation: "archive",
  });
  const beforeRejectedDelete = await database
    .prepare(
      `SELECT count(*) AS intent_count
       FROM taxonomy_write_intents
       WHERE entity_id = 'category-referenced'`,
    )
    .first();
  await assert.rejects(
    mutateTaxonomyItem(database, {
      entityId: "category-referenced",
      entityType: "category",
      now: 150,
      operation: "safe_delete",
    }),
    /phase6_taxonomy_intent_invalid/u,
  );
  const afterRejectedDelete = await database
    .prepare(
      `SELECT
         (SELECT count(*) FROM taxonomy_write_intents
          WHERE entity_id = 'category-referenced') AS intent_count,
         (SELECT deleted_at FROM categories
          WHERE id = 'category-referenced') AS deleted_at,
         (SELECT active_intent_id
          FROM category_taxonomy_states
          WHERE category_id = 'category-referenced') AS active_intent_id`,
    )
    .first();
  assert.deepEqual(
    {
      activeIntentId: afterRejectedDelete?.active_intent_id,
      deletedAt: afterRejectedDelete?.deleted_at,
      intentCount: afterRejectedDelete?.intent_count,
    },
    {
      activeIntentId: null,
      deletedAt: 140,
      intentCount: beforeRejectedDelete?.intent_count,
    },
  );

  for (const sql of PHASE6_INVARIANT_COUNT_SQL) {
    const result = await database.prepare(sql).first();
    assert.equal(Number(result?.violation_count ?? 0), 0);
  }
});

test("canonical archive, incomplete reorder, and injected public-profile archive race fail atomically", async (t) => {
  const database = migratedDatabase();
  t.after(() => database.close());
  seedOrganization(database);
  await installPhase6Triggers(database);
  await createLane(database, {
    id: "lane-think",
    name: "Think",
    now: 10,
    slug: "think",
    sortOrder: 10,
  });
  await createLane(database, {
    id: "lane-custom",
    name: "Custom",
    now: 20,
    slug: "custom",
    sortOrder: 20,
  });

  assert.throws(
    () =>
      database.exec(`
        INSERT INTO taxonomy_write_intents (
          id, organization_id, entity_type, entity_id, operation,
          expected_content_version, proposed_content_version,
          proposed_name, proposed_slug, proposed_description,
          proposed_color_token, proposed_sort_order,
          proposed_deleted_at, mutation_group_id,
          mutation_group_size, actor_profile_id,
          created_at, completed_at
        ) VALUES (
          'intent:archive:think', 'org-a', 'lane', 'lane-think',
          'archive', 1, 2, 'Think', 'think', NULL, NULL, 10,
          30, NULL, NULL, 'profile-a', 30, NULL
        );
      `),
    /phase6_taxonomy_intent_invalid/u,
  );

  assert.rejects(
    database.batch([
      database.prepare(
        `INSERT INTO taxonomy_write_intents (
          id, organization_id, entity_type, entity_id, operation,
          expected_content_version, proposed_content_version,
          proposed_name, proposed_slug, proposed_description,
          proposed_color_token, proposed_sort_order,
          proposed_deleted_at, mutation_group_id,
          mutation_group_size, actor_profile_id,
          created_at, completed_at
        ) VALUES (
          'intent:reorder:custom', 'org-a', 'lane', 'lane-custom',
          'reorder', 1, 2, 'Custom', 'custom', NULL, NULL, 10,
          NULL, 'group-subset', 2, 'profile-a', 30, NULL
        )`,
      ),
      database.prepare(
        `UPDATE event_lane_taxonomy_states
        SET active_intent_id = 'intent:reorder:custom'
        WHERE lane_id = 'lane-custom'`,
      ),
    ]),
    /phase6_lane_taxonomy_state_mismatch/u,
  );
  assert.equal(
    (
      await database
        .prepare(
          `SELECT count(*) AS count
           FROM taxonomy_write_intents
           WHERE id = 'intent:reorder:custom'`,
        )
        .first()
    )?.count,
    0,
  );

  database.exec(`
    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'club-a', 'org-a', 'Club A', 'club-a',
      'profile-a', 1, 1
    );
  `);
  assert.rejects(
    database.batch([
      database.prepare(
        `INSERT INTO taxonomy_write_intents (
          id, organization_id, entity_type, entity_id, operation,
          expected_content_version, proposed_content_version,
          proposed_name, proposed_slug, proposed_description,
          proposed_color_token, proposed_sort_order,
          proposed_deleted_at, mutation_group_id,
          mutation_group_size, actor_profile_id,
          created_at, completed_at
        ) VALUES (
          'intent:archive:custom', 'org-a', 'lane', 'lane-custom',
          'archive', 1, 2, 'Custom', 'custom', NULL, NULL, 20,
          40, NULL, NULL, 'profile-a', 40, NULL
        )`,
      ),
      database.prepare(
        `UPDATE event_lane_taxonomy_states
        SET active_intent_id = 'intent:archive:custom'
        WHERE lane_id = 'lane-custom'`,
      ),
      database.prepare(
        `INSERT INTO club_public_profiles (
          club_id, organization_id, primary_event_lane_id,
          publication_status, is_featured, created_at, updated_at
        ) VALUES (
          'club-a', 'org-a', 'lane-custom', 'draft', 0, 40, 40
        )`,
      ),
      database.prepare(
        `UPDATE event_lanes
        SET deleted_at = 40, updated_at = 40
        WHERE id = 'lane-custom'`,
      ),
    ]),
    /phase6_lane_taxonomy_write_invalid/u,
  );
  const residue = await database
    .prepare(
      `SELECT
         (SELECT count(*) FROM taxonomy_write_intents
          WHERE id = 'intent:archive:custom') AS intents,
         (SELECT count(*) FROM club_public_profiles
          WHERE club_id = 'club-a') AS profiles,
         (SELECT deleted_at FROM event_lanes
          WHERE id = 'lane-custom') AS deleted_at`,
    )
    .first();
  assert.deepEqual(
    {
      deletedAt: residue?.deleted_at,
      intents: residue?.intents,
      profiles: residue?.profiles,
    },
    { deletedAt: null, intents: 0, profiles: 0 },
  );
});

test("the 101st taxonomy create is rejected by intent and base guards", async (t) => {
  const database = migratedDatabase();
  t.after(() => database.close());
  seedOrganization(database);
  const values = Array.from(
    { length: 100 },
    (_, index) =>
      `(
        'lane-${index}', 'org-a', 'Lane ${index}', 'lane-${index}',
        ${index * 10}, 'profile-a', 1, 1
      )`,
  ).join(",\n");
  database.exec(`
    INSERT INTO event_lanes (
      id, organization_id, name, slug, sort_order,
      created_by_profile_id, created_at, updated_at
    ) VALUES ${values};
  `);
  await installPhase6Triggers(database);
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO taxonomy_write_intents (
          id, organization_id, entity_type, entity_id, operation,
          expected_content_version, proposed_content_version,
          proposed_name, proposed_slug, proposed_description,
          proposed_color_token, proposed_sort_order,
          proposed_deleted_at, mutation_group_id,
          mutation_group_size, actor_profile_id,
          created_at, completed_at
        ) VALUES (
          'intent:create:overflow', 'org-a', 'lane', 'lane-overflow',
          'create', 0, 1, 'Overflow', 'overflow', NULL, NULL, 1000,
          NULL, NULL, NULL, 'profile-a', 2, NULL
        );
      `),
    /phase6_taxonomy_intent_invalid/u,
  );
});

test("taxonomy authorization rejects cross-organization and non-manager actors and revalidates a demotion inside the batch", async (t) => {
  const database = migratedDatabase();
  t.after(() => database.close());
  seedOrganization(database);
  seedOrganization(database, "b");
  seedNonManager(database);
  await installPhase6Triggers(database);

  const intentSql = `
    INSERT INTO taxonomy_write_intents (
      id, organization_id, entity_type, entity_id, operation,
      expected_content_version, proposed_content_version,
      proposed_name, proposed_slug, proposed_description,
      proposed_color_token, proposed_sort_order,
      proposed_deleted_at, mutation_group_id, mutation_group_size,
      actor_profile_id, created_at, completed_at
    ) VALUES (
      ?, 'org-a', 'lane', ?, 'create', 0, 1,
      ?, ?, NULL, NULL, 10, NULL, NULL, NULL, ?, 10, NULL
    )`;
  for (const actor of ["profile-b", "profile-organizer"]) {
    await assert.rejects(
      database
        .prepare(intentSql)
        .bind(
          `intent:unauthorized:${actor}`,
          `lane-${actor}`,
          `Lane ${actor}`,
          `lane-${actor}`,
          actor,
        )
        .run(),
      /phase6_taxonomy_intent_invalid/u,
    );
  }

  await assert.rejects(
    database.batch([
      database
        .prepare(intentSql)
        .bind(
          "intent:demotion-race",
          "lane-demotion-race",
          "Demotion Race",
          "demotion-race",
          "profile-a",
        ),
      database.prepare(
        `UPDATE organization_memberships
         SET role = 'organizer', updated_at = 11
         WHERE id = 'membership-a'`,
      ),
      database.prepare(
        `INSERT INTO event_lanes (
           id, organization_id, name, slug, description, sort_order,
           created_by_profile_id, created_at, updated_at, deleted_at
         ) VALUES (
           'lane-demotion-race', 'org-a', 'Demotion Race',
           'demotion-race', NULL, 10, 'profile-a', 10, 10, NULL
         )`,
      ),
    ]),
    /phase6_lane_taxonomy_write_required/u,
  );
  const residue = await database
    .prepare(
      `SELECT
         (SELECT role FROM organization_memberships
          WHERE id = 'membership-a') AS role,
         (SELECT count(*) FROM taxonomy_write_intents
          WHERE id = 'intent:demotion-race') AS intents,
         (SELECT count(*) FROM event_lanes
          WHERE id = 'lane-demotion-race') AS lanes`,
    )
    .first();
  assert.deepEqual(
    {
      intents: residue?.intents,
      lanes: residue?.lanes,
      role: residue?.role,
    },
    { intents: 0, lanes: 0, role: "owner" },
  );
});

test("taxonomy state and completed history reject crafted updates, deletes, open residue, gaps, and orphan history", async (t) => {
  const database = migratedDatabase();
  t.after(() => database.close());
  seedOrganization(database);
  await installPhase6Triggers(database);
  await createLane(database, {
    id: "lane-history",
    name: "History Lane",
    now: 10,
    slug: "history-lane",
    sortOrder: 10,
  });
  await mutateTaxonomyItem(database, {
    description: "Version two.",
    entityId: "lane-history",
    entityType: "lane",
    now: 20,
    operation: "update",
  });
  await createCategory(database, {
    id: "category-history",
    name: "History Category",
    now: 25,
    slug: "history-category",
    sortOrder: 10,
  });
  assert.equal(await taxonomyViolationCount(database), 0);

  assert.throws(
    () =>
      database.exec(`
        UPDATE event_lane_taxonomy_states
        SET content_version = 3
        WHERE lane_id = 'lane-history';
      `),
    /phase6_lane_taxonomy_state_mismatch/u,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE event_lane_taxonomy_states
        SET organization_id = 'org-b'
        WHERE lane_id = 'lane-history';
      `),
    /phase6_lane_taxonomy_state_mismatch/u,
  );
  assert.throws(
    () =>
      database.exec(`
        DELETE FROM event_lane_taxonomy_states
        WHERE lane_id = 'lane-history';
      `),
    /phase6_lane_taxonomy_state_immutable/u,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE category_taxonomy_states
        SET sort_order = 20
        WHERE category_id = 'category-history';
      `),
    /phase6_category_taxonomy_state_mismatch/u,
  );
  assert.throws(
    () =>
      database.exec(`
        DELETE FROM category_taxonomy_states
        WHERE category_id = 'category-history';
      `),
    /phase6_category_taxonomy_state_immutable/u,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE taxonomy_write_intents
        SET proposed_name = 'Tampered'
        WHERE id = 'intent:create:lane-history';
      `),
    /phase6_taxonomy_intent_incomplete/u,
  );
  assert.throws(
    () =>
      database.exec(`
        DELETE FROM taxonomy_write_intents
        WHERE id = 'intent:create:lane-history';
      `),
    /phase6_taxonomy_intent_immutable/u,
  );

  database.exec(`
    INSERT INTO taxonomy_write_intents (
      id, organization_id, entity_type, entity_id, operation,
      expected_content_version, proposed_content_version,
      proposed_name, proposed_slug, proposed_description,
      proposed_color_token, proposed_sort_order,
      proposed_deleted_at, mutation_group_id, mutation_group_size,
      actor_profile_id, created_at, completed_at
    ) VALUES (
      'intent:open:lane-history', 'org-a', 'lane', 'lane-history',
      'update', 2, 3, 'History Lane', 'history-lane',
      'Open but incomplete.', NULL, 10, NULL, NULL, NULL,
      'profile-a', 30, NULL
    );
  `);
  assert.equal(await taxonomyViolationCount(database), 1);
  await assertInvariantEventuallyFailsClosed(database);

  database.exec(`
    DROP TRIGGER taxonomy_write_intents_phase6_before_delete;
    DELETE FROM taxonomy_write_intents
    WHERE id = 'intent:open:lane-history';
  `);
  await installPhase6Triggers(database);
  assert.equal(await taxonomyViolationCount(database), 0);

  database.exec(`
    DROP TRIGGER taxonomy_write_intents_phase6_before_insert;
  `);
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO taxonomy_write_intents (
          id, organization_id, entity_type, entity_id, operation,
          expected_content_version, proposed_content_version,
          proposed_name, proposed_slug, proposed_description,
          proposed_color_token, proposed_sort_order,
          proposed_deleted_at, mutation_group_id, mutation_group_size,
          actor_profile_id, created_at, completed_at
        ) VALUES (
          'intent:duplicate-v2', 'org-a', 'lane', 'lane-history',
          'update', 1, 2, 'History Lane', 'history-lane',
          'Duplicate fork.', NULL, 10, NULL, NULL, NULL,
          'profile-a', 40, 40
        );
      `),
    /UNIQUE constraint failed/u,
  );
  database.exec(`
    INSERT INTO taxonomy_write_intents (
      id, organization_id, entity_type, entity_id, operation,
      expected_content_version, proposed_content_version,
      proposed_name, proposed_slug, proposed_description,
      proposed_color_token, proposed_sort_order,
      proposed_deleted_at, mutation_group_id, mutation_group_size,
      actor_profile_id, created_at, completed_at
    ) VALUES
      (
        'intent:gap-v4', 'org-a', 'lane', 'lane-history',
        'update', 3, 4, 'History Lane', 'history-lane',
        'Gap at version three.', NULL, 10, NULL, NULL, NULL,
        'profile-a', 50, 50
      ),
      (
        'intent:orphan-v1', 'org-a', 'lane', 'lane-orphan',
        'create', 0, 1, 'Orphan Lane', 'orphan-lane',
        NULL, NULL, 20, NULL, NULL, NULL,
        'profile-a', 50, 50
      );
    INSERT INTO audit_logs (
      id, organization_id, actor_profile_id, action,
      entity_type, entity_id, metadata_json, created_at
    ) VALUES
      (
        'audit:gap-v4', 'org-a', 'profile-a',
        'taxonomy.lane_updated', 'event_lane', 'lane-history',
        '{"writeIntentId":"intent:gap-v4"}', 50
      ),
      (
        'audit:orphan-v1', 'org-a', 'profile-a',
        'taxonomy.lane_created', 'event_lane', 'lane-orphan',
        '{"writeIntentId":"intent:orphan-v1"}', 50
      );
  `);
  await installPhase6Triggers(database);
  assert.ok(
    (await taxonomyViolationCount(database)) >= 3,
    "gap, orphan, and current-state/history mismatch must all fail closed",
  );
  await assertInvariantEventuallyFailsClosed(database);
});

test("stale v6 readiness and a partial open adoption converge without duplicate taxonomy history", async (t) => {
  const database = migratedDatabase();
  t.after(() => database.close());
  seedOrganization(database);
  database.exec(`
    INSERT INTO database_invariant_state (
      singleton_key, version, trigger_fingerprint, verified_at
    ) VALUES (
      'database-guards', 6,
      '0000000000000000000000000000000000000000000000000000000000000000',
      1
    );
    INSERT INTO event_lanes (
      id, organization_id, name, slug, description, sort_order,
      created_by_profile_id, created_at, updated_at, deleted_at
    ) VALUES (
      'lane-partial-adoption', 'org-a', 'Partial Adoption',
      'partial-adoption', 'Existing source row.', 10,
      'profile-a', 1, 1, NULL
    );
    INSERT INTO taxonomy_write_intents (
      id, organization_id, entity_type, entity_id, operation,
      expected_content_version, proposed_content_version,
      proposed_name, proposed_slug, proposed_description,
      proposed_color_token, proposed_sort_order,
      proposed_deleted_at, mutation_group_id, mutation_group_size,
      actor_profile_id, created_at, completed_at
    ) VALUES (
      'taxonomy-adopt-v1:lane:lane-partial-adoption',
      'org-a', 'lane', 'lane-partial-adoption', 'adopt', 0, 1,
      'Partial Adoption', 'partial-adoption', 'Existing source row.',
      NULL, 10, NULL, NULL, NULL, 'profile-a', 2, NULL
    );
  `);

  const statuses = await ensureDatabaseInvariantsReady(database);
  assert.equal(statuses.at(-1), "ready");
  assert.ok(statuses.includes("repaired"));
  const adoption = await database
    .prepare(
      `SELECT
         (SELECT count(*) FROM taxonomy_write_intents
          WHERE entity_id = 'lane-partial-adoption') AS intent_count,
         (SELECT completed_at FROM taxonomy_write_intents
          WHERE id =
            'taxonomy-adopt-v1:lane:lane-partial-adoption') AS completed_at,
         (SELECT active_intent_id FROM event_lane_taxonomy_states
          WHERE lane_id = 'lane-partial-adoption') AS active_intent_id,
         (SELECT last_completed_intent_id FROM event_lane_taxonomy_states
          WHERE lane_id =
            'lane-partial-adoption') AS last_completed_intent_id,
         (SELECT count(*) FROM audit_logs
          WHERE entity_id = 'lane-partial-adoption'
            AND action = 'taxonomy.lane_adopted') AS audit_count`,
    )
    .first();
  assert.deepEqual(
    {
      activeIntentId: adoption?.active_intent_id,
      auditCount: adoption?.audit_count,
      completed: adoption?.completed_at !== null,
      intentCount: adoption?.intent_count,
      lastCompletedIntentId: adoption?.last_completed_intent_id,
    },
    {
      activeIntentId: null,
      auditCount: 1,
      completed: true,
      intentCount: 1,
      lastCompletedIntentId:
        "taxonomy-adopt-v1:lane:lane-partial-adoption",
    },
  );
  assert.equal(await taxonomyViolationCount(database), 0);
});

test("the public catalog marker is optional before catalog initialization but fails closed when canonical lane coverage drifts", async (t) => {
  const database = migratedDatabase();
  t.after(() => database.close());
  seedOrganization(database);
  await installPhase6Triggers(database);

  assert.equal(
    await taxonomyViolationCount(database),
    0,
    "an organization without the fill-only catalog marker is not initialized yet",
  );
  for (const lane of CANONICAL_LANES.slice(0, 3)) {
    await createLane(database, {
      id: lane.id,
      name: lane.name,
      now: lane.sortOrder,
      slug: lane.slug,
      sortOrder: lane.sortOrder,
    });
  }
  database.exec(`
    INSERT INTO site_settings (
      id, organization_id, key, value_json, is_public,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'catalog-marker-drift', 'org-a', 'public_catalog_version',
      '"stale-version"', 0, 'profile-a', 100, 100
    );
  `);
  assert.equal(await taxonomyViolationCount(database), 1);
  await assertInvariantEventuallyFailsClosed(database);

  const finalLane = CANONICAL_LANES.at(-1);
  await createLane(database, {
    id: finalLane.id,
    name: finalLane.name,
    now: 110,
    slug: finalLane.slug,
    sortOrder: finalLane.sortOrder,
  });
  assert.equal(
    await taxonomyViolationCount(database),
    0,
    "any durable catalog marker requires all four live canonical identities",
  );
});

test("historical CMS lane references block archive at intent time and at the committing update race", async (t) => {
  const beforeIntent = migratedDatabase();
  const duringCommit = migratedDatabase();
  t.after(() => beforeIntent.close());
  t.after(() => duringCommit.close());

  for (const database of [beforeIntent, duringCommit]) {
    seedOrganization(database);
    database.exec(`
      INSERT INTO event_lanes (
        id, organization_id, name, slug, description, sort_order,
        created_by_profile_id, created_at, updated_at, deleted_at
      ) VALUES
        (
          'lane-cms-history', 'org-a', 'CMS History Lane',
          'cms-history-lane', NULL, 10, 'profile-a', 1, 1, NULL
        ),
        (
          'lane-cms-primary', 'org-a', 'CMS Primary Lane',
          'cms-primary-lane', NULL, 20, 'profile-a', 1, 1, NULL
        );
      INSERT INTO taxonomy_write_intents (
        id, organization_id, entity_type, entity_id, operation,
        expected_content_version, proposed_content_version,
        proposed_name, proposed_slug, proposed_description,
        proposed_color_token, proposed_sort_order,
        proposed_deleted_at, mutation_group_id, mutation_group_size,
        actor_profile_id, created_at, completed_at
      ) VALUES
        (
          'taxonomy-adopt-v1:lane:lane-cms-history',
          'org-a', 'lane', 'lane-cms-history', 'adopt', 0, 1,
          'CMS History Lane', 'cms-history-lane', NULL,
          NULL, 10, NULL, NULL, NULL, 'profile-a', 2, 2
        ),
        (
          'taxonomy-adopt-v1:lane:lane-cms-primary',
          'org-a', 'lane', 'lane-cms-primary', 'adopt', 0, 1,
          'CMS Primary Lane', 'cms-primary-lane', NULL,
          NULL, 20, NULL, NULL, NULL, 'profile-a', 2, 2
        );
      INSERT INTO event_lane_taxonomy_states (
        lane_id, organization_id, content_version,
        active_intent_id, last_completed_intent_id,
        updated_by_profile_id, created_at, updated_at
      ) VALUES
        (
          'lane-cms-history', 'org-a', 1, NULL,
          'taxonomy-adopt-v1:lane:lane-cms-history',
          'profile-a', 2, 2
        ),
        (
          'lane-cms-primary', 'org-a', 1, NULL,
          'taxonomy-adopt-v1:lane:lane-cms-primary',
          'profile-a', 2, 2
        );
      INSERT INTO audit_logs (
        id, organization_id, actor_profile_id, action,
        entity_type, entity_id, metadata_json, created_at
      ) VALUES
        (
          'audit:adopt:lane-cms-history', 'org-a', 'profile-a',
          'taxonomy.lane_adopted', 'event_lane', 'lane-cms-history',
          '{"writeIntentId":"taxonomy-adopt-v1:lane:lane-cms-history"}',
          2
        ),
        (
          'audit:adopt:lane-cms-primary', 'org-a', 'profile-a',
          'taxonomy.lane_adopted', 'event_lane', 'lane-cms-primary',
          '{"writeIntentId":"taxonomy-adopt-v1:lane:lane-cms-primary"}',
          2
        );
      INSERT INTO clubs (
        id, organization_id, name, slug, created_by_profile_id,
        created_at, updated_at
      ) VALUES (
        'club-cms', 'org-a', 'CMS Club', 'cms-club',
        'profile-a', 1, 1
      );
      INSERT INTO club_public_profiles (
        club_id, organization_id, primary_event_lane_id,
        publication_status, is_featured, created_at, updated_at
      ) VALUES (
        'club-cms', 'org-a', 'lane-cms-primary',
        'draft', 0, 1, 1
      );
      INSERT INTO programs (
        id, organization_id, club_id, name, slug,
        created_by_profile_id, created_at, updated_at
      ) VALUES (
        'program-cms', 'org-a', 'club-cms', 'CMS Program',
        'cms-program', 'profile-a', 1, 1
      );
      INSERT INTO cms_entity_publication_states (
        id, organization_id, entity_type, entity_key,
        workflow_status, content_version,
        current_draft_revision_id, published_revision_id,
        last_editor_profile_id, created_at, updated_at
      ) VALUES
        (
          'cms-state-club', 'org-a', 'club_public_profile',
          'club-cms', 'archived', 1, NULL, NULL,
          'profile-a', 1, 1
        ),
        (
          'cms-state-program', 'org-a', 'program_public_profile',
          'program-cms', 'archived', 1, NULL, NULL,
          'profile-a', 1, 1
        );
    `);
    await installPhase6Triggers(database);
  }

  const snapshot = JSON.stringify({ laneId: "lane-cms-history" });
  beforeIntent.exec(`
    DROP TRIGGER cms_entity_revisions_phase6_before_insert;
  `);
  await beforeIntent.batch([
    beforeIntent
      .prepare(
        `INSERT INTO cms_entity_revisions (
           id, organization_id, publication_state_id,
           entity_type, entity_key, revision_number,
           snapshot_json, content_hash, canonical_byte_size,
           actor_profile_id, created_at
         ) VALUES (
           'cms-revision-club', 'org-a', 'cms-state-club',
           'club_public_profile', 'club-cms', 1,
           ?, ?, ?, 'profile-a', 20
         )`,
      )
      .bind(snapshot, "0".repeat(64), Buffer.byteLength(snapshot)),
    beforeIntent
      .prepare(
        `INSERT INTO cms_entity_revisions (
           id, organization_id, publication_state_id,
           entity_type, entity_key, revision_number,
           snapshot_json, content_hash, canonical_byte_size,
           actor_profile_id, created_at
         ) VALUES (
           'cms-revision-program', 'org-a', 'cms-state-program',
           'program_public_profile', 'program-cms', 1,
           ?, ?, ?, 'profile-a', 20
         )`,
      )
      .bind(snapshot, "1".repeat(64), Buffer.byteLength(snapshot)),
  ]);
  assert.throws(
    () =>
      beforeIntent.exec(`
        INSERT INTO taxonomy_write_intents (
          id, organization_id, entity_type, entity_id, operation,
          expected_content_version, proposed_content_version,
          proposed_name, proposed_slug, proposed_description,
          proposed_color_token, proposed_sort_order,
          proposed_deleted_at, mutation_group_id,
          mutation_group_size, actor_profile_id,
          created_at, completed_at
        ) VALUES (
          'intent:archive:cms-history', 'org-a', 'lane',
          'lane-cms-history', 'archive', 1, 2,
          'CMS History Lane', 'cms-history-lane', NULL, NULL, 10,
          30, NULL, NULL, 'profile-a', 30, NULL
        );
      `),
    /phase6_taxonomy_intent_invalid/u,
  );

  duringCommit.exec(`
    DROP TRIGGER cms_entity_revisions_phase6_before_insert;
  `);
  await assert.rejects(
    duringCommit.batch([
      duringCommit.prepare(
        `INSERT INTO taxonomy_write_intents (
          id, organization_id, entity_type, entity_id, operation,
          expected_content_version, proposed_content_version,
          proposed_name, proposed_slug, proposed_description,
          proposed_color_token, proposed_sort_order,
          proposed_deleted_at, mutation_group_id,
          mutation_group_size, actor_profile_id,
          created_at, completed_at
        ) VALUES (
          'intent:archive:cms-race', 'org-a', 'lane',
          'lane-cms-history', 'archive', 1, 2,
          'CMS History Lane', 'cms-history-lane', NULL, NULL, 10,
          40, NULL, NULL, 'profile-a', 40, NULL
        )`,
      ),
      duringCommit.prepare(
        `UPDATE event_lane_taxonomy_states
         SET active_intent_id = 'intent:archive:cms-race'
         WHERE lane_id = 'lane-cms-history'`,
      ),
      duringCommit
        .prepare(
          `INSERT INTO cms_entity_revisions (
             id, organization_id, publication_state_id,
             entity_type, entity_key, revision_number,
             snapshot_json, content_hash, canonical_byte_size,
             actor_profile_id, created_at
           ) VALUES (
             'cms-revision-race', 'org-a', 'cms-state-club',
             'club_public_profile', 'club-cms', 1,
             ?, ?, ?, 'profile-a', 40
           )`,
        )
        .bind(snapshot, "2".repeat(64), Buffer.byteLength(snapshot)),
      duringCommit.prepare(
        `UPDATE event_lanes
         SET deleted_at = 40, updated_at = 40
         WHERE id = 'lane-cms-history'`,
      ),
    ]),
    /phase6_lane_taxonomy_write_invalid/u,
  );
  const residue = await duringCommit
    .prepare(
      `SELECT
         (SELECT count(*) FROM taxonomy_write_intents
          WHERE id = 'intent:archive:cms-race') AS intent_count,
         (SELECT count(*) FROM cms_entity_revisions
          WHERE id = 'cms-revision-race') AS revision_count,
         (SELECT active_intent_id FROM event_lane_taxonomy_states
          WHERE lane_id = 'lane-cms-history') AS active_intent_id,
         (SELECT deleted_at FROM event_lanes
          WHERE id = 'lane-cms-history') AS deleted_at`,
    )
    .first();
  assert.deepEqual(
    {
      activeIntentId: residue?.active_intent_id,
      deletedAt: residue?.deleted_at,
      intentCount: residue?.intent_count,
      revisionCount: residue?.revision_count,
    },
    {
      activeIntentId: null,
      deletedAt: null,
      intentCount: 0,
      revisionCount: 0,
    },
  );

  await mutateTaxonomyItem(duringCommit, {
    entityId: "lane-cms-history",
    entityType: "lane",
    now: 50,
    operation: "archive",
  });
  await duringCommit
    .prepare(
      `INSERT INTO cms_entity_revisions (
         id, organization_id, publication_state_id,
         entity_type, entity_key, revision_number,
         snapshot_json, content_hash, canonical_byte_size,
         actor_profile_id, created_at
       ) VALUES (
         'cms-revision-safe-delete', 'org-a', 'cms-state-club',
         'club_public_profile', 'club-cms', 1,
         ?, ?, ?, 'profile-a', 60
       )`,
    )
    .bind(snapshot, "3".repeat(64), Buffer.byteLength(snapshot))
    .run();
  await assert.rejects(
    mutateTaxonomyItem(duringCommit, {
      entityId: "lane-cms-history",
      entityType: "lane",
      now: 70,
      operation: "safe_delete",
    }),
    /phase6_taxonomy_intent_invalid/u,
  );
  const retained = await duringCommit
    .prepare(
      `SELECT lane.deleted_at, state.active_intent_id,
              (
                SELECT count(*) FROM taxonomy_write_intents AS intent
                WHERE intent.id =
                  'intent:safe_delete:lane-cms-history:70'
              ) AS rejected_intent_count
       FROM event_lanes AS lane
       JOIN event_lane_taxonomy_states AS state
         ON state.lane_id = lane.id
       WHERE lane.id = 'lane-cms-history'`,
    )
    .first();
  assert.deepEqual(
    {
      activeIntentId: retained?.active_intent_id,
      deletedAt: retained?.deleted_at,
      rejectedIntentCount: retained?.rejected_intent_count,
    },
    {
      activeIntentId: null,
      deletedAt: 50,
      rejectedIntentCount: 0,
    },
  );
});

test("taxonomy adoption refuses over-cap legacy rows without a marker or partial history", async (t) => {
  const database = migratedDatabase();
  t.after(() => database.close());
  seedOrganization(database);
  const values = Array.from(
    { length: 101 },
    (_, index) =>
      `(
        'legacy-lane-${index}', 'org-a', 'Legacy Lane ${index}',
        'legacy-lane-${index}', ${index * 10},
        'profile-a', 1, 1
      )`,
  ).join(",\n");
  database.exec(`
    INSERT INTO database_invariant_state (
      singleton_key, version, trigger_fingerprint, verified_at
    ) VALUES (
      'database-guards', 6,
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      1
    );
    INSERT INTO event_lanes (
      id, organization_id, name, slug, sort_order,
      created_by_profile_id, created_at, updated_at
    ) VALUES ${values};
  `);
  await assert.rejects(
    ensureDatabaseInvariants(
      distinctDatabaseBinding(database),
      DATABASE_INVARIANT_VERSION,
    ),
    { name: "DatabaseInvariantError" },
  );
  const residue = await database
    .prepare(
      `SELECT
         (SELECT count(*) FROM taxonomy_write_intents) AS intents,
         (SELECT count(*) FROM event_lane_taxonomy_states) AS states,
         (SELECT count(*) FROM database_invariant_state
          WHERE singleton_key = 'database-guards') AS marker`,
    )
    .first();
  assert.deepEqual(
    {
      intents: residue?.intents,
      marker: residue?.marker,
      states: residue?.states,
    },
    { intents: 0, marker: 0, states: 0 },
  );
});
