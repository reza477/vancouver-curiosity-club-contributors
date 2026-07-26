import { previewOrganizerConflicts } from "@/lib/server/organizer/conflicts";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const conflicts = await previewOrganizerConflicts(
      database,
      identity,
      await readOrganizerMutationBody(request, 16_000),
    );
    return privateOrganizerJson({ conflicts });
  } catch (error) {
    return organizerApiError(
      error,
      "preview_organizer_conflicts",
      "/api/organizer/conflicts/preview",
    );
  }
}
