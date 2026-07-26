import assert from "node:assert/strict";
import test from "node:test";
import {
  mapLegacyPlanningStatus,
  mapLegacyPublicationStatus,
  parsePhase3ManualEventInput,
} from "../../lib/server/organizer/lifecycle.ts";

const base = Object.freeze({
  title: "A private planning record",
  clubId: "club:test",
  primaryOrganizerProfileId: "profile:owner",
  coOrganizerProfileIds: [],
  planningStatus: "idea",
  publicationStatus: "private",
  scheduleShape: "unscheduled",
  timeZone: "America/Vancouver",
});

test("an unscheduled Idea persists no invented date or UTC instant", () => {
  const parsed = parsePhase3ManualEventInput(base);
  assert.deepEqual(parsed.schedule, {
    shape: "unscheduled",
    timeZone: "America/Vancouver",
    startsAtUtc: null,
    endsAtUtc: null,
    allDayStartDate: null,
    allDayEndDateExclusive: null,
  });
});

test("a Draft must be timed or all-day and invalid shapes fail safely", () => {
  assert.throws(
    () =>
      parsePhase3ManualEventInput({
        ...base,
        planningStatus: "draft",
      }),
    /validated/u,
  );
  assert.throws(
    () =>
      parsePhase3ManualEventInput({
        ...base,
        scheduleShape: "timed",
        startLocal: "2025-11-02T01:30",
        endLocal: "2025-11-02T02:30",
      }),
    /validated/u,
    "ambiguous Vancouver fall-back time requires explicit handling",
  );
  assert.throws(
    () =>
      parsePhase3ManualEventInput({
        ...base,
        scheduleShape: "all_day",
        allDayStartDate: "2028-02-29",
        allDayEndDateExclusive: "2028-02-29",
      }),
    /validated/u,
  );
});

test("timed and all-day schedules retain their canonical shapes", () => {
  const overnight = parsePhase3ManualEventInput({
    ...base,
    planningStatus: "draft",
    scheduleShape: "timed",
    startLocal: "2026-07-25T23:30",
    endLocal: "2026-07-26T01:15",
  });
  assert.equal(overnight.schedule.shape, "timed");
  assert.equal(
    overnight.schedule.endsAtUtc - overnight.schedule.startsAtUtc,
    105 * 60_000,
  );

  const leapDay = parsePhase3ManualEventInput({
    ...base,
    planningStatus: "draft",
    scheduleShape: "all_day",
    allDayStartDate: "2028-02-29",
    allDayEndDateExclusive: "2028-03-02",
  });
  assert.deepEqual(leapDay.schedule, {
    shape: "all_day",
    timeZone: "America/Vancouver",
    startsAtUtc: null,
    endsAtUtc: null,
    allDayStartDate: "2028-02-29",
    allDayEndDateExclusive: "2028-03-02",
  });
});

test("Phase 3 parser rejects every reserving or publication lifecycle value", () => {
  for (const planningStatus of [
    "tentative_hold",
    "confirmed",
    "cancelled",
    "completed",
    "archived",
  ]) {
    assert.throws(
      () => parsePhase3ManualEventInput({ ...base, planningStatus }),
      /validated/u,
      planningStatus,
    );
  }
  for (const publicationStatus of [
    "scheduled",
    "published",
    "unpublished",
  ]) {
    assert.throws(
      () => parsePhase3ManualEventInput({ ...base, publicationStatus }),
      /validated/u,
      publicationStatus,
    );
  }
});

test("legacy lifecycle mapping is explicit and published_at is authoritative", () => {
  assert.deepEqual(
    ["idea", "draft", "hold", "tentative", "confirmed", "cancelled", "archived"].map(
      mapLegacyPlanningStatus,
    ),
    [
      "idea",
      "draft",
      "tentative_hold",
      "tentative_hold",
      "confirmed",
      "cancelled",
      "archived",
    ],
  );
  assert.equal(mapLegacyPublicationStatus("private", null), "private");
  assert.equal(
    mapLegacyPublicationStatus("private", 1_800_000_000_000),
    "private",
  );
  assert.equal(
    mapLegacyPublicationStatus("public", 1_800_000_000_000),
    "published",
  );
});

test("manual Meetup URLs are normalized without creating source identity", () => {
  const parsed = parsePhase3ManualEventInput({
    ...base,
    meetupEventUrl:
      "https://www.meetup.com/example-group/events/123/?utm_source=test#fragment",
  });
  assert.equal(
    parsed.meetupEventUrl,
    "https://www.meetup.com/example-group/events/123/",
  );
  assert.throws(
    () =>
      parsePhase3ManualEventInput({
        ...base,
        meetupEventUrl: "https://example.com/events/123/",
      }),
    /validated/u,
  );
});
