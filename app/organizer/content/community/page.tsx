import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { CommunityContentEditor } from "@/app/_organizer/CommunityContentEditor";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import {
  listCmsEntities,
  readCmsEntityWorkspace,
} from "@/lib/server/organizer/cms";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Community destinations" };

type PageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default async function OrganizerCommunityContentPage({
  searchParams,
}: PageProps) {
  const selectedValue = (await searchParams).entity;
  const selected =
    typeof selectedValue === "string" && selectedValue.length <= 128
      ? selectedValue
      : null;
  const loaded = await loadOrganizerPageContext(
    selected
      ? `/organizer/content/community?entity=${encodeURIComponent(selected)}`
      : "/organizer/content/community",
  );
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  if (
    loaded.context.membership.role !== "owner" &&
    loaded.context.membership.role !== "administrator"
  ) {
    forbidden();
  }
  let data:
    | Readonly<{
        entities: Awaited<ReturnType<typeof listCmsEntities>>;
        workspace: Awaited<ReturnType<typeof readCmsEntityWorkspace>> | null;
      }>
    | null = null;
  try {
    const all = await listCmsEntities(
      loaded.context.database,
      loaded.context.identity,
    );
    const entities = all.filter(
      (entity) => entity.entityType === "community_link",
    );
    const key = selected ?? entities[0]?.entityKey ?? null;
    const workspace = key
      ? await readCmsEntityWorkspace(
          loaded.context.database,
          loaded.context.identity,
          "community_link",
          key,
        )
      : null;
    data = Object.freeze({ entities, workspace });
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/content/community",
      status: 500,
    });
  }
  return (
    <>
      <PageHeader
        eyebrow="Community link hub"
        introduction="Publish only exact, confirmed destinations. Draft and unconfirmed links stay private; no on-site chat, forum, or messaging feature is implied."
        title="Community destinations"
      />
      {data ? (
        <CommunityContentEditor
          entities={data.entities}
          initialWorkspace={data.workspace}
          key={data.workspace?.entity.entityKey ?? "new-community-link"}
        />
      ) : (
        <OrganizerPageState
          detail="No substitute destinations are being shown or published."
          heading="Community content is temporarily unavailable."
          tone="error"
        />
      )}
    </>
  );
}

function AccessChanged() {
  return (
    <OrganizerPageState
      detail="Only a current Owner or Administrator can manage public destinations."
      heading="Content access is unavailable."
      tone="error"
    />
  );
}
