import Link from "next/link";
import { EventPosterImage } from "@/app/_components/EventPosterImage";
import { OrganizerNote } from "@/app/_components/OrganizerNote";
import type { CSSProperties } from "react";
import { EventCard } from "./EventCard";
import { StructuredData } from "./StructuredData";
import {
  discoveryArtworkCredit,
  responsiveImageSrcSet,
} from "@/lib/media/presentation";
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
  const { heroEvent, upcomingEvents } = selectHomeDiscoveryEvents(events);
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
            >
              See upcoming gatherings
            </Link>
            <Link href="#new-here">New here? Start here</Link>
          </div>
        </div>

        {heroEvent ? (
          <div
            className="home-hero__featured-poster"
            aria-label="Featured upcoming gathering"
            role="group"
          >
            <HomeHeroPoster event={heroEvent} />
          </div>
        ) : null}
      </section>

      <section className="home-events" aria-labelledby="home-events-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Coming up next</p>
            <h2 id="home-events-title">More ways to join in</h2>
          </div>
          <Link href="/events">
            See all upcoming gatherings
          </Link>
        </div>
        {upcomingEvents.length > 0 ? (
          <div className="event-list">
            {upcomingEvents.map((event) => (
              <EventCard event={event} key={event.slug} />
            ))}
          </div>
        ) : heroEvent ? (
          <div className="public-empty-state">
            <p className="section-kicker">More gatherings</p>
            <h3>Those are the next gatherings.</h3>
            <p>See the complete events page as more dates are added.</p>
            <Link href="/events">
              Open events
            </Link>
          </div>
        ) : (
          <div className="public-empty-state">
            <p className="section-kicker">Upcoming gatherings</p>
            <h3>No upcoming event yet.</h3>
            <p>Check the complete events page for the latest public listings.</p>
            <Link href="/events">
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
            How a gathering begins depends on the event. Its page tells you the
            topic or activity, place, timing, preparation, arrival details, and
            what to expect. Follow those specific details rather than assuming
            every club uses the same routine.
          </p>
          <p>
            You do not need to know anyone already, prepare a clever answer, or
            be an expert in the topic. The point is not to perform expertise,
            but to follow an interesting thread together and make room for
            different perspectives.
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
              >
                See {lane.name} events
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
        className="home-mission home-community"
        aria-labelledby="home-organizer-note-title"
      >
        <OrganizerNote headingId="home-organizer-note-title" />
      </section>

      {catalog.communityLinks.length > 0 ? (
        <section
          className="home-proof home-community"
          aria-labelledby="home-official-links-title"
        >
          <div className="home-official-links">
            <p className="section-kicker">Official community links</p>
            <h2 id="home-official-links-title">
              Find the club beyond this website.
            </h2>
            <p>{catalog.site.mission}</p>
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
          </div>
        </section>
      ) : null}

      <section
        className="home-closing home-invitation"
        aria-labelledby="home-closing-title"
      >
        <div>
          <p className="section-kicker">Come to the next one</p>
          <h2 id="home-closing-title">Follow the question that catches you.</h2>
          <p>Choose a gathering and take the next small step.</p>
        </div>
        <div className="home-invitation__actions">
          <Link
            className="primary-action"
            href="/events"
          >
            See upcoming gatherings
          </Link>
          <Link href="/get-involved">Get involved</Link>
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

function HomeHeroPoster({ event }: Readonly<{ event: PublicEventCardDto }>) {
  if (!event.artwork) {
    return (
      <article className="home-hero__poster home-hero__poster--fallback">
        <p>{event.club.name}</p>
        <h2>
          <Link href={`/events/${event.slug}`}>
            {event.title}
          </Link>
        </h2>
      </article>
    );
  }

  const artworkCredit = discoveryArtworkCredit(event.artwork.credit);

  return (
    <figure className="home-hero__poster">
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
        fetchPriority="high"
        height={event.artwork.dimensions.large.height}
        loading="eager"
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
        <Link href={`/events/${event.slug}`}>
          {event.title}
        </Link>
        {artworkCredit ? <span>Artwork: {artworkCredit}</span> : null}
      </figcaption>
    </figure>
  );
}

function selectHomeDiscoveryEvents(
  events: readonly PublicEventCardDto[],
): Readonly<{
  heroEvent: PublicEventCardDto | null;
  upcomingEvents: readonly PublicEventCardDto[];
}> {
  const heroEvent =
    events.find((event) => event.artwork !== null) ?? events[0] ?? null;
  if (!heroEvent) {
    return Object.freeze({
      heroEvent: null,
      upcomingEvents: Object.freeze([]),
    });
  }

  const seenArtworkUrls = new Set<string>();
  const seenSlugs = new Set([heroEvent.slug]);
  if (heroEvent.artwork) seenArtworkUrls.add(heroEvent.artwork.url);
  const upcomingEvents: PublicEventCardDto[] = [];
  for (const event of events) {
    if (
      upcomingEvents.length >= 3 ||
      !event.artwork ||
      seenSlugs.has(event.slug) ||
      seenArtworkUrls.has(event.artwork.url)
    ) {
      continue;
    }
    seenSlugs.add(event.slug);
    seenArtworkUrls.add(event.artwork.url);
    upcomingEvents.push(event);
  }
  return Object.freeze({
    heroEvent,
    upcomingEvents: Object.freeze(upcomingEvents),
  });
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
