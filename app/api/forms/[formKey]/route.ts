import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import { resolvePublicOrganization } from "@/lib/server/public/catalog";
import {
  COLLABORATION_INTERESTS,
  CONTACT_TOPICS,
  PARTNERSHIP_TYPES,
  PUBLIC_FORM_SUCCESS_COPY,
  PublicFormValidationError,
  parsePublicFormKey,
  publicFormLabel,
  type PublicFormFieldErrors,
  type PublicFormKey,
  type PublicFormPayload,
} from "@/lib/server/phase7/public-form-contract";
import {
  PUBLIC_FORM_CLIENT_COOKIE,
  ensurePublicFormProtectionKey,
  isAnonymousFormClientId,
  readCookie,
  verifyPublicFormInstanceToken,
} from "@/lib/server/phase7/public-form-protection";
import { submitPublicForm } from "@/lib/server/phase7/public-forms";
import { deliverPublicFormEmail } from "@/lib/server/phase7/public-form-email";
import { readPublicFormEmailConfiguration } from "@/lib/server/phase7/public-form-email-runtime";
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
  let instanceToken: unknown = null;
  try {
    requirePublicFormSameOrigin(request);
    const { formKey: rawFormKey } = await context.params;
    formKey = parsePublicFormKey(rawFormKey);
    const body = nativeSubmission
      ? await readBoundedNativeForm(request, formKey, 16_384)
      : await readBoundedJson(request, 16_384);
    instanceToken = body.instanceToken;
    const anonymousClientCookie = readCookie(
      request.headers.get("cookie"),
      PUBLIC_FORM_CLIENT_COOKIE,
    );
    if (
      !isAnonymousFormClientId(anonymousClientCookie) &&
      formKey !== "contact"
    ) {
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
    const networkFacts = boundedNetworkFacts(request);
    const anonymousClientId = isAnonymousFormClientId(anonymousClientCookie)
      ? anonymousClientCookie
      : "contact-no-cookie-v1";
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
      networkFacts,
      nowUtcMs,
      organizationId: organization.id,
      payload: body.payload,
    });
    if (result.notificationEligible) {
      try {
        await deliverPublicFormEmail(database, result.submissionId, {
          configuration: readPublicFormEmailConfiguration(),
        });
      } catch {
        writeSafeLog("error", "public_form_email_delivery_unavailable", {
          code: "internal_error",
          operation: "deliver_public_form_email",
          requestId: result.submissionId,
          route: routeLabel,
        });
      }
    }
    const message = `${PUBLIC_FORM_SUCCESS_COPY} Reference: ${result.publicReference}.`;
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
        ? formKey &&
          (formKey === "contact" || formKey === "partnership") &&
          typeof instanceToken === "string"
          ? publicFormValidationHtml({
              errors: error.fieldErrors,
              formKey,
              instanceToken,
              values: error.values,
            })
          : publicFormHtml({
              backPath: publicFormBackPath(formKey),
              message:
                "The form could not be validated. Return to the form, review the required fields, and try again.",
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
  contact: [
    "name",
    "replyEmail",
    "topic",
    "organization",
    "role",
    "collaborationInterest",
    "message",
  ],
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
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Vancouver Curiosity Club</title><link rel="stylesheet" href="/styles/native-form.css"></head><body><a class="skip-link" href="#main-content">Skip to main content</a><header><a href="/">Vancouver Curiosity Club</a></header><main id="main-content" tabindex="-1" autofocus><p class="eyebrow">Inquiry status</p><h1>${title}</h1><p>${message}</p><p><a class="action-link" href="${input.backPath}">Return to the form</a></p></main></body></html>`,
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

function publicFormValidationHtml(input: Readonly<{
  errors: PublicFormFieldErrors;
  formKey: "contact" | "partnership";
  instanceToken: string;
  values: PublicFormPayload;
}>): Response {
  const label = publicFormLabel(input.formKey);
  const errorItems = Object.entries(input.errors)
    .map(
      ([field, message]) =>
        `<li><a href="#field-${escapeHtml(field)}">${escapeHtml(message)}</a></li>`,
    )
    .join("");
  const fields = nativeValidationFields(
    input.formKey,
    input.values,
    input.errors,
  );
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Please check the form | Vancouver Curiosity Club</title><link rel="stylesheet" href="/styles/native-form.css"></head><body><a class="skip-link" href="#main-content">Skip to main content</a><header><a href="/">Vancouver Curiosity Club</a></header><main id="main-content"><p class="eyebrow">${escapeHtml(label)}</p><h1>Please check the form</h1><div class="error-summary" role="alert" tabindex="-1" autofocus><h2>Check the following fields</h2><ul>${errorItems}</ul></div><form accept-charset="UTF-8" action="/api/forms/${input.formKey}" method="post"><input name="instanceToken" type="hidden" value="${escapeHtml(input.instanceToken)}"><div class="honeypot" aria-hidden="true"><label for="companyFax">Leave this field blank</label><input autocomplete="off" id="companyFax" name="companyFax" tabindex="-1" type="text"></div>${fields}<button type="submit">${escapeHtml(submitLabel(input.formKey, nativeValue(input.values.topic) === "Partnerships"))}</button></form><p><a href="${publicFormBackPath(input.formKey)}">Return without resubmitting</a></p></main></body></html>`,
    {
      status: 422,
      headers: privateNativeHtmlHeaders(),
    },
  );
}

