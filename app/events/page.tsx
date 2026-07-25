import type { Metadata } from "next";
import Link from "next/link";
import { EventCollection } from "@/app/_components/EventCollection";
import {
  EventFilters,
  type EventFilterValues,
} from "@/app/_components/EventFilters";
import { PageMasthead } from "@/app/_components/PageMasthead";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import {
  readPublicMeetupSyncState,
  refreshMeetupCalendarSourceIfDue,
} from "@/lib/server/meetup";
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
import { buildPublicPageMetadata } from "@/lib/server/public/metadata";
import { publicServiceUnavailable } from "@/lib/server/public/service-failure";
import { InputValidationError } from "@/lib/validation";
import { writeSafeLog } from "@/lib/validation/server-observability";
import type { PublicMeetupSyncStatus } from "@/lib/server/meetup";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export async function generateMetadata({
  searchParams,
}: Readonly<{ searchParams: PageSearchParams }>): Promise<Metadata> {
  const params = await searchParams;
  return buildPublicPageMetadata({
    title: "Events",
    description:
      "Browse upcoming and past published Vancouver Curiosity Club events.",
    pathname: "/events",
    index: Object.keys(params).length === 0,
  });
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
  let sync: Readonly<{
    lastSuccessAt: string | null;
    status: PublicMeetupSyncStatus;
  }> = { status: "not_connected", lastSuccessAt: null };
  let invalidFilters = false;

  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (organization) {
      try {
        await refreshMeetupCalendarSourceIfDue(database, {
          organizationId: organization.id,
          nowUtcMs,
        });
      } catch {
        writeSafeLog("warn", "public_meetup_refresh_on_view_failed", {
          code: "service_unavailable",
          operation: "refresh_public_events_if_due",
          route: "/events",
          status: 503,
        });
      }

      [pageContent, clubs, lanes, categories, sync] = await Promise.all([
        getPublicPageContent(database, "events"),
        listPublicClubs(database),
        listPublicLanes(database),
        listPublicEventCategoryOptions(database, organization.id),
        readPublicMeetupSyncState(database, organization.id, nowUtcMs),
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

  const intro = pageContent?.sections[0]?.content;

  return (
    <main className="public-page events-page">
      <PageMasthead
        eyebrow="Field calendar · Vancouver"
        title={intro?.heading ?? pageContent?.title ?? "Events"}
        deck={
          intro?.text ??
          "The public catalog has not been initialized in this review database."
        }
      />

      <SourceStatus sync={sync} />

      {invalidFilters ? (
        <section className="public-error-state" role="alert">
          <p className="section-kicker">Filters not applied</p>
          <h2>One or more filters could not be validated.</h2>
          <p>
            Use shorter keywords, real calendar dates, and the available filter
            choices.
          </p>
          <Link href="/events">Clear Filters</Link>
        </section>
      ) : null}

      <EventFilters
        categories={categories}
        clubs={clubs}
        lanes={lanes}
        resultCount={eventPage.totalCount}
        values={values}
      />
      {!invalidFilters ? (
        <>
          <EventCollection
            events={eventPage.events}
            emptyMessage={
              hasActiveFilters(values)
                ? "No published event matches this combination. Clear the filters to widen the search."
                : values.state === "past"
                  ? "No past events are currently available in the public catalog."
                  : "When a real event is published, it will appear here."
            }
          />
          <Pagination page={eventPage} values={values} />
        </>
      ) : null}
    </main>
  );
}

function SourceStatus({
  sync,
}: Readonly<{
  sync: Readonly<{
    lastSuccessAt: string | null;
    status: PublicMeetupSyncStatus;
  }>;
}>) {
  const copy: Record<PublicMeetupSyncStatus, string> = {
    not_connected:
      "Official Meetup feeds are not connected in this review database.",
    pending:
      "The first import is in progress. Incomplete source rows are not public.",
    partial:
      "A newer import is incomplete. The last completed snapshot remains visible.",
    current:
      "The completed source snapshot is current. Refreshes happen on view or owner request, not on a guaranteed schedule.",
    stale:
      "The last completed source snapshot is older than expected. Its published facts remain visible while a refresh is attempted.",
    disabled:
      "Source refresh is disabled. The calendar does not claim current synchronization.",
    error:
      "The latest source check failed. The last completed snapshot remains visible.",
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
    <aside className="source-status" data-source-status={sync.status}>
      <span aria-hidden="true" />
      <p>
        {copy[sync.status]}
        {lastSuccess ? ` Last completed ${lastSuccess}.` : ""}
      </p>
    </aside>
  );
}

function Pagination({
  page,
  values,
}: Readonly<{
  page: PublicEventPageDto;
  values: EventFilterValues;
}>) {
  if (page.page === 1 && !page.hasMore) return null;
  return (
    <nav className="pagination" aria-label="Event results pages">
      {page.page > 1 ? (
        <Link href={pageHref(values, page.page - 1)}>← Previous</Link>
      ) : (
        <span />
      )}
      <span>
        Page {page.page}
        {page.totalCount > 0
          ? ` of ${Math.ceil(page.totalCount / page.pageSize)}`
          : ""}
      </span>
      {page.hasMore ? (
        <Link href={pageHref(values, page.page + 1)}>Next →</Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

function eventFilterValues(
  params: Record<string, string | string[] | undefined>,
): EventFilterValues {
  const value = (key: string) =>
    typeof params[key] === "string" ? params[key] : "";
  return {
    q: value("q"),
    from: value("from"),
    to: value("to"),
    club: value("club"),
    lane: value("lane"),
    category: value("category"),
    format: value("format"),
    page: value("page"),
    state: value("state") === "past" ? "past" : "upcoming",
  };
}

function hasActiveFilters(values: EventFilterValues): boolean {
  return Boolean(
    values.q ||
      values.from ||
      values.to ||
      values.club ||
      values.lane ||
      values.category ||
      values.format,
  );
}

function pageHref(values: EventFilterValues, page: number): string {
  const params = new URLSearchParams();
  params.set("state", values.state);
  for (const [key, value] of [
    ["q", values.q],
    ["from", values.from],
    ["to", values.to],
    ["club", values.club],
    ["lane", values.lane],
    ["category", values.category],
    ["format", values.format],
  ] as const) {
    if (value) params.set(key, value);
  }
  params.set("page", String(page));
  return `/events?${params.toString()}`;
}

function emptyEventPage(
  view: EventFilterValues["state"],
): PublicEventPageDto {
  return Object.freeze({
    events: Object.freeze([]),
    hasMore: false,
    page: 1,
    pageSize: 12,
    totalCount: 0,
    view,
  });
}
