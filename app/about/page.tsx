/* eslint-disable @next/next/no-css-tags -- About owns a bounded stylesheet that must not inflate other public routes. */
import { notFound } from "next/navigation";
import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import {
  buildEditorialMetadata,
  EditorialUnavailable,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";
import { PUBLIC_ABOUT_MISSION_COPY } from "@/lib/public-mission-copy";
import { PUBLIC_CATALOG_LANES } from "@/lib/server/public/catalog-definitions";

const route = "/about";
const slug = "about";

const ABOUT_POSTERS = Object.freeze([
  Object.freeze({
    alt: "Finding Your People — Beach Sunset and Walk event poster.",
    caption: "Outdoor connection",
    file: "meetup-315723559",
    height: 470,
    mediumWidth: 836,
    width: 836,
  }),
  Object.freeze({
    alt: "The Bet — Can reading actually transform a person? event poster.",
    caption: "Literature and discussion",
    file: "meetup-315823022",
    height: 540,
    mediumWidth: 960,
    width: 960,
  }),
  Object.freeze({
    alt: "Settlers of Catan board game night event poster.",
    caption: "Play and shared experience",
    file: "meetup-315560589",
    height: 540,
    mediumWidth: 960,
    width: 960,
  }),
]);

const COMMUNITY_PROGRAMS = Object.freeze([
  Object.freeze({
    description:
      "Broad, interest-led gatherings across ideas, creativity, city life, food, play, and shared experience.",
    href: "/clubs/vancouver-curiosity-club",
    name: "Vancouver Curiosity Club",
  }),
  Object.freeze({
    description:
      "Reading, watching, and discussing literature and film together.",
    href: "/clubs/vancouver-literature-and-film",
    name: "Vancouver Literature and Film",
  }),
  Object.freeze({
    description:
      "Conversations and events around fantasy and science fiction.",
    href: "/clubs/vancouver-fantasy-scifi-group",
    name: "Vancouver Fantasy & Sci-Fi Group",
  }),
]);

const BOARD_DIRECTORS = Object.freeze([
  Object.freeze({
    emoji: "🧭",
    name: "Reza Rahnama",
    role: "Founder, President and Executive Director",
  }),
  Object.freeze({
    emoji: "🤝",
    name: "Nawar Alsaadi",
    role: "Vice-President and Treasurer; Strategy and Partnerships",
  }),
  Object.freeze({
    emoji: "💬",
    name: "Nataliia Ivanova",
    role: "Digital Experience and Communications",
  }),
  Object.freeze({
    emoji: "💻",
    name: "Anurag Kapale",
    role: "Director-at-Large; Technology, AI and Data",
  }),
]);

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
    descriptionOverride: PUBLIC_ABOUT_MISSION_COPY.metadataDescription,
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

  return (
    <main className="about-page" data-page-slug={loaded.page.slug}>
      <link rel="stylesheet" href="/styles/about.css" precedence="about" />
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { label: loaded.page.title },
        ]}
      />

      <header className="about-hero" aria-labelledby="about-title">
        <div className="about-hero__content">
          <h1 id="about-title">{PUBLIC_ABOUT_MISSION_COPY.heading}</h1>
          <div className="about-hero__introduction">
            {PUBLIC_ABOUT_MISSION_COPY.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <div className="about-actions">
              <Link className="primary-action" href="/for-organizations">
                For organizations
              </Link>
              <Link href="/events">View public events</Link>
            </div>
          </div>
        </div>
      </header>

      <section className="about-board" aria-labelledby="about-board-title">
        <div className="about-section-heading">
          <h2 id="about-board-title">Board of Directors</h2>
        </div>
        <ul className="about-board__list">
          {BOARD_DIRECTORS.map((director) => (
            <li key={director.name}>
              <span className="about-board__badge" aria-hidden="true">
                {director.emoji}
              </span>
              <div className="about-board__member">
                <h3>{director.name}</h3>
                <p>{director.role}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="about-model" aria-labelledby="about-model-title">
        <div className="about-section-heading">
          <h2 id="about-model-title">Structure creates room for belonging.</h2>
        </div>
        <ul className="about-model__steps">
          <li>
            <h3>Curiosity provides a focus</h3>
            <p>
              A shared subject or activity gives people a natural reason to
              arrive and something genuine to talk about.
            </p>
          </li>
          <li>
            <h3>Preparation builds trust</h3>
            <p>
              Clear event information, participation expectations, and a code
              of conduct help people know what kind of room they are entering.
            </p>
          </li>
          <li>
            <h3>Recurrence supports continuity</h3>
            <p>
              Multiple programs and a dependable public calendar give people
              more than one way—and more than one moment—to take part.
            </p>
          </li>
        </ul>
        <div className="about-program-streams">
          <h3>What we organize</h3>
          <ul>
            {PUBLIC_CATALOG_LANES.map((lane) => (
              <li key={lane.slug}>
                <strong>{lane.name}</strong>
                <span>{lane.description}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="about-evidence" aria-labelledby="about-evidence-title">
        <div className="about-evidence__copy">
          <div>
            <h2 id="about-evidence-title">
              Different interests. A consistent invitation to participate.
            </h2>
          </div>
          <p>
            The program is designed to offer a lower-pressure first step into
            local community, create conversation that can move beyond small
            talk, and provide recurring opportunities to contribute. Partners
            can see the work through our public program pages, calendar, and
            event materials.
          </p>
        </div>
        <div className="about-evidence__gallery" aria-label="Selected event posters">
          {ABOUT_POSTERS.map((poster) => (
            <figure key={poster.file}>
              <picture>
                <source
                  srcSet={`/event-posters/${poster.file}-480.avif 480w, /event-posters/${poster.file}-960.avif ${poster.mediumWidth}w`}
                  type="image/avif"
                />
                <source
                  srcSet={`/event-posters/${poster.file}-480.webp 480w, /event-posters/${poster.file}-960.webp ${poster.mediumWidth}w`}
                  type="image/webp"
                />
                <img
                  alt={poster.alt}
                  decoding="async"
                  height={poster.height}
                  loading="lazy"
                  sizes="(max-width: 44rem) calc(100vw - 2rem), 31vw"
                  src={`/event-posters/${poster.file}-960.jpeg`}
                  srcSet={`/event-posters/${poster.file}-480.jpeg 480w, /event-posters/${poster.file}-960.jpeg ${poster.mediumWidth}w`}
                  width={poster.width}
                />
              </picture>
              <figcaption>{poster.caption}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="about-communities" aria-labelledby="about-communities-title">
        <div className="about-section-heading">
          <h2 id="about-communities-title">Several doors into the same mission.</h2>
        </div>
        <div className="about-communities__grid">
          {COMMUNITY_PROGRAMS.map((program) => (
            <article key={program.href}>
              <h3>
                <Link href={program.href}>{program.name}</Link>
              </h3>
              <p>{program.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="about-standards" aria-labelledby="about-standards-title">
        <div className="about-section-heading">
          <h2 id="about-standards-title">Clear expectations support good participation.</h2>
        </div>
        <div className="about-standards__body">
          <p>
            Our public policies explain how we approach respectful conduct,
            accessibility, and information shared through this website.
          </p>
          <ul>
            <li><Link href="/conduct">Code of Conduct</Link></li>
            <li><Link href="/privacy">Privacy</Link></li>
          </ul>
        </div>
      </section>

      <section className="about-closing" aria-labelledby="about-closing-title">
        <div>
          <h2 id="about-closing-title">
            Help create the conditions for connection.
          </h2>
        </div>
        <div>
          <p>
            We welcome conversations with community organizations, venues,
            educators, funders, and mission-aligned companies about space,
            materials, outreach, facilitation, and financial support.
          </p>
          <div className="about-actions about-closing__actions">
            <Link className="primary-action" href="/for-organizations">
              Explore organizational collaboration
            </Link>
            <Link href="/contact?topic=partnerships#contact-form">
              Start a conversation
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
