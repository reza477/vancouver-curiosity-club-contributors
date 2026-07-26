import { setNotificationReadState } from "@/lib/server/organizer/notifications";
import { assertOnlyKeys, parseObject } from "@/lib/validation";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: Readonly<{ params: Promise<{ id: string }> }>,
): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const payload = parseObject(
      await readOrganizerMutationBody(request, 512),
    );
    assertOnlyKeys(payload, ["read"]);
    const { id } = await context.params;
    const notification = await setNotificationReadState(
      database,
      identity,
      id,
      payload.read,
    );
    return privateOrganizerJson({ notification });
  } catch (error) {
    return organizerApiError(
      error,
      "update_organizer_notification",
      "/api/organizer/notifications/item",
    );
  }
}
