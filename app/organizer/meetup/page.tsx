import type { Metadata } from "next";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import {
  ensureMeetupProgramClubs,
  getMeetupConnectionState,
} from "@/lib/server/meetup";
import { writeSafeLog } from "@/lib/validation/server-observability";
import { MeetupControls } from "./MeetupControls";
import { toMeetupUiState } from "./model";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Meetup calendar feeds",
  robots: {
    follow: false,
    index: false,
    nocache: true,
    noarchive: true,
    noimageindex: true,
  },
};

export default async function OrganizerMeetupPage() {
  const loaded = await loadOrganizerPageContext("/organizer/meetup");
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
  let data:
    | Readonly<{
        canConfigure: boolean;
        clubs: Awaited<ReturnType<typeof ensureMeetupProgramClubs>>;
        state: Awaited<ReturnType<typeof getMeetupConnectionState>>;
      }>
    | null = null;
  try {
    const canConfigure =
      loaded.context.membership.role === "owner" ||
      loaded.context.membership.role === "administrator";
    const state = await getMeetupConnectionState(
      loaded.context.database,
      loaded.context.identity,
    );
    const clubs = canConfigure
      ? await ensureMeetupProgramClubs(
          loaded.context.database,
          loaded.context.identity,
        )
      : Object.freeze([]);
    data = { canConfigure, clubs, state };
  } catch {
    writeSafeLog("error", "meetup_ui_failed", {
      code: "internal_error",
      operation: "read_meetup_connection",
      route: "/organizer/meetup",
      status: 503,
    });
  }
  if (data === null) {
    return (
      <>
        <PageHeader
          eyebrow="Official source connection"
          introduction="No source address, refresh result, or feed state is being guessed."
          title="Meetup calendar feeds"
        />
        <OrganizerPageState
          detail="The connection controls could not be loaded. Refresh to try again."
          heading="Meetup connection temporarily unavailable."
          tone="error"
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        eyebrow="Official source connection"
        introduction={
          data.canConfigure
            ? "Manage official feed coverage and inspect aggregate status without exposing saved addresses or claiming a refresh that did not happen."
            : "Inspect aggregate feed status. Saved addresses and mutation controls remain restricted to an Owner or Administrator."
        }
        title="Meetup calendar feeds"
      />
      <MeetupControls
        canConfigure={data.canConfigure}
        clubOptions={data.clubs}
        initialState={toMeetupUiState(data.state)}
      />
    </>
  );
}
