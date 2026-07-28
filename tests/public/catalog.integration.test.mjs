import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  OrganizerAccessDeniedError,
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import {
  ensurePublicCatalog,
  getPublicClubBySlug,
  getPublicPageContent,
  listPublicClubs,
  listPublicCommunityLinks,
  listPublicLanes,
} from "../../lib/server/public/catalog.ts";
import { ensureCmsAdoption } from "../../lib/server/organizer/cms-adoption.ts";
import { ensureMeetupProgramClubs } from "../../lib/server/meetup/clubs.ts";
import {
  listPublicCatalogSitemapEntries,
} from "../../lib/server/public/sitemap.ts";
import {
  PHASE6_INVARIANT_COUNT_SQL,
  PHASE6_INVARIANT_TRIGGER_STATEMENTS,
} from "../../lib/server/database/phase6-invariant-sql.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const EXPECTED_LANES = Object.freeze([
  Object.freeze({
    description:
      "Books, film, philosophy, debate, psychology, artificial intelligence, technology, and serious discussion.",
    name: "Think",
    slug: "think",
  }),
  Object.freeze({
    description:
      "Meditation, journaling, poetry, creative workshops, reflective practice, and silent reading.",
    name: "Reset & Make",
    slug: "reset-and-make",
  }),
  Object.freeze({
    description:
      "Walks, hikes, art, culture, neighbourhood outings, and discovering Vancouver.",
    name: "Explore",
    slug: "explore",
  }),
  Object.freeze({
    description:
      "Restaurant outings, karaoke, casual social events, and playful community gatherings.",
    name: "Eat & Play",
    slug: "eat-and-play",
  }),
]);
const EXPECTED_CLUBS = Object.freeze([
  Object.freeze({
    name: "Vancouver Curiosity Club",
    status: "published",
    slug: "vancouver-curiosity-club",
    url: "https://www.meetup.com/vancouver-meetup-group/",
  }),
  Object.freeze({
    name: "Vancouver Literature and Film",
    status: "published",
    slug: "vancouver-literature-and-film",
    url: "https://www.meetup.com/vancouver-literature-and-film/",
  }),
  Object.freeze({
    name: "Vancouver Fantasy & Sci-Fi Group",
    status: "published",
    slug: "vancouver-fantasy-scifi-group",
    url: "https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/",
  }),
  Object.freeze({
    name: "Off-Radar Eats",
    status: "draft",
    slug: "off-radar-eats",
    url: null,
  }),
  Object.freeze({
    name: "Contemplative Meditation + Journaling Circle",
    status: "draft",
    slug: "contemplative-meditation-journaling-circle",
    url: null,
  }),
]);
const OWNER = trustedIdentityFromSites({
  displayName: "Catalog owner",
  email: "catalog-owner@example.com",
});
const ADMINISTRATOR = trustedIdentityFromSites({
  displayName: "Catalog administrator",
  email: "catalog-administrator@example.com",
});
const ORGANIZER = trustedIdentityFromSites({
  displayName: "Catalog organizer",
  email: "catalog-organizer@example.com",
});
const OWNER_ACTOR = Object.freeze({
  membershipId: "membership_owner",
  organizationId: "org_public",
  profileId: "profile_owner",
  role: "owner",
});
const UNINVITED = trustedIdentityFromSites({
  displayName: "Uninvited",
  email: "catalog-uninvited@example.com",
});

function loadGeneratedMigrations() {
  const migrationDirectory = join(process.cwd(), "drizzle");
  const migrations = readdirSync(migrationDirectory)
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort();
  assert.deepEqual(
    migrations,
    [
      "0008_preproduction_reset.sql",
      "0009_sites_compatible_baseline.sql",
      "0010_sites_compatible_indexes_a.sql",
      "0011_sites_compatible_indexes_b.sql",
      "0012_phase3_organizer_foundation.sql",
      "0013_phase4_conflict_engine.sql",
      "0014_phase5_publication.sql",
      "0015_phase6_cms_media.sql",
    ],
    "the normalized Sites-compatible baseline must be authoritative",
  );
  return migrations
    .map((name) => readFileSync(join(migrationDirectory, name), "utf8"))
    .join("\n");
}

