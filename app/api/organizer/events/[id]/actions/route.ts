import { performOrganizerLifecycleAction } from "@/lib/server/organizer/scheduling";
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
    const { database, identity } = await requireOrganizerApiActor();
    const result = await performOrganizerLifecycleAction(
      database,
      identity,
      id,
      await readOrganizerMutationBody(request, 8_000),
    );
    return privateOrganizerJson(result, {
      status: result.outcome === "pending_approval" ? 202 : 200,
    });
  } catch (error) {
    return organizerApiError(
      error,
      "organizer_lifecycle_action",
      "/api/organizer/events/[id]/actions",
    );
  }
}
