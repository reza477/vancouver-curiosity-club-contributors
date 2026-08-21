import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import test from "node:test";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const ORIGIN = "https://vancouvercuriosityclub.com";
const PATHNAME = "/api/maintenance/forms/email";
const SECRET = "form-email-maintenance-test-secret-long-enough";
const ROUTE_ENVIRONMENT = {};
let drain = async () => {
  throw new Error("The form-email route test did not install a drain.");
};
let received = null;
let configuration = null;

globalThis.__VCC_FORM_EMAIL_ROUTE_ENV__ = ROUTE_ENVIRONMENT;
globalThis.__VCC_FORM_EMAIL_ROUTE_DRAIN__ = (...args) => drain(...args);
globalThis.__VCC_FORM_EMAIL_ROUTE_CONFIGURATION__ = () => configuration;

nodeModule.registerHooks?.({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export const env = globalThis.__VCC_FORM_EMAIL_ROUTE_ENV__;",
        ),
      };
    }
    if (specifier === "@/lib/server/phase7/public-form-email") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export async function drainPublicFormEmailOutbox(...args) { return globalThis.__VCC_FORM_EMAIL_ROUTE_DRAIN__(...args); }",
        ),
      };
    }
    if (specifier === "@/lib/server/phase7/public-form-email-runtime") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export function readPublicFormEmailConfiguration() { return globalThis.__VCC_FORM_EMAIL_ROUTE_CONFIGURATION__(); }",
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
  "../../app/api/maintenance/forms/email/route.ts?form-email-maintenance-route"
);

test("signed form-email maintenance drains independently with a bounded safe report", async (t) => {
  assert.equal(typeof route.POST, "function");
  assert.equal(route.GET, undefined);
  const database = createReplayDatabase();
  t.after(() => database.close());
  setRuntime(database, true);
  drain = async (receivedDatabase, options) => {
    received = { database: receivedDatabase, options };
    return {
      attempted: 2,
      blocked: 0,
      configurationMissing: 0,
      hasMoreDue: false,
      retried: 0,
      sent: 2,
      suppressed: 0,
    };
  };

  const requestId = crypto.randomUUID();
  const response = await route.POST(await signedRequest({ requestId }));
  assert.equal(response.status, 200);
  assert.equal(received.database, database);
  assert.equal(received.options.limit, 6);
  assert.deepEqual(await response.json(), {
    attempted: 2,
    blocked: 0,
    requestId,
    retried: 0,
    sent: 2,
    status: "succeeded",
    suppressed: 0,
  });
  assert.match(response.headers.get("cache-control") ?? "", /no-store/iu);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("missing sender configuration fails before reading queued submissions", async (t) => {
  const database = createReplayDatabase();
  t.after(() => database.close());
  setRuntime(database, false);
  let calls = 0;
  drain = async () => {
    calls += 1;
    return emptyResult();
  };
  const requestId = crypto.randomUUID();
  const response = await route.POST(await signedRequest({ requestId }));
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});

test("provider deferral is reported after retaining the queue", async (t) => {
  const database = createReplayDatabase();
  t.after(() => database.close());
  setRuntime(database, true);
  drain = async () => ({
    ...emptyResult(),
    attempted: 1,
    retried: 1,
  });
  const requestId = crypto.randomUUID();
  const response = await route.POST(await signedRequest({ requestId }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    attempted: 1,
    blocked: 0,
    requestId,
    retried: 1,
    sent: 0,
    status: "failed",
    suppressed: 0,
  });
});

test("a full delivery slice requests a fresh signed continuation", async (t) => {
  const database = createReplayDatabase();
  t.after(() => database.close());
  setRuntime(database, true);
  drain = async () => ({
    ...emptyResult(),
    attempted: 6,
    hasMoreDue: true,
    sent: 6,
  });
  const requestId = crypto.randomUUID();
  const response = await route.POST(await signedRequest({ requestId }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    attempted: 6,
    blocked: 0,
    requestId,
    retried: 0,
    sent: 6,
    status: "continue",
    suppressed: 0,
  });
});

test("an exact final six-row slice succeeds without an empty probe", async (t) => {
  const database = createReplayDatabase();
  t.after(() => database.close());
  setRuntime(database, true);
  drain = async () => ({
    ...emptyResult(),
    attempted: 6,
    sent: 6,
  });
  const requestId = crypto.randomUUID();
  const response = await route.POST(await signedRequest({ requestId }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    attempted: 6,
    blocked: 0,
    requestId,
    retried: 0,
    sent: 6,
    status: "succeeded",
    suppressed: 0,
  });
});

test("authorization and the exact empty JSON body are required", async (t) => {
  const database = createReplayDatabase();
  t.after(() => database.close());
  setRuntime(database, true);
  let calls = 0;
  drain = async () => {
    calls += 1;
    return emptyResult();
  };
  const unsigned = await route.POST(
    new Request(`${ORIGIN}${PATHNAME}`, {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(unsigned.status, 403);
  const invalidBody = await route.POST(
    await signedRequest({
      body: '{"limit":99}',
      requestId: crypto.randomUUID(),
    }),
  );
  assert.equal(invalidBody.status, 400);
  assert.equal(calls, 0);
});

test("the form-email maintenance source has no visitor or organizer authorization path", () => {
  const source = readFileSync(
    new URL(
      "../../app/api/maintenance/forms/email/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /authenticateMaintenanceRequest/u);
  assert.match(source, /DAILY_MEETUP_REFRESH_SECRET/u);
  assert.doesNotMatch(
    source,
    /getChatGPTUser|requireOrganizerApiActor|cookie/iu,
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

function setRuntime(database, configured) {
  for (const key of Object.keys(ROUTE_ENVIRONMENT)) {
    delete ROUTE_ENVIRONMENT[key];
  }
  ROUTE_ENVIRONMENT.DB = database;
  ROUTE_ENVIRONMENT.DAILY_MEETUP_REFRESH_SECRET = SECRET;
  configuration = configured
    ? {
        apiKey: "synthetic-route-key",
        fromEmail: "sender@example.invalid",
        toEmail: "inbox@example.invalid",
      }
    : null;
}

function emptyResult() {
  return {
    attempted: 0,
    blocked: 0,
    configurationMissing: 0,
    hasMoreDue: false,
    retried: 0,
    sent: 0,
    suppressed: 0,
  };
}

async function signedRequest({ body = "{}", requestId }) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = await hmacHex(
    SECRET,
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
