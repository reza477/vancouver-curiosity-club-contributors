"use client";

import Image from "next/image";
import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import { usePathname } from "next/navigation";
import type { PublicNavigationItemDto } from "@/lib/server/public/catalog";

const requiredNavigation = [
  { href: "/events", label: "Events" },
  { href: "/clubs", label: "Clubs" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Feedback" },
] as const;

export function SiteHeader({
  brandName = "Vancouver Curiosity Club",
  logoAssetId = null,
  navigation = [],
  prefetchInternalLinks = true,
  privateMedia = false,
}: Readonly<{
  brandName?: string;
  logoAssetId?: string | null;
  navigation?: readonly PublicNavigationItemDto[];
  prefetchInternalLinks?: boolean;
  privateMedia?: boolean;
}>) {
  const primaryNavigation = normalizedPrimaryNavigation(navigation);
  return (
    <header className="site-header">
      <Link
        className="wordmark"
        href="/"
        aria-label={`${brandName} home`}
        prefetch={prefetchInternalLinks}
      >
        {logoAssetId ? (
          <Image
            alt=""
            className="wordmark-logo"
            height={44}
            src={
              privateMedia
                ? `/api/organizer/media/${encodeURIComponent(
                    logoAssetId,
                  )}/variants/webp_480`
                : `/media/${encodeURIComponent(logoAssetId)}/webp_480`
            }
            unoptimized
            width={44}
          />
        ) : (
          <span className="wordmark-mark" aria-hidden="true" />
        )}
        <span>{brandName}</span>
      </Link>

      <nav
        className="primary-nav"
        aria-label="Primary navigation"
      >
        <NavigationLinks
          navigation={primaryNavigation}
          prefetchInternalLinks={prefetchInternalLinks}
        />
      </nav>
    </header>
  );
}

function NavigationLinks({
  navigation,
  prefetchInternalLinks,
}: Readonly<{
  navigation: readonly PublicNavigationItemDto[];
  prefetchInternalLinks: boolean;
}>) {
  const pathname = usePathname();
  return (
    <>
      {navigation.map((item) =>
        item.href.startsWith("/") ? (
          <Link
            aria-current={
              isCurrentNavigationPath(pathname, item.href)
                ? "page"
                : undefined
            }
            className="primary-nav__link"
            data-primary-destination={item.label.toLowerCase()}
            href={item.href}
            key={item.href}
            prefetch={prefetchInternalLinks}
          >
            {item.label}
          </Link>
        ) : (
          <a
            href={item.href}
            key={item.href}
            rel="noreferrer noopener"
            target="_blank"
          >
            {item.label}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ),
      )}
    </>
  );
}

export function normalizedPrimaryNavigation(
  configured: readonly PublicNavigationItemDto[],
): readonly PublicNavigationItemDto[] {
  const requiredByHref = new Map<
    string,
    (typeof requiredNavigation)[number]
  >(
    requiredNavigation.map((item) => [item.href, item]),
  );
  const seen = new Set<string>();
  const primary: PublicNavigationItemDto[] = [];
  for (const sourceItem of configured) {
    const normalizedHref =
      sourceItem.href === "/calendar" ? "/events" : sourceItem.href;
    const required = requiredByHref.get(normalizedHref);
    if (!required || seen.has(normalizedHref)) continue;
    seen.add(normalizedHref);
    primary.push(required);
  }
  for (const required of requiredNavigation) {
    if (seen.has(required.href)) continue;
    primary.push(required);
  }
  return Object.freeze(primary);
}

function isCurrentNavigationPath(
  pathname: string,
  href: string,
): boolean {
  return (
    href.startsWith("/") &&
    ((href === "/events" &&
        (pathname === "/events" ||
          pathname.startsWith("/events/") ||
          pathname === "/calendar")) ||
      pathname === href ||
      pathname.startsWith(`${href}/`))
  );
}
