import Link from "next/link";
import styles from "@/app/_organizer/workspace.module.css";

export default function OrganizerNotFound() {
  return (
    <section
      aria-labelledby="organizer-not-found-title"
      className={styles.accessState}
    >
      <p className={styles.kicker}>Private workspace</p>
      <h1 id="organizer-not-found-title">Record unavailable</h1>
      <p>
        This private record is unavailable within your current organization and
        role. No cross-organization detail is disclosed.
      </p>
      <div className={styles.actionRow}>
        <Link className={styles.primaryAction} href="/organizer/events">
          Return to private Events
        </Link>
        <Link className={styles.textAction} href="/organizer/calendar">
          Open Calendar
        </Link>
      </div>
    </section>
  );
}
