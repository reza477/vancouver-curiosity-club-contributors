export const CANONICAL_PUBLIC_COMMUNITY_URLS = [
  "https://www.meetup.com/vancouver-meetup-group/",
  "https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/",
  "https://www.meetup.com/vancouver-literature-and-film/",
] as const;

export function selectCanonicalPublicCommunities<
  Club extends Readonly<{
    archived: boolean;
    publicGroupUrl: string | null;
    slug: string;
  }>,
>(clubs: readonly Club[]): readonly Club[] {
  const eligibleByMeetupUrl = new Map(
    clubs
      .filter((club) => !club.archived && club.publicGroupUrl)
      .map((club) => [club.publicGroupUrl, club] as const),
  );
  return Object.freeze(
    CANONICAL_PUBLIC_COMMUNITY_URLS.flatMap((url) => {
      const club = eligibleByMeetupUrl.get(url);
      return club ? [club] : [];
    }),
  );
}
