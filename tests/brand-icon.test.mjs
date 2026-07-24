import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

const pngAssets = [
  ["public/favicon-16.png", 16, 16],
  ["public/favicon-32.png", 32, 32],
  ["public/favicon-48.png", 48, 48],
  ["public/icon.png", 64, 64],
  ["public/apple-touch-icon.png", 180, 180],
  ["public/icon-192.png", 192, 192],
  ["public/icon-512.png", 512, 512],
  ["public/icon-maskable-512.png", 512, 512],
  ["public/og.png", 1200, 630],
];

test("the futuristic brand mark ships at every declared icon size", async () => {
  for (const [path, expectedWidth, expectedHeight] of pngAssets) {
    const url = new URL(path, projectRoot);
    const [bytes, details] = await Promise.all([readFile(url), stat(url)]);

    assert.ok(details.size > 100, `${path} must contain a real image`);
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      `${path} must be a PNG`,
    );
    assert.equal(bytes.readUInt32BE(16), expectedWidth, `${path} width`);
    assert.equal(bytes.readUInt32BE(20), expectedHeight, `${path} height`);
  }
});

test("metadata and the web manifest declare only real local brand assets", async () => {
  const [layout, manifestText] = await Promise.all([
    readFile(new URL("app/layout.tsx", projectRoot), "utf8"),
    readFile(new URL("public/site.webmanifest", projectRoot), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);

  for (const path of [
    "/favicon-16.png",
    "/favicon-32.png",
    "/favicon-48.png",
    "/icon.png",
    "/icon-192.png",
    "/apple-touch-icon.png",
    "/site.webmanifest",
    "/og.png",
  ]) {
    assert.match(layout, new RegExp(path.replace(".", "\\.")));
  }

  assert.equal(manifest.name, "Vancouver Curiosity Club");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#061a3a");
  assert.deepEqual(
    manifest.icons.map((icon) => [icon.src, icon.sizes, icon.purpose]),
    [
      ["/icon-192.png", "192x192", "any"],
      ["/icon-512.png", "512x512", "any"],
      ["/icon-maskable-512.png", "512x512", "maskable"],
    ],
  );
  assert.equal("screenshots" in manifest, false);
  assert.equal("shortcuts" in manifest, false);
});

test("preserves the master artwork outside the public build surface", async () => {
  const masterUrl = new URL(
    "design-assets/brand-icon-master.png",
    projectRoot,
  );
  const [bytes, details] = await Promise.all([
    readFile(masterUrl),
    stat(masterUrl),
  ]);

  assert.ok(details.size > 100_000, "the editable source artwork is preserved");
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    "the preserved source must remain a PNG",
  );
  await assert.rejects(
    stat(new URL("public/brand-icon-master.png", projectRoot)),
    (error) => error?.code === "ENOENT",
    "the unoptimized source must not ship from public/",
  );
});
