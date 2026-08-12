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
  reconcileVisitorEventsCopy,
  saveCmsEntityDraft,
} from "../../lib/server/organizer/cms.ts";
import { ensureCmsAdoption } from "../../lib/server/organizer/cms-adoption.ts";
import {
  ensurePublicCatalog,
  getPublicPageContent,
} from "../../lib/server/public/catalog.ts";
import { PUBLIC_CATALOG_PAGES } from "../../lib/server/public/catalog-definitions.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const OWNER_EMAIL = "visitor-events-owner@vcc-tests.invalid";
const OWNER = trustedIdentityFromSites({
  displayName: "Visitor events copy owner",
  email: OWNER_EMAIL,
});
const NOW = Date.parse("2032-07-02T12:00:00.000Z");
const ORGANIZATION_SLUG =
  "vancouver-curiosity-and-education-society";
const PREVIOUS_EVENTS_CONTENT = Object.freeze({
  heading: "Events",
  text: "Browse the genuinely published gatherings on the calendar.",
});
const CUSTOM_EVENTS_CONTENT = Object.freeze({
  heading: "Choose a gathering",
  text:
    "This deliberate owner-published Events introduction must remain unchanged.",
});

test("the exact previous Events publication upgrades through the guarded CMS protocol", async (t) => {
  const data = await fixture({ eventsContent: PREVIOUS_EVENTS_CONTENT });
  t.after(() => data.database.close());
  await ensureDatabaseInvariantsReady(data.database);
  const counted = countedDatabase(data.database);

  assert.equal(
    await reconcileVisitorEventsCopy(counted.database, NOW),
    "processed",
  );
  assert.ok(
    counted.statementCount + 2 < 50,
    `Events copy maintenance used ${counted.statementCount + 2} statements`,
  );

  const page = await getPublicPageContent(data.database, "events");
  assert.ok(page);
  assert.equal(page.title, "Events");
  assert.equal(page.sections[0]?.content.heading, "Events");
  assert.equal(page.sections[0]?.content.text, targetIntro().text);
  assert.doesNotMatch(JSON.stringify(page), /genuinely published/u);

  const workspace = await pageWorkspace(data);
  assert.equal(
    workspace.entity.currentDraftRevisionId,
    workspace.entity.publishedRevisionId,
  );
  assert.equal(workspace.entity.contentVersion, 3);
  assert.equal(workspace.revisions.length, 2);
  assert.deepEqual(await readEventsMarker(data.database), {
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
               'visitor_events_copy_upgrade'`,
      )
      .bind(data.actor.organizationId)
      .first("count"),
    2,
    "the draft and publication must retain the dedicated Events audit source",
  );
});

test("simultaneous exact-legacy Events upgrades converge without a transient failure", async (t) => {
  const data = await fixture({ eventsContent: PREVIOUS_EVENTS_CONTENT });
  t.after(() => data.database.close());

  const results = await Promise.all([
    reconcileVisitorEventsCopy(data.database, NOW),
    reconcileVisitorEventsCopy(data.database, NOW + 1),
  ]);
  assert.deepEqual(results, ["processed", "processed"]);

  const workspace = await pageWorkspace(data);
  assert.equal(
    workspace.entity.currentDraftRevisionId,
    workspace.entity.publishedRevisionId,
  );
  assert.equal(workspace.revision.snapshot.blocks[0]?.config.text, targetIntro().text);
  assert.equal(workspace.revisions.length, 2);
  assert.equal((await readEventsMarker(data.database)).reason, "legacy_copy_upgraded");
  assert.equal(
    await reconcileVisitorEventsCopy(data.database, NOW + 2),
    "ready",
  );
});

test("an already-current Events publication records once and becomes a read-only fast path", async (t) => {
  const data = await fixture();
  t.after(() => data.database.close());
  const before = await pageWorkspace(data);

  assert.equal(
    before.revision.snapshot.blocks[0]?.config.text,
    targetIntro().text,
  );
  assert.equal(
    await reconcileVisitorEventsCopy(data.database, NOW),
    "processed",
  );
  assert.equal(
    await reconcileVisitorEventsCopy(data.database, NOW + 1),
    "ready",
  );
  const after = await pageWorkspace(data);
  assert.equal(after.entity.contentVersion, before.entity.contentVersion);
  assert.equal(after.revisions.length, 1);
  assert.deepEqual(await readEventsMarker(data.database), {
    completedAt: NOW,
    contentHash: before.revision.contentHash,
    outcome: "upgraded",
    reason: "already_current",
    version: 1,
  });
});

test("a newer Owner draft is preserved and creates one review notification", async (t) => {
  const data = await fixture({ eventsContent: PREVIOUS_EVENTS_CONTENT });
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
              text: "Owner Events draft in progress.",
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

  assert.equal(
    await reconcileVisitorEventsCopy(data.database, NOW),
    "processed",
  );
  const after = await pageWorkspace(data);
  assert.equal(after.revision.id, saved.revision.id);
  assert.equal(
    after.entity.publishedRevisionId,
    before.entity.publishedRevisionId,
  );
  assert.equal(
    after.revision.snapshot.blocks[0]?.config.text,
    "Owner Events draft in progress.",
  );
  assert.equal(
    (await getPublicPageContent(data.database, "events"))?.sections[0]
      ?.content.text,
    PREVIOUS_EVENTS_CONTENT.text,
  );
  assert.equal(
    (await readEventsMarker(data.database)).reason,
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
          pageSlug: "events",
        }),
      )
      .first("count"),
    1,
  );
});

test("a target-shaped Owner draft without the Events upgrade audit is not auto-published", async (t) => {
  const data = await fixture({ eventsContent: PREVIOUS_EVENTS_CONTENT });
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
    await reconcileVisitorEventsCopy(data.database, NOW),
    "processed",
  );
  const after = await pageWorkspace(data);
  assert.equal(after.revision.id, saved.revision.id);
  assert.equal(
    after.entity.publishedRevisionId,
    before.entity.publishedRevisionId,
  );
  assert.equal(
    (await getPublicPageContent(data.database, "events"))?.sections[0]
      ?.content.text,
    PREVIOUS_EVENTS_CONTENT.text,
  );
  assert.equal(
    (await readEventsMarker(data.database)).reason,
    "newer_draft_preserved",
  );
});

test("an audit-proven Events upgrade draft resumes after an interrupted publication", async (t) => {
  const data = await fixture({ eventsContent: PREVIOUS_EVENTS_CONTENT });
  t.after(() => data.database.close());
  const interrupted = failBatchesFrom(data.database, 2);

  await assert.rejects(
    reconcileVisitorEventsCopy(interrupted.database, NOW),
  );
  assert.equal(interrupted.batchCount, 4);
  const partial = await pageWorkspace(data);
  assert.notEqual(
    partial.entity.currentDraftRevisionId,
    partial.entity.publishedRevisionId,
  );
  assert.equal(
    partial.revision.snapshot.blocks[0]?.config.text,
    targetIntro().text,
  );
  assert.equal(await readOptionalEventsMarker(data.database), null);

  assert.equal(
    await reconcileVisitorEventsCopy(data.database, NOW + 1),
    "processed",
  );
  const after = await pageWorkspace(data);
  assert.equal(
    after.entity.currentDraftRevisionId,
    after.entity.publishedRevisionId,
  );
  assert.equal(after.revision.id, partial.revision.id);
  assert.equal(
    (await readEventsMarker(data.database)).reason,
    "legacy_copy_upgraded",
  );
});

test("an unknown Owner-published Events revision is preserved without a replacement", async (t) => {
  const data = await fixture({ eventsContent: CUSTOM_EVENTS_CONTENT });
  t.after(() => data.database.close());
  const before = await pageWorkspace(data);

  assert.equal(
    await reconcileVisitorEventsCopy(data.database, NOW),
    "processed",
  );
  const after = await pageWorkspace(data);
  assert.equal(after.entity.contentVersion, before.entity.contentVersion);
  assert.equal(after.revisions.length, 1);
  assert.equal(
    (await getPublicPageContent(data.database, "events"))?.sections[0]
      ?.content.text,
    CUSTOM_EVENTS_CONTENT.text,
  );
  assert.deepEqual(await readEventsMarker(data.database), {
    completedAt: NOW,
    contentHash: before.revision.contentHash,
    outcome: "skipped",
    reason: "nonlegacy_copy_preserved",
    version: 1,
  });
});

test("a corrupt Events copy marker fails closed before publication work", async (t) => {
  const data = await fixture({ eventsContent: PREVIOUS_EVENTS_CONTENT });
  t.after(() => data.database.close());
  const before = await pageWorkspace(data);
  await data.database
    .prepare(
      `INSERT INTO site_settings (
         id, organization_id, key, value_json, is_public,
         updated_by_profile_id, created_at, updated_at
       ) VALUES (?, ?, 'visitor_events_copy_upgrade', ?, 0, ?, ?, ?)`,
    )
    .bind(
      "corrupt-visitor-events-copy-marker",
      data.actor.organizationId,
      JSON.stringify({ version: 99 }),
      data.actor.profileId,
      NOW - 1,
      NOW - 1,
    )
    .run();

  await assert.rejects(
    reconcileVisitorEventsCopy(data.database, NOW),
    (error) => error?.code === "service_unavailable",
  );
  const after = await pageWorkspace(data);
  assert.equal(after.entity.contentVersion, before.entity.contentVersion);
  assert.equal(after.revisions.length, before.revisions.length);
  assert.equal(
    (await getPublicPageContent(data.database, "events"))?.sections[0]
      ?.content.text,
    PREVIOUS_EVENTS_CONTENT.text,
  );
});

async function fixture({ eventsContent } = {}) {
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
  if (eventsContent) {
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
                 AND slug = 'events'
               LIMIT 1
             )
             AND section_key = 'intro'
             AND section_type = 'intro'`,
        )
        .bind(
          JSON.stringify(eventsContent),
          NOW - 80,
          ORGANIZATION_SLUG,
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
                 AND slug = 'events'
               LIMIT 1
             )`,
        )
        .bind(
          eventsContent.text.slice(0, 160),
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
    (page) => page.slug === "events",
  );
  assert.ok(definition);
  assert.equal(definition.title, "Events");
  return definition;
}

function targetIntro() {
  const intro = targetDefinition().sections.find(
    (section) => section.key === "intro" && section.type === "intro",
  )?.content;
  assert.ok(intro);
  assert.equal(intro.heading, "Events");
  assert.equal(intro.text, "Find your next gathering on the calendar.");
  return intro;
}

function targetSnapshotFrom(previousSnapshot) {
  const intro = targetIntro();
  return {
    ...previousSnapshot,
    blocks: previousSnapshot.blocks.map((block) =>
      block.id === "intro" ? { ...block, config: intro } : block,
    ),
    metaDescription: intro.text.slice(0, 160),
  };
}

async function pageWorkspace(data) {
  const pageId = await data.database
    .prepare(
      `SELECT id
       FROM pages
       WHERE organization_id = ?
         AND slug = 'events'
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

async function readEventsMarker(database) {
  const value = await readOptionalEventsMarker(database);
  assert.equal(typeof value, "object");
  return value;
}

async function readOptionalEventsMarker(database) {
  const valueJson = await database
    .prepare(
      `SELECT value_json
       FROM site_settings
       WHERE key = 'visitor_events_copy_upgrade'
       LIMIT 1`,
    )
    .first("value_json");
  if (valueJson === null) return null;
  assert.equal(typeof valueJson, "string");
  return JSON.parse(valueJson);
}

function failBatchesFrom(database, firstFailingBatchNumber) {
  let batchCount = 0;
  return {
    database: {
      async batch(statements) {
        batchCount += 1;
        if (batchCount >= firstFailingBatchNumber) {
          throw new Error("Injected persistent batch interruption");
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
