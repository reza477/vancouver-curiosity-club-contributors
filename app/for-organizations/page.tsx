/* eslint-disable @next/next/no-css-tags -- This route owns a bounded stylesheet that must not inflate Home. */
import type { Metadata } from "next";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import {
  EventArtworkFallback,
  formatEventSchedule,
} from "@/app/_components/EventCard";
import { EventPosterImage } from "@/app/_components/EventPosterImage";
import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import {
  discoveryArtworkCredit,
  responsiveImageSrcSet,
} from "@/lib/media/presentation";
import { selectCanonicalPublicCommunities } from "@/lib/public-community-order";
import { institutionalEventTitle } from "@/lib/public-event-display-title";
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
    body: "Help make suitable gathering spaces available for talks, workshops, discussions, and activities.",
    title: "Venue and space partnerships",
  }),
  Object.freeze({
    body: "Develop a public learning or cultural event around a subject or experience that fits both organizations.",
    title: "Co-presented learning and culture",
  }),
  Object.freeze({
    body: "Support confirmed program needs through funding, sponsorship, materials, services, or other practical resources.",
    title: "Funding and in-kind support",
  }),
  Object.freeze({
    body: "Connect relevant audiences, expertise, facilitators, collections, or learning opportunities with the public.",
    title: "Outreach, expertise, and referrals",
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
  const featuredEvent =
    events?.find((event) => event.artwork !== null) ?? events?.[0] ?? null;

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
      <header
        className="page-masthead page-masthead--compact organizations-hero"
        aria-labelledby="organizations-title"
      >
        <div className="page-masthead__copy organizations-hero__copy">
          <div className="organizations-hero__heading">
            <h1 id="organizations-title">
              Build thoughtful public programs with us
            </h1>
          </div>
          <div className="organizations-hero__introduction">
            <p className="page-masthead__deck">
              Vancouver Curiosity Club creates recurring gatherings across
              learning, culture, creativity, and shared experience. We welcome
              organizations that can strengthen access, space, expertise,
              outreach, or sustainable program support.
            </p>
            <div className="organizations-hero__actions">
              <Link
                className="primary-action"
                href="/contact?topic=partnerships#contact-form"
              >
                Discuss a partnership
              </Link>
              <Link href="/events">View public events</Link>
            </div>
          </div>
        </div>

        <aside
          className="organizations-hero__proof"
          aria-labelledby="organizations-proof-title"
          data-artwork-reveal="organization-hero-artwork"
        >
          <div className="organizations-hero__proof-heading">
            <h2 id="organizations-proof-title">
              {featuredEvent
                ? "See a current public program."
                : "Review the public program structure."}
            </h2>
          </div>
          {featuredEvent ? (
            <OrganizationActivityCard event={featuredEvent} prominent />
          ) : (
            <div className="organizations-hero__proof-empty" aria-live="polite">
              <p>
                {events === null
                  ? "Current event details are temporarily unavailable."
                  : "The next confirmed public listing is being prepared."}
              </p>
              <Link href="/events">View the public event calendar</Link>
            </div>
          )}
        </aside>
      </header>

      <ul
        className="organizations-hero__facts"
        aria-label="Public program scope"
      >
        <li>
          <strong>{lanes.length}</strong>
          <span>Program streams</span>
        </li>
        <li>
          <strong>{clubs.length}</strong>
          <span>Public communities</span>
        </li>
        <li>
          <Link href="/events">Open the current calendar</Link>
        </li>
      </ul>

      <section
        className="organizations-collaboration"
        aria-labelledby="organizations-collaboration-title"
      >
        <div className="organizations-heading">
          <h2 id="organizations-collaboration-title">
            Practical ways to strengthen the work.
          </h2>
          <p>
            Each conversation starts with shared objectives, practical fit,
            and public benefit.
          </p>
          <p>
            In a first message, include the audience and format, the practical
            contribution you have in mind, timing, and any accessibility needs.
          </p>
        </div>
        <div className="organizations-collaboration__grid">
          {collaborationOptions.map((option) => (
            <article key={option.title}>
              <h3>{option.title}</h3>
              <p>{option.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="organizations-standards"
        aria-labelledby="organizations-standards-title"
      >
        <div>
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
            <Link href="/privacy">Privacy</Link>
            <Link href="/about">Mission and operating model</Link>
          </nav>
        </div>
      </section>

      <section
        className="organizations-contact"
        aria-labelledby="organizations-contact-title"
      >
        <div>
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
      maximum: 1,
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
  prominent = false,
}: Readonly<{ event: PublicEventCardDto; prominent?: boolean }>) {
  const displayTitle = institutionalEventTitle(event);
  const artworkCredit = event.artwork
    ? discoveryArtworkCredit(event.artwork.credit)
    : null;

  return (
    <article
      className={`organizations-activity-card${prominent ? " organizations-activity-card--featured" : ""}`}
    >
      {event.artwork ? (
        <figure className="organizations-activity-card__artwork">
          <div className="organizations-activity-card__artwork-frame">
            <span
              className="organizations-activity-card__preview"
              aria-hidden="true"
            >
              <span>{event.club.name}</span>
              <strong>{displayTitle}</strong>
            </span>
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
              fetchPriority={prominent ? "high" : undefined}
              loading={prominent ? "eager" : "lazy"}
              sizes={
                prominent
                  ? "(max-width: 52rem) calc(100vw - 2rem), 42vw"
                  : "(max-width: 42rem) calc(100vw - 2rem), 46vw"
              }
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
          <Link href={`/events/${event.slug}`}>{displayTitle}</Link>
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
