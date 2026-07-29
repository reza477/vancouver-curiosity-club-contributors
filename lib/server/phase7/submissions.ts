import {
  authorizeMembership,
  type AuthorizedMembership,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  parseBoundedString,
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  parseOptionalBoundedString,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import { currentD1Time } from "../organizer/conflicts";
import {
  PUBLIC_FORM_KEYS,
  parsePublicFormPayload,
  type PublicFormKey,
  type PublicFormPayload,
} from "./public-form-contract";

export const SUBMISSION_STATUSES = [
  "new",
  "in_review",
  "responded",
  "archived",
] as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export type SubmissionListItem = Readonly<{
  assignedTo: Readonly<{ displayName: string; profileId: string }> | null;
  createdAt: number;
  formKey: PublicFormKey;
  id: string;
  publicReference: string;
  retentionDue: boolean;
  retentionReviewAt: number;
  status: SubmissionStatus;
  version: number;
}>;

export type SubmissionListPage = Readonly<{
  firstResult: number;
  items: readonly SubmissionListItem[];
  lastResult: number;
  page: number;
  pageSize: number;
  totalCount: number;
}>;

export type SubmissionNoteDto = Readonly<{
  authorDisplayName: string;
  authorProfileId: string;
  body: string;
  createdAt: number;
  id: string;
  redacted: boolean;
}>;

export type SubmissionHistoryDto = Readonly<{
  action: string;
  actorDisplayName: string | null;
  createdAt: number;
  id: string;
}>;

export type SubmissionDetailDto = SubmissionListItem &
  Readonly<{
    fields: PublicFormPayload | Readonly<{ redacted: true }>;
    history: readonly SubmissionHistoryDto[];
    notes: readonly SubmissionNoteDto[];
    redactedAt: number | null;
  }>;

export type SubmissionAssigneeOption = Readonly<{
  displayName: string;
  profileId: string;
  role: "owner" | "administrator" | "organizer";
}>;

export async function listFormSubmissions(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  input: Readonly<{
    assignment?: unknown;
    fromDate?: unknown;
    formKey?: unknown;
    page?: unknown;
    search?: unknown;
    status?: unknown;
    toDate?: unknown;
  }> = {},
  nowUtcMs = Date.now(),
): Promise<SubmissionListPage> {
  const actor = await authorizeMembership(database, identity);
  const page = parseOptionalInteger(input.page, 1, 10_000, 1);
  const pageSize = 30;
  const search = parseOptionalBoundedString(input.search, {
    path: "search",
    maxLength: 96,
  });
  const receivedRange = parseReceivedDateRange(
    input.fromDate,
    input.toDate,
  );
  const formKey =
    input.formKey === undefined || input.formKey === ""
      ? null
      : parseEnum(input.formKey, PUBLIC_FORM_KEYS, "formKey");
  const status =
    input.status === undefined || input.status === ""
      ? null
      : parseEnum(input.status, SUBMISSION_STATUSES, "status");
  const assignment =
    input.assignment === undefined || input.assignment === ""
      ? "all"
      : parseAssignmentFilter(input.assignment);
  const manager = isManager(actor);
  const requestedAssignee =
    assignment === "mine"
      ? actor.profileId
      : assignment === "unassigned" || assignment === "all"
        ? null
        : assignment;
  const assignmentMode =
    actor.role === "organizer"
      ? "mine"
      : assignment === "unassigned"
        ? "unassigned"
        : requestedAssignee
          ? "profile"
          : "all";
  const normalizedSearch = search?.toLocaleLowerCase("en-CA") ?? null;
  const where = `
    submission.organization_id = ?
    AND submission.deleted_at IS NULL
    AND workflow.canonical_status <> 'spam'
    AND EXISTS (
      SELECT 1
      FROM form_submission_write_intents AS current_intent
      WHERE current_intent.id = workflow.write_intent_id
        AND current_intent.organization_id = workflow.organization_id
        AND current_intent.submission_id = workflow.submission_id
        AND current_intent.completed_at IS NOT NULL
        AND current_intent.completion_audit_log_id IS NOT NULL
    )
    AND (? IS NULL OR workflow.created_at >= ?)
    AND (? IS NULL OR workflow.created_at < ?)
    AND (? IS NULL OR submission.form_key = ?)
    AND (? IS NULL OR workflow.canonical_status = ?)
    AND (
      ? IS NULL
      OR instr(lower(workflow.public_reference), ?) > 0
      OR instr(lower(submission.form_key), ?) > 0
    )
    AND (
      ? = 'all'
      OR (? = 'mine' AND submission.assigned_to_profile_id = ?)
      OR (? = 'unassigned' AND submission.assigned_to_profile_id IS NULL)
      OR (? = 'profile' AND submission.assigned_to_profile_id = ?)
    )
    AND (
      ? = 1
      OR submission.assigned_to_profile_id = ?
    )`;
  const bindings = [
    actor.organizationId,
    receivedRange?.fromUtcMs ?? null,
    receivedRange?.fromUtcMs ?? null,
    receivedRange?.toExclusiveUtcMs ?? null,
    receivedRange?.toExclusiveUtcMs ?? null,
    formKey,
    formKey,
    status,
    status,
    normalizedSearch,
    normalizedSearch,
    normalizedSearch,
    assignmentMode,
    assignmentMode,
    actor.profileId,
    assignmentMode,
    assignmentMode,
    requestedAssignee,
    manager ? 1 : 0,
    actor.profileId,
  ] as const;
  const count = await database
    .prepare(
      `SELECT COUNT(*) AS total_count
       FROM form_submissions AS submission
       JOIN form_submission_workflows AS workflow
         ON workflow.submission_id = submission.id
        AND workflow.organization_id = submission.organization_id
       WHERE ${where}`,
    )
    .bind(...bindings)
    .first<number>("total_count");
  const totalCount =
    typeof count === "number" && Number.isSafeInteger(count) ? count : 0;
  const offset = (page - 1) * pageSize;
  const result = await database
    .prepare(
      `SELECT submission.id,
              submission.form_key,
              submission.assigned_to_profile_id,
              workflow.public_reference,
              workflow.canonical_status,
              workflow.retention_review_at,
              workflow.version,
              workflow.created_at,
              assignee.display_name AS assignee_display_name
       FROM form_submissions AS submission
       JOIN form_submission_workflows AS workflow
         ON workflow.submission_id = submission.id
        AND workflow.organization_id = submission.organization_id
       LEFT JOIN profiles AS assignee
         ON assignee.id = submission.assigned_to_profile_id
       WHERE ${where}
       ORDER BY workflow.created_at DESC, submission.id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, pageSize, offset)
    .all<Record<string, unknown>>();
  const items = (result.results ?? [])
    .map((row) => readListItem(row, nowUtcMs))
    .filter((item): item is SubmissionListItem => item !== null);
  const accessStillCurrent = await database
    .prepare(
      `SELECT COUNT(*) AS exact_count
       FROM organization_memberships AS membership
       JOIN profiles AS profile
         ON profile.id = membership.profile_id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
       WHERE membership.organization_id = ?
         AND membership.profile_id = ?
         AND membership.status = 'active'
         AND membership.deleted_at IS NULL
         AND (
           SELECT COUNT(*)
           FROM form_submissions AS submission
           JOIN form_submission_workflows AS workflow
             ON workflow.submission_id = submission.id
            AND workflow.organization_id = submission.organization_id
           WHERE ${where}
         ) = ?
         AND (
           (
             ? = 1
             AND membership.role IN ('owner', 'administrator')
           )
           OR (
             ? = 0
             AND membership.role = 'organizer'
             AND NOT EXISTS (
               SELECT 1
               FROM json_each(?) AS returned
               LEFT JOIN form_submissions AS current_submission
                 ON current_submission.id = returned.value
                AND current_submission.organization_id =
                    membership.organization_id
                AND current_submission.deleted_at IS NULL
                AND current_submission.assigned_to_profile_id =
                    membership.profile_id
               WHERE current_submission.id IS NULL
             )
           )
         )`,
    )
    .bind(
      actor.organizationId,
      actor.profileId,
      ...bindings,
      totalCount,
      manager ? 1 : 0,
      manager ? 1 : 0,
      JSON.stringify(items.map((item) => item.id)),
    )
    .first<number>("exact_count");
  if (accessStillCurrent !== 1) throw notFound();
  return Object.freeze({
    firstResult: items.length === 0 ? 0 : offset + 1,
    items: Object.freeze(items),
    lastResult: offset + items.length,
    page,
    pageSize,
    totalCount,
  });
}

export async function getFormSubmission(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  submissionIdInput: unknown,
  nowUtcMs = Date.now(),
): Promise<SubmissionDetailDto> {
  const actor = await authorizeMembership(database, identity);
  const submissionId = parseIdentifier(submissionIdInput, "submissionId");
  const row = await database
    .prepare(
      `${SUBMISSION_DETAIL_SELECT_SQL}
       WHERE submission.id = ?
         AND submission.organization_id = ?
         AND submission.deleted_at IS NULL
         AND workflow.canonical_status <> 'spam'
         AND (
           ? = 1
           OR submission.assigned_to_profile_id = ?
         )
       LIMIT 1`,
    )
    .bind(
      submissionId,
      actor.organizationId,
      isManager(actor) ? 1 : 0,
      actor.profileId,
    )
    .first<Record<string, unknown>>();
  if (!row) throw notFound();
  const base = readListItem(row, nowUtcMs);
  if (!base) throw unavailable();
  const fields = readPrivatePayload(row.payload_json, base.formKey);
  const [notesResult, historyResult] = await Promise.all([
    database
      .prepare(
        `SELECT note.id, note.author_profile_id, note.body_text,
                note.created_at, note.redacted_at,
                author.display_name AS author_display_name
         FROM form_submission_notes AS note
         JOIN profiles AS author
           ON author.id = note.author_profile_id
         WHERE note.organization_id = ?
           AND note.submission_id = ?
         ORDER BY note.created_at ASC, note.id ASC
         LIMIT 500`,
      )
      .bind(actor.organizationId, submissionId)
      .all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT audit.id, audit.action, audit.created_at,
                actor.display_name AS actor_display_name
         FROM audit_logs AS audit
         LEFT JOIN profiles AS actor
           ON actor.id = audit.actor_profile_id
         WHERE audit.organization_id = ?
           AND audit.entity_type = 'form_submission'
           AND audit.entity_id = ?
           AND audit.action IN (
             'form_submission.created',
             'form_submission.assigned',
             'form_submission.status_changed',
             'form_submission.note_added',
             'form_submission.personal_content_redacted'
           )
         ORDER BY audit.created_at ASC, audit.id ASC
         LIMIT 500`,
      )
      .bind(actor.organizationId, submissionId)
      .all<Record<string, unknown>>(),
  ]);
  const stillAuthorized = await database
    .prepare(
      `SELECT COUNT(*) AS exact_count
       FROM form_submissions AS submission
       JOIN form_submission_workflows AS workflow
         ON workflow.submission_id = submission.id
        AND workflow.organization_id = submission.organization_id
       JOIN form_submission_write_intents AS current_intent
         ON current_intent.id = workflow.write_intent_id
        AND current_intent.organization_id = workflow.organization_id
        AND current_intent.submission_id = workflow.submission_id
        AND current_intent.completed_at IS NOT NULL
        AND current_intent.completion_audit_log_id IS NOT NULL
       JOIN organization_memberships AS membership
         ON membership.organization_id = submission.organization_id
        AND membership.profile_id = ?
        AND membership.status = 'active'
        AND membership.deleted_at IS NULL
       JOIN profiles AS profile
         ON profile.id = membership.profile_id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
       WHERE submission.id = ?
         AND submission.organization_id = ?
         AND submission.deleted_at IS NULL
         AND workflow.version = ?
         AND workflow.canonical_status <> 'spam'
         AND (
           membership.role IN ('owner', 'administrator')
           OR (
             membership.role = 'organizer'
             AND submission.assigned_to_profile_id =
                 membership.profile_id
           )
         )`,
    )
    .bind(
      actor.profileId,
      submissionId,
      actor.organizationId,
      base.version,
    )
    .first<number>("exact_count");
  if (stillAuthorized !== 1) throw notFound();
  return Object.freeze({
    ...base,
    fields,
    history: Object.freeze(
      (historyResult.results ?? []).flatMap(readHistory),
    ),
    notes: Object.freeze((notesResult.results ?? []).flatMap(readNote)),
    redactedAt: nullableInteger(row.redacted_at),
  });
}

