import { readPublicCss } from "../helpers/public-css.mjs";
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

test("Events uses compact lane and club selects without the retired advanced form", async () => {
  const renderer = await readFile(
    new URL("app/_components/EventsPageRenderer.tsx", projectRoot),
    "utf8",
  );

  assert.doesNotMatch(
    renderer,
    /<EventFilters\b/u,
    "/events must not restore the keyword/date/category/format advanced form",
  );
  assert.match(renderer, /className="events-filter-form"[\s\S]*name="lane"/u);
  assert.match(renderer, /className="events-filter-form"[\s\S]*name="club"/u);
  assert.doesNotMatch(renderer, /events-page__lane-filters|Filter events by activity lane/u);
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

test("Events offers a compact Upcoming list and keeps the full Calendar", async () => {
  const renderer = await readFile(
    new URL("app/_components/EventsPageRenderer.tsx", projectRoot),
    "utf8",
  );
  assert.match(
    renderer,
    /<PublicMonthCalendar/u,
    "/events must render the full PublicMonthCalendar, not only a link to /calendar",
  );
  assert.match(
    renderer,
    /<EventCard compact event=\{event\}/u,
    "/events must render durable upcoming records as compact EventCards",
  );
  assert.match(renderer, /upcoming\.totalPages > 1[\s\S]*Upcoming events pages/u);
});

test("public Events has explicit Upcoming and Calendar views", async () => {
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

  assert.match(
    publicEventsSurface,
    /aria-label=["']Event views["'][\s\S]*Upcoming[\s\S]*Calendar/u,
    "the discovery surface must offer the two approved explicit views",
  );
  assert.doesNotMatch(
    publicEventsSurface,
    />\s*List\s*<[^>]*>[\s\S]{0,300}>\s*Month\s*</u,
    "the view labels must be Upcoming and Calendar, not the retired List/Month terms",
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
    /new URL\(\s*["']\/events["'],\s*await getPublicRequestOrigin\(source\),?\s*\)/u,
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
  assert.match(
    calendarRoute,
    /destination\.searchParams\.set\(["']view["'], ["']calendar["']\)/u,
    "legacy /calendar URLs must activate the secondary Calendar view",
  );
  assert.match(calendarRoute, /Response\.redirect\(destination, 308\)/u);
  assert.doesNotMatch(calendarRoute, /<PublicMonthCalendar\b/u);
  assert.doesNotMatch(calendarRoute, /Download upcoming events/u);
});

test("Events parses the approved URL state and renders only the active view", async () => {
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

  assert.match(page, /resolvePublicEventsView\(raw\.view\)/u);
  assert.match(page, /clubSlug:\s*raw\.club/u);
  assert.match(page, /rawPage:\s*raw\.page/u);
  assert.match(
    renderer,
    /activeView === "upcoming"[\s\S]*<UpcomingEventsView[\s\S]*:\s*\([\s\S]*<CalendarEventsView/u,
    "only the active view may be mounted, including on mobile",
  );
  assert.doesNotMatch(eventsSurface, /Event timeframe|>\s*Past\s*</u);
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
    readPublicCss(),
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
  assert.match(
    rulesAt390,
    /\.events-page__calendar \.public-calendar__mobile-agenda\s*\{[^}]*display:\s*none;/u,
    "the Events Calendar view must not stack its grid, day panel, and monthly agenda on a phone",
  );
});
