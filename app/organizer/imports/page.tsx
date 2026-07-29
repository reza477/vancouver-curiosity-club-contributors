import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader, StatusPill } from "@/app/_organizer/PageHeader";
import { listCsvImportBatches } from "@/lib/server/phase7/imports";
import { writeSafeLog } from "@/lib/validation/server-observability";
import styles from "@/app/_organizer/imports.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "CSV imports" };

type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function OrganizerImportsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const loaded = await loadOrganizerPageContext("/organizer/imports");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  if (loaded.context.membership.role === "organizer") forbidden();
  const params = await searchParams;

  let history: Awaited<ReturnType<typeof listCsvImportBatches>>;
  try {
    history = await listCsvImportBatches(
      loaded.context.database,
      loaded.context.identity,
      {
        actorProfileId: optionalScalar(params.actorProfileId),
        cursor: optionalScalar(params.cursor),
        limit: integerQuery(scalar(params.limit)),
        phase: optionalScalar(params.phase),
        sourceNamespace: optionalScalar(params.sourceNamespace),
      },
    );
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/imports",
      status: 500,
    });
    return (
      <>
        <Header />
        <OrganizerPageState
          detail="No import metadata or row results are being shown."
          heading="Import history is temporarily unavailable."
          tone="error"
        />
      </>
    );
  }

  return (
    <>
      <Header />
      <section className={styles.card} aria-labelledby="import-safety-title">
        <div>
          <h2 id="import-safety-title">Private preview, then explicit approval</h2>
          <p>
            Uploading creates only import metadata and normalized preview rows.
            Events, revisions, source links, and conflict records remain
            unchanged until an authorized approval and bounded application
            request succeeds.
          </p>
        </div>
        <div className={styles.introGrid}>
          <p>
            Imports never publish events. Every created record remains private
            and still uses the normal publishing workflow.
          </p>
          <p>
            Application is resumable and idempotent. Closing the browser does
            not erase completed row results.
          </p>
        </div>
      </section>
      <form className={styles.historyFilters} method="get">
        <label className={styles.field}>
          <span>Phase</span>
          <select defaultValue={scalar(params.phase) ?? ""} name="phase">
            <option value="">All phases</option>
            {IMPORT_HISTORY_PHASES.map((phase) => (
              <option key={phase} value={phase}>
                {humanize(phase)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Source namespace</span>
          <input
            defaultValue={scalar(params.sourceNamespace) ?? ""}
            maxLength={64}
            name="sourceNamespace"
          />
        </label>
        <label className={styles.field}>
          <span>Rows per page</span>
          <select defaultValue={scalar(params.limit) ?? "25"} name="limit">
            {[10, 25, 50, 100].map((limit) => (
              <option key={limit} value={limit}>
                {limit}
              </option>
            ))}
          </select>
        </label>
        {scalar(params.actorProfileId) ? (
          <input
            name="actorProfileId"
            type="hidden"
            value={scalar(params.actorProfileId) ?? ""}
          />
        ) : null}
        <div className={styles.actions}>
          <button type="submit">Apply filters</button>
          <Link className={styles.secondary} href="/organizer/imports">
            Clear filters
          </Link>
        </div>
      </form>
      <div className={styles.historyResultBar}>
        <p aria-live="polite">
          {history.total.toLocaleString("en-CA")} import batch
          {history.total === 1 ? "" : "es"}
          {history.items.length
            ? ` · showing ${history.items.length} on this page`
            : ""}
        </p>
      </div>
      {history.items.length ? (
        <ol className={styles.historyList}>
          {history.items.map((batch) => (
            <li key={batch.batchId}>
              <Link
                href={`/organizer/imports/${encodeURIComponent(batch.batchId)}`}
              >
                <strong>
                  {batch.sourceLabel ?? batch.sourceNamespace}
                </strong>
                <div className={styles.historyMeta}>
                  <span>Batch {batch.batchId}</span>
                  <span>Actor {batch.actorDisplayName}</span>
                  <span>{formatDateTime(batch.createdAt)}</span>
                  <span>
                    Template v{batch.templateVersion} · parser v
                    {batch.parserVersion}
                  </span>
                  <span>{batch.totalRowCount} rows</span>
                  <span>{batch.validRowCount} valid</span>
                  <span>{batch.invalidRowCount} invalid</span>
                  <span>{batch.warningRowCount} warnings</span>
                  <span>{batch.selectedRowCount} selected</span>
                  <span>{batch.importedRowCount} imported</span>
                  <span>{batch.skippedRowCount} skipped</span>
                  <span>{batch.failedRowCount} failed</span>
                  <span>{batch.pendingRowCount} pending</span>
                </div>
                <small>
                  Source namespace {batch.sourceNamespace} · SHA-256{" "}
                  {batch.fileSha256} · mapping {batch.mappingFingerprint}
                </small>
                <small>
                  Approved {formatOptionalDateTime(batch.approvedAt)} · started{" "}
                  {formatOptionalDateTime(batch.startedAt)} · completed{" "}
                  {formatOptionalDateTime(batch.completedAt)}
                </small>
                <span>
                  <StatusPill tone={phaseTone(batch.phase)}>
                    {humanize(batch.phase)}
                  </StatusPill>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <OrganizerPageState
          action={{
            href: "/organizer/imports/new",
            label: "Start a CSV preview",
          }}
          detail="Download the versioned template or inspect a local UTF-8 CSV. No event is created during preview."
          heading="No CSV import history yet."
          tone="quiet"
        />
      )}
      {history.nextCursor || scalar(params.cursor) ? (
        <nav aria-label="Import history pages" className={styles.actions}>
          {scalar(params.cursor) ? (
            <Link href={historyHref(params, null)}>Start of history</Link>
          ) : null}
          {history.hasMore && history.nextCursor ? (
            <Link
              className={styles.secondary}
              href={historyHref(params, history.nextCursor)}
            >
              Older import batches
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

const IMPORT_HISTORY_PHASES = Object.freeze([
  "uploaded",
  "previewed",
  "approved",
  "applying",
  "interrupted",
  "completed",
  "completed_with_errors",
  "failed",
  "redacted",
]);

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalScalar(
  value: string | string[] | undefined,
): string | undefined {
  const parsed = scalar(value);
  return parsed ? parsed : undefined;
}

function integerQuery(value: string | undefined): number | string | undefined {
  if (value === undefined || value === "") return undefined;
  return /^\d+$/u.test(value) ? Number(value) : value;
}

function historyHref(
  source: Record<string, string | string[] | undefined>,
  cursor: string | null,
): string {
  const query = new URLSearchParams();
  for (const key of [
    "actorProfileId",
    "limit",
    "phase",
    "sourceNamespace",
  ]) {
    const value = scalar(source[key]);
    if (value) query.set(key, value);
  }
  if (cursor) query.set("cursor", cursor);
  const encoded = query.toString();
  return encoded ? `/organizer/imports?${encoded}` : "/organizer/imports";
}

function Header() {
  return (
    <PageHeader
      action={{
        href: "/organizer/imports/new",
        label: "New CSV preview",
      }}
      eyebrow="Phase 7 · resumable private workflow"
      introduction="Map, validate, preview, approve, and apply private event rows with durable per-row outcomes and the authoritative scheduling conflict service."
      title="CSV imports"
    />
  );
}

function AccessChanged() {
  return (
    <OrganizerPageState
      detail="Only a current Owner or Administrator can access event imports."
      heading="Import access is unavailable."
      tone="error"
    />
  );
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Vancouver",
  }).format(new Date(value));
}

function formatOptionalDateTime(value: number | null): string {
  return value === null ? "not yet" : formatDateTime(value);
}

function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./u, (letter) => letter.toUpperCase());
}

function phaseTone(
  phase: string,
): "amber" | "blue" | "green" | "neutral" {
  if (phase === "completed") return "green";
  if (phase === "completed_with_errors" || phase === "failed") return "amber";
  if (phase === "approved" || phase === "applying") return "blue";
  return "neutral";
}
