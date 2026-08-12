import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  authorizeMembership,
  bootstrapInitialOwner,
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import {
  ensureDatabaseInvariantsReady,
} from "../database/invariant-ready.mjs";
import {
  readCmsEntityWorkspace,
  reconcileVisitorPrivacyCopy,
  saveCmsEntityDraft,
} from "../../lib/server/organizer/cms.ts";
import { ensureCmsAdoption } from "../../lib/server/organizer/cms-adoption.ts";
import {
  ensurePublicCatalog,
  getPublicPageContent,
} from "../../lib/server/public/catalog.ts";
import { PUBLIC_CATALOG_PAGES } from "../../lib/server/public/catalog-definitions.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const OWNER_EMAIL = "visitor-privacy-owner@vcc-tests.invalid";
const OWNER = trustedIdentityFromSites({
  displayName: "Visitor privacy copy owner",
  email: OWNER_EMAIL,
});
const NOW = Date.parse("2032-06-01T12:00:00.000Z");
const PREVIOUS_PRIVACY_CONTENT = Object.freeze({
  heading: "Privacy, in plain language",
  paragraphs: Object.freeze([
    "The site is hosted with ChatGPT Sites and uses Sites-managed D1 for structured data and R2 for approved files.",
    "Organizer access uses Sign in with ChatGPT, which can provide name and email identity to the private organizer portal. Public visitors do not need to sign in.",
    "This starter notice needs legal review before a public launch.",
  ]),
  text:
    "Public pages and the four public forms can be used without an attendee account. Form submissions are stored in the private organizer inbox for authorized organizers to review.",
});
const CUSTOM_PRIVACY_CONTENT = Object.freeze({
  heading: "Owner-published privacy note",
  paragraphs: Object.freeze([
    "This is deliberate owner copy and must never be replaced automatically.",
  ]),
  text: "A custom privacy summary chosen by the Owner.",
});

test("the exact previous Privacy publication upgrades through the guarded CMS protocol", async (t) => {
  const data = await fixture({ privacyContent: PREVIOUS_PRIVACY_CONTENT });
  t.after(() => data.database.close());
  await ensureDatabaseInvariantsReady(data.database);
  const counted = countedDatabase(data.database);

  assert.equal(
    await reconcileVisitorPrivacyCopy(counted.database, NOW),
    "processed",
  );
  assert.ok(
    counted.statementCount + 2 < 50,
    `privacy copy maintenance used ${counted.statementCount + 2} statements`,
  );

  const page = await getPublicPageContent(data.database, "privacy");
  assert.ok(page);
  const rendered = JSON.stringify(page);
  assert.doesNotMatch(
    rendered,
    /starter notice|legal review|Sites-managed D1|R2 for approved files/iu,
  );
  assert.match(rendered, /information you choose to send/iu);
  const workspace = await pageWorkspace(data);
  assert.equal(
    workspace.entity.currentDraftRevisionId,
    workspace.entity.publishedRevisionId,
  );
  assert.equal(workspace.entity.contentVersion, 3);
  assert.equal(workspace.revisions.length, 2);
  assert.deepEqual(await readPrivacyMarker(data.database), {
    completedAt: NOW,
    contentHash: workspace.revision.contentHash,
    outcome: "upgraded",
    reason: "legacy_copy_upgraded",
    version: 1,
  });
});

test("an already-current Privacy publication records once and is then a read-only fast path", async (t) => {
  const data = await fixture();
  t.after(() => data.database.close());
  const before = await pageWorkspace(data);

  assert.equal(
    await reconcileVisitorPrivacyCopy(data.database, NOW),
    "processed",
  );
  assert.equal(
    await reconcileVisitorPrivacyCopy(data.database, NOW + 1),
    "ready",
  );
  const after = await pageWorkspace(data);
  assert.equal(after.entity.contentVersion, before.entity.contentVersion);
  assert.equal(after.revisions.length, 1);
  assert.deepEqual(await readPrivacyMarker(data.database), {
    completedAt: NOW,
    contentHash: before.revision.contentHash,
    outcome: "upgraded",
    reason: "already_current",
    version: 1,
  });
});

