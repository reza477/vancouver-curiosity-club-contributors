import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PUBLIC_RESPONSE_FALLBACK_NONCE_PLACEHOLDER,
  PUBLIC_RESPONSE_FALLBACK_STATE_HEADER,
  createPublicResponseFallback,
  publicResponseFallbackKey,
} from "../../lib/server/public/warm-response-fallback.ts";

const projectRoot = new URL("../../", import.meta.url);
const OLD_NONCE = "old_nonce_1234567890";
const NEW_NONCE = "new_nonce_1234567890";

test("only exact unauthenticated Home and Events GET representations receive keys", () => {
  assert.ok(publicResponseFallbackKey(request("/"), "/"));
  assert.ok(publicResponseFallbackKey(request("/events"), "/events"));
  const first = publicResponseFallbackKey(
    request("/events?lane=think&month=2026-08"),
    "/events",
  );
  const reordered = publicResponseFallbackKey(
    request("/events?month=2026-08&lane=think"),
    "/events",
  );
  assert.equal(first, reordered);
  assert.ok(
    publicResponseFallbackKey(
      request(
        "/events?view=upcoming&lane=think&club=vancouver-literature-and-film&page=2",
      ),
      "/events",
    ),
    "the durable Upcoming view and its bounded filters remain eligible",
  );
  assert.ok(
    publicResponseFallbackKey(
      request(
        "/events?view=calendar&month=2026-09&lane=explore&club=vancouver-fantasy-and-sci-fi",
      ),
      "/events",
    ),
    "the durable Calendar view and its bounded filters remain eligible",
  );

  const rscHeaders = {
    accept: "text/x-component",
    "next-router-prefetch": "1",
    "next-router-state-tree": "tree-a",
    rsc: "1",
    "x-vinext-mounted-slots": "slot:/parallel",
  };
  const firstRsc = publicResponseFallbackKey(
    request("/events?_rsc=first", { headers: rscHeaders }),
    "/events",
  );
  const nextRsc = publicResponseFallbackKey(
    request("/events?_rsc=second", { headers: rscHeaders }),
    "/events",
  );
  assert.equal(firstRsc, nextRsc, "the RSC transport nonce is not content");
  assert.notEqual(
    firstRsc,
    publicResponseFallbackKey(
      request("/events?_rsc=third", {
        headers: { ...rscHeaders, "next-router-state-tree": "tree-b" },
      }),
      "/events",
    ),
  );
  assert.ok(
    publicResponseFallbackKey(
      request("/events.rsc?_rsc", {
        headers: { accept: "text/x-component", rsc: "1" },
      }),
      "/events.rsc",
    ),
    "Vinext .rsc paths with an empty transport hash remain eligible",
  );

  for (const [target, pathname, options] of [
    ["/", "/", { method: "HEAD" }],
    ["/events", "/events", { method: "POST" }],
    ["/calendar", "/calendar", {}],
    ["/events/example", "/events/example", {}],
    ["/?campaign=private", "/", {}],
    ["/events?state=past", "/events", {}],
    ["/events?month=2026-13", "/events", {}],
    ["/events?lane=unknown", "/events", {}],
    ["/events?lane=think&lane=explore", "/events", {}],
    ["/events?view=agenda", "/events", {}],
    ["/events?club=Not%20A%20Slug", "/events", {}],
    ["/events?page=0", "/events", {}],
    ["/events?page=100000", "/events", {}],
  ]) {
    assert.equal(publicResponseFallbackKey(request(target, options), pathname), null);
  }

  for (const headers of [
    { authorization: "Bearer private" },
    { cookie: "session=private" },
    { "proxy-authorization": "Basic private" },
    { "oai-authenticated-user-email": "owner@example.com" },
    { "oai-authenticated-user-full-name": "Owner" },
  ]) {
    assert.equal(
      publicResponseFallbackKey(request("/events", { headers }), "/events"),
      null,
    );
  }
});

