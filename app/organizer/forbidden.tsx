import Link from "next/link";
import { chatGPTSignOutPath } from "@/app/chatgpt-auth";
import styles from "@/app/_organizer/workspace.module.css";

export default function OrganizerForbidden() {
  return (
    <main
      aria-labelledby="organizer-forbidden-title"
      className={styles.accessState}
      id="organizer-main"
      tabIndex={-1}
    >
      <p className={styles.kicker}>Private workspace</p>
      <h1 id="organizer-forbidden-title">Organizer access unavailable</h1>
      <p>
        This ChatGPT identity has no active organizer membership. Ask an Owner
        or Administrator for a copyable invitation link.
      </p>
      <p>
        Sign in with the ChatGPT account whose email exactly matches the active
        membership or invitation.
      </p>
      <div className={styles.actionRow}>
        <Link className={styles.primaryAction} href="/">
          Return to the public site
        </Link>
        <a className={styles.textAction} href={chatGPTSignOutPath("/")}>
          Sign out
        </a>
      </div>
    </main>
  );
}
