import type { R2BucketLike } from "../media/storage";
import {
  PUBLIC_RESPONSE_FALLBACK_MAX_ENTRIES,
  PUBLIC_RESPONSE_FALLBACK_MAX_TOTAL_BYTES,
  capturePublicResponseFallbackEntry,
  isStoredPublicResponseFallbackEntry,
  publicResponseFallbackKey,
  responseFromPublicResponseFallbackEntry,
  type PublicResponseFallbackFailure,
  type StoredPublicResponse,
} from "./warm-response-fallback";

export const DURABLE_PUBLIC_RESPONSE_FALLBACK_OBJECT_KEY =
  "system/public-response-fallback/v1/current.json";
export const DURABLE_PUBLIC_RESPONSE_FALLBACK_SCHEMA_VERSION = 1;
export const DURABLE_PUBLIC_RESPONSE_FALLBACK_ENTRY_COUNT = 4;
export const DURABLE_PUBLIC_RESPONSE_FALLBACK_MAX_AGE_MS =
  72 * 60 * 60 * 1_000;
export const DURABLE_PUBLIC_RESPONSE_FALLBACK_SLOTS = Object.freeze([
  "home-html",
  "events-html",
  "home-rsc",
  "events-rsc",
] as const);

type DurablePublicResponseBucket = Pick<R2BucketLike, "get" | "put">;

export type DurablePublicResponseFallbackSlot =
  (typeof DURABLE_PUBLIC_RESPONSE_FALLBACK_SLOTS)[number];

export type DurablePublicResponseRenderResult = Readonly<{
  nonce: string;
  response: Response;
}>;

export type DurablePublicResponseBuildRequest = Readonly<{
  pathname: "/" | "/.rsc" | "/events" | "/events.rsc";
  request: Request;
  slot: DurablePublicResponseFallbackSlot;
}>;

type DurablePublicResponseBundleEntry = Readonly<{
  key: string;
  response: StoredPublicResponse;
}>;

type DurablePublicResponseBundle = Readonly<{
  entries: readonly DurablePublicResponseBundleEntry[];
  generatedAtUtcMs: number;
  schemaVersion: 1;
}>;

export type DurablePublicResponseFallbackCaptureResult = Readonly<{
  capturedEntryCount: number;
  promoted: boolean;
  promotedByteSize: number | null;
}>;

/**
 * The protected updater renders these anonymous representations while D1 is
 * known-good. Vinext selects Flight rendering by the `.rsc` pathname (not the
 * RSC header), and its baseline cache-busting query is the bare `?_rsc`
 * parameter. The RSC keys are deliberately exact: a request carrying a
 * different router-state header is never served an incompatible payload.
 */
export function durablePublicResponseBuildRequest(
  origin: string,
  slot: DurablePublicResponseFallbackSlot,
): DurablePublicResponseBuildRequest {
  const parsedOrigin = new URL(origin);
  if (
    parsedOrigin.origin !== origin ||
    parsedOrigin.protocol !== "https:" ||
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search ||
    parsedOrigin.hash
  ) {
    throw new TypeError("The durable public response origin is invalid.");
  }
  if (!isDurablePublicResponseFallbackSlot(slot)) {
    throw new TypeError("The durable public response slot is invalid.");
  }
  const isRsc = slot.endsWith("-rsc");
  const appPathname = slot.startsWith("home-") ? "/" : "/events";
  const pathname: DurablePublicResponseBuildRequest["pathname"] = isRsc
    ? appPathname === "/"
      ? "/.rsc"
      : "/events.rsc"
    : appPathname;
  return Object.freeze({
    pathname,
    request: new Request(
      new URL(`${pathname}${isRsc ? "?_rsc" : ""}`, parsedOrigin),
      {
        headers: isRsc
          ? { accept: "text/x-component", rsc: "1" }
          : { accept: "text/html" },
        method: "GET",
      },
    ),
    slot,
  });
}

/**
 * Captures one response into one of four fixed, bounded staging objects. Each
 * object is sealed to its batch ID; promotion requires all four seals to match.
 * An incomplete or interleaved batch never changes last-known-good.
 */
