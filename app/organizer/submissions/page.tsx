import type { Metadata } from "next";
import Link from "next/link";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader, StatusPill } from "@/app/_organizer/PageHeader";
import {
  PUBLIC_FORM_KEYS,
  publicFormLabel,
} from "@/lib/server/phase7/public-form-contract";
import {
  SUBMISSION_STATUSES,
  listFormSubmissions,
} from "@/lib/server/phase7/submissions";
import { writeSafeLog } from "@/lib/validation/server-observability";
import styles from "@/app/_organizer/workspace.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Submissions" };

type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function OrganizerSubmissionsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const loaded = await loadOrganizerPageContext("/organizer/submissions");
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;
  const params = await searchParams;
  let page: Awaited<ReturnType<typeof listFormSubmissions>> | null = null;
  try {
    page = await listFormSubmissions(
      loaded.context.database,
      loaded.context.identity,
      {
        assignment: scalar(params.assignment),
        fromDate: scalar(params.from),
        formKey: scalar(params.form),
        page: scalar(params.page),
        search: scalar(params.q),
        status: scalar(params.status),
        toDate: scalar(params.to),
      },
    );
  } catch {
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/submissions",
      status: 500,
    });
  }
  if (!page) {
    return (
      <>
        <PageHeader
          eyebrow="Private inbox"
          introduction="No submission content is being guessed."
          title="Submissions"
        />
        <OrganizerPageState
          detail="The private submissions inbox could not be loaded. Refresh to try again."
          heading="Submissions temporarily unavailable."
          tone="error"
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        eyebrow="Private inbox"
        introduction={
          loaded.context.membership.role === "organizer"
            ? "Only submissions currently assigned to you are visible. Notes and status changes are private."
            : "Review, assign, and record manual follow-up. New legitimate submissions are also queued for a private organizer email copy; this inbox remains the durable record."
        }
        title="Submissions"
      />
      <form className={styles.calendarFilters} method="get">
        <div>
          <label className={styles.fieldWide}>
            <span>Search reference or form type</span>
            <input
              defaultValue={scalar(params.q) ?? ""}
              maxLength={96}
              name="q"
            />
          </label>
          <label>
            <span>Form</span>
            <select defaultValue={scalar(params.form) ?? ""} name="form">
              <option value="">All forms</option>
              {PUBLIC_FORM_KEYS.map((key) => (
                <option key={key} value={key}>
                  {publicFormLabel(key)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select defaultValue={scalar(params.status) ?? ""} name="status">
              <option value="">All statuses</option>
              {SUBMISSION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          {loaded.context.membership.role !== "organizer" ? (
            <label>
              <span>Assignment</span>
              <select
                defaultValue={scalar(params.assignment) ?? "all"}
                name="assignment"
              >
                <option value="all">All</option>
                <option value="mine">Assigned to me</option>
                <option value="unassigned">Unassigned</option>
              </select>
            </label>
          ) : null}
          <label>
            <span>Received from (UTC)</span>
            <input
              defaultValue={scalar(params.from) ?? ""}
              name="from"
              type="date"
            />
          </label>
          <label>
            <span>Received through (UTC)</span>
            <input
              defaultValue={scalar(params.to) ?? ""}
              name="to"
              type="date"
            />
          </label>
          <button type="submit">Apply filters</button>
        </div>
      </form>
      <div className={styles.calendarResultBar}>
        <p aria-live="polite">
          {page.totalCount.toLocaleString("en-CA")} result
          {page.totalCount === 1 ? "" : "s"}
          {page.items.length
            ? ` · showing ${page.firstResult}–${page.lastResult}`
            : ""}
        </p>
      </div>
      {page.items.length ? (
        <ol className={styles.recordList}>
          {page.items.map((item) => (
            <li key={item.id}>
              <Link href={`/organizer/submissions/${encodeURIComponent(item.id)}`}>
                <strong>
                  {publicFormLabel(item.formKey)} · {item.publicReference}
                </strong>
                <span>
                  {formatDateTime(item.createdAt)} ·{" "}
                  {item.assignedTo
                    ? `Assigned to ${item.assignedTo.displayName}`
                    : "Unassigned"}
                </span>
                <small>
                  <StatusPill
                    tone={
                      item.status === "responded"
                        ? "green"
                        : item.status === "in_review"
                          ? "blue"
                          : item.status === "archived"
                            ? "neutral"
                            : "amber"
                    }
                  >
                    {statusLabel(item.status)}
                  </StatusPill>
                  {item.retentionDue ? " · Retention review due" : ""}
                </small>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <OrganizerPageState
          detail="Try a different bounded filter. Spam receipts are not shown in the ordinary inbox."
          heading="No matching submissions."
          tone="quiet"
        />
      )}
      <nav className={styles.indexPagination} aria-label="Submissions pages">
        {page.page > 1 ? (
          <Link href={pageHref(params, page.page - 1)}>Previous</Link>
        ) : null}
        {page.lastResult < page.totalCount ? (
          <Link href={pageHref(params, page.page + 1)}>Next</Link>
        ) : null}
      </nav>
    </>
  );
}

function AccessChanged() {
  return (
    <OrganizerPageState
      detail="Your active membership could not be revalidated for this request."
      heading="Organizer access changed."
      tone="error"
    />
  );
}

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function statusLabel(value: string): string {
  if (value === "in_review") return "In Review";
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Vancouver",
  }).format(new Date(value));
}

function pageHref(
  params: Awaited<SearchParams>,
  page: number,
): string {
  const next = new URLSearchParams();
  for (const key of [
    "q",
    "form",
    "status",
    "assignment",
    "from",
    "to",
  ] as const) {
    const value = scalar(params[key]);
    if (value) next.set(key, value);
  }
  next.set("page", String(page));
  return `/organizer/submissions?${next.toString()}`;
}
