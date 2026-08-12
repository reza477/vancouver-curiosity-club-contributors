import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Log, LogLevel, Miniflare } from "miniflare";
import { trustedIdentityFromSites } from "../lib/server/auth/index.ts";
import {
  DATABASE_INVARIANT_TRIGGER_NAMES,
  DATABASE_INVARIANT_VERSION,
  getExpectedDatabaseInvariantFingerprint,
} from "../lib/server/database/invariants.ts";
import {
  createOrganizerEvent,
} from "../lib/server/organizer/events.ts";
import {
  performOrganizerLifecycleAction,
} from "../lib/server/organizer/scheduling.ts";
import {
  createOwnCalendarSubscription,
} from "../lib/server/phase7/calendar-subscriptions.ts";
import {
  createCsvImportPreview,
  inspectCsvImportUpload,
} from "../lib/server/phase7/imports.ts";
import {
  ensurePublicFormProtectionKey,
} from "../lib/server/phase7/public-form-protection.ts";
import {
  submitPublicForm,
} from "../lib/server/phase7/public-forms.ts";
import {
  appendFormSubmissionNote,
} from "../lib/server/phase7/submissions.ts";
import { ensurePublicCatalog } from "../lib/server/public/catalog.ts";
import {
  applyD1MigrationBatches,
  MAX_D1_MIGRATION_STATEMENTS_PER_BATCH,
  migrationStatementBatches,
  productionMigrationFragments,
} from "../scripts/d1-migration-batches.mjs";
import { MAX_DATABASE_INVARIANT_READY_ATTEMPTS } from "./database/invariant-ready.mjs";

class CapturingLog extends Log {
  #messages = [];

  log(message) {
    this.#messages.push(message);
  }

  output() {
    return this.#messages.join("\n");
  }
}

const FIXTURE_NOW = Date.UTC(2026, 6, 24, 19, 0, 0);
const ORGANIZATION_ID = "phase2-org";
const PROFILE_ID = "phase2-owner";
const OWNER_IDENTITY = trustedIdentityFromSites({
  displayName: "Rendered Owner",
  email: "private_owner_email_sentinel@example.invalid",
});
const EXPECTED_DATABASE_INVARIANT_FINGERPRINT =
  await getExpectedDatabaseInvariantFingerprint();
const EXPECTED_DATABASE_INVARIANT_TRIGGERS =
  DATABASE_INVARIANT_TRIGGER_NAMES;
const PRIVATE_SENTINELS = [
  "PRIVATE_LEGAL_SENTINEL",
  "PRIVATE_OWNER_EMAIL_SENTINEL",
  "PRIVATE_ORGANIZER_SENTINEL",
  "PRIVATE_SETTING_SENTINEL",
  "PRIVATE_DRAFT_PAGE_SENTINEL",
  "PRIVATE_DRAFT_CLUB_SENTINEL",
  "PRIVATE_COMMUNITY_SENTINEL",
  "PRIVATE_EVENT_DETAIL_SENTINEL",
  "PRIVATE_VENUE_DETAIL_SENTINEL",
  "PRIVATE_PHASE3_TITLE_SENTINEL",
  "PRIVATE_PHASE3_NOTES_SENTINEL",
  "PRIVATE_PHASE3_MEETING_SENTINEL",
  "PRIVATE_NOTIFICATION_SENTINEL",
  "PRIVATE_AUDIT_SENTINEL",
  "PRIVATE_INVITATION_EMAIL_SENTINEL",
  "RENDERED_PHASE5_PRIVATE_NOTES_SENTINEL",
  "RENDERED_PHASE5_PRIVATE_MEETING_SENTINEL",
  "PHASE7_PRIVATE_FORM_NAME_SENTINEL",
  "PHASE7_PRIVATE_FORM_MESSAGE_SENTINEL",
  "phase7-private-form@example.invalid",
  "PHASE7_PRIVATE_NETWORK_FACTS_SENTINEL",
  "PHASE7_PRIVATE_SUBMISSION_NOTE_SENTINEL",
  "PHASE7_PRIVATE_IMPORT_TITLE_SENTINEL",
  "PHASE7_PRIVATE_IMPORT_ERROR_SENTINEL",
  "private_mapping_header_sentinel",
  "PHASE7_PRIVATE_IMPORT_LABEL_SENTINEL",
  "PHASE7_PRIVATE_EVENT_NOTES_SENTINEL",
  "PHASE7_PRIVATE_EVENT_MEETING_SENTINEL",
  "PHASE7_PRIVATE_CONFLICT_REASON_SENTINEL",
  "PHASE7_PRIVATE_CALENDAR_LABEL_SENTINEL",
  "PHASE7_PRIVATE_MEETUP_FEED_SENTINEL",
  "PHASE7_PRIVATE_R2_OBJECT_KEY_SENTINEL",
];
const phase7DynamicPrivateSentinels = [];
const phase7PrivateIds = Object.seal({
  importBatchId: null,
  mediaAssetId: "phase7-private-media",
  submissionId: null,
});
const OWNER_AUTH_HEADERS = Object.freeze({
  "oai-authenticated-user-email":
    "private_owner_email_sentinel@example.invalid",
  "oai-authenticated-user-full-name": "Rendered%20Owner",
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
});
const INVITATION_TOKEN = "R".repeat(43);
const PUBLIC_PATHS = [
  "/",
  "/events",
  "/clubs",
  "/clubs/vancouver-curiosity-club",
  "/about",
  "/get-involved",
  "/host-an-event",
  "/contact",
  "/conduct",
  "/accessibility",
  "/privacy",
];

const serverRoot = resolve("dist/server");
const moduleFiles = await collectJavaScriptModules(serverRoot);
const clientAssetFiles = await collectTextAssetFiles(resolve("dist/client"));
const entrypoint = resolve(serverRoot, "index.js");
const runtimeLog = new CapturingLog(LogLevel.WARN);
const runtime = createBuiltRuntime(runtimeLog);
await applyPackagedProductionMigrations(runtime);
await seedPublicCatalog(runtime);
await initializePackagedDatabaseInvariants(runtime);
await initializePackagedCmsAdoption(runtime);
await initializePackagedDatabaseInvariants(runtime, false);
await seedPhase7PrivateSentinels(runtime);
await initializePackagedDatabaseInvariants(runtime, false);

test.after(async () => {
  await runtime.dispose();
});

async function fetchPath(path, init) {
  const headers = new Headers(init?.headers);
  return runtime.dispatchFetch(new URL(path, "https://preview.example"), {
    ...init,
    headers,
  });
}

async function clearPublicEventsSnapshotCache() {
  const database = await runtime.getD1Database("DB");
  const snapshots = await database
    .prepare(
      `SELECT cache_key
       FROM public_event_calendar_snapshots
       WHERE organization_id = ?`,
    )
    .bind(ORGANIZATION_ID)
    .all();
  const cache = (await runtime.getCaches()).default;
  await Promise.all(
    snapshots.results.map((row) => {
      assert.equal(typeof row.cache_key, "string");
      const url = new URL(
        "/.__vcc-cache/public-events",
        "https://preview.example",
      );
      url.searchParams.set("key", row.cache_key);
      return cache.delete(url.toString());
    }),
  );
  await database
    .prepare(
      `DELETE FROM public_event_calendar_snapshots
       WHERE organization_id = ?`,
    )
    .bind(ORGANIZATION_ID)
    .run();
  return snapshots.results.length;
}

async function readRenderedStyles(html) {
  const hrefs = [...html.matchAll(/<link\b[^>]*>/giu)].flatMap(
    ([linkTag]) => {
      if (!/\brel="[^"]*\bstylesheet\b[^"]*"/iu.test(linkTag)) return [];
      const href = /\bhref="([^"]+)"/iu.exec(linkTag)?.[1];
      return href ? [href.replaceAll("&amp;", "&")] : [];
    },
  );
  assert.ok(hrefs.length > 0, "the built page must link its rendered CSS");
  const styles = [];
  for (const href of hrefs) {
    const response = await fetchPath(href);
    assert.equal(response.status, 200, `unable to load rendered CSS ${href}`);
    styles.push(await response.text());
  }
  return styles.join("\n");
}

async function organizerMutation(path, method, body) {
  return fetchPath(path, {
    body: JSON.stringify(body),
    headers: {
      ...OWNER_AUTH_HEADERS,
      "content-type": "application/json",
      origin: "https://preview.example",
    },
    method,
  });
}

async function createRenderedTimedDraft({
  clubId = "club-curiosity",
  description,
  endLocal,
  privateMeetingDetails,
  privateNotes,
  startLocal,
  summary,
  title,
  venueId = null,
}) {
  const response = await organizerMutation(
    "/api/organizer/events",
    "POST",
    {
      bufferAfterMinutes: 0,
      bufferBeforeMinutes: 0,
      clubId,
      coOrganizerProfileIds: [],
      description,
      endLocal,
      planningStatus: "draft",
      primaryOrganizerProfileId: PROFILE_ID,
      privateMeetingDetails,
      privateNotes,
      publicationStatus: "private",
      scheduleShape: "timed",
      startLocal,
      summary,
      timeZone: "America/Vancouver",
      title,
      venueId,
    },
  );
  let createDiagnostics = "";
  if (response.status !== 201) {
    const database = await runtime.getD1Database("DB");
    createDiagnostics = JSON.stringify({
      events: (
        await database
          .prepare(
            `SELECT id, content_version, schedule_version
             FROM organizer_events
             WHERE title = ?`,
          )
          .bind(title)
          .all()
      ).results,
      intents: (
        await database
          .prepare(
            `SELECT intent.operation, intent.completed_at
             FROM organizer_schedule_write_intents AS intent
             JOIN organizer_events AS event
               ON event.id = intent.organizer_event_id
             WHERE event.title = ?`,
          )
          .bind(title)
          .all()
      ).results,
    });
  }
  assert.equal(
    response.status,
    201,
    `create rendered Draft: ${await response.clone().text()} ${createDiagnostics}`,
  );
  assertOrganizerPrivateResponse(response);
  const { event } = await response.json();
  assert.equal(event.planningStatus, "draft");
  assert.equal(event.publicationStatus, "private");
  return event;
}

