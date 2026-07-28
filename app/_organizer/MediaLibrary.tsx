"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { isRecord } from "@/app/_organizer/client";
import styles from "@/app/_organizer/phase6.module.css";

export type MediaAssetView = Readonly<{
  altText: string | null;
  byteSize: number;
  caption: string | null;
  consentStatus: "confirmed" | "not_applicable" | "unconfirmed";
  contentVersion: number;
  createdAt: number;
  credit: string | null;
  failureCode: string | null;
  fileName: string;
  finalizedAt: number | null;
  focalPoint: Readonly<{ x: number; y: number }>;
  height: number | null;
  id: string;
  informative: boolean;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  participantConsentNote: string | null;
  rightsSourceNote: string | null;
  rightsStatus: "approved" | "restricted" | "unconfirmed";
  sha256: string | null;
  uploadState: "deleting" | "failed" | "pending" | "ready";
  updatedAt: number;
  variants: readonly Readonly<{
    byteSize: number;
    height: number;
    kind: "original" | "webp_1600" | "webp_480" | "webp_960";
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    sha256: string;
    width: number;
  }>[];
  width: number | null;
}>;

export type MediaCleanupPendingView = Readonly<{
  assetId: string;
  cleanupVersion: number;
  fileName: string;
  updatedAt: number;
}>;

