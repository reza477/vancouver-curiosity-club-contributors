import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import { AddToCalendar } from "@/app/_components/AddToCalendar";
import { EventPosterImage } from "@/app/_components/EventPosterImage";
import {
  EventArtworkFallback,
  EventTitleText,
  formatEventSchedule,
} from "@/app/_components/EventCard";
import { ShareControls } from "@/app/_components/ShareControls";
import {
  meetupDescriptionBlocksForDisplay,
  type CuratedMeetupDescriptionInline,
} from "@/lib/meetup-event-enrichment";
import { responsiveImageSrcSet } from "@/lib/media/presentation";
import {
  publicEventAvailabilityLabel,
  publicEventCapacityLabel,
  publicEventLocationParts,
} from "@/lib/public-event-facts";
import type { PublicEventDetailDto } from "@/lib/server/public/events";

export function PublicEventDetailRenderer({
  canonicalUrl,
  event,
  showCalendarDownload = true,
  showShareControls = true,
}: Readonly<{
  canonicalUrl: string | null;
  event: PublicEventDetailDto;
  showCalendarDownload?: boolean;
  showShareControls?: boolean;
}>) {
  const schedule = formatEventSchedule(event);
  const locationParts = publicEventLocationParts(event);
  const availability = publicEventAvailabilityLabel(event);
  const capacity = publicEventCapacityLabel(event);
  const hasPlanningDetails =
    event.status === "tentative" ||
    availability !== null ||
    event.costText !== null ||
    capacity !== null ||
    event.agePolicyText !== null;

  return (
    <>
      {event.isCancelled ? (
        <aside className="cancellation-banner" role="status">
          <strong>Cancelled</strong>
          <p>
            This previously published event is no longer going ahead. The page
            remains available so an old link does not become misleading.
          </p>
        </aside>
      ) : null}

      <article className="event-detail">
        <div className="event-detail__lead">
          <div className="event-detail__summary">
            <header className="event-detail__header">
              <div>
                <p className="eyebrow">
                  {event.club.name}
                  {event.program ? (
                    <>
                      {" · "}
                      <Link
                        href={`/clubs/${event.club.slug}/programs/${event.program.slug}`}
                      >
                        {event.program.name}
                      </Link>
                    </>
                  ) : null}
                  {event.lane ? ` · ${event.lane.name}` : ""}
                  {event.category ? ` · ${event.category.name}` : ""}
                </p>
                <h1>
                  <EventTitleText title={event.title} />
                </h1>
              </div>
              <div className="event-detail__stamp" aria-hidden="true">
                <span>{schedule.month}</span>
                <strong>{schedule.day}</strong>
              </div>
            </header>

            {event.rsvpUrl && !event.isCancelled ? (
              <a
                aria-label={`RSVP for ${event.title} on Meetup (opens in a new tab)`}
                className="primary-action"
                href={event.rsvpUrl}
                rel="noreferrer noopener"
                target="_blank"
              >
                RSVP on Meetup <span aria-hidden="true">↗</span>
              </a>
            ) : null}

            <section
              className="event-detail__facts event-detail__facts--primary"
              aria-labelledby="facts-title"
            >
              <h2 id="facts-title">The essentials</h2>
              <dl>
                <div>
                  <dt>When</dt>
                  <dd>
                    {schedule.label}
                    {event.schedule.kind === "timed" ? (
                      <span>Times shown in {event.schedule.timeZone}.</span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>
                    {event.venue ? (
                      <>
                        {event.venue.name}
                        {locationParts.slice(1).map((part) => (
                          <span key={part}>{part}</span>
                        ))}
                        {event.arrivalInstructions ? (
                          <span>{event.arrivalInstructions}</span>
                        ) : null}
                        {event.externalMapUrl ? (
                          <span>
                            <a
                              href={event.externalMapUrl}
                              rel="noreferrer noopener"
                            >
                              Open map
                            </a>
                          </span>
                        ) : null}
                      </>
                    ) : event.attendanceMode === "online" && event.rsvpUrl ? (
                      "Online details are available from the official RSVP destination."
                    ) : event.attendanceMode === "online" ? (
                      "Online details have not been published."
                    ) : (
                      "Location details have not been published."
                    )}
                    {event.publicAccessNote ? (
                      <span>{event.publicAccessNote}</span>
                    ) : null}
                    {event.publicOnlineUrl ? (
                      <span>
                        <a
                          href={event.publicOnlineUrl}
                          rel="noreferrer noopener"
                        >
                          Open online access details
                        </a>
                      </span>
                    ) : null}
                  </dd>
                </div>
              </dl>
              {event.rsvpMode === "coming_soon" && !event.isCancelled ? (
                <p className="event-detail__rsvp-note">
                  RSVP information coming soon.
                </p>
              ) : null}
            </section>
          </div>

          <div className="event-detail__visual">
            {event.artwork ? (
              <figure
                className="event-detail__artwork"
                style={{
                  marginInline: "auto",
                  maxWidth: `${event.artwork.dimensions.large.width}px`,
                }}
              >
                <div className="event-detail__artwork-frame">
                  {/* The gated media route revalidates rights and published usage on every
                      request. Next/Image's optimizer cache would bypass that revocation
                      boundary, so this responsive image must load the controlled URLs
                      directly. */}
                  <EventPosterImage
                    alt={event.artwork.altText ?? ""}
                    decoding="async"
                    fallback={
                      <EventArtworkFallback
                        className="event-detail__artwork-frame"
                        lane={event.lane}
                      />
                    }
                    fetchPriority="high"
                    height={event.artwork.dimensions.large.height}
                    loading="eager"
                    sizes="(max-width: 1024px) 92vw, (max-width: 1440px) 42vw, 560px"
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
                <figcaption>Artwork: {event.artwork.credit}</figcaption>
              </figure>
            ) : (
              <EventArtworkFallback
                className="event-detail__artwork"
                lane={event.lane}
              />
            )}
            {event.summary ? (
              <p className="event-detail__deck">{event.summary}</p>
            ) : null}
            {showCalendarDownload ? (
              <AddToCalendar canonicalUrl={canonicalUrl} event={event} />
            ) : null}
          </div>

          {hasPlanningDetails ? (
            <section
              aria-labelledby="planning-details-title"
              className="event-detail__facts event-detail__facts--secondary"
            >
              <h2 id="planning-details-title">Planning details</h2>
              <dl>
                {event.status === "tentative" ? (
                  <div>
                    <dt>Status</dt>
                    <dd>
                      Tentative — check the official listing before travel.
                    </dd>
                  </div>
                ) : null}
                {availability ? (
                  <div>
                    <dt>Availability</dt>
                    <dd>{availability}</dd>
                  </div>
                ) : null}
                {event.costText ? (
                  <div>
                    <dt>Cost</dt>
                    <dd>{event.costText}</dd>
                  </div>
                ) : null}
                {capacity ? (
                  <div>
                    <dt>Capacity</dt>
                    <dd>{capacity}</dd>
                  </div>
                ) : null}
                {event.agePolicyText ? (
                  <div>
                    <dt>Age</dt>
                    <dd>{event.agePolicyText}</dd>
                  </div>
                ) : null}
              </dl>
            </section>
          ) : null}
        </div>

        <section className="event-detail__story" aria-labelledby="about-title">
          <p className="section-kicker">Event information</p>
          <h2 id="about-title">About this event</h2>
          {event.descriptionBlocks ? (
            <PublicRichDescription
              blocks={event.descriptionBlocks}
              eventUrl={event.rsvpUrl}
            />
          ) : event.description ? (
            event.description
              .split(/\n{2,}/u)
              .filter(Boolean)
              .map((paragraph) => <p key={paragraph}>{paragraph}</p>)
          ) : event.summary ? (
            <p>{event.summary}</p>
          ) : (
            <p>No additional public description has been supplied.</p>
          )}
          {event.organizers.length > 0 ? (
            <section
              aria-labelledby="public-organizers-title"
              className="event-organizers"
            >
              <p className="section-kicker">People</p>
              <h3 id="public-organizers-title">
                {event.organizers.length === 1
                  ? "Your organizer"
                  : "Your organizers"}
              </h3>
              <ul>
                {event.organizers.map((organizer, index) => (
                  <li
                    className={
                      organizer.photo
                        ? undefined
                        : "event-organizers__text-only"
                    }
                    key={`${organizer.displayName}:${index}`}
                  >
                    {organizer.photo ? (
                      <figure>
                        {/* This controlled media URL rechecks the immutable
                            published usage before returning bytes. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt={organizer.photo.altText}
                          decoding="async"
                          height={organizer.photo.height}
                          loading="lazy"
                          sizes="(max-width: 640px) 5rem, 6rem"
                          src={organizer.photo.url}
                          width={organizer.photo.width}
                        />
                        <figcaption>
                          Photo: {organizer.photo.credit}
                        </figcaption>
                      </figure>
                    ) : null}
                    <div>
                      <strong>{organizer.displayName}</strong>
                      {organizer.biography ? (
                        <p>{organizer.biography}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {event.preparationInformation ? (
            <PublicNote
              heading="Before you come"
              text={event.preparationInformation}
            />
          ) : null}
          {event.whatToBring ? (
            <PublicNote heading="What to bring" text={event.whatToBring} />
          ) : null}
          {event.weatherNote ? (
            <PublicNote heading="Weather note" text={event.weatherNote} />
          ) : null}
          {event.verifiedAccessibilityNotes ? (
            <PublicNote
              heading="Accessibility information"
              text={event.verifiedAccessibilityNotes}
            />
          ) : null}
          {showShareControls ? (
            <ShareControls title={event.title} url={canonicalUrl} />
          ) : null}
        </section>
      </article>

    </>
  );
}

function PublicRichDescription({
  blocks,
  eventUrl,
}: Readonly<{
  blocks: NonNullable<PublicEventDetailDto["descriptionBlocks"]>;
  eventUrl: string | null;
}>) {
  const displayBlocks = meetupDescriptionBlocksForDisplay(blocks, eventUrl);
  return (
    <div className="event-detail__rich-description">
      {displayBlocks.map((block, blockIndex) => {
        if (block.type === "heading") {
          const content = (
            <PublicDescriptionInlines inlines={block.content} />
          );
          return block.level === 3 ? (
            <h3 key={`${block.type}:${blockIndex}`}>{content}</h3>
          ) : (
            <h4 key={`${block.type}:${blockIndex}`}>{content}</h4>
          );
        }
        if (block.type === "paragraph") {
          return (
            <p key={`${block.type}:${blockIndex}`}>
              <PublicDescriptionInlines inlines={block.content} />
            </p>
          );
        }
        const List = block.type === "ordered-list" ? "ol" : "ul";
        return (
          <List key={`${block.type}:${blockIndex}`}>
            {block.items.map((item, itemIndex) => (
              <li key={`${block.type}:${blockIndex}:${itemIndex}`}>
                <PublicDescriptionInlines inlines={item} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

function PublicDescriptionInlines({
  inlines,
}: Readonly<{
  inlines: readonly CuratedMeetupDescriptionInline[];
}>) {
  return inlines.map((inline, index) => {
    if (inline.type === "strong") {
      return <strong key={`${inline.type}:${index}`}>{inline.text}</strong>;
    }
    if (inline.type === "link") {
      return (
        <a
          href={inline.href}
          key={`${inline.type}:${index}`}
          rel="noreferrer noopener"
        >
          {inline.text}
        </a>
      );
    }
    return <span key={`${inline.type}:${index}`}>{inline.text}</span>;
  });
}

function PublicNote({
  heading,
  text,
}: Readonly<{ heading: string; text: string }>) {
  return (
    <section className="event-detail__public-note">
      <h3>{heading}</h3>
      {text
        .split(/\n{2,}/u)
        .filter(Boolean)
        .map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
    </section>
  );
}
