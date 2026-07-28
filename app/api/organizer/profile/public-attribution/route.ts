import {
  confirmOrganizerPublicAttribution,
  revokeOrganizerPublicAttribution,
} from "@/lib/server/organizer/profiles";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return mutateAttribution(request, "confirm");
}

export async function DELETE(request: Request): Promise<Response> {
  return mutateAttribution(request, "revoke");
}

async function mutateAttribution(
  request: Request,
  action: "confirm" | "revoke",
): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor();
    const payload = await readOrganizerMutationBody(request, 2_048);
    const profile =
      action === "confirm"
        ? await confirmOrganizerPublicAttribution(
            database,
            identity,
            payload,
          )
        : await revokeOrganizerPublicAttribution(
            database,
            identity,
            payload,
          );
    return privateOrganizerJson({ profile });
  } catch (error) {
    return organizerApiError(
      error,
      action === "confirm"
        ? "confirm_public_attribution"
        : "revoke_public_attribution",
      "/api/organizer/profile/public-attribution",
    );
  }
}
