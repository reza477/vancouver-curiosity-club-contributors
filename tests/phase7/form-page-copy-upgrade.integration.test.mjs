import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  authorizeMembership,
  bootstrapInitialOwner,
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import { ensureDatabaseInvariantsReady } from "../database/invariant-ready.mjs";
import {
  readCmsEntityWorkspace,
  reconcileVisitorFormPageCopy,
  saveCmsEntityDraft,
} from "../../lib/server/organizer/cms.ts";
import { ensureCmsAdoption } from "../../lib/server/organizer/cms-adoption.ts";
import {
  ensurePublicCatalog,
  getPublicPageContent,
} from "../../lib/server/public/catalog.ts";
import { PUBLIC_CATALOG_PAGES } from "../../lib/server/public/catalog-definitions.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const OWNER_EMAIL = "visitor-form-copy-owner@vcc-tests.invalid";
const OWNER = trustedIdentityFromSites({
  displayName: "Visitor form copy owner",
  email: OWNER_EMAIL,
});
const NOW = Date.parse("2032-08-01T12:00:00.000Z");
const ORGANIZATION_SLUG =
  "vancouver-curiosity-and-education-society";
const PAGE_SLUGS = Object.freeze([
  "get-involved",
  "host-an-event",
]);
const PREVIOUS_PAGE_CONTENT = Object.freeze({
  "get-involved": Object.freeze({
    heading: "Bring something to the club",
    paragraphs: Object.freeze([
      "Attending a published event is the simplest way in. The Volunteer and Venue or Community Partnership forms store the details you choose to send in the private organizer inbox.",
      "Submitting a form does not reserve a date, guarantee publication, enroll you in marketing, or send an email confirmation.",
    ]),
    text:
      "You can attend, share an event idea, volunteer, host a gathering, or begin a conversation about partnering.",
  }),
  "host-an-event": Object.freeze({
    heading: "Interested in hosting?",
    paragraphs: Object.freeze([
      "Submitting stores the proposal in the private organizer inbox. It does not create or publish an event, reserve a date, promise scheduling, or send an email confirmation.",
      "A useful starting idea has a clear question or activity, a reason to gather, and enough practical detail for an organizer to assess later.",
    ]),
    text:
      "Use the Host an Event form to share a proposed title or topic, a short event idea, format, optional preferred club or program, and optional timing.",
  }),
});
const CUSTOM_GET_INVOLVED_CONTENT = Object.freeze({
  heading: "Owner-curated contribution page",
  paragraphs: Object.freeze([
    "This deliberate owner publication must never be replaced automatically.",
  ]),
  text: "Choose the contribution path that fits your idea.",
});

test("form-page introductions keep their purpose without repeating defensive mechanics", () => {
  for (const slug of ["contact", ...PAGE_SLUGS]) {
    const intro = targetIntro(slug);
    assert.doesNotMatch(
      JSON.stringify(intro),
      /private organizer inbox|marketing|email confirmation/iu,
    );
  }
  assert.equal(
    targetIntro("contact").text,
    "Send comments or questions privately to our team for review and follow-up.",
  );
  assert.match(
    targetIntro("get-involved").paragraphs[0],
    /volunteer|partnership/u,
  );
  assert.match(targetIntro("host-an-event").text, /^Use the Host an Event form/u);
});

