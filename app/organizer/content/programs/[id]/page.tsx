import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import type {
  CmsLaneOption,
  CmsMediaOption,
  CmsResourceOption,
} from "@/app/_organizer/ClubContentEditor";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import {
  ProgramContentEditor,
  type CmsParentClubOption,
} from "@/app/_organizer/ProgramContentEditor";
import { revalidateAuthorizedMembership } from "@/lib/server/auth";
import { listMediaAssets } from "@/lib/server/media/storage";
import { readCmsEntityWorkspace } from "@/lib/server/organizer/cms";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit Program" };

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export default async function OrganizerProgramContentPage(
  context: RouteContext,
) {
  const { id } = await context.params;
  const route = `/organizer/content/programs/${encodeURIComponent(id)}`;
  const loaded = await loadOrganizerPageContext(route);
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
        clubs: readonly CmsParentClubOption[];
        lanes: readonly CmsLaneOption[];
        media: readonly CmsMediaOption[];
        resources: readonly CmsResourceOption[];
        workspace: Awaited<ReturnType<typeof readCmsEntityWorkspace>>;
      }>
    | null = null;
  try {
    const [workspace, assets, laneRows, clubRows, resourceRows] =
      await Promise.all([
        readCmsEntityWorkspace(
          loaded.context.database,
          loaded.context.identity,
          "program_public_profile",
          id,
        ),
        listMediaAssets(
          loaded.context.database,
          loaded.context.identity,
          { limit: 100 },
        ),
        loaded.context.database
          .prepare(
            `SELECT id, name
             FROM event_lanes
             WHERE organization_id = ?
               AND deleted_at IS NULL
             ORDER BY sort_order ASC, name COLLATE NOCASE ASC
             LIMIT 24`,
          )
          .bind(loaded.context.membership.organizationId)
          .all<Record<string, unknown>>(),
        loaded.context.database
          .prepare(
            `SELECT club.id, club.name, club.slug
             FROM clubs AS club
             WHERE club.organization_id = ?
               AND club.deleted_at IS NULL
             ORDER BY club.name COLLATE NOCASE ASC, club.id ASC
             LIMIT 100`,
          )
          .bind(loaded.context.membership.organizationId)
          .all<Record<string, unknown>>(),
        loaded.context.database
          .prepare(
            `SELECT page.id, page.title, page.slug
             FROM pages AS page
             JOIN cms_entity_publication_states AS state
               ON state.organization_id = page.organization_id
              AND state.entity_type = 'page'
              AND state.entity_key = page.id
              AND state.workflow_status = 'published'
              AND state.published_revision_id IS NOT NULL
             WHERE page.organization_id = ?
               AND page.status = 'published'
               AND page.visibility = 'public'
               AND page.deleted_at IS NULL
             ORDER BY page.title COLLATE NOCASE ASC, page.slug ASC
             LIMIT 100`,
          )
          .bind(loaded.context.membership.organizationId)
          .all<Record<string, unknown>>(),
      ]);
    await revalidateAuthorizedMembership(
      loaded.context.database,
      loaded.context.identity,
      loaded.context.membership,
      { allowedRoles: ["owner", "administrator"] },
    );
    data = Object.freeze({
      clubs: Object.freeze(
        (clubRows.results ?? []).flatMap((row) =>
          typeof row.id === "string" &&
          typeof row.name === "string" &&
          typeof row.slug === "string"
            ? [
                Object.freeze({
                  id: row.id,
                  label: row.name,
                  slug: row.slug,
                }),
              ]
            : [],
        ),
      ),
      lanes: Object.freeze(
        (laneRows.results ?? []).flatMap((row) =>
          typeof row.id === "string" && typeof row.name === "string"
            ? [Object.freeze({ id: row.id, label: row.name })]
            : [],
        ),
      ),
      media: Object.freeze(
        assets.flatMap((asset) => {
          const publicReady =
            asset.uploadState === "ready" &&
            asset.rightsStatus === "approved" &&
            (asset.consentStatus === "confirmed" ||
              asset.consentStatus === "not_applicable") &&
            Boolean(asset.credit?.trim()) &&
            (!asset.informative || Boolean(asset.altText?.trim()));
          return publicReady
            ? [
                Object.freeze({
                  altText: asset.altText ?? "",
                  id: asset.id,
                  label: asset.altText || asset.caption || "Approved artwork",
                }),
              ]
            : [];
        }),
      ),
      resources: Object.freeze(
        (resourceRows.results ?? []).flatMap((row) =>
          typeof row.id === "string" &&
          typeof row.title === "string" &&
          typeof row.slug === "string"
            ? [
                Object.freeze({
                  href: `/${row.slug}`,
                  id: row.id,
                  label: row.title,
                  state: "published" as const,
                }),
              ]
            : [],
        ),
      ),
      workspace,
    });
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/content/programs/[id]",
      status: 500,
    });
  }
  return (
    <>
      <PageHeader
        eyebrow="Nested Program profile"
        introduction="Draft content is private. Publishing adds this Program beneath its canonical parent club without changing scheduling relationships."
        title="Edit Program"
      />
      {data ? (
        <ProgramContentEditor
          clubs={data.clubs}
          initialWorkspace={data.workspace}
          lanes={data.lanes}
          media={data.media}
          resources={data.resources}
        />
      ) : (
        <OrganizerPageState
          detail="The published Program remains unchanged. Refresh or return to Website content."
          heading="This Program editor is unavailable."
          tone="error"
        />
      )}
    </>
  );
}

function AccessChanged() {
  return (
    <OrganizerPageState
      detail="Only a current Owner or Administrator can edit Program content."
      heading="Content access is unavailable."
      tone="error"
    />
  );
}
