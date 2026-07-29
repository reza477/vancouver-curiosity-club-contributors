import { notFound } from "next/navigation";
import {
  buildEditorialMetadata,
  EditorialUnavailable,
  hasCommunityLinksBlock,
  loadCommunityDestinations,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";
import { GetInvolvedRouteBody } from "@/app/_components/EditorialRouteBodies";
import { PublicSubmissionForm } from "@/app/_components/PublicSubmissionForm";

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
  const loaded = await loadEditorialPage(slug, route);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Get Involved" />;
  }

  const destinations = hasCommunityLinksBlock(loaded.page)
    ? null
    : await loadCommunityDestinations(route);
  return (
    <GetInvolvedRouteBody destinations={destinations} page={loaded.page}>
      <PublicSubmissionForm formKey="volunteer" id="volunteer" />
      <PublicSubmissionForm formKey="partnership" id="partner" />
    </GetInvolvedRouteBody>
  );
}
