export const SUBMISSION_MODERATION_FOLDERS = ["inbox", "spam", "trash"] as const;
export type SubmissionModerationFolder = (typeof SUBMISSION_MODERATION_FOLDERS)[number];
export const MAX_SUBMISSION_MODERATION_BATCH = 10;
