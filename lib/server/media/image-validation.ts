import {
  parseBoundedString,
  validationIssue,
} from "../../validation";

export const MEDIA_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type MediaImageMimeType = (typeof MEDIA_IMAGE_MIME_TYPES)[number];

export const MAX_MEDIA_ORIGINAL_BYTES = 8 * 1024 * 1024;
export const MAX_MEDIA_DIMENSION = 8_000;
export const MAX_MEDIA_PIXELS = 20_000_000;
export const MEDIA_VARIANT_WIDTHS = [480, 960, 1_600] as const;

export type ValidatedImage = Readonly<{
  bytes: Uint8Array;
  displayHeight: number;
  displayWidth: number;
  height: number;
  mimeType: MediaImageMimeType;
  orientation: number;
  sha256: string;
  width: number;
}>;

export type MediaUploadBundle = Readonly<{
  original: ValidatedImage;
  variants: Readonly<{
    webp_480: ValidatedImage;
    webp_960: ValidatedImage;
    webp_1600: ValidatedImage;
  }>;
}>;

export type MediaImageDecodeProbe = (
  image: Readonly<{
    bytes: Uint8Array;
    mimeType: MediaImageMimeType;
  }>,
) => Promise<void>;

type ImageUploadPart = Readonly<{
  bytes: ArrayBuffer | Uint8Array;
  declaredMimeType: unknown;
  fileName: unknown;
}>;

export async function validateOriginalImage(
  part: ImageUploadPart,
): Promise<ValidatedImage> {
  const validated = await validateImagePart(part, {
    maxBytes: MAX_MEDIA_ORIGINAL_BYTES,
    path: "original",
  });
  if (
    validated.displayWidth > MAX_MEDIA_DIMENSION ||
    validated.displayHeight > MAX_MEDIA_DIMENSION ||
    validated.displayWidth * validated.displayHeight > MAX_MEDIA_PIXELS
  ) {
    throw validationIssue(
      "original",
      "image_dimensions_exceeded",
      "The image dimensions exceed the supported limit.",
    );
  }
  return validated;
}

export async function validateMediaUploadBundle(input: Readonly<{
  original: ImageUploadPart;
  variants: Readonly<{
    webp_480: ImageUploadPart;
    webp_960: ImageUploadPart;
    webp_1600: ImageUploadPart;
  }>;
}>, decodeProbe?: MediaImageDecodeProbe): Promise<MediaUploadBundle> {
  const original = await validateOriginalImage(input.original);
  const [webp480, webp960, webp1600] = await Promise.all([
    validateWebpVariant(input.variants.webp_480, "webp_480"),
    validateWebpVariant(input.variants.webp_960, "webp_960"),
    validateWebpVariant(input.variants.webp_1600, "webp_1600"),
  ]);
  const variants = {
    webp_480: webp480,
    webp_960: webp960,
    webp_1600: webp1600,
  } as const;

  if (decodeProbe) {
    await Promise.all([
      decodeProbe(original),
      decodeProbe(webp480),
      decodeProbe(webp960),
      decodeProbe(webp1600),
    ]);
  }

  for (const [kind, targetWidth] of [
    ["webp_480", 480],
    ["webp_960", 960],
    ["webp_1600", 1_600],
  ] as const) {
    const variant = variants[kind];
    const expectedWidth = Math.min(targetWidth, original.displayWidth);
    if (variant.width !== expectedWidth) {
      throw validationIssue(
        `variants.${kind}`,
        "invalid_variant_width",
        "The responsive variant has an invalid width.",
      );
    }
    const expectedHeight =
      (original.displayHeight / original.displayWidth) * expectedWidth;
    if (Math.abs(variant.height - expectedHeight) > 1) {
      throw validationIssue(
        `variants.${kind}`,
        "invalid_variant_aspect_ratio",
        "The responsive variant has an invalid aspect ratio.",
      );
    }
  }

  return Object.freeze({
    original,
    variants: Object.freeze(variants),
  });
}

