import Link from "next/link";
import { StatusPill } from "./PageHeader";
import styles from "./workspace.module.css";

export type DashboardItem = Readonly<{
  clubName?: string;
  href: string;
  id: string;
  meta: string;
  title: string;
}>;

export type OrganizerDashboardData = Readonly<{
  assignedClubs: readonly Readonly<{ id: string; name: string }>[];
  attentionDrafts: readonly DashboardItem[];
  meetup: Readonly<{
    detail: string;
    status: "current" | "error" | "not_connected" | "partial" | "stale";
  }>;
  recentChanges: readonly DashboardItem[];
  scheduledDrafts: readonly DashboardItem[];
  unscheduledIdeas: readonly DashboardItem[];
}>;

export function Dashboard({
  canManageTeam,
  data,
}: Readonly<{
  canManageTeam: boolean;
  data: OrganizerDashboardData;
}>) {
  return (
    <>
      <section className={styles.dashboardActions} aria-label="Common actions">
        <Link className={styles.primaryAction} href="/organizer/events/new">
          Add an Idea or Draft
        </Link>
        <Link className={styles.secondaryAction} href="/organizer/calendar">
          Open calendar
        </Link>
        <Link className={styles.secondaryAction} href="/organizer/events">
          View events
        </Link>
        {canManageTeam ? (
          <Link className={styles.textAction} href="/organizer/team">
            Manage team
          </Link>
        ) : null}
      </section>

      <div className={styles.dashboardGrid}>
        <DashboardPanel
          empty="Scheduled private Drafts will appear here. Ideas without a date remain in their own list."
          eyebrow="Next on the calendar"
          items={data.scheduledDrafts}
          title="Upcoming Drafts"
        />
        <DashboardPanel
          empty="Create an unscheduled Idea when the subject is clear but the date is not."
          eyebrow="Ideas desk"
          items={data.unscheduledIdeas}
          title="Unscheduled Ideas"
        />
        <DashboardPanel
          empty="Nothing currently needs coordination."
          eyebrow="Needs attention"
          items={data.attentionDrafts}
          title="Draft coordination"
        />
        <DashboardPanel
          empty="Event changes will appear after the first private Idea or Draft is edited."
          eyebrow="Activity"
          items={data.recentChanges}
          title="Recently changed"
        />
      </div>

      <div className={styles.dashboardLowerGrid}>
        <section className={styles.infoPanel} aria-labelledby="assigned-clubs-title">
          <p className={styles.kicker}>Your scope</p>
          <h2 id="assigned-clubs-title">Assigned clubs</h2>
          {data.assignedClubs.length > 0 ? (
            <ul className={styles.plainList}>
              {data.assignedClubs.map((club) => (
                <li key={club.id}>{club.name}</li>
              ))}
            </ul>
          ) : (
            <p>
              {canManageTeam
                ? "Organization-wide access across active clubs."
                : "No active club assignment is available for this membership."}
            </p>
          )}
        </section>

        <section className={styles.infoPanel} aria-labelledby="meetup-health-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.kicker}>Source health</p>
              <h2 id="meetup-health-title">Meetup feeds</h2>
            </div>
            <StatusPill tone={meetupTone(data.meetup.status)}>
              {meetupLabel(data.meetup.status)}
            </StatusPill>
          </div>
          <p>{data.meetup.detail}</p>
          <Link className={styles.textAction} href="/organizer/meetup">
            Open connection workspace
          </Link>
        </section>
      </div>
    </>
  );
}

function DashboardPanel({
  empty,
  eyebrow,
  items,
  title,
}: Readonly<{
  empty: string;
  eyebrow: string;
  items: readonly DashboardItem[];
  title: string;
}>) {
  return (
    <section className={styles.dashboardPanel} aria-labelledby={`panel-${slug(title)}`}>
      <p className={styles.kicker}>{eyebrow}</p>
      <h2 id={`panel-${slug(title)}`}>{title}</h2>
      {items.length === 0 ? (
        <p className={styles.panelEmpty}>{empty}</p>
      ) : (
        <ol className={styles.recordList}>
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.href}>
                <strong>{item.title}</strong>
                <span>{item.meta}</span>
                {item.clubName ? <small>{item.clubName}</small> : null}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function meetupTone(status: OrganizerDashboardData["meetup"]["status"]) {
  if (status === "current") return "green" as const;
  if (status === "error" || status === "partial") return "amber" as const;
  return "neutral" as const;
}

function meetupLabel(status: OrganizerDashboardData["meetup"]["status"]): string {
  if (status === "not_connected") return "Not connected";
  if (status === "partial") return "In progress";
  return status.replace("_", " ");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-");
}
