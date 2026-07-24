import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Vancouver Curiosity Club";
const description =
  "Talks, walks, workshops, and odd little investigations for people who like learning out loud.";
const socialImageAlt =
  "Vancouver Curiosity Club — A social calendar with a brain.";

async function requestOrigin(): Promise<URL> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = (forwardedHost ?? requestHeaders.get("host") ?? "")
    .split(",")[0]
    .trim();
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    .trim();
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https";

  if (/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) {
    return new URL(`${protocol}://${host}/`);
  }

  return new URL("http://localhost:3000/");
}

export async function generateMetadata(): Promise<Metadata> {
  const metadataBase = await requestOrigin();
  const socialImage = new URL("/og.png", metadataBase).toString();

  return {
    metadataBase,
    title: {
      default: title,
      template: `%s · ${title}`,
    },
    description,
    applicationName: title,
    icons: {
      icon: [{ url: "/icon.png", sizes: "64x64", type: "image/png" }],
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
      images: [
        {
          alt: socialImageAlt,
          height: 630,
          url: socialImage,
          width: 1200,
        },
      ],
      locale: "en_CA",
      siteName: title,
      title,
      type: "website",
      url: metadataBase,
    },
    twitter: {
      card: "summary_large_image",
      description,
      images: [{ alt: socialImageAlt, url: socialImage }],
      title,
    },
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-CA">
      <body>{children}</body>
    </html>
  );
}
