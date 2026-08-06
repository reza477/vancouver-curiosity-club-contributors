import { buildEditorialMetadata } from "@/app/_components/EditorialPage";
import { loadCommunityDestinations } from "@/app/_components/EditorialPage";
import { StructuredData } from "@/app/_components/StructuredData";
import CalendarPage from "@/app/calendar/page";
import { SHIPPED_BRAND_NAME } from "@/lib/brand";
import { getTrustedRequestOrigin, publicUrl } from "@/lib/server/public/origin";

export { dynamic } from "./calendar/page";

type PageSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export function generateMetadata() {
  return buildEditorialMetadata({
    absoluteTitle: true,
    fallbackTitle: "Vancouver Curiosity Club",
    path: "/",
    route: "/",
    slug: "home",
  });
}

export default async function HomePage({
  searchParams,
}: Readonly<{ searchParams: PageSearchParams }>) {
  const calendar = await CalendarPage({ searchParams });
  const [origin, destinations] = await Promise.all([
    getTrustedRequestOrigin(),
    loadCommunityDestinations("/"),
  ]);
  return (
    <>
      {calendar}
      {origin && destinations.kind === "available" ? (
        <StructuredData
          value={{
            "@context": "https://schema.org",
            "@type": "Organization",
            name: SHIPPED_BRAND_NAME,
            url: publicUrl("/", origin),
            areaServed: { "@type": "City", name: "Vancouver" },
            sameAs: destinations.links
              .filter(
                (link) =>
                  link.linkType === "meetup_group" ||
                  link.linkType === "social_profile",
              )
              .map((link) => link.url),
          }}
        />
      ) : null}
    </>
  );
}
