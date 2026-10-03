import assert from "node:assert/strict";
import test from "node:test";
import {
  isPublicEventWithinMeetupWindow,
  publicMeetupPublicationWindow,
} from "../../lib/public-event-publication-window.ts";
import { localDateTimeToUtcMs } from "../../lib/time/index.ts";

const eventUrl = "https://www.meetup.com/vancouver-meetup-group/events/316683305/";
const local = (value) => localDateTimeToUtcMs(value, "America/Vancouver", "earlier");
const timed = (start, rsvpUrl = eventUrl) => ({
  rsvpUrl,
  schedule: { kind: "timed", startsAtUtc: new Date(local(start)).toISOString() },
});

test("five-week horizon uses Vancouver dates and excludes its exact final midnight", () => {
  // Already October 4 in UTC, but still October 3 in Vancouver.
  const now = Date.parse("2026-10-04T01:00:00Z");
  assert.deepEqual(publicMeetupPublicationWindow(now), {
    endDateExclusive: "2026-11-07",
    endsAtUtcMs: local("2026-11-07T00:00"),
  });
  assert.equal(isPublicEventWithinMeetupWindow(timed("2026-11-06T23:59:59"), now), true);
  assert.equal(isPublicEventWithinMeetupWindow(timed("2026-11-07T00:00"), now), false);
});

test("the same stored future occurrence enters the window on the next local day", () => {
  const event = timed("2026-11-07T17:30");
  assert.equal(isPublicEventWithinMeetupWindow(event, local("2026-10-03T23:59")), false);
  assert.equal(isPublicEventWithinMeetupWindow(event, local("2026-10-04T00:00")), true);
});

test("all-day starts follow the same rolling bound across year boundaries", () => {
  const now = local("2026-12-15T12:00");
  assert.equal(publicMeetupPublicationWindow(now).endDateExclusive, "2027-01-19");
  const event = (startDate) => ({ rsvpUrl: eventUrl, schedule: { kind: "all_day", startDate } });
  assert.equal(isPublicEventWithinMeetupWindow(event("2027-01-18"), now), true);
  assert.equal(isPublicEventWithinMeetupWindow(event("2027-01-19"), now), false);
});

test("official group scope preserves manual events and ordinary archive eligibility", () => {
  const now = local("2026-10-03T12:00");
  const distant = timed("2027-01-01T12:00");
  for (const group of ["vancouver-meetup-group", "vancouver-literature-and-film", "vancouver-fantasy-scifi-meetup-group"]) {
    assert.equal(isPublicEventWithinMeetupWindow({ ...distant, rsvpUrl: `https://www.meetup.com/${group}/events/123/` }, now), false);
  }
  assert.equal(isPublicEventWithinMeetupWindow({ ...distant, rsvpUrl: null }, now), true);
  assert.equal(isPublicEventWithinMeetupWindow({ ...distant, rsvpUrl: "https://www.meetup.com/synthetic-public-group/events/123/" }, now), true);
  assert.equal(isPublicEventWithinMeetupWindow(timed("2026-09-01T12:00"), now), true);
});
