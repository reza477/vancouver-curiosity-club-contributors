import { normalizeEmail } from "../../validation";

export const PUBLIC_FORM_KEYS = [
  "contact",
  "volunteer",
  "host_event",
  "partnership",
] as const;

export type PublicFormKey = (typeof PUBLIC_FORM_KEYS)[number];

export const CONTACT_TOPICS = [
  "General",
  "Event question",
  "Accessibility",
  "Privacy",
  "Media",
  "Other",
] as const;

export const VOLUNTEER_INTERESTS = [
  "Event support",
  "Welcoming",
  "Accessibility",
  "Photography and media",
  "Program support",
] as const;

export const HOST_FORMATS = [
  "In person",
  "Online",
  "Hybrid",
  "Unsure",
] as const;

export const PARTNERSHIP_TYPES = [
  "Venue",
  "Community collaboration",
  "Program collaboration",
  "Funding or sponsorship",
  "Other",
] as const;

export const PUBLIC_FORM_PURPOSE_COPY =
  "Organizers review submissions and may use your reply email to follow up; timing varies and there is no fixed response time.";

export const PUBLIC_FORM_SUCCESS_COPY =
  "Thanks — your submission was received for organizer review.";

export type PublicFormFieldErrors = Readonly<Record<string, string>>;

export type PublicFormPayload = Readonly<Record<string, unknown>>;

export class PublicFormValidationError extends Error {
  readonly fieldErrors: PublicFormFieldErrors;
  readonly values: PublicFormPayload;

  constructor(
    fieldErrors: PublicFormFieldErrors,
    values: PublicFormPayload,
  ) {
    super("The form could not be validated.");
    this.name = "PublicFormValidationError";
    this.fieldErrors = Object.freeze({ ...fieldErrors });
    this.values = Object.freeze({ ...values });
  }
}

export function parsePublicFormKey(value: unknown): PublicFormKey {
  if (
    typeof value === "string" &&
    PUBLIC_FORM_KEYS.some((key) => key === value)
  ) {
    return value as PublicFormKey;
  }
  throw new PublicFormValidationError(
    { form: "Choose a valid form." },
    {},
  );
}

export function parsePublicFormPayload(
  formKey: PublicFormKey,
  value: unknown,
): PublicFormPayload {
  const input = record(value);
  const fieldErrors: Record<string, string> = {};
  const base = {
    name: boundedText(input.name, "name", fieldErrors, {
      minimum: 2,
      maximum: 100,
      required: true,
    }),
    replyEmail: email(input.replyEmail, fieldErrors),
  };

  let payload: Record<string, unknown>;
  if (formKey === "contact") {
    payload = {
      ...base,
      topic: allowlisted(
        input.topic,
        CONTACT_TOPICS,
        "topic",
        fieldErrors,
      ),
      message: boundedText(input.message, "message", fieldErrors, {
        minimum: 10,
        maximum: 4_000,
        required: true,
        multiline: true,
      }),
    };
  } else if (formKey === "volunteer") {
    payload = {
      ...base,
      interestAreas: allowlistedList(
        input.interestAreas,
        VOLUNTEER_INTERESTS,
        "interestAreas",
        fieldErrors,
      ),
      howToHelp: boundedText(input.howToHelp, "howToHelp", fieldErrors, {
        minimum: 10,
        maximum: 4_000,
        required: true,
        multiline: true,
      }),
      availabilityContext: boundedText(
        input.availabilityContext,
        "availabilityContext",
        fieldErrors,
        {
          maximum: 1_000,
          required: false,
          multiline: true,
        },
      ),
    };
  } else if (formKey === "host_event") {
    payload = {
      ...base,
      proposedTitle: boundedText(
        input.proposedTitle,
        "proposedTitle",
        fieldErrors,
        {
          minimum: 3,
          maximum: 160,
          required: true,
        },
      ),
      eventIdea: boundedText(input.eventIdea, "eventIdea", fieldErrors, {
        minimum: 10,
        maximum: 4_000,
        required: true,
        multiline: true,
      }),
      preferredClubOrProgram: boundedText(
        input.preferredClubOrProgram,
        "preferredClubOrProgram",
        fieldErrors,
        {
          maximum: 160,
          required: false,
        },
      ),
      format: allowlisted(
        input.format,
        HOST_FORMATS,
        "format",
        fieldErrors,
      ),
      preferredTiming: boundedText(
        input.preferredTiming,
        "preferredTiming",
        fieldErrors,
        {
          maximum: 1_000,
          required: false,
          multiline: true,
        },
      ),
    };
  } else {
    payload = {
      ...base,
      organizationOrVenueName: boundedText(
        input.organizationOrVenueName,
        "organizationOrVenueName",
        fieldErrors,
        {
          minimum: 2,
          maximum: 160,
          required: true,
        },
      ),
      partnershipType: allowlisted(
        input.partnershipType,
        PARTNERSHIP_TYPES,
        "partnershipType",
        fieldErrors,
      ),
      website: httpsUrl(input.website, fieldErrors),
      message: boundedText(input.message, "message", fieldErrors, {
        minimum: 10,
        maximum: 4_000,
        required: true,
        multiline: true,
      }),
    };
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new PublicFormValidationError(fieldErrors, payload);
  }
  return Object.freeze(payload);
}

