import { moderateFormSubmissions } from "@/lib/server/phase7/submission-moderation";
import {
  organizerApiError, privateOrganizerJson, readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor(["owner", "administrator"]);
    const body = await readOrganizerMutationBody(request);
    const input = body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown> : {};
    const result = await moderateFormSubmissions(database, identity, {
      folder: input.folder, items: input.items,
    });
    return privateOrganizerJson(result, { noReferrer: true });
  } catch (error) {
    return organizerApiError(error, "moderate_form_submissions",
      "/api/organizer/submissions/moderation", { noReferrer: true });
  }
}
