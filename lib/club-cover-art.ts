export type ClubCoverArtwork = Readonly<{
  altText: string;
  credit: string;
  height: 540;
  src: string;
  srcSet: string;
  width: 960;
}>;

const CLUB_COVER_ARTWORK: Readonly<Record<string, ClubCoverArtwork>> =
  Object.freeze({
    "vancouver-curiosity-club": clubCoverArtwork({
      altText:
        "Four people examine a neighbourhood map and tactile curios in a rainy Vancouver studio.",
      credit: "Original artwork for Vancouver Curiosity Club",
      fileStem: "vancouver-curiosity-club",
    }),
    "vancouver-fantasy-scifi-group": clubCoverArtwork({
      altText:
        "Four readers discuss a star chart beneath a brass orrery with Vancouver mountains beyond.",
      credit: "Original artwork for Vancouver Fantasy and Sci-Fi Group",
      fileStem: "vancouver-fantasy-scifi-group",
    }),
    "vancouver-literature-and-film": clubCoverArtwork({
      altText:
        "Four people compare a novel and storyboard cards after a screening on a rainy Vancouver evening.",
      credit: "Original artwork for Vancouver Literature and Film",
      fileStem: "vancouver-literature-and-film",
    }),
  });

export function clubCoverArtworkForSlug(
  slug: string,
): ClubCoverArtwork | null {
  return CLUB_COVER_ARTWORK[slug] ?? null;
}

function clubCoverArtwork({
  altText,
  credit,
  fileStem,
}: Readonly<{
  altText: string;
  credit: string;
  fileStem: string;
}>): ClubCoverArtwork {
  const base = `/club-covers/${fileStem}`;
  return Object.freeze({
    altText,
    credit,
    height: 540 as const,
    src: `${base}-960.jpeg`,
    srcSet: `${base}-480.jpeg 480w, ${base}-960.jpeg 960w, ${base}-1600.jpeg 1600w`,
    width: 960 as const,
  });
}
