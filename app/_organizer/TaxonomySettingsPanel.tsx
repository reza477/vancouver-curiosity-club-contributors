"use client";

import { useEffect, useRef, useState } from "react";
import {
  isRecord,
  organizerRequest,
  safeNotice,
} from "@/app/_organizer/client";
import styles from "@/app/_organizer/phase6.module.css";
import {
  TAXONOMY_COLOR_TOKEN_MAX,
  TAXONOMY_COLOR_TOKEN_PATTERN_SOURCE,
  TAXONOMY_DESCRIPTION_MAX,
  TAXONOMY_MAX_ITEMS,
  TAXONOMY_NAME_MAX,
  TAXONOMY_SLUG_MAX,
  TAXONOMY_SLUG_PATTERN_SOURCE,
  TAXONOMY_SORT_ORDER_MAX,
} from "@/lib/taxonomy-contract";
import { blockedLaneArchiveExplanation } from "@/app/_organizer/taxonomy-copy";

type TaxonomyKind = "category" | "lane";
type TaxonomyAction =
  | "archive"
  | "move_down"
  | "move_up"
  | "safe_delete";

type TaxonomyBlockerDto = Readonly<{
  count: number;
  label: string;
}>;

type TaxonomyItemDto = Readonly<{
  archived: boolean;
  blockers: readonly TaxonomyBlockerDto[];
  canArchive: boolean;
  canDelete: boolean;
  colorToken: string | null;
  contentVersion: number;
  description: string | null;
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
}>;

type TaxonomyWorkspaceDto = Readonly<{
  categories: readonly TaxonomyItemDto[];
  lanes: readonly TaxonomyItemDto[];
  permissions: Readonly<{ canManage: boolean }>;
}>;

const TAXONOMY_PATH = "/api/organizer/settings/taxonomy";

