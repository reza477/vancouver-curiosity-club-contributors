import { notFound } from "next/navigation";
import {
  buildEditorialMetadata,
  EditorialUnavailable,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";
import { GetInvolvedRouteBody } from "@/app/_components/EditorialRouteBodies";
import { PublicSubmissionForm } from "@/app/_components/PublicSubmissionForm";

const route = "/get-involved";
const slug = "get-involved";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
    descriptionOverride:
      "Ways to attend, volunteer, host a public program, or begin a partnership conversation with Vancouver Curiosity Club.",
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

  return (
    <GetInvolvedRouteBody page={loaded.page}>
      <PublicSubmissionForm formKey="volunteer" id="volunteer" />
    </GetInvolvedRouteBody>
  );
}
