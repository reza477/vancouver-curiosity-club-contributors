"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  InvitationDto,
  CreatedInvitationDto,
} from "@/lib/server/organizer/invitations";
import type { TeamMemberDto } from "@/lib/server/organizer/team";
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

export function TeamWorkspace({
  clubs,
  currentRole,
  initialInvitations,
  initialMembers,
}: Readonly<{
  clubs: readonly OrganizerClubDto[];
  currentRole: OrganizerRole;
  initialInvitations: readonly InvitationDto[];
  initialMembers: readonly TeamMemberDto[];
}>) {
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [created, setCreated] = useState<CreatedInvitationDto | null>(null);
  const [notice, setNotice] = useState("");
  const [blocking, setBlocking] =
    useState<OrganizerConflictDetails | null>(null);
  const [busy, setBusy] = useState("");
  const canManage = currentRole === "owner" || currentRole === "administrator";

  async function refresh() {
    const requests: Promise<unknown>[] = [
      organizerRequest("/api/organizer/team"),
    ];
    if (canManage) requests.push(organizerRequest("/api/organizer/invitations"));
    const [teamBody, invitationBody] = await Promise.all(requests);
    if (isRecord(teamBody) && Array.isArray(teamBody.members)) {
      setMembers(teamBody.members as TeamMemberDto[]);
    }
    if (
      canManage &&
      isRecord(invitationBody) &&
      Array.isArray(invitationBody.invitations)
    ) {
      setInvitations(invitationBody.invitations as InvitationDto[]);
    }
  }

  async function createInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || busy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const intendedRole = form.get("intendedRole");
    const clubId = form.get("clubId");
    setBusy("create-invitation");
    setCreated(null);
    setNotice("");
    try {
      const body = await organizerRequest("/api/organizer/invitations", {
        body: JSON.stringify({
          clubId: intendedRole === "organizer" ? clubId : null,
          expiresAt:
            Date.now() +
            Number(form.get("expiresInDays") ?? 7) * 24 * 60 * 60_000,
          intendedRole,
          targetEmail: form.get("targetEmail"),
        }),
        method: "POST",
      });
      if (!isRecord(body) || !isRecord(body.created)) {
        throw new TypeError("Unexpected invitation response");
      }
      const next = body.created as CreatedInvitationDto;
      setCreated(next);
      setNotice(
        "Invitation created. Copy the link and send it manually; no email was sent.",
      );
      setInvitations((current) => [
        next.invitation,
        ...current.filter(
          (invitation) => invitation.id !== next.invitation.id,
        ),
      ]);
      formElement.reset();
    } catch (error) {
      setNotice(safeNotice(error, "The invitation could not be created."));
    } finally {
      setBusy("");
    }
  }

  async function revokeInvitation(invitationId: string) {
    if (busy) return;
    setBusy(`revoke-${invitationId}`);
    setNotice("");
    try {
      await organizerRequest(
        `/api/organizer/invitations/${encodeURIComponent(invitationId)}/revoke`,
        { body: "{}", method: "POST" },
      );
      setNotice("Invitation revoked.");
      await refresh();
    } catch (error) {
      setNotice(safeNotice(error, "The invitation could not be revoked."));
    } finally {
      setBusy("");
    }
  }

  async function updateMember(
    membershipId: string,
    change: Readonly<{
      clubIds?: readonly string[];
      role?: "administrator" | "organizer";
      status?: "active" | "revoked" | "suspended";
    }>,
  ) {
    if (busy) return;
    setBusy(`member-${membershipId}`);
    setNotice("");
    setBlocking(null);
    try {
      await organizerRequest(
        `/api/organizer/team/${encodeURIComponent(membershipId)}`,
        { body: JSON.stringify(change), method: "PATCH" },
      );
      setNotice("Team membership updated.");
      await refresh();
    } catch (error) {
      setBlocking(organizerConflictDetails(error));
      setNotice(
        safeNotice(
          error,
          "The member could not be changed. Reassign any blocking records first.",
        ),
      );
    } finally {
      setBusy("");
    }
  }

  async function transferOwnership(membershipId: string) {
    if (currentRole !== "owner" || busy) return;
    setBusy("ownership");
    setNotice("");
    try {
      await organizerRequest("/api/organizer/team/ownership", {
        body: JSON.stringify({ membershipId }),
        method: "POST",
      });
      setNotice("Ownership transferred atomically. Your role has changed.");
      await refresh();
      window.location.reload();
    } catch (error) {
      setNotice(safeNotice(error, "Ownership could not be transferred."));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className={styles.teamWorkspace}>
      <p className={styles.workspaceNotice} aria-live="polite">
        {notice}
      </p>
      {blocking?.records.length ? (
        <section
          aria-labelledby="team-blocking-events-title"
          className={styles.blockingList}
        >
          <h2 id="team-blocking-events-title">Reassign these records first</h2>
          <p>
            Open each record and move its organizer assignment before changing
            this membership.
          </p>
          <ul>
            {blocking.records.map((record) => (
              <li key={record.eventId}>
                <Link
                  href={`/organizer/events/${encodeURIComponent(record.eventId)}`}
                >
                  {record.title}
                </Link>
                {record.source === "legacy_read_only" ? (
                  <span>Existing read-only record</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canManage ? (
        <section className={styles.invitationComposer} aria-labelledby="invite-team-title">
          <header>
            <p className={styles.kicker}>Copyable link</p>
            <h2 id="invite-team-title">Invite a teammate</h2>
            <p>
              Create the link, send it manually, and ask the recipient to use
              the matching ChatGPT account. This workspace does not send email.
            </p>
          </header>
          <InviteForm
            allowAdministrator={currentRole === "owner"}
            busy={busy === "create-invitation"}
            clubs={clubs}
            onSubmit={createInvitation}
          />
          {created ? (
            <div className={styles.createdInvitation}>
              <strong>Copy this link now</strong>
              <code>{created.copyablePath}</code>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      new URL(
                        created.copyablePath,
                        window.location.origin,
                      ).toString(),
                    );
                    setNotice("Invitation link copied. No email was sent.");
                  } catch {
                    setNotice(
                      "The browser could not copy the link. Select it above and copy it manually.",
                    );
                  }
                }}
                type="button"
              >
                Copy invitation link
              </button>
              <small>
                The token is not shown again in the invitation list.
              </small>
            </div>
          ) : null}
        </section>
      ) : (
        <p className={styles.roleNote}>
          Organizer access is read-only here. Owner and Administrator roles
          manage invitations and team membership.
        </p>
      )}

      <section className={styles.teamSection} aria-labelledby="members-title">
        <header className={styles.sectionHeading}>
          <div>
            <p className={styles.kicker}>Active directory</p>
            <h2 id="members-title">Members</h2>
          </div>
          <span>{members.length} total</span>
        </header>
        {members.length > 0 ? (
          <div className={styles.memberList}>
            {members.map((member) => (
              <MemberCard
                busy={busy === `member-${member.membershipId}`}
                canManage={canManage}
                clubs={clubs}
                currentRole={currentRole}
                key={`${member.membershipId}:${member.role}:${member.status}:${member.clubs.map((club) => club.id).join(",")}`}
                member={member}
                onChange={updateMember}
                onTransfer={transferOwnership}
              />
            ))}
          </div>
        ) : (
          <p className={styles.panelEmpty}>No team member record is available.</p>
        )}
      </section>

      {canManage ? (
        <section className={styles.teamSection} aria-labelledby="invitations-title">
          <header className={styles.sectionHeading}>
            <div>
              <p className={styles.kicker}>Manual delivery</p>
              <h2 id="invitations-title">Invitations</h2>
            </div>
            <span>{invitations.length} recorded</span>
          </header>
          {invitations.length > 0 ? (
            <div className={styles.invitationList}>
              {invitations.map((invitation) => (
                <article key={invitation.id}>
                  <div>
                    <StatusPill tone={invitation.state === "pending" ? "amber" : "neutral"}>
                      {invitation.state}
                    </StatusPill>
                    <h3>{invitation.targetEmail}</h3>
                    <p>
                      {roleLabel(invitation.intendedRole)}
                      {invitation.club ? ` · ${invitation.club.name}` : " · Organization-wide"}
                    </p>
                    <small>
                      Created by {invitation.createdByDisplayName} · Expires{" "}
                      {formatDateTime(invitation.expiresAt)}
                    </small>
                  </div>
                  {invitation.state === "pending" ? (
                    <button
                      disabled={busy === `revoke-${invitation.id}`}
                      onClick={() => revokeInvitation(invitation.id)}
                      type="button"
                    >
                      {busy === `revoke-${invitation.id}` ? "Revoking…" : "Revoke"}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.panelEmpty}>No invitations have been created.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

function InviteForm({
  allowAdministrator,
  busy,
  clubs,
  onSubmit,
}: Readonly<{
  allowAdministrator: boolean;
  busy: boolean;
  clubs: readonly OrganizerClubDto[];
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}>) {
  const [role, setRole] = useState<"administrator" | "organizer">("organizer");
  return (
    <form className={styles.invitationForm} onSubmit={onSubmit}>
      <label>
        <span>Invited ChatGPT email</span>
        <input autoComplete="off" maxLength={254} name="targetEmail" required type="email" />
      </label>
      <label>
        <span>Role</span>
        <select
          name="intendedRole"
          onChange={(event) => setRole(event.target.value as typeof role)}
          value={role}
        >
          <option value="organizer">Organizer</option>
          {allowAdministrator ? (
            <option value="administrator">Administrator</option>
          ) : null}
        </select>
      </label>
      {role === "organizer" ? (
        <label>
          <span>Club assignment</span>
          <select name="clubId" required>
            <option value="">Choose a club</option>
            {clubs.map((club) => (
              <option key={club.id} value={club.id}>{club.name}</option>
            ))}
          </select>
        </label>
      ) : (
        <p className={styles.formNotice}>
          Administrator invitations are organization-wide and cannot create an Owner.
        </p>
      )}
      <label>
        <span>Expires in</span>
        <select defaultValue="7" name="expiresInDays">
          <option value="1">1 day</option>
          <option value="7">7 days</option>
          <option value="14">14 days</option>
          <option value="30">30 days</option>
        </select>
      </label>
      <button className={styles.primaryButton} disabled={busy} type="submit">
        {busy ? "Creating…" : "Create copyable link"}
      </button>
    </form>
  );
}

function MemberCard({
  busy,
  canManage,
  clubs,
  currentRole,
  member,
  onChange,
  onTransfer,
}: Readonly<{
  busy: boolean;
  canManage: boolean;
  clubs: readonly OrganizerClubDto[];
  currentRole: OrganizerRole;
  member: TeamMemberDto;
  onChange: (
    membershipId: string,
    change: Readonly<{
      clubIds?: readonly string[];
      role?: "administrator" | "organizer";
      status?: "active" | "revoked" | "suspended";
    }>,
  ) => void;
  onTransfer: (membershipId: string) => void;
}>) {
  const [clubIds, setClubIds] = useState(member.clubs.map((club) => club.id));
  const [role, setRole] = useState<"administrator" | "organizer">(
    member.role === "administrator" ? "administrator" : "organizer",
  );
  const [status, setStatus] = useState(member.status);
  const memberCanBeManaged =
    canManage &&
    member.role !== "owner" &&
    (currentRole === "owner" || member.role === "organizer");
  return (
    <article className={styles.memberCard}>
      <header>
        <span
          aria-label={`${member.calendarColor} calendar color`}
          className={`${styles.memberAvatar} ${styles[`color${capitalize(member.calendarColor)}`]}`}
          role="img"
        >
          {member.initials}
        </span>
        <div>
          <h3>{member.displayName}</h3>
          {member.email ? <p>{member.email}</p> : null}
        </div>
        <span className={styles.memberStates}>
          <StatusPill tone={member.status === "active" ? "green" : "neutral"}>
            {member.status}
          </StatusPill>
          <StatusPill tone={member.role === "owner" ? "blue" : "neutral"}>
            {roleLabel(member.role)}
          </StatusPill>
        </span>
      </header>
      <p>
        {member.clubs.length > 0
          ? member.clubs.map((club) => club.name).join(", ")
          : "No active club assignment"}
      </p>
      {memberCanBeManaged ? (
        <details className={styles.memberManagement}>
          <summary>Manage member</summary>
          <div>
            <label>
              <span>Role</span>
              <select
                value={role}
                disabled={currentRole === "administrator" && member.role === "administrator"}
                onChange={(event) =>
                  setRole(event.target.value as "administrator" | "organizer")
                }
              >
                <option value="organizer">Organizer</option>
                <option value="administrator">Administrator</option>
              </select>
            </label>
            <label>
              <span>Status</span>
              <select
                value={status}
                disabled={currentRole === "administrator" && member.role === "administrator"}
                onChange={(event) =>
                  setStatus(
                    event.target.value as "active" | "revoked" | "suspended",
                  )
                }
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="revoked">Removed</option>
              </select>
            </label>
            <fieldset>
              <legend>
                {role === "organizer"
                  ? "Required club assignments"
                  : "Organization-wide assignment"}
              </legend>
              {role === "organizer" ? clubs.map((club) => (
                <label key={club.id}>
                  <input
                    checked={clubIds.includes(club.id)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...clubIds, club.id]
                        : clubIds.filter((id) => id !== club.id);
                      setClubIds(next);
                    }}
                    type="checkbox"
                  />
                  <span>{club.name}</span>
                </label>
              )) : (
                <p>Administrators do not use club-scoped assignments.</p>
              )}
              <button
                disabled={
                  busy ||
                  (role === "organizer" && clubIds.length === 0) ||
                  (currentRole === "administrator" && member.role === "administrator")
                }
                onClick={() =>
                  onChange(member.membershipId, {
                    clubIds: role === "organizer" ? clubIds : [],
                    role,
                    status,
                  })
                }
                type="button"
              >
                Save membership changes
              </button>
            </fieldset>
            {currentRole === "owner" && member.status === "active" ? (
              <details className={styles.ownershipTransfer}>
                <summary>Transfer ownership</summary>
                <p>
                  This atomically makes this member the sole Owner and changes
                  your role to Administrator.
                </p>
                <button disabled={busy} onClick={() => onTransfer(member.membershipId)} type="button">
                  Confirm ownership transfer
                </button>
              </details>
            ) : null}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function roleLabel(role: "administrator" | "organizer" | "owner"): string {
  if (role === "owner") return "Owner";
  if (role === "administrator") return "Administrator";
  return "Organizer";
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Vancouver",
  }).format(new Date(value));
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
