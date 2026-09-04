import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("the canonical community mark ships at every declared icon size", async () => {
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
  const [layout, manifestSource, brandSource, metadataSource] = await Promise.all([
    readFile(new URL("app/layout.tsx", projectRoot), "utf8"),
    readFile(new URL("app/manifest.ts", projectRoot), "utf8"),
    readFile(new URL("lib/brand.ts", projectRoot), "utf8"),
    readFile(new URL("lib/server/public/metadata.ts", projectRoot), "utf8"),
  ]);

  for (const path of [
    "/favicon-16.png",
    "/favicon-32.png",
    "/favicon-48.png",
    "/icon.png",
    "/icon-192.png",
    "/apple-touch-icon.png",
  ]) {
    assert.match(brandSource, new RegExp(path.replace(".", "\\.")));
  }
  assert.match(layout, /\/manifest\.webmanifest/u);
  assert.match(metadataSource, /"\/og\.png"/u);

  assert.match(manifestSource, /getPublicSiteContext/u);
  assert.match(manifestSource, /buildPublicManifest\(site, logo\)/u);
  assert.match(brandSource, /site\?\.brandName/u);
  assert.match(brandSource, /resolvePublicBrandPalette\(site\?\.palette\)/u);
  assert.match(brandSource, /palette\?\.background/u);
  assert.match(brandSource, /palette\?\.foreground/u);
  assert.match(brandSource, /display:\s*"standalone"/u);
  for (const icon of [
    "/icon-192.png",
    "/icon-512.png",
    "/icon-maskable-512.png",
  ]) {
    assert.match(brandSource, new RegExp(icon.replace(".", "\\.")));
  }
  assert.doesNotMatch(`${manifestSource}\n${brandSource}`, /screenshots|shortcuts/u);
});

test("preserves the canonical raster master outside the public build surface", async () => {
  const rasterMasterUrl = new URL(
    "design-assets/brand-icon-master.png",
    projectRoot,
  );
  const [bytes, details] = await Promise.all([
    readFile(rasterMasterUrl),
    stat(rasterMasterUrl),
  ]);

  assert.ok(details.size > 1_000, "the high-resolution raster master is preserved");
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    "the preserved source must remain a PNG",
  );
  assert.equal(bytes.readUInt32BE(16), 1_254, "master width");
  assert.equal(bytes.readUInt32BE(20), 1_254, "master height");
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "beabc5d3ad3cbc992e6bec6e46baf842a88e9cc8d24fe5c56a3993e9015c0ac0",
    "the canonical master must remain the approved open-circle artwork",
  );
  await assert.rejects(
    stat(new URL("public/brand-icon-master.png", projectRoot)),
    (error) => error?.code === "ENOENT",
    "the unoptimized source must not ship from public/",
  );
});

test("the deterministic generator reads the canonical PNG master", async () => {
  const generator = await readFile(
    new URL("scripts/generate-brand-artwork.mjs", projectRoot),
    "utf8",
  );
  assert.match(generator, /brand-icon-master\.png/u);
  assert.doesNotMatch(generator, /brand-icon-master\.svg/u);
});

test("every shipped brand image matches the deterministic generated artifact", async () => {
  const expectedHashes = new Map([
    ["public/favicon-16.png", "5f43fee8cfc19bd8b5291b003a58a45590eea29fc586950621121c3efa6ae87b"],
    ["public/favicon-32.png", "541599e06fd2941064307e9395b75cc559524b229816be3f5c566c0e3bb3f329"],
    ["public/favicon-48.png", "5edbc16d03c50d8ee03d3699b84a0c94f487b6727b4861cc85cfd62bc0dedbe7"],
    ["public/icon.png", "a88c302a484c5fbbe25881e6526f4cb3696c2aa91618754f3f3c9a8160d0a1a5"],
    ["public/apple-touch-icon.png", "e204f5e9fc3ab1e89b6baf9e9c584279a34d0caba30aafbe4102c3de0247edfd"],
    ["public/icon-192.png", "72184ad108ca0fa37b00cc562edb1d97739d080cd1a3af5667413381eb1ab5af"],
    ["public/icon-512.png", "e0db12974ac4c0a56ab424d2546e1a76427f8f0bc4bc90295d2d16d70ac54828"],
    ["public/icon-maskable-512.png", "9adca3d7fdfe45899fd959c4cebe97d4f8cb6541dca5086e9fe5abf9a38434fd"],
    ["public/og.png", "07bc91fa465b8976cf9eced27fa7cd806e738fd50d27238cee3ae47ccb8de195"],
  ]);
  assert.equal(expectedHashes.size, pngAssets.length);
  for (const [path] of pngAssets) {
    const bytes = await readFile(new URL(path, projectRoot));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      expectedHashes.get(path),
      `${path} content hash`,
    );
  }
});
