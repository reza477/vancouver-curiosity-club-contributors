"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isRecord, organizerRequest, safeNotice } from "./client";
import styles from "./workspace.module.css";

type LifecycleAction =
  | "archive"
  | "cancel"
  | "complete"
  | "confirm"
  | "extend_hold"
  | "place_hold"
  | "release_hold"
  | "restore_cancelled";

export function EventActions({
  contentVersion,
  deleted,
  eventId,
  planningStatus,
  scheduleVersion,
  scheduled,
}: Readonly<{
  contentVersion: number;
  deleted: boolean;
  eventId: string;
  planningStatus: string;
  scheduleVersion: number;
  scheduled: boolean;
}>) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialogAction, setDialogAction] = useState<LifecycleAction | null>(null);
  const [notice, setNotice] = useState("");

  function openAction(
    action: LifecycleAction,
    trigger: HTMLButtonElement,
  ) {
    triggerRef.current = trigger;
    setDialogAction(action);
    setNotice("");
    window.requestAnimationFrame(() => {
      dialogRef.current?.showModal();
      dialogRef.current
        ?.querySelector<HTMLElement>("[data-dialog-initial-focus]")
        ?.focus();
    });
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  async function legacyAction(
    action: "delete" | "duplicate" | "restore",
  ) {
    if (busy) return;
    setBusy(action);
    setNotice("");
    try {
      const body = await organizerRequest(
        `/api/organizer/events/${encodeURIComponent(eventId)}/${action}`,
        {
          body: JSON.stringify({
            expectedContentVersion: contentVersion,
            expectedScheduleVersion: scheduleVersion,
          }),
          method: "POST",
        },
      );
      if (action === "duplicate") {
        if (
          !isRecord(body) ||
          !isRecord(body.event) ||
          typeof body.event.id !== "string"
        ) {
          throw new TypeError("Unexpected duplicate response");
        }
        router.push(
          `/organizer/events/${encodeURIComponent(body.event.id)}`,
        );
        return;
      }
      setNotice(
        action === "delete"
          ? "Private record moved to deleted items."
          : "Private record restored in a safe non-reserving state.",
      );
      router.refresh();
    } catch (error) {
      setNotice(
        safeNotice(error, `The ${action} action could not be completed.`),
      );
    } finally {
      setBusy(null);
    }
  }

  async function lifecycle(
    action: LifecycleAction,
    values: Readonly<{
      holdDurationHours: number | null;
      reason: string | null;
    }>,
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(action);
    setNotice("");
    try {
      const body = await organizerRequest(
        `/api/organizer/events/${encodeURIComponent(eventId)}/actions`,
        {
          body: JSON.stringify({
            action,
            expectedContentVersion: contentVersion,
            expectedScheduleVersion: scheduleVersion,
            holdDurationHours: values.holdDurationHours,
            reason: values.reason,
          }),
          method: "POST",
        },
      );
      const pendingReview =
        isRecord(body) &&
        body.outcome === "pending_approval" &&
        typeof body.reviewRequestId === "string" &&
        body.reviewRequestId.length > 0;
      setNotice(
        pendingReview
          ? "Review requested. The event remains a non-reserving private Draft."
          : `${actionLabel(action)} completed. Current D1 state has been rechecked.`,
      );
      router.refresh();
      return true;
    } catch (error) {
      setNotice(
        safeNotice(
          error,
          "The lifecycle action was refused. Your reason and form values remain available.",
        ),
      );
      return false;
    } finally {
      setBusy(null);
    }
  }

  const actions = lifecycleActions(planningStatus, scheduled, deleted);
  return (
    <>
      <section className={styles.eventActions} aria-label="Private event actions">
        <button
          disabled={busy !== null}
          onClick={() => void legacyAction("duplicate")}
          type="button"
        >
          {busy === "duplicate" ? "Duplicating…" : "Duplicate privately"}
        </button>
        {deleted ? (
          <button
            disabled={busy !== null}
            onClick={() => void legacyAction("restore")}
            type="button"
          >
            {busy === "restore" ? "Restoring…" : "Restore safely"}
          </button>
        ) : (
          <>
            {actions.map((action) => (
              <button
                disabled={busy !== null}
                key={action}
                onClick={(event) => openAction(action, event.currentTarget)}
                type="button"
              >
                {actionLabel(action)}
              </button>
            ))}
            {(
              <button
                disabled={busy !== null}
                onClick={() => void legacyAction("delete")}
                type="button"
              >
                {busy === "delete" ? "Moving…" : "Move to deleted items"}
              </button>
            )}
          </>
        )}
        <p aria-atomic="true" aria-live="polite">
          {notice}
        </p>
      </section>
      <LifecycleDialog
        action={dialogAction}
        busy={busy !== null}
        dialogRef={dialogRef}
        onCancel={closeDialog}
        onClosed={() => {
          setDialogAction(null);
          triggerRef.current?.focus();
        }}
        onConfirm={async (values) => {
          if (!dialogAction) return;
          if (await lifecycle(dialogAction, values)) closeDialog();
        }}
      />
    </>
  );
}

