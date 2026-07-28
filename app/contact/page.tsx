import { notFound } from "next/navigation";
import {
  buildEditorialMetadata,
  EditorialUnavailable,
  hasCommunityLinksBlock,
  loadCommunityDestinations,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";
import { ContactRouteBody } from "@/app/_components/EditorialRouteBodies";

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
  const loaded = await loadEditorialPage(slug, route);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Contact" />;
  }

  const destinations = hasCommunityLinksBlock(loaded.page)
    ? null
    : await loadCommunityDestinations(route);
  return <ContactRouteBody destinations={destinations} page={loaded.page} />;
}