export async function listSubmissionAssignees(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
): Promise<readonly SubmissionAssigneeOption[]> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const result = await database
    .prepare(
      `SELECT membership.profile_id, membership.role,
              profile.display_name
       FROM organization_memberships AS membership
       JOIN profiles AS profile
         ON profile.id = membership.profile_id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
       WHERE membership.organization_id = ?
         AND membership.status = 'active'
         AND membership.deleted_at IS NULL
       ORDER BY profile.display_name COLLATE NOCASE, profile.id
       LIMIT 200`,
    )
    .bind(actor.organizationId)
    .all<Record<string, unknown>>();
  return Object.freeze(
    (result.results ?? []).flatMap((row) => {
      const profileId = stringValue(row.profile_id);
      const role = readRole(row.role);
      if (!profileId || !role) return [];
      return [
        Object.freeze({
          displayName: safeDisplayName(row.display_name),
          profileId,
          role,
        }),
      ];
    }),
  );
}

export async function assignFormSubmission(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  input: Readonly<{
    assigneeProfileId: unknown;
    expectedVersion: unknown;
    submissionId: unknown;
  }>,
): Promise<SubmissionDetailDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const submissionId = parseIdentifier(input.submissionId, "submissionId");
  const expectedVersion = parseVersion(input.expectedVersion);
  const assigneeProfileId =
    input.assigneeProfileId === null || input.assigneeProfileId === ""
      ? null
      : parseIdentifier(input.assigneeProfileId, "assigneeProfileId");
  const current = await requireMutationState(
    database,
    actor,
    submissionId,
    expectedVersion,
  );
  const now = await currentD1Time(database);
  const intentId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const notificationId = `${submissionId}:assignment:${expectedVersion + 1}`;
  const statements: D1PreparedStatementLike[] = [
    submissionWriteIntentStatement(database, {
      action: "assign",
      actor,
      assignedToProfileId: assigneeProfileId,
      expectedVersion,
      intentId,
      now,
      payloadJson: current.payloadJson,
      status: current.status,
      submissionId,
    }),
    database
      .prepare(
        `UPDATE form_submission_workflows
         SET write_intent_id = ?,
             version = version + 1,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE submission_id = ?
           AND organization_id = ?
           AND version = ?
           AND canonical_status = ?
           AND canonical_status <> 'spam'`,
      )
      .bind(
        intentId,
        actor.profileId,
        now,
        submissionId,
        actor.organizationId,
        expectedVersion,
        current.status,
      ),
    database
      .prepare(
        `UPDATE form_submissions
         SET assigned_to_profile_id = ?,
             updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND deleted_at IS NULL
           AND payload_json = ?
           AND EXISTS (
             SELECT 1
             FROM form_submission_workflows AS workflow
             WHERE workflow.submission_id = form_submissions.id
               AND workflow.organization_id =
                   form_submissions.organization_id
               AND workflow.write_intent_id = ?
               AND workflow.version = ?
               AND workflow.canonical_status = ?
           )`,
      )
      .bind(
        assigneeProfileId,
        now,
        submissionId,
        actor.organizationId,
        current.payloadJson,
        intentId,
        expectedVersion + 1,
        current.status,
      ),
    ...(assigneeProfileId
      ? [
          assignmentNotificationStatement(database, {
            assigneeProfileId,
            notificationId,
            now,
            organizationId: actor.organizationId,
            submissionId,
          }),
        ]
      : []),
    submissionAuditCompletionStatement(database, {
      action: "form_submission.assigned",
      actor,
      auditId,
      expectedAssignment: assigneeProfileId,
      expectedStatus: null,
      expectedVersion: expectedVersion + 1,
      intentId,
      metadata: {
        assigned: assigneeProfileId !== null,
        version: expectedVersion + 1,
      },
      now,
      requireNotificationId: assigneeProfileId ? notificationId : null,
      submissionId,
    }),
    submissionIntentCompletionStatement(database, {
      action: "assign",
      actor,
      auditId,
      intentId,
      now,
      submissionId,
    }),
  ];
  await runSubmissionMutation(database, statements);
  return getFormSubmission(database, identity, submissionId, now);
}