export function publicFormLabel(formKey: PublicFormKey): string {
  switch (formKey) {
    case "contact":
      return "Contact";
    case "volunteer":
      return "Volunteer";
    case "host_event":
      return "Host an Event";
    case "partnership":
      return "Partnership or Funding Support";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new PublicFormValidationError(
      { form: "Complete the form and try again." },
      {},
    );
  }
  return value as Record<string, unknown>;
}

function boundedText(
  value: unknown,
  field: string,
  errors: Record<string, string>,
  options: Readonly<{
    maximum: number;
    minimum?: number;
    multiline?: boolean;
    required: boolean;
  }>,
): string | null {
  if (value === undefined || value === null || value === "") {
    if (options.required) errors[field] = "This field is required.";
    return null;
  }
  if (typeof value !== "string") {
    errors[field] = "Enter plain text.";
    return null;
  }
  const normalized = normalizePlainText(value, options.multiline ?? false);
  const length = Array.from(normalized).length;
  if (length > options.maximum) {
    errors[field] = `Use ${options.maximum.toLocaleString("en-CA")} characters or fewer.`;
  } else if (length < (options.minimum ?? 0)) {
    errors[field] =
      `Use at least ${(options.minimum ?? 0).toLocaleString("en-CA")} characters.`;
  }
  return normalized;
}

function email(
  value: unknown,
  errors: Record<string, string>,
): string | null {
  if (value === undefined || value === null || value === "") {
    errors.replyEmail = "A reply email is required.";
    return null;
  }
  try {
    return normalizeEmail(value, "replyEmail");
  } catch {
    errors.replyEmail = "Enter a valid reply email.";
    return typeof value === "string"
      ? normalizePlainText(value, false).slice(0, 254)
      : null;
  }
}

function allowlisted<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
  errors: Record<string, string>,
): T[number] | null {
  if (
    typeof value === "string" &&
    allowed.some((choice) => choice === value)
  ) {
    return value as T[number];
  }
  errors[field] = "Choose one of the listed options.";
  return null;
}

function allowlistedList<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
  errors: Record<string, string>,
): readonly T[number][] {
  if (!Array.isArray(value)) {
    errors[field] = "Choose at least one interest area.";
    return [];
  }
  const distinct = [
    ...new Set(
      value.filter(
        (item): item is T[number] =>
          typeof item === "string" &&
          allowed.some((choice) => choice === item),
      ),
    ),
  ];
  if (
    distinct.length !== value.length ||
    distinct.length < 1 ||
    distinct.length > 5
  ) {
    errors[field] = "Choose between one and five listed interest areas.";
  }
  return Object.freeze(distinct);
}

function httpsUrl(
  value: unknown,
  errors: Record<string, string>,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    errors.website = "Enter an HTTPS website address.";
    return null;
  }
  const text = normalizePlainText(value, false);
  if (Array.from(text).length > 500) {
    errors.website = "Use 500 characters or fewer.";
    return text.slice(0, 500);
  }
  try {
    const parsed = new URL(text);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password
    ) {
      throw new TypeError("unsafe URL");
    }
    return parsed.toString();
  } catch {
    errors.website = "Enter a valid HTTPS website address.";
    return text;
  }
}

function normalizePlainText(value: string, multiline: boolean): string {
  const normalized = value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(
      multiline
        ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu
        : /[\u0000-\u001F\u007F]/gu,
      "",
    );
  return multiline
    ? normalized
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trim()
    : normalized.replace(/\s+/gu, " ").trim();
}
