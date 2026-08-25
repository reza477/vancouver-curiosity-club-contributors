import { PUBLIC_DOCUMENT_BROWSER_CACHE_CONTROL } from "../../public-document-cache";

export const PUBLIC_RESPONSE_FALLBACK_MAX_ENTRIES = 12;
export const PUBLIC_RESPONSE_FALLBACK_MAX_ENTRY_BYTES = 1_500_000;
export const PUBLIC_RESPONSE_FALLBACK_MAX_TOTAL_BYTES = 6_000_000;
export const PUBLIC_RESPONSE_FALLBACK_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const PUBLIC_RESPONSE_FALLBACK_CAPTURE_INTERVAL_MS = 30_000;
export const PUBLIC_RESPONSE_FALLBACK_NONCE_PLACEHOLDER =
  "__VCC_WARM_RESPONSE_CSP_NONCE__";
export const PUBLIC_RESPONSE_FALLBACK_STATE_HEADER = "X-VCC-Response-State";
export const PUBLIC_RESPONSE_FALLBACK_AGE_HEADER = "X-VCC-Response-Age";

const MAX_KEY_BYTES = 16_384;
const PUBLIC_EVENTS_LANES = new Set([
  "eat-and-play",
  "explore",
  "reset-and-make",
  "think",
]);
const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/u;
const CLUB_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,159}$/u;
const PAGE_PATTERN = /^[1-9]\d{0,4}$/u;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/u;
const RSC_TRANSPORT_VALUE_PATTERN = /^[A-Za-z0-9_-]{0,128}$/u;
const RSC_DEVELOPMENT_PREAMBLE_PATTERN =
  /^:N-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\n/u;
const RSC_FIRST_ROW_PATTERN = /^[0-9a-f]+:/u;
const RSC_ROOT_MODEL_ROW_PATTERN = /(?:^|\n)0:([^\r\n]*)\r?\n/gu;
const RSC_SERIALIZED_NONCE_FIELD_PATTERN = /"nonce"\s*:/giu;
const RSC_SERIALIZED_NONCE_ATTRIBUTE_PATTERN = /\bnonce\s*=/giu;
const SITES_IDENTITY_HEADER_PREFIX = "oai-authenticated-user";
const KEYED_REQUEST_HEADERS = Object.freeze([
  "accept",
  "accept-encoding",
  "next-router-prefetch",
  "next-router-segment-prefetch",
  "next-router-state-tree",
  "next-url",
  "rsc",
  "x-vinext-interception-context",
  "x-vinext-mounted-slots",
  "x-vinext-rsc-render-mode",
] as const);
const ALLOWED_VARY_HEADERS: ReadonlySet<string> = new Set(
  KEYED_REQUEST_HEADERS,
);
const STORED_RESPONSE_HEADERS = Object.freeze([
  "content-language",
  "content-type",
  "vary",
  "x-nextjs-postponed",
  "x-nextjs-stale-time",
  "x-vinext-mounted-slots",
  "x-vinext-params",
] as const);
const STALE_HTML_NOTE =
  '<aside data-vcc-stale-response="true" role="status" aria-live="polite" ' +
  'style="margin:1rem auto;max-width:72rem;padding:0 1rem;color:#3d4a66;font-size:.875rem">' +
  "Updates are temporarily delayed. This page shows a recent saved view." +
  "</aside>";

export type PublicResponseRepresentation = "html" | "rsc";

export type PublicResponseFallbackFailure =
  | Readonly<{ kind: "response"; status: number }>
  | Readonly<{ kind: "throw" }>;

export type PublicResponseFallbackOptions = Readonly<{
  captureIntervalMs?: number;
  clock?: () => number;
  maxAgeMs?: number;
  maxEntries?: number;
  maxEntryBytes?: number;
  maxTotalBytes?: number;
}>;

type PublicResponseFallbackKey = Readonly<{
  key: string;
  representation: PublicResponseRepresentation;
}>;

