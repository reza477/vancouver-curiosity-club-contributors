import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

test("About keeps its CMS gate and a truthful institutional narrative without loading projections", async () => {
  const [about, editorial, missionCopy, catalogDefinitions] = await Promise.all([
    readFile(new URL("app/about/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/_components/EditorialPage.tsx", projectRoot), "utf8"),
    readFile(new URL("lib/public-mission-copy.ts", projectRoot), "utf8"),
    readFile(
      new URL("lib/server/public/catalog-definitions.ts", projectRoot),
      "utf8",
    ),
  ]);
  const aboutPositioning = `${about}\n${missionCopy}\n${catalogDefinitions}`;

  assert.match(
    about,
    /await\s+loadEditorialPage\(slug, route\)/u,
    "About must still fail closed against its published CMS page",
  );
  assert.match(
    about,
    /className="about-hero"[\s\S]*?className="about-overview"[\s\S]*?className="about-model"[\s\S]*?className="about-evidence"[\s\S]*?className="about-communities"[\s\S]*?className="about-standards"[\s\S]*?className="about-closing"/u,
    "About must keep the approved institutional narrative order",
  );
  for (const copy of [
    "Our mission",
    "Building belonging through curiosity.",
    "Vancouver Curiosity and Education Society makes meaningful lifelong learning accessible after people leave school or university.",
    "Organization at a glance",
    "How the model works",
    "What we organize",
    "Think",
    "Reset & Make",
    "Explore",
    "Eat & Play",
    "Three public communities",
    "Public standards",
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
    /href="\/for-organizations"[\s\S]*?Explore organizational collaboration/u,
    "About must give prospective partners a focused next step",
  );
  assert.match(
    about,
    /href="\/events"[\s\S]*?View public events/u,
    "About must let prospective supporters inspect the public program",
  );
  assert.equal(
    [...about.matchAll(/file: "meetup-[0-9]+"/gu)].length,
    3,
    "About must reuse three genuine bundled event posters",
  );
  assert.match(about, /loading="lazy"/u);
  assert.doesNotMatch(
    about,
    /\bloadAboutData\b|\bloadPublicCatalog\b|\bqueryPublicEvents\b|\bEventCard\b/u,
    "About must not add another public data projection",
  );
  assert.doesNotMatch(
    about,
    /\bOrganizerNote\b|about-founder-note(?:-title)?/u,
    "About must not import or render unverified leadership copy",
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