export async function captureDurablePublicResponseFallbackSlot(
  bucket: DurablePublicResponseBucket,
  input: Readonly<{
    batchId: string;
    capturedAtUtcMs?: number;
    origin: string;
    render: (
      buildRequest: DurablePublicResponseBuildRequest,
    ) => Promise<DurablePublicResponseRenderResult>;
    slot: DurablePublicResponseFallbackSlot;
  }>,
): Promise<DurablePublicResponseFallbackCaptureResult> {
  const capturedAtUtcMs = safeTimestamp(
    input.capturedAtUtcMs ?? Date.now(),
  );
  if (!validBatchId(input.batchId)) {
    throw new TypeError("The durable public response batch is invalid.");
  }
  const buildRequest = durablePublicResponseBuildRequest(
    input.origin,
    input.slot,
  );
  const rendered = await input.render(buildRequest);
  const captured = await capturePublicResponseFallbackEntry({
    capturedAtUtcMs,
    nonce: rendered.nonce,
    pathname: buildRequest.pathname,
    request: buildRequest.request,
    response: rendered.response,
  });
  if (!captured) {
    throw new Error("A durable public response could not be validated.");
  }
  const staged = Object.freeze({
    batchId: input.batchId,
    key: captured.key,
    response: captured.entry,
    schemaVersion: DURABLE_PUBLIC_RESPONSE_FALLBACK_SCHEMA_VERSION,
    slot: input.slot,
  });
  const stagedBytes = new TextEncoder().encode(JSON.stringify(staged));
  if (stagedBytes.byteLength > PUBLIC_RESPONSE_FALLBACK_MAX_TOTAL_BYTES) {
    throw new Error("The staged durable public response is too large.");
  }
  await bucket.put(stagingObjectKey(input.slot), stagedBytes, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });

  const stagedEntries = await Promise.all(
    DURABLE_PUBLIC_RESPONSE_FALLBACK_SLOTS.map((slot) =>
      readStagedEntry(bucket, {
        batchId: input.batchId,
        nowUtcMs: capturedAtUtcMs,
        origin: input.origin,
        slot,
      }),
    ),
  );
  const capturedEntries = stagedEntries.filter(
    (entry): entry is DurablePublicResponseBundleEntry => entry !== null,
  );
  if (
    capturedEntries.length !== DURABLE_PUBLIC_RESPONSE_FALLBACK_ENTRY_COUNT
  ) {
    return Object.freeze({
      capturedEntryCount: capturedEntries.length,
      promoted: false,
      promotedByteSize: null,
    });
  }
  const generatedAtUtcMs = Math.max(
    ...capturedEntries.map((entry) => entry.response.capturedAtUtcMs),
  );
  const bundle: DurablePublicResponseBundle = Object.freeze({
    entries: Object.freeze(capturedEntries),
    generatedAtUtcMs,
    schemaVersion: DURABLE_PUBLIC_RESPONSE_FALLBACK_SCHEMA_VERSION,
  });
  const bytes = new TextEncoder().encode(JSON.stringify(bundle));
  if (bytes.byteLength > PUBLIC_RESPONSE_FALLBACK_MAX_TOTAL_BYTES) {
    throw new Error("The durable public response bundle is too large.");
  }

  // R2 replaces one object atomically. A failed put leaves the previous
  // complete last-known-good object available; there is no partial manifest.
  await bucket.put(DURABLE_PUBLIC_RESPONSE_FALLBACK_OBJECT_KEY, bytes, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
  return Object.freeze({
    capturedEntryCount: capturedEntries.length,
    promoted: true,
    promotedByteSize: bytes.byteLength,
  });
}

export function isDurablePublicResponseFallbackSlot(
  value: unknown,
): value is DurablePublicResponseFallbackSlot {
  return DURABLE_PUBLIC_RESPONSE_FALLBACK_SLOTS.some(
    (slot) => slot === value,
  );
}

async function readStagedEntry(
  bucket: Pick<R2BucketLike, "get">,
  input: Readonly<{
    batchId: string;
    nowUtcMs: number;
    origin: string;
    slot: DurablePublicResponseFallbackSlot;
  }>,
): Promise<DurablePublicResponseBundleEntry | null> {
  const object = await bucket.get(stagingObjectKey(input.slot));
  if (!object) return null;
  if (
    object.size !== undefined &&
    (!Number.isSafeInteger(object.size) ||
      object.size < 1 ||
      object.size > PUBLIC_RESPONSE_FALLBACK_MAX_TOTAL_BYTES)
  ) {
    throw new Error("A staged durable public response is invalid.");
  }
  const raw = await object.arrayBuffer();
  if (
    raw.byteLength < 1 ||
    raw.byteLength > PUBLIC_RESPONSE_FALLBACK_MAX_TOTAL_BYTES
  ) {
    throw new Error("A staged durable public response is invalid.");
  }
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(raw),
  );
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !==
      ["batchId", "key", "response", "schemaVersion", "slot"].join("\n")
  ) {
    throw new Error("A staged durable public response is invalid.");
  }
  const staged = value as Record<string, unknown>;
  const expectedRequest = durablePublicResponseBuildRequest(
    input.origin,
    input.slot,
  );
  const expectedKey = publicResponseFallbackKey(
    expectedRequest.request,
    expectedRequest.pathname,
  );
  if (staged.batchId !== input.batchId) return null;
  if (
    staged.schemaVersion !== DURABLE_PUBLIC_RESPONSE_FALLBACK_SCHEMA_VERSION ||
    staged.slot !== input.slot ||
    typeof staged.key !== "string" ||
    staged.key !== expectedKey ||
    !isStoredPublicResponseFallbackEntry(
      staged.response,
      staged.key,
      input.nowUtcMs,
      DURABLE_PUBLIC_RESPONSE_FALLBACK_MAX_AGE_MS,
    )
  ) {
    throw new Error("A staged durable public response is invalid.");
  }
  return Object.freeze({ key: staged.key, response: staged.response });
}

