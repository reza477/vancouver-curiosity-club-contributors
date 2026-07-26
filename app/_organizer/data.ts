import "server-only";

import {
  getMeetupConnectionState,
} from "@/lib/server/meetup";
import type {
  OrganizerEventDto,
  OrganizerEventIndexQuery,
} from "@/lib/server/organizer/events";
import {
  listOrganizerEvents,
  queryOrganizerEventIndex,
} from "@/lib/server/organizer/events";
import {
  listOrganizerCalendarEvents,
  type OrganizerCalendarEventDto,
} from "@/lib/server/organizer/calendar";
import { listOrganizerClubs } from "@/lib/server/organizer/clubs";
import { getOrganizerProfile } from "@/lib/server/organizer/profiles";
import { listTeamMembers } from "@/lib/server/organizer/team";
import type {
  DashboardItem,
  OrganizerDashboardData,
} from "./Dashboard";
import type { EventEditorValue } from "./event-editor-state";
import type {
  OrganizerCalendarEntry,
  OrganizerEventFormOptions,
  OrganizerEventSummary,
  OrganizerOption,
  OrganizerPageContext,
} from "./types";
import { organizerScheduleIsCurrent } from "@/lib/server/organizer/schedule-state";
import { parseFiniteInteger } from "@/lib/validation";

export async function loadOrganizerDashboard(
  context: OrganizerPageContext,
): Promise<OrganizerDashboardData> {
  const [calendar, manualEvents, profile, meetup] = await Promise.all([
    listOrganizerCalendarEvents(context.database, context.identity, {
      limit: 200,
    }),
    listOrganizerEvents(context.database, context.identity, {
      includeDeleted: false,
      limit: 100,
    }),
    getOrganizerProfile(context.database, context.identity),
    getMeetupConnectionState(context.database, context.identity),
  ]);
  const now = Date.now();
  const scheduledDrafts = calendar.scheduled
    .filter(
      (event) =>
        event.planningStatus === "draft" &&
        event.publicationStatus === "private" &&
        organizerScheduleIsCurrent(event.schedule, now),
    )
    .slice(0, 6)
    .map(calendarDashboardItem);
  const unscheduledIdeas = calendar.ideas
    .filter((event) => event.planningStatus === "idea")
    .slice(0, 6)
    .map(calendarDashboardItem);
  const attentionDrafts = manualEvents
    .filter(
      (event) =>
        event.planningStatus === "draft" &&
        (event.summary === null || event.description === null),
    )
    .slice(0, 6)
    .map((event) =>
      manualDashboardItem(
        event,
        event.summary === null
          ? "Draft summary not recorded"
          : "Draft description not recorded",
      ),
    );
  const recentChanges = manualEvents
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 6)
    .map((event) =>
      manualDashboardItem(
        event,
        `Updated ${formatDateTime(event.updatedAt, context.defaultTimezone)}`,
      ),
    );

  return Object.freeze({
    assignedClubs: profile.assignedClubs,
    attentionDrafts,
    meetup: meetupDashboardState(meetup),
    recentChanges,
    scheduledDrafts,
    unscheduledIdeas,
  });
}

