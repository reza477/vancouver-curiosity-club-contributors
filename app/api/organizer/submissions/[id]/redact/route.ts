import { redactFormSubmissionPersonalContent } from "@/lib/server/phase7/submissions";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../../_shared";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ id: string }>;

export async function POST(
  request: Request,
  context: Readonly<{ params: RouteParams }>,
): Promise<Response> {
  try {
    const { id } = await context.params;
    const { database, identity } = await requireOrganizerApiActor(["owner"]);
    const body = await readOrganizerMutationBody(request);
    const input = isRecord(body) ? body : {};
    const submission = await redactFormSubmissionPersonalContent(
      database,
      identity,
      {
        confirmationReference: input.confirmationReference,
        expectedVersion: input.expectedVersion,
        submissionId: id,
      },
    );
    return privateOrganizerJson({ submission }, { noReferrer: true });
  } catch (error) {
    return organizerApiError(
      error,
      "redact_form_submission_personal_content",
      "/api/organizer/submissions/[id]/redact",
      { noReferrer: true },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
