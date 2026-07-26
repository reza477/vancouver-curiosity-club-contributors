import Link from "next/link";
import { chatGPTSignOutPath } from "@/app/chatgpt-auth";
import type { OrganizerPageLoad } from "./types";
import styles from "./workspace.module.css";

export function OrganizerRouteState({
  load,
}: Readonly<{ load: Exclude<OrganizerPageLoad, { kind: "granted" }> }>) {
  const detail =
    load.kind === "denied"
      ? "This ChatGPT identity has no active organizer membership. Ask an Owner or Administrator for a copyable invitation link."
      : load.kind === "unconfigured"
        ? "Organizer access is not configured for this Sites environment."
        : "The private workspace could not be loaded. No organizer data is being claimed.";

  return (
    <main
      className={styles.accessState}
      aria-labelledby="organizer-access-title"
      id="organizer-main"
      tabIndex={-1}
    >
      <p className={styles.kicker}>Private workspace</p>
      <h1 id="organizer-access-title">Organizer access unavailable</h1>
      <p>{detail}</p>
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

export function OrganizerPageState({
  action,
  detail,
  heading,
  tone = "quiet",
}: Readonly<{
  action?: Readonly<{ href: string; label: string }>;
  detail: string;
  heading: string;
  tone?: "error" | "quiet";
}>) {
  return (
    <section
      className={`${styles.pageState} ${tone === "error" ? styles.pageStateError : ""}`}
      aria-labelledby="organizer-state-title"
    >
      <p className={styles.kicker}>{tone === "error" ? "Could not load" : "Nothing here yet"}</p>
      <h2 id="organizer-state-title">{heading}</h2>
      <p>{detail}</p>
      {action ? (
        <Link className={styles.primaryAction} href={action.href}>
          {action.label}
        </Link>
      ) : null}
    </section>
  );
}
