import { decideOrganizerConflictReview } from "@/lib/server/organizer/scheduling";
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
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const result = await decideOrganizerConflictReview(
      database,
      identity,
      id,
      await readOrganizerMutationBody(request, 8_000),
    );
    return privateOrganizerJson(result);
  } catch (error) {
    return organizerApiError(
      error,
      "decide_conflict_review",
      "/api/organizer/conflicts/reviews/[id]/decision",
    );
  }
}
