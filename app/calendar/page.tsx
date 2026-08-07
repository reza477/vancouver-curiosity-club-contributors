import type { Metadata } from "next";
import Link from "next/link";
import { PublicMonthCalendar } from "@/app/_components/PublicMonthCalendar";
import { buildEditorialMetadata } from "@/app/_components/EditorialPage";
import {
  isPublicCalendarEventUpcoming,
  publicCalendarMonthBounds,
  publicEventCalendarStartDate,
  resolvePublicCalendarLandingMonth,
  resolvePublicCalendarMonth,
} from "@/lib/public-calendar";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import { getRequestPublicOrganization } from "@/lib/server/public/request-cache";
import { vancouverCalendarDate } from "@/lib/server/public/date";
import {
  queryPublicCalendarMonth,
  queryPublicEventSlice,
  type PublicEventCardDto,
} from "@/lib/server/public/events";
import { getTrustedRequestOrigin } from "@/lib/server/public/origin";
import { publicServiceUnavailable } from "@/lib/server/public/service-failure";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export async function generateMetadata({
  searchParams,
}: Readonly<{ searchParams: PageSearchParams }>): Promise<Metadata> {
  const params = await searchParams;
  const metadata = await buildEditorialMetadata({
    fallbackTitle: "Calendar",
    path: "/calendar",
    route: "/calendar",
    slug: "events",
  });
  const title = "Calendar";
  const description =
    "Browse Vancouver Curiosity Club events in a month-at-a-glance calendar.";
  const calendarMetadata: Metadata = {
    ...metadata,
    title,
    description,
    openGraph: metadata.openGraph
      ? { ...metadata.openGraph, title, description }
      : undefined,
    twitter: metadata.twitter
      ? { ...metadata.twitter, title, description }
      : undefined,
  };
  return Object.keys(params).length === 0
    ? calendarMetadata
    : {
        ...calendarMetadata,
        robots: {
          index: false,
          follow: true,
          noarchive: true,
        },
      };
}

export default async function CalendarPage({
  searchParams,
}: Readonly<{ searchParams: PageSearchParams }>) {
  const raw = await searchParams;
  const nowUtcMs = readServerUtcMs();
  const todayDate = vancouverCalendarDate(nowUtcMs);
  let resolvedMonth = resolvePublicCalendarMonth(raw.month, todayDate);
  const origin = await getTrustedRequestOrigin();
  let events: readonly PublicEventCardDto[] = [];
  let hasMore = false;

  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await getRequestPublicOrganization(database);
    if (organization) {
      let loadedMonth:
        | Awaited<ReturnType<typeof queryPublicCalendarMonth>>
        | null = null;
      if (raw.month === undefined) {
        const currentBounds = publicCalendarMonthBounds(
          resolvedMonth.month,
        );
        loadedMonth = await queryPublicCalendarMonth(database, {
          organizationId: organization.id,
          nowUtcMs,
          todayDate,
          fromDate: currentBounds.startDate,
          toDate: currentBounds.endDate,
        });
        const currentMonthUpcoming = loadedMonth.events.find((event) =>
          isPublicCalendarEventUpcoming(event, nowUtcMs, todayDate),
        );
        const firstUpcomingDate = currentMonthUpcoming
          ? publicEventCalendarStartDate(currentMonthUpcoming)
          : await queryPublicEventSlice(database, {
              organizationId: organization.id,
              nowUtcMs,
              todayDate,
              view: "upcoming",
              page: 1,
              pageSize: 1,
            }).then((page) =>
              page.events[0]
                ? publicEventCalendarStartDate(page.events[0])
                : null,
            );
        resolvedMonth = resolvePublicCalendarLandingMonth(
          raw.month,
          todayDate,
          firstUpcomingDate,
        );
        if (resolvedMonth.month === todayDate.slice(0, 7)) {
          events = mergeCalendarEvents([], loadedMonth.events);
          hasMore = loadedMonth.hasMore;
        } else {
          loadedMonth = null;
        }
      }
      if (loadedMonth === null) {
        const bounds = publicCalendarMonthBounds(resolvedMonth.month);
        loadedMonth = await queryPublicCalendarMonth(database, {
          organizationId: organization.id,
          nowUtcMs,
          todayDate,
          fromDate: bounds.startDate,
          toDate: bounds.endDate,
        });
        events = mergeCalendarEvents([], loadedMonth.events);
        hasMore = loadedMonth.hasMore;
      }
    }
  } catch {
    writeSafeLog("error", "public_calendar_unavailable", {
      code: "service_unavailable",
      operation: "list_public_calendar",
      route: "/calendar",
      status: 503,
    });
    publicServiceUnavailable();
  }

  return (
    <main className="public-page public-calendar-page">
      {resolvedMonth.invalid ? (
        <div className="calendar-notice" role="alert">
          That month is outside the available calendar window. The
          current month is shown instead.
        </div>
      ) : null}
      {raw.month === undefined &&
      resolvedMonth.month !== todayDate.slice(0, 7) ? (
        <div className="calendar-notice" role="status">
          Showing the nearest month with a published upcoming event. Choose
          Today to return to the current month.
        </div>
      ) : null}
      {hasMore ? (
        <div className="calendar-notice" role="status">
          This month contains more published events than one calendar page can
          safely load.
        </div>
      ) : null}

      <nav
        aria-label="Event views"
        className="calendar-view-switcher event-view-switcher"
      >
        <Link href="/events">List</Link>
        <Link aria-current="page" href="/calendar">
          Month
        </Link>
      </nav>

      <PublicMonthCalendar
        complete={!hasMore}
        events={events}
        key={resolvedMonth.month}
        maxMonth={resolvedMonth.maxMonth}
        minMonth={resolvedMonth.minMonth}
        month={resolvedMonth.month}
        nowUtcMs={nowUtcMs}
        siteOrigin={origin?.origin ?? null}
        todayDate={todayDate}
      />

      <nav
        aria-label="Download upcoming public events"
        className="calendar-download-actions public-export-actions"
      >
        <span>Download upcoming events</span>
        <Link href="/events/calendar.ics">iCalendar (.ics)</Link>
        <Link href="/events/events.csv">Spreadsheet (.csv)</Link>
      </nav>
    </main>
  );
}

function mergeCalendarEvents(
  past: readonly PublicEventCardDto[],
  upcoming: readonly PublicEventCardDto[],
): readonly PublicEventCardDto[] {
  const bySlug = new Map<string, PublicEventCardDto>();
  for (const event of [...past, ...upcoming]) bySlug.set(event.slug, event);
  return Object.freeze(
    [...bySlug.values()].sort((left, right) => {
      const dateOrder = publicEventCalendarStartDate(left).localeCompare(
        publicEventCalendarStartDate(right),
      );
      if (dateOrder !== 0) return dateOrder;
      return left.title.localeCompare(right.title, "en-CA");
    }),
  );
}
