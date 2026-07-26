import { revokeOrganizerInvitation } from "@/lib/server/organizer/invitations";
import { assertOnlyKeys, parseObject } from "@/lib/validation";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../../_shared";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: Readonly<{ params: Promise<{ id: string }> }>,
): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const body = parseObject(
      await readOrganizerMutationBody(request, 64),
    );
    assertOnlyKeys(body, []);
    const { id } = await context.params;
    const invitation = await revokeOrganizerInvitation(
      database,
      identity,
      id,
    );
    return privateOrganizerJson({ invitation });
  } catch (error) {
    return organizerApiError(
      error,
      "revoke_organizer_invitation",
      "/api/organizer/invitations/revoke",
    );
  }
}
