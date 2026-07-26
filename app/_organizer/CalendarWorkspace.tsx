"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { OrganizerCalendarEntry, OrganizerOption } from "./types";
import { StatusPill } from "./PageHeader";
import styles from "./workspace.module.css";

type CalendarView = "agenda" | "day" | "month" | "week";

const VIEW_STORAGE_KEY = "vcc-organizer-calendar-view";
const VIEW_CHANGE_EVENT = "vcc-organizer-calendar-view-change";
const FILTER_STORAGE_KEY = "vcc-organizer-calendar-filters";
const FILTER_CHANGE_EVENT = "vcc-organizer-calendar-filters-change";
const VIEW_VALUES: readonly CalendarView[] = [
  "agenda",
  "day",
  "week",
  "month",
];
const PLANNING_VALUES = [
  "idea",
  "draft",
  "tentative_hold",
  "confirmed",
  "cancelled",
  "completed",
  "archived",
] as const;
const PUBLICATION_VALUES = [
  "private",
  "scheduled",
  "published",
  "unpublished",
] as const;
const SOURCE_VALUES = ["manual", "meetup", "legacy"] as const;

type CalendarFilters = Readonly<{
  category: string;
  club: string;
  dateFrom: string;
  dateTo: string;
  lane: string;
  organizer: string;
  planning: string;
  publication: string;
  search: string;
  source: string;
}>;

const EMPTY_FILTERS: CalendarFilters = Object.freeze({
  category: "",
  club: "",
  dateFrom: "",
  dateTo: "",
  lane: "",
  organizer: "",
  planning: "",
  publication: "",
  search: "",
  source: "",
});

