"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  isRecord,
  organizerRequest,
  safeNotice,
} from "@/app/_organizer/client";
import type { CmsMediaOption } from "@/app/_organizer/ClubContentEditor";
import styles from "@/app/_organizer/phase6.module.css";
import type { CmsEntityWorkspaceDto } from "@/lib/server/organizer/cms";
import type {
  CmsLegalStatusSnapshot,
  CmsSiteIdentitySnapshot,
} from "@/lib/server/organizer/cms-validation";

export function SiteIdentityEditor({
  initialWorkspace,
  media,
}: Readonly<{
  initialWorkspace: CmsEntityWorkspaceDto;
  media: readonly CmsMediaOption[];
}>) {
  const router = useRouter();
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [snapshot, setSnapshot] = useState(siteSnapshot(initialWorkspace));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = "/api/organizer/content/site_identity/site_identity";

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
      setSnapshot(siteSnapshot(result.entity));
      setNotice(success);
      router.refresh();
      window.setTimeout(() => noticeRef.current?.focus(), 0);
    } catch (caught) {
      setError(safeNotice(caught, "Site identity could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate(path, "PATCH", {
      expectedContentVersion: workspace.entity.contentVersion,
      snapshot,
    }, "Brand and SEO defaults saved as a private draft.");
  }

  async function publish() {
    if (
      !window.confirm(
        "Publish these brand, footer, and SEO defaults?",
      )
    ) {
      return;
    }
    await mutate(`${path}/publish`, "POST", {
      expectedContentVersion: workspace.entity.contentVersion,
    }, "Site identity published.");
  }

  async function restore(revisionId: string) {
    if (
      !workspace.permissions.canRestore ||
      !window.confirm("Restore this site-identity revision as a new draft?")
    ) {
      return;
    }
    await mutate(`${path}/restore`, "POST", {
      expectedContentVersion: workspace.entity.contentVersion,
      revisionId,
    }, "Site identity history restored as a new private draft.");
  }

  return (
    <section className={styles.editorPanel} id="site_identity">
      <div className={styles.splitHeader}>
        <div>
          <p className={styles.kicker}>Constrained Field Notes settings</p>
          <h2>Brand, footer, and SEO defaults</h2>
          <p className={styles.helpText}>
            Only vetted typography and contrast-checked hex colors can publish.
            Logo and social-card choices must be approved media.
          </p>
        </div>
        <div className={styles.toolbar}>
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
            <button disabled={busy} onClick={publish} type="button">
              Publish
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p className={styles.errorNotice} role="alert">{error}</p> : null}
      {notice ? (
        <p className={styles.successNotice} ref={noticeRef} role="status" tabIndex={-1}>
          {notice}
        </p>
      ) : null}
      <form className={styles.form} onSubmit={save}>
        <div className={styles.fieldGrid}>
          <Field label="Public brand name">
            <input
              maxLength={120}
              onChange={(event) => setSnapshot({ ...snapshot, brandName: event.target.value })}
              required
              value={snapshot.brandName}
            />
          </Field>
          <Field label="Location label">
            <input
              maxLength={120}
              onChange={(event) => setSnapshot({ ...snapshot, locationLabel: event.target.value })}
              required
              value={snapshot.locationLabel}
            />
          </Field>
          <div className={`${styles.field} ${styles.fieldWide}`}>
            <span>Institutional facts</span>
            <p className={styles.helpText}>
              These values stay private unless the matching public-display
              confirmation is checked. Totals also require an as-of date.
              Legal name and registration fields remain in the owner-confirmed
              Legal Status section below.
            </p>
          </div>
          <Field label="Founding year">
            <input
              max={9999}
              min={1800}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  institutionalFacts: {
                    ...snapshot.institutionalFacts,
                    foundedYear: event.target.value
                      ? Number.parseInt(event.target.value, 10)
                      : null,
                  },
                })
              }
              type="number"
              value={snapshot.institutionalFacts.foundedYear ?? ""}
            />
          </Field>
          <label className={styles.checkboxField}>
            <input
              checked={snapshot.institutionalFacts.foundedYearConfirmed}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  institutionalFacts: {
                    ...snapshot.institutionalFacts,
                    foundedYearConfirmed: event.target.checked,
                  },
                })
              }
              type="checkbox"
            />
            <span>Founding year verified for public display</span>
          </label>
          <Field label="Attendance total">
            <input
              max={100000000}
              min={0}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  institutionalFacts: {
                    ...snapshot.institutionalFacts,
                    attendanceTotal: event.target.value
                      ? Number.parseInt(event.target.value, 10)
                      : null,
                  },
                })
              }
              type="number"
              value={snapshot.institutionalFacts.attendanceTotal ?? ""}
            />
          </Field>
          <Field label="Attendance total as of">
            <input
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  institutionalFacts: {
                    ...snapshot.institutionalFacts,
                    attendanceTotalAsOf: event.target.value || null,
                  },
                })
              }
              type="date"
              value={snapshot.institutionalFacts.attendanceTotalAsOf ?? ""}
            />
          </Field>
          <label className={styles.checkboxField}>
            <input
              checked={snapshot.institutionalFacts.attendanceTotalConfirmed}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  institutionalFacts: {
                    ...snapshot.institutionalFacts,
                    attendanceTotalConfirmed: event.target.checked,
                  },
                })
              }
              type="checkbox"
            />
            <span>Attendance total verified for public display</span>
          </label>
          <Field label="Member total">
            <input
              max={100000000}
              min={0}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  institutionalFacts: {
                    ...snapshot.institutionalFacts,
                    memberTotal: event.target.value
                      ? Number.parseInt(event.target.value, 10)
                      : null,
                  },
                })
              }
              type="number"
              value={snapshot.institutionalFacts.memberTotal ?? ""}
            />
          </Field>
          <Field label="Member total as of">
            <input
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  institutionalFacts: {
                    ...snapshot.institutionalFacts,
                    memberTotalAsOf: event.target.value || null,
                  },
                })
              }
              type="date"
              value={snapshot.institutionalFacts.memberTotalAsOf ?? ""}
            />
          </Field>
          <label className={styles.checkboxField}>
            <input
              checked={snapshot.institutionalFacts.memberTotalConfirmed}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  institutionalFacts: {
                    ...snapshot.institutionalFacts,
                    memberTotalConfirmed: event.target.checked,
                  },
                })
              }
              type="checkbox"
            />
            <span>Member total verified for public display</span>
          </label>
          <Field label="Tagline" wide>
            <input
              maxLength={160}
              onChange={(event) => setSnapshot({ ...snapshot, tagline: event.target.value })}
              required
              value={snapshot.tagline}
            />
          </Field>
          <Field label="Mission" wide>
            <textarea
              maxLength={500}
              onChange={(event) => setSnapshot({ ...snapshot, mission: event.target.value })}
              required
              value={snapshot.mission}
            />
          </Field>
          <Field label="Footer mission" wide>
            <textarea
              maxLength={300}
              onChange={(event) => setSnapshot({ ...snapshot, footerMission: event.target.value })}
              required
              value={snapshot.footerMission}
            />
          </Field>
          <Field label="Default SEO title">
            <input
              maxLength={60}
              onChange={(event) => setSnapshot({ ...snapshot, seoTitle: event.target.value })}
              required
              value={snapshot.seoTitle}
            />
          </Field>
          <Field label="Default meta description">
            <textarea
              maxLength={160}
              onChange={(event) => setSnapshot({ ...snapshot, metaDescription: event.target.value })}
              required
              value={snapshot.metaDescription}
            />
          </Field>
          <Field label="Typography">
            <select
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  typography: event.target.value as CmsSiteIdentitySnapshot["typography"],
                })
              }
              value={snapshot.typography}
            >
              <option value="editorial">Field Notes editorial</option>
              <option value="humanist">Humanist system</option>
              <option value="system">System</option>
            </select>
          </Field>
          <Field label="Logo">
            <MediaSelect
              media={media}
              onChange={(logoAssetId) => setSnapshot({ ...snapshot, logoAssetId })}
              value={snapshot.logoAssetId}
            />
          </Field>
          <Field label="Open Graph image">
            <MediaSelect
              media={media}
              onChange={(openGraphAssetId) =>
                setSnapshot({ ...snapshot, openGraphAssetId })
              }
              value={snapshot.openGraphAssetId}
            />
          </Field>
          {(["background", "foreground", "accent", "secondary"] as const).map(
            (key) => (
              <Field key={key} label={`${titleCase(key)} color`}>
                <input
                  onChange={(event) =>
                    setSnapshot({
                      ...snapshot,
                      palette: { ...snapshot.palette, [key]: event.target.value },
                    })
                  }
                  pattern="#[0-9A-Fa-f]{6}"
                  required
                  value={snapshot.palette[key]}
                />
              </Field>
            ),
          )}
        </div>
        <button className={styles.buttonPrimary} disabled={busy} type="submit">
          Save Draft
        </button>
      </form>
      <SettingsRevisionHistory
        busy={busy}
        headingId="site-identity-history"
        onRestore={restore}
        workspace={workspace}
      />
    </section>
  );
}