test("a successful HTML capture leaves the healthy response untouched and rehydrates one fresh nonce", async () => {
  let nowUtcMs = 1_000;
  const fallback = createPublicResponseFallback({
    captureIntervalMs: 100,
    clock: () => nowUtcMs,
  });
  const source = htmlResponse("healthy", OLD_NONCE);
  const capture = fallback.scheduleCapture({
    nonce: OLD_NONCE,
    pathname: "/events",
    request: request("/events"),
    response: source,
  });
  assert.ok(capture);
  assert.equal(await capture, true);

  assert.equal(source.status, 200);
  assert.equal(source.headers.get(PUBLIC_RESPONSE_FALLBACK_STATE_HEADER), null);
  const healthyBody = await source.text();
  assert.match(healthyBody, /healthy/u);
  assert.equal(occurrences(healthyBody, OLD_NONCE), 2);
  assert.doesNotMatch(healthyBody, /recent saved view/u);

  nowUtcMs += 5_000;
  assert.equal(
    fallback.responseForFailure({
      contentSecurityPolicy: policy(NEW_NONCE),
      failure: { kind: "response", status: 404 },
      nonce: NEW_NONCE,
      pathname: "/events",
      request: request("/events"),
    }),
    null,
    "last-known-good is failure-only",
  );
  const recovered = fallback.responseForFailure({
    contentSecurityPolicy: policy(NEW_NONCE),
    failure: { kind: "response", status: 503 },
    nonce: NEW_NONCE,
    pathname: "/events",
    request: request("/events"),
  });
  assert.ok(recovered);
  assert.equal(recovered.status, 200);
  assert.match(recovered.headers.get("cache-control") ?? "", /no-store/u);
  assert.equal(
    recovered.headers.get(PUBLIC_RESPONSE_FALLBACK_STATE_HEADER),
    "stale",
  );
  assert.equal(recovered.headers.get("x-vcc-response-age"), "5");
  assert.equal(recovered.headers.get("content-security-policy"), policy(NEW_NONCE));
  const body = await recovered.text();
  assert.equal(occurrences(body, NEW_NONCE), 2);
  assert.doesNotMatch(body, new RegExp(OLD_NONCE, "u"));
  assert.doesNotMatch(
    body,
    new RegExp(PUBLIC_RESPONSE_FALLBACK_NONCE_PLACEHOLDER, "u"),
  );
  assert.match(body, /Updates are temporarily delayed/u);
  assert.match(body, /data-vcc-stale-response="true"/u);

  const isolatedFactory = createPublicResponseFallback({
    captureIntervalMs: 0,
    clock: () => nowUtcMs,
  });
  assert.equal(
    recover(isolatedFactory, "/events", "/events", NEW_NONCE),
    null,
    "factory instances must not share warm-isolate entries",
  );
});

test("RSC capture keys every known variation and restores bytes without HTML injection", async () => {
  let nowUtcMs = 2_000;
  const fallback = createPublicResponseFallback({
    captureIntervalMs: 0,
    clock: () => nowUtcMs,
  });
  const headers = {
    accept: "text/x-component",
    "next-router-prefetch": "1",
    "next-router-state-tree": "tree-a",
    rsc: "1",
  };
  const captured = fallback.scheduleCapture({
    nonce: OLD_NONCE,
    pathname: "/events",
    request: request("/events?_rsc=first", { headers }),
    response: rscResponse("flight-a", OLD_NONCE),
  });
  assert.ok(captured);
  assert.equal(await captured, true);
  nowUtcMs += 10;

  const wrongTree = fallback.responseForFailure({
    contentSecurityPolicy: policy(NEW_NONCE),
    failure: { kind: "throw" },
    nonce: NEW_NONCE,
    pathname: "/events",
    request: request("/events?_rsc=second", {
      headers: { ...headers, "next-router-state-tree": "tree-b" },
    }),
  });
  assert.equal(wrongTree, null);

  const recovered = fallback.responseForFailure({
    contentSecurityPolicy: policy(NEW_NONCE),
    failure: { kind: "throw" },
    nonce: NEW_NONCE,
    pathname: "/events",
    request: request("/events?_rsc=second", { headers }),
  });
  assert.ok(recovered);
  assert.match(recovered.headers.get("content-type") ?? "", /^text\/x-component/u);
  assert.equal(recovered.headers.get("x-vinext-mounted-slots"), "slot:/parallel");
  assert.equal(recovered.headers.get("x-vinext-params"), "%7B%7D");
  const body = await recovered.text();
  assert.match(body, /flight-a/u);
  assert.match(body, new RegExp(NEW_NONCE, "u"));
  assert.doesNotMatch(body, /data-vcc-stale-response|recent saved view/u);
});

