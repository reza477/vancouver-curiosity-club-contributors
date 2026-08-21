import { notFound } from "next/navigation";
import {
  buildEditorialMetadata,
  EditorialPage,
  EditorialUnavailable,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";
import { PublicFormPrivacyNotice } from "@/app/_components/PublicFormPrivacyNotice";

const route = "/privacy";
const slug = "privacy";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
    descriptionOverride:
      "How Vancouver Curiosity Club handles information visitors choose to send.",
    fallbackTitle: "Privacy",
    path: route,
    route,
    slug,
  });
}

export default async function PrivacyPage() {
  const loaded = await loadEditorialPage(slug, route);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Privacy" />;
  }
  return (
    <EditorialPage
      displayDeck="How we collect, use, protect, and review information you choose to send."
      displayEyebrow="Community information"
      displayParagraphs={[]}
      displayTitle="Privacy"
      page={loaded.page}
      tone="think"
    >
      <PublicFormPrivacyNotice />
    </EditorialPage>
  );
}