export async function loadCalendarWorkspaceData(
  context: OrganizerPageContext,
  takeValue: unknown = 500,
): Promise<Readonly<{
  entries: readonly OrganizerCalendarEntry[];
  filterOptions: Readonly<{
    categories: readonly OrganizerOption[];
    clubs: readonly OrganizerOption[];
    lanes: readonly OrganizerOption[];
    organizers: readonly OrganizerOption[];
  }>;
  defaultTimezone: string;
  hasMore: boolean;
  initialDate: string;
  loadedCount: number;
  nextTake: number | null;
  resultCount: number;
}>> {
  const take = parseOrganizerTake(takeValue);
  const [result, clubs, teams, taxonomy] = await Promise.all([
    listOrganizerCalendarEvents(context.database, context.identity, {
      limit: take,
    }),
    listOrganizerClubs(context.database, context.identity),
    listTeamMembers(context.database, context.identity),
    loadTaxonomyOptions(context),
  ]);
  const teamByProfile = new Map(
    teams.map((member) => [member.profileId, member]),
  );
  const laneById = new Map(taxonomy.lanes.map((lane) => [lane.id, lane.label]));
  const categoryById = new Map(
    taxonomy.categories.map((category) => [category.id, category.label]),
  );
  return Object.freeze({
    defaultTimezone: context.defaultTimezone,
    entries: Object.freeze(
      result.events.map((event) =>
        calendarEntry(
          event,
          teamByProfile.get(event.primaryOrganizerProfileId ?? ""),
          laneById,
          categoryById,
        ),
      ),
    ),
    filterOptions: Object.freeze({
      categories: taxonomy.categories,
      clubs: Object.freeze(
        clubs.map((club) => Object.freeze({ id: club.id, label: club.name })),
      ),
      lanes: taxonomy.lanes,
      organizers: Object.freeze(
        teams
          .filter((member) => member.status === "active")
          .map((member) =>
            Object.freeze({ id: member.profileId, label: member.displayName }),
          ),
      ),
    }),
    hasMore: result.hasMore,
    initialDate: dateKeyInZone(Date.now(), context.defaultTimezone),
    loadedCount: result.loadedCount,
    nextTake: result.nextLimit,
    resultCount: result.resultCount,
  });
}

export async function loadEventIndexData(
  context: OrganizerPageContext,
  query: OrganizerEventIndexQuery = {},
): Promise<Readonly<{
  events: readonly OrganizerEventSummary[];
  firstResult: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  lastResult: number;
  page: number;
  search: string;
  status: "active" | "deleted" | "draft" | "idea";
  totalCount: number;
}>> {
  const [eventPage, clubs] = await Promise.all([
    queryOrganizerEventIndex(context.database, context.identity, query),
    listOrganizerClubs(context.database, context.identity),
  ]);
  const clubNames = new Map(clubs.map((club) => [club.id, club.name]));
  return Object.freeze({
    events: Object.freeze(
      eventPage.events.map((event) =>
        Object.freeze({
          clubName: clubNames.get(event.clubId) ?? "Unavailable club",
          deleted: event.deletedAt !== null,
          id: event.id,
          planningStatus: event.planningStatus,
          publicationStatus: event.publicationStatus,
          scheduleLabel: scheduleLabel(event.schedule),
          title: event.title,
          updatedAtLabel: formatDateTime(
            event.updatedAt,
            event.schedule.timeZone,
          ),
        }),
      ),
    ),
    firstResult: eventPage.firstResult,
    hasNextPage: eventPage.hasNextPage,
    hasPreviousPage: eventPage.hasPreviousPage,
    lastResult: eventPage.lastResult,
    page: eventPage.page,
    search: eventPage.search,
    status: eventPage.status,
    totalCount: eventPage.totalCount,
  });
}

export async function loadEventFormOptions(
  context: OrganizerPageContext,
): Promise<OrganizerEventFormOptions> {
  const [clubs, team, taxonomy] = await Promise.all([
    listOrganizerClubs(context.database, context.identity),
    listTeamMembers(context.database, context.identity),
    loadTaxonomyOptions(context),
  ]);
  const clubIds = clubs.map((club) => club.id);
  const programs = await loadPrograms(context, clubIds);
  return Object.freeze({
    categories: taxonomy.categories,
    clubs: Object.freeze(
      clubs.map((club) => Object.freeze({ id: club.id, label: club.name })),
    ),
    lanes: taxonomy.lanes,
    organizers: Object.freeze(
      team
        .filter((member) => member.status === "active")
        .map((member) =>
          Object.freeze({
            clubs: Object.freeze(member.clubs.map((club) => club.id)),
            id: member.profileId,
            label: member.displayName,
            organizationWide:
              member.role === "owner" || member.role === "administrator",
          }),
        ),
    ),
    programs,
  });
}