function createDatabase() {
  const database = new SqliteD1TestDatabase(loadGeneratedMigrations());
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES
      (
        'profile_owner', 'email:catalog-owner@example.com',
        'catalog-owner@example.com', 'Catalog owner', 'active', 1, 1
      ),
      (
        'profile_administrator', 'email:catalog-administrator@example.com',
        'catalog-administrator@example.com', 'Catalog administrator',
        'active', 1, 1
      ),
      (
        'profile_organizer', 'email:catalog-organizer@example.com',
        'catalog-organizer@example.com', 'Catalog organizer', 'active', 1, 1
      );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      owner_bootstrap_claimed_by_profile_id, created_by_profile_id,
      created_at, updated_at
    ) VALUES
      (
        'org_public', 'Private internal organization name',
        'vancouver-curiosity-and-education-society', 'America/Vancouver',
        1, 'profile_owner', 'profile_owner', 1, 1
      ),
      (
        'org_other', 'Other organization', 'other-organization',
        'America/Vancouver', 1, 'profile_administrator',
        'profile_administrator', 1, 1
      );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'membership_owner', 'org_public', 'profile_owner',
        'catalog-owner@example.com', 'owner', 'active',
        'profile_owner', 1, 1
      ),
      (
        'membership_administrator', 'org_other', 'profile_administrator',
        'catalog-administrator@example.com', 'administrator', 'active',
        'profile_administrator', 1, 1
      ),
      (
        'membership_organizer', 'org_public', 'profile_organizer',
        'catalog-organizer@example.com', 'organizer', 'active',
        'profile_owner', 1, 1
      );
  `);
  return database;
}

test("authorized seed creates the exact public catalog and only three safe club projections", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());

  await assert.rejects(
    ensurePublicCatalog(database, ORGANIZER, 1_000),
    (error) =>
      error instanceof OrganizerAccessDeniedError &&
      error.reason === "role_not_allowed",
  );
  await assert.rejects(
    ensurePublicCatalog(database, UNINVITED, 1_000),
    OrganizerAccessDeniedError,
  );
  assert.equal(
    await database.prepare(`SELECT count(*) AS count FROM clubs`).first("count"),
    0,
  );

  await ensurePublicCatalog(database, OWNER, 2_000);
  await ensureCmsAdoption(database, OWNER_ACTOR, 2_001);

  const lanes = await database
    .prepare(
      `SELECT description, name, slug
       FROM event_lanes
       WHERE organization_id = 'org_public'
       ORDER BY sort_order, name`,
    )
    .all();
  assert.deepEqual(
    lanes.results.map((row) => ({ ...row })),
    EXPECTED_LANES,
  );

  const clubs = await database
    .prepare(
      `SELECT club.name, club.slug,
              profile.publication_status AS status,
              profile.public_group_url AS url
       FROM clubs AS club
       JOIN club_public_profiles AS profile
         ON profile.club_id = club.id
        AND profile.organization_id = club.organization_id
       WHERE club.organization_id = 'org_public'
       ORDER BY CASE club.slug
         WHEN 'vancouver-curiosity-club' THEN 1
         WHEN 'vancouver-literature-and-film' THEN 2
         WHEN 'vancouver-fantasy-scifi-group' THEN 3
         WHEN 'off-radar-eats' THEN 4
         ELSE 5
       END`,
    )
    .all();
  assert.deepEqual(
    clubs.results.map((row) => ({ ...row })),
    EXPECTED_CLUBS,
  );

  const publicClubs = await listPublicClubs(database);
  assert.equal(publicClubs.length, 3);
  assert.deepEqual(
    new Set(publicClubs.map((club) => club.slug)),
    new Set(EXPECTED_CLUBS.slice(0, 3).map((club) => club.slug)),
  );
  assert.deepEqual(
    new Set(publicClubs.map((club) => club.publicGroupUrl)),
    new Set(EXPECTED_CLUBS.slice(0, 3).map((club) => club.url)),
  );
  for (const club of publicClubs) {
    const url = new URL(club.publicGroupUrl);
    assert.equal(url.origin, "https://www.meetup.com");
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
    assert.equal(url.pathname.split("/").filter(Boolean).length, 1);
  }

  assert.equal(await getPublicClubBySlug(database, "off-radar-eats"), null);
  assert.equal(
    await getPublicClubBySlug(
      database,
      "contemplative-meditation-journaling-circle",
    ),
    null,
  );
  assert.equal(await getPublicClubBySlug(database, "guessed-club"), null);

  const links = await listPublicCommunityLinks(database);
  assert.equal(links.length, 3);
  assert.equal(
    links.some((link) => /discussion/iu.test(`${link.label} ${link.url}`)),
    false,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM community_links
         WHERE organization_id = 'org_public'
           AND lower(link_type) LIKE '%discussion%'`,
      )
      .first("count"),
    0,
  );

  const selector = await ensureMeetupProgramClubs(database, OWNER, 3_000);
  assert.equal(selector.length, 3);
  assert.deepEqual(
    selector.map((club) => club.name),
    EXPECTED_CLUBS.slice(0, 3).map((club) => club.name),
  );
  assert.deepEqual(
    selector.map((club) => Object.keys(club).sort()),
    [[], [], []].map(() => ["id", "name"]),
  );
});

