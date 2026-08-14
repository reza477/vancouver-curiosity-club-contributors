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

export const MAX_PUBLIC_METADATA_DESCRIPTION_LENGTH = 160;
const MIN_USEFUL_METADATA_BOUNDARY_LENGTH = 48;
const GENERIC_EVENT_METADATA_DESCRIPTION = "Event details.";

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

export type PublicEventMetadataDescriptionInput = Readonly<{
  description: string | null;
  fallback: string;
  metaDescription: string | null;
  summary: string | null;
}>;

/**
 * Generates the event's search/social summary independently from its long-form
 * body. It preserves a useful complete sentence when possible and otherwise
 * stops at a complete word before adding one ellipsis character.
 */
export function buildPublicEventMetadataDescription(
  input: PublicEventMetadataDescriptionInput,
): string {
  const fullDescription = normalizedMetadataText(input.description);
  const preferred = normalizedMetadataText(
    input.metaDescription ?? input.summary,
  );
  const fallback =
    normalizedMetadataText(input.fallback) ||
    GENERIC_EVENT_METADATA_DESCRIPTION;
  const source =
    preferred && preferred !== fullDescription ? preferred : fallback;
  return conciseMetadataText(source, fallback);
}

function conciseMetadataText(value: string, fallback: string): string {
  if (value.length <= MAX_PUBLIC_METADATA_DESCRIPTION_LENGTH) return value;

  const sentenceWindow = value.slice(
    0,
    MAX_PUBLIC_METADATA_DESCRIPTION_LENGTH,
  );
  const sentenceBoundaries = [
    ...sentenceWindow.matchAll(/[.!?](?:["'’”)\]])?(?=\s|$)/gu),
  ];
  const sentenceBoundary = sentenceBoundaries.at(-1);
  if (
    sentenceBoundary?.index !== undefined &&
    sentenceBoundary.index + sentenceBoundary[0].length >=
      MIN_USEFUL_METADATA_BOUNDARY_LENGTH
  ) {
    return sentenceWindow
      .slice(0, sentenceBoundary.index + sentenceBoundary[0].length)
      .trimEnd();
  }

  const wordWindow = value.slice(
    0,
    MAX_PUBLIC_METADATA_DESCRIPTION_LENGTH - 1,
  );
  const wordBoundary = wordWindow.lastIndexOf(" ");
  if (wordBoundary >= MIN_USEFUL_METADATA_BOUNDARY_LENGTH) {
    const completeWords = wordWindow
      .slice(0, wordBoundary)
      .replace(/[,:;—–-]+$/u, "")
      .trimEnd();
    if (completeWords) return `${completeWords}…`;
  }

  const normalizedFallback = normalizedMetadataText(fallback);
  if (normalizedFallback && normalizedFallback !== value) {
    return conciseMetadataText(
      normalizedFallback,
      GENERIC_EVENT_METADATA_DESCRIPTION,
    );
  }
  return GENERIC_EVENT_METADATA_DESCRIPTION;
}

function normalizedMetadataText(value: string | null): string {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/\s+/gu, " ").trim()
    : "";
}

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