function nativeValidationFields(
  formKey: "contact" | "partnership",
  values: PublicFormPayload,
  errors: PublicFormFieldErrors,
): string {
  const common = [
    nativeTextField({
      autoComplete: "name",
      errors,
      label: formKey === "partnership" ? "Contact name" : "Name",
      maxLength: 100,
      minLength: 2,
      name: "name",
      required: true,
      value: nativeValue(values.name),
    }),
    nativeTextField({
      autoComplete: "email",
      errors,
      label: "Reply email",
      maxLength: 254,
      minLength: 3,
      name: "replyEmail",
      required: true,
      type: "email",
      value: nativeValue(values.replyEmail),
    }),
  ];
  if (formKey === "contact") {
    const contactFields = [
      nativeTextField({
        autoComplete: "organization",
        errors,
        label: "Organization (optional)",
        maxLength: 160,
        name: "organization",
        value: nativeValue(values.organization),
      }),
      nativeTextField({
        autoComplete: "organization-title",
        errors,
        label: "Role (optional)",
        maxLength: 160,
        name: "role",
        value: nativeValue(values.role),
      }),
      nativeSelectField({
        errors,
        label: "Topic",
        name: "topic",
        options: CONTACT_TOPICS,
        required: true,
        value: nativeValue(values.topic),
      }),
    ];
    const partnershipFields =
      nativeValue(values.topic) === "Partnerships"
        ? [
            nativeSelectField({
              errors,
              label: "Collaboration interest",
              name: "collaborationInterest",
              options: COLLABORATION_INTERESTS,
              required: true,
              value: nativeValue(values.collaborationInterest),
            }),
          ]
        : [];
    return [
      ...common,
      ...contactFields,
      ...partnershipFields,
      nativeTextField({
        errors,
        label: "Message",
        maxLength: 4_000,
        minLength: 10,
        multiline: true,
        name: "message",
        required: true,
        value: nativeValue(values.message),
      }),
    ].join("");
  }
  return [
    ...common,
    nativeTextField({
      errors,
      label: "Organization, venue, or supporter name",
      maxLength: 160,
      minLength: 2,
      name: "organizationOrVenueName",
      required: true,
      value: nativeValue(values.organizationOrVenueName),
    }),
    nativeSelectField({
      errors,
      label: "Partnership type",
      name: "partnershipType",
      options: PARTNERSHIP_TYPES,
      required: true,
      value: nativeValue(values.partnershipType),
    }),
    nativeTextField({
      errors,
      label: "Website (HTTPS)",
      maxLength: 500,
      name: "website",
      pattern: "[Hh][Tt][Tt][Pp][Ss]://.*",
      type: "url",
      value: nativeValue(values.website),
    }),
    nativeTextField({
      errors,
      label: "Message",
      maxLength: 4_000,
      minLength: 10,
      multiline: true,
      name: "message",
      required: true,
      value: nativeValue(values.message),
    }),
  ].join("");
}

function nativeTextField(input: Readonly<{
  autoComplete?: string;
  errors: PublicFormFieldErrors;
  label: string;
  maxLength: number;
  minLength?: number;
  multiline?: boolean;
  name: string;
  pattern?: string;
  required?: boolean;
  type?: string;
  value: string;
}>): string {
  const id = `field-${input.name}`;
  const error = input.errors[input.name];
  const errorId = `${id}-error`;
  const shared = `id="${id}" name="${input.name}" maxlength="${input.maxLength}"${input.minLength ? ` minlength="${input.minLength}"` : ""}${input.required ? " required" : ""}${error ? ` aria-invalid="true" aria-describedby="${errorId}"` : ""}`;
  const control = input.multiline
    ? `<textarea ${shared} rows="6">${escapeHtml(input.value)}</textarea>`
    : `<input ${shared}${input.autoComplete ? ` autocomplete="${input.autoComplete}"` : ""}${input.pattern ? ` pattern="${escapeHtml(input.pattern)}"` : ""} type="${input.type ?? "text"}" value="${escapeHtml(input.value)}">`;
  return `<label for="${id}"><span>${escapeHtml(input.label)}${input.required ? " *" : ""}</span>${control}${error ? `<small id="${errorId}">${escapeHtml(error)}</small>` : ""}</label>`;
}

function nativeSelectField(input: Readonly<{
  errors: PublicFormFieldErrors;
  label: string;
  name: string;
  options: readonly string[];
  required?: boolean;
  value: string;
}>): string {
  const id = `field-${input.name}`;
  const error = input.errors[input.name];
  const errorId = `${id}-error`;
  const options = ["", ...input.options]
    .map((option) => {
      const label = option || "Choose an option";
      return `<option value="${escapeHtml(option)}"${option === input.value ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
  return `<label for="${id}"><span>${escapeHtml(input.label)}${input.required ? " *" : ""}</span><select id="${id}" name="${input.name}"${input.required ? " required" : ""}${error ? ` aria-invalid="true" aria-describedby="${errorId}"` : ""}>${options}</select>${error ? `<small id="${errorId}">${escapeHtml(error)}</small>` : ""}</label>`;
}

function nativeValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function submitLabel(
  formKey: "contact" | "partnership",
  partnershipContact = false,
): string {
  return formKey === "partnership"
    ? "Send partnership or support inquiry"
    : partnershipContact
      ? "Send inquiry"
      : "Send message";
}

function privateNativeHtmlHeaders(): Headers {
  return new Headers({
    "Cache-Control": "private, no-store",
    "Content-Security-Policy":
      "default-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
}

function publicFormBackPath(formKey: PublicFormKey | null): string {
  if (formKey === "contact") return "/contact";
  if (formKey === "host_event") return "/host-an-event";
  if (formKey === "volunteer") return "/get-involved#volunteer";
  if (formKey === "partnership") {
    return "/contact?topic=partnerships#contact-form";
  }
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
