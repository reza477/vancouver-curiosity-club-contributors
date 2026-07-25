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
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

const PUBLIC_PAGE_PATHS = new Map([
  ["home", "/"],
  ["events", "/events"],
  ["clubs", "/clubs"],
  ["community", "/community"],
  ["about", "/about"],
  ["get-involved", "/get-involved"],
  ["host-an-event", "/host-an-event"],
  ["contact", "/contact"],
  ["conduct", "/conduct"],
  ["accessibility", "/accessibility"],
  ["privacy", "/privacy"],
]);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await getTrustedRequestOrigin();
  if (!origin) return [];

  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) return [];
    const [pages, clubs, events] = await Promise.all([
      database
        .prepare(
          `SELECT slug, updated_at
           FROM pages
           WHERE organization_id = ?
             AND status = 'published'
             AND visibility = 'public'
             AND published_at IS NOT NULL
             AND deleted_at IS NULL
           ORDER BY slug ASC
           LIMIT 100`,
        )
        .bind(organization.id)
        .all<Record<string, unknown>>(),
      database
        .prepare(
          `SELECT club.slug, profile.updated_at
           FROM club_public_profiles AS profile
           JOIN clubs AS club
             ON club.id = profile.club_id
            AND club.organization_id = profile.organization_id
            AND club.deleted_at IS NULL
           WHERE profile.organization_id = ?
             AND profile.publication_status = 'published'
             AND profile.published_at IS NOT NULL
             AND profile.deleted_at IS NULL
           ORDER BY club.slug ASC
           LIMIT 100`,
        )
        .bind(organization.id)
        .all<Record<string, unknown>>(),
      listPublicEventSitemapEntries(database, {
        organizationId: organization.id,
        limit: 5_000,
      }),
    ]);

    const result: MetadataRoute.Sitemap = [];
    for (const row of pages.results ?? []) {
      const path =
        typeof row.slug === "string"
          ? PUBLIC_PAGE_PATHS.get(row.slug)
          : undefined;
      if (!path || !Number.isSafeInteger(row.updated_at)) continue;
      result.push({
        url: publicUrl(path, origin),
        lastModified: new Date(row.updated_at as number),
      });
    }
    for (const row of clubs.results ?? []) {
      if (
        typeof row.slug !== "string" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(row.slug) ||
        !Number.isSafeInteger(row.updated_at)
      ) {
        continue;
      }
      result.push({
        url: publicUrl(`/clubs/${row.slug}`, origin),
        lastModified: new Date(row.updated_at as number),
      });
    }
    for (const event of events) {
      result.push({
        url: publicUrl(`/events/${event.slug}`, origin),
        lastModified: new Date(event.lastModified),
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
