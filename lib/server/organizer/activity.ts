import {
  authorizeMembership,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  parseFiniteInteger,
  parseIdentifier,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";

export const ORGANIZER_AUDIT_ACTIONS = [
  "club.archived_private",
  "club.created_private",
  "club.private_settings_updated",
  "cms.club_profile_archived",
  "cms.program_profile_archived",
  "cms.program_profile_deleted",
  "cms.entity_created",
  "cms.entity_draft_saved",
  "cms.entity_published",
  "cms.entity_restored_as_draft",
  "cms.entity_unpublished",
  "cms.legal_status_confirmed",
  "cms.legal_status_revoked",
  "calendar_subscription.created",
  "calendar_subscription.revoked",
  "event_export.operational_csv",
  "form_submission.assigned",
  "form_submission.created",
  "form_submission.note_added",
  "form_submission.personal_content_redacted",
  "form_submission.status_changed",
  "import.approved",
  "import.batch_created",
  "import.completed",
  "import.conflict_linked",
  "import.duplicate_override",
  "import.mapping_confirmed",
  "import.resumed",
  "import.row_applied",
  "import.source_payload_redacted",
  "invitation.accepted",
  "invitation.created",
  "invitation.revoked",
  "media.cleanup_completed",
  "media.deleted",
  "media.metadata_updated",
  "media.upload_failed",
  "media.upload_finalized",
  "media.upload_started",
  "media_export.manifest",
  "media_export.original_downloaded",
  "membership.ownership_transferred",
  "membership.updated",
  "organization.settings_updated",
  "organizer_event.created",
  "organizer_event.deleted",
  "organizer_event.duplicated",
  "organizer_event.restored",
  "organizer_event.updated",
  "owner_backup.generated",
  "profile.notification_preference_changed",
  "profile.updated",
  "taxonomy.category_archived",
  "taxonomy.category_created",
  "taxonomy.category_deleted",
  "taxonomy.category_reordered",
  "taxonomy.category_updated",
  "taxonomy.lane_archived",
  "taxonomy.lane_created",
  "taxonomy.lane_deleted",
  "taxonomy.lane_reordered",
  "taxonomy.lane_updated",
] as const;

export type OrganizerAuditAction =
  (typeof ORGANIZER_AUDIT_ACTIONS)[number];

export type ActivityHistoryItem = Readonly<{
  action: OrganizerAuditAction;
  actorDisplayName: string;
  createdAt: number;
  entityId: string;
  entityType:
    | "club"
    | "club_public_profile"
    | "community_link"
    | "data_export"
    | "event_category"
    | "event_lane"
    | "invitation"
    | "form_submission"
    | "ics_subscription_token"
    | "import_batch"
    | "legal_status"
    | "media_asset"
    | "membership"
    | "navigation"
    | "organization"
    | "organizer_event"
    | "page"
    | "profile"
    | "program_public_profile"
    | "site_identity";
  id: string;
}>;

export async function listActivityHistory(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  options: Readonly<{ before?: unknown; limit?: unknown }> = {},
): Promise<readonly ActivityHistoryItem[]> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const limit =
    options.limit === undefined
      ? 40
      : parseFiniteInteger(options.limit, {
          path: "limit",
          minimum: 1,
          maximum: 100,
        });
  const before =
    options.before === undefined ||
    options.before === null ||
    options.before === ""
      ? null
      : parseFiniteInteger(options.before, {
          path: "before",
          minimum: 0,
        });
  const actionPlaceholders = ORGANIZER_AUDIT_ACTIONS.map(() => "?").join(
    ", ",
  );
  const statement = database.prepare(
    `SELECT audit.id,
            audit.action,
            audit.entity_type,
            audit.entity_id,
            audit.created_at,
            COALESCE(
              actor_preference.workspace_display_name,
              actor_profile.display_name
            ) AS actor_display_name
     FROM audit_logs AS audit
     LEFT JOIN profiles AS actor_profile
       ON actor_profile.id = audit.actor_profile_id
     LEFT JOIN organizer_profile_preferences AS actor_preference
       ON actor_preference.profile_id = actor_profile.id
      AND actor_preference.organization_id = audit.organization_id
     WHERE audit.organization_id = ?
       AND audit.action IN (${actionPlaceholders})
       ${before === null ? "" : "AND audit.created_at < ?"}
     ORDER BY audit.created_at DESC, audit.id DESC
     LIMIT ?`,
  );
  const result =
    before === null
      ? await statement
          .bind(
            actor.organizationId,
            ...ORGANIZER_AUDIT_ACTIONS,
            limit,
          )
          .all<Record<string, unknown>>()
      : await statement
          .bind(
            actor.organizationId,
            ...ORGANIZER_AUDIT_ACTIONS,
            before,
            limit,
          )
          .all<Record<string, unknown>>();
  const currentActor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  if (
    currentActor.organizationId !== actor.organizationId ||
    currentActor.membershipId !== actor.membershipId ||
    currentActor.profileId !== actor.profileId
  ) {
    throw new SafeApplicationError(
      "authorization_denied",
      403,
      "Your organizer access changed before this activity could be returned.",
    );
  }
  return Object.freeze(
    (result.results ?? [])
      .map(activityFromRow)
      .filter((item): item is ActivityHistoryItem => item !== null),
  );
}

function activityFromRow(
  row: Record<string, unknown>,
): ActivityHistoryItem | null {
  const id = readString(row.id);
  const action = ORGANIZER_AUDIT_ACTIONS.find(
    (value) => value === row.action,
  );
  const entityType = readEntityType(row.entity_type);
  const rawEntityId = readString(row.entity_id);
  const createdAt =
    typeof row.created_at === "number" &&
    Number.isSafeInteger(row.created_at) &&
    row.created_at >= 0
      ? row.created_at
      : null;
  if (!id || !action || !entityType || !rawEntityId || createdAt === null) {
    return null;
  }
  let entityId: string;
  try {
    entityId = parseIdentifier(rawEntityId, "entityId");
  } catch {
    return null;
  }
  return Object.freeze({
    id,
    action,
    entityType,
    entityId,
    createdAt,
    actorDisplayName:
      action === "form_submission.created" &&
      row.actor_display_name == null
        ? "Public form"
        : safeActorName(row.actor_display_name),
  });
}

function readEntityType(
  value: unknown,
): ActivityHistoryItem["entityType"] | null {
  return value === "club" ||
    value === "club_public_profile" ||
    value === "community_link" ||
    value === "data_export" ||
    value === "event_category" ||
    value === "event_lane" ||
    value === "form_submission" ||
    value === "ics_subscription_token" ||
    value === "import_batch" ||
    value === "invitation" ||
    value === "legal_status" ||
    value === "media_asset" ||
    value === "membership" ||
    value === "navigation" ||
    value === "organization" ||
    value === "organizer_event" ||
    value === "page" ||
    value === "profile" ||
    value === "program_public_profile" ||
    value === "site_identity"
    ? value
    : null;
}

function safeActorName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > 120 ||
    /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    return "Former organizer";
  }
  return value.trim();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function invalidActivityCursor(): SafeApplicationError {
  return new SafeApplicationError(
    "validation_failed",
    422,
    "The activity cursor could not be validated.",
  );
}