export function emptyEventValue(
  defaultOrganizerProfileId: string,
  timezone = "America/Vancouver",
): EventEditorValue {
  return {
    allDayEndDateExclusive: "",
    allDayStartDate: "",
    categoryId: "",
    cleanupBufferMinutes: 0,
    clubId: "",
    coOrganizerProfileIds: [],
    endDate: "",
    endTime: "",
    expectedEditVersion: null,
    internalNotes: "",
    laneId: "",
    meetupEventUrl: "",
    planningStatus: "idea",
    primaryOrganizerProfileId: defaultOrganizerProfileId,
    privateMeetingDetails: null,
    programId: "",
    publicDescription: "",
    publicSummary: "",
    scheduleShape: "unscheduled",
    setupBufferMinutes: 0,
    startDate: "",
    startTime: "",
    timezone,
    title: "",
    venueId: null,
  };
}

export function eventEditorValue(event: OrganizerEventDto): EventEditorValue {
  const timed =
    event.schedule.shape === "timed"
      ? localTimedFields(
          event.schedule.startsAtUtc,
          event.schedule.endsAtUtc,
          event.schedule.timeZone,
        )
      : { endDate: "", endTime: "", startDate: "", startTime: "" };
  return {
    allDayEndDateExclusive:
      event.schedule.shape === "all_day"
        ? event.schedule.allDayEndDateExclusive
        : "",
    allDayStartDate:
      event.schedule.shape === "all_day"
        ? event.schedule.allDayStartDate
        : "",
    categoryId: event.categoryId ?? "",
    cleanupBufferMinutes: event.bufferAfterMinutes,
    clubId: event.clubId,
    coOrganizerProfileIds: event.coOrganizerProfileIds,
    endDate: timed.endDate,
    endTime: timed.endTime,
    expectedEditVersion: event.contentVersion,
    internalNotes: event.privateNotes ?? "",
    laneId: event.eventLaneId ?? "",
    meetupEventUrl: event.meetupEventUrl ?? "",
    planningStatus: event.planningStatus,
    primaryOrganizerProfileId: event.primaryOrganizerProfileId,
    privateMeetingDetails: event.privateMeetingDetails,
    programId: event.programId ?? "",
    publicDescription: event.description ?? "",
    publicSummary: event.summary ?? "",
    scheduleShape: event.schedule.shape,
    setupBufferMinutes: event.bufferBeforeMinutes,
    startDate: timed.startDate,
    startTime: timed.startTime,
    timezone: event.schedule.timeZone,
    title: event.title,
    venueId: event.venueId,
  };
}

async function loadTaxonomyOptions(context: OrganizerPageContext) {
  const [lanes, categories] = await Promise.all([
    context.database
      .prepare(
        `SELECT id, name
         FROM event_lanes
         WHERE organization_id = ?
           AND deleted_at IS NULL
         ORDER BY sort_order ASC, name COLLATE NOCASE ASC
         LIMIT 100`,
      )
      .bind(context.membership.organizationId)
      .all<Record<string, unknown>>(),
    context.database
      .prepare(
        `SELECT id, name
         FROM categories
         WHERE organization_id = ?
           AND deleted_at IS NULL
         ORDER BY name COLLATE NOCASE ASC
         LIMIT 250`,
      )
      .bind(context.membership.organizationId)
      .all<Record<string, unknown>>(),
  ]);
  return Object.freeze({
    categories: rowsToOptions(categories.results ?? []),
    lanes: rowsToOptions(lanes.results ?? []),
  });
}

