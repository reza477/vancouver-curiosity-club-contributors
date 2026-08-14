import { env } from "cloudflare:workers";
import { isD1DatabaseLike } from "@/lib/server/auth";
import { isDurablePublicResponseFallbackSlot } from "@/lib/server/public/durable-response-fallback";
import { authenticateMaintenanceRequest } from "@/lib/server/maintenance/request-signature";
import {
  SafeApplicationError,
  privateJsonHeaders,
  safeErrorResponse,
  writeSafeLog,
} from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

const ROUTE = "/api/maintenance/public-snapshots/capture";

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
      "application/json"
    ) {
      throw invalidRequest();
    }
    const input = parseInput(authenticated.rawBody);
    writeSafeLog("info", "durable_public_response_capture_accepted", {
      durationMs: Date.now() - startedAt,
      operation: "capture_durable_public_response",
      requestId: authenticated.requestId,
      route: ROUTE,
      status: 200,
    });
    const headers = privateJsonHeaders();
    headers.set("Referrer-Policy", "no-referrer");
    return new Response(
      JSON.stringify({
        batchId: input.batchId,
        slot: input.slot,
        status: "accepted",
      }),
      { headers, status: 200 },
    );
  } catch (error) {
    return safeErrorResponse(error, {
      durationMs: Date.now() - startedAt,
      operation: "capture_durable_public_response",
      ...(authenticatedRequestId
        ? { requestId: authenticatedRequestId }
        : {}),
      route: ROUTE,
    });
  }
}

function parseInput(rawBody: string): Readonly<{
  batchId: string;
  slot: "home-html" | "events-html" | "home-rsc" | "events-rsc";
}> {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw invalidRequest();
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !== "batchId\nslot"
  ) {
    throw invalidRequest();
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.batchId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      candidate.batchId,
    ) ||
    !isDurablePublicResponseFallbackSlot(candidate.slot)
  ) {
    throw invalidRequest();
  }
  return Object.freeze({
    batchId: candidate.batchId,
    slot: candidate.slot,
  });
}

function runtimeValue(key: string): unknown {
  if ((typeof env !== "object" && typeof env !== "function") || env === null) {
    return undefined;
  }
  return Reflect.get(env, key);
}

function invalidRequest(): SafeApplicationError {
  return new SafeApplicationError(
    "validation_failed",
    400,
    "The maintenance request could not be validated.",
  );
}

function unavailable(): SafeApplicationError {
  return new SafeApplicationError(
    "service_unavailable",
    503,
    "Maintenance is temporarily unavailable.",
  );
}
