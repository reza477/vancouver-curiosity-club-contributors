import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import { resolvePublicOrganization } from "@/lib/server/public/catalog";
import {
  parsePublicFormKey,
} from "@/lib/server/phase7/public-form-contract";
import {
  PUBLIC_FORM_CLIENT_COOKIE,
  anonymousFormCookie,
  createAnonymousFormClientId,
  createPublicFormInstanceToken,
  ensurePublicFormProtectionKey,
  isAnonymousFormClientId,
  readCookie,
  renewPublicFormInstanceToken,
} from "@/lib/server/phase7/public-form-protection";
import { SafeApplicationError, safeErrorResponse } from "@/lib/validation/server-observability";
import { readBoundedUtf8Body, requireSameOriginMutation } from "@/app/api/organizer/meetup/_mutation";

export const dynamic = "force-dynamic";

/** Renewal preserves both the signed nonce and the existing cookie identity.
 * It must never fall back to issuing a fresh anonymous client cookie. */
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOriginMutation(request);
    let body: unknown;
    try {
      body = JSON.parse(await readBoundedUtf8Body(request, 2_048));
    } catch {
      throw new SafeApplicationError("validation_failed", 400, "The form could not be renewed. Try again.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new SafeApplicationError("validation_failed", 400, "The form could not be renewed. Try again.");
    }
    const formKey = parsePublicFormKey(Reflect.get(body, "formKey"));
    if (formKey !== "contact" && !isAnonymousFormClientId(readCookie(request.headers.get("cookie"), PUBLIC_FORM_CLIENT_COOKIE))) {
      throw new SafeApplicationError("authorization_denied", 403, "Refresh the form and try again.");
    }
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) return unavailable();
    const nowUtcMs = readServerUtcMs();
    const keyHex = await ensurePublicFormProtectionKey(database, organization.id, nowUtcMs);
    const { token } = await renewPublicFormInstanceToken(keyHex, Reflect.get(body, "instanceToken"), formKey, nowUtcMs);
    return new Response(JSON.stringify({ formKey, instanceToken: token, expiresInSeconds: 2 * 60 * 60 }), { headers: publicFormJsonHeaders() });
  } catch (error) {
    const response = safeErrorResponse(error, { operation: "renew_public_form_instance", route: "/api/forms/instance" });
    applyPublicFormHeaders(response.headers);
    return response;
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const formKey = parsePublicFormKey(
      new URL(request.url).searchParams.get("form"),
    );
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) {
      return unavailable();
    }
    const nowUtcMs = readServerUtcMs();
    const keyHex = await ensurePublicFormProtectionKey(
      database,
      organization.id,
      nowUtcMs,
    );
    const { token } = await createPublicFormInstanceToken(
      keyHex,
      formKey,
      nowUtcMs,
    );
    const currentClient = readCookie(
      request.headers.get("cookie"),
      PUBLIC_FORM_CLIENT_COOKIE,
    );
    const clientId = isAnonymousFormClientId(currentClient)
      ? currentClient
      : createAnonymousFormClientId();
    const headers = publicFormJsonHeaders();
    if (clientId !== currentClient) {
      headers.append("Set-Cookie", anonymousFormCookie(clientId));
    }
    return new Response(
      JSON.stringify({
        expiresInSeconds: 2 * 60 * 60,
        formKey,
        instanceToken: token,
      }),
      { headers },
    );
  } catch (error) {
    const response = safeErrorResponse(error, {
      operation: "create_public_form_instance",
      route: "/api/forms/instance",
    });
    applyPublicFormHeaders(response.headers);
    return response;
  }
}

function unavailable(): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "service_unavailable",
        message: "The form is temporarily unavailable.",
      },
    }),
    { status: 503, headers: publicFormJsonHeaders() },
  );
}

function publicFormJsonHeaders(): Headers {
  const headers = new Headers({ "Content-Type": "application/json" });
  applyPublicFormHeaders(headers);
  return headers;
}

function applyPublicFormHeaders(headers: Headers): void {
  headers.set("Cache-Control", "private, no-store");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("Vary", "Cookie");
}
