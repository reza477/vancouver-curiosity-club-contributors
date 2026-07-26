import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Log, LogLevel, Miniflare } from "miniflare";

const FIXTURE_NOW = Date.UTC(2026, 6, 24, 19, 0, 0);
const ORGANIZATION_ID = "phase2-org";
const PROFILE_ID = "phase2-owner";
const EXPECTED_DATABASE_INVARIANT_FINGERPRINT =
  "0d89f16aa0a5a462b73a34c8ecb98cd011527bc50124697a90bffcbd095e5621";
const EXPECTED_DATABASE_INVARIANT_TRIGGERS = Object.freeze([
  "audit_logs_immutable_before_delete",
  "audit_logs_immutable_before_update",
  "club_public_profiles_org_integrity_before_insert",
  "club_public_profiles_org_integrity_before_update",
  "clubs_public_profile_org_integrity_before_update",
  "event_lanes_public_profile_org_integrity_before_update",
  "event_public_details_org_integrity_before_insert",
  "event_public_details_org_integrity_before_update",
  "events_public_details_org_integrity_before_update",
  "events_reservation_guard_before_insert",
  "events_reservation_guard_before_update",
  "organization_memberships_single_owner_before_delete",
  "organization_memberships_single_owner_before_insert",
  "organization_memberships_single_owner_before_update",
  "organizer_event_organizers_integrity_before_insert",
  "organizer_event_organizers_integrity_before_update",
  "organizer_event_revisions_integrity_before_delete",
  "organizer_event_revisions_integrity_before_insert",
  "organizer_event_revisions_integrity_before_update",
  "organizer_events_phase3_integrity_before_insert",
  "organizer_events_phase3_integrity_before_update",
  "organizer_profile_preferences_integrity_before_insert",
  "organizer_profile_preferences_integrity_before_update",
  "organizer_rate_limits_integrity_before_insert",
  "organizer_rate_limits_integrity_before_update",
  "ownership_transfer_locks_before_delete",
  "ownership_transfer_locks_before_insert",
  "ownership_transfer_locks_before_update",
  "profiles_membership_identity_before_delete",
  "profiles_membership_identity_before_update",
]);
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
];
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
  "/community",
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
const entrypoint = resolve(serverRoot, "index.js");
const runtime = createBuiltRuntime();
await applyPackagedProductionMigrations(runtime);
await initializePackagedDatabaseInvariants(runtime);
await seedPublicCatalog(runtime);

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
  ]);
  for (const file of packagedMigrations) {
    const sql = await readFile(join(packagedMigrationDirectory, file), "utf8");
    assert.doesNotMatch(sql, /\bCREATE\s+TRIGGER\b/iu, file);
    assert.ok(
      productionMigrationFragments(sql).length <= 49,
      `${file} must remain bounded`,
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
  const marker = await database
    .prepare(
      `SELECT version, trigger_fingerprint
       FROM database_invariant_state
       WHERE singleton_key = 'database-guards'`,
    )
    .first();
  assert.deepEqual({ ...marker }, {
    trigger_fingerprint: EXPECTED_DATABASE_INVARIANT_FINGERPRINT,
    version: 3,
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
    43,
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
    90,
  );
  assert.deepEqual(
    (await database.prepare("PRAGMA foreign_key_check").all()).results,
    [],
  );

  await run(
    database,
    `INSERT INTO profiles (
       id, siwc_subject, normalized_email, display_name, status,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    "profile-other-org",
    "subject-other-org",
    "other-org@example.invalid",
    "Other organization fixture",
    FIXTURE_NOW,
    FIXTURE_NOW,
  );
  await run(
    database,
    `INSERT INTO organizations (
       id, name, slug, timezone, created_by_profile_id, created_at, updated_at
     ) VALUES (?, ?, ?, 'America/Vancouver', ?, ?, ?)`,
    "other-org",
    "Other organization fixture",
    "other-organization-fixture",
    "profile-other-org",
    FIXTURE_NOW,
    FIXTURE_NOW,
  );
  await run(
    database,
    `INSERT INTO event_lanes (
       id, organization_id, name, slug, sort_order, created_by_profile_id,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, 10, ?, ?, ?)`,
    "other-lane",
    "other-org",
    "Other lane",
    "other-lane",
    "profile-other-org",
    FIXTURE_NOW,
    FIXTURE_NOW,
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
        "other-lane",
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
});

test("the built public root is indexable and carries the production security contract", async () => {
  const response = await fetchPath("/");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const policy = response.headers.get("content-security-policy") ?? "";
  assert.match(policy, /frame-ancestors 'none'/u);
  assert.match(policy, /script-src [^;]*'strict-dynamic'/u);
  assert.match(policy, /script-src-attr 'none'/u);
  assert.doesNotMatch(policy, /script-src [^;]*'unsafe-inline'/u);
  assert.doesNotMatch(policy, /script-src [^;]*'unsafe-eval'/u);
  const nonceMatch = /'nonce-([A-Za-z0-9_-]{22})'/u.exec(policy);
  assert.ok(nonceMatch, "production CSP must contain a per-request nonce");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(
    response.headers.get("strict-transport-security") ?? "",
    /max-age=31536000/u,
  );
  assert.equal(response.headers.get("x-robots-tag"), null);

  const html = await response.text();
  assert.match(html, /<title>Vancouver Curiosity Club<\/title>/iu);
  assert.match(html, /A social calendar with a brain\./u);
  assert.match(html, /Explore Upcoming Events/u);
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
  assert.equal(
    secondResponse.headers.get("content-security-policy-report-only"),
    null,
  );
  const secondHtml = await secondResponse.text();
  assert.doesNotMatch(secondHtml, /https:\/\/attacker\.example/u);
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

test("Events is canonical, empty honestly, and filter URLs are non-indexable", async () => {
  const response = await fetchPath("/events");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-robots-tag"), null);
  const html = await response.text();
  assert.match(html, /name="robots" content="index, follow"/iu);
  assert.match(
    html,
    /rel="canonical" href="https:\/\/preview\.example\/events"/iu,
  );
  assert.match(html, /0(?:<!-- -->|\s)*results/u);
  assert.match(
    html,
    /When a real event is published, it will appear here\./u,
  );
  assert.match(html, /<form[^>]*action="\/events"[^>]*method="get"/iu);
  assert.match(html, /Clear Filters/u);
  assert.doesNotMatch(html, /href="\/events\/[^"?]+"/iu);
  assert.doesNotMatch(html, /RSVP on Meetup/u);
  assert.equal(jsonLdDocuments(html).length, 0);
  assertNoPrivateSentinels(html);

  const filtered = await fetchPath("/events?q=unlikely-match&lane=think");
  assert.equal(filtered.status, 200);
  assert.equal(
    filtered.headers.get("x-robots-tag"),
    "noindex, follow, noarchive",
  );
  const filteredHtml = await filtered.text();
  assert.match(
    filteredHtml,
    /name="robots" content="noindex, follow"/iu,
  );
  assert.match(
    filteredHtml,
    /No published event matches this combination\./u,
  );
  assert.doesNotMatch(filteredHtml, /href="\/events\/[^"?]+"/iu);

  const malformed = await fetchPath(`/events?q=${"x".repeat(101)}`);
  assert.equal(malformed.status, 200);
  assert.equal(
    malformed.headers.get("x-robots-tag"),
    "noindex, follow, noarchive",
  );
  assert.match(
    await malformed.text(),
    /One or more filters could not be validated\./u,
  );
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
    /<title>Rendered cancelled reading · Vancouver Curiosity Club<\/title>/iu,
  );
  assert.match(html, /This previously published event is no longer going ahead/u);
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
  assert.deepEqual(eventDocument.organizer, {
    "@type": "Organization",
    name: "Vancouver Literature and Film",
    url: "https://preview.example/clubs/vancouver-literature-and-film",
  });
  assert.equal("location" in eventDocument, false);
  assert.equal(
    breadcrumbs.itemListElement.at(-1)?.item,
    "https://preview.example/events/rendered-cancelled-reading",
  );
  assertNoPrivateSentinels(html);
});

test("Calendar is a permanent non-indexable compatibility redirect", async () => {
  const response = await fetchPath("/calendar", { redirect: "manual" });
  assert.equal(response.status, 308);
  assert.equal(
    new URL(response.headers.get("location"), "https://preview.example").href,
    "https://preview.example/events",
  );
  assert.equal(
    response.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
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
    "/community",
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
    /<loc>[^<]*(?:\/calendar|\/organizer|\/api\/|\?|off-radar-eats|draft-private)[^<]*<\/loc>/u,
  );
  assertNoPrivateSentinels(sitemap);
});

test("unknown, guessed, and draft routes use the custom noindex 404", async () => {
  for (const path of [
    "/nothing-at-this-address",
    "/events/guessed-private-event",
    "/events/private-phase3-idea-sentinel",
    "/clubs/off-radar-eats",
    "/clubs/contemplative-meditation-journaling-circle",
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

test("brand assets render and unoptimized source artwork stays out of the client", async () => {
  const iconResponse = await fetchPath("/icon.png");
  assert.equal(iconResponse.status, 200);
  assert.match(iconResponse.headers.get("content-type") ?? "", /image\/png/iu);
  const iconBytes = new Uint8Array(await iconResponse.arrayBuffer());
  assert.deepEqual(
    [...iconBytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  );

  const manifestResponse = await fetchPath("/site.webmanifest");
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
  assert.deepEqual(await response.json(), {
    error: {
      code: "authentication_required",
      message: "Sign in with ChatGPT to continue.",
    },
  });
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
  assert.match(html, /href="\/community"/u);
  assert.match(html, /href="\/about"/u);
  assert.match(html, /href="\/get-involved"/u);
  assert.match(html, /Organizer Login/u);
  assert.match(html, /aria-label="Footer navigation"/u);
  assert.match(html, /Code of Conduct/u);
  assert.match(html, /Accessibility/u);
  assert.match(html, /Privacy/u);
}

function assertNoPrivateSentinels(value, allowed = new Set()) {
  for (const sentinel of PRIVATE_SENTINELS) {
    if (allowed.has(sentinel)) continue;
    assert.doesNotMatch(value, new RegExp(sentinel, "iu"), sentinel);
  }
  assert.doesNotMatch(value, /events\/ical|source_url|sourceUrl/iu);
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

function createBuiltRuntime() {
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
    log: new Log(LogLevel.WARN),
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
    const results = await database.batch(
      statements.map((statement) => database.prepare(statement)),
    );
    if (results.some((result) => result.success === false)) {
      throw new Error(`Packaged migration failed: ${file}`);
    }
  }
}

function productionMigrationFragments(sql) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function initializePackagedDatabaseInvariants(targetRuntime) {
  const repairResponse = await targetRuntime.dispatchFetch(
    new URL("/robots.txt", "https://preview.example"),
  );
  assert.equal(repairResponse.status, 503);
  assert.match(
    repairResponse.headers.get("cache-control") ?? "",
    /no-store/u,
  );
  assert.equal(repairResponse.headers.get("retry-after"), "30");
  assert.equal(
    repairResponse.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
  assert.match(
    await repairResponse.text(),
    /database safety checks were updated/u,
  );

  const verifiedResponse = await targetRuntime.dispatchFetch(
    new URL("/robots.txt", "https://preview.example"),
  );
  assert.equal(verifiedResponse.status, 200);
  await verifiedResponse.arrayBuffer();
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

  const pages = [
    [
      "home",
      "Vancouver Curiosity Club",
      "A social calendar with a brain.",
      "Thoughtful events for people who like learning in company.",
    ],
    [
      "events",
      "Events",
      "Events",
      "Browse the genuinely published gatherings on the calendar.",
    ],
    [
      "clubs",
      "Clubs",
      "Clubs",
      "Different doors into one curious Vancouver community.",
    ],
    [
      "community",
      "Community",
      "Community",
      "Find the club on its confirmed Meetup group pages.",
    ],
    [
      "about",
      "About",
      "A community organized around curiosity",
      "Vancouver Curiosity Club brings people together to learn, discuss, explore, make, and play.",
    ],
    [
      "get-involved",
      "Get Involved",
      "Bring something to the club",
      "Attend, share an idea, volunteer, host, or begin a conversation.",
    ],
    [
      "host-an-event",
      "Host an Event",
      "Interested in hosting?",
      "Event-hosting tools are not open yet.",
    ],
    [
      "contact",
      "Contact",
      "Find us on Meetup",
      "No public contact form or confirmed public email is available yet.",
    ],
    [
      "conduct",
      "Code of Conduct",
      "Make curiosity generous",
      "Treat people with respect and challenge ideas without demeaning people.",
    ],
    [
      "accessibility",
      "Accessibility",
      "Website accessibility",
      "This website is designed for keyboard use, readable zoom, clear focus, reduced motion, and responsive layouts.",
    ],
    [
      "privacy",
      "Privacy",
      "Privacy, in plain language",
      "Public pages can be browsed without an attendee account.",
    ],
  ];
  for (const [slug, title, heading, text] of pages) {
    const pageId = `page-${slug}`;
    await insertPage(database, {
      id: pageId,
      slug,
      title,
      status: "published",
      visibility: "public",
      publishedAt: FIXTURE_NOW,
    });
    await insertSection(database, {
      id: `section-${slug}-intro`,
      pageId,
      key: slug === "home" ? "hero" : "intro",
      type: slug === "home" ? "hero" : "intro",
      content: {
        eyebrow: "Vancouver, British Columbia",
        heading,
        text,
      },
      sortOrder: 10,
    });
  }
  for (const [key, content, sortOrder] of [
    [
      "attending",
      {
        heading: "Come curious",
        paragraphs: [
          "Expect a clear reason to gather and no requirement to arrive as an expert.",
          "When a detail is undecided, the listing says so.",
        ],
      },
      20,
    ],
    [
      "invitation",
      {
        heading: "Help make the calendar",
        text: "Bring an idea, volunteer, host, or explore a community partnership.",
      },
      30,
    ],
    [
      "community",
      {
        heading: "Confirmed group destinations",
        text: "Choose the public Meetup group that interests you.",
      },
      40,
    ],
  ]) {
    await insertSection(database, {
      id: `section-home-${key}`,
      pageId: "page-home",
      key,
      type: key === "invitation" ? "callout" : "prose",
      content,
      sortOrder,
    });
  }

  await insertPage(database, {
    id: "page-draft-private",
    slug: "draft-private",
    title: "PRIVATE_DRAFT_PAGE_SENTINEL",
    status: "draft",
    visibility: "private",
    publishedAt: null,
  });

  await run(
    database,
    `INSERT INTO site_settings (
       id, organization_id, key, value_json, is_public, updated_by_profile_id,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    "setting-public-identity",
    ORGANIZATION_ID,
    "public_identity",
    JSON.stringify({
      brandName: "Vancouver Curiosity Club",
      locationLabel: "Vancouver, British Columbia",
      mission: "Thoughtful events for people who like learning in company.",
      tagline: "A social calendar with a brain.",
    }),
    1,
    PROFILE_ID,
    FIXTURE_NOW,
    FIXTURE_NOW,
  );
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

  const publicLinks = clubs.filter(
    (club) => club.status === "published" && club.url,
  );
  for (const [index, club] of publicLinks.entries()) {
    await run(
      database,
      `INSERT INTO community_links (
         id, organization_id, label, url, link_type, is_published, sort_order,
         created_by_profile_id, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, 'meetup_group', 1, ?, ?, ?, ?, NULL)`,
      `community-${club.id}`,
      ORGANIZATION_ID,
      `${club.name} on Meetup`,
      club.url,
      (index + 1) * 10,
      PROFILE_ID,
      FIXTURE_NOW,
      FIXTURE_NOW,
    );
  }
  await run(
    database,
    `INSERT INTO community_links (
       id, organization_id, label, url, link_type, is_published, sort_order,
       created_by_profile_id, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, 'private', 0, 999, ?, ?, ?, NULL)`,
    "community-private-sentinel",
    ORGANIZATION_ID,
    "PRIVATE_COMMUNITY_SENTINEL",
    "https://private.invalid/",
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
}

async function insertPage(
  database,
  { id, publishedAt, slug, status, title, visibility },
) {
  await run(
    database,
    `INSERT INTO pages (
       id, organization_id, title, slug, status, visibility, current_revision,
       published_at, created_by_profile_id, updated_by_profile_id, created_at,
       updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL)`,
    id,
    ORGANIZATION_ID,
    title,
    slug,
    status,
    visibility,
    publishedAt,
    PROFILE_ID,
    PROFILE_ID,
    FIXTURE_NOW,
    FIXTURE_NOW,
  );
}

async function insertSection(
  database,
  { content, id, key, pageId, sortOrder, type },
) {
  await run(
    database,
    `INSERT INTO page_sections (
       id, organization_id, page_id, section_key, section_type, content_json,
       sort_order, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    id,
    ORGANIZATION_ID,
    pageId,
    key,
    type,
    JSON.stringify(content),
    sortOrder,
    FIXTURE_NOW,
    FIXTURE_NOW,
  );
}

async function run(database, sql, ...bindings) {
  const result = await database.prepare(sql).bind(...bindings).run();
  assert.notEqual(result.success, false, result.error ?? sql);
}
