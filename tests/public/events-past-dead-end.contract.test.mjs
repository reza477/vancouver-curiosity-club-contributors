import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

test("Events does not promote an empty Past Events destination", async () => {
  const [page, renderer] = await Promise.all([
    readFile(new URL("app/events/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/_components/EventsPageRenderer.tsx", projectRoot),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(
    page,
    /raw\.state|values\.state|eventListValues/u,
    "legacy state parameters must not switch Events into an empty archive view",
  );
  assert.doesNotMatch(
    renderer,
    /Past Events|state=past|state=upcoming|Event timeframe|>\s*Past\s*</u,
    "Events must not present a prominent Past Events dead end before an archive exists",
  );
});

test("removing the archive and lane-filter controls preserves calendar discovery and direct lane URLs", async () => {
  const [page, renderer, calendar] = await Promise.all([
    readFile(new URL("app/events/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/_components/EventsPageRenderer.tsx", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("app/_components/PublicMonthCalendar.tsx", projectRoot),
      "utf8",
    ),
  ]);

  assert.match(page, /loadPublicEventsPageData/u);
  assert.doesNotMatch(
    renderer,
    /events-page__lane-filters|Filter events by activity lane|PUBLIC_CATALOG_LANES/u,
  );
  assert.match(renderer, /<PublicMonthCalendar/u);
  assert.match(
    calendar,
    /href=\{publicEventsHref\(\{\s*clubSlug,\s*laneSlug,\s*month: previousMonth,\s*route: calendarRoute,\s*view: "calendar",\s*\}\)\}/u,
  );
  assert.match(
    calendar,
    /href=\{publicEventsHref\(\{\s*clubSlug,\s*laneSlug,\s*month: nextMonth,\s*route: calendarRoute,\s*view: "calendar",\s*\}\)\}/u,
  );
});
