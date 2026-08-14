import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";
import {
  EVENT_POSTER_CACHE_CONTROL,
  HASHED_ASSET_CACHE_CONTROL,
  publicAssetCacheControl,
} from "../../lib/public-asset-cache.ts";

const worker = readFileSync("worker/index.ts", "utf8");
const staticHeaders = readFileSync("public/_headers", "utf8");
const viteConfig = readFileSync("vite.config.ts", "utf8");

test("content-hashed assets receive a one-year immutable cache policy", () => {
  assert.match(
    worker,
    /publicAssetCacheControl\([\s\S]*?headers\.set\("Cache-Control", assetCacheControl\)/u,
  );
  for (const method of ["GET", "HEAD"]) {
    assert.equal(
      publicAssetCacheControl({
        method,
        pathname: "/assets/framework-12345678.js",
        status: 200,
      }),
      HASHED_ASSET_CACHE_CONTROL,
    );
  }
});

test("bounded regenerable event posters receive one-day SWR caching without immutable", () => {
  for (const extension of ["avif", "webp", "jpeg"]) {
    for (const method of ["GET", "HEAD"]) {
      const cacheControl = publicAssetCacheControl({
        method,
        pathname: `/event-posters/meetup-315294572-960.${extension}`,
        status: 200,
      });
      assert.equal(cacheControl, EVENT_POSTER_CACHE_CONTROL);
      assert.doesNotMatch(cacheControl, /immutable/u);
    }
  }

  for (const input of [
    { method: "POST", pathname: "/event-posters/meetup-1.webp", status: 200 },
    { method: "GET", pathname: "/event-posters/meetup-1.png", status: 200 },
    { method: "GET", pathname: "/event-posters/nested/meetup-1.webp", status: 200 },
    { method: "GET", pathname: `/event-posters/${"x".repeat(181)}.webp`, status: 200 },
    { method: "GET", pathname: "/event-posters/meetup-1.webp", status: 404 },
  ]) {
    assert.equal(publicAssetCacheControl(input), null);
  }
});

test("the production asset router sends only event posters through the Worker", () => {
  assert.match(
    viteConfig,
    /assets:\s*\{[\s\S]*?binding:\s*"ASSETS"[\s\S]*?run_worker_first:\s*\["\/event-posters\/\*"\]/u,
  );
  assert.equal(
    /run_worker_first:\s*true/u.test(viteConfig),
    false,
  );
  assert.equal(
    /run_worker_first:\s*\[[^\]]*"\/assets\//u.test(viteConfig),
    false,
  );
  const posterMatch = worker.indexOf(
    'normalizedPathname.startsWith("/event-posters/")',
  );
  const assetFetch = worker.indexOf("env.ASSETS.fetch(request)", posterMatch);
  const databaseChecks = worker.indexOf(
    "ensureDatabaseInvariantsForRequest(env.DB",
  );
  assert.ok(posterMatch >= 0);
  assert.ok(assetFetch > posterMatch);
  assert.ok(databaseChecks > assetFetch);
});

test("the selective static-asset router sends posters through the User Worker", async (t) => {
  assert.match(
    staticHeaders,
    /\/assets\/\*[\s\S]*?Cache-Control: public, max-age=31536000, immutable/u,
  );
  assert.match(
    staticHeaders,
    /\/event-posters\/\*[\s\S]*?Cache-Control: public, max-age=86400, stale-while-revalidate=604800/u,
  );

  const runtime = new Miniflare({
    assets: {
      binding: "ASSETS",
      directory: resolve("public"),
      routerConfig: {
        has_user_worker: true,
        static_routing: {
          user_worker: ["/event-posters/*"],
        },
      },
    },
    compatibilityDate: "2026-07-28",
    modules: true,
    script:
      `export default {
        async fetch(request, env) {
          const asset = await env.ASSETS.fetch(request);
          const headers = new Headers(asset.headers);
          headers.set("Cache-Control", ${JSON.stringify(EVENT_POSTER_CACHE_CONTROL)});
          headers.set("X-VCC-Test-Worker", "event-poster");
          return new Response(asset.body, {
            headers,
            status: asset.status,
            statusText: asset.statusText,
          });
        },
      };`,
  });
  t.after(() => runtime.dispose());

  const response = await runtime.dispatchFetch(
    "https://site.synthetic.invalid/event-posters/meetup-315294572-480.jpeg",
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("Cache-Control"),
    EVENT_POSTER_CACHE_CONTROL,
  );
  assert.equal(response.headers.get("X-VCC-Test-Worker"), "event-poster");
});

test("nonce-bearing public HTML is never placed in a shared response cache", () => {
  assert.doesNotMatch(worker, /s-maxage=/u);
  assert.match(worker, /createCspNonce\(\)/u);
  assert.match(
    worker,
    /requestWithSecurityContext\([\s\S]*?nonce[\s\S]*?secureResponse/u,
  );
});
