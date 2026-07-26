import type { Metadata } from "next";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { ActivityFeed } from "@/app/_organizer/ActivityFeed";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { SettingsForm } from "@/app/_organizer/SettingsForm";
import { listActivityHistory } from "@/lib/server/organizer/activity";
import { getWorkspaceSettings } from "@/lib/server/organizer/settings";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

export default async function OrganizerSettingsPage() {
  const loaded = await loadOrganizerPageContext("/organizer/settings");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  let data:
    | Readonly<{
        activity: Awaited<ReturnType<typeof listActivityHistory>>;
        settings: Awaited<ReturnType<typeof getWorkspaceSettings>>;
      }>
    | null = null;
  try {
    const [settings, activity] = await Promise.all([
      getWorkspaceSettings(loaded.context.database, loaded.context.identity),
      listActivityHistory(loaded.context.database, loaded.context.identity, {
        limit: 40,
      }),
    ]);
    data = { activity, settings };
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/settings",
      status: 500,
    });
  }
  if (data === null) {
    return (
      <>
        <PageHeader
          eyebrow="Workspace administration"
          introduction="No setting or activity is being guessed."
          title="Settings"
        />
        <OrganizerPageState
          detail="Private workspace settings could not be loaded. Refresh to try again."
          heading="Settings temporarily unavailable."
          tone="error"
        />
      </>
    );
  }
  const canManage =
    loaded.context.membership.role === "owner" ||
    loaded.context.membership.role === "administrator";
  return (
    <>
      <PageHeader
        eyebrow="Workspace administration"
        introduction="Private planning defaults and append-only activity live here. Public branding, legal wording, and conflict policy are deliberately absent."
        title="Settings"
      />
      <SettingsForm canManage={canManage} initialSettings={data.settings} />
      <ActivityFeed items={data.activity} />
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
