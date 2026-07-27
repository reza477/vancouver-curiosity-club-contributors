import {
  readOrganizerPublicationWorkspace,
  updateOrganizerEventPublicDetails,
} from "@/lib/server/organizer/publication";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../../_shared";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const workspace = await readOrganizerPublicationWorkspace(
      database,
      identity,
      id,
    );
    return privateOrganizerJson({ workspace });
  } catch (error) {
    return organizerApiError(
      error,
      "read_organizer_publication_workspace",
      "/api/organizer/events/[id]/publication",
    );
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const workspace = await updateOrganizerEventPublicDetails(
      database,
      identity,
      id,
      await readOrganizerMutationBody(request, 64_000),
    );
    return privateOrganizerJson({ workspace });
  } catch (error) {
    return organizerApiError(
      error,
      "update_organizer_event_public_details",
      "/api/organizer/events/[id]/publication",
    );
  }
}