export function TaxonomySettingsPanel({
  canManage,
}: Readonly<{ canManage: boolean }>) {
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const [workspace, setWorkspace] = useState<TaxonomyWorkspaceDto | null>(
    null,
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState(
    canManage ? "Loading event taxonomy…" : "",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await organizerRequest(TAXONOMY_PATH, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setWorkspace(parseTaxonomyResponse(response));
        setNotice("");
      } catch (caught) {
        if (controller.signal.aborted) return;
        setNotice("");
        setError(
          safeNotice(
            caught,
            "Event lanes and categories could not be loaded. No value is being guessed.",
          ),
        );
        window.setTimeout(() => noticeRef.current?.focus(), 0);
      }
    })();
    return () => controller.abort();
  }, [canManage]);

  async function mutate(
    key: string,
    path: string,
    method: "PATCH" | "POST",
    body: Readonly<Record<string, unknown>>,
    successNotice: string,
  ) {
    if (!canManage || busyKey) return false;
    setBusyKey(key);
    setError(null);
    setNotice("");
    try {
      const response = await organizerRequest(path, {
        body: JSON.stringify(body),
        method,
      });
      setWorkspace(parseTaxonomyResponse(response));
      setNotice(successNotice);
      window.setTimeout(() => noticeRef.current?.focus(), 0);
      return true;
    } catch (caught) {
      setError(
        safeNotice(
          caught,
          "The taxonomy change was not saved. Your entered values remain in the form.",
        ),
      );
      window.setTimeout(() => noticeRef.current?.focus(), 0);
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function create(
    event: React.FormEvent<HTMLFormElement>,
    kind: TaxonomyKind,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const saved = await mutate(
      `create-${kind}`,
      TAXONOMY_PATH,
      "POST",
      {
        colorToken:
          kind === "category" ? optionalFormText(data, "colorToken") : null,
        description: optionalFormText(data, "description"),
        entityType: kind,
        name: formText(data, "name"),
        slug: optionalFormText(data, "slug"),
      },
      `${kindLabel(kind)} created privately.`,
    );
    if (saved) form.reset();
  }

  async function update(
    event: React.FormEvent<HTMLFormElement>,
    kind: TaxonomyKind,
    item: TaxonomyItemDto,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate(
      `update-${kind}-${item.id}`,
      TAXONOMY_PATH,
      "PATCH",
      {
        action: "update",
        colorToken:
          kind === "category" ? optionalFormText(data, "colorToken") : null,
        description: optionalFormText(data, "description"),
        entityType: kind,
        expectedContentVersion: item.contentVersion,
        id: item.id,
        name: formText(data, "name"),
      },
      `${kindLabel(kind)} updated.`,
    );
  }

  async function act(
    kind: TaxonomyKind,
    item: TaxonomyItemDto,
    action: TaxonomyAction,
  ) {
    if (
      action === "archive" &&
      !window.confirm(
        `Archive ${item.name}? Existing records keep their exact selection, but new records cannot select it.`,
      )
    ) {
      return;
    }
    if (
      action === "safe_delete" &&
      !window.confirm(
        `Safe-delete archived ${kindLabel(kind).toLowerCase()} ${item.name}? This succeeds only when no established record still depends on it.`,
      )
    ) {
      return;
    }
    if (action === "move_up" || action === "move_down") {
      if (!workspace) return;
      const activeItems = (
        kind === "lane" ? workspace.lanes : workspace.categories
      ).filter((candidate) => !candidate.archived);
      const index = activeItems.findIndex(
        (candidate) => candidate.id === item.id,
      );
      const nextIndex = action === "move_up" ? index - 1 : index + 1;
      if (
        index < 0 ||
        nextIndex < 0 ||
        nextIndex >= activeItems.length
      ) {
        return;
      }
      const reordered = [...activeItems];
      [reordered[index], reordered[nextIndex]] = [
        reordered[nextIndex],
        reordered[index],
      ];
      await mutate(
        `${action}-${kind}-${item.id}`,
        TAXONOMY_PATH,
        "PATCH",
        {
          action: "reorder",
          entityType: kind,
          items: reordered.map((candidate) => ({
            expectedContentVersion: candidate.contentVersion,
            id: candidate.id,
          })),
        },
        taxonomyActionNotice(kind, action),
      );
      return;
    }
    await mutate(
      `${action}-${kind}-${item.id}`,
      TAXONOMY_PATH,
      "PATCH",
      {
        action,
        entityType: kind,
        expectedContentVersion: item.contentVersion,
        id: item.id,
      },
      taxonomyActionNotice(kind, action),
    );
  }

  return (
    <section
      aria-labelledby="taxonomy-settings-heading"
      className={styles.editorPanel}
      id="event-taxonomy"
    >
      <div className={styles.splitHeader}>
        <div>
          <p className={styles.kicker}>Structured event vocabulary</p>
          <h2 id="taxonomy-settings-heading">Event lanes and categories</h2>
          <p className={styles.helpText}>
            Lanes shape the public Field Notes program. Categories provide a
            finer event label. Reordering is keyboard accessible; archival
            preserves historical selections.
          </p>
        </div>
      </div>

      {!canManage ? (
        <p className={styles.notice}>
          Only an Owner or Administrator can manage organization taxonomy.
        </p>
      ) : (
        <>
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
              aria-live="polite"
              className={styles.successNotice}
              ref={noticeRef}
              role="status"
              tabIndex={-1}
            >
              {notice}
            </p>
          ) : null}
          {workspace ? (
            <div className={styles.taxonomyWorkspace}>
              <CreateTaxonomyForm
                busy={
                  busyKey !== null || !workspace.permissions.canManage
                }
                kind="lane"
                onSubmit={create}
              />
              <CreateTaxonomyForm
                busy={
                  busyKey !== null || !workspace.permissions.canManage
                }
                kind="category"
                onSubmit={create}
              />
              <TaxonomyList
                busyKey={
                  workspace.permissions.canManage ? busyKey : "read-only"
                }
                items={workspace.lanes}
                kind="lane"
                onAction={act}
                onUpdate={update}
              />
              <TaxonomyList
                busyKey={
                  workspace.permissions.canManage ? busyKey : "read-only"
                }
                items={workspace.categories}
                kind="category"
                onAction={act}
                onUpdate={update}
              />
            </div>
          ) : error ? null : (
            <p className={styles.muted}>
              No taxonomy form is shown until the private D1 workspace loads.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function CreateTaxonomyForm({
  busy,
  kind,
  onSubmit,
}: Readonly<{
  busy: boolean;
  kind: TaxonomyKind;
  onSubmit: (
    event: React.FormEvent<HTMLFormElement>,
    kind: TaxonomyKind,
  ) => Promise<void>;
}>) {
  const label = kindLabel(kind);
  return (
    <form
      className={styles.taxonomyCreate}
      onSubmit={(event) => void onSubmit(event, kind)}
    >
      <h3>Create {label.toLowerCase()}</h3>
      <label className={styles.field}>
        <span>Name</span>
        <input
          disabled={busy}
          maxLength={TAXONOMY_NAME_MAX}
          name="name"
          required
        />
      </label>
      <label className={styles.field}>
        <span>Stable slug, optional</span>
        <input
          disabled={busy}
          maxLength={TAXONOMY_SLUG_MAX}
          name="slug"
          pattern={TAXONOMY_SLUG_PATTERN_SOURCE}
        />
        <small className={styles.helpText}>
          Leave blank to derive lowercase hyphenated words from the name. The
          stable slug cannot be changed after creation.
        </small>
      </label>
      <label className={styles.field}>
        <span>Description, optional</span>
        <textarea
          disabled={busy}
          maxLength={TAXONOMY_DESCRIPTION_MAX}
          name="description"
          rows={3}
        />
      </label>
      {kind === "category" ? (
        <label className={styles.field}>
          <span>Color token, optional</span>
          <input
            disabled={busy}
            maxLength={TAXONOMY_COLOR_TOKEN_MAX}
            name="colorToken"
            pattern={TAXONOMY_COLOR_TOKEN_PATTERN_SOURCE}
          />
          <small className={styles.helpText}>
            Text remains the authoritative status cue; color is supplementary.
          </small>
        </label>
      ) : null}
      <button
        className={styles.buttonPrimary}
        disabled={busy}
        type="submit"
      >
        Create {label.toLowerCase()}
      </button>
    </form>
  );
}

function TaxonomyList({
  busyKey,
  items,
  kind,
  onAction,
  onUpdate,
}: Readonly<{
  busyKey: string | null;
  items: readonly TaxonomyItemDto[];
  kind: TaxonomyKind;
  onAction: (
    kind: TaxonomyKind,
    item: TaxonomyItemDto,
    action: TaxonomyAction,
  ) => Promise<void>;
  onUpdate: (
    event: React.FormEvent<HTMLFormElement>,
    kind: TaxonomyKind,
    item: TaxonomyItemDto,
  ) => Promise<void>;
}>) {
  const label = kindLabel(kind);
  const activeItems = items.filter((item) => !item.archived);
  return (
    <section
      aria-labelledby={`taxonomy-${kind}-heading`}
      className={styles.taxonomyList}
    >
      <header>
        <h3 id={`taxonomy-${kind}-heading`}>{label}s</h3>
        <p className={styles.helpText}>
          {items.length} {items.length === 1 ? label.toLowerCase() : `${label.toLowerCase()}s`}
        </p>
      </header>
      {items.length === 0 ? (
        <p className={styles.muted}>No {label.toLowerCase()} exists yet.</p>
      ) : (
        <ol>
          {items.map((item) => {
            const activeIndex = activeItems.findIndex(
              (candidate) => candidate.id === item.id,
            );
            return (
              <li key={item.id}>
                <TaxonomyItemEditor
                  activeIndex={activeIndex}
                  activeItemCount={activeItems.length}
                  busy={busyKey !== null}
                  item={item}
                  kind={kind}
                  onAction={onAction}
                  onUpdate={onUpdate}
                />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function TaxonomyItemEditor({
  activeIndex,
  activeItemCount,
  busy,
  item,
  kind,
  onAction,
  onUpdate,
}: Readonly<{
  activeIndex: number;
  activeItemCount: number;
  busy: boolean;
  item: TaxonomyItemDto;
  kind: TaxonomyKind;
  onAction: (
    kind: TaxonomyKind,
    item: TaxonomyItemDto,
    action: TaxonomyAction,
  ) => Promise<void>;
  onUpdate: (
    event: React.FormEvent<HTMLFormElement>,
    kind: TaxonomyKind,
    item: TaxonomyItemDto,
  ) => Promise<void>;
}>) {
  const label = kindLabel(kind);
  return (
    <article className={styles.taxonomyItem}>
      <div className={styles.stateLine}>
        <span className={styles.stateBadge}>
          {item.archived ? "Archived" : "Active"}
        </span>
        <span className={styles.muted}>
          Stable slug: <code>{item.slug}</code>
        </span>
        <span className={styles.muted}>
          Version {item.contentVersion}
        </span>
      </div>
      <form
        className={styles.taxonomyItemForm}
        key={`${item.id}-${item.contentVersion}`}
        onSubmit={(event) => void onUpdate(event, kind, item)}
      >
        <label className={styles.field}>
          <span>Name</span>
          <input
            defaultValue={item.name}
            disabled={busy || item.archived}
            maxLength={TAXONOMY_NAME_MAX}
            name="name"
            required
          />
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>Description, optional</span>
          <textarea
            defaultValue={item.description ?? ""}
            disabled={busy || item.archived}
            maxLength={TAXONOMY_DESCRIPTION_MAX}
            name="description"
            rows={3}
          />
        </label>
        {kind === "category" ? (
          <label className={styles.field}>
            <span>Color token, optional</span>
            <input
              defaultValue={item.colorToken ?? ""}
              disabled={busy || item.archived}
              maxLength={TAXONOMY_COLOR_TOKEN_MAX}
              name="colorToken"
              pattern={TAXONOMY_COLOR_TOKEN_PATTERN_SOURCE}
            />
          </label>
        ) : null}
        {!item.archived ? (
          <button className={styles.button} disabled={busy} type="submit">
            Save {label.toLowerCase()}
          </button>
        ) : null}
      </form>
      <div
        aria-label={`${item.name} ordering and state actions`}
        className={styles.taxonomyActions}
        role="group"
      >
        {!item.archived ? (
          <>
            <button
              aria-label={`Move ${item.name} up`}
              className={styles.button}
              disabled={busy || activeIndex <= 0}
              onClick={() => void onAction(kind, item, "move_up")}
              type="button"
            >
              Move Up
            </button>
            <button
              aria-label={`Move ${item.name} down`}
              className={styles.button}
              disabled={
                busy ||
                activeIndex < 0 ||
                activeIndex === activeItemCount - 1
              }
              onClick={() => void onAction(kind, item, "move_down")}
              type="button"
            >
              Move Down
            </button>
            {item.canArchive ? (
              <button
                className={styles.button}
                disabled={busy}
                onClick={() => void onAction(kind, item, "archive")}
                type="button"
              >
                Archive
              </button>
            ) : null}
          </>
        ) : item.canDelete ? (
          <button
            className={styles.button}
            disabled={busy}
            onClick={() => void onAction(kind, item, "safe_delete")}
            type="button"
          >
            Safe-delete archived {label.toLowerCase()}
          </button>
        ) : null}
      </div>
      {kind === "lane" && !item.archived && !item.canArchive ? (
        <p className={styles.muted}>
          {blockedLaneArchiveExplanation(item.slug)}
        </p>
      ) : null}
      {item.blockers.length > 0 ? (
        <div className={styles.taxonomyBlockers}>
          <p>
            This {label.toLowerCase()} cannot be safely deleted while these
            established usages remain:
          </p>
          <ul>
            {item.blockers.map((blocker) => (
              <li key={blocker.label}>
                {blocker.label}: {blocker.count}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function parseTaxonomyResponse(value: unknown): TaxonomyWorkspaceDto {
  if (!isRecord(value) || !isRecord(value.workspace)) {
    throw new TypeError("Unexpected taxonomy response.");
  }
  const permissions = value.workspace.permissions;
  if (!isRecord(permissions) || typeof permissions.canManage !== "boolean") {
    throw new TypeError("Unexpected taxonomy permissions.");
  }
  return Object.freeze({
    categories: parseTaxonomyItems(value.workspace.categories),
    lanes: parseTaxonomyItems(value.workspace.lanes),
    permissions: Object.freeze({ canManage: permissions.canManage }),
  });
}

function parseTaxonomyItems(value: unknown): readonly TaxonomyItemDto[] {
  if (!Array.isArray(value) || value.length > TAXONOMY_MAX_ITEMS) {
    throw new TypeError("Unexpected taxonomy items.");
  }
  return Object.freeze(value.map(parseTaxonomyItem));
}

function parseTaxonomyItem(value: unknown): TaxonomyItemDto {
  if (!isRecord(value)) throw new TypeError("Unexpected taxonomy item.");
  const id = boundedString(value.id, 128);
  const name = boundedString(value.name, TAXONOMY_NAME_MAX);
  const slug = boundedString(value.slug, TAXONOMY_SLUG_MAX);
  const description = nullableBoundedString(
    value.description,
    TAXONOMY_DESCRIPTION_MAX,
  );
  const colorToken = nullableBoundedString(
    value.colorToken,
    TAXONOMY_COLOR_TOKEN_MAX,
  );
  const contentVersion = boundedInteger(value.contentVersion, 1, 1_000_000);
  const sortOrder = boundedInteger(
    value.sortOrder,
    0,
    TAXONOMY_SORT_ORDER_MAX,
  );
  if (
    !id ||
    !name ||
    !slug ||
    contentVersion === null ||
    sortOrder === null ||
    typeof value.archived !== "boolean" ||
    typeof value.canArchive !== "boolean" ||
    typeof value.canDelete !== "boolean" ||
    !Array.isArray(value.blockers) ||
    value.blockers.length > 20
  ) {
    throw new TypeError("Unexpected taxonomy item.");
  }
  return Object.freeze({
    archived: value.archived,
    blockers: Object.freeze(value.blockers.map(parseTaxonomyBlocker)),
    canArchive: value.canArchive,
    canDelete: value.canDelete,
    colorToken,
    contentVersion,
    description,
    id,
    name,
    slug,
    sortOrder,
  });
}

function parseTaxonomyBlocker(value: unknown): TaxonomyBlockerDto {
  if (!isRecord(value)) throw new TypeError("Unexpected taxonomy blocker.");
  const count = boundedInteger(value.count, 0, 100_000);
  const label = boundedString(value.label, 120);
  if (count === null || !label) {
    throw new TypeError("Unexpected taxonomy blocker.");
  }
  return Object.freeze({ count, label });
}

function boundedString(value: unknown, maximum: number): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
    ? value
    : null;
}

function nullableBoundedString(
  value: unknown,
  maximum: number,
): string | null {
  return value === null || value === undefined || value === ""
    ? null
    : boundedString(value, maximum);
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

function optionalFormText(data: FormData, name: string): string | null {
  const value = formText(data, name).trim();
  return value.length > 0 ? value : null;
}

function kindLabel(kind: TaxonomyKind): "Category" | "Lane" {
  return kind === "category" ? "Category" : "Lane";
}

function taxonomyActionNotice(
  kind: TaxonomyKind,
  action: TaxonomyAction,
): string {
  const label = kindLabel(kind);
  if (action === "archive") return `${label} archived.`;
  if (action === "safe_delete") return `Unused ${label.toLowerCase()} safely deleted.`;
  return `${label} order updated.`;
}
