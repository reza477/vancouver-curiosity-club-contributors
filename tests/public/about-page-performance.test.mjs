import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

test("About keeps its CMS gate and a truthful institutional narrative without loading projections", async () => {
  const [about, editorial, missionCopy] = await Promise.all([
    readFile(new URL("app/about/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/_components/EditorialPage.tsx", projectRoot), "utf8"),
    readFile(new URL("lib/public-mission-copy.ts", projectRoot), "utf8"),
  ]);
  const aboutPositioning = `${about}\n${missionCopy}`;

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

  for (const copy of [
    "Mission-led community in Vancouver",
    "Building belonging through curiosity.",
    "Our mission",
    "Make meaningful community easier to find.",
    "How the work helps",
    "A shared interest can become a way into community.",
    "Built for continuity",
    "A community designed to keep showing up.",
    "Work with us",
    "Help create the conditions for connection.",
  ]) {
    assert.ok(aboutPositioning.includes(copy), copy);
  }
  assert.match(
    about,
    /descriptionOverride:\s*PUBLIC_ABOUT_MISSION_COPY\.metadataDescription/u,
  );
  assert.match(
    editorial,
    /descriptionOverride \?\?[\s\S]*?page\.metaDescription/u,
    "product-owned mission metadata must take precedence after the CMS page gate succeeds",
  );
  assert.match(
    about,
    /<Link[\s\S]*?className="primary-action"[\s\S]*?href="\/contact\?topic=partnerships#contact-form"[\s\S]*?>[\s\S]*?Discuss a partnership[\s\S]*?<\/Link>/u,
    "About must give prospective partners a focused next step",
  );
  assert.match(
    about,
    /<Link\s+href="\/events">[\s\S]*?See the work in action[\s\S]*?<\/Link>/u,
    "About must let prospective supporters inspect the public program",
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
  assert.doesNotMatch(
    about,
    /\b(?:registered\s+)?(?:nonprofit|non-profit|charit(?:y|able)|tax[- ]deductible|tax receipt)\b/iu,
    "About must not claim an unverified legal or charitable status",
  );
  assert.doesNotMatch(
    about,
    /\b(?:members?|attendees?)\s+(?:say|said|report(?:ed)?|tell|told)\b|\btestimonial(?:s)?\b|<blockquote\b/iu,
    "About must not present invented member testimony as impact evidence",
  );
});

test("primary navigation applies selective public prefetching", async () => {
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
      { href: "/for-organizations", label: "For Organizations" },
      { href: "/contact", label: "Contact" },
    ],
    "the institutional redesign must preserve the approved primary hrefs and order",
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
    /prefetch=\{prefetchInternalLinks\}/u,
    "every public primary destination must preserve the preview opt-out switch",
  );
  assert.match(
    header,
    /prefetchInternalLinks = true/u,
    "public primary navigation must default to allowing the route policy",
  );
  assert.match(
    header,
    /import \{ PublicRouteLink as Link \} from "@\/app\/_components\/PublicRouteLink";/u,
    "the route policy must decide which primary destinations are expensive",
  );
  assert.match(
    header,
    /className="wordmark"[\s\S]*?prefetch=\{prefetchInternalLinks\}/u,
    "the wordmark and primary links must share the preview opt-out switch",
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
