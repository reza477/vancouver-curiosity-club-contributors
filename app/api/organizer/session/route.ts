import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  authorizeOrganizerAccess,
  trustedIdentityFromSites,
} from "@/lib/server/auth";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { getOrganizerProfile } from "@/lib/server/organizer/profiles";
import {
  SafeApplicationError,
  privateJsonHeaders,
  safeErrorResponse,
} from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    // Identity comes only from the dispatcher-owned server request context.
    // This route accepts no client-provided email, role, organization, or
    // identity header override.
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
    await authorizeOrganizerAccess(database, identity, {
      initialOwnerEmail,
    });
    const profile = await getOrganizerProfile(database, identity);

    return new Response(
      JSON.stringify({
        session: {
          displayName: profile.displayName,
          role: profile.role,
        },
      }),
      {
        status: 200,
        headers: privateJsonHeaders(),
      },
    );
  } catch (error) {
    return safeErrorResponse(error, {
      operation: "read_organizer_session",
      route: "/api/organizer/session",
    });
  }
}
