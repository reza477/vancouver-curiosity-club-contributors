import {
  authorizeMembership,
  type AuthorizedMembership,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";

export const NOTIFICATION_TYPES = [
  "invitation_accepted",
  "membership_changed",
  "club_assignment_changed",
  "ownership_transferred",
  "event_assignment",
  "event_schedule_changed",
  "draft_coordination_changed",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationPreferenceMode =
  | "all_relevant"
  | "important_only";

export type SafeNotificationPayload =
  | Readonly<{
      displayName: string;
      membershipId: string;
      role: "administrator" | "organizer";
      type: "invitation_accepted";
    }>
  | Readonly<{
      change: "clubs" | "role" | "status";
      displayName: string;
      membershipId: string;
      type: "membership_changed";
    }>
  | Readonly<{
      clubId: string;
      clubName: string;
      displayName: string;
      membershipId: string;
      type: "club_assignment_changed";
    }>
  | Readonly<{
      displayName: string;
      membershipId: string;
      type: "ownership_transferred";
    }>
  | Readonly<{
      eventId: string;
      title: string;
      type:
        | "draft_coordination_changed"
        | "event_assignment"
        | "event_schedule_changed";
    }>;

export type NotificationDto = Readonly<{
  createdAt: number;
  id: string;
  payload: SafeNotificationPayload;
  read: boolean;
  type: NotificationType;
}>;

export type NotificationPage = Readonly<{
  nextCursor: string | null;
  notifications: readonly NotificationDto[];
  unreadCount: number;
}>;

const IMPORTANT_NOTIFICATION_TYPES = new Set<NotificationType>([
  "invitation_accepted",
  "membership_changed",
  "ownership_transferred",
  "event_schedule_changed",
]);

export async function listNotifications(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  options: Readonly<{ cursor?: unknown; limit?: unknown }> = {},
): Promise<NotificationPage> {
  const actor = await authorizeMembership(database, identity);
  const limit =
    options.limit === undefined
      ? 30
      : parseFiniteInteger(options.limit, {
          path: "limit",
          minimum: 1,
          maximum: 50,
        });
  const cursor = parseNotificationCursor(options.cursor);
  const cursorClause = cursor
    ? `AND (
         notification.created_at < ?
         OR (
           notification.created_at = ?
           AND notification.id < ?
         )
       )`
    : "";
  const statement = database.prepare(
    `SELECT notification.id,
            notification.type,
            notification.payload_json,
            notification.read_at,
            notification.created_at
     FROM notifications AS notification
     WHERE notification.organization_id = ?
       AND notification.recipient_profile_id = ?
       AND notification.deleted_at IS NULL
       ${cursorClause}
     ORDER BY notification.created_at DESC, notification.id DESC
     LIMIT ?`,
  );
  const result = cursor
    ? await statement
        .bind(
          actor.organizationId,
          actor.profileId,
          cursor.createdAt,
          cursor.createdAt,
          cursor.id,
          limit + 1,
        )
        .all<Record<string, unknown>>()
    : await statement
        .bind(actor.organizationId, actor.profileId, limit + 1)
        .all<Record<string, unknown>>();

  const decoded = (result.results ?? [])
    .map(readNotification)
    .filter((value): value is NotificationDto => value !== null);
  const hasMore = decoded.length > limit;
  const notifications = decoded.slice(0, limit);
  const last = notifications.at(-1);

  return Object.freeze({
    notifications: Object.freeze(notifications),
    nextCursor:
      hasMore && last ? `${last.createdAt}.${last.id}` : null,
    unreadCount: await getUnreadNotificationCount(database, actor),
  });
}

export async function getUnreadNotificationCount(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
): Promise<number> {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS unread_count
       FROM notifications
       WHERE organization_id = ?
         AND recipient_profile_id = ?
         AND read_at IS NULL
         AND deleted_at IS NULL`,
    )
    .bind(actor.organizationId, actor.profileId)
    .first<Record<string, unknown>>();
  return readNonnegativeInteger(row?.unread_count) ?? 0;
}

export async function setNotificationReadState(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  notificationIdInput: unknown,
  readInput: unknown,
  nowUtcMs = Date.now(),
): Promise<Readonly<{ id: string; read: boolean }>> {
  const actor = await authorizeMembership(database, identity);
  const notificationId = parseIdentifier(
    notificationIdInput,
    "notificationId",
  );
  const read = parseBoolean(readInput, "read");
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const result = await database
    .prepare(
      `UPDATE notifications
       SET read_at = ?
       WHERE id = ?
         AND organization_id = ?
         AND recipient_profile_id = ?
         AND deleted_at IS NULL`,
    )
    .bind(
      read ? now : null,
      notificationId,
      actor.organizationId,
      actor.profileId,
    )
    .run();
  if (changes(result) !== 1) throw privateNotFound();
  return Object.freeze({ id: notificationId, read });
}

export async function markAllNotificationsRead(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  nowUtcMs = Date.now(),
): Promise<Readonly<{ markedRead: number }>> {
  const actor = await authorizeMembership(database, identity);
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const result = await database
    .prepare(
      `UPDATE notifications
       SET read_at = ?
       WHERE organization_id = ?
         AND recipient_profile_id = ?
         AND read_at IS NULL
         AND deleted_at IS NULL`,
    )
    .bind(now, actor.organizationId, actor.profileId)
    .run();
  return Object.freeze({ markedRead: changes(result) });
}

export async function updateNotificationPreferenceMode(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  modeInput: unknown,
  nowUtcMs = Date.now(),
): Promise<Readonly<{ mode: NotificationPreferenceMode }>> {
  const actor = await authorizeMembership(database, identity);
  const mode = parseEnum(
    modeInput,
    ["all_relevant", "important_only"] as const,
    "mode",
  );
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO organizer_profile_preferences (
           profile_id, organization_id, initials, calendar_color,
           public_biography, notification_preference_mode,
           created_at, updated_at
         )
         SELECT profile.id, ?, NULL, NULL, NULL, ?, ?, ?
         FROM profiles AS profile
         WHERE profile.id = ?
           AND profile.status = 'active'
           AND profile.deleted_at IS NULL
         ON CONFLICT(profile_id) DO UPDATE SET
           notification_preference_mode =
             excluded.notification_preference_mode,
           updated_at = excluded.updated_at
         WHERE organizer_profile_preferences.organization_id =
               excluded.organization_id`,
      )
      .bind(
        actor.organizationId,
        mode,
        now,
        now,
        actor.profileId,
      ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         )
         VALUES (
           ?, ?, ?,
           CASE WHEN EXISTS (
             SELECT 1
             FROM organizer_profile_preferences
             WHERE profile_id = ?
               AND organization_id = ?
               AND notification_preference_mode = ?
           ) THEN 'profile.notification_preference_changed' ELSE NULL END,
           'profile', ?, ?, ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        actor.profileId,
        actor.organizationId,
        mode,
        actor.profileId,
        JSON.stringify({ mode }),
        now,
      ),
  ]);
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "The notification preference could not be updated.",
    );
  }
  return Object.freeze({ mode });
}

