export const CANONICAL_PUBLIC_ORIGIN =
  "https://vancouvercuriosityclub.com";

const CANONICAL_PUBLIC_HOSTNAME = "vancouvercuriosityclub.com";
const LOCAL_DEVELOPMENT_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);
const REDIRECT_SOURCE_HOSTNAMES = new Set([
  "www.vancouvercuriosityclub.com",
  "vancouvercuriosityclub.ca",
  "www.vancouvercuriosityclub.ca",
  "vancouver-curiosity-club.reza5777.chatgpt.site",
]);

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/u, "");
}

/**
 * Returns the canonical public destination for requests received on an
 * alternate production hostname. A 308 preserves method and body for stale
 * clients while the target app's normal origin and anti-forgery checks remain
 * authoritative.
 */
export function canonicalPublicRedirectTarget(
  requestUrl: URL,
): URL | null {
  if (!REDIRECT_SOURCE_HOSTNAMES.has(normalizedHostname(requestUrl))) {
    return null;
  }

  const destination = new URL(requestUrl);
  destination.protocol = "https:";
  destination.hostname = CANONICAL_PUBLIC_HOSTNAME;
  destination.port = "";
  destination.username = "";
  destination.password = "";
  return destination;
}

/**
 * Production metadata always points at the public apex domain, regardless of
 * which Sites dispatch hostname reached the Worker. Local and packaged-render
 * test origins remain request-relative so development continues to work.
 */
export function trustedPublicRequestOrigin(requestUrl: URL): string {
  const hostname = normalizedHostname(requestUrl);
  if (
    LOCAL_DEVELOPMENT_HOSTNAMES.has(hostname) ||
    hostname === "preview.example"
  ) {
    return requestUrl.origin;
  }
  return CANONICAL_PUBLIC_ORIGIN;
}
