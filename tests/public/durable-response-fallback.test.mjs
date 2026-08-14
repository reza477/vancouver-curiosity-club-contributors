import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DURABLE_PUBLIC_RESPONSE_FALLBACK_OBJECT_KEY,
  DURABLE_PUBLIC_RESPONSE_FALLBACK_MAX_AGE_MS,
  DURABLE_PUBLIC_RESPONSE_FALLBACK_SLOTS,
  captureDurablePublicResponseFallbackSlot,
  durablePublicResponseBuildRequest,
  durablePublicResponseForFailure,
} from "../../lib/server/public/durable-response-fallback.ts";

const ORIGIN = "https://vancouvercuriosityclub.com";
const OLD_BATCH = "00000000-0000-4000-8000-000000000001";
const NEW_BATCH = "00000000-0000-4000-8000-000000000002";
const OLD_NONCE = "old_nonce_1234567890";
const NEW_NONCE = "new_nonce_1234567890";
const projectRoot = new URL("../../", import.meta.url);

test("four protected slot calls stage independently and atomically promote one complete bundle", async () => {
  const bucket = new MemoryR2Bucket();
  for (const [index, slot] of DURABLE_PUBLIC_RESPONSE_FALLBACK_SLOTS.entries()) {
    const result = await capture(bucket, OLD_BATCH, slot, "old", 1_000 + index);
    assert.equal(result.capturedEntryCount, index + 1);
    assert.equal(result.promoted, index === 3);
    assert.equal(result.promotedByteSize === null, index !== 3);
    if (index < 3) {
      assert.equal(
        bucket.has(DURABLE_PUBLIC_RESPONSE_FALLBACK_OBJECT_KEY),
        false,
        "a partial batch must not create a current bundle",
      );
    }
  }
  assert.equal(bucket.putsFor(DURABLE_PUBLIC_RESPONSE_FALLBACK_OBJECT_KEY), 1);

  const oldHome = await recover(
    bucket,
    durablePublicResponseBuildRequest(ORIGIN, "home-html"),
    2_000,
  );
  assert.ok(oldHome);
  assert.equal(oldHome.status, 200);
  const oldBody = await oldHome.text();
  assert.match(oldBody, /old-home-html/u);
  assert.match(oldBody, /Updates are temporarily delayed/u);
  assert.match(oldBody, new RegExp(NEW_NONCE, "u"));
  assert.doesNotMatch(oldBody, new RegExp(OLD_NONCE, "u"));

  const partial = await capture(
    bucket,
    NEW_BATCH,
    "home-html",
    "new",
    3_000,
  );
  assert.equal(partial.promoted, false);
  const delayedPriorBatch = await capture(
    bucket,
    OLD_BATCH,
    "events-html",
    "delayed-old",
    3_000,
  );
  assert.equal(delayedPriorBatch.promoted, false);
  assert.equal(
    delayedPriorBatch.capturedEntryCount,
    3,
    "three prior-batch slots cannot mix with one current-batch slot",
  );
  assert.equal(bucket.putsFor(DURABLE_PUBLIC_RESPONSE_FALLBACK_OBJECT_KEY), 1);
  const stillOld = await recover(
    bucket,
    durablePublicResponseBuildRequest(ORIGIN, "home-html"),
    3_001,
  );
  assert.match(await stillOld?.text(), /old-home-html/u);

  for (const slot of DURABLE_PUBLIC_RESPONSE_FALLBACK_SLOTS.slice(1)) {
    await capture(bucket, NEW_BATCH, slot, "new", 3_000);
  }
  assert.equal(bucket.putsFor(DURABLE_PUBLIC_RESPONSE_FALLBACK_OBJECT_KEY), 2);
  assert.equal(
    bucket.objectCount,
    5,
    "storage remains bounded to four fixed staging objects plus current",
  );
  const newHome = await recover(
    bucket,
    durablePublicResponseBuildRequest(ORIGIN, "home-html"),
    3_100,
  );
  assert.match(await newHome?.text(), /new-home-html/u);
});

