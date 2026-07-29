"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CSV_IMPORT_CANONICAL_COLUMNS,
  CSV_IMPORT_IGNORE,
  CSV_IMPORT_MAX_FILE_BYTES,
  type CsvImportHeaderSelection,
} from "@/lib/imports/csv";
import {
  OrganizerRequestError,
  isRecord,
  safeNotice,
} from "./client";
import { parseCsvImportWorkspace } from "./csv-import-dto";
import styles from "./imports.module.css";

type CsvInspection = Readonly<{
  fileSha256: string;
  headers: readonly string[];
  inspectionBatchId: string;
  nonblankRowCount: number;
  selections: readonly CsvImportHeaderSelection[];
}>;

export function CsvImportUploadWorkspace() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const mappingHeading = useRef<HTMLHeadingElement>(null);
  const noticeSummary = useRef<HTMLParagraphElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceNamespace, setSourceNamespace] = useState("");
  const [inspection, setInspection] = useState<CsvInspection | null>(null);
  const [selections, setSelections] = useState<
    readonly CsvImportHeaderSelection[]
  >([]);
  const [busy, setBusy] = useState<"inspect" | "preview" | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (inspection) mappingHeading.current?.focus();
  }, [inspection]);

  function chooseFile(next: File | null) {
    setFile(next);
    setInspection(null);
    setSelections([]);
    setNotice("");
  }

  async function inspect() {
    if (!file || busy) return;
    setBusy("inspect");
    setNotice("");
    try {
      const body = baseFormData(file, sourceLabel, sourceNamespace);
      const value = await multipartRequest(
        "/api/organizer/imports/inspect",
        body,
      );
      const next = parseInspection(value);
      setInspection(next);
      setSelections(next.selections);
      setNotice(
        `${next.headers.length} columns and ${next.nonblankRowCount} nonblank rows inspected. Confirm the mapping before preview.`,
      );
    } catch (error) {
      setNotice(safeNotice(error, "The CSV could not be inspected."));
      requestAnimationFrame(() => noticeSummary.current?.focus());
    } finally {
      setBusy(null);
    }
  }

  async function createPreview() {
    if (!file || !inspection || busy) return;
    setBusy("preview");
    setNotice("");
    try {
      const body = baseFormData(file, sourceLabel, sourceNamespace);
      body.set("headerSelections", JSON.stringify(selections));
      body.set("inspectionBatchId", inspection.inspectionBatchId);
      const value = await multipartRequest("/api/organizer/imports", body);
      if (!isRecord(value)) throw new TypeError("Unexpected import response");
      const batch = parseCsvImportWorkspace(value.batch);
      router.push(
        `/organizer/imports/${encodeURIComponent(batch.batch.batchId)}`,
      );
      router.refresh();
    } catch (error) {
      setNotice(
        safeNotice(error, "The non-authoritative preview could not be saved."),
      );
      requestAnimationFrame(() => noticeSummary.current?.focus());
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.stack}>
      <section className={styles.card} aria-labelledby="csv-source-title">
        <div>
          <h2 id="csv-source-title">1. Choose a local CSV</h2>
          <p>
            UTF-8 CSV only, up to 2 MiB and 2,000 nonblank rows. The original
            file is not retained. Remote URLs, spreadsheets, archives, JSON,
            XML, HTML, and ICS files are rejected.
          </p>
        </div>
        <div className={styles.fields}>
          <label className={`${styles.field} ${styles.fieldFull}`}>
            <span>CSV file</span>
            <input
              accept=".csv,text/csv"
              onChange={(event) =>
                chooseFile(event.currentTarget.files?.[0] ?? null)
              }
              ref={fileInput}
              required
              type="file"
            />
            <small>
              {file
                ? `${file.name} · ${formatBytes(file.size)}`
                : "No file selected."}
            </small>
          </label>
          <label className={styles.field}>
            <span>Source namespace</span>
            <input
              autoComplete="off"
              maxLength={64}
              onChange={(event) =>
                setSourceNamespace(event.currentTarget.value)
              }
              placeholder="Example: board-planning-july"
              required
              value={sourceNamespace}
            />
            <small>
              A stable bounded namespace makes external IDs safe across
              batches.
            </small>
          </label>
          <label className={styles.field}>
            <span>Source label (optional)</span>
            <input
              autoComplete="off"
              maxLength={160}
              onChange={(event) => setSourceLabel(event.currentTarget.value)}
              placeholder="Human-readable history label"
              value={sourceLabel}
            />
          </label>
        </div>
        <div className={styles.actions}>
          <button
            disabled={
              !file ||
              file.size > CSV_IMPORT_MAX_FILE_BYTES ||
              !sourceNamespace.trim() ||
              busy !== null
            }
            onClick={inspect}
            type="button"
          >
            {busy === "inspect" ? "Inspecting CSV..." : "Inspect headers"}
          </button>
          <a href="/templates/vcc-event-import-v1.csv" download>
            Download CSV template
          </a>
          <a
            href="/templates/vcc-event-import-v1-field-guide.txt"
            download
          >
            Download field guide
          </a>
        </div>
      </section>

      {inspection ? (
        <section className={styles.card} aria-labelledby="csv-mapping-title">
          <div>
            <h2
              id="csv-mapping-title"
              ref={mappingHeading}
              tabIndex={-1}
            >
              2. Confirm the column mapping
            </h2>
            <p>
              Exact official headers map automatically. Choose Ignore for
              unused columns. Required fields and duplicate mappings are
              revalidated on the server.
            </p>
          </div>
          <div className={styles.fields}>
            {inspection.headers.map((header, index) => (
              <label className={styles.field} key={`${index}:${header}`}>
                <span>{header}</span>
                <select
                  aria-label={`Map ${header}`}
                  onChange={(event) => {
                    const next = [...selections];
                    next[index] = event.currentTarget
                      .value as CsvImportHeaderSelection;
                    setSelections(Object.freeze(next));
                  }}
                  value={selections[index] ?? CSV_IMPORT_IGNORE}
                >
                  <option value={CSV_IMPORT_IGNORE}>Ignore</option>
                  {CSV_IMPORT_CANONICAL_COLUMNS.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className={styles.actions}>
            <button
              disabled={busy !== null}
              onClick={createPreview}
              type="button"
            >
              {busy === "preview"
                ? "Saving preview..."
                : "Create non-authoritative preview"}
            </button>
          </div>
        </section>
      ) : null}

      <p
        aria-live="polite"
        className={styles.notice}
        ref={noticeSummary}
        role="status"
        tabIndex={-1}
      >
        {notice}
      </p>
    </div>
  );
}

function baseFormData(
  file: File,
  sourceLabel: string,
  sourceNamespace: string,
): FormData {
  const body = new FormData();
  body.set("file", file);
  body.set("sourceLabel", sourceLabel);
  body.set("sourceNamespace", sourceNamespace);
  return body;
}

async function multipartRequest(
  path: string,
  body: FormData,
): Promise<unknown> {
  const response = await fetch(path, {
    body,
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    method: "POST",
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(value) && isRecord(value.error)
      ? value.error
      : null;
    throw new OrganizerRequestError(
      error && typeof error.code === "string"
        ? error.code
        : "request_failed",
      error && typeof error.message === "string"
        ? error.message
        : "The CSV request could not be completed.",
      response.status,
    );
  }
  return value;
}

function parseInspection(value: unknown): CsvInspection {
  if (!isRecord(value)) throw new TypeError("Unexpected inspection response");
  if (
    !Array.isArray(value.headers) ||
    !value.headers.every((item) => typeof item === "string") ||
    typeof value.nonblankRowCount !== "number" ||
    !Number.isSafeInteger(value.nonblankRowCount) ||
    value.nonblankRowCount < 0 ||
    typeof value.inspectionBatchId !== "string" ||
    !value.inspectionBatchId.startsWith("import-batch:") ||
    typeof value.fileSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.fileSha256) ||
    !Array.isArray(value.selections) ||
    value.selections.length !== value.headers.length ||
    !value.selections.every(
      (item) =>
        item === null ||
        item === CSV_IMPORT_IGNORE ||
        CSV_IMPORT_CANONICAL_COLUMNS.some((column) => column === item),
    )
  ) {
    throw new TypeError("Unexpected inspection response");
  }
  return Object.freeze({
    fileSha256: value.fileSha256,
    headers: Object.freeze([...value.headers]) as readonly string[],
    inspectionBatchId: value.inspectionBatchId,
    nonblankRowCount: value.nonblankRowCount,
    selections: Object.freeze([
      ...value.selections,
    ]) as readonly CsvImportHeaderSelection[],
  });
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} bytes`;
  return `${(value / 1_024).toFixed(1)} KiB`;
}
