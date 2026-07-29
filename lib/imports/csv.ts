import {
  DEFAULT_TIME_ZONE,
  localDateTimeToUtcMs,
  normalizeAllDayEventRange,
  parseIanaTimeZone,
  parseLocalDateTime,
} from "../time";
import {
  InputValidationError,
  normalizeEmail,
  parseBoundedString,
  parseHttpsUrl,
  validationIssue,
  type ValidationIssue,
} from "../validation";

export const CSV_IMPORT_TEMPLATE_VERSION = "v1";
export const CSV_IMPORT_PARSER_VERSION = "v1";
export const CSV_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const CSV_IMPORT_MAX_COLUMNS = 40;
export const CSV_IMPORT_MAX_DATA_ROWS = 2_000;
export const CSV_IMPORT_MAX_ROW_BYTES = 32 * 1024;
export const CSV_IMPORT_MAX_CELL_CHARACTERS = 10_000;
export const CSV_IMPORT_IGNORE = "ignore";

export const CSV_IMPORT_CANONICAL_COLUMNS = [
  "external_id",
  "title",
  "club",
  "program",
  "lane",
  "category",
  "schedule_type",
  "start_date",
  "start_time",
  "start_utc_offset",
  "end_date",
  "end_time",
  "end_utc_offset",
  "end_date_exclusive",
  "timezone",
  "planning_status",
  "publication_status",
  "primary_organizer_email",
  "co_organizer_emails",
  "location",
  "attendance_mode",
  "meetup_url",
  "notes",
  "buffer_before_minutes",
  "buffer_after_minutes",
] as const;

export type CsvImportCanonicalColumn =
  (typeof CSV_IMPORT_CANONICAL_COLUMNS)[number];

export const CSV_IMPORT_REQUIRED_MAPPINGS = [
  "title",
  "club",
  "schedule_type",
  "planning_status",
  "primary_organizer_email",
  "attendance_mode",
] as const satisfies readonly CsvImportCanonicalColumn[];

export const CSV_IMPORT_SCHEDULE_TYPES = [
  "unscheduled",
  "timed",
  "all_day",
] as const;
export const CSV_IMPORT_PLANNING_STATUSES = [
  "idea",
  "draft",
  "tentative_hold",
  "confirmed",
] as const;
export const CSV_IMPORT_ATTENDANCE_MODES = [
  "in_person",
  "online",
  "hybrid",
  "undecided",
] as const;

type CsvImportScheduleType = (typeof CSV_IMPORT_SCHEDULE_TYPES)[number];
type CsvImportPlanningStatus =
  (typeof CSV_IMPORT_PLANNING_STATUSES)[number];
type CsvImportAttendanceMode =
  (typeof CSV_IMPORT_ATTENDANCE_MODES)[number];

export type CsvImportUploadMetadata = Readonly<{
  contentType: string | null | undefined;
  fileName: string;
  size: number;
}>;

export type CsvImportRecord = Readonly<{
  blank: boolean;
  issues: readonly ValidationIssue[];
  sourceRowNumber: number;
  values: readonly string[];
}>;

export type ParsedCsvImportFile = Readonly<{
  byteLength: number;
  headers: readonly string[];
  nonblankRowCount: number;
  records: readonly CsvImportRecord[];
}>;

export type CsvImportHeaderAssignment = Readonly<{
  canonicalField: CsvImportCanonicalColumn | null;
  sourceHeader: string;
  sourceIndex: number;
}>;

export type CsvImportHeaderSelection =
  | CsvImportCanonicalColumn
  | typeof CSV_IMPORT_IGNORE
  | null;

export type NormalizedCsvImportSchedule =
  | Readonly<{
      endDateExclusive: null;
      endsAtUtc: null;
      shape: "unscheduled";
      startDate: null;
      startsAtUtc: null;
      timeZone: string;
    }>
  | Readonly<{
      endDateExclusive: null;
      endsAtUtc: string;
      shape: "timed";
      startDate: null;
      startsAtUtc: string;
      timeZone: string;
    }>
  | Readonly<{
      endDateExclusive: string;
      endsAtUtc: null;
      shape: "all_day";
      startDate: string;
      startsAtUtc: null;
      timeZone: string;
    }>;

export type NormalizedCsvImportPayload = Readonly<{
  attendanceMode: CsvImportAttendanceMode;
  bufferAfterMinutes: number;
  bufferBeforeMinutes: number;
  category: string | null;
  club: string;
  coOrganizerEmails: readonly string[];
  externalId: string | null;
  lane: string | null;
  location: string | null;
  meetupUrl: string | null;
  planningStatus: CsvImportPlanningStatus;
  primaryOrganizerEmail: string;
  privateNotes: string | null;
  program: string | null;
  publicationStatus: "private";
  schedule: NormalizedCsvImportSchedule;
  title: string;
}>;

