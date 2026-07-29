import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  OrganizerAccessDeniedError,
  authorizeOrganizerAccess,
  trustedIdentityFromSites,
  type OrganizationRole,
} from "@/lib/server/auth";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import {
  InputValidationError,
} from "@/lib/validation";
import {
  SafeApplicationError,
  privateJsonHeaders,
  safeErrorResponse,
} from "@/lib/validation/server-observability";
export { readOrganizerMutationBody } from "./_body";

export async function requireOrganizerApiActor(
  allowedRoles: readonly OrganizationRole[] = [
    "owner",
    "administrator",
    "organizer",
  ],
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
  return Object.freeze({ database, identity, membership });
}

export function assertTrustedOrganizerRead(request: Request): void {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (origin !== null && origin !== requestUrl.origin)
  ) {
    throw new OrganizerAccessDeniedError("role_not_allowed");
  }
}

export function privateOrganizerJson(
  value: unknown,
  options: Readonly<{
    noReferrer?: boolean;
    status?: number;
  }> = {},
): Response {
  const headers = privateJsonHeaders();
  if (options.noReferrer) {
    headers.set("Referrer-Policy", "no-referrer");
  }
  return new Response(JSON.stringify(value), {
    status: options.status ?? 200,
    headers,
  });
}

export function organizerApiError(
  error: unknown,
  operation: string,
  route: string,
  options: Readonly<{ noReferrer?: boolean }> = {},
): Response {
  const response = safeErrorResponse(
    error instanceof InputValidationError
      ? new SafeApplicationError(
          "validation_failed",
          422,
          "The request could not be validated.",
        )
      : error,
    { operation, route },
  );
  if (options.noReferrer) {
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  return response;
}
