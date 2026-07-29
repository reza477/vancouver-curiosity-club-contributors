import {
  authorizeMembership,
  type AuthorizedMembership,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type D1Value,
  type TrustedServerIdentity,
} from "../auth";
import {
  CSV_IMPORT_CANONICAL_COLUMNS,
  CSV_IMPORT_IGNORE,
  CSV_IMPORT_PARSER_VERSION,
  CSV_IMPORT_TEMPLATE_VERSION,
  automaticCsvHeaderSelections,
  createCsvImportHeaderMapping,
  normalizeCsvImport,
  parseCsvImportBytes,
  parseCsvSourceNamespace,
  validateCsvImportUploadMetadata,
  type CsvImportHeaderSelection,
  type NormalizedCsvImportPayload,
  type NormalizedCsvImportRow,
} from "../../imports/csv";
import {
  normalizeAllDayConflictInterval,
  normalizeConflictInterval,
} from "../organizer/conflict-domain";
import {
  createOrganizerEventFromCanonicalImport,
  type CanonicalImportOrganizerEventInput,
} from "../organizer/events";
import { currentD1Time } from "../organizer/conflicts";
import {
  parseBoundedString,
  parseFiniteInteger,
  parseIdentifier,
  parseObject,
  parseOptionalBoundedString,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  parseCalendarDate,
  parseIanaTimeZone,
} from "../../time";

const TEMPLATE_VERSION_NUMBER = 1;
const PARSER_VERSION_NUMBER = 1;
const MAX_JSON_BIND_BYTES = 96 * 1024;
const MAX_APPROVAL_DECISION_CHUNKS = 92;
const MAX_DUPLICATE_CANDIDATE_CHUNKS = 95;
const MAX_PREVIEW_ROW_CHUNKS = 96;
const IMPORT_HISTORY_DEFAULT_LIMIT = 25;
const IMPORT_HISTORY_MAX_LIMIT = 100;
const IMPORT_ROW_DETAIL_DEFAULT_LIMIT = 50;
const IMPORT_ROW_DETAIL_MAX_LIMIT = 100;
const MAX_CONFLICT_DETAIL_IDENTITIES = 8;
const MAX_DUPLICATE_DETAIL_IDENTITIES = 8;
const MAX_DUPLICATE_DETAIL_TOTAL = 10_000;
const RUNNER_LEASE_MS = 5 * 60_000;
const REDACTION_AGE_MS = 90 * 24 * 60 * 60_000;

const PREVIEW_RATE_ACTIONS = Object.freeze([
  {
    action: "csv_import_preview_15m",
    durationMs: 15 * 60_000,
  },
  {
    action: "csv_import_batch_day",
    durationMs: 24 * 60 * 60_000,
  },
] as const);

type ImportIssue = Readonly<{
  code: string;
  message: string;
  path: string;
}>;

type ImportReferenceKind =
  | "category"
  | "club"
  | "lane"
  | "program"
  | "venue";

type ImportReference = Readonly<{
  id: string;
  kind: ImportReferenceKind;
  name: string;
  parentId: string | null;
  slug: string;
}>;

type ImportOrganizerReference = Readonly<{
  active: boolean;
  clubIds: readonly string[];
  displayName: string | null;
  invited: boolean;
  normalizedEmail: string;
  profileId: string | null;
  role: "administrator" | "organizer" | "owner";
}>;

export type CsvImportPreviewConflictDetail = Readonly<{
  endsAtUtc: number;
  planningStatus: string;
  referenceId: string;
  source:
    | "existing_legacy"
    | "existing_meetup"
    | "existing_organizer"
    | "import_row";
  sourceRowNumber: number | null;
  startsAtUtc: number;
  title: string;
}>;

export type CsvImportPreviewDuplicateDetail = Readonly<{
  code:
    | "hard_duplicate_batch_fingerprint"
    | "hard_duplicate_meetup_url"
    | "hard_duplicate_source"
    | "semantic_duplicate_warning";
  referenceId: string;
  source: "existing_event" | "import_row";
  sourceRowNumber: number | null;
  title: string | null;
}>;

export type CsvImportPreviewMatchSummary = Readonly<{
  category: string | null;
  club: string | null;
  coOrganizers: readonly string[];
  lane: string | null;
  primaryOrganizer: string | null;
  program: string | null;
  venue: string | null;
}>;

type ResolvedImportPayload = Readonly<{
  attendanceMode: NormalizedCsvImportPayload["attendanceMode"];
  bufferAfterMinutes: number;
  bufferBeforeMinutes: number;
  categoryId: string | null;
  clubId: string;
  coOrganizerProfileIds: readonly string[];
  externalId: string | null;
  eventLaneId: string | null;
  meetupUrl: string | null;
  planningStatus: NormalizedCsvImportPayload["planningStatus"];
  primaryOrganizerProfileId: string;
  privateNotes: string | null;
  programId: string | null;
  publicationStatus: "private";
  schedule: NormalizedCsvImportPayload["schedule"];
  title: string;
  venueId: string | null;
}>;

type PreparedPreviewRow = Readonly<{
  applicationIdempotencyKey: string;
  conflictDetails: readonly CsvImportPreviewConflictDetail[];
  conflictDetailsTotal: number;
  defaultsApplied: readonly string[];
  duplicateDetails: readonly CsvImportPreviewDuplicateDetail[];
  duplicateDetailsTotal: number;
  errorCodes: readonly string[];
  issues: readonly ImportIssue[];
  mappingFields: readonly string[];
  mappedValues: Readonly<Record<string, string>>;
  matchSummary: CsvImportPreviewMatchSummary;
  normalizedPayload: ResolvedImportPayload | null;
  normalizedRowFingerprint: string;
  previewResultCode:
    | "hard_duplicate"
    | "invalid"
    | "valid"
    | "warning";
  rowId: string;
  sourceRowNumber: number;
  warningCodes: readonly string[];
}>;

export type CsvImportPreviewInput = Readonly<{
  bytes: Uint8Array;
  contentType: string | null;
  fileName: string;
  headerSelections: readonly CsvImportHeaderSelection[];
  inspectionBatchId?: unknown;
  sourceLabel: unknown;
  sourceNamespace: unknown;
}>;

export type CsvImportApprovalDecision = Readonly<{
  action: "create_separate" | "selected" | "skip";
  conflictReason?: unknown;
  duplicateReason?: unknown;
  rowId: unknown;
}>;

export type CsvImportBatchSummary = Readonly<{
  actorDisplayName: string;
  actorProfileId: string;
  applicationCursor: number;
  approvedAt: number | null;
  batchId: string;
  completedAt: number | null;
  createdAt: number;
  failedRowCount: number;
  fileSha256: string;
  importedRowCount: number;
  invalidRowCount: number;
  mappingFingerprint: string;
  outcomeCode: string | null;
  parserVersion: number;
  pendingRowCount: number;
  phase: string;
  redactionEligible: boolean;
  redactionEligibleAt: number;
  selectedRowCount: number;
  skippedRowCount: number;
  sourceLabel: string | null;
  sourceNamespace: string;
  sourcePayloadRedactedAt: number | null;
  startedAt: number | null;
  templateVersion: number;
  totalRowCount: number;
  validRowCount: number;
  version: number;
  warningRowCount: number;
}>;

export type CsvImportHistoryQuery = Readonly<{
  actorProfileId?: unknown;
  cursor?: unknown;
  limit?: unknown;
  phase?: unknown;
  sourceNamespace?: unknown;
}>;

export type CsvImportHistoryPage = Readonly<{
  hasMore: boolean;
  items: readonly CsvImportBatchSummary[];
  nextCursor: string | null;
  total: number;
}>;

export type CsvImportPreviewRowDto = Readonly<{
  applicationState: string;
  approvalAction: string;
  canSelect: boolean;
  conflictDetails: readonly CsvImportPreviewConflictDetail[];
  conflictDetailsHasMore: boolean;
  conflictDetailsTotal: number;
  defaultsApplied: readonly string[];
  duplicateDetails: readonly CsvImportPreviewDuplicateDetail[];
  duplicateDetailsHasMore: boolean;
  duplicateDetailsTotal: number;
  errorCodes: readonly string[];
  mappingFields: readonly string[];
  matchSummary: CsvImportPreviewMatchSummary;
  normalized: Readonly<Record<string, unknown>> | null;
  previewResultCode: string;
  resultCode: string | null;
  rowId: string;
  sourceRowNumber: number;
  targetEventId: string | null;
  warningCodes: readonly string[];
}>;

export type CsvImportBatchWorkspace = Readonly<{
  batch: CsvImportBatchSummary;
  conflictPolicyMode:
    | "block"
    | "require_admin_approval"
    | "warn_reason";
  mappingDecisions: readonly Readonly<{
    canonicalField: string | null;
    sourceHeader: string;
  }>[];
  previewFingerprint: string | null;
  previewVersion: number;
  rowPage: Readonly<{
    hasMore: boolean;
    nextCursor: string | null;
    total: number;
  }>;
  rows: readonly CsvImportPreviewRowDto[];
}>;

export type CsvImportBatchRowsQuery = Readonly<{
  cursor?: unknown;
  limit?: unknown;
}>;

export type CsvImportApplyResult = Readonly<{
  batch: CsvImportBatchWorkspace;
  row: Readonly<{
    eventId: string | null;
    resultCode: string;
    rowId: string | null;
  }>;
}>;

export type CsvImportInspection = Readonly<{
  dataRowCount: number;
  fileSha256: string;
  headers: readonly string[];
  inspectionBatchId: string;
  suggestedSelections: readonly CsvImportHeaderSelection[];
}>;

export async function inspectCsvImportUpload(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  input: Readonly<{
    bytes: Uint8Array;
    contentType: string | null;
    fileName: string;
    sourceLabel: unknown;
    sourceNamespace: unknown;
  }>,
): Promise<CsvImportInspection> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  validateCsvImportUploadMetadata({
    contentType: input.contentType,
    fileName: input.fileName,
    size: input.bytes.byteLength,
  });
  const sourceNamespace = parseCsvSourceNamespace(input.sourceNamespace);
  const sourceLabel = parseOptionalBoundedString(input.sourceLabel, {
    path: "sourceLabel",
    maxLength: 160,
  });
  const now = await currentD1Time(database);
  const rateStatements = await prepareImportRateAdmissionStatements(
    database,
    actor,
    PREVIEW_RATE_ACTIONS,
    now,
  );
  await runExactBatch(database, rateStatements, {
    requiredPositiveIndexes: rateStatements.map((_, index) => index),
  });
  const parsed = parseCsvImportBytes(input.bytes, {
    contentType: input.contentType,
    fileName: input.fileName,
  });
  const inspectionBatchId = `import-batch:${crypto.randomUUID()}`;
  const fileSha256 = await sha256Hex(input.bytes);
  const automaticSelections = automaticCsvHeaderSelections(
    parsed.headers,
  );
  const automaticMapping = Object.freeze(
    parsed.headers.map((sourceHeader, sourceIndex) =>
      Object.freeze({
        canonicalField:
          automaticSelections[sourceIndex] === CSV_IMPORT_IGNORE ||
          automaticSelections[sourceIndex] === null
            ? null
            : automaticSelections[sourceIndex],
        sourceHeader,
        sourceIndex,
      }),
    ),
  );
  const mappingJson = JSON.stringify(
    Object.fromEntries(
      automaticMapping.map((assignment) => [
        assignment.sourceHeader,
        assignment.canonicalField,
      ]),
    ),
  );
  const mappingFingerprint = await sha256Hex(
    JSON.stringify([
      CSV_IMPORT_TEMPLATE_VERSION,
      CSV_IMPORT_PARSER_VERSION,
      automaticMapping,
    ]),
  );
  await runExactBatch(
    database,
    [
      database
        .prepare(
          `INSERT INTO import_batches (
             id, organization_id, source_type, source_label, status,
             created_by_profile_id, created_at, completed_at
           ) VALUES (?, ?, 'csv', ?, 'pending', ?, ?, NULL)`,
        )
        .bind(
          inspectionBatchId,
          actor.organizationId,
          sourceLabel,
          actor.profileId,
          now,
        ),
      database
        .prepare(
          `INSERT INTO import_batch_details (
             import_batch_id, organization_id, file_sha256,
             source_namespace, template_version, parser_version,
             encoding, delimiter, column_mapping_json,
             mapping_fingerprint, preview_fingerprint, preview_version,
             total_row_count, valid_row_count, invalid_row_count,
             warning_row_count, selected_row_count, imported_row_count,
             skipped_row_count, failed_row_count, pending_row_count,
             phase, outcome_code, application_cursor, version,
             approved_by_profile_id, approved_at, started_at,
             completed_at, active_runner_version,
             active_runner_lease_hash, active_runner_expires_at,
             source_payload_redacted_at, redacted_by_profile_id,
             updated_by_profile_id, created_at, updated_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, 'utf-8', ',', ?, ?, NULL, 0,
             0, 0, 0, 0, 0, 0, 0, 0, 0, 'uploaded', NULL, 0, 1,
             NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
             ?, ?, ?
           )`,
        )
        .bind(
          inspectionBatchId,
          actor.organizationId,
          fileSha256,
          sourceNamespace,
          TEMPLATE_VERSION_NUMBER,
          PARSER_VERSION_NUMBER,
          mappingJson,
          mappingFingerprint,
          actor.profileId,
          now,
          now,
        ),
      database
        .prepare(
          `INSERT INTO audit_logs (
             id, organization_id, actor_profile_id, action,
             entity_type, entity_id, metadata_json, created_at
           ) VALUES (
             ?, ?, ?, 'import.batch_created', 'import_batch', ?, ?, ?
           )`,
        )
        .bind(
          `audit:${crypto.randomUUID()}`,
          actor.organizationId,
          actor.profileId,
          inspectionBatchId,
          JSON.stringify({
            parserVersion: PARSER_VERSION_NUMBER,
            templateVersion: TEMPLATE_VERSION_NUMBER,
            totalRowCount: parsed.nonblankRowCount,
          }),
          now,
        ),
    ],
    { requiredPositiveIndexes: [0, 1, 2] },
  );
  return Object.freeze({
    dataRowCount: parsed.nonblankRowCount,
    fileSha256,
    headers: Object.freeze([...parsed.headers]),
    inspectionBatchId,
    suggestedSelections: automaticSelections,
  });
}

async function requireCsvImportInspection(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  inspectionBatchId: string,
  fileSha256: string,
  sourceLabel: string | null,
  sourceNamespace: string,
): Promise<void> {
  const row = await database
    .prepare(
      `SELECT count(*) AS exact_count
       FROM import_batches AS batch
       INNER JOIN import_batch_details AS detail
         ON detail.import_batch_id = batch.id
        AND detail.organization_id = batch.organization_id
       WHERE batch.id = ?
         AND batch.organization_id = ?
         AND batch.source_type = 'csv'
         AND batch.status = 'pending'
         AND batch.source_label IS ?
         AND batch.created_by_profile_id = ?
         AND detail.file_sha256 = ?
         AND detail.template_version = ?
         AND detail.parser_version = ?
         AND detail.encoding = 'utf-8'
         AND detail.delimiter = ','
         AND detail.source_namespace = ?
         AND detail.phase = 'uploaded'
         AND detail.version = 1
         AND detail.preview_version = 0
         AND detail.preview_fingerprint IS NULL
         AND detail.approved_by_profile_id IS NULL
         AND detail.approved_at IS NULL
         AND detail.started_at IS NULL
         AND detail.completed_at IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM import_rows AS row
           WHERE row.organization_id = batch.organization_id
             AND row.import_batch_id = batch.id
         )
         AND (
           SELECT count(*)
           FROM audit_logs AS audit
           WHERE audit.organization_id = batch.organization_id
             AND audit.actor_profile_id = batch.created_by_profile_id
             AND audit.action = 'import.batch_created'
             AND audit.entity_type = 'import_batch'
             AND audit.entity_id = batch.id
         ) = 1`,
    )
    .bind(
      inspectionBatchId,
      actor.organizationId,
      sourceLabel,
      actor.profileId,
      fileSha256,
      TEMPLATE_VERSION_NUMBER,
      PARSER_VERSION_NUMBER,
      sourceNamespace,
    )
    .first<Record<string, unknown>>();
  if (requiredInteger(row?.exact_count) !== 1) throw staleImport();
}

