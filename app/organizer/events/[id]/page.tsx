import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { eventEditorValue, loadEventFormOptions } from "@/app/_organizer/data";
import { EventActions } from "@/app/_organizer/EventActions";
import { EventEditorForm } from "@/app/_organizer/EventEditorForm";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import { PageHeader, StatusPill } from "@/app/_organizer/PageHeader";
import { WebsitePublicationPanel } from "@/app/_organizer/WebsitePublicationPanel";
import styles from "@/app/_organizer/workspace.module.css";
import type { OrganizerCalendarEventDto } from "@/lib/server/organizer/calendar";
import {
  listOrganizerEventConflictSummaries,
  type OrganizerEventConflictSummaryDto,
} from "@/lib/server/organizer/event-conflicts";
import {
  getOrganizerEventRecord,
  listOrganizerEventRevisions,
  type OrganizerEventDto,
  type OrganizerEventRevisionDto,
} from "@/lib/server/organizer/events";
import { readOrganizerPublicationWorkspace } from "@/lib/server/organizer/publication";
import type { TeamMemberDto } from "@/lib/server/organizer/team";
import { listTeamMembers } from "@/lib/server/organizer/team";
import {
  SafeApplicationError,
  writeSafeLog,
} from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Private event" };

type RouteParams = Promise<{ id: string }>;

