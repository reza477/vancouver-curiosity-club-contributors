"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { organizerRequest, safeNotice } from "@/app/_organizer/client";
import styles from "@/app/_organizer/workspace.module.css";

export function AcceptInvitationFlow() {
  const [state, setState] = useState<"accepting" | "failed">("accepting");
  const [detail, setDetail] = useState(
    "Checking this one-time invitation against your signed-in ChatGPT account.",
  );

  useEffect(() => {
    const controller = new AbortController();
    async function accept() {
      try {
        await organizerRequest("/accept-invitation/consume", {
          body: "{}",
          method: "POST",
          signal: controller.signal,
        });
        window.location.replace("/organizer");
      } catch (error) {
        if (controller.signal.aborted) return;
        setState("failed");
        setDetail(
          safeNotice(
            error,
            "This invitation is unavailable. It may be malformed, expired, revoked, already used, or intended for a different ChatGPT account.",
          ),
        );
      }
    }
    void accept();
    return () => controller.abort();
  }, []);

  return (
    <main
      className={styles.invitationAcceptance}
      aria-labelledby="invitation-title"
      id="organizer-main"
      tabIndex={-1}
    >
      <p className={styles.kicker}>Private invitation</p>
      <h1 id="invitation-title">
        {state === "accepting" ? "Joining the workspace…" : "Invitation not accepted"}
      </h1>
      <p aria-live="polite">{detail}</p>
      {state === "failed" ? (
        <div className={styles.actionRow}>
          <Link className={styles.primaryAction} href="/">
            Return to the public site
          </Link>
          <Link className={styles.textAction} href="/organizer">
            Open organizer sign-in
          </Link>
        </div>
      ) : (
        <span className={styles.progressMark} aria-hidden="true" />
      )}
    </main>
  );
}
