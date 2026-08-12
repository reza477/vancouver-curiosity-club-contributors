import Link from "next/link";
import { EventPosterImage } from "@/app/_components/EventPosterImage";
import type { CSSProperties } from "react";
import { EventCard } from "./EventCard";
import { StructuredData } from "./StructuredData";
import { responsiveImageSrcSet } from "@/lib/media/presentation";
import type {
  PublicCatalogDto,
  PublicClubDto,
  PublicPageDto,
} from "@/lib/server/public/catalog";
import type { PublicEventCardDto } from "@/lib/server/public/events";
import type { ResponsiveMediaAssetDto } from "@/lib/server/media/usage";
import { publicUrl } from "@/lib/server/public/origin";

const HERO_EYEBROW =
  "Books, films, ideas, walks & creative nights in Vancouver";
const HERO_HEADING = "Come curious. Leave knowing people.";
const HERO_BODY =
  "Vancouver Curiosity Club is for people who miss conversations that go somewhere. Pick a gathering that pulls you in, show up as you are, and meet thoughtful people through books, films, big questions, city walks, creative practice, food, and play.";

export function HomePageRenderer({
  catalog,
  events,
  origin,
  page,
  privatePreview = false,
}: Readonly<{
  catalog: PublicCatalogDto;
  events: readonly PublicEventCardDto[];
  origin: URL | null;
  page: PublicPageDto;
  previewMediaAssets?: readonly ResponsiveMediaAssetDto[];
  privatePreview?: boolean;
}>) {
  const upcomingEvents = events.slice(0, 3);
  const lanes = catalog.lanes.slice(0, 4);
  const clubs = selectHomepageClubs(catalog.clubs);

  return (
    <main className="home-page" data-page-slug={page.slug}>
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__copy">
          <p className="eyebrow">{HERO_EYEBROW}</p>
          <h1 id="home-title">{HERO_HEADING}</h1>
          <p className="home-hero__deck">{HERO_BODY}</p>
          <div className="home-hero__actions">
            <Link
              className="primary-action"
              href="/events"
              prefetch={false}
            >
              See upcoming gatherings
            </Link>
            <Link href="#new-here">New here? Start here</Link>
          </div>
        </div>

        <div
          className="home-hero__poster-collage"
          aria-label="Posters for the next upcoming gatherings"
          role="group"
        >
          {upcomingEvents.map((event, index) => (
            <HomeHeroPoster event={event} index={index} key={event.slug} />
          ))}
        </div>
      </section>

      <section className="home-events" aria-labelledby="home-events-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Coming up next</p>
            <h2 id="home-events-title">Three ways to join in</h2>
          </div>
          <Link href="/events" prefetch={false}>
            See all upcoming gatherings
          </Link>
        </div>
        {upcomingEvents.length > 0 ? (
          <div className="event-list">
            {upcomingEvents.map((event, index) => (
              <EventCard event={event} key={event.slug} priority={index === 0} />
            ))}
          </div>
        ) : (
          <div className="public-empty-state">
            <p className="section-kicker">Upcoming gatherings</p>
            <h3>No upcoming event is published yet.</h3>
            <p>Check the complete events page for the latest public listings.</p>
            <Link href="/events" prefetch={false}>
              Open events
            </Link>
          </div>
        )}
      </section>

      <section
        className="home-newcomer attending-note"
        id="new-here"
        aria-labelledby="home-newcomer-title"
      >
        <div>
          <p className="section-kicker">New here?</p>
          <h2 id="home-newcomer-title">Your first event can be simple.</h2>
        </div>
        <div>
          <p>
            You can come on your own. Pick the gathering that interests you,
            read what to expect on its event page, and show up as you are.
          </p>
          <p>
            You do not need to know anyone already, prepare a clever answer, or
            be an expert in the topic.
          </p>
        </div>
      </section>

      <section
        className="home-community-feel attending-note"
        aria-labelledby="home-community-feel-title"
      >
        <div>
          <p className="section-kicker">What the community feels like</p>
          <h2 id="home-community-feel-title">
            Thoughtful, welcoming, and genuinely social.
          </h2>
        </div>
        <div>
          <p>
            The point is not to perform expertise. It is to follow an
            interesting thread together, make room for different perspectives,
            and let conversation become connection.
          </p>
        </div>
      </section>

      <section className="lane-index" aria-labelledby="lane-index-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Four activity lanes</p>
            <h2 id="lane-index-title">Choose what pulls you in</h2>
          </div>
        </div>
        <div className="lane-index__grid">
          {lanes.map((lane, index) => (
            <article
              className="lane-note"
              data-event-lane={lane.slug}
              key={lane.slug}
            >
              <div>
                <span aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h3>{lane.name}</h3>
              {lane.description ? <p>{lane.description}</p> : null}
              <Link
                href={`/events?lane=${encodeURIComponent(lane.slug)}`}
                prefetch={false}
              >
                Explore {lane.name}
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="home-clubs" aria-labelledby="home-clubs-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Clubs</p>
            <h2 id="home-clubs-title">Find your recurring doorway</h2>
          </div>
          <Link href="/clubs">See all clubs</Link>
        </div>
        <div className="home-clubs__grid">
          {clubs.map((club) => (
            <article
              data-event-lane={club.lane.slug}
              key={club.slug}
              style={
                club.themeColor
                  ? ({ "--club-accent": club.themeColor } as CSSProperties)
                  : undefined
              }
            >
              <p>{club.lane.name}</p>
              <h3>
                <Link href={`/clubs/${club.slug}`}>{club.name}</Link>
              </h3>
              {club.description ? <p>{club.description}</p> : null}
            </article>
          ))}
        </div>
      </section>

      <section
        className="home-proof home-community"
        aria-labelledby="home-proof-title"
      >
        <div>
          <p className="section-kicker">Community proof</p>
          <h2 id="home-proof-title">The club beyond this homepage</h2>
          <p>{catalog.site.mission}</p>
        </div>
        {catalog.communityLinks.length > 0 ? (
          <ul aria-label="Official Vancouver Curiosity Club destinations">
            {catalog.communityLinks.map((link) => (
              <li key={`${link.linkType}:${link.url}`}>
                <a href={link.url} rel="noreferrer noopener">
                  {link.label} <span aria-hidden="true">↗</span>
                </a>
                {link.description ? <p>{link.description}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section
        className="home-closing home-invitation"
        aria-labelledby="home-closing-title"
      >
        <div>
          <p className="section-kicker">Come to the next one</p>
          <h2 id="home-closing-title">Follow the question that catches you.</h2>
          <p>Choose a published gathering and take the next small step.</p>
        </div>
        <div className="home-invitation__actions">
          <Link
            className="primary-action"
            href="/events"
            prefetch={false}
          >
            See upcoming gatherings
          </Link>
        </div>
      </section>

      {origin && !privatePreview ? (
        <StructuredData
          value={{
            "@context": "https://schema.org",
            "@type": "Organization",
            name: catalog.site.brandName,
            ...(catalog.site.legalName
              ? { legalName: catalog.site.legalName }
              : {}),
            url: publicUrl("/", origin),
            areaServed: { "@type": "City", name: "Vancouver" },
            sameAs: catalog.communityLinks
              .filter(
                (link) =>
                  link.linkType === "meetup_group" ||
                  link.linkType === "social_profile",
              )
              .map((link) => link.url),
          }}
        />
      ) : null}
    </main>
  );
}

function HomeHeroPoster({
  event,
  index,
}: Readonly<{ event: PublicEventCardDto; index: number }>) {
  if (!event.artwork) {
    return (
      <article
        className="home-hero__poster home-hero__poster--fallback"
        data-poster-position={index + 1}
      >
        <p>{event.club.name}</p>
        <h2>{event.title}</h2>
      </article>
    );
  }

  return (
    <figure
      className="home-hero__poster"
      data-poster-position={index + 1}
    >
      {/* Published media URLs enforce the rights and usage boundary, so these
          images intentionally bypass Next/Image's independent optimizer cache. */}
      <EventPosterImage
        alt={event.artwork.altText ?? ""}
        decoding="async"
        fallback={
          <div
            aria-label={`${event.title}, ${event.club.name} event`}
            className="home-hero__poster-image-fallback"
            role="img"
          >
            <p>{event.club.name}</p>
            <strong>{event.title}</strong>
          </div>
        }
        fetchPriority={index === 0 ? "high" : "auto"}
        height={event.artwork.dimensions.large.height}
        loading={index === 0 ? "eager" : "lazy"}
        sizes="(max-width: 700px) 100vw, (max-width: 1120px) 50vw, 38vw"
        src={event.artwork.url}
        srcSet={responsiveImageSrcSet([
          {
            url: event.artwork.srcSet.small,
            width: event.artwork.dimensions.small.width,
          },
          {
            url: event.artwork.srcSet.medium,
            width: event.artwork.dimensions.medium.width,
          },
          {
            url: event.artwork.srcSet.large,
            width: event.artwork.dimensions.large.width,
          },
        ])}
        style={{
          objectPosition: `${event.artwork.focalPoint.x / 100}% ${event.artwork.focalPoint.y / 100}%`,
        }}
        width={event.artwork.dimensions.large.width}
      />
      <figcaption>
        <Link href={`/events/${event.slug}`} prefetch={false}>
          {event.title}
        </Link>
        <span>Artwork: {event.artwork.credit}</span>
      </figcaption>
    </figure>
  );
}

function selectHomepageClubs(
  clubs: readonly PublicClubDto[],
): readonly PublicClubDto[] {
  const current = clubs.filter((club) => !club.archived);
  return [
    ...current.filter((club) => club.featured),
    ...current.filter((club) => !club.featured),
  ].slice(0, 6);
}