async function validateWebpVariant(
  part: ImageUploadPart,
  path: "webp_480" | "webp_960" | "webp_1600",
): Promise<ValidatedImage> {
  const validated = await validateImagePart(part, {
    maxBytes: MAX_MEDIA_ORIGINAL_BYTES,
    path: `variants.${path}`,
  });
  if (validated.mimeType !== "image/webp") {
    throw validationIssue(
      `variants.${path}`,
      "invalid_variant_format",
      "Responsive variants must be WebP images.",
    );
  }
  return validated;
}

async function validateImagePart(
  part: ImageUploadPart,
  options: Readonly<{ maxBytes: number; path: string }>,
): Promise<ValidatedImage> {
  const fileName = parseBoundedString(part.fileName, {
    path: `${options.path}.fileName`,
    maxLength: 255,
  });
  const declaredMimeType = parseBoundedString(part.declaredMimeType, {
    path: `${options.path}.mimeType`,
    maxLength: 64,
  }).toLocaleLowerCase("en-CA");
  if (!isMediaImageMimeType(declaredMimeType)) {
    throw validationIssue(
      `${options.path}.mimeType`,
      "unsupported_image_type",
      "Only JPEG, PNG, and WebP images are supported.",
    );
  }

  const extensionMimeType = mimeTypeFromFileName(fileName);
  if (extensionMimeType === null || extensionMimeType !== declaredMimeType) {
    throw validationIssue(
      `${options.path}.fileName`,
      "image_type_mismatch",
      "The filename and declared image type do not agree.",
    );
  }

  const bytes =
    part.bytes instanceof Uint8Array
      ? part.bytes.slice()
      : new Uint8Array(part.bytes.slice(0));
  if (bytes.byteLength < 12 || bytes.byteLength > options.maxBytes) {
    throw validationIssue(
      options.path,
      "invalid_image_size",
      "The image byte size is outside the supported range.",
    );
  }

  const parsed = parseImageMetadata(bytes);
  if (parsed === null || parsed.mimeType !== declaredMimeType) {
    throw validationIssue(
      options.path,
      "image_type_mismatch",
      "The image bytes and declared image type do not agree.",
    );
  }
  if (
    parsed.width < 1 ||
    parsed.height < 1 ||
    parsed.width > MAX_MEDIA_DIMENSION ||
    parsed.height > MAX_MEDIA_DIMENSION ||
    parsed.width * parsed.height > MAX_MEDIA_PIXELS
  ) {
    throw validationIssue(
      options.path,
      "image_dimensions_exceeded",
      "The image dimensions exceed the supported limit.",
    );
  }
  await assertContainerIntegrity(
    bytes,
    parsed.mimeType,
    parsed.width,
    parsed.height,
  );

  const rotated = parsed.orientation >= 5 && parsed.orientation <= 8;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Object.freeze({
    bytes,
    displayHeight: rotated ? parsed.width : parsed.height,
    displayWidth: rotated ? parsed.height : parsed.width,
    height: parsed.height,
    mimeType: parsed.mimeType,
    orientation: parsed.orientation,
    sha256: toHex(new Uint8Array(digest)),
    width: parsed.width,
  });
}

async function assertContainerIntegrity(
  bytes: Uint8Array,
  mimeType: MediaImageMimeType,
  width: number,
  height: number,
): Promise<void> {
  try {
    if (mimeType === "image/png") {
      await assertPngIntegrity(bytes, width, height);
    } else if (mimeType === "image/jpeg") {
      assertJpegIntegrity(bytes);
    } else {
      assertWebpIntegrity(bytes);
    }
  } catch {
    throw validationIssue(
      "image",
      "corrupt_image",
      "The image container is truncated or corrupt.",
    );
  }
}

