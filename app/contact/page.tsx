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
    descriptionOverride:
      "Contact Vancouver Curiosity Club about partnerships, events, accessibility, media, or another question.",
    fallbackTitle: "Contact",
    path: route,
    route,
    slug,
    titleOverride: "Contact",
  });
}

type PageSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function ContactPage({
  searchParams,
}: Readonly<{ searchParams: PageSearchParams }>) {
  const params = await searchParams;
  const loaded = await loadEditorialPage(slug, route);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Contact" />;
  }

  return (
    <ContactRouteBody page={loaded.page}>
      <PublicSubmissionForm
        formKey="contact"
        id="contact-form"
        initialContactTopic={
          params.topic === "partnerships" ? "Partnerships" : undefined
        }
      />
    </ContactRouteBody>
  );
}
