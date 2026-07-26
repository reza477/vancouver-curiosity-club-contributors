import type { Metadata } from "next";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { ConflictReviewCenter } from "@/app/_organizer/ConflictReviewCenter";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Conflicts" };

export default async function OrganizerConflictsPage() {
  const loaded = await loadOrganizerPageContext("/organizer/conflicts");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") {
    return (
      <OrganizerPageState
        detail="Your active membership could not be revalidated for this request."
        heading="Organizer access changed."
        tone="error"
      />
    );
  }

  return (
    <>
      <PageHeader
        action={{ href: "/organizer/calendar", label: "Open Calendar" }}
        eyebrow="Private schedule coordination"
        introduction="Review real overlaps, version-bound decisions, and informational Draft warnings. Nothing here publishes an event or writes back to Meetup."
        title="Conflicts"
      />
      <ConflictReviewCenter />
    </>
  );
}
