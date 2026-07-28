import { listCmsEntities } from "@/lib/server/organizer/cms";
import {
  organizerApiError,
  privateOrganizerJson,
  requireOrganizerApiActor,
} from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const entities = await listCmsEntities(database, identity);
    return privateOrganizerJson({ entities });
  } catch (error) {
    return organizerApiError(
      error,
      "read_cms_content_index",
      "/api/organizer/content",
    );
  }
}
