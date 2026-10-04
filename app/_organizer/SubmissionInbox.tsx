"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SubmissionListItem } from "@/lib/server/phase7/submissions";
import { publicFormLabel } from "@/lib/server/phase7/public-form-contract";
import { MAX_SUBMISSION_MODERATION_BATCH, type SubmissionModerationFolder as SubmissionFolder } from "@/lib/submission-moderation-contract";
import { isRecord, organizerRequest, safeNotice } from "./client";
import { StatusPill } from "./PageHeader";
import styles from "./workspace.module.css";

export function SubmissionInbox({ items, manager, folder }: Readonly<{
  items: readonly SubmissionListItem[];
  manager: boolean;
  folder: SubmissionFolder;
}>) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const selectedItems = items.filter((item) => selected.includes(item.id));

  async function move(destination: SubmissionFolder) {
    if (busy || !selectedItems.length) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await organizerRequest("/api/organizer/submissions/moderation", {
        method: "POST",
        body: JSON.stringify({
          folder: destination,
          items: selectedItems.map((item) => ({
            submissionId: item.id,
            expectedVersion: item.version,
            expectedModerationVersion: item.moderationVersion,
          })),
        }),
      });
      if (!isRecord(result) || result.changed !== selectedItems.length) throw new TypeError("Unexpected moderation receipt");
      setSelected([]);
      setNotice(`${result.changed} ${result.changed === 1 ? "submission" : "submissions"} moved to ${folderLabel(destination)}. Content is preserved. No email is sent.`);
      router.refresh();
    } catch (error) {
      setNotice(safeNotice(error, "The selected submissions could not be moved. Refresh the inbox before retrying."));
    } finally {
      setBusy(false);
    }
  }

  return <>
    {manager ? <section className={styles.submissionModeration} aria-label="Bulk moderation" aria-busy={busy}>
      <p>Select up to {MAX_SUBMISSION_MODERATION_BATCH} submissions. Spam and Trash preserve content and can be restored to Inbox. Moving or restoring does not send email.</p>
      <div className={styles.submissionActions}>
        <button type="button" className={styles.secondaryButton} disabled={busy || !items.length} onClick={() => setSelected(items.slice(0, MAX_SUBMISSION_MODERATION_BATCH).map((item) => item.id))}>
          Select first {Math.min(items.length, MAX_SUBMISSION_MODERATION_BATCH)} on this page
        </button>
        <button type="button" className={styles.secondaryButton} disabled={busy || !selectedItems.length} onClick={() => setSelected([])}>Clear selection</button>
        {folder !== "spam" ? <button type="button" className={styles.secondaryButton} disabled={busy || !selectedItems.length} onClick={() => move("spam")}>Move selected to Spam</button> : null}
        {folder !== "trash" ? <button type="button" className={styles.secondaryButton} disabled={busy || !selectedItems.length} onClick={() => move("trash")}>Move selected to Trash</button> : null}
        {folder !== "inbox" ? <button type="button" className={styles.primaryButton} disabled={busy || !selectedItems.length} onClick={() => move("inbox")}>Restore selected to Inbox</button> : null}
      </div>
      <p aria-live="polite">{busy ? "Moving selected submissions…" : `${selectedItems.length} selected`}</p>
      <p role="status">{notice}</p>
    </section> : null}
    <ol className={`${styles.recordList} ${styles.submissionList}`}>
      {items.map((item) => <li key={item.id} className={manager ? styles.submissionSelectable : undefined}>
        {manager ? <label className={styles.submissionSelection}>
          <input type="checkbox" aria-label={`Select ${item.publicReference}`} checked={selected.includes(item.id)} disabled={busy || (!selected.includes(item.id) && selectedItems.length >= MAX_SUBMISSION_MODERATION_BATCH)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />
        </label> : null}
        <Link href={`/organizer/submissions/${encodeURIComponent(item.id)}`}>
          <strong>{publicFormLabel(item.formKey)} · {item.publicReference}</strong>
          <span>{new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Vancouver" }).format(item.createdAt)} · {item.assignedTo ? `Assigned to ${item.assignedTo.displayName}` : "Unassigned"}</span>
          <small><StatusPill tone={item.status === "responded" ? "green" : item.status === "in_review" ? "blue" : item.status === "archived" ? "neutral" : "amber"}>{item.status === "in_review" ? "In Review" : item.status.slice(0, 1).toUpperCase() + item.status.slice(1)}</StatusPill>{item.retentionDue ? " · Retention review due" : ""}{item.emailHeld ? " · Email held" : ""}</small>
        </Link>
      </li>)}
    </ol>
  </>;
}

export function folderLabel(folder: SubmissionFolder): string {
  return folder.slice(0, 1).toUpperCase() + folder.slice(1);
}
