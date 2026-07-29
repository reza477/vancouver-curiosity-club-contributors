import { getFormSubmission } from "@/lib/server/phase7/submissions";
import {
  organizerApiError,
  privateOrganizerJson,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ id: string }>;

export async function GET(
  _request: Request,
  context: Readonly<{ params: RouteParams }>,
): Promise<Response> {
  try {
    const { id } = await context.params;
    const { database, identity } = await requireOrganizerApiActor();
    const submission = await getFormSubmission(database, identity, id);
    return privateOrganizerJson({ submission }, { noReferrer: true });
  } catch (error) {
    return organizerApiError(
      error,
      "read_form_submission",
      "/api/organizer/submissions/[id]",
      { noReferrer: true },
    );
  }
}