export async function createCsvImportPreview(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  input: CsvImportPreviewInput,
): Promise<CsvImportBatchWorkspace> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  validateCsvImportUploadMetadata({
    contentType: input.contentType,
    fileName: input.fileName,
    size: input.bytes.byteLength,
  });
  const sourceNamespace = parseCsvSourceNamespace(input.sourceNamespace);
  const sourceLabel = parseOptionalBoundedString(input.sourceLabel, {
    path: "sourceLabel",
    maxLength: 160,
  });
  const inspectionBatchId =
    input.inspectionBatchId === undefined
      ? null
      : parseIdentifier(
          input.inspectionBatchId,
          "inspectionBatchId",
        );
  const batchId =
    inspectionBatchId ?? `import-batch:${crypto.randomUUID()}`;
  const parsed = parseCsvImportBytes(input.bytes, {
    contentType: input.contentType,
    fileName: input.fileName,
  });
  const mapping = createCsvImportHeaderMapping(
    parsed.headers,
    input.headerSelections,
  );
  const normalized = await normalizeCsvImport(parsed, mapping);
  const now = await currentD1Time(database);
  const [references, organizers] = await Promise.all([
    loadImportReferences(database, actor.organizationId),
    loadImportOrganizerReferences(database, actor.organizationId, now),
  ]);
  const preparedRows = await preparePreviewRows(
    database,
    actor,
    batchId,
    sourceNamespace,
    normalized.rows.filter((row) => !row.blank),
    references,
    organizers,
  );
  const mappingJson = JSON.stringify(
    Object.fromEntries(
      mapping.map((assignment) => [
        assignment.sourceHeader,
        assignment.canonicalField,
      ]),
    ),
  );
  const mappingFingerprint = await sha256Hex(
    JSON.stringify([
      CSV_IMPORT_TEMPLATE_VERSION,
      CSV_IMPORT_PARSER_VERSION,
      mapping,
    ]),
  );
  const previewFingerprint = await sha256Hex(
    JSON.stringify([
      "vcc-import-preview-v1",
      sourceNamespace,
      mappingFingerprint,
      preparedRows.map((row) => [
        row.sourceRowNumber,
        row.normalizedRowFingerprint,
        row.previewResultCode,
        row.errorCodes,
        row.warningCodes,
        row.normalizedPayload,
      ]),
    ]),
  );
  const fileSha256 = await sha256Hex(input.bytes);
  if (inspectionBatchId !== null) {
    await requireCsvImportInspection(
      database,
      actor,
      inspectionBatchId,
      fileSha256,
      sourceLabel,
      sourceNamespace,
    );
  }
  const validRowCount = preparedRows.filter(
    (row) => row.previewResultCode !== "invalid",
  ).length;
  const invalidRowCount = preparedRows.length - validRowCount;
  const warningRowCount = preparedRows.filter(
    (row) => row.warningCodes.length > 0,
  ).length;
  const rowChunks = chunkJsonValues(
    preparedRows.map((row) =>
      previewPersistenceValue(row, actor, batchId, now),
    ),
  );
  if (rowChunks.length > MAX_PREVIEW_ROW_CHUNKS) {
    throw validationFailure(
      "The normalized preview exceeds the bounded D1 request budget.",
    );
  }
  const rowPayloadCte = jsonPayloadCteSql(
    "preview_payload",
    rowChunks,
  );
  const preludeStatements =
    inspectionBatchId === null
      ? [
          ...await prepareImportRateAdmissionStatements(
            database,
            actor,
            PREVIEW_RATE_ACTIONS,
            now,
          ),
          database
            .prepare(
              `INSERT INTO import_batches (
                 id, organization_id, source_type, source_label, status,
                 created_by_profile_id, created_at, completed_at
               ) VALUES (?, ?, 'csv', ?, 'pending', ?, ?, NULL)`,
            )
            .bind(
              batchId,
              actor.organizationId,
              sourceLabel,
              actor.profileId,
              now,
            ),
          database
            .prepare(
              `INSERT INTO import_batch_details (
                 import_batch_id, organization_id, file_sha256,
                 source_namespace, template_version, parser_version,
                 encoding, delimiter, column_mapping_json,
                 mapping_fingerprint, preview_fingerprint,
                 preview_version, total_row_count, valid_row_count,
                 invalid_row_count, warning_row_count,
                 selected_row_count, imported_row_count,
                 skipped_row_count, failed_row_count, pending_row_count,
                 phase, outcome_code, application_cursor, version,
                 approved_by_profile_id, approved_at, started_at,
                 completed_at, active_runner_version,
                 active_runner_lease_hash, active_runner_expires_at,
                 source_payload_redacted_at, redacted_by_profile_id,
                 updated_by_profile_id, created_at, updated_at
               ) VALUES (
                 ?, ?, ?, ?, ?, ?, 'utf-8', ',', ?, ?, NULL, 0,
                 0, 0, 0, 0, 0, 0, 0, 0, 0, 'uploaded', NULL, 0, 1,
                 NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                 ?, ?, ?
               )`,
            )
            .bind(
              batchId,
              actor.organizationId,
              fileSha256,
              sourceNamespace,
              TEMPLATE_VERSION_NUMBER,
              PARSER_VERSION_NUMBER,
              mappingJson,
              mappingFingerprint,
              actor.profileId,
              now,
              now,
            ),
        ]
      : [];
  const rowInsertStatement = database
    .prepare(
      `WITH ${rowPayloadCte.sql}
       INSERT INTO import_rows (
         id, organization_id, import_batch_id, row_number,
         source_payload_json, normalized_payload_json, status,
         error_code, created_at, updated_at
       )
       SELECT json_extract(item.value, '$.rowId'),
              json_extract(item.value, '$.organizationId'),
              json_extract(item.value, '$.batchId'),
              json_extract(item.value, '$.sourceRowNumber'),
              json_extract(item.value, '$.sourcePayloadJson'),
              json_extract(item.value, '$.normalizedPayloadJson'),
              json_extract(item.value, '$.status'),
              json_extract(item.value, '$.errorCode'),
              json_extract(item.value, '$.createdAt'),
              json_extract(item.value, '$.createdAt')
       FROM preview_payload AS item`,
    )
    .bind(...rowPayloadCte.bindings);
  const rowInsertIndex = preludeStatements.length;
  const detailTransitionIndex = rowInsertIndex + 2;
  const statements: D1PreparedStatementLike[] = [
    ...preludeStatements,
    rowInsertStatement,
    database
      .prepare(
        `INSERT INTO import_row_applications (
           import_row_id, organization_id, import_batch_id,
           normalized_row_fingerprint, idempotency_key,
           preview_result_code, preview_error_codes_json,
           preview_warning_codes_json, approval_action,
           duplicate_decision, duplicate_reason, conflict_decision,
           conflict_reason, target_organizer_event_id, application_state,
           result_code, approved_by_profile_id, apply_actor_profile_id,
           approved_at, applied_at, created_at, updated_at
         )
         SELECT row.id, row.organization_id, row.import_batch_id,
                json_extract(row.source_payload_json,
                             '$._application.normalizedRowFingerprint'),
                json_extract(row.source_payload_json,
                             '$._application.idempotencyKey'),
                json_extract(row.source_payload_json,
                             '$._application.previewResultCode'),
                json_extract(row.source_payload_json,
                             '$._application.errorCodesJson'),
                json_extract(row.source_payload_json,
                             '$._application.warningCodesJson'),
                'pending', NULL, NULL, NULL, NULL, NULL, 'previewed',
                NULL, NULL, NULL, NULL, NULL, ?, ?
         FROM import_rows AS row
         WHERE row.organization_id = ?
           AND row.import_batch_id = ?`,
      )
      .bind(now, now, actor.organizationId, batchId),
    database
      .prepare(
        `UPDATE import_batch_details
         SET column_mapping_json = ?,
             mapping_fingerprint = ?,
             preview_fingerprint = ?,
             preview_version = 1,
             total_row_count = ?,
             valid_row_count = ?,
             invalid_row_count = ?,
             warning_row_count = ?,
             phase = 'previewed',
             version = 2,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE import_batch_id = ?
           AND organization_id = ?
           AND file_sha256 = ?
           AND source_namespace = ?
           AND phase = 'uploaded'
           AND version = 1
           AND EXISTS (
             SELECT 1
             FROM import_batches AS batch
             WHERE batch.id = import_batch_details.import_batch_id
               AND batch.organization_id =
                   import_batch_details.organization_id
               AND batch.source_type = 'csv'
               AND batch.status = 'pending'
               AND batch.source_label IS ?
               AND batch.created_by_profile_id = ?
           )`,
      )
      .bind(
        mappingJson,
        mappingFingerprint,
        previewFingerprint,
        preparedRows.length,
        validRowCount,
        invalidRowCount,
        warningRowCount,
        actor.profileId,
        now,
        batchId,
        actor.organizationId,
        fileSha256,
        sourceNamespace,
        sourceLabel,
        actor.profileId,
      ),
    ...(inspectionBatchId === null
      ? [
          database
            .prepare(
              `INSERT INTO audit_logs (
                 id, organization_id, actor_profile_id, action,
                 entity_type, entity_id, metadata_json, created_at
               ) VALUES (
                 ?, ?, ?, 'import.batch_created',
                 'import_batch', ?, ?, ?
               )`,
            )
            .bind(
              `audit:${crypto.randomUUID()}`,
              actor.organizationId,
              actor.profileId,
              batchId,
              JSON.stringify({
                parserVersion: PARSER_VERSION_NUMBER,
                templateVersion: TEMPLATE_VERSION_NUMBER,
                totalRowCount: preparedRows.length,
              }),
              now,
            ),
        ]
      : []),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action, entity_type,
           entity_id, metadata_json, created_at
         ) VALUES (
           ?, ?, ?, 'import.mapping_confirmed', 'import_batch', ?, ?, ?
         )`,
      )
      .bind(
        `audit:${crypto.randomUUID()}`,
        actor.organizationId,
        actor.profileId,
        batchId,
        JSON.stringify({
          mappedColumnCount: input.headerSelections.filter(
            (selection) =>
              selection !== null && selection !== CSV_IMPORT_IGNORE,
          ).length,
          mappingFingerprint,
        }),
        now,
      ),
  ];
  const mappingAuditIndex = statements.length - 1;
  const batchCreatedAuditIndex =
    inspectionBatchId === null ? statements.length - 2 : null;
  await runExactBatch(database, statements, {
    requiredPositiveIndexes: [
      ...preludeStatements.map((_, index) => index),
      detailTransitionIndex,
      ...(batchCreatedAuditIndex === null
        ? []
        : [batchCreatedAuditIndex]),
      mappingAuditIndex,
    ],
  });
  return readCsvImportBatchForActor(database, actor, batchId);
}

export async function approveCsvImportBatch(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  batchIdValue: unknown,
  value: unknown,
): Promise<CsvImportBatchWorkspace> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const batchId = parseIdentifier(batchIdValue, "batchId");
  const body = parseObject(value, "body");
  const expectedVersion = parseFiniteInteger(body.expectedVersion, {
    path: "expectedVersion",
    minimum: 1,
  });
  const previewFingerprint = parseHash(
    body.previewFingerprint,
    "previewFingerprint",
  );
  const decisions = parseApprovalDecisions(body.decisions);
  const [current, conflictPolicyMode] = await Promise.all([
    loadImportApprovalSource(database, actor, batchId),
    loadImportConflictPolicyMode(database, actor),
  ]);
  if (
    current.version !== expectedVersion ||
    current.previewFingerprint !== previewFingerprint ||
    current.phase !== "previewed"
  ) {
    throw staleImport();
  }
  if (
    decisions.length !== current.rows.length ||
    decisions.some(
      (decision) =>
        !current.rows.some((row) => row.rowId === decision.rowId),
    )
  ) {
    throw validationFailure(
      "Provide one explicit approval decision for every preview row.",
    );
  }
  const decisionMap = new Map(decisions.map((decision) => [
    decision.rowId,
    decision,
  ]));
  if (decisionMap.size !== decisions.length) {
    throw validationFailure(
      "Each preview row can have only one approval decision.",
    );
  }
  const now = await currentD1Time(database);
  const persistedDecisions = current.rows.map((row) =>
    approvalPersistenceDecision(
      row,
      decisionMap.get(row.rowId)!,
      conflictPolicyMode,
    ),
  );
  const selectedRowCount = persistedDecisions.filter(
    (decision) =>
      decision.action === "selected" ||
      decision.action === "create_separate",
  ).length;
  const skippedRowCount = persistedDecisions.length - selectedRowCount;
  const decisionChunks = chunkJsonValues(persistedDecisions);
  if (decisionChunks.length > MAX_APPROVAL_DECISION_CHUNKS) {
    throw validationFailure(
      "The approval reasons are too large. Shorten the written reasons and try again.",
    );
  }
  const decisionPayloadCte = jsonPayloadCteSql(
    "decision_payload",
    decisionChunks,
  );
  const decisionsCteSql = `${decisionPayloadCte.sql},
    decisions AS (
      SELECT json_extract(value, '$.rowId') AS row_id,
             json_extract(value, '$.action') AS action,
             json_extract(value, '$.duplicateDecision')
               AS duplicate_decision,
             json_extract(value, '$.duplicateReason')
               AS duplicate_reason,
             json_extract(value, '$.conflictDecision')
               AS conflict_decision,
             json_extract(value, '$.conflictReason')
               AS conflict_reason,
             json_extract(value, '$.applicationState')
               AS application_state,
             json_extract(value, '$.resultCode') AS result_code
      FROM decision_payload
    )`;
  const applicationDecisionStatement = database
    .prepare(
      `WITH ${decisionsCteSql}
       UPDATE import_row_applications AS application
       SET approval_action = (
             SELECT decision.action
             FROM decisions AS decision
             WHERE decision.row_id = application.import_row_id
           ),
           duplicate_decision = (
             SELECT decision.duplicate_decision
             FROM decisions AS decision
             WHERE decision.row_id = application.import_row_id
           ),
           duplicate_reason = (
             SELECT decision.duplicate_reason
             FROM decisions AS decision
             WHERE decision.row_id = application.import_row_id
           ),
           conflict_decision = (
             SELECT decision.conflict_decision
             FROM decisions AS decision
             WHERE decision.row_id = application.import_row_id
           ),
           conflict_reason = (
             SELECT decision.conflict_reason
             FROM decisions AS decision
             WHERE decision.row_id = application.import_row_id
           ),
           application_state = (
             SELECT decision.application_state
             FROM decisions AS decision
             WHERE decision.row_id = application.import_row_id
           ),
           result_code = (
             SELECT decision.result_code
             FROM decisions AS decision
             WHERE decision.row_id = application.import_row_id
           ),
           approved_by_profile_id = ?,
           apply_actor_profile_id = CASE
             WHEN (
               SELECT decision.application_state
               FROM decisions AS decision
               WHERE decision.row_id = application.import_row_id
             ) = 'skipped'
             THEN ? ELSE NULL
           END,
           approved_at = ?,
           applied_at = CASE
             WHEN (
               SELECT decision.application_state
               FROM decisions AS decision
               WHERE decision.row_id = application.import_row_id
             ) = 'skipped'
             THEN ? ELSE NULL
           END,
           updated_at = ?
       WHERE application.organization_id = ?
         AND application.import_batch_id = ?
         AND application.application_state = 'previewed'
         AND application.approval_action = 'pending'
         AND EXISTS (
           SELECT 1
           FROM decisions AS decision
           WHERE decision.row_id = application.import_row_id
         )`,
    )
    .bind(
      ...decisionPayloadCte.bindings,
      actor.profileId,
      actor.profileId,
      now,
      now,
      now,
      actor.organizationId,
      batchId,
    );
  const importRowDecisionStatement = database
    .prepare(
      `WITH ${decisionsCteSql}
       UPDATE import_rows AS row
       SET status = CASE
             WHEN (
               SELECT decision.application_state
               FROM decisions AS decision
               WHERE decision.row_id = row.id
             ) = 'skipped'
             THEN 'skipped'
             WHEN row.normalized_payload_json IS NULL THEN 'rejected'
             ELSE 'accepted'
           END,
           updated_at = ?
       WHERE row.organization_id = ?
         AND row.import_batch_id = ?
         AND EXISTS (
           SELECT 1
           FROM decisions AS decision
           WHERE decision.row_id = row.id
         )`,
    )
    .bind(
      ...decisionPayloadCte.bindings,
      now,
      actor.organizationId,
      batchId,
    );
  const completesWithoutApplication = selectedRowCount === 0;
  const auditMetadata = JSON.stringify({
    previewFingerprint,
    previewVersion: current.previewVersion,
    selectedRowCount,
    skippedRowCount,
  });
  const statements: D1PreparedStatementLike[] = [
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action, entity_type,
           entity_id, metadata_json, created_at
         ) VALUES (?, ?, ?, 'import.approved', 'import_batch', ?, ?, ?)`,
      )
      .bind(
        `audit:${crypto.randomUUID()}`,
        actor.organizationId,
        actor.profileId,
        batchId,
        auditMetadata,
        now,
      ),
    applicationDecisionStatement,
    importRowDecisionStatement,
    ...(completesWithoutApplication
      ? [
          approvalDetailTransitionStatement(database, actor, {
            approvedAt: now,
            batchId,
            expectedVersion,
            previewFingerprint,
            previewVersion: current.previewVersion,
            selectedRowCount,
            skippedRowCount,
          }),
          approvalCasCompletionStatement(database),
          database
            .prepare(
              `UPDATE import_batch_details
               SET phase = 'applying',
                   started_at = COALESCE(started_at, ?),
                   version = version + 1,
                   updated_by_profile_id = ?,
                   updated_at = ?
               WHERE import_batch_id = ?
                 AND organization_id = ?
                 AND phase = 'approved'
                 AND version = ?
                 AND selected_row_count = 0
                 AND pending_row_count = 0
                 AND application_cursor = 0`,
            )
            .bind(
              now,
              actor.profileId,
              now,
              batchId,
              actor.organizationId,
              expectedVersion + 1,
            ),
          safeImportAuditStatement(database, actor, {
            action: "import.completed",
            batchId,
            metadata: {
              failedRowCount: 0,
              importedRowCount: 0,
              selectedRowCount: 0,
              skippedRowCount,
            },
            now,
          }),
          database
            .prepare(
              `UPDATE import_batches
               SET status = 'completed',
                   completed_at = ?
               WHERE id = ?
                 AND organization_id = ?
                 AND status = 'pending'`,
            )
            .bind(now, batchId, actor.organizationId),
          database
            .prepare(
              `UPDATE import_batch_details
               SET phase = 'completed',
                   outcome_code = 'completed',
                   completed_at = ?,
                   version = version + 1,
                   updated_by_profile_id = ?,
                   updated_at = ?
               WHERE import_batch_id = ?
                 AND organization_id = ?
                 AND phase = 'applying'
                 AND version = ?
                 AND selected_row_count = 0
                 AND pending_row_count = 0
                 AND imported_row_count = 0
                 AND failed_row_count = 0
                 AND application_cursor = 0
                 AND changes() = 1`,
            )
            .bind(
              now,
              actor.profileId,
              now,
              batchId,
              actor.organizationId,
              expectedVersion + 2,
            ),
        ]
      : [
          database
            .prepare(
              `UPDATE import_batches
               SET status = 'processing',
                   completed_at = NULL
               WHERE id = ?
                 AND organization_id = ?
                 AND status = 'pending'`,
            )
            .bind(batchId, actor.organizationId),
          approvalDetailTransitionStatement(database, actor, {
            approvedAt: now,
            batchId,
            expectedVersion,
            previewFingerprint,
            previewVersion: current.previewVersion,
            selectedRowCount,
            skippedRowCount,
          }),
          approvalCasCompletionStatement(database),
        ]),
    approvalEnvelopeSentinelStatement(database, actor, {
      approvedAt: now,
      batchId,
      completed: completesWithoutApplication,
      expectedVersion:
        expectedVersion + (completesWithoutApplication ? 3 : 1),
      previewFingerprint,
      previewVersion: current.previewVersion,
      selectedRowCount,
      skippedRowCount,
    }),
  ];
  const results = await database.batch(statements);
  if (!results.every((result) => result.success !== false)) {
    throw staleImport();
  }
  await assertApprovedImportEnvelope(
    database,
    actor,
    batchId,
    previewFingerprint,
    current.previewVersion,
    selectedRowCount,
    skippedRowCount,
    now,
    completesWithoutApplication ? "completed" : "approved",
  );
  return readCsvImportBatchForActor(database, actor, batchId);
}

export async function listCsvImportBatches(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  query: CsvImportHistoryQuery = {},
): Promise<CsvImportHistoryPage> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const parsedQuery = parseImportHistoryQuery(query);
  const conditions = [
    "batch.organization_id = ?",
    "batch.source_type = 'csv'",
  ];
  const bindings: D1Value[] = [actor.organizationId];
  if (parsedQuery.phase !== null) {
    conditions.push("detail.phase = ?");
    bindings.push(parsedQuery.phase);
  }
  if (parsedQuery.sourceNamespace !== null) {
    conditions.push("detail.source_namespace = ?");
    bindings.push(parsedQuery.sourceNamespace);
  }
  if (parsedQuery.actorProfileId !== null) {
    conditions.push("batch.created_by_profile_id = ?");
    bindings.push(parsedQuery.actorProfileId);
  }
  if (parsedQuery.cursor !== null) {
    conditions.push(
      `(batch.created_at < ?
        OR (batch.created_at = ? AND batch.id < ?))`,
    );
    bindings.push(
      parsedQuery.cursor.createdAt,
      parsedQuery.cursor.createdAt,
      parsedQuery.cursor.batchId,
    );
  }
  const whereSql = conditions.join("\n AND ");
  const pageResult = await database
    .prepare(
      `${IMPORT_BATCH_SUMMARY_SELECT_SQL}
       WHERE ${whereSql}
       ORDER BY batch.created_at DESC, batch.id DESC
       LIMIT ?`,
    )
    .bind(...bindings, parsedQuery.limit + 1)
    .all<Record<string, unknown>>();
  const totalResult = await database
    .prepare(
      `SELECT count(*) AS exact_count
       FROM import_batches AS batch
       INNER JOIN import_batch_details AS detail
         ON detail.import_batch_id = batch.id
        AND detail.organization_id = batch.organization_id
       WHERE ${conditions
         .filter((condition) =>
           !condition.includes("batch.created_at <"),
         )
         .join("\n AND ")}`,
    )
    .bind(
      ...bindings.slice(
        0,
        bindings.length -
          (parsedQuery.cursor === null ? 0 : 3),
      ),
    )
    .all<Record<string, unknown>>();
  assertD1Result(pageResult.success);
  assertD1Result(totalResult.success);
  const rows = pageResult.results ?? [];
  const hasMore = rows.length > parsedQuery.limit;
  const items = rows
    .slice(0, parsedQuery.limit)
    .map(readImportBatchSummary);
  const last = items.at(-1) ?? null;
  return Object.freeze({
    hasMore,
    items: Object.freeze(items),
    nextCursor:
      hasMore && last
        ? encodeImportHistoryCursor(last.createdAt, last.batchId)
        : null,
    total: requiredInteger(totalResult.results?.[0]?.exact_count),
  });
}

