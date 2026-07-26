import {
  ClubArchiveBlockedError,
  archivePrivateOrganizerClub,
} from "@/lib/server/organizer/clubs";
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
    const payload = parseObject(
      await readOrganizerMutationBody(request, 64),
    );
    assertOnlyKeys(payload, []);
    const { id } = await context.params;
    const result = await archivePrivateOrganizerClub(
      database,
      identity,
      id,
    );
    return privateOrganizerJson(result);
  } catch (error) {
    if (error instanceof ClubArchiveBlockedError) {
      return privateOrganizerJson(
        {
          error: {
            code: error.code,
            message: error.publicMessage,
            eventCount: error.eventCount,
            invitationCount: error.invitationCount,
            memberCount: error.memberCount,
            programCount: error.programCount,
            sourceCount: error.sourceCount,
            events: error.events,
          },
        },
        { status: error.status },
      );
    }
    return organizerApiError(
      error,
      "archive_private_organizer_club",
      "/api/organizer/clubs/archive",
    );
  }
}
