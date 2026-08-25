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
import { selectCanonicalPublicCommunities } from "@/lib/public-community-order";

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
  const publicClubs = selectCanonicalPublicCommunities(catalog.clubs);
  const verifiedFacts = verifiedInstitutionalFacts(
    catalog.site.institutionalFacts,
  );
  const glanceFacts = [
    ...(catalog.site.locationLabel
      ? [
          {
            body: "Locally based and publicly accessible",
            heading: catalog.site.locationLabel,
          },
        ]
      : []),
    ...(lanes.length > 0
      ? [
          {
            body: "Learning, culture, creativity, and shared experience",
            heading: `${lanes.length} program ${lanes.length === 1 ? "stream" : "streams"}`,
          },
        ]
      : []),
    ...(publicClubs.length > 0
      ? [
          {
            body: "Distinct interests under one organizational home",
            heading: `${publicClubs.length} public ${publicClubs.length === 1 ? "community" : "communities"}`,
          },
        ]
      : []),
    {
      body: "Published event details, conduct, accessibility, and privacy information",
      heading: "Public calendar and standards",
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
          <h1 id="home-title">{PUBLIC_HOME_MISSION_COPY.heading}</h1>
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
          <p className="section-kicker">Organization at a glance</p>
          <h2 id="home-glance-title">Public programs with a clear community purpose.</h2>
        </div>
        <div className="home-glance__index">
          <ol className="home-glance__facts">
            {glanceFacts.map((fact, index) => (
              <li key={fact.heading}>
                <span className="home-glance__number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>{fact.heading}</strong>
                  <span>{fact.body}</span>
                </div>
              </li>
            ))}
          </ol>
          {verifiedFacts.length > 0 ? (
            <dl className="home-glance__verified">
              {verifiedFacts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
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
          <p className="section-kicker">What we do</p>
          <h2 id="home-programs-title">Four ways into community life.</h2>
        </div>
        <div className="home-programs__list">
          {lanes.map((lane, index) => (
            <article
              className="home-program"
              data-event-lane={lane.slug}
              key={lane.slug}
            >
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{lane.name}</h3>
                {lane.description ? <p>{lane.description}</p> : null}
              </div>
              <Link href={`/events?lane=${encodeURIComponent(lane.slug)}`}>
                View {lane.name} events
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section
        className="home-work"
        data-home-section="work-in-action"
        data-home-layout="staggered-poster-composition"
        aria-labelledby="home-work-title"
      >
        <div className="home-section-heading">
          <p className="section-kicker">Our work in action</p>
          <h2 id="home-work-title">Upcoming public programs.</h2>
        </div>
        {upcomingEvents.length > 0 ? (
          <>
            <div className="home-work__grid">
              {upcomingEvents.map((event) => (
                <HomeWorkEvent event={event} key={event.slug} />
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
        className="home-impact"
        data-home-section="why-it-matters"
        data-home-layout="large-statement"
        aria-labelledby="home-impact-title"
      >
        <div className="home-impact__statement">
          <p className="section-kicker">Why this work matters</p>
          <h2 id="home-impact-title">Shared curiosity makes connection easier to begin.</h2>
        </div>
        <ol className="home-impact__sequence">
          {communityModel.map((item, index) => (
            <li key={item.heading}>
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{item.heading}</h3>
                <p>{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="home-partnerships"
        data-home-section="partnerships"
        data-home-layout="full-width-colour"
        aria-labelledby="home-partnerships-title"
      >
        <div className="home-partnerships__intro">
          <p className="section-kicker">Partnership opportunities</p>
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
        <ul>
          {partnershipOpportunities.map((opportunity) => (
            <li key={opportunity}>{opportunity}</li>
          ))}
        </ul>
      </section>

      <section
        className="home-communities"
        data-home-section="communities"
        data-home-layout="alternating-image-splits"
        aria-labelledby="home-communities-title"
      >
        <div className="home-section-heading">
          <p className="section-kicker">
            {publicClubs.length === 3
              ? "One organization, three public communities"
              : "Public communities"}
          </p>
          <h2 id="home-communities-title">Different interests, one public home.</h2>
        </div>
        <div className="home-communities__list">
          {publicClubs.map((club, index) => (
            <HomeCommunity club={club} index={index} key={club.slug} />
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
          <p className="section-kicker">Open to the public</p>
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
    <figure className="home-hero__poster" data-home-hero-event={event.slug}>
      <Link
        aria-label={`View event: ${displayTitle}`}
        className="home-hero__poster-link"
        href={`/events/${event.slug}`}
      >
        <span className="home-hero__poster-preview" aria-hidden="true">
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
          fetchPriority="high"
          height={event.artwork.dimensions.large.height}
          loading="eager"
          sizes="(max-width: 700px) 100vw, (max-width: 1120px) 46vw, 35vw"
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
      </Link>
      <figcaption>
        <span>Featured upcoming program</span>
        <Link href={`/events/${event.slug}`}>{displayTitle}</Link>
        {artworkCredit ? <small>Artwork: {artworkCredit}</small> : null}
      </figcaption>
    </figure>
  );
}

function HomeWorkEvent({ event }: Readonly<{ event: PublicEventCardDto }>) {
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

  return (
    <article className="home-work-card" data-home-event-slug={event.slug}>
      <figure>
        <div className="home-work-card__media">
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
            sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 30vw"
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
      <div className="home-work-card__body">
        <p className="home-work-card__association">
          {event.club.name}{association ? ` · ${association}` : ""}
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
  index,
}: Readonly<{ club: PublicClubDto; index: number }>) {
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
        <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        <h3>{club.name}</h3>
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
    </article>
  );
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

function verifiedInstitutionalFacts(
  facts: PublicCatalogDto["site"]["institutionalFacts"] | undefined,
): readonly Readonly<{ label: string; value: string }>[] {
  if (!facts) return Object.freeze([]);
  return Object.freeze([
    ...(facts.foundedYear !== null
      ? [{ label: "Founded", value: String(facts.foundedYear) }]
      : []),
    ...(facts.attendanceTotal !== null && facts.attendanceTotalAsOf
      ? [
          {
            label: `Recorded attendance through ${formatFactDate(
              facts.attendanceTotalAsOf,
            )}`,
            value: new Intl.NumberFormat("en-CA").format(
              facts.attendanceTotal,
            ),
          },
        ]
      : []),
    ...(facts.memberTotal !== null && facts.memberTotalAsOf
      ? [
          {
            label: `Members as of ${formatFactDate(facts.memberTotalAsOf)}`,
            value: new Intl.NumberFormat("en-CA").format(facts.memberTotal),
          },
        ]
      : []),
  ]);
}

function formatFactDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00.000Z`));
}
