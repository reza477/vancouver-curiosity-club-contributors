import type { D1DatabaseLike } from "../auth";
import {
  reconcileDueOrganizerPublications,
  type PublicationReconciliationResult,
} from "../organizer/publication";
import {
  reconcilePhase7StarterPageCopy,
  reconcileVisitorEventsCopy,
  reconcileVisitorFeedbackCopy,
  reconcileVisitorFormPageCopy,
  reconcileVisitorPrivacyCopy,
  type Phase7StarterCopyReconciliationResult,
  type VisitorEventsCopyReconciliationResult,
  type VisitorFeedbackCopyReconciliationResult,
  type VisitorFormPageCopyReconciliationResult,
  type VisitorPrivacyCopyReconciliationResult,
} from "../organizer/cms";

export type RequestMaintenanceResult =
  | Readonly<{ kind: "continue" }>
  | Readonly<{
      kind: "redirect";
      source: "cms" | "publication";
    }>
  | Readonly<{
      kind: "unavailable";
      source: "cms" | "publication";
    }>;

type RequestMaintenanceServices = Readonly<{
  reconcilePublication: (
    database: D1DatabaseLike,
  ) => Promise<PublicationReconciliationResult>;
  reconcileStarterCopy?: (
    database: D1DatabaseLike,
  ) => Promise<Phase7StarterCopyReconciliationResult>;
  reconcileVisitorFeedback?: (
    database: D1DatabaseLike,
  ) => Promise<VisitorFeedbackCopyReconciliationResult>;
  reconcileVisitorEvents?: (
    database: D1DatabaseLike,
  ) => Promise<VisitorEventsCopyReconciliationResult>;
  reconcileVisitorFormPages?: (
    database: D1DatabaseLike,
  ) => Promise<VisitorFormPageCopyReconciliationResult>;
  reconcileVisitorPrivacy?: (
    database: D1DatabaseLike,
  ) => Promise<VisitorPrivacyCopyReconciliationResult>;
}>;

const DEFAULT_REQUEST_MAINTENANCE_SERVICES: RequestMaintenanceServices =
  Object.freeze({
    reconcilePublication: (database) =>
      reconcileDueOrganizerPublications(database, { limit: 1 }),
    reconcileStarterCopy: (database) =>
      reconcilePhase7StarterPageCopy(database),
    reconcileVisitorEvents: (database) =>
      reconcileVisitorEventsCopy(database),
    reconcileVisitorFeedback: (database) =>
      reconcileVisitorFeedbackCopy(database),
    reconcileVisitorFormPages: (database) =>
      reconcileVisitorFormPageCopy(database),
    reconcileVisitorPrivacy: (database) =>
      reconcileVisitorPrivacyCopy(database),
  });

const CONTINUE = Object.freeze({
  kind: "continue" as const,
});

