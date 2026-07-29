import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import {
  PageContentEditor,
  type CmsSelectionOption,
  type PageEditorSelectionOptions,
} from "@/app/_organizer/PageContentEditor";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { revalidateAuthorizedMembership } from "@/lib/server/auth";
import { listMediaAssets } from "@/lib/server/media/storage";
import { readCmsEntityWorkspace } from "@/lib/server/organizer/cms";
import { listPublishedEventSelections } from "@/lib/server/public/events";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit public page" };

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export default async function OrganizerPageEditor(context: RouteContext) {
  const { id } = await context.params;
  const route = `/organizer/content/pages/${encodeURIComponent(id)}`;
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
        selectionOptions: PageEditorSelectionOptions;
        workspace: Awaited<ReturnType<typeof readCmsEntityWorkspace>>;
      }>
    | null = null;
  try {
    const [workspace, assets, clubs, events, community] = await Promise.all([
      readCmsEntityWorkspace(
        loaded.context.database,
        loaded.context.identity,
        "page",
        id,
      ),
      listMediaAssets(
        loaded.context.database,
        loaded.context.identity,
        { limit: 100 },
      ),
      loaded.context.database
        .prepare(
          `SELECT club.id, club.name
           FROM clubs AS club
           JOIN club_public_profiles AS profile
             ON profile.club_id = club.id
            AND profile.organization_id = club.organization_id
            AND profile.publication_status = 'published'
            AND profile.published_at IS NOT NULL
            AND profile.deleted_at IS NULL
           WHERE club.organization_id = ?
             AND club.deleted_at IS NULL
           ORDER BY club.name ASC
           LIMIT 100`,
        )
        .bind(loaded.context.membership.organizationId)
        .all<Record<string, unknown>>(),
      listPublishedEventSelections(loaded.context.database, {
        limit: 100,
        organizationId: loaded.context.membership.organizationId,
      }),
      loaded.context.database
        .prepare(
          `SELECT link.id, link.label
           FROM community_links AS link
           JOIN community_link_public_details AS details
             ON details.community_link_id = link.id
            AND details.organization_id = link.organization_id
            AND details.confirmed_at > 0
           JOIN cms_entity_publication_states AS state
             ON state.organization_id = link.organization_id
            AND state.entity_type = 'community_link'
            AND state.entity_key = link.id
            AND state.workflow_status = 'published'
           WHERE link.organization_id = ?
             AND link.is_published = 1
             AND link.deleted_at IS NULL
           ORDER BY link.sort_order ASC, link.label ASC
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
      selectionOptions: Object.freeze({
        clubs: selectionRows(clubs.results),
        communityLinks: selectionRows(community.results),
        events: Object.freeze(
          events.map((event) =>
            Object.freeze({ id: event.id, label: event.title }),
          ),
        ),
        media: Object.freeze(
          assets.flatMap((asset) =>
            asset.uploadState === "ready" &&
            asset.rightsStatus === "approved" &&
            (asset.consentStatus === "confirmed" ||
              asset.consentStatus === "not_applicable") &&
            Boolean(asset.credit?.trim()) &&
            (!asset.informative || Boolean(asset.altText?.trim()))
              ? [
                  Object.freeze({
                    id: asset.id,
                    label: asset.altText || asset.caption || "Approved artwork",
                  }),
                ]
              : [],
          ),
        ),
      }),
      workspace,
    });
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/content/pages/[id]",
      status: 500,
    });
  }
  return (
    <>
      <PageHeader
        eyebrow="Structured page editor"
        introduction="Save a private immutable revision, inspect it in a protected preview, and publish it deliberately. Reordering works without dragging."
        title="Edit public page"
      />
      {data ? (
        <PageContentEditor
          initialWorkspace={data.workspace}
          selectionOptions={data.selectionOptions}
        />
      ) : (
        <OrganizerPageState
          detail="The current public page remains unchanged. Refresh or return to the content dashboard."
          heading="This page editor is unavailable."
          tone="error"
        />
      )}
    </>
  );
}

function selectionRows(
  rows: readonly Record<string, unknown>[] | undefined,
): readonly CmsSelectionOption[] {
  return Object.freeze(
    (rows ?? []).flatMap((row) => {
      const id = typeof row.id === "string" ? row.id : null;
      const label =
        typeof row.name === "string"
          ? row.name
          : typeof row.title === "string"
            ? row.title
            : typeof row.label === "string"
              ? row.label
              : null;
      return id && label ? [Object.freeze({ id, label })] : [];
    }),
  );
}

function AccessChanged() {
  return (
    <OrganizerPageState
      detail="Only a current Owner or Administrator can edit public pages."
      heading="Content access is unavailable."
      tone="error"
    />
  );
}
