import { unpublishCmsEntity } from "@/lib/server/organizer/cms";
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
    const { entityType, id } = await context.params;
    const { database, identity } = await requireOrganizerApiActor(
      entityType === "legal_status"
        ? ["owner"]
        : ["owner", "administrator"],
    );
    const entity = await unpublishCmsEntity(
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
      "unpublish_cms_entity",
      "/api/organizer/content/[entityType]/[id]/unpublish",
    );
  }
}
