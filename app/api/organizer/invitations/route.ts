import {
  createOrganizerInvitation,
  listOrganizerInvitations,
} from "@/lib/server/organizer/invitations";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const invitations = await listOrganizerInvitations(
      database,
      identity,
    );
    return privateOrganizerJson({ invitations });
  } catch (error) {
    return organizerApiError(
      error,
      "list_organizer_invitations",
      "/api/organizer/invitations",
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
    const created = await createOrganizerInvitation(
      database,
      identity,
      payload,
    );
    return privateOrganizerJson(
      { created },
      { noReferrer: true, status: 201 },
    );
  } catch (error) {
    return organizerApiError(
      error,
      "create_organizer_invitation",
      "/api/organizer/invitations",
      { noReferrer: true },
    );
  }
}