export function CalendarWorkspace({
  defaultTimezone,
  entries,
  filterOptions,
  hasMore,
  initialDate,
  loadedCount,
  nextTake,
  resultCount,
}: Readonly<{
  entries: readonly OrganizerCalendarEntry[];
  defaultTimezone: string;
  filterOptions: Readonly<{
    categories: readonly OrganizerOption[];
    clubs: readonly OrganizerOption[];
    lanes: readonly OrganizerOption[];
    organizers: readonly OrganizerOption[];
  }>;
  hasMore: boolean;
  initialDate: string;
  loadedCount: number;
  nextTake: number | null;
  resultCount: number;
}>) {
  const view = useSyncExternalStore(
    subscribeToView,
    readStoredView,
    (): CalendarView => "agenda",
  );
  const filterSnapshot = useSyncExternalStore(
    subscribeToFilters,
    readStoredFilterSnapshot,
    (): string => "{}",
  );
  const filters = useMemo(
    () => parseStoredFilters(filterSnapshot),
    [filterSnapshot],
  );
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [refreshNotice, setRefreshNotice] = useState("");
  const filtersActive = Object.values(filters).some((value) => value !== "");

  const filtered = useMemo(
    () =>
      entries.filter((entry) => {
        const needle = filters.search.trim().toLocaleLowerCase("en-CA");
        return (
          (!needle ||
            `${entry.title} ${entry.club.name} ${entry.organizer.displayName}`
              .toLocaleLowerCase("en-CA")
              .includes(needle)) &&
          (!filters.club || entry.club.id === filters.club) &&
          (!filters.organizer ||
            entry.organizerIds.includes(filters.organizer)) &&
          (!filters.planning ||
            entry.planningStatus === filters.planning) &&
          (!filters.publication ||
            entry.publicationStatus === filters.publication) &&
          (!filters.lane || entry.lane?.id === filters.lane) &&
          (!filters.category || entry.category?.id === filters.category) &&
          (!filters.source || entry.source === filters.source) &&
          (!filters.dateFrom || entry.endDateKey >= filters.dateFrom) &&
          (!filters.dateTo || entry.dateKey <= filters.dateTo)
        );
      }),
    [entries, filters],
  );

  const scheduled = filtered.filter((entry) => entry.dateKey.length > 0);
  const ideas = filtered.filter(
    (entry) => entry.planningStatus === "idea" && entry.dateKey.length === 0,
  );

  function chooseView(next: CalendarView) {
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    window.dispatchEvent(new Event(VIEW_CHANGE_EVENT));
  }

  function clearFilters() {
    window.localStorage.removeItem(FILTER_STORAGE_KEY);
    window.dispatchEvent(new Event(FILTER_CHANGE_EVENT));
  }

  function requestRefresh() {
    setRefreshNotice("Refreshing the private calendar…");
    window.location.reload();
  }

  function updateFilter<K extends keyof CalendarFilters>(
    key: K,
    value: CalendarFilters[K],
  ) {
    const next = parseStoredFilters(JSON.stringify({ ...filters, [key]: value }));
    window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(FILTER_CHANGE_EVENT));
  }

  function shiftVisibleRange(direction: -1 | 1) {
    setSelectedDate((current) =>
      view === "month"
        ? shiftMonth(current, direction)
        : shiftDate(current, direction * viewStep(view)),
    );
  }

  return (
    <div className={styles.calendarWorkspace}>
      <section className={styles.calendarToolbar} aria-label="Calendar controls">
        <div className={styles.calendarRangeControls}>
          <button
            onClick={() => shiftVisibleRange(-1)}
            type="button"
          >
            <span aria-hidden="true">←</span>
            <span className={styles.visuallyHidden}>Previous {view}</span>
          </button>
          <button
            onClick={() => setSelectedDate(todayInZone(defaultTimezone))}
            type="button"
          >
            Today
          </button>
          <button
            onClick={() => shiftVisibleRange(1)}
            type="button"
          >
            <span aria-hidden="true">→</span>
            <span className={styles.visuallyHidden}>Next {view}</span>
          </button>
          <strong>{rangeLabel(selectedDate, view)}</strong>
        </div>

        <fieldset className={styles.viewSwitcher}>
          <legend className={styles.visuallyHidden}>Calendar view</legend>
          {VIEW_VALUES.map((value) => (
            <button
              aria-pressed={view === value}
              key={value}
              onClick={() => chooseView(value)}
              type="button"
            >
              {capitalize(value)}
            </button>
          ))}
        </fieldset>

        <button className={styles.refreshButton} onClick={requestRefresh} type="button">
          Refresh
        </button>
      </section>

      <details className={styles.calendarFilters}>
        <summary>Search and filters</summary>
        <div>
          <label className={styles.fieldWide}>
            <span>Search</span>
            <input
              maxLength={120}
              onChange={(event) => updateFilter("search", event.target.value)}
              placeholder="Title, club, or organizer"
              type="search"
              value={filters.search}
            />
          </label>
          <FilterSelect label="Club" onChange={(value) => updateFilter("club", value)} options={filterOptions.clubs} value={filters.club} />
          <FilterSelect label="Organizer" onChange={(value) => updateFilter("organizer", value)} options={filterOptions.organizers} value={filters.organizer} />
          <FilterSelect
            label="Planning status"
            onChange={(value) => updateFilter("planning", value)}
            options={[
              { id: "idea", label: "Idea" },
              { id: "draft", label: "Draft" },
              { id: "tentative_hold", label: "Tentative hold" },
              { id: "confirmed", label: "Confirmed" },
              { id: "cancelled", label: "Cancelled" },
              { id: "completed", label: "Completed" },
              { id: "archived", label: "Archived" },
            ]}
            value={filters.planning}
          />
          <FilterSelect
            label="Publication"
            onChange={(value) => updateFilter("publication", value)}
            options={[
              { id: "private", label: "Private" },
              { id: "scheduled", label: "Scheduled" },
              { id: "published", label: "Published" },
              { id: "unpublished", label: "Unpublished" },
            ]}
            value={filters.publication}
          />
          <FilterSelect label="Lane" onChange={(value) => updateFilter("lane", value)} options={filterOptions.lanes} value={filters.lane} />
          <FilterSelect label="Category" onChange={(value) => updateFilter("category", value)} options={filterOptions.categories} value={filters.category} />
          <FilterSelect
            label="Source"
            onChange={(value) => updateFilter("source", value)}
            options={[
              { id: "manual", label: "Manual" },
              { id: "meetup", label: "Meetup" },
              { id: "legacy", label: "Existing record" },
            ]}
            value={filters.source}
          />
          <label>
            <span>From</span>
            <input onChange={(event) => updateFilter("dateFrom", event.target.value)} type="date" value={filters.dateFrom} />
          </label>
          <label>
            <span>Through</span>
            <input onChange={(event) => updateFilter("dateTo", event.target.value)} type="date" value={filters.dateTo} />
          </label>
          <button className={styles.clearButton} onClick={clearFilters} type="button">
            Clear filters
          </button>
        </div>
      </details>

      <div className={styles.calendarResultBar}>
        <p aria-live="polite">
          {hasMore ? (
            filtersActive ? (
              <>
                Showing <strong>{filtered.length}</strong> matching records in{" "}
                <strong>{loadedCount}</strong> loaded of{" "}
                <strong>{resultCount}</strong> total. Load more to include the
                remaining records in these device-local filters.
              </>
            ) : (
              <>
                Showing <strong>{loadedCount}</strong> of{" "}
                <strong>{resultCount}</strong> total records.
              </>
            )
          ) : (
            <>
              <strong>{filtered.length}</strong>{" "}
              {filtered.length === 1 ? "matching record" : "matching records"}{" "}
              from {resultCount} total.
            </>
          )}
        </p>
        {hasMore && nextTake !== null ? (
          <Link
            className={styles.calendarLoadMore}
            href={`/organizer/calendar?take=${nextTake}`}
          >
            Load more records
          </Link>
        ) : null}
        <p aria-live="polite">{refreshNotice}</p>
      </div>

      {view === "agenda" ? <Agenda entries={scheduled} /> : null}
      {view === "day" ? (
        <DayView entries={scheduled} selectedDate={selectedDate} />
      ) : null}
      {view === "week" ? (
        <WeekView entries={scheduled} selectedDate={selectedDate} />
      ) : null}
      {view === "month" ? (
        <MonthView
          entries={scheduled}
          onSelectDate={(date) => {
            setSelectedDate(date);
            chooseView("day");
          }}
          selectedDate={selectedDate}
        />
      ) : null}

      <section className={styles.ideasArea} aria-labelledby="calendar-ideas-title">
        <div>
          <p className={styles.kicker}>No invented dates</p>
          <h2 id="calendar-ideas-title">Unscheduled Ideas</h2>
          <p>
            Ideas stay here until a real schedule is chosen. They never receive
            a dummy calendar date.
          </p>
        </div>
        {ideas.length > 0 ? (
          <ul className={styles.ideaList}>
            {ideas.map((entry) => (
              <li key={entry.id}>
                <Link href={`/organizer/events/${encodeURIComponent(entry.id)}`}>
                  <strong>{entry.title}</strong>
                  <span>{entry.club.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.panelEmpty}>No unscheduled Ideas match these filters.</p>
        )}
      </section>
    </div>
  );
}

function Agenda({ entries }: Readonly<{ entries: readonly OrganizerCalendarEntry[] }>) {
  const groups = groupByDate(entries);
  if (groups.length === 0) {
    return <CalendarEmpty />;
  }
  return (
    <div className={styles.agenda} aria-label="Agenda">
      {groups.map(([date, records]) => (
        <section key={date} aria-labelledby={`agenda-${date}`}>
          <h2 id={`agenda-${date}`}>{formatDate(date, "full")}</h2>
          <EventList entries={records} />
        </section>
      ))}
    </div>
  );
}

function DayView({
  entries,
  selectedDate,
}: Readonly<{ entries: readonly OrganizerCalendarEntry[]; selectedDate: string }>) {
  const records = entries.filter(
    (entry) => entry.dateKey <= selectedDate && entry.endDateKey >= selectedDate,
  );
  return (
    <section className={styles.dayView} aria-labelledby="selected-day-title">
      <h2 id="selected-day-title">{formatDate(selectedDate, "full")}</h2>
      {records.length > 0 ? <EventList entries={records} /> : <CalendarEmpty />}
    </section>
  );
}

function WeekView({
  entries,
  selectedDate,
}: Readonly<{ entries: readonly OrganizerCalendarEntry[]; selectedDate: string }>) {
  const start = startOfWeek(selectedDate);
  const days = Array.from({ length: 7 }, (_, index) => shiftDate(start, index));
  return (
    <div className={styles.weekView} aria-label={`Week of ${formatDate(start, "full")}`}>
      {days.map((day) => {
        const records = entries.filter(
          (entry) => entry.dateKey <= day && entry.endDateKey >= day,
        );
        return (
          <section key={day} aria-labelledby={`week-${day}`}>
            <h2 id={`week-${day}`}>{formatDate(day, "compact")}</h2>
            {records.length > 0 ? (
              <EventList compact entries={records} />
            ) : (
              <p className={styles.dayEmpty}>No records</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MonthView({
  entries,
  onSelectDate,
  selectedDate,
}: Readonly<{
  entries: readonly OrganizerCalendarEntry[];
  onSelectDate: (date: string) => void;
  selectedDate: string;
}>) {
  const cells = monthCells(selectedDate);
  return (
    <div className={styles.monthWrapper}>
      <div className={styles.monthWeekdays} aria-hidden="true">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className={styles.monthView} aria-label={rangeLabel(selectedDate, "month")}>
        {cells.map((cell) => {
          const count = entries.filter(
            (entry) => entry.dateKey <= cell.date && entry.endDateKey >= cell.date,
          ).length;
          return (
            <button
              aria-label={`${formatDate(cell.date, "full")}, ${count} ${count === 1 ? "record" : "records"}`}
              className={cell.inMonth ? undefined : styles.outsideMonth}
              key={cell.date}
              onClick={() => onSelectDate(cell.date)}
              type="button"
            >
              <span>{dayNumber(cell.date)}</span>
              {count > 0 ? (
                <strong>
                  {count}
                  <span aria-hidden="true"> {count === 1 ? "note" : "notes"}</span>
                </strong>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EventList({
  compact = false,
  entries,
}: Readonly<{
  compact?: boolean;
  entries: readonly OrganizerCalendarEntry[];
}>) {
  return (
    <ol className={compact ? styles.compactEventList : styles.calendarEventList}>
      {entries.map((entry) => (
        <li key={entry.id}>
          <Link
            aria-label={`${entry.title}. ${entry.fullScheduleLabel}. ${entry.organizer.displayName}. ${entry.club.name}. ${statusLabel(entry.planningStatus)}. ${entry.readOnly ? "Read-only source record." : "Private planning record."}`}
            href={`/organizer/events/${encodeURIComponent(entry.id)}`}
          >
            <span
              aria-hidden="true"
              className={styles.organizerStripe}
              style={{ backgroundColor: entry.organizer.color }}
            />
            <span className={styles.eventTime}>{entry.timeLabel}</span>
            <span className={styles.eventIdentity}>
              <strong>{entry.title}</strong>
              <small>
                {entry.club.name} · {entry.organizer.initials}
              </small>
            </span>
            <span className={styles.eventBadges}>
              <StatusPill tone={entry.planningStatus === "draft" ? "blue" : "amber"}>
                {statusLabel(entry.planningStatus)}
              </StatusPill>
              <StatusPill>{entry.publicationStatus}</StatusPill>
              <StatusPill tone={entry.source === "meetup" ? "green" : "neutral"}>
                {sourceLabel(entry.source)}
              </StatusPill>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function FilterSelect({
  label,
  onChange,
  options,
  value,
}: Readonly<{
  label: string;
  onChange: (value: string) => void;
  options: readonly OrganizerOption[];
  value: string;
}>) {
  return (
    <label>
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CalendarEmpty() {
  return (
    <div className={styles.calendarEmpty}>
      <p className={styles.kicker}>Open calendar</p>
      <h2>No scheduled records match.</h2>
      <p>Change the date or clear filters. No placeholder event has been added.</p>
    </div>
  );
}

function groupByDate(entries: readonly OrganizerCalendarEntry[]) {
  const groups = new Map<string, OrganizerCalendarEntry[]>();
  for (const entry of entries) {
    const existing = groups.get(entry.dateKey) ?? [];
    existing.push(entry);
    groups.set(entry.dateKey, existing);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function parseDateKey(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return new Date(Date.UTC(1970, 0, 1));
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
}

function dateKey(value: Date): string {
  return [
    value.getUTCFullYear().toString().padStart(4, "0"),
    (value.getUTCMonth() + 1).toString().padStart(2, "0"),
    value.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

function shiftDate(value: string, days: number): string {
  const date = parseDateKey(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

export function shiftMonth(value: string, months: number): string {
  const date = parseDateKey(value);
  const preferredDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const daysInTarget = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(preferredDay, daysInTarget));
  return dateKey(date);
}

function startOfWeek(value: string): string {
  const date = parseDateKey(value);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return dateKey(date);
}

function formatDate(value: string, style: "compact" | "full"): string {
  const date = parseDateKey(value);
  return new Intl.DateTimeFormat("en-CA", {
    day: "numeric",
    month: style === "full" ? "long" : "short",
    timeZone: "UTC",
    weekday: "short",
    ...(style === "full" ? { year: "numeric" as const } : {}),
  }).format(date);
}

function rangeLabel(value: string, view: CalendarView): string {
  if (view === "month") {
    return new Intl.DateTimeFormat("en-CA", {
      month: "long",
      timeZone: "UTC",
      year: "numeric",
    }).format(parseDateKey(value));
  }
  if (view === "week") {
    const start = startOfWeek(value);
    return `${formatDate(start, "compact")} – ${formatDate(shiftDate(start, 6), "compact")}`;
  }
  return formatDate(value, "full");
}

function monthCells(value: string): readonly Readonly<{ date: string; inMonth: boolean }>[] {
  const selected = parseDateKey(value);
  const month = selected.getUTCMonth();
  const first = new Date(Date.UTC(selected.getUTCFullYear(), month, 1));
  first.setUTCDate(first.getUTCDate() - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const cell = new Date(first);
    cell.setUTCDate(first.getUTCDate() + index);
    return Object.freeze({ date: dateKey(cell), inMonth: cell.getUTCMonth() === month });
  });
}

function dayNumber(value: string): number {
  return parseDateKey(value).getUTCDate();
}

function todayInZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date());
  const record = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${record.year}-${record.month}-${record.day}`;
}

function viewStep(view: CalendarView): number {
  if (view === "day") return 1;
  if (view === "week") return 7;
  return 7;
}

function statusLabel(value: OrganizerCalendarEntry["planningStatus"]): string {
  return value.replace("_", " ");
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function sourceLabel(source: OrganizerCalendarEntry["source"]): string {
  if (source === "meetup") return "Meetup · read-only";
  if (source === "legacy") return "Existing event · read-only";
  return "Manual · private";
}

function subscribeToView(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(VIEW_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(VIEW_CHANGE_EVENT, onStoreChange);
  };
}

function readStoredView(): CalendarView {
  const remembered = window.localStorage.getItem(VIEW_STORAGE_KEY);
  return VIEW_VALUES.some((value) => value === remembered)
    ? (remembered as CalendarView)
    : "agenda";
}

function subscribeToFilters(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(FILTER_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(FILTER_CHANGE_EVENT, onStoreChange);
  };
}

function readStoredFilterSnapshot(): string {
  return window.localStorage.getItem(FILTER_STORAGE_KEY) ?? "{}";
}

export function parseStoredFilters(snapshot: string): CalendarFilters {
  let candidate: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(snapshot);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      candidate = parsed as Record<string, unknown>;
    }
  } catch {
    return EMPTY_FILTERS;
  }
  return Object.freeze({
    category: boundedIdentifier(candidate.category),
    club: boundedIdentifier(candidate.club),
    dateFrom: validDateKey(candidate.dateFrom),
    dateTo: validDateKey(candidate.dateTo),
    lane: boundedIdentifier(candidate.lane),
    organizer: boundedIdentifier(candidate.organizer),
    planning: allowedValue(candidate.planning, PLANNING_VALUES),
    publication: allowedValue(candidate.publication, PUBLICATION_VALUES),
    search:
      typeof candidate.search === "string"
        ? candidate.search.slice(0, 120)
        : "",
    source: allowedValue(candidate.source, SOURCE_VALUES),
  });
}

function boundedIdentifier(value: unknown): string {
  return typeof value === "string" &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]*$/u.test(value)
    ? value
    : "";
}

function validDateKey(value: unknown): string {
  if (value === "") return "";
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value)
  ) {
    return "";
  }
  return dateKey(parseDateKey(value)) === value ? value : "";
}

function allowedValue<T extends string>(
  value: unknown,
  values: readonly T[],
): T | "" {
  return typeof value === "string" &&
    values.some((candidate) => candidate === value)
    ? (value as T)
    : "";
}
