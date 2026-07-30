"use client";

import Link from "next/link";
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { FieldArtwork } from "./FieldArtwork";
import { responsiveImageSrcSet } from "@/lib/media/presentation";
import {
  eventOccursOnCalendarDate,
  formatPublicCalendarDate,
  formatPublicCalendarEventTime,
  formatPublicCalendarMonth,
  publicCalendarMonthCells,
  publicEventCalendarStartDate,
} from "@/lib/public-calendar";
import type { PublicEventCardDto } from "@/lib/server/public/events";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function PublicMonthCalendar({
  complete,
  events,
  maxMonth,
  minMonth,
  month,
  todayDate,
}: Readonly<{
  complete: boolean;
  events: readonly PublicEventCardDto[];
  maxMonth: string;
  minMonth: string;
  month: string;
  todayDate: string;
}>) {
  const cells = useMemo(() => publicCalendarMonthCells(month), [month]);
  const eventsByDate = useMemo(
    () =>
      new Map(
        cells.map((cell) => [
          cell.date,
          events.filter((event) =>
            eventOccursOnCalendarDate(event, cell.date),
          ),
        ]),
      ),
    [cells, events],
  );
  const firstEventDate = [...events]
    .map(publicEventCalendarStartDate)
    .filter((date) => date.startsWith(`${month}-`))
    .sort()[0];
  const initialDate =
    todayDate.startsWith(`${month}-`) ? todayDate : firstEventDate ?? `${month}-01`;
  const [activeDate, setActiveDate] = useState(initialDate);
  const [focusDate, setFocusDate] = useState(initialDate);
  const dayPanelRef = useRef<HTMLElement>(null);
  const activeEvents = eventsByDate.get(activeDate) ?? [];
  const previousMonth =
    month > minMonth ? shiftMonthForHref(month, -1) : null;
  const nextMonth =
    month < maxMonth ? shiftMonthForHref(month, 1) : null;

  function revealDayPanelForTouch() {
    if (!window.matchMedia("(hover: none)").matches) return;
    window.requestAnimationFrame(() => {
      dayPanelRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
  }

  function moveFocus(
    event: KeyboardEvent<HTMLButtonElement>,
    date: string,
  ) {
    const dateValue = new Date(`${date}T12:00:00.000Z`);
    const dayOfWeek = dateValue.getUTCDay();
    const dayDelta =
      event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowUp"
            ? -7
            : event.key === "ArrowDown"
              ? 7
              : event.key === "Home"
                ? -dayOfWeek
                : event.key === "End"
                  ? 6 - dayOfWeek
                  : null;
    if (dayDelta === null) return;
    event.preventDefault();
    const target = new Date(dateValue);
    target.setUTCDate(target.getUTCDate() + dayDelta);
    const nextDate = target.toISOString().slice(0, 10);
    if (!nextDate.startsWith(`${month}-`)) return;
    setFocusDate(nextDate);
    setActiveDate(nextDate);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(
          `[data-public-calendar-date="${nextDate}"]`,
        )
        ?.focus();
    });
  }

  return (
    <section
      className="public-calendar"
      aria-labelledby="public-calendar-title"
    >
      <header className="public-calendar__toolbar">
        <div>
          <p className="section-kicker">Month at a glance</p>
          <h2 id="public-calendar-title">
            {formatPublicCalendarMonth(month)}
          </h2>
        </div>
        <nav aria-label="Calendar months">
          {previousMonth ? (
            <Link href={calendarHref(previousMonth)}>Previous month</Link>
          ) : (
            <span aria-hidden="true" />
          )}
          <Link href="/calendar">Today</Link>
          {nextMonth ? (
            <Link href={calendarHref(nextMonth)}>Next month</Link>
          ) : (
            <span aria-hidden="true" />
          )}
        </nav>
      </header>

      <div className="public-calendar__layout">
          <div className="public-calendar__month">
          <table className="public-calendar__grid">
            <caption className="sr-only">
              {formatPublicCalendarMonth(month)} event calendar
            </caption>
            <thead>
              <tr>
                {WEEKDAYS.map((day) => (
                  <th key={day} scope="col">
                    <abbr title={day}>{day.slice(0, 3)}</abbr>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }, (_, weekIndex) => (
                <tr key={cells[weekIndex * 7]?.date}>
                  {cells
                    .slice(weekIndex * 7, weekIndex * 7 + 7)
                    .map((cell) => {
                      if (!cell.inMonth) {
                        return (
                          <td
                            aria-hidden="true"
                            className="public-calendar__day--outside"
                            key={cell.date}
                          >
                            <span>{Number(cell.date.slice(-2))}</span>
                          </td>
                        );
                      }
                      const dayEvents = eventsByDate.get(cell.date) ?? [];
                      const titlePreview = dayEvents
                        .slice(0, 2)
                        .map((item) => item.title)
                        .join(", ");
                      const count = dayEvents.length;
                      const selected = cell.date === activeDate;
                      return (
                        <td key={cell.date}>
                          <button
                            aria-controls="public-calendar-day-panel"
                            aria-current={
                              cell.date === todayDate ? "date" : undefined
                            }
                            aria-label={`${formatPublicCalendarDate(cell.date)}. ${
                              complete
                                ? `${count} ${
                                    count === 1 ? "event" : "events"
                                  }`
                                : `${count} loaded ${
                                    count === 1 ? "event" : "events"
                                  }`
                            }${titlePreview ? `: ${titlePreview}` : ""}.`}
                            className={[
                              "public-calendar__day",
                              "public-calendar__day--in-month",
                              selected
                                ? "public-calendar__day--selected"
                                : "",
                              count > 0
                                ? "public-calendar__day--has-events"
                                : "",
                              cell.date === todayDate
                                ? "public-calendar__day--today"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            data-public-calendar-date={cell.date}
                            onClick={() => {
                              setFocusDate(cell.date);
                              setActiveDate(cell.date);
                              revealDayPanelForTouch();
                            }}
                            onFocus={() => {
                              setFocusDate(cell.date);
                              setActiveDate(cell.date);
                            }}
                            onKeyDown={(keyboardEvent) =>
                              moveFocus(keyboardEvent, cell.date)
                            }
                            onMouseEnter={() =>
                              setActiveDate(cell.date)
                            }
                            tabIndex={cell.date === focusDate ? 0 : -1}
                            type="button"
                          >
                            <span className="public-calendar__day-number">
                              {Number(cell.date.slice(-2))}
                            </span>
                            {count > 0 ? (
                              <>
                                <span className="public-calendar__event-count">
                                  {count} {count === 1 ? "event" : "events"}
                                </span>
                                <span
                                  className="public-calendar__event-dot"
                                  aria-hidden="true"
                                />
                                <span className="public-calendar__day-titles">
                                  {dayEvents.slice(0, 2).map((item) => (
                                    <span key={item.slug}>{item.title}</span>
                                  ))}
                                  {count > 2 ? (
                                    <span>+{count - 2} more</span>
                                  ) : null}
                                </span>
                              </>
                            ) : null}
                          </button>
                        </td>
                      );
                    })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="public-calendar__keyboard-help">
            Hover, tap, or focus a date to see its events. Arrow keys move
            between days. The month links move backward or forward.
          </p>
        </div>

        <aside
          className="public-calendar__day-panel"
          id="public-calendar-day-panel"
          aria-labelledby="public-calendar-day-heading"
          ref={dayPanelRef}
        >
          <div className="public-calendar__day-heading">
            <p className="section-kicker">
              {activeEvents.length === 0
                ? "Open day"
                : `${activeEvents.length} ${
                    activeEvents.length === 1 ? "event" : "events"
                  }`}
            </p>
            <h3 id="public-calendar-day-heading">
              {formatPublicCalendarDate(activeDate)}
            </h3>
          </div>
          {activeEvents.length > 0 ? (
            <div className="public-calendar__day-events">
              {activeEvents.map((event) => (
                <CalendarEventPreview event={event} key={event.slug} />
              ))}
            </div>
          ) : (
            <div className="public-calendar__day-empty">
              <p>
                {complete
                  ? "No published event is scheduled for this day."
                  : "No event is shown for this day in this bounded calendar view."}
              </p>
              <p>
                {complete
                  ? "Dates with an event are marked with a dark dot."
                  : "Use the list and filters view for the complete result set."}
              </p>
            </div>
          )}
          <p
            aria-atomic="true"
            aria-live="polite"
            className="sr-only"
            role="status"
          >
            {formatPublicCalendarDate(activeDate)}. {activeEvents.length}{" "}
            {activeEvents.length === 1 ? "event shown" : "events shown"}.
          </p>
        </aside>
      </div>
    </section>
  );
}

function CalendarEventPreview({
  event,
}: Readonly<{ event: PublicEventCardDto }>) {
  const location =
    event.attendanceMode === "online"
      ? "Online"
      : event.attendanceMode === "hybrid"
        ? event.venue?.name
          ? `${event.venue.name} + online`
          : "Hybrid"
        : event.venue?.name ?? "Location to be announced";
  return (
    <article
      className="public-calendar-event"
      data-event-status={event.status}
    >
      {event.artwork ? (
        <figure className="public-calendar-event__artwork">
          {/* The controlled media route revalidates current public usage. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={event.artwork.altText ?? ""}
            decoding="async"
            height={event.artwork.dimensions.medium.height}
            loading="lazy"
            sizes="(max-width: 52rem) 100vw, 24rem"
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
              objectPosition: `${event.artwork.focalPoint.x / 100}% ${
                event.artwork.focalPoint.y / 100
              }%`,
            }}
            width={event.artwork.dimensions.medium.width}
          />
          <figcaption>Artwork: {event.artwork.credit}</figcaption>
        </figure>
      ) : (
        <div
          aria-label="Field Notes category artwork"
          className="public-calendar-event__artwork public-calendar-event__artwork--fallback"
          role="img"
        >
          <FieldArtwork tone={eventArtworkTone(event.lane?.slug)} />
        </div>
      )}
      <div className="public-calendar-event__copy">
        <p>
          <span>{publicEventStatusLabel(event.status)}</span> /{" "}
          {formatPublicCalendarEventTime(event)} / {location}
        </p>
        <h4>
          <Link href={`/events/${event.slug}`}>{event.title}</Link>
        </h4>
        {event.summary ? <p>{event.summary}</p> : null}
        <div className="public-calendar-event__actions">
          <Link href={`/events/${event.slug}`}>Event details</Link>
          {event.rsvpMode === "meetup" && event.rsvpUrl ? (
            <a
              aria-label="RSVP on Meetup (opens in a new tab)"
              href={event.rsvpUrl}
              rel="noreferrer noopener"
              target="_blank"
            >
              RSVP on Meetup
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function publicEventStatusLabel(
  status: PublicEventCardDto["status"],
): string {
  if (status === "cancelled") return "Cancelled";
  if (status === "completed") return "Completed";
  if (status === "tentative") return "Tentative";
  return "Confirmed";
}

function eventArtworkTone(slug: string | undefined) {
  if (slug === "reset-and-make") return "reset-make" as const;
  if (slug === "explore") return "explore" as const;
  if (slug === "eat-and-play") return "eat-play" as const;
  return "think" as const;
}

function calendarHref(month: string): string {
  return `/calendar?month=${encodeURIComponent(month)}`;
}

function shiftMonthForHref(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const value = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${value.getUTCFullYear().toString().padStart(4, "0")}-${(
    value.getUTCMonth() + 1
  )
    .toString()
    .padStart(2, "0")}`;
}
