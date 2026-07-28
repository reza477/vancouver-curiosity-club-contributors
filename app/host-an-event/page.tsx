import { notFound } from "next/navigation";
import {
  buildEditorialMetadata,
  EditorialUnavailable,
  hasCommunityLinksBlock,
  loadCommunityDestinations,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";
import { HostAnEventRouteBody } from "@/app/_components/EditorialRouteBodies";

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
  const loaded = await loadEditorialPage(slug, route);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Host an Event" />;
  }

  const destinations = hasCommunityLinksBlock(loaded.page)
    ? null
    : await loadCommunityDestinations(route);
  return <HostAnEventRouteBody destinations={destinations} page={loaded.page} />;
}
