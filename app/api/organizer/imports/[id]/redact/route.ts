import { redactCsvImportSourcePayload } from "@/lib/server/phase7/imports";
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
    const { database, identity } = await requireOrganizerApiActor(["owner"]);
    const input = await readOrganizerMutationBody(request);
    const body = isRecord(input) ? input : {};
    const batch = await redactCsvImportSourcePayload(
      database,
      identity,
      id,
      body.expectedVersion,
    );
    return privateOrganizerJson({ batch }, { noReferrer: true });
  } catch (error) {
    return organizerApiError(
      error,
      "redact_csv_import_source",
      "/api/organizer/imports/[id]/redact",
      { noReferrer: true },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
