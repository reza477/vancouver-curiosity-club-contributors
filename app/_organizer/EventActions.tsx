"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isRecord, organizerRequest, safeNotice } from "./client";
import styles from "./workspace.module.css";

export function EventActions({
  contentVersion,
  deleted,
  eventId,
}: Readonly<{
  contentVersion: number;
  deleted: boolean;
  eventId: string;
}>) {
  const router = useRouter();
  const [busy, setBusy] = useState<"delete" | "duplicate" | "restore" | null>(null);
  const [notice, setNotice] = useState("");

  async function mutate(action: "delete" | "duplicate" | "restore") {
    if (busy) return;
    setBusy(action);
    setNotice("");
    try {
      const body = await organizerRequest(
        `/api/organizer/events/${encodeURIComponent(eventId)}/${action}`,
        {
          body: JSON.stringify({ expectedContentVersion: contentVersion }),
          method: "POST",
        },
      );
      if (action === "duplicate") {
        if (!isRecord(body) || !isRecord(body.event) || typeof body.event.id !== "string") {
          throw new TypeError("Unexpected duplicate response");
        }
        router.push(`/organizer/events/${encodeURIComponent(body.event.id)}`);
        return;
      }
      setNotice(action === "delete" ? "Private record moved to deleted items." : "Private record restored.");
      router.refresh();
    } catch (error) {
      setNotice(safeNotice(error, `The ${action} action could not be completed.`));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={styles.eventActions} aria-label="Private event actions">
      <button disabled={busy !== null} onClick={() => mutate("duplicate")} type="button">
        {busy === "duplicate" ? "Duplicating…" : "Duplicate privately"}
      </button>
      {deleted ? (
        <button disabled={busy !== null} onClick={() => mutate("restore")} type="button">
          {busy === "restore" ? "Restoring…" : "Restore"}
        </button>
      ) : (
        <button disabled={busy !== null} onClick={() => mutate("delete")} type="button">
          {busy === "delete" ? "Moving…" : "Move to deleted items"}
        </button>
      )}
      <p aria-live="polite">{notice}</p>
    </section>
  );
}
