import { revokeOwnCalendarSubscription } from "@/lib/server/phase7/calendar-subscriptions";
import {
  assertOnlyKeys,
  parseObject,
} from "@/lib/validation";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../../_shared";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<{ id: string }>;
}>;

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { id } = await context.params;
    const { database, identity } = await requireOrganizerApiActor();
    const body = parseObject(
      await readOrganizerMutationBody(request, 1_024),
    );
    assertOnlyKeys(body, []);
    const subscription = await revokeOwnCalendarSubscription(
      database,
      identity,
      id,
    );
    return privateOrganizerJson(
      { subscription },
      { noReferrer: true },
    );
  } catch (error) {
    return organizerApiError(
      error,
      "revoke_calendar_subscription",
      "/api/organizer/calendar-tokens/[id]/revoke",
      { noReferrer: true },
    );
  }
}
