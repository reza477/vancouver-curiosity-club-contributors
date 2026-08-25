import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { SiteFooter } from "@/app/_components/SiteFooter";
import { SiteHeader } from "@/app/_components/SiteHeader";
import {
  getTrustedRequestOrigin,
  getTrustedRequestPathname,
} from "@/lib/server/public/origin";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import {
  type PublicNavigationItemDto,
  type PublicSiteContextDto,
} from "@/lib/server/public/catalog";
import {
  getRequestPublicNavigation,
  getRequestPublicOrganization,
  getRequestPublishedSiteLogo,
  getRequestPublicSiteContext,
} from "@/lib/server/public/request-cache";
import type { ResponsiveMediaAssetDto } from "@/lib/server/media/usage";
import {
  buildRootMetadataIcons,
  resolvePublicBrandPalette,
  SHIPPED_BRAND_NAME,
  SHIPPED_BRAND_PALETTE,
} from "@/lib/brand";
import { isPrivateOrIdentityPath } from "@/lib/request-pathname";
import "./globals.css";

const title = SHIPPED_BRAND_NAME;
const description =
  "Talks, walks, workshops, and odd little investigations for people who like learning out loud.";
const exactApplicationPaths = new Set([
  "/",
  "/about",
  "/accept-invitation",
  "/calendar",
  "/clubs",
  "/community",
  "/conduct",
  "/contact",
  "/events",
  "/for-organizations",
  "/get-involved",
  "/host-an-event",
  "/organizer",
  "/privacy",
  "/resources",
]);

function isKnownApplicationPath(pathname: string | null): boolean {
  if (!pathname || exactApplicationPaths.has(pathname)) return true;
  if (isPrivateOrIdentityPath(pathname)) return true;
  return ["/clubs/", "/events/", "/media/"].some((prefix) =>
    pathname.startsWith(prefix),
  );
}

function isPrivateApplicationPath(pathname: string | null): boolean {
  return pathname !== null && isPrivateOrIdentityPath(pathname);
}

export async function generateMetadata(): Promise<Metadata> {
  const [metadataBase, requestPathname] = await Promise.all([
    getTrustedRequestOrigin(),
    getTrustedRequestPathname(),
  ]);
  const isUnknownPath = !isKnownApplicationPath(requestPathname);
  const isPrivatePath = isPrivateApplicationPath(requestPathname);
  let brandName = title;
  let siteTitle = title;
  let siteDescription = description;
  let publishedThemeColor: string = SHIPPED_BRAND_PALETTE.foreground;
  let publicSite: PublicSiteContextDto | null = null;
  let publicLogo: ResponsiveMediaAssetDto | null = null;
  if (!isPrivatePath) {
    try {
      const { database } = getRuntimeAuthConfiguration();
      const [site, organization] = await Promise.all([
        getRequestPublicSiteContext(database),
        getRequestPublicOrganization(database),
      ]);
      publicSite = site;
      if (site) {
        brandName = site.brandName;
        siteTitle = site.seoTitle ?? site.brandName;
        siteDescription = site.metaDescription ?? site.mission;
        publishedThemeColor =
          resolvePublicBrandPalette(site.palette)?.foreground ??
          publishedThemeColor;
        if (organization && site.logoAssetId) {
          publicLogo = await getRequestPublishedSiteLogo(database, {
            assetId: site.logoAssetId,
            organizationId: organization.id,
          });
        }
      }
    } catch {
      // Keep the truthful shipped metadata baseline if D1 is unavailable.
    }
  }
  const documentTitle = isUnknownPath
    ? `Page not found · ${siteTitle}`
    : siteTitle;
  return {
    metadataBase: metadataBase ?? undefined,
    title: isUnknownPath
      ? documentTitle
      : {
          default: siteTitle,
          template: `%s · ${siteTitle}`,
        },
    description: siteDescription,
    applicationName: brandName,
    manifest: "/manifest.webmanifest",
    icons: buildRootMetadataIcons(publicSite, publicLogo),
    themeColor: publishedThemeColor,
    robots:
      isUnknownPath || isPrivatePath
        ? {
            index: false,
            follow: false,
            noarchive: true,
            nocache: true,
            noimageindex: true,
          }
        : undefined,
  };
}

type PublicShell = Readonly<{
  brandName: string;
  externalLinks: readonly Readonly<{ href: string; label: string }>[];
  footerNavigation: readonly PublicNavigationItemDto[];
  headerNavigation: readonly PublicNavigationItemDto[];
  legalFooter: string | null;
  legalName: string | null;
  location: string;
  logoAssetId: string | null;
  mission: string;
  palette: Readonly<{
    accent: string;
    background: string;
    foreground: string;
    secondary: string;
  }> | null;
  typography: "editorial" | "humanist" | "system";
}>;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestPathname = await getTrustedRequestPathname();
  const isPrivatePath = isPrivateApplicationPath(requestPathname);
  let shell: PublicShell | undefined;
  if (!isPrivatePath) {
    try {
      const { database } = getRuntimeAuthConfiguration();
      const [site, navigation, organization] = await Promise.all([
        getRequestPublicSiteContext(database),
        getRequestPublicNavigation(database),
        getRequestPublicOrganization(database),
      ]);
      if (site) {
        let logoAssetId: string | null = null;
        if (organization && site.logoAssetId) {
          logoAssetId =
            (
              await getRequestPublishedSiteLogo(database, {
                assetId: site.logoAssetId,
                organizationId: organization.id,
              })
            )?.assetId ?? null;
        }
        shell = {
          brandName: site.brandName,
          externalLinks: [],
          footerNavigation: navigation.footer,
          headerNavigation: navigation.header,
          legalFooter: site.legalFooter,
          legalName: site.legalName,
          location: site.locationLabel,
          logoAssetId,
          mission: site.footerMission,
          palette: site.palette,
          typography: site.typography,
        };
      }
    } catch {
      // The public shell remains navigable without inventing unavailable
      // catalog content. Route-level states report D1 availability.
    }
  }
  const publicPalette = resolvePublicBrandPalette(shell?.palette);
  const publicStyle = publicPalette
    ? ({
        "--cms-accent": publicPalette.accent,
        "--cms-background": publicPalette.background,
        "--cms-foreground": publicPalette.foreground,
        "--cms-secondary": publicPalette.secondary,
      } as CSSProperties)
    : undefined;

  return (
    <html lang="en-CA">
      <head>
        <link
          rel="preload"
          href="/fonts/fraunces-72pt-latin-400-600.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/inter-latin-400-700.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body
        data-surface={isPrivatePath ? "organizer" : "public"}
        data-typography={isPrivatePath ? undefined : shell?.typography}
        style={isPrivatePath ? undefined : publicStyle}
      >
        <a
          className="skip-link"
          href={isPrivatePath ? "#organizer-main" : "#page-content"}
        >
          Skip to main content
        </a>
        {isPrivatePath ? null : (
          <SiteHeader
            brandName={shell?.brandName}
            logoAssetId={shell?.logoAssetId}
            navigation={shell?.headerNavigation}
          />
        )}
        <div className="site-content" id="page-content" tabIndex={-1}>
          {children}
        </div>
        {isPrivatePath ? null : (
          <SiteFooter
            brandName={shell?.brandName}
            externalLinks={shell?.externalLinks}
            legalFooter={shell?.legalFooter}
            legalName={shell?.legalName}
            location={shell?.location}
            mission={shell?.mission}
            navigation={shell?.footerNavigation}
          />
        )}
      </body>
    </html>
  );
}
