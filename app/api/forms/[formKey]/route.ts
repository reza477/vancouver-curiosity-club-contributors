import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import { resolvePublicOrganization } from "@/lib/server/public/catalog";
import {
  PublicFormValidationError,
  parsePublicFormKey,
  type PublicFormKey,
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
  const nativeSubmission = isNativeFormSubmission(request);
  let formKey: PublicFormKey | null = null;
  try {
    requirePublicFormSameOrigin(request);
    const { formKey: rawFormKey } = await context.params;
    formKey = parsePublicFormKey(rawFormKey);
    const body = nativeSubmission
      ? await readBoundedNativeForm(request, formKey, 16_384)
      : await readBoundedJson(request, 16_384);
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
    const message =
      `Thanks — your submission was received for organizer review. Reference: ${result.publicReference}.`;
    return nativeSubmission
      ? publicFormHtml({
          backPath: publicFormBackPath(formKey),
          message,
          status: 201,
          title: "Submission received",
        })
      : publicFormJson(
          {
            message,
            publicReference: result.publicReference,
            stored: true,
          },
          201,
        );
  } catch (error) {
    if (error instanceof PublicFormValidationError) {
      return nativeSubmission
        ? publicFormHtml({
            backPath: publicFormBackPath(formKey),
            message:
              "The form could not be validated. Go back, review the required fields, and try again. Your information is not shown on this page or in its address.",
            status: 422,
            title: "Please check the form",
          })
        : publicFormJson(
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
    return nativeSubmission
      ? publicFormHtml({
          backPath: publicFormBackPath(formKey),
          message: safe.message,
          status: safe.status,
          title:
            safe.status >= 500
              ? "The form is temporarily unavailable"
              : "The submission was not sent",
        })
      : publicFormJson(
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

const PUBLIC_FORM_NATIVE_FIELDS = Object.freeze({
  contact: ["name", "replyEmail", "topic", "message"],
  host_event: [
    "name",
    "replyEmail",
    "proposedTitle",
    "eventIdea",
    "preferredClubOrProgram",
    "format",
    "preferredTiming",
  ],
  partnership: [
    "name",
    "replyEmail",
    "organizationOrVenueName",
    "partnershipType",
    "website",
    "message",
  ],
  volunteer: [
    "name",
    "replyEmail",
    "interestAreas",
    "howToHelp",
    "availabilityContext",
  ],
} satisfies Readonly<Record<PublicFormKey, readonly string[]>>);

function isNativeFormSubmission(request: Request): boolean {
  return (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase() === "application/x-www-form-urlencoded";
}

async function readBoundedNativeForm(
  request: Request,
  formKey: PublicFormKey,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  let fields: URLSearchParams;
  try {
    fields = new URLSearchParams(
      await readBoundedUtf8Body(request, maxBytes),
    );
  } catch {
    throw invalidBody();
  }
  if (
    hasDuplicate(fields, "instanceToken") ||
    hasDuplicate(fields, "companyFax") ||
    PUBLIC_FORM_NATIVE_FIELDS[formKey].some(
      (field) => field !== "interestAreas" && hasDuplicate(fields, field),
    )
  ) {
    throw invalidBody();
  }
  const payload: Record<string, unknown> = {};
  for (const field of PUBLIC_FORM_NATIVE_FIELDS[formKey]) {
    payload[field] =
      field === "interestAreas" ? fields.getAll(field) : fields.get(field);
  }
  return {
    companyFax: fields.get("companyFax"),
    instanceToken: fields.get("instanceToken"),
    payload,
  };
}

function hasDuplicate(fields: URLSearchParams, name: string): boolean {
  return fields.getAll(name).length > 1;
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

function publicFormHtml(input: Readonly<{
  backPath: string;
  message: string;
  status: number;
  title: string;
}>): Response {
  const title = escapeHtml(input.title);
  const message = escapeHtml(input.message);
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Vancouver Curiosity Club</title></head><body><main><h1>${title}</h1><p>${message}</p><p><a href="${input.backPath}">Return to the form</a></p></main></body></html>`,
    {
      status: input.status,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    },
  );
}

function publicFormBackPath(formKey: PublicFormKey | null): string {
  if (formKey === "contact") return "/contact";
  if (formKey === "host_event") return "/host-an-event";
  if (formKey === "volunteer") return "/get-involved#volunteer";
  if (formKey === "partnership") return "/get-involved#partner";
  return "/";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