export type NormalizedCsvImportRow = Readonly<{
  blank: boolean;
  defaultsApplied: readonly CsvImportCanonicalColumn[];
  issues: readonly ValidationIssue[];
  mappedValues: Readonly<Partial<Record<CsvImportCanonicalColumn, string>>>;
  mappedRowFingerprint: string | null;
  normalized: NormalizedCsvImportPayload | null;
  normalizedRowFingerprint: string | null;
  sourceRowNumber: number;
}>;

export type NormalizedCsvImport = Readonly<{
  blankRowCount: number;
  invalidRowCount: number;
  mappedPayloadByteLength: number;
  rows: readonly NormalizedCsvImportRow[];
  validRowCount: number;
}>;

const CANONICAL_COLUMN_SET = new Set<string>(
  CSV_IMPORT_CANONICAL_COLUMNS,
);
const GENERIC_CSV_CONTENT_TYPES = new Set([
  "",
  "application/octet-stream",
  "application/csv",
  "text/plain",
]);
const EXPLICIT_CSV_CONTENT_TYPES = new Set([
  "text/csv",
  "text/comma-separated-values",
]);
const FORBIDDEN_MAGIC_PREFIXES = [
  "PK\u0003\u0004",
  "PK\u0005\u0006",
  "MZ",
  "\u007fELF",
  "%PDF-",
] as const;
const IMPORTS_NEVER_PUBLISH_MESSAGE =
  "Imports never publish events. Review the imported private event and use the normal publishing workflow.";

/**
 * Validates the browser-supplied file envelope. The bytes still have to pass
 * parseCsvImportBytes; a name or MIME type is never treated as proof of CSV.
 */
export function validateCsvImportUploadMetadata(
  metadata: CsvImportUploadMetadata,
): void {
  const fileName = parseBoundedString(metadata.fileName, {
    path: "file.name",
    maxLength: 240,
  });
  if (
    fileName.includes("/") ||
    fileName.includes("\\") ||
    !fileName.toLocaleLowerCase("en-CA").endsWith(".csv")
  ) {
    throw validationIssue(
      "file.name",
      "invalid_csv_filename",
      "Choose a local .csv file.",
    );
  }
  if (
    !Number.isSafeInteger(metadata.size) ||
    metadata.size < 1 ||
    metadata.size > CSV_IMPORT_MAX_FILE_BYTES
  ) {
    throw validationIssue(
      "file.size",
      "invalid_csv_file_size",
      "The CSV file must be between 1 byte and 2 MiB.",
    );
  }

  const contentType = (metadata.contentType ?? "")
    .split(";", 1)[0]
    .trim()
    .toLocaleLowerCase("en-CA");
  if (
    !EXPLICIT_CSV_CONTENT_TYPES.has(contentType) &&
    !GENERIC_CSV_CONTENT_TYPES.has(contentType)
  ) {
    throw validationIssue(
      "file.type",
      "invalid_csv_content_type",
      "Choose a CSV file, not another file format.",
    );
  }
}

export function parseCsvSourceNamespace(value: unknown): string {
  const namespace = parseBoundedString(value, {
    path: "sourceNamespace",
    minLength: 1,
    maxLength: 64,
  }).toLocaleLowerCase("en-CA");
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(namespace)) {
    throw validationIssue(
      "sourceNamespace",
      "invalid_source_namespace",
      "Use a short source namespace containing letters, numbers, dots, dashes, or underscores.",
    );
  }
  return namespace;
}

/**
 * Strict RFC 4180-style parser. Quoted commas, escaped quotes, and embedded
 * CRLF/LF line breaks are preserved. The returned row number is the physical
 * line on which the record began, including blank records.
 */
