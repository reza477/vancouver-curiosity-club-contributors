import {
  authorizeMembership,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  assertOnlyKeys,
  parseBoundedString,
  parseEnum,
  parseFiniteInteger,
  parseObject,
  parseOptionalBoundedString,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import type { NotificationPreferenceMode } from "./notifications";

export const CALENDAR_COLOR_TOKENS = [
  "forest",
  "cobalt",
  "coral",
  "amber",
  "plum",
  "teal",
] as const;

export type CalendarColorToken =
  (typeof CALENDAR_COLOR_TOKENS)[number];

export type OrganizerProfileDto = Readonly<{
  assignedClubs: readonly Readonly<{ id: string; name: string }>[];
  calendarColor: CalendarColorToken;
  displayName: string;
  initials: string;
  notificationPreferenceMode: NotificationPreferenceMode;
  publicAttributionConsent: boolean;
  publicBiography: string | null;
  role: "administrator" | "organizer" | "owner";
}>;

export async function getOrganizerProfile(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
): Promise<OrganizerProfileDto> {
  const actor = await authorizeMembership(database, identity);
  const row = await database
    .prepare(
      `SELECT COALESCE(
                preference.workspace_display_name,
                profile.display_name
              ) AS display_name,
              preference.initials,
              preference.calendar_color,
              preference.public_biography,
              COALESCE(
                preference.public_attribution_consent_draft,
                profile.public_attribution_consent
              ) AS public_attribution_consent,
              preference.notification_preference_mode
       FROM profiles AS profile
       LEFT JOIN organizer_profile_preferences AS preference
         ON preference.profile_id = profile.id
        AND preference.organization_id = ?
       WHERE profile.id = ?
         AND profile.status = 'active'
         AND profile.deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(actor.organizationId, actor.profileId)
    .first<Record<string, unknown>>();
  if (!row) throw unavailableProfile();

  const clubs = await database
    .prepare(
      `SELECT club.id, club.name
       FROM club_memberships AS assignment
       JOIN clubs AS club
         ON club.id = assignment.club_id
        AND club.organization_id = assignment.organization_id
        AND club.deleted_at IS NULL
       WHERE assignment.organization_id = ?
         AND assignment.profile_id = ?
         AND assignment.status = 'active'
         AND assignment.deleted_at IS NULL
       ORDER BY club.name COLLATE NOCASE ASC, club.id ASC
       LIMIT 100`,
    )
    .bind(actor.organizationId, actor.profileId)
    .all<Record<string, unknown>>();

  return profileFromRows(row, clubs.results ?? [], actor.role);
}

export async function updateOrganizerProfile(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<OrganizerProfileDto> {
  const actor = await authorizeMembership(database, identity);
  const input = parseObject(inputValue);
  assertOnlyKeys(input, [
    "calendarColor",
    "displayName",
    "initials",
    "publicAttributionConsent",
    "publicBiography",
  ]);
  const displayName = parseBoundedString(input.displayName, {
    path: "displayName",
    minLength: 1,
    maxLength: 120,
  });
  const initials = parseInitials(input.initials);
  const calendarColor = parseEnum(
    input.calendarColor,
    CALENDAR_COLOR_TOKENS,
    "calendarColor",
  );
  const publicBiography = parseOptionalBoundedString(
    input.publicBiography,
    {
      path: "publicBiography",
      maxLength: 800,
    },
  );
  const publicAttributionConsent = parseBoolean(
    input.publicAttributionConsent,
    "publicAttributionConsent",
  );
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const metadata = JSON.stringify({
    fields: [
      "calendar_color",
      "display_name",
      "initials",
      "public_attribution_consent",
      "public_biography",
    ],
  });

  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO organizer_profile_preferences (
           profile_id, organization_id, initials, calendar_color,
           workspace_display_name, public_biography,
           public_attribution_consent_draft, notification_preference_mode,
           created_at, updated_at
         )
         SELECT profile.id, ?, ?, ?, ?, ?, ?, 'all_relevant', ?, ?
         FROM profiles AS profile
         WHERE profile.id = ?
           AND profile.status = 'active'
           AND profile.deleted_at IS NULL
         ON CONFLICT(profile_id) DO UPDATE SET
           initials = excluded.initials,
           calendar_color = excluded.calendar_color,
           workspace_display_name = excluded.workspace_display_name,
           public_biography = excluded.public_biography,
           public_attribution_consent_draft =
             excluded.public_attribution_consent_draft,
           updated_at = excluded.updated_at
         WHERE organizer_profile_preferences.organization_id =
               excluded.organization_id`,
      )
      .bind(
        actor.organizationId,
        initials,
        calendarColor,
        displayName,
        publicBiography,
        publicAttributionConsent ? 1 : 0,
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
             FROM profiles AS profile
             JOIN organizer_profile_preferences AS preference
               ON preference.profile_id = profile.id
              AND preference.organization_id = ?
             WHERE profile.id = ?
               AND preference.workspace_display_name = ?
               AND preference.initials = ?
               AND preference.calendar_color = ?
               AND preference.public_attribution_consent_draft = ?
               AND (
                 preference.public_biography = ?
                 OR (
                   preference.public_biography IS NULL
                   AND ? IS NULL
                 )
               )
               AND profile.status = 'active'
               AND profile.deleted_at IS NULL
           ) THEN 'profile.updated' ELSE NULL END,
           'profile', ?, ?, ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        actor.organizationId,
        actor.profileId,
        displayName,
        initials,
        calendarColor,
        publicAttributionConsent ? 1 : 0,
        publicBiography,
        publicBiography,
        actor.profileId,
        metadata,
        now,
      ),
  ]);
  if (
    changes(results[0]) !== 1 ||
    changes(results[1]) !== 1
  ) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "The profile could not be updated.",
    );
  }

  return getOrganizerProfile(database, identity);
}

