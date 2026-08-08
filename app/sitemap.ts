import type { MetadataRoute } from "next";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import {
  resolvePublicOrganization,
} from "@/lib/server/public/catalog";
import {
  listPublicEventSitemapEntries,
} from "@/lib/server/public/events";
import {
  getTrustedRequestOrigin,
  publicUrl,
} from "@/lib/server/public/origin";
import {
  listPublicCatalogSitemapEntries,
} from "@/lib/server/public/sitemap";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

const PUBLIC_PAGE_PATHS = new Map([
  ["home", "/"],
  ["events", "/events"],
  ["clubs", "/clubs"],
  ["about", "/about"],
  ["get-involved", "/get-involved"],
  ["host-an-event", "/host-an-event"],
  ["contact", "/contact"],
  ["conduct", "/conduct"],
  ["accessibility", "/accessibility"],
  ["privacy", "/privacy"],
  ["resources", "/resources"],
]);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await getTrustedRequestOrigin();
  if (!origin) return [];

  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) return [];
    const [catalogEntries, events] = await Promise.all([
      listPublicCatalogSitemapEntries(database, organization.id),
      listPublicEventSitemapEntries(database, {
        organizationId: organization.id,
        limit: 5_000,
      }),
    ]);

    const result: MetadataRoute.Sitemap = [];
    for (const page of catalogEntries.pages) {
      const path = PUBLIC_PAGE_PATHS.get(page.slug);
      if (!path) continue;
      result.push({
        url: publicUrl(path, origin),
        lastModified: new Date(page.lastModified),
      });
    }
    for (const club of catalogEntries.clubs) {
      result.push({
        url: publicUrl(`/clubs/${club.slug}`, origin),
        lastModified: new Date(club.lastModified),
      });
    }
    for (const event of events) {
      result.push({
        url: publicUrl(`/events/${event.slug}`, origin),
        lastModified: new Date(event.lastModified),
      });
    }
    for (const program of catalogEntries.programs) {
      result.push({
        url: publicUrl(
          `/clubs/${program.clubSlug}/programs/${program.programSlug}`,
          origin,
        ),
        lastModified: new Date(program.lastModified),
      });
    }
    return result;
  } catch {
    writeSafeLog("error", "public_sitemap_unavailable", {
      code: "service_unavailable",
      operation: "build_public_sitemap",
      route: "/sitemap.xml",
      status: 503,
    });
    return [];
  }
}
