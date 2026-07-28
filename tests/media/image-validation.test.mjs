import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_MEDIA_ORIGINAL_BYTES,
  validateMediaUploadBundle,
  validateOriginalImage,
} from "../../lib/server/media/image-validation.ts";
import { jpegBytes, pngBytes, webpBytes } from "./image-fixtures.mjs";

test("JPEG, PNG, and WebP signatures and dimensions are validated", async () => {
  const jpeg = await validateOriginalImage({
    bytes: jpegBytes(1200, 800),
    declaredMimeType: "image/jpeg",
    fileName: "field-notes.jpg",
  });
  assert.equal(jpeg.width, 1200);
  assert.equal(jpeg.height, 800);
  assert.equal(jpeg.mimeType, "image/jpeg");
  assert.equal(jpeg.sha256.length, 64);

  const png = await validateOriginalImage({
    bytes: pngBytes(1600, 900),
    declaredMimeType: "image/png",
    fileName: "field-notes.png",
  });
  assert.equal(png.width, 1600);
  assert.equal(png.height, 900);

  const webp = await validateOriginalImage({
    bytes: webpBytes(960, 540),
    declaredMimeType: "image/webp",
    fileName: "field-notes.webp",
  });
  assert.equal(webp.width, 960);
  assert.equal(webp.height, 540);
});

test("filename, declared MIME, magic bytes, unsupported SVG, and executable payloads fail closed", async () => {
  await assert.rejects(
    validateOriginalImage({
      bytes: pngBytes(120, 80),
      declaredMimeType: "image/jpeg",
      fileName: "mismatch.jpg",
    }),
    /validated/u,
  );
  await assert.rejects(
    validateOriginalImage({
      bytes: pngBytes(120, 80),
      declaredMimeType: "image/png",
      fileName: "mismatch.webp",
    }),
    /validated/u,
  );
  await assert.rejects(
    validateOriginalImage({
      bytes: new TextEncoder().encode("<svg><script/></svg>"),
      declaredMimeType: "image/svg+xml",
      fileName: "unsafe.svg",
    }),
    /validated/u,
  );
  await assert.rejects(
    validateOriginalImage({
      bytes: new TextEncoder().encode("MZ executable payload"),
      declaredMimeType: "image/png",
      fileName: "unsafe.png",
    }),
    /validated/u,
  );
});

test("original byte, dimension, and decoded-pixel limits are enforced", async () => {
  await assert.rejects(
    validateOriginalImage({
      bytes: new Uint8Array(MAX_MEDIA_ORIGINAL_BYTES + 1),
      declaredMimeType: "image/png",
      fileName: "oversize.png",
    }),
    /validated/u,
  );
  await assert.rejects(
    validateOriginalImage({
      bytes: pngBytes(8001, 1),
      declaredMimeType: "image/png",
      fileName: "wide.png",
    }),
    /validated/u,
  );
  await assert.rejects(
    validateOriginalImage({
      bytes: pngBytes(5000, 5000),
      declaredMimeType: "image/png",
      fileName: "pixels.png",
    }),
    /validated/u,
  );
});

test("responsive bundle requires validated 480, 960, and 1600 WebP variants with matching aspect ratio", async () => {
  const bundle = await validateMediaUploadBundle({
    original: {
      bytes: pngBytes(1600, 900),
      declaredMimeType: "image/png",
      fileName: "original.png",
    },
    variants: {
      webp_480: webpPart(480, 270),
      webp_960: webpPart(960, 540),
      webp_1600: webpPart(1600, 900),
    },
  });
  assert.equal(bundle.variants.webp_480.mimeType, "image/webp");
  assert.equal(bundle.variants.webp_1600.width, 1600);

  await assert.rejects(
    validateMediaUploadBundle({
      original: {
        bytes: pngBytes(1600, 900),
        declaredMimeType: "image/png",
        fileName: "original.png",
      },
      variants: {
        webp_480: webpPart(480, 300),
        webp_960: webpPart(960, 540),
        webp_1600: webpPart(1600, 900),
      },
    }),
    /validated/u,
  );
});