export type StoredPublicResponse = Readonly<{
  bodyTemplate: string;
  capturedAtUtcMs: number;
  headers: ReadonlyArray<readonly [string, string]>;
  representation: PublicResponseRepresentation;
  storedBytes: number;
}>;

export type CapturedPublicResponseFallbackEntry = Readonly<{
  entry: StoredPublicResponse;
  key: string;
}>;

export type PublicResponseFallback = Readonly<{
  responseForFailure(input: Readonly<{
    contentSecurityPolicy: string;
    failure: PublicResponseFallbackFailure;
    nonce: string | null;
    pathname: string;
    request: Request;
  }>): Response | null;
  scheduleCapture(input: Readonly<{
    nonce: string | null;
    pathname: string;
    request: Request;
    response: Response;
  }>): Promise<boolean> | null;
}>;

/**
 * Creates one bounded last-known-good store for a single Worker isolate.
 * Nothing is placed in Cache API or module-global test state. Only the Worker
 * owns a long-lived instance; tests and other callers receive a fresh closure.
 */
export function createPublicResponseFallback(
  options: PublicResponseFallbackOptions = {},
): PublicResponseFallback {
  const clock = options.clock ?? Date.now;
  const captureIntervalMs = boundedOption(
    options.captureIntervalMs,
    PUBLIC_RESPONSE_FALLBACK_CAPTURE_INTERVAL_MS,
    true,
  );
  const maxAgeMs = boundedOption(
    options.maxAgeMs,
    PUBLIC_RESPONSE_FALLBACK_MAX_AGE_MS,
  );
  const maxEntries = boundedOption(
    options.maxEntries,
    PUBLIC_RESPONSE_FALLBACK_MAX_ENTRIES,
  );
  const maxEntryBytes = boundedOption(
    options.maxEntryBytes,
    PUBLIC_RESPONSE_FALLBACK_MAX_ENTRY_BYTES,
  );
  const maxTotalBytes = boundedOption(
    options.maxTotalBytes,
    PUBLIC_RESPONSE_FALLBACK_MAX_TOTAL_BYTES,
  );
  const entries = new Map<string, StoredPublicResponse>();
  let captureInFlight = false;
  let nextCaptureAtUtcMs = 0;
  let totalBytes = 0;

  const removeEntry = (key: string): void => {
    const existing = entries.get(key);
    if (!existing) return;
    entries.delete(key);
    totalBytes -= existing.storedBytes;
  };

  const removeExpired = (nowUtcMs: number): void => {
    for (const [key, entry] of entries) {
      if (nowUtcMs - entry.capturedAtUtcMs > maxAgeMs) removeEntry(key);
    }
  };

  const scheduleCapture: PublicResponseFallback["scheduleCapture"] = (
    input,
  ) => {
    const nowUtcMs = safeNow(clock);
    removeExpired(nowUtcMs);
    const requestKey = publicResponseFallbackKeyDetails(
      input.request,
      input.pathname,
    );
    if (
      !requestKey ||
      !validNonce(input.nonce) ||
      !isCapturableResponse(input.response, requestKey.representation) ||
      captureInFlight ||
      nowUtcMs < nextCaptureAtUtcMs
    ) {
      return null;
    }

    let response: Response;
    try {
      response = input.response.clone();
    } catch {
      return null;
    }
    captureInFlight = true;
    nextCaptureAtUtcMs = nowUtcMs + captureIntervalMs;

    return capturePublicResponseFallbackEntry({
      capturedAtUtcMs: nowUtcMs,
      maxEntryBytes,
      nonce: input.nonce,
      pathname: input.pathname,
      request: input.request,
      response,
    })
      .then((captured) => {
        if (!captured) return false;
        const { entry } = captured;
        const storedBytes = entry.storedBytes;
        if (storedBytes > maxEntryBytes || storedBytes > maxTotalBytes) {
          return false;
        }

        removeEntry(captured.key);
        while (
          entries.size >= maxEntries ||
          totalBytes + storedBytes > maxTotalBytes
        ) {
          const oldestKey = entries.keys().next().value as string | undefined;
          if (oldestKey === undefined) break;
          removeEntry(oldestKey);
        }
        if (
          entries.size >= maxEntries ||
          totalBytes + storedBytes > maxTotalBytes
        ) {
          return false;
        }
        entries.set(captured.key, entry);
        totalBytes += storedBytes;
        return true;
      })
      .catch(() => false)
      .finally(() => {
        captureInFlight = false;
      });
  };

  const responseForFailure: PublicResponseFallback["responseForFailure"] = (
    input,
  ) => {
    if (!isFallbackFailure(input.failure) || !validNonce(input.nonce)) {
      return null;
    }
    if (
      !input.contentSecurityPolicy.includes(`'nonce-${input.nonce}'`)
    ) {
      return null;
    }
    const nowUtcMs = safeNow(clock);
    removeExpired(nowUtcMs);
    const requestKey = publicResponseFallbackKeyDetails(
      input.request,
      input.pathname,
    );
    if (!requestKey) return null;
    const entry = entries.get(requestKey.key);
    if (!entry || entry.representation !== requestKey.representation) {
      return null;
    }

    const recovered = responseFromPublicResponseFallbackEntry({
      contentSecurityPolicy: input.contentSecurityPolicy,
      entry,
      failure: input.failure,
      key: requestKey.key,
      maxAgeMs,
      nonce: input.nonce,
      nowUtcMs,
      pathname: input.pathname,
      request: input.request,
    });
    if (!recovered) removeEntry(requestKey.key);
    return recovered;
  };

  return Object.freeze({ responseForFailure, scheduleCapture });
}

