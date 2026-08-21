import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import { EventPosterImage } from "@/app/_components/EventPosterImage";
import { EventCard } from "./EventCard";
import { StructuredData } from "./StructuredData";
import {
  discoveryArtworkCredit,
  responsiveImageSrcSet,
} from "@/lib/media/presentation";
import type {
  PublicCatalogDto,
  PublicPageDto,
} from "@/lib/server/public/catalog";
import type { PublicEventCardDto } from "@/lib/server/public/events";
import type { ResponsiveMediaAssetDto } from "@/lib/server/media/usage";
import { publicUrl } from "@/lib/server/public/origin";
import { PUBLIC_HOME_MISSION_COPY } from "@/lib/public-mission-copy";

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

  return (
    <main className="home-page" data-page-slug={page.slug}>
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__copy">
          <p className="eyebrow">{PUBLIC_HOME_MISSION_COPY.eyebrow}</p>
          <h1 id="home-title">{PUBLIC_HOME_MISSION_COPY.heading}</h1>
          <p className="home-hero__deck">{PUBLIC_HOME_MISSION_COPY.body}</p>
          <div className="home-hero__actions">
            <Link className="primary-action" href="#our-work">
              Explore our work
            </Link>
            <Link href="/for-organizations">Partner with us</Link>
          </div>
          <Link className="home-hero__events-link" href="/events">
            View upcoming events
          </Link>
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
            <p className="section-kicker">Our work in action</p>
            <h2 id="home-events-title">Upcoming community programs</h2>
          </div>
          <Link href="/events">View all events</Link>
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
            <Link href="/events">Open events</Link>
          </div>
        ) : (
          <div className="public-empty-state">
            <p className="section-kicker">Upcoming gatherings</p>
            <h3>No upcoming event yet.</h3>
            <p>Check the complete events page for the latest public listings.</p>
            <Link href="/events">Open events</Link>
          </div>
        )}
      </section>

      <section
        className="home-newcomer attending-note"
        id="new-here"
        aria-labelledby="home-newcomer-title"
      >
        <div>
          <p className="section-kicker">For participants</p>
          <h2 id="home-newcomer-title">Coming for the first time?</h2>
        </div>
        <div>
          <p>
            Come on your own, choose a gathering that interests you, and use
            the event page for the practical details. No prior expertise—or
            pre-existing social circle—is required.
          </p>
        </div>
      </section>

      <section
        className="lane-index"
        id="our-work"
        aria-labelledby="lane-index-title"
      >
        <div className="section-heading">
          <div>
            <p className="section-kicker">What we do</p>
            <h2 id="lane-index-title">Many interests. One purpose.</h2>
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
              <Link href={`/events?lane=${encodeURIComponent(lane.slug)}`}>
                See {lane.name} events
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section
        className="home-mission home-community"
        aria-labelledby="home-impact-title"
      >
        <div>
          <p className="section-kicker">How the work helps</p>
          <h2 id="home-impact-title">
            Connection grows when people have a reason to return.
          </h2>
        </div>
        <div>
          <p>Our gatherings are designed to make three things easier:</p>
          <ul aria-label="How Vancouver Curiosity Club gatherings help">
            <li>
              <strong>Arrive without an existing circle.</strong>
              <p>
                A shared question or activity gives people a natural place to
                begin.
              </p>
            </li>
            <li>
              <strong>Connect through substance.</strong>
              <p>
                Books, films, ideas, creative practice, and city experiences
                make room for genuine exchange.
              </p>
            </li>
            <li>
              <strong>Return to something dependable.</strong>
              <p>
                Recurring programs create continuity, helping unfamiliar faces
                become familiar over time.
              </p>
            </li>
          </ul>
          <p>
            We are building for the long term through an ongoing public
            calendar, recurring programs across three official Meetup groups,
            clear public standards, and partnerships that can support the work
            across seasons and years.
          </p>
        </div>
      </section>

      <section
        className="home-closing home-invitation"
        aria-labelledby="home-closing-title"
      >
        <div>
          <p className="section-kicker">Work with us</p>
          <h2 id="home-closing-title">
            Help build a lasting home for curiosity in Vancouver.
          </h2>
          <p>
            We welcome conversations with community organizations, venues,
            funders, and supporters who believe thoughtful public gatherings
            strengthen belonging.
          </p>
        </div>
        <div className="home-invitation__actions">
          <Link className="primary-action" href="/get-involved#partner">
            Start a partnership conversation
          </Link>
          <Link href="/events">See upcoming gatherings</Link>
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
