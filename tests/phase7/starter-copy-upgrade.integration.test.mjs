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
  assertRecordedD1ShapesCompile,
} from "../database/d1-recorded-shapes.mjs";
import {
  reconcilePhase7StarterPageCopy,
  readCmsEntityWorkspace,
  saveCmsEntityDraft,
} from "../../lib/server/organizer/cms.ts";
import { ensureCmsAdoption } from "../../lib/server/organizer/cms-adoption.ts";
import {
  runRequestMaintenance,
} from "../../lib/server/database/request-maintenance.ts";
import {
  ensurePublicCatalog,
  getPublicPageContent,
} from "../../lib/server/public/catalog.ts";
import {
  SqliteD1TestDatabase,
  startSqliteD1StatementRecording,
} from "../auth/sqlite-d1.mjs";

const OWNER_EMAIL = "phase7-starter-copy-owner@vcc-tests.invalid";
const OWNER = trustedIdentityFromSites({
  displayName: "Phase 7 starter copy owner",
  email: OWNER_EMAIL,
});
const NOW = Date.parse("2032-05-01T12:00:00.000Z");
const starterCopySqlRecording = startSqliteD1StatementRecording({
  sourceIncludes: [
    "/lib/server/organizer/cms.ts",
    "/lib/server/database/request-maintenance.ts",
  ],
});
const PAGE_SLUGS = [
  "contact",
  "get-involved",
  "host-an-event",
  "privacy",
];
const LEGACY_CONTENT = Object.freeze({
  contact: {
    heading: "Find us on Meetup",
    text:
      "No public contact form or confirmed public email is available yet. Use one of the confirmed Meetup group destinations.",
  },
  "get-involved": {
    heading: "Bring something to the club",
    paragraphs: [
      "Attending a published event is the simplest way in. Volunteer, host, and partner conversations currently begin through one of the confirmed Meetup group pages.",
      "No public intake form is enabled in this phase, and an idea does not reserve a date or guarantee publication.",
    ],
    text:
      "You can attend, share an event idea, volunteer, host a gathering, or begin a conversation about partnering.",
  },
  "host-an-event": {
    heading: "Interested in hosting?",
    paragraphs: [
      "This page is informational. It does not submit an event, reserve a date, or promise that an idea will be scheduled.",
      "A useful starting idea has a clear question or activity, a reason to gather, and enough practical detail for an organizer to assess later.",
    ],
    text:
      "Event-hosting tools are not open yet. For now, read the club’s approach and connect through a confirmed Meetup group page.",
  },
  privacy: {
    heading: "Privacy, in plain language",
    paragraphs: [
      "The site is hosted with ChatGPT Sites and uses Sites-managed D1 for structured data and R2 for approved files.",
      "Organizer access will use Sign in with ChatGPT, which shares authenticated identity information with the organizer portal. Public event facts imported from Meetup link back to the official RSVP page.",
      "This starter notice needs legal review before a public launch.",
    ],
    text:
      "Public pages can be browsed without an attendee account. This phase has no enabled public submission form.",
  },
});

