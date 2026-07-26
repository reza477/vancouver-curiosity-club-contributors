import { updateNotificationPreferenceMode } from "@/lib/server/organizer/notifications";
import { assertOnlyKeys, parseObject } from "@/lib/validation";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const payload = parseObject(
      await readOrganizerMutationBody(request, 512),
    );
    assertOnlyKeys(payload, ["mode"]);
    const preference = await updateNotificationPreferenceMode(
      database,
      identity,
      payload.mode,
    );
    return privateOrganizerJson({ preference });
  } catch (error) {
    return organizerApiError(
      error,
      "update_organizer_notification_preference",
      "/api/organizer/notifications/preferences",
    );
  }
}
