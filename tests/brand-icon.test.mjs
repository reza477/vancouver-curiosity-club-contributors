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
    "c2ead95f3d8928caadfa398006f80ee22cd40a086b546416c919e388c7fee879",
    "the vector geometry is intentional and reviewable",
  );
  assert.match(vector, /Curiosity Prism/u);
  for (const color of ["#131C33", "#B8402B", "#F3EBDD", "#1F5F5B"]) {
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
    ["public/favicon-16.png", "942750aea74a31d9d5484177ff55554908907c6c5b0eb56c16dde5a4d63d8952"],
    ["public/favicon-32.png", "66c653c4950d5429851c78475f5eddeb5457b2832a96ca7ba4a5439037b9fe86"],
    ["public/favicon-48.png", "a52eb95ff517a45f96b99f7bb62fb9936c7589e9653724329689012487064a6c"],
    ["public/icon.png", "a092b37d7850629dc2afcd018376acf60f00c9bd73bb71599bfc1076127bb375"],
    ["public/apple-touch-icon.png", "f7b55062acd4fa41d4993d6d34e8c6266e929d968a031c806b3d47564425433c"],
    ["public/icon-192.png", "31b77a200e663789eb5e5cf8524fe243adc88763cbc666cb0a71431eac1059f2"],
    ["public/icon-512.png", "578d6f52495e884b019127607d163d5198eb7f9e85661bd9e6561236bc524798"],
    ["public/icon-maskable-512.png", "8177cde8f381ca854fcec913fc956fa682114dd0c7ccdb557784fccc17b1b9e6"],
    ["public/og.png", "edc0421a4137dd0de191e52fe6774677d821287ba6c789e8bbfc27a4f5a792db"],
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
