import { notFound } from "next/navigation";
import {
  buildEditorialMetadata,
  EditorialUnavailable,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";
import { ClubsRouteBody } from "@/app/_components/EditorialRouteBodies";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import {
  type PublicClubDto,
} from "@/lib/server/public/catalog";
import { vancouverCalendarDate } from "@/lib/server/public/date";
import {
  type PublicNextEventByClubMaterializedView,
} from "@/lib/server/public/event-materializations";
import {
  getRequestPublicClubs,
  getRequestPublicNextEventsByClubMaterialization,
  getRequestPublicOrganization,
} from "@/lib/server/public/request-cache";
import {
  resolveMediaAssetsForRendering,
  type ResponsiveMediaAssetDto,
} from "@/lib/server/media/usage";
import { writeSafeLog } from "@/lib/validation/server-observability";

const route = "/clubs";
const slug = "clubs";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
    fallbackTitle: "Clubs",
    path: route,
    route,
    slug,
  });
}

export default async function ClubsPage() {
  const [loaded, clubs] = await Promise.all([
    loadEditorialPage(slug, route),
    loadClubs(),
  ]);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Clubs" />;
  }

  return (
    <ClubsRouteBody
      clubs={clubs.kind === "available" ? clubs.clubs : null}
      mediaById={
        clubs.kind === "available"
          ? new Map(clubs.media.map((media) => [media.assetId, media]))
          : new Map()
      }
      nextEventsByClubSlug={
        clubs.kind === "available"
          ? new Map(
              clubs.nextEvents.map(({ clubSlug, event }) => [clubSlug, event]),
            )
          : new Map()
      }
      nextEventsState={
        clubs.kind === "available" ? clubs.nextEventsState : "unavailable"
      }
      page={loaded.page}
    />
  );
}

async function loadClubs(): Promise<
  | Readonly<{
      clubs: readonly PublicClubDto[];
      kind: "available";
      media: readonly ResponsiveMediaAssetDto[];
      nextEvents: readonly PublicNextEventByClubMaterializedView[];
      nextEventsState: "available" | "unavailable";
    }>
  | Readonly<{ kind: "unavailable" }>
> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const [clubs, organization] = await Promise.all([
      getRequestPublicClubs(database),
      getRequestPublicOrganization(database),
    ]);
    let media: readonly ResponsiveMediaAssetDto[] = [];
    let nextEvents: readonly PublicNextEventByClubMaterializedView[] = [];
    let nextEventsState: "available" | "unavailable" = "unavailable";
    if (organization) {
      const nowUtcMs = readServerUtcMs();
      const usages = clubs.flatMap((club) =>
        [
          club.thumbnailAssetId
            ? {
                assetId: club.thumbnailAssetId,
                entityKey: club.slug,
                entityType: "club_public_profile" as const,
                usageKind: "thumbnail",
              }
            : null,
          club.coverAssetId
            ? {
                assetId: club.coverAssetId,
                entityKey: club.slug,
                entityType: "club_public_profile" as const,
                usageKind: "cover",
              }
            : null,
        ].filter((usage) => usage !== null),
      );
      const [mediaResult, nextEventsResult] = await Promise.allSettled([
        resolveMediaAssetsForRendering(database, {
          organizationId: organization.id,
          publicationScope: "published",
          usages,
        }),
        getRequestPublicNextEventsByClubMaterialization(database, {
          clubSlugs: clubs.map((club) => club.slug),
          nowUtcMs,
          organizationId: organization.id,
          todayDate: vancouverCalendarDate(nowUtcMs),
        }),
      ]);

      if (mediaResult.status === "fulfilled") {
        media = mediaResult.value;
      } else {
        writeSafeLog("warn", "public_club_media_unavailable", {
          code: "partial_failure",
          operation: "resolve_public_club_media",
          route,
          status: 200,
        });
      }

      if (
        nextEventsResult.status === "fulfilled" &&
        nextEventsResult.value !== null
      ) {
        nextEvents = nextEventsResult.value;
        nextEventsState = "available";
      } else {
        writeSafeLog("warn", "public_club_next_events_unavailable", {
          code: "partial_failure",
          operation: "read_public_next_events_by_club_materialization",
          route,
          status: 200,
        });
      }
    }
    return Object.freeze({
      clubs,
      kind: "available" as const,
      media,
      nextEvents,
      nextEventsState,
    });
  } catch {
    writeSafeLog("error", "public_clubs_unavailable", {
      code: "service_unavailable",
      operation: "list_public_clubs",
      route,
      status: 503,
    });
    return Object.freeze({ kind: "unavailable" as const });
  }
}
