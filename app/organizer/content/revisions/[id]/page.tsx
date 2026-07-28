import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PublicPreviewShell } from "@/app/_organizer/PublicPreviewShell";
import { readCmsRevisionPreview } from "@/lib/server/organizer/cms";
import type {
  CmsClubProfileSnapshot,
  CmsProgramProfileSnapshot,
} from "@/lib/server/organizer/cms-validation";
import { loadPublicCatalog } from "@/lib/server/public/catalog";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  alternates: {},
  openGraph: null,
  referrer: "no-referrer",
  title: "Private content preview",
  twitter: null,
  robots: {
    follow: false,
    index: false,
    noarchive: true,
    nocache: true,
    noimageindex: true,
  },
};

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export default async function OrganizerContentRevisionPreview(
  context: RouteContext,
) {
  const { id } = await context.params;
  const route = `/organizer/content/revisions/${encodeURIComponent(id)}`;
  const loaded = await loadOrganizerPageContext(route);
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  if (
    loaded.context.membership.role !== "owner" &&
    loaded.context.membership.role !== "administrator"
  ) {
    forbidden();
  }
  let previewData:
    | Readonly<{
        catalog: NonNullable<
          Awaited<ReturnType<typeof loadPublicCatalog>>
        >;
        clubLane: Readonly<{ name: string; slug: string }> | null;
        programContext: Readonly<{
          lane: Readonly<{ name: string; slug: string }>;
          parentClub: Readonly<{ name: string; slug: string }>;
        }> | null;
        preview: Awaited<ReturnType<typeof readCmsRevisionPreview>>;
      }>
    | null = null;
  try {
    const preview = await readCmsRevisionPreview(
      loaded.context.database,
      loaded.context.identity,
      id,
    );
    const catalog = await loadPublicCatalog(loaded.context.database);
    if (catalog) {
      const clubLane =
        preview.entityType === "club_public_profile"
          ? await readClubLane(
              loaded.context.database,
              loaded.context.membership.organizationId,
              preview.snapshot as CmsClubProfileSnapshot,
            )
          : null;
      const programContext =
        preview.entityType === "program_public_profile"
          ? await readProgramContext(
              loaded.context.database,
              loaded.context.membership.organizationId,
              preview.snapshot as CmsProgramProfileSnapshot,
            )
          : null;
      previewData = Object.freeze({
        catalog,
        clubLane,
        preview,
        programContext,
      });
    }
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/content/revisions/[id]",
      status: 500,
    });
  }
  if (!previewData) return <PreviewUnavailable />;
  return (
    <PublicPreviewShell
      catalog={previewData.catalog}
      clubLane={previewData.clubLane}
      programContext={previewData.programContext}
      preview={previewData.preview}
    />
  );
}

async function readProgramContext(
  database: Parameters<typeof readCmsRevisionPreview>[0],
  organizationId: string,
  snapshot: CmsProgramProfileSnapshot,
): Promise<Readonly<{
  lane: Readonly<{ name: string; slug: string }>;
  parentClub: Readonly<{ name: string; slug: string }>;
}> | null> {
  const row = await database
    .prepare(
      `SELECT club.name AS club_name, club.slug AS club_slug,
              lane.name AS lane_name, lane.slug AS lane_slug
       FROM clubs AS club
       JOIN event_lanes AS lane
         ON lane.id = ?
        AND lane.organization_id = club.organization_id
        AND lane.deleted_at IS NULL
       WHERE club.id = ?
         AND club.organization_id = ?
         AND club.deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(snapshot.laneId, snapshot.clubId, organizationId)
    .first<Record<string, unknown>>();
  return typeof row?.club_name === "string" &&
    typeof row.club_slug === "string" &&
    typeof row.lane_name === "string" &&
    typeof row.lane_slug === "string"
    ? Object.freeze({
        lane: Object.freeze({
          name: row.lane_name,
          slug: row.lane_slug,
        }),
        parentClub: Object.freeze({
          name: row.club_name,
          slug: row.club_slug,
        }),
      })
    : null;
}

async function readClubLane(
  database: Parameters<typeof readCmsRevisionPreview>[0],
  organizationId: string,
  snapshot: CmsClubProfileSnapshot,
): Promise<Readonly<{ name: string; slug: string }> | null> {
  const row = await database
    .prepare(
      `SELECT name, slug
       FROM event_lanes
       WHERE id = ?
         AND organization_id = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(snapshot.laneId, organizationId)
    .first<Record<string, unknown>>();
  return typeof row?.name === "string" && typeof row.slug === "string"
    ? Object.freeze({ name: row.name, slug: row.slug })
    : null;
}

function PreviewUnavailable() {
  return (
    <OrganizerPageState
      detail="No alternate or public content is being substituted."
      heading="This private revision preview is unavailable."
      tone="error"
    />
  );
}

function AccessChanged() {
  return (
    <OrganizerPageState
      detail="Only a current Owner or Administrator can inspect private revisions."
      heading="Preview access is unavailable."
      tone="error"
    />
  );
}