test("legacy starter pages upgrade one per maintenance request through exact CMS publication", async (t) => {
  const data = await fixture({ legacy: true });
  t.after(() => data.database.close());
  await ensureDatabaseInvariantsReady(data.database);

  const requestCounts = [];
  for (const [index, slug] of PAGE_SLUGS.entries()) {
    await ensureDatabaseInvariantsReady(data.database);
    const counted = countedDatabase(data.database);
    const result = await runRequestMaintenance(counted.database, {
      method: "GET",
      pathname: `/${slug}`,
    });
    assert.deepEqual(result, { kind: "redirect", source: "cms" });
    assert.ok(
      counted.statementCount + 2 < 50,
      `${slug} maintenance used ${counted.statementCount + 2} statements`,
    );
    requestCounts.push(counted.statementCount + 2);

    const marker = await readMarker(data.database);
    assert.equal(marker.outcomes.length, index + 1);
    assert.equal(marker.outcomes.at(-1).slug, slug);
    assert.equal(marker.outcomes.at(-1).outcome, "upgraded");
    assert.equal(
      marker.outcomes.at(-1).reason,
      "legacy_copy_upgraded",
    );
    assert.equal(
      marker.completedAt,
      index === 3 ? marker.outcomes.at(-1).recordedAt : null,
    );

    const publicPage = await getPublicPageContent(data.database, slug);
    assert.ok(publicPage);
    assert.doesNotMatch(
      JSON.stringify(publicPage),
      /No public intake form|tools are not open yet|No public contact form|no enabled public submission form/iu,
    );
  }
  assert.deepEqual(requestCounts, [28, 28, 28, 28]);

  await ensureDatabaseInvariantsReady(data.database);
  const ready = countedDatabase(data.database);
  assert.deepEqual(
    await runRequestMaintenance(ready.database, {
      method: "GET",
      pathname: "/contact",
    }),
    { kind: "continue" },
  );
  assert.equal(ready.statementCount, 1);

  const stateRows = await data.database
    .prepare(
      `SELECT page.slug, state.content_version,
              count(revision.id) AS revision_count
       FROM pages AS page
       JOIN cms_entity_publication_states AS state
         ON state.organization_id = page.organization_id
        AND state.entity_type = 'page'
        AND state.entity_key = page.id
       JOIN cms_entity_revisions AS revision
         ON revision.organization_id = state.organization_id
        AND revision.publication_state_id = state.id
       WHERE page.organization_id = ?
         AND page.slug IN ('contact', 'get-involved', 'host-an-event', 'privacy')
       GROUP BY page.id
       ORDER BY page.slug`,
    )
    .bind(data.actor.organizationId)
    .all();
  assert.deepEqual(
    stateRows.results.map((row) => ({
      revisionCount: row.revision_count,
      slug: row.slug,
      version: row.content_version,
    })),
    [
      { revisionCount: 2, slug: "contact", version: 3 },
      { revisionCount: 2, slug: "get-involved", version: 3 },
      { revisionCount: 2, slug: "host-an-event", version: 3 },
      { revisionCount: 2, slug: "privacy", version: 3 },
    ],
  );
});

test("current fresh seeds record completion without creating editorial revisions", async (t) => {
  const data = await fixture({ legacy: false });
  t.after(() => data.database.close());

  for (let index = 0; index < PAGE_SLUGS.length; index += 1) {
    assert.equal(
      await reconcilePhase7StarterPageCopy(data.database, NOW + index),
      "processed",
    );
  }
  assert.equal(
    await reconcilePhase7StarterPageCopy(data.database, NOW + 10),
    "ready",
  );
  const marker = await readMarker(data.database);
  assert.deepEqual(
    marker.outcomes.map(({ outcome, reason, slug }) => ({
      outcome,
      reason,
      slug,
    })),
    PAGE_SLUGS.map((slug) => ({
      outcome: "upgraded",
      reason: "already_current",
      slug,
    })),
  );
  assert.equal(marker.completedAt, NOW + 3);
  assert.equal(
    await data.database
      .prepare(
        `SELECT count(*) AS count
         FROM cms_entity_revisions AS revision
         JOIN pages AS page
           ON page.id = revision.entity_key
          AND page.organization_id = revision.organization_id
         WHERE revision.organization_id = ?
           AND page.slug IN (
             'contact', 'get-involved', 'host-an-event', 'privacy'
           )`,
      )
      .bind(data.actor.organizationId)
      .first("count"),
    4,
  );
});

