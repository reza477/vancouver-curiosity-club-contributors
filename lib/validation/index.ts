/**
 * Small, dependency-free server validation primitives.
 *
 * These helpers intentionally accept `unknown` at trust boundaries and return
 * narrow values. They never include the rejected value in an error message.
 */

export type ValidationIssue = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

export class InputValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super("The request could not be validated.");
    this.name = "InputValidationError";
    this.issues = issues;
  }
}

export function validationIssue(
  path: string,
  code: string,
  message: string,
): InputValidationError {
  return new InputValidationError([{ path, code, message }]);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseObject(
  value: unknown,
  path = "input",
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw validationIssue(path, "invalid_type", "Expected an object.");
  }
  return value;
}

export function assertOnlyKeys(
  object: Record<string, unknown>,
  allowedKeys: readonly string[],
  path = "input",
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(object).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw validationIssue(
      path,
      "unexpected_key",
      "The request contains unsupported fields.",
    );
  }
}

export function parseBoundedString(
  value: unknown,
  options: Readonly<{
    path: string;
    minLength?: number;
    maxLength: number;
    trim?: boolean;
  }>,
): string {
  if (typeof value !== "string") {
    throw validationIssue(
      options.path,
      "invalid_type",
      "Expected a text value.",
    );
  }

  const parsed = options.trim === false ? value : value.trim();
  const minLength = options.minLength ?? 1;
  if (parsed.length < minLength || parsed.length > options.maxLength) {
    throw validationIssue(
      options.path,
      "invalid_length",
      "The text value has an invalid length.",
    );
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(parsed)) {
    throw validationIssue(
      options.path,
      "invalid_character",
      "The text value contains unsupported characters.",
    );
  }
  return parsed;
}

export function parseOptionalBoundedString(
  value: unknown,
  options: Readonly<{
    path: string;
    maxLength: number;
    trim?: boolean;
  }>,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  return parseBoundedString(value, {
    ...options,
    minLength: 1,
  });
}

export function normalizeEmail(value: unknown, path = "email"): string {
  const email = parseBoundedString(value, {
    path,
    minLength: 3,
    maxLength: 254,
  }).toLowerCase();

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
    email.startsWith(".") ||
    email.endsWith(".") ||
    email.includes("..")
  ) {
    throw validationIssue(path, "invalid_email", "Expected a valid email.");
  }

  return email;
}

export function tryNormalizeEmail(value: unknown): string | null {
  try {
    return normalizeEmail(value);
  } catch {
    return null;
  }
}

export function parseIdentifier(value: unknown, path: string): string {
  const identifier = parseBoundedString(value, {
    path,
    minLength: 1,
    maxLength: 128,
  });
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]*$/u.test(identifier)) {
    throw validationIssue(
      path,
      "invalid_identifier",
      "Expected a valid identifier.",
    );
  }
  return identifier;
}

export function parseEnum<const T extends readonly string[]>(
  value: unknown,
  allowedValues: T,
  path: string,
): T[number] {
  if (
    typeof value !== "string" ||
    !allowedValues.some((allowed) => allowed === value)
  ) {
    throw validationIssue(
      path,
      "invalid_choice",
      "Expected one of the supported values.",
    );
  }
  return value as T[number];
}

export function parseFiniteInteger(
  value: unknown,
  options: Readonly<{
    path: string;
    minimum?: number;
    maximum?: number;
  }>,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (options.minimum !== undefined && value < options.minimum) ||
    (options.maximum !== undefined && value > options.maximum)
  ) {
    throw validationIssue(
      options.path,
      "invalid_integer",
      "Expected an integer in the supported range.",
    );
  }
  return value;
}

export function parseHttpsUrl(value: unknown, path: string): string {
  const input = parseBoundedString(value, {
    path,
    maxLength: 2_048,
  });
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw validationIssue(path, "invalid_url", "Expected a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw validationIssue(path, "invalid_url", "Expected a secure HTTPS URL.");
  }
  return parsed.toString();
}

export async function readJsonObject(
  request: Request,
  options: Readonly<{ maxBytes?: number }> = {},
): Promise<Record<string, unknown>> {
  const maxBytes = options.maxBytes ?? 32_768;
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBytes)
  ) {
    throw validationIssue(
      "body",
      "body_too_large",
      "The request body is too large.",
    );
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw validationIssue(
      "body",
      "body_too_large",
      "The request body is too large.",
    );
  }

  try {
    return parseObject(JSON.parse(body), "body");
  } catch (error) {
    if (error instanceof InputValidationError) throw error;
    throw validationIssue("body", "invalid_json", "Expected a JSON object.");
  }
}
