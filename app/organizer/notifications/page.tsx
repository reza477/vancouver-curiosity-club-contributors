import type { Metadata } from "next";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { NotificationCenter } from "@/app/_organizer/NotificationCenter";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { listNotifications } from "@/lib/server/organizer/notifications";
import { getOrganizerProfile } from "@/lib/server/organizer/profiles";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notifications" };

export default async function OrganizerNotificationsPage() {
  const loaded = await loadOrganizerPageContext("/organizer/notifications");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  let data:
    | Readonly<{
        page: Awaited<ReturnType<typeof listNotifications>>;
        profile: Awaited<ReturnType<typeof getOrganizerProfile>>;
      }>
    | null = null;
  try {
    const [page, profile] = await Promise.all([
      listNotifications(loaded.context.database, loaded.context.identity, {
        limit: 30,
      }),
      getOrganizerProfile(loaded.context.database, loaded.context.identity),
    ]);
    data = { page, profile };
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/notifications",
      status: 500,
    });
  }
  if (data === null) {
    return (
      <>
        <PageHeader
          eyebrow="Private coordination"
          introduction="No notification state is being guessed."
          title="Notifications"
        />
        <OrganizerPageState
          detail="The private notification center could not be loaded. Refresh to try again."
          heading="Notifications temporarily unavailable."
          tone="error"
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        eyebrow="Private coordination"
        introduction="Only genuine membership, assignment, schedule, conflict-review, and hold changes appear here. No email or digest is sent."
        title="Notifications"
      />
      <NotificationCenter
        initialPage={data.page}
        initialPreference={data.profile.notificationPreferenceMode}
      />
    </>
  );
}

function AccessChanged() {
  return (
    <OrganizerPageState
      detail="Your active membership could not be revalidated for this request."
      heading="Organizer access changed."
      tone="error"
    />
  );
}
