import Image from "next/image";
import Link from "next/link";
import { chatGPTSignOutPath } from "@/app/chatgpt-auth";
import type { OrganizerPageContext, OrganizerRole } from "./types";
import styles from "./workspace.module.css";

const primaryNavigation = [
  { href: "/organizer", label: "Dashboard" },
  { href: "/organizer/calendar", label: "Calendar" },
  { href: "/organizer/events", label: "Events" },
  { href: "/organizer/conflicts", label: "Conflicts" },
  { href: "/organizer/submissions", label: "Submissions" },
  { href: "/organizer/team", label: "Team" },
  { href: "/organizer/clubs", label: "Clubs" },
] as const;

const utilityNavigation = [
  { href: "/organizer/meetup", label: "Meetup connection" },
  { href: "/organizer/profile", label: "Profile" },
  { href: "/organizer/settings", label: "Settings" },
] as const;

const contentNavigation = [
  { href: "/organizer/imports", label: "Imports" },
  { href: "/organizer/exports", label: "Exports" },
  { href: "/organizer/content", label: "Website content" },
  { href: "/organizer/media", label: "Media library" },
] as const;

export function WorkspaceShell({
  children,
  context,
  currentPath,
}: Readonly<{
  children: React.ReactNode;
  context: OrganizerPageContext;
  currentPath: string;
}>) {
  const role = roleLabel(context.membership.role);
  const canManageContent =
    context.membership.role === "owner" ||
    context.membership.role === "administrator";
  return (
    <div className={styles.workspace}>
      <aside className={styles.sidebar} aria-label="Organizer workspace">
        <Link className={styles.brand} href="/organizer">
          <Image
            alt=""
            aria-hidden="true"
            height={44}
            src="/icon.png"
            unoptimized
            width={44}
          />
          <span>
            <strong>Field notes</strong>
            <small>{context.workspaceName}</small>
          </span>
        </Link>

        <nav className={styles.desktopNavigation} aria-label="Organizer">
          <WorkspaceLinks currentPath={currentPath} links={primaryNavigation} />
        </nav>

        <nav className={styles.utilityNavigation} aria-label="Workspace tools">
          {canManageContent ? (
            <WorkspaceLinks
              currentPath={currentPath}
              links={contentNavigation}
            />
          ) : null}
          <WorkspaceLinks currentPath={currentPath} links={utilityNavigation} />
        </nav>

        <p className={styles.phaseNote}>
          Private scheduling and event publishing live alongside the structured
          website editor. Approved media and published content remain separate
          from drafts.
        </p>

        <details className={styles.accountMenu}>
          <summary>
            <span aria-hidden="true" className={styles.avatar}>
              {context.organizerInitials}
            </span>
            <span>
              <strong>{context.organizerDisplayName}</strong>
              <small>{role}</small>
            </span>
          </summary>
          <div>
            <Link href="/organizer/profile">Profile &amp; preferences</Link>
            <a href={chatGPTSignOutPath("/")}>Sign out</a>
          </div>
        </details>
      </aside>

      <div className={styles.workArea}>
        <header className={styles.mobileHeader}>
          <Link className={styles.mobileBrand} href="/organizer">
            <Image
              alt=""
              height={36}
              src="/icon.png"
              unoptimized
              width={36}
            />
            <span>{context.workspaceName}</span>
          </Link>
          <Link
            aria-label={
              context.unreadNotificationCount > 0
                ? `${context.unreadNotificationCount} unread notifications`
                : "Notifications"
            }
            className={styles.notificationLink}
            href="/organizer/notifications"
          >
            <span aria-hidden="true">Notice</span>
            {context.unreadNotificationCount > 0 ? (
              <strong>{boundedCount(context.unreadNotificationCount)}</strong>
            ) : null}
          </Link>
        </header>

        <div className={styles.desktopTopbar}>
          <p>
            <span>Private organizer workspace</span>
            <strong>{role}</strong>
          </p>
          <Link
            className={styles.notificationLink}
            href="/organizer/notifications"
          >
            Notifications
            {context.unreadNotificationCount > 0 ? (
              <strong>{boundedCount(context.unreadNotificationCount)}</strong>
            ) : null}
          </Link>
        </div>

        <main className={styles.main} id="organizer-main" tabIndex={-1}>
          {children}
        </main>
      </div>

      <nav className={styles.mobileNavigation} aria-label="Organizer shortcuts">
        <MobileLink
          currentPath={currentPath}
          href="/organizer/calendar"
          label="Calendar"
        />
        <MobileLink
          currentPath={currentPath}
          href="/organizer/events/new"
          label="Add event"
        />
        <MobileLink
          currentPath={currentPath}
          href="/organizer/conflicts"
          label="Conflicts"
        />
        <MobileLink
          currentPath={currentPath}
          href="/organizer/team"
          label="Team"
        />
        <details className={styles.mobileMore}>
          <summary>More</summary>
          <div>
            <Link href="/organizer">Dashboard</Link>
            <Link href="/organizer/events">Events</Link>
            <Link href="/organizer/clubs">Clubs</Link>
            <Link href="/organizer/submissions">Submissions</Link>
            <Link href="/organizer/meetup">Meetup</Link>
            <Link href="/organizer/notifications">Notifications</Link>
            {canManageContent ? (
              <>
                <Link href="/organizer/content">Website content</Link>
                <Link href="/organizer/media">Media library</Link>
                <Link href="/organizer/imports">Imports</Link>
                <Link href="/organizer/exports">Exports</Link>
              </>
            ) : null}
            <Link href="/organizer/profile">Profile</Link>
            <Link href="/organizer/settings">Settings</Link>
          </div>
        </details>
      </nav>
    </div>
  );
}

function WorkspaceLinks({
  currentPath,
  links,
}: Readonly<{
  currentPath: string;
  links: readonly Readonly<{ href: string; label: string }>[];
}>) {
  return links.map((link) => {
    const active = isActivePath(currentPath, link.href);
    return (
      <Link
        aria-current={active ? "page" : undefined}
        className={active ? styles.activeLink : undefined}
        href={link.href}
        key={link.href}
      >
        <span>{link.label}</span>
      </Link>
    );
  });
}

function MobileLink({
  currentPath,
  href,
  label,
}: Readonly<{ currentPath: string; href: string; label: string }>) {
  const active = isActivePath(currentPath, href);
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={active ? styles.activeMobileLink : undefined}
      href={href}
    >
      {label}
    </Link>
  );
}

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/organizer") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function roleLabel(role: OrganizerRole): string {
  if (role === "owner") return "Owner";
  if (role === "administrator") return "Administrator";
  return "Organizer";
}

function boundedCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}
