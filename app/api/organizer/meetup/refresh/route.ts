import { refreshMeetupCalendarSource } from "@/lib/server/meetup";
import {
  SafeApplicationError,
  privateJsonHeaders,
  safeErrorResponse,
} from "@/lib/validation/server-observability";
import { toMeetupUiState } from "@/app/organizer/meetup/model";
import {
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
    const body = await readBoundedUtf8Body(request, 64);
    if (body.trim().length > 0) {
      throw new SafeApplicationError(
        "validation_failed",
        400,
        "The request could not be validated.",
      );
    }
    const result = await refreshMeetupCalendarSource(database, identity);

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