const IMPORT_HISTORY_PHASES = Object.freeze([
  "uploaded",
  "previewed",
  "approved",
  "applying",
  "interrupted",
  "completed",
  "completed_with_errors",
  "failed",
  "redacted",
] as const);

function parseImportHistoryQuery(
  value: CsvImportHistoryQuery,
): Readonly<{
  actorProfileId: string | null;
  cursor: Readonly<{ batchId: string; createdAt: number }> | null;
  limit: number;
  phase: (typeof IMPORT_HISTORY_PHASES)[number] | null;
  sourceNamespace: string | null;
}> {
  const phase = parseOptionalBoundedString(value.phase, {
    path: "phase",
    maxLength: 40,
  });
  if (
    phase !== null &&
    !IMPORT_HISTORY_PHASES.includes(
      phase as (typeof IMPORT_HISTORY_PHASES)[number],
    )
  ) {
    throw validationFailure("Choose a valid import-history phase.");
  }
  const cursorValue = parseOptionalBoundedString(value.cursor, {
    path: "cursor",
    maxLength: 600,
  });
  return Object.freeze({
    actorProfileId:
      value.actorProfileId === undefined
        ? null
        : parseIdentifier(value.actorProfileId, "actorProfileId"),
    cursor:
      cursorValue === null
        ? null
        : decodeImportHistoryCursor(cursorValue),
    limit:
      value.limit === undefined
        ? IMPORT_HISTORY_DEFAULT_LIMIT
        : parseFiniteInteger(value.limit, {
            path: "limit",
            minimum: 1,
            maximum: IMPORT_HISTORY_MAX_LIMIT,
          }),
    phase: phase as (typeof IMPORT_HISTORY_PHASES)[number] | null,
    sourceNamespace:
      value.sourceNamespace === undefined
        ? null
        : parseCsvSourceNamespace(value.sourceNamespace),
  });
}

function encodeImportHistoryCursor(
  createdAt: number,
  batchId: string,
): string {
  return encodeURIComponent(JSON.stringify([createdAt, batchId]));
}

function decodeImportHistoryCursor(
  value: string,
): Readonly<{ batchId: string; createdAt: number }> {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      throw new Error("invalid cursor");
    }
    return Object.freeze({
      batchId: parseIdentifier(parsed[1], "cursor.batchId"),
      createdAt: parseFiniteInteger(parsed[0], {
        path: "cursor.createdAt",
        minimum: 0,
      }),
    });
  } catch {
    throw validationFailure("The import-history cursor is invalid.");
  }
}

function encodeImportRowCursor(
  rowNumber: number,
  rowId: string,
): string {
  return encodeURIComponent(JSON.stringify([rowNumber, rowId]));
}

function decodeImportRowCursor(
  value: string,
): Readonly<{ rowId: string; rowNumber: number }> {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      throw new Error("invalid cursor");
    }
    return Object.freeze({
      rowId: parseIdentifier(parsed[1], "cursor.rowId"),
      rowNumber: parseFiniteInteger(parsed[0], {
        path: "cursor.rowNumber",
        minimum: 1,
      }),
    });
  } catch {
    throw validationFailure("The import-row cursor is invalid.");
  }
}

export async function getCsvImportBatch(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  batchIdValue: unknown,
  query: CsvImportBatchRowsQuery = {},
): Promise<CsvImportBatchWorkspace> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const batchId = parseIdentifier(batchIdValue, "batchId");
  return readCsvImportBatchForActor(database, actor, batchId, query);
}

async function readCsvImportBatchForActor(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  batchId: string,
  query: CsvImportBatchRowsQuery = {},
): Promise<CsvImportBatchWorkspace> {
  const limit =
    query.limit === undefined
      ? IMPORT_ROW_DETAIL_DEFAULT_LIMIT
      : parseFiniteInteger(query.limit, {
          path: "limit",
          minimum: 1,
          maximum: IMPORT_ROW_DETAIL_MAX_LIMIT,
        });
  const cursor =
    query.cursor === undefined
      ? null
      : decodeImportRowCursor(
          parseBoundedString(query.cursor, {
            path: "cursor",
            maxLength: 512,
          }),
        );
  const summaryRow = await database
    .prepare(
      `SELECT summary.*,
         conflict_policy.mode AS conflict_policy_mode
       FROM (
         ${IMPORT_BATCH_SUMMARY_SELECT_SQL}
         WHERE batch.organization_id = ?
           AND batch.id = ?
           AND batch.source_type = 'csv'
         LIMIT 1
       ) AS summary
       LEFT JOIN organizer_conflict_policies AS conflict_policy
         ON conflict_policy.organization_id = summary.organization_id`,
    )
    .bind(actor.organizationId, batchId)
    .first<Record<string, unknown>>();
  if (!summaryRow) throw importNotFound();
  const summary = readImportBatchSummary(summaryRow);
  const conflictPolicyMode = readConflictPolicyMode(
    summaryRow.conflict_policy_mode,
  );
  const rowResult = await database
    .prepare(
      `WITH page_rows AS (
         SELECT row.id AS row_id, row.row_number,
                row.normalized_payload_json,
                json_extract(
                  row.source_payload_json,
                  '$._preview.defaultsAppliedJson'
                ) AS defaults_applied_json,
                json_extract(
                  row.source_payload_json,
                  '$._preview.duplicateDetailsJson'
                ) AS duplicate_details_json,
                json_extract(
                  row.source_payload_json,
                  '$._preview.duplicateDetailsTotal'
                ) AS duplicate_details_total,
                json_extract(
                  row.source_payload_json,
                  '$._preview.mappingFieldsJson'
                ) AS mapping_fields_json,
                json_extract(
                  row.source_payload_json,
                  '$._preview.matchSummaryJson'
                ) AS match_summary_json,
                json_extract(
                  row.source_payload_json,
                  '$._preview.conflictDetailsJson'
                ) AS conflict_details_json,
                json_extract(
                  row.source_payload_json,
                  '$._preview.conflictDetailsTotal'
                ) AS conflict_details_total,
                application.preview_result_code,
                application.preview_error_codes_json,
                application.preview_warning_codes_json,
                application.approval_action,
                application.application_state,
                application.result_code,
                application.target_organizer_event_id
         FROM import_rows AS row
         INNER JOIN import_row_applications AS application
           ON application.import_row_id = row.id
          AND application.organization_id = row.organization_id
          AND application.import_batch_id = row.import_batch_id
         WHERE row.organization_id = ?
           AND row.import_batch_id = ?
           AND (
             ? IS NULL
             OR row.row_number > ?
             OR (row.row_number = ? AND row.id > ?)
           )
         ORDER BY row.row_number, row.id
         LIMIT ?
       )
       SELECT detail.version AS observed_version, page_rows.*
       FROM import_batch_details AS detail
       LEFT JOIN page_rows ON 1 = 1
       WHERE detail.import_batch_id = ?
         AND detail.organization_id = ?
         AND detail.version = ?
       ORDER BY page_rows.row_number, page_rows.row_id`,
    )
    .bind(
      actor.organizationId,
      batchId,
      cursor?.rowNumber ?? null,
      cursor?.rowNumber ?? 0,
      cursor?.rowNumber ?? 0,
      cursor?.rowId ?? "",
      limit + 1,
      batchId,
      actor.organizationId,
      summary.version,
    )
    .all<Record<string, unknown>>();
  assertD1Result(rowResult.success);
  const rowRecords = rowResult.results ?? [];
  if (
    rowRecords.length === 0 ||
    requiredInteger(rowRecords[0].observed_version) !== summary.version
  ) {
    throw staleImport();
  }
  const pageRecords = rowRecords.filter((row) => row.row_id !== null);
  const hasMore = pageRecords.length > limit;
  const visibleRecords = pageRecords.slice(0, limit);
  const rows = visibleRecords.map((row) =>
    readImportPreviewRow(row, conflictPolicyMode),
  );
  const lastRow = rows.at(-1) ?? null;
  return Object.freeze({
    batch: summary,
    conflictPolicyMode,
    mappingDecisions: readImportMappingDecisions(
      summaryRow.column_mapping_json,
    ),
    previewFingerprint: optionalString(summaryRow.preview_fingerprint),
    previewVersion: requiredInteger(summaryRow.preview_version),
    rowPage: Object.freeze({
      hasMore,
      nextCursor:
        hasMore && lastRow
          ? encodeImportRowCursor(
              lastRow.sourceRowNumber,
              lastRow.rowId,
            )
          : null,
      total: summary.totalRowCount,
    }),
    rows: Object.freeze(rows),
  });
}

export async function redactCsvImportSourcePayload(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  batchIdValue: unknown,
  expectedVersionValue: unknown,
): Promise<CsvImportBatchWorkspace> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner"],
  });
  const batchId = parseIdentifier(batchIdValue, "batchId");
  const expectedVersion = parseFiniteInteger(expectedVersionValue, {
    path: "expectedVersion",
    minimum: 1,
  });
  const now = await currentD1Time(database);
  let results;
  try {
    results = await database.batch([
      database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action, entity_type,
           entity_id, metadata_json, created_at
         )
         SELECT ?, ?, ?, 'import.source_payload_redacted',
                'import_batch', ?, '{}', ?
         WHERE EXISTS (
           SELECT 1
           FROM import_batch_details AS detail
           WHERE detail.import_batch_id = ?
             AND detail.organization_id = ?
             AND detail.version = ?
             AND detail.phase IN (
               'completed', 'completed_with_errors', 'failed'
             )
             AND detail.source_payload_redacted_at IS NULL
             AND ? >= detail.created_at + ?
         )`,
      )
      .bind(
        `audit:${crypto.randomUUID()}`,
        actor.organizationId,
        actor.profileId,
        batchId,
        now,
        batchId,
        actor.organizationId,
        expectedVersion,
        now,
        REDACTION_AGE_MS,
      ),
      database
      .prepare(
        `UPDATE import_batch_details
         SET phase = 'redacted',
             version = version + 1,
             source_payload_redacted_at = ?,
             redacted_by_profile_id = ?,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE import_batch_id = ?
           AND organization_id = ?
           AND version = ?
           AND phase IN ('completed', 'completed_with_errors', 'failed')
           AND source_payload_redacted_at IS NULL
           AND ? >= created_at + ?
           AND changes() = 1`,
      )
      .bind(
        now,
        actor.profileId,
        actor.profileId,
        now,
        batchId,
        actor.organizationId,
        expectedVersion,
        now,
        REDACTION_AGE_MS,
      ),
      database
      .prepare(
        `UPDATE import_rows
         SET source_payload_json = '{"redacted":true}',
             normalized_payload_json = '{"redacted":true}',
             updated_at = ?
         WHERE organization_id = ?
           AND import_batch_id = ?
           AND EXISTS (
             SELECT 1
             FROM import_batch_details AS detail
             WHERE detail.import_batch_id = import_rows.import_batch_id
               AND detail.organization_id = import_rows.organization_id
               AND detail.phase = 'redacted'
               AND detail.source_payload_redacted_at = ?
               AND detail.redacted_by_profile_id = ?
           )`,
      )
      .bind(
        now,
        actor.organizationId,
        batchId,
        now,
        actor.profileId,
      ),
      database
      .prepare(
        `UPDATE import_batches
         SET status = status
         WHERE id = ?
           AND organization_id = ?
           AND (
             CASE
               WHEN EXISTS (
                 SELECT 1
                 FROM import_batch_details AS detail
                 WHERE detail.import_batch_id = import_batches.id
                   AND detail.organization_id =
                       import_batches.organization_id
                   AND detail.version = ?
                   AND detail.phase = 'redacted'
                   AND detail.source_payload_redacted_at = ?
                   AND detail.redacted_by_profile_id = ?
                   AND detail.total_row_count = changes()
                   AND detail.total_row_count = (
                     SELECT count(*)
                     FROM import_rows AS row
                     WHERE row.organization_id =
                         detail.organization_id
                       AND row.import_batch_id =
                           detail.import_batch_id
                   )
                   AND NOT EXISTS (
                     SELECT 1
                     FROM import_rows AS row
                     WHERE row.organization_id =
                         detail.organization_id
                       AND row.import_batch_id =
                           detail.import_batch_id
                       AND (
                         row.source_payload_json
                           IS NOT '{"redacted":true}'
                         OR row.normalized_payload_json
                           IS NOT '{"redacted":true}'
                       )
                   )
               )
               AND (
                 SELECT count(*)
                 FROM audit_logs AS audit
                 WHERE audit.organization_id = ?
                   AND audit.actor_profile_id = ?
                   AND audit.action =
                       'import.source_payload_redacted'
                   AND audit.entity_type = 'import_batch'
                   AND audit.entity_id = ?
                   AND audit.metadata_json = '{}'
                   AND audit.created_at = ?
               ) = 1
               THEN 1
               ELSE json_extract(
                 'phase7_import_redaction_incomplete',
                 '$'
               )
             END
           ) = 1`,
      )
      .bind(
        batchId,
        actor.organizationId,
        expectedVersion + 1,
        now,
        actor.profileId,
        actor.organizationId,
        actor.profileId,
        batchId,
        now,
      ),
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("malformed JSON")
    ) {
      throw staleImport();
    }
    throw error;
  }
  if (
    changed(results[0]) !== 1 ||
    changed(results[1]) !== 1 ||
    changed(results[2]) > 2_000 ||
    changed(results[3]) !== 1
  ) {
    throw staleImport();
  }
  return readCsvImportBatchForActor(database, actor, batchId);
}

export async function applyNextCsvImportRow(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  batchIdValue: unknown,
  expectedVersionValue: unknown,
): Promise<CsvImportApplyResult> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const batchId = parseIdentifier(batchIdValue, "batchId");
  const expectedVersion = parseFiniteInteger(expectedVersionValue, {
    path: "expectedVersion",
    minimum: 1,
  });
  const source = await loadNextImportApplication(
    database,
    actor,
    batchId,
  );
  if (
    source.phase === "completed" ||
    source.phase === "completed_with_errors"
  ) {
    return Object.freeze({
      batch: await readCsvImportBatchForActor(
        database,
        actor,
        batchId,
      ),
      row: Object.freeze({
        eventId: null,
        resultCode: "already_completed",
        rowId: null,
      }),
    });
  }
  if (
    source.version !== expectedVersion ||
    !["approved", "applying", "interrupted"].includes(source.phase)
  ) {
    throw staleImport();
  }
  if (!source.row) {
    throw staleImport();
  }
  const applicationSource = Object.freeze({
    ...source,
    row: source.row,
  });
  if (applicationSource.row.applicationState === "imported") {
    return Object.freeze({
      batch: await readCsvImportBatchForActor(
        database,
        actor,
        batchId,
      ),
      row: Object.freeze({
        eventId: applicationSource.row.targetEventId,
        resultCode:
          applicationSource.row.resultCode ?? "imported_private",
        rowId: applicationSource.row.rowId,
      }),
    });
  }
  const now = await currentD1Time(database);
  const runnerLeaseHash = await sha256Hex(crypto.randomUUID());
  const runnerVersion = expectedVersion + 1;
  const rateStatements = await prepareImportRateAdmissionStatements(
    database,
    actor,
    [{
      action: "csv_import_apply_hour",
      durationMs: 60 * 60_000,
    }],
    now,
  );
  const acquireResults = await database.batch([
    ...rateStatements,
    database
      .prepare(
        `UPDATE import_batch_details
         SET phase = 'applying',
             version = version + 1,
             started_at = COALESCE(started_at, ?),
             active_runner_version = ?,
             active_runner_lease_hash = ?,
             active_runner_expires_at = ?,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE import_batch_id = ?
           AND organization_id = ?
           AND version = ?
           AND phase IN ('approved', 'applying', 'interrupted')
           AND (
             active_runner_expires_at IS NULL
             OR active_runner_expires_at <= ?
           )
           AND EXISTS (
             SELECT 1
             FROM import_row_applications AS application
             WHERE application.import_batch_id =
                   import_batch_details.import_batch_id
               AND application.organization_id =
                   import_batch_details.organization_id
               AND application.import_row_id = ?
               AND application.application_state IN ('approved', 'applying')
           )`,
      )
      .bind(
        now,
        runnerVersion,
        runnerLeaseHash,
        now + RUNNER_LEASE_MS,
        actor.profileId,
        now,
        batchId,
        actor.organizationId,
        expectedVersion,
        now,
        applicationSource.row.rowId,
      ),
    database
      .prepare(
        `UPDATE import_row_applications AS application
         SET application_state = 'applying',
             apply_actor_profile_id = ?,
             updated_at = ?
         WHERE application.import_row_id = ?
           AND application.import_batch_id = ?
           AND application.organization_id = ?
           AND application.application_state IN ('approved', 'applying')
           AND application.approval_action IN (
             'selected', 'create_separate'
           )
           AND EXISTS (
             SELECT 1
             FROM import_batch_details AS detail
             WHERE detail.import_batch_id = application.import_batch_id
               AND detail.organization_id = application.organization_id
               AND detail.version = ?
               AND detail.phase = 'applying'
               AND detail.active_runner_version = ?
               AND detail.active_runner_lease_hash = ?
               AND detail.active_runner_expires_at > ?
           )`,
      )
      .bind(
        actor.profileId,
        now,
        applicationSource.row.rowId,
        batchId,
        actor.organizationId,
        runnerVersion,
        runnerVersion,
        runnerLeaseHash,
        now,
      ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action, entity_type,
           entity_id, metadata_json, created_at
         )
         SELECT ?, ?, ?, 'import.resumed', 'import_batch', ?, ?, ?
         WHERE changes() >= 1`,
      )
      .bind(
        `audit:${crypto.randomUUID()}`,
        actor.organizationId,
        actor.profileId,
        batchId,
        JSON.stringify({
          applicationCursor: source.applicationCursor,
          runnerVersion,
        }),
        now,
      ),
  ]);
  if (
    changed(acquireResults[rateStatements.length]) < 1 ||
    changed(acquireResults[rateStatements.length + 1]) < 1 ||
    changed(acquireResults[rateStatements.length + 2]) < 1
  ) {
    throw staleImport();
  }

  const duplicateAtApply = await findApplyDuplicate(
    database,
    actor.organizationId,
    source.sourceNamespace,
    applicationSource.row.payload,
    applicationSource.row.normalizedRowFingerprint,
  );
  if (duplicateAtApply) {
    await finishFailedImportApplication(
      database,
      actor,
      applicationSource,
      {
      batchId,
      resultCode: "duplicate_detected_at_apply",
      runnerLeaseHash,
      runnerVersion,
      now,
      },
    );
    return Object.freeze({
      batch: await readCsvImportBatchForActor(
        database,
        actor,
        batchId,
      ),
      row: Object.freeze({
        eventId: null,
        resultCode: "duplicate_detected_at_apply",
        rowId: applicationSource.row.rowId,
      }),
    });
  }

  const eventInput = canonicalEventInputFromResolvedImport(
    applicationSource.row.payload,
    applicationSource.row.conflictReason,
    applicationSource.row.conflictDecision,
  );
  try {
    const result = await createOrganizerEventFromCanonicalImport(
      database,
      identity,
      eventInput,
      (context) =>
        successfulImportExtensionStatements(
          database,
          actor,
          applicationSource,
          {
            batchId,
            eventId: context.eventId,
            now: context.occurredAt,
            resultCode:
              context.scheduleOutcome === "pending_approval"
                ? "imported_private_pending_administrator_review"
                : "imported_private",
            reviewRequestId: context.reviewRequestId,
            runnerLeaseHash,
            runnerVersion,
          },
        ),
      now,
    );
    return Object.freeze({
      batch: await readCsvImportBatchForActor(
        database,
        actor,
        batchId,
      ),
      row: Object.freeze({
        eventId: result.eventId,
        resultCode:
          result.outcome === "pending_approval"
            ? "imported_private_pending_administrator_review"
            : "imported_private",
        rowId: applicationSource.row.rowId,
      }),
    });
  } catch (error) {
    const resultCode = safeImportFailureCode(error);
    await finishFailedImportApplication(
      database,
      actor,
      applicationSource,
      {
        batchId,
        resultCode,
        runnerLeaseHash,
        runnerVersion,
        now,
      },
    );
    return Object.freeze({
      batch: await readCsvImportBatchForActor(
        database,
        actor,
        batchId,
      ),
      row: Object.freeze({
        eventId: null,
        resultCode,
        rowId: applicationSource.row.rowId,
      }),
    });
  }
}

