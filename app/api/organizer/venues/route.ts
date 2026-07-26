import {
  createOrganizerVenue,
  listOrganizerVenues,
} from "@/lib/server/organizer/venues";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const venues = await listOrganizerVenues(database, identity);
    return privateOrganizerJson({ venues });
  } catch (error) {
    return organizerApiError(
      error,
      "list_organizer_venues",
      "/api/organizer/venues",
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const venue = await createOrganizerVenue(
      database,
      identity,
      await readOrganizerMutationBody(request, 8_000),
    );
    return privateOrganizerJson({ venue }, { status: 201 });
  } catch (error) {
    return organizerApiError(
      error,
      "create_organizer_venue",
      "/api/organizer/venues",
    );
  }
}
