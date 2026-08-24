/** Cloudflare Worker entry point for the vinext-starter template. */
import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  ensureDatabaseInvariants,
  ensureDatabaseInvariantsForRequest,
} from "../lib/server/database/invariants";
import {
  runRequestMaintenance,
  shouldRunRequestMaintenance,
} from "../lib/server/database/request-maintenance";
import {
  clearInvitationTokenCookie,
  invitationTokenCookie,
  isInvitationToken,
} from "../lib/server/organizer/invitation-token-cookie";
import {
  canonicalPathnameWithoutTrailingSlash,
  isPrivateOrIdentityPath,
  normalizeEncodedRequestPathname,
  safeRequestPathname,
} from "../lib/request-pathname";
import {
  canonicalPublicRedirectTarget,
  trustedPublicRequestOrigin,
} from "../lib/public-domain";
import {
  publicAssetCacheControl,
  publicAssetContentType,
  publicAssetOriginPath,
} from "../lib/public-asset-cache";
import {
  createPublicResponseFallback,
  type PublicResponseFallbackFailure,
} from "../lib/server/public/warm-response-fallback";
import {
  captureDurablePublicResponseFallbackSlot,
  durablePublicResponseForFailure,
  isDurablePublicResponseFallbackSlot,
  type DurablePublicResponseBuildRequest,
} from "../lib/server/public/durable-response-fallback";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  PUBLIC_SITE_URL?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const TRUSTED_REQUEST_ORIGIN_HEADER = "x-vcc-request-origin";
const TRUSTED_REQUEST_PATHNAME_HEADER = "x-vcc-request-pathname";
const TRUSTED_CSP_NONCE_HEADER = "x-vcc-csp-nonce";
const ORGANIZER_FORCE_MAINTENANCE_PATH = "/api/organizer/maintenance/reconcile";
const DURABLE_PUBLIC_RESPONSE_CAPTURE_PATH =
  "/api/maintenance/public-snapshots/capture";
const PUBLIC_REQUEST_MAINTENANCE_INTERVAL_MS = 15_000;
const PUBLIC_SERVER_TIMING_MAX_DURATION_MS = 60_000;
let publicRequestMaintenanceInFlight: Promise<void> | null = null;
let publicRequestMaintenanceNextEligibleAtUtcMs = 0;
const publicResponseFallback = createPublicResponseFallback();
const requestStartedAtUtcMs = new WeakMap<Request, number>();

function isLocalRequest(requestUrl: URL): boolean {
  return (
    requestUrl.hostname === "localhost" ||
    requestUrl.hostname === "127.0.0.1" ||
    requestUrl.hostname === "::1"
  );
}

function maintenanceRedirect(requestUrl: URL): Response {
  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      Location: requestUrl.toString(),
      Pragma: "no-cache",
    },
    status: 303,
  });
}

function maintenanceUnavailableResponse(): Response {
  return databaseInvariantUnavailableResponse(
    "A required data refresh could not be completed safely. Please try again shortly.",
  );
}

function shouldRunSynchronousRequestMaintenance(
  method: string,
  pathname: string,
): boolean {
  if (pathname === ORGANIZER_FORCE_MAINTENANCE_PATH) return false;
  if (pathname === DURABLE_PUBLIC_RESPONSE_CAPTURE_PATH) return false;
  return (
    (method !== "GET" && method !== "HEAD") || isPrivateOrIdentityPath(pathname)
  );
}

