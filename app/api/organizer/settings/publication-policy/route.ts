import {
  readOrganizationPublicationPolicy,
  updateOrganizationPublicationPolicy,
} from "@/lib/server/organizer/publication";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const policy = await readOrganizationPublicationPolicy(database, identity);
    return privateOrganizerJson({ policy });
  } catch (error) {
    return organizerApiError(
      error,
      "read_organization_publication_policy",
      "/api/organizer/settings/publication-policy",
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const policy = await updateOrganizationPublicationPolicy(
      database,
      identity,
      await readOrganizerMutationBody(request, 8_000),
    );
    return privateOrganizerJson({ policy });
  } catch (error) {
    return organizerApiError(
      error,
      "update_organization_publication_policy",
      "/api/organizer/settings/publication-policy",
    );
  }
}
