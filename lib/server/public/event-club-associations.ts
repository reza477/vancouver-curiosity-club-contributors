import type { PublicEventCardDto } from "./events";

export type PublicEventClubAssociation =
  PublicEventCardDto["clubAssociations"][number];

/**
 * The protected Meetup projection keeps one canonical event while recording
 * every currently active, importer-verified Club source for that gathering.
 * Discovery surfaces use these memberships without creating another event,
 * route, calendar row, export row, or RSVP destination.
 */
export function publicEventClubAssociations(
  event: Pick<PublicEventCardDto, "clubAssociations">,
): readonly PublicEventClubAssociation[] {
  return event.clubAssociations;
}

export function publicEventClubAssociation(
  event: Pick<PublicEventCardDto, "clubAssociations">,
  clubSlug: string,
): PublicEventClubAssociation | null {
  return event.clubAssociations.find((club) => club.slug === clubSlug) ?? null;
}

export function publicEventMatchesClubAssociation(
  event: Pick<PublicEventCardDto, "clubAssociations">,
  clubSlug: string,
): boolean {
  return publicEventClubAssociation(event, clubSlug) !== null;
}
