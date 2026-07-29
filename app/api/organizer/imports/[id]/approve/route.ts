import { approveCsvImportBatch } from "@/lib/server/phase7/imports";
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
    const input = await readOrganizerMutationBody(request, 2 * 1024 * 1024);
    const batch = await approveCsvImportBatch(
      database,
      identity,
      id,
      input,
    );
    return privateOrganizerJson({ batch }, { noReferrer: true });
  } catch (error) {
    return organizerApiError(
      error,
      "approve_csv_import",
      "/api/organizer/imports/[id]/approve",
      { noReferrer: true },
    );
  }
}
