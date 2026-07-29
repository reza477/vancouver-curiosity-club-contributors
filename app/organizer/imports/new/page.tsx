import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { CsvImportUploadWorkspace } from "@/app/_organizer/CsvImportUploadWorkspace";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New CSV preview" };

export default async function NewCsvImportPage() {
  const loaded = await loadOrganizerPageContext("/organizer/imports/new");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  if (loaded.context.membership.role === "organizer") forbidden();

  return (
    <>
      <PageHeader
        eyebrow="Local file · no remote imports"
        introduction="Inspect headers, explicitly map allowlisted fields, and persist a non-authoritative preview. The original CSV is never stored in R2."
        title="New CSV event preview"
      />
      <CsvImportUploadWorkspace />
    </>
  );
}

function AccessChanged() {
  return (
    <OrganizerPageState
      detail="Only a current Owner or Administrator can create an import preview."
      heading="Import access is unavailable."
      tone="error"
    />
  );
}
