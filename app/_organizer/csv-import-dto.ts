import type {
  CsvImportBatchSummary,
  CsvImportBatchWorkspace,
  CsvImportPreviewRowDto,
} from "@/lib/server/phase7/imports";

const IMPORT_PHASES = new Set([
  "uploaded",
  "previewed",
  "approved",
  "applying",
  "interrupted",
  "completed",
  "completed_with_errors",
  "failed",
  "redacted",
]);

const CONFLICT_POLICY_MODES = new Set([
  "block",
  "require_admin_approval",
  "warn_reason",
]);

const CONFLICT_SOURCES = new Set([
  "existing_legacy",
  "existing_meetup",
  "existing_organizer",
  "import_row",
]);

export function parseCsvImportWorkspace(
  value: unknown,
): CsvImportBatchWorkspace {
  const record = object(value);
  const rows = array(record.rows).map(parseRow);
  const conflictPolicyMode = string(record.conflictPolicyMode);
  if (!CONFLICT_POLICY_MODES.has(conflictPolicyMode)) throw invalidDto();
  return Object.freeze({
    batch: parseSummary(record.batch),
    conflictPolicyMode:
      conflictPolicyMode as CsvImportBatchWorkspace["conflictPolicyMode"],
    mappingDecisions: Object.freeze(
      array(record.mappingDecisions).map(parseMappingDecision),
    ),
    previewFingerprint: nullableString(record.previewFingerprint),
    previewVersion: nonnegativeInteger(record.previewVersion),
    rowPage: parseRowPage(record.rowPage),
    rows: Object.freeze(rows),
  });
}

function parseMappingDecision(
  value: unknown,
): CsvImportBatchWorkspace["mappingDecisions"][number] {
  const row = object(value);
  return Object.freeze({
    canonicalField: nullableString(row.canonicalField),
    sourceHeader: string(row.sourceHeader),
  });
}

function parseRowPage(
  value: unknown,
): CsvImportBatchWorkspace["rowPage"] {
  const row = object(value);
  return Object.freeze({
    hasMore: boolean(row.hasMore),
    nextCursor: nullableString(row.nextCursor),
    total: nonnegativeInteger(row.total),
  });
}

function parseSummary(value: unknown): CsvImportBatchSummary {
  const row = object(value);
  const phase = string(row.phase);
  if (!IMPORT_PHASES.has(phase)) throw invalidDto();
  return Object.freeze({
    actorDisplayName: string(row.actorDisplayName),
    actorProfileId: string(row.actorProfileId),
    applicationCursor: nonnegativeInteger(row.applicationCursor),
    approvedAt: nullableInteger(row.approvedAt),
    batchId: string(row.batchId),
    completedAt: nullableInteger(row.completedAt),
    createdAt: nonnegativeInteger(row.createdAt),
    failedRowCount: nonnegativeInteger(row.failedRowCount),
    fileSha256: hash(row.fileSha256),
    importedRowCount: nonnegativeInteger(row.importedRowCount),
    invalidRowCount: nonnegativeInteger(row.invalidRowCount),
    mappingFingerprint: hash(row.mappingFingerprint),
    outcomeCode: nullableString(row.outcomeCode),
    parserVersion: integer(row.parserVersion),
    pendingRowCount: nonnegativeInteger(row.pendingRowCount),
    phase,
    redactionEligible: boolean(row.redactionEligible),
    redactionEligibleAt: nonnegativeInteger(row.redactionEligibleAt),
    selectedRowCount: nonnegativeInteger(row.selectedRowCount),
    skippedRowCount: nonnegativeInteger(row.skippedRowCount),
    sourceLabel: nullableString(row.sourceLabel),
    sourceNamespace: string(row.sourceNamespace),
    sourcePayloadRedactedAt: nullableInteger(row.sourcePayloadRedactedAt),
    startedAt: nullableInteger(row.startedAt),
    templateVersion: integer(row.templateVersion),
    totalRowCount: nonnegativeInteger(row.totalRowCount),
    validRowCount: nonnegativeInteger(row.validRowCount),
    version: integer(row.version),
    warningRowCount: nonnegativeInteger(row.warningRowCount),
  });
}

