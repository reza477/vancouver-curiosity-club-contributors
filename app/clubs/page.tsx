import { notFound } from "next/navigation";
import {
  buildEditorialMetadata,
  EditorialUnavailable,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";
import { ClubsRouteBody } from "@/app/_components/EditorialRouteBodies";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import {
  listPublicClubs,
  resolvePublicOrganization,
  type PublicClubDto,
} from "@/lib/server/public/catalog";
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
      page={loaded.page}
    />
  );
}

async function loadClubs(): Promise<
  | Readonly<{
      clubs: readonly PublicClubDto[];
      kind: "available";
      media: readonly ResponsiveMediaAssetDto[];
    }>
  | Readonly<{ kind: "unavailable" }>
> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const clubs = await listPublicClubs(database);
    const organization = await resolvePublicOrganization(database);
    const media = organization
      ? await resolveMediaAssetsForRendering(database, {
          organizationId: organization.id,
          publicationScope: "published",
          usages: clubs.flatMap((club) =>
            club.thumbnailAssetId
              ? [
                  {
                    assetId: club.thumbnailAssetId,
                    entityKey: club.slug,
                    entityType: "club_public_profile" as const,
                    usageKind: "thumbnail",
                  },
                ]
              : [],
          ),
        })
      : [];
    return Object.freeze({ clubs, kind: "available" as const, media });
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
