import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";
import {
  MAINTENANCE_REQUEST_MAX_AGE_MS,
  MAINTENANCE_REPLAY_RETENTION_MS,
  authenticateMaintenanceRequest,
} from "../../lib/server/maintenance/request-signature.ts";

const ORIGIN = "https://vancouvercuriosityclub.com";
const PATHNAME = "/api/maintenance/meetup/refresh";
const SECRET = "daily-maintenance-test-secret-that-is-long-enough";
const NOW = 2_000_000_000_000;
const REQUEST_ID = "da21e286-a8a7-48c8-a2e9-c22aa92f0c65";
const RAW_BODY = "{}";

test("maintenance request authentication covers method, timestamp, UUID, raw body, and a durable replay claim", async (t) => {
  const database = createReplayDatabase();
  t.after(() => database.close());
  const timestamp = String(Math.floor(NOW / 1_000));
  const request = await signedRequest({
    body: RAW_BODY,
    requestId: REQUEST_ID,
    secret: SECRET,
    timestamp,
  });

  const authenticated = await authenticateMaintenanceRequest(
    request,
    database,
    { nowUtcMs: NOW, secret: SECRET },
  );

  assert.deepEqual(authenticated, {
    rawBody: RAW_BODY,
    requestId: REQUEST_ID,
    timestamp: Number(timestamp),
  });
  const receipt = await database
    .prepare(
      `SELECT request_id, purpose, issued_at, expires_at, created_at
       FROM maintenance_request_receipts
       WHERE request_id = ?`,
    )
    .bind(REQUEST_ID)
    .first();
  assert.deepEqual({ ...receipt }, {
    request_id: REQUEST_ID,
    purpose: "daily_meetup_refresh",
    issued_at: Number(timestamp) * 1_000,
    expires_at: NOW + MAINTENANCE_REPLAY_RETENTION_MS,
    created_at: NOW,
  });
  assert.equal(MAINTENANCE_REQUEST_MAX_AGE_MS, 5 * 60_000);
  assert.ok(
    MAINTENANCE_REPLAY_RETENTION_MS >= 10 * 60_000,
    "replay receipts must remain durable for at least ten minutes",
  );
});

test("the same signed request can be claimed only once, including concurrent attempts", async (t) => {
  const database = createReplayDatabase();
  t.after(() => database.close());
  const requestFactory = () =>
    signedRequest({
      body: RAW_BODY,
      requestId: REQUEST_ID,
      secret: SECRET,
      timestamp: String(Math.floor(NOW / 1_000)),
    });

  const attempts = await Promise.allSettled([
    requestFactory().then((request) =>
      authenticateMaintenanceRequest(request, database, {
        nowUtcMs: NOW,
        secret: SECRET,
      }),
    ),
    requestFactory().then((request) =>
      authenticateMaintenanceRequest(request, database, {
        nowUtcMs: NOW,
        secret: SECRET,
      }),
    ),
  ]);

  assert.equal(
    attempts.filter((attempt) => attempt.status === "fulfilled").length,
    1,
  );
  const rejected = attempts.find((attempt) => attempt.status === "rejected");
  assert.ok(rejected);
  assert.equal(rejected.reason?.status, 409);
  assert.equal(
    await database
      .prepare(
        "SELECT count(*) AS count FROM maintenance_request_receipts",
      )
      .first("count"),
    1,
  );
});

test("claiming a request removes expired receipts but retains active replay receipts", async (t) => {
  const database = createReplayDatabase();
  t.after(() => database.close());
  database.exec(`
    INSERT INTO maintenance_request_receipts (
      request_id, purpose, issued_at, expires_at, created_at
    ) VALUES
      ('00000000-0000-4000-8000-000000000001',
       'daily_meetup_refresh', ${NOW - 20_000}, ${NOW}, ${NOW - 20_000}),
      ('00000000-0000-4000-8000-000000000002',
       'daily_meetup_refresh', ${NOW - 20_000}, ${NOW + 1}, ${NOW - 20_000});
  `);
  await authenticateMaintenanceRequest(
    await signedRequest({
      body: RAW_BODY,
      requestId: REQUEST_ID,
      secret: SECRET,
      timestamp: String(Math.floor(NOW / 1_000)),
    }),
    database,
    { nowUtcMs: NOW, secret: SECRET },
  );
  const receipts = await database
    .prepare(
      `SELECT request_id
       FROM maintenance_request_receipts
       ORDER BY request_id ASC`,
    )
    .all();
  assert.deepEqual(
    receipts.results.map((row) => row.request_id),
    ["00000000-0000-4000-8000-000000000002", REQUEST_ID],
  );
});

