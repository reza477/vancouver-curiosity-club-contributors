import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

test("month calendar renders an accessible date grid, calendar actions, approved artwork, and fallback art", () => {
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
  assert.match(markup, /aria-current="date"/u);
  assert.match(markup, /<table class="public-calendar__grid">/u);
  assert.equal((markup.match(/<th scope="col">/gu) ?? []).length, 7);
  assert.match(markup, /tabindex="0"/u);
  assert.match(markup, /Hover, tap, or focus a date/u);
  assert.match(
    markup,
    /data-public-calendar-date="2026-07-06"[\s\S]*?public-calendar__day-titles[\s\S]*?>Night walk<[\s\S]*?>Reading retreat</u,
  );
  assert.match(markup, /href="\/calendar\?month=2026-07">Today<\/a>/u);

  assert.match(markup, /src="\/media\/poster-1\/webp_1600"/u);
  assert.match(markup, /alt="A colourful Meetup event poster\."/u);
  assert.match(markup, /Artwork: Vancouver Curiosity Club/u);
  assert.match(markup, /aria-label="Field Notes category artwork"/u);
  assert.match(markup, />Confirmed<\//u);
  assert.match(markup, />Tentative<\//u);
  assert.match(markup, />Night walk</u);
  assert.match(markup, />Reading retreat</u);
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

test("calendar interaction contract supports pointer, touch/click, focus, and keyboard navigation", async () => {
  const source = await readFile(
    new URL("app/_components/PublicMonthCalendar.tsx", projectRoot),
    "utf8",
  );

  for (const handler of [
    "onClick",
    "onFocus",
    "onKeyDown",
    "onMouseEnter",
  ]) {
    assert.match(source, new RegExp(`${handler}=`, "u"));
  }
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
  assert.match(source, /publicEventStatusLabel/u);
  assert.match(source, /<AddToCalendar/u);
});

test("the public calendar route renders the month experience instead of redirecting", async () => {
  const page = await readFile(
    new URL("app/calendar/page.tsx", projectRoot),
    "utf8",
  );

  assert.match(page, /PublicMonthCalendar/u);
  assert.match(page, /website does not create visitor accounts\./u);
  assert.match(page, /siteOrigin=\{origin\?\.origin \?\? null\}/u);
  assert.doesNotMatch(page, /permanentRedirect/u);
  assert.doesNotMatch(page, /redirect\(\s*["']\/events["']\s*\)/u);
});
