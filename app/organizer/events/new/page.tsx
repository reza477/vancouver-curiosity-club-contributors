import type { Metadata } from "next";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { EventEditorForm } from "@/app/_organizer/EventEditorForm";
import {
  emptyEventValue,
  loadEventFormOptions,
} from "@/app/_organizer/data";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Add private event",
};

export default async function NewOrganizerEventPage() {
  const loaded = await loadOrganizerPageContext("/organizer/events/new");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChangedState />;

  let options: Awaited<ReturnType<typeof loadEventFormOptions>> | null = null;
  try {
    options = await loadEventFormOptions(loaded.context);
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/events/new",
      status: 500,
    });
  }
  if (options === null) {
    return (
      <>
        <PageHeader
          eyebrow="Private planning"
          introduction="No form options are being guessed."
          title="Add an Idea or Draft"
        />
        <OrganizerPageState
          detail="The authorized clubs and organizer options could not be loaded."
          heading="The event form is temporarily unavailable."
          tone="error"
        />
      </>
    );
  }
  if (options.clubs.length === 0) {
    return (
      <>
        <PageHeader
          eyebrow="Private planning"
          introduction="A valid active club assignment is required before a record can be created."
          title="Add an Idea or Draft"
        />
        <OrganizerPageState
          action={{ href: "/organizer/clubs", label: "Open clubs" }}
          detail="No club is available within your current authorization scope."
          heading="A club assignment is needed."
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        eyebrow="Private planning"
        introduction="Use one clear form. An Idea may stay unscheduled; a Draft needs a real schedule. Every saved record remains private."
        title="Add an Idea or Draft"
      />
      <EventEditorForm
        canManageOrganizationWide={
          loaded.context.membership.role === "owner" ||
          loaded.context.membership.role === "administrator"
        }
        currentActorProfileId={loaded.context.membership.profileId}
        initialValue={emptyEventValue(
          loaded.context.membership.profileId,
          loaded.context.defaultTimezone,
        )}
        mode="create"
        options={options}
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
