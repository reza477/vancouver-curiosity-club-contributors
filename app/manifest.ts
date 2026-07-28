import type { MetadataRoute } from "next";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import {
  getPublicSiteContext,
  resolvePublicOrganization,
  type PublicSiteContextDto,
} from "@/lib/server/public/catalog";
import {
  resolveMediaAssetsForRendering,
  type ResponsiveMediaAssetDto,
} from "@/lib/server/media/usage";
import {
  buildPublicManifest,
} from "@/lib/brand";

export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let site: PublicSiteContextDto | null = null;
  let logo: ResponsiveMediaAssetDto | null = null;
  try {
    const { database } = getRuntimeAuthConfiguration();
    const [resolvedSite, organization] = await Promise.all([
      getPublicSiteContext(database),
      resolvePublicOrganization(database),
    ]);
    site = resolvedSite;
    if (site?.logoAssetId && organization) {
      logo =
        (
          await resolveMediaAssetsForRendering(database, {
            organizationId: organization.id,
            publicationScope: "published",
            usages: [
              {
                assetId: site.logoAssetId,
                entityKey: organization.id,
                entityType: "site_logo",
                usageKind: "logo",
              },
            ],
          })
        )[0] ?? null;
    }
  } catch {
    // The verified local Field Notes identity remains the truthful fallback.
  }
  return buildPublicManifest(site, logo);
}
