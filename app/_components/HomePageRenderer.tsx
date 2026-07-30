import Link from "next/link";
import { EditorialSection, loadEditorialRenderContext } from "./EditorialPage";
import { EventCard } from "./EventCard";
import { FieldArtwork } from "./FieldArtwork";
import { StructuredData } from "./StructuredData";
import type {
  PublicCatalogDto,
  PublicPageDto,
  PublicPageSectionDto,
} from "@/lib/server/public/catalog";
import type { PublicEventCardDto } from "@/lib/server/public/events";
import type { ResponsiveMediaAssetDto } from "@/lib/server/media/usage";
import { publicUrl } from "@/lib/server/public/origin";

export async function HomePageRenderer({
  catalog,
  events,
  origin,
  page,
  previewMediaAssets,
  privatePreview = false,
}: Readonly<{
  catalog: PublicCatalogDto;
  events: readonly PublicEventCardDto[];
  origin: URL | null;
  page: PublicPageDto;
  previewMediaAssets?: readonly ResponsiveMediaAssetDto[];
  privatePreview?: boolean;
}>) {
  const hero =
    page.sections.find(
      (section) => normalizedType(section) === "hero",
    ) ?? page.sections.find((section) => section.key === "hero");
  const sections = page.sections.filter(
    (section) =>
      section !== hero &&
      normalizedType(section) !== "featured-events",
  );
  const renderContext = await loadEditorialRenderContext({
    page,
    previewCommunityLinks: privatePreview
      ? catalog.communityLinks
      : undefined,
    previewMediaAssets,
    privatePreview,
  });
  const hasFeaturedClubs = sections.some(
    (section) => normalizedType(section) === "featured-clubs",
  );
  const hasCommunityLinks = sections.some(
    (section) => normalizedType(section) === "community-links",
  );
  const missingRequiredSections = HOME_REQUIRED_SECTIONS.filter(
    (required) =>
      !sections.some((section) => section.key === required.key),
  );
  const featuredClubs = catalog.clubs
    .filter((club) => club.featured)
    .slice(0, 3);

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
            <Link className="primary-action" href="/calendar">
              View the calendar <span aria-hidden="true">→</span>
            </Link>
            <Link href="/about">What is this club?</Link>
          </div>
        </div>
        <FieldArtwork tone="think" />
      </section>

      <section className="home-events" aria-labelledby="home-events-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Coming up</p>
            <h2 id="home-events-title">The next events</h2>
          </div>
          <Link href="/calendar">Open the full calendar</Link>
        </div>
        {events.length > 0 ? (
          <div className="event-list">
            {events.slice(0, 4).map((event) => (
              <EventCard event={event} key={event.slug} />
            ))}
          </div>
        ) : (
          <div className="public-empty-state">
            <p className="section-kicker">Calendar</p>
            <h3>No upcoming event is published here yet.</h3>
            <p>
              As soon as an event is ready for everyone to see, it will appear
              here and on the calendar.
            </p>
            <Link href="/calendar">Open the calendar</Link>
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

      {!hasFeaturedClubs ? (
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
      ) : null}

      {sections.length > 0 ? (
        <div className="home-cms-sections">
          {sections.map((section) => (
            <HomeSection
              catalog={catalog}
              hasCommunityLinks={hasCommunityLinks}
              key={section.key}
              renderContext={renderContext}
              section={section}
            />
          ))}
        </div>
      ) : null}
      {missingRequiredSections.length > 0 ? (
        <div className="home-cms-sections">
          {missingRequiredSections.map((section) => (
            <HomeSection
              catalog={catalog}
              hasCommunityLinks={hasCommunityLinks}
              key={section.key}
              renderContext={renderContext}
              section={section}
            />
          ))}
        </div>
      ) : null}

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

const HOME_REQUIRED_SECTIONS: readonly PublicPageSectionDto[] = Object.freeze([
  Object.freeze({
    content: Object.freeze({
      heading: "Come curious",
      paragraphs: Object.freeze([
        "Expect a clear reason to gather, room for conversation, and no requirement to arrive as an expert.",
        "Each listing carries the facts we know. When a detail is undecided, we say so.",
      ]),
    }),
    key: "attending",
    type: "prose",
  }),
  Object.freeze({
    content: Object.freeze({
      heading: "Help make the calendar",
      text: "Have an idea, want to host, volunteer, or explore a community partnership? Start with the ways to get involved.",
    }),
    key: "invitation",
    type: "callout",
  }),
  Object.freeze({
    content: Object.freeze({
      heading: "Continue on the confirmed group pages",
      text: "This site lists only confirmed public community destinations.",
    }),
    key: "community",
    type: "prose",
  }),
]);

function HomeSection({
  catalog,
  hasCommunityLinks,
  renderContext,
  section,
}: Readonly<{
  catalog: PublicCatalogDto;
  hasCommunityLinks: boolean;
  renderContext: Awaited<ReturnType<typeof loadEditorialRenderContext>>;
  section: PublicPageSectionDto;
}>) {
  if (section.key === "attending") {
    return (
      <section className="attending-note" aria-labelledby="attending-title">
        <div>
          <p className="section-kicker">What attending feels like</p>
          <h2 id="attending-title">
            {section.content.heading ?? "Come with a question."}
          </h2>
        </div>
        <div>
          {section.content.text ? <p>{section.content.text}</p> : null}
          {section.content.paragraphs?.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </section>
    );
  }
  if (section.key === "invitation") {
    return (
      <section className="home-invitation" aria-labelledby="invitation-title">
        <div>
          <p className="section-kicker">Make the calendar with us</p>
          <h2 id="invitation-title">
            {section.content.heading ?? "Bring something to the club."}
          </h2>
          {section.content.text ? <p>{section.content.text}</p> : null}
        </div>
        <div className="home-invitation__actions">
          <Link href="/get-involved">Volunteer, host, or partner</Link>
          <Link href="/community">Find the community</Link>
          <Link href="/organizer">Organizer Login</Link>
        </div>
      </section>
    );
  }
  if (section.key === "community") {
    return (
      <section className="home-community" aria-labelledby="community-title">
        <div>
          <p className="section-kicker">Community</p>
          <h2 id="community-title">
            {section.content.heading ?? "Confirmed group destinations"}
          </h2>
          {section.content.text ? <p>{section.content.text}</p> : null}
        </div>
        {!hasCommunityLinks ? (
          <ul>
            {catalog.communityLinks.map((link) => (
              <li key={link.url}>
                <a href={link.url} rel="noreferrer noopener">
                  {link.label} <span aria-hidden="true">↗</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }
  return (
    <EditorialSection renderContext={renderContext} section={section} />
  );
}

function normalizedType(section: PublicPageSectionDto) {
  return section.type.replaceAll("_", "-");
}

function laneTone(slug: string) {
  if (slug === "reset-and-make") return "reset-make" as const;
  if (slug === "explore") return "explore" as const;
  if (slug === "eat-and-play") return "eat-play" as const;
  return "think" as const;
}
