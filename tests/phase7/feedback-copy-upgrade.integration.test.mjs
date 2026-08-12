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
  reconcileVisitorFeedbackCopy,
  saveCmsEntityDraft,
} from "../../lib/server/organizer/cms.ts";
import { ensureCmsAdoption } from "../../lib/server/organizer/cms-adoption.ts";
import {
  ensurePublicCatalog,
  getPublicPageContent,
} from "../../lib/server/public/catalog.ts";
import { PUBLIC_CATALOG_PAGES } from "../../lib/server/public/catalog-definitions.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const OWNER_EMAIL = "visitor-feedback-owner@vcc-tests.invalid";
const OWNER = trustedIdentityFromSites({
  displayName: "Visitor feedback copy owner",
  email: OWNER_EMAIL,
});
const NOW = Date.parse("2032-07-01T12:00:00.000Z");
const ORGANIZATION_SLUG =
  "vancouver-curiosity-and-education-society";
const PREVIOUS_CONTACT_CONTENT = Object.freeze({
  heading: "Send a private inquiry",
  text:
    "The Contact form stores your name, reply email, topic, and message in the private organizer inbox. It does not enroll you in marketing or send an email confirmation.",
});
const CUSTOM_CONTACT_CONTENT = Object.freeze({
  heading: "A note from the organizers",
  text:
    "This is deliberate owner-published copy and must never be replaced automatically.",
});

test("the exact previous Contact publication upgrades through the guarded CMS protocol", async (t) => {
  const data = await fixture({ contactContent: PREVIOUS_CONTACT_CONTENT });
  t.after(() => data.database.close());
  await ensureDatabaseInvariantsReady(data.database);
  const counted = countedDatabase(data.database);

  assert.equal(
    await reconcileVisitorFeedbackCopy(counted.database, NOW),
    "processed",
  );
  assert.ok(
    counted.statementCount + 2 < 50,
    `feedback copy maintenance used ${counted.statementCount + 2} statements`,
  );

  const page = await getPublicPageContent(data.database, "contact");
  assert.ok(page);
  assert.equal(page.title, "Feedback");
  assert.equal(page.seoTitle, "Feedback");
  assert.equal(page.sections[0]?.content.heading, targetIntro().heading);
  assert.equal(page.sections[0]?.content.text, targetIntro().text);
  assert.doesNotMatch(JSON.stringify(page), /Contact form|private inquiry/u);

  const workspace = await pageWorkspace(data);
  assert.equal(
    workspace.entity.currentDraftRevisionId,
    workspace.entity.publishedRevisionId,
  );
  assert.equal(workspace.entity.contentVersion, 3);
  assert.equal(workspace.revisions.length, 2);
  assert.deepEqual(await readFeedbackMarker(data.database), {
    completedAt: NOW,
    contentHash: workspace.revision.contentHash,
    outcome: "upgraded",
    reason: "legacy_copy_upgraded",
    version: 1,
  });
  assert.equal(
    await data.database
      .prepare(
        `SELECT count(*) AS count
         FROM audit_logs
         WHERE organization_id = ?
           AND json_extract(metadata_json, '$.source') =
               'visitor_feedback_copy_upgrade'`,
      )
      .bind(data.actor.organizationId)
      .first("count"),
    2,
    "the draft and publication must both retain the dedicated audit source",
  );
});

test("an already-current Feedback publication records once and is then a read-only fast path", async (t) => {
  const data = await fixture();
  t.after(() => data.database.close());
  const before = await pageWorkspace(data);
  assert.equal(before.revision.snapshot.title, "Feedback");
  assert.equal(
    before.revision.snapshot.blocks[0]?.config.heading,
    "Share feedback or ask a question",
  );

  assert.equal(
    await reconcileVisitorFeedbackCopy(data.database, NOW),
    "processed",
  );
  assert.equal(
    await reconcileVisitorFeedbackCopy(data.database, NOW + 1),
    "ready",
  );
  const after = await pageWorkspace(data);
  assert.equal(after.entity.contentVersion, before.entity.contentVersion);
  assert.equal(after.revisions.length, 1);
  assert.deepEqual(await readFeedbackMarker(data.database), {
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
      reconcileVisitorFeedbackCopy(data.database, NOW),
      reconcileVisitorFeedbackCopy(data.database, NOW + 1),
    ]),
    ["processed", "processed"],
  );
  assert.equal(
    await reconcileVisitorFeedbackCopy(data.database, NOW + 2),
    "ready",
  );
  const marker = await readFeedbackMarker(data.database);
  assert.ok(marker.completedAt === NOW || marker.completedAt === NOW + 1);
  assert.equal(marker.outcome, "upgraded");
  assert.equal(marker.reason, "already_current");
});