/**
 * Validates and captures one response without retaining it. Durable storage
 * uses this same seam so its entries cannot be less strict than warm-isolate
 * entries.
 */
export async function capturePublicResponseFallbackEntry(
  input: Readonly<{
    capturedAtUtcMs: number;
    maxEntryBytes?: number;
    nonce: string | null;
    pathname: string;
    request: Request;
    response: Response;
  }>,
): Promise<CapturedPublicResponseFallbackEntry | null> {
  const maxEntryBytes = boundedOption(
    input.maxEntryBytes,
    PUBLIC_RESPONSE_FALLBACK_MAX_ENTRY_BYTES,
  );
  const capturedAtUtcMs = safeTimestamp(input.capturedAtUtcMs);
  const requestKey = publicResponseFallbackKeyDetails(
    input.request,
    input.pathname,
  );
  if (
    !requestKey ||
    !validNonce(input.nonce) ||
    !isCapturableResponse(input.response, requestKey.representation)
  ) {
    return null;
  }
  const captured = await captureResponse({
    maxEntryBytes,
    nonce: input.nonce,
    representation: requestKey.representation,
    response: input.response,
  });
  if (!captured) return null;
  const storedBytes = storedResponseBytes(
    requestKey.key,
    captured.bodyTemplate,
    captured.headers,
  );
  if (storedBytes > maxEntryBytes) return null;
  return Object.freeze({
    entry: Object.freeze({
      ...captured,
      capturedAtUtcMs,
      storedBytes,
    }),
    key: requestKey.key,
  });
}

