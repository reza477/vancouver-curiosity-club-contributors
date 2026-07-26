import type {
  AuthorizedMembership,
  D1DatabaseLike,
} from "../auth";
import { parseFiniteInteger } from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";

export type OrganizerRateLimitAction =
  | "invitation_accept"
  | "invitation_create";

export async function consumeOrganizerRateLimit(
  database: D1DatabaseLike,
  input: Readonly<{
    action: OrganizerRateLimitAction;
    actor?: AuthorizedMembership;
    limit: number;
    nowUtcMs?: number;
    scopeMaterial: string;
    windowMs: number;
  }>,
): Promise<void> {
  const now = parseFiniteInteger(input.nowUtcMs ?? Date.now(), {
    path: "nowUtcMs",
    minimum: 0,
  });
  const limit = parseFiniteInteger(input.limit, {
    path: "rateLimit",
    minimum: 1,
    maximum: 1_000,
  });
  const windowMs = parseFiniteInteger(input.windowMs, {
    path: "rateLimitWindowMs",
    minimum: 1_000,
    maximum: 7 * 24 * 60 * 60_000,
  });
  const windowStartedAt = Math.floor(now / windowMs) * windowMs;
  const windowExpiresAt = windowStartedAt + windowMs;
  const scopeKey = await sha256Hex(
    `${input.action}\u0000${input.scopeMaterial}`,
  );
  const row = await database
    .prepare(
      `INSERT INTO organizer_rate_limits (
         id, organization_id, profile_id, action, scope_key,
         window_started_at, window_expires_at, request_count,
         created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(action, scope_key, window_started_at)
       DO UPDATE SET
         request_count = organizer_rate_limits.request_count + 1,
         updated_at = excluded.updated_at
       WHERE organizer_rate_limits.request_count < ?
         AND organizer_rate_limits.window_expires_at > excluded.updated_at
       RETURNING request_count`,
    )
    .bind(
      crypto.randomUUID(),
      input.actor?.organizationId ?? null,
      input.actor?.profileId ?? null,
      input.action,
      scopeKey,
      windowStartedAt,
      windowExpiresAt,
      now,
      now,
      limit,
    )
    .first<Record<string, unknown>>();
  if (!row || typeof row.request_count !== "number") {
    throw new SafeApplicationError(
      "rate_limited",
      429,
      "Too many attempts. Please wait and try again.",
    );
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
