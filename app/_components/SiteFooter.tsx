import Link from "next/link";

type ExternalLink = Readonly<{
  href: string;
  label: string;
}>;

export function SiteFooter({
  externalLinks = [],
  brandName = "Vancouver Curiosity Club",
  location = "Vancouver, British Columbia",
  mission = null,
}: Readonly<{
  brandName?: string;
  externalLinks?: readonly ExternalLink[];
  location?: string;
  mission?: string | null;
}>) {
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
          <Link href="/events">Events</Link>
          <Link href="/clubs">Clubs</Link>
          <Link href="/community">Community</Link>
          <Link href="/about">About</Link>
          <Link href="/get-involved">Get Involved</Link>
          <Link href="/contact">Contact</Link>
        </div>
        <div className="footer-nav-group">
          <p>Field notes</p>
          <Link href="/conduct">Code of Conduct</Link>
          <Link href="/accessibility">Accessibility</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/organizer">Organizer Login</Link>
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
      </p>
    </footer>
  );
}
