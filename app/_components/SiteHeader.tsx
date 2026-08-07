"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PublicNavigationItemDto } from "@/lib/server/public/catalog";

const requiredNavigation = [
  { href: "/events", label: "Events" },
  { href: "/clubs", label: "Clubs" },
  { href: "/about", label: "About" },
  { href: "/host-an-event", label: "Host an Event" },
] as const;

export function SiteHeader({
  brandName = "Vancouver Curiosity Club",
  logoAssetId = null,
  privateMedia = false,
}: Readonly<{
  brandName?: string;
  logoAssetId?: string | null;
  navigation?: readonly PublicNavigationItemDto[];
  privateMedia?: boolean;
}>) {
  const primaryNavigation = normalizedPrimaryNavigation();
  return (
    <header className="site-header">
      <Link
        className="wordmark"
        href="/"
        aria-label={`${brandName} home`}
        prefetch={false}
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
        <NavigationLinks navigation={primaryNavigation} />
      </nav>
    </header>
  );
}

function NavigationLinks({
  navigation,
}: Readonly<{
  navigation: readonly PublicNavigationItemDto[];
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
            prefetch={false}
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

function normalizedPrimaryNavigation(): readonly PublicNavigationItemDto[] {
  return Object.freeze(requiredNavigation);
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