export async function runRequestMaintenance(
  database: D1DatabaseLike,
  request: Readonly<{
    method: string;
    pathname: string;
  }>,
  services: RequestMaintenanceServices =
    DEFAULT_REQUEST_MAINTENANCE_SERVICES,
): Promise<RequestMaintenanceResult> {
  if (
    shouldReconcilePhase7StarterCopy(
      request.method,
      request.pathname,
    )
  ) {
    let reconciliation: Phase7StarterCopyReconciliationResult;
    try {
      reconciliation = await (
        services.reconcileStarterCopy ??
        DEFAULT_REQUEST_MAINTENANCE_SERVICES.reconcileStarterCopy!
      )(database);
    } catch {
      return unavailable("cms");
    }
    if (reconciliation === "processed") {
      return redirect("cms");
    }
  }

  if (
    shouldReconcileVisitorFormPageCopy(
      request.method,
      request.pathname,
    )
  ) {
    let reconciliation: VisitorFormPageCopyReconciliationResult;
    try {
      reconciliation = await (
        services.reconcileVisitorFormPages ??
        DEFAULT_REQUEST_MAINTENANCE_SERVICES.reconcileVisitorFormPages!
      )(database);
    } catch {
      return unavailable("cms");
    }
    if (reconciliation === "processed") {
      return redirect("cms");
    }
  }

  if (
    shouldReconcileVisitorFeedbackCopy(
      request.method,
      request.pathname,
    )
  ) {
    let reconciliation: VisitorFeedbackCopyReconciliationResult;
    try {
      reconciliation = await (
        services.reconcileVisitorFeedback ??
        DEFAULT_REQUEST_MAINTENANCE_SERVICES.reconcileVisitorFeedback!
      )(database);
    } catch {
      return unavailable("cms");
    }
    if (reconciliation === "processed") {
      return redirect("cms");
    }
  }

  if (
    shouldReconcileVisitorPrivacyCopy(
      request.method,
      request.pathname,
    )
  ) {
    let reconciliation: VisitorPrivacyCopyReconciliationResult;
    try {
      reconciliation = await (
        services.reconcileVisitorPrivacy ??
        DEFAULT_REQUEST_MAINTENANCE_SERVICES.reconcileVisitorPrivacy!
      )(database);
    } catch {
      return unavailable("cms");
    }
    if (reconciliation === "processed") {
      return redirect("cms");
    }
  }

  if (
    shouldReconcileVisitorEventsCopy(
      request.method,
      request.pathname,
    )
  ) {
    let reconciliation: VisitorEventsCopyReconciliationResult;
    try {
      reconciliation = await (
        services.reconcileVisitorEvents ??
        DEFAULT_REQUEST_MAINTENANCE_SERVICES.reconcileVisitorEvents!
      )(database);
    } catch {
      return unavailable("cms");
    }
    if (reconciliation === "processed") {
      return redirect("cms");
    }
  }

  if (
    shouldReconcileScheduledPublication(
      request.method,
      request.pathname,
    )
  ) {
    let reconciliation: PublicationReconciliationResult;
    try {
      reconciliation =
        await services.reconcilePublication(database);
    } catch {
      return unavailable("publication");
    }
    if (reconciliation.inspected > 0) {
      if (reconciliation.transientFailures > 0) {
        return unavailable("publication");
      }
      if (
        reconciliation.executed > 0 ||
        reconciliation.invalidated > 0
      ) {
        return redirect("publication");
      }
      return unavailable("publication");
    }
  }

  return CONTINUE;
}

export function shouldReconcileVisitorFeedbackCopy(
  method: string,
  pathname: string,
): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return requestRoutePathname(pathname) === "/contact";
}

export function shouldReconcileVisitorEventsCopy(
  method: string,
  pathname: string,
): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return requestRoutePathname(pathname) === "/events";
}

export function shouldReconcileVisitorFormPageCopy(
  method: string,
  pathname: string,
): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const routePathname = requestRoutePathname(pathname);
  return (
    routePathname === "/get-involved" ||
    routePathname === "/host-an-event"
  );
}

export function shouldReconcileVisitorPrivacyCopy(
  method: string,
  pathname: string,
): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return requestRoutePathname(pathname) === "/privacy";
}

export function shouldReconcilePhase7StarterCopy(
  method: string,
  pathname: string,
): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const routePathname = requestRoutePathname(pathname);
  return (
    routePathname === "/contact" ||
    routePathname === "/get-involved" ||
    routePathname === "/host-an-event" ||
    routePathname === "/privacy"
  );
}

export function shouldReconcileScheduledPublication(
  method: string,
  pathname: string,
): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const routePathname = requestRoutePathname(pathname);
  return (
    routePathname === "/" ||
    routePathname === "/calendar" ||
    routePathname === "/events" ||
    routePathname.startsWith("/events/") ||
    routePathname.startsWith("/clubs/") ||
    routePathname === "/sitemap.xml" ||
    routePathname === "/organizer" ||
    routePathname.startsWith("/organizer/events/")
  );
}

export function shouldRunRequestMaintenance(
  method: string,
  pathname: string,
): boolean {
  return (
    shouldReconcilePhase7StarterCopy(method, pathname) ||
    shouldReconcileVisitorFormPageCopy(method, pathname) ||
    shouldReconcileVisitorFeedbackCopy(method, pathname) ||
    shouldReconcileVisitorPrivacyCopy(method, pathname) ||
    shouldReconcileVisitorEventsCopy(method, pathname) ||
    shouldReconcileScheduledPublication(method, pathname)
  );
}

function requestRoutePathname(pathname: string): string {
  return pathname.endsWith(".rsc")
    ? pathname.slice(0, -4) || "/"
    : pathname;
}

function redirect(
  source: "cms" | "publication",
): RequestMaintenanceResult {
  return Object.freeze({ kind: "redirect", source });
}

function unavailable(
  source: "cms" | "publication",
): RequestMaintenanceResult {
  return Object.freeze({ kind: "unavailable", source });
}
