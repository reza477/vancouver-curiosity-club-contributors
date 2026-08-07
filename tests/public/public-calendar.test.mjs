import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PageMasthead } from "../../app/_components/PageMasthead.tsx";
import { PublicMonthCalendar } from "../../app/_components/PublicMonthCalendar.tsx";
import {
  eventOccursOnCalendarDate,
  googleCalendarEventUrl,
  publicCalendarMonthBounds,
  publicCalendarMonthCells,
  publicEventCalendarStartDate,
  resolvePublicCalendarLandingMonth,
  resolvePublicCalendarMonth,
  shiftPublicCalendarMonth,
} from "../../lib/public-calendar.ts";

const projectRoot = new URL("../../", import.meta.url);

function timedEvent(overrides = {}) {
  return Object.freeze({
    attendanceMode: "in-person",
    artwork: null,
    category: null,
    club: Object.freeze({
      name: "Vancouver Curiosity Club",
      slug: "vancouver-curiosity-club",
    }),
    isCancelled: false,
    lane: Object.freeze({ name: "Explore", slug: "explore" }),
    program: null,
    rsvpMode: "meetup",
    rsvpUrl: "https://www.meetup.com/example/events/123456789/",
    schedule: Object.freeze({
      endsAtUtc: "2026-07-06T08:30:00.000Z",
      kind: "timed",
      startsAtUtc: "2026-07-06T06:30:00.000Z",
      timeZone: "America/Vancouver",
    }),
    slug: "night-walk",
    status: "confirmed",
    summary: "An evening walk that crosses midnight.",
    title: "Night walk",
    venue: Object.freeze({ address: null, name: "Stanley Park" }),
    ...overrides,
  });
}

function allDayEvent(overrides = {}) {
  return Object.freeze({
    attendanceMode: "location-undecided",
    artwork: null,
    category: null,
    club: Object.freeze({
      name: "Vancouver Curiosity Club",
      slug: "vancouver-curiosity-club",
    }),
    isCancelled: false,
    lane: Object.freeze({ name: "Think", slug: "think" }),
    program: null,
    rsvpMode: "coming_soon",
    rsvpUrl: null,
    schedule: Object.freeze({
      endDateExclusive: "2026-07-09",
      kind: "all_day",
      startDate: "2026-07-07",
      timeZone: "America/Vancouver",
    }),
    slug: "reading-retreat",
    status: "tentative",
    summary: "A two-day reading retreat.",
    title: "Reading retreat",
    venue: null,
    ...overrides,
  });
}

function approvedArtwork() {
  return Object.freeze({
    altText: "A colourful Meetup event poster.",
    credit: "Vancouver Curiosity Club",
    dimensions: Object.freeze({
      large: Object.freeze({ height: 900, width: 1600 }),
      medium: Object.freeze({ height: 540, width: 960 }),
      small: Object.freeze({ height: 270, width: 480 }),
    }),
    focalPoint: Object.freeze({ x: 5000, y: 5000 }),
    srcSet: Object.freeze({
      large: "/media/poster-1/webp_1600",
      medium: "/media/poster-1/webp_960",
      small: "/media/poster-1/webp_480",
    }),
    url: "/media/poster-1/webp_1600",
  });
}

test("calendar month resolution enforces the bounded twelve-month window", () => {
  assert.deepEqual(resolvePublicCalendarMonth(undefined, "2026-07-29"), {
    invalid: false,
    maxMonth: "2027-07",
    minMonth: "2025-07",
    month: "2026-07",
  });
  assert.deepEqual(resolvePublicCalendarMonth("2027-07", "2026-07-29"), {
    invalid: false,
    maxMonth: "2027-07",
    minMonth: "2025-07",
    month: "2027-07",
  });
  assert.deepEqual(resolvePublicCalendarMonth("2027-08", "2026-07-29"), {
    invalid: true,
    maxMonth: "2027-07",
    minMonth: "2025-07",
    month: "2026-07",
  });
  for (const invalid of [
    "2026-00",
    "2026-13",
    "2026-7",
    "not-a-month",
  ]) {
    assert.equal(
      resolvePublicCalendarMonth(invalid, "2026-07-29").invalid,
      true,
    );
  }
});

