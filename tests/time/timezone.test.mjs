import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TIME_ZONE,
  calendarDateInTimeZone,
  isValidIanaTimeZone,
  localDateTimeToUtcMs,
  normalizeAllDayEventRange,
  normalizeTimedEventRange,
  parseCalendarDate,
} from "../../lib/time/index.ts";
import { InputValidationError } from "../../lib/validation/index.ts";

test("defaults to the Vancouver IANA zone and follows winter/summer offsets", () => {
  assert.equal(DEFAULT_TIME_ZONE, "America/Vancouver");

  const winter = normalizeTimedEventRange({
    startLocal: "2026-01-15T18:00",
    endLocal: "2026-01-15T20:00",
  });
  assert.equal(winter.startsAtUtc, "2026-01-16T02:00:00.000Z");
  assert.equal(winter.endsAtUtc, "2026-01-16T04:00:00.000Z");

  const summer = normalizeTimedEventRange({
    startLocal: "2026-07-15T18:00",
    endLocal: "2026-07-15T20:00",
  });
  assert.equal(summer.startsAtUtc, "2026-07-16T01:00:00.000Z");
  assert.equal(summer.endsAtUtc, "2026-07-16T03:00:00.000Z");
});

test("rejects nonexistent DST time and requires explicit fall-back disambiguation", () => {
  assert.throws(
    () =>
      localDateTimeToUtcMs(
        "2025-03-09T02:30",
        "America/Vancouver",
      ),
    InputValidationError,
  );
  assert.throws(
    () =>
      localDateTimeToUtcMs(
        "2025-11-02T01:30",
        "America/Vancouver",
      ),
    InputValidationError,
  );

  const earlier = localDateTimeToUtcMs(
    "2025-11-02T01:30",
    "America/Vancouver",
    "earlier",
  );
  const later = localDateTimeToUtcMs(
    "2025-11-02T01:30",
    "America/Vancouver",
    "later",
  );
  assert.equal(later - earlier, 60 * 60_000);
});

test("normalizes overnight and multi-day timed events as UTC instants", () => {
  const overnight = normalizeTimedEventRange({
    startLocal: "2026-07-23T22:00",
    endLocal: "2026-07-24T01:00",
    timeZone: "America/Vancouver",
  });
  assert.equal(overnight.endsAtUtcMs - overnight.startsAtUtcMs, 3 * 60 * 60_000);

  const multiDay = normalizeTimedEventRange({
    startLocal: "2026-07-23T18:00",
    endLocal: "2026-07-26T18:00",
    timeZone: "America/Vancouver",
  });
  assert.equal(
    multiDay.endsAtUtcMs - multiDay.startsAtUtcMs,
    72 * 60 * 60_000,
  );
});

test("keeps all-day events as calendar dates with an exclusive end", () => {
  assert.deepEqual(
    normalizeAllDayEventRange({
      startDate: "2026-07-23",
      endDateExclusive: "2026-07-24",
    }),
    {
      kind: "all_day",
      startDate: "2026-07-23",
      endDateExclusive: "2026-07-24",
    },
  );
  assert.deepEqual(
    normalizeAllDayEventRange({
      startDate: "2026-07-23",
      endDateExclusive: "2026-07-27",
    }),
    {
      kind: "all_day",
      startDate: "2026-07-23",
      endDateExclusive: "2026-07-27",
    },
  );
  assert.throws(
    () =>
      normalizeAllDayEventRange({
        startDate: "2026-07-23",
        endDateExclusive: "2026-07-23",
      }),
    InputValidationError,
  );
});

test("rejects invalid zones, dates, end-before-start, and zero duration", () => {
  assert.throws(
    () =>
      normalizeTimedEventRange({
        startLocal: "2026-07-23T18:00",
        endLocal: "2026-07-23T19:00",
        timeZone: "UTC-7",
      }),
    InputValidationError,
  );
  assert.throws(() => parseCalendarDate("2025-02-29"), InputValidationError);
  assert.equal(parseCalendarDate("2024-02-29"), "2024-02-29");

  assert.throws(
    () =>
      normalizeTimedEventRange({
        startLocal: "2026-07-23T19:00",
        endLocal: "2026-07-23T18:00",
      }),
    InputValidationError,
  );
  assert.throws(
    () =>
      normalizeTimedEventRange({
        startLocal: "2026-07-23T18:00",
        endLocal: "2026-07-23T18:00",
      }),
    InputValidationError,
  );
});

test("accepts Intl-recognized zones while still rejecting invented identifiers", () => {
  for (const zone of ["CET", "EET", "GMT", "UTC", "America/Vancouver"]) {
    assert.equal(isValidIanaTimeZone(zone), true, zone);
  }
  for (const zone of ["UTC-7", "America/Not_A_Zone", "", "not a zone"]) {
    assert.equal(isValidIanaTimeZone(zone), false, zone);
  }

  const centralEuropean = normalizeTimedEventRange({
    startLocal: "2026-07-23T18:00",
    endLocal: "2026-07-23T19:00",
    timeZone: "CET",
  });
  assert.equal(centralEuropean.originalTimeZone, "CET");
  assert.equal(
    centralEuropean.endsAtUtcMs - centralEuropean.startsAtUtcMs,
    60 * 60_000,
  );
});

test("derives the Vancouver calendar date from a UTC instant", () => {
  assert.equal(
    calendarDateInTimeZone(
      Date.parse("2026-07-24T05:30:00.000Z"),
      "America/Vancouver",
    ),
    "2026-07-23",
  );
});
