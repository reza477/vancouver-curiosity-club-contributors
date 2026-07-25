import Link from "next/link";
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

const route = "/get-involved";
const slug = "get-involved";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
    fallbackTitle: "Get Involved",
    path: route,
    route,
    slug,
  });
}

export default async function GetInvolvedPage() {
  const [loaded, destinations] = await Promise.all([
    loadEditorialPage(slug, route),
    loadCommunityDestinations(route),
  ]);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Get Involved" />;
  }

  return (
    <EditorialPage page={loaded.page} tone="community">
      <section className="editorial-actions" aria-labelledby="ways-heading">
        <div>
          <p className="section-kicker">Ways in</p>
          <h2 id="ways-heading">Start with what is available now.</h2>
        </div>
        <div className="editorial-actions__links">
          <Link href="/events">Explore upcoming events</Link>
          <Link href="/host-an-event">Read about hosting</Link>
        </div>
      </section>
      {destinations.kind === "available" ? (
        <CommunityDestinations links={destinations.links} />
      ) : (
        <CommunityDestinationsUnavailable />
      )}
    </EditorialPage>
  );
}
