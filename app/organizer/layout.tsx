import type { Metadata } from "next";
import { getTrustedRequestPathname } from "@/lib/server/public/origin";
import { loadOrganizerPageContext } from "@/app/_organizer/access";
import { OrganizerRouteState } from "@/app/_organizer/OrganizerRouteState";
import { WorkspaceShell } from "@/app/_organizer/WorkspaceShell";
import "@/app/_organizer/organizer.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Organizer workspace",
    template: "%s · Organizer workspace",
  },
  description: "Private planning workspace for Vancouver Curiosity Club organizers.",
  alternates: {},
  openGraph: null,
  twitter: null,
  referrer: "no-referrer",
  robots: {
    follow: false,
    index: false,
    nocache: true,
    noarchive: true,
    noimageindex: true,
  },
};

export default async function OrganizerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestPathname = await getTrustedRequestPathname();
  const returnTo =
    requestPathname === "/organizer" ||
    requestPathname?.startsWith("/organizer/")
      ? requestPathname
      : "/organizer";
  const loaded = await loadOrganizerPageContext(returnTo);

  if (loaded.kind === "denied") {
    // Each page independently revalidates and throws its access signal at the
    // page level, where vinext can resolve this segment's 403 boundary.
    return <>{children}</>;
  }

  if (loaded.kind !== "granted") {
    return <OrganizerRouteState load={loaded} />;
  }
  if (requestPathname?.startsWith("/organizer/content/revisions/")) {
    return <>{children}</>;
  }

  return (
    <WorkspaceShell
      context={loaded.context}
      currentPath={requestPathname ?? "/organizer"}
    >
      {children}
    </WorkspaceShell>
  );
}
