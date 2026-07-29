import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import test from "node:test";
import {
  parsePublicExportFilters,
} from "../../lib/server/phase7/public-exports.ts";

const ROOT = process.cwd();
let runtimeBindingReads = 0;
const ROUTE_ENVIRONMENT = new Proxy({}, {
  get() {
    runtimeBindingReads += 1;
    return undefined;
  },
});
const ROUTE_HEADERS = {
  "oai-authenticated-user-email": "owner@phase8-tests.invalid",
  "oai-authenticated-user-full-name": "Phase%208%20Owner",
  "oai-authenticated-user-full-name-encoding":
    "percent-encoded-utf-8",
};
globalThis.__VCC_PHASE8_EXPORT_ROUTE_ENV__ = ROUTE_ENVIRONMENT;
globalThis.__VCC_PHASE8_EXPORT_ROUTE_HEADERS__ = ROUTE_HEADERS;
nodeModule.registerHooks?.({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export const env = globalThis.__VCC_PHASE8_EXPORT_ROUTE_ENV__;",
        ),
      };
    }
    if (specifier === "next/headers") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export async function headers() { return new Headers(globalThis.__VCC_PHASE8_EXPORT_ROUTE_HEADERS__); }",
        ),
      };
    }
    if (specifier === "server-only") {
      return { shortCircuit: true, url: dataModule("export {};") };
    }
    return nextResolve(specifier, context);
  },
});
const [
  operationalExportRoute,
  mediaManifestRoute,
  mediaOriginalRoute,
] = await Promise.all([
  import(
    "../../app/api/organizer/exports/events.csv/route.ts?phase8-cross-site"
  ),
  import(
    "../../app/api/organizer/exports/media-manifest.json/route.ts?phase8-cross-site"
  ),
  import(
    "../../app/api/organizer/exports/media/[id]/original/route.ts?phase8-cross-site"
  ),
]);

test("public export filters share bounded Events-page names and reject unknown or duplicate input", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");
  const parsed = parsePublicExportFilters(
    new URLSearchParams(
      "state=upcoming&from=2026-07-28&to=2027-07-28&club=vcc",
    ),
    now,
  );
  assert.equal(parsed.clubSlug, "vcc");
  assert.equal(parsed.fromDate, "2026-07-28");
  assert.equal(parsed.toDate, "2027-07-28");
  assert.throws(
    () =>
      parsePublicExportFilters(
        new URLSearchParams("organizationId=other-org"),
        now,
      ),
    (error) => error?.name === "InputValidationError",
  );
  assert.throws(
    () =>
      parsePublicExportFilters(
        new URLSearchParams("club=vcc&club=other"),
        now,
      ),
    (error) => error?.name === "InputValidationError",
  );
  assert.throws(
    () =>
      parsePublicExportFilters(
        new URLSearchParams("from=2026-07-28&to=2027-07-29"),
        now,
      ),
    (error) => error?.name === "InputValidationError",
  );
});

test("private calendar path tokens are replaced before maintenance and protected by final headers", () => {
  const worker = source("worker/index.ts");
  const pathname = source("lib/request-pathname.ts");
  assert.match(
    pathname,
    /pathname\.startsWith\("\/api\/calendar\/private\/"\)/u,
  );
  assert.match(pathname, /\? "\/api\/calendar\/private\/\[token\]"/u);
  assert.match(
    worker,
    /isPrivateOrIdentityPath,[\s\S]*?safeRequestPathname/u,
  );
  assert.match(
    worker,
    /runRequestMaintenance\(\s*env\.DB,[\s\S]*?pathname:\s*requestPathname/u,
  );
  assert.match(
    worker,
    /normalizeEncodedRequestPathname\(url\.pathname\)/u,
  );
  assert.doesNotMatch(worker, /pathname:\s*url\.pathname/u);
  assert.match(
    worker,
    /isPrivateRequest\s*\?\s*"no-referrer"\s*:\s*"strict-origin-when-cross-origin"/u,
  );
  assert.match(
    worker,
    /headers\.set\("X-Robots-Tag",\s*"noindex, nofollow, noarchive"\)/u,
  );
  assert.match(
    worker,
    /headers\.set\("Cache-Control",\s*"private, no-store, max-age=0"\)/u,
  );
});

test("private export routes have fixed safe log paths and hardened download headers", () => {
  for (const path of [
    "app/api/organizer/exports/events.csv/route.ts",
    "app/api/organizer/exports/media-manifest.json/route.ts",
    "app/api/organizer/exports/backup.json/route.ts",
    "app/api/organizer/exports/media/[id]/original/route.ts",
    "app/api/calendar/private/[token]/route.ts",
  ]) {
    const route = source(path);
    assert.match(route, /private, no-store/u, path);
    assert.match(route, /noindex, nofollow, noarchive/u, path);
    assert.match(route, /X-Content-Type-Options/u, path);
    if (
      path === "app/api/organizer/exports/events.csv/route.ts" ||
      path ===
        "app/api/organizer/exports/media-manifest.json/route.ts" ||
      path ===
        "app/api/organizer/exports/media/[id]/original/route.ts"
    ) {
      assert.match(route, /assertTrustedOrganizerRead\(request\)/u, path);
    }
    assert.doesNotMatch(route, /console\.(?:log|info|warn|error)/u, path);
  }
  const feedRoute = source("app/api/calendar/private/[token]/route.ts");
  assert.match(feedRoute, /route:\s*"\/api\/calendar\/private\/\[token\]"/u);
  assert.doesNotMatch(
    feedRoute,
    /route:\s*`[^`]*\$\{token\}/u,
  );
});

