import type {
  ActivityHistoryItem,
  OrganizerAuditAction,
} from "@/lib/server/organizer/activity";

type ActivityEntityType = ActivityHistoryItem["entityType"];

export function activityLabel(
  action: OrganizerAuditAction,
  entityType: ActivityEntityType,
): string {
  switch (action) {
    case "club.archived_private":
      return "Private club archived";
    case "club.created_private":
      return "Private club created";
    case "club.private_settings_updated":
      return "Club planning settings changed";
    case "cms.club_profile_archived":
      return "Club public profile archived";
    case "cms.program_profile_archived":
      return "Program public profile archived";
    case "cms.program_profile_deleted":
      return "Unused Program safely deleted";
    case "cms.entity_created":
      return `${cmsEntityLabel(entityType)} draft created`;
    case "cms.entity_draft_saved":
      return `${cmsEntityLabel(entityType)} draft saved`;
    case "cms.entity_published":
      return `${cmsEntityLabel(entityType)} published`;
    case "cms.entity_restored_as_draft":
      return `${cmsEntityLabel(entityType)} revision restored as draft`;
    case "cms.entity_unpublished":
      return `${cmsEntityLabel(entityType)} unpublished`;
    case "cms.legal_status_confirmed":
      return "Legal wording confirmed";
    case "cms.legal_status_revoked":
      return "Legal wording confirmation revoked";
    case "calendar_subscription.created":
      return "Private calendar subscription created";
    case "calendar_subscription.revoked":
      return "Private calendar subscription revoked";
    case "event_export.operational_csv":
      return "Operational event CSV exported";
    case "form_submission.assigned":
      return "Submission assignment changed";
    case "form_submission.created":
      return "Public form submission stored";
    case "form_submission.note_added":
      return "Private submission note appended";
    case "form_submission.personal_content_redacted":
      return "Submission personal content redacted";
    case "form_submission.status_changed":
      return "Submission status changed";
    case "import.approved":
      return "CSV import approved";
    case "import.batch_created":
      return "CSV import preview created";
    case "import.completed":
      return "CSV import completed";
    case "import.conflict_linked":
      return "CSV import conflict decision recorded";
    case "import.duplicate_override":
      return "CSV import duplicate warning overridden";
    case "import.mapping_confirmed":
      return "CSV import mapping confirmed";
    case "import.resumed":
      return "CSV import resumed";
    case "import.row_applied":
      return "CSV import row processed";
    case "import.source_payload_redacted":
      return "CSV import source payload redacted";
    case "invitation.accepted":
      return "Invitation accepted";
    case "invitation.created":
      return "Invitation created";
    case "invitation.revoked":
      return "Invitation revoked";
    case "media.cleanup_completed":
      return "Media cleanup completed";
    case "media.deleted":
      return "Media deleted";
    case "media.metadata_updated":
      return "Media metadata updated";
    case "media.upload_failed":
      return "Media upload failed";
    case "media.upload_finalized":
      return "Media upload finalized";
    case "media.upload_started":
      return "Media upload started";
    case "media_export.manifest":
      return "Media backup manifest exported";
    case "media_export.original_downloaded":
      return "Media backup original downloaded";
    case "membership.ownership_transferred":
      return "Ownership transferred";
    case "membership.updated":
      return "Membership changed";
    case "organization.settings_updated":
      return "Workspace settings changed";
    case "organizer_event.created":
      return "Planning record created";
    case "organizer_event.deleted":
      return "Planning record moved to deleted items";
    case "organizer_event.duplicated":
      return "Planning record duplicated";
    case "organizer_event.restored":
      return "Planning record restored";
    case "organizer_event.updated":
      return "Planning record updated";
    case "owner_backup.generated":
      return "Owner JSON backup generated";
    case "profile.notification_preference_changed":
      return "Notification preference changed";
    case "profile.updated":
      return "Organizer profile changed";
    case "taxonomy.category_archived":
      return "Event category archived";
    case "taxonomy.category_created":
      return "Event category created";
    case "taxonomy.category_deleted":
      return "Unused event category safely deleted";
    case "taxonomy.category_reordered":
      return "Event categories reordered";
    case "taxonomy.category_updated":
      return "Event category updated";
    case "taxonomy.lane_archived":
      return "Event lane archived";
    case "taxonomy.lane_created":
      return "Event lane created";
    case "taxonomy.lane_deleted":
      return "Unused event lane safely deleted";
    case "taxonomy.lane_reordered":
      return "Event lanes reordered";
    case "taxonomy.lane_updated":
      return "Event lane updated";
  }
}

function cmsEntityLabel(entityType: ActivityEntityType): string {
  switch (entityType) {
    case "page":
      return "Page";
    case "club_public_profile":
      return "Club public profile";
    case "program_public_profile":
      return "Program public profile";
    case "community_link":
      return "Community link";
    case "navigation":
      return "Navigation";
    case "site_identity":
      return "Site settings";
    case "legal_status":
      return "Legal wording";
    default:
      return "Content";
  }
}
