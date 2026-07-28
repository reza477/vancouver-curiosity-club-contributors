import { getRuntimeMediaBucket } from "@/lib/server/media/runtime";
import { retryDeletedMediaCleanup } from "@/lib/server/media/storage";
import { parseFiniteInteger, parseObject } from "@/lib/validation";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../../_shared";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const body = parseObject(
      await readOrganizerMutationBody(request, 4_096),
      "body",
    );
    const result = await retryDeletedMediaCleanup(
      database,
      getRuntimeMediaBucket(),
      identity,
      id,
      parseFiniteInteger(body.expectedVersion, {
        path: "expectedVersion",
        minimum: 1,
      }),
    );
    return privateOrganizerJson(result, {
      status: result.cleanupPending ? 503 : 200,
    });
  } catch (error) {
    return organizerApiError(
      error,
      "retry_deleted_media_cleanup",
      "/api/organizer/media/[id]/cleanup",
    );
  }
}
