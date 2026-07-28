"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  isRecord,
  organizerRequest,
  safeNotice,
} from "@/app/_organizer/client";
import styles from "@/app/_organizer/phase6.module.css";
import type {
  CmsEntitySummaryDto,
  CmsEntityWorkspaceDto,
} from "@/lib/server/organizer/cms";
import type { CmsCommunityLinkSnapshot } from "@/lib/server/organizer/cms-validation";

const EMPTY_LINK: CmsCommunityLinkSnapshot = Object.freeze({
  confirmed: false,
  description: "",
  destinationType: "other",
  label: "",
  sortOrder: 100,
  url: "",
});

export function CommunityContentEditor({
  entities,
  initialWorkspace,
}: Readonly<{
  entities: readonly CmsEntitySummaryDto[];
  initialWorkspace: CmsEntityWorkspaceDto | null;
}>) {
  const router = useRouter();
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [snapshot, setSnapshot] = useState(
    initialWorkspace ? communitySnapshot(initialWorkspace) : EMPTY_LINK,
  );
  const [creating, setCreating] = useState(initialWorkspace === null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await organizerRequest(
        creating
          ? "/api/organizer/content/community_link"
          : entityPath(workspace),
        {
          body: JSON.stringify(
            creating
              ? { snapshot }
              : {
                  expectedContentVersion:
                    workspace?.entity.contentVersion ?? 0,
                  snapshot,
                },
          ),
          method: creating ? "POST" : "PATCH",
        },
      );
      if (!isRecord(result) || !isWorkspace(result.entity)) {
        throw new Error("invalid_cms_response");
      }
      setWorkspace(result.entity);
      setSnapshot(communitySnapshot(result.entity));
      setCreating(false);
      setNotice(
        creating
          ? "Community destination created as a private draft."
          : "Community destination draft saved. Public links have not changed.",
      );
      router.refresh();
      window.setTimeout(() => noticeRef.current?.focus(), 0);
    } catch (caught) {
      setError(safeNotice(caught, "The Community link could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function action(name: "publish" | "unpublish") {
    if (!workspace) return;
    const prompt =
      name === "publish"
        ? "Publish this confirmed Community destination?"
        : "Unpublish this Community destination?";
    if (!window.confirm(prompt)) return;
    await mutate(
      `${entityPath(workspace)}/${name}`,
      {
        expectedContentVersion: workspace.entity.contentVersion,
      },
      name === "publish"
        ? "Community destination published."
        : "Community destination unpublished.",
    );
  }

  async function restore(revisionId: string) {
    if (!workspace) return;
    if (!window.confirm("Restore this history entry as a new private draft?")) {
      return;
    }
    await mutate(
      `${entityPath(workspace)}/restore`,
      {
        expectedContentVersion: workspace.entity.contentVersion,
        revisionId,
      },
      "Historical content restored as a new private draft.",
    );
  }

  async function mutate(
    path: string,
    body: Readonly<Record<string, unknown>>,
    success: string,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await organizerRequest(path, {
        body: JSON.stringify(body),
        method: "POST",
      });
      if (!isRecord(result) || !isWorkspace(result.entity)) {
        throw new Error("invalid_cms_response");
      }
      setWorkspace(result.entity);
      setSnapshot(communitySnapshot(result.entity));
      setNotice(success);
      router.refresh();
      window.setTimeout(() => noticeRef.current?.focus(), 0);
    } catch (caught) {
      setError(safeNotice(caught, "The Community link could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  function beginCreate() {
    setWorkspace(null);
    setSnapshot(EMPTY_LINK);
    setCreating(true);
    setError(null);
    setNotice(null);
  }

  return (
    <div className={styles.noticeStack}>
      <section className={styles.panel} aria-labelledby="community-list-heading">
        <div className={styles.splitHeader}>
          <div>
            <p className={styles.kicker}>Confirmed destinations only</p>
            <h2 id="community-list-heading">Community link hub</h2>
          </div>
          <button className={styles.button} onClick={beginCreate} type="button">
            Add Private Draft
          </button>
        </div>
        <div className={styles.actionRow}>
          {entities.map((entity) => (
            <Link
              href={`/organizer/content/community?entity=${encodeURIComponent(entity.entityKey)}`}
              key={entity.entityKey}
            >
              {entity.displayLabel} · {entity.workflowStatus}
            </Link>
          ))}
        </div>
        <p className={styles.helpText}>
          The missing Meetup discussion URL is not seeded or labelled as a
          discussion destination. A draft cannot publish until its exact HTTPS
          destination is explicitly confirmed.
        </p>
      </section>
      {error ? (
        <div className={styles.errorNotice} role="alert">
          <strong>Review the Community destination.</strong>
          <p>{error}</p>
        </div>
      ) : null}
      {notice ? (
        <p
          className={styles.successNotice}
          ref={noticeRef}
          role="status"
          tabIndex={-1}
        >
          {notice}
        </p>
      ) : null}
      <form className={`${styles.editorPanel} ${styles.form}`} onSubmit={save}>
        <div className={styles.splitHeader}>
          <div>
            <p className={styles.kicker}>
              {creating ? "New private draft" : "Destination revision"}
            </p>
            <h2>{snapshot.label || "Untitled Community destination"}</h2>
          </div>
          <div className={styles.toolbar}>
            {workspace?.permissions.canEdit ?? true ? (
              <button data-primary="true" disabled={busy} type="submit">
                Save Draft
              </button>
            ) : null}
            {workspace?.revision ? (
              <Link
                href={`/organizer/content/revisions/${encodeURIComponent(workspace.revision.id)}`}
              >
                Preview
              </Link>
            ) : null}
            {!creating && workspace ? (
              <>
                {workspace.permissions.canPublish ? (
                  <button disabled={busy} onClick={() => action("publish")} type="button">
                    Publish
                  </button>
                ) : null}
                {workspace.permissions.canUnpublish ? (
                  <button disabled={busy} onClick={() => action("unpublish")} type="button">
                    Unpublish
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        <div className={styles.fieldGrid}>
          <Field label="Label">
            <input
              maxLength={80}
              onChange={(event) =>
                setSnapshot({ ...snapshot, label: event.target.value })
              }
              required
              value={snapshot.label}
            />
          </Field>
          <Field label="Destination type">
            <select
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  destinationType: event.target
                    .value as CmsCommunityLinkSnapshot["destinationType"],
                })
              }
              value={snapshot.destinationType}
            >
              <option value="meetup_group">Meetup group</option>
              <option value="meetup_discussion">Meetup discussion</option>
              <option value="social_profile">Social profile</option>
              <option value="community_platform">Community platform</option>
              <option value="resource">Resource</option>
              <option value="other">Other confirmed destination</option>
            </select>
          </Field>
          <Field label="Canonical HTTPS URL" wide>
            <input
              maxLength={2048}
              onChange={(event) =>
                setSnapshot({ ...snapshot, url: event.target.value })
              }
              required
              type="url"
              value={snapshot.url}
            />
          </Field>
          <Field label="Short description" wide>
            <textarea
              maxLength={240}
              onChange={(event) =>
                setSnapshot({ ...snapshot, description: event.target.value })
              }
              required
              value={snapshot.description}
            />
          </Field>
          <Field label="Display order">
            <input
              max={10000}
              min={0}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  sortOrder: Number(event.target.value),
                })
              }
              type="number"
              value={snapshot.sortOrder}
            />
          </Field>
          <label className={styles.checkboxField}>
            <input
              checked={snapshot.confirmed}
              onChange={(event) =>
                setSnapshot({ ...snapshot, confirmed: event.target.checked })
              }
              type="checkbox"
            />
            <span>
              I confirm this is the exact intended public destination. This
              does not claim that a message or invitation was sent.
            </span>
          </label>
        </div>
      </form>
      {workspace ? (
        <section className={styles.panel} aria-labelledby="community-history">
          <h2 id="community-history">Revision history</h2>
          <div className={styles.revisionGrid}>
            {workspace.revisions.map((revision) => (
              <article className={styles.entityCard} key={revision.id}>
                <div>
                  <h3>Revision {revision.revisionNumber}</h3>
                  <p className={styles.muted}>{revision.actorDisplayName}</p>
                  <div className={styles.actionRow}>
                    <Link
                      href={`/organizer/content/revisions/${encodeURIComponent(revision.id)}`}
                    >
                      Preview
                    </Link>
                    {workspace.permissions.canRestore ? (
                      <button
                        disabled={busy}
                        onClick={() => restore(revision.id)}
                        type="button"
                      >
                        Restore as New Draft
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Field({
  children,
  label,
  wide = false,
}: Readonly<{
  children: React.ReactNode;
  label: string;
  wide?: boolean;
}>) {
  return (
    <label className={`${styles.field} ${wide ? styles.fieldWide : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function communitySnapshot(
  workspace: CmsEntityWorkspaceDto,
): CmsCommunityLinkSnapshot {
  if (
    workspace.entity.entityType !== "community_link" ||
    !workspace.revision ||
    !isRecord(workspace.revision.snapshot)
  ) {
    throw new Error("The Community link revision is unavailable.");
  }
  return workspace.revision.snapshot as CmsCommunityLinkSnapshot;
}

function entityPath(workspace: CmsEntityWorkspaceDto | null): string {
  if (!workspace) throw new Error("missing_workspace");
  return `/api/organizer/content/community_link/${encodeURIComponent(
    workspace.entity.entityKey,
  )}`;
}

function isWorkspace(value: unknown): value is CmsEntityWorkspaceDto {
  return (
    isRecord(value) &&
    isRecord(value.entity) &&
    typeof value.entity.entityKey === "string" &&
    Array.isArray(value.revisions)
  );
}
