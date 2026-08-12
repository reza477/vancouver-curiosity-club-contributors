import { notFound } from "next/navigation";
import {
  buildEditorialMetadata,
  EditorialUnavailable,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";
import { ContactRouteBody } from "@/app/_components/EditorialRouteBodies";
import { PublicSubmissionForm } from "@/app/_components/PublicSubmissionForm";

const route = "/contact";
const slug = "contact";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
    fallbackTitle: "Feedback",
    path: route,
    route,
    slug,
  });
}

export default async function ContactPage() {
  const loaded = await loadEditorialPage(slug, route);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Feedback" />;
  }

  return (
    <ContactRouteBody page={loaded.page}>
      <PublicSubmissionForm formKey="contact" />
    </ContactRouteBody>
  );
}
