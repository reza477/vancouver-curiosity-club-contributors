import type { Metadata } from "next";
import { SiteFooter } from "@/app/_components/SiteFooter";
import { SiteHeader } from "@/app/_components/SiteHeader";
import {
  getTrustedRequestOrigin,
  getTrustedRequestPathname,
  publicUrl,
} from "@/lib/server/public/origin";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { loadPublicCatalog } from "@/lib/server/public/catalog";
import "./globals.css";

const title = "Vancouver Curiosity Club";
const description =
  "Talks, walks, workshops, and odd little investigations for people who like learning out loud.";
const socialImageAlt =
  "Vancouver Curiosity Club — A social calendar with a brain.";

const exactApplicationPaths = new Set([
  "/",
  "/about",
  "/accessibility",
  "/calendar",
  "/clubs",
  "/community",
  "/conduct",
  "/contact",
  "/events",
  "/get-involved",
  "/host-an-event",
  "/privacy",
]);

function isKnownApplicationPath(pathname: string | null): boolean {
  if (!pathname || exactApplicationPaths.has(pathname)) return true;
  return [
    "/accept-invitation/",
    "/api/",
    "/auth/",
    "/clubs/",
    "/events/",
    "/organizer/",
    "/preview/",
    "/signin-with-chatgpt/",
    "/signout-with-chatgpt/",
  ].some((prefix) => pathname.startsWith(prefix));
}

export async function generateMetadata(): Promise<Metadata> {
  const [metadataBase, requestPathname] = await Promise.all([
    getTrustedRequestOrigin(),
    getTrustedRequestPathname(),
  ]);
  const isUnknownPath = !isKnownApplicationPath(requestPathname);
  const documentTitle = isUnknownPath ? `Page not found · ${title}` : title;
  const canonicalUrl = metadataBase && !isUnknownPath
    ? publicUrl("/", metadataBase)
    : undefined;
  const socialImage = metadataBase
    ? publicUrl("/og.png", metadataBase)
    : undefined;

  return {
    metadataBase: metadataBase ?? undefined,
    title: isUnknownPath
      ? documentTitle
      : {
          default: title,
          template: `%s · ${title}`,
        },
    description,
    applicationName: title,
    alternates: canonicalUrl ? { canonical: canonicalUrl } : undefined,
    manifest: "/site.webmanifest",
    icons: {
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
    },
    openGraph: {
      description,
      images: socialImage
        ? [
            {
              alt: socialImageAlt,
              height: 630,
              url: socialImage,
              width: 1200,
            },
          ]
        : undefined,
      locale: "en_CA",
      siteName: title,
      title: documentTitle,
      type: "website",
      url: canonicalUrl,
    },
    twitter: {
      card: "summary_large_image",
      description,
      images: socialImage
        ? [{ alt: socialImageAlt, url: socialImage }]
        : undefined,
      title: documentTitle,
    },
    themeColor: "#061a3a",
    robots: isUnknownPath
      ? {
          index: false,
          follow: false,
          noarchive: true,
        }
      : undefined,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let footer:
    | Readonly<{
        brandName: string;
        externalLinks: readonly Readonly<{ href: string; label: string }>[];
        location: string;
        mission: string;
      }>
    | undefined;
  try {
    const { database } = getRuntimeAuthConfiguration();
    const catalog = await loadPublicCatalog(database);
    if (catalog) {
      footer = {
        brandName: catalog.site.brandName,
        location: catalog.site.locationLabel,
        mission: catalog.site.mission,
        externalLinks: catalog.communityLinks.map((link) => ({
          href: link.url,
          label: link.label,
        })),
      };
    }
  } catch {
    // The public shell remains navigable without inventing unavailable
    // catalog content. Route-level states report D1 availability.
  }

  return (
    <html lang="en-CA">
      <body>
        <a className="skip-link" href="#page-content">
          Skip to main content
        </a>
        <SiteHeader />
        <div className="site-content" id="page-content" tabIndex={-1}>
          {children}
        </div>
        <SiteFooter {...footer} />
      </body>
    </html>
  );
}
