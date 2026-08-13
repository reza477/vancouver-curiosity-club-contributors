import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { createOneEventIcsDownload } from "@/lib/server/phase7/public-exports";
import { safeErrorResponse } from "@/lib/validation/server-observability";
import { trustedPublicRequestOrigin } from "@/lib/public-domain";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<{ slug: string }>;
}>;

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { slug } = await context.params;
    const download = await createOneEventIcsDownload(
      getRuntimeAuthConfiguration().database,
      {
        generatedAt: Date.now(),
        origin: trustedPublicRequestOrigin(new URL(request.url)),
        slug,
      },
    );
    if (!download) return notFoundResponse();
    return new Response(download.body, {
      headers: {
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Content-Disposition": `attachment; filename="${download.fileName}"`,
        "Content-Type": download.contentType,
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  } catch (error) {
    return safeErrorResponse(error, {
      operation: "download_public_event_ics",
      route: "/events/[slug]/calendar.ics",
    });
  }
}

function notFoundResponse(): Response {
  return new Response("Not found.", {
    status: 404,
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
