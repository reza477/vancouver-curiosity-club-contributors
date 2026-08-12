import Link from "next/link";
import type { CSSProperties } from "react";
import { formatEventSchedule } from "@/app/_components/EventCard";
import {
  clubCoverArtworkForSlug,
  type ClubCoverArtwork,
} from "@/lib/club-cover-art";
import { responsiveImageSrcSet } from "@/lib/media/presentation";
import type { ResponsiveMediaAssetDto } from "@/lib/server/media/usage";
import type { PublicClubDto } from "@/lib/server/public/catalog";
import type { PublicEventCardDto } from "@/lib/server/public/events";

export type ClubDirectoryNextEventsState =
  | "available"
  | "omitted"
  | "unavailable";

export function ClubDirectory({
  clubs,
  mediaById = new Map(),
  nextEventsByClubSlug = new Map(),
  nextEventsState = "omitted",
}: Readonly<{
  clubs: readonly PublicClubDto[];
  mediaById?: ReadonlyMap<string, ResponsiveMediaAssetDto>;
  nextEventsByClubSlug?: ReadonlyMap<string, PublicEventCardDto>;
  nextEventsState?: ClubDirectoryNextEventsState;
}>) {
  if (clubs.length === 0) {
    return (
      <section className="public-empty-state" aria-labelledby="clubs-empty">
        <p className="section-kicker">Clubs</p>
        <h2 id="clubs-empty">No public club pages are available yet.</h2>
        <p>Draft programs are not displayed.</p>
      </section>
    );
  }

  return (
    <section
      className="club-directory club-directory--clubs"
      aria-labelledby="clubs-heading"
    >
      <header>
        <p className="section-kicker">Clubs</p>
        <h2 id="clubs-heading">Find the room that fits your curiosity.</h2>
      </header>
      <div className="club-directory__list">
        {clubs.map((club, index) => {
          const media = preferredClubMedia(club, mediaById);
          const artwork = clubCoverArtworkForSlug(club.slug);
          const nextEvent = nextEventsByClubSlug.get(club.slug) ?? null;
          return (
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
              <p className="club-directory__lane">
                <span className="sr-only">Activity lane: </span>
                {club.lane.name}
              </p>
              <h3>
                <Link href={`/clubs/${club.slug}`} prefetch={false}>
                  {club.name}
                </Link>
              </h3>
              <ClubArtwork
                artwork={artwork}
                clubName={club.name}
                media={media}
                priority={index === 0}
              />
              {club.description ? (
                <div className="club-directory__promise">
                  <p className="section-kicker">The promise</p>
                  <p>{club.description}</p>
                </div>
              ) : null}
              {nextEventsState !== "omitted" ? (
                <ClubNextEvent
                  clubName={club.name}
                  event={nextEvent}
                  state={nextEventsState}
                />
              ) : null}
              <div className="club-directory__actions">
                <Link
                  aria-label={`Explore club: ${club.name}`}
                  className="club-directory__primary-action"
                  href={`/clubs/${club.slug}`}
                  prefetch={false}
                >
                  Explore club
                </Link>
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
          );
        })}
      </div>
    </section>
  );
}

function ClubArtwork({
  artwork,
  clubName,
  media,
  priority,
}: Readonly<{
  artwork: ClubCoverArtwork | null;
  clubName: string;
  media: ResponsiveMediaAssetDto | null;
  priority: boolean;
}>) {
  if (!media && !artwork) {
    return (
      <figure className="club-directory__artwork club-directory__artwork--fallback">
        <div
          aria-hidden="true"
          className="club-directory__artwork-fallback"
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </div>
        <figcaption>Original artwork for {clubName}</figcaption>
      </figure>
    );
  }

  const altText = media?.altText ?? artwork?.altText ?? "";
  const credit = media?.credit ?? artwork?.credit ?? "";
  const height = media?.variants.webp960.height ?? artwork?.height ?? 540;
  const src = media?.variants.webp960.url ?? artwork?.src ?? "";
  const srcSet = media ? responsiveMediaSrcSet(media) : (artwork?.srcSet ?? "");
  const width = media?.variants.webp960.width ?? artwork?.width ?? 960;
  const position = media
    ? `${media.focalPoint.x / 100}% ${media.focalPoint.y / 100}%`
    : "50% 50%";
  return (
    <figure className="club-directory__artwork">
      <picture>
        <source
          sizes="(max-width: 52rem) calc(100vw - 4.5rem), 48vw"
          srcSet={srcSet}
          type={media ? "image/webp" : "image/jpeg"}
        />
        <img
          alt={altText}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          height={height}
          loading={priority ? "eager" : "lazy"}
          src={src}
          style={{ objectPosition: position }}
          width={width}
        />
      </picture>
      <figcaption>{credit}</figcaption>
    </figure>
  );
}

function ClubNextEvent({
  clubName,
  event,
  state,
}: Readonly<{
  clubName: string;
  event: PublicEventCardDto | null;
  state: Exclude<ClubDirectoryNextEventsState, "omitted">;
}>) {
  return (
    <div
      aria-label={`Next gathering for ${clubName}`}
      className="club-directory__next"
    >
      <p className="section-kicker">Next gathering</p>
      {state === "unavailable" ? (
        <p>Calendar details are temporarily unavailable.</p>
      ) : event ? (
        <>
          <p className="club-directory__next-title">
            <Link href={`/events/${event.slug}`} prefetch={false}>
              {event.title}
            </Link>
          </p>
          <time dateTime={eventDateTime(event)}>
            {formatEventSchedule(event).label}
          </time>
        </>
      ) : (
        <p>No upcoming gathering yet.</p>
      )}
    </div>
  );
}

function preferredClubMedia(
  club: PublicClubDto,
  mediaById: ReadonlyMap<string, ResponsiveMediaAssetDto>,
): ResponsiveMediaAssetDto | null {
  for (const assetId of [club.thumbnailAssetId, club.coverAssetId]) {
    if (!assetId) continue;
    const media = mediaById.get(assetId);
    if (media) return media;
  }
  return null;
}

function eventDateTime(event: PublicEventCardDto): string {
  return event.schedule.kind === "timed"
    ? event.schedule.startsAtUtc
    : event.schedule.startDate;
}

function responsiveMediaSrcSet(media: ResponsiveMediaAssetDto): string {
  return responsiveImageSrcSet([
    media.variants.webp480,
    media.variants.webp960,
    media.variants.webp1600,
  ]);
}
