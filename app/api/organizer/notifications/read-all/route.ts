import { markAllNotificationsRead } from "@/lib/server/organizer/notifications";
import { assertOnlyKeys, parseObject } from "@/lib/validation";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const payload = parseObject(
      await readOrganizerMutationBody(request, 64),
    );
    assertOnlyKeys(payload, []);
    const result = await markAllNotificationsRead(database, identity);
    return privateOrganizerJson(result);
  } catch (error) {
    return organizerApiError(
      error,
      "mark_all_organizer_notifications_read",
      "/api/organizer/notifications/read-all",
    );
  }
}
