import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import type { CSSProperties } from "react";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import { ClubEventList } from "@/app/_components/ClubEventList";
import {
  clubArtworkTone,
  type ClubDetailEventsState,
} from "@/app/_components/ClubDetailRenderer";
import { PageMasthead } from "@/app/_components/PageMasthead";
import { StructuredData } from "@/app/_components/StructuredData";
import {
  focalPointObjectPosition,
  responsiveImageSrcSet,
} from "@/lib/media/presentation";
import type { ResponsiveMediaAssetDto } from "@/lib/server/media/usage";
import type { PublicProgramDto } from "@/lib/server/public/catalog";
import { publicUrl } from "@/lib/server/public/origin";

export function ProgramDetailRenderer({
  coverMedia,
  events,
  origin = null,
  program,
}: Readonly<{
  coverMedia: ResponsiveMediaAssetDto | null;
  events: ClubDetailEventsState;
  origin?: URL | null;
  program: PublicProgramDto;
}>) {
  const programPath = `/clubs/${program.parentClub.slug}/programs/${program.slug}`;
  return (
    <main
      className="club-detail program-detail"
      style={
        program.themeColor
          ? ({ "--club-theme": program.themeColor } as CSSProperties)
          : undefined
      }
    >
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { href: "/clubs", label: "Clubs" },
          {
            href: `/clubs/${program.parentClub.slug}`,
            label: program.parentClub.name,
          },
          { label: program.name },
        ]}
      />
      <PageMasthead
        deck={program.description ?? "A recurring Program."}
        eyebrow={`${program.parentClub.name} · ${program.lane.name}`}
        title={program.name}
        tone={clubArtworkTone(program.lane.slug)}
      />
      {program.archived ? (
        <section className="notice-card" aria-labelledby="program-archive">
          <p className="section-kicker">Program archive</p>
          <h2 id="program-archive">
            This Program is preserved for historical reference.
          </h2>
          <p>
            It is no longer active or accepting future event scheduling.
            Eligible completed events remain available below in Past.
          </p>
        </section>
      ) : null}
      {coverMedia ? (
        <figure className="club-detail__cover">
          <picture>
            <source
              sizes="(max-width: 42rem) 100vw, (max-width: 75rem) 86vw, 68rem"
              srcSet={responsiveSrcSet(coverMedia)}
              type="image/webp"
            />
            <img
              alt={coverMedia.altText ?? ""}
              height={coverMedia.variants.webp1600.height}
              sizes="(max-width: 42rem) 100vw, (max-width: 75rem) 86vw, 68rem"
              src={coverMedia.variants.webp1600.url}
              srcSet={responsiveSrcSet(coverMedia)}
              style={{
                objectPosition: focalPointObjectPosition(
                  coverMedia.focalPoint,
                ),
              }}
              width={coverMedia.variants.webp1600.width}
            />
          </picture>
          <figcaption>Credit: {coverMedia.credit}</figcaption>
        </figure>
      ) : null}
      {program.fullDescription ||
      program.participantExpectations ||
      program.typicalFormat ||
      program.preparationInformation ? (
        <section
          className="club-detail__profile"
          aria-labelledby="program-profile"
        >
          <div>
            <p className="section-kicker">{typeLabel(program.programType)}</p>
            <h2 id="program-profile">What to expect</h2>
            {program.fullDescription ? <p>{program.fullDescription}</p> : null}
          </div>
          <dl>
            {program.participantExpectations ? (
              <div>
                <dt>Participants can expect</dt>
                <dd>{program.participantExpectations}</dd>
              </div>
            ) : null}
            {program.typicalFormat ? (
              <div>
                <dt>Typical format</dt>
                <dd>{program.typicalFormat}</dd>
              </div>
            ) : null}
            {program.preparationInformation ? (
              <div>
                <dt>Preparation</dt>
                <dd>{program.preparationInformation}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}
      {program.publicGroupUrl ? (
        <section
          className="club-detail__destination"
          aria-labelledby="program-destination"
        >
          <div>
            <p className="section-kicker">Confirmed destination</p>
            <h2 id="program-destination">Continue on Meetup</h2>
            <p>
              This link opens the Program&apos;s confirmed public Meetup group.
            </p>
          </div>
          <a
            href={program.publicGroupUrl}
            rel="noreferrer noopener"
            target="_blank"
          >
            Open {program.name} on Meetup
            <span aria-hidden="true"> ↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </section>
      ) : null}
      {program.socialLinks.length > 0 ||
      program.relatedResources.length > 0 ? (
        <section
          className="club-detail__links"
          aria-labelledby="program-links"
        >
          <div>
            <p className="section-kicker">Confirmed links</p>
            <h2 id="program-links">Continue exploring</h2>
          </div>
          <ul>
            {[...program.socialLinks, ...program.relatedResources].map(
              (link) => (
                <li key={`${link.label}-${link.url}`}>
                  {link.url.startsWith("/") ? (
                    <Link href={link.url}>{link.label}</Link>
                  ) : (
                    <a
                      href={link.url}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      {link.label}
                      <span aria-hidden="true"> ↗</span>
                    </a>
                  )}
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}
      {events.kind === "available" ? (
        <div className="club-detail__events">
          <ClubEventList
            emptyCopy="No upcoming events are listed for this Program."
            events={events.upcoming.events}
            heading="Upcoming"
            id="program-upcoming"
          />
          <ClubEventList
            emptyCopy="No past events are listed for this Program."
            events={events.past.events}
            heading="Past"
            id="program-past"
          />
        </div>
      ) : (
        <section className="public-service-state" aria-live="polite">
          <p className="section-kicker">Program calendar</p>
          <h2>Program events are temporarily unavailable.</h2>
          <p>No substitute event facts are being shown.</p>
        </section>
      )}
      {origin ? (
        <StructuredData
          value={{
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: publicUrl("/", origin),
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "Clubs",
                item: publicUrl("/clubs", origin),
              },
              {
                "@type": "ListItem",
                position: 3,
                name: program.parentClub.name,
                item: publicUrl(`/clubs/${program.parentClub.slug}`, origin),
              },
              {
                "@type": "ListItem",
                position: 4,
                name: program.name,
                item: publicUrl(programPath, origin),
              },
            ],
          }}
        />
      ) : null}
    </main>
  );
}

function responsiveSrcSet(media: ResponsiveMediaAssetDto): string {
  return responsiveImageSrcSet([
    media.variants.webp480,
    media.variants.webp960,
    media.variants.webp1600,
  ]);
}

function typeLabel(value: PublicProgramDto["programType"]): string {
  if (value === "circle") return "Recurring circle";
  if (value === "series") return "Recurring series";
  if (value === "other") return "Recurring activity";
  return "Recurring Program";
}
