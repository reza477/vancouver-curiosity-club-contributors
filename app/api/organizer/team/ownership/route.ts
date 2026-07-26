import { transferWorkspaceOwnership } from "@/lib/server/organizer/team";
import { assertOnlyKeys, parseObject } from "@/lib/validation";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
    ]);
    const payload = parseObject(
      await readOrganizerMutationBody(request, 2_048),
    );
    assertOnlyKeys(payload, ["membershipId"]);
    const result = await transferWorkspaceOwnership(
      database,
      identity,
      payload.membershipId,
    );
    return privateOrganizerJson(result);
  } catch (error) {
    return organizerApiError(
      error,
      "transfer_workspace_ownership",
      "/api/organizer/team/ownership",
    );
  }
}
