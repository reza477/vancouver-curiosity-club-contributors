import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { relocateWorkerOwnedAssetDirectories } from "../../build/sites-vite-plugin.ts";
import {
  EVENT_POSTER_CACHE_CONTROL,
  HASHED_ASSET_CACHE_CONTROL,
  WORKER_ASSET_ORIGIN_PREFIX,
  publicAssetCacheControl,
  publicAssetOriginPath,
} from "../../lib/public-asset-cache.ts";

const worker = readFileSync("worker/index.ts", "utf8");
const viteConfig = readFileSync("vite.config.ts", "utf8");
const vinextRunner = readFileSync("scripts/run-vinext.mjs", "utf8");

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
  assert.equal(
    publicAssetCacheControl({
      method: "GET",
      pathname: "/assets/framework-12345678.js",
      status: 304,
    }),
    HASHED_ASSET_CACHE_CONTROL,
  );
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
  assert.equal(
    publicAssetCacheControl({
      method: "GET",
      pathname: "/event-posters/meetup-1.webp",
      status: 304,
    }),
    EVENT_POSTER_CACHE_CONTROL,
  );
});

test("only safe read-only public asset paths map to the internal static origin", () => {
  for (const method of ["GET", "HEAD"]) {
    assert.equal(
      publicAssetOriginPath({
        method,
        pathname: "/assets/framework-12345678.js",
      }),
      `${WORKER_ASSET_ORIGIN_PREFIX}/assets/framework-12345678.js`,
    );
    assert.equal(
      publicAssetOriginPath({
        method,
        pathname: "/event-posters/meetup-315294572-960.webp",
      }),
      `${WORKER_ASSET_ORIGIN_PREFIX}/event-posters/meetup-315294572-960.webp`,
    );
  }

  for (const input of [
    { method: "POST", pathname: "/assets/framework-12345678.js" },
    { method: "GET", pathname: "/assets/unhashed.js" },
    { method: "GET", pathname: "/event-posters/nested/poster.webp" },
    { method: "GET", pathname: "/api/organizer/events.json" },
    {
      method: "GET",
      pathname: `${WORKER_ASSET_ORIGIN_PREFIX}/assets/framework-12345678.js`,
    },
  ]) {
    assert.equal(publicAssetOriginPath(input), null);
  }
});

test("the production asset router uses build relocation instead of unsupported routing metadata", () => {
  assert.match(
    viteConfig,
    /assets:\s*\{[\s\S]*?binding:\s*"ASSETS"[\s\S]*?\}/u,
  );
  assert.doesNotMatch(viteConfig, /run_worker_first/u);
  assert.equal(existsSync("public/_headers"), false);
  const originMatch = worker.indexOf(
    "publicAssetOriginPath({",
  );
  const assetFetch = worker.indexOf("env.ASSETS.fetch(", originMatch);
  const databaseChecks = worker.indexOf(
    "ensureDatabaseInvariantsForRequest(env.DB",
  );
  assert.ok(originMatch >= 0);
  assert.ok(assetFetch > originMatch);
  assert.ok(databaseChecks > assetFetch);
  assert.match(
    vinextRunner,
    /if \(acceptExit\(vinextResult, "vinext"\) && action === "build"\) \{[\s\S]*?relocateWorkerOwnedAssetDirectories/u,
  );
  assert.doesNotMatch(
    vinextRunner,
    /action === "(?:dev|start)"[\s\S]*?relocateWorkerOwnedAssetDirectories/u,
  );
});

test("the build relocates Worker-owned directories and leaves other public assets asset-first", async (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "vcc-worker-assets-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  for (const directory of ["assets", "event-posters", "fonts"]) {
    mkdirSync(resolve(root, "dist", "client", directory), {
      recursive: true,
    });
  }
  writeFileSync(
    resolve(root, "dist", "client", "assets", "app-12345678.js"),
    "hashed asset",
  );
  writeFileSync(
    resolve(root, "dist", "client", "assets", "unhashed.js"),
    "unowned asset",
  );
  mkdirSync(
    resolve(root, "dist", "client", "assets", "_vinext_fonts"),
  );
  writeFileSync(
    resolve(
      root,
      "dist",
      "client",
      "assets",
      "_vinext_fonts",
      "font-12345678.woff2",
    ),
    "nested generated font",
  );
  writeFileSync(
    resolve(root, "dist", "client", "event-posters", "meetup-1.webp"),
    "poster",
  );
  writeFileSync(
    resolve(root, "dist", "client", "fonts", "fonts.txt"),
    "fonts",
  );
  writeFileSync(
    resolve(root, "dist", "client", "_headers"),
    "generated Pages metadata",
  );

  await relocateWorkerOwnedAssetDirectories(root);
  await relocateWorkerOwnedAssetDirectories(root);

  assert.equal(
    existsSync(
      resolve(root, "dist", "client", "assets", "app-12345678.js"),
    ),
    false,
  );
  assert.equal(
    existsSync(
      resolve(root, "dist", "client", "event-posters", "meetup-1.webp"),
    ),
    false,
  );
  assert.equal(
    readFileSync(
      resolve(
        root,
        "dist",
        "client",
        WORKER_ASSET_ORIGIN_PREFIX.slice(1),
        "assets",
        "app-12345678.js",
      ),
      "utf8",
    ),
    "hashed asset",
  );
  assert.equal(
    readFileSync(
      resolve(
        root,
        "dist",
        "client",
        WORKER_ASSET_ORIGIN_PREFIX.slice(1),
        "event-posters",
        "meetup-1.webp",
      ),
      "utf8",
    ),
    "poster",
  );
  assert.equal(
    readFileSync(
      resolve(root, "dist", "client", "assets", "unhashed.js"),
      "utf8",
    ),
    "unowned asset",
  );
  assert.equal(
    readFileSync(
      resolve(
        root,
        "dist",
        "client",
        "assets",
        "_vinext_fonts",
        "font-12345678.woff2",
      ),
      "utf8",
    ),
    "nested generated font",
  );
  assert.equal(
    readFileSync(
      resolve(root, "dist", "client", "fonts", "fonts.txt"),
      "utf8",
    ),
    "fonts",
  );
  assert.equal(existsSync(resolve(root, "dist", "client", "_headers")), false);
});

test("nonce-bearing public HTML is never placed in a shared response cache", () => {
  assert.doesNotMatch(worker, /s-maxage=/u);
  assert.match(worker, /createCspNonce\(\)/u);
  assert.match(
    worker,
    /requestWithSecurityContext\([\s\S]*?nonce[\s\S]*?secureResponse/u,
  );
});
