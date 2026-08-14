import { refreshPublicEventMaterializations } from "@/lib/server/public/event-materializations";
import { assertOnlyKeys, parseObject } from "@/lib/validation";
import {
  privateJsonHeaders,
  safeErrorResponse,
} from "@/lib/validation/server-observability";
import {
  parseJsonBody,
  readBoundedUtf8Body,
  requireSameOriginMutation,
} from "../_mutation";
import { requireMeetupApiActor } from "@/app/api/organizer/meetup/_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOriginMutation(request);
    const { database, membership } = await requireMeetupApiActor([
      "owner",
      "administrator",
    ]);
    const payload = parseObject(
      parseJsonBody(await readBoundedUtf8Body(request, 16)),
    );
    assertOnlyKeys(payload, []);

    const materialization = await refreshPublicEventMaterializations(
      database,
      {
        nowUtcMs: Date.now(),
        organizationId: membership.organizationId,
      },
    );

    return new Response(
      JSON.stringify({
        counts: {
          eventsSnapshotCount: materialization.eventsSnapshotCount,
          homeEventCount: materialization.homeEventCount,
        },
      }),
      {
        status: 200,
        headers: privateJsonHeaders(),
      },
    );
  } catch (error) {
    return safeErrorResponse(error, {
      operation: "materialize_meetup_public_events",
      route: "/api/organizer/meetup/materialize",
    });
  }
}
