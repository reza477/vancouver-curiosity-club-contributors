"use client";

import { useEffect, useState } from "react";
import { isRecord, organizerRequest, safeNotice } from "./client";
import styles from "./workspace.module.css";

type PublicationPolicyView = Readonly<{
  organizerSelfPublishEnabled: boolean;
}>;

export function PublicationPolicyPanel({
  canManage,
}: Readonly<{ canManage: boolean }>) {
  const [policy, setPolicy] = useState<PublicationPolicyView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Loading website publication policy…");

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await organizerRequest(
          "/api/organizer/settings/publication-policy",
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setPolicy(parsePolicy(response));
        setNotice("");
      } catch (error) {
        if (controller.signal.aborted) return;
        setNotice(
          safeNotice(
            error,
            "The private website publication policy could not be loaded.",
          ),
        );
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !policy || busy) return;
    const data = new FormData(event.currentTarget);
    const nextEnabled = data.get("organizerSelfPublishEnabled") === "on";
    setBusy(true);
    setNotice("");
    try {
      const response = await organizerRequest(
        "/api/organizer/settings/publication-policy",
        {
          body: JSON.stringify({
            organizerSelfPublishEnabled: nextEnabled,
          }),
          method: "PATCH",
        },
      );
      const next = parsePolicy(response);
      setPolicy(next);
      setNotice("Website publication permission saved.");
    } catch (error) {
      setNotice(
        safeNotice(error, "The website publication permission was not saved."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.policyPanel} onSubmit={submit}>
      <header>
        <p className={styles.kicker}>Website publication</p>
        <h2>Organizer self-publishing</h2>
        <p>
          Owners and Administrators can publish eligible confirmed events.
          This narrow setting controls whether an Organizer may also publish an
          event they own or co-organize in an assigned club.
        </p>
      </header>
      <div>
        {policy ? (
          <>
            <label className={styles.consentField}>
              <input
                defaultChecked={policy.organizerSelfPublishEnabled}
                disabled={!canManage || busy}
                name="organizerSelfPublishEnabled"
                type="checkbox"
              />
              <span>
                <strong>Allow eligible Organizers to publish</strong>
                <small>
                  Publication still requires a confirmed event, complete public
                  details, an authorized club assignment, current ownership or
                  co-organization, and the authoritative conflict check.
                </small>
              </span>
            </label>
            {canManage ? (
              <button
                className={styles.primaryButton}
                disabled={busy}
                type="submit"
              >
                {busy ? "Saving…" : "Save publication permission"}
              </button>
            ) : (
              <p className={styles.roleNote}>
                This policy is read-only for Organizers.
              </p>
            )}
          </>
        ) : (
          <p className={styles.panelEmpty}>
            No policy value is shown until the private D1 record loads.
          </p>
        )}
        <p aria-atomic="true" aria-live="polite">
          {notice}
        </p>
      </div>
    </form>
  );
}

function parsePolicy(value: unknown): PublicationPolicyView {
  const policy = isRecord(value) && isRecord(value.policy) ? value.policy : null;
  if (!policy || typeof policy.organizerSelfPublishEnabled !== "boolean") {
    throw new TypeError("Unexpected publication policy response");
  }
  return Object.freeze({
    organizerSelfPublishEnabled: policy.organizerSelfPublishEnabled,
  });
}
