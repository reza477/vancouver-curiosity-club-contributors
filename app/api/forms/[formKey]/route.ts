import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import { resolvePublicOrganization } from "@/lib/server/public/catalog";
import {
  PublicFormValidationError,
  parsePublicFormKey,
} from "@/lib/server/phase7/public-form-contract";
import {
  PUBLIC_FORM_CLIENT_COOKIE,
  ensurePublicFormProtectionKey,
  isAnonymousFormClientId,
  readCookie,
  verifyPublicFormInstanceToken,
} from "@/lib/server/phase7/public-form-protection";
import { submitPublicForm } from "@/lib/server/phase7/public-forms";
import { readBoundedUtf8Body } from "@/app/api/organizer/meetup/_mutation";
import {
  SafeApplicationError,
  classifySafeError,
  writeSafeLog,
} from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ formKey: string }>;

export async function POST(
  request: Request,
  context: Readonly<{ params: RouteParams }>,
): Promise<Response> {
  const routeLabel = "/api/forms/[formKey]";
  try {
    requirePublicFormSameOrigin(request);
    const { formKey: rawFormKey } = await context.params;
    const formKey = parsePublicFormKey(rawFormKey);
    const body = await readBoundedJson(request, 16_384);
    const instanceToken = body.instanceToken;
    const anonymousClientId = readCookie(
      request.headers.get("cookie"),
      PUBLIC_FORM_CLIENT_COOKIE,
    );
    if (!isAnonymousFormClientId(anonymousClientId)) {
      throw new SafeApplicationError(
        "authorization_denied",
        403,
        "Refresh the form and try again.",
      );
    }
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) {
      throw new SafeApplicationError(
        "service_unavailable",
        503,
        "The form is temporarily unavailable.",
      );
    }
    const nowUtcMs = readServerUtcMs();
    const keyHex = await ensurePublicFormProtectionKey(
      database,
      organization.id,
      nowUtcMs,
    );
    const formInstance = await verifyPublicFormInstanceToken(
      keyHex,
      instanceToken,
      formKey,
      nowUtcMs,
    );
    const result = await submitPublicForm(database, {
      anonymousClientId,
      formInstance,
      formKey,
      honeypot: body.companyFax,
      keyHex,
      networkFacts: boundedNetworkFacts(request),
      nowUtcMs,
      organizationId: organization.id,
      payload: body.payload,
    });
    return publicFormJson(
      {
        message:
          `Thanks — your submission was stored in the private organizer inbox. Reference: ${result.publicReference}. No email confirmation was sent.`,
        publicReference: result.publicReference,
        stored: true,
      },
      201,
    );
  } catch (error) {
    if (error instanceof PublicFormValidationError) {
      return publicFormJson(
        {
          error: {
            code: "validation_failed",
            fieldErrors: error.fieldErrors,
            message: error.message,
          },
          values: error.values,
        },
        422,
      );
    }
    const safe = classifySafeError(error);
    writeSafeLog(
      safe.status >= 500 ? "error" : "warn",
      "public_form_submission_failed",
      {
        code: safe.code,
        operation: "submit_public_form",
        route: routeLabel,
        status: safe.status,
      },
    );
    return publicFormJson(
      {
        error: {
          code: safe.code,
          message: safe.message,
        },
      },
      safe.status,
    );
  }
}

function requirePublicFormSameOrigin(request: Request): void {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin) {
    if (origin !== requestUrl.origin) throw denied();
    return;
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      if (new URL(referer).origin === requestUrl.origin) return;
    } catch {
      throw denied();
    }
    throw denied();
  }
  if (request.headers.get("sec-fetch-site") === "same-origin") return;
  throw denied();
}

async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(await readBoundedUtf8Body(request, maxBytes));
  } catch {
    throw invalidBody();
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw invalidBody();
  }
  return value as Record<string, unknown>;
}

function boundedNetworkFacts(request: Request): string {
  const ip = (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for") ??
    "unknown"
  ).slice(0, 128);
  const userAgent = (request.headers.get("user-agent") ?? "unknown").slice(
    0,
    256,
  );
  const language = (request.headers.get("accept-language") ?? "unknown").slice(
    0,
    128,
  );
  return `${ip}\u0000${userAgent}\u0000${language}`;
}

function publicFormJson(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json",
      "Referrer-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

function denied(): SafeApplicationError {
  return new SafeApplicationError(
    "authorization_denied",
    403,
    "This request is not permitted.",
  );
}

function invalidBody(): SafeApplicationError {
  return new SafeApplicationError(
    "validation_failed",
    422,
    "The request could not be validated.",
  );
}
