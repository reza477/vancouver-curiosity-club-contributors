import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import { EventCard } from "@/app/_components/EventCard";
import { PublicEventDetailRenderer } from "@/app/_components/PublicEventDetailRenderer";
import { StructuredData } from "@/app/_components/StructuredData";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import {
  resolvePublicOrganization,
} from "@/lib/server/public/catalog";
import { vancouverCalendarDate } from "@/lib/server/public/date";
import {
  getPublicEventBySlug,
  listRelatedPublicEvents,
  type PublicEventDetailDto,
} from "@/lib/server/public/events";
import { buildPublicPageMetadata } from "@/lib/server/public/metadata";
import {
  getTrustedRequestOrigin,
  publicUrl,
} from "@/lib/server/public/origin";
import { InputValidationError } from "@/lib/validation";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ slug: string }>;

export async function generateMetadata({
  params,
}: Readonly<{ params: RouteParams }>): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadEvent(slug);
  if (!loaded) {
    return {
      title: "Event not found",
      robots: { index: false, follow: false },
    };
  }
  return buildPublicPageMetadata({
    title: loaded.event.title,
    description:
      loaded.event.summary ??
      `Published event details from ${loaded.event.club.name}.`,
    pathname: `/events/${loaded.event.slug}`,
  });
}

export default async function EventDetailPage({
  params,
}: Readonly<{ params: RouteParams }>) {
  const { slug } = await params;
  const loaded = await loadEvent(slug);
  if (!loaded) notFound();

  const { event, organizationId, database } = loaded;
  const nowUtcMs = readServerUtcMs();
  const related = event.isCancelled
    ? []
    : await listRelatedPublicEvents(database, {
        organizationId,
        slug: event.slug,
        nowUtcMs,
        todayDate: vancouverCalendarDate(nowUtcMs),
        limit: 3,
      });
  const origin = await getTrustedRequestOrigin();
  const canonicalUrl = origin
    ? publicUrl(`/events/${event.slug}`, origin)
    : null;

  return (
    <main className="public-page event-detail-page">
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { href: "/events", label: "Events" },
          { label: event.title },
        ]}
      />

      <PublicEventDetailRenderer canonicalUrl={canonicalUrl} event={event} />

      {related.length > 0 ? (
        <section className="related-events" aria-labelledby="related-title">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Keep following the thread</p>
              <h2 id="related-title">Related published events</h2>
            </div>
            <Link href="/events">All events</Link>
          </div>
          <div className="event-list event-list--related">
            {related.map((item) => (
              <EventCard compact event={item} key={item.slug} />
            ))}
          </div>
        </section>
      ) : null}

      {canonicalUrl ? (
        <>
          <StructuredData value={eventJsonLd(event, canonicalUrl)} />
          <StructuredData
            value={{
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: "Home",
                  item: publicUrl("/", origin!),
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: "Events",
                  item: publicUrl("/events", origin!),
                },
                {
                  "@type": "ListItem",
                  position: 3,
                  name: event.title,
                  item: canonicalUrl,
                },
              ],
            }}
          />
        </>
      ) : null}
    </main>
  );
}

async function loadEvent(slug: string): Promise<{
  database: ReturnType<typeof getRuntimeAuthConfiguration>["database"];
  event: PublicEventDetailDto;
  organizationId: string;
} | null> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) return null;
    const event = await getPublicEventBySlug(database, {
      organizationId: organization.id,
      slug,
    });
    return event
      ? { database, event, organizationId: organization.id }
      : null;
  } catch (error) {
    if (error instanceof InputValidationError) return null;
    throw error;
  }
}

function eventJsonLd(
  event: PublicEventDetailDto,
  canonicalUrl: string,
): Readonly<Record<string, unknown>> {
  const schedule =
    event.schedule.kind === "timed"
      ? {
          startDate: event.schedule.startsAtUtc,
          endDate: event.schedule.endsAtUtc,
        }
      : {
          startDate: event.schedule.startDate,
          endDate: inclusiveCalendarEnd(
            event.schedule.endDateExclusive,
          ),
        };
  const attendanceMode =
    event.attendanceMode === "online"
      ? "https://schema.org/OnlineEventAttendanceMode"
      : event.attendanceMode === "hybrid"
        ? "https://schema.org/MixedEventAttendanceMode"
        : event.attendanceMode === "in-person"
          ? "https://schema.org/OfflineEventAttendanceMode"
          : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: event.summary ?? event.description ?? undefined,
    url: canonicalUrl,
    ...schedule,
    eventStatus: event.isCancelled
      ? "https://schema.org/EventCancelled"
      : event.status === "confirmed"
        ? "https://schema.org/EventScheduled"
        : undefined,
    eventAttendanceMode: attendanceMode,
    location: event.venue
      ? {
          "@type": "Place",
          name: event.venue.name,
          address: event.venue.address ?? undefined,
        }
      : undefined,
    organizer: {
      "@type": "Organization",
      name: event.club.name,
      url: new URL(`/clubs/${event.club.slug}`, canonicalUrl).toString(),
    },
    sameAs: event.rsvpUrl ?? undefined,
  };
}

function inclusiveCalendarEnd(endDateExclusive: string): string {
  const date = new Date(`${endDateExclusive}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
