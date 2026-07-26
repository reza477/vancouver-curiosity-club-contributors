import { updateOrganizerVenue } from "@/lib/server/organizer/venues";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const venue = await updateOrganizerVenue(
      database,
      identity,
      id,
      await readOrganizerMutationBody(request, 8_000),
    );
    return privateOrganizerJson({ venue });
  } catch (error) {
    return organizerApiError(
      error,
      "update_organizer_venue",
      "/api/organizer/venues/[id]",
    );
  }
}
