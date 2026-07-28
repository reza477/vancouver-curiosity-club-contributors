import Link from "next/link";
import { formatEventSchedule } from "@/app/_components/EventCard";
import { FieldArtwork } from "@/app/_components/FieldArtwork";
import { ShareControls } from "@/app/_components/ShareControls";
import { responsiveImageSrcSet } from "@/lib/media/presentation";
import type { PublicEventDetailDto } from "@/lib/server/public/events";

export function PublicEventDetailRenderer({
  canonicalUrl,
  event,
  showShareControls = true,
}: Readonly<{
  canonicalUrl: string | null;
  event: PublicEventDetailDto;
  showShareControls?: boolean;
}>) {
  const schedule = formatEventSchedule(event);

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
            </p>
            <h1>{event.title}</h1>
            {event.summary ? (
              <p className="event-detail__deck">{event.summary}</p>
            ) : null}
          </div>
          <div className="event-detail__stamp" aria-hidden="true">
            <span>{schedule.month}</span>
            <strong>{schedule.day}</strong>
          </div>
        </header>

        {event.artwork ? (
          <figure className="event-detail__artwork">
            {/* The gated media route revalidates rights and published usage on every
                request. Next/Image's optimizer cache would bypass that revocation
                boundary, so this responsive image must load the controlled URLs
                directly. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={event.artwork.altText ?? ""}
              height={event.artwork.dimensions.large.height}
              sizes="(max-width: 720px) 100vw, (max-width: 1280px) 90vw, 1440px"
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
            <figcaption>Artwork: {event.artwork.credit}</figcaption>
          </figure>
        ) : (
          <div
            aria-label="Field Notes category artwork"
            className="event-detail__artwork event-detail__artwork--fallback"
            role="img"
          >
            <FieldArtwork tone="think" />
          </div>
        )}

        <div className="event-detail__grid">
          <section className="event-detail__facts" aria-labelledby="facts-title">
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
                <dt>Format</dt>
                <dd>{attendanceLabel(event.attendanceMode)}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>
                  {event.venue ? (
                    <>
                      {event.venue.name}
                      {event.venue.address ? (
                        <span>{event.venue.address}</span>
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
                        Open published online access details
                      </a>
                    </span>
                  ) : null}
                </dd>
              </div>
              {event.status === "tentative" ? (
                <div>
                  <dt>Status</dt>
                  <dd>Tentative — check the official listing before travel.</dd>
                </div>
              ) : null}
              {event.availabilityState ? (
                <div>
                  <dt>Availability</dt>
                  <dd>{availabilityLabel(event.availabilityState)}</dd>
                </div>
              ) : null}
              {event.costText ? (
                <div>
                  <dt>Cost</dt>
                  <dd>{event.costText}</dd>
                </div>
              ) : null}
              {event.capacity ? (
                <div>
                  <dt>Capacity</dt>
                  <dd>{event.capacity.toLocaleString("en-CA")}</dd>
                </div>
              ) : null}
            </dl>
            {event.rsvpUrl && !event.isCancelled ? (
              <a
                className="primary-action"
                href={event.rsvpUrl}
                rel="noreferrer noopener"
              >
                RSVP on Meetup <span aria-hidden="true">↗</span>
              </a>
            ) : null}
            {event.rsvpMode === "coming_soon" && !event.isCancelled ? (
              <p className="event-detail__rsvp-note">
                RSVP information coming soon.
              </p>
            ) : null}
          </section>

          <section className="event-detail__story" aria-labelledby="about-title">
            <p className="section-kicker">Field note</p>
            <h2 id="about-title">About this event</h2>
            {event.description ? (
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
                            height={organizer.photo.height}
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
            {event.arrivalInstructions ? (
              <PublicNote
                heading="Arrival"
                text={event.arrivalInstructions}
              />
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
        </div>
      </article>
    </>
  );
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

function availabilityLabel(
  value: NonNullable<PublicEventDetailDto["availabilityState"]>,
): string {
  if (value === "full") return "Full";
  if (value === "waitlist") return "Waitlist";
  return "Open";
}

function attendanceLabel(
  value: PublicEventDetailDto["attendanceMode"],
): string {
  if (value === "in-person") return "In person";
  if (value === "online") return "Online";
  if (value === "hybrid") return "Hybrid";
  return "Location undecided";
}
