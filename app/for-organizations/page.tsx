/* eslint-disable @next/next/no-css-tags -- This route owns a bounded stylesheet that must not inflate Home. */
import type { Metadata } from "next";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import {
  EventArtworkFallback,
  formatEventSchedule,
} from "@/app/_components/EventCard";
import { EventPosterImage } from "@/app/_components/EventPosterImage";
import { PageMasthead } from "@/app/_components/PageMasthead";
import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import {
  discoveryArtworkCredit,
  responsiveImageSrcSet,
} from "@/lib/media/presentation";
import { selectCanonicalPublicCommunities } from "@/lib/public-community-order";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import type { PublicCatalogDto } from "@/lib/server/public/catalog";
import { readPublicHomeEventMaterialization } from "@/lib/server/public/event-materializations";
import type { PublicEventCardDto } from "@/lib/server/public/events";
import { buildPublicPageMetadataForOrigin } from "@/lib/server/public/metadata";
import { getTrustedRequestOrigin } from "@/lib/server/public/origin";
import {
  getRequestPublicCatalog,
  getRequestPublicOrganization,
} from "@/lib/server/public/request-cache";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

const metadataDescription =
  "Partnership, funding, venue, and collaboration information for organizations interested in Vancouver Curiosity Club's public programs.";

const collaborationOptions = Object.freeze([
  Object.freeze({
    body: "Support the practical costs behind thoughtful, publicly accessible programming.",
    title: "Program funding or sponsorship",
  }),
  Object.freeze({
    body: "Help make suitable gathering spaces available for talks, workshops, discussions, and activities.",
    title: "Venue and space partnerships",
  }),
  Object.freeze({
    body: "Develop a public event around a subject or experience that fits both organizations.",
    title: "Co-presented public programs",
  }),
  Object.freeze({
    body: "Connect relevant expertise, facilitators, collections, or learning opportunities with the public.",
    title: "Educational or cultural collaboration",
  }),
  Object.freeze({
    body: "Help appropriate audiences discover public programs that may interest them.",
    title: "Community outreach and referrals",
  }),
  Object.freeze({
    body: "Contribute materials, services, or practical resources suited to a confirmed program need.",
    title: "Appropriate in-kind support",
  }),
]);

const FIRST_CONVERSATION_TOPICS = Object.freeze([
  Object.freeze({
    body: "What your organization hopes to make possible and how the idea could benefit the public.",
    title: "Shared objective",
  }),
  Object.freeze({
    body: "The audience, subject, activity, and level of structure that would make the program useful.",
    title: "Program fit",
  }),
  Object.freeze({
    body: "Possible roles, space, expertise, materials, funding, timing, and decision points.",
    title: "Practical scope",
  }),
  Object.freeze({
    body: "Accessibility, participant expectations, public communications, and how success would be understood.",
    title: "Responsible delivery",
  }),
]);

export async function generateMetadata(): Promise<Metadata> {
  const [catalog, origin] = await Promise.all([
    loadCatalog(),
    getTrustedRequestOrigin(),
  ]);
  if (!catalog) {
    return {
      title: "For Organizations",
      description: metadataDescription,
      robots: { index: false, follow: false },
    };
  }
  return buildPublicPageMetadataForOrigin(
    {
      description: metadataDescription,
      pathname: "/for-organizations",
      siteName: catalog.site.brandName,
      title: "For Organizations",
    },
    origin,
  );
}