export async function changeFormSubmissionStatus(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  input: Readonly<{
    expectedVersion: unknown;
    status: unknown;
    submissionId: unknown;
  }>,
): Promise<SubmissionDetailDto> {
  const actor = await authorizeMembership(database, identity);
  const submissionId = parseIdentifier(input.submissionId, "submissionId");
  const expectedVersion = parseVersion(input.expectedVersion);
  const status = parseEnum(input.status, SUBMISSION_STATUSES, "status");
  const current = await requireMutationState(
    database,
    actor,
    submissionId,
    expectedVersion,
  );
  assertStatusTransition(actor, current.status, status);
  const now = await currentD1Time(database);
  const intentId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const legacyStatus = legacyStatusFor(status);
  const statements = [
    submissionWriteIntentStatement(database, {
      action: "status",
      actor,
      assignedToProfileId: current.assignedToProfileId,
      expectedVersion,
      intentId,
      now,
      payloadJson: current.payloadJson,
      status,
      submissionId,
    }),
    database
      .prepare(
        `UPDATE form_submission_workflows
         SET canonical_status = ?,
             write_intent_id = ?,
             version = version + 1,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE submission_id = ?
           AND organization_id = ?
           AND version = ?
           AND canonical_status = ?
           AND canonical_status <> 'spam'`,
      )
      .bind(
        status,
        intentId,
        actor.profileId,
        now,
        submissionId,
        actor.organizationId,
        expectedVersion,
        current.status,
      ),
    database
      .prepare(
        `UPDATE form_submissions
         SET status = ?, updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND deleted_at IS NULL
           AND status = ?
           AND assigned_to_profile_id IS ?
           AND payload_json = ?
           AND EXISTS (
             SELECT 1
             FROM form_submission_workflows AS workflow
             WHERE workflow.submission_id = form_submissions.id
               AND workflow.organization_id =
                   form_submissions.organization_id
               AND workflow.write_intent_id = ?
               AND workflow.version = ?
               AND workflow.canonical_status = ?
           )`,
      )
      .bind(
        legacyStatus,
        now,
        submissionId,
        actor.organizationId,
        legacyStatusFor(current.status),
        current.assignedToProfileId,
        current.payloadJson,
        intentId,
        expectedVersion + 1,
        status,
      ),
    submissionAuditCompletionStatement(database, {
      action: "form_submission.status_changed",
      actor,
      auditId,
      expectedAssignment: undefined,
      expectedStatus: status,
      expectedVersion: expectedVersion + 1,
      intentId,
      metadata: {
        from: current.status,
        to: status,
        version: expectedVersion + 1,
      },
      now,
      requireNotificationId: null,
      submissionId,
    }),
    submissionIntentCompletionStatement(database, {
      action: "status",
      actor,
      auditId,
      intentId,
      now,
      submissionId,
    }),
  ];
  await runSubmissionMutation(database, statements);
  return getFormSubmission(database, identity, submissionId, now);
}

