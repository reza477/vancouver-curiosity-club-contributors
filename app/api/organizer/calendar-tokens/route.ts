import {
  createOwnCalendarSubscription,
  listOwnCalendarSubscriptions,
} from "@/lib/server/phase7/calendar-subscriptions";
import {
  assertOnlyKeys,
  parseObject,
} from "@/lib/validation";
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
    const subscriptions = await listOwnCalendarSubscriptions(
      database,
      identity,
    );
    return privateOrganizerJson({ subscriptions }, { noReferrer: true });
  } catch (error) {
    return organizerApiError(
      error,
      "list_calendar_subscriptions",
      "/api/organizer/calendar-tokens",
      { noReferrer: true },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const body = parseObject(
      await readOrganizerMutationBody(request, 2_048),
    );
    assertOnlyKeys(body, ["label"]);
    const created = await createOwnCalendarSubscription(
      database,
      identity,
      body.label,
    );
    const tokenUrl = new URL(
      `/api/calendar/private/${encodeURIComponent(created.token)}`,
      request.url,
    ).toString();
    return privateOrganizerJson(
      {
        subscription: created.subscription,
        tokenUrl,
      },
      { noReferrer: true, status: 201 },
    );
  } catch (error) {
    return organizerApiError(
      error,
      "create_calendar_subscription",
      "/api/organizer/calendar-tokens",
      { noReferrer: true },
    );
  }
}