test("synchronized first calls accept the terminal marker that wins the compare-and-set", async (t) => {
  const data = await fixture();
  t.after(() => data.database.close());

  assert.deepEqual(
    await Promise.all([
      reconcileVisitorPrivacyCopy(data.database, NOW),
      reconcileVisitorPrivacyCopy(data.database, NOW + 1),
    ]),
    ["processed", "processed"],
  );
  assert.equal(
    await reconcileVisitorPrivacyCopy(data.database, NOW + 2),
    "ready",
  );
  const marker = await readPrivacyMarker(data.database);
  assert.ok(marker.completedAt === NOW || marker.completedAt === NOW + 1);
  assert.equal(marker.outcome, "upgraded");
  assert.equal(marker.reason, "already_current");
});

test("synchronized preservation keeps the Owner draft, public copy, and review notification", async (t) => {
  const data = await fixture({ privacyContent: PREVIOUS_PRIVACY_CONTENT });
  t.after(() => data.database.close());
  const before = await pageWorkspace(data);
  const ownerSnapshot = {
    ...before.revision.snapshot,
    blocks: before.revision.snapshot.blocks.map((block) =>
      block.id === "intro"
        ? {
            ...block,
            config: {
              ...block.config,
              heading: "Owner privacy draft in progress",
            },
          }
        : block,
    ),
  };
  const saved = await saveCmsEntityDraft(
    data.database,
    OWNER,
    "page",
    before.entity.entityKey,
    {
      expectedContentVersion: before.entity.contentVersion,
      snapshot: ownerSnapshot,
    },
    NOW - 1,
  );

  assert.deepEqual(
    await Promise.all([
      reconcileVisitorPrivacyCopy(data.database, NOW),
      reconcileVisitorPrivacyCopy(data.database, NOW + 1),
    ]),
    ["processed", "processed"],
  );
  const after = await pageWorkspace(data);
  assert.equal(after.revision.id, saved.revision.id);
  assert.equal(
    after.entity.publishedRevisionId,
    before.entity.publishedRevisionId,
  );
  assert.equal(
    after.revision.snapshot.blocks[0].config.heading,
    "Owner privacy draft in progress",
  );
  assert.match(
    JSON.stringify(await getPublicPageContent(data.database, "privacy")),
    /starter notice needs legal review/iu,
  );
  assert.equal(
    (await readPrivacyMarker(data.database)).reason,
    "newer_draft_preserved",
  );
  assert.equal(
    await data.database
      .prepare(
        `SELECT count(*) AS count
         FROM notifications
         WHERE organization_id = ?
           AND type = 'cms_starter_copy_skipped'
           AND payload_json = ?`,
      )
      .bind(
        data.actor.organizationId,
        JSON.stringify({
          pageId: before.entity.entityKey,
          pageSlug: "privacy",
        }),
      )
      .first("count"),
    1,
  );
});

test("a target-shaped Owner draft without the upgrade audit source is never auto-published", async (t) => {
  const data = await fixture({ privacyContent: PREVIOUS_PRIVACY_CONTENT });
  t.after(() => data.database.close());
  const before = await pageWorkspace(data);
  const privacyDefinition = PUBLIC_CATALOG_PAGES.find(
    (page) => page.slug === "privacy",
  );
  const targetIntro = privacyDefinition?.sections.find(
    (section) => section.key === "intro",
  );
  assert.ok(targetIntro);
  const targetSnapshot = {
    ...before.revision.snapshot,
    blocks: before.revision.snapshot.blocks.map((block) =>
      block.id === "intro"
        ? { ...block, config: targetIntro.content }
        : block,
    ),
  };
  const saved = await saveCmsEntityDraft(
    data.database,
    OWNER,
    "page",
    before.entity.entityKey,
    {
      expectedContentVersion: before.entity.contentVersion,
      snapshot: targetSnapshot,
    },
    NOW - 1,
  );

  assert.equal(
    await reconcileVisitorPrivacyCopy(data.database, NOW),
    "processed",
  );
  const after = await pageWorkspace(data);
  assert.equal(after.revision.id, saved.revision.id);
  assert.equal(
    after.entity.publishedRevisionId,
    before.entity.publishedRevisionId,
  );
  assert.match(
    JSON.stringify(await getPublicPageContent(data.database, "privacy")),
    /starter notice needs legal review/iu,
  );
  assert.equal(
    (await readPrivacyMarker(data.database)).reason,
    "newer_draft_preserved",
  );
});

