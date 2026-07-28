import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { trustedIdentityFromSites } from "../../lib/server/auth/index.ts";
import {
  DATABASE_INVARIANT_VERSION,
  ensureDatabaseInvariants,
} from "../../lib/server/database/invariants.ts";
import {
  CMS_ADOPTION_VERSION,
  CmsAdoptionError,
  ensureCmsAdoption,
} from "../../lib/server/organizer/cms-adoption.ts";
import {
  ensurePublicCatalog,
  getPublicSiteContext,
} from "../../lib/server/public/catalog.ts";
import { MAX_DATABASE_INVARIANT_READY_ATTEMPTS } from "../database/invariant-ready.mjs";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const OWNER_IDENTITY = trustedIdentityFromSites({
  displayName: "Phase 6 adoption owner",
  email: "phase6-adoption-owner@example.test",
});
const OWNER = Object.freeze({
  membershipId: "membership-phase6-adoption-owner",
  organizationId: "organization-phase6-adoption",
  profileId: "profile-phase6-adoption-owner",
  role: "owner",
});

function migrationSql() {
  return readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) =>
      readFileSync(join(process.cwd(), "drizzle", name), "utf8"),
    )
    .join("\n");
}

async function createPopulatedPhase5Database() {
  const database = new SqliteD1TestDatabase(migrationSql());
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      '${OWNER.profileId}', 'email:phase6-adoption-owner@example.test',
      'phase6-adoption-owner@example.test', 'Phase 6 adoption owner',
      'active', 1, 1
    );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      owner_bootstrap_claimed_by_profile_id, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      '${OWNER.organizationId}', 'Vancouver Curiosity Club',
      'vancouver-curiosity-and-education-society', 'America/Vancouver',
      1, '${OWNER.profileId}', '${OWNER.profileId}', 1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      '${OWNER.membershipId}', '${OWNER.organizationId}', '${OWNER.profileId}',
      'phase6-adoption-owner@example.test', 'owner', 'active',
      '${OWNER.profileId}', 1, 1
    );
  `);
  await ensurePublicCatalog(database, OWNER_IDENTITY, 2_000);
  await ensureInvariantReadiness(database);
  return database;
}

test("populated Phase 5 content adopts atomically without changing its public facts", async (t) => {
  const database = await createPopulatedPhase5Database();
  t.after(() => database.close());
  database.exec(`
    INSERT INTO community_links (
      id, organization_id, label, url, link_type, is_published, sort_order,
      created_by_profile_id, created_at, updated_at, deleted_at
    ) VALUES (
      'community-unconfirmed-crafted', '${OWNER.organizationId}',
      'Unconfirmed destination', 'https://example.test/unconfirmed',
      'other', 1, 99, '${OWNER.profileId}', 2, 2, NULL
    );
  `);
  const before = await publicProjectionSnapshot(database);
  const counter = countedBinding(database);

  assert.equal(
    await ensureCmsAdoption(counter.binding, OWNER, 10_000),
    "adopted",
  );
  assert.deepEqual(counter.counts(), {
    batchLengths: [11],
    statementCount: 20,
  });
  const after = await publicProjectionSnapshot(database);
  assert.deepEqual(
    after.filter(({ table }) => table !== "site_settings"),
    before.filter(({ table }) => table !== "site_settings"),
  );
  const priorIdentity = JSON.parse(
    before
      .find(({ table }) => table === "site_settings")
      .rows.find(({ key }) => key === "public_identity").value_json,
  );
  const adoptedIdentity = JSON.parse(
    after
      .find(({ table }) => table === "site_settings")
      .rows.find(({ key }) => key === "public_identity").value_json,
  );
  assert.deepEqual(
    {
      brandName: adoptedIdentity.brandName,
      locationLabel: adoptedIdentity.locationLabel,
      mission: adoptedIdentity.mission,
      tagline: adoptedIdentity.tagline,
    },
    priorIdentity,
  );
  assert.deepEqual(adoptedIdentity, {
    brandName: "Vancouver Curiosity Club",
    footerMission:
      "Thoughtful events for people who like learning in company.",
    locationLabel: "Vancouver, British Columbia",
    logoAssetId: null,
    metaDescription:
      "Thoughtful events for people who like learning in company.",
    mission: "Thoughtful events for people who like learning in company.",
    openGraphAssetId: null,
    palette: {
      accent: "#2156D8",
      background: "#F5F0E6",
      foreground: "#142C30",
      secondary: "#0C665E",
    },
    seoTitle: "Vancouver Curiosity Club",
    tagline: "A social calendar with a brain.",
    typography: "editorial",
  });
  assert.equal(
    (await getPublicSiteContext(database))?.brandName,
    "Vancouver Curiosity Club",
  );
  assert.equal(
    (
      await database
      .prepare(
        `SELECT adoption_version
         FROM cms_adoption_states
         WHERE organization_id = ?`,
      )
      .bind(OWNER.organizationId)
      .first()
    ).adoption_version,
    CMS_ADOPTION_VERSION,
  );

  const expectedStateCount =
    Number(await database.prepare(
      `SELECT count(*) AS count
       FROM pages
       WHERE organization_id = '${OWNER.organizationId}'
         AND deleted_at IS NULL`,
    ).first("count")) +
    Number(await database.prepare(
      `SELECT count(*) AS count
       FROM club_public_profiles
       WHERE organization_id = '${OWNER.organizationId}'
         AND deleted_at IS NULL`,
    ).first("count")) +
    Number(await database.prepare(
      `SELECT count(*) AS count
       FROM community_links
       WHERE organization_id = '${OWNER.organizationId}'
         AND deleted_at IS NULL`,
    ).first("count")) +
    8;
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM cms_entity_publication_states
         WHERE organization_id = ?`,
      )
      .bind(OWNER.organizationId)
      .first("count"),
    expectedStateCount,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM cms_entity_revisions
         WHERE organization_id = ?`,
      )
      .bind(OWNER.organizationId)
      .first("count"),
    expectedStateCount,
  );
  assert.deepEqual(
    (
      await database
        .prepare(
          `SELECT link.url
           FROM community_link_public_details AS detail
           JOIN community_links AS link
             ON link.id = detail.community_link_id
            AND link.organization_id = detail.organization_id
           WHERE detail.organization_id = ?
           ORDER BY link.url`,
        )
        .bind(OWNER.organizationId)
        .all()
    ).results.map(({ url }) => url),
    [
      "https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/",
      "https://www.meetup.com/vancouver-literature-and-film/",
      "https://www.meetup.com/vancouver-meetup-group/",
    ],
  );
  const unconfirmed = await database
      .prepare(
        `SELECT state.workflow_status, detail.community_link_id
         FROM cms_entity_publication_states AS state
         LEFT JOIN community_link_public_details AS detail
           ON detail.community_link_id = state.entity_key
          AND detail.organization_id = state.organization_id
         WHERE state.organization_id = ?
           AND state.entity_type = 'community_link'
           AND state.entity_key = 'community-unconfirmed-crafted'`,
      )
      .bind(OWNER.organizationId)
      .first();
  assert.equal(unconfirmed?.community_link_id, null);
  assert.equal(unconfirmed?.workflow_status, "draft");

  const repeat = countedBinding(database);
  assert.equal(await ensureCmsAdoption(repeat.binding, OWNER, 20_000), "ready");
  assert.deepEqual(repeat.counts(), {
    batchLengths: [],
    statementCount: 1,
  });
});

test("concurrent fresh service instances converge without duplicate states or revisions", async (t) => {
  const database = await createPopulatedPhase5Database();
  t.after(() => database.close());
  const first = countedBinding(database);
  const second = countedBinding(database);

  assert.deepEqual(
    (
      await Promise.all([
        ensureCmsAdoption(first.binding, OWNER, 30_000),
        ensureCmsAdoption(second.binding, OWNER, 30_000),
      ])
    ).sort(),
    ["adopted", "ready"],
  );
  assert.ok(first.counts().statementCount <= 21);
  assert.ok(second.counts().statementCount <= 21);
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM cms_entity_publication_states AS state
         JOIN cms_entity_revisions AS revision
           ON revision.publication_state_id = state.id
          AND revision.organization_id = state.organization_id
         WHERE state.organization_id = ?`,
      )
      .bind(OWNER.organizationId)
      .first("count"),
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM cms_entity_publication_states
         WHERE organization_id = ?`,
      )
      .bind(OWNER.organizationId)
      .first("count"),
  );
});

test("malformed source data and a source mutation race leave no marker or partial editorial rows", async (t) => {
  const malformed = await createPopulatedPhase5Database();
  t.after(() => malformed.close());
  malformed.exec(`
    UPDATE page_sections
    SET section_type = 'script',
        content_json = '{}'
    WHERE id = (
      SELECT id
      FROM page_sections
      WHERE organization_id = '${OWNER.organizationId}'
      LIMIT 1
    );
  `);
  await assert.rejects(
    ensureCmsAdoption(malformed, OWNER, 40_000),
    CmsAdoptionError,
  );
  await assertNoAdoptionResidue(malformed);

  const raced = await createPopulatedPhase5Database();
  t.after(() => raced.close());
  let racedOnce = false;
  const racingBinding = {
    prepare: (sql) => raced.prepare(sql),
    async batch(statements) {
      if (!racedOnce) {
        racedOnce = true;
        raced.exec(`
          UPDATE page_sections
          SET updated_at = updated_at + 1
          WHERE id = (
            SELECT id
            FROM page_sections
            WHERE organization_id = '${OWNER.organizationId}'
            LIMIT 1
          );
        `);
      }
      return raced.batch(statements);
    },
  };
  await assert.rejects(
    ensureCmsAdoption(racingBinding, OWNER, 50_000),
    CmsAdoptionError,
  );
  await assertNoAdoptionResidue(raced);
});

async function ensureInvariantReadiness(database) {
  for (
    let attempt = 0;
    attempt < MAX_DATABASE_INVARIANT_READY_ATTEMPTS;
    attempt += 1
  ) {
    const status = await ensureDatabaseInvariants(database);
    const marker = await database
      .prepare(
        `SELECT version
         FROM database_invariant_state
         WHERE singleton_key = 'database-guards'`,
      )
      .first("version");
    if (
      status === "ready" &&
      marker === DATABASE_INVARIANT_VERSION
    ) {
      return;
    }
  }
  assert.fail("runtime invariant installation did not reach v6 readiness");
}

function countedBinding(database) {
  let statementCount = 0;
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
        return database.batch(statements.map((statement) => statement.inner));
      },
      prepare(sql) {
        return wrap(database.prepare(sql));
      },
    },
    counts() {
      return { batchLengths: [...batchLengths], statementCount };
    },
  };
}

async function publicProjectionSnapshot(database) {
  const tables = [
    "pages",
    "page_sections",
    "club_public_profiles",
    "community_links",
    "navigation_items",
    "site_settings",
  ];
  return Promise.all(
    tables.map(async (table) => ({
      rows: (
        await database
          .prepare(
            `SELECT *
             FROM ${table}
             ORDER BY 1`,
          )
          .all()
      ).results,
      table,
    })),
  );
}

async function assertNoAdoptionResidue(database) {
  for (const table of [
    "cms_adoption_states",
    "cms_entity_publication_states",
    "cms_entity_revisions",
    "community_link_public_details",
  ]) {
    assert.equal(
      await database
        .prepare(`SELECT count(*) AS count FROM ${table}`)
        .first("count"),
      0,
      `${table} must remain empty after a failed adoption`,
    );
  }
}