test("a newer Owner draft is preserved, skipped durably, and notified without public mutation", async (t) => {
  const data = await fixture({ legacy: true });
  t.after(() => data.database.close());
  const before = await pageWorkspace(data, "contact");
  const ownerSnapshot = {
    ...before.revision.snapshot,
    blocks: before.revision.snapshot.blocks.map((block) =>
      block.id === "intro"
        ? {
            ...block,
            config: {
              ...block.config,
              heading: "Owner private contact draft",
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
    NOW,
  );
  const savedRevisionId = saved.revision.id;
  const publishedRevisionId = saved.entity.publishedRevisionId;

  assert.equal(
    await reconcilePhase7StarterPageCopy(data.database, NOW + 1),
    "processed",
  );
  const after = await pageWorkspace(data, "contact");
  assert.equal(after.revision.id, savedRevisionId);
  assert.equal(after.entity.publishedRevisionId, publishedRevisionId);
  assert.equal(
    after.revision.snapshot.blocks[0].config.heading,
    "Owner private contact draft",
  );
  const publicPage = await getPublicPageContent(data.database, "contact");
  assert.match(
    JSON.stringify(publicPage),
    /No public contact form/u,
  );

  const marker = await readMarker(data.database);
  assert.deepEqual(
    marker.outcomes.map(({ outcome, reason, slug }) => ({
      outcome,
      reason,
      slug,
    })),
    [
      {
        outcome: "skipped",
        reason: "newer_draft_preserved",
        slug: "contact",
      },
    ],
  );
  const notification = await data.database
    .prepare(
      `SELECT recipient_profile_id, type, payload_json
       FROM notifications
       WHERE organization_id = ?
         AND type = 'cms_starter_copy_skipped'`,
    )
    .bind(data.actor.organizationId)
    .first();
  assert.equal(notification.recipient_profile_id, data.actor.profileId);
  assert.deepEqual(JSON.parse(notification.payload_json), {
    pageId: before.entity.entityKey,
    pageSlug: "contact",
  });

  assert.equal(
    await reconcilePhase7StarterPageCopy(data.database, NOW + 2),
    "processed",
  );
  assert.equal(
    await data.database
      .prepare(
        `SELECT count(*) AS count
         FROM notifications
         WHERE organization_id = ?
           AND type = 'cms_starter_copy_skipped'`,
      )
      .bind(data.actor.organizationId)
      .first("count"),
    1,
  );
});

test("synchronized first calls leave one page outcome and converge on retry", async (t) => {
  const data = await fixture({ legacy: true });
  t.after(() => data.database.close());
  const attempts = await Promise.allSettled([
    reconcilePhase7StarterPageCopy(data.database, NOW),
    reconcilePhase7StarterPageCopy(data.database, NOW),
  ]);
  assert.ok(
    attempts.some(
      (attempt) =>
        attempt.status === "fulfilled" &&
        attempt.value === "processed",
    ),
  );
  const marker = await readMarker(data.database);
  assert.equal(marker.outcomes.length, 1);
  assert.equal(marker.outcomes[0].slug, "contact");
  const workspace = await pageWorkspace(data, "contact");
  assert.equal(
    workspace.entity.currentDraftRevisionId,
    workspace.entity.publishedRevisionId,
  );
  assert.equal(
    workspace.entity.currentRevisionNumber,
    workspace.entity.publishedRevisionNumber,
  );
  assert.equal(
    await data.database
      .prepare(
        `SELECT count(*) AS count
         FROM cms_entity_revisions
         WHERE organization_id = ?
           AND publication_state_id = (
             SELECT id
             FROM cms_entity_publication_states
             WHERE organization_id = ?
               AND entity_type = 'page'
               AND entity_key = ?
           )`,
      )
      .bind(
        data.actor.organizationId,
        data.actor.organizationId,
        workspace.entity.entityKey,
      )
      .first("count"),
    2,
  );
});

test("starter-copy maintenance SQL stays within real D1 limits", async () => {
  const shapes = starterCopySqlRecording.stop();
  await assertRecordedD1ShapesCompile(shapes, {
    expectedCount: 29,
    label: "Phase 7 starter-copy maintenance",
  });
});

async function fixture({ legacy }) {
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
  if (legacy) {
    for (const [index, slug] of PAGE_SLUGS.entries()) {
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
                 AND slug = ?
               LIMIT 1
             )
             AND section_key = 'intro'
             AND section_type = 'intro'`,
        )
        .bind(
          JSON.stringify(LEGACY_CONTENT[slug]),
          NOW - 80 + index,
          "vancouver-curiosity-and-education-society",
          slug,
        )
        .run();
    }
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

async function readMarker(database) {
  const json = await database
    .prepare(
      `SELECT value_json
       FROM site_settings
       WHERE key = 'phase7_starter_copy_upgrade'
       LIMIT 1`,
    )
    .first("value_json");
  assert.equal(typeof json, "string");
  return JSON.parse(json);
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
