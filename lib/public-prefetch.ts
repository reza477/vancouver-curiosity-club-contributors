export type PublicLinkHref =
  | string
  | Readonly<{ pathname?: string | null }>;

export type PublicLinkPrefetch = boolean | "auto" | null | undefined;

/**
 * These public destinations render dynamic, data-backed discovery surfaces.
 * A speculative request can still be in flight when Vinext starts navigation,
 * so prefetching them can duplicate the same expensive RSC render.
 */
export function isExpensivePublicRouteHref(href: PublicLinkHref): boolean {
  const pathname = publicPathname(href);
  if (!pathname) return false;
  return (
    pathname === "/" ||
    pathname === "/contact" ||
    pathname === "/calendar" ||
    pathname.startsWith("/calendar/") ||
    pathname === "/events" ||
    pathname.startsWith("/events/") ||
    pathname === "/clubs" ||
    pathname.startsWith("/clubs/")
  );
}

/**
 * Keep ordinary public links on framework-managed automatic prefetching, while
 * preserving an explicit caller opt-out and disabling speculative work for the
 * data-heavy destinations above. Returning "auto" also prevents a broad
 * `true` setting from forcing full prefetches for dynamic routes.
 */
export function publicRoutePrefetch(
  href: PublicLinkHref,
  requested: PublicLinkPrefetch = "auto",
): false | "auto" {
  if (
    requested === false ||
    (typeof href === "string" && href.startsWith("#")) ||
    isExpensivePublicRouteHref(href)
  ) {
    return false;
  }
  return "auto";
}

function publicPathname(href: PublicLinkHref): string | null {
  const value = typeof href === "string" ? href : href.pathname;
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  return value.split(/[?#]/u, 1)[0] || "/";
}