const IMPORT_BATCH_SUMMARY_SELECT_SQL = `
SELECT batch.id AS batch_id, batch.organization_id,
       batch.source_label, batch.created_by_profile_id,
       CASE
         WHEN actor.display_name IS NOT NULL
          AND length(trim(actor.display_name)) BETWEEN 1 AND 120
          AND instr(actor.display_name, '@') = 0
         THEN actor.display_name
         ELSE 'Organizer'
       END AS actor_display_name,
       batch.created_at AS batch_created_at,
       COALESCE(detail.completed_at, batch.completed_at) AS completed_at,
       detail.file_sha256, detail.source_namespace,
       detail.template_version, detail.parser_version,
       detail.column_mapping_json, detail.mapping_fingerprint,
       detail.preview_fingerprint, detail.preview_version,
       detail.total_row_count, detail.valid_row_count,
       detail.invalid_row_count, detail.warning_row_count,
       detail.selected_row_count, detail.imported_row_count,
       detail.skipped_row_count, detail.failed_row_count,
       detail.pending_row_count, detail.phase, detail.application_cursor,
       detail.outcome_code, detail.approved_at, detail.started_at,
       detail.source_payload_redacted_at,
       detail.created_at + ${REDACTION_AGE_MS} AS redaction_eligible_at,
       CASE
         WHEN detail.source_payload_redacted_at IS NULL
          AND detail.phase IN (
            'completed', 'completed_with_errors', 'failed'
          )
          AND CAST(unixepoch('subsec') * 1000 AS INTEGER) >=
              detail.created_at + ${REDACTION_AGE_MS}
         THEN 1 ELSE 0
       END AS redaction_eligible,
       detail.version
FROM import_batches AS batch
INNER JOIN import_batch_details AS detail
  ON detail.import_batch_id = batch.id
 AND detail.organization_id = batch.organization_id
LEFT JOIN profiles AS actor
  ON actor.id = batch.created_by_profile_id`;

async function loadImportReferences(
  database: D1DatabaseLike,
  organizationId: string,
): Promise<readonly ImportReference[]> {
  const result = await database
    .prepare(
      `SELECT 'club' AS kind, id, name, slug, NULL AS parent_id
       FROM clubs
       WHERE organization_id = ? AND deleted_at IS NULL
       UNION ALL
       SELECT 'program', id, name, slug, club_id
       FROM programs
       WHERE organization_id = ? AND deleted_at IS NULL
       UNION ALL
       SELECT 'lane', id, name, slug, NULL
       FROM event_lanes
       WHERE organization_id = ? AND deleted_at IS NULL
       UNION ALL
       SELECT 'category', id, name, slug, NULL
       FROM categories
       WHERE organization_id = ? AND deleted_at IS NULL
       UNION ALL
       SELECT 'venue', id, name, slug, NULL
       FROM venues
       WHERE organization_id = ? AND deleted_at IS NULL`,
    )
    .bind(
      organizationId,
      organizationId,
      organizationId,
      organizationId,
      organizationId,
    )
    .all<Record<string, unknown>>();
  assertD1Result(result.success);
  return Object.freeze(
    (result.results ?? []).map((row) =>
      Object.freeze({
        id: requiredString(row.id),
        kind: readReferenceKind(row.kind),
        name: requiredString(row.name),
        parentId: optionalString(row.parent_id),
        slug: requiredString(row.slug),
      }),
    ),
  );
}

type ImportApplicationRowSource = Readonly<{
  applicationState: string;
  conflictDecision:
    | "administrator_review"
    | "blocked"
    | "none"
    | "reason_recorded";
  conflictReason: string | null;
  duplicateDecision: string | null;
  duplicateReason: string | null;
  normalizedRowFingerprint: string;
  payload: ResolvedImportPayload;
  resultCode: string | null;
  rowId: string;
  rowNumber: number;
  targetEventId: string | null;
}>;

type ImportApplicationSource = Readonly<{
  applicationCursor: number;
  failedRowCount: number;
  importedRowCount: number;
  pendingRowCount: number;
  phase: string;
  previewFingerprint: string;
  previewVersion: number;
  row: ImportApplicationRowSource | null;
  selectedRowCount: number;
  skippedRowCount: number;
  sourceNamespace: string;
  version: number;
}>;

async function loadNextImportApplication(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  batchId: string,
): Promise<ImportApplicationSource> {
  const detail = await database
    .prepare(
      `SELECT phase, version, preview_fingerprint, preview_version,
              source_namespace, selected_row_count, imported_row_count,
              skipped_row_count, failed_row_count, pending_row_count,
              application_cursor,
              (
                SELECT json_object(
                         'row_id', row.id,
                         'row_number', row.row_number,
                         'normalized_payload_json',
                           row.normalized_payload_json,
                         'normalized_row_fingerprint',
                           application.normalized_row_fingerprint,
                         'application_state',
                           application.application_state,
                         'result_code', application.result_code,
                         'target_organizer_event_id',
                           application.target_organizer_event_id,
                         'conflict_decision',
                           application.conflict_decision,
                         'conflict_reason', application.conflict_reason,
                         'duplicate_decision',
                           application.duplicate_decision,
                         'duplicate_reason',
                           application.duplicate_reason
                       )
                FROM import_rows AS row
                INNER JOIN import_row_applications AS application
                  ON application.import_row_id = row.id
                 AND application.organization_id =
                     row.organization_id
                 AND application.import_batch_id =
                     row.import_batch_id
                WHERE row.organization_id =
                      import_batch_details.organization_id
                  AND row.import_batch_id =
                      import_batch_details.import_batch_id
                  AND application.approval_action IN (
                    'selected', 'create_separate'
                  )
                  AND application.application_state IN (
                    'approved', 'applying', 'imported'
                  )
                ORDER BY CASE application.application_state
                  WHEN 'approved' THEN 1
                  WHEN 'applying' THEN 2
                  ELSE 3
                END, row.row_number, row.id
                LIMIT 1
              ) AS row_json
       FROM import_batch_details
       WHERE import_batch_id = ? AND organization_id = ?
       LIMIT 1`,
    )
    .bind(batchId, actor.organizationId)
    .first<Record<string, unknown>>();
  if (!detail) throw importNotFound();
  const rowJson = optionalString(detail.row_json);
  const row = rowJson === null ? null : parseStoredObject(rowJson);
  return Object.freeze({
    applicationCursor: requiredInteger(detail.application_cursor),
    failedRowCount: requiredInteger(detail.failed_row_count),
    importedRowCount: requiredInteger(detail.imported_row_count),
    pendingRowCount: requiredInteger(detail.pending_row_count),
    phase: requiredString(detail.phase),
    previewFingerprint: requiredString(detail.preview_fingerprint),
    previewVersion: requiredInteger(detail.preview_version),
    row:
      row === null
        ? null
        : Object.freeze({
            applicationState: requiredString(row.application_state),
            conflictDecision: readConflictDecision(
              row.conflict_decision,
            ),
            conflictReason: optionalString(row.conflict_reason),
            duplicateDecision: optionalString(
              row.duplicate_decision,
            ),
            duplicateReason: optionalString(row.duplicate_reason),
            normalizedRowFingerprint: requiredString(
              row.normalized_row_fingerprint,
            ),
            payload: readResolvedImportPayload(
              requiredString(row.normalized_payload_json),
            ),
            resultCode: optionalString(row.result_code),
            rowId: requiredString(row.row_id),
            rowNumber: requiredInteger(row.row_number),
            targetEventId: optionalString(row.target_organizer_event_id),
          }),
    selectedRowCount: requiredInteger(detail.selected_row_count),
    skippedRowCount: requiredInteger(detail.skipped_row_count),
    sourceNamespace: requiredString(detail.source_namespace),
    version: requiredInteger(detail.version),
  });
}

function readResolvedImportPayload(value: string): ResolvedImportPayload {
  const raw = parseStoredObject(value);
  const schedule = parseObject(raw.schedule, "schedule");
  const shape = requiredString(schedule.shape);
  const timeZone = parseIanaTimeZone(schedule.timeZone, "schedule.timeZone");
  let normalizedSchedule: NormalizedCsvImportPayload["schedule"];
  if (shape === "unscheduled") {
    normalizedSchedule = Object.freeze({
      endDateExclusive: null,
      endsAtUtc: null,
      shape,
      startDate: null,
      startsAtUtc: null,
      timeZone,
    });
  } else if (shape === "timed") {
    const startsAtUtc = requiredString(schedule.startsAtUtc);
    const endsAtUtc = requiredString(schedule.endsAtUtc);
    if (
      !Number.isFinite(Date.parse(startsAtUtc)) ||
      !Number.isFinite(Date.parse(endsAtUtc)) ||
      Date.parse(endsAtUtc) <= Date.parse(startsAtUtc)
    ) {
      throw unavailableImport();
    }
    normalizedSchedule = Object.freeze({
      endDateExclusive: null,
      endsAtUtc,
      shape,
      startDate: null,
      startsAtUtc,
      timeZone,
    });
  } else if (shape === "all_day") {
    normalizedSchedule = Object.freeze({
      endDateExclusive: parseCalendarDate(
        schedule.endDateExclusive,
        "schedule.endDateExclusive",
      ),
      endsAtUtc: null,
      shape,
      startDate: parseCalendarDate(
        schedule.startDate,
        "schedule.startDate",
      ),
      startsAtUtc: null,
      timeZone,
    });
  } else {
    throw unavailableImport();
  }
  const planningStatus = requiredString(raw.planningStatus);
  if (
    planningStatus !== "idea" &&
    planningStatus !== "draft" &&
    planningStatus !== "tentative_hold" &&
    planningStatus !== "confirmed"
  ) {
    throw unavailableImport();
  }
  const attendanceMode = requiredString(raw.attendanceMode);
  if (
    attendanceMode !== "in_person" &&
    attendanceMode !== "online" &&
    attendanceMode !== "hybrid" &&
    attendanceMode !== "undecided"
  ) {
    throw unavailableImport();
  }
  const coOrganizerProfileIds = Array.isArray(
    raw.coOrganizerProfileIds,
  )
    ? raw.coOrganizerProfileIds.map((item) =>
        parseIdentifier(item, "coOrganizerProfileIds"),
      )
    : (() => {
        throw unavailableImport();
      })();
  return Object.freeze({
    attendanceMode,
    bufferAfterMinutes: parseFiniteInteger(raw.bufferAfterMinutes, {
      path: "bufferAfterMinutes",
      minimum: 0,
      maximum: 1_440,
    }),
    bufferBeforeMinutes: parseFiniteInteger(raw.bufferBeforeMinutes, {
      path: "bufferBeforeMinutes",
      minimum: 0,
      maximum: 1_440,
    }),
    categoryId:
      raw.categoryId === null
        ? null
        : parseIdentifier(raw.categoryId, "categoryId"),
    clubId: parseIdentifier(raw.clubId, "clubId"),
    coOrganizerProfileIds: Object.freeze(coOrganizerProfileIds),
    externalId: optionalString(raw.externalId),
    eventLaneId:
      raw.eventLaneId === null
        ? null
        : parseIdentifier(raw.eventLaneId, "eventLaneId"),
    meetupUrl: optionalString(raw.meetupUrl),
    planningStatus,
    primaryOrganizerProfileId: parseIdentifier(
      raw.primaryOrganizerProfileId,
      "primaryOrganizerProfileId",
    ),
    privateNotes: optionalString(raw.privateNotes),
    programId:
      raw.programId === null
        ? null
        : parseIdentifier(raw.programId, "programId"),
    publicationStatus: "private",
    schedule: normalizedSchedule,
    title: parseBoundedString(raw.title, {
      path: "title",
      maxLength: 180,
    }),
    venueId:
      raw.venueId === null
        ? null
        : parseIdentifier(raw.venueId, "venueId"),
  });
}

function canonicalEventInputFromResolvedImport(
  payload: ResolvedImportPayload,
  conflictReason: string | null,
  conflictDecision: ImportApplicationRowSource["conflictDecision"],
): CanonicalImportOrganizerEventInput {
  const schedule =
    payload.schedule.shape === "timed"
      ? Object.freeze({
          allDayEndDateExclusive: null,
          allDayStartDate: null,
          endsAtUtc: Date.parse(payload.schedule.endsAtUtc),
          shape: "timed" as const,
          startsAtUtc: Date.parse(payload.schedule.startsAtUtc),
          timeZone: payload.schedule.timeZone,
        })
      : payload.schedule.shape === "all_day"
        ? Object.freeze({
            allDayEndDateExclusive: parseCalendarDate(
              payload.schedule.endDateExclusive,
            ),
            allDayStartDate: parseCalendarDate(
              payload.schedule.startDate,
            ),
            endsAtUtc: null,
            shape: "all_day" as const,
            startsAtUtc: null,
            timeZone: payload.schedule.timeZone,
          })
        : Object.freeze({
            allDayEndDateExclusive: null,
            allDayStartDate: null,
            endsAtUtc: null,
            shape: "unscheduled" as const,
            startsAtUtc: null,
            timeZone: payload.schedule.timeZone,
          });
  return Object.freeze({
    bufferAfterMinutes: payload.bufferAfterMinutes,
    bufferBeforeMinutes: payload.bufferBeforeMinutes,
    categoryId: payload.categoryId,
    clubId: payload.clubId,
    coOrganizerProfileIds: payload.coOrganizerProfileIds,
    conflictReason,
    description: null,
    eventLaneId: payload.eventLaneId,
    expectedConflictPolicyMode:
      conflictDecision === "administrator_review"
        ? "require_admin_approval"
        : conflictDecision === "reason_recorded"
          ? "warn_reason"
          : conflictDecision === "blocked"
            ? "block"
            : null,
    meetupEventUrl: payload.meetupUrl,
    planningStatus: payload.planningStatus,
    primaryOrganizerProfileId: payload.primaryOrganizerProfileId,
    privateMeetingDetails: null,
    privateNotes: payload.privateNotes,
    programId: payload.programId,
    publicationStatus: "private",
    schedule,
    summary: null,
    title: payload.title,
    venueId: payload.venueId,
  });
}

async function findApplyDuplicate(
  database: D1DatabaseLike,
  organizationId: string,
  sourceNamespace: string,
  payload: ResolvedImportPayload,
  fingerprint: string,
): Promise<boolean> {
  const row = await database
    .prepare(
      `SELECT CASE WHEN
         EXISTS (
           SELECT 1
           FROM external_source_links AS source_link
           WHERE source_link.organization_id = ?
             AND source_link.source_type = 'csv'
             AND source_link.sync_source_id = ?
             AND source_link.external_id = COALESCE(?, ?)
             AND source_link.deleted_at IS NULL
         )
         OR (
           ? IS NOT NULL
           AND EXISTS (
             SELECT 1
             FROM organizer_events AS event
             WHERE event.organization_id = ?
               AND event.meetup_event_url = ?
               AND event.deleted_at IS NULL
           )
         )
       THEN 1 ELSE 0 END AS duplicate_found`,
    )
    .bind(
      organizationId,
      sourceNamespace,
      payload.externalId,
      fingerprint,
      payload.meetupUrl,
      organizationId,
      payload.meetupUrl,
    )
    .first<Record<string, unknown>>();
  return requiredInteger(row?.duplicate_found) === 1;
}

type ImportFinalizationContext = Readonly<{
  batchId: string;
  eventId: string;
  now: number;
  resultCode:
    | "imported_private"
    | "imported_private_pending_administrator_review";
  reviewRequestId: string | null;
  runnerLeaseHash: string;
  runnerVersion: number;
}>;

function successfulImportExtensionStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  source: ImportApplicationSource & Readonly<{
    row: ImportApplicationRowSource;
  }>,
  context: ImportFinalizationContext,
): readonly D1PreparedStatementLike[] {
  const terminal = source.pendingRowCount === 1;
  const nextImported = source.importedRowCount + 1;
  const nextPending = source.pendingRowCount - 1;
  const auditEntries: SafeImportAuditEntry[] = [];
  const statements: D1PreparedStatementLike[] = [
    database
      .prepare(
        `UPDATE import_row_applications
         SET target_organizer_event_id = ?,
             updated_at = ?
         WHERE import_row_id = ?
           AND organization_id = ?
           AND import_batch_id = ?
           AND application_state = 'applying'
           AND target_organizer_event_id IS NULL
           AND apply_actor_profile_id = ?
           AND EXISTS (
             SELECT 1
             FROM import_batch_details AS detail
             WHERE detail.import_batch_id =
                   import_row_applications.import_batch_id
               AND detail.organization_id =
                   import_row_applications.organization_id
               AND detail.version = ?
               AND detail.active_runner_version = ?
               AND detail.active_runner_lease_hash = ?
               AND detail.active_runner_expires_at > ?
           )`,
      )
      .bind(
        context.eventId,
        context.now,
        source.row.rowId,
        actor.organizationId,
        context.batchId,
        actor.profileId,
        context.runnerVersion,
        context.runnerVersion,
        context.runnerLeaseHash,
        context.now,
      ),
    database
      .prepare(
        `INSERT INTO external_source_links (
           id, organization_id, entity_type, entity_id, source_type,
           sync_source_id, external_id, external_url, source_fingerprint,
           source_sequence, source_last_modified_at, last_imported_at,
           created_at, updated_at, deleted_at
         ) VALUES (
           ?, ?, 'organizer_event', ?, 'csv', ?, ?, ?, ?, NULL, NULL, ?,
           ?, ?, NULL
         )`,
      )
      .bind(
        `external-source-link:${crypto.randomUUID()}`,
        actor.organizationId,
        context.eventId,
        source.sourceNamespace,
        source.row.payload.externalId ??
          source.row.normalizedRowFingerprint,
        source.row.payload.meetupUrl,
        source.row.normalizedRowFingerprint,
        context.now,
        context.now,
        context.now,
      ),
  ];
  if (terminal) {
    auditEntries.push({
      action: "import.completed",
      metadata: {
        failedRowCount: source.failedRowCount,
        importedRowCount: nextImported,
        selectedRowCount: source.selectedRowCount,
        skippedRowCount: source.skippedRowCount,
      },
    });
  }
  if (
    source.row.conflictReason !== null ||
    context.reviewRequestId !== null
  ) {
    auditEntries.push({
      action: "import.conflict_linked",
      metadata: {
        reasonRecorded: source.row.conflictReason === null ? 0 : 1,
        reviewRequested: context.reviewRequestId === null ? 0 : 1,
      },
    });
  }
  if (source.row.duplicateDecision === "create_separate") {
    auditEntries.push({
      action: "import.duplicate_override",
      metadata: {
        reasonRecorded:
          source.row.duplicateReason === null ? 0 : 1,
        rowNumber: source.row.rowNumber,
      },
    });
  }
  auditEntries.push({
    action: "import.row_applied",
    metadata: {
      resultCode: context.resultCode,
      rowNumber: source.row.rowNumber,
    },
  });
  statements.push(
    safeImportAuditEntriesStatement(
      database,
      actor,
      context.batchId,
      context.now,
      auditEntries,
    ),
    database
      .prepare(
        `UPDATE import_row_applications
         SET application_state = 'imported',
             result_code = ?,
             applied_at = ?,
             updated_at = ?
         WHERE import_row_id = ?
           AND organization_id = ?
           AND import_batch_id = ?
           AND application_state = 'applying'
           AND target_organizer_event_id = ?
           AND apply_actor_profile_id = ?`,
      )
      .bind(
        context.resultCode,
        context.now,
        context.now,
        source.row.rowId,
        actor.organizationId,
        context.batchId,
        context.eventId,
        actor.profileId,
      ),
  );
  if (terminal) {
    statements.push(
      database
        .prepare(
          `UPDATE import_batches
           SET status = 'completed',
               completed_at = ?
           WHERE id = ?
             AND organization_id = ?
             AND status = 'processing'`,
        )
        .bind(context.now, context.batchId, actor.organizationId),
    );
  }
  statements.push(
    importDetailFinalizationStatement(database, actor, source, {
      batchId: context.batchId,
      failedRowCount: source.failedRowCount,
      importedRowCount: nextImported,
      now: context.now,
      pendingRowCount: nextPending,
      phase: terminal
        ? (source.failedRowCount === 0
            ? "completed"
            : "completed_with_errors")
        : "applying",
      runnerLeaseHash: context.runnerLeaseHash,
      runnerVersion: context.runnerVersion,
    }),
    importApplicationCompletionSentinelStatement(
      database,
      actor,
      source,
      {
        batchId: context.batchId,
        eventId: context.eventId,
        failedRowCount: source.failedRowCount,
        importedRowCount: nextImported,
        now: context.now,
        pendingRowCount: nextPending,
        phase: terminal
          ? (source.failedRowCount === 0
              ? "completed"
              : "completed_with_errors")
          : "applying",
        resultCode: context.resultCode,
        rowState: "imported",
        runnerVersion: context.runnerVersion,
      },
    ),
  );
  return Object.freeze(statements);
}

async function finishFailedImportApplication(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  source: ImportApplicationSource & Readonly<{
    row: ImportApplicationRowSource;
  }>,
  context: Readonly<{
    batchId: string;
    now: number;
    resultCode: string;
    runnerLeaseHash: string;
    runnerVersion: number;
  }>,
): Promise<void> {
  const terminal = source.pendingRowCount === 1;
  const nextFailed = source.failedRowCount + 1;
  const nextPending = source.pendingRowCount - 1;
  const statements: D1PreparedStatementLike[] = [];
  if (terminal) {
    statements.push(
      importCompletionAuditStatement(database, actor, source, {
        batchId: context.batchId,
        failedRowCount: nextFailed,
        importedRowCount: source.importedRowCount,
        now: context.now,
      }),
    );
  }
  statements.push(
    safeImportAuditStatement(database, actor, {
      action: "import.row_applied",
      batchId: context.batchId,
      metadata: {
        resultCode: context.resultCode,
        rowNumber: source.row.rowNumber,
      },
      now: context.now,
    }),
    database
      .prepare(
        `UPDATE import_row_applications
         SET application_state = 'failed',
             result_code = ?,
             applied_at = ?,
             updated_at = ?
         WHERE import_row_id = ?
           AND organization_id = ?
           AND import_batch_id = ?
           AND application_state = 'applying'
           AND apply_actor_profile_id = ?`,
      )
      .bind(
        context.resultCode,
        context.now,
        context.now,
        source.row.rowId,
        actor.organizationId,
        context.batchId,
        actor.profileId,
      ),
  );
  if (terminal) {
    statements.push(
      database
        .prepare(
          `UPDATE import_batches
           SET status = 'completed',
               completed_at = ?
           WHERE id = ?
             AND organization_id = ?
             AND status = 'processing'`,
        )
        .bind(context.now, context.batchId, actor.organizationId),
    );
  }
  statements.push(
    importDetailFinalizationStatement(database, actor, source, {
      batchId: context.batchId,
      failedRowCount: nextFailed,
      importedRowCount: source.importedRowCount,
      now: context.now,
      pendingRowCount: nextPending,
      phase: terminal ? "completed_with_errors" : "applying",
      runnerLeaseHash: context.runnerLeaseHash,
      runnerVersion: context.runnerVersion,
    }),
    importApplicationCompletionSentinelStatement(
      database,
      actor,
      source,
      {
        batchId: context.batchId,
        eventId: null,
        failedRowCount: nextFailed,
        importedRowCount: source.importedRowCount,
        now: context.now,
        pendingRowCount: nextPending,
        phase: terminal ? "completed_with_errors" : "applying",
        resultCode: context.resultCode,
        rowState: "failed",
        runnerVersion: context.runnerVersion,
      },
    ),
  );
  await runExactBatch(database, statements, {
    requiredPositiveIndexes: [
      terminal ? statements.length - 4 : statements.length - 3,
      statements.length - 2,
    ],
  });
}

function importDetailFinalizationStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  source: ImportApplicationSource,
  input: Readonly<{
    batchId: string;
    failedRowCount: number;
    importedRowCount: number;
    now: number;
    pendingRowCount: number;
    phase: "applying" | "completed" | "completed_with_errors";
    runnerLeaseHash: string;
    runnerVersion: number;
  }>,
): D1PreparedStatementLike {
  const terminal = input.phase !== "applying";
  return database
    .prepare(
      `UPDATE import_batch_details
       SET imported_row_count = ?,
           failed_row_count = ?,
           pending_row_count = ?,
           application_cursor = application_cursor + 1,
           phase = ?,
           outcome_code = ?,
           completed_at = ?,
           active_runner_version = NULL,
           active_runner_lease_hash = NULL,
           active_runner_expires_at = NULL,
           version = version + 1,
           updated_by_profile_id = ?,
           updated_at = ?
       WHERE import_batch_id = ?
         AND organization_id = ?
         AND version = ?
         AND phase = 'applying'
         AND active_runner_version = ?
         AND active_runner_lease_hash = ?
         AND imported_row_count = ?
         AND failed_row_count = ?
         AND pending_row_count = ?
         AND application_cursor = ?
         AND (? = 0 OR ? = selected_row_count)`,
    )
    .bind(
      input.importedRowCount,
      input.failedRowCount,
      input.pendingRowCount,
      input.phase,
      terminal ? input.phase : null,
      terminal ? input.now : null,
      actor.profileId,
      input.now,
      input.batchId,
      actor.organizationId,
      input.runnerVersion,
      input.runnerVersion,
      input.runnerLeaseHash,
      source.importedRowCount,
      source.failedRowCount,
      source.pendingRowCount,
      source.applicationCursor,
      terminal ? 1 : 0,
      source.applicationCursor + 1,
    );
}

function importApplicationCompletionSentinelStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  source: ImportApplicationSource & Readonly<{
    row: ImportApplicationRowSource;
  }>,
  input: Readonly<{
    batchId: string;
    eventId: string | null;
    failedRowCount: number;
    importedRowCount: number;
    now: number;
    pendingRowCount: number;
    phase: "applying" | "completed" | "completed_with_errors";
    resultCode: string;
    rowState: "failed" | "imported";
    runnerVersion: number;
  }>,
): D1PreparedStatementLike {
  const terminal = input.phase !== "applying";
  return database
    .prepare(
      `SELECT CASE WHEN
         EXISTS (
           SELECT 1
           FROM import_batch_details AS detail
           WHERE detail.import_batch_id = ?
             AND detail.organization_id = ?
             AND detail.version = ?
             AND detail.phase = ?
             AND detail.imported_row_count = ?
             AND detail.failed_row_count = ?
             AND detail.pending_row_count = ?
             AND detail.application_cursor = ?
             AND detail.updated_by_profile_id = ?
             AND detail.updated_at = ?
             AND detail.active_runner_version IS NULL
             AND detail.active_runner_lease_hash IS NULL
             AND detail.active_runner_expires_at IS NULL
             AND detail.completed_at IS ?
             AND detail.outcome_code IS ?
             AND (
               SELECT count(*)
               FROM import_row_applications AS application
               WHERE application.import_row_id = ?
                 AND application.import_batch_id = detail.import_batch_id
                 AND application.organization_id = detail.organization_id
                 AND application.application_state = ?
                 AND application.result_code = ?
                 AND application.target_organizer_event_id IS ?
                 AND application.apply_actor_profile_id = ?
                 AND application.applied_at = ?
                 AND (
                   ? = 0
                   OR application.conflict_decision =
                      'administrator_review'
                 )
             ) = 1
         )
         AND EXISTS (
           SELECT 1
           FROM import_batches AS batch
           WHERE batch.id = ?
             AND batch.organization_id = ?
             AND batch.status = ?
             AND batch.completed_at IS ?
         )
         AND (
           ? IS NULL
           OR EXISTS (
             SELECT 1
             FROM external_source_links AS source_link
             WHERE source_link.organization_id = ?
               AND source_link.entity_type = 'organizer_event'
               AND source_link.entity_id = ?
               AND source_link.source_type = 'csv'
               AND source_link.sync_source_id = ?
               AND source_link.external_id = ?
               AND source_link.source_fingerprint = ?
               AND source_link.deleted_at IS NULL
           )
         )
       THEN json('1')
       ELSE json('phase7_import_application_envelope_invalid')
       END AS exact_envelope`,
    )
    .bind(
      input.batchId,
      actor.organizationId,
      input.runnerVersion + 1,
      input.phase,
      input.importedRowCount,
      input.failedRowCount,
      input.pendingRowCount,
      source.applicationCursor + 1,
      actor.profileId,
      input.now,
      terminal ? input.now : null,
      terminal ? input.phase : null,
      source.row.rowId,
      input.rowState,
      input.resultCode,
      input.eventId,
      actor.profileId,
      input.now,
      input.resultCode ===
      "imported_private_pending_administrator_review"
        ? 1
        : 0,
      input.batchId,
      actor.organizationId,
      terminal ? "completed" : "processing",
      terminal ? input.now : null,
      input.eventId,
      actor.organizationId,
      input.eventId,
      source.sourceNamespace,
      source.row.payload.externalId ??
        source.row.normalizedRowFingerprint,
      source.row.normalizedRowFingerprint,
    );
}

function importCompletionAuditStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  source: ImportApplicationSource,
  input: Readonly<{
    batchId: string;
    failedRowCount: number;
    importedRowCount: number;
    now: number;
  }>,
): D1PreparedStatementLike {
  return safeImportAuditStatement(database, actor, {
    action: "import.completed",
    batchId: input.batchId,
    metadata: {
      failedRowCount: input.failedRowCount,
      importedRowCount: input.importedRowCount,
      selectedRowCount: source.selectedRowCount,
      skippedRowCount: source.skippedRowCount,
    },
    now: input.now,
  });
}

type SafeImportAuditEntry = Readonly<{
  action:
    | "import.completed"
    | "import.conflict_linked"
    | "import.duplicate_override"
    | "import.row_applied";
  metadata: Readonly<Record<string, number | string>>;
}>;

function safeImportAuditEntriesStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  batchId: string,
  now: number,
  entries: readonly SafeImportAuditEntry[],
): D1PreparedStatementLike {
  if (entries.length < 1 || entries.length > 4) {
    throw new Error("Invalid internal import audit envelope.");
  }
  return database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action, entity_type,
         entity_id, metadata_json, created_at
       )
       SELECT json_extract(item.value, '$.id'), ?, ?,
              json_extract(item.value, '$.action'), 'import_batch', ?,
              json_extract(item.value, '$.metadataJson'), ?
       FROM json_each(?) AS item`,
    )
    .bind(
      actor.organizationId,
      actor.profileId,
      batchId,
      now,
      JSON.stringify(
        entries.map((entry) => ({
          action: entry.action,
          id: `audit:${crypto.randomUUID()}`,
          metadataJson: JSON.stringify(entry.metadata),
        })),
      ),
    );
}

function safeImportAuditStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  input: Readonly<{
    action:
      | "import.completed"
      | "import.conflict_linked"
      | "import.duplicate_override"
      | "import.row_applied";
    batchId: string;
    metadata: Readonly<Record<string, number | string>>;
    now: number;
  }>,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action, entity_type,
         entity_id, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, 'import_batch', ?, ?, ?)`,
    )
    .bind(
      `audit:${crypto.randomUUID()}`,
      actor.organizationId,
      actor.profileId,
      input.action,
      input.batchId,
      JSON.stringify(input.metadata),
      input.now,
    );
}

function safeImportFailureCode(error: unknown): string {
  const internalMessage =
    error instanceof Error ? error.message : String(error);
  if (/phase4_conflict_reason_required/iu.test(internalMessage)) {
    return "conflict_reason_required";
  }
  if (
    /phase4_conflict_blocked|phase4_conflict_approval_required|phase4_conflict_authorization_required/iu.test(
      internalMessage,
    )
  ) {
    return "conflict_blocked";
  }
  if (error instanceof SafeApplicationError) {
    if (error.code === "stale_edit") return "stale_preview";
    if (error.code === "authorization_denied") {
      return "actor_unavailable";
    }
    if (error.code === "not_found") return "mapping_unavailable";
    if (error.code === "conflict") {
      if (
        /reason/iu.test(error.publicMessage)
      ) {
        return "conflict_reason_required";
      }
      return "conflict_blocked";
    }
  }
  return "application_failed";
}


async function loadImportOrganizerReferences(
  database: D1DatabaseLike,
  organizationId: string,
  now: number,
): Promise<readonly ImportOrganizerReference[]> {
  const result = await database
    .prepare(
      `SELECT membership.normalized_email,
              membership.profile_id,
              profile.display_name,
              1 AS active,
              0 AS invited,
              membership.role,
              COALESCE((
                SELECT json_group_array(club_membership.club_id)
                FROM club_memberships AS club_membership
                WHERE club_membership.organization_id =
                      membership.organization_id
                  AND club_membership.organization_membership_id =
                      membership.id
                  AND club_membership.profile_id = membership.profile_id
                  AND club_membership.status = 'active'
                  AND club_membership.deleted_at IS NULL
              ), '[]') AS club_ids_json
       FROM organization_memberships AS membership
       INNER JOIN profiles AS profile
         ON profile.id = membership.profile_id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
       WHERE membership.organization_id = ?
         AND membership.status = 'active'
         AND membership.deleted_at IS NULL
       UNION ALL
       SELECT invitation.target_normalized_email,
              NULL,
              NULL,
              0,
              1,
              invitation.intended_role,
              CASE
                WHEN invitation.club_id IS NULL THEN '[]'
                ELSE json_array(invitation.club_id)
              END
       FROM invitations AS invitation
       WHERE invitation.organization_id = ?
         AND invitation.expires_at > ?
         AND invitation.revoked_at IS NULL
         AND invitation.used_at IS NULL`,
    )
    .bind(organizationId, organizationId, now)
    .all<Record<string, unknown>>();
  assertD1Result(result.success);
  return Object.freeze(
    (result.results ?? []).map((row) =>
      Object.freeze({
        active: requiredInteger(row.active) === 1,
        clubIds: readStringArray(row.club_ids_json),
        displayName: optionalString(row.display_name),
        invited: requiredInteger(row.invited) === 1,
        normalizedEmail: requiredString(row.normalized_email),
        profileId: optionalString(row.profile_id),
        role: readOrganizerRole(row.role),
      }),
    ),
  );
}

