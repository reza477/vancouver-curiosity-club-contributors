import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

test("About keeps its CMS gate without loading catalog or event projections", async () => {
  const about = await readFile(
    new URL("app/about/page.tsx", projectRoot),
    "utf8",
  );

  assert.match(
    about,
    /await\s+loadEditorialPage\(slug, route\)/u,
    "About must still fail closed against its published CMS page",
  );
  assert.doesNotMatch(
    about,
    /\bOrganizerNote\b|about-founder-note(?:-title)?/u,
    "About must not import, wrap, or render the removed organizer note",
  );
  for (const className of [
    "about-hero",
    "about-feel",
    "about-audience",
    "about-solo",
    "about-closing",
  ]) {
    assert.match(
      about,
      new RegExp(`className="${className}"`, "u"),
      `${className} must remain on the useful static About page`,
    );
  }
  assert.match(
    about,
    /className="about-hero"[\s\S]*?className="about-feel"[\s\S]*?className="about-audience"[\s\S]*?className="about-solo"[\s\S]*?className="about-closing"/u,
    "removing the organizer note must preserve the remaining About section order",
  );
  assert.match(
    about,
    /<Link\s+className="primary-action"\s+href="\/events"\s+prefetch=\{false\}>[\s\S]*?See upcoming gatherings[\s\S]*?<\/Link>/u,
    "About must retain a direct path to the live Events page without preloading it",
  );

  assert.doesNotMatch(
    about,
    /\bloadAboutData\b|\bloadPublicCatalog\b|\bqueryPublicEvents\b|\bEventCard\b/u,
    "About must not load its former catalog and event-card projection",
  );
  assert.doesNotMatch(
    about,
    /className="about-(?:facts|events)"/u,
    "the two sections backed by live catalog and event queries must stay removed",
  );
});

test("primary navigation does not prefetch force-dynamic destinations by default", async () => {
  const [header, ...publicRoutes] = await Promise.all([
    readFile(
      new URL("app/_components/SiteHeader.tsx", projectRoot),
      "utf8",
    ),
    ...[
      "app/events/page.tsx",
      "app/clubs/page.tsx",
      "app/about/page.tsx",
      "app/contact/page.tsx",
    ].map((path) => readFile(new URL(path, projectRoot), "utf8")),
  ]);

  for (const route of publicRoutes) {
    assert.match(
      route,
      /export const dynamic = "force-dynamic";/u,
      "every primary destination covered by this contract must be dynamic",
    );
  }

  const requiredNavigation = header.match(
    /const requiredNavigation\s*=\s*\[([\s\S]*?)\]\s*as const;/u,
  )?.[1];
  assert.ok(requiredNavigation, "the required primary navigation must exist");
  assert.deepEqual(
    [...requiredNavigation.matchAll(
      /\{\s*href:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}/gu,
    )].map((match) => ({ href: match[1], label: match[2] })),
    [
      { href: "/events", label: "Events" },
      { href: "/clubs", label: "Clubs" },
      { href: "/about", label: "About" },
      { href: "/contact", label: "Feedback" },
    ],
    "removing speculative work must not change primary hrefs or order",
  );

  const navigationLinks = sourceSection(
    header,
    "function NavigationLinks",
    "function normalizedPrimaryNavigation",
  );
  assert.match(navigationLinks, /href=\{item\.href\}/u);
  assert.match(
    navigationLinks,
    /aria-current=\{[\s\S]*?isCurrentNavigationPath\(pathname, item\.href\)[\s\S]*?"page"/u,
    "the current-page treatment must remain wired to the destination",
  );
  assert.match(
    navigationLinks,
    /prefetch=\{\s*prefetchInternalLinks && item\.href !== "\/events"\s*\}/u,
    "the primary navigation must not render About or another dynamic route in the background",
  );
  assert.match(
    header,
    /prefetchInternalLinks = false/u,
    "public primary navigation must default to no background route renders",
  );
  assert.match(
    header,
    /className="wordmark"[\s\S]*?prefetch=\{prefetchInternalLinks\}/u,
    "the wordmark and primary links must share the public no-prefetch default",
  );
  assert.match(
    header,
    /href === "\/events"[\s\S]*?pathname === "\/events"[\s\S]*?pathname\.startsWith\("\/events\/"\)[\s\S]*?pathname === "\/calendar"[\s\S]*?pathname === href[\s\S]*?pathname\.startsWith\(`\$\{href\}\/`\)/u,
    "Events aliases and nested-route active states must remain intact",
  );
});

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} must exist`);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return source.slice(start, end);
}
