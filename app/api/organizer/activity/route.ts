import { listActivityHistory } from "@/lib/server/organizer/activity";
import {
  organizerApiError,
  privateOrganizerJson,
  requireOrganizerApiActor,
} from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const before = url.searchParams.get("before");
    const limit = url.searchParams.get("limit");
    const { database, identity } = await requireOrganizerApiActor();
    const activity = await listActivityHistory(database, identity, {
      before: before === null ? undefined : Number(before),
      limit: limit === null ? undefined : Number(limit),
    });
    return privateOrganizerJson({ activity });
  } catch (error) {
    return organizerApiError(
      error,
      "list_organizer_activity",
      "/api/organizer/activity",
    );
  }
}
