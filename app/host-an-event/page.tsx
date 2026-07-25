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

const route = "/host-an-event";
const slug = "host-an-event";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
    fallbackTitle: "Host an Event",
    path: route,
    route,
    slug,
  });
}

export default async function HostAnEventPage() {
  const [loaded, destinations] = await Promise.all([
    loadEditorialPage(slug, route),
    loadCommunityDestinations(route),
  ]);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Host an Event" />;
  }

  return (
    <EditorialPage page={loaded.page} tone="reset-make">
      {destinations.kind === "available" ? (
        <CommunityDestinations
          heading="Connect through a confirmed group"
          links={destinations.links}
        />
      ) : (
        <CommunityDestinationsUnavailable />
      )}
    </EditorialPage>
  );
}
