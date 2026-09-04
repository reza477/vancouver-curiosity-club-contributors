import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import {
  projectRoot,
  publicCssEntry,
  publicCssModulePaths,
  readPublicCss,
} from "../helpers/public-css.mjs";

const expectedImports = publicCssModulePaths.map(
  (file) => `@import "./${file.replace(/^app\//u, "")}" layer(${layerFor(file)});`,
);
const organizationsCss = new URL(
  "public/styles/organizations.css",
  projectRoot,
);
const aboutCss = new URL("public/styles/about.css", projectRoot);
const eventsCss = new URL("public/styles/events.css", projectRoot);
const calendarCss = new URL("public/styles/calendar.css", projectRoot);
const eventDetailCss = new URL("public/styles/event-detail.css", projectRoot);
const eventsRenderer = new URL(
  "app/_components/EventsPageRenderer.tsx",
  projectRoot,
);
const eventDetailRenderer = new URL(
  "app/_components/PublicEventDetailRenderer.tsx",
  projectRoot,
);

test("the public stylesheet entrypoint owns only an explicit layered module graph", async () => {
  const entry = await readFile(publicCssEntry, "utf8");
  assert.match(entry, /^@layer tokens, base, layout, components;/u);
  for (const expectedImport of expectedImports) assert.ok(entry.includes(expectedImport));
  assert.equal((entry.match(/@import /gu) ?? []).length, expectedImports.length);
  assert.doesNotMatch(entry, /\{[\s\S]*\}/u, "globals.css must not become a style monolith again");

  const entryBytes = (await stat(publicCssEntry)).size;
  assert.ok(entryBytes < 2_000, `globals.css is ${entryBytes} bytes; imports should stay small`);
  for (const modulePath of publicCssModulePaths) {
    const moduleUrl = new URL(modulePath, projectRoot);
    const [source, metadata] = await Promise.all([
      readFile(moduleUrl, "utf8"),
      stat(moduleUrl),
    ]);
    assert.ok(source.split("\n").length > 10, `${modulePath} must remain readable source`);
    assert.ok(metadata.size < 30_000, `${modulePath} is ${metadata.size} bytes; split its ownership`);
  }
});

test("route and component selectors stay in their named modules", async () => {
  const files = await Promise.all(
    publicCssModulePaths.map(async (modulePath) => [
      modulePath,
      await readFile(new URL(modulePath, projectRoot), "utf8"),
    ]),
  );
  const styles = new Map(files);

  for (const [modulePath, selector] of [
    ["app/styles/components/editorial.css", ".editorial-section"],
    ["app/styles/components/catalog.css", ".club-directory"],
    ["app/styles/components/event-card.css", ".event-card"],
    ["app/styles/components/forms.css", ".public-submission"],
    ["app/styles/pages/home.css", ".home-hero"],
  ]) {
    assert.ok(styles.get(modulePath).includes(selector), `${selector} must stay in ${modulePath}`);
  }

  const about = await readFile(aboutCss, "utf8");
  assert.ok(about.includes(".about-hero"), ".about-hero must stay in the About route module");

  const events = await readFile(eventsCss, "utf8");
  const calendar = await readFile(calendarCss, "utf8");
  const renderer = await readFile(eventsRenderer, "utf8");
  assert.ok(
    calendar.includes(".public-calendar"),
    ".public-calendar must stay in the calendar route module",
  );
  assert.match(
    renderer,
    /href="\/styles\/calendar\.css"[^>]*precedence="calendar"/u,
  );
  const eventDetail = await readFile(eventDetailCss, "utf8");
  const detailRenderer = await readFile(eventDetailRenderer, "utf8");
  assert.ok(
    eventDetail.includes(".event-detail"),
    ".event-detail must stay in the event-detail route module",
  );
  assert.match(
    detailRenderer,
    /href="\/styles\/event-detail\.css"[^>]*precedence="event-detail"/u,
  );
  for (const selector of [
    ".events-page__discovery",
    ".events-page__controls",
    ".events-view-switcher",
    ".events-filter-form",
    ".events-upcoming__summary",
    ".events-upcoming__list",
  ]) {
    assert.ok(events.includes(selector), `${selector} must stay in the Events page module`);
  }

  const organizations = await readFile(organizationsCss, "utf8");
  assert.match(organizations, /\.for-organizations-page\b/u);
  assert.match(organizations, /\.organizations-collaboration\b/u);
  assert.ok(
    (await stat(aboutCss)).size < 30_000,
    "the route-scoped About stylesheet must remain bounded",
  );
  assert.ok(
    (await stat(organizationsCss)).size < 30_000,
    "the route-scoped organizations stylesheet must remain bounded",
  );
  assert.ok(
    (await stat(calendarCss)).size < 30_000,
    "the route-scoped calendar stylesheet must remain bounded",
  );
  assert.ok(
    (await stat(eventsCss)).size < 30_000,
    "the route-scoped Events stylesheet must remain bounded",
  );
  assert.ok(
    (await stat(eventDetailCss)).size < 30_000,
    "the route-scoped event-detail stylesheet must remain bounded",
  );
});

test("retired public systems and private organizer controls cannot leak into public CSS", async () => {
  const [publicCss, organizerCss] = await Promise.all([
    readPublicCss(),
    readFile(new URL("app/_organizer/organizer.css", projectRoot), "utf8"),
  ]);

  assert.match(publicCss, /--ink-soft:\s*#3d4a66;/u);
  assert.doesNotMatch(publicCss, /@import\s+["']tailwindcss["']|@theme\b/u);
  for (const retiredSelector of [
    /(^|[,{]\s*)\.hero(?:\s|[,{.:#>+~])/mu,
    /\.calendar-masthead\b/u,
    /\.sync-panel\b/u,
    /\.agenda-card\b/u,
    /\.field-artwork(?:__|--|\b)/u,
    /\.event-filters\b/u,
    /\.organizer-tools\b/u,
    /\.meetup-/u,
  ]) {
    assert.doesNotMatch(publicCss, retiredSelector);
  }
  assert.match(organizerCss, /\.meetup-controls\b/u);
  assert.match(organizerCss, /Route-scoped Meetup controls moved out of public CSS/u);
});

function layerFor(file) {
  if (file.endsWith("tokens.css")) return "tokens";
  if (file.endsWith("base.css")) return "base";
  if (file.endsWith("layout.css")) return "layout";
  return "components";
}
