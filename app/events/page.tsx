import type { Metadata } from "next";
import {
  EventsPageRenderer,
  emptyEventPage,
  eventFilterValues,
} from "@/app/_components/EventsPageRenderer";
import { buildEditorialMetadata } from "@/app/_components/EditorialPage";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import {
  getPublicPageContent,
  listPublicClubs,
  listPublicLanes,
  resolvePublicOrganization,
  type PublicClubDto,
  type PublicLaneDto,
} from "@/lib/server/public/catalog";
import { vancouverCalendarDate } from "@/lib/server/public/date";
import {
  listPublicEventCategoryOptions,
  queryPublicEvents,
  type PublicEventCategoryOption,
  type PublicEventPageDto,
} from "@/lib/server/public/events";
import { publicServiceUnavailable } from "@/lib/server/public/service-failure";
import { InputValidationError } from "@/lib/validation";
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
  const values = eventFilterValues(raw);
  const nowUtcMs = readServerUtcMs();
  const todayDate = vancouverCalendarDate(nowUtcMs);
  let pageContent:
    | Awaited<ReturnType<typeof getPublicPageContent>>
    | null = null;
  let clubs: readonly PublicClubDto[] = [];
  let lanes: readonly PublicLaneDto[] = [];
  let categories: readonly PublicEventCategoryOption[] = [];
  let eventPage: PublicEventPageDto = emptyEventPage(values.state);
  let invalidFilters = false;

  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (organization) {
      [pageContent, clubs, lanes, categories] = await Promise.all([
        getPublicPageContent(database, "events"),
        listPublicClubs(database),
        listPublicLanes(database),
        listPublicEventCategoryOptions(database, organization.id),
      ]);
      try {
        eventPage = await queryPublicEvents(database, {
          organizationId: organization.id,
          nowUtcMs,
          todayDate,
          view: raw.state,
          keyword: raw.q,
          fromDate: raw.from,
          toDate: raw.to,
          clubSlug: raw.club,
          laneSlug: raw.lane,
          categorySlug: raw.category,
          attendanceMode: raw.format,
          page: raw.page,
          pageSize: 12,
        });
      } catch (error) {
        if (error instanceof InputValidationError) {
          invalidFilters = true;
        } else {
          throw error;
        }
      }
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
      categories={categories}
      clubs={clubs}
      eventPage={eventPage}
      invalidFilters={invalidFilters}
      lanes={lanes}
      pageContent={pageContent}
      values={values}
    />
  );
}
