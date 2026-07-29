import { applyNextCsvImportRow } from "@/lib/server/phase7/imports";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../../_shared";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ id: string }>;

export async function POST(
  request: Request,
  context: Readonly<{ params: RouteParams }>,
): Promise<Response> {
  try {
    const { id } = await context.params;
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const input = await readOrganizerMutationBody(request);
    const body = isRecord(input) ? input : {};
    const result = await applyNextCsvImportRow(
      database,
      identity,
      id,
      body.expectedVersion,
    );
    return privateOrganizerJson({ result }, { noReferrer: true });
  } catch (error) {
    return organizerApiError(
      error,
      "apply_next_csv_import_row",
      "/api/organizer/imports/[id]/apply-next",
      { noReferrer: true },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
