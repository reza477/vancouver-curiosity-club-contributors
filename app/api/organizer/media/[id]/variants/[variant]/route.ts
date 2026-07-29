import { getRuntimeMediaBucket } from "@/lib/server/media/runtime";
import { getPrivateMediaVariant } from "@/lib/server/media/storage";
import {
  assertTrustedOrganizerRead,
  organizerApiError,
  requireOrganizerApiActor,
} from "../../../../_shared";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<{ id: string; variant: string }>;
}>;

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id, variant } = await context.params;
  try {
    assertTrustedOrganizerRead(request);
    const { database, identity } = await requireOrganizerApiActor();
    const eventId = new URL(request.url).searchParams.get("eventId") ?? undefined;
    const media = await getPrivateMediaVariant(
      database,
      getRuntimeMediaBucket(),
      identity,
      id,
      variant,
      { eventId },
    );
    return mediaResponse(media, "private, no-store, max-age=0");
  } catch (error) {
    return organizerApiError(
      error,
      "read_private_media_variant",
      "/api/organizer/media/[id]/variants/[variant]",
    );
  }
}

async function mediaResponse(
  media: Awaited<ReturnType<typeof getPrivateMediaVariant>>,
  cacheControl: string,
): Promise<Response> {
  const body = media.body.body ?? (await media.body.arrayBuffer());
  return new Response(body, {
    headers: {
      "Cache-Control": cacheControl,
      "Content-Disposition": "inline",
      "Content-Type": media.mimeType,
      ETag: `"${media.etag}"`,
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
