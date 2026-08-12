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

test("removing the archive dead end preserves calendar, month, and lane discovery", async () => {
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
  assert.match(renderer, /aria-label="Filter events by activity lane"/u);
  assert.match(renderer, /PUBLIC_CATALOG_LANES\.map/u);
  assert.match(renderer, /<PublicMonthCalendar/u);
  assert.match(
    calendar,
    /href=\{calendarHref\(previousMonth, calendarRoute, laneSlug\)\}/u,
  );
  assert.match(
    calendar,
    /href=\{calendarHref\(nextMonth, calendarRoute, laneSlug\)\}/u,
  );
  assert.match(calendar, /month=\$\{encodeURIComponent\(month\)\}/u);
  assert.match(calendar, /lane=\$\{encodeURIComponent\(laneSlug\)\}/u);
});
