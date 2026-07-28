import type { Metadata } from "next";
import type { D1DatabaseLike } from "@/lib/server/auth";
import {
  resolvePublishedMediaAsset,
} from "@/lib/server/media/usage";
import type { PublicEventArtworkDto } from "@/lib/server/public/events";
import {
  getTrustedRequestOrigin,
  publicUrl,
} from "@/lib/server/public/origin";

const BRAND_NAME = "Vancouver Curiosity Club";
const SOCIAL_IMAGE_ALT =
  "Vancouver Curiosity Club — A social calendar with a brain.";

export type PublicMetadataImage = Readonly<{
  altText: string;
  height: number;
  path: string;
  width: number;
}>;

export type PublicPageMetadataInput = Readonly<{
  description: string;
  imageAlt?: string;
  imageHeight?: number;
  imagePath?: string | null;
  imageWidth?: number;
  index?: boolean;
  pathname: string;
  siteName?: string;
  title: string;
}>;

/**
 * Event artwork remains the first choice. If it is absent or has been revoked
 * from the live public projection, the fallback must be the exact current
 * published Site Identity Open Graph usage—not an unchecked asset ID.
 */
export async function resolvePublicEventMetadataImage(
  database: D1DatabaseLike,
  input: Readonly<{
    artwork: PublicEventArtworkDto | null;
    organizationId: string;
    siteOpenGraphAssetId: string | null;
  }>,
): Promise<PublicMetadataImage | null> {
  if (input.artwork) {
    return Object.freeze({
      altText: input.artwork.altText ?? "",
      height: input.artwork.dimensions.large.height,
      path: input.artwork.url,
      width: input.artwork.dimensions.large.width,
    });
  }
  if (!input.siteOpenGraphAssetId) return null;
  const fallback = await resolvePublishedMediaAsset(database, {
    assetId: input.siteOpenGraphAssetId,
    entityId: input.organizationId,
    entityType: "site_og",
    organizationId: input.organizationId,
    usageKind: "open_graph",
    variant: "webp_1600",
  });
  return fallback
    ? Object.freeze({
        altText: fallback.altText ?? "",
        height: fallback.height,
        path: fallback.url,
        width: fallback.width,
      })
    : null;
}

export async function buildPublicPageMetadata(
  input: PublicPageMetadataInput,
): Promise<Metadata> {
  const origin = await getTrustedRequestOrigin();
  return buildPublicPageMetadataForOrigin(input, origin);
}

export function buildPublicPageMetadataForOrigin(
  input: PublicPageMetadataInput,
  origin: URL | null,
): Metadata {
  const canonical = origin ? publicUrl(input.pathname, origin) : undefined;
  const imagePath =
    input.imagePath === null ? null : (input.imagePath ?? "/og.png");
  const image =
    origin && imagePath ? publicUrl(imagePath, origin) : undefined;
  const imageAlt = input.imageAlt ?? SOCIAL_IMAGE_ALT;
  const imageHeight = input.imageHeight ?? 630;
  const imageWidth = input.imageWidth ?? 1200;
  const siteName = input.siteName ?? BRAND_NAME;
  const title =
    input.title === siteName ? siteName : `${input.title} · ${siteName}`;

  return {
    title: input.title,
    description: input.description,
    alternates: canonical ? { canonical } : undefined,
    openGraph: {
      type: "website",
      locale: "en_CA",
      siteName,
      title,
      description: input.description,
      url: canonical,
      images: image
        ? [{
            url: image,
            width: imageWidth,
            height: imageHeight,
            alt: imageAlt,
          }]
        : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description: input.description,
      images: image ? [{ url: image, alt: imageAlt }] : undefined,
    },
    robots:
      input.index === false
        ? { index: false, follow: true }
        : { index: true, follow: true },
  };
}