/** Rehydrates one already-validated exact-key entry for a failure only. */
export function responseFromPublicResponseFallbackEntry(
  input: Readonly<{
    contentSecurityPolicy: string;
    entry: StoredPublicResponse;
    failure: PublicResponseFallbackFailure;
    key: string;
    maxAgeMs?: number;
    nonce: string | null;
    nowUtcMs: number;
    pathname: string;
    request: Request;
  }>,
): Response | null {
  if (!isFallbackFailure(input.failure) || !validNonce(input.nonce)) {
    return null;
  }
  if (!input.contentSecurityPolicy.includes(`'nonce-${input.nonce}'`)) {
    return null;
  }
  const nowUtcMs = safeTimestamp(input.nowUtcMs);
  const maxAgeMs = boundedOption(
    input.maxAgeMs,
    PUBLIC_RESPONSE_FALLBACK_MAX_AGE_MS,
  );
  const requestKey = publicResponseFallbackKeyDetails(
    input.request,
    input.pathname,
  );
  if (
    !requestKey ||
    requestKey.key !== input.key ||
    input.entry.representation !== requestKey.representation ||
    !validStoredPublicResponse(input.entry, input.key, nowUtcMs, maxAgeMs)
  ) {
    return null;
  }

  const hasTemplatedNonce = input.entry.bodyTemplate.includes(
    PUBLIC_RESPONSE_FALLBACK_NONCE_PLACEHOLDER,
  );
  let body = input.entry.bodyTemplate.replaceAll(
    PUBLIC_RESPONSE_FALLBACK_NONCE_PLACEHOLDER,
    input.nonce,
  );
  if (
    body.includes(PUBLIC_RESPONSE_FALLBACK_NONCE_PLACEHOLDER) ||
    ((input.entry.representation === "html" || hasTemplatedNonce) &&
      !body.includes(input.nonce))
  ) {
    return null;
  }
  if (input.entry.representation === "html") {
    const notedBody = addStaleHtmlNote(body);
    if (notedBody === null) return null;
    body = notedBody;
  }

  const headers = new Headers();
  for (const [name, value] of input.entry.headers) headers.set(name, value);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Content-Security-Policy", input.contentSecurityPolicy);
  headers.set("Pragma", "no-cache");
  headers.set(PUBLIC_RESPONSE_FALLBACK_STATE_HEADER, "stale");
  headers.set(
    PUBLIC_RESPONSE_FALLBACK_AGE_HEADER,
    String(
      Math.max(
        0,
        Math.floor((nowUtcMs - input.entry.capturedAtUtcMs) / 1_000),
      ),
    ),
  );
  return new Response(body, { headers, status: 200 });
}

export function isStoredPublicResponseFallbackEntry(
  value: unknown,
  key: string,
  nowUtcMs: number,
  maxAgeMs = PUBLIC_RESPONSE_FALLBACK_MAX_AGE_MS,
): value is StoredPublicResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !==
      [
        "bodyTemplate",
        "capturedAtUtcMs",
        "headers",
        "representation",
        "storedBytes",
      ].join("\n")
  ) {
    return false;
  }
  return validStoredPublicResponse(
    value as StoredPublicResponse,
    key,
    safeTimestamp(nowUtcMs),
    boundedOption(maxAgeMs, PUBLIC_RESPONSE_FALLBACK_MAX_AGE_MS),
  );
}

export function publicResponseFallbackKey(
  request: Request,
  pathname: string,
): string | null {
  return publicResponseFallbackKeyDetails(request, pathname)?.key ?? null;
}

function publicResponseFallbackKeyDetails(
  request: Request,
  pathname: string,
): PublicResponseFallbackKey | null {
  if (request.method.toUpperCase() !== "GET" || hasIdentityFacts(request)) {
    return null;
  }
  const url = new URL(request.url);
  if (url.pathname !== pathname) return null;

  const rscHeader = request.headers.get("rsc");
  if (rscHeader !== null && rscHeader !== "1") return null;
  const pathnameIsRsc = pathname.endsWith(".rsc");
  const representation: PublicResponseRepresentation =
    rscHeader === "1" || pathnameIsRsc ? "rsc" : "html";
  const appPathname = pathnameIsRsc
    ? pathname.slice(0, -4) || "/"
    : pathname;
  if (appPathname !== "/" && appPathname !== "/events") return null;
  if (pathnameIsRsc && rscHeader !== "1") return null;

  const query = exactPublicQuery(url.searchParams, appPathname, representation);
  if (!query) return null;
  const keyedHeaders: Array<readonly [string, string]> = [];
  for (const name of KEYED_REQUEST_HEADERS) {
    const value = request.headers.get(name) ?? "";
    if (utf8Bytes(value) > 4_096) return null;
    keyedHeaders.push(Object.freeze([name, value] as const));
  }
  const key = JSON.stringify([
    url.origin,
    appPathname,
    representation,
    query,
    keyedHeaders,
  ]);
  if (utf8Bytes(key) > MAX_KEY_BYTES) return null;
  return Object.freeze({ key, representation });
}

