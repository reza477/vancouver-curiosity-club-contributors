import { notFound } from "next/navigation";
import {
  buildEditorialMetadata,
  EditorialPage,
  EditorialUnavailable,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";

const route = "/accessibility";
const slug = "accessibility";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
    fallbackTitle: "Accessibility",
    path: route,
    route,
    slug,
  });
}

export default async function AccessibilityPage() {
  const loaded = await loadEditorialPage(slug, route);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Accessibility" />;
  }
  return <EditorialPage page={loaded.page} tone="reset-make" />;
}
