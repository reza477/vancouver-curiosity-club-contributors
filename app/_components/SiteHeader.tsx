import Link from "next/link";

const primaryNavigation = [
  { href: "/events", label: "Events" },
  { href: "/clubs", label: "Clubs" },
  { href: "/community", label: "Community" },
  { href: "/about", label: "About" },
  { href: "/get-involved", label: "Get Involved" },
] as const;

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link
        className="wordmark"
        href="/"
        aria-label="Vancouver Curiosity Club home"
      >
        <span className="wordmark-mark" aria-hidden="true" />
        <span>Vancouver Curiosity Club</span>
      </Link>

      <nav
        className="primary-nav primary-nav--desktop"
        aria-label="Primary navigation"
      >
        <NavigationLinks />
      </nav>

      <details className="site-navigation">
        <summary>
          <span>Menu</span>
          <span className="nav-menu-icon" aria-hidden="true" />
        </summary>
        <nav
          className="primary-nav primary-nav--mobile"
          aria-label="Primary navigation menu"
        >
          <NavigationLinks />
        </nav>
      </details>
    </header>
  );
}

function NavigationLinks() {
  return (
    <>
      {primaryNavigation.map((item) => (
        <Link href={item.href} key={item.href}>
          {item.label}
        </Link>
      ))}
      <Link className="portal-link" href="/organizer">
        Organizer Login
      </Link>
    </>
  );
}
