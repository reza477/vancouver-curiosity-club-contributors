import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  trustedIdentityFromSites,
} from "@/lib/server/auth";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import {
  clearInvitationTokenCookie,
  readInvitationTokenCookie,
} from "@/lib/server/organizer/invitation-token-cookie";
import { acceptOrganizerInvitation } from "@/lib/server/organizer/invitations";
import {
  SafeApplicationError,
} from "@/lib/validation/server-observability";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
} from "@/app/api/organizer/_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const isLocal =
    requestUrl.hostname === "localhost" ||
    requestUrl.hostname === "127.0.0.1" ||
    requestUrl.hostname === "::1";
  const clearCookie = clearInvitationTokenCookie(isLocal);
  let reachedTokenAttempt = false;

  try {
    const user = await getChatGPTUser();
    if (!user) {
      throw new SafeApplicationError(
        "authentication_required",
        401,
        "Sign in with ChatGPT to continue.",
      );
    }
    // Authenticate first. Only then validate same-origin and the bounded body.
    await readOrganizerMutationBody(request, 64);
    reachedTokenAttempt = true;
    const token = readInvitationTokenCookie(
      request.headers.get("cookie"),
      isLocal,
    );
    if (!token) {
      throw new SafeApplicationError(
        "authorization_denied",
        403,
        "This invitation is not available.",
      );
    }
    const identity = trustedIdentityFromSites(user);
    const { database } = getRuntimeAuthConfiguration();
    const accepted = await acceptOrganizerInvitation(
      database,
      identity,
      token,
    );
    const response = privateOrganizerJson(
      { accepted: true, role: accepted.role },
      { noReferrer: true },
    );
    response.headers.append("Set-Cookie", clearCookie);
    return response;
  } catch (error) {
    const response = organizerApiError(
      error,
      "accept_organizer_invitation",
      "/accept-invitation/consume",
      { noReferrer: true },
    );
    if (
      reachedTokenAttempt &&
      error instanceof SafeApplicationError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 429
    ) {
      response.headers.append("Set-Cookie", clearCookie);
    }
    return response;
  }
}
