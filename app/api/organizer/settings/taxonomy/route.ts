import {
  createOrganizerTaxonomyItem,
  performOrganizerTaxonomyAction,
  readOrganizerTaxonomyWorkspace,
} from "@/lib/server/organizer/taxonomy";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const workspace = await readOrganizerTaxonomyWorkspace(
      database,
      identity,
    );
    return privateOrganizerJson({ workspace });
  } catch (error) {
    return organizerApiError(
      error,
      "read_organizer_taxonomy",
      "/api/organizer/settings/taxonomy",
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const payload = await readOrganizerMutationBody(request, 16_384);
    const workspace = await createOrganizerTaxonomyItem(
      database,
      identity,
      payload,
    );
    return privateOrganizerJson({ workspace }, { status: 201 });
  } catch (error) {
    return organizerApiError(
      error,
      "create_organizer_taxonomy",
      "/api/organizer/settings/taxonomy",
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const payload = await readOrganizerMutationBody(request, 32_768);
    const workspace = await performOrganizerTaxonomyAction(
      database,
      identity,
      payload,
    );
    return privateOrganizerJson({ workspace });
  } catch (error) {
    return organizerApiError(
      error,
      "mutate_organizer_taxonomy",
      "/api/organizer/settings/taxonomy",
    );
  }
}
