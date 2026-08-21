import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import test from "node:test";
import {
  DURABLE_PUBLIC_RESPONSE_FALLBACK_SLOTS,
  captureDurablePublicResponseFallbackSlot,
  durablePublicResponseBuildRequest,
} from "../../lib/server/public/durable-response-fallback.ts";

const ORIGIN = "https://vancouvercuriosityclub.com";
const BATCH_ID = "00000000-0000-4000-8000-000000000001";
const CAPTURE_NONCE = "capture_nonce_1234567890";
const bucket = createMemoryR2Bucket();
let handlerCalls = 0;

for (const slot of DURABLE_PUBLIC_RESPONSE_FALLBACK_SLOTS) {
  await captureDurablePublicResponseFallbackSlot(bucket, {
    batchId: BATCH_ID,
    capturedAtUtcMs: Date.now(),
    origin: ORIGIN,
    render: async (buildRequest) => ({
      nonce: CAPTURE_NONCE,
      response: buildRequest.slot.endsWith("-rsc")
        ? rscResponse(slot, CAPTURE_NONCE)
        : htmlResponse(slot, CAPTURE_NONCE),
    }),
    slot,
  });
}
const writesAfterUpdater = bucket.putCount;

globalThis.__VCC_DURABLE_WORKER_HANDLER__ = {
  async fetch() {
    handlerCalls += 1;
    return new Response("unexpected", { status: 500 });
  },
};

nodeModule.registerHooks?.({
  resolve(specifier, context, nextResolve) {
    if (specifier === "vinext/server/app-router-entry") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export default globalThis.__VCC_DURABLE_WORKER_HANDLER__;",
        ),
      };
    }
    if (specifier === "vinext/server/image-optimization") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export const DEFAULT_DEVICE_SIZES=[]; export const DEFAULT_IMAGE_SIZES=[]; export async function handleImageOptimization(){ return new Response('unused'); }",
        ),
      };
    }
    if (specifier.endsWith("/lib/server/database/invariants")) {
      return {
        shortCircuit: true,
        url: dataModule(
          "export async function ensureDatabaseInvariants(){ throw new Error('forced_d1_outage'); } export async function ensureDatabaseInvariantsForRequest(){ throw new Error('forced_d1_outage'); }",
        ),
      };
    }
    if (specifier.endsWith("/lib/server/database/request-maintenance")) {
      return {
        shortCircuit: true,
        url: dataModule(
          "export async function runRequestMaintenance(){ throw new Error('must_not_run'); } export function shouldRunRequestMaintenance(){ return false; }",
        ),
      };
    }
    return nextResolve(specifier, context);
  },
});

const worker = (
  await import("../../worker/index.ts?forced-d1-durable-fallback")
).default;

test("a cold Worker returns durable Home and Events 200 responses when D1 invariants throw", async () => {
  const getCountBefore = bucket.getCount;
  for (const slot of ["home-html", "events-html", "home-rsc", "events-rsc"]) {
    const buildRequest = durablePublicResponseBuildRequest(ORIGIN, slot);
    const visitorRequest = slot.endsWith("-html")
      ? new Request(buildRequest.request.url, {
          headers: {
            accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-encoding": "gzip, deflate, br",
          },
        })
      : new Request(buildRequest.request, {
          headers: {
            ...Object.fromEntries(buildRequest.request.headers),
            "accept-encoding": "gzip, deflate, br",
          },
        });
    const response = await worker.fetch(
      visitorRequest,
      environment(),
      executionContext(),
    );
    assert.equal(response.status, 200, slot);
    assert.equal(response.headers.get("x-vcc-response-state"), "stale");
    assert.match(await response.text(), new RegExp(slot, "u"));
  }
  assert.equal(bucket.getCount - getCountBefore, 4);
  assert.equal(bucket.putCount, writesAfterUpdater);
  assert.equal(handlerCalls, 0);
});

test("the same forced D1 outage keeps private routes fail-closed without reading MEDIA", async () => {
  const getsBefore = bucket.getCount;
  const response = await worker.fetch(
    new Request(`${ORIGIN}/organizer`, {
      headers: { cookie: "owner=private" },
    }),
    environment(),
    executionContext(),
  );
  assert.equal(response.status, 503);
  assert.equal(bucket.getCount, getsBefore);
  assert.equal(response.headers.get("x-vcc-response-state"), null);
  assert.equal(handlerCalls, 0);
});

function environment() {
  return {
    ASSETS: { fetch: () => new Response("unused") },
    DB: {},
    IMAGES: {},
    MEDIA: bucket,
    PUBLIC_SITE_URL: ORIGIN,
  };
}

function executionContext() {
  return {
    passThroughOnException() {},
    waitUntil() {},
  };
}

function htmlResponse(marker, nonce) {
  return new Response(
    `<!doctype html><html><head><script nonce="${nonce}">window.x=1</script></head><body><main>${marker}</main><script nonce="${nonce}">window.y=2</script></body></html>`,
    {
      headers: {
        "content-security-policy": policy(nonce),
        "content-type": "text/html; charset=utf-8",
      },
      status: 200,
    },
  );
}

function rscResponse(marker, nonce) {
  return new Response(`0:["${marker}",{"nonce":"${nonce}"}]\n`, {
    headers: {
      "content-security-policy": policy(nonce),
      "content-type": "text/x-component; charset=utf-8",
      vary: "RSC, Accept",
    },
    status: 200,
  });
}

function policy(nonce) {
  return `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
}

function createMemoryR2Bucket() {
  const objects = new Map();
  let putCount = 0;
  let getCount = 0;
  return {
    get getCount() {
      return getCount;
    },
    get putCount() {
      return putCount;
    },
    async put(key, value) {
      objects.set(key, exactBytes(value));
      putCount += 1;
      return {};
    },
    async get(key) {
      getCount += 1;
      const bytes = objects.get(key);
      if (!bytes) return null;
      return {
        arrayBuffer: async () => exactBytes(bytes).buffer,
        body: null,
        size: bytes.byteLength,
      };
    },
    async delete() {},
  };
}

function exactBytes(value) {
  const view = value instanceof Uint8Array
    ? value
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : new Uint8Array(value);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy;
}

function dataModule(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}