export async function appendFormSubmissionNote(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  input: Readonly<{ body: unknown; submissionId: unknown }>,
): Promise<SubmissionDetailDto> {
  const actor = await authorizeMembership(database, identity);
  const submissionId = parseIdentifier(input.submissionId, "submissionId");
  const body = parseBoundedString(input.body, {
    path: "body",
    minLength: 1,
    maxLength: 4_000,
  })
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .trim();
  if (!body) throw validationFailure();
  const now = await currentD1Time(database);
  const noteId = crypto.randomUUID();
  const statements = [
    database
      .prepare(
        `INSERT INTO form_submission_notes (
           id, organization_id, submission_id, author_profile_id,
           body_text, created_at, redacted_at, redacted_by_profile_id
         )
         SELECT ?, ?, submission.id, ?, ?, ?, NULL, NULL
         FROM form_submissions AS submission
         JOIN form_submission_workflows AS workflow
           ON workflow.submission_id = submission.id
          AND workflow.organization_id = submission.organization_id
         JOIN form_submission_write_intents AS current_intent
           ON current_intent.id = workflow.write_intent_id
          AND current_intent.organization_id = workflow.organization_id
          AND current_intent.submission_id = workflow.submission_id
          AND current_intent.completed_at IS NOT NULL
          AND current_intent.completion_audit_log_id IS NOT NULL
         WHERE submission.id = ?
           AND submission.organization_id = ?
           AND submission.deleted_at IS NULL
           AND workflow.canonical_status <> 'spam'
           AND workflow.redacted_at IS NULL
           AND (
             ? = 1
             OR submission.assigned_to_profile_id = ?
           )`,
      )
      .bind(
        noteId,
        actor.organizationId,
        actor.profileId,
        body,
        now,
        submissionId,
        actor.organizationId,
        isManager(actor) ? 1 : 0,
        actor.profileId,
      ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         )
         VALUES (
           ?, ?, ?,
           CASE
             WHEN changes() = 1
              AND EXISTS (
                SELECT 1
                FROM form_submission_notes
                WHERE id = ?
                  AND organization_id = ?
                  AND submission_id = ?
                  AND author_profile_id = ?
                  AND body_text = ?
              )
             THEN 'form_submission.note_added'
             ELSE NULL
           END,
           'form_submission', ?, ?, ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        noteId,
        actor.organizationId,
        submissionId,
        actor.profileId,
        body,
        submissionId,
        JSON.stringify({ noteId }),
        now,
      ),
  ];
  await runSubmissionMutation(database, statements);
  return getFormSubmission(database, identity, submissionId, now);
}