export function parseCsvImportBytes(
  bytes: Uint8Array,
  metadata?: Omit<CsvImportUploadMetadata, "size">,
): ParsedCsvImportFile {
  if (!(bytes instanceof Uint8Array)) {
    throw validationIssue(
      "file",
      "invalid_csv_bytes",
      "Expected CSV file bytes.",
    );
  }
  if (metadata) {
    validateCsvImportUploadMetadata({
      ...metadata,
      size: bytes.byteLength,
    });
  } else if (
    bytes.byteLength < 1 ||
    bytes.byteLength > CSV_IMPORT_MAX_FILE_BYTES
  ) {
    throw validationIssue(
      "file.size",
      "invalid_csv_file_size",
      "The CSV file must be between 1 byte and 2 MiB.",
    );
  }
  if (bytes.includes(0)) {
    throw validationIssue(
      "file",
      "csv_nul_byte",
      "CSV files cannot contain NUL bytes.",
    );
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw validationIssue(
      "file",
      "invalid_utf8",
      "The CSV file must use valid UTF-8.",
    );
  }
  if (text.startsWith("\uFEFF")) text = text.slice(1);
  if (text.length === 0) {
    throw validationIssue(
      "file",
      "empty_csv",
      "The CSV file must contain a header row.",
    );
  }
  if (hasNonCsvDocumentSignature(text)) {
    throw validationIssue(
      "file",
      "non_csv_document_signature",
      "The uploaded bytes appear to be another document format, not CSV content.",
    );
  }
  if (FORBIDDEN_MAGIC_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    throw validationIssue(
      "file",
      "invalid_csv_content",
      "The uploaded bytes are not CSV content.",
    );
  }

  const rawRecords = parseCsvRecords(text);
  if (rawRecords.length === 0) {
    throw validationIssue(
      "file",
      "empty_csv",
      "The CSV file must contain a header row.",
    );
  }

  const headerRecord = rawRecords[0];
  if (headerRecord.values.every((value) => value.trim() === "")) {
    throw validationIssue(
      "headers",
      "empty_csv_headers",
      "The CSV header row cannot be blank.",
    );
  }
  if (headerRecord.values.length > CSV_IMPORT_MAX_COLUMNS) {
    throw validationIssue(
      "headers",
      "too_many_csv_columns",
      "CSV files can contain at most 40 columns.",
    );
  }
  const headers = headerRecord.values.map((value, index) => {
    const header = normalizeCell(value).trim();
    if (header.length === 0) {
      throw validationIssue(
        `headers.${index}`,
        "blank_csv_header",
        "CSV header names cannot be blank.",
      );
    }
    return header;
  });
  const seenHeaders = new Set<string>();
  for (let index = 0; index < headers.length; index += 1) {
    const key = headers[index]
      .normalize("NFKC")
      .trim()
      .toLocaleLowerCase("en-CA");
    if (seenHeaders.has(key)) {
      throw validationIssue(
        `headers.${index}`,
        "duplicate_csv_header",
        "CSV header names must be unique.",
      );
    }
    seenHeaders.add(key);
  }

  const records = rawRecords.slice(1).map((record) => {
    const issues: ValidationIssue[] = [];
    if (record.values.length > CSV_IMPORT_MAX_COLUMNS) {
      issues.push({
        path: `rows.${record.sourceRowNumber}`,
        code: "too_many_csv_columns",
        message: "CSV rows can contain at most 40 columns.",
      });
    }
    if (record.values.length !== headers.length) {
      issues.push({
        path: `rows.${record.sourceRowNumber}`,
        code: "csv_column_count_mismatch",
        message:
          "The row must contain the same number of columns as the header.",
      });
    }
    const blank =
      issues.length === 0 &&
      record.values.every((value) => value.trim() === "");
    return Object.freeze({
      blank,
      issues: Object.freeze(issues),
      sourceRowNumber: record.sourceRowNumber,
      values: Object.freeze(record.values.map(normalizeCell)),
    });
  });
  const nonblankRowCount = records.filter((record) => !record.blank).length;
  if (nonblankRowCount > CSV_IMPORT_MAX_DATA_ROWS) {
    throw validationIssue(
      "rows",
      "too_many_csv_rows",
      "CSV files can contain at most 2,000 nonblank data rows.",
    );
  }

  return Object.freeze({
    byteLength: bytes.byteLength,
    headers: Object.freeze(headers),
    nonblankRowCount,
    records: Object.freeze(records),
  });
}

export function automaticCsvHeaderSelections(
  headers: readonly string[],
): readonly CsvImportHeaderSelection[] {
  return Object.freeze(
    headers.map((header) =>
      CANONICAL_COLUMN_SET.has(header)
        ? (header as CsvImportCanonicalColumn)
        : CSV_IMPORT_IGNORE,
    ),
  );
}