test("catalog sitemap entries require exact current receipt-backed route identities", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await ensurePublicCatalog(database, OWNER, 2_000);
  await ensureCmsAdoption(database, OWNER_ACTOR, 2_001);

  const baseline = await listPublicCatalogSitemapEntries(
    database,
    "org_public",
  );
  assert.equal(
    baseline.pages.some(({ slug }) => slug === "about"),
    true,
  );
  assert.equal(
    baseline.clubs.some(
      ({ slug }) => slug === "vancouver-curiosity-club",
    ),
    true,
  );
  assert.equal(
    baseline.programs.some(
      ({ programSlug }) => programSlug === "vancouver-curiosity-club",
    ),
    true,
  );

  database.exec(`
    UPDATE pages
    SET slug = 'tampered-about'
    WHERE organization_id = 'org_public' AND slug = 'about';
  `);
  const tamperedPage = await listPublicCatalogSitemapEntries(
    database,
    "org_public",
  );
  assert.equal(
    tamperedPage.pages.some(
      ({ slug }) => slug === "about" || slug === "tampered-about",
    ),
    false,
  );
  database.exec(`
    UPDATE pages
    SET slug = 'about'
    WHERE organization_id = 'org_public' AND slug = 'tampered-about';
    UPDATE clubs
    SET slug = 'tampered-club'
    WHERE organization_id = 'org_public'
      AND slug = 'vancouver-curiosity-club';
  `);
  const tamperedClub = await listPublicCatalogSitemapEntries(
    database,
    "org_public",
  );
  assert.equal(
    tamperedClub.clubs.some(
      ({ slug }) =>
        slug === "vancouver-curiosity-club" || slug === "tampered-club",
    ),
    false,
  );
  assert.equal(
    tamperedClub.programs.some(
      ({ clubSlug }) =>
        clubSlug === "vancouver-curiosity-club" ||
        clubSlug === "tampered-club",
    ),
    false,
  );
  database.exec(`
    UPDATE clubs
    SET slug = 'vancouver-curiosity-club'
    WHERE organization_id = 'org_public' AND slug = 'tampered-club';
    UPDATE program_public_profile_details
    SET public_slug = 'tampered-program'
    WHERE organization_id = 'org_public'
      AND public_slug = 'vancouver-curiosity-club';
  `);
  const tamperedProgram = await listPublicCatalogSitemapEntries(
    database,
    "org_public",
  );
  assert.equal(
    tamperedProgram.programs.some(
      ({ programSlug }) =>
        programSlug === "vancouver-curiosity-club" ||
        programSlug === "tampered-program",
    ),
    false,
  );
});

