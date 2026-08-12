export type MeetupPublicAvailabilityState = "open" | "full" | "waitlist";

export type MeetupPublicEventFacts = Readonly<{
  agePolicyText: string | null;
  arrivalInstructions: string | null;
  availabilityState: MeetupPublicAvailabilityState | null;
  capacity: number | null;
  costText: string | null;
  publicFloor: string | null;
  publicRoom: string | null;
  waitlistAvailable: boolean | null;
}>;

export function extractMeetupPublicEventFacts(
  input: unknown,
  options?: Readonly<{ hasPublicVenue?: boolean }>,
): MeetupPublicEventFacts;

export function validateMeetupPublicEventFactsCandidate(
  candidate: unknown,
  expected: MeetupPublicEventFacts,
): MeetupPublicEventFacts;
