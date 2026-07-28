import { deflateSync } from "node:zlib";

export function pngBytes(width, height) {
  const header = new Uint8Array(13);
  writeU32Be(header, 0, width);
  writeU32Be(header, 4, height);
  header[8] = 1;
  header[9] = 0;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const rowBytes = Math.ceil(width / 8);
  const raw = new Uint8Array((rowBytes + 1) * height);
  const compressed = new Uint8Array(deflateSync(raw));
  return concatenate([
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

export function jpegBytes(width, height) {
  const frame = new Uint8Array(9);
  frame[0] = 8;
  writeU16Be(frame, 1, height);
  writeU16Be(frame, 3, width);
  frame.set([1, 1, 0x11, 0], 5);
  return concatenate([
    Uint8Array.of(0xff, 0xd8),
    jpegSegment(0xe0, Uint8Array.of(0, 0)),
    jpegSegment(0xc0, frame),
    jpegSegment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)),
    Uint8Array.of(0x11, 0x22, 0x33),
    Uint8Array.of(0xff, 0xd9),
  ]);
}

export function webpBytes(width, height) {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  writeU32Le(bytes, 4, 22);
  bytes.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8);
  writeU32Le(bytes, 16, 10);
  writeU24Le(bytes, 24, width - 1);
  writeU24Le(bytes, 27, height - 1);
  return bytes;
}

function pngChunk(type, data) {
  const bytes = new Uint8Array(12 + data.byteLength);
  writeU32Be(bytes, 0, data.byteLength);
  bytes.set([...type].map((character) => character.charCodeAt(0)), 4);
  bytes.set(data, 8);
  const checksum = crc32(bytes.subarray(4, 8 + data.byteLength));
  writeU32Be(bytes, 8 + data.byteLength, checksum);
  return bytes;
}

function jpegSegment(marker, data) {
  const bytes = new Uint8Array(data.byteLength + 4);
  bytes.set([0xff, marker], 0);
  writeU16Be(bytes, 2, data.byteLength + 2);
  bytes.set(data, 4);
  return bytes;
}

function concatenate(parts) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16Be(bytes, offset, value) {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeU24Le(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}

function writeU32Be(bytes, offset, value) {
  new DataView(bytes.buffer).setUint32(offset, value, false);
}

function writeU32Le(bytes, offset, value) {
  new DataView(bytes.buffer).setUint32(offset, value, true);
}