async function assertPngIntegrity(
  bytes: Uint8Array,
  width: number,
  height: number,
): Promise<void> {
  let offset = 8;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const compressedParts: Uint8Array[] = [];
  while (offset + 12 <= bytes.byteLength) {
    const length = readU32Be(bytes, offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.byteLength) throw new TypeError("truncated_png");
    const type = ascii(bytes, typeStart, dataStart);
    if (
      crc32(bytes.subarray(typeStart, dataEnd)) !==
      readU32Be(bytes, dataEnd)
    ) {
      throw new TypeError("png_crc");
    }
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) {
        throw new TypeError("png_header");
      }
      sawHeader = true;
      if (readU32Be(bytes, dataStart) !== width ||
          readU32Be(bytes, dataStart + 4) !== height) {
        throw new TypeError("png_dimensions");
      }
      bitDepth = bytes[dataStart + 8] ?? 0;
      colorType = bytes[dataStart + 9] ?? 0;
      if (
        (bytes[dataStart + 10] ?? -1) !== 0 ||
        (bytes[dataStart + 11] ?? -1) !== 0
      ) {
        throw new TypeError("png_method");
      }
      interlace = bytes[dataStart + 12] ?? -1;
      if (interlace !== 0 && interlace !== 1) {
        throw new TypeError("png_interlace");
      }
      assertPngColorMode(bitDepth, colorType);
    } else if (type === "IDAT") {
      if (sawEnd) throw new TypeError("png_order");
      sawData = true;
      compressedParts.push(bytes.slice(dataStart, dataEnd));
    } else if (type === "IEND") {
      if (length !== 0 || !sawData) throw new TypeError("png_end");
      sawEnd = true;
      offset = chunkEnd;
      break;
    } else if (type === "IHDR") {
      throw new TypeError("png_header_duplicate");
    }
    offset = chunkEnd;
  }
  if (!sawHeader || !sawData || !sawEnd || offset !== bytes.byteLength) {
    throw new TypeError("png_incomplete");
  }
  const compressedLength = compressedParts.reduce(
    (total, part) => total + part.byteLength,
    0,
  );
  const compressed = new Uint8Array(compressedLength);
  let compressedOffset = 0;
  for (const part of compressedParts) {
    compressed.set(part, compressedOffset);
    compressedOffset += part.byteLength;
  }
  const decompressed = await inflateZlib(compressed);
  const passes = pngPasses(width, height, interlace);
  const channels = pngChannels(colorType);
  let expectedLength = 0;
  for (const pass of passes) {
    if (pass.width === 0 || pass.height === 0) continue;
    expectedLength +=
      (Math.ceil((pass.width * channels * bitDepth) / 8) + 1) *
      pass.height;
  }
  if (decompressed.byteLength !== expectedLength) {
    throw new TypeError("png_scanlines");
  }
  let rawOffset = 0;
  for (const pass of passes) {
    const rowBytes = Math.ceil((pass.width * channels * bitDepth) / 8);
    for (let row = 0; row < pass.height; row += 1) {
      const filter = decompressed[rawOffset];
      if (filter === undefined || filter > 4) {
        throw new TypeError("png_filter");
      }
      rawOffset += rowBytes + 1;
    }
  }
}

function assertJpegIntegrity(bytes: Uint8Array): void {
  if (
    bytes.byteLength < 14 ||
    bytes[bytes.byteLength - 2] !== 0xff ||
    bytes[bytes.byteLength - 1] !== 0xd9
  ) {
    throw new TypeError("jpeg_end");
  }
  let offset = 2;
  let sawFrame = false;
  let sawScan = false;
  while (offset < bytes.byteLength - 2) {
    if (bytes[offset] !== 0xff) throw new TypeError("jpeg_marker");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xda) {
      if (offset + 2 > bytes.byteLength - 2) throw new TypeError("jpeg_scan");
      const length = readU16Be(bytes, offset);
      if (length < 2 || offset + length >= bytes.byteLength - 2) {
        throw new TypeError("jpeg_scan");
      }
      sawScan = true;
      break;
    }
    if (marker === undefined || marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.byteLength - 2) throw new TypeError("jpeg_segment");
    const length = readU16Be(bytes, offset);
    if (length < 2 || offset + length > bytes.byteLength - 2) {
      throw new TypeError("jpeg_segment");
    }
    if (isJpegStartOfFrame(marker)) sawFrame = true;
    offset += length;
  }
  if (!sawFrame || !sawScan) throw new TypeError("jpeg_incomplete");
}

