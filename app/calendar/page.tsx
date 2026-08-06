import type { Metadata } from "next";
import Link from "next/link";
import { PublicMonthCalendar } from "@/app/_components/PublicMonthCalendar";
import { buildEditorialMetadata } from "@/app/_components/EditorialPage";
import {
  publicCalendarMonthBounds,
  publicEventCalendarStartDate,
  resolvePublicCalendarLandingMonth,
  resolvePublicCalendarMonth,
} from "@/lib/public-calendar";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import {
  readPublicMeetupSyncState,
  type PublicMeetupSyncStatus,
} from "@/lib/server/meetup";
import { resolvePublicOrganization } from "@/lib/server/public/catalog";
import { vancouverCalendarDate } from "@/lib/server/public/date";
import {
  queryPublicEvents,
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
  let sync: Readonly<{
    lastSuccessAt: string | null;
    status: PublicMeetupSyncStatus;
  }> = { status: "not_connected", lastSuccessAt: null };

  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (organization) {
      if (raw.month === undefined) {
        const firstUpcoming = await queryPublicEvents(database, {
          organizationId: organization.id,
          nowUtcMs,
          todayDate,
          view: "upcoming",
          page: 1,
          pageSize: 1,
        });
        resolvedMonth = resolvePublicCalendarLandingMonth(
          raw.month,
          todayDate,
          firstUpcoming.events[0]
            ? publicEventCalendarStartDate(firstUpcoming.events[0])
            : null,
        );
      }
      const bounds = publicCalendarMonthBounds(resolvedMonth.month);
      const [past, upcoming, sourceState] = await Promise.all([
        queryPublicEvents(database, {
          organizationId: organization.id,
          nowUtcMs,
          todayDate,
          view: "past",
          fromDate: bounds.startDate,
          toDate: bounds.endDate,
          page: 1,
          pageSize: 48,
        }),
        queryPublicEvents(database, {
          organizationId: organization.id,
          nowUtcMs,
          todayDate,
          view: "upcoming",
          fromDate: bounds.startDate,
          toDate: bounds.endDate,
          page: 1,
          pageSize: 48,
        }),
        readPublicMeetupSyncState(database, organization.id, nowUtcMs),
      ]);
      events = mergeCalendarEvents(past.events, upcoming.events);
      hasMore = past.hasMore || upcoming.hasMore;
      sync = sourceState;
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

      <PublicMonthCalendar
        complete={!hasMore}
        events={events}
        key={resolvedMonth.month}
        maxMonth={resolvedMonth.maxMonth}
        minMonth={resolvedMonth.minMonth}
        month={resolvedMonth.month}
        siteOrigin={origin?.origin ?? null}
        todayDate={todayDate}
      />

      <nav className="calendar-view-switcher" aria-label="Calendar downloads">
        <Link href="/events/calendar.ics">Download upcoming events (.ics)</Link>
        <Link href="/events/events.csv">Download upcoming events (.csv)</Link>
      </nav>

      <section
        className="calendar-home-introduction"
        aria-labelledby="calendar-home-title"
      >
        <div>
          <p className="section-kicker">What is this club?</p>
          <h2 id="calendar-home-title">
            Curiosity is better in company.
          </h2>
        </div>
        <div>
          <p>
            Vancouver Curiosity Club brings people together for books, films,
            thoughtful conversations, creative practice, walks, food, and
            other reasons to explore Vancouver with interesting people.
          </p>
          <p>
            You do not need to be an expert or make an account. Open any event
            to see what it is about, where it is happening, and the official
            signup and add-to-calendar options.
          </p>
          <Link href="/about">Learn about the club</Link>
        </div>
      </section>

      <CalendarSourceStatus sync={sync} />
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

function CalendarSourceStatus({
  sync,
}: Readonly<{
  sync: Readonly<{
    lastSuccessAt: string | null;
    status: PublicMeetupSyncStatus;
  }>;
}>) {
  const copy: Record<PublicMeetupSyncStatus, string> = {
    current:
      "Meetup changes are checked when this calendar is opened and a refresh is due.",
    disabled:
      "Meetup refresh is currently disabled. Published website events remain visible.",
    error:
      "The latest Meetup check did not finish. The last completed calendar remains visible.",
    not_connected:
      "The official Meetup calendar connection has not been completed yet. Published website events still appear here.",
    partial:
      "A Meetup refresh is still being completed. The last complete calendar remains visible.",
    pending:
      "The first Meetup calendar refresh is being completed. Incomplete events are not shown.",
    stale:
      "The Meetup calendar is being checked. The last complete event details remain visible.",
  };
  const lastSuccess = sync.lastSuccessAt
    ? new Intl.DateTimeFormat("en-CA", {
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        timeZone: "America/Vancouver",
        timeZoneName: "short",
        year: "numeric",
      }).format(new Date(sync.lastSuccessAt))
    : null;
  return (
    <aside
      className="source-status calendar-source-status"
      data-source-status={sync.status}
    >
      <span aria-hidden="true" />
      <p>
        {copy[sync.status]}
        {lastSuccess ? ` Last completed ${lastSuccess}.` : ""}
      </p>
    </aside>
  );
}
