import { env } from "cloudflare:workers";
import { isD1DatabaseLike } from "@/lib/server/auth";
import {
  runDailyMeetupRefresh,
} from "@/lib/server/maintenance/daily-meetup-refresh";
import { drainPublicFormEmailOutbox } from "@/lib/server/phase7/public-form-email";
import { readPublicFormEmailConfiguration } from "@/lib/server/phase7/public-form-email-runtime";
import {
  authenticateMaintenanceRequest,
} from "@/lib/server/maintenance/request-signature";
import {
  SafeApplicationError,
  privateJsonHeaders,
  safeErrorResponse,
  writeSafeLog,
} from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

const ROUTE = "/api/maintenance/meetup/refresh";

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  let authenticatedRequestId: string | undefined;
  try {
    const database = runtimeValue("DB");
    const secret = runtimeValue("DAILY_MEETUP_REFRESH_SECRET");
    if (!isD1DatabaseLike(database) || typeof secret !== "string") {
      throw unavailable();
    }
    const authenticated = await authenticateMaintenanceRequest(
      request,
      database,
      { nowUtcMs: startedAt, secret },
    );
    authenticatedRequestId = authenticated.requestId;
    if (
      request.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
        "application/json" ||
      authenticated.rawBody !== "{}"
    ) {
      throw new SafeApplicationError(
        "validation_failed",
        400,
        "The maintenance request could not be validated.",
      );
    }

    const result = await runDailyMeetupRefresh(database, {
      nowUtcMs: startedAt,
      requestId: authenticated.requestId,
    });
    try {
      const emailDelivery = await drainPublicFormEmailOutbox(database, {
        configuration: readPublicFormEmailConfiguration(),
        // A maximum Meetup slice already uses most of the 50-statement D1
        // request budget. One email keeps this combined maintenance route safe.
        limit: 1,
        nowUtcMs: startedAt,
      });
      if (emailDelivery.attempted > 0) {
        writeSafeLog("info", "public_form_email_maintenance_completed", {
          code:
            emailDelivery.blocked > 0 || emailDelivery.retried > 0
              ? "delivery_deferred"
              : "delivery_completed",
          operation: "drain_public_form_email_outbox",
          requestId: authenticated.requestId,
          route: ROUTE,
          status: 200,
        });
      }
    } catch {
      writeSafeLog("error", "public_form_email_maintenance_failed", {
        code: "internal_error",
        operation: "drain_public_form_email_outbox",
        requestId: authenticated.requestId,
        route: ROUTE,
      });
    }
    writeSafeLog(
      "info",
      result.status === "succeeded"
        ? "daily_meetup_refresh_completed"
        : "daily_meetup_refresh_progressed",
      {
        durationMs: Date.now() - startedAt,
        operation: "daily_meetup_refresh",
        requestId: authenticated.requestId,
        route: ROUTE,
        status: 200,
      },
    );
    const headers = privateJsonHeaders();
    headers.set("Referrer-Policy", "no-referrer");
    return new Response(
      JSON.stringify({
        completedAt: result.completedAt,
        counts: {
          cancelled: result.counts.cancelled,
          created: result.counts.created,
          materializations:
            result.counts.materializations === null
              ? null
              : {
                  eventDetailCount:
                    result.counts.materializations.eventDetailCount,
                  eventsSnapshotCount:
                    result.counts.materializations.eventsSnapshotCount,
                  homeEventCount:
                    result.counts.materializations.homeEventCount,
                },
          passes: result.counts.passes,
          rejected: result.counts.rejected,
          removed: result.counts.removed,
          updated: result.counts.updated,
        },
        outcome: result.outcome,
        requestId: authenticated.requestId,
        startedAt: result.startedAt,
        status: result.status,
      }),
      { headers, status: 200 },
    );
  } catch (error) {
    return safeErrorResponse(error, {
      durationMs: Date.now() - startedAt,
      operation: "daily_meetup_refresh",
      ...(authenticatedRequestId
        ? { requestId: authenticatedRequestId }
        : {}),
      route: ROUTE,
    });
  }
}

function runtimeValue(key: string): unknown {
  if ((typeof env !== "object" && typeof env !== "function") || env === null) {
    return undefined;
  }
  return Reflect.get(env, key);
}

function unavailable(): SafeApplicationError {
  return new SafeApplicationError(
    "service_unavailable",
    503,
    "Maintenance is temporarily unavailable.",
  );
}
