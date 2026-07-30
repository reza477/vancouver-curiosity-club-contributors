import type { MetadataRoute } from "next";
import {
  getTrustedRequestOrigin,
  publicUrl,
} from "@/lib/server/public/origin";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await getTrustedRequestOrigin();
  const rules: MetadataRoute.Robots["rules"] = [
    {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/*?*",
        "/_sites-preview",
        "/accept-invitation",
        "/api/",
        "/auth",
        "/callback",
        "/drafts",
        "/invitations",
        "/organizer",
        "/preview",
        "/signin-with-chatgpt",
        "/signout-with-chatgpt",
      ],
    },
  ];

  return origin
    ? {
        rules,
        sitemap: publicUrl("/sitemap.xml", origin),
      }
    : { rules };
}
