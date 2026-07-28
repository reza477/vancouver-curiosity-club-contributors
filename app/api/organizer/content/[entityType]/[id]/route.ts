import {
  readCmsEntityWorkspace,
  saveCmsEntityDraft,
} from "@/lib/server/organizer/cms";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../../_shared";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<{ entityType: string; id: string }>;
}>;

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const { entityType, id } = await context.params;
    const entity = await readCmsEntityWorkspace(
      database,
      identity,
      entityType,
      id,
    );
    return privateOrganizerJson({ entity });
  } catch (error) {
    return organizerApiError(
      error,
      "read_cms_entity",
      "/api/organizer/content/[entityType]/[id]",
    );
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const { entityType, id } = await context.params;
    const entity = await saveCmsEntityDraft(
      database,
      identity,
      entityType,
      id,
      await readOrganizerMutationBody(request, 140_000),
    );
    return privateOrganizerJson({ entity });
  } catch (error) {
    return organizerApiError(
      error,
      "save_cms_entity_draft",
      "/api/organizer/content/[entityType]/[id]",
    );
  }
}
