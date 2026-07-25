import { notFound } from "next/navigation";
import { ClubDirectory } from "@/app/_components/ClubDirectory";
import {
  buildEditorialMetadata,
  EditorialPage,
  EditorialUnavailable,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import {
  listPublicClubs,
  type PublicClubDto,
} from "@/lib/server/public/catalog";
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
    <EditorialPage page={loaded.page} tone="think">
      {clubs.kind === "available" ? (
        <ClubDirectory clubs={clubs.clubs} />
      ) : (
        <section className="public-service-state" aria-live="polite">
          <p className="section-kicker">Published clubs</p>
          <h2>Club pages are temporarily unavailable.</h2>
          <p>No draft or substitute program information is being shown.</p>
        </section>
      )}
    </EditorialPage>
  );
}

async function loadClubs(): Promise<
  | Readonly<{ clubs: readonly PublicClubDto[]; kind: "available" }>
  | Readonly<{ kind: "unavailable" }>
> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const clubs = await listPublicClubs(database);
    return Object.freeze({ clubs, kind: "available" as const });
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
