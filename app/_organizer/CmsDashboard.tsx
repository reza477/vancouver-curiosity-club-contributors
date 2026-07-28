import Link from "next/link";
import { StatusPill } from "@/app/_organizer/PageHeader";
import styles from "@/app/_organizer/phase6.module.css";
import type { CmsEntitySummaryDto } from "@/lib/server/organizer/cms";

const groupLabels = new Map([
  ["page", "Public pages"],
  ["club_public_profile", "Top-level clubs"],
  ["program_public_profile", "Recurring Programs"],
  ["community_link", "Community destinations"],
  ["navigation", "Navigation and footer"],
  ["site_identity", "Brand and SEO defaults"],
  ["legal_status", "Legal-status confirmation"],
]);

export function CmsDashboard({
  entities,
}: Readonly<{ entities: readonly CmsEntitySummaryDto[] }>) {
  const grouped = new Map<string, CmsEntitySummaryDto[]>();
  for (const entity of entities) {
    const current = grouped.get(entity.entityType) ?? [];
    current.push(entity);
    grouped.set(entity.entityType, current);
  }
  return (
    <div className={styles.noticeStack}>
      <section className={styles.panel} aria-labelledby="cms-model-heading">
        <p className={styles.kicker}>Draft and public separation</p>
        <h2 id="cms-model-heading">A revision changes the site only when published.</h2>
        <p>
          Save Draft keeps the current public projection untouched. Preview
          reads one private immutable revision. Publish materializes only the
          validated allowlisted fields, while Restore as New Draft never
          rewrites history.
        </p>
      </section>
      {entities.length === 0 ? (
        <div className={styles.emptyState}>
          <h2>No CMS entities are available.</h2>
          <p>
            Existing public content has not been replaced or guessed. Refresh
            after the private adoption check completes.
          </p>
        </div>
      ) : (
        [...grouped.entries()].map(([entityType, items]) => (
          <section key={entityType} aria-labelledby={`group-${entityType}`}>
            <div className={styles.splitHeader}>
              <div>
                <p className={styles.kicker}>Structured content</p>
                <h2 id={`group-${entityType}`}>
                  {groupLabels.get(entityType) ?? entityType}
                </h2>
              </div>
              {entityType === "community_link" ? (
                <Link className={styles.button} href="/organizer/content/community">
                  Manage community links
                </Link>
              ) : null}
            </div>
            <div className={styles.dashboardGrid}>
              {items.map((entity) => (
                <CmsEntityCard entity={entity} key={`${entityType}-${entity.entityKey}`} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function CmsEntityCard({
  entity,
}: Readonly<{ entity: CmsEntitySummaryDto }>) {
  const href = cmsEntityHref(entity);
  return (
    <article className={styles.entityCard}>
      <div>
        <p className={styles.stateLine}>
          <StatusPill tone={stateTone(entity.workflowStatus)}>
            {formatLabel(entity.workflowStatus)}
          </StatusPill>
          {entity.hasNewerDraft ? (
            <span className={styles.stateBadge}>Newer draft</span>
          ) : null}
        </p>
        <h3>{entity.displayLabel}</h3>
        <p className={styles.muted}>
          Current draft{" "}
          {entity.currentRevisionNumber
            ? `revision ${entity.currentRevisionNumber}`
            : "not available"}
          {" · "}
          Published{" "}
          {entity.publishedRevisionNumber
            ? `revision ${entity.publishedRevisionNumber}`
            : "none"}
        </p>
        <p className={styles.muted}>
          Last edited by {entity.lastEditorDisplayName}{" "}
          <time dateTime={new Date(entity.updatedAt).toISOString()}>
            {formatTimestamp(entity.updatedAt)}
          </time>
        </p>
        <div className={styles.actionRow}>
          <Link href={href}>Edit</Link>
          {entity.currentDraftRevisionId ? (
            <Link
              href={`/organizer/content/revisions/${encodeURIComponent(entity.currentDraftRevisionId)}`}
            >
              Preview
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function cmsEntityHref(entity: CmsEntitySummaryDto): string {
  if (entity.entityType === "page") {
    return `/organizer/content/pages/${encodeURIComponent(entity.entityKey)}`;
  }
  if (entity.entityType === "club_public_profile") {
    return `/organizer/content/clubs/${encodeURIComponent(entity.entityKey)}`;
  }
  if (entity.entityType === "program_public_profile") {
    return `/organizer/content/programs/${encodeURIComponent(entity.entityKey)}`;
  }
  if (entity.entityType === "community_link") {
    return `/organizer/content/community?entity=${encodeURIComponent(entity.entityKey)}`;
  }
  if (entity.entityType === "navigation") {
    return "/organizer/content/navigation";
  }
  return `/organizer/settings#${entity.entityType}`;
}

function stateTone(value: string): "amber" | "blue" | "green" | "neutral" {
  if (value === "published") return "green";
  if (value === "draft") return "blue";
  if (value === "unpublished") return "amber";
  return "neutral";
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) =>
    letter.toUpperCase(),
  );
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
