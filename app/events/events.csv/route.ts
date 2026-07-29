import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { createFilteredPublicCsvDownload } from "@/lib/server/phase7/public-exports";
import { safeErrorResponse } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const download = await createFilteredPublicCsvDownload(
      getRuntimeAuthConfiguration().database,
      {
        generatedAt: Date.now(),
        origin: url.origin,
        searchParams: url.searchParams,
      },
    );
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
      operation: "download_public_event_csv",
      route: "/events/events.csv",
    });
  }
}
