"use client";

import { useState } from "react";
import type {
  CalendarColorToken,
  OrganizerProfileDto,
} from "@/lib/server/organizer/profiles";
import type { NotificationPreferenceMode } from "@/lib/server/organizer/notifications";
import { isRecord, organizerRequest, safeNotice } from "./client";
import styles from "./workspace.module.css";

const colorOptions: readonly Readonly<{
  id: CalendarColorToken;
  label: string;
}>[] = [
  { id: "forest", label: "Forest" },
  { id: "cobalt", label: "Cobalt" },
  { id: "coral", label: "Coral" },
  { id: "amber", label: "Amber" },
  { id: "plum", label: "Plum" },
  { id: "teal", label: "Teal" },
];

export function ProfileForm({
  initialProfile,
}: Readonly<{ initialProfile: OrganizerProfileDto }>) {
  const [profile, setProfile] = useState(initialProfile);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setNotice("");
    let profileSaved = false;
    try {
      const nextMode = form.get("notificationPreferenceMode") as NotificationPreferenceMode;
      const profileBody = await organizerRequest("/api/organizer/profile", {
        body: JSON.stringify({
          calendarColor: form.get("calendarColor"),
          displayName: form.get("displayName"),
          initials: form.get("initials"),
          publicAttributionConsent:
            form.get("publicAttributionConsent") === "on",
          publicBiography: form.get("publicBiography") || null,
        }),
        method: "PATCH",
      });
      if (!isRecord(profileBody) || !isRecord(profileBody.profile)) {
        throw new TypeError("Unexpected profile response");
      }
      const updatedProfile = {
        ...(profileBody.profile as OrganizerProfileDto),
        notificationPreferenceMode: profile.notificationPreferenceMode,
      };
      setProfile(updatedProfile);
      profileSaved = true;
      if (nextMode !== profile.notificationPreferenceMode) {
        await organizerRequest("/api/organizer/notifications/preferences", {
          body: JSON.stringify({ mode: nextMode }),
          method: "PATCH",
        });
        setProfile({
          ...updatedProfile,
          notificationPreferenceMode: nextMode,
        });
      }
      setNotice("Profile and personal preferences saved.");
    } catch (error) {
      setNotice(
        profileSaved
          ? "The profile was saved, but the notification preference was not. Try that preference again."
          : safeNotice(error, "Your profile changes were not saved."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.profileForm} onSubmit={submit}>
      <section className={styles.profileIdentity} aria-labelledby="profile-identity-title">
        <div
          aria-label={`${profile.calendarColor} calendar color`}
          className={`${styles.profileAvatar} ${styles[`color${capitalize(profile.calendarColor)}`]}`}
        >
          {profile.initials}
        </div>
        <div>
          <p className={styles.kicker}>Organizer identity</p>
          <h2 id="profile-identity-title">{profile.displayName}</h2>
          <p>{roleLabel(profile.role)}</p>
        </div>
      </section>

      <section className={styles.profileFields}>
        <label>
          <span>Display name</span>
          <input defaultValue={profile.displayName} maxLength={120} name="displayName" required />
        </label>
        <label>
          <span>Initials</span>
          <input autoCapitalize="characters" defaultValue={profile.initials} maxLength={4} name="initials" required />
        </label>
        <label>
          <span>Accessible calendar color</span>
          <select defaultValue={profile.calendarColor} name="calendarColor">
            {colorOptions.map((color) => (
              <option key={color.id} value={color.id}>{color.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>In-app notifications</span>
          <select defaultValue={profile.notificationPreferenceMode} name="notificationPreferenceMode">
            <option value="important_only">Important only</option>
            <option value="all_relevant">All relevant</option>
          </select>
        </label>
        <label className={styles.fieldFull}>
          <span>Optional biography draft</span>
          <textarea defaultValue={profile.publicBiography ?? ""} maxLength={800} name="publicBiography" rows={5} />
          <small>
            This Phase 3 draft remains private and does not change the current
            public website.
          </small>
        </label>
        <label className={`${styles.consentField} ${styles.fieldFull}`}>
          <input defaultChecked={profile.publicAttributionConsent} name="publicAttributionConsent" type="checkbox" />
          <span>
            <strong>Draft consent for a later public-attribution workflow</strong>
            <small>
              Saving this private preference does not add, remove, or rename a
              host on the current public website.
            </small>
          </span>
        </label>
      </section>

      <section className={styles.assignedClubPanel} aria-labelledby="profile-clubs-title">
        <p className={styles.kicker}>Authorization scope</p>
        <h2 id="profile-clubs-title">Assigned clubs</h2>
        {profile.assignedClubs.length > 0 ? (
          <ul className={styles.plainList}>
            {profile.assignedClubs.map((club) => (
              <li key={club.id}>{club.name}</li>
            ))}
          </ul>
        ) : (
          <p>
            {profile.role === "owner" || profile.role === "administrator"
              ? "Organization-wide access across active clubs."
              : "No active club assignment is available."}
          </p>
        )}
      </section>

      <footer className={styles.formFooter}>
        <button className={styles.primaryButton} disabled={busy} type="submit">
          {busy ? "Saving…" : "Save profile"}
        </button>
        <p aria-live="polite">{notice}</p>
      </footer>
    </form>
  );
}

function roleLabel(role: OrganizerProfileDto["role"]): string {
  if (role === "owner") return "Owner";
  if (role === "administrator") return "Administrator";
  return "Organizer";
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
