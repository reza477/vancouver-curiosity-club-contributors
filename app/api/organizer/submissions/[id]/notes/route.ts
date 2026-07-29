import { appendFormSubmissionNote } from "@/lib/server/phase7/submissions";
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
    const { database, identity } = await requireOrganizerApiActor();
    const body = await readOrganizerMutationBody(request);
    const input = isRecord(body) ? body : {};
    const submission = await appendFormSubmissionNote(database, identity, {
      body: input.body,
      submissionId: id,
    });
    return privateOrganizerJson(
      { submission },
      { noReferrer: true, status: 201 },
    );
  } catch (error) {
    return organizerApiError(
      error,
      "append_form_submission_note",
      "/api/organizer/submissions/[id]/notes",
      { noReferrer: true },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
