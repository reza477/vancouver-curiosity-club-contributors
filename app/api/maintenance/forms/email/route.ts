import { env } from "cloudflare:workers";
import { isD1DatabaseLike } from "@/lib/server/auth";
import { authenticateMaintenanceRequest } from "@/lib/server/maintenance/request-signature";
import { drainPublicFormEmailOutbox } from "@/lib/server/phase7/public-form-email";
import { readPublicFormEmailConfiguration } from "@/lib/server/phase7/public-form-email-runtime";
import {
  SafeApplicationError,
  privateJsonHeaders,
  safeErrorResponse,
  writeSafeLog,
} from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

const ROUTE = "/api/maintenance/forms/email";
const DELIVERY_SLICE_LIMIT = 6;

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

    const configuration = readPublicFormEmailConfiguration();
    if (!configuration) throw unavailable();
    const delivery = await drainPublicFormEmailOutbox(database, {
      configuration,
      limit: DELIVERY_SLICE_LIMIT,
      nowUtcMs: startedAt,
    });
    const status =
      delivery.hasMoreDue
        ? "continue"
        : delivery.blocked > 0 || delivery.retried > 0
          ? "failed"
          : "succeeded";

    writeSafeLog(
      status === "failed" ? "warn" : "info",
      `public_form_email_maintenance_${status}`,
      {
        durationMs: Date.now() - startedAt,
        operation: "drain_public_form_email_outbox",
        requestId: authenticated.requestId,
        route: ROUTE,
        status: 200,
      },
    );
    const headers = privateJsonHeaders();
    headers.set("Referrer-Policy", "no-referrer");
    return new Response(
      JSON.stringify({
        attempted: delivery.attempted,
        blocked: delivery.blocked,
        requestId: authenticated.requestId,
        retried: delivery.retried,
        sent: delivery.sent,
        status,
        suppressed: delivery.suppressed,
      }),
      { headers, status: 200 },
    );
  } catch (error) {
    return safeErrorResponse(error, {
      durationMs: Date.now() - startedAt,
      operation: "drain_public_form_email_outbox",
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
    "Form email maintenance is temporarily unavailable.",
  );
}