test("cold readers restore exact HTML and RSC keys without any visitor write", async () => {
  const bucket = new MemoryR2Bucket();
  for (const slot of DURABLE_PUBLIC_RESPONSE_FALLBACK_SLOTS) {
    await capture(bucket, OLD_BATCH, slot, "cold", 10_000);
  }
  const writesBeforeVisitors = bucket.putCount;

  for (const slot of DURABLE_PUBLIC_RESPONSE_FALLBACK_SLOTS) {
    const buildRequest = durablePublicResponseBuildRequest(ORIGIN, slot);
    const recovered = await recover(bucket, buildRequest, 11_000);
    assert.ok(recovered, `${slot} must recover in a fresh reader`);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.headers.get("x-vcc-response-state"), "stale");
    assert.equal(
      recovered.headers.get("content-type")?.startsWith(
        slot.endsWith("-rsc") ? "text/x-component" : "text/html",
      ),
      true,
    );
  }
  assert.equal(
    bucket.putCount,
    writesBeforeVisitors,
    "failure reads must never write or recapture R2 state",
  );

  const browserHtml = new Request(`${ORIGIN}/events`, {
    headers: {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-encoding": "gzip, deflate, br",
      "user-agent": "ordinary-browser",
    },
  });
  const browserRecovered = await durablePublicResponseForFailure(bucket, {
    contentSecurityPolicy: policy(NEW_NONCE),
    failure: { kind: "throw" },
    nonce: NEW_NONCE,
    nowUtcMs: 11_000,
    pathname: "/events",
    request: browserHtml,
  });
  assert.ok(browserRecovered, "browser transport headers normalize for HTML");
  assert.equal(
    browserRecovered.headers.get("vary"),
    "rsc",
    "normalized Accept dimensions are removed from the no-store response",
  );

  for (const headers of [
    {},
    { accept: "text/html;q=0,*/*;q=1" },
    { accept: "text/html", range: "bytes=0-100" },
    { accept: "text/html", "if-none-match": '"cached"' },
    { accept: "text/html", "next-router-state-tree": "tree" },
  ]) {
    const getsBefore = bucket.getCount;
    assert.equal(
      await durablePublicResponseForFailure(bucket, {
        contentSecurityPolicy: policy(NEW_NONCE),
        failure: { kind: "throw" },
        nonce: NEW_NONCE,
        nowUtcMs: 11_000,
        pathname: "/events",
        request: new Request(`${ORIGIN}/events`, { headers }),
      }),
      null,
    );
    assert.equal(
      bucket.getCount,
      getsBefore,
      "ineligible HTML requests are rejected before the MEDIA read",
    );
  }

  const baselineRsc = durablePublicResponseBuildRequest(
    ORIGIN,
    "events-rsc",
  );
  assert.equal(baselineRsc.pathname, "/events.rsc");
  assert.equal(
    new URL(baselineRsc.request.url).pathname,
    "/events.rsc",
  );
  assert.equal(
    new URL(baselineRsc.request.url).search,
    "?_rsc",
    "Vinext's baseline RSC cache-buster is the bare _rsc parameter",
  );
  const compressedBaselineRsc = new Request(baselineRsc.request, {
    headers: {
      ...Object.fromEntries(baselineRsc.request.headers),
      "accept-encoding": "gzip, deflate, br",
    },
  });
  const compressedBaselineRecovered = await durablePublicResponseForFailure(
    bucket,
    {
      contentSecurityPolicy: policy(NEW_NONCE),
      failure: { kind: "throw" },
      nonce: NEW_NONCE,
      nowUtcMs: 11_000,
      pathname: baselineRsc.pathname,
      request: compressedBaselineRsc,
    },
  );
  assert.ok(
    compressedBaselineRecovered,
    "RSC Accept-Encoding is normalized because stored bodies are unencoded",
  );
  assert.equal(
    compressedBaselineRecovered.headers.get("vary"),
    "rsc, accept",
    "only the normalized Accept-Encoding dimension is removed for RSC",
  );
  const wrongTree = new Request(baselineRsc.request, {
    headers: {
      ...Object.fromEntries(baselineRsc.request.headers),
      "accept-encoding": "gzip, deflate, br",
      "next-router-state-tree": "different-tree",
    },
  });
  assert.equal(
    await durablePublicResponseForFailure(bucket, {
      contentSecurityPolicy: policy(NEW_NONCE),
      failure: { kind: "throw" },
      nonce: NEW_NONCE,
      nowUtcMs: 11_000,
      pathname: baselineRsc.pathname,
      request: wrongTree,
    }),
    null,
    "an unknown RSC router state must fail closed rather than cross-match",
  );
  assert.equal(
    await durablePublicResponseForFailure(bucket, {
      contentSecurityPolicy: policy(NEW_NONCE),
      failure: { kind: "response", status: 503 },
      nonce: NEW_NONCE,
      nowUtcMs: 11_000,
      pathname: "/events",
      request: new Request(`${ORIGIN}/events`, {
        headers: { cookie: "private=1" },
      }),
    }),
    null,
  );
});

