import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

test("Events settles the calendar and event list independently", async () => {
  const [source, renderer] = await Promise.all([
    readFile(new URL("app/events/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/_components/EventsPageRenderer.tsx", projectRoot),
      "utf8",
    ),
  ]);
  const combinedPromiseAll =
    /Promise\.all\(\s*\[[\s\S]{0,2500}queryPublicEventSlice[\s\S]{0,2500}loadPublicMonthCalendar[\s\S]{0,2500}\]\s*\)/u;

  assert.doesNotMatch(
    source,
    combinedPromiseAll,
    "a calendar rejection must not reject the event-list result (and vice versa)",
  );
  assert.match(source, /queryPublicEventSlice/u);
  assert.match(source, /loadPublicMonthCalendar/u);
  assert.match(source, /emptyEventPage/u);
  assert.match(source, /emptyPublicMonthCalendar/u);
  assert.match(renderer, /<PublicMonthCalendar/u);
  assert.match(renderer, /<EventCollection/u);
  assert.ok(
    renderer.indexOf("<PublicMonthCalendar") <
      renderer.indexOf("<EventCollection"),
    "the resilient month calendar must remain above the resilient event list",
  );
});

test("failed pages and RSC prefetches do not amplify Meetup refresh load", async () => {
  const worker = await readFile(
    new URL("worker/index.ts", projectRoot),
    "utf8",
  );

  assert.match(worker, /securedResponse\.status < 500/u);
  assert.match(worker, /request\.headers\.get\(["']RSC["']\) === ["']1["']/u);
  assert.match(worker, /requestPathname\.endsWith\(["']\.rsc["']\)/u);
  assert.match(
    worker,
    /if \(securedResponse\.status < 500 && !isRscPrefetch\) \{[\s\S]*?schedulePublicMeetupRefresh\(/u,
  );
});