export function createCsvImportHeaderMapping(
  headers: readonly string[],
  requestedSelections: readonly CsvImportHeaderSelection[] =
    automaticCsvHeaderSelections(headers),
): readonly CsvImportHeaderAssignment[] {
  if (requestedSelections.length !== headers.length) {
    throw validationIssue(
      "mapping",
      "mapping_length_mismatch",
      "Provide one mapping decision for every uploaded header.",
    );
  }

  const mappedFields = new Set<CsvImportCanonicalColumn>();
  const assignments = headers.map((sourceHeader, sourceIndex) => {
    const requested = requestedSelections[sourceIndex];
    const canonicalField =
      requested === null || requested === CSV_IMPORT_IGNORE
        ? null
        : requested;
    if (
      canonicalField !== null &&
      !CANONICAL_COLUMN_SET.has(canonicalField)
    ) {
      throw validationIssue(
        `mapping.${sourceIndex}`,
        "invalid_mapping_field",
        "Choose a supported canonical field or Ignore.",
      );
    }
    if (canonicalField !== null && mappedFields.has(canonicalField)) {
      throw validationIssue(
        `mapping.${sourceIndex}`,
        "duplicate_mapping",
        "Each canonical field can be mapped only once.",
      );
    }
    if (canonicalField !== null) mappedFields.add(canonicalField);
    return Object.freeze({
      canonicalField,
      sourceHeader,
      sourceIndex,
    });
  });

  const missing = CSV_IMPORT_REQUIRED_MAPPINGS.filter(
    (field) => !mappedFields.has(field),
  );
  if (missing.length > 0) {
    throw validationIssue(
      "mapping",
      "missing_required_mapping",
      "Map every required import field before previewing.",
    );
  }
  return Object.freeze(assignments);
}

export async function normalizeCsvImport(
  parsed: ParsedCsvImportFile,
  mapping: readonly CsvImportHeaderAssignment[],
): Promise<NormalizedCsvImport> {
  validateAssignmentEnvelope(parsed.headers, mapping);
  const rows: NormalizedCsvImportRow[] = [];
  let mappedPayloadByteLength = 0;
  let validRowCount = 0;
  let invalidRowCount = 0;
  let blankRowCount = 0;

  for (const record of parsed.records) {
    if (record.blank) {
      blankRowCount += 1;
      rows.push(
        Object.freeze({
          blank: true,
          defaultsApplied: Object.freeze([]),
          issues: Object.freeze([]),
          mappedValues: Object.freeze({}),
          mappedRowFingerprint: null,
          normalized: null,
          normalizedRowFingerprint: null,
          sourceRowNumber: record.sourceRowNumber,
        }),
      );
      continue;
    }

    const mappedValues = mappedValuesForRecord(record, mapping);
    const mappedFingerprintInput =
      canonicalMappedFingerprintInput(mappedValues);
    const mappedBytes = new TextEncoder().encode(
      mappedFingerprintInput,
    ).byteLength;
    mappedPayloadByteLength += mappedBytes;
    const issues: ValidationIssue[] = [...record.issues];
    if (mappedPayloadByteLength > CSV_IMPORT_MAX_FILE_BYTES) {
      throw validationIssue(
        "rows",
        "mapped_payload_too_large",
        "The mapped normalized payload cannot exceed 2 MiB.",
      );
    }

    let normalized: NormalizedCsvImportPayload | null = null;
    let normalizedRowFingerprint: string | null = null;
    let defaultsApplied: readonly CsvImportCanonicalColumn[] =
      Object.freeze([]);
    if (issues.length === 0) {
      try {
        const result = normalizeMappedValues(mappedValues);
        normalized = result.normalized;
        defaultsApplied = result.defaultsApplied;
        const normalizedFingerprintInput =
          canonicalNormalizedPayloadFingerprintInput(normalized);
        if (
          new TextEncoder().encode(normalizedFingerprintInput).byteLength >
          CSV_IMPORT_MAX_ROW_BYTES
        ) {
          issues.push({
            path: `rows.${record.sourceRowNumber}`,
            code: "normalized_row_too_large",
            message: "A normalized import row cannot exceed 32 KiB.",
          });
          normalized = null;
        } else {
          normalizedRowFingerprint = await sha256Hex(
            normalizedFingerprintInput,
          );
        }
      } catch (error) {
        if (!(error instanceof InputValidationError)) throw error;
        issues.push(
          ...error.issues.map((issue) => ({
            ...issue,
            path: `rows.${record.sourceRowNumber}.${issue.path}`,
          })),
        );
      }
    }

    const mappedRowFingerprint = await sha256Hex(mappedFingerprintInput);
    if (issues.length === 0) validRowCount += 1;
    else invalidRowCount += 1;
    rows.push(
      Object.freeze({
        blank: false,
        defaultsApplied,
        issues: Object.freeze(issues),
        mappedValues: Object.freeze(mappedValues),
        mappedRowFingerprint,
        normalized,
        normalizedRowFingerprint,
        sourceRowNumber: record.sourceRowNumber,
      }),
    );
  }

  return Object.freeze({
    blankRowCount,
    invalidRowCount,
    mappedPayloadByteLength,
    rows: Object.freeze(rows),
    validRowCount,
  });
}

type RawCsvRecord = Readonly<{
  sourceRowNumber: number;
  values: readonly string[];
}>;

