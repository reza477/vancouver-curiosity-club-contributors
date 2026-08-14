import type { D1DatabaseLike } from "../auth";
import { SafeApplicationError } from "../../validation/server-observability";

export const MAINTENANCE_REQUEST_MAX_AGE_MS = 5 * 60_000;
export const MAINTENANCE_REPLAY_RETENTION_MS = 10 * 60_000;

const MAINTENANCE_PURPOSE = "daily_meetup_refresh";
// Large enough for the bounded {batchId, slot} snapshot-capture envelope;
// still far below a generic API payload.
const MAX_BODY_BYTES = 128;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/iu;
const TIMESTAMP_PATTERN = /^\d{10}$/u;

export type AuthenticatedMaintenanceRequest = Readonly<{
  rawBody: string;
  requestId: string;
  timestamp: number;
}>;

export async function authenticateMaintenanceRequest(
  request: Request,
  database: D1DatabaseLike,
  options: Readonly<{
    nowUtcMs: number;
    secret: string;
  }>,
): Promise<AuthenticatedMaintenanceRequest> {
  if (request.method !== "POST") throw authorizationDenied();
  const nowUtcMs = options.nowUtcMs;
  if (!Number.isSafeInteger(nowUtcMs) || nowUtcMs < 0) {
    throw configurationUnavailable();
  }
  if (
    typeof options.secret !== "string" ||
    options.secret.length < 32 ||
    options.secret.length > 512
  ) {
    throw configurationUnavailable();
  }

  const timestampHeader = request.headers.get(
    "x-maintenance-timestamp",
  );
  const requestId = request.headers.get("x-maintenance-request-id");
  const signatureHeader = request.headers.get(
    "x-maintenance-signature",
  );
  if (
    timestampHeader === null ||
    requestId === null ||
    signatureHeader === null ||
    !TIMESTAMP_PATTERN.test(timestampHeader) ||
    !UUID_PATTERN.test(requestId)
  ) {
    throw authorizationDenied();
  }
  const signatureMatch = SIGNATURE_PATTERN.exec(signatureHeader);
  if (!signatureMatch) throw authorizationDenied();
  const timestamp = Number(timestampHeader);
  const issuedAt = timestamp * 1_000;
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowUtcMs - issuedAt) > MAINTENANCE_REQUEST_MAX_AGE_MS
  ) {
    throw authorizationDenied();
  }

  const rawBody = await readBoundedUtf8Body(request, MAX_BODY_BYTES);
  const signedPayload = `${timestampHeader}.${requestId}.${rawBody}`;
  const verified = await verifyHmacSha256(
    options.secret,
    signedPayload,
    signatureMatch[1]!,
  );
  if (!verified) throw authorizationDenied();

  const [cleanup, claimed] = await database.batch([
    database
      .prepare(
        `DELETE FROM maintenance_request_receipts
         WHERE expires_at <= ?`,
      )
      .bind(nowUtcMs),
    database
      .prepare(
        `INSERT INTO maintenance_request_receipts (
           request_id, purpose, issued_at, expires_at, created_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(request_id) DO NOTHING`,
      )
      .bind(
        requestId,
        MAINTENANCE_PURPOSE,
        issuedAt,
        nowUtcMs + MAINTENANCE_REPLAY_RETENTION_MS,
        nowUtcMs,
      ),
  ]);
  if (
    !cleanup ||
    cleanup.success === false ||
    !claimed ||
    claimed.success === false
  ) {
    throw configurationUnavailable();
  }
  if (Number(claimed.meta?.changes ?? 0) !== 1) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "This maintenance request has already been processed.",
    );
  }

  return Object.freeze({ rawBody, requestId, timestamp });
}

async function verifyHmacSha256(
  secret: string,
  payload: string,
  providedHex: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    exactArrayBuffer(new TextEncoder().encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    exactArrayBuffer(hexToBytes(providedHex)),
    exactArrayBuffer(new TextEncoder().encode(payload)),
  );
}

async function readBoundedUtf8Body(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) throw authorizationDenied();
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
      throw authorizationDenied();
    }
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw authorizationDenied();
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw authorizationDenied();
  }
}

function hexToBytes(value: string): Uint8Array {
  const pairs = value.match(/.{2}/gu);
  if (!pairs || pairs.length !== 32) throw authorizationDenied();
  return Uint8Array.from(pairs, (pair) => Number.parseInt(pair, 16));
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(result).set(bytes);
  return result;
}

function authorizationDenied(): SafeApplicationError {
  return new SafeApplicationError(
    "authorization_denied",
    403,
    "The maintenance request could not be authorized.",
  );
}

function configurationUnavailable(): SafeApplicationError {
  return new SafeApplicationError(
    "service_unavailable",
    503,
    "Maintenance is temporarily unavailable.",
  );
}
