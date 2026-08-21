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
        "A friendly sea monster sings above a rainy Vancouver night filled with reading, music, art, film, and conversation.",
      credit: "Original artwork for Vancouver Curiosity Club",
      fileStem: "vancouver-curiosity-club",
    }),
    "vancouver-fantasy-scifi-group": clubCoverArtwork({
      altText:
        "An ornate cosmic library opens onto planets, galaxies, and a distant fantasy city.",
      credit: "Original artwork for Vancouver Fantasy and Sci-Fi Group",
      fileStem: "vancouver-fantasy-scifi-group",
    }),
    "vancouver-literature-and-film": clubCoverArtwork({
      altText:
        "Three people discuss a book and storyboard cards in a warm film library overlooking rainy Vancouver.",
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
