import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CSV_IMPORT_CANONICAL_COLUMNS,
  CSV_IMPORT_IGNORE,
  CSV_IMPORT_MAX_CELL_CHARACTERS,
  CSV_IMPORT_MAX_COLUMNS,
  CSV_IMPORT_MAX_DATA_ROWS,
  CSV_IMPORT_MAX_FILE_BYTES,
  automaticCsvHeaderSelections,
  createCsvImportHeaderMapping,
  normalizeCsvImport,
  parseCsvImportBytes,
  parseCsvSourceNamespace,
  validateCsvImportUploadMetadata,
} from "../../lib/imports/csv.ts";
import { InputValidationError } from "../../lib/validation/index.ts";

const encoder = new TextEncoder();

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

function csvBytes(headers, rows, options = {}) {
  const eol = options.eol ?? "\r\n";
  const source = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join(eol);
  return encoder.encode(`${options.bom ? "\uFEFF" : ""}${source}`);
}

function canonicalRow(overrides = {}) {
  const row = Object.fromEntries(
    CSV_IMPORT_CANONICAL_COLUMNS.map((column) => [column, ""]),
  );
  return {
    ...row,
    title: "A private test gathering",
    club: "test-club",
    schedule_type: "timed",
    start_date: "2026-01-15",
    start_time: "18:00",
    end_date: "2026-01-15",
    end_time: "20:00",
    planning_status: "draft",
    primary_organizer_email: "owner@example.invalid",
    attendance_mode: "in_person",
    ...overrides,
  };
}

function canonicalValues(row) {
  return CSV_IMPORT_CANONICAL_COLUMNS.map((column) => row[column] ?? "");
}

async function normalizeRows(rows, options = {}) {
  const headers = options.headers ?? CSV_IMPORT_CANONICAL_COLUMNS;
  const bytes = csvBytes(
    headers,
    rows.map((row) =>
      Array.isArray(row)
        ? row
        : headers.map((header) => row[header] ?? ""),
    ),
    options,
  );
  const parsed = parseCsvImportBytes(bytes, {
    fileName: "events.csv",
    contentType: "text/csv; charset=utf-8",
  });
  const mapping = createCsvImportHeaderMapping(
    parsed.headers,
    options.selections,
  );
  return normalizeCsvImport(parsed, mapping);
}

function issueCodes(row) {
  return row.issues.map((issue) => issue.code);
}