async function loadPrograms(
  context: OrganizerPageContext,
  clubIds: readonly string[],
) {
  if (clubIds.length === 0) return Object.freeze([]);
  const placeholders = clubIds.map(() => "?").join(", ");
  const result = await context.database
    .prepare(
      `SELECT id, name, club_id
       FROM programs
       WHERE organization_id = ?
         AND club_id IN (${placeholders})
         AND deleted_at IS NULL
       ORDER BY name COLLATE NOCASE ASC
       LIMIT 250`,
    )
    .bind(context.membership.organizationId, ...clubIds)
    .all<Record<string, unknown>>();
  return Object.freeze(
    (result.results ?? [])
      .map((row) => {
        const id = readString(row.id);
        const label = readString(row.name);
        const clubId = readString(row.club_id);
        return id && label && clubId
          ? Object.freeze({ clubId, id, label })
          : null;
      })
      .filter(
        (
          value,
        ): value is Readonly<{ clubId: string; id: string; label: string }> =>
          value !== null,
      ),
  );
}

function rowsToOptions(
  rows: readonly Record<string, unknown>[],
): readonly OrganizerOption[] {
  return Object.freeze(
    rows
      .map((row) => {
        const id = readString(row.id);
        const label = readString(row.name);
        return id && label ? Object.freeze({ id, label }) : null;
      })
      .filter((value): value is OrganizerOption => value !== null),
  );
}

function calendarEntry(
  event: OrganizerCalendarEventDto,
  member:
    | Readonly<{
        calendarColor: string;
        displayName: string;
        initials: string;
        profileId: string;
      }>
    | undefined,
  laneById: ReadonlyMap<string, string>,
  categoryById: ReadonlyMap<string, string>,
): OrganizerCalendarEntry {
  const schedule = calendarSchedule(event.schedule);
  const organizerName =
    member?.displayName ??
    event.primaryOrganizerDisplayName ??
    "No organizer assigned";
  return Object.freeze({
    allDay: event.schedule.shape === "all_day",
    category: event.categoryId
      ? Object.freeze({
          id: event.categoryId,
          name: categoryById.get(event.categoryId) ?? "Category",
        })
      : null,
    club: Object.freeze({ id: event.clubId, name: event.clubName }),
    dateKey: schedule.startDate,
    endDateKey: schedule.endDate,
    fullScheduleLabel: schedule.fullLabel,
    id: event.id,
    lane: event.eventLaneId
      ? Object.freeze({
          id: event.eventLaneId,
          name: laneById.get(event.eventLaneId) ?? "Lane",
        })
      : null,
    organizer: Object.freeze({
      color: calendarColor(member?.calendarColor),
      displayName: organizerName,
      id: event.primaryOrganizerProfileId ?? "",
      initials: member?.initials ?? initials(organizerName),
    }),
    organizerIds: Object.freeze(
      [
        event.primaryOrganizerProfileId,
        ...event.coOrganizerProfileIds,
      ].filter((profileId): profileId is string => profileId !== null),
    ),
    planningStatus: event.planningStatus,
    publicationStatus: event.publicationStatus,
    readOnly: event.readOnly || event.source !== "manual",
    source: event.source,
    sourceUrl: event.meetupEventUrl,
    timeLabel: schedule.timeLabel,
    title: event.title,
  });
}

function calendarSchedule(schedule: OrganizerCalendarEventDto["schedule"]) {
  if (schedule.shape === "unscheduled") {
    return {
      endDate: "",
      fullLabel: "Unscheduled Idea",
      startDate: "",
      timeLabel: "Unscheduled",
    };
  }
  if (schedule.shape === "all_day") {
    const endDate = shiftCalendarDate(schedule.allDayEndDateExclusive, -1);
    const fullLabel =
      schedule.allDayStartDate === endDate
        ? `${formatCalendarDate(schedule.allDayStartDate)} · All day`
        : `${formatCalendarDate(schedule.allDayStartDate)} through ${formatCalendarDate(endDate)} · All day`;
    return {
      endDate,
      fullLabel,
      startDate: schedule.allDayStartDate,
      timeLabel: "All day",
    };
  }
  const startDate = dateKeyInZone(schedule.startsAtUtc, schedule.timeZone);
  const endDate = dateKeyInZone(schedule.endsAtUtc - 1, schedule.timeZone);
  const startTime = timeInZone(schedule.startsAtUtc, schedule.timeZone);
  const endTime = timeInZone(schedule.endsAtUtc, schedule.timeZone);
  return {
    endDate,
    fullLabel: `${formatCalendarDate(startDate)} · ${startTime}–${endTime} (${schedule.timeZone})`,
    startDate,
    timeLabel: `${startTime}–${endTime}`,
  };
}

