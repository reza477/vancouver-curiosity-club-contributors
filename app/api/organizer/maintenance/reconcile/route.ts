import { runRequestMaintenance } from "@/lib/server/database/request-maintenance";
import { assertOnlyKeys, parseEnum, parseObject } from "@/lib/validation";
import {
  organizerApiError,
  privateOrganizerJson,
  requireOrganizerApiActor,
} from "@/app/api/organizer/_shared";
import {
  parseJsonBody,
  readBoundedUtf8Body,
  requireSameOriginMutation,
} from "@/app/api/organizer/meetup/_mutation";

export const dynamic = "force-dynamic";

const MAINTENANCE_PATHNAMES = Object.freeze([
  "/",
  "/contact",
  "/events",
  "/get-involved",
  "/host-an-event",
  "/privacy",
  "/sitemap.xml",
] as const);

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOriginMutation(request);
    const { database } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const payload = parseObject(
      parseJsonBody(await readBoundedUtf8Body(request, 96)),
    );
    assertOnlyKeys(payload, ["pathname"]);
    const pathname = parseEnum(
      payload.pathname,
      MAINTENANCE_PATHNAMES,
      "pathname",
    );
    const result = await runRequestMaintenance(database, {
      method: "GET",
      pathname,
    });

    return privateOrganizerJson({
      result:
        result.kind === "continue"
          ? { kind: result.kind }
          : { kind: result.kind, source: result.source },
    });
  } catch (error) {
    return organizerApiError(
      error,
      "force_request_maintenance",
      "/api/organizer/maintenance/reconcile",
    );
  }
}
