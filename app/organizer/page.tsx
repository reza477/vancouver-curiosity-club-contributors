import type { Metadata } from "next";
import {
  chatGPTSignOutPath,
  requireChatGPTUser,
} from "@/app/chatgpt-auth";
import {
  AuthConfigurationError,
  OrganizerAccessDeniedError,
  authorizeOrganizerAccess,
  trustedIdentityFromSites,
} from "@/lib/server/auth";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Organizer portal",
  robots: {
    follow: false,
    index: false,
    nocache: true,
    noarchive: true,
    noimageindex: true,
  },
};

export default async function OrganizerPage() {
  // Dispatch-owned SIWC redirects anonymous browser requests before any
  // organization data is read.
  const user = await requireChatGPTUser("/organizer");
  const identity = trustedIdentityFromSites(user);
  let access:
    | Readonly<{
        kind: "granted";
        role: "administrator" | "organizer" | "owner";
      }>
    | Readonly<{ kind: "denied" | "unavailable" | "unconfigured" }>;

  try {
    const { database, initialOwnerEmail } = getRuntimeAuthConfiguration();
    const membership = await authorizeOrganizerAccess(database, identity, {
      initialOwnerEmail,
    });
    access = { kind: "granted", role: membership.role };
  } catch (error) {
    if (error instanceof OrganizerAccessDeniedError) {
      writeSafeLog("warn", "organizer_access_denied", {
        code: "authorization_denied",
        route: "/organizer",
        status: 403,
      });
      access = { kind: "denied" };
    } else if (error instanceof AuthConfigurationError) {
      writeSafeLog("warn", "organizer_access_unconfigured", {
        code: "service_unavailable",
        route: "/organizer",
        status: 503,
      });
      access = { kind: "unconfigured" };
    } else {
      writeSafeLog("error", "organizer_access_failed", {
        code: "internal_error",
        route: "/organizer",
        status: 500,
      });
      access = { kind: "unavailable" };
    }
  }

  if (access.kind !== "granted") {
    return <OrganizerAccessMessage kind={access.kind} />;
  }

  return (
    <main className="organizer-shell" aria-labelledby="organizer-heading">
      <header className="organizer-shell__header">
        <p className="organizer-shell__eyebrow">Vancouver Curiosity Club</p>
        <h1 id="organizer-heading">Organizer portal</h1>
        <p>
          Signed in as {identity.displayName}. Your {roleLabel(access.role)}{" "}
          access is active.
        </p>
        <a href={chatGPTSignOutPath("/")}>Sign out</a>
      </header>

      <section aria-labelledby="foundation-heading">
        <h2 id="foundation-heading">Foundation ready</h2>
        <p>
          This private Phase 1 surface confirms server-side identity,
          membership, and role authorization. Scheduling tools are not enabled
          in this phase.
        </p>
      </section>
    </main>
  );
}

function OrganizerAccessMessage({
  kind,
}: Readonly<{ kind: "denied" | "unavailable" | "unconfigured" }>) {
  const copy =
    kind === "denied"
      ? "This ChatGPT identity has no active invitation or membership. Ask an owner or administrator for a copyable invitation link."
      : kind === "unconfigured"
        ? "Organizer access is not configured yet. The owner must add INITIAL_OWNER_EMAIL in Sites runtime settings."
        : "Organizer access is temporarily unavailable. Please try again later.";

  return (
    <main className="organizer-shell" aria-labelledby="organizer-heading">
      <p className="organizer-shell__eyebrow">Vancouver Curiosity Club</p>
      <h1 id="organizer-heading">Organizer access unavailable</h1>
      <p>{copy}</p>
      <p>
        Sign in with the ChatGPT account whose email exactly matches your
        invitation.
      </p>
      <a href={chatGPTSignOutPath("/")}>Sign out</a>
    </main>
  );
}

function roleLabel(role: "administrator" | "organizer" | "owner"): string {
  if (role === "owner") return "Owner";
  if (role === "administrator") return "Administrator";
  return "Organizer";
}
