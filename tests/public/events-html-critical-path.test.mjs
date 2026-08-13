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
    "siteContext",
    "navigation",
    "organization",
    "pages",
  ]) {
    assert.match(requestCache, new RegExp(`${publicRead}: Map<`, "u"));
  }
  assert.doesNotMatch(
    requestCache,
    /from "react"/u,
    "React cache is not guaranteed to span vinext's pre-render probe",
  );
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
      import(
        "../../node_modules/vinext/dist/shims/unified-request-context.js"
      ),
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
        async all() {
          return { results: [] };
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
        async all() {
          return { results: [] };
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
      await requestCache.getRequestPublicPageContent(
        otherDatabase,
        "events",
      ),
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
