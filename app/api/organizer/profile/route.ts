import {
  getOrganizerProfile,
  updateOrganizerProfile,
} from "@/lib/server/organizer/profiles";
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
    const profile = await getOrganizerProfile(database, identity);
    return privateOrganizerJson({ profile });
  } catch (error) {
    return organizerApiError(
      error,
      "read_organizer_profile",
      "/api/organizer/profile",
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const payload = await readOrganizerMutationBody(request, 8_192);
    const profile = await updateOrganizerProfile(
      database,
      identity,
      payload,
    );
    return privateOrganizerJson({ profile });
  } catch (error) {
    return organizerApiError(
      error,
      "update_organizer_profile",
      "/api/organizer/profile",
    );
  }
}
