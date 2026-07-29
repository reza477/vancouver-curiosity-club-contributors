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
          expectedAttributionDraftVersion:
            profile.publicAttributionDraftVersion,
          initials: form.get("initials"),
          publicAttributionConsent:
            form.get("publicAttributionConsent") === "on",
          publicBiography: form.get("publicBiography") || null,
          publicPhotoAssetId:
            form.get("publicPhotoAssetId") || null,
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

  async function mutatePublicAttribution(
    action: "confirm" | "revoke",
  ) {
    if (busy) return;
    if (
      action === "revoke" &&
      !window.confirm(
        "Remove your public name, biography, and profile photo from event host attribution?",
      )
    ) {
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const body = await organizerRequest(
        "/api/organizer/profile/public-attribution",
        {
          body: JSON.stringify({
            expectedAttributionDraftVersion:
              profile.publicAttributionDraftVersion,
            expectedAttributionPublishedVersion:
              profile.publicAttributionPublishedVersion,
          }),
          method: action === "confirm" ? "POST" : "DELETE",
        },
      );
      if (!isRecord(body) || !isRecord(body.profile)) {
        throw new TypeError("Unexpected profile response");
      }
      setProfile(body.profile as OrganizerProfileDto);
      setNotice(
        action === "confirm"
          ? "Your saved attribution is now eligible for event pages that explicitly select you as a public host."
          : "Your public attribution was revoked. Private organizer details remain private.",
      );
    } catch (error) {
      setNotice(
        safeNotice(
          error,
          action === "confirm"
            ? "Your public attribution was not published."
            : "Your public attribution was not revoked.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.profileForm}
      key={[
        profile.publicAttributionDraftVersion,
        profile.publicAttributionPublishedVersion,
        profile.publicAttributionConsent ? "consented" : "not-consented",
        profile.publicAttributionStatus,
      ].join(":")}
      onSubmit={submit}
    >
      <section className={styles.profileIdentity} aria-labelledby="profile-identity-title">
        <div
          aria-label={`${profile.calendarColor} calendar color`}
          className={`${styles.profileAvatar} ${styles[`color${capitalize(profile.calendarColor)}`]}`}
          role="img"
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
            This private profile draft does not change the current
            public website.
          </small>
        </label>
        <label className={styles.fieldFull}>
          <span>Approved public profile photo</span>
          <select
            defaultValue={profile.publicPhotoAssetId ?? ""}
            name="publicPhotoAssetId"
          >
            <option value="">No public profile photo</option>
            {profile.eligiblePublicPhotos.map((photo) => (
              <option key={photo.id} value={photo.id}>
                {photo.altText} - {photo.credit}
              </option>
            ))}
          </select>
          <small>
            Only ready media with approved rights, confirmed or
            not-applicable participant consent, credit, and useful alt text is
            available.
          </small>
        </label>
        <label className={`${styles.consentField} ${styles.fieldFull}`}>
          <input defaultChecked={profile.publicAttributionConsent} name="publicAttributionConsent" type="checkbox" />
          <span>
            <strong>Consent to publish this saved attribution</strong>
            <small>
              Save keeps this private. Publishing below is a separate explicit
              action, and an event must still select you as a public host
              before the attribution appears there.
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
          {busy ? "Saving..." : "Save profile"}
        </button>
        <button
          className={styles.secondaryButton}
          disabled={
            busy ||
            !profile.publicAttributionConsent ||
            profile.publicAttributionDraftVersion < 1 ||
            (
              profile.publicAttributionStatus === "confirmed" &&
              !profile.publicAttributionHasNewerDraft
            )
          }
          onClick={() => mutatePublicAttribution("confirm")}
          type="button"
        >
          Publish public attribution
        </button>
        {profile.publicAttributionStatus === "confirmed" ||
        profile.publicAttributionStatus === "legacy" ? (
          <button
            className={styles.dangerButton}
            disabled={busy}
            onClick={() => mutatePublicAttribution("revoke")}
            type="button"
          >
            Revoke public attribution
          </button>
        ) : null}
        <p aria-live="polite">{notice}</p>
      </footer>
      <section
        aria-labelledby="public-attribution-state-title"
        className={styles.assignedClubPanel}
      >
        <p className={styles.kicker}>Public attribution</p>
        <h2 id="public-attribution-state-title">
          {attributionStatusLabel(profile.publicAttributionStatus)}
        </h2>
        {profile.publicAttributionPublished ? (
          <p>
            Current public name:{" "}
            <strong>
              {profile.publicAttributionPublished.displayName}
            </strong>
            {profile.publicAttributionHasNewerDraft
              ? " A newer private draft is waiting for explicit publication."
              : ""}
          </p>
        ) : (
          <p>
            No biography or profile photo from this workflow is public.
          </p>
        )}
      </section>
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

function attributionStatusLabel(
  status: OrganizerProfileDto["publicAttributionStatus"],
): string {
  if (status === "confirmed") return "Published by you";
  if (status === "legacy") return "Existing name attribution";
  if (status === "revoked") return "Revoked";
  return "Private draft";
}
