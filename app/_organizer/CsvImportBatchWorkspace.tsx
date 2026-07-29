"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CsvImportApprovalDecision,
  CsvImportBatchWorkspace,
  CsvImportPreviewRowDto,
} from "@/lib/server/phase7/imports";
import { isRecord, organizerRequest, safeNotice } from "./client";
import { parseCsvImportWorkspace } from "./csv-import-dto";
import styles from "./imports.module.css";

type DecisionState = Readonly<{
  action: CsvImportApprovalDecision["action"];
  conflictReason: string;
  duplicateReason: string;
}>;

export function CsvImportBatchWorkspace({
  initialBatch,
  role,
}: Readonly<{
  initialBatch: CsvImportBatchWorkspace;
  role: "administrator" | "owner";
}>) {
  const [workspace, setWorkspace] = useState(initialBatch);
  const [decisions, setDecisions] = useState<
    Readonly<Record<string, DecisionState>>
  >(() => defaultDecisions(initialBatch.rows));
  const [busy, setBusy] = useState<
    "approve" | "apply" | "redact" | "rows" | null
  >(null);
  const [notice, setNotice] = useState("");
  const [focusReceipt, setFocusReceipt] = useState(0);
  const [redactionConfirmation, setRedactionConfirmation] = useState("");
  const statusHeadingRef = useRef<HTMLHeadingElement>(null);
  const batch = workspace.batch;
  const redactionEligibleAt = batch.redactionEligibleAt;
  const redactionEligible = batch.redactionEligible;
  const isTerminal = [
    "completed",
    "completed_with_errors",
    "failed",
  ].includes(batch.phase);

  const selectedCount = useMemo(
    () =>
      Object.values(decisions).filter(
        (decision) => decision.action !== "skip",
      ).length,
    [decisions],
  );

  useEffect(() => {
    if (focusReceipt === 0) return;
    statusHeadingRef.current?.focus();
  }, [focusReceipt]);

  async function approve() {
    if (
      busy ||
      !workspace.previewFingerprint ||
      workspace.rowPage.hasMore ||
      workspace.rows.length !== workspace.rowPage.total
    ) {
      return;
    }
    const invalid = firstDecisionError(workspace.rows, decisions);
    if (invalid) {
      setNotice(invalid.message);
      focusDecisionError(invalid.rowId, invalid.field);
      return;
    }
    setBusy("approve");
    setNotice("");
    try {
      const body = await organizerRequest(
        `/api/organizer/imports/${encodeURIComponent(batch.batchId)}/approve`,
        {
          body: JSON.stringify({
            decisions: workspace.rows.map((row) => {
              const decision = decisions[row.rowId];
              return {
                action: decision.action,
                conflictReason: decision.conflictReason || null,
                duplicateReason: decision.duplicateReason || null,
                rowId: row.rowId,
              };
            }),
            expectedVersion: batch.version,
            previewFingerprint: workspace.previewFingerprint,
          }),
          method: "POST",
        },
      );
      if (!isRecord(body)) throw new TypeError("Unexpected import response");
      const next = parseCsvImportWorkspace(body.batch);
      commitWorkspace(next);
      setNotice(
        next.batch.phase === "completed"
          ? "Approval stored. Every row was skipped, so the batch is complete."
          : "Approval stored. The batch is ready for bounded application.",
      );
    } catch (error) {
      setNotice(
        safeNotice(
          error,
          "The approval could not be stored. Refresh before retrying.",
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  async function applyNext() {
    if (busy) return;
    setBusy("apply");
    setNotice("");
    try {
      const body = await organizerRequest(
        `/api/organizer/imports/${encodeURIComponent(batch.batchId)}/apply-next`,
        {
          body: JSON.stringify({ expectedVersion: batch.version }),
          method: "POST",
        },
      );
      if (!isRecord(body) || !isRecord(body.result)) {
        throw new TypeError("Unexpected import response");
      }
      const next = parseCsvImportWorkspace(body.result.batch);
      const row = parseApplyRow(body.result.row);
      commitWorkspace(next);
      setNotice(
        row.rowId
          ? `Row result stored: ${humanize(row.resultCode)}.`
          : "The batch was already complete.",
      );
    } catch (error) {
      setNotice(
        safeNotice(
          error,
          "The next row could not be applied. Completed rows remain durable.",
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  async function loadMoreRows() {
    if (busy || !workspace.rowPage.nextCursor) return;
    setBusy("rows");
    setNotice("");
    try {
      const query = new URLSearchParams({
        cursor: workspace.rowPage.nextCursor,
        limit: "100",
      });
      const body = await organizerRequest(
        `/api/organizer/imports/${encodeURIComponent(batch.batchId)}?${query}`,
      );
      if (!isRecord(body)) throw new TypeError("Unexpected import response");
      const next = parseCsvImportWorkspace(body.batch);
      if (
        next.batch.batchId !== batch.batchId ||
        next.batch.version !== batch.version ||
        next.previewFingerprint !== workspace.previewFingerprint
      ) {
        commitWorkspace(next);
        setDecisions(defaultDecisions(next.rows));
        setNotice(
          "The persisted batch changed. The current first page was reloaded.",
        );
        return;
      }
      const known = new Set(workspace.rows.map((row) => row.rowId));
      const appended = next.rows.filter((row) => !known.has(row.rowId));
      const mergedRows = Object.freeze([...workspace.rows, ...appended]);
      setWorkspace(Object.freeze({
        ...next,
        rows: mergedRows,
      }));
      setDecisions((current) =>
        Object.freeze({
          ...current,
          ...defaultDecisions(appended),
        }),
      );
      setNotice(
        `Loaded ${mergedRows.length} of ${next.rowPage.total} persisted rows.`,
      );
    } catch (error) {
      setNotice(
        safeNotice(error, "The next persisted row page could not be loaded."),
      );
    } finally {
      setBusy(null);
    }
  }

  async function redact() {
    if (
      busy ||
      role !== "owner" ||
      !redactionEligible ||
      redactionConfirmation !== batch.batchId
    ) {
      return;
    }
    setBusy("redact");
    setNotice("");
    try {
      const body = await organizerRequest(
        `/api/organizer/imports/${encodeURIComponent(batch.batchId)}/redact`,
        {
          body: JSON.stringify({ expectedVersion: batch.version }),
          method: "POST",
        },
      );
      if (!isRecord(body)) throw new TypeError("Unexpected import response");
      commitWorkspace(parseCsvImportWorkspace(body.batch));
      setRedactionConfirmation("");
      setNotice(
        "Retained mapped source payload was redacted. Provenance and result receipts remain.",
      );
    } catch (error) {
      setNotice(
        safeNotice(error, "The retained source payload could not be redacted."),
      );
    } finally {
      setBusy(null);
    }
  }

  function updateDecision(rowId: string, patch: Partial<DecisionState>) {
    setDecisions((current) =>
      Object.freeze({
        ...current,
        [rowId]: Object.freeze({
          ...current[rowId],
          ...patch,
        }),
      }),
    );
  }

  function commitWorkspace(next: CsvImportBatchWorkspace) {
    setWorkspace(next);
    setFocusReceipt((current) => current + 1);
  }

  return (
    <div className={styles.stack}>
      <section className={styles.card} aria-labelledby="import-summary">
        <div>
          <h2
            id="import-summary"
            ref={statusHeadingRef}
            tabIndex={-1}
          >
            Persisted batch state
          </h2>
          <p>
            Preview is non-authoritative. Application revalidates current
            membership, mappings, duplicates, lifecycle, and the Phase 4
            scheduling conflict policy immediately before each row.
          </p>
        </div>
        <dl className={styles.summaryGrid}>
          <Fact label="Batch reference" value={batch.batchId} />
          <Fact label="Phase" value={humanize(batch.phase)} />
          <Fact
            label="Conflict policy"
            value={humanize(workspace.conflictPolicyMode)}
          />
          <Fact label="Outcome" value={humanize(batch.outcomeCode ?? "pending")} />
          <Fact label="Version" value={String(batch.version)} />
          <Fact label="Actor" value={batch.actorDisplayName} />
          <Fact
            label="Template / parser"
            value={`v${batch.templateVersion} / v${batch.parserVersion}`}
          />
          <Fact label="Source label" value={batch.sourceLabel ?? "Not provided"} />
          <Fact label="Source namespace" value={batch.sourceNamespace} />
          <Fact label="File SHA-256" value={batch.fileSha256} />
          <Fact
            label="Mapping fingerprint"
            value={batch.mappingFingerprint}
          />
          <Fact label="Created" value={formatDateTime(batch.createdAt)} />
          <Fact label="Approved" value={formatOptionalDateTime(batch.approvedAt)} />
          <Fact label="Started" value={formatOptionalDateTime(batch.startedAt)} />
          <Fact
            label="Completed"
            value={formatOptionalDateTime(batch.completedAt)}
          />
          <Fact label="Total rows" value={String(batch.totalRowCount)} />
          <Fact label="Valid rows" value={String(batch.validRowCount)} />
          <Fact label="Invalid rows" value={String(batch.invalidRowCount)} />
          <Fact label="Warnings" value={String(batch.warningRowCount)} />
          <Fact label="Selected" value={String(batch.selectedRowCount)} />
          <Fact label="Imported" value={String(batch.importedRowCount)} />
          <Fact label="Skipped" value={String(batch.skippedRowCount)} />
          <Fact label="Failed" value={String(batch.failedRowCount)} />
          <Fact label="Pending" value={String(batch.pendingRowCount)} />
          <Fact
            label="Source payload"
            value={
              batch.sourcePayloadRedactedAt === null
                ? "Retained under the import policy"
                : `Redacted ${formatDateTime(batch.sourcePayloadRedactedAt)}`
            }
          />
        </dl>
        {workspace.previewFingerprint ? (
          <p>
            Preview fingerprint:{" "}
            <code>{workspace.previewFingerprint.slice(0, 16)}...</code>
          </p>
        ) : null}
        <div>
          <h3>Uploaded-header mapping</h3>
          <dl className={styles.mappingList}>
            {workspace.mappingDecisions.map((decision) => (
              <div key={decision.sourceHeader}>
                <dt>{decision.sourceHeader}</dt>
                <dd>{decision.canonicalField ?? "Ignore"}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="import-rows">
        <div>
          <h2 id="import-rows">Row preview and durable outcomes</h2>
          <p>
            No event exists before explicit approval. Hard duplicates and
            invalid rows cannot be selected. Imports always remain private.
          </p>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">CSV row</th>
                <th scope="col">Preview</th>
                <th scope="col">Normalized event</th>
                <th scope="col">Decision or outcome</th>
              </tr>
            </thead>
            <tbody>
              {workspace.rows.map((row) => (
                <tr key={row.rowId}>
                  <th scope="row">{row.sourceRowNumber}</th>
                  <td><RowCodes row={row} /></td>
                  <td><NormalizedRow row={row} /></td>
                  <td>
                    {batch.phase === "previewed" ? (
                      <DecisionControls
                        decision={decisions[row.rowId]}
                        idPrefix={`desktop-${row.rowId}`}
                        onChange={(patch) => updateDecision(row.rowId, patch)}
                        row={row}
                      />
                    ) : (
                      <Outcome row={row} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.rowDetails}>
          {workspace.rows.map((row) => (
            <details key={row.rowId}>
              <summary>
                Row {row.sourceRowNumber} · {humanize(row.previewResultCode)}
              </summary>
              <RowCodes row={row} />
              <NormalizedRow row={row} />
              {batch.phase === "previewed" ? (
                <DecisionControls
                  decision={decisions[row.rowId]}
                  idPrefix={`mobile-${row.rowId}`}
                  onChange={(patch) => updateDecision(row.rowId, patch)}
                  row={row}
                />
              ) : (
                <Outcome row={row} />
              )}
            </details>
          ))}
        </div>
        <div className={styles.actions}>
          <span>
            Showing {workspace.rows.length} of {workspace.rowPage.total} rows.
          </span>
          {workspace.rowPage.hasMore ? (
            <button
              disabled={busy !== null}
              onClick={loadMoreRows}
              type="button"
            >
              {busy === "rows" ? "Loading persisted rows..." : "Load more rows"}
            </button>
          ) : null}
        </div>
      </section>

      {batch.phase === "previewed" ? (
        <section className={styles.card} aria-labelledby="approve-import">
          <div>
            <h2 id="approve-import">Approve explicit row decisions</h2>
            <p>
              {selectedCount} row{selectedCount === 1 ? "" : "s"} selected.
              Approval binds this exact preview fingerprint and batch version.
              It does not publish any event.
            </p>
            {workspace.rowPage.hasMore ? (
              <p>
                Load all {workspace.rowPage.total} persisted rows before
                approval so every row receives an explicit decision.
              </p>
            ) : null}
          </div>
          <div className={styles.actions}>
            <button
              disabled={
                busy !== null ||
                workspace.rowPage.hasMore ||
                workspace.rows.length !== workspace.rowPage.total
              }
              onClick={approve}
              type="button"
            >
              {busy === "approve" ? "Storing approval..." : "Approve decisions"}
            </button>
          </div>
        </section>
      ) : null}

      {["approved", "applying", "interrupted"].includes(batch.phase) ? (
        <section className={styles.card} aria-labelledby="resume-import">
          <div>
            <h2 id="resume-import">Apply or resume</h2>
            <p>
              Each request applies at most one persisted row through the
              authoritative scheduling service. You can close this page and
              resume safely from history.
            </p>
          </div>
          <div className={styles.actions}>
            <button
              disabled={busy !== null || batch.pendingRowCount === 0}
              onClick={applyNext}
              type="button"
            >
              {busy === "apply" ? "Applying one row..." : "Apply next row"}
            </button>
          </div>
        </section>
      ) : null}

      {role === "owner" && isTerminal && batch.phase !== "redacted" ? (
        <section className={styles.sensitive} aria-labelledby="redact-import">
          <div>
            <h2 id="redact-import">Redact retained source payload</h2>
            <p>
              Owner-only after 90 days. This removes retained mapped source
              cells while preserving hashes, row fingerprints, result codes,
              target event IDs, counts, and minimum-safe audit facts.
            </p>
            <p>
              Eligibility date: {formatDate(redactionEligibleAt)}. Type the
              exact batch reference to confirm this irreversible action.
            </p>
          </div>
          <label className={styles.field}>
            <span>Batch reference: {batch.batchId}</span>
            <input
              autoComplete="off"
              onChange={(event) =>
                setRedactionConfirmation(event.currentTarget.value)
              }
              value={redactionConfirmation}
            />
          </label>
          <div className={styles.actions}>
            <button
              disabled={
                busy !== null ||
                !redactionEligible ||
                redactionConfirmation !== batch.batchId
              }
              onClick={redact}
              type="button"
            >
              {busy === "redact"
                ? "Redacting..."
                : redactionEligible
                  ? "Permanently redact retained source payload"
                  : "Available after the eligibility date"}
            </button>
          </div>
        </section>
      ) : null}

      <div className={styles.actions}>
        <Link href="/organizer/imports">Return to import history</Link>
        <Link className={styles.secondary} href="/organizer/imports/new">
          Start another CSV preview
        </Link>
      </div>
      <p aria-live="polite" className={styles.notice}>
        {notice}
      </p>
    </div>
  );
}

function DecisionControls({
  decision,
  idPrefix,
  onChange,
  row,
}: Readonly<{
  decision: DecisionState;
  idPrefix: string;
  onChange: (patch: Partial<DecisionState>) => void;
  row: CsvImportPreviewRowDto;
}>) {
  const semanticWarning = row.warningCodes.includes(
    "semantic_duplicate_warning",
  );
  const conflictWarning =
    row.warningCodes.includes("existing_schedule_conflict") ||
    row.warningCodes.includes("intra_file_schedule_conflict") ||
    row.conflictDetails.length > 0;
  const locked = !row.canSelect;
  const duplicateReasonRequired =
    semanticWarning &&
    decision.action === "create_separate" &&
    !decision.duplicateReason.trim();
  const conflictReasonRequired =
    conflictWarning &&
    decision.action !== "skip" &&
    !decision.conflictReason.trim();
  const duplicateErrorId = `${idPrefix}-duplicate-reason-error`;
  const conflictErrorId = `${idPrefix}-conflict-reason-error`;
  return (
    <div className={styles.field}>
      <label htmlFor={`${idPrefix}-decision`}>
        <span>Approval action</span>
      </label>
      <select
        disabled={locked}
        id={`${idPrefix}-decision`}
        onChange={(event) =>
          onChange({
            action: event.currentTarget.value as DecisionState["action"],
          })
        }
        value={decision.action}
      >
        <option value="skip">Skip</option>
        {!semanticWarning && !locked ? (
          <option value="selected">Select private event</option>
        ) : null}
        {semanticWarning && !locked ? (
          <option value="create_separate">Create Separate Event</option>
        ) : null}
      </select>
      {semanticWarning && decision.action === "create_separate" ? (
        <label htmlFor={`${idPrefix}-duplicate-reason`}>
          <span>Required duplicate reason</span>
          <textarea
            aria-describedby={
              duplicateReasonRequired ? duplicateErrorId : undefined
            }
            aria-invalid={duplicateReasonRequired}
            id={`${idPrefix}-duplicate-reason`}
            maxLength={1_000}
            onChange={(event) =>
              onChange({ duplicateReason: event.currentTarget.value })
            }
            rows={3}
            value={decision.duplicateReason}
          />
          {duplicateReasonRequired ? (
            <span id={duplicateErrorId}>
              Enter a written reason to create a separate event.
            </span>
          ) : null}
        </label>
      ) : null}
      {conflictWarning && decision.action !== "skip" ? (
        <label htmlFor={`${idPrefix}-conflict-reason`}>
          <span>Required conflict reason</span>
          <textarea
            aria-describedby={
              conflictReasonRequired ? conflictErrorId : undefined
            }
            aria-invalid={conflictReasonRequired}
            id={`${idPrefix}-conflict-reason`}
            maxLength={1_000}
            onChange={(event) =>
              onChange({ conflictReason: event.currentTarget.value })
            }
            rows={3}
            value={decision.conflictReason}
          />
          {conflictReasonRequired ? (
            <span id={conflictErrorId}>
              Enter a written reason for the scheduling conflict.
            </span>
          ) : null}
        </label>
      ) : null}
    </div>
  );
}

function RowCodes({ row }: Readonly<{ row: CsvImportPreviewRowDto }>) {
  const codes = [
    ...row.errorCodes.map((code) => `Error: ${humanize(code)}`),
    ...row.warningCodes.map((code) => `Warning: ${humanize(code)}`),
    ...row.defaultsApplied.map((code) => `Default: ${humanize(code)}`),
  ];
  return (
    <div>
      <strong>{humanize(row.previewResultCode)}</strong>
      {codes.length ? (
        <ul className={styles.codeList}>
          {codes.map((code) => <li key={code}>{code}</li>)}
        </ul>
      ) : (
        <p>No preview errors or warnings.</p>
      )}
      <p>
        <strong>Mapped fields:</strong>{" "}
        {row.mappingFields.length
          ? row.mappingFields.map(humanize).join(", ")
          : "None"}
      </p>
      <MatchSummary row={row} />
      {row.duplicateDetails.length ? (
        <div>
          <strong>
            Duplicate match details ({row.duplicateDetailsTotal})
          </strong>
          <ul className={styles.conflictList}>
            {row.duplicateDetails.map((duplicate) => (
              <li
                key={[
                  duplicate.code,
                  duplicate.referenceId,
                  duplicate.sourceRowNumber,
                ].join(":")}
              >
                <strong>{humanize(duplicate.code)}</strong>
                <span>{duplicate.title ?? "Existing imported event"}</span>
                <small>
                  {humanize(duplicate.source)}
                  {duplicate.sourceRowNumber === null
                    ? ` · reference ${duplicate.referenceId}`
                    : ` · CSV row ${duplicate.sourceRowNumber}`}
                </small>
              </li>
            ))}
          </ul>
          {row.duplicateDetailsHasMore ? (
            <p>
              Showing {row.duplicateDetails.length} of{" "}
              {row.duplicateDetailsTotal} matches. More matching rows are
              retained in the batch result but are not repeated here.
            </p>
          ) : null}
        </div>
      ) : null}
      {row.conflictDetails.length ? (
        <div>
          <strong>
            Schedule conflict preview ({row.conflictDetailsTotal})
          </strong>
          <ul className={styles.conflictList}>
            {row.conflictDetails.map((conflict) => (
              <li
                key={[
                  conflict.source,
                  conflict.referenceId,
                  conflict.startsAtUtc,
                ].join(":")}
              >
                <strong>{conflict.title}</strong>
                <span>
                  {formatDateTime(conflict.startsAtUtc)}–{formatDateTime(
                    conflict.endsAtUtc,
                  )}
                </span>
                <small>
                  {humanize(conflict.source)} ·{" "}
                  {humanize(conflict.planningStatus)}
                  {conflict.sourceRowNumber === null
                    ? ""
                    : ` · CSV row ${conflict.sourceRowNumber}`}
                </small>
              </li>
            ))}
          </ul>
          {row.conflictDetailsHasMore ? (
            <p>
              Showing {row.conflictDetails.length} of{" "}
              {row.conflictDetailsTotal} conflicts. More matching schedules
              are retained in the batch result but are not repeated here.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MatchSummary({
  row,
}: Readonly<{ row: CsvImportPreviewRowDto }>) {
  const matches = [
    ["Club", row.matchSummary.club],
    ["Program", row.matchSummary.program],
    ["Lane", row.matchSummary.lane],
    ["Category", row.matchSummary.category],
    ["Venue", row.matchSummary.venue],
    ["Primary organizer", row.matchSummary.primaryOrganizer],
    [
      "Co-organizers",
      row.matchSummary.coOrganizers.length
        ? row.matchSummary.coOrganizers.join(", ")
        : null,
    ],
  ] as const;
  return (
    <dl className={styles.matchSummary}>
      {matches.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "No match requested"}</dd>
        </div>
      ))}
    </dl>
  );
}

function NormalizedRow({ row }: Readonly<{ row: CsvImportPreviewRowDto }>) {
  if (!row.normalized) return <p>No selectable normalized payload.</p>;
  return (
    <dl className={styles.normalized}>
      {Object.entries(row.normalized).map(([key, value]) => (
        <div key={key}>
          <dt>{humanize(key)}</dt>
          <dd>{formatNormalized(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Outcome({ row }: Readonly<{ row: CsvImportPreviewRowDto }>) {
  return (
    <div>
      <strong>{humanize(row.resultCode ?? row.applicationState)}</strong>
      {row.targetEventId ? (
        <p>
          <Link
            href={`/organizer/events/${encodeURIComponent(row.targetEventId)}`}
          >
            Open private event
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function Fact({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function defaultDecisions(
  rows: readonly CsvImportPreviewRowDto[],
): Readonly<Record<string, DecisionState>> {
  return Object.freeze(
    Object.fromEntries(
      rows.map((row) => [
        row.rowId,
        Object.freeze({
          action:
            row.canSelect && row.previewResultCode === "valid"
              ? ("selected" as const)
              : ("skip" as const),
          conflictReason: "",
          duplicateReason: "",
        }),
      ]),
    ),
  );
}

function firstDecisionError(
  rows: readonly CsvImportPreviewRowDto[],
  decisions: Readonly<Record<string, DecisionState>>,
): Readonly<{
  field: "conflict" | "duplicate";
  message: string;
  rowId: string;
}> | null {
  for (const row of rows) {
    const decision = decisions[row.rowId];
    if (
      row.warningCodes.includes("semantic_duplicate_warning") &&
      decision.action === "create_separate" &&
      !decision.duplicateReason.trim()
    ) {
      return {
        field: "duplicate",
        message: `CSV row ${row.sourceRowNumber} needs a duplicate reason.`,
        rowId: row.rowId,
      };
    }
    if (
      (
        row.warningCodes.includes("existing_schedule_conflict") ||
        row.warningCodes.includes("intra_file_schedule_conflict") ||
        row.conflictDetails.length > 0
      ) &&
      decision.action !== "skip" &&
      !decision.conflictReason.trim()
    ) {
      return {
        field: "conflict",
        message: `CSV row ${row.sourceRowNumber} needs a conflict reason.`,
        rowId: row.rowId,
      };
    }
  }
  return null;
}

function focusDecisionError(
  rowId: string,
  field: "conflict" | "duplicate",
): void {
  const desktopNode = document.getElementById(
    `desktop-${rowId}-${field}-reason`,
  );
  if (desktopNode && desktopNode.getClientRects().length > 0) {
    desktopNode.focus();
    return;
  }
  const mobileNode = document.getElementById(
    `mobile-${rowId}-${field}-reason`,
  );
  if (!mobileNode) return;
  const details = mobileNode.closest("details");
  if (details) {
    details.open = true;
  }
  mobileNode.focus();
}

function parseApplyRow(value: unknown): Readonly<{
  eventId: string | null;
  resultCode: string;
  rowId: string | null;
}> {
  if (!isRecord(value)) throw new TypeError("Unexpected import response");
  if (
    (value.eventId !== null && typeof value.eventId !== "string") ||
    typeof value.resultCode !== "string" ||
    (value.rowId !== null && typeof value.rowId !== "string")
  ) {
    throw new TypeError("Unexpected import response");
  }
  return Object.freeze({
    eventId: value.eventId,
    resultCode: value.resultCode,
    rowId: value.rowId,
  });
}

function formatNormalized(value: unknown): string {
  if (value === null) return "Not provided";
  if (Array.isArray(value)) return value.map(formatNormalized).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/^./u, (letter) => letter.toUpperCase());
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "long",
    timeZone: "America/Vancouver",
  }).format(new Date(value));
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Vancouver",
  }).format(new Date(value));
}

function formatOptionalDateTime(value: number | null): string {
  return value === null ? "Not yet" : formatDateTime(value);
}