test("the packaged migration contract installs and enforces the exact runtime guards", async () => {
  const packagedMigrationDirectory = resolve("dist/.openai/drizzle");
  const packagedMigrations = (await readdir(packagedMigrationDirectory))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort();
  assert.deepEqual(packagedMigrations, [
    "0008_preproduction_reset.sql",
    "0009_sites_compatible_baseline.sql",
    "0010_sites_compatible_indexes_a.sql",
    "0011_sites_compatible_indexes_b.sql",
    "0012_phase3_organizer_foundation.sql",
    "0013_phase4_conflict_engine.sql",
    "0014_phase5_publication.sql",
    "0015_phase6_cms_media.sql",
    "0016_phase7_import_export_forms.sql",
    "0017_bright_captain_america.sql",
    "0018_public_event_calendar_snapshots.sql",
    "0019_meetup_event_lanes.sql",
    "0020_meetup_public_event_facts.sql",
  ]);
  for (const file of packagedMigrations) {
    const sql = await readFile(join(packagedMigrationDirectory, file), "utf8");
    assert.doesNotMatch(sql, /\bCREATE\s+TRIGGER\b/iu, file);
    const fragments = productionMigrationFragments(sql);
    const batches = migrationStatementBatches(fragments);
    assert.ok(
      batches.every(
        (batch) =>
          batch.length <= MAX_D1_MIGRATION_STATEMENTS_PER_BATCH,
      ),
      `${file} must apply through bounded D1 batches`,
    );
  }
  const packagedFirstTable = productionMigrationFragments(
    await readFile(
      join(
        packagedMigrationDirectory,
        "0009_sites_compatible_baseline.sql",
      ),
      "utf8",
    ),
  )[0];
  const truncatedPackagedStatement = packagedFirstTable.slice(
    0,
    packagedFirstTable.lastIndexOf(")"),
  );
  const malformedDatabase = new DatabaseSync(":memory:");
  try {
    assert.throws(
      () => malformedDatabase.prepare(truncatedPackagedStatement).run(),
      /incomplete input/iu,
    );
  } finally {
    malformedDatabase.close();
  }

  const database = await runtime.getD1Database("DB");
  const meetupPublicContentColumns = await database
    .prepare(
      `SELECT name
       FROM pragma_table_info('meetup_event_snapshot_public_contents')
       WHERE name IN (
         'public_floor', 'public_room', 'capacity', 'cost_text',
         'age_policy_text', 'waitlist_available', 'availability_state',
         'arrival_instructions'
       )
       ORDER BY name`,
    )
    .all();
  assert.deepEqual(
    meetupPublicContentColumns.results.map((row) => row.name),
    [
      "age_policy_text",
      "arrival_instructions",
      "availability_state",
      "capacity",
      "cost_text",
      "public_floor",
      "public_room",
      "waitlist_available",
    ],
    "the packaged 0020 migration must install every Meetup public-fact column",
  );
  const marker = await database
    .prepare(
      `SELECT version, trigger_fingerprint
       FROM database_invariant_state
       WHERE singleton_key = 'database-guards'`,
    )
    .first();
  assert.deepEqual({ ...marker }, {
    trigger_fingerprint: EXPECTED_DATABASE_INVARIANT_FINGERPRINT,
    version: DATABASE_INVARIANT_VERSION,
  });
  const triggerRows = await database
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'trigger'
       ORDER BY name`,
    )
    .all();
  assert.deepEqual(
    triggerRows.results.map((row) => row.name),
    [...EXPECTED_DATABASE_INVARIANT_TRIGGERS],
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name NOT LIKE '_cf_%'`,
      )
      .first("count"),
    88,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM sqlite_master
         WHERE type = 'index'
           AND sql IS NOT NULL`,
      )
      .first("count"),
    200,
  );
  assert.deepEqual(
    (await database.prepare("PRAGMA foreign_key_check").all()).results,
    [],
  );

  await assert.rejects(
    database
      .prepare(
        `INSERT INTO club_public_profiles (
           club_id, organization_id, primary_event_lane_id,
           publication_status, is_featured, created_at, updated_at
         ) VALUES (?, ?, ?, 'draft', 0, ?, ?)`,
      )
      .bind(
        "club-curiosity",
        "other-org",
        "lane-think",
        FIXTURE_NOW,
        FIXTURE_NOW,
      )
      .run(),
    /club_public_profiles_organization_mismatch/u,
  );

  for (const [id, slug] of [
    ["venue-guard-a", "venue-guard-a"],
    ["venue-guard-b", "venue-guard-b"],
  ]) {
    await run(
      database,
      `INSERT INTO venues (
         id, organization_id, name, slug, timezone, is_public,
         created_by_profile_id, updated_by_profile_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'America/Vancouver', 0, ?, ?, ?, ?)`,
      id,
      ORGANIZATION_ID,
      id,
      slug,
      PROFILE_ID,
      PROFILE_ID,
      FIXTURE_NOW,
      FIXTURE_NOW,
    );
  }
  const reservationSql = `INSERT INTO events (
      id, organization_id, club_id, event_lane_id, venue_id, title, slug,
      status, visibility, time_kind, starts_at_utc, ends_at_utc, timezone,
      buffer_before_minutes, buffer_after_minutes, organizer_scope_json,
      schedule_version, schedule_review_state, created_by_profile_id,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'private', 'timed', ?, ?,
      'America/Vancouver', 0, 0, '[]', 1, 'unreviewed', ?, ?, ?, ?
    )`;
  await run(
    database,
    reservationSql,
    "rendered-guard-a",
    ORGANIZATION_ID,
    "club-curiosity",
    "lane-think",
    "venue-guard-a",
    "Rendered guard A",
    "rendered-guard-a",
    Date.UTC(2028, 0, 1, 20),
    Date.UTC(2028, 0, 1, 21),
    PROFILE_ID,
    PROFILE_ID,
    FIXTURE_NOW,
    FIXTURE_NOW,
  );
  await assert.rejects(
    database
      .prepare(reservationSql)
      .bind(
        "rendered-guard-b",
        ORGANIZATION_ID,
        "club-literature",
        "lane-think",
        "venue-guard-b",
        "Rendered guard B",
        "rendered-guard-b",
        Date.UTC(2028, 0, 1, 20, 30),
        Date.UTC(2028, 0, 1, 21, 30),
        PROFILE_ID,
        PROFILE_ID,
        FIXTURE_NOW,
        FIXTURE_NOW,
      )
      .run(),
    /conflict_guard_overlap_organization/u,
  );
  await database
    .prepare(`DELETE FROM events WHERE id = ?`)
    .bind("rendered-guard-a")
    .run();
  await database
    .prepare(`DELETE FROM venues WHERE id IN (?, ?)`)
    .bind("venue-guard-a", "venue-guard-b")
    .run();
});

test("the built public root is indexable and carries the production security contract", async () => {
  const response = await fetchPath("/");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const policy = response.headers.get("content-security-policy") ?? "";
  assert.match(policy, /base-uri 'none'/u);
  assert.match(policy, /frame-ancestors 'none'/u);
  assert.match(policy, /script-src [^;]*'strict-dynamic'/u);
  assert.match(policy, /script-src-attr 'none'/u);
  assert.doesNotMatch(policy, /script-src [^;]*'unsafe-inline'/u);
  assert.doesNotMatch(policy, /script-src [^;]*'unsafe-eval'/u);
  const nonceMatch = /'nonce-([A-Za-z0-9_-]{22})'/u.exec(policy);
  assert.ok(nonceMatch, "production CSP must contain a per-request nonce");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(
    response.headers.get("cross-origin-opener-policy"),
    "same-origin-allow-popups",
  );
  assert.equal(
    response.headers.get("cross-origin-resource-policy"),
    "same-origin",
  );
  assert.equal(
    response.headers.get("permissions-policy"),
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  assert.equal(
    response.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );
  assert.equal(
    response.headers.get("strict-transport-security"),
    "max-age=31536000; includeSubDomains",
  );
  assert.equal(response.headers.get("x-robots-tag"), null);

  const html = await response.text();
  assert.match(html, /<title>Vancouver Curiosity Club<\/title>/iu);
  assert.equal(
    [...html.matchAll(/<title>Vancouver Curiosity Club<\/title>/giu)].length,
    1,
    "Home must emit one absolute title instead of applying the root template twice",
  );
  assert.match(
    html,
    /name="description" content="Thoughtful Vancouver events for people who like learning in company\."/iu,
  );
  assert.match(
    html,
    /Books, films, ideas, walks &amp; creative nights in Vancouver/u,
  );
  assert.match(html, /Come curious\. Leave knowing people\./u);
  assert.match(
    html,
    /Vancouver Curiosity Club is for people who miss conversations that go somewhere\./u,
  );
  assert.match(html, />See upcoming gatherings<\/a>/u);
  assert.match(html, />New here\? Start here<\/a>/u);
  assert.match(html, /class="home-hero"/u);
  assert.match(html, /class="home-events"/u);
  assert.match(html, /class="home-newcomer attending-note"/u);
  assert.match(html, /class="home-community-feel attending-note"/u);
  assert.match(html, /class="lane-index"/u);
  assert.match(html, /class="home-clubs"/u);
  assert.match(html, /class="home-proof home-community"/u);
  assert.match(html, /class="home-closing home-invitation"/u);
  assert.equal([...html.matchAll(/<h1\b/giu)].length, 1);
  const orderedHomeSections = [
    'class="home-hero"',
    'class="home-events"',
    'class="home-newcomer attending-note"',
    'class="home-community-feel attending-note"',
    'class="lane-index"',
    'class="home-clubs"',
    'class="home-proof home-community"',
    'class="home-closing home-invitation"',
  ];
  for (let index = 1; index < orderedHomeSections.length; index += 1) {
    assert.ok(
      html.indexOf(orderedHomeSections[index - 1]) <
        html.indexOf(orderedHomeSections[index]),
      `${orderedHomeSections[index]} must follow ${orderedHomeSections[index - 1]}`,
    );
  }
  assert.doesNotMatch(html, /Month at a glance|public-calendar__grid/u);
  assert.doesNotMatch(
    html,
    /Meetup sync|sync failed|last completed|data-source-status/iu,
  );
  assert.ok(
    robotsMetaContents(html).every(
      (content) => !robotsTokens(content).includes("noindex"),
    ),
    "healthy Home must not emit a noindex robots directive",
  );
  assert.match(
    html,
    /rel="canonical" href="https:\/\/preview\.example\/"/iu,
  );
  assert.match(
    html,
    /property="og:image" content="https:\/\/preview\.example\/og\.png"/iu,
  );
  assert.match(
    html,
    /property="og:description" content="Thoughtful Vancouver events for people who like learning in company\."/iu,
  );
  assert.match(
    html,
    /name="twitter:description" content="Thoughtful Vancouver events for people who like learning in company\."/iu,
  );
  assert.match(
    html,
    /name="twitter:image" content="https:\/\/preview\.example\/og\.png"/iu,
  );
  assert.match(html, /name="twitter:image:alt"/iu);
  assertSharedChrome(html);
  assertNoPrivateSentinels(html);
  assert.doesNotMatch(
    html,
    /SkeletonPreview|Your site is taking shape|react-loading-skeleton/u,
  );
  assert.doesNotMatch(html, /[A-Z]:[\\/][^"'<>]*\.vinext/iu);

  const scriptTags = [...html.matchAll(/<script\b[^>]*>/giu)].map(
    (match) => match[0],
  );
  assert.ok(scriptTags.length > 0, "the rendered app must include scripts");
  for (const scriptTag of scriptTags) {
    assert.match(
      scriptTag,
      new RegExp(`\\bnonce="${nonceMatch[1]}"`, "u"),
      `script is missing the response nonce: ${scriptTag}`,
    );
  }
  assert.match(html, /self\.__VINEXT_RSC_DONE__=true/u);

  const renderedCss = await readRenderedStyles(html);
  assert.match(renderedCss, /--ink-soft:var\(--cms-foreground,#514b68\)/u);
  assert.match(renderedCss, /--warm-surface-ink:#221c3d/u);
  assert.match(renderedCss, /--focus-ring-inner:#000(?:000)?/u);
  assert.match(renderedCss, /--focus-ring-outer:#fff(?:fff)?/u);
  assert.match(
    renderedCss,
    /\.primary-nav\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/u,
  );
  assert.match(
    renderedCss,
    /\.cancellation-banner\{[^}]*background:var\(--paper-deep\)[^}]*color:var\(--ink\)/u,
  );
  assert.match(
    renderedCss,
    /\.status-chip--tentative\{[^}]*border:2px solid var\(--ink\)[^}]*color:var\(--warm-surface-ink\)/u,
  );
  assert.match(
    renderedCss,
    /\.event-card__artwork figcaption,[^{]*\{[^}]*background:var\(--forest\)[^}]*color:var\(--paper\)/u,
  );
  assert.match(
    renderedCss,
    /\.public-error-state\{[^}]*background:var\(--paper-deep\)[^}]*color:var\(--ink\)/u,
  );
  for (const selector of [
    "\\.calendar-state-label span",
    "\\.lane-dot",
    "\\.source-mark",
    "\\.source-status>span",
  ]) {
    assert.match(
      renderedCss,
      new RegExp(
        `${selector}\\{[^}]*border:2px solid var\\(--(?:paper|ink)\\)`,
        "u",
      ),
    );
  }
  assert.doesNotMatch(
    renderedCss,
    /color:#(?:68c4be|c8d0d6|91a0ad|9ba8b4|aeb8c0|d4dade|e1e6e8|78ccc5|92dfd9)/iu,
  );
  assert.doesNotMatch(
    renderedCss,
    /background:rgba\((?:232,91,72|22,34,32|255,255,255)/iu,
  );

  const structuredData = jsonLdDocuments(html);
  assert.equal(structuredData.length, 1);
  assert.deepEqual(
    {
      context: structuredData[0]["@context"],
      type: structuredData[0]["@type"],
      name: structuredData[0].name,
      url: structuredData[0].url,
    },
    {
      context: "https://schema.org",
      type: "Organization",
      name: "Vancouver Curiosity Club",
      url: "https://preview.example/",
    },
  );
  assert.deepEqual(structuredData[0].sameAs, [
    "https://www.meetup.com/vancouver-meetup-group/",
    "https://www.meetup.com/vancouver-literature-and-film/",
    "https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/",
  ]);
  assertNoPrivateSentinels(JSON.stringify(structuredData));

  const modulePath = /<link\b[^>]*rel="modulepreload"[^>]*href="([^"]+)"/iu.exec(
    html,
  )?.[1];
  assert.ok(modulePath, "the built HTML must reference a bootstrap module");
  const moduleResponse = await fetchPath(modulePath);
  assert.equal(moduleResponse.status, 200);
  assert.match(
    moduleResponse.headers.get("content-type") ?? "",
    /javascript|ecmascript/iu,
  );

  const secondResponse = await fetchPath("/", {
    headers: {
      "content-security-policy": "script-src 'nonce-attacker'",
      "content-security-policy-report-only": "script-src 'none'",
      forwarded: "host=attacker.example;proto=http",
      "x-forwarded-host": "attacker.example",
      "x-forwarded-proto": "http",
      "x-vcc-csp-nonce": "AAAAAAAAAAAAAAAAAAAAAA",
      "x-vcc-request-origin": "https://attacker.example",
      "x-vcc-request-pathname": "/attacker-controlled-path",
    },
  });
  const secondPolicy =
    secondResponse.headers.get("content-security-policy") ?? "";
  const secondNonce = /'nonce-([A-Za-z0-9_-]{22})'/u.exec(secondPolicy)?.[1];
  assert.ok(secondNonce);
  assert.notEqual(secondNonce, nonceMatch[1]);
  assert.doesNotMatch(secondPolicy, /attacker/u);
  assert.doesNotMatch(secondPolicy, /AAAAAAAAAAAAAAAAAAAAAA/u);
  assert.equal(
    secondResponse.headers.get("content-security-policy-report-only"),
    null,
  );
  const secondHtml = await secondResponse.text();
  assert.doesNotMatch(secondHtml, /https:\/\/attacker\.example/u);
  assert.doesNotMatch(secondHtml, /nonce="AAAAAAAAAAAAAAAAAAAAAA"/u);
  assert.match(secondHtml, /https:\/\/preview\.example\/og\.png/u);
});

test("all required public pages render shared chrome without private sentinels", async () => {
  for (const path of PUBLIC_PATHS) {
    const response = await fetchPath(path);
    assert.equal(response.status, 200, `${path} status`);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^text\/html\b/i,
      `${path} content type`,
    );
    assert.equal(response.headers.get("x-robots-tag"), null, `${path} robots`);
    const html = await response.text();
    assertSharedChrome(html);
    assertNoPrivateSentinels(html);
    assert.doesNotMatch(html, /events\/ical|source_url|normalized_email/iu);
  }
});

test("public form routes render a safe pre-hydration state", async () => {
  let renderedCss = "";
  for (const [path, formKeys] of [
    ["/contact", ["contact"]],
    ["/host-an-event", ["host_event"]],
    ["/get-involved", ["volunteer", "partnership"]],
  ]) {
    const response = await fetchPath(path);
    assert.equal(response.status, 200, `${path} status`);
    const html = await response.text();
    if (!renderedCss) renderedCss = await readRenderedStyles(html);

    const formSections = [
      ...html.matchAll(
        /<section(?=[^>]*\bclass="public-submission")(?=[^>]*\bdata-form-key="[^"]+")[^>]*>[\s\S]*?<\/section>/giu,
      ),
    ].map((match) => match[0]);
    assert.equal(
      formSections.length,
      formKeys.length,
      `${path} pre-hydration form state count`,
    );

    for (const [index, formKey] of formKeys.entries()) {
      const formSection = formSections[index];
      assert.match(
        formSection,
        new RegExp(`\\bdata-form-key="${escapeRegex(formKey)}"`, "u"),
        `${path} form key`,
      );
      assert.match(
        formSection,
        /<noscript>[\s\S]*Your information has not been sent\.[\s\S]*Please enable[\s\S]*JavaScript and reload this page\.[\s\S]*<\/noscript>/u,
        `${path} no-script safety notice`,
      );
      assert.match(
        formSection,
        /<div(?=[^>]*\baria-busy="true")(?=[^>]*\bclass="public-submission__loading")[^>]*>/u,
        `${path} hydration loading state`,
      );
      assert.doesNotMatch(
        formSection,
        /<(?:form|input|select|textarea)\b/iu,
        `${path} must not expose PII controls before protection is ready`,
      );
      assert.doesNotMatch(
        formSection,
        /\bname="(?:name|replyEmail|message|howToHelp|eventIdea|organizationName)"/iu,
        `${path} must not serialize PII field names before protection is ready`,
      );
    }
    assertNoPrivateSentinels(html);
  }

  assert.match(
    renderedCss,
    /@media\s*\(scripting:none\)\{\.public-submission__loading\{[^}]*display:none/iu,
    "the rendered no-script view must hide the permanently busy hydration state",
  );
});

test("Feedback is consistent while contact and Host routes remain canonical", async () => {
  const feedbackResponse = await fetchPath("/contact");
  assert.equal(feedbackResponse.status, 200);
  const feedbackHtml = await feedbackResponse.text();
  assert.match(
    feedbackHtml,
    /rel="canonical" href="https:\/\/preview\.example\/contact"/u,
  );
  assert.match(
    feedbackHtml,
    /<title>Feedback[^<]*Vancouver Curiosity Club<\/title>/u,
  );
  assert.match(
    feedbackHtml,
    /<meta(?=[^>]*\bname="description")(?=[^>]*\bcontent="[^"]*[Ff]eedback[^"]*")[^>]*>/u,
  );
  assert.match(
    feedbackHtml,
    /<meta(?=[^>]*\bproperty="og:title")(?=[^>]*\bcontent="Feedback[^"]*")[^>]*>/u,
  );
  assert.match(
    feedbackHtml,
    /<meta(?=[^>]*\bproperty="og:description")(?=[^>]*\bcontent="[^"]*[Ff]eedback[^"]*")[^>]*>/u,
  );
  assert.match(
    feedbackHtml,
    /<meta(?=[^>]*\bname="twitter:title")(?=[^>]*\bcontent="Feedback[^"]*")[^>]*>/u,
  );
  assert.match(
    feedbackHtml,
    /<meta(?=[^>]*\bname="twitter:description")(?=[^>]*\bcontent="[^"]*[Ff]eedback[^"]*")[^>]*>/u,
  );
  assert.match(
    feedbackHtml,
    /aria-label="Breadcrumb"[\s\S]*?aria-current="page">Feedback<\/span>/u,
  );
  assert.match(feedbackHtml, /<h1[^>]*>[^<]*[Ff]eedback[^<]*<\/h1>/u);
  assert.match(
    feedbackHtml,
    /<section(?=[^>]*data-form-key="contact")[^>]*>[\s\S]*?<h2[^>]*>Feedback<\/h2>/u,
  );
  assert.doesNotMatch(feedbackHtml, /Send a private inquiry/u);
  assert.doesNotMatch(
    feedbackHtml,
    /<a[^>]*href="\/contact"[^>]*>Contact<\/a>/u,
  );
  assertNoPrivateSentinels(feedbackHtml);

  const homeResponse = await fetchPath("/");
  assert.equal(homeResponse.status, 200);
  const homeHtml = await homeResponse.text();
  assert.match(
    homeHtml,
    /class="home-invitation__actions"[\s\S]*?<a[^>]*href="\/get-involved"[^>]*>Get involved<\/a>/u,
  );

  const getInvolvedResponse = await fetchPath("/get-involved");
  assert.equal(getInvolvedResponse.status, 200);
  const getInvolvedHtml = await getInvolvedResponse.text();
  assert.match(
    getInvolvedHtml,
    /<a(?=[^>]*data-contribution-path="host")(?=[^>]*href="\/host-an-event")[^>]*>[\s\S]*?<strong>Host an event<\/strong>/u,
  );
});

test("the retired Community destination redirects to Contribute", async () => {
  const response = await fetchPath("/community");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /What would you like to make happen\?/u);
  assert.match(
    html,
    /rel="canonical" href="https:\/\/preview\.example\/get-involved"/u,
  );
  assertNoPrivateSentinels(html);
});

test("Events is the single calendar-only discovery destination", async () => {
  const response = await fetchPath("/events");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(
    html,
    /rel="canonical" href="https:\/\/preview\.example\/events"/iu,
  );
  assert.match(html, /<title>Events · Vancouver Curiosity Club<\/title>/iu);
  assert.match(html, /Vancouver gatherings/u);
  assert.match(html, /Month at a glance/u);
  assert.match(html, /public-calendar__grid/u);
  assert.equal((html.match(/<h1\b/gu) ?? []).length, 1);
  assert.match(
    html,
    /<h2(?=[^>]*class="public-calendar__title")(?=[^>]*id="public-calendar-title")[^>]*>/u,
  );
  assert.match(html, /href="\/events\?month=\d{4}-\d{2}">Today<\/a>/u);
  assert.match(html, /public-calendar__day-panel/u);
  assert.doesNotMatch(html, /aria-label="Event views"|aria-label="Event timeframe"/u);
  assert.doesNotMatch(html, /href="\/events\?state=(?:upcoming|past)"/u);
  assert.doesNotMatch(html, /href="\/calendar"/u);
  assert.doesNotMatch(html, /Find your next field note|Apply filters/u);
  assert.doesNotMatch(html, /public-export-actions|Download this public view/u);
  assert.doesNotMatch(html, /class="event-list"|events-page__list/u);
  assertSharedChrome(html);
  assertNoPrivateSentinels(html);

  const past = await fetchPath("/events?state=past");
  assert.equal(past.status, 200);
  assert.equal(
    past.headers.get("x-robots-tag"),
    "noindex, follow, noarchive",
  );
  const pastHtml = await past.text();
  assert.match(pastHtml, /public-calendar__grid/u);
  assert.doesNotMatch(pastHtml, /aria-label="Event timeframe"|>Past<\/a>/u);
});

test("Home and Events public-service failures return truthful noindex 503 responses", async () => {
  const unavailableRuntime = createBuiltRuntime();
  try {
    for (const path of ["/", "/events"]) {
      const response = await unavailableRuntime.dispatchFetch(
        new URL(path, "https://preview.example"),
      );
      assert.equal(response.status, 503, `${path} status`);
      assert.equal(
        response.headers.get("x-robots-tag"),
        "noindex, nofollow, noarchive",
        `${path} robots`,
      );
      assert.match(
        response.headers.get("content-type") ?? "",
        /^text\/html\b/iu,
        `${path} content type`,
      );
      assert.match(
        response.headers.get("cache-control") ?? "",
        /(?:^|,\s*)no-store(?:,|$)/u,
        `${path} cache control`,
      );

      const html = await response.text();
      assert.match(html, /The site is temporarily unavailable\./u);
      assert.match(
        html,
        /database safety checks could not be completed/u,
      );
      assert.match(
        html,
        /<meta(?=[^>]*\bname="robots")(?=[^>]*\bcontent="noindex, nofollow, noarchive")[^>]*>/iu,
      );
      const robots = robotsMetaContents(html);
      assert.ok(
        robots.some((content) => robotsTokens(content).includes("noindex")),
        `${path} must emit an HTML noindex directive`,
      );
      assert.ok(
        robots.every(
          (content) => !robotsTokens(content).includes("index"),
        ),
        `${path} must not emit a contradictory HTML index directive`,
      );
      assertNoPrivateSentinels(html);
      assert.doesNotMatch(
        html,
        /no such table|D1_ERROR|SQLITE|NEXT_HTTP_ERROR|digest|stack trace|trigger|migration|organization_mismatch/iu,
      );
      assert.doesNotMatch(html, /href="\/events\/[^"?]+"/iu);
    }
  } finally {
    await unavailableRuntime.dispose();
  }
});

test("a cancelled event detail renders only published facts and accurate structured data", async () => {
  const response = await fetchPath("/events/rendered-cancelled-reading");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-robots-tag"), null);
  const html = await response.text();

  assert.match(
    html,
    /<a(?=[^>]*href="\/events")(?=[^>]*aria-current="page")[^>]*>Events<\/a>/u,
  );

  assert.match(
    html,
    /<title>Rendered cancelled reading · Vancouver Curiosity Club<\/title>/iu,
  );
  assert.match(html, /This previously published event is no longer going ahead/u);
  assert.match(html, /\bclass="[^"]*\bcancellation-banner\b[^"]*"/u);
  assert.match(html, /Location details have not been published\./u);
  assert.doesNotMatch(html, /Online details are available/u);
  assert.doesNotMatch(html, /RSVP on Meetup/u);

  const documents = jsonLdDocuments(html);
  const eventDocument = documents.find((item) => item["@type"] === "Event");
  const breadcrumbs = documents.find(
    (item) => item["@type"] === "BreadcrumbList",
  );
  assert.ok(eventDocument);
  assert.ok(breadcrumbs);
  assert.equal(
    eventDocument.eventStatus,
    "https://schema.org/EventCancelled",
  );
  assert.deepEqual(eventDocument.organizer, [
    {
      "@type": "Organization",
      name: "Vancouver Curiosity Club",
      url: "https://preview.example/",
    },
  ]);
  assert.equal("location" in eventDocument, false);
  assert.equal(
    breadcrumbs.itemListElement.at(-1)?.item,
    "https://preview.example/events/rendered-cancelled-reading",
  );
  assertNoPrivateSentinels(html);
});

test("Calendar permanently redirects to Events and preserves the month and lane", async () => {
  for (const [sourcePath, destinationPath] of [
    ["/calendar", "/events"],
    ["/calendar?month=2026-07", "/events?month=2026-07"],
    [
      "/calendar?month=2026-07&lane=reset-and-make",
      "/events?month=2026-07&lane=reset-and-make",
    ],
    ["/calendar?lane=bogus", "/events"],
  ]) {
    const response = await fetchPath(sourcePath, { redirect: "manual" });
    assert.equal(response.status, 308, sourcePath);
    assert.equal(
      new URL(response.headers.get("location"), "https://preview.example")
        .href,
      new URL(destinationPath, "https://preview.example").href,
      sourcePath,
    );
  }
});

test("same-name same-slug compatibility Program routes redirect to their canonical Clubs", async () => {
  for (const slug of [
    "vancouver-curiosity-club",
    "vancouver-literature-and-film",
    "vancouver-fantasy-scifi-group",
  ]) {
    const programPath = `/clubs/${slug}/programs/${slug}`;
    const clubPath = `/clubs/${slug}`;
    const response = await fetchPath(programPath, { redirect: "manual" });
    assert.equal(response.status, 308, programPath);
    assert.equal(
      new URL(response.headers.get("location"), "https://preview.example")
        .href,
      new URL(clubPath, "https://preview.example").href,
      programPath,
    );

    const clubResponse = await fetchPath(clubPath);
    assert.equal(clubResponse.status, 200, clubPath);
    assert.doesNotMatch(
      await clubResponse.text(),
      new RegExp(`href="${escapeRegex(programPath)}"`, "u"),
      `${clubPath} must not link back to its collapsed compatibility Program`,
    );
  }

  const sitemapResponse = await fetchPath("/sitemap.xml");
  assert.equal(sitemapResponse.status, 200);
  assert.doesNotMatch(
    await sitemapResponse.text(),
    /<loc>[^<]*\/clubs\/[^<]+\/programs\/[^<]+<\/loc>/u,
    "collapsed compatibility Programs must not have canonical sitemap URLs",
  );
});

test("robots and sitemap contain only public canonical routes", async () => {
  const robotsResponse = await fetchPath("/robots.txt");
  assert.equal(robotsResponse.status, 200);
  assert.match(
    robotsResponse.headers.get("content-type") ?? "",
    /^text\/plain\b/iu,
  );
  const robots = await robotsResponse.text();
  for (const line of [
    "Allow: /",
    "Disallow: /*?*",
    "Disallow: /api/",
    "Disallow: /organizer",
    "Disallow: /preview",
    "Disallow: /signin-with-chatgpt",
    "Sitemap: https://preview.example/sitemap.xml",
  ]) {
    assert.match(robots, new RegExp(escapeRegex(line), "u"));
  }
  assert.doesNotMatch(robots, /Disallow: \/calendar(?:\r?\n|$)/u);
  assertNoPrivateSentinels(robots);

  const sitemapResponse = await fetchPath("/sitemap.xml");
  assert.equal(sitemapResponse.status, 200);
  assert.match(
    sitemapResponse.headers.get("content-type") ?? "",
    /application\/xml|text\/xml/iu,
  );
  const sitemap = await sitemapResponse.text();
  for (const path of [
    "/",
    "/events",
    "/clubs",
    "/about",
    "/get-involved",
    "/host-an-event",
    "/contact",
    "/conduct",
    "/accessibility",
    "/privacy",
    "/clubs/vancouver-curiosity-club",
    "/clubs/vancouver-literature-and-film",
    "/clubs/vancouver-fantasy-scifi-group",
  ]) {
    assert.match(
      sitemap,
      new RegExp(
        escapeRegex(
          new URL(path, "https://preview.example").toString(),
        ),
        "u",
      ),
      `sitemap missing ${path}`,
    );
  }
  assert.doesNotMatch(
    sitemap,
    /<loc>https:\/\/preview\.example\/calendar<\/loc>/u,
  );
  assert.doesNotMatch(
    sitemap,
    /<loc>[^<]*(?:\/organizer|\/api\/|\?|off-radar-eats|draft-private)[^<]*<\/loc>/u,
  );
  assertNoPrivateSentinels(sitemap);
});

test("Phase 7 private state never reaches rendered public surfaces or guessed routes", async () => {
  const database = await runtime.getD1Database("DB");
  const privateFacts = await database
    .prepare(
      `SELECT
         (SELECT count(*)
          FROM form_submissions AS submission
          JOIN form_submission_workflows AS workflow
            ON workflow.submission_id = submission.id
           AND workflow.organization_id = submission.organization_id
          JOIN form_submission_write_intents AS intent
            ON intent.id = workflow.write_intent_id
           AND intent.completed_at IS NOT NULL
           AND intent.completion_audit_log_id IS NOT NULL
          WHERE submission.id = ?
            AND submission.organization_id = ?) AS submission_count,
         (SELECT count(*)
          FROM form_submission_notes
          WHERE submission_id = ?
            AND organization_id = ?) AS note_count,
         (SELECT count(*)
          FROM public_form_rate_windows
          WHERE organization_id = ?) AS rate_window_count,
         (SELECT count(*)
          FROM import_batch_details AS detail
          JOIN import_rows AS row
            ON row.import_batch_id = detail.import_batch_id
           AND row.organization_id = detail.organization_id
          JOIN import_row_applications AS application
            ON application.import_row_id = row.id
           AND application.import_batch_id = row.import_batch_id
           AND application.organization_id = row.organization_id
          WHERE detail.import_batch_id = ?
            AND detail.phase = 'previewed') AS preview_row_count,
         (SELECT count(*)
          FROM ics_subscription_tokens
          WHERE organization_id = ?
            AND revoked_at IS NULL
            AND length(token_hash) = 64) AS calendar_token_count,
         (SELECT count(*)
          FROM organizer_conflict_overrides
          WHERE organization_id = ?
            AND reason = ?) AS conflict_reason_count,
         (SELECT count(*)
          FROM sync_sources
          WHERE id = 'phase7-private-meetup-source'
            AND organization_id = ?
            AND enabled = 0
            AND deleted_at IS NULL) AS meetup_source_count,
         (SELECT count(*)
          FROM media_assets AS asset
          JOIN media_asset_details AS detail
            ON detail.asset_id = asset.id
           AND detail.organization_id = asset.organization_id
           AND detail.upload_state = 'ready'
          JOIN media_asset_variants AS variant
            ON variant.asset_id = asset.id
           AND variant.organization_id = asset.organization_id
           AND variant.variant_kind = 'original'
           AND variant.state = 'ready'
          WHERE asset.id = ?
            AND asset.organization_id = ?
            AND asset.is_public = 0
            AND asset.deleted_at IS NULL) AS media_count`,
    )
    .bind(
      phase7PrivateIds.submissionId,
      ORGANIZATION_ID,
      phase7PrivateIds.submissionId,
      ORGANIZATION_ID,
      ORGANIZATION_ID,
      phase7PrivateIds.importBatchId,
      ORGANIZATION_ID,
      ORGANIZATION_ID,
      "PHASE7_PRIVATE_CONFLICT_REASON_SENTINEL",
      ORGANIZATION_ID,
      phase7PrivateIds.mediaAssetId,
      ORGANIZATION_ID,
    )
    .first();
  assert.deepEqual({ ...privateFacts }, {
    calendar_token_count: 1,
    conflict_reason_count: 1,
    media_count: 1,
    meetup_source_count: 1,
    note_count: 1,
    preview_row_count: 2,
    rate_window_count: 3,
    submission_count: 1,
  });

  for (const path of [
    ...PUBLIC_PATHS,
    "/robots.txt",
    "/sitemap.xml",
    "/events/calendar.ics",
    "/events/events.csv",
    "/events/private-phase3-idea-sentinel",
    "/events/private-phase3-idea-sentinel/calendar.ics",
    "/events/guessed-private-event",
    "/events/guessed-private-event/calendar.ics",
    "/events/events.csv?unknown=private-filter-sentinel",
    "/events/calendar.ics?from=not-a-date",
  ]) {
    const response = await fetchPath(path);
    assert.ok(
      [200, 404, 422].includes(response.status),
      `${path} returned ${response.status}`,
    );
    assertNoPrivateSentinels(await response.text());
  }

  const privatePairs = [
    [
      `/api/organizer/submissions/${encodeURIComponent(
        phase7PrivateIds.submissionId,
      )}`,
      "/api/organizer/submissions/guessed-submission",
    ],
    [
      `/api/organizer/imports/${encodeURIComponent(
        phase7PrivateIds.importBatchId,
      )}`,
      "/api/organizer/imports/guessed-import",
    ],
    [
      `/api/organizer/exports/media/${encodeURIComponent(
        phase7PrivateIds.mediaAssetId,
      )}/original`,
      "/api/organizer/exports/media/guessed-media/original",
    ],
    [
      "/api/organizer/events/phase3-private-idea",
      "/api/organizer/events/guessed-private-event",
    ],
  ];
  for (const [existingPath, guessedPath] of privatePairs) {
    const [existing, guessed] = await Promise.all([
      fetchPath(existingPath, { redirect: "manual" }),
      fetchPath(guessedPath, { redirect: "manual" }),
    ]);
    assert.equal(existing.status, guessed.status, existingPath);
    assertOrganizerPrivateResponse(existing);
    assertOrganizerPrivateResponse(guessed);
    assert.equal(
      existing.headers.get("referrer-policy"),
      "no-referrer",
      existingPath,
    );
    assert.equal(
      guessed.headers.get("referrer-policy"),
      "no-referrer",
      guessedPath,
    );
    assert.equal(
      existing.headers.get("cache-control"),
      guessed.headers.get("cache-control"),
      existingPath,
    );
    assert.equal(
      existing.headers.get("x-robots-tag"),
      guessed.headers.get("x-robots-tag"),
      existingPath,
    );
    const [existingBody, guessedBody] = await Promise.all([
      existing.text(),
      guessed.text(),
    ]);
    assert.equal(existingBody, guessedBody, existingPath);
    assertNoPrivateSentinels(existingBody);
  }

  const backup = await fetchPath(
    "/api/organizer/exports/backup.json",
    {
      body: JSON.stringify({ confirm: true }),
      headers: { "content-type": "application/json" },
      method: "POST",
      redirect: "manual",
    },
  );
  assert.ok([401, 403].includes(backup.status));
  assertOrganizerPrivateResponse(backup);
  assertNoPrivateSentinels(await backup.text());

  for (const file of clientAssetFiles) {
    assertNoPrivateValues(await readFile(file, "utf8"));
  }
  assertNoPrivateValues(runtimeLog.output());
});

test("unknown, guessed, and draft routes use the custom noindex 404", async () => {
  for (const path of [
    "/nothing-at-this-address",
    "/events/guessed-private-event",
    "/events/private-phase3-idea-sentinel",
    "/clubs/off-radar-eats",
    "/clubs/contemplative-meditation-journaling-circle",
    "/resources",
  ]) {
    const response = await fetchPath(path);
    assert.equal(response.status, 404, `${path} status`);
    assert.equal(
      response.headers.get("x-robots-tag"),
      "noindex, nofollow, noarchive",
      `${path} robots`,
    );
    const html = await response.text();
    assert.match(html, /This trail ends here\./u);
    if (path === "/nothing-at-this-address") {
      assert.match(
        html,
        /<title>Page not found · Vancouver Curiosity Club<\/title>/u,
      );
      assert.match(html, /name="robots" content="noindex, nofollow/u);
    }
    assert.match(html, /Explore events/u);
    assertSharedChrome(html);
    assertNoPrivateSentinels(html);
  }
});

test("missing event, missing club, and unpublished Resources never inherit Home discovery metadata", async () => {
  for (const path of [
    "/events/guessed-private-event",
    "/clubs/off-radar-eats",
    "/resources",
  ]) {
    const response = await fetchPath(path);
    assert.equal(response.status, 404, `${path} status`);
    assert.equal(
      response.headers.get("x-robots-tag"),
      "noindex, nofollow, noarchive",
      `${path} robots header`,
    );
    const html = await response.text();
    assert.match(
      html,
      /<meta(?=[^>]*\bname="robots")(?=[^>]*\bcontent="noindex(?:,[^"]*)?")[^>]*>/iu,
      `${path} HTML robots`,
    );
    assert.doesNotMatch(
      html,
      /rel="canonical"/iu,
      `${path} must not expose a canonical`,
    );
    assert.doesNotMatch(
      html,
      /\bproperty="og:/iu,
      `${path} must not inherit Home Open Graph metadata`,
    );
    assert.doesNotMatch(
      html,
      /\bname="twitter:/iu,
      `${path} must not inherit Home Twitter metadata`,
    );
    assert.doesNotMatch(
      html,
      /https:\/\/preview\.example\/og\.png/iu,
      `${path} must not inherit the shipped Home social image`,
    );
    assertNoPrivateSentinels(html);
  }
});

test("brand assets render and unoptimized source artwork stays out of the client", async () => {
  const iconResponse = await fetchPath("/icon.png");
  assert.equal(iconResponse.status, 200);
  assert.match(iconResponse.headers.get("content-type") ?? "", /image\/png/iu);
  const iconBytes = new Uint8Array(await iconResponse.arrayBuffer());
  assert.deepEqual(
    [...iconBytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  );

  const manifestResponse = await fetchPath("/manifest.webmanifest");
  assert.equal(manifestResponse.status, 200);
  assert.match(
    manifestResponse.headers.get("content-type") ?? "",
    /manifest\+json|application\/json/iu,
  );
  const manifest = await manifestResponse.json();
  assert.equal(manifest.name, "Vancouver Curiosity Club");
  assert.equal(manifest.icons.length, 3);

  await assert.rejects(
    stat(resolve("dist/client/brand-icon-master.png")),
    (error) => error?.code === "ENOENT",
  );
});

test("signed-out organizer traffic is redirected to Sites-owned SIWC and noindexed", async () => {
  const response = await fetchPath("/organizer", {
    redirect: "manual",
  });

  assert.ok(
    response.status === 302 ||
      response.status === 303 ||
      response.status === 307,
    `unexpected redirect status ${response.status}`,
  );
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin, "https://preview.example");
  assert.equal(location.pathname, "/signin-with-chatgpt");
  assert.equal(location.search, "?return_to=%2Forganizer");
  assert.equal(
    response.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
});

test("authenticated but uninvited organizer traffic receives a private rendered 403", async () => {
  const response = await fetchPath("/organizer", {
    headers: {
      "oai-authenticated-user-email": "uninvited-rendered@example.invalid",
      "oai-authenticated-user-full-name": "Uninvited%20Rendered",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    },
  });

  assert.equal(response.status, 403);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
  assert.equal(
    response.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
  const html = await response.text();
  assert.match(html, /Organizer access unavailable/u);
  assert.match(html, /no active organizer membership/u);
  for (const sentinel of PRIVATE_SENTINELS) {
    assert.doesNotMatch(html, new RegExp(sentinel, "iu"));
  }
});

test("the owner workspace renders private records without public chrome or caching", async () => {
  for (const [path, expected] of [
    ["/organizer", /Private organizer workspace/u],
    ["/organizer/events", /PRIVATE_PHASE3_TITLE_SENTINEL/u],
    ["/organizer/events/new", /Create private record/u],
    ["/organizer/calendar", /PRIVATE_PHASE3_TITLE_SENTINEL/u],
    [
      "/organizer/events/phase3-private-idea",
      /PRIVATE_PHASE3_NOTES_SENTINEL/u,
    ],
    ["/organizer/notifications", /PRIVATE_NOTIFICATION_SENTINEL/u],
  ]) {
    const response = await fetchPath(path, {
      headers: OWNER_AUTH_HEADERS,
    });
    assert.equal(response.status, 200, `${path} status`);
    assert.match(
      response.headers.get("cache-control") ?? "",
      /(?:^|,\s*)no-store(?:,|$)/u,
      `${path} cache control`,
    );
    assert.equal(
      response.headers.get("x-robots-tag"),
      "noindex, nofollow, noarchive",
      `${path} robots`,
    );
    const html = await response.text();
    assert.match(html, expected, `${path} private content`);
    assert.match(html, /aria-label="Organizer"/u);
    assert.match(html, /aria-label="Organizer shortcuts"/u);
    assert.doesNotMatch(html, /aria-label="Primary navigation"/u);
    assert.doesNotMatch(html, /aria-label="Footer navigation"/u);
    assert.doesNotMatch(html, /application\/ld\+json/iu);
    assert.doesNotMatch(html, /rel="canonical"/iu);
    assert.doesNotMatch(html, /_vinext\/image\?url=%2Ficon\.png/iu);
    assert.match(
      html,
      /Private scheduling and event publishing live alongside the structured[\s\S]*website editor\.[\s\S]*Approved media and published content remain separate[\s\S]*from drafts\./iu,
    );
    assert.doesNotMatch(
      html,
      /Website publishing remains unavailable in this phase/iu,
    );
    if (path === "/organizer/events") {
      assert.match(html, /Showing[\s\S]*of[\s\S]*private record/iu);
      assert.match(html, /method="get"/iu);
      assert.match(html, /name="search"/iu);
      assert.match(html, /name="status"/iu);
    }
    if (path === "/organizer/calendar") {
      assert.match(html, /matching record[\s\S]*from[\s\S]*total/iu);
    }
  }
});

test("rendered organizer event filters are server-validated and truthful", async () => {
  const filtered = await fetchPath(
    "/organizer/events?status=deleted&search=no-such-private-record",
    { headers: OWNER_AUTH_HEADERS },
  );
  assert.equal(filtered.status, 200);
  assert.match(filtered.headers.get("cache-control") ?? "", /no-store/u);
  assert.equal(
    filtered.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
  const filteredHtml = await filtered.text();
  assert.match(filteredHtml, /No private records match/u);
  assert.doesNotMatch(filteredHtml, /PRIVATE_PHASE3_TITLE_SENTINEL/u);

  for (const path of [
    "/organizer/events?page=not-a-page",
    `/organizer/events?search=${"x".repeat(121)}`,
    "/organizer/calendar?take=5001",
  ]) {
    const response = await fetchPath(path, {
      headers: OWNER_AUTH_HEADERS,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
    assert.equal(
      response.headers.get("x-robots-tag"),
      "noindex, nofollow, noarchive",
    );
    const html = await response.text();
    assert.match(html, /temporarily unavailable/u);
    assertNoPrivateSentinels(
      html,
      new Set(["PRIVATE_ORGANIZER_SENTINEL"]),
    );
  }
});

test("built organizer mutations enforce origin and bounded JSON before validation", async () => {
  const noOrigin = await fetchPath("/api/organizer/events", {
    body: "{}",
    headers: {
      ...OWNER_AUTH_HEADERS,
      "content-type": "application/json",
    },
    method: "POST",
  });
  assert.equal(noOrigin.status, 403);
  assertOrganizerPrivateResponse(noOrigin);
  assert.deepEqual(await noOrigin.json(), {
    error: {
      code: "authorization_denied",
      message: "This request is not permitted.",
    },
  });

  const malformed = await fetchPath("/api/organizer/events", {
    body: "{",
    headers: {
      ...OWNER_AUTH_HEADERS,
      "content-type": "application/json",
      origin: "https://preview.example",
    },
    method: "POST",
  });
  assert.equal(malformed.status, 422);
  assertOrganizerPrivateResponse(malformed);
  const malformedText = await malformed.text();
  assert.match(malformedText, /validation_failed/u);
  assertNoPrivateSentinels(malformedText);

  const oversized = await fetchPath("/api/organizer/events", {
    body: JSON.stringify({ title: "x".repeat(48_100) }),
    headers: {
      ...OWNER_AUTH_HEADERS,
      "content-type": "application/json",
      origin: "https://preview.example",
    },
    method: "POST",
  });
  assert.equal(oversized.status, 422);
  assertOrganizerPrivateResponse(oversized);
  const oversizedText = await oversized.text();
  assert.match(oversizedText, /validation_failed/u);
  assertNoPrivateSentinels(oversizedText);
});

test("the built Worker commits a private hold, refuses an unreviewed conflict, and records an intentional Warn overlap", async () => {
  const holdDraft = await createRenderedTimedDraft({
    endLocal: "2034-09-12T20:00",
    startLocal: "2034-09-12T18:00",
    title: "RENDERED_PHASE4_PRIVATE_HOLD",
    venueId: "venue-rendered-private",
  });
  const holdResponse = await organizerMutation(
    `/api/organizer/events/${encodeURIComponent(holdDraft.id)}/actions`,
    "POST",
    {
      action: "place_hold",
      expectedContentVersion: holdDraft.contentVersion,
      expectedScheduleVersion: holdDraft.scheduleVersion,
      holdDurationHours: 72,
    },
  );
  assert.equal(holdResponse.status, 200);
  assertOrganizerPrivateResponse(holdResponse);
  const holdResult = await holdResponse.json();
  assert.equal(holdResult.outcome, "applied");
  assert.equal(holdResult.reviewRequestId, null);
  assert.equal(holdResult.event.planningStatus, "tentative_hold");
  assert.equal(holdResult.event.publicationStatus, "private");
  assert.ok(
    Number.isSafeInteger(holdResult.event.holdExpiresAt) &&
      holdResult.event.holdExpiresAt > Date.now(),
  );

  const policyResponse = await fetchPath(
    "/api/organizer/settings/conflict-policy",
    { headers: OWNER_AUTH_HEADERS },
  );
  assert.equal(policyResponse.status, 200);
  assertOrganizerPrivateResponse(policyResponse);
  const initialPolicy = (await policyResponse.json()).policy;
  assert.equal(initialPolicy.mode, "warn_reason");

  const overlapDraft = await createRenderedTimedDraft({
    clubId: "club-literature",
    endLocal: "2034-09-12T21:00",
    startLocal: "2034-09-12T19:00",
    title: "RENDERED_PHASE4_PRIVATE_REVIEWED_OVERLAP",
    venueId: null,
  });
  const refusedResponse = await organizerMutation(
    `/api/organizer/events/${encodeURIComponent(overlapDraft.id)}/actions`,
    "POST",
    {
      action: "confirm",
      expectedContentVersion: overlapDraft.contentVersion,
      expectedScheduleVersion: overlapDraft.scheduleVersion,
    },
  );
  assert.equal(refusedResponse.status, 409);
  assertOrganizerPrivateResponse(refusedResponse);
  const refusalText = await refusedResponse.text();
  assert.match(refusalText, /"code":"conflict"/u);
  assert.match(refusalText, /written coordination reason is required/iu);
  assert.doesNotMatch(refusalText, /RENDERED_PHASE4_PRIVATE_HOLD/u);

  const reviewedResponse = await organizerMutation(
    `/api/organizer/events/${encodeURIComponent(overlapDraft.id)}/actions`,
    "POST",
    {
      action: "confirm",
      expectedContentVersion: overlapDraft.contentVersion,
      expectedScheduleVersion: overlapDraft.scheduleVersion,
      reason: "Owner reviewed the exact overlap for rendered-Worker proof.",
    },
  );
  assert.equal(reviewedResponse.status, 200);
  assertOrganizerPrivateResponse(reviewedResponse);
  const reviewedResult = await reviewedResponse.json();
  assert.equal(reviewedResult.outcome, "applied");
  assert.equal(reviewedResult.reviewRequestId, null);
  assert.equal(reviewedResult.event.planningStatus, "confirmed");
  assert.equal(reviewedResult.event.publicationStatus, "private");

  const database = await runtime.getD1Database("DB");
  const persistedReservation = await database
    .prepare(
      `SELECT planning_status, publication_status, schedule_version
       FROM organizer_events
       WHERE id = ?`,
    )
    .bind(overlapDraft.id)
    .first();
  assert.deepEqual({ ...persistedReservation }, {
    planning_status: "confirmed",
    publication_status: "private",
    schedule_version: overlapDraft.scheduleVersion + 1,
  });
  const activeOverride = await database
    .prepare(
      `SELECT override.reason, override.invalidated_at,
              incident.state AS incident_state,
              incident.proposed_schedule_version
       FROM organizer_conflict_overrides AS override
       JOIN organizer_conflict_incidents AS incident
         ON incident.id = override.incident_id
        AND incident.organization_id = override.organization_id
       WHERE override.organizer_event_id = ?
         AND override.invalidated_at IS NULL
       LIMIT 1`,
    )
    .bind(overlapDraft.id)
    .first();
  assert.deepEqual({ ...activeOverride }, {
    incident_state: "approved",
    invalidated_at: null,
    proposed_schedule_version: overlapDraft.scheduleVersion + 1,
    reason: "Owner reviewed the exact overlap for rendered-Worker proof.",
  });

  const privateDetail = await fetchPath(
    `/organizer/events/${encodeURIComponent(overlapDraft.id)}`,
    { headers: OWNER_AUTH_HEADERS },
  );
  assert.equal(privateDetail.status, 200);
  assertOrganizerPrivateResponse(privateDetail);
  const privateHtml = await privateDetail.text();
  assert.match(privateHtml, /RENDERED_PHASE4_PRIVATE_REVIEWED_OVERLAP/u);
  assert.match(privateHtml, /Current conflicts and reviews/u);
  assert.match(privateHtml, />Approved</u);

  for (const path of [
    "/",
    "/events",
    `/events/${encodeURIComponent(holdDraft.slug)}`,
    `/events/${encodeURIComponent(overlapDraft.slug)}`,
    "/sitemap.xml",
  ]) {
    const response = await fetchPath(path);
    if (path.includes(holdDraft.slug) || path.includes(overlapDraft.slug)) {
      assert.equal(response.status, 404, `${path} status`);
    } else {
      assert.equal(response.status, 200, `${path} status`);
    }
    const publicBody = await response.text();
    assert.doesNotMatch(publicBody, /RENDERED_PHASE4_PRIVATE_/u, path);
    assert.doesNotMatch(
      publicBody,
      /Owner reviewed the exact overlap/iu,
      path,
    );
  }
});

test("the built Worker keeps one Phase 5 event private until explicit publication and preserves truthful lifecycle boundaries", async () => {
  const publicTitle = "Rendered Phase 5 lifecycle";
  const publicSummary = "RENDERED_PHASE5_PUBLIC_SUMMARY";
  const publicDescription = "RENDERED_PHASE5_PUBLIC_DESCRIPTION";
  const privateValues = [
    "RENDERED_PHASE5_PRIVATE_NOTES_SENTINEL",
    "RENDERED_PHASE5_PRIVATE_MEETING_SENTINEL",
  ];
  const draft = await createRenderedTimedDraft({
    description: publicDescription,
    endLocal: "2026-10-08T20:00",
    privateMeetingDetails: privateValues[1],
    privateNotes: privateValues[0],
    startLocal: "2026-10-08T18:00",
    summary: publicSummary,
    title: publicTitle,
  });
  const confirmedResponse = await organizerMutation(
    `/api/organizer/events/${encodeURIComponent(draft.id)}/actions`,
    "POST",
    {
      action: "confirm",
      expectedContentVersion: draft.contentVersion,
      expectedScheduleVersion: draft.scheduleVersion,
    },
  );
  assert.equal(
    confirmedResponse.status,
    200,
    await confirmedResponse.clone().text(),
  );
  assertOrganizerPrivateResponse(confirmedResponse);
  const confirmed = (await confirmedResponse.json()).event;
  assert.equal(confirmed.planningStatus, "confirmed");
  assert.equal(confirmed.publicationStatus, "private");
  const detailPath = `/events/${encodeURIComponent(draft.slug)}`;
  const previewPath =
    `/organizer/events/${encodeURIComponent(draft.id)}/preview`;
  const publicationApiPath =
    `/api/organizer/events/${encodeURIComponent(draft.id)}/publication`;
  const publicationActionsPath = `${publicationApiPath}/actions`;
  const canonicalUrl = new URL(
    detailPath,
    "https://preview.example",
  ).toString();

  async function assertAbsentFromPublicSurfaces(label) {
    for (const [path, status] of [
      ["/", 200],
      ["/events?month=2026-10", 200],
      ["/clubs/vancouver-curiosity-club", 200],
      ["/sitemap.xml", 200],
      [detailPath, 404],
    ]) {
      const response = await fetchPath(path);
      assert.equal(response.status, status, `${label}: ${path} status`);
      const body = await response.text();
      assert.doesNotMatch(
        body,
        new RegExp(escapeRegex(publicTitle), "u"),
        `${label}: ${path} title`,
      );
      if (path !== detailPath) {
        assert.doesNotMatch(
          body,
          new RegExp(escapeRegex(draft.slug), "u"),
          `${label}: ${path} slug`,
        );
      }
      for (const value of privateValues) {
        assert.doesNotMatch(body, new RegExp(value, "u"), `${label}: ${path}`);
      }
      assertNoPrivateSentinels(body);
    }
  }

  await assertAbsentFromPublicSurfaces("private confirmed event");

  const workspaceResponse = await fetchPath(publicationApiPath, {
    headers: OWNER_AUTH_HEADERS,
  });
  assert.equal(workspaceResponse.status, 200);
  assertOrganizerPrivateResponse(workspaceResponse);
  let workspace = (await workspaceResponse.json()).workspace;
  assert.equal(workspace.event.publicationStatus, "private");
  assert.equal(workspace.permissions.canPreview, false);

  const savedResponse = await organizerMutation(
    publicationApiPath,
    "PATCH",
    {
      arrivalInstructions: "Use the published entrance.",
      attendanceMode: "in_person",
      availabilityState: "open",
      capacity: 24,
      confirmMeetupEventUrl: false,
      costText: "Free",
      expectedContentVersion: workspace.event.contentVersion,
      expectedScheduleVersion: workspace.event.scheduleVersion,
      externalMapUrl: null,
      meetupEventUrl: workspace.event.meetupEventUrl,
      preparationInformation: "Bring curiosity.",
      publicAccessNote: "The published room is step-free.",
      publicAddress: "123 Published Street, Vancouver",
      publicHostsEnabled: false,
      publicLocationName: "Rendered public room",
      publicOnlineUrl: null,
      rsvpMode: "coming_soon",
      selectedHostProfileIds: [],
      verifiedAccessibilityNotes: "Step-free published entrance.",
      weatherNote: null,
      whatToBring: "A question.",
    },
  );
  assert.equal(savedResponse.status, 200, await savedResponse.clone().text());
  assertOrganizerPrivateResponse(savedResponse);
  workspace = (await savedResponse.json()).workspace;
  assert.equal(workspace.event.publicationStatus, "private");
  assert.equal(workspace.readiness.ready, true);
  assert.equal(workspace.permissions.canPreview, true);
  assert.equal(workspace.permissions.canPublish, true);

  const previewResponse = await fetchPath(previewPath, {
    headers: OWNER_AUTH_HEADERS,
  });
  assert.equal(previewResponse.status, 200);
  assertOrganizerPrivateResponse(previewResponse);
  const previewHtml = await previewResponse.text();
  assert.match(previewHtml, /Protected preview/u);
  assert.match(previewHtml, /Not a public page/u);
  assert.match(previewHtml, new RegExp(escapeRegex(publicTitle), "u"));
  assert.match(previewHtml, new RegExp(publicSummary, "u"));
  assert.match(previewHtml, /Rendered public room/u);
  assert.doesNotMatch(previewHtml, /rel="canonical"/iu);
  assert.doesNotMatch(previewHtml, /application\/ld\+json/iu);
  for (const value of privateValues) {
    assert.doesNotMatch(previewHtml, new RegExp(value, "u"));
  }

  const deniedPreview = await fetchPath(previewPath, {
    headers: {
      "oai-authenticated-user-email": "phase5-uninvited@example.invalid",
      "oai-authenticated-user-full-name": "Phase%205%20Uninvited",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    },
  });
  assert.equal(deniedPreview.status, 403);
  assertOrganizerPrivateResponse(deniedPreview);
  const deniedHtml = await deniedPreview.text();
  assert.match(deniedHtml, /Organizer access unavailable/u);
  assert.doesNotMatch(deniedHtml, new RegExp(escapeRegex(publicTitle), "u"));
  for (const value of privateValues) {
    assert.doesNotMatch(deniedHtml, new RegExp(value, "u"));
  }

  const deniedPublish = await fetchPath(publicationActionsPath, {
    body: JSON.stringify({
      action: "publish",
      expectedContentVersion: workspace.event.contentVersion,
      expectedScheduleVersion: workspace.event.scheduleVersion,
    }),
    headers: {
      "content-type": "application/json",
      origin: "https://preview.example",
      "oai-authenticated-user-email": "phase5-uninvited@example.invalid",
      "oai-authenticated-user-full-name": "Phase%205%20Uninvited",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    },
    method: "POST",
  });
  assert.equal(deniedPublish.status, 403);
  assertOrganizerPrivateResponse(deniedPublish);
  const deniedPublishBody = await deniedPublish.text();
  assert.match(deniedPublishBody, /authorization_denied/u);
  assert.doesNotMatch(
    deniedPublishBody,
    new RegExp(escapeRegex(publicTitle), "u"),
  );
  const stillPrivateResponse = await fetchPath(publicationApiPath, {
    headers: OWNER_AUTH_HEADERS,
  });
  assert.equal(stillPrivateResponse.status, 200);
  assertOrganizerPrivateResponse(stillPrivateResponse);
  const stillPrivate = (await stillPrivateResponse.json()).workspace;
  assert.equal(stillPrivate.event.publicationStatus, "private");
  assert.equal(
    stillPrivate.event.contentVersion,
    workspace.event.contentVersion,
  );

  const publishedResponse = await organizerMutation(
    publicationActionsPath,
    "POST",
    {
      action: "publish",
      expectedContentVersion: workspace.event.contentVersion,
      expectedScheduleVersion: workspace.event.scheduleVersion,
    },
  );
  assert.equal(
    publishedResponse.status,
    200,
    await publishedResponse.clone().text(),
  );
  assertOrganizerPrivateResponse(publishedResponse);
  const published = await publishedResponse.json();
  assert.equal(published.outcome, "published");
  workspace = published.workspace;
  assert.equal(workspace.event.publicationStatus, "published");
  assert.equal(workspace.publicPath, detailPath);

  assert.ok(
    (await clearPublicEventsSnapshotCache()) > 0,
    "the lifecycle test must cross the bounded public Events snapshot boundary",
  );

  const homeResponse = await fetchPath("/");
  assert.equal(homeResponse.status, 200);
  const homeHtml = await homeResponse.text();
  assert.match(homeHtml, new RegExp(escapeRegex(publicTitle), "u"));
  assert.match(
    homeHtml,
    new RegExp(`href="${escapeRegex(detailPath)}"`, "u"),
  );

  const monthEventsResponse = await fetchPath("/events?month=2026-10");
  assert.equal(monthEventsResponse.status, 200);
  const monthEventsHtml = await monthEventsResponse.text();
  assert.match(monthEventsHtml, new RegExp(escapeRegex(publicTitle), "u"));
  assert.match(
    monthEventsHtml,
    new RegExp(`href="${escapeRegex(detailPath)}"`, "u"),
  );

  const detailResponse = await fetchPath(detailPath);
  assert.equal(detailResponse.status, 200);
  assert.equal(detailResponse.headers.get("x-robots-tag"), null);
  const detailHtml = await detailResponse.text();
  assert.match(detailHtml, new RegExp(escapeRegex(publicTitle), "u"));
  assert.match(detailHtml, new RegExp(publicSummary, "u"));
  assert.match(detailHtml, new RegExp(publicDescription, "u"));
  assert.match(
    detailHtml,
    new RegExp(
      `rel="canonical" href="${escapeRegex(canonicalUrl)}"`,
      "u",
    ),
  );
  assert.match(
    detailHtml,
    new RegExp(
      `name="description" content="${escapeRegex(publicSummary)}"`,
      "u",
    ),
  );
  assert.match(
    detailHtml,
    new RegExp(`property="og:title" content="${escapeRegex(publicTitle)}`, "u"),
  );
  const eventDocument = jsonLdDocuments(detailHtml).find(
    (document) => document["@type"] === "Event",
  );
  assert.ok(eventDocument);
  assert.equal(eventDocument.name, publicTitle);
  assert.equal(eventDocument.description, publicSummary);
  assert.equal(eventDocument.url, canonicalUrl);
  assert.equal(
    eventDocument.eventStatus,
    "https://schema.org/EventScheduled",
  );

  for (const downloadPath of [
    `${detailPath}/calendar.ics`,
    "/events/calendar.ics",
    "/events/calendar.ics?state=upcoming",
    "/events/events.csv",
    "/events/events.csv?state=upcoming",
  ]) {
    const downloadResponse = await fetchPath(downloadPath);
    assert.equal(downloadResponse.status, 200, downloadPath);
    assert.equal(
      downloadResponse.headers.get("x-robots-tag"),
      "noindex, nofollow, noarchive",
      downloadPath,
    );
    assert.equal(
      downloadResponse.headers.get("referrer-policy"),
      "strict-origin-when-cross-origin",
      downloadPath,
    );
    assert.match(
      downloadResponse.headers.get("cache-control") ?? "",
      /public,\s*max-age=0,\s*must-revalidate/iu,
      downloadPath,
    );
    await downloadResponse.arrayBuffer();
  }

  const clubResponse = await fetchPath(
    "/clubs/vancouver-curiosity-club",
  );
  assert.equal(clubResponse.status, 200);
  const clubHtml = await clubResponse.text();
  assert.match(clubHtml, new RegExp(escapeRegex(publicTitle), "u"));
  assert.match(
    clubHtml,
    new RegExp(`href="${escapeRegex(detailPath)}"`, "u"),
  );

  const publishedSitemapResponse = await fetchPath("/sitemap.xml");
  assert.equal(publishedSitemapResponse.status, 200);
  const publishedSitemap = await publishedSitemapResponse.text();
  assert.match(
    publishedSitemap,
    new RegExp(`<loc>${escapeRegex(canonicalUrl)}</loc>`, "u"),
  );
  for (const body of [
    homeHtml,
    monthEventsHtml,
    detailHtml,
    clubHtml,
    publishedSitemap,
  ]) {
    assertNoPrivateSentinels(body);
    for (const value of privateValues) {
      assert.doesNotMatch(body, new RegExp(value, "u"));
    }
  }

  const unpublishedResponse = await organizerMutation(
    publicationActionsPath,
    "POST",
    {
      action: "unpublish",
      expectedContentVersion: workspace.event.contentVersion,
      expectedScheduleVersion: workspace.event.scheduleVersion,
    },
  );
  assert.equal(unpublishedResponse.status, 200);
  assertOrganizerPrivateResponse(unpublishedResponse);
  const unpublished = await unpublishedResponse.json();
  assert.equal(unpublished.outcome, "unpublished");
  workspace = unpublished.workspace;
  assert.equal(workspace.event.publicationStatus, "unpublished");
  await clearPublicEventsSnapshotCache();
  await assertAbsentFromPublicSurfaces("explicitly unpublished event");

  const requestedPublicationAt = Date.now() + 4_000;
  const scheduledResponse = await organizerMutation(
    publicationActionsPath,
    "POST",
    {
      action: "schedule_publication",
      expectedContentVersion: workspace.event.contentVersion,
      expectedScheduleVersion: workspace.event.scheduleVersion,
      originalTimezone: "UTC",
      requestedPublicationLocal: new Date(requestedPublicationAt)
        .toISOString()
        .slice(0, 19),
    },
  );
  assert.equal(
    scheduledResponse.status,
    200,
    await scheduledResponse.clone().text(),
  );
  assertOrganizerPrivateResponse(scheduledResponse);
  const scheduled = await scheduledResponse.json();
  assert.equal(scheduled.outcome, "publication_scheduled");
  workspace = scheduled.workspace;
  assert.equal(workspace.event.publicationStatus, "scheduled");
  assert.ok(workspace.pendingJob);
  await assertAbsentFromPublicSurfaces("scheduled but not due event");

  let reconciledDetail = null;
  const reconciliationDeadline = Date.now() + 12_000;
  while (Date.now() < reconciliationDeadline) {
    const candidate = await fetchPath(detailPath);
    if (candidate.status === 200) {
      reconciledDetail = candidate;
      break;
    }
    assert.equal(candidate.status, 404);
    await candidate.arrayBuffer();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  assert.ok(reconciledDetail, "the due publication did not reconcile");
  const reconciledHtml = await reconciledDetail.text();
  assert.match(reconciledHtml, new RegExp(escapeRegex(publicTitle), "u"));
  await clearPublicEventsSnapshotCache();
  const postReconciliationEvents = await fetchPath("/events");
  assert.equal(postReconciliationEvents.status, 200);
  assert.match(
    await postReconciliationEvents.text(),
    new RegExp(escapeRegex(publicTitle), "u"),
  );

  const database = await runtime.getD1Database("DB");
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM organizer_event_publication_jobs
         WHERE organizer_event_id = ?
           AND state = 'executed'`,
      )
      .bind(draft.id)
      .first("count"),
    1,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM audit_logs
         WHERE entity_id = ?
           AND action = 'organizer_event.publication_executed'`,
      )
      .bind(draft.id)
      .first("count"),
    1,
  );

  const reconciledWorkspaceResponse = await fetchPath(publicationApiPath, {
    headers: OWNER_AUTH_HEADERS,
  });
  assert.equal(reconciledWorkspaceResponse.status, 200);
  assertOrganizerPrivateResponse(reconciledWorkspaceResponse);
  workspace = (await reconciledWorkspaceResponse.json()).workspace;
  assert.equal(workspace.event.publicationStatus, "published");

  const cancelledResponse = await organizerMutation(
    `/api/organizer/events/${encodeURIComponent(draft.id)}/actions`,
    "POST",
    {
      action: "cancel",
      expectedContentVersion: workspace.event.contentVersion,
      expectedScheduleVersion: workspace.event.scheduleVersion,
    },
  );
  assert.equal(
    cancelledResponse.status,
    200,
    await cancelledResponse.clone().text(),
  );
  assertOrganizerPrivateResponse(cancelledResponse);
  const cancelled = (await cancelledResponse.json()).event;
  assert.equal(cancelled.planningStatus, "cancelled");
  assert.equal(cancelled.publicationStatus, "published");

  await clearPublicEventsSnapshotCache();
  const cancelledEventsResponse = await fetchPath("/events");
  assert.equal(cancelledEventsResponse.status, 200);
  const cancelledEventsHtml = await cancelledEventsResponse.text();
  assert.doesNotMatch(
    cancelledEventsHtml,
    new RegExp(escapeRegex(publicTitle), "u"),
  );
  const cancelledHomeResponse = await fetchPath("/");
  assert.equal(cancelledHomeResponse.status, 200);
  assert.doesNotMatch(
    await cancelledHomeResponse.text(),
    new RegExp(escapeRegex(publicTitle), "u"),
  );
  const cancelledClubResponse = await fetchPath(
    "/clubs/vancouver-curiosity-club",
  );
  assert.equal(cancelledClubResponse.status, 200);
  assert.doesNotMatch(
    await cancelledClubResponse.text(),
    new RegExp(escapeRegex(publicTitle), "u"),
  );
  const cancelledDetailResponse = await fetchPath(detailPath);
  assert.equal(cancelledDetailResponse.status, 200);
  const cancelledDetailHtml = await cancelledDetailResponse.text();
  assert.match(cancelledDetailHtml, /<strong>Cancelled<\/strong>/u);
  assert.match(
    cancelledDetailHtml,
    /This previously published event is no longer going ahead/u,
  );
  const cancelledEventDocument = jsonLdDocuments(cancelledDetailHtml).find(
    (document) => document["@type"] === "Event",
  );
  assert.equal(
    cancelledEventDocument?.eventStatus,
    "https://schema.org/EventCancelled",
  );
  assertNoPrivateSentinels(cancelledDetailHtml);

  const finalUnpublishResponse = await organizerMutation(
    publicationActionsPath,
    "POST",
    {
      action: "unpublish",
      expectedContentVersion: cancelled.contentVersion,
      expectedScheduleVersion: cancelled.scheduleVersion,
    },
  );
  assert.equal(
    finalUnpublishResponse.status,
    200,
    await finalUnpublishResponse.clone().text(),
  );
  assertOrganizerPrivateResponse(finalUnpublishResponse);
  const finalUnpublish = await finalUnpublishResponse.json();
  assert.equal(finalUnpublish.outcome, "unpublished");
  assert.equal(
    finalUnpublish.workspace.event.publicationStatus,
    "unpublished",
  );
  await assertAbsentFromPublicSurfaces("cancelled event after unpublish");
});

