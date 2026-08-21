import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import { EventPosterImage } from "@/app/_components/EventPosterImage";
import {
  discoveryArtworkCredit,
  responsiveImageSrcSet,
} from "@/lib/media/presentation";
import {
  publicEventCapacityLabel,
  publicEventLocationParts,
} from "@/lib/public-event-facts";
import type { PublicEventCardDto } from "@/lib/server/public/events";

export function EventCard({
  event,
  compact = false,
  eager = false,
  posterSizes = "(max-width: 640px) 100vw, (max-width: 1100px) 38vw, 480px",
  priority = false,
}: Readonly<{
  event: PublicEventCardDto;
  compact?: boolean;
  eager?: boolean;
  posterSizes?: string;
  priority?: boolean;
}>) {
  const schedule = formatEventSchedule(event);
  const locationParts = publicEventLocationParts(event);
  const capacity = publicEventCapacityLabel(event);
  const artworkCredit = event.artwork
    ? discoveryArtworkCredit(event.artwork.credit)
    : null;
  const artworkDimensions = event.artwork
    ? compact
      ? event.artwork.dimensions.medium
      : event.artwork.dimensions.large
    : null;
  const artworkSrc = event.artwork
    ? compact
      ? event.artwork.srcSet.medium
      : event.artwork.url
    : null;
  const location =
    event.attendanceMode === "online"
      ? "Online"
      : event.attendanceMode === "hybrid"
        ? event.venue?.name
          ? `${event.venue.name} + online`
          : "Hybrid · location details not published"
        : event.venue?.name
          ? event.venue.name
          : event.attendanceMode === "in-person"
            ? "Location details not published"
            : "Location undecided";

  return (
    <article
      className={`event-card${compact ? " event-card--compact" : ""}`}
      data-event-lane={event.lane?.slug}
      data-event-status={event.status}
    >
      {event.artwork ? (
        <figure className="event-card__artwork">
          <div className="event-card__artwork-frame">
            {/* The gated media route revalidates rights and published usage on every
                request. Next/Image's optimizer cache would bypass that revocation
                boundary, so this responsive image must load the controlled URLs
                directly. */}
            <EventPosterImage
              alt={event.artwork.altText ?? ""}
              decoding="async"
              fallback={
                <EventArtworkFallback
                  className="event-card__artwork-frame"
                  lane={event.lane}
                />
              }
              fetchPriority={priority ? "high" : "auto"}
              height={artworkDimensions!.height}
              loading={priority || eager ? "eager" : "lazy"}
              sizes={posterSizes}
              src={artworkSrc!}
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
              width={artworkDimensions!.width}
            />
          </div>
          {artworkCredit ? (
            <figcaption>Artwork: {artworkCredit}</figcaption>
          ) : null}
        </figure>
      ) : (
        <EventArtworkFallback
          className="event-card__artwork"
          lane={event.lane}
        />
      )}

      <div className="event-card__body">
        <div className="event-card__date" aria-hidden="true">
          <span>{schedule.month}</span>
          <strong>{schedule.day}</strong>
        </div>
        <div aria-label="Event associations" className="event-card__meta">
          <Link href={`/clubs/${event.club.slug}`}>
            {event.club.name}
          </Link>
          {event.program ? (
            <Link
              href={`/clubs/${event.club.slug}/programs/${event.program.slug}`}
            >
              {event.program.name}
            </Link>
          ) : null}
          {event.lane ? <span>{event.lane.name}</span> : null}
          {event.category ? <span>{event.category.name}</span> : null}
          {event.status === "tentative" ? (
            <span className="status-chip status-chip--tentative">
              Tentative
            </span>
          ) : null}
        </div>
        <h3>
          <Link aria-label={event.title} href={`/events/${event.slug}`}>
            <EventTitleText title={event.title} />
          </Link>
        </h3>
        {event.summary && !compact ? (
          <p className="event-discovery-summary">{event.summary}</p>
        ) : null}
        <dl className="event-card__facts">
          <div>
            <dt>When</dt>
            <dd>{schedule.label}</dd>
          </div>
          <div>
            <dt>Where</dt>
            <dd>
              <span>{location}</span>
              {event.attendanceMode !== "online"
                ? locationParts.slice(1).map((part) => (
                    <span key={part}>{part}</span>
                  ))
                : null}
            </dd>
          </div>
          {event.arrivalInstructions ? (
            <div>
              <dt>Arrival</dt>
              <dd>{event.arrivalInstructions}</dd>
            </div>
          ) : null}
          {capacity ? (
            <div>
              <dt>Capacity</dt>
              <dd>{capacity}</dd>
            </div>
          ) : null}
          {event.costText ? (
            <div>
              <dt>Cost</dt>
              <dd>{event.costText}</dd>
            </div>
          ) : null}
          {event.agePolicyText ? (
            <div>
              <dt>Age</dt>
              <dd>{event.agePolicyText}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      <Link
        aria-label={`View details for ${event.title}`}
        className="event-card__arrow"
        href={`/events/${event.slug}`}
      >
        <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}

export function EventTitleText({ title }: Readonly<{ title: string }>) {
  const leadingEmoji = title.match(
    /^([\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\s]+)(\S[\s\S]*)$/u,
  );
  const decoration = leadingEmoji?.[1].trim() ?? null;
  const text = leadingEmoji?.[2] ?? title;
  const protectedSeparators = text.replace(
    /\s+([-–—])\s+/gu,
    "\u00a0$1 ",
  );

  return (
    <>
      {decoration ? (
        <span className="event-title__emoji">{decoration}</span>
      ) : null}
      {decoration ? "\u00a0" : null}
      {protectedSeparators}
    </>
  );
}

export function EventArtworkFallback({
  className,
  lane,
}: Readonly<{
  className: string;
  lane: PublicEventCardDto["lane"];
}>) {
  const laneTone = eventArtworkTone(lane?.slug);

  return (
    <div
      className={`${className} ${className}--fallback event-artwork-fallback field-artwork--${laneTone}`}
      data-event-lane={lane?.slug ?? "community"}
    >
      <p className="event-artwork-fallback__eyebrow">
        Vancouver Curiosity Club
      </p>
      <strong>{lane?.name ?? "Community gathering"}</strong>
      <span>
        {lane
          ? `Gathering in the ${lane.name} lane`
          : "Event poster coming soon"}
      </span>
    </div>
  );
}

function eventArtworkTone(
  slug: string | undefined,
): "eat-play" | "explore" | "reset-make" | "think" {
  if (slug === "reset-and-make") return "reset-make";
  if (slug === "explore") return "explore";
  if (slug === "eat-and-play") return "eat-play";
  return "think";
}

export function formatEventSchedule(event: PublicEventCardDto): Readonly<{
  day: string;
  label: string;
  month: string;
}> {
  if (event.schedule.kind === "all_day") {
    const start = calendarDateAtNoon(event.schedule.startDate);
    const endInclusive = calendarDateAtNoon(
      addCalendarDays(event.schedule.endDateExclusive, -1),
    );
    const dateLabel =
      event.schedule.startDate ===
      addCalendarDays(event.schedule.endDateExclusive, -1)
        ? new Intl.DateTimeFormat("en-CA", {
            dateStyle: "long",
            timeZone: "UTC",
          }).format(start)
        : `${new Intl.DateTimeFormat("en-CA", {
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          }).format(start)}–${new Intl.DateTimeFormat("en-CA", {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          }).format(endInclusive)}`;
    return Object.freeze({
      month: new Intl.DateTimeFormat("en-CA", {
        month: "short",
        timeZone: "UTC",
      })
        .format(start)
        .toUpperCase(),
      day: new Intl.DateTimeFormat("en-CA", {
        day: "2-digit",
        timeZone: "UTC",
      }).format(start),
      label: `${dateLabel} · All day`,
    });
  }

  const start = new Date(event.schedule.startsAtUtc);
  const end = new Date(event.schedule.endsAtUtc);
  const displayTimeZone = event.schedule.timeZone;
  const localDate = new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: displayTimeZone,
  }).format(start);
  const startTime = new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: displayTimeZone,
  }).format(start);
  const endTime = new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: displayTimeZone,
    timeZoneName: "short",
  }).format(end);
  return Object.freeze({
    month: new Intl.DateTimeFormat("en-CA", {
      month: "short",
      timeZone: displayTimeZone,
    })
      .format(start)
      .toUpperCase(),
    day: new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      timeZone: displayTimeZone,
    }).format(start),
    label: `${localDate} · ${startTime}–${endTime}`,
  });
}

function calendarDateAtNoon(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

function addCalendarDays(value: string, days: number): string {
  const date = calendarDateAtNoon(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
