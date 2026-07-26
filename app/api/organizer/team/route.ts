import { listTeamMembers } from "@/lib/server/organizer/team";
import {
  organizerApiError,
  privateOrganizerJson,
  requireOrganizerApiActor,
} from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const members = await listTeamMembers(database, identity);
    return privateOrganizerJson({ members });
  } catch (error) {
    return organizerApiError(
      error,
      "list_organizer_team",
      "/api/organizer/team",
    );
  }
}
