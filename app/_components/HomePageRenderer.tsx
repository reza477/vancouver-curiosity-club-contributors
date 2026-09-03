import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import { EventPosterImage } from "@/app/_components/EventPosterImage";
import { formatEventSchedule } from "@/app/_components/EventCard";
import { StructuredData } from "@/app/_components/StructuredData";
import {
  discoveryArtworkCredit,
  responsiveImageSrcSet,
} from "@/lib/media/presentation";
import { publicEventLocationParts } from "@/lib/public-event-facts";
import { institutionalEventTitle } from "@/lib/public-event-display-title";
import { clubCoverArtworkForSlug } from "@/lib/club-cover-art";
import type {
  PublicCatalogDto,
  PublicClubDto,
  PublicPageDto,
} from "@/lib/server/public/catalog";
import type { PublicEventCardDto } from "@/lib/server/public/events";
import type { ResponsiveMediaAssetDto } from "@/lib/server/media/usage";
import { publicUrl } from "@/lib/server/public/origin";
import { PUBLIC_HOME_MISSION_COPY } from "@/lib/public-mission-copy";
import { PUBLIC_HOME_PARTICIPANT_FEEDBACK } from "@/lib/public-home-participant-feedback";
import { selectCanonicalPublicCommunities } from "@/lib/public-community-order";
import {
  PUBLIC_PROGRAM_STREAM_VISUAL_MAP,
  publicProgramStreamVisualForLaneSlug,
} from "@/lib/public-program-stream-visuals";

const partnershipOpportunities = [
  "Program funding or sponsorship",
  "Venue and space partnerships",
  "Co-presented public programs",
  "Educational or cultural collaboration",
  "Community outreach and referrals",
  "Appropriate in-kind support",
] as const;

const communityModel = [
  {
    heading: "Arrive without an existing circle",
    body: "A clear activity or subject gives people a natural place to begin.",
  },
  {
    heading: "Start with something shared",
    body: "Books, films, ideas, making, walks, food, and play give conversation shape.",
  },
  {
    heading: "Have a reason to return",
    body: "Recurring programs create reasons to participate and see familiar faces.",
  },
  {
    heading: "Find more than one way in",
    body: "Different formats make room for varied interests, energy, and participation.",
  },
] as const;

