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

const route = "/community";
const slug = "community";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
    fallbackTitle: "Community",
    path: route,
    route,
    slug,
  });
}

export default async function CommunityPage() {
  const [loaded, destinations] = await Promise.all([
    loadEditorialPage(slug, route),
    loadCommunityDestinations(route),
  ]);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Community" />;
  }

  return (
    <EditorialPage page={loaded.page} tone="community">
      {destinations.kind === "available" ? (
        <CommunityDestinations links={destinations.links} />
      ) : (
        <CommunityDestinationsUnavailable />
      )}
    </EditorialPage>
  );
}
