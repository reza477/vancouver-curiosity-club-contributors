import { listFormSubmissions } from "@/lib/server/phase7/submissions";
import {
  organizerApiError,
  privateOrganizerJson,
  requireOrganizerApiActor,
} from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const query = new URL(request.url).searchParams;
    const page = await listFormSubmissions(database, identity, {
      assignment: query.get("assignment") ?? undefined,
      fromDate: query.get("from") ?? undefined,
      formKey: query.get("form") ?? undefined,
      page: query.get("page") ?? undefined,
      search: query.get("q") ?? undefined,
      status: query.get("status") ?? undefined,
      toDate: query.get("to") ?? undefined,
    });
    return privateOrganizerJson({ page }, { noReferrer: true });
  } catch (error) {
    return organizerApiError(
      error,
      "list_form_submissions",
      "/api/organizer/submissions",
      { noReferrer: true },
    );
  }
}