test("policy changes keep active historical reservation versions invariant-ready", async () => {
  const beforeResponse = await fetchPath(
    "/api/organizer/settings/conflict-policy",
    { headers: OWNER_AUTH_HEADERS },
  );
  assert.equal(beforeResponse.status, 200);
  assertOrganizerPrivateResponse(beforeResponse);
  const before = (await beforeResponse.json()).policy;
  assert.equal(before.mode, "warn_reason");

  const blockedResponse = await organizerMutation(
    "/api/organizer/settings/conflict-policy",
    "PATCH",
    {
      defaultHoldHours: before.defaultHoldHours,
      expectedPolicyVersion: before.version,
      mode: "block",
      nearingExpiryHours: before.nearingExpiryHours,
    },
  );
  assert.equal(blockedResponse.status, 200);
  assertOrganizerPrivateResponse(blockedResponse);
  const blocked = (await blockedResponse.json()).policy;
  assert.equal(blocked.mode, "block");
  assert.equal(blocked.version, before.version + 1);

  const readyAfterBlock = await fetchPath("/robots.txt");
  assert.equal(readyAfterBlock.status, 200);
  await readyAfterBlock.arrayBuffer();

  const database = await runtime.getD1Database("DB");
  const historicalVersions = await database
    .prepare(
      `SELECT DISTINCT policy_version
       FROM organizer_reservation_states
       ORDER BY policy_version`,
    )
    .all();
  assert.deepEqual(
    historicalVersions.results.map((row) => row.policy_version),
    [before.version],
    "existing reservations retain the policy version of their guarded write",
  );

  const restoredResponse = await organizerMutation(
    "/api/organizer/settings/conflict-policy",
    "PATCH",
    {
      defaultHoldHours: blocked.defaultHoldHours,
      expectedPolicyVersion: blocked.version,
      mode: "warn_reason",
      nearingExpiryHours: blocked.nearingExpiryHours,
    },
  );
  assert.equal(restoredResponse.status, 200);
  assertOrganizerPrivateResponse(restoredResponse);
  const restored = (await restoredResponse.json()).policy;
  assert.equal(restored.mode, "warn_reason");
  assert.equal(restored.version, blocked.version + 1);

  const readyAfterRestore = await fetchPath("/robots.txt");
  assert.equal(readyAfterRestore.status, 200);
  await readyAfterRestore.arrayBuffer();
});

