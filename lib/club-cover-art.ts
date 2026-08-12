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
        "Friends sharing books, sketches, maps, and conversation in a bright Vancouver room.",
      credit: "Original artwork for Vancouver Curiosity Club",
      fileStem: "vancouver-curiosity-club",
    }),
    "vancouver-fantasy-scifi-group": clubCoverArtwork({
      altText:
        "Readers gathered around an open book portal with planets and a futuristic Vancouver skyline.",
      credit: "Original artwork for Vancouver Fantasy and Sci-Fi Group",
      fileStem: "vancouver-fantasy-scifi-group",
    }),
    "vancouver-literature-and-film": clubCoverArtwork({
      altText:
        "Readers beside an open book and film projector on a rainy Vancouver evening.",
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
    src: `${base}-960.webp`,
    srcSet: `${base}-480.webp 480w, ${base}-960.webp 960w, ${base}-1600.webp 1600w`,
    width: 960 as const,
  });
}
