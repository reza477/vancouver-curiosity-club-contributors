import { performOrganizerPublicationAction } from "@/lib/server/organizer/publication";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../../../_shared";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const result = await performOrganizerPublicationAction(
      database,
      identity,
      id,
      await readOrganizerMutationBody(request, 16_000),
    );
    return privateOrganizerJson(result);
  } catch (error) {
    return organizerApiError(
      error,
      "perform_organizer_publication_action",
      "/api/organizer/events/[id]/publication/actions",
    );
  }
}
