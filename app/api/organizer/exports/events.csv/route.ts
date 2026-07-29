import { createOperationalEventCsv } from "@/lib/server/phase7/private-exports";
import {
  organizerApiError,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const download = await createOperationalEventCsv(database, identity);
    return privateDownloadResponse(download);
  } catch (error) {
    return organizerApiError(
      error,
      "export_operational_events",
      "/api/organizer/exports/events.csv",
      { noReferrer: true },
    );
  }
}

function privateDownloadResponse(
  download: Awaited<ReturnType<typeof createOperationalEventCsv>>,
): Response {
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
}
