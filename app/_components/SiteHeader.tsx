"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, type KeyboardEvent } from "react";
import type { PublicNavigationItemDto } from "@/lib/server/public/catalog";

const requiredNavigation = [
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
  return (
    <>
      {navigation.map((item) =>
        item.href.startsWith("/") ? (
          <Link
            className={
              item.href === "/organizer" ? "portal-link" : undefined
            }
            href={item.href}
            key={item.href}
            onClick={onNavigate}
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
          </a>
        ),
      )}
    </>
  );
}

function normalizedPrimaryNavigation(
  configured: readonly PublicNavigationItemDto[],
): readonly PublicNavigationItemDto[] {
  const source =
    configured.length > 0 ? configured : requiredNavigation;
  const candidates: PublicNavigationItemDto[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    if (seen.has(item.href)) continue;
    seen.add(item.href);
    candidates.push(
      item.href === "/organizer"
        ? Object.freeze({ href: "/organizer", label: "Organizer Login" })
        : item,
    );
  }
  for (const required of requiredNavigation) {
    if (seen.has(required.href)) continue;
    candidates.push(required);
  }
  const requiredTargets = new Set<string>(
    requiredNavigation.map((item) => item.href),
  );
  const optionalTargets = new Set(
    candidates
      .filter((item) => !requiredTargets.has(item.href))
      .slice(0, 12 - requiredNavigation.length)
      .map((item) => item.href),
  );
  return Object.freeze(
    candidates.filter(
      (item) =>
        requiredTargets.has(item.href) || optionalTargets.has(item.href),
    ),
  );
}
