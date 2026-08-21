import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  ClubDetailRenderer,
  type ClubDetailEventsState,
} from "@/app/_components/ClubDetailRenderer";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import {
  listPublicProgramsForClub,
  type PublicClubDto,
} from "@/lib/server/public/catalog";
import {
  resolveMediaAssetsForRendering,
  type ResponsiveMediaAssetDto,
} from "@/lib/server/media/usage";
import { buildPublicPageMetadata } from "@/lib/server/public/metadata";
import { getTrustedRequestOrigin } from "@/lib/server/public/origin";
import {
  getRequestPublicClubBySlug,
  getRequestPublicClubEventViewMaterialization,
  getRequestPublicOrganization,
  getRequestPublicSiteContext,
  getRequestPublicSlugRedirect,
} from "@/lib/server/public/request-cache";
import {
  DEFAULT_TIME_ZONE,
  calendarDateInTimeZone,
} from "@/lib/time";
import { writeSafeLog } from "@/lib/validation/server-observability";
import { usesShippedSocialArtwork } from "@/lib/brand";

export const dynamic = "force-dynamic";

type ClubPageProps = Readonly<{
  params: Promise<{ slug: string }>;
}>;

export async function generateMetadata({
  params,
}: ClubPageProps): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadPublicClub(slug, `/clubs/${slug}`);
  const club = loaded.kind === "available" ? loaded.club : null;
  const context = club ? await loadClubMetadataContext(club) : null;
  const image = context?.media;
  return club
    ? buildPublicPageMetadata({
        description:
          club.metaDescription ??
          club.description ??
          "A Vancouver Curiosity Club program.",
        imageAlt: image ? (image.altText ?? "") : undefined,
        imageHeight: image?.variants.webp1600.height,
        imagePath:
          image?.variants.webp1600.url ??
          (context?.useShippedSocialFallback === false ? null : undefined),
        imageWidth: image?.variants.webp1600.width,
        pathname: `/clubs/${club.slug}`,
        siteName: context?.siteName,
        title: club.seoTitle ?? club.name,
      })
    : {
        title: "Club not found",
        robots: { index: false, follow: false },
      };
}

export default async function ClubDetailPage({ params }: ClubPageProps) {
  const { slug } = await params;
  const route = `/clubs/${slug}`;
  const loaded = await loadPublicClub(slug, route);
  if (loaded.kind === "redirect") {
    permanentRedirect(`/clubs/${loaded.slug}`);
  }
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return (
      <main className="editorial-page">
        <Breadcrumbs
          items={[
            { href: "/", label: "Home" },
            { href: "/clubs", label: "Clubs" },
            { label: "Unavailable" },
          ]}
        />
        <section className="public-service-state" aria-live="polite">
          <p className="section-kicker">Temporarily unavailable</p>
          <h1>The club page could not be prepared.</h1>
          <p>Please try again shortly.</p>
        </section>
      </main>
    );
  }
  const [events, coverMedia, programs] = await Promise.all([
    loadClubEvents(loaded.club, route),
    loadClubCoverMedia(loaded.club),
    loadClubPrograms(loaded.club),
  ]);
  const programMediaById = await loadProgramThumbnailMedia(programs);
  return (
    <ClubDetailRenderer
      club={loaded.club}
      coverMedia={coverMedia}
      events={events}
      origin={await getTrustedRequestOrigin()}
      programMediaById={programMediaById}
      programs={programs}
    />
  );
}

async function loadClubPrograms(
  club: PublicClubDto,
): Promise<
  Awaited<ReturnType<typeof listPublicProgramsForClub>>
> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    return await listPublicProgramsForClub(database, club.slug);
  } catch {
    return Object.freeze([]);
  }
}

async function loadProgramThumbnailMedia(
  programs: Awaited<ReturnType<typeof listPublicProgramsForClub>>,
): Promise<ReadonlyMap<string, ResponsiveMediaAssetDto>> {
  const assetIds = programs.flatMap((program) =>
    program.thumbnailAssetId ? [program.thumbnailAssetId] : [],
  );
  if (assetIds.length === 0) return new Map();
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await getRequestPublicOrganization(database);
    if (!organization) return new Map();
    const media = await resolveMediaAssetsForRendering(database, {
      organizationId: organization.id,
      publicationScope: "published",
      usages: programs.flatMap((program) =>
        program.thumbnailAssetId
          ? [
              {
                assetId: program.thumbnailAssetId,
                entityKey: program.slug,
                entityType: "program_public_profile" as const,
                usageKind: "thumbnail",
              },
            ]
          : [],
      ),
    });
    return new Map(media.map((asset) => [asset.assetId, asset]));
  } catch {
    return new Map();
  }
}

