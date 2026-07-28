import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";
import {
  OrganizerAccessDeniedError,
  authorizeOrganizerAccess,
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import {
  ensureDatabaseInvariants,
} from "../../lib/server/database/invariants.ts";
import {
  runRequestMaintenance,
} from "../../lib/server/database/request-maintenance.ts";
import {
  PHASE6_INVARIANT_COUNT_SQL,
} from "../../lib/server/database/phase6-invariant-sql.ts";
import {
  configureMeetupCalendarSource,
  getMeetupConnectionState,
  ensureMeetupProgramClubs,
} from "../../lib/server/meetup/index.ts";
import {
  getUnreadNotificationCount,
} from "../../lib/server/organizer/notifications.ts";
import {
  getOrganizerProfile,
} from "../../lib/server/organizer/profiles.ts";
import {
  getWorkspaceSettings,
} from "../../lib/server/organizer/settings.ts";
import {
  ensurePublicCatalog,
  getPublicClubBySlug,
  getPublicPageContent,
  getPublicProgramBySlugs,
  getPublicSiteContext,
  getPublicSlugRedirect,
  listPublicClubs,
  listPublicCommunityLinks,
  listPublicLanes,
  listPublicNavigation,
  listPublicProgramsForClub,
  loadPublicCatalog,
  resolvePublicOrganization,
} from "../../lib/server/public/catalog.ts";
import {
  listPublicCatalogSitemapEntries,
} from "../../lib/server/public/sitemap.ts";
import {
  PUBLIC_CATALOG_LANES,
} from "../../lib/server/public/catalog-definitions.ts";
import {
  productionMigrationFragments,
} from "../../scripts/d1-migration-batches.mjs";
import { ensureDatabaseInvariantsReady } from "../database/invariant-ready.mjs";

const MAX_D1_BINDINGS = 100;
const MAX_D1_STATEMENT_BYTES = 100_000;
const CATALOG_OWNER = trustedIdentityFromSites({
  displayName: "Catalog owner",
  email: "catalog-owner@example.com",
});
const CATALOG_FEED_URL =
  "https://www.meetup.com/vancouver-meetup-group/events/ical/";

const workerScript = `
export default {
  async fetch(request, env) {
    const input = await request.json();
    try {
      let statement = env.DB.prepare(input.sql);
      if (input.bindings.length > 0) {
        statement = statement.bind(...input.bindings);
      }
      const result =
        input.mode === "first"
          ? await statement.first()
          : input.mode === "run"
            ? await statement.run()
            : await statement.all();
      return Response.json({ ok: true, result });
    } catch (error) {
      return Response.json({
        ok: false,
        error: String(error?.message ?? error),
      });
    }
  },
};
`;

async function applyProductionMigrations(database) {
  for (
    const name of (await readdir(join(process.cwd(), "drizzle")))
      .filter((candidate) => candidate.endsWith(".sql"))
      .sort()
  ) {
    const sql = await readFile(join(process.cwd(), "drizzle", name), "utf8");
    for (const statement of productionMigrationFragments(sql)) {
      await database.prepare(statement).run();
    }
  }
}

async function seedCatalogOwner(database) {
  await database
    .prepare(
      `INSERT INTO profiles (
         id, siwc_subject, normalized_email, display_name, status,
         created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, 'active', ?, ?, NULL)`,
    )
    .bind(
      "catalog-owner-profile",
      "email:catalog-owner@example.com",
      "catalog-owner@example.com",
      "Catalog owner",
      1,
      1,
    )
    .run();
  await database
    .prepare(
      `INSERT INTO organizations (
         id, name, slug, timezone, owner_bootstrap_closed_at,
         owner_bootstrap_claimed_by_profile_id, created_by_profile_id,
         created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      "catalog-organization",
      "Catalog organization",
      "vancouver-curiosity-and-education-society",
      "America/Vancouver",
      1,
      "catalog-owner-profile",
      "catalog-owner-profile",
      1,
      1,
    )
    .run();
  await database
    .prepare(
      `INSERT INTO organization_memberships (
         id, organization_id, profile_id, normalized_email, role, status,
         created_by_profile_id, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?, ?, NULL)`,
    )
    .bind(
      "catalog-owner-membership",
      "catalog-organization",
      "catalog-owner-profile",
      "catalog-owner@example.com",
      "catalog-owner-profile",
      1,
      1,
    )
    .run();
}

function traceCatalogBatches(
  database,
  {
    beforeFirstBatch = null,
    synchronizeCatalogReads = false,
  } = {},
) {
  const batches = [];
  let batchCalls = 0;
  let catalogReads = 0;
  let releaseCatalogReads;
  const catalogReadGate = new Promise((resolve) => {
    releaseCatalogReads = resolve;
  });
  return {
    batches,
    database: {
      prepare(sql) {
        const statement = database.prepare(sql);
        if (
          !synchronizeCatalogReads ||
          !sql.includes("AS lane_slugs_json")
        ) {
          return statement;
        }
        return {
          bind(...bindings) {
            const bound = statement.bind(...bindings);
            return {
              all: (...args) => bound.all(...args),
              async first(...args) {
                const result = await bound.first(...args);
                catalogReads += 1;
                if (catalogReads === 2) releaseCatalogReads();
                await catalogReadGate;
                return result;
              },
              run: (...args) => bound.run(...args),
            };
          },
        };
      },
      async batch(statements) {
        if (batchCalls === 0 && beforeFirstBatch !== null) {
          await beforeFirstBatch();
        }
        batchCalls += 1;
        const results = await database.batch(statements);
        batches.push(
          results.map((result) => ({
            changes: result.meta?.changes,
            success: result.success,
          })),
        );
        return results;
      },
    },
  };
}

function countD1Statements(database) {
  let count = 0;
  const batchLengths = [];
  const innerStatement = new WeakMap();
  const wrap = (statement) => {
    const wrapped = {
      bind(...bindings) {
        return wrap(statement.bind(...bindings));
      },
      async all(...args) {
        count += 1;
        return statement.all(...args);
      },
      async first(...args) {
        count += 1;
        return statement.first(...args);
      },
      async run(...args) {
        count += 1;
        return statement.run(...args);
      },
    };
    innerStatement.set(wrapped, statement);
    return wrapped;
  };
  return {
    database: {
      prepare(sql) {
        return wrap(database.prepare(sql));
      },
      async batch(statements) {
        count += statements.length;
        batchLengths.push(statements.length);
        return database.batch(
          statements.map((statement) => innerStatement.get(statement)),
        );
      },
    },
    get count() {
      return count;
    },
    get batchLengths() {
      return [...batchLengths];
    },
  };
}

async function loadOrganizerContext(database, initialOwnerEmail = null) {
  const membership = await authorizeOrganizerAccess(database, CATALOG_OWNER, {
    initialOwnerEmail,
  });
  await Promise.all([
    getWorkspaceSettings(database, CATALOG_OWNER),
    getOrganizerProfile(database, CATALOG_OWNER),
    getUnreadNotificationCount(database, membership),
  ]);
  return membership;
}

async function runOrganizerMeetupGet(
  database,
  { initialOwnerEmail = null, nowUtcMs = 2_000 } = {},
) {
  assert.equal(await ensureDatabaseInvariants(database), "ready");
  assert.deepEqual(
    await runRequestMaintenance(database, {
      method: "GET",
      pathname: "/organizer/meetup",
    }),
    { kind: "continue" },
  );
  const layoutContext = await loadOrganizerContext(
    database,
    initialOwnerEmail,
  );
  const pageContext = await loadOrganizerContext(
    database,
    initialOwnerEmail,
  );
  assert.equal(
    pageContext.organizationId,
    layoutContext.organizationId,
    "layout and page must resolve the same live organization",
  );
  await getMeetupConnectionState(database, CATALOG_OWNER, nowUtcMs);
  return ensureMeetupProgramClubs(database, CATALOG_OWNER, nowUtcMs);
}

async function runOrganizerMeetupConnect(
  database,
  { initialOwnerEmail = null, nowUtcMs = 2_000 } = {},
) {
  assert.equal(await ensureDatabaseInvariants(database), "ready");
  assert.deepEqual(
    await runRequestMaintenance(database, {
      method: "POST",
      pathname: "/api/organizer/meetup/connect",
    }),
    { kind: "continue" },
  );
  await authorizeOrganizerAccess(database, CATALOG_OWNER, {
    initialOwnerEmail,
  });
  const clubs = await ensureMeetupProgramClubs(
    database,
    CATALOG_OWNER,
    nowUtcMs,
  );
  return configureMeetupCalendarSource(
    database,
    CATALOG_OWNER,
    {
      clubId: clubs[0].id,
      feedUrl: CATALOG_FEED_URL,
    },
    nowUtcMs,
  );
}

function assertD1InvocationCount(counter, expected, label) {
  assert.equal(counter.count, expected, `${label} statement trace drifted`);
  assert.ok(counter.count <= 50, `${label} exceeded the D1 request cap`);
  assert.ok(
    counter.batchLengths.every((length) => length <= 50),
    `${label} contained an oversized D1 batch`,
  );
}

async function assertExactCatalogTaxonomy(
  database,
  { catalogVersionPresent = true } = {},
) {
  const rows = await database
    .prepare(
      `SELECT lane.slug, state.content_version, state.active_intent_id,
              state.last_completed_intent_id, intent.completed_at,
              lane.name, lane.description, lane.sort_order,
              intent.proposed_name, intent.proposed_slug,
              intent.proposed_description, intent.proposed_sort_order,
              json_extract(audit.metadata_json, '$.source') AS audit_source,
              count(audit.id) AS audit_count
       FROM event_lanes AS lane
       JOIN event_lane_taxonomy_states AS state
         ON state.lane_id = lane.id
        AND state.organization_id = lane.organization_id
       JOIN taxonomy_write_intents AS intent
         ON intent.id = state.last_completed_intent_id
        AND intent.organization_id = lane.organization_id
        AND intent.entity_type = 'lane'
        AND intent.entity_id = lane.id
        AND intent.operation = 'create'
       LEFT JOIN audit_logs AS audit
         ON audit.organization_id = lane.organization_id
        AND audit.action = 'taxonomy.lane_created'
        AND audit.entity_type = 'event_lane'
        AND audit.entity_id = lane.id
        AND json_extract(audit.metadata_json, '$.writeIntentId') = intent.id
       WHERE lane.organization_id = ?
       GROUP BY lane.id
       ORDER BY lane.sort_order, lane.slug`,
    )
    .bind("catalog-organization")
    .all();
  assert.deepEqual(
    rows.results.map((row) => ({
      activeIntentId: row.active_intent_id,
      auditCount: row.audit_count,
      auditSource: row.audit_source,
      completedAt: row.completed_at,
      contentVersion: row.content_version,
      description: row.description,
      hasCompletedIntent: typeof row.last_completed_intent_id === "string",
      name: row.name,
      proposedDescription: row.proposed_description,
      proposedName: row.proposed_name,
      proposedSlug: row.proposed_slug,
      proposedSortOrder: row.proposed_sort_order,
      slug: row.slug,
      sortOrder: row.sort_order,
    })),
    PUBLIC_CATALOG_LANES.map((lane) => ({
      activeIntentId: null,
      auditCount: 1,
      auditSource: "public_catalog_fill_only",
      completedAt: 2_000,
      contentVersion: 1,
      description: lane.description,
      hasCompletedIntent: true,
      name: lane.name,
      proposedDescription: lane.description,
      proposedName: lane.name,
      proposedSlug: lane.slug,
      proposedSortOrder: lane.sortOrder,
      slug: lane.slug,
      sortOrder: lane.sortOrder,
    })),
  );
  const incomplete = await database
    .prepare(
      `SELECT (
         SELECT count(*)
         FROM taxonomy_write_intents AS intent
         WHERE intent.organization_id = ?
           AND intent.entity_type = 'lane'
           AND intent.completed_at IS NULL
       ) + (
         SELECT count(*)
         FROM event_lane_taxonomy_states AS state
         WHERE state.organization_id = ?
           AND state.active_intent_id IS NOT NULL
       ) AS count`,
    )
    .bind("catalog-organization", "catalog-organization")
    .first();
  assert.equal(incomplete?.count, 0);
  const catalogMarker = await database
    .prepare(
      `SELECT value_json
       FROM site_settings
       WHERE organization_id = ?
         AND key = 'public_catalog_version'`,
    )
    .bind("catalog-organization")
    .first();
  assert.equal(
    catalogMarker?.value_json,
    catalogVersionPresent ? "1" : undefined,
  );
  const invariantMarker = await database
    .prepare(
      `SELECT version
       FROM database_invariant_state
       WHERE singleton_key = 'database-guards'`,
    )
    .first();
  assert.equal(
    invariantMarker,
    null,
    "the guarded taxonomy mutation must invalidate runtime readiness",
  );
  const taxonomyIntegrity = await database
    .prepare(PHASE6_INVARIANT_COUNT_SQL.at(-1))
    .first();
  assert.equal(taxonomyIntegrity?.violation_count, 0);
}

test("receipt-backed catalog and sitemap readers execute through real Miniflare D1", async () => {
  const miniflare = new Miniflare({
    d1Databases: { DB: randomUUID() },
    modules: true,
    script: workerScript,
  });
  try {
    const request = async (payload) => {
      const response = await miniflare.dispatchFetch("http://d1.test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      assert.equal(body.ok, true, body.error);
      return body.result;
    };

    for (
      const name of (await readdir(join(process.cwd(), "drizzle")))
        .filter((candidate) => candidate.endsWith(".sql"))
        .sort()
    ) {
      const sql = await readFile(join(process.cwd(), "drizzle", name), "utf8");
      for (const statement of productionMigrationFragments(sql)) {
        await request({
          bindings: [],
          mode: "run",
          sql: statement,
        });
      }
    }

    const prepared = [];
    const database = {
      prepare(sql) {
        const bytes = new TextEncoder().encode(sql).byteLength;
        assert.ok(
          bytes < MAX_D1_STATEMENT_BYTES,
          `D1 statement is ${bytes} bytes`,
        );
        prepared.push({ bytes, sql });
        return {
          bind(...bindings) {
            assert.ok(
              bindings.length < MAX_D1_BINDINGS,
              `D1 statement uses ${bindings.length} bindings`,
            );
            return {
              all: () => request({ bindings, mode: "all", sql }),
              first: () => request({ bindings, mode: "first", sql }),
              run: () => request({ bindings, mode: "run", sql }),
            };
          },
        };
      },
    };

    assert.equal(await resolvePublicOrganization(database), null);
    assert.equal(await getPublicSiteContext(database), null);
    assert.deepEqual(await listPublicLanes(database), []);
    assert.deepEqual(await listPublicClubs(database), []);
    assert.equal(await getPublicClubBySlug(database, "missing-club"), null);

    const programListIndex = prepared.length;
    assert.deepEqual(
      await listPublicProgramsForClub(database, "missing-club"),
      [],
    );
    const programList = prepared[programListIndex];
    assert.ok(programList.sql.includes("program_public_profile_details"));

    const programDetailIndex = prepared.length;
    assert.equal(
      await getPublicProgramBySlugs(
        database,
        "missing-club",
        "missing-program",
      ),
      null,
    );
    const programDetail = prepared[programDetailIndex];
    assert.ok(programDetail.sql.includes("program_public_profile_details"));
    assert.ok(programList.bytes < MAX_D1_STATEMENT_BYTES);
    assert.ok(programDetail.bytes < MAX_D1_STATEMENT_BYTES);

    assert.equal(
      await getPublicSlugRedirect(database, {
        entityType: "page",
        fromSlug: "missing-page",
      }),
      null,
    );
    assert.deepEqual(await listPublicCommunityLinks(database), []);
    await listPublicNavigation(database);
    assert.equal(await getPublicPageContent(database, "missing-page"), null);
    assert.equal(await loadPublicCatalog(database), null);
    assert.deepEqual(
      await listPublicCatalogSitemapEntries(database, "missing-org"),
      {
        clubs: [],
        pages: [],
        programs: [],
      },
    );
    assert.ok(
      prepared.length >= 17,
      `expected every catalog/sitemap query family, saw ${prepared.length}`,
    );
  } finally {
    await miniflare.dispose();
  }
});

test("public catalog taxonomy seed accepts only the exact D1 marker side effect", async (t) => {
  for (const markerPresent of [true, false]) {
    await t.test(
      markerPresent ? "ready marker present" : "ready marker absent",
      async () => {
        const miniflare = new Miniflare({
          d1Databases: { DB: randomUUID() },
          modules: true,
          script: workerScript,
        });
        try {
          const database = await miniflare.getD1Database("DB");
          await applyProductionMigrations(database);
          await seedCatalogOwner(database);
          const readiness = await ensureDatabaseInvariantsReady(database);
          assert.equal(readiness.at(-1), "ready");
          if (!markerPresent) {
            await database
              .prepare(
                `DELETE FROM database_invariant_state
                 WHERE singleton_key = 'database-guards'`,
              )
              .run();
          }

          const traced = traceCatalogBatches(database);
          await ensurePublicCatalog(traced.database, CATALOG_OWNER, 2_000);
          assert.deepEqual(
            traced.batches[0],
            [
              { changes: markerPresent ? 5 : 4, success: true },
              { changes: 4, success: true },
              { changes: 4, success: true },
              { changes: 4, success: true },
              { changes: 4, success: true },
              { changes: 4, success: true },
            ],
          );
          await assertExactCatalogTaxonomy(database);

          const batchCount = traced.batches.length;
          await ensurePublicCatalog(traced.database, CATALOG_OWNER, 3_000);
          await Promise.all([
            ensurePublicCatalog(traced.database, CATALOG_OWNER, 4_000),
            ensurePublicCatalog(traced.database, CATALOG_OWNER, 4_001),
            ensurePublicCatalog(traced.database, CATALOG_OWNER, 4_002),
          ]);
          assert.equal(
            traced.batches.length,
            batchCount,
            "repeated and concurrent retries must be read-only",
          );
          await assertExactCatalogTaxonomy(database);
        } finally {
          await miniflare.dispose();
        }
      },
    );
  }
});

test("set-based catalog seed rolls back all catalog rows when its final statement fails and then retries cleanly", async () => {
  const miniflare = new Miniflare({
    d1Databases: { DB: randomUUID() },
    modules: true,
    script: workerScript,
  });
  try {
    const database = await miniflare.getD1Database("DB");
    await applyProductionMigrations(database);
    await seedCatalogOwner(database);
    const readiness = await ensureDatabaseInvariantsReady(database);
    assert.equal(readiness.at(-1), "ready");

    const failingDatabase = {
      prepare(sql) {
        if (
          sql.includes("INSERT INTO site_settings") &&
          sql.includes("'public_catalog_version'")
        ) {
          return database.prepare(
            `INSERT INTO deliberately_missing_catalog_batch_table (
               a, b, c, d, e, f
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          );
        }
        return database.prepare(sql);
      },
      batch(statements) {
        return database.batch(statements);
      },
    };
    await assert.rejects(
      ensurePublicCatalog(failingDatabase, CATALOG_OWNER, 2_000),
      /no such table|catalog batch/u,
    );

    const residue = await database
      .prepare(
        `SELECT
           (SELECT count(*) FROM clubs) AS clubs,
           (SELECT count(*) FROM pages) AS pages,
           (SELECT count(*) FROM club_public_profiles) AS profiles,
           (SELECT count(*) FROM page_sections) AS sections,
           (SELECT count(*) FROM community_links) AS community_links,
           (
             SELECT count(*)
             FROM site_settings
             WHERE key IN ('public_identity', 'public_catalog_version')
           ) AS settings`,
      )
      .first();
    assert.deepEqual(
      { ...residue },
      {
        clubs: 0,
        community_links: 0,
        pages: 0,
        profiles: 0,
        sections: 0,
        settings: 0,
      },
      "a failed seven-statement catalog batch must leave no catalog or version residue",
    );
    await assertExactCatalogTaxonomy(database, {
      catalogVersionPresent: false,
    });

    await ensurePublicCatalog(database, CATALOG_OWNER, 3_000);
    await assertExactCatalogTaxonomy(database);
    assert.equal(
      await database
        .prepare(
          `SELECT count(*)
           FROM site_settings
           WHERE organization_id = ?
             AND key = 'public_catalog_version'
             AND value_json = ?`,
        )
        .bind("catalog-organization", JSON.stringify(1))
        .first("count(*)"),
      1,
    );
  } finally {
    await miniflare.dispose();
  }
});

