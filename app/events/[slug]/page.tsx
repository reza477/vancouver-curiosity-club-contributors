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
  getPublicSiteContext,
  resolvePublicOrganization,
} from "@/lib/server/public/catalog";
import { vancouverCalendarDate } from "@/lib/server/public/date";
import {
  getPublicEventBySlug,
  listRelatedPublicEvents,
  type PublicEventDetailDto,
} from "@/lib/server/public/events";
import { buildPublicEventJsonLd } from "@/lib/server/public/event-structured-data";
import {
  buildPublicPageMetadata,
  resolvePublicEventMetadataImage,
} from "@/lib/server/public/metadata";
import {
  getTrustedRequestOrigin,
  publicUrl,
} from "@/lib/server/public/origin";
import { InputValidationError } from "@/lib/validation";
import { usesShippedSocialArtwork } from "@/lib/brand";

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
  const image = await resolvePublicEventMetadataImage(loaded.database, {
    artwork: loaded.event.artwork,
    organizationId: loaded.organizationId,
    siteOpenGraphAssetId: loaded.siteOpenGraphAssetId,
  });
  return buildPublicPageMetadata({
    title: loaded.event.seoTitle ?? loaded.event.title,
    description:
      loaded.event.metaDescription ??
      loaded.event.summary ??
      `Published event details from ${loaded.event.club.name}.`,
    imageAlt: image?.altText,
    imageHeight: image?.height,
    imagePath:
      image?.path ??
      (loaded.useShippedSocialFallback ? undefined : null),
    imageWidth: image?.width,
    pathname: `/events/${loaded.event.slug}`,
    siteName: loaded.siteName ?? undefined,
  });
}

export default async function EventDetailPage({
  params,
}: Readonly<{ params: RouteParams }>) {
  const { slug } = await params;
  const loaded = await loadEvent(slug);
  if (!loaded) notFound();

  const { event, organizationId, database, siteName } = loaded;
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
            <Link href="/events" prefetch={false}>
              All events
            </Link>
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
          <StructuredData
            value={buildPublicEventJsonLd(event, canonicalUrl, siteName)}
          />
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
  siteName: string | null;
  siteOpenGraphAssetId: string | null;
  useShippedSocialFallback: boolean;
} | null> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) return null;
    const [event, site] = await Promise.all([
      getPublicEventBySlug(database, {
        organizationId: organization.id,
        slug,
      }),
      getPublicSiteContext(database),
    ]);
    return event
      ? {
          database,
          event,
          organizationId: organization.id,
          siteName: site?.brandName ?? null,
          siteOpenGraphAssetId: site?.openGraphAssetId ?? null,
          useShippedSocialFallback: usesShippedSocialArtwork(site),
        }
      : null;
  } catch (error) {
    if (error instanceof InputValidationError) return null;
    throw error;
  }
}
