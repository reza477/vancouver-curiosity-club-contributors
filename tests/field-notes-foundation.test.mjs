import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("Field Notes replaces the starter with an honest Phase 1 foundation", async () => {
  const [page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/layout.tsx", projectRoot), "utf8"),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
    readFile(new URL("package.json", projectRoot), "utf8"),
  ]);

  assert.match(page, /Vancouver Curiosity Club/);
  assert.match(page, /A social calendar with a brain\./);
  assert.match(page, /never placeholder events/i);
  assert.match(
    page,
    /Public events appear only when a verified source provides them\./,
  );
  assert.match(page, /Open the public calendar/);
  assert.match(page, /Skip to main content/);
  assert.match(page, /<main id="main-content">/);
  assert.match(page, /aria-label="Primary navigation"/);
  assert.match(page, /Organizer portal/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /index:\s*false/);
  assert.match(layout, /follow:\s*false/);
  assert.match(layout, /\/og\.png/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(packageJson, /"name": "vancouver-curiosity-club"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);

  assert.deepEqual(
    await readdir(new URL("app/_sites-preview", projectRoot)),
    [],
    "the disposable starter preview directory must remain empty",
  );
});

test("social assets are local PNGs with the expected dimensions", async () => {
  const assets = [
    ["public/og.png", 1200, 630],
    ["public/icon.png", 64, 64],
    ["public/apple-touch-icon.png", 180, 180],
  ];

  for (const [path, expectedWidth, expectedHeight] of assets) {
    const url = new URL(path, projectRoot);
    const [bytes, details] = await Promise.all([readFile(url), stat(url)]);

    assert.ok(details.size > 0, `${path} must not be empty`);
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      `${path} must be a PNG`,
    );
    assert.equal(bytes.readUInt32BE(16), expectedWidth, `${path} width`);
    assert.equal(bytes.readUInt32BE(20), expectedHeight, `${path} height`);
  }
});

test("the worker applies a security and noindex header foundation", async () => {
  const worker = await readFile(new URL("worker/index.ts", projectRoot), "utf8");

  assert.match(worker, /Content-Security-Policy/);
  assert.match(worker, /frame-ancestors 'none'/);
  assert.match(worker, /object-src 'none'/);
  assert.match(worker, /X-Content-Type-Options/);
  assert.match(worker, /X-Frame-Options/);
  assert.match(worker, /Permissions-Policy/);
  assert.match(worker, /Strict-Transport-Security/);
  assert.match(worker, /X-Robots-Tag/);
  assert.match(worker, /"\/organizer"/);
  assert.match(worker, /"\/api\/organizer"/);
});