/**
 * Creates one prepared notification insert for inclusion in a caller-owned
 * atomic `DB.batch()`. The payload is serialized only after passing the
 * explicit type-specific allowlist below.
 */
export function prepareNotificationInsert(
  database: D1DatabaseLike,
  input: Readonly<{
    createdAt: number;
    id?: string;
    organizationId: string;
    payload: SafeNotificationPayload;
    recipientProfileId: string;
  }>,
): D1PreparedStatementLike {
  const payload = normalizeNotificationPayload(input.payload);
  const important = IMPORTANT_NOTIFICATION_TYPES.has(payload.type) ? 1 : 0;
  return database
    .prepare(
      `INSERT INTO notifications (
         id, organization_id, recipient_profile_id, type,
         payload_json, read_at, created_at, deleted_at
       )
       SELECT ?, ?, profile.id, ?, ?, NULL, ?, NULL
       FROM profiles AS profile
       LEFT JOIN organizer_profile_preferences AS preference
         ON preference.profile_id = profile.id
        AND preference.organization_id = ?
       WHERE profile.id = ?
         AND profile.status = 'active'
         AND profile.deleted_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM organization_memberships AS recipient_membership
           WHERE recipient_membership.organization_id = ?
             AND recipient_membership.profile_id = profile.id
             AND recipient_membership.status = 'active'
             AND recipient_membership.deleted_at IS NULL
         )
         AND (
           COALESCE(
             preference.notification_preference_mode,
             'all_relevant'
           ) = 'all_relevant'
           OR (
             preference.notification_preference_mode = 'important_only'
             AND ? = 1
           )
         )`,
    )
    .bind(
      input.id ?? crypto.randomUUID(),
      parseIdentifier(input.organizationId, "organizationId"),
      payload.type,
      JSON.stringify(withoutType(payload)),
      parseFiniteInteger(input.createdAt, {
        path: "createdAt",
        minimum: 0,
      }),
      parseIdentifier(input.organizationId, "organizationId"),
      parseIdentifier(input.recipientProfileId, "recipientProfileId"),
      parseIdentifier(input.organizationId, "organizationId"),
      important,
    );
}

