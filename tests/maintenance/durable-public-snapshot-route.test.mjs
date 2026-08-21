import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import test from "node:test";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";
import { countD1Statements } from "../auth/intercept-d1.mjs";

const ORIGIN = "https://vancouvercuriosityclub.com";
const PATHNAME = "/api/maintenance/public-snapshots/capture";
const SECRET = "snapshot-route-secret-that-is-at-least-thirty-two-bytes";
const BATCH_ID = "00000000-0000-4000-8000-000000000001";
const ROUTE_ENVIRONMENT = {};

globalThis.__VCC_DURABLE_SNAPSHOT_ROUTE_ENV__ = ROUTE_ENVIRONMENT;

nodeModule.registerHooks?.({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export const env = globalThis.__VCC_DURABLE_SNAPSHOT_ROUTE_ENV__;",
        ),
      };
    }
    if (specifier === "server-only") {
      return { shortCircuit: true, url: dataModule("export {};") };
    }
    return nextResolve(specifier, context);
  },
});

const route = await import(
  "../../app/api/maintenance/public-snapshots/capture/route.ts?snapshot-route"
);

test("the capture intent is signature-only, replay-safe, and uses exactly two D1 statements", async (t) => {
  const inner = createReplayDatabase();
  t.after(() => inner.close());
  const counter = countD1Statements(inner);
  setRuntime(counter.database, SECRET);
  const body = JSON.stringify({ batchId: BATCH_ID, slot: "home-html" });
  assert.ok(new TextEncoder().encode(body).byteLength <= 128);
  const requestId = crypto.randomUUID();
  const response = await route.POST(
    await signedRequest({ body, requestId, secret: SECRET }),
  );
  assert.equal(response.status, 200);
  assert.equal(counter.count(), 2);
  assert.deepEqual(await response.json(), {
    batchId: BATCH_ID,
    slot: "home-html",
    status: "accepted",
  });
  assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
  assert.equal(response.headers.get("set-cookie"), null);

  const replay = await route.POST(
    await signedRequest({ body, requestId, secret: SECRET }),
  );
  assert.equal(replay.status, 409);
});

test("invalid slots, extra fields, cookies, and forged owner headers cannot authorize capture", async (t) => {
  const database = createReplayDatabase();
  t.after(() => database.close());
  setRuntime(database, SECRET);
  for (const input of [
    { batchId: BATCH_ID, slot: "unknown" },
    { batchId: "not-a-uuid", slot: "events-html" },
    { batchId: BATCH_ID, extra: true, slot: "events-html" },
  ]) {
    const body = JSON.stringify(input);
    const response = await route.POST(
      await signedRequest({
        body,
        requestId: crypto.randomUUID(),
        secret: SECRET,
      }),
    );
    assert.equal(response.status, 400);
  }

  const body = JSON.stringify({ batchId: BATCH_ID, slot: "events-html" });
  const forged = new Request(`${ORIGIN}${PATHNAME}`, {
    body,
    headers: {
      "content-type": "application/json",
      cookie: "owner=forged",
      "oai-authenticated-user-email": "owner@example.com",
      "x-maintenance-request-id": crypto.randomUUID(),
      "x-maintenance-signature": `sha256=${"0".repeat(64)}`,
      "x-maintenance-timestamp": String(Math.floor(Date.now() / 1_000)),
    },
    method: "POST",
  });
  assert.equal((await route.POST(forged)).status, 403);
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

function setRuntime(database, secret) {
  for (const key of Object.keys(ROUTE_ENVIRONMENT)) {
    delete ROUTE_ENVIRONMENT[key];
  }
  ROUTE_ENVIRONMENT.DB = database;
  ROUTE_ENVIRONMENT.DAILY_MEETUP_REFRESH_SECRET = secret;
}

async function signedRequest({ body, requestId, secret }) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = await hmacHex(
    secret,
    JSON.stringify([timestamp, requestId, PATHNAME, body]),
  );
  return new Request(`${ORIGIN}${PATHNAME}`, {
    body,
    headers: {
      "content-type": "application/json",
      "x-maintenance-request-id": requestId,
      "x-maintenance-signature": `sha256=${signature}`,
      "x-maintenance-timestamp": timestamp,
    },
    method: "POST",
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

function dataModule(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}