function schedulePublicRequestMaintenance(
  context: ExecutionContext,
  database: D1Database,
  request: Readonly<{ method: string; pathname: string }>,
): void {
  if (!shouldRunRequestMaintenance(request.method, request.pathname)) {
    return;
  }
  const nowUtcMs = Date.now();
  if (
    publicRequestMaintenanceInFlight ||
    nowUtcMs < publicRequestMaintenanceNextEligibleAtUtcMs
  ) {
    return;
  }
  publicRequestMaintenanceNextEligibleAtUtcMs =
    nowUtcMs + PUBLIC_REQUEST_MAINTENANCE_INTERVAL_MS;
  const maintenance = (async () => {
    const invariantStatus = await ensureDatabaseInvariants(database);
    if (invariantStatus !== "ready") {
      console.error(
        JSON.stringify({
          event: "public_request_maintenance_deferred",
          level: "error",
          source: "database_invariants",
        }),
      );
      return;
    }
    const result = await runRequestMaintenance(database, request);
    if (result.kind === "continue") return;
    const level = result.kind === "unavailable" ? "error" : "info";
    console[level](
      JSON.stringify({
        event:
          result.kind === "unavailable"
            ? "public_request_maintenance_deferred"
            : "public_request_maintenance_completed",
        level,
        source: result.source,
      }),
    );
  })()
    .catch(() => {
      console.error(
        JSON.stringify({
          event: "public_request_maintenance_deferred",
          level: "error",
          source: "unknown",
        }),
      );
    })
    .finally(() => {
      if (publicRequestMaintenanceInFlight === maintenance) {
        publicRequestMaintenanceInFlight = null;
      }
    });
  publicRequestMaintenanceInFlight = maintenance;
  context.waitUntil(maintenance);
}

