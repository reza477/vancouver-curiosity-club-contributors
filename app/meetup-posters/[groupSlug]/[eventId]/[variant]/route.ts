import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import {
  getRuntimeImagesBinding,
  getRuntimeMediaBucket,
} from "@/lib/server/media/runtime";
import { getSynchronizedMeetupPoster } from "@/lib/server/meetup/posters";
import { safeErrorResponse } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<{
    eventId: string;
    groupSlug: string;
    variant: string;
  }>;
}>;

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { eventId, groupSlug, variant } = await context.params;
  try {
    const poster = await getSynchronizedMeetupPoster(
      getRuntimeAuthConfiguration().database,
      getRuntimeMediaBucket(),
      getRuntimeImagesBinding(),
      { eventId, groupSlug, variant },
    );
    const etag = `"${poster.etag}-${variant}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: posterHeaders(poster.mimeType, etag),
      });
    }
    return new Response(poster.body, {
      headers: posterHeaders(poster.mimeType, etag),
    });
  } catch (error) {
    return safeErrorResponse(error, {
      operation: "read_synchronized_meetup_poster",
      route: "/meetup-posters/[groupSlug]/[eventId]/[variant]",
    });
  }
}

function posterHeaders(mimeType: string, etag: string): HeadersInit {
  return {
    "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    "Content-Disposition": "inline",
    "Content-Type": mimeType,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };
}