function parseCsvRecords(text: string): readonly RawCsvRecord[] {
  const records: RawCsvRecord[] = [];
  let values: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;
  let physicalLine = 1;
  let recordStartLine = 1;

  const finishRecord = (): void => {
    values.push(field);
    records.push(
      Object.freeze({
        sourceRowNumber: recordStartLine,
        values: Object.freeze(values),
      }),
    );
    field = "";
    values = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else if (character === "\r" || character === "\n") {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        field += "\n";
        physicalLine += 1;
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote) {
      if (character === ",") {
        values.push(field);
        field = "";
        afterQuote = false;
        continue;
      }
      if (character === "\r" || character === "\n") {
        finishRecord();
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        physicalLine += 1;
        recordStartLine = physicalLine;
        afterQuote = false;
        continue;
      }
      throw validationIssue(
        `rows.${recordStartLine}`,
        "invalid_csv_quote",
        "A closing quote must be followed by a comma or line ending.",
      );
    }

    if (character === '"') {
      if (field.length !== 0) {
        throw validationIssue(
          `rows.${recordStartLine}`,
          "invalid_csv_quote",
          "Quotes are only valid around an entire CSV field.",
        );
      }
      inQuotes = true;
      continue;
    }
    if (character === ",") {
      values.push(field);
      field = "";
      continue;
    }
    if (character === "\r" || character === "\n") {
      finishRecord();
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      physicalLine += 1;
      recordStartLine = physicalLine;
      continue;
    }
    field += character;
  }

  if (inQuotes) {
    throw validationIssue(
      `rows.${recordStartLine}`,
      "unterminated_csv_quote",
      "The CSV file contains an unterminated quoted field.",
    );
  }
  if (field.length > 0 || values.length > 0 || afterQuote) finishRecord();

  for (const record of records) {
    for (let index = 0; index < record.values.length; index += 1) {
      if (
        Array.from(record.values[index]).length >
        CSV_IMPORT_MAX_CELL_CHARACTERS
      ) {
        throw validationIssue(
          `rows.${record.sourceRowNumber}.${index}`,
          "csv_cell_too_large",
          "A CSV cell cannot exceed 10,000 Unicode characters.",
        );
      }
    }
  }
  return Object.freeze(records);
}

function normalizeCell(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .normalize("NFC");
}

function validateAssignmentEnvelope(
  headers: readonly string[],
  mapping: readonly CsvImportHeaderAssignment[],
): void {
  if (mapping.length !== headers.length) {
    throw validationIssue(
      "mapping",
      "mapping_length_mismatch",
      "The stored mapping no longer matches the uploaded headers.",
    );
  }
  const selections = mapping.map((assignment, index) => {
    if (
      assignment.sourceIndex !== index ||
      assignment.sourceHeader !== headers[index]
    ) {
      throw validationIssue(
        `mapping.${index}`,
        "mapping_source_mismatch",
        "The stored mapping no longer matches the uploaded headers.",
      );
    }
    return assignment.canonicalField ?? CSV_IMPORT_IGNORE;
  });
  createCsvImportHeaderMapping(headers, selections);
}

function mappedValuesForRecord(
  record: CsvImportRecord,
  mapping: readonly CsvImportHeaderAssignment[],
): Partial<Record<CsvImportCanonicalColumn, string>> {
  const mapped: Partial<Record<CsvImportCanonicalColumn, string>> = {};
  for (const assignment of mapping) {
    if (
      assignment.canonicalField !== null &&
      assignment.sourceIndex < record.values.length
    ) {
      mapped[assignment.canonicalField] = normalizeCell(
        record.values[assignment.sourceIndex],
      ).trim();
    }
  }
  return mapped;
}

function canonicalMappedFingerprintInput(
  mapped: Partial<Record<CsvImportCanonicalColumn, string>>,
): string {
  return JSON.stringify([
    CSV_IMPORT_PARSER_VERSION,
    ...CSV_IMPORT_CANONICAL_COLUMNS.map((field) => mapped[field] ?? null),
  ]);
}

function canonicalNormalizedPayloadFingerprintInput(
  normalized: NormalizedCsvImportPayload,
): string {
  return JSON.stringify([
    "vcc-event-import-normalized",
    CSV_IMPORT_TEMPLATE_VERSION,
    CSV_IMPORT_PARSER_VERSION,
    normalized.externalId,
    normalized.title,
    normalized.club,
    normalized.program,
    normalized.lane,
    normalized.category,
    normalized.planningStatus,
    normalized.publicationStatus,
    normalized.primaryOrganizerEmail,
    normalized.coOrganizerEmails,
    normalized.location,
    normalized.attendanceMode,
    normalized.meetupUrl,
    normalized.privateNotes,
    normalized.bufferBeforeMinutes,
    normalized.bufferAfterMinutes,
    normalized.schedule.shape,
    normalized.schedule.timeZone,
    normalized.schedule.startsAtUtc,
    normalized.schedule.endsAtUtc,
    normalized.schedule.startDate,
    normalized.schedule.endDateExclusive,
  ]);
}

