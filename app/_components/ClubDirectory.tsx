import Link from "next/link";
import type { CSSProperties } from "react";
import { responsiveImageSrcSet } from "@/lib/media/presentation";
import type { ResponsiveMediaAssetDto } from "@/lib/server/media/usage";
import type { PublicClubDto } from "@/lib/server/public/catalog";

export function ClubDirectory({
  clubs,
  mediaById = new Map(),
}: Readonly<{
  clubs: readonly PublicClubDto[];
  mediaById?: ReadonlyMap<string, ResponsiveMediaAssetDto>;
}>) {
  if (clubs.length === 0) {
    return (
      <section className="public-empty-state" aria-labelledby="clubs-empty">
        <p className="section-kicker">Published clubs</p>
        <h2 id="clubs-empty">No public club pages are available yet.</h2>
        <p>Draft programs are not displayed.</p>
      </section>
    );
  }

  return (
    <section className="club-directory" aria-labelledby="clubs-heading">
      <header>
        <p className="section-kicker">Published clubs</p>
        <h2 id="clubs-heading">Choose a curiosity trail.</h2>
      </header>
      <div className="club-directory__list">
        {clubs.map((club, index) => (
          <article
            className="club-directory__card"
            key={club.slug}
            style={
              club.themeColor
                ? ({
                    "--club-theme": club.themeColor,
                  } as CSSProperties)
                : undefined
            }
          >
            <p className="club-directory__number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </p>
            <p className="club-directory__lane">{club.lane.name}</p>
            <h3>
              <Link href={`/clubs/${club.slug}`}>{club.name}</Link>
            </h3>
            {club.thumbnailAssetId &&
            mediaById.get(club.thumbnailAssetId) ? (
              <ClubThumbnail media={mediaById.get(club.thumbnailAssetId)!} />
            ) : null}
            {club.description ? <p>{club.description}</p> : null}
            <div className="club-directory__actions">
              <Link href={`/clubs/${club.slug}`}>Read the club note</Link>
              {club.publicGroupUrl ? (
                <a
                  href={club.publicGroupUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Official Meetup group
                  <span aria-hidden="true"> ↗</span>
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ClubThumbnail({
  media,
}: Readonly<{ media: ResponsiveMediaAssetDto }>) {
  const position = `${media.focalPoint.x / 100}% ${
    media.focalPoint.y / 100
  }%`;
  return (
    <figure className="club-directory__artwork">
      <picture>
        <source
          sizes="(max-width: 52rem) 100vw, 42vw"
          srcSet={responsiveMediaSrcSet(media)}
          type="image/webp"
        />
        <img
          alt={media.altText ?? ""}
          height={media.variants.webp960.height}
          loading="lazy"
          src={media.variants.webp960.url}
          style={{ objectPosition: position }}
          width={media.variants.webp960.width}
        />
      </picture>
      <figcaption>Artwork credit: {media.credit}</figcaption>
    </figure>
  );
}

function responsiveMediaSrcSet(media: ResponsiveMediaAssetDto): string {
  return responsiveImageSrcSet([
    media.variants.webp480,
    media.variants.webp960,
    media.variants.webp1600,
  ]);
}