test("capture is globally throttled and bounded by entry count, bytes, and age", async () => {
  let nowUtcMs = 10_000;
  const throttled = createPublicResponseFallback({
    captureIntervalMs: 100,
    clock: () => nowUtcMs,
  });
  assert.equal(
    await throttled.scheduleCapture({
      nonce: OLD_NONCE,
      pathname: "/",
      request: request("/"),
      response: htmlResponse("home", OLD_NONCE),
    }),
    true,
  );
  assert.equal(
    throttled.scheduleCapture({
      nonce: OLD_NONCE,
      pathname: "/events",
      request: request("/events"),
      response: htmlResponse("events", OLD_NONCE),
    }),
    null,
  );

  const bounded = createPublicResponseFallback({
    captureIntervalMs: 0,
    clock: () => nowUtcMs,
    maxAgeMs: 50,
    maxEntries: 2,
    maxEntryBytes: 2_000,
    maxTotalBytes: 4_000,
  });
  for (const [target, marker] of [
    ["/", "first-home"],
    ["/events", "second-events"],
    ["/events?month=2026-08", "third-month"],
  ]) {
    const capture = bounded.scheduleCapture({
      nonce: OLD_NONCE,
      pathname: target === "/" ? "/" : "/events",
      request: request(target),
      response: htmlResponse(marker, OLD_NONCE),
    });
    assert.ok(capture);
    assert.equal(await capture, true);
    nowUtcMs += 1;
  }
  assert.equal(recover(bounded, "/", "/", NEW_NONCE), null);
  assert.match(
    await recover(bounded, "/events", "/events", NEW_NONCE)?.text(),
    /second-events/u,
  );
  assert.match(
    await recover(
      bounded,
      "/events?month=2026-08",
      "/events",
      NEW_NONCE,
    )?.text(),
    /third-month/u,
  );

  nowUtcMs += 51;
  assert.equal(recover(bounded, "/events", "/events", NEW_NONCE), null);

  const byteBounded = createPublicResponseFallback({
    captureIntervalMs: 0,
    maxAgeMs: 100,
    maxEntries: 2,
    maxEntryBytes: 350,
    maxTotalBytes: 700,
  });
  const oversized = byteBounded.scheduleCapture({
    nonce: OLD_NONCE,
    pathname: "/events",
    request: request("/events"),
    response: htmlResponse("x".repeat(1_000), OLD_NONCE),
  });
  assert.ok(oversized);
  assert.equal(await oversized, false);
  assert.equal(
    recover(byteBounded, "/events", "/events", NEW_NONCE),
    null,
  );

  const totalByteBounded = createPublicResponseFallback({
    captureIntervalMs: 0,
    maxAgeMs: 100,
    maxEntries: 3,
    maxEntryBytes: 900,
    maxTotalBytes: 1_000,
  });
  for (const [target, pathname] of [
    ["/", "/"],
    ["/events", "/events"],
  ]) {
    const response = htmlResponse("y".repeat(150), OLD_NONCE);
    const capture = totalByteBounded.scheduleCapture({
      nonce: OLD_NONCE,
      pathname,
      request: request(target),
      response,
    });
    assert.ok(capture);
    assert.equal(await capture, true);
  }
  assert.equal(
    recover(totalByteBounded, "/", "/", NEW_NONCE),
    null,
    "the total byte ceiling evicts the oldest otherwise-valid entry",
  );
  assert.ok(
    recover(totalByteBounded, "/events", "/events", NEW_NONCE),
  );
});

