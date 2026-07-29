import { getCsvImportBatch } from "@/lib/server/phase7/imports";
import {
  organizerApiError,
  privateOrganizerJson,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ id: string }>;

export async function GET(
  request: Request,
  context: Readonly<{ params: RouteParams }>,
): Promise<Response> {
  try {
    const { id } = await context.params;
    const search = new URL(request.url).searchParams;
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const batch = await getCsvImportBatch(database, identity, id, {
      cursor: search.get("cursor") ?? undefined,
      limit: search.get("limit") ?? undefined,
    });
    return privateOrganizerJson({ batch }, { noReferrer: true });
  } catch (error) {
    return organizerApiError(
      error,
      "get_csv_import",
      "/api/organizer/imports/[id]",
      { noReferrer: true },
    );
  }
}
