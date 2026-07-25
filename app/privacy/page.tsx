import { notFound } from "next/navigation";
import {
  buildEditorialMetadata,
  EditorialPage,
  EditorialUnavailable,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";

const route = "/privacy";
const slug = "privacy";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
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
  return <EditorialPage page={loaded.page} tone="think" />;
}
