"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CMS_FOOTER_NAVIGATION_MAX,
  CMS_HEADER_NAVIGATION_MAX,
  CMS_NAVIGATION_MAX,
  institutionalNavigationItems,
} from "@/lib/server/organizer/cms-validation";
import { useRef, useState } from "react";
import {
  isRecord,
  organizerRequest,
  safeNotice,
} from "@/app/_organizer/client";
import styles from "@/app/_organizer/phase6.module.css";
import type { CmsEntityWorkspaceDto } from "@/lib/server/organizer/cms";
import type {
  CmsNavigationItem,
  CmsNavigationSnapshot,
} from "@/lib/server/organizer/cms-validation";

const REQUIRED_TARGETS = new Set([
  "/events",
  "/clubs",
  "/about",
  "/for-organizations",
  "/get-involved",
  "/host-an-event",
  "/contact",
  "/conduct",
  "/privacy",
]);

export function NavigationContentEditor({
  initialWorkspace,
}: Readonly<{ initialWorkspace: CmsEntityWorkspaceDto }>) {
  const router = useRouter();
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [items, setItems] = useState(navigationSnapshot(initialWorkspace).items);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = "/api/organizer/content/navigation/navigation";

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate(path, "PATCH", {
      expectedContentVersion: workspace.entity.contentVersion,
      snapshot: { items: normalizedItems(items) },
    }, "Navigation draft saved. The public header and footer have not changed.");
  }

  async function action(name: "publish" | "unpublish") {
    if (
      !window.confirm(
        name === "publish"
          ? "Publish this navigation and footer revision?"
          : "Unpublish this navigation revision and retain the required source fallback?",
      )
    ) {
      return;
    }
    await mutate(`${path}/${name}`, "POST", {
      expectedContentVersion: workspace.entity.contentVersion,
    }, name === "publish" ? "Navigation published." : "Navigation unpublished.");
  }

  async function restore(revisionId: string) {
    if (!window.confirm("Restore this navigation revision as a new draft?")) {
      return;
    }
    await mutate(`${path}/restore`, "POST", {
      expectedContentVersion: workspace.entity.contentVersion,
      revisionId,
    }, "Navigation history restored as a new private draft.");
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
      setItems(navigationSnapshot(result.entity).items);
      setNotice(success);
      router.refresh();
      window.setTimeout(() => noticeRef.current?.focus(), 0);
    } catch (caught) {
      setError(safeNotice(caught, "Navigation could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  function update(index: number, patch: Partial<CmsNavigationItem>) {
    setItems(items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item,
    ));
  }

  function move(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    const reordered = [...items];
    const current = reordered[index];
    const adjacent = reordered[nextIndex];
    if (!current || !adjacent || current.placement !== adjacent.placement) return;
    reordered[index] = adjacent;
    reordered[nextIndex] = current;
    setItems(reordered);
  }

  function addItem() {
    if (
      items.length >= CMS_NAVIGATION_MAX ||
      items.filter((item) => item.placement === "footer").length >=
        CMS_FOOTER_NAVIGATION_MAX
    ) {
      setError(
        `Navigation is limited to ${CMS_HEADER_NAVIGATION_MAX} header items and ${CMS_FOOTER_NAVIGATION_MAX} footer items.`,
      );
      return;
    }
    setItems([
      ...items,
      {
        id: crypto.randomUUID(),
        label: "Resources",
        placement: "footer",
        sortOrder: items.length * 10,
        target: "/resources",
      },
    ]);
  }

  function remove(index: number) {
    const item = items[index];
    if (!item || REQUIRED_TARGETS.has(item.target)) return;
    setItems(items.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className={styles.noticeStack}>
      {error ? (
        <div className={styles.errorNotice} role="alert">
          <strong>Review the navigation revision.</strong>
          <p>{error}</p>
        </div>
      ) : null}
      {notice ? (
        <p className={styles.successNotice} ref={noticeRef} role="status" tabIndex={-1}>
          {notice}
        </p>
      ) : null}
      <form className={`${styles.editorPanel} ${styles.form}`} onSubmit={save}>
        <div className={styles.splitHeader}>
          <div>
            <p className={styles.kicker}>Required routes stay protected</p>
            <h2>Header and footer navigation</h2>
            <p className={styles.helpText}>
              The five public header destinations and required footer links are
              fixed to match the public information architecture. Organizer
              Login is added automatically in the footer. Optional resources
              and confirmed external links can be added to the footer.
              Navigation supports exactly {CMS_HEADER_NAVIGATION_MAX} header
              items and up to {CMS_FOOTER_NAVIGATION_MAX} footer items.
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
            {workspace.permissions.canPublish &&
            workspace.revision &&
            (workspace.entity.workflowStatus !== "published" ||
              workspace.entity.hasNewerDraft) ? (
              <button disabled={busy} onClick={() => action("publish")} type="button">
                Publish
              </button>
            ) : null}
            {workspace.permissions.canUnpublish &&
            workspace.entity.workflowStatus === "published" ? (
              <button disabled={busy} onClick={() => action("unpublish")} type="button">
                Unpublish
              </button>
            ) : null}
            {workspace.permissions.canEdit ? (
              <button
                disabled={
                  busy ||
                  items.length >= CMS_NAVIGATION_MAX ||
                  items.filter((item) => item.placement === "footer").length >=
                    CMS_FOOTER_NAVIGATION_MAX
                }
                onClick={addItem}
                type="button"
              >
                Add Navigation Item
              </button>
            ) : null}
          </div>
        </div>
        <ol className={styles.blockList}>
          {items.map((item, index) => {
            const protectedTarget = REQUIRED_TARGETS.has(item.target);
            return (
              <li className={styles.blockCard} key={item.id}>
                <header>
                  <h3>{item.label || "Untitled navigation item"}</h3>
                  <div className={styles.toolbar}>
                    <button
                      disabled={busy || protectedTarget || index === 0}
                      onClick={() => move(index, -1)}
                      type="button"
                    >
                      Move Up
                    </button>
                    <button
                      disabled={
                        busy ||
                        protectedTarget ||
                        index === items.length - 1
                      }
                      onClick={() => move(index, 1)}
                      type="button"
                    >
                      Move Down
                    </button>
                    {!protectedTarget ? (
                      <button disabled={busy} onClick={() => remove(index)} type="button">
                        Remove
                      </button>
                    ) : null}
                  </div>
                </header>
                <div className={styles.fieldGrid}>
                  <label className={styles.field}>
                    <span>Label</span>
                    <input
                      disabled={protectedTarget}
                      maxLength={80}
                      onChange={(event) => update(index, { label: event.target.value })}
                      required
                      value={item.label}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Placement</span>
                    <select
                      disabled={protectedTarget}
                      onChange={(event) =>
                        update(index, {
                          placement: event.target.value as "footer" | "header",
                        })
                      }
                      value={item.placement}
                    >
                      <option
                        disabled={
                          item.placement !== "header" &&
                          items.filter(
                            (candidate) =>
                              candidate.placement === "header",
                          ).length >= CMS_HEADER_NAVIGATION_MAX
                        }
                        value="header"
                      >
                        Header
                      </option>
                      <option
                        disabled={
                          item.placement !== "footer" &&
                          items.filter(
                            (candidate) =>
                              candidate.placement === "footer",
                          ).length >= CMS_FOOTER_NAVIGATION_MAX
                        }
                        value="footer"
                      >
                        Footer
                      </option>
                    </select>
                  </label>
                  <label className={`${styles.field} ${styles.fieldWide}`}>
                    <span>Target</span>
                    <input
                      disabled={protectedTarget}
                      maxLength={2048}
                      onChange={(event) => update(index, { target: event.target.value })}
                      required
                      value={item.target}
                    />
                  </label>
                </div>
              </li>
            );
          })}
        </ol>
      </form>
      <section className={styles.panel} aria-labelledby="navigation-history">
        <h2 id="navigation-history">Revision history</h2>
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
                  <button
                    disabled={busy || !workspace.permissions.canRestore}
                    onClick={() => restore(revision.id)}
                    type="button"
                  >
                    Restore as New Draft
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function normalizedItems(items: readonly CmsNavigationItem[]) {
  return items.map((item, index) => ({ ...item, sortOrder: index * 10 }));
}

function navigationSnapshot(
  workspace: CmsEntityWorkspaceDto,
): CmsNavigationSnapshot {
  if (
    workspace.entity.entityType !== "navigation" ||
    !workspace.revision ||
    !isRecord(workspace.revision.snapshot)
  ) {
    throw new Error("The navigation revision is unavailable.");
  }
  const snapshot = workspace.revision.snapshot as CmsNavigationSnapshot;
  return Object.freeze({
    items: institutionalNavigationItems(snapshot.items),
  });
}

function isWorkspace(value: unknown): value is CmsEntityWorkspaceDto {
  return (
    isRecord(value) &&
    isRecord(value.entity) &&
    typeof value.entity.entityKey === "string" &&
    Array.isArray(value.revisions)
  );
}
