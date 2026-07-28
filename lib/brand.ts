import type { Metadata, MetadataRoute } from "next";
import type { ResponsiveMediaAssetDto } from "@/lib/server/media/usage";

export const SHIPPED_BRAND_NAME = "Vancouver Curiosity Club";
export const SHIPPED_BRAND_TAGLINE = "A social calendar with a brain.";
export const SHIPPED_BRAND_PALETTE = Object.freeze({
  accent: "#2156D8",
  background: "#F5F0E6",
  foreground: "#142C30",
  secondary: "#0C665E",
});
export const SHIPPED_BRAND_TYPOGRAPHY = "editorial";

type BrandArtworkIdentity = Readonly<{
  brandName: string;
  logoAssetId?: string | null;
  openGraphAssetId?: string | null;
  palette?: Readonly<{
    accent: string;
    background: string;
    foreground: string;
    secondary: string;
  }> | null;
  tagline: string;
  typography?: string | null;
}>;

type BrandLogoIdentity = Readonly<{
  brandName: string;
  logoAssetId?: string | null;
  tagline: string;
}>;

export function usesShippedBrandText(
  identity: BrandLogoIdentity | null,
): boolean {
  return (
    !identity ||
    (identity.brandName === SHIPPED_BRAND_NAME &&
      identity.tagline === SHIPPED_BRAND_TAGLINE)
  );
}

export function usesShippedLogoArtwork(
  identity: BrandLogoIdentity | null,
): boolean {
  return usesShippedBrandText(identity) && !identity?.logoAssetId;
}

export function usesShippedSocialArtwork(
  identity: BrandArtworkIdentity | null,
): boolean {
  return (
    usesShippedVisualSystem(identity) &&
    !identity?.logoAssetId &&
    !identity?.openGraphAssetId
  );
}

export function usesShippedVisualSystem(
  identity: BrandArtworkIdentity | null,
): boolean {
  if (!identity) return true;
  const palette = identity.palette;
  return (
    usesShippedBrandText(identity) &&
    identity.typography === SHIPPED_BRAND_TYPOGRAPHY &&
    Boolean(palette) &&
    palette?.accent.toUpperCase() === SHIPPED_BRAND_PALETTE.accent &&
    palette.background.toUpperCase() ===
      SHIPPED_BRAND_PALETTE.background &&
    palette.foreground.toUpperCase() ===
      SHIPPED_BRAND_PALETTE.foreground &&
    palette.secondary.toUpperCase() ===
      SHIPPED_BRAND_PALETTE.secondary
  );
}

export function requiresCompleteBrandArtwork(
  identity: BrandArtworkIdentity,
): boolean {
  return (
    !usesShippedBrandText(identity) ||
    Boolean(identity.logoAssetId)
  );
}

export function buildRootMetadataIcons(
  site: BrandArtworkIdentity | null,
  logo: ResponsiveMediaAssetDto | null,
): Metadata["icons"] {
  if (usesShippedLogoArtwork(site)) {
    return {
      icon: [
        { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
        { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
        { url: "/icon.png", sizes: "64x64", type: "image/png" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: [
        {
          url: "/apple-touch-icon.png",
          sizes: "180x180",
          type: "image/png",
        },
      ],
    };
  }
  if (!logo) return undefined;
  const variant = logo.variants.webp480;
  return {
    icon: [
      {
        url: variant.url,
        sizes: `${variant.width}x${variant.height}`,
        type: "image/webp",
      },
    ],
    apple: [
      {
        url: variant.url,
        sizes: `${variant.width}x${variant.height}`,
        type: "image/webp",
      },
    ],
  };
}

export function buildPublicManifest(
  site:
    | (Readonly<{
        brandName: string;
        palette: Readonly<{
          background: string;
          foreground: string;
        }> | null;
        tagline: string;
      }> & Readonly<{ logoAssetId?: string | null }>)
    | null,
  logo: ResponsiveMediaAssetDto | null,
): MetadataRoute.Manifest {
  const name = site?.brandName ?? SHIPPED_BRAND_NAME;
  const shortName = site?.brandName.slice(0, 30) ?? "Curiosity Club";
  const description = site?.tagline ?? SHIPPED_BRAND_TAGLINE;
  const backgroundColor = site?.palette?.background ?? "#f4efe5";
  const themeColor = site?.palette?.foreground ?? "#061a3a";
  return {
    name,
    short_name: shortName,
    description,
    start_url: "/",
    display: "standalone",
    background_color: backgroundColor,
    theme_color: themeColor,
    icons: manifestIcons(site, logo),
  };
}

function manifestIcons(
  site: BrandLogoIdentity | null,
  logo: ResponsiveMediaAssetDto | null,
): MetadataRoute.Manifest["icons"] {
  if (usesShippedLogoArtwork(site)) {
    return [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ];
  }
  if (!logo) return [];
  const variant = logo.variants.webp480;
  return [
    {
      src: variant.url,
      sizes: `${variant.width}x${variant.height}`,
      type: "image/webp",
      purpose: "any",
    },
  ];
}
