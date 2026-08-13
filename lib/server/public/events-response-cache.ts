import { writeSafeLog } from "@/lib/validation/server-observability";

export const PUBLIC_EVENTS_RESPONSE_CACHE_TTL_SECONDS = 30;
export const PUBLIC_EVENTS_RESPONSE_CACHE_MAX_BYTES = 1_500_000;
export const PUBLIC_EVENTS_RESPONSE_NONCE_PLACEHOLDER =
  "vccnonceplaceholder001";

const CACHE_SCHEMA_VERSION = 1;
const CACHE_PATH = "/.__vcc-cache/public-events-response";
const ALLOWED_QUERY_PARAMETERS = new Set(["_rsc", "lane", "month"]);
const ALLOWED_INFRASTRUCTURE_COOKIE_NAMES = new Set([
  "__cf_bm",
  "_cfuvid",
  "cf_clearance",
]);
const REPRESENTATION_HEADERS = [
  "accept",
  "next-router-prefetch",
  "next-router-segment-prefetch",
  "next-router-state-tree",
  "next-url",
  "rsc",
  "x-vinext-interception-context",
  "x-vinext-mounted-slots",
  "x-vinext-rsc-render-mode",
] as const;
const BYPASS_HEADERS = [
  "authorization",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "range",
] as const;
const MAX_CACHE_QUERY_VALUE_BYTES = 256;
const MAX_RSC_CACHE_BUSTER_BYTES = 128;
const MAX_VARIANT_HEADER_BYTES = 32_768;

export type PublicEventsResponseCache = Readonly<{
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}>;

export type PublicEventsResponseCacheContext = Readonly<{
  cache: PublicEventsResponseCache;
  cacheRequest: Request;
  head: boolean;
  representation: "html" | "rsc";
}>;

export type PreparedPublicEventsResponse = Readonly<{
  cacheResponse: Response | null;
  response: Response;
}>;

/**
 * Resolves the exact anonymous public Events variants that are safe to cache.
 * The opaque key includes every vinext response-variation header and the
 * compiled source revision. Private, conditional, and caller-personalized
 * requests always continue through the ordinary renderer.
 */
export async function publicEventsResponseCacheContext(
  request: Request,
  normalizedPathname: string,
  cache: PublicEventsResponseCache | null,
  sourceRevision = runtimeSourceRevision(),
): Promise<PublicEventsResponseCacheContext | null> {
  if (!cache || (request.method !== "GET" && request.method !== "HEAD")) {
    return null;
  }
  const representation =
    normalizedPathname === "/events"
      ? "html"
      : normalizedPathname === "/events.rsc"
        ? "rsc"
        : null;
  if (!representation) return null;

  const url = new URL(request.url);
  if (representation === "html" && url.searchParams.has("_rsc")) return null;
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return null;
  }
  for (const [name] of url.searchParams) {
    if (!ALLOWED_QUERY_PARAMETERS.has(name)) return null;
  }
  for (const name of ALLOWED_QUERY_PARAMETERS) {
    if (url.searchParams.getAll(name).length > 1) return null;
  }
  for (const [name, value] of url.searchParams) {
    if (value.length > MAX_CACHE_QUERY_VALUE_BYTES) return null;
    if (
      name === "_rsc" &&
      (value.length === 0 ||
        value.length > MAX_RSC_CACHE_BUSTER_BYTES ||
        !/^[A-Za-z0-9_-]+$/u.test(value))
    ) {
      return null;
    }
  }
  if (BYPASS_HEADERS.some((name) => request.headers.has(name))) return null;
  if (!hasOnlyInfrastructureCookies(request.headers.get("cookie"))) return null;
  for (const name of request.headers.keys()) {
    if (name.startsWith("oai-authenticated-user-")) return null;
  }
  if (requestsFreshRepresentation(request.headers)) return null;

  const normalizedSearch = new URLSearchParams(url.searchParams);
  // Next/vinext changes this transport cache-buster on every navigation. The
  // RSC variant headers and semantic query values determine the response.
  normalizedSearch.delete("_rsc");
  normalizedSearch.sort();
  const variantHeaders: Array<readonly [string, string]> = [];
  let variantBytes = 0;
  for (const name of REPRESENTATION_HEADERS) {
    const value = request.headers.get(name) ?? "";
    variantBytes += name.length + value.length;
    if (variantBytes > MAX_VARIANT_HEADER_BYTES) return null;
    variantHeaders.push([name, value]);
  }
  const variant = JSON.stringify({
    headers: variantHeaders,
    pathname: normalizedPathname,
    search: normalizedSearch.toString(),
    sourceRevision,
  });
  const digest = await sha256Hex(variant);
  const cacheUrl = new URL(CACHE_PATH, url.origin);
  cacheUrl.searchParams.set("key", digest);
  return Object.freeze({
    cache,
    cacheRequest: new Request(cacheUrl, { method: "GET" }),
    head: request.method === "HEAD",
    representation,
  });
}

