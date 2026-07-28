import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import {
  MediaLibrary,
  type MediaAssetView,
  type MediaCleanupPendingView,
} from "@/app/_organizer/MediaLibrary";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import {
  listMediaAssets,
  listPendingMediaCleanups,
} from "@/lib/server/media/storage";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Media library" };

export default async function OrganizerMediaPage() {
  const loaded = await loadOrganizerPageContext("/organizer/media");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  if (
    loaded.context.membership.role !== "owner" &&
    loaded.context.membership.role !== "administrator"
  ) {
    forbidden();
  }

  let assets: readonly MediaAssetView[] | null = null;
  let cleanupPending: readonly MediaCleanupPendingView[] = [];
  try {
    [assets, cleanupPending] = await Promise.all([
      listMediaAssets(
        loaded.context.database,
        loaded.context.identity,
        { limit: 50 },
      ),
      listPendingMediaCleanups(
        loaded.context.database,
        loaded.context.identity,
        { limit: 25 },
      ),
    ]);
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/media",
      status: 500,
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Phase 6 · R2 media"
        introduction="Upload immutable artwork, record rights and consent, and choose only approved ready assets for public use. Object keys and private provenance never leave this workspace."
        title="Media library"
      />
      {assets ? (
        <MediaLibrary assets={assets} cleanupPending={cleanupPending} />
      ) : (
        <OrganizerPageState
          detail="No filenames, object keys, or substitute media are being shown."
          heading="The private media library is temporarily unavailable."
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