export function normalizeNotificationPayload(
  payload: unknown,
): SafeNotificationPayload {
  if (!isRecord(payload)) {
    throw validationError();
  }
  const type = parseEnum(payload.type, NOTIFICATION_TYPES, "type");
  if (
    type === "event_assignment" ||
    type === "event_schedule_changed" ||
    type === "draft_coordination_changed"
  ) {
    return Object.freeze({
      type,
      eventId: parseIdentifier(payload.eventId, "eventId"),
      title: safeDisplayText(payload.title, "title", 160),
    });
  }
  if (type === "invitation_accepted") {
    return Object.freeze({
      type,
      membershipId: parseIdentifier(
        payload.membershipId,
        "membershipId",
      ),
      displayName: safeDisplayText(
        payload.displayName,
        "displayName",
        120,
      ),
      role: parseEnum(
        payload.role,
        ["administrator", "organizer"] as const,
        "role",
      ),
    });
  }
  if (type === "membership_changed") {
    return Object.freeze({
      type,
      membershipId: parseIdentifier(
        payload.membershipId,
        "membershipId",
      ),
      displayName: safeDisplayText(
        payload.displayName,
        "displayName",
        120,
      ),
      change: parseEnum(
        payload.change,
        ["clubs", "role", "status"] as const,
        "change",
      ),
    });
  }
  if (type === "club_assignment_changed") {
    return Object.freeze({
      type,
      membershipId: parseIdentifier(
        payload.membershipId,
        "membershipId",
      ),
      displayName: safeDisplayText(
        payload.displayName,
        "displayName",
        120,
      ),
      clubId: parseIdentifier(payload.clubId, "clubId"),
      clubName: safeDisplayText(payload.clubName, "clubName", 120),
    });
  }
  return Object.freeze({
    type: "ownership_transferred",
    membershipId: parseIdentifier(payload.membershipId, "membershipId"),
    displayName: safeDisplayText(
      payload.displayName,
      "displayName",
      120,
    ),
  });
}

function readNotification(
  row: Record<string, unknown>,
): NotificationDto | null {
  const id = readString(row.id);
  const type = NOTIFICATION_TYPES.find((value) => value === row.type);
  const createdAt = readNonnegativeInteger(row.created_at);
  if (!id || !type || createdAt === null) return null;

  let raw: unknown;
  try {
    raw =
      typeof row.payload_json === "string"
        ? (JSON.parse(row.payload_json) as unknown)
        : null;
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;

  try {
    const payload = normalizeNotificationPayload({
      ...raw,
      type,
    });
    return Object.freeze({
      id,
      type,
      payload,
      read: typeof row.read_at === "number",
      createdAt,
    });
  } catch {
    return null;
  }
}

function parseNotificationCursor(
  value: unknown,
): Readonly<{ createdAt: number; id: string }> | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw validationError();
  const match = /^(\d+)\.([A-Za-z0-9][A-Za-z0-9:_-]{0,127})$/u.exec(value);
  if (!match) throw validationError();
  const createdAt = Number(match[1]);
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    throw validationError();
  }
  return Object.freeze({ createdAt, id: match[2] });
}

function safeDisplayText(
  value: unknown,
  path: string,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > maximum ||
    /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    throw new SafeApplicationError(
      "validation_failed",
      422,
      `The ${path} value could not be validated.`,
    );
  }
  return value.trim();
}

function parseBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new SafeApplicationError(
      "validation_failed",
      422,
      `The ${path} value could not be validated.`,
    );
  }
  return value;
}

function withoutType(
  payload: SafeNotificationPayload,
): Readonly<Record<string, string>> {
  if (
    payload.type === "event_assignment" ||
    payload.type === "event_schedule_changed" ||
    payload.type === "draft_coordination_changed"
  ) {
    return Object.freeze({
      eventId: payload.eventId,
      title: payload.title,
    });
  }
  if (payload.type === "invitation_accepted") {
    return Object.freeze({
      membershipId: payload.membershipId,
      displayName: payload.displayName,
      role: payload.role,
    });
  }
  if (payload.type === "membership_changed") {
    return Object.freeze({
      membershipId: payload.membershipId,
      displayName: payload.displayName,
      change: payload.change,
    });
  }
  if (payload.type === "club_assignment_changed") {
    return Object.freeze({
      membershipId: payload.membershipId,
      displayName: payload.displayName,
      clubId: payload.clubId,
      clubName: payload.clubName,
    });
  }
  if (payload.type === "ownership_transferred") {
    return Object.freeze({
      membershipId: payload.membershipId,
      displayName: payload.displayName,
    });
  }
  throw validationError();
}

function readNonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function changes(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  const meta = Reflect.get(result, "meta");
  if (typeof meta !== "object" || meta === null) return 0;
  const value = Reflect.get(meta, "changes");
  return typeof value === "number" ? value : 0;
}

function privateNotFound(): SafeApplicationError {
  return new SafeApplicationError(
    "not_found",
    404,
    "The requested notification is not available.",
  );
}

function validationError(): SafeApplicationError {
  return new SafeApplicationError(
    "validation_failed",
    422,
    "The request could not be validated.",
  );
}