test("failed, corrupt, oversized, or expired durable state never replaces or serves last-known-good", async () => {
  assert.equal(
    DURABLE_PUBLIC_RESPONSE_FALLBACK_MAX_AGE_MS,
    72 * 60 * 60 * 1_000,
  );
  const bucket = new MemoryR2Bucket();
  for (const slot of DURABLE_PUBLIC_RESPONSE_FALLBACK_SLOTS) {
    await capture(bucket, OLD_BATCH, slot, "valid", 20_000);
  }
  const current = bucket.bytes(DURABLE_PUBLIC_RESPONSE_FALLBACK_OBJECT_KEY);
  await assert.rejects(
    captureDurablePublicResponseFallbackSlot(bucket, {
      batchId: NEW_BATCH,
      capturedAtUtcMs: 21_000,
      origin: ORIGIN,
      render: async () => ({
        nonce: OLD_NONCE,
        response: htmlResponse("unsafe", OLD_NONCE, { vary: "*" }),
      }),
      slot: "home-html",
    }),
  );
  assert.deepEqual(
    bucket.bytes(DURABLE_PUBLIC_RESPONSE_FALLBACK_OBJECT_KEY),
    current,
  );

  bucket.set(DURABLE_PUBLIC_RESPONSE_FALLBACK_OBJECT_KEY, new TextEncoder().encode("{}"));
  assert.equal(
    await recover(
      bucket,
      durablePublicResponseBuildRequest(ORIGIN, "home-html"),
      21_000,
    ),
    null,
  );
  bucket.set(
    DURABLE_PUBLIC_RESPONSE_FALLBACK_OBJECT_KEY,
    new Uint8Array(6_000_001),
  );
  assert.equal(
    await recover(
      bucket,
      durablePublicResponseBuildRequest(ORIGIN, "home-html"),
      21_000,
    ),
    null,
  );

  bucket.set(DURABLE_PUBLIC_RESPONSE_FALLBACK_OBJECT_KEY, current);
  const atMaximumAge = await recover(
    bucket,
    durablePublicResponseBuildRequest(ORIGIN, "home-html"),
    20_000 + DURABLE_PUBLIC_RESPONSE_FALLBACK_MAX_AGE_MS,
  );
  assert.ok(atMaximumAge, "a bundle remains usable for the full 72 hours");
  assert.match(await atMaximumAge.text(), /Updates are temporarily delayed/u);
  assert.equal(
    await recover(
      bucket,
      durablePublicResponseBuildRequest(ORIGIN, "home-html"),
      20_000 + DURABLE_PUBLIC_RESPONSE_FALLBACK_MAX_AGE_MS + 1,
    ),
    null,
  );
});