export function LegalStatusEditor({
  initialWorkspace,
  isOwner,
}: Readonly<{
  initialWorkspace: CmsEntityWorkspaceDto;
  isOwner: boolean;
}>) {
  const router = useRouter();
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [snapshot, setSnapshot] = useState(legalSnapshot(initialWorkspace));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = "/api/organizer/content/legal_status/legal_status";

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
      setSnapshot(legalSnapshot(result.entity));
      setNotice(success);
      router.refresh();
      window.setTimeout(() => noticeRef.current?.focus(), 0);
    } catch (caught) {
      setError(safeNotice(caught, "Legal-status content could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate(path, "PATCH", {
      expectedContentVersion: workspace.entity.contentVersion,
      snapshot,
    }, "Legal-status wording saved as an unconfirmed private draft.");
  }

  async function ownerAction(
    action: "confirm" | "publish" | "revoke" | "unpublish",
  ) {
    if (!isOwner) return;
    const url =
      action === "confirm" || action === "revoke"
        ? `/api/organizer/content/legal/${action}`
        : `${path}/${action}`;
    if (
      !window.confirm(
        action === "confirm"
          ? "Confirm this exact legal revision as Owner?"
          : action === "publish"
            ? "Publish the exact Owner-confirmed legal wording?"
            : action === "revoke"
              ? "Revoke the current legal confirmation?"
              : "Unpublish legal wording while preserving its history?",
      )
    ) {
      return;
    }
    await mutate(url, "POST", {
      expectedContentVersion: workspace.entity.contentVersion,
    }, `Legal status ${action === "confirm" ? "confirmed" : `${action}ed`}.`);
  }

  async function restore(revisionId: string) {
    if (
      !workspace.permissions.canRestore ||
      !window.confirm(
        "Restore this legal-status revision as a new unconfirmed draft?",
      )
    ) {
      return;
    }
    await mutate(`${path}/restore`, "POST", {
      expectedContentVersion: workspace.entity.contentVersion,
      revisionId,
    }, "Legal-status history restored as a new unconfirmed private draft.");
  }

  return (
    <section className={styles.editorPanel} id="legal_status">
      <div className={styles.splitHeader}>
        <div>
          <p className={styles.kicker}>Separate factual confirmation</p>
          <h2>Legal-status wording</h2>
          <p className={styles.helpText}>
            Administrators may prepare a private draft. Only the Owner may
            confirm its exact hash, revoke confirmation, publish, or unpublish.
            Provincial status and CRA charity status remain separate.
          </p>
        </div>
        <div className={styles.toolbar}>
          {workspace.revision ? (
            <Link
              href={`/organizer/content/revisions/${encodeURIComponent(workspace.revision.id)}`}
            >
              Preview
            </Link>
          ) : null}
          {isOwner ? (
            <>
              {workspace.permissions.canConfirmLegal ? (
                <button disabled={busy} onClick={() => ownerAction("confirm")} type="button">
                  Confirm Exact Revision
                </button>
              ) : null}
              {workspace.permissions.canPublish ? (
                <button disabled={busy} onClick={() => ownerAction("publish")} type="button">
                  Publish
                </button>
              ) : null}
              {workspace.permissions.canRevokeLegal ? (
                <button disabled={busy} onClick={() => ownerAction("revoke")} type="button">
                  Revoke Confirmation
                </button>
              ) : null}
              {workspace.permissions.canUnpublish ? (
                <button disabled={busy} onClick={() => ownerAction("unpublish")} type="button">
                  Unpublish
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      {!isOwner ? (
        <p className={styles.notice}>
          Administrator access is limited to reading and preparing this private
          draft. No confirmation or public legal action is available.
        </p>
      ) : null}
      {error ? <p className={styles.errorNotice} role="alert">{error}</p> : null}
      {notice ? (
        <p className={styles.successNotice} ref={noticeRef} role="status" tabIndex={-1}>
          {notice}
        </p>
      ) : null}
      <form className={styles.form} onSubmit={save}>
        <div className={styles.fieldGrid}>
          <OptionalField
            label="Exact legal name"
            maxLength={240}
            onChange={(legalName) => setSnapshot({ ...snapshot, legalName })}
            value={snapshot.legalName}
          />
          <OptionalField
            label="Jurisdiction"
            maxLength={120}
            onChange={(jurisdiction) => setSnapshot({ ...snapshot, jurisdiction })}
            value={snapshot.jurisdiction}
          />
          <OptionalField
            label="Exact legal form or status wording"
            maxLength={240}
            onChange={(legalFormWording) =>
              setSnapshot({ ...snapshot, legalFormWording })
            }
            value={snapshot.legalFormWording}
          />
          <OptionalField
            label="Registration or incorporation number"
            maxLength={120}
            onChange={(registrationNumber) =>
              setSnapshot({ ...snapshot, registrationNumber })
            }
            value={snapshot.registrationNumber}
          />
          <Field label="Effective date">
            <input
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  effectiveDate: event.target.value,
                })
              }
              type="date"
              value={snapshot.effectiveDate ?? ""}
            />
          </Field>
          <Field label="CRA charity status">
            <select
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  charityStatus: event.target
                    .value as CmsLegalStatusSnapshot["charityStatus"],
                  charityNumber:
                    event.target.value === "registered"
                      ? snapshot.charityNumber
                      : null,
                })
              }
              value={snapshot.charityStatus}
            >
              <option value="unconfirmed">Unconfirmed</option>
              <option value="confirmed_not_registered">
                Owner confirmed not registered
              </option>
              <option value="registered">Registered charity</option>
            </select>
          </Field>
          {snapshot.charityStatus === "registered" ? (
            <OptionalField
              label="Exact CRA charity number"
              maxLength={120}
              onChange={(charityNumber) => setSnapshot({ ...snapshot, charityNumber })}
              value={snapshot.charityNumber}
            />
          ) : null}
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Owner-approved footer wording</span>
            <textarea
              maxLength={500}
              onChange={(event) =>
                setSnapshot({
                  ...snapshot,
                  footerWording: event.target.value,
                })
              }
              value={snapshot.footerWording ?? ""}
            />
          </label>
        </div>
        {workspace.permissions.canEdit ? (
          <button className={styles.buttonPrimary} disabled={busy} type="submit">
            Save Private Draft
          </button>
        ) : null}
      </form>
      <SettingsRevisionHistory
        busy={busy}
        headingId="legal-status-history"
        onRestore={restore}
        workspace={workspace}
      />
    </section>
  );
}

