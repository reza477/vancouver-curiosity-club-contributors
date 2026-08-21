import type { Metadata } from "next";
import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import { EventCard } from "@/app/_components/EventCard";
import { PublicEventDetailRenderer } from "@/app/_components/PublicEventDetailRenderer";
import { StructuredData } from "@/app/_components/StructuredData";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import { vancouverCalendarDate } from "@/lib/server/public/date";
import type {
  PublicEventCardDto,
  PublicEventDetailDto,
} from "@/lib/server/public/events";
import { buildPublicEventJsonLd } from "@/lib/server/public/event-structured-data";
import {
  buildPublicEventMetadataDescription,
  buildPublicPageMetadata,
  resolvePublicEventMetadataImage,
} from "@/lib/server/public/metadata";
import {
  getTrustedRequestOrigin,
  publicUrl,
} from "@/lib/server/public/origin";
import {
  getRequestPublicEventDetailViewMaterialization,
  getRequestPublicOrganization,
  getRequestPublicSiteContext,
} from "@/lib/server/public/request-cache";
import { InputValidationError } from "@/lib/validation";
import { usesShippedSocialArtwork } from "@/lib/brand";
import { publicServiceUnavailable } from "@/lib/server/public/service-failure";

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
    description: buildPublicEventMetadataDescription({
      description: loaded.event.description,
      fallback: `Event details from ${loaded.event.club.name}.`,
      metaDescription: loaded.event.metaDescription,
      summary: loaded.event.summary,
    }),
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

  const { event, siteName } = loaded;
  const related = loaded.related;
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
          { label: "Event details" },
        ]}
      />

      <PublicEventDetailRenderer canonicalUrl={canonicalUrl} event={event} />

      {related.length > 0 ? (
        <section className="related-events" aria-labelledby="related-title">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Keep following the thread</p>
              <h2 id="related-title">Related events</h2>
            </div>
            <Link href="/events">
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
  related: readonly PublicEventCardDto[];
  siteName: string | null;
  siteOpenGraphAssetId: string | null;
  useShippedSocialFallback: boolean;
} | null> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await getRequestPublicOrganization(database);
    if (!organization) publicServiceUnavailable();
    const nowUtcMs = readServerUtcMs();
    const todayDate = vancouverCalendarDate(nowUtcMs);
    const [materialized, site] = await Promise.all([
      getRequestPublicEventDetailViewMaterialization(database, {
        limit: 3,
        nowUtcMs,
        organizationId: organization.id,
        slug,
        todayDate,
      }),
      getRequestPublicSiteContext(database),
    ]);
    if (!materialized) publicServiceUnavailable();
    if (materialized.kind !== "available") return null;
    return {
      database,
      event: materialized.event,
      organizationId: organization.id,
      related: materialized.related,
      siteName: site?.brandName ?? null,
      siteOpenGraphAssetId: site?.openGraphAssetId ?? null,
      useShippedSocialFallback: usesShippedSocialArtwork(site),
    };
  } catch (error) {
    if (error instanceof InputValidationError) return null;
    throw error;
  }
}
