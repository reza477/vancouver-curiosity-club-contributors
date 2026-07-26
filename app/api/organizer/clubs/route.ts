import {
  createPrivateOrganizerClub,
  listOrganizerClubs,
} from "@/lib/server/organizer/clubs";
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
    const clubs = await listOrganizerClubs(database, identity);
    return privateOrganizerJson({ clubs });
  } catch (error) {
    return organizerApiError(
      error,
      "list_organizer_clubs",
      "/api/organizer/clubs",
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const payload = await readOrganizerMutationBody(request, 8_192);
    const club = await createPrivateOrganizerClub(
      database,
      identity,
      payload,
    );
    return privateOrganizerJson({ club }, { status: 201 });
  } catch (error) {
    return organizerApiError(
      error,
      "create_private_organizer_club",
      "/api/organizer/clubs",
    );
  }
}
