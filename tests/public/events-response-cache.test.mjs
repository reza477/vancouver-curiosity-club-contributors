import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  preparePublicEventsResponse,
  PUBLIC_EVENTS_RESPONSE_CACHE_MAX_BYTES,
  PUBLIC_EVENTS_RESPONSE_CACHE_TTL_SECONDS,
  PUBLIC_EVENTS_RESPONSE_NONCE_PLACEHOLDER,
  publicEventsResponseCacheContext,
  readPublicEventsResponseCache,
  rehydratePublicEventsCachedResponse,
  writePublicEventsResponseCache,
} from "../../lib/server/public/events-response-cache.ts";

const projectRoot = new URL("../../", import.meta.url);
const SOURCE_REVISION = "a".repeat(40);
const OTHER_SOURCE_REVISION = "b".repeat(40);
const FIRST_NONCE = "A".repeat(22);
const SECOND_NONCE = "B".repeat(22);
const REPRESENTATION_HEADERS = [
  "accept",
  "next-router-prefetch",
  "next-router-segment-prefetch",
  "next-router-state-tree",
  "next-url",
  "rsc",
  "x-vinext-interception-context",
  "x-vinext-mounted-slots",
  "x-vinext-rsc-render-mode",
];

test("the response cache is limited to exact anonymous Events GET and HEAD representations", async () => {
  const edge = memoryCache();
  const htmlGet = await cacheContext(
    eventsRequest("/events"),
    edge.cache,
  );
  const htmlHead = await cacheContext(
    eventsRequest("/events", { method: "HEAD" }),
    edge.cache,
  );
  const rscGet = await cacheContext(
    eventsRequest("/events.rsc"),
    edge.cache,
  );

  assert.equal(htmlGet.representation, "html");
  assert.equal(htmlGet.head, false);
  assert.equal(htmlHead.representation, "html");
  assert.equal(htmlHead.head, true);
  assert.equal(rscGet.representation, "rsc");
  assert.equal(rscGet.head, false);
  assert.equal(
    htmlHead.cacheRequest.url,
    htmlGet.cacheRequest.url,
    "GET and HEAD must share a representation key",
  );
  assert.notEqual(
    rscGet.cacheRequest.url,
    htmlGet.cacheRequest.url,
    "HTML and RSC representations must never share a cache entry",
  );

  for (const [request, pathname] of [
    [eventsRequest("/events", { method: "POST" }), "/events"],
    [eventsRequest("/event"), "/event"],
    [eventsRequest("/events/"), "/events/"],
    [new Request("http://club.example/events"), "/events"],
  ]) {
    assert.equal(
      await publicEventsResponseCacheContext(
        request,
        pathname,
        edge.cache,
        SOURCE_REVISION,
      ),
      null,
    );
  }
  assert.equal(
    await publicEventsResponseCacheContext(
      eventsRequest("/events"),
      "/events",
      null,
      SOURCE_REVISION,
    ),
    null,
  );

  const preparedHead = await preparePublicEventsResponse(
    htmlResponse(htmlBody()),
    htmlHead,
    FIRST_NONCE,
  );
  assert.equal(preparedHead.cacheResponse, null);
  assert.equal(await preparedHead.response.text(), "");
});

