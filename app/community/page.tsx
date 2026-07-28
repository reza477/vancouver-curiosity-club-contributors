import { notFound } from "next/navigation";
import {
  buildEditorialMetadata,
  CommunityDestinations,
  CommunityDestinationsUnavailable,
  EditorialPage,
  EditorialUnavailable,
  hasCommunityLinksBlock,
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
  const loaded = await loadEditorialPage(slug, route);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Community" />;
  }

  const hasCommunityBlock = hasCommunityLinksBlock(loaded.page);
  const destinations = hasCommunityBlock
    ? null
    : await loadCommunityDestinations(route);
  return (
    <EditorialPage page={loaded.page} tone="community">
      {destinations?.kind === "available" ? (
        <CommunityDestinations links={destinations.links} />
      ) : destinations ? (
        <CommunityDestinationsUnavailable />
      ) : null}
    </EditorialPage>
  );
}
