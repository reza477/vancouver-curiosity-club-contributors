import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import {
  type ClubDetailEventsState,
} from "@/app/_components/ClubDetailRenderer";
import { ProgramDetailRenderer } from "@/app/_components/ProgramDetailRenderer";
import { usesShippedSocialArtwork } from "@/lib/brand";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import {
  resolveMediaAssetsForRendering,
  type ResponsiveMediaAssetDto,
} from "@/lib/server/media/usage";
import {
  getPublicProgramBySlugs,
  getPublicSiteContext,
  getPublicSlugRedirect,
  resolvePublicOrganization,
  type PublicProgramDto,
} from "@/lib/server/public/catalog";
import { queryPublicEvents } from "@/lib/server/public/events";
import { buildPublicPageMetadata } from "@/lib/server/public/metadata";
import { getTrustedRequestOrigin } from "@/lib/server/public/origin";
import { isCompatibilityProgramAlias } from "@/lib/server/public/program-identity";
import {
  DEFAULT_TIME_ZONE,
  calendarDateInTimeZone,
} from "@/lib/time";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

type ProgramPageProps = Readonly<{
  params: Promise<{ programSlug: string; slug: string }>;
}>;

export async function generateMetadata({
  params,
}: ProgramPageProps): Promise<Metadata> {
  const { programSlug, slug: clubSlug } = await params;
  const loaded = await loadPublicProgram(
    clubSlug,
    programSlug,
    `/clubs/${clubSlug}/programs/${programSlug}`,
  );
  const program = loaded.kind === "available" ? loaded.program : null;
  const context = program ? await loadProgramMetadataContext(program) : null;
  const image = context?.media;
  return program
    ? buildPublicPageMetadata({
        description:
          program.metaDescription ??
          program.description ??
          "A recurring Program.",
        imageAlt: image ? (image.altText ?? "") : undefined,
        imageHeight: image?.variants.webp1600.height,
        imagePath:
          image?.variants.webp1600.url ??
          (context?.useShippedSocialFallback === false ? null : undefined),
        imageWidth: image?.variants.webp1600.width,
        pathname: `/clubs/${program.parentClub.slug}/programs/${program.slug}`,
        siteName: context?.siteName,
        title: program.seoTitle ?? program.name,
      })
    : {
        title: "Program not found",
        robots: { index: false, follow: false },
      };
}

export default async function ProgramDetailPage({
  params,
}: ProgramPageProps) {
  const { programSlug, slug: clubSlug } = await params;
  const route = `/clubs/${clubSlug}/programs/${programSlug}`;
  const loaded = await loadPublicProgram(clubSlug, programSlug, route);
  if (loaded.kind === "redirect") {
    permanentRedirect(`/clubs/${clubSlug}/programs/${loaded.slug}`);
  }
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return (
      <main className="editorial-page">
        <Breadcrumbs
          items={[
            { href: "/", label: "Home" },
            { href: "/clubs", label: "Clubs" },
            { href: `/clubs/${clubSlug}`, label: "Club" },
            { label: "Unavailable" },
          ]}
        />
        <section className="public-service-state" aria-live="polite">
          <p className="section-kicker">Temporarily unavailable</p>
          <h1>The Program page could not be prepared.</h1>
          <p>No draft or substitute Program information is being shown.</p>
        </section>
      </main>
    );
  }
  if (isCompatibilityProgramAlias(loaded.program)) {
    permanentRedirect(`/clubs/${loaded.program.parentClub.slug}`);
  }
  const [events, coverMedia] = await Promise.all([
    loadProgramEvents(loaded.program, route),
    loadProgramCoverMedia(loaded.program),
  ]);
  return (
    <ProgramDetailRenderer
      coverMedia={coverMedia}
      events={events}
      origin={await getTrustedRequestOrigin()}
      program={loaded.program}
    />
  );
}

async function loadPublicProgram(
  clubSlug: string,
  programSlug: string,
  route: string,
): Promise<
  | Readonly<{ kind: "available"; program: PublicProgramDto }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "redirect"; slug: string }>
  | Readonly<{ kind: "unavailable" }>
> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const program = await getPublicProgramBySlugs(
      database,
      clubSlug,
      programSlug,
    );
    if (program) {
      return Object.freeze({ kind: "available" as const, program });
    }
    const redirect = await getPublicSlugRedirect(database, {
      entityType: "program_public_profile",
      fromSlug: programSlug,
    });
    return redirect
      ? Object.freeze({ kind: "redirect" as const, slug: redirect })
      : Object.freeze({ kind: "missing" as const });
  } catch {
    writeSafeLog("error", "public_program_unavailable", {
      code: "service_unavailable",
      operation: "read_public_program",
      route,
      status: 503,
    });
    return Object.freeze({ kind: "unavailable" as const });
  }
}

async function loadProgramCoverMedia(
  program: PublicProgramDto,
): Promise<ResponsiveMediaAssetDto | null> {
  if (!program.coverAssetId) return null;
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) return null;
    const media = await resolveMediaAssetsForRendering(database, {
      organizationId: organization.id,
      publicationScope: "published",
      usages: [
        {
          assetId: program.coverAssetId,
          entityKey: program.slug,
          entityType: "program_public_profile",
          usageKind: "cover",
        },
      ],
    });
    return media[0] ?? null;
  } catch {
    return null;
  }
}

async function loadProgramMetadataContext(
  program: PublicProgramDto,
): Promise<Readonly<{
  media: ResponsiveMediaAssetDto | null;
  siteName: string | undefined;
  useShippedSocialFallback: boolean;
}> | null> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const [organization, site] = await Promise.all([
      resolvePublicOrganization(database),
      getPublicSiteContext(database),
    ]);
    if (!organization) return null;
    const media = await resolveMediaAssetsForRendering(database, {
      organizationId: organization.id,
      publicationScope: "published",
      usages: [
        ...(program.openGraphAssetId
          ? [
              {
                assetId: program.openGraphAssetId,
                entityKey: program.slug,
                entityType: "program_public_profile" as const,
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
        media.find(({ assetId }) => assetId === program.openGraphAssetId) ??
        media.find(({ assetId }) => assetId === site?.openGraphAssetId) ??
        null,
      siteName: site?.brandName,
      useShippedSocialFallback: usesShippedSocialArtwork(site),
    });
  } catch {
    return null;
  }
}

async function loadProgramEvents(
  program: PublicProgramDto,
  route: string,
): Promise<ClubDetailEventsState> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) {
      return Object.freeze({ kind: "unavailable" as const });
    }
    const nowUtcMs = readServerUtcMs();
    const todayDate = calendarDateInTimeZone(nowUtcMs, DEFAULT_TIME_ZONE);
    const [upcoming, past] = await Promise.all([
      queryPublicEvents(database, {
        clubSlug: program.parentClub.slug,
        nowUtcMs,
        organizationId: organization.id,
        page: 1,
        pageSize: 6,
        programSlug: program.slug,
        todayDate,
        view: "upcoming",
      }),
      queryPublicEvents(database, {
        clubSlug: program.parentClub.slug,
        nowUtcMs,
        organizationId: organization.id,
        page: 1,
        pageSize: 6,
        programSlug: program.slug,
        todayDate,
        view: "past",
      }),
    ]);
    return Object.freeze({
      kind: "available" as const,
      past,
      upcoming,
    });
  } catch {
    writeSafeLog("error", "public_program_events_unavailable", {
      code: "service_unavailable",
      operation: "list_public_program_events",
      route,
      status: 503,
    });
    return Object.freeze({ kind: "unavailable" as const });
  }
}