async function preparePreviewRows(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  batchId: string,
  sourceNamespace: string,
  sourceRows: readonly NormalizedCsvImportRow[],
  references: readonly ImportReference[],
  organizers: readonly ImportOrganizerReference[],
): Promise<readonly PreparedPreviewRow[]> {
  const initiallyPrepared = await Promise.all(
    sourceRows.map(async (sourceRow) => {
      const issues: ImportIssue[] = sourceRow.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path,
      }));
      const resolved =
        sourceRow.normalized === null
          ? null
          : resolveNormalizedImportPayload(
              sourceRow.normalized,
              references,
              organizers,
              issues,
            );
      const fingerprint =
        sourceRow.normalizedRowFingerprint ??
        sourceRow.mappedRowFingerprint ??
        await sha256Hex(
          JSON.stringify([
            "invalid-import-row",
            sourceRow.sourceRowNumber,
            sourceRow.mappedValues,
          ]),
        );
      return {
        applicationIdempotencyKey: await sha256Hex(
          JSON.stringify([
            "vcc-import-row-application-v1",
            actor.organizationId,
            batchId,
            sourceRow.sourceRowNumber,
            fingerprint,
          ]),
        ),
        conflictDetails: [] as CsvImportPreviewConflictDetail[],
        conflictDetailsTotal: 0,
        defaultsApplied: sourceRow.defaultsApplied,
        duplicateDetails: [] as CsvImportPreviewDuplicateDetail[],
        duplicateDetailsTotal: 0,
        issues,
        mappingFields: Object.freeze(
          Object.keys(sourceRow.mappedValues).sort(),
        ),
        mappedValues: sourceRow.mappedValues,
        matchSummary: previewMatchSummary(
          resolved,
          references,
          organizers,
        ),
        normalizedPayload: issues.length === 0 ? resolved : null,
        normalizedRowFingerprint: fingerprint,
        rowId: `import-row:${crypto.randomUUID()}`,
        sourceRowNumber: sourceRow.sourceRowNumber,
        warningCodes: [] as string[],
      };
    }),
  );
  const fingerprintRows = new Map<
    string,
    (typeof initiallyPrepared)[number][]
  >();
  for (const row of initiallyPrepared) {
    const matches =
      fingerprintRows.get(row.normalizedRowFingerprint) ?? [];
    matches.push(row);
    fingerprintRows.set(row.normalizedRowFingerprint, matches);
  }
  for (const row of initiallyPrepared) {
    const matchingRows =
      fingerprintRows.get(row.normalizedRowFingerprint) ?? [];
    if (
      row.normalizedPayload &&
      matchingRows.length > 1
    ) {
      row.issues.push({
        code: "hard_duplicate_batch_fingerprint",
        message: "This normalized row appears more than once in this file.",
        path: `rows.${row.sourceRowNumber}`,
      });
      row.duplicateDetailsTotal += matchingRows.length - 1;
      for (const other of matchingRows) {
        if (
          other.rowId === row.rowId ||
          row.duplicateDetails.length >= MAX_DUPLICATE_DETAIL_IDENTITIES
        ) {
          continue;
        }
        row.duplicateDetails.push(Object.freeze({
          code: "hard_duplicate_batch_fingerprint" as const,
          referenceId: other.rowId,
          source: "import_row" as const,
          sourceRowNumber: other.sourceRowNumber,
          title: other.normalizedPayload?.title ?? null,
        }));
      }
    }
  }

  const duplicateFacts = await loadExistingDuplicateFacts(
    database,
    actor.organizationId,
    sourceNamespace,
    initiallyPrepared,
  );
  const existingIntervals = await loadExistingImportIntervals(
    database,
    actor.organizationId,
    initiallyPrepared,
  );
  const proposedIntervals = proposedPreviewIntervals(initiallyPrepared);
  for (const row of initiallyPrepared) {
    if (!row.normalizedPayload) continue;
    const duplicateMatches = duplicateFacts.get(row.rowId);
    if (duplicateMatches) {
      row.duplicateDetailsTotal += duplicateMatches.total;
      for (const match of duplicateMatches.details) {
        if (
          row.duplicateDetails.length < MAX_DUPLICATE_DETAIL_IDENTITIES
        ) {
          row.duplicateDetails.push(match);
        }
      }
      for (const code of duplicateMatches.codes) {
        if (code === "semantic_duplicate_warning") {
          row.warningCodes.push(code);
          continue;
        }
        row.issues.push({
          code,
          message:
            code === "hard_duplicate_source"
              ? "This source namespace and external ID already link to an event."
              : code === "hard_duplicate_meetup_url"
                ? "This Meetup event URL already belongs to an event."
                : "This title, club, and schedule closely match an existing event.",
          path: `rows.${row.sourceRowNumber}`,
        });
      }
    }
    const proposed = proposedIntervals.get(row.rowId);
    if (proposed) {
      const matchingExisting = existingIntervals.filter(
        (existing) =>
          proposed.expandedStartUtc < existing.expandedEndUtc &&
          proposed.expandedEndUtc > existing.expandedStartUtc,
      );
      if (matchingExisting.length > 0) {
        row.warningCodes.push("existing_schedule_conflict");
        row.conflictDetailsTotal += matchingExisting.length;
        row.conflictDetails.push(
          ...matchingExisting
            .slice(
              0,
              MAX_CONFLICT_DETAIL_IDENTITIES -
                row.conflictDetails.length,
            )
            .map(existingIntervalConflictDetail),
        );
      }
      const matchingRows = [...proposedIntervals.entries()].filter(
        ([otherRowId, other]) =>
          otherRowId !== row.rowId &&
          proposed.expandedStartUtc < other.expandedEndUtc &&
          proposed.expandedEndUtc > other.expandedStartUtc,
      );
      if (matchingRows.length > 0) {
        row.warningCodes.push("intra_file_schedule_conflict");
        row.conflictDetailsTotal += matchingRows.length;
        row.conflictDetails.push(
          ...matchingRows
            .slice(
              0,
              MAX_CONFLICT_DETAIL_IDENTITIES -
                row.conflictDetails.length,
            )
            .map(([otherRowId, other]) =>
              proposedIntervalConflictDetail(otherRowId, other),
            ),
        );
      }
    }
  }

  return Object.freeze(
    initiallyPrepared.map((row) => {
      const hardDuplicate = row.issues.some((issue) =>
        issue.code.startsWith("hard_duplicate_"),
      );
      const parserOrMappingError = row.issues.some(
        (issue) => !issue.code.startsWith("hard_duplicate_"),
      );
      const errorCodes = Object.freeze(
        [...new Set(row.issues.map((issue) => issue.code))],
      );
      const warningCodes = Object.freeze([...new Set(row.warningCodes)]);
      return Object.freeze({
        applicationIdempotencyKey: row.applicationIdempotencyKey,
        conflictDetails: Object.freeze([...row.conflictDetails]),
        conflictDetailsTotal: row.conflictDetailsTotal,
        defaultsApplied: Object.freeze([...row.defaultsApplied]),
        duplicateDetails: Object.freeze([...row.duplicateDetails]),
        duplicateDetailsTotal: row.duplicateDetailsTotal,
        errorCodes,
        issues: Object.freeze([...row.issues]),
        mappingFields: row.mappingFields,
        mappedValues: Object.freeze({ ...row.mappedValues }),
        matchSummary: row.matchSummary,
        normalizedPayload:
          parserOrMappingError ? null : row.normalizedPayload,
        normalizedRowFingerprint: row.normalizedRowFingerprint,
        previewResultCode: parserOrMappingError
          ? ("invalid" as const)
          : hardDuplicate
            ? ("hard_duplicate" as const)
            : warningCodes.length > 0
              ? ("warning" as const)
              : ("valid" as const),
        rowId: row.rowId,
        sourceRowNumber: row.sourceRowNumber,
        warningCodes,
      });
    }),
  );
}

function resolveNormalizedImportPayload(
  normalized: NormalizedCsvImportPayload,
  references: readonly ImportReference[],
  organizers: readonly ImportOrganizerReference[],
  issues: ImportIssue[],
): ResolvedImportPayload | null {
  const club = resolveReference(
    normalized.club,
    "club",
    references,
    issues,
    "club",
    true,
  );
  const program = resolveReference(
    normalized.program,
    "program",
    references,
    issues,
    "program",
    false,
  );
  const lane = resolveReference(
    normalized.lane,
    "lane",
    references,
    issues,
    "lane",
    false,
  );
  const category = resolveReference(
    normalized.category,
    "category",
    references,
    issues,
    "category",
    false,
  );
  const venue = resolveReference(
    normalized.location,
    "venue",
    references,
    issues,
    "location",
    false,
  );
  if (
    club &&
    program &&
    program.parentId !== null &&
    program.parentId !== club.id
  ) {
    issues.push({
      code: "program_club_mismatch",
      message: "The selected Program belongs to a different Club.",
      path: "program",
    });
  }
  const primary = resolveOrganizer(
    normalized.primaryOrganizerEmail,
    club?.id ?? null,
    organizers,
    issues,
    "primary_organizer_email",
  );
  const coOrganizers = normalized.coOrganizerEmails.map((email, index) =>
    resolveOrganizer(
      email,
      club?.id ?? null,
      organizers,
      issues,
      `co_organizer_emails.${index}`,
    ),
  );
  if (
    !club ||
    !primary ||
    coOrganizers.some((organizer) => organizer === null) ||
    issues.length > 0
  ) {
    return null;
  }
  const coOrganizerProfileIds = Object.freeze(
    coOrganizers
      .filter((organizer): organizer is ImportOrganizerReference =>
        organizer !== null,
      )
      .map((organizer) => organizer.profileId!)
      .filter((profileId) => profileId !== primary.profileId),
  );
  return Object.freeze({
    attendanceMode: normalized.attendanceMode,
    bufferAfterMinutes: normalized.bufferAfterMinutes,
    bufferBeforeMinutes: normalized.bufferBeforeMinutes,
    categoryId: category?.id ?? null,
    clubId: club.id,
    coOrganizerProfileIds,
    externalId: normalized.externalId,
    eventLaneId: lane?.id ?? null,
    meetupUrl: normalized.meetupUrl,
    planningStatus: normalized.planningStatus,
    primaryOrganizerProfileId: primary.profileId!,
    privateNotes: normalized.privateNotes,
    programId: program?.id ?? null,
    publicationStatus: "private",
    schedule: normalized.schedule,
    title: normalized.title,
    venueId: venue?.id ?? null,
  });
}

function resolveReference(
  rawValue: string | null,
  kind: ImportReferenceKind,
  references: readonly ImportReference[],
  issues: ImportIssue[],
  path: string,
  required: boolean,
): ImportReference | null {
  if (rawValue === null || rawValue.trim() === "") {
    if (required) {
      issues.push({
        code: `${kind}_required`,
        message: `Choose an active ${kind}.`,
        path,
      });
    }
    return null;
  }
  const normalized = normalizedLookupValue(rawValue);
  const matches = references.filter(
    (reference) =>
      reference.kind === kind &&
      (reference.id === rawValue ||
        normalizedLookupValue(reference.slug) === normalized ||
        normalizedLookupValue(reference.name) === normalized),
  );
  if (matches.length === 1) return matches[0];
  issues.push({
    code: matches.length === 0
      ? `${kind}_not_found`
      : `${kind}_ambiguous`,
    message:
      matches.length === 0
        ? `No active same-organization ${kind} matches this value.`
        : `This ${kind} name is ambiguous. Use its ID or slug.`,
    path,
  });
  return null;
}

function resolveOrganizer(
  normalizedEmail: string,
  clubId: string | null,
  organizers: readonly ImportOrganizerReference[],
  issues: ImportIssue[],
  path: string,
): ImportOrganizerReference | null {
  const active = organizers.filter(
    (organizer) =>
      organizer.normalizedEmail === normalizedEmail &&
      organizer.active &&
      organizer.profileId !== null,
  );
  if (active.length !== 1) {
    const invited = organizers.some(
      (organizer) =>
        organizer.normalizedEmail === normalizedEmail &&
        organizer.invited,
    );
    issues.push({
      code: invited
        ? "organizer_invitation_not_accepted"
        : "organizer_not_active",
      message: invited
        ? "This invitation must be accepted before the organizer can be assigned."
        : "Map organizers by an active same-organization membership email.",
      path,
    });
    return null;
  }
  const organizer = active[0];
  if (
    organizer.role === "organizer" &&
    (clubId === null || !organizer.clubIds.includes(clubId))
  ) {
    issues.push({
      code: "organizer_club_assignment_required",
      message: "This Organizer is not actively assigned to the selected Club.",
      path,
    });
    return null;
  }
  return organizer;
}

function previewMatchSummary(
  payload: ResolvedImportPayload | null,
  references: readonly ImportReference[],
  organizers: readonly ImportOrganizerReference[],
): CsvImportPreviewMatchSummary {
  if (payload === null) {
    return Object.freeze({
      category: null,
      club: null,
      coOrganizers: Object.freeze([]),
      lane: null,
      primaryOrganizer: null,
      program: null,
      venue: null,
    });
  }
  const referenceName = (id: string | null): string | null =>
    id === null
      ? null
      : references.find((reference) => reference.id === id)?.name ?? null;
  const organizerName = (profileId: string): string =>
    organizers.find((organizer) => organizer.profileId === profileId)
      ?.displayName ?? "Active organizer";
  return Object.freeze({
    category: referenceName(payload.categoryId),
    club: referenceName(payload.clubId),
    coOrganizers: Object.freeze(
      payload.coOrganizerProfileIds.map(organizerName),
    ),
    lane: referenceName(payload.eventLaneId),
    primaryOrganizer: organizerName(payload.primaryOrganizerProfileId),
    program: referenceName(payload.programId),
    venue: referenceName(payload.venueId),
  });
}

type PreviewInterval = Readonly<{
  actualEndUtc: number;
  actualStartUtc: number;
  expandedEndUtc: number;
  expandedStartUtc: number;
  planningStatus: string;
  referenceId: string;
  source:
    | "existing_legacy"
    | "existing_meetup"
    | "existing_organizer"
    | "import_row";
  sourceRowNumber: number | null;
  title: string;
}>;

function existingIntervalConflictDetail(
  interval: PreviewInterval,
): CsvImportPreviewConflictDetail {
  return Object.freeze({
    endsAtUtc: interval.actualEndUtc,
    planningStatus: interval.planningStatus,
    referenceId: interval.referenceId,
    source: interval.source,
    sourceRowNumber: null,
    startsAtUtc: interval.actualStartUtc,
    title: interval.title,
  });
}

function proposedIntervalConflictDetail(
  rowId: string,
  interval: PreviewInterval,
): CsvImportPreviewConflictDetail {
  return Object.freeze({
    endsAtUtc: interval.actualEndUtc,
    planningStatus: interval.planningStatus,
    referenceId: rowId,
    source: "import_row",
    sourceRowNumber: interval.sourceRowNumber,
    startsAtUtc: interval.actualStartUtc,
    title: interval.title,
  });
}

function readPreviewConflictSource(
  value: unknown,
): PreviewInterval["source"] {
  if (
    value === "existing_legacy" ||
    value === "existing_meetup" ||
    value === "existing_organizer" ||
    value === "import_row"
  ) {
    return value;
  }
  throw unavailableImport();
}

function readDuplicateDetailCode(
  value: unknown,
): CsvImportPreviewDuplicateDetail["code"] {
  const code = requiredString(value);
  if (
    code === "hard_duplicate_batch_fingerprint" ||
    code === "hard_duplicate_meetup_url" ||
    code === "hard_duplicate_source" ||
    code === "semantic_duplicate_warning"
  ) {
    return code;
  }
  throw unavailableImport();
}

function proposedPreviewIntervals(
  rows: readonly Readonly<{
    normalizedPayload: ResolvedImportPayload | null;
    rowId: string;
    sourceRowNumber: number;
  }>[],
): ReadonlyMap<string, PreviewInterval> {
  const intervals = new Map<string, PreviewInterval>();
  for (const row of rows) {
    const payload = row.normalizedPayload;
    if (!payload || payload.schedule.shape === "unscheduled") continue;
    const interval =
      payload.schedule.shape === "timed"
        ? normalizeConflictInterval({
            bufferAfterMinutes: payload.bufferAfterMinutes,
            bufferBeforeMinutes: payload.bufferBeforeMinutes,
            endUtc: Date.parse(payload.schedule.endsAtUtc),
            startUtc: Date.parse(payload.schedule.startsAtUtc),
          })
        : normalizeAllDayConflictInterval({
            bufferAfterMinutes: payload.bufferAfterMinutes,
            bufferBeforeMinutes: payload.bufferBeforeMinutes,
            endDateExclusive: payload.schedule.endDateExclusive,
            startDate: payload.schedule.startDate,
            timeZone: payload.schedule.timeZone,
          });
    intervals.set(row.rowId, Object.freeze({
      actualEndUtc: interval.actualEndUtc,
      actualStartUtc: interval.actualStartUtc,
      expandedEndUtc: interval.expandedEndUtc,
      expandedStartUtc: interval.expandedStartUtc,
      planningStatus: payload.planningStatus,
      referenceId: row.rowId,
      source: "import_row" as const,
      sourceRowNumber: row.sourceRowNumber,
      title: payload.title,
    }));
  }
  return intervals;
}

async function loadExistingImportIntervals(
  database: D1DatabaseLike,
  organizationId: string,
  rows: readonly Readonly<{
    normalizedPayload: ResolvedImportPayload | null;
    rowId: string;
    sourceRowNumber: number;
  }>[],
): Promise<readonly PreviewInterval[]> {
  const proposed = [...proposedPreviewIntervals(rows).values()];
  if (proposed.length === 0) return Object.freeze([]);
  const earliest = Math.min(...proposed.map((item) => item.expandedStartUtc));
  const latest = Math.max(...proposed.map((item) => item.expandedEndUtc));
  const result = await database
    .prepare(
      `SELECT state.actual_start_utc, state.actual_end_utc,
              state.expanded_start_utc, state.expanded_end_utc,
              state.planning_status, state.organizer_event_id
                AS reference_id,
              'existing_organizer' AS source, NULL AS source_row_number,
              event.title
       FROM organizer_reservation_states AS state
       INNER JOIN organizer_events AS event
         ON event.id = state.organizer_event_id
        AND event.organization_id = state.organization_id
        AND event.deleted_at IS NULL
       WHERE state.organization_id = ?
         AND state.expanded_start_utc < ?
         AND state.expanded_end_utc > ?
         AND (
           state.planning_status = 'confirmed'
           OR (
             state.planning_status = 'tentative_hold'
             AND state.hold_expires_at >
                 CAST(unixepoch('subsec') * 1000 AS INTEGER)
           )
         )
       UNION ALL
       SELECT interval.actual_start_utc, interval.actual_end_utc,
              interval.expanded_start_utc, interval.expanded_end_utc,
              interval.planning_status, interval.event_id,
              CASE interval.source_kind
                WHEN 'meetup' THEN 'existing_meetup'
                ELSE 'existing_legacy'
              END,
              NULL, interval.title
       FROM organizer_external_reservation_intervals AS interval
       WHERE interval.organization_id = ?
         AND interval.expanded_start_utc < ?
         AND interval.expanded_end_utc > ?
         AND interval.planning_status <> 'cancelled'
       LIMIT 501`,
    )
    .bind(organizationId, latest, earliest, organizationId, latest, earliest)
    .all<Record<string, unknown>>();
  assertD1Result(result.success);
  if ((result.results ?? []).length > 500) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "The import conflict preview is too broad. Narrow the file schedule range.",
    );
  }
  return Object.freeze(
    (result.results ?? []).map((row) =>
      Object.freeze({
        actualEndUtc: requiredInteger(row.actual_end_utc),
        actualStartUtc: requiredInteger(row.actual_start_utc),
        expandedEndUtc: requiredInteger(row.expanded_end_utc),
        expandedStartUtc: requiredInteger(row.expanded_start_utc),
        planningStatus: requiredString(row.planning_status),
        referenceId: requiredString(row.reference_id),
        source: readPreviewConflictSource(row.source),
        sourceRowNumber: null,
        title: requiredString(row.title),
      }),
    ),
  );
}

async function loadExistingDuplicateFacts(
  database: D1DatabaseLike,
  organizationId: string,
  sourceNamespace: string,
  rows: readonly Readonly<{
    normalizedPayload: ResolvedImportPayload | null;
    rowId: string;
  }>[],
): Promise<
  ReadonlyMap<
    string,
    Readonly<{
      codes: readonly CsvImportPreviewDuplicateDetail["code"][];
      details: readonly CsvImportPreviewDuplicateDetail[];
      total: number;
    }>
  >
