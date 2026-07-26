"use client";

import { useState } from "react";
import type { WorkspaceSettingsDto } from "@/lib/server/organizer/settings";
import { isRecord, organizerRequest, safeNotice } from "./client";
import styles from "./workspace.module.css";

export function SettingsForm({
  canManage,
  initialSettings,
}: Readonly<{
  canManage: boolean;
  initialSettings: WorkspaceSettingsDto;
}>) {
  const [settings, setSettings] = useState(initialSettings);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setNotice("");
    try {
      const body = await organizerRequest("/api/organizer/settings", {
        body: JSON.stringify({
          defaultTimezone: form.get("defaultTimezone"),
          workspaceName: form.get("workspaceName"),
        }),
        method: "PATCH",
      });
      if (!isRecord(body) || !isRecord(body.settings)) {
        throw new TypeError("Unexpected settings response");
      }
      setSettings(body.settings as WorkspaceSettingsDto);
      setNotice("Private workspace settings saved.");
      window.location.reload();
    } catch (error) {
      setNotice(safeNotice(error, "The workspace settings were not saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.settingsForm} onSubmit={submit}>
      <section>
        <p className={styles.kicker}>Private workspace</p>
        <h2>Planning defaults</h2>
        <p>
          These values shape the organizer workspace only. They do not change
          public branding, legal wording, the public footer, or existing event
          timestamps.
        </p>
      </section>
      <div>
        <label>
          <span>Workspace name</span>
          <input
            defaultValue={settings.workspaceName}
            disabled={!canManage}
            maxLength={120}
            name="workspaceName"
            required
          />
        </label>
        <label>
          <span>Default IANA timezone</span>
          <input
            defaultValue={settings.defaultTimezone}
            disabled={!canManage}
            list="workspace-timezones"
            maxLength={100}
            name="defaultTimezone"
            required
          />
          <datalist id="workspace-timezones">
            <option value="America/Vancouver" />
            <option value="America/Toronto" />
            <option value="America/New_York" />
            <option value="Europe/London" />
            <option value="UTC" />
          </datalist>
          <small>Offsets change with daylight-saving rules; use a named timezone.</small>
        </label>
        {canManage ? (
          <button className={styles.primaryButton} disabled={busy} type="submit">
            {busy ? "Saving…" : "Save private settings"}
          </button>
        ) : (
          <p className={styles.roleNote}>
            Organizer access is read-only for organization settings. Personal
            preferences remain editable in Profile and Notifications.
          </p>
        )}
        <p className={styles.workspaceNotice} aria-live="polite">{notice}</p>
      </div>
    </form>
  );
}
