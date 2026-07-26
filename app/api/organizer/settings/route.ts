import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from "@/lib/server/organizer/settings";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const settings = await getWorkspaceSettings(database, identity);
    return privateOrganizerJson({ settings });
  } catch (error) {
    return organizerApiError(
      error,
      "read_organizer_settings",
      "/api/organizer/settings",
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const payload = await readOrganizerMutationBody(request, 4_096);
    const settings = await updateWorkspaceSettings(
      database,
      identity,
      payload,
    );
    return privateOrganizerJson({ settings });
  } catch (error) {
    return organizerApiError(
      error,
      "update_organizer_settings",
      "/api/organizer/settings",
    );
  }
}
