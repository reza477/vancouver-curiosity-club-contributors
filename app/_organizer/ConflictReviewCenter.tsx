"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { isRecord, organizerRequest, safeNotice } from "./client";
import { StatusPill } from "./PageHeader";
import styles from "./workspace.module.css";

const CONFLICT_STATES = [
  ["open", "Open"],
  ["pending", "Pending approval"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["invalidated", "Invalidated"],
  ["resolved", "Resolved"],
  ["warning", "Draft warnings"],
] as const;

type ConflictState = (typeof CONFLICT_STATES)[number][0];
type ConflictAction =
  | Readonly<{
      eventId: string | null;
      expectedContentVersion: number | null;
      expectedScheduleVersion: number | null;
      kind: "approve" | "cancel" | "mark_reviewed" | "reject";
    }>
  | Readonly<{
      eventId: string;
      expectedContentVersion: null;
      expectedScheduleVersion: null;
      kind: "change_time" | "edit";
    }>;

type ConflictEvent = Readonly<{
  clubName: string;
  eventId: string;
  organizerName: string;
  planningStatus: string;
  readOnly: boolean;
  scheduleLabel: string;
  title: string;
}>;

type ConflictCenterItem = Readonly<{
  actions: readonly ConflictAction[];
  activity: readonly Readonly<{
    id: string;
    label: string;
    timeLabel: string;
  }>[];
  classification: "buffer" | "direct";
  eventA: ConflictEvent;
  eventB: ConflictEvent;
  groupDate: string;
  id: string;
  overlapLabel: string;
  reason: string | null;
  resources: readonly Readonly<{ label: string; type: string }>[];
  state: ConflictState;
}>;

export function ConflictReviewCenter() {
  const [activeState, setActiveState] = useState<ConflictState>("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [items, setItems] = useState<readonly ConflictCenterItem[]>([]);
  const [loadState, setLoadState] = useState<
    "error" | "loading" | "ready" | "refreshing"
  >("loading");
  const [notice, setNotice] = useState("Loading current conflict records…");

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void load(controller, false);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  async function load(controller = new AbortController(), refresh = true) {
    if (refresh) {
      setLoadState("refreshing");
      setNotice("Refreshing current D1 conflict records…");
    }
    try {
      const body = await organizerRequest("/api/organizer/conflicts", {
        method: "GET",
        signal: controller.signal,
      });
      const conflicts = parseConflictCenter(body);
      setItems(conflicts);
      setLoadState("ready");
      setNotice(
        conflicts.length === 0
          ? "No conflict or review record is currently available."
          : `${conflicts.length} current conflict ${conflicts.length === 1 ? "record" : "records"} loaded.`,
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadState("error");
      setNotice(
        safeNotice(
          error,
          "Conflict records could not be loaded. No state is being guessed.",
        ),
      );
    }
  }

  const filtered = useMemo(
    () => items.filter((item) => item.state === activeState),
    [activeState, items],
  );
  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  async function perform(item: ConflictCenterItem, action: ConflictAction) {
    if (busyId) return;
    if (action.kind === "edit" || action.kind === "change_time") return;
    if (
      action.kind === "cancel" &&
      !window.confirm(
        "Cancel this private event? This changes schedule coordination for everyone involved.",
      )
    ) {
      return;
    }
    setBusyId(`${item.id}:${action.kind}`);
    setNotice("");
    try {
      if (action.kind === "approve" || action.kind === "reject") {
        await organizerRequest(
          `/api/organizer/conflicts/reviews/${encodeURIComponent(item.id)}/decision`,
          {
            body: JSON.stringify({ decision: action.kind }),
            method: "POST",
          },
        );
      } else if (action.kind === "mark_reviewed") {
        await organizerRequest(
          `/api/organizer/conflicts/incidents/${encodeURIComponent(item.id)}/review`,
          {
            body: JSON.stringify({ reviewed: true }),
            method: "POST",
          },
        );
      } else if (action.eventId) {
        await organizerRequest(
          `/api/organizer/events/${encodeURIComponent(action.eventId)}/actions`,
          {
            body: JSON.stringify({
              action: "cancel",
              expectedContentVersion: action.expectedContentVersion,
              expectedScheduleVersion: action.expectedScheduleVersion,
            }),
            method: "POST",
          },
        );
      }
      setNotice("Conflict coordination state updated.");
      await load(new AbortController());
    } catch (error) {
      setNotice(
        safeNotice(error, "The conflict action could not be completed."),
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.conflictCenter}>
      <section
        aria-label="Conflict review states"
        className={styles.conflictStateTabs}
      >
        {CONFLICT_STATES.map(([state, label]) => {
          const count = items.filter((item) => item.state === state).length;
          return (
            <button
              aria-pressed={activeState === state}
              key={state}
              onClick={() => setActiveState(state)}
              type="button"
            >
              <span>{label}</span>
              <strong>{count}</strong>
            </button>
          );
        })}
      </section>

      <div className={styles.conflictResultBar}>
        <p aria-atomic="true" aria-live="polite">
          {notice}
        </p>
        <button
          disabled={loadState === "loading" || loadState === "refreshing"}
          onClick={() => void load()}
          type="button"
        >
          {loadState === "refreshing" ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {loadState === "error" ? (
        <section className={styles.pageState} aria-labelledby="conflict-error">
          <p className={styles.kicker}>Could not load</p>
          <h2 id="conflict-error">Conflict centre temporarily unavailable.</h2>
          <p>No incident, decision, or schedule state is being guessed.</p>
        </section>
      ) : groups.length === 0 ? (
        <section className={styles.pageState} aria-labelledby="conflict-empty">
          <p className={styles.kicker}>Current D1 state</p>
          <h2 id="conflict-empty">
            No {stateLabel(activeState).toLowerCase()} records.
          </h2>
          <p>
            This is an honest empty state. Draft warnings and reserving
            conflicts appear only after a real schedule check records them.
          </p>
        </section>
      ) : (
        <div className={styles.conflictDateGroups}>
          {groups.map(([date, records]) => (
            <section
              aria-labelledby={`conflict-date-${date}`}
              key={date}
            >
              <header className={styles.sectionHeading}>
                <div>
                  <p className={styles.kicker}>Vancouver date</p>
                  <h2 id={`conflict-date-${date}`}>{formatGroupDate(date)}</h2>
                </div>
                <span>{records.length}</span>
              </header>
              <div className={styles.conflictCards}>
                {records.map((item) => (
                  <ConflictCard
                    busyId={busyId}
                    item={item}
                    key={item.id}
                    onAction={perform}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ConflictCard({
  busyId,
  item,
  onAction,
}: Readonly<{
  busyId: string | null;
  item: ConflictCenterItem;
  onAction: (item: ConflictCenterItem, action: ConflictAction) => Promise<void>;
}>) {
  return (
    <article
      aria-label={`${item.eventA.title} and ${item.eventB.title}. ${stateLabel(item.state)} ${item.classification} conflict. ${item.overlapLabel}.`}
      className={styles.conflictCard}
    >
      <header>
        <div>
          <StatusPill tone={item.state === "open" ? "amber" : "neutral"}>
            {stateLabel(item.state)}
          </StatusPill>
          <StatusPill tone={item.classification === "direct" ? "amber" : "blue"}>
            {item.classification === "direct" ? "Direct overlap" : "Buffer conflict"}
          </StatusPill>
        </div>
        <p>{item.overlapLabel}</p>
      </header>

      <div className={styles.conflictPair}>
        {[item.eventA, item.eventB].map((event) => (
          <section key={event.eventId}>
            <h3>{event.title}</h3>
            <p>{event.scheduleLabel}</p>
            <p>
              {event.clubName} · {event.organizerName}
            </p>
            <p>{event.planningStatus}</p>
            {event.readOnly ? (
              <span>Read-only source event</span>
            ) : (
              <Link href={`/organizer/events/${encodeURIComponent(event.eventId)}`}>
                View event
              </Link>
            )}
          </section>
        ))}
      </div>

      <dl className={styles.conflictFacts}>
        <div>
          <dt>Exact overlap</dt>
          <dd>{item.overlapLabel}</dd>
        </div>
        <div>
          <dt>Resources</dt>
          <dd>{item.resources.map((resource) => resource.label).join(", ")}</dd>
        </div>
        {item.reason ? (
          <div>
            <dt>Coordination note</dt>
            <dd>{item.reason}</dd>
          </div>
        ) : null}
      </dl>

      {item.activity.length > 0 ? (
        <details className={styles.conflictActivity}>
          <summary>Recent conflict activity</summary>
          <ol>
            {item.activity.map((activity) => (
              <li key={activity.id}>
                <span>{activity.label}</span>
                <time>{activity.timeLabel}</time>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {item.actions.length > 0 ? (
        <div className={styles.conflictActions}>
          {item.actions.map((action) =>
            action.kind === "edit" || action.kind === "change_time" ? (
              <Link
                href={`/organizer/events/${encodeURIComponent(action.eventId)}${action.kind === "change_time" ? "#event-schedule-title" : ""}`}
                key={`${action.kind}:${action.eventId}`}
              >
                {action.kind === "edit" ? "Edit my event" : "Change time"}
              </Link>
            ) : (
              <button
                disabled={busyId !== null}
                key={`${action.kind}:${action.eventId ?? item.id}`}
                onClick={() => void onAction(item, action)}
                type="button"
              >
                {busyId === `${item.id}:${action.kind}`
                  ? "Working…"
                  : actionLabel(action.kind)}
              </button>
            ),
          )}
        </div>
      ) : null}
    </article>
  );
}

function parseConflictCenter(value: unknown): readonly ConflictCenterItem[] {
  if (!isRecord(value) || !Array.isArray(value.conflicts)) return [];
  return Object.freeze(
    value.conflicts.slice(0, 200).flatMap((raw) => {
      if (!isRecord(raw)) return [];
      const id = text(raw.id, 128);
      const groupDate = dateText(raw.groupDate);
      const eventA = parseEvent(raw.eventA);
      const eventB = parseEvent(raw.eventB);
      const overlapLabel = text(raw.overlapLabel, 300);
      const state = conflictState(raw.state);
      const classification =
        raw.classification === "direct" || raw.classification === "buffer"
          ? raw.classification
          : null;
      if (
        !id ||
        !groupDate ||
        !eventA ||
        !eventB ||
        !overlapLabel ||
        !state ||
        !classification
      ) {
        return [];
      }
      return [
        Object.freeze({
          actions: Object.freeze(parseActions(raw.allowedActions)),
          activity: Object.freeze(parseActivity(raw.activity)),
          classification,
          eventA,
          eventB,
          groupDate,
          id,
          overlapLabel,
          reason: text(raw.reason, 1_000),
          resources: Object.freeze(parseResources(raw.resources)),
          state,
        }),
      ];
    }),
  );
}

function parseEvent(value: unknown): ConflictEvent | null {
  if (!isRecord(value)) return null;
  const eventId = text(value.eventId, 128);
  const title = text(value.title, 180);
  const clubName = text(value.clubName, 180);
  const organizerName = text(value.organizerName, 180);
  const planningStatus = text(value.planningStatus, 40);
  const readOnly = value.readOnly === true;
  const scheduleLabel = text(value.scheduleLabel, 300);
  return eventId &&
    title &&
    clubName &&
    organizerName &&
    planningStatus &&
    scheduleLabel
    ? Object.freeze({
        clubName,
        eventId,
        organizerName,
        planningStatus,
        readOnly,
        scheduleLabel,
        title,
      })
    : null;
}

function parseResources(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const label = text(raw.label, 180);
    const type = text(raw.type, 40);
    return label && type ? [Object.freeze({ label, type })] : [];
  });
}

function parseActivity(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 25).flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const id = text(raw.id, 128);
    const label = text(raw.label, 240);
    const timeLabel = text(raw.timeLabel, 120);
    return id && label && timeLabel
      ? [Object.freeze({ id, label, timeLabel })]
      : [];
  });
}

function parseActions(value: unknown): ConflictAction[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const kind =
      raw.kind === "approve" ||
      raw.kind === "cancel" ||
      raw.kind === "mark_reviewed" ||
      raw.kind === "reject" ||
      raw.kind === "change_time" ||
      raw.kind === "edit"
        ? raw.kind
        : null;
    if (!kind) return [];
    const eventId = text(raw.eventId, 128);
    if ((kind === "edit" || kind === "change_time") && !eventId) return [];
    return [
      Object.freeze({
        eventId,
        expectedContentVersion: safeVersion(raw.expectedContentVersion),
        expectedScheduleVersion: safeVersion(raw.expectedScheduleVersion),
        kind,
      }) as ConflictAction,
    ];
  });
}

function safeVersion(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1
    ? value
    : null;
}

function conflictState(value: unknown): ConflictState | null {
  return CONFLICT_STATES.some(([state]) => state === value)
    ? (value as ConflictState)
    : null;
}

function text(value: unknown, maximum: number): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
    ? value
    : null;
}

function dateText(value: unknown): string | null {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    ? value
    : null;
}

function groupByDate(
  items: readonly ConflictCenterItem[],
): readonly (readonly [string, readonly ConflictCenterItem[]])[] {
  const groups = new Map<string, ConflictCenterItem[]>();
  for (const item of items) {
    const current = groups.get(item.groupDate) ?? [];
    current.push(item);
    groups.set(item.groupDate, current);
  }
  return Object.freeze(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, records]) => [date, Object.freeze(records)] as const),
  );
}

function stateLabel(state: ConflictState): string {
  return (
    CONFLICT_STATES.find(([value]) => value === state)?.[1] ?? "Conflict"
  );
}

function actionLabel(action: ConflictAction["kind"]): string {
  if (action === "approve") return "Approve";
  if (action === "reject") return "Reject";
  if (action === "mark_reviewed") return "Mark warning reviewed";
  if (action === "cancel") return "Cancel my event";
  if (action === "change_time") return "Change time";
  return "Edit my event";
}

function formatGroupDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "full",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00.000Z`));
}