function normalizeMappedValues(
  values: Partial<Record<CsvImportCanonicalColumn, string>>,
): Readonly<{
  defaultsApplied: readonly CsvImportCanonicalColumn[];
  normalized: NormalizedCsvImportPayload;
}> {
  const defaultsApplied: CsvImportCanonicalColumn[] = [];
  const planningStatus = parseChoice(
    values.planning_status,
    CSV_IMPORT_PLANNING_STATUSES,
    "planning_status",
    [
      "cancelled",
      "completed",
      "archived",
    ],
  );
  const scheduleType = parseChoice(
    values.schedule_type,
    CSV_IMPORT_SCHEDULE_TYPES,
    "schedule_type",
  );
  if (scheduleType === "unscheduled" && planningStatus !== "idea") {
    throw validationIssue(
      "schedule_type",
      "unscheduled_requires_idea",
      "Only an Idea may be unscheduled.",
    );
  }

  const rawTimeZone = values.timezone ?? "";
  const timeZone =
    rawTimeZone === ""
      ? (defaultsApplied.push("timezone"), DEFAULT_TIME_ZONE)
      : parseIanaTimeZone(rawTimeZone, "timezone");
  const publicationStatus = normalizePublicationStatus(
    values.publication_status,
    defaultsApplied,
  );
  const schedule = normalizeSchedule(values, scheduleType, timeZone);
  const coOrganizerEmails = normalizeCoOrganizerEmails(
    values.co_organizer_emails,
  );
  const primaryOrganizerEmail = normalizeEmail(
    values.primary_organizer_email,
    "primary_organizer_email",
  );
  if (coOrganizerEmails.includes(primaryOrganizerEmail)) {
    throw validationIssue(
      "co_organizer_emails",
      "duplicate_primary_organizer",
      "The primary organizer cannot also be a co-organizer.",
    );
  }

  const normalized = Object.freeze({
    attendanceMode: parseChoice(
      values.attendance_mode,
      CSV_IMPORT_ATTENDANCE_MODES,
      "attendance_mode",
    ),
    bufferAfterMinutes: parseOptionalBoundedInteger(
      values.buffer_after_minutes,
      "buffer_after_minutes",
      defaultsApplied,
    ),
    bufferBeforeMinutes: parseOptionalBoundedInteger(
      values.buffer_before_minutes,
      "buffer_before_minutes",
      defaultsApplied,
    ),
    category: parseOptionalReference(values.category, "category"),
    club: parseBoundedString(values.club, {
      path: "club",
      maxLength: 180,
    }).normalize("NFC"),
    coOrganizerEmails: Object.freeze(coOrganizerEmails),
    externalId: parseOptionalText(values.external_id, "external_id", 200),
    lane: parseOptionalReference(values.lane, "lane"),
    location: parseOptionalReference(values.location, "location"),
    meetupUrl: normalizeOptionalMeetupEventUrl(values.meetup_url),
    planningStatus,
    primaryOrganizerEmail,
    privateNotes: parseOptionalText(values.notes, "notes", 10_000),
    program: parseOptionalReference(values.program, "program"),
    publicationStatus,
    schedule,
    title: parseBoundedString(values.title, {
      path: "title",
      minLength: 1,
      maxLength: 180,
    }).normalize("NFC"),
  });
  return Object.freeze({
    defaultsApplied: Object.freeze(defaultsApplied),
    normalized,
  });
}

function parseChoice<const Choices extends readonly string[]>(
  value: string | undefined,
  choices: Choices,
  path: string,
  recognizedButRejected: readonly string[] = [],
): Choices[number] {
  if (
    value !== undefined &&
    recognizedButRejected.includes(value)
  ) {
    throw validationIssue(
      path,
      "unsupported_import_lifecycle",
      "New imported events cannot use that lifecycle state.",
    );
  }
  if (
    value === undefined ||
    !choices.some((choice) => choice === value)
  ) {
    throw validationIssue(
      path,
      "invalid_choice",
      "Choose one of the supported import values.",
    );
  }
  return value as Choices[number];
}

function normalizePublicationStatus(
  value: string | undefined,
  defaultsApplied: CsvImportCanonicalColumn[],
): "private" {
  if (value === undefined || value === "") {
    defaultsApplied.push("publication_status");
    return "private";
  }
  if (value === "private") return "private";
  if (["scheduled", "published", "unpublished"].includes(value)) {
    throw validationIssue(
      "publication_status",
      "imports_never_publish",
      IMPORTS_NEVER_PUBLISH_MESSAGE,
    );
  }
  throw validationIssue(
    "publication_status",
    "invalid_choice",
    "The publication status must be private or blank.",
  );
}