export default async function OrganizerEventDetailPage({
  params,
}: Readonly<{ params: RouteParams }>) {
  const { id } = await params;
  const loaded = await loadOrganizerPageContext(
    `/organizer/events/${encodeURIComponent(id)}`,
  );
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;

  let data: EventDetailData | null = null;
  try {
    data = await loadEventDetailData(loaded.context, id);
  } catch (error) {
    if (error instanceof SafeApplicationError && error.status === 404) {
      notFound();
    }
    writeSafeLog("error", "organizer_page_failed", {
      code: "internal_error",
      route: "/organizer/events/[id]",
      status: 500,
    });
  }
  if (data === null) {
    return (
      <>
        <PageHeader
          eyebrow="Private planning record"
          introduction="No event detail is being guessed."
          title="Event"
        />
        <OrganizerPageState
          detail="This authorized private record could not be loaded. Refresh to try again."
          heading="Event temporarily unavailable."
          tone="error"
        />
      </>
    );
  }
  if (data.kind === "read_only") {
    return <ReadOnlyEvent record={data.record} names={data.names} />;
  }

  const { conflicts, names, options, publication, record, revisions } = data;
  const deleted = record.deletedAt !== null;
  return (
    <>
      <PageHeader
        eyebrow="Private planning record"
        introduction={
          deleted
            ? "This record is in deleted items. Restore it before editing."
            : "Edit with optimistic version checks. Every successful change creates an immutable revision and audit entry."
        }
        title={record.title}
      />
      <section className={styles.eventDetailSummary} aria-label="Event state">
        <StatusPill tone={record.planningStatus === "draft" ? "blue" : "amber"}>
          {record.planningStatus}
        </StatusPill>
        <StatusPill>Private</StatusPill>
        {deleted ? <StatusPill>Deleted</StatusPill> : null}
        <p>{scheduleLabel(record)}</p>
        {record.holdState ? (
          <p>
            Hold: <strong>{record.holdState.replace("_", " ")}</strong>
            {record.holdExpiresAt
              ? ` · ${formatDateTime(record.holdExpiresAt)}`
              : ""}
          </p>
        ) : null}
        <p>
          Primary organizer:{" "}
          <strong>
            {names.get(record.primaryOrganizerProfileId) ??
              "Authorized organizer"}
          </strong>
        </p>
        {record.coOrganizerProfileIds.length > 0 ? (
          <p>
            Co-organizers:{" "}
            {record.coOrganizerProfileIds
              .map(
                (profileId) =>
                  names.get(profileId) ?? "Authorized organizer",
              )
              .join(", ")}
          </p>
        ) : null}
        <p>
          Created {formatDateTime(record.createdAt)} · Updated{" "}
          {formatDateTime(record.updatedAt)}
        </p>
      </section>
      {conflicts.length > 0 ? (
        <section
          aria-labelledby="event-conflicts-title"
          className={styles.conflictPreview}
        >
          <header>
            <div>
              <p className={styles.kicker}>Private schedule coordination</p>
              <h2 id="event-conflicts-title">Current conflicts and reviews</h2>
            </div>
            <Link href="/organizer/conflicts">Open Conflicts</Link>
          </header>
          <ol className={styles.conflictPreviewList}>
            {conflicts.map((conflict) => (
              <li key={conflict.id}>
                <article
                  aria-label={`${conflict.title}. ${conflict.scheduleLabel}. ${conflict.organizerName}. ${conflict.clubName}. ${conflict.planningStatus}. ${conflict.state}.`}
                >
                  <header>
                    <div>
                      <strong>{conflict.title}</strong>
                      <span>
                        {conflict.clubName} · {conflict.organizerName}
                      </span>
                    </div>
                    <span>{conflict.state}</span>
                  </header>
                  <p>{conflict.scheduleLabel}</p>
                  <p>{conflict.overlapLabel}</p>
                  <p>{conflict.sourceLabel}</p>
                  {conflict.destination ? (
                    conflict.destination.external ? (
                      <a
                        href={conflict.destination.href}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {conflict.destination.label}
                      </a>
                    ) : (
                      <Link href={conflict.destination.href}>
                        {conflict.destination.label}
                      </Link>
                    )
                  ) : (
                    <span>Read-only source record</span>
                  )}
                </article>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <EventActions
        contentVersion={record.contentVersion}
        deleted={deleted}
        eventId={record.id}
        planningStatus={record.planningStatus}
        scheduleVersion={record.scheduleVersion}
        scheduled={record.schedule.shape !== "unscheduled"}
      />
      {deleted ? (
        <OrganizerPageState
          detail="Restore this private record to resume editing. No permanent deletion action is available."
          heading="Editing is paused while deleted."
        />
      ) : (
        <EventEditorForm
          canManageOrganizationWide={
            loaded.context.membership.role === "owner" ||
            loaded.context.membership.role === "administrator"
          }
          currentActorProfileId={loaded.context.membership.profileId}
          eventId={record.id}
          initialValue={eventEditorValue(record)}
          mode="edit"
          options={options}
        />
      )}
      <WebsitePublicationPanel
        eventId={record.id}
        initialWorkspace={publication}
      />
      <section
        aria-labelledby="event-revisions-title"
        className={styles.eventRevisionHistory}
      >
        <header className={styles.sectionHeading}>
          <div>
            <p className={styles.kicker}>Immutable revisions</p>
            <h2 id="event-revisions-title">Event history</h2>
          </div>
          <span>{revisions.length} recent</span>
        </header>
        <ol>
          {revisions.map((revision) => (
            <li key={revision.id}>
              <strong>{revision.action}</strong>
              <span>
                Content v{revision.contentVersion} · Schedule v
                {revision.scheduleVersion}
              </span>
              <span>
                {names.get(revision.actorProfileId) ?? "Authorized organizer"} ·{" "}
                {formatDateTime(revision.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

type EventDetailData =
  | Readonly<{
      conflicts: readonly OrganizerEventConflictSummaryDto[];
      kind: "editable";
      names: ReadonlyMap<string, string>;
      options: Awaited<ReturnType<typeof loadEventFormOptions>>;
      publication: Awaited<
        ReturnType<typeof readOrganizerPublicationWorkspace>
      >;
      record: OrganizerEventDto;
      revisions: readonly OrganizerEventRevisionDto[];
    }>
  | Readonly<{
      kind: "read_only";
      names: ReadonlyMap<string, string>;
      record: OrganizerCalendarEventDto;
    }>;

async function loadEventDetailData(
  context: Parameters<typeof loadEventFormOptions>[0],
  id: string,
): Promise<EventDetailData> {
  const record = await getOrganizerEventRecord(
    context.database,
    context.identity,
    id,
  );
  const team: readonly TeamMemberDto[] = await listTeamMembers(
    context.database,
    context.identity,
  );
  const names = new Map(
    team.map((member) => [member.profileId, member.displayName]),
  );
  if (!isEditableManualRecord(record)) {
    return Object.freeze({ kind: "read_only", names, record });
  }
  const [conflicts, options, publication, revisions] = await Promise.all([
    listOrganizerEventConflictSummaries(
      context.database,
      context.identity,
      record.id,
    ),
    loadEventFormOptions(context),
    readOrganizerPublicationWorkspace(context.database, context.identity, record.id),
    listOrganizerEventRevisions(
      context.database,
      context.identity,
      record.id,
      50,
    ),
  ]);
  return Object.freeze({
    conflicts,
    kind: "editable",
    names,
    options,
    publication,
    record,
    revisions,
  });
}

function ReadOnlyEvent({
  names,
  record,
}: Readonly<{
  names: ReadonlyMap<string, string>;
  record: OrganizerCalendarEventDto;
}>) {
  return (
    <>
      <PageHeader
        eyebrow={`${record.sourceLabel} · read-only`}
        introduction="This legacy or source-controlled record is visible for coordination but cannot be changed through the authoritative manual scheduling tools."
        title={record.title}
      />
      <section className={styles.readOnlyEventDetail}>
        <div>
          <StatusPill>{record.planningStatus.replace("_", " ")}</StatusPill>
          <StatusPill>{record.publicationStatus}</StatusPill>
          <StatusPill tone={record.source === "meetup" ? "green" : "neutral"}>
            {record.sourceLabel} · read-only
          </StatusPill>
        </div>
        <dl>
          <div>
            <dt>Schedule</dt>
            <dd>{scheduleLabel(record)}</dd>
          </div>
          <div>
            <dt>Club</dt>
            <dd>{record.clubName}</dd>
          </div>
          <div>
            <dt>Organizer</dt>
            <dd>
              {record.primaryOrganizerProfileId
                ? names.get(record.primaryOrganizerProfileId) ??
                  record.primaryOrganizerDisplayName ??
                  "Authorized organizer"
                : record.primaryOrganizerDisplayName ?? "Not recorded"}
            </dd>
          </div>
          <div>
            <dt>Last changed</dt>
            <dd>{formatDateTime(record.updatedAt)}</dd>
          </div>
        </dl>
        {record.meetupEventUrl ? (
          <a
            href={record.meetupEventUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open the real Meetup event
          </a>
        ) : null}
        <p>
          No manual edit, cancellation, deletion, organizer reassignment, or
          source overwrite is available for this record.
        </p>
        <Link href="/organizer/calendar">Return to Calendar</Link>
      </section>
    </>
  );
}

function isEditableManualRecord(
  record: OrganizerEventDto | OrganizerCalendarEventDto,
): record is OrganizerEventDto {
  return "organizationId" in record;
}

function scheduleLabel(
  record: OrganizerEventDto | OrganizerCalendarEventDto,
): string {
  const schedule = record.schedule;
  if (schedule.shape === "unscheduled") return "Unscheduled Idea";
  if (schedule.shape === "all_day") {
    return `${schedule.allDayStartDate} through ${schedule.allDayEndDateExclusive} (exclusive) · All day · ${schedule.timeZone}`;
  }
  return `${formatDateTime(schedule.startsAtUtc, schedule.timeZone)} – ${formatDateTime(schedule.endsAtUtc, schedule.timeZone)} · ${schedule.timeZone}`;
}

function formatDateTime(
  value: number,
  timeZone = "America/Vancouver",
): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
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