test("invalid method, timestamp, request ID, signature, or raw body never earns a replay claim", async (t) => {
  const invalidCases = [
    {
      label: "GET method",
      request: await signedRequest({
        body: undefined,
        method: "GET",
        requestId: REQUEST_ID,
        secret: SECRET,
        timestamp: String(Math.floor(NOW / 1_000)),
      }),
    },
    {
      label: "expired timestamp",
      request: await signedRequest({
        body: RAW_BODY,
        requestId: REQUEST_ID,
        secret: SECRET,
        timestamp: String(
          Math.floor((NOW - MAINTENANCE_REQUEST_MAX_AGE_MS - 1_000) / 1_000),
        ),
      }),
    },
    {
      label: "future timestamp",
      request: await signedRequest({
        body: RAW_BODY,
        requestId: REQUEST_ID,
        secret: SECRET,
        timestamp: String(
          Math.floor((NOW + MAINTENANCE_REQUEST_MAX_AGE_MS + 1_000) / 1_000),
        ),
      }),
    },
    {
      label: "non-UUID request ID",
      request: await signedRequest({
        body: RAW_BODY,
        requestId: "daily-refresh-1",
        secret: SECRET,
        timestamp: String(Math.floor(NOW / 1_000)),
      }),
    },
    {
      label: "non-canonical uppercase request ID",
      request: await signedRequest({
        body: RAW_BODY,
        requestId: REQUEST_ID.toUpperCase(),
        secret: SECRET,
        timestamp: String(Math.floor(NOW / 1_000)),
      }),
    },
    {
      label: "wrong signature",
      request: await signedRequest({
        body: RAW_BODY,
        requestId: REQUEST_ID,
        secret: `${SECRET}-wrong`,
        timestamp: String(Math.floor(NOW / 1_000)),
      }),
    },
    {
      label: "body changed after signing",
      request: await signedRequest({
        body: RAW_BODY,
        requestBody: '{"unexpected":true}',
        requestId: REQUEST_ID,
        secret: SECRET,
        timestamp: String(Math.floor(NOW / 1_000)),
      }),
    },
  ];

  for (const invalidCase of invalidCases) {
    await t.test(invalidCase.label, async (t) => {
      const database = createReplayDatabase();
      t.after(() => database.close());
      await assert.rejects(
        authenticateMaintenanceRequest(invalidCase.request, database, {
          nowUtcMs: NOW,
          secret: SECRET,
        }),
        (error) =>
          typeof error?.status === "number" && error.status >= 400,
      );
      assert.equal(
        await database
          .prepare(
            "SELECT count(*) AS count FROM maintenance_request_receipts",
          )
          .first("count"),
        0,
      );
    });
  }
});

test("signature verification uses a constant-time cryptographic primitive", () => {
  const source = readFileSync(
    new URL(
      "../../lib/server/maintenance/request-signature.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /crypto\.subtle\.verify\s*\(/u);
  assert.match(source, /HMAC/u);
  assert.match(source, /SHA-256/u);
  assert.doesNotMatch(
    source,
    /expectedSignature\s*(?:===|!==)\s*(?:provided|signature)/u,
  );
});

function createReplayDatabase() {
  const database = new SqliteD1TestDatabase("");
  database.exec(`
    CREATE TABLE maintenance_request_receipts (
      request_id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return database;
}

async function signedRequest({
  body,
  method = "POST",
  requestBody = body,
  requestId,
  secret,
  timestamp,
}) {
  const signature = await hmacHex(
    secret,
    `${timestamp}.${requestId}.${body ?? ""}`,
  );
  return new Request(`${ORIGIN}${PATHNAME}`, {
    body: method === "GET" || method === "HEAD" ? undefined : requestBody,
    headers: {
      "content-type": "application/json",
      "x-maintenance-request-id": requestId,
      "x-maintenance-signature": `sha256=${signature}`,
      "x-maintenance-timestamp": timestamp,
    },
    method,
  });
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