test("the built invitation flow strips the token and clears it on success and reuse", async () => {
  const capture = await fetchPath(
    `/accept-invitation?token=${INVITATION_TOKEN}`,
    { redirect: "manual" },
  );
  assert.equal(capture.status, 303);
  assert.equal(
    capture.headers.get("location"),
    "https://preview.example/accept-invitation",
  );
  assert.equal(capture.headers.get("referrer-policy"), "no-referrer");
  assertOrganizerPrivateResponse(capture);
  const invitationCookie = capture.headers.get("set-cookie") ?? "";
  assert.match(
    invitationCookie,
    new RegExp(
      `^__Secure-vcc_invitation=${INVITATION_TOKEN}; HttpOnly; SameSite=Lax; Path=/accept-invitation; Max-Age=600; Secure$`,
      "u",
    ),
  );
  assert.equal(await capture.text(), "");

  const cookiePair = invitationCookie.split(";", 1)[0];
  const acceptanceHeaders = {
    "content-type": "application/json",
    cookie: cookiePair,
    origin: "https://preview.example",
    "oai-authenticated-user-email":
      "private_invitation_email_sentinel@example.invalid",
    "oai-authenticated-user-full-name": "Rendered%20Invitee",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  const accepted = await fetchPath("/accept-invitation/consume", {
    body: "{}",
    headers: acceptanceHeaders,
    method: "POST",
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get("referrer-policy"), "no-referrer");
  assertOrganizerPrivateResponse(accepted);
  assert.match(
    accepted.headers.get("set-cookie") ?? "",
    /^__Secure-vcc_invitation=; HttpOnly; SameSite=Lax; Path=\/accept-invitation; Max-Age=0; Secure$/u,
  );
  const acceptedText = await accepted.text();
  assert.deepEqual(JSON.parse(acceptedText), {
    accepted: true,
    role: "organizer",
  });
  assert.doesNotMatch(acceptedText, new RegExp(INVITATION_TOKEN, "u"));
  assertNoPrivateSentinels(acceptedText);

  const reused = await fetchPath("/accept-invitation/consume", {
    body: "{}",
    headers: acceptanceHeaders,
    method: "POST",
  });
  assert.equal(reused.status, 403);
  assert.equal(reused.headers.get("referrer-policy"), "no-referrer");
  assertOrganizerPrivateResponse(reused);
  const reusedText = await reused.text();
  assert.match(reusedText, /authorization_denied/u);
  assert.doesNotMatch(reusedText, new RegExp(INVITATION_TOKEN, "u"));
  assertNoPrivateSentinels(reusedText);
});

test("the clean invitation page and failed consume remain no-referrer and token-free", async () => {
  const cleanPage = await fetchPath("/accept-invitation", {
    redirect: "manual",
  });
  assert.ok([302, 303, 307].includes(cleanPage.status));
  assert.equal(cleanPage.headers.get("referrer-policy"), "no-referrer");
  assertOrganizerPrivateResponse(cleanPage);
  assert.doesNotMatch(
    cleanPage.headers.get("location") ?? "",
    /token|PRIVATE_/iu,
  );

  const failed = await fetchPath("/accept-invitation/consume", {
    body: "{}",
    headers: {
      "content-type": "application/json",
      origin: "https://preview.example",
    },
    method: "POST",
  });
  assert.equal(failed.status, 401);
  assert.equal(failed.headers.get("referrer-policy"), "no-referrer");
  assertOrganizerPrivateResponse(failed);
  const failedText = await failed.text();
  assert.match(failedText, /authentication_required/u);
  assertNoPrivateSentinels(failedText);
});

test("signed-out private API responses are safe, private, and noindexed", async () => {
  const response = await fetchPath("/api/organizer/session", {
    headers: { accept: "application/json" },
  });

  assert.equal(response.status, 401);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
  assert.equal(
    response.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(
    response.headers.get("cross-origin-opener-policy"),
    "same-origin-allow-popups",
  );
  assert.equal(
    response.headers.get("cross-origin-resource-policy"),
    "same-origin",
  );
  assert.equal(
    response.headers.get("permissions-policy"),
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  assert.deepEqual(await response.json(), {
    error: {
      code: "authentication_required",
      message: "Sign in with ChatGPT to continue.",
    },
  });
});

test("percent-encoded private paths use one canonical security classification", async () => {
  for (const path of [
    "/org%61nizer",
    "/organ%69zer/events",
    "/%61pi/organizer/session",
  ]) {
    const response = await fetchPath(path, { redirect: "manual" });
    assert.ok(
      [200, 302, 303, 307, 401, 403, 404].includes(response.status),
      `${path} returned ${response.status}`,
    );
    assertOrganizerPrivateResponse(response);
    const body = await response.text();
    assert.doesNotMatch(body, /aria-label="Primary navigation"/u, path);
    assert.doesNotMatch(body, /aria-label="Footer navigation"/u, path);
  }

  const privateCalendarToken = "Z".repeat(43);
  const privateCalendar = await fetchPath(
    `/api/calendar/pr%69vate/${privateCalendarToken}`,
    { redirect: "manual" },
  );
  assert.ok([400, 404].includes(privateCalendar.status));
  assertOrganizerPrivateResponse(privateCalendar);
  assert.equal(
    privateCalendar.headers.get("referrer-policy"),
    "no-referrer",
  );
  assert.doesNotMatch(
    await privateCalendar.text(),
    new RegExp(privateCalendarToken, "u"),
  );

  const invitation = await fetchPath(
    `/accept-invit%61tion?token=${INVITATION_TOKEN}`,
    { redirect: "manual" },
  );
  assert.equal(invitation.status, 303);
  assert.equal(
    invitation.headers.get("location"),
    "https://preview.example/accept-invitation",
  );
  assert.equal(invitation.headers.get("referrer-policy"), "no-referrer");
  assertOrganizerPrivateResponse(invitation);
  assert.doesNotMatch(
    invitation.headers.get("location") ?? "",
    new RegExp(INVITATION_TOKEN, "u"),
  );

  for (const path of [
    "/_sites-preview",
    "/auth/unknown",
    "/callback",
    "/drafts/unknown",
    "/invitations/unknown",
    "/preview/unknown",
    "/signin-with-chatgpt/unknown",
    "/signout-with-chatgpt/unknown",
  ]) {
    const response = await fetchPath(path, { redirect: "manual" });
    assert.ok(
      [200, 302, 303, 307, 400, 401, 403, 404].includes(response.status),
      `${path} returned ${response.status}`,
    );
    assertOrganizerPrivateResponse(response);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    const body = await response.text();
    assert.doesNotMatch(body, /aria-label="Primary navigation"/u, path);
    assert.doesNotMatch(body, /aria-label="Footer navigation"/u, path);
  }

  for (const path of [
    "/organizer%2fevents",
    "/organizer%5cevents",
    "/organizer%3fevents",
    "/organizer%23events",
    "/org%2561nizer",
    "/%252e%252e/organizer",
    "/organizer//events",
    "/organizer%",
    `/organizer/events/${"x".repeat(2_100)}`,
  ]) {
    const response = await fetchPath(path, { redirect: "manual" });
    assert.equal(response.status, 400, `${path.slice(0, 80)} status`);
    assertOrganizerPrivateResponse(response);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    const body = await response.text();
    assert.doesNotMatch(body, /aria-label="Primary navigation"/u, path);
    assert.doesNotMatch(body, /aria-label="Footer navigation"/u, path);
    assert.doesNotMatch(body, /x-vcc-request-pathname/iu, path);
  }

  const dotSegment = await fetchPath(
    "/public/%2e%2e/organizer",
    { redirect: "manual" },
  );
  assertOrganizerPrivateResponse(dotSegment);
  assert.doesNotMatch(
    await dotSegment.text(),
    /aria-label="Primary navigation"/u,
  );

  const decomposedNfc = await fetchPath("/cafe%CC%81", {
    redirect: "manual",
  });
  assert.equal(decomposedNfc.status, 404);
  assert.equal(
    decomposedNfc.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );

  assert.doesNotMatch(runtimeLog.output(), new RegExp(privateCalendarToken, "u"));
});

test("local development keeps only the HMR-required relaxed script policy", async () => {
  const response = await runtime.dispatchFetch("http://localhost/");
  const policy = response.headers.get("content-security-policy") ?? "";

  assert.match(policy, /script-src [^;]*'unsafe-inline'/u);
  assert.match(policy, /script-src [^;]*'unsafe-eval'/u);
  assert.doesNotMatch(policy, /'nonce-/u);
});

function assertSharedChrome(html) {
  assert.match(html, /Vancouver Curiosity Club/u);
  assert.match(html, /aria-label="Primary navigation"/u);
  assert.match(html, /href="\/events"/u);
  assert.match(html, /href="\/clubs"/u);
  assert.doesNotMatch(html, /href="\/community"/u);
  assert.match(html, /href="\/about"/u);
  assert.match(
    html,
    /<a(?=[^>]*href="\/contact")(?=[^>]*data-primary-destination="feedback")[^>]*>Feedback<\/a>/u,
  );
  assert.match(html, /href="\/get-involved"/u);
  assert.match(html, />Get Involved<\/a>/u);
  assert.match(html, /Organizer Login/u);
  assert.match(html, /aria-label="Footer navigation"/u);
  assert.match(html, /Code of Conduct/u);
  assert.match(html, /Accessibility/u);
  assert.match(html, /Privacy/u);
}

function assertNoPrivateSentinels(value, allowed = new Set()) {
  assertNoPrivateValues(value, allowed);
  assert.doesNotMatch(value, /events\/ical|source_url|sourceUrl/iu);
}

function assertNoPrivateValues(value, allowed = new Set()) {
  for (const sentinel of [
    ...PRIVATE_SENTINELS,
    ...phase7DynamicPrivateSentinels,
  ]) {
    if (allowed.has(sentinel)) continue;
    assert.doesNotMatch(
      value,
      new RegExp(escapeRegex(sentinel), "iu"),
      sentinel,
    );
  }
}

function assertOrganizerPrivateResponse(response) {
  assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
  assert.equal(
    response.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
}

function jsonLdDocuments(html) {
  return [
    ...html.matchAll(
      /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/giu,
    ),
  ].map((match) => JSON.parse(match[1]));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function collectJavaScriptModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJavaScriptModules(path)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(path);
    }
  }
  return files.sort();
}

async function collectTextAssetFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTextAssetFiles(path)));
    } else if (
      entry.isFile() &&
      /\.(?:css|html|js|json|map|txt)$/iu.test(entry.name)
    ) {
      files.push(path);
    }
  }
  return files.sort();
}

