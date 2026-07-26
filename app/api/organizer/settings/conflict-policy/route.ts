import {
  getOrganizerConflictPolicy,
  updateOrganizerConflictPolicy,
} from "@/lib/server/organizer/conflict-policy";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const policy = await getOrganizerConflictPolicy(database, identity);
    return privateOrganizerJson({ policy });
  } catch (error) {
    return organizerApiError(
      error,
      "get_conflict_policy",
      "/api/organizer/settings/conflict-policy",
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const policy = await updateOrganizerConflictPolicy(
      database,
      identity,
      await readOrganizerMutationBody(request, 8_000),
    );
    return privateOrganizerJson({ policy });
  } catch (error) {
    return organizerApiError(
      error,
      "update_conflict_policy",
      "/api/organizer/settings/conflict-policy",
    );
  }
}