function normalizeSchedule(
  values: Partial<Record<CsvImportCanonicalColumn, string>>,
  scheduleType: CsvImportScheduleType,
  timeZone: string,
): NormalizedCsvImportSchedule {
  if (scheduleType === "unscheduled") {
    assertBlankScheduleFields(values, [
      "start_date",
      "start_time",
      "start_utc_offset",
      "end_date",
      "end_time",
      "end_utc_offset",
      "end_date_exclusive",
    ]);
    return Object.freeze({
      endDateExclusive: null,
      endsAtUtc: null,
      shape: "unscheduled" as const,
      startDate: null,
      startsAtUtc: null,
      timeZone,
    });
  }
  if (scheduleType === "all_day") {
    assertBlankScheduleFields(values, [
      "start_time",
      "start_utc_offset",
      "end_date",
      "end_time",
      "end_utc_offset",
    ]);
    const range = normalizeAllDayEventRange({
      startDate: values.start_date,
      endDateExclusive: values.end_date_exclusive,
    });
    return Object.freeze({
      endDateExclusive: range.endDateExclusive,
      endsAtUtc: null,
      shape: "all_day" as const,
      startDate: range.startDate,
      startsAtUtc: null,
      timeZone,
    });
  }

  if (nonblank(values.end_date_exclusive)) {
    throw validationIssue(
      "end_date_exclusive",
      "invalid_schedule_shape",
      "Timed rows cannot include an all-day exclusive end date.",
    );
  }
  const startLocal = combineLocalDateAndTime(
    values.start_date,
    values.start_time,
    "start",
  );
  const endLocal = combineLocalDateAndTime(
    values.end_date,
    values.end_time,
    "end",
  );
  const startsAtUtcMs = resolveLocalDateTimeWithOffset(
    startLocal,
    timeZone,
    values.start_utc_offset,
    "start_utc_offset",
  );
  const endsAtUtcMs = resolveLocalDateTimeWithOffset(
    endLocal,
    timeZone,
    values.end_utc_offset,
    "end_utc_offset",
  );
  if (endsAtUtcMs === startsAtUtcMs) {
    throw validationIssue(
      "end_time",
      "zero_duration",
      "A timed event must have a positive duration.",
    );
  }
  if (endsAtUtcMs < startsAtUtcMs) {
    throw validationIssue(
      "end_time",
      "end_before_start",
      "The event end must be after its start.",
    );
  }
  return Object.freeze({
    endDateExclusive: null,
    endsAtUtc: new Date(endsAtUtcMs).toISOString(),
    shape: "timed" as const,
    startDate: null,
    startsAtUtc: new Date(startsAtUtcMs).toISOString(),
    timeZone,
  });
}

function assertBlankScheduleFields(
  values: Partial<Record<CsvImportCanonicalColumn, string>>,
  fields: readonly CsvImportCanonicalColumn[],
): void {
  const populated = fields.find((field) => nonblank(values[field]));
  if (populated) {
    throw validationIssue(
      populated,
      "invalid_schedule_shape",
      "The row contains date or time values that do not match its schedule type.",
    );
  }
}

function combineLocalDateAndTime(
  date: string | undefined,
  time: string | undefined,
  prefix: "start" | "end",
): string {
  if (!nonblank(date)) {
    throw validationIssue(
      `${prefix}_date`,
      "required",
      "Timed rows require a local date.",
    );
  }
  if (!nonblank(time)) {
    throw validationIssue(
      `${prefix}_time`,
      "required",
      "Timed rows require a local time.",
    );
  }
  const local = `${date}T${time}`;
  try {
    parseLocalDateTime(local, `${prefix}_time`);
  } catch (error) {
    throw rethrowAtPath(error, `${prefix}_time`);
  }
  return local;
}

function resolveLocalDateTimeWithOffset(
  local: string,
  timeZone: string,
  rawOffset: string | undefined,
  offsetPath: "start_utc_offset" | "end_utc_offset",
): number {
  let earlier: number;
  let later: number;
  try {
    earlier = localDateTimeToUtcMs(local, timeZone, "earlier");
    later = localDateTimeToUtcMs(local, timeZone, "later");
  } catch (error) {
    throw rethrowAtPath(
      error,
      offsetPath === "start_utc_offset" ? "start_time" : "end_time",
    );
  }
  const candidates = [...new Set([earlier, later])];
  const parsedOffset =
    nonblank(rawOffset) ? parseUtcOffset(rawOffset, offsetPath) : null;
  if (candidates.length > 1 && parsedOffset === null) {
    throw validationIssue(
      offsetPath,
      "ambiguous_local_time_offset_required",
      "This local time occurs twice; provide the matching UTC offset.",
    );
  }
  if (parsedOffset === null) return candidates[0];

  const localParts = parseLocalDateTime(local);
  const localAsUtc = Date.UTC(
    localParts.year,
    localParts.month - 1,
    localParts.day,
    localParts.hour,
    localParts.minute,
    localParts.second,
  );
  const matched = candidates.find(
    (candidate) =>
      Math.round((localAsUtc - candidate) / 60_000) === parsedOffset,
  );
  if (matched === undefined) {
    throw validationIssue(
      offsetPath,
      "utc_offset_mismatch",
      "The supplied UTC offset does not match this local time and timezone.",
    );
  }
  return matched;
}

