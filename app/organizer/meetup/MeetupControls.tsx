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

type RefreshOutcome =
  | "busy"
  | "completed"
  | "disabled"
  | "failed"
  | "not_connected"
  | "not_due"
  | "not_modified"
  | "partial";

type RefreshResponse = Readonly<{
  counts: RefreshCounts;
  outcome: RefreshOutcome;
  state: MeetupUiState;
}>;

type RefreshClubTarget = Readonly<{
  id: string;
  name: string;
}>;

type RefreshRun = Readonly<{
  counts: RefreshCounts;
  error: unknown | null;
  lastAggregateState: MeetupUiState | null;
  outcomes: readonly RefreshOutcome[];
  requestCount: number;
  stoppedAtLimit: boolean;
}>;

type MaterializationCounts = Readonly<{
  eventsSnapshotCount: number;
  homeEventCount: number;
}>;

type RefreshAndMaterializeRun = RefreshRun &
  Readonly<{
    materialization: MaterializationCounts | null;
    materializationError: unknown | null;
  }>;

const ALL_REFRESH_CLUBS = "__all__";
const DEPENDENT_MEETUP_PROGRAM_NAME = "Vancouver Curiosity Club";
export const MAX_AUTOMATIC_MEETUP_REFRESH_REQUESTS = 64;

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
  const [refreshClubId, setRefreshClubId] = useState(ALL_REFRESH_CLUBS);
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

    const selectedClubs =
      refreshClubId === ALL_REFRESH_CLUBS
        ? clubOptions
        : clubOptions.filter((club) => club.id === refreshClubId);
    if (selectedClubs.length === 0) {
      setNotice("No Meetup program is available to refresh.");
      return;
    }

    setBusyAction("refresh");
    setNotice(null);
    try {
      const run = await runMeetupRefreshAndMaterialize(
        selectedClubs,
        requestMeetupRefresh,
        requestMeetupMaterialization,
      );
      if (run.lastAggregateState) setState(run.lastAggregateState);
      setNotice(
        refreshRunCopy(
          run,
          new Set(selectedClubs.map((club) => club.id)).size,
        ),
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function requestMeetupRefresh(
    targetClubId: string,
  ): Promise<RefreshResponse> {
    const response = await fetch("/api/organizer/meetup/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ clubId: targetClubId }),
    });
    const body = await readJson(response);
    if (!response.ok || !isRefreshResponse(body)) {
      throw new SafeUiRequestError(safeApiMessage(body));
    }
    return body;
  }

  async function requestMeetupMaterialization(): Promise<MaterializationCounts> {
    const response = await fetch("/api/organizer/meetup/materialize", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const body = await readJson(response);
    if (!response.ok || !isMaterializationResponse(body)) {
      throw new SafeUiRequestError(safeApiMessage(body));
    }
    return body.counts;
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
            <dt>Next scheduled refresh due</dt>
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
                Choose one program or refresh every available program. Each
                request remains limited to two source rows; a partial result
                automatically continues the same program until it completes
                or reaches the safety limit.
              </p>
            </div>
            <div className="meetup-refresh-actions">
              <label htmlFor="meetup-refresh-program">
                Programs to refresh
              </label>
              <select
                id="meetup-refresh-program"
                value={refreshClubId}
                onChange={(event) => setRefreshClubId(event.target.value)}
                aria-describedby="meetup-refresh-help"
                disabled={busyAction !== null}
              >
                <option value={ALL_REFRESH_CLUBS}>All Meetup programs</option>
                {clubOptions.map((club) => (
                  <option key={club.id} value={club.id}>
                    {club.name}
                  </option>
                ))}
              </select>
              <p id="meetup-refresh-help">
                Counts are combined across every bounded request in this run.
              </p>
              <button
                type="button"
                onClick={refresh}
                disabled={cannotRefresh}
              >
                {busyAction === "refresh" ? "Refreshing…" : "Refresh now"}
              </button>
            </div>
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
          <strong>Daily protected sync:</strong> A signed maintenance job
          checks the official feeds each day and follows partial imports in
          bounded two-event requests. After every source is current, it
          prebuilds the durable Home and Events views. Ordinary visitor page
          requests only read the last completed data and never run a Meetup
          import. Use the manual refresh for an urgent correction.
        </p>
        <p>
          The official calendar feed updates event titles, times, status, and
          Meetup links. It does not include an approved poster-image contract.
          The current Owner-approved poster copies are bundled with this site
          and matched to their exact Meetup event IDs. A newly synced event
          uses category artwork until its approved poster copy is added.
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
      detail:
        "No scheduled or manual refresh runs while the source is disabled.",
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
        "Choose that program or All Meetup programs and refresh once; the control continues bounded chunks automatically. The public calendar does not claim a complete first import until the final chunk succeeds.",
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

export async function runMeetupRefreshSelection(
  clubs: readonly RefreshClubTarget[],
  requestRefresh: (clubId: string) => Promise<RefreshResponse>,
): Promise<RefreshRun> {
  const uniqueClubs = new Map<string, RefreshClubTarget>();
  for (const club of clubs) {
    if (!uniqueClubs.has(club.id)) uniqueClubs.set(club.id, club);
  }
  const clubTargets = [...uniqueClubs.values()];
  const orderedClubTargets = [
    ...clubTargets.filter(
      (club) => club.name !== DEPENDENT_MEETUP_PROGRAM_NAME,
    ),
    ...clubTargets.filter(
      (club) => club.name === DEPENDENT_MEETUP_PROGRAM_NAME,
    ),
  ];
  const counts = mutableEmptyRefreshCounts();
  const outcomes: RefreshOutcome[] = [];
  let error: unknown | null = null;
  let lastAggregateState: MeetupUiState | null = null;
  let requestCount = 0;
  let stoppedAtLimit = false;

  refreshPrograms: for (const targetClub of orderedClubTargets) {
    let outcome: RefreshOutcome;
    do {
      if (requestCount >= MAX_AUTOMATIC_MEETUP_REFRESH_REQUESTS) {
        stoppedAtLimit = true;
        break refreshPrograms;
      }
      let response: RefreshResponse;
      try {
        response = await requestRefresh(targetClub.id);
      } catch (caught) {
        error = caught;
        break refreshPrograms;
      }
      requestCount += 1;
      outcome = response.outcome;
      outcomes.push(outcome);
      addRefreshCounts(counts, response.counts);
      if (
        outcome === "completed" ||
        outcome === "failed" ||
        outcome === "not_modified" ||
        outcome === "partial"
      ) {
        // These result paths re-read organization-wide state. Early
        // not-connected/disabled/busy results are scoped to one source and
        // must not replace the aggregate panel above.
        lastAggregateState = response.state;
      }
    } while (outcome === "partial");
  }

  return Object.freeze({
    counts: Object.freeze({ ...counts }),
    error,
    lastAggregateState,
    outcomes: Object.freeze(outcomes),
    requestCount,
    stoppedAtLimit,
  });
}

export async function runMeetupRefreshAndMaterialize(
  clubs: readonly RefreshClubTarget[],
  requestRefresh: (clubId: string) => Promise<RefreshResponse>,
  requestMaterialization: () => Promise<MaterializationCounts>,
): Promise<RefreshAndMaterializeRun> {
  const refresh = await runMeetupRefreshSelection(clubs, requestRefresh);
  const selectedProgramCount = new Set(clubs.map((club) => club.id)).size;
  if (!isSuccessfulTerminalRefresh(refresh, selectedProgramCount)) {
    return Object.freeze({
      ...refresh,
      materialization: null,
      materializationError: null,
    });
  }

  try {
    const materialization = await requestMaterialization();
    return Object.freeze({
      ...refresh,
      materialization,
      materializationError: null,
    });
  } catch (error) {
    return Object.freeze({
      ...refresh,
      materialization: null,
      materializationError: error,
    });
  }
}

function isSuccessfulTerminalRefresh(
  run: RefreshRun,
  selectedProgramCount: number,
): boolean {
  if (
    selectedProgramCount < 1 ||
    run.error !== null ||
    run.stoppedAtLimit
  ) {
    return false;
  }
  const terminalOutcomes = run.outcomes.filter(
    (outcome) => outcome === "completed" || outcome === "not_modified",
  );
  return (
    terminalOutcomes.length === selectedProgramCount &&
    run.outcomes.every(
      (outcome) =>
        outcome === "partial" ||
        outcome === "completed" ||
        outcome === "not_modified",
    )
  );
}

function refreshRunCopy(
  run: RefreshAndMaterializeRun,
  selectedProgramCount: number,
): string {
  const totals = refreshCountsCopy(run.counts);
  if (run.error) {
    const message =
      run.error instanceof SafeUiRequestError
        ? run.error.message
        : "The refresh request could not be completed.";
    return run.requestCount === 0
      ? message
      : `${message} ${run.requestCount} earlier bounded requests succeeded. ${totals}`;
  }
  if (run.stoppedAtLimit) {
    return `Refresh paused at the ${MAX_AUTOMATIC_MEETUP_REFRESH_REQUESTS}-request safety limit. Choose the same selection and refresh again to continue. ${totals}`;
  }
  if (run.materializationError) {
    return `Meetup source refresh completed, but the public Home and Events views could not be rebuilt. Run Refresh now again to retry the public update. ${totals}`;
  }
  if (run.materialization) {
    return `Refresh completed across ${selectedProgramCount} selected program${selectedProgramCount === 1 ? "" : "s"} in ${run.requestCount} bounded request${run.requestCount === 1 ? "" : "s"}. Public Home and Events were rebuilt with ${run.materialization.homeEventCount} Home event${run.materialization.homeEventCount === 1 ? "" : "s"} and ${run.materialization.eventsSnapshotCount} Events snapshot${run.materialization.eventsSnapshotCount === 1 ? "" : "s"}. ${totals}`;
  }
  const exceptional = new Set(
    run.outcomes.filter(
      (outcome) =>
        outcome !== "completed" &&
        outcome !== "not_modified" &&
        outcome !== "partial",
    ),
  );
  if (exceptional.size > 0) {
    return `Refresh run finished with ${[...exceptional].join(", ")} result${exceptional.size === 1 ? "" : "s"} across ${selectedProgramCount} selected program${selectedProgramCount === 1 ? "" : "s"}. ${totals}`;
  }
  return `Refresh completed across ${selectedProgramCount} selected program${selectedProgramCount === 1 ? "" : "s"} in ${run.requestCount} bounded request${run.requestCount === 1 ? "" : "s"}. ${totals}`;
}

function mutableEmptyRefreshCounts(): {
  cancelled: number;
  created: number;
  rejected: number;
  removed: number;
  updated: number;
} {
  return { cancelled: 0, created: 0, rejected: 0, removed: 0, updated: 0 };
}

function addRefreshCounts(
  target: ReturnType<typeof mutableEmptyRefreshCounts>,
  counts: RefreshCounts,
): void {
  target.cancelled += counts.cancelled;
  target.created += counts.created;
  target.rejected += counts.rejected;
  target.removed += counts.removed;
  target.updated += counts.updated;
}

function refreshCountsCopy(counts: RefreshCounts): string {
  return `Totals: ${counts.created} created, ${counts.updated} updated, ${counts.cancelled} cancelled, ${counts.removed} removed, and ${counts.rejected} rejected.`;
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
  outcome: RefreshOutcome;
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

function isMaterializationResponse(
  value: unknown,
): value is Readonly<{ counts: MaterializationCounts }> {
  if (!isRecord(value) || !isRecord(value.counts)) return false;
  const counts = value.counts;
  return ["eventsSnapshotCount", "homeEventCount"].every((key) => {
    const count = counts[key];
    return (
      typeof count === "number" &&
      Number.isSafeInteger(count) &&
      count >= 0
    );
  });
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