function hasOnlyInfrastructureCookies(value: string | null): boolean {
  if (value === null) return true;
  if (value.trim() === "" || value.length > 8_192) return false;
  return value.split(";").every((part) => {
    const separator = part.indexOf("=");
    if (separator <= 0) return false;
    const name = part.slice(0, separator).trim();
    return ALLOWED_INFRASTRUCTURE_COOKIE_NAMES.has(name);
  });
}

export async function readPublicEventsResponseCache(
  context: PublicEventsResponseCacheContext,
): Promise<Response | null> {
  let cached: Response | undefined;
  try {
    cached = await context.cache.match(context.cacheRequest);
  } catch {
    writeCacheWarning("read_public_events_response_cache");
    return null;
  }
  if (!cached || !isValidCachedResponse(cached, context)) return null;
  try {
    const bytes = await cached.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > PUBLIC_EVENTS_RESPONSE_CACHE_MAX_BYTES) {
      return null;
    }
    const body = new TextDecoder().decode(bytes);
    if (
      context.representation === "html" &&
      !body.includes(PUBLIC_EVENTS_RESPONSE_NONCE_PLACEHOLDER)
    ) {
      return null;
    }
    return responseFromCachedBody(body, cached.headers, context.head);
  } catch {
    writeCacheWarning("parse_public_events_response_cache");
    return null;
  }
}

/**
 * Materializes one bounded text response so its placeholder nonce can be
 * replaced before delivery. The internal cache copy keeps the placeholder;
 * the visitor copy never does.
 */
export async function preparePublicEventsResponse(
  response: Response,
  context: PublicEventsResponseCacheContext,
  freshNonce: string,
): Promise<PreparedPublicEventsResponse> {
  assertFreshNonce(freshNonce);
  const bytes = await response.arrayBuffer();
  const placeholderBody = new TextDecoder().decode(bytes);
  const visitorBody = placeholderBody.replaceAll(
    PUBLIC_EVENTS_RESPONSE_NONCE_PLACEHOLDER,
    freshNonce,
  );
  const visitorHeaders = visitorResponseHeaders(response.headers);
  const visitorResponse = new Response(
    context.head ? null : visitorBody,
    {
      headers: visitorHeaders,
      status: response.status,
      statusText: response.statusText,
    },
  );
  const cacheResponse = isCacheableResponse(
    response,
    context,
    bytes.byteLength,
    placeholderBody,
  )
    ? responseForCache(placeholderBody, response.headers, context)
    : null;
  return Object.freeze({ cacheResponse, response: visitorResponse });
}

export async function rehydratePublicEventsCachedResponse(
  cached: Response,
  freshNonce: string,
): Promise<Response> {
  assertFreshNonce(freshNonce);
  if (cached.body === null) return cached;
  const body = await cached.text();
  return new Response(
    body.replaceAll(PUBLIC_EVENTS_RESPONSE_NONCE_PLACEHOLDER, freshNonce),
    {
      headers: visitorResponseHeaders(cached.headers),
      status: cached.status,
      statusText: cached.statusText,
    },
  );
}

export async function writePublicEventsResponseCache(
  context: PublicEventsResponseCacheContext,
  response: Response,
): Promise<void> {
  try {
    await context.cache.put(context.cacheRequest, response);
  } catch {
    writeCacheWarning("write_public_events_response_cache");
  }
}

