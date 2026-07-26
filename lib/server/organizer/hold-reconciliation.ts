import {
  authorizeMembership,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import { SafeApplicationError } from "../../validation/server-observability";
import { getOrganizerConflictPolicy } from "./conflict-policy";
import { currentD1Time } from "./conflicts";

const MAX_HOLD_NOTICE_RECIPIENTS_PER_RECONCILIATION = 20;

type DueHoldNotice = Readonly<{
  eventId: string;
  noticeType: "expired" | "nearing_expiry";
  recipientProfileId: string;
  scheduleVersion: number;
  title: string;
}>;

/**
 * Reconciles due hold notices from D1 time. No scheduler or process memory is
 * authoritative: the durable receipt unique key makes concurrent Worker
 * isolates idempotent for each event/schedule-version/type/recipient tuple.
 */
export async function reconcileOrganizerHoldNotices(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
): Promise<Readonly<{ created: number; examined: number }>> {
  const actor = await authorizeMembership(database, identity);
  const [policy, now] = await Promise.all([
    getOrganizerConflictPolicy(database, identity),
    currentD1Time(database),
  ]);
  const dueResult = await database
    .prepare(
      `WITH recipients AS (
         SELECT event.organization_id,
                event.id AS organizer_event_id,
                event.primary_organizer_profile_id AS profile_id
         FROM organizer_events AS event
         WHERE event.organization_id = ?
         UNION
         SELECT association.organization_id,
                association.organizer_event_id,
                association.profile_id
         FROM organizer_event_organizers AS association
         WHERE association.organization_id = ?
           AND association.deleted_at IS NULL
       )
       SELECT event.id AS event_id,
              event.title,
              state.schedule_version,
              recipient.profile_id AS recipient_profile_id,
              CASE
                WHEN state.hold_expires_at <= ? THEN 'expired'
                ELSE 'nearing_expiry'
              END AS notice_type
       FROM organizer_reservation_states AS state
       JOIN organizer_events AS event
         ON event.id = state.organizer_event_id
        AND event.organization_id = state.organization_id
        AND event.deleted_at IS NULL
       JOIN recipients AS recipient
         ON recipient.organization_id = state.organization_id
        AND recipient.organizer_event_id = state.organizer_event_id
       JOIN profiles AS profile
         ON profile.id = recipient.profile_id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
       JOIN organization_memberships AS membership
         ON membership.organization_id = state.organization_id
        AND membership.profile_id = recipient.profile_id
        AND membership.status = 'active'
        AND membership.deleted_at IS NULL
       WHERE state.organization_id = ?
         AND state.planning_status = 'tentative_hold'
         AND state.hold_expires_at IS NOT NULL
         AND state.hold_expires_at <= ?
         AND NOT EXISTS (
           SELECT 1
           FROM organizer_hold_notice_receipts AS receipt
           WHERE receipt.organization_id = state.organization_id
             AND receipt.organizer_event_id = state.organizer_event_id
             AND receipt.schedule_version = state.schedule_version
             AND receipt.notice_type = CASE
               WHEN state.hold_expires_at <= ? THEN 'expired'
               ELSE 'nearing_expiry'
             END
             AND receipt.recipient_profile_id = recipient.profile_id
         )
       ORDER BY state.hold_expires_at, event.id, recipient.profile_id
       LIMIT ?`,
    )
    .bind(
      actor.organizationId,
      actor.organizationId,
      now,
      actor.organizationId,
      now + policy.nearingExpiryHours * 60 * 60_000,
      now,
      MAX_HOLD_NOTICE_RECIPIENTS_PER_RECONCILIATION,
    )
    .all<Record<string, unknown>>();
  const due = Object.freeze((dueResult.results ?? []).map(readDueNotice));
  if (due.length === 0) {
    return Object.freeze({ created: 0, examined: 0 });
  }

  const noticeKeys = await Promise.all(
    due.map((notice) =>
      deterministicNoticeKey(
        actor.organizationId,
        notice.eventId,
        notice.scheduleVersion,
        notice.noticeType,
        notice.recipientProfileId,
      ),
    ),
  );
  const statements = due.flatMap((notice, noticeIndex) => {
    const key = noticeKeys[noticeIndex];
    const notificationId = `notification:hold:${key}`;
    const receiptId = `hold-notice:${key}`;
    const notificationType =
      notice.noticeType === "expired"
        ? "hold_expired"
        : "hold_nearing_expiry";
    return [
      database
        .prepare(
          `INSERT OR IGNORE INTO notifications (
             id, organization_id, recipient_profile_id, type,
             payload_json, read_at, created_at, deleted_at
           )
           SELECT ?, event.organization_id, ?, ?, ?, NULL, ?, NULL
           FROM organizer_events AS event
           JOIN organizer_reservation_states AS state
             ON state.organizer_event_id = event.id
            AND state.organization_id = event.organization_id
           WHERE event.id = ?
             AND event.organization_id = ?
             AND event.deleted_at IS NULL
             AND state.planning_status = 'tentative_hold'
             AND state.schedule_version = ?
             AND state.hold_expires_at IS NOT NULL
             AND CASE
               WHEN state.hold_expires_at <= ? THEN 'expired'
               ELSE 'nearing_expiry'
             END = ?
             AND state.hold_expires_at <= ?
             AND EXISTS (
               SELECT 1
               FROM profiles AS recipient_profile
               JOIN organization_memberships AS recipient_membership
                 ON recipient_membership.profile_id = recipient_profile.id
                AND recipient_membership.organization_id =
                    event.organization_id
                AND recipient_membership.status = 'active'
                AND recipient_membership.deleted_at IS NULL
               WHERE recipient_profile.id = ?
                 AND recipient_profile.status = 'active'
                 AND recipient_profile.deleted_at IS NULL
             )
             AND NOT EXISTS (
               SELECT 1
               FROM organizer_hold_notice_receipts AS receipt
               WHERE receipt.organization_id = event.organization_id
                 AND receipt.organizer_event_id = event.id
                 AND receipt.schedule_version = state.schedule_version
                 AND receipt.notice_type = ?
                 AND receipt.recipient_profile_id = ?
             )`,
        )
        .bind(
          notificationId,
          notice.recipientProfileId,
          notificationType,
          JSON.stringify({
            eventId: notice.eventId,
            title: notice.title,
          }),
          now,
          notice.eventId,
          actor.organizationId,
          notice.scheduleVersion,
          now,
          notice.noticeType,
          now + policy.nearingExpiryHours * 60 * 60_000,
          notice.recipientProfileId,
          notice.noticeType,
          notice.recipientProfileId,
        ),
      database
        .prepare(
          `INSERT OR IGNORE INTO organizer_hold_notice_receipts (
             id, organization_id, organizer_event_id, schedule_version,
             notice_type, recipient_profile_id, notification_id, created_at
           )
           SELECT ?, ?, ?, ?, ?, ?, notification.id, ?
           FROM notifications AS notification
           WHERE notification.id = ?
             AND notification.organization_id = ?
             AND notification.recipient_profile_id = ?
             AND NOT EXISTS (
               SELECT 1
               FROM organizer_hold_notice_receipts AS receipt
               WHERE receipt.organizer_event_id = ?
                 AND receipt.schedule_version = ?
                 AND receipt.notice_type = ?
                 AND receipt.recipient_profile_id = ?
             )`,
        )
        .bind(
          receiptId,
          actor.organizationId,
          notice.eventId,
          notice.scheduleVersion,
          notice.noticeType,
          notice.recipientProfileId,
          now,
          notificationId,
          actor.organizationId,
          notice.recipientProfileId,
          notice.eventId,
          notice.scheduleVersion,
          notice.noticeType,
          notice.recipientProfileId,
        ),
    ];
  });
  const results = await database.batch(statements);
  let created = 0;
  for (let index = 1; index < results.length; index += 2) {
    created += changes(results[index]);
  }
  return Object.freeze({ created, examined: due.length });
}

async function deterministicNoticeKey(
  organizationId: string,
  eventId: string,
  scheduleVersion: number,
  noticeType: DueHoldNotice["noticeType"],
  recipientProfileId: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      organizationId,
      eventId,
      scheduleVersion,
      noticeType,
      recipientProfileId,
    ]),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function readDueNotice(row: Record<string, unknown>): DueHoldNotice {
  const eventId = requiredString(row.event_id);
  const recipientProfileId = requiredString(row.recipient_profile_id);
  const title = requiredString(row.title);
  const scheduleVersion = requiredInteger(row.schedule_version);
  const noticeType =
    row.notice_type === "expired" || row.notice_type === "nearing_expiry"
      ? row.notice_type
      : null;
  if (!noticeType) throw unavailable();
  return Object.freeze({
    eventId,
    noticeType,
    recipientProfileId,
    scheduleVersion,
    title,
  });
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw unavailable();
  return value;
}

function requiredInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw unavailable();
  }
  return value;
}

function changes(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const meta = Reflect.get(result, "meta");
  if (!meta || typeof meta !== "object") return 0;
  const count = Reflect.get(meta, "changes");
  return typeof count === "number" ? count : 0;
}

function unavailable(): SafeApplicationError {
  return new SafeApplicationError(
    "service_unavailable",
    503,
    "Hold notification reconciliation is unavailable.",
  );
}
