import type { ActivityHistoryItem } from "@/lib/server/organizer/activity";
import { activityLabel } from "./activity-labels";
import styles from "./workspace.module.css";

export function ActivityFeed({
  items,
}: Readonly<{ items: readonly ActivityHistoryItem[] }>) {
  return (
    <section className={styles.activityFeed} aria-labelledby="activity-history-title">
      <header className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>Append-only history</p>
          <h2 id="activity-history-title">Workspace activity</h2>
        </div>
        <span>{items.length} recent</span>
      </header>
      {items.length > 0 ? (
        <ol>
          {items.map((item) => (
            <li key={item.id}>
              <strong>{activityLabel(item.action, item.entityType)}</strong>
              <span>{item.actorDisplayName}</span>
              <time dateTime={new Date(item.createdAt).toISOString()}>
                {formatDateTime(item.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.panelEmpty}>
          No private workspace activity has been recorded yet.
        </p>
      )}
    </section>
  );
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Vancouver",
  }).format(new Date(value));
}