test("fresh guarded bootstrap creates canonical lanes through completed taxonomy intents and remains invariant-clean", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());

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

  await ensurePublicCatalog(database, OWNER, 2_000);

  const taxonomy = await database
    .prepare(
      `SELECT (
         SELECT count(*) FROM event_lanes
         WHERE organization_id = 'org_public'
       ) AS lanes,
       (
         SELECT count(*) FROM event_lane_taxonomy_states
         WHERE organization_id = 'org_public'
           AND active_intent_id IS NULL
           AND last_completed_intent_id IS NOT NULL
       ) AS states,
       (
         SELECT count(*) FROM taxonomy_write_intents
         WHERE organization_id = 'org_public'
           AND entity_type = 'lane'
           AND operation = 'create'
           AND completed_at IS NOT NULL
       ) AS intents,
       (
         SELECT count(*) FROM audit_logs
         WHERE organization_id = 'org_public'
           AND action = 'taxonomy.lane_created'
           AND json_extract(metadata_json, '$.writeIntentId') IS NOT NULL
       ) AS audits`,
    )
    .first();
  assert.deepEqual(
    {
      audits: taxonomy?.audits,
      intents: taxonomy?.intents,
      lanes: taxonomy?.lanes,
      states: taxonomy?.states,
    },
    { audits: 4, intents: 4, lanes: 4, states: 4 },
  );

  const taxonomyIntegrity = await database
    .prepare(PHASE6_INVARIANT_COUNT_SQL.at(-1))
    .first();
  assert.equal(taxonomyIntegrity?.violation_count, 0);
  await ensurePublicCatalog(database, OWNER, 3_000);

  const stable = await database
    .prepare(
      `SELECT
         (SELECT count(*) FROM event_lanes
          WHERE organization_id = 'org_public') AS lanes,
         (SELECT count(*) FROM taxonomy_write_intents
          WHERE organization_id = 'org_public') AS intents,
         (SELECT count(*) FROM audit_logs
          WHERE organization_id = 'org_public'
            AND action = 'taxonomy.lane_created') AS audits`,
    )
    .first();
  assert.deepEqual(
    {
      audits: stable?.audits,
      intents: stable?.intents,
      lanes: stable?.lanes,
    },
    { audits: 4, intents: 4, lanes: 4 },
  );
});

test("canonical lane seed keeps all four exact descriptions and later runs are fill-only", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());

  await ensurePublicCatalog(database, OWNER, 2_000);
  const readLanes = async () =>
    (
      await database
        .prepare(
          `SELECT description, name, slug
           FROM event_lanes
           WHERE organization_id = 'org_public'
           ORDER BY sort_order, name`,
        )
        .all()
    ).results.map((row) => ({ ...row }));

  assert.deepEqual(await readLanes(), EXPECTED_LANES);

  for (const lane of EXPECTED_LANES) {
    await database
      .prepare(
        `UPDATE event_lanes
         SET description = ?, updated_at = ?
         WHERE organization_id = 'org_public'
           AND slug = ?`,
      )
      .bind(`OWNER EDITED ${lane.slug}`, 9_000, lane.slug)
      .run();
  }
  database.exec(`
    DELETE FROM site_settings
    WHERE organization_id = 'org_public'
      AND key = 'public_catalog_version';
  `);

  await ensurePublicCatalog(database, OWNER, 10_000);
  await ensurePublicCatalog(database, OWNER, 11_000);
  assert.deepEqual(
    await readLanes(),
    EXPECTED_LANES.map((lane) => ({
      ...lane,
      description: `OWNER EDITED ${lane.slug}`,
    })),
  );
});

