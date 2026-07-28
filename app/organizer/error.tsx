"use client";

import Link from "next/link";
import styles from "@/app/_organizer/workspace.module.css";

export default function OrganizerError({
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <section
      aria-labelledby="organizer-error-title"
      className={styles.accessState}
    >
      <p className={styles.kicker}>Private workspace</p>
      <h1 id="organizer-error-title">The workspace could not finish loading</h1>
      <p>
        No private record state is being guessed. Try this request again; if it
        still fails, return to the organizer dashboard.
      </p>
      <div className={styles.actionRow}>
        <button className={styles.primaryAction} onClick={reset} type="button">
          Try again
        </button>
        <Link className={styles.textAction} href="/organizer">
          Organizer dashboard
        </Link>
      </div>
    </section>
  );
}
