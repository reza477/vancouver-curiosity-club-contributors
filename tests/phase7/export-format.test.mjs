import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCsv,
  buildIcalendar,
  escapeIcsText,
  foldIcsLine,
  ICS_SEQUENCE_MAX,
  neutralizeSpreadsheetFormula,
  sanitizeDownloadFilename,
} from "../../lib/server/phase7/export-format.ts";

test("emits one timed public event with CRLF, UTC values, escaping, and cancellation", () => {
  const calendar = buildIcalendar(
    [
      {
        uid: "opaque-event@example.invalid",
        sequence: 7,
        lastModifiedAt: Date.UTC(2026, 6, 1, 2, 3, 4),
        summary: "Books, film; and ideas",
        description: "Line one\nLine two, with a slash \\",
        location: "Room 1; Vancouver",
        status: "cancelled",
        timeZone: "America/Vancouver",
        url: "https://example.invalid/events/books",
        schedule: {
          kind: "timed",
          startsAtUtc: "2026-07-08T02:00:00.000Z",
          endsAtUtc: "2026-07-08T04:00:00.000Z",
        },
      },
    ],
    {
      calendarName: "Vancouver Curiosity Club",
      generatedAt: Date.UTC(2026, 6, 1, 1, 2, 3),
    },
  );

  assert.match(calendar, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/u);
  assert.match(calendar, /METHOD:PUBLISH\r\n/u);
  assert.match(calendar, /DTSTART:20260708T020000Z\r\n/u);
  assert.match(calendar, /DTEND:20260708T040000Z\r\n/u);
  assert.match(calendar, /X-VCC-TIMEZONE:America\/Vancouver\r\n/u);
  assert.match(calendar, /SUMMARY:Books\\, film\\; and ideas\r\n/u);
  assert.match(
    calendar,
    /DESCRIPTION:Line one\\nLine two\\, with a slash \\\\\r\n/u,
  );
  assert.match(calendar, /STATUS:CANCELLED\r\n/u);
  assert.equal(calendar.match(/BEGIN:VEVENT/gu)?.length, 1);
  assert.equal(calendar.endsWith("\r\n"), true);
  assert.doesNotMatch(calendar.replaceAll("\r\n", ""), /\r|\n/u);
});

test("emits all-day dates with an exclusive end and no invented UTC time", () => {
  const calendar = buildIcalendar(
    [
      {
        uid: "all-day@example.invalid",
        sequence: 0,
        lastModifiedAt: 1,
        summary: "Field trip",
        description: null,
        location: null,
        status: "confirmed",
        timeZone: "America/Vancouver",
        url: "https://example.invalid/events/field-trip",
        schedule: {
          kind: "all_day",
          startDate: "2026-08-01",
          endDateExclusive: "2026-08-03",
        },
      },
    ],
    { calendarName: "Events", generatedAt: 1 },
  );
  assert.match(calendar, /DTSTART;VALUE=DATE:20260801\r\n/u);
  assert.match(calendar, /DTEND;VALUE=DATE:20260803\r\n/u);
  assert.doesNotMatch(calendar, /DTSTART:.*Z/u);
});

test("folds UTF-8 lines at 75 octets without splitting a code point", () => {
  const folded = foldIcsLine(`DESCRIPTION:${"é".repeat(80)}`);
  const physicalLines = folded.split("\r\n");
  const encoder = new TextEncoder();
  for (const line of physicalLines) {
    assert.ok(encoder.encode(line).byteLength <= 75);
    assert.doesNotMatch(line, /\uFFFD/u);
  }
  assert.equal(
    folded.replaceAll("\r\n ", ""),
    `DESCRIPTION:${"é".repeat(80)}`,
  );
});

test("escapes iCalendar text fields", () => {
  assert.equal(
    escapeIcsText("a\\b,c;d\r\ne"),
    "a\\\\b\\,c\\;d\\ne",
  );
});

test("emits RFC 4180 CSV and neutralizes spreadsheet formulas in every cell", () => {
  const csv = buildCsv(
    ["title", "note"],
    [
      ["=2+2", 'Comma, quote " and\nnewline'],
      ["+SUM(A1:A2)", "@run"],
      ["-1+2", "\tformula"],
      ["safe", "\rformula"],
    ],
  );
  assert.equal(
    csv,
    [
      "title,note",
      "'=2+2,\"Comma, quote \"\" and\nnewline\"",
      "'+SUM(A1:A2),'@run",
      "'-1+2,'\tformula",
      "safe,\"'\rformula\"",
      "",
    ].join("\r\n"),
  );
  for (const prefix of ["=", "+", "-", "@", "\t", "\r"]) {
    assert.equal(neutralizeSpreadsheetFormula(`${prefix}x`), `'${prefix}x`);
  }
});

test("emits explicit confirmed/tentative statuses and enforces the signed sequence bound", () => {
  const statusCalendar = buildIcalendar(
    ["confirmed", "tentative", "completed"].map((status, index) => ({
      description: null,
      lastModifiedAt: 2_300_000_000_000 + index * 1_000,
      location: null,
      schedule: {
        kind: "timed",
        startsAtUtc: "2042-01-02T03:04:05.000Z",
        endsAtUtc: "2042-01-02T04:04:05.000Z",
      },
      sequence: index,
      status,
      summary: `${status} event`,
      timeZone: "America/Vancouver",
      uid: `${status}@example.invalid`,
      url: `https://example.invalid/events/${status}`,
    })),
    { calendarName: "Status", generatedAt: 2_300_000_000_000 },
  );
  assert.equal(statusCalendar.match(/STATUS:CONFIRMED\r\n/gu)?.length, 2);
  assert.equal(statusCalendar.match(/STATUS:TENTATIVE\r\n/gu)?.length, 1);
  assert.throws(
    () =>
      buildIcalendar(
        [
          {
            description: null,
            lastModifiedAt: 1,
            location: null,
            schedule: {
              kind: "timed",
              startsAtUtc: "2026-07-01T00:00:00.000Z",
              endsAtUtc: "2026-07-01T01:00:00.000Z",
            },
            sequence: ICS_SEQUENCE_MAX + 1,
            status: "confirmed",
            summary: "Out of range",
            timeZone: "America/Vancouver",
            uid: "out-of-range@example.invalid",
            url: "https://example.invalid/events/out-of-range",
          },
        ],
        { calendarName: "Test", generatedAt: 1 },
      ),
    /signed 32-bit/u,
  );
});

test("sanitizes attachment filenames without path or header characters", () => {
  assert.equal(
    sanitizeDownloadFilename("../../Events July\r\n.csv", "events.csv"),
    "..-..-Events-July-.csv",
  );
  assert.equal(sanitizeDownloadFilename("💥", "events.csv"), "events.csv");
});