test("ships a versioned UTF-8 template with the exact canonical header", async () => {
  const template = await readFile(
    new URL(
      "../../public/templates/vcc-event-import-v1.csv",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(
    template.trimEnd(),
    CSV_IMPORT_CANONICAL_COLUMNS.join(","),
  );
  const parsed = parseCsvImportBytes(encoder.encode(template));
  assert.deepEqual(parsed.headers, CSV_IMPORT_CANONICAL_COLUMNS);
  assert.equal(parsed.nonblankRowCount, 0);
});

test("validates local CSV upload envelopes without trusting generic MIME", () => {
  assert.doesNotThrow(() =>
    validateCsvImportUploadMetadata({
      fileName: "events.csv",
      contentType: "text/csv; charset=utf-8",
      size: 42,
    }),
  );
  assert.doesNotThrow(() =>
    validateCsvImportUploadMetadata({
      fileName: "events.CSV",
      contentType: "application/octet-stream",
      size: 42,
    }),
  );
  for (const metadata of [
    {
      fileName: "https://example.invalid/events.csv",
      contentType: "text/csv",
      size: 42,
    },
    {
      fileName: "events.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 42,
    },
    {
      fileName: "events.csv",
      contentType: "application/json",
      size: 42,
    },
    {
      fileName: "events.csv",
      contentType: "text/csv",
      size: CSV_IMPORT_MAX_FILE_BYTES + 1,
    },
  ]) {
    assert.throws(
      () => validateCsvImportUploadMetadata(metadata),
      InputValidationError,
    );
  }
  assert.equal(parseCsvSourceNamespace("  Owner-July.2026  "), "owner-july.2026");
  assert.throws(
    () => parseCsvSourceNamespace("https://example.invalid/feed"),
    InputValidationError,
  );
});

test("parses UTF-8 BOM and RFC 4180 quotes, commas, escaped quotes, and newlines", async () => {
  const first = canonicalRow({
    title: 'Books, film, and "serious discussion"',
    notes: "First line\r\nSecond line",
  });
  const bytes = csvBytes(
    CSV_IMPORT_CANONICAL_COLUMNS,
    [
      canonicalValues(first),
      Array(CSV_IMPORT_CANONICAL_COLUMNS.length).fill(""),
      canonicalValues(canonicalRow({ title: "After the blank row" })),
    ],
    { bom: true },
  );
  const parsed = parseCsvImportBytes(bytes);
  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.records[0].sourceRowNumber, 2);
  assert.equal(parsed.records[0].values[1], first.title);
  assert.equal(parsed.records[0].values[22], "First line\nSecond line");
  assert.equal(parsed.records[1].blank, true);
  assert.equal(parsed.records[1].sourceRowNumber, 4);
  assert.equal(parsed.records[2].sourceRowNumber, 5);

  const normalized = await normalizeCsvImport(
    parsed,
    createCsvImportHeaderMapping(parsed.headers),
  );
  assert.equal(normalized.validRowCount, 2);
  assert.equal(normalized.blankRowCount, 1);
  assert.equal(normalized.rows[0].normalized.privateNotes, "First line\nSecond line");
  assert.match(normalized.rows[0].normalizedRowFingerprint, /^[a-f0-9]{64}$/u);
});

test("rejects malformed bytes, NUL, duplicate headers, bad quotes, and non-CSV magic", () => {
  assert.throws(
    () => parseCsvImportBytes(Uint8Array.from([0xc3, 0x28])),
    (error) =>
      error instanceof InputValidationError &&
      error.issues[0].code === "invalid_utf8",
  );
  assert.throws(
    () => parseCsvImportBytes(encoder.encode("title,club\u0000\nx,y")),
    (error) =>
      error instanceof InputValidationError &&
      error.issues[0].code === "csv_nul_byte",
  );
  assert.throws(
    () => parseCsvImportBytes(encoder.encode("title, TITLE \nx,y")),
    (error) =>
      error instanceof InputValidationError &&
      error.issues[0].code === "duplicate_csv_header",
  );
  assert.throws(
    () => parseCsvImportBytes(encoder.encode('title\n"unterminated')),
    (error) =>
      error instanceof InputValidationError &&
      error.issues[0].code === "unterminated_csv_quote",
  );
  assert.throws(
    () => parseCsvImportBytes(encoder.encode('title\n"value" trailing')),
    (error) =>
      error instanceof InputValidationError &&
      error.issues[0].code === "invalid_csv_quote",
  );
  assert.throws(
    () => parseCsvImportBytes(encoder.encode("PK\u0003\u0004not-a-csv")),
    (error) =>
      error instanceof InputValidationError &&
      error.issues[0].code === "invalid_csv_content",
  );
});

test("rejects leading HTML, XML, SVG, ICS, and JSON document signatures", () => {
  for (const source of [
    "\uFEFF \t\r\n<!DoCtYpE HTML><title>not csv</title>",
    " \n<HTML lang=\"en\"><body>not csv</body></HTML>",
    "\r\n<?XmL version=\"1.0\"?><events />",
    " \t<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
    "\n<events><event /></events>",
    "\uFEFF \r\nBEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR",
    ' \n{"events":[]}',
    "\t[1,2,3]",
    "\r\ntrue",
    " false ",
    "\nnull",
    " 42 ",
    ' "standalone JSON string" ',
  ]) {
    assert.throws(
      () => parseCsvImportBytes(encoder.encode(source)),
      (error) =>
        error instanceof InputValidationError &&
        error.issues[0].code === "non_csv_document_signature",
    );
  }

  const quotedHeader = parseCsvImportBytes(
    encoder.encode('"<html>",title\n"literal header-like text",safe'),
  );
  assert.deepEqual(quotedHeader.headers, ["<html>", "title"]);
  const quotedCell = parseCsvImportBytes(
    encoder.encode(
      'title,notes\nsafe,"<?xml version=""1.0""?>"\ncalendar,"BEGIN:VCALENDAR"\njson,"{""events"":[]}"',
    ),
  );
  assert.equal(quotedCell.records[0].values[1], '<?xml version="1.0"?>');
  assert.equal(quotedCell.records[1].values[1], "BEGIN:VCALENDAR");
  assert.equal(quotedCell.records[2].values[1], '{"events":[]}');
});

test("enforces column, row, cell, and file bounds", () => {
  assert.throws(
    () =>
      parseCsvImportBytes(
        csvBytes(
          Array.from(
            { length: CSV_IMPORT_MAX_COLUMNS + 1 },
            (_, index) => `column_${index}`,
          ),
          [],
        ),
      ),
    (error) =>
      error instanceof InputValidationError &&
      error.issues[0].code === "too_many_csv_columns",
  );

  const tooManyRows = Array.from(
    { length: CSV_IMPORT_MAX_DATA_ROWS + 1 },
    () => ["value"],
  );
  assert.throws(
    () => parseCsvImportBytes(csvBytes(["value"], tooManyRows)),
    (error) =>
      error instanceof InputValidationError &&
      error.issues[0].code === "too_many_csv_rows",
  );
  assert.throws(
    () =>
      parseCsvImportBytes(
        csvBytes(
          ["value"],
          [["x".repeat(CSV_IMPORT_MAX_CELL_CHARACTERS + 1)]],
        ),
      ),
    (error) =>
      error instanceof InputValidationError &&
      error.issues[0].code === "csv_cell_too_large",
  );
  assert.throws(
    () =>
      parseCsvImportBytes(
        new Uint8Array(CSV_IMPORT_MAX_FILE_BYTES + 1).fill(0x61),
      ),
    InputValidationError,
  );
});

test("retains row-numbered column-count errors for preview instead of shifting records", async () => {
  const parsed = parseCsvImportBytes(
    encoder.encode(
      `${CSV_IMPORT_CANONICAL_COLUMNS.join(",")}\n${canonicalValues(
        canonicalRow(),
      )
        .slice(0, -1)
        .join(",")}`,
    ),
  );
  assert.equal(parsed.records[0].sourceRowNumber, 2);
  assert.deepEqual(issueCodes(parsed.records[0]), [
    "csv_column_count_mismatch",
  ]);
  const normalized = await normalizeCsvImport(
    parsed,
    createCsvImportHeaderMapping(parsed.headers),
  );
  assert.equal(normalized.invalidRowCount, 1);
  assert.equal(normalized.rows[0].normalized, null);
});

test("validates blank-looking row shape before treating a record as skippable", () => {
  const matchingBlank = parseCsvImportBytes(
    encoder.encode("first,second\n,"),
  );
  assert.equal(matchingBlank.records[0].blank, true);
  assert.equal(matchingBlank.records[0].sourceRowNumber, 2);

  const mismatchedBlank = parseCsvImportBytes(
    encoder.encode("first,second\n,,"),
  );
  assert.equal(mismatchedBlank.records[0].blank, false);
  assert.equal(mismatchedBlank.records[0].sourceRowNumber, 2);
  assert.deepEqual(issueCodes(mismatchedBlank.records[0]), [
    "csv_column_count_mismatch",
  ]);

  const fortyHeaders = Array.from(
    { length: CSV_IMPORT_MAX_COLUMNS },
    (_, index) => `column_${index}`,
  );
  const overwideBlank = parseCsvImportBytes(
    csvBytes(fortyHeaders, [
      Array(CSV_IMPORT_MAX_COLUMNS + 1).fill(""),
    ]),
  );
  assert.equal(overwideBlank.records[0].blank, false);
  assert.equal(overwideBlank.records[0].sourceRowNumber, 2);
  assert.deepEqual(issueCodes(overwideBlank.records[0]), [
    "too_many_csv_columns",
    "csv_column_count_mismatch",
  ]);
});

test("maps exact official headers automatically and validates explicit Ignore choices", () => {
  const automatic = automaticCsvHeaderSelections([
    "title",
    "Uploaded notes",
    "club",
    "schedule_type",
    "planning_status",
    "primary_organizer_email",
    "attendance_mode",
  ]);
  assert.deepEqual(automatic, [
    "title",
    CSV_IMPORT_IGNORE,
    "club",
    "schedule_type",
    "planning_status",
    "primary_organizer_email",
    "attendance_mode",
  ]);

  const headers = [
    "Event title",
    "Club",
    "Schedule",
    "State",
    "Host",
    "Mode",
    "Unused",
  ];
  const mapping = createCsvImportHeaderMapping(headers, [
    "title",
    "club",
    "schedule_type",
    "planning_status",
    "primary_organizer_email",
    "attendance_mode",
    CSV_IMPORT_IGNORE,
  ]);
  assert.equal(mapping.at(-1).canonicalField, null);
  assert.throws(
    () =>
      createCsvImportHeaderMapping(headers, [
        "title",
        "title",
        "schedule_type",
        "planning_status",
        "primary_organizer_email",
        "attendance_mode",
        CSV_IMPORT_IGNORE,
      ]),
    (error) =>
      error instanceof InputValidationError &&
      error.issues[0].code === "duplicate_mapping",
  );
  assert.throws(
    () =>
      createCsvImportHeaderMapping(headers, [
        CSV_IMPORT_IGNORE,
        "club",
        "schedule_type",
        "planning_status",
        "primary_organizer_email",
        "attendance_mode",
        CSV_IMPORT_IGNORE,
      ]),
    (error) =>
      error instanceof InputValidationError &&
      error.issues[0].code === "missing_required_mapping",
  );
});

test("omits unmapped source cells and fingerprints only the allowlisted mapping", async () => {
  const headers = [...CSV_IMPORT_CANONICAL_COLUMNS, "private_vendor_blob"];
  const selections = [
    ...CSV_IMPORT_CANONICAL_COLUMNS,
    CSV_IMPORT_IGNORE,
  ];
  const base = canonicalRow();
  const first = await normalizeRows(
    [[...canonicalValues(base), "never persist this one"]],
    { headers, selections },
  );
  const second = await normalizeRows(
    [[...canonicalValues(base), "different ignored source content"]],
    { headers, selections },
  );
  assert.equal(
    "private_vendor_blob" in first.rows[0].mappedValues,
    false,
  );
  assert.equal(
    first.rows[0].normalizedRowFingerprint,
    second.rows[0].normalizedRowFingerprint,
  );
  assert.equal(
    first.rows[0].mappedRowFingerprint,
    second.rows[0].mappedRowFingerprint,
  );
  assert.equal(
    JSON.stringify(first.rows[0]).includes("never persist this one"),
    false,
  );
});

test("fingerprints canonical normalized payload so casing, URL, and explicit defaults converge", async () => {
  const implicit = await normalizeRows([
    canonicalRow({
      primary_organizer_email: "OWNER@EXAMPLE.INVALID",
      meetup_url:
        "https://www.meetup.com/example-group/events/12345/?tracking=source#fragment",
      timezone: "",
      publication_status: "",
      buffer_before_minutes: "",
      buffer_after_minutes: "",
    }),
  ]);
  const explicit = await normalizeRows([
    canonicalRow({
      primary_organizer_email: "owner@example.invalid",
      meetup_url:
        "https://www.meetup.com/example-group/events/12345/",
      timezone: "America/Vancouver",
      publication_status: "private",
      buffer_before_minutes: "0",
      buffer_after_minutes: "0",
    }),
  ]);
  assert.deepEqual(implicit.rows[0].normalized, explicit.rows[0].normalized);
  assert.equal(
    implicit.rows[0].normalizedRowFingerprint,
    explicit.rows[0].normalizedRowFingerprint,
  );
  assert.notEqual(
    implicit.rows[0].mappedRowFingerprint,
    explicit.rows[0].mappedRowFingerprint,
  );
  assert.match(
    implicit.rows[0].normalizedRowFingerprint,
    /^[a-f0-9]{64}$/u,
  );
  assert.match(
    implicit.rows[0].mappedRowFingerprint,
    /^[a-f0-9]{64}$/u,
  );
});

test("defaults blank timezone, publication status, and buffers visibly and keeps imports private", async () => {
  const result = await normalizeRows([canonicalRow()]);
  const row = result.rows[0];
  assert.equal(row.issues.length, 0);
  assert.equal(row.normalized.publicationStatus, "private");
  assert.equal(row.normalized.schedule.timeZone, "America/Vancouver");
  assert.equal(row.normalized.schedule.startsAtUtc, "2026-01-16T02:00:00.000Z");
  assert.equal(row.normalized.bufferBeforeMinutes, 0);
  assert.equal(row.normalized.bufferAfterMinutes, 0);
  assert.deepEqual(row.defaultsApplied, [
    "timezone",
    "publication_status",
    "buffer_after_minutes",
    "buffer_before_minutes",
  ]);
});

test("rejects DST gaps and requires matching offsets for ambiguous local times", async () => {
  const gap = await normalizeRows([
    canonicalRow({
      start_date: "2025-03-09",
      start_time: "02:30",
      end_date: "2025-03-09",
      end_time: "04:00",
    }),
  ]);
  assert.equal(gap.invalidRowCount, 1);
  assert.ok(issueCodes(gap.rows[0]).includes("nonexistent_local_time"));

  const ambiguous = await normalizeRows([
    canonicalRow({
      start_date: "2025-11-02",
      start_time: "01:30",
      end_date: "2025-11-02",
      end_time: "02:30",
    }),
  ]);
  assert.ok(
    issueCodes(ambiguous.rows[0]).includes(
      "ambiguous_local_time_offset_required",
    ),
  );

  const disambiguated = await normalizeRows([
    canonicalRow({
      start_date: "2025-11-02",
      start_time: "01:30",
      start_utc_offset: "-07:00",
      end_date: "2025-11-02",
      end_time: "02:30",
      end_utc_offset: "-08:00",
    }),
  ]);
  assert.equal(disambiguated.validRowCount, 1);
  assert.equal(
    disambiguated.rows[0].normalized.schedule.startsAtUtc,
    "2025-11-02T08:30:00.000Z",
  );
  assert.equal(
    disambiguated.rows[0].normalized.schedule.endsAtUtc,
    "2025-11-02T10:30:00.000Z",
  );

  const mismatch = await normalizeRows([
    canonicalRow({
      start_utc_offset: "-05:00",
    }),
  ]);
  assert.ok(issueCodes(mismatch.rows[0]).includes("utc_offset_mismatch"));
});

test("normalizes overnight, multi-day, and all-day exclusive schedules", async () => {
  const result = await normalizeRows([
    canonicalRow({
      start_date: "2026-07-23",
      start_time: "22:00",
      end_date: "2026-07-24",
      end_time: "01:00",
    }),
    canonicalRow({
      title: "Multi-day timed",
      start_date: "2026-07-23",
      start_time: "18:00",
      end_date: "2026-07-26",
      end_time: "18:00",
    }),
    canonicalRow({
      title: "Leap-day all-day",
      schedule_type: "all_day",
      start_date: "2028-02-29",
      start_time: "",
      end_date: "",
      end_time: "",
      end_date_exclusive: "2028-03-02",
    }),
  ]);
  assert.equal(result.validRowCount, 3);
  assert.equal(
    Date.parse(result.rows[0].normalized.schedule.endsAtUtc) -
      Date.parse(result.rows[0].normalized.schedule.startsAtUtc),
    3 * 60 * 60_000,
  );
  assert.equal(
    Date.parse(result.rows[1].normalized.schedule.endsAtUtc) -
      Date.parse(result.rows[1].normalized.schedule.startsAtUtc),
    72 * 60 * 60_000,
  );
  assert.deepEqual(result.rows[2].normalized.schedule, {
    shape: "all_day",
    timeZone: "America/Vancouver",
    startsAtUtc: null,
    endsAtUtc: null,
    startDate: "2028-02-29",
    endDateExclusive: "2028-03-02",
  });
});

test("rejects invalid leap dates, invented timezones, and unknown schedule enums", async () => {
  const result = await normalizeRows([
    canonicalRow({
      schedule_type: "all_day",
      start_date: "2027-02-29",
      start_time: "",
      end_date: "",
      end_time: "",
      end_date_exclusive: "2027-03-02",
    }),
    canonicalRow({
      timezone: "America/Not_A_Zone",
    }),
    canonicalRow({
      schedule_type: "sometimes",
    }),
  ]);
  assert.ok(issueCodes(result.rows[0]).includes("invalid_date"));
  assert.ok(issueCodes(result.rows[1]).includes("invalid_timezone"));
  assert.ok(issueCodes(result.rows[2]).includes("invalid_choice"));
});

test("rejects zero/end-before ranges and schedule-shape field mixing", async () => {
  const result = await normalizeRows([
    canonicalRow({
      end_time: "18:00",
    }),
    canonicalRow({
      end_time: "17:00",
    }),
    canonicalRow({
      planning_status: "idea",
      schedule_type: "unscheduled",
    }),
    canonicalRow({
      planning_status: "idea",
      schedule_type: "unscheduled",
      start_date: "",
      start_time: "",
      end_date: "",
      end_time: "",
    }),
  ]);
  assert.ok(issueCodes(result.rows[0]).includes("zero_duration"));
  assert.ok(issueCodes(result.rows[1]).includes("end_before_start"));
  assert.ok(issueCodes(result.rows[2]).includes("invalid_schedule_shape"));
  assert.equal(result.rows[3].normalized.schedule.shape, "unscheduled");
});

test("enforces import lifecycle and the private-only publication boundary", async () => {
  const result = await normalizeRows([
    canonicalRow({
      planning_status: "cancelled",
    }),
    canonicalRow({
      publication_status: "published",
    }),
    canonicalRow({
      planning_status: "draft",
      schedule_type: "unscheduled",
      start_date: "",
      start_time: "",
      end_date: "",
      end_time: "",
    }),
  ]);
  assert.ok(
    issueCodes(result.rows[0]).includes("unsupported_import_lifecycle"),
  );
  assert.ok(issueCodes(result.rows[1]).includes("imports_never_publish"));
  assert.equal(
    result.rows[1].issues[0].message,
    "Imports never publish events. Review the imported private event and use the normal publishing workflow.",
  );
  assert.ok(
    issueCodes(result.rows[2]).includes("unscheduled_requires_idea"),
  );
  assert.equal(result.rows[0].normalizedRowFingerprint, null);
  assert.match(result.rows[0].mappedRowFingerprint, /^[a-f0-9]{64}$/u);
});

test("normalizes organizer emails, | separators, Meetup URLs, and private notes", async () => {
  const result = await normalizeRows([
    canonicalRow({
      primary_organizer_email: "OWNER@EXAMPLE.INVALID",
      co_organizer_emails:
        "first@example.invalid|Second@Example.invalid",
      meetup_url:
        "https://www.meetup.com/example-group/events/12345/?tracking=private#fragment",
      notes: "  Internal coordination only  ",
    }),
  ]);
  assert.equal(result.validRowCount, 1);
  assert.equal(
    result.rows[0].normalized.primaryOrganizerEmail,
    "owner@example.invalid",
  );
  assert.deepEqual(result.rows[0].normalized.coOrganizerEmails, [
    "first@example.invalid",
    "second@example.invalid",
  ]);
  assert.equal(
    result.rows[0].normalized.meetupUrl,
    "https://www.meetup.com/example-group/events/12345/",
  );
  assert.equal(
    result.rows[0].normalized.privateNotes,
    "Internal coordination only",
  );
  assert.equal("description" in result.rows[0].normalized, false);
});

test("deduplicates and deterministically sorts co-organizers before fingerprinting", async () => {
  const repeated = await normalizeRows([
    canonicalRow({
      co_organizer_emails:
        "Second@example.invalid|first@example.invalid|SECOND@EXAMPLE.INVALID",
    }),
  ]);
  const canonical = await normalizeRows([
    canonicalRow({
      co_organizer_emails:
        "first@example.invalid|second@example.invalid",
    }),
  ]);
  assert.deepEqual(repeated.rows[0].normalized.coOrganizerEmails, [
    "first@example.invalid",
    "second@example.invalid",
  ]);
  assert.equal(
    repeated.rows[0].normalizedRowFingerprint,
    canonical.rows[0].normalizedRowFingerprint,
  );
  assert.notEqual(
    repeated.rows[0].mappedRowFingerprint,
    canonical.rows[0].mappedRowFingerprint,
  );
});

test("rejects unsafe URLs, duplicate organizers, invalid enum values, and invalid buffers", async () => {
  const result = await normalizeRows([
    canonicalRow({
      meetup_url: "http://www.meetup.com/example/events/123/",
    }),
    canonicalRow({
      co_organizer_emails: "owner@example.invalid",
    }),
    canonicalRow({
      attendance_mode: "telephone",
    }),
    canonicalRow({
      buffer_before_minutes: "-1",
    }),
    canonicalRow({
      meetup_url:
        "https://visitor:secret@www.meetup.com/example/events/123/",
    }),
    canonicalRow({
      meetup_url:
        "https://www.meetup.com:444/example/events/123/",
    }),
  ]);
  assert.ok(
    issueCodes(result.rows[0]).includes("invalid_url"),
  );
  assert.ok(
    issueCodes(result.rows[1]).includes("duplicate_primary_organizer"),
  );
  assert.ok(issueCodes(result.rows[2]).includes("invalid_choice"));
  assert.ok(issueCodes(result.rows[3]).includes("invalid_integer"));
  assert.ok(
    issueCodes(result.rows[4]).includes("invalid_meetup_event_url"),
  );
  assert.ok(
    issueCodes(result.rows[5]).includes("invalid_meetup_event_url"),
  );
});

test("accepts a default HTTPS Meetup port and emits one canonical URL", async () => {
  const result = await normalizeRows([
    canonicalRow({
      meetup_url:
        "https://WWW.MEETUP.COM:443/example/events/123?source=csv#top",
    }),
  ]);
  assert.equal(result.validRowCount, 1);
  assert.equal(
    result.rows[0].normalized.meetupUrl,
    "https://www.meetup.com/example/events/123/",
  );
});

test("keeps spreadsheet-looking import text inert and creates deterministic changed-row fingerprints", async () => {
  const first = await normalizeRows([
    canonicalRow({
      title: "=HYPERLINK(\"https://example.invalid\")",
      notes: "+not a formula execution context",
    }),
  ]);
  const same = await normalizeRows([
    canonicalRow({
      title: "=HYPERLINK(\"https://example.invalid\")",
      notes: "+not a formula execution context",
    }),
  ]);
  const changed = await normalizeRows([
    canonicalRow({
      title: "=HYPERLINK(\"https://example.invalid\")",
      notes: "@changed text",
    }),
  ]);
  assert.equal(
    first.rows[0].normalized.title,
    '=HYPERLINK("https://example.invalid")',
  );
  assert.equal(
    first.rows[0].normalizedRowFingerprint,
    same.rows[0].normalizedRowFingerprint,
  );
  assert.notEqual(
    first.rows[0].normalizedRowFingerprint,
    changed.rows[0].normalizedRowFingerprint,
  );
});

test("enforces 32 KiB against canonical normalized UTF-8 payload bytes", async () => {
  const oversized = canonicalRow({
    external_id: "漢".repeat(200),
    title: "漢".repeat(180),
    club: "漢".repeat(180),
    program: "漢".repeat(180),
    lane: "漢".repeat(180),
    category: "漢".repeat(180),
    location: "漢".repeat(180),
    notes: "漢".repeat(10_000),
  });
  const result = await normalizeRows([oversized]);
  assert.ok(
    issueCodes(result.rows[0]).includes("normalized_row_too_large"),
  );
  assert.equal(result.rows[0].normalized, null);
  assert.equal(result.rows[0].normalizedRowFingerprint, null);
  assert.match(result.rows[0].mappedRowFingerprint, /^[a-f0-9]{64}$/u);
});
