import { listOrganizerConflictCenter } from "@/lib/server/organizer/conflicts";
import {
  organizerApiError,
  privateOrganizerJson,
  requireOrganizerApiActor,
} from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const conflicts = await listOrganizerConflictCenter(database, identity);
    return privateOrganizerJson({ conflicts });
  } catch (error) {
    return organizerApiError(
      error,
      "list_organizer_conflicts",
      "/api/organizer/conflicts",
    );
  }
}
