"use client";

import { useState } from "react";
import {
  isRecord,
  organizerRequest,
  safeNotice,
} from "@/app/_organizer/client";
import type { CalendarSubscriptionDto } from "@/lib/server/phase7/calendar-subscriptions";
import styles from "@/app/_organizer/workspace.module.css";

export function PrivateCalendarSubscriptionPanel({
  initialSubscriptions,
}: Readonly<{
  initialSubscriptions: readonly CalendarSubscriptionDto[];
}>) {
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  const [label, setLabel] = useState("");
  const [oneTimeUrl, setOneTimeUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeCount = subscriptions.filter(
    (subscription) => subscription.revokedAt === null,
  ).length;

  async function createSubscription() {
    setBusy("create");
    setNotice(null);
    setOneTimeUrl(null);
    try {
      const body = await organizerRequest(
        "/api/organizer/calendar-tokens",
        {
          method: "POST",
          body: JSON.stringify({ label: label.trim() || null }),
        },
      );
      const subscription = isRecord(body) ? body.subscription : null;
      if (
        !isRecord(body) ||
        !isCalendarSubscription(subscription) ||
        typeof body.tokenUrl !== "string" ||
        body.tokenUrl.length > 2_048 ||
        !body.tokenUrl.includes("/api/calendar/private/")
      ) {
        throw new TypeError("Unexpected calendar subscription response");
      }
      setSubscriptions((current) => [
        subscription,
        ...current,
      ]);
      setLabel("");
      setOneTimeUrl(body.tokenUrl);
      setNotice(
        "Private calendar subscription created. Copy the URL now; it cannot be shown again.",
      );
    } catch (error) {
      setNotice(
        safeNotice(error, "The calendar subscription could not be created."),
      );
    } finally {
      setBusy(null);
    }
  }

  async function revokeSubscription(subscription: CalendarSubscriptionDto) {
    setBusy(subscription.id);
    setNotice(null);
    setOneTimeUrl(null);
    try {
      const body = await organizerRequest(
        `/api/organizer/calendar-tokens/${encodeURIComponent(subscription.id)}/revoke`,
        {
          method: "POST",
          body: "{}",
        },
      );
      if (!isRecord(body) || !isCalendarSubscription(body.subscription)) {
        throw new TypeError("Unexpected calendar subscription response");
      }
      const updated = body.subscription;
      setSubscriptions((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setNotice("Private calendar subscription revoked immediately.");
    } catch (error) {
      setNotice(
        safeNotice(error, "The calendar subscription could not be revoked."),
      );
    } finally {
      setBusy(null);
    }
  }

  async function copyOneTimeUrl() {
    if (!oneTimeUrl) return;
    try {
      await navigator.clipboard.writeText(oneTimeUrl);
      setNotice("Private calendar URL copied.");
    } catch {
      setNotice("Copy was unavailable. Select and copy the URL manually.");
    }
  }

  return (
    <section
      aria-labelledby="private-calendar-subscription-title"
      className={styles.formSection}
    >
      <header>
        <p className={styles.kicker}>Read-only private calendar</p>
        <h2 id="private-calendar-subscription-title">
          Calendar subscriptions
        </h2>
        <p>
          Create up to three personal URLs for a calendar client. Each URL is
          shown once, stops working immediately after revocation or loss of
          membership, and never enables two-way editing.
        </p>
      </header>
      <div className={styles.formFields}>
        <label className={styles.fieldFull}>
          <span>Token label</span>
          <input
            disabled={busy !== null || activeCount >= 3}
            maxLength={80}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Personal calendar"
            type="text"
            value={label}
          />
          <small>
            The label is private. Raw subscription URLs are never stored.
          </small>
        </label>
        <div className={`${styles.formFooter} ${styles.fieldFull}`}>
          <button
            disabled={busy !== null || activeCount >= 3}
            onClick={createSubscription}
            type="button"
          >
            {busy === "create" ? "Creating…" : "Create private URL"}
          </button>
          <p aria-live="polite">
            {activeCount} of 3 active subscriptions
          </p>
        </div>
        {oneTimeUrl ? (
          <div className={`${styles.fixedField} ${styles.fieldFull}`}>
            <span>Copy this URL now</span>
            <input
              aria-label="New private calendar subscription URL"
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              type="text"
              value={oneTimeUrl}
            />
            <button
              className={styles.secondaryButton}
              onClick={copyOneTimeUrl}
              type="button"
            >
              Copy URL
            </button>
          </div>
        ) : null}
        {subscriptions.length > 0 ? (
          <ul className={`${styles.fieldFull} ${styles.simpleList}`}>
            {subscriptions.map((subscription) => (
              <li key={subscription.id}>
                <div>
                  <strong>{subscription.label ?? "Private calendar"}</strong>
                  <small>
                    Created {formatDate(subscription.createdAt)}
                    {subscription.lastUsedAt
                      ? ` · Last used ${formatDate(subscription.lastUsedAt)}`
                      : " · Not used yet"}
                    {subscription.revokedAt
                      ? ` · Revoked ${formatDate(subscription.revokedAt)}`
                      : ""}
                  </small>
                </div>
                {subscription.revokedAt === null ? (
                  <button
                    className={styles.secondaryButton}
                    disabled={busy !== null}
                    onClick={() => revokeSubscription(subscription)}
                    type="button"
                  >
                    {busy === subscription.id ? "Revoking…" : "Revoke"}
                  </button>
                ) : (
                  <span>Revoked</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className={`${styles.formNotice} ${styles.fieldFull}`}>
            No private calendar subscription exists yet.
          </p>
        )}
        {notice ? (
          <p
            aria-live="polite"
            className={`${styles.formNotice} ${styles.fieldFull}`}
          >
            {notice}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function isCalendarSubscription(value: unknown): value is CalendarSubscriptionDto {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    (value.label === null || typeof value.label === "string") &&
    typeof value.createdAt === "number" &&
    (value.lastUsedAt === null || typeof value.lastUsedAt === "number") &&
    (value.revokedAt === null || typeof value.revokedAt === "number")
  );
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Vancouver",
  }).format(new Date(value));
}
