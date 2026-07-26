import type { Metadata } from "next";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { ProfileForm } from "@/app/_organizer/ProfileForm";
import { getOrganizerProfile } from "@/lib/server/organizer/profiles";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Profile" };

export default async function OrganizerProfilePage() {
  const loaded = await loadOrganizerPageContext("/organizer/profile");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  let profile: Awaited<ReturnType<typeof getOrganizerProfile>> | null = null;
  try {
    profile = await getOrganizerProfile(
      loaded.context.database,
      loaded.context.identity,
    );
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/profile",
      status: 500,
    });
  }
  if (profile === null) {
    return (
      <>
        <PageHeader
          eyebrow="Personal workspace"
          introduction="No profile detail is being guessed."
          title="Profile"
        />
        <OrganizerPageState
          detail="Your organizer profile could not be loaded. Refresh to try again."
          heading="Profile temporarily unavailable."
          tone="error"
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        eyebrow="Personal workspace"
        introduction="Choose a readable organizer identity and in-app preference. Email and ChatGPT identity details are never made public."
        title="Profile"
      />
      <ProfileForm initialProfile={profile} />
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
