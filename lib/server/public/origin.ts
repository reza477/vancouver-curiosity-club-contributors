import { headers } from "next/headers";
import { isCanonicalTrustedRequestPathname } from "../../request-pathname";

export const TRUSTED_REQUEST_ORIGIN_HEADER = "x-vcc-request-origin";
export const TRUSTED_REQUEST_PATHNAME_HEADER = "x-vcc-request-pathname";
export const TRUSTED_CSP_NONCE_HEADER = "x-vcc-csp-nonce";

/**
 * Reads the request origin that the Worker derives from Request.url and
 * overwrites before vinext dispatch. Client-provided forwarded-host headers
 * are deliberately not part of this trust boundary.
 */
export async function getTrustedRequestOrigin(): Promise<URL | null> {
  const requestHeaders = await headers();
  return parseTrustedRequestOrigin(
    requestHeaders.get(TRUSTED_REQUEST_ORIGIN_HEADER),
  );
}

export async function getTrustedRequestPathname(): Promise<string | null> {
  const requestHeaders = await headers();
  return parseTrustedRequestPathname(
    requestHeaders.get(TRUSTED_REQUEST_PATHNAME_HEADER),
  );
}

export async function getTrustedCspNonce(): Promise<string | null> {
  const requestHeaders = await headers();
  const value = requestHeaders.get(TRUSTED_CSP_NONCE_HEADER);
  return typeof value === "string" && /^[A-Za-z0-9_-]{22}$/u.test(value)
    ? value
    : null;
}

export function parseTrustedRequestOrigin(value: unknown): URL | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    return null;
  }

  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    return null;
  }

  const isLocalHttp =
    origin.protocol === "http:" &&
    (origin.hostname === "localhost" ||
      origin.hostname === "127.0.0.1" ||
      origin.hostname === "[::1]" ||
      origin.hostname === "::1");
  if (origin.protocol !== "https:" && !isLocalHttp) return null;
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    return null;
  }

  return origin.origin === value ? origin : null;
}

export function parseTrustedRequestPathname(value: unknown): string | null {
  return isCanonicalTrustedRequestPathname(value) ? value : null;
}

export function publicUrl(pathname: string, origin: URL): string {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    throw new TypeError("Public URL paths must be same-origin absolute paths.");
  }
  const resolved = new URL(pathname, origin);
  if (resolved.origin !== origin.origin) {
    throw new TypeError("Public URL paths must remain on the request origin.");
  }
  return resolved.toString();
}
