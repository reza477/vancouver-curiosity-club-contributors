"use client";

import Link from "next/link";
import { useState } from "react";
import type { OrganizerClubDto } from "@/lib/server/organizer/clubs";
import type { OrganizerRole } from "./types";
import {
  isRecord,
  organizerConflictDetails,
  organizerRequest,
  safeNotice,
  type OrganizerConflictDetails,
} from "./client";
import { StatusPill } from "./PageHeader";
import styles from "./workspace.module.css";

export function ClubsWorkspace({
  currentRole,
  initialClubs,
}: Readonly<{
  currentRole: OrganizerRole;
  initialClubs: readonly OrganizerClubDto[];
}>) {
  const [clubs, setClubs] = useState(initialClubs);
  const [notice, setNotice] = useState("");
  const [blocking, setBlocking] =
    useState<OrganizerConflictDetails | null>(null);
  const [busy, setBusy] = useState("");
  const canManage = currentRole === "owner" || currentRole === "administrator";

  async function refresh() {
    const body = await organizerRequest("/api/organizer/clubs");
    if (isRecord(body) && Array.isArray(body.clubs)) {
      setClubs(body.clubs as OrganizerClubDto[]);
    }
  }

  async function createClub(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy("create");
    setNotice("");
    try {
      await organizerRequest("/api/organizer/clubs", {
        body: JSON.stringify({
          description: form.get("description") || null,
          name: form.get("name"),
          planningNotes: form.get("planningNotes") || null,
          slug: form.get("slug"),
        }),
        method: "POST",
      });
      setNotice("Private club created. It has no public profile.");
      event.currentTarget.reset();
      await refresh();
    } catch (error) {
      setNotice(safeNotice(error, "The private club could not be created."));
    } finally {
      setBusy("");
    }
  }

  async function updateClub(
    club: OrganizerClubDto,
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!canManage || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(`update-${club.id}`);
    setNotice("");
    try {
      await organizerRequest(
        `/api/organizer/clubs/${encodeURIComponent(club.id)}`,
        {
          body: JSON.stringify(
            club.identityEditable
              ? {
                  description: form.get("description") || null,
                  name: form.get("name"),
                  planningNotes: form.get("planningNotes") || null,
                  slug: form.get("slug"),
                }
              : { planningNotes: form.get("planningNotes") || null },
          ),
          method: "PATCH",
        },
      );
      setNotice("Private planning settings saved.");
      await refresh();
    } catch (error) {
      setNotice(safeNotice(error, "The club settings could not be saved."));
    } finally {
      setBusy("");
    }
  }

  async function archiveClub(clubId: string) {
    if (!canManage || busy) return;
    setBusy(`archive-${clubId}`);
    setNotice("");
    setBlocking(null);
    try {
      await organizerRequest(
        `/api/organizer/clubs/${encodeURIComponent(clubId)}/archive`,
        { body: "{}", method: "POST" },
      );
      setNotice("Private club archived.");
      await refresh();
    } catch (error) {
      setBlocking(organizerConflictDetails(error));
      setNotice(
        safeNotice(
          error,
          "Move active members and private plans before archiving this club.",
        ),
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div className={styles.clubsWorkspace}>
      <p className={styles.workspaceNotice} aria-live="polite">{notice}</p>
      {blocking ? (
        <section
          aria-labelledby="club-archive-blockers-title"
          className={styles.blockingList}
        >
          <h2 id="club-archive-blockers-title">Move these assignments first</h2>
          {blocking.memberCount && blocking.memberCount > 0 ? (
            <p>
              {blocking.memberCount} active{" "}
              {blocking.memberCount === 1 ? "member is" : "members are"} still
              assigned to this club. Reassign them in Team.
            </p>
          ) : null}
          {blocking.records.length > 0 ? (
            <>
              <p>
                These manual or read-only event records must remain reachable.
                Restore a deleted private plan before moving it to another club.
              </p>
              <ul>
                {blocking.records.map((record) => (
                  <li key={record.eventId}>
                    <Link
                      href={`/organizer/events/${encodeURIComponent(record.eventId)}`}
                    >
                      {record.title}
                    </Link>
                    {" "}
                    <small>
                      {record.source === "legacy_read_only"
                        ? "Read-only legacy or source-controlled record"
                        : "Private planning record"}
                    </small>
                  </li>
                ))}
              </ul>
              {blocking.eventCount &&
              blocking.eventCount > blocking.records.length ? (
                <p>
                  Showing {blocking.records.length} of {blocking.eventCount}{" "}
                  blocking event records.
                </p>
              ) : null}
            </>
          ) : null}
          {blocking.programCount && blocking.programCount > 0 ? (
            <p>
              {blocking.programCount} active{" "}
              {blocking.programCount === 1 ? "program belongs" : "programs belong"}{" "}
              to this club. Program identity is read-only in Phase 3, so keep
              this club active.
            </p>
          ) : null}
          {blocking.sourceCount && blocking.sourceCount > 0 ? (
            <p>
              {blocking.sourceCount} retained Meetup{" "}
              {blocking.sourceCount === 1 ? "source belongs" : "sources belong"}{" "}
              to this club. Source history cannot be orphaned; review the
              connection workspace and keep this club active.
            </p>
          ) : null}
          {blocking.invitationCount && blocking.invitationCount > 0 ? (
            <p>
              {blocking.invitationCount} pending{" "}
              {blocking.invitationCount === 1 ? "invitation targets" : "invitations target"}{" "}
              this club. Revoke it or wait for it to expire before archiving.
            </p>
          ) : null}
          <div className={styles.actionRow}>
            {(blocking.memberCount ?? 0) > 0 ||
            (blocking.invitationCount ?? 0) > 0 ? (
              <Link href="/organizer/team">Open Team</Link>
            ) : null}
            {blocking.sourceCount && blocking.sourceCount > 0 ? (
              <Link href="/organizer/meetup">Open Meetup connection</Link>
            ) : null}
            {blocking.eventCount && blocking.eventCount > 0 ? (
              <Link href="/organizer/events">Open private events</Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {canManage ? (
        <details className={styles.clubComposer}>
          <summary>Create an organizer-private club</summary>
          <form onSubmit={createClub}>
            <label>
              <span>Name</span>
              <input maxLength={120} name="name" required />
            </label>
            <label>
              <span>Internal slug</span>
              <input
                maxLength={100}
                name="slug"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                placeholder="quiet-reading-circle"
                required
              />
            </label>
            <label className={styles.fieldFull}>
              <span>Description</span>
              <textarea maxLength={800} name="description" rows={3} />
            </label>
            <label className={styles.fieldFull}>
              <span>Private planning notes</span>
              <textarea maxLength={2_000} name="planningNotes" rows={4} />
            </label>
            <p className={`${styles.fieldFull} ${styles.formNotice}`}>
              New Phase 3 clubs are organizer-private and do not create a public club page.
            </p>
            <button className={styles.primaryButton} disabled={busy === "create"} type="submit">
              {busy === "create" ? "Creating…" : "Create private club"}
            </button>
          </form>
        </details>
      ) : (
        <p className={styles.roleNote}>
          Organizer access shows assigned clubs read-only. Owner and
          Administrator roles manage private planning settings.
        </p>
      )}

      <section className={styles.clubDirectory} aria-labelledby="private-clubs-title">
        <header className={styles.sectionHeading}>
          <div>
            <p className={styles.kicker}>Internal directory</p>
            <h2 id="private-clubs-title">Clubs</h2>
          </div>
          <span>{clubs.length} visible</span>
        </header>
        {clubs.length > 0 ? (
          <div className={styles.clubList}>
            {clubs.map((club) => (
              <article key={club.id}>
                <header>
                  <div>
                    <StatusPill tone={club.publicationState === "published" ? "green" : "neutral"}>
                      {club.publicationState === "private"
                        ? "Organizer-private"
                        : `Public profile · ${club.publicationState}`}
                    </StatusPill>
                    <h3>{club.name}</h3>
                    <p>{club.description ?? "No description has been recorded."}</p>
                  </div>
                  <small>{club.slug}</small>
                </header>
                {canManage ? (
                  <form onSubmit={(event) => updateClub(club, event)}>
                    {club.identityEditable ? (
                      <>
                        <label>
                          <span>Name</span>
                          <input defaultValue={club.name} maxLength={120} name="name" required />
                        </label>
                        <label>
                          <span>Internal slug</span>
                          <input
                            defaultValue={club.slug}
                            maxLength={100}
                            name="slug"
                            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                            required
                          />
                        </label>
                        <label className={styles.fieldFull}>
                          <span>Description</span>
                          <textarea defaultValue={club.description ?? ""} maxLength={800} name="description" rows={3} />
                        </label>
                      </>
                    ) : (
                      <p className={`${styles.fieldFull} ${styles.formNotice}`}>
                        This club has a public profile. Its public identity,
                        slug, description, group URL, and publication state are
                        read-only until the CMS phase.
                      </p>
                    )}
                    <label className={styles.fieldFull}>
                      <span>Private planning notes</span>
                      <textarea defaultValue={club.planningNotes ?? ""} maxLength={2_000} name="planningNotes" rows={4} />
                    </label>
                    <div className={`${styles.fieldFull} ${styles.actionRow}`}>
                      <button
                        className={styles.primaryButton}
                        disabled={busy === `update-${club.id}`}
                        type="submit"
                      >
                        {busy === `update-${club.id}` ? "Saving…" : "Save private settings"}
                      </button>
                      {club.identityEditable ? (
                        <button
                          className={styles.secondaryButton}
                          disabled={busy === `archive-${club.id}`}
                          onClick={() => archiveClub(club.id)}
                          type="button"
                        >
                          {busy === `archive-${club.id}` ? "Archiving…" : "Archive private club"}
                        </button>
                      ) : null}
                    </div>
                  </form>
                ) : (
                  <p className={styles.clubPlanningNote}>
                    {club.planningNotes ?? "No private planning note is available."}
                  </p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.panelEmpty}>No assigned club is available.</p>
        )}
      </section>
    </div>
  );
}
