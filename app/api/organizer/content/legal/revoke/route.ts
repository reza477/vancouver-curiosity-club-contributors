import { revokeCmsLegalStatus } from "@/lib/server/organizer/cms";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor(["owner"]);
    const entity = await revokeCmsLegalStatus(
      database,
      identity,
      await readOrganizerMutationBody(request, 4_096),
    );
    return privateOrganizerJson({ entity }, { noReferrer: true });
  } catch (error) {
    return organizerApiError(
      error,
      "revoke_cms_legal_status",
      "/api/organizer/content/legal/revoke",
      { noReferrer: true },
    );
  }
}