async function loadClubCoverMedia(
  club: PublicClubDto,
): Promise<ResponsiveMediaAssetDto | null> {
  if (!club.coverAssetId) return null;
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await getRequestPublicOrganization(database);
    if (!organization) return null;
    const media = await resolveMediaAssetsForRendering(database, {
      organizationId: organization.id,
      publicationScope: "published",
      usages: [
        {
          assetId: club.coverAssetId,
          entityKey: club.slug,
          entityType: "club_public_profile",
          usageKind: "cover",
        },
      ],
    });
    return media[0] ?? null;
  } catch {
    return null;
  }
}

async function loadClubMetadataContext(
  club: PublicClubDto,
): Promise<Readonly<{
  media: ResponsiveMediaAssetDto | null;
  siteName: string | undefined;
  useShippedSocialFallback: boolean;
}> | null> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const [organization, site] = await Promise.all([
      getRequestPublicOrganization(database),
      getRequestPublicSiteContext(database),
    ]);
    if (!organization) return null;
    const media = await resolveMediaAssetsForRendering(database, {
      organizationId: organization.id,
      publicationScope: "published",
      usages: [
        ...(club.openGraphAssetId
          ? [
              {
                assetId: club.openGraphAssetId,
                entityKey: club.slug,
                entityType: "club_public_profile" as const,
                usageKind: "open_graph",
              },
            ]
          : []),
        ...(site?.openGraphAssetId
          ? [
              {
                assetId: site.openGraphAssetId,
                entityKey: organization.id,
                entityType: "site_og" as const,
                usageKind: "open_graph",
              },
            ]
          : []),
      ],
    });
    return Object.freeze({
      media:
        media.find(
          ({ assetId }) => assetId === club.openGraphAssetId,
        ) ??
        media.find(
          ({ assetId }) => assetId === site?.openGraphAssetId,
        ) ??
        null,
      siteName: site?.brandName,
      useShippedSocialFallback: usesShippedSocialArtwork(site),
    });
  } catch {
    return null;
  }
}

async function loadPublicClub(
  slug: string,
  route: string,
): Promise<
  | Readonly<{ club: PublicClubDto; kind: "available" }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "redirect"; slug: string }>
  | Readonly<{ kind: "unavailable" }>
> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const club = await getRequestPublicClubBySlug(database, slug);
    if (club) return Object.freeze({ club, kind: "available" as const });
    const redirect = await getRequestPublicSlugRedirect(database, {
      entityType: "club_public_profile",
      fromSlug: slug,
    });
    return redirect
      ? Object.freeze({ kind: "redirect" as const, slug: redirect })
      : Object.freeze({ kind: "missing" as const });
  } catch {
    writeSafeLog("error", "public_club_unavailable", {
      code: "service_unavailable",
      operation: "read_public_club",
      route,
      status: 503,
    });
    return Object.freeze({ kind: "unavailable" as const });
  }
}

async function loadClubEvents(
  club: PublicClubDto,
  route: string,
): Promise<ClubDetailEventsState> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await getRequestPublicOrganization(database);
    if (!organization) {
      return Object.freeze({ kind: "unavailable" as const });
    }
    const nowUtcMs = readServerUtcMs();
    const todayDate = calendarDateInTimeZone(
      nowUtcMs,
      DEFAULT_TIME_ZONE,
    );
    const materialized = await getRequestPublicClubEventViewMaterialization(
      database,
      {
        clubSlug: club.slug,
        nowUtcMs,
        organizationId: organization.id,
        pageSize: 6,
        todayDate,
      },
    );
    if (!materialized) {
      return Object.freeze({ kind: "unavailable" as const });
    }
    return Object.freeze({
      kind: "available" as const,
      past: materialized.past,
      upcoming: materialized.upcoming,
    });
  } catch {
    writeSafeLog("error", "public_club_events_unavailable", {
      code: "service_unavailable",
      operation: "list_public_club_events",
      route,
      status: 503,
    });
    return Object.freeze({ kind: "unavailable" as const });
  }
}
