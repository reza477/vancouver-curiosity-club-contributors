import { markInformationalConflictReviewed } from "@/lib/server/organizer/conflicts";
import { assertOnlyKeys, parseObject } from "@/lib/validation";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../../../_shared";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const body = parseObject(
      await readOrganizerMutationBody(request, 1_000),
      "body",
    );
    assertOnlyKeys(body, ["reviewed"], "body");
    if (body.reviewed !== true) {
      throw new TypeError("Expected reviewed=true.");
    }
    const result = await markInformationalConflictReviewed(
      database,
      identity,
      id,
    );
    return privateOrganizerJson(result);
  } catch (error) {
    return organizerApiError(
      error,
      "review_informational_conflict",
      "/api/organizer/conflicts/incidents/[id]/review",
    );
  }
}