test("catalog and Meetup first-run services retain D1 budget headroom with one live authorization", async (t) => {
  for (const service of ["catalog", "meetup"]) {
    await t.test(service, async () => {
      const miniflare = new Miniflare({
        d1Databases: { DB: randomUUID() },
        modules: true,
        script: workerScript,
      });
      try {
        const database = await miniflare.getD1Database("DB");
        await applyProductionMigrations(database);
        await seedCatalogOwner(database);
        const readiness = await ensureDatabaseInvariantsReady(database);
        assert.equal(readiness.at(-1), "ready");

        const counted = countD1Statements(database);
        if (service === "catalog") {
          await ensurePublicCatalog(
            counted.database,
            CATALOG_OWNER,
            2_000,
          );
        } else {
          const clubs = await ensureMeetupProgramClubs(
            counted.database,
            CATALOG_OWNER,
            2_000,
          );
          assert.equal(clubs.length, 3);
        }
        const expected = service === "catalog" ? 16 : 17;
        assert.equal(counted.count, expected);
        assert.ok(counted.count < 50);
        await assertExactCatalogTaxonomy(database);
      } finally {
        await miniflare.dispose();
      }
    });
  }
});

test("real D1 Meetup route compositions include maintenance plus both organizer GET contexts", async (t) => {
  const cases = [
    {
      binding: "GET_HEALTHY",
      expected: 23,
      label: "GET healthy catalog",
      method: "get",
      seedCatalog: true,
      seedOwner: true,
    },
    {
      binding: "GET_FRESH",
      expected: 37,
      label: "GET existing owner with fresh catalog",
      method: "get",
      seedCatalog: false,
      seedOwner: true,
    },
    {
      binding: "GET_FIRST_OWNER",
      expected: 43,
      initialOwnerEmail: CATALOG_OWNER.email,
      label: "GET first owner with fresh catalog",
      method: "get",
      seedCatalog: false,
      seedOwner: false,
    },
    {
      binding: "POST_HEALTHY",
      expected: 14,
      label: "POST healthy catalog with a new source",
      method: "post",
      seedCatalog: true,
      seedOwner: true,
    },
    {
      binding: "POST_FRESH",
      expected: 28,
      label: "POST existing owner with fresh catalog and a new source",
      method: "post",
      seedCatalog: false,
      seedOwner: true,
    },
    {
      binding: "POST_FIRST_OWNER",
      expected: 34,
      initialOwnerEmail: CATALOG_OWNER.email,
      label: "POST first owner with fresh catalog and a new source",
      method: "post",
      seedCatalog: false,
      seedOwner: false,
    },
    {
      binding: "POST_RETRY",
      expected: 11,
      label: "POST healthy exact-source retry",
      method: "post",
      seedCatalog: true,
      seedOwner: true,
      seedSource: true,
    },
  ];

  const miniflare = new Miniflare({
    d1Databases: Object.fromEntries(
      cases.map(({ binding }) => [binding, randomUUID()]),
    ),
    modules: true,
    script: workerScript,
  });
  try {
    for (const scenario of cases) {
      await t.test(scenario.label, async () => {
        const database = await miniflare.getD1Database(scenario.binding);
        await applyProductionMigrations(database);
        if (scenario.seedOwner) {
          await seedCatalogOwner(database);
        }
        const readiness = await ensureDatabaseInvariantsReady(database);
        assert.equal(readiness.at(-1), "ready");

        if (scenario.seedCatalog) {
          const clubs = await ensureMeetupProgramClubs(
            database,
            CATALOG_OWNER,
            1_000,
          );
          if (scenario.seedSource) {
            await configureMeetupCalendarSource(
              database,
              CATALOG_OWNER,
              {
                clubId: clubs[0].id,
                feedUrl: CATALOG_FEED_URL,
              },
              1_000,
            );
          }
        }
        const postSeedReadiness =
          await ensureDatabaseInvariantsReady(database);
        assert.equal(postSeedReadiness.at(-1), "ready");

        const counted = countD1Statements(database);
        if (scenario.method === "get") {
          await runOrganizerMeetupGet(counted.database, {
            initialOwnerEmail: scenario.initialOwnerEmail,
          });
        } else {
          await runOrganizerMeetupConnect(counted.database, {
            initialOwnerEmail: scenario.initialOwnerEmail,
          });
        }
        assertD1InvocationCount(
          counted,
          scenario.expected,
          scenario.label,
        );
      });
    }
  } finally {
    await miniflare.dispose();
  }
});