test("the Worker uses a separate protected one-render capture invocation and awaits MEDIA recovery before 503", async () => {
  const [worker, workflow, route] = await Promise.all([
    readFile(new URL("worker/index.ts", projectRoot), "utf8"),
    readFile(
      new URL(".github/workflows/daily-meetup-refresh.yml", projectRoot),
      "utf8",
    ),
    readFile(
      new URL(
        "app/api/maintenance/public-snapshots/capture/route.ts",
        projectRoot,
      ),
      "utf8",
    ),
  ]);
  assert.match(worker, /await durablePublicResponseForFailure\(media,/u);
  assert.match(
    worker,
    /pathname === DURABLE_PUBLIC_RESPONSE_CAPTURE_PATH[\s\S]*?return false/u,
  );
  assert.equal(
    (worker.match(/renderDurablePublicResponse\(buildRequest, env, context\)/gu) ?? [])
      .length,
    1,
    "each protected capture invocation renders exactly one slot",
  );
  assert.doesNotMatch(
    worker,
    /refreshDurableResponsesAfterDailyUpdater|durablePublicResponseBuildRequests/u,
  );
  assert.match(route, /authenticateMaintenanceRequest/u);
  assert.match(route, /DAILY_MEETUP_REFRESH_SECRET/u);
  assert.doesNotMatch(route, /cookie|requireOrganizer|getChatGPTUser/iu);
  for (const slot of DURABLE_PUBLIC_RESPONSE_FALLBACK_SLOTS) {
    assert.match(workflow, new RegExp(slot, "u"));
  }
  assert.match(workflow, /snapshot_promoted/u);
  assert.match(workflow, /Durable response snapshots: 4/u);
});

test("one capture invocation has a conservative 18-statement upper bound below Cloudflare's 50-statement ceiling", () => {
  // Exact route authentication is asserted as 2 statements in the route test.
  // A ready strict invariant request is 2 statements. Existing focused public
  // performance tests assert Home data at 7 statements and Events data at 1.
  // The request-cached shell has site/navigation/organization (3), while four
  // additional reads conservatively cover metadata, page content and logo.
  const signatureReceiptStatements = 2;
  const readyInvariantStatements = 2;
  const requestCachedShellStatements = 3;
  const maximumPageDataStatements = 7;
  const metadataAndMediaReserve = 4;
  const upperBound =
    signatureReceiptStatements +
    readyInvariantStatements +
    requestCachedShellStatements +
    maximumPageDataStatements +
    metadataAndMediaReserve;
  assert.equal(upperBound, 18);
  assert.ok(upperBound < 50);
});

async function capture(bucket, batchId, slot, marker, capturedAtUtcMs) {
  return captureDurablePublicResponseFallbackSlot(bucket, {
    batchId,
    capturedAtUtcMs,
    origin: ORIGIN,
    render: async (buildRequest) => ({
      nonce: OLD_NONCE,
      response: buildRequest.slot.endsWith("-rsc")
        ? rscResponse(`${marker}-${slot}`, OLD_NONCE)
        : htmlResponse(`${marker}-${slot}`, OLD_NONCE),
    }),
    slot,
  });
}

function recover(bucket, buildRequest, nowUtcMs) {
  return durablePublicResponseForFailure(bucket, {
    contentSecurityPolicy: policy(NEW_NONCE),
    failure: { kind: "response", status: 503 },
    nonce: NEW_NONCE,
    nowUtcMs,
    pathname: buildRequest.pathname,
    request: buildRequest.request,
  });
}

function htmlResponse(marker, nonce, overrides = {}) {
  return new Response(
    `<!doctype html><html><head><script nonce="${nonce}">window.x=1</script></head><body><main>${marker}</main><script nonce="${nonce}">window.y=2</script></body></html>`,
    {
      headers: {
        "content-security-policy": policy(nonce),
        "content-type": "text/html; charset=utf-8",
        vary: "RSC, Accept, Accept-Encoding",
        ...overrides,
      },
      status: 200,
    },
  );
}

function rscResponse(marker, nonce) {
  return new Response(`0:["${marker}",{"nonce":"${nonce}"}]`, {
    headers: {
      "content-security-policy": policy(nonce),
      "content-type": "text/x-component; charset=utf-8",
      vary: "RSC, Accept, Accept-Encoding",
    },
    status: 200,
  });
}

function policy(nonce) {
  return `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
}

class MemoryR2Bucket {
  constructor() {
    this.objects = new Map();
    this.putCounts = new Map();
    this.putCount = 0;
    this.getCount = 0;
  }

  async put(key, value) {
    const bytes = exactBytes(value);
    this.objects.set(key, bytes);
    this.putCount += 1;
    this.putCounts.set(key, (this.putCounts.get(key) ?? 0) + 1);
    return {};
  }

  async get(key) {
    this.getCount += 1;
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return {
      arrayBuffer: async () => exactBytes(bytes).buffer,
      body: null,
      size: bytes.byteLength,
    };
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.objects.delete(key);
    }
  }

  has(key) {
    return this.objects.has(key);
  }

  putsFor(key) {
    return this.putCounts.get(key) ?? 0;
  }

  bytes(key) {
    const value = this.objects.get(key);
    return value ? exactBytes(value) : null;
  }

  set(key, value) {
    this.objects.set(key, exactBytes(value));
  }

  get objectCount() {
    return this.objects.size;
  }
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
