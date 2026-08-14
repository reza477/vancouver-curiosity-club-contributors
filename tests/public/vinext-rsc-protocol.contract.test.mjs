import assert from "node:assert/strict";
import test from "node:test";
import {
  durablePublicResponseBuildRequest,
} from "../../lib/server/public/durable-response-fallback.ts";
import {
  createRscRequestHeaders,
  createRscRequestUrl,
  resolveInvalidRscCacheBustingRequest,
} from "../../node_modules/vinext/dist/server/app-rsc-cache-busting.js";
import {
  buildAppPageRscResponse,
} from "../../node_modules/vinext/dist/server/app-page-response.js";
import {
  normalizeRscRequest,
} from "../../node_modules/vinext/dist/server/app-rsc-request-normalization.js";

const ORIGIN = "https://vancouvercuriosityclub.com";

test("durable Home and Events captures use Vinext's exact baseline RSC protocol", async () => {
  const protocolCases = [
    {
      appPathname: "/",
      expectedUrl: "/.rsc?_rsc",
      rscPathname: "/.rsc",
      slot: "home-rsc",
    },
    {
      appPathname: "/events",
      expectedUrl: "/events.rsc?_rsc",
      rscPathname: "/events.rsc",
      slot: "events-rsc",
    },
  ];

  for (const protocolCase of protocolCases) {
    const buildRequest = durablePublicResponseBuildRequest(
      ORIGIN,
      protocolCase.slot,
    );
    const url = new URL(buildRequest.request.url);

    assert.equal(url.pathname, protocolCase.rscPathname);
    assert.equal(
      url.search,
      "?_rsc",
      "the no-variant cache buster is a bare query parameter",
    );
    assert.equal(buildRequest.request.headers.get("accept"), "text/x-component");
    assert.equal(buildRequest.request.headers.get("rsc"), "1");

    const vinextHeaders = createRscRequestHeaders();
    assert.equal(
      await createRscRequestUrl(protocolCase.appPathname, vinextHeaders),
      protocolCase.expectedUrl,
      "Vinext's own URL builder must agree with the durable capture URL",
    );

    const normalized = normalizeRscRequest(buildRequest.request, "");
    assert.ok(!(normalized instanceof Response));
    assert.equal(normalized.isRscRequest, true);
    assert.equal(normalized.pathname, protocolCase.rscPathname);
    assert.equal(normalized.cleanPathname, protocolCase.appPathname);
    assert.equal(
      await resolveInvalidRscCacheBustingRequest({
        isRscRequest: normalized.isRscRequest,
        request: buildRequest.request,
      }),
      null,
      "the baseline request must not be redirected before rendering",
    );

    const response = buildAppPageRscResponse(
      new Blob(["0:null\n"]).stream(),
      {
        middlewareContext: { headers: null, status: null },
        policy: {},
      },
    );
    assert.equal(
      response.headers.get("content-type"),
      "text/x-component; charset=utf-8",
    );

    const nonBaselineUrl = new URL(buildRequest.request.url);
    nonBaselineUrl.search = "?_rsc=durable";
    const redirect = await resolveInvalidRscCacheBustingRequest({
      isRscRequest: true,
      request: new Request(nonBaselineUrl, {
        headers: buildRequest.request.headers,
      }),
    });
    assert.ok(redirect instanceof Response);
    assert.equal(redirect.status, 307);
    assert.equal(redirect.headers.get("location"), protocolCase.expectedUrl);
  }
});

test("Vinext does not select RSC from headers at canonical HTML paths", () => {
  for (const pathname of ["/", "/events"]) {
    const normalized = normalizeRscRequest(
      new Request(new URL(pathname, ORIGIN), {
        headers: createRscRequestHeaders(),
      }),
      "",
    );
    assert.ok(!(normalized instanceof Response));
    assert.equal(normalized.isRscRequest, false);
    assert.equal(normalized.cleanPathname, pathname);
  }
});
