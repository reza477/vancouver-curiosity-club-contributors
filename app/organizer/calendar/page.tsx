import type { Metadata } from "next";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { CalendarWorkspace } from "@/app/_organizer/CalendarWorkspace";
import { loadCalendarWorkspaceData } from "@/app/_organizer/data";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { PrivateCalendarSubscriptionPanel } from "@/app/_organizer/PrivateCalendarSubscriptionPanel";
import { revalidateAuthorizedMembership } from "@/lib/server/auth";
import { listOwnCalendarSubscriptions } from "@/lib/server/phase7/calendar-subscriptions";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Calendar",
};

type PageSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function OrganizerCalendarPage({
  searchParams,
}: Readonly<{ searchParams: PageSearchParams }>) {
  const raw = await searchParams;
  const loaded = await loadOrganizerPageContext("/organizer/calendar");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChangedState />;

  let data: Awaited<ReturnType<typeof loadCalendarWorkspaceData>> | null = null;
  let subscriptions:
    | Awaited<ReturnType<typeof listOwnCalendarSubscriptions>>
    | null = null;
  try {
    const currentData = await loadCalendarWorkspaceData(
      loaded.context,
      raw.take === undefined ? 500 : raw.take,
    );
    const currentSubscriptions = await listOwnCalendarSubscriptions(
      loaded.context.database,
      loaded.context.identity,
    );
    await revalidateAuthorizedMembership(
      loaded.context.database,
      loaded.context.identity,
      loaded.context.membership,
    );
    data = currentData;
    subscriptions = currentSubscriptions;
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/calendar",
      status: 500,
    });
  }
  if (data === null) {
    return (
      <>
        <PageHeader
          eyebrow="Organization-wide schedule"
          introduction="No calendar record or source state is being guessed."
          title="Calendar"
        />
        <OrganizerPageState
          detail="The private calendar could not read its current D1 records. Refresh to try again."
          heading="Calendar temporarily unavailable."
          tone="error"
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        action={{ href: "/organizer/events/new", label: "Add an Idea or Draft" }}
        eyebrow="Organization-wide schedule"
        introduction="Read the shared private agenda across clubs. Imported and existing reserving records are visible but remain read-only; unscheduled Ideas stay off the date grid."
        title="Calendar"
      />
      <CalendarWorkspace {...data} />
      {subscriptions ? (
        <PrivateCalendarSubscriptionPanel
          initialSubscriptions={subscriptions}
        />
      ) : (
        <OrganizerPageState
          detail="Existing calendar URLs remain unchanged. Refresh before creating or revoking one."
          heading="Calendar subscriptions are temporarily unavailable."
          tone="error"
        />
      )}
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