export default async function ForOrganizationsPage() {
  const loaded = await loadOrganizationPageData();
  if (!loaded) {
    return (
      <main className="for-organizations-page">
        <link
          rel="stylesheet"
          href="/styles/organizations.css"
          precedence="organizations"
        />
        <Breadcrumbs
          items={[
            { href: "/", label: "Home" },
            { label: "For Organizations" },
          ]}
        />
        <section
          className="public-service-state"
          aria-labelledby="organizations-unavailable-title"
        >
          <p className="section-kicker">Temporarily unavailable</p>
          <h1 id="organizations-unavailable-title">
            Organization information could not be prepared.
          </h1>
          <p>Please try again shortly.</p>
        </section>
      </main>
    );
  }

  const { catalog, events } = loaded;
  const lanes = catalog.lanes.slice(0, 4);
  const clubs = selectCanonicalPublicCommunities(catalog.clubs);

  return (
    <main className="for-organizations-page">
      <link
        rel="stylesheet"
        href="/styles/organizations.css"
        precedence="organizations"
      />
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { label: "For Organizations" },
        ]}
      />
      <PageMasthead
        eyebrow="For organizations"
        title="Build thoughtful public programs with us"
        deck="Vancouver Curiosity Club creates recurring gatherings across learning, culture, creativity, and shared experience. We welcome organizations that can strengthen access, space, expertise, outreach, or sustainable program support."
      />

      <section
        className="organizations-introduction"
        aria-labelledby="organizations-purpose-title"
      >
        <div>
          <p className="section-kicker">Mission and public need</p>
          <h2 id="organizations-purpose-title">
            Thoughtful programs can make local connection easier to begin.
          </h2>
        </div>
        <div>
          <p className="organizations-lead">
            Vancouver Curiosity Club is a Vancouver-based community
            organization. We use shared subjects and activities to give people
            a natural reason to gather, enough structure to start talking, and
            recurring opportunities to take part.
          </p>
          <p>
            Organizations can help this work reach more people and become more
            durable through suitable space, aligned expertise, materials,
            referrals, co-presented programs, sponsorship, or funding.
          </p>
          <Link href="/about">Read about our mission and model</Link>
        </div>
      </section>

      <section
        className="organizations-evidence"
        aria-labelledby="organizations-evidence-title"
      >
        <div className="organizations-heading organizations-heading--split">
          <div>
            <p className="section-kicker">Current public activity</p>
            <h2 id="organizations-evidence-title">
              A program partners can review.
            </h2>
          </div>
          <div>
            <p>
              Public event materials show the range of subjects and formats.
              The calendar and community pages provide current program details.
            </p>
            <Link href="/events">View the public event calendar</Link>
          </div>
        </div>
        {events === null ? (
          <div className="organizations-evidence__empty" aria-live="polite">
            <h3>Current event details are temporarily unavailable.</h3>
            <p>Please use the public calendar to try again shortly.</p>
          </div>
        ) : events.length > 0 ? (
          <div
            className="organizations-evidence__gallery"
            aria-label="Current public event examples"
          >
            {events.map((event) => (
              <OrganizationActivityCard event={event} key={event.slug} />
            ))}
          </div>
        ) : (
          <div className="organizations-evidence__empty">
            <h3>The next public listings are being prepared.</h3>
            <p>The public calendar will show the next confirmed programs.</p>
          </div>
        )}
        <ul className="organizations-evidence__facts">
          {catalog.site.locationLabel ? (
            <li>
              <strong>{catalog.site.locationLabel}</strong>
              <span>Local base</span>
            </li>
          ) : null}
          <li>
            <strong>{lanes.length} program streams</strong>
            <span>Several formats and interests</span>
          </li>
          <li>
            <strong>{clubs.length} public communities</strong>
            <span>One organizational home</span>
          </li>
          <li>
            <strong>Current public calendar</strong>
            <span>Program details available to review</span>
          </li>
          {catalog.site.legalName ? (
            <li>
              <strong>{catalog.site.legalName}</strong>
              <span>Legal name</span>
            </li>
          ) : null}
          {catalog.site.institutionalFacts.foundedYear !== null ? (
            <li>
              <strong>{catalog.site.institutionalFacts.foundedYear}</strong>
              <span>Established</span>
            </li>
          ) : null}
          {catalog.site.institutionalFacts.attendanceTotal !== null &&
          catalog.site.institutionalFacts.attendanceTotalAsOf ? (
            <li>
              <strong>
                {new Intl.NumberFormat("en-CA").format(
                  catalog.site.institutionalFacts.attendanceTotal,
                )}
              </strong>
              <span>
                Recorded participation through{" "}
                {catalog.site.institutionalFacts.attendanceTotalAsOf}
              </span>
            </li>
          ) : null}
          {catalog.site.institutionalFacts.memberTotal !== null &&
          catalog.site.institutionalFacts.memberTotalAsOf ? (
            <li>
              <strong>
                {new Intl.NumberFormat("en-CA").format(
                  catalog.site.institutionalFacts.memberTotal,
                )}
              </strong>
              <span>
                Recorded community size as of{" "}
                {catalog.site.institutionalFacts.memberTotalAsOf}
              </span>
            </li>
          ) : null}
        </ul>
      </section>

      <section
        className="organizations-footprint"
        aria-labelledby="organizations-footprint-title"
      >
        <div className="organizations-heading">
          <p className="section-kicker">Program footprint</p>
          <h2 id="organizations-footprint-title">
            Several ways into the same community mission.
          </h2>
        </div>
        <div className="organizations-footprint__columns">
          <section aria-labelledby="organizations-streams-title">
            <h3 id="organizations-streams-title">Four program streams</h3>
            <ul>
              {lanes.map((lane) => (
                <li key={lane.slug}>
                  <div>
                    <strong>{lane.name}</strong>
                    {lane.description ? <span>{lane.description}</span> : null}
                  </div>
                  <Link href={`/events?lane=${encodeURIComponent(lane.slug)}`}>
                    View events
                    <span className="sr-only"> in {lane.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="organizations-communities-title">
            <h3 id="organizations-communities-title">Three public communities</h3>
            <ul>
              {clubs.map((club) => (
                <li key={club.slug}>
                  <div>
                    <strong>{club.name}</strong>
                    {club.description ? <span>{club.description}</span> : null}
                  </div>
                  <Link href={`/clubs/${club.slug}`}>View community</Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </section>

      <section
        className="organizations-collaboration"
        aria-labelledby="organizations-collaboration-title"
      >
        <div className="organizations-heading">
          <p className="section-kicker">Collaboration pathways</p>
          <h2 id="organizations-collaboration-title">
            Practical ways to strengthen the work.
          </h2>
          <p>
            Each conversation starts with shared objectives, practical fit,
            and public benefit.
          </p>
        </div>
        <div className="organizations-collaboration__grid">
          {collaborationOptions.map((option, index) => (
            <article key={option.title}>
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <h3>{option.title}</h3>
              <p>{option.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="organizations-conversation"
        aria-labelledby="organizations-conversation-title"
      >
        <div className="organizations-heading">
          <p className="section-kicker">A useful first conversation</p>
          <h2 id="organizations-conversation-title">
            Start with fit before designing the details.
          </h2>
        </div>
        <ol>
          {FIRST_CONVERSATION_TOPICS.map((topic, index) => (
            <li key={topic.title}>
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{topic.title}</h3>
                <p>{topic.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="organizations-standards"
        aria-labelledby="organizations-standards-title"
      >
        <div>
          <p className="section-kicker">Public operating standards</p>
          <h2 id="organizations-standards-title">
            Clear expectations are part of the program.
          </h2>
        </div>
        <div>
          <p>
            Prospective partners can review how the website communicates
            respectful conduct, accessibility, privacy, and current event
            information before beginning a conversation.
          </p>
          <nav aria-label="Public operating standards">
            <Link href="/conduct">Code of Conduct</Link>
            <Link href="/accessibility">Accessibility</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/events">Current public events</Link>
          </nav>
        </div>
      </section>

      <section
        className="organizations-contact"
        aria-labelledby="organizations-contact-title"
      >
        <div>
          <p className="section-kicker">Start a conversation</p>
          <h2 id="organizations-contact-title">
            Tell us what your organization wants to make possible.
          </h2>
          <p>
            Share your organization, objective, audience, and the kind of
            collaboration or support you have in mind.
          </p>
        </div>
        <Link
          className="primary-action"
          href="/contact?topic=partnerships#contact-form"
        >
          Discuss a partnership
        </Link>
      </section>
    </main>
  );
}

async function loadCatalog(): Promise<PublicCatalogDto | null> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    return await getRequestPublicCatalog(database);
  } catch {
    writeSafeLog("error", "public_organizations_page_unavailable", {
      code: "service_unavailable",
      operation: "read_public_catalog",
      route: "/for-organizations",
      status: 503,
    });
    return null;
  }
}

async function loadOrganizationPageData(): Promise<{
  catalog: PublicCatalogDto;
  events: readonly PublicEventCardDto[] | null;
} | null> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const catalog = await getRequestPublicCatalog(database);
    if (!catalog) return null;
    const organization = await getRequestPublicOrganization(database);
    if (!organization) return null;
    const events = await readPublicHomeEventMaterialization(database, {
      maximum: 3,
      nowUtcMs: readServerUtcMs(),
      organizationId: organization.id,
    });
    return Object.freeze({ catalog, events });
  } catch {
    writeSafeLog("error", "public_organizations_page_unavailable", {
      code: "service_unavailable",
      operation: "read_public_catalog_and_activity",
      route: "/for-organizations",
      status: 503,
    });
    return null;
  }
}

function OrganizationActivityCard({
  event,
}: Readonly<{ event: PublicEventCardDto }>) {
  const artworkCredit = event.artwork
    ? discoveryArtworkCredit(event.artwork.credit)
    : null;

  return (
    <article className="organizations-activity-card">
      {event.artwork ? (
        <figure className="organizations-activity-card__artwork">
          <div className="organizations-activity-card__artwork-frame">
            <EventPosterImage
              alt={event.artwork.altText ?? ""}
              decoding="async"
              fallback={
                <EventArtworkFallback
                  className="organizations-activity-card__artwork-frame"
                  lane={event.lane}
                />
              }
              height={event.artwork.dimensions.large.height}
              loading="lazy"
              sizes="(max-width: 42rem) calc(100vw - 2rem), 31vw"
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
          {artworkCredit ? (
            <figcaption>Artwork: {artworkCredit}</figcaption>
          ) : null}
        </figure>
      ) : (
        <EventArtworkFallback
          className="organizations-activity-card__artwork"
          lane={event.lane}
        />
      )}
      <div className="organizations-activity-card__body">
        <p className="section-kicker">{event.club.name}</p>
        <h3>
          <Link href={`/events/${event.slug}`}>{event.title}</Link>
        </h3>
        <time dateTime={eventDateTime(event)}>
          {formatEventSchedule(event).label}
        </time>
      </div>
    </article>
  );
}

function eventDateTime(event: PublicEventCardDto): string {
  return event.schedule.kind === "timed"
    ? event.schedule.startsAtUtc
    : event.schedule.startDate;
}
