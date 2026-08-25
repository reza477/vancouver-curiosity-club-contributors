import { notFound, permanentRedirect } from "next/navigation";
import {
  buildEditorialMetadata,
  EditorialPage,
  EditorialUnavailable,
  loadEditorialPage,
  loadEditorialRedirect,
} from "@/app/_components/EditorialPage";

export const dynamic = "force-dynamic";

const retiredPublicPageSlugs = new Set(["accessibility"]);

type PublicPageProps = Readonly<{
  params: Promise<{ slug: string }>;
}>;

export async function generateMetadata({ params }: PublicPageProps) {
  const { slug } = await params;
  if (retiredPublicPageSlugs.has(slug)) notFound();
  return buildEditorialMetadata({
    fallbackTitle: "Page",
    path: `/${slug}`,
    route: `/${slug}`,
    slug,
  });
}

export default async function DynamicPublicPage({ params }: PublicPageProps) {
  const { slug } = await params;
  if (retiredPublicPageSlugs.has(slug)) notFound();
  const route = `/${slug}`;
  const loaded = await loadEditorialPage(slug, route);
  if (loaded.kind === "missing") {
    const redirect = await loadEditorialRedirect(slug, route);
    if (redirect.kind === "available") {
      if (retiredPublicPageSlugs.has(redirect.slug)) notFound();
      permanentRedirect(`/${redirect.slug}`);
    }
    if (redirect.kind === "unavailable") {
      return <EditorialUnavailable title="Page" />;
    }
    notFound();
  }
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Page" />;
  }
  return <EditorialPage page={loaded.page} tone="think" />;
}
