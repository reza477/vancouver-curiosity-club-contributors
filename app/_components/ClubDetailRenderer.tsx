import Link from "next/link";
import type { CSSProperties } from "react";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import { ClubEventList } from "@/app/_components/ClubEventList";
import { PageMasthead } from "@/app/_components/PageMasthead";
import { StructuredData } from "@/app/_components/StructuredData";
import {
  focalPointObjectPosition,
  responsiveImageSrcSet,
} from "@/lib/media/presentation";
import type { ResponsiveMediaAssetDto } from "@/lib/server/media/usage";
import type {
  PublicClubDto,
  PublicProgramDto,
} from "@/lib/server/public/catalog";
import type { PublicEventPageDto } from "@/lib/server/public/events";
import { publicUrl } from "@/lib/server/public/origin";

export type ClubDetailEventsState =
  | Readonly<{
      kind: "available";
      past: PublicEventPageDto;
      upcoming: PublicEventPageDto;
    }>
  | Readonly<{ kind: "unavailable" }>;

export function ClubDetailRenderer({
  club,
  coverMedia,
  events,
  origin = null,
  programMediaById = new Map(),
  programs = [],
}: Readonly<{
  club: PublicClubDto;
  coverMedia: ResponsiveMediaAssetDto | null;
  events: ClubDetailEventsState;
  origin?: URL | null;
  programMediaById?: ReadonlyMap<string, ResponsiveMediaAssetDto>;
  programs?: readonly PublicProgramDto[];
}>) {
  return (
    <main
      className="club-detail"
      style={
        club.themeColor
          ? ({ "--club-theme": club.themeColor } as CSSProperties)
          : undefined
      }
    >
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { href: "/clubs", label: "Clubs" },
          { label: club.name },
        ]}
      />
      <PageMasthead
        deck={
          club.description ??
          "A Vancouver Curiosity Club program."
        }
        eyebrow={club.lane.name}
        title={club.name}
        tone={clubArtworkTone(club.lane.slug)}
      />
      {club.archived ? (
        <section className="notice-card" aria-labelledby="archived-club-heading">
          <p className="section-kicker">Program archive</p>
          <h2 id="archived-club-heading">
            This program is preserved for historical reference.
          </h2>
          <p>
            It is no longer active or accepting future event scheduling.
            Eligible completed events remain available below in Past.
          </p>
        </section>
      ) : null}

      {coverMedia ? (
        <figure className="club-detail__cover">
          <picture>
            <source
              sizes="(max-width: 42rem) 100vw, (max-width: 75rem) 86vw, 68rem"
              srcSet={responsiveSrcSet(coverMedia)}
              type="image/webp"
            />
            <img
              alt={coverMedia.altText ?? ""}
              height={coverMedia.variants.webp1600.height}
              sizes="(max-width: 42rem) 100vw, (max-width: 75rem) 86vw, 68rem"
              src={coverMedia.variants.webp1600.url}
              srcSet={responsiveSrcSet(coverMedia)}
              style={{
                objectPosition: focalPointObjectPosition(
                  coverMedia.focalPoint,
                ),
              }}
              width={coverMedia.variants.webp1600.width}
            />
          </picture>
          <figcaption>Credit: {coverMedia.credit}</figcaption>
        </figure>
      ) : null}

      {club.fullDescription ||
      club.participantExpectations ||
      club.typicalFormat ||
      club.preparationInformation ? (
        <section
          className="club-detail__profile"
          aria-labelledby="club-profile-heading"
        >
          <div>
            <p className="section-kicker">
              {club.programType ?? "Public program"}
            </p>
            <h2 id="club-profile-heading">What to expect</h2>
            {club.fullDescription ? <p>{club.fullDescription}</p> : null}
          </div>
          <dl>
            {club.participantExpectations ? (
              <div>
                <dt>Participants can expect</dt>
                <dd>{club.participantExpectations}</dd>
              </div>
            ) : null}
            {club.typicalFormat ? (
              <div>
                <dt>Typical format</dt>
                <dd>{club.typicalFormat}</dd>
              </div>
            ) : null}
            {club.preparationInformation ? (
              <div>
                <dt>Preparation</dt>
                <dd>{club.preparationInformation}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      {club.publicGroupUrl ? (
        <section
          className="club-detail__destination"
          aria-labelledby="club-destination-heading"
        >
          <div>
            <p className="section-kicker">Meetup group</p>
            <h2 id="club-destination-heading">Continue on Meetup</h2>
            <p>
              Event RSVPs and group activity continue on this club&apos;s Meetup
              page.
            </p>
          </div>
          <a
            href={club.publicGroupUrl}
            rel="noreferrer noopener"
            target="_blank"
          >
            Open {club.name} on Meetup
            <span aria-hidden="true"> ↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </section>
      ) : null}

      {programs.length > 0 ? (
        <section
          className="club-directory"
          aria-labelledby="club-programs-heading"
        >
          <header>
            <p className="section-kicker">Recurring Programs</p>
            <h2 id="club-programs-heading">Explore this club&apos;s series.</h2>
          </header>
          <div className="club-directory__list">
            {programs.map((program) => {
              const thumbnail = program.thumbnailAssetId
                ? programMediaById.get(program.thumbnailAssetId) ?? null
                : null;
              return (
                <article
                  className="club-directory__card"
                  key={program.slug}
                  style={
                    program.themeColor
                      ? ({
                          "--club-theme": program.themeColor,
                        } as CSSProperties)
                      : undefined
                  }
                >
                  <p className="club-directory__lane">{program.lane.name}</p>
                  <h3>
                    <Link
                      href={`/clubs/${club.slug}/programs/${program.slug}`}
                    >
                      {program.name}
                    </Link>
                  </h3>
                  {thumbnail ? (
                    <figure className="club-directory__artwork">
                      <picture>
                        <source
                          sizes="(max-width: 52rem) 100vw, 42vw"
                          srcSet={responsiveSrcSet(thumbnail)}
                          type="image/webp"
                        />
                        <img
                          alt={thumbnail.altText ?? ""}
                          height={thumbnail.variants.webp960.height}
                          loading="lazy"
                          src={thumbnail.variants.webp960.url}
                          style={{
                            objectPosition: focalPointObjectPosition(
                              thumbnail.focalPoint,
                            ),
                          }}
                          width={thumbnail.variants.webp960.width}
                        />
                      </picture>
                      <figcaption>Credit: {thumbnail.credit}</figcaption>
                    </figure>
                  ) : null}
                  {program.description ? <p>{program.description}</p> : null}
                  <div className="club-directory__actions">
                    <Link href={`/clubs/${club.slug}/programs/${program.slug}`}>
                      Explore program
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {club.socialLinks.length > 0 || club.relatedResources.length > 0 ? (
        <section
          className="club-detail__links"
          aria-labelledby="club-links-heading"
        >
          <div>
            <p className="section-kicker">Confirmed links</p>
            <h2 id="club-links-heading">Continue exploring</h2>
          </div>
          <ul>
            {[...club.socialLinks, ...club.relatedResources].map((link) => (
              <li key={`${link.label}-${link.url}`}>
                {link.url.startsWith("/") ? (
                  <Link href={link.url}>{link.label}</Link>
                ) : (
                  <a
                    href={link.url}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    {link.label}
                    <span aria-hidden="true"> ↗</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {events.kind === "available" ? (
        <div className="club-detail__events">
          <ClubEventList
            emptyCopy="No upcoming events are listed for this club."
            events={events.upcoming.events}
            heading="Upcoming"
            id="club-upcoming"
          />
          <ClubEventList
            emptyCopy="No past events are listed for this club."
            events={events.past.events}
            heading="Past"
            id="club-past"
          />
        </div>
      ) : (
        <section className="public-service-state" aria-live="polite">
          <p className="section-kicker">Club calendar</p>
          <h2>Club events are temporarily unavailable.</h2>
          <p>
            The club page remains available, but no substitute event facts are
            being shown.
          </p>
        </section>
      )}
      {origin ? (
        <StructuredData
          value={{
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: publicUrl("/", origin),
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "Clubs",
                item: publicUrl("/clubs", origin),
              },
              {
                "@type": "ListItem",
                position: 3,
                name: club.name,
                item: publicUrl(`/clubs/${club.slug}`, origin),
              },
            ],
          }}
        />
      ) : null}
    </main>
  );
}

export function clubArtworkTone(laneSlug: string) {
  if (laneSlug === "reset-and-make") return "reset-make" as const;
  if (laneSlug === "explore") return "explore" as const;
  if (laneSlug === "eat-and-play") return "eat-play" as const;
  return "think" as const;
}

function responsiveSrcSet(media: ResponsiveMediaAssetDto): string {
  return responsiveImageSrcSet([
    media.variants.webp480,
    media.variants.webp960,
    media.variants.webp1600,
  ]);
}
