"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  NotificationDto,
  NotificationPage,
  NotificationPreferenceMode,
} from "@/lib/server/organizer/notifications";
import { isRecord, organizerRequest, safeNotice } from "./client";
import styles from "./workspace.module.css";

export function NotificationCenter({
  initialPage,
  initialPreference,
}: Readonly<{
  initialPage: NotificationPage;
  initialPreference: NotificationPreferenceMode;
}>) {
  const [notifications, setNotifications] = useState(initialPage.notifications);
  const [unreadCount, setUnreadCount] = useState(initialPage.unreadCount);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [preference, setPreference] = useState(initialPreference);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  async function setRead(notification: NotificationDto, read: boolean) {
    if (busy) return;
    setBusy(notification.id);
    setNotice("");
    try {
      const body = await organizerRequest(
        `/api/organizer/notifications/${encodeURIComponent(notification.id)}`,
        { body: JSON.stringify({ read }), method: "PATCH" },
      );
      if (
        !isRecord(body) ||
        !isRecord(body.notification) ||
        typeof body.notification.id !== "string" ||
        typeof body.notification.read !== "boolean"
      ) {
        throw new TypeError("Unexpected notification response");
      }
      const updatedId = body.notification.id;
      const updatedRead = body.notification.read;
      setNotifications((current) =>
        current.map((item) =>
          item.id === updatedId ? { ...item, read: updatedRead } : item,
        ),
      );
      setUnreadCount((count) =>
        read && !notification.read
          ? Math.max(0, count - 1)
          : !read && notification.read
            ? count + 1
            : count,
      );
    } catch (error) {
      setNotice(safeNotice(error, "The notification could not be changed."));
    } finally {
      setBusy("");
    }
  }

  async function markAllRead() {
    if (busy) return;
    setBusy("read-all");
    setNotice("");
    try {
      await organizerRequest("/api/organizer/notifications/read-all", {
        body: "{}",
        method: "POST",
      });
      setNotifications((current) =>
        current.map((notification) => ({ ...notification, read: true })),
      );
      setUnreadCount(0);
      setNotice("All visible notifications marked read.");
    } catch (error) {
      setNotice(safeNotice(error, "Notifications could not be marked read."));
    } finally {
      setBusy("");
    }
  }

  async function updatePreference(mode: NotificationPreferenceMode) {
    if (busy) return;
    setBusy("preference");
    setNotice("");
    try {
      await organizerRequest("/api/organizer/notifications/preferences", {
        body: JSON.stringify({ mode }),
        method: "PATCH",
      });
      setPreference(mode);
      setNotice("Notification preference saved.");
    } catch (error) {
      setNotice(safeNotice(error, "The preference could not be saved."));
    } finally {
      setBusy("");
    }
  }

  async function loadMore() {
    if (!nextCursor || busy) return;
    setBusy("load-more");
    setNotice("");
    try {
      const body = await organizerRequest(
        `/api/organizer/notifications?limit=30&cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (!isNotificationPage(body)) {
        throw new TypeError("Unexpected notification page");
      }
      setNotifications((current) => [...current, ...body.notifications]);
      setNextCursor(body.nextCursor);
      setUnreadCount(body.unreadCount);
    } catch (error) {
      setNotice(safeNotice(error, "More notifications could not be loaded."));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className={styles.notificationCenter}>
      <section className={styles.notificationControls} aria-labelledby="notification-preferences-title">
        <div>
          <p className={styles.kicker}>Personal preference</p>
          <h2 id="notification-preferences-title">What reaches this inbox</h2>
          <p>No email or digest is sent.</p>
        </div>
        <fieldset>
          <legend className={styles.visuallyHidden}>Notification preference</legend>
          <label>
            <input
              checked={preference === "important_only"}
              name="notificationPreference"
              onChange={() => updatePreference("important_only")}
              type="radio"
            />
            <span>Important only</span>
          </label>
          <label>
            <input
              checked={preference === "all_relevant"}
              name="notificationPreference"
              onChange={() => updatePreference("all_relevant")}
              type="radio"
            />
            <span>All relevant</span>
          </label>
        </fieldset>
      </section>

      <div className={styles.notificationResultBar}>
        <p>
          <strong>{unreadCount}</strong>{" "}
          {unreadCount === 1 ? "unread notification" : "unread notifications"}
        </p>
        <button disabled={unreadCount === 0 || busy === "read-all"} onClick={markAllRead} type="button">
          {busy === "read-all" ? "Marking…" : "Mark all read"}
        </button>
      </div>

      <p className={styles.workspaceNotice} aria-live="polite">{notice}</p>

      {notifications.length > 0 ? (
        <ol className={styles.notificationList}>
          {notifications.map((notification) => {
            const content = notificationContent(notification);
            return (
              <li className={notification.read ? styles.notificationRead : undefined} key={notification.id}>
                <div>
                  <span className={styles.notificationState}>
                    {notification.read ? "Read" : "Unread"}
                  </span>
                  <h2>{content.heading}</h2>
                  <p>{content.detail}</p>
                  <small>{formatDateTime(notification.createdAt)}</small>
                  {content.href ? <Link href={content.href}>Open record</Link> : null}
                </div>
                <button
                  disabled={busy === notification.id}
                  onClick={() => setRead(notification, notification.read ? false : true)}
                  type="button"
                >
                  {busy === notification.id
                    ? "Saving…"
                    : notification.read
                      ? "Mark unread"
                      : "Mark read"}
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <section className={styles.pageState} aria-labelledby="notifications-empty-title">
          <p className={styles.kicker}>Inbox clear</p>
          <h2 id="notifications-empty-title">No notifications yet.</h2>
          <p>
            Relevant membership, assignment, private planning, conflict-review,
            and hold events will appear here when they genuinely occur.
          </p>
        </section>
      )}

      {nextCursor ? (
        <button className={styles.loadMoreButton} disabled={busy === "load-more"} onClick={loadMore} type="button">
          {busy === "load-more" ? "Loading…" : "Load older notifications"}
        </button>
      ) : null}
    </div>
  );
}

function notificationContent(notification: NotificationDto): Readonly<{
  detail: string;
  heading: string;
  href: string | null;
}> {
  const payload = notification.payload;
  if (payload.type === "invitation_accepted") {
    return {
      detail: `${payload.displayName} joined as ${payload.role}.`,
      heading: "Invitation accepted",
      href: "/organizer/team",
    };
  }
  if (payload.type === "membership_changed") {
    return {
      detail: `${payload.displayName}'s ${payload.change} changed.`,
      heading: "Team membership changed",
      href: "/organizer/team",
    };
  }
  if (payload.type === "club_assignment_changed") {
    return {
      detail: `${payload.displayName} was assigned to ${payload.clubName}.`,
      heading: "Club assignment changed",
      href: "/organizer/team",
    };
  }
  if (payload.type === "ownership_transferred") {
    return {
      detail: `${payload.displayName} is now the workspace Owner.`,
      heading: "Ownership transferred",
      href: "/organizer/team",
    };
  }
  const labels = {
    conflict_approved: "Conflict review approved",
    conflict_created: "New schedule conflict",
    conflict_rejected: "Conflict review rejected",
    conflict_review_requested: "Conflict review requested",
    draft_coordination_changed: "Draft coordination changed",
    event_assignment: "Event assignment",
    event_cancelled: "Private event cancelled",
    event_confirmed: "Private event confirmed",
    event_schedule_changed: "Draft schedule changed",
    hold_expired: "Tentative hold expired",
    hold_nearing_expiry: "Tentative hold nearing expiry",
  } as const;
  return {
    detail: payload.title,
    heading: labels[payload.type],
    href: `/organizer/events/${encodeURIComponent(payload.eventId)}`,
  };
}

function isNotificationPage(value: unknown): value is NotificationPage {
  return (
    isRecord(value) &&
    Array.isArray(value.notifications) &&
    typeof value.unreadCount === "number" &&
    (typeof value.nextCursor === "string" || value.nextCursor === null)
  );
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Vancouver",
  }).format(new Date(value));
}
