const PUBLIC_SERVICE_UNAVAILABLE_DIGEST =
  "NEXT_HTTP_ERROR_FALLBACK;503";

export type PublicServiceSurface = "events" | "home";

/**
 * Uses the Sites/vinext App Router HTTP fallback path so a server-side public
 * data failure becomes an actual 503 before the response starts streaming.
 * Ordinary route error boundaries in the pinned runtime render with status
 * 200, which is not truthful for an unavailable public data service.
 */
export function publicServiceUnavailable(): never {
  const error = new Error(
    "The public data service is temporarily unavailable.",
  ) as Error & { digest: string };
  error.digest = PUBLIC_SERVICE_UNAVAILABLE_DIGEST;
  throw error;
}

export function publicServiceSurfaceForPathname(
  pathname: string | null,
): PublicServiceSurface | null {
  const normalized = normalizeAppRouterPathname(pathname);
  if (normalized === "/") return "home";
  if (normalized === "/events") return "events";
  return null;
}

function normalizeAppRouterPathname(pathname: string | null): string | null {
  if (!pathname) return null;
  return pathname.endsWith(".rsc") ? pathname.slice(0, -4) || "/" : pathname;
}