function LifecycleDialog({
  action,
  busy,
  dialogRef,
  onCancel,
  onClosed,
  onConfirm,
}: Readonly<{
  action: LifecycleAction | null;
  busy: boolean;
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  onCancel: () => void;
  onClosed: () => void;
  onConfirm: (values: {
    holdDurationHours: number | null;
    reason: string | null;
  }) => Promise<void>;
}>) {
  const title = action ? actionLabel(action) : "Confirm action";
  const needsDuration = action === "place_hold" || action === "extend_hold";
  return (
    <dialog
      aria-describedby="lifecycle-dialog-description"
      aria-labelledby="lifecycle-dialog-title"
      className={styles.actionDialog}
      onClose={onClosed}
      ref={dialogRef}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void onConfirm({
            holdDurationHours: needsDuration
              ? Number(data.get("holdDurationHours"))
              : null,
            reason:
              String(data.get("reason") ?? "").trim() || null,
          });
        }}
      >
        <p className={styles.kicker}>Authoritative D1 action</p>
        <h2 id="lifecycle-dialog-title">{title}</h2>
        <p id="lifecycle-dialog-description">
          The final write revalidates membership, versions, schedule resources,
          policy, and every current conflict. Nothing here publishes the event.
        </p>
        {needsDuration ? (
          <label>
            <span>Hold duration, hours</span>
            <input
              defaultValue={72}
              max={720}
              min={1}
              name="holdDurationHours"
              required
              type="number"
            />
          </label>
        ) : null}
        {action === "place_hold" ||
        action === "extend_hold" ||
        action === "confirm" ||
        action === "restore_cancelled" ? (
          <label>
            <span>Coordination reason, when policy requires it</span>
            <textarea maxLength={1_000} name="reason" rows={4} />
            <small>
              A reason never bypasses Block mode and is valid only for the exact
              schedule versions rechecked by D1.
            </small>
          </label>
        ) : null}
        <div>
          <button
            data-dialog-initial-focus
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            Keep current state
          </button>
          <button className={styles.primaryButton} disabled={busy} type="submit">
            {busy ? "Checking…" : title}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function lifecycleActions(
  planningStatus: string,
  scheduled: boolean,
  deleted: boolean,
): readonly LifecycleAction[] {
  if (deleted) return [];
  if (planningStatus === "idea" || planningStatus === "draft") {
    return scheduled ? ["place_hold", "confirm", "archive"] : ["archive"];
  }
  if (planningStatus === "tentative_hold") {
    return ["extend_hold", "release_hold", "confirm", "cancel", "archive"];
  }
  if (planningStatus === "confirmed") {
    return ["cancel", "complete", "archive"];
  }
  if (planningStatus === "cancelled") {
    return ["restore_cancelled", "archive"];
  }
  if (planningStatus === "completed") {
    return ["archive"];
  }
  return [];
}

function actionLabel(action: LifecycleAction): string {
  if (action === "place_hold") return "Place hold";
  if (action === "extend_hold") return "Extend hold";
  if (action === "release_hold") return "Release hold";
  if (action === "confirm") return "Confirm";
  if (action === "cancel") return "Cancel";
  if (action === "complete") return "Complete";
  if (action === "restore_cancelled") return "Restore as confirmed";
  return "Archive";
}