function parseRow(value: unknown): CsvImportPreviewRowDto {
  const row = object(value);
  const conflictDetails = Object.freeze(
    array(row.conflictDetails).map(parseConflictDetail),
  );
  const conflictDetailsTotal = nonnegativeInteger(
    row.conflictDetailsTotal,
  );
  const conflictDetailsHasMore = boolean(row.conflictDetailsHasMore);
  if (
    conflictDetailsTotal < conflictDetails.length ||
    conflictDetailsHasMore !==
      (conflictDetailsTotal > conflictDetails.length)
  ) {
    throw invalidDto();
  }
  const duplicateDetails = Object.freeze(
    array(row.duplicateDetails).map(parseDuplicateDetail),
  );
  const duplicateDetailsTotal = nonnegativeInteger(
    row.duplicateDetailsTotal,
  );
  const duplicateDetailsHasMore = boolean(row.duplicateDetailsHasMore);
  if (
    duplicateDetailsTotal < duplicateDetails.length ||
    duplicateDetailsHasMore !==
      (duplicateDetailsTotal > duplicateDetails.length)
  ) {
    throw invalidDto();
  }
  return Object.freeze({
    applicationState: string(row.applicationState),
    approvalAction: string(row.approvalAction),
    canSelect: boolean(row.canSelect),
    conflictDetails,
    conflictDetailsHasMore,
    conflictDetailsTotal,
    defaultsApplied: stringArray(row.defaultsApplied),
    duplicateDetails,
    duplicateDetailsHasMore,
    duplicateDetailsTotal,
    errorCodes: stringArray(row.errorCodes),
    mappingFields: stringArray(row.mappingFields),
    matchSummary: parseMatchSummary(row.matchSummary),
    normalized:
      row.normalized === null
        ? null
        : safeJsonRecord(row.normalized, 0),
    previewResultCode: string(row.previewResultCode),
    resultCode: nullableString(row.resultCode),
    rowId: string(row.rowId),
    sourceRowNumber: nonnegativeInteger(row.sourceRowNumber),
    targetEventId: nullableString(row.targetEventId),
    warningCodes: stringArray(row.warningCodes),
  });
}

function parseDuplicateDetail(
  value: unknown,
): CsvImportPreviewRowDto["duplicateDetails"][number] {
  const row = object(value);
  const code = string(row.code);
  if (
    code !== "hard_duplicate_batch_fingerprint" &&
    code !== "hard_duplicate_meetup_url" &&
    code !== "hard_duplicate_source" &&
    code !== "semantic_duplicate_warning"
  ) {
    throw invalidDto();
  }
  const source = string(row.source);
  if (source !== "existing_event" && source !== "import_row") {
    throw invalidDto();
  }
  return Object.freeze({
    code,
    referenceId: string(row.referenceId),
    source,
    sourceRowNumber: nullableInteger(row.sourceRowNumber),
    title: nullableString(row.title),
  });
}

function parseConflictDetail(
  value: unknown,
): CsvImportPreviewRowDto["conflictDetails"][number] {
  const row = object(value);
  const source = string(row.source);
  if (!CONFLICT_SOURCES.has(source)) throw invalidDto();
  return Object.freeze({
    endsAtUtc: nonnegativeInteger(row.endsAtUtc),
    planningStatus: string(row.planningStatus),
    referenceId: string(row.referenceId),
    source:
      source as CsvImportPreviewRowDto["conflictDetails"][number]["source"],
    sourceRowNumber: nullableInteger(row.sourceRowNumber),
    startsAtUtc: nonnegativeInteger(row.startsAtUtc),
    title: string(row.title),
  });
}

function parseMatchSummary(
  value: unknown,
): CsvImportPreviewRowDto["matchSummary"] {
  const row = object(value);
  return Object.freeze({
    category: nullableString(row.category),
    club: nullableString(row.club),
    coOrganizers: stringArray(row.coOrganizers),
    lane: nullableString(row.lane),
    primaryOrganizer: nullableString(row.primaryOrganizer),
    program: nullableString(row.program),
    venue: nullableString(row.venue),
  });
}

function safeJsonRecord(
  value: unknown,
  depth: number,
): Readonly<Record<string, unknown>> {
  if (depth > 6) throw invalidDto();
  const row = object(value);
  const entries = Object.entries(row);
  if (entries.length > 64) throw invalidDto();
  return Object.freeze(
    Object.fromEntries(
      entries.map(([key, item]) => [
        key,
        safeJsonValue(item, depth + 1),
      ]),
    ),
  );
}

function safeJsonValue(value: unknown, depth: number): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 32_768) throw invalidDto();
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 64 || depth > 6) throw invalidDto();
    return Object.freeze(value.map((item) => safeJsonValue(item, depth + 1)));
  }
  return safeJsonRecord(value, depth);
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidDto();
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length > 2_000) throw invalidDto();
  return value;
}

function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 32_768) {
    throw invalidDto();
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}

function hash(value: unknown): string {
  const parsed = string(value);
  if (!/^[0-9a-f]{64}$/u.test(parsed)) throw invalidDto();
  return parsed;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw invalidDto();
  }
  return value as number;
}

function nonnegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidDto();
  }
  return value as number;
}

function nullableInteger(value: unknown): number | null {
  return value === null ? null : nonnegativeInteger(value);
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalidDto();
  return value;
}

function stringArray(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    !value.every((item) => typeof item === "string" && item.length <= 256)
  ) {
    throw invalidDto();
  }
  return Object.freeze([...value]) as readonly string[];
}

function invalidDto(): TypeError {
  return new TypeError("Unexpected CSV import response");
}
