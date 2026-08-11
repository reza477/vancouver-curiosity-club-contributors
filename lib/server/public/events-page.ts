import {
  isPublicCalendarEventUpcoming,
  publicCalendarMonthBounds,
  publicEventCalendarStartDate,
  resolvePublicCalendarLandingMonth,
  resolvePublicCalendarMonth,
} from "@/lib/public-calendar";
import type { D1DatabaseLike } from "@/lib/server/auth";
import {
  queryPublicCalendarLandingBundle,
  queryPublicCalendarMonth,
  queryPublicEventSlice,
} from "@/lib/server/public/events";
import type { PublicMonthCalendarData } from "@/lib/server/public/month-calendar";
import { writeSafeLog } from "@/lib/validation/server-observability";

type PublicEventsPageDatabase = Pick<D1DatabaseLike, "prepare">;

export type LoadPublicEventsPageDataInput = Readonly<{
  nowUtcMs: number;
  organizationId: string;
  rawMonth: unknown;
  todayDate: string;
}>;

export type PublicEventsPageData = Readonly<{
  calendar: PublicMonthCalendarData;
  calendarAvailable: boolean;
}>;

/**
 * Loads the Events calendar and its nearest-upcoming landing hint through one
 * bounded public-event projection. The standalone reads remain a failure-only
 * fallback, and a failed optional landing lookup never discards a month that
 * was already read successfully.
 */
export async function loadPublicEventsPageData(
  database: PublicEventsPageDatabase,
  input: LoadPublicEventsPageDataInput,
): Promise<PublicEventsPageData> {
  try {
    return await loadBundledEventsCalendar(database, input);
  } catch {
    writeSafeLog("warn", "public_events_bundle_unavailable", {
      code: "partial_failure",
      operation: "read_public_events_bundle",
      route: "/events",
      status: 200,
    });
  }

  try {
    return Object.freeze({
      calendar: await loadIndependentEventsCalendar(database, input),
      calendarAvailable: true,
    });
  } catch {
    writeSafeLog("error", "public_event_calendar_unavailable", {
      code: "service_unavailable",
      operation: "read_public_event_calendar",
      route: "/events",
      status: 503,
    });
    throw new Error("The public event calendar is unavailable.");
  }
}

async function loadBundledEventsCalendar(
  database: PublicEventsPageDatabase,
  input: LoadPublicEventsPageDataInput,
): Promise<PublicEventsPageData> {
  const initialResolvedMonth = resolvePublicCalendarMonth(
    input.rawMonth,
    input.todayDate,
  );
  const initialBounds = publicCalendarMonthBounds(
    initialResolvedMonth.month,
  );
  const bundled = await queryPublicCalendarLandingBundle(database, {
    calendar: {
      fromDate: initialBounds.startDate,
      nowUtcMs: input.nowUtcMs,
      organizationId: input.organizationId,
      todayDate: input.todayDate,
      toDate: initialBounds.endDate,
    },
    includeLandingEvent: input.rawMonth === undefined,
  });
  let loadedMonth = bundled.calendar;
  let resolvedMonth = initialResolvedMonth;
  let shiftedToUpcoming = false;

  if (input.rawMonth === undefined) {
    const currentMonthUpcoming = loadedMonth.events.find((event) =>
      isPublicCalendarEventUpcoming(
        event,
        input.nowUtcMs,
        input.todayDate,
      ),
    );
    const landingEvent = currentMonthUpcoming ?? bundled.landingEvent;
    const landingMonth = resolvePublicCalendarLandingMonth(
      input.rawMonth,
      input.todayDate,
      landingEvent ? publicEventCalendarStartDate(landingEvent) : null,
    );
    if (landingMonth.month !== initialResolvedMonth.month) {
      try {
        const shiftedBounds = publicCalendarMonthBounds(landingMonth.month);
        loadedMonth = await queryPublicCalendarMonth(database, {
          fromDate: shiftedBounds.startDate,
          nowUtcMs: input.nowUtcMs,
          organizationId: input.organizationId,
          todayDate: input.todayDate,
          toDate: shiftedBounds.endDate,
        });
        resolvedMonth = landingMonth;
        shiftedToUpcoming = true;
      } catch {
        writeOptionalLandingFailure();
      }
    }
  }

  return Object.freeze({
    calendar: Object.freeze({
      events: loadedMonth.events,
      hasMore: loadedMonth.hasMore,
      resolvedMonth,
      shiftedToUpcoming,
    }),
    calendarAvailable: true,
  });
}

async function loadIndependentEventsCalendar(
  database: PublicEventsPageDatabase,
  input: LoadPublicEventsPageDataInput,
): Promise<PublicMonthCalendarData> {
  const initialResolvedMonth = resolvePublicCalendarMonth(
    input.rawMonth,
    input.todayDate,
  );
  const initialBounds = publicCalendarMonthBounds(
    initialResolvedMonth.month,
  );
  const initialMonth = await queryPublicCalendarMonth(database, {
    fromDate: initialBounds.startDate,
    nowUtcMs: input.nowUtcMs,
    organizationId: input.organizationId,
    todayDate: input.todayDate,
    toDate: initialBounds.endDate,
  });
  if (input.rawMonth !== undefined) {
    return calendarData(initialMonth, initialResolvedMonth, false);
  }

  const currentMonthUpcoming = initialMonth.events.find((event) =>
    isPublicCalendarEventUpcoming(
      event,
      input.nowUtcMs,
      input.todayDate,
    ),
  );
  if (currentMonthUpcoming) {
    return calendarData(initialMonth, initialResolvedMonth, false);
  }

  let landingDate: string | null = null;
  try {
    const landingPage = await queryPublicEventSlice(database, {
      nowUtcMs: input.nowUtcMs,
      organizationId: input.organizationId,
      page: 1,
      pageSize: 1,
      todayDate: input.todayDate,
      view: "upcoming",
    });
    landingDate = landingPage.events[0]
      ? publicEventCalendarStartDate(landingPage.events[0])
      : null;
  } catch {
    writeOptionalLandingFailure();
    return calendarData(initialMonth, initialResolvedMonth, false);
  }

  const landingMonth = resolvePublicCalendarLandingMonth(
    input.rawMonth,
    input.todayDate,
    landingDate,
  );
  if (landingMonth.month === initialResolvedMonth.month) {
    return calendarData(initialMonth, initialResolvedMonth, false);
  }

  try {
    const shiftedBounds = publicCalendarMonthBounds(landingMonth.month);
    const shiftedMonth = await queryPublicCalendarMonth(database, {
      fromDate: shiftedBounds.startDate,
      nowUtcMs: input.nowUtcMs,
      organizationId: input.organizationId,
      todayDate: input.todayDate,
      toDate: shiftedBounds.endDate,
    });
    return calendarData(shiftedMonth, landingMonth, true);
  } catch {
    writeOptionalLandingFailure();
    return calendarData(initialMonth, initialResolvedMonth, false);
  }
}

function calendarData(
  month: Readonly<{
    events: PublicMonthCalendarData["events"];
    hasMore: boolean;
  }>,
  resolvedMonth: PublicMonthCalendarData["resolvedMonth"],
  shiftedToUpcoming: boolean,
): PublicMonthCalendarData {
  return Object.freeze({
    events: month.events,
    hasMore: month.hasMore,
    resolvedMonth,
    shiftedToUpcoming,
  });
}

function writeOptionalLandingFailure(): void {
  writeSafeLog("warn", "public_event_calendar_landing_unavailable", {
    code: "partial_failure",
    operation: "resolve_public_event_calendar_landing",
    route: "/events",
    status: 200,
  });
}
