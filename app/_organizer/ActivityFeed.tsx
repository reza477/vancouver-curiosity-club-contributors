import type { ActivityHistoryItem } from "@/lib/server/organizer/activity";
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
              <strong>{activityLabel(item.action)}</strong>
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

function activityLabel(action: ActivityHistoryItem["action"]): string {
  const labels: Record<ActivityHistoryItem["action"], string> = {
    "club.archived_private": "Private club archived",
    "club.created_private": "Private club created",
    "club.private_settings_updated": "Club planning settings changed",
    "invitation.accepted": "Invitation accepted",
    "invitation.created": "Invitation created",
    "invitation.revoked": "Invitation revoked",
    "membership.ownership_transferred": "Ownership transferred",
    "membership.updated": "Membership changed",
    "organization.settings_updated": "Workspace settings changed",
    "organizer_event.created": "Planning record created",
    "organizer_event.deleted": "Planning record moved to deleted items",
    "organizer_event.duplicated": "Planning record duplicated",
    "organizer_event.restored": "Planning record restored",
    "organizer_event.updated": "Planning record updated",
    "profile.notification_preference_changed": "Notification preference changed",
    "profile.updated": "Organizer profile changed",
  };
  return labels[action];
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Vancouver",
  }).format(new Date(value));
}
