import type { Metadata } from "next";
import {
  EventsPageRenderer,
  emptyEventPage,
  eventListValues,
} from "@/app/_components/EventsPageRenderer";
import { buildEditorialMetadata } from "@/app/_components/EditorialPage";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import {
  getRequestPublicOrganization,
  getRequestPublicPageContent,
} from "@/lib/server/public/request-cache";
import { vancouverCalendarDate } from "@/lib/server/public/date";
import { queryPublicEvents } from "@/lib/server/public/events";
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
  const values = eventListValues(raw);
  const nowUtcMs = readServerUtcMs();
  const todayDate = vancouverCalendarDate(nowUtcMs);
  const originPromise = getTrustedRequestOrigin();
  let pageContent:
    | Awaited<ReturnType<typeof getRequestPublicPageContent>>
    | null = null;
  let eventPage = emptyEventPage(values.state);
  let calendar = emptyPublicMonthCalendar(raw.month, todayDate);

  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await getRequestPublicOrganization(database);
    if (organization) {
      [pageContent, eventPage, calendar] = await Promise.all([
        getRequestPublicPageContent(database, "events"),
        queryPublicEvents(database, {
          organizationId: organization.id,
          nowUtcMs,
          todayDate,
          view: values.state,
          page: values.page,
          pageSize: 12,
        }),
        loadPublicMonthCalendar(database, {
          organizationId: organization.id,
          nowUtcMs,
          rawMonth: raw.month,
          todayDate,
        }),
      ]);
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
  const origin = await originPromise;

  return (
    <EventsPageRenderer
      calendar={calendar}
      eventPage={eventPage}
      nowUtcMs={nowUtcMs}
      pageContent={pageContent}
      siteOrigin={origin?.origin ?? null}
      todayDate={todayDate}
      values={values}
    />
  );
}
