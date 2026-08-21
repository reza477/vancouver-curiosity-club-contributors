import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import test from "node:test";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const ORIGIN = "https://vancouvercuriosityclub.com";
const PATHNAME = "/api/maintenance/meetup/refresh";
const SECRET = "route-maintenance-test-secret-that-is-long-enough";
const ROUTE_ENVIRONMENT = {};
let maintenanceRun = async () => {
  throw new Error("The maintenance route test did not install a runner.");
};
let emailDrain = async () => ({
  attempted: 0,
  blocked: 0,
  configurationMissing: 0,
  retried: 0,
  sent: 0,
  suppressed: 0,
});
let emailDrainArguments = [];

globalThis.__VCC_DAILY_MAINTENANCE_ROUTE_ENV__ = ROUTE_ENVIRONMENT;
globalThis.__VCC_DAILY_MAINTENANCE_RUN__ = (...args) =>
  maintenanceRun(...args);
globalThis.__VCC_FORM_EMAIL_DRAIN__ = (...args) => {
  emailDrainArguments = args;
  return emailDrain(...args);
};

nodeModule.registerHooks?.({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export const env = globalThis.__VCC_DAILY_MAINTENANCE_ROUTE_ENV__;",
        ),
      };
    }
    if (
      specifier ===
      "@/lib/server/maintenance/daily-meetup-refresh"
    ) {
      return {
        shortCircuit: true,
        url: dataModule(
          "export async function runDailyMeetupRefresh(...args) { return globalThis.__VCC_DAILY_MAINTENANCE_RUN__(...args); }",
        ),
      };
    }
    if (specifier === "@/lib/server/phase7/public-form-email") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export async function drainPublicFormEmailOutbox(...args) { return globalThis.__VCC_FORM_EMAIL_DRAIN__(...args); }",
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
  "../../app/api/maintenance/meetup/refresh/route.ts?daily-maintenance-route"
);

