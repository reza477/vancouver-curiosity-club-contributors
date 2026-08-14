import { resolvePublicCalendarMonth } from "@/lib/public-calendar";
import type { D1DatabaseLike } from "@/lib/server/auth";
import {
  PUBLIC_EVENTS_PAGE_SIZE,
  readPublicEventsPageMaterialization,
} from "@/lib/server/public/event-materializations";
import type { PublicMonthCalendarData } from "@/lib/server/public/month-calendar";
import type { PublicEventCardDto } from "@/lib/server/public/events";

export type LoadPublicEventsPageDataInput = Readonly<{
  cacheOrigin?: string | null;
  clubSlug?: unknown;
  laneSlug?: unknown;
  nowUtcMs: number;
  organizationId: string;
  rawMonth: unknown;
  rawPage?: unknown;
  todayDate: string;
}>;

export type PublicEventsClubOption = Readonly<{
  name: string;
  slug: string;
}>;

export type PublicUpcomingEventsData = Readonly<{
  events: readonly PublicEventCardDto[];
  invalidPage: boolean;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}>;

export type PublicEventsPageData = Readonly<{
  activeClubSlug: string | null;
  calendar: PublicMonthCalendarData;
  calendarAvailable: boolean;
  clubOptions: readonly PublicEventsClubOption[];
  invalidClub: boolean;
  upcoming: PublicUpcomingEventsData;
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

  return emptyPublicEventsPageData(input);
}

export function emptyPublicEventsPageData(
  input: Pick<
    LoadPublicEventsPageDataInput,
    "clubSlug" | "rawMonth" | "rawPage" | "todayDate"
  >,
): PublicEventsPageData {
  return Object.freeze({
    activeClubSlug: null,
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
    clubOptions: Object.freeze([]),
    invalidClub:
      input.clubSlug !== undefined && input.clubSlug !== "",
    upcoming: emptyUpcomingEvents(input.rawPage),
  });
}

function emptyUpcomingEvents(rawPage: unknown): PublicUpcomingEventsData {
  const requestedPage = parseRequestedPage(rawPage);
  return Object.freeze({
    events: Object.freeze([]),
    invalidPage: requestedPage.invalid || requestedPage.page !== 1,
    page: 1,
    pageSize: PUBLIC_EVENTS_PAGE_SIZE,
    totalCount: 0,
    totalPages: 1,
  });
}

function parseRequestedPage(value: unknown): Readonly<{
  invalid: boolean;
  page: number;
}> {
  if (value === undefined || value === "") {
    return Object.freeze({ invalid: false, page: 1 });
  }
  if (typeof value !== "string" || !/^[1-9]\d{0,4}$/u.test(value)) {
    return Object.freeze({ invalid: true, page: 1 });
  }
  return Object.freeze({ invalid: false, page: Number(value) });
}