export async function redactFormSubmissionPersonalContent(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  input: Readonly<{
    confirmationReference: unknown;
    expectedVersion: unknown;
    submissionId: unknown;
  }>,
): Promise<SubmissionDetailDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner"],
  });
  const submissionId = parseIdentifier(input.submissionId, "submissionId");
  const expectedVersion = parseVersion(input.expectedVersion);
  const confirmationReference = parseBoundedString(
    input.confirmationReference,
    { path: "confirmationReference", minLength: 5, maxLength: 96 },
  );
  const current = await requireMutationState(
    database,
    actor,
    submissionId,
    expectedVersion,
  );
  if (confirmationReference !== current.publicReference) {
    throw validationFailure();
  }
  const now = await currentD1Time(database);
  const marker = '{"redacted":true}';
  const intentId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const statements = [
    submissionWriteIntentStatement(database, {
      action: "redact",
      actor,
      assignedToProfileId: current.assignedToProfileId,
      expectedVersion,
      intentId,
      now,
      payloadJson: marker,
      status: current.status,
      submissionId,
    }),
    database
      .prepare(
        `UPDATE form_submission_workflows
         SET redacted_at = ?,
             redacted_by_profile_id = ?,
             write_intent_id = ?,
             updated_by_profile_id = ?,
             version = version + 1,
             updated_at = ?
         WHERE submission_id = ?
           AND organization_id = ?
           AND version = ?
           AND public_reference = ?
           AND redacted_at IS NULL
           AND canonical_status = ?
           AND canonical_status <> 'spam'`,
       )
       .bind(
         now,
         actor.profileId,
        intentId,
        actor.profileId,
        now,
        submissionId,
        actor.organizationId,
        expectedVersion,
        current.publicReference,
        current.status,
      ),
    database
      .prepare(
        `UPDATE form_submissions
         SET payload_json = ?, updated_at = ?
         WHERE id = ?
           AND organization_id = ?
           AND deleted_at IS NULL
           AND assigned_to_profile_id IS ?
           AND payload_json = ?
           AND EXISTS (
             SELECT 1
             FROM form_submission_workflows AS workflow
             WHERE workflow.submission_id = form_submissions.id
               AND workflow.organization_id =
                   form_submissions.organization_id
               AND workflow.write_intent_id = ?
               AND workflow.version = ?
               AND workflow.public_reference = ?
               AND workflow.redacted_at = ?
               AND workflow.redacted_by_profile_id = ?
           )`,
      )
      .bind(
        marker,
        now,
        submissionId,
        actor.organizationId,
        current.assignedToProfileId,
        current.payloadJson,
        intentId,
        expectedVersion + 1,
        current.publicReference,
        now,
        actor.profileId,
      ),
    database
      .prepare(
        `UPDATE form_submission_notes
         SET body_text = '[redacted]',
             redacted_at = ?,
             redacted_by_profile_id = ?
         WHERE organization_id = ?
           AND submission_id = ?
           AND redacted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM form_submission_workflows AS workflow
             WHERE workflow.submission_id =
                   form_submission_notes.submission_id
               AND workflow.organization_id =
                   form_submission_notes.organization_id
               AND workflow.write_intent_id = ?
               AND workflow.version = ?
               AND workflow.public_reference = ?
               AND workflow.redacted_at = ?
               AND workflow.redacted_by_profile_id = ?
           )`,
      )
      .bind(
        now,
        actor.profileId,
        actor.organizationId,
        submissionId,
        intentId,
        expectedVersion + 1,
        current.publicReference,
         now,
         actor.profileId,
       ),
    submissionIntentHistoryRedactionStatement(database, {
      actor,
      intentId,
      marker,
      now,
      publicReference: current.publicReference,
      submissionId,
      workflowVersion: expectedVersion + 1,
    }),
    submissionAuditCompletionStatement(database, {
      action: "form_submission.personal_content_redacted",
      actor,
      auditId,
      expectedAssignment: current.assignedToProfileId,
      expectedRedactedAt: now,
      expectedStatus: current.status,
      expectedVersion: expectedVersion + 1,
      intentId,
      metadata: {
        publicReference: confirmationReference,
        version: expectedVersion + 1,
      },
      now,
      requireNotificationId: null,
      submissionId,
    }),
    submissionIntentCompletionStatement(database, {
      action: "redact",
      actor,
      auditId,
      intentId,
      now,
      submissionId,
    }),
  ];
  await runSubmissionMutation(database, statements);
  return getFormSubmission(database, identity, submissionId, now);
}

const SUBMISSION_DETAIL_SELECT_SQL = `
SELECT submission.id,
       submission.form_key,
       submission.payload_json,
       submission.assigned_to_profile_id,
       workflow.public_reference,
       workflow.canonical_status,
       workflow.retention_review_at,
       workflow.version,
       workflow.created_at,
       workflow.redacted_at,
       assignee.display_name AS assignee_display_name
FROM form_submissions AS submission
JOIN form_submission_workflows AS workflow
  ON workflow.submission_id = submission.id
 AND workflow.organization_id = submission.organization_id
JOIN form_submission_write_intents AS current_intent
  ON current_intent.id = workflow.write_intent_id
 AND current_intent.organization_id = workflow.organization_id
 AND current_intent.submission_id = workflow.submission_id
 AND current_intent.completed_at IS NOT NULL
 AND current_intent.completion_audit_log_id IS NOT NULL
LEFT JOIN profiles AS assignee
  ON assignee.id = submission.assigned_to_profile_id`;

async function requireMutationState(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  submissionId: string,
  expectedVersion: number,
): Promise<
  Readonly<{
    assignedToProfileId: string | null;
    payloadJson: string;
    publicReference: string;
    status: SubmissionStatus;
  }>
> {
  const row = await database
    .prepare(
      `SELECT workflow.canonical_status,
              workflow.public_reference,
              submission.assigned_to_profile_id,
              submission.payload_json
       FROM form_submissions AS submission
       JOIN form_submission_workflows AS workflow
         ON workflow.submission_id = submission.id
        AND workflow.organization_id = submission.organization_id
       JOIN form_submission_write_intents AS current_intent
         ON current_intent.id = workflow.write_intent_id
        AND current_intent.organization_id = workflow.organization_id
        AND current_intent.submission_id = workflow.submission_id
        AND current_intent.completed_at IS NOT NULL
        AND current_intent.completion_audit_log_id IS NOT NULL
       WHERE submission.id = ?
         AND submission.organization_id = ?
         AND submission.deleted_at IS NULL
         AND workflow.version = ?
         AND workflow.canonical_status <> 'spam'
         AND (
           ? = 1
           OR submission.assigned_to_profile_id = ?
         )
       LIMIT 1`,
    )
    .bind(
      submissionId,
      actor.organizationId,
      expectedVersion,
      isManager(actor) ? 1 : 0,
      actor.profileId,
    )
    .first<Record<string, unknown>>();
  const status = readStatus(row?.canonical_status);
  const payloadJson = stringValue(row?.payload_json);
  const publicReference = stringValue(row?.public_reference);
  if (!status || payloadJson === null || publicReference === null) {
    throw stale();
  }
  return Object.freeze({
    assignedToProfileId: stringValue(row?.assigned_to_profile_id),
    payloadJson,
    publicReference,
    status,
  });
}

function submissionWriteIntentStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    action: "assign" | "redact" | "status";
    actor: AuthorizedMembership;
    assignedToProfileId: string | null;
    expectedVersion: number;
    intentId: string;
    now: number;
    payloadJson: string;
    status: SubmissionStatus;
    submissionId: string;
  }>,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO form_submission_write_intents (
         id, organization_id, submission_id, action,
         expected_workflow_version, proposed_workflow_version,
         proposed_canonical_status, proposed_assigned_to_profile_id,
         proposed_payload_json, proposed_public_reference,
         proposed_request_idempotency_hash,
         proposed_retention_review_at, actor_profile_id,
         created_at, completed_at, completion_audit_log_id
       )
       VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?,
         NULL, NULL, NULL, ?, ?, NULL, NULL
       )`,
    )
    .bind(
      input.intentId,
      input.actor.organizationId,
      input.submissionId,
      input.action,
      input.expectedVersion,
      input.expectedVersion + 1,
      input.status,
      input.assignedToProfileId,
      input.payloadJson,
      input.actor.profileId,
      input.now,
    );
}

function submissionIntentHistoryRedactionStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    actor: AuthorizedMembership;
    intentId: string;
    marker: string;
    now: number;
    publicReference: string;
    submissionId: string;
    workflowVersion: number;
  }>,
): D1PreparedStatementLike {
  return database
    .prepare(
      `UPDATE form_submission_write_intents
       SET proposed_payload_json = ?
       WHERE organization_id = ?
         AND submission_id = ?
         AND completed_at IS NOT NULL
         AND completion_audit_log_id IS NOT NULL
         AND proposed_payload_json <> ?
         AND EXISTS (
           SELECT 1
           FROM form_submission_workflows AS workflow
           JOIN form_submissions AS submission
             ON submission.id = workflow.submission_id
            AND submission.organization_id = workflow.organization_id
           JOIN form_submission_write_intents AS redaction_intent
             ON redaction_intent.id = workflow.write_intent_id
            AND redaction_intent.organization_id =
                workflow.organization_id
            AND redaction_intent.submission_id = workflow.submission_id
            AND redaction_intent.action = 'redact'
            AND redaction_intent.completed_at IS NULL
            AND redaction_intent.completion_audit_log_id IS NULL
           WHERE workflow.submission_id = ?
             AND workflow.organization_id = ?
             AND workflow.write_intent_id = ?
             AND workflow.version = ?
             AND workflow.public_reference = ?
             AND workflow.redacted_at = ?
             AND workflow.redacted_by_profile_id = ?
             AND workflow.updated_by_profile_id = ?
             AND submission.payload_json = ?
             AND redaction_intent.actor_profile_id = ?
             AND redaction_intent.proposed_payload_json = ?
             AND NOT EXISTS (
               SELECT 1
               FROM form_submission_notes AS note
               WHERE note.organization_id = workflow.organization_id
                 AND note.submission_id = workflow.submission_id
                 AND (
                   note.redacted_at IS NULL
                   OR note.redacted_by_profile_id <>
                       redaction_intent.actor_profile_id
                   OR note.body_text <> '[redacted]'
                 )
             )
         )`,
    )
    .bind(
      input.marker,
      input.actor.organizationId,
      input.submissionId,
      input.marker,
      input.submissionId,
      input.actor.organizationId,
      input.intentId,
      input.workflowVersion,
      input.publicReference,
      input.now,
      input.actor.profileId,
      input.actor.profileId,
      input.marker,
      input.actor.profileId,
      input.marker,
    );
}

function submissionIntentCompletionStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    action: "assign" | "redact" | "status";
    actor: AuthorizedMembership;
    auditId: string;
    intentId: string;
    now: number;
    submissionId: string;
  }>,
): D1PreparedStatementLike {
  return database
    .prepare(
      `UPDATE form_submission_write_intents
       SET completed_at = ?,
           completion_audit_log_id = ?
       WHERE id = ?
         AND organization_id = ?
         AND submission_id = ?
         AND action = ?
         AND actor_profile_id = ?
         AND completed_at IS NULL
         AND completion_audit_log_id IS NULL
         AND EXISTS (
           SELECT 1
           FROM audit_logs AS audit
           WHERE audit.id = ?
             AND audit.organization_id =
                 form_submission_write_intents.organization_id
             AND audit.actor_profile_id =
                 form_submission_write_intents.actor_profile_id
             AND audit.entity_type = 'form_submission'
             AND audit.entity_id =
                 form_submission_write_intents.submission_id
         )`,
    )
    .bind(
      input.now,
      input.auditId,
      input.intentId,
      input.actor.organizationId,
      input.submissionId,
      input.action,
      input.actor.profileId,
      input.auditId,
    );
}

function assignmentNotificationStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    assigneeProfileId: string;
    notificationId: string;
    now: number;
    organizationId: string;
    submissionId: string;
  }>,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO notifications (
         id, organization_id, recipient_profile_id, type,
         payload_json, read_at, created_at, deleted_at
       )
       SELECT ?, submission.organization_id, profile.id,
              'form_submission_assigned',
              json_object(
                'formKey', submission.form_key,
                'publicReference', workflow.public_reference,
                'status', workflow.canonical_status,
                'submissionId', submission.id
              ),
              NULL, ?, NULL
       FROM form_submissions AS submission
       JOIN form_submission_workflows AS workflow
         ON workflow.submission_id = submission.id
        AND workflow.organization_id = submission.organization_id
       JOIN profiles AS profile
         ON profile.id = submission.assigned_to_profile_id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
       JOIN organization_memberships AS membership
         ON membership.organization_id = submission.organization_id
        AND membership.profile_id = profile.id
        AND membership.status = 'active'
        AND membership.deleted_at IS NULL
       LEFT JOIN organizer_profile_preferences AS preference
         ON preference.profile_id = profile.id
        AND preference.organization_id = submission.organization_id
       WHERE submission.id = ?
         AND submission.organization_id = ?
         AND submission.assigned_to_profile_id = ?
         AND workflow.version >= 2
         AND COALESCE(
               preference.notification_preference_mode,
               'all_relevant'
             ) IN ('all_relevant', 'important_only')`,
    )
    .bind(
      input.notificationId,
      input.now,
      input.submissionId,
      input.organizationId,
      input.assigneeProfileId,
    );
}

