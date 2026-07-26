import type { Metadata } from "next";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { TeamWorkspace } from "@/app/_organizer/TeamWorkspace";
import { listOrganizerClubs } from "@/lib/server/organizer/clubs";
import { listOrganizerInvitations } from "@/lib/server/organizer/invitations";
import { listTeamMembers } from "@/lib/server/organizer/team";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Team" };

export default async function OrganizerTeamPage() {
  const loaded = await loadOrganizerPageContext("/organizer/team");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  const canManage =
    loaded.context.membership.role === "owner" ||
    loaded.context.membership.role === "administrator";
  let data:
    | Readonly<{
        clubs: Awaited<ReturnType<typeof listOrganizerClubs>>;
        invitations: Awaited<ReturnType<typeof listOrganizerInvitations>>;
        members: Awaited<ReturnType<typeof listTeamMembers>>;
      }>
    | null = null;
  try {
    const [clubs, members, invitations] = await Promise.all([
      listOrganizerClubs(loaded.context.database, loaded.context.identity),
      listTeamMembers(loaded.context.database, loaded.context.identity),
      canManage
        ? listOrganizerInvitations(
            loaded.context.database,
            loaded.context.identity,
          )
        : Promise.resolve([]),
    ]);
    data = { clubs, invitations, members };
  } catch {
    logFailure("/organizer/team");
  }
  if (data === null) return <Failure title="Team" />;
  return (
    <>
      <PageHeader
        eyebrow="People and permissions"
        introduction="Roles and club assignments are enforced again on every server request. Copyable invitations are delivered manually; this workspace sends no email."
        title="Team"
      />
      <TeamWorkspace
        clubs={data.clubs}
        currentRole={loaded.context.membership.role}
        initialInvitations={data.invitations}
        initialMembers={data.members}
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

function Failure({ title }: Readonly<{ title: string }>) {
  return (
    <>
      <PageHeader
        eyebrow="People and permissions"
        introduction="No membership or invitation state is being guessed."
        title={title}
      />
      <OrganizerPageState
        detail="The private team directory could not be loaded. Refresh to try again."
        heading="Team temporarily unavailable."
        tone="error"
      />
    </>
  );
}

function logFailure(route: string) {
  writeSafeLog("error", "organizer_page_failed", {
    code: "internal_error",
    route,
    status: 500,
  });
}
