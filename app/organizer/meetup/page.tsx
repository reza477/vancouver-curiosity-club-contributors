import type { Metadata } from "next";
import Link from "next/link";
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
import { getMeetupConnectionState } from "@/lib/server/meetup";
import { writeSafeLog } from "@/lib/validation/server-observability";
import { MeetupControls } from "./MeetupControls";
import { toMeetupUiState } from "./model";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Meetup calendar feeds",
  robots: {
    follow: false,
    index: false,
    nocache: true,
    noarchive: true,
    noimageindex: true,
  },
};

export default async function OrganizerMeetupPage() {
  const user = await requireChatGPTUser("/organizer/meetup");
  const identity = trustedIdentityFromSites(user);
  let loaded:
    | Readonly<{
        canConfigure: boolean;
        role: "administrator" | "organizer" | "owner";
        state: Awaited<ReturnType<typeof getMeetupConnectionState>>;
      }>
    | Readonly<{
        denied: boolean;
        error: true;
      }>;

  try {
    const { database, initialOwnerEmail } = getRuntimeAuthConfiguration();
    const membership = await authorizeOrganizerAccess(database, identity, {
      initialOwnerEmail,
    });
    const state = await getMeetupConnectionState(database, identity);
    const canConfigure =
      membership.role === "owner" ||
      membership.role === "administrator";
    loaded = {
      canConfigure,
      role: membership.role,
      state,
    };
  } catch (error) {
    const denied = error instanceof OrganizerAccessDeniedError;
    const unconfigured = error instanceof AuthConfigurationError;
    writeSafeLog(denied || unconfigured ? "warn" : "error", "meetup_ui_failed", {
      code: denied
        ? "authorization_denied"
        : unconfigured
          ? "service_unavailable"
          : "internal_error",
      operation: "read_meetup_connection",
      route: "/organizer/meetup",
      status: denied ? 403 : 503,
    });
    loaded = { denied, error: true };
  }

  if ("error" in loaded) {
    return (
      <main
        className="organizer-shell meetup-organizer-page"
        aria-labelledby="meetup-organizer-heading"
      >
        <p className="organizer-shell__eyebrow">Vancouver Curiosity Club</p>
        <h1 id="meetup-organizer-heading">
          Meetup connection unavailable
        </h1>
        <p>
          {loaded.denied
            ? "This identity has no active organizer access."
            : "The connection controls could not be loaded. No source or refresh state is being claimed."}
        </p>
        <Link href="/organizer">Return to organizer portal</Link>
      </main>
    );
  }

  return (
    <main
      className="organizer-shell meetup-organizer-page"
      aria-labelledby="meetup-organizer-heading"
    >
      <header className="organizer-shell__header">
        <Link className="organizer-back-link" href="/organizer">
          <span aria-hidden="true">←</span> Organizer portal
        </Link>
        <p className="organizer-shell__eyebrow">
          Vancouver Curiosity Club · {roleLabel(loaded.role)}
        </p>
        <h1 id="meetup-organizer-heading">Meetup calendar feeds</h1>
        <p>
          {loaded.canConfigure
            ? "Manage official feed coverage and inspect aggregate status without exposing saved addresses or claiming a refresh that did not happen."
            : "Inspect aggregate feed status. Saved addresses and mutation controls remain restricted to an Owner or Administrator."}
        </p>
        <a href={chatGPTSignOutPath("/")}>Sign out</a>
      </header>

      <MeetupControls
        canConfigure={loaded.canConfigure}
        initialState={toMeetupUiState(loaded.state)}
      />
    </main>
  );
}

function roleLabel(role: "administrator" | "organizer" | "owner") {
  if (role === "owner") return "Owner";
  if (role === "administrator") return "Administrator";
  return "Organizer";
}
