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

test("the Curiosity Prism ships at every declared icon size", async () => {
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

test("preserves the master artwork outside the public build surface", async () => {
  const rasterMasterUrl = new URL(
    "design-assets/brand-icon-master.png",
    projectRoot,
  );
  const vectorMasterUrl = new URL(
    "design-assets/brand-icon-master.svg",
    projectRoot,
  );
  const [bytes, details, vector] = await Promise.all([
    readFile(rasterMasterUrl),
    stat(rasterMasterUrl),
    readFile(vectorMasterUrl, "utf8"),
  ]);

  assert.ok(details.size > 1_000, "the high-resolution raster master is preserved");
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    "the preserved source must remain a PNG",
  );
  assert.equal(bytes.readUInt32BE(16), 2_048, "master width");
  assert.equal(bytes.readUInt32BE(20), 2_048, "master height");
  assert.equal(
    createHash("sha256").update(vector).digest("hex"),
    "4e2221998dbfa48971db7bb8215a816b1b6165927254d07db3b85751969f669d",
    "the vector geometry is intentional and reviewable",
  );
  assert.match(vector, /Curiosity Prism/u);
  for (const color of ["#221C3D", "#5B2CC9", "#FF7867", "#2457D6"]) {
    assert.match(vector, new RegExp(color, "u"));
  }
  assert.doesNotMatch(vector, /<script|<image|filter=|linearGradient|radialGradient/iu);
  await assert.rejects(
    stat(new URL("public/brand-icon-master.png", projectRoot)),
    (error) => error?.code === "ENOENT",
    "the unoptimized source must not ship from public/",
  );
  await assert.rejects(
    stat(new URL("public/brand-icon-master.svg", projectRoot)),
    (error) => error?.code === "ENOENT",
    "the vector source must not ship from public/",
  );
});

test("every shipped brand image matches the deterministic generated artifact", async () => {
  const expectedHashes = new Map([
    ["public/favicon-16.png", "949f9130118e3bd22e12e635c23ddf092e9cd8d925a9d26cb91ea202444e19a1"],
    ["public/favicon-32.png", "8994aa9bc1a0b1a41f92802133764282599d545472cd0adcab6635d218c42c64"],
    ["public/favicon-48.png", "dc85003bb5bdc084ee13dcc4265e5cc5f88b1d62f5fdeb180becc500392c87ad"],
    ["public/icon.png", "bbe376ccf4198ac44a40a8524d46b47e20737b911ade11bbf1b23d18e3e95566"],
    ["public/apple-touch-icon.png", "1e59ae4b9258a66e59ef89d1882f8ae782b5397b82abd36ceb6fb15059c7ad0f"],
    ["public/icon-192.png", "13d6427dcbb03800c3b94c06a8673399729f9e5a5d4241824779b7710d1f762e"],
    ["public/icon-512.png", "7d8d85f7f9e2512e60c721d83baa13942c85c974a788b7203df244f374f5f313"],
    ["public/icon-maskable-512.png", "66037918ca434ce59de51580b55b34fb9f0a2ca75ce2caf1da80b766cfa08baa"],
    ["public/og.png", "a099e9cf7bad5ff914a943da46f6e0c49e2564df7ca3dd05bfc147e546602880"],
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