test("semantic query, representation headers, and build revision determine the key while _rsc does not", async () => {
  const edge = memoryCache();
  const base = await cacheContext(
    eventsRequest("/events.rsc", {
      headers: {
        Accept: "text/x-component",
        "Next-Router-State-Tree": "tree-a",
        RSC: "1",
      },
      search: "?month=2026-08&lane=think&_rsc=transport_a",
    }),
    edge.cache,
  );
  const reorderedWithFreshTransportKey = await cacheContext(
    eventsRequest("/events.rsc", {
      headers: {
        Accept: "text/x-component",
        "Next-Router-State-Tree": "tree-a",
        RSC: "1",
      },
      search: "?_rsc=transport_b&lane=think&month=2026-08",
    }),
    edge.cache,
  );
  assert.equal(
    reorderedWithFreshTransportKey.cacheRequest.url,
    base.cacheRequest.url,
    "the transport-only _rsc value and query order must not fragment the cache",
  );

  const variants = [
    await cacheContext(
      eventsRequest("/events", {
        headers: {
          Accept: "text/x-component",
          "Next-Router-State-Tree": "tree-a",
        },
        search: "?month=2026-08&lane=think",
      }),
      edge.cache,
    ),
    await cacheContext(
      eventsRequest("/events", {
        headers: {
          Accept: "text/html",
          "Next-Router-State-Tree": "tree-b",
        },
        search: "?month=2026-08&lane=think",
      }),
      edge.cache,
    ),
    await cacheContext(
      eventsRequest("/events", {
        headers: {
          Accept: "text/html",
          "Next-Router-State-Tree": "tree-a",
        },
        search: "?month=2026-09&lane=think",
      }),
      edge.cache,
    ),
    await cacheContext(
      eventsRequest("/events", {
        headers: {
          Accept: "text/html",
          "Next-Router-State-Tree": "tree-a",
        },
        search: "?month=2026-08&lane=make",
      }),
      edge.cache,
    ),
    await cacheContext(
      eventsRequest("/events", {
        headers: {
          Accept: "text/html",
          "Next-Router-State-Tree": "tree-a",
        },
        search: "?month=2026-08&lane=think",
      }),
      edge.cache,
      OTHER_SOURCE_REVISION,
    ),
  ];
  assert.equal(
    new Set([base, ...variants].map((context) => context.cacheRequest.url))
      .size,
    variants.length + 1,
    "semantic query values, response-varying headers, and builds need distinct keys",
  );

  const noHeaders = await cacheContext(
    eventsRequest("/events", {
      search: "?month=2026-08&lane=think",
    }),
    edge.cache,
  );
  const headerKeys = [];
  for (const name of REPRESENTATION_HEADERS) {
    const context = await cacheContext(
      eventsRequest("/events", {
        headers: { [name]: `${name}-variant` },
        search: "?month=2026-08&lane=think",
      }),
      edge.cache,
    );
    assert.notEqual(
      context.cacheRequest.url,
      noHeaders.cacheRequest.url,
      `${name} must participate in the representation key`,
    );
    headerKeys.push(context.cacheRequest.url);
  }
  assert.equal(
    new Set(headerKeys).size,
    REPRESENTATION_HEADERS.length,
    "each response-varying header position must produce its own key",
  );

  for (const search of [
    "?preview=1",
    "?month=2026-08&month=2026-09",
    "?_rsc=transport_html",
    "?_rsc=",
    "?_rsc=not%20opaque",
  ]) {
    assert.equal(
      await publicEventsResponseCacheContext(
        eventsRequest("/events", { search }),
        "/events",
        edge.cache,
        SOURCE_REVISION,
      ),
      null,
      `${search} must bypass the response cache`,
    );
  }
});

test("application identity and conditional requests bypass while infrastructure cookies remain eligible", async () => {
  const edge = memoryCache();
  const bypassHeaders = [
    { Authorization: "Bearer private" },
    { "If-Match": '"revision"' },
    { "If-Modified-Since": "Tue, 11 Aug 2026 19:00:00 GMT" },
    { "If-None-Match": '"revision"' },
    { "If-Range": '"revision"' },
    { "If-Unmodified-Since": "Tue, 11 Aug 2026 19:00:00 GMT" },
    { Range: "bytes=0-99" },
    { "Cache-Control": "no-cache" },
    { "Cache-Control": "no-store" },
    { "Cache-Control": "max-age=0" },
    { Pragma: "no-cache" },
    { Cookie: "vcc_session=private" },
    { Cookie: "__cf_bm=infra; vcc_session=private" },
    { "OAI-Authenticated-User-Id": "private-user" },
  ];
  for (const headers of bypassHeaders) {
    assert.equal(
      await publicEventsResponseCacheContext(
        eventsRequest("/events", { headers }),
        "/events",
        edge.cache,
        SOURCE_REVISION,
      ),
      null,
      `${Object.keys(headers)[0]} must bypass the public cache`,
    );
  }

  for (const cookie of [
    "__cf_bm=bot-check",
    "_cfuvid=visitor",
    "cf_clearance=clearance",
    "__cf_bm=bot-check; _cfuvid=visitor; cf_clearance=clearance",
  ]) {
    const context = await publicEventsResponseCacheContext(
      eventsRequest("/events", { headers: { Cookie: cookie } }),
      "/events",
      edge.cache,
      SOURCE_REVISION,
    );
    assert.ok(context, `${cookie} should remain eligible`);
  }
});

