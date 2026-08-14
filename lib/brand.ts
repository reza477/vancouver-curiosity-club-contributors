import type { Metadata, MetadataRoute } from "next";
import type { ResponsiveMediaAssetDto } from "@/lib/server/media/usage";

export const SHIPPED_BRAND_NAME = "Vancouver Curiosity Club";
export const SHIPPED_BRAND_TAGLINE = "A social calendar with a brain.";
export const LEGACY_SHIPPED_BRAND_PALETTE = Object.freeze({
  accent: "#2156D8",
  background: "#F5F0E6",
  foreground: "#142C30",
  secondary: "#0C665E",
});
const VIOLET_SHIPPED_BRAND_PALETTE = Object.freeze({
  accent: "#5B2CC9",
  background: "#FFF9F5",
  foreground: "#221C3D",
  secondary: "#2457D6",
});
export const SHIPPED_BRAND_PALETTE = Object.freeze({
  accent: "#B8402B",
  background: "#FBF7F0",
  foreground: "#131C33",
  secondary: "#1F5F5B",
});
export const SHIPPED_BRAND_TYPOGRAPHY = "editorial";

export type BrandPalette = Readonly<{
  accent: string;
  background: string;
  foreground: string;
  secondary: string;
}>;

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
    palette !== null &&
    palette !== undefined &&
    (matchesBrandPalette(palette, SHIPPED_BRAND_PALETTE) ||
      matchesBrandPalette(palette, VIOLET_SHIPPED_BRAND_PALETTE) ||
      matchesBrandPalette(palette, LEGACY_SHIPPED_BRAND_PALETTE))
  );
}

export function resolvePublicBrandPalette(
  palette: BrandPalette | null | undefined,
): BrandPalette | null {
  if (!palette) return null;
  return matchesBrandPalette(palette, LEGACY_SHIPPED_BRAND_PALETTE) ||
    matchesBrandPalette(palette, VIOLET_SHIPPED_BRAND_PALETTE)
    ? SHIPPED_BRAND_PALETTE
    : palette;
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
        palette: BrandPalette | null;
        tagline: string;
      }> & Readonly<{ logoAssetId?: string | null }>)
    | null,
  logo: ResponsiveMediaAssetDto | null,
): MetadataRoute.Manifest {
  const name = site?.brandName ?? SHIPPED_BRAND_NAME;
  const shortName = site?.brandName.slice(0, 30) ?? "Curiosity Club";
  const description = site?.tagline ?? SHIPPED_BRAND_TAGLINE;
  const palette = resolvePublicBrandPalette(site?.palette);
  const backgroundColor =
    palette?.background ?? SHIPPED_BRAND_PALETTE.background;
  const themeColor = palette?.foreground ?? SHIPPED_BRAND_PALETTE.foreground;
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

function matchesBrandPalette(
  palette: BrandPalette,
  expected: BrandPalette,
): boolean {
  return (
    palette.accent.toUpperCase() === expected.accent &&
    palette.background.toUpperCase() === expected.background &&
    palette.foreground.toUpperCase() === expected.foreground &&
    palette.secondary.toUpperCase() === expected.secondary
  );
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
