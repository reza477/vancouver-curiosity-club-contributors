import { InputValidationError } from "./index";

export type SafeErrorCode =
  | "authentication_required"
  | "authorization_denied"
  | "conflict"
  | "internal_error"
  | "not_found"
  | "service_unavailable"
  | "validation_failed";

export class SafeApplicationError extends Error {
  readonly code: SafeErrorCode;
  readonly status: number;
  readonly publicMessage: string;

  constructor(
    code: SafeErrorCode,
    status: number,
    publicMessage: string,
  ) {
    super(publicMessage);
    this.name = "SafeApplicationError";
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export type SafeLogContext = Readonly<{
  code?: string;
  durationMs?: number;
  operation?: string;
  requestId?: string;
  route?: string;
  status?: number;
}>;

/**
 * Emits only an explicit metadata allowlist. Do not add emails, tokens, request
 * bodies, private event content, or arbitrary Error objects to this type.
 */
export function writeSafeLog(
  level: "info" | "warn" | "error",
  event: string,
  context: SafeLogContext = {},
): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event: safeLogToken(event, "application_event"),
    ...(context.code
      ? { code: safeLogToken(context.code, "unknown_code") }
      : {}),
    ...(typeof context.durationMs === "number" &&
    Number.isFinite(context.durationMs)
      ? { durationMs: Math.max(0, Math.round(context.durationMs)) }
      : {}),
    ...(context.operation
      ? { operation: safeLogToken(context.operation, "unknown_operation") }
      : {}),
    ...(context.requestId
      ? { requestId: safeLogToken(context.requestId, "invalid_request_id") }
      : {}),
    ...(context.route
      ? { route: safeRoute(context.route) }
      : {}),
    ...(typeof context.status === "number"
      ? { status: Math.round(context.status) }
      : {}),
  };

  const line = JSON.stringify(record);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

export function classifySafeError(error: unknown): Readonly<{
  code: SafeErrorCode;
  message: string;
  status: number;
}> {
  if (error instanceof SafeApplicationError) {
    return {
      code: error.code,
      message: error.publicMessage,
      status: error.status,
    };
  }
  if (error instanceof InputValidationError) {
    return {
      code: "validation_failed",
      message: "The request could not be validated.",
      status: 400,
    };
  }
  return {
    code: "internal_error",
    message: "The request could not be completed.",
    status: 500,
  };
}

export function safeErrorResponse(
  error: unknown,
  context: SafeLogContext = {},
): Response {
  const safe = classifySafeError(error);
  writeSafeLog(safe.status >= 500 ? "error" : "warn", "request_failed", {
    ...context,
    code: safe.code,
    status: safe.status,
  });

  return new Response(
    JSON.stringify({
      error: {
        code: safe.code,
        message: safe.message,
      },
    }),
    {
      status: safe.status,
      headers: privateJsonHeaders(),
    },
  );
}

export function privateJsonHeaders(): Headers {
  return new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
}

function safeLogToken(value: string, fallback: string): string {
  const bounded = value.slice(0, 96);
  // Operational tokens are identifiers, never URLs or paths. In particular,
  // excluding `:` and `/` prevents a feed URL or credential-bearing URL from
  // being smuggled into the event/code/operation fields.
  return /^[A-Za-z0-9_.-]+$/u.test(bounded) ? bounded : fallback;
}

function safeRoute(value: string): string {
  const pathname = value.split(/[?#]/u, 1)[0] ?? "";
  return pathname.startsWith("/") && pathname.length <= 160
    ? pathname
    : "/unknown";
}
