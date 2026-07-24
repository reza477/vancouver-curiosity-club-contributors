import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Log, LogLevel, Miniflare } from "miniflare";

const serverRoot = resolve("dist/server");
const moduleFiles = await collectJavaScriptModules(serverRoot);
const entrypoint = resolve(serverRoot, "index.js");
const runtime = new Miniflare({
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
await applyGeneratedMigrations();

test.after(async () => {
  await runtime.dispose();
});

async function fetchPath(path, init) {
  const headers = new Headers(init?.headers);
  headers.set("x-forwarded-host", "preview.example");
  headers.set("x-forwarded-proto", "https");
  return runtime.dispatchFetch(new URL(path, "https://preview.example"), {
    ...init,
    headers,
  });
}

test("the built worker renders Field Notes with absolute social metadata", async () => {
  const response = await fetchPath("/");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const policy = response.headers.get("content-security-policy") ?? "";
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /script-src [^;]*'strict-dynamic'/);
  assert.match(policy, /script-src-attr 'none'/);
  assert.doesNotMatch(policy, /script-src [^;]*'unsafe-inline'/);
  assert.doesNotMatch(policy, /script-src [^;]*'unsafe-eval'/);
  const nonceMatch = /'nonce-([A-Za-z0-9_-]{22})'/u.exec(policy);
  assert.ok(nonceMatch, "production CSP must contain a per-request nonce");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=31536000/);

  const html = await response.text();
  assert.match(html, /<title>Vancouver Curiosity Club<\/title>/i);
  assert.match(html, /A social calendar with a brain\./);
  assert.match(html, /never placeholder events/i);
  assert.match(html, /Open the public calendar/i);
  assert.match(html, /name="robots" content="noindex, nofollow"/i);
  assert.match(html, /property="og:image" content="https:\/\/preview\.example\/og\.png"/i);
  assert.match(html, /name="twitter:image:alt"/i);
  assert.doesNotMatch(html, /SkeletonPreview|Your site is taking shape|react-loading-skeleton/);
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
});

test("built calendar and brand surfaces render an honest empty connection", async () => {
  const calendarResponse = await fetchPath("/calendar");
  assert.equal(calendarResponse.status, 200);
  assert.match(
    calendarResponse.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await calendarResponse.text();
  assert.match(html, /No official calendar feed is connected yet\./i);
  assert.match(html, /No source is connected\./i);
  assert.match(html, /one connected official feed when viewed/i);
  assert.doesNotMatch(html, /meetup\.com\/[^<" ]+\/events\/ical/iu);
  assert.doesNotMatch(html, /RSVP on Meetup/i);

  const iconResponse = await fetchPath("/icon.png");
  assert.equal(iconResponse.status, 200);
  assert.match(iconResponse.headers.get("content-type") ?? "", /image\/png/i);
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
});

test("the built client excludes unoptimized brand source artwork", async () => {
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
    response.status === 302 || response.status === 303 || response.status === 307,
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

test("signed-out private API responses are safe, private, and noindexed", async () => {
  const response = await fetchPath("/api/organizer/session", {
    headers: { accept: "application/json" },
  });

  assert.equal(response.status, 401);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
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

  assert.match(policy, /script-src [^;]*'unsafe-inline'/);
  assert.match(policy, /script-src [^;]*'unsafe-eval'/);
  assert.doesNotMatch(policy, /'nonce-/u);
});

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

async function applyGeneratedMigrations() {
  const database = await runtime.getD1Database("DB");
  const migrationDirectory = resolve("drizzle");
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort();
  for (const file of migrationFiles) {
    const sql = await readFile(join(migrationDirectory, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim().length > 0) {
        await database.prepare(statement).run();
      }
    }
  }
}
