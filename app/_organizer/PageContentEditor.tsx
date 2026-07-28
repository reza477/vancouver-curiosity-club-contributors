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
import type {
  CmsPageBlock,
  CmsPageSnapshot,
  PageBlockType,
} from "@/lib/server/organizer/cms-validation";

const PAGE_BLOCK_OPTIONS: readonly Readonly<{
  label: string;
  value: PageBlockType;
}>[] = [
  { label: "Hero", value: "hero" },
  { label: "Introduction", value: "intro" },
  { label: "Prose", value: "prose" },
  { label: "Callout", value: "callout" },
  { label: "Ordered link list", value: "ordered_link_list" },
  { label: "Media", value: "media" },
  { label: "Featured events", value: "featured_events" },
  { label: "Featured clubs", value: "featured_clubs" },
  { label: "Community links", value: "community_links" },
  { label: "Resource list", value: "resource_list" },
];

export type CmsSelectionOption = Readonly<{ id: string; label: string }>;
export type PageEditorSelectionOptions = Readonly<{
  clubs: readonly CmsSelectionOption[];
  communityLinks: readonly CmsSelectionOption[];
  events: readonly CmsSelectionOption[];
  media: readonly CmsSelectionOption[];
}>;

export function PageContentEditor({
  initialWorkspace,
  selectionOptions,
}: Readonly<{
  initialWorkspace: CmsEntityWorkspaceDto;
  selectionOptions: PageEditorSelectionOptions;
}>) {
  const router = useRouter();
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const initialSnapshot = pageSnapshot(initialWorkspace);
  const [title, setTitle] = useState(initialSnapshot.title);
  const [slug, setSlug] = useState(initialSnapshot.slug);
  const [seoTitle, setSeoTitle] = useState(initialSnapshot.seoTitle);
  const [metaDescription, setMetaDescription] = useState(
    initialSnapshot.metaDescription,
  );
  const [openGraphAssetId, setOpenGraphAssetId] = useState(
    initialSnapshot.openGraphAssetId,
  );
  const [blocks, setBlocks] = useState<readonly CmsPageBlock[]>(
    initialSnapshot.blocks,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entityPath = `/api/organizer/content/page/${encodeURIComponent(
    workspace.entity.entityKey,
  )}`;

  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate(
      entityPath,
      "PATCH",
      {
        expectedContentVersion: workspace.entity.contentVersion,
        snapshot: currentSnapshot(),
      },
      "Draft saved. The public page has not changed.",
    );
  }

  async function action(
    name: "publish" | "unpublish",
    confirmation: string,
  ) {
    if (!window.confirm(confirmation)) return;
    await mutate(
      `${entityPath}/${name}`,
      "POST",
      { expectedContentVersion: workspace.entity.contentVersion },
      name === "publish"
        ? "Revision published to the public website."
        : "Page unpublished. Its revision history is retained.",
    );
  }

  async function restore(revisionId: string) {
    await mutate(
      `${entityPath}/restore`,
      "POST",
      {
        expectedContentVersion: workspace.entity.contentVersion,
        revisionId,
      },
      "Historical revision restored as a new private draft. Public content is unchanged.",
    );
  }

  async function mutate(
    path: string,
    method: "PATCH" | "POST",
    body: unknown,
    success: string,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await organizerRequest(path, {
        body: JSON.stringify(body),
        method,
      });
      if (!isRecord(response) || !isWorkspace(response.entity)) {
        throw new Error("The content response was incomplete.");
      }
      setWorkspace(response.entity);
      const snapshot = pageSnapshot(response.entity);
      setTitle(snapshot.title);
      setSlug(snapshot.slug);
      setSeoTitle(snapshot.seoTitle);
      setMetaDescription(snapshot.metaDescription);
      setOpenGraphAssetId(snapshot.openGraphAssetId);
      setBlocks(snapshot.blocks);
      setNotice(success);
      router.refresh();
      queueMicrotask(() => noticeRef.current?.focus());
    } catch (mutationError) {
      setError(
        safeNotice(
          mutationError,
          "The content action could not be completed. Your form values remain here.",
        ),
      );
      queueMicrotask(() => noticeRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  function currentSnapshot(): CmsPageSnapshot {
    return {
      blocks,
      metaDescription,
      openGraphAssetId,
      seoTitle,
      slug,
      title,
    };
  }

  function addBlock() {
    if (blocks.length >= 24) return;
    setBlocks([
      ...blocks,
      {
        config: { heading: "New section", paragraphs: [] },
        id: crypto.randomUUID(),
        type: "prose",
      },
    ]);
  }

  function updateBlock(index: number, block: CmsPageBlock) {
    setBlocks(blocks.map((current, currentIndex) =>
      currentIndex === index ? block : current,
    ));
  }

  function moveBlock(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [current] = next.splice(index, 1);
    if (!current) return;
    next.splice(target, 0, current);
    setBlocks(next);
  }

  function removeBlock(index: number) {
    setBlocks(blocks.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <div className={styles.noticeStack}>
      <section className={styles.panel}>
        <div className={styles.splitHeader}>
          <div>
            <p className={styles.kicker}>Publication state</p>
            <h2>{formatLabel(workspace.entity.workflowStatus)}</h2>
            <p className={styles.muted}>
              Draft revision{" "}
              {workspace.entity.currentRevisionNumber ?? "none"}
              {" · "}
              Published revision{" "}
              {workspace.entity.publishedRevisionNumber ?? "none"}
              {workspace.entity.hasNewerDraft ? " · Newer draft waiting" : ""}
            </p>
          </div>
          <div className={styles.actionRow}>
            {workspace.revision ? (
              <Link
                href={`/organizer/content/revisions/${encodeURIComponent(workspace.revision.id)}`}
              >
                Preview current draft
              </Link>
            ) : null}
            {workspace.permissions.canPublish ? (
              <button
                disabled={busy || workspace.revision === null}
                onClick={() =>
                  action(
                    "publish",
                    "Publish this exact validated revision to the website now?",
                  )
                }
                type="button"
              >
                Publish
              </button>
            ) : null}
            {workspace.permissions.canUnpublish ? (
              <button
                disabled={
                  busy || workspace.entity.workflowStatus !== "published"
                }
                onClick={() =>
                  action(
                    "unpublish",
                    "Unpublish this page from public routes and the sitemap?",
                  )
                }
                type="button"
              >
                Unpublish
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <form className={styles.editorPanel} onSubmit={saveDraft}>
        <div className={styles.splitHeader}>
          <div>
            <p className={styles.kicker}>Structured page</p>
            <h2>Edit private draft</h2>
          </div>
          <button
            className={styles.button}
            disabled={busy || blocks.length >= 24}
            onClick={addBlock}
            type="button"
          >
            Add block
          </button>
        </div>
        <div className={styles.fieldGrid}>
          <label className={styles.field}>
            <span>Page title</span>
            <input
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              required
              type="text"
              value={title}
            />
          </label>
          <label className={styles.field}>
            <span>Public slug</span>
            <input
              aria-describedby={
                workspace.permissions.canChangeSlug
                  ? undefined
                  : "page-slug-protected-note"
              }
              maxLength={128}
              onChange={(event) => setSlug(event.target.value)}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              readOnly={!workspace.permissions.canChangeSlug}
              required
              type="text"
              value={slug}
            />
            {!workspace.permissions.canChangeSlug ? (
              <small id="page-slug-protected-note">
                This established public route is protected and cannot be
                renamed.
              </small>
            ) : null}
          </label>
          <label className={styles.field}>
            <span>SEO title</span>
            <input
              maxLength={60}
              onChange={(event) => setSeoTitle(event.target.value)}
              required
              type="text"
              value={seoTitle}
            />
          </label>
          <label className={styles.field}>
            <span>Meta description</span>
            <input
              maxLength={160}
              onChange={(event) => setMetaDescription(event.target.value)}
              required
              type="text"
              value={metaDescription}
            />
          </label>
          <label className={styles.field}>
            <span>Open Graph image</span>
            <select
              onChange={(event) =>
                setOpenGraphAssetId(event.target.value || null)
              }
              value={openGraphAssetId ?? ""}
            >
              <option value="">Use the approved site default</option>
              {selectionOptions.media.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.blockList}>
          {blocks.map((block, index) => (
            <PageBlockEditor
              block={block}
              canMoveDown={index < blocks.length - 1}
              canMoveUp={index > 0}
              index={index}
              key={`${workspace.revision?.id ?? "new"}:${block.id}:${block.type}`}
              onChange={(next) => updateBlock(index, next)}
              onMoveDown={() => moveBlock(index, 1)}
              onMoveUp={() => moveBlock(index, -1)}
              onRemove={() => removeBlock(index)}
              selectionOptions={selectionOptions}
            />
          ))}
        </div>
        {error ? (
          <p
            className={styles.errorNotice}
            ref={noticeRef}
            role="alert"
            tabIndex={-1}
          >
            {error}
          </p>
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
        <div className={styles.actionRow}>
          <button data-primary="true" disabled={busy} type="submit">
            {busy ? "Saving…" : "Save Draft"}
          </button>
        </div>
      </form>

      <RevisionHistory
        currentRevisionId={workspace.revision?.id ?? null}
        disabled={busy}
        onRestore={workspace.permissions.canRestore ? restore : () => undefined}
        revisions={workspace.revisions}
      />
    </div>
  );
}

function PageBlockEditor({
  block,
  canMoveDown,
  canMoveUp,
  index,
  onChange,
  onMoveDown,
  onMoveUp,
  onRemove,
  selectionOptions,
}: Readonly<{
  block: CmsPageBlock;
  canMoveDown: boolean;
  canMoveUp: boolean;
  index: number;
  onChange(block: CmsPageBlock): void;
  onMoveDown(): void;
  onMoveUp(): void;
  onRemove(): void;
  selectionOptions: PageEditorSelectionOptions;
}>) {
  const config = block.config;
  const [paragraphsText, setParagraphsText] = useState(
    stringArrayConfig(config.paragraphs).join("\n\n"),
  );
  const [linksText, setLinksText] = useState(linkLines(config.items));
  const updateConfig = (patch: Record<string, unknown>) =>
    onChange({ ...block, config: { ...config, ...patch } });
  return (
    <fieldset className={styles.blockCard}>
      <legend>Block {index + 1}</legend>
      <header>
        <h3>{PAGE_BLOCK_OPTIONS.find((item) => item.value === block.type)?.label}</h3>
        <div className={styles.actionRow}>
          <button disabled={!canMoveUp} onClick={onMoveUp} type="button">
            Move up
          </button>
          <button disabled={!canMoveDown} onClick={onMoveDown} type="button">
            Move down
          </button>
          <button onClick={onRemove} type="button">
            Remove
          </button>
        </div>
      </header>
      <div className={styles.fieldGrid}>
        <label className={styles.field}>
          <span>Block type</span>
          <select
            onChange={(event) =>
              onChange({
                config: defaultConfig(event.target.value as PageBlockType),
                id: block.id,
                type: event.target.value as PageBlockType,
              })
            }
            value={block.type}
          >
            {PAGE_BLOCK_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Heading</span>
          <input
            maxLength={240}
            onChange={(event) => updateConfig({ heading: event.target.value })}
            type="text"
            value={stringConfig(config.heading)}
          />
        </label>
        {isTextBlock(block.type) ? (
          <>
            <label className={styles.field}>
              <span>Eyebrow</span>
              <input
                maxLength={120}
                onChange={(event) =>
                  updateConfig({ eyebrow: event.target.value })
                }
                type="text"
                value={stringConfig(config.eyebrow)}
              />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span>Lead text</span>
              <textarea
                maxLength={4_000}
                onChange={(event) => updateConfig({ text: event.target.value })}
                value={stringConfig(config.text)}
              />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span>Paragraphs</span>
              <textarea
                maxLength={24_000}
                onChange={(event) => {
                  setParagraphsText(event.target.value);
                  updateConfig({
                    paragraphs: event.target.value
                      .split(/\n\s*\n/gu)
                      .map((value) => value.trim())
                      .filter(Boolean),
                  });
                }}
                value={paragraphsText}
              />
              <span className={styles.helpText}>
                Separate paragraphs with a blank line.
              </span>
            </label>
          </>
        ) : null}
        {block.type === "ordered_link_list" ||
        block.type === "resource_list" ? (
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Links</span>
            <textarea
              onChange={(event) => {
                setLinksText(event.target.value);
                updateConfig({ items: parseLinkLines(event.target.value) });
              }}
              value={linksText}
            />
            <span className={styles.helpText}>
              One per line: Label | https://destination | optional description
            </span>
          </label>
        ) : null}
        {block.type === "media" ? (
          <>
            <label className={styles.field}>
              <span>Approved media asset</span>
              <select
                onChange={(event) =>
                  updateConfig({ assetId: event.target.value })
                }
                required
                value={stringConfig(config.assetId)}
              >
                <option value="">Choose approved artwork</option>
                {selectionOptions.media.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Optional caption override</span>
              <input
                maxLength={1_000}
                onChange={(event) =>
                  updateConfig({ caption: event.target.value })
                }
                type="text"
                value={stringConfig(config.caption)}
              />
            </label>
          </>
        ) : null}
        {isDynamicBlock(block.type) ? (
          <>
            <label className={styles.field}>
              <span>Maximum items</span>
              <input
                max={12}
                min={1}
                onChange={(event) =>
                  updateConfig({ limit: Number(event.target.value) })
                }
                type="number"
                value={numberConfig(config.limit, 6)}
              />
            </label>
            <fieldset className={`${styles.field} ${styles.fieldWide}`}>
              <legend>Published selections, in chosen order</legend>
              <div className={styles.selectionList}>
                {dynamicSelectionOptions(
                  block.type,
                  selectionOptions,
                  stringArrayConfig(config.ids),
                ).map((option) => {
                  const selected = stringArrayConfig(config.ids);
                  return (
                    <label className={styles.checkboxField} key={option.id}>
                      <input
                        checked={selected.includes(option.id)}
                        onChange={(event) =>
                          updateConfig({
                            ids: event.target.checked
                              ? [...selected, option.id]
                              : selected.filter((id) => id !== option.id),
                          })
                        }
                        type="checkbox"
                      />
                      <span>
                        {option.label}
                        {option.unavailable
                          ? " — unavailable; remove before publishing"
                          : ""}
                      </span>
                    </label>
                  );
                })}
              </div>
              <span className={styles.helpText}>
                Selections are revalidated at publish and read time.
                Unpublished or stale records are suppressed.
              </span>
            </fieldset>
          </>
        ) : null}
      </div>
    </fieldset>
  );
}

export function RevisionHistory({
  currentRevisionId,
  disabled,
  onRestore,
  revisions,
}: Readonly<{
  currentRevisionId: string | null;
  disabled: boolean;
  onRestore(revisionId: string): void;
  revisions: CmsEntityWorkspaceDto["revisions"];
}>) {
  return (
    <section className={styles.panel} aria-labelledby="revision-history-heading">
      <p className={styles.kicker}>Immutable history</p>
      <h2 id="revision-history-heading">Revisions</h2>
      <div className={styles.revisionGrid}>
        {revisions.map((revision) => (
          <article className={styles.entityCard} key={revision.id}>
            <div>
              <h3>Revision {revision.revisionNumber}</h3>
              <p className={styles.muted}>
                {revision.actorDisplayName} ·{" "}
                {new Intl.DateTimeFormat("en-CA", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(revision.createdAt))}
              </p>
              <p className={styles.muted}>
                Hash {revision.contentHash.slice(0, 12)}…
              </p>
              <div className={styles.actionRow}>
                <Link
                  href={`/organizer/content/revisions/${encodeURIComponent(revision.id)}`}
                >
                  Preview
                </Link>
                <button
                  disabled={disabled || revision.id === currentRevisionId}
                  onClick={() => onRestore(revision.id)}
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
  );
}

function pageSnapshot(workspace: CmsEntityWorkspaceDto): CmsPageSnapshot {
  const value: unknown = workspace.revision?.snapshot;
  if (!isRecord(value) || !Array.isArray(value.blocks)) {
    throw new Error("The page revision is unavailable.");
  }
  return value as unknown as CmsPageSnapshot;
}

function isWorkspace(value: unknown): value is CmsEntityWorkspaceDto {
  return (
    isRecord(value) &&
    isRecord(value.entity) &&
    typeof value.entity.entityKey === "string" &&
    Array.isArray(value.revisions)
  );
}

function isTextBlock(type: PageBlockType): boolean {
  return ["hero", "intro", "prose", "callout"].includes(type);
}

function isDynamicBlock(type: PageBlockType): boolean {
  return ["featured_events", "featured_clubs", "community_links"].includes(type);
}

function dynamicOptions(
  type: PageBlockType,
  options: PageEditorSelectionOptions,
): readonly CmsSelectionOption[] {
  if (type === "featured_events") return options.events;
  if (type === "featured_clubs") return options.clubs;
  return type === "community_links" ? options.communityLinks : [];
}

function dynamicSelectionOptions(
  type: PageBlockType,
  options: PageEditorSelectionOptions,
  selectedIds: readonly string[],
): readonly Readonly<{
  id: string;
  label: string;
  unavailable: boolean;
}>[] {
  const available = dynamicOptions(type, options);
  const availableIds = new Set(available.map((option) => option.id));
  return Object.freeze([
    ...available.map((option) =>
      Object.freeze({ ...option, unavailable: false }),
    ),
    ...selectedIds
      .filter((id) => !availableIds.has(id))
      .map((id, index) =>
        Object.freeze({
          id,
          label: `Selected item ${index + 1}`,
          unavailable: true,
        }),
      ),
  ]);
}

function defaultConfig(type: PageBlockType): Readonly<Record<string, unknown>> {
  if (isTextBlock(type)) return { heading: "New section", paragraphs: [] };
  if (type === "ordered_link_list" || type === "resource_list") {
    return { heading: "Useful links", items: [] };
  }
  if (type === "media") return { assetId: "", caption: null, heading: "Artwork" };
  return { heading: "Published selection", ids: [], limit: 6 };
}

function stringConfig(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArrayConfig(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function numberConfig(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseLinkLines(value: string) {
  if (value.length === 0) return [];
  return value
    .split(/\r?\n/gu)
    .map((line) => {
      const [label = "", url = "", description = ""] = line.split("|");
      return {
        description: description.trim() || null,
        label: label.trim(),
        url: url.trim(),
      };
    });
}

function linkLines(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const label = stringConfig(entry.label);
      const url = stringConfig(entry.url);
      const description = stringConfig(entry.description);
      return [
        `${label}${label || url || description ? " | " : ""}${url}${
          description ? ` | ${description}` : ""
        }`,
      ];
    })
    .join("\n");
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) =>
    letter.toUpperCase(),
  );
}
