import { restoreCmsRevisionAsDraft } from "@/lib/server/organizer/cms";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../../../_shared";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<{ entityType: string; id: string }>;
}>;

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const { entityType, id } = await context.params;
    const entity = await restoreCmsRevisionAsDraft(
      database,
      identity,
      entityType,
      id,
      await readOrganizerMutationBody(request, 4_096),
    );
    return privateOrganizerJson({ entity });
  } catch (error) {
    return organizerApiError(
      error,
      "restore_cms_revision_as_draft",
      "/api/organizer/content/[entityType]/[id]/restore",
    );
  }
}
