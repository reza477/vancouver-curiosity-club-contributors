import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

test("Events keeps one calendar behind one durable materialization read", async () => {
  const [source, loader, renderer] = await Promise.all([
    readFile(new URL("app/events/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("lib/server/public/events-page.ts", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("app/_components/EventsPageRenderer.tsx", projectRoot),
      "utf8",
    ),
  ]);

  assert.match(source, /loadPublicEventsPageData/u);
  assert.doesNotMatch(
    source,
    /\bqueryPublicEventSlice\b|\bloadPublicMonthCalendar\b/u,
  );
  assert.match(loader, /readPublicEventsPageMaterialization/u);
  assert.doesNotMatch(loader, /eventListAvailable|eventPage|emptyEventPage/u);
  assert.doesNotMatch(
    loader,
    /queryPublicCalendarLandingBundle|loadIndependentEventsCalendar|queryPublicEventSlice|queryPublicCalendarMonth|queryPublicEventMaterializationBundle|writePublicEventsSnapshot|refreshPublicEventMaterializations|database\.batch/u,
    "visitor Events requests must neither project, write, refresh, nor fall back after the indexed materialization read",
  );
  assert.match(renderer, /<PublicMonthCalendar/u);
  assert.doesNotMatch(
    renderer,
    /<EventCollection|<Pagination|Event timeframe|events-page__list/u,
    "the resilient calendar must not repeat its records in a separate list",
  );
});

test("public requests never trigger Meetup refresh work", async () => {
  const [worker, maintenance, publicReader] = await Promise.all([
    readFile(new URL("worker/index.ts", projectRoot), "utf8"),
    readFile(
      new URL(
        "lib/server/database/request-maintenance.ts",
        projectRoot,
      ),
      "utf8",
    ),
    readFile(
      new URL("lib/server/meetup/public.ts", projectRoot),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(
    `${worker}\n${maintenance}\n${publicReader}`,
    /schedulePublicMeetupRefresh|refreshMeetupCalendarSourceIfDue|public_meetup_refresh_|listDefaultPublicMeetupCalendar/u,
  );
  assert.match(publicReader, /listPublicMeetupCalendar/u);
  assert.match(publicReader, /readPublicMeetupSyncState/u);
});
