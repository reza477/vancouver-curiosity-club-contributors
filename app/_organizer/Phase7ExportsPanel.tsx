"use client";

import { useState } from "react";
import type { MediaManifestEntry } from "@/lib/server/phase7/private-exports";
import type { OrganizationRole } from "@/lib/server/auth";
import styles from "@/app/_organizer/workspace.module.css";

const BACKUP_CONFIRMATION = "GENERATE SENSITIVE OWNER BACKUP";

export function Phase7ExportsPanel({
  mediaAssets,
  role,
}: Readonly<{
  mediaAssets: readonly Pick<
    MediaManifestEntry,
    "fileName" | "id" | "mimeType" | "sha256"
  >[];
  role: OrganizationRole;
}>) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isOwner = role === "owner";

  async function download(
    key: string,
    route: string,
    options?: RequestInit,
  ) {
    setBusy(key);
    setNotice(null);
    try {
      const response = await fetch(route, {
        cache: "no-store",
        credentials: "same-origin",
        ...options,
      });
      if (!response.ok) {
        throw new Error("The private export could not be generated.");
      }
      const body = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const fileName =
        /filename="([^"]+)"/u.exec(disposition)?.[1] ?? "download";
      const url = URL.createObjectURL(body);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(`${fileName} downloaded.`);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The private export could not be generated.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.formStack}>
      <section className={styles.formSection} aria-labelledby="event-export-title">
        <header>
          <p className={styles.kicker}>Private-safe operations</p>
          <h2 id="event-export-title">Operational event CSV</h2>
          <p>
            Exports lifecycle, schedule, taxonomy, venue, buffer, and Meetup URL
            fields. It excludes organizer email, meeting links, conflict
            reasons, tokens, submissions, invitations, and audit payloads.
            Organizer assignments require explicit email mapping on a later
            import and do not round-trip automatically.
          </p>
        </header>
        <button
          disabled={busy !== null}
          onClick={() =>
            download(
              "events",
              "/api/organizer/exports/events.csv",
            )
          }
          type="button"
        >
          {busy === "events" ? "Preparing..." : "Download operational CSV"}
        </button>
      </section>

      {isOwner ? (
        <>
          <section
            className={styles.formSection}
            aria-labelledby="owner-backup-title"
          >
            <header>
              <p className={styles.kicker}>Sensitive Owner action</p>
              <h2 id="owner-backup-title">Allowlisted JSON backup</h2>
              <p>
                This contains private planning content. It excludes emails,
                identities, invitations, tokens, source-feed secrets, form
                submissions, rate-limit state, R2 keys, runtime values, and
                generic audit payloads. It is not an infrastructure backup and
                restore is not automatic.
              </p>
            </header>
            <label>
              <span>
                Type <strong>{BACKUP_CONFIRMATION}</strong>
              </span>
              <input
                autoComplete="off"
                onChange={(event) => setConfirmation(event.target.value)}
                spellCheck={false}
                value={confirmation}
              />
            </label>
            <button
              disabled={
                busy !== null || confirmation !== BACKUP_CONFIRMATION
              }
              onClick={() =>
                download("backup", "/api/organizer/exports/backup.json", {
                  body: JSON.stringify({ confirmation }),
                  headers: { "Content-Type": "application/json" },
                  method: "POST",
                })
              }
              type="button"
            >
              {busy === "backup" ? "Preparing..." : "Generate Owner backup"}
            </button>
          </section>

          <section
            className={styles.formSection}
            aria-labelledby="media-backup-title"
          >
            <header>
              <p className={styles.kicker}>Owner-run media backup</p>
              <h2 id="media-backup-title">Media manifest and originals</h2>
              <p>
                Download the manifest, then each required original through its
                authenticated route. Verify recorded SHA-256 values and store
                the files in an owner-controlled secure location.
              </p>
            </header>
            <button
              disabled={busy !== null}
              onClick={() =>
                download(
                  "manifest",
                  "/api/organizer/exports/media-manifest.json",
                )
              }
              type="button"
            >
              {busy === "manifest"
                ? "Preparing..."
                : "Download media manifest"}
            </button>
            {mediaAssets.length > 0 ? (
              <ul className={styles.simpleList}>
                {mediaAssets.map((asset) => (
                  <li key={asset.id}>
                    <div>
                      <strong>{asset.fileName}</strong>
                      <small>
                        {asset.mimeType}
                        {asset.sha256
                          ? ` · SHA-256 ${asset.sha256}`
                          : " · SHA-256 unavailable"}
                      </small>
                    </div>
                    <a
                      href={`/api/organizer/exports/media/${encodeURIComponent(asset.id)}/original`}
                    >
                      Download original
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No retained media assets are available.</p>
            )}
          </section>
        </>
      ) : null}
      {notice ? <p aria-live="polite">{notice}</p> : null}
    </div>
  );
}
