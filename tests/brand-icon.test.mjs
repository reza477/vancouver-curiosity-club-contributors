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
  assert.match(brandSource, /site\?\.palette\?\.background/u);
  assert.match(brandSource, /site\?\.palette\?\.foreground/u);
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
    "b6e67df604fca185022da09aaa6dcf59acea6baf8c8ace79960da331724ac5da",
    "the vector geometry is intentional and reviewable",
  );
  assert.match(vector, /Curiosity Prism/u);
  for (const color of ["#071B31", "#2156D8", "#E85B48", "#0C665E"]) {
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
    ["public/favicon-16.png", "e1e8960b362dc05ad84a03d4e02260d4157a71f4c8918bc2f5fcce730fc280ba"],
    ["public/favicon-32.png", "9c9cc743270b42aa303ae9a252b95bc69853486b150ec3d1c1674a4373f755ac"],
    ["public/favicon-48.png", "a4048a13510914e8568bea5ba1f0399cd53eb757069b12ee25eaafa018cdc648"],
    ["public/icon.png", "70e8e7638692b719a998c679a6e9176ac120555f52f9ace145d9194ba4d202a6"],
    ["public/apple-touch-icon.png", "54ac9f1fcc724a747f04d8e71c92b27a4688eb0679abc9410f9b1d4ced101991"],
    ["public/icon-192.png", "f13e2c3a68513eb262aec969924035064ea3cd97a325890ac2f4f83a4932a645"],
    ["public/icon-512.png", "6b3b60a5a9082348b46592ab5a545ab42c16ab9b44213a42a2d7ed71e4eb864c"],
    ["public/icon-maskable-512.png", "3f87ef5ba64bde3b7a03156e610df14175e4a1e6aaae666206087c3b0ae3d018"],
    ["public/og.png", "7285a22a9d3790dd04174c24c9278c78edccbe1f2f9f2153a2df5cb9160e6324"],
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