test("the two exact previous publications upgrade one per bounded request through the normal CMS protocol", async (t) => {
  const data = await fixture({ pageContent: PREVIOUS_PAGE_CONTENT });
  t.after(() => data.database.close());
  await ensureDatabaseInvariantsReady(data.database);

  const firstCounted = countedDatabase(data.database);
  assert.equal(
    await reconcileVisitorFormPageCopy(firstCounted.database, NOW),
    "processed",
  );
  assert.ok(
    firstCounted.statementCount + 2 < 50,
    `Get Involved copy maintenance used ${firstCounted.statementCount + 2} statements`,
  );

  const secondCounted = countedDatabase(data.database);
  assert.equal(
    await reconcileVisitorFormPageCopy(secondCounted.database, NOW + 1),
    "processed",
  );
  assert.ok(
    secondCounted.statementCount + 2 < 50,
    `Host an Event copy maintenance used ${secondCounted.statementCount + 2} statements`,
  );
  const readyCounted = countedDatabase(data.database);
  assert.equal(
    await reconcileVisitorFormPageCopy(readyCounted.database, NOW + 2),
    "ready",
  );
  assert.equal(
    readyCounted.statementCount,
    1,
    "the completed marker must make later requests a single-read no-op",
  );

  for (const slug of PAGE_SLUGS) {
    const page = await getPublicPageContent(data.database, slug);
    assert.ok(page);
    assert.deepEqual(page.sections[0]?.content, targetIntro(slug));
    assert.doesNotMatch(
      JSON.stringify(page.sections[0]?.content),
      /private organizer inbox|marketing|email confirmation/iu,
    );
    const workspace = await pageWorkspace(data, slug);
    assert.equal(
      workspace.entity.currentDraftRevisionId,
      workspace.entity.publishedRevisionId,
    );
    assert.equal(workspace.entity.contentVersion, 3);
    assert.equal(workspace.revisions.length, 2);
    assert.equal(
      await data.database
        .prepare(
          `SELECT count(*) AS count
           FROM cms_public_materialization_receipts
           WHERE organization_id = ?
             AND entity_type = 'page'
             AND entity_key = ?`,
        )
        .bind(data.actor.organizationId, workspace.entity.entityKey)
        .first("count"),
      2,
      `${slug} must keep its adoption and upgraded-publication receipts`,
    );
  }

  const marker = await readFormPageMarker(data.database);
  assert.equal(marker.completedAt, NOW + 1);
  assert.deepEqual(
    marker.outcomes.map(({ outcome, reason, slug }) => ({
      outcome,
      reason,
      slug,
    })),
    [
      {
        outcome: "upgraded",
        reason: "legacy_copy_upgraded",
        slug: "get-involved",
      },
      {
        outcome: "upgraded",
        reason: "legacy_copy_upgraded",
        slug: "host-an-event",
      },
    ],
  );
  assert.equal(
    await data.database
      .prepare(
        `SELECT count(*) AS count
         FROM audit_logs
         WHERE organization_id = ?
           AND json_extract(metadata_json, '$.source') =
               'visitor_form_page_copy_upgrade'`,
      )
      .bind(data.actor.organizationId)
      .first("count"),
    4,
    "each page must retain the dedicated source on draft and publish audits",
  );
});

test("already-current form pages record once without creating replacement revisions", async (t) => {
  const data = await fixture();
  t.after(() => data.database.close());
  const before = await Promise.all(
    PAGE_SLUGS.map((slug) => pageWorkspace(data, slug)),
  );

  assert.equal(await reconcileVisitorFormPageCopy(data.database, NOW), "processed");
  assert.equal(
    await reconcileVisitorFormPageCopy(data.database, NOW + 1),
    "processed",
  );
  assert.equal(
    await reconcileVisitorFormPageCopy(data.database, NOW + 2),
    "ready",
  );

  const after = await Promise.all(
    PAGE_SLUGS.map((slug) => pageWorkspace(data, slug)),
  );
  for (const [index, workspace] of after.entries()) {
    assert.equal(
      workspace.entity.contentVersion,
      before[index].entity.contentVersion,
    );
    assert.equal(workspace.revisions.length, 1);
  }
  assert.deepEqual(
    (await readFormPageMarker(data.database)).outcomes.map(
      ({ reason, slug }) => ({ reason, slug }),
    ),
    [
      { reason: "already_current", slug: "get-involved" },
      { reason: "already_current", slug: "host-an-event" },
    ],
  );
});

test("synchronized first calls record one ordered outcome and converge on the next page", async (t) => {
  const data = await fixture();
  t.after(() => data.database.close());

  assert.deepEqual(
    await Promise.all([
      reconcileVisitorFormPageCopy(data.database, NOW),
      reconcileVisitorFormPageCopy(data.database, NOW + 1),
    ]),
    ["processed", "processed"],
  );
  const firstMarker = await readFormPageMarker(data.database);
  assert.equal(firstMarker.completedAt, null);
  assert.deepEqual(
    firstMarker.outcomes.map(({ reason, slug }) => ({ reason, slug })),
    [{ reason: "already_current", slug: "get-involved" }],
  );

  assert.equal(
    await reconcileVisitorFormPageCopy(data.database, NOW + 2),
    "processed",
  );
  const completeMarker = await readFormPageMarker(data.database);
  assert.equal(completeMarker.completedAt, NOW + 2);
  assert.deepEqual(
    completeMarker.outcomes.map(({ reason, slug }) => ({ reason, slug })),
    [
      { reason: "already_current", slug: "get-involved" },
      { reason: "already_current", slug: "host-an-event" },
    ],
  );
});

