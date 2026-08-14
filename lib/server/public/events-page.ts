import { resolvePublicCalendarMonth } from "@/lib/public-calendar";
import type { D1DatabaseLike } from "@/lib/server/auth";
import {
  readPublicEventsPageMaterialization,
} from "@/lib/server/public/event-materializations";
import type { PublicMonthCalendarData } from "@/lib/server/public/month-calendar";

export type LoadPublicEventsPageDataInput = Readonly<{
  cacheOrigin?: string | null;
  laneSlug?: unknown;
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
 * Visitor-only Events loader. It performs one indexed durable read and never
 * projects events, contacts Meetup, or writes a replacement on a miss.
 */
export async function loadPublicEventsPageData(
  database: Pick<D1DatabaseLike, "prepare">,
  input: LoadPublicEventsPageDataInput,
): Promise<PublicEventsPageData> {
  const materialized = await readPublicEventsPageMaterialization(
    database,
    input,
  );
  if (materialized) return materialized;

  return Object.freeze({
    calendar: Object.freeze({
      events: Object.freeze([]),
      hasMore: false,
      resolvedMonth: resolvePublicCalendarMonth(
        input.rawMonth,
        input.todayDate,
      ),
      shiftedToUpcoming: false,
    }),
    calendarAvailable: false,
  });
}