function exactPublicQuery(
  params: URLSearchParams,
  pathname: string,
  representation: PublicResponseRepresentation,
): string | null {
  const allowed = new Set(
    pathname === "/events"
      ? ["club", "lane", "month", "page", "view", "_rsc"]
      : ["_rsc"],
  );
  for (const name of params.keys()) {
    if (!allowed.has(name) || params.getAll(name).length !== 1) return null;
  }

  const rscTransport = params.get("_rsc");
  if (
    (rscTransport !== null && representation !== "rsc") ||
    (rscTransport !== null &&
      !RSC_TRANSPORT_VALUE_PATTERN.test(rscTransport))
  ) {
    return null;
  }
  const month = params.get("month");
  if (month !== null && !MONTH_PATTERN.test(month)) return null;
  const lane = params.get("lane");
  if (lane !== null && !PUBLIC_EVENTS_LANES.has(lane)) return null;
  const club = params.get("club");
  if (club !== null && !CLUB_SLUG_PATTERN.test(club)) return null;
  const page = params.get("page");
  if (page !== null && !PAGE_PATTERN.test(page)) return null;
  const view = params.get("view");
  if (view !== null && view !== "upcoming" && view !== "calendar") {
    return null;
  }
  return JSON.stringify({ club, lane, month, page, view });
}

function hasIdentityFacts(request: Request): boolean {
  if (
    request.headers.has("authorization") ||
    request.headers.has("cookie") ||
    request.headers.has("proxy-authorization")
  ) {
    return true;
  }
  for (const name of request.headers.keys()) {
    if (name.toLowerCase().startsWith(SITES_IDENTITY_HEADER_PREFIX)) return true;
  }
  return false;
}

function isCapturableResponse(
  response: Response,
  representation: PublicResponseRepresentation,
): boolean {
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (
    response.status !== 200 ||
    response.headers.has("set-cookie") ||
    response.headers.has(PUBLIC_RESPONSE_FALLBACK_STATE_HEADER) ||
    response.headers.has("www-authenticate") ||
    response.headers.has("content-range") ||
    response.headers.has("content-encoding") ||
    (/(?:^|,)\s*private(?:\s*(?:=|,|$))/iu.test(cacheControl) &&
      cacheControl !== PUBLIC_DOCUMENT_BROWSER_CACHE_CONTROL)
  ) {
    return false;
  }
  const contentType = (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    (representation === "html" && contentType !== "text/html") ||
    (representation === "rsc" && contentType !== "text/x-component")
  ) {
    return false;
  }

  const vary = response.headers.get("vary");
  if (!vary) return true;
  const names = vary
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return (
    names.length > 0 &&
    !names.includes("*") &&
    names.every((name) => ALLOWED_VARY_HEADERS.has(name))
  );
}

async function captureResponse(input: Readonly<{
  maxEntryBytes: number;
  nonce: string;
  representation: PublicResponseRepresentation;
  response: Response;
}>): Promise<
  | Readonly<{
      bodyTemplate: string;
      headers: ReadonlyArray<readonly [string, string]>;
      representation: PublicResponseRepresentation;
    }>
  | null
