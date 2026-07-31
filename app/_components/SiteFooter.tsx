import Link from "next/link";
import type { PublicNavigationItemDto } from "@/lib/server/public/catalog";

type ExternalLink = Readonly<{
  href: string;
  label: string;
}>;

export function SiteFooter({
  externalLinks = [],
  brandName = "Vancouver Curiosity Club",
  legalFooter = null,
  location = "Vancouver, British Columbia",
  mission = null,
  navigation = [],
}: Readonly<{
  brandName?: string;
  externalLinks?: readonly ExternalLink[];
  legalFooter?: string | null;
  location?: string;
  mission?: string | null;
  navigation?: readonly PublicNavigationItemDto[];
}>) {
  const footerNavigation = normalizedFooterNavigation(navigation);
  return (
    <footer className="site-footer">
      <div className="site-footer__brand">
        <p className="footer-wordmark">{brandName}</p>
        <p className="footer-location">{location}</p>
        {mission ? <p className="footer-mission">{mission}</p> : null}
      </div>

      <nav className="site-footer__navigation" aria-label="Footer navigation">
        <div className="footer-nav-group">
          <p>Explore</p>
          {footerNavigation.explore.map((item) => (
            <FooterLink item={item} key={item.href} />
          ))}
        </div>
        <div className="footer-nav-group">
          <p>Field notes</p>
          {footerNavigation.policies.map((item) => (
            <FooterLink item={item} key={item.href} />
          ))}
          <Link href="/organizer" prefetch={false}>
            Organizer Login
          </Link>
        </div>
        {externalLinks.length > 0 ? (
          <div className="footer-nav-group">
            <p>Elsewhere</p>
            {externalLinks.map((link) => (
              <a
                href={link.href}
                key={link.href}
                rel="noreferrer noopener"
                target="_blank"
              >
                {link.label}
              </a>
            ))}
          </div>
        ) : null}
      </nav>

      <p className="footer-copyright">
        © {new Date().getUTCFullYear()} {brandName}
        {legalFooter ? <span> · {legalFooter}</span> : null}
      </p>
    </footer>
  );
}

function FooterLink({
  item,
}: Readonly<{ item: PublicNavigationItemDto }>) {
  return item.href.startsWith("/") ? (
    <Link href={item.href} prefetch={false}>
      {item.label}
    </Link>
  ) : (
    <a href={item.href} rel="noreferrer noopener" target="_blank">
      {item.label}
    </a>
  );
}

function normalizedFooterNavigation(
  configured: readonly PublicNavigationItemDto[],
): Readonly<{
  explore: readonly PublicNavigationItemDto[];
  policies: readonly PublicNavigationItemDto[];
}> {
  const fallbackExplore = [
    { href: "/calendar", label: "Calendar" },
    { href: "/clubs", label: "Clubs" },
    { href: "/community", label: "Community" },
    { href: "/about", label: "About" },
    { href: "/get-involved", label: "Get Involved" },
    { href: "/contact", label: "Contact" },
  ] as const;
  const fallbackPolicies = [
    { href: "/conduct", label: "Code of Conduct" },
    { href: "/accessibility", label: "Accessibility" },
    { href: "/privacy", label: "Privacy" },
  ] as const;
  const source =
    configured.length > 0
      ? configured
      : [...fallbackExplore, ...fallbackPolicies];
  const policyTargets = new Set<string>(
    fallbackPolicies.map((item) => item.href),
  );
  const seen = new Set<string>();
  const explore: PublicNavigationItemDto[] = [];
  const policies: PublicNavigationItemDto[] = [];
  for (const item of source) {
    if (item.href === "/organizer" || seen.has(item.href)) continue;
    seen.add(item.href);
    (policyTargets.has(item.href) ? policies : explore).push(item);
  }
  for (const required of [...fallbackExplore, ...fallbackPolicies]) {
    if (seen.has(required.href)) continue;
    seen.add(required.href);
    (policyTargets.has(required.href) ? policies : explore).push(required);
  }
  const requiredTargets = new Set<string>(
    [...fallbackExplore, ...fallbackPolicies].map((item) => item.href),
  );
  const optionalTargets = new Set(
    [...explore, ...policies]
      .filter((item) => !requiredTargets.has(item.href))
      .slice(
        0,
        24 - fallbackExplore.length - fallbackPolicies.length,
      )
      .map((item) => item.href),
  );
  const include = (item: PublicNavigationItemDto) =>
    requiredTargets.has(item.href) || optionalTargets.has(item.href);
  return Object.freeze({
    explore: Object.freeze(explore.filter(include)),
    policies: Object.freeze(policies.filter(include)),
  });
}
