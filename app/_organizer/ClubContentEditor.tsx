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
import type { CmsEntityWorkspaceDto } from "@/lib/server/organizer/cms";
import type { CmsClubProfileSnapshot } from "@/lib/server/organizer/cms-validation";

export type CmsMediaOption = Readonly<{
  altText: string;
  id: string;
  label: string;
}>;

export type CmsLaneOption = Readonly<{ id: string; label: string }>;
export type CmsResourceOption = Readonly<{
  href: string;
  id: string;
  label: string;
  state: "published";
}>;

export function ClubContentEditor({
  initialWorkspace,
  lanes,
  media,
  resources,
}: Readonly<{
  initialWorkspace: CmsEntityWorkspaceDto;
  lanes: readonly CmsLaneOption[];
  media: readonly CmsMediaOption[];
  resources: readonly CmsResourceOption[];
}>) {
  const router = useRouter();
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const initial = clubSnapshot(initialWorkspace);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [snapshot, setSnapshot] = useState(initial);
  const [socialUrlsText, setSocialUrlsText] = useState(
    initial.socialUrls.join("\n"),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const availableResourceIds = new Set(
    resources.map((resource) => resource.id),
  );
  const unavailableResourceIds = snapshot.relatedResourceIds.filter(
    (resourceId) => !availableResourceIds.has(resourceId),
  );
  const path = `/api/organizer/content/club_public_profile/${encodeURIComponent(
    workspace.entity.entityKey,
  )}`;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate(path, "PATCH", {
      expectedContentVersion: workspace.entity.contentVersion,
      snapshot,
    }, "Club profile draft saved. Public content has not changed.");
  }

  async function publish() {
    if (!window.confirm("Publish this club profile revision to the website?")) {
      return;
    }
    await mutate(`${path}/publish`, "POST", {
      expectedContentVersion: workspace.entity.contentVersion,
    }, "Club profile published.");
  }

  async function unpublish() {
    if (!window.confirm("Unpublish this club profile from the website?")) {
      return;
    }
    await mutate(`${path}/unpublish`, "POST", {
      expectedContentVersion: workspace.entity.contentVersion,
    }, "Club profile unpublished. Private events remain unchanged.");
  }

  async function archive() {
    if (
      !window.confirm(
        "Archive this club profile? It will leave the active directory and cannot accept future scheduling. Its published history and eligible past events will remain.",
      )
    ) {
      return;
    }
    await mutate(`${path}/archive`, "POST", {
      expectedContentVersion: workspace.entity.contentVersion,
    }, "Club profile archived. Its private revision history remains available.");
  }

  async function restore(revisionId: string) {
    if (!window.confirm("Restore this history entry as a new private draft?")) {
      return;
    }
    await mutate(`${path}/restore`, "POST", {
      expectedContentVersion: workspace.entity.contentVersion,
      revisionId,
    }, "Historical content restored as a new private draft.");
  }

  async function mutate(
    url: string,
    method: "PATCH" | "POST",
    body: Readonly<Record<string, unknown>>,
    success: string,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await organizerRequest(url, {
        body: JSON.stringify(body),
        method,
      });
      if (!isRecord(result) || !isWorkspace(result.entity)) {
        throw new Error("invalid_cms_response");
      }
      setWorkspace(result.entity);
      const nextSnapshot = clubSnapshot(result.entity);
      setSnapshot(nextSnapshot);
      setSocialUrlsText(nextSnapshot.socialUrls.join("\n"));
      setNotice(success);
      router.refresh();
      window.setTimeout(() => noticeRef.current?.focus(), 0);
    } catch (caught) {
      setError(safeNotice(caught, "The club profile could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.noticeStack}>
      {error ? (
        <div className={styles.errorNotice} role="alert">
          <strong>Review the club profile.</strong>
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
      {workspace.entity.workflowStatus === "archived" ? (
        <div className={styles.notice} role="status">
          <strong>This club profile is archived.</strong>
          <p>
            It is absent from the public site and retained as read-only
            history. New events cannot be scheduled in the archived club.
          </p>
        </div>
      ) : null}
      <form className={`${styles.editorPanel} ${styles.form}`} onSubmit={save}>
        <div className={styles.splitHeader}>
          <div>
            <p className={styles.kicker}>Public profile draft</p>
            <h2>{snapshot.name}</h2>
            <p className={styles.muted}>
              State: {workspace.entity.workflowStatus.replaceAll("_", " ")} ·
              content version {workspace.entity.contentVersion}
            </p>
          </div>
          <div className={styles.toolbar}>
            {workspace.permissions.canEdit ? (
              <button data-primary="true" disabled={busy} type="submit">
                Save Draft
              </button>
            ) : null}
            {workspace.revision ? (
              <Link
                href={`/organizer/content/revisions/${encodeURIComponent(workspace.revision.id)}`}
              >
                Preview
              </Link>
            ) : null}
            {workspace.permissions.canPublish ? (
              <button disabled={busy} onClick={publish} type="button">
                Publish
              </button>
            ) : null}
            {workspace.permissions.canUnpublish ? (
              <button disabled={busy} onClick={unpublish} type="button">
                Unpublish
              </button>
            ) : null}
            {workspace.permissions.canArchive ? (
              <button disabled={busy} onClick={archive} type="button">
                Archive
              </button>
            ) : null}
          </div>
        </div>
        <fieldset
          className={styles.fieldGrid}
          disabled={busy || !workspace.permissions.canEdit}
        >
          <legend className={styles.srOnly}>Club profile fields</legend>
          <Field label="Public display name">
            <input
              maxLength={120}
              onChange={(event) =>
                setSnapshot({ ...snapshot, name: event.target.value })
              }
              required
              value={snapshot.name}
            />
          </Field>
          <Field label="Stable public slug">
            <input
              maxLength={120}
              onChange={(event) =>
                setSnapshot({ ...snapshot, slug: event.target.value })
              }
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              required
              value={snapshot.slug}
            />
          </Field>
          <Field label="Primary lane">
            <select
              onChange={(event) =>
                setSnapshot({ ...snapshot, laneId: event.target.value })
              }
              required
              value={snapshot.laneId}
            >
              {lanes.map((lane) => (
                <option key={lane.id} value={lane.id}>
                  {lane.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Program type">
            <select
              onChange={(event) =>
                setSnapshot({ ...snapshot, programType: event.target.value })
              }
              value={snapshot.programType}
            >
              <option value="club">Club</option>
              <option value="program">Program</option>
              <option value="circle">Circle</option>
              <option value="series">Series</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <label className={`${styles.checkboxField} ${styles.fieldWide}`}>
            <input
              checked={snapshot.contentConfirmed}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  contentConfirmed: event.target.checked,
                })
              }
              type="checkbox"
            />
            <span>
              I confirm this revision contains real, owner-approved public
              information rather than placeholder copy.
            </span>
          </label>
          <Field label="Short summary" wide>
            <textarea
              maxLength={500}
              onChange={(event) =>
                setSnapshot({ ...snapshot, summary: event.target.value })
              }
              required
              value={snapshot.summary}
            />
          </Field>
          <Field label="Full description" wide>
            <textarea
              maxLength={8000}
              onChange={(event) =>
                setSnapshot({ ...snapshot, description: event.target.value })
              }
              required
              value={snapshot.description}
            />
          </Field>
          <Field label="Search title">
            <input
              maxLength={60}
              onChange={(event) =>
                setSnapshot({ ...snapshot, seoTitle: event.target.value })
              }
              required
              value={snapshot.seoTitle}
            />
          </Field>
          <Field label="Search description" wide>
            <textarea
              maxLength={160}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  metaDescription: event.target.value,
                })
              }
              required
              value={snapshot.metaDescription}
            />
          </Field>
          <Field label="What participants can expect">
            <textarea
              maxLength={2000}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  whatToExpect: event.target.value,
                })
              }
              value={snapshot.whatToExpect ?? ""}
            />
          </Field>
          <Field label="Preparation information">
            <textarea
              maxLength={2000}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  preparation: event.target.value,
                })
              }
              value={snapshot.preparation ?? ""}
            />
          </Field>
          <Field label="Typical format">
            <textarea
              maxLength={2000}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  typicalFormat: event.target.value,
                })
              }
              value={snapshot.typicalFormat ?? ""}
            />
          </Field>
          <Field label="Confirmed Meetup group URL">
            <input
              maxLength={2048}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  meetupGroupUrl: event.target.value,
                })
              }
              placeholder="https://www.meetup.com/group-name/"
              type="url"
              value={snapshot.meetupGroupUrl ?? ""}
            />
          </Field>
          <Field label="Cover artwork">
            <MediaSelect
              media={media}
              onChange={(assetId) =>
                setSnapshot({ ...snapshot, coverAssetId: assetId })
              }
              value={snapshot.coverAssetId}
            />
          </Field>
          <Field label="Thumbnail artwork">
            <MediaSelect
              media={media}
              onChange={(assetId) =>
                setSnapshot({ ...snapshot, thumbnailAssetId: assetId })
              }
              value={snapshot.thumbnailAssetId}
            />
          </Field>
          <Field label="Social sharing artwork">
            <MediaSelect
              media={media}
              onChange={(assetId) =>
                setSnapshot({ ...snapshot, openGraphAssetId: assetId })
              }
              value={snapshot.openGraphAssetId}
            />
          </Field>
          <div className={styles.field}>
            <span>Image description</span>
            <p className={styles.helpText}>
              Alt text comes from the approved media asset so the same artwork
              is described consistently everywhere. Update it in Media before
              selecting the asset here.
            </p>
          </div>
          <Field label="Theme color">
            <input
              onChange={(event) =>
                setSnapshot({ ...snapshot, themeColor: event.target.value })
              }
              pattern="#[0-9A-Fa-f]{6}"
              type="text"
              value={snapshot.themeColor}
            />
          </Field>
          <Field label="Confirmed social links (one HTTPS URL per line)" wide>
            <textarea
              onChange={(event) => {
                setSocialUrlsText(event.target.value);
                setSnapshot({
                  ...snapshot,
                  socialUrls: lineList(event.target.value),
                });
              }}
              value={socialUrlsText}
            />
          </Field>
          <fieldset className={`${styles.field} ${styles.fieldWide}`}>
            <legend>Related published resources</legend>
            {resources.length || unavailableResourceIds.length ? (
              <>
                <p className={styles.helpText}>
                  Choose published internal pages to show in this profile.
                  Unpublished resources are never offered or rendered.
                </p>
                {resources.map((resource) => (
                  <label className={styles.checkboxField} key={resource.id}>
                    <input
                      checked={snapshot.relatedResourceIds.includes(
                        resource.id,
                      )}
                      onChange={(event) =>
                        setSnapshot({
                          ...snapshot,
                          relatedResourceIds: event.target.checked
                            ? [
                                ...snapshot.relatedResourceIds.filter(
                                  (id) => id !== resource.id,
                                ),
                                resource.id,
                              ]
                            : snapshot.relatedResourceIds.filter(
                                (id) => id !== resource.id,
                              ),
                        })
                      }
                      type="checkbox"
                    />
                    <span>
                      {resource.label} · Published · {resource.href}
                    </span>
                  </label>
                ))}
                {unavailableResourceIds.map((resourceId, index) => (
                  <label
                    className={styles.checkboxField}
                    key={resourceId}
                  >
                    <input
                      checked
                      onChange={() =>
                        setSnapshot({
                          ...snapshot,
                          relatedResourceIds:
                            snapshot.relatedResourceIds.filter(
                              (id) => id !== resourceId,
                            ),
                        })
                      }
                      type="checkbox"
                    />
                    <span>
                      Selected resource {index + 1} is unavailable — remove it
                      before publishing this profile.
                    </span>
                  </label>
                ))}
              </>
            ) : (
              <p className={styles.helpText}>
                No published internal resources are available yet.
              </p>
            )}
          </fieldset>
          <label className={styles.checkboxField}>
            <input
              checked={snapshot.featured}
              onChange={(event) =>
                setSnapshot({ ...snapshot, featured: event.target.checked })
              }
              type="checkbox"
            />
            <span>Feature this profile on published selections</span>
          </label>
          <Field label="Published display order">
            <input
              max={100000}
              min={0}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  displayOrder: Number(event.target.value),
                })
              }
              type="number"
              value={snapshot.displayOrder}
            />
            <span className={styles.helpText}>
              Lower numbers appear earlier after featured profiles. Changes
              take effect only when this revision is published.
            </span>
            <span className={styles.actionRow}>
              <button
                onClick={() =>
                  setSnapshot({
                    ...snapshot,
                    displayOrder: Math.max(
                      0,
                      snapshot.displayOrder - 10,
                    ),
                  })
                }
                type="button"
              >
                Move Earlier
              </button>
              <button
                onClick={() =>
                  setSnapshot({
                    ...snapshot,
                    displayOrder: Math.min(
                      100000,
                      snapshot.displayOrder + 10,
                    ),
                  })
                }
                type="button"
              >
                Move Later
              </button>
            </span>
          </Field>
        </fieldset>
      </form>
      <RevisionHistory
        busy={busy}
        onRestore={restore}
        workspace={workspace}
      />
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

