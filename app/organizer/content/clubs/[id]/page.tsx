import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import {
  ClubContentEditor,
  type CmsLaneOption,
  type CmsMediaOption,
  type CmsResourceOption,
} from "@/app/_organizer/ClubContentEditor";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { listMediaAssets } from "@/lib/server/media/storage";
import { readCmsEntityWorkspace } from "@/lib/server/organizer/cms";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit club profile" };

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export default async function OrganizerClubContentPage(context: RouteContext) {
  const { id } = await context.params;
  const route = `/organizer/content/clubs/${encodeURIComponent(id)}`;
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
        lanes: readonly CmsLaneOption[];
        media: readonly CmsMediaOption[];
        resources: readonly CmsResourceOption[];
        workspace: Awaited<ReturnType<typeof readCmsEntityWorkspace>>;
      }>
    | null = null;
  try {
    const [workspace, assets, laneRows, resourceRows] = await Promise.all([
      readCmsEntityWorkspace(
        loaded.context.database,
        loaded.context.identity,
        "club_public_profile",
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
           ORDER BY sort_order ASC, name ASC
           LIMIT 24`,
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
           ORDER BY page.title ASC, page.slug ASC
           LIMIT 100`,
        )
        .bind(loaded.context.membership.organizationId)
        .all<Record<string, unknown>>(),
    ]);
    data = Object.freeze({
      lanes: Object.freeze(
        (laneRows.results ?? []).flatMap((row) =>
          typeof row.id === "string" && typeof row.name === "string"
            ? [Object.freeze({ id: row.id, label: row.name })]
            : [],
        ),
      ),
      media: Object.freeze(
        assets.flatMap((asset) => {
          const hasPublicMetadata =
            asset.uploadState === "ready" &&
            asset.rightsStatus === "approved" &&
            (asset.consentStatus === "confirmed" ||
              asset.consentStatus === "not_applicable") &&
            Boolean(asset.credit?.trim()) &&
            (!asset.informative || Boolean(asset.altText?.trim()));
          return hasPublicMetadata
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
      route: "/organizer/content/clubs/[id]",
      status: 500,
    });
  }
  return (
    <>
      <PageHeader
        eyebrow="Club public profile"
        introduction="Draft edits do not change scheduling relationships, assignments, conflicts, or public output until a validated revision is published."
        title="Edit club profile"
      />
      {data ? (
        <ClubContentEditor
          initialWorkspace={data.workspace}
          lanes={data.lanes}
          media={data.media}
          resources={data.resources}
        />
      ) : (
        <OrganizerPageState
          detail="The published club profile remains unchanged. Refresh or return to the content dashboard."
          heading="This club editor is unavailable."
          tone="error"
        />
      )}
    </>
  );
}

function AccessChanged() {
  return (
    <OrganizerPageState
      detail="Only a current Owner or Administrator can edit club profiles."
      heading="Content access is unavailable."
      tone="error"
    />
  );
}