function calendarDashboardItem(event: OrganizerCalendarEventDto): DashboardItem {
  return Object.freeze({
    clubName: event.clubName,
    href: `/organizer/events/${encodeURIComponent(event.id)}`,
    id: event.id,
    meta: scheduleLabel(event.schedule),
    title: event.title,
  });
}

function manualDashboardItem(
  event: OrganizerEventDto,
  meta: string,
): DashboardItem {
  return Object.freeze({
    href: `/organizer/events/${encodeURIComponent(event.id)}`,
    id: event.id,
    meta,
    title: event.title,
  });
}

function meetupDashboardState(
  state: Awaited<ReturnType<typeof getMeetupConnectionState>>,
): OrganizerDashboardData["meetup"] {
  if (state.status === "not_connected") {
    return {
      detail: "No official Meetup feed is connected.",
      status: "not_connected",
    };
  }
  if (state.status === "current") {
    return {
      detail: "The latest aggregate official-feed refresh completed successfully.",
      status: "current",
    };
  }
  if (state.status === "stale") {
    return {
      detail: "A newer successful refresh is due; the last completed snapshot remains available.",
      status: "stale",
    };
  }
  if (
    state.status === "partial" ||
    state.status === "refreshing" ||
    state.status === "pending"
  ) {
    return {
      detail: "A bounded refresh generation is incomplete; the prior completed snapshot remains visible.",
      status: "partial",
    };
  }
  return {
    detail:
      state.status === "disabled"
        ? "Official-feed refresh is disabled."
        : "The latest refresh did not complete; no raw source error or feed address is shown.",
    status: state.status === "disabled" ? "stale" : "error",
  };
}

function scheduleLabel(
  schedule: OrganizerEventDto["schedule"] | OrganizerCalendarEventDto["schedule"],
): string {
  return calendarSchedule(schedule).fullLabel;
}

function localTimedFields(
  startsAtUtc: number,
  endsAtUtc: number,
  timeZone: string,
) {
  return {
    endDate: dateKeyInZone(endsAtUtc, timeZone),
    endTime: time24InZone(endsAtUtc, timeZone),
    startDate: dateKeyInZone(startsAtUtc, timeZone),
    startTime: time24InZone(startsAtUtc, timeZone),
  };
}

function dateKeyInZone(value: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const record = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${record.year}-${record.month}-${record.day}`;
}

function timeInZone(value: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function time24InZone(value: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone,
  }).formatToParts(new Date(value));
  const record = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${record.hour}:${record.minute}`;
}

function formatDateTime(value: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function formatCalendarDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "full",
    timeZone: "UTC",
  }).format(date);
}

function shiftCalendarDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

function calendarColor(value: string | undefined): string {
  const colors: Record<string, string> = {
    amber: "#8b560f",
    cobalt: "#164cb5",
    coral: "#a64637",
    forest: "#0a554f",
    plum: "#704a78",
    teal: "#19726d",
  };
  return value ? (colors[value] ?? "#5b6664") : "#5b6664";
}

function initials(value: string): string {
  return value
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.slice(0, 1).toUpperCase())
    .join("") || "—";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseOrganizerTake(value: unknown): number {
  const candidate =
    typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value)
      ? Number(value)
      : value;
  return parseFiniteInteger(candidate, {
    path: "take",
    minimum: 1,
    maximum: 5_000,
  });
}
