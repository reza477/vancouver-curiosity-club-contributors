import {
  isPublicCalendarEventUpcoming,
  publicCalendarMonthBounds,
  publicEventCalendarStartDate,
  resolvePublicCalendarLandingMonth,
  resolvePublicCalendarMonth,
  type ResolvedPublicCalendarMonth,
} from "@/lib/public-calendar";
import type { D1DatabaseLike } from "@/lib/server/auth";
import {
  queryPublicCalendarMonth,
  queryPublicEventSlice,
  type PublicEventCardDto,
} from "@/lib/server/public/events";

export type PublicMonthCalendarData = Readonly<{
  events: readonly PublicEventCardDto[];
  hasMore: boolean;
  resolvedMonth: ResolvedPublicCalendarMonth;
  shiftedToUpcoming: boolean;
}>;

type PublicCalendarDatabase = Pick<D1DatabaseLike, "prepare">;

export function emptyPublicMonthCalendar(
  rawMonth: unknown,
  todayDate: string,
): PublicMonthCalendarData {
  return Object.freeze({
    events: Object.freeze([]),
    hasMore: false,
    resolvedMonth: resolvePublicCalendarMonth(rawMonth, todayDate),
    shiftedToUpcoming: false,
  });
}

/**
 * Loads one complete public month and, on an unqualified landing request,
 * advances to the nearest month that actually contains an upcoming event.
 * Calendar and Events share this boundary so their month navigation cannot
 * drift or expose different public records.
 */
export async function loadPublicMonthCalendar(
  database: PublicCalendarDatabase,
  input: Readonly<{
    nowUtcMs: number;
    organizationId: string;
    rawMonth: unknown;
    todayDate: string;
  }>,
): Promise<PublicMonthCalendarData> {
  let resolvedMonth = resolvePublicCalendarMonth(
    input.rawMonth,
    input.todayDate,
  );
  let loadedMonth:
    | Awaited<ReturnType<typeof queryPublicCalendarMonth>>
    | null = null;

  if (input.rawMonth === undefined) {
    const currentBounds = publicCalendarMonthBounds(resolvedMonth.month);
    loadedMonth = await queryPublicCalendarMonth(database, {
      organizationId: input.organizationId,
      nowUtcMs: input.nowUtcMs,
      todayDate: input.todayDate,
      fromDate: currentBounds.startDate,
      toDate: currentBounds.endDate,
    });
    const currentMonthUpcoming = loadedMonth.events.find((event) =>
      isPublicCalendarEventUpcoming(
        event,
        input.nowUtcMs,
        input.todayDate,
      ),
    );
    const firstUpcomingDate = currentMonthUpcoming
      ? publicEventCalendarStartDate(currentMonthUpcoming)
      : await queryPublicEventSlice(database, {
          organizationId: input.organizationId,
          nowUtcMs: input.nowUtcMs,
          todayDate: input.todayDate,
          view: "upcoming",
          page: 1,
          pageSize: 1,
        }).then((page) =>
          page.events[0]
            ? publicEventCalendarStartDate(page.events[0])
            : null,
        );
    resolvedMonth = resolvePublicCalendarLandingMonth(
      input.rawMonth,
      input.todayDate,
      firstUpcomingDate,
    );
    if (resolvedMonth.month !== input.todayDate.slice(0, 7)) {
      loadedMonth = null;
    }
  }

  if (loadedMonth === null) {
    const bounds = publicCalendarMonthBounds(resolvedMonth.month);
    loadedMonth = await queryPublicCalendarMonth(database, {
      organizationId: input.organizationId,
      nowUtcMs: input.nowUtcMs,
      todayDate: input.todayDate,
      fromDate: bounds.startDate,
      toDate: bounds.endDate,
    });
  }

  return Object.freeze({
    events: loadedMonth.events,
    hasMore: loadedMonth.hasMore,
    resolvedMonth,
    shiftedToUpcoming:
      input.rawMonth === undefined &&
      resolvedMonth.month !== input.todayDate.slice(0, 7),
  });
}
