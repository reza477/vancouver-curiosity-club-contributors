import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

test("public reads use vinext request scope across metadata, probes, and rendering", async () => {
  const requestCache = await readFile(
    new URL("lib/server/public/request-cache.ts", projectRoot),
    "utf8",
  );
  assert.match(requestCache, /from "vinext\/cache"/u);
  assert.match(requestCache, /cacheForRequest\(/u);
  assert.match(
    requestCache,
    /new WeakMap<PublicDatabase, PublicRequestCache>[\s\S]*?caches\.get\(database\)[\s\S]*?caches\.set\(database, created\)/u,
    "D1 promises must be keyed by the exact binding inside one request",
  );
  for (const publicRead of [
    "clubDetails",
    "clubEventViews",
    "clubNextEvents",
    "eventDetails",
    "eventMaterializedViews",
    "siteContext",
    "navigation",
    "organization",
    "pages",
    "programDetails",
    "publishedSiteLogos",
    "slugRedirects",
  ]) {
    assert.match(requestCache, new RegExp(`${publicRead}: Map<`, "u"));
  }
  assert.doesNotMatch(
    requestCache,
    /from "react"/u,
    "React cache is not guaranteed to span vinext's pre-render probe",
  );
});

test("root metadata and layout share one published-logo media read per request", async () => {
  const layoutSource = await readFile(
    new URL("app/layout.tsx", projectRoot),
    "utf8",
  );
  assert.equal(
    (layoutSource.match(/getRequestPublishedSiteLogo\(/gu) ?? []).length,
    2,
  );
  assert.doesNotMatch(layoutSource, /resolveMediaAssetsForRendering/u);
  const [{ createRequestContext, runWithRequestContext }, requestCache] =
    await Promise.all([
      import("../../node_modules/vinext/dist/shims/unified-request-context.js"),
      import("../../lib/server/public/request-cache.ts"),
    ]);
  let reads = 0;
  const database = {
    prepare(sql) {
      assert.match(sql, /FROM media_assets AS asset/u);
      reads += 1;
      return {
        bind() {
          return this;
        },
        async all() {
          return { results: [], success: true };
        },
      };
    },
  };
  const input = {
    assetId: "site-logo-asset",
    organizationId: "organization-1",
  };

  await runWithRequestContext(createRequestContext(), async () => {
    assert.deepEqual(
      await Promise.all([
        requestCache.getRequestPublishedSiteLogo(database, input),
        requestCache.getRequestPublishedSiteLogo(database, input),
      ]),
      [null, null],
    );
    assert.equal(reads, 1);
  });

  await runWithRequestContext(createRequestContext(), async () => {
    await requestCache.getRequestPublishedSiteLogo(database, input);
  });
  assert.equal(reads, 2, "a later request must revalidate published media");
});

test("event and club detail lookup chains deduplicate within one request", async () => {
  const [{ createRequestContext, runWithRequestContext }, requestCache] =
    await Promise.all([
      import("../../node_modules/vinext/dist/shims/unified-request-context.js"),
      import("../../lib/server/public/request-cache.ts"),
    ]);
  const reads = {
    club: 0,
    event: 0,
    materialized: 0,
    redirect: 0,
  };
  const database = {
    prepare(sql) {
      if (sql.includes("FROM public_event_calendar_snapshots")) {
        reads.materialized += 1;
      } else if (sql.includes("FROM public_events AS public_event")) {
        reads.event += 1;
      } else if (sql.includes("FROM public_slug_redirects AS redirect")) {
        reads.redirect += 1;
      } else if (sql.includes("AND club.slug = ? LIMIT 1")) {
        reads.club += 1;
      } else {
        assert.fail(`Unexpected detail lookup: ${sql.slice(0, 120)}`);
      }
      return {
        bind() {
          return this;
        },
        async first() {
          return null;
        },
      };
    },
  };
  const eventInput = {
    organizationId: "organization-1",
    slug: "event-one",
  };
  const redirectInput = {
    entityType: "club_public_profile",
    fromSlug: "old-club",
  };
  const materializedInput = {
    nowUtcMs: Date.parse("2026-08-14T18:00:00.000Z"),
    organizationId: "organization-1",
    slug: "event-one",
    todayDate: "2026-08-14",
  };
  const directoryInput = {
    clubSlugs: ["club-one", "club-two"],
    nowUtcMs: materializedInput.nowUtcMs,
    organizationId: "organization-1",
    todayDate: "2026-08-14",
  };

  await runWithRequestContext(createRequestContext(), async () => {
    await Promise.all([
      requestCache.getRequestPublicEventBySlug(database, eventInput),
      requestCache.getRequestPublicEventBySlug(database, eventInput),
      requestCache.getRequestPublicEventDetailViewMaterialization(
        database,
        materializedInput,
      ),
      requestCache.getRequestPublicEventDetailViewMaterialization(database, {
        ...materializedInput,
        nowUtcMs: materializedInput.nowUtcMs + 1,
      }),
      requestCache.getRequestPublicNextEventsByClubMaterialization(
        database,
        directoryInput,
      ),
      requestCache.getRequestPublicNextEventsByClubMaterialization(database, {
        ...directoryInput,
        clubSlugs: [...directoryInput.clubSlugs, "club-one"],
        nowUtcMs: directoryInput.nowUtcMs + 1,
      }),
      requestCache.getRequestPublicClubBySlug(database, "club-one"),
      requestCache.getRequestPublicClubBySlug(database, "club-one"),
      requestCache.getRequestPublicSlugRedirect(database, redirectInput),
      requestCache.getRequestPublicSlugRedirect(database, redirectInput),
    ]);
    assert.deepEqual(reads, {
      club: 1,
      event: 1,
      // The empty test database exercises compact lookup plus the durable v1
      // rollout fallback. Duplicate metadata/page calls share both reads.
      materialized: 4,
      redirect: 1,
    });
  });

  await runWithRequestContext(createRequestContext(), async () => {
    await Promise.all([
      requestCache.getRequestPublicEventBySlug(database, eventInput),
      requestCache.getRequestPublicEventDetailViewMaterialization(
        database,
        materializedInput,
      ),
      requestCache.getRequestPublicNextEventsByClubMaterialization(
        database,
        directoryInput,
      ),
      requestCache.getRequestPublicClubBySlug(database, "club-one"),
      requestCache.getRequestPublicSlugRedirect(database, redirectInput),
    ]);
  });
  assert.deepEqual(
    reads,
    { club: 2, event: 2, materialized: 8, redirect: 2 },
    "a later request must observe newly published event and club state",
  );
});

test("program metadata and club/program event view loads deduplicate per request", async () => {
  const [{ createRequestContext, runWithRequestContext }, requestCache] =
    await Promise.all([
      import("../../node_modules/vinext/dist/shims/unified-request-context.js"),
      import("../../lib/server/public/request-cache.ts"),
    ]);
  const reads = {
    materialized: 0,
    organization: 0,
    program: 0,
    redirect: 0,
    site: 0,
  };
  const database = {
    prepare(sql) {
      if (sql.includes("FROM public_event_calendar_snapshots")) {
        reads.materialized += 1;
      } else if (sql.includes("AND details.public_slug = ?")) {
        reads.program += 1;
      } else if (sql.includes("FROM public_slug_redirects AS redirect")) {
        reads.redirect += 1;
      } else if (sql.includes("identity_setting.value_json AS identity_json")) {
        reads.site += 1;
      } else if (/FROM organizations\s+WHERE slug = \?/u.test(sql)) {
        reads.organization += 1;
      } else {
        assert.fail(`Unexpected program lookup: ${sql.slice(0, 120)}`);
      }
      return {
        bind() {
          return this;
        },
        async first() {
          return null;
        },
      };
    },
  };
  const commonView = {
    clubSlug: "club-one",
    nowUtcMs: Date.parse("2026-08-14T18:00:00.000Z"),
    organizationId: "organization-1",
    todayDate: "2026-08-14",
  };
  const programRedirect = {
    entityType: "program_public_profile",
    fromSlug: "old-program",
  };

  async function readEverySurfaceTwice() {
    await Promise.all([
      requestCache.getRequestPublicOrganization(database),
      requestCache.getRequestPublicOrganization(database),
      requestCache.getRequestPublicSiteContext(database),
      requestCache.getRequestPublicSiteContext(database),
      requestCache.getRequestPublicProgramBySlugs(
        database,
        "club-one",
        "program-one",
      ),
      requestCache.getRequestPublicProgramBySlugs(
        database,
        "club-one",
        "program-one",
      ),
      requestCache.getRequestPublicSlugRedirect(database, programRedirect),
      requestCache.getRequestPublicSlugRedirect(database, programRedirect),
      requestCache.getRequestPublicClubEventViewMaterialization(
        database,
        commonView,
      ),
      requestCache.getRequestPublicClubEventViewMaterialization(database, {
        ...commonView,
        nowUtcMs: commonView.nowUtcMs + 1,
      }),
      requestCache.getRequestPublicClubEventViewMaterialization(database, {
        ...commonView,
        programSlug: "program-one",
      }),
      requestCache.getRequestPublicClubEventViewMaterialization(database, {
        ...commonView,
        nowUtcMs: commonView.nowUtcMs + 1,
        programSlug: "program-one",
      }),
    ]);
  }

  await runWithRequestContext(createRequestContext(), async () => {
    await readEverySurfaceTwice();
    assert.deepEqual(reads, {
      // Each distinct view tries its compact shard, the coherent detail row,
      // and the backward-compatible Events row in this empty test database.
      // Duplicate calls must not double that rollout fallback chain.
      materialized: 6,
      organization: 1,
      program: 1,
      redirect: 1,
      site: 1,
    });
  });

  await runWithRequestContext(createRequestContext(), async () => {
    await readEverySurfaceTwice();
  });
  assert.deepEqual(
    reads,
    {
      materialized: 12,
      organization: 2,
      program: 2,
      redirect: 2,
      site: 2,
    },
    "a later request must re-read program identity, metadata, and both event views",
  );
});

test("event and club detail routes use request-scoped and materialized seams", async () => {
  const [eventRoute, clubRoute, programRoute] = await Promise.all([
    readFile(new URL("app/events/[slug]/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/clubs/[slug]/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/clubs/[slug]/programs/[programSlug]/page.tsx", projectRoot),
      "utf8",
    ),
  ]);
  assert.doesNotMatch(eventRoute, /getRequestPublicEventBySlug/u);
  assert.match(eventRoute, /getRequestPublicEventDetailViewMaterialization/u);
  assert.doesNotMatch(
    eventRoute,
    /listRelatedPublicEvents|materializedIsCurrent|currentEvent|JSON\.stringify\(materialized\.event\)/u,
    "event detail must fail closed on its one protected-updater snapshot instead of running the unified live projection",
  );
  assert.doesNotMatch(eventRoute, /\bgetPublicEventBySlug\b/u);
  assert.match(
    eventRoute,
    /if \(!organization\) publicServiceUnavailable\(\)/u,
  );
  assert.match(
    eventRoute,
    /if \(!materialized\) publicServiceUnavailable\(\)/u,
  );
  assert.match(
    eventRoute,
    /if \(materialized\.kind !== "available"\) return null/u,
    "only a coherent materialized missing result may become a 404",
  );
  assert.match(clubRoute, /getRequestPublicClubBySlug/u);
  assert.match(clubRoute, /getRequestPublicSlugRedirect/u);
  assert.match(clubRoute, /getRequestPublicOrganization/u);
  assert.match(clubRoute, /getRequestPublicSiteContext/u);
  assert.match(clubRoute, /getRequestPublicClubEventViewMaterialization/u);
  assert.doesNotMatch(clubRoute, /\bgetPublicClubBySlug\b/u);
  assert.doesNotMatch(clubRoute, /\bgetPublicSlugRedirect\b/u);
  assert.doesNotMatch(clubRoute, /\breadPublicClubEventViewMaterialization\b/u);
  assert.doesNotMatch(clubRoute, /\bqueryPublicEvents\b/u);
  assert.match(programRoute, /getRequestPublicProgramBySlugs/u);
  assert.match(programRoute, /getRequestPublicSlugRedirect/u);
  assert.match(programRoute, /getRequestPublicOrganization/u);
  assert.match(programRoute, /getRequestPublicSiteContext/u);
  assert.match(programRoute, /getRequestPublicClubEventViewMaterialization/u);
  assert.doesNotMatch(programRoute, /\bgetPublicProgramBySlugs\b/u);
  assert.doesNotMatch(programRoute, /\bgetPublicSlugRedirect\b/u);
  assert.doesNotMatch(
    programRoute,
    /\breadPublicClubEventViewMaterialization\b/u,
  );
  assert.doesNotMatch(programRoute, /\bqueryPublicEvents\b/u);
});

test("Events metadata starts independent page and supporting reads together", async () => {
  const editorial = await readFile(
    new URL("app/_components/EditorialPage.tsx", projectRoot),
    "utf8",
  );

  assert.match(
    editorial,
    /Promise\.all\(\[[\s\S]*?loadEditorialPage\(slug, route\)[\s\S]*?loadEditorialMetadataSupport/u,
    "page publication and site metadata support must not form serial D1 waves",
  );
  assert.match(
    editorial,
    /async function loadEditorialMetadataSupport[\s\S]*?Promise\.all\(\[[\s\S]*?getRequestPublicOrganization\(database\)[\s\S]*?getRequestPublicSiteContext\(database\)/u,
    "organization and site context must start together",
  );
});

test("vinext request scope shares one public D1 promise and resets for the next request", async () => {
  const [{ createRequestContext, runWithRequestContext }, requestCache] =
    await Promise.all([
      import("../../node_modules/vinext/dist/shims/unified-request-context.js"),
      import("../../lib/server/public/request-cache.ts"),
    ]);
  let reads = 0;
  let otherReads = 0;
  const database = {
    prepare() {
      reads += 1;
      return {
        bind() {
          return this;
        },
        async first() {
          return null;
        },
      };
    },
  };
  const otherDatabase = {
    prepare() {
      otherReads += 1;
      return {
        bind() {
          return this;
        },
        async first() {
          return null;
        },
      };
    },
  };

  await runWithRequestContext(createRequestContext(), async () => {
    const [first, second] = await Promise.all([
      requestCache.getRequestPublicPageContent(database, "events"),
      requestCache.getRequestPublicPageContent(database, "events"),
    ]);
    assert.equal(first, null);
    assert.equal(second, null);
    assert.equal(reads, 1, "one request must share the exact D1 promise");
    assert.equal(
      await requestCache.getRequestPublicPageContent(otherDatabase, "events"),
      null,
    );
    assert.equal(otherReads, 1, "different D1 bindings must stay isolated");
  });

  await runWithRequestContext(createRequestContext(), async () => {
    assert.equal(
      await requestCache.getRequestPublicPageContent(database, "events"),
      null,
    );
  });
  assert.equal(reads, 2, "a new request must observe a fresh publication");
});
