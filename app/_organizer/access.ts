import "server-only";

import { forbidden } from "next/navigation";
import {
  requireChatGPTUser,
} from "@/app/chatgpt-auth";
import {
  AuthConfigurationError,
  OrganizerAccessDeniedError,
  authorizeOrganizerAccess,
  revalidateAuthorizedMembership,
  trustedIdentityFromSites,
} from "@/lib/server/auth";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { getUnreadNotificationCount } from "@/lib/server/organizer/notifications";
import { getOrganizerProfile } from "@/lib/server/organizer/profiles";
import { getWorkspaceSettings } from "@/lib/server/organizer/settings";
import { writeSafeLog } from "@/lib/validation/server-observability";
import type {
  OrganizerPageContext,
  OrganizerPageLoad,
} from "./types";

export function enforceOrganizerPageAccess(load: OrganizerPageLoad): void {
  if (load.kind === "denied") forbidden();
}

export async function loadOrganizerPageContext(
  returnTo: string,
): Promise<OrganizerPageLoad> {
  const user = await requireChatGPTUser(returnTo);
  const identity = trustedIdentityFromSites(user);

  try {
    const { database, initialOwnerEmail } = getRuntimeAuthConfiguration();
    const membership = await authorizeOrganizerAccess(database, identity, {
      initialOwnerEmail,
    });
    const [settings, profile, unreadNotificationCount] = await Promise.all([
      getWorkspaceSettings(database, identity),
      getOrganizerProfile(database, identity),
      getUnreadNotificationCount(database, membership),
    ]);
    const currentMembership = await revalidateAuthorizedMembership(
      database,
      identity,
      membership,
    );

    const context: OrganizerPageContext = Object.freeze({
      database,
      defaultTimezone: settings.defaultTimezone,
      identity,
      membership: currentMembership,
      organizerDisplayName: profile.displayName,
      organizerInitials: profile.initials,
      unreadNotificationCount,
      workspaceName: settings.workspaceName,
    });
    return Object.freeze({ context, kind: "granted" });
  } catch (error) {
    const kind =
      error instanceof OrganizerAccessDeniedError
        ? "denied"
        : error instanceof AuthConfigurationError
          ? "unconfigured"
          : "unavailable";
    writeSafeLog(kind === "unavailable" ? "error" : "warn", "organizer_ui_failed", {
      code:
        kind === "denied"
          ? "authorization_denied"
          : kind === "unconfigured"
            ? "service_unavailable"
            : "internal_error",
      operation: "load_organizer_page",
      route: safeRouteLabel(returnTo),
      status: kind === "denied" ? 403 : 503,
    });
    return Object.freeze({ kind });
  }
}

function safeRouteLabel(returnTo: string): string {
  return returnTo.startsWith("/organizer")
    ? returnTo.split("?")[0] ?? "/organizer"
    : "/organizer";
}