test("a safe miss is cached once and each visitor receives a fresh nonce without cached CSP", async () => {
  const edge = memoryCache();
  const request = eventsRequest("/events", {
    headers: { Accept: "text/html" },
    search: "?month=2026-08",
  });
  const coldContext = await cacheContext(request, edge.cache);
  assert.equal(await readPublicEventsResponseCache(coldContext), null);

  const prepared = await preparePublicEventsResponse(
    htmlResponse(htmlBody(), {
      "Content-Length": "999",
      "Content-Security-Policy": `script-src 'nonce-${PUBLIC_EVENTS_RESPONSE_NONCE_PLACEHOLDER}'`,
      "X-Robots-Tag": "noindex",
    }),
    coldContext,
    FIRST_NONCE,
  );
  assert.ok(prepared.cacheResponse);
  assert.equal(
    prepared.cacheResponse.headers.get("cache-control"),
    `public, max-age=${PUBLIC_EVENTS_RESPONSE_CACHE_TTL_SECONDS}`,
  );
  assert.equal(
    prepared.cacheResponse.headers.get("content-security-policy"),
    null,
    "a nonce-bound CSP must never be persisted",
  );
  assert.equal(prepared.cacheResponse.headers.get("content-length"), null);
  assert.equal(prepared.cacheResponse.headers.get("x-robots-tag"), null);
  assert.match(
    await prepared.cacheResponse.clone().text(),
    new RegExp(PUBLIC_EVENTS_RESPONSE_NONCE_PLACEHOLDER, "u"),
  );

  const firstVisitorBody = await prepared.response.text();
  assert.match(firstVisitorBody, new RegExp(FIRST_NONCE, "u"));
  assert.doesNotMatch(
    firstVisitorBody,
    new RegExp(PUBLIC_EVENTS_RESPONSE_NONCE_PLACEHOLDER, "u"),
  );
  assert.equal(
    prepared.response.headers.get("cache-control"),
    "no-store, must-revalidate",
  );

  await writePublicEventsResponseCache(
    coldContext,
    prepared.cacheResponse,
  );
  assert.equal(edge.puts.length, 1);

  const headContext = await cacheContext(
    eventsRequest("/events", {
      headers: { Accept: "text/html" },
      method: "HEAD",
      search: "?month=2026-08",
    }),
    edge.cache,
  );
  const headHit = await readPublicEventsResponseCache(headContext);
  assert.ok(headHit, "HEAD should reuse the safe GET representation");
  assert.equal(await headHit.text(), "");

  const warmContext = await cacheContext(request, edge.cache);
  const cached = await readPublicEventsResponseCache(warmContext);
  assert.ok(cached);
  assert.equal(cached.headers.get("content-security-policy"), null);
  assert.equal(cached.headers.get("x-vcc-events-cache-kind"), null);
  assert.equal(cached.headers.get("x-vcc-events-cache-version"), null);
  const secondVisitor = await rehydratePublicEventsCachedResponse(
    cached,
    SECOND_NONCE,
  );
  const secondVisitorBody = await secondVisitor.text();
  assert.match(secondVisitorBody, new RegExp(SECOND_NONCE, "u"));
  assert.doesNotMatch(secondVisitorBody, new RegExp(FIRST_NONCE, "u"));
  assert.doesNotMatch(
    secondVisitorBody,
    new RegExp(PUBLIC_EVENTS_RESPONSE_NONCE_PLACEHOLDER, "u"),
  );
  assert.equal(secondVisitor.headers.get("content-security-policy"), null);
  assert.equal(
    secondVisitor.headers.get("cache-control"),
    "no-store, must-revalidate",
  );
});

