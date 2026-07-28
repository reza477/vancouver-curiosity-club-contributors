import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { getRuntimeMediaBucket } from "@/lib/server/media/runtime";
import { getPublicMediaVariant } from "@/lib/server/media/storage";
import { safeErrorResponse } from "@/lib/validation/server-observability";

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
    const media = await getPublicMediaVariant(
      getRuntimeAuthConfiguration().database,
      getRuntimeMediaBucket(),
      id,
      variant,
    );
    const etag = `"${media.etag}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        headers: {
          "Cache-Control": "public, max-age=0, must-revalidate",
          ETag: etag,
          "X-Content-Type-Options": "nosniff",
        },
        status: 304,
      });
    }
    const body = media.body.body ?? (await media.body.arrayBuffer());
    return new Response(body, {
      headers: {
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Content-Disposition": "inline",
        "Content-Type": media.mimeType,
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return safeErrorResponse(error, {
      operation: "read_public_media_variant",
      route: "/media/[id]/[variant]",
    });
  }
}