> {
  const policy = input.response.headers.get("content-security-policy") ?? "";
  if (!policy.includes(`'nonce-${input.nonce}'`)) return null;
  const body = await readBoundedUtf8(input.response.body, input.maxEntryBytes);
  if (body === null) return null;
  if (
    input.representation === "rsc" &&
    !validReactFlightBody(body, input.nonce)
  ) {
    return null;
  }
  const hasResponseNonce = body.includes(input.nonce);
  if (
    (input.representation === "html" && !hasResponseNonce) ||
    body.includes(PUBLIC_RESPONSE_FALLBACK_NONCE_PLACEHOLDER) ||
    body.includes('data-vcc-stale-response="true"')
  ) {
    return null;
  }
  if (
    input.representation === "html" &&
    (!/^\s*<!doctype html\b/iu.test(body) ||
      !/<html\b/iu.test(body) ||
      !/<\/body\s*>/iu.test(body) ||
      !/<\/html\s*>/iu.test(body))
  ) {
    return null;
  }
  // HTML always carries executable bootstrap nonces. A Flight payload may be
  // nonce-free when its component tree emits no script element; preserve that
  // valid RSC body byte-for-byte while still rotating any nonce it does carry.
  const bodyTemplate = hasResponseNonce
    ? body.replaceAll(input.nonce, PUBLIC_RESPONSE_FALLBACK_NONCE_PLACEHOLDER)
    : body;
  if (bodyTemplate.includes(input.nonce)) return null;

  const headers: Array<readonly [string, string]> = [];
  for (const name of STORED_RESPONSE_HEADERS) {
    const value = input.response.headers.get(name);
    if (value !== null) headers.push(Object.freeze([name, value] as const));
  }
  return Object.freeze({
    bodyTemplate,
    headers: Object.freeze(headers),
    representation: input.representation,
  });
}