function assertWebpIntegrity(bytes: Uint8Array): void {
  if (
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 12) !== "WEBP" ||
    readU32Le(bytes, 4) + 8 !== bytes.byteLength
  ) {
    throw new TypeError("webp_container");
  }
  let offset = 12;
  let imageChunks = 0;
  while (offset + 8 <= bytes.byteLength) {
    const type = ascii(bytes, offset, offset + 4);
    const length = readU32Le(bytes, offset + 4);
    const dataEnd = offset + 8 + length;
    if (dataEnd > bytes.byteLength) throw new TypeError("webp_chunk");
    if (type === "VP8 " || type === "VP8L" || type === "VP8X") {
      imageChunks += 1;
    }
    offset = dataEnd + (length % 2);
  }
  if (offset !== bytes.byteLength || imageChunks < 1) {
    throw new TypeError("webp_incomplete");
  }
}

function assertPngColorMode(bitDepth: number, colorType: number): void {
  const allowed = new Map<number, readonly number[]>([
    [0, [1, 2, 4, 8, 16]],
    [2, [8, 16]],
    [3, [1, 2, 4, 8]],
    [4, [8, 16]],
    [6, [8, 16]],
  ]);
  if (!(allowed.get(colorType) ?? []).includes(bitDepth)) {
    throw new TypeError("png_color");
  }
}

function pngChannels(colorType: number): number {
  const channels = new Map([
    [0, 1],
    [2, 3],
    [3, 1],
    [4, 2],
    [6, 4],
  ]).get(colorType);
  if (channels === undefined) throw new TypeError("png_color");
  return channels;
}

function pngPasses(
  width: number,
  height: number,
  interlace: number,
): readonly Readonly<{ height: number; width: number }>[] {
  if (interlace === 0) return [{ width, height }];
  const definitions = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ] as const;
  return definitions.map(([x, y, stepX, stepY]) => ({
    width: width <= x ? 0 : Math.ceil((width - x) / stepX),
    height: height <= y ? 0 : Math.ceil((height - y) / stepY),
  }));
}

async function inflateZlib(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    throw new TypeError("decompression_unavailable");
  }
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  const stream = new Blob([copy.buffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isMediaImageMimeType(value: string): value is MediaImageMimeType {
  return MEDIA_IMAGE_MIME_TYPES.some((allowed) => allowed === value);
}

function mimeTypeFromFileName(fileName: string): MediaImageMimeType | null {
  const match = /\.([A-Za-z0-9]+)$/u.exec(fileName);
  if (!match) return null;
  switch (match[1]?.toLocaleLowerCase("en-CA")) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return null;
  }
}

function parseImageMetadata(bytes: Uint8Array): Readonly<{
  height: number;
  mimeType: MediaImageMimeType;
  orientation: number;
  width: number;
}> | null {
  return parsePng(bytes) ?? parseJpeg(bytes) ?? parseWebp(bytes);
}

function parsePng(bytes: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((value, index) => bytes[index] === value)) return null;
  if (
    bytes.byteLength < 33 ||
    ascii(bytes, 12, 16) !== "IHDR" ||
    readU32Be(bytes, 8) !== 13
  ) {
    return null;
  }
  return {
    width: readU32Be(bytes, 16),
    height: readU32Be(bytes, 20),
    mimeType: "image/png" as const,
    orientation: 1,
  };
}

