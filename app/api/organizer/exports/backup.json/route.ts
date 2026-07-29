import { createOwnerJsonBackup } from "@/lib/server/phase7/owner-backup";
import {
  assertOnlyKeys,
  parseObject,
} from "@/lib/validation";
import {
  organizerApiError,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor(["owner"]);
    const body = parseObject(
      await readOrganizerMutationBody(request, 2_048),
    );
    assertOnlyKeys(body, ["confirmation"]);
    const download = await createOwnerJsonBackup(database, identity, {
      confirmation: body.confirmation,
      sourceRevision: __VCC_SOURCE_REVISION__,
    });
    return new Response(download.body, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="${download.fileName}"`,
        "Content-Type": download.contentType,
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  } catch (error) {
    return organizerApiError(
      error,
      "generate_owner_backup",
      "/api/organizer/exports/backup.json",
      { noReferrer: true },
    );
  }
}