function MediaSelect({
  media,
  onChange,
  value,
}: Readonly<{
  media: readonly CmsMediaOption[];
  onChange: (assetId: string | null) => void;
  value: string | null;
}>) {
  return (
    <>
      <select
        onChange={(event) => onChange(emptyToNull(event.target.value))}
        value={value ?? ""}
      >
        <option value="">Use the Field Notes category artwork</option>
        {media.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.label}
          </option>
        ))}
      </select>
      <span className={styles.helpText}>
        Only ready assets with approved rights, consent, credit, and useful alt
        text are selectable.
      </span>
    </>
  );
}

function RevisionHistory({
  busy,
  onRestore,
  workspace,
}: Readonly<{
  busy: boolean;
  onRestore: (revisionId: string) => void;
  workspace: CmsEntityWorkspaceDto;
}>) {
  return (
    <section className={styles.panel} aria-labelledby="club-history-heading">
      <h2 id="club-history-heading">Revision history</h2>
      <div className={styles.revisionGrid}>
        {workspace.revisions.map((revision) => (
          <article className={styles.entityCard} key={revision.id}>
            <div>
              <h3>Revision {revision.revisionNumber}</h3>
              <p className={styles.muted}>
                {revision.actorDisplayName} ·{" "}
                {new Date(revision.createdAt).toLocaleString("en-CA")}
              </p>
              <div className={styles.actionRow}>
                <Link
                  href={`/organizer/content/revisions/${encodeURIComponent(revision.id)}`}
                >
                  Preview
                </Link>
                {workspace.permissions.canRestore ? (
                  <button
                    disabled={busy}
                    onClick={() => onRestore(revision.id)}
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
  );
}

function clubSnapshot(workspace: CmsEntityWorkspaceDto): CmsClubProfileSnapshot {
  if (
    workspace.entity.entityType !== "club_public_profile" ||
    !workspace.revision ||
    !isRecord(workspace.revision.snapshot)
  ) {
    throw new Error("The club profile revision is unavailable.");
  }
  return workspace.revision.snapshot as CmsClubProfileSnapshot;
}

function isWorkspace(value: unknown): value is CmsEntityWorkspaceDto {
  return (
    isRecord(value) &&
    isRecord(value.entity) &&
    typeof value.entity.entityKey === "string" &&
    Array.isArray(value.revisions)
  );
}

function emptyToNull(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function lineList(value: string): readonly string[] {
  return value
    .split(/\r?\n/gu)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
