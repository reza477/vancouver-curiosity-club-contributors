export const CANONICAL_PUBLIC_ORIGIN =
  "https://vancouvercuriosityclub.com";

const CANONICAL_PUBLIC_HOSTNAME = "vancouvercuriosityclub.com";
const MAX_PUBLIC_SITE_URL_LENGTH = 2_048;
const LOCAL_DEVELOPMENT_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);
const LEGACY_REDIRECT_SOURCE_HOSTNAMES = new Set([
  "www.vancouvercuriosityclub.com",
  "vancouvercuriosityclub.ca",
  "www.vancouvercuriosityclub.ca",
  "vancouver-curiosity-club.reza5777.chatgpt.site",
]);

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/u, "");
}

/**
 * Parses a configured public site URL as one exact HTTPS origin. Invalid,
 * local, credentialed, path-bearing, and non-standard-port values are rejected
 * so runtime configuration cannot turn canonical links into an open redirect.
 */
export function parsePublicSiteOrigin(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_PUBLIC_SITE_URL_LENGTH ||
    value.trim() !== value
  ) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const hostname = normalizedHostname(parsed);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.hostname.endsWith(".") ||
    LOCAL_DEVELOPMENT_HOSTNAMES.has(hostname)
  ) {
    return null;
  }

  return parsed.origin;
}

/**
 * The existing apex remains the fail-safe production origin when Sites has no
 * PUBLIC_SITE_URL binding or when a malformed value is supplied.
 */
export function resolvedPublicSiteOrigin(value: unknown): string {
  return parsePublicSiteOrigin(value) ?? CANONICAL_PUBLIC_ORIGIN;
}

function redirectSourceHostnames(canonicalHostname: string): ReadonlySet<string> {
  const hostnames = new Set(LEGACY_REDIRECT_SOURCE_HOSTNAMES);
  if (canonicalHostname !== CANONICAL_PUBLIC_HOSTNAME) {
    hostnames.add(CANONICAL_PUBLIC_HOSTNAME);
  }
  if (!canonicalHostname.startsWith("www.")) {
    hostnames.add(`www.${canonicalHostname}`);
  }
  hostnames.delete(canonicalHostname);
  return hostnames;
}

/**
 * Returns the canonical public destination for requests received on an
 * alternate production hostname. A 308 preserves method and body for stale
 * clients while the target app's normal origin and anti-forgery checks remain
 * authoritative.
 */
export function canonicalPublicRedirectTarget(
  requestUrl: URL,
  configuredPublicSiteUrl?: unknown,
): URL | null {
  const canonicalOrigin = resolvedPublicSiteOrigin(configuredPublicSiteUrl);
  const canonicalUrl = new URL(canonicalOrigin);
  const canonicalHostname = normalizedHostname(canonicalUrl);
  const redirectSourceHostnamesForOrigin =
    redirectSourceHostnames(canonicalHostname);
  const hostname = normalizedHostname(requestUrl);
  const isCanonicalHostname = hostname === canonicalHostname;
  const isCanonicalOrigin =
    isCanonicalHostname &&
    requestUrl.protocol === "https:" &&
    requestUrl.port === "";
  if (
    !redirectSourceHostnamesForOrigin.has(hostname) &&
    (isCanonicalOrigin || !isCanonicalHostname)
  ) {
    return null;
  }

  const destination = new URL(requestUrl);
  destination.protocol = canonicalUrl.protocol;
  destination.hostname = canonicalUrl.hostname;
  destination.port = canonicalUrl.port;
  destination.username = "";
  destination.password = "";
  return destination;
}

/**
 * Production metadata always points at the configured public apex domain,
 * regardless of which Sites dispatch hostname reached the Worker. Local and
 * packaged-render test origins remain request-relative so development works.
 */
export function trustedPublicRequestOrigin(
  requestUrl: URL,
  configuredPublicSiteUrl?: unknown,
): string {
  const hostname = normalizedHostname(requestUrl);
  if (
    LOCAL_DEVELOPMENT_HOSTNAMES.has(hostname) ||
    hostname === "preview.example"
  ) {
    return requestUrl.origin;
  }
  return resolvedPublicSiteOrigin(configuredPublicSiteUrl);
}
