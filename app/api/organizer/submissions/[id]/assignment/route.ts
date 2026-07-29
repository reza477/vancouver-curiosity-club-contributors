import { assignFormSubmission } from "@/lib/server/phase7/submissions";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../../_shared";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ id: string }>;

export async function PATCH(
  request: Request,
  context: Readonly<{ params: RouteParams }>,
): Promise<Response> {
  try {
    const { id } = await context.params;
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const body = await readOrganizerMutationBody(request);
    const input = isRecord(body) ? body : {};
    const submission = await assignFormSubmission(database, identity, {
      assigneeProfileId: input.assigneeProfileId,
      expectedVersion: input.expectedVersion,
      submissionId: id,
    });
    return privateOrganizerJson({ submission }, { noReferrer: true });
  } catch (error) {
    return organizerApiError(
      error,
      "assign_form_submission",
      "/api/organizer/submissions/[id]/assignment",
      { noReferrer: true },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