function submissionAuditCompletionStatement(
  database: D1DatabaseLike,
  input: Readonly<{
    action: string;
    actor: AuthorizedMembership;
    auditId: string;
    expectedAssignment: string | null | undefined;
    expectedRedactedAt?: number;
    expectedStatus: SubmissionStatus | null;
    expectedVersion: number;
    intentId: string;
    metadata: Readonly<Record<string, unknown>>;
    now: number;
    requireNotificationId: string | null;
    submissionId: string;
  }>,
): D1PreparedStatementLike {
  const checkAssignment =
    input.expectedAssignment === undefined
      ? "1 = 1"
      : input.expectedAssignment === null
        ? "submission.assigned_to_profile_id IS NULL"
        : "submission.assigned_to_profile_id = ?";
  const checkStatus =
    input.expectedStatus === null
      ? "1 = 1"
      : "workflow.canonical_status = ?";
  const checkRedaction =
    input.expectedRedactedAt === undefined
      ? "1 = 1"
      : `(
           workflow.redacted_at = ?
           AND submission.payload_json = '{"redacted":true}'
           AND NOT EXISTS (
             SELECT 1
             FROM form_submission_write_intents AS historical_intent
             WHERE historical_intent.organization_id =
                   submission.organization_id
               AND historical_intent.submission_id = submission.id
               AND historical_intent.proposed_payload_json <>
                   '{"redacted":true}'
           )
           AND NOT EXISTS (
             SELECT 1
             FROM form_submission_notes AS note
             WHERE note.organization_id = submission.organization_id
               AND note.submission_id = submission.id
               AND (
                 note.redacted_at IS NULL
                 OR note.redacted_by_profile_id <>
                     workflow.redacted_by_profile_id
                 OR note.body_text <> '[redacted]'
               )
           )
         )`;
  const checkNotification = input.requireNotificationId
    ? `(
         NOT EXISTS (
           SELECT 1
           FROM profiles AS recipient_profile
           JOIN organization_memberships AS recipient_membership
             ON recipient_membership.profile_id = recipient_profile.id
            AND recipient_membership.organization_id =
                submission.organization_id
            AND recipient_membership.status = 'active'
            AND recipient_membership.deleted_at IS NULL
           LEFT JOIN organizer_profile_preferences AS recipient_preference
             ON recipient_preference.profile_id = recipient_profile.id
            AND recipient_preference.organization_id =
                recipient_membership.organization_id
           WHERE recipient_profile.id =
                 submission.assigned_to_profile_id
             AND recipient_profile.status = 'active'
             AND recipient_profile.deleted_at IS NULL
             AND COALESCE(
                   recipient_preference.notification_preference_mode,
                   'all_relevant'
                 ) IN ('all_relevant', 'important_only')
         )
         OR EXISTS (
           SELECT 1
           FROM notifications AS notification
           WHERE notification.id = ?
             AND notification.organization_id =
                 submission.organization_id
             AND notification.recipient_profile_id =
                 submission.assigned_to_profile_id
             AND notification.type = 'form_submission_assigned'
         )
       )`
    : "1 = 1";
  const bindings: (null | number | string)[] = [
    input.auditId,
    input.actor.organizationId,
    input.actor.profileId,
    input.action,
    JSON.stringify(input.metadata),
    input.now,
    input.submissionId,
    input.actor.organizationId,
    input.expectedVersion,
    input.intentId,
  ];
  if (typeof input.expectedAssignment === "string") {
    bindings.push(input.expectedAssignment);
  }
  if (input.expectedStatus !== null) {
    bindings.push(input.expectedStatus);
  }
  if (input.expectedRedactedAt !== undefined) {
    bindings.push(input.expectedRedactedAt);
  }
  if (input.requireNotificationId) {
    bindings.push(input.requireNotificationId);
  }
  return database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action,
         entity_type, entity_id, metadata_json, created_at
       )
       SELECT ?, ?, ?, CASE
         WHEN workflow.version = ?
          AND workflow.write_intent_id = ?
          AND ${checkAssignment}
          AND ${checkStatus}
          AND ${checkRedaction}
          AND ${checkNotification}
         THEN ?
         ELSE NULL
       END,
       'form_submission', submission.id, ?, ?
       FROM form_submissions AS submission
       JOIN form_submission_workflows AS workflow
         ON workflow.submission_id = submission.id
        AND workflow.organization_id = submission.organization_id
       WHERE submission.id = ?
         AND submission.organization_id = ?`,
    )
    .bind(
      bindings[0]!,
      bindings[1]!,
      bindings[2]!,
      bindings[8]!,
      bindings[9]!,
      ...bindings.slice(10),
      bindings[3]!,
      bindings[4]!,
      bindings[5]!,
      bindings[6]!,
      bindings[7]!,
    );
}

async function runSubmissionMutation(
  database: D1DatabaseLike,
  statements: readonly D1PreparedStatementLike[],
): Promise<void> {
  try {
    await database.batch([...statements]);
  } catch {
    throw stale();
  }
}

function assertStatusTransition(
  actor: AuthorizedMembership,
  from: SubmissionStatus,
  to: SubmissionStatus,
): void {
  if (from === to) return;
  if (isManager(actor)) return;
  const allowed =
    (from === "new" && to === "in_review") ||
    (from === "in_review" && to === "responded") ||
    (from === "responded" && to === "in_review");
  if (!allowed) {
    throw new SafeApplicationError(
      "authorization_denied",
      403,
      "This submission status change is not permitted.",
    );
  }
}

function readListItem(
  row: Record<string, unknown>,
  nowUtcMs: number,
): SubmissionListItem | null {
  const id = stringValue(row.id);
  const formKey = readFormKey(row.form_key);
  const publicReference = stringValue(row.public_reference);
  const status = readStatus(row.canonical_status);
  const retentionReviewAt = integer(row.retention_review_at);
  const version = integer(row.version);
  const createdAt = integer(row.created_at);
  if (
    !id ||
    !formKey ||
    !publicReference ||
    !status ||
    retentionReviewAt === null ||
    version === null ||
    createdAt === null
  ) {
    return null;
  }
  const assigneeProfileId = stringValue(row.assigned_to_profile_id);
  return Object.freeze({
    assignedTo: assigneeProfileId
      ? Object.freeze({
          displayName: safeDisplayName(row.assignee_display_name),
          profileId: assigneeProfileId,
        })
      : null,
    createdAt,
    formKey,
    id,
    publicReference,
    retentionDue: retentionReviewAt <= nowUtcMs,
    retentionReviewAt,
    status,
    version,
  });
}

function readPrivatePayload(
  value: unknown,
  formKey: PublicFormKey,
): PublicFormPayload | Readonly<{ redacted: true }> {
  if (typeof value !== "string") throw unavailable();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw unavailable();
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    (parsed as Record<string, unknown>).redacted === true
  ) {
    return Object.freeze({ redacted: true });
  }
  try {
    return parsePublicFormPayload(formKey, parsed);
  } catch {
    throw unavailable();
  }
}

function readNote(row: Record<string, unknown>): SubmissionNoteDto[] {
  const id = stringValue(row.id);
  const authorProfileId = stringValue(row.author_profile_id);
  const body = stringValue(row.body_text);
  const createdAt = integer(row.created_at);
  if (!id || !authorProfileId || body === null || createdAt === null) {
    return [];
  }
  return [
    Object.freeze({
      authorDisplayName: safeDisplayName(row.author_display_name),
      authorProfileId,
      body,
      createdAt,
      id,
      redacted: nullableInteger(row.redacted_at) !== null,
    }),
  ];
}

function readHistory(row: Record<string, unknown>): SubmissionHistoryDto[] {
  const id = stringValue(row.id);
  const action = stringValue(row.action);
  const createdAt = integer(row.created_at);
  if (!id || !action || createdAt === null) return [];
  return [
    Object.freeze({
      action,
      actorDisplayName:
        stringValue(row.actor_display_name) ?? null,
      createdAt,
      id,
    }),
  ];
}

function parseReceivedDateRange(
  fromValue: unknown,
  toValue: unknown,
): Readonly<{ fromUtcMs: number; toExclusiveUtcMs: number }> | null {
  const from = parseOptionalBoundedString(fromValue, {
    path: "fromDate",
    maxLength: 10,
  });
  const to = parseOptionalBoundedString(toValue, {
    path: "toDate",
    maxLength: 10,
  });
  if (!from && !to) return null;
  if (!from || !to) throw filterValidationFailure();
  const fromUtcMs = parseUtcCalendarDate(from);
  const toUtcMs = parseUtcCalendarDate(to);
  const toExclusiveUtcMs = toUtcMs + 24 * 60 * 60 * 1_000;
  if (
    toUtcMs < fromUtcMs ||
    toExclusiveUtcMs - fromUtcMs > 366 * 24 * 60 * 60 * 1_000
  ) {
    throw filterValidationFailure();
  }
  return Object.freeze({ fromUtcMs, toExclusiveUtcMs });
}

function parseUtcCalendarDate(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw filterValidationFailure();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = Date.UTC(year, month - 1, day);
  const date = new Date(instant);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw filterValidationFailure();
  }
  return instant;
}

function parseAssignmentFilter(value: unknown): string {
  const parsed = parseBoundedString(value, {
    path: "assignment",
    minLength: 1,
    maxLength: 128,
  });
  return parsed === "all" ||
    parsed === "mine" ||
    parsed === "unassigned"
    ? parsed
    : parseIdentifier(parsed, "assignment");
}

function parseVersion(value: unknown): number {
  return parseFiniteInteger(value, {
    path: "expectedVersion",
    minimum: 1,
  });
}

function parseOptionalInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return value === undefined || value === null || value === ""
    ? fallback
    : parseFiniteInteger(value, {
        path: "page",
        minimum,
        maximum,
      });
}

function legacyStatusFor(status: SubmissionStatus): string {
  if (status === "new") return "new";
  if (status === "in_review") return "in_review";
  return "resolved";
}

function readFormKey(value: unknown): PublicFormKey | null {
  return typeof value === "string" &&
    PUBLIC_FORM_KEYS.some((key) => key === value)
    ? (value as PublicFormKey)
    : null;
}

function readStatus(value: unknown): SubmissionStatus | null {
  return typeof value === "string" &&
    SUBMISSION_STATUSES.some((status) => status === value)
    ? (value as SubmissionStatus)
    : null;
}

function readRole(
  value: unknown,
): "owner" | "administrator" | "organizer" | null {
  return value === "owner" ||
    value === "administrator" ||
    value === "organizer"
    ? value
    : null;
}

function isManager(actor: AuthorizedMembership): boolean {
  return actor.role === "owner" || actor.role === "administrator";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function nullableInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : integer(value);
}

function safeDisplayName(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 120)
    : "Organizer";
}

function stale(): SafeApplicationError {
  return new SafeApplicationError(
    "stale_edit",
    409,
    "This submission changed in another session. Refresh and try again.",
  );
}

function notFound(): SafeApplicationError {
  return new SafeApplicationError(
    "not_found",
    404,
    "The submission could not be found.",
  );
}

function unavailable(): SafeApplicationError {
  return new SafeApplicationError(
    "service_unavailable",
    503,
    "The submission could not be read safely.",
  );
}

function validationFailure(): SafeApplicationError {
  return new SafeApplicationError(
    "validation_failed",
    422,
    "The note could not be validated.",
  );
}

function filterValidationFailure(): SafeApplicationError {
  return new SafeApplicationError(
    "validation_failed",
    422,
    "Choose a valid UTC received-date range of no more than 366 days.",
  );
}
