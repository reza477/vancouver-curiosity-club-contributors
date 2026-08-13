/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { ensureDatabaseInvariants } from "../lib/server/database/invariants";
import { runRequestMaintenance } from "../lib/server/database/request-maintenance";
import {
  preparePublicEventsResponse,
  PUBLIC_EVENTS_RESPONSE_NONCE_PLACEHOLDER,
  publicEventsResponseCacheContext,
  readPublicEventsResponseCache,
  rehydratePublicEventsCachedResponse,
  type PublicEventsResponseCache,
  writePublicEventsResponseCache,
} from "../lib/server/public/events-response-cache";
import {
  clearInvitationTokenCookie,
  invitationTokenCookie,
  isInvitationToken,
} from "../lib/server/organizer/invitation-token-cookie";
import {
  isPrivateOrIdentityPath,
  normalizeEncodedRequestPathname,
  safeRequestPathname,
} from "../lib/request-pathname";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
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
    requestPathname === null ||
    isPrivateOrIdentityPath(requestPathname);

  headers.set("Content-Security-Policy", contentSecurityPolicyValue);
  headers.delete("Content-Security-Policy-Report-Only");
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  headers.set(
    "Referrer-Policy",
    isPrivateRequest
      ? "no-referrer"
      : "strict-origin-when-cross-origin",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");

  if (requestUrl.protocol === "https:") {
    headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  if (
    isPrivateRequest ||
    response.status >= 400
  ) {
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  } else if (
    requestUrl.search.length > 0 &&
    !/(?:^|,\s*)noindex(?:\s*,|$)/iu.test(
      headers.get("X-Robots-Tag") ?? "",
    )
  ) {
    headers.set("X-Robots-Tag", "noindex, follow, noarchive");
  }
  if (isPrivateRequest || response.status >= 500) {
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.set("Pragma", "no-cache");
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const nonce = isLocalRequest(url) ? null : createCspNonce();
    const policy = contentSecurityPolicy(url, nonce);
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
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) =>
          env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return secureResponse(
        request,
        response,
        policy,
        normalizedPathname,
      );
    }

    try {
      const invariantStatus = await ensureDatabaseInvariants(env.DB);
      if (invariantStatus === "repaired") {
        console.info(
          JSON.stringify({
            code: "database_invariants_repaired",
            event: "database_invariant_retry_required",
            level: "info",
          }),
        );
        return secureResponse(
          request,
          databaseInvariantUnavailableResponse(
            "The database safety checks were updated. Please try again shortly so the fresh state can be verified.",
          ),
          policy,
          normalizedPathname,
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
      return secureResponse(
        request,
        databaseInvariantUnavailableResponse(),
        policy,
        normalizedPathname,
      );
    }

    const maintenance = await runRequestMaintenance(
      env.DB,
      {
        method: request.method,
        pathname: requestPathname,
      },
    );
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

    const eventsResponseCache =
      nonce === null
        ? null
        : await publicEventsResponseCacheContext(
            request,
            normalizedPathname,
            typeof caches === "object"
              ? (
                  caches as unknown as Readonly<{
                    default: PublicEventsResponseCache;
                  }>
                ).default
              : null,
          );
    if (eventsResponseCache && nonce) {
      const cached = await readPublicEventsResponseCache(eventsResponseCache);
      if (cached) {
        const rehydrated = await rehydratePublicEventsCachedResponse(
          cached,
          nonce,
        );
        return secureResponse(
          request,
          rehydrated,
          policy,
          normalizedPathname,
        );
      }
    }

    const renderNonce = eventsResponseCache
      ? PUBLIC_EVENTS_RESPONSE_NONCE_PLACEHOLDER
      : nonce;
    const renderPolicy = eventsResponseCache
      ? contentSecurityPolicy(url, renderNonce)
      : policy;

    const securedRequest = requestWithSecurityContext(
      request,
      renderPolicy,
      renderNonce,
      url.origin,
      requestPathname,
    );
    let response = await handler.fetch(securedRequest, env, ctx);
    if (eventsResponseCache && nonce) {
      const prepared = await preparePublicEventsResponse(
        response,
        eventsResponseCache,
        nonce,
      );
      response = prepared.response;
      if (prepared.cacheResponse) {
        ctx.waitUntil(
          writePublicEventsResponseCache(
            eventsResponseCache,
            prepared.cacheResponse,
          ),
        );
      }
    }
    return secureResponse(
      request,
      response,
      policy,
      normalizedPathname,
    );
  },
};

export default worker;
