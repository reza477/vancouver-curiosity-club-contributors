import {
  createOrganizerEvent,
  listOrganizerEvents,
} from "@/lib/server/organizer/events";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const url = new URL(request.url);
    const includeDeleted = url.searchParams.get("includeDeleted") === "true";
    const limitValue = url.searchParams.get("limit");
    const events = await listOrganizerEvents(database, identity, {
      includeDeleted,
      limit: limitValue === null ? 100 : Number(limitValue),
    });
    return privateOrganizerJson({ events });
  } catch (error) {
    return organizerApiError(
      error,
      "list_organizer_events",
      "/api/organizer/events",
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const payload = await readOrganizerMutationBody(request, 48_000);
    const event = await createOrganizerEvent(database, identity, payload);
    return privateOrganizerJson({ event }, { status: 201 });
  } catch (error) {
    return organizerApiError(
      error,
      "create_organizer_event",
      "/api/organizer/events",
    );
  }
}
