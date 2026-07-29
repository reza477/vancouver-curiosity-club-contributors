import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  parsePublicExportFilters,
} from "../../lib/server/phase7/public-exports.ts";

const ROOT = process.cwd();

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
  assert.match(
    worker,
    /pathname\.startsWith\("\/api\/calendar\/private\/"\)/u,
  );
  assert.match(worker, /\? "\/api\/calendar\/private\/\[token\]"/u);
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
    /isPrivateCalendarSubscriptionPath\(requestPathname\)[\s\S]*?\?\s*"no-referrer"/u,
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
    assert.doesNotMatch(route, /console\.(?:log|info|warn|error)/u, path);
  }
  const feedRoute = source("app/api/calendar/private/[token]/route.ts");
  assert.match(feedRoute, /route:\s*"\/api\/calendar\/private\/\[token\]"/u);
  assert.doesNotMatch(
    feedRoute,
    /route:\s*`[^`]*\$\{token\}/u,
  );
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