test("a target draft saved by this upgrade resumes publication after an interrupted first attempt", async (t) => {
  const data = await fixture({ privacyContent: PREVIOUS_PRIVACY_CONTENT });
  t.after(() => data.database.close());
  const interrupted = failBatch(data.database, 2);

  await assert.rejects(
    reconcileVisitorPrivacyCopy(interrupted.database, NOW),
  );
  assert.equal(interrupted.batchCount, 2);
  const partial = await pageWorkspace(data);
  assert.notEqual(
    partial.entity.currentDraftRevisionId,
    partial.entity.publishedRevisionId,
  );
  assert.match(
    JSON.stringify(partial.revision.snapshot),
    /information you choose to send/iu,
  );
  assert.equal(await readOptionalPrivacyMarker(data.database), null);

  assert.equal(
    await reconcileVisitorPrivacyCopy(data.database, NOW + 1),
    "processed",
  );
  const after = await pageWorkspace(data);
  assert.equal(
    after.entity.currentDraftRevisionId,
    after.entity.publishedRevisionId,
  );
  assert.equal(after.revision.id, partial.revision.id);
  assert.equal(
    (await readPrivacyMarker(data.database)).reason,
    "legacy_copy_upgraded",
  );
});

test("an unknown Owner-published Privacy revision is preserved without a replacement revision", async (t) => {
  const data = await fixture({ privacyContent: CUSTOM_PRIVACY_CONTENT });
  t.after(() => data.database.close());
  const before = await pageWorkspace(data);

  assert.equal(
    await reconcileVisitorPrivacyCopy(data.database, NOW),
    "processed",
  );
  const after = await pageWorkspace(data);
  assert.equal(after.entity.contentVersion, before.entity.contentVersion);
  assert.equal(after.revisions.length, 1);
  assert.match(
    JSON.stringify(await getPublicPageContent(data.database, "privacy")),
    /Owner-published privacy note/u,
  );
  assert.deepEqual(await readPrivacyMarker(data.database), {
    completedAt: NOW,
    contentHash: before.revision.contentHash,
    outcome: "skipped",
    reason: "nonlegacy_copy_preserved",
    version: 1,
  });
});

async function fixture({ privacyContent } = {}) {
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
  if (privacyContent) {
    await database
      .prepare(
        `UPDATE page_sections
         SET content_json = ?, updated_at = ?
         WHERE organization_id = (
           SELECT id
           FROM organizations
           WHERE slug = ?
           LIMIT 1
         )
           AND page_id = (
             SELECT id
             FROM pages
             WHERE organization_id = page_sections.organization_id
               AND slug = 'privacy'
             LIMIT 1
           )
           AND section_key = 'intro'
           AND section_type = 'intro'`,
      )
      .bind(
        JSON.stringify(privacyContent),
        NOW - 80,
        "vancouver-curiosity-and-education-society",
      )
      .run();
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

async function pageWorkspace(data) {
  const pageId = await data.database
    .prepare(
      `SELECT id
       FROM pages
       WHERE organization_id = ?
         AND slug = 'privacy'
       LIMIT 1`,
    )
    .bind(data.actor.organizationId)
    .first("id");
  return readCmsEntityWorkspace(
    data.database,
    OWNER,
    "page",
    pageId,
  );
}

async function readPrivacyMarker(database) {
  const value = await readOptionalPrivacyMarker(database);
  assert.equal(typeof value, "object");
  return value;
}

async function readOptionalPrivacyMarker(database) {
  const valueJson = await database
    .prepare(
      `SELECT value_json
       FROM site_settings
       WHERE key = 'visitor_privacy_copy_upgrade'
       LIMIT 1`,
    )
    .first("value_json");
  if (valueJson === null) return null;
  assert.equal(typeof valueJson, "string");
  return JSON.parse(valueJson);
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
    .map((name) =>
      readFileSync(join(process.cwd(), "drizzle", name), "utf8"),
    )
    .join("\n");
}
