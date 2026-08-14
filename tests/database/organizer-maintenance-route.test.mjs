import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import test from "node:test";

const DATABASE = Object.freeze({ kind: "maintenance-route-database" });
let actorRequest = async () => ({ database: DATABASE });
let maintenanceRequest = async () => ({ kind: "continue" });

globalThis.__VCC_MAINTENANCE_ROUTE_ACTOR__ = (...args) =>
  actorRequest(...args);
globalThis.__VCC_MAINTENANCE_ROUTE_RUN__ = (...args) =>
  maintenanceRequest(...args);

nodeModule.registerHooks?.({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/app/api/organizer/_shared") {
      return {
        shortCircuit: true,
        url: dataModule(`
          export async function requireOrganizerApiActor(...args) {
            return globalThis.__VCC_MAINTENANCE_ROUTE_ACTOR__(...args);
          }
          export function privateOrganizerJson(value) {
            return new Response(JSON.stringify(value), {
              headers: { "cache-control": "no-store", "content-type": "application/json" },
            });
          }
          export function organizerApiError() {
            return new Response(JSON.stringify({ error: { code: "request_failed" } }), {
              status: 400,
              headers: { "cache-control": "no-store", "content-type": "application/json" },
            });
          }
        `),
      };
    }
    if (specifier === "@/lib/server/database/request-maintenance") {
      return {
        shortCircuit: true,
        url: dataModule(`
          export async function runRequestMaintenance(...args) {
            return globalThis.__VCC_MAINTENANCE_ROUTE_RUN__(...args);
          }
        `),
      };
    }
    if (specifier === "server-only") {
      return { shortCircuit: true, url: dataModule("export {};") };
    }
    return nextResolve(specifier, context);
  },
});

const route = await import(
  "../../app/api/organizer/maintenance/reconcile/route.ts?organizer-maintenance-route"
);

test("Owner and Admin can force one bounded maintenance target", async () => {
  assert.equal(typeof route.POST, "function");
  assert.equal(route.GET, undefined);
  let receivedRoles = null;
  let received = null;
  actorRequest = async (roles) => {
    receivedRoles = roles;
    return { database: DATABASE };
  };
  maintenanceRequest = async (database, request) => {
    received = { database, request };
    return { kind: "redirect", source: "publication" };
  };

  const response = await route.POST(request({ pathname: "/events" }));
  assert.equal(response.status, 200);
  assert.deepEqual(receivedRoles, ["owner", "administrator"]);
  assert.deepEqual(received, {
    database: DATABASE,
    request: { method: "GET", pathname: "/events" },
  });
  assert.match(response.headers.get("cache-control") ?? "", /no-store/iu);
  assert.deepEqual(await response.json(), {
    result: { kind: "redirect", source: "publication" },
  });
});

test("maintenance target input is exact, bounded, and same-origin", async () => {
  let actorCalls = 0;
  let maintenanceCalls = 0;
  actorRequest = async () => {
    actorCalls += 1;
    return { database: DATABASE };
  };
  maintenanceRequest = async () => {
    maintenanceCalls += 1;
    return { kind: "continue" };
  };

  for (const body of [
    {},
    { pathname: "/organizer" },
    { pathname: "/events", organizationId: "forged" },
  ]) {
    const response = await route.POST(request(body));
    assert.equal(response.status, 400);
  }
  const crossSite = await route.POST(
    request(
      { pathname: "/events" },
      "https://attacker.example",
    ),
  );
  assert.equal(crossSite.status, 400);
  assert.equal(actorCalls, 3);
  assert.equal(maintenanceCalls, 0);
});

function request(
  value,
  origin = "https://club.example",
) {
  return new Request(
    "https://club.example/api/organizer/maintenance/reconcile",
    {
      body: JSON.stringify(value),
      headers: { "content-type": "application/json", origin },
      method: "POST",
    },
  );
}

function dataModule(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}
