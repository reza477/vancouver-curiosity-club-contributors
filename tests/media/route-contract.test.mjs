import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("public media route revalidates mutable rights/usage on every stable URL request", () => {
  const source = readFileSync(
    join(process.cwd(), "app", "media", "[id]", "[variant]", "route.ts"),
    "utf8",
  );
  assert.match(source, /getPublicMediaVariant/u);
  assert.match(source, /public, max-age=0, must-revalidate/u);
  assert.doesNotMatch(source, /immutable/u);
  assert.match(source, /X-Content-Type-Options/u);
  assert.match(source, /ETag/u);
  assert.doesNotMatch(source, /objectKey|object_key/u);
});

test("private media routes remain authenticated, no-store, noindex, and never serialize R2 keys", () => {
  const route = readFileSync(
    join(
      process.cwd(),
      "app",
      "api",
      "organizer",
      "media",
      "[id]",
      "variants",
      "[variant]",
      "route.ts",
    ),
    "utf8",
  );
  assert.match(route, /assertTrustedOrganizerRead\(request\)/u);
  assert.match(route, /requireOrganizerApiActor/u);
  assert.match(route, /private, no-store/u);
  assert.match(route, /noindex, nofollow, noarchive/u);
  assert.doesNotMatch(route, /objectKey|object_key/u);
});

test("upload route uses bounded same-origin multipart validation and runtime decode/R2 bindings", () => {
  const route = readFileSync(
    join(
      process.cwd(),
      "app",
      "api",
      "organizer",
      "media",
      "route.ts",
    ),
    "utf8",
  );
  assert.match(route, /readMediaUploadRequest/u);
  assert.match(route, /getRuntimeMediaDecodeProbe/u);
  assert.match(route, /getRuntimeMediaBucket/u);
  assert.match(route, /"owner",\s*"administrator"/u);
  assert.doesNotMatch(route, /organizer"\]/u);
});

test("rights-bearing media list surfaces finish with the sealed asset read", () => {
  for (const path of [
    ["app", "api", "organizer", "media", "route.ts"],
    ["app", "organizer", "media", "page.tsx"],
  ]) {
    const source = readFileSync(join(process.cwd(), ...path), "utf8");
    const cleanupRead = source.indexOf("await listPendingMediaCleanups");
    const sealedAssetRead = source.indexOf("await listMediaAssets");
    assert.notEqual(cleanupRead, -1, path.join("/"));
    assert.notEqual(sealedAssetRead, -1, path.join("/"));
    assert.ok(cleanupRead < sealedAssetRead, path.join("/"));
    assert.doesNotMatch(
      source.slice(cleanupRead, sealedAssetRead),
      /Promise\.all/u,
      path.join("/"),
    );
  }
});

test("private media UI keeps failed R2 cleanup durably actionable without exposing keys", () => {
  const library = readFileSync(
    join(process.cwd(), "app", "_organizer", "MediaLibrary.tsx"),
    "utf8",
  );
  const page = readFileSync(
    join(process.cwd(), "app", "organizer", "media", "page.tsx"),
    "utf8",
  );
  assert.match(page, /listPendingMediaCleanups/u);
  assert.match(library, /Stored-file cleanup pending/u);
  assert.match(library, /Retry stored-file cleanup/u);
  assert.match(library, /\/cleanup/u);
  assert.doesNotMatch(library, /objectKey|object_key/u);
});

test("metadata route returns bounded actionable blockers for published media usages", () => {
  const route = readFileSync(
    join(
      process.cwd(),
      "app",
      "api",
      "organizer",
      "media",
      "[id]",
      "route.ts",
    ),
    "utf8",
  );
  assert.match(route, /MediaAssetPublishedUseError/u);
  assert.match(route, /blockers: error\.blockers/u);
  assert.match(route, /hasMoreBlockers/u);
});