function parseUtcOffset(value: string, path: string): number {
  const match = /^([+-])(\d{2}):(\d{2})$/u.exec(value);
  if (!match) {
    throw validationIssue(
      path,
      "invalid_utc_offset",
      "Use a UTC offset in +HH:MM or -HH:MM form.",
    );
  }
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
    throw validationIssue(
      path,
      "invalid_utc_offset",
      "Use a real UTC offset from -14:00 through +14:00.",
    );
  }
  const absoluteMinutes = hours * 60 + minutes;
  return match[1] === "-" ? -absoluteMinutes : absoluteMinutes;
}

function parseOptionalBoundedInteger(
  value: string | undefined,
  path: "buffer_before_minutes" | "buffer_after_minutes",
  defaultsApplied: CsvImportCanonicalColumn[],
): number {
  if (!nonblank(value)) {
    defaultsApplied.push(path);
    return 0;
  }
  if (!/^\d+$/u.test(value)) {
    throw validationIssue(
      path,
      "invalid_integer",
      "Buffer minutes must be a whole number.",
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 24 * 60) {
    throw validationIssue(
      path,
      "invalid_integer",
      "Buffer minutes must be between 0 and 1,440.",
    );
  }
  return parsed;
}

function parseOptionalReference(
  value: string | undefined,
  path: string,
): string | null {
  return parseOptionalText(value, path, 180);
}

function parseOptionalText(
  value: string | undefined,
  path: string,
  maxLength: number,
): string | null {
  if (!nonblank(value)) return null;
  return parseBoundedString(value, {
    path,
    maxLength,
  }).normalize("NFC");
}

function normalizeCoOrganizerEmails(
  value: string | undefined,
): string[] {
  if (!nonblank(value)) return [];
  const parts = value.split("|");
  if (
    parts.length > 12 ||
    parts.some((part) => part.trim().length === 0)
  ) {
    throw validationIssue(
      "co_organizer_emails",
      "invalid_email_list",
      "Use one to twelve co-organizer emails separated by |.",
    );
  }
  const normalized = parts.map((part, index) =>
    normalizeEmail(part, `co_organizer_emails.${index}`),
  );
  return [...new Set(normalized)].sort();
}

function normalizeOptionalMeetupEventUrl(
  value: string | undefined,
): string | null {
  if (!nonblank(value)) return null;
  const parsed = new URL(parseHttpsUrl(value, "meetup_url"));
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.hostname.toLocaleLowerCase("en-CA") !== "www.meetup.com" ||
    !/^\/[A-Za-z0-9_-]+\/events\/[A-Za-z0-9_-]+\/?$/u.test(
      parsed.pathname,
    )
  ) {
    throw validationIssue(
      "meetup_url",
      "invalid_meetup_event_url",
      "Use a public Meetup event URL.",
    );
  }
  parsed.hostname = "www.meetup.com";
  parsed.search = "";
  parsed.hash = "";
  if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
  return parsed.toString();
}

function nonblank(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function rethrowAtPath(error: unknown, path: string): InputValidationError {
  if (!(error instanceof InputValidationError)) throw error;
  return new InputValidationError(
    error.issues.map((issue) => ({
      ...issue,
      path,
    })),
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hasNonCsvDocumentSignature(text: string): boolean {
  const candidate = text.replace(/^[\t\n\f\r ]+/u, "");
  if (
    /^(?:BEGIN:VCALENDAR(?:[\t\n\f\r ;:]|$)|<\?xml(?:[\t\n\f\r ?]|$)|<!doctype(?:[\t\n\f\r >]|$)|<\/?[A-Za-z_][A-Za-z0-9_.:-]*(?:[\t\n\f\r />]|$)|<!--)/iu.test(
      candidate,
    )
  ) {
    return true;
  }
  try {
    const parsed: unknown = JSON.parse(candidate);
    return (
      parsed === null ||
      typeof parsed === "boolean" ||
      typeof parsed === "number" ||
      typeof parsed === "string" ||
      Array.isArray(parsed) ||
      (typeof parsed === "object" && parsed !== null)
    );
  } catch {
    return false;
  }
}
