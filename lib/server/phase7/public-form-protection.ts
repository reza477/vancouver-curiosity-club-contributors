import type { D1DatabaseLike } from "../auth";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  parsePublicFormKey,
  type PublicFormKey,
} from "./public-form-contract";

export const PUBLIC_FORM_INSTANCE_MAX_AGE_MS = 2 * 60 * 60 * 1_000;
export const PUBLIC_FORM_MINIMUM_COMPLETION_MS = 3_000;
export const PUBLIC_FORM_CLIENT_COOKIE = "__Host-vcc-form-client";

export type PublicFormInstance = Readonly<{
  formKey: PublicFormKey;
  issuedAt: number;
  nonce: string;
}>;

export async function ensurePublicFormProtectionKey(
  database: D1DatabaseLike,
  organizationId: string,
  nowUtcMs: number,
): Promise<string> {
  const existing = await database
    .prepare(
      `SELECT key_hex
       FROM public_form_protection_keys
       WHERE organization_id = ?
       LIMIT 1`,
    )
    .bind(organizationId)
    .first<string>("key_hex");
  if (typeof existing === "string" && /^[a-f0-9]{64}$/u.test(existing)) {
    return existing;
  }
  if (existing !== null && existing !== undefined) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The form is temporarily unavailable.",
    );
  }
  const candidate = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  await database
    .prepare(
      `INSERT INTO public_form_protection_keys (
         organization_id, key_hex, version, created_at, updated_at
       )
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(organization_id) DO NOTHING`,
    )
    .bind(organizationId, candidate, nowUtcMs, nowUtcMs)
    .run();
  const keyHex = await database
    .prepare(
      `SELECT key_hex
       FROM public_form_protection_keys
       WHERE organization_id = ?
       LIMIT 1`,
    )
    .bind(organizationId)
    .first<string>("key_hex");
  if (typeof keyHex !== "string" || !/^[a-f0-9]{64}$/u.test(keyHex)) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The form is temporarily unavailable.",
    );
  }
  return keyHex;
}

export async function createPublicFormInstanceToken(
  keyHex: string,
  formKey: PublicFormKey,
  nowUtcMs: number,
): Promise<Readonly<{ instance: PublicFormInstance; token: string }>> {
  const instance = Object.freeze({
    formKey,
    issuedAt: nowUtcMs,
    nonce: randomBase64Url(24),
  });
  const payload = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        f: instance.formKey,
        i: instance.issuedAt,
        n: instance.nonce,
      }),
    ),
  );
  const signature = await hmacBase64Url(keyHex, payload);
  return Object.freeze({ instance, token: `${payload}.${signature}` });
}

export async function verifyPublicFormInstanceToken(
  keyHex: string,
  tokenValue: unknown,
  expectedFormKey: PublicFormKey,
  nowUtcMs: number,
): Promise<PublicFormInstance> {
  if (
    typeof tokenValue !== "string" ||
    tokenValue.length < 32 ||
    tokenValue.length > 1_024
  ) {
    throw invalidInstance();
  }
  const parts = tokenValue.split(".");
  if (parts.length !== 2) throw invalidInstance();
  const [payload, signature] = parts;
  if (!payload || !signature) throw invalidInstance();
  const expectedSignature = await hmacBase64Url(keyHex, payload);
  if (!constantTimeTextEqual(signature, expectedSignature)) {
    throw invalidInstance();
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        base64UrlDecode(payload),
      ),
    );
  } catch {
    throw invalidInstance();
  }
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    Array.isArray(decoded)
  ) {
    throw invalidInstance();
  }
  const record = decoded as Record<string, unknown>;
  const formKey = parsePublicFormKey(record.f);
  if (
    formKey !== expectedFormKey ||
    typeof record.n !== "string" ||
    !/^[A-Za-z0-9_-]{32}$/u.test(record.n) ||
    typeof record.i !== "number" ||
    !Number.isSafeInteger(record.i) ||
    record.i > nowUtcMs + 30_000 ||
    nowUtcMs - record.i > PUBLIC_FORM_INSTANCE_MAX_AGE_MS
  ) {
    throw invalidInstance();
  }
  return Object.freeze({
    formKey,
    issuedAt: record.i,
    nonce: record.n,
  });
}

export async function derivePublicFormScopeKey(
  keyHex: string,
  value: string,
): Promise<string> {
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await importHmacKey(keyHex),
        new TextEncoder().encode(value),
      ),
    ),
  );
}

export async function publicFormIdempotencyHash(
  keyHex: string,
  input: Readonly<{
    clientId: string;
    formKey: PublicFormKey;
    nonce: string;
    organizationId: string;
  }>,
): Promise<string> {
  return derivePublicFormScopeKey(
    keyHex,
    `v1\u0000${input.organizationId}\u0000${input.formKey}\u0000${input.nonce}\u0000${input.clientId}`,
  );
}

export function createAnonymousFormClientId(): string {
  return randomBase64Url(32);
}

export function isAnonymousFormClientId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{43}$/u.test(value)
  );
}

export function anonymousFormCookie(value: string): string {
  return `${PUBLIC_FORM_CLIENT_COOKIE}=${value}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`;
}

export function readCookie(
  header: string | null,
  name: string,
): string | null {
  if (!header) return null;
  for (const item of header.split(";")) {
    const index = item.indexOf("=");
    if (index < 1) continue;
    if (item.slice(0, index).trim() === name) {
      return item.slice(index + 1).trim();
    }
  }
  return null;
}

function invalidInstance(): SafeApplicationError {
  return new SafeApplicationError(
    "authorization_denied",
    403,
    "Refresh the form and try again.",
  );
}

function randomBase64Url(byteLength: number): string {
  return base64UrlEncode(
    crypto.getRandomValues(new Uint8Array(byteLength)),
  );
}

async function hmacBase64Url(
  keyHex: string,
  value: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importHmacKey(keyHex),
    new TextEncoder().encode(value),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

function importHmacKey(keyHex: string): Promise<CryptoKey> {
  if (!/^[a-f0-9]{64}$/u.test(keyHex)) {
    throw new TypeError("Invalid form-protection key.");
  }
  return crypto.subtle.importKey(
    "raw",
    exactArrayBuffer(hexToBytes(keyHex)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError("Invalid base64url.");
  }
  const padded = `${value.replace(/-/gu, "+").replace(/_/gu, "/")}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return difference === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hexToBytes(value: string): Uint8Array {
  return Uint8Array.from(
    value.match(/.{2}/gu) ?? [],
    (pair) => Number.parseInt(pair, 16),
  );
}
