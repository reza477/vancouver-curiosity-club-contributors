import { createOwnerMediaManifest } from "@/lib/server/phase7/private-exports";
import {
  organizerApiError,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor(["owner"]);
    const download = await createOwnerMediaManifest(database, identity);
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
      "export_media_manifest",
      "/api/organizer/exports/media-manifest.json",
      { noReferrer: true },
    );
  }
}