export function MediaLibrary({
  assets,
  cleanupPending,
}: Readonly<{
  assets: readonly MediaAssetView[];
  cleanupPending: readonly MediaCleanupPendingView[];
}>) {
  const router = useRouter();
  const [pendingCleanups, setPendingCleanups] = useState(cleanupPending);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [cleanupNotice, setCleanupNotice] = useState<string | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);

  async function retryCleanup(item: MediaCleanupPendingView) {
    setRetryingId(item.assetId);
    setCleanupError(null);
    setCleanupNotice(null);
    try {
      const result = await requestMediaCleanup(
        item.assetId,
        item.cleanupVersion,
      );
      if (result.cleanupPending) {
        setCleanupError(
          "Stored-file cleanup is still pending. Nothing is publicly accessible; retry again shortly.",
        );
        return;
      }
      setPendingCleanups((current) =>
        current.filter((entry) => entry.assetId !== item.assetId),
      );
      setCleanupNotice("Stored-file cleanup completed.");
      router.refresh();
    } catch (error) {
      setCleanupError(
        error instanceof Error
          ? error.message
          : "Stored-file cleanup could not be retried.",
      );
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className={styles.noticeStack}>
      <MediaUploadForm />
      {pendingCleanups.length > 0 ? (
        <section
          className={styles.editorPanel}
          aria-labelledby="media-cleanup-heading"
        >
          <div className={styles.splitHeader}>
            <div>
              <p className={styles.kicker}>Private maintenance queue</p>
              <h2 id="media-cleanup-heading">Stored-file cleanup pending</h2>
            </div>
            <p className={styles.muted}>
              {pendingCleanups.length}{" "}
              {pendingCleanups.length === 1 ? "asset" : "assets"}
            </p>
          </div>
          <p>
            These deleted assets are already unavailable to public and private
            selection. Their opaque stored files still need an idempotent
            cleanup retry.
          </p>
          <ul className={styles.usageList}>
            {pendingCleanups.map((item) => (
              <li key={item.assetId}>
                <strong>{item.fileName}</strong>
                <button
                  disabled={retryingId !== null}
                  onClick={() => retryCleanup(item)}
                  type="button"
                >
                  {retryingId === item.assetId
                    ? "Retrying cleanup…"
                    : "Retry stored-file cleanup"}
                </button>
              </li>
            ))}
          </ul>
          {cleanupError ? (
            <p className={styles.errorNotice} role="alert">
              {cleanupError}
            </p>
          ) : null}
          {cleanupNotice ? (
            <p className={styles.successNotice} aria-live="polite">
              {cleanupNotice}
            </p>
          ) : null}
        </section>
      ) : null}
      {assets.length > 0 ? (
        <section aria-labelledby="media-library-heading">
          <div className={styles.splitHeader}>
            <div>
              <p className={styles.kicker}>Private library</p>
              <h2 id="media-library-heading">Stored artwork</h2>
            </div>
            <p className={styles.muted}>
              {assets.length} {assets.length === 1 ? "asset" : "assets"} shown
            </p>
          </div>
          <div className={styles.mediaGrid}>
            {assets.map((asset) => (
              <article className={styles.mediaCard} key={asset.id}>
                {asset.uploadState === "ready" ? (
                  <Image
                    alt={asset.altText ?? ""}
                    height={asset.height ?? 480}
                    src={`/api/organizer/media/${encodeURIComponent(asset.id)}/variants/webp_480`}
                    unoptimized
                    width={asset.width ?? 640}
                  />
                ) : (
                  <div className={styles.emptyState}>
                    {formatState(asset.uploadState)}
                  </div>
                )}
                <div>
                  <p className={styles.stateLine}>
                    <span className={styles.stateBadge}>
                      {formatState(asset.uploadState)}
                    </span>
                    <span>{formatBytes(asset.byteSize)}</span>
                  </p>
                  <h3>{asset.fileName}</h3>
                  <p className={styles.muted}>
                    {asset.width && asset.height
                      ? `${asset.width} × ${asset.height}`
                      : "Dimensions pending"}
                    {" · "}
                    Rights {formatState(asset.rightsStatus)}
                  </p>
                  <div className={styles.actionRow}>
                    <Link href={`/organizer/media/${encodeURIComponent(asset.id)}`}>
                      Review metadata
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <div className={styles.emptyState}>
          <h2>No uploaded artwork yet.</h2>
          <p>
            Existing category artwork remains available. Upload only files
            whose rights and participant consent can be recorded truthfully.
          </p>
        </div>
      )}
    </div>
  );
}

function MediaUploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose one JPEG, PNG, or WebP image.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice("Preparing three responsive WebP variants in this browser…");
    try {
      const formValues = new FormData(form);
      const informative = formValues.get("informative") === "on";
      const metadata = {
        altText: textValue(formValues.get("altText")),
        caption: textValue(formValues.get("caption")),
        consentStatus: formValues.get("consentStatus"),
        credit: textValue(formValues.get("credit")),
        focalPointX: 5_000,
        focalPointY: 5_000,
        informative,
        participantConsentNote: textValue(
          formValues.get("participantConsentNote"),
        ),
        rightsSourceNote: textValue(formValues.get("rightsSourceNote")),
        rightsStatus: formValues.get("rightsStatus"),
      };
      const variants = await browserImageVariants(file);
      const body = new FormData();
      body.set("metadata", JSON.stringify(metadata));
      body.set("original", file, file.name);
      body.set("webp480", variants.webp480, "variant-480.webp");
      body.set("webp960", variants.webp960, "variant-960.webp");
      body.set("webp1600", variants.webp1600, "variant-1600.webp");
      setNotice("Uploading the private original and validated variants…");
      const response = await fetch("/api/organizer/media", {
        body,
        cache: "no-store",
        credentials: "same-origin",
        method: "POST",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          isRecord(payload) &&
          isRecord(payload.error) &&
          typeof payload.error.message === "string"
            ? payload.error.message
            : "The upload could not be completed.";
        throw new Error(message);
      }
      setNotice("Artwork uploaded. Review its metadata before using it.");
      form.reset();
      router.refresh();
    } catch (uploadError) {
      setNotice(null);
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The upload could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.editorPanel} aria-labelledby="upload-heading">
      <div className={styles.splitHeader}>
        <div>
          <p className={styles.kicker}>R2 media</p>
          <h2 id="upload-heading">Add approved artwork</h2>
        </div>
        <p className={styles.muted}>JPEG, PNG, or WebP · up to 8 MiB</p>
      </div>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.uploadDrop}>
          <strong>Original image</strong>
          <span className={styles.helpText}>
            The browser prepares 480, 960, and 1,600 pixel WebP variants. The
            server independently validates every file.
          </span>
          <input
            accept=".jpeg,.jpg,.png,.webp,image/jpeg,image/png,image/webp"
            disabled={busy}
            name="original"
            ref={fileRef}
            required
            type="file"
          />
        </label>
        <div className={styles.fieldGrid}>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Alt text</span>
            <input maxLength={300} name="altText" type="text" />
            <span className={styles.helpText}>
              Describe the information in the image. Decorative artwork can be
              marked non-informative below.
            </span>
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Caption</span>
            <textarea maxLength={1_000} name="caption" />
          </label>
          <label className={styles.field}>
            <span>Credit</span>
            <input maxLength={300} name="credit" type="text" />
          </label>
          <label className={styles.field}>
            <span>Rights status</span>
            <select defaultValue="unconfirmed" name="rightsStatus">
              <option value="unconfirmed">Unconfirmed</option>
              <option value="approved">Approved</option>
              <option value="restricted">Restricted</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Participant consent</span>
            <select defaultValue="unconfirmed" name="consentStatus">
              <option value="unconfirmed">Unconfirmed</option>
              <option value="confirmed">Confirmed</option>
              <option value="not_applicable">Not applicable</option>
            </select>
          </label>
          <label className={styles.checkboxField}>
            <input defaultChecked name="informative" type="checkbox" />
            <span>
              <strong>Informative image</strong>
              <span className={styles.helpText}>
                Informative images require useful alt text before publication.
              </span>
            </span>
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Private rights/source note</span>
            <textarea maxLength={1_000} name="rightsSourceNote" />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Private participant-consent note</span>
            <textarea maxLength={1_000} name="participantConsentNote" />
          </label>
        </div>
        {error ? (
          <p className={styles.errorNotice} role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className={styles.successNotice} aria-live="polite">
            {notice}
          </p>
        ) : null}
        <div className={styles.actionRow}>
          <button data-primary="true" disabled={busy} type="submit">
            {busy ? "Preparing artwork…" : "Upload artwork"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function MediaMetadataEditor({
  asset: initialAsset,
}: Readonly<{ asset: MediaAssetView }>) {
  const router = useRouter();
  const [asset, setAsset] = useState(initialAsset);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<readonly Record<string, unknown>[]>(
    [],
  );
  const [cleanupPendingVersion, setCleanupPendingVersion] = useState<
    number | null
  >(null);
  const previewUrl = useMemo(
    () =>
      `/api/organizer/media/${encodeURIComponent(asset.id)}/variants/webp_960`,
    [asset.id],
  );

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        `/api/organizer/media/${encodeURIComponent(asset.id)}`,
        {
          body: JSON.stringify({
            expectedVersion: asset.contentVersion,
            metadata: {
              altText: textValue(values.get("altText")),
              caption: textValue(values.get("caption")),
              consentStatus: values.get("consentStatus"),
              credit: textValue(values.get("credit")),
              focalPointX: Number(values.get("focalPointX")),
              focalPointY: Number(values.get("focalPointY")),
              informative: values.get("informative") === "on",
              participantConsentNote: textValue(
                values.get("participantConsentNote"),
              ),
              rightsSourceNote: textValue(values.get("rightsSourceNote")),
              rightsStatus: values.get("rightsStatus"),
            },
          }),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          method: "PATCH",
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (response.status === 409 && isRecord(payload)) {
        const values = mediaUsageBlockers(payload);
        if (values.length > 0) {
          setBlockers(values);
          setError(
            "Published content is using this asset. Remove those usages before revoking its public-readiness metadata.",
          );
          return;
        }
      }
      if (!response.ok) {
        throw new Error(mediaResponseMessage(payload, response.status));
      }
      if (!isRecord(payload) || !isMediaAssetView(payload.asset)) {
        throw new Error("The media response was incomplete.");
      }
      setAsset(payload.asset);
      setBlockers([]);
      setNotice("Media metadata saved. Published use remains approval-gated.");
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The media metadata could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !window.confirm(
        "Delete this unused asset and its stored variants? This cannot be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    setBlockers([]);
    try {
      const response = await fetch(
        `/api/organizer/media/${encodeURIComponent(asset.id)}`,
        {
          body: JSON.stringify({ expectedVersion: asset.contentVersion }),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          method: "DELETE",
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (response.status === 409 && isRecord(payload)) {
        const values = Array.isArray(payload.blockers)
          ? payload.blockers.filter(isRecord)
          : [];
        setBlockers(values);
        setError("This asset is still in use and cannot be deleted.");
        return;
      }
      if (!response.ok || !isRecord(payload) || payload.deleted !== true) {
        throw new Error("The asset could not be deleted.");
      }
      const cleanupVersion =
        typeof payload.cleanupVersion === "number" &&
        Number.isSafeInteger(payload.cleanupVersion) &&
        payload.cleanupVersion >= 1
          ? payload.cleanupVersion
          : null;
      if (payload.cleanupPending === true && cleanupVersion !== null) {
        setCleanupPendingVersion(cleanupVersion);
        setNotice(
          "The asset is deleted and inaccessible. Stored-file cleanup still needs a safe retry.",
        );
        return;
      }
      router.push("/organizer/media");
      router.refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "The asset could not be deleted.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function retryCleanup() {
    if (cleanupPendingVersion === null) return;
    setBusy(true);
    setError(null);
    setNotice("Retrying stored-file cleanup…");
    try {
      const result = await requestMediaCleanup(
        asset.id,
        cleanupPendingVersion,
      );
      if (result.cleanupPending) {
        setNotice(null);
        setError(
          "Stored-file cleanup is still pending. Nothing is publicly accessible; retry again shortly.",
        );
        return;
      }
      router.push("/organizer/media");
      router.refresh();
    } catch (cleanupError) {
      setNotice(null);
      setError(
        cleanupError instanceof Error
          ? cleanupError.message
          : "Stored-file cleanup could not be retried.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (cleanupPendingVersion !== null) {
    return (
      <section className={styles.editorPanel} aria-labelledby="cleanup-heading">
        <p className={styles.kicker}>Private maintenance queue</p>
        <h2 id="cleanup-heading">Stored-file cleanup pending</h2>
        <p>
          <strong>{asset.fileName}</strong> is deleted and cannot be selected
          or served. Its opaque stored files still need an idempotent cleanup
          retry.
        </p>
        {error ? (
          <p className={styles.errorNotice} role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className={styles.successNotice} aria-live="polite">
            {notice}
          </p>
        ) : null}
        <div className={styles.actionRow}>
          <button
            data-primary="true"
            disabled={busy}
            onClick={retryCleanup}
            type="button"
          >
            {busy ? "Retrying cleanup…" : "Retry stored-file cleanup"}
          </button>
          <Link href="/organizer/media">Back to media</Link>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.editorPanel} aria-labelledby="media-edit-heading">
      <div className={styles.splitHeader}>
        <div>
          <p className={styles.kicker}>Private media metadata</p>
          <h2 id="media-edit-heading">{asset.fileName}</h2>
          <p className={styles.muted}>
            {asset.width && asset.height
              ? `${asset.width} × ${asset.height}`
              : "Dimensions pending"}
            {" · "}
            {formatBytes(asset.byteSize)}
          </p>
        </div>
        <span className={styles.stateBadge}>
          {formatState(asset.uploadState)}
        </span>
      </div>
      {asset.uploadState === "ready" ? (
        <Image
          alt={asset.altText ?? ""}
          height={asset.height ?? 600}
          src={previewUrl}
          style={{
            aspectRatio: "16 / 10",
            objectFit: "cover",
            objectPosition: `${asset.focalPoint.x / 100}% ${asset.focalPoint.y / 100}%`,
            width: "100%",
          }}
          unoptimized
          width={asset.width ?? 960}
        />
      ) : null}
      <form className={styles.form} onSubmit={save}>
        <div className={styles.fieldGrid}>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Alt text</span>
            <input
              defaultValue={asset.altText ?? ""}
              maxLength={300}
              name="altText"
              type="text"
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Caption</span>
            <textarea
              defaultValue={asset.caption ?? ""}
              maxLength={1_000}
              name="caption"
            />
          </label>
          <label className={styles.field}>
            <span>Credit</span>
            <input
              defaultValue={asset.credit ?? ""}
              maxLength={300}
              name="credit"
              type="text"
            />
          </label>
          <label className={styles.field}>
            <span>Rights status</span>
            <select defaultValue={asset.rightsStatus} name="rightsStatus">
              <option value="unconfirmed">Unconfirmed</option>
              <option value="approved">Approved</option>
              <option value="restricted">Restricted</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Participant consent</span>
            <select defaultValue={asset.consentStatus} name="consentStatus">
              <option value="unconfirmed">Unconfirmed</option>
              <option value="confirmed">Confirmed</option>
              <option value="not_applicable">Not applicable</option>
            </select>
          </label>
          <label className={styles.checkboxField}>
            <input
              defaultChecked={asset.informative}
              name="informative"
              type="checkbox"
            />
            <span>
              <strong>Informative image</strong>
              <span className={styles.helpText}>
                Informative images need useful alt text for public use.
              </span>
            </span>
          </label>
          <label className={styles.field}>
            <span>Horizontal focal point</span>
            <input
              defaultValue={asset.focalPoint.x}
              max={10_000}
              min={0}
              name="focalPointX"
              type="range"
            />
          </label>
          <label className={styles.field}>
            <span>Vertical focal point</span>
            <input
              defaultValue={asset.focalPoint.y}
              max={10_000}
              min={0}
              name="focalPointY"
              type="range"
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Private rights/source note</span>
            <textarea
              defaultValue={asset.rightsSourceNote ?? ""}
              maxLength={1_000}
              name="rightsSourceNote"
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Private participant-consent note</span>
            <textarea
              defaultValue={asset.participantConsentNote ?? ""}
              maxLength={1_000}
              name="participantConsentNote"
            />
          </label>
        </div>
        {error ? (
          <p className={styles.errorNotice} role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className={styles.successNotice} aria-live="polite">
            {notice}
          </p>
        ) : null}
        {blockers.length > 0 ? (
          <div>
            <h3>Current usages</h3>
            <ul className={styles.usageList}>
              {blockers.map((blocker, index) => (
                <li key={`${String(blocker.entityType)}-${String(blocker.entityId)}-${index}`}>
                  {String(blocker.entityType)} · {String(blocker.usageKind)} ·{" "}
                  {String(blocker.publicationScope)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className={styles.actionRow}>
          <button data-primary="true" disabled={busy} type="submit">
            Save metadata
          </button>
          <button disabled={busy} onClick={remove} type="button">
            Delete unused asset
          </button>
          <Link href="/organizer/media">Back to media</Link>
        </div>
      </form>
    </section>
  );
}

async function browserImageVariants(file: File): Promise<Readonly<{
  webp1600: File;
  webp480: File;
  webp960: File;
}>> {
  if (file.size < 1 || file.size > 8 * 1024 * 1024) {
    throw new Error("The original must be no larger than 8 MiB.");
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    if (
      bitmap.width < 1 ||
      bitmap.height < 1 ||
      bitmap.width > 8_000 ||
      bitmap.height > 8_000 ||
      bitmap.width * bitmap.height > 20_000_000
    ) {
      throw new Error("The decoded image dimensions exceed the supported limit.");
    }
    const [webp480, webp960, webp1600] = await Promise.all(
      [480, 960, 1_600].map((width) =>
        renderWebpVariant(bitmap, Math.min(width, bitmap.width)),
      ),
    );
    return Object.freeze({
      webp1600: new File([webp1600], "variant-1600.webp", {
        type: "image/webp",
      }),
      webp480: new File([webp480], "variant-480.webp", {
        type: "image/webp",
      }),
      webp960: new File([webp960], "variant-960.webp", {
        type: "image/webp",
      }),
    });
  } finally {
    bitmap.close();
  }
}

async function renderWebpVariant(
  bitmap: ImageBitmap,
  width: number,
): Promise<Blob> {
  const height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot prepare image variants.");
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.86),
  );
  if (!blob || blob.size < 1) {
    throw new Error("This browser could not create the responsive WebP files.");
  }
  return blob;
}

async function requestMediaCleanup(
  assetId: string,
  expectedVersion: number,
): Promise<Readonly<{ cleanupPending: boolean }>> {
  const response = await fetch(
    `/api/organizer/media/${encodeURIComponent(assetId)}/cleanup`,
    {
      body: JSON.stringify({ expectedVersion }),
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (
    isRecord(payload) &&
    typeof payload.cleanupPending === "boolean" &&
    (response.ok || payload.cleanupPending)
  ) {
    return Object.freeze({ cleanupPending: payload.cleanupPending });
  }
  throw new Error(mediaResponseMessage(payload, response.status));
}

function mediaUsageBlockers(
  payload: Record<string, unknown>,
): readonly Record<string, unknown>[] {
  const source = Array.isArray(payload.blockers)
    ? payload.blockers
    : isRecord(payload.error) && Array.isArray(payload.error.blockers)
      ? payload.error.blockers
      : [];
  return Object.freeze(source.slice(0, 50).filter(isRecord));
}

function mediaResponseMessage(payload: unknown, status: number): string {
  if (
    isRecord(payload) &&
    isRecord(payload.error) &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }
  if (status === 409) {
    return "This media record changed. Refresh and try again.";
  }
  if (status === 403) {
    return "You do not have permission to manage this media.";
  }
  return "The media request could not be completed.";
}

function isMediaAssetView(value: unknown): value is MediaAssetView {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.contentVersion === "number" &&
    typeof value.fileName === "string" &&
    typeof value.uploadState === "string"
  );
}

function textValue(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} bytes`;
}

function formatState(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) =>
    letter.toUpperCase(),
  );
}