test("calendar landing opens the nearest upcoming month but preserves an explicit month", () => {
  assert.deepEqual(
    resolvePublicCalendarLandingMonth(
      undefined,
      "2026-07-30",
      "2026-08-02",
    ),
    {
      invalid: false,
      maxMonth: "2027-07",
      minMonth: "2025-07",
      month: "2026-08",
    },
  );
  assert.equal(
    resolvePublicCalendarLandingMonth(
      "2026-07",
      "2026-07-30",
      "2026-08-02",
    ).month,
    "2026-07",
  );
  assert.equal(
    resolvePublicCalendarLandingMonth(
      undefined,
      "2026-07-30",
      null,
    ).month,
    "2026-07",
  );
});

test("month helpers return exact boundaries and a stable 42-day grid", () => {
  assert.deepEqual(publicCalendarMonthBounds("2028-02"), {
    endDate: "2028-02-29",
    startDate: "2028-02-01",
  });
  assert.equal(shiftPublicCalendarMonth("2026-01", -1), "2025-12");
  assert.equal(shiftPublicCalendarMonth("2026-12", 1), "2027-01");

  const cells = publicCalendarMonthCells("2026-08");
  assert.equal(cells.length, 42);
  assert.deepEqual(cells[0], {
    date: "2026-07-26",
    inMonth: false,
  });
  assert.deepEqual(cells.at(-1), {
    date: "2026-09-05",
    inMonth: false,
  });
  assert.equal(cells.filter((cell) => cell.inMonth).length, 31);
  assert.deepEqual(
    cells.filter((cell) => cell.inMonth).map((cell) => cell.date),
    Array.from(
      { length: 31 },
      (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`,
    ),
  );
});

test("timed and all-day events occupy every intended local calendar day", () => {
  const overnight = timedEvent();
  assert.equal(publicEventCalendarStartDate(overnight), "2026-07-05");
  assert.equal(eventOccursOnCalendarDate(overnight, "2026-07-05"), true);
  assert.equal(eventOccursOnCalendarDate(overnight, "2026-07-06"), true);
  assert.equal(eventOccursOnCalendarDate(overnight, "2026-07-07"), false);

  const allDay = allDayEvent();
  assert.equal(publicEventCalendarStartDate(allDay), "2026-07-07");
  assert.equal(eventOccursOnCalendarDate(allDay, "2026-07-06"), false);
  assert.equal(eventOccursOnCalendarDate(allDay, "2026-07-07"), true);
  assert.equal(eventOccursOnCalendarDate(allDay, "2026-07-08"), true);
  assert.equal(eventOccursOnCalendarDate(allDay, "2026-07-09"), false);
  assert.equal(eventOccursOnCalendarDate(allDay, "2026-02-30"), false);
});

test("Google Calendar links preserve exact timed and all-day schedules", () => {
  const timed = new URL(
    googleCalendarEventUrl(
      timedEvent(),
      "https://club.example/events/night-walk",
    ),
  );
  assert.equal(timed.origin, "https://calendar.google.com");
  assert.equal(timed.pathname, "/calendar/render");
  assert.equal(timed.searchParams.get("action"), "TEMPLATE");
  assert.equal(
    timed.searchParams.get("dates"),
    "20260706T063000Z/20260706T083000Z",
  );
  assert.equal(timed.searchParams.get("text"), "Night walk");
  assert.equal(timed.searchParams.get("location"), "Stanley Park");
  assert.equal(timed.searchParams.get("ctz"), "America/Vancouver");
  assert.match(
    timed.searchParams.get("details") ?? "",
    /https:\/\/club\.example\/events\/night-walk/u,
  );

  const allDay = new URL(googleCalendarEventUrl(allDayEvent()));
  assert.equal(
    allDay.searchParams.get("dates"),
    "20260707/20260709",
  );
  assert.equal(allDay.searchParams.get("ctz"), null);
});

test("month calendar renders an accessible date grid, calendar actions, approved artwork, and a lane text fallback", () => {
  const markup = renderToStaticMarkup(
    createElement(PublicMonthCalendar, {
      complete: true,
      events: Object.freeze([
        timedEvent({
          artwork: approvedArtwork(),
          schedule: Object.freeze({
            endsAtUtc: "2026-07-07T03:00:00.000Z",
            kind: "timed",
            startsAtUtc: "2026-07-07T01:00:00.000Z",
            timeZone: "America/Vancouver",
          }),
          venue: Object.freeze({
            address: "Stanley Park, Vancouver, BC",
            name: "Stanley Park",
          }),
        }),
        allDayEvent({
          schedule: Object.freeze({
            endDateExclusive: "2026-07-07",
            kind: "all_day",
            startDate: "2026-07-06",
            timeZone: "America/Vancouver",
          }),
        }),
      ]),
      maxMonth: "2027-07",
      minMonth: "2025-07",
      month: "2026-07",
      nowUtcMs: Date.parse("2026-07-06T07:00:00.000Z"),
      siteOrigin: "https://club.example",
      todayDate: "2026-07-06",
    }),
  );

  assert.equal(
    (markup.match(/data-public-calendar-date=/gu) ?? []).length,
    31,
  );
  assert.match(
    markup,
    /aria-label="Monday, July 6, 2026\. 2 events: Night walk, Reading retreat\."/u,
  );
  assert.match(markup, /aria-controls="public-calendar-day-panel"/u);
  assert.match(markup, /aria-pressed="true"/u);
  assert.match(markup, /aria-current="date"/u);
  assert.match(markup, /<table class="public-calendar__grid">/u);
  assert.match(markup, /<h1 id="public-calendar-title">July 2026<\/h1>/u);
  assert.equal((markup.match(/<h1/gu) ?? []).length, 1);
  assert.equal((markup.match(/<th scope="col">/gu) ?? []).length, 7);
  assert.match(markup, /tabindex="0"/u);
  assert.match(markup, /Click or tap a date to select it/u);
  assert.match(markup, /details stay open until you select another date/u);
  assert.match(
    markup,
    /data-public-calendar-date="2026-07-06"[\s\S]*?public-calendar__day-titles[\s\S]*?>Night walk<[\s\S]*?>Reading retreat</u,
  );
  assert.match(markup, /class="public-calendar__mobile-agenda"/u);
  assert.match(markup, />See what is coming up<\/h2>/u);
  assert.match(markup, /src="\/media\/poster-1\/webp_480"/u);
  assert.match(markup, /data-event-lane="explore"/u);
  assert.match(markup, /href="\/calendar\?month=2026-07">Today<\/a>/u);

  assert.match(markup, /src="\/media\/poster-1\/webp_1600"/u);
  assert.match(markup, /alt="A colourful Meetup event poster\."/u);
  assert.match(markup, /Artwork: Vancouver Curiosity Club/u);
  assert.match(
    markup,
    /aria-label="Reading retreat, Think event"[^>]*class="public-calendar-event__artwork public-calendar-event__artwork--fallback"[^>]*data-event-lane="think"[^>]*role="img"/u,
  );
  assert.match(
    markup,
    /class="public-calendar-event__fallback-label">Think<\/span>/u,
  );
  assert.match(
    markup,
    /class="public-calendar-event__fallback-title">Reading retreat<\/strong>/u,
  );
  assert.doesNotMatch(markup, /field-artwork/u);
  assert.match(markup, />Confirmed<\//u);
  assert.match(markup, />Tentative<\//u);
  assert.match(markup, />Night walk</u);
  assert.match(markup, />Reading retreat</u);
  assert.match(markup, /Stanley Park, Vancouver, BC/u);
  assert.match(markup, /href="\/events\/night-walk"/u);
  assert.match(
    markup,
    /href="https:\/\/www\.meetup\.com\/example\/events\/123456789\/"/u,
  );
  assert.equal((markup.match(/>Add to calendar<\/summary>/gu) ?? []).length, 2);
  assert.equal((markup.match(/>Google Calendar/gu) ?? []).length, 2);
  assert.match(markup, />Apple Calendar \/ download \.ics<\/a>/u);
  assert.match(markup, /href="\/events\/night-walk\/calendar\.ics"/u);
  assert.match(
    markup,
    /https%3A%2F%2Fclub\.example%2Fevents%2Fnight-walk/u,
  );
});

test("an empty today opens the nearest event instead of an empty first impression", () => {
  const markup = renderToStaticMarkup(
    createElement(PublicMonthCalendar, {
      complete: true,
      events: Object.freeze([
        timedEvent({
          schedule: Object.freeze({
            endsAtUtc: "2026-07-03T03:00:00.000Z",
            kind: "timed",
            startsAtUtc: "2026-07-03T01:00:00.000Z",
            timeZone: "America/Vancouver",
          }),
          slug: "past-night-walk",
          title: "Past night walk",
        }),
        timedEvent({
          schedule: Object.freeze({
            endsAtUtc: "2026-07-07T03:00:00.000Z",
            kind: "timed",
            startsAtUtc: "2026-07-07T01:00:00.000Z",
            timeZone: "America/Vancouver",
          }),
        }),
      ]),
      maxMonth: "2027-07",
      minMonth: "2025-07",
      month: "2026-07",
      nowUtcMs: Date.parse("2026-07-04T07:00:00.000Z"),
      siteOrigin: "https://club.example",
      todayDate: "2026-07-04",
    }),
  );

  assert.match(
    markup,
    /aria-label="Monday, July 6, 2026\. 1 event: Night walk\."[\s\S]*?aria-pressed="true"[\s\S]*?public-calendar__day--selected/u,
  );
  assert.match(
    markup,
    /<h3 id="public-calendar-day-heading">Monday, July 6, 2026<\/h3>/u,
  );
  assert.match(markup, />Night walk<\/a>/u);
  assert.doesNotMatch(
    markup,
    /<h3 id="public-calendar-day-heading">Thursday, July 2, 2026<\/h3>/u,
  );
});

test("the phone agenda renders every upcoming event and excludes past events", async () => {
  const pastEvents = Object.freeze([
    timedEvent({
      schedule: Object.freeze({
        endsAtUtc: "2026-07-02T21:00:00.000Z",
        kind: "timed",
        startsAtUtc: "2026-07-02T19:00:00.000Z",
        timeZone: "America/Vancouver",
      }),
      slug: "past-gathering-01",
      title: "Past gathering 01",
    }),
    timedEvent({
      schedule: Object.freeze({
        endsAtUtc: "2026-07-05T21:00:00.000Z",
        kind: "timed",
        startsAtUtc: "2026-07-05T19:00:00.000Z",
        timeZone: "America/Vancouver",
      }),
      slug: "past-gathering-02",
      title: "Past gathering 02",
    }),
  ]);
  const upcomingEvents = Object.freeze(
    Array.from({ length: 13 }, (_, index) => {
      const day = String(index + 11).padStart(2, "0");
      const eventNumber = String(index + 1).padStart(2, "0");
      return timedEvent({
        schedule: Object.freeze({
          endsAtUtc: `2026-07-${day}T21:00:00.000Z`,
          kind: "timed",
          startsAtUtc: `2026-07-${day}T19:00:00.000Z`,
          timeZone: "America/Vancouver",
        }),
        slug: `upcoming-gathering-${eventNumber}`,
        title: `Upcoming gathering ${eventNumber}`,
      });
    }),
  );
  const markup = renderToStaticMarkup(
    createElement(PublicMonthCalendar, {
      complete: true,
      events: Object.freeze([...pastEvents, ...upcomingEvents]),
      maxMonth: "2027-07",
      minMonth: "2025-07",
      month: "2026-07",
      nowUtcMs: Date.parse("2026-07-10T19:00:00.000Z"),
      siteOrigin: "https://club.example",
      todayDate: "2026-07-10",
    }),
  );
  const agendaMarkup = markup.match(
    /<section class="public-calendar__mobile-agenda"[\s\S]*?<\/section>/u,
  )?.[0];

  assert.ok(agendaMarkup, "the phone agenda must render when events are upcoming");
  assert.equal(
    (agendaMarkup.match(/<button/gu) ?? []).length,
    upcomingEvents.length,
    "the phone agenda must not cap the number of upcoming events",
  );
  for (const event of pastEvents) {
    assert.ok(
      !agendaMarkup.includes(`<strong>${event.title}</strong>`),
      `${event.title} must not appear in the phone agenda`,
    );
  }
  for (const event of upcomingEvents) {
    assert.ok(
      agendaMarkup.includes(`<strong>${event.title}</strong>`),
      `${event.title} must remain discoverable in the phone agenda`,
    );
  }
  const nextThreeOffsets = upcomingEvents.slice(0, 3).map((event) =>
    agendaMarkup.indexOf(`<strong>${event.title}</strong>`),
  );
  assert.ok(
    nextThreeOffsets.every((offset) => offset >= 0) &&
      nextThreeOffsets.every(
        (offset, index) => index === 0 || offset > nextThreeOffsets[index - 1],
      ),
    "the next three event names must render in chronological order",
  );

  const styles = await readFile(
    new URL("app/globals.css", projectRoot),
    "utf8",
  );
  const phoneVisibilityRule = styles.match(
    /@media \(max-width:\s*([\d.]+)rem\)[\s\S]*?\.public-calendar__mobile-agenda\s*\{[^}]*display:\s*block;/u,
  );
  assert.ok(phoneVisibilityRule, "the named-event agenda needs a mobile display rule");
  assert.ok(
    Number(phoneVisibilityRule[1]) * 16 >= 390,
    "the named-event agenda must be visible at a 390px viewport",
  );
});

test("calendar interaction contract locks details to click, touch, focus, and keyboard selection", async () => {
  const source = await readFile(
    new URL("app/_components/PublicMonthCalendar.tsx", projectRoot),
    "utf8",
  );

  for (const handler of [
    "onClick",
    "onFocus",
    "onKeyDown",
  ]) {
    assert.match(source, new RegExp(`${handler}=`, "u"));
  }
  assert.doesNotMatch(source, /on(?:Mouse|Pointer)Enter=/u);
  for (const key of [
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
  ]) {
    assert.match(source, new RegExp(`"${key}"`, "u"));
  }
  assert.match(source, /requestAnimationFrame/u);
  assert.match(source, /\.focus\(\)/u);
  assert.match(source, /scrollIntoView/u);
  assert.match(source, /prefers-reduced-motion/u);
  assert.match(source, /setActiveDate\(cell\.date\)/u);
  assert.match(source, /setFocusDate\(cell\.date\)/u);
  assert.match(source, /tabIndex=\{cell\.date === focusDate \? 0 : -1\}/u);
  assert.match(source, /aria-controls="public-calendar-day-panel"/u);
  assert.match(source, /aria-pressed=\{selected\}/u);
  assert.match(
    source,
    /Its details stay open until you[\s\S]*?select another date\./u,
  );
  assert.match(source, /publicEventStatusLabel/u);
  assert.match(source, /<AddToCalendar/u);
  assert.doesNotMatch(source, /FieldArtwork|eventArtworkTone/u);
  assert.match(source, /public-calendar-event__fallback-label/u);
  assert.match(source, /data-event-lane=/u);
});

test("page mastheads retain semantic copy without repeated abstract artwork", () => {
  const markup = renderToStaticMarkup(
    createElement(PageMasthead, {
      deck: "A compact introduction.",
      eyebrow: "About the club",
      title: "Come curious",
      tone: "explore",
    }),
  );

  assert.match(
    markup,
    /<header class="page-masthead page-masthead--compact" data-masthead-tone="explore">/u,
  );
  assert.match(markup, /<p class="eyebrow">About the club<\/p>/u);
  assert.match(markup, /<h1>Come curious<\/h1>/u);
  assert.match(
    markup,
    /<p class="page-masthead__deck">A compact introduction\.<\/p>/u,
  );
  assert.match(markup, /class="page-masthead__accent" aria-hidden="true"/u);
  assert.doesNotMatch(markup, /field-artwork/u);
});

test("the public calendar route renders the month experience instead of redirecting", async () => {
  const page = await readFile(
    new URL("app/calendar/page.tsx", projectRoot),
    "utf8",
  );

  assert.match(page, /PublicMonthCalendar/u);
  assert.doesNotMatch(page, /<h1>Calendar<\/h1>/u);
  assert.match(
    page,
    /<Link href="\/events">List<\/Link>[\s\S]*?aria-current="page" href="\/calendar"/u,
  );
  assert.match(page, /siteOrigin=\{origin\?\.origin \?\? null\}/u);
  assert.doesNotMatch(page, /permanentRedirect/u);
  assert.doesNotMatch(page, /redirect\(\s*["']\/events["']\s*\)/u);
  assert.doesNotMatch(
    page,
    /home-hero|home-newcomer|Come curious\. Leave knowing people\.|calendar-home-introduction/u,
  );
  assert.doesNotMatch(
    page,
    /readPublicMeetupSyncState|CalendarSourceStatus|data-source-status|latest Meetup check|Meetup refresh|last complete calendar|Last completed snapshot/u,
  );
});
