import assert from "node:assert/strict";
import test from "node:test";
import {
  SafeApplicationError,
  safeErrorResponse,
  writeSafeLog,
} from "../../lib/validation/server-observability.ts";

test("structured logs allowlist operational metadata and drop private values", () => {
  const originalWarn = console.warn;
  const lines = [];
  console.warn = (line) => lines.push(String(line));
  try {
    writeSafeLog("warn", "identity@example.com", {
      code: "secret token value",
      operation: "authorize_member",
      requestId: "request_123",
      route: "/organizer?token=PRIVATE_TOKEN",
      status: 403,
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(lines.length, 1);
  const serialized = lines[0];
  assert.equal(serialized.includes("identity@example.com"), false);
  assert.equal(serialized.includes("PRIVATE_TOKEN"), false);
  assert.equal(serialized.includes("secret token value"), false);
  assert.equal(serialized.includes("/organizer"), true);
  assert.equal(serialized.includes("request_123"), true);
});

test("safe error responses never serialize internal Error details", async () => {
  const originalError = console.error;
  console.error = () => {};
  let response;
  try {
    response = safeErrorResponse(
      new Error("PRIVATE_NOTE and token=PRIVATE_TOKEN"),
      { route: "/api/organizer/session" },
    );
  } finally {
    console.error = originalError;
  }
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(
    response.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
  const body = await response.text();
  assert.equal(body.includes("PRIVATE_NOTE"), false);
  assert.equal(body.includes("PRIVATE_TOKEN"), false);
});

test("safe application errors preserve only their approved public message", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  let response;
  try {
    response = safeErrorResponse(
      new SafeApplicationError(
        "authorization_denied",
        403,
        "Organizer access is not available.",
      ),
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: {
      code: "authorization_denied",
      message: "Organizer access is not available.",
    },
  });
});