function SettingsRevisionHistory({
  busy,
  headingId,
  onRestore,
  workspace,
}: Readonly<{
  busy: boolean;
  headingId: string;
  onRestore: (revisionId: string) => void;
  workspace: CmsEntityWorkspaceDto;
}>) {
  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <h2 id={headingId}>Revision history</h2>
      <div className={styles.revisionGrid}>
        {workspace.revisions.map((revision) => (
          <article className={styles.entityCard} key={revision.id}>
            <div>
              <h3>Revision {revision.revisionNumber}</h3>
              <p className={styles.muted}>{revision.actorDisplayName}</p>
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

function OptionalField({
  label,
  maxLength,
  onChange,
  value,
}: Readonly<{
  label: string;
  maxLength: number;
  onChange: (value: string) => void;
  value: string | null;
}>) {
  return (
    <Field label={label}>
      <input
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        value={value ?? ""}
      />
    </Field>
  );
}

function MediaSelect({
  media,
  onChange,
  value,
}: Readonly<{
  media: readonly CmsMediaOption[];
  onChange: (value: string | null) => void;
  value: string | null;
}>) {
  return (
    <select
      onChange={(event) => onChange(emptyToNull(event.target.value))}
      value={value ?? ""}
    >
      <option value="">Use the original local Field Notes asset</option>
      {media.map((asset) => (
        <option key={asset.id} value={asset.id}>
          {asset.label}
        </option>
      ))}
    </select>
  );
}

function siteSnapshot(
  workspace: CmsEntityWorkspaceDto,
): CmsSiteIdentitySnapshot {
  if (
    workspace.entity.entityType !== "site_identity" ||
    !workspace.revision ||
    !isRecord(workspace.revision.snapshot)
  ) {
    throw new Error("The site-identity revision is unavailable.");
  }
  return workspace.revision.snapshot as CmsSiteIdentitySnapshot;
}

function legalSnapshot(
  workspace: CmsEntityWorkspaceDto,
): CmsLegalStatusSnapshot {
  if (
    workspace.entity.entityType !== "legal_status" ||
    !workspace.revision ||
    !isRecord(workspace.revision.snapshot)
  ) {
    throw new Error("The legal-status revision is unavailable.");
  }
  return workspace.revision.snapshot as CmsLegalStatusSnapshot;
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

function titleCase(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
