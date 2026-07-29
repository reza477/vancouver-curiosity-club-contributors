import {
  inspectCsvImportUpload,
} from "@/lib/server/phase7/imports";
import {
  organizerApiError,
  privateOrganizerJson,
  requireOrganizerApiActor,
} from "../../_shared";
import { readCsvImportMultipart } from "../_multipart";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const input = await readCsvImportMultipart(request, {
      requireMapping: false,
    });
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const inspection = await inspectCsvImportUpload(database, identity, {
      bytes,
      contentType: input.file.type || null,
      fileName: input.file.name,
      sourceLabel: input.sourceLabel,
      sourceNamespace: input.sourceNamespace,
    });
    return privateOrganizerJson(
      {
        fileSha256: inspection.fileSha256,
        headers: inspection.headers,
        inspectionBatchId: inspection.inspectionBatchId,
        nonblankRowCount: inspection.dataRowCount,
        selections: inspection.suggestedSelections,
      },
      { noReferrer: true },
    );
  } catch (error) {
    return organizerApiError(
      error,
      "inspect_csv_import",
      "/api/organizer/imports/inspect",
      { noReferrer: true },
    );
  }
}
