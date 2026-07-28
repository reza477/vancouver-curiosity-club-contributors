import {
  archiveCmsClubProfile,
  archiveCmsProgramProfile,
} from "@/lib/server/organizer/cms";
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
    if (
      entityType !== "club_public_profile" &&
      entityType !== "program_public_profile"
    ) {
      return privateOrganizerJson(
        { error: "not_found" },
        { status: 404 },
      );
    }
    const input = await readOrganizerMutationBody(request, 4_096);
    const entity =
      entityType === "program_public_profile"
        ? await archiveCmsProgramProfile(
            database,
            identity,
            id,
            input,
          )
        : await archiveCmsClubProfile(
            database,
            identity,
            id,
            input,
          );
    return privateOrganizerJson({ entity });
  } catch (error) {
    return organizerApiError(
      error,
      "archive_cms_public_profile",
      "/api/organizer/content/[entityType]/[id]/archive",
    );
  }
}
