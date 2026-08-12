import type { Metadata } from "next";
import { resolvePublicEventLaneSelection } from "@/lib/server/public/event-lane-filter";
import { EventsPageRenderer } from "@/app/_components/EventsPageRenderer";
import { buildEditorialMetadata } from "@/app/_components/EditorialPage";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import {
  getRequestPublicOrganization,
  getRequestPublicPageContent,
} from "@/lib/server/public/request-cache";
import { vancouverCalendarDate } from "@/lib/server/public/date";
import { loadPublicEventsPageData } from "@/lib/server/public/events-page";
import {
  emptyPublicMonthCalendar,
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
    fallbackTitle: "Events",
    path: "/events",
    route: "/events",
    slug: "events",
  });
  return Object.keys(params).length === 0
    ? metadata
    : {
        ...metadata,
        robots: {
          index: false,
          follow: true,
          noarchive: true,
        },
      };
}

export default async function EventsPage({
  searchParams,
}: Readonly<{ searchParams: PageSearchParams }>) {
  const raw = await searchParams;
  const laneSelection = resolvePublicEventLaneSelection(raw.lane);
  const nowUtcMs = readServerUtcMs();
  const todayDate = vancouverCalendarDate(nowUtcMs);
  const origin = await getTrustedRequestOrigin();
  let pageContent:
    | Awaited<ReturnType<typeof getRequestPublicPageContent>>
    | null = null;
  let calendar = emptyPublicMonthCalendar(raw.month, todayDate);
  let calendarAvailable = true;

  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await getRequestPublicOrganization(database);
    if (organization) {
      const pageContentPromise = getRequestPublicPageContent(
        database,
        "events",
      ).catch(() => {
        writeSafeLog("warn", "public_events_content_unavailable", {
          code: "partial_failure",
          operation: "read_public_events_content",
          route: "/events",
          status: 200,
        });
        return null;
      });
      const loaded = await loadPublicEventsPageData(database, {
        cacheOrigin: origin?.origin ?? null,
        organizationId: organization.id,
        nowUtcMs,
        laneSlug: laneSelection.activeLaneSlug,
        rawMonth: raw.month,
        todayDate,
      });
      pageContent = await pageContentPromise;
      calendar = loaded.calendar;
      calendarAvailable = loaded.calendarAvailable;
    }
  } catch {
    writeSafeLog("error", "public_events_unavailable", {
      code: "service_unavailable",
      operation: "list_public_events",
      route: "/events",
      status: 503,
    });
    publicServiceUnavailable();
  }

  return (
    <EventsPageRenderer
      calendar={calendar}
      calendarAvailable={calendarAvailable}
      activeLaneSlug={laneSelection.activeLaneSlug}
      invalidLane={laneSelection.invalid}
      nowUtcMs={nowUtcMs}
      pageContent={pageContent}
      siteOrigin={origin?.origin ?? null}
      todayDate={todayDate}
    />
  );
}
