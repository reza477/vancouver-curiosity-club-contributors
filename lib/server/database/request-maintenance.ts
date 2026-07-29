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
      source: "cms" | "meetup" | "publication";
    }>
  | Readonly<{
      kind: "unavailable";
      source: "cms" | "meetup" | "publication";
    }>;

type RequestMaintenanceServices = Readonly<{
  reconcilePublication: (
    database: D1DatabaseLike,
  ) => Promise<PublicationReconciliationResult>;
  refreshMeetup: (
    database: D1DatabaseLike,
  ) => Promise<MeetupRefreshResult>;
  reconcileStarterCopy?: (
    database: D1DatabaseLike,
  ) => Promise<Phase7StarterCopyReconciliationResult>;
}>;

const DEFAULT_SERVICES: RequestMaintenanceServices = Object.freeze({
  reconcilePublication: (database) =>
    reconcileDueOrganizerPublications(database, { limit: 1 }),
  refreshMeetup: (database) =>
    refreshMeetupCalendarSourceIfDue(database),
  reconcileStarterCopy: (database) =>
    reconcilePhase7StarterPageCopy(database),
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
  services: RequestMaintenanceServices = DEFAULT_SERVICES,
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
        DEFAULT_SERVICES.reconcileStarterCopy!
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

  if (
    shouldRefreshPublicMeetupCalendar(
      request.method,
      request.pathname,
    )
  ) {
    let refresh: MeetupRefreshResult;
    try {
      refresh = await services.refreshMeetup(database);
    } catch {
      return unavailable("meetup");
    }
    if (attemptedMeetupRefresh(refresh.outcome)) {
      return redirect("meetup");
    }
  }

  return CONTINUE;
}

export function shouldReconcilePhase7StarterCopy(
  method: string,
  pathname: string,
): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return (
    pathname === "/contact" ||
    pathname === "/get-involved" ||
    pathname === "/host-an-event" ||
    pathname === "/privacy"
  );
}

export function shouldReconcileScheduledPublication(
  method: string,
  pathname: string,
): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return (
    pathname === "/" ||
    pathname === "/events" ||
    pathname.startsWith("/events/") ||
    pathname.startsWith("/clubs/") ||
    pathname === "/sitemap.xml" ||
    pathname === "/organizer" ||
    pathname.startsWith("/organizer/events/")
  );
}

export function shouldRefreshPublicMeetupCalendar(
  method: string,
  pathname: string,
): boolean {
  return (
    (method === "GET" || method === "HEAD") &&
    pathname === "/events"
  );
}

function attemptedMeetupRefresh(
  outcome: MeetupRefreshResult["outcome"],
): boolean {
  return (
    outcome === "busy" ||
    outcome === "completed" ||
    outcome === "failed" ||
    outcome === "not_modified" ||
    outcome === "partial"
  );
}

function redirect(
  source: "cms" | "meetup" | "publication",
): RequestMaintenanceResult {
  return Object.freeze({ kind: "redirect", source });
}

function unavailable(
  source: "cms" | "meetup" | "publication",
): RequestMaintenanceResult {
  return Object.freeze({ kind: "unavailable", source });
}
