import Link from "next/link";
import { EditorialSection, loadEditorialRenderContext } from "./EditorialPage";
import { EventCollection } from "./EventCollection";
import { EventFilters, type EventFilterValues } from "./EventFilters";
import { PageMasthead } from "./PageMasthead";
import type {
  PublicClubDto,
  PublicCommunityLinkDto,
  PublicLaneDto,
  PublicPageDto,
} from "@/lib/server/public/catalog";
import type {
  PublicEventCategoryOption,
  PublicEventPageDto,
} from "@/lib/server/public/events";
import type { PublicMeetupSyncStatus } from "@/lib/server/meetup";
import type { ResponsiveMediaAssetDto } from "@/lib/server/media/usage";

export async function EventsPageRenderer({
  categories,
  clubs,
  eventPage,
  invalidFilters,
  lanes,
  pageContent,
  previewCommunityLinks,
  previewMediaAssets,
  privatePreview = false,
  sync,
  values,
}: Readonly<{
  categories: readonly PublicEventCategoryOption[];
  clubs: readonly PublicClubDto[];
  eventPage: PublicEventPageDto;
  invalidFilters: boolean;
  lanes: readonly PublicLaneDto[];
  pageContent: PublicPageDto | null;
  previewCommunityLinks?: readonly PublicCommunityLinkDto[];
  previewMediaAssets?: readonly ResponsiveMediaAssetDto[];
  privatePreview?: boolean;
  sync: Readonly<{
    lastSuccessAt: string | null;
    status: PublicMeetupSyncStatus;
  }>;
  values: EventFilterValues;
}>) {
  const intro = pageContent
    ? pageContent.sections.find((section) => {
        const type = section.type.replaceAll("_", "-");
        return type === "intro" || type === "hero";
      })
    : null;
  const sections = pageContent
    ? pageContent.sections.filter((section) => section !== intro)
    : [];
  const renderContext = pageContent
      ? await loadEditorialRenderContext({
          page: pageContent,
          previewCommunityLinks,
          previewMediaAssets,
        privatePreview,
      })
    : null;

  return (
    <main className="public-page events-page">
      <PageMasthead
        deck={
          intro?.content.text ??
          "The public catalog has not been initialized in this review database."
        }
        eyebrow="Field calendar · Vancouver"
        title={intro?.content.heading ?? pageContent?.title ?? "Events"}
      />

      {sections.length > 0 && renderContext ? (
        <div className="editorial-sections">
          {sections.map((section) => (
            <EditorialSection
              key={section.key}
              renderContext={renderContext}
              section={section}
            />
          ))}
        </div>
      ) : null}

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

export function eventFilterValues(
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

export function emptyEventPage(
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
