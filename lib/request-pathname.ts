export const MAX_TRUSTED_REQUEST_PATHNAME_LENGTH = 2_048;

const UNSAFE_PATH_SEGMENT = /[%/?#\\\u0000-\u001f\u007f]/u;
const PRIVATE_OR_IDENTITY_PATHS = [
  "/_sites-preview",
  "/organizer",
  "/api",
  "/auth",
  "/accept-invitation",
  "/drafts",
  "/invitations",
  "/preview",
  "/signin-with-chatgpt",
  "/signout-with-chatgpt",
  "/callback",
] as const;

export function isPrivateOrIdentityPath(pathname: string): boolean {
  return (
    isPrivateCalendarSubscriptionPath(pathname) ||
    PRIVATE_OR_IDENTITY_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  );
}

export function isPrivateCalendarSubscriptionPath(
  pathname: string,
): boolean {
  return (
    pathname === "/api/calendar/private" ||
    pathname.startsWith("/api/calendar/private/")
  );
}

export function safeRequestPathname(pathname: string): string {
  return isPrivateCalendarSubscriptionPath(pathname)
    ? "/api/calendar/private/[token]"
    : pathname;
}

/**
 * Canonicalizes the encoded pathname supplied by the platform URL parser.
 *
 * The returned value is safe to use for both vinext dispatch classification
 * and the trusted server-component header. Ambiguous second-pass escapes,
 * decoded URL delimiters, dot segments, controls, and overlong paths fail
 * closed before application dispatch.
 */
export function normalizeEncodedRequestPathname(
  pathname: string,
): string | null {
  if (
    pathname.length === 0 ||
    pathname.length > MAX_TRUSTED_REQUEST_PATHNAME_LENGTH ||
    !pathname.startsWith("/") ||
    pathname.startsWith("//")
  ) {
    return null;
  }
  if (pathname === "/") return "/";

  const segments = pathname.split("/");
  const decoded: string[] = [];
  for (const [index, segment] of segments.entries()) {
    if (index === 0) {
      if (segment !== "") return null;
      decoded.push("");
      continue;
    }
    if (segment.length === 0) return null;

    let value: string;
    try {
      value = decodeURIComponent(segment).normalize("NFC");
    } catch {
      return null;
    }
    if (
      value.length === 0 ||
      value === "." ||
      value === ".." ||
      UNSAFE_PATH_SEGMENT.test(value)
    ) {
      return null;
    }
    decoded.push(value);
  }

  const normalized = decoded.join("/");
  return isCanonicalTrustedRequestPathname(normalized) ? normalized : null;
}

export function isCanonicalTrustedRequestPathname(
  value: unknown,
): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TRUSTED_REQUEST_PATHNAME_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[%?#\\\u0000-\u001f\u007f]/u.test(value)
  ) {
    return false;
  }
  if (value === "/") return true;

  return value
    .slice(1)
    .split("/")
    .every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        segment === segment.normalize("NFC"),
    );
}
