import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  OrganizerAccessDeniedError,
  authorizeOrganizerAccess,
  trustedIdentityFromSites,
} from "@/lib/server/auth";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { SafeApplicationError } from "@/lib/validation/server-observability";

export async function requireMeetupApiActor(
  allowedRoles: readonly ("administrator" | "organizer" | "owner")[],
) {
  const user = await getChatGPTUser();
  if (!user) {
    throw new SafeApplicationError(
      "authentication_required",
      401,
      "Sign in with ChatGPT to continue.",
    );
  }

  const identity = trustedIdentityFromSites(user);
  const { database, initialOwnerEmail } = getRuntimeAuthConfiguration();
  const membership = await authorizeOrganizerAccess(database, identity, {
    initialOwnerEmail,
  });
  if (!allowedRoles.includes(membership.role)) {
    throw new OrganizerAccessDeniedError("role_not_allowed");
  }

  return { database, identity, membership };
}
