import type { Metadata } from "next";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { loadEventIndexData } from "@/app/_organizer/data";
import { EventIndex } from "@/app/_organizer/EventIndex";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Private events",
};

type PageSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function OrganizerEventsPage({
  searchParams,
}: Readonly<{ searchParams: PageSearchParams }>) {
  const raw = await searchParams;
  const loaded = await loadOrganizerPageContext("/organizer/events");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChangedState />;

  let events: Awaited<ReturnType<typeof loadEventIndexData>> | null = null;
  try {
    events = await loadEventIndexData(loaded.context, {
      page: raw.page,
      search: raw.search,
      status: raw.status,
    });
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/events",
      status: 500,
    });
  }
  if (events === null) {
    return (
      <>
        <PageHeader
          eyebrow="Private planning records"
          introduction="No private record is being guessed."
          title="Events"
        />
        <OrganizerPageState
          detail="The private event list could not be loaded. Refresh to try again."
          heading="Events temporarily unavailable."
          tone="error"
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        action={{ href: "/organizer/events/new", label: "Add an Idea or Draft" }}
        eyebrow="Private planning records"
        introduction="Create and coordinate non-reserving Ideas and Drafts. Source-controlled, reserving, or published records remain read-only in Phase 3."
        title="Events"
      />
      <EventIndex {...events} />
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
