import assert from "node:assert/strict";
import test from "node:test";
import {
  MeetupSyncError,
  parseMeetupGroupCalendarFeedUrl,
  parseMeetupIcs,
} from "../../lib/server/meetup/index.ts";

const calendar = (events, method = "PUBLISH") => `BEGIN:VCALENDAR
VERSION:2.0
METHOD:${method}
BEGIN:VTIMEZONE
TZID:America/Los_Angeles
BEGIN:STANDARD
DTSTART:19701101T020000
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700308T020000
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
END:DAYLIGHT
END:VTIMEZONE
${events}
END:VCALENDAR`;

const event = ({
  extra = "",
  recurrence = "",
  sequence = 2,
  status = "CONFIRMED",
  uid = "event-123@meetup.com",
} = {}) => `BEGIN:VEVENT
UID:${uid}
${recurrence}
DTSTART;TZID=America/Los_Angeles:20261110T190000
DTEND;TZID=America/Los_Angeles:20261110T210000
SUMMARY:Curious Vancouver
DESCRIPTION:Text only\\nSecond line
LOCATION:Public Library
URL:https://www.meetup.com/vancouver-curiosity-club/events/123456789/
STATUS:${status}
SEQUENCE:${sequence}
LAST-MODIFIED:20260724T020000Z
${extra}
END:VEVENT`;

test("skips bounded VTIMEZONE components and preserves event TZID fidelity", () => {
  const parsed = parseMeetupIcs(calendar(event()));
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.rejectedEvents.length, 0);
  assert.equal(parsed.events[0].schedule.kind, "timed");
  assert.equal(parsed.events[0].schedule.timeZone, "America/Los_Angeles");
  assert.equal(
    new Date(parsed.events[0].schedule.startsAtUtcMs).toISOString(),
    "2026-11-11T03:00:00.000Z",
  );
  assert.equal(parsed.events[0].description, "Text only\nSecond line");
  assert.equal(parsed.events[0].location, "Public Library");
});

test("uses UID plus normalized RECURRENCE-ID and rejects unexpanded recurrence", () => {
  const first = event({
    recurrence:
      "RECURRENCE-ID;TZID=America/Los_Angeles:20261110T190000",
  });
  const second = event({
    recurrence:
      "RECURRENCE-ID;TZID=America/Los_Angeles:20261117T190000",
  });
  const recurring = event({
    extra: "RRULE:FREQ=WEEKLY;COUNT=4",
    uid: "series@meetup.com",
  });
  const parsed = parseMeetupIcs(calendar(`${first}\n${second}\n${recurring}`));
  assert.equal(parsed.events.length, 2);
  assert.notEqual(parsed.events[0].sourceKey, parsed.events[1].sourceKey);
  assert.deepEqual(parsed.rejectedEvents, [
    { componentIndex: 2, errorCode: "unsupported_recurrence" },
  ]);
});

test("honors explicit event and calendar cancellation", () => {
  const eventCancellation = parseMeetupIcs(
    calendar(event({ status: "CANCELLED" })),
  );
  assert.equal(eventCancellation.events[0].status, "cancelled");

  const calendarCancellation = parseMeetupIcs(
    calendar(event(), "CANCEL"),
  );
  assert.equal(calendarCancellation.events[0].status, "cancelled");
});

test("accepts only exact official group export and event URLs", () => {
  const calendarPath = ["events", "ical"].join("/");
  const inputFeedUrl = new URL(
    calendarPath,
    "https://meetup.com/example-group/",
  ).href;
  const canonicalFeedUrl = new URL(
    `${calendarPath}/`,
    "https://www.meetup.com/example-group/",
  ).href;
  assert.deepEqual(
    parseMeetupGroupCalendarFeedUrl(inputFeedUrl),
    {
      groupSlug: "example-group",
      url: canonicalFeedUrl,
    },
  );
  for (const invalid of [
    new URL(`${calendarPath}/`, "http://www.meetup.com/group/").href,
    `${new URL(`${calendarPath}/`, "https://www.meetup.com/group/").href}?token=secret`,
    new URL(`${calendarPath}/`, "https://evil.example/group/").href,
    "https://www.meetup.com/group/events/123/",
  ]) {
    assert.throws(() => parseMeetupGroupCalendarFeedUrl(invalid));
  }

  const invalidEventUrl = event().replace(
    "https://www.meetup.com/vancouver-curiosity-club/events/123456789/",
    "https://127.0.0.1/private",
  );
  assert.throws(
    () => parseMeetupIcs(calendar(invalidEventUrl)),
    MeetupSyncError,
  );
});

test("enforces byte, event, and component nesting bounds", () => {
  assert.throws(
    () => parseMeetupIcs(calendar(event()), { maxBytes: 64 }),
    MeetupSyncError,
  );
  assert.throws(
    () => parseMeetupIcs(calendar(`${event()}\n${event({ uid: "b" })}`), {
      maxEvents: 1,
    }),
    MeetupSyncError,
  );
  assert.throws(
    () =>
      parseMeetupIcs(`BEGIN:VCALENDAR
BEGIN:VTIMEZONE
BEGIN:STANDARD
END:VTIMEZONE
END:STANDARD
END:VCALENDAR`),
    MeetupSyncError,
  );
});