function profileFromRows(
  row: Record<string, unknown>,
  clubRows: readonly Record<string, unknown>[],
  role: OrganizerProfileDto["role"],
): OrganizerProfileDto {
  const displayName =
    readString(row.display_name) ?? "Organizer";
  const initials =
    parseStoredInitials(row.initials) ?? deriveInitials(displayName);
  const calendarColor =
    CALENDAR_COLOR_TOKENS.find(
      (value) => value === row.calendar_color,
    ) ?? "forest";
  const mode: NotificationPreferenceMode =
    row.notification_preference_mode === "important_only"
      ? "important_only"
      : "all_relevant";
  const assignedClubs = clubRows
    .map((club) => {
      const id = readString(club.id);
      const name = readString(club.name);
      return id && name ? Object.freeze({ id, name }) : null;
    })
    .filter(
      (
        club,
      ): club is Readonly<{
        id: string;
        name: string;
      }> => club !== null,
    );

  return Object.freeze({
    displayName,
    initials,
    calendarColor,
    publicBiography: readNullableString(row.public_biography),
    publicAttributionConsent:
      row.public_attribution_consent === 1 ||
      row.public_attribution_consent === true,
    notificationPreferenceMode: mode,
    role,
    assignedClubs: Object.freeze(assignedClubs),
  });
}

function parseInitials(value: unknown): string {
  const initials = parseBoundedString(value, {
    path: "initials",
    minLength: 1,
    maxLength: 4,
  }).toLocaleUpperCase("en-CA");
  if (!/^[\p{L}\p{N}]{1,4}$/u.test(initials)) {
    throw validationError();
  }
  return initials;
}

function parseStoredInitials(value: unknown): string | null {
  try {
    return parseInitials(value);
  } catch {
    return null;
  }
}

function deriveInitials(displayName: string): string {
  const parts = displayName
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2);
  const initials = parts.map((part) => part[0] ?? "").join("");
  return initials.toLocaleUpperCase("en-CA").slice(0, 4) || "O";
}

function parseBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw validationError(path);
  return value;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function changes(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  const meta = Reflect.get(result, "meta");
  if (typeof meta !== "object" || meta === null) return 0;
  const value = Reflect.get(meta, "changes");
  return typeof value === "number" ? value : 0;
}

function unavailableProfile(): SafeApplicationError {
  return new SafeApplicationError(
    "not_found",
    404,
    "The organizer profile is not available.",
  );
}

function validationError(path?: string): SafeApplicationError {
  return new SafeApplicationError(
    "validation_failed",
    422,
    path
      ? `The ${path} value could not be validated.`
      : "The request could not be validated.",
  );
}
