import { getRuntimeMediaBucket } from "@/lib/server/media/runtime";
import { getOwnerMediaOriginal } from "@/lib/server/phase7/private-exports";
import {
  assertTrustedOrganizerRead,
  organizerApiError,
  requireOrganizerApiActor,
} from "../../../../_shared";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<{ id: string }>;
}>;

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    assertTrustedOrganizerRead(request);
    const { database, identity } = await requireOrganizerApiActor(["owner"]);
    const { id } = await context.params;
    const media = await getOwnerMediaOriginal(
      database,
      getRuntimeMediaBucket(),
      identity,
      id,
    );
    const body = media.body.body ?? (await media.body.arrayBuffer());
    return new Response(body, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="${media.fileName}"`,
        "Content-Length": `${media.byteSize}`,
        "Content-Type": media.mimeType,
        ETag: `"${media.etag}"`,
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  } catch (error) {
    return organizerApiError(
      error,
      "download_owner_media_original",
      "/api/organizer/exports/media/[id]/original",
      { noReferrer: true },
    );
  }
}
