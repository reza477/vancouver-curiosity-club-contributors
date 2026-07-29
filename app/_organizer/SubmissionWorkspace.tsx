"use client";

import { useState } from "react";
import {
  SUBMISSION_STATUSES,
  type SubmissionAssigneeOption,
  type SubmissionDetailDto,
  type SubmissionStatus,
} from "@/lib/server/phase7/submissions";
import { publicFormLabel } from "@/lib/server/phase7/public-form-contract";
import { isRecord, organizerRequest, safeNotice } from "./client";
import { StatusPill } from "./PageHeader";
import styles from "./workspace.module.css";

export function SubmissionWorkspace({
  assignees,
  initialSubmission,
  role,
}: Readonly<{
  assignees: readonly SubmissionAssigneeOption[];
  initialSubmission: SubmissionDetailDto;
  role: "owner" | "administrator" | "organizer";
}>) {
  const [submission, setSubmission] = useState(initialSubmission);
  const [assignee, setAssignee] = useState(
    initialSubmission.assignedTo?.profileId ?? "",
  );
  const [status, setStatus] = useState<SubmissionStatus>(
    initialSubmission.status,
  );
  const [note, setNote] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const manager = role === "owner" || role === "administrator";

  async function mutate(
    path: string,
    method: "PATCH" | "POST",
    body: Readonly<Record<string, unknown>>,
    busyKey: string,
  ) {
    if (busy) return;
    setBusy(busyKey);
    setNotice("");
    try {
      const response = await organizerRequest(path, {
        body: JSON.stringify(body),
        method,
      });
      if (
        !isRecord(response) ||
        !isSubmissionDetail(response.submission)
      ) {
        throw new TypeError("Unexpected submission response");
      }
      setSubmission(response.submission);
      setAssignee(response.submission.assignedTo?.profileId ?? "");
      setStatus(response.submission.status);
      setNotice("Private submission workflow saved.");
      return true;
    } catch (error) {
      setNotice(safeNotice(error, "The submission could not be changed."));
      return false;
    } finally {
      setBusy("");
    }
  }

  async function assign() {
    await mutate(
      `/api/organizer/submissions/${encodeURIComponent(submission.id)}/assignment`,
      "PATCH",
      {
        assigneeProfileId: assignee || null,
        expectedVersion: submission.version,
      },
      "assignment",
    );
  }

  async function changeStatus() {
    await mutate(
      `/api/organizer/submissions/${encodeURIComponent(submission.id)}/status`,
      "PATCH",
      { expectedVersion: submission.version, status },
      "status",
    );
  }

  async function addNote() {
    const saved = await mutate(
      `/api/organizer/submissions/${encodeURIComponent(submission.id)}/notes`,
      "POST",
      { body: note },
      "note",
    );
    if (saved) setNote("");
  }

  async function redact() {
    const saved = await mutate(
      `/api/organizer/submissions/${encodeURIComponent(submission.id)}/redact`,
      "POST",
      {
        confirmationReference: confirmation,
        expectedVersion: submission.version,
      },
      "redact",
    );
    if (saved) setConfirmation("");
  }

  return (
    <div className={styles.submissionWorkspace}>
      <section className={styles.infoPanel} aria-labelledby="submission-summary">
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.kicker}>
              {publicFormLabel(submission.formKey)}
            </p>
            <h2 id="submission-summary">{submission.publicReference}</h2>
          </div>
          <StatusPill tone={statusTone(submission.status)}>
            {statusLabel(submission.status)}
          </StatusPill>
        </div>
        <dl className={styles.submissionFacts}>
          <div>
            <dt>Received</dt>
            <dd>{formatDateTime(submission.createdAt)}</dd>
          </div>
          <div>
            <dt>Assignment</dt>
            <dd>{submission.assignedTo?.displayName ?? "Unassigned"}</dd>
          </div>
          <div>
            <dt>Retention review</dt>
            <dd>
              {formatDate(submission.retentionReviewAt)}
              {submission.retentionDue ? " · Due now" : ""}
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.formSection} aria-labelledby="submitted-fields">
        <header>
          <p className={styles.kicker}>Private content</p>
          <h2 id="submitted-fields">Submitted fields</h2>
          <p>Plain text only. This content never appears on public pages.</p>
        </header>
        <div className={styles.submissionFields}>
          {"redacted" in submission.fields ? (
            <p>Personal content was permanently redacted by the Owner.</p>
          ) : (
            Object.entries(submission.fields).map(([key, value]) => (
              <div key={key}>
                <strong>{fieldLabel(key)}</strong>
                {Array.isArray(value) ? (
                  <ul>
                    {value.map((item) => (
                      <li key={String(item)}>{String(item)}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{value === null ? "Not provided" : String(value)}</p>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className={styles.formSection} aria-labelledby="submission-workflow">
        <header>
          <p className={styles.kicker}>Manual workflow</p>
          <h2 id="submission-workflow">Assignment and status</h2>
          <p>
            Responded records that someone replied outside this application.
            It does not send a message.
          </p>
        </header>
        <div className={styles.formFields}>
          {manager ? (
            <label className={styles.fieldFull}>
              <span>Assigned member</span>
              <select
                onChange={(event) => setAssignee(event.currentTarget.value)}
                value={assignee}
              >
                <option value="">Unassigned</option>
                {assignees.map((option) => (
                  <option key={option.profileId} value={option.profileId}>
                    {option.displayName} · {option.role}
                  </option>
                ))}
              </select>
              <button
                className={styles.secondaryButton}
                disabled={busy === "assignment"}
                onClick={assign}
                type="button"
              >
                {busy === "assignment" ? "Saving…" : "Save assignment"}
              </button>
            </label>
          ) : null}
          <label className={styles.fieldFull}>
            <span>Status</span>
            <select
              onChange={(event) =>
                setStatus(event.currentTarget.value as SubmissionStatus)
              }
              value={status}
            >
              {allowedStatuses(role, submission.status).map((option) => (
                <option key={option} value={option}>
                  {statusLabel(option)}
                </option>
              ))}
            </select>
            <button
              className={styles.primaryButton}
              disabled={busy === "status"}
              onClick={changeStatus}
              type="button"
            >
              {busy === "status" ? "Saving…" : "Save status"}
            </button>
          </label>
        </div>
      </section>

      <section className={styles.formSection} aria-labelledby="private-notes">
        <header>
          <p className={styles.kicker}>Append-only</p>
          <h2 id="private-notes">Private notes</h2>
          <p>Note bodies are excluded from audit and notification metadata.</p>
        </header>
        <div>
          {submission.notes.length ? (
            <ol className={styles.submissionNotes}>
              {submission.notes.map((item) => (
                <li key={item.id}>
                  <p>{item.body}</p>
                  <small>
                    {item.authorDisplayName} · {formatDateTime(item.createdAt)}
                    {item.redacted ? " · redacted" : ""}
                  </small>
                </li>
              ))}
            </ol>
          ) : (
            <p>No private notes yet.</p>
          )}
          {"redacted" in submission.fields ? null : (
            <label className={styles.formFields}>
              <span>Append a private note</span>
              <textarea
                maxLength={4_000}
                onChange={(event) => setNote(event.currentTarget.value)}
                rows={5}
                value={note}
              />
              <button
                className={styles.primaryButton}
                disabled={!note.trim() || busy === "note"}
                onClick={addNote}
                type="button"
              >
                {busy === "note" ? "Appending…" : "Append note"}
              </button>
            </label>
          )}
        </div>
      </section>

      <section className={styles.infoPanel} aria-labelledby="workflow-history">
        <p className={styles.kicker}>Minimum-safe receipt history</p>
        <h2 id="workflow-history">Workflow history</h2>
        <ol className={styles.submissionHistory}>
          {submission.history.map((item) => (
            <li key={item.id}>
              <strong>{historyLabel(item.action)}</strong>
              <span>
                {item.actorDisplayName ?? "Public form"} ·{" "}
                {formatDateTime(item.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {role === "owner" && !("redacted" in submission.fields) ? (
        <section
          className={styles.dangerPanel}
          aria-labelledby="submission-redaction"
        >
          <div>
            <p className={styles.kicker}>Irreversible privacy action</p>
            <h2 id="submission-redaction">Redact personal content</h2>
            <p>
              This replaces submitted fields and every private note body with
              a minimal marker. Receipt facts and workflow status remain.
            </p>
          </div>
          <label>
            <span>Type {submission.publicReference} to confirm</span>
            <input
              onChange={(event) => setConfirmation(event.currentTarget.value)}
              value={confirmation}
            />
          </label>
          <button
            disabled={
              confirmation !== submission.publicReference || busy === "redact"
            }
            onClick={redact}
            type="button"
          >
            {busy === "redact" ? "Redacting…" : "Permanently redact content"}
          </button>
        </section>
      ) : null}

      <p className={styles.workspaceNotice} aria-live="polite">
        {notice}
      </p>
    </div>
  );
}

function allowedStatuses(
  role: "owner" | "administrator" | "organizer",
  current: SubmissionStatus,
): readonly SubmissionStatus[] {
  if (role !== "organizer") return SUBMISSION_STATUSES;
  if (current === "new") return ["new", "in_review"];
  if (current === "in_review") return ["in_review", "responded"];
  if (current === "responded") return ["responded", "in_review"];
  return ["archived"];
}

function statusLabel(value: SubmissionStatus): string {
  return value === "in_review"
    ? "In Review"
    : value.slice(0, 1).toUpperCase() + value.slice(1);
}

function statusTone(
  value: SubmissionStatus,
): "amber" | "blue" | "green" | "neutral" {
  if (value === "new") return "amber";
  if (value === "in_review") return "blue";
  if (value === "responded") return "green";
  return "neutral";
}

function fieldLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/^./u, (letter) => letter.toUpperCase());
}

function historyLabel(value: string): string {
  if (value === "form_submission.created") return "Submission stored";
  if (value === "form_submission.assigned") return "Assignment changed";
  if (value === "form_submission.status_changed") return "Status changed";
  if (value === "form_submission.note_added") return "Private note appended";
  if (value === "form_submission.personal_content_redacted") {
    return "Personal content redacted";
  }
  return "Workflow updated";
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Vancouver",
  }).format(new Date(value));
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "long",
    timeZone: "America/Vancouver",
  }).format(new Date(value));
}

function isSubmissionDetail(value: unknown): value is SubmissionDetailDto {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.publicReference === "string" &&
    typeof value.version === "number" &&
    typeof value.status === "string" &&
    SUBMISSION_STATUSES.some((status) => status === value.status) &&
    Array.isArray(value.notes) &&
    Array.isArray(value.history) &&
    isRecord(value.fields) &&
    (
      value.assignedTo === null ||
      (
        isRecord(value.assignedTo) &&
        typeof value.assignedTo.profileId === "string" &&
        typeof value.assignedTo.displayName === "string"
      )
    )
  );
}
