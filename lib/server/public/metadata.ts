import type { Metadata } from "next";
import {
  getTrustedRequestOrigin,
  publicUrl,
} from "@/lib/server/public/origin";

const BRAND_NAME = "Vancouver Curiosity Club";
const SOCIAL_IMAGE_ALT =
  "Vancouver Curiosity Club — A social calendar with a brain.";

export async function buildPublicPageMetadata(input: Readonly<{
  description: string;
  index?: boolean;
  pathname: string;
  title: string;
}>): Promise<Metadata> {
  const origin = await getTrustedRequestOrigin();
  const canonical = origin ? publicUrl(input.pathname, origin) : undefined;
  const image = origin ? publicUrl("/og.png", origin) : undefined;
  const title =
    input.title === BRAND_NAME
      ? BRAND_NAME
      : `${input.title} · ${BRAND_NAME}`;

  return {
    title: input.title,
    description: input.description,
    alternates: canonical ? { canonical } : undefined,
    openGraph: {
      type: "website",
      locale: "en_CA",
      siteName: BRAND_NAME,
      title,
      description: input.description,
      url: canonical,
      images: image
        ? [{ url: image, width: 1200, height: 630, alt: SOCIAL_IMAGE_ALT }]
        : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: input.description,
      images: image ? [{ url: image, alt: SOCIAL_IMAGE_ALT }] : undefined,
    },
    robots:
      input.index === false
        ? { index: false, follow: true }
        : { index: true, follow: true },
  };
}
