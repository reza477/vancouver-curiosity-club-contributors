"use client";

import Link from "next/link";
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AddToCalendar } from "./AddToCalendar";
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
  siteOrigin = null,
  todayDate,
}: Readonly<{
  complete: boolean;
  events: readonly PublicEventCardDto[];
  maxMonth: string;
  minMonth: string;
  month: string;
  siteOrigin?: string | null;
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
  const eventDates = [...events]
    .map(publicEventCalendarStartDate)
    .filter((date) => date.startsWith(`${month}-`))
    .sort();
  const firstEventDate = eventDates[0];
  const firstUpcomingEventDate = eventDates.find((date) => date >= todayDate);
  const todayHasEvents = todayDate.startsWith(`${month}-`)
    ? (eventsByDate.get(todayDate)?.length ?? 0) > 0
    : false;
  const initialDate =
    todayHasEvents
      ? todayDate
      : firstUpcomingEventDate ??
        firstEventDate ??
        (todayDate.startsWith(`${month}-`) ? todayDate : `${month}-01`);
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
        <div className="public-calendar__title-lockup">
          <p className="section-kicker">Month at a glance</p>
          <h1 id="public-calendar-title">
            {formatPublicCalendarMonth(month)}
          </h1>
          <p className="public-calendar__invitation">
            Pick a date. See the poster. Join the gathering.
          </p>
        </div>
        <nav aria-label="Calendar months">
          {previousMonth ? (
            <Link href={calendarHref(previousMonth)}>Previous month</Link>
          ) : (
            <span aria-hidden="true" />
          )}
          <Link href={calendarHref(todayDate.slice(0, 7))}>Today</Link>
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
                            aria-pressed={selected}
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
                                    <span
                                      data-event-lane={item.lane?.slug}
                                      key={item.slug}
                                    >
                                      {item.title}
                                    </span>
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
            Click or tap a date to select it. Its details stay open until you
            select another date. Arrow keys move between days.
          </p>
          {events.length > 0 ? (
            <section
              className="public-calendar__mobile-agenda"
              aria-labelledby="public-calendar-mobile-agenda-title"
            >
              <div className="public-calendar__mobile-agenda-heading">
                <p className="section-kicker">This month</p>
                <h2 id="public-calendar-mobile-agenda-title">
                  See what is coming up
                </h2>
              </div>
              <div className="public-calendar__mobile-agenda-list">
                {events.slice(0, 12).map((event) => {
                  const eventDate = publicEventCalendarStartDate(event);
                  return (
                    <button
                      aria-pressed={eventDate === activeDate}
                      key={event.slug}
                      onClick={() => {
                        setFocusDate(eventDate);
                        setActiveDate(eventDate);
                        revealDayPanelForTouch();
                      }}
                      type="button"
                    >
                      {event.artwork ? (
                        <>
                          {/* The controlled media route revalidates public usage. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt=""
                            decoding="async"
                            height={event.artwork.dimensions.small.height}
                            loading="lazy"
                            src={event.artwork.srcSet.small}
                            width={event.artwork.dimensions.small.width}
                          />
                        </>
                      ) : (
                        <span
                          aria-hidden="true"
                          className="public-calendar__mobile-agenda-fallback"
                          data-event-lane={event.lane?.slug}
                        />
                      )}
                      <span>
                        <small>{formatPublicCalendarDate(eventDate)}</small>
                        <strong>{event.title}</strong>
                      </span>
                    </button>
                  );
                })}
              </div>
              {events.length > 12 ? (
                <p className="public-calendar__mobile-agenda-more">
                  {events.length - 12} more events remain visible in the month
                  grid.
                </p>
              ) : null}
            </section>
          ) : null}
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
                <CalendarEventPreview
                  event={event}
                  key={event.slug}
                  siteOrigin={siteOrigin}
                />
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
  siteOrigin,
}: Readonly<{
  event: PublicEventCardDto;
  siteOrigin: string | null;
}>) {
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
      data-event-lane={event.lane?.slug}
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
          aria-label={`${event.title}, ${event.lane?.name ?? event.club.name} event`}
          className="public-calendar-event__artwork public-calendar-event__artwork--fallback"
          data-event-lane={event.lane?.slug ?? "community"}
          role="img"
        >
          <span className="public-calendar-event__fallback-label">
            {event.lane?.name ?? event.club.name}
          </span>
          <strong className="public-calendar-event__fallback-title">
            {event.title}
          </strong>
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
        {event.venue?.address ? (
          <p className="public-calendar-event__location">
            {event.venue.address}
          </p>
        ) : null}
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
          <AddToCalendar
            canonicalUrl={
              siteOrigin
                ? new URL(
                    `/events/${encodeURIComponent(event.slug)}`,
                    siteOrigin,
                  ).href
                : null
            }
            event={event}
          />
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
