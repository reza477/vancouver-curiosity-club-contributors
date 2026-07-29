import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { CsvImportBatchWorkspace } from "@/app/_organizer/CsvImportBatchWorkspace";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { getCsvImportBatch } from "@/lib/server/phase7/imports";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "CSV import batch" };

type RouteParams = Promise<{ id: string }>;

export default async function CsvImportBatchPage({
  params,
}: Readonly<{ params: RouteParams }>) {
  const loaded = await loadOrganizerPageContext("/organizer/imports/[id]");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  if (loaded.context.membership.role === "organizer") forbidden();
  const { id } = await params;

  let batch: Awaited<ReturnType<typeof getCsvImportBatch>> | null = null;
  try {
    batch = await getCsvImportBatch(
      loaded.context.database,
      loaded.context.identity,
      id,
    );
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "not_found",
      route: "/organizer/imports/[id]",
      status: 404,
    });
  }
  if (!batch) {
    return (
      <>
        <PageHeader
          eyebrow="Private import"
          introduction="No batch metadata or row content is being guessed."
          title="Import batch"
        />
        <OrganizerPageState
          action={{ href: "/organizer/imports", label: "View import history" }}
          detail="The batch is unavailable in your current organization, or your access changed."
          heading="Import batch not available."
          tone="error"
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={`CSV import · ${batch.batch.sourceNamespace}`}
        introduction="Review exact persisted preview facts, approve explicit decisions, and apply one bounded row at a time. Refreshing does not lose durable progress."
        title={batch.batch.sourceLabel ?? "Import batch"}
      />
      <CsvImportBatchWorkspace
        initialBatch={batch}
        role={loaded.context.membership.role}
      />
    </>
  );
}

function AccessChanged() {
  return (
    <OrganizerPageState
      detail="Only a current Owner or Administrator can inspect CSV import history."
      heading="Import access is unavailable."
      tone="error"
    />
  );
}