test("a target-shaped Owner draft without upgrade provenance is preserved, remains unpublished, and creates one review notification", async (t) => {
  const data = await fixture({ pageContent: PREVIOUS_PAGE_CONTENT });
  t.after(() => data.database.close());
  const before = await pageWorkspace(data, "get-involved");
  const saved = await saveCmsEntityDraft(
    data.database,
    OWNER,
    "page",
    before.entity.entityKey,
    {
      expectedContentVersion: before.entity.contentVersion,
      snapshot: targetSnapshotFrom(before.revision.snapshot, "get-involved"),
    },
    NOW - 1,
  );

  assert.equal(await reconcileVisitorFormPageCopy(data.database, NOW), "processed");
  const after = await pageWorkspace(data, "get-involved");
  assert.equal(after.revision.id, saved.revision.id);
  assert.equal(
    after.entity.publishedRevisionId,
    before.entity.publishedRevisionId,
  );
  assert.deepEqual(
    (await getPublicPageContent(data.database, "get-involved"))?.sections[0]
      ?.content,
    PREVIOUS_PAGE_CONTENT["get-involved"],
  );
  assert.equal(
    (await readFormPageMarker(data.database)).outcomes[0]?.reason,
    "newer_draft_preserved",
  );
  assert.equal(
    await notificationCount(data, "get-involved"),
    1,
  );
});

test("an unknown Owner publication is preserved and surfaced for review", async (t) => {
  const data = await fixture({
    pageContent: {
      "get-involved": CUSTOM_GET_INVOLVED_CONTENT,
    },
  });
  t.after(() => data.database.close());
  const before = await pageWorkspace(data, "get-involved");

  assert.equal(await reconcileVisitorFormPageCopy(data.database, NOW), "processed");
  const after = await pageWorkspace(data, "get-involved");
  assert.equal(after.entity.contentVersion, before.entity.contentVersion);
  assert.equal(after.revisions.length, 1);
  assert.deepEqual(
    (await getPublicPageContent(data.database, "get-involved"))?.sections[0]
      ?.content,
    CUSTOM_GET_INVOLVED_CONTENT,
  );
  assert.equal(
    (await readFormPageMarker(data.database)).outcomes[0]?.reason,
    "nonlegacy_copy_preserved",
  );
  assert.equal(await notificationCount(data, "get-involved"), 1);
});

test("an interrupted upgrade resumes its exact saved draft instead of replacing it", async (t) => {
  const data = await fixture({ pageContent: PREVIOUS_PAGE_CONTENT });
  t.after(() => data.database.close());
  const interrupted = failBatch(data.database, 2);

  await assert.rejects(
    reconcileVisitorFormPageCopy(interrupted.database, NOW),
  );
  assert.equal(interrupted.batchCount, 2);
  const partial = await pageWorkspace(data, "get-involved");
  assert.notEqual(
    partial.entity.currentDraftRevisionId,
    partial.entity.publishedRevisionId,
  );
  assert.deepEqual(partial.revision.snapshot.blocks[0]?.config, targetIntro("get-involved"));
  assert.equal(await readOptionalFormPageMarker(data.database), null);

  assert.equal(
    await reconcileVisitorFormPageCopy(data.database, NOW + 1),
    "processed",
  );
  const after = await pageWorkspace(data, "get-involved");
  assert.equal(
    after.entity.currentDraftRevisionId,
    after.entity.publishedRevisionId,
  );
  assert.equal(after.revision.id, partial.revision.id);
  assert.equal(
    (await readFormPageMarker(data.database)).outcomes[0]?.reason,
    "legacy_copy_upgraded",
  );
});

test("a corrupt form-page marker fails closed before publication work", async (t) => {
  const data = await fixture({ pageContent: PREVIOUS_PAGE_CONTENT });
  t.after(() => data.database.close());
  const before = await pageWorkspace(data, "get-involved");
  await data.database
    .prepare(
      `INSERT INTO site_settings (
         id, organization_id, key, value_json, is_public,
         updated_by_profile_id, created_at, updated_at
       ) VALUES (?, ?, 'visitor_form_page_copy_upgrade', '{}', 0, ?, ?, ?)`,
    )
    .bind(
      "corrupt-visitor-form-page-copy-marker",
      data.actor.organizationId,
      data.actor.profileId,
      NOW - 1,
      NOW - 1,
    )
    .run();

  await assert.rejects(
    reconcileVisitorFormPageCopy(data.database, NOW),
  );
  const after = await pageWorkspace(data, "get-involved");
  assert.equal(after.entity.contentVersion, before.entity.contentVersion);
  assert.equal(after.revisions.length, 1);
});

async function fixture({ pageContent = {} } = {}) {
  const database = new SqliteD1TestDatabase(migrations());
  assert.equal(
    await bootstrapInitialOwner(
      database,
      OWNER,
      OWNER_EMAIL,
      NOW - 100,
    ),
    true,
  );
  await ensurePublicCatalog(database, OWNER, NOW - 90);
  for (const [slug, content] of Object.entries(pageContent)) {
    await replaceStarterPageContent(database, slug, content);
  }
  const actor = await authorizeMembership(database, OWNER, {
    allowedRoles: ["owner"],
  });
  assert.equal(
    await ensureCmsAdoption(database, actor, NOW - 70),
    "adopted",
  );
  return { actor, database };
}

