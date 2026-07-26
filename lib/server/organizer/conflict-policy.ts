import {
  authorizeMembership,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  parseEnum,
  parseFiniteInteger,
  parseObject,
  assertOnlyKeys,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  CONFLICT_POLICY_MODES,
  type ConflictPolicyMode,
} from "./conflict-domain";

export type OrganizerConflictPolicyDto = Readonly<{
  defaultHoldHours: number;
  id: string;
  mode: ConflictPolicyMode;
  nearingExpiryHours: number;
  organizationId: string;
  version: number;
}>;

const POLICY_SELECT_SQL = `
SELECT id, organization_id, mode, policy_version, default_hold_hours,
       nearing_expiry_hours
FROM organizer_conflict_policies
WHERE organization_id = ?
LIMIT 1`;

export async function getOrganizerConflictPolicy(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
): Promise<OrganizerConflictPolicyDto> {
  const actor = await authorizeMembership(database, identity);
  let row = await database
    .prepare(POLICY_SELECT_SQL)
    .bind(actor.organizationId)
    .first<Record<string, unknown>>();
  if (!row) {
    const now = Date.now();
    await database
      .prepare(
        `INSERT INTO organizer_conflict_policies (
           id, organization_id, mode, policy_version, default_hold_hours,
           nearing_expiry_hours, updated_by_profile_id, created_at, updated_at
         )
         SELECT ?, ?, 'warn_reason', 1, 72, 24, ?, ?, ?
         WHERE EXISTS (
           SELECT 1
           FROM organization_memberships AS membership
           JOIN profiles AS profile
             ON profile.id = membership.profile_id
            AND profile.status = 'active'
            AND profile.deleted_at IS NULL
           WHERE membership.id = ?
             AND membership.organization_id = ?
             AND membership.profile_id = ?
             AND membership.status = 'active'
             AND membership.deleted_at IS NULL
         )
         ON CONFLICT(organization_id) DO NOTHING`,
      )
      .bind(
        `phase4-policy:${actor.organizationId}`,
        actor.organizationId,
        actor.profileId,
        now,
        now,
        actor.membershipId,
        actor.organizationId,
        actor.profileId,
      )
      .run();
    row = await database
      .prepare(POLICY_SELECT_SQL)
      .bind(actor.organizationId)
      .first<Record<string, unknown>>();
  }
  return readPolicy(row);
}

