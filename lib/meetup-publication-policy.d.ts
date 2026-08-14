export type MeetupPublicationDescriptionInline =
  | Readonly<{ text: string; type: "strong" | "text" }>
  | Readonly<{ href: string; text: string; type: "link" }>;

export type MeetupPublicationDescriptionBlock =
  | Readonly<{
      content: readonly MeetupPublicationDescriptionInline[];
      level: 3 | 4;
      type: "heading";
    }>
  | Readonly<{
      content: readonly MeetupPublicationDescriptionInline[];
      type: "paragraph";
    }>
  | Readonly<{
      items: readonly (readonly MeetupPublicationDescriptionInline[])[];
      type: "ordered-list" | "unordered-list";
    }>;

export type ApprovedMeetupEventEditorialOverride = Readonly<{
  approvedPublicFloor: "Level 8";
  canonicalEventId: "315823022";
  eventId: "315823022" | "315823081";
  groupSlug: "vancouver-literature-and-film" | "vancouver-meetup-group";
}>;

export const MEETUP_EDITORIAL_OVERRIDE_POLICY_VERSION: string;
export const APPROVED_MEETUP_EVENT_EDITORIAL_OVERRIDES: Readonly<
  Record<string, ApprovedMeetupEventEditorialOverride>
>;

export function approvedMeetupEventEditorialOverride(
  groupSlug: unknown,
  eventId: unknown,
): ApprovedMeetupEventEditorialOverride | null;

export function applyApprovedMeetupEventEditorialOverride<
  TBlock extends MeetupPublicationDescriptionBlock,
>(input: Readonly<{
  description: string;
  descriptionBlocks: readonly TBlock[];
  eventId: string;
  groupSlug: string;
}>): Readonly<{
  approvedPublicFloor: "Level 8" | null;
  description: string;
  descriptionBlocks: readonly TBlock[];
}>;

export function extractMeetupPublicFloorClaimKeys(
  input: unknown,
): readonly string[];

export function splitTrailingMeetupTicketOrRsvpCallToAction(
  input: unknown,
): Readonly<{ callToAction: string; prefix: string }> | null;

export function removeOrphanMeetupTicketAndRsvpCallToActions<
  TBlock extends MeetupPublicationDescriptionBlock,
>(blocks: readonly TBlock[]): readonly TBlock[];

export function isAllowedMeetupPublicDescriptionHref(input: unknown): boolean;