function contentSecurityPolicy(requestUrl: URL, nonce: string | null): string {
  const isLocal = isLocalRequest(requestUrl);
  const scriptSources = ["'self'"];
  const connectSources = ["'self'"];

  if (isLocal) {
    scriptSources.push("'unsafe-inline'", "'unsafe-eval'");
    connectSources.push("ws:", "wss:");
  } else if (nonce) {
    scriptSources.push(`'nonce-${nonce}'`, "'strict-dynamic'");
  }

  return [
    "default-src 'self'",
    "base-uri 'none'",
    `connect-src ${connectSources.join(" ")}`,
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");
}

function requestWithSecurityContext(
  request: Request,
  contentSecurityPolicyValue: string,
  nonce: string | null,
  requestOrigin: string,
  requestPathname: string,
): Request {
  const headers = new Headers(request.headers);
  // vinext reads this request header and applies the nonce to every framework
  // bootstrap/module script it renders. The same policy is returned below.
  headers.set("Content-Security-Policy", contentSecurityPolicyValue);
  headers.delete("Content-Security-Policy-Report-Only");
  // These values are derived inside the Worker and overwrite anything sent by
  // a client. Server components use them for canonical URLs and JSON-LD.
  headers.set(TRUSTED_REQUEST_ORIGIN_HEADER, requestOrigin);
  headers.set(TRUSTED_REQUEST_PATHNAME_HEADER, requestPathname);
  if (nonce) {
    headers.set(TRUSTED_CSP_NONCE_HEADER, nonce);
  } else {
    headers.delete(TRUSTED_CSP_NONCE_HEADER);
  }
  return new Request(request, { headers });
}

function createCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function secureResponse(
  request: Request,
  response: Response,
  contentSecurityPolicyValue: string,
  requestPathname: string | null,
): Response {
  const requestUrl = new URL(request.url);
  const headers = new Headers(response.headers);
  const isPrivateRequest =
    requestPathname === null || isPrivateOrIdentityPath(requestPathname);
  const containsPublicFormInstance =
    requestPathname === "/contact" || requestPathname === "/contact.rsc";

  headers.set("Content-Security-Policy", contentSecurityPolicyValue);
  headers.delete("Content-Security-Policy-Report-Only");
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  headers.set(
    "Referrer-Policy",
    isPrivateRequest ? "no-referrer" : "strict-origin-when-cross-origin",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.delete("x-vinext-timing");

  if (requestUrl.protocol === "https:") {
    headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  if (isPrivateRequest || response.status >= 400) {
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  } else if (
    requestUrl.search.length > 0 &&
    !/(?:^|,\s*)noindex(?:\s*,|$)/iu.test(headers.get("X-Robots-Tag") ?? "")
  ) {
    headers.set("X-Robots-Tag", "noindex, follow, noarchive");
  }
  if (
    isPrivateRequest ||
    containsPublicFormInstance ||
    response.status >= 500
  ) {
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.set("Pragma", "no-cache");
  } else if (requestPathname !== null) {
    const assetCacheControl = publicAssetCacheControl({
      method: request.method,
      pathname: requestPathname,
      status: response.status,
    });
    if (assetCacheControl) {
      headers.set("Cache-Control", assetCacheControl);
    }
  }
  if (
    requestPathname !== null &&
    (response.status === 200 || response.status === 304)
  ) {
    const assetContentType = publicAssetContentType(requestPathname);
    if (assetContentType) {
      headers.set("Content-Type", assetContentType);
    }
  }

  const startedAt = requestStartedAtUtcMs.get(request);
  const responseContentType = (headers.get("Content-Type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    startedAt !== undefined &&
    !isPrivateRequest &&
    (request.method === "GET" || request.method === "HEAD") &&
    !requestHasIdentityFacts(request) &&
    (responseContentType === "text/html" ||
      responseContentType === "text/x-component")
  ) {
    const durationMs = Math.min(
      PUBLIC_SERVER_TIMING_MAX_DURATION_MS,
      Math.max(0, Date.now() - startedAt),
    );
    headers.set("Server-Timing", `app;dur=${durationMs}`);
  } else {
    headers.delete("Server-Timing");
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function requestHasIdentityFacts(request: Request): boolean {
  if (
    request.headers.has("authorization") ||
    request.headers.has("cookie") ||
    request.headers.has("proxy-authorization")
  ) {
    return true;
  }
  for (const name of request.headers.keys()) {
    if (name.toLowerCase().startsWith("oai-authenticated-user")) return true;
  }
  return false;
}

async function recoverPublicResponseAfterFailure(
  media: R2Bucket,
  request: Request,
  pathname: string,
  nonce: string | null,
  policy: string,
  failure: PublicResponseFallbackFailure,
  source: "database_invariants" | "handler",
): Promise<Response | null> {
  const warmRecovered = publicResponseFallback.responseForFailure({
    contentSecurityPolicy: policy,
    failure,
    nonce,
    pathname,
    request,
  });
  const recovered =
    warmRecovered ??
    (await durablePublicResponseForFailure(media, {
      contentSecurityPolicy: policy,
      failure,
      nonce,
      pathname,
      request,
    }));
  if (!recovered) return null;
  console.warn(
    JSON.stringify({
      event: "public_last_known_good_response_served",
      level: "warn",
      source,
      storage: warmRecovered ? "isolate" : "media",
    }),
  );
  return secureResponse(request, recovered, policy, pathname);
}

async function captureDurableResponseAfterProtectedRequest(
  request: Request,
  response: Response,
  env: Env,
  context: ExecutionContext,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (
    request.method !== "POST" ||
    requestUrl.pathname !== DURABLE_PUBLIC_RESPONSE_CAPTURE_PATH ||
    response.status !== 200
  ) {
    return response;
  }
  const rawPayload: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  if (
    typeof rawPayload !== "object" ||
    rawPayload === null ||
    Array.isArray(rawPayload)
  ) {
    return response;
  }
  const payload = rawPayload as Record<string, unknown>;
  if (
    payload.status !== "accepted" ||
    typeof payload.batchId !== "string" ||
    !isDurablePublicResponseFallbackSlot(payload.slot)
  ) {
    return response;
  }

  const origin = trustedPublicRequestOrigin(requestUrl, env.PUBLIC_SITE_URL);
  try {
    const captured = await captureDurablePublicResponseFallbackSlot(env.MEDIA, {
      batchId: payload.batchId,
      origin,
      render: (buildRequest) =>
        renderDurablePublicResponse(buildRequest, env, context),
      slot: payload.slot,
    });
    console.info(
      JSON.stringify({
        capturedEntryCount: captured.capturedEntryCount,
        event: captured.promoted
          ? "durable_public_responses_promoted"
          : "durable_public_response_staged",
        level: "info",
        source: "protected_snapshot_capture",
      }),
    );
    const headers = new Headers(response.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(
      JSON.stringify({
        batchId: payload.batchId,
        capturedEntryCount: captured.capturedEntryCount,
        promoted: captured.promoted,
        promotedByteSize: captured.promotedByteSize,
        slot: payload.slot,
        status: captured.promoted ? "succeeded" : "continue",
      }),
      {
        headers,
        status: response.status,
        statusText: response.statusText,
      },
    );
  } catch {
    console.error(
      JSON.stringify({
        event: "durable_public_response_capture_failed",
        level: "error",
        source: "protected_snapshot_capture",
      }),
    );
    return new Response(
      JSON.stringify({
        code: "service_unavailable",
        message: "The durable public snapshot could not be captured.",
      }),
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "Content-Type": "application/json; charset=utf-8",
          Pragma: "no-cache",
          "Referrer-Policy": "no-referrer",
        },
        status: 503,
      },
    );
  }
}

async function renderDurablePublicResponse(
  buildRequest: DurablePublicResponseBuildRequest,
  env: Env,
  context: ExecutionContext,
): Promise<Readonly<{ nonce: string; response: Response }>> {
  const requestUrl = new URL(buildRequest.request.url);
  const nonce = createCspNonce();
  const policy = contentSecurityPolicy(requestUrl, nonce);
  const securedRequest = requestWithSecurityContext(
    buildRequest.request,
    policy,
    nonce,
    trustedPublicRequestOrigin(requestUrl, env.PUBLIC_SITE_URL),
    buildRequest.pathname,
  );
  const rendered = await handler.fetch(securedRequest, env, context);
  return Object.freeze({
    nonce,
    response: secureResponse(
      buildRequest.request,
      rendered,
      policy,
      buildRequest.pathname,
    ),
  });
}

function databaseInvariantUnavailableResponse(
  detail = "The database safety checks could not be completed. Please try again shortly.",
): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow, noarchive">
    <title>Site temporarily unavailable</title>
  </head>
  <body>
    <main>
      <h1>The site is temporarily unavailable.</h1>
      <p>${detail}</p>
    </main>
  </body>
</html>`,
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
        "Retry-After": "30",
      },
      status: 503,
    },
  );
}

function captureInvitationToken(
  request: Request,
  requestUrl: URL,
  requestPathname: string,
): Response | null {
  if (
    request.method !== "GET" ||
    requestPathname !== "/accept-invitation" ||
    !requestUrl.searchParams.has("token")
  ) {
    return null;
  }

  const token = requestUrl.searchParams.get("token");
  const isLocal = isLocalRequest(requestUrl);
  const cleanUrl = new URL("/accept-invitation", requestUrl.origin);
  const headers = new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    Location: cleanUrl.toString(),
    Pragma: "no-cache",
  });
  headers.append(
    "Set-Cookie",
    isInvitationToken(token)
      ? invitationTokenCookie(token, isLocal)
      : clearInvitationTokenCookie(isLocal),
  );

  return new Response(null, { headers, status: 303 });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    requestStartedAtUtcMs.set(request, Date.now());
    try {
      const url = new URL(request.url);
      const nonce = isLocalRequest(url) ? null : createCspNonce();
      const policy = contentSecurityPolicy(url, nonce);
      const publicDomainRedirect = canonicalPublicRedirectTarget(
        url,
        env.PUBLIC_SITE_URL,
      );
      if (publicDomainRedirect) {
        return secureResponse(
          request,
          new Response(null, {
            headers: {
              "Cache-Control": "public, max-age=3600",
              Location: publicDomainRedirect.toString(),
            },
            status: 308,
          }),
          policy,
          url.pathname,
        );
      }
      const requestMethod = request.method.toUpperCase();
      const trailingSlashPathname = canonicalPathnameWithoutTrailingSlash(
        url.pathname,
      );
      if (
        trailingSlashPathname !== null &&
        (requestMethod === "GET" || requestMethod === "HEAD") &&
        !isPrivateOrIdentityPath(trailingSlashPathname)
      ) {
        const redirectUrl = new URL(url);
        redirectUrl.pathname = trailingSlashPathname;
        return secureResponse(
          request,
          new Response(null, {
            headers: {
              "Cache-Control": "public, max-age=3600",
              Location: redirectUrl.toString(),
            },
            status: 308,
          }),
          policy,
          trailingSlashPathname,
        );
      }
      const normalizedPathname = normalizeEncodedRequestPathname(url.pathname);
      if (normalizedPathname === null) {
        return secureResponse(
          request,
          new Response("The request path is invalid.", { status: 400 }),
          policy,
          null,
        );
      }
      const requestPathname = safeRequestPathname(normalizedPathname);
      const canonicalUrl = new URL(url);
      canonicalUrl.pathname = normalizedPathname;
      if (
        normalizedPathname === "/favicon.ico" &&
        (requestMethod === "GET" || requestMethod === "HEAD")
      ) {
        const faviconUrl = new URL(canonicalUrl);
        faviconUrl.pathname = "/favicon-32.png";
        return secureResponse(
          request,
          new Response(null, {
            headers: {
              "Cache-Control": "public, max-age=86400",
              Location: faviconUrl.toString(),
            },
            status: 308,
          }),
          policy,
          normalizedPathname,
        );
      }
      const assetOriginPath = publicAssetOriginPath({
        method: request.method,
        pathname: normalizedPathname,
      });
      if (assetOriginPath) {
        const assetUrl = new URL(request.url);
        assetUrl.pathname = assetOriginPath;
        const assetResponse = await env.ASSETS.fetch(
          new Request(assetUrl, {
            headers: request.headers,
            method: request.method,
          }),
        );
        const publicAsset =
          assetResponse.status >= 400
            ? responseWithNoStore(assetResponse)
            : assetResponse;
        return secureResponse(request, publicAsset, policy, normalizedPathname);
      }
      const invitationCapture = captureInvitationToken(
        request,
        canonicalUrl,
        normalizedPathname,
      );
      if (invitationCapture) {
        return secureResponse(
          request,
          invitationCapture,
          policy,
          normalizedPathname,
        );
      }

      if (normalizedPathname === "/_vinext/image") {
        const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
        const response = await handleImageOptimization(
          request,
          {
            fetchAsset: (path) =>
              env.ASSETS.fetch(new Request(new URL(path, request.url))),
            transformImage: async (body, { width, format, quality }) => {
              const result = await env.IMAGES.input(body)
                .transform(width > 0 ? { width } : {})
                .output({ format, quality });
              return result.response();
            },
          },
          allowedWidths,
        );
        return secureResponse(request, response, policy, normalizedPathname);
      }

      try {
        const invariantStatus = await ensureDatabaseInvariantsForRequest(env.DB, {
          method: request.method,
          pathname: requestPathname,
        });
        if (invariantStatus === "repaired") {
          console.info(
            JSON.stringify({
              code: "database_invariants_repaired",
              event: "database_invariant_retry_required",
              level: "info",
            }),
          );
          const unavailable = databaseInvariantUnavailableResponse(
            "The database safety checks were updated. Please try again shortly so the fresh state can be verified.",
          );
          return (
            (await recoverPublicResponseAfterFailure(
              env.MEDIA,
              request,
              requestPathname,
              nonce,
              policy,
              { kind: "response", status: unavailable.status },
              "database_invariants",
            )) ??
            secureResponse(request, unavailable, policy, normalizedPathname)
          );
        }
      } catch {
        console.error(
          JSON.stringify({
            code: "database_invariants_unavailable",
            event: "database_invariant_initialization_failed",
            level: "error",
          }),
        );
        const unavailable = databaseInvariantUnavailableResponse();
        return (
          (await recoverPublicResponseAfterFailure(
            env.MEDIA,
            request,
            requestPathname,
            nonce,
            policy,
            { kind: "throw" },
            "database_invariants",
          )) ?? secureResponse(request, unavailable, policy, normalizedPathname)
        );
      }

      if (
        shouldRunSynchronousRequestMaintenance(request.method, requestPathname)
      ) {
        const maintenance = await runRequestMaintenance(env.DB, {
          method: request.method,
          pathname: requestPathname,
        });
        if (maintenance.kind === "unavailable") {
          if (maintenance.source === "publication") {
            console.error(
              JSON.stringify({
                code: "publication_reconciliation_deferred",
                event: "scheduled_publication_reconciliation_failed",
                level: "error",
              }),
            );
          } else {
            console.error(
              JSON.stringify({
                code: "starter_copy_reconciliation_deferred",
                event: "starter_copy_reconciliation_failed",
                level: "error",
              }),
            );
          }
          return secureResponse(
            request,
            maintenanceUnavailableResponse(),
            policy,
            normalizedPathname,
          );
        }
        if (maintenance.kind === "redirect") {
          return secureResponse(
            request,
            maintenanceRedirect(canonicalUrl),
            policy,
            normalizedPathname,
          );
        }
      }

      const securedRequest = requestWithSecurityContext(
        request,
        policy,
        nonce,
        trustedPublicRequestOrigin(url, env.PUBLIC_SITE_URL),
        requestPathname,
      );
      const response = await handler.fetch(securedRequest, env, ctx).catch(
        async (error: unknown) => {
          const recovered = await recoverPublicResponseAfterFailure(
            env.MEDIA,
            request,
            requestPathname,
            nonce,
            policy,
            { kind: "throw" },
            "handler",
          );
          if (recovered) return recovered;
          throw error;
        },
      );
      const responseAfterDurableRefresh =
        await captureDurableResponseAfterProtectedRequest(
          request,
          response,
          env,
          ctx,
        );
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        !isPrivateOrIdentityPath(requestPathname)
      ) {
        schedulePublicRequestMaintenance(ctx, env.DB, {
          method: request.method,
          pathname: requestPathname,
        });
      }
      const responseAfterFailure =
        responseAfterDurableRefresh.status >= 500
          ? ((await recoverPublicResponseAfterFailure(
              env.MEDIA,
              request,
              requestPathname,
              nonce,
              policy,
              {
                kind: "response",
                status: responseAfterDurableRefresh.status,
              },
              "handler",
            )) ?? responseAfterDurableRefresh)
          : responseAfterDurableRefresh;
      const securedResponse = secureResponse(
        request,
        responseAfterFailure,
        policy,
        normalizedPathname,
      );
      const capture = publicResponseFallback.scheduleCapture({
        nonce,
        pathname: requestPathname,
        request,
        response: securedResponse,
      });
      if (capture) ctx.waitUntil(capture);
      return securedResponse;
    } catch (error) {
      const requestUrl = new URL(request.url);
      const method = request.method.toUpperCase();
      const normalizedPathname = normalizeEncodedRequestPathname(
        requestUrl.pathname,
      );
      const requestPathname =
        normalizedPathname === null
          ? null
          : safeRequestPathname(normalizedPathname);
      if (
        requestPathname === null ||
        (method !== "GET" && method !== "HEAD") ||
        isPrivateOrIdentityPath(requestPathname)
      ) {
        throw error;
      }
      const nonce = isLocalRequest(requestUrl) ? null : createCspNonce();
      const policy = contentSecurityPolicy(requestUrl, nonce);
      console.error(
        JSON.stringify({
          event: "public_request_dispatch_failed",
          level: "error",
          source: "worker",
        }),
      );
      const recovered = await recoverPublicResponseAfterFailure(
        env.MEDIA,
        request,
        requestPathname,
        nonce,
        policy,
        { kind: "throw" },
        "handler",
      ).catch(() => null);
      return (
        recovered ??
        secureResponse(
          request,
          databaseInvariantUnavailableResponse(
            "The request could not be completed safely. Please try again shortly.",
          ),
          policy,
          requestPathname,
        )
      );
    }
  },
};

function responseWithNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export default worker;