test("truncated, CRC-corrupt, trailing polyglot, and decode-probe failures are rejected", async () => {
  const validPng = pngBytes(1600, 900);
  await assert.rejects(
    validateOriginalImage({
      bytes: validPng.slice(0, -1),
      declaredMimeType: "image/png",
      fileName: "truncated.png",
    }),
    /validated/u,
  );
  const corruptPng = validPng.slice();
  corruptPng[corruptPng.length - 1] ^= 0xff;
  await assert.rejects(
    validateOriginalImage({
      bytes: corruptPng,
      declaredMimeType: "image/png",
      fileName: "corrupt.png",
    }),
    /validated/u,
  );
  const polyglot = new Uint8Array(validPng.byteLength + 8);
  polyglot.set(validPng);
  polyglot.set(new TextEncoder().encode("<script>"), validPng.byteLength);
  await assert.rejects(
    validateOriginalImage({
      bytes: polyglot,
      declaredMimeType: "image/png",
      fileName: "polyglot.png",
    }),
    /validated/u,
  );
  await assert.rejects(
    validateMediaUploadBundle(
      {
        original: {
          bytes: validPng,
          declaredMimeType: "image/png",
          fileName: "original.png",
        },
        variants: {
          webp_480: webpPart(480, 270),
          webp_960: webpPart(960, 540),
          webp_1600: webpPart(1600, 900),
        },
      },
      async () => {
        throw new Error("decoder_rejected");
      },
    ),
    /decoder_rejected/u,
  );
});

test("a real decoder accepts complete oriented originals and exact responsive WebP relationships", async () => {
  const { default: sharp } = await import("sharp");
  const original = await sharp({
    create: {
      background: { alpha: 1, b: 45, g: 92, r: 18 },
      channels: 4,
      height: 800,
      width: 1200,
    },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const oriented = sharp(original).autoOrient();
  const variant480 = await oriented
    .clone()
    .resize({ width: 480, withoutEnlargement: true })
    .webp()
    .toBuffer();
  const variant960 = await oriented
    .clone()
    .resize({ width: 960, withoutEnlargement: true })
    .webp()
    .toBuffer();
  const variant1600 = await oriented
    .clone()
    .resize({ width: 1600, withoutEnlargement: true })
    .webp()
    .toBuffer();
  const decodeProbe = async ({ bytes }) => {
    await sharp(bytes).resize({ width: 1, height: 1, fit: "fill" }).webp().toBuffer();
  };
  const bundle = await validateMediaUploadBundle(
    {
      original: {
        bytes: original,
        declaredMimeType: "image/jpeg",
        fileName: "oriented.jpeg",
      },
      variants: {
        webp_480: {
          bytes: variant480,
          declaredMimeType: "image/webp",
          fileName: "480.webp",
        },
        webp_960: {
          bytes: variant960,
          declaredMimeType: "image/webp",
          fileName: "960.webp",
        },
        webp_1600: {
          bytes: variant1600,
          declaredMimeType: "image/webp",
          fileName: "1600.webp",
        },
      },
    },
    decodeProbe,
  );
  assert.equal(bundle.original.orientation, 6);
  assert.equal(bundle.original.displayWidth, 800);
  assert.equal(bundle.original.displayHeight, 1200);
  assert.deepEqual(
    [
      bundle.variants.webp_480.width,
      bundle.variants.webp_960.width,
      bundle.variants.webp_1600.width,
    ],
    [480, 800, 800],
  );
  assert.deepEqual(
    [
      bundle.variants.webp_480.height,
      bundle.variants.webp_960.height,
      bundle.variants.webp_1600.height,
    ],
    [720, 1200, 1200],
  );
});

function webpPart(width, height) {
  return {
    bytes: webpBytes(width, height),
    declaredMimeType: "image/webp",
    fileName: `${width}.webp`,
  };
}
