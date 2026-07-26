import Link from "next/link";
import type { OrganizerEventSummary } from "./types";
import { StatusPill } from "./PageHeader";
import styles from "./workspace.module.css";

export function EventIndex({
  events,
  firstResult,
  hasNextPage,
  hasPreviousPage,
  lastResult,
  page,
  search,
  status,
  totalCount,
}: Readonly<{
  events: readonly OrganizerEventSummary[];
  firstResult: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  lastResult: number;
  page: number;
  search: string;
  status: string;
  totalCount: number;
}>) {
  return (
    <div className={styles.eventIndex}>
      <form
        action="/organizer/events"
        className={styles.indexFilters}
        method="get"
      >
        <label>
          <span>Search private planning records</span>
          <input
            defaultValue={search}
            maxLength={120}
            name="search"
            placeholder="Title or club"
            type="search"
          />
        </label>
        <label>
          <span>Planning status</span>
          <select defaultValue={status} name="status">
            <option value="active">Active planning records</option>
            <option value="idea">Ideas</option>
            <option value="draft">Drafts</option>
            <option value="tentative_hold">Tentative holds</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
            <option value="deleted">Deleted items</option>
          </select>
        </label>
        <button type="submit">Apply filters</button>
        <Link className={styles.indexClearLink} href="/organizer/events">
          Clear filters
        </Link>
      </form>

      <p className={styles.indexCount} aria-live="polite">
        {totalCount === 0 ? (
          <>No private records match.</>
        ) : (
          <>
            Showing <strong>{firstResult} through {lastResult}</strong> of{" "}
            <strong>{totalCount}</strong>{" "}
            {totalCount === 1 ? "private record" : "private records"}.
          </>
        )}
      </p>

      {events.length > 0 ? (
        <ol className={styles.eventIndexList} start={firstResult}>
          {events.map((event) => (
            <li key={event.id}>
              <Link href={`/organizer/events/${encodeURIComponent(event.id)}`}>
                <span>
                  <StatusPill tone={event.planningStatus === "draft" ? "blue" : "amber"}>
                    {event.planningStatus.replace("_", " ")}
                  </StatusPill>
                  <StatusPill>{event.publicationStatus}</StatusPill>
                  {event.deleted ? <StatusPill>Deleted</StatusPill> : null}
                </span>
                <strong>{event.title}</strong>
                <span>{event.scheduleLabel}</span>
                <small>{event.clubName} / Updated {event.updatedAtLabel}</small>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <section className={styles.pageState} aria-labelledby="event-index-empty">
          <p className={styles.kicker}>Private planning</p>
          <h2 id="event-index-empty">No private planning records match.</h2>
          <p>
            Clear the filters or create a real private planning record. No
            placeholder events are shown.
          </p>
          <Link className={styles.primaryAction} href="/organizer/events/new">
            Add an Idea or Draft
          </Link>
        </section>
      )}

      {hasPreviousPage || hasNextPage ? (
        <nav className={styles.indexPagination} aria-label="Event result pages">
          {hasPreviousPage ? (
            <Link href={eventIndexHref(search, status, page - 1)}>
              Previous 200
            </Link>
          ) : (
            <span />
          )}
          <span>Page {page}</span>
          {hasNextPage ? (
            <Link href={eventIndexHref(search, status, page + 1)}>
              Next 200
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}

function eventIndexHref(
  search: string,
  status: string,
  page: number,
): string {
  const query = new URLSearchParams();
  if (search.length > 0) query.set("search", search);
  if (status !== "active") query.set("status", status);
  if (page > 1) query.set("page", String(page));
  const serialized = query.toString();
  return serialized.length > 0
    ? `/organizer/events?${serialized}`
    : "/organizer/events";
}
