import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { Phase7ExportsPanel } from "@/app/_organizer/Phase7ExportsPanel";
import { loadMediaManifestEntries } from "@/lib/server/phase7/private-exports";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Exports" };

export default async function OrganizerExportsPage() {
  const loaded = await loadOrganizerPageContext("/organizer/exports");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  const { membership } = loaded.context;
  if (membership.role === "organizer") forbidden();

  let mediaAssets: Awaited<ReturnType<typeof loadMediaManifestEntries>> = [];
  if (membership.role === "owner") {
    try {
      mediaAssets = await loadMediaManifestEntries(
        loaded.context.database,
        membership.organizationId,
      );
    } catch {
      writeSafeLog("error", "organizer_page_failed", {
        code: "internal_error",
        route: "/organizer/exports",
        status: 500,
      });
      return (
        <OrganizerPageState
          detail="No export data or media identifiers are being shown."
          heading="The export workspace is temporarily unavailable."
          tone="error"
        />
      );
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Phase 7 · allowlisted downloads"
        introduction="Download bounded operational data without exposing identity, tokens, form content, conflict reasons, source-feed secrets, or storage keys."
        title="Exports and owner backup"
      />
      <Phase7ExportsPanel
        mediaAssets={mediaAssets.map((asset) => ({
          fileName: asset.fileName,
          id: asset.id,
          mimeType: asset.mimeType,
          sha256: asset.sha256,
        }))}
        role={membership.role}
      />
    </>
  );
}

function AccessChanged() {
  return (
    <OrganizerPageState
      detail="Only a current Owner or Administrator can use private exports."
      heading="Export access is unavailable."
      tone="error"
    />
  );
}