test("catalog and Meetup initialization cannot bypass live external authorization", async () => {
  const miniflare = new Miniflare({
    d1Databases: { DB: randomUUID() },
    modules: true,
    script: workerScript,
  });
  try {
    const database = await miniflare.getD1Database("DB");
    await applyProductionMigrations(database);
    await seedCatalogOwner(database);
    const readiness = await ensureDatabaseInvariantsReady(database);
    assert.equal(readiness.at(-1), "ready");
    const unknownIdentity = trustedIdentityFromSites({
      displayName: "Unknown organizer",
      email: "unknown-organizer@example.com",
    });
    await assert.rejects(
      ensurePublicCatalog(database, unknownIdentity, 2_000),
      OrganizerAccessDeniedError,
    );
    await assert.rejects(
      ensureMeetupProgramClubs(database, unknownIdentity, 2_000),
      OrganizerAccessDeniedError,
    );
    assert.equal(
      await database
        .prepare(
          `SELECT count(*) AS count
           FROM site_settings
           WHERE key = 'public_catalog_version'`,
        )
        .first("count"),
      0,
    );
  } finally {
    await miniflare.dispose();
  }
});

test("public catalog seed survives both invariant-marker TOCTOU orderings", async (t) => {
  for (const race of ["delete-before-batch", "repair-before-batch"]) {
    await t.test(race, async () => {
      const miniflare = new Miniflare({
        d1Databases: { DB: randomUUID() },
        modules: true,
        script: workerScript,
      });
      try {
        const database = await miniflare.getD1Database("DB");
        await applyProductionMigrations(database);
        await seedCatalogOwner(database);
        const readiness = await ensureDatabaseInvariantsReady(database);
        assert.equal(readiness.at(-1), "ready");
        if (race === "repair-before-batch") {
          await database
            .prepare(
              `DELETE FROM database_invariant_state
               WHERE singleton_key = 'database-guards'`,
            )
            .run();
        }

        const traced = traceCatalogBatches(database, {
          async beforeFirstBatch() {
            if (race === "delete-before-batch") {
              await database
                .prepare(
                  `DELETE FROM database_invariant_state
                   WHERE singleton_key = 'database-guards'`,
                )
                .run();
              return;
            }
            const repaired = await ensureDatabaseInvariantsReady(database);
            assert.equal(repaired.at(-1), "ready");
          },
        });
        await ensurePublicCatalog(traced.database, CATALOG_OWNER, 2_000);
        assert.deepEqual(traced.batches[0], [
          {
            changes: race === "delete-before-batch" ? 4 : 5,
            success: true,
          },
          { changes: 4, success: true },
          { changes: 4, success: true },
          { changes: 4, success: true },
          { changes: 4, success: true },
          { changes: 4, success: true },
        ]);
        await assertExactCatalogTaxonomy(database);
      } finally {
        await miniflare.dispose();
      }
    });
  }
});

