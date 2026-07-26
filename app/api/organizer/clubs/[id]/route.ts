import { updateOrganizerClub } from "@/lib/server/organizer/clubs";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: Readonly<{ params: Promise<{ id: string }> }>,
): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const payload = await readOrganizerMutationBody(request, 8_192);
    const { id } = await context.params;
    const club = await updateOrganizerClub(
      database,
      identity,
      id,
      payload,
    );
    return privateOrganizerJson({ club });
  } catch (error) {
    return organizerApiError(
      error,
      "update_private_organizer_club",
      "/api/organizer/clubs/item",
    );
  }
}