function requestsFreshRepresentation(headers: Headers): boolean {
  const cacheControl = headers.get("cache-control") ?? "";
  const pragma = headers.get("pragma") ?? "";
  return (
    /(?:^|,)\s*(?:no-cache|no-store|max-age\s*=\s*0)(?:\s*(?:,|$))/iu.test(
      cacheControl,
    ) ||
    /(?:^|,)\s*no-cache(?:\s*(?:,|$))/iu.test(pragma)
  );
}

function isValidCachedResponse(
  response: Response,
  context: PublicEventsResponseCacheContext,
): boolean {
  if (
    response.status !== 200 ||
    response.headers.has("set-cookie") ||
    response.headers.get("x-vcc-events-cache-version") !==
      String(CACHE_SCHEMA_VERSION) ||
    response.headers.get("x-vcc-events-cache-kind") !==
      context.representation
  ) {
    return false;
  }
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) ||
      Number(contentLength) > PUBLIC_EVENTS_RESPONSE_CACHE_MAX_BYTES)
  ) {
    return false;
  }
  return contentTypeMatches(
    response.headers.get("content-type"),
    context.representation,
  );
}

function isCacheableResponse(
  response: Response,
  context: PublicEventsResponseCacheContext,
  byteLength: number,
  placeholderBody: string,
): boolean {
  if (
    context.head ||
    response.status !== 200 ||
    response.headers.has("set-cookie") ||
    byteLength === 0 ||
    byteLength > PUBLIC_EVENTS_RESPONSE_CACHE_MAX_BYTES ||
    !contentTypeMatches(
      response.headers.get("content-type"),
      context.representation,
    ) ||
    response.headers.get("vary")?.trim() === "*"
  ) {
    return false;
  }
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (/(?:^|,)\s*private(?:\s*(?:,|=|$))/iu.test(cacheControl)) {
    return false;
  }
  return (
    context.representation !== "html" ||
    placeholderBody.includes(PUBLIC_EVENTS_RESPONSE_NONCE_PLACEHOLDER)
  );
}

function contentTypeMatches(
  value: string | null,
  representation: "html" | "rsc",
): boolean {
  if (!value) return false;
  return representation === "html"
    ? /^text\/html(?:\s*;|$)/iu.test(value)
    : /^text\/x-component(?:\s*;|$)/iu.test(value);
}

function responseForCache(
  body: string,
  sourceHeaders: Headers,
  context: PublicEventsResponseCacheContext,
): Response {
  const headers = new Headers(sourceHeaders);
  stripUnsafeCacheHeaders(headers);
  headers.set(
    "Cache-Control",
    `public, max-age=${PUBLIC_EVENTS_RESPONSE_CACHE_TTL_SECONDS}`,
  );
  headers.set("X-VCC-Events-Cache-Kind", context.representation);
  headers.set("X-VCC-Events-Cache-Version", String(CACHE_SCHEMA_VERSION));
  return new Response(body, { headers, status: 200 });
}

function responseFromCachedBody(
  body: string,
  sourceHeaders: Headers,
  head: boolean,
): Response {
  return new Response(head ? null : body, {
    headers: visitorResponseHeaders(sourceHeaders),
    status: 200,
  });
}

function visitorResponseHeaders(sourceHeaders: Headers): Headers {
  const headers = new Headers(sourceHeaders);
  headers.delete("Content-Length");
  headers.delete("X-VCC-Events-Cache-Kind");
  headers.delete("X-VCC-Events-Cache-Version");
  headers.set("Cache-Control", "no-store, must-revalidate");
  return headers;
}

function stripUnsafeCacheHeaders(headers: Headers): void {
  headers.delete("Content-Length");
  headers.delete("Content-Security-Policy");
  headers.delete("Content-Security-Policy-Report-Only");
  headers.delete("Pragma");
  headers.delete("Set-Cookie");
  headers.delete("X-Robots-Tag");
}

function assertFreshNonce(value: string): void {
  if (!/^[A-Za-z0-9_-]{22}$/u.test(value)) {
    throw new Error("The Events response nonce is invalid.");
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function runtimeSourceRevision(): string {
  return typeof __VCC_SOURCE_REVISION__ === "string"
    ? __VCC_SOURCE_REVISION__
    : "development";
}

function writeCacheWarning(operation: string): void {
  writeSafeLog("warn", "public_events_response_cache_unavailable", {
    code: "partial_failure",
    operation,
    route: "/events",
    status: 200,
  });
}
