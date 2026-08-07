import { refreshMeetupCalendarSource } from "@/lib/server/meetup";
import {
  assertOnlyKeys,
  parseIdentifier,
  parseObject,
} from "@/lib/validation";
import {
  privateJsonHeaders,
  safeErrorResponse,
} from "@/lib/validation/server-observability";
import { toMeetupUiState } from "@/app/organizer/meetup/model";
import {
  parseJsonBody,
  readBoundedUtf8Body,
  requireSameOriginMutation,
} from "../_mutation";
import { requireMeetupApiActor } from "../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOriginMutation(request);
    const { database, identity } = await requireMeetupApiActor([
      "owner",
      "administrator",
    ]);
    const payload = parseObject(
      parseJsonBody(await readBoundedUtf8Body(request, 256)),
    );
    assertOnlyKeys(payload, ["clubId"]);
    const clubId = parseIdentifier(payload.clubId, "clubId");
    const result = await refreshMeetupCalendarSource(database, identity, {
      clubId,
    });

    return new Response(
      JSON.stringify({
        counts: result.counts,
        outcome: result.outcome,
        state: toMeetupUiState(result.state),
      }),
      {
        status: 200,
        headers: privateJsonHeaders(),
      },
    );
  } catch (error) {
    return safeErrorResponse(error, {
      operation: "refresh_meetup_calendar",
      route: "/api/organizer/meetup/refresh",
    });
  }
}
