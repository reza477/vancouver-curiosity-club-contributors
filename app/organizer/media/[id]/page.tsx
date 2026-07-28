import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import {
  MediaMetadataEditor,
  type MediaAssetView,
} from "@/app/_organizer/MediaLibrary";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import {
  MediaAssetNotFoundError,
  readMediaAsset,
} from "@/lib/server/media/storage";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Media details" };

type MediaPageProps = Readonly<{
  params: Promise<{ id: string }>;
}>;

export default async function OrganizerMediaDetailPage({
  params,
}: MediaPageProps) {
  const { id } = await params;
  const loaded = await loadOrganizerPageContext(
    `/organizer/media/${encodeURIComponent(id)}`,
  );
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  if (
    loaded.context.membership.role !== "owner" &&
    loaded.context.membership.role !== "administrator"
  ) {
    forbidden();
  }

  let asset: MediaAssetView | null = null;
  try {
    asset = await readMediaAsset(
      loaded.context.database,
      loaded.context.identity,
      id,
    );
  } catch (error) {
    if (error instanceof MediaAssetNotFoundError) notFound();
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/media/[id]",
      status: 500,
    });
  }

  return (
    <>
      <PageHeader
        action={{ href: "/organizer/media", label: "Back to media" }}
        eyebrow="Phase 6 · Media provenance"
        introduction="Approval, consent, credit, alt text, and current usage determine whether this immutable artwork may appear publicly."
        title="Media details"
      />
      {asset ? (
        <MediaMetadataEditor asset={asset} />
      ) : (
        <OrganizerPageState
          detail="No object key, private note, or substitute file is being shown."
          heading="The media record is temporarily unavailable."
          tone="error"
        />
      )}
    </>
  );
}

function AccessChanged() {
  return (
    <OrganizerPageState
      detail="Only a current Owner or Administrator can manage media."
      heading="Media access is unavailable."
      tone="error"
    />
  );
}
