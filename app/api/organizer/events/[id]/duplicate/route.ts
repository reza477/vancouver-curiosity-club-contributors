import { duplicateOrganizerEvent } from "@/lib/server/organizer/events";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../../_shared";
import {
  expectedScheduleVersionFromBody,
  expectedVersionFromBody,
} from "../_action";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: Readonly<{ params: Promise<{ id: string }> }>,
): Promise<Response> {
  const { id } = await context.params;
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const body = await readOrganizerMutationBody(request, 2_048);
    const version = expectedVersionFromBody(body);
    const scheduleVersion = expectedScheduleVersionFromBody(body);
    const event = await duplicateOrganizerEvent(
      database,
      identity,
      id,
      version,
      scheduleVersion,
    );
    return privateOrganizerJson({ event }, { status: 201 });
  } catch (error) {
    return organizerApiError(
      error,
      "duplicate_organizer_event",
      "/api/organizer/events/[id]/duplicate",
    );
  }
}
