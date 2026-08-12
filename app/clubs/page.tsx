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
  listNextPublicEventsByClub,
  type PublicEventCardDto,
} from "@/lib/server/public/events";
import {
  getRequestPublicClubs,
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
          ? new Map(clubs.nextEvents.map((event) => [event.club.slug, event]))
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
      nextEvents: readonly PublicEventCardDto[];
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
    let nextEvents: readonly PublicEventCardDto[] = [];
    let nextEventsState: "available" | "unavailable" = "unavailable";
    if (organization) {
      try {
        media = await resolveMediaAssetsForRendering(database, {
          organizationId: organization.id,
          publicationScope: "published",
          usages: clubs.flatMap((club) =>
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
          ),
        });
      } catch {
        writeSafeLog("warn", "public_club_media_unavailable", {
          code: "partial_failure",
          operation: "resolve_public_club_media",
          route,
          status: 200,
        });
      }

      try {
        const nowUtcMs = readServerUtcMs();
        nextEvents = await listNextPublicEventsByClub(database, {
          clubSlugs: clubs.map((club) => club.slug),
          nowUtcMs,
          organizationId: organization.id,
          todayDate: vancouverCalendarDate(nowUtcMs),
        });
        nextEventsState = "available";
      } catch {
        writeSafeLog("warn", "public_club_next_events_unavailable", {
          code: "partial_failure",
          operation: "list_next_public_events_by_club",
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
