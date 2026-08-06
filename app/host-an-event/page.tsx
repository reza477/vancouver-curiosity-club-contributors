import { notFound } from "next/navigation";
import {
  buildEditorialMetadata,
  EditorialUnavailable,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";
import { HostAnEventRouteBody } from "@/app/_components/EditorialRouteBodies";
import { PublicSubmissionForm } from "@/app/_components/PublicSubmissionForm";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { listPublicFormClubProgramChoices } from "@/lib/server/phase7/public-forms";

const route = "/host-an-event";
const slug = "host-an-event";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
    fallbackTitle: "Host an Event",
    path: route,
    route,
    slug,
  });
}

export default async function HostAnEventPage() {
  const loaded = await loadEditorialPage(slug, route);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Host an Event" />;
  }

  let choices: Awaited<
    ReturnType<typeof listPublicFormClubProgramChoices>
  > = [];
  try {
    choices = await listPublicFormClubProgramChoices(
      getRuntimeAuthConfiguration().database,
    );
  } catch {
    choices = [];
  }
  return (
    <HostAnEventRouteBody page={loaded.page}>
      <PublicSubmissionForm choices={choices} formKey="host_event" />
    </HostAnEventRouteBody>
  );
}
