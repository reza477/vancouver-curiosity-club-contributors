import { appendFile } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";

const MAX_INVARIANT_REPAIR_ATTEMPTS = 16;
const MAX_DELIVERY_INVOCATIONS = 32;
const MAX_RETRY_AFTER_SECONDS = 30;
const INVARIANT_REPAIR_DETAIL =
  "The database safety checks were updated. Please try again shortly so the fresh state can be verified.";
const PATHNAME = "/api/maintenance/forms/email";

const secret = process.env.DAILY_MEETUP_REFRESH_SECRET;
if (typeof secret !== "string" || secret.length < 32 || secret.length > 512) {
  throw new Error("DAILY_MEETUP_REFRESH_SECRET is unavailable.");
}
const origin = strictPublicOrigin(process.env.PUBLIC_SITE_URL);
const endpoint = `${origin}${PATHNAME}`;
const totals = {
  attempted: 0,
  blocked: 0,
  retried: 0,
  sent: 0,
  suppressed: 0,
};
let completed = false;

for (
  let invocation = 1;
  invocation <= MAX_DELIVERY_INVOCATIONS;
  invocation += 1
) {
  const report = await requestDeliverySlice();
  for (const key of Object.keys(totals)) totals[key] += report[key];
  if (report.status === "continue") {
    process.stdout.write(
      `Organizer email maintenance drained bounded slice ${invocation}.\n`,
    );
    continue;
  }

  completed = true;
  const deferred = totals.blocked + totals.retried;
  const summary = [
    deferred > 0
      ? "## Organizer form email maintenance failed"
      : "## Organizer form email maintenance succeeded",
    "",
    `- Invocations: ${invocation}`,
    `- Attempted: ${totals.attempted}`,
    `- Sent: ${totals.sent}`,
    `- Suppressed before delivery: ${totals.suppressed}`,
    `- Retained for retry: ${totals.retried}`,
    `- Blocked malformed rows: ${totals.blocked}`,
    "",
  ].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
  }
  process.stdout.write(summary);
  if (report.status === "failed" || deferred > 0) {
    throw new Error(
      "Organizer form email maintenance retained one or more queued copies.",
    );
  }
  break;
}

if (!completed) {
  throw new Error(
    `Organizer form email maintenance exceeded its ${MAX_DELIVERY_INVOCATIONS}-invocation safety limit.`,
  );
}

async function requestDeliverySlice() {
  for (
    let attempt = 1;
    attempt <= MAX_INVARIANT_REPAIR_ATTEMPTS;
    attempt += 1
  ) {
    const body = "{}";
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const requestId = randomUUID();
    const signedPayload = JSON.stringify([
      timestamp,
      requestId,
      PATHNAME,
      body,
    ]);
    const signature = createHmac("sha256", secret)
      .update(signedPayload)
      .digest("hex");
    const response = await fetch(endpoint, {
      body,
      headers: {
        "content-type": "application/json",
        "x-maintenance-request-id": requestId,
        "x-maintenance-signature": `sha256=${signature}`,
        "x-maintenance-timestamp": timestamp,
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(90_000),
    });
    const text = await boundedText(response, 16_384);

    if (response.ok) return parseDeliveryReport(text, requestId);
    if (
      response.status !== 503 ||
      !text.includes(INVARIANT_REPAIR_DETAIL) ||
      attempt === MAX_INVARIANT_REPAIR_ATTEMPTS
    ) {
      throw new Error(
        `Organizer form email maintenance failed safely with HTTP ${response.status}.`,
      );
    }
    const retryAfterSeconds = parseRetryAfter(
      response.headers.get("retry-after"),
      Date.now(),
    );
    process.stdout.write(
      `Database guards were repaired; retrying organizer email maintenance in ${retryAfterSeconds}s.\n`,
    );
    await new Promise((resolve) =>
      setTimeout(resolve, retryAfterSeconds * 1_000),
    );
  }
  throw new Error("Organizer form email maintenance did not converge.");
}

function strictPublicOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("PUBLIC_SITE_URL must be one exact HTTPS origin.");
  }
  const local = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.hostname.endsWith(".") ||
    local.has(parsed.hostname.toLowerCase())
  ) {
    throw new Error("PUBLIC_SITE_URL must be one exact HTTPS origin.");
  }
  return parsed.origin;
}

async function boundedText(response, maximumBytes) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) {
    throw new Error("The maintenance response exceeded its safe size limit.");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function parseDeliveryReport(text, requestId) {
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error("The organizer email maintenance report was invalid.");
  }
  const count = (value) =>
    Number.isSafeInteger(value) && value >= 0 ? value : null;
  const normalized = {
    attempted: count(report?.attempted),
    blocked: count(report?.blocked),
    retried: count(report?.retried),
    sent: count(report?.sent),
    suppressed: count(report?.suppressed),
    status: report?.status,
  };
  if (
    !["continue", "failed", "succeeded"].includes(normalized.status) ||
    report?.requestId !== requestId ||
    Object.entries(normalized).some(
      ([key, value]) => key !== "status" && value === null,
    ) ||
    normalized.sent +
      normalized.suppressed +
      normalized.retried +
      normalized.blocked >
      normalized.attempted ||
    (normalized.status === "continue" && normalized.attempted !== 6) ||
    (normalized.status === "failed" &&
      normalized.blocked + normalized.retried === 0) ||
    (normalized.status === "succeeded" &&
      normalized.blocked + normalized.retried !== 0)
  ) {
    throw new Error("The organizer email maintenance report was unsafe.");
  }
  return normalized;
}

function parseRetryAfter(value, nowUtcMs) {
  if (!value) throw new Error("The maintenance retry delay was unavailable.");
  let seconds;
  if (/^\d+$/u.test(value.trim())) {
    seconds = Number(value.trim());
  } else {
    const retryAt = Date.parse(value);
    if (!Number.isFinite(retryAt)) {
      throw new Error("The maintenance retry delay was invalid.");
    }
    seconds = Math.max(0, Math.ceil((retryAt - nowUtcMs) / 1_000));
  }
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new Error("The maintenance retry delay was invalid.");
  }
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}