test("a newer Owner draft preserves both draft and public Contact copy and creates one review notification", async (t) => {
  const data = await fixture({ contactContent: PREVIOUS_CONTACT_CONTENT });
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
              heading: "Owner feedback draft in progress",
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
      reconcileVisitorFeedbackCopy(data.database, NOW),
      reconcileVisitorFeedbackCopy(data.database, NOW + 1),
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
    "Owner feedback draft in progress",
  );
  assert.equal(
    (await getPublicPageContent(data.database, "contact"))?.title,
    "Contact",
  );
  assert.equal(
    (await readFeedbackMarker(data.database)).reason,
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
          pageSlug: "contact",
        }),
      )
      .first("count"),
    1,
  );
});

test("a target-shaped Owner draft without the upgrade audit source is never auto-published", async (t) => {
  const data = await fixture({ contactContent: PREVIOUS_CONTACT_CONTENT });
  t.after(() => data.database.close());
  const before = await pageWorkspace(data);
  const saved = await saveCmsEntityDraft(
    data.database,
    OWNER,
    "page",
    before.entity.entityKey,
    {
      expectedContentVersion: before.entity.contentVersion,
      snapshot: targetSnapshotFrom(before.revision.snapshot),
    },
    NOW - 1,
  );

  assert.equal(
    await reconcileVisitorFeedbackCopy(data.database, NOW),
    "processed",
  );
  const after = await pageWorkspace(data);
  assert.equal(after.revision.id, saved.revision.id);
  assert.equal(
    after.entity.publishedRevisionId,
    before.entity.publishedRevisionId,
  );
  assert.equal(
    (await getPublicPageContent(data.database, "contact"))?.title,
    "Contact",
  );
  assert.equal(
    (await readFeedbackMarker(data.database)).reason,
    "newer_draft_preserved",
  );
});

test("a target draft saved by this upgrade resumes publication after an interrupted first attempt", async (t) => {
  const data = await fixture({ contactContent: PREVIOUS_CONTACT_CONTENT });
  t.after(() => data.database.close());
  const interrupted = failBatch(data.database, 2);

  await assert.rejects(
    reconcileVisitorFeedbackCopy(interrupted.database, NOW),
  );
  assert.equal(interrupted.batchCount, 2);
  const partial = await pageWorkspace(data);
  assert.notEqual(
    partial.entity.currentDraftRevisionId,
    partial.entity.publishedRevisionId,
  );
  assert.equal(partial.revision.snapshot.title, "Feedback");
  assert.equal(await readOptionalFeedbackMarker(data.database), null);

  assert.equal(
    await reconcileVisitorFeedbackCopy(data.database, NOW + 1),
    "processed",
  );
  const after = await pageWorkspace(data);
  assert.equal(
    after.entity.currentDraftRevisionId,
    after.entity.publishedRevisionId,
  );
  assert.equal(after.revision.id, partial.revision.id);
  assert.equal(
    (await readFeedbackMarker(data.database)).reason,
    "legacy_copy_upgraded",
  );
});

test("an unknown Owner-published Contact revision is preserved without a replacement revision", async (t) => {
  const data = await fixture({ contactContent: CUSTOM_CONTACT_CONTENT });
  t.after(() => data.database.close());
  const before = await pageWorkspace(data);

  assert.equal(
    await reconcileVisitorFeedbackCopy(data.database, NOW),
    "processed",
  );
  const after = await pageWorkspace(data);
  assert.equal(after.entity.contentVersion, before.entity.contentVersion);
  assert.equal(after.revisions.length, 1);
  assert.match(
    JSON.stringify(await getPublicPageContent(data.database, "contact")),
    /deliberate owner-published copy/u,
  );
  assert.deepEqual(await readFeedbackMarker(data.database), {
    completedAt: NOW,
    contentHash: before.revision.contentHash,
    outcome: "skipped",
    reason: "nonlegacy_copy_preserved",
    version: 1,
  });
});

