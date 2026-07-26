import {
  TeamMutationBlockedError,
  updateTeamMember,
} from "@/lib/server/organizer/team";
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
    const member = await updateTeamMember(
      database,
      identity,
      id,
      payload,
    );
    return privateOrganizerJson({ member });
  } catch (error) {
    if (error instanceof TeamMutationBlockedError) {
      return privateOrganizerJson(
        {
          error: {
            code: error.code,
            message: error.publicMessage,
            blockers: error.blockers,
          },
        },
        { status: error.status },
      );
    }
    return organizerApiError(
      error,
      "update_organizer_team_member",
      "/api/organizer/team/member",
    );
  }
}
