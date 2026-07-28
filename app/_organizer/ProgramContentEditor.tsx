"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  isRecord,
  organizerRequest,
  safeNotice,
} from "@/app/_organizer/client";
import type {
  CmsLaneOption,
  CmsMediaOption,
  CmsResourceOption,
} from "@/app/_organizer/ClubContentEditor";
import styles from "@/app/_organizer/phase6.module.css";
import type { CmsEntityWorkspaceDto } from "@/lib/server/organizer/cms";
import type { CmsProgramProfileSnapshot } from "@/lib/server/organizer/cms-validation";

export type CmsParentClubOption = Readonly<{
  id: string;
  label: string;
  slug: string;
}>;

export function ProgramContentEditor({
  clubs,
  initialWorkspace,
  lanes,
  media,
  resources,
}: Readonly<{
  clubs: readonly CmsParentClubOption[];
  initialWorkspace: CmsEntityWorkspaceDto;
  lanes: readonly CmsLaneOption[];
  media: readonly CmsMediaOption[];
  resources: readonly CmsResourceOption[];
}>) {
  const router = useRouter();
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const initial = programSnapshot(initialWorkspace);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [snapshot, setSnapshot] = useState(initial);
  const [socialUrlsText, setSocialUrlsText] = useState(
    initial.socialUrls.join("\n"),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resourceIds = new Set(resources.map((resource) => resource.id));
  const unavailableResourceIds = snapshot.relatedResourceIds.filter(
    (resourceId) => !resourceIds.has(resourceId),
  );
  const parentClub =
    clubs.find((club) => club.id === snapshot.clubId) ?? null;
  const path = `/api/organizer/content/program_public_profile/${encodeURIComponent(
    workspace.entity.entityKey,
  )}`;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate(
      path,
      "PATCH",
      {
        expectedContentVersion: workspace.entity.contentVersion,
        snapshot: {
          ...snapshot,
          socialUrls: lineList(socialUrlsText),
        },
      },
      "Program draft saved. Public content has not changed.",
    );
  }

  async function publish() {
    if (!window.confirm("Publish this Program revision to the website?")) {
      return;
    }
    await mutate(
      `${path}/publish`,
      "POST",
      { expectedContentVersion: workspace.entity.contentVersion },
      "Program published within its parent club.",
    );
  }

  async function unpublish() {
    if (!window.confirm("Unpublish this Program from the website?")) return;
    await mutate(
      `${path}/unpublish`,
      "POST",
      { expectedContentVersion: workspace.entity.contentVersion },
      "Program unpublished. Its private events and history remain.",
    );
  }

  async function archive() {
    if (
      !window.confirm(
        "Archive this Program? It will leave active selections and cannot accept future scheduling. Eligible past events and revision history remain.",
      )
    ) {
      return;
    }
    await mutate(
      `${path}/archive`,
      "POST",
      { expectedContentVersion: workspace.entity.contentVersion },
      "Program archived. Its historical public note and eligible past events remain.",
    );
  }

  async function safeDelete() {
    if (
      !window.confirm(
        "Permanently remove this unused Program from active planning? Its immutable private revision and audit history will remain.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await organizerRequest(`${path}/safe-delete`, {
        body: JSON.stringify({
          expectedContentVersion: workspace.entity.contentVersion,
        }),
        method: "POST",
      });
      if (!isRecord(result) || result.deleted !== true) {
        throw new Error("invalid_cms_response");
      }
      router.push("/organizer/content");
      router.refresh();
    } catch (caught) {
      setError(
        safeNotice(
          caught,
          "The Program could not be safely deleted.",
        ),
      );
      setBusy(false);
    }
  }

  async function restore(revisionId: string) {
    if (!window.confirm("Restore this revision as a new private draft?")) {
      return;
    }
    await mutate(
      `${path}/restore`,
      "POST",
      {
        expectedContentVersion: workspace.entity.contentVersion,
        revisionId,
      },
      "Historical Program content restored as a new private draft.",
    );
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
      const next = programSnapshot(result.entity);
      setSnapshot(next);
      setSocialUrlsText(next.socialUrls.join("\n"));
      setNotice(success);
      router.refresh();
      window.setTimeout(() => noticeRef.current?.focus(), 0);
    } catch (caught) {
      setError(safeNotice(caught, "The Program could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.noticeStack}>
      {error ? (
        <div className={styles.errorNotice} role="alert">
          <strong>Review the Program profile.</strong>
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
          <strong>This Program is archived.</strong>
          <p>
            It is absent from active lists, retained as read-only history, and
            unavailable for future scheduling.
          </p>
        </div>
      ) : null}
      <form className={`${styles.editorPanel} ${styles.form}`} onSubmit={save}>
        <div className={styles.splitHeader}>
          <div>
            <p className={styles.kicker}>Nested public Program</p>
            <h2>{snapshot.name}</h2>
            <p className={styles.muted}>
              Parent club: {parentClub?.label ?? "Unavailable"} · State:{" "}
              {workspace.entity.workflowStatus.replaceAll("_", " ")} · content
              version {workspace.entity.contentVersion}
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
                href={`/organizer/content/revisions/${encodeURIComponent(
                  workspace.revision.id,
                )}`}
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
            {workspace.permissions.canDelete ? (
              <button disabled={busy} onClick={safeDelete} type="button">
                Safely delete unused Program
              </button>
            ) : null}
          </div>
        </div>
        <fieldset
          className={styles.fieldGrid}
          disabled={busy || !workspace.permissions.canEdit}
        >
          <legend className={styles.srOnly}>Program public profile</legend>
          <Field label="Parent club">
            <input
              aria-describedby="program-parent-help"
              readOnly
              value={parentClub?.label ?? snapshot.clubId}
            />
            <span className={styles.helpText} id="program-parent-help">
              The scheduling relationship is canonical and cannot be changed
              from the public-content editor.
            </span>
          </Field>
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
          <Field label="Stable Program slug">
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
                setSnapshot({
                  ...snapshot,
                  programType: event.target.value,
                })
              }
              value={snapshot.programType}
            >
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
              maxLength={20_000}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  description: event.target.value,
                })
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
              maxLength={2_000}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  whatToExpect: nullable(event.target.value),
                })
              }
              value={snapshot.whatToExpect ?? ""}
            />
          </Field>
          <Field label="Preparation information">
            <textarea
              maxLength={2_000}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  preparation: nullable(event.target.value),
                })
              }
              value={snapshot.preparation ?? ""}
            />
          </Field>
          <Field label="Typical format">
            <textarea
              maxLength={2_000}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  typicalFormat: nullable(event.target.value),
                })
              }
              value={snapshot.typicalFormat ?? ""}
            />
          </Field>
          <Field label="Confirmed Meetup group URL">
            <input
              maxLength={2_048}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  meetupGroupUrl: nullable(event.target.value),
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
          <Field label="Theme color">
            <input
              onChange={(event) =>
                setSnapshot({ ...snapshot, themeColor: event.target.value })
              }
              pattern="#[0-9A-Fa-f]{6}"
              value={snapshot.themeColor}
            />
          </Field>
          <Field label="Confirmed social links (one HTTPS URL per line)" wide>
            <textarea
              onChange={(event) => setSocialUrlsText(event.target.value)}
              value={socialUrlsText}
            />
          </Field>
          <fieldset className={`${styles.field} ${styles.fieldWide}`}>
            <legend>Related published resources</legend>
            <p className={styles.helpText}>
              A selected resource must remain published. Unavailable
              selections stay visible here so they can be removed explicitly.
            </p>
            {resources.map((resource) => (
              <label className={styles.checkboxField} key={resource.id}>
                <input
                  checked={snapshot.relatedResourceIds.includes(resource.id)}
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
              <label className={styles.checkboxField} key={resourceId}>
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
                  before publishing.
                </span>
              </label>
            ))}
          </fieldset>
          <label className={styles.checkboxField}>
            <input
              checked={snapshot.featured}
              onChange={(event) =>
                setSnapshot({ ...snapshot, featured: event.target.checked })
              }
              type="checkbox"
            />
            <span>Feature this Program within its parent club</span>
          </label>
          <Field label="Published display order">
            <input
              max={100_000}
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
            <span className={styles.actionRow}>
              <button
                onClick={() =>
                  setSnapshot({
                    ...snapshot,
                    displayOrder: Math.max(0, snapshot.displayOrder - 10),
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
                      100_000,
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
      <section className={styles.panel} aria-labelledby="program-history">
        <h2 id="program-history">Revision history</h2>
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
                    href={`/organizer/content/revisions/${encodeURIComponent(
                      revision.id,
                    )}`}
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
        onChange={(event) => onChange(nullable(event.target.value))}
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

function programSnapshot(
  workspace: CmsEntityWorkspaceDto,
): CmsProgramProfileSnapshot {
  if (
    workspace.entity.entityType !== "program_public_profile" ||
    !workspace.revision ||
    !isRecord(workspace.revision.snapshot)
  ) {
    throw new Error("The Program revision is unavailable.");
  }
  return workspace.revision.snapshot as CmsProgramProfileSnapshot;
}

function isWorkspace(value: unknown): value is CmsEntityWorkspaceDto {
  return (
    isRecord(value) &&
    isRecord(value.entity) &&
    typeof value.entity.entityKey === "string" &&
    Array.isArray(value.revisions)
  );
}

function nullable(value: string): string | null {
  return value.trim() ? value : null;
}

function lineList(value: string): readonly string[] {
  return value
    .split(/\r?\n/gu)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