test("a corrupt Feedback marker fails closed before any publication work", async (t) => {
  const data = await fixture({ contactContent: PREVIOUS_CONTACT_CONTENT });
  t.after(() => data.database.close());
  const before = await pageWorkspace(data);
  await data.database
    .prepare(
      `INSERT INTO site_settings (
         id, organization_id, key, value_json, is_public,
         updated_by_profile_id, created_at, updated_at
       ) VALUES (?, ?, 'visitor_feedback_copy_upgrade', '{}', 0, ?, ?, ?)`
    )
    .bind(
      "corrupt-feedback-copy-marker",
      data.actor.organizationId,
      data.actor.profileId,
      NOW - 1,
      NOW - 1,
    )
    .run();

  await assert.rejects(
    reconcileVisitorFeedbackCopy(data.database, NOW),
  );
  const after = await pageWorkspace(data);
  assert.equal(after.entity.contentVersion, before.entity.contentVersion);
  assert.equal(after.revisions.length, 1);
});

async function fixture({ contactContent } = {}) {
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
  if (contactContent) {
    const isPrevious = contactContent === PREVIOUS_CONTACT_CONTENT;
    const title = isPrevious ? "Contact" : "Feedback";
    const seoTitle = title;
    const metaDescription = contactContent.text.slice(0, 160);
    await database.batch([
      database
        .prepare(
          `UPDATE pages
           SET title = ?, updated_at = ?
           WHERE organization_id = (
             SELECT id FROM organizations WHERE slug = ? LIMIT 1
           )
             AND slug = 'contact'`,
        )
        .bind(title, NOW - 80, ORGANIZATION_SLUG),
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
                 AND slug = 'contact'
               LIMIT 1
             )
             AND section_key = 'intro'
             AND section_type = 'intro'`,
        )
        .bind(
          JSON.stringify(contactContent),
          NOW - 80,
          ORGANIZATION_SLUG,
        ),
      database
        .prepare(
          `UPDATE page_public_metadata
           SET seo_title = ?, meta_description = ?, updated_at = ?
           WHERE organization_id = (
             SELECT id FROM organizations WHERE slug = ? LIMIT 1
           )
             AND page_id = (
               SELECT id
               FROM pages
               WHERE organization_id = page_public_metadata.organization_id
                 AND slug = 'contact'
               LIMIT 1
             )`,
        )
        .bind(
          seoTitle,
          metaDescription,
          NOW - 80,
          ORGANIZATION_SLUG,
        ),
    ]);
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

function targetDefinition() {
  const definition = PUBLIC_CATALOG_PAGES.find(
    (page) => page.slug === "contact",
  );
  assert.ok(definition);
  assert.equal(definition.title, "Feedback");
  return definition;
}

function targetIntro() {
  const intro = targetDefinition().sections.find(
    (section) => section.key === "intro" && section.type === "intro",
  )?.content;
  assert.ok(intro);
  assert.equal(intro.heading, "Share feedback or ask a question");
  assert.match(intro.text, /^The Feedback form/u);
  return intro;
}

function targetSnapshotFrom(previousSnapshot) {
  const definition = targetDefinition();
  const intro = targetIntro();
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

async function pageWorkspace(data) {
  const pageId = await data.database
    .prepare(
      `SELECT id
       FROM pages
       WHERE organization_id = ?
         AND slug = 'contact'
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

async function readFeedbackMarker(database) {
  const value = await readOptionalFeedbackMarker(database);
  assert.equal(typeof value, "object");
  return value;
}

async function readOptionalFeedbackMarker(database) {
  const valueJson = await database
    .prepare(
      `SELECT value_json
       FROM site_settings
       WHERE key = 'visitor_feedback_copy_upgrade'
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
