"use client";

import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import type { PublicNavigationItemDto } from "@/lib/server/public/catalog";

const requiredNavigation = [
  { href: "/events", label: "Events" },
  { href: "/clubs", label: "Clubs" },
  { href: "/about", label: "About" },
  { href: "/for-organizations", label: "For Organizations" },
  { href: "/contact", label: "Contact" },
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <header
      className="site-header"
      data-mobile-menu-open={mobileMenuOpen ? "true" : "false"}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !mobileMenuOpen) return;
        closeMobileMenu();
        menuButtonRef.current?.focus();
      }}
    >
      <Link
        className="wordmark"
        href="/"
        aria-label={`${brandName} home`}
        prefetch={prefetchInternalLinks}
      >
        {logoAssetId ? (
          // The published logo is already a validated 480px WebP. A native,
          // dimensioned image avoids shipping the full image-loader client
          // shim for this fixed 44px decorative mark.
          // eslint-disable-next-line @next/next/no-img-element
          <img
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
            width={44}
          />
        ) : (
          <span className="wordmark-mark" aria-hidden="true" />
        )}
        <span>{brandName}</span>
      </Link>

      <button
        aria-controls="primary-navigation"
        aria-expanded={mobileMenuOpen}
        className="site-menu-toggle"
        onClick={() => setMobileMenuOpen((open) => !open)}
        ref={menuButtonRef}
        type="button"
      >
        <span>{mobileMenuOpen ? "Close" : "Menu"}</span>
        <span className="site-menu-toggle__icon" aria-hidden="true" />
      </button>

      <nav
        id="primary-navigation"
        className="primary-nav"
        aria-label="Primary navigation"
      >
        <NavigationLinks
          navigation={primaryNavigation}
          onNavigate={closeMobileMenu}
          prefetchInternalLinks={prefetchInternalLinks}
        />
      </nav>
    </header>
  );
}

function NavigationLinks({
  navigation,
  onNavigate,
  prefetchInternalLinks,
}: Readonly<{
  navigation: readonly PublicNavigationItemDto[];
  onNavigate: () => void;
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
            className={
              item.href === "/for-organizations"
                ? "primary-nav__link primary-nav__link--organizations"
                : "primary-nav__link"
            }
            data-primary-destination={item.label.toLowerCase()}
            href={item.href}
            key={item.href}
            onClick={onNavigate}
            prefetch={prefetchInternalLinks}
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

export function normalizedPrimaryNavigation(
  _configured: readonly PublicNavigationItemDto[],
): readonly PublicNavigationItemDto[] {
  void _configured;
  return Object.freeze([...requiredNavigation]);
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
