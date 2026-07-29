import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { CmsDashboard } from "@/app/_organizer/CmsDashboard";
import {
  CreateClubProfileDraftButton,
  type ClubProfileDraftOption,
  type ClubProfileLaneOption,
} from "@/app/_organizer/CreateClubProfileDraftButton";
import { CreateResourcesDraftButton } from "@/app/_organizer/CreateResourcesDraftButton";
import {
  CreateProgramDraftButton,
  type ProgramParentOption,
} from "@/app/_organizer/CreateProgramDraftButton";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { revalidateAuthorizedMembership } from "@/lib/server/auth";
import { listCmsEntities } from "@/lib/server/organizer/cms";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Website content" };

export default async function OrganizerContentPage() {
  const loaded = await loadOrganizerPageContext("/organizer/content");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  if (
    loaded.context.membership.role !== "owner" &&
    loaded.context.membership.role !== "administrator"
  ) {
    forbidden();
  }
  let entities: Awaited<ReturnType<typeof listCmsEntities>> | null = null;
  let canCreateResources = false;
  let clubDraftOptions: readonly ClubProfileDraftOption[] = [];
  let laneOptions: readonly ClubProfileLaneOption[] = [];
  let programParentOptions: readonly ProgramParentOption[] = [];
  try {
    const currentEntities = await listCmsEntities(
      loaded.context.database,
      loaded.context.identity,
    );
    const [resources, privateClubs, programParents, lanes] = await Promise.all([
      loaded.context.database
        .prepare(
          `SELECT 1 AS present
           FROM pages
           WHERE organization_id = ?
             AND slug = 'resources'
             AND deleted_at IS NULL
           LIMIT 1`,
        )
        .bind(loaded.context.membership.organizationId)
        .first<Record<string, unknown>>(),
      loaded.context.database
        .prepare(
          `SELECT club.id, club.name, club.slug, club.description
           FROM clubs AS club
           WHERE club.organization_id = ?
             AND club.deleted_at IS NULL
             AND NOT EXISTS (
               SELECT 1
               FROM club_public_profiles AS profile
               WHERE profile.club_id = club.id
             )
             AND NOT EXISTS (
               SELECT 1
               FROM cms_entity_publication_states AS state
               WHERE state.organization_id = club.organization_id
                 AND state.entity_type = 'club_public_profile'
                 AND state.entity_key = club.id
             )
           ORDER BY club.name COLLATE NOCASE ASC, club.id ASC
           LIMIT 100`,
        )
        .bind(loaded.context.membership.organizationId)
        .all<Record<string, unknown>>(),
      loaded.context.database
        .prepare(
          `SELECT club.id, club.name,
                  profile.primary_event_lane_id AS lane_id
           FROM clubs AS club
           JOIN club_public_profiles AS profile
             ON profile.club_id = club.id
            AND profile.organization_id = club.organization_id
            AND profile.deleted_at IS NULL
           WHERE club.organization_id = ?
             AND club.deleted_at IS NULL
             AND profile.publication_status <> 'archived'
           ORDER BY club.name COLLATE NOCASE ASC, club.id ASC
           LIMIT 100`,
        )
        .bind(loaded.context.membership.organizationId)
        .all<Record<string, unknown>>(),
      loaded.context.database
        .prepare(
          `SELECT lane.id, lane.name
           FROM event_lanes AS lane
           WHERE lane.organization_id = ?
             AND lane.deleted_at IS NULL
           ORDER BY lane.sort_order ASC,
                    lane.name COLLATE NOCASE ASC,
                    lane.id ASC
           LIMIT 100`,
        )
        .bind(loaded.context.membership.organizationId)
        .all<Record<string, unknown>>(),
    ]);
    canCreateResources = !resources;
    clubDraftOptions = Object.freeze(
      (privateClubs.results ?? []).flatMap((row) => {
        if (
          typeof row.id !== "string" ||
          typeof row.name !== "string" ||
          typeof row.slug !== "string"
        ) {
          return [];
        }
        return [
          Object.freeze({
            description:
              typeof row.description === "string" ? row.description : null,
            id: row.id,
            name: row.name,
            slug: row.slug,
          }),
        ];
      }),
    );
    laneOptions = Object.freeze(
      (lanes.results ?? []).flatMap((row) =>
        typeof row.id === "string" && typeof row.name === "string"
          ? [Object.freeze({ id: row.id, label: row.name })]
          : [],
      ),
    );
    programParentOptions = Object.freeze(
      (programParents.results ?? []).flatMap((row) =>
        typeof row.id === "string" &&
        typeof row.name === "string" &&
        typeof row.lane_id === "string"
          ? [
              Object.freeze({
                id: row.id,
                laneId: row.lane_id,
                name: row.name,
              }),
            ]
          : [],
        ),
    );
    await revalidateAuthorizedMembership(
      loaded.context.database,
      loaded.context.identity,
      loaded.context.membership,
      { allowedRoles: ["owner", "administrator"] },
    );
    entities = currentEntities;
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/content",
      status: 500,
    });
  }
  return (
    <>
      <PageHeader
        eyebrow="Phase 6 · Structured publishing"
        introduction="Edit private revisions, inspect an authenticated preview, and deliberately publish only validated public content. There is no autosave and no arbitrary page builder."
        title="Website content"
      />
      {entities ? (
        <>
          {canCreateResources ? <CreateResourcesDraftButton /> : null}
          {clubDraftOptions.length > 0 && laneOptions.length > 0 ? (
            <CreateClubProfileDraftButton
              clubs={clubDraftOptions}
              lanes={laneOptions}
            />
          ) : null}
          {programParentOptions.length > 0 && laneOptions.length > 0 ? (
            <CreateProgramDraftButton
              clubs={programParentOptions}
              lanes={laneOptions}
            />
          ) : null}
          <CmsDashboard entities={entities} />
        </>
      ) : (
        <OrganizerPageState
          detail="The existing public website remains unchanged. No draft or guessed content is being substituted."
          heading="The content workspace is temporarily unavailable."
          tone="error"
        />
      )}
    </>
  );
}

function AccessChanged() {
  return (
    <OrganizerPageState
      detail="Only a current Owner or Administrator can manage website content."
      heading="Content access is unavailable."
      tone="error"
    />
  );
}