test("personalized, private, error, and oversized responses are never cached", async () => {
  const edge = memoryCache();
  const context = await cacheContext(eventsRequest("/events"), edge.cache);
  const cases = [
    {
      name: "Set-Cookie response",
      response: htmlResponse(htmlBody(), { "Set-Cookie": "session=private" }),
    },
    {
      name: "private response",
      response: htmlResponse(htmlBody(), {
        "Cache-Control": "private, no-store",
      }),
    },
    {
      name: "error response",
      response: htmlResponse(htmlBody(), {}, 503),
    },
    {
      name: "oversized response",
      response: htmlResponse(
        `${htmlBody()}${"x".repeat(PUBLIC_EVENTS_RESPONSE_CACHE_MAX_BYTES)}`,
      ),
    },
  ];

  for (const cacheCase of cases) {
    const prepared = await preparePublicEventsResponse(
      cacheCase.response,
      context,
      FIRST_NONCE,
    );
    assert.equal(
      prepared.cacheResponse,
      null,
      `${cacheCase.name} must not enter the shared cache`,
    );
  }
  assert.equal(edge.puts.length, 0);
  assert.ok(PUBLIC_EVENTS_RESPONSE_CACHE_TTL_SECONDS > 0);
  assert.ok(
    PUBLIC_EVENTS_RESPONSE_CACHE_TTL_SECONDS <= 60,
    "the full-response cache must expire within one minute",
  );
});

test("the worker checks invariants and maintenance before cache lookup and returns hits before rendering", async () => {
  const worker = await readFile(
    new URL("worker/index.ts", projectRoot),
    "utf8",
  );
  const invariant = worker.indexOf("await ensureDatabaseInvariants(env.DB)");
  const maintenance = worker.indexOf("await runRequestMaintenance(");
  const cacheContext = worker.indexOf(
    "await publicEventsResponseCacheContext(",
  );
  const cacheRead = worker.indexOf("await readPublicEventsResponseCache(");
  const handler = worker.indexOf("await handler.fetch(");

  for (const [name, index] of [
    ["database invariants", invariant],
    ["request maintenance", maintenance],
    ["cache context", cacheContext],
    ["cache read", cacheRead],
    ["application renderer", handler],
  ]) {
    assert.ok(index >= 0, `${name} must remain in the Worker flow`);
  }
  assert.ok(invariant < maintenance);
  assert.ok(maintenance < cacheContext);
  assert.ok(cacheContext < cacheRead);
  assert.ok(cacheRead < handler);

  const hitBranch = worker.slice(cacheRead, handler);
  assert.match(hitBranch, /if \(cached\)/u);
  assert.match(hitBranch, /rehydratePublicEventsCachedResponse/u);
  assert.match(
    hitBranch,
    /return secureResponse\(\s*request,\s*rehydrated,\s*policy,/u,
    "a valid hit must receive the request's fresh CSP and return before vinext renders",
  );
  const missBranch = worker.slice(handler);
  assert.match(missBranch, /preparePublicEventsResponse/u);
  assert.match(missBranch, /writePublicEventsResponseCache/u);
  assert.match(
    missBranch,
    /return secureResponse\(\s*request,\s*response,\s*policy,/u,
    "a cold response must receive the same fresh CSP used by its visitor nonce",
  );
});

async function cacheContext(
  request,
  cache,
  sourceRevision = SOURCE_REVISION,
) {
  const context = await publicEventsResponseCacheContext(
    request,
    new URL(request.url).pathname,
    cache,
    sourceRevision,
  );
  assert.ok(context, "the test request should be cache eligible");
  return context;
}

function eventsRequest(pathname, options = {}) {
  const url = new URL(pathname, "https://club.example");
  if (options.search) url.search = options.search;
  return new Request(url, {
    headers: options.headers,
    method: options.method ?? "GET",
  });
}

function htmlBody() {
  return `<!doctype html><script nonce="${PUBLIC_EVENTS_RESPONSE_NONCE_PLACEHOLDER}">globalThis.__eventsReady=true</script>`;
}

function htmlResponse(body, extraHeaders = {}, status = 200) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...extraHeaders,
    },
    status,
  });
}

function memoryCache() {
  const entries = new Map();
  const matches = [];
  const puts = [];
  return {
    cache: {
      async match(request) {
        matches.push(request.url);
        return entries.get(request.url)?.clone();
      },
      async put(request, response) {
        puts.push(request.url);
        entries.set(request.url, response.clone());
      },
    },
    matches,
    puts,
  };
}
