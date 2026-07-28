import { readCmsRevisionPreview } from "@/lib/server/organizer/cms";
import {
  organizerApiError,
  privateOrganizerJson,
  requireOrganizerApiActor,
} from "../../../_shared";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const { id } = await context.params;
    const revision = await readCmsRevisionPreview(database, identity, id);
    return privateOrganizerJson({ revision }, { noReferrer: true });
  } catch (error) {
    return organizerApiError(
      error,
      "read_cms_revision_preview",
      "/api/organizer/content/revisions/[id]",
      { noReferrer: true },
    );
  }
}