function stagingObjectKey(
  slot: DurablePublicResponseFallbackSlot,
): string {
  if (!isDurablePublicResponseFallbackSlot(slot)) {
    throw new TypeError("The durable public response staging key is invalid.");
  }
  return `system/public-response-fallback/v1/staging/${slot}.json`;
}

function validBatchId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
    value,
  );
}

/** Reads, validates, and rehydrates the exact durable response on failure. */
export async function durablePublicResponseForFailure(
  bucket: Pick<R2BucketLike, "get">,
  input: Readonly<{
    contentSecurityPolicy: string;
    failure: PublicResponseFallbackFailure;
    nonce: string | null;
    nowUtcMs?: number;
    pathname: string;
    request: Request;
  }>,
): Promise<Response | null> {
  try {
    const nowUtcMs = safeTimestamp(input.nowUtcMs ?? Date.now());
    const lookup = durableLookupRequest(input.request, input.pathname);
    if (!lookup) return null;
    const requestedKey = publicResponseFallbackKey(
      lookup.request,
      input.pathname,
    );
    if (!requestedKey) return null;
    const object = await bucket.get(
      DURABLE_PUBLIC_RESPONSE_FALLBACK_OBJECT_KEY,
    );
    if (
      !object ||
      (object.size !== undefined &&
        (!Number.isSafeInteger(object.size) ||
          object.size < 1 ||
          object.size > PUBLIC_RESPONSE_FALLBACK_MAX_TOTAL_BYTES))
    ) {
      return null;
    }
    const raw = await object.arrayBuffer();
    if (
      raw.byteLength < 1 ||
      raw.byteLength > PUBLIC_RESPONSE_FALLBACK_MAX_TOTAL_BYTES
    ) {
      return null;
    }
    const bundle = parseBundle(
      new TextDecoder("utf-8", { fatal: true }).decode(raw),
      nowUtcMs,
    );
    if (!bundle) return null;
    const stored = bundle.entries.find(
      (candidate) => candidate.key === requestedKey,
    );
    if (!stored) return null;
    const recovered = responseFromPublicResponseFallbackEntry({
      contentSecurityPolicy: input.contentSecurityPolicy,
      entry: stored.response,
      failure: input.failure,
      key: stored.key,
      maxAgeMs: DURABLE_PUBLIC_RESPONSE_FALLBACK_MAX_AGE_MS,
      nonce: input.nonce,
      nowUtcMs,
      pathname: input.pathname,
      request: lookup.request,
    });
    return recovered && lookup.normalizedVaryHeaders.length > 0
      ? withoutNormalizedTransportVary(
          recovered,
          lookup.normalizedVaryHeaders,
        )
      : recovered;
  } catch {
    return null;
  }
}

function durableLookupRequest(
  request: Request,
  pathname: string,
): Readonly<{
  normalizedVaryHeaders: readonly ("accept" | "accept-encoding")[];
  request: Request;
}> | null {
  const exactKey = publicResponseFallbackKey(request, pathname);
  if (!exactKey || hasConditionalRequestHeaders(request)) return null;
  const url = new URL(request.url);
  const isRsc = request.headers.get("rsc") === "1" || pathname.endsWith(".rsc");
  if (isRsc) {
    // RSC router/interception headers remain byte-for-byte keyed. The protected
    // capture stores only the baseline state and never cross-serves another.
    // Accept-Encoding is transport negotiation only: captured bodies must be
    // unencoded, so it cannot alter the stored payload bytes.
    const headers = new Headers(request.headers);
    headers.delete("accept-encoding");
    return Object.freeze({
      normalizedVaryHeaders: Object.freeze(["accept-encoding"] as const),
      request: new Request(url, { headers, method: "GET" }),
    });
  }
  if (
    hasRscOrRouterState(request) ||
    !acceptAllowsHtml(request.headers.get("accept"))
  ) {
    return null;
  }
  const headers = new Headers(request.headers);
  headers.set("accept", "text/html");
  headers.delete("accept-encoding");
  return Object.freeze({
    normalizedVaryHeaders: Object.freeze([
      "accept",
      "accept-encoding",
    ] as const),
    request: new Request(url, { headers, method: "GET" }),
  });
}

function hasConditionalRequestHeaders(request: Request): boolean {
  if (request.headers.has("range")) return true;
  for (const name of request.headers.keys()) {
    if (name.toLowerCase().startsWith("if-")) return true;
  }
  return false;
}

