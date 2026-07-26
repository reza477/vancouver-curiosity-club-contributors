import { listNotifications } from "@/lib/server/organizer/notifications";
import {
  organizerApiError,
  privateOrganizerJson,
  requireOrganizerApiActor,
} from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit");
    const { database, identity } = await requireOrganizerApiActor();
    const page = await listNotifications(database, identity, {
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: rawLimit === null ? undefined : Number(rawLimit),
    });
    return privateOrganizerJson(page);
  } catch (error) {
    return organizerApiError(
      error,
      "list_organizer_notifications",
      "/api/organizer/notifications",
    );
  }
}
