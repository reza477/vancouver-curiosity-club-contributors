import type { D1DatabaseLike } from "../auth";
import {
  refreshMeetupCalendarSourceIfDue,
  type MeetupRefreshResult,
} from "../meetup";
import {
  reconcileDueOrganizerPublications,
  type PublicationReconciliationResult,
} from "../organizer/publication";
import {
  reconcilePhase7StarterPageCopy,
  type Phase7StarterCopyReconciliationResult,
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
}>;

type PublicMeetupRefreshServices = Readonly<{
  refreshMeetup: (
    database: D1DatabaseLike,
  ) => Promise<MeetupRefreshResult>;
}>;

export type PublicMeetupRefreshFailure =
  | "refresh_failed"
  | "refresh_unavailable";

const DEFAULT_REQUEST_MAINTENANCE_SERVICES: RequestMaintenanceServices =
  Object.freeze({
    reconcilePublication: (database) =>
      reconcileDueOrganizerPublications(database, { limit: 1 }),
    reconcileStarterCopy: (database) =>
      reconcilePhase7StarterPageCopy(database),
  });

const DEFAULT_PUBLIC_MEETUP_REFRESH_SERVICES: PublicMeetupRefreshServices =
  Object.freeze({
    refreshMeetup: (database) =>
      refreshMeetupCalendarSourceIfDue(database),
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

/**
 * Registers one bounded, lease-backed Meetup refresh after a public route has
 * rendered. The task absorbs both durable refresh failures and unexpected
 * service failures so a visitor always receives the last completed snapshot.
 */
export function schedulePublicMeetupRefresh(
  database: D1DatabaseLike,
  request: Readonly<{
    method: string;
    pathname: string;
  }>,
  waitUntil: (task: Promise<void>) => void,
  onFailure?: (failure: PublicMeetupRefreshFailure) => void,
  services: PublicMeetupRefreshServices =
    DEFAULT_PUBLIC_MEETUP_REFRESH_SERVICES,
): boolean {
  if (
    !shouldRefreshPublicMeetupCalendar(
      request.method,
      request.pathname,
    )
  ) {
    return false;
  }

  const reportFailure = (failure: PublicMeetupRefreshFailure) => {
    try {
      onFailure?.(failure);
    } catch {
      // Observability must never turn background maintenance into a failed
      // task or affect the public response that has already been rendered.
    }
  };
  const task = Promise.resolve()
    .then(() => services.refreshMeetup(database))
    .then((refresh) => {
      if (refresh.outcome === "failed") {
        reportFailure("refresh_failed");
      }
    })
    .catch(() => {
      reportFailure("refresh_unavailable");
    });
  waitUntil(task);
  return true;
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

export function shouldRefreshPublicMeetupCalendar(
  method: string,
  pathname: string,
): boolean {
  const routePathname = requestRoutePathname(pathname);
  return (
    (method === "GET" || method === "HEAD") &&
    (routePathname === "/" ||
      routePathname === "/calendar" ||
      routePathname === "/events")
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