test("daily updater is POST-only and independent of cookies or owner identity", async (t) => {
  assert.equal(typeof route.POST, "function");
  assert.equal(route.GET, undefined);
  assert.equal(route.HEAD, undefined);
  assert.equal(route.PUT, undefined);

  const database = createReplayDatabase();
  t.after(() => database.close());
  setRuntime(database, SECRET);
  let received = null;
  maintenanceRun = async (receivedDatabase, options) => {
    received = { database: receivedDatabase, options };
    return {
      completedAt: "2033-05-18T03:33:21.000Z",
      counts: {
        cancelled: 0,
        created: 2,
        materializations: {
          eventDetailCount: 29,
          eventsSnapshotCount: 3,
          homeEventCount: 6,
          privateDetailKey: "PRIVATE_DETAIL_SENTINEL",
        },
        passes: 2,
        rejected: 0,
        removed: 1,
        updated: 3,
      },
      internalEventId: "PRIVATE_EVENT_ID_SENTINEL",
      outcome: "completed",
      startedAt: "2033-05-18T03:33:20.000Z",
      status: "succeeded",
    };
  };
  const requestId = crypto.randomUUID();
  const response = await route.POST(
    await signedRequest({
      requestId,
      secret: SECRET,
      // A valid maintenance request needs no ChatGPT identity and no cookie.
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(emailDrainArguments[1]?.limit, 1);
  assert.equal(received.database, database);
  assert.equal(received.options.requestId, requestId);
  assert.ok(Number.isSafeInteger(received.options.nowUtcMs));
  assert.equal(response.headers.get("set-cookie"), null);
  assert.match(
    response.headers.get("cache-control") ?? "",
    /(?:private,\s*)?no-store/iu,
  );
  const body = await response.json();
  assert.equal(body.status, "succeeded");
  assert.equal(body.outcome, "completed");
  assert.deepEqual(body.counts, {
    cancelled: 0,
    created: 2,
    materializations: {
      eventDetailCount: 29,
      eventsSnapshotCount: 3,
      homeEventCount: 6,
    },
    passes: 2,
    rejected: 0,
    removed: 1,
    updated: 3,
  });
  assert.ok(
    Object.keys(body).every((key) =>
      [
        "completedAt",
        "counts",
        "outcome",
        "requestId",
        "startedAt",
        "status",
      ].includes(key),
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(body),
    /PRIVATE_(?:DETAIL|EVENT_ID)_SENTINEL/u,
  );
});

test("cookies and forged organizer headers cannot replace the maintenance signature", async (t) => {
  const database = createReplayDatabase();
  t.after(() => database.close());
  setRuntime(database, SECRET);
  let calls = 0;
  maintenanceRun = async () => {
    calls += 1;
    return successResult();
  };
  const request = new Request(`${ORIGIN}${PATHNAME}`, {
    body: "{}",
    headers: {
      cookie: "__Host-vcc-owner=forged",
      "oai-authenticated-user-email": "owner@example.com",
      "oai-authenticated-user-full-name": "Owner",
      "x-maintenance-request-id": crypto.randomUUID(),
      "x-maintenance-signature": `sha256=${"0".repeat(64)}`,
      "x-maintenance-timestamp": String(Math.floor(Date.now() / 1_000)),
    },
    method: "POST",
  });

  const response = await route.POST(request);
  assert.ok(response.status === 401 || response.status === 403);
  assert.equal(calls, 0);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("a replay is rejected before the updater can run twice", async (t) => {
  const database = createReplayDatabase();
  t.after(() => database.close());
  setRuntime(database, SECRET);
  let calls = 0;
  maintenanceRun = async () => {
    calls += 1;
    return successResult();
  };
  const requestId = crypto.randomUUID();
  const makeRequest = () => signedRequest({ requestId, secret: SECRET });

  assert.equal((await route.POST(await makeRequest())).status, 200);
  const replay = await route.POST(await makeRequest());
  assert.equal(replay.status, 409);
  assert.equal(calls, 1);
});

test("a nonterminal pass reports progress rather than completion", async (t) => {
  const database = createReplayDatabase();
  t.after(() => database.close());
  setRuntime(database, SECRET);
  maintenanceRun = async () => ({
    completedAt: new Date().toISOString(),
    counts: {
      cancelled: 0,
      created: 1,
      materializations: null,
      passes: 1,
      rejected: 0,
      removed: 0,
      updated: 0,
    },
    outcome: "partial",
    startedAt: new Date().toISOString(),
    status: "continue",
  });
  const messages = [];
  const originalInfo = console.info;
  console.info = (message) => messages.push(String(message));
  t.after(() => {
    console.info = originalInfo;
  });

  const response = await route.POST(
    await signedRequest({
      requestId: crypto.randomUUID(),
      secret: SECRET,
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "continue");
  assert.ok(
    messages.some((message) =>
      message.includes("daily_meetup_refresh_progressed"),
    ),
  );
  assert.ok(
    messages.every(
      (message) => !message.includes("daily_meetup_refresh_completed"),
    ),
  );
});

test("only the exact two-byte empty JSON object reaches maintenance", async (t) => {
  const database = createReplayDatabase();
  t.after(() => database.close());
  setRuntime(database, SECRET);
  let calls = 0;
  maintenanceRun = async () => {
    calls += 1;
    return successResult();
  };
  for (const body of [
    '{"organizationId":"forged"}',
    " { }",
    "{}\n",
  ]) {
    const response = await route.POST(
      await signedRequest({
        body,
        requestId: crypto.randomUUID(),
        secret: SECRET,
      }),
    );
    assert.ok(response.status >= 400 && response.status < 500);
  }
  assert.equal(calls, 0);
});

test("the secret is required from runtime configuration and is never accepted in the body", async (t) => {
  const database = createReplayDatabase();
  t.after(() => database.close());
  setRuntime(database, undefined);
  let calls = 0;
  maintenanceRun = async () => {
    calls += 1;
    return successResult();
  };
  const response = await route.POST(
    await signedRequest({
      body: JSON.stringify({ secret: SECRET }),
      requestId: crypto.randomUUID(),
      secret: SECRET,
    }),
  );
  assert.ok(response.status >= 500);
  assert.equal(calls, 0);
  assert.doesNotMatch(await response.text(), new RegExp(SECRET, "u"));
});

test("maintenance failures produce a safe failed report and never leak internals", async (t) => {
  const database = createReplayDatabase();
  t.after(() => database.close());
  setRuntime(database, SECRET);
  maintenanceRun = async () => {
    throw new Error("PRIVATE_UPDATER_FAILURE_SENTINEL");
  };
  const response = await route.POST(
    await signedRequest({
      requestId: crypto.randomUUID(),
      secret: SECRET,
    }),
  );
  assert.ok(response.status >= 500);
  const serialized = await response.text();
  assert.doesNotMatch(serialized, /PRIVATE_UPDATER_FAILURE_SENTINEL/u);
  assert.doesNotMatch(serialized, new RegExp(SECRET, "u"));
  assert.equal(response.headers.get("set-cookie"), null);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/iu);
});

test("the route source has no cookie or organizer-identity authentication path", () => {
  const source = readFileSync(
    new URL(
      "../../app/api/maintenance/meetup/refresh/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /DAILY_MEETUP_REFRESH_SECRET/u);
  assert.match(source, /authenticateMaintenanceRequest/u);
  assert.match(source, /daily_meetup_refresh_progressed/u);
  assert.match(source, /daily_meetup_refresh_completed/u);
  assert.doesNotMatch(
    source,
    /getChatGPTUser|requireOrganizerApiActor|requireMeetupApiActor|cookie/iu,
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

function setRuntime(database, secret) {
  for (const key of Object.keys(ROUTE_ENVIRONMENT)) {
    delete ROUTE_ENVIRONMENT[key];
  }
  ROUTE_ENVIRONMENT.DB = database;
  if (secret !== undefined) {
    ROUTE_ENVIRONMENT.DAILY_MEETUP_REFRESH_SECRET = secret;
  }
}

function successResult() {
  return {
    completedAt: new Date().toISOString(),
    counts: {
      cancelled: 0,
      created: 0,
      materializations: {
        eventDetailCount: 29,
        eventsSnapshotCount: 3,
        homeEventCount: 6,
      },
      passes: 1,
      rejected: 0,
      removed: 0,
      updated: 0,
    },
    outcome: "not_modified",
    startedAt: new Date().toISOString(),
    status: "succeeded",
  };
}

async function signedRequest({
  body = "{}",
  requestId,
  secret,
}) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = await hmacHex(
    secret,
    `${timestamp}.${requestId}.${body}`,
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