function robotsMetaContents(html) {
  return [...html.matchAll(/<meta\b[^>]*>/giu)].flatMap(([tag]) => {
    if (!/\bname=(["'])robots\1/iu.test(tag)) return [];
    const content = /\bcontent=(["'])(.*?)\1/iu.exec(tag);
    return content ? [content[2]] : [];
  });
}

function robotsTokens(content) {
  return content
    .toLowerCase()
    .split(",")
    .map((token) => token.trim());
}

function createBuiltRuntime(log = new Log(LogLevel.WARN)) {
  return new Miniflare({
    modules: [
      { path: entrypoint, type: "ESModule" },
      ...moduleFiles
        .filter((path) => path !== entrypoint)
        .map((path) => ({ path, type: "ESModule" })),
    ],
    modulesRoot: serverRoot,
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    r2Buckets: ["MEDIA"],
    assets: {
      binding: "ASSETS",
      directory: resolve("dist/client"),
      routerConfig: {
        has_user_worker: true,
      },
    },
    log,
  });
}

async function applyPackagedProductionMigrations(targetRuntime) {
  const database = await targetRuntime.getD1Database("DB");
  const migrationDirectory = resolve("dist/.openai/drizzle");
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort();
  for (const file of migrationFiles) {
    const sql = await readFile(join(migrationDirectory, file), "utf8");
    const statements = productionMigrationFragments(sql);
    await applyD1MigrationBatches({
      database,
      statements,
      failureMessage: `Packaged migration failed: ${file}`,
    });
  }
}

async function initializePackagedDatabaseInvariants(
  targetRuntime,
  requireRepair = true,
) {
  let repairResponses = 0;
  // The packaged upgrade adopts one legacy public-attribution record per
  // fail-closed request. Keep this test setup bounded for the planned
  // organizer count and return only after a real ready response dispatches.
  for (
    let attempt = 0;
    attempt < MAX_DATABASE_INVARIANT_READY_ATTEMPTS;
    attempt += 1
  ) {
    const response = await targetRuntime.dispatchFetch(
      new URL("/robots.txt", "https://preview.example"),
    );
    if (response.status === 200) {
      if (requireRepair) {
        assert.equal(
          repairResponses,
          10,
          "the bounded populated v7 path must fail closed for ten setup " +
            "requests and dispatch only after the eleventh observes ready",
        );
      }
      await response.arrayBuffer();
      return;
    }
    repairResponses += 1;
    assert.equal(response.status, 503);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
    assert.equal(response.headers.get("retry-after"), "30");
    assert.equal(
      response.headers.get("x-robots-tag"),
      "noindex, nofollow, noarchive",
    );
    assert.match(
      await response.text(),
      /database safety checks were updated/u,
    );
  }
  assert.fail("packaged database invariants did not converge");
}

async function initializePackagedCmsAdoption(targetRuntime) {
  const response = await targetRuntime.dispatchFetch(
    new URL("/api/organizer/content", "https://preview.example"),
    { headers: OWNER_AUTH_HEADERS },
  );
  const body = await response.text();
  assert.equal(
    response.status,
    200,
    `the authenticated CMS API must adopt the populated public baseline: ${body}`,
  );
  assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
}

async function seedPublicCatalog(targetRuntime) {
  const database = await targetRuntime.getD1Database("DB");
  await run(
    database,
    `INSERT INTO profiles (
       id, siwc_subject, normalized_email, display_name,
       public_attribution_consent, status, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, 0, 'active', ?, ?, NULL)`,
    PROFILE_ID,
    "phase2-owner-subject",
    "private_owner_email_sentinel@example.invalid",
    "PRIVATE_ORGANIZER_SENTINEL",
    FIXTURE_NOW,
    FIXTURE_NOW,
  );
  await run(
    database,
    `INSERT INTO organizations (
       id, name, slug, timezone, owner_bootstrap_closed_at,
       owner_bootstrap_claimed_by_profile_id, created_by_profile_id,
       created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, 'America/Vancouver', ?, ?, ?, ?, ?, NULL)`,
    ORGANIZATION_ID,
    "PRIVATE_LEGAL_SENTINEL",
    "vancouver-curiosity-and-education-society",
    FIXTURE_NOW,
    PROFILE_ID,
    PROFILE_ID,
    FIXTURE_NOW,
    FIXTURE_NOW,
  );
  await run(
    database,
    `INSERT INTO organization_memberships (
       id, organization_id, profile_id, normalized_email,
       role, status, created_by_profile_id,
       created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?, ?, NULL)`,
    "phase2-owner-membership",
    ORGANIZATION_ID,
    PROFILE_ID,
    "private_owner_email_sentinel@example.invalid",
    PROFILE_ID,
    FIXTURE_NOW,
    FIXTURE_NOW,
  );

  const lanes = [
    [
      "lane-think",
      "Think",
      "think",
      "Talks, reading, film, ideas, and conversations worth continuing.",
      10,
    ],
    [
      "lane-reset",
      "Reset & Make",
      "reset-and-make",
      "Reflective and creative gatherings that make room to pause or make something.",
      20,
    ],
    [
      "lane-explore",
      "Explore",
      "explore",
      "Curiosity taken into the city through walks, visits, and shared discovery.",
      30,
    ],
    [
      "lane-eat",
      "Eat & Play",
      "eat-and-play",
      "Food, games, and playful reasons to spend time together.",
      40,
    ],
  ];
  for (const [id, name, slug, description, sortOrder] of lanes) {
    await run(
      database,
      `INSERT INTO event_lanes (
         id, organization_id, name, slug, description, sort_order,
         created_by_profile_id, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      id,
      ORGANIZATION_ID,
      name,
      slug,
      description,
      sortOrder,
      PROFILE_ID,
      FIXTURE_NOW,
      FIXTURE_NOW,
    );
  }

  const clubs = [
    {
      id: "club-curiosity",
      laneId: "lane-think",
      name: "Vancouver Curiosity Club",
      slug: "vancouver-curiosity-club",
      description:
        "A Vancouver gathering place for talks, discussions, and shared learning across subjects.",
      featured: 1,
      status: "published",
      url: "https://www.meetup.com/vancouver-meetup-group/",
    },
    {
      id: "club-literature",
      laneId: "lane-think",
      name: "Vancouver Literature and Film",
      slug: "vancouver-literature-and-film",
      description:
        "A program for reading, watching, and discussing literature and film together.",
      featured: 1,
      status: "published",
      url: "https://www.meetup.com/vancouver-literature-and-film/",
    },
    {
      id: "club-scifi",
      laneId: "lane-think",
      name: "Vancouver Fantasy & Sci-Fi Group",
      slug: "vancouver-fantasy-scifi-group",
      description:
        "A program for conversations and events around fantasy and science fiction.",
      featured: 1,
      status: "published",
      url: "https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/",
    },
    {
      id: "club-eats-draft",
      laneId: "lane-eat",
      name: "Off-Radar Eats",
      slug: "off-radar-eats",
      description: "PRIVATE_DRAFT_CLUB_SENTINEL",
      featured: 0,
      status: "draft",
      url: null,
    },
    {
      id: "club-reset-draft",
      laneId: "lane-reset",
      name: "Contemplative Meditation + Journaling Circle",
      slug: "contemplative-meditation-journaling-circle",
      description: "PRIVATE_DRAFT_CLUB_SENTINEL",
      featured: 0,
      status: "draft",
      url: null,
    },
  ];
  for (const club of clubs) {
    await run(
      database,
      `INSERT INTO clubs (
         id, organization_id, name, slug, description, created_by_profile_id,
         created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      club.id,
      ORGANIZATION_ID,
      club.name,
      club.slug,
      club.description,
      PROFILE_ID,
      FIXTURE_NOW,
      FIXTURE_NOW,
    );
    await run(
      database,
      `INSERT INTO club_public_profiles (
         club_id, organization_id, primary_event_lane_id, publication_status,
         is_featured, description, public_group_url, published_at, created_at,
         updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      club.id,
      ORGANIZATION_ID,
      club.laneId,
      club.status,
      club.featured,
      club.description,
      club.url,
      club.status === "published" ? FIXTURE_NOW : null,
      FIXTURE_NOW,
      FIXTURE_NOW,
    );
  }

  await ensurePublicCatalog(database, OWNER_IDENTITY, FIXTURE_NOW);

  await run(
    database,
    `INSERT INTO site_settings (
       id, organization_id, key, value_json, is_public, updated_by_profile_id,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
    "setting-private-sentinel",
    ORGANIZATION_ID,
    "private_test_value",
    JSON.stringify({ value: "PRIVATE_SETTING_SENTINEL" }),
    PROFILE_ID,
    FIXTURE_NOW,
    FIXTURE_NOW,
  );

  await run(
    database,
    `INSERT INTO venues (
       id, organization_id, name, slug, timezone, public_location_name,
       public_address, private_address, private_directions, is_public,
       created_by_profile_id, updated_by_profile_id, created_at, updated_at,
       deleted_at
     ) VALUES (?, ?, ?, ?, 'America/Vancouver', ?, ?, ?, ?, 0, ?, ?, ?, ?,
       NULL)`,
    "venue-rendered-private",
    ORGANIZATION_ID,
    "PRIVATE_VENUE_DETAIL_SENTINEL",
    "rendered-private-venue",
    "PRIVATE_VENUE_DETAIL_SENTINEL",
    "PRIVATE_VENUE_DETAIL_SENTINEL",
    "PRIVATE_VENUE_DETAIL_SENTINEL",
    "PRIVATE_VENUE_DETAIL_SENTINEL",
    PROFILE_ID,
    PROFILE_ID,
    FIXTURE_NOW,
    FIXTURE_NOW,
  );
  await run(
    database,
    `INSERT INTO events (
       id, organization_id, club_id, event_lane_id, category_id, venue_id,
       primary_organizer_profile_id, title, slug, summary, description,
       status, visibility, time_kind, starts_at_utc, ends_at_utc, timezone,
       all_day_start_date, all_day_end_date_exclusive,
       buffer_before_minutes, buffer_after_minutes, organizer_scope_json,
       schedule_version, schedule_review_state, hold_expires_at, private_notes,
       private_meeting_details, published_at, created_by_profile_id,
       updated_by_profile_id, created_at, updated_at, deleted_at
     ) VALUES (
       ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, NULL, 'cancelled', 'public',
       'timed', ?, ?, 'America/Vancouver', NULL, NULL, 0, 0, '[]', 1,
       'unreviewed', NULL, ?, ?, ?, ?, ?, ?, ?, NULL
     )`,
    "event-rendered-cancelled",
    ORGANIZATION_ID,
    "club-literature",
    "lane-think",
    "venue-rendered-private",
    "Rendered cancelled reading",
    "rendered-cancelled-reading",
    "A previously published synthetic event used only for rendered tests.",
    Date.UTC(2026, 7, 4, 2, 0, 0),
    Date.UTC(2026, 7, 4, 4, 0, 0),
    "PRIVATE_EVENT_DETAIL_SENTINEL",
    "PRIVATE_EVENT_DETAIL_SENTINEL",
    FIXTURE_NOW,
    PROFILE_ID,
    PROFILE_ID,
    FIXTURE_NOW,
    FIXTURE_NOW,
  );
  await run(
    database,
    `INSERT INTO event_public_details (
       event_id, organization_id, attendance_mode, created_at, updated_at
     ) VALUES (?, ?, 'in_person', ?, ?)`,
    "event-rendered-cancelled",
    ORGANIZATION_ID,
    FIXTURE_NOW,
    FIXTURE_NOW,
  );

  await run(
    database,
    `INSERT INTO organizer_events (
       id, organization_id, club_id, program_id, event_lane_id, category_id,
       venue_id, primary_organizer_profile_id, title, slug, summary,
       description, private_notes, private_meeting_details, meetup_event_url,
       planning_status, publication_status, schedule_shape, starts_at_utc,
       ends_at_utc, timezone, all_day_start_date,
       all_day_end_date_exclusive, buffer_before_minutes,
       buffer_after_minutes, content_version, schedule_version,
       created_by_profile_id, updated_by_profile_id, created_at, updated_at,
       deleted_at
     ) VALUES (
       ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, 'idea',
       'private', 'unscheduled', NULL, NULL, 'America/Vancouver', NULL, NULL,
       0, 0, 1, 1, ?, ?, ?, ?, NULL
     )`,
    "phase3-private-idea",
    ORGANIZATION_ID,
    "club-curiosity",
    "lane-think",
    PROFILE_ID,
    "PRIVATE_PHASE3_TITLE_SENTINEL",
    "private-phase3-idea-sentinel",
    "PRIVATE_PHASE3_TITLE_SENTINEL summary",
    "PRIVATE_PHASE3_TITLE_SENTINEL description",
    "PRIVATE_PHASE3_NOTES_SENTINEL",
    "PRIVATE_PHASE3_MEETING_SENTINEL",
    PROFILE_ID,
    PROFILE_ID,
    FIXTURE_NOW,
    FIXTURE_NOW,
  );
  await run(
    database,
    `INSERT INTO organizer_event_revisions (
       id, organization_id, organizer_event_id, content_version,
       schedule_version, action, snapshot_json, actor_profile_id, created_at
     ) VALUES (?, ?, ?, 1, 1, 'created', ?, ?, ?)`,
    "phase3-private-idea-revision",
    ORGANIZATION_ID,
    "phase3-private-idea",
    JSON.stringify({
      title: "PRIVATE_PHASE3_TITLE_SENTINEL",
      privateNotes: "PRIVATE_PHASE3_NOTES_SENTINEL",
      privateMeetingDetails: "PRIVATE_PHASE3_MEETING_SENTINEL",
    }),
    PROFILE_ID,
    FIXTURE_NOW,
  );
  await run(
    database,
    `INSERT INTO notifications (
       id, organization_id, recipient_profile_id, type, payload_json,
       read_at, created_at, deleted_at
     ) VALUES (?, ?, ?, 'event_assignment', ?, NULL, ?, NULL)`,
    "phase3-private-notification",
    ORGANIZATION_ID,
    PROFILE_ID,
    JSON.stringify({
      eventId: "phase3-private-idea",
      title: "PRIVATE_NOTIFICATION_SENTINEL",
      type: "event_assignment",
    }),
    FIXTURE_NOW,
  );
  await run(
    database,
    `INSERT INTO audit_logs (
       id, organization_id, actor_profile_id, action, entity_type, entity_id,
       metadata_json, created_at
     ) VALUES (?, ?, ?, 'event.created', 'organizer_event', ?, ?, ?)`,
    "phase3-private-audit",
    ORGANIZATION_ID,
    PROFILE_ID,
    "phase3-private-idea",
    JSON.stringify({ detail: "PRIVATE_AUDIT_SENTINEL" }),
    FIXTURE_NOW,
  );
  await run(
    database,
    `INSERT INTO invitations (
       id, organization_id, club_id, token_hash, target_normalized_email,
       intended_role, created_by_profile_id, expires_at, revoked_at, used_at,
       used_by_profile_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'organizer', ?, ?, NULL, NULL, NULL, ?, ?)`,
    "phase3-private-invitation",
    ORGANIZATION_ID,
    "club-curiosity",
    createHash("sha256").update(INVITATION_TOKEN).digest("hex"),
    "private_invitation_email_sentinel@example.invalid",
    PROFILE_ID,
    Date.UTC(2030, 0, 1),
    FIXTURE_NOW,
    FIXTURE_NOW,
  );
  await run(
    database,
    `INSERT INTO sync_sources (
       id, organization_id, club_id, source_type, source_url, enabled,
       refresh_interval_minutes, next_refresh_at, lease_token,
       lease_expires_at, last_attempt_at, last_success_at, last_error_at,
       last_error_code, etag, http_last_modified, active_generation_id,
       pending_generation_id, pending_snapshot_hash, pending_cursor,
       created_by_profile_id, updated_by_profile_id, created_at, updated_at,
       deleted_at
     ) VALUES (
       ?, ?, ?, 'meetup_ics', ?, 0, 15, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, NULL
     )`,
    "phase7-private-meetup-source",
    ORGANIZATION_ID,
    "club-curiosity",
    "https://www.meetup.com/vancouver-meetup-group/events/ical/" +
      "?token=PHASE7_PRIVATE_MEETUP_FEED_SENTINEL",
    PROFILE_ID,
    PROFILE_ID,
    FIXTURE_NOW,
    FIXTURE_NOW,
  );
  await run(
    database,
    `INSERT INTO media_assets (
       id, organization_id, object_key, file_name, mime_type, byte_size,
       alt_text, credit, rights_status, participant_consent_status,
       is_public, uploaded_by_profile_id, created_at, updated_at, deleted_at
     ) VALUES (
       ?, ?, ?, 'phase7-private.png', 'image/png', 4,
       'Private media test asset', NULL, 'approved', 'not_applicable',
       0, ?, ?, ?, NULL
     )`,
    phase7PrivateIds.mediaAssetId,
    ORGANIZATION_ID,
    "PHASE7_PRIVATE_R2_OBJECT_KEY_SENTINEL",
    PROFILE_ID,
    FIXTURE_NOW,
    FIXTURE_NOW,
  );
  await run(
    database,
    `INSERT INTO media_asset_details (
       asset_id, organization_id, upload_state, caption,
       private_rights_source_note, private_participant_consent_note,
       focal_point_x, focal_point_y, informative, content_version,
       original_sha256, width, height, pixel_count, failure_code,
       finalized_at, updated_by_profile_id, created_at, updated_at
     ) VALUES (
       ?, ?, 'ready', NULL, 'Private rights provenance', NULL,
       5000, 5000, 1, 1, ?, 2, 2, 4, NULL, ?, ?, ?, ?
     )`,
    phase7PrivateIds.mediaAssetId,
    ORGANIZATION_ID,
    "d".repeat(64),
    FIXTURE_NOW,
    PROFILE_ID,
    FIXTURE_NOW,
    FIXTURE_NOW,
  );
  await run(
    database,
    `INSERT INTO media_asset_variants (
       id, organization_id, asset_id, variant_kind, object_key,
       mime_type, byte_size, width, height, pixel_count, sha256,
       state, failure_code, created_at, finalized_at
     ) VALUES (
       'phase7-private-media-original', ?, ?, 'original', ?,
       'image/png', 4, 2, 2, 4, ?, 'ready', NULL, ?, ?
     )`,
    ORGANIZATION_ID,
    phase7PrivateIds.mediaAssetId,
    "PHASE7_PRIVATE_R2_OBJECT_KEY_SENTINEL",
    "d".repeat(64),
    FIXTURE_NOW,
    FIXTURE_NOW,
  );
}

async function seedPhase7PrivateSentinels(targetRuntime) {
  const database = await targetRuntime.getD1Database("DB");
  const now = Number(
    await database
      .prepare("SELECT unixepoch() * 1000 AS now_ms")
      .first("now_ms"),
  );
  assert.equal(Number.isSafeInteger(now), true);

  const protectionKey = await ensurePublicFormProtectionKey(
    database,
    ORGANIZATION_ID,
    now,
  );
  phase7DynamicPrivateSentinels.push(protectionKey);
  const submission = await submitPublicForm(database, {
    anonymousClientId: "phase7-private-rendered-client",
    formInstance: {
      formKey: "contact",
      issuedAt: now - 4_000,
      nonce: "phase7-private-rendered-form-nonce",
    },
    formKey: "contact",
    honeypot: "",
    keyHex: protectionKey,
    networkFacts:
      "PHASE7_PRIVATE_NETWORK_FACTS_SENTINEL",
    nowUtcMs: now,
    organizationId: ORGANIZATION_ID,
    payload: {
      message: "PHASE7_PRIVATE_FORM_MESSAGE_SENTINEL",
      name: "PHASE7_PRIVATE_FORM_NAME_SENTINEL",
      replyEmail: "phase7-private-form@example.invalid",
      topic: "Privacy",
    },
  });
  const submissionRow = await database
    .prepare(
      `SELECT submission.id
       FROM form_submissions AS submission
       JOIN form_submission_workflows AS workflow
         ON workflow.submission_id = submission.id
        AND workflow.organization_id = submission.organization_id
       WHERE submission.organization_id = ?
         AND workflow.public_reference = ?
       LIMIT 1`,
    )
    .bind(ORGANIZATION_ID, submission.publicReference)
    .first();
  assert.equal(typeof submissionRow?.id, "string");
  phase7PrivateIds.submissionId = submissionRow.id;
  phase7DynamicPrivateSentinels.push(
    submission.publicReference,
    submissionRow.id,
  );
  await appendFormSubmissionNote(database, OWNER_IDENTITY, {
    body: "PHASE7_PRIVATE_SUBMISSION_NOTE_SENTINEL",
    submissionId: submissionRow.id,
  });
  const rateScopeRows = await database
    .prepare(
      `SELECT scope_key
       FROM public_form_rate_windows
       WHERE organization_id = ?
       ORDER BY action`,
    )
    .bind(ORGANIZATION_ID)
    .all();
  for (const row of rateScopeRows.results ?? []) {
    if (typeof row.scope_key === "string") {
      phase7DynamicPrivateSentinels.push(row.scope_key);
    }
  }

  const importHeaders = [
    "private_mapping_header_sentinel",
    "club",
    "schedule_type",
    "timezone",
    "planning_status",
    "publication_status",
    "primary_organizer_email",
    "attendance_mode",
    "notes",
  ];
  const importSelections = [
    "title",
    "club",
    "schedule_type",
    "timezone",
    "planning_status",
    "publication_status",
    "primary_organizer_email",
    "attendance_mode",
    "notes",
  ];
  const importBytes = new TextEncoder().encode(
    [
      importHeaders.join(","),
      [
        "PHASE7_PRIVATE_IMPORT_TITLE_SENTINEL",
        "vancouver-curiosity-club",
        "unscheduled",
        "America/Vancouver",
        "idea",
        "private",
        "private_owner_email_sentinel@example.invalid",
        "undecided",
        "PHASE7_PRIVATE_EVENT_NOTES_SENTINEL",
      ].join(","),
      [
        "PHASE7_PRIVATE_IMPORT_ERROR_SENTINEL",
        "vancouver-curiosity-club",
        "unscheduled",
        "America/Vancouver",
        "idea",
        "published",
        "private_owner_email_sentinel@example.invalid",
        "undecided",
        "PHASE7_PRIVATE_EVENT_NOTES_SENTINEL",
      ].join(","),
      "",
    ].join("\r\n"),
  );
  const importInput = {
    bytes: importBytes,
    contentType: "text/csv",
    fileName: "phase7-private-rendered.csv",
    sourceLabel: "PHASE7_PRIVATE_IMPORT_LABEL_SENTINEL",
    sourceNamespace: "phase7-private-rendered",
  };
  const inspection = await inspectCsvImportUpload(
    database,
    OWNER_IDENTITY,
    importInput,
  );
  const preview = await createCsvImportPreview(
    database,
    OWNER_IDENTITY,
    {
      ...importInput,
      headerSelections: importSelections,
      inspectionBatchId: inspection.inspectionBatchId,
    },
  );
  assert.equal(preview.batch.phase, "previewed");
  assert.equal(typeof preview.previewFingerprint, "string");
  phase7PrivateIds.importBatchId = preview.batch.batchId;
  phase7DynamicPrivateSentinels.push(
    preview.batch.batchId,
    inspection.fileSha256,
    preview.previewFingerprint,
  );
  const importPrivateFacts = await database
    .prepare(
      `SELECT detail.mapping_fingerprint,
              application.normalized_row_fingerprint,
              application.idempotency_key
       FROM import_batch_details AS detail
       JOIN import_rows AS row
         ON row.import_batch_id = detail.import_batch_id
        AND row.organization_id = detail.organization_id
       JOIN import_row_applications AS application
         ON application.import_row_id = row.id
        AND application.import_batch_id = row.import_batch_id
        AND application.organization_id = row.organization_id
       WHERE detail.import_batch_id = ?
       ORDER BY row.row_number`,
    )
    .bind(preview.batch.batchId)
    .all();
  for (const row of importPrivateFacts.results ?? []) {
    for (const value of [
      row.mapping_fingerprint,
      row.normalized_row_fingerprint,
      row.idempotency_key,
    ]) {
      if (typeof value === "string") {
        phase7DynamicPrivateSentinels.push(value);
      }
    }
  }

  const calendar = await createOwnCalendarSubscription(
    database,
    OWNER_IDENTITY,
    "PHASE7_PRIVATE_CALENDAR_LABEL_SENTINEL",
    now,
  );
  const calendarRow = await database
    .prepare(
      `SELECT token_hash
       FROM ics_subscription_tokens
       WHERE id = ?
         AND organization_id = ?
       LIMIT 1`,
    )
    .bind(calendar.subscription.id, ORGANIZATION_ID)
    .first();
  assert.equal(typeof calendarRow?.token_hash, "string");
  phase7DynamicPrivateSentinels.push(
    calendar.token,
    calendar.subscription.id,
    calendarRow.token_hash,
  );

  const conflictInput = {
    bufferAfterMinutes: 0,
    bufferBeforeMinutes: 0,
    clubId: "club-curiosity",
    coOrganizerProfileIds: [],
    endLocal: "2037-08-15T20:00",
    planningStatus: "draft",
    primaryOrganizerProfileId: PROFILE_ID,
    privateMeetingDetails:
      "PHASE7_PRIVATE_EVENT_MEETING_SENTINEL",
    privateNotes: "PHASE7_PRIVATE_EVENT_NOTES_SENTINEL",
    publicationStatus: "private",
    scheduleShape: "timed",
    startLocal: "2037-08-15T18:00",
    timeZone: "America/Vancouver",
    venueId: null,
  };
  const firstDraft = await createOrganizerEvent(
    database,
    OWNER_IDENTITY,
    {
      ...conflictInput,
      title: "Phase 7 private conflict anchor",
    },
  );
  await performOrganizerLifecycleAction(
    database,
    OWNER_IDENTITY,
    firstDraft.id,
    {
      action: "place_hold",
      expectedContentVersion: firstDraft.contentVersion,
      expectedScheduleVersion: firstDraft.scheduleVersion,
      holdDurationHours: 72,
    },
  );
  const secondDraft = await createOrganizerEvent(
    database,
    OWNER_IDENTITY,
    {
      ...conflictInput,
      title: "Phase 7 private conflict candidate",
    },
  );
  await performOrganizerLifecycleAction(
    database,
    OWNER_IDENTITY,
    secondDraft.id,
    {
      action: "place_hold",
      expectedContentVersion: secondDraft.contentVersion,
      expectedScheduleVersion: secondDraft.scheduleVersion,
      holdDurationHours: 72,
      reason: "PHASE7_PRIVATE_CONFLICT_REASON_SENTINEL",
    },
  );
  phase7DynamicPrivateSentinels.push(
    firstDraft.id,
    firstDraft.slug,
    secondDraft.id,
    secondDraft.slug,
  );

  const basePrivateFacts = await database
    .prepare(
      `SELECT
         (SELECT token_hash
          FROM invitations
          WHERE id = 'phase3-private-invitation') AS invitation_hash,
         (SELECT source_url
          FROM sync_sources
          WHERE id = 'phase7-private-meetup-source') AS source_url`,
    )
    .first();
  for (const value of [
    basePrivateFacts?.invitation_hash,
    basePrivateFacts?.source_url,
    phase7PrivateIds.mediaAssetId,
  ]) {
    if (typeof value === "string") {
      phase7DynamicPrivateSentinels.push(value);
    }
  }
}

async function run(database, sql, ...bindings) {
  const result = await database.prepare(sql).bind(...bindings).run();
  assert.notEqual(result.success, false, result.error ?? sql);
}
