import type { Metadata } from "next";
import Link from "next/link";
import { PublicMonthCalendar } from "@/app/_components/PublicMonthCalendar";
import { buildEditorialMetadata } from "@/app/_components/EditorialPage";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import { getRequestPublicOrganization } from "@/lib/server/public/request-cache";
import { vancouverCalendarDate } from "@/lib/server/public/date";
import {
  emptyPublicMonthCalendar,
  loadPublicMonthCalendar,
} from "@/lib/server/public/month-calendar";
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
  const originPromise = getTrustedRequestOrigin();
  let calendar = emptyPublicMonthCalendar(raw.month, todayDate);

  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await getRequestPublicOrganization(database);
    if (organization) {
      calendar = await loadPublicMonthCalendar(database, {
        organizationId: organization.id,
        nowUtcMs,
        rawMonth: raw.month,
        todayDate,
      });
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
  const origin = await originPromise;

  return (
    <main className="public-page public-calendar-page">
      {calendar.resolvedMonth.invalid ? (
        <div className="calendar-notice" role="alert">
          That month is outside the available calendar window. The
          current month is shown instead.
        </div>
      ) : null}
      {calendar.shiftedToUpcoming ? (
        <div className="calendar-notice" role="status">
          Showing the nearest month with a published upcoming event. Choose
          Today to return to the current month.
        </div>
      ) : null}
      {calendar.hasMore ? (
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
        complete={!calendar.hasMore}
        events={calendar.events}
        key={calendar.resolvedMonth.month}
        maxMonth={calendar.resolvedMonth.maxMonth}
        minMonth={calendar.resolvedMonth.minMonth}
        month={calendar.resolvedMonth.month}
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
