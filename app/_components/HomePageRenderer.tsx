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
          <p className="home-hero__public-note">
            Browse the calendar, then use the official signup link shown for
            each event. The website does not create visitor accounts.
          </p>
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

      {catalog.communityLinks.length > 0 ? (
        <section
          aria-labelledby="home-community-title"
          className="home-community home-community-links"
        >
          <div>
            <p className="section-kicker">Official destinations</p>
            <h2 id="home-community-title">Follow the club elsewhere</h2>
            <p>
              Event signup stays on the official platform listed for that
              event. These are the club&apos;s confirmed public pages.
            </p>
          </div>
          <ul>
            {catalog.communityLinks.slice(0, 6).map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {link.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sections.length > 0 ? (
        <div className="home-cms-sections">
          {sections.map((section) => (
            <HomeSection
              catalog={catalog}
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

function HomeSection({
  catalog,
  renderContext,
  section,
}: Readonly<{
  catalog: PublicCatalogDto;
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
        {catalog.communityLinks.length === 0 ? (
          <p>No confirmed public community destination is listed yet.</p>
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