> {
  const candidates = rows
    .filter((row) => row.normalizedPayload !== null)
    .map((row) => ({
      clubId: row.normalizedPayload!.clubId,
      endDate:
        row.normalizedPayload!.schedule.shape === "all_day"
          ? row.normalizedPayload!.schedule.endDateExclusive
          : null,
      endsAt:
        row.normalizedPayload!.schedule.shape === "timed"
          ? Date.parse(row.normalizedPayload!.schedule.endsAtUtc)
          : null,
      externalId: row.normalizedPayload!.externalId,
      meetupUrl: row.normalizedPayload!.meetupUrl,
      rowId: row.rowId,
      startDate:
        row.normalizedPayload!.schedule.shape === "all_day"
          ? row.normalizedPayload!.schedule.startDate
          : null,
      startsAt:
        row.normalizedPayload!.schedule.shape === "timed"
          ? Date.parse(row.normalizedPayload!.schedule.startsAtUtc)
          : null,
      title: normalizedLookupValue(row.normalizedPayload!.title),
    }));
  const facts = new Map<
    string,
    {
      codes: Set<CsvImportPreviewDuplicateDetail["code"]>;
      details: CsvImportPreviewDuplicateDetail[];
      total: number;
    }
  >();
  const candidatePayloadCte = jsonPayloadCteSql(
    "candidate_payload",
    chunkJsonValues(candidates),
  );
  if (
    candidatePayloadCte.bindings.length >
    MAX_DUPLICATE_CANDIDATE_CHUNKS
  ) {
    throw validationFailure(
      "The normalized duplicate preview exceeds the bounded D1 request budget.",
    );
  }
  const result = await database
    .prepare(
      `WITH ${candidatePayloadCte.sql},
         candidate AS (
           SELECT json_extract(item.value, '$.rowId') AS row_id,
                  json_extract(item.value, '$.externalId') AS external_id,
                  json_extract(item.value, '$.meetupUrl') AS meetup_url,
                  json_extract(item.value, '$.clubId') AS club_id,
                  json_extract(item.value, '$.title') AS title,
                  json_extract(item.value, '$.startsAt') AS starts_at,
                  json_extract(item.value, '$.endsAt') AS ends_at,
                  json_extract(item.value, '$.startDate') AS start_date,
                  json_extract(item.value, '$.endDate') AS end_date
           FROM candidate_payload AS item
         ),
         duplicate_match AS (
           SELECT candidate.row_id,
                  'hard_duplicate_source' AS code,
                  source_link.entity_id AS reference_id,
                  event.title
           FROM candidate
           INNER JOIN external_source_links AS source_link
             ON source_link.organization_id = ?
            AND source_link.entity_type = 'organizer_event'
            AND source_link.source_type = 'csv'
            AND source_link.sync_source_id = ?
            AND source_link.external_id = candidate.external_id
            AND source_link.deleted_at IS NULL
           LEFT JOIN organizer_events AS event
             ON event.id = source_link.entity_id
            AND event.organization_id = source_link.organization_id
           WHERE candidate.external_id IS NOT NULL
           UNION ALL
           SELECT candidate.row_id, 'hard_duplicate_meetup_url',
                  event.id, event.title
           FROM candidate
           INNER JOIN organizer_events AS event
             ON event.organization_id = ?
            AND event.meetup_event_url = candidate.meetup_url
            AND event.deleted_at IS NULL
           WHERE candidate.meetup_url IS NOT NULL
           UNION ALL
           SELECT candidate.row_id, 'semantic_duplicate_warning',
                  event.id, event.title
           FROM candidate
           INNER JOIN organizer_events AS event
             ON event.organization_id = ?
            AND event.club_id = candidate.club_id
            AND lower(trim(event.title)) = candidate.title
            AND event.deleted_at IS NULL
            AND (
              (
                candidate.starts_at IS NOT NULL
                AND event.starts_at_utc = candidate.starts_at
                AND event.ends_at_utc = candidate.ends_at
              )
              OR (
                candidate.start_date IS NOT NULL
                AND event.all_day_start_date = candidate.start_date
                AND event.all_day_end_date_exclusive =
                    candidate.end_date
              )
            )
         ),
         match_summary AS (
           SELECT row_id, count(*) AS total_matches,
                  max(code = 'hard_duplicate_source')
                    AS has_source_duplicate,
                  max(code = 'hard_duplicate_meetup_url')
                    AS has_meetup_duplicate,
                  max(code = 'semantic_duplicate_warning')
                    AS has_semantic_duplicate
           FROM duplicate_match
           GROUP BY row_id
         ),
         ranked_match AS (
           SELECT duplicate_match.*,
                  row_number() OVER (
                    PARTITION BY duplicate_match.row_id
                    ORDER BY
                      CASE duplicate_match.code
                        WHEN 'hard_duplicate_source' THEN 1
                        WHEN 'hard_duplicate_meetup_url' THEN 2
                        ELSE 3
                      END,
                      duplicate_match.reference_id
                  ) AS match_rank
           FROM duplicate_match
         )
         SELECT ranked_match.row_id, ranked_match.code,
                ranked_match.reference_id, ranked_match.title,
                match_summary.total_matches,
                match_summary.has_source_duplicate,
                match_summary.has_meetup_duplicate,
                match_summary.has_semantic_duplicate
         FROM ranked_match
         INNER JOIN match_summary
           ON match_summary.row_id = ranked_match.row_id
         WHERE ranked_match.match_rank <= ?
         ORDER BY ranked_match.row_id, ranked_match.match_rank`,
    )
    .bind(
      ...candidatePayloadCte.bindings,
      organizationId,
      sourceNamespace,
      organizationId,
      organizationId,
      MAX_DUPLICATE_DETAIL_IDENTITIES,
    )
    .all<Record<string, unknown>>();
  assertD1Result(result.success);
  for (const row of result.results ?? []) {
    const rowId = requiredString(row.row_id);
    const summary = facts.get(rowId) ?? {
      codes: new Set<CsvImportPreviewDuplicateDetail["code"]>(),
      details: [],
      total: 0,
    };
    const total = requiredInteger(row.total_matches);
    if (total < 1 || total > MAX_DUPLICATE_DETAIL_TOTAL) {
      throw validationFailure(
        "A duplicate preview result exceeds the bounded match limit.",
      );
    }
    if (summary.total !== 0 && summary.total !== total) {
      throw unavailableImport();
    }
    summary.total = total;
    if (requiredInteger(row.has_source_duplicate) === 1) {
      summary.codes.add("hard_duplicate_source");
    }
    if (requiredInteger(row.has_meetup_duplicate) === 1) {
      summary.codes.add("hard_duplicate_meetup_url");
    }
    if (requiredInteger(row.has_semantic_duplicate) === 1) {
      summary.codes.add("semantic_duplicate_warning");
    }
    const detail = Object.freeze({
      code: readDuplicateDetailCode(row.code),
      referenceId: requiredString(row.reference_id),
      source: "existing_event",
      sourceRowNumber: null,
      title: optionalString(row.title),
    } as const);
    if (summary.details.length < MAX_DUPLICATE_DETAIL_IDENTITIES) {
      summary.details.push(detail);
    }
    facts.set(rowId, summary);
  }
  return new Map(
    [...facts.entries()].map(([rowId, summary]) => [
      rowId,
      Object.freeze({
        codes: Object.freeze([...summary.codes]),
        details: Object.freeze([...summary.details]),
        total: summary.total,
      }),
    ]),
  );
}

function previewPersistenceValue(
  row: PreparedPreviewRow,
  actor: AuthorizedMembership,
  batchId: string,
  now: number,
): Readonly<Record<string, unknown>> {
  const sourcePayloadJson = JSON.stringify({
    _application: {
      errorCodesJson: JSON.stringify(row.errorCodes),
      idempotencyKey: row.applicationIdempotencyKey,
      normalizedRowFingerprint: row.normalizedRowFingerprint,
      previewResultCode: row.previewResultCode,
      warningCodesJson: JSON.stringify(row.warningCodes),
    },
    _preview: {
      conflictDetailsJson: JSON.stringify(row.conflictDetails),
      conflictDetailsTotal: row.conflictDetailsTotal,
      defaultsAppliedJson: JSON.stringify(row.defaultsApplied),
      duplicateDetailsJson: JSON.stringify(row.duplicateDetails),
      duplicateDetailsTotal: row.duplicateDetailsTotal,
      mappingFieldsJson: JSON.stringify(row.mappingFields),
      matchSummaryJson: JSON.stringify(row.matchSummary),
    },
    mappedValues: row.mappedValues,
  });
  return Object.freeze({
    batchId,
    createdAt: now,
    errorCode: row.errorCodes[0] ?? null,
    normalizedPayloadJson:
      row.normalizedPayload === null
        ? null
        : JSON.stringify(row.normalizedPayload),
    organizationId: actor.organizationId,
    rowId: row.rowId,
    sourcePayloadJson,
    sourceRowNumber: row.sourceRowNumber,
    status: row.normalizedPayload === null ? "rejected" : "accepted",
  });
}

async function prepareImportRateAdmissionStatements(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  actions: readonly Readonly<{
    action: string;
    durationMs: number;
  }>[],
  now: number,
): Promise<readonly D1PreparedStatementLike[]> {
  const statements: D1PreparedStatementLike[] = [];
  for (const item of actions) {
    const windowStartedAt =
      Math.floor(now / item.durationMs) * item.durationMs;
    const scopeKey = await sha256Hex(
      `${actor.organizationId}:${actor.profileId}:${item.action}`,
    );
    statements.push(
      database
        .prepare(
          `INSERT INTO organizer_rate_limits (
             id, organization_id, profile_id, action, scope_key,
             window_started_at, window_expires_at, request_count,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(action, scope_key, window_started_at)
           DO UPDATE SET
             request_count = organizer_rate_limits.request_count + 1,
             updated_at = excluded.updated_at`,
        )
        .bind(
          `rate:${crypto.randomUUID()}`,
          actor.organizationId,
          actor.profileId,
          item.action,
          scopeKey,
          windowStartedAt,
          windowStartedAt + item.durationMs,
          now,
          now,
        ),
    );
  }
  return Object.freeze(statements);
}

type ApprovalSourceRow = Readonly<{
  applicationState: string;
  errorCodes: readonly string[];
  previewResultCode: string;
  rowId: string;
  warningCodes: readonly string[];
}>;

type ImportApprovalSource = Readonly<{
  phase: string;
  previewFingerprint: string;
  previewVersion: number;
  rows: readonly ApprovalSourceRow[];
  version: number;
}>;

