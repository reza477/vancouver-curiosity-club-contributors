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
    "679b1693a079258e9263cb37e8feb04896cd6779ad1b87b10d81a3c0579cea1e",
    "the canonical master must remain the approved magnet-C artwork",
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
  assert.match(generator, /\.flatten\(\{ background: white \}\)/u);
  assert.doesNotMatch(generator, /\.trim\(/u);
});

test("every shipped brand image matches the deterministic generated artifact", async () => {
  const expectedHashes = new Map([
    ["public/favicon-16.png", "bf5d2bf7ccd84040f061a0aa7c940c74d015c013722afed6d9b3305f9e09600f"],
    ["public/favicon-32.png", "ffbf5de77b0bde66f396dfdf5e8b4c859594de6bfd6452f5419d683dc48dbe2f"],
    ["public/favicon-48.png", "387b0f79e415877531e794883c1e50940685eebc5bf7b8dc67d14794e1031942"],
    ["public/icon.png", "baf7df8893a1380999055c7c458cb8a19e17af12c5092f00662f61f6bf99f4dc"],
    ["public/apple-touch-icon.png", "5e201e72beb8f834b2c846cb280cf79428cfc9f86979816ffb34bd0753cca71a"],
    ["public/icon-192.png", "b22422d16b3238b43fe822e714c16bd5140e3c5dbef6370cfdc8b55b10694776"],
    ["public/icon-512.png", "51fb3b5325836ed59491363d75a48b01d7099a3035bb326d3443bda257288cbf"],
    ["public/icon-maskable-512.png", "671fe9e31b42e71e401584969d12623d146c24566ac61f99b24a69d8f53b67ee"],
    ["public/og.png", "228cfc491f92b9fa233b8622a247884db6083484148cc35be8bb3ca868876f73"],
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
