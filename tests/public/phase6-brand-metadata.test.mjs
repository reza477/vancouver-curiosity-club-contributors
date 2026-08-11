import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  buildPublicPageMetadataForOrigin,
} from "../../lib/server/public/metadata.ts";
import {
  buildPublicManifest,
  buildRootMetadataIcons,
  LEGACY_SHIPPED_BRAND_PALETTE,
  requiresCompleteBrandArtwork,
  resolvePublicBrandPalette,
  SHIPPED_BRAND_NAME,
  SHIPPED_BRAND_PALETTE,
  SHIPPED_BRAND_TAGLINE,
  usesShippedSocialArtwork,
} from "../../lib/brand.ts";

test("the legacy published palette resolves to the modern shipped color system", () => {
  assert.deepEqual(
    resolvePublicBrandPalette(LEGACY_SHIPPED_BRAND_PALETTE),
    SHIPPED_BRAND_PALETTE,
  );
  const manifest = buildPublicManifest(
    {
      brandName: SHIPPED_BRAND_NAME,
      logoAssetId: null,
      palette: LEGACY_SHIPPED_BRAND_PALETTE,
      tagline: SHIPPED_BRAND_TAGLINE,
    },
    null,
  );
  assert.equal(manifest.background_color, SHIPPED_BRAND_PALETTE.background);
  assert.equal(manifest.theme_color, SHIPPED_BRAND_PALETTE.foreground);
});

const customSite = Object.freeze({
  brandName: "Synthetic Field Notes",
  footerMission: "Synthetic test footer.",
  legalFooter: null,
  legalName: null,
  locationLabel: "Vancouver, British Columbia",
  logoAssetId: "asset-brand",
  metaDescription: "Synthetic metadata for a local-only regression.",
  mission: "Synthetic test mission.",
  openGraphAssetId: "asset-brand",
  palette: Object.freeze({
    accent: "#2156d8",
    background: "#f5f0e6",
    foreground: "#142c30",
    secondary: "#0c665e",
  }),
  seoTitle: "Synthetic Field Notes",
  tagline: "A synthetic test tagline.",
  typography: "editorial",
});

const customMedia = Object.freeze({
  altText: "Synthetic abstract editorial mark.",
  assetId: "asset-brand",
  caption: null,
  credit: "Synthetic test fixture",
  focalPoint: Object.freeze({ x: 5_000, y: 5_000 }),
  variants: Object.freeze({
    webp480: Object.freeze({
      height: 320,
      url: "/media/asset-brand/webp_480",
      width: 480,
    }),
    webp960: Object.freeze({
      height: 640,
      url: "/media/asset-brand/webp_960",
      width: 960,
    }),
    webp1600: Object.freeze({
      height: 1_067,
      url: "/media/asset-brand/webp_1600",
      width: 1_600,
    }),
  }),
});

const page = Object.freeze({
  metaDescription: "A synthetic page description.",
  openGraphAssetId: "asset-brand",
  sections: Object.freeze([]),
  seoTitle: "Synthetic About",
  slug: "about",
  title: "Synthetic About",
});

test("custom brand metadata, social image, header, and manifest use only approved live assets", () => {
  const metadata = buildPublicPageMetadataForOrigin({
    description: page.metaDescription,
    imageAlt: customMedia.altText,
    imageHeight: customMedia.variants.webp1600.height,
    imagePath: customMedia.variants.webp1600.url,
    imageWidth: customMedia.variants.webp1600.width,
    pathname: "/about",
    siteName: customSite.brandName,
    title: page.seoTitle,
  }, new URL("https://example.test"));
  assert.equal(metadata.title, "Synthetic About");
  assert.equal(
    metadata.openGraph.siteName,
    "Synthetic Field Notes",
  );
  assert.equal(
    metadata.openGraph.images[0].url,
    "https://example.test/media/asset-brand/webp_1600",
  );
  assert.equal(
    metadata.openGraph.images[0].alt,
    "Synthetic abstract editorial mark.",
  );
  assert.equal(
    metadata.twitter.images[0].url,
    "https://example.test/media/asset-brand/webp_1600",
  );
  assert.equal(
    metadata.alternates.canonical,
    "https://example.test/about",
  );

  const manifest = buildPublicManifest(customSite, customMedia);
  assert.equal(manifest.name, "Synthetic Field Notes");
  assert.deepEqual(manifest.icons, [
    {
      purpose: "any",
      sizes: "480x320",
      src: "/media/asset-brand/webp_480",
      type: "image/webp",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(manifest), /icon-192|icon-512/u);
  const rootIcons = buildRootMetadataIcons(customSite, customMedia);
  assert.deepEqual(rootIcons.icon, [
    {
      sizes: "480x320",
      type: "image/webp",
      url: "/media/asset-brand/webp_480",
    },
  ]);
  assert.deepEqual(rootIcons.apple, rootIcons.icon);

  const header = readFileSync(
    join(process.cwd(), "app", "_components", "SiteHeader.tsx"),
    "utf8",
  );
  assert.match(header, /\{brandName\}/u);
  assert.match(
    header,
    /`\/media\/\$\{encodeURIComponent\([\s\S]*logoAssetId/u,
  );
});

test("a custom identity never falls back to VCC social or icon artwork", () => {
  const metadata = buildPublicPageMetadataForOrigin({
    description: page.metaDescription,
    imagePath: null,
    pathname: "/about",
    siteName: customSite.brandName,
    title: page.seoTitle,
  }, new URL("https://example.test"));
  assert.equal(metadata.openGraph.images, undefined);
  assert.equal(metadata.twitter.images, undefined);
  assert.equal(metadata.twitter.card, "summary");
  assert.deepEqual(buildPublicManifest(customSite, null).icons, []);

  const layout = readFileSync(
    join(process.cwd(), "app", "layout.tsx"),
    "utf8",
  );
  assert.match(layout, /buildRootMetadataIcons\(publicSite, publicLogo\)/u);

  const logoOnly = {
    ...customSite,
    brandName: SHIPPED_BRAND_NAME,
    openGraphAssetId: null,
    tagline: SHIPPED_BRAND_TAGLINE,
  };
  assert.equal(
    buildPublicManifest(logoOnly, customMedia).icons[0].src,
    "/media/asset-brand/webp_480",
  );
  assert.equal(
    buildRootMetadataIcons(logoOnly, customMedia).icon[0].url,
    "/media/asset-brand/webp_480",
  );

  const socialOnly = {
    ...logoOnly,
    logoAssetId: null,
    openGraphAssetId: "asset-brand",
  };
  assert.equal(
    buildPublicManifest(socialOnly, null).icons[0].src,
    "/icon-192.png",
    "an Open Graph-only selection must not replace the shipped logo icons",
  );
  assert.equal(usesShippedSocialArtwork(socialOnly), false);

  const paletteOnly = {
    ...socialOnly,
    openGraphAssetId: null,
    palette: {
      ...SHIPPED_BRAND_PALETTE,
      background: "#D0D8D6",
    },
  };
  assert.equal(
    requiresCompleteBrandArtwork(paletteOnly),
    false,
    "a palette-only update may publish without inventing custom logo assets",
  );
  assert.equal(
    buildPublicManifest(paletteOnly, null).icons[0].src,
    "/icon-192.png",
    "palette-only changes keep the coherent shipped icon set",
  );
  assert.equal(
    usesShippedSocialArtwork(paletteOnly),
    false,
    "palette-only changes must not reuse the static VCC social card",
  );
});
