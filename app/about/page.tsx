import { notFound } from "next/navigation";
import Link from "next/link";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import {
  buildEditorialMetadata,
  EditorialUnavailable,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";
import { EventCard } from "@/app/_components/EventCard";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import {
  loadPublicCatalog,
  resolvePublicOrganization,
  type PublicCatalogDto,
} from "@/lib/server/public/catalog";
import { vancouverCalendarDate } from "@/lib/server/public/date";
import {
  queryPublicEvents,
  type PublicEventCardDto,
} from "@/lib/server/public/events";
import { writeSafeLog } from "@/lib/validation/server-observability";

const route = "/about";
const slug = "about";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
    fallbackTitle: "About",
    path: route,
    route,
    slug,
  });
}

export default async function AboutPage() {
  const loaded = await loadEditorialPage(slug, route);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="About" />;
  }

  const about = await loadAboutData();
  if (about.kind === "unavailable") {
    return <EditorialUnavailable title="About" />;
  }

  const publicClubs = about.catalog.clubs.filter((club) => !club.archived);
  const eventSliceLabel = nextEventSliceLabel(about.events.length);

  return (
    <main className="about-page" data-page-slug={loaded.page.slug}>
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { label: loaded.page.title },
        ]}
      />

      <header className="about-hero" aria-labelledby="about-title">
        <p className="section-kicker">About the club</p>
        <h1 id="about-title">Curiosity is better in company.</h1>
        <p>
          Vancouver Curiosity Club brings people together through books,
          films, ideas, city walks, creative practice, food, and play. Each
          gathering gives an interesting conversation somewhere to begin.
        </p>
      </header>

      <section className="about-feel" aria-labelledby="about-feel-title">
        <div>
          <p className="section-kicker">What the community feels like</p>
          <h2 id="about-feel-title">
            Thoughtful without being formal. Social without small-talk
            pressure.
          </h2>
        </div>
        <p>
          People follow a question together, make room for different
          perspectives, and let conversation turn into connection. Expertise
          is welcome, but it is never the price of entry.
        </p>
      </section>

      <section className="about-audience" aria-labelledby="about-audience-title">
        <div>
          <p className="section-kicker">Who it is for</p>
          <h2 id="about-audience-title">People who want to stay curious.</h2>
        </div>
        <ul>
          <li>Readers, film lovers, makers, walkers, and big-question people</li>
          <li>Newcomers looking for a gentle way into Vancouver community</li>
          <li>Anyone who misses conversations that go somewhere</li>
        </ul>
      </section>

      <section className="about-solo" aria-labelledby="about-solo-title">
        <div>
          <p className="section-kicker">Coming on your own</p>
          <h2 id="about-solo-title">Your first event can be simple.</h2>
        </div>
        <p>
          Pick the gathering that genuinely interests you and show up as you
          are. You do not need to know anyone already, bring a friend, or have
          the cleverest answer in the room.
        </p>
      </section>

      <section
        className="about-founder-note"
        aria-labelledby="about-founder-note-title"
      >
        <div>
          <p className="section-kicker">A note from Reza</p>
          <h2 id="about-founder-note-title">Curiosity is enough to begin.</h2>
        </div>
        <blockquote>
          <p>
            “I want this to be a place where you can follow a real interest
            without needing to impress anyone. Choose an event that pulls you
            in, come as you are, and we’ll take it from there.”
          </p>
          <cite>Reza</cite>
        </blockquote>
      </section>

      <section className="about-facts" aria-labelledby="about-facts-title">
        <div>
          <p className="section-kicker">Published now</p>
          <h2 id="about-facts-title">The community in the live catalog.</h2>
        </div>
        <dl>
          <div>
            <dt>Activity lanes</dt>
            <dd>{about.catalog.lanes.length}</dd>
          </div>
          <div>
            <dt>Public clubs</dt>
            <dd>{publicClubs.length}</dd>
          </div>
          <div>
            <dt>Upcoming published gatherings</dt>
            <dd>{about.upcomingEventCount}</dd>
          </div>
        </dl>
      </section>

      <section className="about-events" aria-labelledby="about-events-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">{eventSliceLabel}</p>
            <h2 id="about-events-title">See what the club is doing next.</h2>
          </div>
        </div>
        {about.events.length > 0 ? (
          <div className="event-list">
            {about.events.map((event, index) => (
              <EventCard event={event} key={event.slug} priority={index === 0} />
            ))}
          </div>
        ) : (
          <div className="public-empty-state">
            <h3>No upcoming gathering is published yet.</h3>
            <p>The live events page will show new listings when they publish.</p>
          </div>
        )}
      </section>

      <section className="about-closing" aria-labelledby="about-closing-title">
        <div>
          <p className="section-kicker">Come to the next one</p>
          <h2 id="about-closing-title">Follow the question that catches you.</h2>
        </div>
        <Link className="primary-action" href="/events">
          See upcoming gatherings
        </Link>
      </section>
    </main>
  );
}

type AboutDataState =
  | Readonly<{
      catalog: PublicCatalogDto;
      events: readonly PublicEventCardDto[];
      kind: "available";
      upcomingEventCount: number;
    }>
  | Readonly<{ kind: "unavailable" }>;

async function loadAboutData(): Promise<AboutDataState> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) {
      return Object.freeze({ kind: "unavailable" as const });
    }

    // loadPublicCatalog bounds its catalog fan-out. The event projection then
    // runs after that batch, keeping the About route below D1's concurrency
    // ceiling while every fact remains tied to the published catalog.
    const catalog = await loadPublicCatalog(database);
    if (!catalog) {
      return Object.freeze({ kind: "unavailable" as const });
    }

    const nowUtcMs = readServerUtcMs();
    const eventPage = await queryPublicEvents(database, {
      organizationId: organization.id,
      nowUtcMs,
      todayDate: vancouverCalendarDate(nowUtcMs),
      view: "upcoming",
      page: 1,
      pageSize: 3,
    });

    return Object.freeze({
      catalog,
      events: eventPage.events,
      kind: "available" as const,
      upcomingEventCount: eventPage.totalCount,
    });
  } catch {
    writeSafeLog("error", "public_about_unavailable", {
      code: "service_unavailable",
      operation: "load_public_about",
      route,
      status: 503,
    });
    return Object.freeze({ kind: "unavailable" as const });
  }
}

function nextEventSliceLabel(count: number): string {
  if (count === 3) return "The next three published gatherings";
  if (count === 1) return "The next published gathering";
  if (count === 0) return "No upcoming gathering is currently published";
  return `The next ${count} published gatherings`;
}