async function loadImportApprovalSource(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  batchId: string,
): Promise<ImportApprovalSource> {
  const [detail, rowsResult] = await Promise.all([
    database
      .prepare(
        `SELECT phase, version, preview_fingerprint, preview_version
         FROM import_batch_details
         WHERE import_batch_id = ? AND organization_id = ?
         LIMIT 1`,
      )
      .bind(batchId, actor.organizationId)
      .first<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT import_row_id, application_state, preview_result_code,
                preview_error_codes_json, preview_warning_codes_json
         FROM import_row_applications
         WHERE import_batch_id = ? AND organization_id = ?
         ORDER BY import_row_id`,
      )
      .bind(batchId, actor.organizationId)
      .all<Record<string, unknown>>(),
  ]);
  if (!detail) throw importNotFound();
  assertD1Result(rowsResult.success);
  return Object.freeze({
    phase: requiredString(detail.phase),
    previewFingerprint: requiredString(detail.preview_fingerprint),
    previewVersion: requiredInteger(detail.preview_version),
    rows: Object.freeze(
      (rowsResult.results ?? []).map((row) =>
        Object.freeze({
          applicationState: requiredString(row.application_state),
          errorCodes: readStringArray(row.preview_error_codes_json),
          previewResultCode: requiredString(row.preview_result_code),
          rowId: requiredString(row.import_row_id),
          warningCodes: readStringArray(row.preview_warning_codes_json),
        }),
      ),
    ),
    version: requiredInteger(detail.version),
  });
}

async function loadImportConflictPolicyMode(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
): Promise<"block" | "require_admin_approval" | "warn_reason"> {
  const row = await database
    .prepare(
      `SELECT policy.mode
       FROM organizer_conflict_policies AS policy
       WHERE policy.organization_id = ?
         AND EXISTS (
           SELECT 1
           FROM organization_memberships AS membership
           INNER JOIN profiles AS profile
             ON profile.id = membership.profile_id
            AND profile.status = 'active'
            AND profile.deleted_at IS NULL
           WHERE membership.id = ?
             AND membership.organization_id = policy.organization_id
             AND membership.profile_id = ?
             AND membership.role = ?
             AND membership.status = 'active'
             AND membership.deleted_at IS NULL
         )
       LIMIT 1`,
    )
    .bind(
      actor.organizationId,
      actor.membershipId,
      actor.profileId,
      actor.role,
    )
    .first<Record<string, unknown>>();
  return readConflictPolicyMode(row?.mode);
}

function readConflictPolicyMode(
  value: unknown,
): "block" | "require_admin_approval" | "warn_reason" {
  const mode = requiredString(value);
  if (
    mode !== "block" &&
    mode !== "require_admin_approval" &&
    mode !== "warn_reason"
  ) {
    throw unavailableImport();
  }
  return mode;
}

type ParsedApprovalDecision = Readonly<{
  action: "create_separate" | "selected" | "skip";
  conflictReason: string | null;
  duplicateReason: string | null;
  rowId: string;
}>;

function parseApprovalDecisions(
  value: unknown,
): readonly ParsedApprovalDecision[] {
  if (!Array.isArray(value) || value.length > 2_000) {
    throw validationFailure(
      "Provide a bounded approval decision list.",
    );
  }
  return Object.freeze(
    value.map((entry, index) => {
      const item = parseObject(entry, `decisions.${index}`);
      const action = requiredString(item.action);
      if (
        action !== "selected" &&
        action !== "skip" &&
        action !== "create_separate"
      ) {
        throw validationFailure("Choose a supported approval action.");
      }
      return Object.freeze({
        action,
        conflictReason: parseOptionalBoundedString(
          item.conflictReason,
          {
            path: `decisions.${index}.conflictReason`,
            maxLength: 1_000,
          },
        ),
        duplicateReason: parseOptionalBoundedString(
          item.duplicateReason,
          {
            path: `decisions.${index}.duplicateReason`,
            maxLength: 1_000,
          },
        ),
        rowId: parseIdentifier(item.rowId, `decisions.${index}.rowId`),
      });
    }),
  );
}

type PersistedApprovalDecision = Readonly<{
  action: "create_separate" | "selected" | "skip";
  applicationState: "approved" | "skipped";
  conflictDecision:
    | "administrator_review"
    | "blocked"
    | "none"
    | "reason_recorded";
  conflictReason: string | null;
  duplicateDecision: "create_separate" | "skip" | null;
  duplicateReason: string | null;
  resultCode: string | null;
  rowId: string;
}>;

function approvalPersistenceDecision(
  row: ApprovalSourceRow,
  decision: ParsedApprovalDecision,
  conflictPolicyMode:
    | "block"
    | "require_admin_approval"
    | "warn_reason",
): PersistedApprovalDecision {
  if (
    row.applicationState !== "previewed" ||
    row.previewResultCode === "invalid"
  ) {
    if (decision.action !== "skip") {
      throw validationFailure("Invalid rows cannot be selected.");
    }
    return terminalSkipDecision(
      row.rowId,
      "invalid_preview",
    );
  }
  if (row.previewResultCode === "hard_duplicate") {
    if (decision.action !== "skip") {
      throw validationFailure("Hard duplicates must be skipped.");
    }
    const code =
      row.errorCodes.find((item) =>
        item.startsWith("hard_duplicate_"),
      ) ?? "hard_duplicate_batch_fingerprint";
    return terminalSkipDecision(row.rowId, code);
  }
  const semanticWarning = row.warningCodes.includes(
    "semantic_duplicate_warning",
  );
  const conflictWarning =
    row.warningCodes.includes("existing_schedule_conflict") ||
    row.warningCodes.includes("intra_file_schedule_conflict");
  if (decision.action === "skip") {
    return terminalSkipDecision(
      row.rowId,
      semanticWarning
        ? "semantic_duplicate_skipped"
        : "skipped_by_approval",
    );
  }
  if (semanticWarning && decision.action !== "create_separate") {
    throw validationFailure(
      "A possible duplicate requires Create Separate Event or Skip.",
    );
  }
  if (
    decision.action === "create_separate" &&
    !decision.duplicateReason
  ) {
    throw validationFailure(
      "Creating a separate possible duplicate requires a reason.",
    );
  }
  if (conflictWarning && !decision.conflictReason) {
    throw validationFailure(
      "Selecting a conflict warning requires a reason.",
    );
  }
  if (conflictWarning && conflictPolicyMode === "block") {
    throw validationFailure(
      "This conflict is blocked by the current scheduling policy and must be skipped.",
    );
  }
  return Object.freeze({
    action: decision.action,
    applicationState: "approved" as const,
    conflictDecision: conflictWarning
      ? conflictPolicyMode === "require_admin_approval"
        ? ("administrator_review" as const)
        : ("reason_recorded" as const)
      : conflictPolicyMode === "require_admin_approval"
        ? ("administrator_review" as const)
        : conflictPolicyMode === "block"
          ? ("blocked" as const)
          : ("none" as const),
    conflictReason: conflictWarning ? decision.conflictReason : null,
    duplicateDecision: semanticWarning
      ? ("create_separate" as const)
      : ("skip" as const),
    duplicateReason: semanticWarning ? decision.duplicateReason : null,
    resultCode: null,
    rowId: row.rowId,
  });
}

function terminalSkipDecision(
  rowId: string,
  resultCode: string,
): PersistedApprovalDecision {
  return Object.freeze({
    action: "skip" as const,
    applicationState: "skipped" as const,
    conflictDecision: "none" as const,
    conflictReason: null,
    duplicateDecision: "skip" as const,
    duplicateReason: null,
    resultCode,
    rowId,
  });
}

async function assertApprovedImportEnvelope(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  batchId: string,
  previewFingerprint: string,
  previewVersion: number,
  selectedRowCount: number,
  skippedRowCount: number,
  approvedAt: number,
  expectedPhase: "approved" | "completed",
): Promise<void> {
  const row = await database
    .prepare(
      `SELECT count(*) AS exact_count
       FROM import_batch_details AS detail
       WHERE detail.import_batch_id = ?
         AND detail.organization_id = ?
         AND detail.phase = ?
         AND detail.preview_fingerprint = ?
         AND detail.preview_version = ?
         AND detail.selected_row_count = ?
         AND detail.skipped_row_count = ?
         AND detail.pending_row_count = ?
         AND detail.approved_by_profile_id = ?
         AND detail.approved_at = ?
         AND (
           SELECT count(*)
           FROM import_row_applications AS application
           WHERE application.organization_id = detail.organization_id
             AND application.import_batch_id = detail.import_batch_id
             AND application.approval_action IN (
               'selected', 'create_separate'
             )
             AND application.application_state = 'approved'
             AND application.approved_by_profile_id = ?
             AND application.approved_at = ?
         ) = ?
         AND (
           SELECT count(*)
           FROM import_row_applications AS application
           WHERE application.organization_id = detail.organization_id
             AND application.import_batch_id = detail.import_batch_id
             AND application.approval_action = 'skip'
             AND application.application_state = 'skipped'
             AND application.result_code IS NOT NULL
             AND application.approved_by_profile_id = ?
             AND application.apply_actor_profile_id = ?
             AND application.approved_at = ?
             AND application.applied_at = ?
         ) = ?`,
    )
    .bind(
      batchId,
      actor.organizationId,
      expectedPhase,
      previewFingerprint,
      previewVersion,
      selectedRowCount,
      skippedRowCount,
      selectedRowCount,
      actor.profileId,
      approvedAt,
      actor.profileId,
      approvedAt,
      selectedRowCount,
      actor.profileId,
      actor.profileId,
      approvedAt,
      approvedAt,
      skippedRowCount,
    )
    .first<Record<string, unknown>>();
  if (requiredInteger(row?.exact_count) !== 1) throw staleImport();
}

function approvalDetailTransitionStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  input: Readonly<{
    approvedAt: number;
    batchId: string;
    expectedVersion: number;
    previewFingerprint: string;
    previewVersion: number;
    selectedRowCount: number;
    skippedRowCount: number;
  }>,
): D1PreparedStatementLike {
  return database
    .prepare(
      `UPDATE import_batch_details
       SET selected_row_count = ?,
           skipped_row_count = ?,
           pending_row_count = ?,
           phase = 'approved',
           version = version + 1,
           approved_by_profile_id = ?,
           approved_at = ?,
           updated_by_profile_id = ?,
           updated_at = ?
       WHERE import_batch_id = ?
         AND organization_id = ?
         AND phase = 'previewed'
         AND version = ?
         AND preview_fingerprint = ?
         AND preview_version = ?`,
    )
    .bind(
      input.selectedRowCount,
      input.skippedRowCount,
      input.selectedRowCount,
      actor.profileId,
      input.approvedAt,
      actor.profileId,
      input.approvedAt,
      input.batchId,
      actor.organizationId,
      input.expectedVersion,
      input.previewFingerprint,
      input.previewVersion,
    );
}

function approvalCasCompletionStatement(
  database: D1DatabaseLike,
): D1PreparedStatementLike {
  return database.prepare(
    `SELECT CASE
       WHEN changes() = 1 THEN json('1')
       ELSE json('phase7_import_approval_cas_invalid')
     END AS exact_approval_cas`,
  );
}

function approvalEnvelopeSentinelStatement(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  input: Readonly<{
    approvedAt: number;
    batchId: string;
    completed: boolean;
    expectedVersion: number;
    previewFingerprint: string;
    previewVersion: number;
    selectedRowCount: number;
    skippedRowCount: number;
  }>,
): D1PreparedStatementLike {
  return database
    .prepare(
      `SELECT CASE WHEN
         EXISTS (
           SELECT 1
           FROM import_batch_details AS detail
           WHERE detail.import_batch_id = ?
             AND detail.organization_id = ?
             AND detail.version = ?
             AND detail.phase = ?
             AND detail.preview_fingerprint = ?
             AND detail.preview_version = ?
             AND detail.selected_row_count = ?
             AND detail.skipped_row_count = ?
             AND detail.pending_row_count = ?
             AND detail.imported_row_count = 0
             AND detail.failed_row_count = 0
             AND detail.approved_by_profile_id = ?
             AND detail.approved_at = ?
             AND detail.completed_at IS ?
             AND detail.outcome_code IS ?
             AND (
               SELECT count(*)
               FROM import_row_applications AS application
               WHERE application.organization_id =
                     detail.organization_id
                 AND application.import_batch_id =
                     detail.import_batch_id
                 AND application.approval_action IN (
                   'selected', 'create_separate'
                 )
                 AND application.application_state = 'approved'
                 AND application.approved_by_profile_id = ?
                 AND application.approved_at = ?
             ) = ?
             AND (
               SELECT count(*)
               FROM import_row_applications AS application
               WHERE application.organization_id =
                     detail.organization_id
                 AND application.import_batch_id =
                     detail.import_batch_id
                 AND application.approval_action = 'skip'
                 AND application.application_state = 'skipped'
                 AND application.result_code IS NOT NULL
                 AND application.approved_by_profile_id = ?
                 AND application.apply_actor_profile_id = ?
                 AND application.approved_at = ?
                 AND application.applied_at = ?
             ) = ?
         )
         AND EXISTS (
           SELECT 1
           FROM import_batches AS batch
           WHERE batch.id = ?
             AND batch.organization_id = ?
             AND batch.status = ?
             AND batch.completed_at IS ?
         )
       THEN json('1')
       ELSE json('phase7_import_approval_envelope_invalid')
       END AS exact_envelope`,
    )
    .bind(
      input.batchId,
      actor.organizationId,
      input.expectedVersion,
      input.completed ? "completed" : "approved",
      input.previewFingerprint,
      input.previewVersion,
      input.selectedRowCount,
      input.skippedRowCount,
      input.selectedRowCount,
      actor.profileId,
      input.approvedAt,
      input.completed ? input.approvedAt : null,
      input.completed ? "completed" : null,
      actor.profileId,
      input.approvedAt,
      input.selectedRowCount,
      actor.profileId,
      actor.profileId,
      input.approvedAt,
      input.approvedAt,
      input.skippedRowCount,
      input.batchId,
      actor.organizationId,
      input.completed ? "completed" : "processing",
      input.completed ? input.approvedAt : null,
    );
}

function readImportBatchSummary(
  row: Record<string, unknown>,
): CsvImportBatchSummary {
  return Object.freeze({
    actorDisplayName: requiredString(row.actor_display_name),
    actorProfileId: requiredString(row.created_by_profile_id),
    applicationCursor: requiredInteger(row.application_cursor),
    approvedAt: optionalInteger(row.approved_at),
    batchId: requiredString(row.batch_id),
    completedAt: optionalInteger(row.completed_at),
    createdAt: requiredInteger(row.batch_created_at),
    failedRowCount: requiredInteger(row.failed_row_count),
    fileSha256: requiredString(row.file_sha256),
    importedRowCount: requiredInteger(row.imported_row_count),
    invalidRowCount: requiredInteger(row.invalid_row_count),
    mappingFingerprint: requiredString(row.mapping_fingerprint),
    outcomeCode: optionalString(row.outcome_code),
    parserVersion: requiredInteger(row.parser_version),
    pendingRowCount: requiredInteger(row.pending_row_count),
    phase: requiredString(row.phase),
    redactionEligible: requiredInteger(row.redaction_eligible) === 1,
    redactionEligibleAt: requiredInteger(row.redaction_eligible_at),
    selectedRowCount: requiredInteger(row.selected_row_count),
    skippedRowCount: requiredInteger(row.skipped_row_count),
    sourceLabel: optionalString(row.source_label),
    sourceNamespace: requiredString(row.source_namespace),
    sourcePayloadRedactedAt: optionalInteger(
      row.source_payload_redacted_at,
    ),
    startedAt: optionalInteger(row.started_at),
    templateVersion: requiredInteger(row.template_version),
    totalRowCount: requiredInteger(row.total_row_count),
    validRowCount: requiredInteger(row.valid_row_count),
    version: requiredInteger(row.version),
    warningRowCount: requiredInteger(row.warning_row_count),
  });
}

function readImportMappingDecisions(
  value: unknown,
): readonly Readonly<{
  canonicalField: string | null;
  sourceHeader: string;
}>[] {
  if (typeof value !== "string") throw unavailableImport();
  const parsed = parseStoredObject(value);
  const entries = Object.entries(parsed);
  if (entries.length > 40) throw unavailableImport();
  const canonicalFields = new Set<string>(CSV_IMPORT_CANONICAL_COLUMNS);
  return Object.freeze(
    entries.map(([sourceHeader, canonicalField]) => {
      if (
        sourceHeader.length === 0 ||
        sourceHeader.length > 10_000 ||
        (canonicalField !== null &&
          (typeof canonicalField !== "string" ||
            !canonicalFields.has(canonicalField)))
      ) {
        throw unavailableImport();
      }
      return Object.freeze({
        canonicalField:
          canonicalField === null ? null : canonicalField,
        sourceHeader,
      });
    }),
  );
}

function readImportPreviewRow(
  row: Record<string, unknown>,
  conflictPolicyMode:
    | "block"
    | "require_admin_approval"
    | "warn_reason",
): CsvImportPreviewRowDto {
  const normalizedRaw = optionalString(row.normalized_payload_json);
  const applicationState = requiredString(row.application_state);
  const approvalAction = requiredString(row.approval_action);
  const previewResultCode = requiredString(row.preview_result_code);
  const warningCodes = readStringArray(
    row.preview_warning_codes_json,
  );
  const conflictDetails = readPreviewConflictDetails(
    row.conflict_details_json,
  );
  const conflictDetailsTotal =
    row.conflict_details_total === null ||
    row.conflict_details_total === undefined
      ? conflictDetails.length
      : requiredInteger(row.conflict_details_total);
  if (
    conflictDetailsTotal < conflictDetails.length ||
    conflictDetailsTotal > MAX_DUPLICATE_DETAIL_TOTAL
  ) {
    throw unavailableImport();
  }
  const duplicateDetails = readPreviewDuplicateDetails(
    row.duplicate_details_json,
  );
  const duplicateDetailsTotal =
    row.duplicate_details_total === null ||
    row.duplicate_details_total === undefined
      ? duplicateDetails.length
      : requiredInteger(row.duplicate_details_total);
  if (
    duplicateDetailsTotal < duplicateDetails.length ||
    duplicateDetailsTotal > MAX_DUPLICATE_DETAIL_TOTAL
  ) {
    throw unavailableImport();
  }
  const hasConflict = warningCodes.some(
    (code) =>
      code === "existing_schedule_conflict" ||
      code === "intra_file_schedule_conflict",
  );
  return Object.freeze({
    applicationState,
    approvalAction,
    canSelect:
      applicationState === "previewed" &&
      approvalAction === "pending" &&
      (previewResultCode === "valid" ||
        previewResultCode === "warning") &&
      !(conflictPolicyMode === "block" && hasConflict),
    conflictDetails,
    conflictDetailsHasMore:
      conflictDetailsTotal > conflictDetails.length,
    conflictDetailsTotal,
    defaultsApplied: readStringArrayOrEmpty(
      row.defaults_applied_json,
    ),
    duplicateDetails,
    duplicateDetailsHasMore:
      duplicateDetailsTotal > duplicateDetails.length,
    duplicateDetailsTotal,
    errorCodes: readStringArray(row.preview_error_codes_json),
    mappingFields: readStringArrayOrEmpty(row.mapping_fields_json),
    matchSummary: readPreviewMatchSummary(row.match_summary_json),
    normalized:
      normalizedRaw === null ||
      normalizedRaw === '{"redacted":true}'
        ? null
        : parseStoredObject(normalizedRaw),
    previewResultCode,
    resultCode: optionalString(row.result_code),
    rowId: requiredString(row.row_id),
    sourceRowNumber: requiredInteger(row.row_number),
    targetEventId: optionalString(row.target_organizer_event_id),
    warningCodes,
  });
}

function readPreviewMatchSummary(
  value: unknown,
): CsvImportPreviewMatchSummary {
  if (value === null || value === undefined) {
    return previewMatchSummary(null, [], []);
  }
  if (typeof value !== "string") throw unavailableImport();
  const parsed = parseStoredObject(value);
  const coOrganizers = Array.isArray(parsed.coOrganizers)
    ? parsed.coOrganizers.map((item) => requiredString(item))
    : (() => {
        throw unavailableImport();
      })();
  return Object.freeze({
    category: optionalString(parsed.category),
    club: optionalString(parsed.club),
    coOrganizers: Object.freeze(coOrganizers),
    lane: optionalString(parsed.lane),
    primaryOrganizer: optionalString(parsed.primaryOrganizer),
    program: optionalString(parsed.program),
    venue: optionalString(parsed.venue),
  });
}

function readPreviewConflictDetails(
  value: unknown,
): readonly CsvImportPreviewConflictDetail[] {
  if (value === null || value === undefined) return Object.freeze([]);
  if (typeof value !== "string") throw unavailableImport();
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.length > MAX_CONFLICT_DETAIL_IDENTITIES
    ) {
      throw unavailableImport();
    }
    return Object.freeze(
      parsed.map((item) => {
        const row = parseObject(item, "conflictDetail");
        return Object.freeze({
          endsAtUtc: parseFiniteInteger(row.endsAtUtc, {
            path: "conflictDetail.endsAtUtc",
            minimum: 0,
          }),
          planningStatus: parseBoundedString(row.planningStatus, {
            path: "conflictDetail.planningStatus",
            maxLength: 40,
          }),
          referenceId: parseIdentifier(
            row.referenceId,
            "conflictDetail.referenceId",
          ),
          source: readPreviewConflictSource(row.source),
          sourceRowNumber:
            row.sourceRowNumber === null
              ? null
              : parseFiniteInteger(row.sourceRowNumber, {
                  path: "conflictDetail.sourceRowNumber",
                  minimum: 1,
                }),
          startsAtUtc: parseFiniteInteger(row.startsAtUtc, {
            path: "conflictDetail.startsAtUtc",
            minimum: 0,
          }),
          title: parseBoundedString(row.title, {
            path: "conflictDetail.title",
            maxLength: 180,
          }),
        });
      }),
    );
  } catch (error) {
    if (error instanceof SafeApplicationError) throw error;
    throw unavailableImport();
  }
}

function readPreviewDuplicateDetails(
  value: unknown,
): readonly CsvImportPreviewDuplicateDetail[] {
  if (value === null || value === undefined) return Object.freeze([]);
  if (typeof value !== "string") throw unavailableImport();
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.length > MAX_DUPLICATE_DETAIL_IDENTITIES
    ) {
      throw unavailableImport();
    }
    return Object.freeze(
      parsed.map((item) => {
        const row = parseObject(item, "duplicateDetail");
        const source = parseBoundedString(row.source, {
          path: "duplicateDetail.source",
          maxLength: 30,
        });
        if (source !== "existing_event" && source !== "import_row") {
          throw unavailableImport();
        }
        return Object.freeze({
          code: readDuplicateDetailCode(row.code),
          referenceId: parseIdentifier(
            row.referenceId,
            "duplicateDetail.referenceId",
          ),
          source,
          sourceRowNumber:
            row.sourceRowNumber === null
              ? null
              : parseFiniteInteger(row.sourceRowNumber, {
                  path: "duplicateDetail.sourceRowNumber",
                  minimum: 1,
                }),
          title:
            row.title === null
              ? null
              : parseBoundedString(row.title, {
                  path: "duplicateDetail.title",
                  maxLength: 180,
                }),
        });
      }),
    );
  } catch (error) {
    if (error instanceof SafeApplicationError) throw error;
    throw unavailableImport();
  }
}

function chunkJsonValues(
  values: readonly unknown[],
): readonly string[] {
  const chunks: string[] = [];
  let current: unknown[] = [];
  for (const value of values) {
    const single = JSON.stringify([value]);
    if (
      new TextEncoder().encode(single).byteLength >
      MAX_JSON_BIND_BYTES
    ) {
      throw validationFailure(
        "An import persistence row exceeds the bounded D1 payload.",
      );
    }
    const candidate = JSON.stringify([...current, value]);
    if (new TextEncoder().encode(candidate).byteLength > MAX_JSON_BIND_BYTES) {
      if (current.length === 0) {
        throw validationFailure(
          "An import persistence row exceeds the bounded D1 payload.",
        );
      }
      chunks.push(JSON.stringify(current));
      current = [value];
    } else {
      current.push(value);
    }
  }
  if (current.length > 0) chunks.push(JSON.stringify(current));
  return Object.freeze(chunks);
}

function jsonPayloadCteSql(
  name: string,
  chunks: readonly string[],
): Readonly<{
  bindings: readonly string[];
  sql: string;
}> {
  if (!/^[a-z][a-z0-9_]*$/u.test(name)) {
    throw new Error("Invalid internal JSON payload CTE name.");
  }
  if (chunks.length === 0) {
    return Object.freeze({
      bindings: Object.freeze([]),
      sql: `${name}(value) AS (SELECT NULL WHERE 0)`,
    });
  }
  return Object.freeze({
    bindings: Object.freeze([...chunks]),
    sql: `${name}_chunks(payload) AS (VALUES ${chunks
      .map(() => "(?)")
      .join(", ")}),
      ${name}(value) AS (
        SELECT item.value
        FROM ${name}_chunks AS chunk
        CROSS JOIN json_each(chunk.payload) AS item
      )`,
  });
}

async function runExactBatch(
  database: D1DatabaseLike,
  statements: readonly D1PreparedStatementLike[],
  options: Readonly<{
    requiredPositiveIndexes?: readonly number[];
  }> = {},
): Promise<void> {
  try {
    const results = await database.batch([...statements]);
    if (
      results.some((result) => result.success === false) ||
      (options.requiredPositiveIndexes ?? []).some(
        (index) => changed(results[index]) < 1,
      )
    ) {
      throw staleImport();
    }
  } catch (error) {
    if (isImportRateLimitError(error)) {
      throw new SafeApplicationError(
        "rate_limited",
        429,
        "The import limit was reached. Wait for the current window before trying again.",
      );
    }
    throw error;
  }
}

function isImportRateLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("phase7_import_rate_limit_invalid") ||
      error.message.includes(
        "organizer_rate_limits_request_count_check",
      ))
  );
}

function readReferenceKind(value: unknown): ImportReferenceKind {
  const kind = requiredString(value);
  if (
    kind !== "club" &&
    kind !== "program" &&
    kind !== "lane" &&
    kind !== "category" &&
    kind !== "venue"
  ) {
    throw unavailableImport();
  }
  return kind;
}

function readConflictDecision(
  value: unknown,
): ImportApplicationRowSource["conflictDecision"] {
  const decision = requiredString(value);
  if (
    decision !== "administrator_review" &&
    decision !== "blocked" &&
    decision !== "none" &&
    decision !== "reason_recorded"
  ) {
    throw unavailableImport();
  }
  return decision;
}

function readOrganizerRole(
  value: unknown,
): "administrator" | "organizer" | "owner" {
  const role = requiredString(value);
  if (
    role !== "owner" &&
    role !== "administrator" &&
    role !== "organizer"
  ) {
    throw unavailableImport();
  }
  return role;
}

function parseStoredObject(value: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw unavailableImport();
    }
    return Object.freeze({ ...(parsed as Record<string, unknown>) });
  } catch {
    throw unavailableImport();
  }
}

function readStringArray(value: unknown): readonly string[] {
  if (typeof value !== "string") throw unavailableImport();
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.some((item) => typeof item !== "string")
    ) {
      throw unavailableImport();
    }
    return Object.freeze([...parsed]);
  } catch {
    throw unavailableImport();
  }
}

function readStringArrayOrEmpty(
  value: unknown,
): readonly string[] {
  return value === null || value === undefined
    ? Object.freeze([])
    : readStringArray(value);
}

function normalizedLookupValue(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-CA");
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseHash(value: unknown, path: string): string {
  const hash = parseBoundedString(value, {
    path,
    minLength: 64,
    maxLength: 64,
  }).toLocaleLowerCase("en-CA");
  if (!/^[0-9a-f]{64}$/u.test(hash)) {
    throw validationFailure("The stored import fingerprint is invalid.");
  }
  return hash;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw unavailableImport();
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : requiredString(value);
}

function requiredInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw unavailableImport();
  }
  return value;
}

function optionalInteger(value: unknown): number | null {
  return value === null || value === undefined
    ? null
    : requiredInteger(value);
}

function changed(
  result:
    | Readonly<{ meta?: Readonly<{ changes?: number }> }>
    | undefined,
): number {
  return result?.meta?.changes ?? 0;
}

function assertD1Result(success: boolean | undefined): void {
  if (success === false) throw unavailableImport();
}

function importNotFound(): SafeApplicationError {
  return new SafeApplicationError(
    "not_found",
    404,
    "The import batch is not available.",
  );
}

function staleImport(): SafeApplicationError {
  return new SafeApplicationError(
    "stale_edit",
    409,
    "The import changed. Refresh its durable preview before continuing.",
  );
}

function validationFailure(message: string): SafeApplicationError {
  return new SafeApplicationError("validation_failed", 422, message);
}

function unavailableImport(): SafeApplicationError {
  return new SafeApplicationError(
    "service_unavailable",
    503,
    "The import service is not available.",
  );
}
