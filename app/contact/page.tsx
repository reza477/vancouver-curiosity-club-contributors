import { notFound } from "next/navigation";
import {
  buildEditorialMetadata,
  CommunityDestinations,
  CommunityDestinationsUnavailable,
  EditorialPage,
  EditorialUnavailable,
  loadCommunityDestinations,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";

const route = "/contact";
const slug = "contact";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
    fallbackTitle: "Contact",
    path: route,
    route,
    slug,
  });
}

export default async function ContactPage() {
  const [loaded, destinations] = await Promise.all([
    loadEditorialPage(slug, route),
    loadCommunityDestinations(route),
  ]);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Contact" />;
  }

  return (
    <EditorialPage page={loaded.page} tone="community">
      {destinations.kind === "available" ? (
        <CommunityDestinations
          heading="Choose the relevant Meetup group"
          links={destinations.links}
        />
      ) : (
        <CommunityDestinationsUnavailable />
      )}
    </EditorialPage>
  );
}