async function replaceStarterPageContent(database, slug, content) {
  await database.batch([
    database
      .prepare(
        `UPDATE page_sections
         SET content_json = ?, updated_at = ?
         WHERE organization_id = (
           SELECT id FROM organizations WHERE slug = ? LIMIT 1
         )
           AND page_id = (
             SELECT id
             FROM pages
             WHERE organization_id = page_sections.organization_id
               AND slug = ?
             LIMIT 1
           )
           AND section_key = 'intro'
           AND section_type = 'intro'`,
      )
      .bind(
        JSON.stringify(content),
        NOW - 80,
        ORGANIZATION_SLUG,
        slug,
      ),
    database
      .prepare(
        `UPDATE page_public_metadata
         SET meta_description = ?, updated_at = ?
         WHERE organization_id = (
           SELECT id FROM organizations WHERE slug = ? LIMIT 1
         )
           AND page_id = (
             SELECT id
             FROM pages
             WHERE organization_id = page_public_metadata.organization_id
               AND slug = ?
             LIMIT 1
           )`,
      )
      .bind(
        content.text.slice(0, 160),
        NOW - 80,
        ORGANIZATION_SLUG,
        slug,
      ),
  ]);
}

function targetDefinition(slug) {
  const definition = PUBLIC_CATALOG_PAGES.find((page) => page.slug === slug);
  assert.ok(definition);
  return definition;
}

function targetIntro(slug) {
  const intro = targetDefinition(slug).sections.find(
    (section) => section.key === "intro" && section.type === "intro",
  )?.content;
  assert.ok(intro);
  return intro;
}

function targetSnapshotFrom(previousSnapshot, slug) {
  const definition = targetDefinition(slug);
  const intro = targetIntro(slug);
  return {
    ...previousSnapshot,
    blocks: previousSnapshot.blocks.map((block) =>
      block.id === "intro" ? { ...block, config: intro } : block,
    ),
    metaDescription: intro.text.slice(0, 160),
    seoTitle: definition.title,
    title: definition.title,
  };
}

async function pageWorkspace(data, slug) {
  const pageId = await data.database
    .prepare(
      `SELECT id
       FROM pages
       WHERE organization_id = ?
         AND slug = ?
       LIMIT 1`,
    )
    .bind(data.actor.organizationId, slug)
    .first("id");
  return readCmsEntityWorkspace(
    data.database,
    OWNER,
    "page",
    pageId,
  );
}

async function readFormPageMarker(database) {
  const value = await readOptionalFormPageMarker(database);
  assert.equal(typeof value, "object");
  return value;
}

async function readOptionalFormPageMarker(database) {
  const valueJson = await database
    .prepare(
      `SELECT value_json
       FROM site_settings
       WHERE key = 'visitor_form_page_copy_upgrade'
       LIMIT 1`,
    )
    .first("value_json");
  if (valueJson === null) return null;
  assert.equal(typeof valueJson, "string");
  return JSON.parse(valueJson);
}

async function notificationCount(data, slug) {
  const pageId = (await pageWorkspace(data, slug)).entity.entityKey;
  return data.database
    .prepare(
      `SELECT count(*) AS count
       FROM notifications
       WHERE organization_id = ?
         AND type = 'cms_starter_copy_skipped'
         AND payload_json = ?`,
    )
    .bind(
      data.actor.organizationId,
      JSON.stringify({ pageId, pageSlug: slug }),
    )
    .first("count");
}

function failBatch(database, failingBatchNumber) {
  let batchCount = 0;
  return {
    database: {
      async batch(statements) {
        batchCount += 1;
        if (batchCount === failingBatchNumber) {
          throw new Error("Injected batch interruption");
        }
        return database.batch(statements);
      },
      prepare(sql) {
        return database.prepare(sql);
      },
    },
    get batchCount() {
      return batchCount;
    },
  };
}

function countedDatabase(database) {
  let statementCount = 0;
  const inner = new WeakMap();
  function wrap(statement) {
    const wrapped = {
      bind(...values) {
        return wrap(statement.bind(...values));
      },
      async all() {
        statementCount += 1;
        return statement.all();
      },
      async first(...args) {
        statementCount += 1;
        return statement.first(...args);
      },
      async run() {
        statementCount += 1;
        return statement.run();
      },
    };
    inner.set(wrapped, statement);
    return wrapped;
  }
  return {
    database: {
      async batch(statements) {
        statementCount += statements.length;
        return database.batch(
          statements.map((statement) => inner.get(statement)),
        );
      },
      prepare(sql) {
        return wrap(database.prepare(sql));
      },
    },
    get statementCount() {
      return statementCount;
    },
  };
}

function migrations() {
  return readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) => readFileSync(join(process.cwd(), "drizzle", name), "utf8"))
    .join("\n");
}
