import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

function maxWidthMediaBlocks(styles) {
  const blocks = [];
  const mediaStart = /@media\s*\(max-width:\s*([\d.]+)rem\)\s*\{/gu;

  for (const match of styles.matchAll(mediaStart)) {
    let depth = 1;
    let cursor = match.index + match[0].length;

    while (cursor < styles.length && depth > 0) {
      if (styles[cursor] === "{") depth += 1;
      if (styles[cursor] === "}") depth -= 1;
      cursor += 1;
    }

    blocks.push({
      body: styles.slice(match.index + match[0].length, cursor - 1),
      maxWidthRem: Number(match[1]),
    });
  }

  return blocks;
}

test("Events removes the keyword and advanced-filter form", async () => {
  const renderer = await readFile(
    new URL("app/_components/EventsPageRenderer.tsx", projectRoot),
    "utf8",
  );

  assert.doesNotMatch(
    renderer,
    /<EventFilters\b/u,
    "/events must not render the keyword, date, club, lane, category, or format filter form",
  );
});

test("Events removes the filtered-download strip", async () => {
  const renderer = await readFile(
    new URL("app/_components/EventsPageRenderer.tsx", projectRoot),
    "utf8",
  );

  assert.doesNotMatch(
    renderer,
    /public-export-actions|Download this public view|exportHref\(/u,
    "/events must not render the public iCalendar/CSV download strip",
  );
});

test("Events keeps the full month calendar and removes the separate event list", async () => {
  const renderer = await readFile(
    new URL("app/_components/EventsPageRenderer.tsx", projectRoot),
    "utf8",
  );
  assert.match(
    renderer,
    /<PublicMonthCalendar/u,
    "/events must render the full PublicMonthCalendar, not only a link to /calendar",
  );
  assert.doesNotMatch(
    renderer,
    /<EventCollection|events-page__list|Event timeframe|<Pagination/u,
    "/events must not repeat the calendar records in a separate paginated list",
  );
});

test("public Events has no separate List or Month view switcher", async () => {
  const [calendarRoute, monthCalendar, renderer] = await Promise.all([
    readFile(new URL("app/calendar/route.ts", projectRoot), "utf8"),
    readFile(
      new URL("app/_components/PublicMonthCalendar.tsx", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("app/_components/EventsPageRenderer.tsx", projectRoot),
      "utf8",
    ),
  ]);
  const publicEventsSurface = `${calendarRoute}\n${monthCalendar}\n${renderer}`;

  assert.doesNotMatch(
    publicEventsSurface,
    /calendar-view-switcher|aria-label=["']Event views["']/u,
    "the calendar experience must not offer redundant List/Month views",
  );
  assert.doesNotMatch(
    publicEventsSurface,
    />\s*List\s*<[^>]*>[\s\S]{0,300}>\s*Month\s*</u,
    "public visitors must not be asked to choose between List and Month",
  );
  assert.doesNotMatch(
    publicEventsSurface,
    /list and filters view|event list below/u,
    "calendar guidance must not point to a retired list or filter surface",
  );
});

test("Calendar forwards its month query to the combined Events experience", async () => {
  const calendarRoute = await readFile(
    new URL("app/calendar/route.ts", projectRoot),
    "utf8",
  );

  assert.match(calendarRoute, /new URL\(request\.url\)/u);
  assert.match(
    calendarRoute,
    /new URL\(\s*["']\/events["'],\s*trustedPublicRequestOrigin\(source\),?\s*\)/u,
  );
  assert.match(
    calendarRoute,
    /source\.searchParams\.getAll\(["']month["']\)/u,
  );
  assert.match(
    calendarRoute,
    /destination\.searchParams\.set\(["']month["'], month\)/u,
    "the legacy /calendar route must safely preserve a requested month",
  );
  assert.match(calendarRoute, /Response\.redirect\(destination, 308\)/u);
  assert.doesNotMatch(calendarRoute, /<PublicMonthCalendar\b/u);
  assert.doesNotMatch(calendarRoute, /Download upcoming events/u);
});

test("Events does not parse or render retired list controls", async () => {
  const [page, renderer, calendar] = await Promise.all([
    readFile(new URL("app/events/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/_components/EventsPageRenderer.tsx", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("app/_components/PublicMonthCalendar.tsx", projectRoot),
      "utf8",
    ),
  ]);
  const eventsSurface = `${page}\n${renderer}`;

  assert.doesNotMatch(page, /eventListValues|values\.state|values\.page/u);
  assert.doesNotMatch(
    eventsSurface,
    /Event timeframe|>\s*Upcoming\s*<|>\s*Past\s*<|<Pagination/u,
  );
  assert.doesNotMatch(renderer, /EditorialSection|editorial-sections/u);
  const monthIndex = calendar.indexOf('className="public-calendar__month"');
  const dayPanelIndex = calendar.indexOf('className="public-calendar__day-panel"');
  const agendaIndex = calendar.indexOf(
    'className="public-calendar__mobile-agenda"',
  );
  assert.ok(monthIndex >= 0);
  assert.ok(monthIndex < dayPanelIndex);
  assert.ok(dayPanelIndex < agendaIndex);
});

test("the full calendar exposes event names in its mobile agenda", async () => {
  const [calendar, styles] = await Promise.all([
    readFile(
      new URL("app/_components/PublicMonthCalendar.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
  ]);
  const rulesAt390 = maxWidthMediaBlocks(styles)
    .filter(({ maxWidthRem }) => maxWidthRem >= 24.375)
    .map(({ body }) => body)
    .join("\n");

  assert.match(calendar, /className="public-calendar__mobile-agenda"/u);
  assert.match(
    calendar,
    /className="public-calendar__mobile-agenda"[\s\S]*?<strong>\{event\.title\}<\/strong>/u,
    "mobile visitors must see event names without tapping calendar dots",
  );
  assert.match(
    rulesAt390,
    /\.public-calendar__mobile-agenda\s*\{[^}]*display:\s*block;/u,
    "the named-event agenda must be visible at a 390px viewport",
  );
  assert.match(
    rulesAt390,
    /\.public-calendar__mobile-agenda-list button\s*\{[^}]*min-height:\s*4\.5rem;/u,
    "mobile agenda event targets must remain at least 44px tall",
  );
});
