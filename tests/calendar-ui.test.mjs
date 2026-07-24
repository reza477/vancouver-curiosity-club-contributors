import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseJsonBody,
  readBoundedUtf8Body,
  requireSameOriginMutation,
} from "../app/api/organizer/meetup/_mutation.ts";

const projectRoot = new URL("../", import.meta.url);

test("homepage hands event discovery off to the real public calendar", async () => {
  const page = await readFile(new URL("app/page.tsx", projectRoot), "utf8");

  assert.match(page, /href="\/calendar"/);
  assert.match(page, /Open the public calendar/);
  assert.match(page, /verified source details only/);
  assert.match(page, /Background sync[\s\S]*Not scheduled/);
  assert.match(page, /Independent learning, in company/);
  assert.doesNotMatch(page, /Phase 1 foundation preview/);
  assert.doesNotMatch(page, /sampleEvents|event-list|fictional examples/i);
});

test("public calendar renders every honest connection state and safe event facts", async () => {
  const [page, view] = await Promise.all([
    readFile(new URL("app/calendar/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/calendar/CalendarView.tsx", projectRoot), "utf8"),
  ]);

  for (const label of [
    "Not connected",
    "Never synced",
    "Import in progress",
    "Fresh",
    "Stale",
    "Source error",
  ]) {
    assert.match(view, new RegExp(label));
  }
  assert.match(view, /last-known listings/i);
  assert.match(view, /source-backed rows committed by successful row transactions/i);
  assert.match(view, /not claimed as one exact prior snapshot/i);
  assert.doesNotMatch(view, /hasLastKnownData/);
  assert.match(view, /one connected official feed when viewed/i);
  assert.match(view, /waits at least 15 minutes/i);
  assert.match(view, /unfinished snapshot resumes in a[\s\S]*bounded chunk/i);
  assert.match(view, /No scheduled or background sync\s+runs/);
  assert.doesNotMatch(view, /dateStyle|timeStyle/);
  assert.doesNotThrow(() =>
    new Intl.DateTimeFormat("en-CA", {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      timeZone: "America/Vancouver",
      timeZoneName: "short",
      year: "numeric",
    }).format(new Date("2026-07-24T01:00:00.000Z")),
  );
  assert.match(view, /event\.rsvpUrl\s*\?/);
  assert.match(view, /\.filter\(\s*\(event\) => !event\.isCancelled/);
  assert.match(view, /"RSVP on Meetup"/);
  assert.match(view, /rel="noreferrer noopener"/);
  assert.match(view, /DISPLAY_TIME_ZONE = "America\/Vancouver"/);
  assert.match(view, /timeZoneName:\s*"short"/);
  assert.doesNotMatch(view, /timeZone:\s*event\.schedule\.timeZone/);
  assert.match(
    view,
    /calendarDateKey\(starts, DISPLAY_TIME_ZONE\)[\s\S]*calendarDateKey\(ends, DISPLAY_TIME_ZONE\)/,
  );
  assert.match(view, /event\.schedule\.endDateExclusive/);
  assert.match(view, /Location details not published/);
  assert.match(page, /listDefaultPublicMeetupCalendar/);
  assert.doesNotMatch(page, /organizationId\s*:/);
});

test("organizer connection UI is noindex, server-authorized, and read-only for Organizer", async () => {
  const [portal, page, controls, model] = await Promise.all([
    readFile(new URL("app/organizer/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/organizer/meetup/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/organizer/meetup/MeetupControls.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/organizer/meetup/model.ts", projectRoot), "utf8"),
  ]);

  assert.match(portal, /href="\/organizer\/meetup"/);
  assert.match(portal, /Open connection workspace/);
  assert.match(portal, /does not[\s\S]*expose schedule-reserving event tools/);
  assert.doesNotMatch(portal, /private Phase 1 surface/i);
  assert.match(page, /requireChatGPTUser\("\/organizer\/meetup"\)/);
  assert.match(page, /authorizeOrganizerAccess/);
  assert.match(page, /index:\s*false/);
  assert.match(page, /follow:\s*false/);
  assert.match(
    page,
    /membership\.role === "owner"[\s\S]*membership\.role === "administrator"/,
  );
  assert.match(controls, /canConfigure\s*\?\s*\(/);
  assert.match(controls, /Organizer access is read-only/);
  assert.match(controls, /only an Owner or Administrator can refresh/);
  assert.match(
    controls,
    /Saved source[\s\S]*addresses are never shown back/,
  );
  assert.match(controls, /does not claim that a[\s\S]*refresh or import succeeded/);
  assert.doesNotMatch(model, /feedUrl|lastErrorCode|organizationId/);
  assert.match(model, /Explicitly strips organization identifiers/);
});

test("manual Meetup APIs derive authority server-side and restrict both mutations", async () => {
  const [shared, connect, refresh, model, worker] = await Promise.all([
    readFile(
      new URL("app/api/organizer/meetup/_shared.ts", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("app/api/organizer/meetup/connect/route.ts", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("app/api/organizer/meetup/refresh/route.ts", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/organizer/meetup/model.ts", projectRoot), "utf8"),
    readFile(new URL("worker/index.ts", projectRoot), "utf8"),
  ]);

  assert.match(shared, /getChatGPTUser\(\)/);
  assert.match(shared, /trustedIdentityFromSites\(user\)/);
  assert.match(shared, /authorizeOrganizerAccess\(database, identity/);

  for (const route of [connect, refresh]) {
    assert.match(route, /requireSameOriginMutation\(request\)/);
    assert.match(route, /readBoundedUtf8Body\(request,/);
    assert.match(route, /privateJsonHeaders\(\)/);
    assert.match(route, /safeErrorResponse/);
    assert.match(route, /"owner"/);
    assert.match(route, /"administrator"/);
    assert.doesNotMatch(route, /"organizer"/);
    assert.doesNotMatch(route, /organizationId|actorId|membershipRole/);
  }

  assert.doesNotMatch(
    model,
    /^\s*(feedUrl|lastErrorCode|organizationId)\s*:/mu,
  );
  assert.doesNotMatch(model, /state\.(feedUrl|lastErrorCode|organizationId)/u);
  assert.match(worker, /"\/organizer"/);
  assert.match(worker, /"\/api\/organizer"/);
});

test("same-origin mutation guard rejects missing, malformed, and cross-site origins", () => {
  const accepted = new Request("https://club.example/api/organizer/meetup", {
    method: "POST",
    headers: { Origin: "https://club.example" },
  });
  assert.doesNotThrow(() => requireSameOriginMutation(accepted));

  for (const request of [
    new Request("https://club.example/api/organizer/meetup", {
      method: "POST",
    }),
    new Request("https://club.example/api/organizer/meetup", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    }),
    new Request("https://club.example/api/organizer/meetup", {
      method: "POST",
      headers: { Origin: "not an origin" },
    }),
    new Request("https://club.example/api/organizer/meetup", {
      method: "POST",
      headers: { Origin: "https://club.example/path" },
    }),
  ]) {
    assert.throws(
      () => requireSameOriginMutation(request),
      (error) =>
        error?.code === "validation_failed" &&
        error?.publicMessage === "The request could not be validated.",
    );
  }
});

test("bounded body reader enforces streamed bytes without trusting Content-Length", async () => {
  const valid = new Request("https://club.example/api/organizer/meetup", {
    method: "POST",
    body: '{"feedUrl":"https://www.meetup.com/example/events/ical/"}',
  });
  const validBody = await readBoundedUtf8Body(valid, 256);
  assert.equal(parseJsonBody(validBody).feedUrl.includes("meetup.com"), true);

  const oversizedWithoutLength = new Request(
    "https://club.example/api/organizer/meetup",
    {
      method: "POST",
      body: "x".repeat(65),
    },
  );
  await assert.rejects(
    readBoundedUtf8Body(oversizedWithoutLength, 64),
    (error) => error?.code === "validation_failed",
  );

  const dishonestLength = new Request(
    "https://club.example/api/organizer/meetup",
    {
      method: "POST",
      headers: { "Content-Length": "1" },
      body: "x".repeat(65),
    },
  );
  await assert.rejects(
    readBoundedUtf8Body(dishonestLength, 64),
    (error) => error?.code === "validation_failed",
  );

  const declaredOversize = new Request(
    "https://club.example/api/organizer/meetup",
    {
      method: "POST",
      headers: { "Content-Length": "999" },
      body: "{}",
    },
  );
  await assert.rejects(
    readBoundedUtf8Body(declaredOversize, 64),
    (error) => error?.code === "validation_failed",
  );
});

test("wordmark uses the local brand icon and remains visible on narrow screens", async () => {
  const [page, calendar, css] = await Promise.all([
    readFile(new URL("app/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/calendar/CalendarView.tsx", projectRoot), "utf8"),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
  ]);

  assert.match(
    page,
    /<span className="wordmark-mark" aria-hidden="true" \/>/,
  );
  assert.match(
    calendar,
    /<span className="wordmark-mark" aria-hidden="true" \/>/,
  );
  assert.match(css, /\.wordmark-mark\s*\{[\s\S]*url\("\/icon\.png"\)/);
  assert.match(
    css,
    /@media \(max-width: 38rem\)[\s\S]*\.wordmark-mark\s*\{[\s\S]*display:\s*block/,
  );
});

test("narrow navigation preserves Calendar and demotes organizer access", async () => {
  const css = await readFile(
    new URL("app/globals.css", projectRoot),
    "utf8",
  );

  const narrowRules =
    css.match(
      /@media \(max-width: 52rem\)\s*\{([\s\S]*?)\n\}\n\n@media \(max-width: 38rem\)/,
    )?.[1] ?? "";

  assert.match(
    narrowRules,
    /\.primary-nav > \.portal-link\s*\{[\s\S]*?display:\s*none/,
  );
  assert.doesNotMatch(
    narrowRules,
    /\.primary-nav > a:not\(\.portal-link\)\s*\{[\s\S]*?display:\s*none/,
  );
});

test("small metadata labels keep a readable 0.75rem floor", async () => {
  const css = await readFile(
    new URL("app/globals.css", projectRoot),
    "utf8",
  );
  const subFloorRemSizes = [...css.matchAll(/font-size:\s*0\.(\d+)rem/g)]
    .map((match) => Number(`0.${match[1]}`))
    .filter((size) => size < 0.75);

  assert.deepEqual(subFloorRemSizes, []);
});
