import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import test from "node:test";

const DATABASE = Object.freeze({ kind: "route-test-database" });
const MEMBERSHIP = Object.freeze({
  organizationId: "org_vcc",
  role: "owner",
});
let actorRequest = async () => ({
  database: DATABASE,
  identity: Object.freeze({ email: "owner@example.com" }),
  membership: MEMBERSHIP,
});
let materialize = async () => {
  throw new Error("The route test did not install a materializer.");
};

globalThis.__VCC_ORGANIZER_MATERIALIZATION_ACTOR__ = (...args) =>
  actorRequest(...args);
globalThis.__VCC_ORGANIZER_MATERIALIZATION_RUN__ = (...args) =>
  materialize(...args);

nodeModule.registerHooks?.({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/app/api/organizer/meetup/_shared") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export async function requireMeetupApiActor(...args) { return globalThis.__VCC_ORGANIZER_MATERIALIZATION_ACTOR__(...args); }",
        ),
      };
    }
    if (specifier === "@/lib/server/public/event-materializations") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export async function refreshPublicEventMaterializations(...args) { return globalThis.__VCC_ORGANIZER_MATERIALIZATION_RUN__(...args); }",
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
  "../../app/api/organizer/meetup/materialize/route.ts?organizer-materialization-route"
);

test("organizer materialization is POST-only, same-origin, Owner/Admin-only, and counts-only", async () => {
  assert.equal(typeof route.POST, "function");
  assert.equal(route.GET, undefined);
  assert.equal(route.PUT, undefined);
  assert.equal(route.PATCH, undefined);

  let receivedRoles = null;
  actorRequest = async (roles) => {
    receivedRoles = roles;
    return {
      database: DATABASE,
      identity: Object.freeze({ email: "owner@example.com" }),
      membership: MEMBERSHIP,
    };
  };
  let received = null;
  materialize = async (database, input) => {
    received = { database, input };
    return {
      eventsSnapshotCount: 1,
      homeEventCount: 6,
      privateProjectionId: "PRIVATE_EVENT_ID_SENTINEL",
    };
  };

  const response = await route.POST(request());

  assert.equal(response.status, 200);
  assert.deepEqual(receivedRoles, ["owner", "administrator"]);
  assert.equal(received.database, DATABASE);
  assert.equal(received.input.organizationId, "org_vcc");
  assert.ok(Number.isSafeInteger(received.input.nowUtcMs));
  assert.match(response.headers.get("cache-control") ?? "", /no-store/iu);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), {
    counts: {
      eventsSnapshotCount: 1,
      homeEventCount: 6,
    },
  });
});

test("cross-site and unauthorized requests never materialize", async (t) => {
  await t.test("cross-site origin is rejected before authorization", async () => {
    let actorCalls = 0;
    let materializationCalls = 0;
    actorRequest = async () => {
      actorCalls += 1;
      return { database: DATABASE, membership: MEMBERSHIP };
    };
    materialize = async () => {
      materializationCalls += 1;
      return { eventsSnapshotCount: 1, homeEventCount: 6 };
    };

    const response = await route.POST(
      request({ origin: "https://attacker.example" }),
    );
    assert.equal(response.status, 400);
    assert.equal(actorCalls, 0);
    assert.equal(materializationCalls, 0);
  });

  await t.test("failed role authorization is private and read-only", async () => {
    let materializationCalls = 0;
    actorRequest = async () => {
      throw new Error("PRIVATE_AUTHORIZATION_SENTINEL");
    };
    materialize = async () => {
      materializationCalls += 1;
      return { eventsSnapshotCount: 1, homeEventCount: 6 };
    };

    const response = await route.POST(request());
    assert.equal(response.status, 500);
    assert.equal(materializationCalls, 0);
    assert.doesNotMatch(
      JSON.stringify(await response.json()),
      /PRIVATE_AUTHORIZATION_SENTINEL/u,
    );
  });
});

test("the materialization request body must be the empty JSON object", async () => {
  let materializationCalls = 0;
  actorRequest = async () => ({
    database: DATABASE,
    membership: MEMBERSHIP,
  });
  materialize = async () => {
    materializationCalls += 1;
    return { eventsSnapshotCount: 1, homeEventCount: 6 };
  };

  for (const body of ["", "[]", '{"organizationId":"forged"}']) {
    const response = await route.POST(request({ body }));
    assert.ok(
      response.status === 400 || response.status === 422,
      `unexpected validation status ${response.status}`,
    );
  }
  assert.equal(materializationCalls, 0);
});

function request({ body = "{}", origin = "https://club.example" } = {}) {
  return new Request(
    "https://club.example/api/organizer/meetup/materialize",
    {
      body,
      headers: {
        "content-type": "application/json",
        origin,
      },
      method: "POST",
    },
  );
}

function dataModule(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}
