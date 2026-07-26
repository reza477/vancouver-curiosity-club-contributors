"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { MeetupUiState } from "./model";

type RefreshCounts = Readonly<{
  cancelled: number;
  created: number;
  rejected: number;
  removed: number;
  updated: number;
}>;

export function MeetupControls({
  canConfigure,
  clubOptions,
  initialState,
}: Readonly<{
  canConfigure: boolean;
  clubOptions: readonly Readonly<{ id: string; name: string }>[];
  initialState: MeetupUiState;
}>) {
  const [state, setState] = useState(initialState);
  const [clubId, setClubId] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [busyAction, setBusyAction] = useState<"connect" | "refresh" | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConfigure || busyAction) return;

    setBusyAction("connect");
    setNotice(null);
    try {
      const response = await fetch("/api/organizer/meetup/connect", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clubId, feedUrl }),
      });
      const body = await readJson(response);
      if (!response.ok || !isConnectResponse(body)) {
        throw new SafeUiRequestError(safeApiMessage(body));
      }
      setState(body.state);
      setFeedUrl("");
      setNotice(
        "Official calendar feed saved. No refresh is claimed yet; use Refresh now to request one.",
      );
    } catch (error) {
      setNotice(
        error instanceof SafeUiRequestError
          ? error.message
          : "The calendar source could not be saved.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function refresh() {
    if (busyAction) return;

    setBusyAction("refresh");
    setNotice(null);
    try {
      const response = await fetch("/api/organizer/meetup/refresh", {
        method: "POST",
        credentials: "same-origin",
      });
      const body = await readJson(response);
      if (!response.ok || !isRefreshResponse(body)) {
        throw new SafeUiRequestError(safeApiMessage(body));
      }
      setState(body.state);
      setNotice(refreshOutcomeCopy(body.outcome, body.counts));
    } catch (error) {
      setNotice(
        error instanceof SafeUiRequestError
          ? error.message
          : "The refresh request could not be completed.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  const copy = connectionCopy(state);
  const cannotRefresh =
    busyAction !== null ||
    state.status === "not_connected" ||
    state.status === "disabled";

  return (
    <div className="meetup-controls" aria-busy={busyAction !== null}>
      <section
        className={`meetup-status meetup-status-${copy.tone}`}
        aria-labelledby="meetup-status-heading"
      >
        <div>
          <p className="organizer-shell__eyebrow">{copy.label}</p>
          <h2 id="meetup-status-heading">{copy.heading}</h2>
          <p>{copy.detail}</p>
        </div>
        <dl>
          <div>
            <dt>Last attempt</dt>
            <dd>{formatPrivateTime(state.lastAttemptAt)}</dd>
          </div>
          <div>
            <dt>Last success</dt>
            <dd>{formatPrivateTime(state.lastSuccessAt)}</dd>
          </div>
          <div>
            <dt>Next view refresh due</dt>
            <dd>{formatPrivateTime(state.nextRefreshAt)}</dd>
          </div>
        </dl>
      </section>

      {canConfigure ? (
        <>
          <section
            className="meetup-refresh-panel"
            aria-labelledby="manual-refresh-heading"
          >
            <div>
              <p className="organizer-shell__eyebrow">Manual control</p>
              <h2 id="manual-refresh-heading">Refresh official feeds now</h2>
              <p>
                Owner and Administrator access can request a manual refresh. A
                request processes one feed and may report partial, busy,
                unchanged, failed, or completed; the button does not imply
                success.
              </p>
            </div>
            <button
              type="button"
              onClick={refresh}
              disabled={cannotRefresh}
            >
              {busyAction === "refresh" ? "Refreshing…" : "Refresh now"}
            </button>
          </section>

          <section
            className="meetup-connect-panel"
            aria-labelledby="connect-heading"
          >
            <div>
              <p className="organizer-shell__eyebrow">Owner configuration</p>
              <h2 id="connect-heading">Add an official group calendar feed</h2>
              <p>
                Paste the exact calendar subscription feed URL supplied for
                an official Meetup group. Repeat this for each group: every
                distinct feed receives its own club scope. Saved source
                addresses are never shown back in this portal.
              </p>
            </div>
            <form onSubmit={connect}>
              <label htmlFor="meetup-program-club">
                Program
              </label>
              <select
                id="meetup-program-club"
                name="clubId"
                value={clubId}
                onChange={(event) => setClubId(event.target.value)}
                aria-describedby="meetup-program-help"
                required
              >
                <option value="">Choose a program</option>
                {clubOptions.map((club) => (
                  <option key={club.id} value={club.id}>
                    {club.name}
                  </option>
                ))}
              </select>
              <p id="meetup-program-help">
                The selected program must match the official Meetup group in
                the calendar feed.
              </p>
              <label htmlFor="meetup-feed-url">
                Official Meetup calendar feed URL
              </label>
              <input
                id="meetup-feed-url"
                name="feedUrl"
                type="url"
                value={feedUrl}
                onChange={(event) => setFeedUrl(event.target.value)}
                autoComplete="off"
                inputMode="url"
                maxLength={2048}
                required
                spellCheck={false}
                aria-describedby="meetup-feed-help"
              />
              <p id="meetup-feed-help">
                Configuration saves the source only. It does not claim that a
                refresh or import succeeded.
              </p>
              <button
                type="submit"
                disabled={
                  busyAction !== null ||
                  clubId.length === 0 ||
                  feedUrl.length === 0
                }
              >
                {busyAction === "connect" ? "Saving…" : "Save source"}
              </button>
            </form>
          </section>
        </>
      ) : (
        <section className="meetup-role-note" aria-label="Configuration access">
          <p>
            Organizer access is read-only. You can view this coarse connection
            status, but only an Owner or Administrator can refresh it or
            configure official feed coverage.
          </p>
        </section>
      )}

      <aside className="meetup-cadence-note">
        <p>
          <strong>No scheduled sync:</strong> public calendar views may request
          one opportunistic feed check per view. Completed feeds wait at least
          15 minutes; partial snapshots resume in bounded chunks. Manual
          refresh is explicit and still respects an in-progress refresh lease.
        </p>
      </aside>

      <p className="meetup-live-notice" aria-live="polite">
        {notice}
      </p>
    </div>
  );
}

export function connectionCopy(state: MeetupUiState) {
  if (state.scheduleConflict) {
    return {
      label: "Schedule conflict",
      heading: "A staged feed update needs schedule coordination.",
      detail:
        "The last completed source snapshot remains active. Move or release the conflicting private reservation, then refresh again to retry the retained feed snapshot. Saved source addresses remain hidden.",
      tone: "error",
    };
  }
  if (state.status === "not_connected") {
    return {
      label: "Not connected",
      heading: "No official calendar feed is configured.",
      detail:
        "Nothing has been synced. An Owner or Administrator must save the exact official group calendar feed URL.",
      tone: "quiet",
    };
  }
  if (state.status === "disabled") {
    return {
      label: "Disabled",
      heading: "Feed refresh is paused.",
      detail: "No view or manual refresh runs while the source is disabled.",
      tone: "quiet",
    };
  }
  if (state.status === "refreshing") {
    return {
      label: "Refreshing",
      heading: "A refresh lease is currently active.",
      detail:
        "Another request should report busy rather than start a second import.",
      tone: "waiting",
    };
  }
  if (state.status === "partial") {
    return {
      label: "Import in progress",
      heading: "A feed snapshot is being processed in bounded chunks.",
      detail:
        "Refresh again to continue. The public calendar does not claim a complete first import until the final chunk succeeds.",
      tone: "waiting",
    };
  }
  if (state.status === "pending" || state.lastSuccessAt === null) {
    return {
      label: "Never synced",
      heading: "At least one feed has not completed its first refresh.",
      detail:
        "A saved connection is not proof of an import. Request manual refreshes and read each result until all connected feeds complete.",
      tone: "waiting",
    };
  }
  if (state.status === "current") {
    return {
      label: "Fresh",
      heading: "The latest aggregate feed refresh succeeded.",
      detail:
        "The public calendar can use the most recently verified source records.",
      tone: "fresh",
    };
  }
  if (state.status === "stale") {
    return {
      label: "Stale",
      heading: "A newer successful refresh is due.",
      detail:
        "Last-known source records remain available while the connection waits for another successful refresh.",
      tone: "waiting",
    };
  }
  return {
    label: "Source error",
    heading: "The latest refresh did not complete.",
    detail:
      "No raw source error is displayed here. Source-backed rows from successful row transactions may remain available.",
    tone: "error",
  };
}

function refreshOutcomeCopy(
  outcome:
    | "busy"
    | "completed"
    | "disabled"
    | "failed"
    | "not_connected"
    | "not_due"
    | "not_modified"
    | "partial",
  counts: RefreshCounts,
) {
  if (outcome === "completed") {
    return `Refresh completed: ${counts.created} created, ${counts.updated} updated, ${counts.cancelled} cancelled, ${counts.removed} removed, and ${counts.rejected} rejected.`;
  }
  if (outcome === "not_modified") {
    return "The source reported no modified calendar data.";
  }
  if (outcome === "partial") {
    return `Processed a bounded feed chunk: ${counts.created} created, ${counts.updated} updated, ${counts.cancelled} cancelled, and ${counts.rejected} rejected. Refresh again to continue the same snapshot.`;
  }
  if (outcome === "busy") {
    return "Another refresh is already in progress. No second import was started.";
  }
  if (outcome === "not_due") {
    return "A view-triggered refresh is not due yet. No import was started.";
  }
  if (outcome === "not_connected") {
    return "No source is connected, so no refresh was started.";
  }
  if (outcome === "disabled") {
    return "The source is disabled, so no refresh was started.";
  }
  return "The refresh did not complete. Source-backed rows committed by successful row transactions may remain available.";
}

function formatPrivateTime(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-CA", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/Vancouver",
    timeZoneName: "short",
    year: "numeric",
  }).format(date);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function safeApiMessage(body: unknown) {
  if (!isRecord(body) || !isRecord(body.error)) {
    return "The request could not be completed.";
  }
  const message = body.error.message;
  return typeof message === "string" && message.length <= 240
    ? message
    : "The request could not be completed.";
}

class SafeUiRequestError extends Error {}

function isConnectResponse(
  value: unknown,
): value is Readonly<{ state: MeetupUiState }> {
  return isRecord(value) && isMeetupUiState(value.state);
}

function isRefreshResponse(value: unknown): value is Readonly<{
  counts: RefreshCounts;
  outcome:
    | "busy"
    | "completed"
    | "disabled"
    | "failed"
    | "not_connected"
    | "not_due"
    | "not_modified"
    | "partial";
  state: MeetupUiState;
}> {
  if (!isRecord(value)) return false;
  const outcomes = new Set([
    "busy",
    "completed",
    "disabled",
    "failed",
    "not_connected",
    "not_due",
    "not_modified",
    "partial",
  ]);
  return (
    typeof value.outcome === "string" &&
    outcomes.has(value.outcome) &&
    isRefreshCounts(value.counts) &&
    isMeetupUiState(value.state)
  );
}

function isRefreshCounts(value: unknown): value is RefreshCounts {
  if (!isRecord(value)) return false;
  return ["cancelled", "created", "rejected", "removed", "updated"].every(
    (key) => {
      const count = value[key];
      return (
        typeof count === "number" &&
        Number.isSafeInteger(count) &&
        count >= 0
      );
    },
  );
}

function isMeetupUiState(value: unknown): value is MeetupUiState {
  if (!isRecord(value)) return false;
  const statuses = new Set([
    "current",
    "disabled",
    "error",
    "not_connected",
    "partial",
    "pending",
    "refreshing",
    "stale",
  ]);
  return (
    typeof value.enabled === "boolean" &&
    typeof value.scheduleConflict === "boolean" &&
    typeof value.status === "string" &&
    statuses.has(value.status) &&
    isNullableString(value.lastAttemptAt) &&
    isNullableString(value.lastSuccessAt) &&
    isNullableString(value.nextRefreshAt)
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
