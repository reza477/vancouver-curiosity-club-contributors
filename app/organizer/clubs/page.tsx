import type { Metadata } from "next";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { ClubsWorkspace } from "@/app/_organizer/ClubsWorkspace";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { listOrganizerClubs } from "@/lib/server/organizer/clubs";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clubs" };

export default async function OrganizerClubsPage() {
  const loaded = await loadOrganizerPageContext("/organizer/clubs");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  let clubs: Awaited<ReturnType<typeof listOrganizerClubs>> | null = null;
  try {
    clubs = await listOrganizerClubs(
      loaded.context.database,
      loaded.context.identity,
    );
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/clubs",
      status: 500,
    });
  }
  if (clubs === null) {
    return (
      <>
        <PageHeader
          eyebrow="Internal planning"
          introduction="No club state is being guessed."
          title="Clubs"
        />
        <OrganizerPageState
          detail="The private club directory could not be loaded. Refresh to try again."
          heading="Clubs temporarily unavailable."
          tone="error"
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        eyebrow="Internal planning"
        introduction="Keep organizer assignments and private planning notes clear. Existing public identities and Meetup destinations remain read-only in this phase."
        title="Clubs"
      />
      <ClubsWorkspace
        currentRole={loaded.context.membership.role}
        initialClubs={clubs}
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
