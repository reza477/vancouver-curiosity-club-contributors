import type { Metadata } from "next";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { ActivityFeed } from "@/app/_organizer/ActivityFeed";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { Phase4SettingsPanels } from "@/app/_organizer/Phase4SettingsPanels";
import { PublicationPolicyPanel } from "@/app/_organizer/PublicationPolicyPanel";
import { SettingsForm } from "@/app/_organizer/SettingsForm";
import {
  LegalStatusEditor,
  SiteIdentityEditor,
} from "@/app/_organizer/SiteContentSettings";
import { TaxonomySettingsPanel } from "@/app/_organizer/TaxonomySettingsPanel";
import type { CmsMediaOption } from "@/app/_organizer/ClubContentEditor";
import styles from "@/app/_organizer/workspace.module.css";
import { listMediaAssets } from "@/lib/server/media/storage";
import { listActivityHistory } from "@/lib/server/organizer/activity";
import { readCmsEntityWorkspace } from "@/lib/server/organizer/cms";
import { getWorkspaceSettings } from "@/lib/server/organizer/settings";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

export default async function OrganizerSettingsPage() {
  const loaded = await loadOrganizerPageContext("/organizer/settings");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  let data:
    | Readonly<{
        activity: Awaited<ReturnType<typeof listActivityHistory>>;
        settings: Awaited<ReturnType<typeof getWorkspaceSettings>>;
      }>
    | null = null;
  try {
    const [settings, activity] = await Promise.all([
      getWorkspaceSettings(loaded.context.database, loaded.context.identity),
      listActivityHistory(loaded.context.database, loaded.context.identity, {
        limit: 40,
      }),
    ]);
    data = { activity, settings };
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/settings",
      status: 500,
    });
  }
  if (data === null) {
    return (
      <>
        <PageHeader
          eyebrow="Workspace administration"
          introduction="No setting or activity is being guessed."
          title="Settings"
        />
        <OrganizerPageState
          detail="Private workspace settings could not be loaded. Refresh to try again."
          heading="Settings temporarily unavailable."
          tone="error"
        />
      </>
    );
  }
  const canManage =
    loaded.context.membership.role === "owner" ||
    loaded.context.membership.role === "administrator";
  let phase6:
    | Readonly<{
        legal: Awaited<ReturnType<typeof readCmsEntityWorkspace>>;
        media: readonly CmsMediaOption[];
        site: Awaited<ReturnType<typeof readCmsEntityWorkspace>>;
      }>
    | null = null;
  if (canManage) {
    try {
      const [site, legal, assets] = await Promise.all([
        readCmsEntityWorkspace(
          loaded.context.database,
          loaded.context.identity,
          "site_identity",
          "site_identity",
        ),
        readCmsEntityWorkspace(
          loaded.context.database,
          loaded.context.identity,
          "legal_status",
          "legal_status",
        ),
        listMediaAssets(
          loaded.context.database,
          loaded.context.identity,
          { limit: 100 },
        ),
      ]);
      phase6 = Object.freeze({
        legal,
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
                    altText: asset.altText ?? "",
                    id: asset.id,
                    label:
                      asset.altText || asset.caption || "Approved artwork",
                  }),
                ]
              : [],
          ),
        ),
        site,
      });
    } catch {
      writeSafeLog("error", "organizer_page_failed", {
        code: "internal_error",
        route: "/organizer/settings#site-content",
        status: 500,
      });
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Workspace administration"
        introduction="Private planning defaults, conflict policy, public brand revisions, Owner-confirmed legal wording, venues, and append-only activity live here."
        title="Settings"
      />
      <SettingsForm canManage={canManage} initialSettings={data.settings} />
      <div className={styles.phase4Settings}>
        <PublicationPolicyPanel canManage={canManage} />
      </div>
      <Phase4SettingsPanels canManage={canManage} />
      <div className={styles.phase4Settings}>
        <TaxonomySettingsPanel canManage={canManage} />
      </div>
      {phase6 ? (
        <div className={styles.phase4Settings}>
          <SiteIdentityEditor
            initialWorkspace={phase6.site}
            media={phase6.media}
          />
          <LegalStatusEditor
            initialWorkspace={phase6.legal}
            isOwner={loaded.context.membership.role === "owner"}
          />
        </div>
      ) : canManage ? (
        <OrganizerPageState
          detail="Existing public brand and legal output remain unchanged. Refresh before editing these revisions."
          heading="Website identity settings are temporarily unavailable."
          tone="error"
        />
      ) : null}
      <ActivityFeed items={data.activity} />
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
