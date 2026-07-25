import Link from "next/link";
import { EventCard } from "@/app/_components/EventCard";
import { FieldArtwork } from "@/app/_components/FieldArtwork";
import { StructuredData } from "@/app/_components/StructuredData";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import {
  getPublicPageContent,
  loadPublicCatalog,
  resolvePublicOrganization,
  type PublicCatalogDto,
  type PublicPageDto,
} from "@/lib/server/public/catalog";
import { vancouverCalendarDate } from "@/lib/server/public/date";
import {
  queryPublicEvents,
  type PublicEventCardDto,
} from "@/lib/server/public/events";
import {
  getTrustedRequestOrigin,
  publicUrl,
} from "@/lib/server/public/origin";
import { publicServiceUnavailable } from "@/lib/server/public/service-failure";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const loaded = await loadHome();
  if (!loaded) {
    return (
      <main className="public-page home-page">
        <section className="public-service-state" aria-labelledby="home-state">
          <p className="section-kicker">Vancouver Curiosity Club</p>
          <h1 id="home-state">The public catalog is not available yet.</h1>
          <p>
            No events, people, legal details, or community claims are being
            invented to fill this review state.
          </p>
          <Link href="/events">Open the event calendar</Link>
        </section>
      </main>
    );
  }

  const { catalog, events, page } = loaded;
  const hero = section(page, "hero");
  const attending = section(page, "attending");
  const invitation = section(page, "invitation");
  const community = section(page, "community");
  const featuredClubs = catalog.clubs
    .filter((club) => club.featured)
    .slice(0, 3);
  const origin = await getTrustedRequestOrigin();

  return (
    <main className="home-page">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__copy">
          <p className="eyebrow">
            {hero?.content.eyebrow ?? catalog.site.locationLabel}
          </p>
          <h1 id="home-title">
            {hero?.content.heading ?? catalog.site.brandName}
          </h1>
          <p className="home-hero__tagline">{catalog.site.tagline}</p>
          {hero?.content.text ? (
            <p className="home-hero__deck">{hero.content.text}</p>
          ) : null}
          <div className="home-hero__actions">
            <Link className="primary-action" href="/events">
              Explore Upcoming Events <span aria-hidden="true">→</span>
            </Link>
            <Link href="/clubs">Meet the clubs</Link>
          </div>
        </div>
        <FieldArtwork tone="think" />
      </section>

      <section className="home-events" aria-labelledby="home-events-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">The next field notes</p>
            <h2 id="home-events-title">Upcoming published events</h2>
          </div>
          <Link href="/events">Full calendar</Link>
        </div>
        {events.length > 0 ? (
          <div className="event-list">
            {events.map((event) => (
              <EventCard event={event} key={event.slug} />
            ))}
          </div>
        ) : (
          <div className="public-empty-state">
            <p className="section-kicker">Nothing fabricated</p>
            <h3>No upcoming event is published here yet.</h3>
            <p>
              When a real event reaches the completed public calendar, it will
              appear in this space.
            </p>
            <Link href="/events">Check the calendar state</Link>
          </div>
        )}
      </section>

      <section className="lane-index" aria-labelledby="lane-index-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Four ways to follow curiosity</p>
            <h2 id="lane-index-title">The event lanes</h2>
          </div>
        </div>
        <div className="lane-index__grid">
          {catalog.lanes.map((lane, index) => (
            <article className="lane-note" key={lane.slug}>
              <div>
                <span aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <FieldArtwork tone={laneTone(lane.slug)} />
              </div>
              <h3>{lane.name}</h3>
              {lane.description ? <p>{lane.description}</p> : null}
              <Link href={`/events?lane=${lane.slug}`}>
                Explore {lane.name} events
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="home-clubs" aria-labelledby="home-clubs-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">The public program shelf</p>
            <h2 id="home-clubs-title">Featured clubs</h2>
          </div>
          <Link href="/clubs">All public clubs</Link>
        </div>
        <div className="home-clubs__grid">
          {featuredClubs.map((club) => (
            <article key={club.slug}>
              <p>{club.lane.name}</p>
              <h3>
                <Link href={`/clubs/${club.slug}`}>{club.name}</Link>
              </h3>
              {club.description ? <p>{club.description}</p> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="attending-note" aria-labelledby="attending-title">
        <div>
          <p className="section-kicker">What attending feels like</p>
          <h2 id="attending-title">
            {attending?.content.heading ?? "Come with a question."}
          </h2>
        </div>
        <div>
          {attending?.content.text ? <p>{attending.content.text}</p> : null}
          {attending?.content.paragraphs?.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </section>

      <section className="home-invitation" aria-labelledby="invitation-title">
        <div>
          <p className="section-kicker">Make the calendar with us</p>
          <h2 id="invitation-title">
            {invitation?.content.heading ?? "Bring something to the club."}
          </h2>
          {invitation?.content.text ? <p>{invitation.content.text}</p> : null}
        </div>
        <div className="home-invitation__actions">
          <Link href="/get-involved">Volunteer, host, or partner</Link>
          <Link href="/community">Find the community</Link>
          <Link href="/organizer">Organizer Login</Link>
        </div>
      </section>

      <section className="home-community" aria-labelledby="community-title">
        <div>
          <p className="section-kicker">Community</p>
          <h2 id="community-title">
            {community?.content.heading ?? "Confirmed group destinations"}
          </h2>
          {community?.content.text ? <p>{community.content.text}</p> : null}
        </div>
        <ul>
          {catalog.communityLinks.map((link) => (
            <li key={link.url}>
              <a href={link.url} rel="noreferrer noopener">
                {link.label} <span aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      {origin ? (
        <StructuredData
          value={{
            "@context": "https://schema.org",
            "@type": "Organization",
            name: catalog.site.brandName,
            url: publicUrl("/", origin),
            areaServed: {
              "@type": "City",
              name: "Vancouver",
            },
            sameAs: catalog.communityLinks.map((link) => link.url),
          }}
        />
      ) : null}
    </main>
  );
}

async function loadHome(): Promise<{
  catalog: PublicCatalogDto;
  events: readonly PublicEventCardDto[];
  page: PublicPageDto;
} | null> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) return null;
    const nowUtcMs = readServerUtcMs();
    const [catalog, page, eventPage] = await Promise.all([
      loadPublicCatalog(database),
      getPublicPageContent(database, "home"),
      queryPublicEvents(database, {
        organizationId: organization.id,
        nowUtcMs,
        todayDate: vancouverCalendarDate(nowUtcMs),
        view: "upcoming",
        page: 1,
        pageSize: 6,
      }),
    ]);
    return catalog && page
      ? { catalog, page, events: eventPage.events }
      : null;
  } catch {
    writeSafeLog("error", "public_home_unavailable", {
      code: "service_unavailable",
      operation: "load_public_home",
      route: "/",
      status: 503,
    });
    publicServiceUnavailable();
  }
}

function section(page: PublicPageDto, key: string) {
  return page.sections.find((item) => item.key === key);
}

function laneTone(slug: string) {
  if (slug === "reset-and-make") return "reset-make" as const;
  if (slug === "explore") return "explore" as const;
  if (slug === "eat-and-play") return "eat-play" as const;
  return "think" as const;
}
