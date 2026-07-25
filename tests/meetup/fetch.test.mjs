import assert from "node:assert/strict";
import test from "node:test";
import {
  MeetupSyncError,
  fetchMeetupCalendar,
} from "../../lib/server/meetup/index.ts";

const MEETUP_ORIGIN = "https://www.meetup.com/";
const ICAL_PATH = ["events", "ical", ""].join("/");
const feedUrl = new URL(ICAL_PATH, `${MEETUP_ORIGIN}example-group/`).href;
const otherFeedUrl = new URL(
  ICAL_PATH,
  `${MEETUP_ORIGIN}other-example-group/`,
).href;

test("manually validates every redirect and preserves conditional headers", async () => {
  const requests = [];
  const result = await fetchMeetupCalendar(feedUrl, {
    etag: '"old"',
    httpLastModified: "Wed, 22 Jul 2026 01:00:00 GMT",
    fetcher: async (url, init) => {
      requests.push({ url: String(url), init });
      if (requests.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: feedUrl },
        });
      }
      return new Response("BEGIN:VCALENDAR\nEND:VCALENDAR", {
        status: 200,
        headers: {
          "content-type": "text/calendar; charset=utf-8",
          etag: '"new"',
        },
      });
    },
  });
  assert.equal(result.status, "ok");
  assert.equal(result.etag, '"new"');
  assert.equal(requests[0].init.redirect, "manual");
  assert.equal(requests[1].init.headers.get("if-none-match"), '"old"');
});

test("rejects cross-group redirects and oversized streamed responses", async () => {
  await assert.rejects(
    fetchMeetupCalendar(feedUrl, {
      fetcher: async () =>
        new Response(null, {
          status: 302,
          headers: {
            location: otherFeedUrl,
          },
        }),
    }),
    (error) =>
      error instanceof MeetupSyncError &&
      error.code === "redirect_rejected",
  );

  await assert.rejects(
    fetchMeetupCalendar(feedUrl, {
      maxBytes: 32,
      fetcher: async () =>
        new Response("x".repeat(33), {
          status: 200,
          headers: { "content-type": "text/calendar" },
        }),
    }),
    (error) =>
      error instanceof MeetupSyncError &&
      error.code === "response_too_large",
  );
});
