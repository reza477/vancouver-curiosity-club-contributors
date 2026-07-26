import type { OrganizerEventFormOptions } from "./types";

export type EventEditorValue = Readonly<{
  allDayEndDateExclusive: string;
  allDayStartDate: string;
  categoryId: string;
  cleanupBufferMinutes: number;
  clubId: string;
  coOrganizerProfileIds: readonly string[];
  endDate: string;
  endTime: string;
  expectedEditVersion: number | null;
  internalNotes: string;
  laneId: string;
  meetupEventUrl: string;
  planningStatus: "draft" | "idea";
  primaryOrganizerProfileId: string;
  privateMeetingDetails: string | null;
  programId: string;
  publicDescription: string;
  publicSummary: string;
  scheduleShape: "all_day" | "timed" | "unscheduled";
  setupBufferMinutes: number;
  startDate: string;
  startTime: string;
  timezone: string;
  title: string;
  venueId: string | null;
}>;

type OrganizerOption = OrganizerEventFormOptions["organizers"][number];

export function reconcileEventEditorClubSelection(
  current: EventEditorValue,
  nextClubId: string,
  organizers: readonly OrganizerOption[],
  currentActorProfileId: string,
): EventEditorValue {
  const available = organizers.filter(
    (organizer) =>
      organizer.organizationWide ||
      !nextClubId ||
      organizer.clubs.includes(nextClubId),
  );
  const availableIds = new Set(available.map((organizer) => organizer.id));
  const primaryOrganizerProfileId = availableIds.has(
    current.primaryOrganizerProfileId,
  )
    ? current.primaryOrganizerProfileId
    : availableIds.has(currentActorProfileId)
      ? currentActorProfileId
      : (available[0]?.id ?? "");

  return {
    ...current,
    clubId: nextClubId,
    coOrganizerProfileIds: current.coOrganizerProfileIds.filter(
      (profileId) =>
        profileId !== primaryOrganizerProfileId &&
        availableIds.has(profileId),
    ),
    primaryOrganizerProfileId,
    programId: "",
  };
}

export function eventEditorApiInput(value: EventEditorValue) {
  const common = {
    bufferAfterMinutes: value.cleanupBufferMinutes,
    bufferBeforeMinutes: value.setupBufferMinutes,
    categoryId: value.categoryId || null,
    clubId: value.clubId,
    coOrganizerProfileIds: value.coOrganizerProfileIds,
    description: value.publicDescription || null,
    eventLaneId: value.laneId || null,
    meetupEventUrl: value.meetupEventUrl || null,
    planningStatus: value.planningStatus,
    primaryOrganizerProfileId: value.primaryOrganizerProfileId,
    privateMeetingDetails: value.privateMeetingDetails,
    privateNotes: value.internalNotes || null,
    programId: value.programId || null,
    publicationStatus: "private" as const,
    scheduleShape: value.scheduleShape,
    summary: value.publicSummary || null,
    title: value.title,
    venueId: value.venueId,
  };
  if (value.scheduleShape === "unscheduled") return common;
  if (value.scheduleShape === "timed") {
    return {
      ...common,
      endLocal: `${value.endDate}T${value.endTime}`,
      startLocal: `${value.startDate}T${value.startTime}`,
      timeZone: value.timezone,
    };
  }
  return {
    ...common,
    allDayEndDateExclusive: value.allDayEndDateExclusive,
    allDayStartDate: value.allDayStartDate,
    timeZone: value.timezone,
  };
}
