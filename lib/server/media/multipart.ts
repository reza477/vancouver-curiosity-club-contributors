import { validationIssue } from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import type { MediaUploadInput } from "./storage";

export const MAX_MEDIA_MULTIPART_BYTES =
  4 * 8 * 1024 * 1024 + 64 * 1024;

export async function readMediaUploadRequest(
  request: Request,
): Promise<MediaUploadInput> {
  try {
    requireSameOriginMediaMutation(request);
  } catch {
    throw new SafeApplicationError(
      "authorization_denied",
      403,
      "This request is not permitted.",
    );
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data;\s*boundary=/iu.test(contentType)) {
    throw validationIssue(
      "body",
      "invalid_content_type",
      "Expected a multipart media upload.",
    );
  }
  const bytes = await readBoundedBinaryBody(request, MAX_MEDIA_MULTIPART_BYTES);
  const requestBody = new Uint8Array(bytes.byteLength);
  requestBody.set(bytes);
  let form: FormData;
  try {
    form = await new Request(request.url, {
      body: requestBody.buffer,
      headers: { "Content-Type": contentType },
      method: "POST",
    }).formData();
  } catch {
    throw validationIssue(
      "body",
      "invalid_multipart",
      "Expected a valid multipart media upload.",
    );
  }

  const allowed = new Set([
    "metadata",
    "original",
    "webp480",
    "webp960",
    "webp1600",
  ]);
  const seen = new Set<string>();
  for (const [key] of form.entries()) {
    if (!allowed.has(key) || seen.has(key)) {
      throw validationIssue(
        "body",
        "unexpected_field",
        "The media upload contains unsupported fields.",
      );
    }
    seen.add(key);
  }
  if (seen.size !== allowed.size) {
    throw validationIssue(
      "body",
      "missing_field",
      "The media upload is incomplete.",
    );
  }

  const metadataValue = form.get("metadata");
  if (
    typeof metadataValue !== "string" ||
    new TextEncoder().encode(metadataValue).byteLength > 16_384
  ) {
    throw validationIssue(
      "metadata",
      "invalid_metadata",
      "Expected bounded media metadata.",
    );
  }
  let metadata: unknown;
  try {
    metadata = JSON.parse(metadataValue) as unknown;
  } catch {
    throw validationIssue(
      "metadata",
      "invalid_metadata",
      "Expected valid media metadata.",
    );
  }

  const [original, webp480, webp960, webp1600] = await Promise.all([
    filePart(form.get("original"), "original"),
    filePart(form.get("webp480"), "webp480"),
    filePart(form.get("webp960"), "webp960"),
    filePart(form.get("webp1600"), "webp1600"),
  ]);
  return Object.freeze({
    metadata,
    original,
    variants: Object.freeze({
      webp_480: webp480,
      webp_960: webp960,
      webp_1600: webp1600,
    }),
  });
}

function requireSameOriginMediaMutation(request: Request): void {
  const originHeader = request.headers.get("origin");
  if (!originHeader) throw new Error("origin_missing");
  const origin = new URL(originHeader);
  const requestUrl = new URL(request.url);
  if (originHeader !== origin.origin || origin.origin !== requestUrl.origin) {
    throw new Error("origin_mismatch");
  }
}

export async function readBoundedBinaryBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) {
      throw validationIssue(
        "body",
        "invalid_length",
        "The request body length is invalid.",
      );
    }
    const declaredBytes = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes > maxBytes
    ) {
      throw validationIssue(
        "body",
        "body_too_large",
        "The request body is too large.",
      );
    }
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw validationIssue(
          "body",
          "body_too_large",
          "The request body is too large.",
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function filePart(
  value: FormDataEntryValue | null,
  path: string,
): Promise<Readonly<{
  bytes: ArrayBuffer;
  declaredMimeType: string;
  fileName: string;
}>> {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value.arrayBuffer !== "function"
  ) {
    throw validationIssue(
      path,
      "missing_file",
      "Expected an image file.",
    );
  }
  if (value.size < 1 || value.size > 8 * 1024 * 1024) {
    throw validationIssue(
      path,
      "invalid_file_size",
      "The image byte size is outside the supported range.",
    );
  }
  return Object.freeze({
    bytes: await value.arrayBuffer(),
    declaredMimeType: value.type,
    fileName: value.name,
  });
}
