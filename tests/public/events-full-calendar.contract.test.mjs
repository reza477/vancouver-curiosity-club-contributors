import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);
const projectRootPath = fileURLToPath(projectRoot);

async function localSourceClosure(relativeEntry) {
  const visited = new Set();
  const sources = [];

  async function visit(absoluteEntry) {
    const candidates = [
      absoluteEntry,
      `${absoluteEntry}.tsx`,
      `${absoluteEntry}.ts`,
      `${absoluteEntry}.jsx`,
      `${absoluteEntry}.js`,
      resolve(absoluteEntry, "index.tsx"),
      resolve(absoluteEntry, "index.ts"),
    ];
    let source = null;
    let resolvedEntry = null;
    for (const candidate of candidates) {
      try {
        source = await readFile(candidate, "utf8");
        resolvedEntry = candidate;
        break;
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "EISDIR") throw error;
      }
    }
    if (source === null || resolvedEntry === null || visited.has(resolvedEntry)) {
      return;
    }
    visited.add(resolvedEntry);
    sources.push(source);

    for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/gu)) {
      await visit(resolve(dirname(resolvedEntry), match[1]));
    }
  }

  await visit(resolve(projectRootPath, relativeEntry));
  return sources.join("\n");
}

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

test("Events renders the full month calendar before its event list", async () => {
  const renderer = await readFile(
    new URL("app/_components/EventsPageRenderer.tsx", projectRoot),
    "utf8",
  );
  const calendarIndex = renderer.indexOf("<PublicMonthCalendar");
  const eventListIndex = renderer.indexOf("<EventCollection");

  assert.ok(
    calendarIndex >= 0,
    "/events must render the full PublicMonthCalendar, not only a link to /calendar",
  );
  assert.ok(
    eventListIndex >= 0,
    "/events must retain its accessible event-card collection after the calendar",
  );
  assert.ok(
    calendarIndex < eventListIndex,
    "the full month calendar must appear before the event list",
  );
});

test("Events preserves Upcoming and Past list semantics", async () => {
  const [page, renderedComponentClosure] = await Promise.all([
    readFile(new URL("app/events/page.tsx", projectRoot), "utf8"),
    localSourceClosure("app/_components/EventsPageRenderer"),
  ]);
  const eventsSurface = `${page}\n${renderedComponentClosure}`;

  assert.match(page, /view:\s*values\.state/u);
  assert.match(eventsSurface, />\s*Upcoming\s*</u);
  assert.match(eventsSurface, />\s*Past\s*</u);
  assert.match(eventsSurface, /aria-current/u);
  assert.match(eventsSurface, /state/u);
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
    /mobileAgendaEvents\.map\(\(event\)[\s\S]*?<strong>\{event\.title\}<\/strong>/u,
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
