import {
  getOrganizerEventRecord,
  updateOrganizerEvent,
} from "@/lib/server/organizer/events";
import {
  assertOnlyKeys,
  parseFiniteInteger,
  parseObject,
} from "@/lib/validation";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const event = await getOrganizerEventRecord(database, identity, id);
    return privateOrganizerJson({ event });
  } catch (error) {
    return organizerApiError(
      error,
      "get_organizer_event",
      "/api/organizer/events/[id]",
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
    const payload = parseObject(
      await readOrganizerMutationBody(request, 48_000),
      "body",
    );
    assertOnlyKeys(
      payload,
      [
        "conflictReason",
        "event",
        "expectedContentVersion",
        "expectedScheduleVersion",
      ],
      "body",
    );
    const expectedContentVersion = parseFiniteInteger(
      payload.expectedContentVersion,
      {
        path: "expectedContentVersion",
        minimum: 1,
      },
    );
    const expectedScheduleVersion = parseFiniteInteger(
      payload.expectedScheduleVersion,
      {
        path: "expectedScheduleVersion",
        minimum: 1,
      },
    );
    const result = await updateOrganizerEvent(
      database,
      identity,
      id,
      expectedContentVersion,
      payload.event,
      expectedScheduleVersion,
      payload.conflictReason,
    );
    if ("outcome" in result && result.outcome === "pending_approval") {
      return privateOrganizerJson(result, { status: 202 });
    }
    return privateOrganizerJson({ event: result });
  } catch (error) {
    return organizerApiError(
      error,
      "update_organizer_event",
      "/api/organizer/events/[id]",
    );
  }
}
