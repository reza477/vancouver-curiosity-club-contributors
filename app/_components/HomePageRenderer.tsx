import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import { EventPosterImage } from "@/app/_components/EventPosterImage";
import { formatEventSchedule } from "@/app/_components/EventCard";
import { StructuredData } from "@/app/_components/StructuredData";
import {
  discoveryArtworkCredit,
  responsiveImageSrcSet,
} from "@/lib/media/presentation";
import { publicEventLocationParts } from "@/lib/public-event-facts";
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
    body: "Each gathering offers a clear activity or subject, so people have a natural place to begin.",
  },
  {
    heading: "Start with something shared",
    body: "Books, films, ideas, creative practice, walks, food, and play give conversation useful shape.",
  },
  {
    heading: "Have a reason to return",
    body: "Recurring programs create repeated opportunities to participate and see familiar faces.",
  },
  {
    heading: "Find more than one way in",
    body: "Different program formats make room for different interests, energy levels, and kinds of participation.",
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

  return (
    <main className="home-page" data-page-slug={page.slug}>
      <section
        className={`home-hero${heroEvent ? "" : " home-hero--text-only"}`}
        data-home-section="hero"
        aria-labelledby="home-title"
      >
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

      <section
        className="home-glance"
        data-home-section="at-a-glance"
        aria-labelledby="home-glance-title"
      >
        <div className="home-section-heading">
          <p className="section-kicker">Organization at a glance</p>
          <h2 id="home-glance-title">Public programs with a clear community purpose.</h2>
        </div>
        <ul className="home-glance__facts">
          {catalog.site.locationLabel ? (
            <li>
              <strong>{catalog.site.locationLabel}</strong>
              <span>Locally based and publicly accessible</span>
            </li>
          ) : null}
          {lanes.length > 0 ? (
            <li>
              <strong>
                {lanes.length} program {lanes.length === 1 ? "stream" : "streams"}
              </strong>
              <span>Learning, culture, creativity, and shared experience</span>
            </li>
          ) : null}
          {publicClubs.length > 0 ? (
            <li>
              <strong>
                {publicClubs.length} public {publicClubs.length === 1 ? "community" : "communities"}
              </strong>
              <span>Distinct interests under one organizational home</span>
            </li>
          ) : null}
          <li>
            <strong>Public calendar and standards</strong>
            <span>Published event details, conduct, accessibility, and privacy information</span>
          </li>
        </ul>
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
      </section>

      <section
        className="home-programs"
        id="our-work"
        data-home-section="programs"
        aria-labelledby="home-programs-title"
      >
        <div className="home-section-heading home-section-heading--split">
          <div>
            <p className="section-kicker">What we do</p>
            <h2 id="home-programs-title">Four ways into community life.</h2>
          </div>
          <p>
            Our program streams give people several ways to gather around a
            shared subject, activity, or experience.
          </p>
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
        aria-labelledby="home-work-title"
      >
        <div className="home-section-heading home-section-heading--split">
          <div>
            <p className="section-kicker">Our work in action</p>
            <h2 id="home-work-title">Upcoming public programs.</h2>
          </div>
          <p>
            Current events show the range of subjects and formats already on
            the public calendar.
          </p>
        </div>
        {upcomingEvents.length > 0 ? (
          <div className="home-work__grid">
            {upcomingEvents.map((event) => (
              <HomeWorkEvent event={event} key={event.slug} />
            ))}
          </div>
        ) : (
          <div className="public-empty-state">
            <p className="section-kicker">Upcoming programs</p>
            <h3>The next public listings are being prepared.</h3>
            <p>Use the event calendar for the latest confirmed information.</p>
          </div>
        )}
        <Link className="home-work__calendar-link" href="/events">
          View the public event calendar
        </Link>
      </section>

      <section
        className="home-impact"
        data-home-section="why-it-matters"
        aria-labelledby="home-impact-title"
      >
        <div className="home-section-heading">
          <p className="section-kicker">Why this work matters</p>
          <h2 id="home-impact-title">Shared curiosity makes connection easier to begin.</h2>
        </div>
        <div className="home-impact__grid">
          {communityModel.map((item, index) => (
            <article key={item.heading}>
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <h3>{item.heading}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="home-partnerships"
        data-home-section="partnerships"
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
        aria-labelledby="home-communities-title"
      >
        <div className="home-section-heading home-section-heading--split">
          <div>
            <p className="section-kicker">
              {publicClubs.length === 3
                ? "One organization, three public communities"
                : "Public communities"}
            </p>
            <h2 id="home-communities-title">Different interests, one public home.</h2>
          </div>
          <p>
            Vancouver Curiosity Club coordinates public communities with
            different programming interests under this shared website.
          </p>
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

  return (
    <figure className="home-hero__poster" data-home-hero-event={event.slug}>
      <EventPosterImage
        alt={event.artwork.altText ?? `${event.title} event poster`}
        decoding="async"
        fallback={
          <div
            aria-label={`${event.title} event poster unavailable`}
            className="home-artwork-fallback"
            role="img"
          >
            <span>{event.club.name}</span>
            <strong>{event.title}</strong>
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
      <figcaption>
        <span>Featured upcoming program</span>
        <Link href={`/events/${event.slug}`}>{event.title}</Link>
        {artworkCredit ? <small>Artwork: {artworkCredit}</small> : null}
      </figcaption>
    </figure>
  );
}

function HomeWorkEvent({ event }: Readonly<{ event: PublicEventCardDto }>) {
  if (!event.artwork) return null;
  const artworkCredit = discoveryArtworkCredit(event.artwork.credit);
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
            alt={event.artwork.altText ?? `${event.title} event poster`}
            decoding="async"
            fallback={
              <div
                aria-label={`${event.title} event poster unavailable`}
                className="home-artwork-fallback"
                role="img"
              >
                <span>{event.club.name}</span>
                <strong>{event.title}</strong>
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
          <Link href={`/events/${event.slug}`}>{event.title}</Link>
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
  const descriptions: Record<string, string> = {
    "vancouver-curiosity-club": "Broad, mixed-interest public programming",
    "vancouver-fantasy-scifi-group":
      "Fantasy, science fiction, and speculative ideas",
    "vancouver-literature-and-film": "Books, literature, cinema, and discussion",
  };
  return (
    <article>
      <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      <div>
        <h3>{club.name}</h3>
        <p>{descriptions[club.slug] ?? club.description}</p>
      </div>
      <div className="home-community__links">
        <Link href={`/clubs/${club.slug}`}>View community</Link>
        {club.publicGroupUrl ? (
          <a href={club.publicGroupUrl} rel="noreferrer noopener" target="_blank">
            Meetup group<span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
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
