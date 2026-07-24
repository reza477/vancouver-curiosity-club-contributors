import { configureMeetupCalendarSource } from "@/lib/server/meetup";
import {
  assertOnlyKeys,
  parseBoundedString,
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
      parseJsonBody(await readBoundedUtf8Body(request, 4096)),
    );
    assertOnlyKeys(payload, ["feedUrl"]);
    const feedUrl = parseBoundedString(payload.feedUrl, {
      path: "feedUrl",
      minLength: 1,
      maxLength: 2048,
    });
    const state = await configureMeetupCalendarSource(database, identity, {
      feedUrl,
    });

    return new Response(
      JSON.stringify({
        state: toMeetupUiState(state),
      }),
      {
        status: 200,
        headers: privateJsonHeaders(),
      },
    );
  } catch (error) {
    return safeErrorResponse(error, {
      operation: "configure_meetup_calendar",
      route: "/api/organizer/meetup/connect",
    });
  }
}
