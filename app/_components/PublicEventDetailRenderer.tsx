import { formatEventSchedule } from "@/app/_components/EventCard";
import { ShareControls } from "@/app/_components/ShareControls";
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
              <p className="event-organizers">
                Publicly listed{" "}
                {event.organizers.length === 1 ? "organizer" : "organizers"}:{" "}
                {event.organizers
                  .map((organizer) => organizer.displayName)
                  .join(", ")}
              </p>
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