test("simultaneous public catalog first runs converge to one taxonomy envelope", async () => {
  const miniflare = new Miniflare({
    d1Databases: { DB: randomUUID() },
    modules: true,
    script: workerScript,
  });
  try {
    const database = await miniflare.getD1Database("DB");
    await applyProductionMigrations(database);
    await seedCatalogOwner(database);
    const readiness = await ensureDatabaseInvariantsReady(database);
    assert.equal(readiness.at(-1), "ready");

    const traced = traceCatalogBatches(database, {
      synchronizeCatalogReads: true,
    });
    await Promise.all([
      ensurePublicCatalog(traced.database, CATALOG_OWNER, 2_000),
      ensurePublicCatalog(traced.database, CATALOG_OWNER, 2_000),
    ]);
    const taxonomyBatches = traced.batches.filter(
      (batch) => batch.length === 6,
    );
    assert.deepEqual(taxonomyBatches, [
      [
        { changes: 5, success: true },
        { changes: 4, success: true },
        { changes: 4, success: true },
        { changes: 4, success: true },
        { changes: 4, success: true },
        { changes: 4, success: true },
      ],
    ]);
    await assertExactCatalogTaxonomy(database);

    const batchCount = traced.batches.length;
    await Promise.all([
      ensurePublicCatalog(traced.database, CATALOG_OWNER, 3_000),
      ensurePublicCatalog(traced.database, CATALOG_OWNER, 3_001),
    ]);
    assert.equal(traced.batches.length, batchCount);
    await assertExactCatalogTaxonomy(database);
  } finally {
    await miniflare.dispose();
  }
});