function hasRscOrRouterState(request: Request): boolean {
  return [
    "next-router-prefetch",
    "next-router-segment-prefetch",
    "next-router-state-tree",
    "next-url",
    "rsc",
    "x-vinext-interception-context",
    "x-vinext-mounted-slots",
    "x-vinext-rsc-render-mode",
  ].some((name) => request.headers.has(name));
}

function acceptAllowsHtml(value: string | null): boolean {
  if (value === null || value.length < 1 || value.length > 4_096) return false;
  let selectedSpecificity = -1;
  let selectedQuality = -1;
  const ranges = value.split(",");
  if (ranges.length > 32) return false;
  for (const range of ranges) {
    const segments = range.split(";");
    const mediaRange = segments.shift()?.trim().toLowerCase();
    const specificity =
      mediaRange === "text/html"
        ? 2
        : mediaRange === "text/*"
          ? 1
          : mediaRange === "*/*"
            ? 0
            : -1;
    if (specificity < 0) continue;
    let quality = 1;
    for (const rawParameter of segments) {
      const [rawName, rawValue, ...extra] = rawParameter.split("=");
      if (extra.length > 0) return false;
      if (rawName?.trim().toLowerCase() !== "q") continue;
      const normalizedQuality = rawValue?.trim() ?? "";
      if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u.test(normalizedQuality)) {
        return false;
      }
      quality = Number(normalizedQuality);
    }
    if (
      specificity > selectedSpecificity ||
      (specificity === selectedSpecificity && quality > selectedQuality)
    ) {
      selectedSpecificity = specificity;
      selectedQuality = quality;
    }
  }
  return selectedSpecificity >= 0 && selectedQuality > 0;
}

function withoutNormalizedTransportVary(
  response: Response,
  normalizedVaryHeaders: readonly ("accept" | "accept-encoding")[],
): Response {
  const headers = new Headers(response.headers);
  const vary = headers.get("vary");
  if (!vary) return response;
  const normalized = new Set<string>(normalizedVaryHeaders);
  const retained = vary
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0 && !normalized.has(name));
  if (retained.length > 0) headers.set("Vary", retained.join(", "));
  else headers.delete("Vary");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function parseBundle(
  serialized: string,
  nowUtcMs: number,
): DurablePublicResponseBundle | null {
  const value: unknown = JSON.parse(serialized);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !==
      ["entries", "generatedAtUtcMs", "schemaVersion"].join("\n")
  ) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !==
      DURABLE_PUBLIC_RESPONSE_FALLBACK_SCHEMA_VERSION ||
    typeof candidate.generatedAtUtcMs !== "number" ||
    !Number.isSafeInteger(candidate.generatedAtUtcMs) ||
    (candidate.generatedAtUtcMs as number) < 0 ||
    (candidate.generatedAtUtcMs as number) > nowUtcMs ||
    nowUtcMs - (candidate.generatedAtUtcMs as number) >
      DURABLE_PUBLIC_RESPONSE_FALLBACK_MAX_AGE_MS ||
    !Array.isArray(candidate.entries) ||
    candidate.entries.length !==
      DURABLE_PUBLIC_RESPONSE_FALLBACK_ENTRY_COUNT ||
    candidate.entries.length > PUBLIC_RESPONSE_FALLBACK_MAX_ENTRIES
  ) {
    return null;
  }
  const entries: DurablePublicResponseBundleEntry[] = [];
  const seenKeys = new Set<string>();
  let totalStoredBytes = 0;
  for (const rawEntry of candidate.entries) {
    if (
      typeof rawEntry !== "object" ||
      rawEntry === null ||
      Array.isArray(rawEntry) ||
      Object.keys(rawEntry).sort().join("\n") !== "key\nresponse"
    ) {
      return null;
    }
    const pair = rawEntry as Record<string, unknown>;
    if (
      typeof pair.key !== "string" ||
      seenKeys.has(pair.key) ||
      !isStoredPublicResponseFallbackEntry(
        pair.response,
        pair.key,
        nowUtcMs,
        DURABLE_PUBLIC_RESPONSE_FALLBACK_MAX_AGE_MS,
      )
    ) {
      return null;
    }
    seenKeys.add(pair.key);
    totalStoredBytes += pair.response.storedBytes;
    if (totalStoredBytes > PUBLIC_RESPONSE_FALLBACK_MAX_TOTAL_BYTES) {
      return null;
    }
    entries.push(
      Object.freeze({ key: pair.key, response: pair.response }),
    );
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    generatedAtUtcMs: candidate.generatedAtUtcMs as number,
    schemaVersion: DURABLE_PUBLIC_RESPONSE_FALLBACK_SCHEMA_VERSION,
  });
}

function safeTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("The durable public response timestamp is invalid.");
  }
  return value;
}
