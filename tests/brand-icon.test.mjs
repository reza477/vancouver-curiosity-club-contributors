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

test("the supplied community mark ships at every declared icon size", async () => {
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

test("preserves the supplied raster master outside the public build surface", async () => {
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
    "9d662fb4829fe263ee5195308d600515f2581d4c014d93a0f8aaca623243ead5",
    "the canonical master must remain the exact owner-supplied artwork",
  );
  await assert.rejects(
    stat(new URL("public/brand-icon-master.png", projectRoot)),
    (error) => error?.code === "ENOENT",
    "the unoptimized source must not ship from public/",
  );
});

test("the deterministic generator reads the supplied PNG master", async () => {
  const generator = await readFile(
    new URL("scripts/generate-brand-artwork.mjs", projectRoot),
    "utf8",
  );
  assert.match(generator, /brand-icon-master\.png/u);
  assert.doesNotMatch(generator, /brand-icon-master\.svg/u);
});

test("every shipped brand image matches the deterministic generated artifact", async () => {
  const expectedHashes = new Map([
    ["public/favicon-16.png", "567a34a33b6648aa30693ec5bd7c1edc09c847357dcaaef7d33f2a9aa548f300"],
    ["public/favicon-32.png", "655b4c13d82da9bf0a8f1e3cf0f80ae9bc14932ed69a052629b807e6b5ad980f"],
    ["public/favicon-48.png", "fa52759de42ca0b45979bf18c777c975588e0bf397010506532e32cefe7c9871"],
    ["public/icon.png", "acefd798589c03475feae4794e3b8fc67a0ebfe9c64530562bd12029475e1928"],
    ["public/apple-touch-icon.png", "d9151bd9b3bfb0d01b6828421d0e84738875c4d0282ca245e22f78ef52d64284"],
    ["public/icon-192.png", "4126e23edcfa91461280e2142d7517db7fbbe0b50833b96b97cfc5124407f6c1"],
    ["public/icon-512.png", "1e300a057cbd03db343a85f099a606f71432eb67266ff3829da87c8137bd1b77"],
    ["public/icon-maskable-512.png", "a5823c055de663a9ad11c230000fc177df07667752893cee690446d55e476168"],
    ["public/og.png", "ae2b0a99e89f15c4a479d96292bf168b245a8e85bd94a2366ba0fbaddf3810cd"],
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
