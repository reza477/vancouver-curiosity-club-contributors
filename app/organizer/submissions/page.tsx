import type { Metadata } from "next";
import Link from "next/link";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader } from "@/app/_organizer/PageHeader";
import { SubmissionInbox } from "@/app/_organizer/SubmissionInbox";
import { SUBMISSION_MODERATION_FOLDERS } from "@/lib/submission-moderation-contract";
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
        folder: scalar(params.folder),
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
  const manager = loaded.context.membership.role !== "organizer";
  const folder = manager && scalar(params.folder) === "spam" ? "spam"
    : manager && scalar(params.folder) === "trash" ? "trash" : "inbox";
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
      {manager ? <nav className={styles.submissionFolders} aria-label="Submission folders">
        {SUBMISSION_MODERATION_FOLDERS.map((option) => <Link
          key={option}
          aria-current={folder === option ? "page" : undefined}
          href={`/organizer/submissions?folder=${option}`}
        >{statusLabel(option)}</Link>)}
      </nav> : null}
      <form className={styles.calendarFilters} method="get">
        <input type="hidden" name="folder" value={folder} />
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
        <SubmissionInbox key={JSON.stringify([folder, page.page, ...["q", "form", "status", "assignment", "from", "to"].map((key) => scalar(params[key]) ?? "")])} items={page.items} manager={manager} folder={folder} />
      ) : (
        <OrganizerPageState
          detail={folder === "inbox" ? "Try different filters, or review Spam and Trash if you manage this inbox." : "Nothing matches these filters. Content moved here can be restored to Inbox."}
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

function pageHref(
  params: Awaited<SearchParams>,
  page: number,
): string {
  const next = new URLSearchParams();
  for (const key of [
    "q",
    "folder",
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
