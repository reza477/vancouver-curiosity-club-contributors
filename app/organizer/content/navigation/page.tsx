import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { NavigationContentEditor } from "@/app/_organizer/NavigationContentEditor";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { readCmsEntityWorkspace } from "@/lib/server/organizer/cms";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Navigation and footer" };

export default async function OrganizerNavigationContentPage() {
  const loaded = await loadOrganizerPageContext(
    "/organizer/content/navigation",
  );
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  if (
    loaded.context.membership.role !== "owner" &&
    loaded.context.membership.role !== "administrator"
  ) {
    forbidden();
  }
  let workspace: Awaited<ReturnType<typeof readCmsEntityWorkspace>> | null =
    null;
  try {
    workspace = await readCmsEntityWorkspace(
      loaded.context.database,
      loaded.context.identity,
      "navigation",
      "navigation",
    );
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/content/navigation",
      status: 500,
    });
  }
  return (
    <>
      <PageHeader
        eyebrow="Public wayfinding"
        introduction="Edit labels and order through a structured revision. Required routes, policy links, and the Organizer Login destination remain protected."
        title="Navigation and footer"
      />
      {workspace ? (
        <NavigationContentEditor initialWorkspace={workspace} />
      ) : (
        <OrganizerPageState
          detail="The currently published navigation remains unchanged."
          heading="Navigation editing is temporarily unavailable."
          tone="error"
        />
      )}
    </>
  );
}

function AccessChanged() {
  return (
    <OrganizerPageState
      detail="Only a current Owner or Administrator can manage navigation."
      heading="Content access is unavailable."
      tone="error"
    />
  );
}
