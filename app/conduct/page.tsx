import { notFound } from "next/navigation";
import {
  buildEditorialMetadata,
  EditorialPage,
  EditorialUnavailable,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";

const route = "/conduct";
const slug = "conduct";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
    fallbackTitle: "Code of Conduct",
    path: route,
    route,
    slug,
  });
}

export default async function ConductPage() {
  const loaded = await loadEditorialPage(slug, route);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Code of Conduct" />;
  }
  return <EditorialPage page={loaded.page} tone="community" />;
}
