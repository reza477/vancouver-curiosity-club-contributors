"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, type KeyboardEvent } from "react";
import type { PublicNavigationItemDto } from "@/lib/server/public/catalog";

const requiredNavigation = [
  { href: "/calendar", label: "Calendar" },
  { href: "/events", label: "Events" },
  { href: "/clubs", label: "Clubs" },
  { href: "/community", label: "Community" },
  { href: "/about", label: "About" },
  { href: "/get-involved", label: "Get Involved" },
  { href: "/organizer", label: "Organizer Login" },
] as const;

export function SiteHeader({
  brandName = "Vancouver Curiosity Club",
  logoAssetId = null,
  navigation = [],
  privateMedia = false,
}: Readonly<{
  brandName?: string;
  logoAssetId?: string | null;
  navigation?: readonly PublicNavigationItemDto[];
  privateMedia?: boolean;
}>) {
  const primaryNavigation = normalizedPrimaryNavigation(navigation);
  const compactNavigation =
    primaryNavigation.length > requiredNavigation.length ||
    primaryNavigation.reduce(
      (length, item) => length + item.label.length,
      0,
    ) > 72;
  const mobileMenu = useRef<HTMLDetailsElement>(null);
  const closeMobileMenu = () => {
    if (mobileMenu.current) mobileMenu.current.open = false;
  };
  const closeMobileMenuWithEscape = (
    event: KeyboardEvent<HTMLDetailsElement>,
  ) => {
    if (event.key !== "Escape" || !mobileMenu.current?.open) return;
    event.preventDefault();
    mobileMenu.current.open = false;
    mobileMenu.current.querySelector("summary")?.focus();
  };
  return (
    <header
      className={`site-header${
        compactNavigation ? " site-header--compact-navigation" : ""
      }`}
    >
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
        className="primary-nav primary-nav--desktop"
        aria-label="Primary navigation"
      >
        <NavigationLinks navigation={primaryNavigation} />
      </nav>

      <details
        className="site-navigation"
        onKeyDown={closeMobileMenuWithEscape}
        ref={mobileMenu}
      >
        <summary>
          <span>Menu</span>
          <span className="nav-menu-icon" aria-hidden="true" />
        </summary>
        <nav
          className="primary-nav primary-nav--mobile"
          aria-label="Primary navigation menu"
        >
          <NavigationLinks
            navigation={primaryNavigation}
            onNavigate={closeMobileMenu}
          />
        </nav>
      </details>
    </header>
  );
}

function NavigationLinks({
  navigation,
  onNavigate,
}: Readonly<{
  navigation: readonly PublicNavigationItemDto[];
  onNavigate?: () => void;
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
            className={[
              item.href === "/calendar" ? "calendar-link" : "",
              item.href === "/organizer" ? "portal-link" : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined}
            href={item.href}
            key={item.href}
            onClick={onNavigate}
            prefetch={false}
          >
            {item.label}
          </Link>
        ) : (
          <a
            href={item.href}
            key={item.href}
            onClick={onNavigate}
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

function normalizedPrimaryNavigation(
  configured: readonly PublicNavigationItemDto[],
): readonly PublicNavigationItemDto[] {
  const configuredByHref = new Map(
    configured.map((item) => [item.href, item]),
  );
  const requiredTargets = new Set<string>(
    requiredNavigation.map((item) => item.href),
  );
  const required = requiredNavigation.map((item) => {
    const configuredItem = configuredByHref.get(item.href);
    if (
      item.href === "/calendar" ||
      item.href === "/events" ||
      item.href === "/organizer"
    ) {
      return item;
    }
    return configuredItem ?? item;
  });
  const optional = configured
    .filter((item) => !requiredTargets.has(item.href))
    .filter(
      (item, index, source) =>
        source.findIndex((candidate) => candidate.href === item.href) ===
        index,
    )
    .slice(0, 1);
  return Object.freeze(
    [...required.slice(0, -1), ...optional, required.at(-1)!],
  );
}

function isCurrentNavigationPath(
  pathname: string,
  href: string,
): boolean {
  return (
    href.startsWith("/") &&
    (pathname === href || pathname.startsWith(`${href}/`))
  );
}