function parseJpeg(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let offset = 2;
  let orientation = 1;
  while (offset + 4 <= bytes.byteLength) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.byteLength) return null;
    const length = readU16Be(bytes, offset);
    if (length < 2 || offset + length > bytes.byteLength) return null;
    const segmentStart = offset + 2;
    if (marker === 0xe1) {
      orientation = parseExifOrientation(
        bytes.subarray(segmentStart, offset + length),
      );
    }
    if (isJpegStartOfFrame(marker)) {
      if (length < 7) return null;
      return {
        width: readU16Be(bytes, segmentStart + 3),
        height: readU16Be(bytes, segmentStart + 1),
        mimeType: "image/jpeg" as const,
        orientation,
      };
    }
    offset += length;
  }
  return null;
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    ![0xc4, 0xc8, 0xcc].includes(marker)
  );
}

function parseExifOrientation(segment: Uint8Array): number {
  if (
    segment.byteLength < 14 ||
    ascii(segment, 0, 6) !== "Exif\u0000\u0000"
  ) {
    return 1;
  }
  const tiff = 6;
  const byteOrder = ascii(segment, tiff, tiff + 2);
  const littleEndian = byteOrder === "II";
  if (!littleEndian && byteOrder !== "MM") return 1;
  const read16 = (offset: number) =>
    littleEndian
      ? readU16Le(segment, offset)
      : readU16Be(segment, offset);
  const read32 = (offset: number) =>
    littleEndian
      ? readU32Le(segment, offset)
      : readU32Be(segment, offset);
  if (read16(tiff + 2) !== 42) return 1;
  const ifdOffset = tiff + read32(tiff + 4);
  if (ifdOffset + 2 > segment.byteLength) return 1;
  const entryCount = read16(ifdOffset);
  for (let index = 0; index < entryCount; index += 1) {
    const entry = ifdOffset + 2 + index * 12;
    if (entry + 12 > segment.byteLength) return 1;
    if (read16(entry) !== 0x0112) continue;
    const value = read16(entry + 8);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

function parseWebp(bytes: Uint8Array) {
  if (
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 12) !== "WEBP" ||
    readU32Le(bytes, 4) + 8 > bytes.byteLength
  ) {
    return null;
  }
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkType = ascii(bytes, offset, offset + 4);
    const chunkLength = readU32Le(bytes, offset + 4);
    const data = offset + 8;
    if (data + chunkLength > bytes.byteLength) return null;
    if (chunkType === "VP8X" && chunkLength >= 10) {
      return {
        width: 1 + readU24Le(bytes, data + 4),
        height: 1 + readU24Le(bytes, data + 7),
        mimeType: "image/webp" as const,
        orientation: 1,
      };
    }
    if (
      chunkType === "VP8 " &&
      chunkLength >= 10 &&
      bytes[data + 3] === 0x9d &&
      bytes[data + 4] === 0x01 &&
      bytes[data + 5] === 0x2a
    ) {
      return {
        width: readU16Le(bytes, data + 6) & 0x3fff,
        height: readU16Le(bytes, data + 8) & 0x3fff,
        mimeType: "image/webp" as const,
        orientation: 1,
      };
    }
    if (
      chunkType === "VP8L" &&
      chunkLength >= 5 &&
      bytes[data] === 0x2f
    ) {
      const b1 = bytes[data + 1] ?? 0;
      const b2 = bytes[data + 2] ?? 0;
      const b3 = bytes[data + 3] ?? 0;
      const b4 = bytes[data + 4] ?? 0;
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
        mimeType: "image/webp" as const,
        orientation: 1,
      };
    }
    offset = data + chunkLength + (chunkLength % 2);
  }
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function readU16Be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readU16Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readU24Le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16)
  );
}

function readU32Be(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset + offset,
    4,
  ).getUint32(0, false);
}

function readU32Le(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset + offset,
    4,
  ).getUint32(0, true);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
