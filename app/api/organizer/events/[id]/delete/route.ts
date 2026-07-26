import { softDeleteOrganizerEvent } from "@/lib/server/organizer/events";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../../_shared";
import { expectedVersionFromBody } from "../_action";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: Readonly<{ params: Promise<{ id: string }> }>,
): Promise<Response> {
  const { id } = await context.params;
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const version = expectedVersionFromBody(
      await readOrganizerMutationBody(request, 2_048),
    );
    const event = await softDeleteOrganizerEvent(
      database,
      identity,
      id,
      version,
    );
    return privateOrganizerJson({ event });
  } catch (error) {
    return organizerApiError(
      error,
      "delete_organizer_event",
      "/api/organizer/events/[id]/delete",
    );
  }
}
