import {
  authorizeMembership,
  OrganizerAccessDeniedError,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  assertOnlyKeys,
  parseBoundedString,
  parseFiniteInteger,
  parseObject,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import { isValidIanaTimeZone } from "../../time";

const WORKSPACE_SETTINGS_KEY = "organizer_workspace";
const DEFAULT_WORKSPACE_NAME = "Vancouver Curiosity Club";
const DEFAULT_TIMEZONE = "America/Vancouver";

export type WorkspaceSettingsDto = Readonly<{
  defaultTimezone: string;
  workspaceName: string;
}>;

export async function getWorkspaceSettings(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
): Promise<WorkspaceSettingsDto> {
  const actor = await authorizeMembership(database, identity);
  const row = await database
    .prepare(
      `WITH current_actor AS (
         SELECT membership.organization_id
         FROM organization_memberships AS membership
         JOIN profiles AS profile
           ON profile.id = membership.profile_id
          AND profile.normalized_email = ?
          AND profile.status = 'active'
          AND profile.deleted_at IS NULL
         JOIN organizations AS organization
           ON organization.id = membership.organization_id
          AND organization.deleted_at IS NULL
         WHERE membership.id = ?
           AND membership.organization_id = ?
           AND membership.profile_id = ?
           AND membership.role = ?
           AND membership.normalized_email = ?
           AND membership.status = 'active'
           AND membership.deleted_at IS NULL
         LIMIT 1
       )
       SELECT setting.value_json
       FROM current_actor
       LEFT JOIN site_settings AS setting
         ON setting.organization_id = current_actor.organization_id
        AND setting.key = ?
        AND setting.is_public = 0
       LIMIT 1`,
    )
    .bind(
      identity.email,
      actor.membershipId,
      actor.organizationId,
      actor.profileId,
      actor.role,
      identity.email,
      WORKSPACE_SETTINGS_KEY,
    )
    .first<Record<string, unknown>>();
  if (!row) {
    throw new OrganizerAccessDeniedError("inactive_membership");
  }
  if (row.value_json === null || row.value_json === undefined) {
    return Object.freeze({
      workspaceName: DEFAULT_WORKSPACE_NAME,
      defaultTimezone: DEFAULT_TIMEZONE,
    });
  }
  const parsed = parseStoredSettings(row.value_json);
  if (!parsed) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "Workspace settings are temporarily unavailable.",
    );
  }
  return parsed;
}

export async function updateWorkspaceSettings(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<WorkspaceSettingsDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const input = parseObject(inputValue);
  assertOnlyKeys(input, ["defaultTimezone", "workspaceName"]);
  const workspaceName = parseBoundedString(input.workspaceName, {
    path: "workspaceName",
    minLength: 1,
    maxLength: 120,
  });
  const defaultTimezone = parseBoundedString(input.defaultTimezone, {
    path: "defaultTimezone",
    minLength: 1,
    maxLength: 100,
  });
  if (!isValidIanaTimeZone(defaultTimezone)) {
    throw new SafeApplicationError(
      "validation_failed",
      422,
      "The default timezone could not be validated.",
    );
  }
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const metadata = JSON.stringify({
    fields: ["default_timezone", "workspace_name"],
  });
  const valueJson = JSON.stringify({
    defaultTimezone,
    workspaceName,
  });
  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO site_settings (
           id, organization_id, key, value_json, is_public,
           updated_by_profile_id, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, 0, ?, ?, ?
         WHERE EXISTS (
           SELECT 1
           FROM organizations
           WHERE id = ?
             AND deleted_at IS NULL
         )
           AND EXISTS (
             SELECT 1
             FROM organization_memberships AS actor_membership
             JOIN profiles AS actor_profile
               ON actor_profile.id = actor_membership.profile_id
             WHERE actor_membership.id = ?
               AND actor_membership.organization_id = ?
               AND actor_membership.profile_id = ?
               AND actor_membership.role IN ('owner', 'administrator')
               AND actor_membership.status = 'active'
               AND actor_membership.deleted_at IS NULL
               AND actor_profile.status = 'active'
               AND actor_profile.deleted_at IS NULL
           )
         ON CONFLICT(organization_id, key) DO UPDATE SET
           value_json = excluded.value_json,
           is_public = 0,
           updated_by_profile_id = excluded.updated_by_profile_id,
           updated_at = excluded.updated_at
         WHERE site_settings.is_public = 0`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        WORKSPACE_SETTINGS_KEY,
        valueJson,
        actor.profileId,
        now,
        now,
        actor.organizationId,
        actor.membershipId,
        actor.organizationId,
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
             FROM site_settings
             WHERE organization_id = ?
               AND key = ?
               AND value_json = ?
               AND is_public = 0
           ) THEN 'organization.settings_updated' ELSE NULL END,
           'organization', ?, ?, ?
         )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.organizationId,
        actor.profileId,
        actor.organizationId,
        WORKSPACE_SETTINGS_KEY,
        valueJson,
        actor.organizationId,
        metadata,
        now,
      ),
  ]);
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "Workspace settings changed before this update could be applied.",
    );
  }
  return Object.freeze({ workspaceName, defaultTimezone });
}

function parseStoredSettings(value: unknown): WorkspaceSettingsDto | null {
  if (typeof value !== "string") return null;
  try {
    const raw = JSON.parse(value) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return null;
    }
    const workspaceName = Reflect.get(raw, "workspaceName");
    const defaultTimezone = Reflect.get(raw, "defaultTimezone");
    if (
      typeof workspaceName !== "string" ||
      workspaceName.length < 1 ||
      workspaceName.length > 120 ||
      typeof defaultTimezone !== "string" ||
      !isValidIanaTimeZone(defaultTimezone)
    ) {
      return null;
    }
    return Object.freeze({ workspaceName, defaultTimezone });
  } catch {
    return null;
  }
}

function changes(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  const meta = Reflect.get(result, "meta");
  if (typeof meta !== "object" || meta === null) return 0;
  const value = Reflect.get(meta, "changes");
  return typeof value === "number" ? value : 0;
}
