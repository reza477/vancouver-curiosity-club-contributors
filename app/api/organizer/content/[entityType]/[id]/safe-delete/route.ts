import { safeDeleteCmsProgramProfile } from "@/lib/server/organizer/cms";
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
    if (entityType !== "program_public_profile") {
      return privateOrganizerJson(
        { error: "not_found" },
        { status: 404 },
      );
    }
    const input = await readOrganizerMutationBody(request, 4_096);
    const result = await safeDeleteCmsProgramProfile(
      database,
      identity,
      id,
      input,
    );
    return privateOrganizerJson(result);
  } catch (error) {
    return organizerApiError(
      error,
      "safe_delete_cms_program_profile",
      "/api/organizer/content/[entityType]/[id]/safe-delete",
    );
  }
}