async function readBoundedUtf8(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<string | null> {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        // A cloned response is a tee. Awaiting cancellation of this branch can
        // wait for the visitor's still-active branch, so request cancellation
        // without putting the background task on the visitor lifecycle.
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function addStaleHtmlNote(body: string): string | null {
  const matches = [...body.matchAll(/<\/body\s*>/giu)];
  const closingBody = matches.at(-1);
  if (!closingBody || closingBody.index === undefined) return null;
  return (
    body.slice(0, closingBody.index) +
    STALE_HTML_NOTE +
    body.slice(closingBody.index)
  );
}

function storedResponseBytes(
  key: string,
  body: string,
  headers: ReadonlyArray<readonly [string, string]>,
): number {
  return utf8Bytes(key) + utf8Bytes(body) + utf8Bytes(JSON.stringify(headers));
}

/**
 * This deliberately validates only the stable text framing Vinext receives
 * from React Flight: an optional development time-origin row, at least one
 * hexadecimal row, a complete JSON root model, and a terminating newline.
 * It does not try to interpret component references or execute the payload.
 */
function validReactFlightBody(
  body: string,
  allowedSerializedNonce: string,
): boolean {
  if (body.length === 0 || !body.endsWith("\n")) return false;

  const preamble = body.match(RSC_DEVELOPMENT_PREAMBLE_PATTERN)?.[0] ?? "";
  if (!RSC_FIRST_ROW_PATTERN.test(body.slice(preamble.length))) return false;

  let hasRootModel = false;
  for (const match of body.matchAll(RSC_ROOT_MODEL_ROW_PATTERN)) {
    try {
      JSON.parse(match[1]);
      hasRootModel = true;
      break;
    } catch {
      // Keep looking: a length-prefixed text row may contain row-like text.
    }
  }
  if (!hasRootModel) return false;

  return hasOnlyAllowedSerializedRscNonces(body, allowedSerializedNonce);
}

function hasOnlyAllowedSerializedRscNonces(
  body: string,
  allowedNonce: string,
): boolean {
  for (const field of body.matchAll(RSC_SERIALIZED_NONCE_FIELD_PATTERN)) {
    const valueStart = (field.index ?? 0) + field[0].length;
    const serializedValue = /^\s*("(?:\\[\s\S]|[^"\\])*")/u.exec(
      body.slice(valueStart),
    )?.[1];
    if (!serializedValue) return false;
    try {
      if (JSON.parse(serializedValue) !== allowedNonce) return false;
    } catch {
      return false;
    }
  }

  for (const attribute of body.matchAll(
    RSC_SERIALIZED_NONCE_ATTRIBUTE_PATTERN,
  )) {
    const valueStart = (attribute.index ?? 0) + attribute[0].length;
    const tail = body.slice(valueStart).trimStart();
    if (
      tail.startsWith(`"${allowedNonce}"`) ||
      tail.startsWith(`'${allowedNonce}'`) ||
      tail.startsWith(`\\"${allowedNonce}\\"`) ||
      tail.startsWith(`\\'${allowedNonce}\\'`)
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function validStoredPublicResponse(
  entry: StoredPublicResponse,
  key: string,
  nowUtcMs: number,
  maxAgeMs: number,
): boolean {
  if (
    typeof entry !== "object" ||
    entry === null ||
    typeof entry.bodyTemplate !== "string" ||
    !Number.isSafeInteger(entry.capturedAtUtcMs) ||
    entry.capturedAtUtcMs < 0 ||
    entry.capturedAtUtcMs > nowUtcMs ||
    nowUtcMs - entry.capturedAtUtcMs > maxAgeMs ||
    (entry.representation !== "html" && entry.representation !== "rsc") ||
    !Number.isSafeInteger(entry.storedBytes) ||
    entry.storedBytes <= 0 ||
    entry.storedBytes > PUBLIC_RESPONSE_FALLBACK_MAX_ENTRY_BYTES ||
    entry.bodyTemplate.includes('data-vcc-stale-response="true"') ||
    !Array.isArray(entry.headers) ||
    entry.headers.length > STORED_RESPONSE_HEADERS.length
  ) {
    return false;
  }
  if (
    entry.representation === "html" &&
    !entry.bodyTemplate.includes(PUBLIC_RESPONSE_FALLBACK_NONCE_PLACEHOLDER)
  ) {
    return false;
  }
  if (
    entry.representation === "html" &&
    (!/^\s*<!doctype html\b/iu.test(entry.bodyTemplate) ||
      !/<html\b/iu.test(entry.bodyTemplate) ||
      !/<\/body\s*>/iu.test(entry.bodyTemplate) ||
      !/<\/html\s*>/iu.test(entry.bodyTemplate))
  ) {
    return false;
  }
  if (
    entry.representation === "rsc" &&
    !validReactFlightBody(
      entry.bodyTemplate,
      PUBLIC_RESPONSE_FALLBACK_NONCE_PLACEHOLDER,
    )
  ) {
    return false;
  }
  const headers = new Headers();
  const seen = new Set<string>();
  for (const pair of entry.headers) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== "string" ||
      typeof pair[1] !== "string"
    ) {
      return false;
    }
    const name = pair[0].toLowerCase();
    if (
      pair[0] !== name ||
      !STORED_RESPONSE_HEADERS.some((allowed) => allowed === name) ||
      seen.has(name) ||
      utf8Bytes(pair[1]) > 4_096 ||
      /[\u0000\r\n]/u.test(pair[1])
    ) {
      return false;
    }
    seen.add(name);
    headers.set(name, pair[1]);
  }
  const contentType = (headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    (entry.representation === "html" && contentType !== "text/html") ||
    (entry.representation === "rsc" && contentType !== "text/x-component")
  ) {
    return false;
  }
  const vary = headers.get("vary");
  if (vary) {
    const names = vary
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);
    if (
      names.length === 0 ||
      names.includes("*") ||
      names.some((name) => !ALLOWED_VARY_HEADERS.has(name))
    ) {
      return false;
    }
  }
  return (
    storedResponseBytes(key, entry.bodyTemplate, entry.headers) ===
    entry.storedBytes
  );
}

function isFallbackFailure(failure: PublicResponseFallbackFailure): boolean {
  return failure.kind === "throw" ||
    (failure.kind === "response" &&
      Number.isInteger(failure.status) &&
      failure.status >= 500 &&
      failure.status <= 599);
}

function validNonce(value: string | null): value is string {
  return typeof value === "string" && NONCE_PATTERN.test(value);
}

function boundedOption(
  value: number | undefined,
  fallback: number,
  allowZero = false,
): number {
  if (value === undefined) return fallback;
  if (
    !Number.isSafeInteger(value) ||
    (allowZero ? value < 0 : value <= 0)
  ) {
    throw new TypeError("Public response fallback bounds must be safe integers.");
  }
  return value;
}

function safeNow(clock: () => number): number {
  const value = clock();
  return safeTimestamp(value);
}

function safeTimestamp(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError("Public response fallback clock must be finite.");
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Public response fallback time must be a safe integer.");
  }
  return value;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
