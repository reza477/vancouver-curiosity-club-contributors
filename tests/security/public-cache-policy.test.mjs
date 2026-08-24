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
  PUBLIC_FONT_CACHE_CONTROL,
  WORKER_ASSET_ORIGIN_PREFIX,
  publicAssetCacheControl,
  publicAssetContentType,
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
      pathname: "/_next/static/css/public-rsc.DBNOtGQ1.css",
      status: 304,
    }),
    HASHED_ASSET_CACHE_CONTROL,
  );
  assert.equal(
    publicAssetCacheControl({
      method: "GET",
      pathname: "/_next/static/media/cover.4Fj0aBcD.webp",
      status: 200,
    }),
    HASHED_ASSET_CACHE_CONTROL,
  );
  assert.equal(
    publicAssetCacheControl({
      method: "GET",
      pathname:
        "/_next/static/_vinext_fonts/geist-8ac0455e797f/geist-001175b1.woff2",
      status: 200,
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

test("flat public fonts receive bounded caching and exact MIME types", () => {
  for (const method of ["GET", "HEAD"]) {
    const cacheControl = publicAssetCacheControl({
      method,
      pathname: "/fonts/inter-latin-400-700.woff2",
      status: 200,
    });
    assert.equal(cacheControl, PUBLIC_FONT_CACHE_CONTROL);
    assert.doesNotMatch(cacheControl, /immutable|stale-while-revalidate/u);
  }
  assert.equal(
    publicAssetCacheControl({
      method: "GET",
      pathname: "/fonts/inter-latin-400-700.woff2",
      status: 304,
    }),
    PUBLIC_FONT_CACHE_CONTROL,
  );
  for (const input of [
    { method: "POST", pathname: "/fonts/inter.woff2", status: 200 },
    { method: "GET", pathname: "/fonts/inter.woff", status: 200 },
    { method: "GET", pathname: "/fonts/nested/inter.woff2", status: 200 },
    { method: "GET", pathname: `/fonts/${"x".repeat(181)}.woff2`, status: 200 },
    { method: "GET", pathname: "/fonts/inter.woff2", status: 404 },
  ]) {
    assert.equal(publicAssetCacheControl(input), null);
  }

  assert.equal(
    publicAssetContentType("/event-posters/meetup-1.avif"),
    "image/avif",
  );
  assert.equal(
    publicAssetContentType("/event-posters/meetup-1.webp"),
    "image/webp",
  );
  assert.equal(
    publicAssetContentType("/event-posters/meetup-1.jpeg"),
    "image/jpeg",
  );
  assert.equal(
    publicAssetContentType("/fonts/inter-latin-400-700.woff2"),
    "font/woff2",
  );
  assert.equal(publicAssetContentType("/fonts/inter.woff"), null);
  assert.equal(publicAssetContentType("/event-posters/nested/a.webp"), null);
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
    assert.equal(
      publicAssetOriginPath({
        method,
        pathname: "/_next/static/chunks/framework-JGc2HF7T.js",
      }),
      `${WORKER_ASSET_ORIGIN_PREFIX}/_next/static/chunks/framework-JGc2HF7T.js`,
    );
    assert.equal(
      publicAssetOriginPath({
        method,
        pathname: "/fonts/inter-latin-400-700.woff2",
      }),
      `${WORKER_ASSET_ORIGIN_PREFIX}/fonts/inter-latin-400-700.woff2`,
    );
  }

  for (const input of [
    { method: "POST", pathname: "/assets/framework-12345678.js" },
    { method: "GET", pathname: "/assets/unhashed.js" },
    { method: "GET", pathname: "/event-posters/nested/poster.webp" },
    { method: "GET", pathname: "/fonts/inter.woff" },
    { method: "GET", pathname: "/fonts/nested/inter.woff2" },
    { method: "GET", pathname: "/_next/static/../server/index.js" },
    { method: "GET", pathname: "/_next/static/chunks/" },
    { method: "GET", pathname: "/_next/static/chunks/no-extension" },
    { method: "GET", pathname: "/_next/static/chunks/unhashed.js" },
    { method: "GET", pathname: "/_next/static/chunks/app.js.map" },
    { method: "GET", pathname: "/_next/static/chunks/private.html" },
    { method: "GET", pathname: "/_next/static/.vite/manifest.json" },
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
    resolve(root, "dist", "client", "fonts", "inter.woff2"),
    "font",
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
  assert.equal(
    existsSync(resolve(root, "dist", "client", "fonts", "inter.woff2")),
    false,
  );
  assert.equal(
    readFileSync(
      resolve(
        root,
        "dist",
        "client",
        WORKER_ASSET_ORIGIN_PREFIX.slice(1),
        "fonts",
        "inter.woff2",
      ),
      "utf8",
    ),
    "font",
  );
  assert.equal(existsSync(resolve(root, "dist", "client", "_headers")), false);
});

test("the build accepts Vinext's _next/static output when the legacy assets directory is absent", async (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "vcc-worker-next-assets-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(
    resolve(root, "dist", "client", "_next", "static", "chunks"),
    { recursive: true },
  );
  mkdirSync(resolve(root, "dist", "client", "_next", "static", "css"), {
    recursive: true,
  });
  mkdirSync(
    resolve(
      root,
      "dist",
      "client",
      "_next",
      "static",
      "_vinext_fonts",
      "geist-8ac0455e797f",
    ),
    { recursive: true },
  );
  mkdirSync(
    resolve(
      root,
      "dist",
      "client",
      "_next",
      "static",
      "401960e8-5c0f-4266-8961-d67b3817cf00",
    ),
    { recursive: true },
  );
  mkdirSync(resolve(root, "dist", "client", "event-posters"), {
    recursive: true,
  });
  writeFileSync(
    resolve(
      root,
      "dist",
      "client",
      "_next",
      "static",
      "chunks",
      "framework-JGc2HF7T.js",
    ),
    "vinext client asset",
  );
  const additionalStaticFiles = [
    ["css", "public-rsc.DBNOtGQ1.css"],
    ["_vinext_fonts/geist-8ac0455e797f", "geist-001175b1.woff2"],
    ["401960e8-5c0f-4266-8961-d67b3817cf00", "_buildManifest.js"],
    ["401960e8-5c0f-4266-8961-d67b3817cf00", "_ssgManifest.js"],
  ];
  for (const [directory, name] of additionalStaticFiles) {
    writeFileSync(
      resolve(root, "dist", "client", "_next", "static", directory, name),
      `${directory}/${name}`,
    );
  }
  writeFileSync(
    resolve(root, "dist", "client", "event-posters", "meetup-1.webp"),
    "poster",
  );

  await relocateWorkerOwnedAssetDirectories(root);
  await relocateWorkerOwnedAssetDirectories(root);

  const publicAssetPath = resolve(
    root,
    "dist",
    "client",
    "_next",
    "static",
    "chunks",
    "framework-JGc2HF7T.js",
  );
  const internalAssetPath = resolve(
    root,
    "dist",
    "client",
    WORKER_ASSET_ORIGIN_PREFIX.slice(1),
    "_next",
    "static",
    "chunks",
    "framework-JGc2HF7T.js",
  );
  assert.equal(existsSync(publicAssetPath), false);
  assert.equal(readFileSync(internalAssetPath, "utf8"), "vinext client asset");
  for (const [directory, name] of additionalStaticFiles) {
    const publicPath = resolve(
      root,
      "dist",
      "client",
      "_next",
      "static",
      directory,
      name,
    );
    const internalPath = resolve(
      root,
      "dist",
      "client",
      WORKER_ASSET_ORIGIN_PREFIX.slice(1),
      "_next",
      "static",
      directory,
      name,
    );
    assert.equal(existsSync(publicPath), false);
    assert.equal(readFileSync(internalPath, "utf8"), `${directory}/${name}`);
  }
});

test("nonce-bearing public HTML is never placed in a shared response cache", () => {
  assert.doesNotMatch(worker, /s-maxage=/u);
  assert.match(worker, /createCspNonce\(\)/u);
  assert.match(
    worker,
    /requestWithSecurityContext\([\s\S]*?nonce[\s\S]*?secureResponse/u,
  );
});
