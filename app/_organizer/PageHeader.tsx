import Link from "next/link";
import styles from "./workspace.module.css";

export function PageHeader({
  action,
  eyebrow,
  introduction,
  title,
}: Readonly<{
  action?: Readonly<{ href: string; label: string }>;
  eyebrow: string;
  introduction: string;
  title: string;
}>) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.kicker}>{eyebrow}</p>
        <h1>{title}</h1>
        <p>{introduction}</p>
      </div>
      {action ? (
        <Link className={styles.primaryAction} href={action.href}>
          {action.label}
        </Link>
      ) : null}
    </header>
  );
}

export function StatusPill({
  children,
  tone = "neutral",
}: Readonly<{
  children: React.ReactNode;
  tone?: "amber" | "blue" | "green" | "neutral";
}>) {
  return (
    <span className={`${styles.statusPill} ${styles[`statusPill${capitalize(tone)}`]}`}>
      {children}
    </span>
  );
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