test("private, personalized, cookie-setting, private-cache, and Vary-star responses never enter the store", async () => {
  for (const responseOverrides of [
    { "set-cookie": "secret=value" },
    { "cache-control": "private, no-store" },
    { vary: "*" },
    { vary: "Cookie" },
  ]) {
    const fallback = createPublicResponseFallback({ captureIntervalMs: 0 });
    assert.equal(
      fallback.scheduleCapture({
        nonce: OLD_NONCE,
        pathname: "/events",
        request: request("/events"),
        response: htmlResponse("unsafe", OLD_NONCE, responseOverrides),
      }),
      null,
    );
  }

  const fallback = createPublicResponseFallback({ captureIntervalMs: 0 });
  assert.equal(
    fallback.scheduleCapture({
      nonce: OLD_NONCE,
      pathname: "/organizer",
      request: request("/organizer"),
      response: htmlResponse("private organizer", OLD_NONCE),
    }),
    null,
  );
  assert.equal(
    fallback.scheduleCapture({
      nonce: OLD_NONCE,
      pathname: "/events",
      request: request("/events", { headers: { cookie: "private=1" } }),
      response: htmlResponse("private cookie", OLD_NONCE),
    }),
    null,
  );
  assert.equal(
    fallback.responseForFailure({
      contentSecurityPolicy: policy(NEW_NONCE),
      failure: { kind: "throw" },
      nonce: NEW_NONCE,
      pathname: "/organizer",
      request: request("/organizer"),
    }),
    null,
  );
});

test("the Worker uses the fallback only around invariant and handler failures and captures via waitUntil", async () => {
  const worker = await readFile(new URL("worker/index.ts", projectRoot), "utf8");
  assert.match(worker, /createPublicResponseFallback\(\)/u);
  assert.match(
    worker,
    /function recoverPublicResponseAfterFailure\([\s\S]*?publicResponseFallback\.responseForFailure\(/u,
  );
  assert.match(
    worker,
    /const invariantStatus = await ensureDatabaseInvariantsForRequest[\s\S]*?invariantStatus === "repaired"[\s\S]*?recoverPublicResponseAfterFailure\([\s\S]*?\{ kind: "response", status: unavailable\.status \}[\s\S]*?"database_invariants"/u,
  );
  assert.match(
    worker,
    /catch \{[\s\S]*?database_invariants_unavailable[\s\S]*?recoverPublicResponseAfterFailure\([\s\S]*?\{ kind: "throw" \}[\s\S]*?"database_invariants"/u,
  );
  assert.match(
    worker,
    /handler\.fetch\([\s\S]*?await recoverPublicResponseAfterFailure\([\s\S]*?\{ kind:\s*"throw" \}[\s\S]*?responseAfterDurableRefresh\.status >= 500/u,
  );
  assert.match(worker, /if \(recovered\) return recovered;[\s\S]*?throw error/u);
  assert.match(
    worker,
    /scheduleCapture\([\s\S]*?ctx\.waitUntil\(capture\)/u,
  );
  assert.doesNotMatch(worker, /caches\.(?:default|open)|CacheStorage/u);
});

function request(target, options = {}) {
  return new Request(new URL(target, "https://club.example"), options);
}

function htmlResponse(marker, nonce, overrides = {}) {
  return new Response(
    `<!doctype html><html><head><script nonce="${nonce}">window.x=1</script></head><body><main>${marker}</main><script nonce="${nonce}">window.y=2</script></body></html>`,
    {
      headers: {
        "cache-control": "no-store",
        "content-security-policy": policy(nonce),
        "content-type": "text/html; charset=utf-8",
        ...overrides,
      },
      status: 200,
    },
  );
}

function rscResponse(marker, nonce) {
  return new Response(`0:["${marker}",{"nonce":"${nonce}"}]`, {
    headers: {
      "cache-control": "no-store",
      "content-security-policy": policy(nonce),
      "content-type": "text/x-component; charset=utf-8",
      vary:
        "RSC, Accept, Next-Router-State-Tree, Next-Router-Prefetch, " +
        "Next-Router-Segment-Prefetch, Next-Url, " +
        "X-Vinext-Interception-Context, X-Vinext-Mounted-Slots, " +
        "X-Vinext-Rsc-Render-Mode, Accept-Encoding",
      "x-vinext-mounted-slots": "slot:/parallel",
      "x-vinext-params": "%7B%7D",
    },
    status: 200,
  });
}

function policy(nonce) {
  return `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
}

function recover(fallback, target, pathname, nonce) {
  return fallback.responseForFailure({
    contentSecurityPolicy: policy(nonce),
    failure: { kind: "response", status: 503 },
    nonce,
    pathname,
    request: request(target),
  });
}

function occurrences(value, needle) {
  return value.split(needle).length - 1;
}