export async function updateOrganizerConflictPolicy(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  value: unknown,
): Promise<OrganizerConflictPolicyDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const input = parseObject(value, "body");
  assertOnlyKeys(
    input,
    [
      "defaultHoldHours",
      "expectedPolicyVersion",
      "mode",
      "nearingExpiryHours",
    ],
    "body",
  );
  const mode = parseEnum(input.mode, CONFLICT_POLICY_MODES, "mode");
  const defaultHoldHours = parseFiniteInteger(input.defaultHoldHours, {
    path: "defaultHoldHours",
    minimum: 1,
    maximum: 720,
  });
  const nearingExpiryHours = parseFiniteInteger(input.nearingExpiryHours, {
    path: "nearingExpiryHours",
    minimum: 1,
    maximum: defaultHoldHours,
  });
  const expectedVersion = parseFiniteInteger(input.expectedPolicyVersion, {
    path: "expectedPolicyVersion",
    minimum: 1,
  });
  const now = Date.now();
  const auditId = `audit:${crypto.randomUUID()}`;

  let results: Awaited<ReturnType<D1DatabaseLike["batch"]>>;
  try {
    results = await database.batch([
    database
      .prepare(
        `UPDATE organizer_conflict_overrides AS override
         SET invalidated_at = ?,
             invalidated_by_profile_id = ?
         WHERE override.organization_id = ?
           AND override.policy_version = ?
           AND override.invalidated_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM organizer_conflict_policies AS current_policy
             JOIN organization_memberships AS membership
               ON membership.organization_id =
                  current_policy.organization_id
              AND membership.id = ?
              AND membership.profile_id = ?
              AND membership.role IN ('owner', 'administrator')
              AND membership.status = 'active'
              AND membership.deleted_at IS NULL
             JOIN profiles AS profile
               ON profile.id = membership.profile_id
              AND profile.status = 'active'
              AND profile.deleted_at IS NULL
             WHERE current_policy.organization_id =
                   override.organization_id
               AND current_policy.policy_version = ?
           )`,
      )
      .bind(
        now,
        actor.profileId,
        actor.organizationId,
        expectedVersion,
        actor.membershipId,
        actor.profileId,
        expectedVersion,
      ),
    database
      .prepare(
        `UPDATE organizer_conflict_review_requests AS review
         SET state = 'invalidated',
             updated_at = ?
         WHERE review.organization_id = ?
           AND review.policy_version = ?
           AND review.state IN ('pending', 'approved')
           AND EXISTS (
             SELECT 1
             FROM organizer_conflict_policies AS current_policy
             JOIN organization_memberships AS membership
               ON membership.organization_id =
                  current_policy.organization_id
              AND membership.id = ?
              AND membership.profile_id = ?
              AND membership.role IN ('owner', 'administrator')
              AND membership.status = 'active'
              AND membership.deleted_at IS NULL
             JOIN profiles AS profile
               ON profile.id = membership.profile_id
              AND profile.status = 'active'
              AND profile.deleted_at IS NULL
             WHERE current_policy.organization_id =
                   review.organization_id
               AND current_policy.policy_version = ?
           )`,
      )
      .bind(
        now,
        actor.organizationId,
        expectedVersion,
        actor.membershipId,
        actor.profileId,
        expectedVersion,
      ),
    database
      .prepare(
        `UPDATE organizer_conflict_incidents AS incident
         SET state = 'invalidated',
             resolved_at = ?,
             updated_at = ?
         WHERE incident.organization_id = ?
           AND incident.policy_version = ?
           AND incident.state IN (
             'open', 'pending_approval', 'approved', 'informational'
           )
           AND EXISTS (
             SELECT 1
             FROM organizer_conflict_policies AS current_policy
             JOIN organization_memberships AS membership
               ON membership.organization_id =
                  current_policy.organization_id
              AND membership.id = ?
              AND membership.profile_id = ?
              AND membership.role IN ('owner', 'administrator')
              AND membership.status = 'active'
              AND membership.deleted_at IS NULL
             JOIN profiles AS profile
               ON profile.id = membership.profile_id
              AND profile.status = 'active'
              AND profile.deleted_at IS NULL
             WHERE current_policy.organization_id =
                   incident.organization_id
               AND current_policy.policy_version = ?
           )`,
      )
      .bind(
        now,
        now,
        actor.organizationId,
        expectedVersion,
        actor.membershipId,
        actor.profileId,
        expectedVersion,
      ),
    database
      .prepare(
        `UPDATE organizer_conflict_policies AS policy
         SET mode = ?,
             default_hold_hours = ?,
             nearing_expiry_hours = ?,
             policy_version = policy_version + 1,
             updated_by_profile_id = ?,
             updated_at = CASE
               WHEN ? > updated_at THEN ?
               ELSE updated_at + 1
             END
         WHERE policy.organization_id = ?
           AND policy.policy_version = ?
           AND EXISTS (
             SELECT 1
             FROM organization_memberships AS membership
             JOIN profiles AS profile
               ON profile.id = membership.profile_id
              AND profile.status = 'active'
              AND profile.deleted_at IS NULL
             WHERE membership.id = ?
               AND membership.organization_id = policy.organization_id
               AND membership.profile_id = ?
               AND membership.role IN ('owner', 'administrator')
               AND membership.status = 'active'
               AND membership.deleted_at IS NULL
           )`,
      )
      .bind(
        mode,
        defaultHoldHours,
        nearingExpiryHours,
        actor.profileId,
        now,
        now,
        actor.organizationId,
        expectedVersion,
        actor.membershipId,
        actor.profileId,
      ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action, entity_type,
           entity_id, metadata_json, created_at
         )
         VALUES (
           ?, ?, ?, 'conflict_policy.updated',
           'organizer_conflict_policy',
           CASE
             WHEN changes() = 1
             THEN (
               SELECT policy.id
               FROM organizer_conflict_policies AS policy
               WHERE policy.organization_id = ?
                 AND policy.policy_version = ?
             )
             ELSE NULL
           END,
           ?, ?
         )`,
      )
      .bind(
        auditId,
        actor.organizationId,
        actor.profileId,
        actor.organizationId,
        expectedVersion + 1,
        JSON.stringify({
          defaultHoldHours,
          mode,
          nearingExpiryHours,
          policyVersion: expectedVersion + 1,
        }),
        now,
      ),
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      /phase4_policy_update_forbidden|NOT NULL constraint failed: audit_logs\.entity_id/iu.test(
        `${error.message} ${
          (error as Error & { cause?: unknown }).cause ?? ""
        }`,
      )
    ) {
      throw stalePolicyEdit();
    }
    throw error;
  }
  if (
    changes(results[3]) !== 1 ||
    changes(results[4]) !== 1
  ) {
    throw stalePolicyEdit();
  }
  return getOrganizerConflictPolicy(database, identity);
}

function stalePolicyEdit(): SafeApplicationError {
  return new SafeApplicationError(
    "stale_edit",
    409,
    "The conflict policy changed in another session. Refresh before saving.",
  );
}

function readPolicy(
  row: Record<string, unknown> | null,
): OrganizerConflictPolicyDto {
  if (!row) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The conflict policy is not available.",
    );
  }
  const id = stringValue(row.id);
  const organizationId = stringValue(row.organization_id);
  const mode = CONFLICT_POLICY_MODES.find((candidate) => candidate === row.mode);
  const version = integerValue(row.policy_version);
  const defaultHoldHours = integerValue(row.default_hold_hours);
  const nearingExpiryHours = integerValue(row.nearing_expiry_hours);
  if (
    !id ||
    !organizationId ||
    !mode ||
    version === null ||
    defaultHoldHours === null ||
    nearingExpiryHours === null
  ) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The conflict policy is not available.",
    );
  }
  return Object.freeze({
    defaultHoldHours,
    id,
    mode,
    nearingExpiryHours,
    organizationId,
    version,
  });
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function changes(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const meta = Reflect.get(result, "meta");
  if (!meta || typeof meta !== "object") return 0;
  const count = Reflect.get(meta, "changes");
  return typeof count === "number" ? count : 0;
}