test("catalog seed is idempotent and preserves later D1 editorial changes", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await ensurePublicCatalog(database, OWNER, 2_000);

  const clubId = await database
    .prepare(
      `SELECT id
       FROM clubs
       WHERE organization_id = 'org_public'
         AND slug = 'vancouver-curiosity-club'`,
    )
    .first("id");
  const homePageId = await database
    .prepare(
      `SELECT id
       FROM pages
       WHERE organization_id = 'org_public'
         AND slug = 'home'`,
    )
    .first("id");
  database.exec(`
    UPDATE club_public_profiles
    SET description = 'OWNER EDITED CLUB COPY', updated_at = 9_000
    WHERE club_id = '${clubId}';
    UPDATE page_sections
    SET content_json = '{"heading":"OWNER EDITED HERO"}',
        updated_at = 9_000
    WHERE page_id = '${homePageId}' AND section_key = 'hero';
    UPDATE community_links
    SET label = 'OWNER EDITED COMMUNITY LABEL', updated_at = 9_000
    WHERE organization_id = 'org_public'
      AND url = 'https://www.meetup.com/vancouver-meetup-group/';
    DELETE FROM site_settings
    WHERE organization_id = 'org_public'
      AND key = 'public_catalog_version';
  `);

  await ensurePublicCatalog(database, OWNER, 10_000);
  await ensurePublicCatalog(database, OWNER, 11_000);
  await ensureCmsAdoption(database, OWNER_ACTOR, 12_000);

  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM event_lanes
         WHERE organization_id = 'org_public'`,
      )
      .first("count"),
    4,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM clubs
         WHERE organization_id = 'org_public'`,
      )
      .first("count"),
    5,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM club_public_profiles
         WHERE organization_id = 'org_public'`,
      )
      .first("count"),
    5,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT description
         FROM club_public_profiles
         WHERE club_id = ?`,
      )
      .bind(clubId)
      .first("description"),
    "OWNER EDITED CLUB COPY",
  );
  assert.equal(
    await database
      .prepare(
        `SELECT content_json
         FROM page_sections
         WHERE page_id = ? AND section_key = 'hero'`,
      )
      .bind(homePageId)
      .first("content_json"),
    '{"heading":"OWNER EDITED HERO"}',
  );
  assert.equal(
    await database
      .prepare(
        `SELECT label
         FROM community_links
         WHERE organization_id = 'org_public'
           AND url = 'https://www.meetup.com/vancouver-meetup-group/'`,
      )
      .first("label"),
    "OWNER EDITED COMMUNITY LABEL",
  );
  const home = await getPublicPageContent(database, "home");
  assert.equal(home.sections[0].content.heading, "OWNER EDITED HERO");
});

test("administrator seed is organization-scoped and cannot alter the public organization", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await ensurePublicCatalog(database, OWNER, 2_000);
  await ensurePublicCatalog(database, ADMINISTRATOR, 3_000);

  for (const organizationId of ["org_public", "org_other"]) {
    assert.equal(
      await database
        .prepare(
          `SELECT count(*) AS count
           FROM event_lanes
           WHERE organization_id = ?`,
        )
        .bind(organizationId)
        .first("count"),
      4,
    );
    assert.equal(
      await database
        .prepare(
          `SELECT count(*) AS count
           FROM clubs
           WHERE organization_id = ?`,
        )
        .bind(organizationId)
        .first("count"),
      5,
    );
    assert.equal(
      await database
        .prepare(
          `SELECT count(*) AS count
           FROM club_public_profiles
           WHERE organization_id = ?`,
        )
        .bind(organizationId)
        .first("count"),
      5,
    );
  }

  database.exec(`
    UPDATE club_public_profiles
    SET description = 'OTHER_ORGANIZATION_PRIVATE_SENTINEL'
    WHERE organization_id = 'org_other'
      AND club_id = (
        SELECT id FROM clubs
        WHERE organization_id = 'org_other'
          AND slug = 'vancouver-curiosity-club'
      );
  `);
  const serializedPublicCatalog = JSON.stringify({
    clubs: await listPublicClubs(database),
    lanes: await listPublicLanes(database),
    links: await listPublicCommunityLinks(database),
  });
  assert.equal(
    serializedPublicCatalog.includes("OTHER_ORGANIZATION_PRIVATE_SENTINEL"),
    false,
  );
  assert.equal(
    await database
      .prepare("PRAGMA foreign_key_check")
      .all()
      .then((result) => result.results.length),
    0,
  );
});
