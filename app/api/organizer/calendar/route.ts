import { listOrganizerCalendarEvents } from "@/lib/server/organizer/calendar";
import {
  organizerApiError,
  privateOrganizerJson,
  requireOrganizerApiActor,
} from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const query = new URL(request.url).searchParams;
    const fromUtc = numberParameter(query, "fromUtc");
    const toUtc = numberParameter(query, "toUtc");
    const limit = numberParameter(query, "limit");
    const result = await listOrganizerCalendarEvents(database, identity, {
      categoryId: optionalParameter(query, "categoryId"),
      clubId: optionalParameter(query, "clubId"),
      eventLaneId: optionalParameter(query, "eventLaneId"),
      fromUtc,
      limit,
      organizerProfileId: optionalParameter(query, "organizerProfileId"),
      planningStatus: optionalParameter(query, "planningStatus"),
      publicationStatus: optionalParameter(query, "publicationStatus"),
      search: optionalParameter(query, "search"),
      source: optionalParameter(query, "source"),
      toUtc,
    });
    return privateOrganizerJson(result);
  } catch (error) {
    return organizerApiError(
      error,
      "list_organizer_calendar",
      "/api/organizer/calendar",
    );
  }
}

function optionalParameter(
  query: URLSearchParams,
  key: string,
): string | undefined {
  const value = query.get(key);
  return value === null || value === "" ? undefined : value;
}

function numberParameter(
  query: URLSearchParams,
  key: string,
): number | undefined {
  const value = query.get(key);
  return value === null || value === "" ? undefined : Number(value);
}
