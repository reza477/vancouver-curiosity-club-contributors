import { createCmsEntityDraft } from "@/lib/server/organizer/cms";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<{ entityType: string }>;
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
    const { entityType } = await context.params;
    const entity = await createCmsEntityDraft(
      database,
      identity,
      entityType,
      await readOrganizerMutationBody(request, 140_000),
    );
    return privateOrganizerJson({ entity }, { status: 201 });
  } catch (error) {
    return organizerApiError(
      error,
      "create_cms_entity_draft",
      "/api/organizer/content/[entityType]",
    );
  }
}