const homeGlanceStreamVisuals = [
  PUBLIC_PROGRAM_STREAM_VISUAL_MAP.think,
  PUBLIC_PROGRAM_STREAM_VISUAL_MAP["reset-make"],
  PUBLIC_PROGRAM_STREAM_VISUAL_MAP.explore,
  PUBLIC_PROGRAM_STREAM_VISUAL_MAP["eat-play"],
] as const;

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
  const heroHeadingLines = splitHomeHeroHeading(
    PUBLIC_HOME_MISSION_COPY.heading,
  );
  const lanes = catalog.lanes.slice(0, 4);
  const publicClubs = selectCanonicalPublicCommunities(catalog.clubs);
  const glanceFacts = [
    ...(catalog.site.locationLabel
      ? [
          {
            body: "Locally based and publicly accessible",
            heading: catalog.site.locationLabel,
            id: "location",
          },
        ]
      : []),
    ...(lanes.length > 0
      ? [
          {
            body: "Learning, culture, creativity, and shared experience",
            heading: `${lanes.length} program ${lanes.length === 1 ? "stream" : "streams"}`,
            id: "streams",
          },
        ]
      : []),
    ...(publicClubs.length > 0
      ? [
          {
            body: "Distinct interests under one organizational home",
            heading: `${publicClubs.length} public ${publicClubs.length === 1 ? "community" : "communities"}`,
            id: "communities",
          },
        ]
      : []),
    {
      body: "Published event details, conduct, accessibility, and privacy information",
      heading: "Public calendar and standards",
      id: "standards",
    },
  ];

  return (
    <main className="home-page" data-page-slug={page.slug}>
      <section
        className={`home-hero${heroEvent ? "" : " home-hero--text-only"}`}
        data-home-section="hero"
        data-home-layout={heroEvent ? "image-led-split" : "text-only-statement"}
        aria-labelledby="home-title"
      >
        <div className="home-hero__copy">
          <p className="eyebrow">{PUBLIC_HOME_MISSION_COPY.eyebrow}</p>
          <h1 aria-label={PUBLIC_HOME_MISSION_COPY.heading} id="home-title">
            {heroHeadingLines.map((line, index) => (
              <span className="home-hero__line" aria-hidden="true" key={line}>
                <span>
                  {line}
                  {index < heroHeadingLines.length - 1 ? " " : null}
                </span>
              </span>
            ))}
          </h1>
          {PUBLIC_HOME_MISSION_COPY.paragraphs.map((paragraph) => (
            <p className="home-hero__deck" key={paragraph}>
              {paragraph}
            </p>
          ))}
          <div className="home-hero__actions">
            <Link className="primary-action" href="#our-work">
              Explore our work
            </Link>
            <Link href="/for-organizations">Partner with us</Link>
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

      <section
        className="home-glance"
        data-home-section="at-a-glance"
        data-home-layout="compact-editorial-index"
        aria-labelledby="home-glance-title"
      >
        <div className="home-section-heading">
          <h2 id="home-glance-title">Public programs with a clear community purpose.</h2>
        </div>
        <div className="home-glance__index">
          <dl className="home-glance__facts">
            {glanceFacts.map((fact) => (
              <div
                className={`home-glance__fact home-glance__fact--${fact.id}`}
                data-home-glance-fact={fact.id}
                key={fact.heading}
              >
                <dt>{fact.heading}</dt>
                <dd>{fact.body}</dd>
                {fact.id === "streams" ? (
                  <span
                    aria-hidden="true"
                    className="home-glance__stream-rule"
                  >
                    {homeGlanceStreamVisuals.map((stream) => (
                      <span key={stream.id} style={stream.style} />
                    ))}
                  </span>
                ) : null}
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section
        className="home-programs"
        id="our-work"
        data-home-section="programs"
        data-home-layout="full-width-colour"
        aria-labelledby="home-programs-title"
      >
        <div className="home-section-heading">
          <h2 id="home-programs-title">Four ways into community life.</h2>
        </div>
        <div className="home-programs__list">
          {lanes.map((lane) => {
            const streamVisual =
              publicProgramStreamVisualForLaneSlug(lane.slug);
            return (
              <article
                className="home-program"
                data-artwork-reveal="program-stream"
                data-event-lane={lane.slug}
                data-program-stream={streamVisual.id}
                key={lane.slug}
                style={streamVisual.style}
              >
                <div>
                  <h3>{lane.name}</h3>
                  {lane.description ? <p>{lane.description}</p> : null}
                </div>
                <Link href={`/events?lane=${encodeURIComponent(lane.slug)}`}>
                  View {lane.name} events
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="home-work"
        data-home-section="work-in-action"
        data-home-layout="living-poster-stage"
        aria-labelledby="home-work-title"
      >
        <div className="home-section-heading">
          <h2 id="home-work-title">Upcoming public programs.</h2>
        </div>
        {upcomingEvents.length > 0 ? (
          <>
            <div className="home-work__grid" data-living-poster-stage>
              {upcomingEvents.map((event, index) => (
                <HomeWorkEvent event={event} index={index} key={event.slug} />
              ))}
            </div>
            <Link className="home-work__calendar-link" href="/events">
              View the public event calendar
            </Link>
          </>
        ) : (
          <div className="home-work__empty public-empty-state">
            <p className="section-kicker">Upcoming programs</p>
            <h3>The next public listings are being prepared.</h3>
            <p>Use the event calendar for the latest confirmed information.</p>
            <Link className="home-work__calendar-link" href="/events">
              View the public event calendar
            </Link>
          </div>
        )}
      </section>

      <section
        className="home-feedback"
        data-home-section="participant-feedback"
        data-home-layout="asymmetric-editorial-feedback"
        aria-labelledby="home-feedback-title"
      >
        <div className="home-feedback__summary">
          <h2 id="home-feedback-title">What participants say.</h2>
          <p className="home-feedback__rating">
            {`${PUBLIC_HOME_PARTICIPANT_FEEDBACK.rating.toFixed(1)} out of ${PUBLIC_HOME_PARTICIPANT_FEEDBACK.ratingScale} on Meetup`}
          </p>
          <p className="home-feedback__counts">
            {`${PUBLIC_HOME_PARTICIPANT_FEEDBACK.ratingCount} ratings · ${PUBLIC_HOME_PARTICIPANT_FEEDBACK.fiveStarRatingCount} five-star ratings`}
          </p>
          <p className="home-feedback__source">
            {`Meetup ratings and feedback verified ${PUBLIC_HOME_PARTICIPANT_FEEDBACK.verificationDate}.`}
          </p>
          <a
            className="home-feedback__link"
            href={PUBLIC_HOME_PARTICIPANT_FEEDBACK.meetupGroupUrl}
            rel="noreferrer noopener"
            target="_blank"
          >
            See {PUBLIC_HOME_PARTICIPANT_FEEDBACK.meetupGroupName} on Meetup
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
        <div className="home-feedback__quotes">
          {PUBLIC_HOME_PARTICIPANT_FEEDBACK.quotes.map((quote, index) => (
            <blockquote
              className={`home-feedback__quote${index === 0 ? " home-feedback__quote--lead" : ""}`}
              key={`${quote.displayName}-${quote.eventContext}`}
            >
              <p>{quote.comment}</p>
              <footer>
                — {quote.displayName}, <cite>{quote.eventContext}</cite>
              </footer>
            </blockquote>
          ))}
        </div>
      </section>

      <section
        className="home-impact"
        data-home-section="why-it-matters"
        data-home-layout="large-statement"
        aria-labelledby="home-impact-title"
      >
        <div className="home-impact__statement">
          <h2 id="home-impact-title">Shared curiosity makes connection easier to begin.</h2>
        </div>
        <ul className="home-impact__sequence">
          {communityModel.map((item) => (
            <li key={item.heading}>
              <div>
                <h3>{item.heading}</h3>
                <p>{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="home-partnerships"
        data-home-section="partnerships"
        data-home-layout="full-width-colour"
        aria-labelledby="home-partnerships-title"
      >
        <div className="home-partnerships__intro">
          <h2 id="home-partnerships-title">Work with us</h2>
          <p>
            Vancouver Curiosity Club welcomes conversations with organizations
            interested in helping thoughtful public programs grow.
          </p>
          <div className="home-partnerships__actions">
            <Link
              className="primary-action"
              href="/contact?topic=partnerships#contact-form"
            >
              Discuss a partnership
            </Link>
            <Link href="/for-organizations">Information for organizations</Link>
          </div>
        </div>
        <ul
          className="home-partnerships__opportunities"
          aria-label="Ways organizations can work with us"
        >
          {partnershipOpportunities.map((opportunity) => (
            <li key={opportunity}>{opportunity}</li>
          ))}
        </ul>
      </section>

      <section
        className="home-communities"
        data-home-section="communities"
        data-home-layout="interactive-triptych"
        aria-labelledby="home-communities-title"
      >
        <div className="home-section-heading">
          <h2 id="home-communities-title">Different interests, one public home.</h2>
        </div>
        <div className="home-communities__list" data-community-triptych>
          {publicClubs.map((club) => (
            <HomeCommunity club={club} key={club.slug} />
          ))}
        </div>
      </section>

      <section
        className="home-public-invitation"
        data-home-section="public-invitation"
        data-home-layout="compact-callout"
        aria-labelledby="home-public-title"
      >
        <div>
          <h2 id="home-public-title">
            Our programs are open to curious people across Vancouver.
          </h2>
        </div>
        <Link className="primary-action" href="/events">
          Explore upcoming events
        </Link>
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
  if (!event.artwork) return null;
  const artworkCredit = discoveryArtworkCredit(event.artwork.credit);
  const displayTitle = institutionalEventTitle(event);

  return (
    <Link
      aria-label={`View event: ${displayTitle}`}
      className="home-hero__poster-link"
      href={`/events/${event.slug}`}
    >
      <figure className="home-hero__poster" data-home-hero-event={event.slug}>
        <span className="home-hero__poster-media">
          <span className="home-hero__poster-preview" aria-hidden="true">
            <span>{event.club.name}</span>
            <strong>{displayTitle}</strong>
          </span>
          <EventPosterImage
            alt={event.artwork.altText ?? `${displayTitle} event poster`}
            decoding="async"
            fallback={
              <span
                aria-label={`${displayTitle} event poster unavailable`}
                className="home-artwork-fallback"
                role="img"
              >
                <span>{event.club.name}</span>
                <strong>{displayTitle}</strong>
              </span>
            }
            fetchPriority="high"
            height={event.artwork.dimensions.large.height}
            loading="eager"
            sizes="(max-width: 700px) 100vw, (max-width: 1120px) 52vw, 56vw"
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
        </span>
        <figcaption>
          <span>Featured upcoming program</span>
          <strong>{displayTitle}</strong>
          {artworkCredit ? <small>Artwork: {artworkCredit}</small> : null}
        </figcaption>
      </figure>
    </Link>
  );
}

function HomeWorkEvent({
  event,
  index,
}: Readonly<{ event: PublicEventCardDto; index: number }>) {
  if (!event.artwork) return null;
  const artworkCredit = discoveryArtworkCredit(event.artwork.credit);
  const displayTitle = institutionalEventTitle(event);
  const schedule = formatEventSchedule(event);
  const venueLocation = publicEventLocationParts(event).slice(0, 2).join(" · ");
  const location =
    event.attendanceMode === "online"
      ? "Online"
      : event.attendanceMode === "hybrid"
        ? venueLocation
          ? `${venueLocation} · Hybrid`
          : "Hybrid · location details not published"
        : venueLocation ||
          (event.attendanceMode === "in-person"
            ? "Location details not published"
            : "Location undecided");
  const association = event.program?.name ?? event.lane?.name;
  const streamVisual = publicProgramStreamVisualForLaneSlug(event.lane?.slug);

  return (
    <article
      className="home-work-card"
      data-home-event-slug={event.slug}
      data-program-stream={streamVisual.id}
      data-stage-event-index={index}
      role="article"
      style={streamVisual.style}
    >
      <Link
        aria-label={`View event poster: ${displayTitle}`}
        className="home-work-card__poster-link"
        data-stage-poster
        href={`/events/${event.slug}`}
      >
        <figure>
          <div className="home-work-card__media">
            <span className="home-work-card__preview" aria-hidden="true">
              <span>{event.club.name}</span>
              <strong>{displayTitle}</strong>
            </span>
            <EventPosterImage
              alt={event.artwork.altText ?? `${displayTitle} event poster`}
              decoding="async"
              fallback={
                <div
                  aria-label={`${displayTitle} event poster unavailable`}
                  className="home-artwork-fallback"
                  role="img"
                >
                  <span>{event.club.name}</span>
                  <strong>{displayTitle}</strong>
                </div>
              }
              height={event.artwork.dimensions.large.height}
              loading="lazy"
              sizes="(max-width: 700px) 100vw, (max-width: 1023px) 50vw, 54vw"
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
          </div>
          {artworkCredit ? <figcaption>Artwork: {artworkCredit}</figcaption> : null}
        </figure>
      </Link>
      <div className="home-work-card__body" data-stage-summary>
        <p className="home-work-card__association">
          <span>{event.club.name}</span>
          {association ? (
            <>
              <span> · </span>
              <span className="home-work-card__stream-name">
                {association}
              </span>
            </>
          ) : null}
        </p>
        <h3>
          <Link href={`/events/${event.slug}`}>{displayTitle}</Link>
        </h3>
        <dl>
          <div>
            <dt>When</dt>
            <dd>{schedule.label}</dd>
          </div>
          <div>
            <dt>Where</dt>
            <dd>{location}</dd>
          </div>
        </dl>
        <Link className="home-work-card__link" href={`/events/${event.slug}`}>
          View event
        </Link>
      </div>
    </article>
  );
}

function HomeCommunity({
  club,
}: Readonly<{ club: PublicClubDto }>) {
  const artwork = clubCoverArtworkForSlug(club.slug);
  const descriptions: Record<string, string> = {
    "vancouver-curiosity-club": "Broad, mixed-interest public programming",
    "vancouver-fantasy-scifi-group":
      "Fantasy, science fiction, and speculative ideas",
    "vancouver-literature-and-film": "Books, literature, cinema, and discussion",
  };
  return (
    <article
      className={`home-community${artwork ? "" : " home-community--text-only"}`}
      data-community-slug={club.slug}
      tabIndex={0}
    >
      {artwork ? (
        <figure className="home-community__artwork">
          <picture>
            <source
              sizes="(max-width: 42rem) calc(100vw - 2rem), (max-width: 70rem) 52vw, 46vw"
              srcSet={artwork.srcSet}
              type="image/jpeg"
            />
            <img
              alt={artwork.altText}
              decoding="async"
              height={artwork.height}
              loading="lazy"
              src={artwork.src}
              width={artwork.width}
            />
          </picture>
          <figcaption>{artwork.credit}</figcaption>
        </figure>
      ) : null}
      <div className="home-community__body">
        <h3>{club.name}</h3>
        <div className="home-community__details">
          <div>
            <p>{descriptions[club.slug] ?? club.description}</p>
            <div className="home-community__links">
              <Link href={`/clubs/${club.slug}`}>View community</Link>
              {club.publicGroupUrl ? (
                <a href={club.publicGroupUrl} rel="noreferrer noopener" target="_blank">
                  Meetup group<span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function splitHomeHeroHeading(heading: string): readonly string[] {
  const divider = heading.lastIndexOf(" through ");
  return divider > 0
    ? Object.freeze([heading.slice(0, divider), heading.slice(divider + 1)])
    : Object.freeze([heading]);
}

export function selectHomeDiscoveryEvents(
  events: readonly PublicEventCardDto[],
): Readonly<{
  heroEvent: PublicEventCardDto | null;
  upcomingEvents: readonly PublicEventCardDto[];
}> {
  const heroEvent = events.find((event) => event.artwork !== null) ?? null;
  if (!heroEvent) {
    return Object.freeze({
      heroEvent: null,
      upcomingEvents: Object.freeze([]),
    });
  }

  const seenArtworkUrls = new Set<string>([heroEvent.artwork!.url]);
  const seenSlugs = new Set([heroEvent.slug]);
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
