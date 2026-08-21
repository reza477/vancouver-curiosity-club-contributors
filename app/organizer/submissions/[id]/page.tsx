import type { Metadata } from "next";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { SubmissionWorkspace } from "@/app/_organizer/SubmissionWorkspace";
import {
  getFormSubmission,
  listSubmissionAssignees,
} from "@/lib/server/phase7/submissions";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Submission" };

type RouteParams = Promise<{ id: string }>;

export default async function OrganizerSubmissionDetailPage({
  params,
}: Readonly<{ params: RouteParams }>) {
  const { id } = await params;
  const loaded = await loadOrganizerPageContext(
    `/organizer/submissions/${encodeURIComponent(id)}`,
  );
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  const manager =
    loaded.context.membership.role === "owner" ||
    loaded.context.membership.role === "administrator";
  let data:
    | Readonly<{
        assignees: Awaited<ReturnType<typeof listSubmissionAssignees>>;
        submission: Awaited<ReturnType<typeof getFormSubmission>>;
      }>
    | null = null;
  try {
    const submission = await getFormSubmission(
      loaded.context.database,
      loaded.context.identity,
      id,
    );
    const assignees = manager
      ? await listSubmissionAssignees(
          loaded.context.database,
          loaded.context.identity,
        )
      : [];
    data = { assignees, submission };
  } catch {
    writeSafeLog("warn", "organizer_submission_unavailable", {
      code: "not_found",
      route: "/organizer/submissions/[id]",
      status: 404,
    });
  }
  if (!data) {
    return (
      <>
        <PageHeader
          eyebrow="Private inbox"
          introduction="The record may not exist, may belong to another organization, or may no longer be assigned to you."
          title="Submission unavailable"
        />
        <OrganizerPageState
          detail="No private submission content is being disclosed."
          heading="This submission could not be opened."
          tone="error"
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        action={{ href: "/organizer/submissions", label: "Back to inbox" }}
        eyebrow="Private inbox"
        introduction="A private organizer email copy may be sent when the form arrives. Status still records manual follow-up outside the application; the site does not send the visitor a response."
        title={data.submission.publicReference}
      />
      <SubmissionWorkspace
        assignees={data.assignees}
        initialSubmission={data.submission}
        role={loaded.context.membership.role}
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