test("authenticated private export GET routes deny crafted cross-site requests before runtime access", async () => {
  const cases = [
    {
      call: (request) => operationalExportRoute.GET(request),
      pathname: "/api/organizer/exports/events.csv",
    },
    {
      call: (request) => mediaManifestRoute.GET(request),
      pathname: "/api/organizer/exports/media-manifest.json",
    },
    {
      call: (request) =>
        mediaOriginalRoute.GET(request, {
          params: Promise.resolve({ id: "asset-private" }),
        }),
      pathname:
        "/api/organizer/exports/media/asset-private/original",
    },
  ];
  for (const { call, pathname } of cases) {
    runtimeBindingReads = 0;
    const response = await call(
      new Request(`https://vcc.example${pathname}`, {
        headers: {
          Origin: "https://attacker.example",
          "Sec-Fetch-Site": "cross-site",
        },
      }),
    );
    assert.equal(response.status, 403, pathname);
    assert.equal(runtimeBindingReads, 0, pathname);
    assert.match(
      response.headers.get("cache-control") ?? "",
      /private,\s*no-store/iu,
      pathname,
    );
    assert.equal(
      response.headers.get("x-robots-tag"),
      "noindex, nofollow, noarchive",
      pathname,
    );
    const body = await response.json();
    assert.equal(body.error.code, "authorization_denied", pathname);
  }
});

test("public ICS and CSV routes emit exact safe attachment headers", () => {
  for (const path of [
    "app/events/[slug]/calendar.ics/route.ts",
    "app/events/calendar.ics/route.ts",
    "app/events/events.csv/route.ts",
  ]) {
    const route = source(path);
    assert.match(
      route,
      /"Cache-Control":\s*"public, max-age=0, must-revalidate"/u,
      path,
    );
    assert.match(
      route,
      /"Content-Disposition":\s*`attachment; filename="\$\{download\.fileName\}"`/u,
      path,
    );
    assert.match(
      route,
      /"Content-Type":\s*download\.contentType/u,
      path,
    );
    assert.match(
      route,
      /"X-Content-Type-Options":\s*"nosniff"/u,
      path,
    );
    assert.match(
      route,
      /"X-Robots-Tag":\s*"noindex, nofollow, noarchive"/u,
      path,
    );
    assert.doesNotMatch(route, /private,\s*no-store/u, path);
  }
  const oneEventRoute = source(
    "app/events/[slug]/calendar.ics/route.ts",
  );
  assert.match(oneEventRoute, /status:\s*404/u);
  assert.match(
    oneEventRoute,
    /"X-Robots-Tag":\s*"noindex, nofollow, noarchive"/u,
  );
});

test("private Calendar is available to all organizer roles while Exports remains Owner or Administrator only", () => {
  const exportsPage = source("app/organizer/exports/page.tsx");
  const calendarPage = source("app/organizer/calendar/page.tsx");
  assert.match(exportsPage, /membership\.role === "organizer"\) forbidden\(\)/u);
  assert.match(calendarPage, /listOwnCalendarSubscriptions/u);
  assert.match(calendarPage, /PrivateCalendarSubscriptionPanel/u);
});

test("Owner backup route embeds the exact build source revision instead of an unavailable placeholder", () => {
  const route = source(
    "app/api/organizer/exports/backup.json/route.ts",
  );
  const vite = source("vite.config.ts");
  assert.match(
    route,
    /sourceRevision:\s*__VCC_SOURCE_REVISION__/u,
  );
  assert.doesNotMatch(
    route,
    /sourceRevision:\s*"unavailable"/u,
  );
  assert.match(
    vite,
    /execFileSync\("git",\s*\["rev-parse",\s*"HEAD"\]/u,
  );
  assert.match(
    vite,
    /__VCC_SOURCE_REVISION__:\s*JSON\.stringify\(sourceRevision\)/u,
  );
});

function source(path) {
  return readFileSync(`${ROOT}/${path}`, "utf8");
}

function dataModule(sourceText) {
  return `data:text/javascript,${encodeURIComponent(sourceText)}`;
}
