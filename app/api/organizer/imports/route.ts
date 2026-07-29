import {
  createCsvImportPreview,
  listCsvImportBatches,
} from "@/lib/server/phase7/imports";
import {
  organizerApiError,
  privateOrganizerJson,
  requireOrganizerApiActor,
} from "../_shared";
import { readCsvImportMultipart } from "./_multipart";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const url = new URL(request.url);
    const history = await listCsvImportBatches(database, identity, {
      actorProfileId: optionalQuery(
        url.searchParams.get("actorProfileId"),
      ),
      cursor: optionalQuery(url.searchParams.get("cursor")),
      limit: integerQuery(url.searchParams.get("limit")),
      phase: optionalQuery(url.searchParams.get("phase")),
      sourceNamespace: optionalQuery(
        url.searchParams.get("sourceNamespace"),
      ),
    });
    return privateOrganizerJson({ history }, { noReferrer: true });
  } catch (error) {
    return organizerApiError(
      error,
      "list_csv_imports",
      "/api/organizer/imports",
      { noReferrer: true },
    );
  }
}

function integerQuery(value: string | null): number | string | undefined {
  if (value === null || value === "") return undefined;
  return /^\d+$/u.test(value) ? Number(value) : value;
}

function optionalQuery(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const input = await readCsvImportMultipart(request, {
      requireMapping: true,
    });
    const batch = await createCsvImportPreview(database, identity, {
      bytes: new Uint8Array(await input.file.arrayBuffer()),
      contentType: input.file.type || null,
      fileName: input.file.name,
      headerSelections: input.headerSelections,
      inspectionBatchId: input.inspectionBatchId,
      sourceLabel: input.sourceLabel,
      sourceNamespace: input.sourceNamespace,
    });
    return privateOrganizerJson({ batch }, {
      noReferrer: true,
      status: 201,
    });
  } catch (error) {
    return organizerApiError(
      error,
      "create_csv_import_preview",
      "/api/organizer/imports",
      { noReferrer: true },
    );
  }
}
