import type { Metadata } from "next";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { Dashboard } from "@/app/_organizer/Dashboard";
import { loadOrganizerDashboard } from "@/app/_organizer/data";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function OrganizerDashboardPage() {
  const loaded = await loadOrganizerPageContext("/organizer");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") {
    return <AccessChangedState />;
  }

  let data: Awaited<ReturnType<typeof loadOrganizerDashboard>> | null = null;
  try {
    data = await loadOrganizerDashboard(loaded.context);
  } catch {
    logPageFailure("/organizer");
  }
  if (data === null) {
    return (
      <>
        <PageHeader
          eyebrow="Private field desk"
          introduction="No dashboard totals or event state are being guessed."
          title="Dashboard"
        />
        <OrganizerPageState
          detail="The private dashboard could not read its current D1 records. Refresh to try again."
          heading="Workspace data is temporarily unavailable."
          tone="error"
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        action={{ href: "/organizer/events/new", label: "Add an Idea or Draft" }}
        eyebrow="Private field desk"
        introduction="Keep private Ideas, Drafts, holds, confirmed schedules, conflicts, assignments, and source health in view. Website publication remains unavailable."
        title={`Good to see you, ${firstName(loaded.context.organizerDisplayName)}.`}
      />
      <Dashboard
        canManageTeam={
          loaded.context.membership.role === "owner" ||
          loaded.context.membership.role === "administrator"
        }
        data={data}
      />
    </>
  );
}

function AccessChangedState() {
  return (
    <OrganizerPageState
      detail="Your active membership could not be revalidated for this request."
      heading="Organizer access changed."
      tone="error"
    />
  );
}

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/u)[0] || "organizer";
}

function logPageFailure(route: string) {
  writeSafeLog("error", "organizer_page_failed", {
    code: "internal_error",
    route,
    status: 500,
  });
}
