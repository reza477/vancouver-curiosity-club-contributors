import Link from "next/link";
import { buildEditorialMetadata } from "@/app/_components/EditorialPage";
import { HomePageRenderer } from "@/app/_components/HomePageRenderer";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import {
  resolvePublicOrganization,
  type PublicCatalogDto,
  type PublicPageDto,
} from "@/lib/server/public/catalog";
import type { PublicEventCardDto } from "@/lib/server/public/events";
import { loadPublicHomeData } from "@/lib/server/public/home";
import { getTrustedRequestOrigin } from "@/lib/server/public/origin";
import { publicServiceUnavailable } from "@/lib/server/public/service-failure";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
    absoluteTitle: true,
    fallbackTitle: "Vancouver Curiosity Club",
    path: "/",
    route: "/",
    slug: "home",
  });
}

export default async function HomePage() {
  const loaded = await loadHome();
  if (!loaded) {
    return (
      <main className="public-page home-page">
        <section className="public-service-state" aria-labelledby="home-state">
          <p className="section-kicker">Vancouver Curiosity Club</p>
          <h1 id="home-state">The public catalog is not available yet.</h1>
          <p>
            No events, people, legal details, or community claims are being
            invented to fill this review state.
          </p>
          <Link href="/calendar">Open the event calendar</Link>
        </section>
      </main>
    );
  }
  return (
    <HomePageRenderer
      catalog={loaded.catalog}
      events={loaded.events}
      origin={await getTrustedRequestOrigin()}
      page={loaded.page}
    />
  );
}

async function loadHome(): Promise<{
  catalog: PublicCatalogDto;
  events: readonly PublicEventCardDto[];
  page: PublicPageDto;
} | null> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) return null;
    const nowUtcMs = readServerUtcMs();
    return loadPublicHomeData(database, {
      nowUtcMs,
      organizationId: organization.id,
    });
  } catch {
    writeSafeLog("error", "public_home_unavailable", {
      code: "service_unavailable",
      operation: "load_public_home",
      route: "/",
      status: 503,
    });
    publicServiceUnavailable();
  }
}
