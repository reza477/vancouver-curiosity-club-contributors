import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import type { PublicNavigationItemDto } from "@/lib/server/public/catalog";

type ExternalLink = Readonly<{
  href: string;
  label: string;
}>;

export function SiteFooter({
  externalLinks = [],
  brandName = "Vancouver Curiosity Club",
  legalFooter = null,
  legalName = null,
  location = "Vancouver, British Columbia",
  mission = null,
  navigation = [],
  prefetchInternalLinks = true,
}: Readonly<{
  brandName?: string;
  externalLinks?: readonly ExternalLink[];
  legalFooter?: string | null;
  legalName?: string | null;
  location?: string;
  mission?: string | null;
  navigation?: readonly PublicNavigationItemDto[];
  prefetchInternalLinks?: boolean;
}>) {
  const footerNavigation = normalizedFooterNavigation(navigation);
  return (
    <footer className="site-footer">
      <div className="site-footer__brand">
        <p className="footer-wordmark">{brandName}</p>
        <p className="footer-location">{location}</p>
        {mission ? <p className="footer-mission">{mission}</p> : null}
        {legalName && legalName !== brandName ? (
          <p className="footer-legal-name">Legal name: {legalName}</p>
        ) : null}
      </div>

      <nav className="site-footer__navigation" aria-label="Footer navigation">
        <div className="footer-nav-group">
          <h2>Explore</h2>
          {footerNavigation.explore.map((item) => (
            <FooterLink
              item={item}
              key={item.href}
              prefetchInternalLinks={prefetchInternalLinks}
            />
          ))}
        </div>
        <div className="footer-nav-group">
          <h2>Participate</h2>
          {footerNavigation.participate.map((item) => (
            <FooterLink
              item={item}
              key={item.href}
              prefetchInternalLinks={prefetchInternalLinks}
            />
          ))}
        </div>
        <div className="footer-nav-group">
          <h2>Community information</h2>
          {footerNavigation.policies.map((item) => (
            <FooterLink
              item={item}
              key={item.href}
              prefetchInternalLinks={prefetchInternalLinks}
            />
          ))}
          <Link href="/organizer" prefetch={false}>
            Organizer Login
          </Link>
        </div>
        {externalLinks.length > 0 ? (
          <div className="footer-nav-group">
            <h2>Elsewhere</h2>
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
  prefetchInternalLinks,
}: Readonly<{
  item: PublicNavigationItemDto;
  prefetchInternalLinks: boolean;
}>) {
  return item.href.startsWith("/") ? (
    <Link
      href={item.href}
      prefetch={prefetchInternalLinks}
    >
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
  participate: readonly PublicNavigationItemDto[];
  policies: readonly PublicNavigationItemDto[];
}> {
  const fallbackExplore = [
    { href: "/events", label: "Events" },
    { href: "/clubs", label: "Clubs" },
    { href: "/about", label: "About" },
    { href: "/for-organizations", label: "For Organizations" },
  ] as const;
  const fallbackParticipate = [
    { href: "/get-involved", label: "Get Involved" },
    { href: "/host-an-event", label: "Host an Event" },
    { href: "/contact", label: "Contact" },
  ] as const;
  const fallbackPolicies = [
    { href: "/conduct", label: "Code of Conduct" },
    { href: "/privacy", label: "Privacy" },
  ] as const;
  const source = [
    ...fallbackExplore,
    ...fallbackParticipate,
    ...fallbackPolicies,
    ...configured,
  ];
  const policyTargets = new Set<string>(
    fallbackPolicies.map((item) => item.href),
  );
  const participateTargets = new Set<string>(
    fallbackParticipate.map((item) => item.href),
  );
  const seen = new Set<string>();
  const explore: PublicNavigationItemDto[] = [];
  const participate: PublicNavigationItemDto[] = [];
  const policies: PublicNavigationItemDto[] = [];
  for (const sourceItem of source) {
    const normalizedItem =
      sourceItem.href === "/calendar"
        ? { ...sourceItem, href: "/events", label: "Events" }
        : sourceItem;
    const item =
      normalizedItem.href === "/contact"
        ? { ...normalizedItem, label: "Contact" }
        : normalizedItem;
    if (
      item.href === "/organizer" ||
      item.href === "/community" ||
      item.href === "/accessibility" ||
      seen.has(item.href)
    ) {
      continue;
    }
    seen.add(item.href);
    (
      policyTargets.has(item.href)
        ? policies
        : participateTargets.has(item.href)
          ? participate
          : explore
    ).push(item);
  }
  for (const required of [
    ...fallbackExplore,
    ...fallbackParticipate,
    ...fallbackPolicies,
  ]) {
    if (seen.has(required.href)) continue;
    seen.add(required.href);
    (
      policyTargets.has(required.href)
        ? policies
        : participateTargets.has(required.href)
          ? participate
          : explore
    ).push(required);
  }
  const requiredTargets = new Set<string>(
    [...fallbackExplore, ...fallbackParticipate, ...fallbackPolicies].map(
      (item) => item.href,
    ),
  );
  const optionalTargets = new Set(
    [...explore, ...participate, ...policies]
      .filter((item) => !requiredTargets.has(item.href))
      .slice(
        0,
        24 -
          fallbackExplore.length -
          fallbackParticipate.length -
          fallbackPolicies.length,
      )
      .map((item) => item.href),
  );
  const include = (item: PublicNavigationItemDto) =>
    requiredTargets.has(item.href) || optionalTargets.has(item.href);
  return Object.freeze({
    explore: Object.freeze(explore.filter(include)),
    participate: Object.freeze(participate.filter(include)),
    policies: Object.freeze(policies.filter(include)),
  });
}
